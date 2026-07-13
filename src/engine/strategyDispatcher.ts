/**
 * strategyDispatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Strategy Dispatcher — Pure Strategy-Registry-Driven Engine
 *
 * Architecture (Reset v2):
 *  - Market time gate: 9:15–15:30 IST ONLY
 *  - Each strategy evaluated ONLY against its own registry conditions
 *  - NO external alignment/probability/smartmoney gates
 *  - Multiple strategies evaluated; best-priority triggered one selected
 *  - Direction derived from: ORB breakout/breakdown, regime, reversal indicators
 *
 * Pure TypeScript — no React, no side effects.
 */

import {
  STRATEGY_REGISTRY,
  type StrategyDefinition,
  type StrategyMode,
  type MarketRegime,
  type SessionType,
} from "./strategyRegistry";
import type { ReversalIndicators } from "../../server/services/indicatorEngine";
import {
  runMicroScalpEngine,
  calcNetPnL,
  updateTrailingSL,
  type MicroScalpEngineInput,
  type MicroScalpEngineOutput,
  type MicroScalpSignal,
  type TrailingSLState,
} from "./microScalpEngine";

export type { MicroScalpSignal, MicroScalpEngineOutput, TrailingSLState };

// ── Types ─────────────────────────────────────────────────────────────────────

export type DispatcherMode  = "PAPER" | "LIVE";
export type PositionStatus  = "OPEN" | "CLOSED_PROFIT" | "CLOSED_LOSS" | "CLOSED_TIME" | "CLOSED_MANUAL";
export type SLMode          = "FIXED" | "TRAILING";
export type SLType          = "FIXED" | "TRAILING" | "BOTH";

// ── Keep these for backward compat (imported by App.tsx) ──
export interface ScoreMomentumWindow {
  interval:  number;
  high:      number;
  low:       number;
  lastScore: number;
  timestamp: number;
}

export function detectScoreTrend(history: ScoreMomentumWindow[]): "CE" | "PE" | "NEUTRAL" {
  if (history.length < 2) return "NEUTRAL";
  const len  = history.length;
  const curr = history[len - 1];
  const prev = history[len - 2];
  if (curr.high > prev.high && curr.low > prev.low) return "CE";
  if (curr.high < prev.high && curr.low < prev.low) return "PE";
  if (curr.lastScore > prev.lastScore) return "CE";
  if (curr.lastScore < prev.lastScore) return "PE";
  return "NEUTRAL";
}

export function detectMinorMomentumBurst(input: DispatcherInput): boolean {
  if (input.rangeBreakout || input.rangeBreakdown) return true;
  if (input.momentumExhaustion) return true;
  if (input.reversalIndicators) {
    const rv = input.reversalIndicators;
    if (rv.mfiCrossedAbove20 || rv.mfiCrossedBelow80 ||
        rv.rsiCrossedAbove30 || rv.rsiCrossedBelow70 ||
        rv.stochBullishCross || rv.stochBearishCross) return true;
  }
  return false;
}

export interface ActivePosition {
  id:              string;
  strategyId:      string;
  strategyName:    string;
  mode:            StrategyMode;
  direction:       "CE" | "PE";
  indexSymbol:     string;
  strikePrice:     number;
  optionSymbol:    string;
  entryPremium:    number;
  currentPremium:  number;
  entrySpot:       number;
  currentSpot:     number;
  qty:             number;
  lots:            number;
  entryTime:       number;
  lastUpdatedTime: number;
  lotSize?:        number;
  entryReason?:    string;
  conditionsMet?:  string[];
  stopLoss?:       number;
  target?:         number;
  slMode:          SLMode;
  fixedSL:         number;
  trailingSL:      number;
  trailActive:     boolean;
  targetPremium:   number;
  unrealizedPnl:   number;
  maxPnl:          number;
  maxHoldDays?:    number;
  spreadLeg?: {
    strikePrice:    number;
    optionSymbol:   string;
    entryPremium:   number;
    currentPremium: number;
    direction:      "CE" | "PE";
    action:         "SELL";
  };
  status:          PositionStatus;
  exitPremium?:    number;
  exitTime?:       number;
  exitReason?:     string;
  realizedPnl?:    number;
}

export interface StrategyStats {
  trades:   number;
  wins:     number;
  losses:   number;
  totalPnl: number;
  avgPnl:   number;
  winRate:  number;
}

export interface DispatcherState {
  isActive:           boolean;
  mode:               DispatcherMode;
  dailyLossLimitRs:   number;
  maxPositions:       number;
  enabledModes:       StrategyMode[];
  parallelMode:       boolean;
  activePositions:    Record<string, ActivePosition>;
  strategyStats:      Record<string, StrategyStats>;
  activePosition:     ActivePosition | null;
  closedToday:        ActivePosition[];
  dailyPnl:           number;
  tradingBlocked:     boolean;
  blockReason:        string;
  selectedStrategyId:   string | null;
  selectedStrategyName: string | null;
  selectedStrategyMode: StrategyMode | null;
  conditionsMet:        string[];
  conditionsNotMet:     string[];
  // candidateStrategies — all strategies that passed their conditions this tick
  candidateStrategies:  { id: string; name: string; score: number; weightedScore: number; threshold: number; mode: StrategyMode }[];
  // Keep for backward compat (no longer used for gating)
  layerWeights:         Record<string, number>;
  lastWeightedScore:    null;
  marketEnvironment:    string;
  lastScanTime:         number;
  lastSignalTime:       number;
  microScalpModeActive: boolean;
  scoreMomentumHistory: ScoreMomentumWindow[];

  // ── Micro Scalp Engine State ────────────────────────────────────────────
  microScalpOutput:       MicroScalpEngineOutput | null;
  lastMicroScalpTime:     number;          // epoch ms of last micro scalp entry
  dailyTradeCount:        number;          // total trades taken today
  dailyBrokeragePaid:     number;          // total ₹ brokerage paid today
  prevSmartMoneyScore:    number;          // previous tick value for spike detection
  circuitBreakerHit:      boolean;         // daily loss ≥ ₹8000
}

export interface DispatcherInput {
  // Market context
  spotPrice:          number;
  indexSymbol:        string;
  indiaVix:           number;
  pcr:                number;

  // Session & regime — from marketTimeEngine & marketRegimeEngine
  sessionType:        string;
  regime:             string;

  // ORB data — for breakout/breakdown condition checks
  rangeBreakout:      boolean;
  rangeBreakdown:     boolean;
  momentumExhaustion: boolean;
  isExpiryDay:        boolean;
  isMarketOpen:       boolean;

  // Breadth score — simple market participation metric
  breadthScore:       number;

  // Reversal-specific indicator data (for R01–R12, R06–R07 etc.)
  reversalIndicators?: ReversalIndicators;

