/**
 * MarketRegimeCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Premium institutional Market Regime Engine card.
 * Placed at the TOP of the LIVE NIFTY / LIVE SENSEX dashboard.
 *
 * Props come directly from App.tsx computed state — no new APIs.
 */
import React, { useRef, useMemo, useEffect, useState } from "react";
import {
  computeMarketRegime,
  REGIME_META,
  type RegimeEngineInput,
  type MarketRegimeResult,
  type MarketRegime,
} from "../engine/marketRegimeEngine";
import type { StockData } from "../types";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface MarketRegimeCardProps {
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | "BANKNIFTY";
  currentSpot: number;
  range15m: { high: number; low: number; isFallback?: boolean };
  overallScore: number;        // currentSummary.totalSum
  score5mNet: number;          // sum of scoreDifference across all stocks
  score15mNet: number;         // sum of score15mDiff across all stocks
  t10: number;                 // top10ScoresSum
  t15: number;                 // next15ScoresSum
  top25Score: number;          // t10 + t15
  top25ScoreDiff: number;      // sum of scoreDifference for top-25 stocks
  pcr: number;
  advances: number;
  declines: number;
  support: number;
  resistance: number;
  darkMode?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Arc({
  value,
  size = 88,
  color,
  glow,
}: {
  value: number;
  size?: number;
  color: string;
  glow: string;
}) {
  const sw = size * 0.12;
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
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x={cx} y={cx + size * 0.06} textAnchor="middle" fill="white"
        fontSize={size * 0.22} fontWeight="800" fontFamily="'Inter',sans-serif">
        {Math.round(value)}%
      </text>
      <text x={cx} y={cx + size * 0.23} textAnchor="middle" fill="rgba(148,163,184,0.9)"
        fontSize={size * 0.11} fontWeight="600" fontFamily="'Inter',sans-serif">
        CONF
      </text>
    </svg>
  );
}

// ── Mini diagnostic bar ───────────────────────────────────────────────────────
function DiagBar({ regime, score, active }: { regime: string; score: number; active: boolean; key?: string }) {
  const regColors: Record<string, string> = {
    TRENDING_BULL: "#10b981", TRENDING_BEAR: "#ef4444",
    BREAKOUT: "#3b82f6", BREAKDOWN: "#f97316",
    RANGE: "#f59e0b", VOLATILE: "#a855f7",
  };
  const col = regColors[regime] ?? "#94a3b8";
  const label = regime.replace("_", " ").replace("TRENDING ", "T. ");
  return (
    <div className="flex items-center gap-4 py-2 border-b border-slate-850/30 last:border-0">
      <span className={`text-sm font-bold w-36 truncate ${active ? "text-white font-black" : "text-slate-500"}`}>
        {label}
      </span>
      <div className="flex-1 h-3 rounded-full overflow-hidden bg-slate-900/60 border border-slate-800/40">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: active ? col : `${col}40` }}
        />
      </div>
      <span className={`text-sm font-mono w-14 text-right ${active ? "text-white font-black" : "text-slate-600"}`}>
        {score}%
      </span>
    </div>
  );
}

