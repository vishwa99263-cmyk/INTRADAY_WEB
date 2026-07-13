import type { OptionStrikeData } from "../state/marketState.js";

export interface RecommendedStrike {
  strikePrice: number;
  symbol: string;
  premium: number;
  quality: "HIGH" | "MEDIUM" | "LOW_PREMIUM";
}

export interface StrikeSelectionResult {
  atmStrike: number;
  recommendedCe: RecommendedStrike | null;
  recommendedPe: RecommendedStrike | null;
  volatilityExpansion: boolean;
  volatilityReason: string;
}

export function selectStrikes(
  strikes: OptionStrikeData[],
  spotPrice: number,
  strikeGap: number
): StrikeSelectionResult {
  const atmStrike = Math.round(spotPrice / strikeGap) * strikeGap;

  let recommendedCe: RecommendedStrike | null = null;
  let recommendedPe: RecommendedStrike | null = null;

  // Premium bounds
  const minPrefPremium = 80;
  const maxPrefPremium = 150;

  // Helper to rate strike premium quality
  const getQuality = (ltp: number): RecommendedStrike["quality"] => {
    if (ltp < 20) return "LOW_PREMIUM";
    if (ltp >= minPrefPremium && ltp <= maxPrefPremium) return "HIGH";
    return "MEDIUM";
  };

  // Find CE Strike: We want CE strike around ATM or slightly OTM (strike >= ATM)
  // Let's filter strikes where CE LTP is closest to the ₹80–₹150 range.
  let bestCeDiff = Infinity;
  let bestCeRow: OptionStrikeData | null = null;

  let bestPeDiff = Infinity;
  let bestPeRow: OptionStrikeData | null = null;

  strikes.forEach(s => {
    // CE premium evaluation
    if (s.ceLtp > 0) {
      // Prioritize premiums in the range, or closest to 100
      const diff = Math.abs(s.ceLtp - 100);
      if (s.ceLtp >= minPrefPremium - 30 && s.ceLtp <= maxPrefPremium + 30) {
        if (diff < bestCeDiff) {
          bestCeDiff = diff;
          bestCeRow = s;
        }
      }
    }

    // PE premium evaluation
    if (s.peLtp > 0) {
      const diff = Math.abs(s.peLtp - 100);
      if (s.peLtp >= minPrefPremium - 30 && s.peLtp <= maxPrefPremium + 30) {
        if (diff < bestPeDiff) {
          bestPeDiff = diff;
          bestPeRow = s;
        }
      }
    }
  });

  // Fallbacks if no option is in preferred band: pick ATM
  const atmRow = strikes.find(s => s.strikePrice === atmStrike);

  if (bestCeRow) {
    recommendedCe = {
      strikePrice: bestCeRow.strikePrice,
      symbol: bestCeRow.ceSymbol,
      premium: bestCeRow.ceLtp,
      quality: getQuality(bestCeRow.ceLtp),
    };
  } else if (atmRow) {
    recommendedCe = {
      strikePrice: atmRow.strikePrice,
      symbol: atmRow.ceSymbol,
      premium: atmRow.ceLtp,
      quality: getQuality(atmRow.ceLtp),
    };
  }

  if (bestPeRow) {
    recommendedPe = {
      strikePrice: bestPeRow.strikePrice,
      symbol: bestPeRow.peSymbol,
      premium: bestPeRow.peLtp,
      quality: getQuality(bestPeRow.peLtp),
    };
  } else if (atmRow) {
    recommendedPe = {
      strikePrice: atmRow.strikePrice,
      symbol: atmRow.peSymbol,
      premium: atmRow.peLtp,
      quality: getQuality(atmRow.peLtp),
    };
  }

  // Same Premium Rule (Volatility Expansion Alert)
  // E.g., if CE premium ≈ PE premium on the ATM or recommended strike
  let volatilityExpansion = false;
  let volatilityReason = "Normal volatility";

  if (recommendedCe && recommendedPe) {
    const diffPct = Math.abs(recommendedCe.premium - recommendedPe.premium) / ((recommendedCe.premium + recommendedPe.premium) / 2 || 1);
    if (diffPct < 0.12 && recommendedCe.premium > 40) {
      volatilityExpansion = true;
      volatilityReason = `CE Premium (₹${recommendedCe.premium}) ≈ PE Premium (₹${recommendedPe.premium}). Expecting high volatility expansion!`;
    }
  }

  return {
    atmStrike,
    recommendedCe,
    recommendedPe,
    volatilityExpansion,
    volatilityReason,
  };
}