  // Option chain for strike selection
  optionChain: Array<{
    strikePrice: number;
    ceLtp:       number;
    peLtp:       number;
    ceOI:        number;
    peOI:        number;
  }>;

  // Current state (passed in, managed externally)
  currentState: DispatcherState;

  // ── Kept for backward compatibility (not used for gating) ──
  aiConfidence?:      number;
  aiDirection?:       string;
  smartMoneyScore?:   number;
  alignmentScore?:    number;
  momentumScore?:     number;
  patternScore?:      number;
  probabilityScore?:  number;
  entryZoneScore?:    number;
  layerWeights?:      Record<string, number>;

  // ── Micro Scalp Engine inputs (all optional, used if provided) ───────────
  ceProbability?:           number;
  peProbability?:           number;
  setupQuality?:            string;
  trapOverride?:            boolean;
  confidenceLevel?:         number;
  pmaeAlert?:               boolean;
  volatilityScore?:         number;
  institutionalBias?:       string;
  trapType?:                string;
  overrideSignal?:          boolean;
  acceleration?:            number;
  freshMomentumDetected?:   boolean;
  intradayExhaustionSide?:  string;
  intradayMovePoints?:      number;
  momentumGrade?:           string;
  volumeConviction?:        number;
  exhaustionBullish?:       boolean;
  exhaustionBearish?:       boolean;
  pcrScore?:                number;
  callWall?:                number;
  putWall?:                 number;
  callWallStrength?:        number;
  putWallStrength?:         number;
  maxPain?:                 number;
  optionChainScore?:        number;
  callUnwinding?:           number;
  putWriting?:              number;
  divergenceType?:          string;
  breadthTrend?:            string;
  regimeConfidence?:        number;
  tradeReadiness?:          string;
  alignmentGrade?:          string;
  highSeverityConflicts?:   number;
  recentWinRate?:           number;
  confidenceMultiplier?:    number;
  consecutiveLosses?:       number;
  cooldownActive?:          boolean;
  brainState?:              string;
  rtpodeDirection?:         string;
  rtpodeConfidence?:        number;
  vwap?:                    number;
  spotDistanceToVwapPct?:   number;
  last3CandleRangePts?:     number;
  candleVolumeDecreasing?:  boolean;
}

export interface DispatcherOutput {
  state:        DispatcherState;
  action:       "ENTER" | "EXIT" | "UPDATE_SL" | "HOLD" | "BLOCKED" | "WAIT";
  actionReason: string;
  tradeSignal?: {
    strategyId:       string;
    strategyName:     string;
    direction:        "CE" | "PE";
    strikePrice:      number;
    entryPremium:     number;
    recommendedLots:  number;
    estimatedCapital: number;
    slPremium:        number;
    targetPremium:    number;
    slType:           SLType;
    squareOffTime:    string;
    trailTriggerRs?:  number;
    trailStepRs?:     number;
    slLabel:          string;
    targetLabel:      string;
    riskRewardRatio:  string;
    // Micro scalp extensions
    scalpType?:       string;
    probabilityScore?: number;
    recommendedLots2?: number;
    grossPnlEstimate?: number;
    netPnlEstimate?:  number;   // after ₹50 brokerage
    brokerageRs?:     number;   // ₹50 per round trip
    isHedgeScalp?:    boolean;
  };
  // Micro scalp engine output (always computed)
  microScalp?: MicroScalpEngineOutput;
}

// ── Default Layer Weights (kept for backward compat, not used for gating) ──
export const DEFAULT_LAYER_WEIGHTS: Record<string, number> = {};

// ── Default State ─────────────────────────────────────────────────────────────

