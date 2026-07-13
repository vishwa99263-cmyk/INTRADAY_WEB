import type { StockData } from "../../src/types.js";

export interface BacktestResult {
  page: "NIFTY" | "SENSEX" | "BANKNIFTY";
  totalSignals: number;
  estimatedWins: number;
  estimatedLosses: number;
  estimatedWinRate: number;  // 0-100
  strategyBreakdown: {
    strategyName: string;
    signals: number;
    estimatedWinRate: number;
  }[];
  lastRunAt: number;
  reasoning: string;
}

// Cache results (recomputed once per session / when data changes)
const backtestCache: Record<string, BacktestResult | null> = { NIFTY: null, SENSEX: null, BANKNIFTY: null };
let lastRunTimestamp: Record<string, number> = { NIFTY: 0, SENSEX: 0, BANKNIFTY: 0 };
const RERUN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Lightweight backtesting using stored timed score diffs.
 * Replays score sequences to determine where buy/sell signals would have fired.
 * Uses the change in score diffs as a proxy for price direction.
 */
export function runBacktest(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  stocks: StockData[],
): BacktestResult {
  const now = Date.now();
  // Return cached result if fresh enough
  if (backtestCache[page] && now - lastRunTimestamp[page] < RERUN_INTERVAL_MS) {
    return backtestCache[page]!;
  }

  if (stocks.length === 0) {
    const empty: BacktestResult = {
      page, totalSignals: 0, estimatedWins: 0, estimatedLosses: 0,
      estimatedWinRate: 0, strategyBreakdown: [], lastRunAt: now,
      reasoning: "No stock data available for backtesting.",
    };
    backtestCache[page] = empty;
    lastRunTimestamp[page] = now;
    return empty;
  }

  // ── Backtest: Score diff alignment strategy ───────────────────────────────
  // For each stock, check: if 5m scoreDiff > 0, did 15m and 30m also agree?
  // Proxy: Agreement across timeframes = likely direction was sustained
  let alignedBullish = 0, alignedBearish = 0;
  let followedBullish = 0, followedBearish = 0;

  stocks.forEach(s => {
    const d5  = s.scoreDifference || 0;
    const d15 = s.score15mDiff   || 0;
    const d30 = s.score30mDiff   || 0;
    const d1h = s.score1hDiff    || 0;

    const allBull = d5 > 0 && d15 > 0 && d30 > 0;
    const allBear = d5 < 0 && d15 < 0 && d30 < 0;

    if (allBull) {
      alignedBullish++;
      // Did 1h follow? = WIN
      if (d1h > 0) followedBullish++;
    }
    if (allBear) {
      alignedBearish++;
      if (d1h < 0) followedBearish++;
    }
  });

  const totalAligned = alignedBullish + alignedBearish;
  const totalFollowed = followedBullish + followedBearish;
  const estimatedWinRate = totalAligned > 0
    ? Math.round((totalFollowed / totalAligned) * 100)
    : 50;

  const strategyBreakdown = [
    {
      strategyName: "MULTI_TIMEFRAME_ALIGNMENT",
      signals: totalAligned,
      estimatedWinRate,
    },
    {
      strategyName: "BULLISH_ALIGNMENT",
      signals: alignedBullish,
      estimatedWinRate: alignedBullish > 0 ? Math.round((followedBullish / alignedBullish) * 100) : 50,
    },
    {
      strategyName: "BEARISH_ALIGNMENT",
      signals: alignedBearish,
      estimatedWinRate: alignedBearish > 0 ? Math.round((followedBearish / alignedBearish) * 100) : 50,
    },
  ];

  const result: BacktestResult = {
    page,
    totalSignals: totalAligned,
    estimatedWins: totalFollowed,
    estimatedLosses: totalAligned - totalFollowed,
    estimatedWinRate,
    strategyBreakdown,
    lastRunAt: now,
    reasoning: `Based on ${stocks.length} stocks. Bull aligned=${alignedBullish} (followed=${followedBullish}), Bear aligned=${alignedBearish} (followed=${followedBearish}).`,
  };

  backtestCache[page] = result;
  lastRunTimestamp[page] = now;
  return result;
}

export function getBacktestResult(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): BacktestResult | null {
  return backtestCache[page];
}
