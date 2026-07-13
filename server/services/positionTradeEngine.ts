/**
 * positionTradeEngine.ts — Layer 12: Position Trade Manager
 *
 * Manages multi-day option buy trades (2–5 day holds).
 * Key differences from intraday (Layer 9 autoTradingService):
 *
 *   Feature         Intraday          Position (this)
 *   ─────────────────────────────────────────────────────
 *   SL              20% of premium    40–50% of premium
 *   Target          2x premium        3x–5x premium
 *   Trail trigger   10–30 pts         40–120 pts
 *   Hold            Same day          2–5 days
 *   Expiry          Current week      Next week / Monthly
 *   VIX filter      Not used          VIX < 16 preferred
 *   Theta           Not tracked       Daily burn tracked
 *   Daily bias      Not used          Requires BULL/STRONG_BULL
 *
 * VIX guidance:
 *   VIX < 13  → CHEAP premiums, ideal position buy
 *   VIX 13–18 → NORMAL, proceed
 *   VIX 18–25 → EXPENSIVE, reduce size or skip
 *   VIX > 25  → AVOID buying options (sellers win)
 */

import fs   from "fs";
import path from "path";
import { getISTTime } from "../utils/timerUtils.js";
import type { DailyBias } from "./positionStructureEngine.js";
import { getSignalMemoryStats } from "./signalMemory.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type PositionDirection = "BUY_CE" | "BUY_PE";
export type PositionStatus    = "ACTIVE" | "CLOSED_PROFIT" | "CLOSED_LOSS" | "EXPIRED";
export type PositionExitReason = "TARGET1" | "TARGET2" | "SL_HIT" | "MANUAL" | "EXPIRY" | "BIAS_REVERSAL" | "EXPIRED";

export interface PositionTrade {
  id:             string;
  instrument:     "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction:      PositionDirection;
  strike:         number;
  expiry:         string;           // "26-JUN-2026"
  optionSymbol:   string;           // Fyers symbol e.g. NSE:NIFTY25JUN24500CE-OPT
  entryDate:      string;           // "YYYY-MM-DD"
  entryPrice:     number;           // Premium paid
  lots:           number;
  lotSize:        number;
  totalPremium:   number;           // entryPrice * lots * lotSize
  slPrice:        number;           // 40-50% SL (e.g. entry 100 → SL 55)
  target1:        number;           // 50% gain (entry 100 → T1 150)
  target2:        number;           // 100% gain (entry 100 → T2 200)
  currentPrice:   number;           // Latest LTP
  peakPrice:      number;           // Highest LTP seen (for trailing)
  trailSl:        number;           // Dynamic trailing SL
  holdDays:       number;           // Auto-calculated days since entry
  dailyTheta:     number;           // Estimated daily premium decay
  breakevenDays:  number;           // Days before theta kills the trade
  unrealizedPnL:  number;           // (currentPrice - entryPrice) * lots * lotSize
  vixAtEntry:     number;           // India VIX when trade was entered
  dailyBiasAtEntry: string;         // BULL / STRONG_BULL at entry
  status:         PositionStatus;
  exitDate?:      string;
  exitPrice?:     number;
  exitTime?:      number;
  realizedPnL?:   number;
  exitReason?:    PositionExitReason;
  hedged?:        boolean;
  t1Exited?:      boolean;
  expiryDate?:    string;           // ISO date string for option expiry
  notes:          string;
  createdAt:      number;
  updatedAt:      number;
}

export interface PositionTradeSetup {
  instrument:   "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction:    PositionDirection;
  strike:       number;
  expiry:       string;
  optionSymbol: string;
  entryPrice:   number;
  lots:         number;
  lotSize:      number;
  slPrice:      number;
  target1:      number;
  target2:      number;
  dailyTheta:   number;
  breakevenDays: number;
  vixAtEntry:   number;
  dailyBiasAtEntry: string;
  reasoning:    string;
  riskReward:   number;
}

export interface PositionEvaluation {
  canTrade:      boolean;
  reason:        string;
  vixCategory:   "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  setupQuality:  "EXCELLENT" | "GOOD" | "MARGINAL" | "SKIP";
  suggestedLots: number;           // Reduce lots if VIX high or bias weak
}

// ── Persistence ────────────────────────────────────────────────────────────────

const POSITION_DB_PATH = path.join(process.cwd(), "server", "storage", "position_trades.json");

