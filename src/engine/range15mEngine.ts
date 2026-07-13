/**
 * range15mEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 4: First 15M Range Engine
 *
 * Institutional Opening Range Analysis. Captures the first 15 minutes of
 * market activity (09:15–09:30) and tracks breakout/breakdown, false breakouts,
 * range quality, trend day probability, and range confidence.
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layer 1 (Regime), Layer 2 (Breadth), Layer 3 (Heavyweight) outputs.
 * Output consumed by Layers 8, 9, 10, 11, 12, 13, 14.
 */

import type { MarketRegimeResult } from "./marketRegimeEngine";
import type { MarketBreadthResult } from "./marketBreadthEngine";
import type { HeavyweightResult } from "./heavyweightEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RangeQuality = "VERY_NARROW" | "NARROW" | "NORMAL" | "WIDE";

export type SpotPosition = "ABOVE_RANGE_HIGH" | "INSIDE_RANGE" | "BELOW_RANGE_LOW";

export type BreakoutDirection = "BULLISH" | "BEARISH" | "NONE";

export interface Range15MResult {
  /** Opening range high (frozen after 09:30) */
  rangeHigh: number;
  /** Opening range low (frozen after 09:30) */
  rangeLow: number;
  /** rangeHigh - rangeLow */
  rangeWidth: number;
  /** Width as percentage of range midpoint */
  rangeWidthPct: number;
  /** Qualitative range width assessment */
  rangeQuality: RangeQuality;
  /** Whether the range is a fallback estimate (not yet established) */
  isFallback: boolean;

  /** Current spot position relative to range */
  spotPosition: SpotPosition;
  /** Distance from nearest boundary (points) */
  distanceFromBoundary: number;
  /** Distance from nearest boundary (%) */
  distanceFromBoundaryPct: number;

  /** Confirmed bullish breakout: spot > rangeHigh + breadth + heavyweight alignment */
  rangeBreakout: boolean;
  /** Confirmed bearish breakdown: spot < rangeLow + breadth + heavyweight alignment */
  rangeBreakdown: boolean;
  /** Direction of confirmed breakout/breakdown */
  breakoutDirection: BreakoutDirection;
  /** Spot crossed boundary but conditions don't confirm (breadth/heavyweight misaligned) */
  falseBreakout: boolean;

  /** Probability of a trend day (0-100) */
  trendDayProbability: number;
  /** Composite range confidence score (0-100) */
  rangeConfidence: number;

  /** Human-readable reasons */
  reasons: string[];
}

export interface Range15MEngineInput {
  /** Current spot price */
  spotPrice: number;

  /** Frozen 15M range high */
  rangeHigh: number;
  /** Frozen 15M range low */
  rangeLow: number;
  /** Whether range is a fallback (not yet frozen/established) */
  isFallback: boolean;

