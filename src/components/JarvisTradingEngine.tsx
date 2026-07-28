/**
 * JarvisTradingEngine.tsx — JARVIS AI Trading Engine & Micro-Scalper Dashboard v2.2
 * ─────────────────────────────────────────────────────────────────────────────
 * What's new:
 *  - Live current P&L (₹) shown in real-time on open trade card
 *  - Entry time & Exit time displayed (IST formatted)
 *  - Exit Time column added in history ledger
 *  - Correct brokerage-adjusted P&L display (₹30 total = ₹15 entry + ₹15 exit)
 *  - Capital tracker card: ₹1,50,000 total, used, free
 *  - Pyramid lot badge (1 Lot → 2 Lots when smart engine adds)
 */

import React, { useState, useEffect } from "react";
import {
  Cpu, Zap, Brain, Activity, Shield, Radio,
  TrendingUp, BarChart2, Settings, ChevronRight,
  Wifi, WifiOff, Lock, Layers, Sparkles, Target,
  DollarSign, CheckCircle2, AlertTriangle, Clock, RefreshCw, Play, Pause,
  ArrowUpRight, ArrowDownRight, IndianRupee, Wallet, TrendingDown
} from "lucide-react";
import { io as socketIO } from "socket.io-client";

interface JarvisProps {
  niftySpot?: number;
  sensexSpot?: number;
  bankniftySpot?: number;
  fyersAuthorized?: boolean;
  connectionStatus?: string;
}

interface ScalpTrade {
  id: string;
  timestamp: number;
  entry_time: number;
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  entry_price: number;
  qty: number;
  lot_size: number;
  num_lots: number;
  total_qty: number;
  buy_cost: number;
  target_price: number;
  stop_loss: number;
  smart_sl: number;
  highest_price: number;
  exit_price?: number;
  status: "OPEN" | "CLOSED";
  pnl: number;
  live_pnl?: number;
  live_price?: number;
  target_pnl_goal: number;
  smart_sl_stage: "INITIAL_TIGHT" | "ZERO_RISK_BE" | "PROFIT_LOCK" | "MOMENTUM_FADE" | "STAGNANT_EXIT" | "TARGET_HIT" | "SL_HIT";
  reason: string;
  entry_momentum: number;
  closed_at?: number;
  brokerage_paid: number;
}

interface InstrumentMetric {
  momentum: number;
  netScore: number;
  adv: number;
  dec: number;
  spot: number;
}

interface CapitalState {
  totalCapital: number;
  usedCapital: number;
  freeCapital: number;
}

interface RealOrder {
  id: string;
  scalp_id: string;
  timestamp: number;
  instrument: string;
  direction: string;
  strike: number;
  symbol: string;
  qty: number;
  side: number;
  action: "ENTRY" | "EXIT";
  order_id?: string;
  status: "PLACED" | "REJECTED" | "FAILED";
  message: string;
}

interface EngineState {
  settings: {
    enabled: boolean;
    minMomentumThreshold: number;
    targetProfitGoal: number;
    maxDailyScalps: number;
    realTradingEnabled?: boolean;
  };
  stats: {
    totalScalps: number;
    openScalps: number;
    closedScalps: number;
    totalPnL: number;
    winRate: number;
    targetGoalPerTrade: number;
    minMomentumThreshold: number;
    consecutiveLosses: number;
    coolingDown: boolean;
    cooldownSecLeft: number;
  };
  capital?: CapitalState;
  liveMetrics?: {
    NIFTY: InstrumentMetric;
    BANKNIFTY: InstrumentMetric;
    SENSEX: InstrumentMetric;
  };
  openTrades: ScalpTrade[];
  recentClosed: ScalpTrade[];
  realOrders?: RealOrder[];
  fyersPositions?: any[];
  fyersOrders?: any[];
}

const getApiUrl = (p: string) => {
  const isLocal =
    typeof window !== "undefined" &&
    (window.location.protocol === "file:" || window.location.port === "5173");
  return `${isLocal ? "http://localhost:3000" : ""}${p}`;
};

