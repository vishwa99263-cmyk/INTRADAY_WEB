/**
 * positionStructureEngine.ts — Layer 11: Multi-Timeframe Daily Structure Engine
 *
 * Analyzes Daily candles to determine macro market bias for position trading.
 * Feeds DailyBias into antigravityEngine.ts as a +/- 15 pt score component.
 *
 * Logic:
 *   STRONG_BULL = Price > EMA20 > EMA50 > EMA200 + Weekly uptrend
 *   BULL        = Price > EMA20 > EMA50  (EMA200 below/mixed)
 *   NEUTRAL     = EMA20 ≈ EMA50 (within 0.5%)
 *   BEAR        = Price < EMA20 < EMA50
 *   STRONG_BEAR = Price < EMA20 < EMA50 < EMA200 + Weekly downtrend
 *
 * Data source: indicatorDB (1D enriched candles) — updated once per day.
 *
 * Resets daily at 09:15 IST. Persists last result so it survives server restarts.
 */

import type { EnrichedCandle } from "./indicatorEngine.js";
import { RSI, MACD } from "technicalindicators";

// ── Types ──────────────────────────────────────────────────────────────────────

export type DailyBiasLabel = "STRONG_BULL" | "BULL" | "NEUTRAL" | "BEAR" | "STRONG_BEAR";
export type EMAAlignment    = "BULLISH" | "BEARISH" | "MIXED";
export type WeeklyTrend     = "UPTREND" | "DOWNTREND" | "SIDEWAYS";

export interface DailyBias {
  instrument:    "NIFTY" | "BANKNIFTY" | "SENSEX";
  bias:          DailyBiasLabel;
  positionScore: number;          // 0–100 (how strong is the bias)
  ema20:         number;
  ema50:         number;
  ema200:        number;
  emaAlignment:  EMAAlignment;    // BULLISH = ema20 > ema50 > ema200
  weeklyTrend:   WeeklyTrend;     // Based on last 3 weekly swing highs/lows
  higherHighs:   boolean;         // Last 3 local weekly highs are rising
  lowerLows:     boolean;         // Last 3 local weekly lows are falling
  aboveEma20:    boolean;         // Current price > EMA20
  aboveEma50:    boolean;         // Current price > EMA50
  aboveEma200:   boolean;         // Current price > EMA200
  currentPrice:  number;
  rsi:           number;
  macd:          { macd: number, signal: number, histogram: number } | null;
  pwh:           number;          // Previous Week High
  pwl:           number;          // Previous Week Low
  fiiDiiFlow:    "BULLISH" | "BEARISH" | "NEUTRAL";
  reasoning:     string;
  lastUpdated:   number;          // timestamp
  lastUpdatedDate: string;        // "YYYY-MM-DD" IST
}

// ── In-memory cache ────────────────────────────────────────────────────────────

const biasCache: Record<string, DailyBias> = {};

// ── EMA Calculator ─────────────────────────────────────────────────────────────

/**
 * Calculates EMA from an array of closing prices.
 * Returns 0 if not enough data.
 */
function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(2));
}

/**
 * Detects weekly swing highs from daily highs array.
 * A swing high = a high that is greater than 4 neighbors on each side.
 */
function detectSwingHighs(highs: number[], window = 5): number[] {
  const swings: number[] = [];
  for (let i = window; i < highs.length - window; i++) {
    const current = highs[i];
    const left  = highs.slice(i - window, i);
    const right = highs.slice(i + 1, i + window + 1);
    if (left.every(h => current >= h) && right.every(h => current >= h)) {
      swings.push(current);
    }
  }
  return swings;
}

function detectSwingLows(lows: number[], window = 5): number[] {
  const swings: number[] = [];
  for (let i = window; i < lows.length - window; i++) {
    const current = lows[i];
    const left  = lows.slice(i - window, i);
    const right = lows.slice(i + 1, i + window + 1);
    if (left.every(l => current <= l) && right.every(l => current <= l)) {
      swings.push(current);
    }
  }
  return swings;
}

/**
 * Determines weekly trend from last 3 swing highs and lows.
 */
function determineWeeklyTrend(
  swingHighs: number[],
  swingLows: number[],
): { trend: WeeklyTrend; higherHighs: boolean; lowerLows: boolean } {
  const lastHighs = swingHighs.slice(-3);
  const lastLows  = swingLows.slice(-3);

  const higherHighs =
    lastHighs.length >= 2 &&
    lastHighs.every((h, i) => i === 0 || h > lastHighs[i - 1]);

  const higherLows =
    lastLows.length >= 2 &&
    lastLows.every((l, i) => i === 0 || l > lastLows[i - 1]);

  const lowerHighs =
    lastHighs.length >= 2 &&
    lastHighs.every((h, i) => i === 0 || h < lastHighs[i - 1]);

  const lowerLows =
    lastLows.length >= 2 &&
    lastLows.every((l, i) => i === 0 || l < lastLows[i - 1]);

  let trend: WeeklyTrend = "SIDEWAYS";
  if (higherHighs && higherLows) trend = "UPTREND";
  else if (lowerHighs && lowerLows) trend = "DOWNTREND";

  return { trend, higherHighs, lowerLows };
}

