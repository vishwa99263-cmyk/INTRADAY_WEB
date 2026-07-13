/**
 * paperTradingEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 14: Paper Trading Engine — AMEX v2.0
 *
 * AMEX (Adaptive Market Execution Engine) overhaul:
 * - 2-of-6 signal condition gate (replaces strict volatilityScore >= 70 gate)
 * - Micro-signal mode (scoreDiff>10 + volume spike + PCR shift → MICRO_ALERT)
 * - Force-signal: never silent >5 min during market hours
 * - Real LTP lock from optionChain (ceLtp/peLtp instead of entryZone estimate)
 * - 5 trade types: BREAKOUT_TRADE, REVERSAL_TRADE, MOMENTUM_TRADE, MICRO_SCALP, VOLATILITY_EXPLOSION
 * - Confidence gate: 55 (was 65), Alignment gate: 45 (was 70)
 */

import type { EntryZoneResult }           from "./entryZoneEngine";
import type { StrategyAlignmentResult }   from "./strategyAlignmentEngine";
import type { AIDecisionResult }          from "./aiDecisionEngine";
import type { OpportunityResult }         from "./opportunityEngine";
import type { StrategiesEngineOutput }    from "./strategiesEngine";
import type { TEPaperTrade }              from "../types";
import type { MarketTimeEngineResult }    from "./marketTimeEngine";
import type { OptionFlowEngineOutput }    from "./optionFlowEngine";

// ── AMEX Trade Types ──────────────────────────────────────────────────────────
export type AMEXTradeType =
  | "BREAKOUT_TRADE"
  | "REVERSAL_TRADE"
  | "MOMENTUM_TRADE"
  | "MICRO_SCALP"
  | "VOLATILITY_EXPLOSION"
  | "RANGE_BREAK_ALERT"
  | "MICRO_MOVE_ALERT"
  | "FORCE_SIGNAL"
  | "UPTREND_TRADE"
  | "DOWNTREND_TRADE"
  | "OI_TRADE";

export type AMEXSignalMode = "FULL_SIGNAL" | "MICRO_ALERT" | "FORCE_SIGNAL";

// ── Force-signal state (module-level timer) ───────────────────────────────────
let _lastSignalTimestamp = 0;
const FORCE_SIGNAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface AutoTradeSuggestion {
  id: string;
  timestamp: number;
  instrument: string;
  direction: "BUY_CE" | "BUY_PE" | "BULL_SPREAD" | "BEAR_SPREAD";
  strike: number;
  entry_price: number;
  qty: number;
  lot_size: number;
  stop_loss: number;
  target: number;
  notes: string;
  signal_ref?: string;

  // New schema compatibility
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  strategyName: string;
  confidence: number;

  // AMEX extensions
  tradeType: AMEXTradeType;
  signalMode: AMEXSignalMode;
  conditionsMet: number;       // how many of the 6 AMEX conditions fired
  conditionDetails: string[];  // human-readable reasons
  realLtpUsed: boolean;        // true = entry_price came from live optionChain LTP
  status?: string;
}

export interface PaperTradingResult {
  // New schema fields
  openPositions: TEPaperTrade[];
  closedTrades: TEPaperTrade[];
  dailyPnL: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  status: "ACTIVE" | "PAUSED";

  // Legacy fields
  tradeHistory: TEPaperTrade[];
  autoTradeSuggestion: AutoTradeSuggestion | null;
  timestamp: number;

  // AMEX metadata
  amexConditionsMet: number;
  amexSignalMode: AMEXSignalMode;
  secondsSinceLastSignal: number;
  forceSignalPending: boolean;
}

export interface PaperTradingInput {
  entryZoneResult:         EntryZoneResult;
  strategyAlignmentResult: StrategyAlignmentResult;
  aiDecisionResult:        AIDecisionResult;
  opportunityResult:       OpportunityResult;
  strategiesResult:        StrategiesEngineOutput;
  spotPrice:               number;
  activePage:              "NIFTY" | "SENSEX" | "BANKNIFTY";
  dbTrades:                TEPaperTrade[];
  marketTimeResult?:       MarketTimeEngineResult;
  optionFlowResult?:       OptionFlowEngineOutput;
  volatilityScore?:        number;
  optionChain?:            any[];
  // AMEX extras (can be derived from upstream engines)
  momentumScore?:          number;  // from momentumEngine
  pcr?:                    number;  // computed PCR
  scoreDifference?:        number;  // |top10ScoresSum - next15ScoresSum|
  range15mResult?:         any;     // dynamic structural SL
  dayHigh?:                number;  // dynamic structural SL
  dayLow?:                 number;  // dynamic structural SL
  tradingMode?:            "INTRADAY" | "SWING";
}

