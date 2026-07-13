/**
 * SmartMoneyCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 7: Smart Money Engine v1.0 — Premium Institutional UI Card
 *
 * Placed inside TRADING ENGINE → ENGINES workspace below Layer 6.
 * Displays: Bidirectional SM score gauge, OI flow breakdown, trap alerts,
 * accumulation/distribution badge, confidence meter, layer alignment grid,
 * and embedded ScoreCandleChart.
 */
import React, { useMemo, useEffect, useState } from "react";
import {
  computeSmartMoney,
  SMART_MONEY_META,
  BIAS_META,
  TRAP_META,
  type SmartMoneyEngineInput,
  type SmartMoneySignal,
  type SmartFlowDirection,
} from "../../../engine/smartMoneyEngine";
import {
  computeScoreCandles,
  backupToSnapshots,
  type ScoreCandleEngineOutput,
  type ScoreCandle,
} from "../../../engine/scoreCandleEngine";
import type { MarketRegimeResult }      from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult }      from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }        from "../../../engine/heavyweightEngine";
import type { Range15MResult }           from "../../../engine/range15mEngine";
import type { OptionChainEngineOutput }  from "../../../engine/optionChainEngine";
import type { MomentumEngineOutput }     from "../../../engine/momentumEngine";

// ── Props ──────────────────────────────────────────────────────────────────────
export interface SmartMoneyCardProps {
  activePage: string;

  // Raw data
  pcr: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallOIChange: number;
  totalPutOIChange: number;
  totalCallVolume: number;
  totalPutVolume: number;
  overallScore: number;
  scoreDifference: number;
  score15mDiff: number;
  volume: number;
  changePercent: number;

  // Backup data for score candles
  scoreBackup?: Record<string, Record<string, number>>;

  // Layer results
  regimeResult:        MarketRegimeResult;
  breadthResult:       MarketBreadthResult;
  heavyweightResult?:  HeavyweightResult;
  range15mResult?:     Range15MResult;
  optionChainResult?:  OptionChainEngineOutput;
  momentumResult?:     MomentumEngineOutput;
}

// ── Bidirectional Score Gauge ─────────────────────────────────────────────────
function SmartScoreGauge({ score }: { score: number }) {
  const size = 80;
  const sw   = 7;
  const r    = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const cx   = size / 2;
  const [offset, setOffset] = useState(circ);

  const absNorm  = Math.abs(score) / 100;
  const color    =
    score >= 40  ? "#10b981" :
    score >= 15  ? "#34d399" :
    score >= -14 ? "#f59e0b" :
    score >= -39 ? "#f97316" : "#ef4444";

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setOffset(circ - absNorm * circ)
    );
    return () => cancelAnimationFrame(id);
  }, [score, circ, absNorm]);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ filter: `drop-shadow(0 0 8px ${color}80)` }}>
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x={cx} y={cx + 1} textAnchor="middle" fill="white"
        fontSize="16" fontWeight="900" fontFamily="'Inter',sans-serif">
        {score > 0 ? "+" : ""}{score}
      </text>
      <text x={cx} y={cx + 13} textAnchor="middle" fill="rgba(148,163,184,0.65)"
        fontSize="6" fontWeight="700" fontFamily="'Inter',sans-serif" letterSpacing="0.1em">
        SM SCORE
      </text>
    </svg>
  );
}

// ── OI Flow Bar ───────────────────────────────────────────────────────────────
function OIFlowBar({ label, value, maxAbs, isPositive }: {
  label: string; value: number; maxAbs: number; isPositive: boolean;
}) {
  const pct  = Math.min(Math.abs(value) / maxAbs * 100, 100);
  const color = isPositive ? "#10b981" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-slate-500 w-[68px] truncate font-semibold">{label}</span>
      <div className="flex-1 h-[5px] rounded-full bg-slate-800/60 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-sm font-mono w-8 text-right font-bold"
        style={{ color }}>
        {value >= 0 ? "+" : ""}{value}
      </span>
    </div>
  );
}

