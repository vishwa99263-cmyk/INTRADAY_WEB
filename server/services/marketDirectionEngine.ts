/**
 * marketDirectionEngine.ts — Multi-Signal Market Direction Estimator
 *
 * Uses existing live score data (T25 Net, velocity across timeframes, breadth,
 * and Sentiment Shift Detection from backup snapshots) to classify the current
 * market direction as BULLISH, BEARISH, or NEUTRAL.
 *
 * Output is used as a protective gate in autoTradingService to block
 * trades that go against the dominant market direction.
 *
 * ──────────────────────────────────────────────────────────────────
 * Weighted Score Formula (range -1.0 to +1.0):
 *   T25 Net Overall:           25%
 *   5M Score Velocity:         15%
 *   15M Score Velocity:        15%
 *   Breadth Ratio:             15%
 *   DH/DL Proximity:           10%
 *   Sentiment Shift (backup):  20%   ← NEW: tracks pos→neg or neg→pos transitions
 * ──────────────────────────────────────────────────────────────────
 */

import { marketState } from "../state/marketState.js";

export type MarketDirectionStatus =
  | "BULLISH"
  | "MILD_BULLISH"
  | "NEUTRAL"
  | "MILD_BEARISH"
  | "BEARISH";

export interface SentimentShift {
  symbol: string;
  weightage: number;
  previousScore: number;
  currentScore: number;
  shift: "POS_TO_NEG" | "NEG_TO_POS" | "STABLE";
  magnitude: number; // how much it shifted
}

export interface StockContribution {
  symbol: string;
  weightage: number;       // stock's index weight (%)
  pctChange: number;       // stock's actual % price change
  score: number;           // current sentiment score
  wtdContrib: number;      // (weightage/100) × pctChange = index point contribution
  direction: "UP" | "DOWN" | "FLAT";
  ltp?: number;            // last traded price
}

export interface StockLayerAnalysis {
  netScore: number;          // raw sum of scores in this layer
  net5m: number;             // 5M velocity in this layer
  net15m: number;            // 15M velocity in this layer
  posCount: number;          // positive stocks in layer
  negCount: number;          // negative stocks in layer
  dominance: "BULLISH" | "BEARISH" | "NEUTRAL";
  posToNegCount: number;     // flipped POS→NEG in this layer
  negToPosCount: number;     // flipped NEG→POS in this layer
  // Weighted contribution (weightage × score)
  posWeightPts: number;      // total positive weighted contribution
  negWeightPts: number;      // total negative weighted contribution
  netWeightPts: number;      // net weighted contribution (pos + neg)
  topContributors: StockContribution[];  // sorted by abs(wtdContrib) desc
}

export interface MarketDirectionResult {
  status: MarketDirectionStatus;
  score: number;            // -1.0 to +1.0
  confidence: number;       // 0 to 100
  allowCE: boolean;
  allowPE: boolean;
  blockReason: string;
  sentimentShifts: SentimentShift[];  // stocks that flipped sentiment
  netShiftScore: number;              // weighted sum of shift impact
  t10Layer: StockLayerAnalysis;       // Top 10 heavyweight analysis
  n15Layer: StockLayerAnalysis;       // Next 15 mid-tier analysis
  signals: {
    netOverall: number;
    net5m: number;
    net15m: number;
    posBreath: number;
    negBreath: number;
    dhProximityPct: number;
    dlProximityPct: number;
    posToNegCount: number;  // stocks that went positive → negative
    negToPosCount: number;  // stocks that went negative → positive
  };
}


/**
 * Analyzes niftyBackup/sensexBackup snapshots to detect sentiment shifts.
 * Compares the score 2 snapshots ago vs the latest snapshot per stock.
 * Returns a list of stocks that have flipped sentiment and the net shift score.
 */
