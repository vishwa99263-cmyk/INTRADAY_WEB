/**
 * OptionChainCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 5: Option Chain Engine — Premium Institutional UI Card
 *
 * Placed inside TRADING ENGINE → ENGINES workspace below Layer 4.
 *
 * Consumes Layer 1 (Regime), Layer 2 (Breadth), Layer 3 (Heavyweight, optional),
 * Layer 4 (Range, optional) outputs + raw OptionStrike[] data.
 */
import React, { useMemo, useEffect, useState } from "react";
import {
  computeOptionChain,
  BIAS_META,
  OI_STATUS_META,
  type OptionChainEngineOutput,
  type OIStrikeData,
} from "../../../engine/optionChainEngine";
import type { MarketRegimeResult } from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult } from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }   from "../../../engine/heavyweightEngine";
import type { Range15MResult }       from "../../../engine/range15mEngine";

// ── Props ──────────────────────────────────────────────────────────────────────
export interface OptionChainCardProps {
  activePage: string;
  spotPrice: number;
  optionChain: {
    strikePrice: number;
    ceOI: number;
    ceOIChange: number;
    ceVolume: number;
    peOI: number;
    peOIChange: number;
    peVolume: number;
  }[];
  regimeResult: MarketRegimeResult;
  breadthResult: MarketBreadthResult;
  heavyweightResult?: HeavyweightResult;
  range15mResult?: Range15MResult;
}

// ── Animated PCR Arc ──────────────────────────────────────────────────────────
function PCRArc({ pcr, score }: { pcr: number; score: number }) {
  const size = 72;
  const sw = 7;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const [offset, setOffset] = useState(circ);

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setOffset(circ - (Math.min(100, Math.max(0, score)) / 100) * circ)
    );
    return () => cancelAnimationFrame(id);
  }, [score, circ]);

  const arcColor =
    score >= 65 ? "#10b981" :
    score >= 55 ? "#34d399" :
    score >= 45 ? "#f59e0b" :
    score >= 35 ? "#f97316" : "#ef4444";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ filter: `drop-shadow(0 0 6px ${arcColor}60)` }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={arcColor} strokeWidth={sw}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
      <text x={cx} y={cx - 4} textAnchor="middle" fill="white"
        fontSize="14" fontWeight="800" fontFamily="'Inter',sans-serif">{pcr.toFixed(2)}</text>
      <text x={cx} y={cx + 9} textAnchor="middle" fill="rgba(148,163,184,0.8)"
        fontSize="6.5" fontWeight="700" fontFamily="'Inter',sans-serif">PCR</text>
    </svg>
  );
}

// ── OI Score Gauge bar ─────────────────────────────────────────────────────────
function ScoreBar({ label, score, maxScore }: { label: string; score: number; maxScore: number }) {
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const color = pct >= 65 ? "#10b981" : pct >= 45 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-slate-500 w-[90px] truncate font-semibold">{label}</span>
      <div className="flex-1 h-[5px] rounded-full bg-slate-800/60 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-sm font-mono w-6 text-right font-bold text-slate-400">{score}</span>
    </div>
  );
}

