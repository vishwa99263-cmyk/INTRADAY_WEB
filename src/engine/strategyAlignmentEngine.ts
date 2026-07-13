/**
 * strategyAlignmentEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 10: Strategy Alignment Engine v1.0
 *
 * Cross-validates ALL 9 upstream engine outputs and determines whether
 * conditions align for a trade. Each layer casts a directional vote
 * (BULLISH / BEARISH / NEUTRAL) and the engine calculates alignment depth.
 *
 * Requires minimum alignment score before generating trade readiness signals.
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layers 1–9.  Consumed by Layers 11, 12, 14.
 */

import type { MarketRegimeResult }       from "./marketRegimeEngine";
import type { MarketBreadthResult }       from "./marketBreadthEngine";
import type { HeavyweightResult }         from "./heavyweightEngine";
import type { Range15MResult }            from "./range15mEngine";
import type { OptionChainEngineOutput }   from "./optionChainEngine";
import type { MomentumEngineOutput }      from "./momentumEngine";
import type { SmartMoneySignal }          from "./smartMoneyEngine";
import type { ProbabilityEngineResult }   from "./probabilityEngine";
import type { EntryZoneResult }           from "./entryZoneEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LayerVote = "BULLISH" | "BEARISH" | "NEUTRAL";
export type TradeReadiness =
  | "FULLY_ALIGNED"
  | "MOSTLY_ALIGNED"
  | "PARTIALLY_ALIGNED"
  | "MISALIGNED"
  | "NO_TRADE";

export type AlignmentGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface LayerAlignment {
  layerId: number;
  layerName: string;
  vote: LayerVote;
  confidence: number;    // 0–100
  weight: number;        // Relative weight in final score
  contribution: number;  // Weighted contribution to alignment
  reason: string;        // Why this vote
}

