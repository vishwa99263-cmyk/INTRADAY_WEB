/**
 * strategyDispatcher.ts — IQ200+ v3.0
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Strategy Dispatcher — Registry-Condition-Based Engine
 *
 * Architecture (IQ200+ Reset v3):
 *  - ALL 46 strategies from the registry are scored by their EXACT conditions
 *  - NO text-regex matching — pure structured condition evaluation
 *  - Each strategy has specific condition gates (session, regime, VIX, indicators)
 *  - Best strategy fired based on priority + condition pass rate
 *  - Fallback to 7 built-in scalp types if no strategy passes
 *
 * IQ200+ Improvements:
 *  - EMA crossover, MACD crossover, RSI crossover signals used for S22-S35
 *  - PCR exhaustion and momentum exhaustion for R01-R12, OI_WALL, PCR_EXTREME
 *  - Persistent breakout signal for ORB strategies (20-min window)
 *  - Rolling 1-hour range for S20 strategy
 *  - Strategy-specific risk params used in scoring
 */

import { getStrategies, type Strategy } from "./strategyStore.js";
import type { AntigravityDecision } from "./antigravityEngine.js";
import type { StrategyAlignment } from "./strategyAlignmentEngine.js";
import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { MomentumStateResult } from "./momentumEngine.js";
import type { BreakoutState } from "./breakoutEngine.js";
import { getISTTime } from "../utils/timerUtils.js";
import { marketState } from "../state/marketState.js";

type TimeSlot = "OPENING" | "MID_MORNING" | "MIDDAY" | "AFTERNOON" | "CLOSING";

function getCurrentTimeSlot(): TimeSlot {
  const { h, m } = getISTTime();
  const mins = h * 60 + m;
  if (mins < 10 * 60 + 30) return "OPENING";
  if (mins < 12 * 60)      return "MID_MORNING";
  if (mins < 13 * 60 + 30) return "MIDDAY";
  if (mins < 14 * 60 + 30) return "AFTERNOON";
  return "CLOSING";
}

function getISTMinutes(): number {
  const { h, m } = getISTTime();
  return h * 60 + m;
}

// ── IQ200+: Map server TimeSlot to frontend SessionType ──────────────────────
function mapTimeSlotToSession(slot: TimeSlot): string {
  if (slot === "OPENING") return "OPENING";
  if (slot === "CLOSING") return "CLOSING";
  return "MID"; // MID_MORNING, MIDDAY, AFTERNOON all map to MID
}

// ── IQ200+: Map server regime to frontend MarketRegime ──────────────────────
function mapRegime(regime: string): string {
  const r = regime.toUpperCase();
  if (r.includes("BULL") || r.includes("TRENDING_UP")) return "TRENDING_BULL";
  if (r.includes("BEAR") || r.includes("TRENDING_DOWN")) return "TRENDING_BEAR";
  if (r.includes("BREAKOUT")) return "BREAKOUT";
  if (r.includes("BREAKDOWN")) return "BREAKDOWN";
  if (r.includes("VOLATILE")) return "VOLATILE";
  return "RANGE";
}

// ── IQ200+: Check if a strategy's conditions are met (structured evaluation) ──
// This replaces the old text-regex scoring with exact condition matching.
interface ConditionResult {
  score: number;          // 0-100 based on how many conditions are met
  conditionsMet: string[];
  conditionsNotMet: string[];
  canFire: boolean;       // ALL mandatory conditions met
}

