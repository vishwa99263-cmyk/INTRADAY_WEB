/**
 * scoreCandleEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Score Candle Chart Engine v1.0
 *
 * Converts 5-minute score backup snapshots into OHLC candle structures
 * for institutional trading visualization.
 *
 * Input:  Score snapshots (09:00–15:30) from BackupSnapshots
 * Output: Candles with OHLC, volume strength, sentiment bias, signal markers
 *
 * Pure TypeScript — no React, no side effects.
 * Used by: Smart Money Engine overlay + Live Dashboard Score Candle Chart
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CandleSentiment = "BULLISH" | "BEARISH" | "NEUTRAL";
export type CandleSignal    =
  | "INSTITUTIONAL_ACCUMULATION"
  | "DISTRIBUTION"
  | "LIQUIDITY_SWEEP"
  | "NORMAL"
  | "DOJI";

export interface ScoreSnapshot {
  time: string;       // "HH:MM" format
  score: number;      // Raw composite score (can be any range)
  top25Score?: number;
  volumeScore?: number;
  pcr?: number;
}

export interface ScoreCandle {
  time:            string;
  open:            number;
  high:            number;
  low:             number;
  close:           number;
  body:            number;       // close - open
  upperWick:       number;       // high - max(open, close)
  lowerWick:       number;       // min(open, close) - low
  volumeStrength:  number;       // 0–100 normalised volume
  sentimentBias:   CandleSentiment;
  signal:          CandleSignal;
  signalLabel:     string;
  isGreen:         boolean;
  isRed:           boolean;
}

export interface ScoreCandleEngineOutput {
  candles:          ScoreCandle[];
  trendBias:        CandleSentiment | "SIDEWAYS";
  momentumStrength: number;      // 0–100
  trapZones:        string[];    // times with trap candles
  smartMarkers:     { time: string; type: "BUY" | "SELL" | "TRAP" }[];
  lastCandle?:      ScoreCandle;
  highestScore:     number;
  lowestScore:      number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safe(v: number | undefined | null, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/** Parse "HH:MM" to total minutes since midnight */
function timeToMinutes(t: string): number {
  const parts = t.split(":");
  return parseInt(parts[0] ?? "0") * 60 + parseInt(parts[1] ?? "0");
}

