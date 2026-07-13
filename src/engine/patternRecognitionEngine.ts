/**
 * patternRecognitionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Layer 18: Intraday Pattern Recognition Engine
 *
 * Detects 8 high-probability intraday patterns from:
 *  - OHLC candle data (from ProLiveChart dataFeed)
 *  - Live OI change data (from option chain)
 *  - Spot price relative to key levels
 *
 * Patterns:
 *  1. Opening Range Breakout (ORB)
 *  2. First Candle Reversal
 *  3. VWAP Reclaim / Loss
 *  4. OI Surge (> 2x average buildup)
 *  5. Double Top / Double Bottom
 *  6. Bull / Bear Flag (Continuation)
 *  7. Max Pain Gravity
 *  8. Gap Fill Setup
 *
 * Pure TypeScript — no React, no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OHLCCandle {
  time:  number;   // Unix timestamp (seconds)
  open:  number;
  high:  number;
  low:   number;
  close: number;
  volume?: number;
}

export type PatternName =
  | "ORB_BREAKOUT_UP"
  | "ORB_BREAKOUT_DOWN"
  | "FIRST_CANDLE_REVERSAL_UP"
  | "FIRST_CANDLE_REVERSAL_DOWN"
  | "VWAP_RECLAIM"
  | "VWAP_LOSS"
  | "OI_SURGE_CE"
  | "OI_SURGE_PE"
  | "DOUBLE_TOP"
  | "DOUBLE_BOTTOM"
  | "BULL_FLAG"
  | "BEAR_FLAG"
  | "MAX_PAIN_GRAVITY"
  | "GAP_FILL_UP"
  | "GAP_FILL_DOWN"
  | "NONE";

export type PatternSignal = "BUY_CE" | "BUY_PE" | "WAIT";
export type PatternStrength = "STRONG" | "MODERATE" | "WEAK";

export interface DetectedPattern {
  name:        PatternName;
  signal:      PatternSignal;
  strength:    PatternStrength;
  confidence:  number;           // 0–100
  description: string;
  keyLevel?:   number;           // e.g., ORB high/low, VWAP, max pain
}

export interface PatternRecognitionResult {
  /** Primary pattern (strongest) */
  primaryPattern:    DetectedPattern;

  /** All detected patterns ranked by confidence */
  allPatterns:       DetectedPattern[];

  /** Combined signal from pattern consensus */
  consensusSignal:   PatternSignal;

  /** Consensus confidence */
  consensusConfidence: number;

  /** Calculated VWAP */
  vwap:              number;

  /** Opening Range (first 15 min) */
  orbHigh:           number;
  orbLow:            number;
  orbEstablished:    boolean;

  /** Prev close (for gap detection) */
  prevClose:         number;

  /** Gap size in points */
  gapPoints:         number;

  /** Human-readable reasoning */
  reasoning:         string[];
}

export interface PatternRecognitionInput {
  /** OHLC candles (5-min or 1-min, newest last) */
  candles:      OHLCCandle[];

  /** Current spot price */
  spotPrice:    number;

  /** Previous day close */
  prevClose?:   number;

  /** Max pain strike from option chain */
  maxPain?:     number;

  /** Total CE OI change (last tick) */
  totalCeOIChange?: number;

  /** Total PE OI change (last tick) */
  totalPeOIChange?: number;

  /** Average OI change (baseline) */
  avgOIChange?: number;

  /** India VIX */
  indiaVix?:    number;

