/**
 * AIDecisionCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 11: AI Decision Engine v1.0 — Premium Institutional UI Card
 *
 * Visualizes the final synthesized decision (BUY_CE / BUY_PE / WAIT / NO_TRADE),
 * confidence rating, grade, risk metrics, downside/upside bounds, volatility/theta/liquidity
 * danger levels, and reasoning points.
 */
import React, { useMemo } from "react";
import {
  computeAIDecision,
  DECISION_META,
  DECISION_GRADE_META,
  RISK_LEVEL_META,
  type AIDecisionInput,
  type AIDecisionResult,
} from "../../../engine/aiDecisionEngine";
import type { MarketRegimeResult }      from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult }      from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }        from "../../../engine/heavyweightEngine";
import type { Range15MResult }           from "../../../engine/range15mEngine";
import type { OptionChainEngineOutput }  from "../../../engine/optionChainEngine";
import type { MomentumEngineOutput }     from "../../../engine/momentumEngine";
import type { SmartMoneySignal }         from "../../../engine/smartMoneyEngine";
import type { ProbabilityEngineResult }  from "../../../engine/probabilityEngine";
import type { EntryZoneResult }          from "../../../engine/entryZoneEngine";
import type { StrategyAlignmentResult }   from "../../../engine/strategyAlignmentEngine";
import { AlertCircle, AlertTriangle, ShieldCheck, ShieldAlert, Zap, TrendingUp, TrendingDown, Clock } from "lucide-react";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface AIDecisionCardProps {
  activePage: string;
  regimeResult:            MarketRegimeResult;
  breadthResult:           MarketBreadthResult;
  heavyweightResult?:      HeavyweightResult;
  range15mResult?:         Range15MResult;
  optionChainResult?:      OptionChainEngineOutput;
  momentumResult?:         MomentumEngineOutput;
  smartMoneyResult?:       SmartMoneySignal;
  probabilityResult:       ProbabilityEngineResult;
  entryZoneResult:         EntryZoneResult;
  strategyAlignmentResult: StrategyAlignmentResult;
}

