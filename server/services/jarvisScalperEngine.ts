/**
 * jarvisScalperEngine.ts — JARVIS AI Real Trading Automator & Smart SL Bot v3.5
 * ─────────────────────────────────────────────────────────────────────────────
 * FULL AUTOMATION MODE:
 *   - Automated real order placement on Fyers API (No manual approvals required!)
 *   - Auto-sync available Fyers Demat Account Balance / Margin into Capital Tracker
 *   - Complete SQLite logging & UI reporting of all Real Order Requests, Orders, and Rejections
 *
 * BROKERAGE RULE (user spec):
 *   Entry Brokerage = ₹30
 *   Exit  Brokerage = ₹20
 *   Total Brokerage = ₹50 (round-trip per trade)
 *   Max Daily Trades = 100 (₹5,000 max daily brokerage budget)
 *
 * P&L FORMULA:
 *   Net PnL = (exit_price - entry_price) × total_qty - 50
 *   Buy Cost = entry_price × total_qty + 30
 *
 * QUANT CONFLUENCE FILTERS (Meaningful Trades):
 *   1. BankNifty Special Focus (checked FIRST)
 *   2. Nifty Expiry & Pre-Expiry Gamma Surge (Thu/Wed booster)
 *   3. Heavyweight Net Score Alignment (|netScore| >= 4.0)
 *   4. Adv / Dec Stock Breadth Alignment
 *
 * AIRTIGHT SMART SL BOT:
 *   - Tight Initial SL + Fast Breakeven Shift @ +2.0-3.5 pts
 *   - 65% Trailing Profit Lock
 *   - Emergency Hard Spot-Delta Backup SL
 *   - Hard Max Loss Cap (Emergency Brake)
 */

import Database from "better-sqlite3";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";
import { liveOptionTicks } from "./optionChainStream.js";
import { computeWeightedStockSignal } from "./weightedStockSignalEngine.js";
import { savePaperTrade, closePaperTrade, updatePaperTradeSL } from "./tradingEngineDB.js";
import { governorService } from "./governorService.js";
import { placeOrder, getFunds, getPositions, getOrders, type PlaceOrderResult } from "./fyersTradeService.js";

// ── Database Setup ────────────────────────────────────────────────────────────
const DB_PATH = path.join(process.cwd(), "server", "storage", "indicators.db");
let _db: Database.Database | null = null;

function getDB(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { timeout: 5000 });
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS jarvis_scalp_trades (
        id                TEXT PRIMARY KEY,
        timestamp         INTEGER NOT NULL,
        instrument        TEXT NOT NULL,
        direction         TEXT NOT NULL,
        strike            INTEGER NOT NULL,
        entry_price       REAL NOT NULL,
        qty               INTEGER NOT NULL,
        lot_size          INTEGER NOT NULL,
        num_lots          INTEGER NOT NULL DEFAULT 1,
        total_qty         INTEGER NOT NULL,
        buy_cost          REAL NOT NULL DEFAULT 0,
        target_price      REAL NOT NULL,
        stop_loss         REAL NOT NULL,
        smart_sl          REAL NOT NULL,
        highest_price     REAL NOT NULL,
        entry_spot        REAL NOT NULL DEFAULT 0,
        exit_price        REAL,
        status            TEXT NOT NULL DEFAULT 'OPEN',
        pnl               REAL NOT NULL DEFAULT 0,
        target_pnl_goal   REAL NOT NULL DEFAULT 500,
        smart_sl_stage    TEXT NOT NULL DEFAULT 'INITIAL_TIGHT',
        reason            TEXT,
        entry_momentum    REAL DEFAULT 0,
        entry_time        INTEGER NOT NULL,
        closed_at         INTEGER,
        brokerage_paid    REAL NOT NULL DEFAULT 50
      );
      CREATE INDEX IF NOT EXISTS idx_jst_ts ON jarvis_scalp_trades(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_jst_status ON jarvis_scalp_trades(status);

      -- Capital tracking table
      CREATE TABLE IF NOT EXISTS jarvis_capital (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        total_capital   REAL NOT NULL DEFAULT 150000,
        used_capital    REAL NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO jarvis_capital (id, total_capital, used_capital, updated_at)
        VALUES (1, 150000, 0, unixepoch() * 1000);

      -- Real Fyers Order Execution & Rejection Log
      CREATE TABLE IF NOT EXISTS jarvis_real_orders (
        id            TEXT PRIMARY KEY,
        scalp_id      TEXT NOT NULL,
        timestamp     INTEGER NOT NULL,
        instrument    TEXT NOT NULL,
        direction     TEXT NOT NULL,
        strike        INTEGER NOT NULL,
        symbol        TEXT NOT NULL,
        qty           INTEGER NOT NULL,
        side          INTEGER NOT NULL,
        action        TEXT NOT NULL,
        order_id      TEXT,
        status        TEXT NOT NULL,
        message       TEXT,
        raw_response  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jro_ts ON jarvis_real_orders(timestamp DESC);
    `);

    const addColIfMissing = (col: string, type: string) => {
      try { _db!.exec(`ALTER TABLE jarvis_scalp_trades ADD COLUMN ${col} ${type}`); } catch (_) {}
    };
    addColIfMissing("num_lots", "INTEGER NOT NULL DEFAULT 1");
    addColIfMissing("total_qty", "INTEGER NOT NULL DEFAULT 0");
    addColIfMissing("buy_cost", "REAL NOT NULL DEFAULT 0");
    addColIfMissing("entry_time", "INTEGER");
    addColIfMissing("brokerage_paid", "REAL NOT NULL DEFAULT 50");
    addColIfMissing("entry_spot", "REAL NOT NULL DEFAULT 0");
  }
  return _db;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ENTRY_BROKERAGE           = 30;  // ₹30 on entry
const EXIT_BROKERAGE            = 20;  // ₹20 on exit
const TOTAL_BROKERAGE_PER_TRADE = 50;  // ₹50 round-trip
const INITIAL_CAPITAL           = 150000; // ₹1,50,000 starting capital

// ── Real Fyers Order Record Interface ──────────────────────────────────────────
export interface JarvisRealOrder {
  id: string;
  scalp_id: string;
  timestamp: number;
  instrument: string;
  direction: string;
  strike: number;
  symbol: string;
  qty: number;
  side: number;          // 1=BUY, -1=SELL
  action: "ENTRY" | "EXIT";
  order_id?: string;
  status: "PLACED" | "REJECTED" | "FAILED";
  message: string;
  raw_response?: string;
}

export function saveJarvisRealOrder(order: JarvisRealOrder): void {
  try {
    const db = getDB();
    db.prepare(`
      INSERT OR REPLACE INTO jarvis_real_orders
      (id, scalp_id, timestamp, instrument, direction, strike, symbol, qty, side, action, order_id, status, message, raw_response)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      order.id, order.scalp_id, order.timestamp, order.instrument, order.direction,
      order.strike, order.symbol, order.qty, order.side, order.action,
      order.order_id ?? null, order.status, order.message,
      order.raw_response ? JSON.stringify(order.raw_response) : null
    );
  } catch (e: any) {
    console.error("[JarvisScalper] Failed to save real order log:", e.message);
  }
}

