/**
 * indicatorDB.ts — SQLite Persistence Layer for Enriched Candle Data
 *
 * Stores enriched candles (with indicator values) in a local SQLite database
 * for backtesting, strategy replay, and historical analysis.
 *
 * Database: server/storage/indicators.db
 *
 * Schema:
 *   TABLE enriched_candles (
 *     instrument TEXT,     -- "NIFTY" | "SENSEX"
 *     timeframe  TEXT,     -- "1m" | "5m" | "15m" | ...
 *     time       INTEGER,  -- Unix seconds (bucket start)
 *     open       REAL,
 *     high       REAL,
 *     low        REAL,
 *     close      REAL,
 *     volume     REAL,
 *     ema9       REAL,
 *     ema21      REAL,
 *     ema50      REAL,
 *     rsi        REAL,
 *     macd       REAL,
 *     macdSignal REAL,
 *     macdHistogram REAL,
 *     bbUpper    REAL,
 *     bbMiddle   REAL,
 *     bbLower    REAL,
 *     bbBandwidth REAL,
 *     vwap       REAL,
 *     PRIMARY KEY (instrument, timeframe, time)
 *   )
 *
 * Operations:
 *   upsertCandle()      — insert or replace a single enriched candle
 *   upsertBatch()       — bulk upsert (uses transaction for speed)
 *   queryCandles()      — fetch candles by instrument + timeframe + time range
 *   getLatest()         — get most recent N candles
 *   purgeOld()          — delete candles older than N days
 *   getRowCount()       — debug: total rows
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { EnrichedCandle } from "./indicatorEngine.js";

// ── Database Setup ───────────────────────────────────────────────────────────

const DB_DIR  = path.join(process.cwd(), "server", "storage");
const DB_PATH = path.join(DB_DIR, "indicators.db");

let _db: Database.Database | null = null;

function getDB(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);

  // WAL mode for concurrent reads + writes
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("cache_size = -64000"); // 64 MB cache

  // Create table if not exists
  _db.exec(`
    CREATE TABLE IF NOT EXISTS enriched_candles (
      instrument    TEXT    NOT NULL,
      timeframe     TEXT    NOT NULL,
      time          INTEGER NOT NULL,
      open          REAL,
      high          REAL,
      low           REAL,
      close         REAL,
      volume        REAL,
      ema9          REAL,
      ema21         REAL,
      ema50         REAL,
      rsi           REAL,
      macd          REAL,
      macdSignal    REAL,
      macdHistogram REAL,
      bbUpper       REAL,
      bbMiddle      REAL,
      bbLower       REAL,
      bbBandwidth   REAL,
      vwap          REAL,
      PRIMARY KEY (instrument, timeframe, time)
    );
  `);

  // Create index for time-range queries
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_candles_time
    ON enriched_candles (instrument, timeframe, time);
  `);

  console.log(`[IndicatorDB] ✅ SQLite database opened: ${DB_PATH}`);
  return _db;
}

// ── Prepared Statements (cached for performance) ─────────────────────────────

let _upsertStmt: Database.Statement | null = null;

function getUpsertStmt(): Database.Statement {
  if (_upsertStmt) return _upsertStmt;
  const db = getDB();
  _upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO enriched_candles (
      instrument, timeframe, time,
      open, high, low, close, volume,
      ema9, ema21, ema50,
      rsi,
      macd, macdSignal, macdHistogram,
      bbUpper, bbMiddle, bbLower, bbBandwidth,
      vwap
    ) VALUES (
      @instrument, @timeframe, @time,
      @open, @high, @low, @close, @volume,
      @ema9, @ema21, @ema50,
      @rsi,
      @macd, @macdSignal, @macdHistogram,
      @bbUpper, @bbMiddle, @bbLower, @bbBandwidth,
      @vwap
    )
  `);
  return _upsertStmt;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Upsert a single enriched candle into the database.
 * Uses INSERT OR REPLACE on the composite primary key.
 */
export function upsertCandle(
  instrument: string,
  timeframe:  string,
  candle:     EnrichedCandle,
): void {
  try {
    getUpsertStmt().run({
      instrument,
      timeframe,
      time:          candle.time,
      open:          candle.open,
      high:          candle.high,
      low:           candle.low,
      close:         candle.close,
      volume:        candle.volume,
      ema9:          candle.ema9,
      ema21:         candle.ema21,
      ema50:         candle.ema50,
      rsi:           candle.rsi,
      macd:          candle.macd,
      macdSignal:    candle.macdSignal,
      macdHistogram: candle.macdHistogram,
      bbUpper:       candle.bbUpper,
      bbMiddle:      candle.bbMiddle,
      bbLower:       candle.bbLower,
      bbBandwidth:   candle.bbBandwidth,
      vwap:          candle.vwap,
    });
  } catch (e) {
    console.warn("[IndicatorDB] Upsert failed:", (e as Error).message);
  }
}