const AIDecisionCard: React.FC<AIDecisionCardProps> = (props) => {
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
    strategyAlignmentResult,
  } = props;

  const result: AIDecisionResult = useMemo(() => {
    return computeAIDecision({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      entryZoneResult,
      strategyAlignmentResult,
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
    strategyAlignmentResult,
  ]);

  const decMeta   = DECISION_META[result.finalDecision];
  const gradeMeta = DECISION_GRADE_META[result.decisionGrade];
  const riskMeta  = RISK_LEVEL_META[result.riskAssessment.riskLevel];

  const accentColor =
    result.finalDecision === "BUY_CE" ? "#10b981" :
    result.finalDecision === "BUY_PE" ? "#ef4444" :
    result.finalDecision === "WAIT" ? "#f59e0b" : "#64748b";

  const isTradeActive = result.finalDecision === "BUY_CE" || result.finalDecision === "BUY_PE";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #03060c 0%, #050a14 55%, #03050c 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: `0 2px 30px ${decMeta.glow}`,
      }}
    >
      {/* Laser light line at top */}
      <div className="absolute top-0 left-0 w-full h-[2px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${accentColor} 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-4 py-3">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3 border-b border-slate-800/40 pb-2">
          <div className="flex items-center gap-1.5">
            <Zap size={14} className="animate-pulse" style={{ color: accentColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400">
              🤖 AI DECISION ENGINE · L11
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Decision Status Badge */}
            <span
              className={`text-sm font-black uppercase px-2.5 py-0.5 rounded border ${decMeta.bg} ${decMeta.color} ${decMeta.border}`}
              style={{ boxShadow: `0 0 10px ${decMeta.glow}` }}
            >
              {decMeta.emoji} {decMeta.label}
            </span>
          </div>
        </div>

        {/* ── MAIN LAYOUT ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Col 1: Decision Focus & Confidence (Span 4) */}
          <div className="lg:col-span-4 flex flex-col items-center justify-center border-r border-slate-800/30 pr-3">
            {/* Big circular display */}
            <div
              className="relative w-28 h-28 rounded-full flex flex-col items-center justify-center border-4 transition-all mb-2"
              style={{
                background: `${accentColor}10`,
                borderColor: `${accentColor}40`,
                boxShadow: isTradeActive ? `0 0 25px ${accentColor}25` : "none",
              }}
            >
              {/* Score ring graph */}
              <svg className="absolute inset-0 w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="transparent"
                  stroke="rgba(255,255,255,0.02)"
                  strokeWidth="3"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="transparent"
                  stroke={accentColor}
                  strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 45}`}
                  strokeDashoffset={`${2 * Math.PI * 45 * (1 - result.decisionConfidence / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.8s ease" }}
                />
              </svg>

              <span className="text-3xl">{decMeta.emoji}</span>
              <span className="text-2xl font-mono font-black text-white leading-none mt-1">
                {result.decisionConfidence}%
              </span>
              <span className="text-sm text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                Conviction
              </span>
            </div>

            {/* Decision Quality Grade label */}
            <div className="text-center w-full px-2">
              <div
                className={`py-1 rounded-md text-sm font-black uppercase tracking-wider border ${gradeMeta.color} ${gradeMeta.bg}`}
              >
                {gradeMeta.label}
              </div>
              <p className="text-sm text-slate-500 font-bold mt-1.5">
                SYNTHESIZED FROM ALL 10 UPSTREAM ENGINES
              </p>
            </div>
          </div>

          {/* Col 2: Risk Assessment & Downside/Upside (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between border-r border-slate-800/30 pr-3">
            <div>
              <div className="text-sm font-black uppercase tracking-wider text-slate-500 mb-1.5 flex items-center justify-between">
                <span>Intraday Risk Matrix</span>
                <span className={`text-sm px-1.5 py-0.5 rounded font-black border ${riskMeta.color} ${riskMeta.bg} ${riskMeta.border}`}>
                  {result.riskAssessment.riskLevel} RISK
                </span>
              </div>

              {/* R:R Reward/Downside Columns */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="p-2 rounded bg-red-950/10 border border-red-500/10 flex flex-col items-center">
                  <span className="text-sm text-slate-500 uppercase font-black">Max Downside</span>
                  <span className="text-[14px] font-mono font-black text-red-400 mt-0.5">
                    {isTradeActive && result.riskAssessment.maxDownsidePoints > 0 
                      ? `-${result.riskAssessment.maxDownsidePoints.toFixed(0)} pts` 
                      : "—"}
                  </span>
                  <span className="text-sm text-red-600 font-bold mt-0.5">Index Spot SL</span>
                </div>
                <div className="p-2 rounded bg-emerald-950/10 border border-emerald-500/10 flex flex-col items-center">
                  <span className="text-sm text-slate-500 uppercase font-black">Upside Target</span>
                  <span className="text-[14px] font-mono font-black text-emerald-400 mt-0.5">
                    {isTradeActive && result.riskAssessment.upsidePoints > 0 
                      ? `+${result.riskAssessment.upsidePoints.toFixed(0)} pts` 
                      : "—"}
                  </span>
                  <span className="text-sm text-emerald-600 font-bold mt-0.5">Target boundary</span>
                </div>
              </div>
            </div>

            {/* Risk Checkboxes list */}
            <div className="space-y-1.5 mt-2.5">
              {[
                { label: "Volatility Exposure", value: result.riskAssessment.volatilityRisk, icon: <AlertCircle size={10} /> },
                { label: "Theta Time Decay", value: result.riskAssessment.timeDecayRisk, icon: <Clock size={10} /> },
                { label: "Strike Liquidity", value: result.riskAssessment.liquidityRisk, icon: <Zap size={10} /> },
              ].map((item, idx) => {
                const isHigh = item.value === "HIGH";
                const isLow  = item.value === "LOW";
                return (
                  <div key={idx} className="flex items-center justify-between text-sm px-2 py-0.5 rounded bg-slate-900/40 border border-slate-800/30">
                    <span className="text-slate-500 font-bold flex items-center gap-1">
                      {item.icon} {item.label}
                    </span>
                    <span className={`font-black font-mono uppercase ${isHigh ? "text-red-400" : isLow ? "text-emerald-400" : "text-sky-400"}`}>
                      {item.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Col 3: Warnings & Action triggers (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between">
            <div>
              <div className="text-sm font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Decision Warnings ({result.riskAssessment.warnings.length})
              </div>

              {result.riskAssessment.warnings.length > 0 ? (
                <div className="space-y-1 max-h-[105px] overflow-y-auto pr-1">
                  {result.riskAssessment.warnings.map((warning, idx) => (
                    <div
                      key={idx}
                      className="px-2 py-1.5 rounded border border-orange-500/15 bg-orange-950/5 flex items-start gap-1.5 text-sm"
                    >
                      <AlertTriangle size={11} className="text-orange-400 mt-0.5 flex-shrink-0" />
                      <p className="text-slate-400 leading-snug">
                        {warning}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-2.5 rounded border border-emerald-500/10 bg-emerald-950/5 flex items-start gap-2 text-sm text-emerald-400">
                  <ShieldCheck size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-black uppercase tracking-wide">No Risk Flags Raised</span>
                    <p className="text-sm text-slate-500 leading-snug mt-0.5">
                      All checks returned clean parameters. System execution limits are normal.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Circuit Breaker Status */}
            {result.riskAssessment.circuitBreakerRisk && (
              <div className="mt-2 p-1.5 rounded bg-red-950/15 border border-red-500/20 flex items-center gap-1.5 text-sm text-red-400">
                <ShieldAlert size={12} className="text-red-400 flex-shrink-0 animate-pulse" />
                <span className="font-bold">Warning: Index extended &gt; 2.5% intraday limits.</span>
              </div>
            )}
          </div>
        </div>

        {/* ── REASONING STRIP ──────────────────────────────────────────── */}
        {result.reasoning.length > 0 && (
          <div className="mt-3 px-3 py-2.5 rounded-lg border border-slate-800/40 bg-slate-900/30">
            <div className="text-sm text-slate-300 leading-relaxed space-y-1.5 font-medium">
              {result.reasoning.map((r, i) => {
                const isFirst = i === 0;
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`mt-0.5 text-base ${isFirst ? "text-indigo-400" : "text-slate-600"}`}>
                      {isFirst ? "⚡" : "•"}
                    </span>
                    <span className={isFirst ? "font-bold text-white tracking-wide" : ""}>{r}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIDecisionCard;

