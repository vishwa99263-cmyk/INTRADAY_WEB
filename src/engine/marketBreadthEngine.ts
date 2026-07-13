/**
 * marketBreadthEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 2: Market Breadth Engine
 *
 * Measures true stock participation behind the index move.
 * Detects divergences between index direction and breadth health.
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layer 1 (Market Regime) output.
 * Output consumed by Layers 3–9 of the analysis stack.
 */

import type { MarketRegimeResult } from "./marketRegimeEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BreadthBias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type BreadthHealth = "HEALTHY" | "MODERATE" | "WEAK" | "VERY_WEAK";

export interface StockContributor {
  symbol: string;
  score: number;
  weightage: number;
  impact: number;        // score × weightage
  changePercent: number;
}

export interface MarketBreadthResult {
  breadthScore: number;   // 0–100
  breadthBias: BreadthBias;
  breadthHealth: BreadthHealth;
  advances: number;
  declines: number;
  adr: number;            // Advance-Decline Ratio (0–1)
  positiveParticipation: number;  // % of stocks positive
  top25Participation: number;     // % of top-25 stocks positive
  weightedBreadth: number;        // Weighted participation score (0–100)
  momentumParticipation: number;  // Momentum alignment score (0–100)
  divergence: string;
  divergenceType: "HEALTHY_TREND" | "HIDDEN_STRENGTH" | "FEW_STOCKS_RALLY" | "HEALTHY_BEAR" | "NONE";
  topContributors: StockContributor[];
  bottomContributors: StockContributor[];
  /** Sub-scores for diagnostic display */
  components: {
    adrScore: number;
    participationScore: number;
    top25Score: number;
    weightedScore: number;
    momentumScore: number;
  };
}

export interface BreadthEngineInput {
  advances: number;
  declines: number;
  totalStocks: number;

  /** All stocks (excluding index row) with score, weightage, changePercent, scoreDifference */
  stocks: {
    symbol: string;
    score: number;
    weightage: number;
    changePercent: number;
    scoreDifference: number;
  }[];

  /** Top 25/22 stocks by weightage */
  top25Stocks: {
    symbol: string;
    score: number;
    weightage: number;
    changePercent: number;
    scoreDifference: number;
  }[];

  /** Overall score sum */
  overallScore: number;

  /** Top 10 sum */
  t10: number;
  /** Next 15/12 sum */
  t15: number;

  /** Top 25 score difference (acceleration) */
  top25ScoreDiff: number;

  /** Current spot price */
  spotPrice: number;

