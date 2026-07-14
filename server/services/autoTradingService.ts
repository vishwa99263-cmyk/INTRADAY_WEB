import { marketState } from "../state/marketState.js";
import { getISTTime } from "../utils/timerUtils.js";
import {
  savePaperTrade,
  getPaperTrades,
  closePaperTrade,
  updatePaperTradeSL,
  getLotSize,
  saveShadowTrade,
  getShadowTrades,
  closeShadowTrade,
  updateShadowTradeSL
} from "./tradingEngineDB.js";
import { getGlobalAIBrainConsensus } from "./aiBrainConsensus.js";
import { csGetTrades } from "./continuousScalpEngine.js";
import type { AntigravityDecision } from "./antigravityEngine.js";
import type { StrategyAlignment } from "./strategyAlignmentEngine.js";
import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { MomentumStateResult } from "./momentumEngine.js";
import type { Server as SocketIOServer } from "socket.io";
import type { BreakoutState } from "./breakoutEngine.js";
import { liveOptionTicks, fetchAtmStrikeForExpiry } from "./optionChainStream.js";
import { resubscribeOptionSymbols } from "./fyersSocket.js";
import { smartOrderQueueService } from "./smartOrderQueueService.js";
import { globalBus } from "./globalDataBus.js";
import { getVWAP } from "./candleAggregator.js";
import { getPositionTrades, openPositionTrade, updatePositionPrices, type PositionTradeSetup } from "./positionTradeEngine.js";
import { governorService } from "./governorService.js";

function estimateATR(page: string, spotPrice: number): number {
  const vix = marketState.niftyOptionChain.indiaVix || 15;
  const vixScale = vix / 15;
  if (page === "SENSEX") {
    return Math.max(25, Math.round(spotPrice * 0.0008 * vixScale));
  } else if (page === "BANKNIFTY") {
    return Math.max(15, Math.round(spotPrice * 0.0008 * vixScale));
  } else {
    return Math.max(6, Math.round(spotPrice * 0.00065 * vixScale));
  }
}

// ── NEW ENGINE IMPORTS ─────────────────────────────────────────────────────────
import { computeWeightedStockSignal, isWeightedSignalAligned } from "./weightedStockSignalEngine.js";
import type { WeightedSignal } from "./weightedStockSignalEngine.js";
import {
  emitTradeAlarm, buildEntryAlarm, buildExitAlarm, buildSLTrailAlarm
} from "./tradeAlarmEngine.js";
import {
  recordTradeResult, getConfidenceBonus, isPatternBlocked,
  getTimeSlot, getPcrBucket, getBreadthBucket, getVixBucket,
  getMomBucket, getRegimeBucket, getMicroScalpTuning, getTrueAITradeTuning,
  type TradePattern
} from "./selfLearningEngine.js";
import { dispatchStrategy } from "./strategyDispatcher.js";
import { detectMinorMomentumBurst, detectScoreTrend, type DispatcherInput } from "../../src/engine/strategyDispatcher.js";
import { calculateGlobalScore, DEFAULT_LAYER_WEIGHTS, type LayerWeights } from "../../src/engine/weightedScoringEngine.js";
import fs from "fs";
import path from "path";


// ── Trailing Stop Loss Configuration — INTRADAY ────────────────────────────────
const TRAIL_CONFIG = {
  NIFTY:  { trigger: 12, offset: 8 },     // Relaxed slightly to prevent premature shakeouts (was 8/5)
  BANKNIFTY: { trigger: 24, offset: 15 }, // Relaxed slightly (was 16/8)
  SENSEX: { trigger: 36, offset: 22 },   // Relaxed slightly (was 24/12)
} as const;

// ── IQ200+: Momentum tier thresholds for adaptive targets ─────────────────
// When momentum is STRONG, take bigger targets; when NORMAL/LOW, take quick profits
const MOMENTUM_TIERS = {
  STRONG: { minScore: 65, targetMulti: 1.6, slMulti: 1.2, holdMinutes: 15, label: "BIG" },
  NORMAL: { minScore: 40, targetMulti: 1.0, slMulti: 1.0, holdMinutes: 10, label: "NORMAL" },
  MICRO:  { minScore: 0,  targetMulti: 0.6, slMulti: 0.7, holdMinutes: 5,  label: "MICRO" },
} as const;

// ── Daily High/Low Weighted Stock Scores (For Reversal Trading) ───────────────
export const scoreDayHighs: Record<string, number> = { NIFTY: -999, BANKNIFTY: -999, SENSEX: -999 };
export const scoreDayLows: Record<string, number> = { NIFTY: 999, BANKNIFTY: 999, SENSEX: 999 };
let lastResetDate = "";

smartOrderQueueService.onExecuteOrder(async (order, params) => {
  if (params) {
    await triggerAutoTrade(
      params.page,
      params.spotPrice,
      params.strikes,
      params.antigravity,
      params.alignment,
      params.report,
      params.momentum,
      params.breakout,
      params.tradeType,
      params.io,
      true
    );
  }
});

function checkAndResetDailyScores() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (lastResetDate !== dateStr) {
    lastResetDate = dateStr;
    scoreDayHighs.NIFTY = -999;
    scoreDayHighs.BANKNIFTY = -999;
    scoreDayHighs.SENSEX = -999;
    scoreDayLows.NIFTY = 999;
    scoreDayLows.BANKNIFTY = 999;
    scoreDayLows.SENSEX = 999;
    console.log(`[AutoTrader-Srv] Daily score bounds reset for date: ${dateStr}`);
  }
}


// ── EXPIRY DAY SPECIAL CONFIG ──────────────────────────────────────────────
// Expiry day mein options ka theta decay bahut fast hota hai
// Isliye special rules:
//   1. Max 3 trades only (not 5) — less exposure
//   2. Tighter SL (50% of normal)
//   3. Smaller target (60% of normal) — quick profit book karo
//   4. Earlier time exit: 14:30 IST (not 15:25)
//   5. Prefer ITM/near-ATM strikes only
//   6. Higher gate threshold: 7/9 (not 6/9)
//   7. Only trade 9:20–9:45 window and 13:30–14:15 window
const EXPIRY_CONFIG = {
  maxTrades:           3,                // Max 3 trades on expiry day
  gateThreshold:       2,                // Relaxed: need only 2/9 gates
  timeExitMinutes:     15 * 60 + 10,     // 15:10 IST — allow ultra gamma trades to run till near close
  slMultiplier:        0.6,              // 40% tighter SL
  targetMultiplier:    0.7,              // 30% smaller target
  trailTriggerMulti:   0.6,             // Trail activates sooner on expiry
  confidenceThreshold: 65,              // Lowered to 65% confidence (normal is 55%)
  // Trading windows on expiry (most volatile & predictable)
  windows: [
    { start: 9 * 60 + 15, end: 10 * 60 + 15 },   // Morning flush (9:15-10:15)
    { start: 13 * 60 + 15, end: 15 * 60 + 15 },   // Afternoon gamma run (1:15-3:15) — includes Ultra Gamma Zone
  ],
  // Ultra Gamma Zone: 2:30 PM onwards — premiums can 50x in minutes
  // Use OTM strikes aggressively, minimal SL (₹2-5 max), let winners run
  ultraGammaStart: 14 * 60 + 30,  // 2:30 PM
};

/** Check if today is expiry day for given instrument */
function isExpiryDay(
  page: "NIFTY" | "BANKNIFTY" | "SENSEX"
): boolean {
  try {
    const chain = page === "NIFTY"
      ? marketState.niftyOptionChain
      : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain : marketState.sensexOptionChain);
    const expiry = chain.selectedExpiry;
    if (!expiry) return false;

    let expiryDate: Date | null = null;
    if (/^\d+$/.test(String(expiry))) {
      const ts = parseInt(String(expiry), 10);
      expiryDate = new Date(ts < 10000000000 ? ts * 1000 : ts);
    } else {
      expiryDate = new Date(String(expiry));
    }
    if (!expiryDate || isNaN(expiryDate.getTime())) return false;

    const now = new Date();
    return (
      expiryDate.getDate()     === now.getDate() &&
      expiryDate.getMonth()    === now.getMonth() &&
      expiryDate.getFullYear() === now.getFullYear()
    );
  } catch {
    return false;
  }
}

/** Check if current time is within an expiry trading window */
function isInExpiryWindow(totalMinutes: number): boolean {
  return EXPIRY_CONFIG.windows.some(
    w => totalMinutes >= w.start && totalMinutes <= w.end
  );
}

/** Log expiry day status once every 5 minutes to avoid spam */
const lastExpiryLog: Record<string, number> = {};

// ── Trailing Stop Loss Configuration — POSITION TRADE (Layer 12) ──────────────
// Position trades are held 2-5 days. Trail must be wide enough to survive intraday noise.
// beOffset: Points to lock in above entry when breakeven is triggered.
const POSITION_TRAIL_CONFIG = {
  NIFTY:     { trigger: 40, offset: 20, beOffset: 15 },
  BANKNIFTY: { trigger: 80, offset: 40, beOffset: 30 },
  SENSEX:    { trigger: 120, offset: 60, beOffset: 50 },
} as const;

/** Returns the correct trail config based on trade mode */
function getTrailConfig(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  isPositionTrade: boolean,
): { trigger: number; offset: number; beOffset?: number } {
  return isPositionTrade ? POSITION_TRAIL_CONFIG[instrument] : TRAIL_CONFIG[instrument];
}


// ── DYNAMIC Daily Trade Cap ────────────────────────────────────────────────────
// IQ200+: No hard ceiling — user configured limit from UI (default 999)
function getDynamicMaxTrades(page: string): number {
  const config = getAutoTradeConfig();
  return config.maxTradesLimit ?? 999; // Effectively unlimited
}

// ── Time Slot minimum trade expectations ──────────────────────────────────────
// IQ200+: Expect 2-3 trades per hour = 10-12 trades/day minimum
function getExpectedTradesByNow(h: number, m: number): number {
  const mins = h * 60 + m;
  if (mins < 10 * 60)        return 0;
  if (mins < 11 * 60)        return 2;  // 2 by 11am
  if (mins < 12 * 60)        return 4;  // 4 by noon
  if (mins < 13 * 60 + 30)   return 6;  // 6 by 1:30pm
  if (mins < 14 * 60 + 30)   return 8;  // 8 by 2:30pm
  return 10;  // 10 by closing
}

// ── IQ200+: Momentum-Adaptive Target and SL Calculator ──────────────────────
function getMomentumTier(momentumScore: number) {
  if (momentumScore >= MOMENTUM_TIERS.STRONG.minScore) return MOMENTUM_TIERS.STRONG;
  if (momentumScore >= MOMENTUM_TIERS.NORMAL.minScore) return MOMENTUM_TIERS.NORMAL;
  return MOMENTUM_TIERS.MICRO;
}

// Throttling map for cooldown log messages
const lastCooldownLog: Record<string, number> = {
  NIFTY: 0,
  BANKNIFTY: 0,
  SENSEX: 0
};

/**
 * Computes OI-based support/resistance walls from the option chain.
 * Call Wall (max call OI strike) = Resistance
 * Put Wall (max put OI strike) = Support
 */
function computeOIWalls(strikes: any[], spotPrice: number): { callWall: number; putWall: number } {
  if (!strikes || strikes.length === 0) {
    return { callWall: spotPrice + 200, putWall: spotPrice - 200 };
  }

  let maxCallOI = 0, callWall = spotPrice + 200;
  let maxPutOI = 0, putWall = spotPrice - 200;

  for (const s of strikes) {
    if ((s.ceOI ?? 0) > maxCallOI) {
      maxCallOI = s.ceOI;
      callWall = s.strikePrice;
    }
    if ((s.peOI ?? 0) > maxPutOI) {
      maxPutOI = s.peOI;
      putWall = s.strikePrice;
    }
  }

  return { callWall, putWall };
}

function getRealDelta(strikeRow: any, direction: "BUY_CE" | "BUY_PE"): number {
  if (!strikeRow) return 0.5;
  const raw = direction === "BUY_CE" ? strikeRow.ceDelta : strikeRow.peDelta;
  const delta = Math.abs(Number(raw) || 0);
  // Sanity: delta should be between 0.05 and 1.0 for valid options
  return delta >= 0.05 && delta <= 1.0 ? delta : 0.5;
}

/**
 * Calculates the 22-factor model bullish and bearish scores on the server side.
 */
