/**
 * smartMoneyEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 7: Smart Money Engine v1.0
 *
 * Detects institutional accumulation, distribution, and fake moves using
 * option chain flow, OI changes, volume spikes, score history, breadth,
 * regime, and heavyweight pressure.
 *
 * ⚠ Score range: -100 to +100 (bidirectional — different from other layers)
 *    Positive = smart money buying,  Negative = smart money selling
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layers 1–6 outputs.
 * Output consumed by Layers 8, 9, 10, 11, 12.
 */

import type { MarketRegimeResult }       from "./marketRegimeEngine";
import type { MarketBreadthResult }       from "./marketBreadthEngine";
import type { HeavyweightResult }         from "./heavyweightEngine";
import type { Range15MResult }            from "./range15mEngine";
import type { OptionChainEngineOutput }   from "./optionChainEngine";
import type { MomentumEngineOutput }      from "./momentumEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SmartFlowDirection    = "BULLISH" | "BEARISH" | "NEUTRAL";
export type InstitutionalBiasType = "ACCUMULATION" | "DISTRIBUTION" | "NONE";
export type TrapType              = "FAKE_BREAKOUT" | "FAKE_BREAKDOWN" | "LIQUIDITY_SWEEP" | "VOLUME_MIRAGE" | "NONE";

export interface SmartMoneySignal {
  /** Core score: -100 (full distribution) → 0 (neutral) → +100 (full accumulation) */
  smartMoneyScore: number;

  /** Directional label */
  flowDirection: SmartFlowDirection;

  /** High-conviction institutional intent */
  institutionalBias: InstitutionalBiasType;

  /** Trap classification */
  trapType: TrapType;
  trapDetails: string;

  /** Quality of signal: 0–100 */
  confidence: number;

  /** When true, this signal overrides all normal signals */
  overrideSignal: boolean;

  /** Human-readable reasoning */
  reasoning: string[];

  /** Sub-component scores for diagnostics */
  components: {
    oiPutWritingScore:    number;   // +: put writing (bullish SM)
    oiCallPressureScore:  number;   // -: call writing (bearish SM)
    volumeSpikeScore:     number;   // volume confirmation
    scoreAcceleration:    number;   // momentum from L6
    breadthAlignment:     number;   // L2 contribution
    heavyweightBonus:     number;   // L3 contribution
    regimeBonus:          number;   // L1 contribution
    rangeBonus:           number;   // L4 contribution
  };
}

export interface SmartMoneyEngineInput {
  // ── Layer 1 ─────────────────────────────────────────────────────────────
  regimeResult: MarketRegimeResult;

  // ── Layer 2 ─────────────────────────────────────────────────────────────
  breadthResult: MarketBreadthResult;

  // ── Layer 3 (optional) ───────────────────────────────────────────────────
  heavyweightResult?: HeavyweightResult;

  // ── Layer 4 (optional) ───────────────────────────────────────────────────
  range15mResult?: Range15MResult;

  // ── Layer 5 ─────────────────────────────────────────────────────────────
  optionChainResult?: OptionChainEngineOutput;

  // ── Layer 6 ─────────────────────────────────────────────────────────────
  momentumResult?: MomentumEngineOutput;

  // ── Raw Option Chain Data ────────────────────────────────────────────────
  pcr: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallOIChange: number;
  totalPutOIChange: number;
  totalCallVolume: number;
  totalPutVolume: number;

  // ── Raw Stock / Score Stream ──────────────────────────────────────────────
  /** Aggregate score (sum) */
  overallScore: number;
  /** 5M score delta */
  scoreDifference: number;
  /** 15M score delta */
  score15mDiff: number;
  /** Total volume */
  volume: number;
  /** Spot price change % */
  changePercent: number;

