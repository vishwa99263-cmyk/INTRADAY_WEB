/**
 * realTradeStore.ts
 * ════════════════════════════════════════════════════════════
 * Persistent store for REAL trades placed via Fyers.
 * Completely separate from paper trades — these are actual orders.
 *
 * Persists to disk: server/storage/real_trades.json
 */

import fs from "fs";
import path from "path";
import { marketState } from "../state/marketState.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RealTrade {
  id: string;                   // Internal UUID
  paperId: string;              // Linked paper trade ID
  fyersOrderId?: string;        // Fyers order ID from API response
  instrument: string;           // NIFTY | BANKNIFTY | SENSEX
  direction: string;            // BUY_CE | BUY_PE
  strike: number;
  contractSymbol: string;
  qty: number;                  // Actual quantity (lots × lot_size)
  entry_price: number;          // Price at which paper trade was placed
  fyers_entry_price?: number;   // Actual execution price from Fyers (may differ)
  exit_price?: number;
  stop_loss: number;
  target: number;
  strategyName: string;
  status: "OPEN" | "CLOSED" | "FAILED";
  pnl?: number;                 // Realized P&L when closed
  live_pnl?: number;            // Live unrealized P&L
  live_ltp?: number;            // Current LTP of the option
  opened_at: number;            // Unix ms
  closed_at?: number;           // Unix ms
  close_reason?: string;        // SL_HIT | TARGET_HIT | MANUAL | EXPIRED
  notes?: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORE_FILE = path.join(process.cwd(), "server", "storage", "real_trades.json");
let realTrades: Map<string, RealTrade> = new Map();

function loadFromDisk(): void {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      const arr: RealTrade[] = JSON.parse(raw);
      arr.forEach(t => realTrades.set(t.id, t));
      console.log(`[RealTradeStore] Loaded ${arr.length} real trades from disk.`);
    }
  } catch (err: any) {
    console.error("[RealTradeStore] Failed to load from disk:", err.message);
  }
}

function saveToDisk(): void {
  try {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const arr = Array.from(realTrades.values());
    fs.writeFileSync(STORE_FILE, JSON.stringify(arr, null, 2), "utf8");
  } catch (err: any) {
    console.error("[RealTradeStore] Failed to save to disk:", err.message);
  }
}

// Load on import
loadFromDisk();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save a new real trade entry.
 */
export function saveRealTrade(trade: Omit<RealTrade, "status" | "opened_at">): RealTrade {
  const now = Date.now();
  const full: RealTrade = {
    ...trade,
    status: "OPEN",
    opened_at: now,
    live_pnl: 0,
    live_ltp: trade.entry_price,
  };
  realTrades.set(full.id, full);
  saveToDisk();
  console.log(`[RealTradeStore] ✅ Saved real trade: ${full.instrument} ${full.direction} @ ₹${full.entry_price} (ID: ${full.id})`);
  if (marketState.io) {
    marketState.io.emit("real-trade-update", {
      trades: getRealTrades("ALL"),
      todayPnl: getTodayRealPnl(),
      livePnl: getLiveUnrealizedPnl(),
    });
  }
  return full;
}

/**
 * Mark a real trade as FAILED (Fyers order rejected).
 */
export function markRealTradeFailed(id: string, reason: string): void {
  const trade = realTrades.get(id);
  if (!trade) return;
  trade.status = "FAILED";
  trade.notes = reason;
  realTrades.set(id, trade);
  saveToDisk();
  if (marketState.io) {
    marketState.io.emit("real-trade-update", {
      trades: getRealTrades("ALL"),
      todayPnl: getTodayRealPnl(),
      livePnl: getLiveUnrealizedPnl(),
    });
  }
}

/**
 * Update live LTP and unrealized P&L for an open real trade.
 */
export function updateRealTradeLTP(id: string, ltp: number): void {
  const trade = realTrades.get(id);
  if (!trade || trade.status !== "OPEN") return;
  trade.live_ltp = ltp;
  trade.live_pnl = (ltp - trade.entry_price) * trade.qty;
  realTrades.set(id, trade);
}

/**
 * Close a real trade.
 */
export function closeRealTrade(id: string, exitPrice: number, reason: string): RealTrade | null {
  const trade = realTrades.get(id);
  if (!trade || trade.status !== "OPEN") return null;
  trade.status = "CLOSED";
  trade.exit_price = exitPrice;
  trade.pnl = (exitPrice - trade.entry_price) * trade.qty;
  trade.closed_at = Date.now();
  trade.close_reason = reason;
  trade.live_pnl = trade.pnl;
  realTrades.set(id, trade);
  saveToDisk();
  return trade;
}

/**
 * Update Fyers order ID after confirmation.
 */
export function setFyersOrderId(id: string, fyersOrderId: string, fyersPrice?: number): void {
  const trade = realTrades.get(id);
  if (!trade) return;
  trade.fyersOrderId = fyersOrderId;
  if (fyersPrice) trade.fyers_entry_price = fyersPrice;
  realTrades.set(id, trade);
  saveToDisk();
}

/**
 * Get real trades by status.
 */
export function getRealTrades(status?: "OPEN" | "CLOSED" | "FAILED" | "ALL"): RealTrade[] {
  const all = Array.from(realTrades.values());
  if (!status || status === "ALL") return all.sort((a, b) => b.opened_at - a.opened_at);
  return all.filter(t => t.status === status).sort((a, b) => b.opened_at - a.opened_at);
}

/**
 * Get today's real trades.
 */
export function getTodayRealTrades(): RealTrade[] {
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return Array.from(realTrades.values())
    .filter(t => {
      const tradeDate = new Date(t.opened_at + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      return tradeDate === todayIST;
    })
    .sort((a, b) => b.opened_at - a.opened_at);
}

/**
 * Get a single trade by ID.
 */
export function getRealTradeById(id: string): RealTrade | undefined {
  return realTrades.get(id);
}

/**
 * Get today's net P&L from closed real trades.
 */
export function getTodayRealPnl(): number {
  return getTodayRealTrades()
    .filter(t => t.status === "CLOSED" && t.pnl !== undefined)
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
}

/**
 * Get live unrealized P&L for all open real trades.
 */
export function getLiveUnrealizedPnl(): number {
  return Array.from(realTrades.values())
    .filter(t => t.status === "OPEN" && t.live_pnl !== undefined)
    .reduce((sum, t) => sum + (t.live_pnl ?? 0), 0);
}
