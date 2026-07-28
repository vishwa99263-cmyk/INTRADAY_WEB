/**
 * TradeJournal.tsx — Upgraded: DOUBLE FONT SIZES (Super Large) | Paper + Real + Swing | Strategy Stats
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FileText, Download, RefreshCw, TrendingUp, TrendingDown, Award, BarChart2, Zap, Layers, Circle, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import TradeDetailsModal from "../shared/TradeDetailsModal";

interface Props { activePage: string; socket?: any; }

interface Trade {
  id: string; timestamp: number; instrument: string; direction: string;
  strike: number; entry_price: number; exit_price?: number; qty: number;
  lot_size: number; stop_loss: number; target: number; status: string;
  pnl: number; notes: string;
  strategyName?: string; scalpType?: string; signal_ref?: string;
  confidence?: number; source?: "PAPER" | "REAL"; trade_type?: string;
  oiBrainScore?: number; oiBrainGrade?: string; exit_reason?: string;
  livePrice?: number; closed_at?: number;
}

interface StrategyStats {
  name: string; trades: number; wins: number; losses: number;
  winRate: number; totalPnl: number; avgPnl: number;
  bestTrade: number; worstTrade: number;
}

const getApiUrl = (p: string) => (window.location.port === "5173" ? "http://localhost:3000" : "") + p;
const fmt = (n: number) => (n >= 0 ? "+" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (ts: number) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

type DateFilter = "TODAY" | "WEEK" | "ALL";
type SourceFilter = "ALL" | "PAPER" | "REAL" | "SWING";

const TradeJournal: React.FC<Props> = ({ activePage, socket }) => {
  const [trades, setTrades]           = useState<Trade[]>([]);
  const [loading, setLoading]         = useState(false);
  const [dateFilter, setDateFilter]   = useState<DateFilter>("ALL");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [instrFilter, setInstrFilter] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<"log" | "stats">("log");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [paperRes, realRes] = await Promise.all([
        fetch(getApiUrl("/api/te/paper-trades?limit=500")),
        fetch(getApiUrl("/api/real-trades")),
      ]);
      const paperData = paperRes.ok ? await paperRes.json() : { trades: [] };
      const realData  = realRes.ok  ? await realRes.json()  : { trades: [] };

      const paperTrades: Trade[] = (paperData.trades || []).map((t: any) => {
        const notes = (() => { try { return JSON.parse(t.notes || "{}"); } catch { return {}; } })();
        return {
          ...t,
          source: "PAPER" as const,
          strategyName: t.strategyName || notes.strategyName || notes.scalpType || "AUTO",
          scalpType: t.scalpType || notes.scalpType,
          confidence: t.confidence || notes.confidence,
          trade_type: notes.trade_type || "INTRADAY",
          exit_reason: notes.exit_reason,
        };
      });

      const realTrades: Trade[] = (realData.trades || []).map((t: any) => ({
        id: `real-${t.id}`, timestamp: t.opened_at || t.entryTime || t.created_at || Date.now(),
        instrument: t.instrument, direction: t.direction,
        strike: t.strike || 0, entry_price: t.entryPrice || t.entry_price || 0,
        exit_price: t.exitPrice  || t.exit_price,
        qty: t.qty || 1, lot_size: t.lotSize || t.lot_size || 1,
        stop_loss: 0, target: 0,
        status: t.status || "CLOSED", pnl: t.pnl || 0,
        notes: "", source: "REAL" as const,
        strategyName: t.strategyName || "FYERS REAL",
        trade_type: t.tradeType || "INTRADAY",
        oiBrainScore: t.oiBrainScore, oiBrainGrade: t.oiBrainGrade,
        closed_at: t.closedAt || t.closed_at,
        livePrice: t.live_ltp || t.liveLtp || t.livePrice,
      }));

      setTrades([...realTrades, ...paperTrades].sort((a, b) => b.timestamp - a.timestamp));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => load();
    socket.on("trade-update", refresh);
    socket.on("real-trade-update", refresh);
    socket.on("paper-trade-opened", refresh);
    socket.on("paper-trade-closed", refresh);
    return () => {
      socket.off("trade-update", refresh);
      socket.off("real-trade-update", refresh);
      socket.off("paper-trade-opened", refresh);
      socket.off("paper-trade-closed", refresh);
    };
  }, [socket, load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    trades.forEach(t => { if (t.strategyName) set.add(t.strategyName); });
    return ["ALL", ...Array.from(set)];
  }, [trades]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return trades.filter(t => {
      if (dateFilter === "TODAY") {
        const today = new Date().toDateString();
        const openedToday = new Date(t.timestamp).toDateString() === today;
        const closedToday = t.closed_at ? new Date(t.closed_at).toDateString() === today : false;
        if (!openedToday && !closedToday) return false;
      }
      if (dateFilter === "WEEK") {
        const weekAgo = now - 7 * 86400000;
        const openedThisWeek = t.timestamp >= weekAgo;
        const closedThisWeek = t.closed_at ? t.closed_at >= weekAgo : false;
        if (!openedThisWeek && !closedThisWeek) return false;
      }
      if (sourceFilter === "PAPER" && t.source !== "PAPER") return false;
      if (sourceFilter === "REAL"  && t.source !== "REAL")  return false;
      if (sourceFilter === "SWING" && t.trade_type !== "POSITIONAL") return false;
      if (instrFilter !== "ALL" && t.instrument !== instrFilter) return false;
      if (selectedCategory !== "ALL" && t.strategyName !== selectedCategory) return false;
      return true;
    }).sort((a, b) => b.timestamp - a.timestamp);
  }, [trades, dateFilter, sourceFilter, instrFilter, selectedCategory]);

  const stats = useMemo(() => {
    const closed = filtered.filter(t => t.status === "CLOSED");
    const wins = closed.filter(t => t.pnl > 0).length;
    const totalPnl = closed.reduce((a, t) => a + t.pnl, 0);
    const realCount = filtered.filter(t => t.source === "REAL").length;
    const swingCount = filtered.filter(t => t.trade_type === "POSITIONAL").length;
    return { total: filtered.length, closed: closed.length, wins, winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0, totalPnl, realCount, swingCount };
  }, [filtered]);

  const strategyStats: StrategyStats[] = useMemo(() => {
    const map: Record<string, StrategyStats & { closedTrades: number }> = {};
    const statsFiltered = trades.filter(t => {
      const now = Date.now();
      if (dateFilter === "TODAY") {
        const today = new Date().toDateString();
        const openedToday = new Date(t.timestamp).toDateString() === today;
        const closedToday = t.closed_at ? new Date(t.closed_at).toDateString() === today : false;
        if (!openedToday && !closedToday) return false;
      }
      if (dateFilter === "WEEK") {
        const weekAgo = now - 7 * 24 * 3600 * 1000;
        const openedThisWeek = t.timestamp >= weekAgo;
        const closedThisWeek = t.closed_at ? t.closed_at >= weekAgo : false;
        if (!openedThisWeek && !closedThisWeek) return false;
      }
      if (sourceFilter === "PAPER" && t.source !== "PAPER") return false;
      if (sourceFilter === "REAL"  && t.source !== "REAL")  return false;
      if (sourceFilter === "SWING" && t.trade_type !== "POSITIONAL") return false;
      if (instrFilter !== "ALL" && t.instrument !== instrFilter) return false;
      if (selectedCategory !== "ALL" && t.strategyName !== selectedCategory) return false;
      return true;
    });

    statsFiltered.forEach(t => {
      const name = t.strategyName || "AUTO";
      if (!map[name]) {
        map[name] = {
          name,
          trades: 0,
          closedTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          totalPnl: 0,
          avgPnl: 0,
          bestTrade: -Infinity,
          worstTrade: Infinity
        };
      }
      const s = map[name];
      s.trades++;

      const isClosed = t.status === "CLOSED";
      const isReal = t.source === "REAL";
      const units = isReal ? (t.qty ?? 1) : (t.qty ?? 1) * (t.lot_size ?? 1);
      const p = isClosed 
        ? (t.pnl ?? 0) 
        : ((t.livePrice ?? t.entry_price) - t.entry_price) * units;

      s.totalPnl += p;

      if (isClosed) {
        s.closedTrades++;
        if (p > 0) s.wins++; else s.losses++;
        s.bestTrade = Math.max(s.bestTrade, p);
        s.worstTrade = Math.min(s.worstTrade, p);
      }
    });

    return Object.values(map).map(({ closedTrades, ...s }) => {
      const winRate = closedTrades > 0 ? (s.wins / closedTrades) * 100 : 0;
      const avgPnl = s.trades > 0 ? s.totalPnl / s.trades : 0;
      return { ...s, winRate, avgPnl };
    }).sort((a, b) => b.totalPnl - a.totalPnl);
  }, [trades, dateFilter, sourceFilter, instrFilter, selectedCategory]);

  const exportCSV = () => {
    const headers = ["Source", "Time", "Instrument", "Strategy", "Direction", "Strike", "Entry", "Exit", "Qty×Lot", "P&L", "Status", "OI Brain", "Exit Reason"];
    const rows = filtered.map(t => [
      t.source, fmtDate(t.timestamp), t.instrument, t.strategyName, t.direction,
      t.strike, t.entry_price, t.exit_price ?? "", `${t.qty}×${t.lot_size}`,
      t.pnl, t.status, t.oiBrainScore ? `${t.oiBrainScore}/100` : "", t.exit_reason ?? ""
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `trade_journal_${Date.now()}.csv`; a.click();
  };

  const gradeBg = (g?: string) => ({ STRONG: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", GOOD: "bg-blue-500/20 text-blue-400 border-blue-500/30", OK: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", BLOCK: "bg-red-500/20 text-red-400 border-red-500/30" }[g || ""] || "bg-slate-700 text-slate-400");

  return (
    <div className="p-8 space-y-8" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Header (Double Size) */}
      <div className="flex items-center justify-between flex-wrap gap-5">
        <div>
          <h1 className="text-4xl font-black text-white flex items-center gap-3">
            <FileText size={36} className="text-indigo-400" /> Trade Journal
          </h1>
          <p className="text-lg text-slate-400 mt-2">Paper + Real + Swing — sab ek jagah · Strategy performance analysis</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={load} className="p-3.5 rounded-xl border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer">
            <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={exportCSV} className="flex items-center gap-3 px-6 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-base font-black transition-colors cursor-pointer border border-slate-700 shadow-lg">
            <Download size={20} /> CSV Export
          </button>
        </div>
      </div>

      {/* Summary Stats Cards (Double Size) */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { l: "Total P&L",   v: fmt(stats.totalPnl),              c: stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400" },
          { l: "Win Rate",    v: `${stats.winRate.toFixed(1)}%`,    c: stats.winRate >= 50 ? "text-emerald-400" : "text-orange-400" },
          { l: "Total Trades",v: stats.total,                       c: "text-white" },
          { l: "Wins",        v: stats.wins,                        c: "text-emerald-400" },
          { l: "Real Trades", v: stats.realCount,                   c: "text-violet-400" },
          { l: "Swing Trades",v: stats.swingCount,                  c: "text-orange-400" },
        ].map(({ l, v, c }) => (
          <div key={l} className="bg-[#0d1117] border border-slate-800/80 rounded-2xl p-5 flex flex-col gap-2 shadow-md">
            <div className="text-sm text-slate-400 font-bold uppercase tracking-wider">{l}</div>
            <div className={`text-3xl font-black ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      {/* Main Tabs Container */}
      <div className="bg-[#0d1117] border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex border-b border-slate-800/60 bg-[#161b22]/40">
          {(["log", "stats"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-8 py-5 text-lg font-black transition-colors ${activeTab === t ? "text-indigo-400 border-b-2 border-indigo-500 bg-[#1f242c]/40" : "text-slate-400 hover:text-slate-200"}`}>
              {t === "log" ? "📋 Trade Log" : "📊 Strategy Stats"}
            </button>
          ))}
        </div>

        {/* Filters Panel (Large Text & Spacing) */}
        <div className="p-5 flex flex-wrap gap-4 border-b border-slate-800/50 items-center bg-[#090d16]">
          {/* Date Filter */}
          <div className="flex gap-2">
            {(["TODAY","WEEK","ALL"] as DateFilter[]).map(f => (
              <button key={f} onClick={() => setDateFilter(f)}
                className={`px-5 py-2.5 rounded-lg text-sm font-black cursor-pointer transition-colors ${dateFilter === f ? "bg-indigo-600 text-white shadow-md" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>{f}</button>
            ))}
          </div>
          {/* Source Filter */}
          <div className="flex gap-2">
            {(["ALL","PAPER","REAL","SWING"] as SourceFilter[]).map(f => (
              <button key={f} onClick={() => setSourceFilter(f)}
                className={`px-5 py-2.5 rounded-lg text-sm font-black cursor-pointer transition-colors ${sourceFilter === f
                  ? f === "REAL" ? "bg-violet-600 text-white shadow-md" : f === "SWING" ? "bg-orange-600 text-white shadow-md" : "bg-slate-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>{f}</button>
            ))}
          </div>
          {/* Instrument Filter */}
          <div className="flex gap-2">
            {["ALL","NIFTY","BANKNIFTY","SENSEX"].map(f => (
              <button key={f} onClick={() => setInstrFilter(f)}
                className={`px-5 py-2.5 rounded-lg text-sm font-black cursor-pointer transition-colors ${instrFilter === f ? "bg-emerald-700 text-white shadow-md" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>{f}</button>
            ))}
          </div>
          {/* Strategy Dropdown */}
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm text-slate-400 font-black">Filter Strategy:</span>
            <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-100 text-sm font-bold rounded-xl px-4 py-2.5 outline-none cursor-pointer">
              {categories.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
            </select>
          </div>
        </div>

        {/* Trade Log Tab (Double Sized Rows & Fonts) */}
        {activeTab === "log" && (
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(100vh - 420px)" }}>
            <table className="w-full text-base">
              <thead className="sticky top-0 bg-[#0d1117] z-10 border-b border-slate-800/40">
                <tr className="text-sm text-slate-400 uppercase font-black bg-[#101520] tracking-wider">
                  {["Src","Instr","Strategy","Direction","Entry Price","Exit Price","P&L","Status","Time","OI Brain",""].map((h, i) => (
                    <th key={i} className="p-4 pl-5 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {filtered.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-20 text-slate-500 text-lg font-bold">No trades found for these filters.</td></tr>
                ) : filtered.map(t => {
                  const isWin  = t.pnl > 0;
                  const isOpen = t.status === "OPEN";
                  const isReal = t.source === "REAL";
                  const isSwing = t.trade_type === "POSITIONAL";
                  const exp = expandedId === t.id;
                  return (
                    <React.Fragment key={t.id}>
                      <tr onClick={() => setExpandedId(exp ? null : t.id)}
                        className={`hover:bg-slate-800/30 transition-all cursor-pointer border-b border-slate-800/30 text-base font-medium ${isReal ? "border-l-4 border-l-violet-500 bg-violet-950/10" : isSwing ? "border-l-4 border-l-orange-500 bg-orange-950/10" : ""}`}>
                        {/* Source */}
                        <td className="p-4 pl-5">
                          <span className={`px-3.5 py-1.5 rounded-lg text-xs font-black tracking-widest ${isReal ? "bg-violet-500/20 text-violet-300 border border-violet-500/40" : isSwing ? "bg-orange-500/20 text-orange-300 border border-orange-500/40" : "bg-slate-700/60 text-slate-300"}`}>
                            {isReal ? "REAL" : isSwing ? "SWING" : "PAPER"}
                          </span>
                        </td>
                        {/* Instrument */}
                        <td className="p-4">
                          <span className={`text-xs font-black px-3 py-1.5 rounded-lg border ${t.instrument === "NIFTY" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : t.instrument === "BANKNIFTY" ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "bg-orange-500/20 text-orange-300 border-orange-500/30"}`}>
                            {t.instrument}
                          </span>
                        </td>
                        {/* Strategy */}
                        <td className="p-4 max-w-[200px]">
                          <div className="text-slate-100 font-extrabold truncate text-base">{t.strategyName || "AUTO"}</div>
                          {t.scalpType && <div className="text-xs text-slate-500 truncate mt-1">{t.scalpType}</div>}
                        </td>
                        {/* Direction */}
                        <td className="p-4">
                          <span className={`flex items-center gap-1.5 font-black text-base ${t.direction === "BUY_CE" ? "text-red-400" : "text-emerald-400"}`}>
                            {t.direction === "BUY_CE" ? <TrendingDown size={18}/> : <TrendingUp size={18}/>}
                            {t.direction === "BUY_CE" ? "CE" : "PE"}
                          </span>
                        </td>
                        {/* Entry Price */}
                        <td className="p-4 font-mono font-bold text-white text-base">₹{t.entry_price.toFixed(1)}</td>
                        {/* Exit Price */}
                        <td className="p-4 font-mono text-slate-200 text-base">
                          {isOpen ? <span className="text-blue-400 font-extrabold">₹{(t.livePrice ?? t.entry_price).toFixed(1)} <span className="text-xs bg-blue-500/20 px-2 py-0.5 rounded-md ml-1">LIVE</span></span>
                                  : t.exit_price ? `₹${t.exit_price.toFixed(1)}` : "—"}
                        </td>
                        {/* P&L */}
                        <td className="p-4">
                          <span className={`font-black font-mono text-base ${isOpen ? "text-blue-400" : isWin ? "text-emerald-400" : "text-red-400"}`}>
                            {isOpen ? "OPENING" : fmt(t.pnl)}
                          </span>
                        </td>
                        {/* Status */}
                        <td className="p-4">
                          {isOpen
                            ? <span className="flex items-center gap-2 text-blue-400 text-sm font-extrabold"><Circle size={10} className="fill-current animate-pulse"/> OPEN</span>
                            : <span className={`flex items-center gap-1.5 text-xs font-black tracking-wider ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                                {isWin ? <CheckCircle size={15}/> : <XCircle size={15}/>}{isWin ? "WIN" : "LOSS"}
                              </span>}
                        </td>
                        {/* Time */}
                        <td className="p-4 text-slate-400 whitespace-nowrap text-sm">{fmtDate(t.timestamp)}</td>
                        {/* OI Brain */}
                        <td className="p-4">
                          {t.oiBrainScore !== undefined
                            ? <span className={`px-3 py-1 rounded-lg text-xs font-black border ${gradeBg(t.oiBrainGrade)}`}>{t.oiBrainScore}/100</span>
                            : <span className="text-sm text-slate-600">—</span>}
                        </td>
                        <td className="p-4">{exp ? <ChevronUp size={20} className="text-slate-500"/> : <ChevronDown size={20} className="text-slate-500"/>}</td>
                      </tr>
                      {exp && (
                        <tr className="bg-slate-900/50">
                          <td colSpan={11} className="px-6 py-4 border-b border-slate-800/40">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                              <div><span className="text-slate-500 font-bold">Strike Price:</span> <span className="text-white font-extrabold">{t.strike ? t.strike.toLocaleString("en-IN") : "—"}</span></div>
                              <div><span className="text-slate-500 font-bold">Qty × Lot:</span> <span className="text-white font-extrabold">{t.qty} × {t.lot_size} = {t.qty * t.lot_size} units</span></div>
                              <div><span className="text-slate-500 font-bold">Confidence:</span> <span className="text-white font-extrabold">{t.confidence ? `${t.confidence}%` : "—"}</span></div>
                              <div><span className="text-slate-500 font-bold">Trade Type:</span> <span className="text-white font-extrabold">{t.trade_type || "INTRADAY"}</span></div>
                              <div><span className="text-slate-500 font-bold">Exit Reason:</span> <span className="text-amber-400 font-black">{t.exit_reason || "—"}</span></div>
                              <div><span className="text-slate-500 font-bold">Closed Time:</span> <span className="text-white font-extrabold">{fmtDate(t.closed_at || 0)}</span></div>
                              <div><span className="text-slate-500 font-bold">Execution Mode:</span> <span className={isReal ? "text-violet-400 font-black text-sm" : "text-slate-400 font-bold"}>{isReal ? "✅ Fyers Real Execution" : "📄 Paper Trade Mode"}</span></div>
                              <div><span className="text-slate-500 font-bold">OI Brain Result:</span> <span className="text-white font-extrabold">{t.oiBrainScore !== undefined ? `${t.oiBrainScore}/100 (${t.oiBrainGrade})` : "Not evaluated"}</span></div>
                              <div className="col-span-2 flex gap-4 mt-2">
                                <button onClick={() => setSelectedTrade(t)} className="px-5 py-2.5 bg-indigo-600/20 text-indigo-400 rounded-xl text-xs font-black hover:bg-indigo-600/30 cursor-pointer border border-indigo-500/30 transition-all shadow-md">View Indicators Audit</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <div className="px-6 py-4 border-t border-slate-800/40 flex justify-between text-sm md:text-base text-slate-400 bg-[#0c101a]">
              <span>Showing <b>{stats.total}</b> trades · {stats.closed} closed · {stats.realCount} real · {stats.swingCount} swing</span>
              <span className={`font-black text-base md:text-lg ${stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>Net Profit/Loss: {fmt(stats.totalPnl)}</span>
            </div>
          </div>
        )}

        {/* Strategy Stats Tab (Double Sized Metrics) */}
        {activeTab === "stats" && (
          <div className="p-6 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 420px)" }}>
            <div className="flex items-center gap-2 mb-5">
              <BarChart2 size={24} className="text-indigo-400"/>
              <span className="text-base font-extrabold text-white">Strategy Performance Audit</span>
              <span className="text-sm text-slate-500">· Sorted by profitability (best to worst)</span>
            </div>
            {strategyStats.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-base">No trades recorded yet for these filters.</div>
            ) : strategyStats.map((s, i) => {
              const isProfit = s.totalPnl >= 0;
              const badge = s.winRate >= 65 ? "⭐ BEST PERFORMING" : s.winRate >= 50 ? "✓ CONSISTENT" : s.winRate >= 40 ? "~ MODERATE" : "✗ REVIEW STRATEGY";
              const badgeC = s.winRate >= 65 ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30" : s.winRate >= 50 ? "text-blue-400 bg-blue-500/10 border border-blue-500/30" : s.winRate >= 40 ? "text-yellow-400 bg-yellow-500/10 border border-yellow-500/30" : "text-red-400 bg-red-500/10 border border-red-500/30";
              return (
                <div key={s.name} className="bg-[#08101a] border border-slate-800/80 rounded-2xl p-5 shadow-md hover:border-slate-700 transition-all">
                  <div className="flex items-center justify-between gap-5 flex-wrap">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl text-sm font-black flex items-center justify-center ${i === 0 ? "bg-yellow-500/20 text-yellow-400" : i === 1 ? "bg-slate-400/20 text-slate-300" : "bg-slate-700/50 text-slate-500"}`}>{i + 1}</div>
                      <div>
                        <div className="text-white text-base md:text-lg font-black">{s.name}</div>
                        <div className="text-xs text-slate-500 mt-1 font-semibold">{s.trades} trades executed</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 flex-wrap">
                      <div>
                        <div className="text-xs text-slate-500 mb-1.5 font-bold">Win Rate</div>
                        <div className="flex items-center gap-3">
                          <div className="w-32 h-2.5 rounded-full bg-slate-800 border border-slate-750 overflow-hidden">
                            <div className={`h-full rounded-full ${s.winRate >= 60 ? "bg-emerald-500" : s.winRate >= 45 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, s.winRate)}%` }}/>
                          </div>
                          <span className={`text-xs font-black ${s.winRate >= 60 ? "text-emerald-400" : s.winRate >= 45 ? "text-yellow-400" : "text-red-400"}`}>{s.winRate.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="text-xs text-center"><div className="text-slate-500 font-bold">W/L Ratio</div><div className="font-extrabold text-slate-200 mt-0.5"><span className="text-emerald-400">{s.wins}</span> / <span className="text-red-400">{s.losses}</span></div></div>
                      <div className="text-xs text-center"><div className="text-slate-500 font-bold">Avg PnL</div><div className={`font-extrabold mt-0.5 ${s.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(s.avgPnl)}</div></div>
                      <div className="text-xs text-center"><div className="text-slate-500 font-bold">Best</div><div className="text-emerald-400 font-bold mt-0.5">{fmt(s.bestTrade === -Infinity ? 0 : s.bestTrade)}</div></div>
                      <div className="text-xs text-center"><div className="text-slate-500 font-bold">Worst</div><div className="text-red-400 font-bold mt-0.5">{fmt(s.worstTrade === Infinity ? 0 : s.worstTrade)}</div></div>
                      <div className="text-xs text-center"><div className="text-slate-500 font-bold">Net Profit</div><div className={`font-black text-sm md:text-base mt-0.5 ${isProfit ? "text-emerald-400" : "text-red-400"}`}>{fmt(s.totalPnl)}</div></div>
                      <span className={`px-4 py-1.5 rounded-full text-xs font-black tracking-wider ${badgeC}`}>{badge}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedTrade && <TradeDetailsModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} />}
    </div>
  );
};

export default TradeJournal;
