"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Lever } from "@/lib/hearth/schema";

type LeverSliderProps = {
  lever: Lever;
  value: number;
  onValueChange: (nextValue: number) => void;
};

const SWEEP_DEG = 270;
const HALF = SWEEP_DEG / 2;
const SIZE = 148;
const RADIUS = 56;
const STROKE = 8;
const CENTER = SIZE / 2;
const TICKS = 18;

export function LeverSlider({ lever, value, onValueChange }: LeverSliderProps) {
  if (!lever.range) return null;

  const { min, max, step } = lever.range;
  const span = Math.max(max - min, 1e-6);
  const t = clamp01((value - min) / span);
  const angle = -HALF + t * SWEEP_DEG;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const node = svgRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const clamped = Math.max(-HALF, Math.min(HALF, deg));
      const nextT = (clamped + HALF) / SWEEP_DEG;
      let next = min + nextT * span;
      if (step) next = Math.round(next / step) * step;
      next = Math.max(min, Math.min(max, next));
      onValueChange(next);
    },
    [max, min, onValueChange, span, step],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateFromPointer(e.clientX, e.clientY);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, updateFromPointer]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    setDragging(true);
    updateFromPointer(e.clientX, e.clientY);
  };

  const trackPath = describeArc(CENTER, CENTER, RADIUS, -HALF, HALF);
  const fillPath = describeArc(CENTER, CENTER, RADIUS, -HALF, angle);
  const handle = pointOnCircle(CENTER, CENTER, RADIUS, angle);
  const decimals = step && step < 1 ? 2 : 0;
  const display = Number.isFinite(value) ? value.toFixed(decimals) : "—";

  return (
    <div className="group relative flex flex-col items-center gap-3">
      <div className="flex w-full items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#c9b582]">
          {lever.label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#7a7565]/80">
          {min}/{max}
        </span>
      </div>

      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-3 rounded-full bg-[radial-gradient(circle_at_center,rgba(231,200,135,0.28),transparent_70%)] blur-md transition-opacity duration-500"
          style={{ opacity: 0.35 + 0.55 * t }}
        />
        <svg
          ref={svgRef}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          onPointerDown={onPointerDown}
          role="slider"
          aria-label={lever.label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          tabIndex={0}
          onKeyDown={(e) => {
            const inc = step ?? (max - min) / 50;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              onValueChange(Math.min(max, value + inc));
            }
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              onValueChange(Math.max(min, value - inc));
            }
          }}
          className="relative cursor-grab touch-none select-none focus-visible:outline-none active:cursor-grabbing"
        >
          {/* tick ring */}
          {Array.from({ length: TICKS + 1 }).map((_, i) => {
            const tickAngle = -HALF + (i / TICKS) * SWEEP_DEG;
            const long = i % 3 === 0;
            const inner = pointOnCircle(CENTER, CENTER, RADIUS + 8, tickAngle);
            const outer = pointOnCircle(
              CENTER,
              CENTER,
              RADIUS + (long ? 14 : 11),
              tickAngle,
            );
            const passed = tickAngle <= angle + 0.01;
            return (
              <line
                key={i}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke={passed ? "#e7c887" : "#3a3b50"}
                strokeWidth={long ? 1.5 : 1}
                strokeLinecap="round"
                opacity={passed ? 0.95 : 0.55}
              />
            );
          })}

          {/* base track */}
          <path
            d={trackPath}
            fill="none"
            stroke="#1d2236"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
          {/* fill arc */}
          <path
            d={fillPath}
            fill="none"
            stroke="url(#dial-gold)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />

          {/* inner bezel */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS - 12}
            fill="url(#dial-glass)"
            stroke="rgba(231,200,135,0.18)"
            strokeWidth={1}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS - 12}
            fill="none"
            stroke="rgba(0,0,0,0.45)"
            strokeWidth={1}
            transform={`translate(0 1)`}
          />

          {/* handle dot */}
          <circle
            cx={handle.x}
            cy={handle.y}
            r={6}
            fill="#f5ebcd"
            stroke="#a98a3e"
            strokeWidth={1.5}
          />

          <defs>
            <linearGradient id="dial-gold" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#f5d895" />
              <stop offset="55%" stopColor="#e7c887" />
              <stop offset="100%" stopColor="#b6873a" />
            </linearGradient>
            <radialGradient id="dial-glass" cx="0.45" cy="0.4" r="0.7">
              <stop offset="0%" stopColor="#1c2236" />
              <stop offset="100%" stopColor="#0a0e1c" />
            </radialGradient>
          </defs>
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            key={display}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="font-serif text-[28px] italic leading-none tracking-tight text-[#f5ebcd]"
            style={{ fontVariationSettings: '"opsz" 144' }}
          >
            {display}
          </motion.span>
          <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#9b9377]/80">
            {Math.round(t * 100)}%
          </span>
        </div>
      </div>

      {lever.description ? (
        <p className="text-center text-[11px] leading-snug text-[#a39d88]/85">
          {lever.description}
        </p>
      ) : null}
    </div>
  );
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function pointOnCircle(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
) {
  const start = pointOnCircle(cx, cy, r, startDeg);
  const end = pointOnCircle(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const direction = sweep >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${direction} ${end.x} ${end.y}`;
}
