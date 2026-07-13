/**
 * fyersOrderBridge.ts — Isolated Order Execution Bridge for Fyers Automate Webhooks
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

export interface FyersBridgeTradePayload {
  id: string;
  instrument: string;
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  qty: number;
  entry_price: number;
  exit_price?: number;
}

/**
 * Dispatches a webhook signal to Fyers Automate.
 * Runs on a fire-and-forget basis so it never blocks the main execution loop.
 */
export async function executeFyersOrder(
  trade: FyersBridgeTradePayload,
  action: "ENTRY" | "EXIT"
): Promise<void> {
  const isReal = process.env.ENABLE_REAL_TRADING === "true";
  const webhookUrl = process.env.FYERS_AUTOMATE_WEBHOOK_URL;

  if (!isReal) {
    console.log(`[FyersBridge] [PAPER MODE] Real trading disabled. Signal: ${trade.id} (${action})`);
    return;
  }

  if (!webhookUrl) {
    console.warn(`[FyersBridge] ⚠️ ENABLE_REAL_TRADING is true but FYERS_AUTOMATE_WEBHOOK_URL is missing!`);
    return;
  }

  try {
    const payload = {
      action, // "ENTRY" or "EXIT"
      tradeId: trade.id,
      instrument: trade.instrument,
      direction: trade.direction,
      strike: trade.strike,
      qty: trade.qty,
      entryPrice: trade.entry_price,
      exitPrice: trade.exit_price ?? 0,
      timestamp: Date.now(),
    };

    console.log(`[FyersBridge] 🚀 Webhook Sending: ${trade.id} - ${trade.direction} ${trade.strike} (${action})`);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log(`[FyersBridge] ✅ Webhook successfully sent to Fyers Automate (Status: ${res.status}).`);
    } else {
      const txt = await res.text().catch(() => "");
      console.error(`[FyersBridge] ❌ Webhook execution failed (Status: ${res.status}): ${txt}`);
    }
  } catch (err: any) {
    console.error(`[FyersBridge] ❌ Webhook fetch error:`, err.message);
  }
}
