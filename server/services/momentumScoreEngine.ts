/**
 * momentumScoreEngine.ts — Quant Momentum Score Engine for CE Buying
 *
 * Calculates a composite 0-100 Momentum Score per tick for NIFTY / SENSEX.
 * Designed exclusively for intraday CE (Call Option) buyers on Indian indices.
 *
 * Score Components (5 Pillars):
 *   1. Price ROC  — Rate of Change over 5 candles                  20%
 *   2. RSI 14     — Relative Strength Index (50-70 ideal zone)      20%
 *   3. MACD Hist  — Normalized MACD Histogram direction             20%
 *   4. ADX+EMA    — ADX(14) Trend Strength + EMA alignment          25%
 *   5. Volume     — Volume vs 20-period moving average              15%
 *
 * Filters (ALL must pass for BUY CE signal):
 *   ✅ Price > VWAP
 *   ✅ ADX >= 25 AND DI+ > DI-
 *   ✅ MACD Histogram positive (momentum direction)
 *   ✅ RSI between 50 and 70 (not overbought)
 *   ✅ Momentum Score >= 60
 *
 * Resets daily at 09:15 IST.
 */

import type { EnrichedCandle } from "./indicatorEngine.js";
import type { RTCandle } from "./chartRealtime.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ADXResult {
  adx: number;
  diPlus: number;
  diMinus: number;
  trendStrong: boolean;   // ADX >= 25
  bullishTrend: boolean;  // DI+ > DI-
}

export interface MomentumScoreBreakdown {
  roc:     number; // 0-20  (price ROC contribution)
  rsi:     number; // 0-20  (RSI zone contribution)
  macd:    number; // 0-20  (MACD histogram contribution)
  adxEma:  number; // 0-25  (ADX + EMA alignment contribution)
  volume:  number; // 0-15  (volume momentum contribution)
  total:   number; // 0-100 (composite score)
}

export interface MomentumScoreState {
  instrument: "NIFTY" | "SENSEX" | "BANKNIFTY";
  score:      number;          // 0–100 Composite Momentum Score
  label:      "STRONG" | "MODERATE" | "TRANSITION" | "WEAK" | "NO_TRADE";
  color:      "dark-green" | "green" | "light-green" | "yellow" | "gray";
  signal:     "BUY_CE" | "WATCH" | "NO_TRADE";
  signalGrade: "ULTRA_STRONG" | "STRONG" | "POTENTIAL" | "WATCH" | "NONE";

  // Filter states
  aboveVWAP:    boolean;
  vwap:         number;
  adxResult:    ADXResult;
  rsi:          number;
  macdHist:     number;

  // Breakdown for debug/display
  breakdown:    MomentumScoreBreakdown;

  // Entry setup (calculated when BUY_CE)
  entryLtp:     number;
  stopLoss:     number;  // 1.5% below VWAP or 30pts below
  target:       number;  // 2% profit or 60pts above
  riskReward:   number;

  // Context
  timestamp:    number;
  lastReset:    string;   // IST date of last daily reset
}

// ── Constants ──────────────────────────────────────────────────────────────────

const NIFTY_TICK_PER_PT  = 50;   // lot size
const SENSEX_TICK_PER_PT = 10;

const VWAP_SL_BUFFER = 0.985;   // VWAP - 1.5%
const TARGET_MULT    = 1.02;    // +2% target
const ADX_PERIOD     = 14;

// ── In-Memory State ────────────────────────────────────────────────────────────

interface DailyState {
  lastReset: string;
  priceHistory:  number[];   // close prices for ROC, EMA, etc.
  volumeHistory: number[];
  highHistory:   number[];
  lowHistory:    number[];
  vwapCumTPV:    number;
  vwapCumVol:    number;
}

const dailyState: Record<"NIFTY" | "SENSEX" | "BANKNIFTY", DailyState> = {
  NIFTY:  { lastReset: "", priceHistory: [], volumeHistory: [], highHistory: [], lowHistory: [], vwapCumTPV: 0, vwapCumVol: 0 },
  SENSEX: { lastReset: "", priceHistory: [], volumeHistory: [], highHistory: [], lowHistory: [], vwapCumTPV: 0, vwapCumVol: 0 },
  BANKNIFTY: { lastReset: "", priceHistory: [], volumeHistory: [], highHistory: [], lowHistory: [], vwapCumTPV: 0, vwapCumVol: 0 },
};

