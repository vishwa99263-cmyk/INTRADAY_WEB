/**
 * chartStream.ts — Socket.IO Chart Stream Handler
 *
 * Manages chart-specific Socket.IO events:
 *   client → "request-chart-init"    → server emits "chart-init" to that client
 *   server → "chart-candle-update"   → broadcast on every tick (via chartRealtime)
 *   server → "chart-history-loaded"  → broadcast once history is ready
 *
 * This wraps the existing chartRealtime broadcast architecture and adds:
 *   - Per-client history delivery on connect
 *   - "chart-init" event for initial chart state
 *   - "chart-history-loaded" signal
 */

import { Server as SocketIOServer, Socket } from "socket.io";
import { getAllRTCandles } from "./chartRealtime.js";

let _io: SocketIOServer | null = null;
let _historyReady = false;

/**
 * Initialize chart stream handler.
 * Call AFTER initChartRealtime() so candle store is populated.
 */
export function initChartStream(io: SocketIOServer): void {
  _io = io;

  io.on("connection", (socket: Socket) => {
    // Send full candle snapshot to newly connected client
    const snapshot = getAllRTCandles();
    socket.emit("chart-init", {
      timestamp: Date.now(),
      data:      snapshot,
      ready:     _historyReady,
    });

    // Allow client to explicitly request a fresh snapshot
    socket.on("request-chart-init", () => {
      const fresh = getAllRTCandles();
      socket.emit("chart-init", {
        timestamp: Date.now(),
        data:      fresh,
        ready:     _historyReady,
      });
    });
  });

  console.log("[ChartStream] ✅ Socket.IO chart stream handler registered");
}

/** Call after historical Fyers data has been loaded */
export function signalHistoryReady(): void {
  _historyReady = true;
  if (_io) {
    _io.emit("chart-history-loaded", { timestamp: Date.now() });
    console.log("[ChartStream] Broadcast chart-history-loaded");
  }
}

/** Broadcast a candle update to all connected clients */
export function broadcastCandleUpdate(
  instrument: string,
  tf:         string,
  candle:     object,
): void {
  if (!_io) return;
  _io.emit("chart-candle-update", { instrument, tf, candle, ts: Date.now() });
}
