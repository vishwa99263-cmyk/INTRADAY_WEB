/**
 * chartRealtime.ts — Dedicated NIFTY/SENSEX Realtime Candle Engine
 *
 * Responsibilities:
 *   1. Initialize from historical data (Fyers API or cache)
 *   2. Merge live Fyers WebSocket ticks into current open candle
 *   3. Broadcast "index-chart-candle" events via Socket.IO
 *   4. Persist candle state every 60s to chart-cache/
 *
 * Supported instruments:
 *   "NIFTY"  → NSE:NIFTY50-INDEX
 *   "SENSEX" → BSE:SENSEX-INDEX
 *
 * Timeframes: 1m, 3m, 5m, 15m, 30m, 1H, 1D
 */

import { Server as SocketIOServer } from "socket.io";
import { saveHistoryCache, loadHistoryCache } from "./chartHistory.js";
import type { HistoryCandle } from "./chartHistory.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RTInstrument = "NIFTY" | "SENSEX" | "BANKNIFTY";

export type RTTimeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1H" | "1D";

export interface RTCandle {
  time:   number; // Unix seconds bucket start
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const FYERS_SYMBOL: Record<RTInstrument, string> = {
  NIFTY:  "NSE:NIFTY50-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
};

const TF_SECONDS: Record<RTTimeframe, number> = {
  "1m":  60,
  "3m":  180,
  "5m":  300,
  "15m": 900,
  "30m": 1800,
  "1H":  3600,
  "1D":  86400,
};

const FYERS_RESOLUTION: Record<RTTimeframe, string> = {
  "1m":  "1",
  "3m":  "3",
  "5m":  "5",
  "15m": "15",
  "30m": "30",
  "1H":  "60",
  "1D":  "D",
};

const ALL_TF: RTTimeframe[] = ["1m", "3m", "5m", "15m", "30m", "1H", "1D"];
const MAX_CANDLES = 2000;
const BROADCAST_THROTTLE_MS = 80;
const PERSIST_INTERVAL_MS   = 60_000;

// ── In-memory store ────────────────────────────────────────────────────────────

type CandleStore = Record<RTInstrument, Record<RTTimeframe, RTCandle[]>>;

const store: CandleStore = {
  NIFTY:  { "1m": [], "3m": [], "5m": [], "15m": [], "30m": [], "1H": [], "1D": [] },
  SENSEX: { "1m": [], "3m": [], "5m": [], "15m": [], "30m": [], "1H": [], "1D": [] },
  BANKNIFTY: { "1m": [], "3m": [], "5m": [], "15m": [], "30m": [], "1H": [], "1D": [] },
};

let _io: SocketIOServer | null = null;

// ── Post-broadcast hook (for indicator pipeline) ──────────────────────────────

type BroadcastHook = (inst: RTInstrument, tf: RTTimeframe) => void;
let _onBroadcast: BroadcastHook | null = null;

/** Register a callback to be invoked after every candle broadcast */
export function onCandleBroadcast(fn: BroadcastHook): void {
  _onBroadcast = fn;
}

// ── Throttle state ─────────────────────────────────────────────────────────────

const _pendingBroadcast: Map<string, { inst: RTInstrument; tf: RTTimeframe }> = new Map();
let _broadcastTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBroadcast(inst: RTInstrument, tf: RTTimeframe): void {
  _pendingBroadcast.set(`${inst}|${tf}`, { inst, tf });
  if (_broadcastTimer) return;
  _broadcastTimer = setTimeout(() => {
    _broadcastTimer = null;

    // Snapshot + clear pending set
    const pending = [..._pendingBroadcast.values()];
    _pendingBroadcast.clear();

    // Broadcast candle updates via Socket.IO
    if (_io) {
      for (const { inst: i, tf: t } of pending) {
        const arr = store[i][t];
        if (arr.length === 0) continue;
        _io.emit("index-chart-candle", {
          instrument: i,
          tf:         t,
          candle:     arr[arr.length - 1],
        });
      }
    }

    // Notify indicator pipeline (non-blocking)
    if (_onBroadcast) {
      for (const { inst: ii, tf: tt } of pending) {
        try { _onBroadcast(ii, tt); } catch (_e) { /* non-blocking */ }
      }
    }
  }, BROADCAST_THROTTLE_MS);
}

// ── Candle logic ───────────────────────────────────────────────────────────────

function bucketTime(nowSec: number, tfSec: number): number {
  // Align to IST (UTC+5:30 = 19800s offset)
  // For daily candles align to IST midnight
  if (tfSec === 86400) {
    const istSec = nowSec + 19800;
    return Math.floor(istSec / tfSec) * tfSec - 19800;
  }
  return nowSec - (nowSec % tfSec);
}

function updateCandle(arr: RTCandle[], t: number, price: number, vol: number): void {
  const last = arr[arr.length - 1];

  if (!last || last.time !== t) {
    // Open new candle — open = previous close for gap-free chart
    arr.push({
      time:   t,
      open:   last?.close ?? price,
      high:   price,
      low:    price,
      close:  price,
      volume: vol,
    });
    if (arr.length > MAX_CANDLES) arr.shift();
  } else {
    last.high    = Math.max(last.high, price);
    last.low     = Math.min(last.low,  price);
    last.close   = price;
    last.volume += vol;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialize: load cache into memory store.
 * Call this BEFORE init fyers socket.
 */
export async function initChartRealtime(io: SocketIOServer): Promise<void> {
  _io = io;

  for (const inst of ["NIFTY", "SENSEX", "BANKNIFTY"] as RTInstrument[]) {
    for (const tf of ALL_TF) {
      const res = FYERS_RESOLUTION[tf];
      const cached = loadHistoryCache(FYERS_SYMBOL[inst], res);
      if (cached.length > 0) {
        store[inst][tf] = cached.slice(-MAX_CANDLES) as RTCandle[];
        console.log(`[ChartRT] Loaded ${store[inst][tf].length} cached candles (${inst} ${tf})`);
      }
    }
  }

  // Persist store to disk every 60s
  setInterval(() => persistStore(), PERSIST_INTERVAL_MS);

  console.log("[ChartRT] ✅ Realtime candle engine initialised");
}

/**
 * Feed a live price tick for NIFTY or SENSEX.
 * Called from fyersSocket.ts on every index tick.
 */
export function feedIndexTick(inst: RTInstrument, price: number, vol = 0): void {
  if (!isFinite(price) || price <= 0) return;

  const nowSec = Math.floor(Date.now() / 1000);

  for (const tf of ALL_TF) {
    const tfSec = TF_SECONDS[tf];
    const t     = bucketTime(nowSec, tfSec);
    updateCandle(store[inst][tf], t, price, vol);
    scheduleBroadcast(inst, tf);
  }
}

/** Get all candles for a specific instrument + timeframe (for REST) */
export function getRTCandles(inst: RTInstrument, tf: RTTimeframe): RTCandle[] {
  return [...(store[inst]?.[tf] ?? [])];
}

/** Get candles snapshot for initial socket sync */
export function getAllRTCandles(): Record<RTInstrument, Record<RTTimeframe, RTCandle[]>> {
  return {
    NIFTY:  Object.fromEntries(ALL_TF.map(tf => [tf, [...store.NIFTY[tf]]])) as Record<RTTimeframe, RTCandle[]>,
    SENSEX: Object.fromEntries(ALL_TF.map(tf => [tf, [...store.SENSEX[tf]]])) as Record<RTTimeframe, RTCandle[]>,
    BANKNIFTY: Object.fromEntries(ALL_TF.map(tf => [tf, [...store.BANKNIFTY[tf]]])) as Record<RTTimeframe, RTCandle[]>,
  };
}

/** Persist current store to disk */
function persistStore(): void {
  for (const inst of ["NIFTY", "SENSEX", "BANKNIFTY"] as RTInstrument[]) {
    for (const tf of ALL_TF) {
      const arr = store[inst][tf];
      if (arr.length === 0) continue;
      const res = FYERS_RESOLUTION[tf];
      saveHistoryCache(FYERS_SYMBOL[inst], res, arr);
    }
  }
}
