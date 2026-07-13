/**
 * MomentumCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 6: Momentum Engine v2 — Premium Institutional UI Card
 *
 * Placed inside TRADING ENGINE → ENGINES workspace below Layer 5.
 *
 * Consumes Layer 1–5 engine results.
 * Data flows: Engines.tsx computes all upstream results → passes to this card.
 */
import React, { useMemo, useEffect, useState, useRef } from "react";
import {
  computeMomentum,
  MOMENTUM_DIRECTION_META,
  MOMENTUM_GRADE_META,
  type MomentumEngineInput,
  type MomentumEngineOutput,
  type MomentumDirection,
  type MomentumGrade,
} from "../../../engine/momentumEngine";
import type { MarketRegimeResult }       from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult }       from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }         from "../../../engine/heavyweightEngine";
import type { Range15MResult }            from "../../../engine/range15mEngine";
import type { OptionChainEngineOutput }   from "../../../engine/optionChainEngine";

// ── Props ──────────────────────────────────────────────────────────────────────
export interface MomentumCardProps {
  activePage: string;
  /** Overall index score (sum of all constituent scores) */
  overallScore: number;
  /** 5M net score change */
  scoreDifference: number;
  /** 15M net score change */
  score15mDiff: number;
  /** 30M net score change */
  score30mDiff: number;
  /** 1H net score change */
  score1hDiff: number;
  /** Spot % change from prev close */
  changePercent: number;
  /** Total volume across all stocks */
  volume: number;
  /** Optional average volume */
  avgVolume?: number;

  regimeResult:       MarketRegimeResult;
  breadthResult:      MarketBreadthResult;
  heavyweightResult?: HeavyweightResult;
  range15mResult?:    Range15MResult;
  optionChainResult?: OptionChainEngineOutput;
}

// ── Animated Momentum Arc ──────────────────────────────────────────────────────
function MomentumArc({
  score,
  direction,
}: {
  score: number;
  direction: MomentumDirection;
}) {
  const size = 76;
  const sw = 7;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const [offset, setOffset] = useState(circ);

  const arcColor =
    direction === "BULLISH" ? "#10b981" :
    direction === "BEARISH" ? "#ef4444" : "#f59e0b";

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setOffset(circ - (clamp01(score / 100)) * circ)
    );
    return () => cancelAnimationFrame(id);
  }, [score, circ]);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ filter: `drop-shadow(0 0 7px ${arcColor}80)` }}>
      {/* Background track */}
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
      {/* Animated arc */}
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke={arcColor} strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }}
      />
      {/* Score text */}
      <text x={cx} y={cx + 1} textAnchor="middle" fill="white"
        fontSize="18" fontWeight="900" fontFamily="'Inter',sans-serif">
        {Math.round(score)}
      </text>
      <text x={cx} y={cx + 14} textAnchor="middle" fill="rgba(148,163,184,0.7)"
        fontSize="6" fontWeight="700" fontFamily="'Inter',sans-serif" letterSpacing="0.08em">
        MOMENTUM
      </text>
    </svg>
  );
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

// ── Live Acceleration Ticker ───────────────────────────────────────────────────
function AccelTicker({ value }: { value: number }) {
  const abs = Math.abs(value);
  const isPos = value >= 0;
  const color = isPos ? "#10b981" : "#ef4444";
  const barW = Math.min(abs * 2, 100);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-black uppercase tracking-wider text-slate-600">Acceleration</span>
        <span className="text-sm font-black font-mono" style={{ color }}>
          {isPos ? "+" : ""}{value.toFixed(1)} {isPos ? "🚀" : "⚠"}
        </span>
      </div>
      <div className="h-[5px] w-full rounded-full bg-slate-800/60 overflow-hidden relative">
        <div className="absolute left-1/2 top-0 w-[1px] h-full bg-slate-600/60 z-10" />
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-700"
          style={{
            width: `${barW / 2}%`,
            [isPos ? "left" : "right"]: "50%",
            background: color,
          }}
        />
      </div>
    </div>
  );
}