const fmtTime = (ts?: number) => {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

const fmtRs = (v: number) =>
  v >= 0 ? `+₹${Math.abs(v).toLocaleString("en-IN")}` : `-₹${Math.abs(v).toLocaleString("en-IN")}`;

const stageColors: Record<string, string> = {
  INITIAL_TIGHT:  "#64748b",
  ZERO_RISK_BE:   "#06b6d4",
  PROFIT_LOCK:    "#10b981",
  MOMENTUM_FADE:  "#f59e0b",
  STAGNANT_EXIT:  "#f97316",
  TARGET_HIT:     "#22c55e",
  SL_HIT:         "#ef4444",
};

function GridBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(6,182,212,0.08) 0%, transparent 70%)" }} />
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(rgba(6,182,212,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.6) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: "radial-gradient(circle, #06b6d4, transparent)" }} />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: "radial-gradient(circle, #10b981, transparent)" }} />
    </div>
  );
}

function PulseDot({ color = "#06b6d4", size = 8 }: { color?: string; size?: number }) {
  return (
    <span className="relative flex" style={{ width: size, height: size }}>
      <span className="animate-ping absolute inline-flex rounded-full opacity-60" style={{ width: size, height: size, backgroundColor: color }} />
      <span className="relative inline-flex rounded-full" style={{ width: size, height: size, backgroundColor: color }} />
    </span>
  );
}

