/**
 * MarketTimeCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Live Market Time Panel — Session clock, indicators, and permissions.
 *
 * Consumes the output of marketTimeEngine.
 */
import React from "react";
import type { MarketTimeEngineResult } from "../../../engine/marketTimeEngine";
import { Clock, Activity, Unlock, Lock, AlertTriangle, ShieldAlert } from "lucide-react";

export interface MarketTimeCardProps {
  marketTimeResult: MarketTimeEngineResult;
}

const MarketTimeCard: React.FC<MarketTimeCardProps> = ({ marketTimeResult }) => {
  const {
    currentTime,
    marketStatus,
    sessionType,
    isTradingAllowed,
    volatilityLevel,
    countdownToOpen,
    countdownToClose,
  } = marketTimeResult;

  // Status Badge configurations
  const getStatusMeta = () => {
    switch (marketStatus) {
      case "LIVE_MARKET":
        return {
          label: "LIVE MARKET",
          color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
          glow: "rgba(16,185,129,0.15)",
        };
      case "PRE_OPEN":
        return {
          label: "PRE-OPEN SESSION",
          color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
          glow: "rgba(59,130,246,0.12)",
        };
      case "POST_MARKET":
        return {
          label: "POST-MARKET ADJUST",
          color: "text-amber-400 border-amber-500/25 bg-amber-500/10",
          glow: "rgba(245,158,11,0.12)",
        };
      case "CLOSED":
      default:
        return {
          label: "MARKET CLOSED",
          color: "text-red-400 border-red-500/25 bg-red-500/10",
          glow: "rgba(239,68,68,0.10)",
        };
    }
  };

  const statusMeta = getStatusMeta();

  // Session Type Details
  const getSessionLabel = () => {
    switch (sessionType) {
      case "OPENING":
        return "Opening Momentum Phase";
      case "MID":
        return "Midday Consolidation Phase";
      case "SLOW":
        return "Slow Trend Drift Phase";
      case "CLOSING":
        return "Expiry / Final Exit Move";
      default:
        return "Consolidation Drift";
    }
  };

  // Volatility Color
  const volColor =
    volatilityLevel === "HIGH" ? "text-orange-400 border-orange-500/30 bg-orange-500/10" :
    volatilityLevel === "LOW" ? "text-cyan-400 border-cyan-500/20 bg-cyan-500/5" :
    "text-slate-400 border-slate-700/20 bg-slate-800/10";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #03050a 0%, #060a14 55%, #03050a 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 28px ${statusMeta.glow}`,
      }}
    >
      {/* Top indicator bar */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: isTradingAllowed
          ? "linear-gradient(90deg, transparent 5%, #10b981 50%, transparent 95%)"
          : "linear-gradient(90deg, transparent 5%, #ef4444 50%, transparent 95%)",
      }} />

      <div className="relative z-10 px-4 py-4">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3.5 border-b border-slate-800/40 pb-2">
          <div className="flex items-center gap-1.5">
            <Clock size={14} className={isTradingAllowed ? "text-emerald-400" : "text-red-400"} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400">
              ⏰ SESSION TIME CONTROLLER · L1-16 REGULATOR
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className={`text-sm font-black font-mono uppercase px-2 py-0.5 rounded border tracking-wide ${statusMeta.color}`}>
              {statusMeta.label}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT LAYOUT ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          
          {/* Section 1: Large Clock */}
          <div className="md:col-span-4 flex items-center gap-3 border-r border-slate-800/40 pr-4">
            <div className="flex flex-col">
              <span className="text-sm text-slate-500 font-black uppercase tracking-wider">IST SYSTEM TIME</span>
              <span className="text-3xl font-black font-mono text-slate-100 mt-0.5 tracking-wider select-text">
                {currentTime}
              </span>
            </div>
          </div>

          {/* Section 2: Session Info & Volatility */}
          <div className="md:col-span-4 flex flex-col justify-center border-r border-slate-800/40 pr-4 pl-0 md:pl-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 font-black uppercase tracking-wider">TIME PHASE</span>
                <span className={`text-sm font-mono font-black uppercase px-1.5 py-0.2 rounded border ${volColor}`}>
                  {volatilityLevel} VOLATILITY
                </span>
              </div>
              <span className="text-base text-slate-300 font-black tracking-tight leading-none block">
                {getSessionLabel()}
              </span>
            </div>
          </div>

          {/* Section 3: Permission Switch */}
          <div className="md:col-span-4 flex items-center justify-between pl-0 md:pl-2">
            <div className="flex items-center gap-2.5">
              {isTradingAllowed ? (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Unlock size={16} />
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
                  <Lock size={16} />
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-sm text-slate-500 font-black uppercase tracking-wider">EXECUTION MODE</span>
                <span className={`text-sm font-black uppercase tracking-wider mt-0.5 ${
                  isTradingAllowed ? "text-emerald-400" : "text-red-400"
                }`}>
                  {isTradingAllowed ? "🟢 TRADING ALLOWED" : "🔴 TRADING LOCKED"}
                </span>
              </div>
            </div>

            {/* Countdown timers */}
            <div className="flex flex-col text-right font-mono text-sm">
              {marketStatus === "LIVE_MARKET" ? (
                <>
                  <span className="text-sm text-slate-500 font-black uppercase">TIME TO CLOSE</span>
                  <span className="text-white font-black mt-0.5">{countdownToClose}</span>
                </>
              ) : (
                <>
                  <span className="text-sm text-slate-500 font-black uppercase">TIME TO OPEN</span>
                  <span className="text-white font-black mt-0.5">{countdownToOpen}</span>
                </>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

export default MarketTimeCard;

