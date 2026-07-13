/**
 * Range15MCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 4: First 15M Range Engine — Premium institutional UI card
 * Placed inside TRADING ENGINE → ENGINES workspace.
 *
 * Consumes Layer 1 (Regime), Layer 2 (Breadth), Layer 3 (Heavyweight) outputs.
 * All data from existing dashboard state — no new APIs.
 */
import React, { useMemo, useEffect, useState, useRef } from "react";
import {
  computeRange15M,
  POSITION_META,
  QUALITY_META,
  type Range15MEngineInput,
  type Range15MResult,
} from "../../../engine/range15mEngine";
import type { MarketRegimeResult } from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult } from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult } from "../../../engine/heavyweightEngine";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface Range15MCardProps {
  activePage: string;
  spotPrice: number;
  rangeHigh: number;
  rangeLow: number;
  isFallback: boolean;
  regimeResult: MarketRegimeResult;
  breadthResult: MarketBreadthResult;
  heavyweightResult: HeavyweightResult;
}

// ── Animated Circular Gauge ───────────────────────────────────────────────────
function RangeGauge({
  value, label, size = 64, color, glow,
}: {
  value: number; label: string; size?: number; color: string; glow: string;
}) {
  const sw = 6;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const [offset, setOffset] = useState(circ);

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setOffset(circ - (Math.min(100, Math.max(0, value)) / 100) * circ)
    );
    return () => cancelAnimationFrame(id);
  }, [value, circ]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ filter: `drop-shadow(0 0 5px ${glow})` }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
        <text x={cx} y={cx + 2} textAnchor="middle" fill="white"
          fontSize="15" fontWeight="800" fontFamily="'Inter',sans-serif">
          {Math.round(value)}
        </text>
      </svg>
      <span className="text-sm font-black uppercase tracking-wider text-slate-500">{label}</span>
    </div>
  );
}

// ── Visual Range Bar ──────────────────────────────────────────────────────────
function RangeBar({ rangeHigh, rangeLow, spotPrice }: { rangeHigh: number; rangeLow: number; spotPrice: number }) {
  const width = rangeHigh - rangeLow;
  const barPadding = width * 0.3; // 30% padding above and below for display
  const displayMin = rangeLow - barPadding;
  const displayMax = rangeHigh + barPadding;
  const displayWidth = displayMax - displayMin;

  const rangeLowPct = displayWidth > 0 ? ((rangeLow - displayMin) / displayWidth) * 100 : 20;
  const rangeHighPct = displayWidth > 0 ? ((rangeHigh - displayMin) / displayWidth) * 100 : 80;
  const spotPct = displayWidth > 0
    ? Math.max(2, Math.min(98, ((spotPrice - displayMin) / displayWidth) * 100))
    : 50;

  const spotAbove = spotPrice > rangeHigh;
  const spotBelow = spotPrice < rangeLow;
  const spotColor = spotAbove ? "#10b981" : spotBelow ? "#ef4444" : "#f59e0b";

  return (
    <div className="relative w-full" style={{ height: 42 }}>
      {/* Background rail */}
      <div className="absolute left-0 right-0 top-[16px] h-[10px] rounded-full"
        style={{ background: "rgba(255,255,255,0.03)" }} />

      {/* Range zone */}
      <div className="absolute top-[16px] h-[10px] rounded-sm"
        style={{
          left: `${rangeLowPct}%`,
          width: `${rangeHighPct - rangeLowPct}%`,
          background: "linear-gradient(90deg, rgba(245,158,11,0.15), rgba(245,158,11,0.25), rgba(245,158,11,0.15))",
          border: "1px solid rgba(245,158,11,0.3)",
        }} />

      {/* Range Low label */}
      <div className="absolute text-sm font-mono font-bold text-red-400"
        style={{ left: `${rangeLowPct}%`, top: 30, transform: "translateX(-50%)" }}>
        {rangeLow.toFixed(0)}
      </div>

      {/* Range High label */}
      <div className="absolute text-sm font-mono font-bold text-emerald-400"
        style={{ left: `${rangeHighPct}%`, top: 30, transform: "translateX(-50%)" }}>
        {rangeHigh.toFixed(0)}
      </div>

      {/* Spot indicator */}
      <div className="absolute transition-all duration-500"
        style={{ left: `${spotPct}%`, top: 6, transform: "translateX(-50%)" }}>
        <div className="flex flex-col items-center">
          {/* Spot label */}
          <div className="text-sm font-black font-mono px-1 rounded"
            style={{ color: spotColor, background: "rgba(0,0,0,0.6)" }}>
            {spotPrice.toFixed(0)}
          </div>
          {/* Dot */}
          <div className="w-[6px] h-[6px] rounded-full animate-pulse mt-[1px]"
            style={{ background: spotColor, boxShadow: `0 0 6px ${spotColor}` }} />
          {/* Line */}
          <div className="w-[1px] h-[10px]" style={{ background: spotColor }} />
        </div>
      </div>
    </div>
  );
}

