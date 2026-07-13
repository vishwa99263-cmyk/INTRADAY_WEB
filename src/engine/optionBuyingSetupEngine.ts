/**
 * optionBuyingSetupEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Layer 15: Option Buying Setup Engine
 *
 * Purpose: Pure CE / PE BUYING setup generator.
 * 
 * Given the AI decision (BUY_CE / BUY_PE) + live option chain data:
 *  1. Selects the BEST strike to buy (ATM, ATM±1, ATM±2) for max profit
 *  2. Computes entry premium, SL (premium), T1, T2 at option level
 *  3. Calculates lot-size-based risk (₹) and expected P&L
 *  4. Rates the setup quality based on R:R, OI support, IV conditions
 *
 * Conditions-based strike selection:
 *  - High confidence (>75) → ATM (delta ~0.5, best premium movement)
 *  - Breakout mode → ATM+1 ITM for CE / ATM-1 ITM for PE (more delta)
 *  - Range edge mode → ATM for safer entries
 *  - Low confidence (<55) → Skip / WAIT
 *
 * Pure TypeScript — no React, no side effects.
 */

import type { AIDecisionResult } from "./aiDecisionEngine";
import type { EntryZoneResult }   from "./entryZoneEngine";
import type { ProbabilityEngineResult } from "./probabilityEngine";
import type { OptionChainEngineOutput } from "./optionChainEngine";
import type { MomentumEngineOutput }    from "./momentumEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SetupDirection = "BUY_CE" | "BUY_PE" | "WAIT";
export type StrikePosition = "ITM_2" | "ITM_1" | "ATM" | "OTM_1" | "OTM_2";
export type SetupTier      = "TIER_1_INSTITUTIONAL" | "TIER_2_PROBABILISTIC" | "TIER_3_SPECULATIVE" | "NO_SETUP";

export interface OIStrikeRaw {
  strikePrice: number;
  ceOI:        number;
  ceOIChange:  number;
  ceVolume:    number;
  ceLtp:       number;
  ceBid?:      number;
  ceAsk?:      number;
  ceIV?:       number;
  peOI:        number;
  peOIChange:  number;
  peVolume:    number;
  peLtp:       number;
  peBid?:      number;
  peAsk?:      number;
  peIV?:       number;
}

export interface SelectedStrike {
  strikePrice:   number;
  position:      StrikePosition;
  ltp:           number;          // Current option premium (LTP)
  iv:            number;          // Implied Volatility %
  oi:            number;          // Open Interest
  oiChange:      number;          // OI Change (buildup if +ve)
  volume:        number;          // Trading volume
  rrScore:       number;          // Strike-level R:R score 0–100
  reasoning:     string;
}

export interface OptionBuyingLevels {
  /** Entry premium range [low, high] */
  entryPremium:     number;
  entryPremiumLow:  number;
  entryPremiumHigh: number;

  /** Stop loss at premium level (max loss per lot) */
  slPremium:        number;
  slSpot:           number;        // Corresponding spot price for SL

  /** Target 1: Book 50% here */
  t1Premium:        number;
  t1Spot:           number;

  /** Target 2: Trail remaining position */
  t2Premium:        number;
  t2Spot:           number;

  /** Risk/Reward ratio */
  riskReward:       number;
  riskPerLot:       number;        // ₹ at risk per lot
  rewardT1PerLot:   number;        // ₹ profit at T1 per lot
  rewardT2PerLot:   number;        // ₹ profit at T2 per lot

  /** Recommended lot size based on ₹ risk */
  recommendedLots:  number;

  /** % SL from entry (option premium) */
  slPct:            number;
  t1Pct:            number;
  t2Pct:            number;
}

export interface OptionBuyingSetup {
  direction:         SetupDirection;
  tier:              SetupTier;
  
  /** Selected strike to buy */
  selectedStrike:    SelectedStrike | null;

