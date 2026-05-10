"use client";

/**
 * F-12 — Hearth chat panel.
 *
 * Persistent right-rail chat surface using CopilotKit's headless
 * <CopilotChat />. Mounted only after the user has submitted a goal — the
 * welcome stage owns the full viewport so the centered dark input is the
 * single focal point. On entrance the panel slides in from the right edge,
 * matching the room's "console assembling itself" cadence.
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
 *
 * Visual: glassy navy backdrop + warm gold hairline border that matches
 * the LeverCard console — no more bland white panel against the dark room.
 */
import { CopilotChat } from "@copilotkit/react-core/v2";
import { motion } from "motion/react";

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
    <motion.aside
      initial={{ x: PANEL_WIDTH_PX, opacity: 0 }}
      animate={{ x: 0, opacity: dimmed ? 0.3 : 1 }}
      exit={{ x: PANEL_WIDTH_PX, opacity: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      whileHover={dimmed ? { opacity: 1 } : undefined}
      style={{ width: PANEL_WIDTH_PX }}
      className="hearth-chat-panel fixed top-0 right-0 z-40 flex h-screen flex-col border-l border-[#e7c887]/15 bg-[#0b0d18]/90 backdrop-blur-xl shadow-[-20px_0_60px_rgba(0,0,0,0.45)]"
    >
      {/* warm rim light */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-px"
        style={{
          background:
            "linear-gradient(180deg,transparent 0%,rgba(231,200,135,0.5) 30%,rgba(231,200,135,0.5) 70%,transparent 100%)",
        }}
      />
      <CopilotChat labels={LABELS} className="h-full" />
    </motion.aside>
  );
}
