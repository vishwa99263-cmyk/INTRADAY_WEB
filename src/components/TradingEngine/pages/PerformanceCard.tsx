/**
 * PerformanceCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 15: Performance Engine v1.0 — Premium Institutional UI Card
 *
 * Visualizes deep trading analytics:
 * - Overall Win Rate meter.
 * - Expectancy Edge Score dial.
 * - Profit Factor & Max Drawdown.
 * - Strategy Performance Ranking matrix.
 * - Session-wise performance bars (Opening, Mid Session, Closing).
 * - Edge Detection Alerts (Insights Panel).
 */
import React, { useMemo } from "react";
import {
  computePerformance,
  type PerformanceEngineResult,
} from "../../../engine/performanceEngine";
import type { PaperTradingResult } from "../../../engine/paperTradingEngine";
import type { TEPaperTrade }        from "../../../types";
import { Award, Target, Flame, BarChart3, TrendingUp, Compass, Activity, ShieldAlert, Cpu } from "lucide-react";

export interface PerformanceCardProps {
  activePage: string;
  paperTradingOutput: PaperTradingResult;
  dbTrades:           TEPaperTrade[];
}

const PerformanceCard: React.FC<PerformanceCardProps> = (props) => {
  const { activePage, paperTradingOutput, dbTrades } = props;

  const result: PerformanceEngineResult = useMemo(() => {
    return computePerformance({
      paperTradingOutput,
      dbTrades,
    });
  }, [paperTradingOutput, dbTrades]);

  // Color mappings
  const accentColor = result.cumulativePnL >= 0 ? "#10b981" : "#ef4444";
  const glowShadow = result.cumulativePnL >= 0 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)";

  const isExcellentPF = result.profitFactor >= 2.0;
  const isGoodPF = result.profitFactor >= 1.5;
  const isWeakPF = result.profitFactor < 1.0;

  const pfColor = isExcellentPF ? "text-emerald-400" : isGoodPF ? "text-sky-400" : isWeakPF ? "text-red-400" : "text-amber-400";
  const pfBorder = isExcellentPF ? "border-emerald-500/20" : isGoodPF ? "border-sky-500/20" : isWeakPF ? "border-red-500/20" : "border-amber-500/20";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #03050a 0%, #060a14 55%, #03050a 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 28px ${glowShadow}`,
      }}
    >
      {/* Dynamic top bar color indicating overall P&L */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${accentColor} 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-4 py-4">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3.5 border-b border-slate-800/40 pb-2">
          <div className="flex items-center gap-1.5">
            <Award size={14} style={{ color: "#38bdf8" }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400">
              📊 PERFORMANCE INTELLIGENCE · LAYER 15
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm bg-slate-800/60 border border-slate-700/30 text-slate-500 px-1.5 py-0.5 rounded font-black font-mono">
              COMPLETED SAMPLE SIZE: {result.totalTrades}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT GRID ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* Column 1: Win Rate, Expectancy Edge, and P&L (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between border-r border-slate-800/30 pr-0 lg:pr-4">
            
            {/* Expectancy and P&L */}
            <div className="space-y-3">
              <div>
                <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
                  Cumulative Net Earnings
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <h2 className={`text-[15px] font-mono font-black tracking-tight ${result.cumulativePnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {result.cumulativePnL >= 0 ? "+" : ""}₹{result.cumulativePnL.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </h2>
                  <span className="text-sm font-mono text-slate-500 font-bold uppercase">PnL Today</span>
                </div>
              </div>

              {/* Expectancy Edge Score Dial */}
              <div className="px-3 py-2.5 rounded-lg bg-slate-900/30 border border-slate-800/40 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm text-slate-500 uppercase font-black">Expectancy Edge Score</span>
                  <span className={`text-base font-mono font-black mt-0.5 ${result.expectancy >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {result.expectancy >= 0 ? "+" : ""}₹{result.expectancy.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </span>
                </div>
                <div className={`px-2 py-0.5 rounded border text-sm font-black font-mono ${
                  result.expectancy >= 0 
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : "bg-red-500/10 border-red-500/20 text-red-400"
                }`}>
                  {result.expectancy >= 0 ? "POSITIVE EDGE" : "NEGATIVE EDGE"}
                </div>
              </div>

              {/* Overall Win Rate Meter */}
              <div className="space-y-1 bg-slate-950/40 p-2.5 rounded border border-slate-900/60">
                <div className="flex items-center justify-between text-sm font-bold text-slate-400 font-mono">
                  <span className="flex items-center gap-1"><Target size={11} className="text-slate-500" /> Overall Win Rate Meter</span>
                  <span className={result.overallWinRate >= 50 ? "text-emerald-400 font-black" : "text-amber-400 font-black"}>
                    {result.overallWinRate}%
                  </span>
                </div>
                <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${result.overallWinRate}%`,
                      background: result.overallWinRate >= 55 ? "linear-gradient(95deg, #10b981, #34d399)" : "linear-gradient(95deg, #f59e0b, #fbbf24)"
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Streak metrics */}
            <div className="mt-3">
              {result.winStreak >= 2 && (
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm font-black font-mono uppercase tracking-wider animate-pulse">
                  <Flame size={12} className="text-orange-500" /> HOT WIN STREAK: {result.winStreak} WINS
                </div>
              )}
              {result.lossStreak >= 2 && (
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-black font-mono uppercase tracking-wider animate-pulse">
                  <Flame size={12} className="text-red-500" /> COLD LOSS STREAK: {result.lossStreak} LOSSES
                </div>
              )}
              {result.winStreak < 2 && result.lossStreak < 2 && (
                <div className="text-sm text-slate-600 font-mono italic">
                  Streaks: Awaiting streak indicators...
                </div>
              )}
            </div>
          </div>

          {/* Column 2: Profit Factor, Drawdown & Session-wise Bars (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between border-r border-slate-800/30 pr-0 lg:pr-4">
            
            {/* Drawdown & PF */}
            <div className="grid grid-cols-2 gap-3 text-sm font-mono">
              <div className={`p-2.5 rounded border ${pfBorder} bg-slate-900/10 flex flex-col justify-between`}>
                <span className="text-sm text-slate-500 uppercase font-black">Profit Factor</span>
                <span className={`text-base font-black mt-1 ${pfColor}`}>
                  {result.profitFactor.toFixed(2)}x
                </span>
              </div>
              
              <div className="p-2.5 rounded border border-slate-800/40 bg-slate-900/10 flex flex-col justify-between">
                <span className="text-sm text-slate-500 uppercase font-black">Max Drawdown</span>
                <span className={`text-base font-black mt-1 ${result.maxDrawdown >= 5.0 ? "text-red-400" : "text-white"}`}>
                  {result.maxDrawdown}%
                </span>
              </div>
            </div>

            {/* Session-wise Performance Bars */}
            <div className="mt-3.5 space-y-2">
              <span className="text-sm font-black text-slate-500 uppercase tracking-widest block">
                Session-Wise Win Rate Profile
              </span>
              
              <div className="space-y-1.5 text-sm font-mono text-slate-400">
                {/* Opening Session */}
                <div>
                  <div className="flex justify-between font-bold">
                    <span>9:15 - 10:30 (Opening)</span>
                    <span className="text-white">{result.sessionStats.opening}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full bg-sky-500 rounded-full" style={{ width: `${result.sessionStats.opening}%` }} />
                  </div>
                </div>

                {/* Mid Session */}
                <div>
                  <div className="flex justify-between font-bold">
                    <span>10:30 - 12:30 (Mid Session)</span>
                    <span className="text-white">{result.sessionStats.mid}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${result.sessionStats.mid}%` }} />
                  </div>
                </div>

                {/* Closing Session */}
                <div>
                  <div className="flex justify-between font-bold">
                    <span>12:30 - 15:30 (Closing)</span>
                    <span className="text-white">{result.sessionStats.closing}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: `${result.sessionStats.closing}%` }} />
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Column 3: Strategy Rankings & Insights Alerts (Span 4) */}
          <div className="lg:col-span-4 flex flex-col justify-between">
            
            {/* Top 3 Strategies table */}
            <div>
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block mb-1.5">
                🏆 STRATEGY EFFICIENCY RANKINGS
              </span>
              
              <div className="overflow-x-auto select-none border border-slate-900/60 rounded bg-slate-950/40">
                <table className="w-full text-left border-collapse text-sm font-mono">
                  <thead>
                    <tr className="border-b border-slate-800/40 bg-slate-900/20 text-sm text-slate-500 uppercase tracking-wider">
                      <th className="p-1.5 pl-2.5">Strategy</th>
                      <th className="p-1.5 text-center">Win Rate</th>
                      <th className="p-1.5 text-center">PF</th>
                      <th className="p-1.5 pr-2.5 text-right">Edge Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-400">
                    {result.strategyRanking.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-4 text-slate-600 italic">
                          No active trades to rank
                        </td>
                      </tr>
                    ) : (
                      result.strategyRanking.slice(0, 3).map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/10">
                          <td className="p-1.5 pl-2.5 text-slate-200 font-bold truncate max-w-[80px]" title={item.strategyName}>
                            {item.strategyName}
                          </td>
                          <td className="p-1.5 text-center">{item.winRate}%</td>
                          <td className="p-1.5 text-center">{item.profitFactor.toFixed(1)}</td>
                          <td className="p-1.5 pr-2.5 text-right font-black text-white">{item.score}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Edge alerts / insights */}
            <div className="mt-3.5 border-t border-slate-800/30 pt-3">
              <span className="text-sm font-black uppercase tracking-wider text-slate-500 block mb-1">
                Edge Detection Insights Alerts
              </span>
              
              <div className="p-2 rounded bg-slate-950/60 border border-slate-900/80 text-sm font-mono text-slate-400 space-y-1">
                {result.insights.map((insight, idx) => (
                  <div key={idx} className="flex items-start gap-1">
                    <span className="text-indigo-400 select-none">&gt;</span>
                    <span>{insight}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default PerformanceCard;