export interface ConflictPair {
  layer1: string;
  layer2: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface StrategyAlignmentResult {
  /** Overall alignment score 0–100 */
  alignmentScore: number;

  /** Alignment grade A+ through F */
  alignmentGrade: AlignmentGrade;

  /** How many layers agree with dominant direction */
  alignedLayerCount: number;

  /** How many layers disagree */
  conflictingLayerCount: number;

  /** How many layers are neutral */
  neutralLayerCount: number;

  /** Total layers evaluated */
  totalLayers: number;

  /** Dominant direction across all layers */
  dominantDirection: LayerVote;

  /** Trade readiness classification */
  tradeReadiness: TradeReadiness;

  /** Per-layer alignment details */
  alignedLayers: LayerAlignment[];

  /** Conflicting layer pairs */
  conflicts: ConflictPair[];

  /** Alignment percentage (aligned / total) as 0–100 */
  alignmentPercentage: number;

  /** Whether the system considers conditions safe to trade */
  isTradable: boolean;

  /** Composite confidence combining alignment + probability + entry zone */
  compositeConfidence: number;

  /** Human-readable reasoning */
  reasoning: string[];
}

export interface StrategyAlignmentInput {
  // ── Layer 1 ─────────────────────────────────────────────────────────────
  regimeResult: MarketRegimeResult;
  // ── Layer 2 ─────────────────────────────────────────────────────────────
  breadthResult: MarketBreadthResult;
  // ── Layer 3 (optional) ───────────────────────────────────────────────────
  heavyweightResult?: HeavyweightResult;
  // ── Layer 4 (optional) ───────────────────────────────────────────────────
  range15mResult?: Range15MResult;
  // ── Layer 5 (optional) ───────────────────────────────────────────────────
  optionChainResult?: OptionChainEngineOutput;
  // ── Layer 6 (optional) ───────────────────────────────────────────────────
  momentumResult?: MomentumEngineOutput;
  // ── Layer 7 (optional) ───────────────────────────────────────────────────
  smartMoneyResult?: SmartMoneySignal;
  // ── Layer 8 ─────────────────────────────────────────────────────────────
  probabilityResult: ProbabilityEngineResult;
  // ── Layer 9 ─────────────────────────────────────────────────────────────
  entryZoneResult: EntryZoneResult;
}

// ── Layer Weights ─────────────────────────────────────────────────────────────
// Each layer contributes proportionally. Total weight = 100.

const LAYER_WEIGHTS: Record<number, number> = {
  1: 12,  // Market Regime — foundation
  2: 10,  // Market Breadth — participation
  3: 8,   // Heavyweight — index driver influence
  4: 8,   // 15M Range — opening range context
  5: 10,  // Option Chain — institutional OI intelligence
  6: 10,  // Momentum — price acceleration
  7: 15,  // Smart Money — highest weight (institutional flow)
  8: 15,  // Probability — direction quantification
  9: 12,  // Entry Zone — execution precision
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function safe(v: number | undefined | null, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

// ── Layer Vote Extractors ─────────────────────────────────────────────────────

function getRegimeVote(r: MarketRegimeResult): { vote: LayerVote; confidence: number; reason: string } {
  const regime = r.regime;
  if (regime === "TRENDING_BULL" || regime === "BREAKOUT") {
    return { vote: "BULLISH", confidence: safe(r.confidence, 60), reason: `Regime: ${regime} (${r.confidence}% conf)` };
  }
  if (regime === "TRENDING_BEAR" || regime === "BREAKDOWN") {
    return { vote: "BEARISH", confidence: safe(r.confidence, 60), reason: `Regime: ${regime} (${r.confidence}% conf)` };
  }
  return { vote: "NEUTRAL", confidence: safe(r.confidence, 40), reason: `Regime: ${regime} — no directional edge` };
}

function getBreadthVote(b: MarketBreadthResult): { vote: LayerVote; confidence: number; reason: string } {
  const bs = safe(b.breadthScore);
  if (bs >= 60) return { vote: "BULLISH", confidence: Math.min(bs, 90), reason: `Breadth ${bs} — ${b.breadthHealth} participation` };
  if (bs <= 40) return { vote: "BEARISH", confidence: Math.min(100 - bs, 90), reason: `Breadth ${bs} — weak participation` };
  return { vote: "NEUTRAL", confidence: 40, reason: `Breadth ${bs} — mixed signals` };
}

function getHeavyweightVote(h?: HeavyweightResult): { vote: LayerVote; confidence: number; reason: string } {
  if (!h) return { vote: "NEUTRAL", confidence: 30, reason: "Heavyweight data unavailable" };
  const dir = h.heavyweightDirection;
  if (dir === "STRONG_BULLISH" || dir === "BULLISH") {
    return { vote: "BULLISH", confidence: safe(h.heavyweightScore, 60), reason: `Heavyweights: ${dir} (${h.heavyweightScore})` };
  }
  if (dir === "STRONG_BEARISH" || dir === "BEARISH") {
    return { vote: "BEARISH", confidence: safe(h.heavyweightScore, 60), reason: `Heavyweights: ${dir} (${h.heavyweightScore})` };
  }
  return { vote: "NEUTRAL", confidence: 40, reason: `Heavyweights: ${dir} — neutral pressure` };
}

function getRangeVote(r?: Range15MResult): { vote: LayerVote; confidence: number; reason: string } {
  if (!r) return { vote: "NEUTRAL", confidence: 30, reason: "15M Range data unavailable" };
  if (r.rangeBreakout) {
    return { vote: "BULLISH", confidence: safe(r.rangeConfidence, 70), reason: `15M Breakout confirmed (${r.rangeConfidence}% conf)` };
  }
  if (r.rangeBreakdown) {
    return { vote: "BEARISH", confidence: safe(r.rangeConfidence, 70), reason: `15M Breakdown confirmed (${r.rangeConfidence}% conf)` };
  }
  if (r.spotPosition === "ABOVE_RANGE_HIGH") {
    return { vote: "BULLISH", confidence: 55, reason: "Spot above 15M range high" };
  }
  if (r.spotPosition === "BELOW_RANGE_LOW") {
    return { vote: "BEARISH", confidence: 55, reason: "Spot below 15M range low" };
  }
  if (r.falseBreakout) {
    return { vote: "BEARISH", confidence: 60, reason: "False breakout detected — bearish reversal" };
  }
  return { vote: "NEUTRAL", confidence: 40, reason: `Spot inside 15M range (${r.spotPosition})` };
}

function getOptionChainVote(o?: OptionChainEngineOutput): { vote: LayerVote; confidence: number; reason: string } {
  if (!o) return { vote: "NEUTRAL", confidence: 30, reason: "Option chain data unavailable" };
  const score = safe(o.optionChainScore);
  if (score >= 60) {
    return { vote: "BULLISH", confidence: Math.min(score, 85), reason: `OC Score: ${score} — CE bias | PCR: ${o.pcr.toFixed(2)}` };
  }
  if (score <= 40) {
    return { vote: "BEARISH", confidence: Math.min(100 - score, 85), reason: `OC Score: ${score} — PE bias | PCR: ${o.pcr.toFixed(2)}` };
  }
  return { vote: "NEUTRAL", confidence: 40, reason: `OC Score: ${score} — mixed OI signals` };
}

function getMomentumVote(m?: MomentumEngineOutput): { vote: LayerVote; confidence: number; reason: string } {
  if (!m) return { vote: "NEUTRAL", confidence: 30, reason: "Momentum data unavailable" };
  const dir = m.momentumDirection;
  const ms = safe(m.momentumScore);
  if (dir === "BULLISH") {
    return { vote: "BULLISH", confidence: Math.min(ms, 90), reason: `Momentum: ${dir} (${ms}) | Grade: ${m.momentumGrade}` };
  }
  if (dir === "BEARISH") {
    return { vote: "BEARISH", confidence: Math.min(100 - ms, 90), reason: `Momentum: ${dir} (${ms}) | Grade: ${m.momentumGrade}` };
  }
  return { vote: "NEUTRAL", confidence: 40, reason: `Momentum: ${dir} (${ms})` };
}

function getSmartMoneyVote(s?: SmartMoneySignal): { vote: LayerVote; confidence: number; reason: string } {
  if (!s) return { vote: "NEUTRAL", confidence: 30, reason: "Smart Money data unavailable" };
  const bias = s.institutionalBias;
  const sms = safe(s.smartMoneyScore);
  const conf = safe(s.confidence, 50);

  // Check for trap — overrides everything
  if (s.trapType && s.trapType !== "NONE") {
    return { vote: "NEUTRAL", confidence: 20, reason: `⚠ TRAP: ${s.trapType} — Smart Money override active` };
  }

  if (bias === "ACCUMULATION") {
    return { vote: "BULLISH", confidence: conf, reason: `Smart Money: ACCUMULATION (score: ${sms}, conf: ${conf}%)` };
  }
  if (bias === "DISTRIBUTION") {
    return { vote: "BEARISH", confidence: conf, reason: `Smart Money: DISTRIBUTION (score: ${sms}, conf: ${conf}%)` };
  }
  return { vote: "NEUTRAL", confidence: 40, reason: `Smart Money: ${bias} (score: ${sms})` };
}

function getProbabilityVote(p: ProbabilityEngineResult): { vote: LayerVote; confidence: number; reason: string } {
  if (p.trapOverride) {
    return { vote: "NEUTRAL", confidence: 25, reason: "Probability: TRAP OVERRIDE active" };
  }
  if (p.dominantSide === "CE") {
    return { vote: "BULLISH", confidence: p.confidenceLevel, reason: `Probability: CE ${p.ceProbability}% vs PE ${p.peProbability}% | ${p.setupQuality}` };
  }
  if (p.dominantSide === "PE") {
    return { vote: "BEARISH", confidence: p.confidenceLevel, reason: `Probability: PE ${p.peProbability}% vs CE ${p.ceProbability}% | ${p.setupQuality}` };
  }
  return { vote: "NEUTRAL", confidence: Math.min(p.confidenceLevel, 40), reason: `Probability: WAIT — no edge (CE ${p.ceProbability}% / PE ${p.peProbability}%)` };
}

function getEntryZoneVote(e: EntryZoneResult): { vote: LayerVote; confidence: number; reason: string } {
  if (e.direction === "CE") {
    return { vote: "BULLISH", confidence: e.confidence, reason: `Entry Zone: ${e.entryMode} CE | R:R ${e.riskReward.toFixed(1)} (${e.rrQuality})` };
  }
  if (e.direction === "PE") {
    return { vote: "BEARISH", confidence: e.confidence, reason: `Entry Zone: ${e.entryMode} PE | R:R ${e.riskReward.toFixed(1)} (${e.rrQuality})` };
  }
  return { vote: "NEUTRAL", confidence: 0, reason: "Entry Zone: WAIT — no valid setup" };
}

// ── Conflict Detection ────────────────────────────────────────────────────────

function detectConflicts(layers: LayerAlignment[]): ConflictPair[] {
  const conflicts: ConflictPair[] = [];

  // Critical conflicts: high-weight layers disagreeing
  const criticalLayers = layers.filter(l => [7, 8, 9].includes(l.layerId)); // Smart Money, Probability, Entry Zone
  const foundationLayers = layers.filter(l => [1, 2].includes(l.layerId));  // Regime, Breadth

  // Check Smart Money vs Probability disagreement
  const smLayer = layers.find(l => l.layerId === 7);
  const probLayer = layers.find(l => l.layerId === 8);
  const entryLayer = layers.find(l => l.layerId === 9);
  const momLayer = layers.find(l => l.layerId === 6);
  const regimeLayer = layers.find(l => l.layerId === 1);

  if (smLayer && probLayer && smLayer.vote !== "NEUTRAL" && probLayer.vote !== "NEUTRAL" && smLayer.vote !== probLayer.vote) {
    conflicts.push({
      layer1: "L7: Smart Money",
      layer2: "L8: Probability",
      description: `Smart Money says ${smLayer.vote} but Probability says ${probLayer.vote}`,
      severity: "HIGH",
    });
  }

  // Regime vs Momentum disagreement
  if (regimeLayer && momLayer && regimeLayer.vote !== "NEUTRAL" && momLayer.vote !== "NEUTRAL" && regimeLayer.vote !== momLayer.vote) {
    conflicts.push({
      layer1: "L1: Regime",
      layer2: "L6: Momentum",
      description: `Regime ${regimeLayer.vote} but Momentum ${momLayer.vote} — structural divergence`,
      severity: "MEDIUM",
    });
  }

  // Entry Zone vs Probability disagreement
  if (entryLayer && probLayer && entryLayer.vote !== "NEUTRAL" && probLayer.vote !== "NEUTRAL" && entryLayer.vote !== probLayer.vote) {
    conflicts.push({
      layer1: "L8: Probability",
      layer2: "L9: Entry Zone",
      description: `Probability ${probLayer.vote} but Entry Zone ${entryLayer.vote}`,
      severity: "HIGH",
    });
  }

  // Breadth vs Smart Money (divergence detection)
  const breadthLayer = layers.find(l => l.layerId === 2);
  if (breadthLayer && smLayer && breadthLayer.vote !== "NEUTRAL" && smLayer.vote !== "NEUTRAL" && breadthLayer.vote !== smLayer.vote) {
    conflicts.push({
      layer1: "L2: Breadth",
      layer2: "L7: Smart Money",
      description: `Breadth ${breadthLayer.vote} but Smart Money ${smLayer.vote} — possible hidden distribution`,
      severity: "MEDIUM",
    });
  }

  return conflicts;
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeStrategyAlignment(input: StrategyAlignmentInput): StrategyAlignmentResult {
  const {
    regimeResult = { regime: "RANGE" } as any, breadthResult = { breadthScore: 50 } as any, heavyweightResult, range15mResult,
    optionChainResult, momentumResult, smartMoneyResult,
    probabilityResult = { dominantSide: "WAIT", ceProbability: 50, peProbability: 50, confidenceLevel: 50 } as any, entryZoneResult = { direction: "WAIT", entryPrice: 0, stopLoss: 0, target: 0 } as any,
  } = input || {};

  const reasoning: string[] = [];

  // ── EXTRACT VOTES FROM ALL 9 LAYERS ───────────────────────────────────────

  const voteExtractors: { id: number; name: string; fn: () => { vote: LayerVote; confidence: number; reason: string } }[] = [
    { id: 1, name: "Market Regime",    fn: () => getRegimeVote(regimeResult) },
    { id: 2, name: "Market Breadth",   fn: () => getBreadthVote(breadthResult) },
    { id: 3, name: "Heavyweight",      fn: () => getHeavyweightVote(heavyweightResult) },
    { id: 4, name: "15M Range",        fn: () => getRangeVote(range15mResult) },
    { id: 5, name: "Option Chain",     fn: () => getOptionChainVote(optionChainResult) },
    { id: 6, name: "Momentum",         fn: () => getMomentumVote(momentumResult) },
    { id: 7, name: "Smart Money",      fn: () => getSmartMoneyVote(smartMoneyResult) },
    { id: 8, name: "Probability",      fn: () => getProbabilityVote(probabilityResult) },
    { id: 9, name: "Entry Zone",       fn: () => getEntryZoneVote(entryZoneResult) },
  ];

  const alignedLayers: LayerAlignment[] = voteExtractors.map(({ id, name, fn }) => {
    const { vote, confidence, reason } = fn();
    const weight = LAYER_WEIGHTS[id] || 10;
    return {
      layerId: id,
      layerName: name,
      vote,
      confidence,
      weight,
      contribution: 0, // computed below
      reason,
    };
  });

  // ── DETERMINE DOMINANT DIRECTION ──────────────────────────────────────────

  let bullishWeight = 0;
  let bearishWeight = 0;
  let neutralWeight = 0;

  for (const layer of alignedLayers) {
    const wc = layer.weight * (layer.confidence / 100); // weight × confidence
    if (layer.vote === "BULLISH")  bullishWeight += wc;
    else if (layer.vote === "BEARISH") bearishWeight += wc;
    else neutralWeight += wc;
  }

  const totalWeight = bullishWeight + bearishWeight + neutralWeight;
  let dominantDirection: LayerVote;
  if (bullishWeight > bearishWeight * 1.05) dominantDirection = "BULLISH";
  else if (bearishWeight > bullishWeight * 1.05) dominantDirection = "BEARISH";
  else dominantDirection = "NEUTRAL";

  // ── COMPUTE ALIGNMENT CONTRIBUTIONS ───────────────────────────────────────

  const alignedCount   = alignedLayers.filter(l => l.vote === dominantDirection).length;
  const conflictCount  = alignedLayers.filter(l => l.vote !== dominantDirection && l.vote !== "NEUTRAL").length;
  const neutralCount   = alignedLayers.filter(l => l.vote === "NEUTRAL").length;

  for (const layer of alignedLayers) {
    if (layer.vote === dominantDirection) {
      layer.contribution = (layer.weight * layer.confidence) / 100;
    } else if (layer.vote === "NEUTRAL") {
      layer.contribution = 0;
    } else {
      layer.contribution = -(layer.weight * layer.confidence) / 100;
    }
  }

  // ── ALIGNMENT SCORE ─────────────────────────────────────────────────────

  // Score = weighted sum of aligned layer contributions normalized to 0–100
  const maxPossibleContrib = alignedLayers.reduce((a, l) => a + l.weight, 0); // 100
  const positiveContrib = alignedLayers
    .filter(l => l.contribution > 0)
    .reduce((a, l) => a + l.contribution, 0);
  const negativeContrib = Math.abs(
    alignedLayers
      .filter(l => l.contribution < 0)
      .reduce((a, l) => a + l.contribution, 0)
  );

  // Net alignment: positive minus penalty for conflicts
  const rawAlignment = positiveContrib - negativeContrib * 1.5; // conflicts penalized 1.5×
  const alignmentScore = clamp(Math.round((rawAlignment / maxPossibleContrib) * 100));

  const alignmentPercentage = alignedLayers.length > 0
    ? Math.round((alignedCount / alignedLayers.length) * 100)
    : 0;

  // ── ALIGNMENT GRADE ─────────────────────────────────────────────────────

  let alignmentGrade: AlignmentGrade;
  if (alignmentScore >= 85) alignmentGrade = "A+";
  else if (alignmentScore >= 70) alignmentGrade = "A";
  else if (alignmentScore >= 55) alignmentGrade = "B";
  else if (alignmentScore >= 40) alignmentGrade = "C";
  else if (alignmentScore >= 25) alignmentGrade = "D";
  else alignmentGrade = "F";

  // ── DETECT CONFLICTS ────────────────────────────────────────────────────

  const conflicts = detectConflicts(alignedLayers);

  // ── TRADE READINESS ─────────────────────────────────────────────────────

  const highConflicts = conflicts.filter(c => c.severity === "HIGH").length;
  const entryValid = entryZoneResult.direction !== "WAIT";
  const probValid = probabilityResult.setupQuality !== "NO_TRADE";

  let tradeReadiness: TradeReadiness;
  if (!entryValid || !probValid || dominantDirection === "NEUTRAL") {
    tradeReadiness = "NO_TRADE";
  } else if (alignmentScore >= 75 && highConflicts === 0 && alignedCount >= 7) {
    tradeReadiness = "FULLY_ALIGNED";
  } else if (alignmentScore >= 55 && highConflicts <= 1 && alignedCount >= 5) {
    tradeReadiness = "MOSTLY_ALIGNED";
  } else if (alignmentScore >= 35 && alignedCount >= 4) {
    tradeReadiness = "PARTIALLY_ALIGNED";
  } else {
    tradeReadiness = "MISALIGNED";
  }

  // ── COMPOSITE CONFIDENCE ────────────────────────────────────────────────

  const probConf = safe(probabilityResult.confidenceLevel);
  const entryConf = safe(entryZoneResult.confidence);
  const compositeConfidence = clamp(Math.round(
    alignmentScore * 0.40 +
    probConf * 0.35 +
    entryConf * 0.25
  ));

  // ── TRADABILITY ─────────────────────────────────────────────────────────

  const isTradable =
    tradeReadiness === "FULLY_ALIGNED" ||
    tradeReadiness === "MOSTLY_ALIGNED";

  // ── REASONING ───────────────────────────────────────────────────────────

  const voteStr = `${alignedCount}/${alignedLayers.length}`;

  if (tradeReadiness === "FULLY_ALIGNED") {
    reasoning.push(`🟢 FULLY ALIGNED — ${voteStr} layers agree ${dominantDirection} (Score: ${alignmentScore}, Grade: ${alignmentGrade})`);
  } else if (tradeReadiness === "MOSTLY_ALIGNED") {
    reasoning.push(`🟡 MOSTLY ALIGNED — ${voteStr} layers agree ${dominantDirection} (Score: ${alignmentScore}, Grade: ${alignmentGrade})`);
  } else if (tradeReadiness === "PARTIALLY_ALIGNED") {
    reasoning.push(`🟠 PARTIALLY ALIGNED — ${voteStr} layers agree (Score: ${alignmentScore}, Grade: ${alignmentGrade}) — proceed with caution`);
  } else if (tradeReadiness === "MISALIGNED") {
    reasoning.push(`🔴 MISALIGNED — Only ${voteStr} layers agree (Score: ${alignmentScore}, Grade: ${alignmentGrade}) — DO NOT TRADE`);
  } else {
    reasoning.push(`⚪ NO TRADE — Entry zone or probability invalid — alignment moot`);
  }

  if (highConflicts > 0) {
    reasoning.push(`⚠ ${highConflicts} HIGH-severity conflict(s) detected between critical layers`);
  }

  // Add vote summary
  const bullishLayers = alignedLayers.filter(l => l.vote === "BULLISH").map(l => `L${l.layerId}`).join(", ");
  const bearishLayers = alignedLayers.filter(l => l.vote === "BEARISH").map(l => `L${l.layerId}`).join(", ");
  const neutralLayers = alignedLayers.filter(l => l.vote === "NEUTRAL").map(l => `L${l.layerId}`).join(", ");

  if (bullishLayers) reasoning.push(`🟢 BULLISH: ${bullishLayers}`);
  if (bearishLayers) reasoning.push(`🔴 BEARISH: ${bearishLayers}`);
  if (neutralLayers) reasoning.push(`⚪ NEUTRAL: ${neutralLayers}`);

  reasoning.push(
    `Composite Confidence: ${compositeConfidence}% | Alignment: ${alignmentPercentage}% | Tradable: ${isTradable ? "YES" : "NO"}`
  );

  return {
    alignmentScore,
    alignmentGrade,
    alignedLayerCount: alignedCount,
    conflictingLayerCount: conflictCount,
    neutralLayerCount: neutralCount,
    totalLayers: alignedLayers.length,
    dominantDirection,
    tradeReadiness,
    alignedLayers,
    conflicts,
    alignmentPercentage,
    isTradable,
    compositeConfidence,
    reasoning,
  };
}

// ── UI Metadata ───────────────────────────────────────────────────────────────

export const TRADE_READINESS_META: Record<TradeReadiness, {
  label: string; emoji: string; color: string; bg: string; border: string; glow: string;
}> = {
  FULLY_ALIGNED:    { label: "FULLY ALIGNED",    emoji: "🟢", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", glow: "rgba(16,185,129,0.25)" },
  MOSTLY_ALIGNED:   { label: "MOSTLY ALIGNED",   emoji: "🟡", color: "text-sky-400",     bg: "bg-sky-500/12",     border: "border-sky-500/35",     glow: "rgba(56,189,248,0.18)" },
  PARTIALLY_ALIGNED:{ label: "PARTIAL ALIGN",    emoji: "🟠", color: "text-amber-400",   bg: "bg-amber-500/12",   border: "border-amber-500/30",   glow: "rgba(245,158,11,0.15)" },
  MISALIGNED:       { label: "MISALIGNED",       emoji: "🔴", color: "text-red-400",     bg: "bg-red-500/12",     border: "border-red-500/30",     glow: "rgba(239,68,68,0.18)" },
  NO_TRADE:         { label: "NO TRADE",         emoji: "⚪", color: "text-slate-400",   bg: "bg-slate-800/40",   border: "border-slate-700/30",   glow: "transparent" },
};

export const ALIGNMENT_GRADE_META: Record<AlignmentGrade, { color: string; bg: string }> = {
  "A+": { color: "text-emerald-300", bg: "bg-emerald-500/20" },
  "A":  { color: "text-emerald-400", bg: "bg-emerald-500/15" },
  "B":  { color: "text-sky-400",     bg: "bg-sky-500/15"     },
  "C":  { color: "text-amber-400",   bg: "bg-amber-500/15"   },
  "D":  { color: "text-orange-400",  bg: "bg-orange-500/12"  },
  "F":  { color: "text-red-400",     bg: "bg-red-500/15"     },
};

export const LAYER_VOTE_META: Record<LayerVote, { color: string; icon: string; bg: string }> = {
  BULLISH: { color: "text-emerald-400", icon: "▲", bg: "bg-emerald-500/15" },
  BEARISH: { color: "text-red-400",     icon: "▼", bg: "bg-red-500/15"     },
  NEUTRAL: { color: "text-slate-500",   icon: "●", bg: "bg-slate-800/40"   },
};
