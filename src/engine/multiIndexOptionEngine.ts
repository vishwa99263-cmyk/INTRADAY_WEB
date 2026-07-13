/**
 * multiIndexOptionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Layer 5.5: Multi-Index Option Chain Intelligence Engine
 *
 * Processes ALL available option chains simultaneously:
 *   Index chains  : NIFTY, BANKNIFTY, SENSEX
 *   Stock chains  : HDFCBANK, RELIANCE, ICICIBANK (and any custom stock)
 *
 * Detects cross-index divergences, sector-level institutional flows,
 * and produces a VIX-adjusted composite bias signal.
 *
 * Output consumed by smartMoneyEngine (L7), probabilityEngine (L8),
 * and aiDecisionEngine (L11).
 *
 * Pure TypeScript — no React, no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OIStrikeData {
  strikePrice: number;
  ceOI: number;
  ceOIChange: number;
  ceVolume: number;
  peOI: number;
  peOIChange: number;
  peVolume: number;
}

export interface IndexChainSnapshot {
  /** Index name e.g. "NIFTY" | "BANKNIFTY" | "SENSEX" */
  name: string;
  strikes: OIStrikeData[];
  spotPrice: number;
  /** Relative weight in composite PCR (0–1) */
  weight: number;
}

export interface StockChainSnapshot {
  symbol: string;
  strikes: OIStrikeData[];
  spotPrice: number;
}

export interface MultiIndexOptionInput {
  /** Active index page for context */
  activePage: string;

  /** Index option chains */
  niftyChain?: OIStrikeData[];
  niftySpot?: number;
  bankniftyChain?: OIStrikeData[];
  bankniftySpot?: number;
  sensexChain?: OIStrikeData[];
  sensexSpot?: number;

  /** Stock option chains */
  stockChains?: StockChainSnapshot[];

  /** India VIX — used to scale confidence */
  indiaVix?: number;
}

export type MultiIndexBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "DIVERGENT";
export type DivergenceType =
  | "NIFTY_BANKNIFTY_DIVERGE"
  | "INDEX_STOCK_DIVERGE"
  | "PCR_VOLUME_DIVERGE"
  | "NONE";

export interface IndexPCRSnapshot {
  name: string;
  pcr: number;
  pcrBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  callWall: number;
  putWall: number;
  maxPain: number;
  totalCallOI: number;
  totalPutOI: number;
  netPutFlow: number;
  netCallFlow: number;
}

export interface StockPCRSnapshot {
  symbol: string;
  pcr: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  putWriting: number;
  callWriting: number;
}

export interface MultiIndexOptionResult {
  /** Weighted composite PCR across all index chains */
  compositePCR: number;

  /** Composite score 0–100 (>50 bullish, <50 bearish) */
  compositeScore: number;

  /** Final multi-index bias */
  overallBias: MultiIndexBias;

  /** Per-index PCR snapshots */
  indexSnapshots: IndexPCRSnapshot[];

  /** Per-stock PCR snapshots */
  stockSnapshots: StockPCRSnapshot[];

  /** Divergence detected */
  divergenceDetected: boolean;
  divergenceType: DivergenceType;
  divergenceDescription: string;

  /** Stock sector bias based on heavyweight options */
  stockOptChainBias: "BULLISH" | "BEARISH" | "NEUTRAL";

  /** Banking sector specific flow (HDFCBANK + ICICIBANK) */
  bankingFlowBias: "BULLISH" | "BEARISH" | "NEUTRAL";

  /** VIX-adjusted confidence 0–100 */
  vixAdjustedConfidence: number;

  /** Whether signals should be suppressed due to high VIX */
  vixOverride: boolean;

  /** Trap signal from cross-index divergence */
  crossIndexTrap: boolean;
  trapDescription: string;

  /** Human-readable reasoning */
  reasoning: string[];