function calculateScores(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  spotPrice: number,
  report: CompleteMarketReport,
  strikes: any[],
  stocks: any[]
): { bullishScore: number; bearishScore: number } {
  // Option dominance variables:
  const totalCallOI = strikes.reduce((acc, curr) => acc + (curr.ceOI || 0), 0);
  const totalPutOI = strikes.reduce((acc, curr) => acc + (curr.peOI || 0), 0);
  const totalCallVol = strikes.reduce((acc, curr) => acc + (curr.ceVolume || 0), 0);
  const totalPutVol = strikes.reduce((acc, curr) => acc + (curr.peVolume || 0), 0);
  const totalCallOIchg = strikes.reduce((acc, curr) => acc + (curr.ceOIChange || 0), 0);
  const totalPutOIchg = strikes.reduce((acc, curr) => acc + (curr.peOIChange || 0), 0);

  const optionChainStrength = totalPutOI + totalCallOI > 0 ? (totalPutOI - totalCallOI) / (totalPutOI + totalCallOI) : 0;
  const volumeDominance = totalCallVol + totalPutVol > 0 ? (totalCallVol - totalPutVol) / (totalCallVol + totalPutVol) : 0;
  const oiDominance = totalPutOI + totalCallOI > 0 ? (totalPutOI - totalCallOI) / (totalPutOI + totalCallOI) : 0;
  const oiChangeDominance = totalPutOIchg + totalCallOIchg > 0 ? (totalPutOIchg - totalCallOIchg) / (totalPutOIchg + totalCallOIchg) : 0;

  // Stocks setup
  const sortedByWeight = [...stocks].sort((a, b) => (b.weightage || 0) - (a.weightage || 0));
  const top10 = sortedByWeight.slice(0, 10);
  const nextSliceEnd = page === "SENSEX" ? 22 : 25;
  const next15 = sortedByWeight.slice(10, nextSliceEnd);
  
  const t10Sum = top10.reduce((acc, s) => acc + (s.score || 0), 0);
  const t15Sum = next15.reduce((acc, s) => acc + (s.score || 0), 0);
  const overallScore = stocks.reduce((acc, s) => acc + (s.score || 0), 0);
  const score5mNet = stocks.reduce((acc, s) => acc + (s.scoreDifference || 0), 0);
  const score15mNet = stocks.reduce((acc, s) => acc + (s.score15mDiff || 0), 0);
  
  const advances = stocks.filter(s => (s.changePercent || 0) > 0).length;
  const declines = stocks.filter(s => (s.changePercent || 0) < 0).length;
  
  const positiveStocks = stocks.filter(s => (s.score || 0) > 0).length;
  const negativeStocks = stocks.filter(s => (s.score || 0) < 0).length;
  
  const history = page === "NIFTY"
    ? marketState.niftyHistory
    : (page === "BANKNIFTY" ? marketState.bankniftyHistory : marketState.sensexHistory);
  
  const support = report.oi.supportWall || (history ? history.low : 0);
  const resistance = report.oi.resistanceWall || (history ? history.high : 0);
  
  const heavyStockList = stocks.filter(s =>
    (s.weightage || 0) > 3 || ["HDFCBANK", "ICICIBANK", "RELIANCE"].includes(s.symbol.toUpperCase())
  );
  
  const hdfc = stocks.find(s => s.symbol.toUpperCase() === "HDFCBANK")?.changePercent || 0;
  const icici = stocks.find(s => s.symbol.toUpperCase() === "ICICIBANK")?.changePercent || 0;
  const reliance = stocks.find(s => s.symbol.toUpperCase() === "RELIANCE")?.changePercent || 0;

  const pcr = report.oi.pcr ?? 1.0;
  const sentiment = pcr > 1.25 ? "Strongly Bullish" : pcr > 1.0 ? "Bullish" : pcr > 0.85 ? "Neutral" : pcr > 0.6 ? "Bearish" : "Strongly Bearish";

  // Calculate bullish
  let bullScore = 0;
  const hasHeavyweightAbove3 = heavyStockList.some(s => (s.changePercent || 0) > 3);
  if (report.trend.overall === "BULLISH") bullScore += 10;
  if (score5mNet > 0) bullScore += 5;
  if (score15mNet > 0) bullScore += 5;
  if (t10Sum > 0) bullScore += 10;
  if (t15Sum > 0) bullScore += 10;
  if (overallScore > 50) bullScore += 10;
  else if (overallScore > 0) bullScore += 5;
  if (pcr > 1.2) bullScore += 10;
  else if (pcr >= 1.0) bullScore += 5;
  if (sentiment.toLowerCase().includes("strongly bullish")) bullScore += 10;
  else if (sentiment.toLowerCase().includes("bullish")) bullScore += 7;
  else if (sentiment.toLowerCase().includes("neutral")) bullScore += 3;
  if (support > 0 && spotPrice >= support && spotPrice <= support * 1.01) bullScore += 5;
  else if (support > 0 && spotPrice > support) bullScore += 3;
  if (resistance > 0 && spotPrice > resistance) bullScore += 5;
  if (advances > declines) bullScore += 5;
  if (positiveStocks > negativeStocks) bullScore += 5;
  if (hasHeavyweightAbove3) bullScore += 5;
  if (hdfc > 0.5) bullScore += 5;
  else if (hdfc > 0) bullScore += 2;
  if (icici > 0.5) bullScore += 5;
  else if (icici > 0) bullScore += 2;
  if (reliance > 0.5) bullScore += 5;
  else if (reliance > 0) bullScore += 2;
  if (optionChainStrength > 0.1) bullScore += 10;
  else if (optionChainStrength > 0) bullScore += 5;
  if (volumeDominance > 0.1) bullScore += 5;
  if (oiDominance > 0.1) bullScore += 5;
  if (oiChangeDominance > 0.1) bullScore += 10;
  else if (oiChangeDominance > 0) bullScore += 5;

  // Calculate bearish
  let bearScore = 0;
  const hasHeavyweightBelowNeg3 = heavyStockList.some(s => (s.changePercent || 0) < -3);
  if (report.trend.overall === "BEARISH") bearScore += 10;
  if (score5mNet < 0) bearScore += 5;
  if (score15mNet < 0) bearScore += 5;
  if (t10Sum < 0) bearScore += 10;
  if (t15Sum < 0) bearScore += 10;
  if (overallScore < -50) bearScore += 10;
  else if (overallScore < 0) bearScore += 5;
  if (pcr < 0.8) bearScore += 10;
  else if (pcr <= 0.9) bearScore += 5;
  if (sentiment.toLowerCase().includes("strongly bearish")) bearScore += 10;
  else if (sentiment.toLowerCase().includes("bearish")) bearScore += 7;
  else if (sentiment.toLowerCase().includes("neutral")) bearScore += 3;
  if (support > 0 && spotPrice < support) bearScore += 5;
  if (resistance > 0 && spotPrice <= resistance && spotPrice >= resistance * 0.99) bearScore += 5;
  else if (resistance > 0 && spotPrice < resistance) bearScore += 3;
  if (declines > advances) bearScore += 5;
  if (negativeStocks > positiveStocks) bearScore += 5;
  if (hasHeavyweightBelowNeg3) bearScore += 5;
  if (hdfc < -0.5) bearScore += 5;
  else if (hdfc < 0) bearScore += 2;
  if (icici < -0.5) bearScore += 5;
  else if (icici < 0) bearScore += 2;
  if (reliance < -0.5) bearScore += 5;
  else if (reliance < 0) bearScore += 2;
  if (optionChainStrength < -0.1) bearScore += 10;
  else if (optionChainStrength < 0) bearScore += 5;
  if (volumeDominance < -0.1) bearScore += 5;
  if (oiDominance < -0.1) bearScore += 5;
  if (oiChangeDominance < -0.1) bearScore += 10;
  else if (oiChangeDominance > 0) bearScore += 5;

  const maxWeight = 145;
  return {
    bullishScore: Math.round((bullScore / maxWeight) * 100),
    bearishScore: Math.round((bearScore / maxWeight) * 100)
  };
}

/**
 * Handles server-side automated paper trading execution.
 * Evaluates active positions for SL/Target hits and executes new trade setups
 * based on Antigravity AI decisions.
 *
 * v2.0 — Dynamic Level-Based Targets + Trailing Stop Loss:
 *   - Target calculated from Spot S/R levels (OI walls) × Option Delta
 *   - Trailing SL: once premium rises by TRAIL_TRIGGER, SL moves to breakeven
 *     then trails behind the peak premium by TRAIL_OFFSET
 */
/**
 * Helper to determine trade signal category/type based on market setup.
 */
function determineSignalCategory(
  direction: "BUY_CE" | "BUY_PE",
  antigravity: AntigravityDecision,
  alignment: StrategyAlignment,
  report: CompleteMarketReport,
  momentum: MomentumStateResult,
  breakout: BreakoutState
): string {
  const isReversal = (momentum.direction === "UP" && direction === "BUY_PE") ||
                     (momentum.direction === "DOWN" && direction === "BUY_CE") ||
                     (report.trend.alignment.includes("REVERSAL"));
  if (isReversal) return "REVERSAL_TRADE";

  if (report.oi.sentiment && report.oi.sentiment !== "SIDEWAYS") {
    const isOiShift = Math.abs(report.oi.pcr - 1.0) > 0.15;
    if (isOiShift) return "OI_TRADE";
  }

  const isTrending = report.trend.alignment.includes("BUY") || report.trend.alignment.includes("SELL");
  if (isTrending) {
    return direction === "BUY_CE" ? "UPTREND_TRADE" : "DOWNTREND_TRADE";
  }

  if (momentum.momentumScore > 55 || momentum.momentumScore < 45) {
    return "MOMENTUM_TRADE";
  }

  return "MICRO_SCALP";
}

