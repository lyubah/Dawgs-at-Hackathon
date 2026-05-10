#!/usr/bin/env python3
"""Synthesize the 5 non-music audio files AudioEngine needs.

Two strategies:
  1. texture_rain.mp3 — Lyria 3 Clip Preview (real ambient, best quality).
  2. texture_brown_noise.mp3 + 3 SFX — numpy synthesis → WAV → MP3 via ffmpeg
     bundled in the imageio-ffmpeg pip wheel (no system ffmpeg needed).

This complements scripts/prebake-audio.py which generates the 4 music beds.
After both run, AudioEngine has all 9 files it expects.

Run from repo root:
    python3 scripts/prebake-sfx.py
"""
from __future__ import annotations

import base64
import io
import json
import struct
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt
import imageio_ffmpeg

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env"
OUT_DIR = REPO_ROOT / "apps" / "frontend" / "public" / "audio"

SR = 44100
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


# ----------------------------- env / lyria ---------------------------------


def read_first_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("GEMINI_API_KEYS="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            keys = [k.strip() for k in v.split(",") if k.strip()]
            return keys[0]
    sys.exit("GEMINI_API_KEYS not set")


def lyria_clip(api_key: str, prompt: str, retries: int = 3) -> bytes:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/lyria-3-clip-preview:generateContent?key={api_key}"
    )
    last = ""
    for attempt in range(retries):
        req = urllib.request.Request(
            url,
            data=json.dumps(
                {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseModalities": ["AUDIO"]},
                }
            ).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        body = json.loads(urllib.request.urlopen(req, timeout=120).read().decode())
        for cand in body.get("candidates", []):
            for part in cand.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("mimeType", "").startswith("audio/"):
                    return base64.b64decode(inline["data"])
            if cand.get("finishReason") == "OTHER":
                last = (cand.get("finishMessage") or "")[:120]
        if attempt + 1 < retries:
            print(f"    (filtered: {last[:60]}; retrying)", flush=True)
            time.sleep(1)
    raise RuntimeError(f"lyria filtered all {retries} attempts: {last}")


# ------------------------- audio synthesis helpers -------------------------


def write_wav_int16(arr: np.ndarray, path: Path) -> None:
    arr = np.clip(arr, -1.0, 1.0)
    wavfile.write(path, SR, (arr * 32767).astype(np.int16))


def wav_to_mp3(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        [FFMPEG, "-y", "-i", str(wav_path), "-codec:a", "libmp3lame",
         "-qscale:a", "3", str(mp3_path)],
        check=True,
        capture_output=True,
    )
    wav_path.unlink()


def fade(arr: np.ndarray, fade_s: float = 0.01) -> np.ndarray:
    n = int(SR * fade_s)
    if n * 2 >= len(arr):
        return arr
    env = np.ones_like(arr)
    env[:n] = np.linspace(0, 1, n)
    env[-n:] = np.linspace(1, 0, n)
    return arr * env


def crossfade_loop(arr: np.ndarray, xfade_s: float = 0.5) -> np.ndarray:
    """Make a buffer loop seamlessly by overlapping the head into the tail.

    Loops with abrupt edges click; an equal-power crossfade in the boundary
    zone hides the seam.
    """
    n = int(SR * xfade_s)
    if n * 2 >= len(arr):
        return arr
    out = arr.copy()
    a = out[:n]
    b = out[-n:]
    fade_in = np.sqrt(np.linspace(0, 1, n))
    fade_out = np.sqrt(np.linspace(1, 0, n))
    out[-n:] = b * fade_out + a * fade_in
    return out[:-n]


def low_pass(x: np.ndarray, cutoff_hz: float) -> np.ndarray:
    sos = butter(4, cutoff_hz / (SR / 2), btype="low", output="sos")
    return sosfiltfilt(sos, x)


# ---------------------- the five files we need to write -------------------


def synth_brown_noise() -> np.ndarray:
    """30s of brown noise. Random walk, low-passed, normalized, looped."""
    rng = np.random.default_rng(seed=20260509)
    white = rng.standard_normal(SR * 30)
    walk = np.cumsum(white)
    walk -= np.mean(walk)
    walk = low_pass(walk, 1500)
    walk /= np.max(np.abs(walk)) + 1e-9
    walk *= 0.7  # leave headroom
    return crossfade_loop(walk, 0.5)


def synth_lever_grab() -> np.ndarray:
    """200ms low click + decay — UI grab feedback."""
    dur = 0.2
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    click = np.sin(2 * np.pi * 380 * t) + 0.5 * np.sin(2 * np.pi * 760 * t)
    env = np.exp(-t * 28)
    return fade(0.6 * click * env, 0.005)


def synth_card_materialize() -> np.ndarray:
    """500ms ascending shimmer — 'thing appears'."""
    dur = 0.5
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    f = 600 * np.exp(t * 1.6)  # 600 -> ~3000 Hz over 0.5s
    sweep = np.sin(2 * np.pi * np.cumsum(f) / SR)
    shimmer = 0.3 * np.sin(2 * np.pi * f * 2.0 * t)
    env = np.where(t < 0.05, t / 0.05, np.exp(-(t - 0.05) * 4))
    return fade(0.45 * (sweep + shimmer) * env, 0.005)


def synth_chime_regen() -> np.ndarray:
    """1.2s bell hit with harmonics — regen 'mic-drop' chime."""
    dur = 1.2
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    f0 = 880  # A5 fundamental
    bell = (
        np.sin(2 * np.pi * f0 * t) * np.exp(-t * 2.5)
        + 0.6 * np.sin(2 * np.pi * f0 * 2.0 * t) * np.exp(-t * 4.0)
        + 0.4 * np.sin(2 * np.pi * f0 * 3.0 * t) * np.exp(-t * 5.5)
        + 0.2 * np.sin(2 * np.pi * f0 * 5.4 * t) * np.exp(-t * 8.0)
    )
    bell /= np.max(np.abs(bell)) + 1e-9
    return fade(0.5 * bell, 0.01)


# ---------------------------- pipeline -------------------------------------


def write_synth(name: str, arr: np.ndarray) -> None:
    wav_tmp = OUT_DIR / f".{name}.wav"
    mp3_out = OUT_DIR / f"{name}.mp3"
    write_wav_int16(arr.astype(np.float32), wav_tmp)
    wav_to_mp3(wav_tmp, mp3_out)
    size_kb = mp3_out.stat().st_size // 1024
    print(f"  [synth] {name}.mp3 ({size_kb} KB) — {len(arr) / SR:.1f}s", flush=True)


def write_lyria(api_key: str, name: str, prompt: str) -> None:
    out_path = OUT_DIR / f"{name}.mp3"
    print(f"  [lyria] {name}: generating ...", flush=True)
    t0 = time.time()
    mp3 = lyria_clip(api_key, prompt)
    out_path.write_bytes(mp3)
    print(
        f"  [lyria] {name}.mp3 ({len(mp3) // 1024} KB) in {time.time() - t0:.1f}s",
        flush=True,
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    api_key = read_first_key()
    print(f"writing 5 files → {OUT_DIR}", flush=True)
    print(f"using ffmpeg: {FFMPEG}", flush=True)

    # Lyria for rain — sounds dramatically more realistic than filtered noise.
    write_lyria(api_key, "texture_rain", "ambient rain texture seamless loop")

    # Synthesis for the rest (deterministic, exact what AudioEngine needs).
    write_synth("texture_brown_noise", synth_brown_noise())
    write_synth("sfx_lever_grab", synth_lever_grab())
    write_synth("sfx_card_materialize", synth_card_materialize())
    write_synth("sfx_chime_regen", synth_chime_regen())

    print("done.", flush=True)


if __name__ == "__main__":
    main()
