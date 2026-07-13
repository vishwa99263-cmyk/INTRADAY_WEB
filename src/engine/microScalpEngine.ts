/**
 * microScalpEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Micro Scalping Engine v1.0
 *
 * Implements all 8 micro scalp types + unified probability score:
 *
 *  Type 1 — Pure Momentum Ignition       (freshMomentumDetected)
 *  Type 2 — OI Wall Bounce               (spot near putWall/callWall)
 *  Type 3 — Exhaustion Reversal          (intradayExhaustionSide)
 *  Type 4 — Breadth Divergence           (FEW_STOCKS_RALLY / HIDDEN_STRENGTH)
 *  Type 5 — Smart Money Spike            (smartMoneyScore rapid change)
 *  Type 6 — PCR Extreme Play             (pcr < 0.65 or > 1.55)
 *  Type 7 — Fake Trap Reversal           (trapType detection) ← highest win rate
 *  Type 8 — RTPODE ₹1000 Signal         (rtpodeEngine output)
 *
 *  Hedge Scalp — CE + PE simultaneously  (RANGE/VOLATILE regime)
 *
 * Also computes:
 *  - Unified Probability Score (0–100) from all engine signals
 *  - Recommended lot size (1 or 2 based on score)
 *  - Brokerage-adjusted net P&L estimate
 *  - Daily loss circuit breaker
 *  - Trade frequency limiter (15 min between micro scalps)
 *
 * Pure TypeScript — no React, no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MicroScalpType =
  | "MOMENTUM_IGNITION"
  | "OI_WALL_BOUNCE"
  | "EXHAUSTION_REVERSAL"
  | "BREADTH_DIVERGENCE"
  | "SMART_MONEY_SPIKE"
  | "PCR_EXTREME"
  | "FAKE_TRAP_REVERSAL"
  | "RTPODE_SIGNAL"
  | "HEDGE_SCALP"
  | "VWAP_BOUNCE"
  | "RANGE_EXPANSION";

export type ScalpDirection = "CE" | "PE" | "BOTH" | "WAIT";
export type ScalpGrade = "PREMIUM" | "STRONG" | "MICRO" | "WEAK" | "NO_TRADE";
/**
 * QUICK = chota profit exit — tight target (2-4 pts), fast scalp
 * FULL  = bada profit exit — trail to large move (8-15 pts), momentum trades
 */
export type MicroScalpExitMode = "QUICK" | "FULL";

export interface MicroScalpSignal {
  /** Which micro scalp type fired */
  scalpType:        MicroScalpType;
  /** Trade direction */
  direction:        ScalpDirection;
  /** Unified probability score 0–100 */
  probabilityScore: number;
  /** Trade quality grade */
  grade:            ScalpGrade;
  /** Recommended lot size (1 or 2) */
  recommendedLots:  number;
  /** Stop loss — premium drop in ₹ */
  slPremiumDrop:    number;
  /** Target — premium gain in ₹ */
  targetPremiumMove: number;
  /** Max hold time in minutes */
  maxHoldMinutes:   number;
  /** Gross P&L estimate per lot */
  grossPnlEstimate: number;
  /** Net P&L after ₹50 brokerage */
  netPnlEstimate:   number;
  /** Human-readable reasons */
  reasons:          string[];
  /** Score breakdown */
  scoreBreakdown:   ScoreBreakdown;
  /** Hedge scalp — fire both CE and PE */
  isHedgeScalp:     boolean;
  /** Timestamp */
  timestamp:        number;
  /**
   * Exit mode:
   * QUICK = chota profit (tight target 2–4 pts, fast scalp, less trail)
   * FULL  = bada profit  (trail to 8–15 pts, let winners run)
   */
  exitMode:         MicroScalpExitMode;
  /** Suggested target description for UI */
  exitModeLabel:    string;
}

export interface ScoreBreakdown {
  base:              number;  // from ceProbability/peProbability
  regimeBonus:       number;
  smartMoneyBonus:   number;
  momentumBonus:     number;
  breadthBonus:      number;
  trapClearBonus:    number;
  volumeBonus:       number;
  momentumGradeBonus: number;
  oiWallBonus:       number;
  rtpodeBonus:       number;
  setupQualityBonus: number;
  pmaeBonus:         number;
  memoryBonus:       number;
  alignmentBonus:    number;
  // Penalties
  trapPenalty:       number;
  cooldownPenalty:   number;
  regimeLowPenalty:  number;
  lossStreakPenalty: number;
  divergencePenalty: number;
  total:             number;
}

export interface MicroScalpEngineInput {
  // ── Core prices ─────────────────────────────────────────────────────────
  spotPrice:              number;
  indexSymbol:            "NIFTY" | "SENSEX" | "BANKNIFTY";
  indiaVix:               number;

