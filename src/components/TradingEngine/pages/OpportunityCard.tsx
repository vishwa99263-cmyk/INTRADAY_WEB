/**
 * OpportunityCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 12: Opportunity Engine v1.0 — Premium Institutional UI Card
 *
 * Displays the refined Opportunity Engine dashboard with:
 * - Highlighted Top Opportunity Panel with interactive quick-views.
 * - Circular overall Opportunity Score meter.
 * - Top 3 Elite/High-Quality setups grid.
 * - Collapsible Rejected Setups list (showing reasons for invalidation).
 */
import React, { useMemo, useState } from "react";
import {
  computeOpportunities,
  OPP_TYPE_META,
  OPP_PRIORITY_META,
  type OpportunityInput,
  type OpportunityResult,
  type TradingOpportunity,
} from "../../../engine/opportunityEngine";
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
import type { AIDecisionResult }          from "../../../engine/aiDecisionEngine";
import {
  Activity,
  Star,
  Eye,
  ShieldAlert,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  AlertCircle,
  Copy,
  ExternalLink,
  Sliders,
  TrendingUp,
  ShieldX
} from "lucide-react";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface OpportunityCardProps {
  activePage: string;
  spotPrice: number;
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
  aiDecisionResult:        AIDecisionResult;
}

const OpportunityCard: React.FC<OpportunityCardProps> = (props) => {
  const {
    activePage,
    spotPrice,
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
    aiDecisionResult,
  } = props;

  // React state for collapsible sections and copied indicator
  const [isRejectedExpanded, setIsRejectedExpanded] = useState<boolean>(false);
  const [copiedSetupId, setCopiedSetupId] = useState<string | null>(null);
  const [quickViewSetup, setQuickViewSetup] = useState<TradingOpportunity | null>(null);

  const result: OpportunityResult = useMemo(() => {
    return computeOpportunities({
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
      aiDecisionResult,
      spotPrice,
      activePage,
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
    aiDecisionResult,
    spotPrice,
    activePage,
  ]);

  const handleCopySetup = (opp: TradingOpportunity, e: React.MouseEvent) => {
    e.stopPropagation();
    const text = `Setup: ${opp.name}\nDirection: ${opp.direction}\nEntry: ${opp.entry.toFixed(1)}\nStop Loss: ${opp.sl.toFixed(1)}\nTarget: ${opp.target.toFixed(1)}\nRisk/Reward: 1:${opp.rrRatio.toFixed(2)}\nOpportunity Score: ${opp.score}%`;
    navigator.clipboard.writeText(text);
    setCopiedSetupId(opp.id);
    setTimeout(() => setCopiedSetupId(null), 2000);
  };

  const getQualityColor = (quality: string) => {
    if (quality === "STRONG") return "text-emerald-400";
    if (quality === "MODERATE") return "text-amber-400";
    return "text-slate-500";
  };

  // Overall Score gauge calculations
  const scorePercent = result.opportunityScore;
  const scoreColorClass =
    scorePercent >= 80 ? "text-emerald-400 stroke-emerald-500" :
    scorePercent >= 60 ? "text-amber-400 stroke-amber-500" : "text-red-400 stroke-red-500";

  const scoreLabel =
    result.marketMode === "AGGRESSIVE" ? "AGGRESSIVE EXECUTION" :
    result.marketMode === "CAUTIOUS" ? "CAUTIOUS EDGE" : "PRESERVE CAPITAL";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #04060b 0%, #050912 55%, #04060b 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Dynamic top bar color indicating mode */}
      <div className={`absolute top-0 left-0 w-full h-[2px] transition-colors duration-500`} style={{
        background: result.marketMode === "AGGRESSIVE"
          ? "linear-gradient(90deg, transparent 5%, #10b981 50%, transparent 95%)"
          : result.marketMode === "CAUTIOUS"
          ? "linear-gradient(90deg, transparent 5%, #f59e0b 50%, transparent 95%)"
          : "linear-gradient(90deg, transparent 5%, #ef4444 50%, transparent 95%)",
      }} />

      <div className="relative z-10 px-4 py-4">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 border-b border-slate-800/40 pb-3">
          <div className="flex items-center gap-2">
            <Eye size={15} className="text-indigo-400" />
            <div>
              <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400 block leading-none">
                OPPORTUNITY ENGINE · LAYER 12
              </span>
              <span className="text-sm font-bold text-slate-500 mt-1 block">
                Ultra Institutional Scanner v1.0
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Market Mode Badge */}
            <div className={`px-2 py-0.5 rounded border text-sm font-black tracking-wide uppercase ${
              result.marketMode === "AGGRESSIVE"
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : result.marketMode === "CAUTIOUS"
                ? "bg-amber-500/12 border-amber-500/25 text-amber-400"
                : "bg-red-500/10 border-red-500/25 text-red-400"
            }`}>
              {result.marketMode} MODE
            </div>

            <div className="text-sm font-black font-mono text-slate-500">
              {result.opportunities.length} SETUP(S) ACTIVE
            </div>
          </div>
        </div>

        {/* ── MAIN LAYOUT ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* Left panel: Top Opportunity & Circular Gauge (Span 5) */}
          <div className="lg:col-span-5 flex flex-col justify-between border-r border-slate-800/30 pr-0 lg:pr-4">
            
            {/* Top Opportunity section */}
            <div>
              <div className="text-sm font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Star size={11} className="text-amber-400 fill-amber-400" />
                  <span>PRIMARY HIGH-EDGE OPPORTUNITY</span>
                </div>
                {result.topOpportunity && (
                  <span className="text-sm text-slate-500">SCORE: {result.topOpportunity.score}%</span>
                )}
              </div>

              {result.topOpportunity ? (
                <div
                  className={`p-3.5 rounded-lg border flex flex-col gap-2 relative overflow-hidden transition-all duration-300 ${
                    result.topOpportunity.direction === "CE"
                      ? "bg-[#06140e]/30 border-emerald-500/25 shadow-[0_0_20px_rgba(16,185,129,0.03)] hover:border-emerald-500/40"
                      : "bg-[#180a0a]/30 border-red-500/25 shadow-[0_0_20px_rgba(239,68,68,0.03)] hover:border-red-500/40"
                  }`}
                  onClick={() => setQuickViewSetup(result.topOpportunity)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Tags */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5">
                    <span className={`text-sm px-1.5 py-0.5 rounded border font-mono font-black ${
                      OPP_PRIORITY_META[result.topOpportunity.priority].color
                    } ${OPP_PRIORITY_META[result.topOpportunity.priority].bg}`}>
                      {OPP_PRIORITY_META[result.topOpportunity.priority].label}
                    </span>
                    <span className={`text-sm px-1.5 py-0.5 rounded border font-mono font-black ${
                      OPP_TYPE_META[result.topOpportunity.type].color
                    } ${OPP_TYPE_META[result.topOpportunity.type].bg} ${OPP_TYPE_META[result.topOpportunity.type].border}`}>
                      {OPP_TYPE_META[result.topOpportunity.type].label}
                    </span>
                  </div>

                  {/* Direction Header */}
                  <div>
                    <span className={`text-sm font-black uppercase tracking-wider ${
                      result.topOpportunity.direction === "CE" ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {result.topOpportunity.direction === "CE" ? "▲ INSTITUTIONAL CALL BUY" : "▼ INSTITUTIONAL PUT BUY"}
                    </span>
                    <h3 className="text-base font-black text-white tracking-tight leading-tight mt-0.5">
                      {result.topOpportunity.name}
                    </h3>
                  </div>

                  {/* Pricing Matrix */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-950/40 border border-slate-900/60 rounded-md p-2 my-1 text-center font-mono">
                    <div>
                      <div className="text-sm text-slate-500 font-bold uppercase">Trigger Price</div>
                      <div className="text-base font-black text-slate-200 mt-0.5">
                        ₹{result.topOpportunity.entry.toLocaleString("en-IN", { minimumFractionDigits: 1 })}
                      </div>
                    </div>
                    <div className="border-l border-r border-slate-800/40">
                      <div className="text-sm text-slate-500 font-bold uppercase">Stop Loss</div>
                      <div className="text-base font-black text-red-400 mt-0.5">
                        ₹{result.topOpportunity.sl.toLocaleString("en-IN", { minimumFractionDigits: 1 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-500 font-bold uppercase">Target Price</div>
                      <div className="text-base font-black text-emerald-400 mt-0.5">
                        ₹{result.topOpportunity.target.toLocaleString("en-IN", { minimumFractionDigits: 1 })}
                      </div>
                    </div>
                  </div>

                  {/* R:R Details & Copy quick-view */}
                  <div className="flex items-center justify-between text-sm font-mono text-slate-400 px-1 mt-0.5">
                    <div className="flex items-center gap-2">
                      <span>R:R = <strong className="text-emerald-400">1 : {result.topOpportunity.rrRatio.toFixed(2)}</strong></span>
                      <span className="text-slate-600">|</span>
                      <span>Quality: <strong className={getQualityColor(result.topOpportunity.setupQuality)}>{result.topOpportunity.setupQuality}</strong></span>
                    </div>

                    <button
                      onClick={(e) => handleCopySetup(result.topOpportunity!, e)}
                      className="hover:text-indigo-400 transition-colors p-1 bg-slate-950/60 border border-slate-800/60 rounded flex items-center gap-1 cursor-pointer"
                    >
                      <Copy size={9} />
                      <span>{copiedSetupId === result.topOpportunity.id ? "Copied!" : "Quick Copy"}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-36 bg-slate-950/20 border border-dashed border-slate-800/40 rounded-lg p-4 text-center">
                  <AlertCircle size={22} className="text-red-500/70 mb-2" />
                  <span className="text-sm font-black text-slate-400 uppercase">NO ACTIVE OPPORTUNITY AVAILABLE</span>
                  <p className="text-sm text-slate-500 mt-1 max-w-[200px]">
                    All setups filtered out by Layer 11 safety thresholds or local score bounds.
                  </p>
                </div>
              )}
            </div>

            {/* Score Meter & Market Reasoning Section */}
            <div className="mt-4 border-t border-slate-800/30 pt-3 flex items-center gap-4 bg-slate-950/20 p-2.5 rounded-lg border border-slate-900/60">
              
              {/* SVG circular progress */}
              <div className="relative flex-shrink-0 flex items-center justify-center">
                <svg className="w-16 h-16 transform -rotate-90">
                  <circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,0.03)" strokeWidth="4.5" fill="transparent" />
                  <circle cx="32" cy="32" r="26"
                    className="transition-all duration-1000 ease-out"
                    strokeWidth="4.5"
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 26}
                    strokeDashoffset={2 * Math.PI * 26 * (1 - scorePercent / 100)}
                    stroke={scorePercent >= 80 ? "#10b981" : scorePercent >= 60 ? "#f59e0b" : "#ef4444"}
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-base font-mono font-black text-white">{scorePercent}%</span>
                  <span className="text-sm text-slate-500 font-bold uppercase tracking-wider">SCORE</span>
                </div>
              </div>

              {/* Status explanation */}
              <div className="flex-1">
                <span className="text-sm font-black font-mono text-slate-400 tracking-wider block">
                  {scoreLabel}
                </span>
                <span className="text-sm text-slate-400 font-semibold block mt-0.5 leading-snug">
                  Overall market scoring dial measures trade suitability index based on momentum, alignment, and smart money flow.
                </span>
              </div>
            </div>

          </div>

          {/* Right panel: Top 3 valid setup grid & Collapsible Rejections (Span 7) */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            
            {/* Top 3 setups */}
            <div>
              <div className="text-sm font-black uppercase tracking-wider text-slate-400 mb-2">
                🔥 TOP SCANNED OPPORTUNITIES MATRIX
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {result.opportunities.length === 0 ? (
                  <div className="col-span-3 flex flex-col items-center justify-center py-10 bg-slate-950/10 border border-slate-800/30 rounded-lg text-slate-500 font-mono text-sm">
                    <ShieldAlert size={16} className="text-red-500/50 mb-1" />
                    <span>0 SCANNED OPPORTUNITIES CLEARED BY SAFETY GATE</span>
                  </div>
                ) : (
                  result.opportunities.slice(0, 3).map((opp, index) => {
                    const typeMeta = OPP_TYPE_META[opp.type];
                    return (
                      <div
                        key={opp.id}
                        onClick={() => setQuickViewSetup(opp)}
                        className={`p-3 rounded-lg border bg-slate-950/30 hover:bg-slate-950/60 transition-all cursor-pointer relative flex flex-col justify-between gap-2.5 ${
                          opp.id === result.topOpportunity?.id
                            ? "border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.05)]"
                            : "border-slate-800/50 hover:border-slate-700"
                        }`}
                      >
                        {/* Number Badge */}
                        <div className="absolute top-2 right-2 text-sm font-black font-mono text-slate-600 bg-slate-900/60 h-4 w-4 rounded-full flex items-center justify-center border border-slate-800/40">
                          #{index + 1}
                        </div>

                        <div>
                          {/* Type */}
                          <span className={`text-sm font-bold px-1 py-0.2 rounded border ${typeMeta.bg} ${typeMeta.color} ${typeMeta.border} block w-fit`}>
                            {typeMeta.label}
                          </span>

                          {/* Info */}
                          <h4 className="text-sm font-black text-slate-100 tracking-tight leading-tight mt-1.5 truncate">
                            {opp.name}
                          </h4>
                          <span className={`text-sm font-bold uppercase tracking-wider block mt-0.5 ${
                            opp.direction === "CE" ? "text-emerald-400" : "text-red-400"
                          }`}>
                            {opp.direction === "CE" ? "▲ CE Option Buy" : "▼ PE Option Buy"}
                          </span>
                        </div>

                        {/* Stats mini-row */}
                        <div className="border-t border-slate-900/60 pt-2 flex items-center justify-between text-sm font-mono">
                          <div>
                            <span className="text-slate-500">Score:</span>
                            <span className="text-slate-300 font-bold ml-1">{opp.score}%</span>
                          </div>
                          <div>
                            <span className="text-slate-500">R:R:</span>
                            <span className="text-emerald-400 font-bold ml-1">1:{opp.rrRatio.toFixed(1)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Scanned Setups Reasoning logs */}
            <div className="mt-4 border-t border-slate-800/30 pt-3">
              <div className="text-sm font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Scan Execution Reasoning Logs
              </div>
              <div className="p-2.5 rounded bg-slate-950/40 border border-slate-900/60 text-sm font-mono text-slate-400 space-y-1">
                {result.reasoning.map((r, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span className="text-indigo-400 select-none">&gt;</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Collapsible Rejected/Filtered setups panel */}
            <div className="mt-4 border-t border-slate-800/30 pt-3">
              <button
                onClick={() => setIsRejectedExpanded(!isRejectedExpanded)}
                className="w-full flex items-center justify-between py-1 bg-slate-950/20 hover:bg-slate-950/40 border border-slate-900/60 px-3 rounded text-sm font-bold text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <ShieldX size={12} className={result.rejectedSetups.length > 0 ? "text-red-400" : "text-slate-500"} />
                  <span>REJECTED SETUPS SCANNED ({result.rejectedSetups.length})</span>
                </div>
                {isRejectedExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>

              {isRejectedExpanded && (
                <div className="mt-2 overflow-x-auto select-none border border-slate-900/60 rounded bg-slate-950/50 max-h-36 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-sm font-mono">
                    <thead>
                      <tr className="border-b border-slate-800/40 bg-slate-900/20 text-sm text-slate-500 uppercase tracking-wider">
                        <th className="p-2 pl-3">Setup</th>
                        <th className="p-2 text-center">Direction</th>
                        <th className="p-2 text-center">Calculated Score</th>
                        <th className="p-2 pr-3 text-right">Reason for Invalidation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/25 text-slate-400">
                      {result.rejectedSetups.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-center py-6 text-slate-600 italic">
                            No setups were filtered out or rejected.
                          </td>
                        </tr>
                      ) : (
                        result.rejectedSetups.map((opp) => (
                          <tr key={opp.id} className="hover:bg-slate-900/20 transition-colors">
                            <td className="p-2 pl-3 text-slate-300 font-bold">{opp.name}</td>
                            <td className="p-2 text-center">
                              <span className={`px-1 rounded text-sm font-bold ${
                                opp.direction === "CE" ? "bg-emerald-500/10 text-emerald-400" :
                                opp.direction === "PE" ? "bg-red-500/10 text-red-400" : "bg-slate-800 text-slate-500"
                              }`}>
                                {opp.direction}
                              </span>
                            </td>
                            <td className="p-2 text-center text-slate-300">{opp.score}%</td>
                            <td className="p-2 pr-3 text-right text-red-400/80 text-sm" title={opp.rejectReason}>
                              {opp.rejectReason || "Fails Score threshold (<60%)"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── QUICK VIEW / DETAILS MODAL OVERLAY ───────────────────────── */}
        {quickViewSetup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={() => setQuickViewSetup(null)}>
            <div
              className="w-full max-w-sm rounded-xl border border-slate-800/80 bg-[#04060b] p-4 flex flex-col gap-3 shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Title & Close */}
              <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                <span className="text-sm font-black font-mono tracking-widest text-indigo-400 uppercase">
                  Scanner Setup Inspector
                </span>
                <button
                  onClick={() => setQuickViewSetup(null)}
                  className="text-slate-500 hover:text-white transition-colors text-sm font-mono cursor-pointer"
                >
                  [ESC] CLOSE
                </button>
              </div>

              {/* Header Details */}
              <div>
                <span className={`text-sm px-1.5 py-0.5 rounded border font-mono font-black ${
                  OPP_TYPE_META[quickViewSetup.type].color
                } ${OPP_TYPE_META[quickViewSetup.type].bg} ${OPP_TYPE_META[quickViewSetup.type].border}`}>
                  {OPP_TYPE_META[quickViewSetup.type].label}
                </span>
                <h3 className="text-base font-black text-white mt-1.5 leading-snug">
                  {quickViewSetup.name}
                </h3>
              </div>

              {/* Execution Details Panel */}
              <div className="bg-slate-950/80 border border-slate-900 rounded p-2.5 space-y-1.5 text-sm font-mono text-slate-400">
                <div className="flex justify-between">
                  <span>Instrument Ticker:</span>
                  <span className="text-white font-bold">{quickViewSetup.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span>Option Class:</span>
                  <span className={quickViewSetup.direction === "CE" ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                    {quickViewSetup.direction === "CE" ? "CALL BUY (CE)" : "PUT BUY (PE)"}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-900/60 pt-1">
                  <span>Trigger Entry Price:</span>
                  <span className="text-white">₹{quickViewSetup.entry.toLocaleString("en-IN", { minimumFractionDigits: 1 })}</span>
                </div>
                <div className="flex justify-between">
                  <span>Stop Loss Target:</span>
                  <span className="text-red-400">₹{quickViewSetup.sl.toLocaleString("en-IN", { minimumFractionDigits: 1 })}</span>
                </div>
                <div className="flex justify-between">
                  <span>Take Profit Target:</span>
                  <span className="text-emerald-400">₹{quickViewSetup.target.toLocaleString("en-IN", { minimumFractionDigits: 1 })}</span>
                </div>
                <div className="flex justify-between border-t border-slate-900/60 pt-1">
                  <span>Risk/Reward Scale:</span>
                  <span className="text-indigo-400 font-bold">1 : {quickViewSetup.rrRatio.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Scoring Conviction:</span>
                  <span className="text-slate-300">{quickViewSetup.score}%</span>
                </div>
              </div>

              {/* Description */}
              <div className="bg-slate-950/20 p-2 rounded border border-slate-900/60 text-sm text-slate-400 leading-snug">
                {quickViewSetup.description}
              </div>

              {/* Action row */}
              <div className="flex items-center justify-between border-t border-slate-900/60 pt-3">
                <button
                  onClick={(e) => handleCopySetup(quickViewSetup, e)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800/80 text-sm font-bold text-slate-400 hover:text-white hover:border-slate-600 transition-colors cursor-pointer"
                >
                  <Copy size={11} />
                  <span>{copiedSetupId === quickViewSetup.id ? "Copied Setup Details" : "Copy Setup Specs"}</span>
                </button>

                <div className="flex items-center gap-1 text-sm font-black uppercase text-slate-500">
                  <Activity size={10} className="text-indigo-400 animate-pulse" />
                  <span>Auto-Trade Router Active</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default OpportunityCard;

