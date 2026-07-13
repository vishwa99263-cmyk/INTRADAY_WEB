/**
 * aiBrainEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Layer 16: Master AI Brain Synthesizer
 *
 * The intelligence upgrade to aiDecisionEngine (L11).
 * Consumes ALL upstream layers + signal memory + pattern recognition to
 * produce a refined, adaptive final decision with dynamic confidence.
 *
 * Key improvements over L11:
 *  1. Dynamic layer weights (VIX / regime / time of day adjust weights)
 *  2. Confluence voting (how many layers agree vs disagree)
 *  3. Signal memory multiplier (self-learning confidence adjustment)
 *  4. Pattern recognition bonus (if pattern confirms decision, +confidence)
 *  5. Contradiction scoring (conflicting signals reduce confidence)
 *  6. Conviction grade: A+ / A / B / C / D / F
 *
 * Pure TypeScript — no React, no side effects.
 */

import type { AIDecisionResult }          from "./aiDecisionEngine";
import type { MomentumEngineOutput }      from "./momentumEngine";
import type { SmartMoneySignal }          from "./smartMoneyEngine";
import type { ProbabilityEngineResult }   from "./probabilityEngine";
import type { StrategyAlignmentResult }   from "./strategyAlignmentEngine";
import type { EntryZoneResult }           from "./entryZoneEngine";
import type { MarketRegimeResult }        from "./marketRegimeEngine";
import type { OptionChainEngineOutput }   from "./optionChainEngine";
import type { MarketTimeEngineResult }    from "./marketTimeEngine";
import type { SignalMemoryResult }        from "./signalMemoryEngine";
import type { PatternRecognitionResult }  from "./patternRecognitionEngine";
import type { MultiIndexOptionResult }    from "./multiIndexOptionEngine";

export interface MacroSentimentResult {
  macroSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  macroSentimentScore: number; // -100 to 100
  latestNewsHeadlines: string[];
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type BrainDecision = "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";
export type ConvictionGrade = "A+" | "A" | "B" | "C" | "D" | "F";
export type BrainState = "AGGRESSIVE" | "CONSERVATIVE" | "LEARNING" | "LOCKED" | "COOLDOWN";

export interface LayerVote {
  layerName:   string;
  layerId:     number;
  vote:        "BUY_CE" | "BUY_PE" | "NEUTRAL";
  weight:      number;         // dynamic weight 0–3
  contribution: number;        // weighted vote contribution
}

export interface DynamicWeights {
  momentum:     number;
  smartMoney:   number;
  probability:  number;
  alignment:    number;
  entryZone:    number;
  optionChain:  number;
  regime:       number;
  pattern:      number;
  multiIndex:   number;
  macro:        number;
}

export interface AiBrainResult {
  /** Final refined decision */
  finalDecision:        BrainDecision;

  /** Raw AI decision from L11 */
  baseDecision:         BrainDecision;

  /** Conviction score 0–100 */
  convictionScore:      number;

  /** Decision grade */
  convictionGrade:      ConvictionGrade;

  /** Brain state */
  brainState:           BrainState;

  /** Layer votes */
  votes:                LayerVote[];

  /** CE vote total vs PE vote total */
  ceVoteTotal:          number;
  peVoteTotal:          number;

  /** How many layers voted CE vs PE vs neutral */
  ceVoterCount:         number;
  peVoterCount:         number;
  neutralVoterCount:    number;

  /** Dynamic weights used this tick */
  weights:              DynamicWeights;

  /** Confidence after memory multiplier */
  memoryAdjustedConfidence: number;

  /** Whether pattern boosted or blocked the decision */
  patternBoost:         number;    // -20 to +20
  patternDetected:      string;

  /** Whether cooldown is blocking signals */
  cooldownBlocking:     boolean;

  /** Macro Sentiment from Global News */
  macroSentiment:       "BULLISH" | "BEARISH" | "NEUTRAL";
  macroSentimentScore:  number; // -100 to +100
  latestNewsHeadlines:  string[];