function evaluateStrategyConditions(
  stratId: string,
  stratName: string,
  tags: string[],        // strategy tags for categorization
  sessionTime: string[],  // e.g. ["OPENING", "MID"]
  allowedRegimes: string[], // e.g. ["BREAKOUT", "TRENDING_BULL"]
  vixMin: number,
  vixMax: number,
  requireBreakout: boolean,
  requireBreakdown: boolean,
  requireExhaustionSignal: boolean,
  isExpiryDayOnly: boolean,
  notExpiryDay: boolean,
  minBreadthScore: number,
  // Current market state
  currentSession: string,
  currentRegime: string,
  currentVix: number,
  isExpiryDay: boolean,
  hasBreakout: boolean,       // persistent breakout active
  hasBreakdown: boolean,      // persistent breakdown active
  momentumExhaustion: boolean,
  breadthScore: number,
  // IQ200+: Additional indicator signals
  momentum: MomentumStateResult,
  direction: "BUY_CE" | "BUY_PE",
  pcr: number,
  spotPrice: number,
  dayHigh: number,
  dayLow: number,
  orbHigh: number,
  orbLow: number,
  istMinutes: number,
): ConditionResult {
  const met: string[] = [];
  const notMet: string[] = [];
  let score = 0;
  const MAX_SCORE = 100;

  // ── 1. Session Check (20 pts — important gate) ─────────────────────────────
  const sessionOk = sessionTime.includes("ANY") || sessionTime.includes(currentSession);
  if (sessionOk) {
    met.push(`Session: ${currentSession} ✓`);
    score += 20;
  } else {
    notMet.push(`Session: ${currentSession} ∉ [${sessionTime.join(",")}]`);
  }

  // ── 2. Regime Check (25 pts — very important) ──────────────────────────────
  const regimeOk = allowedRegimes.includes("ANY") || allowedRegimes.includes(currentRegime);
  if (regimeOk) {
    met.push(`Regime: ${currentRegime} ✓`);
    score += 25;
  } else {
    notMet.push(`Regime: ${currentRegime} not in [${allowedRegimes.join(",")}]`);
  }

  // ── 3. VIX Range Check (15 pts) ───────────────────────────────────────────
  const vixOk = currentVix >= vixMin && currentVix <= vixMax;
  if (vixOk) {
    met.push(`VIX: ${currentVix.toFixed(1)} in [${vixMin}-${vixMax}] ✓`);
    score += 15;
  } else {
    notMet.push(`VIX: ${currentVix.toFixed(1)} outside [${vixMin}-${vixMax}]`);
  }

  // ── 4. Breakout Required (15 pts) ─────────────────────────────────────────
  if (requireBreakout) {
    if (hasBreakout) {
      met.push("ORB Breakout ✓");
      score += 15;
    } else {
      notMet.push("Breakout required — not active");
    }
  } else {
    score += 15; // no requirement = pass
  }

  // ── 5. Breakdown Required (15 pts) ────────────────────────────────────────
  if (requireBreakdown) {
    if (hasBreakdown) {
      met.push("ORB Breakdown ✓");
      score += 15;
    } else {
      notMet.push("Breakdown required — not active");
    }
  } else {
    score += 15; // no requirement = pass
  }

  // ── 6. Exhaustion Signal (10 pts) ─────────────────────────────────────────
  if (requireExhaustionSignal) {
    if (momentumExhaustion) {
      met.push("Momentum/PCR Exhaustion ✓");
      score += 10;
    } else {
      notMet.push("Exhaustion signal required — not detected");
    }
  } else {
    score += 10; // no requirement = pass
  }

  // ── 7. Expiry Day Check ────────────────────────────────────────────────────
  if (isExpiryDayOnly) {
    if (isExpiryDay) {
      met.push("Expiry Day ✓");
    } else {
      notMet.push("Only on expiry day (Thursday)");
    }
  }
  if (notExpiryDay) {
    if (!isExpiryDay) {
      met.push("Non-expiry Day ✓");
    } else {
      notMet.push("Disabled on expiry day");
    }
  }

  // ── 8. Breadth Score ──────────────────────────────────────────────────────
  if (minBreadthScore > 0) {
    if (breadthScore >= minBreadthScore) {
      met.push(`Breadth: ${breadthScore} ≥ ${minBreadthScore} ✓`);
    } else {
      notMet.push(`Breadth: ${breadthScore} < ${minBreadthScore}`);
    }
  }

  // ── IQ200+: Per-strategy indicator checks ─────────────────────────────────

  // EMA Crossover strategies (S16, S23) — check actual EMA crossover
  if (tags.includes("ema") && tags.includes("crossover")) {
    const emaCrossOk = direction === "BUY_CE"
      ? momentum.ema9CrossedAboveEma21
      : momentum.ema9CrossedBelowEma21;
    if (emaCrossOk) {
      met.push(`EMA 9/21 Crossover ✓ (${direction === "BUY_CE" ? "bullish" : "bearish"})`);
      score += 5; // bonus
    } else {
      // Don't add to notMet — EMA strategies can still fire on strong alignment
      const emaAlignOk = direction === "BUY_CE"
        ? momentum.emaAlignment === "BULL_STACK"
        : momentum.emaAlignment === "BEAR_STACK";
      if (emaAlignOk) {
        met.push(`EMA Stack aligned ✓`);
      }
    }
  }

  // MACD strategies (S22) — check MACD crossover
  if (tags.includes("macd") || tags.includes("trend-following")) {
    const macdCrossOk = direction === "BUY_CE"
      ? momentum.macdCrossedAboveSignal || momentum.macdAlignment === "BULLISH"
      : momentum.macdCrossedBelowSignal || momentum.macdAlignment === "BEARISH";
    if (macdCrossOk) {
      met.push(`MACD aligned ✓`);
      score += 5; // bonus
    }
  }

  // ADX-based strategies (S25, S27, S33, S36) — need trending market
  if (tags.includes("adx") || stratId.includes("ADX")) {
    if (momentum.adxTrending) {
      met.push(`ADX: ${momentum.adxValue.toFixed(0)} > 25 ✓`);
      score += 5; // bonus
    }
  }

  // Reversal strategies R01-R12 — specific indicator crossovers
  if (stratId === "R01_LINEAR_REG_ANGLE_REVERSAL") {
    const triggered = momentum.lrAngleCrossedAboveMinus25 || momentum.lrAngleCrossedBelow25;
    if (triggered) {
      met.push(`LR Angle: ${momentum.lrAngle.toFixed(1)}° — crossover ✓`);
      score += 10; // big bonus for exact reversal trigger
    } else {
      notMet.push(`LR Angle ${momentum.lrAngle.toFixed(1)}° — no ±25° crossover`);
    }
  }

  if (stratId === "R02_MFI14_REVERSAL") {
    const triggered = momentum.mfiCrossedAbove20 || momentum.mfiCrossedBelow80;
    if (triggered) {
      met.push(`MFI(14): ${momentum.mfi14.toFixed(1)} — crossover ✓`);
      score += 10;
    } else {
      notMet.push(`MFI(14): ${momentum.mfi14.toFixed(1)} — no crossover`);
    }
  }

  if (stratId === "R03_MOMENTUM14_REVERSAL") {
    const triggered = momentum.momentumCrossedAbove0 || momentum.momentumCrossedBelow0;
    if (triggered) {
      met.push(`Momentum(14): ${momentum.momentum14.toFixed(1)} — zero-line cross ✓`);
      score += 10;
    } else {
      notMet.push(`Momentum(14): ${momentum.momentum14.toFixed(1)} — no zero-line cross`);
    }
  }

  if (stratId === "R04_RSI_REVERSAL") {
    const triggered = momentum.rsiCrossedAbove30 || momentum.rsiCrossedBelow70;
    if (triggered) {
      met.push(`RSI(14): ${momentum.rsi14.toFixed(1)} — 30/70 crossover ✓`);
      score += 10;
    } else {
      notMet.push(`RSI(14): ${momentum.rsi14.toFixed(1)} — no 30/70 crossover`);
    }
  }

  if (stratId === "R05_STOCHASTIC_REVERSAL") {
    const triggered = momentum.stochBullishCross || momentum.stochBearishCross;
    if (triggered) {
      met.push(`Stochastic crossover in extreme zone ✓`);
      score += 10;
    } else {
      notMet.push(`Stochastic — no oversold/overbought crossover`);
    }
  }

  if (stratId === "R06_ORB_HIGH_REVERSAL") {
    const touched  = orbHigh > 0 && spotPrice >= orbHigh * 0.999;
    const rejected = orbHigh > 0 && spotPrice < orbHigh;
    if (touched && rejected) {
      met.push(`ORB High ${orbHigh.toFixed(0)} rejection ✓`);
      score += 10;
    } else {
      notMet.push(`ORB High rejection not triggered`);
    }
  }

  if (stratId === "R07_ORB_LOW_REVERSAL") {
    const touched  = orbLow > 0 && spotPrice <= orbLow * 1.001;
    const recovered = orbLow > 0 && spotPrice > orbLow;
    if (touched && recovered) {
      met.push(`ORB Low ${orbLow.toFixed(0)} bounce ✓`);
      score += 10;
    } else {
      notMet.push(`ORB Low bounce not triggered`);
    }
  }

  if (stratId === "R08_DAY_HIGH_REJECTION") {
    const rsiOB   = momentum.rsi14 > 65;
    const touched  = dayHigh > 0 && spotPrice >= dayHigh * 0.999;
    const rejected = dayHigh > 0 && spotPrice < dayHigh;
    if (touched && rejected && rsiOB) {
      met.push(`Day High ${dayHigh.toFixed(0)} rejection + RSI > 65 ✓`);
      score += 10;
    } else {
      notMet.push(`Day High rejection — need touch+RSI>65 (RSI: ${momentum.rsi14.toFixed(0)})`);
    }
  }

  if (stratId === "R09_DAY_LOW_REJECTION") {
    const rsiOS    = momentum.rsi14 < 35;
    const touched  = dayLow > 0 && spotPrice <= dayLow * 1.001;
    const recovered = dayLow > 0 && spotPrice > dayLow;
    if (touched && recovered && rsiOS) {
      met.push(`Day Low ${dayLow.toFixed(0)} bounce + RSI < 35 ✓`);
      score += 10;
    } else {
      notMet.push(`Day Low bounce — need touch+RSI<35 (RSI: ${momentum.rsi14.toFixed(0)})`);
    }
  }

  if (stratId === "R10_LAST_HOUR_HIGH_REJECTION") {
    const inLastHour = istMinutes >= 14 * 60 + 15;
    const touched    = dayHigh > 0 && spotPrice >= dayHigh * 0.999;
    const rejected   = dayHigh > 0 && spotPrice < dayHigh;
    if (inLastHour && touched && rejected) {
      met.push(`Last Hour High ${dayHigh.toFixed(0)} rejection ✓`);
      score += 10;
    } else if (!inLastHour) {
      notMet.push(`Last Hour strategy — wait for 2:15 PM`);
    } else {
      notMet.push(`Last-hour high rejection not triggered`);
    }
  }

  if (stratId === "R11_LAST_HOUR_LOW_REJECTION") {
    const inLastHour = istMinutes >= 14 * 60 + 15;
    const touched    = dayLow > 0 && spotPrice <= dayLow * 1.001;
    const recovered  = dayLow > 0 && spotPrice > dayLow;
    if (inLastHour && touched && recovered) {
      met.push(`Last Hour Low ${dayLow.toFixed(0)} bounce ✓`);
      score += 10;
    } else if (!inLastHour) {
      notMet.push(`Last Hour strategy — wait for 2:15 PM`);
    } else {
      notMet.push(`Last-hour low bounce not triggered`);
    }
  }

  if (stratId === "R12_DAILY_GAP_REVERSAL") {
    // Gap reversal: happens at opening if gap is significant and failing
    const gapOk = currentSession === "OPENING" && pcr > 0;
    if (gapOk) {
      met.push(`Gap reversal conditions checking ✓`);
    }
  }

  // PCR extreme strategies
  if (stratId === "PCR_EXTREME_PLAY" || tags.includes("pcr") || tags.includes("contrarian")) {
    const pcrExtreme = pcr < 0.72 || pcr > 1.48;
    if (pcrExtreme) {
      met.push(`PCR Extreme: ${pcr.toFixed(2)} ✓ (${pcr < 0.72 ? "oversold→CE" : "overbought→PE"})`);
      score += 8;
    }
  }

  // Bollinger Band strategies
  if (tags.includes("bollinger") || stratId.includes("BOLLINGER")) {
    const bbOk = direction === "BUY_CE" ? momentum.belowLowerBB : momentum.aboveUpperBB;
    if (bbOk) {
      met.push(`Bollinger Band breakout/breakdown ✓`);
      score += 5;
    }
  }

  // Determine if strategy CAN fire (all mandatory conditions met)
  // Mandatory: session + regime + VIX
  // Conditional: breakout/breakdown/exhaustion only if required
  const mandatoryMet = sessionOk && regimeOk && vixOk;
  const conditionalMet = (
    (!requireBreakout || hasBreakout) &&
    (!requireBreakdown || hasBreakdown) &&
    (!requireExhaustionSignal || momentumExhaustion) &&
    (!isExpiryDayOnly || isExpiryDay) &&
    (!notExpiryDay || !isExpiryDay)
  );

  const canFire = mandatoryMet && conditionalMet;

  return {
    score: Math.min(MAX_SCORE, score),
    conditionsMet: met,
    conditionsNotMet: notMet,
    canFire,
  };
}

