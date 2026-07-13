/**
 * opportunityEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 12: Opportunity Engine v1.0
 *
 * Scans, ranks, and prioritizes high-probability trading opportunities
 * across all upstream layers (1 to 11).
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layers 1–11. Consumed by Layers 13, 14.
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
import type { StrategyAlignmentResult }   from "./strategyAlignmentEngine";
import type { AIDecisionResult }          from "./aiDecisionEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OpportunityType =
  | "AI_IGNITION"
  | "RANGE_BREAKOUT"
  | "SMART_MONEY_TRAP"
  | "OPTION_WALL_BOUNCE"
  | "HEAVYWEIGHT_IGNITION";

export type OpportunityPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface TradingOpportunity {
  // Legacy fields
  id: string;
  name: string;
  type: OpportunityType;
  direction: "CE" | "PE" | "WAIT"; // Keeps compatibility
  score: number;                   // 0-100 quality score
  priority: OpportunityPriority;
  triggerPrice: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  description: string;
  setupQuality: "STRONG" | "MODERATE" | "WEAK";

  // New fields for dual compatibility
  symbol: string;
  confidence: number;
  entry: number;
  sl: number;
  rrRatio: number;
  
  // Diagnostic tracking
  rejectReason?: string;
}

export interface OpportunityResult {
  // Legacy fields
  opportunities: TradingOpportunity[];
  topOpportunity: TradingOpportunity | null;
  opportunityScore: number;         // Aggregate rating of the overall market opportunities 0-100
  timestamp: number;

  // New fields
  marketMode: "AGGRESSIVE" | "CAUTIOUS" | "NO_TRADE_ZONE";
  reasoning: string[];
  
  // Custom dashboard panel visual helper
  rejectedSetups: TradingOpportunity[];
}

export interface OpportunityInput {
  regimeResult:            MarketRegimeResult;
  breadthResult:           MarketBreadthResult;
  heavyweightResult?:      HeavyweightResult;
  range15mResult?:         Range15MResult;
  optionChainResult?:      OptionChainEngineOutput;
  momentumResult?:         MomentumEngineOutput;
  smartMoneyResult?:       SmartMoneySignal;
  probabilityResult:       ProbabilityEngineResult;
  entryZoneResult:         EntryZoneResult;
  strategyAlignmentResult: StrategyAlignmentResult;
  aiDecisionResult:        AIDecisionResult;
  spotPrice:               number;
  activePage?:             "NIFTY" | "SENSEX";
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeOpportunities(input: OpportunityInput): OpportunityResult {
  const {
    regimeResult,
    breadthResult,
    heavyweightResult,
    range15mResult,
    optionChainResult,
    momentumResult,
    smartMoneyResult,
    probabilityResult,
    entryZoneResult,
    strategyAlignmentResult,
    aiDecisionResult,
    spotPrice,
    activePage,
  } = input;

  const symbol = activePage || (spotPrice > 40000 ? "SENSEX" : "NIFTY");
  const rawSetups: TradingOpportunity[] = [];
  const reasoning: string[] = [];

  // Helper to determine priority and quality based on score
  const getPrioAndQuality = (score: number): { priority: OpportunityPriority; setupQuality: "STRONG" | "MODERATE" | "WEAK" } => {
    if (score >= 90) return { priority: "CRITICAL", setupQuality: "STRONG" };
    if (score >= 75) return { priority: "HIGH", setupQuality: "STRONG" };
    if (score >= 60) return { priority: "MEDIUM", setupQuality: "MODERATE" };
    return { priority: "LOW", setupQuality: "WEAK" };
  };

  // Helper to calculate opportunityScore via the new model
  const calcOpportunityScore = (params: {
    probConf: number;
    alignScore: number;
    momScore: number;
    breadthScore: number;
    entryConf: number;
    rrRatio: number;
  }): number => {
    const rrScore = Math.min(100, Math.max(0, params.rrRatio * 25)); // 1:3 RR -> 75, 1:4 RR -> 100
    const rawScore =
      (params.probConf * 0.30) +
      (params.alignScore * 0.25) +
      (params.momScore * 0.15) +
      (params.breadthScore * 0.10) +
      (params.entryConf * 0.10) +
      (rrScore * 0.10);
    return Math.max(0, Math.min(100, Math.round(rawScore)));
  };

  // ── 1. SCANNER: AI DECISION IGNITION ──────────────────────────────────────
  const finalDecision = aiDecisionResult.finalDecision;

  // ── Time Window Filters (IST: UTC+5:30) ──
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const istTime = new Date(utc + 5.5 * 3600000);
  const hour = istTime.getUTCHours();
  const minute = istTime.getUTCMinutes();

  const isOutsideTradingHours = (hour === 9 && minute < 30) || hour < 9 || hour >= 15;
  if (isOutsideTradingHours) {
    return {
      opportunities: [],
      topOpportunity: null,
      opportunityScore: 0,
      timestamp: Date.now(),
      marketMode: "NO_TRADE_ZONE",
      reasoning: [
        `Preservation Mode: Outside allowed trading window (Current IST: ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")})`
      ],
      rejectedSetups: [],
    };
  }

  // ── AI Ignition Gate ──
  if (
    aiDecisionResult.decisionConfidence < 55 ||
    strategyAlignmentResult.alignmentScore < 45
  ) {
    return {
      opportunities: [],
      topOpportunity: null,
      opportunityScore: 0,
      timestamp: Date.now(),
      marketMode: "NO_TRADE_ZONE",
      reasoning: [
        `Preservation Mode: AI Ignition Gate blocked analysis (Confidence: ${aiDecisionResult.decisionConfidence}%, Alignment: ${strategyAlignmentResult.alignmentScore})`
      ],
      rejectedSetups: [],
    };
  }

  const isCE = finalDecision === "BUY_CE";
  const isPE = finalDecision === "BUY_PE";
  if (isCE || isPE) {
    const direction = isCE ? "CE" : "PE";
    const probConf = isCE ? probabilityResult.ceProbability : probabilityResult.peProbability;
    const alignScore = strategyAlignmentResult.alignmentScore;
    const momScore = momentumResult?.momentumScore ?? 50;
    const bScore = breadthResult.breadthScore;
    const entryConf = entryZoneResult.confidence || 65;
    const rrRatio = Math.max(2.5, entryZoneResult.riskReward || 2.5);

    const score = calcOpportunityScore({ probConf, alignScore, momScore, breadthScore: bScore, entryConf, rrRatio });
    const { priority, setupQuality } = getPrioAndQuality(score);

    rawSetups.push({
      id: "opp-ai-ignition",
      name: `AI Decision Engine ${direction} Trigger`,
      type: "AI_IGNITION",
      direction,
      score,
      priority,
      triggerPrice: entryZoneResult.entryPrice || spotPrice,
      stopLoss: entryZoneResult.stopLoss,
      target: entryZoneResult.target,
      riskRewardRatio: rrRatio,
      description: `Final execution brain triggers ${direction} entry with L11 confidence ${aiDecisionResult.decisionConfidence}% and composite score of ${score}%.`,
      setupQuality,
      symbol,
      confidence: aiDecisionResult.decisionConfidence,
      entry: entryZoneResult.entryPrice || spotPrice,
      sl: entryZoneResult.stopLoss,
      rrRatio,
    });
  }

  // ── 2. SCANNER: 15M RANGE BOUNDARY CONSOLIDATION ──────────────────────────
  if (range15mResult && range15mResult.rangeHigh > 0 && range15mResult.rangeLow > 0) {
    const rHigh = range15mResult.rangeHigh;
    const rLow = range15mResult.rangeLow;
    const rangeWidth = rHigh - rLow;
    
    // Near range high (CE Breakout setup)
    const distToHigh = (rHigh - spotPrice) / spotPrice;
    if (distToHigh > -0.0015 && distToHigh < 0.0015 && !range15mResult.rangeBreakout) {
      const probConf = probabilityResult.ceProbability;
      const alignScore = strategyAlignmentResult.alignmentScore;
      const momScore = momentumResult?.momentumScore ?? 50;
      const bScore = breadthResult.breadthScore;
      const entryConf = entryZoneResult.confidence || 70;
      const rrRatio = 2.5; // Breakout base RR

      const score = calcOpportunityScore({ probConf, alignScore, momScore, breadthScore: bScore, entryConf, rrRatio });
      const { priority, setupQuality } = getPrioAndQuality(score);

      rawSetups.push({
        id: "opp-range-breakout-ce",
        name: "15M Opening Range High Breakout Scanner",
        type: "RANGE_BREAKOUT",
        direction: "CE",
        score,
        priority,
        triggerPrice: rHigh + 2,
        stopLoss: rHigh - rangeWidth * 0.25,
        target: rHigh + rangeWidth * 0.75,
        riskRewardRatio: rrRatio,
        description: `Price consolidating within 0.15% of the 15M Range High (${rHigh.toFixed(1)}). Bullish breakout developing.`,
        setupQuality,
        symbol,
        confidence: range15mResult.rangeConfidence || 50,
        entry: rHigh + 2,
        sl: rHigh - rangeWidth * 0.25,
        rrRatio,
      });
    }

    // Near range low (PE Breakdown setup)
    const distToLow = (spotPrice - rLow) / spotPrice;
    if (distToLow > -0.0015 && distToLow < 0.0015 && !range15mResult.rangeBreakdown) {
      const probConf = probabilityResult.peProbability;
      const alignScore = strategyAlignmentResult.alignmentScore;
      const momScore = momentumResult?.momentumScore ?? 50;
      const bScore = breadthResult.breadthScore;
      const entryConf = entryZoneResult.confidence || 70;
      const rrRatio = 2.5;

      const score = calcOpportunityScore({ probConf, alignScore, momScore, breadthScore: bScore, entryConf, rrRatio });
      const { priority, setupQuality } = getPrioAndQuality(score);

      rawSetups.push({
        id: "opp-range-breakdown-pe",
        name: "15M Opening Range Low Breakdown Scanner",
        type: "RANGE_BREAKOUT",
        direction: "PE",
        score,
        priority,
        triggerPrice: rLow - 2,
        stopLoss: rLow + rangeWidth * 0.25,
        target: rLow - rangeWidth * 0.75,
        riskRewardRatio: rrRatio,
        description: `Price consolidating within 0.15% of the 15M Range Low (${rLow.toFixed(1)}). Bearish breakdown developing.`,
        setupQuality,
        symbol,
        confidence: range15mResult.rangeConfidence || 50,
        entry: rLow - 2,
        sl: rLow + rangeWidth * 0.25,
        rrRatio,
      });
    }
  }

  // ── 3. SCANNER: SMART MONEY TRAP DETECTOR ─────────────────────────────────
  if (smartMoneyResult && smartMoneyResult.trapType && smartMoneyResult.trapType !== "NONE") {
    const isBullTrap = smartMoneyResult.trapType === "FAKE_BREAKOUT";
    const direction = isBullTrap ? "PE" : "CE";
    
    const probConf = isBullTrap ? probabilityResult.peProbability : probabilityResult.ceProbability;
    const alignScore = strategyAlignmentResult.alignmentScore;
    const momScore = momentumResult?.momentumScore ?? 50;
    const bScore = breadthResult.breadthScore;
    const entryConf = entryZoneResult.confidence || 75;
    const rrRatio = 3.2; // Trap reversals have high risk-reward profiles

    const score = calcOpportunityScore({ probConf, alignScore, momScore, breadthScore: bScore, entryConf, rrRatio });
    const { priority, setupQuality } = getPrioAndQuality(score);

    rawSetups.push({
      id: `opp-smart-money-trap-${direction.toLowerCase()}`,
      name: `Smart Money ${smartMoneyResult.trapType.replace("_", " ")} Counter-Trend Setup`,
      type: "SMART_MONEY_TRAP",
      direction,
      score,
      priority,
      triggerPrice: spotPrice,
      stopLoss: direction === "CE" ? spotPrice * 0.9975 : spotPrice * 1.0025,
      target: direction === "CE" ? spotPrice * 1.0080 : spotPrice * 0.9920,
      riskRewardRatio: rrRatio,
      description: `Institutional trap engine flags: ${smartMoneyResult.trapType}. Entering counter-trend option buy with tight stops.`,
      setupQuality,
      symbol,
      confidence: smartMoneyResult.confidence,
      entry: spotPrice,
      sl: direction === "CE" ? spotPrice * 0.9975 : spotPrice * 1.0025,
      rrRatio,
    });
  }

  // ── 4. SCANNER: OPTION OI WALL REVERSAL ───────────────────────────────────
  if (optionChainResult && optionChainResult.oiWalls && spotPrice > 0) {
    const supportWall = optionChainResult.oiWalls.putWall;
    const resistanceWall = optionChainResult.oiWalls.callWall;
    
    const threshold = spotPrice > 40000 ? 120 : 35;
    
    // Put Wall Support Bounce CE Setup
    if (supportWall > 0 && Math.abs(spotPrice - supportWall) < threshold) {
      const probConf = probabilityResult.ceProbability;
      const alignScore = strategyAlignmentResult.alignmentScore;
      const momScore = momentumResult?.momentumScore ?? 50;
      const bScore = breadthResult.breadthScore;
      const entryConf = 80; // Options wall bounce has higher localized entry confidence
      const rrRatio = 3.6;

      const score = calcOpportunityScore({ probConf, alignScore, momScore, breadthScore: bScore, entryConf, rrRatio });
      const { priority, setupQuality } = getPrioAndQuality(score);

      rawSetups.push({
        id: "opp-oi-wall-support-bounce",
        name: "Option Chain Put Wall Bounce Setup",
        type: "OPTION_WALL_BOUNCE",
        direction: "CE",
        score,
        priority,
        triggerPrice: supportWall + 5,
        stopLoss: supportWall - 25,
        target: supportWall + 90,
        riskRewardRatio: rrRatio,
        description: `Price near Put Open Interest support wall (${supportWall.toFixed(0)}). Expecting sharp bullish bounce.`,
        setupQuality,
        symbol,
        confidence: Math.round(optionChainResult.pcrScore),
        entry: supportWall + 5,
        sl: supportWall - 25,
        rrRatio,
      });
    }

    // Call Wall Resistance Rejection PE Setup
    if (resistanceWall > 0 && Math.abs(spotPrice - resistanceWall) < threshold) {
      const probConf = probabilityResult.peProbability;
      const alignScore = strategyAlignmentResult.alignmentScore;
      const momScore = momentumResult?.momentumScore ?? 50;
      const bScore = breadthResult.breadthScore;
      const entryConf = 80;
      const rrRatio = 3.6;

      const score = calcOpportunityScore({ probConf, alignScore, momScore, breadthScore: bScore, entryConf, rrRatio });
      const { priority, setupQuality } = getPrioAndQuality(score);

      rawSetups.push({
        id: "opp-oi-wall-resistance-reject",
        name: "Option Chain Resistance Wall Rejection Setup",
        type: "OPTION_WALL_BOUNCE",
        direction: "PE",
        score,
        priority,
        triggerPrice: resistanceWall - 5,
        stopLoss: resistanceWall + 25,
        target: resistanceWall - 90,
        riskRewardRatio: rrRatio,
        description: `Price near Call Open Interest resistance wall (${resistanceWall.toFixed(0)}). Expecting bearish rejection.`,
        setupQuality,
        symbol,
        confidence: Math.round(100 - optionChainResult.pcrScore),
        entry: resistanceWall - 5,
        sl: resistanceWall + 25,
        rrRatio,
      });
    }
  }

  // ── 5. SCANNER: HEAVYWEIGHT ACCELERATION DIVERGENCE ──────────────────────
  if (heavyweightResult && spotPrice > 0) {
    const hwScore = heavyweightResult.heavyweightScore;
    const concentration = heavyweightResult.concentrationScore;
    const hwDir = heavyweightResult.heavyweightDirection;
    
    const isFlatSpot = regimeResult.regime === "RANGE" || regimeResult.regime === "VOLATILE";
    if (isFlatSpot && concentration >= 70 && hwScore >= 68) {
      const isBullHw = hwDir === "STRONG_BULLISH" || hwDir === "BULLISH";
      const isBearHw = hwDir === "STRONG_BEARISH" || hwDir === "BEARISH";
      
      if (isBullHw || isBearHw) {
        const direction = isBullHw ? "CE" : "PE";
        const probConf = isBullHw ? probabilityResult.ceProbability : probabilityResult.peProbability;
        const alignScore = strategyAlignmentResult.alignmentScore;
        const momScore = momentumResult?.momentumScore ?? 50;
        const bScore = breadthResult.breadthScore;
        const entryConf = entryZoneResult.confidence || 65;
        const rrRatio = 3.3;

        const score = calcOpportunityScore({ probConf, alignScore, momScore, breadthScore: bScore, entryConf, rrRatio });
        const { priority, setupQuality } = getPrioAndQuality(score);

        rawSetups.push({
          id: `opp-hw-divergence-${direction.toLowerCase()}`,
          name: `Heavyweight Trio Concentration Ignition (${direction})`,
          type: "HEAVYWEIGHT_IGNITION",
          direction,
          score,
          priority,
          triggerPrice: spotPrice,
          stopLoss: direction === "CE" ? spotPrice * 0.9982 : spotPrice * 1.0018,
          target: direction === "CE" ? spotPrice * 1.0060 : spotPrice * 0.9940,
          riskRewardRatio: rrRatio,
          description: `Reliance, HDFC Bank, ICICI Bank moving aggressively ${hwDir}. Spot index is lagging but expected to resolve.`,
          setupQuality,
          symbol,
          confidence: Math.round(hwScore),
          entry: spotPrice,
          sl: direction === "CE" ? spotPrice * 0.9982 : spotPrice * 1.0018,
          rrRatio,
        });
      }
    }
  }

  // ── Step 1: Global Validation Gate Filters ──
  const isWaitDecision = finalDecision === "WAIT";
  const isNoTradeDecision = finalDecision === "NO_TRADE";
  const isLowConfidence = aiDecisionResult.decisionConfidence < 75;
  const isWeakAlignment = strategyAlignmentResult.alignmentScore < 70;

  const globalFiltersFailed = isWaitDecision || isNoTradeDecision || isLowConfidence || isWeakAlignment;

  const opportunities: TradingOpportunity[] = [];
  const rejectedSetups: TradingOpportunity[] = [];

  for (const setup of rawSetups) {
    if (globalFiltersFailed) {
      let reason = "Global Filter Gate Triggered";
      if (isWaitDecision) reason = "AI Decision is in WAIT posture";
      else if (isNoTradeDecision) reason = "AI Decision is in NO_TRADE posture";
      else if (isLowConfidence) reason = `L11 Confidence is ${aiDecisionResult.decisionConfidence}% (below 75%)`;
      else if (isWeakAlignment) reason = `L10 Alignment Score is ${strategyAlignmentResult.alignmentScore} (weak, below 70)`;

      rejectedSetups.push({
        ...setup,
        priority: "LOW",
        setupQuality: "WEAK",
        rejectReason: reason,
      });
    } else if (setup.score < 75) {
      // Step 3 filter: Individual low quality setups
      rejectedSetups.push({
        ...setup,
        priority: "LOW",
        setupQuality: "WEAK",
        rejectReason: `Setup score ${setup.score}% is below institutional threshold (75%)`,
      });
    } else {
      opportunities.push(setup);
    }
  }

  // ── Step 3: Ranking System ──
  // Sort all valid setups by opportunityScore DESC, then tie-breakers:
  opportunities.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie breaker 1: highest probabilityConfidence
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Tie breaker 2: highest RR ratio
    return b.rrRatio - a.rrRatio;
  });

  const topOpportunity = opportunities.length > 0 ? opportunities[0] : null;

  // Determine overall Market Mode - Rule 10: Final Institutional Gate
  let marketMode: "AGGRESSIVE" | "CAUTIOUS" | "NO_TRADE_ZONE" = "NO_TRADE_ZONE";
  if (
    topOpportunity &&
    topOpportunity.score >= 80 &&
    aiDecisionResult.decisionConfidence >= 75 &&
    strategyAlignmentResult.alignmentScore >= 70 &&
    topOpportunity.rrRatio >= 2.5
  ) {
    marketMode = "AGGRESSIVE";
  } else {
    marketMode = "NO_TRADE_ZONE";
  }

  // Populate Reasoning logs
  if (globalFiltersFailed) {
    if (isWaitDecision) reasoning.push("Defensive posture active: AI Decision Engine is waiting for clearer structural bounds.");
    if (isNoTradeDecision) reasoning.push("Execution locked: AI Decision Engine has flagged a NO_TRADE zone due to high risk.");
    if (isLowConfidence) reasoning.push(`Postponed: Decision confidence (${aiDecisionResult.decisionConfidence}%) is below 75% threshold.`);
    if (isWeakAlignment) reasoning.push(`Execution blocked: Structural alignment score (${strategyAlignmentResult.alignmentScore}) is weak.`);
    reasoning.push("All scanned setups routed to Rejected list due to global safety gates.");
  } else {
    reasoning.push(`Opportunity scanner initialized. Identified ${opportunities.length} high-probability institutional setups.`);
    if (topOpportunity) {
      reasoning.push(`Top opportunity: ${topOpportunity.name} with score of ${topOpportunity.score}%. Mode: ${marketMode}.`);
    } else {
      reasoning.push("No setups met the minimum institutional opportunity score (>75%). Preservation of capital recommended.");
    }
    if (rejectedSetups.length > 0) {
      reasoning.push(`Filtered out ${rejectedSetups.length} setup(s) due to localized score or configuration checks.`);
    }
  }

  // Legacy field calculation: overall opportunityScore
  let opportunityScore = 0;
  if (opportunities.length > 0) {
    const sum = opportunities.reduce((a, o) => a + o.score, 0);
    const avg = sum / opportunities.length;
    const criticalCount = opportunities.filter(o => o.priority === "CRITICAL").length;
    const highCount = opportunities.filter(o => o.priority === "HIGH").length;
    opportunityScore = Math.max(0, Math.min(100, Math.round(avg + criticalCount * 8 + highCount * 4)));
  }

  return {
    opportunities,
    topOpportunity,
    opportunityScore,
    timestamp: Date.now(),
    marketMode,
    reasoning,
    rejectedSetups,
  };
}

// ── UI Metadata ───────────────────────────────────────────────────────────────

export const OPP_TYPE_META: Record<OpportunityType, {
  label: string; color: string; bg: string; border: string;
}> = {
  AI_IGNITION:          { label: "AI EXECUTION",    color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/25" },
  RANGE_BREAKOUT:       { label: "15M BREAKOUT",    color: "text-sky-400",     bg: "bg-sky-500/12",     border: "border-sky-500/25"     },
  SMART_MONEY_TRAP:     { label: "TRAP REVERSAL",   color: "text-purple-400",  bg: "bg-purple-500/15",  border: "border-purple-500/25"  },
  OPTION_WALL_BOUNCE:   { label: "OPTION WALL BOUNCE", color: "text-amber-400", bg: "bg-amber-500/12",   border: "border-amber-500/25"   },
  HEAVYWEIGHT_IGNITION: { label: "HW ACCELERATION",  color: "text-pink-400",    bg: "bg-pink-500/12",    border: "border-pink-500/25"    },
};

export const OPP_PRIORITY_META: Record<OpportunityPriority, { color: string; bg: string; label: string; animate: boolean }> = {
  CRITICAL: { color: "text-red-400 border-red-500/30",     bg: "bg-red-500/15",     label: "CRITICAL ALPHA",   animate: true  },
  HIGH:     { color: "text-orange-400 border-orange-500/25", bg: "bg-orange-500/12",  label: "HIGH PROBABILITY", animate: false },
  MEDIUM:   { color: "text-sky-400 border-sky-500/20",       bg: "bg-sky-500/10",     label: "MODERATE EDGE",    animate: false },
  LOW:      { color: "text-slate-400 border-slate-700/20",   bg: "bg-slate-800/20",   label: "SPECULATIVE",      animate: false },
};