export function getJarvisRealOrders(limit = 50): JarvisRealOrder[] {
  try {
    const db = getDB();
    return db.prepare("SELECT * FROM jarvis_real_orders ORDER BY timestamp DESC LIMIT ?")
             .all(limit) as JarvisRealOrder[];
  } catch (_) {
    return [];
  }
}

// ── Helper: Resolve Option Symbol from Market State ───────────────────────────
export function getFyersOptionSymbol(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  strike: number,
  direction: "BUY_CE" | "BUY_PE"
): string {
  const chainState = instrument === "NIFTY" ? marketState.niftyOptionChain
    : instrument === "BANKNIFTY" ? marketState.bankniftyOptionChain
    : marketState.sensexOptionChain;

  if (chainState && chainState.strikes) {
    const row = chainState.strikes.find((s: any) => s.strikePrice === strike);
    if (row) {
      const sym = direction.includes("CE") ? row.ceSymbol : row.peSymbol;
      if (sym && sym.length > 5) return sym;
    }
  }

  // Fallback: Construct standard Fyers symbol format
  // e.g. NSE:NIFTY26JUL24500CE or BSE:SENSEX26JUL80500CE
  const optType = direction.includes("CE") ? "CE" : "PE";
  const now = new Date();
  const yearStr = now.getFullYear().toString().slice(-2); // e.g. "26"
  const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const monthStr = monthNames[now.getMonth()];

  const prefix = instrument === "SENSEX" ? "BSE:SENSEX" : `NSE:${instrument}`;
  return `${prefix}${yearStr}${monthStr}${strike}${optType}`;
}

// ── Fyers Capital Sync ────────────────────────────────────────────────────────
export async function syncFyersCapital(): Promise<void> {
  if (!marketState.fyersAuthorized) return;
  try {
    const res = await getFunds();
    if (res && res.fund_limit) {
      let avail = 0;
      if (Array.isArray(res.fund_limit)) {
        const item = res.fund_limit.find((f: any) =>
          f.title?.toLowerCase().includes("available") || f.title?.toLowerCase().includes("fund") || f.id === 10
        ) || res.fund_limit[0];
        avail = item?.equityAmount ?? item?.amount ?? 0;
      }
      if (avail > 0) {
        const db = getDB();
        db.prepare("UPDATE jarvis_capital SET total_capital = ?, updated_at = ? WHERE id = 1")
          .run(avail, Date.now());
        console.log(`[JarvisScalper] 💳 Fyers Capital Auto-Synced: ₹${avail.toLocaleString("en-IN")}`);
      }
    }
  } catch (e: any) {
    // Silent catch if API token is temporarily offline
  }
}

// ── Lot-size config per instrument ────────────────────────────────────────────
export function getLotConfig(instrument: "NIFTY" | "BANKNIFTY" | "SENSEX") {
  const isExpiryDay = new Date().getDay() === 4 || new Date().getDay() === 3; // Thu/Wed
  if (instrument === "BANKNIFTY") {
    return { lotQty: 35, targetPts: 15.0, slPts: 4.5, beTrigger: 3.5, slSpotPts: 7.0 };
  }
  if (instrument === "NIFTY") {
    const targetPts = isExpiryDay ? 12.0 : 7.7;
    return { lotQty: 65, targetPts, slPts: 2.5, beTrigger: 2.0, slSpotPts: 4.0 };
  }
  return { lotQty: 20, targetPts: 25.0, slPts: 7.5, beTrigger: 6.0, slSpotPts: 12.0 };
}

// ── Correct P&L Calculation ───────────────────────────────────────────────────
export function calcPnL(entryPrice: number, exitPrice: number, totalQty: number): number {
  const gross = (exitPrice - entryPrice) * totalQty;
  const net   = gross - TOTAL_BROKERAGE_PER_TRADE; // ₹50 total brokerage
  return Math.round(net * 100) / 100;
}

export function calcBuyCost(entryPrice: number, totalQty: number): number {
  return entryPrice * totalQty + ENTRY_BROKERAGE; // ₹30 entry brokerage
}

// ── Trade Record Interface ─────────────────────────────────────────────────────
export interface JarvisScalpTrade {
  id: string;
  timestamp: number;
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  entry_price: number;
  qty: number;
  lot_size: number;
  num_lots: number;
  total_qty: number;
  buy_cost: number;
  target_price: number;
  stop_loss: number;
  smart_sl: number;
  highest_price: number;
  entry_spot: number;
  exit_price?: number;
  status: "OPEN" | "CLOSED";
  pnl: number;
  target_pnl_goal: number;
  smart_sl_stage: "INITIAL_TIGHT" | "ZERO_RISK_BE" | "PROFIT_LOCK" | "MOMENTUM_FADE" | "STAGNANT_EXIT" | "TARGET_HIT" | "SL_HIT" | "MANUAL_EXIT" | "MAX_HOLD_EXIT";
  reason: string;
  entry_momentum: number;
  entry_time: number;
  closed_at?: number;
  brokerage_paid: number;
}

