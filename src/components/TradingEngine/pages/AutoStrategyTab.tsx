/**
 * AutoStrategyTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Auto Strategy Dispatcher — Premium UI Tab
 *
 * Features:
 *  - Intraday + Positional strategy auto-selection
 *  - Paper Trade mode (default)
 *  - Real-time position monitoring
 *  - Daily P&L tracking with ₹3,000 loss limit
 *  - SL Mode: Fixed / Trailing
 *  - Strategy registry browser
 *  - AI condition checker per strategy
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Play, Square, Shield, Zap, TrendingUp, TrendingDown,
  Target, Activity, RefreshCw, CheckCircle, XCircle,
  Calendar, Clock, BarChart2, ChevronDown, ChevronRight,
  AlertTriangle, Info, Layers, Brain, DollarSign, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import {
  STRATEGY_REGISTRY,
  getStrategiesByMode,
  type StrategyDefinition,
  type StrategyMode,
} from "../../../engine/strategyRegistry";
import PositionTradingDashboard from "./PositionTradingDashboard";
import {
  createDefaultDispatcherState,
  runDispatcher,
  updatePositionPnl,
  executePaperEntry,
  detectScoreTrend,
  type DispatcherState,
  type DispatcherInput,
  type ActivePosition,
  type SLMode,
  type StrategyStats,
  type ScoreMomentumWindow,
} from "../../../engine/strategyDispatcher";
import type { ReversalIndicators } from "../../../../server/services/indicatorEngine";


// ── Lightweight reversal indicator calculator (pure frontend, no server needed) ──────
// This mirrors computeReversalIndicators() from indicatorEngine.ts but runs in
// the browser using the candle data already loaded in memory.
function computeReversalFrontend(
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
  prevClose?: number,
): ReversalIndicators {
  const EMPTY: ReversalIndicators = {
    rsi14: null, mfi14: null, momentum14: null, lrAngle: null,
    stochK: null, stochD: null,
    rsiCrossedAbove30: false, rsiCrossedBelow70: false,
    mfiCrossedAbove20: false, mfiCrossedBelow80: false,
    momentumCrossedAbove0: false, momentumCrossedBelow0: false,
    lrAngleCrossedAboveMinus25: false, lrAngleCrossedBelow25: false,
    stochBullishCross: false, stochBearishCross: false,
    orbHigh: null, orbLow: null, dayHigh: null, dayLow: null,
    gapPct: null, prevClose: prevClose ?? null,
  };
  if (!candles || candles.length < 16) return EMPTY;

  const IST = 19800; // 5h30m seconds
  const getISTDate = (ts: number) => {
    const ms = (ts + IST) * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  };
  const nowSec = Date.now() / 1000;
  const todayIST = getISTDate(nowSec);

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const n = closes.length;

  // ─ RSI (14) ──────────────────────────────────────────────────
  function calcRSI(cl: number[], per = 14): number | null {
    if (cl.length < per + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= per; i++) {
      const d = cl[i] - cl[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    let avgG = gains / per, avgL = losses / per;
    for (let i = per + 1; i < cl.length; i++) {
      const d = cl[i] - cl[i - 1];
      avgG = (avgG * (per - 1) + Math.max(0, d)) / per;
      avgL = (avgL * (per - 1) + Math.max(0, -d)) / per;
    }
    return avgL === 0 ? 100 : parseFloat((100 - 100 / (1 + avgG / avgL)).toFixed(2));
  }
  const rsiNow  = calcRSI(closes);
  const rsiPrev = closes.length > 1 ? calcRSI(closes.slice(0, -1)) : null;

  // ─ MFI (14) ────────────────────────────────────────────────
  function calcMFI(idx: number): number | null {
    if (idx < 14) return null;
    const slice = candles.slice(idx - 14, idx + 1);
    let posFlow = 0, negFlow = 0;
    for (let i = 1; i < slice.length; i++) {
      const tp     = (slice[i].high + slice[i].low + slice[i].close) / 3;
      const prevTp = (slice[i-1].high + slice[i-1].low + slice[i-1].close) / 3;
      const mf = tp * slice[i].volume;
      if (tp > prevTp) posFlow += mf; else negFlow += mf;
    }
    if (negFlow === 0) return 100;
    return parseFloat((100 - 100 / (1 + posFlow / negFlow)).toFixed(2));
  }
  const mfiNow  = calcMFI(n - 1);
  const mfiPrev = calcMFI(n - 2);

  // ─ Momentum (14) ─────────────────────────────────────────────
  const momentumNow  = n > 14 ? closes[n-1] - closes[n-1-14] : null;
  const momentumPrev = n > 15 ? closes[n-2] - closes[n-2-14] : null;

  // ─ Linear Regression Angle (14) ──────────────────────────────
  function lrAngleFn(cl: number[]): number | null {
    const per = 14;
    if (cl.length < per) return null;
    const sl = cl.slice(-per);
    let sX=0, sY=0, sXY=0, sX2=0;
    for (let i=0;i<per;i++) { sX+=i; sY+=sl[i]; sXY+=i*sl[i]; sX2+=i*i; }
    const d = per*sX2 - sX*sX;
    if (!d) return null;
    const slope = (per*sXY - sX*sY)/d;
    const avg = sY/per;
    const ns = avg>0 ? slope/avg*100 : slope;
    return parseFloat((Math.atan(ns)*(180/Math.PI)).toFixed(2));
  }
  const lrNow  = lrAngleFn(closes);
  const lrPrev = lrAngleFn(closes.slice(0,-1));

  // ─ Stochastic (14, 3, 3) ───────────────────────────────────────
  function calcStoch(cl: number[], hi: number[], lo: number[], per=14, sig=3): {k:number;d:number}|null {
    if (cl.length < per + sig) return null;
    const kArr: number[] = [];
    for (let i = per-1; i < cl.length; i++) {
      const hh = Math.max(...hi.slice(i-per+1, i+1));
      const ll = Math.min(...lo.slice(i-per+1, i+1));
      const k = hh === ll ? 50 : ((cl[i]-ll)/(hh-ll))*100;
      kArr.push(k);
    }
    const dArr: number[] = [];
    for (let i = sig-1; i < kArr.length; i++) {
      dArr.push(kArr.slice(i-sig+1, i+1).reduce((a,b)=>a+b,0)/sig);
    }
    const k = kArr[kArr.length-1];
    const d = dArr[dArr.length-1];
    if (k===undefined||d===undefined) return null;
    return { k: parseFloat(k.toFixed(2)), d: parseFloat(d.toFixed(2)) };
  }
  const stochNow  = calcStoch(closes, highs, lows);
  const stochPrev = calcStoch(closes.slice(0,-1), highs.slice(0,-1), lows.slice(0,-1));
  const stochKNow = stochNow?.k ?? null;
  const stochDNow = stochNow?.d ?? null;
  const stochKPrev = stochPrev?.k ?? null;
  const stochDPrev = stochPrev?.d ?? null;

  // ─ Crossovers ──────────────────────────────────────────────────
  const rsiCrossedAbove30    = rsiPrev!=null && rsiNow!=null && rsiPrev<30  && rsiNow>=30;
  const rsiCrossedBelow70    = rsiPrev!=null && rsiNow!=null && rsiPrev>70  && rsiNow<=70;
  const mfiCrossedAbove20    = mfiPrev!=null && mfiNow!=null && mfiPrev<20  && mfiNow>=20;
  const mfiCrossedBelow80    = mfiPrev!=null && mfiNow!=null && mfiPrev>80  && mfiNow<=80;
  const momentumCrossedAbove0 = momentumPrev!=null && momentumNow!=null && momentumPrev<0 && momentumNow>=0;
  const momentumCrossedBelow0 = momentumPrev!=null && momentumNow!=null && momentumPrev>0 && momentumNow<=0;
  const lrAngleCrossedAboveMinus25 = lrPrev!=null && lrNow!=null && lrPrev<-25 && lrNow>=-25;
  const lrAngleCrossedBelow25      = lrPrev!=null && lrNow!=null && lrPrev>25  && lrNow<=25;
  const stochBullishCross = stochKPrev!=null&&stochDPrev!=null&&stochKNow!=null&&stochDNow!=null
    && stochKPrev<stochDPrev && stochKNow>=stochDNow && stochKNow<30;
  const stochBearishCross = stochKPrev!=null&&stochDPrev!=null&&stochKNow!=null&&stochDNow!=null
    && stochKPrev>stochDPrev && stochKNow<=stochDNow && stochKNow>70;

  // ─ Price-Level Context ───────────────────────────────────────────
  const todayCandles = candles.filter(c => getISTDate(c.time) === todayIST);
  const orbCandles   = todayCandles.filter(c => {
    const tIST = c.time + IST;
    const hh = Math.floor((tIST % 86400) / 3600);
    const mm = Math.floor((tIST % 3600) / 60);
    return hh === 9 && mm >= 15 && mm < 30;
  });
  const orbHigh  = orbCandles.length>0 ? Math.max(...orbCandles.map(c=>c.high))  : null;
  const orbLow   = orbCandles.length>0 ? Math.min(...orbCandles.map(c=>c.low))   : null;
  const dayHigh  = todayCandles.length>0 ? Math.max(...todayCandles.map(c=>c.high)) : null;
  const dayLow   = todayCandles.length>0 ? Math.min(...todayCandles.map(c=>c.low))  : null;
  const firstToday = todayCandles[0];
  const gapPct = firstToday && prevClose && prevClose>0
    ? parseFloat((((firstToday.open - prevClose)/prevClose)*100).toFixed(3)) : null;

  return {
    rsi14: rsiNow, mfi14: mfiNow, momentum14: momentumNow, lrAngle: lrNow,
    stochK: stochKNow, stochD: stochDNow,
    rsiCrossedAbove30, rsiCrossedBelow70,
    mfiCrossedAbove20, mfiCrossedBelow80,
    momentumCrossedAbove0, momentumCrossedBelow0,
    lrAngleCrossedAboveMinus25, lrAngleCrossedBelow25,
    stochBullishCross, stochBearishCross,
    orbHigh, orbLow, dayHigh, dayLow, gapPct,
    prevClose: prevClose ?? null,
  };
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface AutoStrategyTabProps {
  socket?:           any;
  // Live market data
  spotPrice:         number;
  indexSymbol:       string;
  indiaVix:          number;
  pcr:               number;
  optionChain:       Array<{ strikePrice: number; ceLtp: number; peLtp: number; ceOI: number; peOI: number }>;
  isMarketOpen:      boolean;

  // AI Engine outputs
  aiConfidence:      number;
  aiDirection:       "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";
  regime:            string;
  sessionType:       string;
  smartMoneyScore:   number;
  alignmentScore:    number;
  breadthScore:      number;
  rangeBreakout:     boolean;
  rangeBreakdown:    boolean;
  momentumExhaustion: boolean;
  isExpiryDay:       boolean;

  // Candle history for reversal indicator calculation (optional)
  candles5m?:  Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  prevClose?:  number;  // Previous session's closing price

  // Extended engine scores
  momentumScore?:    number;
  patternScore?:     number;
  probabilityScore?: number;
  entryZoneScore?:   number;
  aiAnalysis?:       any;
  scoreBackup?:      any;
}

// ── Format helpers ─────────────────────────────────────────────────────────────

const fmtRs = (n: number) => `${n >= 0 ? "+" : ""}₹${Math.abs(n).toFixed(0)}`;
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const fmtTime = (ts: number) => {
  if (!ts) return "--";
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
};
const fmtAge = (ts: number) => {
  if (!ts) return "--";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m ${Math.floor((diff % 60000) / 1000)}s`;
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const StatBox: React.FC<{ label: string; value: string; color?: string; sub?: string }> = ({ label, value, color = "text-white", sub }) => (
  <div className="relative group bg-gradient-to-br from-slate-900/80 via-[#0a1628] to-slate-900/60 border border-slate-700/30 rounded-xl p-3.5 overflow-hidden transition-all duration-300 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5">
    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    <div className="relative z-10">
      <div className="text-[8px] text-slate-500 uppercase tracking-[0.15em] font-black mb-1.5 flex items-center gap-1">
        <div className="w-1 h-1 rounded-full bg-indigo-500/50" />
        {label}
      </div>
      <div className={`text-base font-black font-mono leading-tight ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500/80 font-mono mt-1 tracking-wide">{sub}</div>}
    </div>
  </div>
);

const PnlBadge: React.FC<{ pnl: number; className?: string }> = ({ pnl, className = "" }) => (
  <span className={`font-black font-mono text-sm ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"} ${className}`}>
    {fmtRs(pnl)}
  </span>
);

const ConditionRow: React.FC<{ label: string; met: boolean }> = ({ label, met }) => (
  <div className="flex items-center gap-2 py-0.5">
    {met
      ? <CheckCircle size={11} className="text-emerald-400 flex-shrink-0" />
      : <XCircle size={11} className="text-rose-400/70 flex-shrink-0" />}
    <span className={`text-[10px] font-mono ${met ? "text-slate-300" : "text-slate-600"}`}>{label}</span>
  </div>
);

const ModeTag: React.FC<{ mode: StrategyMode }> = ({ mode }) => (
  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider
    ${mode === "INTRADAY" ? "bg-teal-500/15 text-teal-400 border border-teal-500/20"
                          : "bg-violet-500/15 text-violet-400 border border-violet-500/20"}`}>
    {mode}
  </span>
);

// ── Strategy Card (registry view) ─────────────────────────────────────────────

const StrategyCard: React.FC<{ strategy: StrategyDefinition; isSelected: boolean; isCandidate: boolean; score?: number }> = ({
  strategy, isSelected, isCandidate, score
}) => {
  const [expanded, setExpanded] = useState(false);
  const borderColor = isSelected ? "border-indigo-500/60" : isCandidate ? "border-emerald-500/30" : "border-slate-800/40";
  const bgColor = isSelected ? "bg-indigo-950/20" : isCandidate ? "bg-emerald-950/10" : "bg-slate-900/30";

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} transition-all duration-200`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 p-3 text-left cursor-pointer"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-black ${isSelected ? "text-indigo-300" : isCandidate ? "text-emerald-300" : "text-slate-300"}`}>
              {strategy.name}
            </span>
            <ModeTag mode={strategy.mode} />
            {isSelected && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 animate-pulse">
                ▶ SELECTED
              </span>
            )}
            {isCandidate && !isSelected && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">
                CANDIDATE
              </span>
            )}
          </div>
          <div className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">{strategy.description}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {score !== undefined && (
            <span className="text-[10px] font-black text-amber-400 font-mono">{score}</span>
          )}
          <span className="text-[10px] font-mono text-emerald-400">{strategy.winRateHistorical}% WR</span>
          {expanded ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-4 space-y-3 border-t border-slate-800/30 pt-3">

          {/* Section 0: Full Description + Entry/Exit/Re-entry */}
          {(strategy.fullDescription || strategy.entryTrigger) && (
            <div className="rounded-lg bg-slate-950/60 border border-slate-700/30 p-2.5 space-y-2">
              {strategy.fullDescription && (
                <p className="text-[9px] text-slate-300 leading-relaxed">{strategy.fullDescription}</p>
              )}
              {strategy.entryTrigger && (
                <div className="flex items-start gap-2 pt-1 border-t border-slate-800/40">
                  <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mt-0.5 flex-shrink-0 w-12">Entry</span>
                  <span className="text-[9px] text-emerald-300 font-mono leading-snug">{strategy.entryTrigger}</span>
                </div>
              )}
              {strategy.exitTrigger && (
                <div className="flex items-start gap-2 border-t border-slate-800/40 pt-1">
                  <span className="text-[8px] font-black text-rose-400 uppercase tracking-widest mt-0.5 flex-shrink-0 w-12">Exit</span>
                  <span className="text-[9px] text-rose-300 font-mono leading-snug">{strategy.exitTrigger}</span>
                </div>
              )}
              {strategy.reEntryRule && (
                <div className="flex items-start gap-2 border-t border-slate-800/40 pt-1">
                  <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest mt-0.5 flex-shrink-0 w-12">Re-entry</span>
                  <span className="text-[9px] text-amber-300 font-mono leading-snug">{strategy.reEntryRule}</span>
                </div>
              )}
              {/* Expiry + Index */}
              {(strategy.conditions.preferredExpiry || strategy.conditions.preferredIndex) && (
                <div className="flex items-center gap-3 border-t border-slate-800/40 pt-1">
                  {strategy.conditions.preferredIndex && (
                    <span className="text-[9px] font-black px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                      {strategy.conditions.preferredIndex === "AI_DECIDES" ? "Index: AI Selects" : strategy.conditions.preferredIndex}
                    </span>
                  )}
                  {strategy.conditions.preferredExpiry && (
                    <span className="text-[9px] font-black px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/20">
                      {strategy.conditions.preferredExpiry === "WEEKLY" ? "Weekly Expiry" :
                       strategy.conditions.preferredExpiry === "NEXT_WEEKLY" ? "Next Weekly" :
                       strategy.conditions.preferredExpiry === "MONTHLY" ? "Monthly Expiry" : "AI Selects Expiry"}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="text-[9px] text-indigo-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1"><Zap size={9}/> Kab Laagu Hogi</div>
            <div className="space-y-1">
              <div className="flex items-start gap-2 bg-slate-950/40 rounded px-2 py-1.5">
                <span className="text-[9px] text-slate-500 font-black uppercase w-20 flex-shrink-0">Regime</span>
                <div className="flex flex-wrap gap-1">{strategy.conditions.allowedRegimes.map(r=><span key={r} className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">{r.replace(/_/g," ")}</span>)}</div>
              </div>
              <div className="flex items-start gap-2 bg-slate-950/40 rounded px-2 py-1.5">
                <span className="text-[9px] text-slate-500 font-black uppercase w-20 flex-shrink-0">Session</span>
                <div className="flex flex-wrap gap-1">{strategy.conditions.sessionTime.map(s=><span key={s} className="text-[9px] font-black px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/20">{s==="OPENING"?"9:15-10:30":s==="MID"?"10:30-14:00":s==="CLOSING"?"14:00-15:30":"Any"}</span>)}</div>
              </div>
              <div className="flex items-start gap-2 bg-slate-950/40 rounded px-2 py-1.5">
                <span className="text-[9px] text-slate-500 font-black uppercase w-20 flex-shrink-0">CE/PE</span>
                <div className="flex flex-wrap gap-1">{strategy.legs.map((leg,i)=><span key={i} className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${leg.side==="CE"?"bg-emerald-500/15 text-emerald-300 border-emerald-500/20":leg.side==="PE"?"bg-rose-500/15 text-rose-300 border-rose-500/20":"bg-indigo-500/15 text-indigo-300 border-indigo-500/20"}`}>{leg.action} {leg.side==="AI_DECIDES"?"CE/PE (AI)":leg.side} {leg.position}</span>)}</div>
              </div>
              <div className="flex items-start gap-2 bg-slate-950/40 rounded px-2 py-1.5">
                <span className="text-[9px] text-slate-500 font-black uppercase w-20 flex-shrink-0">India VIX</span>
                <span className="text-[9px] font-black text-orange-300 font-mono">{strategy.conditions.vixMin} se {strategy.conditions.vixMax===99?"zyada bhi":strategy.conditions.vixMax+" tak"}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[9px] text-violet-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1"><BarChart2 size={9}/> Score Requirements</div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-slate-950/50 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 uppercase font-black">AI Confidence</div>
                <div className="flex items-center gap-1 mt-0.5"><div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{width:`${strategy.conditions.minAIConfidence}%`}}/></div><span className="text-[10px] font-black text-indigo-300 font-mono">{">="}{strategy.conditions.minAIConfidence}%</span></div>
              </div>
              <div className="bg-slate-950/50 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 uppercase font-black">Smart Money</div>
                <div className="flex items-center gap-1 mt-0.5"><div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-amber-500 rounded-full" style={{width:`${strategy.conditions.minSmartMoney}%`}}/></div><span className="text-[10px] font-black text-amber-300 font-mono">{">="}{strategy.conditions.minSmartMoney}</span></div>
              </div>
              <div className="bg-slate-950/50 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 uppercase font-black">Alignment Score</div>
                <div className="flex items-center gap-1 mt-0.5"><div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{width:`${strategy.conditions.minAlignScore}%`}}/></div><span className="text-[10px] font-black text-teal-300 font-mono">{">="}{strategy.conditions.minAlignScore}</span></div>
              </div>
              {strategy.conditions.minBreadthScore!==undefined&&<div className="bg-slate-950/50 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 uppercase font-black">Breadth Score</div>
                <div className="flex items-center gap-1 mt-0.5"><div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 rounded-full" style={{width:`${strategy.conditions.minBreadthScore}%`}}/></div><span className="text-[10px] font-black text-cyan-300 font-mono">{">="}{strategy.conditions.minBreadthScore}</span></div>
              </div>}
              <div className="bg-slate-950/50 rounded px-2 py-1.5"><div className="text-[8px] text-slate-500 uppercase font-black">Win Rate</div><div className="text-[11px] font-black text-emerald-400 font-mono mt-0.5">{strategy.winRateHistorical}%</div></div>
              <div className="bg-slate-950/50 rounded px-2 py-1.5"><div className="text-[8px] text-slate-500 uppercase font-black">Min R:R</div><div className="text-[11px] font-black text-violet-400 font-mono mt-0.5">1:{strategy.risk.riskRewardMin}</div></div>
            </div>
          </div>
          <div>
            <div className="text-[9px] text-rose-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1"><Shield size={9}/> Special Conditions</div>
            <div className="flex flex-wrap gap-1.5">
              {strategy.conditions.requireBreakout&&<span className="text-[9px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">15M Breakout Chahiye</span>}
              {strategy.conditions.requireBreakdown&&<span className="text-[9px] px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">15M Breakdown Chahiye</span>}
              {strategy.conditions.requireExhaustionSignal&&<span className="text-[9px] px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">Momentum Exhaustion</span>}
              {strategy.conditions.isExpiryDayOnly&&<span className="text-[9px] px-2 py-1 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 font-mono">Sirf Expiry Day</span>}
              {strategy.conditions.notExpiryDay&&<span className="text-[9px] px-2 py-1 rounded bg-slate-700/40 text-slate-400 border border-slate-600/30 font-mono">Expiry Day pe Nahi</span>}
              {!strategy.conditions.requireBreakout&&!strategy.conditions.requireBreakdown&&!strategy.conditions.requireExhaustionSignal&&!strategy.conditions.isExpiryDayOnly&&!strategy.conditions.notExpiryDay&&<span className="text-[9px] px-2 py-1 rounded bg-slate-800/40 text-slate-500 font-mono">Koi khaas shart nahi</span>}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-orange-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1"><Target size={9}/> Risk Management</div>
            <div className="grid grid-cols-4 gap-1.5">
              {/* Stop Loss — uses fixedSLPct if available, else maxLossRs */}
              <div className="bg-rose-950/30 border border-rose-500/20 rounded p-1.5 text-center col-span-2">
                <div className="text-[8px] text-rose-400 uppercase font-black">Stop Loss</div>
                {strategy.risk.fixedSLPct !== undefined ? (
                  <>
                    <div className="text-[11px] font-black text-rose-300 font-mono mt-0.5">{strategy.risk.fixedSLPct}% of Premium</div>
                    <div className="text-[8px] text-rose-500 font-mono">(Max ₹{strategy.risk.maxLossRs.toLocaleString()})</div>
                  </>
                ) : (
                  <>
                    <div className="text-[11px] font-black text-rose-300 font-mono mt-0.5">₹{strategy.risk.maxLossRs.toLocaleString()}</div>
                    <div className="text-[8px] text-rose-500 font-mono">Fixed ₹ Loss Limit</div>
                  </>
                )}
              </div>
              {/* Target — uses targetPct if available, else targetRs */}
              <div className="bg-emerald-950/30 border border-emerald-500/20 rounded p-1.5 text-center col-span-2">
                <div className="text-[8px] text-emerald-400 uppercase font-black">Target</div>
                {strategy.risk.targetPct !== undefined ? (
                  <>
                    <div className="text-[11px] font-black text-emerald-300 font-mono mt-0.5">{strategy.risk.targetPct}% of Premium</div>
                    <div className="text-[8px] text-emerald-500 font-mono">(Target ₹{strategy.risk.targetRs.toLocaleString()})</div>
                  </>
                ) : (
                  <>
                    <div className="text-[11px] font-black text-emerald-300 font-mono mt-0.5">₹{strategy.risk.targetRs.toLocaleString()}</div>
                    <div className="text-[8px] text-emerald-500 font-mono">Fixed ₹ Target</div>
                  </>
                )}
              </div>
              {/* SL Type */}
              <div className="bg-amber-950/20 border border-amber-500/20 rounded p-1.5 text-center">
                <div className="text-[8px] text-amber-400 uppercase font-black">SL Type</div>
                <div className={`text-[10px] font-black font-mono mt-0.5 ${
                  strategy.risk.slType === "TRAILING" ? "text-amber-300" :
                  strategy.risk.slType === "BOTH"     ? "text-orange-300" : "text-slate-300"
                }`}>{strategy.risk.slType}</div>
              </div>
              {/* Square-off time or max hold days */}
              <div className="bg-slate-900/50 border border-slate-700/30 rounded p-1.5 text-center">
                <div className="text-[8px] text-slate-400 uppercase font-black">{strategy.mode==="POSITIONAL"?"Max Days":"Exit Time"}</div>
                <div className="text-[10px] font-black text-slate-200 font-mono mt-0.5">{strategy.mode==="POSITIONAL"?`${strategy.risk.maxHoldDays}D`:strategy.risk.squareOffTime}</div>
              </div>
              {/* R:R ratio */}
              <div className="bg-violet-950/20 border border-violet-500/20 rounded p-1.5 text-center">
                <div className="text-[8px] text-violet-400 uppercase font-black">Min R:R</div>
                <div className="text-[10px] font-black text-violet-300 font-mono mt-0.5">1:{strategy.risk.riskRewardMin}</div>
              </div>
              {/* Win Rate */}
              <div className="bg-slate-900/50 border border-slate-700/30 rounded p-1.5 text-center">
                <div className="text-[8px] text-slate-400 uppercase font-black">Win Rate</div>
                <div className="text-[10px] font-black text-emerald-400 font-mono mt-0.5">{strategy.winRateHistorical}%</div>
              </div>
            </div>
            {strategy.risk.trailTriggerRs&&<div className="mt-1.5 text-[9px] font-mono text-amber-400/70 bg-amber-950/20 border border-amber-500/15 rounded px-2 py-1">
              🔄 Trailing SL: P&L {"≥"} ₹{strategy.risk.trailTriggerRs.toLocaleString()} pe activate | Step: ₹{strategy.risk.trailStepRs?.toLocaleString()}
            </div>}
            <div className="mt-1 text-[9px] font-mono text-slate-500 bg-slate-900/40 rounded px-2 py-1">Capital Range: ₹{strategy.capital.min.toLocaleString()}–₹{strategy.capital.max.toLocaleString()}</div>
          </div>

          {/* Section: Fake Breakout Filter */}
          {strategy.breakoutValidation && (
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  strategy.breakoutValidation.strictnessLevel === "EXTREME" ? "bg-red-500" :
                  strategy.breakoutValidation.strictnessLevel === "HIGH"    ? "bg-orange-400" :
                  strategy.breakoutValidation.strictnessLevel === "MEDIUM"  ? "bg-amber-400" : "bg-green-400"
                }`}/>
                <span className={
                  strategy.breakoutValidation.strictnessLevel === "EXTREME" ? "text-red-400" :
                  strategy.breakoutValidation.strictnessLevel === "HIGH"    ? "text-orange-400" :
                  strategy.breakoutValidation.strictnessLevel === "MEDIUM"  ? "text-amber-400" : "text-green-400"
                }>
                  Fake Breakout Filter — {strategy.breakoutValidation.strictnessLevel}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${strategy.breakoutValidation.requireCandleClose ? "bg-emerald-950/40 border border-emerald-500/20" : "bg-slate-900/30 border border-slate-700/20"}`}>
                  <span className={`text-[10px] ${strategy.breakoutValidation.requireCandleClose ? "text-emerald-400" : "text-slate-600"}`}>{strategy.breakoutValidation.requireCandleClose ? "✓" : "✗"}</span>
                  <span className="text-[9px] text-slate-300">Candle Body Close</span>
                </div>
                <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${strategy.breakoutValidation.requireVolumeConfirm ? "bg-emerald-950/40 border border-emerald-500/20" : "bg-slate-900/30 border border-slate-700/20"}`}>
                  <span className={`text-[10px] ${strategy.breakoutValidation.requireVolumeConfirm ? "text-emerald-400" : "text-slate-600"}`}>{strategy.breakoutValidation.requireVolumeConfirm ? "✓" : "✗"}</span>
                  <span className="text-[9px] text-slate-300">Volume {strategy.breakoutValidation.volumeMultiplier}x Avg</span>
                </div>
                {strategy.breakoutValidation.holdCandlesMin && (
                  <div className="flex items-center gap-1.5 rounded px-2 py-1 bg-emerald-950/40 border border-emerald-500/20">
                    <span className="text-[10px] text-emerald-400">✓</span>
                    <span className="text-[9px] text-slate-300">{strategy.breakoutValidation.holdCandlesMin} Candles Hold ({strategy.breakoutValidation.holdTimeframeMin}M)</span>
                  </div>
                )}
                <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${strategy.breakoutValidation.requireATRDistance ? "bg-emerald-950/40 border border-emerald-500/20" : "bg-slate-900/30 border border-slate-700/20"}`}>
                  <span className={`text-[10px] ${strategy.breakoutValidation.requireATRDistance ? "text-emerald-400" : "text-slate-600"}`}>{strategy.breakoutValidation.requireATRDistance ? "✓" : "✗"}</span>
                  <span className="text-[9px] text-slate-300">ATR {strategy.breakoutValidation.atrMultiplier}x Distance</span>
                </div>
                <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${strategy.breakoutValidation.requireOIConfirm ? "bg-emerald-950/40 border border-emerald-500/20" : "bg-slate-900/30 border border-slate-700/20"}`}>
                  <span className={`text-[10px] ${strategy.breakoutValidation.requireOIConfirm ? "text-emerald-400" : "text-slate-600"}`}>{strategy.breakoutValidation.requireOIConfirm ? "✓" : "✗"}</span>
                  <span className="text-[9px] text-slate-300">OI Unwind {strategy.breakoutValidation.oiUnwindPct ?? 0}%</span>
                </div>
                <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${strategy.breakoutValidation.requireHTFConfluence ? "bg-emerald-950/40 border border-emerald-500/20" : "bg-slate-900/30 border border-slate-700/20"}`}>
                  <span className={`text-[10px] ${strategy.breakoutValidation.requireHTFConfluence ? "text-emerald-400" : "text-slate-600"}`}>{strategy.breakoutValidation.requireHTFConfluence ? "✓" : "✗"}</span>
                  <span className="text-[9px] text-slate-300">HTF {strategy.breakoutValidation.htfTimeframeMin}M Confirm</span>
                </div>
                {strategy.breakoutValidation.requirePCRShift && (
                  <div className="flex items-center gap-1.5 rounded px-2 py-1 bg-emerald-950/40 border border-emerald-500/20 col-span-2">
                    <span className="text-[10px] text-emerald-400">✓</span>
                    <span className="text-[9px] text-slate-300">PCR Shift Confirm (Option Chain direction match kare)</span>
                  </div>
                )}
              </div>
              <div className="mt-1.5 text-[8px] text-slate-500 font-mono bg-slate-950/40 rounded px-2 py-1">
                ⚠ Ye sare filters PASS hone ke baad hi strategy DEPLOY hogi — fake breakout pe entry nahi hogi
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Position Monitor ───────────────────────────────────────────────────────────

const PositionMonitor: React.FC<{ position: ActivePosition }> = ({ position: pos }) => {
  const pnlColor = pos.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400";
  const pnlPct = pos.entryPremium > 0 ? (pos.unrealizedPnl / (pos.entryPremium * pos.qty)) * 100 : 0;

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/20 to-slate-900/60 p-4 space-y-3 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-black text-white uppercase tracking-wider">{pos.strategyName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ModeTag mode={pos.mode} />
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${pos.direction === "CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
            {pos.direction}
          </span>
        </div>
      </div>

      {/* Strike info */}
      <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
        <div>
          <div className="text-[9px] text-slate-500 uppercase font-black">Strike</div>
          <div className="text-sm font-black text-white font-mono">{pos.strikePrice}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-slate-500 uppercase font-black">Entry</div>
          <div className="text-sm font-black text-slate-200 font-mono">₹{pos.entryPremium.toFixed(1)}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-slate-500 uppercase font-black">Current</div>
          <div className="text-sm font-black text-white font-mono">₹{pos.currentPremium.toFixed(1)}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-slate-500 uppercase font-black">Lots</div>
          <div className="text-sm font-black text-slate-200 font-mono">{pos.lots}L</div>
        </div>
      </div>

      {/* P&L bar */}
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-[9px] text-slate-500 font-black uppercase">Live P&L</span>
          <div className="flex items-center gap-2">
            <span className={`text-base font-black font-mono ${pnlColor}`}>{fmtRs(pos.unrealizedPnl)}</span>
            <span className={`text-[10px] font-mono ${pnlColor}`}>{fmtPct(pnlPct)}</span>
          </div>
        </div>
        {/* Progress bar from -maxLoss to +target */}
        {(() => {
          const maxLoss = pos.fixedSL > 0 ? (pos.entryPremium - pos.fixedSL) * pos.qty : 3000;
          const tgt = (pos.targetPremium - pos.entryPremium) * pos.qty;
          const total = maxLoss + tgt;
          const pct = ((pos.unrealizedPnl + maxLoss) / total) * 100;
          const clampedPct = Math.max(0, Math.min(100, pct));
          return (
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pos.unrealizedPnl >= 0 ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-rose-500 to-rose-400"}`}
                style={{ width: `${clampedPct}%` }}
              />
            </div>
          );
        })()}
        {/* SL / TGT price labels */}
        <div className="grid grid-cols-3 gap-1 mt-1">
          <div className="bg-rose-950/30 border border-rose-500/20 rounded px-2 py-1 text-center">
            <div className="text-[8px] text-rose-400 uppercase font-black">Stop Loss</div>
            <div className="text-[10px] font-black text-rose-300 font-mono">₹{pos.fixedSL.toFixed(1)}</div>
            <div className="text-[8px] text-rose-600 font-mono">-₹{((pos.entryPremium - pos.fixedSL) * pos.qty).toFixed(0)}</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-700/30 rounded px-2 py-1 text-center">
            <div className="text-[8px] text-slate-500 uppercase font-black">Entry</div>
            <div className="text-[10px] font-black text-white font-mono">₹{pos.entryPremium.toFixed(1)}</div>
            <div className={`text-[8px] font-mono ${pos.slMode === "TRAILING" ? "text-amber-400" : "text-slate-500"}`}>
              {pos.slMode === "TRAILING" ? "🔄 Trail" : "🔵 Fixed"}
            </div>
          </div>
          <div className="bg-emerald-950/30 border border-emerald-500/20 rounded px-2 py-1 text-center">
            <div className="text-[8px] text-emerald-400 uppercase font-black">Target</div>
            <div className="text-[10px] font-black text-emerald-300 font-mono">₹{pos.targetPremium.toFixed(1)}</div>
            <div className="text-[8px] text-emerald-600 font-mono">+₹{((pos.targetPremium - pos.entryPremium) * pos.qty).toFixed(0)}</div>
          </div>
        </div>
        {pos.trailActive && (
          <div className="text-[9px] font-mono text-amber-400 bg-amber-950/20 border border-amber-500/15 rounded px-2 py-1 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Trailing SL Active @ ₹{pos.trailingSL.toFixed(1)}
          </div>
        )}
      </div>

      {/* Time info */}
      <div className="flex justify-between text-[9px] font-mono text-slate-500 border-t border-slate-800/30 pt-2">
        <span>Entry: {fmtTime(pos.entryTime)}</span>
        <span>Holding: {fmtAge(pos.entryTime)}</span>
        <span>{pos.trailActive ? "🟢 Trail Active" : "🔵 Fixed SL"}</span>
      </div>
    </div>
  );
};