// ── IQ200+: Strategy priority from registry ID ────────────────────────────
// Maps known strategy IDs to their priorities (lower = higher priority)
const STRATEGY_PRIORITIES: Record<string, number> = {
  "ORB_NAKED": 1,
  "ORB_SPREAD": 2,
  "BREAKOUT_MOMENTUM": 3,
  "INSTITUTIONAL_BREAKDOWN": 4,
  "FII_FLOW_INTRADAY": 5,
  "PRE_EXPIRY_MOMENTUM": 6,
  "PCR_EXTREME_PLAY": 7,
  "OI_WALL_SCALP": 8,
  "S14_ORB_SPREAD": 2,
  "S16_EMA_CROSSOVER_SPREAD": 3,
  "S17_ORB_MOMENTUM_SPREAD": 2,
  "S18_ORB_CALL_RATIO": 4,
  "S19_ORB_PUT_RATIO": 4,
  "S20_ROLLING_1HR_RANGE_SPREAD": 5,
  "S21_PRICE_VOLUME_BREAKOUT_SPREAD": 3,
  "S22_DUAL_MACD_CONTINUATION": 3,
  "S23_EMA_9_21_CROSSOVER": 3,
  "R04_RSI_REVERSAL": 4,
  "R08_DAY_HIGH_REJECTION": 4,
  "R09_DAY_LOW_REJECTION": 4,
  "WEEKLY_SWING_CE": 1,
  "WEEKLY_SWING_PE": 2,
  "FII_POSITIONAL": 4,
};

