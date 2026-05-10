"use client";

import { AnimatePresence, motion } from "motion/react";
import { Lever, LeverTier } from "@/lib/hearth/schema";
import { LeverSegmented } from "@/components/hearth/lever-card/LeverSegmented";
import { LeverSlider } from "@/components/hearth/lever-card/LeverSlider";
import { LeverToggle } from "@/components/hearth/lever-card/LeverToggle";

export type LeverValue = number | string | boolean;
export type LeverValueMap = Record<string, LeverValue | undefined>;

/**
 * Cost class of a lever drag — drives the tiny indicator dot in the corner
 * of each module so the user knows what their drag will cost before they
 * commit. Inferred from `bindTo` when `lever.tier` is omitted: `params.*`
 * and `music.aux.*` and `visual.*` patch the playing audio/visuals;
 * `music.promptForGen` triggers a Lyria refresh; an `outOfBoundsAt` arms
 * the regen trapdoor regardless of inferred tier.
 */
function inferTier(lever: Lever): LeverTier {
  if (lever.tier) return lever.tier;
  if (lever.bindTo === "music.promptForGen") return "refresh";
  if (
    lever.bindTo.startsWith("params.") ||
    lever.bindTo.startsWith("music.aux.") ||
    lever.bindTo.startsWith("visual.")
  ) {
    return "patch";
  }
  // Fields like music.bpm, music.intensity sit between patch and refresh:
  // call them refresh until the prompt-coupling story is firmer.
  return "refresh";
}

const TIER_DOT: Record<LeverTier, { color: string; title: string }> = {
  patch: {
    color: "#85ecce",
    title: "Patch — instant. Reshapes audio without reloading.",
  },
  refresh: {
    color: "#e7c887",
    title: "Refresh — fetches a new clip in the same genre.",
  },
  regen: {
    color: "#f08c7c",
    title: "Regen — sustained drag past the edge swaps the room.",
  },
};

type LeverCardProps = {
  title: string;
  note?: string;
  levers: Lever[];
  values: LeverValueMap;
  transitionKey: string;
  onValueChange: (lever: Lever, nextValue: LeverValue) => void;
  className?: string;
};

export function LeverCard({
  title,
  note,
  levers,
  values,
  transitionKey,
  onValueChange,
  className,
}: LeverCardProps) {
  return (
    <aside
      className={`relative w-full overflow-hidden rounded-[28px] text-[#f3efdf] ${className ?? ""}`}
      style={{
        background:
          "linear-gradient(160deg,rgba(18,21,42,0.92) 0%,rgba(10,13,28,0.94) 50%,rgba(22,17,32,0.92) 100%)",
        boxShadow:
          "0 30px 90px rgba(4,6,18,0.6),0 0 0 1px rgba(231,200,135,0.18),inset 0 1px 0 rgba(255,235,200,0.08)",
        backdropFilter: "blur(22px)",
      }}
    >
      {/* film grain */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.7'/></svg>\")",
        }}
      />
      {/* ambient warm glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[120%] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center,rgba(231,200,135,0.35),transparent 60%)",
        }}
      />

      {/* header */}
      <header className="relative flex items-end justify-between gap-6 px-7 pt-6 pb-4">
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#c9b582]/85">
            Console · agent assembled
          </p>
          <h2
            className="mt-2 font-serif text-[28px] italic leading-[1.05] tracking-tight text-[#f5ebcd]"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100' }}
          >
            {title}
          </h2>
        </div>
        <div className="hidden flex-col items-end gap-1.5 sm:flex">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block h-[3px] w-10 rounded-full"
              style={{
                background:
                  i === 0
                    ? "linear-gradient(90deg,#f5d895,#b6873a)"
                    : "rgba(231,200,135,0.18)",
              }}
            />
          ))}
        </div>
      </header>

      {note ? (
        <p className="relative mx-7 mb-3 border-l-2 border-[#e7c887]/30 pl-3 text-[12px] leading-relaxed text-[#c9c2ac]/85">
          {note}
        </p>
      ) : null}

      <div
        aria-hidden
        className="relative mx-7 my-3 h-px"
        style={{
          background:
            "linear-gradient(90deg,transparent,rgba(231,200,135,0.4),transparent)",
        }}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={transitionKey}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative grid grid-cols-1 gap-3 px-5 pb-6 pt-2 md:grid-cols-2"
        >
          {levers.map((lever, index) => (
            <ModuleFrame key={lever.id} lever={lever} index={index}>
              <LeverControl
                lever={lever}
                value={resolveValue(lever, values[lever.id])}
                onValueChange={(nextValue) => onValueChange(lever, nextValue)}
              />
            </ModuleFrame>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* footer status strip */}
      <footer className="relative flex items-center justify-between border-t border-[#e7c887]/10 px-7 py-3">
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.24em] text-[#7a7565]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#85ecce] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#85ecce]" />
          </span>
          live · {levers.length} modules
        </span>
        <span
          className="font-serif text-[11px] italic text-[#7a7565]/70"
          style={{ fontVariationSettings: '"opsz" 144' }}
        >
          push past the edge to regenerate
        </span>
      </footer>
    </aside>
  );
}

