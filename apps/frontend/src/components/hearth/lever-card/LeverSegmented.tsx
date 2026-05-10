"use client";

import { motion } from "motion/react";
import { Lever } from "@/lib/hearth/schema";

type LeverSegmentedProps = {
  lever: Lever;
  value: string;
  onValueChange: (nextValue: string) => void;
};

export function LeverSegmented({
  lever,
  value,
  onValueChange,
}: LeverSegmentedProps) {
  if (!lever.options?.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex w-full items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#c9b582]">
          {lever.label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7a7565]/70">
          {lever.options.length} modes
        </span>
      </div>

      <div className="flex gap-1.5 rounded-2xl border border-[#3b3a4d] bg-[#0d1124]/80 p-1.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.55)]">
        {lever.options.map((option) => {
          const isActive = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onValueChange(option.value)}
              className="group relative flex-1 overflow-hidden rounded-xl px-2 py-2.5 text-center focus-visible:outline-none"
              aria-pressed={isActive}
            >
              {isActive && (
                <motion.span
                  layoutId={`segment-${lever.id}`}
                  aria-hidden
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background:
                      "linear-gradient(180deg,#f5d895 0%,#e7c887 50%,#b6873a 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,247,217,0.6), inset 0 -2px 6px rgba(110,75,18,0.45), 0 6px 16px rgba(231,200,135,0.18)",
                  }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span
                className={`relative font-serif text-[14px] italic tracking-tight transition-colors ${
                  isActive ? "text-[#2a210f]" : "text-[#bcb59c] group-hover:text-[#f5ebcd]"
                }`}
                style={{ fontVariationSettings: '"opsz" 144' }}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>

      {lever.description ? (
        <p className="text-[11px] leading-snug text-[#a39d88]/85">
          {lever.description}
        </p>
      ) : null}
    </div>
  );
}
