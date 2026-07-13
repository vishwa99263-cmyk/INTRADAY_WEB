import { recordHeavyweight } from "./marketRecorder.js";

// Static institutional weightages map for Nifty 50 and Sensex 30 heavyweights (top contributors)
const HEAVYWEIGHT_WEIGHTS: Record<string, Record<string, number>> = {
  NIFTY: {
    RELIANCE: 0.092,
    HDFCBANK: 0.115,
    ICICIBANK: 0.078,
    INFY: 0.052,
    TCS: 0.038,
    SBIN: 0.032,
    AXISBANK: 0.031,
    LT: 0.034,
  },
  SENSEX: {
    RELIANCE: 0.105,
    HDFCBANK: 0.131,
    ICICIBANK: 0.089,
    INFY: 0.059,
    TCS: 0.043,
    SBIN: 0.036,
    AXISBANK: 0.035,
    LT: 0.039,
  },
  BANKNIFTY: {
    HDFCBANK: 0.2913,
    ICICIBANK: 0.2290,
    AXISBANK: 0.1123,
    SBIN: 0.0998,
    KOTAKBANK: 0.0972,
    INDUSINDBK: 0.0583,
    BANKBARODA: 0.0265,
    AUBANK: 0.0242,
    FEDERALBNK: 0.0221,
    IDFCFIRSTB: 0.0185,
    PNB: 0.0108,
    BANDHANBNK: 0.0100,
  }
};

// In-memory historical cache to compute velocity and acceleration of heavyweight contributions
interface ContributionState {
  lastLtp: number;
  lastPoints: number;
  lastVelocity: number;
  lastTimestamp: number;
}

const contributionCache: Map<string, ContributionState> = new Map();

/**
 * Calculates and records the real-time index point contribution, weightage,
 * acceleration, and divergence score for a stock tick.
 * 
 * Formula for Index Point Contribution:
 * Contribution Points = (Current LTP - Previous Close) * Weightage Factor * Scalar
 * 
 * Spliced into TimescaleDB spooled buffer historically.
 */
export function calculateHeavyweightContribution(
  index: "NIFTY" | "SENSEX" | "BANKNIFTY",
  stockSymbol: string,
  ltp: number,
  prevClose: number,
  indexSpotPrice: number
): void {
  const symbolUpper = stockSymbol.toUpperCase();
  const indexWeights = HEAVYWEIGHT_WEIGHTS[index === "BANKNIFTY" ? "BANKNIFTY" : index];
  
  // Verify if it's a tracked heavyweight index constituent
  let matchedKey = "";
  for (const key of Object.keys(indexWeights)) {
    if (symbolUpper.includes(key)) {
      matchedKey = key;
      break;
    }
  }
  
  if (!matchedKey) return; // Ignore stocks with < 3% index weightage

  const weight = indexWeights[matchedKey];
  
  // Point contribution approximation
  // Scalar factor: Nifty base divisor scale approx 100-150. Sensex base divisor scale approx 300-450. Bank Nifty base divisor scale approx 250-350.
  const indexScalar = index === "NIFTY" ? 120.0 : (index === "BANKNIFTY" ? 300.0 : 420.0);
  const priceDelta = ltp - prevClose;
  const contributionPoints = parseFloat((priceDelta * weight * indexScalar).toFixed(3));
  const contributionPct = parseFloat(((contributionPoints / indexSpotPrice) * 100).toFixed(4));

  // Compute momentum, velocity & acceleration using sliding time caches
  const cacheKey = `${index}_${matchedKey}`;
  const now = Date.now();
  let momentum = 0.0;
  let acceleration = 0.0;
  let divergence = 0.0;

  if (contributionCache.has(cacheKey)) {
    const cached = contributionCache.get(cacheKey)!;
    const timeDeltaSec = Math.max(0.1, (now - cached.lastTimestamp) / 1000);
    
    // 1. Contribution Velocity (Momentum)
    const velocity = (contributionPoints - cached.lastPoints) / timeDeltaSec;
    momentum = parseFloat(velocity.toFixed(3));

    // 2. Contribution Acceleration
    const velocityDelta = velocity - cached.lastVelocity;
    acceleration = parseFloat((velocityDelta / timeDeltaSec).toFixed(3));

    // 3. Divergence: Difference between stock momentum and typical average drift
    divergence = parseFloat((momentum - cached.lastVelocity * 0.1).toFixed(3));

    // Update Cache
    cached.lastLtp = ltp;
    cached.lastPoints = contributionPoints;
    cached.lastVelocity = velocity;
    cached.lastTimestamp = now;
  } else {
    // Initialize Cache
    contributionCache.set(cacheKey, {
      lastLtp: ltp,
      lastPoints: contributionPoints,
      lastVelocity: 0.0,
      lastTimestamp: now,
    });
  }

  // Enqueue heavyweight contribution snapshot historically into TimescaleDB queue
  const indexTicker = index === "NIFTY" ? "NSE:NIFTY50-INDEX" : (index === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "BSE:SENSEX-INDEX");
  recordHeavyweight(
    indexTicker,
    stockSymbol,
    ltp,
    weight,
    contributionPoints,
    contributionPct,
    momentum,
    acceleration,
    divergence
  );
}
