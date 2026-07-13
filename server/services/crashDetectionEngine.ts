import { marketState } from "../state/marketState.js";
import { getISTTime } from "../utils/timerUtils.js";
import { getLatestNewsCrashState } from "./newsEngine.js";

interface PriceTick {
  price: number;
  timestamp: number;
}

const priceHistory: Record<string, PriceTick[]> = {
  NIFTY: [],
  BANKNIFTY: [],
  SENSEX: []
};

let lastVix = 15;
const vixHistory: PriceTick[] = [];

export interface CrashState {
  isMacroCrash: boolean;
  reason: string;
}

export function updateCrashEngine(page: "NIFTY" | "BANKNIFTY" | "SENSEX", spotPrice: number, currentVix: number): CrashState {
  const now = Date.now();
  
  if (currentVix > 0) {
    vixHistory.push({ price: currentVix, timestamp: now });
    lastVix = currentVix;
  }
  
  // Keep VIX history for 30 minutes
  while (vixHistory.length > 0 && now - vixHistory[0].timestamp > 30 * 60 * 1000) {
    vixHistory.shift();
  }

  if (spotPrice > 0) {
    priceHistory[page].push({ price: spotPrice, timestamp: now });
  }

  // Keep price history for 45 minutes
  while (priceHistory[page].length > 0 && now - priceHistory[page][0].timestamp > 45 * 60 * 1000) {
    priceHistory[page].shift();
  }

  if (priceHistory[page].length < 10) {
    return { isMacroCrash: false, reason: "Insufficient Data" };
  }

  const history = priceHistory[page];
  const currentPrice = history[history.length - 1].price;
  
  let highestPrice = currentPrice;
  for (const tick of history) {
    if (tick.price > highestPrice) highestPrice = tick.price;
  }

  // Calculate drop percentage from the recent high
  const dropPct = ((highestPrice - currentPrice) / highestPrice) * 100;
  
  let lowestVix = lastVix;
  for (const tick of vixHistory) {
    if (tick.price < lowestVix) lowestVix = tick.price;
  }

  const vixSpikePct = lowestVix > 0 ? ((lastVix - lowestVix) / lowestVix) * 100 : 0;
  
  const dailySpotChange = page === "NIFTY" ? marketState.niftyOptionChain.spotChangePct : 
                          page === "BANKNIFTY" ? marketState.bankniftyOptionChain.spotChangePct : 
                          marketState.sensexOptionChain.spotChangePct;

  let isCrash = false;
  let reason = "";

  const isNewsCrash = getLatestNewsCrashState(page);

  // Crash Conditions:
  if (isNewsCrash) {
    isCrash = true;
    reason = `CRASH_MODE: Fatal Macro News Detected!`;
  } else if (lastVix >= 22 && dropPct >= 0.5) {
    isCrash = true;
    reason = `CRASH_MODE: Extreme VIX (${lastVix.toFixed(1)}) + Drop (${dropPct.toFixed(2)}%)`;
  } else if (lastVix >= 16 && dropPct >= 1.0) {
    isCrash = true;
    reason = `CRASH_MODE: High VIX (${lastVix.toFixed(1)}) + Severe Drop (${dropPct.toFixed(2)}%)`;
  } else if (vixSpikePct >= 12 && dropPct >= 0.6) {
    isCrash = true;
    reason = `CRASH_MODE: VIX Spike (+${vixSpikePct.toFixed(1)}%) + Drop (${dropPct.toFixed(2)}%)`;
  } else if (dailySpotChange && dailySpotChange <= -1.5) {
    isCrash = true;
    reason = `CRASH_MODE: Severe Daily Trend (Change: ${dailySpotChange.toFixed(2)}%)`;
  }

  return { isMacroCrash: isCrash, reason };
}