// Latest computed state (cached for broadcast)
export const latestMomentumScore: Record<"NIFTY" | "SENSEX" | "BANKNIFTY", MomentumScoreState | null> = {
  NIFTY:  null,
  SENSEX: null,
  BANKNIFTY: null,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getISTDate(): string {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function getISTHour(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).getUTCHours();
}

function getISTMinute(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).getUTCMinutes();
}

function simpleMA(arr: number[], period: number): number {
  if (arr.length < period) return arr[arr.length - 1] ?? 0;
  const slice = arr.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const alpha = 2 / (period + 1);
  const result: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * alpha + result[i - 1] * (1 - alpha));
  }
  return result;
}

// ── ADX Calculation ────────────────────────────────────────────────────────────

function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = ADX_PERIOD,
): ADXResult {
  const DEFAULT: ADXResult = { adx: 0, diPlus: 0, diMinus: 0, trendStrong: false, bullishTrend: false };
  if (highs.length < period + 2 || lows.length < period + 2 || closes.length < period + 2) {
    return DEFAULT;
  }

  const len = closes.length;
  const trArr:    number[] = [];
  const dmPlus:   number[] = [];
  const dmMinus:  number[] = [];

  for (let i = 1; i < len; i++) {
    const h = highs[i], l = lows[i], ph = highs[i - 1], pl = lows[i - 1], pc = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const upMove   = h - ph;
    const downMove = pl - l;
    trArr.push(tr);
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing
  let smoothTR = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothDP = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothDM = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArr: number[] = [];

  for (let i = period; i < trArr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trArr[i];
    smoothDP = smoothDP - smoothDP / period + dmPlus[i];
    smoothDM = smoothDM - smoothDM / period + dmMinus[i];

    const diP = smoothTR > 0 ? (smoothDP / smoothTR) * 100 : 0;
    const diM = smoothTR > 0 ? (smoothDM / smoothTR) * 100 : 0;
    const diSum = diP + diM;
    const dx = diSum > 0 ? (Math.abs(diP - diM) / diSum) * 100 : 0;
    dxArr.push(dx);
  }

  if (dxArr.length < period) return DEFAULT;

  const adxRaw = dxArr.slice(-period).reduce((a, b) => a + b, 0) / period;
  const adx    = Math.min(100, Math.round(adxRaw * 10) / 10);

  // Last DI+ and DI- from final iteration
  const lastSmoothTR = smoothTR;
  const lastSmoothDP = smoothDP;
  const lastSmoothDM = smoothDM;
  const diPlus  = lastSmoothTR > 0 ? Math.round((lastSmoothDP / lastSmoothTR) * 1000) / 10 : 0;
  const diMinus = lastSmoothTR > 0 ? Math.round((lastSmoothDM / lastSmoothTR) * 1000) / 10 : 0;

  return {
    adx,
    diPlus,
    diMinus,
    trendStrong:  adx >= 25,
    bullishTrend: diPlus > diMinus,
  };
}

// ── Score Component Calculators ────────────────────────────────────────────────

/** Price ROC: Rate of Change over last 5 periods (0-20pts) */
function scoreROC(prices: number[]): number {
  if (prices.length < 6) return 0;
  const current  = prices[prices.length - 1];
  const previous = prices[prices.length - 6];
  if (previous <= 0) return 0;
  const rocPct = ((current - previous) / previous) * 100;

  if (rocPct >= 1.5) return 20;
  if (rocPct >= 1.0) return 16;
  if (rocPct >= 0.5) return 12;
  if (rocPct >= 0.2) return 8;
  if (rocPct >  0.0) return 4;
  return 0;
}

/** RSI Score: 50-70 optimal zone for CE buying (0-20pts) */
function scoreRSI(rsi: number): number {
  if (rsi >= 60 && rsi <= 70) return 20;  // Optimal momentum zone
  if (rsi >= 55 && rsi < 60)  return 16;  // Good
  if (rsi >= 50 && rsi < 55)  return 12;  // Acceptable
  if (rsi >= 70 && rsi <= 75) return 8;   // Mildly overbought, reduce
  if (rsi >= 45 && rsi < 50)  return 4;   // Transitioning
  return 0;  // Below 45 or above 75
}

/** MACD Histogram score: normalized momentum direction (0-20pts) */
function scoreMACDHist(hist: number, prevHist: number): number {
  if (hist <= 0) return 0;
  if (hist > prevHist && hist > 0) {
    // Expanding histogram (accelerating momentum)
    const magnitude = Math.abs(hist);
    if (magnitude >= 10)  return 20;
    if (magnitude >= 5)   return 16;
    if (magnitude >= 2)   return 12;
    return 8;
  }
  if (hist > 0 && hist <= prevHist) {
    // Positive but shrinking
    return 4;
  }
  return 0;
}

/** ADX + EMA Trend Strength: combined (0-25pts) */
function scoreADXandEMA(
  adxResult: ADXResult,
  prices: number[],
): number {
  let score = 0;

  // ADX strength
  if (adxResult.adx >= 40 && adxResult.bullishTrend) score += 15;
  else if (adxResult.adx >= 30 && adxResult.bullishTrend) score += 12;
  else if (adxResult.adx >= 25 && adxResult.bullishTrend) score += 9;
  else if (adxResult.adx >= 20 && adxResult.bullishTrend) score += 5;

  // EMA alignment bonus: EMA9 > EMA21 > EMA50
  const len = prices.length;
  if (len >= 50) {
    const ema9Series  = ema(prices.slice(-60), 9);
    const ema21Series = ema(prices.slice(-60), 21);
    const ema50Series = ema(prices.slice(-60), 50);
    const e9 = ema9Series[ema9Series.length - 1] ?? 0;
    const e21 = ema21Series[ema21Series.length - 1] ?? 0;
    const e50 = ema50Series[ema50Series.length - 1] ?? 0;
    const current = prices[len - 1];

    if (current > e9 && e9 > e21 && e21 > e50) score += 10; // Full bullish alignment
    else if (current > e21 && e9 > e21) score += 6;
    else if (current > e50) score += 3;
  }

  return Math.min(25, score);
}

/** Volume Momentum: current volume vs 20-period MA (0-15pts) */
function scoreVolume(volumes: number[]): number {
  if (volumes.length < 5) return 0;
  const current = volumes[volumes.length - 1];
  const vma = simpleMA(volumes, Math.min(20, volumes.length));
  if (vma <= 0) return 0;
  const ratio = current / vma;

  if (ratio >= 3.0) return 15;
  if (ratio >= 2.0) return 12;
  if (ratio >= 1.5) return 9;
  if (ratio >= 1.2) return 6;
  if (ratio >= 1.0) return 3;
  return 0;
}

// ── Score to Label/Color Mapping ────────────────────────────────────────────────

function scoreToMeta(score: number): {
  label: MomentumScoreState["label"];
  color: MomentumScoreState["color"];
  signalGrade: MomentumScoreState["signalGrade"];
} {
  if (score >= 80) return { label: "STRONG",     color: "dark-green",  signalGrade: "ULTRA_STRONG" };
  if (score >= 70) return { label: "STRONG",     color: "green",       signalGrade: "STRONG" };
  if (score >= 60) return { label: "MODERATE",   color: "light-green", signalGrade: "POTENTIAL" };
  if (score >= 50) return { label: "TRANSITION", color: "yellow",      signalGrade: "WATCH" };
  return             { label: "WEAK",       color: "gray",        signalGrade: "NONE" };
}

// ── VWAP Calculation ────────────────────────────────────────────────────────────

function updateVWAP(state: DailyState, high: number, low: number, close: number, volume: number): number {
  if (volume > 0) {
    const tp = (high + low + close) / 3;
    state.vwapCumTPV += tp * volume;
    state.vwapCumVol += volume;
  }
  if (state.vwapCumVol <= 0) return close;
  return state.vwapCumTPV / state.vwapCumVol;
}

// ── Main Engine: Feed a new candle tick ────────────────────────────────────────

/**
 * Feed a new 5-minute or 15-minute enriched candle into the momentum engine.
 * Returns the updated MomentumScoreState.
 */
export function feedMomentumCandle(
  instrument: "NIFTY" | "SENSEX" | "BANKNIFTY",
  candle: EnrichedCandle | RTCandle,
  spotPrice: number,
): MomentumScoreState {
  const state = dailyState[instrument];
  const today = getISTDate();

  // ── Daily Reset at 09:15 IST ────────────────────────────────────────────────
  if (state.lastReset !== today) {
    state.lastReset    = today;
    state.priceHistory  = [];
    state.volumeHistory = [];
    state.highHistory   = [];
    state.lowHistory    = [];
    state.vwapCumTPV    = 0;
    state.vwapCumVol    = 0;
  }

  // Only compute during market hours (09:15 – 15:30 IST)
  const h = getISTHour();
  const m = getISTMinute();
  const totalMin = h * 60 + m;
  const isMarket = totalMin >= 9 * 60 + 15 && totalMin <= 15 * 60 + 30;

  // Push new candle data
  state.priceHistory.push(candle.close);
  state.highHistory.push(candle.high);
  state.lowHistory.push(candle.low);
  state.volumeHistory.push(candle.volume > 0 ? candle.volume : 1);
  if (state.priceHistory.length > 200) state.priceHistory.shift();
  if (state.highHistory.length > 200) state.highHistory.shift();
  if (state.lowHistory.length > 200) state.lowHistory.shift();
  if (state.volumeHistory.length > 200) state.volumeHistory.shift();

  // ── VWAP ────────────────────────────────────────────────────────────────────
  const vwap = updateVWAP(state, candle.high, candle.low, candle.close, candle.volume);
  const aboveVWAP = spotPrice > vwap;

  // ── RSI from enriched candle (or fallback) ──────────────────────────────────
  const rsi: number = ("rsi" in candle && candle.rsi !== null && candle.rsi !== undefined)
    ? (candle.rsi as number)
    : 50;

  // ── MACD Histogram ──────────────────────────────────────────────────────────
  const macdHist: number = ("macdHistogram" in candle && candle.macdHistogram !== null)
    ? (candle.macdHistogram as number)
    : 0;
  const prevMacdHist = 0; // simplified; production tracks prev candle

  // ── ADX ─────────────────────────────────────────────────────────────────────
  const adxResult = calculateADX(
    state.highHistory,
    state.lowHistory,
    state.priceHistory,
    ADX_PERIOD,
  );

  // ── Score Components ─────────────────────────────────────────────────────────
  const rocScore  = scoreROC(state.priceHistory);
  const rsiScore  = scoreRSI(rsi);
  const macdScore = scoreMACDHist(macdHist, prevMacdHist);
  const adxScore  = scoreADXandEMA(adxResult, state.priceHistory);
  const volScore  = scoreVolume(state.volumeHistory);

  const totalScore = Math.min(100, Math.round(rocScore + rsiScore + macdScore + adxScore + volScore));

  const { label, color, signalGrade } = scoreToMeta(totalScore);

  // ── BUY CE Signal Logic (ALL conditions must pass) ──────────────────────────
  const allConditionsMet =
    totalScore >= 60 &&
    aboveVWAP &&
    adxResult.trendStrong &&
    adxResult.bullishTrend &&
    macdHist > 0 &&
    rsi >= 50 &&
    rsi <= 70 &&
    isMarket;

  const signal: MomentumScoreState["signal"] =
    allConditionsMet   ? "BUY_CE" :
    totalScore >= 50   ? "WATCH"  : "NO_TRADE";

  // ── Entry Setup ─────────────────────────────────────────────────────────────
  const entryLtp = spotPrice;
  const stopLoss = Math.min(
    spotPrice - 30,
    vwap > 0 ? vwap * VWAP_SL_BUFFER : spotPrice * 0.985,
  );
  const target    = entryLtp * TARGET_MULT;
  const riskAmt   = entryLtp - stopLoss;
  const riskReward = riskAmt > 0 ? Math.round(((target - entryLtp) / riskAmt) * 10) / 10 : 0;

  const result: MomentumScoreState = {
    instrument,
    score: isMarket ? totalScore : 0,
    label: isMarket ? label : "NO_TRADE",
    color: isMarket ? color : "gray",
    signal: isMarket ? signal : "NO_TRADE",
    signalGrade: isMarket ? signalGrade : "NONE",
    aboveVWAP,
    vwap,
    adxResult,
    rsi,
    macdHist,
    breakdown: {
      roc:    rocScore,
      rsi:    rsiScore,
      macd:   macdScore,
      adxEma: adxScore,
      volume: volScore,
      total:  totalScore,
    },
    entryLtp,
    stopLoss,
    target,
    riskReward,
    timestamp: Date.now(),
    lastReset: state.lastReset,
  };

  latestMomentumScore[instrument] = result;
  return result;
}

/** Get the latest cached momentum score for an instrument */
export function getMomentumScore(instrument: "NIFTY" | "SENSEX" | "BANKNIFTY"): MomentumScoreState | null {
  return latestMomentumScore[instrument];
}
