import { getISTTime } from "../utils/timerUtils.js";

export interface BreakoutState {
  high5m: number;
  low5m: number;
  high15m: number;
  low15m: number;
  rangeEstablished5m: boolean;
  rangeEstablished15m: boolean;
  breakoutType: "BULLISH_BREAKOUT" | "BEARISH_BREAKDOWN" | "FAKE_BREAKOUT" | "NONE";
  breakoutStatus: string;
  // Layer 4 additions
  trapProbability: number;  // 0-100, higher = more likely a trap
  trapType: "BULL_TRAP" | "BEAR_TRAP" | "FALSE_BREAKOUT" | "NONE";
  reasoning: string;

  // IQ200+: Extended signals for strategy activation
  persistentBreakout: boolean;       // Stays true for 20 min after confirmed breakout (for ORB strategies)
  persistentBreakdown: boolean;      // Stays true for 20 min after confirmed breakdown
  rollingHourHigh: number;           // Rolling 1-hour high (for S20 strategy)
  rollingHourLow: number;            // Rolling 1-hour low  (for S20 strategy)
  aboveRollingHourHigh: boolean;     // Price > rollingHourHigh
  belowRollingHourLow: boolean;      // Price < rollingHourLow
  momentumExhaustion: boolean;       // True when momentum reversal detected
  pcrExhaustion: boolean;            // True when PCR is extreme (< 0.7 or > 1.5)
  exhaustionDirection: "UP" | "DOWN" | "NONE"; // Direction of exhaustion bounce
  
  // ── Phase 5: Sniper Mode ──
  sniperOverride: boolean;           // True when breaking out of a tight volatility squeeze
  sniperDirection: "BUY_CE" | "BUY_PE" | "NONE"; // Direction of the sniper attack
}

const ranges: Record<string, BreakoutState> = {
  NIFTY: {
    high5m: 0, low5m: 0, high15m: 0, low15m: 0,
    rangeEstablished5m: false, rangeEstablished15m: false,
    breakoutType: "NONE", breakoutStatus: "Establishing range...",
    trapProbability: 0, trapType: "NONE", reasoning: "Awaiting range establishment.",
    persistentBreakout: false, persistentBreakdown: false,
    rollingHourHigh: 0, rollingHourLow: 0,
    aboveRollingHourHigh: false, belowRollingHourLow: false,
    momentumExhaustion: false, pcrExhaustion: false, exhaustionDirection: "NONE",
    sniperOverride: false, sniperDirection: "NONE",
  },
  SENSEX: {
    high5m: 0, low5m: 0, high15m: 0, low15m: 0,
    rangeEstablished5m: false, rangeEstablished15m: false,
    breakoutType: "NONE", breakoutStatus: "Establishing range...",
    trapProbability: 0, trapType: "NONE", reasoning: "Awaiting range establishment.",
    persistentBreakout: false, persistentBreakdown: false,
    rollingHourHigh: 0, rollingHourLow: 0,
    aboveRollingHourHigh: false, belowRollingHourLow: false,
    momentumExhaustion: false, pcrExhaustion: false, exhaustionDirection: "NONE",
    sniperOverride: false, sniperDirection: "NONE",
  },
  BANKNIFTY: {
    high5m: 0, low5m: 0, high15m: 0, low15m: 0,
    rangeEstablished5m: false, rangeEstablished15m: false,
    breakoutType: "NONE", breakoutStatus: "Establishing range...",
    trapProbability: 0, trapType: "NONE", reasoning: "Awaiting range establishment.",
    persistentBreakout: false, persistentBreakdown: false,
    rollingHourHigh: 0, rollingHourLow: 0,
    aboveRollingHourHigh: false, belowRollingHourLow: false,
    momentumExhaustion: false, pcrExhaustion: false, exhaustionDirection: "NONE",
    sniperOverride: false, sniperDirection: "NONE",
  },
};

// Track price history for re-entry trap detection
const crossedHighRecently: Record<string, boolean> = { NIFTY: false, SENSEX: false, BANKNIFTY: false };
const crossedLowRecently: Record<string, boolean>  = { NIFTY: false, SENSEX: false, BANKNIFTY: false };

