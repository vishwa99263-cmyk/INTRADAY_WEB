/**
 * probabilityEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 8: Probability Engine v1.0
 *
 * Converts ALL upstream signals (L1–L7) into a CE vs PE probability model.
 * First true decision-quantification layer in the system.
 *
 * Output: ceProbability, peProbability, dominantSide, confidenceLevel
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layers 1–7.  Consumed by Layers 9, 10, 11, 12.
 */

import type { MarketRegimeResult }      from "./marketRegimeEngine";
import type { MarketBreadthResult }      from "./marketBreadthEngine";
import type { HeavyweightResult }        from "./heavyweightEngine";
import type { Range15MResult }           from "./range15mEngine";
import type { OptionChainEngineOutput }  from "./optionChainEngine";
import type { MomentumEngineOutput }     from "./momentumEngine";
import type { SmartMoneySignal }         from "./smartMoneyEngine";
import type { InstitutionalMacroResult } from "./institutionalMacroEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DominantSide   = "CE" | "PE" | "WAIT";
export type MarketBias     = "BULLISH" | "BEARISH" | "NEUTRAL";
export type SetupQuality   = "STRONG" | "MODERATE" | "WEAK" | "NO_TRADE";

export interface PMAEAlert {
  direction: "UP" | "DOWN";
  confidence: number;
  expectedMove: string;
  reasons: string[];
  timestamp: number;
}

export interface ProbabilityEngineResult {
  /** Probability of upward move 0–100 */
  ceProbability: number;
  /** Probability of downward move 0–100 */
  peProbability: number;
  /** Which side has the institutional edge */
  dominantSide: DominantSide;
  /** Composite confidence in the dominant side 0–100 */
  confidenceLevel: number;
  /** High-level market bias */
  marketBias: MarketBias;
  /** Setup quality classification */
  setupQuality: SetupQuality;
  /** Whether trap override is active */
  trapOverride: boolean;
  /** Human-readable reasoning */
  reasoning: string[];
  /** Raw factor contributions for diagnostics */
  factors: {
    // CE factors (each 0–max)
    ceRegime:      number;
    ceBreadth:     number;
    ceHeavyweight: number;
    ceMomentum:    number;
    ceSmartMoney:  number;
    cePCR:         number;
    ceRange:       number;
    // PE factors
    peRegime:      number;
    peBreadth:     number;
    peHeavyweight: number;
    peMomentum:    number;
    peSmartMoney:  number;
    pePCR:         number;
    peRange:       number;
  };
  volatilityScore: number;
  upProbability: number;
  downProbability: number;
  pmaeAlert: PMAEAlert | null;
}

