"use client";

/**
 * Hearth root — agent-driven generative room.
 *
 * Three stages, one composition:
 *  - welcome:    <WelcomeScreen> takes the user's goal text
 *  - transition: <CinematicTransition> holds while the agent classifies
 *                the goal and emits a MoodProfile via classify_mood_for_goal
 *                → MoodStateMiddleware → useAgentProfileBridge → store
 *  - room:       <HearthRoom> + <LeverCard>, both reading live from the
 *                Zustand store. Lever drags route through setLeverValue,
 *                which the OOB detector watches for the F-07/F-08 mic-drop.
 *
 * <HearthFrontendTools/> mounts the four CopilotKit frontend tools, the
 * out-of-bounds detector, the regen wiring, and the agent.state→store
 * bridge. Without it none of the agent's effects are visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";

import { HearthFrontendTools } from "@/components/copilot/hearth-tools";
import { HearthChatPanel } from "@/components/hearth/chat/HearthChatPanel";
import { GoalPill } from "@/components/hearth/goal-pill/GoalPill";
import { TracePanel } from "@/components/hearth/trace/TracePanel";
import { CinematicTransition } from "@/components/hearth/transition/CinematicTransition";
import { HearthRoom } from "@/components/hearth/room/HearthRoom";
import { WelcomeScreen } from "@/components/hearth/welcome/WelcomeScreen";
import {
  LeverCard,
  type LeverValue,
  type LeverValueMap,
} from "@/components/hearth/lever-card/LeverCard";
import { AudioEngine } from "@/lib/hearth/audio/AudioEngine";
import { useMusicRegenWatcher } from "@/lib/hearth/genui/musicRegen";
import { useIdle } from "@/lib/hearth/idle";
import { useHearthStore } from "@/lib/hearth/store";
import type { MoodProfile, Lever } from "@/lib/hearth/schema";

type Stage = "welcome" | "transition" | "room";

function buildLeverValues(profile: MoodProfile): LeverValueMap {
  const out: LeverValueMap = {};
  for (const lever of profile.levers) {
    const raw = readPath(profile, lever.bindTo);
    if (
      typeof raw === "number" ||
      typeof raw === "string" ||
      typeof raw === "boolean"
    ) {
      out[lever.id] = raw;
    }
  }
  return out;
}

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function HearthInner() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const idle = useIdle();

  const profile = useHearthStore((s) => s.profile);
  const setLeverValue = useHearthStore((s) => s.setLeverValue);

  const [stage, setStage] = useState<Stage>("welcome");
  const [goalText, setGoalText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  // Snapshot the profile reference at submit time so we can detect
  // when the agent has overwritten it (the bridge calls applyProfile
  // with a fresh object). Identity-compare is enough — Zustand always
  // returns a new object on applyProfile/setLeverValue.
  const submittedProfileRef = useRef<MoodProfile | null>(null);
  const isProfileReady = useMemo(() => {
    if (stage !== "transition") return false;
    return submittedProfileRef.current !== null && profile !== submittedProfileRef.current;
  }, [stage, profile]);

  const audioRef = useRef<AudioEngine | null>(null);
  useEffect(() => {
    audioRef.current = new AudioEngine();
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!audioReady) return;
    audioRef.current?.applyProfile(profile);
  }, [audioReady, profile]);

  // Live music regen: when the agent rewrites profile.music.promptForGen
  // (welcome classify, F-08 mic-drop, or a chat-driven nudge), this hook
  // calls the BFF Lyria proxy and crossfades the fresh clip into AudioEngine.
  useMusicRegenWatcher(audioRef, audioReady);

  const submitGoal = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !agent) return;
      submittedProfileRef.current = useHearthStore.getState().profile;
      setSubmitting(true);
      setStage("transition");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `msg-${Date.now()}`;
      agent.addMessage({ id, role: "user", content: trimmed });
      void copilotkit
        .runAgent({ agent })
        .catch((err: unknown) => {
          console.error("[Hearth] runAgent failed", err);
        })
        .finally(() => setSubmitting(false));
    },
    [agent, copilotkit],
  );

  const enableAudio = useCallback(async () => {
    if (audioReady) return;
    await audioRef.current?.init();
    setAudioReady(true);
    audioRef.current?.playSfx("cardMaterialize");
    audioRef.current?.applyProfile(profile);
  }, [audioReady, profile]);

  const leverValues = useMemo(() => buildLeverValues(profile), [profile]);

  const handleLeverChange = useCallback(
    (lever: Lever, nextValue: LeverValue) => {
      // LeverCard always emits LeverValue (number | string | boolean), but
      // the store only accepts number | string. Coerce booleans so toggle
      // levers still work.
      const normalized: number | string =
        typeof nextValue === "boolean" ? (nextValue ? 1 : 0) : nextValue;
      setLeverValue(lever.bindTo, normalized);
    },
    [setLeverValue],
  );

  // Use lever-set fingerprint as the LeverCard's transitionKey — when the
  // agent regens with a fresh lever set, AnimatePresence will crossfade.
  const leverFingerprint = useMemo(
    () => profile.levers.map((l) => l.id).join("|"),
    [profile.levers],
  );

  // ---------------- render ----------------

  return (
    <>
      <HearthFrontendTools />
      <GoalPill dimmed={idle} />
      <TracePanel dimmed={idle} />

      {stage === "welcome" && (
        <WelcomeScreen
          goalText={goalText}
          onGoalTextChange={setGoalText}
          onSubmitGoal={submitGoal}
          isSubmitting={submitting}
        />
      )}

      {stage === "transition" && (
        <CinematicTransition
          goalText={goalText}
          isProfileReady={isProfileReady}
          preview={
            <HearthRoom
              sceneId={profile.visual.sceneId}
              uniforms={profile.visual.uniforms}
              className="h-screen rounded-none border-0"
            />
          }
          onComplete={() => setStage("room")}
        />
      )}

      {stage === "room" && (
        <main
          // Right-rail (400px) reserved for the always-visible chat panel.
          // Within the playable area the room is a full-bleed backdrop and the
          // console floats centered above it instead of being pinned right.
          className="relative min-h-screen overflow-hidden bg-[#060914]"
          style={{ marginRight: 400 }}
        >
          <div className="absolute inset-0">
            <HearthRoom
              sceneId={profile.visual.sceneId}
              uniforms={profile.visual.uniforms}
              overlayTitle={`${profile.goal.kind.replace("_", " ")} · ${profile.goal.durationMin} min`}
              className="h-full rounded-none border-0"
            />
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
            style={{
              background:
                "linear-gradient(180deg,transparent 0%,rgba(6,9,20,0.55) 45%,rgba(6,9,20,0.92) 100%)",
            }}
          />

          <div className="relative z-10 flex min-h-screen flex-col items-center justify-end px-4 pb-8 pt-6">
            <div className="w-full max-w-[860px]">
              <LeverCard
                title={`For ${profile.goal.kind.replace("_", " ")}`}
                note="Push a lever past its comfort range and the room regenerates."
                levers={profile.levers}
                values={leverValues}
                transitionKey={leverFingerprint}
                onValueChange={handleLeverChange}
              />
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {!audioReady && (
                  <button
                    type="button"
                    onClick={enableAudio}
                    className="rounded-full border border-[#e7c887]/50 bg-[#100f16]/72 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#f5ebcd] backdrop-blur-xl transition-colors hover:border-[#e7c887] hover:text-[#fff7d9]"
                  >
                    ▶ Enable audio
                  </button>
                )}
                <button
                  type="button"
                  disabled={!agent}
                  onClick={() => {
                    if (!agent) return;
                    const id =
                      typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? crypto.randomUUID()
                        : `regen-${Date.now()}`;
                    agent.addMessage({
                      id,
                      role: "user",
                      content:
                        "Regenerate the room: user requested fresh music — vary the prompt and emit a new MoodProfile.",
                    });
                    void copilotkit
                      .runAgent({ agent })
                      .catch((err: unknown) => {
                        console.error("[Hearth] regen-music runAgent failed", err);
                      });
                  }}
                  className="rounded-full border border-fuchsia-400/40 bg-fuchsia-950/40 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-fuchsia-100 backdrop-blur-xl transition-colors hover:border-fuchsia-300 hover:text-fuchsia-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ↻ Regenerate music
                </button>
              </div>
            </div>
          </div>
        </main>
      )}

      <HearthChatPanel dimmed={idle} />
    </>
  );
}

export default function HearthPage() {
  return (
    <CopilotChatConfigurationProvider agentId="default" threadId={undefined}>
      <HearthInner />
    </CopilotChatConfigurationProvider>
  );
}
