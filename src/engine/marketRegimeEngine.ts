/**
 * marketRegimeEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 1: Market Regime Detection Engine
 *
 * Classifies market into one of 6 institutional regimes:
 *   TRENDING_BULL | TRENDING_BEAR | BREAKOUT | BREAKDOWN | RANGE | VOLATILE
 *
 * Pure TypeScript — no React, no side effects.
 * Output consumed by Layers 2–8 of the analysis stack.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarketRegime =
  | "TRENDING_BULL"
  | "TRENDING_BEAR"
  | "BREAKOUT"
  | "BREAKDOWN"
  | "RANGE"
  | "VOLATILE";

export interface MarketRegimeResult {
  regime: MarketRegime;
  confidence: number;    // 0–100
  reasons: string[];
  /** Sub-scores for each regime, for diagnostic display (0–100 each) */
  diagnostics: Record<MarketRegime, number>;
}

export interface RegimeEngineInput {
  /** Current spot price */
  spotPrice: number;
  /** Previous spot (for breakout/breakdown cross detection) */
  prevSpotPrice?: number;
  /** 15-minute range high */
  range15mHigh: number;
  /** 15-minute range low */
  range15mLow: number;
  /** Whether range was established or is a fallback estimate */
  range15mFallback?: boolean;

  /** Net score sum of ALL stocks in the index */
  overallScore: number;
  /** 5-minute acceleration (sum of scoreDifference across all stocks) */
  score5mNet: number;
  /** 15-minute net diff (sum of score15mDiff across all stocks) */
  score15mNet: number;

  /** Top 10 heavyweights sum */
  t10: number;
  /** Next 15 (or 12 for Sensex) stocks sum */
  t15: number;

  /** Top 25 combined score (t10 + t15) */
  top25Score: number;
  /** Top 25 acceleration (sum of scoreDifference for top 25 by weightage) */
  top25ScoreDiff: number;
  /** Previous top25ScoreDiff for trending vs acceleration change */
  prevTop25ScoreDiff?: number;

  /** Put/Call Ratio */
  pcr: number;

  /** Advance/Decline from summary */
  advances: number;
  declines: number;

  /** Support wall from OI */
  support: number;
  /** Resistance wall from OI */
  resistance: number;

  /** How many times score direction flipped recently (for VOLATILE) */
  recentFlipCount?: number;
}

// ── Regime Scoring Helper ─────────────────────────────────────────────────────

/**
 * Scores a regime out of 100 based on how many conditions pass and
 * the magnitude of each factor. Returns { score, hits, reasons }.
 */
