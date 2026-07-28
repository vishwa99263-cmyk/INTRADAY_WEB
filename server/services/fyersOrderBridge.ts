/**
 * fyersOrderBridge.ts — Isolated Order Execution Bridge for Fyers
 *
 * Uses the official `fyers-api-v3` Node.js SDK instead of raw fetch calls.
 * All SDK methods: get_profile, get_funds, get_positions, get_orders,
 * get_tradebook, place_order, modify_order, cancel_order, exit_positions.
 *
 * Integrated strictly with per-instrument FYERS AUTO switches.
 * Saves executed orders to realTradeStore for the Real Trade tab.
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { createRequire } from "module";
import { marketState } from "../state/marketState.js";
import { saveRealTrade, markRealTradeFailed, setFyersOrderId } from "./realTradeStore.js";
import { markPositionTradeReal } from "./positionTradeEngine.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });

// ── SDK import (CommonJS module via createRequire) ────────────────────────────
const require = createRequire(import.meta.url);
const { fyersModel } = require("fyers-api-v3");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FyersBridgeTradePayload {
  id: string;
  instrument: string;
  direction: string;
  strike: number;
  qty: number;
  entry_price: number;
  exit_price?: number;
  target?: number;
  stop_loss?: number;
  contractSymbol?: string;
  strategyName?: string;
  tradeType?: "INTRADAY" | "POSITIONAL";
}

// ── Per-instrument FYERS AUTO state ───────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), "server", "storage", "fyers_auto_trade_state.json");

const fyersAutoTradeState: Record<string, boolean> = {
  NIFTY:     true,
  BANKNIFTY: true,
  SENSEX:    true,
};

function loadAutoTradeState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const data = JSON.parse(raw);
      Object.assign(fyersAutoTradeState, data);
      console.log("[FyersBridge] Loaded FYERS AUTO state from disk:", fyersAutoTradeState);
    }
  } catch (err: any) {
    console.error("[FyersBridge] Failed to load auto trade state:", err.message);
  }
}

function saveAutoTradeState(): void {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(fyersAutoTradeState, null, 2), "utf8");
  } catch (err: any) {
    console.error("[FyersBridge] Failed to save auto trade state:", err.message);
  }
}

loadAutoTradeState();

export function setFyersAutoTradeState(instrument: string, enabled: boolean): void {
  const key = instrument.toUpperCase();
  fyersAutoTradeState[key] = enabled;
  saveAutoTradeState();
  console.log(`[FyersBridge] 🔘 FYERS AUTO for ${key}: ${enabled ? "ON ✅" : "OFF ❌"}`);
}

export function getFyersAutoTradeState(instrument: string): boolean {
  return !!fyersAutoTradeState[instrument.toUpperCase()];
}

export function getAllFyersAutoTradeStates(): Record<string, boolean> {
  return { ...fyersAutoTradeState };
}

// ── SDK Instance Factory ──────────────────────────────────────────────────────
// Creates a fresh, authenticated fyersModel instance using live marketState credentials.

function makeFyersClient(): InstanceType<typeof fyersModel> {
  const { app_id, access_token } = marketState.fyersConfig;
  if (!app_id || !access_token) {
    throw new Error("Fyers credentials not configured. Please authenticate via the FYERS tab.");
  }
  const client = new fyersModel({ enableLogging: false });
  client.setAppId(app_id);
  client.setRedirectUrl(process.env.FYERS_REDIRECT_URL || "https://trade.fyers.in/api-login/redirect-uri/index.html");
  client.setAccessToken(access_token);
  return client;
}

// ── Account Info APIs (using official SDK methods) ────────────────────────────

/**
 * Fetch Fyers account profile.
 */
export async function getFyersProfile(): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_profile() as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to fetch Fyers profile");
  return res.data;
}

/**
 * Fetch Fyers account funds / balance.
 * Returns fund_limit array: [{ title, equityAmount, commodityAmount }, ...]
 */
export async function getFyersFunds(): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_funds() as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to fetch Fyers funds");
  return res.fund_limit || res.data || res;
}

/**
 * Fetch Fyers net positions (open positions).
 * Returns { positions: netPositions[], overall: { count_total, count_open, pl_total, pl_realized, pl_unrealized } }
 */
export async function getFyersPositions(): Promise<{ positions: any[]; overall: any }> {
  const fyers = makeFyersClient();
  const res = await fyers.get_positions() as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to fetch Fyers positions");
  return { positions: res.netPositions || res.positions || [], overall: res.overall || null };
}

/**
 * Fetch Fyers order book (today's orders).
 */
