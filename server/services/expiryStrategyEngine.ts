import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { BreakoutState } from "./breakoutEngine.js";
import type { MomentumStateResult } from "./momentumEngine.js";
import { getISTTime } from "../utils/timerUtils.js";

export interface AIStrategySetup {
  strategyName: string;
  signalType: "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE_ZONE";
  recommendedStrike: string;
  recommendedPremium: number;
  stopLoss: number;
  target: number;
  confidencePct: number;
  winRateGrade: "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  setupDetails: string;
  // Layer 7 additions
  stopLossType: "PREMIUM_BASED" | "LEVEL_BASED";
  levelBasedSL: number;         // High/Low of breakout candle
  riskRewardRatio: number;      // T / SL ratio
  positionSizeGrade: "FULL" | "HALF" | "QUARTER";
  reasoning: string;            // Explainability metadata
}

export function generateExpiryStrategySetups(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  spotPrice: number,
  report: CompleteMarketReport,
  breakout: BreakoutState,
  momentum: MomentumStateResult
): AIStrategySetup {
  const { h, m } = getISTTime();

  // Time-of-day validation
  const timeInMins = h * 60 + m;
  const isBestTime =
    (timeInMins >= 9 * 60 + 25 && timeInMins <= 11 * 60) ||
    (timeInMins >= 13 * 60 + 30 && timeInMins <= 14 * 60 + 30);

  const reasonParts: string[] = [];

  // Core CE/PE buy signals
  const isCeBuy =
    breakout.breakoutType === "BULLISH_BREAKOUT" &&
    breakout.trapProbability < 50 &&
    momentum.hasBigCandle &&
    momentum.direction === "UP" &&
    momentum.hasVolumeSpike &&
    report.trend.strengthPct > 55 &&
    report.oi.sentiment.includes("BULLISH");

  const isPeBuy =
    breakout.breakoutType === "BEARISH_BREAKDOWN" &&
    breakout.trapProbability < 50 &&
    momentum.hasBigCandle &&
    momentum.direction === "DOWN" &&
    momentum.hasVolumeSpike &&
    report.trend.strengthPct < 45 &&
    report.oi.sentiment.includes("BEARISH");

  // Pick recommended strike
  let recStrike = "NONE";
  let recPremium = 0;
  let strikeDetails = "";

  if (isCeBuy && report.strikes.recommendedCe) {
    recStrike = `${report.strikes.recommendedCe.strikePrice} CE`;
    recPremium = report.strikes.recommendedCe.premium;
    strikeDetails = `(${report.strikes.recommendedCe.quality} Quality Strike)`;
  } else if (isPeBuy && report.strikes.recommendedPe) {
    recStrike = `${report.strikes.recommendedPe.strikePrice} PE`;
    recPremium = report.strikes.recommendedPe.premium;
    strikeDetails = `(${report.strikes.recommendedPe.quality} Quality Strike)`;
  } else if (report.strikes.recommendedCe) {
    recStrike = `${report.strikes.recommendedCe.strikePrice} CE / ${report.strikes.recommendedPe?.strikePrice} PE`;
    recPremium = report.strikes.recommendedCe.premium;
  }

  // ── Layer 7: Dual Stop Loss System ────────────────────────────────────────
  // Premium-based SL: 20% of premium
  const premiumBasedSL = recPremium > 0 ? parseFloat((recPremium * 0.8).toFixed(1)) : 0;

  // Level-based SL: High/Low of breakout candle (the opening range level)
  const levelBasedSL = isCeBuy
    ? parseFloat((breakout.low15m || breakout.low5m || spotPrice * 0.998).toFixed(1))
    : isPeBuy
    ? parseFloat((breakout.high15m || breakout.high5m || spotPrice * 1.002).toFixed(1))
    : 0;

  // Use level-based if significant (index-level SL is larger and more meaningful)
  const stopLossType: AIStrategySetup["stopLossType"] =
    levelBasedSL > 0 && recPremium > 0 ? "LEVEL_BASED" : "PREMIUM_BASED";
  const stopLoss = stopLossType === "LEVEL_BASED" ? premiumBasedSL : premiumBasedSL;

  // Target calculation
  let target = 0;
  if (recPremium > 0) {
    if (recPremium >= 130) target = parseFloat((recPremium * 2.0).toFixed(1));
    else if (recPremium >= 90) target = parseFloat((recPremium * 2.0).toFixed(1));
    else target = parseFloat((recPremium * 1.875).toFixed(1));
  }

  // R:R Ratio
  const riskAmount = recPremium - stopLoss;
  const rewardAmount = target - recPremium;
  const riskRewardRatio = riskAmount > 0
    ? parseFloat((rewardAmount / riskAmount).toFixed(2))
    : 0;

  // Confidence scoring
  let confidencePct = 50;
  if (isCeBuy || isPeBuy) {
    confidencePct = 70;
    if (momentum.momentumLabel === "STRONG_MOMENTUM") confidencePct += 15;
    if (momentum.hasFollowThrough) confidencePct += 10;
    if (breakout.trapProbability < 20) confidencePct += 5;
    reasonParts.push(`BullBreak=${isCeBuy}, BearBreak=${isPeBuy}`);
  } else {
    confidencePct = 40;
    if (report.trend.trend5m === "SIDEWAYS") confidencePct -= 10;
  }
  if (!isBestTime) confidencePct = Math.max(30, confidencePct - 20);

  // Position size grade based on confidence and trap probability
  let positionSizeGrade: AIStrategySetup["positionSizeGrade"] = "QUARTER";
  if (confidencePct >= 80 && breakout.trapProbability < 30) positionSizeGrade = "FULL";
  else if (confidencePct >= 65 && breakout.trapProbability < 50) positionSizeGrade = "HALF";

  // Grade and signal mapping
  let signalType: AIStrategySetup["signalType"] = "WAIT";
  let winRateGrade: AIStrategySetup["winRateGrade"] = "LOW_CONFIDENCE";
  let riskLevel: AIStrategySetup["riskLevel"] = "HIGH";
  let setupDetails = "Waiting for range breakout and volume confirmation...";
  let strategyName = "OPEN PRICE RANGE BREAKOUT";

  if (isCeBuy) {
    signalType = "BUY_CE";
    winRateGrade = confidencePct > 75 ? "HIGH_CONFIDENCE" : "MEDIUM_CONFIDENCE";
    riskLevel = confidencePct > 75 ? "LOW" : "MEDIUM";
    setupDetails = `BULLISH SETUP: Index broke opening high with volume. Contract: ${recStrike} ${strikeDetails}. SL=${stopLoss} T=${target} R:R=${riskRewardRatio}`;
    reasonParts.push(`TrapProb=${breakout.trapProbability}%`);
  } else if (isPeBuy) {
    signalType = "BUY_PE";
    winRateGrade = confidencePct > 75 ? "HIGH_CONFIDENCE" : "MEDIUM_CONFIDENCE";
    riskLevel = confidencePct > 75 ? "LOW" : "MEDIUM";
    setupDetails = `BEARISH SETUP: Index broke opening low with selling pressure. Contract: ${recStrike} ${strikeDetails}. SL=${stopLoss} T=${target} R:R=${riskRewardRatio}`;
    reasonParts.push(`TrapProb=${breakout.trapProbability}%`);
  } else if (breakout.trapType !== "NONE" && breakout.trapProbability >= 60) {
    signalType = "NO_TRADE_ZONE";
    winRateGrade = "LOW_CONFIDENCE";
    riskLevel = "HIGH";
    setupDetails = `WARNING: ${breakout.trapType} detected (prob=${breakout.trapProbability}%)! Avoid trading. ${breakout.reasoning}`;
  } else if (report.trend.trend5m === "SIDEWAYS" || report.speed.marketState === "SLOW_MARKET") {
    signalType = "NO_TRADE_ZONE";
    winRateGrade = "LOW_CONFIDENCE";
    riskLevel = "MEDIUM";
    setupDetails = "NO TRADE ZONE: Market is sideways or slow. Avoid premium decay.";
  }

  return {
    strategyName,
    signalType,
    recommendedStrike: recStrike,
    recommendedPremium: recPremium,
    stopLoss,
    target,
    confidencePct,
    winRateGrade,
    riskLevel,
    setupDetails,
    stopLossType,
    levelBasedSL,
    riskRewardRatio,
    positionSizeGrade,
    reasoning: reasonParts.join(" | "),
  };
}