function mapDbTradeToActivePosition(t: any): ActivePosition {
  let parsedNotes: any = {};
  try {
    parsedNotes = JSON.parse(t.notes || "{}");
  } catch (_) {}

  const direction: "CE" | "PE" = (t.direction === "BUY_CE" || t.direction === "CE" || t.direction === "BULL_SPREAD") ? "CE" : "PE";
  const entryPremium = t.entry_price || 0;
  const currentPremium = t.livePrice ?? entryPremium;
  const qty = t.qty || 1;
  const lotSize = t.lot_size ?? 50;
  const unrealizedPnl = parseFloat(((currentPremium - entryPremium) * qty * lotSize).toFixed(1));

  const initialSL = parsedNotes.initialStopLoss ?? t.stop_loss;
  const trailActive = t.stop_loss > initialSL || parsedNotes.trailActive === true;

  return {
    id: t.id,
    strategyId: parsedNotes.strategyId || t.strategyName || "AUTO",
    strategyName: t.strategyName || parsedNotes.strategyName || "Auto Strategy",
    mode: parsedNotes.trade_type || "INTRADAY",
    direction,
    indexSymbol: t.instrument || parsedNotes.index || "NIFTY",
    strikePrice: t.strike,
    optionSymbol: parsedNotes.symbol || "",
    entryPremium,
    currentPremium,
    entrySpot: parsedNotes.metrics?.spotPrice ?? parsedNotes.metrics?.spot ?? t.entry_price,
    currentSpot: parsedNotes.metrics?.spotPrice ?? parsedNotes.metrics?.spot ?? t.entry_price,
    qty,
    lots: qty,
    lotSize,
    unrealizedPnl,
    fixedSL: t.stop_loss,
    target: t.target,
    targetPremium: t.target,
    trailActive,
    trailingSL: t.stop_loss,
    entryTime: t.timestamp,
    lastUpdatedTime: t.timestamp,
    slMode: trailActive ? "TRAILING" : "FIXED",
    entryReason: parsedNotes.reason || "",
    exitReason: parsedNotes.exit_reason || "",
    maxPnl: unrealizedPnl > 0 ? unrealizedPnl : 0,
    status: t.status === "OPEN" ? "OPEN" : (unrealizedPnl >= 0 ? "CLOSED_PROFIT" : "CLOSED_LOSS"),
  };
}

