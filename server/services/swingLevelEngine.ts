/**
 * swingLevelEngine.ts — Layer 13: Swing Support & Resistance Level Engine
 *
 * Identifies key price levels from Daily candles for position trading context.
 *
 * Levels identified:
 *   1. Weekly Pivot Points (R2, R1, Pivot, S1, S2) — from prev week OHLC
 *   2. Daily Swing Highs/Lows (fractal-based, 5-bar window)
 *   3. Previous Week High / Low (structural levels)
 *   4. Previous Month High / Low (major structural levels)
 *
 * Usage:
 *   - Call computeSwingLevels() daily (or after each 1D candle close)
 *   - Use nearestResistance / nearestSupport for entry proximity check
 *   - Feed into antigravityEngine: if spot is near resistance → penalize CE buy
 */

import type { EnrichedCandle } from "./indicatorEngine.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type LevelType    = "RESISTANCE" | "SUPPORT";
export type LevelSource  =
  | "WEEKLY_PIVOT"
  | "WEEKLY_R1" | "WEEKLY_R2"
  | "WEEKLY_S1" | "WEEKLY_S2"
  | "SWING_HIGH" | "SWING_LOW"
  | "PREV_WEEK_HIGH" | "PREV_WEEK_LOW"
  | "MONTHLY_HIGH" | "MONTHLY_LOW";

export type LevelStrength = "STRONG" | "MODERATE" | "WEAK";

export interface SwingLevel {
  price:       number;
  type:        LevelType;
  strength:    LevelStrength;
  source:      LevelSource;
  touchCount:  number;    // How many times price has touched this level
  distancePct: number;    // % away from current spot
  distancePts: number;    // Absolute points away from current spot
}

export interface SwingLevelsResult {
  instrument:         "NIFTY" | "BANKNIFTY" | "SENSEX";
  spot:               number;
  levels:             SwingLevel[];         // All levels sorted by distance
  nearestResistance:  SwingLevel | null;    // Closest resistance above spot
  nearestSupport:     SwingLevel | null;    // Closest support below spot
  proximityWarning:   boolean;             // true = spot is within 0.5% of a key level
  proximityDetail:    string;
  weeklyPivot:        number;
  weeklyR1:           number;
  weeklyR2:           number;
  weeklyS1:           number;
  weeklyS2:           number;
  prevWeekHigh:       number;
  prevWeekLow:        number;
  prevMonthHigh:      number;
  prevMonthLow:       number;
  lastUpdated:        number;
}

// ── In-memory cache ────────────────────────────────────────────────────────────

const levelsCache: Record<string, SwingLevelsResult> = {};

// ── Weekly Pivot Calculator ────────────────────────────────────────────────────

/**
 * Computes weekly pivot points from the previous week's OHLC.
 * Uses standard pivot point formula.
 */
function calcWeeklyPivots(prevWeekHigh: number, prevWeekLow: number, prevWeekClose: number) {
  const pivot = (prevWeekHigh + prevWeekLow + prevWeekClose) / 3;
  const r1    = 2 * pivot - prevWeekLow;
  const r2    = pivot + (prevWeekHigh - prevWeekLow);
  const s1    = 2 * pivot - prevWeekHigh;
  const s2    = pivot - (prevWeekHigh - prevWeekLow);

  return {
    pivot: parseFloat(pivot.toFixed(2)),
    r1:    parseFloat(r1.toFixed(2)),
    r2:    parseFloat(r2.toFixed(2)),
    s1:    parseFloat(s1.toFixed(2)),
    s2:    parseFloat(s2.toFixed(2)),
  };
}

// ── Swing High/Low Detection ───────────────────────────────────────────────────

interface FractalLevel {
  price:  number;
  type:   LevelType;
  index:  number;
}

/**
 * Detects fractal swing highs and lows using a configurable window.
 * A swing high = candle whose high is higher than `window` candles on both sides.
 */
function detectFractals(candles: EnrichedCandle[], window = 5): FractalLevel[] {
  const fractals: FractalLevel[] = [];

  for (let i = window; i < candles.length - window; i++) {
    const high = candles[i].high;
    const low  = candles[i].low;

    // Check swing high
    const leftHighs  = candles.slice(i - window, i).map(c => c.high);
    const rightHighs = candles.slice(i + 1, i + window + 1).map(c => c.high);
    if (leftHighs.every(h => high >= h) && rightHighs.every(h => high >= h)) {
      fractals.push({ price: high, type: "RESISTANCE", index: i });
    }

    // Check swing low
    const leftLows  = candles.slice(i - window, i).map(c => c.low);
    const rightLows = candles.slice(i + 1, i + window + 1).map(c => c.low);
    if (leftLows.every(l => low <= l) && rightLows.every(l => low <= l)) {
      fractals.push({ price: low, type: "SUPPORT", index: i });
    }
  }

  return fractals;
}

