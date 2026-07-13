/**
 * riskEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 16: Risk Engine v1.0
 *
 * Final Capital Protection & Trade Approval Gate.
 * Enforces daily loss limit (₹1,500), position sizing limits, loss streak blocks,
 * and circuit breakers (Level 1 Warning, Level 2 Hard Stop, Level 3 Emergency Halt).
 */

import type { PaperTradingResult } from "./paperTradingEngine";
import type { PerformanceEngineResult }  from "./performanceEngine";

export type CircuitBreakerStatus = "NORMAL" | "WARNING" | "HALT" | "ACTIVE";
export type RiskRecommendation = "INCREASE_RISK" | "NORMAL" | "REDUCE_RISK" | "STOP_TRADING";

export interface RiskEngineResult {
  // New schema fields
  riskScore: number;
  positionSize: number;
  tradeAllowed: boolean;
  circuitBreakerStatus: CircuitBreakerStatus;
  maxAllowedTrades: number;
  dailyLossRemaining: number;
  reason: string[];
  recommendation: RiskRecommendation;
  mustTrade: boolean; // TRUE when <2 trades placed today and market is active

  // Legacy fields for backward compatibility
  circuitBreakerActive: boolean;
  reasons: string[];
  timestamp: number;
}

export interface RiskInput {
  paperTradingOutput: PaperTradingResult;
  performanceResult:  PerformanceEngineResult;
  spotPrice:          number;
  activePage:         "NIFTY" | "SENSEX";
  indiaVix?:          number;
  regimeType?:        string; // from MarketRegimeResult
  aiConfidence?:      number; // from AIDecisionResult
  optionChain?:       any[];
}

const DAILY_LOSS_LIMIT = 3000; // ₹3,000 daily loss budget (circuit breaker threshold)
const ACCOUNT_CAPITAL = 15000; // ₹15,000 account capital base

