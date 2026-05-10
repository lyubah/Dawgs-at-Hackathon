"use client";

/**
 * Live music regeneration — closes the agentic loop on the audio side.
 *
 * The MoodProfile carries a `music.promptForGen` string the agent rewrites
 * every time it classifies (welcome) or regenerates (F-08 mic-drop or
 * chat-driven nudge). This module watches that field, calls the BFF Lyria
 * proxy on change, and hands the resulting MP3 to AudioEngine which
 * crossfades it in over the prebaked beds.
 *
 * Mounting:
 *  Call useMusicRegenWatcher(audioEngine, audioReady) once inside the
 *  component that owns the AudioEngine (app/page.tsx). The watcher takes
 *  no action until audioReady=true (browser autoplay policy means audio
 *  can't start before the user gestures).
 *
 * Why subscribe outside React's render tree:
 *  Same reason as outOfBounds.ts — the watcher fires from agent tool
 *  responses (state.profile mutations) which arrive on their own schedule.
 *  We use useHearthStore.subscribe and read promptForGen identity to
 *  trigger work on every legitimate change.
 *
 * Skipping the boot value:
 *  The store is seeded from sample-mood-profile.json. We never want to
 *  regen music for the sample value (which is the demo's prebaked default).
 *  The first applyProfile() the agent issues — even if its prompt happens
 *  to match the sample — is what we treat as "real". We track this with
 *  an `isFirstAgentApply` flag the agent-state bridge sets.
 */

import { useEffect, useRef } from "react";

import { useHearthStore } from "@/lib/hearth/store";
import type { MoodProfile } from "@/lib/hearth/schema";
import { recordTrace } from "@/lib/hearth/trace";
import type { AudioEngine } from "@/lib/hearth/audio/AudioEngine";

const BFF_URL =
  process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:4000";

async function fetchGenerativeClip(prompt: string): Promise<string> {
  const res = await fetch(`${BFF_URL}/api/hearth/music/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`bff music/generate ${res.status}: ${detail.slice(0, 200)}`);
  }
  const blob = await res.blob();
  const cacheStatus = res.headers.get("x-hearth-lyria-cache") ?? "?";
  const objectUrl = URL.createObjectURL(blob);
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[musicRegen] got clip (${(blob.size / 1024).toFixed(0)} KB, cache=${cacheStatus}) → ${objectUrl.slice(0, 50)}…`,
    );
  }
  return objectUrl;
}

/**
 * Subscribe to profile.music.promptForGen and trigger live regen on change.
 *
 * @param audioEngineRef  The AudioEngine instance (or a ref to it). Null
 *                         until the page mounts.
 * @param audioReady      True after the user clicks "Enable audio". Until
 *                         then we observe prompt changes but don't fetch.
 */
export function useMusicRegenWatcher(
  audioEngineRef: { current: AudioEngine | null },
  audioReady: boolean,
): void {
  const lastPromptRef = useRef<string | null>(null);
  const lastObjectUrlRef = useRef<string | null>(null);
  const inFlightRef = useRef<boolean>(false);

  useEffect(() => {
    if (!audioReady) return;

    const handlePromptChange = async (profile: MoodProfile) => {
      const nextPrompt = profile.music.promptForGen?.trim() ?? "";
      if (!nextPrompt) return;

      // Skip the first observed value — it's whatever was in the store at
      // mount, including the seeded sample. Real changes arrive after.
      if (lastPromptRef.current === null) {
        lastPromptRef.current = nextPrompt;
        return;
      }

      if (nextPrompt === lastPromptRef.current) return;
      lastPromptRef.current = nextPrompt;

      if (inFlightRef.current) {
        // A previous regen is still loading. Note it but skip — the latest
        // value will get picked up on the next change. We could queue, but
        // for the demo budget this single-flight policy avoids audio thrash.
        if (process.env.NODE_ENV !== "production") {
          console.log("[musicRegen] dropping change (in-flight)");
        }
        return;
      }
      inFlightRef.current = true;

      recordTrace({
        kind: "music.regen.start",
        label: "Music regen requested",
        detail: nextPrompt.slice(0, 120),
      });

      try {
        const url = await fetchGenerativeClip(nextPrompt);
        const engine = audioEngineRef.current;
        if (!engine) {
          URL.revokeObjectURL(url);
          return;
        }
        await engine.loadGenerative(url);

        // Revoke the previous object URL after the new one is decoded —
        // browsers keep the buffer alive while the AudioContext owns it.
        if (lastObjectUrlRef.current) {
          URL.revokeObjectURL(lastObjectUrlRef.current);
        }
        lastObjectUrlRef.current = url;

        recordTrace({
          kind: "music.regen.applied",
          label: "Music regen applied",
          detail: `crossfaded to ${(nextPrompt.slice(0, 60))}…`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn("[musicRegen] regen failed, keeping prebaked beds:", msg);
        recordTrace({
          kind: "music.regen.failed",
          label: "Music regen failed",
          detail: msg.slice(0, 200),
        });
      } finally {
        inFlightRef.current = false;
      }
    };

    // Run once on mount (locks lastPromptRef to current value), then sub.
    handlePromptChange(useHearthStore.getState().profile);
    const unsubscribe = useHearthStore.subscribe((store) =>
      handlePromptChange(store.profile),
    );

    return () => {
      unsubscribe();
    };
  }, [audioReady, audioEngineRef]);
}