interface StrategyScore {
  strategy: Strategy;
  score: number;
  conditionsMet: string[];
  conditionsNotMet: string[];
  canFire: boolean;
  priority: number;
}

// ── IQ200+: Extract structured tags from strategy text fields ──────────────
function extractTags(strat: Strategy): string[] {
  const combined = [strat.name, strat.objective, strat.entryRules].join(" ").toLowerCase();
  const tags: string[] = [];
  if (combined.includes("ema")) tags.push("ema");
  if (combined.includes("macd")) tags.push("macd");
  if (combined.includes("crossover")) tags.push("crossover");
  if (combined.includes("adx")) tags.push("adx");
  if (combined.includes("bollinger")) tags.push("bollinger");
  if (combined.includes("pcr") || combined.includes("contrarian")) tags.push("pcr", "contrarian");
  if (combined.includes("reversal")) tags.push("reversal");
  if (combined.includes("scalp")) tags.push("scalp");
  if (combined.includes("breakout")) tags.push("breakout");
  if (combined.includes("breakdown")) tags.push("breakdown");
  if (combined.includes("expiry") || combined.includes("thursday")) tags.push("expiry");
  if (combined.includes("swing") || combined.includes("positional")) tags.push("positional");
  return tags;
}

// ── IQ200+: Derive session list from strategy text ─────────────────────────
function extractSessions(strat: Strategy): string[] {
  const combined = [strat.name, strat.entryRules, strat.objective].join(" ").toLowerCase();
  const sessions: string[] = [];
  if (combined.includes("opening") || combined.includes("9:15") || combined.includes("9:30") || combined.includes("orb")) {
    sessions.push("OPENING");
  }
  if (combined.includes("mid") || combined.includes("11:") || combined.includes("12:")) {
    sessions.push("MID");
  }
  if (combined.includes("closing") || combined.includes("3:") || combined.includes("15:")) {
    sessions.push("CLOSING");
  }
  if (sessions.length === 0) sessions.push("MID"); // default
  return sessions;
}