export async function getFyersOrders(): Promise<any[]> {
  const fyers = makeFyersClient();
  const res = await fyers.get_orders() as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to fetch Fyers orders");
  return res.orderBook || [];
}

/**
 * Fetch Fyers trade book (executed trades today).
 */
export async function getFyersTradebook(): Promise<any[]> {
  const fyers = makeFyersClient();
  const res = await fyers.get_tradebook() as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to fetch Fyers tradebook");
  return res.tradeBook || [];
}

/**
 * Fetch Fyers holdings (long-term).
 * Returns { holdings: [], overall: { count_total, pnl_perc, total_current_value, total_investment, total_pl } }
 */
export async function getFyersHoldings(): Promise<{ holdings: any[]; overall: any }> {
  const fyers = makeFyersClient();
  const res = await fyers.get_holdings() as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to fetch Fyers holdings");
  return { holdings: res.holdings || [], overall: res.overall || null };
}

/**
 * Logout the current Fyers user session (invalidates access token).
 */
export async function logoutFyersUser(): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.logout_user() as any;
  return res;
}

/**
 * Cancel a specific order by order_id.
 */
export async function cancelFyersOrder(order_id: string): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.cancel_order({ id: order_id }) as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to cancel Fyers order");
  return res;
}

/**
 * Modify a pending Fyers order (update price, qty, type).
 * SDK: fyers.modify_order({ id, qty, type, limitPrice, stopPrice, ... })
 */
export async function modifyFyersOrder(params: {
  id: string;
  qty?: number;
  type?: number;
  limitPrice?: number;
  stopPrice?: number;
  offlineOrder?: boolean;
}): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.modify_order(params) as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to modify order");
  return res;
}

/**
 * Exit positions.
 * - Exit all:    exitAllFyersPositions()
 * - By ID:       exitAllFyersPositions(undefined, "NSE:SBIN-EQ-INTRADAY")
 * - By filter:   exitAllFyersPositions("INTRADAY")
 * SDK: fyers.exit_position({ exit_all: 1 }) or { id } or { segment, side, productType }
 */
export async function exitAllFyersPositions(
  productType?: "INTRADAY" | "MARGIN" | "CNC",
  positionId?: string
): Promise<any> {
  const fyers = makeFyersClient();
  let payload: any;
  if (positionId) {
    payload = { id: positionId };
  } else if (productType) {
    payload = { segment: [10], side: [1, -1], productType: [productType] };
  } else {
    payload = { exit_all: 1 };
  }
  const res = await fyers.exit_position(payload) as any;
  return res;
}

// ── History & Report APIs ─────────────────────────────────────────────────────

/**
 * Get a single filtered order by order_id.
 * SDK: fyers.get_filtered_orders({ order_id })
 */
export async function getFyersFilteredOrder(order_id: string): Promise<any[]> {
  const fyers = makeFyersClient();
  const res = await fyers.get_filtered_orders({ order_id }) as any;
  if (res?.s !== "ok") throw new Error(res?.message || "Failed to fetch filtered order");
  return res.orderBook || [];
}

/**
 * Get order history for a symbol.
 * SDK: fyers.get_order_history({ symbol })
 */
export async function getFyersOrderHistory(symbol: string): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_order_history({ symbol }) as any;
  return res;
}

/**
 * Get trade history for a symbol.
 * SDK: fyers.get_trade_history({ symbol })
 */
export async function getFyersTradeHistory(symbol: string): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_trade_history({ symbol }) as any;
  return res;
}

/**
 * Get charges/brokerage history.
 * SDK: fyers.get_charges_history({ from_date, to_date, page_size })
 */
export async function getFyersChargesHistory(params: { from_date: string; to_date: string; page_size?: number }): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_charges_history(params) as any;
  return res;
}

/**
 * Get realised P&L history.
 * SDK: fyers.get_realised_profit_history({ symbol?, page_size? })
 */
export async function getFyersRealisedPnl(params?: { symbol?: string; page_size?: number }): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_realised_profit_history(params || {}) as any;
  return res;
}

/**
 * Get tax P&L history.
 * SDK: fyers.get_tax_pnl_history({ page_size? })
 */
export async function getFyersTaxPnl(params?: { page_size?: number }): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_tax_pnl_history(params || {}) as any;
  return res;
}

/**
 * Get ledger history.
 * SDK: fyers.get_ledger_history({ page_size? })
 */
export async function getFyersLedger(params?: { page_size?: number }): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.get_ledger_history(params || {}) as any;
  return res;
}

// ── Advanced Order Placement ──────────────────────────────────────────────────

