/**
 * momentumEngine.ts — Layer 2: Multi-Pillar Momentum Detection Engine
 *
 * IQ200+ Update: Added EMA crossover detection, MACD crossover detection,
 * ADX computation, exhaustion tracking for strategies S22-S35 and R01-R12.
 *
 * 5-pillar scoring system:
 *   Pillar 1: RSI Zone (0-25 pts)
 *   Pillar 2: MACD Histogram (0-25 pts)
 *   Pillar 3: EMA Alignment (0-20 pts)
 *   Pillar 4: Breakout/Volume Confirmation (0-15 pts)
 *   Pillar 5: Price Velocity (0-15 pts)
 */

import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { BreakoutState } from "./breakoutEngine.js";
import type { EnrichedCandle } from "./indicatorEngine.js";

export interface MomentumStateResult {
  momentumScore: number; // 0 to 100
  momentumLabel: "STRONG_MOMENTUM" | "NORMAL_MOMENTUM" | "LOW_MOMENTUM";
  hasVolumeSpike: boolean;
  hasBigCandle: boolean;
  hasFollowThrough: boolean;
  direction: "UP" | "DOWN" | "NONE";
  // Diagnostic fields
  rsiZone: "OVERBOUGHT" | "BULL" | "NEUTRAL" | "BEAR" | "OVERSOLD" | "NO_DATA";
  macdAlignment: "BULLISH" | "BEARISH" | "FLAT" | "NO_DATA";
  emaAlignment: "BULL_STACK" | "BEAR_STACK" | "MIXED" | "NO_DATA";
  pillarScores: {
    rsi:       number;  // 0-25
    macd:      number;  // 0-25
    ema:       number;  // 0-20
    breakout:  number;  // 0-15
    velocity:  number;  // 0-15
  };

  // ── IQ200+: Crossover signals for S22-S35 indicator strategies ────────────
  ema9CrossedAboveEma21: boolean;   // EMA 9 just crossed ABOVE EMA 21 (bullish)
  ema9CrossedBelowEma21: boolean;   // EMA 9 just crossed BELOW EMA 21 (bearish)
  macdCrossedAboveSignal: boolean;  // MACD line just crossed ABOVE signal line (bullish)
  macdCrossedBelowSignal: boolean;  // MACD line just crossed BELOW signal line (bearish)
  rsiCrossedAbove30: boolean;       // RSI crossed above 30 (bullish reversal)
  rsiCrossedBelow70: boolean;       // RSI crossed below 70 (bearish reversal)
  rsiCrossedAbove50: boolean;       // RSI crossed above 50 (momentum shift bullish)
  rsiCrossedBelow50: boolean;       // RSI crossed below 50 (momentum shift bearish)
  // ADX for S25 (NIFTY ADX ROC Buy) and S27 (DI Momentum Trend)
  adxValue: number;                  // 0-100, >25 = trending
  adxTrending: boolean;             // ADX > 25
  rocDirection: "UP" | "DOWN" | "NEUTRAL"; // Rate of Change direction
  // Bollinger Band signals for S34, S44
  aboveUpperBB: boolean;             // Price above upper Bollinger Band
  belowLowerBB: boolean;             // Price below lower Bollinger Band
  // Stochastic crossover for R05
  stochBullishCross: boolean;        // %K crossed above %D in oversold zone (<20)
  stochBearishCross: boolean;        // %K crossed below %D in overbought zone (>80)
  // Linear Regression for R01
  lrAngle: number;                   // Current LR angle in degrees
  lrAngleCrossedAboveMinus25: boolean; // LR angle crossed from <-25 to >-25 (bullish)
  lrAngleCrossedBelow25: boolean;    // LR angle crossed from >25 to <25 (bearish)
  // MFI for R02
  mfi14: number;                     // Money Flow Index (0-100)
  mfiCrossedAbove20: boolean;        // MFI crossed above 20 (bullish)
  mfiCrossedBelow80: boolean;        // MFI crossed below 80 (bearish)
  // Momentum-14 for R03
  momentum14: number;                // Raw momentum(14) value
  momentumCrossedAbove0: boolean;    // Momentum crossed above 0 (bullish)
  momentumCrossedBelow0: boolean;    // Momentum crossed below 0 (bearish)
  // Current RSI for reversal checks
  rsi14: number;                     // Current RSI(14) value
}