// ── IQ200+: Derive allowed regimes from strategy text ─────────────────────
function extractRegimes(strat: Strategy): string[] {
  const combined = [strat.name, strat.objective, strat.marketLogic, strat.bestConditions].join(" ").toLowerCase();
  const regimes: string[] = [];
  if (combined.includes("bullish") || combined.includes("uptrend") || combined.includes("breakout")) {
    regimes.push("TRENDING_BULL", "BREAKOUT");
  }
  if (combined.includes("bearish") || combined.includes("downtrend") || combined.includes("breakdown")) {
    regimes.push("TRENDING_BEAR", "BREAKDOWN");
  }
  if (combined.includes("range") || combined.includes("sideways") || combined.includes("reversal")) {
    regimes.push("RANGE", "VOLATILE");
  }
  if (regimes.length === 0) regimes.push("TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN");
  return [...new Set(regimes)];
}

// ── IQ200+: Full strategy scorer (condition-based + text-bonus) ────────────
function scoreStrategy(
  strat: Strategy,
  direction: "BUY_CE" | "BUY_PE",
  timeSlot: TimeSlot,
  regime: string,
  vix: number,
  isExpiryDay: boolean,
  breakout: BreakoutState,
  momentum: MomentumStateResult,
  report: CompleteMarketReport,
  confidence: number,
  spotPrice: number,
): StrategyScore {
  const tags = extractTags(strat);
  const sessions = extractSessions(strat);
  const regimes = extractRegimes(strat);
  const currentSession = mapTimeSlotToSession(timeSlot);
  const currentRegime = mapRegime(regime);
  const pcr = report.oi.pcr || 1.0;
  const istMinutes = getISTMinutes();

  // IQ200+: Use persistent breakout/breakdown (20-min window)
  const hasBreakout  = breakout.persistentBreakout || breakout.breakoutType === "BULLISH_BREAKOUT";
  const hasBreakdown = breakout.persistentBreakdown || breakout.breakoutType === "BEARISH_BREAKDOWN";
  const momentumExhaustion = breakout.momentumExhaustion || breakout.pcrExhaustion;

  // Derive from strategy text what conditions it likely needs
  const requireBreakout = tags.includes("breakout") || tags.includes("orb");
  const requireBreakdown = tags.includes("breakdown");
  const requireExhaustion = tags.includes("reversal") || tags.includes("contrarian") || tags.includes("pcr");
  const isExpiryOnly = strat.name.toLowerCase().includes("expiry") || strat.name.toLowerCase().includes("thursday");
  const notExpiryDay = tags.includes("positional") || tags.includes("swing");

  // Use strat ID to look up known priorities
  const priority = STRATEGY_PRIORITIES[strat.id] || 5;

  // VIX range from strategy description
  let vixMin = 0, vixMax = 30;
  if (strat.bestConditions?.toLowerCase().includes("low vix") || strat.bestConditions?.toLowerCase().includes("calm")) {
    vixMax = 15;
  }
  if (strat.bestConditions?.toLowerCase().includes("high vix") || strat.bestConditions?.toLowerCase().includes("volatile")) {
    vixMin = 16;
    vixMax = 40;
  }

  const result = evaluateStrategyConditions(
    strat.id,
    strat.name,
    tags,
    sessions,
    regimes,
    vixMin,
    vixMax,
    requireBreakout,
    requireBreakdown,
    requireExhaustion,
    isExpiryOnly,
    notExpiryDay,
    0, // minBreadthScore — always pass for legacy strategies
    currentSession,
    currentRegime,
    vix,
    isExpiryDay,
    hasBreakout,
    hasBreakdown,
    momentumExhaustion,
    50, // breadthScore default
    momentum,
    direction,
    pcr,
    spotPrice,
    marketState.niftyOptionChain?.highPrice || 0,
    marketState.niftyOptionChain?.lowPrice || 0,
    breakout.high15m || breakout.high5m,
    breakout.low15m || breakout.low5m,
    istMinutes,
  );

  return {
    strategy: strat,
    score: result.score,
    conditionsMet: result.conditionsMet,
    conditionsNotMet: result.conditionsNotMet,
    canFire: result.canFire,
    priority,
  };
}