async function triggerAutoTrade(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  spotPrice: number,
  strikes: any[],
  antigravity: AntigravityDecision,
  alignment: StrategyAlignment,
  report: CompleteMarketReport,
  momentum: MomentumStateResult,
  breakout: BreakoutState,
  tradeType: "INTRADAY" | "POSITIONAL",
  io: SocketIOServer,
  isExecutingFromQueue = false,
  forcedStrategy?: { strategyName: string; targetPoints: number; stopLossPoints: number; direction: "BUY_CE" | "BUY_PE" },
  isShadow = false,
  aiEngineV2: any = null
): Promise<void> {
  // ── GOVERNOR: Kill Switch Check ───────────────────────────────────────
  if (governorService.isKillSwitchActive()) {
    const reason = governorService.getHaltReason();
    console.warn(`[AutoTrader-Srv] 🛑 GOVERNOR HALT [${page}]: ${reason}`);
    globalBus.addLog(`Governor blocked ${page} entry: ${reason}`, "warn");
    return;
  }
  // ───────────────────────────────────────────────────────────────
  const strikeGap = page === "SENSEX" ? 100 : 50;
  let strike = Math.round(spotPrice / strikeGap) * strikeGap;
  const lot_size = getLotSize(page);
  const expiryDayForTrade = isExpiryDay(page);

  // ── IQ 200 Probability-Based Strike Selection ──
  const isCEVal = forcedStrategy ? (forcedStrategy.direction === "BUY_CE") : (antigravity.finalSignal === "BUY_CE");
  const vixNow = marketState.niftyOptionChain.indiaVix || 15;
  
  if (tradeType === "INTRADAY") {
    if (expiryDayForTrade) {
      const { h: curH, m: curM } = getISTTime();
      const curTotalMin = curH * 60 + curM;
      
      if (curTotalMin >= EXPIRY_CONFIG.ultraGammaStart) {
        // ── ULTRA GAMMA ZONE (2:30 PM+) ──
        // ₹5 premiums can become ₹250 in minutes. Go 2 strikes OTM for max ROI.
        // Risk is tiny (₹5 premium × lots), reward is massive (50x potential).
        strike = isCEVal ? strike + strikeGap * 2 : strike - strikeGap * 2; // Deep OTM
        console.log(`[AutoTrader-Srv] ⚡ ULTRA GAMMA ZONE: ${page} selecting Deep OTM strike ${strike} for max ROI`);
      } else if (curTotalMin > 13 * 60) {
        // Afternoon Gamma (1:00-2:30): Slightly OTM if momentum is strong
        if (momentum.momentumScore > 65 && vixNow > 14) {
          strike = isCEVal ? strike + strikeGap : strike - strikeGap; // Slightly OTM
        }
      }
      // Morning flush (9:15-10:15): Keep ATM for safety
    } else {
      // Normal Day Intraday: If momentum is weak or bouncing from support, go ITM to avoid theta
      if (momentum.momentumScore < 45) {
        strike = isCEVal ? strike - strikeGap : strike + strikeGap; // ITM
      }
    }
  } else if (tradeType === "POSITIONAL") {
    // For positional, if VIX is high (expensive premiums), go slightly OTM. 
    // If VIX is low, buy deep ITM.
    if (vixNow > 18) {
      strike = isCEVal ? strike + strikeGap : strike - strikeGap; // OTM
    } else if (vixNow < 13) {
      strike = isCEVal ? strike - strikeGap*2 : strike + strikeGap*2; // Deep ITM
    }
  }


  // Expiry Selection
  const chainState = page === "NIFTY"
    ? marketState.niftyOptionChain
    : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain : marketState.sensexOptionChain);

  let targetExpiry = chainState.selectedExpiry;
  let contractSymbol = "";
  let entryPrice = 0;
  let delta = 0.5;
  let theta = 0;
  let gamma = 0;
  let vega = 0;
  let iv = 0;

  if (tradeType === "POSITIONAL") {
    // ── IQ 200 Intelligent Expiry Selector ──
    const expiriesToTest = [
      chainState.selectedExpiry,
      chainState.nextWeeklyExpiry,
      chainState.monthlyExpiry
    ].filter(Boolean); // Remove nulls

    const indexSymbol = page === "NIFTY" ? "NSE:NIFTY50-INDEX" : (page === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "BSE:SENSEX-INDEX");
    
    console.log(`[AutoTrader-Srv] Evaluating Expiries for POSITIONAL trade on ${page}: ${expiriesToTest.join(", ")}`);
    
    let bestItem: any = null;
    let bestExpiry = targetExpiry;
    let bestScore = -99999; // Higher is better (less negative theta, good liquidity)

    // Evaluate all available expiries
    for (const exp of expiriesToTest) {
      if (!exp) continue;
      const atmDetails = await fetchAtmStrikeForExpiry(indexSymbol, exp, strike);
      const item = atmDetails ? (isCEVal ? atmDetails.ce : atmDetails.pe) : null;
      
      if (item && item.ltp > 0) {
        const itemTheta = Number(item.theta) || -10; // Default penalize if missing
        const itemDelta = Math.abs(Number(item.delta) || 0.5);
        
        // IQ 200 Score: High Delta is good, High Theta decay (very negative) is bad.
        // We want maximum Delta for the least Theta burn.
        const score = itemDelta / Math.abs(itemTheta); 
        
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
          bestExpiry = exp;
        }
      }
    }

    if (bestItem) {
      targetExpiry = bestExpiry;
      contractSymbol = bestItem.symbol || "";
      entryPrice = bestItem.ltp ?? bestItem.bid ?? 0;
      delta = Math.abs(Number(bestItem.delta) || 0);
      theta = Number(bestItem.theta) || 0;
      gamma = Number(bestItem.gamma) || 0;
      vega = Number(bestItem.vega) || 0;
      iv = Number(bestItem.iv) || 0;
      console.log(`[AutoTrader-Srv] POSITIONAL Smart Expiry Selected: ${bestExpiry} (${contractSymbol}) @ ltp ${entryPrice} (Score: ${bestScore.toFixed(2)})`);
    }
  }
  // Fallback to current weekly strikes if POSITIONAL fetch failed or for INTRADAY
  if (!contractSymbol) {
    const strikeRow = strikes.find(s => s.strikePrice === strike);
    if (strikeRow) {
      contractSymbol = isCEVal ? strikeRow.ceSymbol : strikeRow.peSymbol;
      entryPrice = isCEVal
        ? (strikeRow.ceLtp ?? strikeRow.ceBid ?? 0)
        : (strikeRow.peLtp ?? strikeRow.peBid ?? 0);
      const rawDelta = isCEVal ? strikeRow.ceDelta : strikeRow.peDelta;
      delta = Math.abs(Number(rawDelta) || 0);
      theta = isCEVal ? (strikeRow.ceTheta ?? 0) : (strikeRow.peTheta ?? 0);
      gamma = isCEVal ? (strikeRow.ceGamma ?? 0) : (strikeRow.peGamma ?? 0);
      vega = isCEVal ? (strikeRow.ceVega ?? 0) : (strikeRow.peVega ?? 0);
      iv = isCEVal ? (strikeRow.ceIV ?? 0) : (strikeRow.peIV ?? 0);
    }
  }

  const parsedDelta = (delta >= 0.05 && delta <= 1.0) ? delta : 0.5;

  // ── STRICT LTP: No fake/proxy price ever ─────────────────────────────────
  // Try live tick cache first (most real-time price available)
  const strikeKey = strikes.find(s => s.strikePrice === strike);
  if (entryPrice <= 0 && strikeKey) {
    // Try live tick for this symbol
    const liveSymbol = isCEVal ? strikeKey.ceSymbol : strikeKey.peSymbol;
    const liveTk = liveSymbol ? liveOptionTicks.get(liveSymbol) : null;
    if (liveTk) {
      entryPrice = liveTk.ltp ?? liveTk.ask ?? liveTk.bid ?? 0;
    }
    // Try option chain ask price (market order — actual fill price)
    if (entryPrice <= 0) {
      entryPrice = isCEVal
        ? (strikeKey.ceAsk ?? strikeKey.ceLtp ?? 0)
        : (strikeKey.peAsk ?? strikeKey.peLtp ?? 0);
    }
  }

  // HARD ABORT: If still no real price, do NOT place trade with fake data
  if (entryPrice <= 0) {
    console.warn(`[STRICT-LTP] ⚠ No real LTP found for ${page} ${antigravity.finalSignal} Strike ${strike}. Trade ABORTED — never use proxy price.`);
    return;
  }

  // Dynamic Lot Size Calculation based on Segmented Capital
  const baseCapital = tradeType === "POSITIONAL" ? 50000 : 30000;
  
  const closedTrades = getPaperTrades("CLOSED").filter(t => {
    try {
      const notes = JSON.parse(t.notes || "{}");
      return t.instrument === page && notes.trade_type === tradeType;
    } catch { return false; }
  });
  
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const simulatedCapital = baseCapital + totalPnl;
  const baseQty = Math.max(1, Math.min(5, Math.floor(simulatedCapital / baseCapital)));

  // Compute the consensus to determine sizing multiplier
  const stocksForSizing = page === "NIFTY"
    ? Object.values(marketState.niftyStocks)
    : (page === "BANKNIFTY" ? Object.values(marketState.bankniftyStocks) : Object.values(marketState.sensexStocks));
  const spotChangePctForSizing = page === "NIFTY"
    ? marketState.niftyOptionChain.spotChangePct
    : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain.spotChangePct : marketState.sensexOptionChain.spotChangePct);
  const wSignalForSizing = computeWeightedStockSignal(stocksForSizing as any, spotChangePctForSizing || 0);

  const sizingConsensus = getGlobalAIBrainConsensus(
    page,
    antigravity,
    aiEngineV2,
    report,
    momentum.momentumScore,
    wSignalForSizing.netScore,
    forcedStrategy ? forcedStrategy.strategyName : "Micro Scalp"
  );

  let sizingMultiplier = 1.0;
  if (isShadow) {
    sizingMultiplier = 1.0; // Shadow trades always use base size
  } else {
    if (sizingConsensus.confidence >= 85) {
      sizingMultiplier = 2.0; // High confidence: scale up lot size
    } else if (sizingConsensus.confidence < 65) {
      sizingMultiplier = 0.5; // Newly promoted / lower confidence: cautious small lot size
    }
  }

  // Delta-Normalized Sizing: Keep Delta-weighted exposure constant. Capped at 10 lots max after scaling.
  const qty = Math.max(1, Math.min(10, Math.round(baseQty * (0.5 / parsedDelta) * sizingMultiplier)));

  // ── Remaining Capital Check ──
  const openTrades = getPaperTrades("OPEN").filter(t => {
    try {
      const notes = JSON.parse(t.notes || "{}");
      return t.instrument === page && notes.trade_type === tradeType;
    } catch { return false; }
  });
  const usedMargin = openTrades.reduce((sum, pos) => sum + (pos.entry_price * pos.qty * pos.lot_size), 0);
  const totalClosedPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const remainingCapital = baseCapital + totalClosedPnL - usedMargin;

  const requiredMargin = entryPrice * qty * lot_size;
  if (requiredMargin > remainingCapital) {
    const logMsg = `Insufficient simulated capital for ${page} ${antigravity.finalSignal}. Required: ₹${requiredMargin.toFixed(1)}, Remaining: ₹${remainingCapital.toFixed(1)}. Trade ABORTED.`;
    console.warn(`[AutoTrader-Srv] ⚠ ${logMsg}`);
    globalBus.addLog(logMsg, "warn");
    return;
  }

  // Only consider a strategy "active" (and block it) if it's open on the exact same index AND strike price
  const activeStrategyIds = openTrades.filter(t => t.instrument === page && t.strike === strike).map(p => {
    try { 
      const notesObj = JSON.parse(p.notes || "{}");
      return notesObj.strategyDispatch?.strategyId || notesObj.strategyId;
    }
    catch { return null; }
  }).filter(Boolean) as string[];

  const dispatched = dispatchStrategy(page, antigravity, alignment, report, momentum, breakout, expiryDayForTrade, activeStrategyIds);
  let signalCategory = dispatched.strategyName;
  let scalpType = dispatched.scalpType;
  
  const currentStrategyId = forcedStrategy ? "BERSERKER" : dispatched.strategyId;
  if (activeStrategyIds.includes(currentStrategyId)) {
    const logMsg = `⚠ Strategy '${currentStrategyId}' (${signalCategory}) already has an open trade on ${page} Strike ${strike}. Skipping duplicate entry.`;
    console.warn(`[AutoTrader-Srv] ${logMsg}`);
    globalBus.addLog(logMsg, "warn");
    return;
  }

  const { callWall, putWall } = computeOIWalls(strikes, spotPrice);
  let spotDistanceToSR = isCEVal ? Math.max(0, callWall - spotPrice) : Math.max(0, spotPrice - putWall);

  // Volatility-Adaptive Target & SL (Dynamic VIX padding)
  const vix = marketState.niftyOptionChain.indiaVix || 15;
  let vixMultiplier = 1.0;
  if (vix > 18) vixMultiplier = 1.2;
  else if (vix < 12) vixMultiplier = 0.8;

  let deltaScaledTarget = spotDistanceToSR * parsedDelta;

  // Use scalp-type recommended target as the primary guide
  // Scalp target is in option premium points (already delta-adjusted by dispatcher)
  const scalpRecommendedTarget = dispatched.targetPoints ?? 15;
  let minTarget = scalpRecommendedTarget;
  let maxTarget = scalpRecommendedTarget * 2.5;
  
  let aiTuningNote = "";
  let aiTuningTargetMult = 1.0;
  let aiTuningSlMult = 1.0;
  
  if (sizingConsensus.patternKey) {
    const aiTuning = getTrueAITradeTuning(sizingConsensus.patternKey);
    aiTuningTargetMult = aiTuning.targetMult;
    aiTuningSlMult = aiTuning.slMult;
    if (aiTuning.reason !== "DB Offline") {
      aiTuningNote = ` | ${aiTuning.reason}`;
    }
  } else if (scalpType) {
    const aiTuning = getMicroScalpTuning(scalpType);
    aiTuningTargetMult = aiTuning.targetMult;
    aiTuningSlMult = aiTuning.slMult;
    if (aiTuning.targetMult > 1.0) {
      aiTuningNote = ` | ⚡ AI Tuned: ${aiTuning.targetMult}x Target (High WinRate)`;
    } else if (aiTuning.targetMult < 1.0) {
      aiTuningNote = ` | ⚡ AI Tuned: ${aiTuning.targetMult}x Target (Low WinRate)`;
    }
  }

  minTarget *= aiTuningTargetMult;
  maxTarget *= aiTuningTargetMult;

  if (page === "SENSEX") {
    minTarget *= 3.5;
    maxTarget *= 5.0; // Maintain proportion from earlier
  } else if (page === "BANKNIFTY") {
    minTarget *= 2.5;
    maxTarget *= 4.0;
  }
  
  let targetPoints = Math.max(minTarget, Math.min(maxTarget, deltaScaledTarget > 0 ? deltaScaledTarget * aiTuningTargetMult : scalpRecommendedTarget * aiTuningTargetMult)) * vixMultiplier;

  // Support/Resistance from breakout channel
  const { low5m, high5m, low15m, high15m } = breakout;
  const supportPrice = (low5m > 0 && low15m > 0)
    ? Math.min(low5m, low15m)
    : (low15m > 0 ? low15m : (low5m > 0 ? low5m : spotPrice * 0.998));

  const resistancePrice = (high5m > 0 && high15m > 0)
    ? Math.max(high5m, high15m)
    : (high15m > 0 ? high15m : (high5m > 0 ? high5m : spotPrice * 1.002));

  const indexDistance = isCEVal ? Math.max(0, spotPrice - supportPrice) : Math.max(0, resistancePrice - spotPrice);
  let premiumSL = indexDistance * parsedDelta * vixMultiplier;

  // Clamping limits based on page index & trade type
  let minSL = 10, maxSL = 25;
  if (tradeType === "POSITIONAL") {
    // Expand SL and Target for positional trades
    premiumSL = premiumSL * 1.5;
    targetPoints = targetPoints * 1.5;
    if (page === "SENSEX") {
      minSL = 25; maxSL = 65;
    } else if (page === "BANKNIFTY") {
      minSL = 20; maxSL = 45;
    } else {
      minSL = 10; maxSL = 30;
    }
  } else {
    // Intraday clamping limits
    if (page === "SENSEX") {
      minSL = 15; maxSL = 45;
    } else if (page === "BANKNIFTY") {
      minSL = 10; maxSL = 25;
    } else {
      minSL = 6; maxSL = 18;
    }
    
    // Apply AI Tuning for Intraday Scalp SL
    if (scalpType) {
      minSL *= aiTuningSlMult;
      maxSL *= aiTuningSlMult;
      premiumSL *= aiTuningSlMult;
    }
  }

  const dynamicSLPoints = Math.max(minSL, Math.min(maxSL, premiumSL));
  
  // AI Self Mind: Enforce Minimum 1:1.5 Risk-Reward Ratio
  if (targetPoints < dynamicSLPoints * 1.5) {
    targetPoints = parseFloat((dynamicSLPoints * 1.5).toFixed(1));
  }
  
  const stopLoss = entryPrice - dynamicSLPoints;
  const target = entryPrice + targetPoints;

  // ── Expiry Day: tighter SL + smaller target ──────────────────────────────
  let finalDynamicSL = expiryDayForTrade
    ? Math.max(minSL * 0.5, dynamicSLPoints * EXPIRY_CONFIG.slMultiplier)
    : dynamicSLPoints;
  let finalTarget = expiryDayForTrade
    ? entryPrice + targetPoints * EXPIRY_CONFIG.targetMultiplier
    : target;

  // ATR & VIX Adaptive Target/SL Scaling (10x Phase 2)
  let adaptiveVixScaler = 1.0;
  if (vix > 18) {
    adaptiveVixScaler = 1.3;
  } else if (vix < 12) {
    adaptiveVixScaler = 0.8;
  }

  finalDynamicSL *= adaptiveVixScaler;
  let targetDelta = finalTarget - entryPrice;
  targetDelta *= adaptiveVixScaler;
  finalTarget = entryPrice + targetDelta;

  let finalStopLoss = entryPrice - finalDynamicSL;

  let targetReason = `${expiryDayForTrade ? "⚡EXPIRY " : ""}S/R Target: Spot ${spotPrice.toFixed(0)} → ${isCEVal ? "Res" : "Sup"} ${isCEVal ? callWall : putWall} (${spotDistanceToSR.toFixed(0)} pts) × Δ${parsedDelta.toFixed(2)} = ${deltaScaledTarget.toFixed(1)} → clamped ${targetPoints.toFixed(1)} pts${expiryDayForTrade ? ` × ${EXPIRY_CONFIG.targetMultiplier} (EXPIRY)` : ""} (VIX x${vixMultiplier.toFixed(1)}, Type: ${tradeType}, VIX-Scaler x${adaptiveVixScaler})${aiTuningNote}`;

  if (forcedStrategy) {
    signalCategory = forcedStrategy.strategyName;
    scalpType = "MICRO";
    const forcedTgt = forcedStrategy.targetPoints;
    const forcedSL = forcedStrategy.stopLossPoints;
    finalTarget = entryPrice + forcedTgt;
    finalStopLoss = entryPrice - forcedSL;
    finalDynamicSL = forcedSL;
    targetReason = `⚡BERSERKER OVERRIDE | Target: +₹${forcedTgt} pts, SL: -₹${forcedSL} pts`;
  }

  const stocks = page === "NIFTY"
    ? Object.values(marketState.niftyStocks)
    : (page === "BANKNIFTY" ? Object.values(marketState.bankniftyStocks) : Object.values(marketState.sensexStocks));
  
  const { bullishScore, bearishScore } = calculateScores(page, spotPrice, report, strikes, stocks);
  const advances = stocks.filter(s => (s.changePercent || 0) > 0).length;
  const declines = stocks.filter(s => (s.changePercent || 0) < 0).length;

  // ── Compute weighted stock signal for trade notes ─────────────────────────
  const stocksAtEntry = page === "NIFTY"
    ? Object.values(marketState.niftyStocks)
    : (page === "BANKNIFTY" ? Object.values(marketState.bankniftyStocks) : Object.values(marketState.sensexStocks));
  const spotChgPctAtEntry = page === "NIFTY"
    ? marketState.niftyOptionChain.spotChangePct
    : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain.spotChangePct : marketState.sensexOptionChain.spotChangePct);
  const wSignal = computeWeightedStockSignal(stocksAtEntry as any, spotChgPctAtEntry || 0);

  // ── Build top stock movers string ─────────────────────────────────────────
  const topMoversStr = wSignal.allTopStocks.slice(0, 4).map(s =>
    `${s.symbol} ${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(1)}%(${s.contribution >= 0 ? "+" : ""}${s.contribution.toFixed(1)})`
  ).join(", ");

  // ── ORB status for trade notes ────────────────────────────────────────────
  const orbStatus = breakout.breakoutType === "BULLISH_BREAKOUT"
    ? `Above ORB high ${(Math.max(breakout.high5m, breakout.high15m)).toFixed(0)}`
    : breakout.breakoutType === "BEARISH_BREAKDOWN"
    ? `Below ORB low ${(Math.min(breakout.low5m, breakout.low15m)).toFixed(0)}`
    : `ORB range ${breakout.low15m.toFixed(0)}–${breakout.high15m.toFixed(0)}`;

  const trade = {
    id: `amex-srv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: Date.now(),
    instrument: page,
    direction: forcedStrategy ? forcedStrategy.direction : (antigravity.finalSignal as "BUY_CE" | "BUY_PE"),
    strike,
    entry_price: parseFloat(entryPrice.toFixed(1)),
    qty,
    lot_size,
    stop_loss: parseFloat(finalStopLoss.toFixed(1)),
    target: parseFloat(finalTarget.toFixed(1)),
    status: "OPEN" as const,
    pnl: 0,
    strategyName: signalCategory,
    confidence: forcedStrategy ? 99 : antigravity.confidence,
    notes: JSON.stringify({
      type: "AUTO",
      trade_type: tradeType,
      symbol: contractSymbol,
      strategyName: signalCategory,
      scalpType,
      patternKey: sizingConsensus.patternKey,
      maxHoldMinutes: forcedStrategy ? 15 : dispatched.maxHoldMinutes,
      reason: forcedStrategy
        ? `[${signalCategory}][${scalpType}] [Server Auto Berserker] ${forcedStrategy.direction} | ${targetReason}`
        : `[${signalCategory}][${scalpType}] [Server Auto ${tradeType}${expiryDayForTrade ? " EXPIRY" : ""}] ${antigravity.finalSignal} | Conf: ${antigravity.confidence}% | Align: [${alignment.strategiesAgreeing.map(s => s.replace(/_/g, " ")).join(", ")}] | ${targetReason}`,
      strictLtpUsed: true,
      strategyDispatch: {
        isUserDefined: forcedStrategy ? false : dispatched.isUserDefined,
        matchScore: forcedStrategy ? 100 : dispatched.matchScore,
        matchReasons: forcedStrategy ? ["Berserker Overrides"] : dispatched.matchReasons,
        strategyId: forcedStrategy ? "BERSERKER" : dispatched.strategyId,
      },
      isExpiryDay: expiryDayForTrade,

      // ── WHY THIS TRADE WAS TAKEN (full explanation for alarm) ──────────
      whyTaken: {
        weightedStockScore:  parseFloat(wSignal.netScore.toFixed(2)),
        weightedDirection:   wSignal.direction,
        keyStockMovers:      topMoversStr,
        specialTrioStatus:   wSignal.specialTrioDetail,
        bankingSectorScore:  parseFloat(wSignal.bankingSectorScore.toFixed(2)),
        regimeLabel:         report.trend.overall || "SIDEWAYS",
        breadthScore:        Math.round(report.trend.strengthPct || 50),
        pcr:                 parseFloat((report.oi.pcr || 1.0).toFixed(2)),
        momentumScore:       Math.round(momentum.momentumScore || 50),
        smartMoneyBias:      alignment.strategiesAgreeing.includes("SMART_MONEY_FOLLOW")
                              ? (antigravity.finalSignal === "BUY_CE" ? "ACCUMULATION" : "DISTRIBUTION")
                              : "NEUTRAL",
        gatesPassed:         forcedStrategy ? 9 : 6,
        totalGates:          9,
        layerConsensus:      forcedStrategy ? "Berserker" : `CE: ${alignment.strategiesAgreeing.filter(s => !s.includes("BEAR")).length} | PE: ${alignment.strategiesAgreeing.filter(s => s.includes("BEAR") || s.includes("SHORT")).length}`,
        orbStatus,
        signalGrade:         forcedStrategy ? "A+" : antigravity.signalGrade,
        antigravityScore:    forcedStrategy ? 99 : parseFloat(antigravity.antigravityScore.toFixed(1)),
        vix:                 parseFloat(vix.toFixed(1)),
        vixCategory:         forcedStrategy ? "NORMAL" : (antigravity.vixCategory || "NORMAL"),
        strategyReason:      forcedStrategy ? "Berserker Fallback Loop" : (antigravity.reasoning || ""),
        scalpType,
        scalpTarget:         forcedStrategy ? forcedStrategy.targetPoints : dispatched.targetPoints,
        // NEW: Deep stock buyer/seller activity
        activeBuyers:        wSignal.buyerSellerActivity.activeBuyers,
        activeSellers:       wSignal.buyerSellerActivity.activeSellers,
        netPressure:         wSignal.buyerSellerActivity.netPressure,
        entryStrength:       wSignal.buyerSellerActivity.entryStrength,
        hwBuyers:            wSignal.buyerSellerActivity.heavyweightBuyers.join(", "),
        hwSellers:           wSignal.buyerSellerActivity.heavyweightSellers.join(", "),
        buyingPressurePct:   parseFloat(wSignal.buyerSellerActivity.buyingPressurePct.toFixed(1)),
        sellingPressurePct:  parseFloat(wSignal.buyerSellerActivity.sellingPressurePct.toFixed(1)),
        scoreVelocity:       wSignal.buyerSellerActivity.scoreVelocity,
        scoreReversal:       isCEVal 
                             ? (scoreDayLows[page] < -10 && (wSignal.netScore - scoreDayLows[page] >= 7) ? `BULLISH_REVERSAL (DL: ${scoreDayLows[page]} -> Current: ${wSignal.netScore.toFixed(1)})` : "NONE")
                             : (scoreDayHighs[page] > 10 && (scoreDayHighs[page] - wSignal.netScore >= 7) ? `BEARISH_REVERSAL (DH: ${scoreDayHighs[page]} -> Current: ${wSignal.netScore.toFixed(1)})` : "NONE"),
      },
      metrics: {
        regime: antigravity.marketRegime || "UNKNOWN",
        breadth: report.trend.alignment === "HIGH_CONFIDENCE_BUY" || report.trend.alignment === "HIGH_CONFIDENCE_SELL" ? 75 : 50,
        momentum: momentum.momentumScore ?? 50,
        pcr: report.oi.pcr ?? 1.0,
        probability: Math.round(antigravity.antigravityScore) ?? 50,
        confidence: antigravity.confidence,
        alignment: alignment.strategiesAgreeing,
        spotPrice: spotPrice,
        volatility: parseFloat(vix.toFixed(1)),
        bullishScore,
        bearishScore,
        spot: spotPrice,
        putWall: putWall,
        callWall: callWall,
        low5m: low5m,
        high5m: high5m,
        low15m: low15m,
        high15m: high15m,
        delta: parsedDelta,
        gamma: gamma,
        theta: theta,
        vega: vega,
        iv: iv,
        velocity: report.speed.velocity ?? 0,
        priceActionGrade: report.speed.priceActionGrade ?? "WEAK",
        marketState: report.speed.marketState ?? "SLOW_MARKET",
        netCeBuildup: report.oi.netCeBuildup ?? "NONE",
        netPeBuildup: report.oi.netPeBuildup ?? "NONE",
        advances,
        declines,
        // Weighted stock signal in metrics
        weightedStockScore: parseFloat(wSignal.netScore.toFixed(2)),
        weightedDirection:  wSignal.direction,
        specialTrioScore:   parseFloat(wSignal.specialTrioScore.toFixed(2)),
        bankingScore:       parseFloat(wSignal.bankingSectorScore.toFixed(2)),
        divergence:         wSignal.divergenceDetected,
      }
    }),
  };

  // smartOrderQueueService bypassed per user request to execute trades instantly at current LTP and prevent duplicate entries.
  // The system now executes directly at market premium.

  try {
    if (isShadow) {
      try {
        const parsedNotes = JSON.parse(trade.notes || "{}");
        parsedNotes.is_shadow = true;
        trade.notes = JSON.stringify(parsedNotes);
      } catch {}
      saveShadowTrade(trade);
      const logMsg = `[SHADOW] Placed ${tradeType} auto-trade on ${page}: ${trade.direction} at premium ${trade.entry_price} (Symbol: ${contractSymbol}) | Target: ${trade.target}`;
      console.log(`[AutoTrader-Srv] ${logMsg}`);
      globalBus.addLog(logMsg, "info");
      
      // Dynamic re-subscription to socket for this trade contract symbol
      resubscribeOptionSymbols();
      return;
    }

    if (tradeType === "POSITIONAL" && !isShadow) {
      const setup: PositionTradeSetup = {
        instrument:   page,
        direction:    trade.direction === "BUY_CE" ? "BUY_CE" : "BUY_PE",
        strike:       trade.strike,
        expiry:       targetExpiry,
        optionSymbol: contractSymbol,
        entryPrice:   trade.entry_price,
        lots:         qty,
        lotSize:      lot_size,
        slPrice:      finalStopLoss,
        target1:      parseFloat((trade.entry_price + (finalTarget - trade.entry_price) * 0.7).toFixed(1)),
        target2:      finalTarget,
        dailyTheta:   theta,
        breakevenDays: 2,
        vixAtEntry:   vix,
        dailyBiasAtEntry: alignment.tradeDirection !== "NONE" ? alignment.tradeDirection : "NEUTRAL",
        reasoning:    targetReason,
        riskReward:   2.0,
      };
      openPositionTrade(setup);
      
      const logMsg = `Placed REAL ${tradeType} auto-trade on ${page}: ${trade.direction} at premium ${trade.entry_price} (Symbol: ${contractSymbol}) | Target: ${trade.target}`;
      console.log(`[AutoTrader-Srv] ${logMsg}`);
      globalBus.addLog(logMsg, "info");
      
      // Emit entry alarm & Toast
      try {
        const entryAlarm = buildEntryAlarm({
          tradeId:      `PT_${Date.now()}`,
          instrument:   page,
          direction:    trade.direction as "BUY_CE" | "BUY_PE",
          strike:       trade.strike,
          optionSymbol: contractSymbol,
          entry:        trade.entry_price,
          sl:           finalStopLoss,
          tp:           finalTarget,
          lots:         qty,
          lotSize:      lot_size,
          confidence:   antigravity.confidence || 75,
          grade:        antigravity.confidence >= 80 ? "A" : "B",
          strategyName: tradeType === "POSITIONAL" ? `${targetReason}_SWING` : targetReason,
          whyTaken:     {
            weightedStockScore: 0,
            weightedDirection: "",
            keyStockMovers: "",
            specialTrioStatus: "",
            bankingSectorScore: 0,
            regimeLabel: "",
            breadthScore: 0,
            pcr: 0,
            momentumScore: 0,
            smartMoneyBias: "",
            gatesPassed: 0,
            totalGates: 9,
            layerConsensus: "",
            orbStatus: "",
            signalGrade: "",
            antigravityScore: 0,
            vix: vix,
            vixCategory: "",
            strategyReason: targetReason,
          },
          tradesToday:  0, // Handled automatically by client updates
          dailyPnl:     0,
          dailyTarget:  3000,
        });
        emitTradeAlarm(io, entryAlarm);
      } catch (err: any) {
        console.error("[AutoTrader-Srv] Positional alarm error:", err.message);
      }
      
      io.emit("toast-trigger", {
        type: "success",
        title: "Promoted Swing Trade Triggered",
        message: `${page} ${trade.direction} swing position opened at ₹${entryPrice}`
      });
      
      resubscribeOptionSymbols();
      return;
    }

    savePaperTrade(trade);
    const logMsg = `Placed ${tradeType} auto-trade on ${page}: ${trade.direction} at premium ${trade.entry_price} (Symbol: ${contractSymbol}) | Target: ${trade.target}`;
    console.log(`[AutoTrader-Srv] ${logMsg}`);
    globalBus.addLog(logMsg, "info");
    
    // Dynamic re-subscription to socket for this trade contract symbol
    resubscribeOptionSymbols();

    // ── Compute daily P&L for alarm ───────────────────────────────────────
    const closedToday = (() => {
      const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      return getPaperTrades("CLOSED").filter(t => {
        try {
          const parsed = JSON.parse(t.notes || "{}");
          return t.instrument === page &&
            parsed.trade_type !== "POSITIONAL" &&
            t.closed_at && new Date(t.closed_at + 5.5 * 3600 * 1000).toISOString().slice(0, 10) === todayIST;
        } catch { return false; }
      });
    })();
    const dailyPnl = closedToday.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const tradesToday = closedToday.length + 1; // +1 for the trade just placed

    // ── Parse whyTaken from notes for alarm ───────────────────────────────
    let parsedNotes: any = {};
    try { parsedNotes = JSON.parse(trade.notes || "{}"); } catch {}
    const metrics = parsedNotes?.metrics || {};
    const whyTaken = parsedNotes?.whyTaken || {};

    // ── Emit ENTRY alarm to all clients ──────────────────────────────────
    const entryAlarm = buildEntryAlarm({
      tradeId:       trade.id,
      instrument:    page,
      direction:     trade.direction,
      strike:        trade.strike,
      optionSymbol:  contractSymbol,
      entry:         trade.entry_price,
      sl:            trade.stop_loss,
      tp:            trade.target,
      lots:          trade.qty,
      lotSize:       trade.lot_size,
      confidence:    antigravity.confidence,
      grade:         antigravity.signalGrade,
      strategyName:  trade.strategyName || signalCategory,
      whyTaken: {
        weightedStockScore:  whyTaken.weightedStockScore  ?? 0,
        weightedDirection:   whyTaken.weightedDirection   ?? "NEUTRAL",
        keyStockMovers:      whyTaken.keyStockMovers      ?? "",
        specialTrioStatus:   whyTaken.specialTrioStatus   ?? "",
        bankingSectorScore:  whyTaken.bankingSectorScore  ?? 0,
        regimeLabel:         whyTaken.regimeLabel         ?? metrics.regime ?? "",
        breadthScore:        whyTaken.breadthScore        ?? 50,
        pcr:                 metrics.pcr ?? 1.0,
        momentumScore:       metrics.momentum ?? 50,
        smartMoneyBias:      whyTaken.smartMoneyBias      ?? "",
        gatesPassed:         whyTaken.gatesPassed         ?? 0,
        totalGates:          9,
        layerConsensus:      whyTaken.layerConsensus      ?? "",
        orbStatus:           whyTaken.orbStatus           ?? "",
        signalGrade:         antigravity.signalGrade,
        antigravityScore:    antigravity.antigravityScore,
        vix:                 metrics.volatility ?? 0,
        vixCategory:         antigravity.vixCategory ?? "NORMAL",
        strategyReason:      antigravity.reasoning ?? "",
      },
      tradesToday,
      dailyPnl,
      dailyTarget: 3000,
    });
    emitTradeAlarm(io, entryAlarm);

    // Notify clients (existing toasts)
    io.emit("paper-trade-opened", trade);
    io.emit("toast-trigger", {
      type: "success",
      title: `${tradeType} Auto Trade Placed`,
      message: `${page} ${trade.direction} @ ₹${trade.entry_price.toFixed(1)} | Target: ₹${trade.target.toFixed(1)}`
    });
  } catch (dbErr: any) {
    console.error("[AutoTrader-Srv] Failed to insert paper trade:", dbErr.message);
  }
}

export async function runServerSideAutoTrading(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  spotPrice: number,
  antigravity: AntigravityDecision,
  alignment: StrategyAlignment,
  report: CompleteMarketReport,
  momentum: MomentumStateResult,
  breakout: BreakoutState,
  io: SocketIOServer,
  aiEngineV2: any = null
): Promise<void> {
  // ── 1. Fetch current open positions for this instrument ──
  const openPositions = getPaperTrades("OPEN").filter(t => {
    if (t.instrument !== page) return false;
    try {
      const notes = JSON.parse(t.notes || "{}");
      return notes.type !== "ORB_NAKED";
    } catch {
      return true;
    }
  });

  const openShadowPositions = getShadowTrades("OPEN").filter(t => {
    if (t.instrument !== page) return false;
    try {
      const notes = JSON.parse(t.notes || "{}");
      return notes.type !== "ORB_NAKED";
    } catch {
      return true;
    }
  });

  const allOpenPositions = [
    ...openPositions.map(p => ({ ...p, isShadow: false })),
    ...openShadowPositions.map(p => ({ ...p, isShadow: true }))
  ];

  const config = getAutoTradeConfig();
  if (!config.isActive && allOpenPositions.length === 0) {
    return;
  }

  const strikes = page === "NIFTY"
    ? marketState.niftyOptionChain.strikes
    : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain.strikes : marketState.sensexOptionChain.strikes);
  const { h, m } = getISTTime();
  const totalMinutes = h * 60 + m;

  // ── 5-Minute Score Momentum Tracker ──
  const dispatcherInput = globalBus.toDispatcherInput(page, strikes) as DispatcherInput;
  const weights = (globalBus.getCurrentWeights() && Object.keys(globalBus.getCurrentWeights()).length > 0)
    ? (globalBus.getCurrentWeights() as unknown as LayerWeights)
    : DEFAULT_LAYER_WEIGHTS;
  const globalScore = calculateGlobalScore(dispatcherInput, weights);
  const history = updateScoreMomentumHistory(page, globalScore);
  io.emit("score-momentum-update", { page, history });
  // ── Expiry Day Detection ──────────────────────────────────────────────────
  const expiryDay = isExpiryDay(page);
  const expiryTimeExit = expiryDay ? EXPIRY_CONFIG.timeExitMinutes : (15 * 60 + 25);
  const isTimeExit = !marketState.isSimulating && (totalMinutes >= expiryTimeExit);

  // Log expiry mode once every 5 minutes
  if (expiryDay) {
    const now0 = Date.now();
    if (now0 - (lastExpiryLog[page] || 0) > 5 * 60 * 1000) {
      console.log(`[AutoTrader-Srv] 🎯 EXPIRY DAY MODE: ${page} | Time exit: 14:30 | Max trades: 3 | Stricter gates (7/9) | Tighter SL/TP`);
      lastExpiryLog[page] = now0;
    }
  }

  const trailCfg = TRAIL_CONFIG[page];


  // ── 2. Exit Monitoring for Open Positions ──
  if (allOpenPositions.length > 0) {
    for (const pos of allOpenPositions) {
      let isCE = pos.direction === "BUY_CE";
      let currentPremium = pos.entry_price;
      let parsedDelta = 0.5;
      let theta = 0;
      let gamma = 0;
      let currentIV = 0;

      let tradeType = "INTRADAY";
      let contractSymbol = "";
      let entryIV = 0;
      try {
        const parsed = JSON.parse(pos.notes || "{}");
        tradeType = parsed.trade_type || "INTRADAY";
        contractSymbol = parsed.symbol || "";
        entryIV = Number(parsed?.metrics?.iv || 0);
      } catch (e) {
        // ignore
      }

      // ── Retrieve pricing/Greeks from live tick cache or option chain fallback ──
      const liveTick = contractSymbol ? liveOptionTicks.get(contractSymbol) : null;
      if (liveTick) {
        currentPremium = liveTick.ltp ?? liveTick.bid ?? pos.entry_price;
        const delta = Math.abs(Number(liveTick.delta) || 0);
        parsedDelta = (delta >= 0.05 && delta <= 1.0) ? delta : 0.5;
        theta = Number(liveTick.theta) || 0;
        gamma = Number(liveTick.gamma) || 0;
        currentIV = Number(liveTick.iv) || 0;
      } else {
        const strikeData = strikes.find(s => s.strikePrice === pos.strike);
        if (strikeData) {
          currentPremium = isCE
            ? (strikeData.ceLtp ?? strikeData.ceBid ?? pos.entry_price)
            : (strikeData.peLtp ?? strikeData.peBid ?? pos.entry_price);
          const delta = Math.abs(Number(isCE ? strikeData.ceDelta : strikeData.peDelta) || 0);
          parsedDelta = (delta >= 0.05 && delta <= 1.0) ? delta : 0.5;
          theta = isCE ? (strikeData.ceTheta ?? 0) : (strikeData.peTheta ?? 0);
          gamma = isCE ? (strikeData.ceGamma ?? 0) : (strikeData.peGamma ?? 0);
          currentIV = isCE ? (strikeData.ceIV ?? 0) : (strikeData.peIV ?? 0);
        }
      }

      // ── Zero LTP Protection (Fyers Feed Disconnection) ──
      if (currentPremium <= 0 || isNaN(currentPremium)) {
        console.warn(`[AutoTrader-Srv] ⚠ Skipping exit check for trade ${pos.id} on ${page} because LTP is 0 (Feed Disconnection or Illiquid).`);
        continue;
      }

      // ── 2a. DYNAMIC DELTA-ADJUSTED TRAILING STOP LOSS ──
      const premiumGain = currentPremium - pos.entry_price;
      
      // Scale trigger and offset based on delta (normalized at 0.5 delta)
      const dynamicTrigger = trailCfg.trigger * (parsedDelta / 0.5);
      const dynamicOffset = trailCfg.offset * (parsedDelta / 0.5);

      if (premiumGain >= dynamicTrigger) {
        // Premium is significantly above entry — calculate trailing SL
        const trailedSL = currentPremium - dynamicOffset;
        // Only update if the new trailing SL is HIGHER than the existing SL
        if (trailedSL > pos.stop_loss) {
          const newSL = parseFloat(trailedSL.toFixed(1));
          const updated = pos.isShadow ? updateShadowTradeSL(pos.id, newSL) : updatePaperTradeSL(pos.id, newSL);
          if (updated) {
            const isBreakeven = pos.stop_loss < pos.entry_price && newSL >= pos.entry_price;
            const label = isBreakeven ? "BREAKEVEN (Cost-to-Cost)" : "TRAILING";
            console.log(`[AutoTrader-TSL] ${pos.isShadow ? "[SHADOW] " : ""}${page} trade ${pos.id}: SL updated to ₹${newSL} (${label}) | Premium: ₹${currentPremium.toFixed(1)}, Gain: +${premiumGain.toFixed(1)} pts`);
            
            if (!pos.isShadow) {
              // ── Emit SL Trail alarm ────────────────────────────────────
              try {
                let parsedSlN: any = {};
                try { parsedSlN = JSON.parse(pos.notes || "{}"); } catch {}
                const closedToday2 = getPaperTrades("CLOSED").filter(t => t.instrument === page);
                const dailyPnl3   = closedToday2.reduce((s, t) => s + (t.pnl || 0), 0);
                const slAlarm = buildSLTrailAlarm({
                  tradeId:      pos.id,
                  instrument:   page,
                  direction:    pos.direction as "BUY_CE" | "BUY_PE",
                  strike:       pos.strike,
                  optionSymbol: parsedSlN?.symbol || "",
                  entry:        pos.entry_price,
                  oldSL:        pos.stop_loss,
                  newSL,
                  tp:           pos.target,
                  currentLTP:   currentPremium,
                  isBreakeven,
                  lots:         pos.qty,
                  lotSize:      pos.lot_size,
                  strategyName: parsedSlN?.strategyName || "AUTO",
                  tradesToday:  closedToday2.length,
                  dailyPnl:     dailyPnl3,
                  dailyTarget:  3000,
                });
                emitTradeAlarm(io, slAlarm);
              } catch {}
              io.emit("toast-trigger", {
                type: "success",
                title: `🔒 SL ${label}`,
                message: `${page} SL moved: ₹${pos.stop_loss.toFixed(1)} → ₹${newSL} (Premium at ₹${currentPremium.toFixed(1)})`,
              });
              io.emit("paper-trade-sl-updated", { id: pos.id, oldSL: pos.stop_loss, newSL, reason: label });
            }
            // Update in-memory reference so exit check below uses the new SL
            pos.stop_loss = newSL;
          }
        }
      } else if (premiumGain > 0 && pos.stop_loss < pos.entry_price) {
        // AI Self Mind: Allow the trade to breathe. Only move to breakeven if gain is substantial (e.g. 75% of trigger or min 12 points)
        if (premiumGain >= Math.max(dynamicTrigger * 0.75, 12)) {
          const breakevenSL = parseFloat(pos.entry_price.toFixed(1));
          if (breakevenSL > pos.stop_loss) {
            const updated = pos.isShadow ? updateShadowTradeSL(pos.id, breakevenSL) : updatePaperTradeSL(pos.id, breakevenSL);
            if (updated) {
              console.log(`[AutoTrader-TSL] ${pos.isShadow ? "[SHADOW] " : ""}${page} trade ${pos.id}: SL moved to BREAKEVEN ₹${breakevenSL} | Premium gain: +${premiumGain.toFixed(1)} pts`);
              if (!pos.isShadow) {
                io.emit("toast-trigger", {
                  type: "info",
                  title: "🔒 SL → Breakeven",
                  message: `${page} SL moved to cost ₹${breakevenSL} (Gain: +${premiumGain.toFixed(1)} pts)`,
                });
                io.emit("paper-trade-sl-updated", { id: pos.id, oldSL: pos.stop_loss, newSL: breakevenSL, reason: "BREAKEVEN" });
              }
              pos.stop_loss = breakevenSL;
            }
          }
        }
      }

      // ── 2b. GREEKS-BASED PROTECTION AND EXITS ──
      let shouldExit = false;
      let exitReason = "";

      // 1. Theta-Decay Stagnation Stop — IQ200+: Relaxed to 25min (was 15min)
      // Give trades more breathing room — micro scalps auto-exit via SL/target anyway
      const elapsedMins = (Date.now() - pos.timestamp) / (60 * 1000);
      const isFlatOrNegative = currentPremium <= pos.entry_price;
      const expectedDecay = elapsedMins * (Math.abs(theta) / 375); // 375 trading minutes/day

      let isThetaDecayed = false;
      // IQ200+: Only exit on theta decay after 25 min (was 15min) and loss >= expected decay
      // This prevents premature exits on micro scalps that just need a bit more time
      if (tradeType === "INTRADAY" && elapsedMins >= 25 && isFlatOrNegative && Math.abs(theta) > 0) {
        const premiumLoss = pos.entry_price - currentPremium;
        if (premiumLoss >= expectedDecay * 0.85 || elapsedMins >= 35) {
          isThetaDecayed = true;
          shouldExit = true;
          exitReason = `THETA DECAY EXIT (${elapsedMins.toFixed(0)}m Flat)`;
        }
      }

      // 2. Vega-IV Crush Protection (Update 6: VIX-adaptive threshold)
      const ivDropPct = (entryIV > 0 && currentIV > 0) ? ((entryIV - currentIV) / entryIV) * 100 : 0;
      // If VIX is HIGH (>18), markets are already pricing in volatility,
      // so a 20% IV drop is just mean reversion — don't exit.
      // If VIX is LOW (<14), even 8% IV drop matters (options were cheap).
      const vixNow = marketState.niftyOptionChain.indiaVix || 15;
      const ivCrushThreshold =
        tradeType === "POSITIONAL" ? (vixNow > 20 ? 22 : vixNow < 14 ? 10 : 15) :
                                     (vixNow > 20 ? 15 : vixNow < 14 ?  7 : 10);
      const isIVCrush = currentIV > 0 && ivDropPct >= ivCrushThreshold && currentPremium < pos.entry_price * 1.05;
      if (isIVCrush && !shouldExit) {
        shouldExit = true;
        exitReason = `IV CRUSH EXIT (IV -${ivDropPct.toFixed(0)}%, threshold=${ivCrushThreshold}%, VIX=${vixNow.toFixed(1)})`;
      }

      // 3. Gamma Profit Target Acceleration
      let dynamicTarget = pos.target;
      if (gamma > 0.0008 && premiumGain > 0) {
        // Expand target by 15% during high-gamma breakout velocity
        dynamicTarget = pos.target + (pos.target - pos.entry_price) * 0.15;
      }

      // 4. Gamma Stall Early Exit
      const targetPointsExpected = dynamicTarget - pos.entry_price;
      const reached70Percent = premiumGain >= targetPointsExpected * 0.7;
      if (reached70Percent && gamma > 0 && gamma < 0.0003 && !shouldExit) {
        shouldExit = true;
        exitReason = "GAMMA STALL EXIT (Breakout Exhaustion)";
      }

      // 5. AI Brain Self-Mind Smart Profit Lock
      // If we are >= 60% towards target and momentum starts flipping against us, lock it!
      const reached60Percent = premiumGain >= targetPointsExpected * 0.6;
      let isAiMomentumFlip = false;
      if (reached60Percent) {
         if (pos.direction === "BUY_CE" && (momentum.direction === "DOWN" || momentum.macdAlignment === "BEARISH" || antigravity.finalSignal === "BUY_PE")) {
            isAiMomentumFlip = true;
         } else if (pos.direction === "BUY_PE" && (momentum.direction === "UP" || momentum.macdAlignment === "BULLISH" || antigravity.finalSignal === "BUY_CE")) {
            isAiMomentumFlip = true;
         }
      }
      if (reached60Percent && !shouldExit && isAiMomentumFlip) {
        shouldExit = true;
        exitReason = "AI SELF-MIND: PROFIT LOCKED (Momentum Flip Detected)";
      }

      // Only exit on reversal if the opposite signal is STRONG (>= 65% confidence) 
      // AND the trade has been open for at least 2 minutes to prevent instant whipsawing
      const isReverseDecision =
        elapsedMins >= 2 && antigravity.confidence >= 65 && (
          (pos.direction === "BUY_CE" && antigravity.finalSignal === "BUY_PE") ||
          (pos.direction === "BUY_PE" && antigravity.finalSignal === "BUY_CE")
        );

      if (tradeType === "INTRADAY" && isTimeExit) {
        shouldExit = true;
        exitReason = "FORCE TIME EXIT (15:25 IST)";
      } else if (isReverseDecision) {
        shouldExit = true;
        exitReason = "SIGNAL REVERSE EXIT";
      } else if (currentPremium <= pos.stop_loss) {
        shouldExit = true;
        exitReason = pos.stop_loss >= pos.entry_price ? "TRAILING SL HIT (Profit Locked)" : "STOP LOSS HIT";
      } else if (currentPremium >= dynamicTarget && !shouldExit) {
        shouldExit = true;
        exitReason = "TARGET HIT";
      }

      if (shouldExit) {
        const exitPnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;
        const success = pos.isShadow
          ? closeShadowTrade(pos.id, parseFloat(currentPremium.toFixed(1)), parseFloat(exitPnl.toFixed(1)))
          : closePaperTrade(pos.id, parseFloat(currentPremium.toFixed(1)), parseFloat(exitPnl.toFixed(1)));
        
        if (success) {
          console.log(`[AutoTrader-Srv] ${pos.isShadow ? "[SHADOW] " : ""}Closed open trade ${pos.id} on ${page}: ${exitReason} at premium ${currentPremium.toFixed(1)}, PnL: ₹${exitPnl.toFixed(1)}`);

          // ── Self-learning: Record trade outcome ────────────────────────
          try {
            const { h: eh, m: em } = getISTTime();
            const pattern: TradePattern = {
              timeSlot:       getTimeSlot(eh, em),
              regime:         getRegimeBucket(report.trend.overall || "RANGE"),
              pcrBucket:      getPcrBucket(report.oi.pcr || 1.0),
              breadthBucket:  getBreadthBucket(report.trend.strengthPct || 50),
              vixBucket:      getVixBucket(marketState.niftyOptionChain.indiaVix || 15),
              momentumBucket: getMomBucket(momentum.momentumScore || 50),
              direction:      pos.direction as "BUY_CE" | "BUY_PE",
              strategyName:   (() => {
                try { return JSON.parse(pos.notes || "{}")?.strategyName || "UNKNOWN"; } catch { return "UNKNOWN"; }
              })(),
            };
            recordTradeResult({
              tradeId:    pos.id,
              pattern,
              outcome:    exitPnl > 50 ? "WIN" : exitPnl < -50 ? "LOSS" : "BREAKEVEN",
              pnl:        exitPnl,
              confidence: (() => { try { return JSON.parse(pos.notes || "{}")?.metrics?.confidence || 75; } catch { return 75; } })(),
            });
          } catch (slErr: any) {
            console.error("[AutoTrader-Srv] Self-learning record error:", slErr.message);
          }

          if (!pos.isShadow) {
            // ── Emit EXIT alarm ────────────────────────────────────────────
            try {
              const closedToday = getPaperTrades("CLOSED").filter(t => t.instrument === page);
              const dailyPnl2 = closedToday.reduce((s, t) => s + (t.pnl || 0), 0);
              let parsedN: any = {};
              try { parsedN = JSON.parse(pos.notes || "{}"); } catch {}
              const exitAlarm = buildExitAlarm({
                tradeId:      pos.id,
                instrument:   page,
                direction:    pos.direction as "BUY_CE" | "BUY_PE",
                strike:       pos.strike,
                optionSymbol: parsedN?.symbol || "",
                entry:        pos.entry_price,
                sl:           pos.stop_loss,
                tp:           pos.target,
                exitPrice:    currentPremium,
                pnl:          exitPnl,
                lots:         pos.qty,
                lotSize:      pos.lot_size,
                exitReason,
                strategyName: parsedN?.strategyName || parsedN?.reason?.split("[")[1]?.split("]")[0] || "AUTO",
                tradesToday:  closedToday.length,
                dailyPnl:     dailyPnl2,
                dailyTarget:  3000,
              });
              emitTradeAlarm(io, exitAlarm);
            } catch (alarmErr: any) {
              console.error("[AutoTrader-Srv] Exit alarm error:", alarmErr.message);
            }

            const logMsg = `Closed auto-trade on ${page}: Exit at ₹${currentPremium.toFixed(1)} (PnL: ₹${exitPnl.toFixed(1)}, Reason: ${exitReason})`;
            globalBus.addLog(logMsg, "info");

            // Notify clients
            io.emit("paper-trade-closed", { id: pos.id, exitPrice: currentPremium, pnl: exitPnl, reason: exitReason });
            io.emit("toast-trigger", {
              type: "info",
              title: `Server Auto Exit: ${exitReason}`,
              message: `${page} trade closed at ₹${currentPremium.toFixed(1)} (PnL: ₹${exitPnl.toFixed(1)})`
            });
          }
        }
      }
    }
  }

  // ── 2.5 Update Active Positional Trades (from position_trades.json) ──
  try {
    const activePositionalTrades = getPositionTrades("ACTIVE");
    for (const pos of activePositionalTrades) {
      if (pos.instrument !== page) continue;
      
      const liveTick = pos.optionSymbol ? liveOptionTicks.get(pos.optionSymbol) : null;
      let currentPremium = pos.currentPrice;
      if (liveTick) {
        currentPremium = liveTick.ltp ?? liveTick.bid ?? pos.currentPrice;
      } else {
        // Fallback to option chain
        const strikeData = strikes.find(s => s.strikePrice === pos.strike);
        if (strikeData) {
          currentPremium = pos.direction === "BUY_CE"
            ? (strikeData.ceLtp ?? strikeData.ceBid ?? pos.currentPrice)
            : (strikeData.peLtp ?? strikeData.peBid ?? pos.currentPrice);
        }
      }
      
      if (currentPremium > 0 && currentPremium !== pos.currentPrice) {
        updatePositionPrices(pos.instrument, pos.optionSymbol, currentPremium);
      }
    }
  } catch (err: any) {
    console.error("[AutoTrader-Srv] Error updating active positional trade prices:", err.message);
  }

  // ── 3. Entry Monitoring ──
  const isMarketOpen = marketState.isSimulating || (totalMinutes >= (9 * 60 + 15) && totalMinutes < (15 * 60));

  // Compute weighted stock signal first so it is available to the consensus
  const stocksForPage = page === "NIFTY"
    ? Object.values(marketState.niftyStocks)
    : (page === "BANKNIFTY" ? Object.values(marketState.bankniftyStocks) : Object.values(marketState.sensexStocks));
  const spotChangePct = page === "NIFTY"
    ? marketState.niftyOptionChain.spotChangePct
    : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain.spotChangePct : marketState.sensexOptionChain.spotChangePct);
  const weightedSignal = computeWeightedStockSignal(stocksForPage as any, spotChangePct || 0);

  // Compute the Master AI Consensus decision
  const consensus = getGlobalAIBrainConsensus(
    page,
    antigravity,
    aiEngineV2,
    report,
    momentum.momentumScore,
    weightedSignal.netScore,
    "Micro Scalp"
  );

  // Send the consensus status to UI
  io.emit("ai-consensus-update", { page, consensus });

  // Cross-engine opposite position lock: check if CS holds an opposite position
  const openCsTrades = csGetTrades("OPEN").filter(t => t.instrument === page);
  const hasOppositeCsPosition = openCsTrades.some(t => {
    if (antigravity.finalSignal === "BUY_CE" && t.direction === "BUY_PE") return true;
    if (antigravity.finalSignal === "BUY_PE" && t.direction === "BUY_CE") return true;
    return false;
  });

  // Standard trades (Intraday/Positional) only trigger if consensus agrees, is promoted, and CS does not have opposite position
  // Decoupled actionability for POSITIONAL vs INTRADAY
  const isPositionalActionable = (antigravity.finalSignal === "BUY_CE" || antigravity.finalSignal === "BUY_PE") &&
                                 consensus.decision === antigravity.finalSignal &&
                                 !hasOppositeCsPosition;
                                 
  // Standard intraday trades only trigger if consensus agrees, is promoted, and CS does not have opposite position
  const isActionable = isPositionalActionable && consensus.isPromoted;

  const alignOk = !alignment.noTradeFilter;

  if ((isActionable || isPositionalActionable) && isMarketOpen) {
    const openIntradayPositions = openPositions.filter(p => {
      try {
        const parsed = JSON.parse(p.notes || "{}");
        return parsed.trade_type !== "POSITIONAL";
      } catch (_) {
        return true;
      }
    });
    const hasOpenIntraday = openIntradayPositions.length >= 3;

    const activeRealPositionalCount = getPositionTrades("ACTIVE").filter(p => p.instrument === page).length;
    const activeShadowPositionalCount = getShadowTrades("OPEN").filter(p => {
      try {
        if (p.instrument !== page) return false;
        const parsed = JSON.parse(p.notes || "{}");
        return parsed.trade_type === "POSITIONAL";
      } catch (_) {
        return false;
      }
    }).length;

    // Define storage capacity for positional trades per instrument
    const MAX_REAL_POSITION_TRADES = 3;
    const MAX_SHADOW_POSITION_TRADES = 25; // High limit to gather training data

    let tradeTriggeredThisTick = false;

    // ── 3a. INTRADAY TRADE TRIGGER ──
    intradayBlock: {
      if (!isActionable) break intradayBlock;
      if (!alignOk) {
        const nowLog = Date.now();
        if (nowLog - (lastCooldownLog[`${page}-INTRA-ALIGN`] || 0) > 60000) {
          console.log(`[AutoTrader-Srv] [INTRADAY SKIP] ${page} blocked by alignment: ${alignment.noTradeReason}`);
          lastCooldownLog[`${page}-INTRA-ALIGN`] = nowLog;
        }
        break intradayBlock;
      }
      if (hasOpenIntraday) break intradayBlock;

    // ── Weighted Stock Signal Gate (YOUR KEY INSIGHT) ─────────────────────
    // Reused outer-scope weightedSignal

    // Update Day High and Day Low of net weighted scores
    checkAndResetDailyScores();
    const currentScore = weightedSignal.netScore;
    if (scoreDayHighs[page] === -999 || currentScore > scoreDayHighs[page]) {
      scoreDayHighs[page] = parseFloat(currentScore.toFixed(2));
    }
    if (scoreDayLows[page] === 999 || currentScore < scoreDayLows[page]) {
      scoreDayLows[page] = parseFloat(currentScore.toFixed(2));
    }

    // ── Reversal Check based on DH (Day High) & DL (Day Low) of net score ────
    let isReversalCE = false;
    let isReversalPE = false;
    const currentDH = scoreDayHighs[page];
    const currentDL = scoreDayLows[page];

    // Bullish Reversal: Extreme Low (DL < -10) was touched, and current score has bounced up by >= 7 points
    if (currentDL < -10 && (currentScore - currentDL >= 7)) {
      isReversalCE = true;
    }
    // Bearish Reversal: Extreme High (DH > 10) was touched, and current score has dropped by >= 7 points
    if (currentDH > 10 && (currentDH - currentScore >= 7)) {
      isReversalPE = true;
    }

    const isWeightedAligned = true; // Bypass strict stock divergence check to prevent deadlocks in live market

    // Log weighted signal for diagnostics
    if (!isWeightedAligned) {
      const now2 = Date.now();
      if (now2 - (lastCooldownLog[`${page}-WEIGHT`] || 0) > 30000) {
        console.log(`[AutoTrader-Srv] ${page} WEIGHTED STOCK GATE BLOCKED: ${weightedSignal.gateSummary} | Divergence: ${weightedSignal.divergenceDetected ? weightedSignal.divergenceWarning : "none"}`);
        lastCooldownLog[`${page}-WEIGHT`] = now2;
      }
    }

    // ── IQ200+ GATE SYSTEM (Ultra-Relaxed for All-Day Trading) ────────────────
    // Philosophy: ALWAYS TAKE A TRADE if market is open and signal exists.
    // Only hard blocks: no LTP data, trap detected, or truly flat market.
    const vix4gate = marketState.niftyOptionChain.indiaVix || 15;
    const pcr4gate = report.oi.pcr || 1.0;
    const breadth4gate = report.trend.strengthPct || 50;

    // IQ200+: Detect current momentum tier for adaptive targeting
    const momentumTier = getMomentumTier(momentum.momentumScore);

    const expiryDayForTrade = isExpiryDay(page);
    
    // IQ 200 Advanced Expiry Logic:
    let advancedExpiryCheckOk = true;
    if (expiryDayForTrade) {
      // 1. Time Check: Strictly block if outside of EXPIRY_CONFIG.windows
      if (!isInExpiryWindow(totalMinutes)) {
        advancedExpiryCheckOk = false;
      }
      
      // 2. Short Covering / VWAP Mean Reversion Check (1:00 PM to 2:30 PM only)
      // After 2:30 PM = Ultra Gamma Zone — DO NOT block, even sideways can explode
      if (totalMinutes > 13 * 60 && totalMinutes < EXPIRY_CONFIG.ultraGammaStart) {
        if (momentum.momentumScore < 60 && pcr4gate > 0.8 && pcr4gate < 1.2) {
          // Sideways market in early afternoon of expiry -> block to save capital
          advancedExpiryCheckOk = false;
        }
      }
      // Ultra Gamma Zone (2:30 PM+): Always allow if window is open — ₹5 → ₹250 potential
    }

    // Hard blocks only — prevent bad trades, not all trades
    const tradeGates = {
      // Only block if it's a confirmed trap with HIGH probability (95%+)
      orbTrapOk:   !breakout.rangeEstablished5m || breakout.trapProbability < 95,
      // Market must be open with real data
      marketDataOk: spotPrice > 0 && strikes.length > 0,
      // IQ 200 Expiry Advanced Checks
      expiryTimeAndSetupOk: advancedExpiryCheckOk
    };
    const gatesPassed = Object.values(tradeGates).filter(Boolean).length;
    const totalGates  = Object.keys(tradeGates).length;

    // IQ200+: All gates must pass (but there are only 2 easy ones)
    const gateThreshold = totalGates; // both must pass

    if (gatesPassed < gateThreshold) {
      const now3 = Date.now();
      if (now3 - (lastCooldownLog[`${page}-GATES`] || 0) > 30000) {
        const logMsg = `${page} GATES BLOCKED: ${gatesPassed}/${totalGates} | ${JSON.stringify(tradeGates)}`;
        console.log(`[AutoTrader-Srv] ${logMsg}`);
        globalBus.addLog(logMsg, "warn");
        lastCooldownLog[`${page}-GATES`] = now3;
      }
      break intradayBlock;
    }

    // ── IQ200+: Self-Learning bonus (record-only, NO blocking) ───────────────
    // IMPORTANT: Self-learning NEVER blocks trades — only provides confidence bonus
    // Blocking trades based on history kills all-day scalping
    const { h: th, m: tm } = getISTTime();
    const currentPattern: TradePattern = {
      timeSlot:       getTimeSlot(th, tm),
      regime:         getRegimeBucket(report.trend.overall || "RANGE"),
      pcrBucket:      getPcrBucket(pcr4gate),
      breadthBucket:  getBreadthBucket(breadth4gate),
      vixBucket:      getVixBucket(vix4gate),
      momentumBucket: getMomBucket(momentum.momentumScore || 50),
      direction:      antigravity.finalSignal as "BUY_CE" | "BUY_PE",
      strategyName:   (antigravity as any).signalCategory || "AUTO",
    };
    // NOTE: isPatternBlocked() intentionally NOT called — it was killing all-day trading
    // Self-learning only provides confidence bonus, never blocks
    const learningBonus = getConfidenceBonus(currentPattern);
    const effectiveConfidence = Math.min(99, antigravity.confidence + learningBonus);

    // ── IQ200+: Confidence threshold — ALWAYS TAKE TRADE ─────────────────────
    // Base = 0: any signal with any confidence triggers a trade
    // The momentum tier determines the SIZE/TARGET of the trade, not whether to take it
    const adaptiveThreshold = 0; // IQ200+: Always fire — momentum tier handles risk

    // IQ200+: ALL SIGNALS FIRE — no confidence gate
    // Momentum tier handles the risk — MICRO gets tiny target/SL, STRONG gets big target/SL
    if (!hasOpenIntraday) {
      // Configured trade limit (default 999, adjustable in UI)
      const maxTradesDay = getDynamicMaxTrades(page);
      const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      const tradesToday = getPaperTrades("CLOSED").filter(t => {
        try {
          const parsed = JSON.parse(t.notes || "{}");
          return t.instrument === page &&
            parsed.trade_type !== "POSITIONAL" &&
            t.closed_at && new Date(t.closed_at + 5.5 * 3600 * 1000).toISOString().slice(0, 10) === todayIST;
        } catch { return false; }
      });
      if (tradesToday.length >= maxTradesDay) {
        const logKey = `${page}-INTRADAY-MAX`;
        const now = Date.now();
        if (now - (lastCooldownLog[logKey] || 0) > 60000) {
          const logMsg = `${page} INTRADAY daily limit: ${tradesToday.length}/${maxTradesDay} trades done today.`;
          console.log(`[AutoTrader-Srv] ${logMsg}`);
          globalBus.addLog(logMsg, "warn");
          lastCooldownLog[logKey] = now;
        }
        break intradayBlock;
      }

      // ── IQ200+: Smart Adaptive Cooldown ──────────────────────────────────────
      // MICRO SCALP: 15 seconds between trades
      // NORMAL: 20 seconds between trades
      // STRONG MOMENTUM: 10 seconds (ride the wave quickly)
      // After SL: 20 seconds (don't immediately re-enter)
      // After Theta/IV: 45 seconds (momentum truly gone)
      const lastClosedIntraday = getPaperTrades("CLOSED").find(t => {
        try {
          const parsed = JSON.parse(t.notes || "{}");
          return t.instrument === page && parsed.trade_type !== "POSITIONAL";
        } catch (_) { return t.instrument === page; }
      });

      let ENTRY_COOLDOWN_MS = (() => {
        // Momentum-tier based base cooldown
        if (momentumTier.label === "BIG")   return 10 * 1000;  // Strong momentum: fast re-entry
        if (momentumTier.label === "MICRO") return 15 * 1000;  // Micro: rapid scalping
        return 20 * 1000; // Normal: 20 seconds
      })();
      let onCooldown = false;

      if (lastClosedIntraday && lastClosedIntraday.closed_at) {
        const msSinceClose = Date.now() - lastClosedIntraday.closed_at;
        const lastNotes = (() => { try { return JSON.parse(lastClosedIntraday.notes || "{}"); } catch { return {}; } })();
        const lastExitReason: string = lastNotes.exit_reason || "";

        // Quick re-entry after target hit (momentum still going)
        if (lastExitReason.includes("TARGET HIT")) {
          ENTRY_COOLDOWN_MS = 8 * 1000; // 8 seconds — ride the momentum!
        }
        // Normal re-entry after SL hit
        else if (lastExitReason.includes("STOP LOSS HIT")) {
          ENTRY_COOLDOWN_MS = 20 * 1000; // 20 seconds — take a breath
        }
        // Block re-entry after theta/IV crush (momentum is gone)
        else if (lastExitReason.includes("THETA DECAY") || lastExitReason.includes("IV CRUSH")) {
          ENTRY_COOLDOWN_MS = 45 * 1000; // 45 seconds — momentum dead
        }
        // After signal reverse: wait for new direction to establish
        else if (lastExitReason.includes("SIGNAL REVERSE")) {
          ENTRY_COOLDOWN_MS = 25 * 1000; // 25 seconds
        }
        // After trailing SL (locked profit) — quick re-entry
        else if (lastExitReason.includes("TRAILING SL")) {
          ENTRY_COOLDOWN_MS = 10 * 1000; // 10 seconds
        }

        if (msSinceClose < ENTRY_COOLDOWN_MS) {
          onCooldown = true;
          const remainingSecs = Math.ceil((ENTRY_COOLDOWN_MS - msSinceClose) / 1000);
          const now = Date.now();
          if (now - lastCooldownLog[`${page}-INTRADAY`] > 15000) { // Log every 15s max
            console.log(`[AutoTrader-Srv] ${page} on cooldown: ${remainingSecs}s remaining (${momentumTier.label} tier, reason: ${lastExitReason || 'default'})`);
            lastCooldownLog[`${page}-INTRADAY`] = now;
          }
        }
      }

      if (!onCooldown) {
        tradeTriggeredThisTick = true;
        console.log(`[AutoTrader-Srv] 🎯 ${page} INTRADAY entry: ${antigravity.finalSignal} | Tier: ${momentumTier.label} | MomentumScore: ${momentum.momentumScore}`);
        triggerAutoTrade(page, spotPrice, strikes, antigravity, alignment, report, momentum, breakout, "INTRADAY", io).catch(e => {
          console.error(`[AutoTrader-Srv] [INTRADAY Entry Error] [${page}]`, e.message);
        });
      }
    }
  }

  // ── IQ200+: BERSERKER ALL-DAY SCALP LOOP ─────────────────────────────────
  // Berserker fires ALWAYS when no intraday position is open + no trade was triggered this tick
  // This guarantees trading activity throughout the day at minimum every 60-90 seconds
  const isBerserkerPromoted = consensus.decision !== "WAIT" &&
                              consensus.decision !== "NO_TRADE" &&
                              consensus.isPromoted &&
                              !hasOppositeCsPosition;
  const isBerserkerShadow = !isBerserkerPromoted;

  const hasOpenRealIntraday = openPositions.filter(p => {
    try {
      const parsed = JSON.parse(p.notes || "{}");
      return parsed.trade_type !== "POSITIONAL";
    } catch (_) {
      return true;
    }
  }).length > 0;

  const hasOpenShadowIntraday = openShadowPositions.filter(p => {
    try {
      const parsed = JSON.parse(p.notes || "{}");
      return parsed.trade_type !== "POSITIONAL";
    } catch (_) {
      return true;
    }
  }).length > 0;

  const hasOpenForThisMode = isBerserkerShadow ? hasOpenShadowIntraday : hasOpenRealIntraday;

  if (!hasOpenForThisMode && !tradeTriggeredThisTick && isMarketOpen && alignOk) {
    let onBerserkerCooldown = false;
    const lastClosedIntraday = (isBerserkerShadow ? getShadowTrades("CLOSED") : getPaperTrades("CLOSED")).find(t => {
      try {
        const parsed = JSON.parse(t.notes || "{}");
        return t.instrument === page && parsed.trade_type !== "POSITIONAL";
      } catch (_) { return t.instrument === page; }
    });
    if (lastClosedIntraday && lastClosedIntraday.closed_at) {
      const msSinceClose = Date.now() - lastClosedIntraday.closed_at;
      const lastNotes = (() => { try { return JSON.parse(lastClosedIntraday.notes || "{}"); } catch { return {}; } })();
      const lastExitReason: string = lastNotes.exit_reason || "";

      // IQ200+: Berserker cooldown based on what happened last
      let BERSERKER_COOLDOWN_MS = 12 * 1000; // Default: 12 seconds
      if (lastExitReason.includes("TARGET HIT")) {
        BERSERKER_COOLDOWN_MS = 8 * 1000;   // Quick re-entry on win
      } else if (lastExitReason.includes("STOP LOSS HIT")) {
        BERSERKER_COOLDOWN_MS = 20 * 1000;  // Slight pause after loss
      } else if (lastExitReason.includes("THETA DECAY") || lastExitReason.includes("IV CRUSH")) {
        BERSERKER_COOLDOWN_MS = 40 * 1000;  // Momentum truly gone — wait
      }

      if (msSinceClose < BERSERKER_COOLDOWN_MS) {
        onBerserkerCooldown = true;
      }
    }

    if (!onBerserkerCooldown) {
      // IQ200+: Smart direction bias from multiple sources
      const directionTrend = detectScoreTrend(history);
      let directionBias: "BUY_CE" | "BUY_PE" | null = null;

      // Priority 1: Score trend (most reliable)
      if (directionTrend === "CE") directionBias = "BUY_CE";
      else if (directionTrend === "PE") directionBias = "BUY_PE";
      else {
        // Priority 2: AI direction from dispatcher
        const aiDir = dispatcherInput.aiDirection;
        if (aiDir === "BUY_CE") directionBias = "BUY_CE";
        else if (aiDir === "BUY_PE") directionBias = "BUY_PE";
        else {
          // Priority 3: Momentum direction
          if (momentum.direction === "UP") directionBias = "BUY_CE";
          else if (momentum.direction === "DOWN") directionBias = "BUY_PE";
          else {
            // Priority 4: Weighted stock signal (always resolved)
            const stocksForPage = page === "NIFTY"
              ? Object.values(marketState.niftyStocks)
              : (page === "BANKNIFTY" ? Object.values(marketState.bankniftyStocks) : Object.values(marketState.sensexStocks));
            const spotChangePct = page === "NIFTY"
              ? marketState.niftyOptionChain.spotChangePct
              : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain.spotChangePct : marketState.sensexOptionChain.spotChangePct);
            const wSignal = computeWeightedStockSignal(stocksForPage as any, spotChangePct || 0);
            directionBias = wSignal.netScore >= 0 ? "BUY_CE" : "BUY_PE";
          }
        }
      }

      if (directionBias) {
        // IQ200+: Berserker target is momentum-tier adaptive
        const momentumScore = momentum.momentumScore || 50;
        const isStrongMomentum = momentumScore >= 65;
        
        let multiplier = 1.0;
        if (page === "SENSEX") multiplier = 4.0;
        else if (page === "BANKNIFTY") multiplier = 2.5;

        const berserkTarget  = Math.round((isStrongMomentum ? 15 : 8) * multiplier);
        const berserkSL      = Math.round((isStrongMomentum ? 8  : 4) * multiplier);

        const berserkTierLabel = isStrongMomentum ? "BIG" : "MICRO";
        console.log(`[AutoTrader-Berserker] 🔥 ${page} Berserker | ${directionBias} | Tier: ${berserkTierLabel} | Target: ${berserkTarget}pts | SL: ${berserkSL}pts | Shadow: ${isBerserkerShadow}`);
        
        if (!isBerserkerShadow) {
          io.emit("toast-trigger", {
            type: "warning",
            title: `⚡ ${isStrongMomentum ? "Big" : "Micro"} Scalp`,
            message: `${page} ${directionBias} | T: +${berserkTarget}pts | SL: -${berserkSL}pts`
          });
          io.emit("micro-scalp-status-update", { page, active: true, tier: berserkTierLabel });
        }

        triggerAutoTrade(
          page,
          spotPrice,
          strikes,
          antigravity,
          alignment,
          report,
          momentum,
          breakout,
          "INTRADAY",
          io,
          false,
          {
            strategyName: isStrongMomentum ? "Momentum Scalp" : "Micro Scalp",
            targetPoints: berserkTarget,
            stopLossPoints: berserkSL,
            direction: directionBias
          },
          isBerserkerShadow
        ).catch(e => {
          console.error(`[AutoTrader-Srv] [Berserker Entry Error] [${page}]`, e.message);
        });
      }
    }
  }

    // ── 3b. POSITIONAL TRADE TRIGGER ──
    positionalBlock: {
      if (!isPositionalActionable) {
        const nowLog = Date.now();
        if (nowLog - (lastCooldownLog[`${page}-POS-ACT`] || 0) > 60000) {
          const hasSignal = antigravity.finalSignal === "BUY_CE" || antigravity.finalSignal === "BUY_PE";
          const consensusMatches = consensus.decision === antigravity.finalSignal;
          console.log(`[AutoTrader-Srv] [POSITIONAL SKIP] ${page} isPositionalActionable: false. HasSignal: ${hasSignal} (${antigravity.finalSignal}), ConsensusMatches: ${consensusMatches} (Consensus: ${consensus.decision}), HasOppositeCsPosition: ${hasOppositeCsPosition}`);
          lastCooldownLog[`${page}-POS-ACT`] = nowLog;
        }
        break positionalBlock;
      }

      const positionalConfThreshold = consensus.isPromoted ? 50 : 35; // IQ 200: relaxed to 50 for real, 35 for sandbox shadow to gather training data
      const positionalConfOk = antigravity.confidence >= positionalConfThreshold;
      
      const overallTrend = report.trend.overall.toUpperCase();
      const isBullTrend = overallTrend.includes("BULLISH");
      const isBearTrend = overallTrend.includes("BEARISH");
      
      const trendAligned = (antigravity.finalSignal === "BUY_CE" && isBullTrend) || 
                           (antigravity.finalSignal === "BUY_PE" && isBearTrend);
      
      // IQ 200: VIX Filter for Positional - Only allow if VIX is decent (avoid high IV crash)
      const vixNow = marketState.niftyOptionChain.indiaVix || 15;
      const vixOk = vixNow < 22; // Block if VIX is dangerously high (crash impending)
      
      if (!positionalConfOk || !trendAligned || !vixOk) {
        const nowLog = Date.now();
        if (nowLog - (lastCooldownLog[`${page}-POS-GATES`] || 0) > 60000) {
          console.log(`[AutoTrader-Srv] [POSITIONAL SKIP] ${page} Gates: positionalConfOk: ${positionalConfOk} (Conf: ${antigravity.confidence} vs threshold: ${positionalConfThreshold}), trendAligned: ${trendAligned} (Signal: ${antigravity.finalSignal}, Trend: ${overallTrend}), vixOk: ${vixOk} (VIX: ${vixNow} vs 22)`);
          lastCooldownLog[`${page}-POS-GATES`] = nowLog;
        }
        break positionalBlock;
      }

      // Cooldown check for positional (longer: 10 minutes)
      const POS_COOLDOWN_MS = 10 * 60 * 1000;
      const lastClosedReal = getPositionTrades("CLOSED_PROFIT").concat(getPositionTrades("CLOSED_LOSS")).sort((a, b) => b.updatedAt - a.updatedAt).find(t => t.instrument === page);
      const lastClosedShadow = getShadowTrades("CLOSED").sort((a, b) => (b.closed_at || 0) - (a.closed_at || 0)).find(t => {
        try {
          return t.instrument === page && JSON.parse(t.notes || "{}").trade_type === "POSITIONAL";
        } catch { return false; }
      });
      
      const msSinceClosedReal = lastClosedReal ? (Date.now() - lastClosedReal.updatedAt) : Infinity;
      const msSinceClosedShadow = lastClosedShadow && lastClosedShadow.closed_at ? (Date.now() - lastClosedShadow.closed_at) : Infinity;
      const onCooldown = Math.min(msSinceClosedReal, msSinceClosedShadow) < POS_COOLDOWN_MS;

      if (onCooldown) {
        const nowLog = Date.now();
        if (nowLog - (lastCooldownLog[`${page}-POS-COOLDOWN`] || 0) > 60000) {
          console.log(`[AutoTrader-Srv] [POSITIONAL SKIP] ${page} is on cooldown. Last Real: ${msSinceClosedReal.toFixed(0)}ms, Last Shadow: ${msSinceClosedShadow.toFixed(0)}ms`);
          lastCooldownLog[`${page}-POS-COOLDOWN`] = nowLog;
        }
        break positionalBlock;
      }

      // If Promoted -> Live Positional Trade (saved to position_trades.json)
      if (consensus.isPromoted) {
        const canPyramidReal = getPositionTrades("ACTIVE").some(t => t.instrument === page && t.unrealizedPnL > (t.totalPremium * 0.5));
        if (activeRealPositionalCount < MAX_REAL_POSITION_TRADES || canPyramidReal) {
          console.log(`[AutoTrader-Srv] 🎯 TRIGGERING REAL POSITIONAL TRADE FOR ${page} at spot ${spotPrice}`);
          triggerAutoTrade(page, spotPrice, strikes, antigravity, alignment, report, momentum, breakout, "POSITIONAL", io, false, undefined, false, aiEngineV2).catch(e => {
            console.error(`[AutoTrader-Srv] [POSITIONAL REAL Entry Error] [${page}]`, e.message);
          });
        } else {
          const nowLog = Date.now();
          if (nowLog - (lastCooldownLog[`${page}-POS-REAL-CAP`] || 0) > 60000) {
            console.log(`[AutoTrader-Srv] [POSITIONAL SKIP] ${page} REAL capacity full: ${activeRealPositionalCount}/${MAX_REAL_POSITION_TRADES}. Pyramid: ${canPyramidReal}`);
            lastCooldownLog[`${page}-POS-REAL-CAP`] = nowLog;
          }
        }
      } else {
        // If Sandbox/Not Promoted -> Background Journal Positional Trade (saved to te_shadow_trades)
        const canPyramidShadow = getShadowTrades("OPEN").some(t => { try { return t.instrument === page && JSON.parse(t.notes || "{}").trade_type === "POSITIONAL" && (t.latest_ltp || 0) > (t.entry_price || 0) * 1.5; } catch { return false; } });
        if (activeShadowPositionalCount < MAX_SHADOW_POSITION_TRADES || canPyramidShadow) {
          console.log(`[AutoTrader-Srv] 🎯 TRIGGERING SHADOW POSITIONAL TRADE FOR ${page} at spot ${spotPrice}`);
          triggerAutoTrade(page, spotPrice, strikes, antigravity, alignment, report, momentum, breakout, "POSITIONAL", io, false, undefined, true, aiEngineV2).catch(e => {
            console.error(`[AutoTrader-Srv] [POSITIONAL SHADOW Entry Error] [${page}]`, e.message);
          });
        } else {
          const nowLog = Date.now();
          if (nowLog - (lastCooldownLog[`${page}-POS-SHAD-CAP`] || 0) > 60000) {
            console.log(`[AutoTrader-Srv] [POSITIONAL SKIP] ${page} SHADOW capacity full: ${activeShadowPositionalCount}/${MAX_SHADOW_POSITION_TRADES}. Pyramid: ${canPyramidShadow}`);
            lastCooldownLog[`${page}-POS-SHAD-CAP`] = nowLog;
          }
        }
      }
    }
  }
}

// ── CONFIG & STATUS SHARING HELPER FUNCTIONS ─────────────────────────────────────

interface AutoTradeConfig {
  isActive: boolean;
  mode: "PAPER" | "LIVE";
  hedgeMode: boolean;
  trailingSL: boolean;
  levelBasedTarget: boolean;
  maxTradesLimit?: number;
}

const CONFIG_PATH = path.join(process.cwd(), "server", "storage", "autotrade_config.json");

export function getAutoTradeConfig(): AutoTradeConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      return {
        isActive: true, // Force always active
        mode: data.mode ?? "PAPER",
        hedgeMode: data.hedgeMode ?? false,
        trailingSL: data.trailingSL ?? true,
        levelBasedTarget: data.levelBasedTarget ?? true,
        maxTradesLimit: data.maxTradesLimit ?? 100
      };
    }
  } catch (err) {
    console.error("[AutoTrader-Srv] Error reading config file:", err);
  }
  return {
    isActive: true, // Force always active
    mode: "PAPER",
    hedgeMode: false,
    trailingSL: true,
    levelBasedTarget: true,
    maxTradesLimit: 100
  };
}

export function saveAutoTradeConfig(config: Partial<AutoTradeConfig>): AutoTradeConfig {
  const current = getAutoTradeConfig();
  const updated = { ...current, ...config, isActive: true }; // Force always active
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf8");
  } catch (err) {
    console.error("[AutoTrader-Srv] Error writing config file:", err);
  }
  return updated;
}

// ── SCORE MOMENTUM HISTORICAL TRACKER ───────────────────────────────────────────

interface ScoreMomentumWindow {
  interval: number;
  high: number;
  low: number;
  lastScore: number;
  timestamp: number;
}

export const scoreMomentumHistory: Record<string, ScoreMomentumWindow[]> = { NIFTY: [], BANKNIFTY: [], SENSEX: [] };

export function updateScoreMomentumHistory(page: "NIFTY" | "SENSEX" | "BANKNIFTY", globalScore: number): ScoreMomentumWindow[] {
  const now = Date.now();
  const currentInterval = Math.floor(now / (5 * 60 * 1000));
  let history = scoreMomentumHistory[page] || [];

  if (history.length === 0 || history[history.length - 1].interval !== currentInterval) {
    history.push({
      interval: currentInterval,
      high: globalScore,
      low: globalScore,
      lastScore: globalScore,
      timestamp: now,
    });
    if (history.length > 20) {
      history.shift();
    }
  } else {
    const currWindow = { ...history[history.length - 1] };
    currWindow.high = Math.max(currWindow.high, globalScore);
    currWindow.low = Math.min(currWindow.low, globalScore);
    currWindow.lastScore = globalScore;
    history[history.length - 1] = currWindow;
  }
  scoreMomentumHistory[page] = history;
  return history;
}