export function createDefaultDispatcherState(): DispatcherState {
  return {
    isActive:             true,
    mode:                 "PAPER",
    dailyLossLimitRs:     3000,
    maxPositions:         1,
    enabledModes:         ["INTRADAY", "POSITIONAL"],
    parallelMode:         false,
    activePositions:      {},
    strategyStats:        {},
    activePosition:       null,
    closedToday:          [],
    dailyPnl:             0,
    tradingBlocked:       false,
    blockReason:          "",
    selectedStrategyId:   null,
    selectedStrategyName: null,
    selectedStrategyMode: null,
    conditionsMet:        [],
    conditionsNotMet:     [],
    candidateStrategies:  [],
    layerWeights:         {},
    lastWeightedScore:    null,
    marketEnvironment:    "UNKNOWN",
    lastScanTime:         0,
    lastSignalTime:       0,
    microScalpModeActive: false,
    scoreMomentumHistory: [],
    // Micro scalp state
    microScalpOutput:     null,
    lastMicroScalpTime:   0,
    dailyTradeCount:      0,
    dailyBrokeragePaid:   0,
    prevSmartMoneyScore:  0,
    circuitBreakerHit:    false,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowISTMinutes(): number {
  const istDate = new Date(Date.now() + 5.5 * 3600 * 1000);
  return istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
}

function isTimeBeforeSquareOff(squareOffTime: string): boolean {
  const [hh, mm] = squareOffTime.split(":").map(Number);
  return nowISTMinutes() < hh * 60 + mm;
}

function mapRegime(regime: string): MarketRegime {
  const r = regime.toUpperCase();
  if (r.includes("TRENDING_BULL") || r.includes("BULL")) return "TRENDING_BULL";
  if (r.includes("TRENDING_BEAR") || r.includes("BEAR")) return "TRENDING_BEAR";
  if (r.includes("BREAKOUT"))  return "BREAKOUT";
  if (r.includes("BREAKDOWN")) return "BREAKDOWN";
  if (r.includes("RANGE"))     return "RANGE";
  if (r.includes("VOLATILE"))  return "VOLATILE";
  return "RANGE";
}

function mapSession(session: string): SessionType {
  const s = session.toUpperCase();
  if (s.includes("OPENING") || s.includes("OPEN")) return "OPENING";
  if (s.includes("CLOSING") || s.includes("CLOSE")) return "CLOSING";
  return "MID";
}

function getATMStrike(
  optionChain: DispatcherInput["optionChain"],
  spot: number,
  gap = 50
): number {
  if (!optionChain || optionChain.length === 0) return Math.round(spot / gap) * gap;
  let best = optionChain[0];
  let minDist = Infinity;
  optionChain.forEach(row => {
    const d = Math.abs(row.strikePrice - spot);
    if (d < minDist) { minDist = d; best = row; }
  });
  return best.strikePrice;
}

function getStrikeLtp(
  optionChain: DispatcherInput["optionChain"],
  strike: number,
  side: "CE" | "PE"
): number {
  const row = optionChain.find(r => r.strikePrice === strike);
  if (!row) return 0;
  return side === "CE" ? row.ceLtp : row.peLtp;
}

// ── Direction Resolution ──────────────────────────────────────────────────────
// Determines CE or PE from market data ONLY — no external AI engine dependency.
// Priority: ORB breakout/breakdown > regime > reversal indicators > PCR

function resolveDirection(input: DispatcherInput): "CE" | "PE" | "NEUTRAL" {
  // 1. ORB breakout/breakdown (strongest signal)
  if (input.rangeBreakout && !input.rangeBreakdown)  return "CE";
  if (input.rangeBreakdown && !input.rangeBreakout) return "PE";

  // 2. Market regime
  const regime = mapRegime(input.regime);
  if (regime === "TRENDING_BULL" || regime === "BREAKOUT")  return "CE";
  if (regime === "TRENDING_BEAR" || regime === "BREAKDOWN") return "PE";

  // 3. Reversal indicator signals (for reversal strategies)
  const rv = input.reversalIndicators;
  if (rv) {
    const bullish = rv.rsiCrossedAbove30 || rv.mfiCrossedAbove20 ||
                    rv.stochBullishCross || rv.momentumCrossedAbove0 ||
                    rv.lrAngleCrossedAboveMinus25;
    const bearish = rv.rsiCrossedBelow70 || rv.mfiCrossedBelow80 ||
                    rv.stochBearishCross || rv.momentumCrossedBelow0 ||
                    rv.lrAngleCrossedBelow25;
    if (bullish && !bearish) return "CE";
    if (bearish && !bullish) return "PE";
  }

  // 4. PCR (extreme values)
  if (input.pcr < 0.7)  return "CE"; // Bearish OI extreme → contrarian CE
  if (input.pcr > 1.5)  return "PE"; // Bullish OI extreme → contrarian PE

  // 5. Breadth
  if (input.breadthScore > 60) return "CE";
  if (input.breadthScore < 40) return "PE";

  return "NEUTRAL";
}

// ── Strategy Condition Checker ────────────────────────────────────────────────
// ONLY checks the strategy's own conditions from STRATEGY_REGISTRY.
// NO external alignment/probability/smartmoney gates.

function checkStrategyConditions(
  strategy: StrategyDefinition,
  input: DispatcherInput,
): { pass: boolean; met: string[]; notMet: string[]; direction: "CE" | "PE" | "NEUTRAL" } {
  const met:    string[] = [];
  const notMet: string[] = [];
  const c = strategy.conditions;
  const regime  = mapRegime(input.regime);
  const session = mapSession(input.sessionType);

  // ── 1. Session ──
  const sessionOk = c.sessionTime.includes("ANY") || c.sessionTime.includes(session);
  sessionOk
    ? met.push(`Session: ${session} ✓`)
    : notMet.push(`Session ${session} ∉ [${c.sessionTime.join(", ")}]`);

  // ── 2. Regime ──
  const regimeOk = (c.allowedRegimes as string[]).includes("ANY") || c.allowedRegimes.includes(regime);
  regimeOk
    ? met.push(`Regime: ${regime} ✓`)
    : notMet.push(`Regime ${regime} not in allowed list`);

  // ── 3. VIX ──
  const vixOk = input.indiaVix >= c.vixMin && input.indiaVix <= c.vixMax;
  vixOk
    ? met.push(`VIX: ${input.indiaVix.toFixed(1)} (range ${c.vixMin}–${c.vixMax}) ✓`)
    : notMet.push(`VIX ${input.indiaVix.toFixed(1)} outside [${c.vixMin}–${c.vixMax}]`);

  // ── 4. Breakout required ──
  if (c.requireBreakout) {
    input.rangeBreakout
      ? met.push("ORB Breakout ✓")
      : notMet.push("Breakout required — not active");
  }

  // ── 5. Breakdown required ──
  if (c.requireBreakdown) {
    input.rangeBreakdown
      ? met.push("ORB Breakdown ✓")
      : notMet.push("Breakdown required — not active");
  }

  // ── 6. Exhaustion signal ──
  if (c.requireExhaustionSignal) {
    input.momentumExhaustion
      ? met.push("Momentum Exhaustion ✓")
      : notMet.push("Exhaustion signal required — not detected");
  }

  // ── 7. Expiry day ──
  if (c.isExpiryDayOnly) {
    input.isExpiryDay
      ? met.push("Expiry Day ✓")
      : notMet.push("Only on expiry day (Thursday)");
  }
  if (c.notExpiryDay) {
    !input.isExpiryDay
      ? met.push("Non-expiry Day ✓")
      : notMet.push("Disabled on expiry day");
  }

  // ── 8. Breadth score ──
  if (c.minBreadthScore !== undefined && c.minBreadthScore > 0) {
    const bOk = input.breadthScore >= c.minBreadthScore;
    bOk
      ? met.push(`Breadth: ${input.breadthScore} ≥ ${c.minBreadthScore} ✓`)
      : notMet.push(`Breadth ${input.breadthScore} < ${c.minBreadthScore}`);
  }

  // ── 9. Reversal indicator checks (per-strategy) ──
  const rv = input.reversalIndicators;

  if (strategy.id === "R01_LINEAR_REG_ANGLE_REVERSAL" && rv) {
    const triggered = rv.lrAngleCrossedAboveMinus25 || rv.lrAngleCrossedBelow25;
    triggered
      ? met.push(`LR Angle: ${rv.lrAngle?.toFixed(1) ?? "--"}° — crossover ✓`)
      : notMet.push(`LR Angle ${rv.lrAngle?.toFixed(1) ?? "--"}° — no ±25 crossover`);
  }

  if (strategy.id === "R02_MFI14_REVERSAL" && rv) {
    const triggered = rv.mfiCrossedAbove20 || rv.mfiCrossedBelow80;
    triggered
      ? met.push(`MFI(14): ${rv.mfi14?.toFixed(1) ?? "--"} — crossover ✓`)
      : notMet.push(`MFI(14) ${rv.mfi14?.toFixed(1) ?? "--"} — no 20/80 crossover`);
  }

  if (strategy.id === "R03_MOMENTUM14_REVERSAL" && rv) {
    const triggered = rv.momentumCrossedAbove0 || rv.momentumCrossedBelow0;
    triggered
      ? met.push(`Momentum(14): ${rv.momentum14?.toFixed(2) ?? "--"} — zero-line cross ✓`)
      : notMet.push(`Momentum(14) — no zero-line crossover`);
  }

  if (strategy.id === "R04_RSI_REVERSAL" && rv) {
    const triggered = rv.rsiCrossedAbove30 || rv.rsiCrossedBelow70;
    triggered
      ? met.push(`RSI(14): ${rv.rsi14?.toFixed(1) ?? "--"} — 30/70 crossover ✓`)
      : notMet.push(`RSI(14) ${rv.rsi14?.toFixed(1) ?? "--"} — no 30/70 crossover`);
  }

  if (strategy.id === "R05_STOCHASTIC_REVERSAL" && rv) {
    const triggered = rv.stochBullishCross || rv.stochBearishCross;
    triggered
      ? met.push(`Stoch %K/${rv.stochK?.toFixed(0) ?? "--"} %D/${rv.stochD?.toFixed(0) ?? "--"} — crossover ✓`)
      : notMet.push(`Stochastic — no oversold/overbought crossover`);
  }

  if (strategy.id === "R06_ORB_HIGH_REVERSAL" && rv) {
    const orbH     = rv.orbHigh;
    const touched  = orbH !== null && input.spotPrice >= orbH * 0.999;
    const rejected = orbH !== null && input.spotPrice < orbH;
    const triggered = touched && rejected;
    triggered
      ? met.push(`ORB High ${orbH?.toFixed(0)} — rejection ✓`)
      : notMet.push(`ORB High ${orbH?.toFixed(0) ?? "--"} — no rejection yet`);
  }

  if (strategy.id === "R07_ORB_LOW_REVERSAL" && rv) {
    const orbL      = rv.orbLow;
    const touched   = orbL !== null && input.spotPrice <= orbL * 1.001;
    const recovered = orbL !== null && input.spotPrice > orbL;
    const triggered = touched && recovered;
    triggered
      ? met.push(`ORB Low ${orbL?.toFixed(0)} — bounce ✓`)
      : notMet.push(`ORB Low ${orbL?.toFixed(0) ?? "--"} — no bounce yet`);
  }

  if (strategy.id === "R08_DAY_HIGH_REJECTION" && rv) {
    const rsiOB    = rv.rsi14 !== null && rv.rsi14 > 65;
    const touched  = rv.dayHigh !== null && input.spotPrice >= rv.dayHigh * 0.999;
    const rejected = rv.dayHigh !== null && input.spotPrice < rv.dayHigh;
    const triggered = touched && rejected && rsiOB;
    triggered
      ? met.push(`Day High ${rv.dayHigh?.toFixed(0)} rejection + RSI overbought ✓`)
      : notMet.push(`Day High rejection — need touch+RSI>65 (RSI: ${rv.rsi14?.toFixed(0) ?? "--"})`);
  }

  if (strategy.id === "R09_DAY_LOW_REJECTION" && rv) {
    const rsiOS    = rv.rsi14 !== null && rv.rsi14 < 35;
    const touched  = rv.dayLow !== null && input.spotPrice <= rv.dayLow * 1.001;
    const recovered = rv.dayLow !== null && input.spotPrice > rv.dayLow;
    const triggered = touched && recovered && rsiOS;
    triggered
      ? met.push(`Day Low ${rv.dayLow?.toFixed(0)} bounce + RSI oversold ✓`)
      : notMet.push(`Day Low bounce — need touch+RSI<35 (RSI: ${rv.rsi14?.toFixed(0) ?? "--"})`);
  }

  if (strategy.id === "R10_LAST_HOUR_HIGH_REJECTION" && rv) {
    const inLastHour = nowISTMinutes() >= 14 * 60 + 15;
    const touched    = rv.dayHigh !== null && input.spotPrice >= rv.dayHigh * 0.999;
    const rejected   = rv.dayHigh !== null && input.spotPrice < rv.dayHigh;
    const triggered  = inLastHour && touched && rejected;
    triggered
      ? met.push(`Last Hour High ${rv.dayHigh?.toFixed(0)} rejection ✓`)
      : notMet.push(!inLastHour ? "Wait for 2:15 PM" : `Last-hour high rejection — not triggered`);
  }

  if (strategy.id === "R11_LAST_HOUR_LOW_REJECTION" && rv) {
    const inLastHour = nowISTMinutes() >= 14 * 60 + 15;
    const touched    = rv.dayLow !== null && input.spotPrice <= rv.dayLow * 1.001;
    const recovered  = rv.dayLow !== null && input.spotPrice > rv.dayLow;
    const triggered  = inLastHour && touched && recovered;
    triggered
      ? met.push(`Last Hour Low ${rv.dayLow?.toFixed(0)} bounce ✓`)
      : notMet.push(!inLastHour ? "Wait for 2:15 PM" : `Last-hour low bounce — not triggered`);
  }

  if (strategy.id === "R12_DAILY_GAP_REVERSAL" && rv) {
    const gap           = rv.gapPct;
    const prevClose     = rv.prevClose ?? 0;
    const gapUpFailing  = gap !== null && gap > 0.3  && input.spotPrice < prevClose + prevClose * gap / 100 * 0.5;
    const gapDnFailing  = gap !== null && gap < -0.3 && input.spotPrice > prevClose + prevClose * gap / 100 * 0.5;
    const triggered     = gapUpFailing || gapDnFailing;
    triggered
      ? met.push(`Gap ${gap?.toFixed(2) ?? "--"}% — fill reversal in progress ✓`)
      : notMet.push(`Gap ${gap?.toFixed(2) ?? "--"}% — no gap fill signal`);
  }

  // ── Determine pass/fail ──
  // A strategy PASSES if ALL its mandatory conditions are met.
  // Mandatory = session + regime + vix + any "require*" fields.
  const pass = notMet.length === 0;

  // ── Resolve direction for this strategy ──
  // Leg-specific direction overrides general market direction
  const primaryLeg = strategy.legs[0];
  let direction: "CE" | "PE" | "NEUTRAL" = "NEUTRAL";
  if (primaryLeg.side === "CE") {
    direction = "CE";
  } else if (primaryLeg.side === "PE") {
    direction = "PE";
  } else {
    // AI_DECIDES — derive from market data
    direction = resolveDirection(input);
  }

  return { pass, met, notMet, direction };
}

// ── P&L Updater ───────────────────────────────────────────────────────────────

export function updatePositionPnl(
  pos: ActivePosition,
  newPremium: number,
  newSpot: number,
  slMode: SLMode,
): ActivePosition {
  const updated = { ...pos, currentPremium: newPremium, currentSpot: newSpot };
  const pnl = (newPremium - pos.entryPremium) * pos.qty;
  updated.unrealizedPnl = pnl;

  if (pos.spreadLeg) {
    const spreadPnl = (pos.spreadLeg.entryPremium - pos.spreadLeg.currentPremium) * pos.qty;
    updated.unrealizedPnl = pnl + spreadPnl;
  }

  if (updated.unrealizedPnl > updated.maxPnl) {
    updated.maxPnl = updated.unrealizedPnl;
  }

  if (slMode === "TRAILING") {
    const trailTrigger = (pos.targetPremium - pos.entryPremium) * 0.5 * pos.qty;
    if (!pos.trailActive && updated.unrealizedPnl >= trailTrigger) {
      updated.trailActive = true;
      updated.trailingSL  = pos.entryPremium + (newPremium - pos.entryPremium) * 0.3;
    }
    if (updated.trailActive) {
      const newTrail = newPremium - (pos.targetPremium - pos.entryPremium) * 0.3;
      if (newTrail > updated.trailingSL) {
        updated.trailingSL = newTrail;
      }
    }
  }

  updated.lastUpdatedTime = Date.now();
  return updated;
}

// ── Exit Checker ──────────────────────────────────────────────────────────────

export function checkExitConditions(
  pos: ActivePosition,
  slMode: SLMode,
  isMarketOpen: boolean,
): { shouldExit: boolean; reason: string } {
  const istMins = nowISTMinutes();

  // Scalping time-based exits
  if (pos.strategyId.includes("SCALP") || pos.strategyId === "BERSERKER_MICRO_SCALP") {
    const elapsed = (Date.now() - pos.entryTime) / (1000 * 60);
    if (elapsed >= 5) return { shouldExit: true, reason: "Scalp 5-min timeout" };
  }

  // Fixed SL hit
  if (pos.currentPremium <= pos.fixedSL) {
    return { shouldExit: true, reason: `Fixed SL hit @ ₹${pos.currentPremium.toFixed(1)}` };
  }

  // Trailing SL hit
  if (pos.trailActive && slMode === "TRAILING" && pos.currentPremium <= pos.trailingSL) {
    return { shouldExit: true, reason: `Trailing SL hit @ ₹${pos.currentPremium.toFixed(1)}` };
  }

  // Target hit
  if (pos.currentPremium >= pos.targetPremium) {
    return { shouldExit: true, reason: `Target hit @ ₹${pos.currentPremium.toFixed(1)}` };
  }

  // Intraday square-off: hard 15:25
  if (pos.mode === "INTRADAY") {
    if (istMins >= 15 * 60 + 25) {
      return { shouldExit: true, reason: "Intraday time square-off 15:25" };
    }
    // Market closed exit check is removed so trading works anytime.

  }

  // Positional: max hold days
  if (pos.mode === "POSITIONAL" && pos.maxHoldDays) {
    const heldDays = (Date.now() - pos.entryTime) / (1000 * 60 * 60 * 24);
    if (heldDays >= pos.maxHoldDays) {
      return { shouldExit: true, reason: `Max hold days (${pos.maxHoldDays}d) reached` };
    }
  }

  return { shouldExit: false, reason: "" };
}

// ── Strategy Stats Updater ────────────────────────────────────────────────────

function updateStrategyStats(
  stats: Record<string, StrategyStats>,
  strategyId: string,
  pnl: number,
): Record<string, StrategyStats> {
  const prev     = stats[strategyId] ?? { trades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, winRate: 0 };
  const trades   = prev.trades + 1;
  const wins     = prev.wins   + (pnl >= 0 ? 1 : 0);
  const losses   = prev.losses + (pnl <  0 ? 1 : 0);
  const totalPnl = prev.totalPnl + pnl;
  return {
    ...stats,
    [strategyId]: {
      trades,
      wins,
      losses,
      totalPnl,
      avgPnl:  parseFloat((totalPnl / trades).toFixed(1)),
      winRate: parseFloat(((wins / trades) * 100).toFixed(1)),
    },
  };
}

// ── SL & Target Calculator ────────────────────────────────────────────────────

function calcSlTarget(
  risk: StrategyDefinition["risk"],
  entryLtp: number,
  lotSize: number,
): { slPremium: number; tgtPremium: number; slLabel: string; targetLabel: string; rrRatio: string } {
  // SL
  let slPoints: number;
  let slLabel: string;
  if (risk.fixedSLPct !== undefined) {
    slPoints = entryLtp * (risk.fixedSLPct / 100);
    slLabel  = `${risk.fixedSLPct}% of premium (₹${slPoints.toFixed(0)}/pt)`;
  } else {
    slPoints = risk.maxLossRs / lotSize;
    slLabel  = `₹${risk.maxLossRs.toLocaleString("en-IN")} max loss (₹${slPoints.toFixed(0)}/pt)`;
  }
  const slPremium = parseFloat(Math.max(0.5, entryLtp - slPoints).toFixed(1));

  // Target
  let tgtPoints: number;
  let targetLabel: string;
  if (risk.targetPct !== undefined) {
    tgtPoints   = entryLtp * (risk.targetPct / 100);
    targetLabel = `${risk.targetPct}% of premium (₹${tgtPoints.toFixed(0)}/pt)`;
  } else {
    tgtPoints   = risk.targetRs / lotSize;
    targetLabel = `₹${risk.targetRs.toLocaleString("en-IN")} target (₹${tgtPoints.toFixed(0)}/pt)`;
  }
  const tgtPremium = parseFloat((entryLtp + tgtPoints).toFixed(1));

  const rrRatio = slPoints > 0 ? `1:${(tgtPoints / slPoints).toFixed(1)}` : "1:1";
  return { slPremium, tgtPremium, slLabel, targetLabel, rrRatio };
}

// ── Parallel Mode Dispatcher ──────────────────────────────────────────────────
// Runs ALL active strategies simultaneously.

export function runParallelDispatcher(input: DispatcherInput): DispatcherOutput {
  const state = {
    ...input.currentState,
    activePositions: { ...input.currentState.activePositions },
    strategyStats:   { ...input.currentState.strategyStats   },
    closedToday:     [...input.currentState.closedToday],
  };
  state.lastScanTime = Date.now();

  // Market time gate (Bypassed per user request)
  if (!state.isActive) {
    return { state, action: "WAIT", actionReason: "Dispatcher paused" };
  }


  const indexGap = input.indexSymbol === "SENSEX" ? 100 : 50;
  const lotSize  = input.indexSymbol === "BANKNIFTY" ? 15 : input.indexSymbol === "SENSEX" ? 10 : 25;

  let anyEntered = false;
  let anyExited  = false;

  const candidates: { id: string; name: string; score: number; weightedScore: number; threshold: number; mode: StrategyMode }[] = [];

  for (const strategy of STRATEGY_REGISTRY) {
    if (!strategy.isActive) continue;
    if (!state.enabledModes.includes(strategy.mode)) continue;

    const existingPos = state.activePositions[strategy.id];

    // ── Exit check for existing position ──
    if (existingPos) {
      const ltp = existingPos.direction === "CE"
        ? (input.optionChain.find(r => r.strikePrice === existingPos.strikePrice)?.ceLtp ?? existingPos.currentPremium)
        : (input.optionChain.find(r => r.strikePrice === existingPos.strikePrice)?.peLtp ?? existingPos.currentPremium);
      const updated = updatePositionPnl(existingPos, ltp, input.spotPrice, existingPos.slMode);
      state.activePositions[strategy.id] = updated;

      const { shouldExit, reason } = checkExitConditions(updated, updated.slMode, input.isMarketOpen);
      if (shouldExit) {
        const realizedPnl = updated.unrealizedPnl;
        const closedPos: ActivePosition = {
          ...updated,
          status:      realizedPnl >= 0 ? "CLOSED_PROFIT" : "CLOSED_LOSS",
          exitPremium: updated.currentPremium,
          exitTime:    Date.now(),
          exitReason:  reason,
          realizedPnl,
        };
        delete state.activePositions[strategy.id];
        state.closedToday  = [...state.closedToday, closedPos];
        state.dailyPnl    += realizedPnl;
        state.strategyStats = updateStrategyStats(state.strategyStats, strategy.id, realizedPnl);
        anyExited = true;
      }
      continue;
    }

    // ── Entry scan ──
    const { pass, met, notMet, direction } = checkStrategyConditions(strategy, input);

    // Track candidates for UI
    candidates.push({
      id:            strategy.id,
      name:          strategy.name,
      score:         pass ? 100 - strategy.priority : 0,
      weightedScore: pass ? 100 : 0,
      threshold:     50,
      mode:          strategy.mode,
    });

    if (!pass) continue;
    if (direction === "NEUTRAL") continue;

    const atmStrike = getATMStrike(input.optionChain, input.spotPrice, indexGap);
    const entryLtp  = getStrikeLtp(input.optionChain, atmStrike, direction);
    if (entryLtp <= 0) continue;

    const { slPremium, tgtPremium } = calcSlTarget(strategy.risk, entryLtp, lotSize);
    const slMode: SLMode = strategy.risk.slType === "TRAILING" || strategy.risk.slType === "BOTH"
      ? "TRAILING" : "FIXED";

    const newPos: ActivePosition = {
      id:              `${strategy.id}_${Date.now()}`,
      strategyId:      strategy.id,
      strategyName:    strategy.name,
      mode:            strategy.mode,
      direction,
      indexSymbol:     input.indexSymbol,
      strikePrice:     atmStrike,
      optionSymbol:    `${input.indexSymbol}${atmStrike}${direction}`,
      entryPremium:    entryLtp,
      currentPremium:  entryLtp,
      entrySpot:       input.spotPrice,
      currentSpot:     input.spotPrice,
      qty:             lotSize,
      lots:            1,
      entryTime:       Date.now(),
      lastUpdatedTime: Date.now(),
      slMode,
      fixedSL:         slPremium,
      trailingSL:      slPremium,
      trailActive:     false,
      targetPremium:   tgtPremium,
      unrealizedPnl:   0,
      maxPnl:          0,
      status:          "OPEN",
      maxHoldDays:     strategy.risk.maxHoldDays,
      conditionsMet:   met,
    };

    state.activePositions[strategy.id] = newPos;
    anyEntered = true;
  }

  state.candidateStrategies = candidates.sort((a, b) => b.score - a.score);
  const openCount = Object.keys(state.activePositions).length;

  return {
    state,
    action:       anyEntered ? "ENTER" : anyExited ? "EXIT" : "HOLD",
    actionReason: `Parallel: ${openCount} open, ${state.closedToday.length} closed today`,
  };
}

// ── Single-Best Strategy Dispatcher (default mode) ───────────────────────────
// Evaluates ALL active strategies → picks highest-priority passing one → enters.

export function runDispatcher(input: DispatcherInput): DispatcherOutput {
  // Route to parallel mode disabled per user request for strictly 1 active trade at a time.
  const state = { ...input.currentState, parallelMode: false };
  state.lastScanTime = Date.now();

  // ── Guard: Not active ──
  if (!state.isActive) {
    return { state, action: "WAIT", actionReason: "Dispatcher paused — activate to start" };
  }

  // ── Market time gate: REMOVED — trading works anytime ──
  // isMarketOpen gate removed per user request.
  // Strategies with session-specific conditions (e.g. OPENING) handle their
  // own timing via sessionTime in STRATEGY_REGISTRY conditions.

  // ── Daily loss limit ──
  if (state.tradingBlocked) {
    return { state, action: "BLOCKED", actionReason: state.blockReason };
  }
  if (state.dailyPnl <= -state.dailyLossLimitRs) {
    state.tradingBlocked = true;
    state.blockReason = `Daily loss limit ₹${state.dailyLossLimitRs} reached (P&L: ₹${state.dailyPnl.toFixed(0)})`;
    return { state, action: "BLOCKED", actionReason: state.blockReason };
  }

  // ── Check open position exit ──
  if (state.activePosition) {
    const slMode = state.activePosition.slMode;
    const { shouldExit, reason } = checkExitConditions(state.activePosition, slMode, input.isMarketOpen);

    if (shouldExit) {
      const realizedPnl = state.activePosition.unrealizedPnl;
      const closedPos: ActivePosition = {
        ...state.activePosition,
        status:      realizedPnl >= 0 ? "CLOSED_PROFIT" : "CLOSED_LOSS",
        exitPremium: state.activePosition.currentPremium,
        exitTime:    Date.now(),
        exitReason:  reason,
        realizedPnl,
      };
      state.closedToday  = [...state.closedToday, closedPos];
      state.dailyPnl    += realizedPnl;
      state.activePosition = null;
      if (state.dailyPnl <= -state.dailyLossLimitRs) {
        state.tradingBlocked = true;
        state.blockReason = `Daily loss limit ₹${state.dailyLossLimitRs} hit after trade`;
      }
      return { state, action: "EXIT", actionReason: reason };
    }

    return { state, action: "HOLD", actionReason: `Holding ${state.activePosition.strategyName}` };
  }

  // ── No open position — scan ALL strategies ──
  const indexGap = input.indexSymbol === "SENSEX" ? 100 : 50;
  const lotSize  = input.indexSymbol === "BANKNIFTY" ? 15 : input.indexSymbol === "SENSEX" ? 10 : 25;

  // Evaluate every active strategy against its own conditions only
  const evaluated: {
    strategy:  StrategyDefinition;
    met:       string[];
    notMet:    string[];
    direction: "CE" | "PE" | "NEUTRAL";
    pass:      boolean;
  }[] = [];

  for (const strategy of STRATEGY_REGISTRY) {
    if (!strategy.isActive) continue;
    if (!state.enabledModes.includes(strategy.mode)) continue;

    const result = checkStrategyConditions(strategy, input);
    evaluated.push({ strategy, ...result });
  }

  // Build candidate list for UI — all strategies sorted by priority
  state.candidateStrategies = evaluated.map(e => ({
    id:            e.strategy.id,
    name:          e.strategy.name,
    score:         e.pass ? 100 - e.strategy.priority : 0,
    weightedScore: e.pass ? 100 : 0,
    threshold:     50,
    mode:          e.strategy.mode,
  })).sort((a, b) => b.score - a.score);

  // Filter to passing strategies with a resolved direction
  const passing = evaluated
    .filter(e => e.pass && e.direction !== "NEUTRAL")
    .sort((a, b) => a.strategy.priority - b.strategy.priority); // lower priority number = higher importance

  // ── Run Micro Scalp Engine (always, for every tick) ─────────────────────────
  const microScalpInput: MicroScalpEngineInput = {
    spotPrice:             input.spotPrice,
    indexSymbol:           (input.indexSymbol === "NIFTY" || input.indexSymbol === "SENSEX" || input.indexSymbol === "BANKNIFTY")
                             ? input.indexSymbol : "NIFTY",
    indiaVix:              input.indiaVix,
    ceProbability:         input.ceProbability         ?? 50,
    peProbability:         input.peProbability         ?? 50,
    setupQuality:          input.setupQuality          ?? "MODERATE",
    trapOverride:          input.trapOverride          ?? false,
    confidenceLevel:       input.confidenceLevel       ?? 50,
    pmaeAlert:             input.pmaeAlert             ?? false,
    volatilityScore:       input.volatilityScore       ?? 50,
    smartMoneyScore:       input.smartMoneyScore       ?? 0,
    institutionalBias:     input.institutionalBias     ?? "NONE",
    trapType:              input.trapType              ?? "NONE",
    overrideSignal:        input.overrideSignal        ?? false,
    prevSmartMoneyScore:   state.prevSmartMoneyScore,
    momentumScore:         input.momentumScore         ?? 50,
    acceleration:          input.acceleration          ?? 0,
    freshMomentumDetected: input.freshMomentumDetected ?? false,
    intradayExhaustionSide: input.intradayExhaustionSide ?? "NONE",
    intradayMovePoints:    input.intradayMovePoints    ?? 0,
    momentumGrade:         input.momentumGrade         ?? "C",
    volumeConviction:      input.volumeConviction      ?? 0,
    exhaustionBullish:     input.exhaustionBullish     ?? false,
    exhaustionBearish:     input.exhaustionBearish     ?? false,
    pcr:                   input.pcr,
    pcrScore:              input.pcrScore              ?? 50,
    callWall:              input.callWall              ?? 0,
    putWall:               input.putWall               ?? 0,
    callWallStrength:      input.callWallStrength      ?? 0,
    putWallStrength:       input.putWallStrength       ?? 0,
    maxPain:               input.maxPain               ?? 0,
    optionChainScore:      input.optionChainScore      ?? 50,
    callUnwinding:         input.callUnwinding         ?? 0,
    putWriting:            input.putWriting            ?? 0,
    breadthScore:          input.breadthScore,
    divergenceType:        input.divergenceType        ?? "NONE",
    breadthTrend:          input.breadthTrend          ?? "STABLE",
    regime:                input.regime,
    regimeConfidence:      input.regimeConfidence      ?? 50,
    tradeReadiness:        input.tradeReadiness        ?? "PARTIALLY_ALIGNED",
    alignmentGrade:        input.alignmentGrade        ?? "C",
    highSeverityConflicts: input.highSeverityConflicts ?? 0,
    recentWinRate:         input.recentWinRate         ?? 50,
    confidenceMultiplier:  input.confidenceMultiplier  ?? 1.0,
    consecutiveLosses:     input.consecutiveLosses     ?? 0,
    cooldownActive:        input.cooldownActive        ?? false,
    brainState:            input.brainState            ?? "LEARNING",
    rtpodeDirection:       input.rtpodeDirection       ?? "NO_SIGNAL",
    rtpodeConfidence:      input.rtpodeConfidence      ?? 0,
    rtpodeAligned:         (input.rtpodeDirection === "BUY_CE" && (input.ceProbability ?? 50) > (input.peProbability ?? 50)) ||
                           (input.rtpodeDirection === "BUY_PE" && (input.peProbability ?? 50) > (input.ceProbability ?? 50)),
    lastMicroScalpTime:    state.lastMicroScalpTime,
    dailyPnlRs:            state.dailyPnl,
    openPositionCount:     state.activePosition ? 1 : 0,
    dailyTradeCount:       state.dailyTradeCount,
    isExpiryDay:           input.isExpiryDay,
    sessionType:           input.sessionType,
    vwap:                  input.vwap,
    spotDistanceToVwapPct: input.spotDistanceToVwapPct,
    last3CandleRangePts:   input.last3CandleRangePts,
    candleVolumeDecreasing: input.candleVolumeDecreasing,
    rangeBreakout:         input.rangeBreakout,
    rangeBreakdown:        input.rangeBreakdown,
  };
  const microScalpOutput = runMicroScalpEngine(microScalpInput);
  state.microScalpOutput    = microScalpOutput;
  state.prevSmartMoneyScore = input.smartMoneyScore ?? state.prevSmartMoneyScore;
  state.circuitBreakerHit   = microScalpOutput.dailyStats.circuitBreakerHit;

  if (passing.length === 0) {
    // Show best near-miss for debugging
    const bestMiss = evaluated.sort((a, b) => a.notMet.length - b.notMet.length)[0];
    state.selectedStrategyId   = null;
    state.selectedStrategyName = null;
    state.conditionsMet        = bestMiss?.met ?? [];
    state.conditionsNotMet     = bestMiss
      ? [`Best miss: ${bestMiss.strategy.name} — failed: ${bestMiss.notMet.join("; ")}`]
      : ["No strategy conditions matched current market"];

    // ── Micro Scalp Fallback ──────────────────────────────────────────────
    // If no strategy fires but micro scalp engine has a signal ≥ 50 score, use it
    const msSignal = microScalpOutput.signal;
    if (msSignal && microScalpOutput.tradeAllowed && msSignal.probabilityScore >= 30
        && msSignal.direction !== "WAIT" && msSignal.direction !== "BOTH") {

      const dir = msSignal.direction as "CE" | "PE";
      const atmStrikeMs = getATMStrike(input.optionChain, input.spotPrice, indexGap);
      const entryLtpMs  = getStrikeLtp(input.optionChain, atmStrikeMs, dir);
      if (entryLtpMs > 0) {
        const slMs  = Math.max(0.5, entryLtpMs - msSignal.slPremiumDrop);
        const tgtMs = entryLtpMs + msSignal.targetPremiumMove;
        const rrMs  = msSignal.slPremiumDrop > 0
          ? `1:${(msSignal.targetPremiumMove / msSignal.slPremiumDrop).toFixed(1)}` : "1:1";
        const netPnl = calcNetPnL(msSignal.grossPnlEstimate);

        state.lastSignalTime  = Date.now();
        state.microScalpModeActive = true;

        return {
          state,
          action:       "ENTER",
          actionReason: `Micro Scalp [${msSignal.scalpType}] → ${dir} | Score: ${msSignal.probabilityScore} | ₹${entryLtpMs} | SL ₹${slMs.toFixed(1)} | TGT ₹${tgtMs.toFixed(1)} | Net ~₹${netPnl.net}`,
          tradeSignal: {
            strategyId:       `MICRO_SCALP_${msSignal.scalpType}`,
            strategyName:     `Micro Scalp — ${msSignal.scalpType.replace(/_/g, " ")}`,
            direction:        dir,
            strikePrice:      atmStrikeMs,
            entryPremium:     parseFloat(entryLtpMs.toFixed(1)),
            recommendedLots:  msSignal.recommendedLots,
            estimatedCapital: parseFloat((entryLtpMs * lotSize * msSignal.recommendedLots * 1.2).toFixed(0)),
            slPremium:        parseFloat(slMs.toFixed(1)),
            targetPremium:    parseFloat(tgtMs.toFixed(1)),
            slType:           "TRAILING",
            squareOffTime:    "15:25",
            trailTriggerRs:   msSignal.targetPremiumMove * lotSize * 0.4,
            trailStepRs:      msSignal.slPremiumDrop * lotSize * 0.5,
            slLabel:          `₹${msSignal.slPremiumDrop}/pt drop`,
            targetLabel:      `₹${msSignal.targetPremiumMove}/pt move`,
            riskRewardRatio:  rrMs,
            // Micro scalp extensions
            scalpType:        msSignal.scalpType,
            probabilityScore: msSignal.probabilityScore,
            grossPnlEstimate: msSignal.grossPnlEstimate,
            netPnlEstimate:   netPnl.net,
            brokerageRs:      50,
            isHedgeScalp:     msSignal.isHedgeScalp,
          },
          microScalp: microScalpOutput,
        };
      }
    }

    // Hedge Scalp special case — both CE and PE
    if (msSignal?.isHedgeScalp && microScalpOutput.tradeAllowed) {
      state.microScalpModeActive = true;
      return {
        state,
        action:       "ENTER",
        actionReason: `Hedge Scalp (CE+PE) — RANGE/VOLATILE regime | Score: ${msSignal.probabilityScore}`,
        tradeSignal: {
          strategyId:       "MICRO_SCALP_HEDGE",
          strategyName:     "Hedge Scalp — CE + PE Simultaneous",
          direction:        "CE",  // primary leg; hedge PE added by executor
          strikePrice:      getATMStrike(input.optionChain, input.spotPrice, indexGap),
          entryPremium:     0,
          recommendedLots:  1,
          estimatedCapital: 0,
          slPremium:        0,
          targetPremium:    0,
          slType:           "FIXED",
          squareOffTime:    "15:25",
          slLabel:          "₹4 drop on losing leg",
          targetLabel:      "₹8 move on winning leg",
          riskRewardRatio:  "1:2",
          scalpType:        "HEDGE_SCALP",
          probabilityScore: msSignal.probabilityScore,
          brokerageRs:      100, // both legs
          isHedgeScalp:     true,
        },
        microScalp: microScalpOutput,
      };
    }

    return {
      state,
      action:       "WAIT",
      actionReason: "No strategy matched — micro scalp score too low or blocked",
      microScalp:   microScalpOutput,
    };
  }

  // Pick best = highest priority (lowest priority number)
  const best      = passing[0];
  const strategy  = best.strategy;
  const direction = best.direction as "CE" | "PE";

  state.selectedStrategyId   = strategy.id;
  state.selectedStrategyName = strategy.name;
  state.selectedStrategyMode = strategy.mode;
  state.conditionsMet        = best.met;
  state.conditionsNotMet     = best.notMet;

  // Strike & premium resolution
  const atmStrike = getATMStrike(input.optionChain, input.spotPrice, indexGap);
  const entryLtp  = getStrikeLtp(input.optionChain, atmStrike, direction);

  if (entryLtp <= 0) {
    return { state, action: "WAIT", actionReason: "LTP unavailable for ATM strike" };
  }

  const { slPremium, tgtPremium, slLabel, targetLabel, rrRatio } =
    calcSlTarget(strategy.risk, entryLtp, lotSize);

  state.lastSignalTime = Date.now();

  return {
    state,
    action:       "ENTER",
    actionReason: `${strategy.name} → ${direction} @ ₹${entryLtp} | SL ₹${slPremium} | TGT ₹${tgtPremium}`,
    tradeSignal: {
      strategyId:       strategy.id,
      strategyName:     strategy.name,
      direction,
      strikePrice:      atmStrike,
      entryPremium:     parseFloat(entryLtp.toFixed(1)),
      recommendedLots:  1,
      estimatedCapital: parseFloat((entryLtp * lotSize * 1.2).toFixed(0)),
      slPremium,
      targetPremium:    tgtPremium,
      slType:           strategy.risk.slType,
      squareOffTime:    strategy.risk.squareOffTime ?? "15:25",
      trailTriggerRs:   strategy.risk.trailTriggerRs,
      trailStepRs:      strategy.risk.trailStepRs,
      slLabel,
      targetLabel,
      riskRewardRatio:  rrRatio,
    },
  };
}

// ── Paper Trade Executor ──────────────────────────────────────────────────────

export function executePaperEntry(
  signal: NonNullable<DispatcherOutput["tradeSignal"]>,
  strategy: StrategyDefinition,
  input: DispatcherInput,
  state: DispatcherState,
): DispatcherState {
  const { direction, strikePrice, slPremium, targetPremium, slType } = signal;
  const lotSize  = input.indexSymbol === "BANKNIFTY" ? 15 : input.indexSymbol === "SENSEX" ? 10 : 25;
  const entryLtp = signal.entryPremium > 0
    ? signal.entryPremium
    : (direction === "CE"
        ? (input.optionChain.find(r => r.strikePrice === strikePrice)?.ceLtp ?? 0)
        : (input.optionChain.find(r => r.strikePrice === strikePrice)?.peLtp ?? 0));

  const slMode: SLMode = slType === "TRAILING" || slType === "BOTH" ? "TRAILING" : "FIXED";

  const newPosition: ActivePosition = {
    id:              `${strategy.id}_${Date.now()}`,
    strategyId:      strategy.id,
    strategyName:    strategy.name,
    mode:            strategy.mode,
    direction,
    indexSymbol:     input.indexSymbol,
    strikePrice,
    optionSymbol:    `${input.indexSymbol}${strikePrice}${direction}`,
    entryPremium:    entryLtp,
    currentPremium:  entryLtp,
    entrySpot:       input.spotPrice,
    currentSpot:     input.spotPrice,
    qty:             lotSize,
    lots:            1,
    entryTime:       Date.now(),
    lastUpdatedTime: Date.now(),
    slMode,
    fixedSL:         slPremium,
    trailingSL:      slPremium,
    trailActive:     false,
    targetPremium,
    unrealizedPnl:   0,
    maxPnl:          0,
    status:          "OPEN",
    maxHoldDays:     strategy.risk.maxHoldDays,
  };

  return {
    ...state,
    activePosition: newPosition,
    lastSignalTime: Date.now(),
  };
}