  /** Current time (epoch ms) — defaults to Date.now() */
  nowMs?:       number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Calculate VWAP from candles */
function calcVWAP(candles: OHLCCandle[]): number {
  if (candles.length === 0) return 0;
  let sumTPV = 0;
  let sumVol = 0;
  candles.forEach(c => {
    const tp  = (c.high + c.low + c.close) / 3;
    const vol = c.volume ?? 1;
    sumTPV += tp * vol;
    sumVol += vol;
  });
  return sumVol > 0 ? sumTPV / sumVol : 0;
}

/** Get first N minutes of candles from open (09:15 IST) */
function getOpeningCandles(candles: OHLCCandle[], minutes: number): OHLCCandle[] {
  const openHour  = 9;
  const openMin   = 15;
  const openSec   = (openHour * 60 + openMin) * 60; // seconds from midnight IST

  return candles.filter(c => {
    const istSec = ((c.time + 5.5 * 3600) % 86400);
    return istSec >= openSec && istSec < (openSec + minutes * 60);
  });
}

/** Get IST time in minutes from midnight */
function istMinutes(nowMs: number): number {
  const istDate = new Date(nowMs + 5.5 * 3600 * 1000);
  return istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
}

// ── Pattern Detectors ─────────────────────────────────────────────────────────

function detectORB(
  candles: OHLCCandle[],
  spotPrice: number,
  nowMs: number,
): { orbHigh: number; orbLow: number; established: boolean; pattern: DetectedPattern | null } {
  const openingCandles = getOpeningCandles(candles, 15); // first 15 min
  const minutesSinceOpen = istMinutes(nowMs) - (9 * 60 + 15);

  if (openingCandles.length === 0 || minutesSinceOpen < 15) {
    return { orbHigh: 0, orbLow: 0, established: false, pattern: null };
  }

  const orbHigh = Math.max(...openingCandles.map(c => c.high));
  const orbLow  = Math.min(...openingCandles.map(c => c.low));
  const orbRange = orbHigh - orbLow;

  if (orbRange <= 0) return { orbHigh, orbLow, established: true, pattern: null };

  const breakoutPct = (spotPrice - orbHigh) / orbRange;
  const breakdownPct = (orbLow - spotPrice) / orbRange;

  if (spotPrice > orbHigh + orbRange * 0.05) {
    // Breakout above ORB
    const conf = clamp(50 + breakoutPct * 50, 55, 90);
    return {
      orbHigh, orbLow, established: true,
      pattern: {
        name: "ORB_BREAKOUT_UP",
        signal: "BUY_CE",
        strength: conf >= 75 ? "STRONG" : "MODERATE",
        confidence: Math.round(conf),
        description: `ORB Breakout ↑ above ${orbHigh.toFixed(0)} — range ${orbRange.toFixed(0)} pts`,
        keyLevel: orbHigh,
      },
    };
  } else if (spotPrice < orbLow - orbRange * 0.05) {
    // Breakdown below ORB
    const conf = clamp(50 + breakdownPct * 50, 55, 90);
    return {
      orbHigh, orbLow, established: true,
      pattern: {
        name: "ORB_BREAKOUT_DOWN",
        signal: "BUY_PE",
        strength: conf >= 75 ? "STRONG" : "MODERATE",
        confidence: Math.round(conf),
        description: `ORB Breakdown ↓ below ${orbLow.toFixed(0)} — range ${orbRange.toFixed(0)} pts`,
        keyLevel: orbLow,
      },
    };
  }

  return { orbHigh, orbLow, established: true, pattern: null };
}

function detectVWAP(
  vwap: number,
  spotPrice: number,
  candles: OHLCCandle[],
): DetectedPattern | null {
  if (vwap === 0 || candles.length < 3) return null;
  const last3 = candles.slice(-3);
  const prevBelow = last3.slice(0, 2).every(c => c.close < vwap);
  const prevAbove = last3.slice(0, 2).every(c => c.close > vwap);
  const nowAbove  = spotPrice > vwap;
  const nowBelow  = spotPrice < vwap;

  if (prevBelow && nowAbove) {
    return {
      name: "VWAP_RECLAIM",
      signal: "BUY_CE",
      strength: "MODERATE",
      confidence: 62,
      description: `VWAP Reclaim — price crossed back above VWAP (${vwap.toFixed(0)})`,
      keyLevel: vwap,
    };
  }
  if (prevAbove && nowBelow) {
    return {
      name: "VWAP_LOSS",
      signal: "BUY_PE",
      strength: "MODERATE",
      confidence: 60,
      description: `VWAP Loss — price fell below VWAP (${vwap.toFixed(0)})`,
      keyLevel: vwap,
    };
  }
  return null;
}

function detectDoubleTopBottom(
  candles: OHLCCandle[],
  spotPrice: number,
): DetectedPattern | null {
  if (candles.length < 10) return null;
  const recent = candles.slice(-20);
  const highs  = recent.map(c => c.high);
  const lows   = recent.map(c => c.low);

  const maxH = Math.max(...highs);
  const secondMaxH = Math.max(...highs.filter(h => h < maxH * 0.998));
  const hDiff = Math.abs(maxH - secondMaxH) / maxH;

  if (hDiff < 0.003 && spotPrice < maxH * 0.997) {
    return {
      name: "DOUBLE_TOP",
      signal: "BUY_PE",
      strength: "STRONG",
      confidence: 70,
      description: `Double Top detected near ${maxH.toFixed(0)} — bearish reversal pattern`,
      keyLevel: maxH,
    };
  }

  const minL = Math.min(...lows);
  const secondMinL = Math.min(...lows.filter(l => l > minL * 1.002));
  const lDiff = Math.abs(minL - secondMinL) / minL;

  if (lDiff < 0.003 && spotPrice > minL * 1.003) {
    return {
      name: "DOUBLE_BOTTOM",
      signal: "BUY_CE",
      strength: "STRONG",
      confidence: 72,
      description: `Double Bottom detected near ${minL.toFixed(0)} — bullish reversal pattern`,
      keyLevel: minL,
    };
  }

  return null;
}

function detectFlag(
  candles: OHLCCandle[],
): DetectedPattern | null {
  if (candles.length < 12) return null;
  const impulse  = candles.slice(-12, -6);
  const flag     = candles.slice(-6);
  if (impulse.length < 4 || flag.length < 4) return null;

  const impMoveUp   = impulse[impulse.length - 1].close - impulse[0].close;
  const impMoveDown = impulse[0].close - impulse[impulse.length - 1].close;
  const flagMove    = flag[flag.length - 1].close - flag[0].close;

  if (impMoveUp > 40 && flagMove < 0 && Math.abs(flagMove) < impMoveUp * 0.4) {
    return {
      name: "BULL_FLAG",
      signal: "BUY_CE",
      strength: "MODERATE",
      confidence: 65,
      description: `Bull Flag — strong up impulse (+${impMoveUp.toFixed(0)} pts) followed by pullback`,
    };
  }
  if (impMoveDown > 40 && flagMove > 0 && Math.abs(flagMove) < impMoveDown * 0.4) {
    return {
      name: "BEAR_FLAG",
      signal: "BUY_PE",
      strength: "MODERATE",
      confidence: 63,
      description: `Bear Flag — sharp down impulse (-${impMoveDown.toFixed(0)} pts) followed by rebound`,
    };
  }
  return null;
}

function detectOISurge(
  totalCeOIChange: number,
  totalPeOIChange: number,
  avgOIChange: number,
): DetectedPattern | null {
  if (avgOIChange <= 0) return null;
  const ceRatio = Math.abs(totalCeOIChange) / avgOIChange;
  const peRatio = Math.abs(totalPeOIChange) / avgOIChange;
  const SURGE_THRESHOLD = 2.0;

  if (ceRatio > SURGE_THRESHOLD && totalCeOIChange < 0) {
    // CE OI unwinding strongly → bullish
    return {
      name: "OI_SURGE_CE",
      signal: "BUY_CE",
      strength: ceRatio > 3 ? "STRONG" : "MODERATE",
      confidence: clamp(55 + ceRatio * 8, 55, 85),
      description: `CE OI Surge — ${ceRatio.toFixed(1)}x average unwinding detected (bullish)`,
    };
  }
  if (peRatio > SURGE_THRESHOLD && totalPeOIChange < 0) {
    // PE OI unwinding strongly → bearish
    return {
      name: "OI_SURGE_PE",
      signal: "BUY_PE",
      strength: peRatio > 3 ? "STRONG" : "MODERATE",
      confidence: clamp(55 + peRatio * 8, 55, 85),
      description: `PE OI Surge — ${peRatio.toFixed(1)}x average unwinding detected (bearish)`,
    };
  }
  return null;
}

function detectMaxPainGravity(
  spotPrice: number,
  maxPain: number,
  nowMs: number,
): DetectedPattern | null {
  if (maxPain <= 0) return null;
  const minutesSinceOpen = istMinutes(nowMs) - (9 * 60 + 15);
  if (minutesSinceOpen < 120) return null; // Only active after 11:15 AM

  const diff    = spotPrice - maxPain;
  const diffPct = Math.abs(diff) / maxPain * 100;

  if (diffPct > 0.8) {
    const pullDir = diff > 0 ? "BUY_PE" : "BUY_CE";
    return {
      name: "MAX_PAIN_GRAVITY",
      signal: pullDir as PatternSignal,
      strength: diffPct > 1.5 ? "STRONG" : "WEAK",
      confidence: clamp(50 + diffPct * 8, 50, 75),
      description: `Max Pain Gravity — spot is ${diff > 0 ? "+" : ""}${diff.toFixed(0)} pts from max pain (${maxPain}) — expiry pull ${diff > 0 ? "bearish" : "bullish"}`,
      keyLevel: maxPain,
    };
  }
  return null;
}

function detectGapFill(
  spotPrice: number,
  prevClose: number,
  candles: OHLCCandle[],
): { pattern: DetectedPattern | null; gapPoints: number } {
  if (prevClose <= 0 || candles.length === 0) return { pattern: null, gapPoints: 0 };
  const firstCandle = candles[0];
  const gapPoints   = firstCandle.open - prevClose;

  if (Math.abs(gapPoints) < 20) return { pattern: null, gapPoints };

  const gapFilled = gapPoints > 0
    ? spotPrice <= prevClose + gapPoints * 0.2
    : spotPrice >= prevClose + gapPoints * 0.2;

  if (!gapFilled) {
    const signal: PatternSignal = gapPoints > 0 ? "BUY_PE" : "BUY_CE";
    return {
      gapPoints,
      pattern: {
        name: gapPoints > 0 ? "GAP_FILL_DOWN" : "GAP_FILL_UP",
        signal,
        strength: Math.abs(gapPoints) > 80 ? "STRONG" : "MODERATE",
        confidence: clamp(55 + Math.abs(gapPoints) * 0.2, 55, 78),
        description: `Gap Fill Setup — ${gapPoints > 0 ? "Gap Up" : "Gap Down"} of ${Math.abs(gapPoints).toFixed(0)} pts from prev close (${prevClose.toFixed(0)}) — unfilled`,
        keyLevel: prevClose,
      },
    };
  }
  return { pattern: null, gapPoints };
}

function detectFirstCandleReversal(
  candles: OHLCCandle[],
  spotPrice: number,
  nowMs: number,
): DetectedPattern | null {
  const minutesSinceOpen = istMinutes(nowMs) - (9 * 60 + 15);
  if (minutesSinceOpen < 15 || minutesSinceOpen > 30) return null;

  const firstCandle = candles[0];
  if (!firstCandle) return null;

  const body = Math.abs(firstCandle.close - firstCandle.open);
  const range = firstCandle.high - firstCandle.low;

  if (range < 15) return null; // Too small to matter

  // Big bearish first candle → reversal = BUY_CE
  if (firstCandle.close < firstCandle.open && body > range * 0.6 && spotPrice > firstCandle.low) {
    return {
      name: "FIRST_CANDLE_REVERSAL_UP",
      signal: "BUY_CE",
      strength: "MODERATE",
      confidence: 60,
      description: `First Candle Reversal ↑ — big bear candle (${body.toFixed(0)} pts) reversing at open`,
      keyLevel: firstCandle.low,
    };
  }
  // Big bullish first candle → reversal = BUY_PE
  if (firstCandle.close > firstCandle.open && body > range * 0.6 && spotPrice < firstCandle.high) {
    return {
      name: "FIRST_CANDLE_REVERSAL_DOWN",
      signal: "BUY_PE",
      strength: "MODERATE",
      confidence: 60,
      description: `First Candle Reversal ↓ — big bull candle (${body.toFixed(0)} pts) reversing at open`,
      keyLevel: firstCandle.high,
    };
  }
  return null;
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computePatternRecognition(
  input: PatternRecognitionInput,
): PatternRecognitionResult {
  const {
    candles,
    spotPrice,
    prevClose    = 0,
    maxPain      = 0,
    totalCeOIChange = 0,
    totalPeOIChange = 0,
    avgOIChange  = 0,
    nowMs        = Date.now(),
  } = input;

  const reasoning: string[] = [];
  const detected: DetectedPattern[] = [];

  // VWAP
  const vwap = calcVWAP(candles);

  // ORB
  const { orbHigh, orbLow, established: orbEstablished, pattern: orbPattern } = detectORB(candles, spotPrice, nowMs);
  if (orbPattern) { detected.push(orbPattern); reasoning.push(`✅ ${orbPattern.description}`); }

  // First Candle Reversal
  const fcrPattern = detectFirstCandleReversal(candles, spotPrice, nowMs);
  if (fcrPattern) { detected.push(fcrPattern); reasoning.push(`✅ ${fcrPattern.description}`); }

  // VWAP
  const vwapPattern = detectVWAP(vwap, spotPrice, candles);
  if (vwapPattern) { detected.push(vwapPattern); reasoning.push(`✅ ${vwapPattern.description}`); }

  // OI Surge
  const oiPattern = detectOISurge(totalCeOIChange, totalPeOIChange, avgOIChange);
  if (oiPattern) { detected.push(oiPattern); reasoning.push(`✅ ${oiPattern.description}`); }

  // Double Top/Bottom
  const dtdbPattern = detectDoubleTopBottom(candles, spotPrice);
  if (dtdbPattern) { detected.push(dtdbPattern); reasoning.push(`✅ ${dtdbPattern.description}`); }

  // Flag
  const flagPattern = detectFlag(candles);
  if (flagPattern) { detected.push(flagPattern); reasoning.push(`✅ ${flagPattern.description}`); }

  // Max Pain Gravity
  const mpPattern = detectMaxPainGravity(spotPrice, maxPain, nowMs);
  if (mpPattern) { detected.push(mpPattern); reasoning.push(`✅ ${mpPattern.description}`); }

  // Gap Fill
  const { pattern: gfPattern, gapPoints } = detectGapFill(spotPrice, prevClose, candles);
  if (gfPattern) { detected.push(gfPattern); reasoning.push(`✅ ${gfPattern.description}`); }

  // Sort by confidence
  const sorted = [...detected].sort((a, b) => b.confidence - a.confidence);

  const primaryPattern: DetectedPattern = sorted[0] ?? {
    name: "NONE",
    signal: "WAIT",
    strength: "WEAK",
    confidence: 0,
    description: "No significant intraday pattern detected",
  };

  // Consensus: count signals
  const ceCnt   = sorted.filter(p => p.signal === "BUY_CE").length;
  const peCnt   = sorted.filter(p => p.signal === "BUY_PE").length;
  const ceConf  = sorted.filter(p => p.signal === "BUY_CE").reduce((s, p) => s + p.confidence, 0);
  const peConf  = sorted.filter(p => p.signal === "BUY_PE").reduce((s, p) => s + p.confidence, 0);

  let consensusSignal: PatternSignal = "WAIT";
  let consensusConfidence = 0;
  if (ceCnt > 0 || peCnt > 0) {
    if (ceConf > peConf) {
      consensusSignal     = "BUY_CE";
      consensusConfidence = Math.round(ceConf / Math.max(ceCnt, 1));
    } else {
      consensusSignal     = "BUY_PE";
      consensusConfidence = Math.round(peConf / Math.max(peCnt, 1));
    }
  }

  if (sorted.length === 0) reasoning.push("⏳ No intraday patterns detected — awaiting setup");

  return {
    primaryPattern,
    allPatterns:          sorted,
    consensusSignal,
    consensusConfidence:  clamp(consensusConfidence, 0, 100),
    vwap,
    orbHigh,
    orbLow,
    orbEstablished,
    prevClose,
    gapPoints,
    reasoning,
  };
}
