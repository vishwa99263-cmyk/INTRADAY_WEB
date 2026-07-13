/**
 * chartEngine.ts — Server-side Tick-to-Candle Aggregator
 *
 * Converts realtime Fyers WebSocket ticks into OHLCV candles.
 * Maintains per-instrument, per-timeframe ring buffers (200 candles).
 * Broadcasts "chart-update" via Socket.IO on every tick.
 *
 * Instruments:
 *   NIFTY_SPOT, SENSEX_SPOT, CE_PREMIUM, PE_PREMIUM
 *   NET_SCORE, PCR, OI_DIFF, MOMENTUM
 *
 * Timeframes: 1m, 5m, 15m
 */

import { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ChartInstrument =
  | "NIFTY_SPOT"
  | "SENSEX_SPOT"
  | "CE_PREMIUM"
  | "PE_PREMIUM"
  | "NET_SCORE"
  | "PCR"
  | "OI_DIFF"
  | "MOMENTUM";

export type Timeframe = "1m" | "5m" | "15m";

export interface OHLCVCandle {
  time:   number; // Unix timestamp seconds (UTC)
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TF_SECONDS: Record<Timeframe, number> = {
  "1m":  60,
  "5m":  300,
  "15m": 900,
};

const MAX_CANDLES = 300; // ring buffer size per instrument/tf

// ── In-memory store ────────────────────────────────────────────────────────────

/** candles[instrument][tf] = array of OHLCV candles */
const candles: Record<ChartInstrument, Record<Timeframe, OHLCVCandle[]>> = {
  NIFTY_SPOT:  { "1m": [], "5m": [], "15m": [] },
  SENSEX_SPOT: { "1m": [], "5m": [], "15m": [] },
  CE_PREMIUM:  { "1m": [], "5m": [], "15m": [] },
  PE_PREMIUM:  { "1m": [], "5m": [], "15m": [] },
  NET_SCORE:   { "1m": [], "5m": [], "15m": [] },
  PCR:         { "1m": [], "5m": [], "15m": [] },
  OI_DIFF:     { "1m": [], "5m": [], "15m": [] },
  MOMENTUM:    { "1m": [], "5m": [], "15m": [] },
};

/** Last updated time per instrument for volume accumulation */
const lastVolume: Partial<Record<ChartInstrument, number>> = {};

let _io: SocketIOServer | null = null;

// ── Throttle broadcast ─────────────────────────────────────────────────────────
const _pending: Set<string> = new Set();
let _broadcastTimer: ReturnType<typeof setTimeout> | null = null;
const BROADCAST_MS = 100;

function scheduleBroadcast(key: string): void {
  _pending.add(key);
  if (_broadcastTimer) return;
  _broadcastTimer = setTimeout(() => {
    _broadcastTimer = null;
    if (!_io) return;
    for (const k of _pending) {
      const [inst, tf] = k.split("|") as [ChartInstrument, Timeframe];
      const data = candles[inst]?.[tf];
      if (!data || data.length === 0) continue;
      _io.emit("chart-update", {
        instrument: inst,
        tf,
        candles: data.slice(-200), // send last 200
      });
    }
    _pending.clear();
  }, BROADCAST_MS);
}

// ── Core candle update logic ───────────────────────────────────────────────────

/** Returns Unix second aligned to timeframe bucket */
function bucketTime(nowMs: number, tfSec: number): number {
  const nowSec = Math.floor(nowMs / 1000);
  return nowSec - (nowSec % tfSec);
}

/**
 * Feed a price tick into one instrument's candle store.
 * Creates or updates the current open candle, closes it when bucket ends.
 */
function feedTick(instrument: ChartInstrument, price: number, volumeDelta = 0): void {
  if (!isFinite(price) || price <= 0) return;

  const nowMs = Date.now();

  for (const tf of ["1m", "5m", "15m"] as Timeframe[]) {
    const tfSec = TF_SECONDS[tf];
    const t     = bucketTime(nowMs, tfSec);
    const arr   = candles[instrument][tf];
    const last  = arr[arr.length - 1];

    if (!last || last.time !== t) {
      // New candle
      const newCandle: OHLCVCandle = {
        time:   t,
        open:   last?.close ?? price,
        high:   price,
        low:    price,
        close:  price,
        volume: volumeDelta,
      };
      arr.push(newCandle);
      // Trim ring buffer
      if (arr.length > MAX_CANDLES) arr.shift();
    } else {
      // Update current candle
      last.high   = Math.max(last.high, price);
      last.low    = Math.min(last.low, price);
      last.close  = price;
      last.volume += volumeDelta;
    }

    scheduleBroadcast(`${instrument}|${tf}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Initialize chart engine with Socket.IO instance */
export function initChartEngine(io: SocketIOServer): void {
  _io = io;
  console.log("[ChartEngine] ✅ Initialised — 8 instruments × 3 timeframes");
}

/** Called from fyersSocket on every NIFTY/SENSEX index tick */
export function onSpotTick(symbol: string, ltp: number, volume = 0): void {
  if (symbol === "NSE:NIFTY50-INDEX")  feedTick("NIFTY_SPOT",  ltp, volume);
  if (symbol === "BSE:SENSEX-INDEX")   feedTick("SENSEX_SPOT", ltp, volume);
}

/** Called after option chain state is updated (from optionChainStream or fyersSocket) */
export function onOptionChainTick(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): void {
  // Route option ticks only for NIFTY to avoid polluting the single indicator chart series (CE/PE premium, PCR, OI diff) with Sensex values.
  if (page !== "NIFTY") return;

  const chain = marketState.niftyOptionChain;
  if (!chain || chain.strikes.length === 0) return;

  // Find ATM strike
  const spotPx  = chain.spotPrice || marketState.niftySpot;
  const gap      = 50;
  const atmPrice = Math.round(spotPx / gap) * gap;
  const atmRow   = chain.strikes.find(s => s.strikePrice === atmPrice)
                 ?? chain.strikes.reduce((best, s) =>
                     Math.abs(s.strikePrice - atmPrice) < Math.abs(best.strikePrice - atmPrice) ? s : best,
                     chain.strikes[0]);

  if (!atmRow) return;

  const ceLtp = atmRow.ceLtp || 0;
  const peLtp = atmRow.peLtp || 0;
  const ceOI  = atmRow.ceOI  || 0;
  const peOI  = atmRow.peOI  || 0;
  const ceVol = atmRow.ceVolume || 0;
  const peVol = atmRow.peVolume || 0;

  // CE Premium
  if (ceLtp > 0) feedTick("CE_PREMIUM", ceLtp, ceVol);

  // PE Premium
  if (peLtp > 0) feedTick("PE_PREMIUM", peLtp, peVol);

  // PCR = peOI / ceOI
  const pcr = ceOI > 0 ? parseFloat((peOI / ceOI).toFixed(4)) : 1.0;
  if (pcr > 0) feedTick("PCR", pcr, 0);

  // OI Diff = ceOI - peOI (scaled to thousands for readability)
  const oiDiff = (ceOI - peOI) / 1000;
  feedTick("OI_DIFF", oiDiff === 0 ? 0.001 : oiDiff, 0);
}

/** Called with market score values from the AI engine or backupScheduler */
export function onScoreTick(netScore: number, momentumScore: number): void {
  // Net score (can be negative — offset to keep above 0 for chart display)
  const scoreVal = netScore + 100; // shift so it's always positive on chart
  feedTick("NET_SCORE", scoreVal, 0);

  // Momentum score
  if (isFinite(momentumScore)) feedTick("MOMENTUM", momentumScore + 100, 0);
}

/** Returns candles for a given instrument/tf (for REST endpoint) */
export function getCandles(instrument: ChartInstrument, tf: Timeframe): OHLCVCandle[] {
  return [...(candles[instrument]?.[tf] ?? [])];
}

/** Returns all current candle snapshots (for initial sync on socket connect) */
export function getAllCandles(): Record<string, Record<Timeframe, OHLCVCandle[]>> {
  const result: Record<string, Record<Timeframe, OHLCVCandle[]>> = {};
  for (const inst of Object.keys(candles) as ChartInstrument[]) {
    result[inst] = {
      "1m":  [...candles[inst]["1m"]],
      "5m":  [...candles[inst]["5m"]],
      "15m": [...candles[inst]["15m"]],
    };
  }
  return result;
}
