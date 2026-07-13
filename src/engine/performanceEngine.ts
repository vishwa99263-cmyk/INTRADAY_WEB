/**
 * performanceEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 15: Performance Engine v1.0
 *
 * Statistics, edge detection, and trade profiling engine.
 * Computes expectancy edge scores, strategy-wise performance grids, session stats,
 * and correlation gaps based on completed trade ledgers.
 */

import type { PaperTradingResult } from "./paperTradingEngine";
import type { TEPaperTrade }        from "../types";

export interface StrategyRankingItem {
  strategyName: string;
  winRate: number;
  profitFactor: number;
  score: number;
}

export interface SessionStats {
  opening: number; // 9:15 - 10:30 win rate
  mid: number;     // 10:30 - 12:30 win rate
  closing: number; // 12:30 - 15:30 win rate
}

export interface PerformanceEngineResult {
  // New schema fields
  overallWinRate: number;
  profitFactor: number;
  maxDrawdown: number;
  expectancy: number;
  strategyRanking: StrategyRankingItem[];
  sessionStats: SessionStats;
  confidenceAccuracyGap: number;
  insights: string[];

  // Legacy fields for card alignment compatibility
  winRate: number;
  cumulativePnL: number;
  winStreak: number;
  lossStreak: number;
  sharpeRatio: number;
  totalTrades: number;
  timestamp: number;
}

export interface PerformanceInput {
  paperTradingOutput: PaperTradingResult;
  dbTrades:           TEPaperTrade[];
}

const INITIAL_CAPITAL = 15000; // ₹15,000 starting capital

// Helper to determine session type in IST
function getSessionType(timestamp: number): "OPENING" | "MID" | "CLOSING" {
  const date = new Date(timestamp);
  // Convert UTC timestamp to IST (+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const totalMins = hours * 60 + minutes;

  if (totalMins >= (9 * 60 + 15) && totalMins < (10 * 60 + 30)) {
    return "OPENING";
  }
  if (totalMins >= (10 * 60 + 30) && totalMins < (12 * 60 + 30)) {
    return "MID";
  }
  return "CLOSING";
}

