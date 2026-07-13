import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { recalcStock } from "../utils/calculateScore.js";

// The 15 core heavyweight and sector leader stocks
export const CORE_HEAVYWEIGHTS = [
  "HDFCBANK", "RELIANCE", "ICICIBANK", "INFY", "TCS",
  "LT", "ITC", "BHARTIARTL", "AXISBANK", "SBIN",
  "KOTAKBANK", "TATAMOTORS", "SUNPHARMA", "TATASTEEL", "HINDUNILVR"
];

// All Nifty, BankNifty and Sensex constituent stocks to pre-populate STOCK sheets
export const ALL_CONSTITUENTS = new Set([
  "HDFCBANK", "ICICIBANK", "RELIANCE", "BHARTIARTL", "SBIN", "LT", "INFY", "AXISBANK", "ITC", "KOTAKBANK",
  "M&M", "TATACONSUM", "TCS", "BAJFINANCE", "HINDUNILVR", "MARUTI", "SUNPHARMA", "NTPC", "TITAN", "ETERNAL",
  "TATASTEEL", "BEL", "ULTRACEMCO", "SHRIRAMFIN", "HCLTECH", "HINDALCO", "POWERGRID", "JSWSTEEL", "BAJAJFINSV",
  "ONGC", "ADANIPORTS", "BAJAJ-AUTO", "EICHERMOT", "GRASIM", "ASIANPAINT", "INDIGO", "COALINDIA", "NESTLEIND",
  "SBILIFE", "TECHM", "TRENT", "JIOFIN", "APOLLOHOSP", "MAXHEALTH", "DRREDDY", "TMPV", "CIPLA", "HDFCLIFE",
  "WIPRO", "ADANIENT", "INDUSINDBK", "BANKBARODA", "AUBANK", "FEDERALBNK", "IDFCFIRSTB", "PNB", "BANDHANBNK"
]);

// Open/Create indicators.db SQLite connection
const DB_DIR = path.join(process.cwd(), "server", "storage");
const DB_PATH = path.join(DB_DIR, "indicators.db");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize SQLite table for daily stock Bhavcopy
db.exec(`
  CREATE TABLE IF NOT EXISTS stock_bhavcopy (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    prev_close REAL NOT NULL DEFAULT 0,
    open_price REAL NOT NULL DEFAULT 0,
    high_price REAL NOT NULL DEFAULT 0,
    low_price REAL NOT NULL DEFAULT 0,
    close_price REAL NOT NULL DEFAULT 0,
    avg_price REAL NOT NULL DEFAULT 0,
    total_volume INTEGER NOT NULL DEFAULT 0,
    turnover_lacs REAL NOT NULL DEFAULT 0,
    delivery_volume INTEGER NOT NULL DEFAULT 0,
    delivery_percentage REAL NOT NULL DEFAULT 0,
    no_of_trades INTEGER NOT NULL DEFAULT 0,
    UNIQUE (symbol, trade_date)
  );
  CREATE INDEX IF NOT EXISTS idx_stock_bhavcopy_lookup ON stock_bhavcopy(symbol, trade_date DESC);
`);

// Table migration: Add columns if they are missing from previous versions
try {
  db.exec("ALTER TABLE stock_bhavcopy ADD COLUMN prev_close REAL NOT NULL DEFAULT 0");
  console.log("[Bhavcopy] 🛠️ Migration: Added prev_close column to stock_bhavcopy");
} catch (e) {
  // Column already exists, safe to ignore
}

try {
  db.exec("ALTER TABLE stock_bhavcopy ADD COLUMN no_of_trades INTEGER NOT NULL DEFAULT 0");
  console.log("[Bhavcopy] 🛠️ Migration: Added no_of_trades column to stock_bhavcopy");
} catch (e) {
  // Column already exists, safe to ignore
}

console.log(`[Bhavcopy] ✅ SQLite Table 'stock_bhavcopy' initialized inside: ${DB_PATH}`);

/**
 * Utility to convert NSE Date format (e.g. "18-Jun-2026" or "18-JUN-2026") to YYYY-MM-DD
 */
