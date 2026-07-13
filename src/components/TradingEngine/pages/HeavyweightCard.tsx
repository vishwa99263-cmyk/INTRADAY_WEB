/**
 * HeavyweightCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 3: Heavyweight Engine — Premium institutional UI card
 * Placed inside TRADING ENGINE → ENGINES workspace.
 *
 * Consumes Layer 1 (Regime) + Layer 2 (Breadth) outputs.
 * All data from existing dashboard state — no new APIs.
 */
import React, { useMemo, useEffect, useState } from "react";
import {
  computeHeavyweight,
  DIRECTION_META,
  PRESSURE_META,
  type HeavyweightEngineInput,
  type HeavyweightResult,
  type HeavyweightDirection,
  type HeavyweightPressure,
  type HeavyweightStockImpact,
} from "../../../engine/heavyweightEngine";
import type { MarketRegimeResult } from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult } from "../../../engine/marketBreadthEngine";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface HeavyweightCardProps {
  activePage: string;
  stocks: {
    symbol: string;
    weightage: number;
    score: number;
    scoreDifference: number;
    score15mDiff: number;
    score30mDiff: number;
    score1hDiff: number;
    changePercent: number;
    ltp: number;
    volume: number;
  }[];
  regimeResult: MarketRegimeResult;
  breadthResult: MarketBreadthResult;
}

// ── Animated Arc ──────────────────────────────────────────────────────────────
function HeavyArc({ value, color, glow }: { value: number; color: string; glow: string }) {
  const size = 72, sw = 7;
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
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ filter: `drop-shadow(0 0 6px ${glow})` }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
      <text x={cx} y={cx + 3} textAnchor="middle" fill="white"
        fontSize="17" fontWeight="800" fontFamily="'Inter',sans-serif">{Math.round(value)}</text>
      <text x={cx} y={cx + 14} textAnchor="middle" fill="rgba(148,163,184,0.8)"
        fontSize="6.5" fontWeight="700" fontFamily="'Inter',sans-serif">HW SCORE</text>
    </svg>
  );
}

// ── Momentum bar ──────────────────────────────────────────────────────────────
function MomentumBar({ label, value }: { label: string; value: number }) {
  const absVal = Math.min(Math.abs(value), 100);
  const isPos = value >= 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-slate-500 w-8 truncate font-semibold">{label}</span>
      <div className="flex-1 h-[5px] rounded-full bg-slate-800/60 overflow-hidden relative">
        {/* Center notch */}
        <div className="absolute left-1/2 top-0 w-[1px] h-full bg-slate-600/50 z-10" />
        {isPos ? (
          <div className="absolute left-1/2 h-full rounded-r-full transition-all duration-700"
            style={{ width: `${absVal / 2}%`, background: "#10b981" }} />
        ) : (
          <div className="absolute h-full rounded-l-full transition-all duration-700"
            style={{ width: `${absVal / 2}%`, right: "50%", background: "#ef4444" }} />
        )}
      </div>
      <span className={`text-sm font-mono w-8 text-right font-bold ${isPos ? "text-emerald-400" : "text-red-400"}`}>
        {isPos ? "+" : ""}{value.toFixed(0)}
      </span>
    </div>
  );
}