/**
 * Place multiple orders in a single call.
 * SDK: fyers.place_multi_order(ordersArray)
 */
export async function placeMultiOrder(orders: any[]): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.place_multi_order(orders) as any;
  return res;
}

/**
 * Place a multi-leg order (3L/2L strategies).
 * SDK: fyers.place_multileg_order(reqBody)
 */
export async function placeMultilegOrder(body: any): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.place_multileg_order(body) as any;
  return res;
}

/**
 * Place a GTT (Good Till Triggered) order.
 * SDK: fyers.place_gtt_order(reqBody)
 */
export async function placeGttOrder(body: any): Promise<any> {
  const fyers = makeFyersClient();
  const res = await fyers.place_gtt_order(body) as any;
  return res;
}

// ── Real Order Execution ──────────────────────────────────────────────────────

/**
 * Executes a real order on Fyers using the official SDK place_order().
 * STRICT CONTROL: Only executes if FYERS AUTO switch for this instrument is ON.
 * On success/failure, saves a record to realTradeStore.
 */
export async function executeFyersOrder(
  trade: FyersBridgeTradePayload,
  action: "ENTRY" | "EXIT"
): Promise<void> {
  const instKey = (trade.instrument || "").toUpperCase();
  const isAutoTradeEnabled = getFyersAutoTradeState(instKey);

  if (!isAutoTradeEnabled) {
    console.log(`[FyersBridge] 🔒 FYERS AUTO OFF for ${instKey}. Signal ${trade.id} (${action}) is Paper Only.`);
    return;
  }

  // Check credentials
  const { app_id, access_token } = marketState.fyersConfig;
  if (!app_id || !access_token) {
    console.warn(`[FyersBridge] ⚠️ FYERS AUTO ON for ${instKey} but no credentials! Please authenticate.`);
    return;
  }

  // Only handle BUY_CE / BUY_PE
  if (trade.direction !== "BUY_CE" && trade.direction !== "BUY_PE") {
    console.log(`[FyersBridge] Skipping unsupported direction: ${trade.direction}`);
    return;
  }

  // Pre-save real trade record as PENDING (will update with Fyers order ID on success)
  let realTradeId: string | null = null;
  if (action === "ENTRY") {
    const savedTrade = saveRealTrade({
      id:             trade.id,
      paperId:        trade.id,
      instrument:     trade.instrument,
      direction:      trade.direction,
      strike:         trade.strike,
      contractSymbol: trade.contractSymbol || "",
      qty:            trade.qty,
      entry_price:    trade.entry_price,
      stop_loss:      trade.stop_loss ?? 0,
      target:         trade.target ?? 0,
      strategyName:   trade.strategyName ?? "AUTO",
    });
    realTradeId = savedTrade.id;
  }

  try {
    // 1. Resolve Fyers Option Symbol from live chain
    let optionChainState: any;
    if (instKey === "NIFTY")     optionChainState = marketState.niftyOptionChain;
    else if (instKey === "BANKNIFTY") optionChainState = marketState.bankniftyOptionChain;
    else if (instKey === "SENSEX")    optionChainState = marketState.sensexOptionChain;

    if (!optionChainState) {
      const msg = `Unknown instrument: ${trade.instrument}`;
      console.error(`[FyersBridge] ❌ ${msg}`);
      if (realTradeId) markRealTradeFailed(realTradeId, msg);
      return;
    }

    // Use contractSymbol if provided (most accurate), else resolve from chain
    let fyersSymbol = trade.contractSymbol || "";
    if (!fyersSymbol) {
      const strikeData = optionChainState.strikes?.find((s: any) => s.strikePrice === trade.strike);
      if (!strikeData) {
        const msg = `Strike ${trade.strike} not found in live option chain for ${instKey}`;
        console.error(`[FyersBridge] ❌ ${msg}`);
        if (realTradeId) markRealTradeFailed(realTradeId, msg);
        return;
      }
      fyersSymbol = trade.direction === "BUY_CE" ? strikeData.ceSymbol : strikeData.peSymbol;
    }

    if (!fyersSymbol) {
      const msg = `Could not resolve Fyers symbol for ${instKey} ${trade.direction} strike ${trade.strike}`;
      console.error(`[FyersBridge] ❌ ${msg}`);
      if (realTradeId) markRealTradeFailed(realTradeId, msg);
      return;
    }

    // 2. Product type: INTRADAY before 3 PM IST, MARGIN after
    // But for POSITIONAL trade, it is ALWAYS MARGIN!
    let productType = "INTRADAY";
    const isPositional = trade.tradeType === "POSITIONAL" || 
                         trade.id?.startsWith("PT_") || 
                         trade.strategyName?.toLowerCase().includes("positional") || 
                         trade.strategyName?.toLowerCase().includes("swing");
    if (isPositional) {
      productType = "MARGIN";
    } else {
      const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
      productType = istHour >= 15 ? "MARGIN" : "INTRADAY";
    }

    // 3. Side: 1 = Buy (ENTRY), -1 = Sell (EXIT)
    const side = action === "ENTRY" ? 1 : -1;

    // 4. Limit price rounded to nearest 0.05 (NSE tick size)
    const rawPrice = action === "ENTRY" ? trade.entry_price : (trade.exit_price || 0);
    if (rawPrice <= 0) {
      const msg = `Invalid price for ${action}: ${rawPrice}`;
      console.error(`[FyersBridge] ❌ ${msg}`);
      if (realTradeId) markRealTradeFailed(realTradeId, msg);
      return;
    }
    const limitPrice = Math.round(rawPrice * 20) / 20;

    // 5. Build order payload per Fyers V3 SDK spec
    const orderPayload = {
      symbol:       fyersSymbol,
      qty:          trade.qty,
      type:         1,            // 1 = Limit Order, 2 = Market Order
      side:         side,
      productType:  productType,
      limitPrice:   limitPrice,
      stopPrice:    0,
      validity:     "DAY",
      disclosedQty: 0,
      offlineOrder: false,
      stopLoss:     0,
      takeProfit:   0,
    };

    console.log(`[FyersBridge] 🚀 Placing ${action} order via SDK for ${instKey}:`, orderPayload);

    // 6. Place via official SDK — place_order()
    const fyers = makeFyersClient();
    const result = await fyers.place_order(orderPayload) as any;

    if (result?.s === "ok") {
      const orderId = result.id || result.data?.id;
      console.log(`[FyersBridge] ✅ REAL ORDER PLACED! ${instKey} ${trade.direction} | Fyers Order ID: ${orderId} | Symbol: ${fyersSymbol} | Price: ₹${limitPrice} | Qty: ${trade.qty}`);
      if (realTradeId && orderId) {
        setFyersOrderId(realTradeId, orderId, limitPrice);
        if (realTradeId.startsWith("PT_")) {
          markPositionTradeReal(realTradeId, orderId);
        }
      }
      
      // Emit socket update
      if (marketState.io) {
        const { getRealTrades, getTodayRealPnl, getLiveUnrealizedPnl } = await import("./realTradeStore.js");
        marketState.io.emit("real-trade-update", {
          trades: getRealTrades("ALL"),
          todayPnl: getTodayRealPnl(),
          livePnl: getLiveUnrealizedPnl(),
        });
        marketState.io.emit("toast-trigger", {
          type: "success",
          title: `✅ Fyers Order Placed (${action})`,
          message: `${instKey} ${trade.direction} @ ₹${limitPrice} | Qty: ${trade.qty}`,
        });
      }
    } else {
      const errMsg = result?.message || result?.errmsg || JSON.stringify(result);
      console.error(`[FyersBridge] ❌ ORDER REJECTED (${instKey}): ${errMsg}`);
      if (realTradeId) markRealTradeFailed(realTradeId, errMsg);
      
      // Emit socket update
      if (marketState.io) {
        const { getRealTrades, getTodayRealPnl, getLiveUnrealizedPnl } = await import("./realTradeStore.js");
        marketState.io.emit("real-trade-update", {
          trades: getRealTrades("ALL"),
          todayPnl: getTodayRealPnl(),
          livePnl: getLiveUnrealizedPnl(),
        });
        marketState.io.emit("toast-trigger", {
          type: "error",
          title: `❌ Fyers Order Rejected (${action})`,
          message: errMsg || "Order rejected by Fyers.",
        });
      }
    }

  } catch (err: any) {
    console.error(`[FyersBridge] ❌ SDK error placing order:`, err.message);
    if (realTradeId) markRealTradeFailed(realTradeId, err.message);
    
    // Emit socket update
    if (marketState.io) {
      try {
        const { getRealTrades, getTodayRealPnl, getLiveUnrealizedPnl } = await import("./realTradeStore.js");
        marketState.io.emit("real-trade-update", {
          trades: getRealTrades("ALL"),
          todayPnl: getTodayRealPnl(),
          livePnl: getLiveUnrealizedPnl(),
        });
        marketState.io.emit("toast-trigger", {
          type: "error",
          title: `❌ SDK Order Error (${action})`,
          message: err.message,
        });
      } catch (_) {}
    }
  }
}