// ── Volume Bar ────────────────────────────────────────────────────────────────
function VolumeBar({ conviction }: { conviction: number }) {
  const label = conviction >= 25 ? "HIGH CONVICTION" : conviction >= 15 ? "MODERATE" : "LOW";
  const color  = conviction >= 25 ? "#10b981" : conviction >= 15 ? "#f59e0b" : "#64748b";
  const pct    = conviction >= 25 ? 100 : conviction >= 15 ? 60 : 20;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-black uppercase tracking-wider text-slate-600">Volume Conviction</span>
        <span className="text-sm font-black" style={{ color }}>{label}</span>
      </div>
      <div className="h-[5px] w-full rounded-full bg-slate-800/60 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ── Influence Bar ─────────────────────────────────────────────────────────────
function InfluenceBar({
  label, value, maxAbs,
}: { label: string; value: number; maxAbs: number }) {
  const pct = Math.abs(value) / maxAbs * 100;
  const isPos = value >= 0;
  const color = isPos ? "#10b981" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-slate-500 w-[65px] truncate font-semibold">{label}</span>
      <div className="flex-1 h-[4px] rounded-full bg-slate-800/60 overflow-hidden relative">
        <div className="absolute left-1/2 top-0 w-[1px] h-full bg-slate-600/50 z-10" />
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct / 2}%`,
            [isPos ? "left" : "right"]: "50%",
            background: color,
          }}
        />
      </div>
      <span className="text-sm font-mono w-7 text-right font-bold"
        style={{ color }}>{isPos ? "+" : ""}{value}</span>
    </div>
  );
}

// ── Timeline Sparkline ────────────────────────────────────────────────────────
function TimelineBar({
  label, value, maxAbs,
}: { label: string; value: number; maxAbs: number }) {
  const pct = Math.min(Math.abs(value) / (maxAbs || 1), 1) * 100;
  const isPos = value >= 0;
  const color = isPos ? "#10b981" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-slate-600 w-5 font-bold">{label}</span>
      <div className="flex-1 h-[4px] rounded-full bg-slate-800/60 overflow-hidden relative">
        <div className="absolute left-1/2 top-0 w-[1px] h-full bg-slate-600/40 z-10" />
        <div className="absolute top-0 h-full rounded-full transition-all duration-700"
          style={{ width: `${pct / 2}%`, [isPos ? "left" : "right"]: "50%", background: color }} />
      </div>
      <span className={`text-sm font-mono w-8 text-right font-bold ${isPos ? "text-emerald-400" : "text-red-400"}`}>
        {isPos ? "+" : ""}{value.toFixed(0)}
      </span>
    </div>
  );
}

// ── Exhaustion Warning ────────────────────────────────────────────────────────
function ExhaustionBadge({ type }: { type: "bullish" | "bearish" }) {
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-sm font-black uppercase animate-pulse ${
      type === "bullish"
        ? "bg-orange-500/15 border-orange-500/40 text-orange-400"
        : "bg-purple-500/15 border-purple-500/40 text-purple-400"
    }`}>
      ⚠ {type === "bullish" ? "BULL EXHAUSTION" : "BEAR EXHAUSTION"}
    </div>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────
