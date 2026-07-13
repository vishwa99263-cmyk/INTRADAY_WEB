/**
 * MarketBreadthCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 2: Market Breadth Engine — Premium institutional UI card
 * Placed directly below MarketRegimeCard in the LIVE tab left panel.
 *
 * Consumes Layer 1 (Market Regime) output for divergence detection.
 * All data from existing App.tsx state — no new APIs.
 */
import React, { useMemo, useEffect, useState } from "react";
import {
  computeMarketBreadth,
  getBreadthMeta,
  type BreadthEngineInput,
  type MarketBreadthResult,
} from "../engine/marketBreadthEngine";
import type { MarketRegimeResult } from "../engine/marketRegimeEngine";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface MarketBreadthCardProps {
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | "BANKNIFTY";
  advances: number;
  declines: number;
  overallScore: number;
  t10: number;
  t15: number;
  top25ScoreDiff: number;
  currentSpot: number;
  /** All stocks (excluding index row) */
  stocks: { symbol: string; score: number; weightage: number; changePercent: number; scoreDifference: number }[];
  /** Top 25 stocks sorted by weightage */
  top25Stocks: { symbol: string; score: number; weightage: number; changePercent: number; scoreDifference: number }[];
  /** Layer 1 output */
  regimeResult: MarketRegimeResult;
  darkMode?: boolean;
}

// ── Animated Arc ──────────────────────────────────────────────────────────────
function BreadthArc({ value, color, glow }: { value: number; color: string; glow: string }) {
  const size = 68, sw = 7;
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
      style={{ filter: `drop-shadow(0 0 5px ${glow})` }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
      <text x={cx} y={cx + 3} textAnchor="middle" fill="white"
        fontSize="16" fontWeight="800" fontFamily="'Inter',sans-serif">{Math.round(value)}</text>
      <text x={cx} y={cx + 14} textAnchor="middle" fill="rgba(148,163,184,0.8)"
        fontSize="7" fontWeight="700" fontFamily="'Inter',sans-serif">BREADTH</text>
    </svg>
  );
}

// ── Component bar ─────────────────────────────────────────────────────────────
function CompBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] text-slate-500 w-14 truncate font-semibold">{label}</span>
      <div className="flex-1 h-[5px] rounded-full bg-slate-800/60 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      <span className="text-[8px] font-mono text-slate-400 w-7 text-right">{Math.round(value)}</span>
    </div>
  );
}

