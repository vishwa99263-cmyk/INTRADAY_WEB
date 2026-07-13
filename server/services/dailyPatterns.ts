import fs from "fs";
import path from "path";
import { fetchFyersHistory, HistoryCandle } from "./chartHistory.js";
import { db } from "../storage/db.js";
import { getRTCandles, RTInstrument } from "./chartRealtime.js";


const CACHE_FILE = path.join(process.cwd(), "server", "storage", "daily_patterns_summary.json");

export interface DailyPatternRecord {
  date: string;
  symbol: string;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayClose: number;
  prevClose: number;
  first15mHigh: number;
  first15mLow: number;
  broke15mHigh: boolean;
  ceExtension: number;
  broke15mLow: boolean;
  peExtension: number;
  maxUpsideOvershoot: number;
  maxDownsideOvershoot: number;
}

export interface IntervalStat {
  time: string;       // e.g., "09:15"
  avgRange: number;   // average points (High - Low)
  avgRangePct: number; // average percentage
  avgVolume: number;  // average volume
  sampleCount: number;
}

export interface PatternSummary {
  symbol: string;
  avgCeExtension: number;
  avgPeExtension: number;
  avgUpsideOvershoot: number;
  avgDownsideOvershoot: number;
  sampleDaysCount: number;
  lastUpdated: number;
  intervalStats?: IntervalStat[];
}

// Memory cache for historical candles: Record<symbol, Record<dateStr, HistoryCandle[]>>
export const historicalCandlesCache: Record<string, Record<string, HistoryCandle[]>> = {
  NIFTY: {},
  SENSEX: {},
  BANKNIFTY: {},
};

// Memory Cache baseline
let patternCache: Record<string, PatternSummary> = {
  NIFTY: {
    symbol: "NIFTY",
    avgCeExtension: 35,
    avgPeExtension: 35,
    avgUpsideOvershoot: 25,
    avgDownsideOvershoot: 25,
    sampleDaysCount: 0,
    lastUpdated: 0,
  },
  SENSEX: {
    symbol: "SENSEX",
    avgCeExtension: 110,
    avgPeExtension: 110,
    avgUpsideOvershoot: 80,
    avgDownsideOvershoot: 80,
    sampleDaysCount: 0,
    lastUpdated: 0,
  },
  BANKNIFTY: {
    symbol: "BANKNIFTY",
    avgCeExtension: 80,
    avgPeExtension: 80,
    avgUpsideOvershoot: 60,
    avgDownsideOvershoot: 60,
    sampleDaysCount: 0,
    lastUpdated: 0,
  }
};

/** Load summary from disk cache if exists */
export function loadPatternsFromDisk(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const obj = JSON.parse(raw);
      patternCache = { ...patternCache, ...obj };
      console.log("[DailyPatterns] Loaded summary stats cache from disk.");
    }
  } catch (e: any) {
    console.warn("[DailyPatterns] Disk load failed:", e.message);
  }
}

/** Save summary to disk cache */
function savePatternsToDisk(): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(patternCache, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[DailyPatterns] Disk save failed:", e.message);
  }
}

export function getPatternsSummary(symbol: string): PatternSummary {
  const normSym = symbol.includes("SENSEX") ? "SENSEX" : (symbol.includes("BANKNIFTY") || symbol.includes("NIFTYBANK") ? "BANKNIFTY" : "NIFTY");
  return patternCache[normSym];
}

