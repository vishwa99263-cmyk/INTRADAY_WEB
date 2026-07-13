/**
 * rtpodeEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-Time Profit Opportunity Detection Engine (RTPODE) v1.0
 *
 * ONLY generates signals during LIVE market hours (9:15–15:30 IST, Mon–Fri).
 * Signal fires ONLY when ALL three conditions pass:
 *   1. max(upScore, downScore) >= 70
 *   2. expectedMovePoints >= 40
 *   3. optionProfitPotential >= ₹1000
 *
 * 10-minute cooldown between signals to avoid duplicate alerts.
 * Strictly NO signals outside market hours, on weekends, or on conflicting data.
 */

import type { MomentumEngineOutput }    from "./momentumEngine";
import type { SmartMoneySignal }        from "./smartMoneyEngine";
import type { MarketBreadthResult }     from "./marketBreadthEngine";
import type { MarketTimeEngineResult }  from "./marketTimeEngine";
import type { ProbabilityEngineResult } from "./probabilityEngine";
import type { OptionChainEngineOutput } from "./optionChainEngine";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RTSignalDirection = "BUY_CE" | "BUY_PE" | "NO_SIGNAL";

export interface RTSignalOutput {
  direction: RTSignalDirection;
  confidence: number;            // 0–100
  upScore: number;               // raw bullish composite (max 100)
  downScore: number;             // raw bearish composite (max 100)
  expectedMovePoints: number;    // estimated index move in points
  optionProfitMin: number;       // ₹ minimum profit potential
  optionProfitMax: number;       // ₹ maximum profit potential
  volatilityScore: number;
  reasons: string[];             // ✔ confirmed conditions
  blockedReasons: string[];      // ❌ reasons signal was blocked
  atmStrike: number;
  timestamp: number;
  isMarketHours: boolean;
  cooldownRemaining: number;     // seconds until next signal allowed
  signalId: string;
}

export interface RTODEInput {
  // Market & spot
  spotPrice: number;
  activePage: "NIFTY" | "SENSEX";
  marketTimeResult: MarketTimeEngineResult;

  // Option chain raw data
  optionChain: any[];             // raw OptionStrike array
  pcr: number;

  // Aggregates from upstream engines
  momentumResult: MomentumEngineOutput;
  smartMoneyResult: SmartMoneySignal;
  breadthResult: MarketBreadthResult;
  probabilityResult: ProbabilityEngineResult;
  optionChainResult?: OptionChainEngineOutput;

  // OI aggregates (pre-calculated in index.tsx)
  totalCallOI: number;
  totalPutOI: number;
  totalCallOIChange: number;
  totalPutOIChange: number;
  totalCallVolume: number;
  totalPutVolume: number;

  // Score data
  scoreDifference: number;       // regimeData.score5mNet
  score15mDiff: number;

  // VWAP proxy (spot vs range midpoint)
  rangeHigh: number;
  rangeLow: number;
}

// ── Module-level cooldown state ───────────────────────────────────────────────
let _lastSignalTimestamp = 0;
let _lastSignalId = "";
const COOLDOWN_MS = 10 * 60 * 1000; // 10-minute cooldown

// ── Gamma factor for option premium estimation ────────────────────────────────
// ATM option typically moves 0.4–0.6 of underlying for every 50-point move (NIFTY)
// For SENSEX ATM, factor is lower (~0.35)
// We use lot-size weighted estimate: NIFTY lot=75, SENSEX lot=20
function estimateOptionProfit(
  expectedMovePoints: number,
  activePage: "NIFTY" | "SENSEX",
  volatilityScore: number
): { min: number; max: number } {
  const gammaFactor = activePage === "NIFTY" ? 0.42 : 0.38;
  const lotSize = activePage === "NIFTY" ? 75 : 20;
  const volBoost = volatilityScore >= 80 ? 1.4 : volatilityScore >= 65 ? 1.2 : 1.0;

  const premiumMove = expectedMovePoints * gammaFactor * volBoost;
  const minProfit = Math.round(premiumMove * lotSize * 0.8);
  const maxProfit = Math.round(premiumMove * lotSize * 2.0);
  return { min: minProfit, max: maxProfit };
}