function detectSentimentShifts(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  topStocks: Array<{ symbol: string; weightage: number; score: number }>
): { shifts: SentimentShift[]; netShiftScore: number; posToNegCount: number; negToPosCount: number } {
  const backup = page === "NIFTY"
    ? marketState.niftyBackup
    : page === "BANKNIFTY"
    ? marketState.bankniftyBackup
    : marketState.sensexBackup;

  const shifts: SentimentShift[] = [];
  let netShiftScore = 0;
  let posToNegCount = 0;
  let negToPosCount = 0;

  for (const st of topStocks) {
    const snaps = backup[st.symbol];
    if (!snaps) continue;

    const times = Object.keys(snaps).sort();
    if (times.length < 2) continue;

    // Use score from ~2 snapshots ago vs latest to detect meaningful shifts
    const lookbackIdx = Math.max(0, times.length - 4); // ~10 minutes back (5m × 2)
    const prevTime = times[lookbackIdx];
    const latestTime = times[times.length - 1];

    const prevScore = snaps[prevTime] ?? 0;
    const latestScore = snaps[latestTime] ?? 0;
    const magnitude = Math.abs(latestScore - prevScore);

    // Only flag if there was a meaningful sign change (not just noise)
    const isSignificantShift = magnitude > 0.05;
    const wasPositive = prevScore > 0;
    const isNowNegative = latestScore < 0;
    const wasNegative = prevScore < 0;
    const isNowPositive = latestScore > 0;

    let shift: SentimentShift["shift"] = "STABLE";

    if (wasPositive && isNowNegative && isSignificantShift) {
      shift = "POS_TO_NEG";
      posToNegCount++;
      // Bearish signal: weighted negative contribution
      netShiftScore -= st.weightage * magnitude * 0.1;
    } else if (wasNegative && isNowPositive && isSignificantShift) {
      shift = "NEG_TO_POS";
      negToPosCount++;
      // Bullish signal: weighted positive contribution
      netShiftScore += st.weightage * magnitude * 0.1;
    }

    if (shift !== "STABLE") {
      shifts.push({
        symbol: st.symbol,
        weightage: st.weightage,
        previousScore: parseFloat(prevScore.toFixed(3)),
        currentScore: parseFloat(latestScore.toFixed(3)),
        shift,
        magnitude: parseFloat(magnitude.toFixed(3))
      });
    }
  }

  // Log significant shifts for debugging
  if (shifts.length > 0) {
    const posNeg = shifts.filter(s => s.shift === "POS_TO_NEG").map(s => s.symbol).join(", ");
    const negPos = shifts.filter(s => s.shift === "NEG_TO_POS").map(s => s.symbol).join(", ");
    if (posNeg) console.log(`[MarketDir] [${page}] ⚠️  POS→NEG: ${posNeg}`);
    if (negPos) console.log(`[MarketDir] [${page}] ✅ NEG→POS: ${negPos}`);
  }

  return {
    shifts,
    netShiftScore: parseFloat(netShiftScore.toFixed(3)),
    posToNegCount,
    negToPosCount
  };
}

/**
 * Classifies market direction based on multi-signal weighted scoring.
 * @param page "NIFTY" | "SENSEX" | "BANKNIFTY"
 */
