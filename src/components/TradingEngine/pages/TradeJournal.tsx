/**
 * TradeJournal.tsx — Trade Journal with filtering and CSV export
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FileText, Download, RefreshCw, Edit2, Check, X, Info } from "lucide-react";
import TradeDetailsModal from "../shared/TradeDetailsModal";

interface Props { activePage: string; }
interface Trade {
  id: string; timestamp: number; instrument: string; direction: string;
  strike: number; entry_price: number; exit_price?: number; qty: number;
  lot_size: number; stop_loss: number; target: number; status: string;
  pnl: number; notes: string;
  strategyName?: string;
  signal_ref?: string;
  confidence?: number;
}

const getApiUrl = (p: string) => (window.location.port === "5173" ? "http://localhost:3000" : "") + p;
const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

type Filter = "TODAY" | "WEEK" | "ALL";

const TradeJournal: React.FC<Props> = ({ activePage }) => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  const categories = useMemo(() => {
    const set = new Set<string>();
    trades.forEach(t => { if (t.strategyName) set.add(t.strategyName); });
    return ["ALL", ...Array.from(set)];
  }, [trades]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/te/paper-trades"));
      if (r.ok) { const d = await r.json(); setTrades(d.trades || []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const weekMs = 7 * dayMs;
    return trades
      .filter(t => {
        if (filter === "TODAY") return now - t.timestamp < dayMs;
        if (filter === "WEEK")  return now - t.timestamp < weekMs;
        return true;
      })
      .filter(t => {
        if (selectedCategory !== "ALL" && t.strategyName !== selectedCategory) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [trades, filter, selectedCategory]);

  const stats = useMemo(() => {
    const closed = filtered.filter(t => t.status === "CLOSED");
    const totalPnl = filtered.reduce((a, t) => a + t.pnl, 0);
    const wins = closed.filter(t => t.pnl > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    return { total: filtered.length, closed: closed.length, totalPnl, winRate };
  }, [filtered]);

  const saveNote = async (id: string) => {
    try {
      await fetch(getApiUrl("/api/te/paper-trades/notes"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, notes: noteValue }),
      });
      setTrades(prev => prev.map(t => t.id === id ? { ...t, notes: noteValue } : t));
    } finally { setEditingNote(null); }
  };

  const exportCSV = () => {
    const headers = ["Time","Instrument","Direction","Strike","Entry","Exit","Qty","Lot","P&L","Status","Notes"];
    const rows = filtered.map(t => [
      fmtDate(t.timestamp), t.instrument, t.direction, t.strike, t.entry_price,
      t.exit_price ?? "", t.qty, t.lot_size, t.pnl, t.status, `"${t.notes}"`
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `trade_journal_${activePage}_${Date.now()}.csv`; a.click();
  };

  return (
    <div className="p-4 space-y-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2"><FileText size={18} className="text-indigo-400" /> Trade Journal</h1>
          <p className="text-base text-slate-500 mt-0.5">All paper trades · Editable notes · CSV export</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-base font-black transition-colors cursor-pointer border border-slate-700">
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {(["TODAY","WEEK","ALL"] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 text-sm font-black rounded-lg cursor-pointer transition-all ${filter === f ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                {f}
              </button>
            ))}
          </div>

          {/* Strategy Category Filter */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
            <span className="text-[10px] text-slate-500 uppercase font-black">Strategy:</span>
            <select 
              value={selectedCategory} 
              onChange={e => setSelectedCategory(e.target.value)}
              className="bg-transparent text-xs text-slate-300 font-bold outline-none border-none cursor-pointer pr-1"
            >
              {categories.map(cat => (
                <option key={cat} value={cat} className="bg-slate-950 text-slate-300 font-bold uppercase">{cat.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-4 text-base">
          <span className="text-slate-500">Trades: <b className="text-white">{stats.total}</b></span>
          <span className="text-slate-500">Win Rate: <b className={stats.winRate >= 50 ? "text-emerald-400" : "text-red-400"}>{stats.winRate.toFixed(1)}%</b></span>
          <span className="text-slate-500">Total P&L: <b className={stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>{stats.totalPnl >= 0 ? "+" : ""}₹{fmt(stats.totalPnl)}</b></span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
          <table className="w-full text-base">
            <thead className="sticky top-0 bg-[#08101a] z-10">
              <tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
                {["Time","Instr","Dir","Strike","Entry","Exit","Qty×Lot","P&L","Status","Notes",""].map((h, i) => (
                  <th key={i} className="p-2 pl-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/20">
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-10 text-slate-600 text-base">No trades found</td></tr>
              ) : filtered.map((t, i) => (
                <tr 
                  key={t.id} 
                  className={`hover:bg-slate-800/25 transition-colors cursor-pointer ${i % 2 === 0 ? "bg-slate-950/20" : ""}`}
                  onClick={() => setSelectedTrade(t)}
                >
                  <td className="p-2 pl-3 text-slate-500 font-mono whitespace-nowrap">{fmtDate(t.timestamp)}</td>
                  <td className="p-2">
                    <span className={`text-sm font-black px-1 py-0.5 rounded ${t.instrument === "NIFTY" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"}`}>{t.instrument}</span>
                  </td>
                  <td className="p-2">
                    <span className={`text-sm font-black px-1.5 py-0.5 rounded ${t.direction === "BUY_CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{t.direction}</span>
                  </td>
                  <td className="p-2 font-mono text-slate-300">{t.strike.toLocaleString("en-IN")}</td>
                  <td className="p-2 font-mono font-bold text-white">₹{t.entry_price}</td>
                  <td className="p-2 font-mono text-slate-300">{t.exit_price ? `₹${t.exit_price}` : "—"}</td>
                  <td className="p-2 font-mono text-slate-400">{t.qty}×{t.lot_size}={t.qty * t.lot_size}</td>
                  <td className="p-2">
                    <span className={`font-black font-mono ${t.pnl > 0 ? "text-emerald-400" : t.pnl < 0 ? "text-red-400" : "text-slate-500"}`}>
                      {t.pnl > 0 ? "+" : ""}₹{fmt(t.pnl)}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className={`text-sm font-black px-1.5 py-0.5 rounded ${t.status === "OPEN" ? "bg-amber-500/20 text-amber-400" : t.pnl > 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{t.status}</span>
                  </td>
                  <td className="p-2 max-w-[160px]" onClick={(e) => { if (editingNote === t.id) e.stopPropagation(); }}>
                    {editingNote === t.id ? (
                      <input value={noteValue} onChange={e => setNoteValue(e.target.value)}
                        className="w-full bg-slate-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white outline-none" autoFocus onClick={(e) => e.stopPropagation()} />
                    ) : (
                      <span className="text-slate-400 truncate block">{t.notes || "—"}</span>
                    )}
                  </td>
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    {editingNote === t.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => saveNote(t.id)} className="text-emerald-400 hover:text-emerald-300 cursor-pointer"><Check size={11} /></button>
                        <button onClick={() => setEditingNote(null)} className="text-slate-500 hover:text-slate-300 cursor-pointer"><X size={11} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setEditingNote(t.id); setNoteValue(t.notes); }}
                          className="text-slate-600 hover:text-slate-300 cursor-pointer transition-colors" title="Edit manual notes"><Edit2 size={11} /></button>
                        <button onClick={() => setSelectedTrade(t)}
                          className="text-slate-600 hover:text-teal-400 cursor-pointer transition-colors" title="View execution audit indicators"><Info size={11} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-slate-800/30 flex justify-between text-sm text-slate-500">
          <span>{stats.total} trades · {stats.closed} closed</span>
          <span className={`font-black ${stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            Net P&L: {stats.totalPnl >= 0 ? "+" : ""}₹{fmt(stats.totalPnl)}
          </span>
        </div>
      </div>
      {selectedTrade && (
        <TradeDetailsModal
          trade={selectedTrade}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </div>
  );
};

export default TradeJournal;

