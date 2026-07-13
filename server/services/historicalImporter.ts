import { db } from "../storage/db.js";
import { getHistoricalData } from "../config/historyProvider.js";
import { DataValidationEngine } from "./dataValidation.js";
import { writeCandlesToDB } from "./candleGenerator.js";
import type { CompiledCandle } from "./candleGenerator.js";

export class HistoricalImporter {
  /**
   * Automatically checks if historical candles exist in market_candles table.
   * If not, fetches data from History Provider, validates, and stores permanently.
   */
  public static async autoBackfillIfNeeded(index: "NIFTY" | "SENSEX" | "BANKNIFTY"): Promise<void> {
    const symbol = index === "NIFTY" ? "NSE:NIFTY50-INDEX" : (index === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "BSE:SENSEX-INDEX");
    
    try {
      // 1. Verify table presence and count
      const checkQuery = `
        SELECT COUNT(*) as count 
        FROM market_candles 
        WHERE symbol = $1 AND resolution = '1m'
      `;
      const res = await db.query(checkQuery, [symbol]);
      const count = Number(res.rows[0]?.count ?? 0);

      if (count > 10) {
        console.log(`[HistoricalImporter] 📊 Candles exist for ${index} (${count} items). Skipping backfill.`);
        return;
      }

      console.log(`[HistoricalImporter] ⚠️ No historical candles found for ${index}. Commencing automatic ingestion...`);
      
      // 2. Fetch history for Nifty/Sensex index from historyProvider (last 10 days for minute bars)
      const nowSec = Math.floor(Date.now() / 1000);
      const rangeFrom = nowSec - (10 * 24 * 3600); // 10 days ago
      const rangeTo = nowSec - 60; // 1 minute ago to get completed candle

      const apiRes = await getHistoricalData({
        symbol,
        resolution: "1",
        date_format: "0",
        range_from: String(rangeFrom),
        range_to: String(rangeTo),
        cont_flag: "1",
        oi_flag: "1"
      });

      if (apiRes.s !== "ok" || !apiRes.candles || apiRes.candles.length === 0) {
        console.warn(`[HistoricalImporter] ❌ Failed to fetch historical data from provider for ${index}`);
        return;
      }

      console.log(`[HistoricalImporter] 📥 Downloaded ${apiRes.candles.length} historical candles for ${index}. Importing...`);

      // 3. Import raw candles into database hypertables
      const tickRows: any[][] = [];
      const candleRows: CompiledCandle[] = [];

      apiRes.candles.forEach(c => {
        const time = c[0];
        const open = c[1];
        const high = c[2];
        const low = c[3];
        const close = c[4];
        const volume = c[5] ?? 0;
        const oi = c[6] ?? 0;
        const ts = new Date(time * 1000).toISOString();

        // Validate and clean values
        const validTick = DataValidationEngine.validateAndRepairTick({
          timestamp: ts,
          symbol,
          ltp: close,
          volume,
          bid: close * 0.9999,
          ask: close * 1.0001,
          oi
        });

        if (validTick) {
          tickRows.push([
            validTick.timestamp,
            validTick.symbol,
            validTick.ltp,
            validTick.volume,
            validTick.bid,
            validTick.ask,
            0, // bid_qty
            0, // ask_qty
            validTick.oi,
            validTick.ltp // vwap
          ]);

          candleRows.push({
            timestamp: validTick.timestamp,
            symbol,
            resolution: "1m",
            open,
            high,
            low,
            close: validTick.ltp,
            volume: validTick.volume,
            oi: validTick.oi,
            vwap: validTick.ltp,
            deltaVolume: 0,
            buyPressure: 0,
            sellPressure: 0,
            momentum: 0
          });
        }
      });

      // 4. Bulk insert raw ticks
      if (tickRows.length > 0) {
        await db.bulkInsert("raw_ticks", [
          "timestamp", "symbol", "ltp", "volume", "bid", "ask", "bid_qty", "ask_qty", "oi", "vwap"
        ], tickRows);
        console.log(`[HistoricalImporter] Spooled ${tickRows.length} raw ticks into raw_ticks table.`);
      }

      // 5. Spool compiled candles
      if (candleRows.length > 0) {
        await writeCandlesToDB(candleRows);
        console.log(`[HistoricalImporter] Spooled ${candleRows.length} aggregated candles into market_candles table.`);
      }

      console.log(`[HistoricalImporter] ✅ Ingestion and Backfill completed successfully for ${index}.`);

    } catch (err: any) {
      console.error(`[HistoricalImporter] ❌ Error executing historical backfill for ${index}:`, err.message);
    }
  }
}