  /** Sub-scores for diagnostics */
  components: {
    niftyScore: number;
    bankniftyScore: number;
    sensexScore: number;
    stockAlignmentScore: number;
    vixPenalty: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeDiv(num: number, den: number): number {
  return den !== 0 ? num / den : 1.0;
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/** Compute PCR, OI walls, Max Pain, net flows from raw strikes */
function analyzeChain(strikes: OIStrikeData[], spotPrice: number): Omit<IndexPCRSnapshot, "name"> {
  if (!strikes || strikes.length === 0) {
    return {
      pcr: 1.0, pcrBias: "NEUTRAL",
      callWall: 0, putWall: 0, maxPain: spotPrice,
      totalCallOI: 0, totalPutOI: 0,
      netPutFlow: 0, netCallFlow: 0,
    };
  }

  let totalCallOI = 0, totalPutOI = 0;
  let callWriting = 0, callUnwinding = 0;
  let putWriting = 0, putUnwinding = 0;
  let maxCallOI = 0, maxPutOI = 0;
  let callWall = 0, putWall = 0;

  for (const s of strikes) {
    totalCallOI += s.ceOI;
    totalPutOI  += s.peOI;

    if (s.ceOIChange > 0) callWriting   += s.ceOIChange;
    else                  callUnwinding += Math.abs(s.ceOIChange);
    if (s.peOIChange > 0) putWriting    += s.peOIChange;
    else                  putUnwinding  += Math.abs(s.peOIChange);

    if (s.ceOI > maxCallOI) { maxCallOI = s.ceOI; callWall = s.strikePrice; }
    if (s.peOI > maxPutOI)  { maxPutOI  = s.peOI; putWall  = s.strikePrice; }
  }

  const pcr = safeDiv(totalPutOI, totalCallOI);
  const pcrBias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    pcr > 1.05 ? "BULLISH" : pcr < 0.95 ? "BEARISH" : "NEUTRAL";

  // Max Pain
  let maxPain = spotPrice;
  let minPain = Infinity;
  for (const pivot of strikes) {
    let pain = 0;
    for (const s of strikes) {
      if (pivot.strikePrice > s.strikePrice) pain += (pivot.strikePrice - s.strikePrice) * s.ceOI;
      if (pivot.strikePrice < s.strikePrice) pain += (s.strikePrice - pivot.strikePrice) * s.peOI;
    }
    if (pain < minPain) { minPain = pain; maxPain = pivot.strikePrice; }
  }

  return {
    pcr,
    pcrBias,
    callWall,
    putWall,
    maxPain,
    totalCallOI,
    totalPutOI,
    netPutFlow:  putWriting  - putUnwinding,
    netCallFlow: callWriting - callUnwinding,
  };
}

/** Convert raw OptionChainState strikes to OIStrikeData[] */
export function toOIStrikes(optionChainState: any): OIStrikeData[] {
  if (!optionChainState?.strikes) return [];
  return (optionChainState.strikes as any[]).map((s: any) => ({
    strikePrice:  s.strikePrice  ?? 0,
    ceOI:         s.ceOI         ?? 0,
    ceOIChange:   s.ceOIChange   ?? 0,
    ceVolume:     s.ceVolume     ?? 0,
    peOI:         s.peOI         ?? 0,
    peOIChange:   s.peOIChange   ?? 0,
    peVolume:     s.peVolume     ?? 0,
  }));
}

// ── Neutral output ────────────────────────────────────────────────────────────

function neutralResult(reasoning: string[]): MultiIndexOptionResult {
  return {
    compositePCR: 1.0,
    compositeScore: 50,
    overallBias: "NEUTRAL",
    indexSnapshots: [],
    stockSnapshots: [],
    divergenceDetected: false,
    divergenceType: "NONE",
    divergenceDescription: "",
    stockOptChainBias: "NEUTRAL",
    bankingFlowBias: "NEUTRAL",
    vixAdjustedConfidence: 50,
    vixOverride: false,
    crossIndexTrap: false,
    trapDescription: "",
    reasoning,
    components: {
      niftyScore: 50, bankniftyScore: 50, sensexScore: 50,
      stockAlignmentScore: 50, vixPenalty: 0,
    },
  };
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeMultiIndexOption(input: MultiIndexOptionInput): MultiIndexOptionResult {
  const {
    activePage,
    niftyChain = [], niftySpot = 0,
    bankniftyChain = [], bankniftySpot = 0,
    sensexChain = [], sensexSpot = 0,
    stockChains = [],
    indiaVix = 0,
  } = input;

  const reasoning: string[] = [];

  // ── 1. Analyze each index chain ───────────────────────────────────────────

  const hasNifty     = niftyChain.length > 0;
  const hasBanknifty = bankniftyChain.length > 0;
  const hasSensex    = sensexChain.length > 0;

  if (!hasNifty && !hasBanknifty && !hasSensex) {
    reasoning.push("⚠ No index option chain data — returning neutral");
    return neutralResult(reasoning);
  }

  const niftyAnalysis     = analyzeChain(niftyChain, niftySpot);
  const bankniftyAnalysis = analyzeChain(bankniftyChain, bankniftySpot);
  const sensexAnalysis    = analyzeChain(sensexChain, sensexSpot);

  const indexSnapshots: IndexPCRSnapshot[] = [];
  if (hasNifty)     indexSnapshots.push({ name: "NIFTY",     ...niftyAnalysis });
  if (hasBanknifty) indexSnapshots.push({ name: "BANKNIFTY", ...bankniftyAnalysis });
  if (hasSensex)    indexSnapshots.push({ name: "SENSEX",    ...sensexAnalysis });

  reasoning.push(
    `Index PCR → NIFTY: ${niftyAnalysis.pcr.toFixed(3)} [${niftyAnalysis.pcrBias}]` +
    ` | BANKNIFTY: ${bankniftyAnalysis.pcr.toFixed(3)} [${bankniftyAnalysis.pcrBias}]` +
    ` | SENSEX: ${sensexAnalysis.pcr.toFixed(3)} [${sensexAnalysis.pcrBias}]`
  );

  // ── 2. Composite PCR (weighted) ───────────────────────────────────────────
  // NIFTY 50% | BANKNIFTY 30% | SENSEX 20%
  const nWeight = hasNifty     ? 0.5 : 0;
  const bWeight = hasBanknifty ? 0.3 : 0;
  const sWeight = hasSensex    ? 0.2 : 0;
  const totalWeight = nWeight + bWeight + sWeight || 1;

  const compositePCR =
    (niftyAnalysis.pcr * nWeight + bankniftyAnalysis.pcr * bWeight + sensexAnalysis.pcr * sWeight) /
    totalWeight;

  // PCR → score (>1.05 bullish, <0.95 bearish)
  const pcrToScore = (pcr: number): number =>
    pcr >= 1.5  ? 90 :
    pcr >= 1.25 ? 75 :
    pcr >= 1.05 ? 60 :
    pcr >= 0.95 ? 50 :
    pcr >= 0.80 ? 35 :
    pcr >= 0.65 ? 20 : 10;

  const niftyScore     = pcrToScore(niftyAnalysis.pcr);
  const bankniftyScore = pcrToScore(bankniftyAnalysis.pcr);
  const sensexScore    = pcrToScore(sensexAnalysis.pcr);

  let compositeScore = clamp(Math.round(
    (niftyScore * nWeight + bankniftyScore * bWeight + sensexScore * sWeight) / totalWeight
  ));

  // ── 3. Stock option chain analysis ───────────────────────────────────────

  const stockSnapshots: StockPCRSnapshot[] = [];
  let stockBullishCount = 0;
  let stockBearishCount = 0;
  let bankingBullish = 0;
  let bankingBearish = 0;

  for (const sc of stockChains) {
    if (!sc.strikes || sc.strikes.length === 0) continue;

    let totalCeOI = 0, totalPeOI = 0;
    let putWriting = 0, callWriting = 0;

    for (const s of sc.strikes) {
      totalCeOI += s.ceOI;
      totalPeOI += s.peOI;
      if (s.peOIChange > 0) putWriting  += s.peOIChange;
      if (s.ceOIChange > 0) callWriting += s.ceOIChange;
    }

    const pcr = safeDiv(totalPeOI, totalCeOI);
    const bias: "BULLISH" | "BEARISH" | "NEUTRAL" =
      pcr > 1.05 ? "BULLISH" : pcr < 0.95 ? "BEARISH" : "NEUTRAL";

    stockSnapshots.push({ symbol: sc.symbol, pcr, bias, putWriting, callWriting });

    if (bias === "BULLISH") stockBullishCount++;
    if (bias === "BEARISH") stockBearishCount++;

    if (sc.symbol === "HDFCBANK" || sc.symbol === "ICICIBANK") {
      if (bias === "BULLISH") bankingBullish++;
      if (bias === "BEARISH") bankingBearish++;
    }
  }

  const stockOptChainBias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    stockBullishCount > stockBearishCount ? "BULLISH" :
    stockBearishCount > stockBullishCount ? "BEARISH" : "NEUTRAL";

  const bankingFlowBias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    bankingBullish > bankingBearish ? "BULLISH" :
    bankingBearish > bankingBullish ? "BEARISH" : "NEUTRAL";

  if (stockSnapshots.length > 0) {
    reasoning.push(
      `Stock OI Bias → ${stockOptChainBias} ` +
      `(${stockSnapshots.map(s => `${s.symbol}:${s.pcr.toFixed(2)}`).join(" | ")})`
    );
  }

  // Stock alignment score adjustment
  let stockAlignmentScore = 50;
  if (stockSnapshots.length > 0) {
    const overallBiasIsBull = compositeScore > 55;
    const overallBiasIsBear = compositeScore < 45;
    if (overallBiasIsBull && stockOptChainBias === "BULLISH") {
      stockAlignmentScore = 75; // confirmed
      compositeScore = clamp(compositeScore + 5);
      reasoning.push("✅ Stock OI confirms index bullish bias");
    } else if (overallBiasIsBear && stockOptChainBias === "BEARISH") {
      stockAlignmentScore = 25; // confirmed bearish
      compositeScore = clamp(compositeScore - 5);
      reasoning.push("✅ Stock OI confirms index bearish bias");
    } else if (overallBiasIsBull && stockOptChainBias === "BEARISH") {
      stockAlignmentScore = 30; // conflict
      compositeScore = clamp(compositeScore - 8); // dampen confidence
      reasoning.push("⚠ CONFLICT: Stock OI bearish despite index bullish PCR");
    } else if (overallBiasIsBear && stockOptChainBias === "BULLISH") {
      stockAlignmentScore = 70;
      compositeScore = clamp(compositeScore + 8);
      reasoning.push("⚠ CONFLICT: Stock OI bullish despite index bearish PCR");
    }
  }

  // ── 4. Cross-index divergence detection ──────────────────────────────────

  let divergenceDetected = false;
  let divergenceType: DivergenceType = "NONE";
  let divergenceDescription = "";
  let crossIndexTrap = false;
  let trapDescription = "";

  if (hasNifty && hasBanknifty) {
    const niftyBull     = niftyAnalysis.pcrBias === "BULLISH";
    const bankniftyBull = bankniftyAnalysis.pcrBias === "BULLISH";
    const niftyBear     = niftyAnalysis.pcrBias === "BEARISH";
    const bankniftyBear = bankniftyAnalysis.pcrBias === "BEARISH";

    // Strong divergence: one bullish, other bearish
    if ((niftyBull && bankniftyBear) || (niftyBear && bankniftyBull)) {
      divergenceDetected = true;
      divergenceType = "NIFTY_BANKNIFTY_DIVERGE";

      if (niftyBull && bankniftyBear) {
        divergenceDescription = "NIFTY PCR bullish but BANKNIFTY PCR bearish — NIFTY leading without banking support";
        crossIndexTrap = true;
        trapDescription = "⚠ POSSIBLE BULL TRAP: NIFTY rising without BANKNIFTY confirmation";
        compositeScore = clamp(compositeScore - 10); // dampen
        reasoning.push(`🔔 DIVERGENCE: ${divergenceDescription}`);
        reasoning.push(trapDescription);
      } else {
        divergenceDescription = "BANKNIFTY PCR bullish but NIFTY PCR bearish — sector-specific move";
        reasoning.push(`🔔 DIVERGENCE: ${divergenceDescription}`);
        compositeScore = clamp(compositeScore - 5);
      }
    }

    // PCR–Volume divergence: PCR bullish but call volume dominant
    const niftyCallVolDominant = niftyAnalysis.totalCallOI > niftyAnalysis.totalPutOI * 1.2;
    if (niftyBull && niftyCallVolDominant) {
      divergenceType = "PCR_VOLUME_DIVERGE";
      divergenceDescription = "NIFTY PCR bullish but Call OI dominant — hedged rally, institutional caution";
      reasoning.push(`⚠ PCR-OI DIVERGENCE: ${divergenceDescription}`);
      compositeScore = clamp(compositeScore - 5);
    }
  }

  // Index vs stock divergence
  if (stockSnapshots.length >= 2 && !divergenceDetected) {
    const indexBiasScore = compositeScore;
    if (indexBiasScore > 60 && stockOptChainBias === "BEARISH") {
      divergenceDetected = true;
      divergenceType = "INDEX_STOCK_DIVERGE";
      divergenceDescription = "Index PCR bullish but heavyweight stock options bearish";
      crossIndexTrap = true;
      trapDescription = "⚠ DISTRIBUTION TRAP: Index bid-up but smart money selling via stocks";
      reasoning.push(trapDescription);
    }
  }

  // ── 5. VIX adjustment ─────────────────────────────────────────────────────

  let vixPenalty = 0;
  let vixOverride = false;
  let vixAdjustedConfidence = 50;

  if (indiaVix > 0) {
    if (indiaVix >= 22) {
      vixPenalty = 30;
      vixOverride = true;
      reasoning.push(`🔴 HIGH VIX (${indiaVix.toFixed(1)}): Signals suppressed — extreme volatility`);
    } else if (indiaVix >= 17) {
      vixPenalty = 15;
      reasoning.push(`🟡 ELEVATED VIX (${indiaVix.toFixed(1)}): Confidence reduced`);
    } else if (indiaVix >= 13) {
      vixPenalty = 5;
    }
    // Move score toward 50 by vixPenalty
    const delta = compositeScore - 50;
    compositeScore = clamp(Math.round(50 + delta * (1 - vixPenalty / 100)));
    vixAdjustedConfidence = clamp(Math.abs(compositeScore - 50) * 2);
  } else {
    vixAdjustedConfidence = clamp(Math.abs(compositeScore - 50) * 2);
  }

  // ── 6. Final bias ─────────────────────────────────────────────────────────

  let overallBias: MultiIndexBias;
  if (divergenceDetected && crossIndexTrap) {
    overallBias = "DIVERGENT";
  } else if (compositeScore >= 62) {
    overallBias = "BULLISH";
  } else if (compositeScore <= 38) {
    overallBias = "BEARISH";
  } else {
    overallBias = "NEUTRAL";
  }

  reasoning.push(
    `Composite Score: ${compositeScore} → ${overallBias} | Composite PCR: ${compositePCR.toFixed(3)}`
  );

  if (bankingFlowBias !== "NEUTRAL") {
    reasoning.push(`Banking Sector OI Flow: ${bankingFlowBias} (HDFCBANK + ICICIBANK)`);
  }

  return {
    compositePCR,
    compositeScore,
    overallBias,
    indexSnapshots,
    stockSnapshots,
    divergenceDetected,
    divergenceType,
    divergenceDescription,
    stockOptChainBias,
    bankingFlowBias,
    vixAdjustedConfidence,
    vixOverride,
    crossIndexTrap,
    trapDescription,
    reasoning,
    components: {
      niftyScore,
      bankniftyScore,
      sensexScore,
      stockAlignmentScore,
      vixPenalty,
    },
  };
}
