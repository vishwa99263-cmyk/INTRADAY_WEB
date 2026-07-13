/**
 * OptionFlowCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional Option Flow Monitoring Panel (HUD Panel)
 *
 * Renders Strike Rankings, Liquidity Heatbars, OI Momentum direction,
 * Trap Risk level, and EAME state metrics.
 */
import React from "react";
import { Cpu, Layers, ShieldAlert, Zap, Radio, HelpCircle } from "lucide-react";
import type { OptionFlowEngineOutput } from "../../../engine/optionFlowEngine";

export interface OptionFlowCardProps {
  optionFlowResult: OptionFlowEngineOutput;
}

const OptionFlowCard: React.FC<OptionFlowCardProps> = ({ optionFlowResult }) => {
  const {
    expiryMode,
    timeZoneBias,
    tradeStyle,
    riskMultiplier,
    topStrikes,
    activeDecision,
    isAutomationAllowed,
    reasons,
  } = optionFlowResult;

  const {
    strike,
    direction,
    entryZone,
    liquidity,
    smartMoney,
    oiFlow,
    trapRisk,
    confidence,
  } = activeDecision;

  // Liquidity progress bar indicator
  const getLiquidityBlocks = () => {
    if (liquidity === "HIGH") return "██████████";
    if (liquidity === "MEDIUM") return "██████░░░░";
    return "██░░░░░░░░";
  };

  const getLiquidityColor = () => {
    if (liquidity === "HIGH") return "text-emerald-400";
    if (liquidity === "MEDIUM") return "text-amber-400";
    return "text-rose-500";
  };

  // Badges styling
  const smartMoneyColor = 
    smartMoney === "POSITIVE" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" :
    smartMoney === "NEGATIVE" ? "text-rose-400 bg-rose-500/10 border-rose-500/30" :
    "text-slate-400 bg-slate-500/10 border-slate-500/20";

  const trapRiskColor =
    trapRisk === "LOW" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" :
    trapRisk === "MEDIUM" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
    "text-rose-500 bg-rose-500/10 border-rose-500/30 font-black animate-pulse";

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-white/5 p-4 transition-all duration-300 font-mono text-sm"
      style={{
        background: "linear-gradient(135deg, #02050e 0%, #060e22 55%, #02050e 100%)",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
      }}
    >
      {/* Decorative background grids */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#091a3c_1px,transparent_1px),linear-gradient(to_bottom,#091a3c_1px,transparent_1px)] bg-[size:16px_16px] opacity-[0.04] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-3">
        <div className="flex items-center gap-1.5">
          <Cpu size={12} className="text-teal-400 animate-spin" style={{ animationDuration: "6s" }} />
          <span className="font-black text-slate-200 uppercase tracking-wider text-sm">
            📡 OPTION FLOW ENGINE 2.0
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-sm font-black text-slate-500">EAME HUD</span>
        </div>
      </div>

      {/* Main Grid: Telemetry & Rankings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Left Section: Live Flow Panel */}
        <div className="space-y-3">
          <div className="p-3 rounded-lg border border-slate-900 bg-slate-950/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-bold uppercase text-sm">TELEMETRY DECK</span>
              <span className="text-indigo-400 text-sm font-bold">Confidence: {confidence}%</span>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Top Strike:</span>
                <span className="text-white font-extrabold text-sm">
                  {topStrikes.length > 0 ? topStrikes[0].symbol : "ATM Strike"}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-400">Liquidity:</span>
                <span className={`font-black font-sans ${getLiquidityColor()}`} title={liquidity}>
                  {getLiquidityBlocks()}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-400">Smart Money:</span>
                <span className={`px-1.5 py-0.2 rounded border text-sm font-bold ${smartMoneyColor}`}>
                  {smartMoney === "POSITIVE" ? "BUYING" : smartMoney === "NEGATIVE" ? "SELLING" : smartMoney}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-400">OI Momentum:</span>
                <span className={`font-black ${
                  oiFlow === "BULLISH" ? "text-emerald-400" :
                  oiFlow === "BEARISH" ? "text-rose-500" : "text-amber-500"
                }`}>
                  {oiFlow}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-400">Trap Risk:</span>
                <span className={`px-1.5 py-0.2 rounded border text-sm font-extrabold ${trapRiskColor}`}>
                  {trapRisk}
                </span>
              </div>
            </div>
          </div>

          {/* EAME Indicators Deck */}
          <div className="p-3 rounded-lg border border-slate-900 bg-slate-950/40 grid grid-cols-2 gap-2 text-sm text-slate-400">
            <div className="flex flex-col">
              <span className="text-slate-600 font-bold uppercase text-sm">Expiry Mode</span>
              <span className="text-white font-extrabold mt-0.5">{expiryMode}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-slate-600 font-bold uppercase text-sm">Speed Bias</span>
              <span className="text-white font-extrabold mt-0.5">{timeZoneBias}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-slate-600 font-bold uppercase text-sm">Trade Style</span>
              <span className="text-white font-extrabold mt-0.5">{tradeStyle}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-slate-600 font-bold uppercase text-sm">Risk Multiplier</span>
              <span className="text-indigo-400 font-black mt-0.5">{riskMultiplier.toFixed(1)}x</span>
            </div>
          </div>
        </div>

        {/* Right Section: Ranked Strike Candidates */}
        <div className="flex flex-col justify-between space-y-3">
          <div className="p-3 rounded-lg border border-slate-900 bg-slate-950/60 flex-1 flex flex-col justify-between">
            <span className="text-slate-500 font-bold uppercase text-sm block border-b border-slate-900/60 pb-1.5 mb-2">
              🔥 BEST STRIKE CANDIDATES
            </span>
            <div className="space-y-1.5 flex-1">
              {topStrikes.length > 0 ? (
                topStrikes.slice(0, 3).map((st, idx) => (
                  <div key={idx} className="flex justify-between items-center p-1.5 rounded border border-slate-900 bg-slate-950/30">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-600 font-bold">#{idx + 1}</span>
                      <span className="text-white font-extrabold">{st.strikePrice} {st.direction}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Premium: ₹{st.premium.toFixed(1)}</span>
                      <span className={`px-1 py-0.1 rounded border font-mono font-bold text-sm ${
                        st.direction === "CE" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-red-500/30 text-rose-400"
                      }`}>
                        Rank {st.score}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-slate-600 italic">
                  Calculating strike metrics...
                </div>
              )}
            </div>
          </div>

          {/* Engine Reasons Stack */}
          <div className="p-2.5 rounded-lg border border-slate-900 bg-slate-950/20 text-slate-400 space-y-1 max-h-[85px] overflow-y-auto">
            {reasons.slice(0, 3).map((r, idx) => (
              <div key={idx} className="flex items-start gap-1 leading-normal">
                <span className="text-teal-400">·</span>
                <span className="truncate" title={r}>{r}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default OptionFlowCard;

