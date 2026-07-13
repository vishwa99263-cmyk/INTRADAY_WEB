/**
 * heavyweightEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 3: Heavyweight Engine
 *
 * Measures how much the major index-moving stocks (heavyweight stocks) are
 * driving NIFTY / SENSEX. Identifies bullish/bearish pressure from top-weighted
 * stocks, concentration risk, and special impact from HDFCBANK, ICICIBANK, RELIANCE.
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layer 1 (Market Regime) + Layer 2 (Market Breadth) outputs.
 * Output consumed by Layers 8, 9, 10, 11, 12.
 */

import type { MarketRegimeResult } from "./marketRegimeEngine";
import type { MarketBreadthResult } from "./marketBreadthEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type HeavyweightDirection =
  | "STRONG_BULLISH"
  | "BULLISH"
  | "NEUTRAL"
  | "BEARISH"
  | "STRONG_BEARISH";

export type HeavyweightPressure =
  | "BULLISH_PRESSURE"
  | "BEARISH_PRESSURE"
  | "NEUTRAL_PRESSURE";

export interface HeavyweightStockImpact {
  symbol: string;
  weightage: number;
  changePercent: number;
  score: number;
  impact: number;            // weightage × score
  momentum: number;          // weightage × scoreDifference
  momentum15m: number;       // weightage × score15mDiff
  momentum30m: number;       // weightage × score30mDiff
  momentum1h: number;        // weightage × score1hDiff
}

export interface HeavyweightResult {
  /** Normalized 0-100 heavyweight impact score based on top-10 weightage stocks */
  heavyweightScore: number;

  /** Multi-timeframe directional assessment */
  heavyweightDirection: HeavyweightDirection;

  /** Pressure zone based on heavyweightScore threshold */
  heavyweightPressure: HeavyweightPressure;

  /** How concentrated the move is in the top 3 stocks (0-100) */
  concentrationScore: number;

  /** Combined special impact of HDFCBANK + ICICIBANK + RELIANCE */
  specialHeavyweightImpact: number;

  /** Special trio assessment */
  specialTrioStatus: "BANKING_INDEX_SUPPORT" | "INDEX_DRAG" | "MIXED";

  /** Per-stock impact breakdown for top heavyweights */
  topHeavyweightImpact: HeavyweightStockImpact[];

  /** Special trio details (HDFCBANK, ICICIBANK, RELIANCE) */
  specialTrioDetails: HeavyweightStockImpact[];

  /** Human-readable assessment reasons */
  reasons: string[];
}

export interface HeavyweightEngineInput {
  /** All stocks (excluding index row), sorted by weightage desc is preferred */
  stocks: {
    symbol: string;
    weightage: number;
    score: number;
    scoreDifference: number;
    score15mDiff: number;
    score30mDiff: number;
    score1hDiff: number;
    changePercent: number;
    ltp: number;
    volume: number;
  }[];

  /** Layer 1 output */
  regimeResult: MarketRegimeResult;

