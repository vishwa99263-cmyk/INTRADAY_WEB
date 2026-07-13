import type { StockData } from "../../src/types.js";

// In-memory spot price history for structure detection (per index)
const spotHistory: Record<string, { price: number; timestamp: number }[]> = {};

export interface TrendAnalysisResult {
  trend5m: "BULLISH" | "BEARISH" | "SIDEWAYS";
  trend15m: "BULLISH" | "BEARISH" | "SIDEWAYS";
  trend30m: "BULLISH" | "BEARISH" | "SIDEWAYS";
  trend1h: "BULLISH" | "BEARISH" | "SIDEWAYS";
  overall: "BULLISH" | "BEARISH" | "SIDEWAYS";
  alignment: "HIGH_CONFIDENCE_BUY" | "HIGH_CONFIDENCE_SELL" | "MIXED";
  strengthPct: number;    // 0 to 100
  isReversal: boolean;
  reversalType: "BULLISH_REVERSAL" | "BEARISH_REVERSAL" | "NONE";
  // Layer 2 additions
  structureType: "UPTREND" | "DOWNTREND" | "RANGE_BOUND" | "TRANSITION";
  higherHighs: boolean;   // Recent spot price making higher highs
  lowerLows: boolean;     // Recent spot price making lower lows
  keyLevel: number;       // Most significant support/resistance near spot
}

export function analyzeTrend(
  stocks: StockData[],
  page: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY",
  spotPrice = 0
): TrendAnalysisResult {
  const filteredStocks = stocks.filter(s => s.ticker !== "NSE:NIFTY50-INDEX" && s.ticker !== "BSE:SENSEX-INDEX" && s.ticker !== "NSE:NIFTYBANK-INDEX");

  // ── Track spot price history for structure analysis ──────────────────────
  if (spotPrice > 0) {
    if (!spotHistory[page]) spotHistory[page] = [];
    spotHistory[page].push({ price: spotPrice, timestamp: Date.now() });
    // Keep last 60 ticks (approx 6 mins of 6-sec ticks)
    if (spotHistory[page].length > 60) spotHistory[page].shift();
  }

  if (filteredStocks.length === 0) {
    return {
      trend5m: "SIDEWAYS", trend15m: "SIDEWAYS", trend30m: "SIDEWAYS", trend1h: "SIDEWAYS",
      overall: "SIDEWAYS", alignment: "MIXED", strengthPct: 50, isReversal: false,
      reversalType: "NONE", structureType: "RANGE_BOUND", higherHighs: false,
      lowerLows: false, keyLevel: spotPrice,
    };
  }

  // ── Calculate weighted score sums per timeframe ───────────────────────────
  let sumOverall = 0, sum5m = 0, sum15m = 0, sum30m = 0, sum1h = 0;
  let posWeightSum = 0, absNegWeightSum = 0;

  filteredStocks.forEach(s => {
    sumOverall += s.score || 0;
    sum5m  += s.scoreDifference || 0;
    sum15m += s.score15mDiff   || 0;
    sum30m += s.score30mDiff   || 0;
    sum1h  += s.score1hDiff    || 0;

    if ((s.score || 0) > 0) posWeightSum += s.weightage || 0;
    else if ((s.score || 0) < 0) absNegWeightSum += s.weightage || 0;
  });

  const getTrendLabel = (val: number): "BULLISH" | "BEARISH" | "SIDEWAYS" => {
    const threshold = 0.05;
    if (val > threshold) return "BULLISH";
    if (val < -threshold) return "BEARISH";
    return "SIDEWAYS";
  };

  const trend5m  = getTrendLabel(sum5m);
  const trend15m = getTrendLabel(sum15m);
  const trend30m = getTrendLabel(sum30m);
  const trend1h  = getTrendLabel(sum1h);
  const overall  = getTrendLabel(sumOverall);

  // ── Multi-timeframe Alignment ─────────────────────────────────────────────
  let alignment: TrendAnalysisResult["alignment"] = "MIXED";
  const bullCount = [trend5m, trend15m, trend30m, trend1h, overall].filter(t => t === "BULLISH").length;
  const bearCount = [trend5m, trend15m, trend30m, trend1h, overall].filter(t => t === "BEARISH").length;
  if (bullCount === 5) alignment = "HIGH_CONFIDENCE_BUY";
  else if (bearCount === 5) alignment = "HIGH_CONFIDENCE_SELL";

  // ── Trend Strength ────────────────────────────────────────────────────────
  const totalWeight = posWeightSum + absNegWeightSum;
  const strengthPct = totalWeight > 0 ? Math.round((posWeightSum / totalWeight) * 100) : 50;

  // ── Trend Reversal Detection ───────────────────────────────────────────────
  let isReversal = false;
  let reversalType: TrendAnalysisResult["reversalType"] = "NONE";
  if (overall === "BEARISH" && trend5m === "BULLISH" && trend15m === "BULLISH") {
    isReversal = true; reversalType = "BULLISH_REVERSAL";
  } else if (overall === "BULLISH" && trend5m === "BEARISH" && trend15m === "BEARISH") {
    isReversal = true; reversalType = "BEARISH_REVERSAL";
  }

  // ── Layer 2: Market Structure Detection ──────────────────────────────────
  let higherHighs = false;
  let lowerLows   = false;
  let structureType: TrendAnalysisResult["structureType"] = "RANGE_BOUND";
  let keyLevel = spotPrice;

  const hist = spotHistory[page] || [];
  if (hist.length >= 10) {
    // Split into 2 halves and compare extremes
    const mid = Math.floor(hist.length / 2);
    const firstHalf  = hist.slice(0, mid);
    const secondHalf = hist.slice(mid);

    const firstHigh  = Math.max(...firstHalf.map(h => h.price));
    const firstLow   = Math.min(...firstHalf.map(h => h.price));
    const secondHigh = Math.max(...secondHalf.map(h => h.price));
    const secondLow  = Math.min(...secondHalf.map(h => h.price));

    higherHighs = secondHigh > firstHigh;
    lowerLows   = secondLow < firstLow;

    // Structure classification
    if (higherHighs && !lowerLows) {
      structureType = "UPTREND";
      keyLevel = firstHigh; // broken resistance becomes support
    } else if (lowerLows && !higherHighs) {
      structureType = "DOWNTREND";
      keyLevel = firstLow;  // broken support becomes resistance
    } else if (higherHighs && lowerLows) {
      structureType = "TRANSITION"; // expanding range — volatile
      keyLevel = spotPrice;
    } else {
      structureType = "RANGE_BOUND";
      keyLevel = (firstHigh + firstLow) / 2;
    }
  }

  return {
    trend5m, trend15m, trend30m, trend1h, overall,
    alignment, strengthPct, isReversal, reversalType,
    structureType, higherHighs, lowerLows, keyLevel,
  };
}
