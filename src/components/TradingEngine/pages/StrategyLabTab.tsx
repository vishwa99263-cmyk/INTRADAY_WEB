import React, { useState, useMemo, useEffect } from "react";
import {
  Trophy, TrendingUp, TrendingDown, BarChart2, Activity,
  Zap, Shield, RefreshCw, ChevronDown, ChevronUp, Award,
  Target, Clock, Calendar, Play, CheckCircle, Trash2, List, PlusCircle, AlertCircle, X
} from "lucide-react";
import { STRATEGY_REGISTRY } from "../../../engine/strategyRegistry";
import {
  generateMonthSimulation,
  type StrategyLabResult,
  type StrategyLabState,
} from "../../../engine/strategyLabStore";

// ── Grade Badge ───────────────────────────────────────────────────────────────
const GradeBadge: React.FC<{ grade: StrategyLabResult["grade"] }> = ({ grade }) => {
  const style: Record<string, string> = {
    "A+": "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    "A":  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "B+": "bg-sky-500/15 text-sky-300 border-sky-500/30",
    "B":  "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "C":  "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "D":  "bg-orange-500/15 text-orange-400 border-orange-500/30",
    "F":  "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${style[grade] || "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}>
      {grade}
    </span>
  );
};

// ── Mini Equity Curve Bar ─────────────────────────────────────────────────────
const MiniEquity: React.FC<{ curve: number[]; positive: boolean }> = ({ curve, positive }) => {
  if (curve.length < 2) return null;
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const range = max - min || 1;
  const w = 60;
  const h = 24;
  const pts = curve.map((v, i) => {
    const x = (i / (curve.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none"
        stroke={positive ? "#34d399" : "#f87171"} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// ── Strategy Row ──────────────────────────────────────────────────────────────
const StrategyRow: React.FC<{ result: StrategyLabResult; rank: number }> = ({ result: r, rank }) => {
  const [expanded, setExpanded] = useState(false);
  const isPositive = r.totalPnL >= 0;
  const rankColors = ["text-amber-400", "text-slate-300", "text-orange-400"];
  const rankIcons  = ["🥇", "🥈", "🥉"];

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${
      rank === 1 ? "border-amber-500/30 bg-gradient-to-r from-amber-950/20 to-slate-900/80" :
      rank === 2 ? "border-slate-500/30 bg-slate-900/60" :
      rank === 3 ? "border-orange-500/20 bg-slate-900/60" :
                   "border-slate-700/20 bg-slate-900/40"
    }`}>
      {/* Main Row */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-800/20"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Rank */}
        <div className={`w-7 h-7 flex items-center justify-center flex-shrink-0 font-black text-sm ${rank <= 3 ? rankColors[rank - 1] : "text-slate-600"}`}>
          {rank <= 3 ? rankIcons[rank - 1] : rank}
        </div>

        {/* Name + tags */}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-black text-slate-100 truncate">{r.strategyName}</div>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 font-black">{r.mode}</span>
            {r.tags.slice(0, 2).map(t => (
              <span key={t} className="text-[8px] px-1.5 py-0.5 rounded bg-slate-700/30 text-slate-500 border border-slate-600/20">{t}</span>
            ))}
          </div>
        </div>

        {/* Mini equity curve */}
        <div className="flex-shrink-0 hidden sm:block">
          <MiniEquity curve={r.equityCurve} positive={isPositive} />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className={`text-[13px] font-black font-mono ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
              {isPositive ? "+" : ""}₹{r.totalPnL.toLocaleString()}
            </div>
            <div className="text-[8px] text-slate-500">{r.winRate}% WR</div>
          </div>
          <GradeBadge grade={r.grade} />
          {expanded ? <ChevronUp size={12} className="text-slate-500"/> : <ChevronDown size={12} className="text-slate-500"/>}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-slate-800/40 px-3 py-3 space-y-3">
          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: "Total Trades", value: r.totalTrades, color: "text-slate-200" },
              { label: "Wins", value: r.wins, color: "text-emerald-400" },
              { label: "Losses", value: r.losses, color: "text-rose-400" },
              { label: "Win Rate", value: `${r.winRate}%`, color: r.winRate >= 60 ? "text-emerald-400" : r.winRate >= 50 ? "text-amber-400" : "text-rose-400" },
              { label: "Avg Win", value: `₹${r.avgWin.toLocaleString()}`, color: "text-emerald-400" },
              { label: "Avg Loss", value: `₹${Math.abs(r.avgLoss).toLocaleString()}`, color: "text-rose-400" },
              { label: "Profit Factor", value: r.profitFactor, color: r.profitFactor >= 1.5 ? "text-emerald-400" : r.profitFactor >= 1.2 ? "text-amber-400" : "text-rose-400" },
              { label: "Sharpe", value: r.sharpeRatio, color: r.sharpeRatio >= 1 ? "text-emerald-400" : "text-amber-400" },
              { label: "Max Drawdown", value: `₹${Math.abs(r.maxDrawdown).toLocaleString()}`, color: "text-rose-400" },
              { label: "Best Day", value: `₹${r.bestDay.toLocaleString()}`, color: "text-emerald-400" },
              { label: "Worst Day", value: `₹${Math.abs(r.worstDay).toLocaleString()}`, color: "text-rose-400" },
              { label: "Avg/Day", value: `₹${r.avgDailyPnL.toLocaleString()}`, color: r.avgDailyPnL >= 0 ? "text-emerald-400" : "text-rose-400" },
            ].map(s => (
              <div key={s.label} className="bg-slate-900/60 rounded px-2 py-1.5 text-center border border-slate-700/20">
                <div className="text-[7px] text-slate-500 uppercase font-black truncate">{s.label}</div>
                <div className={`text-[11px] font-black font-mono mt-0.5 ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Streak + Fake Breakouts */}
          <div className="flex gap-2">
            <div className="flex-1 bg-slate-900/50 rounded px-2 py-1.5 border border-slate-700/20">
              <div className="text-[8px] text-slate-500 font-black uppercase">Max Win Streak</div>
              <div className="text-[13px] font-black text-emerald-400 mt-0.5">{r.consecutiveWins} trades</div>
            </div>
            <div className="flex-1 bg-slate-900/50 rounded px-2 py-1.5 border border-slate-700/20">
              <div className="text-[8px] text-slate-500 font-black uppercase">Max Loss Streak</div>
              <div className="text-[13px] font-black text-rose-400 mt-0.5">{r.consecutiveLoss} trades</div>
            </div>
            <div className="flex-1 bg-emerald-950/30 rounded px-2 py-1.5 border border-emerald-500/20">
              <div className="text-[8px] text-emerald-500 font-black uppercase">Fake BO Blocked</div>
              <div className="text-[13px] font-black text-emerald-300 mt-0.5">{r.fakeBreakoutsBlocked} signals</div>
            </div>
          </div>

          {/* Last 5 trades */}
          {r.trades.filter(t => t.pnl !== 0).length > 0 && (
            <div>
              <div className="text-[8px] text-slate-500 font-black uppercase tracking-widest mb-1.5">Recent Trades</div>
              <div className="space-y-1">
                {r.trades.filter(t => t.pnl !== 0).slice(-5).reverse().map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-[9px] bg-slate-900/40 rounded px-2 py-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.pnl > 0 ? "bg-emerald-400" : "bg-rose-400"}`}/>
                    <span className="text-slate-500 font-mono">{t.date}</span>
                    <span className="text-slate-400">{t.direction}</span>
                    <span className="text-slate-500">{t.index}</span>
                    <span className="text-slate-500 flex-1">{t.exitReason}</span>
                    <span className={`font-black font-mono ${t.pnl > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {t.pnl > 0 ? "+" : ""}₹{t.pnl.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Summary Cards ─────────────────────────────────────────────────────────────
const SumCard: React.FC<{ label: string; value: string; sub?: string; color: string; icon: React.ReactNode }> = ({ label, value, sub, color, icon }) => (
  <div className="bg-slate-900/60 border border-slate-700/20 rounded-xl px-3 py-3">
    <div className="flex items-center gap-1.5 mb-1">
      <div className={`${color} opacity-70`}>{icon}</div>
      <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">{label}</span>
    </div>
    <div className={`text-[18px] font-black font-mono ${color}`}>{value}</div>
    {sub && <div className="text-[8px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

// ── Sort Options ──────────────────────────────────────────────────────────────
type SortKey = "rank" | "pnl" | "winRate" | "profitFactor" | "sharpe" | "drawdown";

interface QueueTask {
  id: string;
  strategyId: string;
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX";
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  createdAt: string;
  completedAt: string | null;
  resultId: string | null;
  error: string | null;
}

interface BacktestRun {
  id: string;
  created_at: string;
  strategy_name: string;
  index_symbol: string;
  start_time: string;
  end_time: string;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  max_drawdown: number;
  avg_rr: number;
  strategy_config: any;
  trade_logs: any[];
}

const SYSTEM_STRATEGIES = [
  { id: "ORB_NAKED", name: "9:30 AM Opening Range Breakout (ORB)" },
  { id: "VWAP_VOLUME", name: "VWAP & Volume Momentum" },
  { id: "EXPIRY_1PM_BURST", name: "Expiry Day 1 PM Momentum Burst" },
  { id: "OI_SHIFT_TRAP", name: "OI Shift Trap" },
  { id: "EMA_CROSSOVER", name: "EMA Crossover Strategy" },
];

const StrategyLabTab: React.FC = () => {
  // Main Tab State: THEORETICAL vs HISTORICAL
  const [activeTab, setActiveTab] = useState<"THEORETICAL" | "HISTORICAL">("HISTORICAL");

  // Theoretical Sim States
  const [labState, setLabState] = useState<StrategyLabState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("rank");
  const [filterMode, setFilterMode] = useState<"ALL" | "INTRADAY" | "POSITIONAL">("ALL");
  const [showOnlyPassing, setShowOnlyPassing] = useState(false);

  // Historical States
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [userStrategies, setUserStrategies] = useState<any[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("ORB_NAKED");
  const [selectedInstrument, setSelectedInstrument] = useState<"NIFTY" | "BANKNIFTY" | "SENSEX">("NIFTY");
  const [selectedRun, setSelectedRun] = useState<BacktestRun | null>(null);
  const [isRunsLoading, setIsRunsLoading] = useState(false);
  const [isQueueActionLoading, setIsQueueActionLoading] = useState(false);

  // Load simulation data if missing on tab load
  const handleRunLab = () => {
    setIsRunning(true);
    setTimeout(() => {
      const strategies = STRATEGY_REGISTRY.map(s => ({
        id:   s.id,
        name: s.name,
        mode: s.mode,
        tags: s.tags ?? [],
        winRateHistorical: s.winRateHistorical,
        risk: { maxLossRs: s.risk.maxLossRs, targetRs: s.risk.targetRs },
      }));
      const result = generateMonthSimulation(strategies, new Date());
      setLabState(result);
      setIsRunning(false);
    }, 1200);
  };

  // Poll queue and reload runs
  const fetchQueue = async () => {
    try {
      const res = await fetch("/api/backtest/queue");
      const data = await res.json();
      if (data.success) {
        setQueue(data.queue);
      }
    } catch (e) {
      console.error("[StrategyLab] Queue fetch error:", e);
    }
  };

  const fetchRuns = async (silent = false) => {
    if (!silent) setIsRunsLoading(true);
    try {
      const res = await fetch("/api/backtest/runs");
      const data = await res.json();
      if (data.success) {
        setRuns(data.runs);
      }
    } catch (e) {
      console.error("[StrategyLab] Runs fetch error:", e);
    } finally {
      if (!silent) setIsRunsLoading(false);
    }
  };

  const fetchStrategies = async () => {
    try {
      const res = await fetch("/api/backtest/strategies");
      const data = await res.json();
      if (data.success) {
        setUserStrategies(data.strategies);
      }
    } catch (e) {
      console.error("[StrategyLab] Strategies fetch error:", e);
    }
  };

  // Trigger historical backtest API endpoints
  const handleQueueTask = async () => {
    setIsQueueActionLoading(true);
    try {
      const res = await fetch("/api/backtest/queue/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId: selectedStrategyId, instrument: selectedInstrument }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchQueue();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsQueueActionLoading(false);
    }
  };

  const handleQueueFullSuite = async () => {
    setIsQueueActionLoading(true);
    try {
      const instruments = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
      const strategyIds = ["ORB_NAKED", "VWAP_VOLUME", "EXPIRY_1PM_BURST", "OI_SHIFT_TRAP", "EMA_CROSSOVER"];
      
      for (const inst of instruments) {
        for (const stratId of strategyIds) {
          await fetch("/api/backtest/queue/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ strategyId: stratId, instrument: inst }),
          });
        }
      }
      await fetchQueue();
    } catch (e) {
      console.error(e);
    } finally {
      setIsQueueActionLoading(false);
    }
  };

  const handleClearQueue = async () => {
    setIsQueueActionLoading(true);
    try {
      const res = await fetch("/api/backtest/queue/clear", { method: "POST" });
      if (res.ok) {
        await fetchQueue();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsQueueActionLoading(false);
    }
  };

  const handleRunQueue = async () => {
    try {
      await fetch("/api/backtest/queue/run", { method: "POST" });
      await fetchQueue();
    } catch (e) {
      console.error(e);
    }
  };

  // Set up polling intervals
  useEffect(() => {
    if (activeTab === "HISTORICAL") {
      fetchQueue();
      fetchRuns();
      fetchStrategies();

      const queueInterval = setInterval(fetchQueue, 3000);
      return () => clearInterval(queueInterval);
    }
  }, [activeTab]);

  // If a task is PROCESSING, poll runs silently to update list immediately on completion
  useEffect(() => {
    if (activeTab === "HISTORICAL" && queue.some(t => t.status === "PROCESSING" || t.status === "PENDING")) {
      const runsInterval = setInterval(() => fetchRuns(true), 4000);
      return () => clearInterval(runsInterval);
    }
  }, [queue, activeTab]);

  // Compute sorting/filtering for theoretical mode
  const sortedResults = useMemo(() => {
    if (!labState) return [];
    let list = [...labState.results];
    if (filterMode !== "ALL") list = list.filter(r => r.mode === filterMode);
    if (showOnlyPassing) list = list.filter(r => ["A+","A","B+","B"].includes(r.grade));

    list.sort((a, b) => {
      switch (sortBy) {
        case "pnl":          return b.totalPnL - a.totalPnL;
        case "winRate":      return b.winRate - a.winRate;
        case "profitFactor": return b.profitFactor - a.profitFactor;
        case "sharpe":       return b.sharpeRatio - a.sharpeRatio;
        case "drawdown":     return a.maxDrawdown - b.maxDrawdown;
        default:             return a.rank - b.rank;
      }
    });
    return list;
  }, [labState, sortBy, filterMode, showOnlyPassing]);

  const bestResult = labState?.results.find(r => r.strategyId === labState.bestStrategyId);
  const totalPnLAll = labState?.results.reduce((s, r) => s + r.totalPnL, 0) ?? 0;

  // Render sub-views based on activeTab
  return (
    <div className="space-y-4">
      {/* Sub-Tab Navigation */}
      <div className="flex border-b border-slate-800 p-0.5 gap-1 max-w-md bg-slate-950/60 rounded-xl">
        <button
          onClick={() => setActiveTab("HISTORICAL")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all ${
            activeTab === "HISTORICAL"
              ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Activity size={12} />
          Historical Backtests
        </button>
        <button
          onClick={() => setActiveTab("THEORETICAL")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all ${
            activeTab === "THEORETICAL"
              ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Trophy size={12} />
          Theoretical Sim
        </button>
      </div>

      {activeTab === "THEORETICAL" ? (
        // ── THEORETICAL VIEW ────────────────────────────────────────────────────────
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-violet-950/40 via-slate-900 to-slate-950 border border-violet-500/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center">
                    <Trophy size={14} className="text-violet-400"/>
                  </div>
                  <h2 className="text-sm font-black text-white">Strategy Lab — Theoretical Simulation</h2>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/25">PAPER MODE</span>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/25">⚠️ SIMULATED</span>
                </div>
                <p className="text-[10px] text-slate-400 max-w-md">
                  Sabhi <span className="text-violet-300 font-black">{STRATEGY_REGISTRY.length} strategies</span> simultaneously paper trade mode mein simulate hoti hain.
                  Unlimited positions. 22 trading days.
                </p>
                <div className="mt-2 px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-500/20">
                  <p className="text-[9px] text-amber-400 leading-relaxed">
                    ⚠️ <span className="font-black">Important:</span> Ye results Fyers historical price data se generate nahi hote.
                    Ye sirf har strategy ke theoretical win rate aur risk parameters se ek statistical simulation hai.
                    Select standard historical backtesting tab above for Fyers historical runs.
                  </p>
                </div>
              </div>
              <button
                onClick={handleRunLab}
                disabled={isRunning}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-[11px] transition-all flex-shrink-0 ${
                  isRunning
                    ? "bg-slate-700/50 text-slate-500 cursor-not-allowed"
                    : "bg-violet-500/20 border border-violet-500/40 text-violet-300 hover:bg-violet-500/30"
                }`}
              >
                {isRunning
                  ? <><RefreshCw size={12} className="animate-spin"/> Running...</>
                  : <><Play size={12}/> {labState ? "Re-run Simulation" : "Run Simulation"}</>
                }
              </button>
            </div>

            {!labState && !isRunning && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { icon: "📅", label: "Duration", value: "22 Trading Days (≈1 Month)" },
                  { icon: "♾️", label: "Positions", value: "Unlimited (Paper Mode)" },
                  { icon: "🤖", label: "Fake BO Filter", value: "Active on all strategies" },
                ].map(i => (
                  <div key={i.label} className="bg-slate-900/50 rounded-lg px-3 py-2 border border-slate-700/20">
                    <div className="text-[10px] text-slate-500">{i.icon} {i.label}</div>
                    <div className="text-[10px] font-black text-slate-300 mt-0.5">{i.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isRunning && (
            <div className="rounded-xl border border-violet-500/20 bg-slate-900/60 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto mb-3 animate-pulse">
                <Activity size={20} className="text-violet-400"/>
              </div>
              <div className="text-sm font-black text-slate-300">Theoretical simulation chal rahi hai...</div>
              <div className="text-[10px] text-slate-500 mt-1">Sabhi {STRATEGY_REGISTRY.length} strategies simultaneously simulate ho rahi hain</div>
            </div>
          )}

          {labState && !isRunning && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SumCard
                  label="Best Strategy" icon={<Trophy size={12}/>}
                  value={bestResult?.grade ?? "-"}
                  sub={bestResult?.strategyName?.split(" ").slice(0,3).join(" ")}
                  color="text-amber-400"
                />
                <SumCard
                  label="Total Lab P&L" icon={<TrendingUp size={12}/>}
                  value={`₹${Math.abs(totalPnLAll).toLocaleString()}`}
                  sub={`${totalPnLAll >= 0 ? "Profit" : "Loss"} — All strategies combined`}
                  color={totalPnLAll >= 0 ? "text-emerald-400" : "text-rose-400"}
                />
                <SumCard
                  label="Fake BO Saved" icon={<Shield size={12}/>}
                  value={`₹${labState.fakeBreakoutsSaved.toLocaleString()}`}
                  sub="Estimated loss AI ne roka"
                  color="text-emerald-400"
                />
                <SumCard
                  label="Total Trades" icon={<Activity size={12}/>}
                  value={labState.totalTradesAllStrategies.toLocaleString()}
                  sub={`${labState.totalDaysElapsed} trading days`}
                  color="text-indigo-400"
                />
              </div>

              {bestResult && (
                <div className="rounded-xl bg-gradient-to-r from-amber-950/30 to-slate-900/80 border border-amber-500/30 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Award size={14} className="text-amber-400"/>
                    <span className="text-[11px] font-black text-amber-300 uppercase tracking-widest">🏆 1 Month Best Strategy</span>
                    <GradeBadge grade={bestResult.grade}/>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <div className="text-[18px] font-black text-white">{bestResult.strategyName}</div>
                      <div className="text-[10px] text-slate-400">{bestResult.mode} • {bestResult.tags.join(", ")}</div>
                    </div>
                    <div className="flex gap-3 ml-auto flex-wrap">
                      {[
                        { l: "P&L",  v: `+₹${bestResult.totalPnL.toLocaleString()}`, c: "text-emerald-400" },
                        { l: "WR",   v: `${bestResult.winRate}%`, c: "text-sky-400" },
                        { l: "PF",   v: bestResult.profitFactor, c: "text-violet-400" },
                        { l: "Sharpe",v: bestResult.sharpeRatio, c: "text-amber-400" },
                      ].map(s => (
                        <div key={s.l} className="text-center">
                          <div className="text-[8px] text-slate-500 uppercase font-black">{s.l}</div>
                          <div className={`text-[15px] font-black font-mono ${s.c}`}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-center">
                <div className="text-[9px] text-slate-500 font-black uppercase">Filter:</div>
                {(["ALL","INTRADAY","POSITIONAL"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setFilterMode(m)}
                    className={`px-2.5 py-1 rounded-lg text-[9px] font-black border transition-all ${
                      filterMode === m
                        ? "text-indigo-300 bg-indigo-500/15 border-indigo-500/30"
                        : "text-slate-500 bg-slate-900/30 border-slate-700/20"
                    }`}
                  >{m}</button>
                ))}
                <button
                  onClick={() => setShowOnlyPassing(p => !p)}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-black border transition-all ml-1 ${
                    showOnlyPassing
                      ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/30"
                      : "text-slate-500 bg-slate-900/30 border-slate-700/20"
                  }`}
                >
                  {showOnlyPassing ? <><CheckCircle size={9} className="inline mr-1"/>A/B only</> : "A/B only"}
                </button>

                <div className="text-[9px] text-slate-500 font-black uppercase ml-2">Sort:</div>
                {([
                  { k: "rank", l: "Rank" },
                  { k: "pnl",  l: "P&L" },
                  { k: "winRate", l: "Win %" },
                  { k: "profitFactor", l: "PF" },
                  { k: "sharpe", l: "Sharpe" },
                ] as Array<{ k: SortKey; l: string }>).map(s => (
                  <button
                    key={s.k}
                    onClick={() => setSortBy(s.k)}
                    className={`px-2.5 py-1 rounded-lg text-[9px] font-black border transition-all ${
                      sortBy === s.k
                        ? "text-violet-300 bg-violet-500/15 border-violet-500/30"
                        : "text-slate-500 bg-slate-900/30 border-slate-700/20"
                    }`}
                  >{s.l}</button>
                ))}

                <span className="text-[9px] text-slate-600 ml-auto">
                  {sortedResults.length} strategies
                </span>
              </div>

              <div className="space-y-2">
                {sortedResults.map((result, idx) => (
                  <StrategyRow key={result.strategyId} result={result} rank={idx + 1} />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        // ── HISTORICAL BACKTESTS VIEW ────────────────────────────────────────────────
        <div className="space-y-4">
          {/* Header Panel */}
          <div className="rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-950 border border-indigo-500/20 p-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                    <Activity size={14} className="text-indigo-400"/>
                  </div>
                  <h2 className="text-sm font-black text-white">Historical Backtest Dashboard</h2>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/25">LTP REALISTIC</span>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/25">FYERS HISTORIC DATA</span>
                </div>
                <p className="text-[10px] text-slate-400 max-w-xl">
                  Fyers historical 1-minute candle database se strategies run hoti hain. Intraday option buying setup simulator:
                  20-point fixed SL & 40-point target for ORB, and indicator-based SL for VWAP momentum.
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleQueueFullSuite}
                  disabled={isQueueActionLoading}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600/20 border border-violet-500/40 text-violet-300 hover:bg-violet-600/30 text-[11px] font-black transition-all"
                >
                  <List size={12} />
                  Queue Full Suite (15 Runs)
                </button>
                <button
                  onClick={handleClearQueue}
                  disabled={isQueueActionLoading}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-600/10 border border-rose-500/30 text-rose-400 hover:bg-rose-600/20 text-[11px] font-black transition-all"
                >
                  <Trash2 size={12} />
                  Clear Queue
                </button>
                <button
                  onClick={handleRunQueue}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 text-[11px] font-black transition-all"
                >
                  <Play size={12} />
                  Wake Worker
                </button>
              </div>
            </div>

            {/* Backtest Trigger Form */}
            <div className="mt-4 p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[8px] text-slate-500 font-black uppercase mb-1">Select Strategy</label>
                <select
                  value={selectedStrategyId}
                  onChange={(e) => setSelectedStrategyId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <optgroup label="System / Option Buying" className="bg-slate-950 text-slate-400">
                    {SYSTEM_STRATEGIES.map(s => (
                      <option key={s.id} value={s.id} className="text-slate-200">{s.name}</option>
                    ))}
                  </optgroup>
                  {userStrategies.length > 0 && (
                    <optgroup label="Custom / User Defined" className="bg-slate-950 text-slate-400">
                      {userStrategies.map(s => (
                        <option key={s.id} value={s.id} className="text-slate-200">{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="w-[120px]">
                <label className="block text-[8px] text-slate-500 font-black uppercase mb-1">Select Instrument</label>
                <select
                  value={selectedInstrument}
                  onChange={(e) => setSelectedInstrument(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="NIFTY">NIFTY</option>
                  <option value="BANKNIFTY">BANKNIFTY</option>
                  <option value="SENSEX">SENSEX</option>
                </select>
              </div>

              <button
                onClick={handleQueueTask}
                disabled={isQueueActionLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600/30 border border-indigo-500/50 hover:bg-indigo-600/40 text-indigo-300 text-[11px] font-black transition-all flex-shrink-0"
              >
                <PlusCircle size={12} />
                Queue Run
              </button>
            </div>
          </div>

          {/* Active Queue Status */}
          {queue.length > 0 && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3">
              <h3 className="text-[10px] text-slate-400 font-black uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Active Queue ({queue.filter(t => t.status !== "COMPLETED" && t.status !== "FAILED").length} Pending)
              </h3>
              <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
                {queue.map(task => {
                  const isProcessing = task.status === "PROCESSING";
                  const isFailed = task.status === "FAILED";
                  const isCompleted = task.status === "COMPLETED";
                  
                  return (
                    <div key={task.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-slate-950/40 border border-slate-800/60 rounded-lg text-[10px] gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          isProcessing ? "bg-amber-400 animate-pulse" :
                          isFailed ? "bg-rose-500" :
                          isCompleted ? "bg-emerald-400" : "bg-slate-500"
                        }`} />
                        <span className="font-black text-slate-200">{task.instrument}</span>
                        <span className="text-slate-400 font-medium">({SYSTEM_STRATEGIES.find(s => s.id === task.strategyId)?.name || userStrategies.find(s => s.id === task.strategyId)?.name || task.strategyId})</span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {isProcessing && (
                          <div className="flex items-center gap-2 w-[120px] sm:w-[150px]">
                            <div className="flex-1 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-full rounded-full transition-all duration-300" style={{ width: `${task.progress}%` }} />
                            </div>
                            <span className="font-mono text-[9px] text-slate-400">{task.progress}%</span>
                          </div>
                        )}
                        <span className={`font-black tracking-widest uppercase text-[8px] px-1.5 py-0.5 rounded border ${
                          isProcessing ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                          isFailed ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                          isCompleted ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          "bg-slate-500/10 text-slate-400 border-slate-700/20"
                        }`}>
                          {task.status}
                        </span>
                        {task.error && (
                          <span className="text-[9px] text-rose-400 flex items-center gap-1 max-w-[180px] truncate" title={task.error}>
                            <AlertCircle size={10} />
                            {task.error}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed Runs Section */}
          {isRunsLoading ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-8 text-center">
              <RefreshCw size={20} className="animate-spin text-slate-500 mx-auto mb-2" />
              <div className="text-xs font-black text-slate-400">Loading completed backtest runs...</div>
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-8 text-center">
              <AlertCircle size={24} className="text-slate-500 mx-auto mb-2" />
              <div className="text-xs font-black text-slate-300">No backtest runs found</div>
              <div className="text-[10px] text-slate-500 mt-1">Queue a strategy breakout above to generate historical results.</div>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Completed Simulation Runs</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {runs.map(run => {
                  const isProfit = run.profit_factor >= 1.0;
                  const winRatePct = parseFloat(String(run.win_rate));
                  
                  return (
                    <div key={run.id} className="bg-slate-900/40 border border-slate-800 hover:border-slate-700/80 rounded-xl p-3 flex flex-col justify-between space-y-3 transition-all">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-[12px] font-black text-slate-200 leading-tight">{run.strategy_name}</h4>
                          <div className="text-[9px] text-slate-500 mt-0.5">
                            {run.index_symbol.replace("-INDEX", "").replace("NSE:", "")} • Resolution: {run.strategy_config.timeframe || "1m"}
                          </div>
                        </div>
                        <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 border rounded-full ${
                          run.profit_factor >= 1.5 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                          run.profit_factor >= 1.0 ? "bg-sky-500/10 text-sky-400 border-sky-500/30" :
                          "bg-rose-500/10 text-rose-400 border-rose-500/30"
                        }`}>
                          PF: {run.profit_factor}
                        </span>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-4 gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/40">
                        <div className="text-center">
                          <span className="text-[7px] text-slate-500 font-bold uppercase block">Trades</span>
                          <span className="text-[11px] font-black text-slate-300 block mt-0.5">{run.total_trades}</span>
                        </div>
                        <div className="text-center">
                          <span className="text-[7px] text-slate-500 font-bold uppercase block">Win Rate</span>
                          <span className={`text-[11px] font-black block mt-0.5 ${winRatePct >= 55 ? "text-emerald-400" : "text-amber-400"}`}>
                            {winRatePct}%
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="text-[7px] text-slate-500 font-bold uppercase block">Sharpe</span>
                          <span className="text-[11px] font-black text-sky-400 block mt-0.5">{run.sharpe_ratio}</span>
                        </div>
                        <div className="text-center">
                          <span className="text-[7px] text-slate-500 font-bold uppercase block">Max DD</span>
                          <span className="text-[11px] font-black text-rose-400 block mt-0.5">₹{Math.round(run.max_drawdown)}</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-[9px]">
                        <span className="text-slate-500 font-mono">
                          {new Date(run.start_time).toLocaleDateString("en-IN")} → {new Date(run.end_time).toLocaleDateString("en-IN")}
                        </span>
                        <button
                          onClick={() => setSelectedRun(run)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-black border border-indigo-500/20 transition-all"
                        >
                          View Logs ({run.trade_logs?.length || 0})
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trade Log Detail Modal */}
      {selectedRun && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <div>
                <h3 className="text-sm font-black text-slate-100 flex items-center gap-2">
                  <Award size={14} className="text-indigo-400" />
                  {selectedRun.strategy_name}
                </h3>
                <span className="text-[9px] text-slate-500">
                  {selectedRun.index_symbol.replace("NSE:", "").replace("-INDEX", "")} • {new Date(selectedRun.start_time).toLocaleDateString("en-IN")} to {new Date(selectedRun.end_time).toLocaleDateString("en-IN")}
                </span>
              </div>
              <button
                onClick={() => setSelectedRun(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-all border border-slate-800"
              >
                <X size={14} />
              </button>
            </div>

            {/* Modal Quick Summary */}
            <div className="p-3 bg-slate-950/20 border-b border-slate-800/60 grid grid-cols-2 sm:grid-cols-6 gap-2">
              {[
                { label: "Total Trades", value: selectedRun.total_trades, color: "text-slate-300" },
                { label: "Win Rate", value: `${selectedRun.win_rate}%`, color: selectedRun.win_rate >= 55 ? "text-emerald-400" : "text-amber-400" },
                { label: "Profit Factor", value: selectedRun.profit_factor, color: selectedRun.profit_factor >= 1.0 ? "text-emerald-400" : "text-rose-400" },
                { label: "Sharpe Ratio", value: selectedRun.sharpe_ratio, color: "text-sky-400" },
                { label: "Max Drawdown", value: `₹${Math.round(selectedRun.max_drawdown)}`, color: "text-rose-400" },
                { label: "Risk Reward", value: `${selectedRun.avg_rr.toFixed(1)} RR`, color: "text-violet-400" },
              ].map(s => (
                <div key={s.label} className="bg-slate-950/60 rounded px-2 py-1.5 text-center border border-slate-800/40">
                  <div className="text-[7px] text-slate-500 uppercase font-black">{s.label}</div>
                  <div className={`text-[12px] font-black font-mono mt-0.5 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Modal Body: Trades Table */}
            <div className="flex-1 overflow-auto p-4 custom-scrollbar">
              {(!selectedRun.trade_logs || selectedRun.trade_logs.length === 0) ? (
                <div className="text-center py-8 text-slate-500 text-[10px]">
                  No individual trades were executed during this backtest run.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-[10px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500 uppercase font-black tracking-widest text-[8px] bg-slate-950/20">
                      <th className="py-2.5 px-2">Type</th>
                      <th className="py-2.5 px-2">Strike</th>
                      <th className="py-2.5 px-2">Entry Spot</th>
                      <th className="py-2.5 px-2">Exit Spot</th>
                      <th className="py-2.5 px-2">Entry Prem</th>
                      <th className="py-2.5 px-2">Exit Prem</th>
                      <th className="py-2.5 px-2 text-right">P&L (₹)</th>
                      <th className="py-2.5 px-2">Exit Reason</th>
                      <th className="py-2.5 px-2">Entry Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRun.trade_logs.map((t, idx) => {
                      const isCe = t.direction === "BUY_CE";
                      const pnlVal = Number(t.pnl);
                      const isWin = pnlVal > 0;
                      
                      return (
                        <tr key={idx} className="border-b border-slate-800/40 hover:bg-slate-800/10 font-medium">
                          <td className="py-2 px-2">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black border ${
                              isCe 
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                                : "bg-orange-500/10 text-orange-400 border-orange-500/20"
                            }`}>
                              {t.direction}
                            </span>
                          </td>
                          <td className="py-2 px-2 font-mono text-slate-300">{t.strike}</td>
                          <td className="py-2 px-2 font-mono text-slate-400">{Math.round(t.entrySpot)}</td>
                          <td className="py-2 px-2 font-mono text-slate-400">{Math.round(t.exitSpot)}</td>
                          <td className="py-2 px-2 font-mono text-slate-400">{t.entryPremium}</td>
                          <td className="py-2 px-2 font-mono text-slate-400">{Math.round(t.exitPremium)}</td>
                          <td className={`py-2 px-2 text-right font-black font-mono ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                            {isWin ? "+" : ""}₹{Math.round(pnlVal).toLocaleString()}
                          </td>
                          <td className="py-2 px-2">
                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${
                              t.exitReason === "TARGET" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                              t.exitReason === "STOPLOSS" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                              "bg-slate-800 text-slate-400 border-slate-700/30"
                            }`}>
                              {t.exitReason}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-slate-500 font-mono">
                            {new Date(t.entryTime * 1000).toLocaleString("en-IN", { hour: "numeric", minute: "numeric", second: "numeric" })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-right">
              <button
                onClick={() => setSelectedRun(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 text-[11px] font-black transition-all border border-slate-700/60"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyLabTab;
