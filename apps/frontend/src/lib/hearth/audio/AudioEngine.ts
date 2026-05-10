"use client";

import * as Tone from "tone";
import { MoodProfile } from "@/lib/hearth/schema";

type ClipId =
  | "focusLow"
  | "focusMid"
  | "focusHigh"
  | "windDown"
  | "rain"
  | "brownNoise";

type MusicId = "focusLow" | "focusMid" | "focusHigh" | "windDown";

const MUSIC_IDS: readonly MusicId[] = [
  "focusLow",
  "focusMid",
  "focusHigh",
  "windDown",
] as const;

type SfxId = "leverGrab" | "cardMaterialize" | "regenChime";

const CLIP_URLS: Record<ClipId, string> = {
  focusLow: "/audio/loop_focus_low.mp3",
  focusMid: "/audio/loop_focus_mid.mp3",
  focusHigh: "/audio/loop_focus_high.mp3",
  windDown: "/audio/loop_winddown.mp3",
  rain: "/audio/texture_rain.mp3",
  brownNoise: "/audio/texture_brown_noise.mp3",
};

const SFX_URLS: Record<SfxId, string> = {
  leverGrab: "/audio/sfx_lever_grab.mp3",
  cardMaterialize: "/audio/sfx_card_materialize.mp3",
  regenChime: "/audio/sfx_chime_regen.mp3",
};

export class AudioEngine {
  private initialized = false;
  private started = false;
  private clips = new Map<ClipId, Tone.Player>();
  private sfx = new Map<SfxId, Tone.Player>();
  private gains = new Map<ClipId, Tone.Gain>();

  /**
   * Music FX bus — every music player (prebaked + generative) routes through
   * this chain so the patch-tier levers reshape the playing audio in real
   * time. Aux beds (rain, brown noise) bypass it so they stay clean
   * regardless of the music's filter.
   *
   *   musicBus → filter (warmth) → reverb (space) → out
   *
   * Distortion was tried for an "energy" lever and removed: setting
   * Tone.Distortion.distortion rebuilds the waveshaper curve internally on
   * every change, which clicks audibly during a drag. Saturation belongs
   * upstream of the patch tier — bake it into the prebaked clips or the
   * Lyria prompt instead.
   *
   * playbackRate (pace) is per-player and ramped (not snapped) so segmented
   * tempo flips slide rather than glitch.
   */
  private musicBus: Tone.Gain | null = null;
  private fxFilter: Tone.Filter | null = null;
  private fxReverb: Tone.Reverb | null = null;

  /**
   * Generative bed — populated by loadGenerative() at runtime with a fresh
   * Lyria clip. When active, it replaces the prebaked focus_* beds so the
   * agent's regenerated music actually plays instead of just rebalancing
   * volumes on the same prebaked tracks.
   */
  private generativePlayer: Tone.Player | null = null;
  private generativeGain: Tone.Gain | null = null;
  private generativeActive = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();
    this.initialized = true;

