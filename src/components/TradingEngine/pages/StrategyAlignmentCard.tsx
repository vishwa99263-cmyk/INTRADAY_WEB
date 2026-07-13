/**
 * StrategyAlignmentCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 10: Strategy Alignment Engine v1.0 — Premium Institutional UI Card
 *
 * Cross-validates all 9 upstream engine outputs and visualizes the alignment
 * matrix, dominant bias, grade, readiness level, per-layer votes, and conflicts.
 */
import React, { useMemo } from "react";
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import {
  computeStrategyAlignment,
  TRADE_READINESS_META,
  ALIGNMENT_GRADE_META,
  LAYER_VOTE_META,
  type StrategyAlignmentInput,
  type StrategyAlignmentResult,
} from "../../../engine/strategyAlignmentEngine";
import type { MarketRegimeResult }      from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult }      from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }        from "../../../engine/heavyweightEngine";
import type { Range15MResult }           from "../../../engine/range15mEngine";
import type { OptionChainEngineOutput }  from "../../../engine/optionChainEngine";
import type { MomentumEngineOutput }     from "../../../engine/momentumEngine";
import type { SmartMoneySignal }         from "../../../engine/smartMoneyEngine";
import type { ProbabilityEngineResult }  from "../../../engine/probabilityEngine";
import type { EntryZoneResult }          from "../../../engine/entryZoneEngine";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface StrategyAlignmentCardProps {
  activePage: string;
  regimeResult:        MarketRegimeResult;
  breadthResult:       MarketBreadthResult;
  heavyweightResult?:  HeavyweightResult;
  range15mResult?:     Range15MResult;
  optionChainResult?:  OptionChainEngineOutput;
  momentumResult?:     MomentumEngineOutput;
  smartMoneyResult?:   SmartMoneySignal;
  probabilityResult:   ProbabilityEngineResult;
  entryZoneResult:     EntryZoneResult;
}

