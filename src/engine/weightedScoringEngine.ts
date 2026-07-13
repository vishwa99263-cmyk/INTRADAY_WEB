/**
 * weightedScoringEngine.ts
 * ═══════════════════════════════════════════════════════════════════════
 * AMEX v3.0 — Dynamic Weighted Confidence Scoring System
 *
 * Replaces the old strict AND-gate system with a weighted score.
 * Each layer contributes a score (0–1) × its weight → total confidence.
 * Trade fires when totalScore >= strategy.scoreThreshold.
 *
 * Layer Weights (default):
 *   L1  Market Regime     : 20  ← most critical
 *   L2  Market Breadth    : 8
 *   L3  Momentum          : 10
 *   L4  15M Range         : 8
 *   L5  Option Chain      : 15  ← institutional signal
 *   L6  Option Flow       : 7
 *   L7  Smart Money       : 15  ← FII/DII confirmation
 *   L8  Pattern           : 5
 *   L9  Probability       : 7
 *   L10 Entry Zone        : 8
 *   L11 Strategy Align    : 8
 *   L12 AI Decision       : 15  ← AI brain confidence
 *   L13 Session/Time      : 5
 *   L14 VIX Filter        : 5
 *   L15 Breadth Momentum  : 5
 *   TOTAL = 141 (auto-normalized to 100%)
 *
 * Per-Strategy Thresholds (examples):
 *   SCALPING (OI_WALL_SCALP)           : 58%  ← very quick, lower bar
 *   BREAKOUT (ORB_NAKED, BREAKOUT_M)   : 62%  ← needs momentum confirm
 *   INTRADAY DIRECTIONAL               : 65%  ← standard
 *   REVERSAL (R01–R12)                 : 68%  ← needs counter-trend confirm
 *   SWING / WEEKLY                     : 72%  ← requires more confluence
 *   POSITIONAL / MONTHLY               : 80%  ← strictest
 */

import type { DispatcherInput } from "./strategyDispatcher";
import type { StrategyDefinition } from "./strategyRegistry";

// ── Layer Weight Config ────────────────────────────────────────────────

export interface LayerWeights {
  L1_REGIME:        number;   // Market Regime (TRENDING_BULL etc.)
  L2_BREADTH:       number;   // Market Breadth (A/D ratio, stocks above EMA)
  L3_MOMENTUM:      number;   // Momentum Engine score
  L4_RANGE:         number;   // 15M range / session range
  L5_OPTION_CHAIN:  number;   // PCR, max pain, OI walls
  L6_OPTION_FLOW:   number;   // CE/PE flow ratio, IV skew
  L7_SMART_MONEY:   number;   // FII/DII, smart money score
  L8_PATTERN:       number;   // Candlestick / price action pattern
  L9_PROBABILITY:   number;   // Historical probability engine
  L10_ENTRY_ZONE:   number;   // Entry zone quality
  L11_ALIGNMENT:    number;   // Multi-layer alignment score
  L12_AI_DECISION:  number;   // AI brain confidence
  L13_SESSION:      number;   // Session time fitness
  L14_VIX:          number;   // VIX filter
  L15_BREADTH_MOM:  number;   // Breadth momentum (rate of change)
}

export const DEFAULT_LAYER_WEIGHTS: LayerWeights = {
  L1_REGIME:        20,
  L2_BREADTH:       8,
  L3_MOMENTUM:      10,
  L4_RANGE:         8,
  L5_OPTION_CHAIN:  15,
  L6_OPTION_FLOW:   7,
  L7_SMART_MONEY:   15,
  L8_PATTERN:       5,
  L9_PROBABILITY:   7,
  L10_ENTRY_ZONE:   8,
  L11_ALIGNMENT:    8,
  L12_AI_DECISION:  15,
  L13_SESSION:      5,
  L14_VIX:          5,
  L15_BREADTH_MOM:  5,
};

// ── Per-Strategy Score Thresholds ─────────────────────────────────────

export type StrategyCategory =
  | "SCALPING"       // Fast trades, < 15 min hold
  | "ORB"            // Opening range breakout
  | "BREAKOUT"       // Momentum breakout
  | "INTRADAY"       // Standard intraday directional
  | "REVERSAL"       // Counter-trend reversal
  | "SPREAD"         // Defined risk spreads
  | "SWING"          // Weekly options swing
  | "POSITIONAL";    // Multi-day positional