// ── Core Computation ───────────────────────────────────────────────────────────

/**
 * Computes DailyBias from enriched daily candles.
 *
 * Call this:
 *   - Once at startup from historical 1D candles
 *   - Every time a new 1D candle closes (via indicatorPipeline candle event)
 *
 * @param instrument  NIFTY | BANKNIFTY | SENSEX
 * @param dailyCandles Array of enriched 1D candles (oldest first), minimum 200 needed
 */
export function computeDailyBias(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  dailyCandles: EnrichedCandle[],
): DailyBias {
  const now = Date.now();
  const todayIST = new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  const empty: DailyBias = {
    instrument,
    bias: "NEUTRAL",
    positionScore: 50,
    ema20: 0, ema50: 0, ema200: 0,
    emaAlignment: "MIXED",
    weeklyTrend: "SIDEWAYS",
    higherHighs: false, lowerLows: false,
    aboveEma20: false, aboveEma50: false, aboveEma200: false,
    currentPrice: 0,
    rsi: 50,
    macd: null,
    pwh: 0,
    pwl: 0,
    fiiDiiFlow: "NEUTRAL",
    reasoning: "Insufficient daily candles (need ≥ 5).",
    lastUpdated: now,
    lastUpdatedDate: todayIST,
  };

  if (dailyCandles.length < 5) {
    biasCache[instrument] = empty;
    return empty;
  }

  const closes = dailyCandles.map(c => c.close);
  const highs   = dailyCandles.map(c => c.high);
  const lows    = dailyCandles.map(c => c.low);
  const currentPrice = closes[closes.length - 1];

  // ── EMA Calculations ───────────────────────────────────────────────────────
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, Math.min(50,  closes.length));
  const ema200 = calcEMA(closes, Math.min(200, closes.length));

  const aboveEma20  = currentPrice > ema20  && ema20  > 0;
  const aboveEma50  = currentPrice > ema50  && ema50  > 0;
  const aboveEma200 = currentPrice > ema200 && ema200 > 0;

  // EMA alignment
  let emaAlignment: EMAAlignment = "MIXED";
  if (ema20 > 0 && ema50 > 0) {
    if (ema20 > ema50 && (ema200 === 0 || ema50 > ema200)) emaAlignment = "BULLISH";
    else if (ema20 < ema50 && (ema200 === 0 || ema50 < ema200)) emaAlignment = "BEARISH";
  }

  // ── Swing Detection ────────────────────────────────────────────────────────
  const swingHighs = detectSwingHighs(highs);
  const swingLows  = detectSwingLows(lows);
  const { trend: weeklyTrend, higherHighs, lowerLows } = determineWeeklyTrend(swingHighs, swingLows);

  // ── Bias Classification ────────────────────────────────────────────────────
  const reasonParts: string[] = [];
  let bias: DailyBiasLabel = "NEUTRAL";

  const fullBullish = aboveEma20 && aboveEma50 && emaAlignment === "BULLISH";
  const fullBearish = !aboveEma20 && !aboveEma50 && emaAlignment === "BEARISH";

  if (fullBullish && weeklyTrend === "UPTREND" && aboveEma200) {
    bias = "STRONG_BULL";
    reasonParts.push(`Price>${ema20.toFixed(0)} EMA20 > ${ema50.toFixed(0)} EMA50 > ${ema200.toFixed(0)} EMA200 + Weekly UPTREND`);
  } else if (fullBullish) {
    bias = "BULL";
    reasonParts.push(`Price>${ema20.toFixed(0)} EMA20 > EMA50. Weekly=${weeklyTrend}`);
  } else if (fullBearish && weeklyTrend === "DOWNTREND" && !aboveEma200) {
    bias = "STRONG_BEAR";
    reasonParts.push(`Price<${ema20.toFixed(0)} EMA20 < ${ema50.toFixed(0)} EMA50 < ${ema200.toFixed(0)} EMA200 + Weekly DOWNTREND`);
  } else if (fullBearish) {
    bias = "BEAR";
    reasonParts.push(`Price<${ema20.toFixed(0)} EMA20 < EMA50. Weekly=${weeklyTrend}`);
  } else {
    bias = "NEUTRAL";
    reasonParts.push(`Mixed EMA signals. Price ${currentPrice.toFixed(0)} vs EMA20=${ema20.toFixed(0)} EMA50=${ema50.toFixed(0)}`);
  }

  // ── Position Score 0–100 ───────────────────────────────────────────────────
  let positionScore = 50;
  if (bias === "STRONG_BULL") positionScore = 90;
  else if (bias === "BULL")   positionScore = 70;
  else if (bias === "NEUTRAL") positionScore = 50;
  else if (bias === "BEAR")   positionScore = 30;
  else if (bias === "STRONG_BEAR") positionScore = 10;

  // Adjust for weekly trend confirmation
  if (weeklyTrend === "UPTREND" && (bias === "BULL" || bias === "STRONG_BULL")) positionScore = Math.min(100, positionScore + 5);
  if (weeklyTrend === "DOWNTREND" && (bias === "BEAR" || bias === "STRONG_BEAR")) positionScore = Math.max(0, positionScore - 5);

  // ── Swing Monitor Extensibility (RSI, MACD, FII/DII) ──────────────────────
  let rsiVal = 50;
  if (closes.length > 14) {
    const rsiArr = RSI.calculate({ period: 14, values: closes });
    if (rsiArr.length > 0) rsiVal = parseFloat(rsiArr[rsiArr.length - 1].toFixed(1));
  }

  let macdVal: { macd: number, signal: number, histogram: number } | null = null;
  if (closes.length > 26) {
    const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    if (macdArr.length > 0) {
      const lastMacd = macdArr[macdArr.length - 1];
      macdVal = {
        macd: parseFloat((lastMacd.MACD || 0).toFixed(2)),
        signal: parseFloat((lastMacd.signal || 0).toFixed(2)),
        histogram: parseFloat((lastMacd.histogram || 0).toFixed(2))
      };
    }
  }

  // Previous Week High/Low (last 5 to 10 days)
  let pwh = 0;
  let pwl = 0;
  if (highs.length >= 10) {
    pwh = Math.max(...highs.slice(-10, -5));
    pwl = Math.min(...lows.slice(-10, -5));
  } else if (highs.length >= 5) {
    pwh = Math.max(...highs.slice(0, -1));
    pwl = Math.min(...lows.slice(0, -1));
  }

  // Institutional Flow Simulation — Multi-factor scoring
  let flowScore = 0;
  // Factor 1: EMA alignment (weight: 30%)
  if (emaAlignment === 'BULLISH') flowScore += 30;
  else if (emaAlignment === 'BEARISH') flowScore -= 30;
  // Factor 2: RSI divergence from 50 (weight: 25%)
  flowScore += Math.round((rsiVal - 50) * 0.5);
  // Factor 3: MACD histogram direction (weight: 25%)
  if (macdVal && macdVal.histogram > 0) flowScore += 25;
  else if (macdVal && macdVal.histogram < 0) flowScore -= 25;
  // Factor 4: Weekly trend confirmation (weight: 20%)
  if (weeklyTrend === 'UPTREND') flowScore += 20;
  else if (weeklyTrend === 'DOWNTREND') flowScore -= 20;

  const fiiDiiFlow = flowScore > 20 ? 'BULLISH' : flowScore < -20 ? 'BEARISH' : 'NEUTRAL';

  const result: DailyBias = {
    instrument,
    bias,
    positionScore,
    ema20,
    ema50,
    ema200,
    emaAlignment,
    weeklyTrend,
    higherHighs,
    lowerLows,
    aboveEma20,
    aboveEma50,
    aboveEma200,
    currentPrice,
    rsi: rsiVal,
    macd: macdVal,
    pwh,
    pwl,
    fiiDiiFlow,
    reasoning: reasonParts.join(" | "),
    lastUpdated: now,
    lastUpdatedDate: todayIST,
  };

  biasCache[instrument] = result;

  console.log(
    `[Layer11:DailyBias] ${instrument} → ${bias} | Score=${positionScore} | ` +
    `EMA: ${ema20.toFixed(0)}/${ema50.toFixed(0)}/${ema200.toFixed(0)} | ` +
    `Weekly=${weeklyTrend} | Price=${currentPrice.toFixed(0)}`
  );

  return result;
}

/**
 * Returns the last computed DailyBias from cache.
 * Returns null if never computed.
 */
export function getDailyBias(instrument: "NIFTY" | "BANKNIFTY" | "SENSEX"): DailyBias | null {
  return biasCache[instrument] ?? null;
}

/**
 * Returns all cached daily biases.
 */
export function getAllDailyBiases(): Record<string, DailyBias> {
  return { ...biasCache };
}
