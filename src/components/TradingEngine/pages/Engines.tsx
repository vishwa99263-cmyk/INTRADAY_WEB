/**
 * Engines.tsx — Layer 1-16 Trading Engines workspace.
 * Consolidated dedicated view for all progressive analysis layers.
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { Cpu, Layers, Lock, CheckCircle2, ChevronRight, Activity, Database, Sparkles, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import MarketRegimeCard from "../../MarketRegimeCard";
import MarketBreadthCard from "../../MarketBreadthCard";
import HeavyweightCard from "./HeavyweightCard";
import Range15MCard from "./Range15MCard";
import OptionChainCard from "./OptionChainCard";
import MomentumCard from "./MomentumCard";
import SmartMoneyCard from "./SmartMoneyCard";
import ProbabilityCard from "./ProbabilityCard";
import EntryZoneCard from "./EntryZoneCard";
import StrategyAlignmentCard from "./StrategyAlignmentCard";
import AIDecisionCard from "./AIDecisionCard";
import OpportunityCard from "./OpportunityCard";
import StrategiesCard from "./StrategiesCard";
import PaperTradingCard from "./PaperTradingCard";
import PerformanceCard from "./PerformanceCard";
import RiskCard from "./RiskCard";
import MarketTimeCard from "./MarketTimeCard";
import LiveSignalFeedCard from "./LiveSignalFeedCard";
import OptionFlowCard from "./OptionFlowCard";
import { computeMarketTime } from "../../../engine/marketTimeEngine";
import { computeOptionFlow } from "../../../engine/optionFlowEngine";
import { computeMarketBreadth } from "../../../engine/marketBreadthEngine";
import { computeHeavyweight } from "../../../engine/heavyweightEngine";
import { computeRange15M } from "../../../engine/range15mEngine";
import { computeOptionChain } from "../../../engine/optionChainEngine";
import { computeMomentum } from "../../../engine/momentumEngine";
import { computeSmartMoney } from "../../../engine/smartMoneyEngine";
import { computeProbability } from "../../../engine/probabilityEngine";
import { computeEntryZone } from "../../../engine/entryZoneEngine";
import { computeStrategyAlignment } from "../../../engine/strategyAlignmentEngine";
import { computeAIDecision } from "../../../engine/aiDecisionEngine";
import { computeOpportunities } from "../../../engine/opportunityEngine";
import { computeStrategies } from "../../../engine/strategiesEngine";
import { computePaperTrading } from "../../../engine/paperTradingEngine";
import { computePerformance } from "../../../engine/performanceEngine";
import { computeRisk } from "../../../engine/riskEngine";
import { LAYER_REGISTRY, type LayerDefinition } from "../../../engine/layerRegistry";
import type { OptionStrike } from "../../../types";

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

interface EnginesProps {
  activePage: string;
  currentSpot: number;
  range15m: { high: number; low: number; isFallback?: boolean };
  overallScore: number;
  score5mNet: number;
  score15mNet: number;
  t10: number;
  t15: number;
  top25Score: number;
  top25ScoreDiff: number;
  pcr: number;
  advances: number;
  declines: number;
  support: number;
  resistance: number;
  stocks: any[];
  top25Stocks: any[];
  regimeResult: any;
  /** Raw option chain strikes for Layer 5 */
  optionChain?: OptionStrike[];
  /** Aggregate 30M score change across all stocks */
  score30mNet?: number;
  /** Aggregate 1H score change across all stocks */
  score1hNet?: number;
  /** Total volume across all constituent stocks */
  totalVolume?: number;
  /** Score backup data for Score Candle chart (symbol → {time → score}) */
  scoreBackup?: Record<string, Record<string, number>>;
  indiaVix?: number;
  spotChangePct?: number;
  rtpodeResult?: any;
  monthlyMetrics?: any;
  nextWeeklyMetrics?: any;
  monthlyExpiry?: string;
  nextWeeklyExpiry?: string;
}

interface MasterTradeCardProps {
  symbol: string;
  decision: "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";
  confidence: number;
  entry: number;
  sl: number;
  target: number;
  strategy: string;
  opportunityRank: number;
  riskStatus: "SAFE" | "WARNING" | "BLOCKED";
  livePnL: number;
  reasonStack: string[];
}

