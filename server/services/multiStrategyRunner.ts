/**
 * multiStrategyRunner.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX OS — Multi-Strategy Silent Runner
 *
 * Kya karta hai:
 *  - Market state milte hi SABHI strategies (Intraday + Swing) ko ek saath chalata hai
 *  - Har strategy ka trade silently record karta hai (background mein)
 *  - Open trades ka SL/Target monitor karta hai aur auto-close karta hai
 *  - SelfLearning engine ko result feed karta hai
 *  - Best signal select karke frontend ke liye ready rakhta hai
 *
 * Architecture:
 *  marketState tick → runAllStrategies() → record trades → monitor exits → feed learning
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TradeMode     = "INTRADAY" | "SWING";
export type TradeDir      = "BUY_CE" | "BUY_PE";
export type TradeStatus   = "OPEN" | "WIN" | "LOSS" | "SL_HIT" | "TARGET_HIT" | "EXPIRED" | "PENDING";

export interface StrategyTradeRecord {
  id:             string;
  strategy_id:    string;
  strategy_name:  string;
  mode:           TradeMode;
  instrument:     string;     // NIFTY / BANKNIFTY / SENSEX
  direction:      TradeDir;
  strike:         number;
  expiry:         string;
  entry_price:    number;
  sl_price:       number;
  target_price:   number;
  exit_price:     number | null;
  status:         TradeStatus;
  pnl:            number;
  // Market context at entry
  pcr:            number;
  nifty_score:    number;
  market_regime:  string;
  confidence:     number;
  win_rate_at_entry: number;  // Strategy ka win rate jab entry li
  entry_time:     number;     // ms timestamp
  exit_time:      number | null;
  hold_minutes:   number;
  notes:          string;
}

export interface StrategyStats {
  strategy_id:    string;
  strategy_name:  string;
  mode:           TradeMode;
  total_trades:   number;
  wins:           number;
  losses:         number;
  win_rate:       number;
  avg_pnl:        number;
  total_pnl:      number;
  weight:         number;     // 0.5 to 2.0 — self-learning weight
  is_promoted:    boolean;
  is_blocked:     boolean;
  last_updated:   number;
}

export interface BestSignal {
  strategy_id:    string;
  strategy_name:  string;
  mode:           TradeMode;
  instrument:     string;
  direction:      TradeDir;
  strike:         number;
  entry_price:    number;
  sl_price:       number;
  target_price:   number;
  confidence:     number;
  win_rate:       number;
  weight:         number;
  composite_score: number;   // confidence × win_rate × weight
  reason:         string;
  generated_at:   number;
}

// ── Strategy Definitions (Lite — har strategy ka core config) ────────────────

interface StrategyConfig {
  id:          string;
  name:        string;
  mode:        TradeMode;
  instruments: string[];
  // Entry conditions (thresholds)
  minScore:    number;      // nifty/banknifty heavyweight score needed
  minPCR?:     number;      // for bullish
  maxPCR?:     number;      // for bearish
  minConfidence: number;
  direction:   "CE" | "PE" | "DYNAMIC";  // DYNAMIC = AI decides from score
  // Risk (as % of entry price)
  slPct:       number;      // e.g. 0.30 = 30% SL
  tgtPct:      number;      // e.g. 0.60 = 60% Target
  // Timing
  sessions:    Array<"OPENING" | "MID" | "CLOSING" | "ANY">;
  maxHoldMins: number;      // For intraday: 90 mins, swing: 2 days
  tags:        string[];
}

// ── All Strategy Configs ───────────────────────────────────────────────────────
// Yahan 30+ strategies hain — ek saath chalenge silently

const STRATEGY_CONFIGS: StrategyConfig[] = [
  // ── INTRADAY STRATEGIES ────────────────────────────────────────────────────

  {
    id: "MOMENTUM_BREAKOUT_NIFTY",
    name: "Nifty Momentum Breakout",
    mode: "INTRADAY",
    instruments: ["NIFTY"],
    minScore: 20, minPCR: 1.05, minConfidence: 60,
    direction: "CE", slPct: 0.28, tgtPct: 0.55,
    sessions: ["OPENING", "MID"],
    maxHoldMins: 90,
    tags: ["momentum", "breakout", "nifty"],
  },
  {
    id: "MOMENTUM_BREAKDOWN_NIFTY",
    name: "Nifty Momentum Breakdown",
    mode: "INTRADAY",
    instruments: ["NIFTY"],
    minScore: 20, maxPCR: 0.92, minConfidence: 60,
    direction: "PE", slPct: 0.28, tgtPct: 0.55,
    sessions: ["OPENING", "MID"],
    maxHoldMins: 90,
    tags: ["momentum", "breakdown", "nifty"],
  },
  {
    id: "VOLATILITY_EXPLOSION_CE",
    name: "Volatility Explosion CE",
    mode: "INTRADAY",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 30, minPCR: 1.1, minConfidence: 70,
    direction: "CE", slPct: 0.30, tgtPct: 0.75,
    sessions: ["OPENING", "MID", "CLOSING"],
    maxHoldMins: 75,
    tags: ["volatility", "explosion", "bullish"],
  },
  {
    id: "VOLATILITY_EXPLOSION_PE",
    name: "Volatility Explosion PE",
    mode: "INTRADAY",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 30, maxPCR: 0.88, minConfidence: 70,
    direction: "PE", slPct: 0.30, tgtPct: 0.75,
    sessions: ["OPENING", "MID", "CLOSING"],
    maxHoldMins: 75,
    tags: ["volatility", "explosion", "bearish"],
  },
  {
    id: "OPENING_RANGE_BREAK_CE",
    name: "Opening Range Break CE (ORB)",
    mode: "INTRADAY",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 15, minPCR: 1.0, minConfidence: 55,
    direction: "CE", slPct: 0.25, tgtPct: 0.50,
    sessions: ["OPENING"],
    maxHoldMins: 60,
    tags: ["orb", "opening", "bullish"],
  },
  {
    id: "OPENING_RANGE_BREAK_PE",
    name: "Opening Range Break PE (ORB)",
    mode: "INTRADAY",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 15, maxPCR: 0.95, minConfidence: 55,
    direction: "PE", slPct: 0.25, tgtPct: 0.50,
    sessions: ["OPENING"],
    maxHoldMins: 60,
    tags: ["orb", "opening", "bearish"],
  },
  {
    id: "MICRO_SCALP_CE",
    name: "Micro Scalp CE",
    mode: "INTRADAY",
    instruments: ["NIFTY"],
    minScore: 10, minPCR: 1.0, minConfidence: 52,
    direction: "CE", slPct: 0.20, tgtPct: 0.35,
    sessions: ["MID"],
    maxHoldMins: 30,
    tags: ["scalp", "micro", "bullish"],
  },
  {
    id: "MICRO_SCALP_PE",
    name: "Micro Scalp PE",
    mode: "INTRADAY",
    instruments: ["NIFTY"],
    minScore: 10, maxPCR: 0.95, minConfidence: 52,
    direction: "PE", slPct: 0.20, tgtPct: 0.35,
    sessions: ["MID"],
    maxHoldMins: 30,
    tags: ["scalp", "micro", "bearish"],
  },
  {
    id: "REVERSAL_CE",
    name: "Bearish-to-Bullish Reversal",
    mode: "INTRADAY",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 18, minPCR: 1.08, minConfidence: 62,
    direction: "CE", slPct: 0.28, tgtPct: 0.60,
    sessions: ["MID", "CLOSING"],
    maxHoldMins: 90,
    tags: ["reversal", "bullish"],
  },
  {
    id: "REVERSAL_PE",
    name: "Bullish-to-Bearish Reversal",
    mode: "INTRADAY",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 18, maxPCR: 0.90, minConfidence: 62,
    direction: "PE", slPct: 0.28, tgtPct: 0.60,
    sessions: ["MID", "CLOSING"],
    maxHoldMins: 90,
    tags: ["reversal", "bearish"],
  },
  {
    id: "BANKNIFTY_MOMENTUM_CE",
    name: "BankNifty Strong Momentum CE",
    mode: "INTRADAY",
    instruments: ["BANKNIFTY"],
    minScore: 25, minPCR: 1.05, minConfidence: 65,
    direction: "CE", slPct: 0.30, tgtPct: 0.65,
    sessions: ["OPENING", "MID"],
    maxHoldMins: 90,
    tags: ["banknifty", "momentum", "bullish"],
  },
  {
    id: "BANKNIFTY_MOMENTUM_PE",
    name: "BankNifty Strong Momentum PE",
    mode: "INTRADAY",
    instruments: ["BANKNIFTY"],
    minScore: 25, maxPCR: 0.90, minConfidence: 65,
    direction: "PE", slPct: 0.30, tgtPct: 0.65,
    sessions: ["OPENING", "MID"],
    maxHoldMins: 90,
    tags: ["banknifty", "momentum", "bearish"],
  },
  {
    id: "HIGH_CONFIDENCE_ANY",
    name: "High Confidence Signal (Any Direction)",
    mode: "INTRADAY",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 35, minConfidence: 75,
    direction: "DYNAMIC", slPct: 0.28, tgtPct: 0.70,
    sessions: ["ANY"],
    maxHoldMins: 120,
    tags: ["high-confidence", "dynamic"],
  },
  {
    id: "FII_INTRADAY_CE",
    name: "FII Flow Intraday CE",
    mode: "INTRADAY",
    instruments: ["NIFTY"],
    minScore: 22, minPCR: 1.1, minConfidence: 65,
    direction: "CE", slPct: 0.28, tgtPct: 0.60,
    sessions: ["MID"],
    maxHoldMins: 90,
    tags: ["fii", "institutional", "bullish"],
  },
  {
    id: "FII_INTRADAY_PE",
    name: "FII Flow Intraday PE",
    mode: "INTRADAY",
    instruments: ["NIFTY"],
    minScore: 22, maxPCR: 0.88, minConfidence: 65,
    direction: "PE", slPct: 0.28, tgtPct: 0.60,
    sessions: ["MID"],
    maxHoldMins: 90,
    tags: ["fii", "institutional", "bearish"],
  },
  {
    id: "DYNAMIC_INTRADAY_NIFTY",
    name: "Dynamic Intraday (AI Decides)",
    mode: "INTRADAY",
    instruments: ["NIFTY"],
    minScore: 12, minConfidence: 55,
    direction: "DYNAMIC", slPct: 0.25, tgtPct: 0.50,
    sessions: ["ANY"],
    maxHoldMins: 90,
    tags: ["dynamic", "ai", "nifty"],
  },
  {
    id: "DYNAMIC_INTRADAY_BANKNIFTY",
    name: "Dynamic Intraday BankNifty",
    mode: "INTRADAY",
    instruments: ["BANKNIFTY"],
    minScore: 12, minConfidence: 55,
    direction: "DYNAMIC", slPct: 0.25, tgtPct: 0.50,
    sessions: ["ANY"],
    maxHoldMins: 90,
    tags: ["dynamic", "ai", "banknifty"],
  },

  // ── SWING / POSITIONAL STRATEGIES ─────────────────────────────────────────

  {
    id: "WEEKLY_SWING_CE",
    name: "Weekly Swing CE Buyer",
    mode: "SWING",
    instruments: ["NIFTY"],
    minScore: 30, minPCR: 1.15, minConfidence: 68,
    direction: "CE", slPct: 0.35, tgtPct: 1.00,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 2,   // 2 din
    tags: ["swing", "weekly", "bullish"],
  },
  {
    id: "WEEKLY_SWING_PE",
    name: "Weekly Swing PE Buyer",
    mode: "SWING",
    instruments: ["NIFTY"],
    minScore: 30, maxPCR: 0.85, minConfidence: 68,
    direction: "PE", slPct: 0.35, tgtPct: 1.00,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 2,
    tags: ["swing", "weekly", "bearish"],
  },
  {
    id: "BANKNIFTY_SWING_CE",
    name: "BankNifty Weekly Swing CE",
    mode: "SWING",
    instruments: ["BANKNIFTY"],
    minScore: 35, minPCR: 1.12, minConfidence: 70,
    direction: "CE", slPct: 0.35, tgtPct: 1.10,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 2,
    tags: ["swing", "banknifty", "bullish"],
  },
  {
    id: "BANKNIFTY_SWING_PE",
    name: "BankNifty Weekly Swing PE",
    mode: "SWING",
    instruments: ["BANKNIFTY"],
    minScore: 35, maxPCR: 0.85, minConfidence: 70,
    direction: "PE", slPct: 0.35, tgtPct: 1.10,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 2,
    tags: ["swing", "banknifty", "bearish"],
  },
  {
    id: "FII_POSITIONAL_CE",
    name: "FII Positional Flow CE",
    mode: "SWING",
    instruments: ["NIFTY"],
    minScore: 28, minPCR: 1.18, minConfidence: 72,
    direction: "CE", slPct: 0.38, tgtPct: 1.20,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 3,   // 3 din
    tags: ["fii", "positional", "bullish"],
  },
  {
    id: "FII_POSITIONAL_PE",
    name: "FII Positional Flow PE",
    mode: "SWING",
    instruments: ["NIFTY"],
    minScore: 28, maxPCR: 0.82, minConfidence: 72,
    direction: "PE", slPct: 0.38, tgtPct: 1.20,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 3,
    tags: ["fii", "positional", "bearish"],
  },
  {
    id: "BTST_GAP_UP_CE",
    name: "BTST Gap Up CE (Buy Today Sell Tomorrow)",
    mode: "SWING",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 35, minPCR: 1.15, minConfidence: 70,
    direction: "CE", slPct: 0.30, tgtPct: 0.80,
    sessions: ["CLOSING"],
    maxHoldMins: 60 * 24 * 1,   // 1 din
    tags: ["btst", "gap-up", "bullish"],
  },
  {
    id: "BTST_GAP_DOWN_PE",
    name: "BTST Gap Down PE",
    mode: "SWING",
    instruments: ["NIFTY", "BANKNIFTY"],
    minScore: 35, maxPCR: 0.85, minConfidence: 70,
    direction: "PE", slPct: 0.30, tgtPct: 0.80,
    sessions: ["CLOSING"],
    maxHoldMins: 60 * 24 * 1,
    tags: ["btst", "gap-down", "bearish"],
  },
  {
    id: "MONTHLY_TREND_CE",
    name: "Monthly Trend Rider CE",
    mode: "SWING",
    instruments: ["NIFTY"],
    minScore: 40, minPCR: 1.20, minConfidence: 75,
    direction: "CE", slPct: 0.40, tgtPct: 1.50,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 5,
    tags: ["monthly", "trend", "high-conviction"],
  },
  {
    id: "MONTHLY_TREND_PE",
    name: "Monthly Trend Rider PE",
    mode: "SWING",
    instruments: ["NIFTY"],
    minScore: 40, maxPCR: 0.80, minConfidence: 75,
    direction: "PE", slPct: 0.40, tgtPct: 1.50,
    sessions: ["MID"],
    maxHoldMins: 60 * 24 * 5,
    tags: ["monthly", "trend", "high-conviction"],
  },
];

// ── Database Setup ─────────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "server", "storage", "indicators.db");

function getDB(): Database.Database {
  const db = new Database(DB_PATH, { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  initTables(db);
  return db;
}

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_strategy_trades (
      id               TEXT PRIMARY KEY,
      strategy_id      TEXT NOT NULL,
      strategy_name    TEXT NOT NULL,
      mode             TEXT NOT NULL,
      instrument       TEXT NOT NULL,
      direction        TEXT NOT NULL,
      strike           REAL NOT NULL,
      expiry           TEXT DEFAULT '',
      entry_price      REAL NOT NULL,
      sl_price         REAL NOT NULL,
      target_price     REAL NOT NULL,
      exit_price       REAL,
      status           TEXT NOT NULL DEFAULT 'OPEN',
      pnl              REAL DEFAULT 0,
      pcr              REAL DEFAULT 0,
      nifty_score      REAL DEFAULT 0,
      market_regime    TEXT DEFAULT '',
      confidence       REAL DEFAULT 0,
      win_rate_at_entry REAL DEFAULT 0,
      entry_time       INTEGER NOT NULL,
      exit_time        INTEGER,
      hold_minutes     REAL DEFAULT 0,
      notes            TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_ml_trades_strategy ON ml_strategy_trades(strategy_id);
    CREATE INDEX IF NOT EXISTS idx_ml_trades_status   ON ml_strategy_trades(status);
    CREATE INDEX IF NOT EXISTS idx_ml_trades_entry    ON ml_strategy_trades(entry_time DESC);
    CREATE INDEX IF NOT EXISTS idx_ml_trades_mode     ON ml_strategy_trades(mode);

    CREATE TABLE IF NOT EXISTS ml_strategy_stats (
      strategy_id    TEXT PRIMARY KEY,
      strategy_name  TEXT NOT NULL,
      mode           TEXT NOT NULL,
      total_trades   INTEGER DEFAULT 0,
      wins           INTEGER DEFAULT 0,
      losses         INTEGER DEFAULT 0,
      win_rate       REAL DEFAULT 0,
      avg_pnl        REAL DEFAULT 0,
      total_pnl      REAL DEFAULT 0,
      weight         REAL DEFAULT 1.0,
      is_promoted    INTEGER DEFAULT 0,
      is_blocked     INTEGER DEFAULT 0,
      last_updated   INTEGER DEFAULT 0
    );
  `);

  // Seed stats rows for all strategies (if missing)
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ml_strategy_stats
    (strategy_id, strategy_name, mode, total_trades, wins, losses, win_rate, avg_pnl, total_pnl, weight, is_promoted, is_blocked, last_updated)
    VALUES (?, ?, ?, 0, 0, 0, 0.0, 0.0, 0.0, 1.0, 0, 0, 0)
  `);
  for (const s of STRATEGY_CONFIGS) {
    insert.run(s.id, s.name, s.mode);
  }
}

// ── In-Memory State ────────────────────────────────────────────────────────────

let _lastBestSignal: BestSignal | null = null;
let _lastTickTime   = 0;
const MIN_TICK_MS   = 15_000; // 15 seconds ke baad hi naya tick process karo

// Open trades in memory for fast SL/Target monitoring
const _openTrades = new Map<string, StrategyTradeRecord>();

// ── Utility: Market session detect ────────────────────────────────────────────

function getSession(ms: number): "OPENING" | "MID" | "CLOSING" | "AFTER_HOURS" {
  const ist = new Date(ms + 5.5 * 60 * 60 * 1000);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const t = h * 60 + m;
  if (t < 9 * 60 + 15) return "AFTER_HOURS";
  if (t <= 9 * 60 + 45) return "OPENING";
  if (t <= 14 * 60 + 0) return "MID";
  if (t <= 15 * 60 + 30) return "CLOSING";
  return "AFTER_HOURS";
}

function isMarketOpen(ms: number): boolean {
  const session = getSession(ms);
  return session !== "AFTER_HOURS";
}

// ── Utility: ATM Strike calculation ───────────────────────────────────────────

function getATMStrike(spot: number, instrument: string): number {
  const step = instrument === "BANKNIFTY" ? 100 : instrument === "SENSEX" ? 100 : 50;
  return Math.round(spot / step) * step;
}

// ── Utility: Simulated option price from spot ─────────────────────────────────
// Ye ek approximation hai — real LTP ke bina entry price estimate karta hai

function estimateOptionPrice(
  spot: number,
  strike: number,
  direction: TradeDir,
  instrument: string,
): number {
  const otm = direction === "BUY_CE" ? spot - strike : strike - spot;
  // Near ATM options ka rough price: 0.5-2% of spot for weekly options
  const pctOfSpot = instrument === "BANKNIFTY" ? 0.008 : 0.006;
  const base = spot * pctOfSpot;
  // OTM discount
  const discount = otm < 0 ? 1 + Math.abs(otm / spot) * 2 : 1;
  return Math.max(10, Math.round(base / discount));
}

// ── Core: Run all strategies on market tick ────────────────────────────────────

export interface MarketContext {
  serverTime:      number;
  niftySpot:       number;
  bankniftySpot:   number;
  sensexSpot:      number;
  niftyScore:      number;       // Net heavyweight score
  bankniftyScore:  number;
  sensexScore:     number;
  niftyPCR:        number;
  bankniftyPCR:    number;
  marketRegime:    string;
  aiConfidence:    number;       // 0-100 from AI brain
}

export function processTick(ctx: MarketContext): void {
  const now = Date.now();
  if (now - _lastTickTime < MIN_TICK_MS) return;
  if (!isMarketOpen(ctx.serverTime)) {
    // Market closed — monitor existing open trades for expiry
    _monitorOpenTrades(ctx);
    return;
  }
  _lastTickTime = now;

  const db = getDB();
  const session = getSession(ctx.serverTime);

  // 1. Monitor existing open trades (SL / Target / Expiry check)
  _monitorOpenTrades(ctx);

  // 2. Run each strategy config to see if entry condition met
  for (const strategy of STRATEGY_CONFIGS) {
    try {
      _runStrategy(db, strategy, ctx, session);
    } catch (e: any) {
      // Silent — never crash the tick loop
      console.error(`[MultiStrategyRunner] strategy ${strategy.id} error:`, e.message);
    }
  }

  // 3. Select & cache the best signal for frontend
  _updateBestSignal(db);

  db.close();
}

// ── Strategy Entry Logic ───────────────────────────────────────────────────────

function _runStrategy(
  db: Database.Database,
  strategy: StrategyConfig,
  ctx: MarketContext,
  session: "OPENING" | "MID" | "CLOSING" | "AFTER_HOURS",
): void {
  // Session check
  if (!strategy.sessions.includes("ANY") && !strategy.sessions.includes(session as any)) return;

  // ── CORE RULE: Ek index mein ek waqt mein sirf 1 Intraday + 1 Swing trade ──
  // Already have OPEN trade for this strategy?
  const existingStrategy = db.prepare(
    "SELECT id FROM ml_strategy_trades WHERE strategy_id = ? AND status = 'OPEN' LIMIT 1"
  ).get(strategy.id);
  if (existingStrategy) return; // Already in a trade for this exact strategy

  // Evaluate each instrument
  for (const instrument of strategy.instruments) {
    const spot = instrument === "NIFTY" ? ctx.niftySpot
               : instrument === "BANKNIFTY" ? ctx.bankniftySpot
               : ctx.sensexSpot;
    const score = instrument === "NIFTY" ? ctx.niftyScore
                : instrument === "BANKNIFTY" ? ctx.bankniftyScore
                : ctx.sensexScore;
    const pcr = instrument === "NIFTY" ? ctx.niftyPCR : ctx.bankniftyPCR;

    if (spot <= 0) continue;

    // ── KEY RULE: Is index + mode ke liye koi OPEN trade hai kya? ──
    // NIFTY ke liye ek INTRADAY + ek SWING — total 2 max per index
    const existingIndexModeTrade = db.prepare(`
      SELECT id FROM ml_strategy_trades
      WHERE instrument = ? AND mode = ? AND status = 'OPEN'
      LIMIT 1
    `).get(instrument, strategy.mode);
    if (existingIndexModeTrade) continue; // Is index ka is mode mein trade chal raha hai

    // Score check
    if (Math.abs(score) < strategy.minScore) continue;

    // PCR checks
    if (strategy.direction === "CE" || strategy.direction === "DYNAMIC") {
      if (strategy.minPCR && pcr < strategy.minPCR) continue;
    }
    if (strategy.direction === "PE" || strategy.direction === "DYNAMIC") {
      if (strategy.maxPCR && pcr > strategy.maxPCR) continue;
    }

    // Confidence check
    if (ctx.aiConfidence < strategy.minConfidence) continue;

    // Determine direction
    let direction: TradeDir;
    if (strategy.direction === "CE") {
      direction = "BUY_CE";
    } else if (strategy.direction === "PE") {
      direction = "BUY_PE";
    } else {
      // DYNAMIC — score se decide karo
      direction = score > 0 ? "BUY_CE" : "BUY_PE";
    }

    // Strike selection
    const strike = getATMStrike(spot, instrument);

    // Entry price estimate
    const entryPrice = estimateOptionPrice(spot, strike, direction, instrument);
    if (entryPrice <= 0) continue;

    // SL & Target
    const slPrice     = Math.round(entryPrice * (1 - strategy.slPct));
    const targetPrice = Math.round(entryPrice * (1 + strategy.tgtPct));

    // Get current stats for this strategy
    const stats = db.prepare(
      "SELECT win_rate, weight, is_blocked FROM ml_strategy_stats WHERE strategy_id = ?"
    ).get(strategy.id) as { win_rate: number; weight: number; is_blocked: number } | undefined;

    if (stats?.is_blocked) continue; // Blocked strategy — skip

    const winRate = stats?.win_rate ?? 0;
    const weight  = stats?.weight ?? 1.0;

    // Create trade record
    const trade: StrategyTradeRecord = {
      id:              `${strategy.id}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      strategy_id:     strategy.id,
      strategy_name:   strategy.name,
      mode:            strategy.mode,
      instrument,
      direction,
      strike,
      expiry:          "",
      entry_price:     entryPrice,
      sl_price:        slPrice,
      target_price:    targetPrice,
      exit_price:      null,
      status:          "OPEN",
      pnl:             0,
      pcr,
      nifty_score:     score,
      market_regime:   ctx.marketRegime,
      confidence:      ctx.aiConfidence,
      win_rate_at_entry: winRate,
      entry_time:      Date.now(),
      exit_time:       null,
      hold_minutes:    0,
      notes:           `${instrument} ${direction} | Score:${score.toFixed(1)} PCR:${pcr.toFixed(2)} Regime:${ctx.marketRegime}`,
    };

    // Save to DB
    db.prepare(`
      INSERT INTO ml_strategy_trades
      (id, strategy_id, strategy_name, mode, instrument, direction, strike, expiry,
       entry_price, sl_price, target_price, exit_price, status, pnl,
       pcr, nifty_score, market_regime, confidence, win_rate_at_entry,
       entry_time, exit_time, hold_minutes, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      trade.id, trade.strategy_id, trade.strategy_name, trade.mode,
      trade.instrument, trade.direction, trade.strike, trade.expiry,
      trade.entry_price, trade.sl_price, trade.target_price, null,
      "OPEN", 0, trade.pcr, trade.nifty_score, trade.market_regime,
      trade.confidence, trade.win_rate_at_entry, trade.entry_time, null, 0, trade.notes
    );

    // Add to in-memory map
    _openTrades.set(trade.id, trade);

    console.log(`[MultiStrategyRunner] ✅ ${strategy.mode} | ${strategy.name} | ${instrument} ${direction} Strike:${strike} @${entryPrice} | SL:${slPrice} T:${targetPrice}`);

    // Only 1 instrument per strategy per tick
    break;
  }
}

// ── Open Trade Monitor (SL / Target / Time check) ─────────────────────────────

function _monitorOpenTrades(ctx: MarketContext): void {
  const db = getDB();

  const openTrades = db.prepare(
    "SELECT * FROM ml_strategy_trades WHERE status = 'OPEN' LIMIT 500"
  ).all() as StrategyTradeRecord[];

  for (const trade of openTrades) {
    const spot = trade.instrument === "NIFTY" ? ctx.niftySpot
               : trade.instrument === "BANKNIFTY" ? ctx.bankniftySpot
               : ctx.sensexSpot;

    // Estimate current option price (very rough — without live option data)
    const currentPrice = estimateOptionPrice(spot, trade.strike, trade.direction, trade.instrument);
    const holdMins = (Date.now() - trade.entry_time) / 60000;

    // Get strategy config for maxHoldMins
    const stratCfg = STRATEGY_CONFIGS.find(s => s.id === trade.strategy_id);
    const maxHold  = stratCfg?.maxHoldMins ?? 90;

    let newStatus: TradeStatus | null = null;
    let exitPrice = currentPrice;

    // SL hit?
    if (currentPrice <= trade.sl_price) {
      newStatus = "SL_HIT";
      exitPrice = trade.sl_price;
    }
    // Target hit?
    else if (currentPrice >= trade.target_price) {
      newStatus = "TARGET_HIT";
      exitPrice = trade.target_price;
    }
    // Time expired?
    else if (holdMins >= maxHold) {
      newStatus = "EXPIRED";
      exitPrice = currentPrice;
    }

    if (newStatus) {
      const pnl = exitPrice - trade.entry_price;
      const isWin = pnl > 0;

      // Update trade record
      db.prepare(`
        UPDATE ml_strategy_trades
        SET status = ?, exit_price = ?, pnl = ?, exit_time = ?, hold_minutes = ?
        WHERE id = ?
      `).run(newStatus, exitPrice, pnl, Date.now(), holdMins, trade.id);

      // Update strategy stats
      _updateStats(db, trade.strategy_id, isWin, pnl);

      _openTrades.delete(trade.id);

      const emoji = isWin ? "🟢 WIN" : "🔴 LOSS";
      console.log(`[MultiStrategyRunner] ${emoji} | ${trade.strategy_name} | ${trade.instrument} ${trade.direction} | PnL: ${pnl > 0 ? "+" : ""}${pnl.toFixed(0)} | Reason: ${newStatus}`);
    }
  }

  db.close();
}

// ── Self-Learning: Update strategy stats & weights ───────────────────────────

function _updateStats(db: Database.Database, strategyId: string, isWin: boolean, pnl: number): void {
  const current = db.prepare(
    "SELECT * FROM ml_strategy_stats WHERE strategy_id = ?"
  ).get(strategyId) as StrategyStats | undefined;

  if (!current) return;

  const newWins   = current.wins   + (isWin ? 1 : 0);
  const newLosses = current.losses + (isWin ? 0 : 1);
  const newTotal  = current.total_trades + 1;
  const newWinRate = newTotal > 0 ? newWins / newTotal : 0;
  const newTotalPnl = current.total_pnl + pnl;
  const newAvgPnl  = newTotalPnl / newTotal;

  // ── Self-Learning Weight Update ─────────────────────────────────────────────
  // Win rate 70%+ → promote (weight up to 1.8)
  // Win rate 40-70% → neutral (weight 1.0)
  // Win rate <40% (min 5 trades) → demote / block
  let newWeight = current.weight;
  let isPromoted = current.is_promoted;
  let isBlocked  = current.is_blocked;

  if (newTotal >= 5) {
    if (newWinRate >= 0.70) {
      newWeight = Math.min(1.8, current.weight + 0.05);
      isPromoted = true;
      isBlocked  = false;
    } else if (newWinRate >= 0.50) {
      newWeight = 1.0;
      isPromoted = false;
      isBlocked  = false;
    } else if (newWinRate < 0.40 && newTotal >= 8) {
      newWeight = Math.max(0.3, current.weight - 0.1);
      isPromoted = false;
      if (newWinRate < 0.30 && newTotal >= 10) {
        isBlocked = true;  // Block karo — too many losses
      }
    }
  }

  db.prepare(`
    UPDATE ml_strategy_stats
    SET total_trades = ?, wins = ?, losses = ?, win_rate = ?,
        avg_pnl = ?, total_pnl = ?, weight = ?, is_promoted = ?, is_blocked = ?, last_updated = ?
    WHERE strategy_id = ?
  `).run(newTotal, newWins, newLosses, newWinRate, newAvgPnl, newTotalPnl, newWeight, isPromoted ? 1 : 0, isBlocked ? 1 : 0, Date.now(), strategyId);
}

// ── Best Signal Selector ───────────────────────────────────────────────────────

function _updateBestSignal(db: Database.Database): void {
  // Get all currently OPEN trades with their strategy stats
  const openTrades = db.prepare(`
    SELECT t.*, s.win_rate, s.weight, s.is_promoted, s.is_blocked
    FROM ml_strategy_trades t
    JOIN ml_strategy_stats s ON t.strategy_id = s.strategy_id
    WHERE t.status = 'OPEN' AND s.is_blocked = 0
    ORDER BY t.entry_time DESC
    LIMIT 100
  `).all() as any[];

  if (openTrades.length === 0) {
    _lastBestSignal = null;
    return;
  }

  // Composite score = confidence × win_rate_multiplier × weight
  // win_rate_multiplier: 0 trades = 0.5, 50% = 0.5, 70% = 1.0, 80% = 1.3
  let bestTrade: any = null;
  let bestScore = -Infinity;

  for (const trade of openTrades) {
    const winRateFactor = trade.win_rate < 0.5
      ? 0.6
      : trade.win_rate < 0.65
      ? 0.8
      : trade.win_rate < 0.75
      ? 1.0
      : 1.3;

    const composite = trade.confidence * winRateFactor * trade.weight;

    if (composite > bestScore) {
      bestScore = composite;
      bestTrade = trade;
    }
  }

  if (!bestTrade) {
    _lastBestSignal = null;
    return;
  }

  _lastBestSignal = {
    strategy_id:     bestTrade.strategy_id,
    strategy_name:   bestTrade.strategy_name,
    mode:            bestTrade.mode,
    instrument:      bestTrade.instrument,
    direction:       bestTrade.direction,
    strike:          bestTrade.strike,
    entry_price:     bestTrade.entry_price,
    sl_price:        bestTrade.sl_price,
    target_price:    bestTrade.target_price,
    confidence:      bestTrade.confidence,
    win_rate:        bestTrade.win_rate ?? 0,
    weight:          bestTrade.weight ?? 1,
    composite_score: bestScore,
    reason:          bestTrade.notes,
    generated_at:    Date.now(),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Frontend ke liye best signal return karo */
