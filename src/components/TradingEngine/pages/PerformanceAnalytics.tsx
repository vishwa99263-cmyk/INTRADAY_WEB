/**
 * PerformanceAnalytics.tsx — Premium Historical Report
 * Sections: KPIs · Cumulative P&L Chart · Strategy Breakdown ·
 *           Day-wise Heatmap · Trade Log · Market Velocity Studies
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Activity, TrendingUp, TrendingDown, Award, Calendar,
  BarChart2, Filter, RefreshCw, Target, Shield, Zap,
  ChevronUp, ChevronDown, FileText,
} from "lucide-react";

interface Props { activePage: string; }

interface Trade {
  id:           string;
  timestamp:    number;
  status:       string;
  pnl:          number;
  direction:    string;
  entry_price:  number;
  exit_price?:  number;
  instrument:   string;
  notes?:       string;   // JSON blob with strategyId, strategyName, etc.
}

interface ParsedNotes {
  strategyId?:   string;
  strategyName?: string;
  entryReason?:  string;
  exitReason?:   string;
  type?:         string;  // e.g. "ORB_NAKED"
  reason?:       string;  // e.g. "Opening Range Breakout (BUY_CE)"
  displayName?:  string;  // resolved human-readable name
  displayDir?:   string;  // normalized direction CE/PE/BUY/SELL
}

const getApiUrl = (p: string) =>
  (window.location.port === "5173" ? "http://localhost:3000" : "") + p;

const fmt    = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtRs  = (n: number) => `${n >= 0 ? "+" : ""}₹${fmt(Math.abs(n))}`;
const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

function parseNotes(raw?: string, trade?: Trade): ParsedNotes {
  let parsed: ParsedNotes = {};
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { }
  }

  // Resolve displayName based on trade type
  if (parsed.strategyName) {
    // AutoStrategyDispatcher trade
    parsed.displayName = parsed.strategyName;
  } else if (parsed.type === 'ORB_NAKED') {
    // ORB Naked Automation trade
    const dir = trade?.direction?.includes('CE') ? 'CE' : trade?.direction?.includes('PE') ? 'PE' : trade?.direction || '';
    parsed.displayName = `ORB: ${trade?.instrument || ''} ${dir}`;
    parsed.strategyId  = 'ORB_NAKED';
  } else if (parsed.type) {
    // Any other typed trade
    parsed.displayName = `${parsed.type.replace(/_/g, ' ')}: ${trade?.instrument || ''}`;
    parsed.strategyId  = parsed.type;
  } else {
    // Last resort — instrument name
    parsed.displayName = trade?.instrument || 'Unknown';
  }

  // Normalize direction: BUY_CE → CE, BUY_PE → PE
  const rawDir = trade?.direction || '';
  parsed.displayDir = rawDir.includes('CE') ? 'CE'
    : rawDir.includes('PE') ? 'PE'
    : rawDir.includes('BUY') ? 'BUY'
    : rawDir.includes('SELL') ? 'SELL'
    : rawDir;

  return parsed;
}

// ── Stat Box ─────────────────────────────────────────────────────────────────
const KPIBox: React.FC<{ label: string; value: string; color?: string; sub?: string }> = ({
  label, value, color = "text-white", sub,
}) => (
  <div className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-3 space-y-0.5">
    <div className="text-[8px] text-slate-500 uppercase font-black tracking-widest">{label}</div>
    <div className={`text-xl font-black font-mono ${color}`}>{value}</div>
    {sub && <div className="text-[8px] text-slate-600 font-mono">{sub}</div>}
  </div>
);

// ── Section Header ────────────────────────────────────────────────────────────
const SectionHead: React.FC<{ icon: React.ReactNode; title: string; sub?: string }> = ({ icon, title, sub }) => (
  <div className="flex items-center gap-2">
    <span className="text-indigo-400">{icon}</span>
    <div>
      <div className="text-xs font-black text-white uppercase tracking-wider">{title}</div>
      {sub && <div className="text-[8px] text-slate-600 font-mono">{sub}</div>}
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const PerformanceAnalytics: React.FC<Props> = ({ activePage }) => {
  const [trades, setTrades]           = useState<Trade[]>([]);
  const [patternSummary, setPattern]  = useState<any | null>(null);
  const [loading, setLoading]         = useState(false);
  const [filter, setFilter]           = useState<"ALL" | "WIN" | "LOSS">("ALL");
  const [sortCol, setSortCol]         = useState<"timestamp" | "pnl">("timestamp");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");
  const [activeSection, setSection]   = useState<"overview" | "strategies" | "calendar" | "log" | "velocity">("overview");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");

  // ── Load trades ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/te/paper-trades?status=CLOSED&limit=500"));
      if (r.ok) {
        const d = await r.json();
        setTrades(d.trades || []);
      }
    } catch { }
    finally { setLoading(false); }
  }, []);

  const loadDates = useCallback(async () => {
    try {
      const r = await fetch(getApiUrl(`/api/daily-patterns/dates?symbol=${activePage}`));
      if (r.ok) {
        const d = await r.json();
        if (d.s === "ok" && d.dates.length > 0) {
          setAvailableDates(d.dates);
          setSelectedDate(prev => {
            if (prev && d.dates.includes(prev)) return prev;
            return d.dates[0]; // default to latest
          });
        }
      }
    } catch { }
  }, [activePage]);

  const loadPattern = useCallback(async (dateToLoad = selectedDate) => {
    if (!dateToLoad) return;
    try {
      const r = await fetch(getApiUrl(`/api/daily-patterns/datewise?symbol=${activePage}&date=${dateToLoad}`));
      if (r.ok) {
        const d = await r.json();
        if (d.s === "ok") setPattern(d.summary);
      }
    } catch { }
  }, [activePage, selectedDate]);

  useEffect(() => {
    load();
    loadDates();
  }, [load, loadDates, activePage]);

  useEffect(() => {
    if (selectedDate) {
      loadPattern(selectedDate);
    }
  }, [selectedDate, loadPattern]);

  // Real-time polling for Today's date
  useEffect(() => {
    const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];
    if (selectedDate === todayIST) {
      const interval = setInterval(() => {
        loadPattern(selectedDate);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [selectedDate, loadPattern]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const closed = useMemo(() =>
    trades.filter(t => t.status === "CLOSED").sort((a, b) => a.timestamp - b.timestamp),
    [trades]
  );

  const stats = useMemo(() => {
    if (closed.length === 0) return null;
    const totalPnl   = closed.reduce((a, t) => a + t.pnl, 0);
    const wins       = closed.filter(t => t.pnl > 0);
    const losses     = closed.filter(t => t.pnl < 0);
    const winRate    = (wins.length / closed.length) * 100;
    const avgWin     = wins.length   > 0 ? wins.reduce((a, t)   => a + t.pnl, 0)  / wins.length   : 0;
    const avgLoss    = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0
      ? wins.reduce((a, t) => a + t.pnl, 0) / Math.abs(losses.reduce((a, t) => a + t.pnl, 0))
      : 99;
    const best  = [...closed].sort((a, b) => b.pnl - a.pnl)[0];
    const worst = [...closed].sort((a, b) => a.pnl - b.pnl)[0];

    // Max Drawdown
    let peak = 0, maxDD = 0, runningPnl = 0;
    closed.forEach(t => {
      runningPnl += t.pnl;
      if (runningPnl > peak) peak = runningPnl;
      const dd = peak - runningPnl;
      if (dd > maxDD) maxDD = dd;
    });

    // Current streak
    let streak = 0;
    const rev = [...closed].reverse();
    const first = rev[0]?.pnl ?? 0;
    const streakType = first >= 0 ? "W" : "L";
    for (const t of rev) {
      if ((t.pnl >= 0 && streakType === "W") || (t.pnl < 0 && streakType === "L")) streak++;
      else break;
    }

    return {
      totalPnl, wins: wins.length, losses: losses.length, winRate,
      avgWin, avgLoss, profitFactor, best, worst, maxDD, streak, streakType,
      total: closed.length,
    };
  }, [closed]);

  // ── Strategy Breakdown ────────────────────────────────────────────────────
  const strategyBreakdown = useMemo(() => {
    const map: Record<string, {
      name: string; trades: number; wins: number; losses: number; totalPnl: number; avgPnl: number;
    }> = {};
    closed.forEach(t => {
      const notes = parseNotes(t.notes, t);
      const sid   = notes.strategyId  || t.instrument || 'Unknown';
      const sname = notes.displayName || t.instrument || 'Unknown';
      if (!map[sid]) map[sid] = { name: sname, trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0 };
      map[sid].trades++;
      map[sid].totalPnl += t.pnl;
      if (t.pnl >= 0) map[sid].wins++;
      else             map[sid].losses++;
    });
    return Object.entries(map)
      .map(([id, v]) => ({ id, ...v, avgPnl: v.totalPnl / v.trades, winRate: (v.wins / v.trades) * 100 }))
      .sort((a, b) => b.totalPnl - a.totalPnl);
  }, [closed]);

  // ── Day-wise P&L (current month) ─────────────────────────────────────────
  const calendarData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    const map: Record<number, number> = {};
    closed.forEach(t => {
      const d = new Date(t.timestamp);
      if (d.getFullYear() === year && d.getMonth() === month) {
        map[d.getDate()] = (map[d.getDate()] || 0) + t.pnl;
      }
    });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay    = new Date(year, month, 1).getDay(); // 0=Sun
    return { map, daysInMonth, firstDay, monthName: now.toLocaleString("en-IN", { month: "long", year: "numeric" }) };
  }, [closed]);

  // ── Cumulative P&L chart ──────────────────────────────────────────────────
  const chartTrades = closed.slice(-30);
  const cumPnl: number[] = [];
  let running = 0;
  chartTrades.forEach(t => { running += t.pnl; cumPnl.push(running); });
  const maxAbs = Math.max(...cumPnl.map(Math.abs), 1);
  const chartH = 100;

  // ── Filtered + sorted trade log ───────────────────────────────────────────
  const logTrades = useMemo(() => {
    let t = filter === "ALL" ? closed
          : filter === "WIN" ? closed.filter(t => t.pnl > 0)
          :                    closed.filter(t => t.pnl < 0);
    return [...t].sort((a, b) =>
      sortDir === "desc"
        ? (b as any)[sortCol] - (a as any)[sortCol]
        : (a as any)[sortCol] - (b as any)[sortCol]
    );
  }, [closed, filter, sortCol, sortDir]);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  // ── TABS ─────────────────────────────────────────────────────────────────
  const sections = [
    { id: "overview",    label: "Overview",    icon: <BarChart2 size={11}/> },
    { id: "strategies",  label: "Strategies",  icon: <Zap size={11}/> },
    { id: "calendar",    label: "Calendar",    icon: <Calendar size={11}/> },
    { id: "log",         label: "Trade Log",   icon: <FileText size={11}/> },
    { id: "velocity",    label: "Velocity",    icon: <Activity size={11}/> },
  ] as const;

  if (trades.length === 0 && !loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center p-4">
      <Activity size={36} className="text-slate-700 animate-pulse" />
      <div className="text-sm font-black text-slate-500 uppercase tracking-wider">No closed trades yet</div>
      <div className="text-[9px] text-slate-700 font-mono">
        AI Auto Strategy ya Paper Trading se trades close honge to yahan dikhenge
      </div>
      <button onClick={load} className="text-[9px] border border-slate-700 text-slate-500 px-3 py-1.5 rounded hover:bg-slate-800/30 cursor-pointer flex items-center gap-1">
        <RefreshCw size={9}/> Refresh
      </button>
    </div>
  );

  return (
    <div className="p-4 space-y-4 bg-[#040811] min-h-screen" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Page Header ── */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-900">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <BarChart2 size={18} className="text-indigo-400"/> Historical Report
          </h1>
          <p className="text-[9px] text-slate-500 font-mono mt-0.5">
            {closed.length} closed trades · Paper mode · Last updated {new Date().toLocaleTimeString("en-IN")}
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 text-[9px] border border-slate-700/50 text-slate-500 px-3 py-1.5 rounded hover:bg-slate-800/30 cursor-pointer transition-colors">
          <RefreshCw size={9} className={loading ? "animate-spin" : ""}/>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* ── Section Tabs ── */}
      <div className="flex gap-1 overflow-x-auto">
        {sections.map(s => (
          <button key={s.id} onClick={() => setSection(s.id as any)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer border
              ${activeSection === s.id
                ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-300"
                : "bg-transparent border-slate-800/30 text-slate-500 hover:text-slate-300"}`}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* OVERVIEW */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeSection === "overview" && stats && (
        <div className="space-y-4">
          {/* KPI Grid */}
          <div className="grid grid-cols-4 gap-2">
            <KPIBox label="Total P&L"
              value={fmtRs(stats.totalPnl)}
              color={stats.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
              sub={`${stats.total} trades`}
            />
            <KPIBox label="Win Rate"
              value={`${stats.winRate.toFixed(1)}%`}
              color={stats.winRate >= 55 ? "text-emerald-400" : stats.winRate >= 45 ? "text-amber-400" : "text-rose-400"}
              sub={`${stats.wins}W · ${stats.losses}L`}
            />
            <KPIBox label="Profit Factor"
              value={stats.profitFactor > 90 ? "∞" : stats.profitFactor.toFixed(2)}
              color={stats.profitFactor >= 1.5 ? "text-emerald-400" : stats.profitFactor >= 1 ? "text-amber-400" : "text-rose-400"}
              sub="Total win ÷ total loss"
            />
            <KPIBox label="Max Drawdown"
              value={`₹${fmt(stats.maxDD)}`}
              color="text-rose-400"
              sub="Worst peak→trough"
            />
            <KPIBox label="Avg Win"
              value={`₹${fmt(stats.avgWin)}`}
              color="text-emerald-400"
            />
            <KPIBox label="Avg Loss"
              value={`₹${fmt(stats.avgLoss)}`}
              color="text-rose-400"
            />
            <KPIBox label="Best Trade"
              value={fmtRs(stats.best.pnl)}
              color="text-emerald-400"
              sub={fmtDate(stats.best.timestamp)}
            />
            <KPIBox label={`Current Streak`}
              value={`${stats.streak}${stats.streakType}`}
              color={stats.streakType === "W" ? "text-emerald-400" : "text-rose-400"}
              sub={stats.streakType === "W" ? "Winning streak" : "Losing streak"}
            />
          </div>

          {/* Win/Loss Bar */}
          <div className="rounded-xl border border-slate-800/50 bg-[#08101a] p-4">
            <SectionHead icon={<Target size={12}/>} title="Win/Loss Distribution" />
            <div className="flex items-center gap-3 mt-3">
              <span className="text-[9px] text-emerald-400 font-black w-14">{stats.wins} Wins</span>
              <div className="flex-1 h-3 bg-rose-500/15 rounded-full overflow-hidden border border-rose-500/10">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
                  style={{ width: `${stats.winRate}%` }} />
              </div>
              <span className="text-[9px] text-rose-400 font-black w-14 text-right">{stats.losses} Losses</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[8px] text-slate-600 font-mono">{stats.winRate.toFixed(1)}% win rate</span>
              <span className="text-[8px] text-slate-600 font-mono">RR: {(stats.avgWin / (stats.avgLoss || 1)).toFixed(2)}</span>
            </div>
          </div>

          {/* Cumulative P&L Chart */}
          {cumPnl.length > 1 && (
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a] p-4">
              <SectionHead icon={<TrendingUp size={12}/>}
                title={`Cumulative P&L (Last ${chartTrades.length} Trades)`}
              />
              <div className="mt-3 relative" style={{ height: chartH + 24 }}>
                <svg width="100%" height={chartH} viewBox={`0 0 ${Math.max(chartTrades.length, 2) * 40} ${chartH}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={cumPnl[cumPnl.length - 1] >= 0 ? "#10b981" : "#ef4444"} stopOpacity="0.25" />
                      <stop offset="100%" stopColor={cumPnl[cumPnl.length - 1] >= 0 ? "#10b981" : "#ef4444"} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Zero line */}
                  <line x1="0" y1={chartH / 2} x2={chartTrades.length * 40} y2={chartH / 2}
                    stroke="#1e293b" strokeWidth="1" strokeDasharray="4,4" />
                  {/* Grid lines */}
                  {[0.25, 0.75].map(y => (
                    <line key={y} x1="0" y1={chartH * y} x2={chartTrades.length * 40} y2={chartH * y}
                      stroke="#0f172a" strokeWidth="1" />
                  ))}
                  {/* Area fill */}
                  <polygon fill="url(#pnlGrad)"
                    points={[
                      `0,${chartH / 2}`,
                      ...cumPnl.map((v, i) => `${(i + 0.5) * 40},${chartH / 2 - (v / maxAbs) * (chartH / 2 - 10)}`),
                      `${(cumPnl.length - 0.5) * 40},${chartH / 2}`
                    ].join(" ")}
                  />
                  {/* Line */}
                  <polyline fill="none"
                    stroke={cumPnl[cumPnl.length - 1] >= 0 ? "#10b981" : "#ef4444"}
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    points={cumPnl.map((v, i) => `${(i + 0.5) * 40},${chartH / 2 - (v / maxAbs) * (chartH / 2 - 10)}`).join(" ")}
                  />
                  {/* Dots */}
                  {cumPnl.map((v, i) => (
                    <circle key={i} cx={(i + 0.5) * 40} cy={chartH / 2 - (v / maxAbs) * (chartH / 2 - 10)} r="2.5"
                      fill={v >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </svg>
                {/* X-axis labels */}
                <div className="flex justify-between text-[7px] text-slate-700 font-mono mt-1">
                  {chartTrades.map((t, i) => (
                    i % Math.ceil(chartTrades.length / 8) === 0
                      ? <span key={i}>{new Date(t.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "numeric" })}</span>
                      : <span key={i}></span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Best / Worst */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Award size={12} className="text-emerald-400"/>
                <span className="text-[9px] font-black text-emerald-400 uppercase">Best Trade</span>
              </div>
              <div className="text-2xl font-black text-emerald-400 font-mono">+₹{fmt(stats.best.pnl)}</div>
              <div className="text-[8px] text-slate-500 mt-1">
                {stats.best.direction} · ₹{stats.best.entry_price} · {fmtDate(stats.best.timestamp)}
              </div>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={12} className="text-rose-400"/>
                <span className="text-[9px] font-black text-rose-400 uppercase">Worst Trade</span>
              </div>
              <div className="text-2xl font-black text-rose-400 font-mono">₹{fmt(stats.worst.pnl)}</div>
              <div className="text-[8px] text-slate-500 mt-1">
                {stats.worst.direction} · ₹{stats.worst.entry_price} · {fmtDate(stats.worst.timestamp)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* STRATEGIES */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeSection === "strategies" && (
        <div className="space-y-3">
          <SectionHead icon={<Zap size={12}/>} title="Strategy-wise Breakdown"
            sub={`${strategyBreakdown.length} strategies · sorted by Total P&L`} />

          <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-1 px-4 py-2 border-b border-slate-800/40 text-[7px] font-black text-slate-600 uppercase tracking-wider">
              <div className="col-span-4">Strategy</div>
              <div className="col-span-1 text-center">Trades</div>
              <div className="col-span-1 text-center">W</div>
              <div className="col-span-1 text-center">L</div>
              <div className="col-span-2 text-center">Win %</div>
              <div className="col-span-1 text-center">Avg</div>
              <div className="col-span-2 text-right">Total P&L</div>
            </div>

            <div className="divide-y divide-slate-800/20 max-h-[500px] overflow-y-auto">
              {strategyBreakdown.length === 0 ? (
                <div className="p-6 text-center text-slate-700 text-[9px] font-mono">
                  No strategy data — trades mein notes field empty hai
                </div>
              ) : strategyBreakdown.map((s, i) => {
                const wr = (s.wins / s.trades) * 100;
                return (
                  <div key={s.id} className={`grid grid-cols-12 gap-1 px-4 py-3 items-center hover:bg-slate-800/10 transition-colors
                    ${s.totalPnl > 0 ? 'border-l-2 border-emerald-500/30' : 'border-l-2 border-rose-500/20'}`}>
                    <div className="col-span-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[7px] font-mono text-slate-700 w-4">{i + 1}.</span>
                        <div>
                          <div className="text-[9px] font-black text-white leading-tight truncate">{s.name}</div>
                          <div className="text-[6px] font-mono text-slate-600">{s.id}</div>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-1 text-center text-[9px] font-mono text-slate-400">{s.trades}</div>
                    <div className="col-span-1 text-center text-[9px] font-mono text-emerald-500">{s.wins}</div>
                    <div className="col-span-1 text-center text-[9px] font-mono text-rose-500">{s.losses}</div>
                    <div className="col-span-2">
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                          <div className={`h-full rounded-full ${wr >= 60 ? 'bg-emerald-500' : wr >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            style={{ width: `${wr}%` }} />
                        </div>
                        <span className={`text-[8px] font-black font-mono ${wr >= 60 ? 'text-emerald-400' : wr >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
                          {wr.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className={`text-[8px] font-mono ${s.avgPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {s.avgPnl >= 0 ? '+' : ''}₹{Math.abs(s.avgPnl).toFixed(0)}
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className={`text-[10px] font-black font-mono ${s.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {s.totalPnl >= 0 ? '+' : ''}₹{fmt(s.totalPnl)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* CALENDAR HEATMAP */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeSection === "calendar" && (
        <div className="space-y-3">
          <SectionHead icon={<Calendar size={12}/>} title={`Day-wise P&L — ${calendarData.monthName}`} />

          <div className="rounded-xl border border-slate-800/50 bg-[#08101a] p-4">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                <div key={d} className="text-center text-[7px] font-black text-slate-600 uppercase">{d}</div>
              ))}
            </div>
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells before first day */}
              {Array.from({ length: calendarData.firstDay }).map((_, i) => (
                <div key={`e${i}`} />
              ))}
              {/* Day cells */}
              {Array.from({ length: calendarData.daysInMonth }, (_, i) => i + 1).map(day => {
                const pnl = calendarData.map[day];
                const hasTrade = pnl !== undefined;
                const isToday = day === new Date().getDate();
                return (
                  <div key={day}
                    className={`rounded-lg aspect-square flex flex-col items-center justify-center p-0.5 border transition-colors
                      ${isToday ? 'border-indigo-500/40 ring-1 ring-indigo-500/20' : 'border-transparent'}
                      ${hasTrade && pnl >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : ''}
                      ${hasTrade && pnl  < 0 ? 'bg-rose-500/10 border-rose-500/20'     : ''}
                      ${!hasTrade ? 'bg-slate-900/20' : ''}`}>
                    <div className={`text-[8px] font-black ${isToday ? 'text-indigo-400' : 'text-slate-500'}`}>{day}</div>
                    {hasTrade && (
                      <div className={`text-[6px] font-black font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pnl >= 0 ? '+' : ''}₹{Math.abs(pnl) >= 1000 ? `${(pnl / 1000).toFixed(1)}k` : fmt(pnl)}
                      </div>
                    )}
                    {!hasTrade && <div className="text-[6px] text-slate-800">—</div>}
                  </div>
                );
              })}
            </div>

            {/* Monthly total */}
            {(() => {
              const monthTotal = (Object.values(calendarData.map) as number[]).reduce((a, b) => a + b, 0);
              const tradeDays  = Object.keys(calendarData.map).length;
              return tradeDays > 0 ? (
                <div className="mt-3 pt-3 border-t border-slate-800/30 flex items-center justify-between">
                  <span className="text-[8px] text-slate-600 font-mono">{tradeDays} trading days this month</span>
                  <span className={`text-sm font-black font-mono ${monthTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {monthTotal >= 0 ? '+' : ''}₹{fmt(monthTotal)} MTD
                  </span>
                </div>
              ) : null;
            })()}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[7px] text-slate-600 font-mono">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/30 inline-block"/> Profit day</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-500/20 border border-rose-500/30 inline-block"/> Loss day</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-900/20 border border-slate-800/20 inline-block"/> No trade</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TRADE LOG */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeSection === "log" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHead icon={<FileText size={12}/>} title="Trade Log"
              sub={`${logTrades.length} trades shown`} />
            {/* Filter pills */}
            <div className="flex items-center gap-1">
              <Filter size={9} className="text-slate-600"/>
              {(["ALL", "WIN", "LOSS"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-[7px] font-black uppercase px-2 py-0.5 rounded border cursor-pointer transition-all
                    ${filter === f
                      ? f === "WIN"  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      : f === "LOSS" ? "bg-rose-500/15 border-rose-500/30 text-rose-400"
                      :               "bg-indigo-500/15 border-indigo-500/30 text-indigo-400"
                      : "bg-transparent border-slate-700/30 text-slate-600 hover:text-slate-400"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
            {/* Column Headers */}
            <div className="grid grid-cols-12 gap-1 px-4 py-2 border-b border-slate-800/40 text-[10px] font-black text-slate-600 uppercase tracking-wider">
              <div className="col-span-4">Strategy / Instrument</div>
              <div className="col-span-1 text-center">Dir</div>
              <div className="col-span-2 text-right">Entry ₹</div>
              <div className="col-span-2 text-right">Exit ₹</div>
              <div className="col-span-1 text-center cursor-pointer select-none flex items-center justify-center gap-0.5"
                onClick={() => toggleSort("timestamp")}>
                Date {sortCol === "timestamp" ? (sortDir === "desc" ? <ChevronDown size={10}/> : <ChevronUp size={10}/>) : null}
              </div>
              <div className="col-span-2 text-right cursor-pointer select-none flex items-center justify-end gap-0.5"
                onClick={() => toggleSort("pnl")}>
                P&L {sortCol === "pnl" ? (sortDir === "desc" ? <ChevronDown size={10}/> : <ChevronUp size={10}/>) : null}
              </div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-slate-800/20 max-h-[500px] overflow-y-auto">
              {logTrades.length === 0 ? (
                <div className="p-6 text-center text-slate-700 text-[9px] font-mono">No trades match filter</div>
            ) : logTrades.map(t => {
                const notes    = parseNotes(t.notes, t);
                const isPnlPos = t.pnl >= 0;
                const dir      = notes.displayDir || t.direction || '—';
                const isCE     = dir === 'CE' || dir === 'BUY';
                return (
                  <div key={t.id}
                    className={`grid grid-cols-12 gap-1 px-4 py-2.5 items-center hover:bg-slate-800/10 transition-colors`}>
                    <div className="col-span-4">
                      <div className="text-[12px] font-black text-white truncate leading-tight">
                        {notes.displayName || '—'}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">
                        {notes.strategyId || t.instrument} {notes.exitReason ? `· ${notes.exitReason.slice(0, 20)}` : ''}
                        {notes.reason ? `· ${notes.reason.slice(0, 25)}` : ''}
                      </div>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className={`text-[10px] font-black px-1 rounded ${isCE ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                        {dir}
                      </span>
                    </div>
                    <div className="col-span-2 text-right text-[12px] font-mono text-slate-400">
                      ₹{t.entry_price?.toFixed(0) ?? "—"}
                    </div>
                    <div className="col-span-2 text-right text-[12px] font-mono text-slate-400">
                      {t.exit_price ? `₹${t.exit_price.toFixed(0)}` : "—"}
                    </div>
                    <div className="col-span-1 text-center text-[10px] font-mono text-slate-500">
                      {fmtDate(t.timestamp)}<br/>
                      <span className="text-slate-400">{fmtTime(t.timestamp)}</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className={`text-[14px] font-black font-mono ${isPnlPos ? "text-emerald-400" : "text-rose-400"}`}>
                        {isPnlPos ? "+" : ""}₹{fmt(t.pnl)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VELOCITY STUDIES (existing) */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeSection === "velocity" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-900 pb-2">
            <SectionHead icon={<Activity size={12}/>} title="Time-Interval Market Velocity Studies"
              sub={patternSummary ? `${patternSummary.sampleDaysCount} sessions analysed` : "Loading..."} />

            {/* Date Selector Dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-slate-500 uppercase font-black font-mono">Date:</span>
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-300 text-[9px] font-mono rounded px-2.5 py-1 outline-none cursor-pointer hover:border-slate-700 transition-colors"
              >
                {availableDates.map(d => {
                  const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];
                  return (
                    <option key={d} value={d}>
                      {d === todayIST ? `${d} (Today - Live)` : d}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {!patternSummary ? (
            <div className="p-8 text-center text-slate-700 text-[9px] font-mono">No pattern data available</div>
          ) : (
            <div className="space-y-3">
              {/* Core metrics */}
              {patternSummary.intervalStats && (
                <>
                  <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                    {[
                      { label: "CE Breakout Ext", val: `+${patternSummary.avgCeExtension} pts`, color: "text-emerald-400" },
                      { label: "PE Breakdown Ext", val: `+${patternSummary.avgPeExtension} pts`, color: "text-rose-400" },
                      { label: "Upside Overshoot", val: `${patternSummary.avgUpsideOvershoot} pts`, color: "text-sky-400" },
                      { label: "Downside Overshoot", val: `${patternSummary.avgDownsideOvershoot} pts`, color: "text-pink-400" },
                    ].map(m => (
                      <div key={m.label} className="p-2.5 rounded-lg border border-slate-800/40 bg-slate-900/20">
                        <div className="text-[7px] text-slate-500 uppercase font-black">{m.label}</div>
                        <div className={`text-sm font-extrabold mt-0.5 ${m.color}`}>{m.val}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
                    <table className="w-full text-xs text-left font-mono">
                      <thead className="bg-slate-950/40 text-slate-500 uppercase text-[7px] border-b border-slate-800/40">
                        <tr>
                          <th className="p-2 pl-3">Time Interval</th>
                          <th className="p-2 text-right">Range</th>
                          <th className="p-2 text-right">Volatility %</th>
                          <th className="p-2 text-center">Speed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/40">
                        {(() => {
                          const nowIST = new Date(Date.now() + 5.5 * 3600000);
                          const activeHour = nowIST.getUTCHours();
                          const activeMinute = nowIST.getUTCMinutes() - (nowIST.getUTCMinutes() % 15);
                          const activeIntervalStr = `${String(activeHour).padStart(2, '0')}:${String(activeMinute).padStart(2, '0')}`;
                          const todayIST = nowIST.toISOString().split('T')[0];
                          const isSelectedDateToday = selectedDate === todayIST;

                          return patternSummary.intervalStats.map((item: any, idx: number) => {
                            const rp = item.avgRangePct || 0;
                            const [speedLabel, speedColor] = rp >= 0.15
                              ? ["FAST / HIGH VOL", "text-rose-400 bg-rose-500/10 border-rose-500/20"]
                              : rp >= 0.08
                              ? ["MODERATE", "text-indigo-400 bg-indigo-500/10 border-indigo-500/20"]
                              : ["SLOW", "text-slate-400 bg-slate-500/10 border-slate-500/20"];

                            const [h, m] = item.time.split(":").map(Number);
                            const em = m + 15, eh = h + (em >= 60 ? 1 : 0);
                            const timeLabel = `${item.time} - ${String(eh).padStart(2,"0")}:${String(em % 60).padStart(2,"0")}`;

                            const isActive = isSelectedDateToday && item.time === activeIntervalStr;

                            return (
                              <tr key={idx} className={`transition-all duration-300 ${isActive ? 'bg-indigo-950/40 border-y border-indigo-500/30' : 'hover:bg-slate-900/40'}`}>
                                <td className="p-2 pl-3 text-slate-200 font-bold flex items-center gap-2">
                                  {isActive && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />}
                                  {timeLabel}
                                </td>
                                <td className="p-2 text-right font-bold text-white">₹{item.avgRange.toFixed(1)}</td>
                                <td className="p-2 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-10 h-1 bg-slate-850 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${rp >= 0.15 ? 'bg-rose-500' : rp >= 0.08 ? 'bg-indigo-500' : 'bg-slate-700'}`}
                                        style={{ width: `${Math.min(100, (rp / 0.3) * 100)}%` }} />
                                    </div>
                                    <span className="font-bold text-teal-400 text-[8px]">{rp.toFixed(3)}%</span>
                                  </div>
                                </td>
                                <td className="p-2 text-center">
                                  <span className={`px-2 py-0.5 rounded border text-[7px] font-black uppercase ${speedColor}`}>
                                    {speedLabel}
                                  </span>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[8px] text-slate-600 italic text-right">
                    Highest velocity: 09:15–10:00 & 14:30–15:30
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PerformanceAnalytics;