// ── Contributor row ───────────────────────────────────────────────────────────
function ContribRow({ c, rank, positive }: { c: { symbol: string; impact: number; changePercent: number }; rank: number; positive: boolean; key?: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] text-slate-600 w-3 text-right">{rank}</span>
      <span className="text-[9px] font-bold text-slate-300 flex-1 truncate">{c.symbol}</span>
      <span className={`text-[8px] font-black font-mono ${positive ? "text-emerald-400" : "text-red-400"}`}>
        {c.changePercent > 0 ? "+" : ""}{c.changePercent.toFixed(1)}%
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const MarketBreadthCard: React.FC<MarketBreadthCardProps> = (props) => {
  const {
    activePage, advances, declines, overallScore,
    t10, t15, top25ScoreDiff, currentSpot,
    stocks, top25Stocks, regimeResult,
  } = props;

  const result: MarketBreadthResult = useMemo(() =>
    computeMarketBreadth({
      advances, declines,
      totalStocks: stocks.length,
      stocks, top25Stocks,
      overallScore, t10, t15, top25ScoreDiff,
      spotPrice: currentSpot,
      regimeResult,
    }),
    [advances, declines, stocks, top25Stocks, overallScore, t10, t15, top25ScoreDiff, currentSpot, regimeResult]
  );

  const meta = getBreadthMeta(result.breadthScore);

  // Color for the arc
  const arcColor =
    result.breadthScore >= 80 ? "#10b981" :
    result.breadthScore >= 60 ? "#34d399" :
    result.breadthScore >= 40 ? "#f59e0b" :
    result.breadthScore >= 20 ? "#ef4444" : "#dc2626";

  // Divergence alert colors
  const divColors: Record<string, { border: string; bg: string; text: string; icon: string }> = {
    FEW_STOCKS_RALLY: { border: "border-amber-500/40", bg: "bg-amber-500/8", text: "text-amber-300", icon: "⚠" },
    HIDDEN_STRENGTH:  { border: "border-blue-500/40",  bg: "bg-blue-500/8",  text: "text-blue-300",  icon: "⚠" },
    HEALTHY_TREND:    { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-300", icon: "✅" },
    HEALTHY_BEAR:     { border: "border-red-500/30",   bg: "bg-red-500/5",   text: "text-red-300",   icon: "✅" },
    NONE:             { border: "border-slate-700/30", bg: "bg-slate-800/20", text: "text-slate-500", icon: "—" },
  };
  const divStyle = divColors[result.divergenceType] || divColors.NONE;

  // Health badge colors
  const healthColors: Record<string, string> = {
    HEALTHY: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MODERATE: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    WEAK: "bg-red-500/15 text-red-400 border-red-500/25",
    VERY_WEAK: "bg-red-600/20 text-red-500 border-red-600/30",
  };

  return (
    <div
      className="relative select-none overflow-hidden flex-shrink-0 rounded-xl"
      style={{
        background: "linear-gradient(135deg, #060a14 0%, #070c1a 60%, #050912 100%)",
        border: `1px solid rgba(255,255,255,0.05)`,
        boxShadow: `0 2px 16px ${meta.glowColor}`,
      }}
    >
      {/* Top accent */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${arcColor}60 50%, transparent 95%)`,
      }} />

      {/* Content */}
      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ROW ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: arcColor }} />
            <span className="text-[8px] font-black uppercase tracking-[0.15em] text-slate-500">
              MARKET BREADTH ENGINE · L2
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Health badge */}
            <span className={`text-[7.5px] font-black uppercase px-1.5 py-0.5 rounded border ${healthColors[result.breadthHealth]}`}>
              {result.breadthHealth.replace("_", " ")}
            </span>
            {/* Bias badge */}
            <span className={`text-[7.5px] font-black uppercase px-1.5 py-0.5 rounded ${
              result.breadthBias === "BULLISH" ? "bg-emerald-500/15 text-emerald-400" :
              result.breadthBias === "BEARISH" ? "bg-red-500/15 text-red-400" :
              "bg-slate-700/40 text-slate-400"
            }`}>
              {result.breadthBias}
            </span>
          </div>
        </div>

        {/* ── MAIN ROW: Arc + A/D + Components + Contributors ──── */}
        <div className="flex items-stretch gap-3">

          {/* Arc + Label */}
          <div className="flex flex-col items-center justify-center">
            <BreadthArc value={result.breadthScore} color={arcColor} glow={meta.glowColor} />
            <div className={`text-[8px] font-black mt-0.5 ${meta.color}`}>
              {meta.label}
            </div>
          </div>

          {/* ADV / DEC Panel */}
          <div className="flex flex-col justify-center gap-1 min-w-[70px]">
            <div className="text-[8px] font-black uppercase tracking-wider text-slate-600 text-center mb-0.5">ADV / DEC</div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 text-center rounded-lg py-1.5 bg-emerald-500/8 border border-emerald-500/20">
                <div className="text-[15px] font-black text-emerald-400 leading-none">{advances}</div>
                <div className="text-[7px] text-emerald-500/70 font-bold mt-0.5">ADV</div>
              </div>
              <div className="flex-1 text-center rounded-lg py-1.5 bg-red-500/8 border border-red-500/20">
                <div className="text-[15px] font-black text-red-400 leading-none">{declines}</div>
                <div className="text-[7px] text-red-500/70 font-bold mt-0.5">DEC</div>
              </div>
            </div>
            <div className="text-[8px] text-slate-500 text-center">
              ADR: <span className={`font-bold ${result.adr > 0.55 ? "text-emerald-400" : result.adr < 0.45 ? "text-red-400" : "text-slate-400"}`}>
                {result.adr.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Component Bars */}
          <div className="flex flex-col justify-center gap-1 flex-1 min-w-[120px]">
            <div className="text-[7.5px] font-black uppercase tracking-wider text-slate-600 mb-0.5">Score Components</div>
            <CompBar label="ADR 30%" value={result.components.adrScore}
              color={result.components.adrScore > 55 ? "#10b981" : result.components.adrScore < 45 ? "#ef4444" : "#f59e0b"} />
            <CompBar label="Pos% 20%" value={result.components.participationScore}
              color={result.components.participationScore > 55 ? "#10b981" : result.components.participationScore < 45 ? "#ef4444" : "#f59e0b"} />
            <CompBar label="T25 20%" value={result.components.top25Score}
              color={result.components.top25Score > 55 ? "#10b981" : result.components.top25Score < 45 ? "#ef4444" : "#f59e0b"} />
            <CompBar label="Wgt 20%" value={result.components.weightedScore}
              color={result.components.weightedScore > 55 ? "#10b981" : result.components.weightedScore < 45 ? "#ef4444" : "#f59e0b"} />
            <CompBar label="Mom 10%" value={result.components.momentumScore}
              color={result.components.momentumScore > 55 ? "#10b981" : result.components.momentumScore < 45 ? "#ef4444" : "#f59e0b"} />
          </div>

          {/* Top / Bottom Contributors */}
          <div className="flex gap-2 min-w-[200px]">
            {/* Top 5 */}
            <div className="flex-1 flex flex-col justify-center gap-0.5">
              <div className="text-[7.5px] font-black uppercase tracking-wider text-emerald-500/60 mb-0.5">Top 5 ↑</div>
              {result.topContributors.map((c, i) => (
                <ContribRow key={c.symbol} c={c} rank={i + 1} positive={true} />
              ))}
            </div>
            {/* Bottom 5 */}
            <div className="flex-1 flex flex-col justify-center gap-0.5">
              <div className="text-[7.5px] font-black uppercase tracking-wider text-red-500/60 mb-0.5">Bottom 5 ↓</div>
              {result.bottomContributors.map((c, i) => (
                <ContribRow key={c.symbol} c={c} rank={i + 1} positive={false} />
              ))}
            </div>
          </div>
        </div>

        {/* ── DIVERGENCE ALERT ──────────────────────────────────── */}
        {result.divergenceType !== "NONE" && (
          <div className={`mt-2 px-2.5 py-1.5 rounded-lg border ${divStyle.border} ${divStyle.bg} flex items-center gap-2`}>
            <span className="text-base leading-none">{divStyle.icon}</span>
            <span className={`text-[9px] font-bold ${divStyle.text} leading-tight`}>
              {result.divergence}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketBreadthCard;

// ── Re-export engine types for downstream layers ──────────────────────────────
export type { MarketBreadthResult, BreadthEngineInput };
export { computeMarketBreadth, getBreadthMeta };
