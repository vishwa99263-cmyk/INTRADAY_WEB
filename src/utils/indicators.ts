/**
 * indicators.ts — Technical Indicator Calculation Utilities
 *
 * Pure functions, no side effects, no React dependencies.
 *
 * Indicators:
 *   EMA  — Exponential Moving Average
 *   SMA  — Simple Moving Average
 *   BB   — Bollinger Bands (upper, middle, lower)
 *   RSI  — Relative Strength Index
 *   MACD — Moving Average Convergence/Divergence
 *   VWAP — Volume Weighted Average Price (session-based)
 *
 * All functions return null for periods where not enough data exists.
 */

// ── Types ───────────────────────────────────────────────────────────────────────

export interface BollingerBand {
  upper:  number;
  middle: number;
  lower:  number;
}

export interface MACDPoint {
  macd:      number | null;
  signal:    number | null;
  histogram: number | null;
}

export interface OHLCVInput {
  time:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

// ── EMA ─────────────────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * Returns null for indices where period is not yet met.
 */
export function calcEMA(values: number[], period: number): (number | null)[] {
  if (period <= 0 || values.length === 0) return values.map(() => null);

  const k      = 2 / (period + 1);
  const result: (number | null)[] = [];
  let ema: number | null = null;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      // Seed EMA with SMA of first `period` values
      ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result.push(ema);
    } else {
      ema = values[i] * k + ema! * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

// ── SMA ─────────────────────────────────────────────────────────────────────────

export function calcSMA(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    return values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

// ── Bollinger Bands ──────────────────────────────────────────────────────────────

export function calcBollinger(
  values: number[],
  period = 20,
  mult   = 2,
): (BollingerBand | null)[] {
  const sma = calcSMA(values, period);
  return values.map((_, i) => {
    if (sma[i] === null) return null;
    const slice    = values.slice(i - period + 1, i + 1);
    const mean     = sma[i] as number;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std      = Math.sqrt(variance);
    return {
      upper:  mean + mult * std,
      middle: mean,
      lower:  mean - mult * std,
    };
  });
}

// ── RSI ──────────────────────────────────────────────────────────────────────────

export function calcRSI(values: number[], period = 14): (number | null)[] {
  if (values.length < 2) return values.map(() => null);

  const result: (number | null)[] = [null]; // first element always null
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain   = Math.max(change, 0);
    const loss   = Math.max(-change, 0);

    if (i < period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      result.push(null);
      continue;
    }

    if (i === period) {
      avgGain += gain / period;
      avgLoss += loss / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    const rs  = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

// ── MACD ─────────────────────────────────────────────────────────────────────────

export function calcMACD(
  values: number[],
  fast   = 12,
  slow   = 26,
  signal = 9,
): MACDPoint[] {
  const fastEMA = calcEMA(values, fast);
  const slowEMA = calcEMA(values, slow);

  // MACD line = fastEMA - slowEMA
  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = fastEMA[i];
    const s = slowEMA[i];
    return f !== null && s !== null ? f - s : null;
  });

  // Signal = EMA(macdLine, signal) — only over non-null values
  const macdNonNull  = macdLine.filter(v => v !== null) as number[];
  const signalValues = calcEMA(macdNonNull, signal);

  // Align signal back to original indices
  const signalAligned: (number | null)[] = new Array(values.length).fill(null);
  let si = 0;
  for (let i = 0; i < values.length; i++) {
    if (macdLine[i] !== null) {
      signalAligned[i] = signalValues[si] ?? null;
      si++;
    }
  }

  return values.map((_, i) => ({
    macd:      macdLine[i],
    signal:    signalAligned[i],
    histogram: macdLine[i] !== null && signalAligned[i] !== null
               ? (macdLine[i] as number) - (signalAligned[i] as number)
               : null,
  }));
}

// ── VWAP ─────────────────────────────────────────────────────────────────────────

/**
 * Session-based VWAP.
 * Resets when the IST date changes (new trading session).
 * Returns null if no volume data.
 */
export function calcVWAP(candles: OHLCVInput[]): (number | null)[] {
  const result: (number | null)[] = [];
  let cumVolume = 0;
  let cumTPV    = 0;
  let lastDate  = "";

  for (const c of candles) {
    // IST date
    const ist  = new Date((c.time + 19800) * 1000);
    const date = ist.toISOString().slice(0, 10);

    if (date !== lastDate) {
      // New session
      cumVolume = 0;
      cumTPV    = 0;
      lastDate  = date;
    }

    const tp = (c.high + c.low + c.close) / 3;
    cumVolume += c.volume;
    cumTPV    += tp * c.volume;

    result.push(cumVolume > 0 ? cumTPV / cumVolume : null);
  }
  return result;
}