  /** Layer 2 output */
  breadthResult: MarketBreadthResult;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIMARY_SYMBOLS = ["HDFCBANK", "ICICIBANK", "RELIANCE"];
const SECONDARY_SYMBOLS = ["INFY", "TCS", "SBIN", "LT", "BHARTIARTL", "AXISBANK", "KOTAKBANK"];
const ALL_TRACKED_SYMBOLS = [...PRIMARY_SYMBOLS, ...SECONDARY_SYMBOLS];

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Normalize a raw weighted score to 0-100.
 * Uses sigmoid-style mapping centered around 0:
 *   0 → 50, positive → toward 100, negative → toward 0
 */
function normalizeScore(raw: number, sensitivity = 0.02): number {
  // Sigmoid: 100 / (1 + e^(-k*x))
  const sigmoid = 100 / (1 + Math.exp(-sensitivity * raw));
  return clamp(Math.round(sigmoid));
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeHeavyweight(input: HeavyweightEngineInput): HeavyweightResult {
  const { stocks = [], regimeResult = {} as any, breadthResult = {} as any } = input || {};

  // Sort by weightage descending
  const sorted = [...stocks].sort((a, b) => (b.weightage || 0) - (a.weightage || 0));

  // Top 10 by weightage — the heavyweight cohort
  const top10 = sorted.slice(0, 10);

  // ── 1. Per-stock impact calculations ─────────────────────────────────────
  const computeImpact = (s: typeof stocks[0]): HeavyweightStockImpact => ({
    symbol: s.symbol,
    weightage: s.weightage,
    changePercent: s.changePercent,
    score: s.score,
    impact: s.weightage * s.score,
    momentum: s.weightage * (s.scoreDifference || 0),
    momentum15m: s.weightage * (s.score15mDiff || 0),
    momentum30m: s.weightage * (s.score30mDiff || 0),
    momentum1h: s.weightage * (s.score1hDiff || 0),
  });

  const top10Impacts = top10.map(computeImpact);

  // ── 2. Heavyweight Score (0-100) ─────────────────────────────────────────
  // Raw weighted score = Σ(weightage × score) for top 10
  const rawWeightedScore = top10Impacts.reduce((acc, s) => acc + s.impact, 0);
  const heavyweightScore = normalizeScore(rawWeightedScore, 0.015);

  // ── 3. Heavyweight Pressure ──────────────────────────────────────────────
  const heavyweightPressure: HeavyweightPressure =
    heavyweightScore > 60 ? "BULLISH_PRESSURE" :
    heavyweightScore < 40 ? "BEARISH_PRESSURE" :
    "NEUTRAL_PRESSURE";

  // ── 4. Heavyweight Direction (multi-timeframe) ───────────────────────────
  // Weight the timeframes: 5M = 40%, 15M = 25%, 30M = 20%, 1H = 15%
  const totalMomentum5m = top10Impacts.reduce((a, s) => a + s.momentum, 0);
  const totalMomentum15m = top10Impacts.reduce((a, s) => a + s.momentum15m, 0);
  const totalMomentum30m = top10Impacts.reduce((a, s) => a + s.momentum30m, 0);
  const totalMomentum1h = top10Impacts.reduce((a, s) => a + s.momentum1h, 0);

  const directionScore =
    totalMomentum5m  * 0.40 +
    totalMomentum15m * 0.25 +
    totalMomentum30m * 0.20 +
    totalMomentum1h  * 0.15;

  const heavyweightDirection: HeavyweightDirection =
    directionScore > 20  ? "STRONG_BULLISH" :
    directionScore > 5   ? "BULLISH" :
    directionScore > -5  ? "NEUTRAL" :
    directionScore > -20 ? "BEARISH" :
    "STRONG_BEARISH";

  // ── 5. Special Stock Impact (HDFCBANK, ICICIBANK, RELIANCE) ──────────────
  const specialStocks = PRIMARY_SYMBOLS
    .map(sym => stocks.find(s => s.symbol.toUpperCase() === sym))
    .filter(Boolean) as typeof stocks;

  const specialImpacts = specialStocks.map(computeImpact);
  const specialHeavyweightImpact = specialImpacts.reduce(
    (acc, s) => acc + (s.weightage * s.changePercent), 0
  );

  const allPositive = specialStocks.every(s => s.changePercent > 0);
  const allNegative = specialStocks.every(s => s.changePercent < 0);
  const specialTrioStatus: HeavyweightResult["specialTrioStatus"] =
    allPositive ? "BANKING_INDEX_SUPPORT" :
    allNegative ? "INDEX_DRAG" :
    "MIXED";

  // ── 6. Concentration Index ───────────────────────────────────────────────
  // How much of total absolute impact comes from top 3 stocks
  const allImpacts = sorted.map(computeImpact);
  const totalAbsImpact = allImpacts.reduce((a, s) => a + Math.abs(s.impact), 0) || 1;
  const top3AbsImpact = allImpacts
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3)
    .reduce((a, s) => a + Math.abs(s.impact), 0);
  const concentrationScore = clamp(Math.round((top3AbsImpact / totalAbsImpact) * 100));

  // ── 7. Reasons ───────────────────────────────────────────────────────────
  const reasons: string[] = [];

  // Score assessment
  if (heavyweightScore >= 65) {
    reasons.push(`Heavyweight score ${heavyweightScore} — strong bullish heavyweight pressure`);
  } else if (heavyweightScore >= 55) {
    reasons.push(`Heavyweight score ${heavyweightScore} — moderate bullish heavyweight lean`);
  } else if (heavyweightScore <= 35) {
    reasons.push(`Heavyweight score ${heavyweightScore} — strong bearish heavyweight pressure`);
  } else if (heavyweightScore <= 45) {
    reasons.push(`Heavyweight score ${heavyweightScore} — moderate bearish heavyweight lean`);
  } else {
    reasons.push(`Heavyweight score ${heavyweightScore} — neutral zone`);
  }

  // Direction assessment
  reasons.push(`Direction: ${heavyweightDirection} (composite momentum score: ${directionScore.toFixed(1)})`);

  // Special trio
  if (specialTrioStatus === "BANKING_INDEX_SUPPORT") {
    reasons.push(`🏦 BANKING + INDEX SUPPORT — HDFCBANK, ICICIBANK, RELIANCE all positive`);
  } else if (specialTrioStatus === "INDEX_DRAG") {
    reasons.push(`⚠ INDEX DRAG — HDFCBANK, ICICIBANK, RELIANCE all negative`);
  } else {
    const posCount = specialStocks.filter(s => s.changePercent > 0).length;
    reasons.push(`Special trio: ${posCount}/3 positive — mixed impact`);
  }

  // Concentration
  if (concentrationScore >= 60) {
    reasons.push(`⚠ High concentration (${concentrationScore}%) — top 3 stocks driving market`);
  } else if (concentrationScore >= 30) {
    reasons.push(`Moderate concentration (${concentrationScore}%) — balanced heavyweight distribution`);
  } else {
    reasons.push(`Low concentration (${concentrationScore}%) — broad heavyweight participation`);
  }

  // Divergence with breadth (cross-layer insight)
  if (heavyweightPressure === "BULLISH_PRESSURE" && breadthResult.breadthBias === "BEARISH") {
    reasons.push(`⚠ DIVERGENCE — Heavyweights bullish but breadth bearish (few stocks rally)`);
  } else if (heavyweightPressure === "BEARISH_PRESSURE" && breadthResult.breadthBias === "BULLISH") {
    reasons.push(`⚠ DIVERGENCE — Heavyweights bearish but breadth bullish (hidden strength)`);
  }

  // Sort topHeavyweightImpact by absolute impact descending
  const sortedTop10 = [...top10Impacts].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return {
    heavyweightScore,
    heavyweightDirection,
    heavyweightPressure,
    concentrationScore,
    specialHeavyweightImpact,
    specialTrioStatus,
    topHeavyweightImpact: sortedTop10,
    specialTrioDetails: specialImpacts,
    reasons,
  };
}

// ── Direction Metadata (for UI) ───────────────────────────────────────────────

export interface HeavyweightDirectionMeta {
  label: string;
  emoji: string;
  color: string;        // Tailwind text color
  bgColor: string;      // Tailwind bg class
  borderColor: string;
  glowColor: string;    // CSS rgba
}

export const DIRECTION_META: Record<HeavyweightDirection, HeavyweightDirectionMeta> = {
  STRONG_BULLISH: {
    label: "STRONG BULLISH",
    emoji: "🟢",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/15",
    borderColor: "border-emerald-500/40",
    glowColor: "rgba(16,185,129,0.20)",
  },
  BULLISH: {
    label: "BULLISH",
    emoji: "🟢",
    color: "text-emerald-300",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/25",
    glowColor: "rgba(16,185,129,0.12)",
  },
  NEUTRAL: {
    label: "NEUTRAL",
    emoji: "🟡",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/25",
    glowColor: "rgba(245,158,11,0.12)",
  },
  BEARISH: {
    label: "BEARISH",
    emoji: "🔴",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/25",
    glowColor: "rgba(239,68,68,0.12)",
  },
  STRONG_BEARISH: {
    label: "STRONG BEARISH",
    emoji: "🔴",
    color: "text-red-500",
    bgColor: "bg-red-500/15",
    borderColor: "border-red-500/40",
    glowColor: "rgba(239,68,68,0.20)",
  },
};

export const PRESSURE_META: Record<HeavyweightPressure, { label: string; color: string; emoji: string }> = {
  BULLISH_PRESSURE:  { label: "BULLISH PRESSURE",  color: "text-emerald-400", emoji: "🟩" },
  BEARISH_PRESSURE:  { label: "BEARISH PRESSURE",  color: "text-red-400",     emoji: "🟥" },
  NEUTRAL_PRESSURE:  { label: "NEUTRAL PRESSURE",  color: "text-amber-400",   emoji: "🟨" },
};