export interface ScalperEngineSettings {
  enabled: boolean;
  minMomentumThreshold: number;
  targetProfitGoal: number;
  maxDailyScalps: number;
  consecutiveLossCooldownMs: number;
  realTradingEnabled: boolean;
}

// ── Engine State ───────────────────────────────────────────────────────────────
let engineSettings: ScalperEngineSettings = {
  enabled: true,
  minMomentumThreshold: 30,
  targetProfitGoal: 500,
  maxDailyScalps: 100, // 100 trades daily capacity = ₹5,000 max daily brokerage limit
  consecutiveLossCooldownMs: 15 * 60 * 1000,
  realTradingEnabled: true, // FULL REAL TRADING AUTOMATION ACTIVE BY DEFAULT
};

let consecutiveLossCount = 0;
let consecutiveCooldownUntil = 0;
const lastScalpTime: Record<string, number> = { NIFTY: 0, BANKNIFTY: 0, SENSEX: 0 };
const spotHistory: Record<string, { price: number; time: number }[]> = { NIFTY: [], BANKNIFTY: [], SENSEX: [] };

// ── DB Helpers ─────────────────────────────────────────────────────────────────
export function getJarvisScalpTrades(status?: "OPEN" | "CLOSED"): JarvisScalpTrade[] {
  const db = getDB();
  if (status) {
    return db.prepare("SELECT * FROM jarvis_scalp_trades WHERE status = ? ORDER BY timestamp DESC")
             .all(status) as JarvisScalpTrade[];
  }
  return db.prepare("SELECT * FROM jarvis_scalp_trades ORDER BY timestamp DESC LIMIT 100")
           .all() as JarvisScalpTrade[];
}