export function getBestSignal(): BestSignal | null {
  return _lastBestSignal;
}

/** Sabhi strategies ki stats return karo */
export function getAllStrategyStats(): StrategyStats[] {
  try {
    const db = getDB();
    const stats = db.prepare(
      "SELECT * FROM ml_strategy_stats ORDER BY win_rate DESC, total_trades DESC"
    ).all() as StrategyStats[];
    db.close();
    return stats;
  } catch (e: any) {
    console.error("[MultiStrategyRunner] getAllStrategyStats error:", e.message);
    return [];
  }
}

/** Recent trades return karo */
export function getRecentMLTrades(limit = 200): StrategyTradeRecord[] {
  try {
    const db = getDB();
    const trades = db.prepare(
      "SELECT * FROM ml_strategy_trades ORDER BY entry_time DESC LIMIT ?"
    ).all(limit) as StrategyTradeRecord[];
    db.close();
    return trades;
  } catch (e: any) {
    console.error("[MultiStrategyRunner] getRecentMLTrades error:", e.message);
    return [];
  }
}

/** Summary stats */
export function getMLSummary() {
  try {
    const db = getDB();
    const total = (db.prepare("SELECT COUNT(*) as c FROM ml_strategy_trades").get() as any).c;
    const open  = (db.prepare("SELECT COUNT(*) as c FROM ml_strategy_trades WHERE status = 'OPEN'").get() as any).c;
    const wins  = (db.prepare("SELECT COUNT(*) as c FROM ml_strategy_trades WHERE status = 'TARGET_HIT'").get() as any).c;
    const losses = (db.prepare("SELECT COUNT(*) as c FROM ml_strategy_trades WHERE status IN ('SL_HIT', 'EXPIRED') AND pnl < 0").get() as any).c;
    const totalPnl = (db.prepare("SELECT COALESCE(SUM(pnl), 0) as p FROM ml_strategy_trades WHERE status != 'OPEN'").get() as any).p;
    const promoted = (db.prepare("SELECT COUNT(*) as c FROM ml_strategy_stats WHERE is_promoted = 1").get() as any).c;
    const blocked  = (db.prepare("SELECT COUNT(*) as c FROM ml_strategy_stats WHERE is_blocked = 1").get() as any).c;
    db.close();
    return {
      totalTrades: total,
      openTrades: open,
      wins, losses,
      winRate: (total - open) > 0 ? wins / (total - open) : 0,
      totalPnl,
      promotedStrategies: promoted,
      blockedStrategies: blocked,
      activeStrategies: STRATEGY_CONFIGS.length,
    };
  } catch (e: any) {
    console.error("[MultiStrategyRunner] getMLSummary error:", e.message);
    return null;
  }
}