    // Build the music FX chain BEFORE loading clips so each player can
    // connect to the bus directly. Aux beds (rain, brownNoise) skip this
    // chain — they go to destination raw.
    this.musicBus = new Tone.Gain(1);
    this.fxFilter = new Tone.Filter({ frequency: 18000, type: "lowpass", rolloff: -12 });
    this.fxReverb = new Tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 0 });
    // Reverb generates its impulse response async; await so the first
    // playback isn't dry. ~30ms one-time cost, fine inside init().
    await this.fxReverb.generate();
    this.musicBus.chain(this.fxFilter, this.fxReverb, Tone.getDestination());

    await Promise.allSettled(
      (Object.keys(CLIP_URLS) as ClipId[]).map(async (id) => {
        const player = new Tone.Player({ loop: true, autostart: false });
        const gain = new Tone.Gain(0);
        player.connect(gain);
        // Music goes through the FX bus; aux beds stay clean.
        if (isMusicId(id)) {
          gain.connect(this.musicBus!);
        } else {
          gain.toDestination();
        }
        try {
          await player.load(CLIP_URLS[id]);
          this.clips.set(id, player);
          this.gains.set(id, gain);
        } catch (error) {
          console.warn(`[AudioEngine] Failed to load clip: ${CLIP_URLS[id]}`, error);
          player.dispose();
          gain.dispose();
        }
      }),
    );

    await Promise.allSettled(
      (Object.keys(SFX_URLS) as SfxId[]).map(async (id) => {
        const player = new Tone.Player({ loop: false, autostart: false }).toDestination();
        try {
          await player.load(SFX_URLS[id]);
          this.sfx.set(id, player);
        } catch (error) {
          console.warn(`[AudioEngine] Failed to load SFX: ${SFX_URLS[id]}`, error);
          player.dispose();
        }
      }),
    );

    this.startBeds();
  }

  applyProfile(profile: MoodProfile): void {
    if (!this.initialized) return;
    this.startBeds();

    const intensity = clamp01(profile.music.intensity);
    const rain = clamp01(profile.music.aux.rain);
    const brownNoise = clamp01(profile.music.aux.brownNoise);

    // ---- music slot: exactly one bed plays at a time ----
    // Levers all converge on a SINGLE music output. Selection priority:
    //   generative (Lyria) > windDown > focusLow|Mid|High by intensity bucket
    // Every other music clip ramps to silence so we never get two beds
    // overlapping. Intensity also drives the master music gain inside the
    // selected clip so dragging the intensity dial is audibly continuous.
    const selected: MusicId | "generative" = this.generativeActive
      ? "generative"
      : selectMusicClip(profile);
    const musicMasterGain = this.generativeActive ? 1 : 0.55 + 0.45 * intensity;
    const isWindDown = selected === "windDown";

    for (const id of MUSIC_IDS) {
      const target =
        selected === "generative" || id !== selected ? 0 : musicMasterGain;
      // Wind-down clips get a longer fade in/out so the room transition
      // doesn't feel jolting; everything else is snappy.
      const fade = isWindDown && id === "windDown" ? 2.0 : id === selected ? 0.4 : 0.8;
      this.ramp(id, target, fade);
    }

    // ---- ambient bus: layered on top of whichever music is playing ----
    this.ramp("rain", rain, 0.25);
    this.ramp("brownNoise", brownNoise, 0.25);

    // ---- patch FX: read params.warmth / .space / .pace / .energy ----
    // These are the universal patch-tier levers. Every genre's lever set
    // labels them differently ("Tape", "Hearthlight", "Filter") but they
    // all bind to the same params slots and reshape the playing audio
    // here without a Lyria round-trip.
    this.applyPatchParams(profile);
  }

  /**
   * Apply the universal patch-tier params to the FX chain. Cheap — runs
   * on every profile change. Ramps are sized so drags feel continuous and
   * segmented snaps slide musically rather than click.
   *
   * Three knobs, deliberately:
   *   - warmth → filter cutoff   (smooth slider, 120 ms ramp)
   *   - space  → reverb wet      (smooth slider or off-stage default)
   *   - pace   → playbackRate    (segmented Slower/Steady/Faster, 350 ms slide)
   *
   * `space` is kept available for the agent to drive even when no lever
   * exposes it — it's part of the room's character and can be set on regen.
   */
  private applyPatchParams(profile: MoodProfile): void {
    const p = profile.params ?? {};
    const warmth = clamp01(asNumber(p.warmth, 0));
    const space = clamp01(asNumber(p.space, 0));
    // pace defaults to 0.5 → playbackRate 1.0 (no shift).
    const pace = clamp01(asNumber(p.pace, 0.5));

    // warmth → lowpass cutoff. 0 = clean (18 kHz), 1 = blanket (~1.2 kHz).
    if (this.fxFilter) {
      const cutoffHz = 18000 / Math.pow(15, warmth);
      this.fxFilter.frequency.rampTo(cutoffHz, 0.12);
    }

    // space → reverb wet. Cap at 0.55 so dry stays present even at max.
    if (this.fxReverb) {
      this.fxReverb.wet.rampTo(space * 0.55, 0.15);
    }

    // pace → playbackRate on every music player. ±12% range maps from
    // pace 0..1 → 0.88..1.12. At 0.5 = 1.0 (no shift). Ramped so flipping
    // the segmented Tempo control slides up/down musically (~350 ms).
    const rate = 0.88 + 0.24 * pace;
    for (const id of MUSIC_IDS) {
      const player = this.clips.get(id);
      if (player) rampPlaybackRate(player, rate, 0.35);
    }
    if (this.generativePlayer) {
      rampPlaybackRate(this.generativePlayer, rate, 0.35);
    }
  }

  /**
   * Replace the music bed with a freshly-generated clip from the BFF.
   *
   * The cross-fade is 3 seconds — long enough to hide the seam between the
   * prebaked bed (or the previous generative clip) and the new one. If
   * fetch or decode fails, the prebaked focus_* beds stay active (no audio
   * dropout for the demo).
   */
  async loadGenerative(url: string): Promise<void> {
    if (!this.initialized) {
      throw new Error("AudioEngine.loadGenerative: call init() first");
    }

    // Build the new player + gain chain BEFORE swapping so we can fail
    // closed (no audio gap) if the load throws. Generative beds go through
    // the FX bus so the patch tier reshapes them live, same as prebaked.
    const nextPlayer = new Tone.Player({ loop: true, autostart: false });
    const nextGain = new Tone.Gain(0);
    nextPlayer.connect(nextGain);
    if (this.musicBus) {
      nextGain.connect(this.musicBus);
    } else {
      nextGain.toDestination();
    }

    try {
      await nextPlayer.load(url);
    } catch (error) {
      console.warn("[AudioEngine] generative load failed:", error);
      nextPlayer.dispose();
      nextGain.dispose();
      throw error;
    }

    // Cross-fade: ramp prebaked focus_* down, ramp new bed up. Both sides
    // of the swap take 3s — overlap is intentional.
    const FADE_S = 3.0;
    this.generativeActive = true;
    this.ramp("focusLow", 0, FADE_S);
    this.ramp("focusMid", 0, FADE_S);
    this.ramp("focusHigh", 0, FADE_S);

    // Hand off the player slot — start the new one, ramp it up, then
    // dispose the old after the fade completes so we don't cut its tail.
    const prevPlayer = this.generativePlayer;
    const prevGain = this.generativeGain;

    this.generativePlayer = nextPlayer;
    this.generativeGain = nextGain;
    try {
      nextPlayer.start();
    } catch (error) {
      console.warn("[AudioEngine] generative start failed:", error);
    }
    nextGain.gain.rampTo(1, FADE_S);

    if (prevPlayer && prevGain) {
      prevGain.gain.rampTo(0, FADE_S);
      // Schedule disposal slightly after the fade so the tail doesn't click.
      setTimeout(() => {
        try {
          prevPlayer.stop();
        } catch {
          // ignore — disposal below cleans up
        }
        prevPlayer.dispose();
        prevGain.dispose();
      }, (FADE_S + 0.1) * 1000);
    }
  }

  playSfx(type: SfxId): void {
    const player = this.sfx.get(type);
    if (!player) return;
    try {
      player.stop();
      player.start();
    } catch (error) {
      console.warn(`[AudioEngine] Failed to play sfx: ${type}`, error);
    }
  }

  dispose(): void {
    this.clips.forEach((player) => player.dispose());
    this.sfx.forEach((player) => player.dispose());
    this.gains.forEach((gain) => gain.dispose());
    this.clips.clear();
    this.sfx.clear();
    this.gains.clear();
    if (this.generativePlayer) this.generativePlayer.dispose();
    if (this.generativeGain) this.generativeGain.dispose();
    this.generativePlayer = null;
    this.generativeGain = null;
    this.generativeActive = false;
    if (this.fxReverb) this.fxReverb.dispose();
    if (this.fxFilter) this.fxFilter.dispose();
    if (this.musicBus) this.musicBus.dispose();
    this.fxReverb = null;
    this.fxFilter = null;
    this.musicBus = null;
    this.initialized = false;
    this.started = false;
  }

  private startBeds() {
    if (this.started) return;
    this.started = true;
    this.clips.forEach((player) => {
      try {
        player.start();
      } catch {
        // Ignore start failures for missing/bad files to keep the UI stable.
      }
    });
  }

  private ramp(id: ClipId, targetLinear: number, seconds: number) {
    const gain = this.gains.get(id);
    if (!gain) return;
    const safeLinear = Math.max(0.00001, targetLinear);
    const targetDb = targetLinear <= 0.001 ? -72 : Tone.gainToDb(safeLinear);
    gain.gain.rampTo(Tone.dbToGain(targetDb), seconds);
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return fallback;
}