// ── Confidence Factor Row ─────────────────────────────────────────────────────
function Factor({ label, value, positive }: { label: string; value: string; positive: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-850/60 last:border-0">
      <span className="text-sm text-slate-400 font-semibold truncate">{label}</span>
      <span className={`text-base font-black font-mono ${
        positive === null ? "text-slate-400" :
        positive ? "text-emerald-400" : "text-red-400"
      }`}>{value}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const MarketRegimeCard: React.FC<MarketRegimeCardProps> = (props) => {
  const {
    activePage, currentSpot, range15m,
    overallScore, score5mNet, score15mNet,
    t10, t15, top25Score, top25ScoreDiff,
    pcr, advances, declines,
    support, resistance,
  } = props;

  // Track previous values for breakout/breakdown cross detection
  const prevSpotRef    = useRef(currentSpot);
  const prevDiffRef    = useRef(top25ScoreDiff);
  const flipCountRef   = useRef(0);
  const prevScoreSign  = useRef<number>(Math.sign(overallScore));
  const [flipCount, setFlipCount] = useState(0);

  useEffect(() => {
    const currentSign = Math.sign(overallScore);
    if (prevScoreSign.current !== 0 && currentSign !== 0 && currentSign !== prevScoreSign.current) {
      flipCountRef.current = Math.min(flipCountRef.current + 1, 5);
      setFlipCount(flipCountRef.current);
      // Reset flip count after 2 minutes
      setTimeout(() => {
        flipCountRef.current = Math.max(0, flipCountRef.current - 1);
        setFlipCount(flipCountRef.current);
      }, 120_000);
    }
    prevScoreSign.current = currentSign;
  }, [overallScore]);

  const input: RegimeEngineInput = {
    spotPrice: currentSpot,
    prevSpotPrice: prevSpotRef.current,
    range15mHigh: range15m.high,
    range15mLow: range15m.low,
    range15mFallback: range15m.isFallback ?? false,
    overallScore, score5mNet, score15mNet,
    t10, t15, top25Score, top25ScoreDiff,
    prevTop25ScoreDiff: prevDiffRef.current,
    pcr, advances, declines,
    support, resistance,
    recentFlipCount: flipCount,
  };

  const result: MarketRegimeResult = useMemo(() =>
    computeMarketRegime(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSpot, overallScore, score5mNet, score15mNet, t10, t15,
      top25Score, top25ScoreDiff, pcr, advances, declines,
      range15m.high, range15m.low, flipCount]
  );

  // Update refs AFTER computing (so next render sees previous)
  useEffect(() => { prevSpotRef.current = currentSpot; }, [currentSpot]);
  useEffect(() => { prevDiffRef.current = top25ScoreDiff; }, [top25ScoreDiff]);

  const meta = REGIME_META[result.regime];

  const rangeWidth = range15m.high - range15m.low;
  const distFromHigh = rangeWidth > 0 ? ((currentSpot - range15m.high) / rangeWidth * 100).toFixed(1) : "—";
  const distFromLow  = rangeWidth > 0 ? ((currentSpot - range15m.low)  / rangeWidth * 100).toFixed(1) : "—";

  // Extract first CSS color from Tailwind class for Arc
  const arcColorMap: Record<MarketRegime, string> = {
    TRENDING_BULL: "#10b981", TRENDING_BEAR: "#ef4444",
    BREAKOUT: "#3b82f6", BREAKDOWN: "#f97316",
    RANGE: "#f59e0b", VOLATILE: "#a855f7",
  };
  const arcColor = arcColorMap[result.regime];

  return (
    <div
      className="relative select-none overflow-hidden w-full rounded-3xl animate-fade-in"
      style={{
        background: "linear-gradient(135deg, #040712 0%, #080f26 50%, #040712 100%)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        boxShadow: `0 20px 50px -12px ${meta.glowColor}50, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Top accent line — regime color */}
      <div className="absolute top-0 left-0 w-full h-[4px]" style={{
        background: `linear-gradient(90deg, transparent, ${arcColor}, transparent)`,
        opacity: 0.9,
      }} />

      {/* Subtle background glow orb */}
      <div className="absolute -top-24 left-1/4 w-[500px] h-[250px] rounded-full pointer-events-none"
        style={{ background: meta.glowColor, filter: "blur(80px)", opacity: 0.2 }} />

      {/* Content Container (Antigravity Expanded View) */}
      <div className="relative z-10 flex flex-col p-6 lg:p-8 gap-6 w-full h-full">

        {/* ── TOP LAYER: IDENTITY + ARC CONFIDENCE ───────────────── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 pb-5 border-b border-slate-800/55">
          
          {/* Identity */}
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-2.5 h-2.5 rounded-full animate-ping absolute" style={{ background: arcColor, opacity: 0.6 }} />
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: arcColor }} />
              <span className="text-sm lg:text-base font-black uppercase tracking-[0.25em] text-indigo-400/90 font-sans">
                Market Regime Engine · {activePage}
              </span>
            </div>

            {/* Main regime display */}
            <div className="flex items-center gap-3.5 mt-1">
              <span className="text-3xl lg:text-4xl select-none leading-none filter drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">{meta.emoji}</span>
              <div>
                <div className={`text-xl lg:text-2xl font-black tracking-wider leading-tight ${meta.color}`}
                  style={{ textShadow: `0 0 15px ${arcColor}cc` }}>
                  {meta.label}
                </div>
                <div className="text-xs lg:text-sm text-slate-400 mt-1 leading-relaxed max-w-2xl">
                  {meta.description}
                </div>
              </div>
            </div>
          </div>

          {/* Arc Confidence Meter */}
          <div className="flex items-center justify-center lg:justify-end flex-shrink-0 self-center lg:self-auto bg-slate-950/30 p-3 rounded-2xl border border-slate-800/40 shadow-inner">
            <Arc value={result.confidence} size={110} color={arcColor} glow={meta.glowColor} />
          </div>
        </div>

        {/* ── MIDDLE LAYER: THE THREE DATA PANELS (STRETCHED GRID) ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
          
          {/* Box 1: Key Inputs */}
          <div className="flex flex-col bg-slate-950/50 p-5 rounded-2xl border border-slate-800/50 shadow-lg">
            <div className="text-sm font-black uppercase tracking-[0.15em] text-slate-400 mb-4 border-b border-slate-800/60 pb-2">
              Key Inputs
            </div>
            <div className="flex flex-col gap-1">
              <Factor label="Overall Score" value={overallScore > 0 ? `+${overallScore.toFixed(0)}` : overallScore.toFixed(0)}
                positive={overallScore > 0 ? true : overallScore < 0 ? false : null} />
              <Factor label="T10 / T15" value={`${t10 > 0 ? "+" : ""}${t10.toFixed(0)} / ${t15 > 0 ? "+" : ""}${t15.toFixed(0)}`}
                positive={t10 > 0 && t15 > 0 ? true : t10 < 0 && t15 < 0 ? false : null} />
              <Factor label="PCR" value={pcr.toFixed(3)}
                positive={pcr > 1 ? true : pcr < 1 ? false : null} />
              <Factor label="A / D" value={`${advances}A / ${declines}D`}
                positive={advances > declines ? true : declines > advances ? false : null} />
              <Factor label="15M Net" value={score15mNet > 0 ? `+${score15mNet.toFixed(1)}` : score15mNet.toFixed(1)}
                positive={score15mNet > 0 ? true : score15mNet < 0 ? false : null} />
            </div>
          </div>

          {/* Box 2: 15M Range Position */}
          <div className="flex flex-col bg-slate-950/50 p-5 rounded-2xl border border-slate-800/50 shadow-lg">
            <div className="text-sm font-black uppercase tracking-[0.15em] text-slate-400 mb-4 border-b border-slate-800/60 pb-2">
              15M Range
            </div>
            <div className="flex flex-col justify-between flex-1 gap-4">
              
              <div className="flex items-center justify-between text-sm font-medium">
                <span className="text-slate-500">High Range Wall</span>
                <span className="font-mono text-slate-200 text-base font-black">{range15m.high.toFixed(0)}</span>
              </div>
              
              {/* Spot position slider */}
              <div className="my-1">
                <div className="relative h-3 bg-slate-900/80 rounded-full overflow-visible border border-slate-800/50">
                  <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-indigo-500/5" />
                  {rangeWidth > 0 && (() => {
                    const pct = Math.min(100, Math.max(0, ((currentSpot - range15m.low) / rangeWidth) * 100));
                    return (
                      <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border border-white z-10 transition-all duration-500"
                        style={{
                          left: `${pct}%`,
                          transform: `translateX(-50%) translateY(-50%)`,
                          background: arcColor,
                          boxShadow: `0 0 10px 2px ${arcColor}`
                        }} />
                    );
                  })()}
                </div>
              </div>

              <div className="flex items-center justify-between text-sm font-medium">
                <span className="text-slate-500">Low Range Wall</span>
                <span className="font-mono text-slate-200 text-base font-black">{range15m.low.toFixed(0)}</span>
              </div>

              <div className="text-sm text-slate-400 mt-4 pt-4 border-t border-slate-800/60 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span>Current Spot:</span>
                  <span className="font-mono text-white text-lg font-black">{currentSpot.toFixed(0)}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5 text-xs">
                  <span>Position Deviation:</span>
                  <span className={`font-bold font-mono ${parseFloat(distFromHigh) > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {distFromHigh}% vs High
                  </span>
                </div>
              </div>

              {range15m.isFallback && (
                <div className="text-xs text-amber-500 font-bold mt-1 flex items-center gap-1 animate-pulse">
                  <span>⚠</span> Estimated Range Bounds
                </div>
              )}
            </div>
          </div>

          {/* Box 3: All Regime Scores */}
          <div className="flex flex-col bg-slate-950/50 p-5 rounded-2xl border border-slate-800/50 shadow-lg">
            <div className="text-sm font-black uppercase tracking-[0.15em] text-slate-400 mb-4 border-b border-slate-800/60 pb-2">
              All Regime Scores
            </div>
            <div className="flex flex-col gap-1 justify-center flex-1">
              {(Object.entries(result.diagnostics) as [MarketRegime, number][]).map(([regime, score]) => (
                <DiagBar key={regime} regime={regime} score={score} active={regime === result.regime} />
              ))}
            </div>
          </div>
        </div>

        {/* ── BOTTOM LAYER: TRIGGERING CONDITIONS (FULL WIDTH) ────── */}
        <div className="flex flex-col bg-slate-950/40 p-5 rounded-2xl border border-slate-800/30">
          <div className="text-sm font-black uppercase tracking-[0.15em] text-slate-400 mb-4 border-b border-slate-800/60 pb-2">
            Triggering Conditions
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.reasons.map((reason, i) => (
              <div key={i} className="flex items-start gap-2 bg-slate-900/20 p-3 rounded-2xl border border-slate-800/40 shadow-sm transition-all hover:bg-slate-900/30">
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 animate-pulse" style={{ background: arcColor }} />
                <span className="text-sm text-slate-300 leading-relaxed font-semibold">{reason}</span>
              </div>
            ))}
            {result.reasons.length === 0 && (
              <span className="text-sm text-slate-500 italic py-1">No dominant conditions detected.</span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default MarketRegimeCard;

// ── Re-export engine types for downstream layers ──────────────────────────────
export type { MarketRegimeResult, MarketRegime, RegimeEngineInput };
export { computeMarketRegime, REGIME_META };
