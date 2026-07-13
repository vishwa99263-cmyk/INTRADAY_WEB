/**
 * entryZoneEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 9: Entry Zone Engine v1.0
 *
 * Converts probabilistic direction (Layer 8) into a precise trade execution zone:
 * Entry Price Zone, Stop Loss, Target, Risk/Reward, Entry Confidence.
 *
 * First execution-level precision layer in the system.
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layers 1–8.  Consumed by Layers 10, 11, 12.
 */

import type { MarketRegimeResult }       from "./marketRegimeEngine";
import type { MarketBreadthResult }       from "./marketBreadthEngine";
import type { HeavyweightResult }         from "./heavyweightEngine";
import type { Range15MResult }            from "./range15mEngine";
import type { OptionChainEngineOutput }   from "./optionChainEngine";
import type { MomentumEngineOutput }      from "./momentumEngine";
import type { SmartMoneySignal }          from "./smartMoneyEngine";
import type { ProbabilityEngineResult }   from "./probabilityEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntryDirection = "CE" | "PE" | "WAIT";
export type EntryMode      = "BREAKOUT_BUY" | "BREAKDOWN_SELL" | "RANGE_EDGE" | "RETEST" | "WAIT";
export type RRQuality      = "EXCELLENT" | "GOOD" | "ACCEPTABLE" | "POOR";

export interface EntryZoneResult {
  /** Trade direction */
  direction: EntryDirection;

  /** Entry mode — how to enter */
  entryMode: EntryMode;

  /** Entry zone [low, high] */
  entryZone: [number, number];

  /** Ideal entry price (midpoint of zone) */
  entryPrice: number;

  /** Stop loss level */
  stopLoss: number;

  /** Target level */
  target: number;

  /** Risk/reward ratio (positive = favorable) */
  riskReward: number;

  /** RR quality label */
  rrQuality: RRQuality;

  /** Entry confidence 0–100 */
  confidence: number;

  /** Points at risk */
  riskPoints: number;

  /** Points to target */
  rewardPoints: number;

  /** Human-readable reasoning */
  reasoning: string[];
}

