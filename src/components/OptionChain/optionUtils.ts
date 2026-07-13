export interface OptionStrikeRow {
  strikePrice: number;
  ceSymbol: string;
  peSymbol: string;
  // CE side
  ceDelta: number;
  ceGamma: number;
  ceTheta: number;
  ceVega: number;
  ceIV: number;
  ceVolume: number;
  ceOI: number;
  ceOIChange: number;
  ceOIChangePct: number;
  ceBid: number;
  ceAsk: number;
  ceLtp: number;
  ceLtpChgPct: number;
  // PE side
  peLtp: number;
  peLtpChgPct: number;
  peBid: number;
  peAsk: number;
  peOI: number;
  peOIChange: number;
  peOIChangePct: number;
  peVolume: number;
  peIV: number;
  peVega: number;
  peTheta: number;
  peGamma: number;
  peDelta: number;
}

/**
 * Calculates Put-Call Ratio (PCR)
 */
export function calculatePcr(totalCallOi: number, totalPutOi: number): number {
  if (!totalCallOi || totalCallOi <= 0) return 0;
  return parseFloat((totalPutOi / totalCallOi).toFixed(2));
}

/**
 * Calculates Option Pain (Max Pain) Strike
 * The strike price where total loss (pain) to option buyers is minimized.
 */
export function calculateMaxPain(rows: OptionStrikeRow[]): number {
  if (!rows || rows.length === 0) return 0;

  const strikes = rows.map((r) => r.strikePrice);
  let minPain = Infinity;
  let maxPainStrike = strikes[0];

  strikes.forEach((testStrike) => {
    let totalPain = 0;

    rows.forEach((row) => {
      const strike = row.strikePrice;

      // Call Loss (Buyers gain if spot > strike, sellers lose)
      if (testStrike > strike) {
        totalPain += row.ceOI * (testStrike - strike);
      }

      // Put Loss (Buyers gain if spot < strike, sellers lose)
      if (testStrike < strike) {
        totalPain += row.peOI * (strike - testStrike);
      }
    });

    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = testStrike;
    }
  });

  return maxPainStrike;
}

/**
 * Finds Support (Max Put OI Strike) and Resistance (Max Call OI Strike)
 */
export function calculateSupportResistance(rows: OptionStrikeRow[]): {
  resistance: number;
  support: number;
  maxCallOi: number;
  maxPutOi: number;
} {
  let resistance = 0;
  let support = 0;
  let maxCallOi = -1;
  let maxPutOi = -1;

  rows.forEach((row) => {
    if (row.ceOI > maxCallOi) {
      maxCallOi = row.ceOI;
      resistance = row.strikePrice;
    }
    if (row.peOI > maxPutOi) {
      maxPutOi = row.peOI;
      support = row.strikePrice;
    }
  });

  return { resistance, support, maxCallOi, maxPutOi };
}

/**
 * Identifies Open Interest Build-up category based on LTP Change and OI Change
 */
export type BuildUpType = "Long Build-up" | "Short Build-up" | "Long Unwinding" | "Short Covering" | "Neutral";

export function getOiBuildUp(ltpChange: number, oiChange: number): BuildUpType {
  if (oiChange > 0 && ltpChange > 0) return "Long Build-up";
  if (oiChange > 0 && ltpChange < 0) return "Short Build-up";
  if (oiChange < 0 && ltpChange < 0) return "Long Unwinding";
  if (oiChange < 0 && ltpChange > 0) return "Short Covering";
  return "Neutral";
}

/**
 * Determines if a strike option is In-the-money (ITM) or Out-of-the-money (OTM)
 */
export function isItm(strike: number, spotPrice: number, optionType: "CE" | "PE"): boolean {
  if (optionType === "CE") {
    return strike < spotPrice;
  } else {
    return strike > spotPrice;
  }
}