const MasterTradeCard: React.FC<MasterTradeCardProps> = ({
  symbol,
  decision,
  confidence,
  entry,
  sl,
  target,
  strategy,
  opportunityRank,
  riskStatus,
  livePnL,
  reasonStack,
}) => {
  const isCE = decision === "BUY_CE";
  const isPE = decision === "BUY_PE";
  const isWait = decision === "WAIT";

  // Decision badge colors
  const decColor = isCE
    ? "from-emerald-500/20 to-emerald-600/10 border-emerald-500/40 text-emerald-400"
    : isPE
    ? "from-red-500/20 to-red-600/10 border-red-500/40 text-red-400"
    : isWait
    ? "from-amber-500/10 to-amber-600/5 border-amber-500/35 text-amber-400"
    : "from-slate-800/30 to-slate-900/10 border-slate-700/30 text-slate-400";

  const decGlow = isCE
    ? "rgba(16,185,129,0.12)"
    : isPE
    ? "rgba(239,68,68,0.12)"
    : isWait
    ? "rgba(245,158,11,0.06)"
    : "transparent";

  // Risk status colors
  const riskColor =
    riskStatus === "BLOCKED" ? "bg-red-500/15 border-red-500/30 text-red-400" :
    riskStatus === "WARNING" ? "bg-amber-500/15 border-amber-500/30 text-amber-400" :
    "bg-emerald-500/15 border-emerald-500/30 text-emerald-400";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl border border-white/5 p-5 transition-all duration-300"
      style={{
        background: "linear-gradient(135deg, #040814 0%, #081024 60%, #040814 100%)",
        boxShadow: `0 8px 32px ${decGlow}`,
      }}
    >
      {/* Top indicator glowing barbar */}
      <div className="absolute top-0 left-0 w-full h-[2px]" style={{
        background: isCE
          ? "linear-gradient(90deg, transparent, #10b981, transparent)"
          : isPE
          ? "linear-gradient(90deg, transparent, #ef4444, transparent)"
          : isWait
          ? "linear-gradient(90deg, transparent, #f59e0b, transparent)"
          : "linear-gradient(90deg, transparent, #64748b, transparent)",
      }} />

      {/* Decorative Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0c1a3a_1px,transparent_1px),linear-gradient(to_bottom,#0c1a3a_1px,transparent_1px)] bg-[size:24px_24px] opacity-10 pointer-events-none" />

      {/* Main Flex Layout */}
      <div className="relative z-10 flex flex-col lg:flex-row justify-between gap-6">
        
        {/* Left Section: Active Symbol, Decision State, Confidence Gauge */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-black uppercase tracking-[0.2em] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
              📊 MASTER SYSTEM OUTPUT
            </span>
            <div className="flex items-center gap-1.5 text-sm font-mono font-bold text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              <span>LIVE SCANNING</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* Symbol Name & Decision Badges */}
            <div className="flex flex-col">
              <span className="text-3xl font-black text-white tracking-tight flex items-baseline gap-1.5">
                {symbol}
                <span className="text-base text-slate-500 font-normal">v1.0</span>
              </span>
            </div>

            {/* Decision Status Large Block */}
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-br border font-mono tracking-wider ${decColor}`} style={{ boxShadow: `0 4px 20px ${decGlow}` }}>
              <span className="text-xl font-black uppercase flex items-center gap-1.5">
                {isCE && <TrendingUp size={20} className="animate-bounce" />}
                {isPE && <TrendingDown size={20} className="animate-bounce" />}
                {decision.replace("_", " ")}
              </span>
            </div>

            {/* Confidence circular visual or large label */}
            <div className="flex flex-col border-l border-slate-800/60 pl-4 py-0.5">
              <span className="text-sm text-slate-500 font-black uppercase tracking-wider">AI Confidence</span>
              <span className="text-2xl font-black font-mono text-slate-100 mt-0.5 flex items-baseline gap-0.5">
                {confidence}<span className="text-base text-slate-500 font-bold">%</span>
              </span>
            </div>
          </div>

          {/* Strategy Details Block */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-slate-800/40">
            <div>
              <span className="text-sm text-slate-500 font-black uppercase block tracking-wider">EXECUTION STRATEGY</span>
              <span className="text-sm text-slate-300 font-black uppercase font-mono mt-0.5 block truncate">
                {strategy === "NO_STRATEGY" ? "STANDBY (CASH)" : strategy}
              </span>
            </div>
            <div>
              <span className="text-sm text-slate-500 font-black uppercase block tracking-wider">OPPORTUNITY RANK</span>
              <span className="text-sm text-slate-300 font-black font-mono mt-0.5 block">
                #{opportunityRank} Setup Candidate
              </span>
            </div>
            <div>
              <span className="text-sm text-slate-500 font-black uppercase block tracking-wider">RISK LIMIT STATE</span>
              <span className={`text-sm font-black font-mono mt-0.5 px-2 py-0.2 rounded border w-fit block uppercase tracking-wide ${riskColor}`}>
                {riskStatus}
              </span>
            </div>
            <div>
              <span className="text-sm text-slate-500 font-black uppercase block tracking-wider">FLOATING LIVE P&L</span>
              <span className={`text-sm font-black font-mono mt-0.5 block ${livePnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {livePnL >= 0 ? "+" : ""}₹{livePnL.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
              </span>
            </div>
          </div>
        </div>

        {/* Center Section: Trade Parameters & Order targets (If BUY is active) */}
        <div className="flex-1 lg:max-w-[340px] p-4 rounded-lg bg-slate-950/40 border border-slate-900 flex flex-col justify-between">
          <div className="space-y-2">
            <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
              EXECUTION PARAMETERS
            </span>

            {decision !== "WAIT" && decision !== "NO_TRADE" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                  <div className="p-2 rounded border border-slate-900 bg-slate-900/10">
                    <span className="text-sm text-slate-500 block uppercase font-black">ENTRY TRIGGER</span>
                    <span className="text-base text-white font-black mt-1 block">₹{entry.toFixed(1)}</span>
                  </div>
                  <div className="p-2 rounded border border-red-950/20 bg-red-950/5">
                    <span className="text-sm text-red-500 block uppercase font-black">STOP LOSS</span>
                    <span className="text-base text-red-400 font-black mt-1 block">₹{sl.toFixed(1)}</span>
                  </div>
                  <div className="p-2 rounded border border-emerald-950/20 bg-emerald-950/5">
                    <span className="text-sm text-emerald-500 block uppercase font-black">TARGET</span>
                    <span className="text-base text-emerald-400 font-black mt-1 block">₹{target.toFixed(1)}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-sm text-slate-400 font-mono">
                  <span>Risk-to-Reward Ratio:</span>
                  <span className="text-indigo-400 font-black">
                    1 : {entry !== sl ? Math.abs((target - entry) / (entry - sl)).toFixed(2) : "2.00"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 text-sm text-slate-600 font-mono italic">
                Awaiting active layer trigger conditions...
              </div>
            )}
          </div>

          <div className="text-sm text-slate-600 leading-normal font-mono border-t border-slate-900 pt-2.5 mt-2 flex items-start gap-1">
            <span className="text-indigo-400 text-sm leading-none">⚙</span>
            <span>Risk Sizing calculated by Layer 16. Executed paper entries are subject to ₹1,500 daily loss breaker limits.</span>
          </div>
        </div>

        {/* Right Section: Reason Stack Checklist */}
        <div className="flex-1 lg:max-w-[280px] space-y-3">
          <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
            LAYER ALIGNMENT STACK
          </span>

          <div className="space-y-1.5 font-mono text-sm">
            {reasonStack.length > 0 ? (
              reasonStack.map((reason, idx) => (
                <div key={idx} className="flex items-center gap-2 p-1.5 rounded bg-slate-900/30 border border-slate-900/60 text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
                  <span className="truncate">{reason}</span>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-sm text-slate-600 italic">
                No alignment logs recorded in current tick.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MiniChainTable: React.FC<{ strikes: any[]; spotPrice: number }> = ({ strikes, spotPrice }) => {
  if (!strikes || strikes.length === 0) return null;

  const sorted = [...strikes].sort((a, b) => a.strikePrice - b.strikePrice);

  const formatCompactVal = (val: number) => {
    if (!val) return "0.0K";
    if (val >= 100000) return (val / 100000).toFixed(1) + "L";
    if (val >= 1000) return (val / 1000).toFixed(0) + "K";
    return val.toString();
  };

  return (
    <div className="mt-2 rounded-lg border border-slate-800/40 bg-slate-950/80 overflow-hidden text-[9px] font-mono z-10 w-full">
      <div className="grid grid-cols-5 bg-slate-900/60 text-slate-500 font-black uppercase text-[7.5px] py-1 text-center border-b border-slate-800/45">
        <span>Call OI</span>
        <span>LTP</span>
        <span className="text-indigo-400 font-bold">Strike</span>
        <span>LTP</span>
        <span>Put OI</span>
      </div>
      <div className="divide-y divide-slate-900/40">
        {sorted.map((row) => {
          const isNear = spotPrice > 0 && Math.abs(row.strikePrice - spotPrice) <= 50;
          return (
            <div 
              key={row.strikePrice} 
              className={`grid grid-cols-5 py-0.5 text-center items-center hover:bg-slate-900/35 transition-colors ${
                isNear ? "bg-indigo-500/10 text-indigo-200 border-y border-indigo-500/20" : "text-slate-400"
              }`}
            >
              <span className="text-red-400/90 font-bold">{formatCompactVal(row.ceOI || row.ceOi)}</span>
              <span className="text-slate-500 font-semibold">{((row.ceLtp ?? 0)).toFixed(1)}</span>
              <span className="text-white font-extrabold text-[9.5px]">{row.strikePrice}</span>
              <span className="text-slate-500 font-semibold">{((row.peLtp ?? 0)).toFixed(1)}</span>
              <span className="text-emerald-400/90 font-bold">{formatCompactVal(row.peOI || row.peOi)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MultiExpiryMetricsCard: React.FC<{
  activePage: string;
  weeklyPcr: number;
  weeklySupport: number;
  weeklyResistance: number;
  nextWeeklyExpiry?: string;
  nextWeeklyMetrics?: any;
  monthlyExpiry?: string;
  monthlyMetrics?: any;
  spotPrice?: number;
  optionChain?: OptionStrike[];
}> = ({
  activePage,
  weeklyPcr,
  weeklySupport,
  weeklyResistance,
  nextWeeklyExpiry,
  nextWeeklyMetrics,
  monthlyExpiry,
  monthlyMetrics,
  spotPrice = 0,
  optionChain = [],
}) => {
  const formatExpiry = (val?: string) => {
    if (!val) return "Loading...";
    if (/^\d+$/.test(val)) {
      const ts = parseInt(val, 10);
      const ms = ts < 10000000000 ? ts * 1000 : ts;
      return new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    }
    return val.split("-").slice(0, 2).join(" ");
  };

  const formatLakh = (n: number) => {
    if (!n) return "0.00L";
    return (n / 100000).toFixed(2) + "L";
  };

  // Weekly OI calculation
  const weeklyCallOi = useMemo(() => optionChain.reduce((acc, curr) => acc + (curr.ceOI || 0), 0), [optionChain]);
  const weeklyPutOi = useMemo(() => optionChain.reduce((acc, curr) => acc + (curr.peOI || 0), 0), [optionChain]);

  // Map active Weekly Option strikes
  const weeklyStrikes = useMemo(() => {
    if (!optionChain || optionChain.length === 0) return [];
    const sorted = [...optionChain].sort((a, b) => a.strikePrice - b.strikePrice);
    let ci = -1;
    let md = Infinity;
    sorted.forEach((s, idx) => {
      const d = Math.abs(s.strikePrice - spotPrice);
      if (d < md) {
        md = d;
        ci = idx;
      }
    });
    return sorted.slice(Math.max(0, ci - 3), Math.min(sorted.length, ci + 4)).map(s => ({
      strikePrice: s.strikePrice,
      ceOI: s.ceOI,
      ceLtp: s.ceLtp ?? 0,
      peOI: s.peOI,
      peLtp: s.peLtp ?? 0
    }));
  }, [optionChain, spotPrice]);

  // Mini PCR Arc Sub-component for premium aesthetics
  const renderPcrArc = (pcrVal: number) => {
    const size = 52;
    const strokeWidth = 5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const score = Math.min(100, Math.max(0, (pcrVal / 2) * 100)); 
    const strokeDashoffset = circumference - (score / 100) * circumference;

    const color = pcrVal >= 1.2 ? "#10b981" : 
                  pcrVal >= 0.95 ? "#14b8a6" : 
                  pcrVal >= 0.85 ? "#f59e0b" : "#ef4444";

    return (
      <div className="relative flex items-center justify-center animate-pulse" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={strokeWidth} />
          <circle 
            cx={size/2} 
            cy={size/2} 
            r={radius} 
            fill="none" 
            stroke={color} 
            strokeWidth={strokeWidth} 
            strokeDasharray={circumference} 
            strokeDashoffset={strokeDashoffset} 
            strokeLinecap="round" 
            transform={`rotate(-90 ${size/2} ${size/2})`} 
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <span className="absolute text-[11px] font-black font-mono text-white">{pcrVal.toFixed(2)}</span>
      </div>
    );
  };

  // Spot price position slider helper
  const renderSpotRangeBar = (support: number, resistance: number, currentSpot: number) => {
    if (!support || !resistance || !currentSpot) return null;
    const totalRange = resistance - support;
    if (totalRange <= 0) return null;
    const spotPct = Math.min(100, Math.max(0, ((currentSpot - support) / totalRange) * 100));

    return (
      <div className="space-y-1 pt-1 z-10">
        <div className="flex justify-between text-[8px] font-bold text-slate-500 font-mono">
          <span>SUP: {support.toLocaleString("en-IN")}</span>
          <span>RES: {resistance.toLocaleString("en-IN")}</span>
        </div>
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden relative">
          <div className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 rounded-full" style={{ width: "100%" }} />
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-indigo-400 rounded-full shadow-[0_0_6px_rgba(129,140,248,0.8)] border border-slate-900"
            style={{ left: `${spotPct}%`, transform: "translate(-50%, -50%)", transition: "left 0.6s ease" }}
          />
        </div>
        <div className="flex justify-between text-[7px] font-semibold text-slate-500 font-mono">
          <span>PE WALL</span>
          <span className="text-indigo-400 font-bold">SPOT: {currentSpot.toLocaleString("en-IN", { minimumFractionDigits: 1 })}</span>
          <span>CE WALL</span>
        </div>
      </div>
    );
  };

  // OI Split Bar helper
  const renderOiSplitBar = (callOi: number, putOi: number) => {
    const total = callOi + putOi;
    if (total <= 0) return null;
    const callPct = (callOi / total) * 100;
    const putPct = (putOi / total) * 100;

    return (
      <div className="space-y-1 z-10">
        <div className="flex justify-between text-[8px] font-bold font-mono">
          <span className="text-rose-400">CE: {formatLakh(callOi)}</span>
          <span className="text-emerald-400">{formatLakh(putOi)} :PE</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div className="h-full bg-gradient-to-r from-rose-600 to-rose-400" style={{ width: `${callPct}%` }} />
          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${putPct}%` }} />
        </div>
        <div className="flex justify-between text-[8px] font-semibold text-slate-500 font-mono">
          <span>{callPct.toFixed(1)}%</span>
          <span>OI SPLIT</span>
          <span>{putPct.toFixed(1)}%</span>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-white/5 p-4.5 space-y-3.5 select-none" style={{
      background: "linear-gradient(135deg, #030712 0%, #0b1329 60%, #030712 100%)",
      boxShadow: "0 4px 24px rgba(0, 0, 0, 0.45)"
    }}>
      <div className="flex items-center justify-between border-b border-slate-800/50 pb-2.5">
        <h3 className="text-sm font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
          🏛️ INSTITUTION OPTION SUMMARY DESK ({activePage})
        </h3>
        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800/40">
          Layer 5 Telemetry
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Column 1: Current Weekly */}
        <div className="p-3.5 rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-950/15 to-slate-900/60 shadow-[0_0_15px_rgba(20,184,166,0.03)] space-y-3 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 rounded-full blur-2xl" />
          <div className="flex justify-between items-center border-b border-slate-800/30 pb-1.5 z-10">
            <span className="text-[11px] font-black text-teal-400 uppercase tracking-widest flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping" />
              Weekly Expiry
            </span>
            <span className="text-[9px] font-mono font-black text-teal-400 bg-teal-500/10 px-1.5 py-0.2 rounded border border-teal-500/20">
              ACTIVE
            </span>
          </div>
          
          <div className="flex justify-between items-center z-10 py-1.5">
            <div className="flex flex-col">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Weekly PCR</span>
              <span className={`text-xs font-black px-1.5 py-0.5 mt-1 rounded text-center text-[10px] ${
                weeklyPcr > 1.15 ? "bg-emerald-500/15 text-emerald-400" : 
                weeklyPcr < 0.85 ? "bg-rose-500/15 text-rose-400" : "bg-slate-800 text-slate-400"
              }`}>
                {weeklyPcr > 1.15 ? "🐂 BULLISH" : weeklyPcr < 0.85 ? "🐻 BEARISH" : "⚖️ NEUTRAL"}
              </span>
            </div>
            {renderPcrArc(weeklyPcr)}
          </div>

          {renderOiSplitBar(weeklyCallOi, weeklyPutOi)}
          {renderSpotRangeBar(weeklySupport, weeklyResistance, spotPrice)}
          <MiniChainTable strikes={weeklyStrikes} spotPrice={spotPrice} />
        </div>

        {/* Column 2: Next Weekly */}
        <div className="p-3.5 rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/10 to-slate-900/60 shadow-[0_0_15px_rgba(99,102,241,0.02)] space-y-3 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl" />
          <div className="flex justify-between items-center border-b border-slate-800/30 pb-1.5 z-10">
            <span className="text-[11px] font-black text-indigo-400 uppercase tracking-widest">
              ⏳ Next Weekly
            </span>
            <span className="text-[10px] font-mono font-bold text-slate-500">
              {formatExpiry(nextWeeklyExpiry)}
            </span>
          </div>

          {nextWeeklyMetrics ? (
            <>
              <div className="flex justify-between items-center z-10 py-1.5">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Next PCR</span>
                  <span className={`text-xs font-black px-1.5 py-0.5 mt-1 rounded text-center text-[10px] ${
                    nextWeeklyMetrics.sentiment.includes("Bullish") ? "bg-emerald-500/15 text-emerald-400" : 
                    nextWeeklyMetrics.sentiment.includes("Bearish") ? "bg-rose-500/15 text-rose-400" : "bg-slate-800 text-slate-400"
                  }`}>
                    {nextWeeklyMetrics.sentiment.toUpperCase()}
                  </span>
                </div>
                {renderPcrArc(nextWeeklyMetrics.pcr)}
              </div>

              {renderOiSplitBar(nextWeeklyMetrics.totalCallOi, nextWeeklyMetrics.totalPutOi)}
              {renderSpotRangeBar(nextWeeklyMetrics.supportWall, nextWeeklyMetrics.resistanceWall, spotPrice)}
              <MiniChainTable strikes={nextWeeklyMetrics.strikes} spotPrice={spotPrice} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[10px] text-slate-600 italic font-mono py-12">
              Fetching next-weekly data...
            </div>
          )}
        </div>

        {/* Column 3: Monthly Expiry */}
        <div className="p-3.5 rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-950/15 to-slate-900/60 shadow-[0_0_15px_rgba(245,158,11,0.03)] space-y-3 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl" />
          <div className="flex justify-between items-center border-b border-slate-800/30 pb-1.5 z-10">
            <span className="text-[11px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1">
              📅 Monthly Expiry
            </span>
            <span className="text-[10px] font-mono font-bold text-slate-500">
              {formatExpiry(monthlyExpiry)}
            </span>
          </div>

          {monthlyMetrics ? (
            <>
              <div className="flex justify-between items-center z-10 py-1.5">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Monthly PCR</span>
                  <span className={`text-xs font-black px-1.5 py-0.5 mt-1 rounded text-center text-[10px] ${
                    monthlyMetrics.sentiment.includes("Bullish") ? "bg-emerald-500/15 text-emerald-400" : 
                    monthlyMetrics.sentiment.includes("Bearish") ? "bg-rose-500/15 text-rose-400" : "bg-slate-800 text-slate-400"
                  }`}>
                    {monthlyMetrics.sentiment.toUpperCase()}
                  </span>
                </div>
                {renderPcrArc(monthlyMetrics.pcr)}
              </div>

              {renderOiSplitBar(monthlyMetrics.totalCallOi, monthlyMetrics.totalPutOi)}
              {renderSpotRangeBar(monthlyMetrics.supportWall, monthlyMetrics.resistanceWall, spotPrice)}
              <MiniChainTable strikes={monthlyMetrics.strikes} spotPrice={spotPrice} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[10px] text-slate-600 italic font-mono py-12">
              Fetching monthly data...
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

const Engines: React.FC<EnginesProps> = (props) => {
  const {
    activePage,
    currentSpot,
    range15m,
    overallScore,
    score5mNet,
    score15mNet,
    t10,
    t15,
    top25Score,
    top25ScoreDiff,
    pcr,
    advances,
    declines,
    support,
    resistance,
    stocks,
    top25Stocks,
    regimeResult,
    optionChain,
    score30mNet,
    score1hNet,
    totalVolume,
    scoreBackup,
    indiaVix,
    spotChangePct,
    rtpodeResult,
    monthlyMetrics,
    nextWeeklyMetrics,
    monthlyExpiry,
    nextWeeklyExpiry,
  } = props;

  // Strategy Module switch memory persistence state
  const [lastActiveStrategy, setLastActiveStrategy] = useState<string>("NO_STRATEGY");
  const [previousStrategyScore, setPreviousStrategyScore] = useState<number>(0);
  const [switchHistory, setSwitchHistory] = useState<string[]>([]);

  // Ticking clock state for Session Time Engine L1-16 Regulator
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  const marketTimeResult = useMemo(() => {
    return computeMarketTime(currentTime);
  }, [currentTime]);

  // Aggregate 30M and 1H diffs from stocks if not provided
  const agg30mNet = score30mNet ?? stocks.reduce((a: number, s: any) => a + (s.score30mDiff || 0), 0);
  const agg1hNet  = score1hNet  ?? stocks.reduce((a: number, s: any) => a + (s.score1hDiff  || 0), 0);
  const aggVolume = totalVolume ?? stocks.reduce((a: number, s: any) => a + (s.volume       || 0), 0);
  const changePercent = stocks.length > 0
    ? stocks.reduce((a: number, s: any) => a + (s.changePercent || 0), 0) / stocks.length
    : 0;

  // Count ready layers in registry
  const readyCount = useMemo(() => LAYER_REGISTRY.filter((l) => l.status === "READY").length, []);

  // Compute breadthResult for Layer 3 consumption
  const breadthResult = useMemo(() =>
    computeMarketBreadth({
      advances,
      declines,
      totalStocks: stocks.length,
      stocks: stocks.map((s: any) => ({
        symbol: s.symbol,
        score: s.score,
        weightage: s.weightage,
        changePercent: s.changePercent,
        scoreDifference: s.scoreDifference,
      })),
      top25Stocks: top25Stocks.map((s: any) => ({
        symbol: s.symbol,
        score: s.score,
        weightage: s.weightage,
        changePercent: s.changePercent,
        scoreDifference: s.scoreDifference,
      })),
      overallScore,
      t10,
      t15,
      top25ScoreDiff,
      spotPrice: currentSpot,
      regimeResult,
    }),
    [advances, declines, stocks, top25Stocks, overallScore, t10, t15, top25ScoreDiff, currentSpot, regimeResult]
  );

  // Compute heavyweightResult for Layer 4/5 consumption
  const heavyweightResult = useMemo(() =>
    computeHeavyweight({
      stocks: stocks.map((s: any) => ({
        symbol: s.symbol,
        weightage: s.weightage,
        score: s.score,
        scoreDifference: s.scoreDifference,
        score15mDiff: s.score15mDiff || 0,
        score30mDiff: s.score30mDiff || 0,
        score1hDiff: s.score1hDiff || 0,
        changePercent: s.changePercent,
        ltp: s.ltp,
        volume: s.volume,
      })),
      regimeResult,
      breadthResult,
    }),
    [stocks, regimeResult, breadthResult]
  );

  // Compute range15mResult for Layer 5/6 range alignment
  const range15mResult = useMemo(() =>
    computeRange15M({
      spotPrice: currentSpot,
      rangeHigh: range15m.high,
      rangeLow: range15m.low,
      isFallback: range15m.isFallback ?? true,
      regimeResult,
      breadthResult,
      heavyweightResult,
    }),
    [currentSpot, range15m, regimeResult, breadthResult, heavyweightResult]
  );

  // Compute optionChainResult for Layer 6/7 consumption
  const optionChainResult = useMemo(() =>
    computeOptionChain({
      strikes: (optionChain ?? []) as any,
      spotPrice: currentSpot,
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
    }),
    [optionChain, currentSpot, regimeResult, breadthResult, heavyweightResult, range15mResult]
  );

  // Compute momentumResult for Layer 7 consumption
  const momentumResult = useMemo(() =>
    computeMomentum({
      overallScore,
      scoreDifference: score5mNet,
      score15mDiff: score15mNet,
      score30mDiff: agg30mNet,
      score1hDiff: agg1hNet,
      changePercent,
      volume: aggVolume,
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
    }),
    [overallScore, score5mNet, score15mNet, agg30mNet, agg1hNet, changePercent, aggVolume,
     regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult]
  );

  // Compute OI totals for Layer 7 Smart Money Engine
  const oiTotals = useMemo(() => {
    const chain = optionChain ?? [];
    return {
      totalCallOI:       chain.reduce((a: number, s: any) => a + (s.ceOI       || 0), 0),
      totalPutOI:        chain.reduce((a: number, s: any) => a + (s.peOI       || 0), 0),
      totalCallOIChange: chain.reduce((a: number, s: any) => a + (s.ceOIChange || 0), 0),
      totalPutOIChange:  chain.reduce((a: number, s: any) => a + (s.peOIChange || 0), 0),
      totalCallVolume:   chain.reduce((a: number, s: any) => a + (s.ceVolume   || 0), 0),
      totalPutVolume:    chain.reduce((a: number, s: any) => a + (s.peVolume   || 0), 0),
    };
  }, [optionChain]);

  // Compute smartMoneyResult for Layer 8/9 consumption
  const smartMoneyResult = useMemo(() =>
    computeSmartMoney({
      regimeResult, breadthResult, heavyweightResult, range15mResult,
      optionChainResult, momentumResult,
      pcr,
      totalCallOI:       oiTotals.totalCallOI,
      totalPutOI:        oiTotals.totalPutOI,
      totalCallOIChange: oiTotals.totalCallOIChange,
      totalPutOIChange:  oiTotals.totalPutOIChange,
      totalCallVolume:   oiTotals.totalCallVolume,
      totalPutVolume:    oiTotals.totalPutVolume,
      overallScore,
      scoreDifference: score5mNet,
      score15mDiff: score15mNet,
      volume: aggVolume,
      changePercent,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, pcr, oiTotals,
     overallScore, score5mNet, score15mNet, aggVolume, changePercent]
  );

  // Compute probabilityResult for Layer 9 consumption
  const probabilityResult = useMemo(() =>
    computeProbability({
      regimeResult, breadthResult, heavyweightResult, range15mResult,
      optionChainResult, momentumResult,
      smartMoneyResult,
      pcr,
      optionChain,
      spotPrice: currentSpot,
      score15mDiff: score15mNet,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, pcr, optionChain, currentSpot, score15mNet]
  );

  // Compute entryZoneResult for Layer 10 consumption
  const entryZoneResult = useMemo(() =>
    computeEntryZone({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      spotPrice: currentSpot,
      rangeHigh: range15m.high,
      rangeLow: range15m.low,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     currentSpot, range15m]
  );

  // Compute strategyAlignmentResult for Layer 11 consumption
  const strategyAlignmentResult = useMemo(() =>
    computeStrategyAlignment({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      entryZoneResult,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult]
  );

  // Compute aiDecisionResult for Layer 12 consumption
  const aiDecisionResult = useMemo(() =>
    computeAIDecision({
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
      indiaVix,
      spotChangePct,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult, strategyAlignmentResult, indiaVix, spotChangePct]
  );

  // State for paper trades loaded from DB
  const [dbTrades, setDbTrades] = useState<any[]>([]);

  const loadTrades = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/te/paper-trades"));
      if (res.ok) {
        const d = await res.json();
        setDbTrades(d.trades || []);
      }
    } catch (e) {
      console.error("Failed to load paper trades in Engines:", e);
    }
  }, []);

  useEffect(() => {
    loadTrades();
    const interval = setInterval(loadTrades, 4000);
    return () => clearInterval(interval);
  }, [loadTrades]);

  // Compute L12 Opportunities
  const opportunityResult = useMemo(() =>
    computeOpportunities({
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
      spotPrice: currentSpot,
      activePage,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult, strategyAlignmentResult, aiDecisionResult, currentSpot, activePage]
  );

  // Compute L13 Strategies
  const strategiesResult = useMemo(() =>
    computeStrategies({
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
      opportunityResult,
      spotPrice: currentSpot,
      activePage,
      previousActiveStrategy: lastActiveStrategy,
      previousStrategyScore,
      marketTimeResult,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult, momentumResult, smartMoneyResult, probabilityResult, entryZoneResult, strategyAlignmentResult, aiDecisionResult, opportunityResult, currentSpot, activePage, lastActiveStrategy, previousStrategyScore, marketTimeResult]
  );

  // Sync Strategy switch persistence history in React state
  useEffect(() => {
    const active = strategiesResult.activeStrategy;
    const score = strategiesResult.strategyScore;
    if (active && active !== "NO_STRATEGY" && active !== lastActiveStrategy) {
      setLastActiveStrategy(active);
      setPreviousStrategyScore(score);
      setSwitchHistory(prev => {
        const next = [active, ...prev.filter(x => x !== active)];
        return next.slice(0, 3);
      });
    }
  }, [strategiesResult.activeStrategy, strategiesResult.strategyScore, lastActiveStrategy]);

  // Compute Option Flow and EAME telemetry
  const optionFlowResult = useMemo(() =>
    computeOptionFlow({
      optionChain: optionChain ?? [],
      spotPrice: currentSpot,
      activePage,
      strategiesResult,
      aiDecisionResult,
      currentTimeMs: currentTime,
    }),
    [optionChain, currentSpot, activePage, strategiesResult, aiDecisionResult, currentTime]
  );

  // Compute L14 Paper Trading
  const paperTradingResult = useMemo(() =>
    computePaperTrading({
      entryZoneResult,
      strategyAlignmentResult,
      aiDecisionResult,
      opportunityResult,
      strategiesResult,
      spotPrice: currentSpot,
      activePage,
      dbTrades,
      marketTimeResult,
      optionFlowResult,
      volatilityScore: probabilityResult.volatilityScore,
      optionChain,
    }),
    [entryZoneResult, strategyAlignmentResult, aiDecisionResult, opportunityResult, strategiesResult, currentSpot, activePage, dbTrades, marketTimeResult, optionFlowResult, probabilityResult.volatilityScore, optionChain]
  );

  // Compute L15 Performance
  const performanceResult = useMemo(() =>
    computePerformance({
      paperTradingOutput: paperTradingResult,
      dbTrades,
    }),
    [paperTradingResult, dbTrades]
  );

  // Compute L16 Risk
  const riskResult = useMemo(() =>
    computeRisk({
      paperTradingOutput: paperTradingResult,
      performanceResult,
      spotPrice: currentSpot,
      activePage,
      indiaVix,
      regimeType: regimeResult.regime,
      aiConfidence: aiDecisionResult.decisionConfidence,
      optionChain,
    }),
    [paperTradingResult, performanceResult, currentSpot, activePage, indiaVix, regimeResult.regime, aiDecisionResult.decisionConfidence, optionChain]
  );

  // ── Compute Master Trade Card variables ──
  const opportunityRank = useMemo(() => {
    if (!opportunityResult.topOpportunity) return 3;
    if (opportunityResult.topOpportunity.symbol === activePage) return 1;
    const idx = opportunityResult.opportunities.findIndex(o => o.symbol === activePage);
    if (idx !== -1) return idx + 1;
    return 3;
  }, [opportunityResult, activePage]);

  const riskStatus = useMemo(() => {
    if (!riskResult.tradeAllowed || riskResult.circuitBreakerStatus === "HALT") return "BLOCKED";
    if (riskResult.circuitBreakerStatus === "WARNING" || riskResult.circuitBreakerStatus === "ACTIVE") return "WARNING";
    return "SAFE";
  }, [riskResult]);

  const openPositionsWithLtp = useMemo(() => {
    return paperTradingResult.openPositions.map(pos => {
      const strikeData = (optionChain ?? []).find((s: any) => s.strikePrice === pos.strike);
      let currentPremium = pos.entry_price;

      if (strikeData) {
        currentPremium = pos.direction === "BUY_CE" 
          ? (strikeData.ceLtp ?? strikeData.ceBid ?? pos.entry_price)
          : (strikeData.peLtp ?? strikeData.peBid ?? pos.entry_price);
      }
      
      const livePnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;

      return {
        ...pos,
        currentPremium,
        livePnl: parseFloat(livePnl.toFixed(1)),
      };
    });
  }, [paperTradingResult.openPositions, optionChain]);

  const livePnL = useMemo(() => {
    return openPositionsWithLtp.reduce((sum, p) => sum + p.livePnl, 0);
  }, [openPositionsWithLtp]);

  const reasonStack = useMemo(() => {
    const list: string[] = [];
    
    // Regime
    if (regimeResult?.regime) {
      list.push(`Regime: ${regimeResult.regime.replace(/_/g, " ")}`);
    }
    // Breadth
    if (breadthResult?.breadthScore !== undefined) {
      list.push(`Breadth Score: ${breadthResult.breadthScore}/100 (${breadthResult.breadthBias || "NEUTRAL"})`);
    }
    // Heavyweight
    if (heavyweightResult?.heavyweightScore !== undefined) {
      list.push(`Heavyweight Pressure: ${heavyweightResult.heavyweightScore}/100`);
    }
    // Option Chain PCR
    if (optionChainResult?.pcr !== undefined) {
      list.push(`PCR Ratio: ${optionChainResult.pcr.toFixed(2)} (${optionChainResult.institutionalBias || "NEUTRAL"})`);
    }
    // Momentum
    if (momentumResult?.momentumScore !== undefined) {
      list.push(`Momentum: ${momentumResult.momentumScore}/100 (Grade ${momentumResult.momentumGrade || "D"})`);
    }
    // Smart Money
    if (smartMoneyResult?.smartMoneyScore !== undefined) {
      list.push(`Smart Money Score: ${smartMoneyResult.smartMoneyScore}/100 (${smartMoneyResult.flowDirection || "NEUTRAL"})`);
    }
    // Probability
    if (probabilityResult?.confidenceLevel !== undefined) {
      list.push(`Probability edge: ${probabilityResult.confidenceLevel}%`);
    }
    
    return list.slice(0, 4); // Limit to top 4 reasons
  }, [regimeResult, breadthResult, heavyweightResult, optionChainResult, momentumResult, smartMoneyResult, probabilityResult]);

  return (
    <div className="p-4 space-y-6" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/40 pb-4">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <Layers size={18} className="text-indigo-400" /> Trading Engine Workspace
          </h1>
          <p className="text-base text-slate-500 mt-0.5">
            Institutional 16-Layer intelligence stack · {activePage} Instruments
          </p>
        </div>

        {/* Global Pipeline Status */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg border border-slate-800/80 bg-[#08101a] flex items-center gap-2">
            <Activity size={12} className="text-indigo-400 animate-pulse" />
            <div className="text-sm font-bold text-slate-400">
              Pipeline Active: <span className="text-indigo-400">{readyCount} / 16 Layers Ready</span>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg border border-emerald-900/30 bg-emerald-900/5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <div className="text-sm font-black font-mono text-emerald-400 uppercase tracking-wider">
              Feed: Live Data Stream
            </div>
          </div>
        </div>
      </div>

      {/* ── MASTER TRADE CARD (CONSOLIDATED PIPELINE OUTPUT) ──────────────── */}
      <MasterTradeCard
        symbol={activePage}
        decision={aiDecisionResult.finalDecision}
        confidence={aiDecisionResult.confidence}
        entry={entryZoneResult.entryPrice || currentSpot}
        sl={entryZoneResult.stopLoss}
        target={entryZoneResult.target}
        strategy={strategiesResult.activeStrategy}
        opportunityRank={opportunityRank}
        riskStatus={riskStatus}
        livePnL={livePnL}
        reasonStack={reasonStack}
      />

      {/* ── MULTI-EXPIRY OPTION CHAIN DECK ─────────────────────────────── */}
      <MultiExpiryMetricsCard
        activePage={activePage}
        weeklyPcr={pcr}
        weeklySupport={support}
        weeklyResistance={resistance}
        nextWeeklyExpiry={nextWeeklyExpiry}
        nextWeeklyMetrics={nextWeeklyMetrics}
        monthlyExpiry={monthlyExpiry}
        monthlyMetrics={monthlyMetrics}
        spotPrice={currentSpot}
        optionChain={optionChain}
      />

      {/* ── L14 SIMULATED AUTO TRADING CONSOLE (Quick Access) ── */}
      <PaperTradingCard
        activePage={activePage}
        spotPrice={currentSpot}
        entryZoneResult={entryZoneResult}
        strategyAlignmentResult={strategyAlignmentResult}
        aiDecisionResult={aiDecisionResult}
        opportunityResult={opportunityResult}
        strategiesResult={strategiesResult}
        dbTrades={dbTrades}
        optionChain={optionChain ?? []}
        onTradePlaced={loadTrades}
        marketTimeResult={marketTimeResult}
        momentumResult={momentumResult}
        smartMoneyResult={smartMoneyResult}
        volatilityScore={probabilityResult.volatilityScore}
        riskResult={riskResult}
      />

      {/* ── MARKET TIME CARD (LIVE SESSION REGULATOR) ───────────────────── */}
      <MarketTimeCard marketTimeResult={marketTimeResult} />

            {/* ── LIVE ACTIVE ENGINES ─────────────────────────────────────────── */}
      <div className="space-y-3 mt-4">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles size={13} className="text-indigo-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
            All Active Layer Outputs (L1 - L16)
          </h2>
        </div>
        <div><AIDecisionCard
                activePage={activePage}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
                momentumResult={momentumResult}
                smartMoneyResult={smartMoneyResult}
                probabilityResult={probabilityResult}
                entryZoneResult={entryZoneResult}
                strategyAlignmentResult={strategyAlignmentResult}
                indiaVix={indiaVix}
                spotChangePct={spotChangePct}
              /></div>
        <div className="mt-3"><EntryZoneCard
                activePage={activePage}
                spotPrice={currentSpot}
                rangeHigh={range15m.high}
                rangeLow={range15m.low}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
                momentumResult={momentumResult}
                smartMoneyResult={smartMoneyResult}
                probabilityResult={probabilityResult}
              /></div>
        <div className="mt-3"><StrategyAlignmentCard
                activePage={activePage}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
                momentumResult={momentumResult}
                smartMoneyResult={smartMoneyResult}
                probabilityResult={probabilityResult}
                entryZoneResult={entryZoneResult}
              /></div>
        <div className="mt-3"><OpportunityCard
                activePage={activePage}
                spotPrice={currentSpot}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
                momentumResult={momentumResult}
                smartMoneyResult={smartMoneyResult}
                probabilityResult={probabilityResult}
                entryZoneResult={entryZoneResult}
                strategyAlignmentResult={strategyAlignmentResult}
                aiDecisionResult={aiDecisionResult}
              /></div>
        <div className="mt-3"><StrategiesCard
                activePage={activePage}
                spotPrice={currentSpot}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
                momentumResult={momentumResult}
                smartMoneyResult={smartMoneyResult}
                probabilityResult={probabilityResult}
                entryZoneResult={entryZoneResult}
                strategyAlignmentResult={strategyAlignmentResult}
                aiDecisionResult={aiDecisionResult}
                opportunityResult={opportunityResult}
                previousActiveStrategy={lastActiveStrategy}
                previousStrategyScore={previousStrategyScore}
                switchHistory={switchHistory}
                marketTimeResult={marketTimeResult}
              /></div>
        <div className="mt-3"><ProbabilityCard
                activePage={activePage}
                pcr={pcr}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
                momentumResult={momentumResult}
                smartMoneyResult={smartMoneyResult}
              /></div>
        <div className="mt-3"><SmartMoneyCard
                activePage={activePage}
                pcr={pcr}
                totalCallOI={oiTotals.totalCallOI}
                totalPutOI={oiTotals.totalPutOI}
                totalCallOIChange={oiTotals.totalCallOIChange}
                totalPutOIChange={oiTotals.totalPutOIChange}
                totalCallVolume={oiTotals.totalCallVolume}
                totalPutVolume={oiTotals.totalPutVolume}
                overallScore={overallScore}
                scoreDifference={score5mNet}
                score15mDiff={score15mNet}
                volume={aggVolume}
                changePercent={changePercent}
                scoreBackup={scoreBackup}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
                momentumResult={momentumResult}
              /></div>
        <div className="mt-3"><MomentumCard
                activePage={activePage}
                overallScore={overallScore}
                scoreDifference={score5mNet}
                score15mDiff={score15mNet}
                score30mDiff={agg30mNet}
                score1hDiff={agg1hNet}
                changePercent={changePercent}
                volume={aggVolume}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
                range15mResult={range15mResult}
                optionChainResult={optionChainResult}
              /></div>
        <div className="mt-3"><Range15MCard
                activePage={activePage}
                spotPrice={currentSpot}
                rangeHigh={range15m.high}
                rangeLow={range15m.low}
                isFallback={range15m.isFallback || false}
                regimeResult={regimeResult}
                breadthResult={breadthResult}
                heavyweightResult={heavyweightResult}
              /></div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-3">
            <div className="flex flex-col"><MarketRegimeCard
                  activePage={activePage}
                  currentSpot={currentSpot}
                  range15m={range15m}
                  overallScore={overallScore}
                  score5mNet={score5mNet}
                  score15mNet={score15mNet}
                  t10={t10}
                  t15={t15}
                  top25Score={top25Score}
                  top25ScoreDiff={top25ScoreDiff}
                  pcr={pcr}
                  advances={advances}
                  declines={declines}
                  support={support}
                  resistance={resistance}
                  darkMode={true}
                /></div>
            <div className="flex flex-col">
              <MarketBreadthCard
                activePage={activePage}
                advances={advances}
                declines={declines}
                overallScore={overallScore}
                t10={t10}
                t15={t15}
                top25ScoreDiff={top25ScoreDiff}
                currentSpot={currentSpot}
                stocks={stocks}
                top25Stocks={top25Stocks}
                regimeResult={regimeResult}
                darkMode={true}
              />
            </div>
        </div>

        <div className="mt-3">
          <HeavyweightCard
            activePage={activePage}
            stocks={stocks}
            regimeResult={regimeResult}
            breadthResult={breadthResult}
          />
        </div>
        <div className="mt-3">
          <OptionChainCard
            activePage={activePage}
            spotPrice={currentSpot}
            optionChain={optionChain ?? []}
            regimeResult={regimeResult}
            breadthResult={breadthResult}
            heavyweightResult={heavyweightResult}
            range15mResult={range15mResult}
          />
        </div>
        <div className="mt-3">
          <PerformanceCard
            activePage={activePage}
            paperTradingOutput={paperTradingResult}
            dbTrades={dbTrades}
          />
        </div>
        <div className="mt-3">
          <RiskCard
            activePage={activePage}
            spotPrice={currentSpot}
            paperTradingOutput={paperTradingResult}
            performanceResult={performanceResult}
            indiaVix={indiaVix}
            regimeType={regimeResult.regime}
            aiConfidence={aiDecisionResult.decisionConfidence}
          />
        </div>
      </div>
      {/* ── PIPELINE ARCHITECTURE REGISTRY ─────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <Database size={13} className="text-indigo-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
            16-Layer Intelligence Pipeline
          </h2>
        </div>

        {/* Info Box */}
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/20 p-3 text-sm text-slate-400 flex items-start gap-2.5">
          <AlertCircle size={14} className="text-slate-500 mt-0.5 flex-shrink-0" />
          <div>
            Each layer in the registry compiles real-time parameters by subscribing to upstream engine outputs.
            Layers must be built sequentially to guarantee pipeline alignment. Layers marked as <span className="text-emerald-400 font-bold">READY</span> are currently processing active live market signals.
          </div>
        </div>

        {/* Layers Timeline Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {LAYER_REGISTRY.map((layer) => {
            const isReady = layer.status === "READY";
            const isInProgress = layer.status === "IN_PROGRESS";

            return (
              <div
                key={layer.id}
                className={`rounded-xl border p-3 flex flex-col justify-between transition-all duration-300 relative select-none ${
                  isReady
                    ? "bg-[#06101c]/80 border-emerald-500/25 hover:border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                    : isInProgress
                    ? "bg-[#0b101c] border-indigo-500/30 hover:border-indigo-500/50"
                    : "bg-[#050912]/90 border-slate-800/50 hover:border-slate-800 text-slate-500"
                }`}
              >
                {/* Top: Header */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-sm font-black font-mono px-1.5 py-0.5 rounded ${
                        isReady
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      LAYER {layer.id}
                    </span>

                    {/* Status Badge */}
                    <div className="flex items-center gap-1">
                      {isReady ? (
                        <>
                          <CheckCircle2 size={11} className="text-emerald-400" />
                          <span className="text-sm font-black text-emerald-400 tracking-wider">
                            ACTIVE
                          </span>
                        </>
                      ) : (
                        <>
                          <Lock size={9} className="text-slate-600" />
                          <span className="text-sm font-bold text-slate-500 tracking-wider">
                            LOCKED
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <h3
                    className={`text-base font-bold ${
                      isReady ? "text-slate-200" : "text-slate-500"
                    }`}
                  >
                    {layer.name}
                  </h3>

                  {/* Description */}
                  <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                    {layer.description}
                  </p>

                  {/* Tips Section */}
                  {layer.tips && (
                    <div className="mt-3 pt-2.5 border-t border-slate-800/40 space-y-1.5">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Trading Engine Tips
                      </div>
                      <div className="flex flex-col gap-1.5 text-xs">
                        <div className="flex items-start gap-1.5">
                          <TrendingUp size={12} className={`mt-0.5 flex-shrink-0 ${isReady ? "text-emerald-400" : "text-slate-600"}`} />
                          <span className={`${isReady ? "text-slate-350" : "text-slate-600"} leading-normal`}>
                            <strong className={isReady ? "text-emerald-400 font-bold" : "text-slate-600 font-bold"}>Bullish: </strong>
                            {layer.tips.bullish}
                          </span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <TrendingDown size={12} className={`mt-0.5 flex-shrink-0 ${isReady ? "text-rose-400" : "text-slate-600"}`} />
                          <span className={`${isReady ? "text-slate-350" : "text-slate-600"} leading-normal`}>
                            <strong className={isReady ? "text-rose-400 font-bold" : "text-slate-600 font-bold"}>Bearish: </strong>
                            {layer.tips.bearish}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom: Dependencies / Produces */}
                <div className="mt-4 pt-2 border-t border-slate-800/40 space-y-1.5">
                  {/* Consumes */}
                  <div className="flex items-center justify-between text-sm font-mono">
                    <span className="text-slate-600 uppercase">Consumes</span>
                    <span className={isReady ? "text-indigo-400 font-bold" : "text-slate-600"}>
                      {layer.consumes.length > 0
                        ? layer.consumes.map((cid) => `L${cid}`).join(", ")
                        : "Raw Data"}
                    </span>
                  </div>

                  {/* Produces */}
                  <div className="flex items-start justify-between text-sm font-mono">
                    <span className="text-slate-600 uppercase">Produces</span>
                    <span
                      className={`text-right max-w-[130px] truncate ${
                        isReady ? "text-slate-300 font-bold" : "text-slate-600"
                      }`}
                      title={layer.produces.join(", ")}
                    >
                      {layer.produces.length > 0 ? layer.produces.join(", ") : "—"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── INLINE BOTTOM HUD: LIVE PAPER TRADE SIGNAL FEED ───────── */}
      <div className="w-full flex justify-center mt-6">
        <LiveSignalFeedCard
          isInline={true}
          activePage={activePage}
          spotPrice={currentSpot}
          marketTimeResult={marketTimeResult}
          riskResult={riskResult}
          aiDecisionResult={aiDecisionResult}
          strategiesResult={strategiesResult}
          openPositions={openPositionsWithLtp}
          dbTrades={dbTrades}
          optionChain={optionChain}
          probabilityResult={probabilityResult}
          rtpodeResult={rtpodeResult}
        />
      </div>
    </div>
  );
};

export default Engines;