// ── OI Wall Pill ──────────────────────────────────────────────────────────────
function WallPill({ label, strike, strength, type }: {
  label: string; strike: number; strength: number; type: "CALL" | "PUT"
}) {
  const isCall = type === "CALL";
  const color  = isCall ? "text-red-400"     : "text-emerald-400";
  const bg     = isCall ? "bg-red-500/10"    : "bg-emerald-500/10";
  const border = isCall ? "border-red-500/30" : "border-emerald-500/30";
  return (
    <div className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border ${bg} ${border}`}>
      <span className={`text-sm font-black uppercase tracking-wider ${color}`}>{label}</span>
      <span className="text-base font-black text-white font-mono">{strike.toLocaleString()}</span>
      <span className="text-sm text-slate-500 font-mono">{strength}% strength</span>
    </div>
  );
}

// ── OI Writing Badge ──────────────────────────────────────────────────────────
function WritingBadge({ label, status, value, type }: {
  label: string; status: "WRITING" | "UNWINDING" | "NEUTRAL"; value: number; type: "CE" | "PE"
}) {
  const meta = OI_STATUS_META[status];
  const isCE = type === "CE";
  return (
    <div className="flex items-center justify-between gap-1 py-0.5">
      <span className={`text-sm font-black ${isCE ? "text-red-400" : "text-emerald-400"}`}>{label}</span>
      <span className={`text-sm font-bold ${meta.color}`}>{meta.emoji} {meta.label}</span>
      <span className="text-sm font-mono text-slate-400 text-right">
        {value > 0 ? "+" : ""}{(value / 100000).toFixed(3)}L
      </span>
    </div>
  );
}

// ── Liquidity Zone Strip ───────────────────────────────────────────────────────
interface LiquidityZoneChipProps { strike: number; spotPrice: number; }
const LiquidityZoneChip: React.FC<LiquidityZoneChipProps> = ({ strike, spotPrice }) => {
  const isAbove = strike > spotPrice;
  const isNear  = Math.abs(strike - spotPrice) / (spotPrice || 1) < 0.01;
  const bg     = isNear ? "bg-amber-500/20 border-amber-500/40" :
                 isAbove ? "bg-red-500/10 border-red-500/20" :
                           "bg-emerald-500/10 border-emerald-500/20";
  const text   = isNear ? "text-amber-400" :
                 isAbove ? "text-red-300" : "text-emerald-300";
  return (
    <span className={`text-sm font-mono font-bold px-1.5 py-0.5 rounded border ${bg} ${text}`}>
      {strike.toLocaleString()}
    </span>
  );
};

// ── Main Card ─────────────────────────────────────────────────────────────────
const OptionChainCard: React.FC<OptionChainCardProps> = (props) => {
  const {
    activePage, spotPrice, optionChain,
    regimeResult, breadthResult, heavyweightResult, range15mResult,
  } = props;

  const result: OptionChainEngineOutput = useMemo(() =>
    computeOptionChain({
      strikes: optionChain as OIStrikeData[],
      spotPrice,
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
    }),
    [optionChain, spotPrice, regimeResult, breadthResult, heavyweightResult, range15mResult]
  );

  const biasMeta = BIAS_META[result.institutionalBias];
  const { oiWritingUnwinding: oiFlow, oiWalls, components } = result;

  // Arc/header color from score
  const scoreColor =
    result.optionChainScore >= 65 ? "#10b981" :
    result.optionChainScore >= 55 ? "#34d399" :
    result.optionChainScore >= 45 ? "#f59e0b" :
    result.optionChainScore >= 35 ? "#f97316" : "#ef4444";

  return (
    <div
      className="relative select-none overflow-hidden flex-shrink-0 rounded-xl"
      style={{
        background: "linear-gradient(135deg, #060a14 0%, #06101c 60%, #050a12 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 20px ${biasMeta.glowColor}`,
      }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${scoreColor}60 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: scoreColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-500">
              🔗 OPTION CHAIN ENGINE · L5
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Institutional Bias badge */}
            <span
              className={`text-sm font-black uppercase px-1.5 py-0.5 rounded border ${biasMeta.bgColor} ${biasMeta.color} ${biasMeta.borderColor}`}
            >
              {biasMeta.emoji} {biasMeta.label}
            </span>
            {/* Score badge */}
            <span
              className="text-sm font-black font-mono px-1.5 py-0.5 rounded"
              style={{ background: "rgba(255,255,255,0.04)", color: scoreColor }}
            >
              OC: {result.optionChainScore}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <div className="flex items-stretch gap-3 flex-wrap xl:flex-nowrap">

          {/* Col 1: PCR Arc + Max Pain */}
          <div className="flex flex-col items-center justify-center gap-1.5 min-w-[72px]">
            <PCRArc pcr={result.pcr} score={result.pcrScore} />
            <div className="flex flex-col items-center">
              <span className="text-sm text-slate-600 font-semibold uppercase tracking-wider">Max Pain</span>
              <span className="text-base font-black font-mono text-amber-400">
                {result.maxPain > 0 ? result.maxPain.toLocaleString() : "—"}
              </span>
            </div>
          </div>

          {/* Col 2: OI Walls */}
          <div className="flex flex-col justify-center gap-1 min-w-[140px]">
            <span className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
              OI Walls
            </span>
            <div className="flex gap-2">
              {oiWalls.callWall > 0 && (
                <WallPill label="Call Wall 🔴" strike={oiWalls.callWall}
                  strength={oiWalls.callWallStrength} type="CALL" />
              )}
              {oiWalls.putWall > 0 && (
                <WallPill label="Put Wall 🟢" strike={oiWalls.putWall}
                  strength={oiWalls.putWallStrength} type="PUT" />
              )}
              {oiWalls.callWall === 0 && oiWalls.putWall === 0 && (
                <span className="text-sm text-slate-600 italic">No significant walls detected</span>
              )}
            </div>
          </div>

          {/* Col 3: OI Writing / Unwinding */}
          <div className="flex flex-col justify-center min-w-[180px] gap-0.5">
            <span className="text-sm font-black uppercase tracking-wider text-slate-600 mb-1">
              OI Writing / Unwinding
            </span>
            <WritingBadge label="CALL OI"
              status={oiFlow.callStatus}
              value={oiFlow.netCallFlow}
              type="CE"
            />
            <WritingBadge label="PUT OI"
              status={oiFlow.putStatus}
              value={oiFlow.netPutFlow}
              type="PE"
            />
            <div className="flex items-center justify-between mt-0.5 pt-1 border-t border-slate-800/30">
              <span className="text-sm text-slate-500 font-semibold">Smart Money</span>
              <span className={`text-sm font-black ${
                result.smartMoneyDirection === "BULLISH" ? "text-emerald-400" :
                result.smartMoneyDirection === "BEARISH" ? "text-red-400" : "text-amber-400"
              }`}>
                {result.smartMoneyDirection} ({result.smartMoneyScore})
              </span>
            </div>
          </div>

          {/* Col 4: Score Components */}
          <div className="flex flex-col justify-center gap-1 flex-1 min-w-[160px]">
            <span className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
              Score Components (100 pts)
            </span>
            <ScoreBar label="PCR Bias (25%)"        score={components.pcrComponent}       maxScore={25} />
            <ScoreBar label="OI Writing (25%)"       score={components.oiWritingComponent}  maxScore={25} />
            <ScoreBar label="Max Pain (15%)"          score={components.maxPainComponent}    maxScore={15} />
            <ScoreBar label="Range Align (15%)"       score={components.rangeComponent}      maxScore={15} />
            <ScoreBar label="Breadth (10%)"           score={components.breadthComponent}    maxScore={10} />
            <ScoreBar label="Regime (10%)"            score={components.regimeComponent}     maxScore={10} />
          </div>

          {/* Col 5: Liquidity Zones */}
          <div className="flex flex-col justify-center gap-1 min-w-[130px]">
            <span className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
              Liquidity Zones
            </span>
            {result.liquidityZones.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {result.liquidityZones.slice(0, 8).map((z: number) => (
                  <LiquidityZoneChip key={z} strike={z} spotPrice={spotPrice} />
                ))}
              </div>
            ) : (
              <span className="text-sm text-slate-600 italic">No high OI concentrations</span>
            )}
          </div>
        </div>

        {/* ── REASON STRIP ─────────────────────────────────────────────── */}
        {result.reasoning.length > 0 && (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg border border-slate-800/30 bg-slate-900/20">
            <div className="text-sm text-slate-400 leading-tight">
              {result.reasoning.slice(0, 4).join(" · ")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OptionChainCard;

// ── Re-export engine types for downstream layers ──────────────────────────────
export type { OptionChainEngineOutput, OIStrikeData };
export { computeOptionChain, BIAS_META, OI_STATUS_META };