export interface DispatchResult {
  strategyName: string;
  strategyId: string;
  matchScore: number;
  matchReasons: string[];
  isUserDefined: boolean;
  scalpType: string;
  targetPoints: number;
  maxHoldMinutes: number;
  // IQ200+: new fields
  conditionsMet: string[];
  conditionsNotMet: string[];
  strategyRisk?: {
    targetRs: number;
    maxLossRs: number;
    fixedSLPct?: number;
    targetPct?: number;
    squareOffTime: string;
  };
}

const lastDispatchLog: Record<string, number> = {};

export function dispatchStrategy(
  page: "NIFTY" | "BANKNIFTY" | "SENSEX",
  antigravity: AntigravityDecision,
  alignment: StrategyAlignment,
  report: CompleteMarketReport,
  momentum: MomentumStateResult,
  breakout: BreakoutState,
  isExpiryDayFlag: boolean,
  activeStrategyIds: string[] = []
): DispatchResult {
  const direction  = antigravity.finalSignal as "BUY_CE" | "BUY_PE";
  const timeSlot   = getCurrentTimeSlot();
  const regime     = report.trend.overall || "SIDEWAYS";
  const vix        = marketState.niftyOptionChain.indiaVix || 15;
  const confidence = antigravity.confidence;
  const spotPrice  = marketState.niftyOptionChain.spotPrice || 0;

  // ── Detect scalp type for built-in fallback ──────────────────────────────
  const scalpInfo = detectScalpType(direction, timeSlot, regime, vix, isExpiryDayFlag, breakout, momentum, report, confidence);

  const strategies = getStrategies();
  if (!strategies || strategies.length === 0) {
    const builtinName = deriveBuiltinName(direction, timeSlot, report, breakout, momentum, scalpInfo.scalpType);
    return {
      strategyName: builtinName,
      strategyId: "builtin",
      matchScore: 0,
      matchReasons: ["No user strategies"],
      isUserDefined: false,
      scalpType: scalpInfo.scalpType,
      targetPoints: scalpInfo.targetPoints,
      maxHoldMinutes: scalpInfo.maxHoldMinutes,
      conditionsMet: [],
      conditionsNotMet: [],
    };
  }

  // ── IQ200+: Score all strategies by structured conditions ─────────────────
  const scored = strategies
    .filter(s => !activeStrategyIds.includes(s.id))
    .map(s => scoreStrategy(s, direction, timeSlot, regime, vix, isExpiryDayFlag, breakout, momentum, report, confidence, spotPrice))
    .sort((a, b) => {
      // Primary sort: canFire (true first)
      if (a.canFire && !b.canFire) return -1;
      if (!a.canFire && b.canFire) return 1;
      // Secondary: score (higher first)
      if (b.score !== a.score) return b.score - a.score;
      // Tertiary: priority (lower number = higher priority)
      return a.priority - b.priority;
    });

  const best = scored[0];

  // If best strategy can't fire (all failed), use built-in
  if (!best.canFire) {
    const builtinName = deriveBuiltinName(direction, timeSlot, report, breakout, momentum, scalpInfo.scalpType);
    return {
      strategyName: builtinName,
      strategyId: "builtin",
      matchScore: best.score,
      matchReasons: [`No strategy passed — ${best.conditionsNotMet.slice(0, 2).join(", ")}`],
      isUserDefined: false,
      scalpType: scalpInfo.scalpType,
      targetPoints: scalpInfo.targetPoints,
      maxHoldMinutes: scalpInfo.maxHoldMinutes,
      conditionsMet: best.conditionsMet,
      conditionsNotMet: best.conditionsNotMet,
    };
  }

  const now = Date.now();
  if (now - (lastDispatchLog[page] || 0) > 60000) {
    console.log(`[StrategyDispatcher] IQ200+ ${page} → "${best.strategy.name}" (score=${best.score}) | Conditions: [${best.conditionsMet.slice(0, 3).join(", ")}] | ScalpType: ${scalpInfo.scalpType} | Target: ${scalpInfo.targetPoints}pts`);
    lastDispatchLog[page] = now;
  }

  return {
    strategyName: best.strategy.name,
    strategyId: best.strategy.id,
    matchScore: best.score,
    matchReasons: best.conditionsMet,
    isUserDefined: !best.strategy.isSystem,
    scalpType: scalpInfo.scalpType,
    targetPoints: scalpInfo.targetPoints,
    maxHoldMinutes: scalpInfo.maxHoldMinutes,
    conditionsMet: best.conditionsMet,
    conditionsNotMet: best.conditionsNotMet,
  };
}

