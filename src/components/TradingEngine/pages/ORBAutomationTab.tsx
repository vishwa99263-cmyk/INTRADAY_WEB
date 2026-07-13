import React, { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
import { Play, Square, Settings, Activity, Target, ShieldAlert, CheckCircle, RefreshCw, AlertTriangle } from "lucide-react";
import type { OptionChainState } from "../../../types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ORBIndexState {
  high: number;
  low: number;
  rangeEstablished: boolean;
  tradedToday: boolean;
  activeTradeId: string | null;
  activeTradeStrike: number | null;
  activeTradeDirection: "BUY_CE" | "BUY_PE" | null;
  activeTradeEntryPrice: number | null;
  activeTradeQty: number | null;
  activeTradeOptionSymbol: string | null;
}

interface ORBEngineState {
  isActive: boolean;
  targetPoints: number;
  slPoints: number;
  lotSizeMultiplier: number;
  isRealMode: boolean;
  lastUpdatedDate: string;
  indices: Record<string, ORBIndexState>;
}

interface ORBAutomationTabProps {
  socket: Socket | null;
  niftyOptionChain: OptionChainState;
  sensexOptionChain: OptionChainState;
  bankniftyOptionChain: OptionChainState;
}

export const ORBAutomationTab: React.FC<ORBAutomationTabProps> = ({
  socket,
  niftyOptionChain,
  sensexOptionChain,
  bankniftyOptionChain,
}) => {
  const [state, setState] = useState<ORBEngineState | null>(null);
  const [form, setForm] = useState({
    targetPoints: 30,
    slPoints: 15,
    lotSizeMultiplier: 1,
  });
  const [loading, setLoading] = useState(false);

  // ── Sync State via REST + Socket ─────────────────────────────────────────────
  
  useEffect(() => {
    // 1. Fetch initial state
    fetch("http://localhost:3000/api/te/orb-naked/state")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.state) {
          setState(data.state);
          setForm({
            targetPoints: data.state.targetPoints,
            slPoints: data.state.slPoints,
            lotSizeMultiplier: data.state.lotSizeMultiplier,
          });
        }
      })
      .catch((err) => console.error("[ORBTab] Initial fetch failed:", err));

    // 2. Listen to real-time state updates from Socket.IO
    if (socket) {
      socket.on("orb-naked-state", (newState: ORBEngineState) => {
        setState(newState);
      });
      socket.emit("request-orb-state");
    }

    return () => {
      if (socket) {
        socket.off("orb-naked-state");
      }
    };
  }, [socket]);

  // ── Update settings API call ─────────────────────────────────────────────────
  
  const updateSettings = async (updatedFields: Partial<ORBEngineState>) => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:3000/api/te/orb-naked/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFields),
      });
      const data = await res.json();
      if (data.success && data.state) {
        setState(data.state);
      }
    } catch (err) {
      console.error("[ORBTab] Failed to update settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      targetPoints: Number(form.targetPoints),
      slPoints: Number(form.slPoints),
      lotSizeMultiplier: Number(form.lotSizeMultiplier),
    });
  };

  // ── Helper: Compute live premium price ────────────────────────────────────────
  
  const getLiveOptionPrice = (
    indexName: string,
    strike: number | null,
    direction: "BUY_CE" | "BUY_PE" | null
  ): number => {
    if (!strike || !direction) return 0;
    const chain = indexName === "NIFTY"
      ? niftyOptionChain
      : (indexName === "BANKNIFTY" ? bankniftyOptionChain : sensexOptionChain);
    
    const row = chain.strikes.find((s) => s.strikePrice === strike);
    if (!row) return 0;
    return direction === "BUY_CE" ? (row.ceLtp || 0) : (row.peLtp || 0);
  };

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-slate-500 font-mono">
        <RefreshCw size={24} className="animate-spin text-indigo-500" />
        <span>Syncing ORB Engine State...</span>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 bg-[#040811] text-slate-200 min-h-screen">
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-900">
        <div>
          <h1 className="text-xl font-black text-white tracking-wider uppercase flex items-center gap-2">
            <Target className="text-indigo-500" size={20} />
            Opening Range Breakout (Naked Auto)
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Isolated Range Breakout Execution Engine · 09:15 - 09:30 range calculation
          </p>
        </div>

        {/* Global start/stop button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-4 py-2 rounded font-mono text-xs font-black border bg-emerald-500/15 border-emerald-500/30 text-emerald-400 select-none shadow-sm shadow-emerald-500/10">
            <Play size={13} fill="currentColor" /> ALWAYS ACTIVE
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Left Column: Config Panel ────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-4 space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <Settings size={15} className="text-slate-400" />
              Strategy Configuration
            </h2>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500 font-black uppercase">
                  Target Profit (Premium Points)
                </label>
                <input
                  type="number"
                  required
                  value={form.targetPoints}
                  onChange={(e) => setForm({ ...form, targetPoints: Number(e.target.value) })}
                  className="w-full bg-[#040811] border border-slate-800 rounded px-3 py-2 text-sm font-mono text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500 font-black uppercase">
                  Stop Loss (Premium Points)
                </label>
                <input
                  type="number"
                  required
                  value={form.slPoints}
                  onChange={(e) => setForm({ ...form, slPoints: Number(e.target.value) })}
                  className="w-full bg-[#040811] border border-slate-800 rounded px-3 py-2 text-sm font-mono text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500 font-black uppercase">
                  Lot Size Multiplier
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={form.lotSizeMultiplier}
                  onChange={(e) => setForm({ ...form, lotSizeMultiplier: Number(e.target.value) })}
                  className="w-full bg-[#040811] border border-slate-800 rounded px-3 py-2 text-sm font-mono text-white outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 rounded font-mono uppercase tracking-wider transition-colors duration-150 cursor-pointer outline-none shadow-md"
              >
                Apply Parameters
              </button>
            </form>
          </div>

          {/* Mode Selector Panel */}
          <div className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <ShieldAlert size={15} className="text-slate-400" />
              Trading Mode Control
            </h2>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">Execution Mode</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded tracking-wide font-mono uppercase
                  ${state.isRealMode ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                  {state.isRealMode ? "LIVE REAL TRADING" : "VIRTUAL PAPER MODE"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => updateSettings({ isRealMode: false })}
                  className={`py-2 rounded font-mono text-xs font-bold transition-all cursor-pointer border outline-none
                    ${!state.isRealMode
                      ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                      : "bg-[#040811] border-slate-800 text-slate-500 hover:text-slate-350"
                    }`}
                >
                  PAPER MODE
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => updateSettings({ isRealMode: true })}
                  className={`py-2 rounded font-mono text-xs font-bold transition-all cursor-pointer border outline-none
                    ${state.isRealMode
                      ? "bg-rose-500/10 border-rose-500/40 text-rose-400"
                      : "bg-[#040811] border-slate-800 text-slate-500 hover:text-slate-350"
                    }`}
                >
                  LIVE FYERS
                </button>
              </div>

              {state.isRealMode && (
                <div className="flex gap-2 p-2 rounded bg-rose-500/5 border border-rose-500/20 text-[10px] text-rose-400 font-mono">
                  <AlertTriangle size={16} className="flex-shrink-0" />
                  <span>
                    <strong>Caution:</strong> Live Fyers Mode is enabled. Breakouts will place real buy and sell orders using your connected Fyers API credentials.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Column: Index Live Monitors ────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["NIFTY", "BANKNIFTY", "SENSEX"] as const).map((indexName) => {
              const idxState = state.indices[indexName];
              const livePrice = getLiveOptionPrice(indexName, idxState.activeTradeStrike, idxState.activeTradeDirection);
              const pnlPoints = idxState.activeTradeEntryPrice && livePrice > 0
                ? livePrice - idxState.activeTradeEntryPrice
                : 0;
              const totalPnl = pnlPoints * (idxState.activeTradeQty || 0);

              return (
                <div
                  key={indexName}
                  className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-4 flex flex-col justify-between h-72 shadow-md relative"
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                      <span className="text-sm font-black text-white tracking-widest">{indexName}</span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase
                        ${idxState.rangeEstablished ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                        {idxState.rangeEstablished ? "Range Established" : "Calculating Range"}
                      </span>
                    </div>

                    {/* Range Levels Grid */}
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs font-mono">
                      <div className="bg-[#040811] p-2 rounded border border-slate-900/60">
                        <div className="text-[9px] text-slate-500 font-black uppercase">Range High</div>
                        <div className="text-white font-bold text-sm mt-0.5">
                          {idxState.high > 0 ? `₹${idxState.high.toFixed(0)}` : "Calculating..."}
                        </div>
                      </div>
                      <div className="bg-[#040811] p-2 rounded border border-slate-900/60">
                        <div className="text-[9px] text-slate-500 font-black uppercase">Range Low</div>
                        <div className="text-white font-bold text-sm mt-0.5">
                          {idxState.low > 0 ? `₹${idxState.low.toFixed(0)}` : "Calculating..."}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Active Trade Box */}
                  <div className="flex-1 flex flex-col justify-center my-3">
                    {idxState.activeTradeId ? (
                      <div className="bg-[#040811]/60 border border-slate-800/40 rounded p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded tracking-wider uppercase font-mono
                            ${idxState.activeTradeDirection === "BUY_CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                            {idxState.activeTradeDirection}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono font-bold">
                            Strike: {idxState.activeTradeStrike}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black">Entry Price</span>
                            <div className="text-white font-bold">₹{idxState.activeTradeEntryPrice?.toFixed(1)}</div>
                          </div>
                          <div>
                            <span className="text-[9px] text-slate-500 uppercase font-black">Current LTP</span>
                            <div className="text-white font-bold">₹{livePrice > 0 ? livePrice.toFixed(1) : "Fetching..."}</div>
                          </div>
                        </div>

                        {/* Live ticking PNL */}
                        {livePrice > 0 && (
                          <div className="pt-1.5 border-t border-slate-900 flex items-center justify-between">
                            <span className="text-[9px] text-slate-500 font-black uppercase">Live P&L</span>
                            <span className={`text-xs font-black font-mono
                              ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toFixed(0)} ({pnlPoints >= 0 ? "+" : ""}{pnlPoints.toFixed(1)} pts)
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-600 gap-1.5">
                        <Activity size={18} className="animate-pulse" />
                        <span className="text-[10px] font-mono uppercase tracking-wider">Awaiting Breakout Signal</span>
                      </div>
                    )}
                  </div>

                  {/* Card Footer Status */}
                  <div className="border-t border-slate-900 pt-2 flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>Traded Today</span>
                    {idxState.tradedToday ? (
                      <span className="text-emerald-400 flex items-center gap-1 font-bold">
                        <CheckCircle size={11} fill="currentColor" className="text-[#040811]" /> YES
                      </span>
                    ) : (
                      <span className="text-slate-600 font-bold">NO</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick instructions alert */}
          <div className="bg-[#060d1a] border border-slate-800/60 rounded-lg p-4 flex gap-3 text-xs text-slate-400 font-mono">
            <CheckCircle size={20} className="text-indigo-500 flex-shrink-0" />
            <div className="space-y-1">
              <span className="text-white font-bold uppercase tracking-wider block">ORB Naked Auto-Trading Rules:</span>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>System calculates High/Low between 09:15 AM and 09:30 AM IST automatically.</li>
                <li>Post 09:30 AM, if index price trades above range High, CE is purchased. If below range Low, PE is purchased.</li>
                <li>Each index takes exactly 1 trade per session to prevent churn.</li>
                <li>Positions are dynamically monitored and automatically exit when Target or SL premium points are reached, or at 3:25 PM IST.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ORBAutomationTab;
