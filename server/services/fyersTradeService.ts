/**
 * fyersTradeService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fyers REST API wrapper for live trading.
 * Wraps: get_funds, get_positions, get_orders, get_tradebook, place_order, cancel_order
 *
 * LOT SIZES:
 *   NIFTY    = 75 shares per lot  (qty=75 for 1 lot)
 *   BANKNIFTY= 35 shares per lot  (qty=35 for 1 lot)
 *   SENSEX   = 20 shares per lot  (qty=20 for 1 lot)
 */

import { createRequire } from "module";
import { marketState } from "../state/marketState.js";

const _require = typeof require !== "undefined"
  ? require
  : createRequire(typeof import.meta !== "undefined" && import.meta.url ? import.meta.url : "");

let fyersSDK: any = null;
try { fyersSDK = _require("fyers-api-v3"); } catch (_) {}

// ── Lot size map ──────────────────────────────────────────────────────────────
export const LOT_SIZES: Record<string, number> = {
  NIFTY:     75,
  BANKNIFTY: 35,
  SENSEX:    20,
  FINNIFTY:  40,
};

// 1 lot qty per instrument
export const ONE_LOT_QTY: Record<string, number> = {
  NIFTY:     75,
  BANKNIFTY: 35,
  SENSEX:    20,
  FINNIFTY:  40,
};

// ── Singleton client ──────────────────────────────────────────────────────────
let _fyersClient: any = null;

function getClient(): any {
  if (!fyersSDK) throw new Error("fyers-api-v3 SDK not found");

  const { app_id, access_token } = marketState.fyersConfig;
  if (!app_id || !access_token) throw new Error("Fyers not authenticated — app_id or access_token missing");

  // Always re-init so token changes are picked up
  const Model = fyersSDK.fyersModel ?? fyersSDK;
  const client = new Model({ path: process.cwd(), enableLogging: false });
  client.setAppId(app_id);
  client.setAccessToken(access_token);
  return client;
}

// ── Fund / Balance ─────────────────────────────────────────────────────────────
export async function getFunds(): Promise<any> {
  const client = getClient();
  const res = await client.get_funds({});
  if (!res || res.s === "error") throw new Error(res?.message ?? "get_funds failed");
  return res;
}

// ── Positions ─────────────────────────────────────────────────────────────────
export async function getPositions(): Promise<any> {
  const client = getClient();
  const res = await client.get_positions({});
  if (!res || res.s === "error") throw new Error(res?.message ?? "get_positions failed");
  return res;
}

// ── Orders (orderbook) ────────────────────────────────────────────────────────
export async function getOrders(): Promise<any> {
  const client = getClient();
  const res = await client.get_orders({});
  if (!res || res.s === "error") throw new Error(res?.message ?? "get_orders failed");
  return res;
}

// ── Tradebook (executed trades) ───────────────────────────────────────────────
export async function getTradebook(): Promise<any> {
  const client = getClient();
  const res = await client.get_tradebook({});
  if (!res || res.s === "error") throw new Error(res?.message ?? "get_tradebook failed");
  return res;
}

// ── Place Order ───────────────────────────────────────────────────────────────
export interface PlaceOrderParams {
  symbol:      string;  // Fyers symbol e.g. "NSE:NIFTY2572524800CE"
  qty:         number;  // total shares (lots × lot_size)
  side:        1 | -1;  // 1=BUY, -1=SELL
  orderType:   1 | 2;   // 1=Limit, 2=Market
  limitPrice?: number;  // only for limit orders
  productType: "INTRADAY" | "MARGIN" | "CNC";
  validity?:   "DAY" | "IOC";
  stopLoss?:   number;
  takeProfit?: number;
  tag?:        string;  // reference tag (e.g. trade id)
}

export interface PlaceOrderResult {
  orderId:  string;
  status:   "PLACED" | "FAILED";
  message:  string;
  rawResponse: any;
}

export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
  const client = getClient();

  const orderPayload: any = {
    symbol:        params.symbol,
    qty:           params.qty,
    type:          params.orderType,   // 1=Limit 2=Market
    side:          params.side,        // 1=Buy -1=Sell
    productType:   params.productType,
    limitPrice:    params.limitPrice ?? 0,
    stopPrice:     0,
    validity:      params.validity ?? "DAY",
    disclosedQty:  0,
    offlineOrder:  false,
    stopLoss:      params.stopLoss ?? 0,
    takeProfit:    params.takeProfit ?? 0,
  };

  if (params.tag) orderPayload.tag = params.tag;

  console.log(`[FyersTradeService] Placing order:`, JSON.stringify(orderPayload));
  const res = await client.place_order(orderPayload);
  console.log(`[FyersTradeService] Place order response:`, JSON.stringify(res));

  if (!res || res.s === "error" || !res.id) {
    return {
      orderId: "",
      status: "FAILED",
      message: res?.message ?? "Order placement failed",
      rawResponse: res,
    };
  }

  return {
    orderId: res.id ?? res.order_id ?? "",
    status: "PLACED",
    message: "Order placed successfully",
    rawResponse: res,
  };
}

// ── Cancel Order ──────────────────────────────────────────────────────────────
export async function cancelOrder(orderId: string): Promise<{ success: boolean; message: string }> {
  const client = getClient();
  const res = await client.cancel_order({ id: orderId });
  if (!res || res.s === "error") {
    return { success: false, message: res?.message ?? "Cancel failed" };
  }
  return { success: true, message: "Order cancelled" };
}

// ── Order Status ──────────────────────────────────────────────────────────────
export async function getOrderStatus(orderId: string): Promise<any> {
  const client = getClient();
  const res = await client.get_filtered_orders({ order_id: orderId });
  return res;
}

// ── Helper: Build Fyers option symbol from strike data ────────────────────────
// ceSymbol or peSymbol from OptionStrikeData is already in Fyers format
// e.g. "NSE:NIFTY2572524800CE"
export function getInstrumentQty(instrument: string): number {
  const upper = instrument.toUpperCase();
  if (upper.includes("BANKNIFTY")) return ONE_LOT_QTY.BANKNIFTY;
  if (upper.includes("SENSEX"))    return ONE_LOT_QTY.SENSEX;
  if (upper.includes("FINNIFTY"))  return ONE_LOT_QTY.FINNIFTY;
  return ONE_LOT_QTY.NIFTY;
}
