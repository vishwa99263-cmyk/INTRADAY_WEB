/**
 * optionChainEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 5: Option Chain Engine
 *
 * Institutional option chain intelligence engine.
 * Converts raw option chain data into an "Institutional Intent Signal" by
 * computing PCR, OI walls, Max Pain, Smart Money Flow, and a composite
 * Option Chain Score.
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layer 1 (Regime), Layer 2 (Breadth), Layer 3 (Heavyweight, optional),
 * Layer 4 (Range, optional) outputs.
 * Output consumed by Layers 6, 7, 8, 9, 10, 11, 12.
 */

import type { MarketRegimeResult } from "./marketRegimeEngine";
import type { MarketBreadthResult } from "./marketBreadthEngine";
import type { HeavyweightResult }   from "./heavyweightEngine";
import type { Range15MResult }       from "./range15mEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InstitutionalBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export type OIWritingStatus = "WRITING" | "UNWINDING" | "NEUTRAL";

export interface OIStrikeData {
  strikePrice: number;
  ceOI: number;
  ceOIChange: number;
  ceVolume: number;
  peOI: number;
  peOIChange: number;
  peVolume: number;
}

export interface OIWalls {
  /** Strike with highest Call OI — acts as resistance */
  callWall: number;
  /** Strike with highest Put OI — acts as support */
  putWall: number;
  /** Normalised call wall strength 0-100 */
  callWallStrength: number;
  /** Normalised put wall strength 0-100 */
  putWallStrength: number;
}

export interface OIWritingUnwinding {
  /** Total new CE OI being added (writing) — bearish for market */
  callWriting: number;
  /** Total CE OI being removed (unwinding) — bullish for market */
  callUnwinding: number;
  /** Total new PE OI being added (writing) — bullish for market */
  putWriting: number;
  /** Total PE OI being removed (unwinding) — bearish for market */
  putUnwinding: number;
  /** Net call flow: positive = net writing, negative = net unwinding */
  netCallFlow: number;
  /** Net put flow: positive = net writing, negative = net unwinding */
  netPutFlow: number;
  /** Call OI status */
  callStatus: OIWritingStatus;
  /** Put OI status */
  putStatus: OIWritingStatus;
}

export interface OptionChainEngineOutput {
  /** Put/Call Ratio from total OI */
  pcr: number;

  /** PCR mapped to 0–100 (50 = neutral, >50 = bullish, <50 = bearish) */
  pcrScore: number;

  /** Detected OI wall strike levels */
  oiWalls: OIWalls;

  /** Max Pain strike — where combined CE+PE pain is minimum */
  maxPain: number;

  /** Net smart money flow direction */
  smartMoneyDirection: InstitutionalBias;

  /** Smart money score 0-100 (>50 = bullish flow, <50 = bearish flow) */
  smartMoneyScore: number;

  /** Detailed OI writing / unwinding breakdown */
  oiWritingUnwinding: OIWritingUnwinding;

  /** Composite 0–100 option chain score */
  optionChainScore: number;

  /** Final institutional bias signal */
  institutionalBias: InstitutionalBias;

  /** High-OI strike levels acting as liquidity zones */
  liquidityZones: number[];

  /** Human-readable reasoning */
  reasoning: string[];

  /** Diagnostic sub-scores used in composite calculation */
  components: {
    pcrComponent:       number;   // 25%
    oiWritingComponent: number;   // 25%
    maxPainComponent:   number;   // 15%
    rangeComponent:     number;   // 15%
    breadthComponent:   number;   // 10%
    regimeComponent:    number;   // 10%
  };
}

export interface OptionChainEngineInput {
  /** Raw option chain data — one entry per strike */
  strikes: OIStrikeData[];

  /** Current spot price */
  spotPrice: number;

  /** Layer 1 output */
  regimeResult: MarketRegimeResult;

  /** Layer 2 output */
  breadthResult: MarketBreadthResult;

  /** Layer 3 output (optional — fallback neutral if absent) */
  heavyweightResult?: HeavyweightResult;

