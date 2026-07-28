import React, { useState, useEffect, useCallback } from "react";
import {
  BookOpen, TrendingUp, TrendingDown, RefreshCw, Filter,
  Award, AlertTriangle, BarChart2, Layers, Activity,
  ChevronDown, ChevronUp, Circle, CheckCircle, XCircle,
  Zap, Target, ShieldOff, Clock, DollarSign, Search
} from "lucide-react";
import TradeDetailsModal from "./TradingEngine/shared/TradeDetailsModal";

interface TradeJournalProps {
  darkMode: boolean;
  socket?: any;
}

type TradeType = "ALL" | "PAPER" | "REAL" | "POSITIONAL";
type TradeStatus = "ALL" | "OPEN" | "CLOSED" | "FAILED";

interface JournalTrade {
  id: string;
  instrument: string;
  direction: "BUY_CE" | "BUY_PE";
  entry_price: number;
  exit_price?: number;
  pnl?: number;
  status: "OPEN" | "CLOSED" | "FAILED";
  strategyName?: string;
  scalpType?: string;
  confidence?: number;
  trade_type?: string; // INTRADAY / POSITIONAL
  source: "PAPER" | "REAL";
  entry_time?: number;
  closed_at?: number;
  qty?: number;
  lot_size?: number;
  strike?: number;
  oiBrainScore?: number;
  oiBrainGrade?: string;
  exit_reason?: string;
  livePrice?: number;
  notes?: string;
  stop_loss?: number;
  target?: number;
  signal_ref?: string;
}

interface StrategyStats {
  name: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}

const fmt = (n: number) => n >= 0 ? `+₹${n.toFixed(0)}` : `-₹${Math.abs(n).toFixed(0)}`;
const fmtTime = (ts?: number) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
};