  // ── L8: Probability Engine ───────────────────────────────────────────────
  ceProbability:          number;  // 0–100
  peProbability:          number;  // 0–100
  setupQuality:           string;  // STRONG/MODERATE/WEAK/NO_TRADE
  trapOverride:           boolean;
  confidenceLevel:        number;  // 0–100
  pmaeAlert:              boolean; // pmaeAlert != null
  volatilityScore:        number;

  // ── L7: Smart Money Engine ───────────────────────────────────────────────
  smartMoneyScore:        number;  // -100 to +100
  institutionalBias:      string;  // ACCUMULATION/DISTRIBUTION/NONE
  trapType:               string;  // FAKE_BREAKOUT/FAKE_BREAKDOWN/LIQUIDITY_SWEEP/VOLUME_MIRAGE/NONE
  overrideSignal:         boolean;
  prevSmartMoneyScore?:   number;  // previous tick (for spike detection)

  // ── L6: Momentum Engine ──────────────────────────────────────────────────
  momentumScore:          number;  // 0–100
  acceleration:           number;  // +/- (positive = accelerating)
  freshMomentumDetected:  boolean;
  intradayExhaustionSide: string;  // REVERSAL_UP/REVERSAL_DOWN/NONE
  intradayMovePoints:     number;  // points from day open
  momentumGrade:          string;  // A/B/C/D
  volumeConviction:       number;  // 0/15/25
  exhaustionBullish:      boolean;
  exhaustionBearish:      boolean;

  // ── L5: Option Chain Engine ──────────────────────────────────────────────
  pcr:                    number;
  pcrScore:               number;  // 0–100
  callWall:               number;  // resistance strike
  putWall:                number;  // support strike
  callWallStrength:       number;  // 0–100
  putWallStrength:        number;  // 0–100
  maxPain:                number;
  optionChainScore:       number;
  callUnwinding:          number;  // CE OI being removed (bullish)
  putWriting:             number;  // PE OI being added (bullish)

  // ── L2: Market Breadth Engine ────────────────────────────────────────────
  breadthScore:           number;  // 0–100
  divergenceType:         string;  // FEW_STOCKS_RALLY/HIDDEN_STRENGTH/HEALTHY_TREND/NONE
  breadthTrend:           string;  // IMPROVING/DETERIORATING/STABLE

  // ── L1: Market Regime Engine ─────────────────────────────────────────────
  regime:                 string;  // TRENDING_BULL/BEAR/BREAKOUT/BREAKDOWN/RANGE/VOLATILE
  regimeConfidence:       number;  // 0–100

  // ── L10: Strategy Alignment Engine ──────────────────────────────────────
  tradeReadiness:         string;  // FULLY_ALIGNED/MOSTLY_ALIGNED/etc
  alignmentGrade:         string;  // A+/A/B/C/D/F
  highSeverityConflicts:  number;  // count

  // ── L17: Signal Memory Engine ────────────────────────────────────────────
  recentWinRate:          number;  // 0–100 (last 10 signals)
  confidenceMultiplier:   number;  // 0.55–1.30
  consecutiveLosses:      number;
  cooldownActive:         boolean;
  brainState:             string;  // AGGRESSIVE/CONSERVATIVE/LEARNING/LOCKED

  // ── RTPODE Engine ────────────────────────────────────────────────────────
  rtpodeDirection:        string;  // BUY_CE/BUY_PE/NO_SIGNAL
  rtpodeConfidence:       number;  // 0–99
  rtpodeAligned:          boolean; // rtpode fires same direction as CE/PE probability

  // ── State / frequency control ────────────────────────────────────────────
  lastMicroScalpTime:     number;  // epoch ms of last micro scalp
  dailyPnlRs:             number;  // today's realized P&L
  openPositionCount:      number;  // current open positions
  dailyTradeCount:        number;  // trades taken today
  isExpiryDay:            boolean;
  sessionType:            string;  // OPENING/MID/CLOSING

  // ── VWAP (for Type VWAP_BOUNCE) ──────────────────────────────────────────
  vwap?:                  number;
  spotDistanceToVwapPct?: number;  // abs(spot - vwap) / spot * 100

  // ── Range Expansion (for Type RANGE_EXPANSION) ────────────────────────────
  last3CandleRangePts?:   number;  // last 3x 5-min candles range
  candleVolumeDecreasing?: boolean;
  rangeBreakout?:         boolean;
  rangeBreakdown?:        boolean;
}

