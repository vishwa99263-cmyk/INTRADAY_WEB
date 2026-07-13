/**
 * RiskCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 16: Risk Engine v1.0 — Premium Capital Protection UI Card
 *
 * Visualizes final execution parameters:
 * - Trade Permission Indicator (ALLOW / BLOCK)
 * - Risk Score Meter (0–100)
 * - Sizing Calculator (Capital risk allocation)
 * - Circuit Breaker Status Badge (NORMAL, WARNING, ACTIVE, HALT)
 * - Daily Loss Remaining Tracker (₹1,500 budget limit)
 * - Risk Trigger Alerts ledger
 */
import React, { useMemo } from "react";
import {
  computeRisk,
  type RiskEngineResult,
  type CircuitBreakerStatus,
} from "../../../engine/riskEngine";
import type { PaperTradingResult } from "../../../engine/paperTradingEngine";
import type { PerformanceEngineResult }  from "../../../engine/performanceEngine";
import { Shield, ShieldAlert, ShieldCheck, Scale, Zap, Info, Lock, Unlock, HelpCircle } from "lucide-react";

export interface RiskCardProps {
  activePage: string;
  spotPrice: number;
  paperTradingOutput: PaperTradingResult;
  performanceResult:  PerformanceEngineResult;
  indiaVix?:          number;
  regimeType?:        string;
  aiConfidence?:      number;
}

const DAILY_LOSS_LIMIT = 1500; // ₹1,500 Daily Loss Limit