const StrategyAlignmentCard: React.FC<StrategyAlignmentCardProps> = (props) => {
  const {
    activePage,
    regimeResult,
    breadthResult,
    heavyweightResult,
    range15mResult,
    optionChainResult,
    momentumResult,
    smartMoneyResult,
    probabilityResult,
    entryZoneResult,
  } = props;

  const result: StrategyAlignmentResult = useMemo(() => {
    return computeStrategyAlignment({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      entryZoneResult,
    });
  }, [
    regimeResult,
    breadthResult,
    heavyweightResult,
    range15mResult,
    optionChainResult,
    momentumResult,
    smartMoneyResult,
    probabilityResult,
    entryZoneResult,
  ]);

  const readMeta  = TRADE_READINESS_META[result.tradeReadiness];
  const gradeMeta = ALIGNMENT_GRADE_META[result.alignmentGrade];

  const accentColor =
    result.dominantDirection === "BULLISH" ? "#10b981" :
    result.dominantDirection === "BEARISH" ? "#ef4444" : "#64748b";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #04070e 0%, #060b17 55%, #040810 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 28px ${readMeta.glow}`,
      }}
    >
      {/* Accent line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${accentColor}80 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-4 py-3">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3 border-b border-slate-800/40 pb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accentColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400">
              ⚖️ STRATEGY ALIGNMENT ENGINE · L10
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Grade Badge */}
            <span className={`text-sm font-mono font-black uppercase px-2 py-0.5 rounded ${gradeMeta.color} ${gradeMeta.bg}`}>
              GRADE {result.alignmentGrade}
            </span>
            {/* Readiness Badge */}
            <span className={`text-sm font-black uppercase px-2.5 py-0.5 rounded border ${readMeta.bg} ${readMeta.color} ${readMeta.border}`}
              style={{ boxShadow: `0 0 8px ${readMeta.glow}` }}>
              {readMeta.emoji} {readMeta.label}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Col 1: Alignment Gauge (Span 3) */}
          <div className="lg:col-span-3 flex flex-col items-center justify-center border-r border-slate-800/30 pr-2">
            {/* Alignment Score Meter */}
            <div className="relative w-28 h-28 flex items-center justify-center mb-2">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                {/* Background circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="transparent"
                  stroke="rgba(255,255,255,0.03)"
                  strokeWidth="6"
                />
                {/* Score arc */}
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="transparent"
                  stroke={accentColor}
                  strokeWidth="7"
                  strokeDasharray={`${2 * Math.PI * 42}`}
                  strokeDashoffset={`${2 * Math.PI * 42 * (1 - result.alignmentScore / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.8s ease" }}
                />
              </svg>
              {/* Inner score label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-white font-mono tracking-tight">
                  {result.alignmentScore}%
                </span>
                <span className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                  Alignment
                </span>
              </div>
            </div>

            {/* Dominant Direction */}
            <div className="flex flex-col items-center gap-1 w-full px-2">
              <div
                className="w-full py-1.5 rounded-lg border flex items-center justify-center gap-1.5 bg-slate-800/20"
                style={{ borderColor: `${accentColor}30` }}
              >
                <span className="text-sm font-black uppercase tracking-wider" style={{ color: accentColor }}>
                  {result.dominantDirection === "BULLISH" && "▲ BULLISH BIAS"}
                  {result.dominantDirection === "BEARISH" && "▼ BEARISH BIAS"}
                  {result.dominantDirection === "NEUTRAL" && "● NEUTRAL BIAS"}
                </span>
              </div>
              <div className="text-sm text-slate-500 font-bold text-center mt-1">
                {result.alignedLayerCount} / {result.totalLayers} EVALUATED LAYERS AGREE
              </div>
            </div>
          </div>

          {/* Col 2: Per-Layer Votes List (Span 5) */}
          <div className="lg:col-span-5 flex flex-col justify-between border-r border-slate-800/30 pr-2">
            <div className="text-sm font-black uppercase tracking-wider text-slate-500 mb-1.5 flex items-center justify-between">
              <span>9-Dimension Voting Matrix</span>
              <span className="text-slate-600 font-mono">Weight / Conf</span>
            </div>

            <div className="space-y-1 overflow-y-auto max-h-[190px] pr-1">
              {result.alignedLayers.map((layer) => {
                const voteMeta = LAYER_VOTE_META[layer.vote];
                const isAgree = layer.vote === result.dominantDirection;
                const isNeut  = layer.vote === "NEUTRAL";

                return (
                  <div
                    key={layer.layerId}
                    className={`flex items-center justify-between px-2 py-1 rounded-md text-sm border transition-all ${
                      isAgree
                        ? "bg-[#06101c]/30 border-emerald-500/10"
                        : isNeut
                        ? "bg-slate-900/10 border-slate-800/20"
                        : "bg-[#180a10]/30 border-red-500/10"
                    }`}
                    title={layer.reason}
                  >
                    {/* Layer ID & Name */}
                    <div className="flex items-center gap-1.5 min-w-[120px]">
                      <span className="text-sm font-black font-mono text-slate-600">L{layer.layerId}</span>
                      <span className="font-bold text-slate-300 truncate max-w-[100px]">{layer.layerName}</span>
                    </div>

                    {/* Vote Indicator */}
                    <div className="flex items-center gap-1">
                      <span className={`text-sm font-black font-mono px-1.5 py-0.5 rounded ${voteMeta.bg} ${voteMeta.color}`}>
                        {voteMeta.icon} {layer.vote}
                      </span>
                    </div>

                    {/* Weight & Confidence / Contribution */}
                    <div className="flex items-center gap-2 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-mono text-slate-500">{layer.weight}% wt / {layer.confidence}% conf</span>
                        <span className={`text-sm font-mono font-bold ${
                          layer.contribution > 0 ? "text-emerald-500" :
                          layer.contribution < 0 ? "text-red-500" : "text-slate-500"
                        }`}>
                          {layer.contribution > 0 ? `+${layer.contribution.toFixed(1)}` : layer.contribution.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Col 3: Conflicts & Reasoning (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between">
            {/* System Tradability and Safety Info */}
            <div className="space-y-2">
              <div className="text-sm font-black uppercase tracking-wider text-slate-500">
                Institutional Safety Check
              </div>

              {/* Tradable Badge */}
              <div
                className={`p-2.5 rounded-lg border flex items-start gap-2 ${
                  result.isTradable
                    ? "bg-emerald-950/10 border-emerald-500/20 text-emerald-400"
                    : "bg-red-950/10 border-red-500/20 text-red-400"
                }`}
              >
                {result.isTradable ? (
                  <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <ShieldAlert size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="text-sm font-black uppercase tracking-wide">
                    Execution Signal: {result.isTradable ? "PASS" : "BLOCK"}
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
                    {result.isTradable
                      ? "Conditions are fully/mostly aligned. Risk/Reward boundaries validated. Trades permitted."
                      : "Divergence or conflict threshold hit. Strategy alignment insufficient for execution."}
                  </p>
                </div>
              </div>

              {/* Composite Confidence Bar */}
              <div className="px-2 py-1.5 rounded-lg border border-slate-800/40 bg-slate-900/20 space-y-1">
                <div className="flex items-center justify-between text-sm font-bold text-slate-500">
                  <span>COMPOSITE CONFIDENCE</span>
                  <span className="font-mono text-white">{result.compositeConfidence}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${result.compositeConfidence}%`,
                      background: `linear-gradient(90deg, ${accentColor} 50%, #4f46e5 100%)`,
                    }}
                  />
                </div>
                <div className="text-sm text-slate-600 font-mono text-right">
                  40% Align + 35% Prob + 25% Entry
                </div>
              </div>
            </div>

            {/* Conflicts List */}
            <div className="mt-2 space-y-1">
              <div className="text-sm font-black uppercase tracking-wider text-slate-500">
                Conflict Engine Outputs ({result.conflicts.length})
              </div>

              {result.conflicts.length > 0 ? (
                <div className="space-y-1 max-h-[80px] overflow-y-auto pr-1">
                  {result.conflicts.map((conflict, idx) => (
                    <div
                      key={idx}
                      className="px-2 py-1 rounded border border-red-500/15 bg-red-950/5 flex items-start gap-1.5 text-sm"
                    >
                      <AlertTriangle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-bold text-slate-300">
                          {conflict.layer1} vs {conflict.layer2}
                        </div>
                        <p className="text-sm text-slate-500 leading-tight">
                          {conflict.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-2 py-1.5 rounded border border-emerald-500/10 bg-emerald-950/5 flex items-center gap-1.5 text-sm text-emerald-400">
                  <CheckCircle2 size={11} className="text-emerald-400" />
                  <span className="font-bold">No structural divergences detected</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── REASONING STRIP ──────────────────────────────────────────── */}
        {result.reasoning.length > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg border border-slate-800/40 bg-slate-900/30">
            <div className="text-sm text-slate-400 leading-relaxed space-y-1 font-medium">
              {result.reasoning.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-slate-600 mt-0.5">•</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategyAlignmentCard;