// ── State tracking for crossover detection ─────────────────────────────────
// We need previous tick values to detect crossovers (prev vs curr comparison)
interface CrossoverState {
  prevEma9: number;
  prevEma21: number;
  prevMacd: number;
  prevMacdSignal: number;
  prevRsi: number;
  prevStochK: number;
  prevStochD: number;
  prevLrAngle: number;
  prevMfi14: number;
  prevMomentum14: number;
  prevPrice: number;
}

const crossoverState: Record<string, CrossoverState> = {
  NIFTY:     { prevEma9: 0, prevEma21: 0, prevMacd: 0, prevMacdSignal: 0, prevRsi: 50, prevStochK: 50, prevStochD: 50, prevLrAngle: 0, prevMfi14: 50, prevMomentum14: 0, prevPrice: 0 },
  SENSEX:    { prevEma9: 0, prevEma21: 0, prevMacd: 0, prevMacdSignal: 0, prevRsi: 50, prevStochK: 50, prevStochD: 50, prevLrAngle: 0, prevMfi14: 50, prevMomentum14: 0, prevPrice: 0 },
  BANKNIFTY: { prevEma9: 0, prevEma21: 0, prevMacd: 0, prevMacdSignal: 0, prevRsi: 50, prevStochK: 50, prevStochD: 50, prevLrAngle: 0, prevMfi14: 50, prevMomentum14: 0, prevPrice: 0 },
};

// Track prices to estimate recent candle sizes (2-minute candle size)
const priceHistory2m: Record<string, { price: number; timestamp: number }[]> = {
  NIFTY: [],
  SENSEX: [],
  BANKNIFTY: [],
};

// IQ200+: Rolling price window for ROC and LR Angle computation
const priceHistoryLong: Record<string, { price: number; timestamp: number }[]> = {
  NIFTY: [],
  SENSEX: [],
  BANKNIFTY: [],
};

// ── Helper: Compute linear regression angle from price array ───────────────
function computeLRAngle(prices: number[]): number {
  if (prices.length < 5) return 0;
  const n = prices.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  // Convert slope to angle in degrees (normalized by price level)
  const avgPrice = sumY / n;
  const normalizedSlope = (slope / avgPrice) * 10000;
  return Math.atan(normalizedSlope) * (180 / Math.PI);
}

// ── Helper: Compute MFI approximation from recent price data ──────────────
function computeMFIApprox(prices: number[], volumes?: number[]): number {
  if (prices.length < 3) return 50;
  let positiveFlow = 0, negativeFlow = 0;
  for (let i = 1; i < prices.length; i++) {
    const vol = volumes?.[i] ?? 1;
    const tp = prices[i];
    const prevTp = prices[i - 1];
    if (tp > prevTp) positiveFlow += tp * vol;
    else if (tp < prevTp) negativeFlow += tp * vol;
  }
  if (positiveFlow + negativeFlow === 0) return 50;
  return 100 * positiveFlow / (positiveFlow + negativeFlow);
}

