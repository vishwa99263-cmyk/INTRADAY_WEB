/**
 * optionFlowEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Smart Money Option Flow Execution Engine 2.0
 * Expiry Adaptive Momentum Engine (EAME) Add-on
 *
 * Evaluates options desks analytics: strike ranking, liquidity heatmaps,
 * OI momentum, trap detection, and expiry day/time-decay adaptive rules.
 *
 * Pure TypeScript — no React, no side effects.
 */

import type { OptionStrike } from "../types";
import type { AIDecisionResult } from "./aiDecisionEngine";
import type { StrategiesEngineOutput } from "./strategiesEngine";

export interface StrikeRank {
  strikePrice: number;
  score: number;
  direction: "CE" | "PE";
  symbol: string;
  premium: number;
}

export interface OptionFlowEngineOutput {
  expiryMode: "NORMAL" | "EXPIRY" | "EXPIRY_PRE" | "THETA_ZONE";
  timeZoneBias: "SLOW" | "NORMAL" | "FAST";
  tradeStyle: "SWING" | "INTRADAY" | "SCALP_ONLY";
  riskMultiplier: number;
  
  topStrikes: StrikeRank[];
  
  activeDecision: {
    strike: number;
    direction: "BUY_CE" | "BUY_PE" | "WAIT";
    entryZone: "VALID" | "INVALID";
    liquidity: "HIGH" | "MEDIUM" | "LOW";
    smartMoney: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    oiFlow: "BULLISH" | "BEARISH" | "NEUTRAL";
    trapRisk: "LOW" | "MEDIUM" | "HIGH";
    confidence: number;
  };
  
  isAutomationAllowed: boolean;
  reasons: string[];
}

export interface OptionFlowInput {
  optionChain: OptionStrike[];
  spotPrice: number;
  activePage: "NIFTY" | "SENSEX";
  strategiesResult: StrategiesEngineOutput;
  aiDecisionResult: AIDecisionResult;
  currentTimeMs: number;
}

