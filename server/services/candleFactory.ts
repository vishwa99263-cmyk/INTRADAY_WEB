import { db } from "../storage/db.js";

export interface CandleRecord {
  timestamp: string; // ISO string
  symbol: string;
  resolution: string; // '1s','5s','15s','1m','5m','renko','range','volume' etc
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  vwap: number;
  buy_volume?: number;
  sell_volume?: number;
  bid_ask_data?: string; // JSON string of price level volume footprints [price, bidVol, askVol]
}

/**
 * CandleFactory: Translates raw tick streams into multiple standard and custom charting styles.
 * Decoupled completely from external client dependencies. Serves as database source of truth.
 */
export class CandleFactory {
  
  /**
   * Main entry point to compile standard time-bracket candles from raw ticks.
   * Resolutions: '1s' | '5s' | '10s' | '15s' | '30s' | '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | 'D'
   */
  public static async compileTimeCandles(
    symbol: string,
    resolution: string,
    startTime: Date,
    endTime: Date
  ): Promise<CandleRecord[]> {
    const ticksQuery = `
      SELECT timestamp, ltp, volume, bid, ask, oi, vwap, bid_qty, ask_qty
      FROM raw_ticks
      WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3
      ORDER BY timestamp ASC
    `;
    const { rows } = await db.query(ticksQuery, [symbol, startTime, endTime]);
    if (rows.length === 0) return [];

    let intervalMs = 60000; // 1m default
    switch (resolution) {
      case "1s": intervalMs = 1000; break;
      case "5s": intervalMs = 5000; break;
      case "10s": intervalMs = 10000; break;
      case "15s": intervalMs = 15000; break;
      case "30s": intervalMs = 30000; break;
      case "3m": intervalMs = 180000; break;
      case "5m": intervalMs = 300000; break;
      case "15m": intervalMs = 900000; break;
      case "30m": intervalMs = 1800000; break;
      case "1h": intervalMs = 3600000; break;
      case "D": intervalMs = 86400000; break;
    }

    const candles: CandleRecord[] = [];
    let currentBucketTime = Math.floor(new Date(rows[0].timestamp).getTime() / intervalMs) * intervalMs;
    let bucketTicks: any[] = [];

    const compileBucket = (bucketTime: number, ticks: any[]) => {
      if (ticks.length === 0) return;
      const prices = ticks.map(t => Number(t.ltp));
      const open = prices[0];
      const close = prices[prices.length - 1];
      const high = Math.max(...prices);
      const low = Math.min(...prices);

      // Volume is accumulated or delta calculated
      const startVol = ticks[0].volume;
      const endVol = ticks[ticks.length - 1].volume;
      const volume = Math.max(0, endVol - startVol);

      const oi = Number(ticks[ticks.length - 1].oi || 0);
      const vwap = Number(ticks[ticks.length - 1].vwap || close);

      // footprint compilation
      let buyVolume = 0;
      let sellVolume = 0;
      const footprintsMap: Record<number, { bid: number; ask: number }> = {};

      ticks.forEach((tick, idx) => {
        if (idx === 0) return;
        const prev = ticks[idx - 1];
        const priceChange = tick.ltp - prev.ltp;
        const volChange = Math.max(0, tick.volume - prev.volume);

        const ltpKey = parseFloat(Number(tick.ltp).toFixed(2));
        if (!footprintsMap[ltpKey]) footprintsMap[ltpKey] = { bid: 0, ask: 0 };

        if (priceChange > 0) {
          buyVolume += volChange;
          footprintsMap[ltpKey].ask += volChange;
        } else if (priceChange < 0) {
          sellVolume += volChange;
          footprintsMap[ltpKey].bid += volChange;
        } else {
          // distributed by spread proximity
          const spread = tick.ask - tick.bid;
          if (spread > 0) {
            const mid = tick.bid + spread / 2;
            if (tick.ltp > mid) {
              buyVolume += volChange;
              footprintsMap[ltpKey].ask += volChange;
            } else {
              sellVolume += volChange;
              footprintsMap[ltpKey].bid += volChange;
            }
          } else {
            buyVolume += volChange / 2;
            sellVolume += volChange / 2;
            footprintsMap[ltpKey].ask += volChange / 2;
            footprintsMap[ltpKey].bid += volChange / 2;
          }
        }
      });

      const bid_ask_data = JSON.stringify(
        Object.entries(footprintsMap).map(([p, v]) => [Number(p), v.bid, v.ask])
      );

      candles.push({
        timestamp: new Date(bucketTime).toISOString(),
        symbol,
        resolution,
        open,
        high,
        low,
        close,
        volume,
        oi,
        vwap,
        buy_volume: buyVolume,
        sell_volume: sellVolume,
        bid_ask_data
      });
    };

    rows.forEach(tick => {
      const tickTime = new Date(tick.timestamp).getTime();
      const bucket = Math.floor(tickTime / intervalMs) * intervalMs;

      if (bucket === currentBucketTime) {
        bucketTicks.push(tick);
      } else {
        compileBucket(currentBucketTime, bucketTicks);
        currentBucketTime = bucket;
        bucketTicks = [tick];
      }
    });

    compileBucket(currentBucketTime, bucketTicks);
    return candles;
  }