const MomentumCard: React.FC<MomentumCardProps> = (props) => {
  const {
    activePage, overallScore, scoreDifference, score15mDiff,
    score30mDiff, score1hDiff, changePercent, volume, avgVolume,
    regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult,
  } = props;

  // Track previous scoreDifference for acceleration delta
  const prevScoreDiffRef = useRef<number>(scoreDifference);
  useEffect(() => {
    const id = setTimeout(() => {
      prevScoreDiffRef.current = scoreDifference;
    }, 5000); // update every 5s
    return () => clearTimeout(id);
  }, [scoreDifference]);

  const result: MomentumEngineOutput = useMemo(() =>
    computeMomentum({
      overallScore,
      scoreDifference,
      score15mDiff,
      score30mDiff,
      score1hDiff,
      changePercent,
      volume,
      avgVolume,
      prevScoreDifference: prevScoreDiffRef.current,
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
    }),
    [
      overallScore, scoreDifference, score15mDiff, score30mDiff, score1hDiff,
      changePercent, volume, avgVolume, regimeResult, breadthResult,
      heavyweightResult, range15mResult, optionChainResult,
    ]
  );

  const dirMeta   = MOMENTUM_DIRECTION_META[result.momentumDirection];
  const gradeMeta = MOMENTUM_GRADE_META[result.momentumGrade];

  const scoreColor =
    result.momentumScore >= 65 ? "#10b981" :
    result.momentumScore >= 55 ? "#34d399" :
    result.momentumScore >= 45 ? "#f59e0b" :
    result.momentumScore >= 35 ? "#f97316" : "#ef4444";

  const maxInfluenceAbs = 25;

  return (
    <div
      className="relative select-none overflow-hidden flex-shrink-0 rounded-xl"
      style={{
        background: "linear-gradient(135deg, #05080f 0%, #060c18 55%, #050a11 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 22px ${dirMeta.glowColor}`,
      }}
    >
      {/* Animated top accent line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${scoreColor}70 50%, transparent 95%)`,
      }} />

      {/* Fresh momentum pulse overlay */}
      {result.freshMomentumDetected && (
        <div className="absolute inset-0 pointer-events-none rounded-xl"
          style={{ boxShadow: "inset 0 0 30px rgba(16,185,129,0.08)" }}
        />
      )}

      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: scoreColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-500">
              ⚡ MOMENTUM ENGINE · L6
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Exhaustion badges */}
            {result.exhaustion.bullish && <ExhaustionBadge type="bullish" />}
            {result.exhaustion.bearish && <ExhaustionBadge type="bearish" />}
            {/* Fresh momentum badge */}
            {result.freshMomentumDetected && (
              <span className="text-sm font-black uppercase px-1.5 py-0.5 rounded border bg-emerald-500/20 text-emerald-300 border-emerald-500/50 animate-pulse">
                🚀 FRESH MOMENTUM
              </span>
            )}
            {/* Direction badge */}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded border ${dirMeta.bgColor} ${dirMeta.color} ${dirMeta.borderColor}`}>
              {dirMeta.emoji} {result.momentumDirection}
            </span>
            {/* Grade badge */}
            <span className={`text-sm font-black px-2 py-0.5 rounded font-mono ${gradeMeta.bg} ${gradeMeta.color}`}>
              {result.momentumGrade} — {gradeMeta.label}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <div className="flex items-stretch gap-4 flex-wrap xl:flex-nowrap">

          {/* Col 1: Momentum Arc */}
          <div className="flex flex-col items-center justify-center gap-1 min-w-[76px]">
            <MomentumArc score={result.momentumScore} direction={result.momentumDirection} />
          </div>

          {/* Col 2: Speed Gauges */}
          <div className="flex flex-col justify-center gap-2 min-w-[150px] flex-1">
            <AccelTicker value={result.acceleration} />
            <VolumeBar conviction={result.volumeConviction} />

            {/* Momentum Timeline */}
            <div className="mt-1">
              <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
                Score Timeline
              </div>
              <div className="flex flex-col gap-0.5">
                <TimelineBar label="5M"  value={scoreDifference} maxAbs={100} />
                <TimelineBar label="15M" value={score15mDiff}    maxAbs={100} />
                <TimelineBar label="30M" value={score30mDiff}    maxAbs={100} />
                <TimelineBar label="1H"  value={score1hDiff}     maxAbs={100} />
              </div>
            </div>
          </div>

          {/* Col 3: Layer Influences */}
          <div className="flex flex-col justify-center gap-1.5 min-w-[150px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
              Layer Alignment
            </div>
            <InfluenceBar label="Range (L4)"   value={result.rangeInfluence}       maxAbs={maxInfluenceAbs} />
            <InfluenceBar label="Option (L5)"  value={result.optionChainInfluence} maxAbs={maxInfluenceAbs} />
            <InfluenceBar label="Breadth (L2)" value={result.breadthInfluence}     maxAbs={15} />

            {/* Summary Alignment Row */}
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              {[
                { label: "L1", ok: regimeResult.regime === "TRENDING_BULL" || regimeResult.regime === "BREAKOUT" },
                { label: "L2", ok: breadthResult.breadthBias === "BULLISH" },
                { label: "L3", ok: heavyweightResult?.heavyweightDirection === "BULLISH" || heavyweightResult?.heavyweightDirection === "STRONG_BULLISH" },
                { label: "L4", ok: range15mResult?.rangeBreakout === true },
                { label: "L5", ok: optionChainResult?.institutionalBias === "BULLISH" },
              ].map(({ label, ok }) => (
                <span key={label} className={`text-sm font-black px-1 py-0.5 rounded ${
                  ok
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-slate-800/60 text-slate-600 border border-slate-700/30"
                }`}>
                  {ok ? "✓" : "✗"} {label}
                </span>
              ))}
            </div>
          </div>

          {/* Col 4: Score Decomposition */}
          <div className="flex flex-col justify-center min-w-[150px] gap-1">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
              Score Decomposition
            </div>
            {[
              { label: "Core (40%)",   v: result.components.momentumCore        },
              { label: "Accel (30%)",  v: result.components.accelerationContrib },
              { label: "Volume",       v: result.components.volumeContrib       },
              { label: "Range",        v: result.components.rangeContrib        },
              { label: "Option",       v: result.components.optionContrib       },
              { label: "Breadth",      v: result.components.breadthContrib      },
            ].map(({ label, v }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="text-sm text-slate-500 w-[60px] font-semibold">{label}</span>
                <div className="flex-1 h-[4px] rounded-full bg-slate-800/60 overflow-hidden relative">
                  <div className="absolute left-1/2 top-0 w-[1px] h-full bg-slate-600/40 z-10" />
                  <div
                    className="absolute top-0 h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(Math.abs(v) * 2, 50)}%`,
                      [v >= 0 ? "left" : "right"]: "50%",
                      background: v >= 0 ? "#10b981" : "#ef4444",
                    }}
                  />
                </div>
                <span className={`text-sm font-mono w-8 text-right font-bold ${v >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {v >= 0 ? "+" : ""}{v.toFixed(1)}
                </span>
              </div>
            ))}

            {/* Final score summary */}
            <div className="mt-1 pt-1 border-t border-slate-800/30 flex items-center justify-between">
              <span className="text-sm text-slate-600 font-semibold">Composite</span>
              <span className="text-base font-black font-mono" style={{ color: scoreColor }}>
                {result.momentumScore}/100
              </span>
            </div>
          </div>
        </div>

        {/* ── REASON STRIP ─────────────────────────────────────────────── */}
        {result.reasoning.length > 0 && (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg border border-slate-800/30 bg-slate-900/20">
            <div className="text-sm text-slate-400 leading-relaxed">
              {result.reasoning.slice(0, 3).join("  ·  ")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MomentumCard;

// ── Re-export types for downstream layers ────────────────────────────────────
export type { MomentumEngineOutput, MomentumEngineInput };
export { computeMomentum, MOMENTUM_DIRECTION_META, MOMENTUM_GRADE_META };