function isMusicId(id: ClipId): id is MusicId {
  return (
    id === "focusLow" || id === "focusMid" || id === "focusHigh" || id === "windDown"
  );
}

/**
 * Ramp a Tone.Player's playbackRate to a target value over `seconds`.
 * Newer Tone (v14+) exposes playbackRate as a Param with .rampTo;
 * older builds expose it as a plain number. Defensive in both directions.
 */
function rampPlaybackRate(player: Tone.Player, target: number, seconds: number): void {
  const rateParam = player.playbackRate as unknown;
  if (
    rateParam &&
    typeof (rateParam as { rampTo?: unknown }).rampTo === "function"
  ) {
    (rateParam as { rampTo: (v: number, t: number) => void }).rampTo(target, seconds);
    return;
  }
  player.playbackRate = target;
}

/**
 * Pick the single prebaked music clip that best matches the profile.
 *
 * Wind-down goal always wins — it's the calm sleep bed and shouldn't be
 * overridden by intensity. Otherwise the focus stack is selected by
 * intensity bucket. Hard cutovers between buckets (instead of crossfaded
 * overlaps) so we never play two beds at once.
 */
function selectMusicClip(profile: MoodProfile): MusicId {
  if (profile.goal.kind === "wind_down") return "windDown";
  const i = clamp01(profile.music.intensity);
  if (i < 0.34) return "focusLow";
  if (i < 0.67) return "focusMid";
  return "focusHigh";
}

