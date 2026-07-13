import { db } from "../storage/db.js";
import type { OptionStrikeData } from "../state/marketState.js";

export interface MarketEventRecord {
  indexSymbol: string;
  eventType: string;
  magnitude: number;
  triggerConditions: Record<string, any>;
}

// Memory tracking for trap boundaries and rolling volatility standard deviations
const lastPeakHigh: Record<string, number> = { NIFTY: 0, SENSEX: 0 };
const lastPeakLow: Record<string, number> = { NIFTY: Infinity, SENSEX: Infinity };
const lastOIAverage: Record<string, number> = { NIFTY: 0, SENSEX: 0 };

/**
 * High-performance algorithmic engine that evaluates incoming ticks to automatically
 * detect and label complex institutional events (e.g. traps, squeezes, rejections).
 * 
 * Every detected event is stored permanently inside the TimescaleDB market_events table.
 */
export async function detectMarketEvents(
  index: "NIFTY" | "SENSEX",
  spotPrice: number,
  prevClose: number,
  strikes: OptionStrikeData[],
  heavyweightScore: number,
  vwap: number,
  volTraded: number
): Promise<MarketEventRecord[]> {
  const isNifty = index === "NIFTY";
  const indexSymbol = isNifty ? "NSE:NIFTY50-INDEX" : "BSE:SENSEX-INDEX";
  const events: MarketEventRecord[] = [];
  
  const now = new Date();
  const indexRangeScalar = isNifty ? 100 : 350;

  // 1. Peak Boundary Update for Traps Detection
  if (spotPrice > lastPeakHigh[index]) lastPeakHigh[index] = spotPrice;
  if (spotPrice < lastPeakLow[index]) lastPeakLow[index] = spotPrice;

  // ── Bull & Bear Trap Detectors ─────────────────────────────────────────────
  // Bull Trap: Spot price hits a local peak high above previous close + delta,
  // but momentum is negative and heavyweight net scores represent divergence (< -30)
  const isBullTrap = spotPrice > prevClose + indexRangeScalar * 0.4 && 
                     heavyweightScore < -25 && 
                     lastPeakHigh[index] - spotPrice > indexRangeScalar * 0.15;
                     
  if (isBullTrap) {
    events.push({
      indexSymbol,
      eventType: "BULL_TRAP",
      magnitude: lastPeakHigh[index] - spotPrice,
      triggerConditions: { spotPrice, prevClose, heavyweightScore, peakHigh: lastPeakHigh[index] }
    });
    // Reset local boundary to avoid spam triggers
    lastPeakHigh[index] = spotPrice;
  }

  // Bear Trap: Spot price hits a local low below previous close - delta,
  // but heavyweight net scores represent positive divergence (> 25)
  const isBearTrap = spotPrice < prevClose - indexRangeScalar * 0.4 && 
                     heavyweightScore > 25 && 
                     spotPrice - lastPeakLow[index] > indexRangeScalar * 0.15;
                     
  if (isBearTrap) {
    events.push({
      indexSymbol,
      eventType: "BEAR_TRAP",
      magnitude: spotPrice - lastPeakLow[index],
      triggerConditions: { spotPrice, prevClose, heavyweightScore, peakLow: lastPeakLow[index] }
    });
    lastPeakLow[index] = spotPrice;
  }

  // ── Short Covering & Long Unwinding Detectors ──────────────────────────────
  // Short Covering: Price rises rapidly while Call Open Interest declines sharply (unwinding call sellers)
  let totalCallOiChg = 0;
  let totalPutOiChg = 0;
  strikes.forEach(s => {
    totalCallOiChg += s.ceOIChange;
    totalPutOiChg += s.peOIChange;
  });

  if (spotPrice > prevClose + indexRangeScalar * 0.25 && totalCallOiChg < -50000) {
    events.push({
      indexSymbol,
      eventType: "SHORT_COVERING",
      magnitude: Math.abs(totalCallOiChg),
      triggerConditions: { spotPrice, totalCallOiChg, priceDelta: spotPrice - prevClose }
    });
  }

  // Long Unwinding: Price falls rapidly while Put Open Interest declines sharply (unwinding put buyers)
  if (spotPrice < prevClose - indexRangeScalar * 0.25 && totalPutOiChg < -50000) {
    events.push({
      indexSymbol,
      eventType: "LONG_UNWINDING",
      magnitude: Math.abs(totalPutOiChg),
      triggerConditions: { spotPrice, totalPutOiChg, priceDelta: prevClose - spotPrice }
    });
  }

  // ── OI Explosion & Gamma Squeezes ──────────────────────────────────────────
  const netOiChange = Math.abs(totalCallOiChg) + Math.abs(totalPutOiChg);
  if (netOiChange > 250000) {
    events.push({
      indexSymbol,
      eventType: "OI_EXPLOSION",
      magnitude: netOiChange,
      triggerConditions: { totalCallOiChg, totalPutOiChg, netOiChange }
    });
  }

  // Gamma Squeeze: Massive OI addition at OTM strikes driving delta hedging
  const atmGap = isNifty ? 50 : 100;
  const atmStrike = Math.round(spotPrice / atmGap) * atmGap;
  const otmCalls = strikes.filter(s => s.strikePrice > atmStrike + atmGap);
  const otmCallOiAddition = otmCalls.reduce((acc, curr) => acc + curr.ceOIChange, 0);

  if (otmCallOiAddition > 100000 && spotPrice > prevClose) {
    events.push({
      indexSymbol,
      eventType: "GAMMA_SQUEEZE",
      magnitude: otmCallOiAddition,
      triggerConditions: { otmCallOiAddition, spotPrice, atmStrike }
    });
  }

  // ── VWAP Rejection & Volatility Detectors ──────────────────────────────────
  // VWAP Rejection: Spot price approaches VWAP closely (< 5 pts) on peak volume,
  // but fails to cross and gets rejected sharply
  const distanceToVwap = Math.abs(spotPrice - vwap);
  if (distanceToVwap < 3 && volTraded > 15000) {
    events.push({
      indexSymbol,
      eventType: "VWAP_REJECTION",
      magnitude: distanceToVwap,
      triggerConditions: { spotPrice, vwap, volume: volTraded }
    });
  }

  // ── Large Move Detectors ───────────────────────────────────────────────────
  const dailyMove = Math.abs(spotPrice - prevClose);
  if (dailyMove >= indexRangeScalar * 1.5) {
    const moveType = dailyMove >= indexRangeScalar * 3.0 ? "300_POINT_MOVE" : 
                     dailyMove >= indexRangeScalar * 2.0 ? "200_POINT_MOVE" : "100_POINT_MOVE";
                     
    events.push({
      indexSymbol,
      eventType: moveType,
      magnitude: dailyMove,
      triggerConditions: { spotPrice, prevClose, netDelta: spotPrice - prevClose }
    });
  }

  // ── Institutional Volume Actions ──────────────────────────────────────────
  if (volTraded > 50000) {
    const eventType = heavyweightScore > 40 ? "INSTITUTIONAL_BUYING" : 
                      heavyweightScore < -40 ? "INSTITUTIONAL_SELLING" : "";
                      
    if (eventType) {
      events.push({
        indexSymbol,
        eventType,
        magnitude: volTraded,
        triggerConditions: { volTraded, heavyweightScore, spotPrice }
      });
    }
  }

  // Write all detected events to Postgres Database
  if (events.length > 0) {
    const rows = events.map(e => [
      now.toISOString(), e.indexSymbol, e.eventType, e.magnitude, JSON.stringify(e.triggerConditions)
    ]);
    
    await db.bulkInsert("market_events", [
      "timestamp", "index_symbol", "event_type", "magnitude", "trigger_conditions"
    ], rows).catch(err => {
      console.error("[EventDetector] ❌ Failed to write market_events to DB:", err.message);
    });
  }

  return events;
}