// IQ200+: Persistent breakout timestamps (stays active for 20 mins)
const breakoutTimestamp: Record<string, number>  = { NIFTY: 0, SENSEX: 0, BANKNIFTY: 0 };
const breakdownTimestamp: Record<string, number> = { NIFTY: 0, SENSEX: 0, BANKNIFTY: 0 };

// IQ200+: Rolling 1-hour price window
const rollingHourWindow: Record<string, { price: number; timestamp: number }[]> = {
  NIFTY: [], SENSEX: [], BANKNIFTY: [],
};

// IQ200+: Momentum score history for exhaustion detection
const momentumScoreHistory: Record<string, number[]> = {
  NIFTY: [], SENSEX: [], BANKNIFTY: [],
};

export function getBreakoutState(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): BreakoutState {
  return ranges[page];
}

export function updateBreakoutEngine(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  spotPrice: number,
  hasVolumeSpike: boolean,
  isFastMarket: boolean,
  oiSentiment = "SIDEWAYS",
  priceActionGrade = "WEAK",
  // IQ200+: Additional inputs for extended strategy support
  currentMomentumScore = 50,
  currentPCR = 1.0,
): BreakoutState {
  const r = ranges[page];
  if (spotPrice <= 0) return r;

  const { h, m } = getISTTime();
  const timeSec = h * 3600 + m * 60;
  const now = Date.now();

  const openTime     = 9 * 3600 + 15 * 60; // 09:15
  const fiveMinEnd   = 9 * 3600 + 20 * 60; // 09:20
  const fifteenMinEnd= 9 * 3600 + 30 * 60; // 09:30

  // ── 1. Establish opening range ─────────────────────────────────────────────
  if (timeSec >= openTime && timeSec <= fiveMinEnd) {
    if (r.high5m === 0) { r.high5m = spotPrice; r.low5m = spotPrice; }
    else {
      if (spotPrice > r.high5m) r.high5m = spotPrice;
      if (spotPrice < r.low5m)  r.low5m  = spotPrice;
    }
  } else if (timeSec > fiveMinEnd && !r.rangeEstablished5m) {
    r.rangeEstablished5m = true;
  }

  if (timeSec >= openTime && timeSec <= fifteenMinEnd) {
    if (r.high15m === 0) { r.high15m = spotPrice; r.low15m = spotPrice; }
    else {
      if (spotPrice > r.high15m) r.high15m = spotPrice;
      if (spotPrice < r.low15m)  r.low15m  = spotPrice;
    }
  } else if (timeSec > fifteenMinEnd && !r.rangeEstablished15m) {
    r.rangeEstablished15m = true;
  }

  // ── 2. Midday fallback (server rebooted after open) ────────────────────────
  if (timeSec > fiveMinEnd && !r.rangeEstablished5m && r.high5m === 0) {
    r.high5m = parseFloat((spotPrice * 1.0015).toFixed(2));
    r.low5m  = parseFloat((spotPrice * 0.9985).toFixed(2));
    r.rangeEstablished5m = true;
  }
  if (timeSec > fifteenMinEnd && !r.rangeEstablished15m && r.high15m === 0) {
    r.high15m = parseFloat((spotPrice * 1.0025).toFixed(2));
    r.low15m  = parseFloat((spotPrice * 0.9975).toFixed(2));
    r.rangeEstablished15m = true;
  }

  // ── IQ200+: Rolling 1-Hour Range Tracking (for S20 strategy) ──────────────
  const hourAgo = now - 60 * 60 * 1000;
  rollingHourWindow[page].push({ price: spotPrice, timestamp: now });
  rollingHourWindow[page] = rollingHourWindow[page].filter(p => p.timestamp >= hourAgo);
  
  if (rollingHourWindow[page].length > 0) {
    const prices = rollingHourWindow[page].map(p => p.price);
    r.rollingHourHigh = Math.max(...prices);
    r.rollingHourLow  = Math.min(...prices);
    r.aboveRollingHourHigh = spotPrice > r.rollingHourHigh * 1.0005; // 0.05% above
    r.belowRollingHourLow  = spotPrice < r.rollingHourLow * 0.9995;  // 0.05% below
    
    // ── Phase 5: SNIPER MODE (Volatility Squeeze Detection) ──
    // If the 1-hour range is extremely tight (< 0.2% of spot), it's a Squeeze
    const rangePct = ((r.rollingHourHigh - r.rollingHourLow) / spotPrice) * 100;
    const isSqueeze = rangePct < 0.20; 

    // Reset sniper
    r.sniperOverride = false;
    r.sniperDirection = "NONE";

    // If we were in a squeeze, and suddenly price shoots out with FAST_MARKET
    if (isSqueeze && isFastMarket) {
      if (spotPrice > r.rollingHourHigh) {
        r.sniperOverride = true;
        r.sniperDirection = "BUY_CE";
        r.reasoning = `⚡ SNIPER OVERRIDE: High Velocity Breakout from tight Squeeze (${rangePct.toFixed(2)}%)`;
      } else if (spotPrice < r.rollingHourLow) {
        r.sniperOverride = true;
        r.sniperDirection = "BUY_PE";
        r.reasoning = `⚡ SNIPER OVERRIDE: High Velocity Breakdown from tight Squeeze (${rangePct.toFixed(2)}%)`;
      }
    }
  }

  // ── IQ200+: Momentum Exhaustion Detection ─────────────────────────────────
  // Records momentum score history and detects reversal from extreme
  momentumScoreHistory[page].push(currentMomentumScore);
  if (momentumScoreHistory[page].length > 10) {
    momentumScoreHistory[page] = momentumScoreHistory[page].slice(-10);
  }

  const scoreHist = momentumScoreHistory[page];
  let momentumExhaustion = false;
  let exhaustionDirection: BreakoutState["exhaustionDirection"] = "NONE";

  if (scoreHist.length >= 4) {
    const prevAvg = (scoreHist[scoreHist.length - 4] + scoreHist[scoreHist.length - 3]) / 2;
    const currAvg = (scoreHist[scoreHist.length - 2] + scoreHist[scoreHist.length - 1]) / 2;
    
    // Reversal from extreme high → possible bearish exhaustion
    if (prevAvg >= 68 && currAvg < prevAvg - 7) {
      momentumExhaustion = true;
      exhaustionDirection = "DOWN";
    }
    // Reversal from extreme low → possible bullish exhaustion (bounce)
    if (prevAvg <= 32 && currAvg > prevAvg + 7) {
      momentumExhaustion = true;
      exhaustionDirection = "UP";
    }
  }

  // IQ200+: PCR Exhaustion (for PCR_EXTREME_PLAY and OI_WALL_SCALP strategies)
  const pcrExhaustion = currentPCR < 0.72 || currentPCR > 1.48;
  if (pcrExhaustion && !momentumExhaustion) {
    // PCR alone can trigger exhaustion signal
    momentumExhaustion = true;
    exhaustionDirection = currentPCR < 0.72 ? "UP" : "DOWN"; // contrarian direction
  }

  r.momentumExhaustion = momentumExhaustion;
  r.pcrExhaustion = pcrExhaustion;
  r.exhaustionDirection = exhaustionDirection;

  // ── 3. Breakout detection ─────────────────────────────────────────────────
  if (!r.rangeEstablished5m) {
    r.breakoutType   = "NONE";
    r.breakoutStatus = "Establishing opening range (9:15 - 9:20)...";
    r.trapProbability = 0;
    r.trapType = "NONE";
    r.reasoning = "Range not yet established. No breakout signals issued.";
    r.persistentBreakout = false;
    r.persistentBreakdown = false;
    return r;
  }

  const targetHigh = r.high15m || r.high5m;
  const targetLow  = r.low15m  || r.low5m;

  // ── Helper: compute trap probability ─────────────────────────────────────
  const computeTrapProbability = (direction: "UP" | "DOWN"): number => {
    let prob = 0;
    if (!hasVolumeSpike) prob += 35;
    if (!isFastMarket)  prob += 25;
    if (timeSec < fiveMinEnd + 120) prob += 20;
    if (direction === "UP"   && oiSentiment.includes("BEARISH")) prob += 15;
    if (direction === "DOWN" && oiSentiment.includes("BULLISH")) prob += 15;
    if (priceActionGrade === "WEAK") prob += 10;
    return Math.min(100, prob);
  };

  // ── 4. Bullish Breakout ───────────────────────────────────────────────────
  if (spotPrice > targetHigh) {
    crossedHighRecently[page] = true;
    const trapProb = computeTrapProbability("UP");

    if (trapProb >= 60) {
      r.breakoutType   = "FAKE_BREAKOUT";
      r.trapType       = "BULL_TRAP";
      r.trapProbability = trapProb;
      r.breakoutStatus = `BULL TRAP WARNING: Price broke ${targetHigh} but volume/speed absent.`;
      r.reasoning = `Trap probability ${trapProb}%: Low volume=${!hasVolumeSpike}, Low speed=${!isFastMarket}`;
    } else {
      r.breakoutType   = "BULLISH_BREAKOUT";
      r.trapType       = "NONE";
      r.trapProbability = trapProb;
      r.breakoutStatus = `BULLISH BREAKOUT: Price broke ${targetHigh} with volume & speed!`;
      r.reasoning = `Confirmed breakout. Trap probability low (${trapProb}%).`;
      // IQ200+: Set persistent breakout (stays active for 20 min)
      breakoutTimestamp[page] = now;
    }
  }
  // ── 5. Bearish Breakdown ──────────────────────────────────────────────────
  else if (spotPrice < targetLow) {
    crossedLowRecently[page] = true;
    const trapProb = computeTrapProbability("DOWN");

    if (trapProb >= 60) {
      r.breakoutType   = "FAKE_BREAKOUT";
      r.trapType       = "BEAR_TRAP";
      r.trapProbability = trapProb;
      r.breakoutStatus = `BEAR TRAP WARNING: Price broke ${targetLow} but volume/speed absent.`;
      r.reasoning = `Trap probability ${trapProb}%: Low volume=${!hasVolumeSpike}, Low speed=${!isFastMarket}`;
    } else {
      r.breakoutType   = "BEARISH_BREAKDOWN";
      r.trapType       = "NONE";
      r.trapProbability = trapProb;
      r.breakoutStatus = `BEARISH BREAKDOWN: Price broke ${targetLow} with heavy selling!`;
      r.reasoning = `Confirmed breakdown. Trap probability low (${trapProb}%).`;
      // IQ200+: Set persistent breakdown (stays active for 20 min)
      breakdownTimestamp[page] = now;
    }
  }
  // ── 6. Re-entry trap detection ────────────────────────────────────────────
  else {
    if (crossedHighRecently[page] && spotPrice < targetHigh - 5) {
      r.breakoutType   = "FAKE_BREAKOUT";
      r.trapType       = "FALSE_BREAKOUT";
      r.trapProbability = 80;
      r.breakoutStatus = `FALSE BREAKOUT: Price re-entered range after breaking ${targetHigh}.`;
      r.reasoning = `Price failed to hold above ${targetHigh}. Classic retail trap.`;
      crossedHighRecently[page] = false;
    } else if (crossedLowRecently[page] && spotPrice > targetLow + 5) {
      r.breakoutType   = "FAKE_BREAKOUT";
      r.trapType       = "FALSE_BREAKOUT";
      r.trapProbability = 80;
      r.breakoutStatus = `FALSE BREAKDOWN: Price re-entered range after breaking ${targetLow}.`;
      r.reasoning = `Price failed to hold below ${targetLow}. Classic bear trap.`;
      crossedLowRecently[page] = false;
    } else {
      r.breakoutType   = "NONE";
      r.trapType       = "NONE";
      r.trapProbability = 0;
      r.breakoutStatus = "Price trading inside opening range.";
      r.reasoning      = "No breakout detected. Range-bound price action.";
    }
  }

  // ── IQ200+: Persistent Breakout Signal (20-min window) ──────────────────
  // Strategies like ORB_NAKED only need to fire ONCE when breakout occurs.
  // But some strategies need the signal to remain active for a period.
  const PERSISTENT_DURATION = 20 * 60 * 1000; // 20 minutes in ms
  r.persistentBreakout  = (now - breakoutTimestamp[page])  < PERSISTENT_DURATION;
  r.persistentBreakdown = (now - breakdownTimestamp[page]) < PERSISTENT_DURATION;

  return r;
}
// IQ200+ v2.0: Extended breakout engine with exhaustion detection, rolling hour range,
// persistent breakout signals, PCR exhaustion, and momentum reversal tracking.