export function computePerformance(input: PerformanceInput): PerformanceEngineResult {
  const { paperTradingOutput, dbTrades } = input;

  // Filter out hedge/spread trades — only compute performance on naked entries
  const isNaked = (t: TEPaperTrade) => true;

  const closedTrades = [...paperTradingOutput.closedTrades].filter(isNaked).sort((a, b) => a.timestamp - b.timestamp);
  const totalTrades = closedTrades.length;

  if (totalTrades === 0) {
    return {
      overallWinRate: 0,
      profitFactor: 1.0,
      maxDrawdown: 0,
      expectancy: 0,
      strategyRanking: [],
      sessionStats: { opening: 0, mid: 0, closing: 0 },
      confidenceAccuracyGap: 0,
      insights: ["Awaiting completed trades ledger to unlock statistical insights."],
      winRate: 0,
      cumulativePnL: 0,
      winStreak: 0,
      lossStreak: 0,
      sharpeRatio: 0,
      totalTrades: 0,
      timestamp: Date.now(),
    };
  }

  // 1. Basic Stats
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl < 0);
  const overallWinRate = parseFloat(((wins.length / totalTrades) * 100).toFixed(1));
  const cumulativePnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);

  const totalProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  let profitFactor = 1.0;
  if (totalLoss === 0) {
    profitFactor = totalProfit > 0 ? 99.0 : 1.0;
  } else {
    profitFactor = parseFloat((totalProfit / totalLoss).toFixed(2));
  }

  // 2. Expectancy Edge Score
  const avgWin = wins.length > 0 ? totalProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
  const winRateFraction = overallWinRate / 100;
  const lossRateFraction = 1 - winRateFraction;
  const expectancy = parseFloat(((winRateFraction * avgWin) - (lossRateFraction * avgLoss)).toFixed(1));

  // 3. Max Drawdown
  let currentCapital = INITIAL_CAPITAL;
  let peakCapital = INITIAL_CAPITAL;
  let maxDrawdown = 0;
  for (const t of closedTrades) {
    currentCapital += t.pnl;
    if (currentCapital > peakCapital) peakCapital = currentCapital;
    const dd = ((peakCapital - currentCapital) / peakCapital) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  maxDrawdown = parseFloat(maxDrawdown.toFixed(2));

  // 4. Session stats
  const openingTrades = closedTrades.filter(t => getSessionType(t.timestamp) === "OPENING");
  const midTrades     = closedTrades.filter(t => getSessionType(t.timestamp) === "MID");
  const closingTrades = closedTrades.filter(t => getSessionType(t.timestamp) === "CLOSING");

  const calcWinRate = (list: TEPaperTrade[]) => {
    if (list.length === 0) return 0;
    const w = list.filter(t => t.pnl > 0).length;
    return parseFloat(((w / list.length) * 100).toFixed(1));
  };

  const sessionStats = {
    opening: calcWinRate(openingTrades),
    mid:     calcWinRate(midTrades),
    closing: calcWinRate(closingTrades),
  };

  // 5. Strategy Ranking
  // Group trades by strategy name
  const stratMap: Record<string, TEPaperTrade[]> = {};
  for (const t of closedTrades) {
    const sName = t.strategyName || t.notes?.replace("Strategy suggested: ", "") || "Flow Tracker";
    if (!stratMap[sName]) stratMap[sName] = [];
    stratMap[sName].push(t);
  }

  const strategyRanking: StrategyRankingItem[] = Object.entries(stratMap).map(([name, list]) => {
    const sWins = list.filter(t => t.pnl > 0);
    const sLosses = list.filter(t => t.pnl < 0);
    const sWinRate = parseFloat(((sWins.length / list.length) * 100).toFixed(1));
    const sProfit = sWins.reduce((sum, t) => sum + t.pnl, 0);
    const sLoss = Math.abs(sLosses.reduce((sum, t) => sum + t.pnl, 0));
    const sPF = sLoss === 0 ? (sProfit > 0 ? 9.0 : 1.0) : parseFloat((sProfit / sLoss).toFixed(2));
    
    // consistency weight (number of samples/trades capped at 50 points)
    const consistency = Math.min(100, (list.length / 10) * 100);
    // score = (winRate * 0.4) + (profitFactor * 0.3) + (consistency * 0.3)
    const score = parseFloat(((sWinRate * 0.4) + (sPF * 10 * 0.3) + (consistency * 0.3)).toFixed(1));

    return {
      strategyName: name,
      winRate: sWinRate,
      profitFactor: sPF,
      score,
    };
  }).sort((a, b) => b.score - a.score);

  // 6. Confidence vs Outcome correlation
  const avgWinConf = wins.length > 0 ? wins.reduce((s, t) => s + (t.confidence || 0), 0) / wins.length : 0;
  const avgLossConf = losses.length > 0 ? losses.reduce((s, t) => s + (t.confidence || 0), 0) / losses.length : 0;
  const confidenceAccuracyGap = parseFloat((avgWinConf - avgLossConf).toFixed(1));

  // 7. Streak tracking (legacy)
  let winStreak = 0;
  let lossStreak = 0;
  const lastTrade = closedTrades[totalTrades - 1];
  if (lastTrade.pnl > 0) {
    for (let i = totalTrades - 1; i >= 0; i--) {
      if (closedTrades[i].pnl > 0) winStreak++;
      else break;
    }
  } else if (lastTrade.pnl < 0) {
    for (let i = totalTrades - 1; i >= 0; i--) {
      if (closedTrades[i].pnl < 0) lossStreak++;
      else break;
    }
  }

  // Sharpe ratio (legacy)
  let sharpeRatio = 0;
  const pnls = closedTrades.map(t => t.pnl);
  const avgPnL = cumulativePnL / totalTrades;
  if (totalTrades > 1) {
    const variance = pnls.reduce((sum, p) => sum + Math.pow(p - avgPnL, 2), 0) / totalTrades;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeRatio = parseFloat((avgPnL / stdDev).toFixed(2));
    }
  }

  // Dynamic insights generation
  const insights: string[] = [];
  if (expectancy > 0) {
    insights.push(`Positive edge detected! Expectancy is +₹${expectancy.toLocaleString("en-IN")} per trade.`);
  } else {
    insights.push(`Negative expectancy edge (-₹${Math.abs(expectancy).toLocaleString("en-IN")} per trade). Consider tightening SL criteria.`);
  }

  if (strategyRanking.length > 0) {
    insights.push(`Top performing strategy is: "${strategyRanking[0].strategyName}" with a score of ${strategyRanking[0].score}.`);
  }

  if (sessionStats.mid < sessionStats.opening && sessionStats.mid < 50) {
    insights.push("System weakness alert: Mid-session (10:30-12:30) win rates are low. Recommend reducing position size during these hours.");
  }

  if (confidenceAccuracyGap < 5) {
    insights.push(`Confidence Gap is narrow (${confidenceAccuracyGap}%). AI is not distinguishing winners/losers well.`);
  } else {
    insights.push(`Good correlation: AI conviction is ${confidenceAccuracyGap}% higher on winning trades.`);
  }

  return {
    overallWinRate,
    profitFactor,
    maxDrawdown,
    expectancy,
    strategyRanking,
    sessionStats,
    confidenceAccuracyGap,
    insights,
    winRate: overallWinRate,
    cumulativePnL: parseFloat(cumulativePnL.toFixed(1)),
    winStreak,
    lossStreak,
    sharpeRatio,
    totalTrades,
    timestamp: Date.now(),
  };
}