// ── Status Pill ───────────────────────────────────────────────────────────────
function StatusPill({ active, label, color, bgColor }: { active: boolean; label: string; color: string; bgColor: string }) {
  return (
    <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded transition-all ${
      active ? `${color} ${bgColor}` : "text-slate-600 bg-slate-800/30"
    }`}>
      {label}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const Range15MCard: React.FC<Range15MCardProps> = (props) => {
  const { activePage, spotPrice, rangeHigh, rangeLow, isFallback, regimeResult, breadthResult, heavyweightResult } = props;

  const result: Range15MResult = useMemo(() =>
    computeRange15M({
      spotPrice,
      rangeHigh,
      rangeLow,
      isFallback,
      regimeResult,
      breadthResult,
      heavyweightResult,
    }),
    [spotPrice, rangeHigh, rangeLow, isFallback, regimeResult, breadthResult, heavyweightResult]
  );

  const posMeta = POSITION_META[result.spotPosition];
  const qualMeta = QUALITY_META[result.rangeQuality];

  // Primary accent color based on overall status
  const accent =
    result.rangeBreakout  ? "#10b981" :
    result.rangeBreakdown ? "#ef4444" :
    result.falseBreakout  ? "#f97316" :
    "#f59e0b";

  const accentGlow =
    result.rangeBreakout  ? "rgba(16,185,129,0.15)" :
    result.rangeBreakdown ? "rgba(239,68,68,0.15)" :
    result.falseBreakout  ? "rgba(249,115,22,0.15)" :
    "rgba(245,158,11,0.08)";

  return (
    <div
      className="relative select-none overflow-hidden flex-shrink-0 rounded-xl"
      style={{
        background: "linear-gradient(135deg, #060a14 0%, #070c1a 60%, #050912 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 16px ${accentGlow}`,
      }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${accent}60 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ROW ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: accent }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-500">
              📊 FIRST 15M RANGE ENGINE · L4
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Position badge */}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded border ${posMeta.bgColor} ${posMeta.color} ${posMeta.borderColor}`}>
              {posMeta.emoji} {posMeta.label}
            </span>
            {/* Quality badge */}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded ${qualMeta.color}`}
              style={{ background: "rgba(255,255,255,0.04)" }}>
              {qualMeta.label}
            </span>
            {isFallback && (
              <span className="text-sm font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 animate-pulse">
                ESTIMATING
              </span>
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT ROW ────────────────────────────────────── */}
        <div className="flex items-stretch gap-3">

          {/* Col 1: Range Values */}
          <div className="flex flex-col justify-center gap-1.5 min-w-[100px]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black uppercase text-slate-600">Range High</span>
              <span className="text-base font-black font-mono text-emerald-400">
                {result.rangeHigh.toFixed(0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-black uppercase text-slate-600">Range Low</span>
              <span className="text-base font-black font-mono text-red-400">
                {result.rangeLow.toFixed(0)}
              </span>
            </div>
            <div className="h-[1px] bg-slate-800/40" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-black uppercase text-slate-600">Width</span>
              <span className="text-sm font-black font-mono text-slate-300">
                {result.rangeWidth.toFixed(0)} <span className="text-sm text-slate-500">({result.rangeWidthPct.toFixed(2)}%)</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-black uppercase text-slate-600">Spot</span>
              <span className={`text-base font-black font-mono ${posMeta.color}`}>
                {spotPrice.toFixed(0)}
              </span>
            </div>
          </div>

          {/* Col 2: Visual Range Bar */}
          <div className="flex flex-col justify-center flex-1 min-w-[150px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-1">Range Position</div>
            <RangeBar rangeHigh={result.rangeHigh} rangeLow={result.rangeLow} spotPrice={spotPrice} />
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-sm text-slate-600 font-mono">
                Dist: {result.distanceFromBoundary.toFixed(0)} pts ({result.distanceFromBoundaryPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Col 3: Breakout Status */}
          <div className="flex flex-col justify-center gap-1 min-w-[110px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">Breakout Status</div>
            <div className="flex flex-wrap gap-1">
              <StatusPill active={result.rangeBreakout} label="BREAKOUT" color="text-emerald-400" bgColor="bg-emerald-500/15" />
              <StatusPill active={result.rangeBreakdown} label="BREAKDOWN" color="text-red-400" bgColor="bg-red-500/15" />
              <StatusPill active={result.falseBreakout} label="FALSE B/O" color="text-orange-400" bgColor="bg-orange-500/15" />
              <StatusPill
                active={result.spotPosition === "INSIDE_RANGE" && !result.falseBreakout}
                label="RANGE"
                color="text-amber-400"
                bgColor="bg-amber-500/15"
              />
            </div>
            {result.breakoutDirection !== "NONE" && (
              <div className={`text-sm font-black mt-0.5 ${result.breakoutDirection === "BULLISH" ? "text-emerald-400" : "text-red-400"}`}>
                → {result.breakoutDirection} CONFIRMED
              </div>
            )}
          </div>

          {/* Col 4: Gauges */}
          <div className="flex items-center gap-3">
            <RangeGauge
              value={result.trendDayProbability}
              label="Trend Day"
              color={result.trendDayProbability >= 60 ? "#10b981" : result.trendDayProbability >= 30 ? "#f59e0b" : "#64748b"}
              glow={result.trendDayProbability >= 60 ? "rgba(16,185,129,0.12)" : "rgba(100,116,139,0.08)"}
            />
            <RangeGauge
              value={result.rangeConfidence}
              label="Confidence"
              color={result.rangeConfidence >= 65 ? "#10b981" : result.rangeConfidence >= 40 ? "#f59e0b" : "#ef4444"}
              glow={result.rangeConfidence >= 65 ? "rgba(16,185,129,0.12)" : "rgba(100,116,139,0.08)"}
            />
          </div>
        </div>

        {/* ── REASON STRIP ────────────────────────────────────────── */}
        {result.reasons.length > 0 && (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg border border-slate-800/30 bg-slate-900/20">
            <div className="text-sm text-slate-400 leading-tight">
              {result.reasons.slice(0, 3).join(" · ")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Range15MCard;

// ── Re-export for downstream layers ───────────────────────────────────────────
export type { Range15MResult, Range15MEngineInput };
export { computeRange15M, POSITION_META, QUALITY_META };

