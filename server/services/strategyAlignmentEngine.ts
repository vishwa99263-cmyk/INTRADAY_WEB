import type { BreakoutState } from "./breakoutEngine.js";
import type { MomentumStateResult } from "./momentumEngine.js";
import type { AIStrategySetup } from "./expiryStrategyEngine.js";
import type { SmartMoneySignal } from "./smartMoneyEngine.js";
import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { DailyBias } from "./positionStructureEngine.js";
import { marketState } from "../state/marketState.js";

export type AlignmentGrade = "FULL_ALIGNMENT" | "PARTIAL_ALIGNMENT" | "CONFLICTING" | "NO_SIGNAL";
export type TradeDirection = "BULLISH" | "BEARISH" | "NONE";

export interface StrategyAlignment {
  alignmentScore: number;           // 0-5: how many strategies agree (now 5 strategies)
  alignmentGrade: AlignmentGrade;
  dominantStrategy: string;         // Name of strongest confirming strategy
  tradeDirection: TradeDirection;
  strategiesAgreeing: string[];     // List of strategy names that agree
  strategiesConflicting: string[];  // List of strategy names that conflict
  noTradeFilter: boolean;           // True = system recommends NO TRADE
  noTradeReason: string;            // Reason for no-trade if applicable
  reasoning: string;                // Full explainability metadata
}