/** Convert Unix UTC timestamp to IST date string "YYYY-MM-DD" */
function getISTDateString(utcSeconds: number): string {
  const dateObj = new Date(utcSeconds * 1000);
  const istFormatter = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return istFormatter.format(dateObj).replace(/\//g, "-");
}

/** Convert Unix UTC timestamp to IST time string "HH:MM" */
function getISTTimeString(utcSeconds: number): string {
  const dateObj = new Date(utcSeconds * 1000);
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return istFormatter.format(dateObj);
}

/** Fetch historical 15m candles in chunks of 60 days to compile 6 months (180 days) */
async function fetch180Days15m(symbol: string): Promise<HistoryCandle[]> {
  const now = Math.floor(Date.now() / 1000);
  const chunks = [
    { from: now - 180 * 86400, to: now - 120 * 86400 },
    { from: now - 120 * 86400, to: now - 60 * 86400 },
    { from: now - 60 * 86400, to: now }
  ];

  let combined: HistoryCandle[] = [];
  for (const chunk of chunks) {
    try {
      const candles = await fetchFyersHistory(symbol, "15", chunk.from, chunk.to);
      if (candles && candles.length > 0) {
        combined.push(...candles);
      }
    } catch (err: any) {
      console.warn(`[DailyPatterns] Chunk fetch failed for ${symbol}:`, err.message);
    }
  }

  // Deduplicate and sort
  const map = new Map<number, HistoryCandle>();
  for (const c of combined) {
    map.set(c.time, c);
  }

  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

/** Run the daily pattern compilation pipeline for a given index symbol */
export async function compileIndexPatterns(pageName: "NIFTY" | "SENSEX" | "BANKNIFTY"): Promise<void> {
  const fyersSymbol = pageName === "SENSEX"
    ? "BSE:SENSEX-INDEX"
    : (pageName === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "NSE:NIFTY50-INDEX");

  console.log(`[DailyPatterns] Starting 6-month historical compilation for ${pageName} (${fyersSymbol})...`);
  const candles = await fetch180Days15m(fyersSymbol);

  if (!candles || candles.length === 0) {
    console.warn(`[DailyPatterns] No historical 15m candles found for ${pageName} — keeping default presets`);
    return;
  }

  // Group candles by IST date
  const groups: Record<string, HistoryCandle[]> = {};
  for (const c of candles) {
    const istDate = getISTDateString(c.time);
    if (!groups[istDate]) groups[istDate] = [];
    groups[istDate].push(c);
  }
  historicalCandlesCache[pageName] = groups;

  const sortedDates = Object.keys(groups).sort();
  const dailyRecords: DailyPatternRecord[] = [];

  for (let i = 0; i < sortedDates.length; i++) {
    const dateStr = sortedDates[i];
    const dayCandles = groups[dateStr].sort((a, b) => a.time - b.time);

    if (dayCandles.length < 2) continue; // Skip incomplete days

    const first15m = dayCandles[0];
    const first15mHigh = first15m.high;
    const first15mLow = first15m.low;

    const dayHigh = Math.max(...dayCandles.map(c => c.high));
    const dayLow = Math.min(...dayCandles.map(c => c.low));
    const dayOpen = dayCandles[0].open;
    const dayClose = dayCandles[dayCandles.length - 1].close;

    // Get previous day's close
    let prevClose = dayOpen;
    if (i > 0) {
      const prevDateStr = sortedDates[i - 1];
      const prevDayCandles = groups[prevDateStr].sort((a, b) => a.time - b.time);
      if (prevDayCandles.length > 0) {
        prevClose = prevDayCandles[prevDayCandles.length - 1].close;
      }
    }

    const broke15mHigh = dayHigh > first15mHigh;
    const ceExtension = broke15mHigh ? dayHigh - first15mHigh : 0;

    const broke15mLow = dayLow < first15mLow;
    const peExtension = broke15mLow ? first15mLow - dayLow : 0;

    // ── Previous Close Overshoot Excursions ──
    let maxUpsideOvershoot = 0;
    let maxDownsideOvershoot = 0;

    let inUpside = false;
    let upsidePeak = 0;
    let inDownside = false;
    let downsideTrough = Infinity;

    for (const c of dayCandles) {
      // Crossed above prevClose
      if (c.high > prevClose) {
        if (c.close > prevClose) {
          inUpside = true;
          upsidePeak = Math.max(upsidePeak, c.high);
        }
      }
      // Crossed below prevClose
      if (c.low < prevClose) {
        if (c.close < prevClose) {
          inDownside = true;
          downsideTrough = Math.min(downsideTrough, c.low);
        }
      }

      // End of upside excursion (reversed back below prevClose)
      if (inUpside && c.close < prevClose) {
        maxUpsideOvershoot = Math.max(maxUpsideOvershoot, upsidePeak - prevClose);
        inUpside = false;
        upsidePeak = 0;
      }
      // End of downside excursion (reversed back above prevClose)
      if (inDownside && c.close > prevClose) {
        maxDownsideOvershoot = Math.max(maxDownsideOvershoot, prevClose - downsideTrough);
        inDownside = false;
        downsideTrough = Infinity;
      }
    }

    // Check open excursions that reversed from peak before close
    if (inUpside && dayClose < upsidePeak) {
      maxUpsideOvershoot = Math.max(maxUpsideOvershoot, upsidePeak - prevClose);
    }
    if (inDownside && dayClose > downsideTrough) {
      maxDownsideOvershoot = Math.max(maxDownsideOvershoot, prevClose - downsideTrough);
    }

    dailyRecords.push({
      date: dateStr,
      symbol: pageName,
      dayOpen,
      dayHigh,
      dayLow,
      dayClose,
      prevClose,
      first15mHigh,
      first15mLow,
      broke15mHigh,
      ceExtension,
      broke15mLow,
      peExtension,
      maxUpsideOvershoot,
      maxDownsideOvershoot
    });
  }

  // Calculate Averages
  const ceExts = dailyRecords.filter(r => r.broke15mHigh && r.ceExtension > 0).map(r => r.ceExtension);
  const peExts = dailyRecords.filter(r => r.broke15mLow && r.peExtension > 0).map(r => r.peExtension);
  const upOvershoots = dailyRecords.filter(r => r.maxUpsideOvershoot > 0).map(r => r.maxUpsideOvershoot);
  const dnOvershoots = dailyRecords.filter(r => r.maxDownsideOvershoot > 0).map(r => r.maxDownsideOvershoot);

  const avgCeExtension = ceExts.length > 0 ? ceExts.reduce((a, b) => a + b, 0) / ceExts.length : (pageName === "SENSEX" ? 110 : (pageName === "BANKNIFTY" ? 80 : 35));
  const avgPeExtension = peExts.length > 0 ? peExts.reduce((a, b) => a + b, 0) / peExts.length : (pageName === "SENSEX" ? 110 : (pageName === "BANKNIFTY" ? 80 : 35));
  const avgUpsideOvershoot = upOvershoots.length > 0 ? upOvershoots.reduce((a, b) => a + b, 0) / upOvershoots.length : (pageName === "SENSEX" ? 85 : (pageName === "BANKNIFTY" ? 60 : 25));
  const avgDownsideOvershoot = dnOvershoots.length > 0 ? dnOvershoots.reduce((a, b) => a + b, 0) / dnOvershoots.length : (pageName === "SENSEX" ? 85 : (pageName === "BANKNIFTY" ? 60 : 25));

  const timeGroups: Record<string, { totalRange: number; totalRangePct: number; totalVolume: number; count: number }> = {};
  
  for (const c of candles) {
    const timeStr = getISTTimeString(c.time);
    if (!timeGroups[timeStr]) {
      timeGroups[timeStr] = { totalRange: 0, totalRangePct: 0, totalVolume: 0, count: 0 };
    }
    const range = c.high - c.low;
    const rangePct = c.open > 0 ? (range / c.open) * 100 : 0;
    
    timeGroups[timeStr].totalRange += range;
    timeGroups[timeStr].totalRangePct += rangePct;
    timeGroups[timeStr].totalVolume += (c.volume || 0);
    timeGroups[timeStr].count += 1;
  }
  
  const intervalStats: IntervalStat[] = Object.keys(timeGroups)
    .sort()
    .map(time => {
      const g = timeGroups[time];
      return {
        time,
        avgRange: parseFloat((g.totalRange / g.count).toFixed(1)),
        avgRangePct: parseFloat((g.totalRangePct / g.count).toFixed(3)),
        avgVolume: Math.round(g.totalVolume / g.count),
        sampleCount: g.count
      };
    });

  patternCache[pageName] = {
    symbol: pageName,
    avgCeExtension: parseFloat(avgCeExtension.toFixed(1)),
    avgPeExtension: parseFloat(avgPeExtension.toFixed(1)),
    avgUpsideOvershoot: parseFloat(avgUpsideOvershoot.toFixed(1)),
    avgDownsideOvershoot: parseFloat(avgDownsideOvershoot.toFixed(1)),
    sampleDaysCount: dailyRecords.length,
    lastUpdated: Date.now(),
    intervalStats
  };

  savePatternsToDisk();
  console.log(`[DailyPatterns] ✅ Compiled stats for ${pageName} over ${dailyRecords.length} days:
    Avg CE Range Extension: ${avgCeExtension.toFixed(1)} pts
    Avg PE Range Extension: ${avgPeExtension.toFixed(1)} pts
    Avg Upside PC Overshoot: ${avgUpsideOvershoot.toFixed(1)} pts
    Avg Downside PC Overshoot: ${avgDownsideOvershoot.toFixed(1)} pts`);
}

/** Auto-compile patterns on startup for all indexes */
export async function initializeDailyPatterns(): Promise<void> {
  loadPatternsFromDisk();
  // We run in background
  Promise.all([
    compileIndexPatterns("NIFTY"),
    compileIndexPatterns("SENSEX"),
    compileIndexPatterns("BANKNIFTY")
  ]).catch(err => {
    console.error("[DailyPatterns] Initialization failed:", err);
  });
}

function computeSingleDayMetrics(candles: any[], symbol: string, dateStr: string, prevClose: number) {
  if (candles.length === 0) return null;
  
  const first15m = candles[0];
  const first15mHigh = first15m.high;
  const first15mLow = first15m.low;

  const dayHigh = Math.max(...candles.map(c => c.high));
  const dayLow = Math.min(...candles.map(c => c.low));
  const dayOpen = candles[0].open;
  const dayClose = candles[candles.length - 1].close;

  const broke15mHigh = dayHigh > first15mHigh;
  const ceExtension = broke15mHigh ? dayHigh - first15mHigh : 0;

  const broke15mLow = dayLow < first15mLow;
  const peExtension = broke15mLow ? first15mLow - dayLow : 0;

  let maxUpsideOvershoot = 0;
  let maxDownsideOvershoot = 0;

  let inUpside = false;
  let upsidePeak = 0;
  let inDownside = false;
  let downsideTrough = Infinity;

  for (const c of candles) {
    if (c.high > prevClose) {
      if (c.close > prevClose) {
        inUpside = true;
        upsidePeak = Math.max(upsidePeak, c.high);
      }
    }
    if (c.low < prevClose) {
      if (c.close < prevClose) {
        inDownside = true;
        downsideTrough = Math.min(downsideTrough, c.low);
      }
    }
    if (inUpside && c.close < prevClose) {
      maxUpsideOvershoot = Math.max(maxUpsideOvershoot, upsidePeak - prevClose);
      inUpside = false;
      upsidePeak = 0;
    }
    if (inDownside && c.close > prevClose) {
      maxDownsideOvershoot = Math.max(maxDownsideOvershoot, prevClose - downsideTrough);
      inDownside = false;
      downsideTrough = Infinity;
    }
  }

  if (inUpside && dayClose < upsidePeak) {
    maxUpsideOvershoot = Math.max(maxUpsideOvershoot, upsidePeak - prevClose);
  }
  if (inDownside && dayClose > downsideTrough) {
    maxDownsideOvershoot = Math.max(maxDownsideOvershoot, prevClose - downsideTrough);
  }

  const intervalStats = candles.map(c => {
    const range = c.high - c.low;
    const rangePct = c.open > 0 ? (range / c.open) * 100 : 0;
    const dateObj = new Date(c.time * 1000);
    const timeStr = dateObj.toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    return {
      time: timeStr,
      avgRange: parseFloat(range.toFixed(1)),
      avgRangePct: parseFloat(rangePct.toFixed(3)),
      avgVolume: c.volume || 0,
      sampleCount: 1
    };
  });

  return {
    symbol,
    date: dateStr,
    sampleDaysCount: 1,
    avgCeExtension: parseFloat(ceExtension.toFixed(1)),
    avgPeExtension: parseFloat(peExtension.toFixed(1)),
    avgUpsideOvershoot: parseFloat(maxUpsideOvershoot.toFixed(1)),
    avgDownsideOvershoot: parseFloat(maxDownsideOvershoot.toFixed(1)),
    intervalStats
  };
}

export async function getPatternsForDate(symbol: string, dateStr: string): Promise<any> {
  const normSym = symbol.includes("SENSEX") ? "SENSEX" : (symbol.includes("BANKNIFTY") || symbol.includes("NIFTYBANK") ? "BANKNIFTY" : "NIFTY");
  
  // Format today's date in IST
  const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];
  const isToday = dateStr === todayIST;

  let candles: any[] = [];
  if (isToday) {
    // Get from real-time store
    const rtCandles = getRTCandles(normSym as RTInstrument, "15m");
    // Filter today's candles
    candles = rtCandles.filter(c => {
      const cDate = new Date(c.time * 1000 + 5.5 * 3600000).toISOString().split('T')[0];
      return cDate === dateStr;
    });
  } else {
    // Get from database
    const fyersSymbol = normSym === "SENSEX"
      ? "BSE:SENSEX-INDEX"
      : (normSym === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "NSE:NIFTY50-INDEX");
    try {
      const dbRes = await db.query(`
        SELECT timestamp, open, high, low, close, volume
        FROM market_candles
        WHERE symbol = $1 AND resolution = '15m' AND DATE(timestamp) = $2
        ORDER BY timestamp ASC
      `, [fyersSymbol, dateStr]);
      
      candles = dbRes.rows.map(r => ({
        time: Math.floor(new Date(r.timestamp).getTime() / 1000),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume || 0)
      }));
    } catch (err: any) {
      console.error("[DailyPatterns] DB Query failed for date-wise patterns, trying memory cache:", err.message);
    }

    // Fallback to memory cache if DB query failed or returned no rows
    if (candles.length === 0) {
      const cached = historicalCandlesCache[normSym]?.[dateStr] || [];
      candles = cached.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0
      }));
    }
  }

  if (candles.length === 0) {
    if (isToday) {
      // Fallback: return baseline historical averages so the UI doesn't break
      const baseline = getPatternsSummary(normSym);
      if (baseline) {
        return {
          ...baseline,
          date: dateStr,
          isBaseline: true
        };
      }
    }
    return null;
  }

  // Resolve prevClose
  const dayOpen = candles[0].open;
  let prevClose = dayOpen;
  try {
    const fyersSymbol = normSym === "SENSEX" ? "BSE:SENSEX-INDEX" : (normSym === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "NSE:NIFTY50-INDEX");
    const prevRes = await db.query(`
      SELECT close FROM market_candles
      WHERE symbol = $1 AND resolution = '1D' AND DATE(timestamp) < $2
      ORDER BY timestamp DESC
      LIMIT 1
    `, [fyersSymbol, dateStr]);
    if (prevRes.rows.length > 0) {
      prevClose = Number(prevRes.rows[0].close);
    }
  } catch (e) {
    // Fallback to memory cache for prevClose
    const cachedDates = Object.keys(historicalCandlesCache[normSym] || {}).sort();
    const curIdx = cachedDates.indexOf(dateStr);
    if (curIdx > 0) {
      const prevDateStr = cachedDates[curIdx - 1];
      const prevCandles = historicalCandlesCache[normSym][prevDateStr];
      if (prevCandles && prevCandles.length > 0) {
        prevClose = prevCandles[prevCandles.length - 1].close;
      }
    } else {
      const dailyCandles = getRTCandles(normSym as RTInstrument, "1D");
      if (dailyCandles.length > 1) {
        prevClose = dailyCandles[dailyCandles.length - 2].close;
      }
    }
  }

  return computeSingleDayMetrics(candles, normSym, dateStr, prevClose);
}