export const STRATEGY_THRESHOLDS: Record<StrategyCategory, number> = {
  SCALPING:    30,   // Fast scalps, moderate confirmation needed
  ORB:         32,   // ORB breakout, needs basic momentum confirm
  BREAKOUT:    35,   // Momentum breakout, moderate bar
  INTRADAY:    38,   // Standard intraday, balanced confirmation
  REVERSAL:    38,   // Counter-trend, balanced confirmation
  SPREAD:      35,   // Hedged so slightly lower bar
  SWING:       42,   // Weekly swing, needs more alignment
  POSITIONAL:  45,   // Multi-day, stricter but achievable
};

// ── Layer Score Breakdown (for UI display) ────────────────────────────

export interface LayerScoreItem {
  layerId:      string;         // e.g. "L1_REGIME"
  layerName:    string;         // Display name
  rawScore:     number;         // 0–1 score from this layer
  weight:       number;         // Weight assigned
  contribution: number;         // Normalized contribution to total (0–100)
  status:       "STRONG" | "OK" | "WEAK" | "FAIL";
  reason:       string;         // Human-readable reason
}

export interface WeightedScoreResult {
  totalScore:       number;           // 0–100 final confidence score
  threshold:        number;           // Strategy's required threshold
  shouldFire:       boolean;          // totalScore >= threshold
  direction:        "CE" | "PE" | "NEUTRAL";
  breakdown:        LayerScoreItem[]; // Per-layer details
  marketEnv:        MarketEnvironment;// Detected market environment
  missingScore:     number;           // How many points away from threshold
  topContributors:  string[];         // Top 3 layers by contribution
  weakLayers:       string[];         // Layers scoring < 30%
}

export type MarketEnvironment =
  | "TRENDING_BULLISH"
  | "TRENDING_BEARISH"
  | "SIDEWAYS_RANGE"
  | "HIGH_VOLATILITY"
  | "BREAKOUT_BULLISH"
  | "BREAKOUT_BEARISH"
  | "PRE_EXPIRY"
  | "UNKNOWN";

// ── Helper: Normalize weights to 100 ─────────────────────────────────

export function normalizeWeights(weights: LayerWeights): LayerWeights {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total === 0) return DEFAULT_LAYER_WEIGHTS;
  const factor = 100 / total;
  return Object.fromEntries(
    Object.entries(weights).map(([k, v]) => [k, v * factor])
  ) as unknown as LayerWeights;
}

// ── Detect Market Environment ──────────────────────────────────────────

export function detectMarketEnvironment(input: DispatcherInput): MarketEnvironment {
  const regime  = input.regime ?? "RANGE";
  const vix     = input.indiaVix ?? 15;
  const session = input.sessionType ?? "MID";

  if (vix > 20) return "HIGH_VOLATILITY";
  if (input.isExpiryDay && session === "CLOSING") return "PRE_EXPIRY";
  if (regime === "BREAKOUT")     return "BREAKOUT_BULLISH";
  if (regime === "BREAKDOWN")    return "BREAKOUT_BEARISH";
  if (regime === "TRENDING_BULL") return "TRENDING_BULLISH";
  if (regime === "TRENDING_BEAR") return "TRENDING_BEARISH";
  if (regime === "RANGE" || regime === "VOLATILE") return "SIDEWAYS_RANGE";
  return "UNKNOWN";
}

// ── Get Strategy Category ─────────────────────────────────────────────

export function getStrategyCategory(strategy: StrategyDefinition): StrategyCategory {
  const id = strategy.id;
  const mode = strategy.mode;
  const tags = strategy.tags ?? [];

  if (id.startsWith("R"))                              return "REVERSAL";
  if (id === "OI_WALL_SCALP")                         return "SCALPING";
  if (id.startsWith("ORB") || id === "S14_ORB_SPREAD" || id === "S17_ORB_MOMENTUM_SPREAD" || id === "S18_ORB_CALL_RATIO" || id === "S19_ORB_PUT_RATIO") return "ORB";
  if (id === "BREAKOUT_MOMENTUM" || id === "INSTITUTIONAL_BREAKDOWN") return "BREAKOUT";
  if (id.includes("SPREAD") || id.startsWith("S1") || id.startsWith("S2")) return "SPREAD";
  if (mode === "POSITIONAL" && (id.includes("MONTHLY") || id === "FII_POSITIONAL")) return "POSITIONAL";
  if (mode === "POSITIONAL")                          return "SWING";
  if (tags.includes("scalp") || tags.includes("fast")) return "SCALPING";
  return "INTRADAY";
}