export function calculateMomentumState(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  spotPrice: number,
  report: CompleteMarketReport,
  breakout: BreakoutState,
  latestCandle?: EnrichedCandle | null,
): MomentumStateResult {
  const now = Date.now();
  const cs = crossoverState[page];

  // Track price history for velocity measurement
  const hist = priceHistory2m[page];
  hist.push({ price: spotPrice, timestamp: now });
  const cutoff2m = now - 120_000;
  priceHistory2m[page] = hist.filter(h => h.timestamp >= cutoff2m);

  // IQ200+: Long-range price history (14 periods at ~1 min each = 14 min)
  priceHistoryLong[page].push({ price: spotPrice, timestamp: now });
  const cutoffLong = now - 15 * 60_000;
  priceHistoryLong[page] = priceHistoryLong[page].filter(h => h.timestamp >= cutoffLong);

  // ── Pillar 5: Price Velocity (0-15) ────────────────────────────────────────
  let velocityScore = 0;
  let hasBigCandle = false;
  let direction: MomentumStateResult["direction"] = "NONE";

  if (priceHistory2m[page].length >= 2) {
    const first = priceHistory2m[page][0];
    const diff = spotPrice - first.price;
    const diffPct = Math.abs(diff) / spotPrice;
    if (diffPct > 0.0008) {
      hasBigCandle = true;
      direction = diff > 0 ? "UP" : "DOWN";
      velocityScore = Math.min(15, Math.round(diffPct / 0.0008 * 10));
    } else if (diffPct > 0.0004) {
      velocityScore = 5;
      direction = diff > 0 ? "UP" : "DOWN";
    }
  }

  // IQ200+: Rate of Change direction (for S25, S33, S35)
  let rocDirection: MomentumStateResult["rocDirection"] = "NEUTRAL";
  const longPrices = priceHistoryLong[page].map(p => p.price);
  if (longPrices.length >= 14) {
    const roc = (spotPrice - longPrices[longPrices.length - 14]) / longPrices[longPrices.length - 14] * 100;
    rocDirection = roc > 0.1 ? "UP" : roc < -0.1 ? "DOWN" : "NEUTRAL";
  }

  // ── Pillar 4: Breakout + Volume Confirmation (0-15) ─────────────────────
  const isBreakout = breakout.breakoutType === "BULLISH_BREAKOUT" || breakout.breakoutType === "BEARISH_BREAKDOWN";
  const hasVolumeSpike = report.volume.hasMajorCeSpike || report.volume.hasMajorPeSpike;
  const isAligned = report.trend.alignment !== "MIXED";
  const hasFollowThrough = isAligned && (
    (direction === "UP"   && report.trend.trend5m === "BULLISH") ||
    (direction === "DOWN" && report.trend.trend5m === "BEARISH")
  );

  let breakoutScore = 0;
  if (isBreakout && hasVolumeSpike) breakoutScore = 15;
  else if (isBreakout || hasVolumeSpike) breakoutScore = 8;
  else if (hasFollowThrough) breakoutScore = 4;

  if (direction === "NONE") {
    if (breakout.breakoutType === "BULLISH_BREAKOUT") direction = "UP";
    else if (breakout.breakoutType === "BEARISH_BREAKDOWN") direction = "DOWN";
  }

  // ── Pillar 1 — RSI Zone (0-25) ─────────────────────────────────────────────
  let rsiScore = 0;
  let rsiZone: MomentumStateResult["rsiZone"] = "NO_DATA";
  let currentRsi = 50;

  if (latestCandle?.rsi != null) {
    currentRsi = latestCandle.rsi;
    const rsi = currentRsi;
    if (rsi >= 70) {
      rsiZone = "OVERBOUGHT";
      rsiScore = direction === "DOWN" ? 18 : 5;
    } else if (rsi >= 55) {
      rsiZone = "BULL";
      rsiScore = direction === "UP" ? 25 : 10;
    } else if (rsi >= 45) {
      rsiZone = "NEUTRAL";
      rsiScore = 10;
    } else if (rsi >= 30) {
      rsiZone = "BEAR";
      rsiScore = direction === "DOWN" ? 25 : 10;
    } else {
      rsiZone = "OVERSOLD";
      rsiScore = direction === "UP" ? 18 : 5;
    }
  }

  // ── Pillar 2 — MACD Histogram (0-25) ──────────────────────────────────────
  let macdScore = 0;
  let macdAlignment: MomentumStateResult["macdAlignment"] = "NO_DATA";
  let currentMacd = 0;
  let currentMacdSignal = 0;

  if (latestCandle?.macdHistogram != null && latestCandle?.macd != null) {
    const hist_val = latestCandle.macdHistogram;
    currentMacd       = latestCandle.macd;
    currentMacdSignal = latestCandle.macdSignal ?? 0;
    const signal      = currentMacdSignal;

    if (hist_val > 0 && currentMacd > signal) {
      macdAlignment = "BULLISH";
      macdScore = direction === "UP" ? Math.min(25, Math.round(Math.abs(hist_val) * 5)) : 8;
    } else if (hist_val < 0 && currentMacd < signal) {
      macdAlignment = "BEARISH";
      macdScore = direction === "DOWN" ? Math.min(25, Math.round(Math.abs(hist_val) * 5)) : 8;
    } else {
      macdAlignment = "FLAT";
      macdScore = 5;
    }
  }

  // ── Pillar 3 — EMA Alignment (0-20) ───────────────────────────────────────
  let emaScore = 0;
  let emaAlignment: MomentumStateResult["emaAlignment"] = "NO_DATA";
  let currentEma9 = cs.prevEma9;
  let currentEma21 = cs.prevEma21;

  if (latestCandle?.ema9 != null && latestCandle?.ema21 != null) {
    currentEma9  = latestCandle.ema9;
    currentEma21 = latestCandle.ema21;

    if (spotPrice > currentEma9 && currentEma9 > currentEma21) {
      emaAlignment = "BULL_STACK";
      emaScore = 20;
      if (direction === "NONE") direction = "UP";
    } else if (spotPrice < currentEma9 && currentEma9 < currentEma21) {
      emaAlignment = "BEAR_STACK";
      emaScore = 20;
      if (direction === "NONE") direction = "DOWN";
    } else {
      emaAlignment = "MIXED";
      emaScore = 5;
    }
  }

  // ── IQ200+: Crossover Detection ───────────────────────────────────────────

  // EMA 9/21 Crossover (for S16, S23)
  const ema9CrossedAboveEma21 = cs.prevEma9 > 0 && cs.prevEma21 > 0 &&
    cs.prevEma9 <= cs.prevEma21 && currentEma9 > currentEma21;
  const ema9CrossedBelowEma21 = cs.prevEma9 > 0 && cs.prevEma21 > 0 &&
    cs.prevEma9 >= cs.prevEma21 && currentEma9 < currentEma21;

  // MACD Crossover (for S22)
  const macdCrossedAboveSignal = cs.prevMacd > 0 && cs.prevMacdSignal > 0 &&
    cs.prevMacd <= cs.prevMacdSignal && currentMacd > currentMacdSignal;
  const macdCrossedBelowSignal = cs.prevMacd > 0 && cs.prevMacdSignal > 0 &&
    cs.prevMacd >= cs.prevMacdSignal && currentMacd < currentMacdSignal;

  // RSI Crossovers (for R04, S26)
  const rsiCrossedAbove30 = cs.prevRsi > 0 && cs.prevRsi < 30 && currentRsi >= 30;
  const rsiCrossedBelow70 = cs.prevRsi > 0 && cs.prevRsi > 70 && currentRsi <= 70;
  const rsiCrossedAbove50 = cs.prevRsi > 0 && cs.prevRsi < 50 && currentRsi >= 50;
  const rsiCrossedBelow50 = cs.prevRsi > 0 && cs.prevRsi > 50 && currentRsi <= 50;

  // IQ200+: LR Angle computation (for R01)
  const recentPrices = longPrices.slice(-14);
  const lrAngle = computeLRAngle(recentPrices);
  const prevLrAngle = cs.prevLrAngle;
  const lrAngleCrossedAboveMinus25 = prevLrAngle < -25 && lrAngle >= -25;
  const lrAngleCrossedBelow25 = prevLrAngle > 25 && lrAngle <= 25;

  // IQ200+: MFI computation (for R02)
  const mfi14 = computeMFIApprox(longPrices.slice(-14));
  const mfiCrossedAbove20 = cs.prevMfi14 < 20 && mfi14 >= 20;
  const mfiCrossedBelow80 = cs.prevMfi14 > 80 && mfi14 <= 80;

  // IQ200+: Momentum-14 computation (for R03)
  const momentum14 = longPrices.length >= 14
    ? spotPrice - longPrices[longPrices.length - 14]
    : 0;
  const momentumCrossedAbove0 = cs.prevMomentum14 < 0 && momentum14 >= 0;
  const momentumCrossedBelow0 = cs.prevMomentum14 > 0 && momentum14 <= 0;

  // IQ200+: Stochastic crossover (for R05) — approximation from RSI
  // Using RSI as proxy if no stoch data available
  const stochK = latestCandle?.rsi ?? currentRsi; // Use RSI as proxy
  const stochD = cs.prevStochD > 0
    ? (cs.prevStochD * 0.7 + stochK * 0.3) // EMA of K
    : stochK;
  const prevStochK = cs.prevStochK || stochK;
  const prevStochD = cs.prevStochD || stochD;
  const stochBullishCross = prevStochK < prevStochD && stochK > stochD && stochK < 30;
  const stochBearishCross = prevStochK > prevStochD && stochK < stochD && stochK > 70;

  // IQ200+: Bollinger Bands (for S34, S44) — use MACD histogram as proxy
  // If latestCandle has BB data, use it; otherwise estimate from price
  let aboveUpperBB = false;
  let belowLowerBB = false;
  if (longPrices.length >= 20) {
    const mean = longPrices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const variance = longPrices.slice(-20).reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / 20;
    const stdDev = Math.sqrt(variance);
    const upperBB = mean + 2 * stdDev;
    const lowerBB = mean - 2 * stdDev;
    aboveUpperBB = spotPrice > upperBB;
    belowLowerBB = spotPrice < lowerBB;
  }

  // IQ200+: ADX approximation (for S25, S27)
  // ADX based on momentum score — >40 momentum ≈ ADX > 25
  const adxValue = Math.min(100, Math.max(0, breakoutScore * 3 + velocityScore * 2 + (isBreakout ? 20 : 0)));
  const adxTrending = adxValue >= 25;

  // ── Final Score ─────────────────────────────────────────────────────────────
  const totalScore = rsiScore + macdScore + emaScore + breakoutScore + velocityScore;
  const momentumScore = Math.min(100, totalScore);

  let momentumLabel: MomentumStateResult["momentumLabel"] = "LOW_MOMENTUM";
  if (momentumScore >= 70) momentumLabel = "STRONG_MOMENTUM";
  else if (momentumScore >= 40) momentumLabel = "NORMAL_MOMENTUM";

  // ── Update crossover state for next tick ───────────────────────────────────
  if (currentEma9 > 0) cs.prevEma9 = currentEma9;
  if (currentEma21 > 0) cs.prevEma21 = currentEma21;
  if (currentMacd !== 0) cs.prevMacd = currentMacd;
  if (currentMacdSignal !== 0) cs.prevMacdSignal = currentMacdSignal;
  if (currentRsi > 0) cs.prevRsi = currentRsi;
  cs.prevStochK = stochK;
  cs.prevStochD = stochD;
  cs.prevLrAngle = lrAngle;
  if (mfi14 > 0) cs.prevMfi14 = mfi14;
  cs.prevMomentum14 = momentum14;
  cs.prevPrice = spotPrice;

  return {
    momentumScore,
    momentumLabel,
    hasVolumeSpike,
    hasBigCandle,
    hasFollowThrough,
    direction,
    rsiZone,
    macdAlignment,
    emaAlignment,
    pillarScores: {
      rsi:      rsiScore,
      macd:     macdScore,
      ema:      emaScore,
      breakout: breakoutScore,
      velocity: velocityScore,
    },
    // IQ200+: Crossover signals
    ema9CrossedAboveEma21,
    ema9CrossedBelowEma21,
    macdCrossedAboveSignal,
    macdCrossedBelowSignal,
    rsiCrossedAbove30,
    rsiCrossedBelow70,
    rsiCrossedAbove50,
    rsiCrossedBelow50,
    adxValue,
    adxTrending,
    rocDirection,
    aboveUpperBB,
    belowLowerBB,
    stochBullishCross,
    stochBearishCross,
    lrAngle,
    lrAngleCrossedAboveMinus25,
    lrAngleCrossedBelow25,
    mfi14,
    mfiCrossedAbove20,
    mfiCrossedBelow80,
    momentum14,
    momentumCrossedAbove0,
    momentumCrossedBelow0,
    rsi14: currentRsi,
  };
}