export function estimateMarketDirection(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): MarketDirectionResult {
  const stocks = page === "NIFTY"
    ? Object.values(marketState.niftyStocks)
    : page === "BANKNIFTY"
    ? Object.values(marketState.bankniftyStocks)
    : Object.values(marketState.sensexStocks);

  const isSensex = page === "SENSEX";
  const isBanknifty = page === "BANKNIFTY";
  const sliceEnd = isSensex ? 22 : (isBanknifty ? 12 : 25);

  // ── Sort by weightage and pick top constituents ──────────────────────────
  const topStocksRaw = [...stocks]
    .sort((a, b) => b.weightage - a.weightage)
    .slice(0, sliceEnd);

  if (topStocksRaw.length === 0) {
    return neutralResult("No stock data available");
  }

  const topStocks = topStocksRaw.map(s => ({
    symbol: s.symbol,
    weightage: s.weightage,
    score: s.score ?? 0
  }));

  // ── Signal 1: T25 Net Overall Score ─────────────────────────────────────
  let netOverall = 0;
  let net5m = 0;
  let net15m = 0;

  for (const st of topStocksRaw) {
    netOverall += st.score ?? 0;
    net5m      += st.scoreDifference ?? 0;
    net15m     += st.score15mDiff ?? 0;
  }

  // ── Signal 2: Market Breadth (ALL stocks) ───────────────────────────────
  const allStocks = stocks.filter(s => s.symbol !== "NIFTY 50" && s.symbol !== "SENSEX");
  let posCount = 0, negCount = 0;
  for (const st of allStocks) {
    if ((st.score ?? 0) > 0) posCount++;
    else if ((st.score ?? 0) < 0) negCount++;
  }
  const totalBreadth = posCount + negCount;
  const posBreath = totalBreadth > 0 ? (posCount / totalBreadth) * 100 : 50;
  const negBreath = 100 - posBreath;

  // ── Signal 3: DH/DL Proximity from niftyBackup ──────────────────────────
  const backup = page === "NIFTY" ? marketState.niftyBackup : marketState.sensexBackup;
  let sessionDH = netOverall;
  let sessionDL = netOverall;

  try {
    // Get all unique time keys across all stocks
    const allTimes = new Set<string>();
    for (const st of topStocksRaw) {
      const snaps = backup[st.symbol];
      if (snaps) Object.keys(snaps).forEach(t => allTimes.add(t));
    }
    const sortedTimes = Array.from(allTimes).sort();

    for (const tk of sortedTimes) {
      let snapNet = 0;
      for (const st of topStocksRaw) {
        snapNet += backup[st.symbol]?.[tk] ?? 0;
      }
      if (snapNet > sessionDH) sessionDH = snapNet;
      if (snapNet < sessionDL) sessionDL = snapNet;
    }
  } catch (_) {}

  const sessionRange = Math.abs(sessionDH - sessionDL);
  const dhProximityPct = sessionRange > 0
    ? Math.max(0, Math.min(100, ((netOverall - sessionDL) / sessionRange) * 100))
    : 50;
  const dlProximityPct = 100 - dhProximityPct;

  // ── Signal 4: Sentiment Shift Detection from backup ─────────────────────
  const { shifts, netShiftScore, posToNegCount, negToPosCount } =
    detectSentimentShifts(page, topStocks);

  // ── T10 Layer: Top 10 Heavyweight Stocks ────────────────────────────────
  const top10Raw = topStocksRaw.slice(0, 10);
  const top10Stocks = topStocks.slice(0, 10);
  let t10Net = 0, t10Net5m = 0, t10Net15m = 0, t10Pos = 0, t10Neg = 0;
  let t10PosWt = 0, t10NegWt = 0;
  const t10Contribs: StockContribution[] = [];

  for (const st of top10Raw) {
    const sc = st.score ?? 0;
    const pct = st.changePercent ?? 0;
    // Real index contribution: (weight% / 100) × price change%
    const wtdContrib = parseFloat(((st.weightage / 100) * pct).toFixed(4));
    t10Net    += sc;
    t10Net5m  += st.scoreDifference ?? 0;
    t10Net15m += st.score15mDiff ?? 0;
    if (sc > 0) { t10Pos++; t10PosWt += wtdContrib; }
    else if (sc < 0) { t10Neg++; t10NegWt += wtdContrib; }
    t10Contribs.push({
      symbol:    st.symbol,
      weightage: st.weightage,
      pctChange: parseFloat(pct.toFixed(3)),
      score:     parseFloat(sc.toFixed(3)),
      wtdContrib,
      direction: pct > 0 ? "UP" : pct < 0 ? "DOWN" : "FLAT",
      ltp:       st.ltp
    });
  }
  // Sort by absolute weighted contribution (biggest impact first)
  t10Contribs.sort((a, b) => Math.abs(b.wtdContrib) - Math.abs(a.wtdContrib));

  const t10Shifts = detectSentimentShifts(page, top10Stocks);
  const t10Layer: StockLayerAnalysis = {
    netScore:    parseFloat(t10Net.toFixed(2)),
    net5m:       parseFloat(t10Net5m.toFixed(2)),
    net15m:      parseFloat(t10Net15m.toFixed(2)),
    posCount:    t10Pos,
    negCount:    t10Neg,
    dominance:   t10Pos > t10Neg ? "BULLISH" : t10Neg > t10Pos ? "BEARISH" : "NEUTRAL",
    posToNegCount: t10Shifts.posToNegCount,
    negToPosCount: t10Shifts.negToPosCount,
    posWeightPts: parseFloat(t10PosWt.toFixed(3)),
    negWeightPts: parseFloat(t10NegWt.toFixed(3)),
    netWeightPts: parseFloat((t10PosWt + t10NegWt).toFixed(3)),
    topContributors: t10Contribs.slice(0, 5), // top 5 by impact
  };
  if (t10Shifts.posToNegCount > 0 || t10Shifts.negToPosCount > 0) {
    console.log(`[MarketDir] [${page}] T10: +${t10Shifts.negToPosCount}↑ -${t10Shifts.posToNegCount}↓ | WtdNet: ${t10Layer.netWeightPts}`);
  }

  // ── N15 Layer: Next 15 Mid-Tier Stocks ──────────────────────────────────
  const n15Raw = topStocksRaw.slice(10, 25);
  const n15Stocks = topStocks.slice(10, 25);
  let n15Net = 0, n15Net5m = 0, n15Net15m = 0, n15Pos = 0, n15Neg = 0;
  let n15PosWt = 0, n15NegWt = 0;
  const n15Contribs: StockContribution[] = [];

  for (const st of n15Raw) {
    const sc = st.score ?? 0;
    const pct = st.changePercent ?? 0;
    const wtdContrib = parseFloat(((st.weightage / 100) * pct).toFixed(4));
    n15Net    += sc;
    n15Net5m  += st.scoreDifference ?? 0;
    n15Net15m += st.score15mDiff ?? 0;
    if (sc > 0) { n15Pos++; n15PosWt += wtdContrib; }
    else if (sc < 0) { n15Neg++; n15NegWt += wtdContrib; }
    n15Contribs.push({
      symbol:    st.symbol,
      weightage: st.weightage,
      pctChange: parseFloat(pct.toFixed(3)),
      score:     parseFloat(sc.toFixed(3)),
      wtdContrib,
      direction: pct > 0 ? "UP" : pct < 0 ? "DOWN" : "FLAT",
      ltp:       st.ltp
    });
  }
  n15Contribs.sort((a, b) => Math.abs(b.wtdContrib) - Math.abs(a.wtdContrib));

  const n15Shifts = detectSentimentShifts(page, n15Stocks);
  const n15Layer: StockLayerAnalysis = {
    netScore:    parseFloat(n15Net.toFixed(2)),
    net5m:       parseFloat(n15Net5m.toFixed(2)),
    net15m:      parseFloat(n15Net15m.toFixed(2)),
    posCount:    n15Pos,
    negCount:    n15Neg,
    dominance:   n15Pos > n15Neg ? "BULLISH" : n15Neg > n15Pos ? "BEARISH" : "NEUTRAL",
    posToNegCount: n15Shifts.posToNegCount,
    negToPosCount: n15Shifts.negToPosCount,
    posWeightPts: parseFloat(n15PosWt.toFixed(3)),
    negWeightPts: parseFloat(n15NegWt.toFixed(3)),
    netWeightPts: parseFloat((n15PosWt + n15NegWt).toFixed(3)),
    topContributors: n15Contribs.slice(0, 5),
  };
  if (n15Shifts.posToNegCount > 0 || n15Shifts.negToPosCount > 0) {
    console.log(`[MarketDir] [${page}] N15: +${n15Shifts.negToPosCount}↑ -${n15Shifts.posToNegCount}↓ | WtdNet: ${n15Layer.netWeightPts}`);
  }

  // ── Weighted Direction Score ─────────────────────────────────────────────
  const MAX_NET  = isSensex ? 80 : 60;
  const MAX_DIFF = isSensex ? 30 : 20;
  const MAX_SHIFT = isSensex ? 15 : 10; // max expected netShiftScore magnitude

  const s1 = Math.max(-1, Math.min(1, netOverall / MAX_NET));       // Overall:  25%
  const s2 = Math.max(-1, Math.min(1, net5m / MAX_DIFF));           // 5M:       15%
  const s3 = Math.max(-1, Math.min(1, net15m / MAX_DIFF));          // 15M:      15%
  const s4 = posBreath > 50
    ? (posBreath - 50) / 50
    : -(50 - posBreath) / 50;                                        // Breadth:  15%
  const s5 = (dhProximityPct - 50) / 50;                            // DH/DL:    10%
  const s6 = Math.max(-1, Math.min(1, netShiftScore / MAX_SHIFT));  // Shift:    20%

  const directionScore = parseFloat((
    s1 * 0.25 +
    s2 * 0.15 +
    s3 * 0.15 +
    s4 * 0.15 +
    s5 * 0.10 +
    s6 * 0.20
  ).toFixed(3));

  // ── Classify ─────────────────────────────────────────────────────────────
  let status: MarketDirectionStatus;
  if (directionScore > 0.4)       status = "BULLISH";
  else if (directionScore > 0.1)  status = "MILD_BULLISH";
  else if (directionScore > -0.1) status = "NEUTRAL";
  else if (directionScore > -0.4) status = "MILD_BEARISH";
  else                             status = "BEARISH";

  // ── Gate Logic ───────────────────────────────────────────────────────────
  const allowCE = status === "BULLISH" || status === "MILD_BULLISH";
  const allowPE = status === "BEARISH" || status === "MILD_BEARISH";
  const confidence = Math.round(Math.min(100, Math.abs(directionScore) * 100));

  let blockReason = "";
  const shiftSummary = posToNegCount > 0
    ? ` | ⚠️ ${posToNegCount} stock(s) flipped POS→NEG`
    : negToPosCount > 0
    ? ` | ✅ ${negToPosCount} stock(s) flipped NEG→POS`
    : "";

  if (!allowCE && !allowPE) {
    blockReason = `Market NEUTRAL (Score: ${directionScore.toFixed(2)})${shiftSummary} — No new trades`;
  } else if (!allowCE) {
    blockReason = `Market BEARISH (Score: ${directionScore.toFixed(2)})${shiftSummary} — CE blocked`;
  } else if (!allowPE) {
    blockReason = `Market BULLISH (Score: ${directionScore.toFixed(2)})${shiftSummary} — PE blocked`;
  }

  return {
    status,
    score: directionScore,
    confidence,
    allowCE,
    allowPE,
    blockReason,
    sentimentShifts: shifts,
    netShiftScore,
    t10Layer,
    n15Layer,
    signals: {
      netOverall: parseFloat(netOverall.toFixed(2)),
      net5m:      parseFloat(net5m.toFixed(2)),
      net15m:     parseFloat(net15m.toFixed(2)),
      posBreath:  parseFloat(posBreath.toFixed(1)),
      negBreath:  parseFloat(negBreath.toFixed(1)),
      dhProximityPct: parseFloat(dhProximityPct.toFixed(1)),
      dlProximityPct: parseFloat(dlProximityPct.toFixed(1)),
      posToNegCount,
      negToPosCount
    }
  };
}

function neutralResult(reason: string): MarketDirectionResult {
  const emptyLayer = {
    netScore: 0,
    net5m: 0,
    net15m: 0,
    posCount: 0,
    negCount: 0,
    dominance: "NEUTRAL" as const,
    posToNegCount: 0,
    negToPosCount: 0,
    posWeightPts: 0,
    negWeightPts: 0,
    netWeightPts: 0,
    topContributors: [],
  };
  return {
    status: "NEUTRAL",
    score: 0,
    confidence: 0,
    allowCE: false,
    allowPE: false,
    blockReason: reason,
    sentimentShifts: [],
    netShiftScore: 0,
    t10Layer: emptyLayer,
    n15Layer: emptyLayer,
    signals: {
      netOverall: 0, net5m: 0, net15m: 0,
      posBreath: 50, negBreath: 50,
      dhProximityPct: 50, dlProximityPct: 50,
      posToNegCount: 0, negToPosCount: 0
    }
  };
}