// ── Get Threshold for Strategy ────────────────────────────────────────

export function getStrategyThreshold(strategy: StrategyDefinition): number {
  const category = getStrategyCategory(strategy);
  return STRATEGY_THRESHOLDS[category];
}

// ── Main Scoring Function ─────────────────────────────────────────────

export function computeWeightedScore(
  input: DispatcherInput,
  strategy: StrategyDefinition,
  weights: LayerWeights = DEFAULT_LAYER_WEIGHTS
): WeightedScoreResult {

  const nw = normalizeWeights(weights);
  const breakdown: LayerScoreItem[] = [];

  // Direction bias from AI
  const aiDir = input.aiDirection ?? "HOLD";
  let direction: "CE" | "PE" | "NEUTRAL" =
    aiDir === "BUY_CE" ? "CE" : aiDir === "BUY_PE" ? "PE" : "NEUTRAL";

  // Dynamic direction fallback if AI is waiting/neutral
  if (direction === "NEUTRAL") {
    const mom = input.momentumScore ?? 50;
    const align = input.alignmentScore ?? 50;
    if (mom > 52 || align > 52) {
      direction = "CE";
    } else if (mom < 48 || align < 48) {
      direction = "PE";
    }
  }

  // ── L1: Market Regime ─────────────────────────────────────────────
  const regime = input.regime ?? "RANGE";
  const allowedRegimes = strategy.conditions.allowedRegimes;
  const regimeAllowed  = allowedRegimes.includes("ANY" as any) || allowedRegimes.includes(regime as any);
  const regimeScore    = regimeAllowed
    ? (regime === "TRENDING_BULL" || regime === "TRENDING_BEAR" ? 1.0 : 0.75)
    : 0.0;
  breakdown.push({
    layerId: "L1_REGIME", layerName: "Market Regime",
    rawScore: regimeScore, weight: nw.L1_REGIME,
    contribution: regimeScore * nw.L1_REGIME,
    status: regimeScore >= 0.75 ? "STRONG" : regimeScore >= 0.4 ? "OK" : "FAIL",
    reason: regimeAllowed ? `Regime: ${regime} ✓` : `Regime ${regime} not in allowed list`,
  });

  // ── L2: Market Breadth ────────────────────────────────────────────
  const breadth      = input.breadthScore ?? 50;
  const minBreadth   = strategy.conditions.minBreadthScore ?? 0;
  const breadthRatio = Math.min(breadth / 100, 1);
  const breadthScore = breadth >= minBreadth ? breadthRatio : breadthRatio * 0.4;
  breakdown.push({
    layerId: "L2_BREADTH", layerName: "Market Breadth",
    rawScore: breadthScore, weight: nw.L2_BREADTH,
    contribution: breadthScore * nw.L2_BREADTH,
    status: breadthScore >= 0.7 ? "STRONG" : breadthScore >= 0.4 ? "OK" : "WEAK",
    reason: `Breadth: ${breadth}/100 (min: ${minBreadth})`,
  });

  // ── L3: Momentum ──────────────────────────────────────────────────
  const momScore  = Math.min((input.momentumScore ?? 50) / 100, 1);
  const momExh    = input.momentumExhaustion;
  const needsExh  = strategy.conditions.requireExhaustionSignal;
  const momFinal  = needsExh ? (momExh ? momScore : momScore * 0.3) : momScore;
  breakdown.push({
    layerId: "L3_MOMENTUM", layerName: "Momentum Engine",
    rawScore: momFinal, weight: nw.L3_MOMENTUM,
    contribution: momFinal * nw.L3_MOMENTUM,
    status: momFinal >= 0.7 ? "STRONG" : momFinal >= 0.4 ? "OK" : "WEAK",
    reason: `Momentum: ${Math.round(momScore * 100)}% ${needsExh && !momExh ? "(exhaustion needed)" : ""}`,
  });

  // ── L4: 15M Range / Breakout ──────────────────────────────────────
  const breakout   = input.rangeBreakout  ?? false;
  const breakdown_ = input.rangeBreakdown ?? false;
  const needsBr    = strategy.conditions.requireBreakout;
  const needsBd    = strategy.conditions.requireBreakdown;
  let rangeScore   = 0.5; // neutral
  if (needsBr)  rangeScore = breakout  ? 1.0 : 0.1;
  if (needsBd)  rangeScore = breakdown_ ? 1.0 : 0.1;
  if (!needsBr && !needsBd) rangeScore = (breakout || breakdown_) ? 0.85 : 0.5;
  breakdown.push({
    layerId: "L4_RANGE", layerName: "Range / Breakout",
    rawScore: rangeScore, weight: nw.L4_RANGE,
    contribution: rangeScore * nw.L4_RANGE,
    status: rangeScore >= 0.75 ? "STRONG" : rangeScore >= 0.4 ? "OK" : "FAIL",
    reason: breakout ? "Range Breakout ✓" : breakdown_ ? "Range Breakdown ✓" : "No breakout",
  });

  // ── L5: Option Chain ──────────────────────────────────────────────
  const pcr       = input.pcr ?? 1.0;
  // PCR < 0.7 → strong bullish, PCR > 1.3 → strong bearish
  const pcrBullish = pcr < 0.8 ? 1.0 : pcr < 1.0 ? 0.7 : pcr < 1.2 ? 0.5 : 0.2;
  const pcrBearish = pcr > 1.2 ? 1.0 : pcr > 1.0 ? 0.7 : pcr > 0.8 ? 0.5 : 0.2;
  const ocScore    = direction === "CE" ? pcrBullish : direction === "PE" ? pcrBearish : (pcrBullish + pcrBearish) / 2;
  breakdown.push({
    layerId: "L5_OPTION_CHAIN", layerName: "Option Chain (PCR)",
    rawScore: ocScore, weight: nw.L5_OPTION_CHAIN,
    contribution: ocScore * nw.L5_OPTION_CHAIN,
    status: ocScore >= 0.7 ? "STRONG" : ocScore >= 0.4 ? "OK" : "WEAK",
    reason: `PCR: ${pcr.toFixed(2)} → ${direction === "CE" ? "Bullish" : "Bearish"} bias`,
  });

  // ── L6: Option Flow ───────────────────────────────────────────────
  // Using smartMoneyScore as proxy (no direct flow in DispatcherInput)
  const flowScore = Math.min((input.smartMoneyScore ?? 50) / 100, 1) * 0.8 + 0.1;
  breakdown.push({
    layerId: "L6_OPTION_FLOW", layerName: "Option Flow",
    rawScore: flowScore, weight: nw.L6_OPTION_FLOW,
    contribution: flowScore * nw.L6_OPTION_FLOW,
    status: flowScore >= 0.7 ? "STRONG" : flowScore >= 0.4 ? "OK" : "WEAK",
    reason: `Flow proxy: ${Math.round(flowScore * 100)}%`,
  });

  // ── L7: Smart Money ───────────────────────────────────────────────
  const sm        = input.smartMoneyScore ?? 50;
  const minSm     = strategy.conditions.minSmartMoney;
  const smRatio   = Math.min(sm / 100, 1);
  const smScore   = sm >= minSm ? smRatio : smRatio * 0.65;  // Moderate penalty (was 0.3 → too harsh, 0.85 → too soft)
  breakdown.push({
    layerId: "L7_SMART_MONEY", layerName: "Smart Money (FII/DII)",
    rawScore: smScore, weight: nw.L7_SMART_MONEY,
    contribution: smScore * nw.L7_SMART_MONEY,
    status: smScore >= 0.7 ? "STRONG" : smScore >= 0.4 ? "OK" : "WEAK",
    reason: `Smart Money: ${sm}/100 (min: ${minSm})`,
  });

  // ── L8: Price Pattern ─────────────────────────────────────────────
  const patternScore = Math.min((input.patternScore ?? 50) / 100, 1);
  breakdown.push({
    layerId: "L8_PATTERN", layerName: "Price Pattern",
    rawScore: patternScore, weight: nw.L8_PATTERN,
    contribution: patternScore * nw.L8_PATTERN,
    status: patternScore >= 0.7 ? "STRONG" : patternScore >= 0.4 ? "OK" : "WEAK",
    reason: `Pattern score: ${Math.round(patternScore * 100)}%`,
  });

  // ── L9: Probability Engine ────────────────────────────────────────
  const probScore = Math.min((input.probabilityScore ?? 50) / 100, 1);
  breakdown.push({
    layerId: "L9_PROBABILITY", layerName: "Probability Engine",
    rawScore: probScore, weight: nw.L9_PROBABILITY,
    contribution: probScore * nw.L9_PROBABILITY,
    status: probScore >= 0.7 ? "STRONG" : probScore >= 0.4 ? "OK" : "WEAK",
    reason: `Historical prob: ${Math.round(probScore * 100)}%`,
  });

  // ── L10: Entry Zone ────────────────────────────────────────────────
  const entryScore = Math.min((input.entryZoneScore ?? 50) / 100, 1);
  breakdown.push({
    layerId: "L10_ENTRY_ZONE", layerName: "Entry Zone Quality",
    rawScore: entryScore, weight: nw.L10_ENTRY_ZONE,
    contribution: entryScore * nw.L10_ENTRY_ZONE,
    status: entryScore >= 0.7 ? "STRONG" : entryScore >= 0.4 ? "OK" : "WEAK",
    reason: `Entry zone: ${Math.round(entryScore * 100)}%`,
  });

  // ── L11: Strategy Alignment ────────────────────────────────────────
  const align    = input.alignmentScore ?? 50;
  const minAlign = strategy.conditions.minAlignScore;
  const alignR   = Math.min(align / 100, 1);
  const alignS   = align >= minAlign ? alignR : alignR * 0.65;  // Moderate penalty (was 0.35 → too harsh, 0.85 → too soft)
  breakdown.push({
    layerId: "L11_ALIGNMENT", layerName: "Strategy Alignment",
    rawScore: alignS, weight: nw.L11_ALIGNMENT,
    contribution: alignS * nw.L11_ALIGNMENT,
    status: alignS >= 0.7 ? "STRONG" : alignS >= 0.4 ? "OK" : "WEAK",
    reason: `Alignment: ${align}/100 (min: ${minAlign})`,
  });

  // ── L12: AI Brain Confidence ───────────────────────────────────────
  const ai     = input.aiConfidence ?? 50;
  const minAI  = strategy.conditions.minAIConfidence;
  const aiR    = Math.min(ai / 100, 1);
  // direction check: if AI direction doesn't match strategy direction expectation, penalize
  const dirOk  = direction !== "NEUTRAL";
  const aiS    = (ai >= minAI && dirOk) ? aiR : aiR * 0.60;  // Moderate penalty (was 0.25 → too harsh, 0.80 → too soft)
  breakdown.push({
    layerId: "L12_AI_DECISION", layerName: "AI Brain Decision",
    rawScore: aiS, weight: nw.L12_AI_DECISION,
    contribution: aiS * nw.L12_AI_DECISION,
    status: aiS >= 0.7 ? "STRONG" : aiS >= 0.4 ? "OK" : "FAIL",
    reason: `AI: ${ai}% conf, dir: ${aiDir}`,
  });

  // ── L13: Session Time ─────────────────────────────────────────────
  const session      = input.sessionType ?? "MID";
  const allowedSess  = strategy.conditions.sessionTime;
  const sessOk       = allowedSess.includes("ANY") || allowedSess.includes(session as any);
  const sessScore    = sessOk ? 1.0 : 0.0;
  breakdown.push({
    layerId: "L13_SESSION", layerName: "Session Time",
    rawScore: sessScore, weight: nw.L13_SESSION,
    contribution: sessScore * nw.L13_SESSION,
    status: sessOk ? "STRONG" : "FAIL",
    reason: sessOk ? `Session: ${session} ✓` : `Session ${session} not in [${allowedSess.join(",")}]`,
  });

  // ── L14: VIX Filter ───────────────────────────────────────────────
  const vix    = input.indiaVix ?? 15;
  const vixMin = strategy.conditions.vixMin;
  const vixMax = strategy.conditions.vixMax;
  const vixOk  = vix >= vixMin && vix <= vixMax;
  // Partial credit if close to range
  const vixScore = vixOk ? 1.0
    : (vix < vixMin ? Math.max(0, 1 - (vixMin - vix) / 5)
    : Math.max(0, 1 - (vix - vixMax) / 5));
  breakdown.push({
    layerId: "L14_VIX", layerName: "VIX Filter",
    rawScore: vixScore, weight: nw.L14_VIX,
    contribution: vixScore * nw.L14_VIX,
    status: vixScore >= 0.75 ? "STRONG" : vixScore >= 0.4 ? "OK" : "FAIL",
    reason: `VIX: ${vix.toFixed(1)} (range: ${vixMin}–${vixMax})`,
  });

  // ── L15: Breadth Momentum ─────────────────────────────────────────
  const breadthMom = Math.min((input.breadthScore ?? 50) / 100, 1);
  breakdown.push({
    layerId: "L15_BREADTH_MOM", layerName: "Breadth Momentum",
    rawScore: breadthMom, weight: nw.L15_BREADTH_MOM,
    contribution: breadthMom * nw.L15_BREADTH_MOM,
    status: breadthMom >= 0.7 ? "STRONG" : breadthMom >= 0.4 ? "OK" : "WEAK",
    reason: `Breadth momentum: ${Math.round(breadthMom * 100)}%`,
  });

  // ── Compute Total Score ────────────────────────────────────────────
  const totalWeightUsed = breakdown.reduce((s, l) => s + l.weight, 0);
  const rawTotal        = breakdown.reduce((s, l) => s + l.contribution, 0);
  const totalScore      = totalWeightUsed > 0 ? (rawTotal / totalWeightUsed) * 100 : 0;

  // Threshold for this strategy
  const threshold = getStrategyThreshold(strategy);
  const shouldFire = totalScore >= threshold && direction !== "NEUTRAL";

  // Top contributors
  const sorted = [...breakdown].sort((a, b) => b.contribution - a.contribution);
  const topContributors = sorted.slice(0, 3).map(l => l.layerName);
  const weakLayers      = breakdown.filter(l => l.rawScore < 0.3).map(l => l.layerName);

  return {
    totalScore:      Math.min(100, Math.round(totalScore * 10) / 10),
    threshold,
    shouldFire,
    direction,
    breakdown,
    marketEnv:       detectMarketEnvironment(input),
    missingScore:    Math.max(0, threshold - totalScore),
    topContributors,
    weakLayers,
  };
}

