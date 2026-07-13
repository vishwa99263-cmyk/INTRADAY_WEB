import type { StockData } from "../../src/types.js";

export interface WeightedSummary {
  top10Sum: number;
  next15Sum: number;
  remainingSum: number;
  totalSum: number;
  advances: number;
  declines: number;
  unchanged: number;
  next12Sum?: number; // added for SENSEX
}

export function calcWeightedSummary(stocks: StockData[]): WeightedSummary {
  const filtered = stocks.filter(s => s.ticker !== "NSE:NIFTY50-INDEX" && s.ticker !== "BSE:SENSEX-INDEX");
  const sorted = [...filtered].sort((a, b) => b.weightage - a.weightage);
  const isSensex = filtered.length === 30;

  const top10Sum = parseFloat(sorted.slice(0, 10).reduce((a, s) => a + s.score, 0).toFixed(3));

  if (isSensex) {
    // SENSEX: Top 10, Next 12, Total 30
    const next12Sum = parseFloat(sorted.slice(10, 22).reduce((a, s) => a + s.score, 0).toFixed(3));
    const remainingSum = parseFloat(sorted.slice(22).reduce((a, s) => a + s.score, 0).toFixed(3));
    const totalSum = parseFloat((top10Sum + next12Sum + remainingSum).toFixed(3));

    return {
      top10Sum,
      next15Sum: next12Sum, // Backwards compatible mapping
      next12Sum,
      remainingSum,
      totalSum,
      advances:  filtered.filter(s => s.changePercent > 0).length,
      declines:  filtered.filter(s => s.changePercent < 0).length,
      unchanged: filtered.filter(s => s.changePercent === 0).length,
    };
  } else {
    // NIFTY: Top 10, Next 15, Total 50
    const next15Sum    = parseFloat(sorted.slice(10, 25).reduce((a, s) => a + s.score, 0).toFixed(3));
    const remainingSum = parseFloat(sorted.slice(25)    .reduce((a, s) => a + s.score, 0).toFixed(3));
    const totalSum     = parseFloat((top10Sum + next15Sum + remainingSum).toFixed(3));

    return {
      top10Sum,
      next15Sum,
      remainingSum,
      totalSum,
      advances:  filtered.filter(s => s.changePercent > 0).length,
      declines:  filtered.filter(s => s.changePercent < 0).length,
      unchanged: filtered.filter(s => s.changePercent === 0).length,
    };
  }
}