// ── IST helpers ───────────────────────────────────────────────────────────────
function getISTMinutes(): number {
  const d = new Date();
  const ist = new Date(d.getTime() + 19800000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// ─────────────────────────────────────────────────────────────────────────────
export function computeRTPODE(input: RTODEInput): RTSignalOutput {
  const {
    spotPrice,
    activePage,
    marketTimeResult,
    optionChain,
    pcr,
    momentumResult,
    smartMoneyResult,
    breadthResult,
    probabilityResult,
    totalCallOIChange,
    totalPutOIChange,
    totalCallVolume,
    totalPutVolume,
    scoreDifference,
    score15mDiff,
    rangeHigh,
    rangeLow,
  } = input;

  const nowMs = Date.now();
  const reasons: string[] = [];
  const blockedReasons: string[] = [];

  // ── HARD GATE 1: Market Hours ─────────────────────────────────────────────
  const isMarketHours = marketTimeResult.isTradingAllowed;
  const strikeGap = activePage === "SENSEX" ? 100 : 50;
  const atmStrike = Math.round(spotPrice / strikeGap) * strikeGap;

  if (!isMarketHours) {
    return {
      direction: "NO_SIGNAL",
      confidence: 0,
      upScore: 0,
      downScore: 0,
      expectedMovePoints: 0,
      optionProfitMin: 0,
      optionProfitMax: 0,
      volatilityScore: 0,
      reasons: [],
      blockedReasons: ["⛔ Market is CLOSED. Signals only generated 9:15–15:30 IST (Mon–Fri)."],
      atmStrike,
      timestamp: nowMs,
      isMarketHours: false,
      cooldownRemaining: 0,
      signalId: "",
    };
  }

  // ── HARD GATE 2: Cooldown ────────────────────────────────────────────────
  const cooldownRemaining = _lastSignalTimestamp > 0
    ? Math.max(0, Math.round((COOLDOWN_MS - (nowMs - _lastSignalTimestamp)) / 1000))
    : 0;

  // ── STEP 1: Multi-Factor Scoring ──────────────────────────────────────────

  // ATM row from option chain
  const atmRow = optionChain?.find((s: any) => s.strikePrice === atmStrike);
  const avgCeVol = optionChain && optionChain.length > 0
    ? optionChain.reduce((s: number, r: any) => s + (r.ceVolume || 0), 0) / optionChain.length : 0;
  const avgPeVol = optionChain && optionChain.length > 0
    ? optionChain.reduce((s: number, r: any) => s + (r.peVolume || 0), 0) / optionChain.length : 0;

  // VWAP proxy: spot position relative to 15M range midpoint
  const rangeMid = (rangeHigh + rangeLow) / 2;
  const vwapBull = spotPrice > rangeMid;
  const vwapBear = spotPrice < rangeMid;

  // OI direction from aggregates
  const putWritingActive = totalPutOIChange > 0 && totalPutOIChange > Math.abs(totalCallOIChange) * 0.7;
  const callWritingActive = totalCallOIChange > 0 && totalCallOIChange > Math.abs(totalPutOIChange) * 0.7;

  // Volume spike: total CE or PE volume vs ATM
  const ceVolumeSpike = atmRow && avgCeVol > 0 ? (atmRow.ceVolume || 0) > avgCeVol * 1.4 : false;
  const peVolumeSpike = atmRow && avgPeVol > 0 ? (atmRow.peVolume || 0) > avgPeVol * 1.4 : false;

  // ── UP Score (bullish composite, max 100) ──
  let upScore = 0;

  // 1. Momentum bullish (max 25)
  const momBull = momentumResult.momentumDirection === "BULLISH";
  const momScore = momentumResult.momentumScore ?? 50;
  if (momBull && momScore > 65) { upScore += 25; reasons.push("✔ Momentum Bullish (score: " + momScore.toFixed(0) + ")"); }
  else if (momBull) { upScore += 15; }

  // 2. Smart money buying (max 25)
  const smBuying = smartMoneyResult.flowDirection === "BULLISH" && (smartMoneyResult.smartMoneyScore || 0) > 0;
  if (smBuying) {
    const smStrength = Math.min(25, Math.round(((smartMoneyResult.smartMoneyScore || 50) / 100) * 25));
    upScore += smStrength;
    reasons.push("✔ Smart Money Buying");
  }

  // 3. Put writing (OI) (max 20)
  if (putWritingActive) { upScore += 20; reasons.push("✔ OI Put Writing Active"); }
  else if (totalPutOIChange > 0) { upScore += 10; }

  // 4. Breadth bullish (max 15)
  const breadthBull = breadthResult.breadthScore > 55;
  if (breadthBull) {
    const bContrib = Math.min(15, Math.round(((breadthResult.breadthScore - 55) / 45) * 15));
    upScore += bContrib;
    if (bContrib >= 8) reasons.push("✔ Breadth Bullish (" + breadthResult.breadthScore.toFixed(0) + "%)");
  }

  // 5. VWAP bullish (max 15)
  if (vwapBull) { upScore += 15; reasons.push("✔ VWAP / Range Breakout"); }

  upScore = Math.min(100, upScore);

  // ── DOWN Score (bearish composite, max 100) ──
  let downScore = 0;

  // 1. Momentum bearish (max 25)
  const momBear = momentumResult.momentumDirection === "BEARISH";
  if (momBear && momScore > 65) { downScore += 25; reasons.push("✔ Momentum Bearish (score: " + momScore.toFixed(0) + ")"); }
  else if (momBear) { downScore += 15; }

  // 2. Smart money selling (max 25)
  const smSelling = smartMoneyResult.flowDirection === "BEARISH" && (smartMoneyResult.smartMoneyScore || 0) < 0;
  if (smSelling) {
    const smStrength = Math.min(25, Math.round((Math.abs(smartMoneyResult.smartMoneyScore || 50) / 100) * 25));
    downScore += smStrength;
    reasons.push("✔ Smart Money Selling");
  }

  // 3. Call writing (OI) (max 20)
  if (callWritingActive) { downScore += 20; reasons.push("✔ OI Call Writing Active"); }
  else if (totalCallOIChange > 0) { downScore += 10; }

  // 4. Breadth bearish (max 15)
  const breadthBear = breadthResult.breadthScore < 45;
  if (breadthBear) {
    const bContrib = Math.min(15, Math.round(((45 - breadthResult.breadthScore) / 45) * 15));
    downScore += bContrib;
    if (bContrib >= 8) reasons.push("✔ Breadth Bearish (" + breadthResult.breadthScore.toFixed(0) + "%)");
  }

  // 5. VWAP bearish (max 15)
  if (vwapBear) { downScore += 15; reasons.push("✔ VWAP / Range Breakdown"); }

  downScore = Math.min(100, downScore);

  // ── STEP 2: Volatility Score (from probability engine) ───────────────────
  const volatilityScore = probabilityResult.volatilityScore ?? 0;

  // ── STEP 3: Profit Potential Estimation ──────────────────────────────────
  const expectedMovePoints = Math.round((volatilityScore * 0.6) + (momScore * 0.4));
  const { min: profitMin, max: profitMax } = estimateOptionProfit(expectedMovePoints, activePage, volatilityScore);

  // ── TRADE QUALITY FILTER ──────────────────────────────────────────────────
  const dominantScore = Math.max(upScore, downScore);
  const directionBull = upScore > downScore;

  // Conflict check: CE and PE score within 15 points = conflicting
  const isConflicting = Math.abs(upScore - downScore) < 15;

  // OI confirmation: at least one of put/call writing must be active
  const oiConfirmed = putWritingActive || callWritingActive || (totalPutOIChange > 0) || (totalCallOIChange > 0);

  // 3-layer alignment: count how many of 5 dimensions agree with dominant direction
  const layersBull = [momBull, smBuying, putWritingActive, breadthBull, vwapBull].filter(Boolean).length;
  const layersBear = [momBear, smSelling, callWritingActive, breadthBear, vwapBear].filter(Boolean).length;
  const alignedLayers = directionBull ? layersBull : layersBear;

  // ── FINAL SIGNAL CONDITIONS ───────────────────────────────────────────────
  let direction: RTSignalDirection = "NO_SIGNAL";
  let blocked = false;

  if (dominantScore < 70) {
    blocked = true;
    blockedReasons.push(`❌ Score ${dominantScore} < 70 required (Up: ${upScore}, Down: ${downScore})`);
  }
  if (expectedMovePoints < 40) {
    blocked = true;
    blockedReasons.push(`❌ Expected move ${expectedMovePoints}pts < 40pts minimum`);
  }
  if (profitMin < 1000) {
    blocked = true;
    blockedReasons.push(`❌ Profit potential ₹${profitMin} < ₹1000 minimum`);
  }
  if (volatilityScore < 60) {
    blocked = true;
    blockedReasons.push(`❌ Volatility ${volatilityScore.toFixed(0)} < 60 (low volatility environment)`);
  }
  if (!oiConfirmed) {
    blocked = true;
    blockedReasons.push("❌ No OI confirmation from option chain");
  }
  if (alignedLayers < 3) {
    blocked = true;
    blockedReasons.push(`❌ Only ${alignedLayers}/5 layers aligned (minimum 3 required)`);
  }
  if (isConflicting) {
    blocked = true;
    blockedReasons.push("❌ Conflicting CE & PE signals (difference < 15 points)");
  }
  if (cooldownRemaining > 0) {
    blocked = true;
    blockedReasons.push(`❌ Cooldown active: ${Math.ceil(cooldownRemaining / 60)}m remaining`);
  }

  if (!blocked) {
    direction = directionBull ? "BUY_CE" : "BUY_PE";
    _lastSignalTimestamp = nowMs;
    _lastSignalId = `rtpode-${direction}-${nowMs}`;
  }

  // Confidence calculation (weighted from dominant score and layer count)
  const confidence = blocked ? 0 : Math.min(99, Math.round(
    (dominantScore * 0.5) +
    (alignedLayers / 5 * 30) +
    (Math.min(1, volatilityScore / 100) * 20)
  ));

  return {
    direction,
    confidence,
    upScore,
    downScore,
    expectedMovePoints,
    optionProfitMin: profitMin,
    optionProfitMax: profitMax,
    volatilityScore,
    reasons: direction !== "NO_SIGNAL" ? reasons : [],
    blockedReasons,
    atmStrike,
    timestamp: nowMs,
    isMarketHours,
    cooldownRemaining,
    signalId: _lastSignalId,
  };
}