  /** Layer 1 output */
  regimeResult: MarketRegimeResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeMarketBreadth(input: BreadthEngineInput): MarketBreadthResult {
  const {
    advances = 0, declines = 0, totalStocks = 1,
    stocks = [], top25Stocks = [],
    overallScore = 0, t10 = 0, t15 = 0, top25ScoreDiff = 0,
    spotPrice = 0, regimeResult = { regime: "RANGE", confidence: 50, reasons: [], diagnostics: {} } as any,
  } = input || {};

  const total = advances + declines || 1;

  // ── 1. ADR (Advance-Decline Ratio) ─────────────────────────────────────────
  const adr = advances / total;
  // Map to 0-100: 0.5 = 50, 1.0 = 100, 0.0 = 0
  const adrScore = clamp(adr * 100);

  // ── 2. Positive Participation % ────────────────────────────────────────────
  const positiveCount = stocks.filter(s => s.score > 0).length;
  const negativeCount = stocks.filter(s => s.score < 0).length;
  const stockTotal = stocks.length || 1;
  const positiveParticipation = (positiveCount / stockTotal) * 100;
  const participationScore = clamp(positiveParticipation);

  // ── 3. Top-25 Participation ────────────────────────────────────────────────
  const top25Positive = top25Stocks.filter(s => s.score > 0).length;
  const top25Count = top25Stocks.length || 1;
  const top25Participation = (top25Positive / top25Count) * 100;
  const top25Score = clamp(top25Participation);

  // ── 4. Weighted Participation ──────────────────────────────────────────────
  // Score each stock: weightage × sign(score) — sum positive vs sum total
  const totalWeightage = stocks.reduce((a, s) => a + (s.weightage || 0), 0) || 1;
  const positiveWeightage = stocks
    .filter(s => s.score > 0)
    .reduce((a, s) => a + (s.weightage || 0), 0);
  const weightedBreadthRaw = (positiveWeightage / totalWeightage) * 100;
  const weightedScore = clamp(weightedBreadthRaw);

  // ── 5. Momentum Participation ──────────────────────────────────────────────
  // Check T10, T15, and top25ScoreDiff alignment
  let momentumPts = 0;
  const t10Positive = t10 > 0;
  const t15Positive = t15 > 0;
  const diffPositive = top25ScoreDiff > 0;
  const t10Negative = t10 < 0;
  const t15Negative = t15 < 0;
  const diffNegative = top25ScoreDiff < 0;

  // Bullish alignment
  if (t10Positive) momentumPts += 30;
  if (t15Positive) momentumPts += 30;
  if (diffPositive) momentumPts += 40;

  // Bearish alignment (inverse scoring — strong bearish alignment also gets high momentum score
  // because it shows directional conviction, but we'll keep it as a raw 0-100 where 50 is neutral)
  // Instead: treat as bullish participation for the breadth score (bullish = high, bearish = low)
  const momentumScore = clamp(momentumPts);

  // ── FINAL BREADTH SCORE ────────────────────────────────────────────────────
  // ADR = 30%, Positive Participation = 20%, Top25 = 20%, Weighted = 20%, Momentum = 10%
  const breadthScore = clamp(Math.round(
    adrScore * 0.30 +
    participationScore * 0.20 +
    top25Score * 0.20 +
    weightedScore * 0.20 +
    momentumScore * 0.10
  ));

  // ── BIAS ───────────────────────────────────────────────────────────────────
  const breadthBias: BreadthBias =
    breadthScore > 60 ? "BULLISH" :
    breadthScore < 40 ? "BEARISH" :
    "NEUTRAL";

  // ── HEALTH ─────────────────────────────────────────────────────────────────
  const breadthHealth: BreadthHealth =
    breadthScore >= 80 ? "HEALTHY" :
    breadthScore >= 60 ? "MODERATE" :
    breadthScore >= 40 ? "WEAK" :
    "VERY_WEAK";

  // ── DIVERGENCE DETECTOR ────────────────────────────────────────────────────
  const regime = regimeResult.regime;
  const indexBullish = regime === "TRENDING_BULL" || regime === "BREAKOUT";
  const indexBearish = regime === "TRENDING_BEAR" || regime === "BREAKDOWN";
  const breadthStrong = breadthScore >= 60;
  const breadthWeak = breadthScore < 40;

  let divergence = "";
  let divergenceType: MarketBreadthResult["divergenceType"] = "NONE";

  if (indexBullish && breadthWeak) {
    divergence = "⚠ INDEX RISING ON FEW STOCKS — Breadth divergence detected";
    divergenceType = "FEW_STOCKS_RALLY";
  } else if (indexBearish && breadthStrong) {
    divergence = "⚠ HIDDEN STRENGTH — Index falling but breadth improving";
    divergenceType = "HIDDEN_STRENGTH";
  } else if (indexBullish && breadthStrong) {
    divergence = "✅ HEALTHY TREND — Broad market participation confirmed";
    divergenceType = "HEALTHY_TREND";
  } else if (indexBearish && breadthWeak) {
    divergence = "✅ HEALTHY BEAR TREND — Broad market selling confirmed";
    divergenceType = "HEALTHY_BEAR";
  }

  // ── CONTRIBUTORS ───────────────────────────────────────────────────────────
  const scored = stocks.map(s => ({
    symbol: s.symbol,
    score: s.score,
    weightage: s.weightage,
    impact: s.score * s.weightage,
    changePercent: s.changePercent,
  }));

  const topContributors = [...scored]
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);

  const bottomContributors = [...scored]
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 5);

  return {
    breadthScore,
    breadthBias,
    breadthHealth,
    advances,
    declines,
    adr,
    positiveParticipation,
    top25Participation,
    weightedBreadth: weightedBreadthRaw,
    momentumParticipation: momentumScore,
    divergence,
    divergenceType,
    topContributors,
    bottomContributors,
    components: {
      adrScore,
      participationScore,
      top25Score,
      weightedScore,
      momentumScore,
    },
  };
}

// ── Breadth Metadata (for UI) ─────────────────────────────────────────────────

export interface BreadthLevelMeta {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
}

export function getBreadthMeta(score: number): BreadthLevelMeta {
  if (score >= 80) return {
    label: "STRONG BULLISH BREADTH",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    glowColor: "rgba(16,185,129,0.15)",
  };
  if (score >= 60) return {
    label: "BULLISH BREADTH",
    color: "text-emerald-300",
    bgColor: "bg-emerald-500/8",
    borderColor: "border-emerald-500/20",
    glowColor: "rgba(16,185,129,0.10)",
  };
  if (score >= 40) return {
    label: "NEUTRAL",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/25",
    glowColor: "rgba(245,158,11,0.10)",
  };
  if (score >= 20) return {
    label: "BEARISH BREADTH",
    color: "text-red-400",
    bgColor: "bg-red-500/8",
    borderColor: "border-red-500/20",
    glowColor: "rgba(239,68,68,0.10)",
  };
  return {
    label: "STRONG BEARISH BREADTH",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    glowColor: "rgba(239,68,68,0.15)",
  };
}