export default function JarvisTradingEngine({
  niftySpot = 0, sensexSpot = 0, bankniftySpot = 0,
  fyersAuthorized = false, connectionStatus = "DISCONNECTED",
}: JarvisProps) {
  const [engineData, setEngineData] = useState<EngineState | null>(null);

  const fetchState = async () => {
    try {
      const res = await fetch(getApiUrl("/api/jarvis/scalper/state"));
      const json = await res.json();
      if (json.s === "ok") setEngineData(json.data);
    } catch (err) {
      console.error("Error fetching Jarvis Scalper state:", err);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1500);
    const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
    const socket = socketIO(isLocal ? "http://localhost:3000" : window.location.origin, { transports: ["websocket", "polling"] });
    socket.on("jarvis-scalper-update", () => { fetchState(); });
    return () => { clearInterval(interval); socket.disconnect(); };
  }, []);

  const handleToggleEngine = async () => {
    if (!engineData) return;
    const nextState = !engineData.settings.enabled;
    try {
      const res = await fetch(getApiUrl("/api/jarvis/scalper/toggle"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextState }),
      });
      const json = await res.json();
      if (json.s === "ok") setEngineData(prev => prev ? { ...prev, settings: { ...prev.settings, enabled: nextState } } : null);
    } catch (err) { console.error(err); }
  };

  const totalPnL  = engineData?.stats.totalPnL || 0;
  const pnlColor  = totalPnL >= 0 ? "#10b981" : "#ef4444";
  const capital   = engineData?.capital;

  return (
    <div className="relative flex-1 flex flex-col overflow-auto" style={{ background: "#020b14", minHeight: 0 }}>
      <GridBackground />
      <div className="relative z-10 flex flex-col gap-6 p-6">

        {/* ── Hero Header ── */}
        <div className="flex items-start justify-between flex-wrap gap-4 border-b pb-6" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl border flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.15), rgba(16,185,129,0.1))", borderColor: "rgba(6,182,212,0.3)" }}>
              <Cpu size={28} className="text-cyan-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-black text-white tracking-tight">JARVIS AI MICRO-SCALPER</h1>
                <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border tracking-widest" style={{ color: "#06b6d4", borderColor: "rgba(6,182,212,0.4)", background: "rgba(6,182,212,0.1)" }}>
                  MOMENTUM ≥ 20
                </span>
                <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border tracking-widest text-emerald-400 border-emerald-500/40 bg-emerald-500/10">
                  REALTIME P&amp;L
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 font-mono">
                <Sparkles size={12} className="text-amber-400" />
                <span>Micro Scalping · ₹500 Goal · Smart SL Bot · ₹50 Brokerage/Trade (₹30 in/₹20 out) · 100 Daily Trades</span>
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                if (window.confirm("Aap saari purani trade history reset karke 00 karna chahte hain?")) {
                  try {
                    await fetch(getApiUrl("/api/jarvis/scalper/clear-history"), { method: "POST" });
                    fetchState();
                  } catch (e) { console.error(e); }
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-xs bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/40 cursor-pointer transition-all duration-200 active:scale-95"
              title="Wipe out all dummy/old trades and reset capital to ₹1,50,000"
            >
              <RefreshCw size={13} className="text-red-400" />
              <span>CLEAR ALL (00)</span>
            </button>

            <button
              onClick={async () => {
                try {
                  await fetch(getApiUrl("/api/jarvis/scalper/trigger-test"), {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ instrument: "NIFTY", direction: "BUY_CE" }),
                  });
                  fetchState();
                } catch (e) { console.error(e); }
              }}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl font-bold text-xs bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/40 cursor-pointer transition-all duration-200 active:scale-95"
            >
              <Zap size={14} className="text-amber-400" />
              <span>TEST SCALP</span>
            </button>

            <button
              onClick={handleToggleEngine}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs transition-all duration-200 active:scale-95 border cursor-pointer"
              style={{
                background: engineData?.settings.enabled ? "linear-gradient(135deg, #059669, #10b981)" : "rgba(30,41,59,0.7)",
                color: "#ffffff",
                borderColor: engineData?.settings.enabled ? "rgba(16,185,129,0.4)" : "rgba(100,116,139,0.3)",
                boxShadow: engineData?.settings.enabled ? "0 0 20px rgba(16,185,129,0.3)" : "none",
              }}
            >
              {engineData?.settings.enabled ? <Pause size={14} /> : <Play size={14} />}
              <span>{engineData?.settings.enabled ? "SCALPER ACTIVE" : "ENGINE PAUSED"}</span>
            </button>
          </div>
        </div>

        {/* Cooling Down Banner */}
        {engineData?.stats.coolingDown && (
          <div className="p-3.5 rounded-xl border flex items-center gap-3 bg-amber-950/40 border-amber-500/40 text-amber-300 text-xs font-mono">
            <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 animate-bounce" />
            <div>
              <span className="font-bold uppercase">3 Consecutive Loss Guard:</span> Cooling down. Resuming in <span className="font-black text-white">{engineData.stats.cooldownSecLeft}s</span>.
            </div>
          </div>
        )}

        {/* ⚡ LIVE MOMENTUM MONITOR */}
        <div className="rounded-2xl border p-5 flex flex-col gap-4" style={{ background: "linear-gradient(135deg, rgba(6,15,30,0.95), rgba(4,10,22,0.98))", borderColor: "rgba(6,182,212,0.3)", boxShadow: "0 0 30px rgba(6,182,212,0.06)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Activity size={18} className="text-cyan-400 animate-pulse" />
              <h2 className="text-sm font-black text-white tracking-tight">LIVE REALTIME MOMENTUM &amp; BREADTH MONITOR</h2>
            </div>
            <span className="text-[10px] font-mono text-slate-400 bg-black/40 px-3 py-1 rounded-full border border-white/10">
              Entry Trigger: Momentum ≥ 20
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["NIFTY", "BANKNIFTY", "SENSEX"] as const).map(inst => {
              const metric = engineData?.liveMetrics?.[inst] || { momentum: 0, netScore: 0, adv: 0, dec: 0, spot: 0 };
              const mom = metric.momentum;
              const isBullishTrigger = mom >= 20;
              const isBearishTrigger = mom <= -20;
              const momColor = isBullishTrigger ? "#10b981" : isBearishTrigger ? "#ef4444" : Math.abs(mom) >= 10 ? "#f59e0b" : "#64748b";
              return (
                <div key={inst} className="p-4 rounded-xl border flex flex-col gap-2.5 relative overflow-hidden" style={{ background: "rgba(10,20,45,0.7)", borderColor: `${momColor}35` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-white font-mono">{inst}</span>
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border tracking-wider" style={{ color: momColor, borderColor: `${momColor}44`, background: `${momColor}15` }}>
                      {isBullishTrigger ? "🔥 BULLISH (≥20)" : isBearishTrigger ? "🔥 BEARISH (≤-20)" : "SEARCHING…"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between py-1">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Live Momentum</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {mom > 0 ? <ArrowUpRight size={22} style={{ color: momColor }} /> : mom < 0 ? <ArrowDownRight size={22} style={{ color: momColor }} /> : null}
                        <span className="text-3xl font-black tabular-nums font-mono tracking-tight" style={{ color: momColor }}>
                          {mom > 0 ? `+${mom}` : mom}
                        </span>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <span className="text-[9px] text-slate-400 uppercase font-bold block">Adv / Dec</span>
                      <span className="text-xs font-bold text-emerald-400">{metric.adv} Adv</span>
                      <span className="text-slate-500 font-bold mx-1">/</span>
                      <span className="text-xs font-bold text-red-400">{metric.dec} Dec</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-white/5 text-slate-400">
                    <span>Weighted: <b className={metric.netScore >= 0 ? "text-emerald-400" : "text-red-400"}>{metric.netScore >= 0 ? `+${metric.netScore.toFixed(1)}` : metric.netScore.toFixed(1)}</b></span>
                    <span>Spot: <b className="text-slate-200">{metric.spot > 0 ? metric.spot.toLocaleString("en-IN") : "—"}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Stats Grid (5 cols) */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

          {/* Momentum Rule */}
          <div className="relative rounded-xl border p-4 flex flex-col gap-2 overflow-hidden" style={{ background: "rgba(8,16,32,0.7)", borderColor: "rgba(6,182,212,0.25)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Momentum Rule</span>
              <Activity size={14} className="text-cyan-400" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white tabular-nums tracking-tight">≥ 20</span>
              <span className="text-[10px] text-cyan-400/80 font-mono">Threshold</span>
            </div>
            <span className="text-[9px] text-slate-400 font-mono">Fast Directional Impulse</span>
          </div>

          {/* Target Profit */}
          <div className="relative rounded-xl border p-4 flex flex-col gap-2 overflow-hidden" style={{ background: "rgba(8,16,32,0.7)", borderColor: "rgba(16,185,129,0.25)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Target / Trade</span>
              <Target size={14} className="text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white tabular-nums tracking-tight">₹{engineData?.stats.targetGoalPerTrade || 500}</span>
              <span className="text-[10px] text-emerald-400/80 font-mono">1 Lot</span>
            </div>
            <span className="text-[9px] text-slate-400 font-mono">Nifty: 7.7 pts | BN: 14.3 pts | SX: 25 pts</span>
          </div>

          {/* Cumulative P&L */}
          <div className="relative rounded-xl border p-4 flex flex-col gap-2 overflow-hidden" style={{ background: "rgba(8,16,32,0.7)", borderColor: `${pnlColor}33`, boxShadow: `0 0 24px ${pnlColor}0c` }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: `${pnlColor}dd` }}>Total Scalper P&amp;L</span>
              <IndianRupee size={14} style={{ color: pnlColor }} />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black tabular-nums tracking-tight" style={{ color: pnlColor }}>
                {fmtRs(totalPnL)}
              </span>
            </div>
            <span className="text-[9px] text-slate-400 font-mono">Win Rate: {engineData?.stats.winRate || 0}% ({engineData?.stats.closedScalps || 0} closed)</span>
          </div>

          {/* Capital Tracker */}
          <div className="relative rounded-xl border p-4 flex flex-col gap-2 overflow-hidden" style={{ background: "rgba(8,16,32,0.7)", borderColor: "rgba(168,85,247,0.25)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Capital Status</span>
              <Wallet size={14} className="text-purple-400" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-white tabular-nums tracking-tight">
                ₹{(capital?.freeCapital ?? 150000).toLocaleString("en-IN")}
              </span>
              <span className="text-[10px] text-purple-400/80 font-mono">Free</span>
            </div>
            <div className="flex justify-between text-[9px] font-mono text-slate-400">
              <span>Total: ₹{(capital?.totalCapital ?? 150000).toLocaleString("en-IN")}</span>
              <span className="text-amber-400">Used: ₹{(capital?.usedCapital ?? 0).toLocaleString("en-IN")}</span>
            </div>
          </div>

          {/* Smart SL Bot */}
          <div className="relative rounded-xl border p-4 flex flex-col gap-2 overflow-hidden" style={{ background: "rgba(8,16,32,0.7)", borderColor: "rgba(139,92,246,0.25)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Smart SL Bot</span>
              <Shield size={14} className="text-purple-400" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-purple-300 font-mono uppercase">5-Stage SL</span>
            </div>
            <span className="text-[9px] text-slate-400 font-mono">BE@+2.5pt · Trail 65% · 35s Auto-Kill</span>
          </div>
        </div>

        {/* ── LIVE ACTIVE SCALP CARDS ── */}
        <div className="rounded-2xl border overflow-hidden p-5 flex flex-col gap-4" style={{ background: "linear-gradient(135deg, rgba(8,16,32,0.9), rgba(5,10,24,0.95))", borderColor: "rgba(6,182,212,0.25)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Zap size={18} className="text-amber-400 animate-pulse" />
              <h2 className="text-sm font-black text-white tracking-tight">LIVE ACTIVE SCALPS &amp; SMART SL BOT</h2>
            </div>
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-3 py-1 rounded-full border border-cyan-800/40">Evaluates every 1 second</span>
          </div>

          {!engineData || engineData.openTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <Activity size={24} className="text-slate-600 animate-pulse" />
              <p className="text-xs font-bold text-slate-400">No active scalp positions right now</p>
              <p className="text-[10px] text-slate-500 font-mono max-w-md">
                Jarvis AI scanning for Momentum ≥ 20 + Adv/Dec Confluence. Instant entry when impulse triggers.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {engineData.openTrades.map((t) => {
                const livePnL    = t.live_pnl ?? 0;
                const livePrice  = t.live_price ?? t.entry_price;
                const gainPts    = livePrice - t.entry_price;
                const progressPct = Math.min(100, Math.max(0, Math.round((gainPts / (t.target_price - t.entry_price)) * 100)));
                const pnlClr     = livePnL >= 0 ? "#10b981" : "#ef4444";
                const stageColor = stageColors[t.smart_sl_stage] || "#64748b";

                return (
                  <div key={t.id} className="p-4 rounded-xl border flex flex-col gap-3 relative overflow-hidden" style={{ background: "rgba(10,20,40,0.8)", borderColor: `${pnlClr}40` }}>
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-white px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">{t.instrument}</span>
                        <span className={`text-xs font-black px-2 py-0.5 rounded ${t.direction === "BUY_CE" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                          {t.direction} {t.strike}
                        </span>
                        {t.num_lots > 1 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-black">
                            {t.num_lots} LOTS 📈
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border" style={{ color: stageColor, borderColor: `${stageColor}44`, background: `${stageColor}15` }}>
                        {t.smart_sl_stage}
                      </span>
                    </div>

                    {/* LIVE P&L — prominent */}
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-xl" style={{ background: `${pnlClr}10`, border: `1px solid ${pnlClr}30` }}>
                      <div>
                        <span className="text-[9px] text-slate-400 uppercase font-bold block">Live P&amp;L (after ₹50 brokerage: ₹30 in + ₹20 out)</span>
                        <span className="text-2xl font-black tabular-nums tracking-tight font-mono" style={{ color: pnlClr }}>
                          {fmtRs(livePnL)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-slate-400 uppercase font-bold block">Current LTP</span>
                        <span className="text-lg font-black text-white font-mono">₹{livePrice.toFixed(2)}</span>
                        <span className="text-[9px] font-mono block" style={{ color: gainPts >= 0 ? "#10b981" : "#ef4444" }}>
                          {gainPts >= 0 ? `+${gainPts.toFixed(2)} pts` : `${gainPts.toFixed(2)} pts`}
                        </span>
                      </div>
                    </div>

                    {/* Price grid */}
                    <div className="grid grid-cols-4 gap-1.5 py-1 text-center bg-black/40 rounded-lg p-2 border border-white/5">
                      <div>
                        <span className="text-[9px] text-slate-500 block uppercase font-bold">Entry</span>
                        <span className="text-xs font-mono font-black text-slate-200">₹{t.entry_price}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block uppercase font-bold">Target</span>
                        <span className="text-xs font-mono font-black text-emerald-400">₹{t.target_price}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block uppercase font-bold">Smart SL</span>
                        <span className="text-xs font-mono font-black text-amber-400">₹{t.smart_sl}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block uppercase font-bold">Qty</span>
                        <span className="text-xs font-mono font-black text-cyan-300">{t.total_qty}</span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div>
                      <div className="flex justify-between text-[10px] font-mono mb-1">
                        <span className="text-slate-400 font-bold">Target Progress</span>
                        <span className="text-emerald-400 font-bold">{progressPct}% → ₹{t.target_pnl_goal} Goal</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-300" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>

                    {/* Timing row */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1 border-t border-white/5">
                      <span className="flex items-center gap-1"><Clock size={10} /> Entry: <b className="text-slate-300">{fmtTime(t.entry_time)}</b></span>
                      <span>Buy Cost: <b className="text-slate-300">₹{t.buy_cost?.toFixed(0)}</b></span>
                    </div>

                    {/* MANUAL EXIT BUTTON */}
                    <button
                      onClick={async () => {
                        if (!confirm(`Are you sure you want to MANUALLY EXIT ${t.instrument} ${t.direction}?\nCurrent P&L: ${fmtRs(livePnL)}`)) return;
                        try {
                          const res = await fetch(getApiUrl(`/api/jarvis/scalper/force-exit/${t.id}`), { method: "POST" });
                          const json = await res.json();
                          if (json.s === "ok") fetchState();
                        } catch (e) { console.error(e); }
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl font-black text-xs cursor-pointer transition-all duration-200 active:scale-95 border"
                      style={{
                        background: "rgba(239,68,68,0.12)",
                        borderColor: "rgba(239,68,68,0.4)",
                        color: "#f87171",
                      }}
                    >
                      <Shield size={13} />
                      <span>🖐️ MANUAL EXIT NOW — FORCE CLOSE @ MARKET</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── FYERS DEMAT ACCOUNT LIVE POSITIONS & NET P&L ── */}
        <div className="rounded-2xl border overflow-hidden p-5 flex flex-col gap-4" style={{ background: "rgba(10,18,36,0.9)", borderColor: "rgba(16,185,129,0.3)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <Shield size={18} className="text-emerald-400 animate-pulse" />
              <h2 className="text-sm font-black text-white tracking-tight">FYERS DEMAT LIVE ACCOUNT POSITIONS &amp; REALTIME P&amp;L</h2>
            </div>
            <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${fyersAuthorized ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" : "text-amber-400 border-amber-500/40 bg-amber-500/10"}`}>
              {fyersAuthorized ? "LIVE FYERS DEMAT SYNC: CONNECTED 🟢" : "FYERS OFFLINE"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase">
                  <th className="pb-2 pr-3">Trading Symbol</th>
                  <th className="pb-2 pr-3">Product</th>
                  <th className="pb-2 pr-3">Net Qty</th>
                  <th className="pb-2 pr-3">Buy Avg</th>
                  <th className="pb-2 pr-3">Sell Avg</th>
                  <th className="pb-2 pr-3">Realized P&amp;L</th>
                  <th className="pb-2 pr-3">Unrealized P&amp;L</th>
                  <th className="pb-2 text-right">Net P&amp;L (Fyers)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {(!engineData?.fyersPositions || engineData.fyersPositions.length === 0) ? (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-slate-500 text-[11px]">
                      No active positions in your Fyers Demat Account right now. Positions opened by Jarvis AI will reflect here in real-time.
                    </td>
                  </tr>
                ) : (
                  engineData.fyersPositions.map((pos: any, idx: number) => {
                    const netPl = pos.pl ?? (pos.unrealized_profit + pos.realized_profit) ?? 0;
                    const isWin = netPl >= 0;
                    return (
                      <tr key={pos.id || idx} className="hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-3 font-bold text-white max-w-[180px] truncate" title={pos.symbol}>{pos.symbol}</td>
                        <td className="py-2.5 pr-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                            {pos.productType || "INTRADAY"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-bold text-cyan-300">{pos.netQty ?? pos.qty}</td>
                        <td className="py-2.5 pr-3">₹{pos.buyAvg ?? pos.avgPrice ?? 0}</td>
                        <td className="py-2.5 pr-3 text-slate-400">₹{pos.sellAvg ?? 0}</td>
                        <td className="py-2.5 pr-3 text-slate-300">{fmtRs(pos.realized_profit || 0)}</td>
                        <td className="py-2.5 pr-3 text-slate-300">{fmtRs(pos.unrealized_profit || 0)}</td>
                        <td className={`py-2.5 text-right font-black text-sm ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                          {fmtRs(netPl)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── TRADE HISTORY LEDGER ── */}
        <div className="rounded-2xl border overflow-hidden p-5 flex flex-col gap-4" style={{ background: "rgba(8,16,32,0.6)", borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-300 flex items-center gap-2">
              <BarChart2 size={14} className="text-cyan-400" />
              Micro-Scalp Trade History Ledger
            </h3>
            <span className="text-[10px] font-mono text-slate-500">Brokerage ₹50/trade deducted (₹30 in + ₹20 out)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase">
                  <th className="pb-2 pr-3">Entry Time</th>
                  <th className="pb-2 pr-3">Exit Time</th>
                  <th className="pb-2 pr-3">Instrument</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Strike</th>
                  <th className="pb-2 pr-3">Qty</th>
                  <th className="pb-2 pr-3">Entry ₹</th>
                  <th className="pb-2 pr-3">Exit ₹</th>
                  <th className="pb-2 pr-3">Stage</th>
                  <th className="pb-2 text-right">P&amp;L (Net)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {(!engineData?.recentClosed || engineData.recentClosed.length === 0) ? (
                  <tr>
                    <td colSpan={10} className="py-4 text-center text-slate-500 text-[11px]">
                      No trade history yet. Waiting for first Momentum ≥ 20 impulse…
                    </td>
                  </tr>
                ) : (
                  engineData.recentClosed.map(t => {
                    const isWin      = (t.pnl || 0) > 0;
                    const stageClr   = stageColors[t.smart_sl_stage] || "#64748b";
                    return (
                      <tr key={t.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">{fmtTime(t.entry_time || t.timestamp)}</td>
                        <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">{fmtTime(t.closed_at)}</td>
                        <td className="py-2.5 pr-3 font-bold text-white">{t.instrument}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${t.direction === "BUY_CE" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                            {t.direction}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">{t.strike}</td>
                        <td className="py-2.5 pr-3 text-cyan-300 font-bold">{t.total_qty || t.lot_size}</td>
                        <td className="py-2.5 pr-3">₹{t.entry_price}</td>
                        <td className="py-2.5 pr-3 text-slate-300">₹{t.exit_price || "—"}</td>
                        <td className="py-2.5 pr-3 text-[10px]" style={{ color: stageClr }}>{t.smart_sl_stage}</td>
                        <td className={`py-2.5 text-right font-black text-sm ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                          {fmtRs(t.pnl)}
                          <span className="block text-[9px] font-normal text-slate-500">incl. ₹50 brok.</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── REAL FYERS ORDERS & REJECTIONS LEDGER ── */}
        <div className="rounded-2xl border overflow-hidden p-5 flex flex-col gap-4" style={{ background: "rgba(10,18,36,0.8)", borderColor: "rgba(6,182,212,0.2)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-200 flex items-center gap-2">
              <Zap size={14} className="text-emerald-400 animate-pulse" />
              Real Fyers Orders &amp; API Rejections Ledger
            </h3>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${fyersAuthorized ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" : "text-amber-400 border-amber-500/40 bg-amber-500/10"}`}>
                {fyersAuthorized ? "REAL FYERS AUTOMATION: ACTIVE 🟢" : "FYERS OFFLINE (SIMULATED)"}
              </span>
              <span className="text-[10px] font-mono text-slate-400">All Executed &amp; Rejected Order Requests</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Action</th>
                  <th className="pb-2 pr-3">Instrument</th>
                  <th className="pb-2 pr-3">Fyers Symbol</th>
                  <th className="pb-2 pr-3">Qty</th>
                  <th className="pb-2 pr-3">Fyers Order ID</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">API Response / Rejection Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {(!engineData?.realOrders || engineData.realOrders.length === 0) ? (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-slate-500 text-[11px]">
                      No real order requests yet. Orders placed or rejected by Fyers will be logged here in real-time.
                    </td>
                  </tr>
                ) : (
                  engineData.realOrders.map(ro => {
                    const isPlaced   = ro.status === "PLACED";
                    const isEntry    = ro.action === "ENTRY";
                    const statusClr  = isPlaced ? "#10b981" : "#ef4444";
                    return (
                      <tr key={ro.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">{fmtTime(ro.timestamp)}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black ${isEntry ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "bg-purple-500/20 text-purple-300 border border-purple-500/30"}`}>
                            {ro.action}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-bold text-white">{ro.instrument} {ro.direction}</td>
                        <td className="py-2.5 pr-3 text-slate-300 font-bold max-w-[180px] truncate" title={ro.symbol}>{ro.symbol}</td>
                        <td className="py-2.5 pr-3 text-cyan-300 font-bold">{ro.qty}</td>
                        <td className="py-2.5 pr-3 text-slate-400 text-[11px] font-bold">{ro.order_id || "—"}</td>
                        <td className="py-2.5 pr-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black border" style={{ color: statusClr, borderColor: `${statusClr}40`, background: `${statusClr}15` }}>
                            {ro.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-xs text-slate-300 font-sans max-w-[280px]" title={ro.message}>
                          {ro.message}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