  /** All evaluated strikes ranked by quality */
  rankedStrikes:     SelectedStrike[];

  /** Precise premium levels */
  levels:            OptionBuyingLevels | null;

  /** Setup quality 0–100 */
  setupScore:        number;

  /** Why this setup was selected / rejected */
  reasoning:         string[];

  /** Whether to execute NOW or wait */
  execute:           boolean;

  /** Key conditions that triggered this setup */
  triggeredBy:       string[];

  /** Spot price levels for reference */
  spotEntry:         number;
  spotSL:            number;
  spotT1:            number;
  spotT2:            number;

  /** Expiry recommendation */
  expiryNote:        string;
  
  timestamp:         number;
}

export interface OptionBuyingSetupInput {
  /** Final AI decision */
  aiDecisionResult:   AIDecisionResult;

  /** Entry zone (spot levels) */
  entryZoneResult:    EntryZoneResult;

  /** Probability engine output */
  probabilityResult:  ProbabilityEngineResult;

  /** Option chain engine output (OI walls, max pain, PCR) */
  optionChainResult?: OptionChainEngineOutput;

  /** Momentum engine output */
  momentumResult?:    MomentumEngineOutput;

  /** Raw option chain strikes with LTP data */
  rawStrikes:         OIStrikeRaw[];

  /** Current spot price */
  spotPrice:          number;

  /** Active index name */
  instrument:         string;

  /** Index lot size (NIFTY=75, BANKNIFTY=35, SENSEX=20) */
  lotSize:            number;

  /** Max capital to risk per trade in ₹ */
  maxRiskPerTrade?:   number;