function loadPositionTrades(): PositionTrade[] {
  try {
    if (fs.existsSync(POSITION_DB_PATH)) {
      return JSON.parse(fs.readFileSync(POSITION_DB_PATH, "utf8"));
    }
  } catch (e) {
    console.error("[PositionEngine] Failed to load position_trades.json:", e);
  }
  return [];
}

function savePositionTrades(trades: PositionTrade[]): void {
  try {
    fs.writeFileSync(POSITION_DB_PATH, JSON.stringify(trades, null, 2), "utf8");
  } catch (e) {
    console.error("[PositionEngine] Failed to save position_trades.json:", e);
  }
}

// ── In-memory store ────────────────────────────────────────────────────────────

let _trades: PositionTrade[] = loadPositionTrades();

// ── Theta Estimate ─────────────────────────────────────────────────────────────

/**
 * Rough daily theta estimate.
 * Options decay faster as DTE decreases (theta accelerates near expiry).
 *
 * Formula: theta ≈ premium / (DTE × 1.4) × vix_multiplier
 * This is a simplified estimate, not Black-Scholes.
 */
export function estimateDailyTheta(
  premium: number,
  daysToExpiry: number,
  vix: number,
): number {
  if (daysToExpiry <= 0 || premium <= 0) return 0;
  const rawTheta = premium / (daysToExpiry * 1.4);
  const vixMult  = vix > 20 ? 1.35 : vix < 13 ? 0.80 : 1.0;
  return parseFloat((rawTheta * vixMult).toFixed(1));
}

/**
 * Days until premium is fully decayed (rough breakeven days needed).
 * If you're paying 150 in premium and theta is 15/day → 10 days.
 * BUT options won't go to 0 unless OTM. This is a caution indicator.
 */
function calcBreakevenDays(premium: number, theta: number): number {
  if (theta <= 0) return 999;
  return Math.round(premium / theta);
}

// ── VIX Evaluation ────────────────────────────────────────────────────────────

/**
 * Evaluates whether conditions are right for a position buy.
 * Returns a full evaluation with quality grade and suggested lot size.
 */
export function evaluatePositionConditions(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  vix: number,
  dailyBias: DailyBias | null,
  defaultLots: number,
): PositionEvaluation {
  const reasons: string[] = [];
  let canTrade = true;
  let setupQuality: PositionEvaluation["setupQuality"] = "GOOD";
  let suggestedLots = defaultLots;

  // Layer 8: Signal Intelligence checks
  const stats = getSignalMemoryStats(instrument);
  const ist = getISTTime(); // Assuming getISTTime is available and returns date object or use standard date if configured for IST
  const hour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  
  if (stats.suggestAvoidHighVix && vix >= 18) {
    canTrade = false;
    reasons.push(`Layer 8 Block: High VIX historically poor for positional. AVOID.`);
    setupQuality = "SKIP";
    return { canTrade, reason: reasons.join(" | "), vixCategory: "HIGH", setupQuality, suggestedLots: 0 };
  }
  
  if (stats.suggestAvoidMorning && hour < 12) {
    canTrade = false;
    reasons.push(`Layer 8 Block: Morning trades have low win rate. Wait for Afternoon.`);
    setupQuality = "SKIP";
    return { canTrade, reason: reasons.join(" | "), vixCategory: "NORMAL", setupQuality, suggestedLots: 0 };
  }

  // VIX categorization
  const vixCategory: PositionEvaluation["vixCategory"] =
    vix <= 0   ? "NORMAL" :
    vix < 13   ? "LOW"    :
    vix < 18   ? "NORMAL" :
    vix < 25   ? "HIGH"   :
                 "EXTREME";

  // VIX check
  if (vixCategory === "EXTREME") {
    canTrade = false;
    reasons.push(`VIX=${vix.toFixed(1)} EXTREME — Option premiums too expensive. AVOID buying.`);
    setupQuality = "SKIP";
  } else if (vixCategory === "HIGH") {
    reasons.push(`VIX=${vix.toFixed(1)} HIGH — Reduced to half lots. Premium expensive.`);
    suggestedLots = Math.max(1, Math.floor(defaultLots / 2));
    setupQuality = "MARGINAL";
  } else if (vixCategory === "LOW") {
    reasons.push(`VIX=${vix.toFixed(1)} LOW ✅ — Cheap premiums, EXCELLENT time for position buy.`);
    setupQuality = "EXCELLENT";
  } else {
    reasons.push(`VIX=${vix.toFixed(1)} NORMAL ✅`);
  }

  // Daily bias check
  if (!dailyBias) {
    reasons.push("Daily bias not computed yet — proceed with caution.");
  } else if (dailyBias.bias === "NEUTRAL") {
    reasons.push("Market NEUTRAL (daily) — reduce size.");
    suggestedLots = Math.max(1, Math.floor(suggestedLots / 2));
    if (setupQuality === "GOOD") setupQuality = "MARGINAL";
  } else if (dailyBias.bias === "STRONG_BULL" || dailyBias.bias === "STRONG_BEAR") {
    reasons.push(`Daily bias ${dailyBias.bias} ✅ — Strong alignment, full size ok.`);
    if (setupQuality === "GOOD") setupQuality = "EXCELLENT";
  } else if (dailyBias.bias === "BULL" || dailyBias.bias === "BEAR") {
    reasons.push(`Daily bias ${dailyBias.bias} ✅ — Proceed normally.`);
  }

  // No trade if conflicting bias
  if (dailyBias && dailyBias.bias === "STRONG_BEAR" && canTrade) {
    // If STRONG_BEAR but trying to BUY CE → warn
    // (Caller decides direction, this just flags)
    reasons.push("NOTE: STRONG_BEAR bias — only BUY_PE setups recommended.");
  }

  return { canTrade, reason: reasons.join(" | "), vixCategory, setupQuality, suggestedLots };
}

