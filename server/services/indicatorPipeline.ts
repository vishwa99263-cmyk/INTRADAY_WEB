/**
 * indicatorPipeline.ts — Orchestrator connecting Candle Engine → Indicator Engine → DB → Socket.IO
 *
 * Data flow:
 *   chartRealtime.ts (tick → candle)
 *     → indicatorEngine.ts (candle → enriched candle)
 *       → indicatorDB.ts (enriched candle → SQLite)
 *         → Socket.IO (enriched candle → React frontend / analyzer engine)
 *
 * Architecture:
 *   - Subscribes to chartRealtime broadcast events
 *   - On every candle update: enrichLast() → upsertCandle() → emit "enriched-candle"
 *   - On history load: enrichCandles() → upsertBatch() → emit "enriched-history"
 *   - Every 5 minutes: persist full enriched snapshot to DB (belt-and-suspenders)
 *   - Daily at IST 16:30: purge candles older than 90 days
 *
 * Socket.IO events emitted:
 *   "enriched-candle"    — single enriched candle per tick (realtime)
 *   "enriched-history"   — full enriched history for a TF (on client connect / request)
 *   "indicator-snapshot"  — latest indicator values summary (on request)
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import {
  getRTCandles,
  getAllRTCandles,
  type RTInstrument,
  type RTTimeframe,
} from "./chartRealtime.js";
import {
  enrichCandles,
  enrichLast,
  getIndicatorSummary,
  getEnrichedHistory,
  type EnrichedCandle,
  type RawCandle,
} from "./indicatorEngine.js";
import {
  initIndicatorDB,
  upsertCandle,
  upsertBatch,
  queryCandles,
  getLatest,
  purgeOld,
  getRowCount,
} from "./indicatorDB.js";

// ── State ────────────────────────────────────────────────────────────────────

let _io: SocketIOServer | null = null;

/** In-memory cache of the latest enriched candle per instrument + TF */
const latestEnriched: Record<string, Record<string, EnrichedCandle | null>> = {
  NIFTY:  { "1m": null, "3m": null, "5m": null, "15m": null, "30m": null, "1H": null, "1D": null },
  SENSEX: { "1m": null, "3m": null, "5m": null, "15m": null, "30m": null, "1H": null, "1D": null },
  BANKNIFTY: { "1m": null, "3m": null, "5m": null, "15m": null, "30m": null, "1H": null, "1D": null },
};

const ALL_INSTRUMENTS: RTInstrument[] = ["NIFTY", "SENSEX", "BANKNIFTY"];
const ALL_TIMEFRAMES: RTTimeframe[]   = ["1m", "3m", "5m", "15m", "30m", "1H", "1D"];

// Throttle: don't broadcast enriched candles more than every 200ms per instrument+tf
const lastBroadcast: Record<string, number> = {};
const BROADCAST_THROTTLE = 200;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the indicator pipeline.
 *
 * Must be called AFTER initChartRealtime() so candle stores are populated.
 */