  /** Score history as sorted array of {time, score} for last N candles */
  scoreHistory?: { time: string; score: number }[];
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
  spotPrice?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function safe(v: number | undefined | null, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

/** Check if score trended upward for N consecutive history entries */
function scoreTrendingUp(history: { score: number }[], n = 2): boolean {
  if (history.length < n + 1) return false;
  const tail = history.slice(-n - 1);
  for (let i = 1; i <= n; i++) {
    if (tail[i].score <= tail[i - 1].score) return false;
  }
  return true;
}

function scoreTrendingDown(history: { score: number }[], n = 2): boolean {
  if (history.length < n + 1) return false;
  const tail = history.slice(-n - 1);
  for (let i = 1; i <= n; i++) {
    if (tail[i].score >= tail[i - 1].score) return false;
  }
  return true;
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeSmartMoney(input: SmartMoneyEngineInput): SmartMoneySignal {
  const {
    regimeResult = { regime: "RANGE" } as any,
    breadthResult = { breadthScore: 50, breadthBias: "NEUTRAL" } as any,
    heavyweightResult,
    range15mResult,
    optionChainResult,
    momentumResult,
    pcr = 1,
    totalCallOI = 0, totalPutOI = 0,
    totalCallOIChange = 0, totalPutOIChange = 0,
    totalCallVolume = 0, totalPutVolume = 0,
    overallScore = 0, scoreDifference = 0, score15mDiff = 0,
    volume = 0, changePercent = 0,
    scoreHistory = [],
  } = input || {};

  const reasoning: string[] = [];
  let overrideSignal = false;
  let trapType: TrapType = "NONE";
  let trapDetails = "";
  const totalVolume = (totalCallVolume || 0) + (totalPutVolume || 0);

  const monthlyResistance = input.monthlyMetrics?.resistanceWall;
  const spot = input.spotPrice || 0;

  if (
    changePercent > 0.3 &&
    breadthResult.breadthScore < 40 &&
    safe(totalCallOIChange) > safe(totalPutOIChange) * 1.5
  ) {
    trapType = "FAKE_BREAKOUT";
    trapDetails = "Bull Trap: Price up but Breadth weak & Call writing dominant";
    reasoning.push("⚠ FAKE BREAKOUT (BULL TRAP) — Price up, weak breadth, heavy Call writing");
  } else if (
    monthlyResistance && spot > 0 &&
    range15mResult && range15mResult.spotPosition === "ABOVE_RANGE_HIGH" &&
    spot >= monthlyResistance - (spot * 0.001) &&
    spot <= monthlyResistance + (spot * 0.001)
  ) {
    trapType = "FAKE_BREAKOUT";
    trapDetails = `Monthly Resistance Wall Trap: Spot price near monthly Call Writer wall at ${monthlyResistance}`;
    reasoning.push(`⚠ FAKE BREAKOUT (BULL TRAP) — Spot approaching major monthly Resistance Wall at ${monthlyResistance}`);
  }

  // 2. Fake Breakdown (Bear Trap): Price down, but smart money writing Puts heavily, or hitting Monthly Support
  const monthlySupport = input.monthlyMetrics?.supportWall;

  if (
    changePercent < -0.3 &&
    breadthResult.breadthScore > 60 &&
    safe(totalPutOIChange) > safe(totalCallOIChange) * 1.5
  ) {
    trapType = "FAKE_BREAKDOWN";
    trapDetails = "Bear Trap: Price down but Breadth strong & Put writing dominant";
    reasoning.push("⚠ FAKE BREAKDOWN (BEAR TRAP) — Price down, strong breadth, heavy Put writing");
  } else if (
    monthlySupport && spot > 0 &&
    range15mResult && range15mResult.spotPosition === "BELOW_RANGE_LOW" &&
    spot >= monthlySupport - (spot * 0.001) &&
    spot <= monthlySupport + (spot * 0.001)
  ) {
    trapType = "FAKE_BREAKDOWN";
    trapDetails = `Monthly Support Wall Trap: Spot price near monthly Put Writer wall at ${monthlySupport}`;
    reasoning.push(`⚠ FAKE BREAKDOWN (BEAR TRAP) — Spot approaching major monthly Support Wall at ${monthlySupport}`);
  }

  // 3. Volume Mirage: Huge options volume but zero actual OI expansion
  else if (
    totalVolume > 5000000 &&
    (Math.abs(safe(totalCallOIChange)) + Math.abs(safe(totalPutOIChange))) < 50000
  ) {
    trapType = "VOLUME_MIRAGE";
    trapDetails = "Volume Mirage: Extreme option volume with minimal net OI expansion";
    reasoning.push("⚠ VOLUME MIRAGE — Huge volume spike without real OI expansion");
  }

  // 4. Liquidity Sweep: Fallback/Additional check
  else if (
    volume > 0 &&
    breadthResult.breadthScore < 45 &&
    Math.abs(changePercent) > 0.5 &&
    safe(scoreDifference) < 3
  ) {
    trapType = "LIQUIDITY_SWEEP";
    trapDetails = "Volume spike + price move without broad participation — liquidity hunt";
    reasoning.push("⚠ LIQUIDITY SWEEP DETECTED — Volume spike without breadth or score participation");
  }

  // ── 1. OI Put Writing Score ────────────────────────────────────────────────
  // Put OI rising = institutions selling puts = supporting floor = BULLISH smart money
  // Call OI rising = institutions selling calls = capping ceiling = BEARISH smart money
  const totalOI = totalCallOI + totalPutOI || 1;
  const normalizedPutOIChange  = safe(totalPutOIChange)  / (totalOI * 0.02 || 1);
  const normalizedCallOIChange = safe(totalCallOIChange) / (totalOI * 0.02 || 1);

  // OI put writing: +ve = bullish, capped ±30
  const oiPutWritingScore  = clamp(normalizedPutOIChange  * 15, -30, 30);
  // OI call pressure: -ve = bearish (invert: call writing is bearish)
  const oiCallPressureScore = clamp(-normalizedCallOIChange * 15, -30, 30);

  // ── 2. Volume Spike Confirmation ──────────────────────────────────────────
  // Cross-reference call vs put volume to derive institutional direction
  const totalVol = totalCallVolume + totalPutVolume || 1;
  const volBias  = (totalPutVolume - totalCallVolume) / totalVol; // +1 = all puts, -1 = all calls
  const volumeSpikeScore = clamp(volBias * 20, -20, 20);

  // ── 3. Score Acceleration (Layer 6 proxy) ────────────────────────────────
  let scoreAcceleration = 0;
  if (momentumResult) {
    // Map momentum acceleration to -15..+15 range
    scoreAcceleration = clamp(momentumResult.acceleration * 0.3, -15, 15);
  } else {
    // Fallback: use raw score diffs
    scoreAcceleration = clamp((safe(scoreDifference) + safe(score15mDiff) * 0.5) * 0.2, -15, 15);
  }

  // ── 4. Breadth Alignment (Layer 2) ────────────────────────────────────────
  let breadthAlignment = 0;
  const bs = breadthResult.breadthScore;
  if      (bs >= 70) breadthAlignment = +15;
  else if (bs >= 55) breadthAlignment = +8;
  else if (bs >= 45) breadthAlignment = 0;
  else if (bs >= 30) breadthAlignment = -8;
  else               breadthAlignment = -15;

  // ── 5. Heavyweight Bonus (Layer 3) ────────────────────────────────────────
  let heavyweightBonus = 0;
  if (heavyweightResult) {
    const hDir = heavyweightResult.heavyweightDirection;
    if      (hDir === "STRONG_BULLISH") heavyweightBonus = +12;
    else if (hDir === "BULLISH")        heavyweightBonus = +6;
    else if (hDir === "BEARISH")        heavyweightBonus = -6;
    else if (hDir === "STRONG_BEARISH") heavyweightBonus = -12;
  }

  // ── 6. Regime Bonus (Layer 1) ─────────────────────────────────────────────
  let regimeBonus = 0;
  const regime = regimeResult.regime;
  if      (regime === "TRENDING_BULL" || regime === "BREAKOUT")  regimeBonus = +10;
  else if (regime === "TRENDING_BEAR" || regime === "BREAKDOWN") regimeBonus = -10;
  else if (regime === "VOLATILE")                                regimeBonus = -5;  // volatile = risky

  // ── 7. Range Bonus (Layer 4) ──────────────────────────────────────────────
  let rangeBonus = 0;
  if (range15mResult) {
    if      (range15mResult.rangeBreakout)   rangeBonus = +10;
    else if (range15mResult.rangeBreakdown)  rangeBonus = -10;
    else if (range15mResult.falseBreakout)   rangeBonus = -5;
  }

  // ── 8. Composite Smart Money Score (-100 to +100) ─────────────────────────
  const rawScore =
    oiPutWritingScore +     // ±30
    oiCallPressureScore +   // ±30
    volumeSpikeScore +      // ±20
    scoreAcceleration +     // ±15
    breadthAlignment +      // ±15
    heavyweightBonus +      // ±12
    regimeBonus +           // ±10
    rangeBonus;             // ±10

  // Total theoretical max: 142, map to -100..+100
  const smartMoneyScore = clamp(Math.round((rawScore / 142) * 100), -100, 100);

  // ── 9. Flow Direction ─────────────────────────────────────────────────────
  let flowDirection: SmartFlowDirection;
  if (trapType === "VOLUME_MIRAGE") {
    flowDirection = "NEUTRAL";
  } else if (smartMoneyScore >= 25) {
    flowDirection = "BULLISH";
  } else if (smartMoneyScore <= -25) {
    flowDirection = "BEARISH";
  } else {
    flowDirection = "NEUTRAL";
  }

  // ── 10. Institutional Bias (High-Conviction Classification) ───────────────
  // ACCUMULATION: all 6 conditions
  const pcrBullish = pcr >= 1.05 || (optionChainResult && optionChainResult.oiWritingUnwinding.putStatus === "WRITING" && optionChainResult.oiWritingUnwinding.callStatus === "UNWINDING");
  const scoreTrendUp = scoreTrendingUp(scoreHistory, 2) || safe(scoreDifference) > 3;
  const breadthSupport = breadthResult.breadthScore > 55;
  const hwBullish = !heavyweightResult || heavyweightResult.heavyweightDirection === "BULLISH" || heavyweightResult.heavyweightDirection === "STRONG_BULLISH";
  const notBreakdown = regime !== "BREAKDOWN";

  const accumulationMet =
    (pcrBullish as boolean) &&
    scoreTrendUp &&
    breadthSupport &&
    hwBullish &&
    notBreakdown &&
    oiPutWritingScore > 0;

  // DISTRIBUTION: all 5 conditions
  const pcrBearish = pcr <= 0.95 || (optionChainResult && optionChainResult.oiWritingUnwinding.callStatus === "WRITING" && optionChainResult.oiWritingUnwinding.putStatus === "UNWINDING");
  const scoreTrendDn = scoreTrendingDown(scoreHistory, 2) || safe(scoreDifference) < -3;
  const breadthWeak = breadthResult.breadthScore < 45;
  const hwBearish = !heavyweightResult || heavyweightResult.heavyweightDirection === "BEARISH" || heavyweightResult.heavyweightDirection === "STRONG_BEARISH";
  const notBreakout = regime !== "BREAKOUT";

  const distributionMet =
    (pcrBearish as boolean) &&
    scoreTrendDn &&
    breadthWeak &&
    hwBearish &&
    notBreakout &&
    oiCallPressureScore < 0;

  let institutionalBias: InstitutionalBiasType = "NONE";
  if (accumulationMet && smartMoneyScore > 20) {
    institutionalBias = "ACCUMULATION";
    reasoning.push("🟢 ACCUMULATION CONFIRMED — All 6 institutional accumulation conditions met");
  } else if (distributionMet && smartMoneyScore < -20) {
    institutionalBias = "DISTRIBUTION";
    reasoning.push("🔴 DISTRIBUTION CONFIRMED — All 5 institutional distribution conditions met");
  }

  // Trap details already compiled at top of engine

  // ── 12. Confidence Calculation ────────────────────────────────────────────
  let confidence = 50; // base

  // Boost for unanimous multi-layer alignment
  const bullAligned = [
    smartMoneyScore > 30,
    breadthResult.breadthBias === "BULLISH",
    regime === "TRENDING_BULL" || regime === "BREAKOUT",
    hwBullish && heavyweightResult !== undefined,
    range15mResult?.rangeBreakout === true,
    optionChainResult?.institutionalBias === "BULLISH",
    momentumResult?.momentumDirection === "BULLISH",
  ].filter(Boolean).length;

  const bearAligned = [
    smartMoneyScore < -30,
    breadthResult.breadthBias === "BEARISH",
    regime === "TRENDING_BEAR" || regime === "BREAKDOWN",
    hwBearish && heavyweightResult !== undefined,
    range15mResult?.rangeBreakdown === true,
    optionChainResult?.institutionalBias === "BEARISH",
    momentumResult?.momentumDirection === "BEARISH",
  ].filter(Boolean).length;

  const maxAligned = Math.max(bullAligned, bearAligned);
  confidence = clamp(Math.round(35 + maxAligned * 10), 0, 100);

  // Trap reduces confidence in the trend
  if (trapType !== "NONE") confidence = clamp(confidence - 20, 0, 100);

  // Override signal: trap detected AND high confidence
  if (trapType !== "NONE" && confidence > 70) {
    overrideSignal = true;
    reasoning.push(`🚨 OVERRIDE SIGNAL ACTIVE — ${trapType} with ${confidence}% confidence → normal signals suppressed`);
  }

  // ── 13. Reasoning Summary ─────────────────────────────────────────────────
  if (reasoning.length === 0) {
    if (flowDirection === "BULLISH") {
      reasoning.push(`🟢 Smart Money BUYING — Score ${smartMoneyScore} (L1-L6 aligned bullish)`);
    } else if (flowDirection === "BEARISH") {
      reasoning.push(`🔴 Smart Money SELLING — Score ${smartMoneyScore} (L1-L6 aligned bearish)`);
    } else {
      reasoning.push(`🟡 Smart Money NEUTRAL — Score ${smartMoneyScore} (conflicting signals)`);
    }
  }

  reasoning.push(
    `OI Flow: Put ${oiPutWritingScore > 0 ? "+" : ""}${oiPutWritingScore.toFixed(0)} | Call ${oiCallPressureScore > 0 ? "+" : ""}${oiCallPressureScore.toFixed(0)} | Volume bias ${volumeSpikeScore > 0 ? "+" : ""}${volumeSpikeScore.toFixed(0)}`
  );

  reasoning.push(
    `Layers: Breadth ${breadthAlignment > 0 ? "+" : ""}${breadthAlignment} | HW ${heavyweightBonus > 0 ? "+" : ""}${heavyweightBonus} | Regime ${regimeBonus > 0 ? "+" : ""}${regimeBonus} | Range ${rangeBonus > 0 ? "+" : ""}${rangeBonus}`
  );

  return {
    smartMoneyScore,
    flowDirection,
    institutionalBias,
    trapType,
    trapDetails,
    confidence,
    overrideSignal,
    reasoning,
    components: {
      oiPutWritingScore:   Math.round(oiPutWritingScore),
      oiCallPressureScore: Math.round(oiCallPressureScore),
      volumeSpikeScore:    Math.round(volumeSpikeScore),
      scoreAcceleration:   Math.round(scoreAcceleration),
      breadthAlignment,
      heavyweightBonus,
      regimeBonus,
      rangeBonus,
    },
  };
}

// ── Metadata for UI ───────────────────────────────────────────────────────────

export interface SmartMoneyMeta {
  label:       string;
  emoji:       string;
  color:       string;
  bgColor:     string;
  borderColor: string;
  glowColor:   string;
}

export const SMART_MONEY_META: Record<SmartFlowDirection, SmartMoneyMeta> = {
  BULLISH: {
    label: "SMART MONEY BUYING",
    emoji: "🟢",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/15",
    borderColor: "border-emerald-500/40",
    glowColor: "rgba(16,185,129,0.20)",
  },
  BEARISH: {
    label: "SMART MONEY SELLING",
    emoji: "🔴",
    color: "text-red-400",
    bgColor: "bg-red-500/15",
    borderColor: "border-red-500/40",
    glowColor: "rgba(239,68,68,0.20)",
  },
  NEUTRAL: {
    label: "NEUTRAL / WATCHING",
    emoji: "🟡",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    glowColor: "rgba(245,158,11,0.12)",
  },
};

export const BIAS_META: Record<InstitutionalBiasType, { label: string; color: string; bg: string; border: string }> = {
  ACCUMULATION: {
    label: "ACCUMULATION",
    color: "text-emerald-300",
    bg: "bg-emerald-900/30",
    border: "border-emerald-600/40",
  },
  DISTRIBUTION: {
    label: "DISTRIBUTION",
    color: "text-red-300",
    bg: "bg-red-900/30",
    border: "border-red-600/40",
  },
  NONE: {
    label: "NO BIAS",
    color: "text-slate-400",
    bg: "bg-slate-800/40",
    border: "border-slate-700/30",
  },
};

export const TRAP_META: Record<TrapType, { label: string; color: string; bg: string; emoji: string }> = {
  FAKE_BREAKOUT:   { label: "FAKE BREAKOUT",   color: "text-orange-400", bg: "bg-orange-500/15", emoji: "⚠" },
  FAKE_BREAKDOWN:  { label: "FAKE BREAKDOWN",  color: "text-purple-400", bg: "bg-purple-500/15", emoji: "⚠" },
  LIQUIDITY_SWEEP: { label: "LIQUIDITY SWEEP", color: "text-rose-400",   bg: "bg-rose-500/15",   emoji: "🎯" },
  VOLUME_MIRAGE:   { label: "VOLUME MIRAGE",   color: "text-yellow-400", bg: "bg-yellow-500/15", emoji: "⚠" },
  NONE:            { label: "NO TRAP",          color: "text-slate-500",  bg: "bg-transparent",   emoji: "✓" },
};