// ── Strike & SL/Target Calculator ─────────────────────────────────────────────

/**
 * Calculates position trade parameters from a given entry premium.
 *
 * SL:      50% below entry (wider than intraday's 20%)
 * Target1: 50% above entry (book partial)
 * Target2: 100% above entry (double money)
 */
export function calcPositionSetup(
  instrument:   "NIFTY" | "BANKNIFTY" | "SENSEX",
  direction:    PositionDirection,
  strike:       number,
  expiry:       string,
  optionSymbol: string,
  entryPrice:   number,
  lots:         number,
  lotSize:      number,
  vix:          number,
  daysToExpiry: number,
  dailyBias:    DailyBias | null,
): PositionTradeSetup {
  const slPrice  = parseFloat((entryPrice * 0.50).toFixed(1));  // 50% SL
  const target1  = parseFloat((entryPrice * 1.50).toFixed(1));  // 50% gain
  const target2  = parseFloat((entryPrice * 2.00).toFixed(1));  // 100% gain
  const riskReward = parseFloat(((target2 - entryPrice) / (entryPrice - slPrice)).toFixed(2));

  const dailyTheta    = estimateDailyTheta(entryPrice, daysToExpiry, vix);
  const breakevenDays = calcBreakevenDays(entryPrice, dailyTheta);

  const reasonParts: string[] = [
    `Strike=${strike} ${direction === "BUY_CE" ? "CE" : "PE"}`,
    `Expiry=${expiry}`,
    `Entry=₹${entryPrice}`,
    `SL=₹${slPrice} (50%)`,
    `T1=₹${target1} T2=₹${target2}`,
    `R:R=${riskReward}`,
    `Theta=-₹${dailyTheta}/day`,
    `DTE=${daysToExpiry} days`,
    `VIX=${vix > 0 ? vix.toFixed(1) : "N/A"}`,
    `DailyBias=${dailyBias?.bias ?? "N/A"}`,
  ];

  return {
    instrument,
    direction,
    strike,
    expiry,
    optionSymbol,
    entryPrice,
    lots,
    lotSize,
    slPrice,
    target1,
    target2,
    dailyTheta,
    breakevenDays,
    vixAtEntry: vix,
    dailyBiasAtEntry: dailyBias?.bias ?? "UNKNOWN",
    reasoning: reasonParts.join(" | "),
    riskReward,
  };
}

// ── Trade CRUD ─────────────────────────────────────────────────────────────────