  /**
   * Heikin Ashi transformation logic
   */
  public static compileHeikinAshi(timeCandles: CandleRecord[]): CandleRecord[] {
    if (timeCandles.length === 0) return [];
    
    const haCandles: CandleRecord[] = [];
    let prevOpen = timeCandles[0].open;
    let prevClose = timeCandles[0].close;

    timeCandles.forEach((c, idx) => {
      const close = (c.open + c.high + c.low + c.close) / 4;
      const open = idx === 0 ? (c.open + c.close) / 2 : (prevOpen + prevClose) / 2;
      const high = Math.max(c.high, open, close);
      const low = Math.min(c.low, open, close);

      haCandles.push({
        ...c,
        resolution: `${c.resolution}_ha`,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2))
      });

      prevOpen = open;
      prevClose = close;
    });

    return haCandles;
  }

  /**
   * Compiles Renko bricks based on fixed price movement step.
   * Bricks open and close solely depending on price shifts exceeding target BoxSize.
   */
  public static async compileRenkoBricks(
    symbol: string,
    boxSize: number,
    startTime: Date,
    endTime: Date
  ): Promise<CandleRecord[]> {
    const ticksQuery = `
      SELECT timestamp, ltp, volume, oi, vwap
      FROM raw_ticks
      WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3
      ORDER BY timestamp ASC
    `;
    const { rows } = await db.query(ticksQuery, [symbol, startTime, endTime]);
    if (rows.length === 0) return [];

    const bricks: CandleRecord[] = [];
    let trend: "UP" | "DOWN" | null = null;
    let brickAnchor = Number(rows[0].ltp);

    rows.forEach((tick, idx) => {
      const price = Number(tick.ltp);
      const oi = Number(tick.oi || 0);
      const vwap = Number(tick.vwap || price);

      if (idx === 0) return;

      const diff = price - brickAnchor;
      
      // Check if price moved beyond boxSize threshold
      if (Math.abs(diff) >= boxSize) {
        const brickCount = Math.floor(Math.abs(diff) / boxSize);
        const direction = diff > 0 ? "UP" : "DOWN";

        for (let b = 0; b < brickCount; b++) {
          const open = brickAnchor;
          const close = direction === "UP" ? brickAnchor + boxSize : brickAnchor - boxSize;
          
          bricks.push({
            timestamp: new Date(tick.timestamp).toISOString(),
            symbol,
            resolution: `renko_${boxSize}`,
            open,
            high: Math.max(open, close),
            low: Math.min(open, close),
            close,
            volume: 0, // Tick incremental volume could be accumulated if needed
            oi,
            vwap
          });

          brickAnchor = close;
        }
        trend = direction === "UP" ? "UP" : "DOWN";
      }
    });

    return bricks;
  }

  /**
   * Range Bars close only when high - low >= TargetRange
   */
  public static async compileRangeBars(
    symbol: string,
    targetRange: number,
    startTime: Date,
    endTime: Date
  ): Promise<CandleRecord[]> {
    const ticksQuery = `
      SELECT timestamp, ltp, volume, oi, vwap
      FROM raw_ticks
      WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3
      ORDER BY timestamp ASC
    `;
    const { rows } = await db.query(ticksQuery, [symbol, startTime, endTime]);
    if (rows.length === 0) return [];

    const bars: CandleRecord[] = [];
    let open = Number(rows[0].ltp);
    let high = open;
    let low = open;
    let volumeAcc = 0;

    rows.forEach(tick => {
      const price = Number(tick.ltp);
      volumeAcc += 1; // Count tick as minor volume unit if exact incremental volume is unavailable
      high = Math.max(high, price);
      low = Math.min(low, price);

      if (high - low >= targetRange) {
        bars.push({
          timestamp: new Date(tick.timestamp).toISOString(),
          symbol,
          resolution: `range_${targetRange}`,
          open,
          high,
          low,
          close: price,
          volume: volumeAcc,
          oi: Number(tick.oi || 0),
          vwap: Number(tick.vwap || price)
        });

        // Start next bar
        open = price;
        high = price;
        low = price;
        volumeAcc = 0;
      }
    });

    return bars;
  }

  /**
   * Volume Bars close when cumulative volume exceeds target threshold.
   */
  public static async compileVolumeBars(
    symbol: string,
    volumeTarget: number,
    startTime: Date,
    endTime: Date
  ): Promise<CandleRecord[]> {
    const ticksQuery = `
      SELECT timestamp, ltp, volume, oi, vwap
      FROM raw_ticks
      WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3
      ORDER BY timestamp ASC
    `;
    const { rows } = await db.query(ticksQuery, [symbol, startTime, endTime]);
    if (rows.length === 0) return [];

    const bars: CandleRecord[] = [];
    let open = Number(rows[0].ltp);
    let high = open;
    let low = open;
    let volumeAcc = 0;
    let prevVolume = Number(rows[0].volume);

    rows.forEach(tick => {
      const price = Number(tick.ltp);
      const curVolume = Number(tick.volume);
      const incVolume = Math.max(0, curVolume - prevVolume);
      
      high = Math.max(high, price);
      low = Math.min(low, price);
      volumeAcc += incVolume;
      prevVolume = curVolume;

      if (volumeAcc >= volumeTarget) {
        bars.push({
          timestamp: new Date(tick.timestamp).toISOString(),
          symbol,
          resolution: `volume_${volumeTarget}`,
          open,
          high,
          low,
          close: price,
          volume: volumeAcc,
          oi: Number(tick.oi || 0),
          vwap: Number(tick.vwap || price)
        });

        open = price;
        high = price;
        low = price;
        volumeAcc = 0;
      }
    });

    return bars;
  }

  /**
   * Spools compiled candles to Postgres warehouse db.
   */
  public static async persistCandles(candles: CandleRecord[]): Promise<void> {
    if (candles.length === 0) return;

    const values = candles.map(c => [
      c.timestamp,
      c.symbol,
      c.resolution,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
      c.oi,
      c.vwap
    ]);

    await db.bulkInsert("market_candles", [
      "timestamp", "symbol", "resolution", "open", "high", "low", "close", "volume", "oi", "vwap"
    ], values);
  }
}
