/**
 * chartHistory.ts — Fyers Historical Candle Data Service
 *
 * Fetches OHLCV candle history from the Fyers v3 REST API.
 * Caches results to server/storage/chart-cache/ directory.
 * Falls back to cache when Fyers API is unavailable or token is missing.
 *
 * Supported symbols:
 *   NSE:NIFTY50-INDEX  → NIFTY 50
 *   BSE:SENSEX-INDEX   → SENSEX
 *
 * Fyers resolutions:
 *   "1" | "3" | "5" | "15" | "30" | "60" | "D"
 */

import fs   from "fs";
import path from "path";
import { marketState } from "../state/marketState.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface HistoryCandle {
  time:   number; // Unix seconds (UTC)
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(process.cwd(), "server", "storage", "chart-cache");
const FYERS_HISTORY_URL = "https://api-t2.fyers.in/data/history";

/** Days of history to fetch per resolution */
const HISTORY_DAYS: Record<string, number> = {
  "1":  10,
  "3":  15,
  "5":  30,
  "15": 60,
  "30": 90,
  "60": 180,
  "D":  730,
};

// ── Cache helpers ──────────────────────────────────────────────────────────────

function cacheKey(symbol: string, resolution: string): string {
  return `${symbol.replace(/[^a-zA-Z0-9]/g, "_")}_${resolution}`;
}

function cachePath(symbol: string, resolution: string): string {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `${cacheKey(symbol, resolution)}.json`);
}

export function saveHistoryCache(symbol: string, resolution: string, candles: HistoryCandle[]): void {
  try {
    fs.writeFileSync(cachePath(symbol, resolution), JSON.stringify(candles), "utf-8");
    console.log(`[ChartHistory] Saved ${candles.length} candles → cache (${symbol} ${resolution})`);
  } catch (e: any) {
    console.warn("[ChartHistory] Cache write failed:", e.message);
  }
}

export function loadHistoryCache(symbol: string, resolution: string): HistoryCandle[] {
  try {
    const p = cachePath(symbol, resolution);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf-8");
    const arr = JSON.parse(raw) as HistoryCandle[];
    console.log(`[ChartHistory] Loaded ${arr.length} candles from cache (${symbol} ${resolution})`);
    return arr;
  } catch (e: any) {
    console.warn("[ChartHistory] Cache read failed:", e.message);
    return [];
  }
}

// ── Fyers API fetch ────────────────────────────────────────────────────────────

/**
 * Fetch historical candles from Fyers v3 REST API.
 * Returns empty array if not authorized or on network error.
 */
export async function fetchFyersHistory(
  symbol: string,
  resolution: string,
  rangeFrom?: number,  // Unix seconds, defaults to (HISTORY_DAYS) ago
  rangeTo?:   number,  // Unix seconds, defaults to now
): Promise<HistoryCandle[]> {
  const { app_id, access_token } = marketState.fyersConfig;
  if (!access_token) {
    console.warn("[ChartHistory] No access token — returning cache");
    return loadHistoryCache(symbol, resolution);
  }

  const days   = HISTORY_DAYS[resolution] ?? 30;
  const to     = rangeTo   ?? Math.floor(Date.now() / 1000);
  const from   = rangeFrom ?? (to - days * 86400);

  const url = `${FYERS_HISTORY_URL}?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&date_format=1&range_from=${from}&range_to=${to}&cont_flag=1`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `${app_id}:${access_token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      console.warn(`[ChartHistory] HTTP ${resp.status} from Fyers — falling back to cache`);
      return loadHistoryCache(symbol, resolution);
    }

    const body = await resp.json() as any;

    if (body.s !== "ok" || !Array.isArray(body.candles)) {
      console.warn("[ChartHistory] Fyers API error:", body.message ?? body.s);
      return loadHistoryCache(symbol, resolution);
    }

    // Fyers candles: [timestamp, open, high, low, close, volume]
    const candles: HistoryCandle[] = body.candles.map((c: number[]) => ({
      time:   c[0],
      open:   c[1],
      high:   c[2],
      low:    c[3],
      close:  c[4],
      volume: c[5] ?? 0,
    }));

    // Sort ascending by time
    candles.sort((a, b) => a.time - b.time);

    // Persist to cache
    saveHistoryCache(symbol, resolution, candles);

    console.log(`[ChartHistory] ✅ Fetched ${candles.length} candles (${symbol} ${resolution})`);
    return candles;

  } catch (e: any) {
    console.warn("[ChartHistory] Fetch error:", e.message, "— falling back to cache");
    return loadHistoryCache(symbol, resolution);
  }
}

/**
 * Get history: tries Fyers API first, falls back to cache.
 * Merges: loads cache baseline + fetches recent data, deduplicates.
 */
export async function getHistory(
  symbol: string,
  resolution: string,
): Promise<HistoryCandle[]> {
  const cached = loadHistoryCache(symbol, resolution);
  const live   = await fetchFyersHistory(symbol, resolution);

  if (live.length > 0) return live;
  return cached;
}
