import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { BreakoutState } from "./breakoutEngine.js";
import type { MomentumStateResult } from "./momentumEngine.js";
import type { AIStrategySetup } from "./expiryStrategyEngine.js";
import type { SmartMoneySignal } from "./smartMoneyEngine.js";
import type { StrategyAlignment } from "./strategyAlignmentEngine.js";
import type { DailyBias } from "./positionStructureEngine.js";
import { getProximityPenalty } from "./swingLevelEngine.js";  // Layer 13
import { getISTTime } from "../utils/timerUtils.js";

// ── Expiry Date Parser ────────────────────────────────────────────────────────
// Parses Fyers expiry format "28-JUN-2025" → Date object
const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};
function parseExpiryDate(expiry: string): Date | null {
  try {
    const parts = expiry.split("-");
    if (parts.length !== 3) return null;
    const d = parseInt(parts[0], 10);
    const mo = MONTH_MAP[parts[1].toUpperCase()];
    const y = parseInt(parts[2], 10);
    if (isNaN(d) || mo === undefined || isNaN(y)) return null;
    return new Date(Date.UTC(y, mo, d));
  } catch { return null; }
}

/** Returns true if today (IST) matches the given expiry string */
export function checkIsExpiryDay(selectedExpiry: string): boolean {
  const expiryDate = parseExpiryDate(selectedExpiry);
  if (!expiryDate) return false;
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  return (
    expiryDate.getUTCDate()  === istNow.getUTCDate()  &&
    expiryDate.getUTCMonth() === istNow.getUTCMonth() &&
    expiryDate.getUTCFullYear() === istNow.getUTCFullYear()
  );
}

export type SignalGrade = "A" | "B" | "C" | "D";
export type MarketRegime = "TRENDING" | "RANGING" | "VOLATILE" | "EXPIRY_DAY";
export type FinalSignal = "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";

export interface AntigravityDecision {
  finalSignal: FinalSignal;
  signalGrade: SignalGrade;          // A=fire, B=probable, C=wait, D=no-trade
  antigravityScore: number;          // -100 to +100
  confidence: number;                // 0-100 adjusted for win rate
  marketRegime: MarketRegime;
  activeFilters: string[];           // Active no-trade filter names
  reasoning: string;                 // Full explainability chain
  gradeExplanation: string;          // User-facing grade description
  scoreBreakdown: {
    marketStructure: number;         // +/- up to 30
    smartMoney: number;              // +/- up to 25
    breakoutConfirmation: number;    // +/- up to 20
    momentumStrength: number;        // +/- up to 15
    timeValidity: number;            // up to 10
    dailyBias: number;               // +/- up to 15 (Layer 11)
  };
  // ── Layer 11+12 additions ─────────────────────────────────────────
  indiaVix: number;                  // Live India VIX at time of signal
  vixCategory: "LOW" | "NORMAL" | "HIGH" | "EXTREME";  // VIX zone
  dailyBiasLabel: string;            // From Layer 11 positionStructureEngine
  timestamp: number;
}

// Confidence multiplier adjusted by signal memory (Layer 8)
let confidenceMultiplier = 1.0;
export function setConfidenceMultiplier(m: number): void {
  confidenceMultiplier = Math.max(0.5, Math.min(1.5, m));
}