/** Opens a new position trade from a setup. */
export function openPositionTrade(setup: PositionTradeSetup): PositionTrade {
  const { d, m: mo, y } = getISTDateParts();
  const entryDate = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const trade: PositionTrade = {
    id:           `PT_${Date.now()}`,
    instrument:   setup.instrument,
    direction:    setup.direction,
    strike:       setup.strike,
    expiry:       setup.expiry,
    optionSymbol: setup.optionSymbol,
    entryDate,
    entryPrice:   setup.entryPrice,
    lots:         setup.lots,
    lotSize:      setup.lotSize,
    totalPremium: setup.entryPrice * setup.lots * setup.lotSize,
    slPrice:      setup.slPrice,
    target1:      setup.target1,
    target2:      setup.target2,
    currentPrice: setup.entryPrice,
    peakPrice:    setup.entryPrice,
    trailSl:      setup.slPrice,
    holdDays:     0,
    dailyTheta:   setup.dailyTheta,
    breakevenDays: setup.breakevenDays,
    unrealizedPnL: 0,
    vixAtEntry:   setup.vixAtEntry,
    dailyBiasAtEntry: setup.dailyBiasAtEntry,
    status:       "ACTIVE",
    notes:        "",
    createdAt:    Date.now(),
    updatedAt:    Date.now(),
  };

  _trades.push(trade);
  savePositionTrades(_trades);

  console.log(`[PositionEngine] ✅ Opened: ${trade.id} | ${trade.instrument} ${trade.direction} ${trade.strike} @${trade.entryPrice}`);
  return trade;
}

/** Updates current price, trail SL, and P&L for all active trades. */
export function updatePositionPrices(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  symbol: string,
  currentLtp: number,
  currentBias?: string,
): PositionTrade[] {
  const updated: PositionTrade[] = [];

  for (const trade of _trades) {
    if (trade.status !== "ACTIVE") continue;
    if (trade.instrument !== instrument) continue;
    if (trade.optionSymbol !== symbol) continue;

    trade.currentPrice  = currentLtp;
    trade.unrealizedPnL = parseFloat(
      ((currentLtp - trade.entryPrice) * trade.lots * trade.lotSize).toFixed(0)
    );

    // Recalculate hold days
    const entryMs = new Date(trade.entryDate).getTime();
    trade.holdDays = Math.floor((Date.now() - entryMs) / (24 * 3600 * 1000));

    // Peak price tracking
    if (currentLtp > trade.peakPrice) {
      trade.peakPrice = currentLtp;
    }

    // Position trail SL logic:
    // Once premium > entry + trigger, move SL to entry + beOffset
    // After that, trail 20pts (NIFTY) behind peak
    const trailTrigger = getPositionTrailTrigger(instrument);
    const trailOffset  = getPositionTrailOffset(instrument);
    const beOffset     = getPositionBeOffset(instrument);

    if (trade.peakPrice >= trade.entryPrice + trailTrigger) {
      // Breakeven mode: SL = entry + beOffset minimum
      const beLevel = trade.entryPrice + beOffset;
      // Trail: SL = peak - trailOffset
      const trailLevel = trade.peakPrice - trailOffset;
      // Use max of both (never move SL backwards)
      trade.trailSl = parseFloat(Math.max(trade.trailSl, beLevel, trailLevel).toFixed(1));
    }

    // Auto-Hedging Trigger (10x System Feature)
    // If trade is in massive profit (> 100%), auto-hedge to protect overnight risk
    if (currentLtp >= trade.entryPrice * 2 && !(trade.notes || "").includes("HEDGED")) {
       trade.hedged = true;
       trade.notes = trade.notes ? trade.notes + " | HEDGED" : "HEDGED";
       console.log(`[PositionEngine] 🛡️ AUTO-HEDGE TRIGGERED for ${trade.id}. Locking in gains overnight.`);
    }

    // T1 Partial Exit — book 50% lots at Target 1
    if (currentLtp >= trade.target1 && !trade.t1Exited && trade.status === "ACTIVE") {
      trade.t1Exited = true;
      trade.lots = Math.max(1, Math.floor(trade.lots / 2));
      trade.notes = trade.notes
        ? trade.notes + ` | T1 HIT @ ₹${trade.currentPrice} — Partial exit (50% lots)`
        : `T1 HIT @ ₹${trade.currentPrice} — Partial exit (50% lots)`;
      console.log(`[POSITION] T1 partial exit for ${trade.id}`);
    }

    // Expiry Auto-Close — close trade if option has expired
    if (trade.expiryDate && Date.now() > new Date(trade.expiryDate).getTime() && trade.status === "ACTIVE") {
      trade.status = "CLOSED" as PositionStatus;
      trade.exitReason = "EXPIRED";
      trade.exitPrice = trade.currentPrice;
      trade.exitTime = Date.now();
      trade.realizedPnL = parseFloat(
        ((trade.currentPrice - trade.entryPrice) * trade.lots * trade.lotSize).toFixed(0)
      );
      console.log(`[POSITION] Auto-closed expired trade ${trade.id}`);
    }

    // Bias Reversal Exit — close if market bias flipped and held ≥ 1 day
    if (
      currentBias &&
      trade.dailyBiasAtEntry &&
      trade.holdDays >= 1 &&
      trade.status === "ACTIVE" &&
      (
        (trade.dailyBiasAtEntry.includes("BULL") && currentBias.includes("BEAR")) ||
        (trade.dailyBiasAtEntry.includes("BEAR") && currentBias.includes("BULL"))
      )
    ) {
      trade.status = "CLOSED" as PositionStatus;
      trade.exitReason = "BIAS_REVERSAL";
      trade.exitPrice = trade.currentPrice;
      trade.exitTime = Date.now();
      trade.realizedPnL = parseFloat(
        ((trade.currentPrice - trade.entryPrice) * trade.lots * trade.lotSize).toFixed(0)
      );
      console.log(`[POSITION] Bias reversal exit for ${trade.id} — was ${trade.dailyBiasAtEntry}, now ${currentBias}`);
    }

    // Auto-close: SL hit
    if (currentLtp <= trade.trailSl) {
      trade.status    = "CLOSED_LOSS";
      trade.exitPrice = currentLtp;
      trade.exitDate  = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      trade.realizedPnL = parseFloat(
        ((currentLtp - trade.entryPrice) * trade.lots * trade.lotSize).toFixed(0)
      );
      trade.exitReason = "SL_HIT";
      console.log(`[PositionEngine] ❌ SL HIT: ${trade.id} @ ₹${currentLtp} | P&L: ${trade.realizedPnL}`);
    }

    // Auto-close: Target 2 hit
    if (currentLtp >= trade.target2) {
      trade.status    = "CLOSED_PROFIT";
      trade.exitPrice = currentLtp;
      trade.exitDate  = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      trade.realizedPnL = parseFloat(
        ((currentLtp - trade.entryPrice) * trade.lots * trade.lotSize).toFixed(0)
      );
      trade.exitReason = "TARGET2";
      console.log(`[PositionEngine] 🎯 TARGET2 HIT: ${trade.id} @ ₹${currentLtp} | P&L: +${trade.realizedPnL}`);
    }

    trade.updatedAt = Date.now();
    updated.push(trade);
  }

  if (updated.length > 0) savePositionTrades(_trades);
  return updated;
}