export function saveJarvisScalpTrade(trade: JarvisScalpTrade): void {
  const db = getDB();
  db.prepare(`
    INSERT OR REPLACE INTO jarvis_scalp_trades
    (id, timestamp, instrument, direction, strike, entry_price, qty, lot_size, num_lots, total_qty, buy_cost,
     target_price, stop_loss, smart_sl, highest_price, entry_spot, exit_price, status, pnl, target_pnl_goal,
     smart_sl_stage, reason, entry_momentum, entry_time, closed_at, brokerage_paid)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    trade.id, trade.timestamp, trade.instrument, trade.direction, trade.strike,
    trade.entry_price, trade.qty, trade.lot_size, trade.num_lots, trade.total_qty, trade.buy_cost,
    trade.target_price, trade.stop_loss, trade.smart_sl, trade.highest_price,
    trade.entry_spot ?? 0,
    trade.exit_price ?? null, trade.status, trade.pnl, trade.target_pnl_goal,
    trade.smart_sl_stage, trade.reason, trade.entry_momentum,
    trade.entry_time, trade.closed_at ?? null, trade.brokerage_paid
  );
}

// ── Capital Helpers ────────────────────────────────────────────────────────────
export function getCapitalState(): { totalCapital: number; usedCapital: number; freeCapital: number } {
  const db = getDB();
  const row = db.prepare("SELECT total_capital, used_capital FROM jarvis_capital WHERE id = 1").get() as any;
  const total = row?.total_capital ?? INITIAL_CAPITAL;
  const used  = row?.used_capital ?? 0;
  return { totalCapital: total, usedCapital: used, freeCapital: total - used };
}

function updateCapitalUsed(delta: number) {
  const db = getDB();
  db.prepare("UPDATE jarvis_capital SET used_capital = MAX(0, used_capital + ?), updated_at = ? WHERE id = 1")
    .run(delta, Date.now());
}

export function resetCapital() {
  const db = getDB();
  db.prepare("UPDATE jarvis_capital SET total_capital = ?, used_capital = 0, updated_at = ? WHERE id = 1")
    .run(INITIAL_CAPITAL, Date.now());
}

export function clearJarvisHistory(): void {
  const db = getDB();
  db.prepare("DELETE FROM jarvis_scalp_trades").run();
  db.prepare("DELETE FROM jarvis_real_orders").run();
  db.prepare("UPDATE jarvis_capital SET total_capital = ?, used_capital = 0, updated_at = ? WHERE id = 1")
    .run(INITIAL_CAPITAL, Date.now());
  consecutiveLossCount = 0;
  consecutiveCooldownUntil = 0;
  console.log("[JarvisScalper] 🧹 Cleared all scalp trades & real order history. Capital reset to ₹1,50,000.");
}

// ── Spot Velocity & Momentum ──────────────────────────────────────────────────
function updateSpotHistory(inst: "NIFTY" | "BANKNIFTY" | "SENSEX", spot: number) {
  const now = Date.now();
  if (!spotHistory[inst]) spotHistory[inst] = [];
  spotHistory[inst].push({ price: spot, time: now });
  spotHistory[inst] = spotHistory[inst].filter(h => now - h.time <= 10000);
}

function getWeightedSignalForInstrument(inst: "NIFTY" | "BANKNIFTY" | "SENSEX") {
  const stockMap = inst === "NIFTY" ? marketState.niftyStocks
    : inst === "BANKNIFTY" ? marketState.bankniftyStocks
    : marketState.sensexStocks;
  const stocksArray = Object.values(stockMap || {});
  return computeWeightedStockSignal(stocksArray);
}

// ── Official L6 Composite Momentum Score Engine (0-100) ──────────────────────
export function computeMomentumScore(inst: "NIFTY" | "BANKNIFTY" | "SENSEX"): number {
  const spot = inst === "NIFTY" ? marketState.niftySpot
    : inst === "BANKNIFTY" ? marketState.bankniftySpot
    : marketState.sensexSpot;

  if (!spot || spot <= 0) return 0;

  const weightedSig = getWeightedSignalForInstrument(inst);

  // 1. Short-term Velocity (0-25 pts)
  const history = spotHistory[inst] || [];
  let velScore = 0;
  if (history.length >= 2) {
    const oldest = history[0];
    const newest = history[history.length - 1];
    const dt = (newest.time - oldest.time) / 1000;
    if (dt > 0) {
      const pointsChange = newest.price - oldest.price;
      const rate = Math.abs(pointsChange / dt);
      velScore = Math.min(25, Math.round(rate * (inst === "NIFTY" ? 30 : inst === "BANKNIFTY" ? 20 : 15)));
    }
  }

  // 2. Heavyweight Breadth & Net Score (0-30 pts)
  const netScore = weightedSig.netScore;
  const breadthScore = Math.min(30, Math.round(Math.abs(netScore) * 0.9));

  // 3. Adv / Dec Ratio Alignment (0-25 pts)
  const totalStocks = weightedSig.bullishStocksCount + weightedSig.bearishStocksCount || 1;
  const advRatio = weightedSig.bullishStocksCount / totalStocks;
  const decRatio = weightedSig.bearishStocksCount / totalStocks;
  const advScore = Math.min(25, Math.round(Math.abs(advRatio - decRatio) * 25));

  // 4. Directional Impulse (0-20 pts)
  const trendScore = Math.abs(netScore) > 10 ? 20 : 10;

  const composite = Math.min(100, velScore + breadthScore + advScore + trendScore);
  return Number(composite.toFixed(0));
}

// ── Main Tick Evaluator ───────────────────────────────────────────────────────
export function evaluateJarvisScalper(io?: SocketIOServer) {
  if (!engineSettings.enabled) return;
  if (governorService.isKillSwitchActive()) return;

  const now = Date.now();
  if (consecutiveLossCount >= 3 && now < consecutiveCooldownUntil) return;

  const openTrades = getJarvisScalpTrades("OPEN");

  // 1. Manage open trades (Smart SL Bot + Momentum Fade + Pyramid check)
  for (const trade of openTrades) {
    manageSmartSLBot(trade, io);
  }

  // Daily scalp limit check
  const todayTrades = getJarvisScalpTrades().filter(t => {
    const d = new Date(t.timestamp);
    return d.toDateString() === new Date().toDateString();
  });
  if (todayTrades.length >= engineSettings.maxDailyScalps) return;

  // 2. Priority Scan for new entries (BANKNIFTY First, then NIFTY Expiry, then SENSEX)
  const instruments: Array<"BANKNIFTY" | "NIFTY" | "SENSEX"> = ["BANKNIFTY", "NIFTY", "SENSEX"];
  const dayOfWeek = new Date().getDay();
  const isNiftyExpiry = dayOfWeek === 4 || dayOfWeek === 3; // Thu/Wed

  for (const inst of instruments) {
    if (openTrades.some(t => t.instrument === inst)) continue;

    // Fast 3s re-entry cooldown per instrument
    if (now - (lastScalpTime[inst] || 0) < 3_000) continue;

    const spot = inst === "NIFTY" ? marketState.niftySpot
      : inst === "BANKNIFTY" ? marketState.bankniftySpot
      : marketState.sensexSpot;
    if (!spot || spot <= 0) continue;

    updateSpotHistory(inst, spot);
    const momentumScore = computeMomentumScore(inst);
    const weightedSig   = getWeightedSignalForInstrument(inst);

    let minReqMomentum = 35;
    if (inst === "BANKNIFTY") {
      minReqMomentum = 30;
    } else if (inst === "NIFTY" && isNiftyExpiry) {
      minReqMomentum = 25;
    }

    if (momentumScore < minReqMomentum) continue;

    // ── QUANT CONFLUENCE FILTERS ──
    const netScore = weightedSig.netScore;
    if (Math.abs(netScore) < 4.0) continue;

    const direction: "BUY_CE" | "BUY_PE" = netScore >= 0 ? "BUY_CE" : "BUY_PE";
    if (direction === "BUY_CE" && weightedSig.bullishStocksCount < weightedSig.bearishStocksCount) continue;
    if (direction === "BUY_PE" && weightedSig.bearishStocksCount < weightedSig.bullishStocksCount) continue;

    // All filters passed -> Trigger Trade!
    triggerJarvisScalpEntry(inst, direction, spot, momentumScore, weightedSig.netScore,
      weightedSig.bullishStocksCount, weightedSig.bearishStocksCount, io);
  }
}

// ── Robust Price Getter — NEVER returns 0 ────────────────────────────────────
function getCurrentPrice(trade: JarvisScalpTrade): number {
  const optType = trade.direction.includes("CE") ? "CE" : "PE";
  const keysToTry = [
    `${trade.instrument}_${trade.strike}_${optType}`,
    `${trade.instrument}${trade.strike}${optType}`,
    `NSE:${trade.instrument}${trade.strike}${optType}`,
  ];
  for (const k of keysToTry) {
    const td = liveOptionTicks.get(k);
    if (td?.ltp && td.ltp > 0) return td.ltp;
  }

  const currentSpot = trade.instrument === "NIFTY"    ? marketState.niftySpot
    : trade.instrument === "BANKNIFTY" ? marketState.bankniftySpot
    : marketState.sensexSpot;

  if (currentSpot && currentSpot > 0 && trade.entry_spot > 0) {
    const spotMove = trade.direction === "BUY_CE"
      ? currentSpot - trade.entry_spot
      : trade.entry_spot - currentSpot;
    const estimatedPrice = trade.entry_price + spotMove * 0.5;
    return Number(Math.max(1, estimatedPrice).toFixed(2));
  }

  return trade.entry_price;
}

function getCurrentSpot(trade: JarvisScalpTrade): number {
  return trade.instrument === "NIFTY"    ? (marketState.niftySpot    || 0)
    : trade.instrument === "BANKNIFTY" ? (marketState.bankniftySpot || 0)
    : (marketState.sensexSpot || 0);
}

// ── MANUAL / FORCE EXIT ───────────────────────────────────────────────────────
export function forceExitTrade(tradeId: string, io?: SocketIOServer): boolean {
  const openTrades = getJarvisScalpTrades("OPEN");
  const trade = openTrades.find(t => t.id === tradeId);
  if (!trade) return false;

  const exitPrice = getCurrentPrice(trade);
  closeTrade(trade, exitPrice, "MANUAL_EXIT", `🖐️ Manual Exit by user @ ₹${exitPrice}`, io);
  console.log(`[JarvisScalper] 🖐️ MANUAL EXIT: ${trade.instrument} ${trade.direction} @ ₹${exitPrice}`);
  return true;
}

// ── AIRTIGHT SMART SL BOT ─────────────────────────────────────────────────────
function manageSmartSLBot(trade: JarvisScalpTrade, io?: SocketIOServer) {
  const currentPrice = getCurrentPrice(trade);
  const currentSpot  = getCurrentSpot(trade);
  const now          = Date.now();
  let updated        = false;

  if (currentPrice > trade.highest_price) {
    trade.highest_price = currentPrice;
    updated = true;
  }

  const cfg        = getLotConfig(trade.instrument);
  const gainPts    = currentPrice - trade.entry_price;
  const livePnL    = calcPnL(trade.entry_price, currentPrice, trade.total_qty);
  const currentMom = computeMomentumScore(trade.instrument);

  // ─── 🔴 1. MAX HOLD TIME: Force exit after 5 minutes ────────────────────────
  const elapsedSec = (now - trade.entry_time) / 1000;
  if (elapsedSec >= 300) {
    closeTrade(trade, currentPrice, "MAX_HOLD_EXIT",
      `⏰ Max Hold (5 min) — Force Exit @ ₹${currentPrice}`, io);
    if (livePnL < 0) {
      consecutiveLossCount++;
      if (consecutiveLossCount >= 3) consecutiveCooldownUntil = now + engineSettings.consecutiveLossCooldownMs;
    } else {
      consecutiveLossCount = 0;
    }
    return;
  }

  // ─── 🔴 2. SPOT-BASED BACKUP SL ─────────────────────────────────────────────
  if (trade.entry_spot > 0 && currentSpot > 0) {
    const slSpotPts = cfg.slSpotPts;
    const spotAgainst = trade.direction === "BUY_CE"
      ? trade.entry_spot - currentSpot
      : currentSpot - trade.entry_spot;

    if (spotAgainst >= slSpotPts && trade.smart_sl_stage === "INITIAL_TIGHT") {
      console.warn(`[JarvisScalper] 🛑 SPOT-BASED SL TRIGGERED: Spot moved ${spotAgainst.toFixed(1)} pts against ${trade.direction}`);
      closeTrade(trade, currentPrice, "SL_HIT",
        `🛑 Spot-SL: Spot moved ${spotAgainst.toFixed(1)} pts against position`, io);
      if (livePnL < 0) {
        consecutiveLossCount++;
        if (consecutiveLossCount >= 3) consecutiveCooldownUntil = now + engineSettings.consecutiveLossCooldownMs;
      } else {
        consecutiveLossCount = 0;
      }
      return;
    }
  }

  // ─── 🔴 3. HARD MAX LOSS CAP ────────────────────────────────────────────────
  const maxLossCap = -(cfg.slPts * trade.total_qty + TOTAL_BROKERAGE_PER_TRADE);
  if (livePnL <= maxLossCap) {
    console.warn(`[JarvisScalper] 🚨 MAX LOSS CAP HIT: ₹${livePnL} <= ₹${maxLossCap}. Emergency exit!`);
    closeTrade(trade, currentPrice, "SL_HIT",
      `🚨 Emergency Max-Loss Cap: ₹${livePnL} (cap: ₹${maxLossCap})`, io);
    consecutiveLossCount++;
    if (consecutiveLossCount >= 3) consecutiveCooldownUntil = now + engineSettings.consecutiveLossCooldownMs;
    return;
  }

  // ─── STAGE 1: TARGET HIT ───────────────────────────────────────────────────
  if (currentPrice >= trade.target_price || gainPts >= cfg.targetPts) {
    closeTrade(trade, currentPrice, "TARGET_HIT",
      `⚡ Target Hit (+${gainPts.toFixed(1)} pts / +₹${calcPnL(trade.entry_price, currentPrice, trade.total_qty)})`, io);
    consecutiveLossCount = 0;
    return;
  }

  // ─── STAGE 2: PYRAMID ─────────────────────────────────────────────────────
  if (trade.num_lots < 2 && gainPts >= cfg.targetPts * 0.45 && gainPts < cfg.targetPts * 0.9) {
    const momOk = (trade.direction === "BUY_CE" && currentMom >= 10) ||
                  (trade.direction === "BUY_PE" && currentMom <= -10);
    if (momOk) {
      const addCost = currentPrice * trade.lot_size + ENTRY_BROKERAGE;
      const { freeCapital } = getCapitalState();
      if (freeCapital >= addCost) {
        trade.num_lots       += 1;
        trade.total_qty      += trade.lot_size;
        trade.buy_cost       += addCost;
        trade.brokerage_paid += ENTRY_BROKERAGE;
        updateCapitalUsed(addCost);
        updated = true;
        console.log(`[JarvisScalper] 📈 PYRAMID: ${trade.instrument} @ ₹${currentPrice} | Total lots: ${trade.num_lots}`);
      }
    }
  }

  // ─── STAGE 3: MOMENTUM FADE EXIT ──────────────────────────────────────────
  const isMomFaded = (trade.direction === "BUY_CE" && currentMom < 10) ||
                     (trade.direction === "BUY_PE" && currentMom > -10);
  if (gainPts >= 1.5 && isMomFaded) {
    closeTrade(trade, currentPrice, "MOMENTUM_FADE",
      `🚀 Momentum Faded — Micro Profit Locked (+${gainPts.toFixed(1)} pts)`, io);
    if (livePnL > 0) consecutiveLossCount = 0;
    return;
  }

  // ─── STAGE 4: ZERO-RISK BREAKEVEN ─────────────────────────────────────────
  if (gainPts >= cfg.beTrigger && trade.smart_sl < trade.entry_price + 0.5) {
    trade.smart_sl       = Number((trade.entry_price + 0.5).toFixed(2));
    trade.smart_sl_stage = "ZERO_RISK_BE";
    updated = true;
    try { updatePaperTradeSL(trade.id, trade.smart_sl); } catch (_) {}
    console.log(`[JarvisScalper] 🛡️ BE SHIFT: SL → ${trade.smart_sl} for ${trade.instrument}`);
  }

  // ─── STAGE 5: TRAILING PROFIT LOCK ────────────────────────────────────────
  if (gainPts >= cfg.targetPts * 0.5) {
    const lockSL = Number((trade.entry_price + gainPts * 0.65).toFixed(2));
    if (lockSL > trade.smart_sl) {
      trade.smart_sl       = lockSL;
      trade.smart_sl_stage = "PROFIT_LOCK";
      updated = true;
      try { updatePaperTradeSL(trade.id, trade.smart_sl); } catch (_) {}
    }
  }

  // ─── STAGE 6: STAGNANCY AUTO-KILL (>35s no progress) ─────────────────────
  if (elapsedSec > 35 && gainPts < 0.5 && trade.smart_sl_stage === "INITIAL_TIGHT") {
    closeTrade(trade, currentPrice, "STAGNANT_EXIT",
      `⏳ Stagnancy Auto-Kill (>35s, no momentum)`, io);
    if (livePnL < 0) {
      consecutiveLossCount++;
      if (consecutiveLossCount >= 3) consecutiveCooldownUntil = now + engineSettings.consecutiveLossCooldownMs;
    } else {
      consecutiveLossCount = 0;
    }
    return;
  }

  // ─── STAGE 7: HARD STOP LOSS ──────────────────────────────────────────────
  if (currentPrice <= trade.smart_sl) {
    closeTrade(trade, currentPrice, "SL_HIT", `🛑 Smart SL Hit @ ₹${trade.smart_sl}`, io);
    if (calcPnL(trade.entry_price, currentPrice, trade.total_qty) < 0) {
      consecutiveLossCount++;
      if (consecutiveLossCount >= 3) consecutiveCooldownUntil = now + engineSettings.consecutiveLossCooldownMs;
    } else {
      consecutiveLossCount = 0;
    }
    return;
  }

  if (updated) {
    saveJarvisScalpTrade(trade);
    if (io) io.emit("jarvis-scalper-update", { type: "SL_UPDATED", trade });
  }
}

// ── Helper: Close Trade ───────────────────────────────────────────────────────
function closeTrade(
  trade: JarvisScalpTrade,
  exitPrice: number,
  stage: JarvisScalpTrade["smart_sl_stage"],
  reason: string,
  io?: SocketIOServer
) {
  const pnl      = calcPnL(trade.entry_price, exitPrice, trade.total_qty);
  const gainPts  = exitPrice - trade.entry_price;

  trade.exit_price      = exitPrice;
  trade.status          = "CLOSED";
  trade.pnl             = pnl;
  trade.smart_sl_stage  = stage;
  trade.closed_at       = Date.now();
  trade.reason          = reason;

  saveJarvisScalpTrade(trade);

  // Free capital
  updateCapitalUsed(-trade.buy_cost);
  try {
    const db = getDB();
    db.prepare("UPDATE jarvis_capital SET total_capital = total_capital + ?, updated_at = ? WHERE id = 1")
      .run(pnl, Date.now());
  } catch (_) {}

  try { closePaperTrade(trade.id, exitPrice, pnl); } catch (_) {}

  console.log(`[JarvisScalper] ${stage}: ${trade.instrument} ${trade.direction} @ ${exitPrice} | PnL: ₹${pnl}`);
  if (io) io.emit("jarvis-scalper-update", { type: "TRADE_CLOSED", trade });

  // ── 🚀 AUTOMATED REAL FYERS EXIT ORDER DISPATCH ──────────────────────────
  const fyersTokenPresent = !!marketState.fyersConfig.access_token || marketState.fyersAuthorized;
  if (engineSettings.realTradingEnabled && fyersTokenPresent) {
    const fyersSymbol = getFyersOptionSymbol(trade.instrument, trade.strike, trade.direction);
    console.log(`[JarvisScalper] 🚀 REAL ORDER EXIT DISPATCH: ${fyersSymbol} Qty: ${trade.total_qty}`);
    placeOrder({
      symbol: fyersSymbol,
      qty: trade.total_qty,
      side: -1, // SELL
      orderType: 2, // MARKET
      productType: "INTRADAY",
      tag: trade.id,
    }).then(res => {
      const realOrder: JarvisRealOrder = {
        id: `RO_${trade.id}_OUT`,
        scalp_id: trade.id,
        timestamp: Date.now(),
        instrument: trade.instrument, direction: trade.direction, strike: trade.strike,
        symbol: fyersSymbol,
        qty: trade.total_qty, side: -1, action: "EXIT",
        order_id: res.orderId,
        status: res.status === "PLACED" ? "PLACED" : "REJECTED",
        message: res.message,
        raw_response: res.rawResponse,
      };
      saveJarvisRealOrder(realOrder);
      if (io) io.emit("jarvis-real-order-update", { order: realOrder });
    }).catch(err => {
      const realOrder: JarvisRealOrder = {
        id: `RO_${trade.id}_OUT_ERR`,
        scalp_id: trade.id,
        timestamp: Date.now(),
        instrument: trade.instrument, direction: trade.direction, strike: trade.strike,
        symbol: fyersSymbol,
        qty: trade.total_qty, side: -1, action: "EXIT",
        status: "REJECTED",
        message: err.message || "Fyers API exit failed",
      };
      saveJarvisRealOrder(realOrder);
      if (io) io.emit("jarvis-real-order-update", { order: realOrder });
    });
  }
}

// ── Entry Trigger ─────────────────────────────────────────────────────────────
export function triggerJarvisScalpEntry(
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX",
  direction: "BUY_CE" | "BUY_PE",
  spotPrice: number,
  momentumScore: number,
  netScore: number,
  adv: number,
  dec: number,
  io?: SocketIOServer
) {
  const cfg          = getLotConfig(instrument);
  const strikeInterval = instrument === "NIFTY" ? 50 : 100;
  const atmStrike    = Math.round(spotPrice / strikeInterval) * strikeInterval;

  const symbolKey    = `${instrument}_${atmStrike}_${direction.includes("CE") ? "CE" : "PE"}`;
  const tickData     = liveOptionTicks.get(symbolKey);
  const entryPrice   = tickData?.ltp || (instrument === "NIFTY" ? 120 : instrument === "BANKNIFTY" ? 280 : 350);

  const targetPrice  = Number((entryPrice + cfg.targetPts).toFixed(2));
  const stopLoss     = Number((entryPrice - cfg.slPts).toFixed(2));
  const totalQty     = cfg.lotQty;
  const buyCost      = calcBuyCost(entryPrice, totalQty);

  // Capital check
  const { freeCapital } = getCapitalState();
  if (freeCapital < buyCost) {
    console.warn(`[JarvisScalper] ⚠️ Insufficient capital (need ₹${buyCost}, free ₹${freeCapital}). Skipping.`);
    return;
  }

  const now   = Date.now();
  const trade: JarvisScalpTrade = {
    id:               `JVS_${instrument}_${now}`,
    timestamp:        now,
    entry_time:       now,
    instrument,
    direction,
    strike:           atmStrike,
    entry_price:      entryPrice,
    entry_spot:       spotPrice,
    qty:              cfg.lotQty,
    lot_size:         cfg.lotQty,
    num_lots:         1,
    total_qty:        totalQty,
    buy_cost:         buyCost,
    target_price:     targetPrice,
    stop_loss:        stopLoss,
    smart_sl:         stopLoss,
    highest_price:    entryPrice,
    status:           "OPEN",
    pnl:              0,
    target_pnl_goal:  engineSettings.targetProfitGoal,
    smart_sl_stage:   "INITIAL_TIGHT",
    reason:           `Momentum: ${momentumScore} | NetScore: ${netScore.toFixed(1)} | Adv/Dec: ${adv}/${dec}`,
    entry_momentum:   momentumScore,
    brokerage_paid:   TOTAL_BROKERAGE_PER_TRADE,
  };

  saveJarvisScalpTrade(trade);
  updateCapitalUsed(buyCost);
  lastScalpTime[instrument] = now;

  try {
    savePaperTrade({
      id: trade.id, timestamp: now, instrument, direction, strike: atmStrike,
      entry_price: entryPrice, qty: 1, lot_size: totalQty, stop_loss: stopLoss,
      target: targetPrice, status: "OPEN", pnl: 0,
      notes: `JARVIS Micro Scalp | Momentum: ${momentumScore} | Buy Cost: ₹${buyCost.toFixed(0)}`,
    });
  } catch (_) {}

  console.log(`[JarvisScalper] ⚡ ENTRY: ${instrument} ${direction} ${atmStrike} @ ₹${entryPrice} | Qty: ${totalQty}`);
  if (io) io.emit("jarvis-scalper-update", { type: "NEW_SCALP", trade });

  // ── 🚀 AUTOMATED REAL FYERS ENTRY ORDER DISPATCH ─────────────────────────
  const fyersTokenPresent = !!marketState.fyersConfig.access_token || marketState.fyersAuthorized;
  if (engineSettings.realTradingEnabled && fyersTokenPresent) {
    const fyersSymbol = getFyersOptionSymbol(instrument, atmStrike, direction);
    console.log(`[JarvisScalper] 🚀 REAL ORDER ENTRY DISPATCH: ${fyersSymbol} Qty: ${totalQty}`);
    placeOrder({
      symbol: fyersSymbol,
      qty: totalQty,
      side: 1, // BUY
      orderType: 2, // MARKET
      productType: "INTRADAY",
      tag: trade.id,
    }).then(res => {
      const realOrder: JarvisRealOrder = {
        id: `RO_${trade.id}_IN`,
        scalp_id: trade.id,
        timestamp: Date.now(),
        instrument, direction, strike: atmStrike,
        symbol: fyersSymbol,
        qty: totalQty, side: 1, action: "ENTRY",
        order_id: res.orderId,
        status: res.status === "PLACED" ? "PLACED" : "REJECTED",
        message: res.message,
        raw_response: res.rawResponse,
      };
      saveJarvisRealOrder(realOrder);
      if (io) io.emit("jarvis-real-order-update", { order: realOrder });
    }).catch(err => {
      const realOrder: JarvisRealOrder = {
        id: `RO_${trade.id}_IN_ERR`,
        scalp_id: trade.id,
        timestamp: Date.now(),
        instrument, direction, strike: atmStrike,
        symbol: fyersSymbol,
        qty: totalQty, side: 1, action: "ENTRY",
        status: "REJECTED",
        message: err.message || "Fyers API placement failed",
      };
      saveJarvisRealOrder(realOrder);
      if (io) io.emit("jarvis-real-order-update", { order: realOrder });
    });
  }
}

// ── Exporters & Control ───────────────────────────────────────────────────────
export async function getScalperEngineStateAsync() {
  let capital = getCapitalState();
  let fyersPositions: any[] = [];
  let fyersOrders: any[] = [];

  const fyersTokenPresent = !!marketState.fyersConfig.access_token || marketState.fyersAuthorized;

  if (fyersTokenPresent) {
    try {
      const fundRes = await getFunds();
      if (fundRes && fundRes.fund_limit) {
        let total = capital.totalCapital;
        let used = 0;
        let avail = capital.freeCapital;
        if (Array.isArray(fundRes.fund_limit)) {
          const itemTotal = fundRes.fund_limit.find((f: any) => f.title?.toLowerCase().includes("total") || f.id === 1);
          const itemUsed  = fundRes.fund_limit.find((f: any) => f.title?.toLowerCase().includes("used") || f.id === 2);
          const itemAvail = fundRes.fund_limit.find((f: any) => f.title?.toLowerCase().includes("available") || f.id === 10) || fundRes.fund_limit[0];

          if (itemAvail) avail = itemAvail.equityAmount ?? itemAvail.amount ?? avail;
          if (itemTotal) total = itemTotal.equityAmount ?? itemTotal.amount ?? (avail + used);
          if (itemUsed)  used  = itemUsed.equityAmount  ?? itemUsed.amount  ?? used;
        }
        capital = { totalCapital: total > 0 ? total : avail, usedCapital: used, freeCapital: avail };
      }
    } catch (_) {}

    try {
      const posRes = await getPositions();
      if (posRes && posRes.netPositions && Array.isArray(posRes.netPositions)) {
        fyersPositions = posRes.netPositions;
      }
    } catch (_) {}

    try {
      const ordRes = await getOrders();
      if (ordRes && ordRes.orderBook && Array.isArray(ordRes.orderBook)) {
        fyersOrders = ordRes.orderBook;
      }
    } catch (_) {}
  }

  const trades  = getJarvisScalpTrades();
  const closed  = trades.filter(t => t.status === "CLOSED");
  const open    = trades.filter(t => t.status === "OPEN");

  const totalPnL  = closed.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const wins      = closed.filter(t => (t.pnl || 0) > 0).length;
  const winRate   = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;

  const now         = Date.now();
  const coolingDown = consecutiveLossCount >= 3 && now < consecutiveCooldownUntil;
  const cooldownSecLeft = coolingDown ? Math.ceil((consecutiveCooldownUntil - now) / 1000) : 0;

  return {
    settings: engineSettings,
    stats: {
      totalScalps: trades.length,
      openScalps: open.length,
      closedScalps: closed.length,
      totalPnL: Math.round(totalPnL * 100) / 100,
      winRate,
      targetGoalPerTrade: engineSettings.targetProfitGoal,
      minMomentumThreshold: engineSettings.minMomentumThreshold,
      consecutiveLosses: consecutiveLossCount,
      coolingDown,
      cooldownSecLeft,
    },
    capital,
    fyersPositions,
    fyersOrders,
    liveMetrics: {
      NIFTY: {
        momentum: computeMomentumScore("NIFTY"),
        netScore: getWeightedSignalForInstrument("NIFTY").netScore,
        adv: getWeightedSignalForInstrument("NIFTY").bullishStocksCount,
        dec: getWeightedSignalForInstrument("NIFTY").bearishStocksCount,
        spot: marketState.niftySpot || 0,
      },
      BANKNIFTY: {
        momentum: computeMomentumScore("BANKNIFTY"),
        netScore: getWeightedSignalForInstrument("BANKNIFTY").netScore,
        adv: getWeightedSignalForInstrument("BANKNIFTY").bullishStocksCount,
        dec: getWeightedSignalForInstrument("BANKNIFTY").bearishStocksCount,
        spot: marketState.bankniftySpot || 0,
      },
      SENSEX: {
        momentum: computeMomentumScore("SENSEX"),
        netScore: getWeightedSignalForInstrument("SENSEX").netScore,
        adv: getWeightedSignalForInstrument("SENSEX").bullishStocksCount,
        dec: getWeightedSignalForInstrument("SENSEX").bearishStocksCount,
        spot: marketState.sensexSpot || 0,
      },
    },
    openTrades: open.map(t => ({
      ...t,
      live_price: getCurrentPrice(t),
      live_pnl: calcPnL(t.entry_price, getCurrentPrice(t), t.total_qty),
    })),
    recentClosed: closed.slice(0, 30),
    realOrders: getJarvisRealOrders(50),
  };
}

export function getScalperEngineState() {
  const trades  = getJarvisScalpTrades();
  const closed  = trades.filter(t => t.status === "CLOSED");
  const open    = trades.filter(t => t.status === "OPEN");

  const totalPnL  = closed.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const wins      = closed.filter(t => (t.pnl || 0) > 0).length;
  const winRate   = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;

  const now         = Date.now();
  const coolingDown = consecutiveLossCount >= 3 && now < consecutiveCooldownUntil;
  const cooldownSecLeft = coolingDown ? Math.ceil((consecutiveCooldownUntil - now) / 1000) : 0;

  return {
    settings: engineSettings,
    stats: {
      totalScalps: trades.length,
      openScalps: open.length,
      closedScalps: closed.length,
      totalPnL: Math.round(totalPnL * 100) / 100,
      winRate,
      targetGoalPerTrade: engineSettings.targetProfitGoal,
      minMomentumThreshold: engineSettings.minMomentumThreshold,
      consecutiveLosses: consecutiveLossCount,
      coolingDown,
      cooldownSecLeft,
    },
    capital: getCapitalState(),
    fyersPositions: [],
    fyersOrders: [],
    liveMetrics: {
      NIFTY: {
        momentum: computeMomentumScore("NIFTY"),
        netScore: getWeightedSignalForInstrument("NIFTY").netScore,
        adv: getWeightedSignalForInstrument("NIFTY").bullishStocksCount,
        dec: getWeightedSignalForInstrument("NIFTY").bearishStocksCount,
        spot: marketState.niftySpot || 0,
      },
      BANKNIFTY: {
        momentum: computeMomentumScore("BANKNIFTY"),
        netScore: getWeightedSignalForInstrument("BANKNIFTY").netScore,
        adv: getWeightedSignalForInstrument("BANKNIFTY").bullishStocksCount,
        dec: getWeightedSignalForInstrument("BANKNIFTY").bearishStocksCount,
        spot: marketState.bankniftySpot || 0,
      },
      SENSEX: {
        momentum: computeMomentumScore("SENSEX"),
        netScore: getWeightedSignalForInstrument("SENSEX").netScore,
        adv: getWeightedSignalForInstrument("SENSEX").bullishStocksCount,
        dec: getWeightedSignalForInstrument("SENSEX").bearishStocksCount,
        spot: marketState.sensexSpot || 0,
      },
    },
    openTrades: open.map(t => ({
      ...t,
      live_price: getCurrentPrice(t),
      live_pnl: calcPnL(t.entry_price, getCurrentPrice(t), t.total_qty),
    })),
    recentClosed: closed.slice(0, 30),
    realOrders: getJarvisRealOrders(50),
  };
}

export function updateScalperSettings(newSettings: Partial<ScalperEngineSettings>) {
  engineSettings = { ...engineSettings, ...newSettings };
}