export function computeOptionFlow(input: OptionFlowInput): OptionFlowEngineOutput {
  const {
    optionChain = [],
    spotPrice,
    activePage,
    strategiesResult,
    aiDecisionResult,
    currentTimeMs,
  } = input;

  const reasons: string[] = [];

  // Guard: Empty option chain
  if (optionChain.length === 0) {
    return {
      expiryMode: "NORMAL",
      timeZoneBias: "SLOW",
      tradeStyle: "INTRADAY",
      riskMultiplier: 1.0,
      topStrikes: [],
      activeDecision: {
        strike: 0,
        direction: "WAIT",
        entryZone: "INVALID",
        liquidity: "LOW",
        smartMoney: "NEUTRAL",
        oiFlow: "NEUTRAL",
        trapRisk: "HIGH",
        confidence: 0,
      },
      isAutomationAllowed: false,
      reasons: ["⚠ Option chain data offline"],
    };
  }

  // ── 1. Expiry Adaptive Momentum Engine (EAME) Day & Time Classification ──
  const ist = new Date(currentTimeMs + 19800000); // 5.5 * 3600 * 1000
  const dayOfWeek = ist.getUTCDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const totalMins = hours * 60 + minutes;

  // Day type rules:
  // NIFTY expires on Thursday (4), Expiry-1 is Wednesday (3)
  // SENSEX expires on Friday (5), Expiry-1 is Thursday (4)
  const isNifty = activePage === "NIFTY";
  const isExpiryDay = isNifty ? dayOfWeek === 4 : dayOfWeek === 5;
  const isExpiryPreDay = isNifty ? dayOfWeek === 3 : dayOfWeek === 4;

  let expiryMode: OptionFlowEngineOutput["expiryMode"] = "NORMAL";
  let timeZoneBias: OptionFlowEngineOutput["timeZoneBias"] = "NORMAL";
  let tradeStyle: OptionFlowEngineOutput["tradeStyle"] = "INTRADAY";
  let riskMultiplier = 1.0;

  if (isExpiryDay) {
    expiryMode = "EXPIRY";
    timeZoneBias = "FAST";
    tradeStyle = "SCALP_ONLY";
    riskMultiplier = 1.5;
    reasons.push("📅 EAME: Expiry day rules active - FAST move scalping prioritized.");
  } else if (isExpiryPreDay) {
    expiryMode = "EXPIRY_PRE";
    timeZoneBias = "NORMAL";
    tradeStyle = "INTRADAY";
    riskMultiplier = 0.8;
    reasons.push("📅 EAME: Expiry-1 day rules active - smart money accumulation observed.");
  } else {
    expiryMode = "NORMAL";
    timeZoneBias = "NORMAL";
    tradeStyle = "INTRADAY";
    riskMultiplier = 1.0;
    reasons.push("📅 EAME: Normal session day - trend confirmation prioritized.");
  }

  // Theta Decay Zone check
  if (totalMins >= 14 * 60) {
    // 2:00 PM onwards
    expiryMode = "THETA_ZONE";
    timeZoneBias = "FAST";
    tradeStyle = "SCALP_ONLY";
    riskMultiplier = 0.5;
    reasons.push("⏳ EAME: Theta Decay zone active - premium decay accelerating.");
  }

  // EAME: Fast Momentum Mode Trigger
  // if (expiryDay == true && time >= 13:00 && breakout == true && pcr_divergence)
  const isAfter1300 = totalMins >= 13 * 60;
  const isBreakout = strategiesResult.signal !== "WAIT";
  
  // PCR calculation
  const totalCallOi = optionChain.reduce((sum, s) => sum + s.ceOI, 0);
  const totalPutOi = optionChain.reduce((sum, s) => sum + s.peOI, 0);
  const pcrVal = totalCallOi > 0 ? totalPutOi / totalCallOi : 1.0;
  const isPcrImbalance = Math.abs(pcrVal - 1.0) > 0.15;

  const isFastModeActive = isExpiryDay && isAfter1300 && isBreakout && isPcrImbalance;
  if (isFastModeActive) {
    timeZoneBias = "FAST";
    tradeStyle = "SCALP_ONLY";
    riskMultiplier = 2.0;
    reasons.push("⚡ EAME: FAST MOMENTUM ACTIVE - Tight SL / scalp targets enabled.");
  }

  // ── 2. Strike Ranking Engine ──
  const spotPx = spotPrice || 0;
  const strikeGap = activePage === "SENSEX" ? 100 : 50;
  const atmStrike = spotPx > 0 ? Math.round(spotPx / strikeGap) * strikeGap : 0;

  // Average volumes across strikes
  const totalCeVol = optionChain.reduce((sum, s) => sum + s.ceVolume, 0);
  const totalPeVol = optionChain.reduce((sum, s) => sum + s.peVolume, 0);
  const avgCeVolume = totalCeVol / optionChain.length;
  const avgPeVolume = totalPeVol / optionChain.length;

  const rankedStrikes: StrikeRank[] = [];

  optionChain.forEach(s => {
    const ceOiChangeAbs = Math.abs(s.ceOIChange);
    const peOiChangeAbs = Math.abs(s.peOIChange);
    const ceVol = s.ceVolume;
    const peVol = s.peVolume;
    const dist = Math.abs(s.strikePrice - spotPx);

    // Strike Proximity Score: 0 to 100 points
    const distScore = dist === 0 ? 100 : Math.max(0, 100 - (dist / spotPx) * 2000);

    // CE Score
    const ceScore = ceOiChangeAbs * 0.35 + ceVol * 0.35 + distScore * 10;
    rankedStrikes.push({
      strikePrice: s.strikePrice,
      score: Math.min(99, Math.max(5, Math.round(ceScore / 1000))),
      direction: "CE",
      symbol: `${activePage} CE ${s.strikePrice}`,
      premium: s.ceLtp,
    });

    // PE Score
    const peScore = peOiChangeAbs * 0.35 + peVol * 0.35 + distScore * 10;
    rankedStrikes.push({
      strikePrice: s.strikePrice,
      score: Math.min(99, Math.max(5, Math.round(peScore / 1000))),
      direction: "PE",
      symbol: `${activePage} PE ${s.strikePrice}`,
      premium: s.peLtp,
    });
  });

  // Sort Ranked Strikes descending
  rankedStrikes.sort((a, b) => b.score - a.score);
  const topStrikes = rankedStrikes.slice(0, 6);

  // ── 3. Liquidity Heatmap Engine ──
  const atmRow = optionChain.find(s => s.strikePrice === atmStrike);
  let liquidity: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (atmRow) {
    const atmVolume = atmRow.ceVolume + atmRow.peVolume;
    const avgVolume = (avgCeVolume + avgPeVolume) || 1;
    if (atmVolume > avgVolume * 1.5) {
      liquidity = "HIGH";
    } else if (atmVolume > avgVolume * 0.7) {
      liquidity = "MEDIUM";
    } else {
      liquidity = "LOW";
    }
  }

  // ── 4. OI Momentum Engine ──
  let oiFlow: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (atmRow) {
    const isPutWriting = atmRow.peOIChange > 0;
    const isCallUnwinding = atmRow.ceOIChange < 0;
    const isCallWriting = atmRow.ceOIChange > 0;
    const isPutUnwinding = atmRow.peOIChange < 0;

    if (isPutWriting && isCallUnwinding && pcrVal > 1.05) {
      oiFlow = "BULLISH";
    } else if (isCallWriting && isPutUnwinding && pcrVal < 0.95) {
      oiFlow = "BEARISH";
    }
  }

  // ── 5. Smart Money Flow Engine ──
  let smartMoney: "POSITIVE" | "NEGATIVE" | "NEUTRAL" = "NEUTRAL";
  if (atmRow) {
    const hasOiSpike = Math.abs(atmRow.ceOIChange) > avgCeVolume * 0.8 || Math.abs(atmRow.peOIChange) > avgPeVolume * 0.8;
    const hasVolumeExplosion = atmRow.ceVolume > avgCeVolume * 1.8 || atmRow.peVolume > avgPeVolume * 1.8;
    
    if (hasOiSpike && hasVolumeExplosion) {
      if (oiFlow === "BULLISH") smartMoney = "POSITIVE";
      else if (oiFlow === "BEARISH") smartMoney = "NEGATIVE";
    }
  }

  // ── 6. Trap Detection Engine ──
  let trapRisk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  let isTrapDetected = false;

  if (atmRow) {
    // Trap 1: Volume spike without OI Change confirmation
    const ceVolSpikeWithoutOi = atmRow.ceVolume > avgCeVolume * 1.8 && Math.abs(atmRow.ceOIChange) < avgCeVolume * 0.1;
    const peVolSpikeWithoutOi = atmRow.peVolume > avgPeVolume * 1.8 && Math.abs(atmRow.peOIChange) < avgPeVolume * 0.1;

    // Trap 2: PCR diverging from price action
    const isPriceRising = aiDecisionResult.finalDecision === "BUY_CE";
    const isPriceFalling = aiDecisionResult.finalDecision === "BUY_PE";
    const isPcrDiverging = (isPriceRising && pcrVal < 0.6) || (isPriceFalling && pcrVal > 1.7);

    if (ceVolSpikeWithoutOi || peVolSpikeWithoutOi || isPcrDiverging) {
      trapRisk = "HIGH";
      isTrapDetected = true;
      reasons.push("🚨 Trap Engine: High risk detected! Volume spike without OI confirmation / PCR divergence.");
    } else if (atmRow.ceVolume > avgCeVolume * 1.3 || atmRow.peVolume > avgPeVolume * 1.3) {
      trapRisk = "MEDIUM";
    }
  }

  // ── 7. Entry Zone Detection ──
  let entryZone: "VALID" | "INVALID" = "INVALID";
  const isSpotNearAtm = atmStrike > 0 && Math.abs(spotPx - atmStrike) <= strikeGap * 0.8;
  const isLiquidityAcceptable = liquidity === "HIGH" || liquidity === "MEDIUM";
  const isPcrStable = pcrVal >= 0.5 && pcrVal <= 1.8;

  if (isSpotNearAtm && isLiquidityAcceptable && isPcrStable && !isTrapDetected) {
    entryZone = "VALID";
  }

  // Determine Option Flow Direction
  let flowDirection: "BUY_CE" | "BUY_PE" | "WAIT" = "WAIT";
  if (oiFlow === "BULLISH" && smartMoney === "POSITIVE" && entryZone === "VALID") {
    flowDirection = "BUY_CE";
  } else if (oiFlow === "BEARISH" && smartMoney === "NEGATIVE" && entryZone === "VALID") {
    flowDirection = "BUY_PE";
  }

  // Confidence rating
  let confidence = 50;
  if (flowDirection !== "WAIT") {
    let score = 70;
    if (liquidity === "HIGH") score += 10;
    if (trapRisk === "LOW") score += 10;
    if (isExpiryDay) score += 5;
    confidence = Math.min(99, score);
  } else {
    let score = 30;
    if (isSpotNearAtm) score += 10;
    if (isLiquidityAcceptable) score += 10;
    confidence = score;
  }

  // EAME Expiry Limits: theta crush zone blocker (no trade after 14:30 IST on expiry days)
  const isThetaCrushZone = isExpiryDay && totalMins >= (14 * 60 + 30);
  // Expiry-1 opening risk blocker (no trade between 9:15 and 10:00 IST)
  const isExpiryPreMorningRisk = isExpiryPreDay && totalMins < 10 * 60;

  const isAutomationAllowed = 
    entryZone === "VALID" &&
    confidence >= 65 &&
    trapRisk === "LOW" &&
    !isThetaCrushZone &&
    !isExpiryPreMorningRisk &&
    optionChain.length > 0;

  if (isThetaCrushZone) {
    reasons.push("❌ Blocked: Theta Crush zone active (after 14:30 IST on Expiry day).");
  }
  if (isExpiryPreMorningRisk) {
    reasons.push("❌ Blocked: Expiry-1 Morning Risk window active (before 10:00 IST).");
  }

  // Selected top strike price
  const selectedStrikePrice = topStrikes.length > 0 ? topStrikes[0].strikePrice : atmStrike;

  return {
    expiryMode,
    timeZoneBias,
    tradeStyle,
    riskMultiplier,
    topStrikes,
    activeDecision: {
      strike: selectedStrikePrice,
      direction: flowDirection,
      entryZone,
      liquidity,
      smartMoney,
      oiFlow,
      trapRisk,
      confidence,
    },
    isAutomationAllowed,
    reasons,
  };
}
