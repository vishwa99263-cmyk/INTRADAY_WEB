/**
 * fyersOrderSocket.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time Order, Trade & Position updates via Fyers Order WebSocket.
 *
 * Events emitted on the passed Socket.IO `io` instance:
 *   - "fyers-order-update"    → { order }   when an order status changes
 *   - "fyers-trade-update"    → { trade }   when a trade is executed
 *   - "fyers-position-update" → { position } when a position changes
 *
 * Usage: startFyersOrderSocket(accessToken, io)  in server.ts after auth.
 */

import { Server as SocketIOServer } from "socket.io";

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const { fyersOrderSocket } = _require("fyers-api-v3");

let orderSocketInstance: any = null;

/**
 * Start the Fyers Order WebSocket.
 * Connects and subscribes to orders, trades, and positions.
 */
export function startFyersOrderSocket(
  accessToken: string,
  appId: string,
  io: SocketIOServer
): void {
  // Clean up existing connection
  if (orderSocketInstance) {
    try { orderSocketInstance.close(); } catch (_) {}
    orderSocketInstance = null;
  }

  // Format: "APPID:access_token"
  const tokenString = `${appId}:${accessToken}`;

  console.log("[FyersOrderSocket] 🔌 Connecting Order WebSocket...");
  orderSocketInstance = new fyersOrderSocket(tokenString);

  // ── Error handler ─────────────────────────────────────────────────────────
  orderSocketInstance.on("error", (err: any) => {
    console.error("[FyersOrderSocket] ❌ Error:", err);
  });

  // ── On connect: subscribe to all update channels ──────────────────────────
  orderSocketInstance.on("connect", () => {
    console.log("[FyersOrderSocket] ✅ Connected — subscribing to all updates");
    orderSocketInstance.subscribe([
      orderSocketInstance.orderUpdates,
      orderSocketInstance.tradeUpdates,
      orderSocketInstance.positionUpdates,
    ]);
  });

  // ── On close ──────────────────────────────────────────────────────────────
  orderSocketInstance.on("close", () => {
    console.log("[FyersOrderSocket] 🔴 Connection closed");
  });

  // ── Order updates (status changes: PENDING → FILLED / REJECTED) ───────────
  orderSocketInstance.on("orders", (msg: any) => {
    const order = msg?.orders || msg;
    if (!order) return;

    const statusMap: Record<number, string> = {
      1:  "PENDING",
      2:  "FILLED",
      5:  "REJECTED",
      6:  "CANCELLED",
      90: "PENDING_TRIGGER",
    };

    const status = statusMap[order.status] || String(order.status);
    console.log(
      `[FyersOrderSocket] 📋 Order Update: ${order.symbol} | ${order.side === 1 ? "BUY" : "SELL"} | Status: ${status}`
    );

    // Emit to frontend
    io.emit("fyers-order-update", {
      id:           order.id,
      symbol:       order.symbol,
      side:         order.side === 1 ? "BUY" : "SELL",
      qty:          order.qty,
      filledQty:    order.filledQty,
      limitPrice:   order.limitPrice,
      tradedPrice:  order.tradedPrice || order.limitPrice,
      status,
      productType:  order.productType,
      orderDateTime: order.orderDateTime,
      message:      order.message || "",
      id_fyers:     order.id_fyers,
    });

    // Toast notification for important events
    if (order.status === 2) {
      io.emit("toast-trigger", {
        type: "success",
        title: "✅ Fyers Order Filled",
        message: `${order.symbol} ${order.side === 1 ? "BUY" : "SELL"} ${order.filledQty} qty @ ₹${order.tradedPrice || order.limitPrice}`,
      });
    } else if (order.status === 5) {
      io.emit("toast-trigger", {
        type: "error",
        title: "❌ Fyers Order Rejected",
        message: `${order.symbol} — ${order.message || "Unknown reason"}`,
      });
    }
  });

  // ── Trade updates (actual execution ticks) ────────────────────────────────
  orderSocketInstance.on("trades", (msg: any) => {
    const trade = msg?.trades || msg;
    if (!trade) return;

    console.log(
      `[FyersOrderSocket] 💹 Trade Executed: ${trade.symbol} | ${trade.side === 1 ? "BUY" : "SELL"} ${trade.tradedQty} @ ₹${trade.tradePrice}`
    );

    io.emit("fyers-trade-update", {
      tradeNumber:    trade.tradeNumber,
      orderNumber:    trade.orderNumber,
      symbol:         trade.symbol,
      side:           trade.side === 1 ? "BUY" : "SELL",
      tradedQty:      trade.tradedQty,
      tradePrice:     trade.tradePrice,
      tradeValue:     trade.tradeValue,
      productType:    trade.productType,
      orderDateTime:  trade.orderDateTime,
      exchange:       trade.exchange,
    });
  });

  // ── Position updates ──────────────────────────────────────────────────────
  orderSocketInstance.on("positions", (msg: any) => {
    const pos = msg?.positions || msg;
    if (!pos) return;

    io.emit("fyers-position-update", {
      symbol:           pos.symbol,
      id:               pos.id,
      netQty:           pos.netQty ?? pos.qty,
      netAvg:           pos.netAvg,
      buyAvg:           pos.buyAvg,
      sellAvg:          pos.sellAvg,
      realized_profit:  pos.realized_profit,
      productType:      pos.productType,
      side:             pos.side,
    });
  });

  // ── General (price alerts, EDIS) ──────────────────────────────────────────
  orderSocketInstance.on("general", (msg: any) => {
    console.log("[FyersOrderSocket] General:", msg);
    io.emit("fyers-general-update", msg);
  });

  // Auto-reconnect on disconnect
  orderSocketInstance.autoreconnect();
  orderSocketInstance.connect();
}

/**
 * Stop the Fyers Order WebSocket.
 */
export function stopFyersOrderSocket(): void {
  if (orderSocketInstance) {
    try { orderSocketInstance.close(); } catch (_) {}
    orderSocketInstance = null;
    console.log("[FyersOrderSocket] 🔴 Order Socket stopped");
  }
}

export function isFyersOrderSocketConnected(): boolean {
  return orderSocketInstance !== null;
}
