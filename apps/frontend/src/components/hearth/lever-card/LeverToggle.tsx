"use client";

import { motion } from "motion/react";
import { Lever } from "@/lib/hearth/schema";

type LeverToggleProps = {
  lever: Lever;
  value: boolean;
  onValueChange: (nextValue: boolean) => void;
};

export function LeverToggle({ lever, value, onValueChange }: LeverToggleProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#c9b582]">
          {lever.label}
        </span>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
            value ? "text-[#f5d895]" : "text-[#7a7565]/70"
          }`}
        >
          {value ? "On" : "Off"}
        </span>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={lever.label}
        onClick={() => onValueChange(!value)}
        className="relative h-[68px] w-[148px] overflow-hidden rounded-full border border-[#3b3a4d] bg-gradient-to-b from-[#0c1124] to-[#161b34] shadow-[inset_0_2px_6px_rgba(0,0,0,0.6),inset_0_-1px_0_rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e7c887]/60"
      >
        {/* filament glow when ON */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 h-[2px] rounded-full"
          animate={{
            opacity: value ? 1 : 0,
            background: value
              ? "linear-gradient(90deg,rgba(231,200,135,0) 0%, rgba(245,216,149,1) 50%, rgba(231,200,135,0) 100%)"
              : "transparent",
            boxShadow: value
              ? "0 0 18px rgba(245,216,149,0.85), 0 0 4px rgba(245,216,149,1)"
              : "none",
          }}
          transition={{ duration: 0.35 }}
        />

        {/* labels */}
        <span
          className={`absolute left-5 top-1/2 -translate-y-1/2 font-serif text-[15px] italic transition-colors ${
            value ? "text-[#f5ebcd]" : "text-[#52516a]"
          }`}
          style={{ fontVariationSettings: '"opsz" 144' }}
        >
          on
        </span>
        <span
          className={`absolute right-5 top-1/2 -translate-y-1/2 font-serif text-[15px] italic transition-colors ${
            !value ? "text-[#f5ebcd]" : "text-[#52516a]"
          }`}
          style={{ fontVariationSettings: '"opsz" 144' }}
        >
          off
        </span>

        {/* knob */}
        <motion.span
          aria-hidden
          className="absolute top-1/2 h-[54px] w-[54px] -translate-y-1/2 rounded-full border border-[#a98a3e]/70 shadow-[0_8px_22px_rgba(0,0,0,0.55),inset_0_2px_2px_rgba(255,235,200,0.5),inset_0_-3px_5px_rgba(0,0,0,0.4)]"
          animate={{
            left: value ? 88 : 6,
            background: value
              ? "radial-gradient(circle at 35% 30%, #fff1cd 0%, #e8c989 45%, #a07423 100%)"
              : "radial-gradient(circle at 35% 30%, #2a2c40 0%, #1a1d2f 60%, #0a0d1b 100%)",
          }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }}
        >
          <span
            aria-hidden
            className={`absolute inset-1 rounded-full transition-colors ${
              value ? "bg-[radial-gradient(circle_at_40%_35%,rgba(255,255,255,0.45),transparent_55%)]" : ""
            }`}
          />
        </motion.span>
      </button>

      {lever.description ? (
        <p className="text-center text-[11px] leading-snug text-[#a39d88]/85">
          {lever.description}
        </p>
      ) : null}
    </div>
  );
}