export function computeStrategyAlignment(
  breakout: BreakoutState,
  momentum: MomentumStateResult,
  expirySetup: AIStrategySetup,
  smartMoney: SmartMoneySignal,
  report: CompleteMarketReport,
  dailyBias: DailyBias | null = null,
): StrategyAlignment {
  const agreements: { strategy: string; direction: TradeDirection }[] = [];
  const conflicts: string[] = [];
  const reasonParts: string[] = [];

  // ── Strategy 1: Open Price Breakout ──────────────────────────────────────
  // IQ200 Fix: Relaxed trap threshold from 50% to 60% to capture more breakouts
  if (breakout.breakoutType === "BULLISH_BREAKOUT" && breakout.trapProbability < 60) {
    agreements.push({ strategy: "OPEN_PRICE_BREAKOUT", direction: "BULLISH" });
    reasonParts.push(`Breakout=BULLISH (trap=${breakout.trapProbability}%)`);
  } else if (breakout.breakoutType === "BEARISH_BREAKDOWN" && breakout.trapProbability < 60) {
    agreements.push({ strategy: "OPEN_PRICE_BREAKOUT", direction: "BEARISH" });
    reasonParts.push(`Breakout=BEARISH (trap=${breakout.trapProbability}%)`);
  } else if (breakout.trapProbability >= 70) {
    // Only flag as conflict if trap probability is very high (70%+, was 60%)
    conflicts.push("OPEN_PRICE_BREAKOUT (HIGH_TRAP)");
    reasonParts.push(`Breakout TRAPPED (prob=${breakout.trapProbability}%)`);
  }

  // ── Strategy 2: Expiry Day Momentum ──────────────────────────────────────
  // IQ200 Fix: Now accepts MODERATE_MOMENTUM (score 35+) not just STRONG_MOMENTUM
  // STRONG_MOMENTUM = full agreement, MODERATE_MOMENTUM = still agreement (just softer)
  const momentumIsActive =
    momentum.momentumLabel === "STRONG_MOMENTUM" ||
    momentum.momentumLabel === "NORMAL_MOMENTUM" ||  // IQ200 Fix: NORMAL also counts (was MODERATE)
    momentum.momentumScore >= 35;  // direct score fallback if label isn't granular

  if (expirySetup.signalType === "BUY_CE" && momentumIsActive) {
    agreements.push({ strategy: "EXPIRY_MOMENTUM", direction: "BULLISH" });
    reasonParts.push(`ExpiryMomentum=BUY_CE (score=${momentum.momentumScore}, label=${momentum.momentumLabel})`);
  } else if (expirySetup.signalType === "BUY_PE" && momentumIsActive) {
    agreements.push({ strategy: "EXPIRY_MOMENTUM", direction: "BEARISH" });
    reasonParts.push(`ExpiryMomentum=BUY_PE (score=${momentum.momentumScore}, label=${momentum.momentumLabel})`);
  } else if (expirySetup.signalType === "NO_TRADE_ZONE") {
    conflicts.push("EXPIRY_MOMENTUM (NO_TRADE)");
    reasonParts.push(`ExpiryMomentum=NO_TRADE`);
  } else {
    // Low momentum but not blocked — just neutral (don't add to conflicts)
    reasonParts.push(`ExpiryMomentum=LOW (score=${momentum.momentumScore})`);
  }

  // ── Strategy 3: Smart Money Follow ───────────────────────────────────────
  // IQ200 Fix: Lowered confidence threshold from 55% → 45%
  // Smart money rarely reaches 55% in normal markets
  if (smartMoney.direction === "BULLISH" && smartMoney.confidence >= 45) {
    agreements.push({ strategy: "SMART_MONEY_FOLLOW", direction: "BULLISH" });
    reasonParts.push(`SmartMoney=BULLISH (conf=${smartMoney.confidence}%, ${smartMoney.eventType})`);
  } else if (smartMoney.direction === "BEARISH" && smartMoney.confidence >= 45) {
    agreements.push({ strategy: "SMART_MONEY_FOLLOW", direction: "BEARISH" });
    reasonParts.push(`SmartMoney=BEARISH (conf=${smartMoney.confidence}%, ${smartMoney.eventType})`);
  } else if (smartMoney.direction === "NEUTRAL") {
    reasonParts.push(`SmartMoney=NEUTRAL (conf=${smartMoney.confidence}%)`);
  } else {
    // Direction exists but confidence low — still useful as directional hint
    reasonParts.push(`SmartMoney=${smartMoney.direction} LOW CONF (conf=${smartMoney.confidence}%)`);
  }

  // ── Strategy 4: Daily Structure Alignment ─────────────────────────────────
  // IQ200 Fix: Accept BULL/STRONG_BULL bias even with MIXED EMA alignment
  // Previously required BULLISH EMA — too strict, EMA is often MIXED intraday
  if (dailyBias) {
    const isBullBias = dailyBias.bias === "STRONG_BULL" || dailyBias.bias === "BULL";
    const isBearBias = dailyBias.bias === "STRONG_BEAR" || dailyBias.bias === "BEAR";
    const emaBullish = dailyBias.emaAlignment === "BULLISH" || dailyBias.emaAlignment === "MIXED";
    const emaBearish = dailyBias.emaAlignment === "BEARISH" || dailyBias.emaAlignment === "MIXED";

    if (isBullBias && emaBullish) {
      agreements.push({ strategy: "DAILY_STRUCTURE_ALIGNMENT", direction: "BULLISH" });
      reasonParts.push(`DailyStructure=${dailyBias.bias} (EMA=${dailyBias.emaAlignment}, Weekly=${dailyBias.weeklyTrend})`);
    } else if (isBearBias && emaBearish) {
      agreements.push({ strategy: "DAILY_STRUCTURE_ALIGNMENT", direction: "BEARISH" });
      reasonParts.push(`DailyStructure=${dailyBias.bias} (EMA=${dailyBias.emaAlignment}, Weekly=${dailyBias.weeklyTrend})`);
    } else if (dailyBias.bias === "NEUTRAL") {
      // Neutral is NOT a conflict — just no contribution
      reasonParts.push(`DailyStructure=NEUTRAL — no macro edge`);
    } else {
      reasonParts.push(`DailyStructure=${dailyBias.bias} (EMA=${dailyBias.emaAlignment}) — mixed, skipped`);
    }
  }

  // ── Strategy 5: MICRO TREND (NEW) ─────────────────────────────────────────
  // IQ200 Addition: 5th lightweight strategy based on immediate price + OI momentum
  // Fires when: PCR trending clearly OR trend alignment is confident BUY/SELL
  // This captures intraday momentum that other strategies might miss
  const pcrVal = report.oi?.pcr ?? 1.0;
  const trendAlign = report.trend?.alignment ?? "";
  const trendOverall = report.trend?.overall ?? "SIDEWAYS";

  if (trendAlign === "HIGH_CONFIDENCE_BUY" || (trendOverall === "BULLISH" && pcrVal >= 1.15)) {
    agreements.push({ strategy: "MICRO_TREND", direction: "BULLISH" });
    reasonParts.push(`MicroTrend=BULLISH (trend=${trendAlign}, PCR=${pcrVal.toFixed(2)})`);
  } else if (trendAlign === "HIGH_CONFIDENCE_SELL" || (trendOverall === "BEARISH" && pcrVal <= 0.85)) {
    agreements.push({ strategy: "MICRO_TREND", direction: "BEARISH" });
    reasonParts.push(`MicroTrend=BEARISH (trend=${trendAlign}, PCR=${pcrVal.toFixed(2)})`);
  } else {
    reasonParts.push(`MicroTrend=NEUTRAL (trend=${trendOverall}, PCR=${pcrVal.toFixed(2)})`);
  }

  // ── Count agreements per direction ───────────────────────────────────────
  const bullishAgreements = agreements.filter(a => a.direction === "BULLISH");
  const bearishAgreements = agreements.filter(a => a.direction === "BEARISH");

  const hasConflictingDirections = bullishAgreements.length > 0 && bearishAgreements.length > 0;

  let dominantDirection: TradeDirection = "NONE";
  let dominantStrategy = "NONE";
  let dominantAgreements: typeof agreements = [];

  if (bullishAgreements.length > bearishAgreements.length) {
    dominantDirection = "BULLISH";
    dominantAgreements = bullishAgreements;
  } else if (bearishAgreements.length > bullishAgreements.length) {
    dominantDirection = "BEARISH";
    dominantAgreements = bearishAgreements;
  } else if (bullishAgreements.length > 0 && bearishAgreements.length > 0) {
    // Tie: use momentum direction as tiebreaker
    if (momentum.direction === "UP") {
      dominantDirection = "BULLISH";
      dominantAgreements = bullishAgreements;
    } else if (momentum.direction === "DOWN") {
      dominantDirection = "BEARISH";
      dominantAgreements = bearishAgreements;
    }
  }

  if (dominantAgreements.length > 0) {
    // Priority: SMART_MONEY > DAILY_STRUCTURE_ALIGNMENT > OPEN_PRICE_BREAKOUT > EXPIRY_MOMENTUM > MICRO_TREND
    const priorities = ["SMART_MONEY_FOLLOW", "DAILY_STRUCTURE_ALIGNMENT", "OPEN_PRICE_BREAKOUT", "EXPIRY_MOMENTUM", "MICRO_TREND"];
    for (const p of priorities) {
      if (dominantAgreements.find(a => a.strategy === p)) {
        dominantStrategy = p; break;
      }
    }
  }

  const alignmentScore = dominantAgreements.length;

  let alignmentGrade: AlignmentGrade;
  // Updated for 5-strategy system (0-5 score)
  if (alignmentScore >= 4)      alignmentGrade = "FULL_ALIGNMENT";    // 4-5 strategies agree
  else if (alignmentScore >= 3) alignmentGrade = "FULL_ALIGNMENT";    // 3/5 = strong consensus
  else if (alignmentScore === 2) alignmentGrade = "PARTIAL_ALIGNMENT";
  else if (hasConflictingDirections) alignmentGrade = "CONFLICTING";
  else alignmentGrade = "NO_SIGNAL";

  // ── No-Trade Filters ─────────────────────────────────────────────────────
  let noTradeFilter = false;
  let noTradeReason = "";

  // IQ200 Fix: minAgreements = 1 (was 1, but now 5 strategies so MUCH easier to get 1)
  // MOMENTUM OVERRIDE: if momentum is directional (score != 50), bypass alignment block
  const hasMomentumOverride =
    momentum.direction === "UP" ||
    momentum.direction === "DOWN" ||
    momentum.momentumScore > 55 ||
    momentum.momentumScore < 45;

  const minAgreements = 1;
  if (alignmentScore < minAgreements) {
    if (hasMomentumOverride) {
      // Momentum override: don't block even if no strategies agree
      // Let the Antigravity score decide
      reasonParts.push(`MomentumOverride: bypassed alignment gate (mom=${momentum.momentumScore}, dir=${momentum.direction})`);
    } else {
      noTradeFilter = true;
      noTradeReason = `Only ${alignmentScore}/5 strategies confirmed. Need ≥${minAgreements} for trade.`;
    }
  }

  // Rule 2: If conflicting AND very weak consensus AND no momentum override
  if (hasConflictingDirections && alignmentScore < 2 && !hasMomentumOverride) {
    noTradeFilter = true;
    noTradeReason = "Conflicting signals across strategies with no momentum clarity. WAIT.";
  }

  // Rule 3: Market slow + no volume (only block in non-simulating mode when truly dead)
  if (!marketState.isSimulating &&
      report.speed.marketState === "SLOW_MARKET" &&
      !report.volume.hasMajorCeSpike &&
      !report.volume.hasMajorPeSpike &&
      alignmentScore < 1 &&
      !hasMomentumOverride) {
    noTradeFilter = true;
    noTradeReason = noTradeReason || "Slow market + no volume + no momentum. Avoid premium decay trap.";
  }

  return {
    alignmentScore,
    alignmentGrade,
    dominantStrategy,
    tradeDirection: noTradeFilter ? "NONE" : dominantDirection,
    strategiesAgreeing: dominantAgreements.map(a => a.strategy),
    strategiesConflicting: conflicts,
    noTradeFilter,
    noTradeReason,
    reasoning: reasonParts.join(" | "),
  };
}
// IQ200 v2.0: 5-strategy system
// Priority: SMART_MONEY > DAILY_STRUCTURE_ALIGNMENT > OPEN_PRICE_BREAKOUT > EXPIRY_MOMENTUM > MICRO_TREND
// MICRO_TREND is a new lightweight strategy using PCR + trend alignment
// Momentum override bypasses alignment gate when direction is clear