export default function TradeJournal({ darkMode, socket }: TradeJournalProps) {
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<TradeType>("ALL");
  const [filterStatus, setFilterStatus] = useState<TradeStatus>("ALL");
  const [filterInstrument, setFilterInstrument] = useState("ALL");
  const [searchStrategy, setSearchStrategy] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<JournalTrade | null>(null);
  const [tab, setTab] = useState<"journal" | "strategy-stats">("journal");
  const [dateRange, setDateRange] = useState<"today" | "week" | "all">("all");

  const bg    = darkMode ? "bg-[#0d1117]" : "bg-gray-50";
  const card  = darkMode ? "bg-[#161b22] border-[#30363d]" : "bg-white border-gray-200";
  const text  = darkMode ? "text-gray-100" : "text-gray-900";
  const sub   = darkMode ? "text-gray-400" : "text-gray-500";
  const input = darkMode ? "bg-[#21262d] border-[#30363d] text-gray-100 placeholder-gray-500" : "bg-gray-50 border-gray-300 text-gray-900";

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const [paperRes, realRes] = await Promise.all([
        fetch("/api/te/paper-trades?limit=500"),
        fetch("/api/real-trades"),
      ]);

      const paperData = await paperRes.json();
      const realData  = await realRes.json();

      const paperTrades: JournalTrade[] = (paperData.trades || []).map((t: any) => {
        const notes = (() => { try { return JSON.parse(t.notes || "{}"); } catch { return {}; } })();
        return {
          id:           t.id,
          instrument:   t.instrument,
          direction:    t.direction,
          entry_price:  t.entry_price,
          exit_price:   t.exit_price,
          pnl:          t.pnl,
          status:       t.status,
          strategyName: t.strategyName || notes.strategyName || notes.scalpType || "AUTO",
          scalpType:    t.scalpType    || notes.scalpType,
          confidence:   t.confidence   || notes.confidence,
          trade_type:   notes.trade_type || "INTRADAY",
          source:       "PAPER",
          entry_time:   t.timestamp || t.created_at || Date.now(),
          closed_at:    t.closed_at || t.closedAt,
          qty:          t.qty,
          lot_size:     t.lot_size,
          strike:       t.strike,
          exit_reason:  notes.exit_reason,
          livePrice:    t.livePrice,
          notes:        t.notes,
          stop_loss:    t.stop_loss || 0,
          target:       t.target || 0,
          signal_ref:   t.signal_ref || "",
        };
      });

      const realTrades: JournalTrade[] = (realData.trades || []).map((t: any) => ({
        id:           `real-${t.id}`,
        instrument:   t.instrument,
        direction:    t.direction,
        entry_price:  t.entryPrice || t.entry_price,
        exit_price:   t.exitPrice  || t.exit_price,
        pnl:          t.pnl,
        status:       t.status || "CLOSED",
        strategyName: t.strategyName || "FYERS REAL",
        trade_type:   t.tradeType || "INTRADAY",
        source:       "REAL",
        entry_time:   t.opened_at || t.entryTime || t.created_at || Date.now(),
        closed_at:    t.closed_at || t.closedAt,
        oiBrainScore: t.oiBrainScore,
        oiBrainGrade: t.oiBrainGrade,
        notes:        t.notes,
        stop_loss:    t.stop_loss || 0,
        target:       t.target || 0,
        qty:          t.qty || 1,
        lot_size:     t.lot_size || t.lotSize || 1,
        strike:       t.strike || 0,
        signal_ref:   t.signal_ref || t.paperId || "",
        livePrice:    t.live_ltp || t.liveLtp || t.livePrice,
      }));

      // Merge and sort chronologically (latest first)
      const merged = [...realTrades, ...paperTrades].sort((a, b) => (b.entry_time || 0) - (a.entry_time || 0));
      setTrades(merged);
    } catch (e) {
      console.error("TradeJournal fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchTrades();
    socket.on("trade-update",      refresh);
    socket.on("real-trade-update", refresh);
    socket.on("paper-trade-opened", refresh);
    socket.on("paper-trade-closed", refresh);
    return () => {
      socket.off("trade-update",      refresh);
      socket.off("real-trade-update", refresh);
      socket.off("paper-trade-opened", refresh);
      socket.off("paper-trade-closed", refresh);
    };
  }, [socket, fetchTrades]);

  // ── Filter trades ─────────────────────────────────────────────
  const filtered = trades.filter(t => {
    if (filterType === "PAPER"      && t.source !== "PAPER")     return false;
    if (filterType === "REAL"       && t.source !== "REAL")      return false;
    if (filterType === "POSITIONAL" && t.trade_type !== "POSITIONAL") return false;
    if (filterStatus !== "ALL"      && t.status !== filterStatus) return false;
    if (filterInstrument !== "ALL"  && t.instrument !== filterInstrument) return false;
    if (searchStrategy && !t.strategyName?.toLowerCase().includes(searchStrategy.toLowerCase())) return false;

    if (dateRange === "today") {
      const today = new Date().toDateString();
      const openedToday = new Date(t.entry_time || 0).toDateString() === today;
      const closedToday = t.closed_at ? new Date(t.closed_at).toDateString() === today : false;
      if (!openedToday && !closedToday) return false;
    } else if (dateRange === "week") {
      const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      const openedThisWeek = (t.entry_time || 0) >= weekAgo;
      const closedThisWeek = t.closed_at ? t.closed_at >= weekAgo : false;
      if (!openedThisWeek && !closedThisWeek) return false;
    }
    return true;
  });

  // ── Strategy stats ────────────────────────────────────────────
  const strategyStats: StrategyStats[] = (() => {
    const map: Record<string, StrategyStats & { closedTrades: number }> = {};
    const statsFiltered = trades.filter(t => {
      if (filterType === "PAPER"      && t.source !== "PAPER")     return false;
      if (filterType === "REAL"       && t.source !== "REAL")      return false;
      if (filterType === "POSITIONAL" && t.trade_type !== "POSITIONAL") return false;
      if (filterInstrument !== "ALL"  && t.instrument !== filterInstrument) return false;
      if (searchStrategy && !t.strategyName?.toLowerCase().includes(searchStrategy.toLowerCase())) return false;

      if (dateRange === "today") {
        const today = new Date().toDateString();
        const openedToday = new Date(t.entry_time || 0).toDateString() === today;
        const closedToday = t.closed_at ? new Date(t.closed_at).toDateString() === today : false;
        if (!openedToday && !closedToday) return false;
      } else if (dateRange === "week") {
        const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
        const openedThisWeek = (t.entry_time || 0) >= weekAgo;
        const closedThisWeek = t.closed_at ? t.closed_at >= weekAgo : false;
        if (!openedThisWeek && !closedThisWeek) return false;
      }
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

    return Object.values(map).map(s => ({
      ...s,
      winRate: s.closedTrades > 0 ? (s.wins / s.closedTrades) * 100 : 0,
      avgPnl:  s.trades > 0 ? s.totalPnl / s.trades : 0,
    })).sort((a, b) => b.totalPnl - a.totalPnl);
  })();

  // ── Summary stats ─────────────────────────────────────────────
  const closed     = filtered.filter(t => t.status === "CLOSED");
  const open       = filtered.filter(t => t.status === "OPEN");
  const totalPnl   = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins       = closed.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate    = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const realCount  = filtered.filter(t => t.source === "REAL").length;
  const paperCount = filtered.filter(t => t.source === "PAPER").length;

  const gradeBadge = (grade?: string) => {
    const map: Record<string, string> = {
      STRONG: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      GOOD:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
      OK:     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      BLOCK:  "bg-red-500/20 text-red-400 border-red-500/30",
    };
    return grade ? map[grade] || map.OK : "";
  };

  return (
    <div className={`${bg} min-h-screen p-4 space-y-4`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <BookOpen size={20} className="text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${text}`}>Trade Journal</h1>
            <p className={`text-xs ${sub}`}>Paper + Real + Swing — sab ek jagah</p>
          </div>
        </div>
        <button onClick={fetchTrades} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 text-sm hover:bg-violet-500/20 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total P&L",   value: fmt(totalPnl),         color: totalPnl >= 0 ? "text-emerald-400" : "text-red-400", icon: <DollarSign size={16} /> },
          { label: "Win Rate",    value: `${winRate.toFixed(0)}%`, color: winRate >= 50 ? "text-emerald-400" : "text-orange-400", icon: <Award size={16} /> },
          { label: "Open Trades", value: open.length,            color: "text-blue-400",    icon: <Activity size={16} /> },
          { label: "Real Trades", value: realCount,              color: "text-violet-400",  icon: <Zap size={16} /> },
          { label: "Paper Trades",value: paperCount,             color: "text-gray-400",    icon: <Layers size={16} /> },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className={`${card} border rounded-xl p-3 flex flex-col gap-1`}>
            <div className={`flex items-center gap-1.5 text-xs ${sub}`}>{icon}{label}</div>
            <div className={`text-xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className={`${card} border rounded-xl`}>
        <div className="flex border-b border-[#30363d]">
          {(["journal", "strategy-stats"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${tab === t
                ? "text-violet-400 border-b-2 border-violet-500"
                : `${sub} hover:text-gray-300`}`}>
              {t === "journal" ? "📋 Trade Log" : "📊 Strategy Stats"}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="p-3 flex flex-wrap gap-2 border-b border-[#30363d]">
          {/* Type */}
          <div className="flex gap-1">
            {(["ALL","PAPER","REAL","POSITIONAL"] as TradeType[]).map(v => (
              <button key={v} onClick={() => setFilterType(v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterType === v
                  ? "bg-violet-500 text-white" : `${sub} border ${darkMode?"border-[#30363d]":"border-gray-200"} hover:border-violet-500/50`}`}>
                {v}
              </button>
            ))}
          </div>

          {/* Status */}
          <div className="flex gap-1">
            {(["ALL","OPEN","CLOSED","FAILED"] as TradeStatus[]).map(v => (
              <button key={v} onClick={() => setFilterStatus(v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterStatus === v
                  ? v === "FAILED" ? "bg-red-600 text-white" : "bg-blue-500 text-white" 
                  : `${sub} border ${darkMode?"border-[#30363d]":"border-gray-200"} hover:border-blue-500/50`}`}>
                {v}
              </button>
            ))}
          </div>

          {/* Instrument */}
          <div className="flex gap-1">
            {["ALL","NIFTY","BANKNIFTY","SENSEX"].map(v => (
              <button key={v} onClick={() => setFilterInstrument(v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterInstrument === v
                  ? "bg-emerald-600 text-white" : `${sub} border ${darkMode?"border-[#30363d]":"border-gray-200"} hover:border-emerald-500/50`}`}>
                {v}
              </button>
            ))}
          </div>

          {/* Date */}
          <div className="flex gap-1">
            {(["today","week","all"] as const).map(v => (
              <button key={v} onClick={() => setDateRange(v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${dateRange === v
                  ? "bg-orange-500 text-white" : `${sub} border ${darkMode?"border-[#30363d]":"border-gray-200"} hover:border-orange-500/50`}`}>
                {v}
              </button>
            ))}
          </div>

          {/* Strategy Search */}
          <div className="relative ml-auto">
            <Search size={12} className={`absolute left-2 top-1/2 -translate-y-1/2 ${sub}`} />
            <input value={searchStrategy} onChange={e => setSearchStrategy(e.target.value)}
              placeholder="Strategy..." className={`pl-6 pr-3 py-1 rounded-lg text-xs border ${input} w-36`} />
          </div>
        </div>

        {/* Journal Tab */}
        {tab === "journal" && (
          <div className="overflow-x-auto">
            {loading ? (
              <div className={`p-8 text-center ${sub} text-sm`}>Loading trades...</div>
            ) : filtered.length === 0 ? (
              <div className={`p-8 text-center ${sub} text-sm`}>No trades found for selected filters</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className={`border-b ${darkMode ? "border-[#30363d] text-gray-400" : "border-gray-100 text-gray-500"} text-left`}>
                    {["Source","Instrument","Strategy","Direction","Entry","Exit","P&L","Status","Entry Time","OI Brain","Action"].map(h => (
                      <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const isWin  = (t.pnl ?? 0) > 0;
                    const isOpen = t.status === "OPEN";
                    const isReal = t.source === "REAL";
                    const isPos  = t.trade_type === "POSITIONAL";

                    return (
                      <React.Fragment key={t.id}>
                        <tr
                          onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                          className={`border-b cursor-pointer transition-colors ${darkMode
                            ? "border-[#21262d] hover:bg-[#1c2128]"
                            : "border-gray-50 hover:bg-gray-50"} ${isReal ? "border-l-2 border-l-violet-500" : ""}`}>
                          {/* Source */}
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isReal
                              ? "bg-violet-500/20 text-violet-400"
                              : isPos
                                ? "bg-orange-500/20 text-orange-400"
                                : "bg-gray-500/20 text-gray-400"}`}>
                              {isReal ? "REAL" : isPos ? "SWING" : "PAPER"}
                            </span>
                          </td>
                          {/* Instrument */}
                          <td className={`px-3 py-2 font-semibold ${text}`}>
                            <span className={t.instrument === "NIFTY" ? "text-blue-400" : t.instrument === "BANKNIFTY" ? "text-purple-400" : "text-orange-400"}>
                              {t.instrument}
                            </span>
                          </td>
                          {/* Strategy */}
                          <td className="px-3 py-2 max-w-[120px]">
                            <div className={`truncate ${text} font-medium`} title={t.strategyName}>{t.strategyName || "AUTO"}</div>
                            {t.scalpType && <div className={`text-[10px] ${sub} truncate`}>{t.scalpType}</div>}
                          </td>
                          {/* Direction */}
                          <td className="px-3 py-2">
                            <span className={`flex items-center gap-1 font-semibold ${t.direction === "BUY_CE" ? "text-red-400" : "text-green-400"}`}>
                              {t.direction === "BUY_CE" ? <TrendingDown size={12}/> : <TrendingUp size={12}/>}
                              {t.direction === "BUY_CE" ? "CE" : "PE"}
                            </span>
                          </td>
                          {/* Entry */}
                          <td className={`px-3 py-2 font-mono ${text}`}>₹{t.entry_price?.toFixed(1)}</td>
                          {/* Exit */}
                          <td className={`px-3 py-2 font-mono ${sub}`}>
                            {isOpen
                              ? <span className="text-blue-400">₹{(t.livePrice ?? t.entry_price)?.toFixed(1)}<span className="text-[10px] ml-1">live</span></span>
                              : t.exit_price ? `₹${t.exit_price.toFixed(1)}` : "—"}
                          </td>
                          {/* P&L */}
                          <td className="px-3 py-2 font-mono font-bold">
                            {isOpen
                              ? <span className="text-blue-400 text-[10px]">open</span>
                              : <span className={isWin ? "text-emerald-400" : "text-red-400"}>{fmt(t.pnl ?? 0)}</span>}
                          </td>
                          {/* Status */}
                          <td className="px-3 py-2">
                            {t.status === "FAILED" ? (
                              <span className="flex items-center gap-1 font-bold text-red-400 bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 rounded text-[10px] w-fit">
                                <XCircle size={10}/> REJECTED
                              </span>
                            ) : isOpen ? (
                              <span className="flex items-center gap-1 text-blue-400"><Circle size={8} className="fill-current animate-pulse"/> OPEN</span>
                            ) : (
                              <span className={`flex items-center gap-1 ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                                {isWin ? <CheckCircle size={10}/> : <XCircle size={10}/>} {isWin ? "WIN" : "LOSS"}
                              </span>
                            )}
                          </td>
                          {/* Time */}
                          <td className={`px-3 py-2 whitespace-nowrap ${sub}`}>{fmtTime(t.entry_time)}</td>
                          {/* OI Brain */}
                          <td className="px-3 py-2">
                            {t.oiBrainScore !== undefined
                              ? <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${gradeBadge(t.oiBrainGrade)}`}>
                                  {t.oiBrainScore}/100 {t.oiBrainGrade}
                                </span>
                              : <span className={`text-[10px] ${sub}`}>—</span>}
                          </td>
                          {/* Expand */}
                          <td className="px-3 py-2">
                            {expandedId === t.id ? <ChevronUp size={14} className={sub}/> : <ChevronDown size={14} className={sub}/>}
                          </td>
                        </tr>
                        {/* Expanded Row */}
                        {expandedId === t.id && (
                          <tr className={darkMode ? "bg-[#1c2128]" : "bg-gray-50"}>
                            <td colSpan={11} className="px-4 py-3">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                <div><span className={sub}>Strike:</span> <span className={text}>{t.strike ?? "—"}</span></div>
                                <div><span className={sub}>Qty:</span> <span className={text}>{t.qty ?? 1} × {t.lot_size ?? 1} = {(t.qty ?? 1) * (t.lot_size ?? 1)} units</span></div>
                                <div><span className={sub}>Confidence:</span> <span className={text}>{t.confidence ? `${t.confidence}%` : "—"}</span></div>
                                <div><span className={sub}>Type:</span> <span className={text}>{t.trade_type || "INTRADAY"}</span></div>
                                <div><span className={sub}>Exit Reason:</span> <span className={text}>{t.exit_reason || "—"}</span></div>
                                <div><span className={sub}>Closed At:</span> <span className={text}>{fmtTime(t.closed_at)}</span></div>
                                <div><span className={sub}>Source:</span> <span className={isReal ? "text-violet-400 font-bold" : "text-gray-400"}>{isReal ? "Fyers Real Trade" : "Paper Trade"}</span></div>
                                <div><span className={sub}>Order Ref / ID:</span> <span className="font-mono text-cyan-400">{t.signal_ref || t.id}</span></div>
                                <div><span className={sub}>OI Brain:</span> <span className={text}>{t.oiBrainScore !== undefined ? `${t.oiBrainScore}/100 (${t.oiBrainGrade})` : "Not evaluated"}</span></div>

                                {t.notes && (
                                  <div className="col-span-2 md:col-span-4 p-2.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-xs font-mono">
                                    <span className="font-bold text-red-400 uppercase tracking-wide flex items-center gap-1.5 mb-1">
                                      <AlertTriangle size={13} /> FYERS API Order Response / Rejection Reason:
                                    </span>
                                    {t.notes}
                                  </div>
                                )}

                                <div className="col-span-2 md:col-span-4 flex gap-4 mt-2">
                                  <button
                                    onClick={() => setSelectedTrade(t)}
                                    className="px-4 py-1.5 bg-indigo-600/20 text-indigo-400 rounded-lg text-xs font-semibold hover:bg-indigo-600/30 cursor-pointer border border-indigo-500/30 transition-all shadow-md"
                                  >
                                    View Indicators Audit
                                  </button>
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
            )}
          </div>
        )}

        {/* Strategy Stats Tab */}
        {tab === "strategy-stats" && (
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <BarChart2 size={16} className="text-violet-400"/>
              <span className={`text-sm font-semibold ${text}`}>Strategy Performance Audit</span>
              <span className={`text-xs ${sub}`}>— Best se worst sort kiya hua</span>
            </div>
            {strategyStats.length === 0 ? (
              <div className={`text-center py-8 ${sub} text-sm`}>No trades recorded yet for these filters</div>
            ) : (
              <div className="space-y-2">
                {strategyStats.map((s, i) => {
                  const isProfit = s.totalPnl >= 0;
                  const pct = s.winRate;
                  return (
                    <div key={s.name} className={`${card} border rounded-xl p-3`}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        {/* Rank + Name */}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                            i === 0 ? "bg-yellow-500/20 text-yellow-400" :
                            i === 1 ? "bg-gray-400/20 text-gray-400" :
                            i === 2 ? "bg-orange-600/20 text-orange-500" :
                            "bg-gray-700/30 text-gray-500"}`}>
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <div className={`font-semibold ${text} truncate`}>{s.name}</div>
                            <div className={`text-[10px] ${sub}`}>{s.trades} trades</div>
                          </div>
                        </div>

                        {/* Stats row */}
                        <div className="flex items-center gap-4 flex-wrap">
                          {/* Win Rate bar */}
                          <div className="flex flex-col gap-1 min-w-[80px]">
                            <div className={`text-[10px] ${sub}`}>Win Rate</div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-20 h-1.5 rounded-full bg-gray-700">
                                <div className={`h-full rounded-full ${pct >= 60 ? "bg-emerald-500" : pct >= 45 ? "bg-yellow-500" : "bg-red-500"}`}
                                  style={{ width: `${pct}%` }}/>
                              </div>
                              <span className={`text-xs font-bold ${pct >= 60 ? "text-emerald-400" : pct >= 45 ? "text-yellow-400" : "text-red-400"}`}>
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-3 text-xs">
                            <div className="text-center">
                              <div className={sub}>W/L</div>
                              <div className={text}><span className="text-emerald-400">{s.wins}</span>/<span className="text-red-400">{s.losses}</span></div>
                            </div>
                            <div className="text-center">
                              <div className={sub}>Avg P&L</div>
                              <div className={s.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{fmt(s.avgPnl)}</div>
                            </div>
                            <div className="text-center">
                              <div className={sub}>Best</div>
                              <div className="text-emerald-400">{fmt(s.bestTrade === -Infinity ? 0 : s.bestTrade)}</div>
                            </div>
                            <div className="text-center">
                              <div className={sub}>Worst</div>
                              <div className="text-red-400">{fmt(s.worstTrade === Infinity ? 0 : s.worstTrade)}</div>
                            </div>
                            <div className="text-center">
                              <div className={sub}>Total P&L</div>
                              <div className={`font-bold text-sm ${isProfit ? "text-emerald-400" : "text-red-400"}`}>{fmt(s.totalPnl)}</div>
                            </div>
                          </div>

                          {/* Badge */}
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            pct >= 65 ? "bg-emerald-500/20 text-emerald-400" :
                            pct >= 50 ? "bg-blue-500/20 text-blue-400" :
                            pct >= 40 ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-red-500/20 text-red-400"}`}>
                            {pct >= 65 ? "⭐ BEST" : pct >= 50 ? "✓ GOOD" : pct >= 40 ? "~ AVG" : "✗ AVOID"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {selectedTrade && (
        <TradeDetailsModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} darkMode={darkMode} />
      )}
    </div>
  );
}