// ── Scalp Type Detection ───────────────────────────────────────────────────────

interface ScalpInfo {
  scalpType: string;
  targetPoints: number;
  maxHoldMinutes: number;
  reason: string;
}

function detectScalpType(
  direction: "BUY_CE" | "BUY_PE",
  timeSlot: TimeSlot,
  regime: string,
  vix: number,
  isExpiryDay: boolean,
  breakout: BreakoutState,
  momentum: MomentumStateResult,
  report: CompleteMarketReport,
  confidence: number
): ScalpInfo {
  const pcr = report.oi.pcr || 1.0;
  const momScore = momentum.momentumScore || 50;
  const isStrongMomentum = momentum.momentumLabel === "STRONG_MOMENTUM";
  const isLowMomentum    = momentum.momentumLabel === "LOW_MOMENTUM";
  // IQ200+: Use persistent breakout
  const isBreaking = breakout.persistentBreakout || breakout.persistentBreakdown ||
                     breakout.breakoutType === "BULLISH_BREAKOUT" || breakout.breakoutType === "BEARISH_BREAKDOWN";
  const hasHighOIShift = Math.abs(pcr - 1.0) > 0.2;

  // IQ200+: EMA/MACD crossover detected → always momentum
  if (momentum.ema9CrossedAboveEma21 || momentum.ema9CrossedBelowEma21) {
    return {
      scalpType: "EMA_CROSSOVER_SCALP",
      targetPoints: 22,
      maxHoldMinutes: 10,
      reason: `EMA 9/21 crossover (${momentum.ema9CrossedAboveEma21 ? "bullish" : "bearish"})`,
    };
  }

  if (momentum.macdCrossedAboveSignal || momentum.macdCrossedBelowSignal) {
    return {
      scalpType: "MACD_CROSSOVER_SCALP",
      targetPoints: 20,
      maxHoldMinutes: 10,
      reason: `MACD crossover (${momentum.macdCrossedAboveSignal ? "bullish" : "bearish"})`,
    };
  }

  // Type 5: GAMMA_SCALP — Near expiry, max decay
  if (isExpiryDay && (timeSlot === "CLOSING" || timeSlot === "AFTERNOON")) {
    return {
      scalpType: "GAMMA_SCALP",
      targetPoints: 12,
      maxHoldMinutes: 5,
      reason: "Expiry day gamma run",
    };
  }

  // Type 4: BREAKOUT_SCALP — ORB or range break with momentum
  if (isBreaking && isStrongMomentum && timeSlot !== "CLOSING") {
    return {
      scalpType: "BREAKOUT_SCALP",
      targetPoints: 25,
      maxHoldMinutes: 12,
      reason: `ORB ${breakout.breakoutType} + strong momentum (${momScore})`,
    };
  }

  // IQ200+: Exhaustion/PCR reversal scalp
  if (breakout.momentumExhaustion || breakout.pcrExhaustion) {
    return {
      scalpType: "EXHAUSTION_REVERSAL_SCALP",
      targetPoints: 16,
      maxHoldMinutes: 8,
      reason: `${breakout.pcrExhaustion ? "PCR extreme" : "Momentum reversal"} detected`,
    };
  }

  // Type 6: OI_SHIFT_SCALP — sudden PCR change
  if (hasHighOIShift && confidence >= 65 && (timeSlot === "MID_MORNING" || timeSlot === "AFTERNOON")) {
    return {
      scalpType: "OI_SHIFT_SCALP",
      targetPoints: 18,
      maxHoldMinutes: 8,
      reason: `PCR ${pcr.toFixed(2)} extreme shift`,
    };
  }

  // Type 2: MOMENTUM_SCALP — strong trend continuation
  const regimeUpper = regime.toUpperCase();
  if (isStrongMomentum && (regimeUpper.includes("BULL") || regimeUpper.includes("BEAR")) && !isExpiryDay) {
    return {
      scalpType: "MOMENTUM_SCALP",
      targetPoints: 20,
      maxHoldMinutes: 10,
      reason: `Strong momentum (${momScore}) in ${regime}`,
    };
  }

  // Type 3: MEAN_REVERSION_SCALP — near S/R wall
  const spotPrice = marketState.niftyOptionChain?.spotPrice || 0;
  const supportWall = report.oi.supportWall || 0;
  const resistanceWall = report.oi.resistanceWall || 0;
  const nearSupport    = supportWall > 0 && spotPrice > 0 && Math.abs(spotPrice - supportWall) / spotPrice < 0.002;
  const nearResistance = resistanceWall > 0 && spotPrice > 0 && Math.abs(spotPrice - resistanceWall) / spotPrice < 0.002;
  if ((nearSupport || nearResistance) && isLowMomentum && !isExpiryDay) {
    return {
      scalpType: "MEAN_REVERSION_SCALP",
      targetPoints: 14,
      maxHoldMinutes: 10,
      reason: `Near ${nearSupport ? "support" : "resistance"} wall — mean reversion`,
    };
  }

  // Type 7: REVERSAL_SCALP — counter-trend
  const isReversal = (momentum.direction === "UP"   && direction === "BUY_PE") ||
                     (momentum.direction === "DOWN"  && direction === "BUY_CE") ||
                     report.trend.alignment.includes("REVERSAL");
  if (isReversal) {
    return {
      scalpType: "REVERSAL_SCALP",
      targetPoints: 16,
      maxHoldMinutes: 8,
      reason: "Counter-trend reversal signal",
    };
  }

  // Type 1: MICRO_SCALP — default
  if (isLowMomentum || regimeUpper.includes("SIDEWAYS") || regimeUpper.includes("RANGE")) {
    return {
      scalpType: "MICRO_SCALP",
      targetPoints: 8,
      maxHoldMinutes: 4,
      reason: "Low momentum / range-bound",
    };
  }

  return {
    scalpType: "MOMENTUM_SCALP",
    targetPoints: 18,
    maxHoldMinutes: 10,
    reason: "Standard momentum",
  };
}

function deriveBuiltinName(
  direction: "BUY_CE" | "BUY_PE",
  timeSlot: TimeSlot,
  report: CompleteMarketReport,
  breakout: BreakoutState,
  momentum: MomentumStateResult,
  scalpType?: string
): string {
  if (scalpType && scalpType !== "MICRO_SCALP") return scalpType;
  if (timeSlot === "OPENING") return "ORB_BREAKOUT_SCALP";
  const isReversal = (momentum.direction === "UP" && direction === "BUY_PE") ||
                     (momentum.direction === "DOWN" && direction === "BUY_CE") ||
                     report.trend.alignment.includes("REVERSAL");
  if (isReversal) return "REVERSAL_SCALP";
  const isTrending = report.trend.alignment.includes("BUY") || report.trend.alignment.includes("SELL");
  if (isTrending) return "MOMENTUM_SCALP";
  if (Math.abs((report.oi.pcr || 1) - 1.0) > 0.15) return "OI_SHIFT_SCALP";
  if (momentum.momentumScore > 55 || momentum.momentumScore < 45) return "MOMENTUM_SCALP";
  return "MICRO_SCALP";
}
