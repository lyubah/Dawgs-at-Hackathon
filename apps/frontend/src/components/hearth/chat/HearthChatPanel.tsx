"use client";

/**
 * F-12 — Hearth chat panel.
 *
 * Persistent right-rail chat surface using CopilotKit's headless
 * <CopilotChat />. Always visible across all stages (welcome, transition,
 * room) so the user can keep nudging the Mood Architect at any moment —
 * no popup, no auto-close. The agent's frontend tools (updateLeverValue,
 * addLever, swapScene, regenerateMoodProfile) mean a sentence in chat
 * can drive the same store mutations a lever drag would, and the
 * music-regen watcher picks up the resulting promptForGen change.
 *
 * Layout:
 *  - Pinned to viewport right, full-height, fixed width.
 *  - Stage content (welcome / room) sits left of it. Welcome and
 *    transition are full-screen overlays drawn under the chat panel;
 *    the chat floats above them with its own background so input is
 *    reachable even before a goal is submitted.
 *
 * Idle behavior (F-15) lowers opacity but keeps pointer-events live so a
 * click into the chat re-engages the rest of the chrome.
 */
import { CopilotChat } from "@copilotkit/react-core/v2";

const PANEL_WIDTH_PX = 400;

const LABELS = {
  chatTitle: "Mood Architect",
  chatInputPlaceholder: "Tell the room what to do…",
  chatWelcomeTitle: "What kind of attention does this need?",
  chatWelcomeMessage:
    "Type how you'd describe the work, then keep nudging — 'less rain', 'more energy', 'wind me down'. The Mood Architect routes your words through frontend tools that move levers, swap scenes, and regenerate music.",
};

export function HearthChatPanel({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <aside
      style={{ width: PANEL_WIDTH_PX }}
      className={`fixed top-0 right-0 z-40 flex h-screen flex-col border-l border-white/10 bg-[#0b0d18]/85 backdrop-blur-xl transition-opacity duration-700 ${
        dimmed
          ? "opacity-30 hover:opacity-100 focus-within:opacity-100"
          : "opacity-100"
      }`}
    >
      <CopilotChat labels={LABELS} className="h-full" />
    </aside>
  );
}