  /** Contradiction penalty applied */
  contradictionPenalty: number;

  /** Reasoning log */
  reasoning:            string[];

  /** Timestamp */
  timestamp:            number;
}

export interface AiBrainInput {
  // Core L11 output
  aiDecisionResult:         AIDecisionResult;

  // Upstream engines
  momentumResult?:          MomentumEngineOutput;
  smartMoneyResult?:        SmartMoneySignal;
  probabilityResult:        ProbabilityEngineResult;
  strategyAlignmentResult:  StrategyAlignmentResult;
  entryZoneResult:          EntryZoneResult;
  regimeResult:             MarketRegimeResult;
  optionChainResult?:       OptionChainEngineOutput;
  multiIndexResult?:        MultiIndexOptionResult;

  // Market context
  indiaVix?:                number;
  marketTimeResult?:        MarketTimeEngineResult;

  // New AI layers
  signalMemoryResult?:      SignalMemoryResult;
  patternResult?:           PatternRecognitionResult;
  macroSentimentResult?:    MacroSentimentResult;

  forceLocked?:             boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function nowISTMinutes(): number {
  const now    = Date.now();
  const istDate = new Date(now + 5.5 * 3600 * 1000);
  return istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
}

// ── Dynamic Weight Calculator ─────────────────────────────────────────────────

function computeDynamicWeights(
  vix: number,
  regime: string,
  minutesSinceOpen: number,
): DynamicWeights {
  const isHighVix    = vix > 18;
  const isLowVix     = vix < 12;
  const isTrending   = regime.includes("TREND");
  const isRanging    = regime.includes("RANGE");
  const isOpening    = minutesSinceOpen < 30;
  const isClosing    = minutesSinceOpen > 270;

  let weights: DynamicWeights = {
    momentum:    1.0,
    smartMoney:  1.0,
    probability: 1.2,
    alignment:   1.2,
    entryZone:   1.0,
    optionChain: 1.0,
    regime:      0.8,
    pattern:     1.0,
    multiIndex:  0.8,
    macro:       1.5,
  };

  // VIX adjustments
  if (isHighVix) {
    // High VIX: trust smart money & probability more, momentum less
    weights.smartMoney  = 1.8;
    weights.probability = 1.6;
    weights.momentum    = 0.6;
    weights.optionChain = 1.4;
  } else if (isLowVix) {
    // Low VIX: momentum-driven market
    weights.momentum    = 1.6;
    weights.pattern     = 1.4;
    weights.smartMoney  = 0.8;
  }

  // Regime adjustments
  if (isTrending) {
    weights.momentum   = Math.max(weights.momentum, 1.5);
    weights.alignment  = 1.4;
    weights.pattern    = 1.3;
  } else if (isRanging) {
    weights.optionChain = Math.max(weights.optionChain, 1.4);
    weights.smartMoney  = Math.max(weights.smartMoney, 1.3);
    weights.momentum    = Math.min(weights.momentum, 0.7);
  }

  // Time of day adjustments
  if (isOpening) {
    // Opening: ORB & pattern most important
    weights.pattern    = 1.8;
    weights.entryZone  = 1.5;
    weights.alignment  = 0.8;
  } else if (isClosing) {
    // Closing: probability & option chain (max pain) most important
    weights.probability = 1.5;
    weights.optionChain = 1.6;
    weights.momentum    = 0.7;
  }

  return weights;
}

// ── Layer Vote Collector ──────────────────────────────────────────────────────

function collectVotes(input: AiBrainInput, weights: DynamicWeights): LayerVote[] {
  const {
    aiDecisionResult,
    momentumResult,
    smartMoneyResult,
    probabilityResult,
    strategyAlignmentResult,
    entryZoneResult,
    optionChainResult,
    multiIndexResult,
    patternResult,
  } = input;

  const votes: LayerVote[] = [];

  const push = (
    layerId: number,
    layerName: string,
    vote: "BUY_CE" | "BUY_PE" | "NEUTRAL",
    weight: number,
  ) => {
    const contribution = vote === "BUY_CE" ? weight : vote === "BUY_PE" ? -weight : 0;
    votes.push({ layerId, layerName, vote, weight, contribution });
  };

  // L11: Base AI Decision
  const baseDir = aiDecisionResult.finalDecision;
  if (baseDir === "BUY_CE") push(11, "AI Decision",    "BUY_CE",  weights.alignment * 1.2);
  else if (baseDir === "BUY_PE") push(11, "AI Decision", "BUY_PE", weights.alignment * 1.2);
  else push(11, "AI Decision", "NEUTRAL", 0);

  // Momentum (L4)
  if (momentumResult) {
    const dir = momentumResult.momentumDirection;
    const w   = weights.momentum * (momentumResult.momentumScore > 75 ? 1.3 : 1.0);
    if (dir === "BULLISH") push(4, "Momentum", "BUY_CE", w);
    else if (dir === "BEARISH") push(4, "Momentum", "BUY_PE", w);
    else push(4, "Momentum", "NEUTRAL", 0);
  }

  // Smart Money (L7)
  if (smartMoneyResult) {
    const dir = smartMoneyResult.flowDirection;
    const w   = weights.smartMoney;
    if (dir === "BULLISH") push(7, "Smart Money",  "BUY_CE", w);
    else if (dir === "BEARISH") push(7, "Smart Money", "BUY_PE", w);
    else push(7, "Smart Money", "NEUTRAL", 0);

    // Trap detection
    if (smartMoneyResult.trapType === "FAKE_BREAKDOWN") push(7, "SM Trap", "BUY_CE", w * 1.5);
    if (smartMoneyResult.trapType === "FAKE_BREAKOUT")  push(7, "SM Trap", "BUY_PE", w * 1.5);
  }

  // Probability (L8)
  const probDir = probabilityResult.ceProbability > probabilityResult.peProbability ? "BUY_CE" : "BUY_PE";
  const probW   = weights.probability * (probabilityResult.confidenceLevel / 100);
  push(8, "Probability PMAE", probDir, probW);

  // Strategy Alignment (L6)
  const alDir = strategyAlignmentResult.dominantDirection;
  const alW   = weights.alignment * (strategyAlignmentResult.alignmentScore / 100);
  if (alDir === "BULLISH") push(6, "Strategy Alignment", "BUY_CE", alW);
  else if (alDir === "BEARISH") push(6, "Strategy Alignment", "BUY_PE", alW);
  else push(6, "Strategy Alignment", "NEUTRAL", 0);

  // Entry Zone (L3)
  const ezDir = entryZoneResult.direction;
  if (ezDir === "CE") push(3, "Entry Zone", "BUY_CE", weights.entryZone);
  else if (ezDir === "PE") push(3, "Entry Zone", "BUY_PE", weights.entryZone);
  else push(3, "Entry Zone", "NEUTRAL", 0);

  // Option Chain (L5)
  if (optionChainResult) {
    const pcr = optionChainResult.pcr;
    const ocW = weights.optionChain;
    if (pcr > 1.25) push(5, "Option Chain PCR", "BUY_CE", ocW);
    else if (pcr < 0.80) push(5, "Option Chain PCR", "BUY_PE", ocW);
    else push(5, "Option Chain PCR", "NEUTRAL", 0);
  }

  // Multi-Index (L5.5)
  if (multiIndexResult) {
    const bias = multiIndexResult.overallBias;
    const miW  = weights.multiIndex;
    if (bias === "BULLISH") push(55, "Multi-Index", "BUY_CE", miW);
    else if (bias === "BEARISH") push(55, "Multi-Index", "BUY_PE", miW);
    else push(55, "Multi-Index", "NEUTRAL", 0);
  }

  // Pattern (L18)
  if (patternResult && patternResult.primaryPattern.name !== "NONE") {
    const pSig = patternResult.consensusSignal;
    const pW   = weights.pattern * (patternResult.consensusConfidence / 100);
    if (pSig === "BUY_CE") push(18, "Pattern Recognition", "BUY_CE", pW);
    else if (pSig === "BUY_PE") push(18, "Pattern Recognition", "BUY_PE", pW);
    else push(18, "Pattern Recognition", "NEUTRAL", 0);
  }

  // Macro Sentiment (L19)
  if (input.macroSentimentResult) {
    const macroDir = input.macroSentimentResult.macroSentiment;
    const macroW = weights.macro * (Math.abs(input.macroSentimentResult.macroSentimentScore) / 100);
    if (macroDir === "BULLISH") push(19, "Macro Sentiment", "BUY_CE", macroW);
    else if (macroDir === "BEARISH") push(19, "Macro Sentiment", "BUY_PE", macroW);
    else push(19, "Macro Sentiment", "NEUTRAL", 0);
  }

  return votes;
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeAiBrain(input: AiBrainInput): AiBrainResult {
  const {
    aiDecisionResult,
    regimeResult,
    indiaVix         = 15,
    marketTimeResult,
    signalMemoryResult,
    patternResult,
    macroSentimentResult,
  } = input;

  const reasoning: string[] = [];
  const now = Date.now();

  // ── HARD GATE: Manual Force Lock ──────────────────────────────────────────
  if (input.forceLocked) {
    return {
      finalDecision:           "NO_TRADE",
      baseDecision:            aiDecisionResult.finalDecision as BrainDecision,
      convictionScore:         0,
      convictionGrade:         "F",
      brainState:              "LOCKED",
      votes:                   [],
      ceVoteTotal:             0,
      peVoteTotal:             0,
      ceVoterCount:            0,
      peVoterCount:            0,
      neutralVoterCount:       0,
      weights:                 computeDynamicWeights(indiaVix, regimeResult.regime, 0),
      memoryAdjustedConfidence: 0,
      patternBoost:            0,
      patternDetected:         "NONE",
      cooldownBlocking:        false,
      macroSentiment:          input.macroSentimentResult?.macroSentiment ?? "NEUTRAL",
      macroSentimentScore:     input.macroSentimentResult?.macroSentimentScore ?? 0,
      latestNewsHeadlines:     input.macroSentimentResult?.latestNewsHeadlines ?? [],
      contradictionPenalty:    0,
      reasoning:               ["🔒 MANUALLY LOCKED — AI Brain forced locked"],
      timestamp:               now,
    };
  }

  // ── HARD GATE: Market Closed ──────────────────────────────────────────────
  if (marketTimeResult && !marketTimeResult.isTradingAllowed) {
    return {
      finalDecision:           "WAIT",
      baseDecision:            "WAIT",
      convictionScore:         0,
      convictionGrade:         "F",
      brainState:              "LOCKED",
      votes:                   [],
      ceVoteTotal:             0,
      peVoteTotal:             0,
      ceVoterCount:            0,
      peVoterCount:            0,
      neutralVoterCount:       0,
      weights:                 computeDynamicWeights(indiaVix, regimeResult.regime, 0),
      memoryAdjustedConfidence: 0,
      patternBoost:            0,
      patternDetected:         "NONE",
      cooldownBlocking:        false,
      macroSentiment:          input.macroSentimentResult?.macroSentiment ?? "NEUTRAL",
      macroSentimentScore:     input.macroSentimentResult?.macroSentimentScore ?? 0,
      latestNewsHeadlines:     input.macroSentimentResult?.latestNewsHeadlines ?? [],
      contradictionPenalty:    0,
      reasoning:               ["⏳ Market closed — AI Brain locked"],
      timestamp:               now,
    };
  }

  // ── HARD GATE: Cooldown ───────────────────────────────────────────────────
  if (signalMemoryResult?.cooldownActive) {
    const remaining = Math.ceil(signalMemoryResult.cooldownRemainingSeconds / 60);
    reasoning.push(`🔒 COOLDOWN ACTIVE — ${remaining} min remaining after ${signalMemoryResult.consecutiveLosses} consecutive losses`);
    return {
      finalDecision:           "NO_TRADE",
      baseDecision:            aiDecisionResult.finalDecision as BrainDecision,
      convictionScore:         0,
      convictionGrade:         "F",
      brainState:              "COOLDOWN",
      votes:                   [],
      ceVoteTotal:             0,
      peVoteTotal:             0,
      ceVoterCount:            0,
      peVoterCount:            0,
      neutralVoterCount:       0,
      weights:                 computeDynamicWeights(indiaVix, regimeResult.regime, 0),
      memoryAdjustedConfidence: 0,
      patternBoost:            0,
      patternDetected:         "NONE",
      cooldownBlocking:        true,
      macroSentiment:          input.macroSentimentResult?.macroSentiment ?? "NEUTRAL",
      macroSentimentScore:     input.macroSentimentResult?.macroSentimentScore ?? 0,
      latestNewsHeadlines:     input.macroSentimentResult?.latestNewsHeadlines ?? [],
      contradictionPenalty:    0,
      reasoning,
      timestamp:               now,
    };
  }

  // ── Dynamic Weights ───────────────────────────────────────────────────────
  const minutesSinceOpen = nowISTMinutes() - (9 * 60 + 15);
  const weights = computeDynamicWeights(indiaVix, regimeResult.regime, minutesSinceOpen);

  // ── Collect Layer Votes ───────────────────────────────────────────────────
  const votes = collectVotes(input, weights);

  const ceVotes    = votes.filter(v => v.vote === "BUY_CE");
  const peVotes    = votes.filter(v => v.vote === "BUY_PE");
  const neutVotes  = votes.filter(v => v.vote === "NEUTRAL");

  const ceVoteTotal  = ceVotes.reduce((s, v) => s + v.contribution, 0);
  const peVoteTotal  = Math.abs(peVotes.reduce((s, v) => s + v.contribution, 0));
  const ceVoterCount = ceVotes.length;
  const peVoterCount = peVotes.length;

  // ── Raw Direction from Vote Tally ─────────────────────────────────────────
  let rawDirection: BrainDecision =
    ceVoteTotal > peVoteTotal ? "BUY_CE" :
    peVoteTotal > ceVoteTotal ? "BUY_PE" :
    "WAIT";

  // ── Conviction Score ──────────────────────────────────────────────────────
  const totalVoteWeight  = ceVoteTotal + peVoteTotal;
  const winningVoteTotal = Math.max(ceVoteTotal, peVoteTotal);
  const rawConviction    = totalVoteWeight > 0
    ? (winningVoteTotal / totalVoteWeight) * 100
    : 50;

  // Blend with L11 confidence
  let convictionScore = rawConviction * 0.60 + aiDecisionResult.confidence * 0.40;

  // ── Contradiction Penalty ─────────────────────────────────────────────────
  const losingVoteTotal = Math.min(ceVoteTotal, peVoteTotal);
  const contradictionRatio = totalVoteWeight > 0 ? losingVoteTotal / totalVoteWeight : 0;
  const contradictionPenalty = Math.round(contradictionRatio * 25); // max -25
  convictionScore -= contradictionPenalty;

  if (contradictionPenalty > 10) {
    reasoning.push(`⚠ Contradiction penalty: -${contradictionPenalty} (${ceVoterCount} CE vs ${peVoterCount} PE voters)`);
  }

  // ── Pattern Boost/Block ───────────────────────────────────────────────────
  let patternBoost = 0;
  let patternDetected = "NONE";
  if (patternResult && patternResult.primaryPattern.name !== "NONE") {
    patternDetected = patternResult.primaryPattern.name;
    const pSig = patternResult.consensusSignal;
    if (pSig === rawDirection && pSig !== "WAIT") {
      // Pattern confirms direction → boost
      patternBoost = Math.round(patternResult.primaryPattern.confidence * 0.15); // max ~15
      reasoning.push(`✅ Pattern CONFIRMS: ${patternResult.primaryPattern.description} (+${patternBoost})`);
    } else if (pSig !== "WAIT" && pSig !== rawDirection) {
      // Pattern contradicts → block
      patternBoost = -Math.round(patternResult.primaryPattern.confidence * 0.12);
      reasoning.push(`⚠ Pattern CONTRADICTS direction: ${patternResult.primaryPattern.description} (${patternBoost})`);
    }
    convictionScore += patternBoost;
  }

  // ── Memory Multiplier ─────────────────────────────────────────────────────
  const multiplier = signalMemoryResult?.confidenceMultiplier ?? 1.0;
  convictionScore *= multiplier;
  const memoryAdjustedConfidence = Math.round(convictionScore);

  if (multiplier !== 1.0) {
    reasoning.push(`🧠 Memory multiplier: ${multiplier.toFixed(2)}x (${signalMemoryResult?.recentWinRate ?? 50}% recent win rate)`);
  }

  // ── Final clamp & grade ───────────────────────────────────────────────────
  convictionScore = clamp(Math.round(convictionScore), 0, 100);

  let convictionGrade: ConvictionGrade = "F";
  if (convictionScore >= 90) convictionGrade = "A+";
  else if (convictionScore >= 80) convictionGrade = "A";
  else if (convictionScore >= 68) convictionGrade = "B";
  else if (convictionScore >= 55) convictionGrade = "C";
  else if (convictionScore >= 40) convictionGrade = "D";
  else convictionGrade = "F";

  // ── Safety: too low conviction → WAIT ────────────────────────────────────
  let finalDecision: BrainDecision = rawDirection;
  if (convictionScore < 42 && (rawDirection === "BUY_CE" || rawDirection === "BUY_PE")) {
    finalDecision = "WAIT";
    reasoning.push(`⏳ Conviction too low (${convictionScore}) — downgraded to WAIT`);
  }

  // Override with L11 NO_TRADE if needed
  if (aiDecisionResult.finalDecision === "NO_TRADE") {
    finalDecision = "NO_TRADE";
    reasoning.push("⛔ L11 AI Decision enforces NO_TRADE — Brain respects hard gate");
  }

  // ── Brain State ───────────────────────────────────────────────────────────
  const memBrainState = signalMemoryResult?.brainState ?? "LEARNING";
  let brainState: BrainState = memBrainState as BrainState;
  if (convictionScore >= 80 && finalDecision !== "WAIT" && finalDecision !== "NO_TRADE") {
    brainState = "AGGRESSIVE";
  } else if (finalDecision === "WAIT" || convictionScore < 50) {
    brainState = "CONSERVATIVE";
  }

  // ── Direction reasoning ───────────────────────────────────────────────────
  if (finalDecision === "BUY_CE" || finalDecision === "BUY_PE") {
    reasoning.push(`${finalDecision === "BUY_CE" ? "🟢" : "🔴"} ${finalDecision}: Conviction ${convictionScore}/100 (Grade ${convictionGrade}) | ${ceVoterCount} CE voters vs ${peVoterCount} PE voters`);
  } else if (finalDecision === "WAIT") {
    reasoning.push(`⏳ WAIT: Insufficient conviction or conflicting signals`);
  }

  return {
    finalDecision,
    baseDecision:            aiDecisionResult.finalDecision as BrainDecision,
    convictionScore,
    convictionGrade,
    brainState,
    votes,
    ceVoteTotal:             parseFloat(ceVoteTotal.toFixed(2)),
    peVoteTotal:             parseFloat(peVoteTotal.toFixed(2)),
    ceVoterCount,
    peVoterCount,
    neutralVoterCount:       neutVotes.length,
    weights,
    memoryAdjustedConfidence,
    patternBoost,
    patternDetected,
    cooldownBlocking:        false,
    macroSentiment:          input.macroSentimentResult?.macroSentiment ?? "NEUTRAL",
    macroSentimentScore:     input.macroSentimentResult?.macroSentimentScore ?? 0,
    latestNewsHeadlines:     input.macroSentimentResult?.latestNewsHeadlines ?? [],
    contradictionPenalty,
    reasoning,
    timestamp:               now,
  };
}