  /** India VIX */
  indiaVix?:          number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOT_SIZES: Record<string, number> = {
  NIFTY:     75,
  BANKNIFTY: 35,
  SENSEX:    20,
  HDFCBANK:  550,
  RELIANCE:  250,
  ICICIBANK: 700,
};

const DEFAULT_RISK_PER_TRADE = 5000; // ₹5000 default max risk

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round0(v: number): number {
  return Math.round(v);
}

/** Find ATM strike (nearest to spot) */
function findATMStrike(strikes: OIStrikeRaw[], spotPrice: number): number {
  if (strikes.length === 0) return spotPrice;
  return strikes.reduce((nearest, s) =>
    Math.abs(s.strikePrice - spotPrice) < Math.abs(nearest - spotPrice)
      ? s.strikePrice
      : nearest,
    strikes[0].strikePrice
  );
}

/** Get strike position label relative to ATM */
function strikePosition(strike: number, atm: number, gap: number): StrikePosition {
  const diff = Math.round((strike - atm) / gap);
  if (diff <= -2) return "ITM_2";
  if (diff === -1) return "ITM_1";
  if (diff === 0)  return "ATM";
  if (diff === 1)  return "OTM_1";
  return "OTM_2";
}

/** Detect strike gap (50 for NIFTY, 100 for BANKNIFTY/SENSEX etc) */
function detectStrikeGap(strikes: OIStrikeRaw[]): number {
  if (strikes.length < 2) return 50;
  const gaps = strikes
    .slice(0, -1)
    .map((s, i) => strikes[i + 1].strikePrice - s.strikePrice)
    .filter(g => g > 0);
  if (gaps.length === 0) return 50;
  return Math.min(...gaps);
}

/** Score a CE strike for buying (higher = better) */
function scoreCEStrike(
  s: OIStrikeRaw,
  pos: StrikePosition,
  confidence: number,
  momentum: number,
  spotEntry: number,
): number {
  let score = 0;

  // Premium reasonableness: too low = gamma risk, too high = too expensive
  const premiumPct = s.ceLtp > 0 ? (s.ceLtp / spotEntry) * 100 : 0;
  if (premiumPct >= 0.3 && premiumPct <= 1.5) score += 25;
  else if (premiumPct >= 0.15 && premiumPct <= 2.5) score += 15;
  else score += 5;

  // Position bonus
  if (pos === "ATM")   score += 30;  // Best delta for buyers
  if (pos === "ITM_1") score += 25;  // Higher delta, expensive
  if (pos === "OTM_1") score += 20;  // Cheaper, less delta
  if (pos === "ITM_2") score += 15;
  if (pos === "OTM_2") score += 8;

  // OI buildup (put writing supports → buyers win)
  if (s.ceOIChange > 0) score += 10;   // new positions building (momentum)
  if (s.ceVolume > s.ceOI * 0.1) score += 5;  // high relative volume

  // High confidence → prefer ATM/ITM
  if (confidence > 75 && (pos === "ATM" || pos === "ITM_1")) score += 10;
  if (momentum > 70 && (pos === "ITM_1" || pos === "ATM")) score += 5;

  return clamp(score, 0, 100);
}

/** Score a PE strike for buying (higher = better) */
function scorePEStrike(
  s: OIStrikeRaw,
  pos: StrikePosition,
  confidence: number,
  momentum: number,
  spotEntry: number,
): number {
  let score = 0;

  const premiumPct = s.peLtp > 0 ? (s.peLtp / spotEntry) * 100 : 0;
  if (premiumPct >= 0.3 && premiumPct <= 1.5) score += 25;
  else if (premiumPct >= 0.15 && premiumPct <= 2.5) score += 15;
  else score += 5;

  // For PE, ATM = 0 diff, ITM for PE means strike > spot
  if (pos === "ATM")   score += 30;
  if (pos === "OTM_1") score += 25;  // For PE: OTM_1 is actually 1 step below ATM
  if (pos === "ITM_1") score += 20;
  if (pos === "OTM_2") score += 15;
  if (pos === "ITM_2") score += 8;

  if (s.peOIChange > 0) score += 10;
  if (s.peVolume > s.peOI * 0.1) score += 5;

  if (confidence > 75 && (pos === "ATM" || pos === "OTM_1")) score += 10;
  if (momentum > 70 && pos === "ATM") score += 5;

  return clamp(score, 0, 100);
}

// ── WAIT output ───────────────────────────────────────────────────────────────

function waitSetup(reasoning: string[]): OptionBuyingSetup {
  return {
    direction: "WAIT",
    tier: "NO_SETUP",
    selectedStrike: null,
    rankedStrikes: [],
    levels: null,
    setupScore: 0,
    reasoning,
    execute: false,
    triggeredBy: [],
    spotEntry: 0, spotSL: 0, spotT1: 0, spotT2: 0,
    expiryNote: "",
    timestamp: Date.now(),
  };
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeOptionBuyingSetup(input: OptionBuyingSetupInput): OptionBuyingSetup {
  const {
    aiDecisionResult,
    entryZoneResult,
    probabilityResult,
    optionChainResult,
    momentumResult,
    rawStrikes,
    spotPrice,
    instrument,
    indiaVix = 0,
    maxRiskPerTrade = DEFAULT_RISK_PER_TRADE,
  } = input;

  const reasoning: string[] = [];
  const triggeredBy: string[] = [];
  const lotSize = LOT_SIZES[instrument] ?? 75;

  // ── GATE 1: Only proceed on BUY_CE / BUY_PE ──────────────────────────────
  const finalDecision = aiDecisionResult.finalDecision;
  const direction: SetupDirection =
    finalDecision === "BUY_CE" ? "BUY_CE" :
    finalDecision === "BUY_PE" ? "BUY_PE" : "WAIT";

  if (direction === "WAIT") {
    reasoning.push(`⏳ WAIT — AI Decision: ${finalDecision}. No buying setup generated.`);
    return waitSetup(reasoning);
  }

  reasoning.push(`✅ AI Decision: ${direction} | Confidence: ${aiDecisionResult.confidence}%`);

  // ── GATE 2: Need valid spot entry from entryZoneEngine ────────────────────
  const spotEntry = entryZoneResult.entryPrice > 0 ? entryZoneResult.entryPrice : spotPrice;
  const spotSL    = entryZoneResult.stopLoss;
  const spotT1    = entryZoneResult.target;

  if (spotSL <= 0 || spotT1 <= 0) {
    reasoning.push("❌ Entry zone has no valid SL/Target — cannot build option setup");
    return waitSetup(reasoning);
  }

  // ── GATE 3: Minimum confidence required for option buying ─────────────────
  const confidence = aiDecisionResult.confidence;
  if (confidence < 45) {
    reasoning.push(`❌ Confidence too low: ${confidence}% — minimum 45% required for buying`);
    return waitSetup(reasoning);
  }

  // ── GATE 4: VIX check — high IV makes buying expensive ───────────────────
  let vixWarning = "";
  if (indiaVix > 20) {
    vixWarning = `⚠ High VIX (${indiaVix.toFixed(1)}) — premiums inflated, use tighter SL`;
    reasoning.push(vixWarning);
  }

  // ── STRIKE SELECTION ──────────────────────────────────────────────────────
  if (!rawStrikes || rawStrikes.length === 0) {
    reasoning.push("❌ No raw strike data available — cannot select strike");
    return waitSetup(reasoning);
  }

  const sortedStrikes = [...rawStrikes].sort((a, b) => a.strikePrice - b.strikePrice);
  const atmStrike     = findATMStrike(sortedStrikes, spotPrice);
  const strikeGap     = detectStrikeGap(sortedStrikes);
  const momentum      = momentumResult?.momentumScore ?? 50;

  // Filter strikes within ±3 gaps from ATM (relevant zone only)
  const relevantStrikes = sortedStrikes.filter(
    s => Math.abs(s.strikePrice - atmStrike) <= strikeGap * 3
  );

  const isCE = direction === "BUY_CE";

  // Score each relevant strike
  const scored: SelectedStrike[] = relevantStrikes
    .filter(s => {
      const ltp = isCE ? s.ceLtp : s.peLtp;
      return ltp > 0.5; // Filter out zero-premium strikes
    })
    .map(s => {
      const pos = strikePosition(s.strikePrice, atmStrike, strikeGap);
      const ltp = isCE ? s.ceLtp : s.peLtp;
      const oi  = isCE ? s.ceOI  : s.peOI;
      const oiChange = isCE ? s.ceOIChange : s.peOIChange;
      const vol = isCE ? s.ceVolume  : s.peVolume;
      const iv  = isCE ? (s.ceIV ?? 0) : (s.peIV ?? 0);

      const rrScore = isCE
        ? scoreCEStrike(s, pos, confidence, momentum, spotEntry)
        : scorePEStrike(s, pos, confidence, momentum, spotEntry);

      const reasonText = isCE
        ? `CE ${s.strikePrice} (${pos}) — LTP: ₹${ltp.toFixed(1)} | OI: ${(oi/1000).toFixed(0)}K | Score: ${rrScore}`
        : `PE ${s.strikePrice} (${pos}) — LTP: ₹${ltp.toFixed(1)} | OI: ${(oi/1000).toFixed(0)}K | Score: ${rrScore}`;

      return {
        strikePrice: s.strikePrice,
        position: pos,
        ltp,
        iv,
        oi,
        oiChange,
        volume: vol,
        rrScore,
        reasoning: reasonText,
      } as SelectedStrike;
    })
    .sort((a, b) => b.rrScore - a.rrScore); // Best score first

  if (scored.length === 0) {
    reasoning.push("❌ No valid strikes found with sufficient premium");
    return waitSetup(reasoning);
  }

  const best = scored[0];
  reasoning.push(`✅ Best Strike: ${isCE ? "CE" : "PE"} ${best.strikePrice} (${best.position}) — LTP ₹${best.ltp.toFixed(1)}`);
  triggeredBy.push(`Strike: ${best.strikePrice} ${isCE ? "CE" : "PE"} (${best.position})`);

  // ── PREMIUM LEVELS CALCULATION ─────────────────────────────────────────────
  const entryPremium    = best.ltp;
  const spotRange       = Math.abs(spotT1 - spotEntry);
  const spotRisk        = Math.abs(spotEntry - spotSL);
  
  // Option premium moves faster than spot (using delta approximation)
  // ATM delta ≈ 0.5, ITM delta ≈ 0.65, OTM delta ≈ 0.35
  const approxDelta = best.position === "ITM_1" || best.position === "ITM_2" ? 0.60 :
                      best.position === "ATM"                                ? 0.50 :
                      best.position === "OTM_1"                              ? 0.35 : 0.22;

  // SL: spot SL → premium SL using delta
  const slPoints    = spotRisk * approxDelta;
  const slPremium   = round2(Math.max(0.5, entryPremium - slPoints));
  const slPct       = round2(((entryPremium - slPremium) / entryPremium) * 100);

  // T1: first target — 50% of expected spot move
  const t1SpotMove  = spotRange * 0.5;
  const t1Premium   = round2(entryPremium + t1SpotMove * approxDelta);
  const t1Pct       = round2(((t1Premium - entryPremium) / entryPremium) * 100);

  // T2: full target + momentum premium expansion (buying leverage)
  const t2SpotMove  = spotRange;
  const t2Premium   = round2(entryPremium + t2SpotMove * approxDelta * 1.2); // 1.2x for premium expansion
  const t2Pct       = round2(((t2Premium - entryPremium) / entryPremium) * 100);

  // Calculate T2 spot
  const spotT2 = isCE
    ? round0(spotEntry + spotRange * 1.5)
    : round0(spotEntry - spotRange * 1.5);

  // Risk / Reward per lot
  const riskPerLot      = round2((entryPremium - slPremium) * lotSize);
  const rewardT1PerLot  = round2((t1Premium - entryPremium) * lotSize);
  const rewardT2PerLot  = round2((t2Premium - entryPremium) * lotSize);
  const riskReward      = riskPerLot > 0 ? round2(rewardT2PerLot / riskPerLot) : 0;

  // Recommended lots
  const recommendedLots = riskPerLot > 0
    ? Math.max(1, Math.floor(maxRiskPerTrade / riskPerLot))
    : 1;

  const levels: OptionBuyingLevels = {
    entryPremium:     round2(entryPremium),
    entryPremiumLow:  round2(entryPremium * 0.97), // 3% below for limit orders
    entryPremiumHigh: round2(entryPremium * 1.03), // 3% above for market
    slPremium:        slPremium,
    slSpot:           round0(spotSL),
    t1Premium:        t1Premium,
    t1Spot:           round0(spotT1),
    t2Premium:        t2Premium,
    t2Spot:           spotT2,
    riskReward:       riskReward,
    riskPerLot:       riskPerLot,
    rewardT1PerLot:   rewardT1PerLot,
    rewardT2PerLot:   rewardT2PerLot,
    recommendedLots:  recommendedLots,
    slPct:            slPct,
    t1Pct:            t1Pct,
    t2Pct:            t2Pct,
  };

  reasoning.push(`Entry: ₹${entryPremium.toFixed(1)} | SL: ₹${slPremium.toFixed(1)} (-${slPct}%) | T1: ₹${t1Premium.toFixed(1)} (+${t1Pct}%) | T2: ₹${t2Premium.toFixed(1)} (+${t2Pct}%)`);
  reasoning.push(`R:R = ${riskReward.toFixed(2)} | Risk/Lot: ₹${riskPerLot} | T1 Profit/Lot: ₹${rewardT1PerLot} | Recommended Lots: ${recommendedLots}`);

  // ── SETUP TIER CLASSIFICATION ─────────────────────────────────────────────
  let tier: SetupTier;
  const setupScore = clamp(Math.round(
    confidence * 0.40 +
    best.rrScore * 0.30 +
    (riskReward >= 2 ? 100 : riskReward * 50) * 0.20 +
    (probabilityResult.confidenceLevel) * 0.10
  ));

  if (setupScore >= 80 && riskReward >= 2.5 && confidence >= 75) {
    tier = "TIER_1_INSTITUTIONAL";
    triggeredBy.push("INSTITUTIONAL GRADE — High confidence + Strong R:R");
    reasoning.push("🏆 TIER 1 — Institutional grade setup. Full position sizing allowed.");
  } else if (setupScore >= 60 && riskReward >= 1.8) {
    tier = "TIER_2_PROBABILISTIC";
    triggeredBy.push("PROBABILISTIC GRADE — Good R:R + Moderate confidence");
    reasoning.push("⭐ TIER 2 — Probabilistic setup. 50–75% position sizing recommended.");
  } else if (setupScore >= 40 && riskReward >= 1.5) {
    tier = "TIER_3_SPECULATIVE";
    triggeredBy.push("SPECULATIVE — Minimum conditions met");
    reasoning.push("⚡ TIER 3 — Speculative setup. 25–50% position sizing. Strict SL.");
  } else {
    tier = "NO_SETUP";
    reasoning.push(`❌ Setup score too low (${setupScore}/100) or R:R insufficient (${riskReward.toFixed(2)}) — WAIT`);
    return waitSetup(reasoning);
  }

  // Expiry note
  const expiryNote = confidence >= 70
    ? "Use current week expiry for maximum theta advantage as buyer"
    : "Use next week expiry to avoid rapid theta decay";

  // Should we execute now?
  const execute = riskReward >= 1.5 && confidence >= 50;

  return {
    direction,
    tier,
    selectedStrike: best,
    rankedStrikes: scored.slice(0, 5), // Top 5 strikes
    levels,
    setupScore,
    reasoning,
    execute,
    triggeredBy,
    spotEntry: round0(spotEntry),
    spotSL:    round0(spotSL),
    spotT1:    round0(spotT1),
    spotT2:    spotT2,
    expiryNote,
    timestamp: Date.now(),
  };
}

// ── UI Metadata ───────────────────────────────────────────────────────────────

export const SETUP_TIER_META: Record<SetupTier, {
  label: string; color: string; bg: string; border: string; emoji: string; sizingNote: string;
}> = {
  TIER_1_INSTITUTIONAL: {
    label: "TIER 1 — INSTITUTIONAL",
    color: "text-emerald-300",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
    emoji: "🏆",
    sizingNote: "Full position size",
  },
  TIER_2_PROBABILISTIC: {
    label: "TIER 2 — PROBABILISTIC",
    color: "text-sky-300",
    bg: "bg-sky-500/12",
    border: "border-sky-500/35",
    emoji: "⭐",
    sizingNote: "50–75% position size",
  },
  TIER_3_SPECULATIVE: {
    label: "TIER 3 — SPECULATIVE",
    color: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    emoji: "⚡",
    sizingNote: "25–50% position size",
  },
  NO_SETUP: {
    label: "NO SETUP",
    color: "text-slate-400",
    bg: "bg-slate-800/40",
    border: "border-slate-700/30",
    emoji: "⏳",
    sizingNote: "—",
  },
};

export const STRIKE_POS_META: Record<StrikePosition, { label: string; color: string }> = {
  ITM_2: { label: "ITM +2",  color: "text-emerald-300" },
  ITM_1: { label: "ITM +1",  color: "text-emerald-400" },
  ATM:   { label: "ATM",     color: "text-amber-400"   },
  OTM_1: { label: "OTM -1",  color: "text-orange-400"  },
  OTM_2: { label: "OTM -2",  color: "text-red-400"     },
};