export interface ProbabilityEngineInput {
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
  // ── Layer 17 (optional) ──────────────────────────────────────────────────
  institutionalMacroResult?: InstitutionalMacroResult;
  tradingMode?: "INTRADAY" | "SWING";
  // ── Raw PCR ─────────────────────────────────────────────────────────────
  pcr: number;
  optionChain?: any[];
  spotPrice?: number;
  score15mDiff?: number;
  isMacroCrash?: boolean;
  /** Intraday exhaustion side from momentumEngine — drives PE/CE probability boost */
  intradayExhaustionSide?: "REVERSAL_UP" | "REVERSAL_DOWN" | "NONE";
  monthlyMetrics?: {
    pcr: number;
    supportWall: number;
    resistanceWall: number;
    sentiment: string;
  };
  nextWeeklyMetrics?: {
    pcr: number;
    supportWall: number;
    resistanceWall: number;
    sentiment: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function safe(v: number | undefined | null, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeProbability(input: ProbabilityEngineInput): ProbabilityEngineResult {
  const {
    regimeResult, breadthResult, heavyweightResult, range15mResult,
    optionChainResult, momentumResult, smartMoneyResult, pcr,
  } = input;

  const reasoning: string[] = [];

  // ── CE FACTORS ────────────────────────────────────────────────────────────

  // 1. Regime bullish weight (0–15)
  const regime = regimeResult.regime;
  const ceRegime =
    regime === "BREAKOUT"      ? 15 :
    regime === "TRENDING_BULL" ? 12 :
    regime === "RANGE"         ? 5  :
    regime === "VOLATILE"      ? 3  :
    regime === "TRENDING_BEAR" ? 1  : 0; // BREAKDOWN

  // 2. Breadth contribution (0–15)
  const bs = safe(breadthResult.breadthScore);
  const ceBreadth =
    bs >= 75 ? 15 :
    bs >= 65 ? 12 :
    bs >= 55 ? 8  :
    bs >= 45 ? 4  :
    bs >= 35 ? 1  : 0;

  // 3. Heavyweight bullish pressure (0–15)
  let ceHeavyweight = 0;
  if (heavyweightResult) {
    const hDir = heavyweightResult.heavyweightDirection;
    ceHeavyweight =
      hDir === "STRONG_BULLISH" ? 15 :
      hDir === "BULLISH"        ? 10 :
      hDir === "NEUTRAL"        ? 5  : 0;
  } else {
    ceHeavyweight = 5; // neutral fallback
  }

  // 4. Momentum acceleration (0–15)
  let ceMomentum = 0;
  if (momentumResult) {
    const ms = safe(momentumResult.momentumScore);
    const ac = safe(momentumResult.acceleration);
    ceMomentum =
      ms >= 75 && ac > 5  ? 15 :
      ms >= 65 && ac > 0  ? 12 :
      ms >= 55            ? 8  :
      ms >= 45            ? 4  :
      momentumResult.freshMomentumDetected ? 10 : 1;
  } else {
    ceMomentum = 5; // neutral fallback
  }

  // 5. Smart Money accumulation (0–20)
  let ceSmartMoney = 0;
  if (smartMoneyResult) {
    const sms = safe(smartMoneyResult.smartMoneyScore);
    ceSmartMoney =
      sms >= 60  ? 20 :
      sms >= 40  ? 16 :
      sms >= 20  ? 10 :
      sms >= 0   ? 5  :
      sms >= -20 ? 2  : 0;
    if (smartMoneyResult.institutionalBias === "ACCUMULATION") ceSmartMoney = Math.max(ceSmartMoney, 16);
  } else {
    ceSmartMoney = 8; // neutral fallback
  }

  // 6. PCR bullish zone (0–10)
  const pcrVal = safe(pcr, optionChainResult ? optionChainResult.pcr : 1);
  let cePCR =
    pcrVal > 1.35 ? 10 :
    pcrVal > 1.20 ? 8  :
    pcrVal > 1.10 ? 6  :
    pcrVal > 1.02 ? 3  : 0;

  const nextWeeklyPcr = input.nextWeeklyMetrics?.pcr;
  const monthlyPcr = input.monthlyMetrics?.pcr;

  if (nextWeeklyPcr && nextWeeklyPcr > 1.02) {
    cePCR = Math.min(10, cePCR + 2); // boost CE score if next weekly PCR is also bullish
  }
  if (monthlyPcr && monthlyPcr > 1.02) {
    cePCR = Math.min(10, cePCR + 3); // boost CE score if monthly PCR is also bullish
  }

  if (pcrVal > 1.02 && nextWeeklyPcr && nextWeeklyPcr > 1.02 && monthlyPcr && monthlyPcr > 1.02) {
    reasoning.push("🔥 MULTI-EXPIRY PCR CONFLUENCE (BULLISH): Weekly, Next-Week, and Monthly PCR are all Bullish");
  }

  // 7. 15M breakout confirmation (0–10)
  let ceRange = 0;
  if (range15mResult) {
    ceRange =
      range15mResult.rangeBreakout          ? 10 :
      range15mResult.spotPosition === "ABOVE_RANGE_HIGH" ? 7 :
      range15mResult.spotPosition === "INSIDE_RANGE"     ? 3 :
      range15mResult.falseBreakout           ? 1 : 0;
  } else {
    ceRange = 3; // neutral fallback
  }

  // ── PE FACTORS ────────────────────────────────────────────────────────────

  // 1. Regime bearish weight (0–15)
  const peRegime =
    regime === "BREAKDOWN"     ? 15 :
    regime === "TRENDING_BEAR" ? 12 :
    regime === "VOLATILE"      ? 7  :
    regime === "RANGE"         ? 5  :
    regime === "TRENDING_BULL" ? 1  : 0; // BREAKOUT

  // 2. Breadth weakness (0–15)
  const peBreadth =
    bs <= 25 ? 15 :
    bs <= 35 ? 12 :
    bs <= 45 ? 8  :
    bs <= 55 ? 4  :
    bs <= 65 ? 1  : 0;

  // 3. Heavyweight bearish pressure (0–15)
  let peHeavyweight = 0;
  if (heavyweightResult) {
    const hDir = heavyweightResult.heavyweightDirection;
    peHeavyweight =
      hDir === "STRONG_BEARISH" ? 15 :
      hDir === "BEARISH"        ? 10 :
      hDir === "NEUTRAL"        ? 5  : 0;
  } else {
    peHeavyweight = 5;
  }

  // 4. Momentum decay (0–15)
  let peMomentum = 0;
  if (momentumResult) {
    const ms = safe(momentumResult.momentumScore);
    const ac = safe(momentumResult.acceleration);
    peMomentum =
      ms <= 25 && ac < -5 ? 15 :
      ms <= 35 && ac < 0  ? 12 :
      ms <= 45             ? 8  :
      momentumResult.exhaustion?.bullish ? 10 :
      ms <= 55             ? 4  : 1;
  } else {
    peMomentum = 5;
  }

  // 5. Smart Money distribution (0–20)
  let peSmartMoney = 0;
  if (smartMoneyResult) {
    const sms = safe(smartMoneyResult.smartMoneyScore);
    peSmartMoney =
      sms <= -60 ? 20 :
      sms <= -40 ? 16 :
      sms <= -20 ? 10 :
      sms <= 0   ? 5  :
      sms <= 20  ? 2  : 0;
    if (smartMoneyResult.institutionalBias === "DISTRIBUTION") peSmartMoney = Math.max(peSmartMoney, 16);
  } else {
    peSmartMoney = 8;
  }

  // 6. PCR bearish zone (0–10)
  let pePCR =
    pcrVal < 0.75 ? 10 :
    pcrVal < 0.85 ? 8  :
    pcrVal < 0.95 ? 6  :
    pcrVal < 0.98 ? 3  : 0; // neutral zone

  if (nextWeeklyPcr && nextWeeklyPcr < 0.98) {
    pePCR = Math.min(10, pePCR + 2); // boost PE score if next weekly PCR is also bearish
  }
  if (monthlyPcr && monthlyPcr < 0.98) {
    pePCR = Math.min(10, pePCR + 3); // boost PE score if monthly PCR is also bearish
  }

  if (pcrVal < 0.98 && nextWeeklyPcr && nextWeeklyPcr < 0.98 && monthlyPcr && monthlyPcr < 0.98) {
    reasoning.push("🔥 MULTI-EXPIRY PCR CONFLUENCE (BEARISH): Weekly, Next-Week, and Monthly PCR are all Bearish");
  }

  // 7. 15M breakdown confirmation (0–10)
  let peRange = 0;
  if (range15mResult) {
    peRange =
      range15mResult.rangeBreakdown         ? 10 :
      range15mResult.spotPosition === "BELOW_RANGE_LOW" ? 7 :
      range15mResult.spotPosition === "INSIDE_RANGE"    ? 3 :
      range15mResult.falseBreakout           ? 5 : 0; // false breakout = bearish trap
  } else {
    peRange = 3;
  }

  // ── RAW SCORES ───────────────────────────────────────────────────────────
  let ceScore = ceRegime + ceBreadth + ceHeavyweight + ceMomentum + ceSmartMoney + cePCR + ceRange;
  let peScore = peRegime + peBreadth + peHeavyweight + peMomentum + peSmartMoney + pePCR + peRange;

  // ── Layer 17 (Institutional Macro) Adjustment ─────────────────────────────
  if (input.tradingMode === "SWING" && input.institutionalMacroResult) {
    const bias = input.institutionalMacroResult.institutionalBias;
    if (bias === "BULLISH") {
      ceScore += 10;
      reasoning.push("🏛 FII/DII SWING MACRO BIAS (BULLISH): CE score boosted +10 based on bullish net flow");
    } else if (bias === "BEARISH") {
      peScore += 10;
      reasoning.push("🏛 FII/DII SWING MACRO BIAS (BEARISH): PE score boosted +10 based on bearish net flow");
    }
  }

  // ── INTRADAY EXHAUSTION ADJUSTMENT ─────────────────────────────────────────────
  // When market has moved far from open (exhaustion zone), override raw probability
  // to reflect the reversal side. This ensures dominantSide flips correctly.
  const exhaustionSide = input.intradayExhaustionSide ?? "NONE";
  if (exhaustionSide === "REVERSAL_UP") {
    // Market ran too far up — PE reversal probable
    peScore = Math.min(100, peScore + 20); // boost PE probability
    ceScore = Math.max(0, ceScore - 15);   // dampen CE probability
    reasoning.push("🔄 INTRADAY EXHAUSTION (UP): PE score boosted +20 | CE score reduced -15 — reversal zone active");
  } else if (exhaustionSide === "REVERSAL_DOWN") {
    if (input.isMacroCrash) {
      reasoning.push("🚨 MACRO CRASH MODE: Ignored 'Oversold Recovery' (Anti-Falling Knife). Enforcing PE dominance.");
      peScore = Math.min(100, peScore + 20); // Boost PE instead of CE in a crash
      ceScore = Math.max(0, ceScore - 15);
    } else {
      // Market fell too far — CE recovery probable
      ceScore = Math.min(100, ceScore + 20);
      peScore = Math.max(0, peScore - 15);
      reasoning.push("🔄 INTRADAY EXHAUSTION (DOWN): CE score boosted +20 | PE score reduced -15 — oversold recovery zone");
    }
  }

  // Max theoretical = 100 for each side
  const ceProbability = clamp(Math.round(ceScore));
  const peProbability = clamp(Math.round(peScore));

  // ── TRAP OVERRIDE (Layer 7 Integration) ──────────────────────────────────
  let trapPenalty = 0;
  let trapOverride = false;
  if (smartMoneyResult && smartMoneyResult.trapType !== "NONE") {
    const smConf = safe(smartMoneyResult.confidence);
    trapPenalty = smConf > 70 ? 40 : 25;
    trapOverride = smConf > 70;
    reasoning.push(`⚠ TRAP OVERRIDE ACTIVE (${smartMoneyResult.trapType}) — confidence reduced by ${trapPenalty} pts`);
  }

  // ── DOMINANT SIDE ─────────────────────────────────────────────────────────
  let dominantSide: DominantSide;
  const ceFinal = Math.max(0, ceProbability - (trapOverride ? trapPenalty : 0));
  const peFinal = Math.max(0, peProbability - (trapOverride ? trapPenalty : 0));

  if      (ceFinal > peFinal + 15) dominantSide = "CE";
  else if (peFinal > ceFinal + 15) dominantSide = "PE";
  else                             dominantSide = "WAIT";

  // ── CONFIDENCE LEVEL ─────────────────────────────────────────────────────
  const rawDiff     = Math.abs(ceFinal - peFinal);
  const smBonus     = smartMoneyResult ? Math.abs(safe(smartMoneyResult.smartMoneyScore)) * 0.1 : 0;
  const momentumBonus = momentumResult
    ? (momentumResult.momentumDirection === (dominantSide === "CE" ? "BULLISH" : "BEARISH") ? 8 : -4)
    : 0;

  let confidenceLevel = clamp(Math.round(30 + rawDiff * 1.2 + smBonus + momentumBonus - trapPenalty * 0.5));

  // ── MARKET BIAS ───────────────────────────────────────────────────────────
  const marketBias: MarketBias =
    dominantSide === "CE"   ? "BULLISH"  :
    dominantSide === "PE"   ? "BEARISH"  : "NEUTRAL";

  // ── SETUP QUALITY ─────────────────────────────────────────────────────────
  const noTrap = !smartMoneyResult || smartMoneyResult.trapType === "NONE";

  const strongCE =
    ceFinal > 65 &&
    (smartMoneyResult?.institutionalBias === "ACCUMULATION") &&
    momentumResult?.momentumDirection === "BULLISH" &&
    bs > 55 &&
    noTrap;

  const strongPE =
    peFinal > 65 &&
    (smartMoneyResult?.institutionalBias === "DISTRIBUTION") &&
    momentumResult?.momentumDirection === "BEARISH" &&
    bs < 45 &&
    noTrap;

  const waitCondition =
    (ceFinal >= 45 && ceFinal <= 55 && peFinal >= 45 && peFinal <= 55) ||
    (smartMoneyResult?.trapType !== "NONE");

  let setupQuality: SetupQuality;
  if (waitCondition)            setupQuality = "NO_TRADE";
  else if (strongCE || strongPE) setupQuality = "STRONG";
  else if (confidenceLevel >= 60) setupQuality = "MODERATE";
  else                            setupQuality = "WEAK";

  // Override to WAIT if no trade
  if (setupQuality === "NO_TRADE") {
    dominantSide     = "WAIT";
    confidenceLevel  = Math.min(confidenceLevel, 40);
  }

  // ── REASONING ─────────────────────────────────────────────────────────────
  if (strongCE) reasoning.push(`🟢 STRONG CE SETUP — All 5 institutional conditions met (CE ${ceFinal}%)`);
  if (strongPE) reasoning.push(`🔴 STRONG PE SETUP — All 5 institutional conditions met (PE ${peFinal}%)`);
  if (waitCondition && !trapOverride) reasoning.push("🟡 WAIT — CE/PE in neutral zone (45–55%), no trade edge");

  reasoning.push(
    `CE Score: ${ceFinal} | PE Score: ${peFinal} | Edge: ${Math.abs(ceFinal - peFinal).toFixed(0)} pts | Side: ${dominantSide}`
  );
  reasoning.push(
    `PCR ${pcrVal.toFixed(2)} ${pcrVal > 1.05 ? "→ Bullish bias" : pcrVal < 0.95 ? "→ Bearish bias" : "→ Neutral zone"} | Regime: ${regime} | Confidence: ${confidenceLevel}%`
  );

  // ── PMAE / Volatility Scoring Calculations ──
  const chain = input.optionChain || [];
  const spotPx = input.spotPrice || 0;
  const strikeGap = spotPx > 50000 ? 100 : 50;
  const localAtmStrike = spotPx > 0 ? Math.round(spotPx / strikeGap) * strikeGap : 0;
  const atmRow = chain.find((s: any) => s.strikePrice === localAtmStrike);

  // Average volumes and OIs across strikes for spikes
  const avgCeVolume = chain.length > 0 ? chain.reduce((sum: number, s: any) => sum + (s.ceVolume || 0), 0) / chain.length : 0;
  const avgPeVolume = chain.length > 0 ? chain.reduce((sum: number, s: any) => sum + (s.peVolume || 0), 0) / chain.length : 0;
  const totalCallOi = chain.reduce((sum: number, s: any) => sum + (s.ceOI || 0), 0);
  const totalPutOi = chain.reduce((sum: number, s: any) => sum + (s.peOI || 0), 0);
  const totalCallOiChange = chain.reduce((sum: number, s: any) => sum + (s.ceOIChange || 0), 0);
  const totalPutOiChange = chain.reduce((sum: number, s: any) => sum + (s.peOIChange || 0), 0);

  // 1. volumeSpike
  const atmVolume = atmRow ? (atmRow.ceVolume || 0) + (atmRow.peVolume || 0) : 0;
  const avgVolume = (avgCeVolume + avgPeVolume) || 1;
  const volumeRatio = atmVolume / avgVolume;
  const volumeSpike = Math.min(100, Math.max(0, (volumeRatio - 1) * 100));

  // 2. oiChangeSpeed
  const totalOI = (totalCallOi + totalPutOi) || 1;
  const totalOIChange = Math.abs(totalCallOiChange) + Math.abs(totalPutOiChange);
  const oiChangeSpeed = Math.min(100, Math.round((totalOIChange / totalOI) * 5000));

  // 3. priceRangeExpansion
  let priceRangeExpansion = 10;
  const rangeBreakout = input.range15mResult?.rangeBreakout;
  const rangeBreakdown = input.range15mResult?.rangeBreakdown;
  const spotPosition = input.range15mResult?.spotPosition;

  if (regime === "BREAKOUT" || regime === "BREAKDOWN" || rangeBreakout || rangeBreakdown) {
    priceRangeExpansion = 100;
  } else if (spotPosition === "ABOVE_RANGE_HIGH" || spotPosition === "BELOW_RANGE_LOW") {
    priceRangeExpansion = 75;
  } else if (regime === "VOLATILE") {
    priceRangeExpansion = 50;
  }

  // 4. atrMomentum
  const atrMomentum = Math.min(100, Math.round(Math.abs(input.momentumResult?.acceleration ?? 0) * 12));

  // 5. absScore15mDiff
  const absScore15mDiff = Math.min(100, Math.abs(input.score15mDiff || 0) * 4);

  // Volatility Score Formula
  const volatilityScore = Math.round(
    (absScore15mDiff * 0.3) +
    (volumeSpike * 0.2) +
    (oiChangeSpeed * 0.2) +
    (priceRangeExpansion * 0.2) +
    (atrMomentum * 0.1)
  );

  // ── Probability Calculations ──
  const putWriting = input.optionChainResult?.oiWritingUnwinding?.putWriting ?? 0;
  const putUnwinding = input.optionChainResult?.oiWritingUnwinding?.putUnwinding ?? 0;
  const putWritingStrength = Math.min(100, Math.max(0, putWriting / (putWriting + putUnwinding || 1) * 100));

  const callWriting = input.optionChainResult?.oiWritingUnwinding?.callWriting ?? 0;
  const callUnwinding = input.optionChainResult?.oiWritingUnwinding?.callUnwinding ?? 0;
  const ceUnwinding = Math.min(100, Math.max(0, callUnwinding / (callWriting + callUnwinding || 1) * 100));

  const ms = input.momentumResult?.momentumScore ?? 50;
  const momentumUp = input.momentumResult?.momentumDirection === "BULLISH"
    ? Math.min(100, Math.max(0, (ms - 30) * 1.4))
    : 0;

  const breadthBullish = input.breadthResult?.breadthScore ?? 50;

  const sms = input.smartMoneyResult?.smartMoneyScore ?? 0;
  const smartMoneyBuy = sms >= 0 ? Math.min(100, sms * 1.5) : 0;

  const upProbability = Math.round(
    (putWritingStrength * 0.25) +
    (ceUnwinding * 0.20) +
    (momentumUp * 0.20) +
    (breadthBullish * 0.15) +
    (smartMoneyBuy * 0.20)
  );

  // Down components
  const callWritingStrength = Math.min(100, Math.max(0, callWriting / (callWriting + callUnwinding || 1) * 100));
  const peUnwinding = Math.min(100, Math.max(0, putUnwinding / (putWriting + putUnwinding || 1) * 100));
  const momentumDown = input.momentumResult?.momentumDirection === "BEARISH"
    ? Math.min(100, Math.max(0, (70 - ms) * 1.4))
    : 0;
  const breadthBearish = 100 - breadthBullish;
  const smartMoneySell = sms < 0 ? Math.min(100, Math.abs(sms) * 1.5) : 0;

  const downProbability = Math.round(
    (callWritingStrength * 0.25) +
    (peUnwinding * 0.20) +
    (momentumDown * 0.20) +
    (breadthBearish * 0.15) +
    (smartMoneySell * 0.20)
  );

  // PMAE Alert Generator
  // Alert conditions: max(upProbability, downProbability) >= 70 AND volatilityScore >= 60 and no conflicting signals
  // Conflicting signals defined as: abs(upProbability - downProbability) < 15
  const hasNoConflict = Math.abs(upProbability - downProbability) >= 15;
  const maxProbability = Math.max(upProbability, downProbability);
  let pmaeAlert: PMAEAlert | null = null;

  if (maxProbability >= 80 && volatilityScore >= 60 && hasNoConflict) {
    const isUp = upProbability >= downProbability;
    const reasonsList: string[] = [];
    if (isUp) {
      if (putWritingStrength >= 40) reasonsList.push("✔ Put Writing Strong");
      if (ceUnwinding >= 40) reasonsList.push("✔ CE Unwinding");
      if (momentumUp >= 40) reasonsList.push("✔ Momentum Turning Bullish");
      if (smartMoneyBuy >= 40) reasonsList.push("✔ Smart Money Buying");
    } else {
      if (callWritingStrength >= 40) reasonsList.push("✔ Call Writing Strong");
      if (peUnwinding >= 40) reasonsList.push("✔ PE Unwinding");
      if (momentumDown >= 40) reasonsList.push("✔ Momentum Weakening");
      if (smartMoneySell >= 40) reasonsList.push("✔ Smart Money Selling");
    }
    // Fallback reasons if empty
    if (reasonsList.length === 0) {
      reasonsList.push(isUp ? "✔ Institutional Buying Bias" : "✔ Institutional Selling Bias");
      reasonsList.push("✔ Volatility Breakout Confirmation");
    }

    pmaeAlert = {
      direction: isUp ? "UP" : "DOWN",
      confidence: maxProbability,
      expectedMove: isUp ? "+40 to +70 points" : "-40 to -70 points",
      reasons: reasonsList,
      timestamp: Date.now(),
    };
  }

  return {
    ceProbability:   ceFinal,
    peProbability:   peFinal,
    dominantSide,
    confidenceLevel,
    marketBias,
    setupQuality,
    trapOverride,
    reasoning,
    factors: {
      ceRegime, ceBreadth, ceHeavyweight, ceMomentum, ceSmartMoney, cePCR, ceRange,
      peRegime, peBreadth, peHeavyweight, peMomentum, peSmartMoney, pePCR, peRange,
    },
    volatilityScore,
    upProbability,
    downProbability,
    pmaeAlert,
  };
}

// ── UI Metadata ───────────────────────────────────────────────────────────────

export const DOMINANT_SIDE_META = {
  CE: { label: "BUY CE",  emoji: "🟢", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", glow: "rgba(16,185,129,0.22)" },
  PE: { label: "BUY PE",  emoji: "🔴", color: "text-red-400",     bg: "bg-red-500/15",     border: "border-red-500/40",     glow: "rgba(239,68,68,0.22)"  },
  WAIT: { label: "WAIT",  emoji: "⚪", color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   glow: "rgba(245,158,11,0.12)" },
} as const;

export const SETUP_QUALITY_META = {
  STRONG:   { label: "STRONG SETUP",  color: "text-emerald-400", bg: "bg-emerald-500/20" },
  MODERATE: { label: "MODERATE",      color: "text-sky-400",     bg: "bg-sky-500/15"     },
  WEAK:     { label: "WEAK SETUP",    color: "text-amber-400",   bg: "bg-amber-500/15"   },
  NO_TRADE: { label: "NO TRADE ZONE", color: "text-slate-400",   bg: "bg-slate-800/60"   },
} as const;