const INITIAL_CAPITAL = 15000; // ₹15,000 starting capital

// ── Hedge Filter: exclude spread/hedge trades, keep only naked entries ────────
const HEDGE_DIRECTIONS = new Set(["BULL_SPREAD", "BEAR_SPREAD"]);
function isNakedTrade(t: TEPaperTrade): boolean {
  return true;
}

// ── IST time helper ───────────────────────────────────────────────────────────
function getISTMinutes(): number {
  const d = new Date();
  const ist = new Date(d.getTime() + 19800000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function isMarketOpen(): boolean {
  const m = getISTMinutes();
  return m >= 9 * 60 + 15 && m <= 15 * 60 + 30;
}

// ── Classify AMEX trade type from context ────────────────────────────────────
function classifyTradeType(
  direction: "BUY_CE" | "BUY_PE",
  aiConfidence: number,
  volatilityScore: number,
  conditionsMet: number,
  isMicroMode: boolean,
  isForcedSignal: boolean,
  pcr: number,
  momentumScore: number,
  optionFlowResult?: OptionFlowEngineOutput,
  strategyAlignmentResult?: StrategyAlignmentResult
): AMEXTradeType {
  if (isForcedSignal) return "FORCE_SIGNAL";

  // 1. Reversal Trade check
  const isReversal =
    optionFlowResult?.activeDecision.trapRisk === "HIGH" ||
    (direction === "BUY_CE" && (strategyAlignmentResult?.alignmentScore ?? 0) < 50 && momentumScore < 45) ||
    (direction === "BUY_PE" && (strategyAlignmentResult?.alignmentScore ?? 0) < 50 && momentumScore > 55);
  if (isReversal) return "REVERSAL_TRADE";

  // 2. OI Trade check (extreme PCR shift)
  const isOiShift = Math.abs(pcr - 1.0) > 0.15;
  if (isOiShift) return "OI_TRADE";

  // 3. Trend Trade check (strong alignment in dominant direction)
  const isTrending = (strategyAlignmentResult?.alignmentScore ?? 0) >= 55;
  if (isTrending) {
    return direction === "BUY_CE" ? "UPTREND_TRADE" : "DOWNTREND_TRADE";
  }

  // 4. Momentum Trade check
  if (momentumScore > 55 || momentumScore < 45 || conditionsMet >= 3) {
    return "MOMENTUM_TRADE";
  }

  return "MICRO_SCALP";
}

// ─────────────────────────────────────────────────────────────────────────────
export function computePaperTrading(input: PaperTradingInput): PaperTradingResult {
  const {
    entryZoneResult,
    strategyAlignmentResult,
    aiDecisionResult,
    opportunityResult,
    strategiesResult,
    spotPrice,
    activePage,
    dbTrades,
    marketTimeResult,
    optionFlowResult,
    optionChain,
    range15mResult,
    dayHigh,
    dayLow,
  } = input;

  const volatilityScore = input.volatilityScore ?? 0;
  const momentumScore   = input.momentumScore   ?? 0;
  const pcr             = input.pcr             ?? 1.0;
  const scoreDifference = input.scoreDifference ?? 0;
  const tradingMode     = input.tradingMode     ?? "INTRADAY";

  // ── 1. Separate open and closed positions (naked only — exclude hedge/spread) ──
  const openPositions = dbTrades.filter(t => t.status === "OPEN" && t.instrument === activePage && isNakedTrade(t));
  const closedTrades  = dbTrades.filter(t => t.status === "CLOSED" && t.instrument === activePage && isNakedTrade(t));
  const tradeHistory  = [...dbTrades].filter(isNakedTrade).sort((a, b) => b.timestamp - a.timestamp);
  const totalTrades   = closedTrades.length;

  // ── 2. Account Metrics ──
  let winRate = 0, profitFactor = 1.0, maxDrawdown = 0;

  if (totalTrades > 0) {
    const wins = closedTrades.filter(t => t.pnl > 0).length;
    winRate = parseFloat(((wins / totalTrades) * 100).toFixed(1));

    const totalProfit = closedTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const totalLoss   = Math.abs(closedTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    profitFactor = totalLoss === 0 ? (totalProfit > 0 ? 99.0 : 1.0) : parseFloat((totalProfit / totalLoss).toFixed(2));

    let cur = INITIAL_CAPITAL, peak = INITIAL_CAPITAL;
    for (const t of [...closedTrades].sort((a, b) => a.timestamp - b.timestamp)) {
      cur += t.pnl;
      if (cur > peak) peak = cur;
      const dd = ((peak - cur) / peak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    maxDrawdown = parseFloat(maxDrawdown.toFixed(2));
  }

  // ── 3. Daily P&L ──
  const todayStr = new Date().toDateString();
  const dailyPnL = closedTrades
    .filter(t => t.closed_at ? new Date(t.closed_at).toDateString() === todayStr : false)
    .reduce((s, t) => s + t.pnl, 0);

  // ── 4. Risk Filter Gates (EAME blockers unchanged) ──
  const hasSmartMoneyConflict = !!(
    (aiDecisionResult.finalDecision === "BUY_CE" && opportunityResult.topOpportunity?.direction === "PE") ||
    (aiDecisionResult.finalDecision === "BUY_PE" && opportunityResult.topOpportunity?.direction === "CE")
  );

  const isRiskBlocked =
    opportunityResult.marketMode === "NO_TRADE_ZONE" ||
    strategyAlignmentResult.alignmentScore < 30 || // AMEX: only hard-block below 30 (was 60)
    hasSmartMoneyConflict;

  const isTimeBlocked = tradingMode === "INTRADAY" && marketTimeResult !== undefined && !marketTimeResult.isTradingAllowed;

  const istMins = getISTMinutes();
  const isExpiryThetaCrush   = optionFlowResult?.expiryMode === "EXPIRY"     && istMins >= 14 * 60 + 30;
  const isExpiryPreMorningRisk = optionFlowResult?.expiryMode === "EXPIRY_PRE" && istMins < 10 * 60;
  const isTrapBlocked        = optionFlowResult?.activeDecision.trapRisk === "HIGH";
  const isLiquidityBlocked   = optionFlowResult?.activeDecision.liquidity === "LOW";
  const isChainMissing       = !optionFlowResult || optionFlowResult.topStrikes.length === 0;

  const isEameBlocked = isExpiryThetaCrush || isExpiryPreMorningRisk || isTrapBlocked || isLiquidityBlocked || isChainMissing;

  let isForceActive = false;
  try {
    if (typeof window !== "undefined") {
      isForceActive = window.localStorage.getItem("te_force_active") === "true";
    }
  } catch (e) {}

  const status = (isForceActive || tradingMode === "SWING") ? "ACTIVE" : ((isRiskBlocked || isTimeBlocked || isEameBlocked) ? "PAUSED" : "ACTIVE");

  // ── 5. Option chain helpers ──
  const strikeGap    = activePage === "SENSEX" ? 100 : 50;
  const localAtmStrike = Math.round(spotPrice / strikeGap) * strikeGap;
  const atmRow       = optionChain?.find((s: any) => s.strikePrice === localAtmStrike);
  const avgCeVol     = optionChain && optionChain.length > 0 ? optionChain.reduce((s: number, r: any) => s + r.ceVolume, 0) / optionChain.length : 0;
  const avgPeVol     = optionChain && optionChain.length > 0 ? optionChain.reduce((s: number, r: any) => s + r.peVolume, 0) / optionChain.length : 0;

  // ── 6. AMEX 2-of-6 Condition Evaluation ──────────────────────────────────
  const c1_momentum    = momentumScore > 55;
  const c2_oiShift     = !!(atmRow && (Math.abs(atmRow.ceOIChange) > 0 || Math.abs(atmRow.peOIChange) > 0));
  const c3_pcrExtreme  = pcr < 0.92 || pcr > 1.05;
  const c4_volumeSpike = !!(atmRow && (atmRow.ceVolume > avgCeVol * 1.15 || atmRow.peVolume > avgPeVol * 1.15));
  const c5_scoreDiff   = scoreDifference > 20;
  const c6_smartMoney  = !!(optionFlowResult?.activeDecision.smartMoney && optionFlowResult.activeDecision.smartMoney !== "NEUTRAL");

  const conditionDetails: string[] = [];
  if (c1_momentum)   conditionDetails.push(`✔ Momentum score > 55 (${momentumScore.toFixed(0)})`);
  if (c2_oiShift)    conditionDetails.push("✔ OI shift confirmed");
  if (c3_pcrExtreme) conditionDetails.push(`✔ PCR extreme (${pcr.toFixed(2)})`);
  if (c4_volumeSpike) conditionDetails.push("✔ Volume spike detected");
  if (c5_scoreDiff)  conditionDetails.push(`✔ Score difference > 20 (${scoreDifference.toFixed(0)})`);
  if (c6_smartMoney) conditionDetails.push(`✔ Smart money flow active (${optionFlowResult?.activeDecision.smartMoney})`);

  const conditionsMet = [c1_momentum, c2_oiShift, c3_pcrExtreme, c4_volumeSpike, c5_scoreDiff, c6_smartMoney].filter(Boolean).length;
  const amexEntryValid = conditionsMet >= 2;

  // ── 7. Micro-signal conditions ──
  const micro_scoreDiff  = scoreDifference > 10;
  const micro_volSpike   = c4_volumeSpike;
  const micro_pcrShift   = pcr < 0.96 || pcr > 1.02;
  const microConditions  = [micro_scoreDiff, micro_volSpike, micro_pcrShift].filter(Boolean).length;
  const isMicroMode      = !amexEntryValid && microConditions >= 2;

  // ── 8. Force-signal check (never silent >5 min during market hours) ──
  const nowMs = Date.now();
  const secondsSinceLastSignal = Math.floor((nowMs - _lastSignalTimestamp) / 1000);
  const forceSignalPending = isMarketOpen() && !isTimeBlocked && !isRiskBlocked &&
    _lastSignalTimestamp > 0 && (nowMs - _lastSignalTimestamp) >= FORCE_SIGNAL_INTERVAL_MS;

  // ── 9. Auto-Trade Suggestion ──────────────────────────────────────────────
  let autoTradeSuggestion: AutoTradeSuggestion | null = null;
  const hasOpen   = openPositions.length > 0;
  const decision  = aiDecisionResult.finalDecision;
  const isCE      = decision === "BUY_CE";
  const isPE      = decision === "BUY_PE";
  const isActionable = isCE || isPE;

  // Effective confidence threshold: 55 (was 65)
  const confOk = aiDecisionResult.decisionConfidence >= 55;
  // Effective alignment threshold: 45 (was 70)
  const alignOk = strategyAlignmentResult.alignmentScore >= 45;

  // Primary AMEX signal
  const canEnterFull = isActionable && confOk && alignOk && amexEntryValid && !hasOpen && !isRiskBlocked && !isTimeBlocked && !isEameBlocked;
  // Micro signal fallback
  const canEnterMicro = isActionable && !hasOpen && !isTimeBlocked && !isRiskBlocked && isMicroMode;
  // Force signal (if system has been silent too long)
  const canEnterForce = isActionable && !hasOpen && !isTimeBlocked && !isRiskBlocked && forceSignalPending;

  if (canEnterFull || canEnterMicro || canEnterForce) {
    const isMicro  = !canEnterFull && canEnterMicro;
    const isForced = !canEnterFull && !canEnterMicro && canEnterForce;

    const signalMode: AMEXSignalMode = isForced ? "FORCE_SIGNAL" : isMicro ? "MICRO_ALERT" : "FULL_SIGNAL";

    // ATM strike from optionFlowResult or computed
    let strike = optionFlowResult?.activeDecision.strike || localAtmStrike;
    const strikeRow = optionChain?.find((s: any) => s.strikePrice === strike);
    const strikeGap = activePage === "SENSEX" ? 100 : 50;

    let realLtp = 0;
    let realLtpUsed = false;

    if (tradingMode === "SWING" && strike) {
      // For Swing mode, we do BULL_SPREAD (Calls) or BEAR_SPREAD (Puts)
      const strikeShort = isCE ? strike + strikeGap : strike - strikeGap;
      const strikeRowLong = strikeRow;
      const strikeRowShort = optionChain?.find((s: any) => s.strikePrice === strikeShort);
      
      const ltpLong = isCE
        ? (strikeRowLong?.ceLtp ?? strikeRowLong?.ceBid ?? entryZoneResult.entryPrice)
        : (strikeRowLong?.peLtp ?? strikeRowLong?.peBid ?? entryZoneResult.entryPrice);
        
      const ltpShort = isCE
        ? (strikeRowShort?.ceLtp ?? strikeRowShort?.ceBid ?? entryZoneResult.entryPrice * 0.6)
        : (strikeRowShort?.peLtp ?? strikeRowShort?.peBid ?? entryZoneResult.entryPrice * 0.6);
        
      realLtp = ltpLong - ltpShort;
      realLtpUsed = !!(strikeRowLong && strikeRowShort && (isCE ? (strikeRowLong.ceLtp && strikeRowShort.ceLtp) : (strikeRowLong.peLtp && strikeRowShort.peLtp)));
      
      if (realLtp <= 0) {
        realLtp = entryZoneResult.entryPrice * 0.4; // Fallback to 40% of naked premium for spread
      }
    } else {
      realLtp = isCE
        ? (strikeRow?.ceLtp ?? strikeRow?.ceBid ?? entryZoneResult.entryPrice)
        : (strikeRow?.peLtp ?? strikeRow?.peBid ?? entryZoneResult.entryPrice);
      realLtpUsed = !!(strikeRow && (isCE ? strikeRow.ceLtp : strikeRow.peLtp));
    }

    const lot_size = activePage === "NIFTY" ? 65 : (activePage === "BANKNIFTY" ? 35 : 20);
    const scaleMultiplier = (strategiesResult.activeStrategyConfig?.leverageSizing ?? 1.0) * (optionFlowResult?.riskMultiplier ?? 1.0);
    
    // ── 1-LOT STRICT MODE ENFORCEMENT ──
    let isStrictOneLot = true; // default to true for safety
    try {
      if (typeof window !== "undefined") {
        const riskSettings = JSON.parse(window.localStorage.getItem("te_risk_settings") || "{}");
        isStrictOneLot = riskSettings.strictOneLotMode !== false; // true if missing or true
      }
    } catch (e) {
      // ignore
    }
    
    const qty = isStrictOneLot ? 1 : Math.max(1, Math.round(scaleMultiplier));
    const entryPrice = realLtp > 0 ? realLtp : (tradingMode === "SWING" ? entryZoneResult.entryPrice * 0.4 : entryZoneResult.entryPrice);

    // SL & Target — Dynamic Level-Based Target (v2.0)
    // Uses OI walls as S/R levels, scaled by option delta for premium-level targets
    const strictSL = activePage === "SENSEX" ? 30 : 10; // Max 10 points premium risk for Nifty, 30 points for Sensex

    // Compute OI walls (S/R) from option chain
    let callWall = spotPrice + 200, putWall = spotPrice - 200;
    if (optionChain && optionChain.length > 0) {
      let maxCallOI = 0, maxPutOI = 0;
      for (const s of optionChain as any[]) {
        if ((s.ceOI ?? 0) > maxCallOI) { maxCallOI = s.ceOI; callWall = s.strikePrice; }
        if ((s.peOI ?? 0) > maxPutOI) { maxPutOI = s.peOI; putWall = s.strikePrice; }
      }
    }

    // Get real delta from option chain (fallback 0.5 for ATM)
    const rawDelta = isCE ? strikeRow?.ceDelta : strikeRow?.peDelta;
    const absDelta = Math.abs(Number(rawDelta) || 0);
    const delta = (absDelta >= 0.05 && absDelta <= 1.0) ? absDelta : 0.5;

    // Spot distance to S/R level, scaled by delta
    const spotDistanceToSR = isCE
      ? Math.max(0, callWall - spotPrice)
      : Math.max(0, spotPrice - putWall);
    const deltaScaledTarget = spotDistanceToSR * delta;

    let vixMultiplier = 1.0;
    const vix = volatilityScore;
    if (vix > 18) {
      vixMultiplier = 1.2;
    } else if (vix < 12) {
      vixMultiplier = 0.8;
    }

    // Clamp target to safe premium range
    const minTarget = activePage === "SENSEX" ? 30 : 15;
    const maxTarget = activePage === "SENSEX" ? 80 : 40;
    let dynamicTarget = Math.max(minTarget, Math.min(maxTarget, deltaScaledTarget)) * vixMultiplier;

    // Dynamic Stop Loss based on 5m/15m extremes
    const low5m = dayLow ?? 0;
    const high5m = dayHigh ?? 0;
    const low15m = range15mResult?.rangeLow ?? 0;
    const high15m = range15mResult?.rangeHigh ?? 0;

    const supportPrice = (low5m > 0 && low15m > 0)
      ? Math.min(low5m, low15m)
      : (low15m > 0 ? low15m : (low5m > 0 ? low5m : spotPrice * 0.998));

    const resistancePrice = (high5m > 0 && high15m > 0)
      ? Math.max(high5m, high15m)
      : (high15m > 0 ? high15m : (high5m > 0 ? high5m : spotPrice * 1.002));

    const indexDistance = isCE
      ? Math.max(0, spotPrice - supportPrice)
      : Math.max(0, resistancePrice - spotPrice);

    let premiumSL = indexDistance * delta * vixMultiplier;

    // Clamping limits based on activePage index
    let minSL = 10, maxSL = 25;
    if (activePage === "SENSEX") {
      minSL = 15;
      maxSL = 45;
    } else if (activePage === "BANKNIFTY") {
      minSL = 10;
      maxSL = 25;
    } else { // NIFTY
      minSL = 6;
      maxSL = 18;
    }

    let dynamicSLPoints = Math.max(minSL, Math.min(maxSL, premiumSL));

    const effectiveEntryPrice = tradingMode === "SWING" ? entryPrice * 0.93 : entryPrice;
    let stopLoss = effectiveEntryPrice - dynamicSLPoints;
    let target = effectiveEntryPrice + dynamicTarget;

    if (tradingMode === "SWING") {
      const strikeGap = activePage === "SENSEX" ? 100 : 50;
      const maxPossibleGain = strikeGap - effectiveEntryPrice;
      // Target: net entry premium + min(dynamicTarget, (strikeGap - net entry premium) * 0.6)
      target = effectiveEntryPrice + Math.min(dynamicTarget * 2.5, maxPossibleGain * 0.6);
      // Stop Loss: net entry premium - min(dynamicSLPoints, net entry premium * 0.5)
      stopLoss = effectiveEntryPrice - Math.min(dynamicSLPoints * 2.0, effectiveEntryPrice * 0.5);
    }

    // Trade type classification
    const tradeType = classifyTradeType(
      isCE ? "BUY_CE" : "BUY_PE",
      aiDecisionResult.decisionConfidence,
      volatilityScore,
      conditionsMet,
      isMicro,
      isForced,
      pcr,
      momentumScore,
      optionFlowResult,
      strategyAlignmentResult
    );

    // Notes
    let noteConditions = isMicro
      ? `Micro Alert: ${microConditions}/3 micro conditions | Possible 20–30 pt move`
      : isForced
      ? `Force Signal: system was silent for ${Math.floor(secondsSinceLastSignal / 60)}m — RANGE BREAK / MICRO MOVE`
      : `AMEX ${conditionsMet}/6 conditions met | ${strategiesResult.activeStrategy}`;

    if (tradingMode === "SWING") {
      noteConditions += ` [${isCE ? "Bull Call Spread" : "Bear Put Spread"} Limit Pending Order - 7% Discount]`;
    }

    const strategyName = tradeType;
    const direction = tradingMode === "SWING"
      ? (isCE ? "BULL_SPREAD" : "BEAR_SPREAD")
      : (isCE ? "BUY_CE" : "BUY_PE");

    autoTradeSuggestion = {
      id: `amex-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: nowMs,
      instrument: activePage,
      direction: direction as any,
      strike,
      entry_price: parseFloat(effectiveEntryPrice.toFixed(1)),
      qty,
      lot_size,
      stop_loss: parseFloat(stopLoss.toFixed(1)),
      target:    parseFloat(target.toFixed(1)),
      notes: noteConditions,
      signal_ref: signalMode,

      // New schema
      entryPrice:   parseFloat(effectiveEntryPrice.toFixed(1)),
      stopLoss:     parseFloat(stopLoss.toFixed(1)),
      targetPrice:  parseFloat(target.toFixed(1)),
      strategyName,
      confidence:   aiDecisionResult.decisionConfidence,

      // AMEX extensions
      tradeType,
      signalMode,
      conditionsMet,
      conditionDetails,
      realLtpUsed,
      status: tradingMode === "SWING" ? "PENDING" : "OPEN"
    };

    // Update module-level signal timer
    _lastSignalTimestamp = nowMs;
  }

  // Also update timer on initial load so force-signal starts counting from first run
  if (_lastSignalTimestamp === 0 && isMarketOpen()) {
    _lastSignalTimestamp = nowMs;
  }

  return {
    openPositions,
    closedTrades,
    dailyPnL:   parseFloat(dailyPnL.toFixed(1)),
    totalTrades,
    winRate,
    profitFactor,
    maxDrawdown,
    status,
    tradeHistory,
    autoTradeSuggestion,
    timestamp: nowMs,

    amexConditionsMet:    conditionsMet,
    amexSignalMode:       autoTradeSuggestion?.signalMode ?? "FULL_SIGNAL",
    secondsSinceLastSignal,
    forceSignalPending,
  };
}