function scoreConditions(
  conditions: { met: boolean; weight: number; reason: string }[]
): { score: number; reasons: string[] } {
  const totalWeight = conditions.reduce((a, c) => a + c.weight, 0);
  const hitWeight = conditions.filter(c => c.met).reduce((a, c) => a + c.weight, 0);
  const score = totalWeight > 0 ? Math.round((hitWeight / totalWeight) * 100) : 0;
  const reasons = conditions.filter(c => c.met).map(c => c.reason);
  return { score, reasons };
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeMarketRegime(input: RegimeEngineInput): MarketRegimeResult {
  const {
    spotPrice = 0, prevSpotPrice = spotPrice || 0,
    range15mHigh = 0, range15mLow = 0, range15mFallback = false,
    overallScore = 0, score5mNet = 0, score15mNet = 0,
    t10 = 0, t15 = 0, top25Score = 0, top25ScoreDiff = 0, prevTop25ScoreDiff = 0,
    pcr = 1, advances = 0, declines = 0,
    support = 0, resistance = 0,
    recentFlipCount = 0,
  } = input || {};

  const totalStocks = advances + declines;
  const advanceRatio = totalStocks > 0 ? advances / totalStocks : 0.5;
  const rangeWidth = range15mHigh - range15mLow;
  const spotAboveHigh = spotPrice > range15mHigh;
  const spotBelowLow  = spotPrice < range15mLow;
  const spotInsideRange = !spotAboveHigh && !spotBelowLow;

  // Breakout = previous spot was inside or below high, now above
  const crossedAboveHigh = prevSpotPrice <= range15mHigh && spotPrice > range15mHigh;
  // Breakdown = previous spot was inside or above low, now below
  const crossedBelowLow  = prevSpotPrice >= range15mLow  && spotPrice < range15mLow;

  const scoreDiffAccelerating = top25ScoreDiff > prevTop25ScoreDiff;
  const scoreDiffDecelerating = top25ScoreDiff < prevTop25ScoreDiff;

  // Distance from range boundaries (as % of range width — higher = more extreme)
  const distAboveHigh = rangeWidth > 0 ? (spotPrice - range15mHigh) / rangeWidth : 0;
  const distBelowLow  = rangeWidth > 0 ? (range15mLow - spotPrice)  / rangeWidth : 0;

  // ── TRENDING BULL score ─────────────────────────────────────────────────────
  const bull = scoreConditions([
    { met: spotAboveHigh,                  weight: 25, reason: `Spot ${spotPrice.toFixed(0)} above 15M High ${range15mHigh.toFixed(0)}` },
    { met: overallScore > 0,               weight: 15, reason: `Overall Score positive (+${overallScore.toFixed(1)})` },
    { met: score15mNet > 0,                weight: 15, reason: `15M Net score rising (+${score15mNet.toFixed(1)})` },
    { met: t15 > 0,                        weight: 10, reason: `T15 positive (+${t15.toFixed(1)})` },
    { met: t10 > 0,                        weight: 10, reason: `T10 positive (+${t10.toFixed(1)})` },
    { met: advances > declines,            weight: 15, reason: `Advance-Decline: ${advances}A vs ${declines}D` },
    { met: top25Score > 0,                 weight: 10, reason: `Top-25 score positive (+${top25Score.toFixed(1)})` },
  ]);

  // ── TRENDING BEAR score ─────────────────────────────────────────────────────
  const bear = scoreConditions([
    { met: spotBelowLow,                   weight: 25, reason: `Spot ${spotPrice.toFixed(0)} below 15M Low ${range15mLow.toFixed(0)}` },
    { met: overallScore < 0,               weight: 15, reason: `Overall Score negative (${overallScore.toFixed(1)})` },
    { met: score15mNet < 0,                weight: 15, reason: `15M Net score falling (${score15mNet.toFixed(1)})` },
    { met: t15 < 0,                        weight: 10, reason: `T15 negative (${t15.toFixed(1)})` },
    { met: t10 < 0,                        weight: 10, reason: `T10 negative (${t10.toFixed(1)})` },
    { met: declines > advances,            weight: 15, reason: `Decline-Advance: ${declines}D vs ${advances}A` },
    { met: top25Score < 0,                 weight: 10, reason: `Top-25 score negative (${top25Score.toFixed(1)})` },
  ]);

  // ── BREAKOUT score ──────────────────────────────────────────────────────────
  const breakout = scoreConditions([
    { met: crossedAboveHigh || (spotAboveHigh && distAboveHigh > 0.1 && !range15mFallback),
                                           weight: 30, reason: `Spot crossed above 15M High (${range15mHigh.toFixed(0)})` },
    { met: scoreDiffAccelerating && top25ScoreDiff > 0,
                                           weight: 20, reason: `Top-25 acceleration increasing (+${top25ScoreDiff.toFixed(1)})` },
    { met: t10 > 0,                        weight: 15, reason: `T10 positive (+${t10.toFixed(1)})` },
    { met: t15 > 0,                        weight: 15, reason: `T15 positive (+${t15.toFixed(1)})` },
    { met: pcr > 1,                        weight: 20, reason: `PCR bullish (${pcr.toFixed(3)})` },
  ]);

  // ── BREAKDOWN score ─────────────────────────────────────────────────────────
  const breakdown = scoreConditions([
    { met: crossedBelowLow || (spotBelowLow && distBelowLow > 0.1 && !range15mFallback),
                                           weight: 30, reason: `Spot crossed below 15M Low (${range15mLow.toFixed(0)})` },
    { met: scoreDiffDecelerating && top25ScoreDiff < 0,
                                           weight: 20, reason: `Top-25 acceleration decreasing (${top25ScoreDiff.toFixed(1)})` },
    { met: t10 < 0,                        weight: 15, reason: `T10 negative (${t10.toFixed(1)})` },
    { met: t15 < 0,                        weight: 15, reason: `T15 negative (${t15.toFixed(1)})` },
    { met: pcr < 1,                        weight: 20, reason: `PCR bearish (${pcr.toFixed(3)})` },
  ]);

  // ── RANGE score ─────────────────────────────────────────────────────────────
  const range = scoreConditions([
    { met: spotInsideRange,                weight: 35, reason: `Spot inside 15M range (${range15mLow.toFixed(0)}–${range15mHigh.toFixed(0)})` },
    { met: Math.abs(overallScore) < 20,    weight: 20, reason: `Overall score near neutral (${overallScore.toFixed(1)})` },
    { met: Math.abs(score5mNet) < 5,       weight: 15, reason: `5M acceleration flat (${score5mNet.toFixed(1)})` },
    { met: Math.abs(t10) < 10,             weight: 15, reason: `T10 near neutral (${t10.toFixed(1)})` },
    { met: Math.abs(advanceRatio - 0.5) < 0.15,
                                           weight: 15, reason: `Balanced A/D (${advances}A/${declines}D)` },
  ]);

  // ── VOLATILE score ──────────────────────────────────────────────────────────
  const volatile_ = scoreConditions([
    { met: recentFlipCount >= 2,           weight: 30, reason: `Score direction flipped ${recentFlipCount}× recently` },
    { met: pcr < 0.7 || pcr > 1.5,        weight: 25, reason: `PCR extreme (${pcr.toFixed(3)})` },
    { met: advanceRatio > 0.80 || advanceRatio < 0.20,
                                           weight: 25, reason: `A/D extreme (${Math.round(advanceRatio * 100)}% advancing)` },
    { met: Math.abs(score5mNet) > 15,      weight: 20, reason: `5M acceleration extreme (${score5mNet.toFixed(1)})` },
  ]);

  // ── Pick dominant regime ──────────────────────────────────────────────────
  const diagnostics: Record<MarketRegime, number> = {
    TRENDING_BULL:  bull.score,
    TRENDING_BEAR:  bear.score,
    BREAKOUT:       breakout.score,
    BREAKDOWN:      breakdown.score,
    RANGE:          range.score,
    VOLATILE:       volatile_.score,
  };

  // Priority hierarchy (higher index = lower priority as tiebreaker)
  // Breakout/Breakdown take precedence if fresh cross + high score
  const priority: MarketRegime[] = [
    "BREAKOUT", "BREAKDOWN",    // Cross events: highest priority if score ≥ 60
    "TRENDING_BULL", "TRENDING_BEAR",
    "VOLATILE",
    "RANGE",
  ];

  let bestRegime: MarketRegime = "RANGE";
  let bestScore = 0;

  for (const regime of priority) {
    const s = diagnostics[regime];
    // BREAKOUT/BREAKDOWN require at least 60% to override trend
    if ((regime === "BREAKOUT" || regime === "BREAKDOWN") && s < 60) continue;
    if (s > bestScore) { bestScore = s; bestRegime = regime; }
  }

  // Fallback: if all scores are below 40, default to RANGE
  if (bestScore < 40) { bestRegime = "RANGE"; bestScore = range.score; }

  const reasons: string[] = (() => {
    switch (bestRegime) {
      case "TRENDING_BULL": return bull.reasons;
      case "TRENDING_BEAR": return bear.reasons;
      case "BREAKOUT":      return breakout.reasons;
      case "BREAKDOWN":     return breakdown.reasons;
      case "VOLATILE":      return volatile_.reasons;
      default:              return range.reasons;
    }
  })();

  return {
    regime: bestRegime,
    confidence: bestScore,
    reasons,
    diagnostics,
  };
}

// ── Regime Metadata (for UI consumption) ─────────────────────────────────────

export interface RegimeMetadata {
  label: string;
  emoji: string;
  color: string;         // Tailwind text color
  bgColor: string;       // Tailwind bg color (muted)
  borderColor: string;   // Tailwind border color
  glowColor: string;     // CSS box-shadow rgba
  description: string;
}

export const REGIME_META: Record<MarketRegime, RegimeMetadata> = {
  TRENDING_BULL: {
    label: "TRENDING BULL",
    emoji: "🟢",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/40",
    glowColor: "rgba(16,185,129,0.18)",
    description: "Strong upward trend with broad market participation",
  },
  TRENDING_BEAR: {
    label: "TRENDING BEAR",
    emoji: "🔴",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/40",
    glowColor: "rgba(239,68,68,0.18)",
    description: "Sustained selling pressure with broad market decline",
  },
  BREAKOUT: {
    label: "BREAKOUT",
    emoji: "🔥",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/40",
    glowColor: "rgba(59,130,246,0.18)",
    description: "Spot crossed above 15M high with accelerating scores",
  },
  BREAKDOWN: {
    label: "BREAKDOWN",
    emoji: "⚡",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/40",
    glowColor: "rgba(249,115,22,0.18)",
    description: "Spot collapsed below 15M low with weakening scores",
  },
  RANGE: {
    label: "RANGE",
    emoji: "🟡",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    glowColor: "rgba(245,158,11,0.12)",
    description: "Spot consolidating inside 15M range — no clear direction",
  },
  VOLATILE: {
    label: "VOLATILE",
    emoji: "🌪",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/40",
    glowColor: "rgba(168,85,247,0.18)",
    description: "Rapid score reversals, extreme PCR or A/D imbalance",
  },
};
