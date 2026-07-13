import { db } from "../storage/db.js";

export interface CompiledCandle {
  timestamp: string;
  symbol: string;
  resolution: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  vwap: number;
  deltaVolume: number;
  buyPressure: number;
  sellPressure: number;
  momentum: number;
}

// In-memory aggregates for extremely fast sub-minute compilation caching
const subMinuteCache: Map<string, CompiledCandle[]> = new Map();

/**
 * Generates custom candles historically or in real time from stored tick data.
 * 
 * Includes advanced metrics:
 * - deltaVolume: Net difference in volume traded on up-ticks vs down-ticks
 * - buyPressure / sellPressure: Approximations based on trade placement relative to spread
 * - momentum: Rate of price change within the candle
 */
export async function generateCandlesFromTicks(
  symbol: string,
  resolution: string, // '1s', '5s', '15s', '30s', '1m', '5m', '15m', '1h', 'D'
  startTime: Date,
  endTime: Date
): Promise<CompiledCandle[]> {
  const query = `
    SELECT timestamp, ltp, volume, bid, ask, oi, vwap
    FROM raw_ticks
    WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3
    ORDER BY timestamp ASC
  `;

  const { rows } = await db.query(query, [symbol, startTime, endTime]);
  if (rows.length === 0) return [];

  // Parse time frames based on resolution
  let intervalMs = 60000; // default 1m
  if (resolution === "1s") intervalMs = 1000;
  else if (resolution === "5s") intervalMs = 5000;
  else if (resolution === "15s") intervalMs = 15000;
  else if (resolution === "30s") intervalMs = 30000;
  else if (resolution === "3m") intervalMs = 180000;
  else if (resolution === "5m") intervalMs = 300000;
  else if (resolution === "15m") intervalMs = 900000;
  else if (resolution === "30m") intervalMs = 1800000;
  else if (resolution === "60m" || resolution === "1h") intervalMs = 3600000;
  else if (resolution === "D") intervalMs = 86400000;

  const candles: CompiledCandle[] = [];
  let currentBucketTime = Math.floor(new Date(rows[0].timestamp).getTime() / intervalMs) * intervalMs;
  let currentTicks: any[] = [];

  const compileBucket = (bucketTime: number, ticks: any[]) => {
    if (ticks.length === 0) return;

    const prices = ticks.map(t => Number(t.ltp));
    const open = prices[0];
    const close = prices[prices.length - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    const volumes = ticks.map(t => Number(t.volume));
    // Cumulative volume calculation (ticks store total_volume_today, so net delta per bucket is final - start)
    const startVol = ticks[0].volume;
    const endVol = ticks[ticks.length - 1].volume;
    const volume = Math.max(0, endVol - startVol);

    const latestOi = Number(ticks[ticks.length - 1].oi || 0);
    const latestVwap = Number(ticks[ticks.length - 1].vwap || close);

    // Advanced Institutional Metrics: Buy/Sell Pressure & Delta Volume
    let deltaVolume = 0;
    let buyPressure = 0;
    let sellPressure = 0;

    ticks.forEach((t, idx) => {
      if (idx === 0) return;
      const prevTick = ticks[idx - 1];
      const priceChange = t.ltp - prevTick.ltp;
      const volChange = Math.max(0, t.volume - prevTick.volume);

      // Tick Directional Delta Volume
      if (priceChange > 0) {
        deltaVolume += volChange;
        buyPressure += volChange;
      } else if (priceChange < 0) {
        deltaVolume -= volChange;
        sellPressure += volChange;
      } else {
        // Neutral tick delta distributed by spread proximity
        const spread = t.ask - t.bid;
        if (spread > 0) {
          const mid = t.bid + spread / 2;
          if (t.ltp > mid) buyPressure += volChange;
          else sellPressure += volChange;
        } else {
          buyPressure += volChange / 2;
          sellPressure += volChange / 2;
        }
      }
    });

    const momentum = parseFloat((((close - open) / open) * 100).toFixed(4));

    candles.push({
      timestamp: new Date(bucketTime).toISOString(),
      symbol,
      resolution,
      open,
      high,
      low,
      close,
      volume,
      oi: latestOi,
      vwap: latestVwap,
      deltaVolume,
      buyPressure,
      sellPressure,
      momentum
    });
  };

  rows.forEach(tick => {
    const tickTime = new Date(tick.timestamp).getTime();
    const bucket = Math.floor(tickTime / intervalMs) * intervalMs;

    if (bucket === currentBucketTime) {
      currentTicks.push(tick);
    } else {
      compileBucket(currentBucketTime, currentTicks);
      currentBucketTime = bucket;
      currentTicks = [tick];
    }
  });

  // Compile final outstanding bucket
  compileBucket(currentBucketTime, currentTicks);

  return candles;
}

/**
 * Spools compiled candles directly to PostgreSQL custom database.
 */
export async function writeCandlesToDB(candles: CompiledCandle[]): Promise<void> {
  if (candles.length === 0) return;

  const rows = candles.map(c => [
    c.timestamp, c.symbol, c.resolution, c.open, c.high, c.low, c.close, c.volume, c.oi, c.vwap
  ]);

  await db.bulkInsert("market_candles", [
    "timestamp", "symbol", "resolution", "open", "high", "low", "close", "volume", "oi", "vwap"
  ], rows);
}