// ── Concentration gauge ───────────────────────────────────────────────────────
function ConcentrationGauge({ value }: { value: number }) {
  const label = value >= 60 ? "TOP 3 DRIVING" : value >= 30 ? "MODERATE" : "BROAD";
  const color = value >= 60 ? "#ef4444" : value >= 30 ? "#f59e0b" : "#10b981";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-sm font-black uppercase tracking-wider text-slate-600">Concentration</div>
      <div className="w-full h-[6px] rounded-full bg-slate-800/60 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${value}%`, background: color }} />
      </div>
      <div className="flex items-center justify-between w-full">
        <span className="text-sm font-bold" style={{ color }}>{label}</span>
        <span className="text-sm font-mono font-bold text-slate-400">{value}%</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const HeavyweightCard: React.FC<HeavyweightCardProps> = (props) => {
  const { activePage, stocks, regimeResult, breadthResult } = props;

  const result: HeavyweightResult = useMemo(() =>
    computeHeavyweight({
      stocks: stocks.map(s => ({
        symbol: s.symbol,
        weightage: s.weightage,
        score: s.score,
        scoreDifference: s.scoreDifference,
        score15mDiff: s.score15mDiff,
        score30mDiff: s.score30mDiff,
        score1hDiff: s.score1hDiff,
        changePercent: s.changePercent,
        ltp: s.ltp,
        volume: s.volume,
      })),
      regimeResult,
      breadthResult,
    }),
    [stocks, regimeResult, breadthResult]
  );

  const dirMeta = DIRECTION_META[result.heavyweightDirection];
  const pressMeta = PRESSURE_META[result.heavyweightPressure];

  // Arc color derived from score
  const arcColor =
    result.heavyweightScore >= 65 ? "#10b981" :
    result.heavyweightScore >= 55 ? "#34d399" :
    result.heavyweightScore >= 45 ? "#f59e0b" :
    result.heavyweightScore >= 35 ? "#ef4444" : "#dc2626";

  return (
    <div
      className="relative select-none overflow-hidden flex-shrink-0 rounded-xl"
      style={{
        background: "linear-gradient(135deg, #060a14 0%, #070c1a 60%, #050912 100%)",
        border: `1px solid rgba(255,255,255,0.05)`,
        boxShadow: `0 2px 16px ${dirMeta.glowColor}`,
      }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${arcColor}60 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ROW ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: arcColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-500">
              🏦 HEAVYWEIGHT ENGINE · L3
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Direction badge */}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded border ${dirMeta.bgColor} ${dirMeta.color} ${dirMeta.borderColor}`}>
              {dirMeta.label}
            </span>
            {/* Pressure badge */}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded ${pressMeta.color}`}
              style={{ background: "rgba(255,255,255,0.04)" }}>
              {pressMeta.label}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT ROW ────────────────────────────────────── */}
        <div className="flex items-stretch gap-3">

          {/* Col 1: Arc + Label */}
          <div className="flex flex-col items-center justify-center">
            <HeavyArc value={result.heavyweightScore} color={arcColor} glow={dirMeta.glowColor} />
            <div className={`text-sm font-black mt-0.5 ${dirMeta.color}`}>
              {pressMeta.emoji} {result.heavyweightPressure.replace("_", " ")}
            </div>
          </div>

          {/* Col 2: Momentum Bars */}
          <div className="flex flex-col justify-center gap-1 flex-1 min-w-[110px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">Momentum Timeline</div>
            <MomentumBar label="5M" value={result.topHeavyweightImpact.reduce((a, s) => a + s.momentum, 0)} />
            <MomentumBar label="15M" value={result.topHeavyweightImpact.reduce((a, s) => a + s.momentum15m, 0)} />
            <MomentumBar label="30M" value={result.topHeavyweightImpact.reduce((a, s) => a + s.momentum30m, 0)} />
            <MomentumBar label="1H" value={result.topHeavyweightImpact.reduce((a, s) => a + s.momentum1h, 0)} />
          </div>

          {/* Col 3: Concentration */}
          <div className="flex flex-col justify-center min-w-[90px]">
            <ConcentrationGauge value={result.concentrationScore} />
          </div>

          {/* Col 4: Special Trio */}
          <div className="flex flex-col justify-center gap-1 min-w-[160px]">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-black uppercase tracking-wider text-slate-600">Special Trio</span>
              <span className={`text-sm font-black px-1 py-0.5 rounded ${
                result.specialTrioStatus === "BANKING_INDEX_SUPPORT" ? "bg-emerald-500/15 text-emerald-400" :
                result.specialTrioStatus === "INDEX_DRAG" ? "bg-red-500/15 text-red-400" :
                "bg-amber-500/15 text-amber-400"
              }`}>
                {result.specialTrioStatus === "BANKING_INDEX_SUPPORT" ? "SUPPORT" :
                 result.specialTrioStatus === "INDEX_DRAG" ? "DRAG" : "MIXED"}
              </span>
            </div>
            {result.specialTrioDetails.map(s => {
              const isPos = s.changePercent >= 0;
              return (
                <div key={s.symbol} className="flex items-center gap-1.5">
                  <span className="text-sm text-amber-400 font-black w-[70px] truncate">🟨 {s.symbol}</span>
                  <span className="text-sm text-slate-500 font-mono w-7 text-right">{s.weightage.toFixed(1)}%</span>
                  <span className={`text-sm font-black font-mono flex-1 text-right ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                    {isPos ? "+" : ""}{s.changePercent.toFixed(2)}%
                  </span>
                  <span className={`text-sm font-mono w-10 text-right ${s.impact > 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                    {s.impact > 0 ? "+" : ""}{s.impact.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Col 5: Top Impact Stocks */}
          <div className="flex flex-col justify-center gap-0.5 min-w-[140px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">Top 5 Impact</div>
            {result.topHeavyweightImpact.slice(0, 5).map((s, i) => {
              const isPos = s.impact >= 0;
              return (
                <div key={s.symbol} className="flex items-center gap-1">
                  <span className="text-sm text-slate-600 w-3 text-right">{i + 1}</span>
                  <span className="text-sm font-bold text-slate-300 flex-1 truncate">{s.symbol}</span>
                  <span className={`text-sm font-mono ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                    {isPos ? "+" : ""}{s.changePercent.toFixed(1)}%
                  </span>
                  <span className={`text-sm font-black font-mono w-10 text-right ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                    {isPos ? "+" : ""}{s.impact.toFixed(1)}
                  </span>
                </div>
              );
            })}
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

export default HeavyweightCard;

// ── Re-export engine types for downstream layers ──────────────────────────────
export type { HeavyweightResult, HeavyweightEngineInput };
export { computeHeavyweight, DIRECTION_META, PRESSURE_META };

