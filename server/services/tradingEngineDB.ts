/**
 * tradingEngineDB.ts
 *
 * Persistent storage for the Trading Engine Dashboard.
 * Uses the existing indicators.db SQLite database.
 *
 * Tables:
 *   te_signals       — AI signal history (unlimited, indexed by timestamp)
 *   te_paper_trades  — Paper trade ledger
 *   te_lot_config    — User-configurable lot sizes per instrument
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ── Database connection ────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "server", "storage", "indicators.db");
let _db: Database.Database | null = null;

function getDB(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { timeout: 5000 });
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    initTables(_db);
  }
  return _db;
}

// ── Table init ─────────────────────────────────────────────────────────────────

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS te_signals (
      id            TEXT PRIMARY KEY,
      timestamp     INTEGER NOT NULL,
      instrument    TEXT NOT NULL,
      signal        TEXT NOT NULL,
      confidence    REAL NOT NULL,
      grade         TEXT,
      reason        TEXT,
      entry_price   REAL,
      exit_price    REAL,
      target        REAL,
      stop_loss     REAL,
      pnl           REAL,
      result        TEXT DEFAULT 'PENDING',
      breadth_score REAL,
      momentum_score REAL,
      oi_score      REAL,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_te_signals_ts ON te_signals(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_te_signals_inst ON te_signals(instrument);

    CREATE TABLE IF NOT EXISTS te_paper_trades (
      id            TEXT PRIMARY KEY,
      timestamp     INTEGER NOT NULL,
      instrument    TEXT NOT NULL,
      direction     TEXT NOT NULL,
      strike        REAL NOT NULL,
      entry_price   REAL NOT NULL,
      qty           INTEGER NOT NULL,
      lot_size      INTEGER NOT NULL,
      stop_loss     REAL NOT NULL,
      target        REAL NOT NULL,
      exit_price    REAL,
      status        TEXT NOT NULL DEFAULT 'OPEN',
      pnl           REAL DEFAULT 0,
      notes         TEXT DEFAULT '',
      signal_ref    TEXT,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      closed_at     INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_te_paper_ts ON te_paper_trades(timestamp DESC);

    CREATE TABLE IF NOT EXISTS te_shadow_trades (
      id            TEXT PRIMARY KEY,
      timestamp     INTEGER NOT NULL,
      instrument    TEXT NOT NULL,
      direction     TEXT NOT NULL,
      strike        REAL NOT NULL,
      entry_price   REAL NOT NULL,
      qty           INTEGER NOT NULL,
      lot_size      INTEGER NOT NULL,
      stop_loss     REAL NOT NULL,
      target        REAL NOT NULL,
      exit_price    REAL,
      status        TEXT NOT NULL DEFAULT 'OPEN',
      pnl           REAL DEFAULT 0,
      notes         TEXT DEFAULT '',
      signal_ref    TEXT,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      closed_at     INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_te_shadow_ts ON te_shadow_trades(timestamp DESC);

    CREATE TABLE IF NOT EXISTS te_lot_config (
      instrument    TEXT PRIMARY KEY,
      lot_size      INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS te_fii_dii (
      date          TEXT PRIMARY KEY,
      fii_cash      REAL NOT NULL,
      dii_cash      REAL NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
  `);

  // Seed default lot sizes if empty
  const count = db.prepare("SELECT COUNT(*) as c FROM te_lot_config").get() as { c: number };
  if (count.c === 0) {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO te_lot_config (instrument, lot_size) VALUES (?, ?)"
    );
    const defaults: [string, number][] = [
      ["NIFTY",     65],
      ["BANKNIFTY", 35],
      ["SENSEX",    20],
      ["FINNIFTY",  40],
      ["MIDCPNIFTY",75],
    ];
    for (const [inst, size] of defaults) {
      insert.run(inst, size);
    }
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TESignal {
  id: string;
  timestamp: number;
  instrument: string;
  signal: string;
  confidence: number;
  grade?: string;
  reason?: string;
  entry_price?: number;
  exit_price?: number;
  target?: number;
  stop_loss?: number;
  pnl?: number;
  result: "PENDING" | "WIN" | "LOSS" | "NEUTRAL" | "SKIPPED";
  breadth_score?: number;
  momentum_score?: number;
  oi_score?: number;
  created_at: number;
}

export interface TEPaperTrade {
  id: string;
  timestamp: number;
  instrument: string;
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  entry_price: number;
  qty: number;
  lot_size: number;
  stop_loss: number;
  target: number;
  exit_price?: number;
  status: "OPEN" | "CLOSED";
  pnl: number;
  notes: string;
  signal_ref?: string;
  created_at: number;
  closed_at?: number;
  latest_ltp?: number;
}

export interface TELotConfig {
  instrument: string;
  lot_size: number;
  updated_at: number;
}

// ── Signal History ─────────────────────────────────────────────────────────────

export function saveSignal(signal: Omit<TESignal, "created_at">): void {
  try {
    const db = getDB();
    db.prepare(`
      INSERT OR REPLACE INTO te_signals
      (id, timestamp, instrument, signal, confidence, grade, reason, entry_price, exit_price, target, stop_loss, pnl, result, breadth_score, momentum_score, oi_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signal.id,
      signal.timestamp,
      signal.instrument,
      signal.signal,
      signal.confidence,
      signal.grade ?? null,
      signal.reason ?? null,
      signal.entry_price ?? null,
      signal.exit_price ?? null,
      signal.target ?? null,
      signal.stop_loss ?? null,
      signal.pnl ?? null,
      signal.result,
      signal.breadth_score ?? null,
      signal.momentum_score ?? null,
      signal.oi_score ?? null,
      Date.now(),
    );
  } catch (e: any) {
    console.error("[TradingEngineDB] saveSignal error:", e.message);
  }
}

export function getSignals(
  instrument?: string,
  limit = 200,
  daysBack = 90,
): TESignal[] {
  try {
    const db = getDB();
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    if (instrument) {
      return db.prepare(
        "SELECT * FROM te_signals WHERE instrument = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?"
      ).all(instrument, cutoff, limit) as TESignal[];
    }
    return db.prepare(
      "SELECT * FROM te_signals WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?"
    ).all(cutoff, limit) as TESignal[];
  } catch (e: any) {
    console.error("[TradingEngineDB] getSignals error:", e.message);
    return [];
  }
}

export function updateSignalResult(
  id: string,
  result: TESignal["result"],
  exitPrice?: number,
  pnl?: number,
): void {
  try {
    const db = getDB();
    db.prepare(
      "UPDATE te_signals SET result = ?, exit_price = ?, pnl = ? WHERE id = ?"
    ).run(result, exitPrice ?? null, pnl ?? null, id);
  } catch (e: any) {
    console.error("[TradingEngineDB] updateSignalResult error:", e.message);
  }
}

// ── Paper Trades ───────────────────────────────────────────────────────────────

export function savePaperTrade(trade: Omit<TEPaperTrade, "created_at">): void {
  try {
    const db = getDB();
    db.prepare(`
      INSERT OR REPLACE INTO te_paper_trades
      (id, timestamp, instrument, direction, strike, entry_price, qty, lot_size, stop_loss, target, exit_price, status, pnl, notes, signal_ref, created_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.id,
      trade.timestamp,
      trade.instrument,
      trade.direction,
      trade.strike,
      trade.entry_price,
      trade.qty,
      trade.lot_size,
      trade.stop_loss,
      trade.target,
      trade.exit_price ?? null,
      trade.status,
      trade.pnl,
      trade.notes,
      trade.signal_ref ?? null,
      Date.now(),
      trade.closed_at ?? null,
    );
  } catch (e: any) {
    console.error("[TradingEngineDB] savePaperTrade error:", e.message);
  }
}

export function getPaperTrades(status?: "OPEN" | "CLOSED", limit = 1000): TEPaperTrade[] {
  try {
    const db = getDB();
    let query = "SELECT * FROM te_paper_trades";
    const conditions: string[] = [
      "direction NOT IN ('BULL_SPREAD', 'BEAR_SPREAD') AND notes NOT LIKE '%Spread Hedge%'"
    ];
    const params: any[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    return db.prepare(query).all(...params) as TEPaperTrade[];
  } catch (e: any) {
    console.error("[TradingEngineDB] getPaperTrades error:", e.message);
    return [];
  }
}

export function closePaperTrade(
  id: string,
  exitPrice: number,
  pnl: number,
): boolean {
  try {
    const db = getDB();
    const result = db.prepare(
      "UPDATE te_paper_trades SET status = 'CLOSED', exit_price = ?, pnl = ?, closed_at = ? WHERE id = ? AND status = 'OPEN'"
    ).run(exitPrice, pnl, Date.now(), id);
    return (result.changes ?? 0) > 0;
  } catch (e: any) {
    console.error("[TradingEngineDB] closePaperTrade error:", e.message);
    return false;
  }
}

export function updatePaperTradeSL(id: string, newStopLoss: number): boolean {
  try {
    const db = getDB();
    const result = db.prepare(
      "UPDATE te_paper_trades SET stop_loss = ? WHERE id = ? AND status = 'OPEN'"
    ).run(newStopLoss, id);
    return (result.changes ?? 0) > 0;
  } catch (e: any) {
    console.error("[TradingEngineDB] updatePaperTradeSL error:", e.message);
    return false;
  }
}

export function saveShadowTrade(trade: Omit<TEPaperTrade, "created_at">): void {
  try {
    const db = getDB();
    db.prepare(`
      INSERT OR REPLACE INTO te_shadow_trades
      (id, timestamp, instrument, direction, strike, entry_price, qty, lot_size, stop_loss, target, exit_price, status, pnl, notes, signal_ref, created_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.id,
      trade.timestamp,
      trade.instrument,
      trade.direction,
      trade.strike,
      trade.entry_price,
      trade.qty,
      trade.lot_size,
      trade.stop_loss,
      trade.target,
      trade.exit_price ?? null,
      trade.status,
      trade.pnl,
      trade.notes,
      trade.signal_ref ?? null,
      Date.now(),
      trade.closed_at ?? null,
    );
  } catch (e: any) {
    console.error("[TradingEngineDB] saveShadowTrade error:", e.message);
  }
}

export function getShadowTrades(status?: "OPEN" | "CLOSED", limit = 1000): TEPaperTrade[] {
  try {
    const db = getDB();
    let query = "SELECT * FROM te_shadow_trades";
    const conditions: string[] = ["1=1"];
    const params: any[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    return db.prepare(query).all(...params) as TEPaperTrade[];
  } catch (e: any) {
    console.error("[TradingEngineDB] getShadowTrades error:", e.message);
    return [];
  }
}

export function closeShadowTrade(
  id: string,
  exitPrice: number,
  pnl: number,
): boolean {
  try {
    const db = getDB();
    const result = db.prepare(
      "UPDATE te_shadow_trades SET status = 'CLOSED', exit_price = ?, pnl = ?, closed_at = ? WHERE id = ? AND status = 'OPEN'"
    ).run(exitPrice, pnl, Date.now(), id);
    return (result.changes ?? 0) > 0;
  } catch (e: any) {
    console.error("[TradingEngineDB] closeShadowTrade error:", e.message);
    return false;
  }
}

export function updateShadowTradeSL(id: string, newStopLoss: number): boolean {
  try {
    const db = getDB();
    const result = db.prepare(
      "UPDATE te_shadow_trades SET stop_loss = ? WHERE id = ? AND status = 'OPEN'"
    ).run(newStopLoss, id);
    return (result.changes ?? 0) > 0;
  } catch (e: any) {
    console.error("[TradingEngineDB] updateShadowTradeSL error:", e.message);
    return false;
  }
}

export function updatePaperTradeNotes(id: string, notes: string): void {
  try {
    const db = getDB();
    db.prepare("UPDATE te_paper_trades SET notes = ? WHERE id = ?").run(notes, id);
  } catch (e: any) {
    console.error("[TradingEngineDB] updatePaperTradeNotes error:", e.message);
  }
}

export function deletePaperTrade(id: string): boolean {
  try {
    const db = getDB();
    const result = db.prepare("DELETE FROM te_paper_trades WHERE id = ?").run(id);
    return (result.changes ?? 0) > 0;
  } catch (e: any) {
    console.error("[TradingEngineDB] deletePaperTrade error:", e.message);
    return false;
  }
}

// ── Lot Config ─────────────────────────────────────────────────────────────────

export function getLotConfig(): TELotConfig[] {
  try {
    const db = getDB();
    return db.prepare("SELECT * FROM te_lot_config ORDER BY instrument ASC").all() as TELotConfig[];
  } catch (e: any) {
    console.error("[TradingEngineDB] getLotConfig error:", e.message);
    return [];
  }
}

const DEFAULT_LOT_SIZES: Record<string, number> = {
  NIFTY:     65,
  BANKNIFTY: 35,
  SENSEX:    20,
  FINNIFTY:  40,
  MIDCPNIFTY:75,
  HDFCBANK:  550,
  RELIANCE:  250,
  ICICIBANK: 700,
};

export function getLotSize(instrument: string): number {
  try {
    const db = getDB();
    const row = db.prepare("SELECT lot_size FROM te_lot_config WHERE instrument = ?").get(instrument.toUpperCase()) as { lot_size: number } | undefined;
    if (row && row.lot_size > 0) return row.lot_size;
    return DEFAULT_LOT_SIZES[instrument.toUpperCase()] ?? 1;
  } catch {
    return DEFAULT_LOT_SIZES[instrument.toUpperCase()] ?? 1;
  }
}

export function updateLotConfig(instrument: string, lotSize: number): void {
  try {
    const db = getDB();
    db.prepare(`
      INSERT INTO te_lot_config (instrument, lot_size, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(instrument) DO UPDATE SET lot_size = excluded.lot_size, updated_at = excluded.updated_at
    `).run(instrument.toUpperCase(), lotSize, Date.now());
  } catch (e: any) {
    console.error("[TradingEngineDB] updateLotConfig error:", e.message);
  }
}

export function upsertLotConfigs(configs: { instrument: string; lot_size: number }[]): void {
  try {
    const db = getDB();
    const upsert = db.prepare(`
      INSERT INTO te_lot_config (instrument, lot_size, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(instrument) DO UPDATE SET lot_size = excluded.lot_size, updated_at = excluded.updated_at
    `);
    const tx = db.transaction(() => {
      for (const c of configs) {
        upsert.run(c.instrument.toUpperCase(), c.lot_size, Date.now());
      }
    });
    tx();
  } catch (e: any) {
    console.error("[TradingEngineDB] upsertLotConfigs error:", e.message);
  }
}

export function activatePaperTrade(id: string): boolean {
  try {
    const db = getDB();
    const result = db.prepare(
      "UPDATE te_paper_trades SET status = 'OPEN', timestamp = ?, created_at = ? WHERE id = ? AND status = 'PENDING'"
    ).run(Date.now(), Date.now(), id);
    return (result.changes ?? 0) > 0;
  } catch (e: any) {
    console.error("[TradingEngineDB] activatePaperTrade error:", e.message);
    return false;
  }
}

export interface TEFiiDii {
  date: string;
  fii_cash: number;
  dii_cash: number;
  created_at: number;
}

export function saveFiiDii(date: string, fiiCash: number, diiCash: number): void {
  try {
    const db = getDB();
    db.prepare(`
      INSERT OR REPLACE INTO te_fii_dii (date, fii_cash, dii_cash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(date, fiiCash, diiCash, Date.now());
  } catch (e: any) {
    console.error("[TradingEngineDB] saveFiiDii error:", e.message);
  }
}

export function getFiiDiiHistory(limit = 30): TEFiiDii[] {
  try {
    const db = getDB();
    return db.prepare(
      "SELECT * FROM te_fii_dii ORDER BY date DESC LIMIT ?"
    ).all(limit) as TEFiiDii[];
  } catch (e: any) {
    console.error("[TradingEngineDB] getFiiDiiHistory error:", e.message);
    return [];
  }
}