export function initIndicatorPipeline(io: SocketIOServer): void {
  _io = io;

  // 1. Init SQLite database
  initIndicatorDB();

  // 2. Enrich + persist existing candle history
  for (const inst of ALL_INSTRUMENTS) {
    for (const tf of ALL_TIMEFRAMES) {
      const raw = getRTCandles(inst, tf);
      if (raw.length > 0) {
        const enriched = enrichCandles(raw as RawCandle[]);
        upsertBatch(inst, tf, enriched);

        // Cache latest
        if (enriched.length > 0) {
          latestEnriched[inst][tf] = enriched[enriched.length - 1];
        }
      }
    }
  }

  // 3. Register Socket.IO handlers for client requests
  io.on("connection", (socket: Socket) => {
    // Client requests enriched history for specific instrument + tf
    socket.on("request-enriched-history", (payload: { instrument: string; timeframe: string }) => {
      const { instrument, timeframe } = payload;
      if (!ALL_INSTRUMENTS.includes(instrument as RTInstrument)) return;

      const raw      = getRTCandles(instrument as RTInstrument, timeframe as RTTimeframe);
      const enriched = enrichCandles(raw as RawCandle[]);

      socket.emit("enriched-history", {
        instrument,
        timeframe,
        timestamp: Date.now(),
        count:     enriched.length,
        candles:   enriched,
      });
    });

    // Client requests latest indicator snapshot
    socket.on("request-indicator-snapshot", (payload: { instrument: string; timeframe: string }) => {
      const { instrument, timeframe } = payload;
      const raw     = getRTCandles(instrument as RTInstrument, timeframe as RTTimeframe);
      const summary = getIndicatorSummary(raw as RawCandle[], instrument, timeframe);

      socket.emit("indicator-snapshot", summary);
    });

    // Client requests enriched candles from DB (historical / backtesting)
    socket.on("request-db-candles", (payload: {
      instrument: string; timeframe: string; from?: number; to?: number; limit?: number;
    }) => {
      const rows = queryCandles(
        payload.instrument,
        payload.timeframe,
        payload.from,
        payload.to,
        payload.limit,
      );
      socket.emit("db-candles", {
        instrument: payload.instrument,
        timeframe:  payload.timeframe,
        count:      rows.length,
        candles:    rows,
      });
    });
  });

  // 4. Periodic full DB persist (every 5 minutes)
  setInterval(() => {
    for (const inst of ALL_INSTRUMENTS) {
      for (const tf of ALL_TIMEFRAMES) {
        const raw = getRTCandles(inst, tf);
        if (raw.length === 0) continue;
        const enriched = enrichCandles(raw as RawCandle[]);
        upsertBatch(inst, tf, enriched);
      }
    }
  }, 5 * 60 * 1000);

  // 5. Daily purge at startup (candles older than 90 days)
  purgeOld(90);

  const dbRows = getRowCount();
  console.log(`[IndicatorPipeline] ✅ Initialised — ${dbRows} rows in DB`);
}

/**
 * Process a new candle update from chartRealtime.
 *
 * Call this from the broadcast event handler in chartRealtime.ts
 * (or from a patched feedIndexTick).
 *
 * Flow: getRTCandles → enrichLast → upsertCandle → emit "enriched-candle"
 */
export function processTickEnrichment(
  inst: RTInstrument,
  tf:   RTTimeframe,
): void {
  const raw = getRTCandles(inst, tf);
  if (raw.length === 0) return;

  // Enrich only the last candle (O(1) via sliding window)
  const enriched = enrichLast(raw as RawCandle[]);
  if (!enriched) return;

  // Cache in memory
  latestEnriched[inst][tf] = enriched;

  // Persist to SQLite (on every tick for 1m only; others at 5-min interval)
  if (tf === "1m" || tf === "5m") {
    upsertCandle(inst, tf, enriched);
  }

  // Throttled broadcast
  const key = `${inst}_${tf}`;
  const now = Date.now();
  if (now - (lastBroadcast[key] ?? 0) < BROADCAST_THROTTLE) return;
  lastBroadcast[key] = now;

  if (_io) {
    _io.emit("enriched-candle", {
      instrument: inst,
      timeframe:  tf,
      timestamp:  now,
      candle:     enriched,
    });
  }
}

/**
 * Get the latest enriched candle for an instrument + timeframe.
 * Used by REST endpoints.
 */
export function getLatestEnriched(
  inst: string,
  tf:   string,
): EnrichedCandle | null {
  return latestEnriched[inst]?.[tf] ?? null;
}

/**
 * Get enriched history from DB (for REST API).
 */
export function getEnrichedFromDB(
  instrument: string,
  timeframe:  string,
  count = 200,
): EnrichedCandle[] {
  return getLatest(instrument, timeframe, count);
}