/** Sort snapshots by time ascending */
function sortByTime(snaps: ScoreSnapshot[]): ScoreSnapshot[] {
  return [...snaps].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

// ── Candle Signal Classifier ───────────────────────────────────────────────────

function classifyCandle(candle: Omit<ScoreCandle, "signal" | "signalLabel">): Pick<ScoreCandle, "signal" | "signalLabel"> {
  const { body, upperWick, lowerWick, volumeStrength } = candle;
  const absBody = Math.abs(body);
  const totalRange = Math.abs(candle.high - candle.low) || 1;

  // Doji: very small body
  if (absBody / totalRange < 0.1) {
    return { signal: "DOJI", signalLabel: "Doji — indecision zone" };
  }

  // Institutional Accumulation Candle: big green body + strong volume
  if (body > 15 && volumeStrength > 60) {
    return { signal: "INSTITUTIONAL_ACCUMULATION", signalLabel: "🟢 INSTITUTIONAL ACCUMULATION CANDLE" };
  }

  // Distribution Candle: big red body + strong volume
  if (body < -15 && volumeStrength > 60) {
    return { signal: "DISTRIBUTION", signalLabel: "🔴 DISTRIBUTION CANDLE" };
  }

  // Liquidity Sweep: high upper wick (>40% of range) + small body
  if (upperWick > totalRange * 0.4 && absBody < totalRange * 0.35) {
    return { signal: "LIQUIDITY_SWEEP", signalLabel: "🎯 LIQUIDITY SWEEP DETECTED" };
  }

  // Large lower wick sweep (bearish liquidity sweep flipped)
  if (lowerWick > totalRange * 0.4 && absBody < totalRange * 0.35) {
    return { signal: "LIQUIDITY_SWEEP", signalLabel: "🎯 LIQUIDITY SWEEP (Low) DETECTED" };
  }

  return { signal: "NORMAL", signalLabel: "" };
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeScoreCandles(
  snapshots: ScoreSnapshot[],
  bucketMinutes = 5,
): ScoreCandleEngineOutput {

  // Guard: no snapshots
  if (!snapshots || snapshots.length === 0) {
    return {
      candles: [],
      trendBias: "SIDEWAYS",
      momentumStrength: 0,
      trapZones: [],
      smartMarkers: [],
      highestScore: 0,
      lowestScore: 0,
    };
  }

  const sorted = sortByTime(snapshots);

  // Calculate volume normalisation range
  const volumes = sorted.map(s => safe(s.volumeScore, 50));
  const maxVol  = Math.max(...volumes, 1);
  const minVol  = Math.min(...volumes, 0);
  const volRange = maxVol - minVol || 1;

  const normaliseVolume = (v: number) =>
    clamp(Math.round(((v - minVol) / volRange) * 100));

  // Build candles: each candle = open (prev close) + close (current score)
  const candles: ScoreCandle[] = [];
  const trapZones: string[] = [];
  const smartMarkers: { time: string; type: "BUY" | "SELL" | "TRAP" }[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const prev = sorted[i - 1];

    const open  = safe(prev?.score, curr.score);
    const close = safe(curr.score);

    // High/low: use adjacent candle window if available
    const windowScores = [
      prev?.score,
      curr.score,
    ].filter((v): v is number => v !== undefined).map(safe);

    const high = Math.max(...windowScores, open, close);
    const low  = Math.min(...windowScores, open, close);

    const body       = close - open;
    const upperWick  = high - Math.max(open, close);
    const lowerWick  = Math.min(open, close) - low;
    const volStrength = normaliseVolume(safe(curr.volumeScore, 50));

    const sentimentBias: CandleSentiment =
      body > 0.5  ? "BULLISH" :
      body < -0.5 ? "BEARISH" : "NEUTRAL";

    const isGreen = body >= 0;
    const isRed   = body < 0;

    const candleBase = {
      time: curr.time, open, high, low, close,
      body, upperWick, lowerWick,
      volumeStrength: volStrength,
      sentimentBias, isGreen, isRed,
    };

    const { signal, signalLabel } = classifyCandle(candleBase);

    const candle: ScoreCandle = { ...candleBase, signal, signalLabel };
    candles.push(candle);

    // Track trap zones
    if (signal === "LIQUIDITY_SWEEP") {
      trapZones.push(curr.time);
      smartMarkers.push({ time: curr.time, type: "TRAP" });
    } else if (signal === "INSTITUTIONAL_ACCUMULATION") {
      smartMarkers.push({ time: curr.time, type: "BUY" });
    } else if (signal === "DISTRIBUTION") {
      smartMarkers.push({ time: curr.time, type: "SELL" });
    }
  }

  // ── Trend Bias: count last 10 candles ────────────────────────────────────
  const last10 = candles.slice(-10);
  const greenCount = last10.filter(c => c.isGreen).length;
  const redCount   = last10.filter(c => c.isRed).length;

  let trendBias: ScoreCandleEngineOutput["trendBias"];
  if      (greenCount >= 7) trendBias = "BULLISH";
  else if (redCount   >= 7) trendBias = "BEARISH";
  else if (greenCount >= 5) trendBias = "BULLISH";
  else if (redCount   >= 5) trendBias = "BEARISH";
  else                      trendBias = "SIDEWAYS";

  // ── Momentum Strength ────────────────────────────────────────────────────
  // Sum of body sizes over last 5 candles normalised
  const last5Bodies = candles.slice(-5).map(c => c.body);
  const netBodySum  = last5Bodies.reduce((a, b) => a + b, 0);
  const momentumStrength = clamp(Math.round(50 + netBodySum * 0.5));

  // ── Score range ───────────────────────────────────────────────────────────
  const allScores = sorted.map(s => s.score);
  const highestScore = Math.max(...allScores, 0);
  const lowestScore  = Math.min(...allScores, 0);

  return {
    candles,
    trendBias,
    momentumStrength,
    trapZones,
    smartMarkers,
    lastCandle: candles[candles.length - 1],
    highestScore,
    lowestScore,
  };
}

/** Convert BackupSnapshots (symbol → { time → score }) to ScoreSnapshot[] for a given symbol or aggregate */
export function backupToSnapshots(
  backup: Record<string, Record<string, number>>,
  mode: "aggregate" | "symbol",
  targetSymbol?: string,
): ScoreSnapshot[] {

  if (mode === "symbol" && targetSymbol) {
    const entry = backup[targetSymbol] ?? {};
    return Object.entries(entry).map(([time, score]) => ({ time, score: safe(score) }));
  }

  // Aggregate: sum all symbols per time slot
  const timeMap: Record<string, number> = {};
  for (const [, timeScores] of Object.entries(backup)) {
    for (const [time, score] of Object.entries(timeScores)) {
      timeMap[time] = (timeMap[time] ?? 0) + safe(score);
    }
  }
  return Object.entries(timeMap).map(([time, score]) => ({ time, score }));
}