export function runAntigravityEngine(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  report: CompleteMarketReport,
  breakout: BreakoutState,
  momentum: MomentumStateResult,
  expirySetup: AIStrategySetup,
  smartMoney: SmartMoneySignal,
  alignment: StrategyAlignment,
  indiaVix: number = 0,               // Layer 12: Live India VIX
  dailyBias: DailyBias | null = null,  // Layer 11: Daily structure bias
  selectedExpiry: string = "",         // Update 2: Expiry calendar fix
  isMacroCrash: boolean = false,       // Layer 17: Macro Crash Override
): AntigravityDecision {
  const { h, m } = getISTTime();
  const timeInMins = h * 60 + m;
  const reasonParts: string[] = [];
  const activeFilters: string[] = [];

  // ── 1. Adaptive Market Regime Detection (Layer 10) ────────────────────────
  // Layer 12: India VIX is now live-wired from caller (marketState.niftyOptionChain.indiaVix)
  const vix = indiaVix;
  const vixCategory: AntigravityDecision["vixCategory"] =
    vix <= 0   ? "NORMAL" :   // No data — treat as normal
    vix < 14   ? "LOW"    :   // Cheap premiums — great for option buying
    vix < 20   ? "NORMAL" :
    vix < 28   ? "HIGH"   :   // Expensive premiums — caution
                 "EXTREME";   // VIX spike — avoid buying (above 28)
  let marketRegime: MarketRegime = "RANGING";

  // ── Update 2: Real expiry detection from selectedExpiry string ──────────────
  const isExpiry = selectedExpiry ? checkIsExpiryDay(selectedExpiry) : false;
  const { trend, speed } = report;

  if (isExpiry) {
    marketRegime = "EXPIRY_DAY";
    reasonParts.push(`EXPIRY_DAY detected (${selectedExpiry})`);
  } else if (trend.alignment !== "MIXED" && speed.marketState === "FAST_MARKET") {
    marketRegime = "TRENDING";
  } else if (speed.priceActionGrade === "WEAK" && trend.structureType === "RANGE_BOUND") {
    marketRegime = "RANGING";
  } else if (trend.structureType === "TRANSITION") {
    marketRegime = "VOLATILE";
  }
  reasonParts.push(`Regime=${marketRegime}`);

  // ── 2. Regime-based weight adjustments ───────────────────────────────────
  let marketStructureW = 30;
  let smartMoneyW      = 25;
  let breakoutW        = 20;
  let momentumW        = 15;
  let timeW            = 10;

  if (marketRegime === "TRENDING") {
    breakoutW += 10; momentumW += 5; smartMoneyW -= 5; marketStructureW -= 10;
  } else if (marketRegime === "RANGING") {
    smartMoneyW += 15; breakoutW -= 10; momentumW -= 5;
  } else if (marketRegime === "VOLATILE") {
    // Reduce all weights — be conservative
    marketStructureW -= 5; smartMoneyW -= 5; breakoutW -= 5; momentumW -= 5; timeW -= 5;
    activeFilters.push("VOLATILE_MARKET");
  } else if (marketRegime === "EXPIRY_DAY") {
    // Expiry day: momentum and breakout matter most, structure less so
    momentumW += 10; breakoutW += 5; marketStructureW -= 10; smartMoneyW -= 5;
  }

  // ── 3. Score: Market Structure Component ──────────────────────────────────
  let structureScore = 0;
  const { structureType, higherHighs, lowerLows, alignment: trendAlignment, strengthPct } = trend;

  if (trendAlignment === "HIGH_CONFIDENCE_BUY") {
    structureScore = marketStructureW; // Full positive
  } else if (trendAlignment === "HIGH_CONFIDENCE_SELL") {
    structureScore = -marketStructureW; // Full negative
  } else {
    // Partial scoring based on structure
    if (structureType === "UPTREND" && higherHighs) structureScore = Math.round(marketStructureW * 0.6);
    else if (structureType === "DOWNTREND" && lowerLows) structureScore = -Math.round(marketStructureW * 0.6);
    else if (structureType === "TRANSITION") structureScore = 0;
    // Strength bias
    structureScore += Math.round(((strengthPct - 50) / 50) * (marketStructureW * 0.4));
  }
  structureScore = Math.max(-marketStructureW, Math.min(marketStructureW, structureScore));
  reasonParts.push(`Structure=${structureScore}/${marketStructureW} (${structureType})`);

  // ── 4. Score: Smart Money Component ───────────────────────────────────────
  let smartMoneyScore = 0;
  if (smartMoney.direction === "BULLISH" && smartMoney.confidence >= 55) {
    smartMoneyScore = Math.round((smartMoney.confidence / 100) * smartMoneyW);
  } else if (smartMoney.direction === "BEARISH" && smartMoney.confidence >= 55) {
    smartMoneyScore = -Math.round((smartMoney.confidence / 100) * smartMoneyW);
  }
  reasonParts.push(`SmartMoney=${smartMoneyScore}/${smartMoneyW} (${smartMoney.eventType})`);

  // ── 5. Score: Breakout Confirmation Component ──────────────────────────────
  let breakoutScore = 0;
  const trapPenalty = Math.round((breakout.trapProbability / 100) * breakoutW);
  if (breakout.breakoutType === "BULLISH_BREAKOUT") {
    breakoutScore = breakoutW - trapPenalty;
  } else if (breakout.breakoutType === "BEARISH_BREAKDOWN") {
    breakoutScore = -(breakoutW - trapPenalty);
  } else if (breakout.breakoutType === "FAKE_BREAKOUT") {
    breakoutScore = 0; // Fake breakout = neutral, not penalized further
    activeFilters.push("FAKE_BREAKOUT_DETECTED");
  }
  reasonParts.push(`Breakout=${breakoutScore}/${breakoutW} (trap=${breakout.trapProbability}%)`);

  // ── 6. Score: Momentum Strength Component ─────────────────────────────────
  let momentumScore = 0;
  const momBase = (momentum.momentumScore / 100) * momentumW;
  if (momentum.direction === "UP") momentumScore = Math.round(momBase);
  else if (momentum.direction === "DOWN") momentumScore = -Math.round(momBase);
  reasonParts.push(`Momentum=${momentumScore}/${momentumW} (dir=${momentum.direction})`);

  // ── 7. Score: Time Validity Component ─────────────────────────────────────────
  let timeScore = 0;
  // IQ200 Fix: Expanded windows — full session coverage, no mid-day gap
  // Best windows: Opening (9:25-11:00), Mid-session (11:00-13:30), Afternoon (13:30-14:45)
  // Previously 11:00-13:30 only got 50% score → Grade D → no trades for 2.5 hours
  const isMarketOpen = timeInMins >= 9 * 60 + 15 && timeInMins <= 15 * 60 + 30;

  // Opening burst window — highest momentum, gamma and breakouts fire here
  const isOpeningWindow = timeInMins >= 9 * 60 + 25 && timeInMins <= 11 * 60;
  // Mid-session window — trending phase, consistent flow (previously dead zone)
  const isMidSessionWindow = timeInMins > 11 * 60 && timeInMins <= 13 * 60 + 30;
  // Afternoon reversal/gamma window — strong directional moves into close
  const isAfternoonWindow = timeInMins > 13 * 60 + 30 && timeInMins <= 14 * 60 + 45;
  // Expiry: extend best window to 15:15
  const isExpiryWindow = isExpiry && timeInMins >= 9 * 60 + 25 && timeInMins <= 15 * 60 + 15;

  const isBestWindow = isOpeningWindow || isAfternoonWindow || isExpiryWindow;

  if (isBestWindow) {
    timeScore = timeW;                          // 100% — opening/afternoon/expiry
  } else if (isMidSessionWindow) {
    timeScore = Math.round(timeW * 0.8);        // 80% — mid-session (was 50%, IQ200 fix)
  } else if (isMarketOpen) {
    timeScore = Math.round(timeW * 0.5);        // 50% — before 9:25 or after 14:45
  }
  reasonParts.push(`Time=${timeScore}/${timeW} (opening=${isOpeningWindow}, mid=${isMidSessionWindow}, afternoon=${isAfternoonWindow}, expiry=${isExpiryWindow})`);

  // ── 8. Layer 11: Daily Bias Score ─────────────────────────────────────────
  let dailyBiasScore = 0;
  const dailyBiasW = 15; // +/- 15 points
  if (dailyBias) {
    if (dailyBias.bias === "STRONG_BULL") dailyBiasScore = dailyBiasW;
    else if (dailyBias.bias === "BULL")   dailyBiasScore = Math.round(dailyBiasW * 0.6);
    else if (dailyBias.bias === "BEAR")   dailyBiasScore = -Math.round(dailyBiasW * 0.6);
    else if (dailyBias.bias === "STRONG_BEAR") dailyBiasScore = -dailyBiasW;
    // NEUTRAL = 0
    reasonParts.push(`DailyBias=${dailyBias.bias} (score=${dailyBiasScore}, EMA: ${dailyBias.emaAlignment})`);
  }

  // ── 9. Layer 13: S&R Proximity Penalty ────────────────────────────────────
  // If spot is near a key resistance (for CE) or support (for PE), penalize
  const tentativeDir: "BUY_CE" | "BUY_PE" = (structureScore + smartMoneyScore + breakoutScore + momentumScore + dailyBiasScore) >= 0 ? "BUY_CE" : "BUY_PE";
  const proximityPenalty = getProximityPenalty(page, tentativeDir);
  if (proximityPenalty < 0) {
    activeFilters.push("SR_PROXIMITY_WARNING");
    reasonParts.push(`Layer13: S/R Proximity penalty=${proximityPenalty} pts (${tentativeDir} near key level)`);
  }

  // ── 10. Total ANTIGRAVITY Score ─────────────────────────────────────────
  const rawScore = structureScore + smartMoneyScore + breakoutScore + momentumScore + timeScore + dailyBiasScore + proximityPenalty;

  // Normalize to -100..+100 based on max possible
  const maxPossible = marketStructureW + smartMoneyW + breakoutW + momentumW + timeW + dailyBiasW;
  const antigravityScore = Math.round((rawScore / maxPossible) * 100);

  // ── 10. No-Trade System Filters ───────────────────────────────────────────
  if (alignment.noTradeFilter) {
    activeFilters.push("STRATEGY_NOT_ALIGNED");
    if (alignment.noTradeReason) reasonParts.push(`NoTrade: ${alignment.noTradeReason}`);
  }
  if (breakout.trapProbability >= 70) {
    activeFilters.push("HIGH_TRAP_PROBABILITY");
  }
  if (marketRegime === "VOLATILE") {
    activeFilters.push("VOLATILE_REGIME");
  }
  // ── Layer 12: Live VIX Filters ────────────────────────────────────────────
  if (vixCategory === "EXTREME") {
    // VIX spike > 25 — option premiums are extremely expensive, avoid buying
    activeFilters.push("VIX_EXTREME_AVOID_BUYING");
    reasonParts.push(`VIX=${vix.toFixed(1)} EXTREME — Premiums too expensive!`);
  } else if (vixCategory === "HIGH") {
    activeFilters.push("HIGH_VIX_CAUTION");
    reasonParts.push(`VIX=${vix.toFixed(1)} HIGH — Reduced confidence on premium buys`);
  } else if (vixCategory === "LOW" && vix > 0) {
    // VIX < 13 = cheap premiums, bonus score already factored in
    reasonParts.push(`VIX=${vix.toFixed(1)} LOW ✅ — Cheap premiums, ideal for position buy`);
  } else if (vix > 0) {
    reasonParts.push(`VIX=${vix.toFixed(1)} NORMAL`);
  }

  // ── 11. Signal Grade Mapping ──────────────────────────────────────────────
  const absScore = Math.abs(antigravityScore);
  let signalGrade: SignalGrade;
  if (absScore >= 70) signalGrade = "A";
  else if (absScore >= 50) signalGrade = "B";
  else if (absScore >= 30) signalGrade = "C";
  else signalGrade = "D";

  // ── 12. Final Signal with No-Trade overrides ──────────────────────────────
  let finalSignal: FinalSignal;

  const criticalFilters = [
    "HIGH_TRAP_PROBABILITY",       // AI Brain: trap detected, avoid entry
    "FAKE_BREAKOUT_DETECTED",      // AI Brain: fake breakout, avoid entry
    "VIX_EXTREME_AVOID_BUYING",    // AI Brain: VIX >25, premiums too expensive
  ];
  const hasBlockingFilter = activeFilters.some(f => criticalFilters.includes(f));

  // ── Phase 5: SNIPER MODE OVERRIDE ──
  // If Sniper detects a volatility squeeze breakout, bypass ALL filters!
  if (breakout.sniperOverride && breakout.sniperDirection !== "NONE") {
    finalSignal = breakout.sniperDirection;
    signalGrade = "A";
    reasonParts.unshift(breakout.reasoning);
  } else if (hasBlockingFilter) {
    finalSignal = "NO_TRADE";
  } else if (signalGrade === "D" && absScore < 15) {
    finalSignal = "WAIT";  // Truly flat/conflicted — wait for clarity
  } else if (antigravityScore > 0) {
    if (isMacroCrash) {
      finalSignal = "NO_TRADE"; // Anti-Falling Knife Trap
      reasonParts.push("🚨 MACRO CRASH DETECTED: BLOCKED ALL CE (Call) ENTRIES");
    } else {
      finalSignal = "BUY_CE";
    }
  } else if (antigravityScore < 0) {
    finalSignal = "BUY_PE";
  } else {
    finalSignal = "WAIT";
  }

  // ── 12. Confidence with adaptive multiplier ───────────────────────────────
  const baseConfidence = Math.min(100, absScore);
  const adjustedConfidence = Math.round(
    Math.min(100, Math.max(0, baseConfidence * confidenceMultiplier))
  );

  // ── 13. Grade explanation ─────────────────────────────────────────────────
  const gradeExplanations: Record<SignalGrade, string> = {
    A: "HIGH CONFIDENCE — Multi-layer confirmation. Trade setup is institutional-grade.",
    B: "PROBABLE — Strong signals but wait for 1 more confirmation candle/tick.",
    C: "MIXED SIGNALS — Insufficient alignment. WAIT for clarity.",
    D: "NO TRADE ZONE — Signals conflict or quality is low. Protecting capital.",
  };

  return {
    finalSignal,
    signalGrade,
    antigravityScore,
    confidence: adjustedConfidence,
    marketRegime,
    activeFilters,
    reasoning: reasonParts.join(" | "),
    gradeExplanation: gradeExplanations[signalGrade],
    scoreBreakdown: {
      marketStructure: structureScore,
      smartMoney: smartMoneyScore,
      breakoutConfirmation: breakoutScore,
      momentumStrength: momentumScore,
      timeValidity: timeScore,
      dailyBias: dailyBiasScore,
    },
    // Layer 11 + 12 additions
    indiaVix: vix,
    vixCategory,
    dailyBiasLabel: dailyBias ? dailyBias.bias : "NOT_COMPUTED",
    timestamp: Date.now(),
  };
}