  /** Layer 4 output (optional — fallback neutral if absent) */
  range15mResult?: Range15MResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function safeDiv(num: number, den: number): number {
  return den !== 0 ? num / den : 0;
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeOptionChain(input: OptionChainEngineInput): OptionChainEngineOutput {
  const {
    strikes,
    spotPrice,
    regimeResult,
    breadthResult,
    heavyweightResult,
    range15mResult,
  } = input;

  const reasoning: string[] = [];

  // Guard: empty strikes → return neutral output
  if (!strikes || strikes.length === 0) {
    return neutralOutput(reasoning);
  }

  // ── 1. Aggregate OI Totals ────────────────────────────────────────────────
  let totalCallOI    = 0;
  let totalPutOI     = 0;
  let totalCallVol   = 0;
  let totalPutVol    = 0;
  let callWriting    = 0;
  let callUnwinding  = 0;
  let putWriting     = 0;
  let putUnwinding   = 0;

  let maxCallOI = 0;
  let maxPutOI  = 0;
  let callWallStrike = 0;
  let putWallStrike  = 0;

  for (const s of strikes) {
    totalCallOI  += s.ceOI;
    totalPutOI   += s.peOI;
    totalCallVol += s.ceVolume;
    totalPutVol  += s.peVolume;

    // Writing / Unwinding classification per strike
    if (s.ceOIChange > 0) callWriting   += s.ceOIChange;
    else                   callUnwinding += Math.abs(s.ceOIChange);
    if (s.peOIChange > 0)  putWriting    += s.peOIChange;
    else                   putUnwinding  += Math.abs(s.peOIChange);

    // Track max OI for wall detection
    if (s.ceOI > maxCallOI) { maxCallOI = s.ceOI; callWallStrike = s.strikePrice; }
    if (s.peOI > maxPutOI)  { maxPutOI  = s.peOI; putWallStrike  = s.strikePrice; }
  }

  // ── 2. PCR Calculation ────────────────────────────────────────────────────
  const pcr = safeDiv(totalPutOI, totalCallOI) || 1.0;

  // PCR → 0-100 score
  // Neutral zone: 0.95–1.05  → ~50
  // PCR > 1.2 strongly bullish → toward 100
  // PCR < 0.8 strongly bearish → toward 0
  let pcrScore: number;
  if      (pcr >= 1.5)  pcrScore = 95;
  else if (pcr >= 1.25) pcrScore = 80;
  else if (pcr >= 1.05) pcrScore = 65;
  else if (pcr >= 0.95) pcrScore = 50;
  else if (pcr >= 0.80) pcrScore = 35;
  else if (pcr >= 0.65) pcrScore = 20;
  else                  pcrScore = 10;

  const pcrBias: InstitutionalBias =
    pcr > 1.05 ? "BULLISH" : pcr < 0.95 ? "BEARISH" : "NEUTRAL";

  reasoning.push(
    `PCR: ${pcr.toFixed(3)} → ${pcrBias} (score ${pcrScore})`
  );

  // ── 3. OI Wall Detection ─────────────────────────────────────────────────
  const callWallStrength = clamp(Math.round(safeDiv(maxCallOI, Math.max(maxCallOI, maxPutOI, 1)) * 100));
  const putWallStrength  = clamp(Math.round(safeDiv(maxPutOI,  Math.max(maxCallOI, maxPutOI, 1)) * 100));

  const oiWalls: OIWalls = {
    callWall: callWallStrike,
    putWall:  putWallStrike,
    callWallStrength,
    putWallStrength,
  };

  if (callWallStrike > 0)
    reasoning.push(`Call Wall (Resistance): ${callWallStrike} (OI strength ${callWallStrength}%)`);
  if (putWallStrike > 0)
    reasoning.push(`Put Wall (Support): ${putWallStrike} (OI strength ${putWallStrength}%)`);

  // ── 4. Max Pain Calculation ───────────────────────────────────────────────
  // At each potential expiry price, sum the total $ pain inflicted on all option holders
  // Max pain = strike where market can expire to maximize pain (minimize insurer payout)
  let maxPain = spotPrice;
  let minTotalPain = Infinity;

  for (const pivot of strikes) {
    let pain = 0;
    for (const s of strikes) {
      // Pain for CE holders: if expiry > strike → CE worth (expiry - strike) * OI
      if (pivot.strikePrice > s.strikePrice) {
        pain += (pivot.strikePrice - s.strikePrice) * s.ceOI;
      }
      // Pain for PE holders: if expiry < strike → PE worth (strike - expiry) * OI
      if (pivot.strikePrice < s.strikePrice) {
        pain += (s.strikePrice - pivot.strikePrice) * s.peOI;
      }
    }
    if (pain < minTotalPain) {
      minTotalPain = pain;
      maxPain = pivot.strikePrice;
    }
  }

  reasoning.push(`Max Pain Zone: ${maxPain} (pinning magnet for expiry)`);

  // ── 5. OI Writing / Unwinding ─────────────────────────────────────────────
  const netCallFlow = callWriting - callUnwinding; // positive = net writing (bearish signal)
  const netPutFlow  = putWriting  - putUnwinding;  // positive = net writing (bullish signal)

  const callStatus: OIWritingStatus = netCallFlow > 0 ? "WRITING" : netCallFlow < 0 ? "UNWINDING" : "NEUTRAL";
  const putStatus:  OIWritingStatus = netPutFlow  > 0 ? "WRITING" : netPutFlow  < 0 ? "UNWINDING" : "NEUTRAL";

  const oiWritingUnwinding: OIWritingUnwinding = {
    callWriting, callUnwinding,
    putWriting,  putUnwinding,
    netCallFlow, netPutFlow,
    callStatus, putStatus,
  };

  reasoning.push(
    `Call OI: ${callStatus} (net ${netCallFlow.toLocaleString()}) | Put OI: ${putStatus} (net ${netPutFlow.toLocaleString()})`
  );

  // ── 6. Smart Money Flow ───────────────────────────────────────────────────
  // Bullish smart money:  Put writing up (support building) + Call unwinding (shorts covering)
  // Bearish smart money:  Call writing up (resistance building) + Put unwinding (support being removed)
  const smartFlow = (putWriting - callWriting) + (netPutFlow - netCallFlow);

  const smartMoneyMax = Math.max(
    Math.abs(putWriting - callWriting),
    Math.abs(netPutFlow - netCallFlow),
    1
  );
  // Map smartFlow → 0-100 (50 = neutral)
  const smartFlowNorm = clamp(Math.round(50 + (safeDiv(smartFlow, smartMoneyMax * 2)) * 50));
  const smartMoneyScore = smartFlowNorm;
  const smartMoneyDirection: InstitutionalBias =
    smartMoneyScore > 55 ? "BULLISH" : smartMoneyScore < 45 ? "BEARISH" : "NEUTRAL";

  reasoning.push(`Smart Money Flow: ${smartMoneyDirection} (flow score ${smartMoneyScore})`);

  // ── 7. OI Writing Score for composite ────────────────────────────────────
  // Put writing dominant & call unwinding → bullish OI writing (high score)
  // Call writing dominant & put unwinding → bearish OI writing (low score)
  const oiWritingScore = clamp(Math.round(
    (putStatus  === "WRITING"   ? 70 :
     putStatus  === "UNWINDING" ? 30 : 50) * 0.6 +
    (callStatus === "UNWINDING" ? 80 :
     callStatus === "WRITING"   ? 20 : 50) * 0.4
  ));

  // ── 8. Max Pain Alignment Score ───────────────────────────────────────────
  // If spot is near max pain → choppy market expected (neutral)
  // If spot is significantly above max pain → put writers are winning (bullish)
  // If spot significantly below → call writers winning (bearish)
  const maxPainDelta = spotPrice - maxPain;
  const maxPainPct   = spotPrice > 0 ? (maxPainDelta / spotPrice) * 100 : 0;
  let maxPainScore: number;
  if      (maxPainPct >  1.0) maxPainScore = 80;   // far above max pain → bullish
  else if (maxPainPct >  0.3) maxPainScore = 65;
  else if (maxPainPct > -0.3) maxPainScore = 50;   // near max pain → neutral
  else if (maxPainPct > -1.0) maxPainScore = 35;
  else                        maxPainScore = 20;   // far below max pain → bearish

  // ── 9. Layer 4 Range Alignment ───────────────────────────────────────────
  let rangeScore = 50; // neutral default
  if (range15mResult) {
    if (range15mResult.rangeBreakout) {
      rangeScore = 80; // confirmed bullish breakout
    } else if (range15mResult.rangeBreakdown) {
      rangeScore = 20; // confirmed bearish breakdown
    } else if (range15mResult.spotPosition === "ABOVE_RANGE_HIGH") {
      rangeScore = 65;
    } else if (range15mResult.spotPosition === "BELOW_RANGE_LOW") {
      rangeScore = 35;
    }
  }

  // ── 10. Breadth Component (Layer 2) ──────────────────────────────────────
  const breadthScore = breadthResult.breadthScore; // already 0-100

  // ── 11. Regime Component (Layer 1) ────────────────────────────────────────
  const regime = regimeResult.regime;
  let regimeScore: number;
  if      (regime === "TRENDING_BULL" || regime === "BREAKOUT")  regimeScore = 80;
  else if (regime === "TRENDING_BEAR" || regime === "BREAKDOWN") regimeScore = 20;
  else if (regime === "VOLATILE")                                regimeScore = 40;
  else                                                           regimeScore = 50; // RANGE

  // ── 12. Composite Option Chain Score (0-100) ──────────────────────────────
  // PCR bias         → 25%
  // OI writing       → 25%
  // Max Pain         → 15%
  // Range alignment  → 15%
  // Breadth          → 10%
  // Regime           → 10%
  const optionChainScore = clamp(Math.round(
    pcrScore       * 0.25 +
    oiWritingScore * 0.25 +
    maxPainScore   * 0.15 +
    rangeScore     * 0.15 +
    breadthScore   * 0.10 +
    regimeScore    * 0.10
  ));

  const components = {
    pcrComponent:       Math.round(pcrScore       * 0.25),
    oiWritingComponent: Math.round(oiWritingScore * 0.25),
    maxPainComponent:   Math.round(maxPainScore   * 0.15),
    rangeComponent:     Math.round(rangeScore     * 0.15),
    breadthComponent:   Math.round(breadthScore   * 0.10),
    regimeComponent:    Math.round(regimeScore    * 0.10),
  };

  // ── 13. Institutional Bias ────────────────────────────────────────────────
  let institutionalBias: InstitutionalBias;
  if (optionChainScore > 60) {
    // Additional confirmation: PCR and OI writing must align
    if (pcrBias === "BULLISH" && (putStatus === "WRITING" || callStatus === "UNWINDING")) {
      institutionalBias = "BULLISH";
      reasoning.push("✅ BULLISH OPTION FLOW — PCR bullish + Put writing dominant");
    } else {
      institutionalBias = "NEUTRAL";
    }
  } else if (optionChainScore < 40) {
    if (pcrBias === "BEARISH" && (callStatus === "WRITING" || putStatus === "UNWINDING")) {
      institutionalBias = "BEARISH";
      reasoning.push("🔴 BEARISH OPTION FLOW — PCR bearish + Call writing dominant");
    } else {
      institutionalBias = "NEUTRAL";
    }
  } else {
    institutionalBias = "NEUTRAL";
    reasoning.push("🟡 NEUTRAL OPTION FLOW — PCR in equilibrium zone (0.95–1.05)");
  }

  // ── 14. Liquidity Zones (high OI strikes) ────────────────────────────────
  const totalOI = totalCallOI + totalPutOI || 1;
  const liquidityThreshold = totalOI / strikes.length * 2.5; // 2.5× average OI
  const liquidityZones = strikes
    .filter(s => s.ceOI + s.peOI > liquidityThreshold)
    .map(s => s.strikePrice)
    .sort((a, b) => a - b);

  if (liquidityZones.length > 0) {
    reasoning.push(`Liquidity Zones: ${liquidityZones.slice(0, 5).join(", ")}`);
  }

  return {
    pcr,
    pcrScore,
    oiWalls,
    maxPain,
    smartMoneyDirection,
    smartMoneyScore,
    oiWritingUnwinding,
    optionChainScore,
    institutionalBias,
    liquidityZones,
    reasoning,
    components,
  };
}

// ── Neutral output for edge cases ─────────────────────────────────────────────

function neutralOutput(reasoning: string[]): OptionChainEngineOutput {
  reasoning.push("⚠ No option chain data available — defaulting to NEUTRAL");
  return {
    pcr: 1.0,
    pcrScore: 50,
    oiWalls: { callWall: 0, putWall: 0, callWallStrength: 0, putWallStrength: 0 },
    maxPain: 0,
    smartMoneyDirection: "NEUTRAL",
    smartMoneyScore: 50,
    oiWritingUnwinding: {
      callWriting: 0, callUnwinding: 0,
      putWriting: 0,  putUnwinding: 0,
      netCallFlow: 0, netPutFlow: 0,
      callStatus: "NEUTRAL", putStatus: "NEUTRAL",
    },
    optionChainScore: 50,
    institutionalBias: "NEUTRAL",
    liquidityZones: [],
    reasoning,
    components: {
      pcrComponent: 12, oiWritingComponent: 12, maxPainComponent: 7,
      rangeComponent: 7, breadthComponent: 5, regimeComponent: 5,
    },
  };
}

// ── Metadata for UI ───────────────────────────────────────────────────────────

export interface BiasMetadata {
  label:       string;
  emoji:       string;
  color:       string;
  bgColor:     string;
  borderColor: string;
  glowColor:   string;
}

export const BIAS_META: Record<InstitutionalBias, BiasMetadata> = {
  BULLISH: {
    label: "BULLISH FLOW",
    emoji: "🟢",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/15",
    borderColor: "border-emerald-500/40",
    glowColor: "rgba(16,185,129,0.20)",
  },
  BEARISH: {
    label: "BEARISH FLOW",
    emoji: "🔴",
    color: "text-red-400",
    bgColor: "bg-red-500/15",
    borderColor: "border-red-500/40",
    glowColor: "rgba(239,68,68,0.20)",
  },
  NEUTRAL: {
    label: "NEUTRAL FLOW",
    emoji: "🟡",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    glowColor: "rgba(245,158,11,0.12)",
  },
};

export const OI_STATUS_META: Record<OIWritingStatus, { label: string; color: string; emoji: string }> = {
  WRITING:   { label: "WRITING",   color: "text-orange-400",  emoji: "⬆" },
  UNWINDING: { label: "UNWINDING", color: "text-sky-400",     emoji: "⬇" },
  NEUTRAL:   { label: "NEUTRAL",   color: "text-slate-400",   emoji: "➡" },
};
