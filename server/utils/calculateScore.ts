import type { StockData } from "../../src/types.js";

/** SCORE = weightage × changePercent, rounded to 3 dp */
export function calcScore(weightage: number, changePercent: number): number {
  return parseFloat((weightage * changePercent).toFixed(3));
}

/**
 * Mutates a stock in-place: recalculates score and all backup diffs
 * from the current changePercent and stored backup values.
 */
export function recalcStock(stock: StockData): void {
  stock.score           = calcScore(stock.weightage, stock.changePercent);
  stock.scoreDifference = parseFloat((stock.score - stock.backupScore).toFixed(3));
  stock.score15mDiff    = parseFloat((stock.score - (stock.score15m  ?? 0)).toFixed(3));
  stock.score30mDiff    = parseFloat((stock.score - (stock.score30m  ?? 0)).toFixed(3));
  stock.score1hDiff     = parseFloat((stock.score - (stock.score1h   ?? 0)).toFixed(3));
}