export function computeRisk(input: RiskInput): RiskEngineResult {
  const { paperTradingOutput, performanceResult, activePage, indiaVix, regimeType, aiConfidence, optionChain } = input;

  const reason: string[] = [];
  let tradeAllowed = true;
  let cbStatus: CircuitBreakerStatus = "NORMAL";
  let recommendation: RiskRecommendation = "NORMAL";

  // ── 1. Daily Loss Limit Check ──
  const todayStr = new Date().toDateString();
  const closedToday = paperTradingOutput.closedTrades.filter(
    t => t.closed_at ? new Date(t.closed_at).toDateString() === todayStr : false
  );
  
  const dailyClosedPnL = closedToday.reduce((sum, t) => sum + t.pnl, 0);
  
  // Calculate open positions floating PnL
  let openFloatingPnL = 0;
  if (optionChain && optionChain.length > 0) {
    for (const pos of paperTradingOutput.openPositions) {
      const strikeData = optionChain.find((s: any) => s.strikePrice === pos.strike);
      let currentPremium = pos.entry_price;
      if (strikeData) {
        currentPremium = pos.direction === "BUY_CE"
          ? (strikeData.ceLtp ?? strikeData.ceBid ?? pos.entry_price)
          : (strikeData.peLtp ?? strikeData.peBid ?? pos.entry_price);
      }
      const pnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;
      openFloatingPnL += pnl;
    }
  }

  const dailyPnL = dailyClosedPnL + openFloatingPnL;
  const dailyLossRemaining = Math.max(0, DAILY_LOSS_LIMIT + dailyPnL);

  const isDailyLimitHit = dailyPnL <= -DAILY_LOSS_LIMIT;

  // ── 2. Position Size Sizing Calculator ──
  const confidence = aiConfidence ?? 75;
  let riskPerTradePct = 0;
  if (confidence > 85) riskPerTradePct = 2.0;
  else if (confidence >= 70) riskPerTradePct = 1.5;
  else if (confidence >= 55) riskPerTradePct = 1.0;
  else riskPerTradePct = 0.5; // AMEX: minimum 0.5% even at low confidence (not blocked)

  let positionSize = ACCOUNT_CAPITAL * (riskPerTradePct / 100); // position size in cash


  // ── 3. Max Consecutive Loss Filter ──
  const isLossStreakBlocked = performanceResult.lossStreak >= 3;
  if (isLossStreakBlocked) {
    tradeAllowed = false;
    reason.push(`Block: Consecutive loss streak limit reached (${performanceResult.lossStreak} losses).`);
  }

  // ── 4. Risk Score Model (0-100) ──
  // riskScore = (drawdown * 0.35) + (volatility * 0.25) + (lossStreak * 0.20) + (marketInstability * 0.20)
  const vix = indiaVix ?? 15;
  
  const drawdownScore = Math.min(100, performanceResult.maxDrawdown * 20); // 5% max drawdown maps to 100
  const volatilityScore = Math.min(100, Math.max(0, (vix - 10) * 8.3)); // Vix of 22 maps to 100
  const lossStreakScore = Math.min(100, performanceResult.lossStreak * 33.3); // 3 consecutive losses maps to 100
  
  let marketInstabilityScore = 30;
  if (regimeType === "VOLATILE") marketInstabilityScore = 85;
  else if (regimeType === "RANGE") marketInstabilityScore = 40;
  else if (regimeType === "BREAKOUT" || regimeType === "BREAKDOWN") marketInstabilityScore = 20;
  else if (regimeType === "TRENDING_BULL" || regimeType === "TRENDING_BEAR") marketInstabilityScore = 10;

  const riskScore = Math.max(0, Math.min(100, Math.round(
    (drawdownScore * 0.35) +
    (volatilityScore * 0.25) +
    (lossStreakScore * 0.20) +
    (marketInstabilityScore * 0.20)
  )));

  // ── 5. Circuit Breaker System Levels ──
  if (isDailyLimitHit || riskScore > 85) {
    // LEVEL 3 — EMERGENCY STOP
    cbStatus = "HALT";
    tradeAllowed = false;
    positionSize = 0;
    recommendation = "STOP_TRADING";
    if (isDailyLimitHit) {
      reason.push(`HALT: Daily loss limit (₹${DAILY_LOSS_LIMIT}) exceeded. Current daily P&L: ₹${dailyPnL}.`);
    } else {
      reason.push(`HALT: Risk score is emergency high (${riskScore}% > 85%). Emergency stop triggered.`);
    }
  } else if (riskScore > 75) {
    // LEVEL 2 — HARD STOP
    cbStatus = "ACTIVE"; // "ACTIVE" indicates circuit breaker active
    tradeAllowed = false;
    positionSize = 0;
    recommendation = "STOP_TRADING";
    reason.push(`HARD STOP: High risk score (${riskScore}% > 75%). Only open positions can be managed.`);
  } else if (riskScore > 60) {
    // LEVEL 1 — WARNING
    cbStatus = "WARNING";
    positionSize = positionSize * 0.5; // reduce sizing by 50%
    recommendation = "REDUCE_RISK";
    reason.push(`WARNING: Volatile risk score (${riskScore}% > 60%). Trading position sizing cut by 50%.`);
  } else {
    cbStatus = "NORMAL";
    recommendation = "NORMAL";
    reason.push(`NORMAL: Risk levels within safety bounds (${riskScore}%). Sizing set to default model.`);
  }

  // ── 6. Trade Approval Gate ──
  // APPROVE TRADE ONLY IF: AI confidence >= 55 AND RiskEngine allows trading AND drawdown < 8.0 AND NOT in HALT/ACTIVE circuit breaker
  // WARNING state allows trading at reduced position size (already cut 50% above)
  const isApproved =
    confidence >= 55 &&
    tradeAllowed &&
    performanceResult.maxDrawdown < 8.0 &&
    (cbStatus === "NORMAL" || cbStatus === "WARNING");

  if (isApproved) {
    reason.push("APPROVED: Final check passed. AMEX safe parameter correlation.");
  } else {
    if (confidence < 55) reason.push(`BLOCKED: AI confidence (${confidence}%) below AMEX 55% approval threshold.`);
    if (performanceResult.maxDrawdown >= 8.0) reason.push(`BLOCKED: Current drawdown (${performanceResult.maxDrawdown}%) above 8% AMEX threshold.`);
    if (cbStatus === "ACTIVE" || cbStatus === "HALT") reason.push(`BLOCKED: Risk Engine is in defensive ${cbStatus} state.`);
  }

  // ── 7. Must-Trade Flag (AMEX Minimum Activity Rule) ──
  // If fewer than 2 trades have fired today and market is active, flag the system to prioritise execution
  const todayTrades = paperTradingOutput.closedTrades.filter(
    t => t.closed_at ? new Date(t.closed_at).toDateString() === todayStr : false
  ).length + paperTradingOutput.openPositions.length;
  const now = new Date();
  const ist = new Date(now.getTime() + 19800000);
  const istMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const isMarketActive = istMins >= 9 * 60 + 15 && istMins <= 15 * 60 + 30;
  const mustTrade = isMarketActive && todayTrades < 2 && cbStatus === "NORMAL";

  const circuitBreakerActive = cbStatus === "ACTIVE" || cbStatus === "HALT";

  return {
    riskScore,
    positionSize: parseFloat(positionSize.toFixed(1)),
    tradeAllowed: isApproved,
    circuitBreakerStatus: cbStatus,
    maxAllowedTrades: isApproved ? (activePage === "NIFTY" ? 99 : 99) : 0, // Unlimited until risk hit
    dailyLossRemaining: parseFloat(dailyLossRemaining.toFixed(1)),
    reason,
    recommendation,
    mustTrade,
    circuitBreakerActive,
    reasons: reason,
    timestamp: Date.now(),
  };
}