// ── Confidence Ring ───────────────────────────────────────────────────────────
function ConfidenceRing({ confidence }: { confidence: number }) {
  const color =
    confidence >= 70 ? "#10b981" :
    confidence >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative w-10 h-10">
        <svg width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
          <circle cx="20" cy="20" r="16" fill="none" stroke={color} strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${confidence} ${100 - confidence}`}
            strokeDashoffset="25"
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-black font-mono" style={{ color }}>{confidence}</span>
        </div>
      </div>
      <span className="text-sm text-slate-600 font-semibold uppercase">Confidence</span>
    </div>
  );
}

// ── Mini Score Candle Chart ───────────────────────────────────────────────────
function MiniCandleChart({ candles, trapZones }: { candles: ScoreCandle[]; trapZones: string[] }) {
  if (candles.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 rounded-lg bg-slate-900/30 border border-slate-800/30">
        <span className="text-sm text-slate-600 italic">No score history available</span>
      </div>
    );
  }

  const displayCandles = candles.slice(-32); // show last 32 candles
  const allValues = displayCandles.flatMap(c => [c.high, c.low]);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range  = maxVal - minVal || 1;

  const chartH = 72;
  const chartW = displayCandles.length * 6;
  const toY = (v: number) => chartH - ((v - minVal) / range) * chartH;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800/30 bg-slate-900/20 p-1">
      <svg width={Math.max(chartW, 200)} height={chartH + 16}
        style={{ display: "block", minWidth: "200px" }}>
        {/* Midline */}
        <line x1={0} y1={toY((maxVal + minVal) / 2)} x2={chartW} y2={toY((maxVal + minVal) / 2)}
          stroke="rgba(255,255,255,0.04)" strokeWidth={1} />

        {displayCandles.map((c, i) => {
          const x      = i * 6 + 2;
          const bodyTop    = toY(Math.max(c.open, c.close));
          const bodyBottom = toY(Math.min(c.open, c.close));
          const bodyH  = Math.max(bodyBottom - bodyTop, 1);
          const color  = c.isGreen ? "#10b981" : c.isRed ? "#ef4444" : "#64748b";
          const isTrap = trapZones.includes(c.time);
          return (
            <g key={c.time}>
              {/* Wick */}
              <line x1={x + 1.5} y1={toY(c.high)} x2={x + 1.5} y2={toY(c.low)}
                stroke={color} strokeWidth={1} opacity={0.7} />
              {/* Body */}
              <rect x={x} y={bodyTop} width={3} height={bodyH}
                fill={color}
                opacity={isTrap ? 1 : 0.85}
              />
              {/* Trap marker */}
              {isTrap && (
                <circle cx={x + 1.5} cy={toY(c.high) - 3} r={2}
                  fill="#f59e0b" />
              )}
            </g>
          );
        })}

        {/* Time axis labels — show every 6th */}
        {displayCandles.map((c, i) => i % 6 === 0 ? (
          <text key={`t${c.time}`} x={i * 6 + 2} y={chartH + 12}
            fontSize="5" fill="rgba(148,163,184,0.4)" textAnchor="middle">
            {c.time}
          </text>
        ) : null)}
      </svg>
    </div>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────
const SmartMoneyCard: React.FC<SmartMoneyCardProps> = (props) => {
  const {
    activePage, pcr,
    totalCallOI, totalPutOI, totalCallOIChange, totalPutOIChange,
    totalCallVolume, totalPutVolume,
    overallScore, scoreDifference, score15mDiff, volume, changePercent,
    scoreBackup,
    regimeResult, breadthResult, heavyweightResult,
    range15mResult, optionChainResult, momentumResult,
  } = props;

  // Build score candles from backup history
  const candleOutput: ScoreCandleEngineOutput = useMemo(() => {
    if (!scoreBackup || Object.keys(scoreBackup).length === 0) {
      return {
        candles: [], trendBias: "SIDEWAYS", momentumStrength: 0,
        trapZones: [], smartMarkers: [], highestScore: 0, lowestScore: 0,
      };
    }
    const snapshots = backupToSnapshots(scoreBackup, "aggregate");
    return computeScoreCandles(snapshots);
  }, [scoreBackup]);

  // Build score history array for SM engine
  const scoreHistory = useMemo(() =>
    candleOutput.candles.map(c => ({ time: c.time, score: c.close })),
    [candleOutput.candles]
  );

  // Compute Smart Money signal
  const result: SmartMoneySignal = useMemo(() =>
    computeSmartMoney({
      regimeResult, breadthResult, heavyweightResult,
      range15mResult, optionChainResult, momentumResult,
      pcr, totalCallOI, totalPutOI,
      totalCallOIChange, totalPutOIChange,
      totalCallVolume, totalPutVolume,
      overallScore, scoreDifference, score15mDiff,
      volume, changePercent, scoreHistory,
    }),
    [
      regimeResult, breadthResult, heavyweightResult,
      range15mResult, optionChainResult, momentumResult,
      pcr, totalCallOI, totalPutOI, totalCallOIChange, totalPutOIChange,
      totalCallVolume, totalPutVolume,
      overallScore, scoreDifference, score15mDiff, volume, changePercent, scoreHistory,
    ]
  );

  const dirMeta  = SMART_MONEY_META[result.flowDirection];
  const biasMeta = BIAS_META[result.institutionalBias];
  const trapMeta = TRAP_META[result.trapType];
  const comps    = result.components;
  const maxComp  = 30;

  const scoreColor =
    result.smartMoneyScore >= 40  ? "#10b981" :
    result.smartMoneyScore >= 15  ? "#34d399" :
    result.smartMoneyScore >= -14 ? "#f59e0b" :
    result.smartMoneyScore >= -39 ? "#f97316" : "#ef4444";

  return (
    <div
      className="relative select-none overflow-hidden flex-shrink-0 rounded-xl"
      style={{
        background: "linear-gradient(135deg, #04070e 0%, #060b17 55%, #040810 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 24px ${dirMeta.glowColor}`,
      }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${scoreColor}70 50%, transparent 95%)`,
      }} />

      {/* Override signal overlay */}
      {result.overrideSignal && (
        <div className="absolute inset-0 pointer-events-none rounded-xl animate-pulse"
          style={{ boxShadow: "inset 0 0 40px rgba(239,68,68,0.12)" }} />
      )}

      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: scoreColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-500">
              🧠 SMART MONEY ENGINE · L7
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Override Signal */}
            {result.overrideSignal && (
              <span className="text-sm font-black uppercase px-2 py-0.5 rounded border animate-pulse bg-red-900/50 text-red-300 border-red-500/60">
                🚨 OVERRIDE ACTIVE
              </span>
            )}
            {/* Trap badge */}
            {result.trapType !== "NONE" && (
              <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded border ${trapMeta.bg} ${trapMeta.color} border-current/40`}>
                {trapMeta.emoji} {trapMeta.label}
              </span>
            )}
            {/* Institutional bias */}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded border ${biasMeta.bg} ${biasMeta.color} ${biasMeta.border}`}>
              {result.institutionalBias === "ACCUMULATION" ? "🟢" : result.institutionalBias === "DISTRIBUTION" ? "🔴" : "⚪"} {biasMeta.label}
            </span>
            {/* Flow direction */}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded border ${dirMeta.bgColor} ${dirMeta.color} ${dirMeta.borderColor}`}>
              {dirMeta.emoji} {result.flowDirection}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <div className="flex items-stretch gap-3 flex-wrap xl:flex-nowrap">

          {/* Col 1: Gauge + Confidence */}
          <div className="flex flex-col items-center justify-center gap-2 min-w-[80px]">
            <SmartScoreGauge score={result.smartMoneyScore} />
            <ConfidenceRing confidence={result.confidence} />
          </div>

          {/* Col 2: OI Flow Breakdown */}
          <div className="flex flex-col justify-center gap-1.5 min-w-[165px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
              OI Flow Components
            </div>
            <OIFlowBar label="Put Writing"    value={comps.oiPutWritingScore}   maxAbs={maxComp} isPositive={true} />
            <OIFlowBar label="Call Pressure"  value={comps.oiCallPressureScore} maxAbs={maxComp} isPositive={comps.oiCallPressureScore >= 0} />
            <OIFlowBar label="Vol Spike"      value={comps.volumeSpikeScore}    maxAbs={20}      isPositive={comps.volumeSpikeScore >= 0} />
            <OIFlowBar label="Score Accel"    value={comps.scoreAcceleration}   maxAbs={15}      isPositive={comps.scoreAcceleration >= 0} />

            <div className="mt-1 pt-1 border-t border-slate-800/30">
              <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-0.5">
                Layer Bonuses
              </div>
              <OIFlowBar label="Breadth (L2)"  value={comps.breadthAlignment} maxAbs={15} isPositive={comps.breadthAlignment >= 0} />
              <OIFlowBar label="Heavywt (L3)"  value={comps.heavyweightBonus} maxAbs={12} isPositive={comps.heavyweightBonus >= 0} />
              <OIFlowBar label="Regime (L1)"   value={comps.regimeBonus}      maxAbs={10} isPositive={comps.regimeBonus >= 0} />
              <OIFlowBar label="Range (L4)"    value={comps.rangeBonus}       maxAbs={10} isPositive={comps.rangeBonus >= 0} />
            </div>
          </div>

          {/* Col 3: Smart Money Status Grid */}
          <div className="flex flex-col justify-center gap-2 min-w-[150px]">
            {/* PCR status */}
            <div className="flex flex-col gap-1">
              <div className="text-sm font-black uppercase tracking-wider text-slate-600">
                Key Signals
              </div>
              {[
                { label: "PCR",          value: pcr.toFixed(2),   ok: pcr > 1.05,    flip: false },
                { label: "Regime",       value: regimeResult.regime, ok: regimeResult.regime === "TRENDING_BULL" || regimeResult.regime === "BREAKOUT", flip: false },
                { label: "Breadth",      value: `${breadthResult.breadthScore}`,       ok: breadthResult.breadthScore > 55, flip: false },
                { label: "SM Score",     value: `${result.smartMoneyScore > 0 ? "+" : ""}${result.smartMoneyScore}`, ok: result.smartMoneyScore > 20, flip: false },
                { label: "Confidence",   value: `${result.confidence}%`, ok: result.confidence >= 65, flip: false },
                { label: "Trap",         value: result.trapType === "NONE" ? "CLEAR" : result.trapType, ok: result.trapType === "NONE", flip: true },
              ].map(({ label, value, ok, flip }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-600 font-semibold w-16">{label}</span>
                  <span className={`text-sm font-black font-mono ${ok !== flip ? "text-emerald-400" : "text-red-400"} truncate max-w-[80px]`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* Candle trend summary */}
            <div className="pt-1 border-t border-slate-800/30">
              <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-1">
                Score Candle Trend
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-black ${
                  candleOutput.trendBias === "BULLISH" ? "text-emerald-400" :
                  candleOutput.trendBias === "BEARISH" ? "text-red-400" : "text-amber-400"
                }`}>
                  {candleOutput.trendBias}
                </span>
                <span className="text-sm text-slate-500">
                  {candleOutput.candles.length} candles
                </span>
                {candleOutput.trapZones.length > 0 && (
                  <span className="text-sm font-black text-amber-400">
                    ⚠ {candleOutput.trapZones.length} traps
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Col 4: Score Candle Chart */}
          <div className="flex flex-col justify-center flex-1 min-w-[180px] gap-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-black uppercase tracking-wider text-slate-600">
                📊 Score Candle Chart — {activePage}
              </span>
              <div className="flex items-center gap-1.5">
                {candleOutput.smartMarkers.filter(m => m.type === "BUY").length > 0 && (
                  <span className="text-sm font-black text-emerald-400">
                    🟢 ×{candleOutput.smartMarkers.filter(m => m.type === "BUY").length}
                  </span>
                )}
                {candleOutput.smartMarkers.filter(m => m.type === "SELL").length > 0 && (
                  <span className="text-sm font-black text-red-400">
                    🔴 ×{candleOutput.smartMarkers.filter(m => m.type === "SELL").length}
                  </span>
                )}
                {candleOutput.trapZones.length > 0 && (
                  <span className="text-sm font-black text-amber-400">
                    ⚠ ×{candleOutput.trapZones.length}
                  </span>
                )}
              </div>
            </div>
            <MiniCandleChart candles={candleOutput.candles} trapZones={candleOutput.trapZones} />

            {/* Last candle info */}
            {candleOutput.lastCandle && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm text-slate-600">Last:</span>
                <span className={`text-sm font-black font-mono ${candleOutput.lastCandle.isGreen ? "text-emerald-400" : "text-red-400"}`}>
                  O:{candleOutput.lastCandle.open.toFixed(0)} C:{candleOutput.lastCandle.close.toFixed(0)}
                </span>
                {candleOutput.lastCandle.signal !== "NORMAL" && (
                  <span className="text-sm font-black text-amber-400">{candleOutput.lastCandle.signalLabel}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── TRAP DETAILS STRIP ───────────────────────────────────────── */}
        {result.trapType !== "NONE" && result.trapDetails && (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg border border-orange-800/30 bg-orange-900/10">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-orange-400 uppercase">{trapMeta.emoji} TRAP ALERT</span>
              <span className="text-sm text-slate-400">·</span>
              <span className="text-sm text-slate-400">{result.trapDetails}</span>
            </div>
          </div>
        )}

        {/* ── REASON STRIP ─────────────────────────────────────────────── */}
        {result.reasoning.length > 0 && (
          <div className="mt-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800/30 bg-slate-900/20">
            <div className="text-sm text-slate-400 leading-relaxed">
              {result.reasoning.slice(0, 3).join("  ·  ")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SmartMoneyCard;

// ── Re-export for downstream consumption ─────────────────────────────────────
export type { SmartMoneySignal };
export { computeSmartMoney };

