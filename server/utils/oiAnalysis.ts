import type { OptionStrikeData } from "../state/marketState.js";

export interface StrikeBuildup {
  strikePrice: number;
  ceBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
  peBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
}

export interface OiAnalysisResult {
  pcr: number;
  sentiment: "BULLISH" | "BEARISH" | "SIDEWAYS" | "STRONG_BULLISH" | "STRONG_BEARISH";
  resistanceWall: number;
  resistanceOi: number;
  supportWall: number;
  supportOi: number;
  maxPainStrike: number;
  buildups: StrikeBuildup[];
  netCeBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
  netPeBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
}

export function analyzeOI(strikes: OptionStrikeData[], spotPrice: number): OiAnalysisResult {
  if (strikes.length === 0) {
    return {
      pcr: 1.0, sentiment: "SIDEWAYS", resistanceWall: 0, resistanceOi: 0, supportWall: 0, supportOi: 0,
      maxPainStrike: 0, buildups: [], netCeBuildup: "NONE", netPeBuildup: "NONE"
    };
  }

  let totalCallOi = 0;
  let totalPutOi = 0;
  let totalCallOiChg = 0;
  let totalPutOiChg = 0;
  let totalCallPremiumChg = 0;
  let totalPutPremiumChg = 0;

  let maxCeOi = -1;
  let resistanceWall = 0;
  let maxPeOi = -1;
  let supportWall = 0;

  let maxTotalOi = -1;
  let maxPainStrike = 0;

  const buildups: StrikeBuildup[] = [];

  strikes.forEach(s => {
    totalCallOi += s.ceOI;
    totalPutOi  += s.peOI;
    totalCallOiChg += s.ceOIChange;
    totalPutOiChg  += s.peOIChange;
    totalCallPremiumChg += s.ceLtpChgPct;
    totalPutPremiumChg  += s.peLtpChgPct;

    // Resistance Wall (Highest CE OI)
    if (s.ceOI > maxCeOi) {
      maxCeOi = s.ceOI;
      resistanceWall = s.strikePrice;
    }

    // Support Wall (Highest PE OI)
    if (s.peOI > maxPeOi) {
      maxPeOi = s.peOI;
      supportWall = s.strikePrice;
    }

    // Max Pain (simplified as strike with highest total CE+PE OI)
    const totalOi = s.ceOI + s.peOI;
    if (totalOi > maxTotalOi) {
      maxTotalOi = totalOi;
      maxPainStrike = s.strikePrice;
    }

    // Buildup per strike
    // CE side
    let ceBuildup: StrikeBuildup["ceBuildup"] = "NONE";
    const cePriceUp = s.ceLtpChgPct > 0;
    const ceOiUp = s.ceOIChange > 0;

    if (ceOiUp && cePriceUp) ceBuildup = "LONG_BUILDUP";
    else if (ceOiUp && !cePriceUp) ceBuildup = "SHORT_BUILDUP";
    else if (!ceOiUp && cePriceUp) ceBuildup = "SHORT_COVERING";
    else if (!ceOiUp && !cePriceUp) ceBuildup = "LONG_UNWINDING";

    // PE side
    let peBuildup: StrikeBuildup["peBuildup"] = "NONE";
    const pePriceUp = s.peLtpChgPct > 0;
    const peOiUp = s.peOIChange > 0;

    if (peOiUp && pePriceUp) peBuildup = "LONG_BUILDUP";
    else if (peOiUp && !pePriceUp) peBuildup = "SHORT_BUILDUP";
    else if (!peOiUp && pePriceUp) peBuildup = "SHORT_COVERING";
    else if (!peOiUp && !pePriceUp) peBuildup = "LONG_UNWINDING";

    buildups.push({
      strikePrice: s.strikePrice,
      ceBuildup,
      peBuildup,
    });
  });

  // Calculate PCR
  const pcr = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(3)) : 1.0;

  // Sentiment based on PCR and OI Change trends
  let sentiment: OiAnalysisResult["sentiment"] = "SIDEWAYS";
  if (pcr > 1.4) sentiment = "STRONG_BULLISH";
  else if (pcr > 1.1) sentiment = "BULLISH";
  else if (pcr < 0.6) sentiment = "STRONG_BEARISH";
  else if (pcr < 0.85) sentiment = "BEARISH";

  // Net Buildups
  const getNetBuildup = (netOiChg: number, netLtpChg: number): OiAnalysisResult["netCeBuildup"] => {
    if (netOiChg > 0 && netLtpChg > 0) return "LONG_BUILDUP";
    if (netOiChg > 0 && netLtpChg < 0) return "SHORT_BUILDUP";
    if (netOiChg < 0 && netLtpChg > 0) return "SHORT_COVERING";
    if (netOiChg < 0 && netLtpChg < 0) return "LONG_UNWINDING";
    return "NONE";
  };

  const netCeBuildup = getNetBuildup(totalCallOiChg, totalCallPremiumChg);
  const netPeBuildup = getNetBuildup(totalPutOiChg, totalPutPremiumChg);

  return {
    pcr,
    sentiment,
    resistanceWall,
    resistanceOi: maxCeOi,
    supportWall,
    supportOi: maxPeOi,
    maxPainStrike,
    buildups,
    netCeBuildup,
    netPeBuildup,
  };
}