// ── Main Component ─────────────────────────────────────────────────────────────

const AutoStrategyTab: React.FC<AutoStrategyTabProps> = (props) => {
  const [state, setState] = useState<DispatcherState>(createDefaultDispatcherState);
  const [slMode, setSlMode] = useState<SLMode>("BOTH" as any);
  const [maxTradesLimit, setMaxTradesLimit] = useState<number>(999); // Unlimited
  const [activeTab, setActiveTab] = useState<"DASHBOARD" | "INTRADAY" | "SWING" | "HISTORY">("DASHBOARD");
  const [ticker, setTicker] = useState(0); // force re-render for live P&L

  // ── Desktop Notification Permission ────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  const sendTradeNotification = useCallback((type: "BUY" | "SELL" | "SL" | "TARGET", details: {
    direction?: string;
    strike?: number;
    strategy?: string;
    premium?: number;
    pnl?: number;
    score?: number;
    index?: string;
  }) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const icons: Record<string, string> = {
      BUY:    "🟢",
      SELL:   "🔴",
      SL:     "🛑",
      TARGET: "🎯",
    };
    const icon = icons[type] || "📊";

    let title = "";
    let body  = "";

    if (type === "BUY") {
      title = `${icon} ENTRY — ${details.direction} ${details.index ?? ""}`;
      body  = [
        details.strike    ? `Strike: ${details.strike}`          : "",
        details.premium   ? `Premium: ₹${details.premium}`       : "",
        details.strategy  ? `Strategy: ${details.strategy}`      : "",
        details.score     ? `Score: ${details.score}/100`        : "",
      ].filter(Boolean).join(" | ");
    } else if (type === "SELL") {
      title = `${icon} EXIT — ${details.index ?? ""}  ${details.direction ?? ""}`;
      body  = `P&L: ${details.pnl !== undefined ? (details.pnl >= 0 ? "+" : "") + "₹" + details.pnl?.toFixed(0) : "---"}`;
    } else if (type === "SL") {
      title = `${icon} STOP LOSS HIT — ${details.index ?? ""}`;
      body  = `Loss: ₹${details.pnl?.toFixed(0) ?? "---"} | Strategy: ${details.strategy ?? "---"}`;
    } else if (type === "TARGET") {
      title = `${icon} TARGET HIT 🎉 — ${details.index ?? ""}`;
      body  = `Profit: +₹${details.pnl?.toFixed(0) ?? "---"} | ${details.strategy ?? ""}`;
    }

    try {
      new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag:  `trade-${Date.now()}`,
        requireInteraction: false,
      });
    } catch (_) {}
  }, []);

  // ── DB-backed trade history (survives page reload) ─────────────────────────────────
  const [dbHistory, setDbHistory] = useState<any[]>([]);

  const loadDbHistory = useCallback(async () => {
    try {
      const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
      const base = isLocal ? "http://localhost:3000" : "";
      const res = await fetch(`${base}/api/te/paper-trades?status=CLOSED&limit=100`);
      if (res.ok) {
        const d = await res.json();
        // Filter only trades saved by AutoStrategyDispatcher (notes contain JSON with strategyId)
        const stratTrades = (d.trades || []).filter((t: any) => {
          try {
            const n = JSON.parse(t.notes || '{}');
            return !!n.strategyId || (n.strategyDispatch && !!n.strategyDispatch.strategyId) || (t.id && t.id.startsWith("amex-srv"));
          } catch {
            return false;
          }
        });
        setDbHistory(stratTrades);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadDbHistory();
    const id = setInterval(loadDbHistory, 30_000); // refresh every 30s
    return () => clearInterval(id);
  }, [loadDbHistory]);

  // ── Save closed trade to DB with full strategy metadata ──────────────────────────
  const saveTradeToDb = useCallback(async (pos: ActivePosition) => {
    try {
      const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
      const base = isLocal ? "http://localhost:3000" : "";

      const notes = JSON.stringify({
        strategyId:   pos.strategyId,
        strategyName: pos.strategyName,
        entryReason:  pos.entryReason ?? '',
        exitReason:   pos.exitReason ?? '',
        mode:         pos.mode,
        source:       'AutoStrategyDispatcher',
        conditionsMet: pos.conditionsMet ?? [],
      });

      // 1. Create paper trade record
      const tradePayload = {
        id:          pos.id,
        timestamp:   pos.entryTime,
        instrument:  props.indexSymbol || 'NIFTY',
        direction:   pos.direction === 'CE' ? 'BUY_CE' : 'BUY_PE',
        strike:      pos.strikePrice,
        entry_price: pos.entryPremium,
        qty:         1,
        lot_size:    50,
        stop_loss:   pos.stopLoss,
        target:      pos.target,
        status:      'OPEN',
        pnl:         0,
        notes,
        signal_ref:  pos.strategyId,
      };

      await fetch(`${base}/api/te/paper-trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradePayload),
      });

      // 2. Immediately close it with exit price + P&L
      await fetch(`${base}/api/te/paper-trades/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:         pos.id,
          exit_price: pos.exitPremium ?? pos.currentPremium,
          pnl:        pos.realizedPnl ?? 0,
        }),
      });

      // Refresh local history
      loadDbHistory();
    } catch (_) {}
  }, [props.indexSymbol, loadDbHistory]);

  const openTradeInDb = useCallback(async (pos: ActivePosition) => {
    try {
      const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
      const base = isLocal ? "http://localhost:3000" : "";

      const notes = JSON.stringify({
        strategyId:   pos.strategyId,
        strategyName: pos.strategyName,
        entryReason:  pos.entryReason ?? 'AI Matrix Auto Entry',
        mode:         pos.mode,
        source:       'AutoStrategyDispatcher',
        conditionsMet: pos.conditionsMet ?? [],
      });

      const tradePayload = {
        id:          pos.id,
        timestamp:   pos.entryTime,
        instrument:  props.indexSymbol || 'NIFTY',
        direction:   pos.direction === 'CE' ? 'BUY_CE' : 'BUY_PE',
        strike:      pos.strikePrice,
        entry_price: pos.entryPremium,
        qty:         1,
        lot_size:    pos.lotSize ?? 50,
        stop_loss:   pos.fixedSL ?? pos.stopLoss ?? (pos.entryPremium * 0.8),
        target:      pos.targetPremium ?? pos.target ?? (pos.entryPremium * 1.5),
        status:      'OPEN',
        pnl:         0,
        notes,
        signal_ref:  pos.strategyId,
      };

      await fetch(`${base}/api/te/paper-trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradePayload),
      });
    } catch (_) {}
  }, [props.indexSymbol]);

  // Tick   // Run dispatcher on every tick (if active)
  useEffect(() => {
    if (!state.isActive) return;

    // Update live position P&L first (purely client side for smooth UI counters)
    if (state.activePosition) {
      const chain = props.optionChain || [];
      const row = chain.find(r => r.strikePrice === state.activePosition!.strikePrice);
      if (row) {
        const newPremium = state.activePosition.direction === "CE" ? row.ceLtp : row.peLtp;
        if (newPremium > 0) {
          const updatedPos = updatePositionPnl(
            state.activePosition,
            newPremium,
            props.spotPrice,
            slMode === "BOTH" ? "TRAILING" : slMode
          );
          // ─ Notify on SL/Target hit ─────────────────────────────────────
          if (updatedPos.status !== state.activePosition.status) {
            const pnl = updatedPos.realizedPnl ?? updatedPos.unrealizedPnl;
            const isTarget = updatedPos.status === "CLOSED_PROFIT";
            sendTradeNotification(isTarget ? "TARGET" : "SL", {
              pnl,
              strategy: updatedPos.strategyName,
              index:    props.indexSymbol,
            });
            saveTradeToDb({ ...updatedPos, realizedPnl: pnl, exitPremium: updatedPos.currentPremium, exitTime: Date.now() });
          }
          setState(prev => ({ ...prev, activePosition: updatedPos }));
        }
      }
    }

    const reversalIndicators = (props.candles5m ?? []).length >= 16
      ? computeReversalFrontend(props.candles5m ?? [], props.prevClose)
      : undefined;

    const dispatcherInput = {
      spotPrice:          props.spotPrice,
      indexSymbol:        props.indexSymbol,
      indiaVix:           props.indiaVix,
      pcr:                props.pcr,
      aiConfidence:       props.aiConfidence,
      aiDirection:        props.aiDirection,
      regime:             props.regime,
      sessionType:        props.sessionType,
      smartMoneyScore:    props.smartMoneyScore,
      alignmentScore:     props.alignmentScore,
      breadthScore:       props.breadthScore,
      rangeBreakout:      props.rangeBreakout,
      rangeBreakdown:     props.rangeBreakdown,
      momentumExhaustion: props.momentumExhaustion,
      isExpiryDay:        props.isExpiryDay,
      isMarketOpen:       props.isMarketOpen,
      optionChain:        props.optionChain || [],
      momentumScore:      props.momentumScore,
      patternScore:       props.patternScore,
      probabilityScore:   props.probabilityScore,
      entryZoneScore:     props.entryZoneScore,
      reversalIndicators: reversalIndicators,
      currentState:       { ...state, parallelMode: false },
    };

    // Run dispatcher logic for diagnostic UI values & REAL-TIME AUTO EXECUTION
    const output = runDispatcher(dispatcherInput);

    // Client-side auto-execution disabled to prevent double execution with server.
    // Server autoTradingService handles database trade placement and socket broadcast.
    setState(prev => ({
      ...prev,
      selectedStrategyId: output.state.selectedStrategyId,
      selectedStrategyName: output.state.selectedStrategyName,
      selectedStrategyMode: output.state.selectedStrategyMode,
      conditionsMet: output.state.conditionsMet,
      conditionsNotMet: output.state.conditionsNotMet,
      candidateStrategies: output.state.candidateStrategies,
    }));

    // Update candidate strategies display
    if (output.state.candidateStrategies.length !== state.candidateStrategies.length ||
        output.state.selectedStrategyId !== state.selectedStrategyId) {
      setState(prev => ({
        ...prev,
        selectedStrategyId: output.state.selectedStrategyId,
        selectedStrategyName: output.state.selectedStrategyName,
        selectedStrategyMode: output.state.selectedStrategyMode,
        conditionsMet: output.state.conditionsMet,
        conditionsNotMet: output.state.conditionsNotMet,
        candidateStrategies: output.state.candidateStrategies,
      }));
    }
  }, [ticker, state.isActive, props, slMode, openTradeInDb]);

  // ── Sync with Server AutoTrading Configuration & Positions ──
  useEffect(() => {
    let active = true;
    const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
    const base = isLocal ? "http://localhost:3000" : "";

    async function syncWithServer() {
      try {
        // 1. Fetch autotrade config status
        const statusRes = await fetch(`${base}/api/te/autotrade/status`);
        if (statusRes.ok && active) {
          const data = await statusRes.json();
          if (data.success && data.config) {
            setState(prev => ({
              ...prev,
              isActive: data.config.isActive,
              mode: data.config.mode,
            }));
            setSlMode(data.config.trailingSL ? "TRAILING" : "FIXED");
            setMaxTradesLimit(data.config.maxTradesLimit ?? 100);
          }
        }

        // 2. Fetch open paper trades to display active position
        const tradesRes = await fetch(`${base}/api/te/paper-trades?status=OPEN`);
        if (tradesRes.ok && active) {
          const data = await tradesRes.json();
          if (data.success && data.trades) {
            const instrumentOpenTrades = data.trades.filter((t: any) => t.instrument === props.indexSymbol);
            
            if (state.parallelMode) {
              const activePositions: Record<string, ActivePosition> = {};
              instrumentOpenTrades.forEach((t: any) => {
                const pos = mapDbTradeToActivePosition(t);
                activePositions[pos.strategyId] = pos;
              });
              setState(prev => ({ ...prev, activePositions }));
            } else {
              const openTrade = instrumentOpenTrades.find((t: any) => {
                try {
                  const notes = JSON.parse(t.notes || "{}");
                  return notes.type !== "ORB_NAKED"; // Skip ORB naked trades
                } catch {
                  return true;
                }
              });
              if (openTrade) {
                const pos = mapDbTradeToActivePosition(openTrade);
                setState(prev => ({ ...prev, activePosition: pos }));
              } else {
                setState(prev => ({ ...prev, activePosition: null }));
              }
            }
          }
        }
      } catch (err) {
        console.error("Error syncing with autotrade server:", err);
      }
    }

    syncWithServer();
    const interval = setInterval(syncWithServer, 3000); // Poll every 3 seconds

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [props.indexSymbol, state.parallelMode]);

  // ── Notify client on new trade entry synced from server ──
  const lastActiveId = React.useRef<string | null>(null);
  useEffect(() => {
    if (state.activePosition && state.activePosition.id !== lastActiveId.current) {
      lastActiveId.current = state.activePosition.id;
      const ageMs = Date.now() - state.activePosition.entryTime;
      if (ageMs < 15000) { // entered in the last 15 seconds
        sendTradeNotification("BUY", {
          direction: state.activePosition.direction,
          strike:    state.activePosition.strikePrice,
          strategy:  state.activePosition.strategyName,
          premium:   state.activePosition.entryPremium,
          score:     99,
          index:     props.indexSymbol,
        });
      }
    } else if (!state.activePosition) {
      lastActiveId.current = null;
    }
  }, [state.activePosition, props.indexSymbol, sendTradeNotification]);

  // ── WebSocket Listener for Server Broadcasts ──
  useEffect(() => {
    if (!props.socket) return;

    const handleStatusUpdate = (config: any) => {
      setState(prev => ({
        ...prev,
        isActive: config.isActive,
        mode: config.mode,
      }));
      setSlMode(config.trailingSL ? "TRAILING" : "FIXED");
      setMaxTradesLimit(config.maxTradesLimit ?? 100);
    };

    const handleMomentumUpdate = (data: any) => {
      if (data.page === props.indexSymbol) {
        setState(prev => ({
          ...prev,
          scoreMomentumHistory: data.history || [],
        }));
      }
    };

    const handleMicroScalpUpdate = (data: any) => {
      if (data.page === props.indexSymbol) {
        setState(prev => ({
          ...prev,
          microScalpModeActive: data.active,
        }));
      }
    };

    props.socket.on("autotrade-status-update", handleStatusUpdate);
    props.socket.on("score-momentum-update", handleMomentumUpdate);
    props.socket.on("micro-scalp-status-update", handleMicroScalpUpdate);

    return () => {
      props.socket.off("autotrade-status-update", handleStatusUpdate);
      props.socket.off("score-momentum-update", handleMomentumUpdate);
      props.socket.off("micro-scalp-status-update", handleMicroScalpUpdate);
    };
  }, [props.socket, props.indexSymbol]);

  const updateServerConfig = useCallback(async (cfgPatch: any) => {
    const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
    const base = isLocal ? "http://localhost:3000" : "";
    
    try {
      await fetch(`${base}/api/te/autotrade/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfgPatch),
      });
    } catch (err) {
      console.error("Failed to update autotrade config on server:", err);
    }
  }, []);

  const toggleActive = useCallback(async () => {
    const nextActive = !state.isActive;
    setState(prev => ({ ...prev, isActive: nextActive }));
    await updateServerConfig({ isActive: nextActive });
  }, [state.isActive, updateServerConfig]);

  const toggleMode = useCallback(async (mode: "PAPER" | "LIVE") => {
    setState(prev => ({ ...prev, mode }));
    await updateServerConfig({ mode });
  }, [updateServerConfig]);
  const toggleParallelMode = useCallback(() => {
    setState(prev => ({
      ...prev,
      parallelMode:    !prev.parallelMode,
      activePositions: {},        // reset open positions on mode switch
      strategyStats:   {},        // reset stats
      activePosition:  null,      // clear single-mode position
    }));
  }, []);

  const resetDailyLimit = useCallback(() => {
    setState(prev => ({ ...prev, tradingBlocked: false, blockReason: "", dailyPnl: 0, closedToday: [] }));
  }, []);

  const manualExit = useCallback(() => {
    if (!state.activePosition) return;
    const realizedPnl = state.activePosition.unrealizedPnl;
    // ─ Notify SELL ───────────────────────────────────────────────────
    sendTradeNotification("SELL", {
      pnl:       realizedPnl,
      direction: state.activePosition.direction,
      index:     props.indexSymbol,
      strategy:  state.activePosition.strategyName,
    });
    setState(prev => ({
      ...prev,
      activePosition: null,
      closedToday: [...prev.closedToday, {
        ...prev.activePosition!,
        status: realizedPnl >= 0 ? "CLOSED_PROFIT" : "CLOSED_LOSS",
        exitPremium: prev.activePosition!.currentPremium,
        exitTime: Date.now(),
        exitReason: "Manual exit by user",
        realizedPnl,
      }],
      dailyPnl: prev.dailyPnl + realizedPnl,
    }));
  }, [state.activePosition, sendTradeNotification, props.indexSymbol]);

  const candidateIds = new Set(state.candidateStrategies.map(c => c.id));
  const dailyLossPct = (Math.abs(Math.min(0, state.dailyPnl)) / state.dailyLossLimitRs) * 100;
  const intradayWins = state.closedToday.filter(p => p.mode === "INTRADAY" && (p.realizedPnl ?? 0) > 0).length;
  const positionalWins = state.closedToday.filter(p => p.mode === "POSITIONAL" && (p.realizedPnl ?? 0) > 0).length;

  return (
    <div className="p-4 space-y-4 bg-[#040811] text-slate-200 min-h-screen">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-900">
        <div>
          <h1 className="text-xl font-black text-white tracking-wider uppercase flex items-center gap-2">
            <Brain className="text-indigo-400" size={22} />
            AI Auto Strategy Dispatcher
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full tracking-widest border
              ${state.mode === "PAPER"
                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                : "bg-rose-500/15 text-rose-400 border-rose-500/30 animate-pulse"}`}>
              {state.mode === "PAPER" ? "📋 PAPER MODE" : "⚡ LIVE MODE"}
            </span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            {state.parallelMode
              ? `⚡ Parallel Mode — sabhi strategies simultaneously · ${Object.keys(state.activePositions).length} open`
              : `Intraday + Positional · Daily Loss Limit ₹${state.dailyLossLimitRs.toLocaleString()} · Max 1 Position`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* SL Mode toggle */}
          <div className="flex rounded border border-slate-800 overflow-hidden">
            {(["FIXED", "TRAILING"] as SLMode[]).map(m => (
              <button key={m} onClick={() => { setSlMode(m); updateServerConfig({ trailingSL: m === "TRAILING" }); }}
                className={`px-2.5 py-1.5 text-[10px] font-black uppercase font-mono cursor-pointer transition-all
                  ${slMode === m ? "bg-indigo-600 text-white" : "bg-transparent text-slate-500 hover:text-slate-300"}`}>
                {m === "FIXED" ? "Fixed SL" : "Trail SL"}
              </button>
            ))}
          </div>

          {/* Paper/Live mode */}
          <div className="flex rounded border border-slate-800 overflow-hidden">
            <button onClick={() => toggleMode("PAPER")}
              className={`px-2.5 py-1.5 text-[10px] font-black uppercase font-mono cursor-pointer transition-all
                ${state.mode === "PAPER" ? "bg-amber-600/30 text-amber-400 border-r border-amber-600/30" : "text-slate-500 hover:text-slate-300"}`}>
              Paper
            </button>
            <button onClick={() => toggleMode("LIVE")}
              className={`px-2.5 py-1.5 text-[10px] font-black uppercase font-mono cursor-pointer transition-all
                ${state.mode === "LIVE" ? "bg-rose-600/30 text-rose-400" : "text-slate-500 hover:text-slate-300"}`}>
              Live
            </button>
          </div>

          {/* Trade Limit Controller */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-800 bg-[#09152b] text-[10px] font-mono text-slate-300">
            <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Max Limit:</span>
            <input
              type="number"
              value={maxTradesLimit}
              onChange={async (e) => {
                const val = Math.max(1, parseInt(e.target.value) || 1);
                setMaxTradesLimit(val);
                await updateServerConfig({ maxTradesLimit: val });
              }}
              className="w-10 bg-transparent text-center border-b border-slate-700 focus:border-indigo-500 outline-none font-bold text-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <div className="flex flex-col gap-0.5 select-none leading-[6px]">
              <button 
                onClick={async () => {
                  const nextVal = maxTradesLimit + 5;
                  setMaxTradesLimit(nextVal);
                  await updateServerConfig({ maxTradesLimit: nextVal });
                }}
                className="hover:text-indigo-400 cursor-pointer text-[7px]"
              >
                ▲
              </button>
              <button 
                onClick={async () => {
                  const nextVal = Math.max(1, maxTradesLimit - 5);
                  setMaxTradesLimit(nextVal);
                  await updateServerConfig({ maxTradesLimit: nextVal });
                }}
                className="hover:text-indigo-400 cursor-pointer text-[7px]"
              >
                ▼
              </button>
            </div>
          </div>

          {/* Parallel Mode Toggle removed per user request for strictly 1 active trade at a time */}

          <div className="flex items-center gap-2 px-4 py-2 rounded font-mono text-xs font-black border bg-emerald-500/15 border-emerald-500/30 text-emerald-400 select-none shadow-sm shadow-emerald-500/10">
            <Play size={13} fill="currentColor" /> ALWAYS ACTIVE
          </div>
        </div>
      </div>

      {/* ── Daily Loss Limit Warning ─────────────────────────────────────────── */}
      {state.tradingBlocked && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
          <AlertTriangle className="text-rose-400 flex-shrink-0" size={18} />
          <div className="flex-1">
            <div className="text-xs font-black text-rose-400 uppercase">Daily Loss Limit Hit</div>
            <div className="text-[10px] text-rose-300/70 font-mono">{state.blockReason}</div>
          </div>
          <button onClick={resetDailyLimit}
            className="text-[10px] font-black text-rose-400 border border-rose-500/30 px-2 py-1 rounded hover:bg-rose-500/10 cursor-pointer">
            Reset
          </button>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-slate-900 pb-0">
        {[
          { id: "DASHBOARD", label: "DASHBOARD" },
          { id: "INTRADAY", label: "INTRADAY MATRIX" },
          { id: "SWING", label: "SWING MATRIX" },
          { id: "HISTORY", label: "HISTORY" }
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 text-[11px] font-black uppercase font-mono tracking-wider transition-all cursor-pointer border-b-2
              ${activeTab === tab.id
                ? "border-indigo-500 text-indigo-300 bg-indigo-500/10"
                : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/30"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* DASHBOARD TAB */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "DASHBOARD" && (
        <div className="relative rounded-2xl overflow-hidden mb-4 mt-2 border border-teal-500/15">
          <div className="absolute inset-0 bg-gradient-to-r from-teal-950/80 via-[#04111d] to-emerald-950/30" />
          <div className="absolute top-0 right-0 w-72 h-72 bg-teal-500/[0.07] blur-[100px] pointer-events-none" />
          <div className="absolute bottom-0 left-20 w-40 h-40 bg-emerald-500/[0.05] blur-[80px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-teal-500/40 to-transparent" />
          <div className="relative z-10 p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/30">
                <Zap size={22} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white tracking-wider uppercase flex items-center gap-2.5">
                  Intraday Command Center
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/25 tracking-widest">IQ 200</span>
                </h2>
                <p className="text-[11px] text-teal-300/50 font-mono mt-1 tracking-wide">MICRO-SCALP & DAY TRADING · REAL-TIME AI EXECUTION</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-black">Intraday Strategies</div>
                <div className="text-2xl font-black text-teal-400 font-mono">{STRATEGY_REGISTRY.filter(s => s.mode === "INTRADAY").length}</div>
              </div>
              <div className="w-px h-10 bg-slate-700/50" />
              <div className="text-right">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-black">Engine Status</div>
                <div className="text-xs font-black text-emerald-400 flex items-center gap-1.5 justify-end mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
                  {state.isActive ? "SCANNING" : "PAUSED"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "DASHBOARD" && (
        <div className="space-y-4">

          {/* ── Top Stats ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox
              label="Daily P&L"
              value={fmtRs(state.dailyPnl)}
              color={state.dailyPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
              sub={`Limit: ₹${state.dailyLossLimitRs.toLocaleString()}`}
            />
            <StatBox
              label="Trades Today"
              value={`${state.closedToday.length}`}
              color="text-white"
              sub={`${intradayWins + positionalWins}W / ${state.closedToday.length - intradayWins - positionalWins}L`}
            />
            <StatBox
              label="Active Position"
              value={state.activePosition ? state.activePosition.strategyName.split(" ").slice(0, 2).join(" ") : "None"}
              color={state.activePosition ? "text-indigo-300" : "text-slate-500"}
              sub={state.activePosition ? `${state.activePosition.direction} @ ${state.activePosition.strikePrice}` : "Watching market..."}
            />
            <StatBox
              label="AI Signal"
              value={props.aiDirection}
              color={props.aiDirection === "BUY_CE" ? "text-emerald-400" : props.aiDirection === "BUY_PE" ? "text-rose-400" : "text-slate-500"}
              sub={`Conf: ${props.aiConfidence}%`}
            />
          </div>

          {/* ── Daily Loss Gauge ───────────────────────────────────────────── */}
          <div className={`relative rounded-xl border p-4 overflow-hidden transition-all duration-500 ${
            dailyLossPct > 80 ? 'border-rose-500/30 bg-gradient-to-r from-rose-950/30 via-[#0a0612] to-[#060d1a]'
            : dailyLossPct > 50 ? 'border-amber-500/20 bg-gradient-to-r from-amber-950/20 via-[#0a0612] to-[#060d1a]'
            : 'border-slate-700/30 bg-gradient-to-r from-[#060d1a] to-[#0a1628]'
          }`}>
            {dailyLossPct > 70 && <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/[0.06] blur-[60px] pointer-events-none" />}
            <div className="relative z-10">
              <div className="flex justify-between items-center mb-2.5">
                <div className="flex items-center gap-2">
                  <Shield size={13} className={dailyLossPct > 80 ? "text-rose-400" : dailyLossPct > 50 ? "text-amber-400" : "text-emerald-400"} />
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Daily Risk Meter</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-black font-mono ${dailyLossPct > 80 ? "text-rose-400" : dailyLossPct > 50 ? "text-amber-400" : "text-emerald-400"}`}>
                    {dailyLossPct.toFixed(0)}%
                  </span>
                  <span className="text-[9px] text-slate-600 font-mono">₹{Math.abs(Math.min(0, state.dailyPnl)).toLocaleString()} / ₹{state.dailyLossLimitRs.toLocaleString()}</span>
                </div>
              </div>
              <div className="h-2.5 bg-slate-800/80 rounded-full overflow-hidden shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    dailyLossPct > 80 ? "bg-gradient-to-r from-rose-600 to-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
                    : dailyLossPct > 50 ? "bg-gradient-to-r from-amber-600 to-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.3)]"
                    : "bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                  }`}
                  style={{ width: `${Math.min(100, dailyLossPct)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ── Active Position ───────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                    <Activity size={11} className="text-white" />
                  </div>
                  {state.parallelMode
                    ? `Active Positions (${Object.keys(state.activePositions).length})`
                    : 'Active Position'}
                </h2>
                {/* Single mode exit */}
                {!state.parallelMode && state.activePosition && (
                  <button onClick={manualExit}
                    className="text-[10px] font-black text-rose-400 border border-rose-500/30 px-2 py-1 rounded hover:bg-rose-500/10 cursor-pointer transition-colors">
                    Exit Now
                  </button>
                )}
              </div>

              {/* ── PARALLEL MODE: grid of all open positions ── */}
              {state.parallelMode ? (
                Object.keys(state.activePositions).length === 0 ? (
                  <div className="rounded-xl border border-slate-800/40 bg-slate-900/20 p-6 flex flex-col items-center justify-center gap-2 text-center">
                    <Layers size={24} className="text-violet-700 animate-pulse" />
                    <span className="text-xs font-mono text-slate-600 uppercase tracking-wider">
                      {state.isActive ? 'Parallel scanning — waiting for signals...' : 'Parallel mode paused'}
                    </span>
                    <span className="text-[9px] text-slate-700 font-mono">
                      Jab conditions match hongi, sabhi strategies simultaneously enter karengi
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {Object.values(state.activePositions).map((pos: ActivePosition) => {
                      const pnl = pos.unrealizedPnl;
                      const pnlPct = pos.entryPremium > 0
                        ? ((pnl / (pos.entryPremium * pos.qty)) * 100).toFixed(1)
                        : '0';
                      return (
                        <div key={pos.id}
                          className={`rounded-lg border p-3 flex items-center gap-3
                            ${pnl >= 0 ? 'border-emerald-500/20 bg-emerald-950/8' : 'border-rose-500/20 bg-rose-950/8'}`}>
                          {/* Strategy info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"/>
                              <span className="text-[9px] font-black text-white truncate">{pos.strategyName}</span>
                              <span className="text-[7px] font-mono text-slate-600">{pos.strategyId}</span>
                              <span className={`text-[7px] font-black px-1 rounded ${pos.direction === 'CE' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                                {pos.direction}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[8px] font-mono text-slate-500">
                              <span>Entry: <span className="text-slate-300">₹{pos.entryPremium.toFixed(0)}</span></span>
                              <span>SL: <span className="text-rose-400/70">₹{pos.fixedSL.toFixed(0)}</span></span>
                              <span>Tgt: <span className="text-emerald-400/70">₹{pos.targetPremium.toFixed(0)}</span></span>
                            </div>
                          </div>
                          {/* Live P&L */}
                          <div className="text-right flex-shrink-0">
                            <div className={`text-sm font-black font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}
                            </div>
                            <div className={`text-[8px] font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {pnl >= 0 ? '+' : ''}{pnlPct}%
                            </div>
                          </div>
                          {/* Individual exit */}
                          <button
                            onClick={() => {
                              const realizedPnl = pos.unrealizedPnl;
                              setState(prev => {
                                const newPositions = { ...prev.activePositions };
                                delete newPositions[pos.strategyId];
                                const closedPos: ActivePosition = {
                                  ...pos, status: realizedPnl >= 0 ? 'CLOSED_PROFIT' : 'CLOSED_LOSS',
                                  exitPremium: pos.currentPremium, exitTime: Date.now(),
                                  exitReason: 'Manual exit', realizedPnl,
                                };
                                saveTradeToDb(closedPos);
                                return {
                                  ...prev,
                                  activePositions: newPositions,
                                  closedToday: [...prev.closedToday, closedPos],
                                  dailyPnl: prev.dailyPnl + realizedPnl,
                                  strategyStats: {
                                    ...prev.strategyStats,
                                    [pos.strategyId]: {
                                      trades:   (prev.strategyStats[pos.strategyId]?.trades  ?? 0) + 1,
                                      wins:     (prev.strategyStats[pos.strategyId]?.wins    ?? 0) + (realizedPnl >= 0 ? 1 : 0),
                                      losses:   (prev.strategyStats[pos.strategyId]?.losses  ?? 0) + (realizedPnl <  0 ? 1 : 0),
                                      totalPnl: (prev.strategyStats[pos.strategyId]?.totalPnl ?? 0) + realizedPnl,
                                      avgPnl:   0, winRate: 0,
                                    },
                                  },
                                };
                              });
                            }}
                            className="text-[8px] font-black text-rose-400/70 hover:text-rose-400 border border-rose-500/20 hover:border-rose-500/40 px-1.5 py-0.5 rounded transition-colors flex-shrink-0 cursor-pointer"
                          >
                            Exit
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                /* ── SINGLE MODE: original PositionMonitor ── */
                state.activePosition ? (
                  <PositionMonitor position={state.activePosition} />
                ) : (
                  <div className="relative rounded-xl border border-slate-700/30 bg-gradient-to-br from-[#060d1a] via-[#0a1228] to-[#060d1a] p-8 flex flex-col items-center justify-center gap-3 text-center overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(99,102,241,0.04)_0%,_transparent_70%)]" />
                    <div className="relative z-10 flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                        <Activity size={20} className="text-indigo-500/60 animate-pulse" />
                      </div>
                      <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">
                        {state.isActive ? "AI Scanning for entry..." : "Dispatcher paused"}
                      </span>
                      {state.selectedStrategyName && (
                        <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-3 py-1">
                          Watching: {state.selectedStrategyName}
                        </span>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>

            {/* ── AI Condition Check ────────────────────────────────────────── */}
            <div className="space-y-3">
              <h2 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md shadow-violet-500/20">
                  <Brain size={11} className="text-white" />
                </div>
                Strategy Condition Monitor
              </h2>

              <div className="relative rounded-xl border border-violet-500/15 bg-gradient-to-br from-[#0a0618] via-[#060d1a] to-[#0a0618] p-4 space-y-3 overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-violet-500/[0.04] blur-[80px] pointer-events-none" />
                {/* Live AI metrics grid */}
                <div className="grid grid-cols-3 gap-2 relative z-10">
                  {[
                    { label: "Regime", val: props.regime || "--", color: props.regime === "TRENDING" ? "text-emerald-400" : props.regime === "VOLATILE" ? "text-rose-400" : "text-sky-300" },
                    { label: "Session", val: props.sessionType || "--", color: "text-sky-300" },
                    { label: "VIX", val: props.indiaVix?.toFixed(1) || "--", color: (props.indiaVix ?? 0) > 18 ? "text-rose-400" : "text-emerald-400" },
                    { label: "PCR", val: props.pcr?.toFixed(2) || "--", color: (props.pcr ?? 0) > 1.2 ? "text-emerald-400" : (props.pcr ?? 0) < 0.8 ? "text-rose-400" : "text-amber-300" },
                    { label: "Smart $", val: `${props.smartMoneyScore || 0}`, color: "text-amber-300" },
                    { label: "Align", val: `${props.alignmentScore || 0}`, color: "text-amber-300" },
                  ].map(m => (
                    <div key={m.label} className="bg-slate-900/60 border border-slate-700/20 rounded-lg p-2 text-center group hover:border-violet-500/20 transition-all">
                      <div className="text-[7px] text-slate-500 uppercase tracking-widest font-black">{m.label}</div>
                      <div className={`text-sm font-black font-mono ${m.color}`}>{m.val}</div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-800/40 pt-3 relative z-10">
                  <div className="text-[9px] text-slate-500 font-black uppercase mb-2 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                    {state.selectedStrategyName
                      ? `Active: ${state.selectedStrategyName}`
                      : "Live Condition Scan"}
                  </div>
                  <div className="space-y-0.5 max-h-36 overflow-y-auto">
                    {state.conditionsMet.map((c, i) => <ConditionRow key={i} label={c} met={true} />)}
                    {state.conditionsNotMet.map((c, i) => <ConditionRow key={i} label={c} met={false} />)}
                    {state.conditionsMet.length === 0 && state.conditionsNotMet.length === 0 && (
                      <div className="text-[10px] text-slate-600 font-mono text-center py-2">Waiting for market scan...</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Candidate Strategies */}
              {state.candidateStrategies.length > 0 && (
                <div className="relative rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/20 to-[#060d1a] p-3 overflow-hidden">
                  <div className="absolute top-0 left-0 w-24 h-24 bg-emerald-500/[0.06] blur-[50px] pointer-events-none" />
                  <div className="relative z-10">
                    <div className="text-[9px] text-emerald-400 font-black uppercase mb-2 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                      {state.candidateStrategies.length} Strategies Ready to Fire
                    </div>
                    <div className="space-y-1">
                      {state.candidateStrategies.slice(0, 4).map((c, i) => (
                        <div key={c.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-slate-500 font-mono w-3">{i + 1}.</span>
                            <span className={`text-[10px] font-mono ${i === 0 ? "text-indigo-300 font-black" : "text-slate-400"}`}>
                              {c.name}
                            </span>
                            <ModeTag mode={c.mode} />
                          </div>
                          <span className="text-[10px] font-black text-amber-400 font-mono">{c.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "DASHBOARD" && (
        <div className="relative rounded-xl border border-indigo-500/15 bg-gradient-to-br from-[#060d1a] via-[#0a1228] to-[#060d1a] p-4 space-y-2.5 overflow-hidden">
          <div className="absolute top-0 left-0 w-48 h-48 bg-indigo-500/[0.04] blur-[80px] pointer-events-none" />
          <div className="relative z-10 flex items-center justify-between">
            <h3 className="text-[10px] text-indigo-400 font-black uppercase tracking-wider flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                <BarChart2 size={10} className="text-white" />
              </div>
              5-Minute Score Momentum Tracker
            </h3>
            {state.microScalpModeActive ? (
              <span className="text-[8px] font-black px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20 animate-pulse">
                🔥 BERSERKER MICRO-SCALP ACTIVE
              </span>
            ) : (
              <span className="text-[8px] font-black px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                🟢 NORMAL ENGINE ON
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[10px] font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="py-1.5 pr-2 font-black uppercase">Time Window</th>
                  <th className="py-1.5 px-2 font-black uppercase text-center">High Score</th>
                  <th className="py-1.5 px-2 font-black uppercase text-center">Low Score</th>
                  <th className="py-1.5 px-2 font-black uppercase text-center">Last Score</th>
                  <th className="py-1.5 pl-2 font-black uppercase text-right">Trend Bias</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {state.scoreMomentumHistory && state.scoreMomentumHistory.length > 0 ? (
                  [...state.scoreMomentumHistory].slice().reverse().map((win) => {
                    const startMin = new Date(win.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                    
                    return (
                      <tr key={win.interval} className="hover:bg-slate-900/30">
                        <td className="py-1.5 pr-2 text-slate-400">{startMin} (5m slot)</td>
                        <td className="py-1.5 px-2 text-center text-emerald-400 font-bold">{Math.round(win.high)}%</td>
                        <td className="py-1.5 px-2 text-center text-rose-400 font-bold">{Math.round(win.low)}%</td>
                        <td className="py-1.5 px-2 text-center text-slate-200">{Math.round(win.lastScore)}%</td>
                        <td className="py-1.5 pl-2 text-right">
                          {win.lastScore > win.low + (win.high - win.low) * 0.5 ? (
                            <span className="text-emerald-400 font-black">📈 CE BULLISH</span>
                          ) : win.lastScore < win.low + (win.high - win.low) * 0.5 ? (
                            <span className="text-rose-400 font-black">📉 PE BEARISH</span>
                          ) : (
                            <span className="text-slate-500 font-black">↔️ NEUTRAL</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-600">
                      No score history accumulated yet. Waiting for ticks...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "DASHBOARD" && (props.candles5m ?? []).length >= 16 && (() => {
        const rv = computeReversalFrontend(props.candles5m ?? [], props.prevClose);
        const fmt = (v: number | null, dec = 1) => v !== null ? v.toFixed(dec) : '--';
        const zoneColor = (v: number | null, low: number, high: number) =>
          v === null ? 'text-slate-500' : v <= low ? 'text-emerald-400' : v >= high ? 'text-rose-400' : 'text-amber-300';
        const crossBorder = (triggered: boolean, bull: boolean) =>
          triggered ? (bull ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-rose-500/50 bg-rose-950/20')
            : 'border-slate-700/20 bg-slate-800/20';
        return (
          <div className="relative rounded-xl border border-cyan-500/15 bg-gradient-to-br from-[#060d1a] via-[#081520] to-[#060d1a] p-4 space-y-3 overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 bg-cyan-500/[0.04] blur-[80px] pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
                  <TrendingUp size={10} className="text-white" />
                </div>
                <span className="text-[10px] text-cyan-400 font-black uppercase tracking-wider">Reversal Indicators (5M)</span>
              </div>
              <span className="text-[8px] text-slate-600 font-mono bg-slate-800/50 px-2 py-0.5 rounded">{(props.candles5m ?? []).length} bars</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {([
                { label: 'RSI', val: rv.rsi14, dec: 1, low: 30, high: 70, cross: rv.rsiCrossedAbove30 || rv.rsiCrossedBelow70, bull: rv.rsiCrossedAbove30, sub: rv.rsiCrossedAbove30 ? '↑30' : rv.rsiCrossedBelow70 ? '↓70' : rv.rsi14 != null ? (rv.rsi14 < 30 ? 'OS' : rv.rsi14 > 70 ? 'OB' : 'MID') : '--' },
                { label: 'MFI', val: rv.mfi14, dec: 1, low: 20, high: 80, cross: rv.mfiCrossedAbove20 || rv.mfiCrossedBelow80, bull: rv.mfiCrossedAbove20, sub: rv.mfiCrossedAbove20 ? '↑20' : rv.mfiCrossedBelow80 ? '↓80' : rv.mfi14 != null ? (rv.mfi14 < 20 ? 'OS' : rv.mfi14 > 80 ? 'OB' : 'MID') : '--' },
                { label: 'MOM', val: rv.momentum14, dec: 0, low: -999, high: 0, cross: rv.momentumCrossedAbove0 || rv.momentumCrossedBelow0, bull: rv.momentumCrossedAbove0, sub: rv.momentumCrossedAbove0 ? '↑0' : rv.momentumCrossedBelow0 ? '↓0' : rv.momentum14 != null ? (rv.momentum14 > 0 ? '+ve' : '-ve') : '--' },
                { label: 'LR°', val: rv.lrAngle, dec: 1, low: -25, high: 25, cross: rv.lrAngleCrossedAboveMinus25 || rv.lrAngleCrossedBelow25, bull: rv.lrAngleCrossedAboveMinus25, sub: rv.lrAngleCrossedAboveMinus25 ? '↑-25' : rv.lrAngleCrossedBelow25 ? '↓+25' : rv.lrAngle != null ? (rv.lrAngle > 25 ? 'BULL' : rv.lrAngle < -25 ? 'BEAR' : 'FLAT') : '--' },
                { label: 'STOCH', val: rv.stochK, dec: 0, low: 20, high: 80, cross: rv.stochBullishCross || rv.stochBearishCross, bull: rv.stochBullishCross, sub: rv.stochBullishCross ? 'K↑D' : rv.stochBearishCross ? 'K↓D' : rv.stochK != null ? `D:${fmt(rv.stochD, 0)}` : '--' },
              ] as const).map(({ label, val, dec, low, high, cross, bull, sub }) => (
                <div key={label} className={`rounded p-1.5 text-center border transition-all duration-500 ${crossBorder(cross, bull)}`}>
                  <div className="text-[7px] uppercase font-black text-slate-500">{label}</div>
                  <div className={`text-[11px] font-black font-mono ${cross ? (bull ? 'text-emerald-300' : 'text-rose-300') : zoneColor(val, low, high)}`}>
                    {val != null ? (dec === 0 && val > 0 ? '+' : '') + fmt(val, dec) : '--'}
                  </div>
                  <div className={`text-[7px] font-mono ${cross ? (bull ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-600'}`}>{sub}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1">
              <div className="bg-slate-900/40 border border-slate-700/20 rounded p-1.5">
                <div className="text-[7px] text-slate-500 font-black uppercase mb-0.5">ORB 9:15–9:30</div>
                <div className="flex justify-between">
                  <span className="text-[9px] font-mono text-emerald-400">{rv.orbHigh ? rv.orbHigh.toFixed(0) : '--'}</span>
                  <span className="text-[8px] text-slate-600">/</span>
                  <span className="text-[9px] font-mono text-rose-400">{rv.orbLow ? rv.orbLow.toFixed(0) : '--'}</span>
                </div>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/20 rounded p-1.5">
                <div className="text-[7px] text-slate-500 font-black uppercase mb-0.5">Day H / L</div>
                <div className="flex justify-between">
                  <span className="text-[9px] font-mono text-emerald-400">{rv.dayHigh ? rv.dayHigh.toFixed(0) : '--'}</span>
                  <span className="text-[8px] text-slate-600">/</span>
                  <span className="text-[9px] font-mono text-rose-400">{rv.dayLow ? rv.dayLow.toFixed(0) : '--'}</span>
                </div>
              </div>
              <div className={`border rounded p-1.5 ${rv.gapPct != null && Math.abs(rv.gapPct) > 0.3 ? (rv.gapPct > 0 ? 'bg-emerald-950/25 border-emerald-600/25' : 'bg-rose-950/25 border-rose-600/25') : 'bg-slate-900/40 border-slate-700/20'}`}>
                <div className="text-[7px] text-slate-500 font-black uppercase mb-0.5">Gap %</div>
                <div className={`text-[10px] font-black font-mono text-center ${rv.gapPct != null ? (rv.gapPct > 0.3 ? 'text-emerald-400' : rv.gapPct < -0.3 ? 'text-rose-400' : 'text-slate-400') : 'text-slate-600'}`}>
                  {rv.gapPct != null ? `${rv.gapPct > 0 ? '+' : ''}${rv.gapPct.toFixed(2)}%` : '--'}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SWING POSITION TERMINAL (DASHBOARD) */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "DASHBOARD" && (
        <div className="mt-6 mb-4 space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-violet-500/15">
            <div className="absolute inset-0 bg-gradient-to-r from-violet-950/80 via-[#0a0618] to-purple-950/30" />
            <div className="absolute top-0 right-0 w-72 h-72 bg-violet-500/[0.07] blur-[100px] pointer-events-none" />
            <div className="absolute bottom-0 left-20 w-40 h-40 bg-purple-500/[0.05] blur-[80px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
            <div className="relative z-10 p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <Calendar size={22} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white tracking-wider uppercase flex items-center gap-2.5">
                    Swing Position Terminal
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25 tracking-widest">IQ 200</span>
                  </h2>
                  <p className="text-[11px] text-violet-300/50 font-mono mt-1 tracking-wide">MULTI-DAY HOLDS · INSTITUTIONAL FLOW · HTF CONFLUENCE</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[8px] text-slate-500 uppercase tracking-wider font-black">Swing Strategies</div>
                  <div className="text-2xl font-black text-violet-400 font-mono">{STRATEGY_REGISTRY.filter(s => s.mode === "POSITIONAL").length}</div>
                </div>
              </div>
            </div>
          </div>
          
          <PositionTradingDashboard 
            activePage={props.indexSymbol || "NIFTY"}
            spotPrice={props.prevClose || 0}
            darkMode={true}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* INTRADAY STRATEGIES TAB */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "INTRADAY" && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-teal-950/60 to-[#040811] border-l-4 border-l-teal-500 border-t border-r border-b border-slate-800/60 rounded-r-xl p-4 flex items-center justify-between relative overflow-hidden">
            <div className="absolute right-0 top-0 w-64 h-64 bg-teal-500/5 blur-3xl pointer-events-none" />
            <div className="relative z-10">
              <h2 className="text-lg font-black text-teal-400 uppercase tracking-widest flex items-center gap-2 drop-shadow-[0_0_8px_rgba(45,212,191,0.4)]">
                <Zap size={18} className="animate-pulse" /> Intraday Strategy Matrix
              </h2>
              <p className="text-[10px] text-teal-100/60 font-mono mt-1 max-w-2xl">
                High-frequency, same-day execution algorithms. Requires strict momentum and volume confirmation. Evaluates market breadth and 15M ranges continuously.
              </p>
            </div>
            <div className="flex items-center gap-4 relative z-10">
               <div className="text-center bg-teal-950/40 border border-teal-500/20 rounded px-4 py-2">
                 <div className="text-[9px] text-teal-500 font-black uppercase tracking-wider">Active Intraday</div>
                 <div className="text-xl font-black text-teal-300">{STRATEGY_REGISTRY.filter(s => s.mode === "INTRADAY").length}</div>
               </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {STRATEGY_REGISTRY.filter(s => s.mode === "INTRADAY").map(strategy => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                isSelected={state.selectedStrategyId === strategy.id}
                isCandidate={candidateIds.has(strategy.id)}
                score={state.candidateStrategies.find(c => c && c.id === strategy.id)?.score}
              />
            ))}
          </div>

          <div className="rounded-lg border border-dashed border-teal-500/20 bg-teal-950/10 p-4 text-center">
            <div className="text-[11px] text-teal-500/70 font-mono">
              ⚡ Advanced AI Intraday Conditions active — Trades will auto-deploy when all parameters match.
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SWING POSITION STRATEGIES TAB */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "SWING" && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-violet-950/60 to-[#040811] border-l-4 border-l-violet-500 border-t border-r border-b border-slate-800/60 rounded-r-xl p-4 flex items-center justify-between relative overflow-hidden">
            <div className="absolute right-0 top-0 w-64 h-64 bg-violet-500/5 blur-3xl pointer-events-none" />
            <div className="relative z-10">
              <h2 className="text-lg font-black text-violet-400 uppercase tracking-widest flex items-center gap-2 drop-shadow-[0_0_8px_rgba(139,92,246,0.4)]">
                <Calendar size={18} className="animate-pulse" /> Swing Position Matrix
              </h2>
              <p className="text-[10px] text-violet-100/60 font-mono mt-1 max-w-2xl">
                Multi-day positional holds. Relies on Higher Timeframe (HTF) confluence, institutional data, and broader regime trends. Max Hold up to several days.
              </p>
            </div>
            <div className="flex items-center gap-4 relative z-10">
               <div className="text-center bg-violet-950/40 border border-violet-500/20 rounded px-4 py-2">
                 <div className="text-[9px] text-violet-500 font-black uppercase tracking-wider">Active Swing</div>
                 <div className="text-xl font-black text-violet-300">{STRATEGY_REGISTRY.filter(s => s.mode === "POSITIONAL").length}</div>
               </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {STRATEGY_REGISTRY.filter(s => s.mode === "POSITIONAL").map(strategy => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                isSelected={state.selectedStrategyId === strategy.id}
                isCandidate={candidateIds.has(strategy.id)}
                score={state.candidateStrategies.find(c => c && c.id === strategy.id)?.score}
              />
            ))}
          </div>

          <div className="rounded-lg border border-dashed border-violet-500/20 bg-violet-950/10 p-4 text-center">
            <div className="text-[11px] text-violet-500/70 font-mono">
              🌌 Swing Engine active — Monitoring macro shifts and FII/DII sentiment for optimal entries.
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* HISTORY TAB */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "HISTORY" && (() => {
        // Merge in-memory + DB history for stats
        const totalDbPnl = dbHistory.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0);
        const combinedPnl = state.dailyPnl + totalDbPnl;
        const totalTrades  = state.closedToday.length + dbHistory.length;
        const totalWins    = state.closedToday.filter(p => (p.realizedPnl ?? 0) > 0).length
                           + dbHistory.filter((t: any) => (t.pnl ?? 0) > 0).length;
        const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(0) : '--';

        // ── Parallel Mode Leaderboard ──────────────────────────────────────
        if (state.parallelMode) {
          // Build sorted leaderboard from strategyStats + STRATEGY_REGISTRY
          const leaderboard = STRATEGY_REGISTRY
            .filter(s => s.isActive)
            .map(s => {
              const stats: StrategyStats = state.strategyStats[s.id] ?? {
                trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, winRate: 0,
              };
              const isOpen = !!state.activePositions[s.id];
              const openPos = state.activePositions[s.id];
              return { s, stats, isOpen, openPos };
            })
            // Sort: most trades first, then by win rate
            .sort((a, b) => {
              if (b.stats.trades !== a.stats.trades) return b.stats.trades - a.stats.trades;
              return b.stats.winRate - a.stats.winRate;
            });

          const openCount   = Object.keys(state.activePositions).length;
          const closedCount = state.closedToday.length;
          const totalParallelPnl = Object.values(state.strategyStats as Record<string, StrategyStats>)
            .reduce((s, st) => s + st.totalPnl, 0);

          return (
            <div className="space-y-3">
              {/* Parallel summary */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-2 text-center">
                  <div className="text-lg font-black text-violet-300">{openCount}</div>
                  <div className="text-[8px] text-slate-500 uppercase tracking-wider">Live Open</div>
                </div>
                <div className="bg-slate-800/40 border border-slate-700/20 rounded-lg p-2 text-center">
                  <div className="text-lg font-black text-slate-300">{closedCount}</div>
                  <div className="text-[8px] text-slate-500 uppercase tracking-wider">Closed Today</div>
                </div>
                <div className="bg-slate-800/40 border border-slate-700/20 rounded-lg p-2 text-center">
                  <div className="text-lg font-black text-amber-400">
                    {closedCount > 0 ? `${((totalWins / closedCount) * 100).toFixed(0)}%` : '--'}
                  </div>
                  <div className="text-[8px] text-slate-500 uppercase tracking-wider">Win Rate</div>
                </div>
                <div className={`border rounded-lg p-2 text-center ${totalParallelPnl >= 0 ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-rose-500/8 border-rose-500/20'}`}>
                  <div className={`text-lg font-black ${totalParallelPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totalParallelPnl >= 0 ? '+' : ''}₹{totalParallelPnl.toFixed(0)}
                  </div>
                  <div className="text-[8px] text-slate-500 uppercase tracking-wider">Total P&L</div>
                </div>
              </div>

              {/* Strategy Leaderboard */}
              <div className="rounded-xl border border-violet-500/15 bg-[#060d1a] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers size={11} className="text-violet-400"/>
                    <span className="text-[9px] font-black text-slate-300 uppercase tracking-wider">Strategy Leaderboard</span>
                    <span className="text-[7px] text-slate-600 font-mono">Win rate ke hisaab se sort</span>
                  </div>
                  <span className="text-[7px] text-violet-400 font-mono">{leaderboard.length} strategies</span>
                </div>

                {/* Column headers */}
                <div className="grid grid-cols-12 gap-1 px-4 py-1.5 border-b border-slate-800/30 text-[7px] font-black text-slate-600 uppercase tracking-wider">
                  <div className="col-span-4">Strategy</div>
                  <div className="col-span-1 text-center">Trades</div>
                  <div className="col-span-1 text-center">W</div>
                  <div className="col-span-1 text-center">L</div>
                  <div className="col-span-2 text-center">Win%</div>
                  <div className="col-span-1 text-center">Avg</div>
                  <div className="col-span-2 text-right">Total P&L</div>
                </div>

                <div className="divide-y divide-slate-800/20 max-h-[420px] overflow-y-auto">
                  {leaderboard.map(({ s, stats, isOpen, openPos }) => {
                    const noTrades = stats.trades === 0;
                    const profitable = stats.totalPnl > 0;
                    return (
                      <div key={s.id}
                        className={`grid grid-cols-12 gap-1 px-4 py-2.5 items-center transition-colors
                          ${isOpen ? 'bg-violet-500/5' : 'hover:bg-slate-800/10'}
                          ${!noTrades && profitable ? 'border-l-2 border-emerald-500/30' : ''}
                          ${!noTrades && !profitable ? 'border-l-2 border-rose-500/20' : ''}`}>
                        {/* Strategy name */}
                        <div className="col-span-4">
                          <div className="flex items-center gap-1.5">
                            {isOpen && <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse flex-shrink-0"/>}
                            <div>
                              <div className="text-[9px] font-black text-white truncate leading-tight">{s.name}</div>
                              <div className="text-[6px] font-mono text-slate-600">{s.id} · {s.mode}</div>
                            </div>
                          </div>
                          {isOpen && openPos && (
                            <div className="text-[7px] font-mono text-violet-400/80 mt-0.5">
                              {openPos.direction} · ₹{openPos.entryPremium.toFixed(0)} entry
                              {' '}
                              <span className={openPos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {openPos.unrealizedPnl >= 0 ? '+' : ''}₹{openPos.unrealizedPnl.toFixed(0)}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Trades */}
                        <div className="col-span-1 text-center text-[9px] font-mono text-slate-400">
                          {noTrades ? <span className="text-slate-700">—</span> : stats.trades}
                        </div>
                        {/* Wins */}
                        <div className="col-span-1 text-center text-[9px] font-mono text-emerald-500">
                          {noTrades ? <span className="text-slate-700">—</span> : stats.wins}
                        </div>
                        {/* Losses */}
                        <div className="col-span-1 text-center text-[9px] font-mono text-rose-500">
                          {noTrades ? <span className="text-slate-700">—</span> : stats.losses}
                        </div>
                        {/* Win Rate bar */}
                        <div className="col-span-2">
                          {noTrades ? (
                            <span className="text-[7px] text-slate-700 font-mono block text-center">no data</span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${stats.winRate >= 60 ? 'bg-emerald-500' : stats.winRate >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                  style={{ width: `${stats.winRate}%` }}
                                />
                              </div>
                              <span className={`text-[8px] font-black font-mono ${stats.winRate >= 60 ? 'text-emerald-400' : stats.winRate >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
                                {stats.winRate.toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Avg P&L */}
                        <div className="col-span-1 text-center">
                          {noTrades ? (
                            <span className="text-[7px] text-slate-700 font-mono">—</span>
                          ) : (
                            <span className={`text-[8px] font-mono ${stats.avgPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {stats.avgPnl >= 0 ? '+' : ''}₹{Math.abs(stats.avgPnl).toFixed(0)}
                            </span>
                          )}
                        </div>
                        {/* Total P&L */}
                        <div className="col-span-2 text-right">
                          {noTrades ? (
                            <span className="text-[7px] text-slate-700 font-mono">—</span>
                          ) : (
                            <span className={`text-[10px] font-black font-mono ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {stats.totalPnl >= 0 ? '+' : ''}₹{stats.totalPnl.toFixed(0)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Hint */}
              <div className="text-center text-[8px] text-slate-700 font-mono py-1">
                💡 Parallel mode: sabhi {leaderboard.length} strategies simultaneously run kar rahi hain · win rate compare karo
              </div>
            </div>
          );
        }

        return (
          <div className="space-y-3">
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Total Trades" value={`${totalTrades}`} />
              <StatBox label="Win Rate" value={totalTrades > 0 ? `${winRate}%` : '--'} color="text-amber-400" />
              <StatBox label="Realized P&L" value={fmtRs(combinedPnl)}
                color={combinedPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
            </div>

            {/* Live Session trades (in-memory, current session only) */}
            {(() => {
              const mainSessionTrades = state.closedToday.filter(t => !t.strategyName.includes("Micro Scalp"));
              const microScalpTrades = state.closedToday.filter(t => t.strategyName.includes("Micro Scalp"));
              
              return (
                <>
                  {mainSessionTrades.length > 0 && (
                    <div className="space-y-1.5 mb-4">
                      <div className="flex items-center gap-2 px-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"/>
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-wider">Live Session</span>
                        <span className="text-[8px] text-slate-600 font-mono">{mainSessionTrades.length} trade(s)</span>
                      </div>
                      {[...mainSessionTrades].reverse().map((pos, i) => (
                  <div key={pos.id || i} className={`rounded-xl border p-3 space-y-2
                    ${(pos.realizedPnl ?? 0) >= 0 ? "border-emerald-500/20 bg-emerald-950/8" : "border-rose-500/20 bg-rose-950/8"}`}>
                    {/* Row 1: Strategy name + P&L */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[10px] font-black text-white">{pos.strategyName}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[7px] font-mono text-slate-600 bg-slate-800/50 px-1 rounded">{pos.strategyId}</span>
                          <ModeTag mode={pos.mode} />
                          <span className={`text-[7px] font-black px-1 rounded ${pos.direction === 'BULL' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                            {pos.direction === 'BULL' ? 'CE' : 'PE'}
                          </span>
                        </div>
                      </div>
                      <PnlBadge pnl={pos.realizedPnl ?? 0} />
                    </div>
                    {/* Row 2: Entry / Exit details */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-900/40 rounded p-1.5">
                        <div className="text-[7px] text-slate-500 uppercase font-black mb-0.5">Entry</div>
                        <div className="text-[9px] font-mono text-slate-300">₹{pos.entryPremium?.toFixed(0)} · Strike {pos.strikePrice}</div>
                        <div className="text-[8px] text-slate-500 font-mono">{fmtTime(pos.entryTime)}</div>
                      </div>
                      <div className="bg-slate-900/40 rounded p-1.5">
                        <div className="text-[7px] text-slate-500 uppercase font-black mb-0.5">Exit</div>
                        <div className="text-[9px] font-mono text-slate-300">₹{(pos.exitPremium ?? pos.currentPremium)?.toFixed(0)}</div>
                        <div className="text-[8px] text-slate-500 font-mono">{fmtTime(pos.exitTime ?? 0)}</div>
                      </div>
                    </div>
                    {/* Row 3: SL, Target, Exit reason */}
                    <div className="flex items-center gap-3 text-[8px] font-mono">
                      <span className="text-slate-500">SL: <span className="text-rose-400">₹{pos.stopLoss?.toFixed(0)}</span></span>
                      <span className="text-slate-500">Tgt: <span className="text-emerald-400">₹{pos.target?.toFixed(0)}</span></span>
                      <span className="text-slate-600 truncate flex-1">{pos.exitReason}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {microScalpTrades.length > 0 && (
              <div className="space-y-1.5 mb-4 p-2 rounded-xl border border-fuchsia-500/20 bg-[#070308]">
                <div className="flex items-center justify-between px-1 border-b border-fuchsia-500/10 pb-1 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 shadow-[0_0_8px_#d946ef] animate-ping"/>
                    <span className="text-[9px] font-black text-fuchsia-400 uppercase tracking-widest drop-shadow-[0_0_5px_#d946ef]">⚡ MICRO SCALP ENGINE</span>
                  </div>
                  <span className="text-[8px] text-fuchsia-600 font-mono">{microScalpTrades.length} HIGH-FREQ</span>
                </div>
                
                <div className="grid grid-cols-1 gap-1.5">
                  {[...microScalpTrades].reverse().map((pos, i) => (
                    <div key={pos.id || i} className={`rounded-lg border p-1.5 flex items-center justify-between
                      ${(pos.realizedPnl ?? 0) >= 0 ? "border-emerald-500/30 bg-emerald-950/20" : "border-rose-500/30 bg-rose-950/20"}`}>
                      
                      <div className="flex flex-col">
                         <span className="text-[8px] font-black text-fuchsia-300">{pos.strategyName.replace("Micro Scalp Fallback", "MS-FB")}</span>
                         <div className="flex items-center gap-1 mt-0.5">
                           <span className="text-[6px] font-mono text-slate-500">{fmtTime(pos.entryTime)}</span>
                           <span className={`text-[6px] font-black px-1 rounded ${pos.direction === 'BULL' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                             {pos.direction === 'BULL' ? 'CE' : 'PE'}
                           </span>
                         </div>
                      </div>
                      
                      <div className="flex flex-col items-end">
                         <span className={`text-[9px] font-black ${(pos.realizedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400 drop-shadow-[0_0_2px_#fb7185]'}`}>
                           {(pos.realizedPnl ?? 0) > 0 ? '+' : ''}{fmtRs(pos.realizedPnl ?? 0)}
                         </span>
                         <span className="text-[6px] text-slate-500 font-mono truncate max-w-[80px]">{pos.exitReason?.split(" ")[0]}</span>
                      </div>
                      
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            </>
          );
        })()}

            {/* DB History (persisted, survives reload) */}
            <div className="rounded-xl border border-slate-700/25 bg-[#060d1a] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/50">
                <div className="flex items-center gap-2">
                  <CheckCircle size={11} className="text-emerald-400"/>
                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-wider">
                    Saved History
                  </span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 font-mono">{dbHistory.length}</span>
                  <span className="text-[7px] text-slate-700 font-mono">DB — survives reload</span>
                </div>
                <button
                  onClick={loadDbHistory}
                  className="text-[8px] text-slate-500 hover:text-slate-300 font-mono px-2 py-0.5 rounded border border-slate-700/30 hover:border-slate-600/50 transition-colors"
                >
                  🔄 Refresh
                </button>
              </div>

              {dbHistory.length === 0 ? (
                <div className="py-8 text-center space-y-1">
                  <div className="text-[10px] text-slate-600 font-mono">Koi saved trade nahi mila</div>
                  <div className="text-[9px] text-slate-700">Jab Auto Strategy Dispatcher trade close karega, yahan permanently save hoga</div>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/30">
                  {dbHistory.slice(0, 50).map((t: any) => {
                    let meta: any = {};
                    try { meta = JSON.parse(t.notes || '{}'); } catch {}
                    const pnl = t.pnl ?? 0;
                    const entryTime = t.timestamp ? new Date(t.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
                    const exitTime  = t.closed_at  ? new Date(t.closed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
                    const dateStr   = t.timestamp  ? new Date(t.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                    return (
                      <div key={t.id} className="px-4 py-3 hover:bg-slate-800/15 transition-colors space-y-1.5">
                        {/* Header row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black text-white">{meta.strategyName || t.signal_ref || 'Unknown Strategy'}</span>
                            {meta.strategyId && (
                              <span className="text-[10px] font-mono text-slate-400 bg-slate-800/60 px-1.5 py-0.5 rounded">{meta.strategyId}</span>
                            )}
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${t.direction === 'BUY_CE' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                              {t.direction === 'BUY_CE' ? 'CE' : 'PE'}
                            </span>
                            {meta.mode && <span className="text-[10px] font-mono text-slate-400">{meta.mode}</span>}
                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded text-fuchsia-400 bg-fuchsia-500/10 border border-fuchsia-500/20">IQ 200</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-400 font-mono">{dateStr}</span>
                            <span className={`text-sm font-black font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}
                            </span>
                          </div>
                        </div>
                        {/* Entry/Exit row */}
                        <div className="flex items-center gap-4 text-xs font-mono text-slate-400 mt-1">
                          <span>Entry: <span className="text-slate-200">₹{t.entry_price?.toFixed(0)} · {t.strike}</span></span>
                          <span>Exit: <span className="text-slate-200">₹{t.exit_price?.toFixed(0) ?? '--'}</span></span>
                          <span className="text-indigo-400/80 font-bold">{entryTime} → {exitTime}</span>
                          <span>SL: <span className="text-rose-400/70">₹{t.stop_loss?.toFixed(0)}</span></span>
                          <span>Tgt: <span className="text-emerald-400/70">₹{t.target?.toFixed(0)}</span></span>
                        </div>
                        {/* Exit reason */}
                        {meta.exitReason && (
                          <div className="text-xs text-slate-500 font-mono truncate">
                            🚪 {meta.exitReason}
                          </div>
                        )}
                        {/* Conditions that were met */}
                        {Array.isArray(meta.conditionsMet) && meta.conditionsMet.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {meta.conditionsMet.slice(0, 4).map((c: string, ci: number) => (
                              <span key={ci} className="text-[10px] font-mono text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                                ✓ {c}
                              </span>
                            ))}
                            {meta.conditionsMet.length > 4 && (
                              <span className="text-[6px] font-mono text-slate-600">+{meta.conditionsMet.length - 4} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {dbHistory.length > 50 && (
                    <div className="py-2 text-center text-[8px] text-slate-600 font-mono">
                      +{dbHistory.length - 50} aur trades DB mein hain
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default AutoStrategyTab;
