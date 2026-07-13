/**
 * EntryZoneCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 9: Entry Zone Engine v1.0 — Premium Institutional UI Card
 *
 * Displays: Direction badge, Entry range box with price level visualization,
 * SL / Target lines, R:R ratio, confidence meter, entry mode, reasoning strip.
 * The first execution-level UI component in the system.
 */
import React, { useMemo } from "react";
import {
  computeEntryZone,
  ENTRY_DIRECTION_META,
  ENTRY_MODE_META,
  RR_QUALITY_META,
  type EntryZoneInput,
  type EntryZoneResult,
} from "../../../engine/entryZoneEngine";
import type { MarketRegimeResult }      from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult }      from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }        from "../../../engine/heavyweightEngine";
import type { Range15MResult }           from "../../../engine/range15mEngine";
import type { OptionChainEngineOutput }  from "../../../engine/optionChainEngine";
import type { MomentumEngineOutput }     from "../../../engine/momentumEngine";
import type { SmartMoneySignal }         from "../../../engine/smartMoneyEngine";
import type { ProbabilityEngineResult }  from "../../../engine/probabilityEngine";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface EntryZoneCardProps {
  activePage: string;
  spotPrice: number;
  rangeHigh: number;
  rangeLow: number;
  regimeResult:        MarketRegimeResult;
  breadthResult:       MarketBreadthResult;
  heavyweightResult?:  HeavyweightResult;
  range15mResult?:     Range15MResult;
  optionChainResult?:  OptionChainEngineOutput;
  momentumResult?:     MomentumEngineOutput;
  smartMoneyResult?:   SmartMoneySignal;
  probabilityResult:   ProbabilityEngineResult;
}

// ── Price Level Visualizer ────────────────────────────────────────────────────
function PriceLevelChart({
  spotPrice, entryLow, entryHigh, stopLoss, target, direction,
}: {
  spotPrice: number; entryLow: number; entryHigh: number;
  stopLoss: number;  target: number;   direction: "CE" | "PE" | "WAIT";
}) {
  if (direction === "WAIT" || (entryLow === 0 && entryHigh === 0)) {
    return (
      <div className="flex items-center justify-center h-24 rounded-lg bg-slate-900/30 border border-slate-800/30">
        <span className="text-sm text-slate-600 italic">No trade setup — WAIT</span>
      </div>
    );
  }

  const entryPrice = (entryLow + entryHigh) / 2;
  const allLevels = [stopLoss, entryLow, entryHigh, target, spotPrice].filter(v => v > 0);
  const chartMin  = Math.min(...allLevels) * 0.9998;
  const chartMax  = Math.max(...allLevels) * 1.0002;
  const range     = chartMax - chartMin || 1;

  const toX = (v: number) => ((v - chartMin) / range) * 220;

  const ceColor  = "#10b981";
  const peColor  = "#ef4444";
  const dirColor = direction === "CE" ? ceColor : peColor;

  return (
    <svg width="240" height="80" viewBox="0 0 240 80">
      {/* Background grid lines */}
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={f * 220 + 10} y1={5} x2={f * 220 + 10} y2={65}
          stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
      ))}

      {/* SL line */}
      <line x1={toX(stopLoss) + 10} y1={8} x2={toX(stopLoss) + 10} y2={58}
        stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3,2" />
      <text x={toX(stopLoss) + 10} y={68} textAnchor="middle"
        fill="#ef4444" fontSize="6.5" fontWeight="700">SL</text>
      <text x={toX(stopLoss) + 10} y={76} textAnchor="middle"
        fill="#ef4444" fontSize="5.5" fontFamily="monospace">{stopLoss.toFixed(0)}</text>

      {/* Entry zone rect */}
      <rect x={toX(entryLow) + 10} y={8}
        width={Math.max(toX(entryHigh) - toX(entryLow), 3)} height={50}
        fill={`${dirColor}25`} rx={2}
        stroke={dirColor} strokeWidth={1} />
      <text x={(toX(entryLow) + toX(entryHigh)) / 2 + 10} y={36}
        textAnchor="middle" fill={dirColor} fontSize="6.5" fontWeight="900">ENTRY</text>
      <text x={(toX(entryLow) + toX(entryHigh)) / 2 + 10} y={44}
        textAnchor="middle" fill={dirColor} fontSize="5.5" fontFamily="monospace">
        {entryPrice.toFixed(0)}
      </text>

      {/* Target line */}
      <line x1={toX(target) + 10} y1={8} x2={toX(target) + 10} y2={58}
        stroke="#10b981" strokeWidth={1.5} strokeDasharray="3,2" />
      <text x={toX(target) + 10} y={68} textAnchor="middle"
        fill="#10b981" fontSize="6.5" fontWeight="700">TP</text>
      <text x={toX(target) + 10} y={76} textAnchor="middle"
        fill="#10b981" fontSize="5.5" fontFamily="monospace">{target.toFixed(0)}</text>

      {/* Spot price marker */}
      <circle cx={toX(spotPrice) + 10} cy={33} r={4}
        fill="#f59e0b" />
      <text x={toX(spotPrice) + 10} y={68} textAnchor="middle"
        fill="#f59e0b" fontSize="6" fontWeight="700">SPOT</text>
    </svg>
  );
}