// ── Auto-select best strategy category for current environment ─────────

export function recommendStrategyCategory(env: MarketEnvironment, vix: number): StrategyCategory[] {
  switch (env) {
    case "TRENDING_BULLISH":
    case "TRENDING_BEARISH":
      return ["BREAKOUT", "INTRADAY", "SWING"];
    case "BREAKOUT_BULLISH":
    case "BREAKOUT_BEARISH":
      return ["ORB", "BREAKOUT", "SCALPING"];
    case "SIDEWAYS_RANGE":
      return ["REVERSAL", "SPREAD"];
    case "HIGH_VOLATILITY":
      return vix > 25 ? ["SPREAD"] : ["REVERSAL", "SPREAD", "SCALPING"];
    case "PRE_EXPIRY":
      return ["SCALPING", "ORB"];
    default:
      return ["INTRADAY", "SPREAD"];
  }
}

// ── Calculate strategy-independent overall confidence score ─────────
export function calculateGlobalScore(
  input: DispatcherInput,
  weights: LayerWeights
): number {
  const baselineStrategy: StrategyDefinition = {
    id: "BASELINE",
    name: "Baseline",
    description: "Baseline",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 0, max: 0 },
    priority: 99,
    tags: [],
    conditions: {
      sessionTime: ["ANY"],
      allowedRegimes: ["ANY" as any],
      vixMin: 0,
      vixMax: 99,
      minAIConfidence: 0,
      minSmartMoney: 0,
      minAlignScore: 0,
    },
    legs: [],
    risk: { maxLossRs: 0, targetRs: 0, slType: "FIXED", riskRewardMin: 1 },
    winRateHistorical: 50,
    isActive: true
  };
  const res = computeWeightedScore(input, baselineStrategy, weights);
  return res.totalScore;
}