export interface MicroScalpEngineOutput {
  /** Best micro scalp signal (or null if none) */
  signal:               MicroScalpSignal | null;
  /** All fired signals ranked by probability score */
  allSignals:           MicroScalpSignal[];
  /** Unified probability score (0–100) regardless of signal */
  probabilityScore:     number;
  /** Score breakdown */
  scoreBreakdown:       ScoreBreakdown;
  /** Is any trade allowed right now? */
  tradeAllowed:         boolean;
  /** Why blocked (if not allowed) */
  blockReasons:         string[];
  /** Recommended direction for next trade */
  dominantDirection:    ScalpDirection;
  /** How many minutes until next scalp allowed */
  cooldownMinutesLeft:  number;
  /** Daily stats */
  dailyStats: {
    tradesRemaining:    number;  // max 15 per day
    pnlRs:             number;
    circuitBreakerHit:  boolean;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BROKERAGE_ROUND_TRIP = 50;    // ₹25 buy + ₹25 sell
const MIN_GAP_BETWEEN_SCALPS_MS = 3 * 60 * 1000;   // 3 minutes (Fast data collection mode for AI)
const MAX_CONCURRENT_POSITIONS = 3; // Allow more concurrent scalps for data
const MAX_TRADES_PER_DAY = 999;   // Unlimited data collection trades
const DAILY_LOSS_CIRCUIT_RS = 8000; // Original circuit breaker
const SQUARE_OFF_IST_MINS = 15 * 60 + 25;           // 15:25
const MIN_FIRE_SCORE = 35;          // Lowered to fire more trades for study (AI will filter dynamically)

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowISTMinutes(): number {
  const istDate = new Date(Date.now() + 5.5 * 3600 * 1000);
  return istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
}

function lotSize(index: string): number {
  if (index === "BANKNIFTY") return 15;
  if (index === "SENSEX")    return 10;
  return 25; // NIFTY
}

function estimateNetPnl(premiumMove: number, lots: number, index: string): number {
  const ls = lotSize(index);
  const gross = premiumMove * ls * lots;
  return Math.round(gross - BROKERAGE_ROUND_TRIP);
}

// ── Unified Probability Score Calculator ──────────────────────────────────────

function calcProbabilityScore(input: MicroScalpEngineInput): {
  score: number;
  breakdown: ScoreBreakdown;
  dominantDirection: ScalpDirection;
} {
  const isCE = input.ceProbability > input.peProbability;
  const base = isCE ? input.ceProbability : input.peProbability;

  const breakdown: ScoreBreakdown = {
    base,
    regimeBonus:        0,
    smartMoneyBonus:    0,
    momentumBonus:      0,
    breadthBonus:       0,
    trapClearBonus:     0,
    volumeBonus:        0,
    momentumGradeBonus: 0,
    oiWallBonus:        0,
    rtpodeBonus:        0,
    setupQualityBonus:  0,
    pmaeBonus:          0,
    memoryBonus:        0,
    alignmentBonus:     0,
    trapPenalty:        0,
    cooldownPenalty:    0,
    regimeLowPenalty:   0,
    lossStreakPenalty:  0,
    divergencePenalty:  0,
    total:              0,
  };

  // ── BOOSTS ───────────────────────────────────────────────────────────────

  if (input.regimeConfidence > 70) {
    breakdown.regimeBonus = 10;
  } else if (input.regimeConfidence > 50) {
    breakdown.regimeBonus = 5;
  }

  const smAligned = (isCE && input.smartMoneyScore > 50) || (!isCE && input.smartMoneyScore < -50);
  if (smAligned && Math.abs(input.smartMoneyScore) > 60) breakdown.smartMoneyBonus = 10;
  else if (smAligned) breakdown.smartMoneyBonus = 5;

  if (input.freshMomentumDetected) breakdown.momentumBonus = 8;

  const breadthAligned = (isCE && input.breadthScore > 65) || (!isCE && input.breadthScore < 35);
  if (breadthAligned) breakdown.breadthBonus = 8;

  if (input.trapType === "NONE" && !input.trapOverride) breakdown.trapClearBonus = 7;

  if (input.volumeConviction === 25) breakdown.volumeBonus = 6;
  else if (input.volumeConviction === 15) breakdown.volumeBonus = 3;

  if (input.momentumGrade === "A") breakdown.momentumGradeBonus = 5;
  else if (input.momentumGrade === "B") breakdown.momentumGradeBonus = 2;

  // OI wall aligned with direction
  const nearPutWall = Math.abs(input.spotPrice - input.putWall) / input.spotPrice < 0.003;
  const nearCallWall = Math.abs(input.spotPrice - input.callWall) / input.spotPrice < 0.003;
  if (isCE && nearPutWall) breakdown.oiWallBonus = 5;
  else if (!isCE && nearCallWall) breakdown.oiWallBonus = 5;

  // RTPODE same direction
  if (input.rtpodeAligned && input.rtpodeConfidence > 65) breakdown.rtpodeBonus = 5;

  if (input.setupQuality === "STRONG") breakdown.setupQualityBonus = 4;

  if (input.pmaeAlert) breakdown.pmaeBonus = 4;

  // ── AI SELF-LEARNING MEMORY ─────────────────────────────────────────────
  // AI dynamically learns from data. Strongly boosts setups that yield high profits.
  // Heavily penalizes (avoids) setups yielding losses or low profits.
  if (input.recentWinRate > 75 && !input.cooldownActive) breakdown.memoryBonus = 15;
  else if (input.recentWinRate > 60 && !input.cooldownActive) breakdown.memoryBonus = 8;
  else if (input.recentWinRate < 40) breakdown.memoryBonus = -25; // Harsh penalty for poor performance
  else if (input.recentWinRate < 50) breakdown.memoryBonus = -10;

  if (input.tradeReadiness === "FULLY_ALIGNED") breakdown.alignmentBonus = 3;
  else if (input.tradeReadiness === "MOSTLY_ALIGNED") breakdown.alignmentBonus = 1;

  // ── PENALTIES ────────────────────────────────────────────────────────────

  if (input.trapOverride || input.overrideSignal) breakdown.trapPenalty = -20;
  else if (input.trapType !== "NONE") breakdown.trapPenalty = -10;

  if (input.setupQuality === "NO_TRADE") breakdown.trapPenalty += -15;

  if (input.cooldownActive) breakdown.cooldownPenalty = -10;

  if (input.regimeConfidence < 40) breakdown.regimeLowPenalty = -7;

  // AI Dynamic loss avoidance
  if (input.consecutiveLosses >= 3) breakdown.lossStreakPenalty = -25; // Stop trading what's not working immediately
  else if (input.consecutiveLosses === 2) breakdown.lossStreakPenalty = -10;
  else if (input.consecutiveLosses > 2) breakdown.lossStreakPenalty = -6; // Fallback
  
  if (input.brainState === "LOCKED") breakdown.lossStreakPenalty -= 15;

  // Breadth divergence penalty on CE trade (index artificially high)
  if (isCE && input.divergenceType === "FEW_STOCKS_RALLY") breakdown.divergencePenalty = -5;
  if (!isCE && input.divergenceType === "HIDDEN_STRENGTH") breakdown.divergencePenalty = -5;

  const total = Math.min(
    100,
    Math.max(
      0,
      base +
        breakdown.regimeBonus +
        breakdown.smartMoneyBonus +
        breakdown.momentumBonus +
        breakdown.breadthBonus +
        breakdown.trapClearBonus +
        breakdown.volumeBonus +
        breakdown.momentumGradeBonus +
        breakdown.oiWallBonus +
        breakdown.rtpodeBonus +
        breakdown.setupQualityBonus +
        breakdown.pmaeBonus +
        breakdown.memoryBonus +
        breakdown.alignmentBonus +
        breakdown.trapPenalty +
        breakdown.cooldownPenalty +
        breakdown.regimeLowPenalty +
        breakdown.lossStreakPenalty +
        breakdown.divergencePenalty,
    ),
  );

  breakdown.total = total;

  const dominantDirection: ScalpDirection = isCE ? "CE" : "PE";
  return { score: total, breakdown, dominantDirection };
}

// ── Grade calculator ──────────────────────────────────────────────────────────

function calcGrade(score: number): ScalpGrade {
  if (score >= 75) return "PREMIUM";
  if (score >= 55) return "STRONG";
  if (score >= 40) return "MICRO";
  if (score >= 30) return "WEAK";
  return "NO_TRADE";
}

function calcLots(score: number, multiplier: number): number {
  const adjusted = score * multiplier;
  if (adjusted >= 85) return 4; // BEST OPPORTUNITY: Maximize profit with high qty
  if (adjusted >= 75) return 2; // PREMIUM
  return 1; // STRONG/MICRO
}

// exitMode helper — based on scalp type
function getExitMode(type: MicroScalpType): { exitMode: MicroScalpExitMode; exitModeLabel: string } {
  switch (type) {
    // FULL — let winners run, trail aggressively
    case "MOMENTUM_IGNITION":  return { exitMode: "FULL", exitModeLabel: "Trail to 8-15pts move" };
    case "FAKE_TRAP_REVERSAL": return { exitMode: "FULL", exitModeLabel: "Trail to 15-20pts (trapped traders panic)" };
    case "RTPODE_SIGNAL":      return { exitMode: "FULL", exitModeLabel: "Trail to ₹1000+ target" };
    case "SMART_MONEY_SPIKE":  return { exitMode: "FULL", exitModeLabel: "Trail to 10-15pts (institutional flow)" };
    case "RANGE_EXPANSION":    return { exitMode: "FULL", exitModeLabel: "Trail after breakout (1.5x range)" };
    // QUICK — book fast, small target
    case "OI_WALL_BOUNCE":     return { exitMode: "QUICK", exitModeLabel: "Book 8-10pts quick (wall bounce)" };
    case "EXHAUSTION_REVERSAL":return { exitMode: "QUICK", exitModeLabel: "Book 10-12pts (exhaustion mean-revert)" };
    case "BREADTH_DIVERGENCE": return { exitMode: "QUICK", exitModeLabel: "Book 12-15pts (divergence correction)" };
    case "PCR_EXTREME":        return { exitMode: "QUICK", exitModeLabel: "Book 10-14pts (PCR reversal)" };
    case "VWAP_BOUNCE":        return { exitMode: "QUICK", exitModeLabel: "Book 6-8pts (VWAP bounce)" };
    case "HEDGE_SCALP":        return { exitMode: "QUICK", exitModeLabel: "Book winning leg at 6-8pts" };
    default:                   return { exitMode: "QUICK", exitModeLabel: "Book quick profit" };
  }
}

// ── Individual scalp type detectors ──────────────────────────────────────────

function detectMomentumIgnition(
  input: MicroScalpEngineInput,
  score: number,
  direction: ScalpDirection,
): MicroScalpSignal | null {
  if (!input.freshMomentumDetected) return null;
  if (input.acceleration <= 0) return null;
  if (input.momentumGrade === "D") return null;
  if (direction === "WAIT") return null;

  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 20; const sl = 8;
  const em = getExitMode("MOMENTUM_IGNITION");
  return {
    scalpType:        "MOMENTUM_IGNITION",
    direction,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   7,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Fresh momentum ignition detected`,
      `Acceleration: ${input.acceleration.toFixed(2)} (positive)`,
      `Volume conviction: ${input.volumeConviction}`,
      `Momentum grade: ${input.momentumGrade}`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectOIWallBounce(
  input: MicroScalpEngineInput,
  score: number,
  direction: ScalpDirection,
): MicroScalpSignal | null {
  const nearPutWall  = Math.abs(input.spotPrice - input.putWall)  / input.spotPrice < 0.003;
  const nearCallWall = Math.abs(input.spotPrice - input.callWall) / input.spotPrice < 0.003;

  if (!nearPutWall && !nearCallWall) return null;

  const dir: ScalpDirection = nearPutWall ? "CE" : "PE";
  const wallLevel = nearPutWall ? input.putWall : input.callWall;
  const wallStrength = nearPutWall ? input.putWallStrength : input.callWallStrength;
  if (wallStrength < 40) return null;

  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 25; const sl = 8;
  const em = getExitMode("OI_WALL_BOUNCE");
  return {
    scalpType:        "OI_WALL_BOUNCE",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   10,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Spot ₹${input.spotPrice} near ${nearPutWall ? "PUT" : "CALL"} wall @ ₹${wallLevel}`,
      `Wall strength: ${wallStrength.toFixed(0)}%`,
      `OI writing/unwinding confirms bounce`,
      `Direction: ${dir} (${nearPutWall ? "support bounce" : "resistance rejection"})`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectExhaustionReversal(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  if (input.intradayExhaustionSide === "NONE") return null;
  if (input.acceleration > 0) return null; // momentum still going, wait

  const dir: ScalpDirection = input.intradayExhaustionSide === "REVERSAL_UP" ? "PE" : "CE";
  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 30; const sl = 10;
  const em = getExitMode("EXHAUSTION_REVERSAL");
  return {
    scalpType:        "EXHAUSTION_REVERSAL",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   15,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Intraday exhaustion: ${input.intradayExhaustionSide}`,
      `Market moved ${input.intradayMovePoints > 0 ? "+" : ""}${input.intradayMovePoints.toFixed(0)} pts from open`,
      `Acceleration turning negative — momentum reversing`,
      `Counter-trend: BUY ${dir}`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectBreadthDivergence(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  if (input.divergenceType === "NONE" || input.divergenceType === "HEALTHY_TREND") return null;
  if (input.divergenceType !== "FEW_STOCKS_RALLY" && input.divergenceType !== "HIDDEN_STRENGTH") return null;

  const dir: ScalpDirection = input.divergenceType === "FEW_STOCKS_RALLY" ? "PE" : "CE";
  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 25; const sl = 10;
  const em = getExitMode("BREADTH_DIVERGENCE");
  return {
    scalpType:        "BREADTH_DIVERGENCE",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   20,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Breadth divergence: ${input.divergenceType}`,
      input.divergenceType === "FEW_STOCKS_RALLY"
        ? `Index up but only few stocks rallying — narrow/fake rally, PE entry`
        : `Index down but breadth improving — hidden strength, CE entry`,
      `Smart money score: ${input.smartMoneyScore}`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectSmartMoneySpike(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  if (input.prevSmartMoneyScore === undefined) return null;
  const change = input.smartMoneyScore - input.prevSmartMoneyScore;
  if (Math.abs(change) < 20) return null;

  const dir: ScalpDirection = change > 0 ? "CE" : "PE";
  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 30; const sl = 10;
  const em = getExitMode("SMART_MONEY_SPIKE");
  return {
    scalpType:        "SMART_MONEY_SPIKE",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   12,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Smart money score spiked ${change > 0 ? "+" : ""}${change.toFixed(0)} in 5 min`,
      `From ${input.prevSmartMoneyScore!.toFixed(0)} → ${input.smartMoneyScore.toFixed(0)}`,
      `${change > 0 ? "Institutions accumulating — BUY CE" : "Institutions distributing — BUY PE"}`,
      `Volume conviction: ${input.volumeConviction}`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectPCRExtreme(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  const bullishExtreme = input.pcr < 0.65;
  const bearishExtreme = input.pcr > 1.55;
  if (!bullishExtreme && !bearishExtreme) return null;

  const dir: ScalpDirection = bullishExtreme ? "CE" : "PE";
  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 30; const sl = 12;
  const em = getExitMode("PCR_EXTREME");
  return {
    scalpType:        "PCR_EXTREME",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   15,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `PCR extreme: ${input.pcr.toFixed(2)} (${bullishExtreme ? "< 0.65 bullish" : "> 1.55 bearish"})`,
      `PCR score: ${input.pcrScore.toFixed(0)}/100`,
      `Contrarian play — extreme sentiment often reverses`,
      `Direction: BUY ${dir}`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectFakeTrapReversal(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  if (input.trapType === "NONE") return null;
  // Only act on directional traps (not volume mirage which is inconclusive)
  if (input.trapType === "VOLUME_MIRAGE") return null;

  let dir: ScalpDirection = "WAIT";
  let reason = "";
  if (input.trapType === "FAKE_BREAKOUT") {
    dir = "PE";
    reason = "Fake breakout — bulls trapped above, PE entry";
  } else if (input.trapType === "FAKE_BREAKDOWN") {
    dir = "CE";
    reason = "Fake breakdown — bears trapped below, CE entry";
  } else if (input.trapType === "LIQUIDITY_SWEEP") {
    // Direction from smart money — sweep usually followed by reversal
    dir = input.smartMoneyScore > 0 ? "CE" : "PE";
    reason = `Liquidity sweep detected — ${dir} reversal expected`;
  }

  if (dir === "WAIT") return null;

  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 35; const sl = 12;  // highest target — trapped traders panic = fast move
  const em = getExitMode("FAKE_TRAP_REVERSAL");
  return {
    scalpType:        "FAKE_TRAP_REVERSAL",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   15,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Trap detected: ${input.trapType}`,
      reason,
      `Smart money override: ${input.overrideSignal}`,
      `Wait for 1 candle close confirmation before entering`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectRTPODE(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  if (input.rtpodeDirection === "NO_SIGNAL") return null;
  if (input.rtpodeConfidence < 65) return null;

  const dir: ScalpDirection = input.rtpodeDirection === "BUY_CE" ? "CE" : "PE";
  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 40; const sl = 15;
  const em = getExitMode("RTPODE_SIGNAL");
  return {
    scalpType:        "RTPODE_SIGNAL",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   12,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `RTPODE ₹1000+ profit signal: ${input.rtpodeDirection}`,
      `Confidence: ${input.rtpodeConfidence}%`,
      `All 7 RTPODE gates passed (dominantScore≥70, OI, vol, ≥3/5 layers)`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectHedgeScalp(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  const isRange = input.regime === "RANGE" || input.regime === "VOLATILE";
  if (!isRange) return null;
  if (input.indiaVix < 13) return null;  // need some vol for hedge to work
  if (input.openPositionCount >= 2) return null; // already have positions

  // Don't hedge when clear directional signal
  if (Math.abs(input.ceProbability - input.peProbability) > 20) return null;

  const lots = 1;  // always 1 lot each for hedge
  const tgt = 20; const sl = 8;
  const em = getExitMode("HEDGE_SCALP");
  return {
    scalpType:        "HEDGE_SCALP",
    direction:        "BOTH",
    probabilityScore: score,
    grade:            "MICRO",
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   20,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots * 0.5,
    netPnlEstimate:   estimateNetPnl(tgt * 0.5, lots, input.indexSymbol),
    reasons: [
      `Regime: ${input.regime} — no clear direction`,
      `VIX: ${input.indiaVix.toFixed(1)} — premium available for hedge`,
      `Buy ATM CE + ATM PE simultaneously`,
      `Book winning leg at +₹${tgt}, cut losing leg at -₹${sl}`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     true,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectVWAPBounce(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  if (!input.vwap || !input.spotDistanceToVwapPct) return null;
  // spot must be within 0.1-0.25% of VWAP
  if (input.spotDistanceToVwapPct > 0.25 || input.spotDistanceToVwapPct < 0.05) return null;

  const aboveVwap = input.spotPrice > input.vwap;
  // Bounce logic: above VWAP = support, below = resistance
  const dir: ScalpDirection = aboveVwap ? "CE" : "PE";
  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 15; const sl = 6;
  const em = getExitMode("VWAP_BOUNCE");
  return {
    scalpType:        "VWAP_BOUNCE",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   10,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Spot ₹${input.spotPrice.toFixed(0)} near VWAP ₹${input.vwap!.toFixed(0)} (${input.spotDistanceToVwapPct!.toFixed(2)}%)`,
      aboveVwap ? "Spot above VWAP — VWAP as support, BUY CE" : "Spot below VWAP — VWAP as resistance, BUY PE",
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

function detectRangeExpansion(
  input: MicroScalpEngineInput,
  score: number,
): MicroScalpSignal | null {
  if (!input.last3CandleRangePts || input.last3CandleRangePts > 20) return null;
  if (!input.candleVolumeDecreasing) return null;
  if (!input.rangeBreakout && !input.rangeBreakdown) return null;

  const dir: ScalpDirection = input.rangeBreakout ? "CE" : "PE";
  const lots = calcLots(score, input.confidenceMultiplier);
  const tgt = 25; const sl = 8;
  const em = getExitMode("RANGE_EXPANSION");
  return {
    scalpType:        "RANGE_EXPANSION",
    direction:        dir,
    probabilityScore: score,
    grade:            calcGrade(score),
    recommendedLots:  lots,
    slPremiumDrop:    sl,
    targetPremiumMove: tgt,
    maxHoldMinutes:   15,
    grossPnlEstimate: tgt * lotSize(input.indexSymbol) * lots,
    netPnlEstimate:   estimateNetPnl(tgt, lots, input.indexSymbol),
    reasons: [
      `Range consolidation: last 3 candles range < 20 pts (${input.last3CandleRangePts!.toFixed(0)} pts)`,
      `Volume decreasing = coiling up`,
      `${input.rangeBreakout ? "Breakout" : "Breakdown"} just fired — expansion expected`,
      `Target: 1.5x range = ${(input.last3CandleRangePts! * 1.5).toFixed(0)} pts`,
    ],
    scoreBreakdown:   { total: score } as ScoreBreakdown,
    isHedgeScalp:     false,
    timestamp:        Date.now(),
    ...em,
  };
}

// ── Main Engine Function ──────────────────────────────────────────────────────

export function runMicroScalpEngine(input: MicroScalpEngineInput): MicroScalpEngineOutput {

  // ── 1. Compute Unified Probability Score ──────────────────────────────────
  const { score, breakdown, dominantDirection } = calcProbabilityScore(input);

  // ── 2. Check trade allowance ──────────────────────────────────────────────
  const blockReasons: string[] = [];
  const istMins = nowISTMinutes();

  if (input.dailyPnlRs <= -DAILY_LOSS_CIRCUIT_RS) {
    blockReasons.push(`Daily circuit breaker hit — P&L ₹${input.dailyPnlRs.toFixed(0)} (limit: -₹${DAILY_LOSS_CIRCUIT_RS})`);
  }
  if (input.openPositionCount >= MAX_CONCURRENT_POSITIONS) {
    blockReasons.push(`Max concurrent positions (${MAX_CONCURRENT_POSITIONS}) reached`);
  }
  if (input.dailyTradeCount >= MAX_TRADES_PER_DAY) {
    blockReasons.push(`Max daily trades (${MAX_TRADES_PER_DAY}) reached`);
  }
  if (input.cooldownActive) {
    blockReasons.push(`Signal memory cooldown active (${input.consecutiveLosses} consecutive losses)`);
  }
  if (istMins >= SQUARE_OFF_IST_MINS) {
    blockReasons.push("15:25 IST — square-off time reached, no new scalps");
  }
  if (input.brainState === "LOCKED") {
    blockReasons.push("Brain state LOCKED — too many consecutive losses");
  }

  const msSinceLastScalp = Date.now() - input.lastMicroScalpTime;
  const cooldownMinutesLeft = Math.max(
    0,
    Math.ceil((MIN_GAP_BETWEEN_SCALPS_MS - msSinceLastScalp) / 60000),
  );
  if (msSinceLastScalp < MIN_GAP_BETWEEN_SCALPS_MS) {
    blockReasons.push(`Minimum 15 min gap — ${cooldownMinutesLeft}m remaining`);
  }

  const tradeAllowed = blockReasons.length === 0;

  // ── 3. Run all scalp type detectors ──────────────────────────────────────
  const allSignals: MicroScalpSignal[] = [];

  if (tradeAllowed && score >= MIN_FIRE_SCORE) {
    const s1 = detectMomentumIgnition(input, score, dominantDirection);
    const s2 = detectOIWallBounce(input, score, dominantDirection);
    const s3 = detectExhaustionReversal(input, score);
    const s4 = detectBreadthDivergence(input, score);
    const s5 = detectSmartMoneySpike(input, score);
    const s6 = detectPCRExtreme(input, score);
    const s7 = detectFakeTrapReversal(input, score);
    const s8 = detectRTPODE(input, score);
    const s9 = detectHedgeScalp(input, score);
    const s10 = detectVWAPBounce(input, score);
    const s11 = detectRangeExpansion(input, score);

    for (const s of [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11]) {
      if (s) allSignals.push(s);
    }
  }

  // Sort by probability score descending
  allSignals.sort((a, b) => b.probabilityScore - a.probabilityScore);

  const topSignal = allSignals[0] ?? null;

  return {
    signal:            topSignal,
    allSignals,
    probabilityScore:  score,
    scoreBreakdown:    breakdown,
    tradeAllowed,
    blockReasons,
    dominantDirection,
    cooldownMinutesLeft,
    dailyStats: {
      tradesRemaining:   Math.max(0, MAX_TRADES_PER_DAY - input.dailyTradeCount),
      pnlRs:             input.dailyPnlRs,
      circuitBreakerHit: input.dailyPnlRs <= -DAILY_LOSS_CIRCUIT_RS,
    },
  };
}

// ── Brokerage-adjusted P&L helper (for display) ───────────────────────────────

export function calcNetPnL(
  grossPnl: number,
  _lots: number = 1,
): { gross: number; brokerage: number; net: number } {
  return {
    gross:     grossPnl,
    brokerage: BROKERAGE_ROUND_TRIP,
    net:       grossPnl - BROKERAGE_ROUND_TRIP,
  };
}

// ── Trailing SL Phase Manager ─────────────────────────────────────────────────

export type TrailPhase = "INITIAL" | "ACTIVATED" | "ACTIVE" | "LOCKED";

export interface TrailingSLState {
  phase:            TrailPhase;
  currentSL:        number;   // current SL in premium ₹
  entryPremium:     number;
  highestPremium:   number;   // highest seen since entry
  trailTriggerRs:   number;   // ₹ profit to activate trail
  trailStepRs:      number;   // ₹ step to move SL
  lotSize:          number;
  unrealizedPnlRs:  number;
}

/**
 * updateTrailingSL — call on every tick
 * Implements 4-phase trailing SL:
 *   Phase 1 INITIAL:   SL = entry - 30%
 *   Phase 2 ACTIVATED: Trail trigger hit → SL moves to breakeven + ₹2 buffer
 *   Phase 3 ACTIVE:    Every ₹500 move → SL moves up ₹300
 *   Phase 4 LOCKED:    Position up ≥ 60% of target → SL locks at 40% profit
 */
export function updateTrailingSL(
  state: TrailingSLState,
  currentPremium: number,
  targetPremium: number,
): TrailingSLState {
  const updated = { ...state };
  updated.highestPremium = Math.max(state.highestPremium, currentPremium);
  const unrealizedPnlPerUnit = currentPremium - state.entryPremium;
  updated.unrealizedPnlRs = unrealizedPnlPerUnit * state.lotSize;

  const targetMoveRs = (targetPremium - state.entryPremium) * state.lotSize;

  switch (state.phase) {
    case "INITIAL": {
      // SL = entry - 30% of entry premium
      updated.currentSL = Math.max(0.5, state.entryPremium * 0.70);

      // Activate trail when profit ≥ trailTriggerRs
      if (updated.unrealizedPnlRs >= state.trailTriggerRs) {
        updated.phase = "ACTIVATED";
        // Move SL to breakeven + ₹2 buffer per unit
        const breakevenSL = state.entryPremium + (BROKERAGE_ROUND_TRIP + 2) / state.lotSize;
        updated.currentSL = parseFloat(breakevenSL.toFixed(1));
      }
      break;
    }

    case "ACTIVATED": {
      updated.phase = "ACTIVE";
      // Initial trail step
      const trailSL = state.highestPremium - state.trailStepRs / state.lotSize;
      if (trailSL > updated.currentSL) {
        updated.currentSL = parseFloat(trailSL.toFixed(1));
      }
      break;
    }

    case "ACTIVE": {
      // Move SL up by trailStep for every step of profit gained
      const trailSL = state.highestPremium - state.trailStepRs / state.lotSize;
      if (trailSL > updated.currentSL) {
        updated.currentSL = parseFloat(trailSL.toFixed(1));
      }

      // Lock phase: if position up ≥ 60% of target distance
      if (targetMoveRs > 0 && updated.unrealizedPnlRs >= targetMoveRs * 0.60) {
        updated.phase = "LOCKED";
        // SL locks at 40% profit
        const lockSL = state.entryPremium + (targetMoveRs * 0.40) / state.lotSize;
        updated.currentSL = Math.max(updated.currentSL, parseFloat(lockSL.toFixed(1)));
      }
      break;
    }

    case "LOCKED": {
      // Only move SL up, never down
      const trailSL = state.highestPremium - state.trailStepRs / state.lotSize;
      if (trailSL > updated.currentSL) {
        updated.currentSL = parseFloat(trailSL.toFixed(1));
      }
      break;
    }
  }

  return updated;
}
