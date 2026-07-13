/**
 * institutionalMacroEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 17: Institutional Macro Engine
 *
 * Evaluates FII & DII cash segment transaction values to calculate institutional
 * bias (BULLISH/BEARISH/NEUTRAL) and a macro score (0-100).
 */

export interface TEFiiDii {
  date: string;
  fii_cash: number;
  dii_cash: number;
}

export interface InstitutionalMacroResult {
  fiiNetCash: number;
  diiNetCash: number;
  netCombinedFlow: number;
  institutionalBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  macroScore: number;
  reasons: string[];
}

export function computeInstitutionalMacro(history: TEFiiDii[]): InstitutionalMacroResult {
  const reasons: string[] = [];

  if (!history || history.length === 0) {
    return {
      fiiNetCash: 0,
      diiNetCash: 0,
      netCombinedFlow: 0,
      institutionalBias: "NEUTRAL",
      macroScore: 50,
      reasons: ["No FII/DII data available. Defaulting to neutral sentiment."],
    };
  }

  // Latest record
  const latest = history[0];
  const fiiNetCash = latest.fii_cash;
  const diiNetCash = latest.dii_cash;
  const netCombinedFlow = fiiNetCash + diiNetCash;

  // 1. Calculate institutional bias based on latest combined flow
  // Thresholds: Combined flow > +500 Cr is Bullish, < -500 Cr is Bearish, else Neutral
  let institutionalBias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let macroScore = 50;

  if (netCombinedFlow > 500) {
    institutionalBias = "BULLISH";
    macroScore = Math.min(100, 50 + Math.round(netCombinedFlow / 50));
    reasons.push(`Bullish bias: Net institutional flow is highly positive at +₹${netCombinedFlow.toFixed(0)} Cr.`);
  } else if (netCombinedFlow < -500) {
    institutionalBias = "BEARISH";
    macroScore = Math.max(0, 50 + Math.round(netCombinedFlow / 50));
    reasons.push(`Bearish bias: Net institutional flow is highly negative at -₹${Math.abs(netCombinedFlow).toFixed(0)} Cr.`);
  } else {
    reasons.push(`Neutral bias: Combined institutional flow is consolidating at ₹${netCombinedFlow.toFixed(0)} Cr.`);
  }

  // 2. Trend analysis (FII 3-day average flow)
  if (history.length >= 3) {
    const avgFii3d = (history[0].fii_cash + history[1].fii_cash + history[2].fii_cash) / 3;
    reasons.push(`FII 3-Day Average Cash Flow: ₹${avgFii3d.toFixed(0)} Cr.`);
    
    // Add trend modifiers
    if (avgFii3d > 1000) {
      macroScore = Math.min(100, macroScore + 10);
      reasons.push("FIIs exhibit strong multi-day cash buying momentum (+10 score applied).");
    } else if (avgFii3d < -1000) {
      macroScore = Math.max(0, macroScore - 10);
      reasons.push("FIIs exhibit persistent multi-day cash selling momentum (-10 score applied).");
    }
  }

  return {
    fiiNetCash,
    diiNetCash,
    netCombinedFlow,
    institutionalBias,
    macroScore,
    reasons,
  };
}