const RiskCard: React.FC<RiskCardProps> = (props) => {
  const { activePage, spotPrice, paperTradingOutput, performanceResult, indiaVix, regimeType, aiConfidence } = props;

  const result = useMemo(() => {
    return computeRisk({
      paperTradingOutput,
      performanceResult,
      spotPrice,
      activePage,
      indiaVix,
      regimeType,
      aiConfidence,
    });
  }, [paperTradingOutput, performanceResult, spotPrice, activePage, indiaVix, regimeType, aiConfidence]);

  const isCBActive = result.circuitBreakerActive;

  // Circuit Breaker Colors
  const cbColor =
    result.circuitBreakerStatus === "HALT" ? "text-red-500 border-red-500/30 bg-red-500/10" :
    result.circuitBreakerStatus === "ACTIVE" ? "text-orange-500 border-orange-500/30 bg-orange-500/10" :
    result.circuitBreakerStatus === "WARNING" ? "text-amber-500 border-amber-500/25 bg-amber-500/10" :
    "text-emerald-500 border-emerald-500/25 bg-emerald-500/10";

  const glowShadow =
    result.circuitBreakerStatus === "HALT" ? "rgba(239,68,68,0.10)" :
    result.circuitBreakerStatus === "ACTIVE" ? "rgba(249,115,22,0.08)" :
    result.circuitBreakerStatus === "WARNING" ? "rgba(245,158,11,0.08)" :
    "rgba(16,185,129,0.08)";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #03050a 0%, #060a14 55%, #03050a 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 28px ${glowShadow}`,
      }}
    >
      {/* Top indicator line */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: result.tradeAllowed
          ? "linear-gradient(90deg, transparent 5%, #10b981 50%, transparent 95%)"
          : "linear-gradient(90deg, transparent 5%, #ef4444 50%, transparent 95%)",
      }} />

      <div className="relative z-10 px-4 py-4">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3.5 border-b border-slate-800/40 pb-2">
          <div className="flex items-center gap-1.5">
            <Shield size={14} className={result.tradeAllowed ? "text-emerald-400" : "text-red-400"} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400">
              🛡️ CAPITAL RISK ENGINE · LAYER 16
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* CB Badge */}
            <span className={`text-sm font-black font-mono uppercase px-2 py-0.5 rounded border tracking-wide ${cbColor}`}>
              CB STATUS: {result.circuitBreakerStatus}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT GRID ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* Column 1: Risk score & Trade permission (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between border-r border-slate-800/30 pr-0 lg:pr-4">
            <div className="space-y-3">
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
                Trade Authorization Gate
              </span>

              <div className="grid grid-cols-2 gap-3">
                {/* 🔴 Risk Score Meter */}
                <div className="px-2.5 py-2.5 rounded-lg bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-sm text-slate-500 uppercase font-black">RISK LEVEL</span>
                  <div className={`text-base font-black font-mono mt-1 leading-none ${
                    result.riskScore >= 75 ? "text-red-400" : result.riskScore >= 60 ? "text-amber-400" : "text-emerald-400"
                  }`}>
                    {result.riskScore} / 100
                  </div>
                </div>

                {/* 🧠 Trade Permission Indicator */}
                <div className="px-2.5 py-2.5 rounded-lg bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-sm text-slate-500 uppercase font-black">PERMISSION</span>
                  <div className={`flex items-center gap-1 text-base font-mono font-black mt-1 leading-none ${
                    result.tradeAllowed ? "text-emerald-400" : "text-red-400 animate-pulse"
                  }`}>
                    {result.tradeAllowed ? (
                      <>
                        <Unlock size={10} /> ALLOWED
                      </>
                    ) : (
                      <>
                        <Lock size={10} /> BLOCKED
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Sizing description summary */}
            <div className="mt-3.5 py-1.5 px-2 rounded bg-slate-900/30 border border-slate-900/80 flex items-center gap-1.5 text-sm text-slate-400 font-medium">
              <Scale size={11} className="text-slate-500 flex-shrink-0" />
              <span>Sizing recommendation: max trades cap {result.maxAllowedTrades}.</span>
            </div>
          </div>

          {/* Column 2: Position sizing Calculator & budget (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between border-r border-slate-800/30 pr-0 lg:pr-4">
            <div className="space-y-3.5">
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
                Position Size Sizing Calculator
              </span>

              {/* 💰 Position Sizing display */}
              <div className="px-3 py-2.5 rounded-lg bg-slate-900/30 border border-slate-800/60 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-sm text-slate-500 uppercase font-black">Suggested Cash Allocation</span>
                  <span className="text-base font-mono font-black text-slate-100 mt-0.5">
                    ₹{result.positionSize.toLocaleString("en-IN", { minimumFractionDigits: 1 })}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm text-slate-500 uppercase font-black">RISK RATIO</span>
                  <div className="text-sm font-mono font-bold text-indigo-400 mt-0.5">
                    {(result.positionSize / 10000).toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* 📉 Daily Loss Remaining progress */}
              <div className="space-y-1 bg-slate-950/40 p-2 rounded border border-slate-900/60 font-mono text-sm">
                <div className="flex items-center justify-between text-white font-bold">
                  <span className="text-slate-500 text-sm">Daily Loss Remaining:</span>
                  <span className={result.dailyLossRemaining > 300 ? "text-emerald-400" : "text-red-400 animate-pulse"}>
                    ₹{result.dailyLossRemaining.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(result.dailyLossRemaining / DAILY_LOSS_LIMIT) * 100}%`,
                      backgroundColor: result.dailyLossRemaining > 300 ? "#10b981" : "#ef4444"
                    }}
                  />
                </div>
                <div className="text-sm text-slate-600 text-right">
                  Max Daily Loss Buffer: ₹1,500
                </div>
              </div>
            </div>
          </div>

          {/* Column 3: Protection alert logs list (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between">
            <div>
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block mb-1.5">
                🚨 RISK GATE TRANSCRIPTION ALERTS
              </span>

              <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                {result.reason.map((reason, idx) => {
                  const isNegative = reason.includes("BLOCKED") || reason.includes("HALT") || reason.includes("Block") || reason.includes("HARD STOP") || reason.includes("WARNING");
                  const borderClass = isNegative ? "border-red-500/10 bg-red-950/5 text-red-400" : "border-emerald-500/10 bg-emerald-950/5 text-emerald-400";
                  
                  return (
                    <div
                      key={idx}
                      className={`px-2 py-1.5 rounded border text-sm font-mono leading-snug flex items-start gap-1 ${borderClass}`}
                    >
                      <span className="select-none font-bold mt-0.5">&gt;</span>
                      <p className="leading-snug">{reason}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default RiskCard;

