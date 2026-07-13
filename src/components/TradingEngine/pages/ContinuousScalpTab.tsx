/**
 * ContinuousScalpTab.tsx — IQ200+ Continuous Scalping Engine Dashboard
 *
 * 20,000 capital, non-stop data-driven scalping, real-time P&L, all live data.
 * Displays: Capital card, Live trades, Trade history, Signal debug panel.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CSTradeRecord {
  id: string;
  timestamp: number;
  instrument: string;
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  entry_price: number;
  qty: number;
  lot_size: number;
  stop_loss: number;
  target: number;
  exit_price?: number;
  status: "OPEN" | "CLOSED";
  pnl: number;
  closed_at?: number;
  tier: "MICRO" | "NORMAL" | "STRONG";
  reason: string;
  score_at_entry: number;
  momentum_at_entry: number;
  pcr_at_entry: number;
}

interface CSCapital {
  total: number;
  used: number;
  free: number;
  todayPnl: number;
  totalPnl: number;
  tradesCount: number;
  winCount: number;
  lossCount: number;
}

interface Props {
  socket: Socket | null;
  activePage: string;
}

const TIER_COLOR = {
  MICRO:  { bg: "bg-blue-500/15",   border: "border-blue-500/30",   text: "text-blue-400",   badge: "bg-blue-500/20 text-blue-300"   },
  NORMAL: { bg: "bg-amber-500/15",  border: "border-amber-500/30",  text: "text-amber-400",  badge: "bg-amber-500/20 text-amber-300"  },
  STRONG: { bg: "bg-emerald-500/15",border: "border-emerald-500/30",text: "text-emerald-400",badge: "bg-emerald-500/20 text-emerald-300"},
};

const DIR_COLOR = {
  BUY_CE: { text: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  BUY_PE: { text: "text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/30"    },
};

const ContinuousScalpTab: React.FC<Props> = ({ socket, activePage }) => {
  const [openTrades, setOpenTrades]   = useState<CSTradeRecord[]>([]);
  const [closedTrades, setClosedTrades] = useState<CSTradeRecord[]>([]);
  const [capital, setCapital]         = useState<CSCapital | null>(null);
  const [isLive, setIsLive]           = useState(false);
  const [lastUpdate, setLastUpdate]   = useState<Date | null>(null);
  const [clearing, setClearing]       = useState(false);
  const [livePremiums, setLivePremiums] = useState<Record<string, number>>({});
  const [now, setNow]                 = useState(new Date());
  
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const livePnlRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Fetch trades + capital ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [tradesRes, capRes] = await Promise.all([
        fetch("/api/cs-trades"),
        fetch("/api/cs-capital"),
      ]);
      if (tradesRes.ok) {
        const d = await tradesRes.json();
        setOpenTrades(d.open || []);
        setClosedTrades((d.closed || []).slice(0, 100));
        setIsLive(true);
        setLastUpdate(new Date());
      }
      if (capRes.ok) {
        const c = await capRes.json();
        setCapital(c);
      }
    } catch (e) {
      setIsLive(false);
    }
  }, []);

  // ── Socket listeners for real-time updates ────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onOpened  = (_trade: CSTradeRecord) => { fetchData(); };
    const onClosed  = (_data: any) => { fetchData(); };
    const onSlUpd   = (_data: any) => { fetchData(); };

    socket.on("cs-trade-opened",    onOpened);
    socket.on("cs-trade-closed",    onClosed);
    socket.on("cs-trade-sl-updated",onSlUpd);

    return () => {
      socket.off("cs-trade-opened",    onOpened);
      socket.off("cs-trade-closed",    onClosed);
      socket.off("cs-trade-sl-updated",onSlUpd);
    };
  }, [socket, fetchData]);

  // ── Poll every 3 seconds ──────────────────────────────────────────────────
  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(fetchData, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  // ── Clear all trades ──────────────────────────────────────────────────────
  const handleClear = async () => {
    if (!confirm("Clear ALL continuous scalp trades? This cannot be undone.")) return;
    setClearing(true);
    try {
      await fetch("/api/cs-clear", { method: "POST" });
      await fetchData();
    } finally {
      setClearing(false);
    }
  };

  // ── Derived stats ─────────────────────────────────────────────────────────
  const winRate = capital && (capital.winCount + capital.lossCount) > 0
    ? (capital.winCount / (capital.winCount + capital.lossCount) * 100).toFixed(1)
    : "—";

  const todayClosedTrades = closedTrades.filter(t => {
    if (!t.closed_at) return false;
    const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    return new Date(t.closed_at + 5.5 * 3600 * 1000).toISOString().slice(0, 10) === todayIST;
  });

  const todayWins   = todayClosedTrades.filter(t => (t.pnl || 0) > 0).length;
  const todayLosses = todayClosedTrades.filter(t => (t.pnl || 0) < 0).length;

  // ── Live P&L for open trades (using entry/SL/target to estimate) ──────────
  const openPnl = openTrades.reduce((sum, t) => {
    const currentPrice = livePremiums[t.id] ?? t.entry_price;
    return sum + (currentPrice - t.entry_price) * t.qty * t.lot_size;
  }, 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#040811] text-white p-4 gap-4 overflow-y-auto">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.4)]">
              <span className="text-white text-sm font-black">⚡</span>
            </div>
            <div>
              <h1 className="text-lg font-black text-white tracking-wide">
                Continuous Scalp Engine
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                Pure data-driven · 20,000 capital · Non-stop all-day scalping
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Current Date & Time */}
          <div className="flex flex-col items-end mr-1 text-right border-r border-slate-700/50 pr-4">
            <span className="text-sm font-black text-indigo-400 tracking-wider font-mono">
              {now.toLocaleTimeString("en-IN", { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {now.toLocaleDateString("en-IN", { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>

          {/* Live indicator */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
            ${isLive ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-slate-700 text-slate-400"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            {isLive ? "LIVE" : "OFFLINE"}
          </div>

          {lastUpdate && (
            <span className="text-[11px] text-slate-600 font-mono">
              Updated {lastUpdate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}

          <button
            onClick={handleClear}
            disabled={clearing}
            className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold rounded-lg hover:bg-rose-500/20 transition-all disabled:opacity-50"
          >
            {clearing ? "Clearing..." : "🗑 Reset"}
          </button>
        </div>
      </div>

      {/* ── Capital Cards Row ─────────────────────────────────────────────── */}
      {capital && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Total Capital */}
          <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-1">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-bold">Total Capital</div>
            <div className={`text-xl font-black ${capital.total >= 20000 ? "text-emerald-400" : "text-rose-400"}`}>
              ₹{capital.total.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            </div>
            <div className="text-[11px] text-slate-500">Base: ₹20,000</div>
          </div>

          {/* Today P&L */}
          <div className={`border rounded-xl p-4 flex flex-col gap-1
            ${(capital.todayPnl || 0) >= 0
              ? "bg-emerald-500/10 border-emerald-500/25"
              : "bg-rose-500/10 border-rose-500/25"}`}>
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Today P&L</div>
            <div className={`text-xl font-black ${(capital.todayPnl || 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {(capital.todayPnl || 0) >= 0 ? "+" : ""}₹{(capital.todayPnl || 0).toFixed(0)}
            </div>
            <div className="text-[11px] text-slate-400">
              {todayWins}W / {todayLosses}L — {todayClosedTrades.length} trades today
            </div>
          </div>

          {/* Win Rate */}
          <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-1">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-bold">Win Rate</div>
            <div className={`text-xl font-black ${parseFloat(winRate as string) >= 50 ? "text-emerald-400" : "text-amber-400"}`}>
              {winRate}%
            </div>
            <div className="text-[11px] text-slate-500">
              {capital.winCount}W / {capital.lossCount}L · {capital.tradesCount} total
            </div>
          </div>

          {/* Free Capital */}
          <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-1">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-bold">Available</div>
            <div className="text-xl font-black text-indigo-400">
              ₹{capital.free.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            </div>
            <div className="text-[11px] text-slate-500">Used: ₹{capital.used.toFixed(0)}</div>
          </div>
        </div>
      )}

      {/* ── Open Positions ───────────────────────────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-800/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-black text-white">Open Positions</span>
            {openTrades.length > 0 && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-[11px] font-bold">
                {openTrades.length} LIVE
              </span>
            )}
          </div>
        </div>

        {openTrades.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-slate-500 text-sm">No open positions — engine scanning for entry...</div>
            <div className="text-slate-600 text-xs mt-1">Entry fires every 10-30 seconds when signal detected</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/40">
            {openTrades.map(trade => {
              const tier = TIER_COLOR[trade.tier] || TIER_COLOR.MICRO;
              const dir  = DIR_COLOR[trade.direction];
              const elapsed = Math.floor((Date.now() - trade.timestamp) / 60000);
              const progressPct = Math.max(0, Math.min(100,
                ((trade.entry_price - trade.stop_loss) > 0
                  ? ((trade.entry_price - trade.stop_loss) / (trade.target - trade.stop_loss)) * 100
                  : 50)
              ));

              return (
                <div key={trade.id} className={`p-4 ${tier.bg} border-l-2 ${tier.border}`}>
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Trade info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${tier.badge}`}>
                          {trade.tier}
                        </span>
                        <span className={`text-sm font-black ${dir.text}`}>
                          {trade.instrument} {trade.direction === "BUY_CE" ? "▲ CE" : "▼ PE"}
                        </span>
                        <span className="text-slate-400 text-xs font-mono">Strike: {trade.strike}</span>
                        <span className="text-slate-500 text-xs">{elapsed}m ago</span>
                      </div>

                      {/* Price levels */}
                      <div className="flex items-center gap-4 mt-2 text-xs font-mono">
                        <span className="text-slate-300">Entry: <span className="text-white font-bold">₹{trade.entry_price.toFixed(1)}</span></span>
                        <span className="text-emerald-400">Target: ₹{trade.target.toFixed(1)}</span>
                        <span className="text-rose-400">SL: ₹{trade.stop_loss.toFixed(1)}</span>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 rounded-full transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          Score: {trade.score_at_entry.toFixed(0)}
                        </span>
                      </div>
                    </div>

                    {/* Right: Lots */}
                    <div className="text-right text-xs text-slate-400">
                      <div className="text-slate-300 font-mono">1 lot × {trade.lot_size}</div>
                      <div className="text-slate-500 mt-0.5">PCR: {trade.pcr_at_entry.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Closed Trades Table ──────────────────────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-800/60 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
          <span className="text-sm font-black text-white">Trade History</span>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="text-emerald-400 font-bold">
              {todayWins}W
            </span>
            <span className="text-rose-400 font-bold">
              {todayLosses}L
            </span>
            <span className="text-slate-400">today</span>
          </div>
        </div>

        {closedTrades.length === 0 ? (
          <div className="p-6 text-center text-slate-600 text-sm">No trades yet — engine will start trading when market opens</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/60 text-slate-500 uppercase text-[11px] tracking-wider">
                  <th className="px-4 py-2 text-left font-bold">Time</th>
                  <th className="px-4 py-2 text-left font-bold">Instrument</th>
                  <th className="px-4 py-2 text-left font-bold">Direction</th>
                  <th className="px-4 py-2 text-right font-bold">Entry</th>
                  <th className="px-4 py-2 text-right font-bold">Exit</th>
                  <th className="px-4 py-2 text-right font-bold">P&L</th>
                  <th className="px-4 py-2 text-center font-bold">Tier</th>
                  <th className="px-4 py-2 text-left font-bold">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {closedTrades.map(trade => {
                  const pnl = trade.pnl || 0;
                  const dir = DIR_COLOR[trade.direction];
                  const tier = TIER_COLOR[trade.tier] || TIER_COLOR.MICRO;
                  const time = new Date(trade.timestamp + 5.5 * 3600 * 1000)
                    .toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

                  return (
                    <tr key={trade.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="px-4 py-2 font-mono text-slate-400">{time}</td>
                      <td className="px-4 py-2 font-semibold text-white">{trade.instrument}</td>
                      <td className="px-4 py-2">
                        <span className={`font-bold ${dir.text}`}>
                          {trade.direction === "BUY_CE" ? "▲ CE" : "▼ PE"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-300">₹{trade.entry_price.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-300">₹{(trade.exit_price ?? 0).toFixed(1)}</td>
                      <td className={`px-4 py-2 text-right font-black ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(0)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${tier.badge}`}>
                          {trade.tier}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-500 font-mono">{trade.score_at_entry.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Engine Info ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-900/40 border border-slate-800/40 rounded-xl p-4">
          <div className="text-[11px] text-slate-500 uppercase font-bold mb-2">🔵 MICRO Scalp</div>
          <div className="text-xs text-slate-300 space-y-1">
            <div>Signal score: <span className="text-blue-400 font-bold">25–50</span></div>
            <div>Target: <span className="text-emerald-400 font-bold">+6pt NIFTY / +8pt BNIFTY</span></div>
            <div>SL: <span className="text-rose-400 font-bold">-3pt NIFTY / -4pt BNIFTY</span></div>
            <div className="text-slate-500 text-[10px] pt-1">Fires every 10-15 seconds in range market</div>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/40 rounded-xl p-4">
          <div className="text-[11px] text-slate-500 uppercase font-bold mb-2">🟡 NORMAL Scalp</div>
          <div className="text-xs text-slate-300 space-y-1">
            <div>Signal score: <span className="text-amber-400 font-bold">50–75</span></div>
            <div>Target: <span className="text-emerald-400 font-bold">+11pt NIFTY / +14pt BNIFTY</span></div>
            <div>SL: <span className="text-rose-400 font-bold">-5pt NIFTY / -7pt BNIFTY</span></div>
            <div className="text-slate-500 text-[10px] pt-1">Fires when PCR + momentum align</div>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/40 rounded-xl p-4">
          <div className="text-[11px] text-slate-500 uppercase font-bold mb-2">🟢 STRONG Trade</div>
          <div className="text-xs text-slate-300 space-y-1">
            <div>Signal score: <span className="text-emerald-400 font-bold">75+</span></div>
            <div>Target: <span className="text-emerald-400 font-bold">+18pt NIFTY / +22pt BNIFTY</span></div>
            <div>SL: <span className="text-rose-400 font-bold">-9pt NIFTY / -12pt BNIFTY</span></div>
            <div className="text-slate-500 text-[10px] pt-1">All signals aligned — high confidence entry</div>
          </div>
        </div>
      </div>

      {/* ── Signal Logic Explanation ─────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-slate-900/80 to-indigo-950/30 border border-indigo-500/20 rounded-xl p-4">
        <div className="text-sm font-bold text-indigo-300 mb-3">⚡ Engine Logic — How Signals Are Computed</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs text-slate-400">
          <div>
            <div className="text-slate-300 font-semibold mb-1">Weighted Stock Score (40pt)</div>
            <div>Primary signal from all 51 Nifty stocks combined weighted directional pressure</div>
          </div>
          <div>
            <div className="text-slate-300 font-semibold mb-1">Momentum (30pt)</div>
            <div>Score + direction from EMA/MACD/RSI + volume spike amplifier</div>
          </div>
          <div>
            <div className="text-slate-300 font-semibold mb-1">PCR (15pt)</div>
            <div>Put-Call ratio sentiment: high PCR = bullish floor, low PCR = bearish ceiling</div>
          </div>
          <div>
            <div className="text-slate-300 font-semibold mb-1">Buyer/Seller Pressure (10pt)</div>
            <div>Aggregated buyer vs. seller dominance from live order flow</div>
          </div>
          <div>
            <div className="text-slate-300 font-semibold mb-1">EMA + MACD (13pt)</div>
            <div>Bull/Bear stack + MACD crossover alignment</div>
          </div>
          <div>
            <div className="text-slate-300 font-semibold mb-1">Entry Rule</div>
            <div>Need ≥15pt gap between bull/bear scores AND total ≥25pt to fire trade</div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default ContinuousScalpTab;