/**
 * Clusters nearby price levels within a tolerance band.
 * E.g., 24500 and 24510 → merge to 24505. Increases touch count.
 */
function clusterLevels(
  fractals: FractalLevel[],
  tolerancePct = 0.003,  // 0.3% tolerance
): Array<{ price: number; type: LevelType; touchCount: number }> {
  const clustered: Array<{ price: number; type: LevelType; touchCount: number }> = [];

  for (const f of fractals) {
    let merged = false;
    for (const c of clustered) {
      if (c.type === f.type && Math.abs(c.price - f.price) / c.price <= tolerancePct) {
        // Merge: take average price, increment touch count
        c.price = (c.price + f.price) / 2;
        c.touchCount++;
        merged = true;
        break;
      }
    }
    if (!merged) clustered.push({ price: f.price, type: f.type, touchCount: 1 });
  }

  return clustered;
}

// ── Core Computation ───────────────────────────────────────────────────────────

/**
 * Computes all swing S/R levels from historical daily candles.
 *
 * @param instrument  NIFTY | BANKNIFTY | SENSEX
 * @param dailyCandles  Enriched 1D candles (oldest first), minimum 30 needed
 */
export function computeSwingLevels(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  dailyCandles: EnrichedCandle[],
): SwingLevelsResult {
  const now   = Date.now();
  const spot  = dailyCandles.length > 0 ? dailyCandles[dailyCandles.length - 1].close : 0;

  const empty: SwingLevelsResult = {
    instrument, spot,
    levels: [], nearestResistance: null, nearestSupport: null,
    proximityWarning: false, proximityDetail: "Insufficient data",
    weeklyPivot: 0, weeklyR1: 0, weeklyR2: 0, weeklyS1: 0, weeklyS2: 0,
    prevWeekHigh: 0, prevWeekLow: 0, prevMonthHigh: 0, prevMonthLow: 0,
    lastUpdated: now,
  };

  if (dailyCandles.length < 5 || spot <= 0) {
    levelsCache[instrument] = empty;
    return empty;
  }

  // ── 1. Previous week H/L/C ────────────────────────────────────────────────
  // Assume last 5 candles = this week; 5 before that = previous week
  const thisWeekCount  = Math.min(5, dailyCandles.length);
  const prevWeekStart  = Math.max(0, dailyCandles.length - thisWeekCount - 5);
  const prevWeekEnd    = dailyCandles.length - thisWeekCount;
  const prevWeekCandles = dailyCandles.slice(prevWeekStart, prevWeekEnd);

  const prevWeekHigh  = prevWeekCandles.length > 0 ? Math.max(...prevWeekCandles.map(c => c.high))  : spot * 1.01;
  const prevWeekLow   = prevWeekCandles.length > 0 ? Math.min(...prevWeekCandles.map(c => c.low))   : spot * 0.99;
  const prevWeekClose = prevWeekCandles.length > 0 ? prevWeekCandles[prevWeekCandles.length - 1].close : spot;

  // ── 2. Previous month H/L ─────────────────────────────────────────────────
  const prevMonthCandles = dailyCandles.slice(Math.max(0, dailyCandles.length - 30), dailyCandles.length - 5);
  const prevMonthHigh = prevMonthCandles.length > 0 ? Math.max(...prevMonthCandles.map(c => c.high)) : spot * 1.02;
  const prevMonthLow  = prevMonthCandles.length > 0 ? Math.min(...prevMonthCandles.map(c => c.low))  : spot * 0.98;

  // ── 3. Weekly Pivot Points ────────────────────────────────────────────────
  const { pivot, r1, r2, s1, s2 } = calcWeeklyPivots(prevWeekHigh, prevWeekLow, prevWeekClose);

  // ── 4. Fractal Swing Levels ───────────────────────────────────────────────
  const fractals  = detectFractals(dailyCandles, 3);  // 3-bar window for daily
  const clustered = clusterLevels(fractals, 0.004);   // 0.4% tolerance

  // ── 5. Build final levels array ───────────────────────────────────────────
  const allLevels: SwingLevel[] = [];

  const addLevel = (
    price: number,
    type: LevelType,
    source: LevelSource,
    touchCount = 1,
  ) => {
    if (price <= 0) return;
    const distancePts = parseFloat(Math.abs(price - spot).toFixed(2));
    const distancePct = parseFloat(((distancePts / spot) * 100).toFixed(3));
    const strength: LevelStrength =
      touchCount >= 3 ? "STRONG" : touchCount >= 2 ? "MODERATE" : "WEAK";
    allLevels.push({ price: parseFloat(price.toFixed(2)), type, strength, source, touchCount, distancePct, distancePts });
  };

  // Pivot levels (always added)
  addLevel(pivot, spot > pivot ? "SUPPORT" : "RESISTANCE", "WEEKLY_PIVOT", 2);
  addLevel(r1, "RESISTANCE", "WEEKLY_R1", 2);
  addLevel(r2, "RESISTANCE", "WEEKLY_R2", 1);
  addLevel(s1, "SUPPORT",    "WEEKLY_S1", 2);
  addLevel(s2, "SUPPORT",    "WEEKLY_S2", 1);
  addLevel(prevWeekHigh, "RESISTANCE", "PREV_WEEK_HIGH", 2);
  addLevel(prevWeekLow,  "SUPPORT",    "PREV_WEEK_LOW",  2);
  addLevel(prevMonthHigh, "RESISTANCE", "MONTHLY_HIGH",  3);
  addLevel(prevMonthLow,  "SUPPORT",    "MONTHLY_LOW",   3);

  // Fractal levels
  for (const c of clustered) {
    addLevel(c.price, c.type, c.type === "RESISTANCE" ? "SWING_HIGH" : "SWING_LOW", c.touchCount);
  }

  // Deduplicate levels that are within 0.2% of each other
  const deduplicated: SwingLevel[] = [];
  const used = new Set<number>();
  for (const lv of allLevels.sort((a, b) => a.price - b.price)) {
    const key = Math.round(lv.price / (spot * 0.002));
    if (!used.has(key)) {
      used.add(key);
      deduplicated.push(lv);
    }
  }

  // Sort by distance from spot
  const sorted = deduplicated.sort((a, b) => a.distancePts - b.distancePts);

  // ── 6. Nearest S/R ────────────────────────────────────────────────────────
  const nearestResistance = sorted.find(l => l.type === "RESISTANCE" && l.price > spot) ?? null;
  const nearestSupport    = sorted.find(l => l.type === "SUPPORT"    && l.price < spot) ?? null;

  // ── 7. Proximity Warning ──────────────────────────────────────────────────
  // If price is within 0.5% of a STRONG/MODERATE key level → warn
  const proximityThresholdPct = 0.5;
  const closeLevel = sorted.find(l =>
    l.distancePct <= proximityThresholdPct &&
    (l.strength === "STRONG" || l.strength === "MODERATE")
  );

  const proximityWarning = !!closeLevel;
  const proximityDetail = closeLevel
    ? `⚠️ Spot is within ${closeLevel.distancePct}% of ${closeLevel.source} @ ${closeLevel.price} (${closeLevel.type}) — ${closeLevel.strength}`
    : `✅ Spot ${spot.toFixed(0)} is clear. Nearest R=${nearestResistance?.price ?? "N/A"}, S=${nearestSupport?.price ?? "N/A"}`;

  const result: SwingLevelsResult = {
    instrument, spot,
    levels: sorted,
    nearestResistance,
    nearestSupport,
    proximityWarning,
    proximityDetail,
    weeklyPivot: pivot, weeklyR1: r1, weeklyR2: r2, weeklyS1: s1, weeklyS2: s2,
    prevWeekHigh, prevWeekLow,
    prevMonthHigh, prevMonthLow,
    lastUpdated: now,
  };

  levelsCache[instrument] = result;

  console.log(
    `[Layer13:SwingLevels] ${instrument} | Spot=${spot.toFixed(0)} | ` +
    `Pivot=${pivot.toFixed(0)} R1=${r1.toFixed(0)} S1=${s1.toFixed(0)} | ` +
    `NearR=${nearestResistance?.price.toFixed(0) ?? "N/A"} NearS=${nearestSupport?.price.toFixed(0) ?? "N/A"} | ` +
    `${proximityWarning ? "⚠️ PROXIMITY WARNING" : "✅ Clear"}`
  );

  return result;
}