/**
 * Bulk upsert a batch of enriched candles.
 * Wrapped in a transaction for ~100× speed improvement over individual inserts.
 *
 * Typical: 2000 candles in ~5ms
 */
export function upsertBatch(
  instrument: string,
  timeframe:  string,
  candles:    EnrichedCandle[],
): void {
  if (candles.length === 0) return;

  const db   = getDB();
  const stmt = getUpsertStmt();

  const insertMany = db.transaction((items: EnrichedCandle[]) => {
    for (const c of items) {
      stmt.run({
        instrument,
        timeframe,
        time:          c.time,
        open:          c.open,
        high:          c.high,
        low:           c.low,
        close:         c.close,
        volume:        c.volume,
        ema9:          c.ema9,
        ema21:         c.ema21,
        ema50:         c.ema50,
        rsi:           c.rsi,
        macd:          c.macd,
        macdSignal:    c.macdSignal,
        macdHistogram: c.macdHistogram,
        bbUpper:       c.bbUpper,
        bbMiddle:      c.bbMiddle,
        bbLower:       c.bbLower,
        bbBandwidth:   c.bbBandwidth,
        vwap:          c.vwap,
      });
    }
  });

  try {
    insertMany(candles);
    console.log(`[IndicatorDB] Upserted ${candles.length} candles (${instrument} ${timeframe})`);
  } catch (e) {
    console.warn("[IndicatorDB] Batch upsert failed:", (e as Error).message);
  }
}

/**
 * Query enriched candles by instrument, timeframe, and optional time range.
 *
 * @param from - Unix seconds start (inclusive), defaults to 0
 * @param to   - Unix seconds end (inclusive), defaults to now
 * @param limit - Max rows returned, defaults to 2000
 */
export function queryCandles(
  instrument: string,
  timeframe:  string,
  from  = 0,
  to    = Math.floor(Date.now() / 1000),
  limit = 2000,
): EnrichedCandle[] {
  try {
    const db = getDB();
    const rows = db.prepare(`
      SELECT * FROM enriched_candles
      WHERE instrument = ? AND timeframe = ?
        AND time >= ? AND time <= ?
      ORDER BY time ASC
      LIMIT ?
    `).all(instrument, timeframe, from, to, limit) as EnrichedCandle[];

    return rows;
  } catch (e) {
    console.warn("[IndicatorDB] Query failed:", (e as Error).message);
    return [];
  }
}

/**
 * Get the most recent N candles for an instrument + timeframe.
 */
export function getLatest(
  instrument: string,
  timeframe:  string,
  count = 200,
): EnrichedCandle[] {
  try {
    const db = getDB();
    const rows = db.prepare(`
      SELECT * FROM enriched_candles
      WHERE instrument = ? AND timeframe = ?
      ORDER BY time DESC
      LIMIT ?
    `).all(instrument, timeframe, count) as EnrichedCandle[];

    return rows.reverse(); // Return in ascending time order
  } catch (e) {
    console.warn("[IndicatorDB] getLatest failed:", (e as Error).message);
    return [];
  }
}

/**
 * Purge candles older than N days.
 * Call periodically (e.g., daily) to prevent unbounded DB growth.
 */
export function purgeOld(days = 90): number {
  try {
    const db      = getDB();
    const cutoff  = Math.floor(Date.now() / 1000) - days * 86400;
    const result  = db.prepare(`
      DELETE FROM enriched_candles WHERE time < ?
    `).run(cutoff);

    if (result.changes > 0) {
      console.log(`[IndicatorDB] Purged ${result.changes} candles older than ${days} days`);
    }
    return result.changes;
  } catch (e) {
    console.warn("[IndicatorDB] Purge failed:", (e as Error).message);
    return 0;
  }
}

/**
 * Get total row count (debug/monitoring).
 */
export function getRowCount(): number {
  try {
    const db  = getDB();
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM enriched_candles`).get() as { cnt: number };
    return row.cnt;
  } catch {
    return 0;
  }
}

/**
 * Initialize DB (ensure file + table exist). Idempotent.
 */
export function initIndicatorDB(): void {
  getDB();
}

/**
 * Close DB connection cleanly. Call on server shutdown.
 */
export function closeIndicatorDB(): void {
  if (_db) {
    _db.close();
    _db = null;
    _upsertStmt = null;
    console.log("[IndicatorDB] Database closed.");
  }
}
