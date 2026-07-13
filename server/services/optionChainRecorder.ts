import { recordOptionSnapshot, recordStrikeDetail } from "./marketRecorder.js";
import type { OptionStrikeData } from "../state/marketState.js";

/**
 * Parses option chain strike arrays and aggregate PCR, Max Pain, support/resistance,
 * and writes strike matrices historically into the spooled TimescaleDB queue.
 */
export function recordOptionChainSnapshot(
  indexSymbol: string,
  spotPrice: number,
  strikes: OptionStrikeData[],
  totalCallOi: number,
  totalPutOi: number,
  indiaVix: number
): void {
  if (strikes.length === 0) return;

  const gap = indexSymbol.includes("SENSEX") ? 100 : 50;
  const atm = Math.round(spotPrice / gap) * gap;

  // 1. PCR Calculation
  const pcr = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(3)) : 1.0;

  // 2. Max Pain Approximation
  let maxPain = atm;
  let minPainValue = Infinity;

  // Aggregate option strike level calculations
  strikes.forEach(strike => {
    let totalPain = 0;
    strikes.forEach(s => {
      const callPain = s.ceOI * Math.max(0, s.strikePrice - strike.strikePrice);
      const putPain = s.peOI * Math.max(0, strike.strikePrice - s.strikePrice);
      totalPain += callPain + putPain;
    });

    if (totalPain < minPainValue) {
      minPainValue = totalPain;
      maxPain = strike.strikePrice;
    }
  });

  // 3. Dynamic Support & Resistance Zones
  const maxCeOI = Math.max(...strikes.map(s => s.ceOI), 1);
  const maxPeOI = Math.max(...strikes.map(s => s.peOI), 1);

  const resistanceStrike = strikes.find(s => s.ceOI === maxCeOI)?.strikePrice || atm;
  const supportStrike = strikes.find(s => s.peOI === maxPeOI)?.strikePrice || atm;

  // 4. Aggregate option writing and unwinding volume deltas
  let ceWritingVol = 0;
  let peWritingVol = 0;
  let ceUnwindingOi = 0;
  let peUnwindingOi = 0;

  strikes.forEach(s => {
    // Option writing builds up open interest
    if (s.ceOIChange > 0) ceWritingVol += s.ceOIChange;
    if (s.peOIChange > 0) peWritingVol += s.peOIChange;

    // Option unwinding sheds open interest (negative OI Change)
    if (s.ceOIChange < 0) ceUnwindingOi += Math.abs(s.ceOIChange);
    if (s.peOIChange < 0) peUnwindingOi += Math.abs(s.peOIChange);
  });

  // ── Step 1: Record Option Snapshot Metadata ───────────────────────────────
  recordOptionSnapshot(
    indexSymbol,
    atm,
    pcr,
    maxPain,
    supportStrike,
    resistanceStrike,
    totalCallOi,
    totalPutOi,
    ceWritingVol,
    peWritingVol,
    ceUnwindingOi,
    peUnwindingOi
  );

  // ── Step 2: Record Strike-Level Details Matrix ───────────────────────────
  strikes.forEach(s => {
    recordStrikeDetail(
      indexSymbol,
      s.strikePrice,
      s.ceLtp,
      s.ceOI,
      s.ceOIChange,
      s.ceVolume,
      s.ceIV,
      s.peLtp,
      s.peOI,
      s.peOIChange,
      s.peVolume,
      s.peIV
    );
  });
}