// ── Main Card ─────────────────────────────────────────────────────────────────
const EntryZoneCard: React.FC<EntryZoneCardProps> = (props) => {
  const {
    activePage, spotPrice, rangeHigh, rangeLow,
    regimeResult, breadthResult, heavyweightResult,
    range15mResult, optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
  } = props;

  const result: EntryZoneResult = useMemo(() =>
    computeEntryZone({
      regimeResult, breadthResult, heavyweightResult,
      range15mResult, optionChainResult, momentumResult,
      smartMoneyResult, probabilityResult,
      spotPrice, rangeHigh, rangeLow,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     spotPrice, rangeHigh, rangeLow]
  );

  const dirMeta  = ENTRY_DIRECTION_META[result.direction];
  const modeMeta = ENTRY_MODE_META[result.entryMode];
  const rrMeta   = RR_QUALITY_META[result.rrQuality];

  const accentColor =
    result.direction === "CE" ? "#10b981" :
    result.direction === "PE" ? "#ef4444" : "#64748b";

  const isActive = result.direction !== "WAIT";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #04070e 0%, #060b17 55%, #040810 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 28px ${dirMeta.glow}`,
      }}
    >
      {/* Accent line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${accentColor}80 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: accentColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-500">
              🎯 ENTRY ZONE ENGINE · L9
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {isActive && (
              <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded ${modeMeta.color} bg-slate-800/60`}>
                {modeMeta.label}
              </span>
            )}
            <span className={`text-sm font-black uppercase px-2 py-0.5 rounded border ${dirMeta.bg} ${dirMeta.color} ${dirMeta.border}`}
              style={{ boxShadow: `0 0 8px ${dirMeta.glow}` }}>
              {dirMeta.emoji} {dirMeta.label}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <div className="flex items-stretch gap-3 flex-wrap xl:flex-nowrap">

          {/* Col 1: Direction + Confidence */}
          <div className="flex flex-col items-center justify-center gap-2 min-w-[80px]">
            {/* Big direction badge */}
            <div
              className="w-16 h-16 rounded-full flex flex-col items-center justify-center border-2 transition-all"
              style={{
                background: `${accentColor}18`,
                borderColor: `${accentColor}60`,
                boxShadow: isActive ? `0 0 20px ${accentColor}30` : "none",
              }}
            >
              <span className="text-2xl">{dirMeta.emoji}</span>
              <span className="text-sm font-black uppercase" style={{ color: accentColor }}>
                {result.direction}
              </span>
            </div>

            {/* Confidence pill */}
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-full h-[5px] rounded-full bg-slate-800/60 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${result.confidence}%`, background: accentColor }} />
              </div>
              <span className="text-sm font-black font-mono" style={{ color: accentColor }}>
                {result.confidence}% CONF
              </span>
            </div>
          </div>

          {/* Col 2: Price Level Chart */}
          <div className="flex flex-col justify-center min-w-[245px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-1">
              Price Level Map — {activePage}
            </div>
            <PriceLevelChart
              spotPrice={spotPrice}
              entryLow={result.entryZone[0]}
              entryHigh={result.entryZone[1]}
              stopLoss={result.stopLoss}
              target={result.target}
              direction={result.direction}
            />
          </div>

          {/* Col 3: Trade Parameters */}
          <div className="flex flex-col justify-center gap-1.5 flex-1 min-w-[130px]">
            <div className="text-sm font-black uppercase tracking-wider text-slate-600">
              Trade Parameters
            </div>

            {isActive ? (
              <>
                {/* Entry Zone */}
                <div className="px-2 py-1.5 rounded-lg border border-slate-700/30 bg-slate-800/20">
                  <div className="text-sm text-slate-600 uppercase mb-0.5">Entry Zone</div>
                  <div className="text-sm font-black font-mono" style={{ color: accentColor }}>
                    {result.entryZone[0].toFixed(0)} — {result.entryZone[1].toFixed(0)}
                  </div>
                </div>

                {/* SL */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 font-semibold">Stop Loss</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-black font-mono text-red-400">{result.stopLoss.toFixed(0)}</span>
                    <span className="text-sm text-red-600">({result.riskPoints.toFixed(0)} pts)</span>
                  </div>
                </div>

                {/* Target */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 font-semibold">Target</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-black font-mono text-emerald-400">{result.target.toFixed(0)}</span>
                    <span className="text-sm text-emerald-600">(+{result.rewardPoints.toFixed(0)} pts)</span>
                  </div>
                </div>

                {/* R:R */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 font-semibold">Risk/Reward</span>
                  <div className="flex items-center gap-1">
                    <span className={`text-sm font-black font-mono ${rrMeta.color}`}>
                      1 : {result.riskReward.toFixed(2)}
                    </span>
                    <span className={`text-sm font-black px-1 rounded ${rrMeta.bg} ${rrMeta.color}`}>
                      {result.rrQuality}
                    </span>
                  </div>
                </div>

                {/* Spot vs Entry */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 font-semibold">Spot Price</span>
                  <span className="text-sm font-black font-mono text-amber-400">{spotPrice.toFixed(0)}</span>
                </div>

                {/* Probability backing */}
                <div className="mt-1 pt-1 border-t border-slate-800/30">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">L8 Probability</span>
                    <span className="text-sm font-mono font-black" style={{ color: accentColor }}>
                      {result.direction === "CE" ? probabilityResult.ceProbability : probabilityResult.peProbability}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">L8 Confidence</span>
                    <span className="text-sm font-mono font-black text-indigo-400">
                      {probabilityResult.confidenceLevel}%
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 gap-1.5">
                <span className="text-2xl">⚪</span>
                <span className="text-sm font-black text-slate-500 uppercase">No Trade Setup</span>
                <span className="text-sm text-slate-600 text-center">{result.reasoning[0] ?? "Waiting for edge"}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── REASONING STRIP ──────────────────────────────────────────── */}
        {isActive && result.reasoning.length > 0 && (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg border border-slate-800/30 bg-slate-900/20">
            <div className="text-sm text-slate-400 leading-relaxed space-y-0.5">
              {result.reasoning.map((r, i) => (
                <div key={i}>{r}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EntryZoneCard;
export type { EntryZoneResult };
export { computeEntryZone };

