/**
 * PositionTradingDashboard.tsx
 * Layer 11 + 12 + 13 UI — Multi-day Position Trading Control Center
 *
 * Sections:
 *   1. Daily Bias Panel (Layer 11) — EMA + Weekly Trend
 *   2. VIX Intelligence — Trade readiness gauge
 *   3. Swing S&R Level Map (Layer 13) — Key price levels
 *   4. Position Trade Calculator — SL/Target auto-calc
 *   5. Active Positions Table (Layer 12) — Live P&L
 *   6. Signal Intelligence — Win rate by VIX/Time zone
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp, TrendingDown, Activity, AlertTriangle,
  CheckCircle, XCircle, Target, Zap, BarChart2,
  Calendar, Clock, DollarSign, Shield, RefreshCw,
  ChevronUp, ChevronDown, Minus, PlusCircle, X
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Instrument = string;

interface DailyBias {
  instrument: Instrument;
  bias: "STRONG_BULL" | "BULL" | "NEUTRAL" | "BEAR" | "STRONG_BEAR";
  positionScore: number;
  ema20: number; ema50: number; ema200: number;
  emaAlignment: "BULLISH" | "BEARISH" | "MIXED";
  weeklyTrend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  higherHighs: boolean; lowerLows: boolean;
  aboveEma20: boolean; aboveEma50: boolean; aboveEma200: boolean;
  currentPrice: number;
  rsi: number;
  macd: { macd: number, signal: number, histogram: number } | null;
  pwh: number;
  pwl: number;
  fiiDiiFlow: "BULLISH" | "BEARISH" | "NEUTRAL";
  reasoning: string;
  lastUpdatedDate: string;
}

interface SwingLevel {
  price: number;
  type: "RESISTANCE" | "SUPPORT";
  strength: "STRONG" | "MODERATE" | "WEAK";
  source: string;
  distancePct: number;
  distancePts: number;
  touchCount: number;
}

interface SwingLevelsResult {
  instrument: Instrument;
  spot: number;
  levels: SwingLevel[];
  nearestResistance: SwingLevel | null;
  nearestSupport: SwingLevel | null;
  proximityWarning: boolean;
  proximityDetail: string;
  weeklyPivot: number; weeklyR1: number; weeklyR2: number;
  weeklyS1: number; weeklyS2: number;
  prevWeekHigh: number; prevWeekLow: number;
  prevMonthHigh: number; prevMonthLow: number;
}

interface PositionEvaluation {
  canTrade: boolean;
  reason: string;
  vixCategory: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  setupQuality: "EXCELLENT" | "GOOD" | "MARGINAL" | "SKIP";
  suggestedLots: number;
}

interface PositionTrade {
  id: string;
  instrument: Instrument;
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  expiry: string;
  optionSymbol: string;
  entryDate: string;
  entryPrice: number;
  lots: number; lotSize: number;
  slPrice: number; target1: number; target2: number;
  currentPrice: number; peakPrice: number; trailSl: number;
  holdDays: number; dailyTheta: number; breakevenDays: number;
  unrealizedPnL: number;
  vixAtEntry: number; dailyBiasAtEntry: string;
  status: "ACTIVE" | "CLOSED_PROFIT" | "CLOSED_LOSS" | "EXPIRED";
  exitPrice?: number; exitDate?: string; realizedPnL?: number;
  exitReason?: string; notes: string;
}

interface PositionTradeSetup {
  instrument: Instrument;
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  expiry: string;
  optionSymbol: string;
  entryPrice: number;
  lots: number; lotSize: number;
  slPrice: number; target1: number; target2: number;
  riskReward: number; dailyTheta: number; breakevenDays: number;
  reasoning: string;
}

interface SignalStats {
  totalSignals: number; wins: number; losses: number;
  winRate: number; recentWinRate: number; confidenceMultiplier: number;
  winRateByTimeZone?: { MORNING: number; MIDDAY: number; AFTERNOON: number };
  winRateByVix?: { LOW: number; NORMAL: number; HIGH: number; EXTREME: number };
  suggestAvoidMorning?: boolean; suggestAvoidHighVix?: boolean;
  bestTimeZone?: string | null; bestVixZone?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BIAS_CONFIG = {
  STRONG_BULL: { color: "#10b981", bg: "rgba(16,185,129,0.12)", label: "🟢 STRONG BULL", glow: "0 0 20px rgba(16,185,129,0.3)" },
  BULL:        { color: "#34d399", bg: "rgba(52,211,153,0.08)",  label: "🟢 BULL",        glow: "0 0 12px rgba(52,211,153,0.2)" },
  NEUTRAL:     { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", label: "⚪ NEUTRAL",     glow: "none" },
  BEAR:        { color: "#f97316", bg: "rgba(249,115,22,0.08)",  label: "🟠 BEAR",        glow: "0 0 12px rgba(249,115,22,0.2)" },
  STRONG_BEAR: { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   label: "🔴 STRONG BEAR", glow: "0 0 20px rgba(239,68,68,0.3)" },
} as const;

const VIX_CONFIG = {
  LOW:     { color: "#10b981", label: "LOW ✅ Cheap Premiums",     pct: 25 },
  NORMAL:  { color: "#3b82f6", label: "NORMAL ✅ Good to Trade",   pct: 50 },
  HIGH:    { color: "#f97316", label: "HIGH ⚠️ Reduce Size",       pct: 75 },
  EXTREME: { color: "#ef4444", label: "EXTREME ❌ Avoid Buying",   pct: 100 },
} as const;

function fmt(n: number, dec = 0) { return n?.toFixed(dec) ?? "—"; }
function fmtPnl(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN")}`;
}

// ── Main Component ─────────────────────────────────────────────────────────────

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

interface Props {
  activePage: Instrument;
  spotPrice: number;
  darkMode: boolean;
  expiryList?: { label: string; value: string }[];
}

const getAtmStrike = (price: number, instrument: Instrument) => {
  if (!price || price <= 0) return 0;
  const interval = instrument === "SENSEX" ? 100 : 50;
  return Math.round(price / interval) * interval;
};

const PositionTradingDashboard: React.FC<Props> = ({ activePage, spotPrice, darkMode, expiryList = [] }) => {
  // State
  const [inst, setInst] = useState<Instrument>(activePage);
  const [dailyBias, setDailyBias] = useState<DailyBias | null>(null);
  const [swingLevels, setSwingLevels] = useState<SwingLevelsResult | null>(null);
  const [evaluation, setEvaluation] = useState<PositionEvaluation | null>(null);
  const [vix, setVix] = useState<number>(0);
  const [trades, setTrades] = useState<PositionTrade[]>([]);
  const [shadowTrades, setShadowTrades] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"ACTIVE" | "JOURNAL">("ACTIVE");
  const [signalStats, setSignalStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Calc form state
  const [calcForm, setCalcForm] = useState({
    direction: "BUY_CE" as "BUY_CE" | "BUY_PE",
    strike: 0,
    expiry: "",
    entryPrice: 0,
    lots: 1,
    daysToExpiry: 7,
  });
  const [calcResult, setCalcResult] = useState<PositionTradeSetup | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [openTradeModal, setOpenTradeModal] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [biasRes, levelsRes, tradesRes, evalRes, statsRes, shadowRes] = await Promise.allSettled([
        fetch(getApiUrl(`/api/daily-bias/${inst}`)).then(r => r.json()),
        fetch(getApiUrl(`/api/swing-levels/${inst}`)).then(r => r.json()),
        fetch(getApiUrl(`/api/position-trades?status=ACTIVE`)).then(r => r.json()),
        fetch(getApiUrl(`/api/position-trades/evaluate`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrument: inst, lots: calcForm.lots }),
        }).then(r => r.json()),
        fetch(getApiUrl(`/api/signal-memory/${inst}`)).then(r => r.json()).catch(() => null),
        fetch(getApiUrl(`/api/te/shadow-trades?status=OPEN`)).then(r => r.json()),
      ]);

      if (biasRes.status === "fulfilled" && biasRes.value.success)
        setDailyBias(biasRes.value.bias);
      if (levelsRes.status === "fulfilled" && levelsRes.value.success)
        setSwingLevels(levelsRes.value.levels);
      if (tradesRes.status === "fulfilled" && tradesRes.value.success)
        setTrades(tradesRes.value.trades.filter((t: PositionTrade) => t.instrument === inst));
      if (evalRes.status === "fulfilled" && evalRes.value.success) {
        setEvaluation(evalRes.value.evaluation);
        setVix(evalRes.value.vix ?? 0);
      }
      if (statsRes.status === "fulfilled" && statsRes.value?.stats)
        setSignalStats(statsRes.value.stats);
      if (shadowRes.status === "fulfilled" && shadowRes.value?.success) {
        setShadowTrades(shadowRes.value.trades.filter((t: any) => {
          try {
            if (t.instrument !== inst) return false;
            const parsed = JSON.parse(t.notes || "{}");
            return parsed.trade_type === "POSITIONAL";
          } catch { return false; }
        }));
      }
    } catch (e) {
      console.error("[PositionDashboard] Fetch error:", e);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, [inst, calcForm.lots]);

  useEffect(() => { fetchAll(); }, [inst]);
  useEffect(() => { setInst(activePage); }, [activePage]);

  // Auto-populate expiry from list
  useEffect(() => {
    if (expiryList && expiryList.length > 0) {
      setCalcForm(f => ({ ...f, expiry: expiryList[0].value }));
    } else {
      setCalcForm(f => ({ ...f, expiry: "" }));
    }
  }, [expiryList]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Calculate setup
  const handleCalcSetup = async () => {
    if (!calcForm.entryPrice || calcForm.entryPrice <= 0) return;
    setCalcLoading(true);
    try {
      const activeSpot = spotPrice || swingLevels?.spot || 0;
      const calculatedStrike = calcForm.strike || getAtmStrike(activeSpot, inst);

      const res = await fetch(getApiUrl("/api/position-trades/calc-setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: inst,
          direction: calcForm.direction,
          strike: calculatedStrike,
          expiry: calcForm.expiry || "Next Week",
          entryPrice: calcForm.entryPrice,
          lots: calcForm.lots,
          daysToExpiry: calcForm.daysToExpiry,
        }),
      });
      const data = await res.json();
      if (data.success) setCalcResult(data.setup);
    } finally {
      setCalcLoading(false);
    }
  };

  // Open position trade
  const handleOpenTrade = async () => {
    if (!calcResult) return;
    try {
      const res = await fetch(getApiUrl("/api/position-trades"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calcResult),
      });
      const data = await res.json();
      if (data.success) {
        setOpenTradeModal(false);
        setCalcResult(null);
        fetchAll();
      }
    } catch (e) { console.error(e); }
  };

  // Close trade
  const handleCloseTrade = async (id: string, currentPrice: number) => {
    setClosingId(id);
    try {
      await fetch(getApiUrl(`/api/position-trades/${id}/close`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitPrice: currentPrice, reason: "MANUAL" }),
      });
      fetchAll();
    } finally { setClosingId(null); }
  };

  const bias = dailyBias ? BIAS_CONFIG[dailyBias.bias] : null;

  return (
    <div className="bg-[#040811] text-slate-200 p-3 space-y-3 rounded-xl border border-slate-800/40">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-500/20">
            <TrendingUp size={12} className="text-white" />
          </div>
          <span className="text-[13px] font-black text-white tracking-wide uppercase">Swing Position</span>
          <span className="text-[10px] text-slate-500 font-mono">· 2-5 Days Hold</span>
        </div>

        {/* Instrument Tabs */}
        <div className="flex items-center gap-1.5">
          {(["NIFTY", "BANKNIFTY", "SENSEX"] as Instrument[]).map(i => (
            <button
              key={i}
              onClick={() => setInst(i)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider transition-all ${
                inst === i
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
                  : "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
              }`}
            >
              {i === "BANKNIFTY" ? "BNIFTY" : i}
            </button>
          ))}
          <button
            onClick={fetchAll}
            disabled={loading}
            className="ml-1 p-1 rounded-lg bg-slate-800/60 text-slate-400 hover:text-white transition-all"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── Active Position Trades (MOVED TO TOP) ─────────────────────────── */}
      <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-slate-900/80 via-[#0c1225]/90 to-slate-900/80 p-4 shadow-lg shadow-indigo-500/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/30">
                <Activity size={12} className="text-white" />
              </div>
              <span className="text-xs font-black text-white uppercase tracking-widest hidden sm:block">Swing Dashboard</span>
            </div>
            
            <div className="flex bg-slate-800/50 p-0.5 rounded-lg border border-slate-700/50">
              <button
                onClick={() => setActiveTab("ACTIVE")}
                className={`px-3 py-1 text-[10px] font-black rounded-md transition-all flex items-center gap-1 ${
                  activeTab === "ACTIVE" ? "bg-indigo-500 text-white shadow-md" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }`}
              >
                LIVE {trades.length > 0 && <span className="bg-white/20 px-1.5 rounded">{trades.length}</span>}
              </button>
              <button
                onClick={() => setActiveTab("JOURNAL")}
                className={`px-3 py-1 text-[10px] font-black rounded-md transition-all flex items-center gap-1 ${
                  activeTab === "JOURNAL" ? "bg-slate-600 text-white shadow-md" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }`}
              >
                JOURNAL {shadowTrades.length > 0 && <span className="bg-white/20 px-1.5 rounded">{shadowTrades.length}</span>}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === "ACTIVE" && trades.length > 0 && (() => {
              const totalPnl = trades.reduce((acc, t) => acc + t.unrealizedPnL, 0);
              return (
                <span className={`text-sm font-black px-2 py-0.5 rounded-lg ${totalPnl >= 0 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'}`}>
                  Net: {fmtPnl(totalPnl)}
                </span>
              );
            })()}
            {activeTab === "JOURNAL" && shadowTrades.length > 0 && (() => {
              const totalPnl = shadowTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
              return (
                <span className={`text-sm font-black px-2 py-0.5 rounded-lg ${totalPnl >= 0 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'}`}>
                  Data Net: {fmtPnl(totalPnl)}
                </span>
              );
            })()}
          </div>
        </div>

        {activeTab === "ACTIVE" && (
          trades.length === 0 ? (
            <div className="text-center py-4 text-slate-600">
              <Target size={28} className="mx-auto mb-1.5 opacity-30" />
              <p className="text-xs">No active swing trades for {inst}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trades.map(trade => {
                const pnlColor = trade.unrealizedPnL >= 0 ? "#10b981" : "#ef4444";
                const pnlPct = trade.entryPrice > 0 ? ((trade.currentPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(1) : "0";
                const isBreakeven = trade.trailSl >= trade.entryPrice;

                return (
                  <div key={trade.id} className="bg-slate-950/60 rounded-xl border border-indigo-500/30 p-3 relative overflow-hidden">
                    <div className="absolute top-0 right-0 px-2 py-0.5 bg-indigo-500/20 text-indigo-400 text-[8px] font-black rounded-bl-lg">LIVE</div>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-black px-2 py-0.5 rounded ${trade.direction === "BUY_CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {trade.direction === "BUY_CE" ? "CE ▲" : "PE ▼"}
                        </span>
                        <span className="text-sm font-black text-white">{trade.instrument}</span>
                        <span className="text-sm font-bold text-slate-300">{trade.strike}</span>
                        <span className="text-xs text-slate-500">{trade.expiry}</span>
                        <span className="text-[10px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">Day {trade.holdDays + 1}</span>
                      </div>
                      <div className="text-right mt-1">
                        <div className="text-base font-black" style={{ color: pnlColor }}>{fmtPnl(trade.unrealizedPnL)}</div>
                        <div className="text-[10px]" style={{ color: pnlColor }}>{pnlPct}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {[
                        { label: "Entry", value: `₹${fmt(trade.entryPrice, 1)}`, color: "#94a3b8" },
                        { label: "CMP", value: `₹${fmt(trade.currentPrice, 1)}`, color: pnlColor },
                        { label: `SL ${isBreakeven ? "🔒" : ""}`, value: `₹${fmt(trade.trailSl, 1)}`, color: isBreakeven ? "#f97316" : "#ef4444" },
                        { label: "Target", value: `₹${fmt(trade.target2, 1)}`, color: "#10b981" },
                      ].map(c => (
                        <div key={c.label} className="bg-slate-800/60 rounded-lg p-1.5 text-center">
                          <div className="text-[9px] text-slate-500">{c.label}</div>
                          <div className="text-xs font-black" style={{ color: c.color }}>{c.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>Θ -₹{trade.dailyTheta}/day · Breakeven in {trade.breakevenDays}d</span>
                      <span>VIX@Entry: {trade.vixAtEntry > 0 ? fmt(trade.vixAtEntry, 1) : "—"} · {trade.dailyBiasAtEntry}</span>
                    </div>
                    <button
                      onClick={() => handleCloseTrade(trade.id, trade.currentPrice)}
                      disabled={closingId === trade.id}
                      className="mt-2 w-full py-1.5 rounded-lg bg-indigo-500/10 hover:bg-red-900/40 hover:border-red-500/30 border border-indigo-500/20 text-xs text-indigo-300 hover:text-red-400 font-black transition-all"
                    >
                      {closingId === trade.id ? "Closing..." : "✕ Close Position"}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === "JOURNAL" && (
          shadowTrades.length === 0 ? (
            <div className="text-center py-4 text-slate-600">
              <Shield size={28} className="mx-auto mb-1.5 opacity-30" />
              <p className="text-xs">No shadow trades collecting data for {inst}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {shadowTrades.map((trade: any) => {
                const currentPrice = trade.livePrice ?? trade.entry_price;
                const pnlColor = (trade.pnl || 0) >= 0 ? "#10b981" : "#ef4444";
                const pnlPct = trade.entry_price > 0 ? ((currentPrice - trade.entry_price) / trade.entry_price * 100).toFixed(1) : "0";
                
                let parsedN: any = {};
                try { parsedN = JSON.parse(trade.notes || "{}"); } catch {}
                const expiry = parsedN.expiry || "—";
                
                const entryMs = new Date(trade.created_at).getTime();
                const holdDays = Math.floor((Date.now() - entryMs) / (24 * 3600 * 1000));

                return (
                  <div key={trade.id} className="bg-slate-950/40 rounded-xl border border-slate-700/50 border-dashed p-3 relative overflow-hidden grayscale hover:grayscale-0 transition-all opacity-80 hover:opacity-100">
                    <div className="absolute top-0 right-0 px-2 py-0.5 bg-slate-700/50 text-slate-300 text-[8px] font-black rounded-bl-lg">SHADOW</div>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-black px-2 py-0.5 rounded ${trade.direction === "BUY_CE" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                          {trade.direction === "BUY_CE" ? "CE ▲" : "PE ▼"}
                        </span>
                        <span className="text-sm font-black text-slate-400">{trade.instrument}</span>
                        <span className="text-sm font-bold text-slate-500">{trade.strike}</span>
                        <span className="text-xs text-slate-600">{expiry}</span>
                        <span className="text-[10px] text-slate-600 bg-slate-800/50 px-1.5 py-0.5 rounded">Day {holdDays + 1}</span>
                      </div>
                      <div className="text-right mt-1">
                        <div className="text-base font-black" style={{ color: pnlColor }}>{fmtPnl(trade.pnl || 0)}</div>
                        <div className="text-[10px]" style={{ color: pnlColor }}>{pnlPct}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {[
                        { label: "Entry", value: `₹${fmt(trade.entry_price, 1)}`, color: "#64748b" },
                        { label: "CMP", value: `₹${fmt(currentPrice, 1)}`, color: pnlColor },
                        { label: `SL`, value: `₹${fmt(trade.stop_loss, 1)}`, color: "#ef4444" },
                        { label: "Target", value: `₹${fmt(trade.target, 1)}`, color: "#10b981" },
                      ].map(c => (
                        <div key={c.label} className="bg-slate-900/40 rounded-lg p-1.5 text-center border border-slate-800">
                          <div className="text-[9px] text-slate-600">{c.label}</div>
                          <div className="text-xs font-black" style={{ color: c.color }}>{c.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-600 mt-2">
                      <span>Reason: {parsedN.reasoning || "Data Collection"}</span>
                      <span>Pattern: {parsedN.strategyName || "Sandbox Pattern"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ── Row 1: Daily Bias + VIX Panel ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Swing Condition Monitor (HTF + Momentum + FII/DII) */}
        <div
          className="rounded-xl border p-4 transition-all col-span-2 relative overflow-hidden"
          style={{
            background: bias?.bg ?? "rgba(15,23,42,0.8)",
            borderColor: bias?.color ? `${bias.color}40` : "#1e293b",
            boxShadow: bias?.glow ?? "none",
          }}
        >
          {/* Subtle glassmorphism gradient bg */}
          <div className="absolute inset-0 opacity-10 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <BarChart2 size={16} style={{ color: bias?.color ?? "#64748b" }} />
              <span className="text-sm font-black text-slate-300 uppercase tracking-widest">Swing Condition Monitor · HTF</span>
            </div>
            {dailyBias && (
              <span className="text-[10px] text-slate-500 font-mono">Last Updated: {dailyBias.lastUpdatedDate}</span>
            )}
          </div>

          {dailyBias ? (
            <div className="relative z-10 grid grid-cols-4 gap-6">
              
              {/* Column 1: Core Trend & Score */}
              <div className="col-span-1 border-r border-slate-800/60 pr-6">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Daily Bias</div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl font-black" style={{ color: bias?.color }}>
                    {bias?.label}
                  </span>
                </div>
                <div className="mb-4">
                  <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span>Position Score</span>
                    <span className="font-black" style={{ color: bias?.color }}>{dailyBias.positionScore}/100</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800/80 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${dailyBias.positionScore}%`, background: bias?.color }}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 mt-2">
                  <span className={`text-[9px] px-2 py-1 rounded font-black text-center ${dailyBias.weeklyTrend === "UPTREND" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : dailyBias.weeklyTrend === "DOWNTREND" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-slate-800/60 text-slate-400"}`}>
                    WEEKLY: {dailyBias.weeklyTrend}
                  </span>
                  <div className="flex gap-2">
                    {dailyBias.higherHighs && <span className="text-[9px] flex-1 text-center py-1 rounded bg-emerald-500/10 text-emerald-400 font-black border border-emerald-500/20">HH ✅</span>}
                    {dailyBias.lowerLows && <span className="text-[9px] flex-1 text-center py-1 rounded bg-red-500/10 text-red-400 font-black border border-red-500/20">LL ✅</span>}
                  </div>
                </div>
              </div>

              {/* Column 2: EMAs & Moving Averages */}
              <div className="col-span-1 border-r border-slate-800/60 pr-6">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Key EMAs (Daily)</div>
                <div className="flex flex-col gap-2">
                  {[
                    { label: "EMA 20", val: dailyBias.ema20, above: dailyBias.aboveEma20, desc: "Short-term" },
                    { label: "EMA 50", val: dailyBias.ema50, above: dailyBias.aboveEma50, desc: "Medium-term" },
                    { label: "EMA 200", val: dailyBias.ema200, above: dailyBias.aboveEma200, desc: "Long-term" },
                  ].map(e => (
                    <div key={e.label} className="flex items-center justify-between bg-slate-900/40 rounded p-1.5 border border-slate-800/50">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-300">{e.label}</span>
                        <span className="text-[8px] text-slate-500">{e.desc}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[11px] font-black" style={{ color: e.above ? "#10b981" : "#ef4444" }}>
                          {e.val > 0 ? fmt(e.val, 0) : "—"}
                        </span>
                        <span style={{ color: e.above ? "#10b981" : "#ef4444" }} className="text-[8px] uppercase font-black">
                          {e.above ? "Above" : "Below"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Column 3: Momentum Indicators */}
              <div className="col-span-1 border-r border-slate-800/60 pr-6">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Momentum (1D)</div>
                <div className="space-y-4">
                  {/* RSI */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-black text-slate-400">RSI (14)</span>
                      <span className={`text-[11px] font-black ${dailyBias.rsi > 70 ? "text-red-400" : dailyBias.rsi < 30 ? "text-emerald-400" : "text-sky-400"}`}>
                        {dailyBias.rsi || "—"}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-slate-800 rounded-full relative">
                      <div className="absolute top-0 bottom-0 left-[30%] w-[1px] bg-emerald-500/50 z-10" />
                      <div className="absolute top-0 bottom-0 left-[70%] w-[1px] bg-red-500/50 z-10" />
                      <div 
                        className="h-full bg-sky-400 rounded-full transition-all" 
                        style={{ width: `${Math.min(100, Math.max(0, dailyBias.rsi))}%` }} 
                      />
                    </div>
                  </div>
                  {/* MACD */}
                  <div className="bg-slate-900/40 p-2 rounded border border-slate-800/50">
                    <span className="text-[10px] font-black text-slate-400 block mb-1">MACD (12,26,9)</span>
                    {dailyBias.macd ? (
                      <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                          <span className="text-[9px] text-slate-500">Hist</span>
                          <span className={`text-[11px] font-black ${dailyBias.macd.histogram > 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {dailyBias.macd.histogram > 0 ? "+" : ""}{dailyBias.macd.histogram}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[9px] text-slate-500">Signal</span>
                          <span className="text-[11px] font-black text-sky-400">{dailyBias.macd.signal}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-500">Calculating...</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Column 4: Institutional Flow & Breakout */}
              <div className="col-span-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Institutional Flow & Radar</div>
                
                {/* Flow Indicator */}
                <div className="mb-4 bg-slate-900/40 p-2 rounded border border-slate-800/50">
                  <div className="text-[9px] text-slate-400 mb-1">FII/DII NET BIAS</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
                      <div className={`h-full ${dailyBias.fiiDiiFlow === "BULLISH" ? "w-full bg-emerald-500" : "w-0"}`} />
                      <div className={`h-full ${dailyBias.fiiDiiFlow === "BEARISH" ? "w-full bg-red-500" : "w-0"}`} />
                      <div className={`h-full ${dailyBias.fiiDiiFlow === "NEUTRAL" ? "w-full bg-slate-500" : "w-0"}`} />
                    </div>
                    <span className={`text-[10px] font-black ${dailyBias.fiiDiiFlow === "BULLISH" ? "text-emerald-400" : dailyBias.fiiDiiFlow === "BEARISH" ? "text-red-400" : "text-slate-400"}`}>
                      {dailyBias.fiiDiiFlow}
                    </span>
                  </div>
                </div>

                {/* Breakout Radar */}
                <div className="bg-slate-900/40 p-2 rounded border border-slate-800/50 relative overflow-hidden">
                  <div className="absolute right-[-10px] top-[-10px] opacity-10">
                    <Activity size={40} />
                  </div>
                  <span className="text-[9px] text-slate-400 mb-2 block">SWING BREAKOUT RADAR</span>
                  <div className="flex justify-between text-[10px]">
                    <div className="flex flex-col">
                      <span className="text-slate-500">PWH</span>
                      <span className="font-mono text-emerald-400">{dailyBias.pwh ? fmt(dailyBias.pwh, 0) : "—"}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-slate-500">PWL</span>
                      <span className="font-mono text-red-400">{dailyBias.pwl ? fmt(dailyBias.pwl, 0) : "—"}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-8 h-32 relative z-10">
              <Activity size={16} className="animate-pulse" />
              Computing HTF parameters...
            </div>
          )}
        </div>

        {/* VIX Intelligence Panel (Condensed) */}
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-2 flex items-center justify-between text-[9px] font-mono">
          <div className="flex items-center gap-2">
            <Zap size={10} className="text-amber-400" />
            <span className="text-slate-400 uppercase font-black">VIX Intelligence:</span>
          </div>
          {evaluation ? (
            <div className="flex gap-4 items-center">
              <span className="font-black" style={{ color: VIX_CONFIG[evaluation.vixCategory].color }}>
                {vix > 0 ? fmt(vix, 1) : "—"} ({VIX_CONFIG[evaluation.vixCategory].label})
              </span>
              <span className="text-slate-500">|</span>
              <span className={`font-black ${evaluation.canTrade ? "text-emerald-400" : "text-red-400"}`}>
                BUY: {evaluation.canTrade ? "GO" : "AVOID"}
              </span>
              <span className="text-slate-500">|</span>
              <span className={`font-black ${
                evaluation.setupQuality === "EXCELLENT" ? "text-emerald-400" :
                evaluation.setupQuality === "GOOD" ? "text-blue-400" :
                evaluation.setupQuality === "MARGINAL" ? "text-amber-400" : "text-red-400"
              }`}>
                QUAL: {evaluation.setupQuality}
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-white font-black">LOTS: {evaluation.suggestedLots}</span>
            </div>
          ) : (
            <span className="text-slate-500 animate-pulse">Loading...</span>
          )}
        </div>
      </div>

      {/* ── Row 2: Swing S&R Levels (Layer 13) ─────────────────────────────── */}
      {swingLevels && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target size={14} className="text-violet-400" />
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Key S&R Levels · Layer 13</span>
            </div>
            {swingLevels.proximityWarning && (
              <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 rounded-lg px-2 py-1">
                <AlertTriangle size={11} className="text-amber-400" />
                <span className="text-[10px] text-amber-400 font-black">PROXIMITY WARNING</span>
              </div>
            )}
          </div>

          {/* Visual Level Bar */}
          <div className="relative">
            {/* Horizontal price map */}
            <div className="flex flex-col gap-1">
              {/* Top levels (resistance) */}
              {[
                { label: "R2", price: swingLevels.weeklyR2, type: "RESISTANCE" as const, src: "Weekly R2" },
                { label: "R1", price: swingLevels.weeklyR1, type: "RESISTANCE" as const, src: "Weekly R1" },
                { label: "PWH", price: swingLevels.prevWeekHigh, type: "RESISTANCE" as const, src: "Prev Week High" },
                { label: "PMH", price: swingLevels.prevMonthHigh, type: "RESISTANCE" as const, src: "Month High" },
              ]
                .filter(l => l.price > swingLevels.spot)
                .sort((a, b) => a.price - b.price)
                .slice(0, 3)
                .map(l => (
                  <div key={l.label} className="flex items-center gap-2 group">
                    <div className="w-10 text-right text-[10px] text-red-400 font-black shrink-0">{l.label}</div>
                    <div className="flex-1 relative h-6 flex items-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full h-px bg-red-500/30" />
                      </div>
                      <div className="relative z-10 ml-auto flex items-center gap-1.5 bg-slate-900 pl-1 pr-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        <span className="text-xs font-black text-red-400">{fmt(l.price, 0)}</span>
                        <span className="text-[9px] text-slate-600">{l.src}</span>
                      </div>
                    </div>
                    <div className="w-14 text-right text-[10px] text-slate-600 shrink-0">
                      +{fmt(l.price - swingLevels.spot, 0)} pts
                    </div>
                  </div>
                ))}

              {/* SPOT line */}
              <div className="flex items-center gap-2 my-1">
                <div className="w-10 text-right text-[10px] text-blue-400 font-black shrink-0">SPOT</div>
                <div className="flex-1 relative h-7 flex items-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full h-0.5 bg-blue-500/60" style={{ boxShadow: "0 0 8px rgba(59,130,246,0.5)" }} />
                  </div>
                  <div className="relative z-10 ml-auto flex items-center gap-1.5 bg-slate-900 pl-1 pr-2">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-sm font-black text-blue-300">{fmt(swingLevels.spot, 0)}</span>
                  </div>
                </div>
                <div className="w-14" />
              </div>

              {/* Support levels */}
              {[
                { label: "Pvt", price: swingLevels.weeklyPivot, type: "SUPPORT" as const, src: "Weekly Pivot" },
                { label: "S1",  price: swingLevels.weeklyS1, type: "SUPPORT" as const, src: "Weekly S1" },
                { label: "PWL", price: swingLevels.prevWeekLow, type: "SUPPORT" as const, src: "Prev Week Low" },
                { label: "S2",  price: swingLevels.weeklyS2, type: "SUPPORT" as const, src: "Weekly S2" },
              ]
                .filter(l => l.price < swingLevels.spot && l.price > 0)
                .sort((a, b) => b.price - a.price)
                .slice(0, 3)
                .map(l => (
                  <div key={l.label} className="flex items-center gap-2">
                    <div className="w-10 text-right text-[10px] text-emerald-400 font-black shrink-0">{l.label}</div>
                    <div className="flex-1 relative h-6 flex items-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full h-px bg-emerald-500/30" />
                      </div>
                      <div className="relative z-10 ml-auto flex items-center gap-1.5 bg-slate-900 pl-1 pr-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-xs font-black text-emerald-400">{fmt(l.price, 0)}</span>
                        <span className="text-[9px] text-slate-600">{l.src}</span>
                      </div>
                    </div>
                    <div className="w-14 text-right text-[10px] text-slate-600 shrink-0">
                      -{fmt(swingLevels.spot - l.price, 0)} pts
                    </div>
                  </div>
                ))}
            </div>

            {/* Proximity detail */}
            {swingLevels.proximityDetail && (
              <div className={`mt-3 text-xs px-3 py-2 rounded-lg font-mono ${
                swingLevels.proximityWarning
                  ? "bg-amber-500/10 border border-amber-500/30 text-amber-300"
                  : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
              }`}>
                {swingLevels.proximityDetail}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Row 3: Active Strategies · Ready to Fire ────────────────────── */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/20 p-4 mt-4">
        <div className="flex items-center gap-2 mb-4">
          <Target size={16} className="text-fuchsia-400" />
          <span className="text-sm font-black text-slate-300 uppercase tracking-widest">Active Strategies · Ready to Fire</span>
        </div>

        {dailyBias ? (
          <div className="grid grid-cols-4 gap-4">
            {/* 1. Trend Continuation */}
            <div className={`p-3 rounded-lg border ${
              dailyBias.weeklyTrend === "UPTREND" && dailyBias.emaAlignment === "BULLISH" ? "bg-emerald-500/10 border-emerald-500/30" :
              dailyBias.weeklyTrend === "DOWNTREND" && dailyBias.emaAlignment === "BEARISH" ? "bg-red-500/10 border-red-500/30" : "bg-slate-900/60 border-slate-800/50 opacity-60"
            }`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400">TREND CONTINUATION</span>
                { (dailyBias.weeklyTrend === "UPTREND" && dailyBias.emaAlignment === "BULLISH") || (dailyBias.weeklyTrend === "DOWNTREND" && dailyBias.emaAlignment === "BEARISH") ? (
                  <span className="animate-pulse w-2 h-2 rounded-full bg-emerald-400" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-700" />
                )}
              </div>
              <div className="text-[10px] text-slate-500 leading-tight">
                Aligns HTF trend with EMA structure. <br/>
                <span className="font-black mt-1 block">
                  Status: {dailyBias.weeklyTrend === "UPTREND" && dailyBias.emaAlignment === "BULLISH" ? <span className="text-emerald-400">READY (LONG)</span> : dailyBias.weeklyTrend === "DOWNTREND" && dailyBias.emaAlignment === "BEARISH" ? <span className="text-red-400">READY (SHORT)</span> : "WAITING"}
                </span>
              </div>
            </div>

            {/* 2. Mean Reversion */}
            <div className={`p-3 rounded-lg border ${
              dailyBias.rsi < 35 ? "bg-emerald-500/10 border-emerald-500/30" :
              dailyBias.rsi > 70 ? "bg-red-500/10 border-red-500/30" : "bg-slate-900/60 border-slate-800/50 opacity-60"
            }`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400">MEAN REVERSION</span>
                { dailyBias.rsi < 35 || dailyBias.rsi > 70 ? (
                  <span className="animate-pulse w-2 h-2 rounded-full bg-emerald-400" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-700" />
                )}
              </div>
              <div className="text-[10px] text-slate-500 leading-tight">
                Fades extreme RSI exhaustion zones. <br/>
                <span className="font-black mt-1 block">
                  Status: {dailyBias.rsi < 35 ? <span className="text-emerald-400">READY (OVERSOLD LONG)</span> : dailyBias.rsi > 70 ? <span className="text-red-400">READY (OVERBOUGHT SHORT)</span> : "WAITING"}
                </span>
              </div>
            </div>

            {/* 3. Breakout Expansion */}
            <div className={`p-3 rounded-lg border ${
              dailyBias.currentPrice > dailyBias.pwh ? "bg-emerald-500/10 border-emerald-500/30" :
              dailyBias.currentPrice < dailyBias.pwl && dailyBias.pwl > 0 ? "bg-red-500/10 border-red-500/30" : "bg-slate-900/60 border-slate-800/50 opacity-60"
            }`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400">BREAKOUT EXPANSION</span>
                { dailyBias.currentPrice > dailyBias.pwh || (dailyBias.currentPrice < dailyBias.pwl && dailyBias.pwl > 0) ? (
                  <span className="animate-pulse w-2 h-2 rounded-full bg-emerald-400" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-700" />
                )}
              </div>
              <div className="text-[10px] text-slate-500 leading-tight">
                Trades structural breaches (PWH/PWL). <br/>
                <span className="font-black mt-1 block">
                  Status: {dailyBias.currentPrice > dailyBias.pwh ? <span className="text-emerald-400">READY (PWH BREAK)</span> : (dailyBias.currentPrice < dailyBias.pwl && dailyBias.pwl > 0) ? <span className="text-red-400">READY (PWL BREAK)</span> : "WAITING"}
                </span>
              </div>
            </div>

            {/* 4. Institutional Cloner */}
            <div className={`p-3 rounded-lg border ${
              dailyBias.fiiDiiFlow === "BULLISH" && dailyBias.bias === "STRONG_BULL" ? "bg-emerald-500/10 border-emerald-500/30" :
              dailyBias.fiiDiiFlow === "BEARISH" && dailyBias.bias === "STRONG_BEAR" ? "bg-red-500/10 border-red-500/30" : "bg-slate-900/60 border-slate-800/50 opacity-60"
            }`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-slate-400">INSTITUTIONAL CLONER</span>
                { (dailyBias.fiiDiiFlow === "BULLISH" && dailyBias.bias === "STRONG_BULL") || (dailyBias.fiiDiiFlow === "BEARISH" && dailyBias.bias === "STRONG_BEAR") ? (
                  <span className="animate-pulse w-2 h-2 rounded-full bg-emerald-400" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-700" />
                )}
              </div>
              <div className="text-[10px] text-slate-500 leading-tight">
                Follows FII/DII aggressive flows. <br/>
                <span className="font-black mt-1 block">
                  Status: {dailyBias.fiiDiiFlow === "BULLISH" && dailyBias.bias === "STRONG_BULL" ? <span className="text-emerald-400">READY (SMART MONEY BUY)</span> : dailyBias.fiiDiiFlow === "BEARISH" && dailyBias.bias === "STRONG_BEAR" ? <span className="text-red-400">READY (SMART MONEY SELL)</span> : "WAITING"}
                </span>
              </div>
            </div>

          </div>
        ) : (
          <div className="text-xs text-slate-500 animate-pulse py-2">Waiting for HTF Condition Monitor data...</div>
        )}
      </div>

      {/* ── Row 5: Signal Intelligence (Condensed) ────────────────────── */}
      {signalStats && (
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-2 flex items-center justify-between text-[9px] font-mono">
          <div className="flex items-center gap-2">
            <BarChart2 size={10} className="text-sky-400" />
            <span className="text-slate-400 uppercase font-black">Signal Intel:</span>
          </div>
          <div className="flex gap-4 items-center">
            <span className={`font-black ${signalStats.winRate >= 60 ? "text-emerald-400" : "text-amber-400"}`}>
              WR: {signalStats.winRate}% (W:{signalStats.wins} L:{signalStats.losses})
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300">
              VIX Edge: {signalStats.suggestAvoidHighVix ? <span className="text-amber-400">Avoid High</span> : "Neutral"}
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300">
              Time Edge: {signalStats.suggestAvoidMorning ? <span className="text-amber-400">Avoid Morning</span> : "Neutral"}
            </span>
          </div>
        </div>
      )}

      {/* ── Row 6: Position Trade Calculator ──────────────────────────────── */}
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 to-fuchsia-500/5 pointer-events-none" />
        <div className="flex items-center justify-between mb-4 relative z-10">
          <div className="flex items-center gap-2">
            <PlusCircle size={16} className="text-violet-400" />
            <span className="text-sm font-black text-slate-300 uppercase tracking-widest">Position Trade Calculator</span>
          </div>
          {calcResult && (
            <button
              onClick={() => setOpenTradeModal(true)}
              className="text-[10px] px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-black hover:bg-emerald-500/30 transition-all"
            >
              ✅ OPEN TRADE
            </button>
          )}
        </div>

        <div className="relative z-10 grid grid-cols-6 gap-3 items-end">
          {/* Direction */}
          <div className="col-span-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Direction</label>
            <div className="flex gap-1">
              <button
                onClick={() => setCalcForm(f => ({ ...f, direction: "BUY_CE" }))}
                className={`flex-1 py-1.5 rounded text-[10px] font-black transition-all ${
                  calcForm.direction === "BUY_CE"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : "bg-slate-800/60 text-slate-500 border border-slate-700/40 hover:border-slate-600"
                }`}
              >
                CE ▲
              </button>
              <button
                onClick={() => setCalcForm(f => ({ ...f, direction: "BUY_PE" }))}
                className={`flex-1 py-1.5 rounded text-[10px] font-black transition-all ${
                  calcForm.direction === "BUY_PE"
                    ? "bg-red-500/20 text-red-400 border border-red-500/40"
                    : "bg-slate-800/60 text-slate-500 border border-slate-700/40 hover:border-slate-600"
                }`}
              >
                PE ▼
              </button>
            </div>
          </div>

          {/* Entry Price */}
          <div className="col-span-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Entry Premium ₹</label>
            <input
              type="number"
              value={calcForm.entryPrice || ""}
              onChange={e => setCalcForm(f => ({ ...f, entryPrice: parseFloat(e.target.value) || 0 }))}
              placeholder="e.g. 250"
              className="w-full bg-slate-800/80 border border-slate-700/50 rounded px-2 py-1.5 text-[11px] text-white font-mono focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Strike */}
          <div className="col-span-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Strike (0=ATM)</label>
            <input
              type="number"
              value={calcForm.strike || ""}
              onChange={e => setCalcForm(f => ({ ...f, strike: parseFloat(e.target.value) || 0 }))}
              placeholder="Auto ATM"
              className="w-full bg-slate-800/80 border border-slate-700/50 rounded px-2 py-1.5 text-[11px] text-white font-mono focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Lots */}
          <div className="col-span-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Lots</label>
            <input
              type="number"
              min={1}
              max={10}
              value={calcForm.lots}
              onChange={e => setCalcForm(f => ({ ...f, lots: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="w-full bg-slate-800/80 border border-slate-700/50 rounded px-2 py-1.5 text-[11px] text-white font-mono focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Days to Expiry */}
          <div className="col-span-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Days to Expiry</label>
            <input
              type="number"
              min={1}
              max={30}
              value={calcForm.daysToExpiry}
              onChange={e => setCalcForm(f => ({ ...f, daysToExpiry: Math.max(1, parseInt(e.target.value) || 7) }))}
              className="w-full bg-slate-800/80 border border-slate-700/50 rounded px-2 py-1.5 text-[11px] text-white font-mono focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Calculate Button */}
          <div className="col-span-1">
            <button
              onClick={handleCalcSetup}
              disabled={calcLoading || !calcForm.entryPrice}
              className={`w-full py-1.5 rounded-lg text-[10px] font-black transition-all ${
                calcLoading || !calcForm.entryPrice
                  ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20"
              }`}
            >
              {calcLoading ? "Computing..." : "⚡ CALCULATE"}
            </button>
          </div>
        </div>

        {/* Result Preview */}
        {calcResult && (
          <div className="relative z-10 mt-4 grid grid-cols-5 gap-3">
            {[
              { label: "Stop Loss (50%)", value: `₹${calcResult.slPrice}`, color: "#ef4444" },
              { label: "Target 1 (50%)", value: `₹${calcResult.target1}`, color: "#3b82f6" },
              { label: "Target 2 (100%)", value: `₹${calcResult.target2}`, color: "#10b981" },
              { label: "Daily θ Decay", value: `-₹${calcResult.dailyTheta}/day`, color: "#f59e0b" },
              { label: "Breakeven Days", value: `${calcResult.breakevenDays}d`, color: "#8b5cf6" },
            ].map(r => (
              <div key={r.label} className="bg-slate-900/60 rounded-lg p-2 text-center border border-slate-800/50">
                <div className="text-[9px] text-slate-500 mb-0.5">{r.label}</div>
                <div className="text-sm font-black" style={{ color: r.color }}>{r.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Confirm Trade Modal ─────────────────────────────────────────────── */}
      {openTradeModal && calcResult && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-black text-white">Confirm Position Trade</h3>
              <button onClick={() => setOpenTradeModal(false)} className="text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2 mb-6">
              {[
                { label: "Instrument", value: `${inst} ${calcForm.direction === "BUY_CE" ? "CE" : "PE"}` },
                { label: "Entry Premium", value: `₹${calcResult.entryPrice}` },
                { label: "Stop Loss", value: `₹${calcResult.slPrice} (50%)`, color: "#ef4444" },
                { label: "Target 2x", value: `₹${calcResult.target2}`, color: "#10b981" },
                { label: "Lots", value: `${calcResult.lots} × ${calcResult.lotSize} units` },
                { label: "Max Risk", value: `₹${((calcResult.entryPrice - calcResult.slPrice) * calcResult.lots * calcResult.lotSize).toLocaleString("en-IN")}`, color: "#f97316" },
              ].map(r => (
                <div key={r.label} className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-xs text-slate-400">{r.label}</span>
                  <span className="text-xs font-black" style={{ color: r.color ?? "#fff" }}>{r.value}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setOpenTradeModal(false)} className="flex-1 py-2 rounded-lg bg-slate-800 text-slate-400 text-sm font-black">
                Cancel
              </button>
              <button onClick={handleOpenTrade} className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black">
                ✅ Open Trade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PositionTradingDashboard;