/** Manually closes a position trade. */
export function closePositionTrade(
  id: string,
  exitPrice: number,
  reason: PositionExitReason = "MANUAL",
): PositionTrade | null {
  const trade = _trades.find(t => t.id === id);
  if (!trade || trade.status !== "ACTIVE") return null;

  trade.status     = exitPrice >= trade.entryPrice ? "CLOSED_PROFIT" : "CLOSED_LOSS";
  trade.exitPrice  = exitPrice;
  trade.exitDate   = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  trade.realizedPnL = parseFloat(
    ((exitPrice - trade.entryPrice) * trade.lots * trade.lotSize).toFixed(0)
  );
  trade.exitReason  = reason;
  trade.updatedAt   = Date.now();

  savePositionTrades(_trades);
  console.log(`[PositionEngine] 🔒 Closed: ${trade.id} @ ₹${exitPrice} | P&L: ${trade.realizedPnL} | Reason: ${reason}`);
  return trade;
}

/** Returns all position trades (optionally filtered by status). */
export function getPositionTrades(
  status?: PositionStatus | "ALL",
): PositionTrade[] {
  if (!status || status === "ALL") return [..._trades];
  return _trades.filter(t => t.status === status);
}

/** Updates notes on a trade. */
export function updatePositionNotes(id: string, notes: string): void {
  const trade = _trades.find(t => t.id === id);
  if (trade) {
    trade.notes = notes;
    trade.updatedAt = Date.now();
    savePositionTrades(_trades);
  }
}

// ── Trail Config Helpers ───────────────────────────────────────────────────────

function getPositionTrailTrigger(inst: string): number {
  return inst === "NIFTY" ? 40 : inst === "BANKNIFTY" ? 80 : 120;
}
function getPositionTrailOffset(inst: string): number {
  return inst === "NIFTY" ? 20 : inst === "BANKNIFTY" ? 40 : 60;
}
function getPositionBeOffset(inst: string): number {
  return inst === "NIFTY" ? 15 : inst === "BANKNIFTY" ? 30 : 50;
}

// ── IST Date Helpers ───────────────────────────────────────────────────────────

function getISTDateParts(): { d: number; m: number; y: number } {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return { d: ist.getUTCDate(), m: ist.getUTCMonth() + 1, y: ist.getUTCFullYear() };
}