/**
 * Returns the last computed swing levels from cache.
 */
export function getSwingLevels(instrument: "NIFTY" | "BANKNIFTY" | "SENSEX"): SwingLevelsResult | null {
  return levelsCache[instrument] ?? null;
}

/**
 * Returns all cached swing levels.
 */
export function getAllSwingLevels(): Record<string, SwingLevelsResult> {
  return { ...levelsCache };
}

/**
 * Quick check: is the current spot price near a resistance level?
 * Used by antigravityEngine to penalize CE buys near resistance.
 *
 * @returns 0 = no penalty | negative = penalty (up to -10)
 */
export function getProximityPenalty(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  direction: "BUY_CE" | "BUY_PE",
): number {
  const levels = levelsCache[instrument];
  if (!levels) return 0;

  if (direction === "BUY_CE" && levels.nearestResistance) {
    const distPct = levels.nearestResistance.distancePct;
    if (distPct <= 0.3 && levels.nearestResistance.strength === "STRONG")  return -10;
    if (distPct <= 0.5 && levels.nearestResistance.strength !== "WEAK")    return -5;
  }

  if (direction === "BUY_PE" && levels.nearestSupport) {
    const distPct = levels.nearestSupport.distancePct;
    if (distPct <= 0.3 && levels.nearestSupport.strength === "STRONG")  return -10;
    if (distPct <= 0.5 && levels.nearestSupport.strength !== "WEAK")    return -5;
  }

  return 0;
}
