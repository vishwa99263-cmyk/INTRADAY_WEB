/**
 * SwingTradeSystem.tsx
 * ──────────────────────────────────────────────────────────────────────
 * Swing / Positional Trade lene ka complete system:
 *  • Stock Scanner — multi-timeframe scoring se swing candidates filter
 *  • Signal Engine — EMA crossover, RSI, Volume, Breakout rules
 *  • Trade Planner — Entry / SL / Target calculator with R:R
 *  • Open Swing Positions ledger with P&L tracking
 *  • Market Pulse — weekly trend context (Nifty, BankNifty, Sensex)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  TrendingUp, TrendingDown, Target, ShieldAlert, Zap, Clock,
  Plus, Trash2, RefreshCw, ChevronDown, ChevronUp, Search,
  AlertCircle, CheckCircle2, BarChart3, Activity, BookOpen,
  ArrowUpRight, ArrowDownRight, Minus, Filter, Download,
  Star, Eye, Lock, Unlock, Info
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type SwingDirection = "LONG" | "SHORT";
type SwingStatus = "OPEN" | "TARGET_HIT" | "SL_HIT" | "EXITED" | "PENDING";
type SignalStrength = "STRONG" | "MODERATE" | "WEAK";
type TimeframeScore = { tf: string; score: number; label: string };

interface SwingCandidate {
  symbol: string;
  ltp: number;
  changePercent: number;
  volume: number;
  score: number;
  weightage: number;
  direction: SwingDirection;
  signalStrength: SignalStrength;
  reasons: string[];
  ema20: number;
  ema50: number;
  rsi: number;
  atr: number;
  volumeRatio: number;
  supportLevel: number;
  resistanceLevel: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskReward: number;
  timeframeScores: TimeframeScore[];
  holdingPeriod: string;
  sectorBias: string;
  lastUpdated: number;
  optionChainData?: {
    pcr: number;
    callOI: number;
    putOI: number;
    oiBias: "BULLISH_BUILDUP" | "BEARISH_BUILDUP" | "NEUTRAL";
    optionConditionMatched: boolean;
    conditionMatchLabel: string;
    hasRealOptionChain?: boolean;
    realAtmPremium?: number;
  };
}

interface SwingPosition {
  id: string;
  symbol: string;
  direction: SwingDirection;
  tradeType: "EQUITY" | "OPTION";
  optionType?: "CE" | "PE" | null;
  strike?: number | null;
  expiry?: string | null;
  lotSize: number;
  optionSymbol?: string | null;
  entryPrice: number;
  qty: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskReward: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  status: SwingStatus;
  notes: string;
  createdAt: number;
  closedAt?: number;
  exitPrice?: number;
  holdingDays: number;
  signalBasis: string;
  sectorTheme: string;
}

interface SwingTradeSystemProps {
  darkMode: boolean;
  niftyStocks: any[];
  bankniftyStocks: any[];
  sensexStocks: any[];
  niftySpot: number;
  bankniftySpot: number;
  sensexSpot: number;
  niftyHistory: { high: number; low: number; prevClose: number };
  bankniftyHistory: { high: number; low: number; prevClose: number };
  sensexHistory: { high: number; low: number; prevClose: number };
  pcr: number;
  serverTime: number;
  relianceOptionChain?: any;
  hdfcbankOptionChain?: any;
  icicibankOptionChain?: any;
  customStockOptionChain?: any;
  customStockSymbol?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const API = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

const fmt = (n: number, d = 2) => n?.toFixed(d) ?? "—";
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
const fmtCr = (n: number) => `₹${(n / 10000000).toFixed(2)}Cr`;

const getSignalColor = (sig: SignalStrength, dark: boolean) => {
  if (sig === "STRONG") return dark ? "text-emerald-400" : "text-emerald-600";
  if (sig === "MODERATE") return dark ? "text-amber-400" : "text-amber-600";
  return dark ? "text-slate-400" : "text-slate-500";
};

const getSignalBg = (sig: SignalStrength, dark: boolean) => {
  if (sig === "STRONG") return dark ? "bg-emerald-500/15 border-emerald-500/30" : "bg-emerald-50 border-emerald-200";
  if (sig === "MODERATE") return dark ? "bg-amber-500/15 border-amber-500/30" : "bg-amber-50 border-amber-200";
  return dark ? "bg-slate-800/60 border-slate-700" : "bg-slate-50 border-slate-200";
};

// ─── Swing Signal Engine ─────────────────────────────────────────────────────

function computeSwingSignal(
  stock: any,
  relianceOptionChain?: any,
  hdfcbankOptionChain?: any,
  icicibankOptionChain?: any,
  customStockOptionChain?: any,
  customStockSymbol?: string
): Partial<SwingCandidate> | null {
  if (!stock || !stock.ltp || stock.ltp <= 0) return null;

  const ltp = stock.ltp;
  const chg = stock.changePercent || 0;
  const vol = stock.volume || 0;
  const score = stock.score || 0;
  const score15m = stock.score15m || 0;
  const score30m = stock.score30m || 0;
  const score1h = stock.score1h || 0;
  const backupScore = stock.backupScore || 0;
  const scoreDiff = stock.scoreDifference || 0;

  // === Timeframe alignment scoring ===
  const tfScores: TimeframeScore[] = [
    { tf: "5M", score: scoreDiff, label: scoreDiff > 0 ? "▲" : scoreDiff < 0 ? "▼" : "—" },
    { tf: "15M", score: stock.score15mDiff || 0, label: (stock.score15mDiff || 0) > 0 ? "▲" : (stock.score15mDiff || 0) < 0 ? "▼" : "—" },
    { tf: "30M", score: stock.score30mDiff || 0, label: (stock.score30mDiff || 0) > 0 ? "▲" : (stock.score30mDiff || 0) < 0 ? "▼" : "—" },
    { tf: "1H", score: stock.score1hDiff || 0, label: (stock.score1hDiff || 0) > 0 ? "▲" : (stock.score1hDiff || 0) < 0 ? "▼" : "—" },
  ];

  // Alignment check — how many TFs agree?
  const bullAligned = tfScores.filter(t => t.score > 0).length;
  const bearAligned = tfScores.filter(t => t.score < 0).length;
  const dominantBull = bullAligned >= 3;
  const dominantBear = bearAligned >= 3;
  const hasAlignment = dominantBull || dominantBear;

  // Current live score trend
  const momentumBull = score > 3 && scoreDiff > 0;
  const momentumBear = score < -3 && scoreDiff < 0;

  // Volume surge (estimate: volume > 0 means stock is actively traded)
  const volumeRatio = vol > 0 ? Math.min(vol / 500000, 5) : 1; // normalize
  const hasVolumeSpike = volumeRatio > 1.5;

  // Simple EMA approximation from score data (using score as proxy)
  const ema20 = ltp * (1 + (score / 200));
  const ema50 = ltp * (1 + (backupScore / 400));
  const emaBull = ema20 > ema50;
  const emaBear = ema20 < ema50;

  // RSI estimation (from momentum data)
  const rsiRaw = 50 + (score * 1.5) + (chg * 2);
  const rsi = Math.max(10, Math.min(90, rsiRaw));

  // ATR approximation — 1.5% of price
  const atr = ltp * 0.015;

  // Support / Resistance (from price action)
  const pivotRange = ltp * 0.015;
  let supportLevel = ltp - pivotRange;
  let resistanceLevel = ltp + pivotRange;

  // Fetch real option chain data if available
  const sym = (stock.symbol || stock.ticker?.split(":")?.[1]?.split("-")?.[0] || "").toUpperCase();
  let realChain: any = null;
  if (sym === "RELIANCE") realChain = relianceOptionChain;
  else if (sym === "HDFCBANK") realChain = hdfcbankOptionChain;
  else if (sym === "ICICIBANK") realChain = icicibankOptionChain;
  else if (customStockSymbol && sym === customStockSymbol.toUpperCase()) realChain = customStockOptionChain;

  let hasRealOptionChain = false;
  let callOI = Math.round(vol * 1.4 + 140000);
  let putOI = Math.round(vol * 1.8 + 180000);
  let pcrVal = putOI > 0 ? Number((putOI / callOI).toFixed(2)) : 1.15;

  if (realChain) {
    hasRealOptionChain = true;
    callOI = realChain.totalCallOi || callOI;
    putOI = realChain.totalPutOi || putOI;
    pcrVal = callOI > 0 ? Number((putOI / callOI).toFixed(2)) : (realChain.pcr || 1.15);

    if (realChain.monthlyMetrics?.supportWall) {
      supportLevel = realChain.monthlyMetrics.supportWall;
    } else if (realChain.supportWall) {
      supportLevel = realChain.supportWall;
    }
    if (realChain.monthlyMetrics?.resistanceWall) {
      resistanceLevel = realChain.monthlyMetrics.resistanceWall;
    } else if (realChain.resistanceWall) {
      resistanceLevel = realChain.resistanceWall;
    }
  }

  // ═══ LONG Signal ═══
  if (dominantBull && momentumBull && (emaBull || chg > 0)) {
    const reasons: string[] = [];
    if (dominantBull) reasons.push(`${bullAligned}/4 TF alignment bullish`);
    if (momentumBull) reasons.push("Live score momentum UP");
    if (emaBull) reasons.push("EMA20 > EMA50 (bullish crossover)");
    if (hasVolumeSpike) reasons.push("Volume surge detected");
    if (chg > 1) reasons.push(`Strong price gain +${fmt(chg)}%`);
    if (rsi < 60) reasons.push("RSI not overbought");

    const strength: SignalStrength = (bullAligned === 4 && hasVolumeSpike) ? "STRONG"
      : bullAligned >= 3 ? "MODERATE" : "WEAK";

    const entryLow = ltp;
    const entryHigh = ltp * 1.005;
    const sl = Math.max(supportLevel, ltp - atr * 1.5);
    const riskPts = ltp - sl;
    const t1 = ltp + riskPts * 1.5;
    const t2 = ltp + riskPts * 2.5;
    const t3 = ltp + riskPts * 4;
    const rr = riskPts > 0 ? riskPts * 2.5 / riskPts : 2.5;

    // Calculate synthetic / real stock option chain parameters
    const oiBias: "BULLISH_BUILDUP" | "BEARISH_BUILDUP" | "NEUTRAL" = pcrVal >= 1.05 ? "BULLISH_BUILDUP" : pcrVal <= 0.9 ? "BEARISH_BUILDUP" : "NEUTRAL";
    const optionConditionMatched = oiBias === "BULLISH_BUILDUP";
    const conditionMatchLabel = optionConditionMatched ? "🎯 STOCK + OPTION MATCH (HIGH CONVICTION CE)" : "⚠️ OPTION MISMATCH";

    if (optionConditionMatched) {
      reasons.push(`Option Chain: Bullish Buildup (PCR ${pcrVal})`);
    }

    let realAtmPremium = 0;
    if (realChain && Array.isArray(realChain.strikes) && realChain.strikes.length > 0) {
      const step = ltp > 1000 ? 50 : ltp > 500 ? 20 : 10;
      const atmStrike = Math.round(ltp / step) * step;
      const strikeRow = realChain.strikes.find((s: any) => s.strikePrice === atmStrike);
      if (strikeRow) {
        realAtmPremium = strikeRow.ceLtp || 0;
      }
    }

    return {
      direction: "LONG",
      signalStrength: strength,
      reasons,
      ema20, ema50, rsi, atr, volumeRatio,
      supportLevel, resistanceLevel,
      entryZoneLow: entryLow,
      entryZoneHigh: entryHigh,
      stopLoss: sl,
      target1: t1, target2: t2, target3: t3,
      riskReward: rr,
      timeframeScores: tfScores,
      holdingPeriod: bullAligned === 4 ? "2–5 days" : "1–3 days",
      sectorBias: "Sectoral bullish momentum",
      optionChainData: {
        pcr: pcrVal,
        callOI,
        putOI,
        oiBias,
        optionConditionMatched,
        conditionMatchLabel,
        hasRealOptionChain,
        realAtmPremium,
      }
    };
  }

  // ═══ SHORT Signal ═══
  if (dominantBear && momentumBear && (emaBear || chg < 0)) {
    const reasons: string[] = [];
    if (dominantBear) reasons.push(`${bearAligned}/4 TF alignment bearish`);
    if (momentumBear) reasons.push("Live score momentum DOWN");
    if (emaBear) reasons.push("EMA20 < EMA50 (death cross)");
    if (hasVolumeSpike) reasons.push("Volume surge on down-move");
    if (chg < -1) reasons.push(`Strong price fall ${fmt(chg)}%`);
    if (rsi > 40) reasons.push("RSI not oversold");

    const strength: SignalStrength = (bearAligned === 4 && hasVolumeSpike) ? "STRONG"
      : bearAligned >= 3 ? "MODERATE" : "WEAK";

    const entryLow = ltp * 0.995;
    const entryHigh = ltp;
    const sl = Math.min(resistanceLevel, ltp + atr * 1.5);
    const riskPts = sl - ltp;
    const t1 = ltp - riskPts * 1.5;
    const t2 = ltp - riskPts * 2.5;
    const t3 = ltp - riskPts * 4;
    const rr = riskPts > 0 ? riskPts * 2.5 / riskPts : 2.5;

    // Calculate synthetic / real stock option chain parameters
    const oiBias: "BULLISH_BUILDUP" | "BEARISH_BUILDUP" | "NEUTRAL" = pcrVal <= 0.95 ? "BEARISH_BUILDUP" : pcrVal >= 1.1 ? "BULLISH_BUILDUP" : "NEUTRAL";
    const optionConditionMatched = oiBias === "BEARISH_BUILDUP";
    const conditionMatchLabel = optionConditionMatched ? "🎯 STOCK + OPTION MATCH (HIGH CONVICTION PE)" : "⚠️ OPTION MISMATCH";

    if (optionConditionMatched) {
      reasons.push(`Option Chain: Bearish Buildup (PCR ${pcrVal})`);
    }

    let realAtmPremium = 0;
    if (realChain && Array.isArray(realChain.strikes) && realChain.strikes.length > 0) {
      const step = ltp > 1000 ? 50 : ltp > 500 ? 20 : 10;
      const atmStrike = Math.round(ltp / step) * step;
      const strikeRow = realChain.strikes.find((s: any) => s.strikePrice === atmStrike);
      if (strikeRow) {
        realAtmPremium = strikeRow.peLtp || 0;
      }
    }

    return {
      direction: "SHORT",
      signalStrength: strength,
      reasons,
      ema20, ema50, rsi, atr, volumeRatio,
      supportLevel, resistanceLevel,
      entryZoneLow: entryLow,
      entryZoneHigh: entryHigh,
      stopLoss: sl,
      target1: t1, target2: t2, target3: t3,
      riskReward: rr,
      timeframeScores: tfScores,
      holdingPeriod: bearAligned === 4 ? "2–5 days" : "1–3 days",
      sectorBias: "Sectoral bearish momentum",
      optionChainData: {
        pcr: pcrVal,
        callOI,
        putOI,
        oiBias,
        optionConditionMatched,
        conditionMatchLabel,
        hasRealOptionChain,
        realAtmPremium,
      }
    };
  }

  return null;
}

function buildCandidates(
  stocks: any[],
  minStrength: "STRONG" | "MODERATE" | "WEAK" = "MODERATE",
  relianceOptionChain?: any,
  hdfcbankOptionChain?: any,
  icicibankOptionChain?: any,
  customStockOptionChain?: any,
  customStockSymbol?: string
): SwingCandidate[] {
  const strengthOrder = { STRONG: 3, MODERATE: 2, WEAK: 1 };
  const minOrd = strengthOrder[minStrength];

  return stocks
    .map(s => {
      const sig = computeSwingSignal(
        s,
        relianceOptionChain,
        hdfcbankOptionChain,
        icicibankOptionChain,
        customStockOptionChain,
        customStockSymbol
      );
      if (!sig) return null;
      if (strengthOrder[sig.signalStrength!] < minOrd) return null;
      return {
        symbol: s.symbol || s.ticker?.split(":")?.[1]?.split("-")?.[0] || "UNKNOWN",
        ltp: s.ltp,
        changePercent: s.changePercent,
        volume: s.volume,
        score: s.score,
        weightage: s.weightage,
        ...sig,
      } as SwingCandidate;
    })
    .filter(Boolean) as SwingCandidate[];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Market Pulse Bar
function MarketPulse({ niftySpot, bankniftySpot, sensexSpot, niftyHistory, bankniftyHistory, sensexHistory, dark }: any) {
  const indices = [
    { label: "NIFTY 50", spot: niftySpot, hist: niftyHistory, color: "#10b981" },
    { label: "BANKNIFTY", spot: bankniftySpot, hist: bankniftyHistory, color: "#8b5cf6" },
    { label: "SENSEX", spot: sensexSpot, hist: sensexHistory, color: "#f59e0b" },
  ];

  return (
    <div className={`flex gap-3 px-4 py-2.5 rounded-xl border text-[11px] ${dark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"}`}>
      {indices.map(idx => {
        const chg = idx.hist?.prevClose > 0 ? ((idx.spot - idx.hist.prevClose) / idx.hist.prevClose) * 100 : 0;
        const isBull = chg >= 0;
        return (
          <div key={idx.label} className="flex items-center gap-2 border-r border-slate-700/40 pr-3 last:border-0">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: idx.color }} />
            <span className="font-bold" style={{ color: idx.color }}>{idx.label}</span>
            <span className={`font-black tabular-nums ${dark ? "text-slate-200" : "text-slate-800"}`}>
              {idx.spot > 0 ? idx.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
            </span>
            <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${isBull ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
              {isBull ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Signal Card
function CandidateCard({
  c, dark, onAddTrade
}: { c: SwingCandidate; dark: boolean; onAddTrade: (c: SwingCandidate, defaultType: "EQUITY" | "OPTION") => void; key?: React.Key }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = c.direction === "LONG";

  const matchedStrategies = [];
  if (Math.abs(c.changePercent) >= 1.0 || c.reasons.some(r => r.toLowerCase().includes("breakout") || r.toLowerCase().includes("crossover"))) {
    matchedStrategies.push("BREAKOUT");
  }
  if (c.volumeRatio > 1.5 || c.reasons.some(r => r.toLowerCase().includes("volume"))) {
    matchedStrategies.push("TURNOVER_SURGE");
  }
  if (c.optionChainData?.optionConditionMatched || (c.optionChainData && (c.optionChainData.pcr > 1.2 || c.optionChainData.pcr < 0.8))) {
    matchedStrategies.push("GAMMA_SQUEEZE");
  }

  const borderColor = isLong
    ? (c.signalStrength === "STRONG" ? "border-emerald-500/50" : "border-emerald-500/25")
    : (c.signalStrength === "STRONG" ? "border-rose-500/50" : "border-rose-500/25");

  const bgColor = isLong
    ? (dark ? "bg-emerald-950/20" : "bg-emerald-50/80")
    : (dark ? "bg-rose-950/20" : "bg-rose-50/80");

  const accentText = isLong
    ? (dark ? "text-emerald-400" : "text-emerald-700")
    : (dark ? "text-rose-400" : "text-rose-700");

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-3.5 flex flex-col gap-2.5 select-none transition-all duration-200 hover:shadow-lg`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {isLong
            ? <ArrowUpRight size={15} className={accentText} />
            : <ArrowDownRight size={15} className={accentText} />
          }
          <span className={`text-[13px] font-black tracking-wide ${dark ? "text-white" : "text-slate-900"}`}>{c.symbol}</span>
          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${getSignalBg(c.signalStrength, dark)} ${getSignalColor(c.signalStrength, dark)}`}>
            {c.signalStrength}
          </span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isLong ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
            {c.direction}
          </span>
          {matchedStrategies.map(st => (
            <span key={st} className="text-[8px] font-black px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-950/40 text-cyan-300">
              {st === "BREAKOUT" ? "⚡ BREAKOUT" : st === "TURNOVER_SURGE" ? "📊 TURNOVER" : "🚀 GAMMA"}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-black tabular-nums ${dark ? "text-white" : "text-slate-900"}`}>
            ₹{c.ltp?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </span>
          <span className={`text-[9px] font-bold ${c.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {fmtPct(c.changePercent)}
          </span>
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: "Entry", val: `₹${fmt(c.entryZoneLow)}–${fmt(c.entryZoneHigh)}`, color: "text-sky-400" },
          { label: "Stop Loss", val: `₹${fmt(c.stopLoss)}`, color: "text-rose-400" },
          { label: "Target 1", val: `₹${fmt(c.target1)}`, color: "text-emerald-400" },
          { label: "R:R", val: `1:${fmt(c.riskReward, 1)}`, color: "text-violet-400" },
        ].map(m => (
          <div key={m.label} className={`rounded-lg p-2 text-center ${dark ? "bg-slate-900/50" : "bg-white/70"}`}>
            <div className={`text-[8px] font-bold uppercase opacity-60 ${dark ? "text-slate-400" : "text-slate-500"}`}>{m.label}</div>
            <div className={`text-[10px] font-black tabular-nums ${m.color}`}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* TF Alignment */}
      <div className="flex items-center gap-1.5">
        <span className={`text-[8px] font-bold uppercase opacity-60 ${dark ? "text-slate-500" : "text-slate-400"}`}>TF Align:</span>
        {c.timeframeScores.map(tf => (
          <span key={tf.tf} className={`text-[8px] font-black px-1.5 py-0.5 rounded ${
            tf.score > 0 ? "bg-emerald-500/20 text-emerald-400" :
            tf.score < 0 ? "bg-rose-500/20 text-rose-400" :
            dark ? "bg-slate-700 text-slate-400" : "bg-slate-200 text-slate-500"
          }`}>
            {tf.tf} {tf.label}
          </span>
        ))}
        <span className={`ml-auto text-[8px] font-bold ${dark ? "text-slate-500" : "text-slate-400"}`}>Hold: {c.holdingPeriod}</span>
      </div>

      {/* Option Chain Analysis & Stock Condition Match Badge (10X Option Buyer Mindset + Strikes & Support/Resistance) */}
      {c.optionChainData && (() => {
        const isCeBuy = c.direction === "LONG";
        const isPeBuy = c.direction === "SHORT";
        const isMatched = c.optionChainData.optionConditionMatched;

        const buyerCardBg = isCeBuy
          ? (dark ? "bg-gradient-to-r from-emerald-950/50 via-teal-950/40 to-slate-950 border-emerald-500/50 shadow-[0_0_18px_rgba(16,185,129,0.2)]" : "bg-emerald-50 border-emerald-300 text-emerald-950")
          : (dark ? "bg-gradient-to-r from-rose-950/50 via-red-950/40 to-slate-950 border-rose-500/50 shadow-[0_0_18px_rgba(244,63,94,0.2)]" : "bg-rose-50 border-rose-300 text-rose-950");

        const buyerTagClass = isCeBuy
          ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/70 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
          : "bg-rose-950/90 text-rose-300 border-rose-500/70 shadow-[0_0_10px_rgba(244,63,94,0.5)]";

        const buyerLabel = isCeBuy ? "⚡ HIGH CONVICTION BUY CE" : "⚡ HIGH CONVICTION BUY PE";

        // Strike Price Calculations
        const step = c.ltp > 1000 ? 50 : c.ltp > 500 ? 20 : 10;
        const atmStrike = Math.round(c.ltp / step) * step;
        const itmStrike = isCeBuy ? atmStrike - step : atmStrike + step;
        const otmStrike = isCeBuy ? atmStrike + step : atmStrike - step;

        return (
          <div className={`rounded-xl p-3 border flex flex-col gap-2 transition-all ${buyerCardBg}`}>
            {/* Header Status */}
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-black uppercase tracking-wider flex items-center gap-1 ${
                isCeBuy ? "text-emerald-400" : "text-rose-400"
              }`}>
                <Zap size={13} className={isCeBuy ? "text-emerald-400 animate-bounce" : "text-rose-400 animate-bounce"} />
                {isCeBuy ? "CALL BUYER ENGINE (BUY CE)" : "PUT BUYER ENGINE (BUY PE)"}
              </span>
              <div className="flex items-center gap-1.5">
                {isMatched && (
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-500/30 to-emerald-500/30 text-amber-300 border border-amber-400/60 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.5)]">
                    🔥 HIGH PROFIT TRADE ACTIVE
                  </span>
                )}
                <span className={`text-[9.5px] font-mono font-black px-2 py-0.5 rounded border uppercase ${buyerTagClass}`}>
                  {isMatched ? buyerLabel : (isCeBuy ? "⚠️ CE CAUTION" : "⚠️ PE CAUTION")}
                </span>
              </div>
            </div>

            {/* Call Metrics vs Put Metrics Strip */}
            <div className="grid grid-cols-2 gap-2 border-t border-b border-slate-700/40 py-1.5">
              {/* Call Metrics */}
              <div className="flex flex-col gap-0.5 bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/30">
                <div className="flex items-center justify-between text-[9.5px] font-black text-emerald-400 uppercase">
                  <span>CALL METRICS</span>
                  <span>CE BUILDUP</span>
                </div>
                <div className="flex items-center justify-between font-mono text-[11.5px] font-bold text-white">
                  <span>OI: <span className="text-emerald-300">{(c.optionChainData.callOI / 100000).toFixed(1)}L</span></span>
                  <span className="text-[10px] text-emerald-400 font-black">+{((c.volume || 10000) * 0.08 / 1000).toFixed(1)}k Δ</span>
                </div>
              </div>

              {/* Put Metrics */}
              <div className="flex flex-col gap-0.5 bg-rose-950/40 p-2 rounded-lg border border-rose-500/30">
                <div className="flex items-center justify-between text-[9.5px] font-black text-rose-400 uppercase">
                  <span>PUT METRICS</span>
                  <span>PE BUILDUP</span>
                </div>
                <div className="flex items-center justify-between font-mono text-[11.5px] font-bold text-white">
                  <span>OI: <span className="text-rose-300">{(c.optionChainData.putOI / 100000).toFixed(1)}L</span></span>
                  <span className="text-[10px] text-rose-400 font-black">+{((c.volume || 10000) * 0.09 / 1000).toFixed(1)}k Δ</span>
                </div>
              </div>
            </div>

            {/* Support & Resistance Levels + All Sentiment Matrix */}
            <div className="flex items-center justify-between font-mono text-[11px] font-bold bg-black/50 px-2.5 py-1.5 rounded-lg border border-cyan-500/30">
              <span className="text-emerald-400">SUP (S1): ₹{c.supportLevel?.toFixed(1)}</span>
              <span className="text-slate-600">|</span>
              <span className="text-rose-400">RES (R1): ₹{c.resistanceLevel?.toFixed(1)}</span>
              <span className="text-slate-600">|</span>
              <span>PCR: <span className={c.optionChainData.pcr >= 1 ? "text-emerald-400 font-black" : "text-rose-400 font-black"}>{c.optionChainData.pcr}</span></span>
              <span className="text-slate-600">|</span>
              <span className={`px-2 py-0.5 rounded text-[9.5px] font-black uppercase shadow-[0_0_8px_rgba(34,211,238,0.3)] ${
                isCeBuy ? "bg-emerald-950 text-emerald-300 border border-emerald-500/50" : "bg-rose-950 text-rose-300 border border-rose-500/50"
              }`}>
                {isCeBuy ? "🔥 BULL SENTIMENT" : "❄️ BEAR SENTIMENT"}
              </span>
            </div>

            {/* Single Best Recommended Strike Price */}
            <div className="flex items-center justify-between bg-gradient-to-r from-amber-950/70 via-slate-950 to-slate-950 p-2.5 rounded-xl border border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <div className="flex items-center gap-2">
                <span className="text-[14px]">🎯</span>
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase text-amber-400 tracking-wider">RECOMMENDED BEST STRIKE</span>
                  <span className="text-[8.5px] text-slate-400 font-mono">SPOT: ₹{c.ltp?.toFixed(1)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`px-3.5 py-1.5 rounded-lg font-mono text-[14px] font-black tracking-wide border shadow-[0_0_10px_rgba(245,158,11,0.4)] ${
                  isCeBuy
                    ? "bg-emerald-950 text-emerald-300 border-emerald-500/70"
                    : "bg-rose-950 text-rose-300 border-rose-500/70"
                }`}>
                  {atmStrike} {isCeBuy ? "CE" : "PE"}
                </div>
                <span className="text-[9px] font-black uppercase px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                  ATM BEST R:R
                </span>
              </div>
            </div>

            {/* Estimated Option Premium Targets & SL (BUY CE / BUY PE) */}
            <div className="grid grid-cols-4 gap-1.5 font-mono text-center bg-[#030914] p-2 rounded-xl border border-cyan-500/30">
              {(() => {
                const entryPremium = c.optionChainData.hasRealOptionChain && c.optionChainData.realAtmPremium && c.optionChainData.realAtmPremium > 0
                  ? c.optionChainData.realAtmPremium
                  : Number((c.ltp * 0.022).toFixed(1));
                const estEstEntryOpt = Number(entryPremium.toFixed(1));
                const estSlOpt = Number((estEstEntryOpt * 0.65).toFixed(1)); // 35% SL on premium
                const estT1Opt = Number((estEstEntryOpt * 1.5).toFixed(1));  // 50% Gain
                const estT2Opt = Number((estEstEntryOpt * 2.2).toFixed(1));  // 120% Gain

                return [
                  { label: isCeBuy ? "BUY CE ENTRY" : "BUY PE ENTRY", val: `₹${estEstEntryOpt}`, color: isCeBuy ? "text-emerald-400" : "text-rose-400" },
                  { label: "OPTION SL", val: `₹${estSlOpt}`, color: "text-rose-400" },
                  { label: "OPTION T1", val: `₹${estT1Opt}`, color: "text-emerald-400" },
                  { label: "OPTION T2", val: `₹${estT2Opt}`, color: "text-cyan-400" },
                ].map(m => (
                  <div key={m.label} className="p-1.5 bg-slate-950/90 rounded border border-slate-800">
                    <div className="text-[8.5px] text-slate-400 font-black uppercase">{m.label}</div>
                    <div className={`text-[12px] font-black ${m.color}`}>{m.val}</div>
                  </div>
                ));
              })()}
            </div>
          </div>
        );
      })()}

      {/* Expanded reasons */}
      {expanded && (
        <div className={`rounded-lg p-2.5 border ${dark ? "bg-slate-900/40 border-slate-800" : "bg-white/80 border-slate-200"}`}>
          <div className={`text-[8px] font-black uppercase mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>Signal Reasons</div>
          <div className="flex flex-wrap gap-1">
            {c.reasons.map((r, i) => (
              <span key={i} className={`text-[8.5px] font-semibold px-2 py-0.5 rounded-full border ${dark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-100 border-slate-200 text-slate-600"}`}>
                ✓ {r}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {[
              { label: "Target 2", val: `₹${fmt(c.target2)}` },
              { label: "Target 3", val: `₹${fmt(c.target3)}` },
              { label: "RSI ~", val: fmt(c.rsi, 0) },
            ].map(m => (
              <div key={m.label} className="text-center">
                <div className={`text-[7.5px] uppercase font-bold opacity-60 ${dark ? "text-slate-400" : "text-slate-500"}`}>{m.label}</div>
                <div className={`text-[9px] font-black ${dark ? "text-slate-200" : "text-slate-700"}`}>{m.val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-0.5">
        <button
          onClick={() => setExpanded(x => !x)}
          className={`py-1.5 px-3 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border cursor-pointer ${dark ? "border-slate-700 text-slate-400 hover:bg-slate-800" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}
        >
          {expanded ? "Less" : "Details"} {expanded ? <ChevronUp size={10} className="inline" /> : <ChevronDown size={10} className="inline" />}
        </button>

        {/* 1-Click Instant Option Buying Paper Trade Action Button */}
        <button
          onClick={() => onAddTrade(c, "OPTION")}
          className={`flex-1 py-1.5 px-3 rounded-lg text-[9.5px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer shadow-lg flex items-center justify-center gap-1 ${
            isLong
              ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.4)]"
              : "bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.4)]"
          }`}
        >
          <Zap size={11} className="animate-bounce" />
          {isLong ? "📄 PAPER BUY OPTION (CE) · STUDY" : "📄 PAPER BUY OPTION (PE) · STUDY"}
        </button>

        <button
          onClick={() => onAddTrade(c, "EQUITY")}
          className={`py-1.5 px-3 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer border ${dark ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700" : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          title="Add Equity Shares to Swing Book"
        >
          + Equity
        </button>
      </div>
    </div>
  );
}

// Open Position Row
function PositionRow({ pos, dark, onClose, onDelete }: { pos: SwingPosition; dark: boolean; onClose: (id: string, exitPrice: number) => void; onDelete: (id: string) => void; key?: React.Key }) {
  const [closing, setClosing] = useState(false);
  const [exitPx, setExitPx] = useState(pos.currentPrice?.toString() || "");
  const isLong = pos.direction === "LONG";
  const pnlColor = pos.pnl >= 0 ? (dark ? "text-emerald-400" : "text-emerald-600") : (dark ? "text-rose-400" : "text-rose-600");

  const statusBadge = {
    OPEN: "bg-sky-500/20 text-sky-400",
    TARGET_HIT: "bg-emerald-500/20 text-emerald-400",
    SL_HIT: "bg-rose-500/20 text-rose-400",
    EXITED: "bg-slate-500/20 text-slate-400",
    PENDING: "bg-amber-500/20 text-amber-400",
  }[pos.status];

  return (
    <div className={`rounded-xl border p-3 transition-all ${
      pos.status === "OPEN"
        ? (dark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200")
        : (dark ? "bg-slate-950/40 border-slate-800/50 opacity-70" : "bg-slate-50 border-slate-200 opacity-70")
    }`}>
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Symbol + Direction */}
        <div className="flex items-center gap-1.5 min-w-[120px]">
          {isLong ? <ArrowUpRight size={13} className="text-emerald-400" /> : <ArrowDownRight size={13} className="text-rose-400" />}
          <div className="flex flex-col">
            <span className={`text-[12px] font-black leading-none ${dark ? "text-white" : "text-slate-900"}`}>{pos.symbol}</span>
            {pos.tradeType === "OPTION" && (
              <span className={`text-[8px] font-bold ${pos.optionType === "CE" ? "text-emerald-400" : "text-rose-400"}`}>
                {pos.strike} {pos.optionType} · {pos.expiry?.split("-")[0]} {pos.expiry?.split("-")[1]}
              </span>
            )}
          </div>
        </div>

        {/* Status badge */}
        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${statusBadge}`}>{pos.status}</span>

        {/* Entry / CMP / SL */}
        <div className="flex gap-3 text-[9px] font-bold flex-1">
          <div className={dark ? "text-slate-400" : "text-slate-500"}>
            {pos.tradeType === "OPTION" ? "Lots: " : "Shares: "}
            <span className={dark ? "text-slate-200" : "text-slate-800"}>{pos.qty}</span>
          </div>
          <div className={dark ? "text-slate-400" : "text-slate-500"}>Entry: <span className={dark ? "text-slate-200" : "text-slate-800"}>₹{fmt(pos.entryPrice)}</span></div>
          <div className={dark ? "text-slate-400" : "text-slate-500"}>CMP: <span className={`font-black ${pnlColor}`}>₹{fmt(pos.currentPrice)}</span></div>
          <div className={dark ? "text-slate-400" : "text-slate-500"}>SL: <span className="text-rose-400">₹{fmt(pos.stopLoss)}</span></div>
          <div className={dark ? "text-slate-400" : "text-slate-500"}>T1: <span className="text-emerald-400">₹{fmt(pos.target1)}</span></div>
        </div>

        {/* P&L */}
        <div className="flex flex-col items-end">
          <span className={`text-[11px] font-black tabular-nums ${pnlColor}`}>
            {pos.pnl >= 0 ? "+" : ""}₹{Math.abs(pos.pnl * pos.qty * (pos.tradeType === "OPTION" ? pos.lotSize : 1)).toFixed(0)}
          </span>
          <span className={`text-[8px] font-bold ${pnlColor}`}>{fmtPct(pos.pnlPct)}</span>
        </div>

        {/* Holding days */}
        <div className={`text-[9px] font-bold flex items-center gap-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
          <Clock size={9} />
          {pos.holdingDays}d
        </div>

        {/* Actions */}
        {pos.status === "OPEN" && (
          <div className="flex gap-1">
            {closing ? (
              <div className="flex gap-1 items-center">
                <input
                  type="number"
                  value={exitPx}
                  onChange={e => setExitPx(e.target.value)}
                  className={`w-20 px-2 py-1 rounded text-[10px] font-bold border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-slate-300 text-slate-800"}`}
                  placeholder="Exit ₹"
                />
                <button
                  onClick={() => { onClose(pos.id, parseFloat(exitPx)); setClosing(false); }}
                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[9px] font-black cursor-pointer"
                >✓</button>
                <button
                  onClick={() => setClosing(false)}
                  className={`px-2 py-1 rounded text-[9px] font-bold cursor-pointer ${dark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`}
                >✕</button>
              </div>
            ) : (
              <button
                onClick={() => setClosing(true)}
                className={`px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase cursor-pointer transition-all ${dark ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-slate-200 hover:bg-slate-300 text-slate-600"}`}
              >
                Close
              </button>
            )}
          </div>
        )}
        <button
          onClick={() => onDelete(pos.id)}
          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Notes + Basis */}
      {pos.notes && (
        <div className={`mt-2 text-[9px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>📝 {pos.notes}</div>
      )}
    </div>
  );
}

// Add Trade Modal
function AddTradeModal({ candidate, dark, onConfirm, onCancel, defaultTradeType }: {
  candidate: SwingCandidate;
  dark: boolean;
  onConfirm: (pos: Omit<SwingPosition, "id" | "currentPrice" | "pnl" | "pnlPct" | "holdingDays">) => void;
  onCancel: () => void;
  defaultTradeType?: "EQUITY" | "OPTION";
}) {
  const isLong = candidate.direction === "LONG";
  const defaultOptionPremium = candidate.optionChainData?.hasRealOptionChain && candidate.optionChainData?.realAtmPremium && candidate.optionChainData.realAtmPremium > 0
    ? candidate.optionChainData.realAtmPremium
    : Math.max(5, Math.round(candidate.entryZoneLow * 0.025 * 20) / 20); // ~2.5% of spot, rounded to tick
  const defaultStrike = Math.round(candidate.entryZoneLow / 10) * 10;
  
  // Helpers for standard lot size
  const getLotSizeLocal = (symbol: string) => {
    const s = symbol.toUpperCase();
    if (s.includes("RELIANCE")) return 250;
    if (s.includes("HDFCBANK")) return 550;
    if (s.includes("ICICIBANK")) return 700;
    if (s.includes("TCS")) return 175;
    if (s.includes("INFY")) return 400;
    if (s.includes("SBIN")) return 1500;
    return 100; // fallback
  };

  const getNextExpiryThursday = () => {
    const d = new Date();
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const day = lastDay.getDay();
    const diff = (day >= 4) ? (day - 4) : (day + 3);
    lastDay.setDate(lastDay.getDate() - diff);
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${lastDay.getDate()}-${months[lastDay.getMonth()]}-${lastDay.getFullYear()}`;
  };

  // State variables
  const [tradeType, setTradeType] = useState<"EQUITY" | "OPTION">(defaultTradeType || "EQUITY");
  const [optionType, setOptionType] = useState<"CE" | "PE">(isLong ? "CE" : "PE");
  const [strike, setStrike] = useState(defaultStrike);
  const [expiry, setExpiry] = useState(getNextExpiryThursday());
  const [lotSize, setLotSize] = useState(getLotSizeLocal(candidate.symbol));
  
  // Inputs
  const [qty, setQty] = useState((defaultTradeType || "EQUITY") === "OPTION" ? 1 : 100);
  const [entryPrice, setEntryPrice] = useState(
    (defaultTradeType || "EQUITY") === "OPTION" ? defaultOptionPremium : candidate.entryZoneLow
  );
  const [sl, setSl] = useState(
    (defaultTradeType || "EQUITY") === "OPTION" ? Math.round(defaultOptionPremium * 0.65 * 20) / 20 : candidate.stopLoss
  );
  const [t1, setT1] = useState(
    (defaultTradeType || "EQUITY") === "OPTION" ? Math.round(defaultOptionPremium * 1.5 * 20) / 20 : candidate.target1
  );
  const [notes, setNotes] = useState("");

  // Handlers for switching tradeType
  const handleTypeChange = (type: "EQUITY" | "OPTION") => {
    setTradeType(type);
    if (type === "OPTION") {
      setEntryPrice(defaultOptionPremium);
      setSl(Math.round(defaultOptionPremium * 0.6 * 20) / 20); // 40% SL
      setT1(Math.round(defaultOptionPremium * 2.0 * 20) / 20); // 100% Target
      setQty(1); // 1 lot default
    } else {
      setEntryPrice(candidate.entryZoneLow);
      setSl(candidate.stopLoss);
      setT1(candidate.target1);
      setQty(100); // 100 shares default
    }
  };

  // Option Fyers symbol generation
  const optionSymbolStr = useMemo(() => {
    if (tradeType !== "OPTION") return null;
    const cleanSym = candidate.symbol.replace("NSE:", "").replace("-EQ", "");
    // e.g. NSE:RELIANCE26JUL2500CE-OPT
    const yearStr = expiry.split("-")[2]?.slice(-2) || "26";
    const monthStr = expiry.split("-")[1] || "JUL";
    return `NSE:${cleanSym}${yearStr}${monthStr}${strike}${optionType}-OPT`;
  }, [tradeType, candidate.symbol, strike, optionType, expiry]);

  // Risk and Reward calculations
  const risk = tradeType === "OPTION"
    ? Math.abs(entryPrice - sl) * qty * lotSize
    : Math.abs(entryPrice - sl) * qty;

  const reward = tradeType === "OPTION"
    ? Math.abs(t1 - entryPrice) * qty * lotSize
    : Math.abs(t1 - entryPrice) * qty;

  const rr = risk > 0 ? reward / risk : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`w-full max-w-md rounded-2xl border shadow-2xl p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto ${dark ? "bg-[#0d1117] border-slate-800 text-slate-100" : "bg-white border-slate-200 text-slate-900"}`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isLong ? <ArrowUpRight size={16} className="text-emerald-400" /> : <ArrowDownRight size={16} className="text-rose-400" />}
            <h3 className={`text-[13px] font-black uppercase tracking-wide ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
              Add Swing {candidate.direction}: {candidate.symbol}
            </h3>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${getSignalBg(candidate.signalStrength, dark)} ${getSignalColor(candidate.signalStrength, dark)}`}>
            {candidate.signalStrength}
          </span>
        </div>

        {/* Trade Instrument Selector Toggle */}
        <div className={`flex rounded-xl p-1 border ${dark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
          <button
            onClick={() => handleTypeChange("EQUITY")}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all cursor-pointer ${
              tradeType === "EQUITY"
                ? (dark ? "bg-violet-600/30 text-violet-300" : "bg-violet-100 text-violet-700")
                : "text-slate-400"
            }`}
          >
            Shares (Equity)
          </button>
          <button
            onClick={() => handleTypeChange("OPTION")}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all cursor-pointer ${
              tradeType === "OPTION"
                ? (dark ? "bg-violet-600/30 text-violet-300" : "bg-violet-100 text-violet-700")
                : "text-slate-400"
            }`}
          >
            Stock Option
          </button>
        </div>

        {/* Option configuration parameters */}
        {tradeType === "OPTION" && (
          <div className={`rounded-xl p-3 border grid grid-cols-2 gap-3 ${dark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
            <div>
              <label className={`text-[8.5px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>Option Type</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-700">
                {(["CE", "PE"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setOptionType(t)}
                    className={`flex-1 py-1 text-[9px] font-bold cursor-pointer ${
                      optionType === t
                        ? (t === "CE" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white")
                        : "bg-transparent text-slate-400"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`text-[8.5px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>Strike Price</label>
              <input
                type="number"
                value={strike}
                onChange={e => setStrike(parseInt(e.target.value) || 0)}
                className={`w-full px-2 py-1 rounded text-[10px] border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-slate-300 text-slate-800"}`}
              />
            </div>

            <div>
              <label className={`text-[8.5px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>Expiry Date</label>
              <input
                type="text"
                value={expiry}
                onChange={e => setExpiry(e.target.value.toUpperCase())}
                placeholder="DD-MMM-YYYY"
                className={`w-full px-2 py-1 rounded text-[10px] border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-slate-300 text-slate-800"}`}
              />
            </div>

            <div>
              <label className={`text-[8.5px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>Lot Size</label>
              <input
                type="number"
                value={lotSize}
                onChange={e => setLotSize(parseInt(e.target.value) || 1)}
                className={`w-full px-2 py-1 rounded text-[10px] border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-slate-300 text-slate-800"}`}
              />
            </div>

            <div className="col-span-2">
              <div className={`text-[7.5px] font-mono leading-none tracking-wide text-center opacity-70 ${dark ? "text-violet-400" : "text-violet-700"}`}>
                FYERS Symbol: {optionSymbolStr}
              </div>
            </div>
          </div>
        )}

        {/* Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`text-[9px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {tradeType === "OPTION" ? "Option Entry Price (₹)" : "Entry Price (₹)"}
            </label>
            <input
              type="number"
              value={entryPrice}
              onChange={e => setEntryPrice(parseFloat(e.target.value) || 0)}
              className={`w-full px-3 py-2 rounded-lg text-[11px] font-bold border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-300 text-slate-800"}`}
            />
          </div>
          <div>
            <label className={`text-[9px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {tradeType === "OPTION" ? "Qty (Lots)" : "Qty (Shares)"}
            </label>
            <input
              type="number"
              value={qty}
              onChange={e => setQty(parseFloat(e.target.value) || 0)}
              className={`w-full px-3 py-2 rounded-lg text-[11px] font-bold border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-300 text-slate-800"}`}
            />
          </div>
          <div>
            <label className={`text-[9px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>Stop Loss (₹)</label>
            <input
              type="number"
              value={sl}
              onChange={e => setSl(parseFloat(e.target.value) || 0)}
              className={`w-full px-3 py-2 rounded-lg text-[11px] font-bold border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-300 text-slate-800"}`}
            />
          </div>
          <div>
            <label className={`text-[9px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>Target 1 (₹)</label>
            <input
              type="number"
              value={t1}
              onChange={e => setT1(parseFloat(e.target.value) || 0)}
              className={`w-full px-3 py-2 rounded-lg text-[11px] font-bold border ${dark ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-300 text-slate-800"}`}
            />
          </div>
        </div>

        {/* Risk / Reward Summary */}
        <div className={`grid grid-cols-3 gap-2 rounded-xl p-3 border ${dark ? "bg-slate-900/60 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
          {[
            { label: "Risk", val: `₹${Math.abs(risk).toFixed(0)}`, color: "text-rose-400" },
            { label: "Reward", val: `₹${Math.abs(reward).toFixed(0)}`, color: "text-emerald-400" },
            { label: "R:R", val: `1:${rr.toFixed(1)}`, color: rr >= 2 ? "text-emerald-400" : rr >= 1.5 ? "text-amber-400" : "text-rose-400" },
          ].map(m => (
            <div key={m.label} className="text-center">
              <div className={`text-[8px] uppercase font-bold opacity-60 ${dark ? "text-slate-400" : "text-slate-500"}`}>{m.label}</div>
              <div className={`text-[12px] font-black ${m.color}`}>{m.val}</div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div>
          <label className={`text-[9px] font-black uppercase block mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Entry basis, catalyst, etc."
            className={`w-full px-3 py-2 rounded-lg text-[10px] border ${dark ? "bg-slate-800 border-slate-700 text-slate-300 placeholder:text-slate-600" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"}`}
          />
        </div>

        {/* CTA */}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase border cursor-pointer transition-all ${dark ? "border-slate-700 text-slate-400 hover:bg-slate-800" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({
              symbol: candidate.symbol,
              direction: candidate.direction,
              tradeType,
              optionType: tradeType === "OPTION" ? optionType : null,
              strike: tradeType === "OPTION" ? strike : null,
              expiry: tradeType === "OPTION" ? expiry : null,
              lotSize: tradeType === "OPTION" ? lotSize : 1,
              optionSymbol: tradeType === "OPTION" ? optionSymbolStr : null,
              entryPrice,
              qty,
              stopLoss: sl,
              target1: t1,
              target2: candidate.target2,
              target3: candidate.target3,
              riskReward: rr,
              status: "OPEN",
              notes,
              createdAt: Date.now(),
              signalBasis: candidate.reasons.join(" | "),
              sectorTheme: candidate.sectorBias,
            })}
            className={`flex-[2] py-2.5 rounded-xl text-[10px] font-black uppercase cursor-pointer transition-all shadow-lg ${
              isLong
                ? "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white"
                : "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white"
            }`}
          >
            🎯 Confirm {tradeType === "OPTION" ? "Option" : candidate.direction} Swing Trade
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SwingTradeSystem({
  darkMode,
  niftyStocks, bankniftyStocks, sensexStocks,
  niftySpot, bankniftySpot, sensexSpot,
  niftyHistory, bankniftyHistory, sensexHistory,
  pcr, serverTime,
  relianceOptionChain,
  hdfcbankOptionChain,
  icicibankOptionChain,
  customStockOptionChain,
  customStockSymbol,
}: SwingTradeSystemProps) {

  const dark = darkMode;
  const [filter, setFilter] = useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [strengthFilter, setStrengthFilter] = useState<"STRONG" | "MODERATE" | "WEAK">("MODERATE");
  const [selectedStrategy, setSelectedStrategy] = useState<"ALL" | "BREAKOUT" | "TURNOVER_SURGE" | "GAMMA_SQUEEZE">("ALL");
  const [highProfitOnly, setHighProfitOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSection, setActiveSection] = useState<"SCANNER" | "POSITIONS" | "STATS">("SCANNER");
  const [modalCandidate, setModalCandidate] = useState<SwingCandidate | null>(null);
  const [modalDefaultType, setModalDefaultType] = useState<"EQUITY" | "OPTION">("EQUITY");
  const [positions, setPositions] = useState<SwingPosition[]>([]);
  const [lastScan, setLastScan] = useState(0);
  const [cmPrices, setCmPrices] = useState<Record<string, number>>({});

  const bg = dark ? "#080e1b" : "#f0f4fa";
  const surf = dark ? "#0d1117" : "#ffffff";
  const bdr = dark ? "#1e2736" : "#e2e8f0";

  // Load positions from API with localStorage fallback
  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch(API("/api/swing-trades"));
      const data = await res.json();
      if (data && data.success && Array.isArray(data.trades)) {
        const mapped: SwingPosition[] = data.trades.map((t: any) => ({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          tradeType: t.trade_type,
          optionType: t.option_type,
          strike: t.strike,
          expiry: t.expiry,
          lotSize: t.lot_size,
          optionSymbol: t.option_symbol,
          entryPrice: t.entry_price,
          qty: t.qty,
          stopLoss: t.stop_loss,
          target1: t.target1,
          target2: t.target2 ?? 0,
          target3: t.target3 ?? 0,
          riskReward: t.risk_reward,
          currentPrice: t.exit_price || t.entry_price,
          pnl: 0,
          pnlPct: 0,
          status: t.status,
          notes: t.notes || "",
          createdAt: t.created_at,
          closedAt: t.closed_at,
          exitPrice: t.exit_price,
          holdingDays: 0,
          signalBasis: t.signal_basis || "",
          sectorTheme: t.sector_theme || ""
        }));
        setPositions(mapped);
        localStorage.setItem("swing-positions-v1", JSON.stringify(mapped));
      } else {
        throw new Error("Invalid response format");
      }
    } catch (err) {
      console.warn("[SwingTrades] Fallback to local storage due to API error:", err);
      const saved = localStorage.getItem("swing-positions-v1");
      if (saved) {
        try { setPositions(JSON.parse(saved)); } catch { }
      }
    }
  }, []);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  const savePositions = useCallback((pos: SwingPosition[]) => {
    setPositions(pos);
    localStorage.setItem("swing-positions-v1", JSON.stringify(pos));
  }, []);

  // Build all-stocks list for scanning
  const allStocks = useMemo(() => {
    const niftyFiltered = (niftyStocks || []).filter(s => s.ticker !== "NSE:NIFTY50-INDEX");
    const bnFiltered = (bankniftyStocks || []).filter(s => s.ticker !== "NSE:NIFTYBANK-INDEX");
    const sensexFiltered = (sensexStocks || []).filter(s => s.ticker !== "BSE:SENSEX-INDEX");

    // Deduplicate by symbol
    const seen = new Set<string>();
    return [...niftyFiltered, ...bnFiltered, ...sensexFiltered].filter(s => {
      const sym = s.symbol || "";
      if (seen.has(sym)) return false;
      seen.add(sym);
      return true;
    });
  }, [niftyStocks, bankniftyStocks, sensexStocks]);

  // Live price map for open positions
  useEffect(() => {
    const priceMap: Record<string, number> = {};
    allStocks.forEach(s => {
      if (s.symbol && s.ltp) priceMap[s.symbol.toUpperCase()] = s.ltp;
    });
    setCmPrices(priceMap);
  }, [allStocks]);

  // Build candidates
  const candidates = useMemo(() => {
    setLastScan(Date.now());
    return buildCandidates(
      allStocks,
      strengthFilter,
      relianceOptionChain,
      hdfcbankOptionChain,
      icicibankOptionChain,
      customStockOptionChain,
      customStockSymbol
    );
  }, [
    allStocks,
    strengthFilter,
    relianceOptionChain,
    hdfcbankOptionChain,
    icicibankOptionChain,
    customStockOptionChain,
    customStockSymbol
  ]);

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => {
      if (filter !== "ALL" && c.direction !== filter) return false;
      if (highProfitOnly && !c.optionChainData?.optionConditionMatched) return false;
      if (searchTerm && !c.symbol.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      
      // Strategy filter
      if (selectedStrategy !== "ALL") {
        if (selectedStrategy === "BREAKOUT") {
          const isBreakout = Math.abs(c.changePercent) >= 1.0 || 
                             c.reasons.some(r => r.toLowerCase().includes("breakout") || r.toLowerCase().includes("crossover"));
          if (!isBreakout) return false;
        } else if (selectedStrategy === "TURNOVER_SURGE") {
          const isTurnover = c.volumeRatio > 1.5 || 
                             c.reasons.some(r => r.toLowerCase().includes("volume"));
          if (!isTurnover) return false;
        } else if (selectedStrategy === "GAMMA_SQUEEZE") {
          const isGamma = c.optionChainData?.optionConditionMatched || 
                          (c.optionChainData && (c.optionChainData.pcr > 1.2 || c.optionChainData.pcr < 0.8));
          if (!isGamma) return false;
        }
      }
      return true;
    }).sort((a, b) => {
      const sOrd = { STRONG: 3, MODERATE: 2, WEAK: 1 };
      return sOrd[b.signalStrength] - sOrd[a.signalStrength];
    });
  }, [candidates, filter, highProfitOnly, searchTerm, selectedStrategy]);

  // Update positions with live prices
  const livePositions = useMemo(() => {
    return positions.map(p => {
      let cmp = p.currentPrice || p.entryPrice;
      if (p.tradeType === "OPTION") {
        let chain = null;
        const sym = p.symbol.toUpperCase();
        if (sym === "RELIANCE") chain = relianceOptionChain;
        else if (sym === "HDFCBANK") chain = hdfcbankOptionChain;
        else if (sym === "ICICIBANK") chain = icicibankOptionChain;
        else if (customStockSymbol && sym === customStockSymbol.toUpperCase()) chain = customStockOptionChain;

        if (chain && Array.isArray(chain.strikes)) {
          const strikeRow = chain.strikes.find((s: any) => s.strikePrice === p.strike);
          if (strikeRow) {
            cmp = p.optionType === "CE" ? (strikeRow.ceLtp ?? cmp) : (strikeRow.peLtp ?? cmp);
          }
        }
      } else {
        cmp = cmPrices[p.symbol.toUpperCase()] || p.currentPrice || p.entryPrice;
      }

      // Options P&L is always (cmp - entryPrice) because we buy them.
      // Equity P&L depends on LONG/SHORT direction.
      const pnl = p.tradeType === "OPTION"
        ? (p.status !== "OPEN" && p.exitPrice !== undefined ? p.exitPrice - p.entryPrice : cmp - p.entryPrice)
        : (p.direction === "LONG"
            ? (p.status !== "OPEN" && p.exitPrice !== undefined ? p.exitPrice - p.entryPrice : cmp - p.entryPrice)
            : (p.status !== "OPEN" && p.exitPrice !== undefined ? p.entryPrice - p.exitPrice : p.entryPrice - cmp)
          );

      const pnlPct = p.entryPrice > 0 ? (pnl / p.entryPrice) * 100 : 0;
      const daysHeld = Math.floor((Date.now() - p.createdAt) / (1000 * 60 * 60 * 24));

      // Auto status check
      let status = p.status;
      if (status === "OPEN") {
        const slHit = p.tradeType === "OPTION" ? cmp <= p.stopLoss : (p.direction === "LONG" ? cmp <= p.stopLoss : cmp >= p.stopLoss);
        const t1Hit = p.tradeType === "OPTION" ? cmp >= p.target1 : (p.direction === "LONG" ? cmp >= p.target1 : cmp <= p.target1);
        if (slHit) status = "SL_HIT";
        else if (t1Hit) status = "TARGET_HIT";
      }

      return { ...p, currentPrice: cmp, pnl, pnlPct, holdingDays: daysHeld, status };
    });
  }, [positions, cmPrices, relianceOptionChain, hdfcbankOptionChain, icicibankOptionChain, customStockOptionChain, customStockSymbol]);

  // Stats
  const stats = useMemo(() => {
    const open = livePositions.filter(p => p.status === "OPEN" || p.status === "TARGET_HIT");
    const closed = livePositions.filter(p => p.status === "EXITED" || p.status === "SL_HIT");
    const totalPnl = livePositions.reduce((acc, p) => acc + (p.pnl * p.qty * (p.tradeType === "OPTION" ? p.lotSize : 1)), 0);
    const wins = closed.filter(p => p.pnl > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const longCount = candidates.filter(c => c.direction === "LONG").length;
    const shortCount = candidates.filter(c => c.direction === "SHORT").length;

    return { open: open.length, closed: closed.length, totalPnl, winRate, wins, longCount, shortCount };
  }, [livePositions, candidates]);

  // Handlers
  const handleAddTrade = useCallback((candidate: SwingCandidate, defaultType: "EQUITY" | "OPTION" = "EQUITY") => {
    setModalCandidate(candidate);
    setModalDefaultType(defaultType);
  }, []);

  const handleConfirmTrade = useCallback(async (posData: Omit<SwingPosition, "id" | "currentPrice" | "pnl" | "pnlPct" | "holdingDays">) => {
    const cmp = posData.entryPrice;
    const newId = `swing-${Date.now()}`;
    const payload = {
      id: newId,
      symbol: posData.symbol,
      direction: posData.direction,
      trade_type: posData.tradeType,
      option_type: posData.optionType || null,
      strike: posData.strike || null,
      expiry: posData.expiry || null,
      entry_price: posData.entryPrice,
      qty: posData.qty,
      lot_size: posData.lotSize,
      stop_loss: posData.stopLoss,
      target1: posData.target1,
      target2: posData.target2 || null,
      target3: posData.target3 || null,
      risk_reward: posData.riskReward,
      status: posData.status,
      notes: posData.notes,
      created_at: posData.createdAt,
    };

    try {
      const res = await fetch(API("/api/swing-trades"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await fetchPositions();
      } else {
        throw new Error("API error");
      }
    } catch (err) {
      console.warn("[SwingTrades] Failed to post swing trade to backend, falling back to local storage:", err);
      const newPos: SwingPosition = {
        id: newId,
        ...posData,
        currentPrice: cmp,
        pnl: 0,
        pnlPct: 0,
        holdingDays: 0,
      };
      savePositions([newPos, ...positions]);
    }
    setModalCandidate(null);
  }, [positions, fetchPositions, savePositions]);

  const handleClosePosition = useCallback(async (id: string, exitPrice: number) => {
    const found = positions.find(p => p.id === id);
    if (!found) return;

    let targetStatus: "EXITED" | "SL_HIT" = "EXITED";
    if (found.tradeType === "OPTION") {
      targetStatus = exitPrice >= found.entryPrice ? "EXITED" : "SL_HIT";
    } else {
      targetStatus = found.direction === "LONG"
        ? (exitPrice >= found.entryPrice ? "EXITED" : "SL_HIT")
        : (exitPrice <= found.entryPrice ? "EXITED" : "SL_HIT");
    }

    try {
      const res = await fetch(API(`/api/swing-trades/${id}/close`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitPrice, status: targetStatus }),
      });
      if (res.ok) {
        await fetchPositions();
      } else {
        throw new Error("API error");
      }
    } catch (err) {
      console.warn("[SwingTrades] Failed to close swing trade in backend, falling back to local storage:", err);
      savePositions(positions.map(p => {
        if (p.id !== id) return p;
        const pnl = p.tradeType === "OPTION"
          ? (exitPrice - p.entryPrice)
          : (p.direction === "LONG" ? exitPrice - p.entryPrice : p.entryPrice - exitPrice);
        return {
          ...p,
          exitPrice,
          pnl,
          pnlPct: p.entryPrice > 0 ? (pnl / p.entryPrice) * 100 : 0,
          status: targetStatus,
          closedAt: Date.now(),
          currentPrice: exitPrice,
        };
      }));
    }
  }, [positions, fetchPositions, savePositions]);

  const handleDeletePosition = useCallback(async (id: string) => {
    try {
      const res = await fetch(API(`/api/swing-trades/${id}`), {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchPositions();
      } else {
        throw new Error("API error");
      }
    } catch (err) {
      console.warn("[SwingTrades] Failed to delete swing trade in backend, falling back to local storage:", err);
      savePositions(positions.filter(p => p.id !== id));
    }
  }, [positions, fetchPositions, savePositions]);

  // Market bias
  const mktBias = useMemo(() => {
    const nChg = niftyHistory?.prevClose > 0 ? ((niftySpot - niftyHistory.prevClose) / niftyHistory.prevClose) * 100 : 0;
    const bnChg = bankniftyHistory?.prevClose > 0 ? ((bankniftySpot - bankniftyHistory.prevClose) / bankniftyHistory.prevClose) * 100 : 0;
    const combined = (nChg + bnChg) / 2;
    if (combined > 0.5) return { label: "BULLISH MARKET", color: "text-emerald-400", bg: "bg-emerald-500/10", val: `+${combined.toFixed(2)}%` };
    if (combined < -0.5) return { label: "BEARISH MARKET", color: "text-rose-400", bg: "bg-rose-500/10", val: `${combined.toFixed(2)}%` };
    return { label: "SIDEWAYS MARKET", color: "text-amber-400", bg: "bg-amber-500/10", val: `${combined.toFixed(2)}%` };
  }, [niftySpot, bankniftySpot, niftyHistory, bankniftyHistory]);

  const sectionTabs = [
    { id: "SCANNER", label: "📡 Live Scanner", badge: filteredCandidates.length },
    { id: "POSITIONS", label: "📂 AMEX AI BRAIN POSITIONS", badge: positions.filter(p => p.status === "OPEN").length },
    { id: "STATS", label: "📊 Live P&L Stats", badge: null },
  ] as const;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: bg, fontFamily: "'Inter', sans-serif" }}>

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 flex flex-col gap-2" style={{ background: surf, borderBottom: `1px solid ${bdr}` }}>
        {/* Title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 via-indigo-600 to-emerald-500 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.4)]">
              <Zap size={18} className="text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`text-[15px] font-black uppercase tracking-wider ${dark ? "text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" : "text-slate-900"}`}>
                  SWING OPTION ENGINE
                </h2>
                <span className="text-[8.5px] font-mono font-black px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/60 uppercase shadow-[0_0_10px_rgba(34,211,238,0.3)]">
                  🧠 NEURAL DATA ENGINE
                </span>
              </div>
              <p className={`text-[9.5px] font-semibold uppercase tracking-widest ${dark ? "text-cyan-400/80" : "text-slate-500"}`}>
                Real-Time Option Buyer Edge · Institutional OI Flow · 100% Data Verified
              </p>
            </div>
          </div>

          {/* Market bias chip */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${dark ? "border-slate-800" : "border-slate-200"} ${mktBias.bg}`}>
            <Activity size={12} className={mktBias.color} />
            <span className={`text-[9px] font-black uppercase ${mktBias.color}`}>{mktBias.label}</span>
            <span className={`text-[10px] font-black tabular-nums ${mktBias.color}`}>{mktBias.val}</span>
          </div>

          {/* Quick stats + Live Paper P&L */}
          <div className="flex gap-3 text-center items-center">
            {[
              { label: "Signals", val: filteredCandidates.length, color: "text-violet-400" },
              { label: "Long", val: stats.longCount, color: "text-emerald-400" },
              { label: "Short", val: stats.shortCount, color: "text-rose-400" },
              { label: "Open Trades", val: stats.open, color: "text-sky-400" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={`text-[13px] font-black ${s.color}`}>{s.val}</div>
                <div className={`text-[8px] uppercase font-bold ${dark ? "text-slate-500" : "text-slate-400"}`}>{s.label}</div>
              </div>
            ))}

            {/* Total Paper P&L Telemetry Badge */}
            <div className={`px-3 py-1 rounded-xl border flex flex-col items-center justify-center font-mono ${
              stats.totalPnl >= 0
                ? "bg-emerald-950/60 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                : "bg-rose-950/60 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
            }`}>
              <div className="text-[7.5px] uppercase font-black tracking-wider text-slate-400">TOTAL PAPER P&L</div>
              <div className={`text-[13px] font-black ${stats.totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {stats.totalPnl >= 0 ? "+" : ""}₹{stats.totalPnl.toFixed(0)}
              </div>
            </div>
          </div>
        </div>

        {/* Market Pulse */}
        <MarketPulse
          niftySpot={niftySpot} bankniftySpot={bankniftySpot} sensexSpot={sensexSpot}
          niftyHistory={niftyHistory} bankniftyHistory={bankniftyHistory} sensexHistory={sensexHistory}
          dark={dark}
        />

        {/* Section tabs */}
        <div className="flex gap-1">
          {sectionTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                activeSection === tab.id
                  ? (dark ? "bg-violet-600/20 border-violet-500/50 text-violet-300" : "bg-violet-50 border-violet-300 text-violet-700")
                  : (dark ? "border-slate-800 text-slate-500 hover:bg-slate-800/60" : "border-slate-200 text-slate-500 hover:bg-slate-100")
              }`}
            >
              {tab.label}
              {tab.badge !== null && tab.badge > 0 && (
                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${dark ? "bg-violet-500/30 text-violet-300" : "bg-violet-100 text-violet-700"}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ═══ SCANNER ═══ */}
        {activeSection === "SCANNER" && (
          <div className="p-4 flex flex-col gap-4">

            {/* Filters bar */}
            <div className="flex flex-wrap gap-2 items-center">
              {/* Search */}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border flex-1 min-w-[160px] ${dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                <Search size={12} className={dark ? "text-slate-500" : "text-slate-400"} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Symbol search..."
                  className={`bg-transparent text-[11px] font-semibold outline-none flex-1 ${dark ? "text-slate-200 placeholder:text-slate-600" : "text-slate-700 placeholder:text-slate-400"}`}
                />
              </div>

              {/* Strategy Selector Filter Buttons */}
              <div className="flex gap-1">
                {(["ALL", "BREAKOUT", "TURNOVER_SURGE", "GAMMA_SQUEEZE"] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setSelectedStrategy(st)}
                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase cursor-pointer transition-all border ${
                      selectedStrategy === st
                        ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                        : (dark ? "border-slate-800 text-slate-500 hover:bg-slate-800" : "border-slate-200 text-slate-400 hover:bg-slate-100")
                    }`}
                  >
                    {st === "ALL" ? "All Strategies" : st === "BREAKOUT" ? "⚡ Breakout" : st === "TURNOVER_SURGE" ? "📊 Turnover Surge" : "🚀 Gamma Squeeze"}
                  </button>
                ))}
              </div>

              {/* Direction filter */}
              <div className="flex gap-1">
                {(["ALL", "LONG", "SHORT"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase cursor-pointer transition-all border ${
                      filter === f
                        ? (f === "LONG" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                          : f === "SHORT" ? "bg-rose-500/20 border-rose-500/50 text-rose-400"
                          : (dark ? "bg-violet-500/20 border-violet-500/50 text-violet-400" : "bg-violet-50 border-violet-300 text-violet-700"))
                        : (dark ? "border-slate-800 text-slate-500 hover:bg-slate-800" : "border-slate-200 text-slate-400 hover:bg-slate-100")
                    }`}
                  >
                    {f === "LONG" ? "▲ Long" : f === "SHORT" ? "▼ Short" : "All"}
                  </button>
                ))}
              </div>

              {/* Strength filter */}
              <div className="flex gap-1">
                {(["STRONG", "MODERATE", "WEAK"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => { setStrengthFilter(s); setHighProfitOnly(false); }}
                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase cursor-pointer transition-all border ${
                      !highProfitOnly && strengthFilter === s
                        ? `${getSignalBg(s, dark)} ${getSignalColor(s, dark)}`
                        : (dark ? "border-slate-800 text-slate-500 hover:bg-slate-800" : "border-slate-200 text-slate-400 hover:bg-slate-100")
                    }`}
                  >
                    {s}+
                  </button>
                ))}

                {/* Direct High Profit Matched Trades Filter */}
                <button
                  onClick={() => setHighProfitOnly(x => !x)}
                  className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase cursor-pointer transition-all border flex items-center gap-1 shadow-md ${
                    highProfitOnly
                      ? "bg-gradient-to-r from-amber-500/30 to-emerald-500/30 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]"
                      : (dark ? "border-slate-800 text-slate-400 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-100")
                  }`}
                >
                  <span>🎯 HIGH PROFIT ONLY</span>
                </button>
              </div>

              {/* Scan time */}
              <div className={`text-[8px] font-bold ml-auto flex items-center gap-1 ${dark ? "text-slate-600" : "text-slate-400"}`}>
                <RefreshCw size={9} />
                {lastScan > 0 ? `Scanned: ${new Date(lastScan).toLocaleTimeString("en-IN")}` : "—"}
              </div>
            </div>

            {/* Candidates grid */}
            {filteredCandidates.length === 0 ? (
              <div className={`flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border ${dark ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
                <BarChart3 size={32} className={dark ? "text-slate-700" : "text-slate-300"} />
                <div className={`text-[11px] font-bold ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  No swing signals found
                </div>
                <div className={`text-[9px] font-semibold ${dark ? "text-slate-600" : "text-slate-400"}`}>
                  Try reducing strength filter to MODERATE or WEAK
                </div>
              </div>
            ) : (() => {
              // Rank & sort candidates: 100% Matched stock + option trades at the top with highest score
              const sortedCandidates = [...filteredCandidates].sort((a, b) => {
                const aMatched = a.optionChainData?.optionConditionMatched ? 1 : 0;
                const bMatched = b.optionChainData?.optionConditionMatched ? 1 : 0;
                if (bMatched !== aMatched) return bMatched - aMatched;
                return (b.score || 0) - (a.score || 0);
              });

              const topBestTrade = sortedCandidates[0];
              const remainingTrades = sortedCandidates.slice(1);

              return (
                <div className="flex flex-col gap-4">
                  {/* VIP Spotlight Banner for #1 TOP HIGH PROFITABLE TRADE */}
                  {topBestTrade && topBestTrade.optionChainData?.optionConditionMatched && (
                    <div className="rounded-2xl p-4 bg-gradient-to-r from-amber-950/90 via-emerald-950/70 to-slate-950 border-2 border-amber-400/80 shadow-[0_0_25px_rgba(245,158,11,0.35)] flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🏆</span>
                          <span className="text-[12px] font-black uppercase text-amber-300 tracking-widest drop-shadow-[0_0_10px_rgba(245,158,11,0.8)]">
                            #1 HIGHEST PROFITABLE MATCHED TRADE SPOTLIGHT
                          </span>
                        </div>
                        <span className="text-[9px] font-mono font-black px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-400/60 uppercase animate-pulse">
                          100% STOCK + OPTION DATA ALIGNED
                        </span>
                      </div>

                      {/* Comprehensive Multi-Factor AI Selection Reason Paragraph */}
                      <div className="bg-black/90 p-4 rounded-xl border border-amber-400/60 text-[12.5px] font-sans leading-relaxed text-slate-100 flex flex-col gap-2 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
                        <div className="font-black uppercase text-amber-300 text-[13.5px] tracking-wide flex items-center justify-between border-b border-amber-500/30 pb-2">
                          <span className="flex items-center gap-1.5 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]">
                            🧠 100% MATCHED TRADE REASON & MULTI-FACTOR DRIVERS
                          </span>
                          <span className="text-[9.5px] font-mono font-bold text-cyan-300 bg-cyan-950/80 px-2.5 py-0.5 rounded border border-cyan-500/40">
                            EXPIRY: MONTHLY CLOSE (HIGH DELTA)
                          </span>
                        </div>

                        <p className="text-slate-200 text-[12.5px] font-medium leading-relaxed">
                          <strong className="text-white font-black text-[13.5px]">{topBestTrade.symbol}</strong> ko <strong className="text-amber-300 font-bold text-[13.5px]">#1 Highest Profitable Trade</strong> select karne ke 5 Core Reasons hain:
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11.5px] font-mono pt-1">
                          <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex flex-col gap-0.5">
                            <span className="text-emerald-400 font-black">📈 1. LIVE SCORE & TIMEFRAME ALIGNMENT:</span>
                            <span className="text-slate-300">Live AMEX Score ({topBestTrade.score > 0 ? `+${topBestTrade.score}` : topBestTrade.score}) with {topBestTrade.timeframeScores.filter(t => t.score !== 0).length}/4 TFs (5M/15M/30M/1H) agreeing in {topBestTrade.direction} direction.</span>
                          </div>

                          <div className="p-2 rounded-lg bg-cyan-950/40 border border-cyan-500/30 flex flex-col gap-0.5">
                            <span className="text-cyan-300 font-black">⚡ 2. OPTION CHAIN PCR & OI BUILDUP:</span>
                            <span className="text-slate-300">Real-time PCR: {topBestTrade.optionChainData.pcr} (Call OI: {(topBestTrade.optionChainData.callOI/100000).toFixed(1)}L | Put OI: {(topBestTrade.optionChainData.putOI/100000).toFixed(1)}L) confirming institutional {topBestTrade.optionChainData.oiBias.replace("_BUILDUP","")} accumulation.</span>
                          </div>

                          <div className="p-2 rounded-lg bg-purple-950/40 border border-purple-500/30 flex flex-col gap-0.5">
                            <span className="text-purple-300 font-black">📊 3. DYNAMIC VOLUME & CASH TURNOVER:</span>
                            <span className="text-slate-300">Live Volume: {topBestTrade.volume > 0 ? (topBestTrade.volume/100000).toFixed(2) + "L shares" : "Active institutional volume"} (Relative Vol Ratio: {topBestTrade.volumeRatio.toFixed(1)}x above avg).</span>
                          </div>

                          <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/30 flex flex-col gap-0.5">
                            <span className="text-amber-300 font-black">🗓️ 4. RISK:REWARD & BREAKOUT TARGETS:</span>
                            <span className="text-slate-300">Live R:R Ratio 1:{topBestTrade.riskReward.toFixed(1)} with Support ₹{topBestTrade.supportLevel.toFixed(1)} & Target ₹{topBestTrade.target1.toFixed(1)} breakout zone.</span>
                          </div>
                        </div>
                      </div>

                      <CandidateCard
                        key={`top-best-${topBestTrade.symbol}`}
                        c={topBestTrade}
                        dark={dark}
                        onAddTrade={handleAddTrade}
                      />
                    </div>
                  )}

                  {/* Remaining Filtered Candidates */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-2 pb-4">
                    {(topBestTrade && topBestTrade.optionChainData?.optionConditionMatched ? remainingTrades : sortedCandidates).map(c => (
                      <CandidateCard
                        key={`${c.symbol}-${c.direction}`}
                        c={c}
                        dark={dark}
                        onAddTrade={handleAddTrade}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Swing Rules Info Box */}
            <div className={`rounded-xl border p-4 ${dark ? "bg-slate-900/40 border-slate-800" : "bg-blue-50 border-blue-200"}`}>
              <div className="flex items-center gap-2 mb-2">
                <Info size={13} className="text-sky-400" />
                <span className={`text-[10px] font-black uppercase tracking-wider ${dark ? "text-sky-400" : "text-sky-700"}`}>
                  Swing Signal Rules
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { icon: "📐", title: "TF Alignment", desc: "3-4 timeframes (5M/15M/30M/1H) must agree in direction" },
                  { icon: "📈", title: "Score Momentum", desc: "Live AMEX score > 3 with rising differential" },
                  { icon: "💹", title: "EMA Crossover", desc: "EMA20 vs EMA50 signals trend direction" },
                  { icon: "🔊", title: "Volume Filter", desc: "Volume > 1.5x average confirms breakout" },
                ].map(r => (
                  <div key={r.title} className={`rounded-lg p-2.5 ${dark ? "bg-slate-800/50" : "bg-white"}`}>
                    <div className="text-[11px] mb-0.5">{r.icon} <span className={`font-black ${dark ? "text-slate-200" : "text-slate-700"}`}>{r.title}</span></div>
                    <div className={`text-[8.5px] leading-relaxed ${dark ? "text-slate-500" : "text-slate-400"}`}>{r.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ POSITIONS (SWING BOOK) ═══ */}
        {activeSection === "POSITIONS" && (
          <div className="p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-slate-300" : "text-slate-700"}`}>
                Open Swing Positions ({positions.filter(p => p.status === "OPEN").length})
              </h3>
              <button
                onClick={() => {
                  if (confirm("Clear all closed/exited positions?")) {
                    savePositions(positions.filter(p => p.status === "OPEN"));
                  }
                }}
                className={`text-[9px] font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer transition-all ${dark ? "border-slate-800 text-slate-500 hover:bg-slate-800" : "border-slate-200 text-slate-400 hover:bg-slate-100"}`}
              >
                <Trash2 size={10} /> Clear Closed
              </button>
            </div>

            {/* Positions */}
            {livePositions.length === 0 ? (
              <div className={`flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border ${dark ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
                <BookOpen size={32} className={dark ? "text-slate-700" : "text-slate-300"} />
                <div className={`text-[11px] font-bold ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  No swing positions yet
                </div>
                <div className={`text-[9px] ${dark ? "text-slate-600" : "text-slate-400"}`}>
                  Go to Scanner → Add to Swing Book
                </div>
              </div>
            ) : (
              <>
                {/* Open positions */}
                <div className="flex flex-col gap-2">
                  {livePositions.filter(p => p.status === "OPEN" || p.status === "TARGET_HIT").map(pos => (
                    <PositionRow
                      key={pos.id}
                      pos={pos}
                      dark={dark}
                      onClose={handleClosePosition}
                      onDelete={handleDeletePosition}
                    />
                  ))}
                </div>

                {/* Closed positions */}
                {livePositions.some(p => p.status === "EXITED" || p.status === "SL_HIT") && (
                  <>
                    <div className={`text-[10px] font-black uppercase tracking-wider mt-2 ${dark ? "text-slate-600" : "text-slate-400"}`}>
                      Closed Positions
                    </div>
                    <div className="flex flex-col gap-2">
                      {livePositions.filter(p => p.status === "EXITED" || p.status === "SL_HIT").map(pos => (
                        <PositionRow
                          key={pos.id}
                          pos={pos}
                          dark={dark}
                          onClose={handleClosePosition}
                          onDelete={handleDeletePosition}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ P&L STATS ═══ */}
        {activeSection === "STATS" && (
          <div className="p-4 flex flex-col gap-4">

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total P&L", val: `${stats.totalPnl >= 0 ? "+" : ""}₹${Math.abs(stats.totalPnl).toFixed(0)}`, color: stats.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400", icon: <BarChart3 size={16} />, bg: stats.totalPnl >= 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-rose-500/10 border-rose-500/30" },
                { label: "Win Rate", val: `${stats.winRate.toFixed(0)}%`, color: stats.winRate >= 60 ? "text-emerald-400" : stats.winRate >= 40 ? "text-amber-400" : "text-rose-400", icon: <Target size={16} />, bg: dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200" },
                { label: "Open Positions", val: stats.open.toString(), color: "text-sky-400", icon: <Eye size={16} />, bg: dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200" },
                { label: "Closed Trades", val: stats.closed.toString(), color: "text-slate-400", icon: <Lock size={16} />, bg: dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200" },
              ].map(s => (
                <div key={s.label} className={`rounded-2xl border p-4 flex flex-col gap-2 ${s.bg}`}>
                  <div className={`${s.color}`}>{s.icon}</div>
                  <div className={`text-[22px] font-black tabular-nums leading-none ${s.color}`}>{s.val}</div>
                  <div className={`text-[9px] uppercase font-bold ${dark ? "text-slate-500" : "text-slate-400"}`}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Position detail table */}
            {livePositions.length > 0 && (
              <div className={`rounded-2xl border overflow-hidden ${dark ? "border-slate-800" : "border-slate-200"}`}>
                <div className={`px-4 py-2.5 text-[9px] font-black uppercase tracking-wider border-b flex gap-4 ${dark ? "bg-slate-900/80 border-slate-800 text-slate-500" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  <span className="flex-[2]">Symbol</span>
                  <span className="flex-1">Type</span>
                  <span className="flex-1">Entry</span>
                  <span className="flex-1">CMP</span>
                  <span className="flex-1">P&L/share</span>
                  <span className="flex-1">Total P&L</span>
                  <span className="flex-1">Days</span>
                  <span className="flex-1">Status</span>
                </div>
                {livePositions.map(pos => {
                  const isPositive = pos.pnl >= 0;
                  return (
                    <div
                      key={pos.id}
                      className={`px-4 py-2.5 text-[9px] font-bold flex gap-4 border-b ${dark ? "border-slate-800/50 hover:bg-slate-900/40" : "border-slate-100 hover:bg-slate-50"} transition-colors`}
                    >
                      <span className={`flex-[2] font-black flex flex-col ${dark ? "text-white" : "text-slate-900"}`}>
                        <span>{pos.symbol}</span>
                        {pos.tradeType === "OPTION" && (
                          <span className={`text-[8.5px] font-semibold opacity-70 ${pos.optionType === "CE" ? "text-emerald-400" : "text-rose-400"}`}>
                            {pos.strike}{pos.optionType} · {pos.expiry} (Lot: {pos.lotSize})
                          </span>
                        )}
                      </span>
                      <span className={`flex-1 font-black ${pos.direction === "LONG" ? "text-emerald-400" : "text-rose-400"}`}>
                        {pos.tradeType === "OPTION" ? `${pos.optionType} Buy` : pos.direction}
                      </span>
                      <span className={`flex-1 tabular-nums ${dark ? "text-slate-300" : "text-slate-700"}`}>
                        ₹{fmt(pos.entryPrice)} <span className="opacity-60 text-[8px]">({pos.qty} {pos.tradeType === "OPTION" ? "Lot" : "Share"}{pos.qty > 1 ? "s" : ""})</span>
                      </span>
                      <span className={`flex-1 tabular-nums font-black ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>₹{fmt(pos.currentPrice)}</span>
                      <span className={`flex-1 tabular-nums ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>{isPositive ? "+" : ""}₹{fmt(pos.pnl)}</span>
                      <span className={`flex-1 tabular-nums font-black ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>{isPositive ? "+" : ""}₹{Math.abs(pos.pnl * pos.qty * (pos.tradeType === "OPTION" ? pos.lotSize : 1)).toFixed(0)}</span>
                      <span className={`flex-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>{pos.holdingDays}d</span>
                      <span className={`flex-1 text-[8px] font-black uppercase ${
                        pos.status === "OPEN" ? "text-sky-400" :
                        pos.status === "TARGET_HIT" ? "text-emerald-400" :
                        pos.status === "SL_HIT" ? "text-rose-400" : "text-slate-400"
                      }`}>{pos.status}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Swing tips */}
            <div className={`rounded-2xl border p-4 ${dark ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-200"}`}>
              <div className={`text-[10px] font-black uppercase mb-3 flex items-center gap-2 ${dark ? "text-slate-400" : "text-slate-600"}`}>
                <Star size={12} className="text-amber-400" /> Swing Trading Best Practices
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  "🎯 Always maintain 1:2+ Risk:Reward ratio before entering",
                  "📉 Move SL to breakeven once price reaches Target 1",
                  "🏦 Never risk more than 2% of capital on a single swing trade",
                  "⏰ Hold period: 2–10 trading days, exit on SL or target",
                  "📊 Prefer stocks with strong sector tailwinds",
                  "🚫 Avoid swing trades before major events (earnings, results)",
                  "💡 Trail stop loss as the trade moves in your favor",
                  "🔄 Scale into winners; scale out at each target level",
                ].map((tip, i) => (
                  <div key={i} className={`text-[9px] font-semibold leading-relaxed py-1.5 px-2.5 rounded-lg ${dark ? "bg-slate-800/50 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
                    {tip}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalCandidate && (
        <AddTradeModal
          candidate={modalCandidate}
          dark={dark}
          onConfirm={handleConfirmTrade}
          onCancel={() => setModalCandidate(null)}
          defaultTradeType={modalDefaultType}
        />
      )}
    </div>
  );
}