function parseNseDate(nseDateStr: string): string | null {
  try {
    const parts = nseDateStr.trim().split("-");
    if (parts.length !== 3) return null;
    
    const day = parts[0].padStart(2, "0");
    const year = parts[2];
    
    const months: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12"
    };
    
    const month = months[parts[1].toUpperCase()];
    if (!month) return null;
    
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/**
 * Download and parse consolidated Bhavcopy for a given date from NSE Archives.
 */
export async function downloadAndParseBhavcopy(date: Date): Promise<{ success: boolean; rowsInserted: number; error?: string }> {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const dateStr = `${day}${month}${year}`;
  const dbDateStr = `${year}-${month}-${day}`;

  // Check if records for this date already exist and have valid trades data
  const checkRes = db.prepare("SELECT COUNT(*) as count, MAX(no_of_trades) as max_trades FROM stock_bhavcopy WHERE trade_date = ?").get(dbDateStr) as { count: number; max_trades: number };
  if (checkRes && checkRes.count > 0 && checkRes.max_trades > 0) {
    console.log(`[Bhavcopy] ℹ️ Date ${dbDateStr} already exists and has trades data. Skipping.`);
    return { success: true, rowsInserted: 0 };
  }

  const url = `https://archives.nseindia.com/products/content/sec_bhavdata_full_${dateStr}.csv`;
  console.log(`[Bhavcopy] 📥 Fetching from NSE: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, rowsInserted: 0, error: `404 Not Found (Market closed/Holiday)` };
      }
      return { success: false, rowsInserted: 0, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const text = await response.text();
    const lines = text.split("\n");
    if (lines.length < 2) {
      return { success: false, rowsInserted: 0, error: "Empty or invalid CSV file structure." };
    }

    // Map column headers dynamically to index
    const headers = lines[0].split(",").map(h => h.trim().toUpperCase());
    const symbolIdx = headers.indexOf("SYMBOL");
    const dateIdx = headers.indexOf("DATE1");
    const prevCloseIdx = headers.indexOf("PREV_CLOSE");
    const openIdx = headers.indexOf("OPEN_PRICE");
    const highIdx = headers.indexOf("HIGH_PRICE");
    const lowIdx = headers.indexOf("LOW_PRICE");
    const closeIdx = headers.indexOf("CLOSE_PRICE");
    const avgIdx = headers.indexOf("AVG_PRICE");
    const volIdx = headers.indexOf("TTL_TRD_QNTY");
    const turnoverIdx = headers.indexOf("TURNOVER_LACS");
    const delivQtyIdx = headers.indexOf("DELIV_QTY");
    const delivPerIdx = headers.indexOf("DELIV_PER");
    const tradesIdx = headers.indexOf("NO_OF_TRADES");

    if (symbolIdx === -1 || dateIdx === -1 || closeIdx === -1 || volIdx === -1 || delivQtyIdx === -1 || delivPerIdx === -1) {
      return { 
        success: false, 
        rowsInserted: 0, 
        error: `Missing core headers. Found: ${headers.join(", ")}` 
      };
    }

    const parsedRows: any[][] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",").map(c => c.trim());
      if (cols.length < headers.length) continue;

      const symbol = cols[symbolIdx].toUpperCase();
      if (!ALL_CONSTITUENTS.has(symbol)) continue;

      const nseDateStr = cols[dateIdx];
      const parsedDate = parseNseDate(nseDateStr) || dbDateStr;

      const prevClose = prevCloseIdx !== -1 ? (parseFloat(cols[prevCloseIdx]) || 0) : 0;
      const openPrice = parseFloat(cols[openIdx]) || 0;
      const highPrice = parseFloat(cols[highIdx]) || 0;
      const lowPrice = parseFloat(cols[lowIdx]) || 0;
      const closePrice = parseFloat(cols[closeIdx]) || 0;
      const avgPrice = parseFloat(cols[avgIdx]) || 0;
      const totalVolume = parseInt(cols[volIdx]) || 0;
      const turnoverLacs = parseFloat(cols[turnoverIdx]) || 0;
      const deliveryVolume = parseInt(cols[delivQtyIdx]) || 0;
      
      let deliveryPer = parseFloat(cols[delivPerIdx]);
      if (isNaN(deliveryPer)) deliveryPer = 0;

      const noOfTrades = tradesIdx !== -1 ? (parseInt(cols[tradesIdx]) || 0) : 0;

      parsedRows.push([
        symbol,
        parsedDate,
        prevClose,
        openPrice,
        highPrice,
        lowPrice,
        closePrice,
        avgPrice,
        totalVolume,
        turnoverLacs,
        deliveryVolume,
        deliveryPer,
        noOfTrades
      ]);
    }

    if (parsedRows.length > 0) {
      // Execute inserts in a single transaction
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO stock_bhavcopy (
          symbol, trade_date, prev_close, open_price, high_price, low_price, close_price, avg_price, total_volume, turnover_lacs, delivery_volume, delivery_percentage, no_of_trades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertTransaction = db.transaction((rows: any[][]) => {
        for (const row of rows) {
          insertStmt.run(row);
        }
      });
      
      insertTransaction(parsedRows);
    }

    return { success: true, rowsInserted: parsedRows.length };
  } catch (err: any) {
    return { success: false, rowsInserted: 0, error: err.message };
  }
}

/**
 * Loop to fetch past days of historical Bhavcopy
 */
export async function syncHistoricalBhavcopy(daysToSync = 90): Promise<{ success: boolean; syncedDates: string[]; failedDates: { date: string; error: string }[] }> {
  const syncedDates: string[] = [];
  const failedDates: { date: string; error: string }[] = [];
  const today = new Date();

  console.log(`[Bhavcopy] 🔄 Starting historical sync for ${daysToSync} calendar days in SQLite...`);

  for (let i = daysToSync; i >= 0; i--) {
    const targetDate = new Date();
    targetDate.setDate(today.getDate() - i);

    // Skip weekends (0 = Sunday, 6 = Saturday)
    const dayOfWeek = targetDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    const dateStr = targetDate.toISOString().split("T")[0];
    const res = await downloadAndParseBhavcopy(targetDate);
    
    if (res.success) {
      if (res.rowsInserted > 0) {
        syncedDates.push(dateStr);
        console.log(`[Bhavcopy] ✅ Successfully imported ${res.rowsInserted} records for ${dateStr} (SQLite)`);
      }
    } else {
      failedDates.push({ date: dateStr, error: res.error || "Unknown error" });
      console.warn(`[Bhavcopy] ⚠️ Failed for ${dateStr}: ${res.error}`);
    }

    // Delay to respect NSE and prevent IP rate-limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Auto-cleanup records older than 90 days
  try {
    const cleanupRes = db.prepare("DELETE FROM stock_bhavcopy WHERE trade_date < date('now', '-90 days')").run();
    if (cleanupRes.changes > 0) {
      console.log(`[Bhavcopy] 🗑️ Auto-purged ${cleanupRes.changes} records older than 90 days from SQLite.`);
    }
  } catch (err: any) {
    console.error("[Bhavcopy] ❌ Auto-cleanup failed:", err.message);
  }

  return {
    success: true,
    syncedDates,
    failedDates
  };
}

/**
 * Returns rolling 5-day and 30-day volume and delivery averages for all 15 stocks.
 */
export async function getStockVolumeAverages() {
  const queryText = `
    WITH rolling_stats AS (
      SELECT 
        symbol,
        trade_date,
        open_price,
        high_price,
        low_price,
        close_price,
        avg_price,
        total_volume,
        turnover_lacs,
        delivery_volume,
        delivery_percentage,
        no_of_trades,
        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY trade_date DESC) as rn
      FROM stock_bhavcopy
    ),
    stats_5d AS (
      SELECT 
        symbol,
        AVG(total_volume) as avg_vol_5d,
        AVG(delivery_volume) as avg_deliv_vol_5d,
        AVG(delivery_percentage) as avg_deliv_per_5d
      FROM rolling_stats
      WHERE rn <= 5
      GROUP BY symbol
    ),
    stats_30d AS (
      SELECT 
        symbol,
        AVG(total_volume) as avg_vol_30d,
        AVG(delivery_volume) as avg_deliv_vol_30d,
        AVG(delivery_percentage) as avg_deliv_per_30d
      FROM rolling_stats
      WHERE rn <= 30
      GROUP BY symbol
    )
    SELECT 
      c.symbol,
      c.trade_date as last_date,
      c.open_price as last_open,
      c.high_price as last_high,
      c.low_price as last_low,
      c.close_price as last_close,
      c.avg_price as last_avg,
      c.total_volume as last_volume,
      c.turnover_lacs as last_turnover,
      c.delivery_volume as last_delivery_vol,
      c.delivery_percentage as last_delivery_per,
      c.no_of_trades as last_no_of_trades,
      ROUND(s5.avg_vol_5d, 2) as avg_vol_5d,
      ROUND(s5.avg_deliv_vol_5d, 2) as avg_deliv_vol_5d,
      ROUND(s5.avg_deliv_per_5d, 2) as avg_deliv_per_5d,
      ROUND(s30.avg_vol_30d, 2) as avg_vol_30d,
      ROUND(s30.avg_deliv_vol_30d, 2) as avg_deliv_vol_30d,
      ROUND(s30.avg_deliv_per_30d, 2) as avg_deliv_per_30d
    FROM rolling_stats c
    JOIN stats_5d s5 ON c.symbol = s5.symbol
    JOIN stats_30d s30 ON c.symbol = s30.symbol
    WHERE c.rn = 1 
      AND c.symbol IN ('HDFCBANK', 'RELIANCE', 'ICICIBANK', 'INFY', 'TCS', 'LT', 'ITC', 'BHARTIARTL', 'AXISBANK', 'SBIN', 'KOTAKBANK', 'TATAMOTORS', 'SUNPHARMA', 'TATASTEEL', 'HINDUNILVR')
  `;
  
  const rows = db.prepare(queryText).all();
  return rows;
}

/**
 * Seeds stock prices (LTP, prevClose, open, high, low, volume) in marketState from the latest Bhavcopy in SQLite
 */
export function seedStocksFromBhavcopy(marketState: any): void {
  try {
    // Get the latest trade date
    const latestDateRes = db.prepare("SELECT MAX(trade_date) as max_date FROM stock_bhavcopy").get() as { max_date: string };
    if (!latestDateRes || !latestDateRes.max_date) {
      console.log("[Bhavcopy Seed] ℹ️ No historical data in SQLite to seed stocks.");
      return;
    }
    
    const latestDate = latestDateRes.max_date;
    console.log(`[Bhavcopy Seed] 🔄 Seeding stock prices from latest Bhavcopy date: ${latestDate}`);

    const rows = db.prepare("SELECT * FROM stock_bhavcopy WHERE trade_date = ?").all(latestDate) as any[];
    
    let seededCount = 0;
    const updateStockInMap = (map: Record<string, any>, row: any) => {
      const symbol = row.symbol.toUpperCase();
      const stock = map[symbol];
      if (stock) {
        stock.ltp = row.close_price;
        // Use prev_close from database, fallback to open_price if 0
        stock.prevClose = row.prev_close > 0 ? row.prev_close : row.open_price;
        stock.open = row.open_price;
        stock.high = row.high_price;
        stock.low = row.low_price;
        stock.volume = row.total_volume;
        stock.change = row.close_price - stock.prevClose;
        stock.changePercent = stock.prevClose > 0 ? parseFloat((((row.close_price - stock.prevClose) / stock.prevClose) * 100).toFixed(2)) : 0;
        recalcStock(stock);
        seededCount++;
      }
    };

    rows.forEach(row => {
      updateStockInMap(marketState.niftyStocks, row);
      updateStockInMap(marketState.sensexStocks, row);
      updateStockInMap(marketState.bankniftyStocks, row);
    });

    console.log(`[Bhavcopy Seed] ✅ Successfully seeded ${seededCount} stocks from SQLite database.`);
  } catch (err: any) {
    console.error("[Bhavcopy Seed] ❌ Failed to seed stocks from SQLite:", err.message);
  }
}

/**
 * Returns historical 90-day Bhavcopy records for a given stock symbol
 */
export function getStockHistory(symbol: string, limit = 90) {
  try {
    const queryText = `
      SELECT 
        symbol,
        trade_date,
        prev_close,
        open_price,
        high_price,
        low_price,
        close_price,
        avg_price,
        total_volume,
        turnover_lacs,
        delivery_volume,
        delivery_percentage,
        no_of_trades
      FROM stock_bhavcopy
      WHERE symbol = ?
      ORDER BY trade_date DESC
      LIMIT ?
    `;
    const rows = db.prepare(queryText).all(symbol.toUpperCase(), limit);
    return rows;
  } catch (err: any) {
    console.error(`[Bhavcopy History] ❌ Failed to fetch history for ${symbol}:`, err.message);
    throw err;
  }
}

/**
 * Returns rolling 5-day averages and filters for ENTRY / STRONG ENTRY signals in the last limitDays (default 30)
 */
export function getRecentSignals(limitDays = 30) {
  try {
    const queryText = `
      SELECT 
        symbol,
        trade_date,
        prev_close,
        open_price,
        high_price,
        low_price,
        close_price,
        avg_price,
        total_volume,
        turnover_lacs,
        delivery_volume,
        delivery_percentage,
        no_of_trades
      FROM stock_bhavcopy
      ORDER BY trade_date DESC
    `;
    
    const allRows = db.prepare(queryText).all() as any[];
    const grouped: Record<string, any[]> = {};
    for (const row of allRows) {
      if (!grouped[row.symbol]) {
        grouped[row.symbol] = [];
      }
      grouped[row.symbol].push(row);
    }

    const recentSignals: any[] = [];

    for (const symbol of Object.keys(grouped)) {
      const history = grouped[symbol];
      
      for (let i = 0; i < Math.min(limitDays, history.length); i++) {
        const row = history[i];
        
        const slice = history.slice(i, i + 5);
        if (slice.length === 0) continue;
        const avgVol = slice.reduce((acc, r) => acc + r.total_volume, 0) / slice.length;
        const avgDeliv = slice.reduce((acc, r) => acc + r.delivery_volume, 0) / slice.length;
        
        if (avgVol <= 0 || avgDeliv <= 0) continue;

        const ttqDiff = row.total_volume - avgVol;
        const ttqPercentVal = ttqDiff > 0 ? (ttqDiff / avgVol) * 100 : 0;

        const dqDiff = row.delivery_volume - avgDeliv;
        const dqPercentVal = dqDiff > 0 ? (dqDiff / avgDeliv) * 100 : 0;

        const prevRow = history[i + 1];
        if (!prevRow) continue;

        let signal: "STRONG ENTRY" | "ENTRY" | "EARLY" | "" = "";

        if (row.delivery_volume > avgDeliv && row.total_volume > avgVol && ttqPercentVal > 80 && dqPercentVal > 80) {
          if (row.close_price > row.avg_price && row.close_price > prevRow.close_price && row.delivery_percentage > 50) {
            signal = "STRONG ENTRY";
          } else {
            signal = "ENTRY";
          }
        }

        if (signal === "STRONG ENTRY" || signal === "ENTRY") {
          recentSignals.push({
            symbol: row.symbol,
            trade_date: row.trade_date,
            signal,
            close_price: row.close_price,
            prev_close: row.prev_close || prevRow.close_price,
            total_volume: row.total_volume,
            delivery_percentage: row.delivery_percentage,
            avg_vol_5d: avgVol,
            avg_deliv_vol_5d: avgDeliv
          });
        }
      }
    }

    recentSignals.sort((a, b) => {
      const dateA = new Date(a.trade_date).getTime();
      const dateB = new Date(b.trade_date).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return a.symbol.localeCompare(b.symbol);
    });

    return recentSignals;
  } catch (err: any) {
    console.error(`[Bhavcopy Recent Signals] ❌ Failed:`, err.message);
    throw err;
  }
}


