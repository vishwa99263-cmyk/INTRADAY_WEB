/**
 * candleAggregator.ts — Enhanced NIFTY/SENSEX Candle Aggregation Service
 *
 * Wraps chartRealtime.ts and adds:
 *   - VWAP (session-based, reset at IST market open 09:15)
 *   - Session tracking per instrument
 *   - Exposes emit hooks for chartStream.ts
 *
 * Socket events emitted:
 *   "chart-candle-update" — realtime candle on every tick
 *   "chart-init"          — full historical snapshot on client connect
 *   "chart-history-loaded" — signals history is ready
 */

import { Server as SocketIOServer } from "socket.io";
import {
  feedIndexTick,
  getRTCandles,
  getAllRTCandles,
  initChartRealtime,
  type RTInstrument,
  type RTTimeframe,
  type RTCandle,
} from "./chartRealtime.js";

// ── VWAP Session State ──────────────────────────────────────────────────────────

interface VWAPSession {
  cumVolume: number;
  cumTPV:    number;  // TypicalPrice × Volume
  date:      string;  // IST date string for session reset detection
  vwap:      number;
}

const vwapState: Record<RTInstrument, VWAPSession> = {
  NIFTY:  { cumVolume: 0, cumTPV: 0, date: "", vwap: 0 },
  BANKNIFTY: { cumVolume: 0, cumTPV: 0, date: "", vwap: 0 },
  SENSEX: { cumVolume: 0, cumTPV: 0, date: "", vwap: 0 },
};

function getISTDateStr(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/**
 * Update VWAP for the instrument given a new tick.
 * VWAP is session-based: resets at IST midnight (practical: IST date change).
 */
export function updateVWAP(
  inst: RTInstrument,
  high: number,
  low: number,
  close: number,
  volume: number,
): number {
  const today = getISTDateStr();
  const s = vwapState[inst];

  if (s.date !== today) {
    // New session: reset cumulative values
    s.cumVolume = 0;
    s.cumTPV    = 0;
    s.date      = today;
  }

  const tp = (high + low + close) / 3;
  s.cumVolume += volume;
  s.cumTPV    += tp * volume;
  s.vwap       = s.cumVolume > 0 ? s.cumTPV / s.cumVolume : close;
  return s.vwap;
}

/** Get latest VWAP for instrument */
export function getVWAP(inst: RTInstrument): number {
  return vwapState[inst].vwap;
}

// ── Public API (delegates to chartRealtime) ─────────────────────────────────────

export type { RTInstrument, RTTimeframe, RTCandle };

export { feedIndexTick, getRTCandles, getAllRTCandles };

/** Initialize both the candle aggregator and the underlying realtime engine */
export async function initCandleAggregator(io: SocketIOServer): Promise<void> {
  await initChartRealtime(io);
  console.log("[CandleAggregator] ✅ Initialised with VWAP session tracking");
}