type ModuleFrameProps = {
  lever: Lever;
  index: number;
  children: React.ReactNode;
};

function ModuleFrame({ lever, index, children }: ModuleFrameProps) {
  const span = lever.kind === "segmented" ? "md:col-span-2" : "";
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.97 }}
      transition={{
        duration: 0.42,
        delay: index * 0.07,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={`relative overflow-hidden rounded-2xl border border-[#2a2e48] bg-[linear-gradient(160deg,rgba(13,17,36,0.85),rgba(8,11,24,0.92))] p-4 transition-colors hover:border-[#e7c887]/30 ${span}`}
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,235,200,0.05),inset 0 -1px 0 rgba(0,0,0,0.4),0 4px 12px rgba(0,0,0,0.35)",
      }}
    >
      {/* corner brackets */}
      <Bracket className="left-2 top-2" rotate={0} />
      <Bracket className="right-2 top-2" rotate={90} />
      <Bracket className="right-2 bottom-2" rotate={180} />
      <Bracket className="left-2 bottom-2" rotate={270} />
      <TierDot tier={inferTier(lever)} />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

function TierDot({ tier }: { tier: LeverTier }) {
  const { color, title } = TIER_DOT[tier];
  return (
    <span
      aria-label={title}
      title={title}
      className="pointer-events-none absolute right-3 top-3 z-10 flex h-1.5 w-1.5 items-center justify-center"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}aa` }}
      />
    </span>
  );
}

function Bracket({ className, rotate }: { className: string; rotate: number }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-3 w-3 ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <span className="absolute inset-0 border-l border-t border-[#e7c887]/45" />
    </span>
  );
}

type LeverControlProps = {
  lever: Lever;
  value: LeverValue;
  onValueChange: (nextValue: LeverValue) => void;
};

function LeverControl({ lever, value, onValueChange }: LeverControlProps) {
  if (lever.kind === "slider") {
    const numberValue = typeof value === "number" ? value : lever.range?.default ?? 0;
    return (
      <LeverSlider
        lever={lever}
        value={numberValue}
        onValueChange={(nextValue) => onValueChange(nextValue)}
      />
    );
  }

  if (lever.kind === "segmented") {
    const options = lever.options ?? [];
    const fallback = options[0]?.value ?? "";
    const stringValue = typeof value === "string" ? value : fallback;
    return (
      <LeverSegmented
        lever={lever}
        value={stringValue}
        onValueChange={(nextValue) => onValueChange(nextValue)}
      />
    );
  }

  // A toggle may bind to a numeric path (e.g. music.aux.rain ∈ [0,1]). The
  // store coerces bool → 0/1 on write; here we coerce non-zero / "1" / "true"
  // back to true on read so the toggle's UI state matches the audio state.
  const boolValue =
    typeof value === "boolean"
      ? value
      : typeof value === "number"
        ? value > 0
        : value === "true" || value === "1";
  return (
    <LeverToggle
      lever={lever}
      value={boolValue}
      onValueChange={(nextValue) => onValueChange(nextValue)}
    />
  );
}

function resolveValue(lever: Lever, value: LeverValue | undefined): LeverValue {
  if (value !== undefined) return value;
  if (lever.kind === "slider") return lever.range?.default ?? 0;
  if (lever.kind === "segmented") return lever.options?.[0]?.value ?? "";
  return false;
}