export interface EntryZoneInput {
  // ── Layer 1 ─────────────────────────────────────────────────────────────
  regimeResult: MarketRegimeResult;
  // ── Layer 2 ─────────────────────────────────────────────────────────────
  breadthResult: MarketBreadthResult;
  // ── Layer 3 (optional) ───────────────────────────────────────────────────
  heavyweightResult?: HeavyweightResult;
  // ── Layer 4 ─────────────────────────────────────────────────────────────
  range15mResult?: Range15MResult;
  // ── Layer 5 (optional) ───────────────────────────────────────────────────
  optionChainResult?: OptionChainEngineOutput;
  // ── Layer 6 (optional) ───────────────────────────────────────────────────
  momentumResult?: MomentumEngineOutput;
  // ── Layer 7 (optional) ───────────────────────────────────────────────────
  smartMoneyResult?: SmartMoneySignal;
  // ── Layer 8 ─────────────────────────────────────────────────────────────
  probabilityResult: ProbabilityEngineResult;
  // ── Raw Data ─────────────────────────────────────────────────────────────
  spotPrice: number;
  rangeHigh: number;
  rangeLow: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function safe(v: number | undefined | null, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function roundPts(v: number): number {
  return Math.round(v * 100) / 100;
}

function rrQuality(rr: number): RRQuality {
  if (rr >= 3.0) return "EXCELLENT";
  if (rr >= 2.0) return "GOOD";
  if (rr >= 1.5) return "ACCEPTABLE";
  return "POOR";
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeEntryZone(input: EntryZoneInput): EntryZoneResult {
  const {
    regimeResult = { regime: "RANGE" } as any, breadthResult = { breadthScore: 50 } as any, heavyweightResult, range15mResult,
    optionChainResult, momentumResult, smartMoneyResult, probabilityResult = { dominantSide: "WAIT", ceProbability: 50, peProbability: 50, confidenceLevel: 50 } as any,
    spotPrice = 0, rangeHigh = 0, rangeLow = 0,
  } = input || {};

  const reasoning: string[] = [];

  const { dominantSide, ceProbability, peProbability, confidenceLevel } = probabilityResult;
  const regime = regimeResult.regime;
  const bs     = safe(breadthResult.breadthScore);

  // ── FILTER: NO TRADE CONDITIONS ───────────────────────────────────────────
  const trapDetected  = smartMoneyResult?.trapType !== "NONE" && smartMoneyResult?.trapType !== undefined;
  const probTooLow    = Math.max(ceProbability, peProbability) < 55;
  const breadthWeak   = bs < 45 && (momentumResult?.momentumScore ?? 50) < 45;
  const rangeWidth    = rangeHigh - rangeLow;
  const spotInMidRange = rangeWidth > 0 &&
    Math.abs(spotPrice - (rangeHigh + rangeLow) / 2) < rangeWidth * 0.15;
  const inNoTradeZone = (ceProbability >= 45 && ceProbability <= 55 && peProbability >= 45 && peProbability <= 55);

  if (
    dominantSide === "WAIT" ||
    trapDetected ||
    probTooLow ||
    (breadthWeak && spotInMidRange) ||
    inNoTradeZone
  ) {
    const reason =
      trapDetected     ? `Trap detected: ${smartMoneyResult?.trapType}` :
      probTooLow       ? `Probability too low: CE${ceProbability}/PE${peProbability}` :
      inNoTradeZone    ? "CE/PE in neutral zone (45–55%)" :
      breadthWeak      ? "Breadth weak + momentum weak + mid-range" :
      "No directional edge";

    reasoning.push(`❌ NO TRADE — ${reason}`);
    return {
      direction: "WAIT", entryMode: "WAIT",
      entryZone: [0, 0], entryPrice: 0,
      stopLoss: 0, target: 0,
      riskReward: 0, rrQuality: "POOR",
      confidence: 0, riskPoints: 0, rewardPoints: 0,
      reasoning,
    };
  }

  // ── SETUP: CE (BUY CE) ────────────────────────────────────────────────────
  if (dominantSide === "CE") {
    let entryMode: EntryMode;
    let entryLow: number;
    let entryHigh: number;
    let stopLoss: number;
    let target: number;

    // Breakout mode: price above 15M High + momentum accelerating
    const isBreakout =
      range15mResult?.rangeBreakout === true ||
      (spotPrice > rangeHigh && momentumResult?.acceleration && momentumResult.acceleration > 3);

    if (isBreakout) {
      entryMode = "BREAKOUT_BUY";
      // Entry: rangeHigh to rangeHigh + 0.15% buffer (buy on retest or confirmation)
      const buffer = rangeHigh * 0.0015;
      entryLow  = rangeHigh;
      entryHigh = rangeHigh + buffer;
      // SL: below range high by 0.25%
      stopLoss = rangeHigh * (1 - 0.0025);
      // Target: rangeHigh + rangeWidth
      target = rangeHigh + rangeWidth;
      reasoning.push(`⚡ BREAKOUT BUY — Entry on retest of ${rangeHigh.toFixed(0)}, TP: ${target.toFixed(0)}`);
    } else {
      // Range edge or support bounce
      entryMode = "RANGE_EDGE";
      const buffer = rangeHigh * 0.001;
      entryLow  = rangeHigh - buffer;
      entryHigh = rangeHigh + buffer;
      stopLoss  = Math.min(rangeLow, rangeHigh * (1 - 0.0025));
      // Target: OI put wall if available, else rangeHigh + rangeWidth * 0.5
      const putWall = optionChainResult?.oiWalls?.putWall;
      target = (putWall && putWall > rangeHigh)
        ? putWall
        : rangeHigh + rangeWidth * 0.7;
      reasoning.push(`🎯 CE RANGE EDGE — Entry ${entryLow.toFixed(0)}–${entryHigh.toFixed(0)}, TP: ${target.toFixed(0)}`);
    }

    const entryPrice  = roundPts((entryLow + entryHigh) / 2);
    const riskPoints  = roundPts(Math.abs(entryPrice - stopLoss));
    const rewardPoints = roundPts(Math.abs(target - entryPrice));
    const riskReward  = riskPoints > 0 ? roundPts(rewardPoints / riskPoints) : 0;

    // Confidence model
    const smAlign  = smartMoneyResult?.institutionalBias === "ACCUMULATION" ? 25 : 0;
    const momAlign = momentumResult?.momentumDirection === "BULLISH" ? 15 : 0;
    const regAlign = (regime === "TRENDING_BULL" || regime === "BREAKOUT") ? 20 : 10;
    const confidence = clamp(Math.round(
      confidenceLevel * 0.4 + smAlign * 0.25 + bs * 0.15 / 100 * 100 + regAlign * 0.20
    ));

    if (riskReward < 1.5) {
      reasoning.push(`⚠ Risk/Reward ${riskReward.toFixed(1)} below 1.5 minimum — consider skipping`);
    }

    reasoning.push(`SL: ${stopLoss.toFixed(0)} | Target: ${target.toFixed(0)} | R:R ${riskReward.toFixed(2)} (${rrQuality(riskReward)})`);
    reasoning.push(`Confidence: ${confidence}% | CE Prob: ${ceProbability}% vs PE ${peProbability}%`);

    return {
      direction: "CE", entryMode,
      entryZone: [roundPts(entryLow), roundPts(entryHigh)],
      entryPrice, stopLoss: roundPts(stopLoss), target: roundPts(target),
      riskReward, rrQuality: rrQuality(riskReward),
      confidence, riskPoints, rewardPoints, reasoning,
    };
  }

  // ── SETUP: PE (BUY PE) ────────────────────────────────────────────────────
  if (dominantSide === "PE") {
    let entryMode: EntryMode;
    let entryLow: number;
    let entryHigh: number;
    let stopLoss: number;
    let target: number;

    // Breakdown mode
    const isBreakdown =
      range15mResult?.rangeBreakdown === true ||
      (spotPrice < rangeLow && momentumResult?.acceleration && momentumResult.acceleration < -3);

    if (isBreakdown) {
      entryMode = "BREAKDOWN_SELL";
      const buffer = rangeLow * 0.0015;
      entryHigh = rangeLow;
      entryLow  = rangeLow - buffer;
      stopLoss  = rangeLow * (1 + 0.0025);
      target    = rangeLow - rangeWidth;
      reasoning.push(`⚡ BREAKDOWN SELL — Entry on pullback to ${rangeLow.toFixed(0)}, TP: ${target.toFixed(0)}`);
    } else {
      entryMode = "RANGE_EDGE";
      const buffer = rangeLow * 0.001;
      entryHigh = rangeLow + buffer;
      entryLow  = rangeLow - buffer;
      stopLoss  = Math.max(rangeHigh, rangeLow * (1 + 0.0025));
      const callWall = optionChainResult?.oiWalls?.callWall;
      target = (callWall && callWall < rangeLow)
        ? callWall
        : rangeLow - rangeWidth * 0.7;
      reasoning.push(`🎯 PE RANGE EDGE — Entry ${entryLow.toFixed(0)}–${entryHigh.toFixed(0)}, TP: ${target.toFixed(0)}`);
    }

    const entryPrice  = roundPts((entryLow + entryHigh) / 2);
    const riskPoints  = roundPts(Math.abs(stopLoss - entryPrice));
    const rewardPoints = roundPts(Math.abs(entryPrice - target));
    const riskReward  = riskPoints > 0 ? roundPts(rewardPoints / riskPoints) : 0;

    const smAlign  = smartMoneyResult?.institutionalBias === "DISTRIBUTION" ? 25 : 0;
    const momAlign = momentumResult?.momentumDirection === "BEARISH" ? 15 : 0;
    const regAlign = (regime === "TRENDING_BEAR" || regime === "BREAKDOWN") ? 20 : 10;
    const confidence = clamp(Math.round(
      confidenceLevel * 0.4 + smAlign * 0.25 + (100 - bs) * 0.15 + regAlign * 0.20
    ));

    if (riskReward < 1.5) {
      reasoning.push(`⚠ Risk/Reward ${riskReward.toFixed(1)} below 1.5 minimum — consider skipping`);
    }

    reasoning.push(`SL: ${stopLoss.toFixed(0)} | Target: ${target.toFixed(0)} | R:R ${riskReward.toFixed(2)} (${rrQuality(riskReward)})`);
    reasoning.push(`Confidence: ${confidence}% | PE Prob: ${peProbability}% vs CE ${ceProbability}%`);

    return {
      direction: "PE", entryMode,
      entryZone: [roundPts(entryLow), roundPts(entryHigh)],
      entryPrice, stopLoss: roundPts(stopLoss), target: roundPts(target),
      riskReward, rrQuality: rrQuality(riskReward),
      confidence, riskPoints, rewardPoints, reasoning,
    };
  }

  // Fallback WAIT
  reasoning.push("⚪ No valid trade setup identified — WAIT");
  return {
    direction: "WAIT", entryMode: "WAIT",
    entryZone: [0, 0], entryPrice: 0,
    stopLoss: 0, target: 0,
    riskReward: 0, rrQuality: "POOR",
    confidence: 0, riskPoints: 0, rewardPoints: 0,
    reasoning,
  };
}

// ── UI Metadata ───────────────────────────────────────────────────────────────

export const ENTRY_DIRECTION_META = {
  CE:   { label: "BUY CE",  emoji: "🟢", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", glow: "rgba(16,185,129,0.22)" },
  PE:   { label: "BUY PE",  emoji: "🔴", color: "text-red-400",     bg: "bg-red-500/15",     border: "border-red-500/40",     glow: "rgba(239,68,68,0.22)"  },
  WAIT: { label: "WAIT",    emoji: "⚪", color: "text-slate-400",   bg: "bg-slate-800/40",   border: "border-slate-700/30",   glow: "transparent"           },
} as const;

export const ENTRY_MODE_META: Record<EntryMode, { label: string; color: string }> = {
  BREAKOUT_BUY:   { label: "BREAKOUT BUY",   color: "text-emerald-400" },
  BREAKDOWN_SELL: { label: "BREAKDOWN SELL",  color: "text-red-400"     },
  RANGE_EDGE:     { label: "RANGE EDGE",      color: "text-sky-400"     },
  RETEST:         { label: "RETEST ENTRY",    color: "text-indigo-400"  },
  WAIT:           { label: "WAITING",         color: "text-slate-500"   },
};

export const RR_QUALITY_META: Record<RRQuality, { color: string; bg: string }> = {
  EXCELLENT: { color: "text-emerald-300", bg: "bg-emerald-500/20" },
  GOOD:      { color: "text-sky-400",     bg: "bg-sky-500/15"     },
  ACCEPTABLE:{ color: "text-amber-400",   bg: "bg-amber-500/15"   },
  POOR:      { color: "text-red-400",     bg: "bg-red-500/15"     },
};