  /** Layer 1 output */
  regimeResult: MarketRegimeResult;
  /** Layer 2 output */
  breadthResult: MarketBreadthResult;
  /** Layer 3 output */
  heavyweightResult: HeavyweightResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeRange15M(input: Range15MEngineInput): Range15MResult {
  const {
    spotPrice = 0,
    rangeHigh = 0, rangeLow = 0, isFallback = true,
    regimeResult = { regime: "RANGE" } as any, breadthResult = { breadthScore: 50 } as any, heavyweightResult = { heavyweightScore: 50 } as any,
  } = input || {};

  // ── 1. Range Dimensions ──────────────────────────────────────────────────
  const rangeWidth = rangeHigh - rangeLow;
  const rangeMid = (rangeHigh + rangeLow) / 2;
  const rangeWidthPct = rangeMid > 0 ? (rangeWidth / rangeMid) * 100 : 0;

  // ── 2. Range Quality ─────────────────────────────────────────────────────
  const rangeQuality: RangeQuality =
    rangeWidthPct < 0.25 ? "VERY_NARROW" :
    rangeWidthPct < 0.50 ? "NARROW" :
    rangeWidthPct < 1.00 ? "NORMAL" :
    "WIDE";

  // ── 3. Spot Position ─────────────────────────────────────────────────────
  const spotAbove = spotPrice > rangeHigh;
  const spotBelow = spotPrice < rangeLow;
  const spotPosition: SpotPosition =
    spotAbove ? "ABOVE_RANGE_HIGH" :
    spotBelow ? "BELOW_RANGE_LOW" :
    "INSIDE_RANGE";

  // Distance from nearest boundary
  let distanceFromBoundary = 0;
  if (spotAbove) {
    distanceFromBoundary = spotPrice - rangeHigh;
  } else if (spotBelow) {
    distanceFromBoundary = rangeLow - spotPrice;
  } else {
    // Inside range: distance to nearest edge
    distanceFromBoundary = Math.min(rangeHigh - spotPrice, spotPrice - rangeLow);
  }
  const distanceFromBoundaryPct = rangeMid > 0 ? (distanceFromBoundary / rangeMid) * 100 : 0;

  // ── 4. Upstream layer signals ────────────────────────────────────────────
  const breadthBullish = breadthResult.breadthScore > 60;
  const breadthBearish = breadthResult.breadthScore < 40;
  const hwBullish = heavyweightResult.heavyweightScore > 60;
  const hwBearish = heavyweightResult.heavyweightScore < 40;

  const regime = regimeResult.regime;
  const regimeBullish = regime === "TRENDING_BULL" || regime === "BREAKOUT";
  const regimeBearish = regime === "TRENDING_BEAR" || regime === "BREAKDOWN";

  // ── 5. Breakout / Breakdown Detection ────────────────────────────────────
  // Confirmed breakout: spot above range + breadth + heavyweight both aligned
  const rangeBreakout = spotAbove && breadthBullish && hwBullish;
  // Confirmed breakdown: spot below range + breadth + heavyweight both aligned
  const rangeBreakdown = spotBelow && breadthBearish && hwBearish;

  const breakoutDirection: BreakoutDirection =
    rangeBreakout ? "BULLISH" :
    rangeBreakdown ? "BEARISH" :
    "NONE";

  // ── 6. False Breakout Detection ──────────────────────────────────────────
  // Spot crossed a boundary but upstream layers DON'T confirm the direction
  const falseBreakoutUp = spotAbove && (!breadthBullish || !hwBullish);
  const falseBreakoutDown = spotBelow && (!breadthBearish || !hwBearish);
  // Also: spot inside range but regime is BREAKOUT or BREAKDOWN (already reversed)
  const reversedBreakout = spotPosition === "INSIDE_RANGE" && (regime === "BREAKOUT" || regime === "BREAKDOWN");
  const falseBreakout = falseBreakoutUp || falseBreakoutDown || reversedBreakout;

  // ── 7. Trend Day Probability (0-100) ─────────────────────────────────────
  let trendDayProbability = 0;

  // Base: confirmed breakout/breakdown
  if (rangeBreakout || rangeBreakdown) {
    trendDayProbability += 40;
  } else if (spotAbove || spotBelow) {
    // Outside range but not fully confirmed
    trendDayProbability += 20;
  }

  // Breadth alignment
  if ((rangeBreakout && breadthBullish) || (rangeBreakdown && breadthBearish)) {
    trendDayProbability += 20;
  } else if (breadthBullish || breadthBearish) {
    trendDayProbability += 10;
  }

  // Heavyweight alignment
  if ((rangeBreakout && hwBullish) || (rangeBreakdown && hwBearish)) {
    trendDayProbability += 20;
  } else if (hwBullish || hwBearish) {
    trendDayProbability += 10;
  }

  // Regime alignment bonus
  if ((rangeBreakout && regimeBullish) || (rangeBreakdown && regimeBearish)) {
    trendDayProbability += 10;
  }

  // Range quality bonus: narrow ranges → higher trend day probability on breakout
  if ((rangeBreakout || rangeBreakdown) && (rangeQuality === "VERY_NARROW" || rangeQuality === "NARROW")) {
    trendDayProbability += 10;
  }

  // Penalize false breakout
  if (falseBreakout) {
    trendDayProbability = Math.max(0, trendDayProbability - 25);
  }

  trendDayProbability = clamp(trendDayProbability);

  // ── 8. Range Confidence Score (0-100) ────────────────────────────────────
  // 40% breakout status, 30% breadth alignment, 30% heavyweight alignment
  let breakoutPts = 0;
  if (rangeBreakout || rangeBreakdown) {
    breakoutPts = 100;
  } else if (spotAbove || spotBelow) {
    breakoutPts = 60;  // Outside but unconfirmed
  } else {
    breakoutPts = 20;  // Inside range
  }
  if (falseBreakout) breakoutPts = Math.max(10, breakoutPts - 30);

  let breadthPts = 0;
  if ((breakoutDirection === "BULLISH" && breadthBullish) || (breakoutDirection === "BEARISH" && breadthBearish)) {
    breadthPts = 100;
  } else if (breadthResult.breadthScore >= 45 && breadthResult.breadthScore <= 55) {
    breadthPts = 50; // Neutral
  } else {
    breadthPts = 30;
  }

  let hwPts = 0;
  if ((breakoutDirection === "BULLISH" && hwBullish) || (breakoutDirection === "BEARISH" && hwBearish)) {
    hwPts = 100;
  } else if (heavyweightResult.heavyweightScore >= 45 && heavyweightResult.heavyweightScore <= 55) {
    hwPts = 50;
  } else {
    hwPts = 30;
  }

  const rangeConfidence = clamp(Math.round(
    breakoutPts * 0.40 +
    breadthPts * 0.30 +
    hwPts * 0.30
  ));

  // ── 9. Reasons ───────────────────────────────────────────────────────────
  const reasons: string[] = [];

  if (isFallback) {
    reasons.push("⚠ Range not yet established (using fallback estimate)");
  } else {
    reasons.push(`15M Range: ${rangeLow.toFixed(0)} – ${rangeHigh.toFixed(0)} (${rangeWidth.toFixed(0)} pts, ${rangeWidthPct.toFixed(2)}%)`);
  }

  reasons.push(`Range Quality: ${rangeQuality} | Spot: ${spotPosition.replace(/_/g, " ")}`);

  if (rangeBreakout) {
    reasons.push(`✅ CONFIRMED BULLISH BREAKOUT — Spot ${spotPrice.toFixed(0)} above ${rangeHigh.toFixed(0)}, breadth & heavyweight aligned`);
  } else if (rangeBreakdown) {
    reasons.push(`✅ CONFIRMED BEARISH BREAKDOWN — Spot ${spotPrice.toFixed(0)} below ${rangeLow.toFixed(0)}, breadth & heavyweight aligned`);
  } else if (falseBreakoutUp) {
    reasons.push(`⚠ FALSE BREAKOUT UP — Spot above range but breadth/heavyweight not confirming`);
  } else if (falseBreakoutDown) {
    reasons.push(`⚠ FALSE BREAKDOWN — Spot below range but breadth/heavyweight not confirming`);
  } else if (reversedBreakout) {
    reasons.push(`⚠ REVERSED BREAKOUT — Spot back inside range after regime breakout/breakdown`);
  } else if (spotPosition === "INSIDE_RANGE") {
    reasons.push(`Spot consolidating inside opening range — no breakout`);
  }

  if (trendDayProbability >= 70) {
    reasons.push(`🔥 HIGH TREND DAY PROBABILITY: ${trendDayProbability}%`);
  } else if (trendDayProbability >= 40) {
    reasons.push(`Trend day probability: ${trendDayProbability}%`);
  }

  return {
    rangeHigh,
    rangeLow,
    rangeWidth,
    rangeWidthPct,
    rangeQuality,
    isFallback,
    spotPosition,
    distanceFromBoundary,
    distanceFromBoundaryPct,
    rangeBreakout,
    rangeBreakdown,
    breakoutDirection,
    falseBreakout,
    trendDayProbability,
    rangeConfidence,
    reasons,
  };
}

// ── Metadata (for UI) ─────────────────────────────────────────────────────────

export interface RangePositionMeta {
  label: string;
  emoji: string;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
}

export const POSITION_META: Record<SpotPosition, RangePositionMeta> = {
  ABOVE_RANGE_HIGH: {
    label: "ABOVE RANGE",
    emoji: "🟢",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    glowColor: "rgba(16,185,129,0.15)",
  },
  INSIDE_RANGE: {
    label: "INSIDE RANGE",
    emoji: "🟡",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/25",
    glowColor: "rgba(245,158,11,0.10)",
  },
  BELOW_RANGE_LOW: {
    label: "BELOW RANGE",
    emoji: "🔴",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    glowColor: "rgba(239,68,68,0.15)",
  },
};

export const QUALITY_META: Record<RangeQuality, { label: string; color: string }> = {
  VERY_NARROW: { label: "VERY NARROW", color: "text-blue-400" },
  NARROW:      { label: "NARROW",      color: "text-cyan-400" },
  NORMAL:      { label: "NORMAL",      color: "text-slate-300" },
  WIDE:        { label: "WIDE",        color: "text-amber-400" },
};
