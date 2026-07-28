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
  STRONG_BULL: { color: "#10b981", bg: "rgba(16,185,129,0.08)", label: "🟢 STRONG BULL", glow: "0 0 16px rgba(16,185,129,0.25)" },
  BULL:        { color: "#34d399", bg: "rgba(52,211,153,0.05)",  label: "🟢 BULL",        glow: "0 0 10px rgba(52,211,153,0.15)" },
  NEUTRAL:     { color: "#94a3b8", bg: "rgba(148,163,184,0.04)", label: "⚪ NEUTRAL",     glow: "none" },
  BEAR:        { color: "#f97316", bg: "rgba(249,115,22,0.05)",  label: "🟠 BEAR",        glow: "0 0 10px rgba(249,115,22,0.15)" },
  STRONG_BEAR: { color: "#f43f5e", bg: "rgba(244,63,94,0.08)",   label: "🔴 STRONG BEAR", glow: "0 0 16px rgba(244,63,94,0.25)" },
} as const;

const VIX_CONFIG = {
  LOW:     { color: "#10b981", label: "LOW ✅ Cheap Premiums",     pct: 25 },
  NORMAL:  { color: "#3b82f6", label: "NORMAL ✅ Good to Trade",   pct: 50 },
  HIGH:    { color: "#f97316", label: "HIGH ⚠️ Reduce Size",       pct: 75 },
  EXTREME: { color: "#f43f5e", label: "EXTREME ❌ Avoid Buying",   pct: 100 },
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

  // Setup calculation handler
  const handleCalcSetup = async () => {
    if (!calcForm.entryPrice) return;
    setCalcLoading(true);
    try {
      const strikeVal = calcForm.strike > 0 ? calcForm.strike : getAtmStrike(spotPrice, inst);
      const res = await fetch(getApiUrl(`/api/position-trades/plan`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: inst,
          direction: calcForm.direction,
          strike: strikeVal,
          expiry: calcForm.expiry,
          entryPrice: calcForm.entryPrice,
          lots: calcForm.lots,
          daysToExpiry: calcForm.daysToExpiry
        })
      }).then(r => r.json());

      if (res.success) {
        setCalcResult(res.setup);
      }
    } catch (e) {
      console.error("[PositionDashboard] Calc error:", e);
    } finally {
      setCalcLoading(false);
    }
  };

  // Open position submission
  const handleOpenTrade = async () => {
    if (!calcResult) return;
    try {
      const res = await fetch(getApiUrl(`/api/position-trades`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: calcResult.instrument,
          direction: calcResult.direction,
          strike: calcResult.strike,
          expiry: calcResult.expiry,
          entryPrice: calcResult.entryPrice,
          lots: calcResult.lots,
          slPrice: calcResult.slPrice,
          target1: calcResult.target1,
          target2: calcResult.target2,
          reasoning: calcResult.reasoning
        })
      }).then(r => r.json());

      if (res.success) {
        setOpenTradeModal(false);
        setCalcResult(null);
        setCalcForm(f => ({ ...f, entryPrice: 0 }));
        fetchAll();
      }
    } catch (e) {
      console.error("[PositionDashboard] Open trade error:", e);
    }
  };

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
    <div className="bg-[#03060c]/95 text-slate-200 p-2 space-y-2 rounded-lg border border-slate-900 shadow-xl select-none font-sans">

      {/* ── Header (Ultra Compact) ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-900/60">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow shadow-emerald-500/25">
            <TrendingUp size={11} className="text-white" />
          </div>
          <span className="text-[12.5px] font-black text-white tracking-wider uppercase">SWING POSITION</span>
          <span className="text-[9px] text-slate-500 font-mono tracking-wide">- 2-5 Days Hold</span>
        </div>

        {/* Instrument Tabs */}
        <div className="flex items-center gap-1">
          {(["NIFTY", "BANKNIFTY", "SENSEX"] as Instrument[]).map(i => (
            <button
              key={i}
              onClick={() => setInst(i)}
              className={`px-2 py-0.5 rounded text-[9.5px] font-black tracking-wider transition-all duration-200 ${
                inst === i
                  ? "bg-emerald-600 text-white shadow shadow-emerald-600/25"
                  : "bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              {i === "BANKNIFTY" ? "BNIFTY" : i}
            </button>
          ))}
          <button
            onClick={fetchAll}
            disabled={loading}
            className="ml-1 p-0.5 rounded bg-slate-900/80 text-slate-400 hover:text-white transition-all"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── Active Position Trades (Sleek Glass Card) ────────────────────── */}
      <div className="rounded-lg border border-indigo-500/15 bg-gradient-to-br from-slate-950 via-[#0a0f1e]/80 to-slate-950 p-2.5 shadow">
        <div className="flex items-center justify-between mb-2 gap-1">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow shadow-indigo-500/25">
              <Activity size={11} className="text-white" />
            </div>
            <span className="text-[11.5px] font-black text-white uppercase tracking-wider">SWING DASHBOARD</span>
          </div>
          
          <div className="flex bg-slate-950/80 p-0.5 rounded border border-slate-900/80">
            <button
              onClick={() => setActiveTab("ACTIVE")}
              className={`px-2 py-0.5 text-[9px] font-black rounded transition-all ${
                activeTab === "ACTIVE" ? "bg-indigo-650 text-white shadow" : "text-slate-450 hover:text-slate-200"
              }`}
            >
              LIVE {trades.length > 0 && <span className="bg-white/20 px-1 rounded text-[8px]">{trades.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab("JOURNAL")}
              className={`px-2 py-0.5 text-[9px] font-black rounded transition-all ${
                activeTab === "JOURNAL" ? "bg-slate-700 text-white shadow" : "text-slate-450 hover:text-slate-200"
              }`}
            >
              JOURNAL {shadowTrades.length > 0 && <span className="bg-white/20 px-1 rounded text-[8px]">{shadowTrades.length}</span>}
            </button>
          </div>

          <div className="flex items-center">
            {activeTab === "ACTIVE" && trades.length > 0 && (() => {
              const totalPnl = trades.reduce((acc, t) => acc + t.unrealizedPnL, 0);
              return (
                <span className={`text-[11.5px] font-black px-1.5 py-0.2 rounded border ${totalPnl >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-450 border-rose-500/20'}`}>
                  Net: {fmtPnl(totalPnl)}
                </span>
              );
            })()}
            {activeTab === "JOURNAL" && shadowTrades.length > 0 && (() => {
              const totalPnl = shadowTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
              return (
                <span className={`text-[11.5px] font-black px-1.5 py-0.2 rounded border ${totalPnl >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-450 border-rose-500/20'}`}>
                  Data Net: {fmtPnl(totalPnl)}
                </span>
              );
            })()}
          </div>
        </div>

        {activeTab === "ACTIVE" && (
          trades.length === 0 ? (
            <div className="text-center py-3.5 text-slate-650 flex flex-col items-center justify-center border border-dashed border-slate-900 rounded bg-slate-950/20">
              <Target size={18} className="mb-1 opacity-20" />
              <p className="text-[10px] font-bold uppercase tracking-wider">No active swing trades for {inst}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {trades.map(trade => {
                const pnlColor = trade.unrealizedPnL >= 0 ? "#10b981" : "#f43f5e";
                const pnlPct = trade.entryPrice > 0 ? ((trade.currentPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(1) : "0";
                const isBreakeven = trade.trailSl >= trade.entryPrice;

                return (
                  <div key={trade.id} className="bg-slate-950/80 rounded border border-indigo-950 p-2 relative overflow-hidden transition-all hover:border-indigo-900">
                    <div className="absolute top-0 right-0 px-1.5 py-0.2 bg-indigo-500/10 text-indigo-400 text-[8px] font-black rounded-bl">LIVE</div>
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[9px] font-black px-1.5 py-0.2 rounded ${trade.direction === "BUY_CE" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                          {trade.direction === "BUY_CE" ? "CE ▲" : "PE ▼"}
                        </span>
                        <span className="text-[11.5px] font-black text-white">{trade.instrument}</span>
                        <span className="text-[11.5px] font-black text-slate-300 font-mono">{trade.strike}</span>
                        <span className="text-[9.5px] text-slate-500 font-medium font-mono">{trade.expiry}</span>
                        <span className="text-[9px] text-slate-400 bg-slate-900 px-1 py-0.2 rounded font-mono font-bold">D{trade.holdDays + 1}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[13.5px] font-black font-mono leading-none" style={{ color: pnlColor }}>{fmtPnl(trade.unrealizedPnL)}</div>
                        <div className="text-[9.5px] font-mono leading-none mt-0.5 font-bold" style={{ color: pnlColor }}>{pnlPct}%</div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                      {[
                        { label: "Entry", value: `₹${fmt(trade.entryPrice, 1)}`, color: "#94a3b8" },
                        { label: "CMP", value: `₹${fmt(trade.currentPrice, 1)}`, color: pnlColor },
                        { label: `SL ${isBreakeven ? "🔒" : ""}`, value: `₹${fmt(trade.trailSl, 1)}`, color: isBreakeven ? "#f97316" : "#f43f5e" },
                        { label: "Target", value: `₹${fmt(trade.target2, 1)}`, color: "#10b981" },
                      ].map(c => (
                        <div key={c.label} className="bg-slate-900/60 rounded p-1 text-center border border-white/[0.02]">
                          <div className="text-[8px] text-slate-500 uppercase tracking-wide leading-none mb-0.5">{c.label}</div>
                          <div className="text-[11px] font-black font-mono" style={{ color: c.color }}>{c.value}</div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                      <span>Θ -₹{trade.dailyTheta}/day · Breakeven: {trade.breakevenDays}d</span>
                      <span>VIX@E: {trade.vixAtEntry > 0 ? fmt(trade.vixAtEntry, 1) : "—"} · {trade.dailyBiasAtEntry}</span>
                    </div>
                    <button
                      onClick={() => handleCloseTrade(trade.id, trade.currentPrice)}
                      disabled={closingId === trade.id}
                      className="mt-1.5 w-full py-1 rounded bg-indigo-950/20 hover:bg-rose-950 hover:border-rose-900/40 border border-indigo-900/30 text-[10px] text-indigo-300 hover:text-rose-450 font-black transition-all"
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
            <div className="text-center py-3.5 text-slate-650 flex flex-col items-center justify-center border border-dashed border-slate-900 rounded bg-slate-950/20">
              <Shield size={18} className="mb-1 opacity-20" />
              <p className="text-[10px] font-bold uppercase tracking-wider">No shadow trades collecting data for {inst}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {shadowTrades.map((trade: any) => {
                const currentPrice = trade.livePrice ?? trade.entry_price;
                const pnlColor = (trade.pnl || 0) >= 0 ? "#10b981" : "#f43f5e";
                const pnlPct = trade.entry_price > 0 ? ((currentPrice - trade.entry_price) / trade.entry_price * 100).toFixed(1) : "0";
                
                let parsedN: any = {};
                try { parsedN = JSON.parse(trade.notes || "{}"); } catch {}
                const expiry = parsedN.expiry || "—";
                
                const entryMs = new Date(trade.created_at).getTime();
                const holdDays = Math.floor((Date.now() - entryMs) / (24 * 3600 * 1000));

                return (
                  <div key={trade.id} className="bg-slate-950/40 rounded border border-slate-900 border-dashed p-2 relative overflow-hidden grayscale hover:grayscale-0 transition-all opacity-85 hover:opacity-100">
                    <div className="absolute top-0 right-0 px-1.5 py-0.2 bg-slate-800 text-slate-400 text-[8px] font-black rounded-bl">SHADOW</div>
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[9px] font-black px-1.5 py-0.2 rounded ${trade.direction === "BUY_CE" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-450"}`}>
                          {trade.direction === "BUY_CE" ? "CE ▲" : "PE ▼"}
                        </span>
                        <span className="text-[11.5px] font-black text-slate-400">{trade.instrument}</span>
                        <span className="text-[11.5px] font-black text-slate-500 font-mono">{trade.strike}</span>
                        <span className="text-[9.5px] text-slate-650 font-mono">{expiry}</span>
                        <span className="text-[9px] text-slate-600 bg-slate-900/50 px-1 py-0.2 rounded font-mono">D{holdDays + 1}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[13.5px] font-black font-mono leading-none" style={{ color: pnlColor }}>{fmtPnl(trade.pnl || 0)}</div>
                        <div className="text-[9.5px] font-mono leading-none mt-0.5" style={{ color: pnlColor }}>{pnlPct}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                      {[
                        { label: "Entry", value: `₹${fmt(trade.entry_price, 1)}`, color: "#64748b" },
                        { label: "CMP", value: `₹${fmt(currentPrice, 1)}`, color: pnlColor },
                        { label: `SL`, value: `₹${fmt(trade.stop_loss, 1)}`, color: "#f43f5e" },
                        { label: "Target", value: `₹${fmt(trade.target, 1)}`, color: "#10b981" },
                      ].map(c => (
                        <div key={c.label} className="bg-slate-900/40 rounded p-1 text-center border border-slate-850">
                          <div className="text-[8px] text-slate-600 uppercase tracking-wide leading-none mb-0.5">{c.label}</div>
                          <div className="text-[11px] font-black font-mono" style={{ color: c.color }}>{c.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[8.5px] text-slate-600 font-mono">
                      <span className="truncate max-w-[50%]">Reason: {parsedN.reasoning || "Data Collection"}</span>
                      <span className="truncate max-w-[45%]">Pattern: {parsedN.strategyName || "Sandbox Pattern"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ── Row 1: Daily Bias + VIX Panel (Optimized Height) ────────────────── */}
      <div className="flex flex-col gap-1.5">
        
        {/* Swing Condition Monitor (HTF + Momentum + FII/DII) */}
        <div
          className="rounded-lg border p-2.5 transition-all relative overflow-hidden"
          style={{
            background: bias?.bg ?? "rgba(10,14,26,0.9)",
            borderColor: bias?.color ? `${bias.color}35` : "#101626",
            boxShadow: darkMode && bias?.glow ? bias.glow : undefined,
          }}
        >
          {/* Glowing backlighting */}
          <div className="absolute inset-0 opacity-[0.03] bg-gradient-to-br from-white to-transparent pointer-events-none" />

          <div className="flex items-center justify-between mb-2 relative z-10">
            <div className="flex items-center gap-1.5">
              <BarChart2 size={13} style={{ color: bias?.color ?? "#64748b" }} className="animate-pulse" />
              <span className="text-[11px] font-black text-slate-350 uppercase tracking-widest">SWING CONDITION MONITOR - HTF</span>
            </div>
            {dailyBias && (
              <span className="text-[8px] text-slate-500 font-mono uppercase tracking-wide">SYNC: {dailyBias.lastUpdatedDate}</span>
            )}
          </div>

          {dailyBias ? (
            <div className="relative z-10 grid grid-cols-4 gap-3.5">
              
              {/* Column 1: Core Trend & Score */}
              <div className="col-span-1 border-r border-slate-900/80 pr-3.5">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-bold mb-0.5">Daily Bias</div>
                <div className="mb-2.5">
                  <span className="text-[15.5px] font-black tracking-tight" style={{ color: bias?.color }}>
                    {bias?.label.split(" ").slice(1).join(" ") || bias?.label}
                  </span>
                </div>
                <div className="mb-2">
                  <div className="flex justify-between text-[8px] text-slate-500 mb-0.5 font-mono">
                    <span>Score</span>
                    <span className="font-black" style={{ color: bias?.color }}>{dailyBias.positionScore}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden border border-white/5 bg-slate-900/50">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${dailyBias.positionScore}%`, background: bias?.color }}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1 mt-1 font-mono">
                  <span className={`text-[8.5px] py-0.5 rounded font-black text-center border uppercase tracking-wider leading-none ${dailyBias.weeklyTrend === "UPTREND" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/15" : dailyBias.weeklyTrend === "DOWNTREND" ? "bg-rose-500/10 text-rose-400 border-rose-500/15" : "bg-slate-900 text-slate-550 border-slate-800"}`}>
                    WK: {dailyBias.weeklyTrend.replace("TREND", "")}
                  </span>
                  <div className="flex gap-1">
                    {dailyBias.higherHighs && <span className="text-[8.5px] py-0.5 rounded flex-1 text-center bg-emerald-500/15 text-emerald-450 border border-emerald-500/20 font-black leading-none">HH ✅</span>}
                    {dailyBias.lowerLows && <span className="text-[8.5px] py-0.5 rounded flex-1 text-center bg-rose-500/15 text-rose-450 border border-rose-500/20 font-black leading-none">LL ⚠️</span>}
                  </div>
                </div>
              </div>

              {/* Column 2: Key EMAs */}
              <div className="col-span-1 border-r border-slate-900/80 pr-3.5">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-bold mb-2">Daily EMAs</div>
                <div className="flex flex-col gap-1.5">
                  {[
                    { label: "EMA 20", val: dailyBias.ema20, above: dailyBias.aboveEma20 },
                    { label: "EMA 50", val: dailyBias.ema50, above: dailyBias.aboveEma50 },
                    { label: "EMA 200", val: dailyBias.ema200, above: dailyBias.aboveEma200 },
                  ].map(e => (
                    <div key={e.label} className="flex items-center justify-between bg-slate-950/40 rounded p-1 border border-slate-900/60 leading-none">
                      <span className="text-[8.5px] font-black text-slate-400">{e.label}</span>
                      <div className="flex flex-col items-end">
                        <span className="text-[11.5px] font-black font-mono" style={{ color: e.above ? "#10b981" : "#f43f5e" }}>
                          {e.val > 0 ? fmt(e.val, 0) : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Column 3: Momentum Indicators */}
              <div className="col-span-1 border-r border-slate-900/80 pr-3.5">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-bold mb-2">Momentum</div>
                <div className="space-y-2">
                  {/* RSI */}
                  <div>
                    <div className="flex justify-between items-center mb-0.5 font-mono">
                      <span className="text-[8.5px] text-slate-400 font-bold">RSI (14)</span>
                      <span className={`text-[11.5px] font-black ${dailyBias.rsi > 70 ? "text-rose-400" : dailyBias.rsi < 35 ? "text-emerald-400" : "text-cyan-400"}`}>
                        {dailyBias.rsi || "—"}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-slate-950 rounded-full relative border border-white/5">
                      <div className="absolute top-0 bottom-0 left-[35%] w-[1px] bg-emerald-500/50 z-10" />
                      <div className="absolute top-0 bottom-0 left-[70%] w-[1px] bg-rose-500/50 z-10" />
                      <div 
                        className="h-full bg-cyan-500 rounded-full transition-all" 
                        style={{ width: `${Math.min(100, Math.max(0, dailyBias.rsi))}%` }} 
                      />
                    </div>
                  </div>
                  {/* MACD */}
                  <div className="bg-slate-950/40 p-1 px-1.5 rounded border border-slate-900/60 leading-none">
                    <span className="text-[8px] font-bold text-slate-500 block mb-0.5">MACD (1D)</span>
                    {dailyBias.macd ? (
                      <div className="flex justify-between items-center mt-1">
                        <span className={`text-[10px] font-black font-mono ${dailyBias.macd.histogram > 0 ? "text-emerald-400" : "text-rose-450"}`}>
                          H: {dailyBias.macd.histogram > 0 ? "+" : ""}{dailyBias.macd.histogram.toFixed(1)}
                        </span>
                        <span className="text-[9.5px] font-black font-mono text-cyan-400">{dailyBias.macd.signal.toFixed(1)}</span>
                      </div>
                    ) : (
                      <span className="text-[8.5px] text-slate-600 font-mono">N/A</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Column 4: FII/DII Flows & Radar */}
              <div className="col-span-1">
                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-bold mb-2">Inst Flows & Radar</div>
                
                {/* Flow Indicator */}
                <div className="mb-2 bg-slate-950/40 p-1 px-1.5 rounded border border-slate-900/60 leading-none">
                  <div className="text-[8px] text-slate-500 mb-1 font-bold">FII/DII BIAS</div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1 bg-slate-950 rounded-full overflow-hidden flex">
                      <div className={`h-full ${dailyBias.fiiDiiFlow === "BULLISH" ? "w-full bg-emerald-500" : "w-0"}`} />
                      <div className={`h-full ${dailyBias.fiiDiiFlow === "BEARISH" ? "w-full bg-rose-500" : "w-0"}`} />
                      <div className={`h-full ${dailyBias.fiiDiiFlow === "NEUTRAL" ? "w-full bg-slate-500" : "w-0"}`} />
                    </div>
                    <span className={`text-[9.5px] font-black font-mono ${dailyBias.fiiDiiFlow === "BULLISH" ? "text-emerald-400" : dailyBias.fiiDiiFlow === "BEARISH" ? "text-rose-400" : "text-slate-450"}`}>
                      {dailyBias.fiiDiiFlow.slice(0, 4)}
                    </span>
                  </div>
                </div>

                {/* Breakout Radar */}
                <div className="bg-slate-950/40 p-1 px-1.5 rounded border border-slate-900/60 leading-none">
                  <span className="text-[8px] text-slate-500 mb-1 block font-bold">BREAKOUT LEVELS</span>
                  <div className="flex justify-between text-[10px] font-mono mt-0.5">
                    <div className="flex flex-col">
                      <span className="text-[7.5px] text-slate-650">PWH</span>
                      <span className="font-extrabold text-emerald-400">{dailyBias.pwh ? fmt(dailyBias.pwh, 0) : "—"}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[7.5px] text-slate-650">PWL</span>
                      <span className="font-extrabold text-rose-450">{dailyBias.pwl ? fmt(dailyBias.pwl, 0) : "—"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-4 h-24 relative z-10 font-mono">
              <Activity size={13} className="animate-pulse" />
              Computing HTF parameters...
            </div>
          )}
        </div>

        {/* VIX Intelligence Panel (Condensed) */}
        <div className="rounded-lg border border-slate-900 bg-slate-950/40 p-1.5 px-2.5 flex items-center justify-between text-[10px] font-mono shadow-sm">
          <div className="flex items-center gap-1.5">
            <Zap size={11} className="text-amber-400 animate-pulse" />
            <span className="text-slate-500 uppercase font-black tracking-wide">VIX Intelligence:</span>
          </div>
          {evaluation ? (
            <div className="flex gap-3 items-center">
              <span className="font-black" style={{ color: VIX_CONFIG[evaluation.vixCategory].color }}>
                {vix > 0 ? fmt(vix, 1) : "—"} ({VIX_CONFIG[evaluation.vixCategory].label})
              </span>
              <span className="text-slate-800">|</span>
              <span className={`font-black ${evaluation.canTrade ? "text-emerald-400" : "text-rose-450"}`}>
                BUY: {evaluation.canTrade ? "GO" : "AVOID"}
              </span>
              <span className="text-slate-800">|</span>
              <span className={`font-black ${
                evaluation.setupQuality === "EXCELLENT" ? "text-emerald-400" :
                evaluation.setupQuality === "GOOD" ? "text-cyan-400" :
                evaluation.setupQuality === "MARGINAL" ? "text-amber-400" : "text-rose-450"
              }`}>
                QUAL: {evaluation.setupQuality}
              </span>
              <span className="text-slate-800">|</span>
              <span className="text-white font-black">LOTS: {evaluation.suggestedLots}</span>
            </div>
          ) : (
            <span className="text-slate-600 animate-pulse">Loading...</span>
          )}
        </div>
      </div>

      {/* ── Row 2: Swing S&R Levels (Layer 13) ─────────────────────────────── */}
      {swingLevels && (
        <div className="rounded-lg border border-slate-900 bg-slate-950/20 p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Target size={13} className="text-violet-400" />
              <span className="text-[11px] font-black text-slate-350 uppercase tracking-widest">Key S&R Levels · Layer 13</span>
            </div>
            {swingLevels.proximityWarning && (
              <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.2">
                <AlertTriangle size={10} className="text-amber-400 animate-bounce" />
                <span className="text-[8px] text-amber-450 font-black">PROXIMITY WARNING</span>
              </div>
            )}
          </div>

          <div className="relative font-mono">
            <div className="flex flex-col gap-0.5">
              {/* Resistance Levels */}
              {[
                { label: "R2", price: swingLevels.weeklyR2, type: "RESISTANCE" as const, src: "Weekly R2" },
                { label: "R1", price: swingLevels.weeklyR1, type: "RESISTANCE" as const, src: "Weekly R1" },
                { label: "PWH", price: swingLevels.prevWeekHigh, type: "RESISTANCE" as const, src: "Prev Week High" },
                { label: "PMH", price: swingLevels.prevMonthHigh, type: "RESISTANCE" as const, src: "Month High" },
              ]
                .filter(l => l.price > swingLevels.spot)
                .sort((a, b) => a.price - b.price)
                .slice(0, 2)
                .map(l => (
                  <div key={l.label} className="flex items-center gap-2 py-0.2">
                    <div className="w-8 text-right text-[9.5px] text-rose-450 font-black shrink-0">{l.label}</div>
                    <div className="flex-1 relative h-4 flex items-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full h-[0.5px] bg-rose-500/20" />
                      </div>
                      <div className="relative z-10 ml-auto flex items-center gap-1 bg-slate-950 px-1 border border-rose-950/20 rounded">
                        <span className="text-[11px] font-black text-rose-450">{fmt(l.price, 0)}</span>
                        <span className="text-[8px] text-slate-600 font-bold uppercase">{l.src.slice(0, 8)}</span>
                      </div>
                    </div>
                    <div className="w-16 text-right text-[9.5px] text-slate-500 shrink-0">
                      +{fmt(l.price - swingLevels.spot, 0)} pts
                    </div>
                  </div>
                ))}

              {/* SPOT Price Line */}
              <div className="flex items-center gap-2 my-0.5">
                <div className="w-8 text-right text-[10px] text-cyan-400 font-black shrink-0">SPOT</div>
                <div className="flex-1 relative h-5 flex items-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full h-0.5 bg-cyan-500/40" style={{ boxShadow: "0 0 6px rgba(34,211,238,0.3)" }} />
                  </div>
                  <div className="relative z-10 ml-auto flex items-center gap-1 bg-slate-950 px-1.5 border border-cyan-500/30 rounded">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-[12.5px] font-black text-cyan-300">{fmt(swingLevels.spot, 0)}</span>
                  </div>
                </div>
                <div className="w-16" />
              </div>

              {/* Support Levels */}
              {[
                { label: "Pvt", price: swingLevels.weeklyPivot, type: "SUPPORT" as const, src: "Weekly Pivot" },
                { label: "S1",  price: swingLevels.weeklyS1, type: "SUPPORT" as const, src: "Weekly S1" },
                { label: "PWL", price: swingLevels.prevWeekLow, type: "SUPPORT" as const, src: "Prev Week Low" },
                { label: "S2",  price: swingLevels.weeklyS2, type: "SUPPORT" as const, src: "Weekly S2" },
              ]
                .filter(l => l.price < swingLevels.spot && l.price > 0)
                .sort((a, b) => b.price - a.price)
                .slice(0, 2)
                .map(l => (
                  <div key={l.label} className="flex items-center gap-2 py-0.2">
                    <div className="w-8 text-right text-[9.5px] text-emerald-400 font-black shrink-0">{l.label}</div>
                    <div className="flex-1 relative h-4 flex items-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full h-[0.5px] bg-emerald-500/20" />
                      </div>
                      <div className="relative z-10 ml-auto flex items-center gap-1 bg-slate-950 px-1 border border-emerald-950/20 rounded">
                        <span className="text-[11px] font-black text-emerald-450">{fmt(l.price, 0)}</span>
                        <span className="text-[8px] text-slate-600 font-bold uppercase">{l.src.slice(0, 8)}</span>
                      </div>
                    </div>
                    <div className="w-16 text-right text-[9.5px] text-slate-500 shrink-0">
                      -{fmt(swingLevels.spot - l.price, 0)} pts
                    </div>
                  </div>
                ))}
            </div>

            {swingLevels.proximityDetail && (
              <div className={`mt-1.5 text-[9.5px] px-2 py-1 rounded font-mono ${
                swingLevels.proximityWarning
                  ? "bg-amber-500/10 border border-amber-500/25 text-amber-300"
                  : "bg-emerald-500/10 border border-emerald-500/15 text-emerald-400"
              }`}>
                {swingLevels.proximityDetail}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Row 3: Active Strategies · Ready to Fire ────────────────────── */}
      <div className="rounded-lg border border-slate-900 bg-slate-950/20 p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Target size={13} className="text-fuchsia-400" />
          <span className="text-[11px] font-black text-slate-355 uppercase tracking-widest">Active Strategies · Ready to Fire</span>
        </div>

        {dailyBias ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                title: "TREND CONTINUATION",
                desc: "Aligns HTF trend with EMA structures.",
                ready: (dailyBias.weeklyTrend === "UPTREND" && dailyBias.emaAlignment === "BULLISH") || (dailyBias.weeklyTrend === "DOWNTREND" && dailyBias.emaAlignment === "BEARISH"),
                statusStr: dailyBias.weeklyTrend === "UPTREND" && dailyBias.emaAlignment === "BULLISH" ? "READY (LONG)" : dailyBias.weeklyTrend === "DOWNTREND" && dailyBias.emaAlignment === "BEARISH" ? "READY (SHORT)" : "WAITING",
                readyColor: dailyBias.weeklyTrend === "UPTREND" && dailyBias.emaAlignment === "BULLISH" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-450 bg-rose-500/10 border-rose-500/20"
              },
              {
                title: "MEAN REVERSION",
                desc: "Fades extreme daily RSI exhaustion zones.",
                ready: dailyBias.rsi < 35 || dailyBias.rsi > 70,
                statusStr: dailyBias.rsi < 35 ? "READY (OVERSOLD LONG)" : dailyBias.rsi > 70 ? "READY (OVERBOUGHT SHORT)" : "WAITING",
                readyColor: dailyBias.rsi < 35 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-450 bg-rose-500/10 border-rose-500/20"
              },
              {
                title: "BREAKOUT EXPANSION",
                desc: "Trades structural breaches of PWH/PWL.",
                ready: dailyBias.currentPrice > dailyBias.pwh || (dailyBias.currentPrice < dailyBias.pwl && dailyBias.pwl > 0),
                statusStr: dailyBias.currentPrice > dailyBias.pwh ? "READY (PWH BREAK)" : (dailyBias.currentPrice < dailyBias.pwl && dailyBias.pwl > 0) ? "READY (PWL BREAK)" : "WAITING",
                readyColor: dailyBias.currentPrice > dailyBias.pwh ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-450 bg-rose-500/10 border-rose-500/20"
              },
              {
                title: "INSTITUTIONAL CLONER",
                desc: "Follows FII/DII aggressive daily flows.",
                ready: (dailyBias.fiiDiiFlow === "BULLISH" && dailyBias.bias === "STRONG_BULL") || (dailyBias.fiiDiiFlow === "BEARISH" && dailyBias.bias === "STRONG_BEAR"),
                statusStr: dailyBias.fiiDiiFlow === "BULLISH" && dailyBias.bias === "STRONG_BULL" ? "READY (SMART BUY)" : dailyBias.fiiDiiFlow === "BEARISH" && dailyBias.bias === "STRONG_BEAR" ? "READY (SMART SELL)" : "WAITING",
                readyColor: dailyBias.fiiDiiFlow === "BULLISH" && dailyBias.bias === "STRONG_BULL" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-rose-450 bg-rose-500/10 border-rose-500/20"
              }
            ].map(s => (
              <div key={s.title} className={`p-2 rounded border transition-colors ${
                s.ready ? "bg-slate-900/80 border-indigo-950" : "bg-slate-950/40 border-slate-900/50 opacity-60"
              }`}>
                <div className="flex justify-between items-start mb-1 gap-1">
                  <span className="text-[9px] font-black text-slate-450 tracking-wider truncate">{s.title}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.ready ? "bg-emerald-400 animate-pulse" : "bg-slate-700"}`} />
                </div>
                <p className="text-[8.5px] text-slate-500 leading-tight mb-1">{s.desc}</p>
                <div className="font-mono text-[9px] font-black uppercase">
                  {s.ready ? (
                    <span className={`px-1.5 py-0.2 rounded border ${s.readyColor}`}>{s.statusStr}</span>
                  ) : (
                    <span className="text-slate-600 bg-slate-900/80 px-1.5 py-0.2 rounded border border-slate-800">WAITING</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[9.5px] text-slate-600 animate-pulse font-mono py-1">Waiting for HTF Condition Monitor data...</div>
        )}
      </div>

      {/* ── Row 5: Signal Intelligence (Condensed) ────────────────────── */}
      {signalStats && (
        <div className="rounded-lg border border-slate-900 bg-slate-950/40 p-1.5 px-2.5 flex items-center justify-between text-[10px] font-mono shadow-sm">
          <div className="flex items-center gap-1.5">
            <BarChart2 size={11} className="text-sky-400" />
            <span className="text-slate-500 uppercase font-black tracking-wide">Signal Intel:</span>
          </div>
          <div className="flex gap-3 items-center">
            <span className={`font-black ${signalStats.winRate >= 60 ? "text-emerald-400" : "text-amber-400"}`}>
              WR: {signalStats.winRate}% (W:{signalStats.wins} L:{signalStats.losses})
            </span>
            <span className="text-slate-800">|</span>
            <span className="text-slate-300 font-bold">
              VIX Edge: {signalStats.suggestAvoidHighVix ? <span className="text-amber-400">Avoid High</span> : "Neutral"}
            </span>
            <span className="text-slate-800">|</span>
            <span className="text-slate-300 font-bold">
              Time Edge: {signalStats.suggestAvoidMorning ? <span className="text-amber-400">Avoid Morning</span> : "Neutral"}
            </span>
          </div>
        </div>
      )}

      {/* ── Row 6: Position Trade Calculator (Tactile Grid Layout) ───────── */}
      <div className="rounded-lg border border-slate-900 bg-gradient-to-br from-slate-950 to-slate-900 p-2.5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 to-fuchsia-500/5 pointer-events-none" />
        <div className="flex items-center justify-between mb-2 relative z-10">
          <div className="flex items-center gap-1.5">
            <PlusCircle size={13} className="text-violet-400" />
            <span className="text-[11px] font-black text-slate-350 uppercase tracking-widest">Position Trade Calculator</span>
          </div>
          {calcResult && (
            <button
              onClick={() => setOpenTradeModal(true)}
              className="text-[9.5px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-black hover:bg-emerald-500/30 transition-all uppercase tracking-wide"
            >
              ✅ OPEN TRADE
            </button>
          )}
        </div>

        <div className="relative z-10 grid grid-cols-6 gap-2 items-end">
          {/* Direction */}
          <div className="col-span-1">
            <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-1 font-bold">Direction</label>
            <div className="flex gap-1">
              <button
                onClick={() => setCalcForm(f => ({ ...f, direction: "BUY_CE" }))}
                className={`flex-1 py-1 rounded text-[10px] font-black transition-all ${
                  calcForm.direction === "BUY_CE"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : "bg-slate-900/80 text-slate-500 border border-slate-800 hover:border-slate-700"
                }`}
              >
                CE ▲
              </button>
              <button
                onClick={() => setCalcForm(f => ({ ...f, direction: "BUY_PE" }))}
                className={`flex-1 py-1 rounded text-[10px] font-black transition-all ${
                  calcForm.direction === "BUY_PE"
                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                    : "bg-slate-900/80 text-slate-500 border border-slate-800 hover:border-slate-700"
                }`}
              >
                PE ▼
              </button>
            </div>
          </div>

          {/* Entry Price */}
          <div className="col-span-1">
            <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-1 font-bold">Entry Premium ₹</label>
            <input
              type="number"
              value={calcForm.entryPrice || ""}
              onChange={e => setCalcForm(f => ({ ...f, entryPrice: parseFloat(e.target.value) || 0 }))}
              placeholder="e.g. 250"
              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-white font-mono font-bold focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Strike */}
          <div className="col-span-1">
            <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-1 font-bold">Strike (0=ATM)</label>
            <input
              type="number"
              value={calcForm.strike || ""}
              onChange={e => setCalcForm(f => ({ ...f, strike: parseFloat(e.target.value) || 0 }))}
              placeholder="Auto ATM"
              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-white font-mono font-bold focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Lots */}
          <div className="col-span-1">
            <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-1 font-bold">Lots</label>
            <input
              type="number"
              min={1}
              max={10}
              value={calcForm.lots}
              onChange={e => setCalcForm(f => ({ ...f, lots: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-white font-mono font-bold focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Days to Expiry */}
          <div className="col-span-1">
            <label className="text-[8px] text-slate-500 uppercase tracking-wider block mb-1 font-bold">Expiry Days</label>
            <input
              type="number"
              min={1}
              max={30}
              value={calcForm.daysToExpiry}
              onChange={e => setCalcForm(f => ({ ...f, daysToExpiry: Math.max(1, parseInt(e.target.value) || 7) }))}
              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-white font-mono font-bold focus:border-violet-500/60 focus:outline-none transition-all"
            />
          </div>

          {/* Calculate Button */}
          <div className="col-span-1">
            <button
              onClick={handleCalcSetup}
              disabled={calcLoading || !calcForm.entryPrice}
              className={`w-full py-1.5 rounded text-[10px] font-black transition-all ${
                calcLoading || !calcForm.entryPrice
                  ? "bg-slate-900 text-slate-600 cursor-not-allowed border border-slate-800"
                  : "bg-violet-650 hover:bg-violet-550 text-white shadow shadow-violet-500/20"
              }`}
            >
              {calcLoading ? "CALC..." : "⚡ CALCULATE"}
            </button>
          </div>
        </div>

        {/* Result Preview (High-contrast numbers) */}
        {calcResult && (
          <div className="relative z-10 mt-2.5 grid grid-cols-5 gap-2">
            {[
              { label: "Stop Loss (50%)", value: `₹${calcResult.slPrice}`, color: "#f43f5e" },
              { label: "Target 1 (50%)", value: `₹${calcResult.target1}`, color: "#3b82f6" },
              { label: "Target 2 (100%)", value: `₹${calcResult.target2}`, color: "#10b981" },
              { label: "Daily θ Decay", value: `-₹${calcResult.dailyTheta}/d`, color: "#f59e0b" },
              { label: "Breakeven Days", value: `${calcResult.breakevenDays}d`, color: "#a855f7" },
            ].map(r => (
              <div key={r.label} className="bg-slate-950/60 rounded p-1.5 text-center border border-slate-900">
                <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-0.5 leading-none">{r.label}</div>
                <div className="text-[12.5px] font-black font-mono" style={{ color: r.color }}>{r.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Confirm Trade Modal ─────────────────────────────────────────────── */}
      {openTradeModal && calcResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-3 border-b border-slate-900 pb-2">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Confirm Position Trade</h3>
              <button onClick={() => setOpenTradeModal(false)} className="text-slate-500 hover:text-white">
                <X size={15} />
              </button>
            </div>

            <div className="space-y-1.5 mb-5 font-mono">
              {[
                { label: "Instrument", value: `${inst} ${calcForm.direction === "BUY_CE" ? "CE" : "PE"}` },
                { label: "Entry Premium", value: `₹${calcResult.entryPrice}` },
                { label: "Stop Loss", value: `₹${calcResult.slPrice} (50%)`, color: "#f43f5e" },
                { label: "Target 2x", value: `₹${calcResult.target2}`, color: "#10b981" },
                { label: "Lots", value: `${calcResult.lots} × ${calcResult.lotSize} units` },
                { label: "Max Risk", value: `₹${((calcResult.entryPrice - calcResult.slPrice) * calcResult.lots * calcResult.lotSize).toLocaleString("en-IN")}`, color: "#f97316" },
              ].map(r => (
                <div key={r.label} className="flex justify-between py-1 border-b border-slate-900">
                  <span className="text-xs text-slate-500 font-bold">{r.label}</span>
                  <span className="text-xs font-black" style={{ color: r.color ?? "#fff" }}>{r.value}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setOpenTradeModal(false)} className="flex-1 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs font-black">
                Cancel
              </button>
              <button onClick={handleOpenTrade} className="flex-1 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black">
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
