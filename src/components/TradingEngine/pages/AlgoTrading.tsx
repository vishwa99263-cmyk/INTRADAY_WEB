/**
 * AlgoTrading.tsx — Ultra-Premium AI Strategy Builder + TradingView Chart + Ultra-Backtest Engine
 *
 * Features:
 *   ✅ TradingView Advanced Chart Widget (NIFTY / SENSEX / BANKNIFTY)
 *   ✅ AI Strategy Builder — 15+ indicator selector, timeframe, risk profile
 *   ✅ Gemini AI Strategy Generation — Pine Script code, entry/exit rules
 *   ✅ Ultra-Backtest Engine — Win rate, P&L, Sharpe, Drawdown, trade history
 *   ✅ Glassmorphism dark premium design
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Cpu, Brain, Play, BarChart2, TrendingUp, TrendingDown, AlertCircle,
  Copy, Check, RefreshCcw, ChevronRight, Zap, Target, Shield,
  Activity, BookOpen, Settings, Clock, Search, Code, Info,
  ArrowUpRight, ArrowDownRight, Minus, Loader, FlaskConical,
  LayoutGrid, Maximize2,
} from "lucide-react";
import type { AIAnalysisPayload } from "../../../types";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_INDICATORS = [
  { id: "RSI",       label: "RSI",           desc: "Relative Strength Index (Overbought/Oversold)" },
  { id: "MACD",      label: "MACD",          desc: "Moving Avg Convergence/Divergence" },
  { id: "BB",        label: "Bollinger Bands", desc: "Volatility bands around SMA" },
  { id: "Stochastic",label: "Stochastic",    desc: "%K/%D momentum oscillator" },
  { id: "EMA9",      label: "EMA 9",         desc: "Fast exponential moving average" },
  { id: "EMA21",     label: "EMA 21",        desc: "Medium exponential moving average" },
  { id: "EMA50",     label: "EMA 50",        desc: "Trend-defining EMA" },
  { id: "SMA20",     label: "SMA 20",        desc: "Simple 20-period moving average" },
  { id: "SMA50",     label: "SMA 50",        desc: "Simple 50-period moving average" },
  { id: "ATR",       label: "ATR",           desc: "Average True Range (Volatility)" },
  { id: "ADX",       label: "ADX",           desc: "Average Directional Index (Trend Strength)" },
  { id: "CCI",       label: "CCI",           desc: "Commodity Channel Index" },
  { id: "MFI",       label: "MFI",           desc: "Money Flow Index (Volume-based RSI)" },
  { id: "WilliamsR", label: "Williams %R",   desc: "Momentum oscillator (Overbought/Oversold)" },
  { id: "Fibonacci", label: "Fibonacci",     desc: "Auto-detected Fibonacci retracement levels" },
  { id: "VWAP",      label: "VWAP",          desc: "Volume Weighted Average Price" },
  { id: "Volume",    label: "Volume",        desc: "Raw volume and volume-weighted signals" },
];

const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1H", "1D"];
const RISK_PROFILES = [
  { id: "LOW",      label: "Conservative", color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/30" },
  { id: "MODERATE", label: "Moderate",     color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/30" },
  { id: "HIGH",     label: "Aggressive",   color: "text-rose-400",   bg: "bg-rose-500/10 border-rose-500/30" },
];
const STRATEGY_FOCUS = [
  { id: "OPTION_BUYING",  label: "Option Buying",  icon: "📈" },
  { id: "OPTION_SELLING", label: "Option Selling", icon: "📉" },
  { id: "FUTURES",        label: "Futures",        icon: "⚡" },
];

const TV_SYMBOL: Record<string, string> = {
  NIFTY: "NSE:NIFTY1!",
  SENSEX: "BSE:SENSEX",
  BANKNIFTY: "NSE:BANKNIFTY1!",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props { activePage: string; aiAnalysis: AIAnalysisPayload }

interface BacktestResult {
  stats: {
    totalTrades: number; winningTrades: number; losingTrades: number;
    winRate: number; profitFactor: number; maxDrawdown: number;
    sharpeRatio: number; expectancy: number; totalPnl: number;
    avgWin: number; avgLoss: number; bestTrade: number; worstTrade: number;
    consecutiveWins: number; consecutiveLosses: number;
  };
  trades: {
    id: string; entryTime: number; exitTime: number;
    direction: "BUY_CE" | "BUY_PE";
    entrySpot: number; exitSpot: number;
    entryPremium: number; exitPremium: number;
    pnl: number; pnlPct: number;
    exitReason: "TARGET" | "STOPLOSS" | "TIME_EXIT" | "SIGNAL_REVERSAL";
    indicatorTriggers: string[];
    strike: number;
  }[];
  fibLevels: { high: number; low: number; l236: number; l382: number; l50: number; l618: number; l786: number } | null;
  pineScript: string;
  geminiAnalysis: string;
  optimizedRules: Record<string, number>;
  indicatorSummary: Record<string, string>;
  period: string;
  timeframe: string;
  instrument: string;
}

interface GeneratedStrategy {
  strategyName: string;
  description: string;
  entryRules: string[];
  exitRules: string[];
  rsiOversold: number;
  rsiOverbought: number;
  targetPct: number;
  stopLossPct: number;
  adxStrength: number;
  stochOversold: number;
  stochOverbought: number;
  bestTimeOfDay: string;
  avoidConditions: string[];
  expectedWinRate: number;
  riskRewardRatio: string;
  marketRegimeSuited: string;
}

// ── TradingView Widget ────────────────────────────────────────────────────────

const TradingViewChart: React.FC<{ symbol: string; containerId?: string; height?: number }> = ({ symbol, containerId, height = 460 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const cid = containerId || `tv_chart_container_${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up any existing widget
    container.innerHTML = "";

    const loadWidget = () => {
      if (typeof (window as any).TradingView === "undefined") return;
      widgetRef.current = new (window as any).TradingView.widget({
        autosize: true,
        symbol,
        interval: "D",
        timezone: "Asia/Kolkata",
        theme: "dark",
        style: "1",
        locale: "en",
        enable_publishing: false,
        allow_symbol_change: true,
        container_id: cid,
        withdateranges: true,
        hide_side_toolbar: false,
        studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies", "BB@tv-basicstudies"],
        hide_top_toolbar: false,
        toolbar_bg: "#0d1421",
        overrides: {
          "paneProperties.background": "#0d1421",
          "paneProperties.backgroundType": "solid",
          "paneProperties.gridLinesMode": "horizontal",
          "paneProperties.gridProperties.color": "#1a2535",
        },
      });
    };

    // Check if script already loaded
    if (typeof (window as any).TradingView !== "undefined") {
      loadWidget();
      return;
    }

    // Load TradingView script
    const existing = document.getElementById("tv-script");
    if (existing) {
      existing.addEventListener("load", loadWidget);
      return;
    }

    const script = document.createElement("script");
    script.id = "tv-script";
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = loadWidget;
    document.head.appendChild(script);

    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove?.(); } catch (_) {}
      }
    };
  }, [symbol, cid]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-700/50" style={{ height }}>
      <div id={cid} ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
};

// ── Stat Card ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{
  label: string; value: string | number; sub?: string;
  color?: string; icon?: React.ReactNode; glow?: string;
}> = ({ label, value, sub, color = "text-white", icon, glow }) => (
  <div className={`rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-4 relative overflow-hidden ${glow ? `shadow-lg ${glow}` : ""}`}>
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.01] to-transparent" />
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 uppercase font-black tracking-wider">{label}</span>
        {icon && <span className="text-slate-600">{icon}</span>}
      </div>
      <div className={`text-2xl font-black ${color} tracking-tight`}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

const AlgoTrading: React.FC<Props> = ({ activePage, aiAnalysis }) => {
  // ── Strategy Builder State ────────────────────────────────────────────────
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>(["RSI", "MACD", "EMA9", "EMA21", "BB"]);
  const [timeframe, setTimeframe] = useState("15m");
  const [riskProfile, setRiskProfile] = useState("MODERATE");
  const [strategyFocus, setStrategyFocus] = useState("OPTION_BUYING");
  const [targetPct, setTargetPct] = useState(50);
  const [stopLossPct, setStopLossPct] = useState(30);
  const [adxStrength, setAdxStrength] = useState(22);
  const [maxTrades, setMaxTrades] = useState(3);

  // ── UI State ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"CHART" | "BUILDER" | "BACKTEST" | "ANALYSIS">("CHART");
  const [chartLayout, setChartLayout] = useState<"SINGLE" | "GRID">("GRID");
  const [loading, setLoading] = useState(false);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [generatedStrategy, setGeneratedStrategy] = useState<GeneratedStrategy | null>(null);
  const [error, setError] = useState<string>("");
  const [copiedPine, setCopiedPine] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  const baseUrl = isLocal ? "http://localhost:3000" : "";

  const toggleIndicator = (id: string) => {
    setSelectedIndicators(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleGenerateStrategy = useCallback(async () => {
    setLoadingStrategy(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/api/ai-generate-strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: activePage,
          timeframe,
          indicators: selectedIndicators,
          riskProfile,
          strategyFocus,
        }),
      });
      const data = await res.json();
      if (data.success && data.strategy) {
        setGeneratedStrategy(data.strategy);
        // Apply optimized params from strategy
        if (data.strategy.rsiOversold)  setTargetPct(data.strategy.targetPct ?? 50);
        if (data.strategy.stopLossPct)  setStopLossPct(data.strategy.stopLossPct ?? 30);
        if (data.strategy.adxStrength)  setAdxStrength(data.strategy.adxStrength ?? 22);
        setActiveTab("ANALYSIS");
      }
    } catch (e: any) {
      setError("Strategy generation failed: " + e.message);
    }
    setLoadingStrategy(false);
  }, [activePage, timeframe, selectedIndicators, riskProfile, strategyFocus, baseUrl]);

  const handleRunBacktest = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/api/auto-backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: activePage,
          timeframe,
          indicators: selectedIndicators,
          riskProfile,
          strategyFocus,
          targetPct,
          stopLossPct,
          adxStrength,
          maxTradesPerDay: maxTrades,
          rsiOversold: generatedStrategy?.rsiOversold ?? 35,
          rsiOverbought: generatedStrategy?.rsiOverbought ?? 65,
          stochOversold: generatedStrategy?.stochOversold ?? 25,
          stochOverbought: generatedStrategy?.stochOverbought ?? 75,
        }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setBacktestResult(data.result);
        setActiveTab("BACKTEST");
      } else {
        setError(data.error || "Backtest failed");
      }
    } catch (e: any) {
      setError("Backtest failed: " + e.message);
    }
    setLoading(false);
  }, [activePage, timeframe, selectedIndicators, riskProfile, strategyFocus, targetPct, stopLossPct, adxStrength, maxTrades, generatedStrategy, baseUrl]);

  const copyToClipboard = (text: string, type: "pine" | "script") => {
    navigator.clipboard.writeText(text);
    if (type === "pine") { setCopiedPine(true); setTimeout(() => setCopiedPine(false), 2000); }
    else { setCopiedScript(true); setTimeout(() => setCopiedScript(false), 2000); }
  };

  const riskColor = riskProfile === "HIGH" ? "text-rose-400" : riskProfile === "MODERATE" ? "text-amber-400" : "text-blue-400";
  const pnlColor = (backtestResult?.stats.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4 min-h-screen" style={{ fontFamily: "'Inter', sans-serif", background: "linear-gradient(135deg, #06090f 0%, #0a111e 50%, #06090f 100%)" }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-900/40">
              <Brain size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2 tracking-tight">
                AI Algo Trading Engine
                <span className="text-xs font-black text-violet-400 bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 rounded-full uppercase tracking-widest">BETA</span>
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">Strategy Builder · TradingView Chart · Ultra-Backtest · Gemini AI Optimization · {activePage}</p>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        {backtestResult && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1.5 rounded-lg border border-slate-700/50 bg-slate-900/50 text-xs">
              <span className="text-slate-500">Trades: </span>
              <span className="text-white font-black">{backtestResult.stats.totalTrades}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg border border-slate-700/50 bg-slate-900/50 text-xs">
              <span className="text-slate-500">Win Rate: </span>
              <span className={`font-black ${backtestResult.stats.winRate >= 55 ? "text-emerald-400" : "text-amber-400"}`}>{backtestResult.stats.winRate}%</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg border border-slate-700/50 bg-slate-900/50 text-xs">
              <span className="text-slate-500">P&L: </span>
              <span className={`font-black ${pnlColor}`}>₹{backtestResult.stats.totalPnl.toLocaleString("en-IN")}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Simulation Banner ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-3">
        <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
        <span className="text-xs text-amber-300/70">
          <span className="text-amber-400 font-black">SIMULATION MODE</span> · Backtest uses live candle history from Fyers WebSocket feed. Pine Script can be copied to TradingView for live signal overlay. No live orders are placed.
        </span>
      </div>

      {/* ── Tab Navigation ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/60 border border-slate-800/50 w-fit">
        {([
          { id: "CHART",    label: "Chart",          icon: <BarChart2 size={13} /> },
          { id: "BUILDER",  label: "Strategy Builder", icon: <Settings size={13} /> },
          { id: "BACKTEST", label: "Backtest Results", icon: <FlaskConical size={13} /> },
          { id: "ANALYSIS", label: "AI Analysis",    icon: <Brain size={13} /> },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all duration-200 ${
              activeTab === tab.id
                ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.icon} {tab.label}
            {tab.id === "BACKTEST" && backtestResult && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
            )}
          </button>
        ))}
      </div>

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-2">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-300">{error}</span>
          <button onClick={() => setError("")} className="ml-auto text-red-400 hover:text-red-300 text-xs">✕</button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: CHART
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "CHART" && (
        <div className="space-y-4">
          {/* Chart Header controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-800/40">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-indigo-400 animate-pulse" />
              <span className="text-xs font-black text-slate-350 uppercase tracking-widest">
                AI ADVANCED MULTI-CHART WORKSPACE
              </span>
            </div>
            <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800/80 self-end sm:self-auto">
              <button
                onClick={() => setChartLayout("SINGLE")}
                className={`px-3 py-1 rounded text-xs font-black font-mono transition-all flex items-center gap-1.5 ${
                  chartLayout === "SINGLE" ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/30" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Maximize2 size={11} />
                SINGLE ({activePage})
              </button>
              <button
                onClick={() => setChartLayout("GRID")}
                className={`px-3 py-1 rounded text-xs font-black font-mono transition-all flex items-center gap-1.5 ${
                  chartLayout === "GRID" ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/30" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <LayoutGrid size={11} />
                3-CHART MONITOR
              </button>
            </div>
          </div>

          {chartLayout === "SINGLE" ? (
            <TradingViewChart symbol={TV_SYMBOL[activePage] ?? "NSE:NIFTY"} height={480} />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="space-y-1.5 p-2 rounded-xl bg-slate-950/20 border border-slate-900/60">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-bold">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> NIFTY 50</span>
                  <span className="text-[10px] text-slate-500 font-mono">NSE:NIFTY1!</span>
                </div>
                <TradingViewChart symbol="NSE:NIFTY1!" containerId="tv_chart_nifty" height={360} />
              </div>
              <div className="space-y-1.5 p-2 rounded-xl bg-slate-950/20 border border-slate-900/60">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-bold">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> BANKNIFTY</span>
                  <span className="text-[10px] text-slate-500 font-mono">NSE:BANKNIFTY1!</span>
                </div>
                <TradingViewChart symbol="NSE:BANKNIFTY1!" containerId="tv_chart_banknifty" height={360} />
              </div>
              <div className="space-y-1.5 p-2 rounded-xl bg-slate-950/20 border border-slate-900/60">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-bold">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> SENSEX</span>
                  <span className="text-[10px] text-slate-500 font-mono">BSE:SENSEX</span>
                </div>
                <TradingViewChart symbol="BSE:SENSEX" containerId="tv_chart_sensex" height={360} />
              </div>
            </div>
          )}

          {/* Quick Indicator Summary from last candle */}
          {backtestResult?.indicatorSummary && Object.keys(backtestResult.indicatorSummary).length > 0 && (
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-4">
              <div className="text-xs text-slate-500 uppercase font-black tracking-wider mb-3 flex items-center gap-2">
                <Activity size={12} className="text-indigo-400" /> Live Indicator Snapshot
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {Object.entries(backtestResult.indicatorSummary).map(([key, val]) => (
                  <div key={key} className="rounded-lg border border-slate-800/30 bg-slate-900/30 p-2">
                    <div className="text-xs text-slate-500 font-black">{key}</div>
                    <div className="text-xs text-slate-200 mt-0.5 truncate">{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fibonacci Levels */}
          {backtestResult?.fibLevels && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="text-xs text-amber-400 uppercase font-black tracking-wider mb-3 flex items-center gap-2">
                <TrendingUp size={12} /> Fibonacci Retracement Levels ({backtestResult.period})
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                {[
                  { label: "High",   val: backtestResult.fibLevels.high,  color: "text-emerald-400" },
                  { label: "78.6%",  val: backtestResult.fibLevels.l786,  color: "text-indigo-400" },
                  { label: "61.8%",  val: backtestResult.fibLevels.l618,  color: "text-yellow-400" },
                  { label: "50.0%",  val: backtestResult.fibLevels.l50,   color: "text-white" },
                  { label: "38.2%",  val: backtestResult.fibLevels.l382,  color: "text-amber-400" },
                  { label: "23.6%",  val: backtestResult.fibLevels.l236,  color: "text-orange-400" },
                  { label: "Low",    val: backtestResult.fibLevels.low,   color: "text-red-400" },
                ].map(fib => (
                  <div key={fib.label} className="text-center rounded-lg bg-slate-900/50 border border-slate-800/30 p-2">
                    <div className="text-xs text-slate-500 font-black">{fib.label}</div>
                    <div className={`text-sm font-black ${fib.color}`}>{fib.val.toFixed(0)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA to run backtest */}
          {!backtestResult && (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5 text-center">
              <div className="text-slate-300 font-black text-sm mb-2">⚡ Run AI-Powered Backtest</div>
              <p className="text-xs text-slate-500 mb-4">Configure indicators in the Strategy Builder tab, then click Generate + Backtest to analyze historical performance.</p>
              <button
                onClick={() => setActiveTab("BUILDER")}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-black shadow-lg shadow-violet-900/30 hover:opacity-90 transition-opacity flex items-center gap-2 mx-auto"
              >
                <Settings size={14} /> Open Strategy Builder
              </button>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: STRATEGY BUILDER
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "BUILDER" && (
        <div className="space-y-4">
          {/* Indicator Grid */}
          <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-5">
            <div className="text-xs text-slate-500 uppercase font-black tracking-wider mb-4 flex items-center gap-2">
              <Activity size={12} className="text-violet-400" /> Select Indicators
              <span className="ml-auto text-violet-400 font-black">{selectedIndicators.length} selected</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {ALL_INDICATORS.map(ind => {
                const active = selectedIndicators.includes(ind.id);
                return (
                  <button
                    key={ind.id}
                    onClick={() => toggleIndicator(ind.id)}
                    title={ind.desc}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all duration-200 group ${
                      active
                        ? "border-violet-500/50 bg-violet-500/10 shadow-md shadow-violet-900/20"
                        : "border-slate-800/50 bg-slate-900/30 hover:border-slate-600/50"
                    }`}
                  >
                    <div className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${active ? "bg-violet-500 border-violet-500" : "border-slate-600"}`}>
                      {active && <Check size={8} className="text-white" />}
                    </div>
                    <div>
                      <div className={`text-xs font-black ${active ? "text-violet-300" : "text-slate-400"}`}>{ind.label}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Settings Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Timeframe */}
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-4">
              <div className="text-xs text-slate-500 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5"><Clock size={11} /> Timeframe</div>
              <div className="flex flex-wrap gap-1.5">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1 rounded-md text-xs font-black border transition-all duration-150 ${
                      timeframe === tf
                        ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-300"
                        : "border-slate-700/50 text-slate-400 hover:border-slate-500/50"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Risk Profile */}
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-4">
              <div className="text-xs text-slate-500 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5"><Shield size={11} /> Risk Profile</div>
              <div className="flex flex-col gap-1.5">
                {RISK_PROFILES.map(rp => (
                  <button
                    key={rp.id}
                    onClick={() => setRiskProfile(rp.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-black transition-all duration-150 ${
                      riskProfile === rp.id ? `${rp.bg} ${rp.color}` : "border-slate-700/50 text-slate-400 hover:border-slate-500/50"
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${riskProfile === rp.id ? "bg-current" : "bg-slate-700"}`} />
                    {rp.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy Focus */}
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-4">
              <div className="text-xs text-slate-500 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5"><Target size={11} /> Strategy Focus</div>
              <div className="flex flex-col gap-1.5">
                {STRATEGY_FOCUS.map(sf => (
                  <button
                    key={sf.id}
                    onClick={() => setStrategyFocus(sf.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-black transition-all duration-150 ${
                      strategyFocus === sf.id
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-700/50 text-slate-400 hover:border-slate-500/50"
                    }`}
                  >
                    {sf.icon} {sf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Risk Management Parameters */}
          <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-5">
            <div className="text-xs text-slate-500 uppercase font-black tracking-wider mb-4 flex items-center gap-1.5"><Settings size={11} /> Risk Management Parameters</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Target %", value: targetPct, setter: setTargetPct, min: 10, max: 200, step: 5 },
                { label: "Stop Loss %", value: stopLossPct, setter: setStopLossPct, min: 10, max: 100, step: 5 },
                { label: "Min ADX Strength", value: adxStrength, setter: setAdxStrength, min: 10, max: 50, step: 1 },
                { label: "Max Trades/Day", value: maxTrades, setter: setMaxTrades, min: 1, max: 10, step: 1 },
              ].map(param => (
                <div key={param.label}>
                  <div className="text-xs text-slate-500 font-black mb-1.5">{param.label}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={param.value}
                      onChange={e => param.setter(Number(e.target.value))}
                      className="flex-1 accent-violet-500"
                    />
                    <span className="text-sm font-black text-violet-300 w-10 text-right">{param.value}{param.label.includes("%") ? "%" : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleGenerateStrategy}
              disabled={loadingStrategy || selectedIndicators.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-blue-500/50 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 text-blue-300 text-sm font-black hover:from-blue-600/30 hover:to-indigo-600/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingStrategy ? <Loader size={14} className="animate-spin" /> : <Brain size={14} />}
              Generate AI Strategy
            </button>

            <button
              onClick={handleRunBacktest}
              disabled={loading || selectedIndicators.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-black shadow-lg shadow-violet-900/30 hover:opacity-90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? "Running Backtest..." : "Run AI Backtest"}
            </button>

            {backtestResult && (
              <button
                onClick={() => { setActiveTab("BACKTEST"); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/40 text-emerald-400 text-sm font-black hover:border-emerald-500/60 transition-colors"
              >
                <BarChart2 size={14} /> View Results
              </button>
            )}

            {selectedIndicators.length === 0 && (
              <span className="text-xs text-amber-400">Select at least 1 indicator to continue</span>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: BACKTEST RESULTS
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "BACKTEST" && (
        <div className="space-y-4">
          {!backtestResult ? (
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
                <FlaskConical size={28} className="text-violet-400" />
              </div>
              <div className="text-slate-300 font-black text-sm mb-2">No Backtest Data Yet</div>
              <p className="text-xs text-slate-500 mb-4">Configure your strategy in the Builder tab and run the backtest to see results here.</p>
              <button
                onClick={() => setActiveTab("BUILDER")}
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-black hover:bg-violet-500 transition-colors"
              >
                Go to Strategy Builder
              </button>
            </div>
          ) : (
            <>
              {/* Stats Header */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-white font-black">{backtestResult.instrument} · {backtestResult.timeframe} · {backtestResult.period}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Indicators: {selectedIndicators.join(", ")}</div>
                </div>
                <button
                  onClick={handleRunBacktest}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/50 text-slate-400 text-xs font-black hover:border-slate-500/50 transition-colors"
                >
                  <RefreshCcw size={11} className={loading ? "animate-spin" : ""} /> Re-run
                </button>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
                <StatCard
                  label="Total Trades" value={backtestResult.stats.totalTrades}
                  sub={`W:${backtestResult.stats.winningTrades} / L:${backtestResult.stats.losingTrades}`}
                  color="text-white" icon={<Activity size={14} />}
                />
                <StatCard
                  label="Win Rate" value={`${backtestResult.stats.winRate}%`}
                  sub={`Exp: ₹${backtestResult.stats.expectancy}/trade`}
                  color={backtestResult.stats.winRate >= 55 ? "text-emerald-400" : backtestResult.stats.winRate >= 45 ? "text-amber-400" : "text-red-400"}
                  icon={<Target size={14} />}
                  glow={backtestResult.stats.winRate >= 55 ? "shadow-emerald-900/20" : ""}
                />
                <StatCard
                  label="Profit Factor" value={backtestResult.stats.profitFactor}
                  sub={backtestResult.stats.profitFactor >= 1.5 ? "🟢 Excellent" : backtestResult.stats.profitFactor >= 1 ? "🟡 Positive" : "🔴 Negative"}
                  color={backtestResult.stats.profitFactor >= 1.5 ? "text-emerald-400" : backtestResult.stats.profitFactor >= 1 ? "text-amber-400" : "text-red-400"}
                  icon={<TrendingUp size={14} />}
                />
                <StatCard
                  label="Total P&L" value={`₹${backtestResult.stats.totalPnl.toLocaleString("en-IN")}`}
                  sub={`Avg Win ₹${backtestResult.stats.avgWin} | Avg Loss ₹${backtestResult.stats.avgLoss}`}
                  color={pnlColor}
                  icon={<Zap size={14} />}
                  glow={(backtestResult.stats.totalPnl ?? 0) >= 0 ? "shadow-emerald-900/20" : "shadow-red-900/20"}
                />
              </div>

              {/* Secondary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Max Drawdown" value={`₹${backtestResult.stats.maxDrawdown.toLocaleString("en-IN")}`} color="text-red-400" icon={<TrendingDown size={14} />} />
                <StatCard label="Sharpe Ratio" value={backtestResult.stats.sharpeRatio} sub={backtestResult.stats.sharpeRatio >= 1 ? "Good" : "Needs Improvement"} color={backtestResult.stats.sharpeRatio >= 1 ? "text-emerald-400" : "text-amber-400"} icon={<BarChart2 size={14} />} />
                <StatCard label="Best Trade" value={`₹${backtestResult.stats.bestTrade}`} color="text-emerald-400" icon={<ArrowUpRight size={14} />} />
                <StatCard label="Worst Trade" value={`₹${backtestResult.stats.worstTrade}`} color="text-red-400" icon={<ArrowDownRight size={14} />} />
              </div>

              {/* Trade History Table */}
              {backtestResult.trades.length > 0 && (
                <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-800/50">
                    <BookOpen size={13} className="text-slate-500" />
                    <span className="text-xs text-slate-400 font-black uppercase tracking-wider">Trade History</span>
                    <span className="ml-auto text-xs text-slate-600">Last {backtestResult.trades.length} trades</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-800/40">
                          {["#", "Time", "Direction", "Entry", "Exit", "P&L", "Exit Reason", "Triggers"].map(h => (
                            <th key={h} className="text-left text-slate-500 font-black uppercase tracking-wider px-4 py-2.5">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {backtestResult.trades.slice(-20).map((t, i) => (
                          <tr key={t.id} className="border-b border-slate-800/20 hover:bg-slate-800/20 transition-colors">
                            <td className="px-4 py-2 text-slate-500">{backtestResult.trades.length - 19 + i}</td>
                            <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                              {new Date(t.entryTime * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-black ${t.direction === "BUY_CE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                                {t.direction}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-slate-300">{t.entrySpot.toFixed(0)}</td>
                            <td className="px-4 py-2 text-slate-300">{t.exitSpot.toFixed(0)}</td>
                            <td className={`px-4 py-2 font-black ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {t.pnl >= 0 ? "+" : ""}₹{t.pnl.toFixed(0)}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`text-xs font-black ${t.exitReason === "TARGET" ? "text-emerald-400" : t.exitReason === "STOPLOSS" ? "text-red-400" : "text-slate-500"}`}>
                                {t.exitReason.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-slate-500 max-w-[180px] truncate">{t.indicatorTriggers.slice(0, 2).join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Pine Script */}
              {backtestResult.pineScript && (
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-indigo-500/20">
                    <Code size={13} className="text-indigo-400" />
                    <span className="text-xs text-indigo-400 font-black uppercase tracking-wider">Generated Pine Script v5</span>
                    <button
                      onClick={() => copyToClipboard(backtestResult.pineScript, "pine")}
                      className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-indigo-500/30 text-xs font-black text-indigo-400 hover:border-indigo-400/50 transition-colors"
                    >
                      {copiedPine ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Copy Code</>}
                    </button>
                  </div>
                  <pre className="text-xs text-slate-300 p-4 overflow-x-auto max-h-48 font-mono leading-relaxed bg-[#06090f]/50">
                    {backtestResult.pineScript}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: AI ANALYSIS
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "ANALYSIS" && (
        <div className="space-y-4">
          {/* Generated Strategy Details */}
          {generatedStrategy ? (
            <div className="space-y-4">
              {/* Strategy Header */}
              <div className="rounded-xl border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-indigo-500/10 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Brain size={15} className="text-violet-400" />
                      <span className="text-xs text-violet-400 font-black uppercase tracking-wider">Gemini AI Generated Strategy</span>
                    </div>
                    <h2 className="text-lg font-black text-white">{generatedStrategy.strategyName}</h2>
                    <p className="text-sm text-slate-400 mt-1 leading-relaxed">{generatedStrategy.description}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-slate-500 mb-1">Expected Win Rate</div>
                    <div className="text-2xl font-black text-emerald-400">{generatedStrategy.expectedWinRate}%</div>
                    <div className="text-xs text-slate-500 mt-1">R:R {generatedStrategy.riskRewardRatio}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                  {[
                    { label: "Best Time", val: generatedStrategy.bestTimeOfDay },
                    { label: "Market Regime", val: generatedStrategy.marketRegimeSuited },
                    { label: "Strategy", val: `${strategyFocus.replace("_", " ")} · ${timeframe}` },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
                      <div className="text-xs text-slate-500 font-black">{item.label}</div>
                      <div className="text-xs text-violet-200 mt-0.5 font-bold">{item.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Entry / Exit Rules */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-emerald-500/20 bg-[#08101a]/80 p-4">
                  <div className="text-xs text-emerald-400 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5">
                    <ArrowUpRight size={12} /> Entry Rules
                  </div>
                  <div className="space-y-2">
                    {(generatedStrategy.entryRules || []).map((rule, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-black">{i + 1}</div>
                        <span className="text-xs text-slate-300 leading-relaxed">{rule}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-red-500/20 bg-[#08101a]/80 p-4">
                  <div className="text-xs text-red-400 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5">
                    <ArrowDownRight size={12} /> Exit Rules
                  </div>
                  <div className="space-y-2">
                    {(generatedStrategy.exitRules || []).map((rule, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-4 h-4 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-black">{i + 1}</div>
                        <span className="text-xs text-slate-300 leading-relaxed">{rule}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Avoid Conditions */}
              {generatedStrategy.avoidConditions?.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="text-xs text-amber-400 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5">
                    <AlertCircle size={12} /> Avoid These Conditions
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {generatedStrategy.avoidConditions.map((cond, i) => (
                      <span key={i} className="text-xs text-amber-300 border border-amber-500/20 rounded-lg px-2.5 py-1 bg-amber-500/5">⚠ {cond}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-3">
                <Brain size={22} className="text-blue-400" />
              </div>
              <div className="text-slate-300 font-black text-sm mb-2">Generate AI Strategy First</div>
              <p className="text-xs text-slate-500 mb-4">Click "Generate AI Strategy" in the Builder tab to get Gemini-powered entry/exit rules and analysis.</p>
              <button
                onClick={handleGenerateStrategy}
                disabled={loadingStrategy || selectedIndicators.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-black hover:opacity-90 transition-opacity mx-auto disabled:opacity-50"
              >
                {loadingStrategy ? <Loader size={12} className="animate-spin" /> : <Brain size={12} />}
                Generate Strategy Now
              </button>
            </div>
          )}

          {/* Gemini Backtest Analysis */}
          {backtestResult?.geminiAnalysis && (
            <div className="rounded-xl border border-indigo-500/20 bg-[#08101a]/80 p-5">
              <div className="text-xs text-indigo-400 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5">
                <Brain size={12} /> Gemini AI Backtest Optimization Report
              </div>
              <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{backtestResult.geminiAnalysis}</div>
              {backtestResult.optimizedRules && Object.keys(backtestResult.optimizedRules).length > 0 && (
                <div className="mt-4 pt-4 border-t border-indigo-500/20">
                  <div className="text-xs text-indigo-300 font-black mb-2">🔧 Optimized Parameters Recommended:</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(backtestResult.optimizedRules)
                      .filter(([_, v]) => v !== undefined && v !== null)
                      .map(([key, val]) => (
                        <span key={key} className="text-xs text-indigo-200 border border-indigo-500/20 rounded px-2 py-0.5 bg-indigo-500/5">
                          {key}: <span className="font-black">{val}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Current Signal from AIAnalysis */}
          {aiAnalysis?.antigravity && (
            <div className="rounded-xl border border-slate-800/50 bg-[#08101a]/80 p-4">
              <div className="text-xs text-slate-500 uppercase font-black tracking-wider mb-3 flex items-center gap-1.5">
                <Zap size={12} className="text-amber-400" /> Live AI Signal · {activePage}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-slate-500">Signal</div>
                  <div className={`text-xl font-black mt-0.5 ${aiAnalysis.antigravity.finalSignal === "BUY_CE" ? "text-emerald-400" : aiAnalysis.antigravity.finalSignal === "BUY_PE" ? "text-red-400" : "text-amber-400"}`}>
                    {aiAnalysis.antigravity.finalSignal}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Grade</div>
                  <div className={`text-xl font-black mt-0.5 ${aiAnalysis.antigravity.signalGrade === "A" ? "text-emerald-400" : aiAnalysis.antigravity.signalGrade === "B" ? "text-blue-400" : "text-amber-400"}`}>
                    {aiAnalysis.antigravity.signalGrade}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Confidence</div>
                  <div className="text-xl font-black text-white mt-0.5">{aiAnalysis.antigravity.confidence.toFixed(0)}%</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Score</div>
                  <div className={`text-xl font-black mt-0.5 ${aiAnalysis.antigravity.antigravityScore > 0 ? "text-emerald-400" : aiAnalysis.antigravity.antigravityScore < 0 ? "text-red-400" : "text-slate-400"}`}>
                    {aiAnalysis.antigravity.antigravityScore > 0 ? "+" : ""}{aiAnalysis.antigravity.antigravityScore}
                  </div>
                </div>
              </div>
              {aiAnalysis.antigravity.reasoning && (
                <p className="text-xs text-slate-500 mt-3 leading-relaxed border-t border-slate-800/30 pt-3">{aiAnalysis.antigravity.reasoning}</p>
              )}
            </div>
          )}

          {/* Run buttons at bottom */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleGenerateStrategy}
              disabled={loadingStrategy || selectedIndicators.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-500/40 text-blue-400 text-xs font-black hover:border-blue-400/60 transition-colors disabled:opacity-50"
            >
              {loadingStrategy ? <Loader size={12} className="animate-spin" /> : <Brain size={12} />}
              Regenerate Strategy
            </button>
            <button
              onClick={handleRunBacktest}
              disabled={loading || selectedIndicators.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-black hover:bg-violet-500 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
              {loading ? "Running..." : "Run Backtest"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlgoTrading;