export async function getAvailablePatternDates(symbol: string): Promise<string[]> {
  const normSym = symbol.includes("SENSEX") ? "SENSEX" : (symbol.includes("BANKNIFTY") || symbol.includes("NIFTYBANK") ? "BANKNIFTY" : "NIFTY");
  const fyersSymbol = normSym === "SENSEX"
    ? "BSE:SENSEX-INDEX"
    : (normSym === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "NSE:NIFTY50-INDEX");
  
  const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];
  const dates = [todayIST];

  try {
    const res = await db.query(`
      SELECT DISTINCT DATE(timestamp) as date
      FROM market_candles
      WHERE symbol = $1
      ORDER BY date DESC
      LIMIT 25
    `, [fyersSymbol]);
    
    res.rows.forEach(r => {
      const dStr = new Date(r.date).toISOString().split('T')[0];
      if (!dates.includes(dStr)) {
        dates.push(dStr);
      }
    });
  } catch (err: any) {
    console.error("[DailyPatterns] Failed to get available dates from DB, trying memory cache:", err.message);
  }

  // Merge in dates from historical memory cache
  const cachedDates = Object.keys(historicalCandlesCache[normSym] || {});
  cachedDates.forEach(dStr => {
    if (!dates.includes(dStr)) {
      dates.push(dStr);
    }
  });

  return dates.sort().reverse(); // Show latest dates first
}

