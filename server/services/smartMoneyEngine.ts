import type { OptionStrikeData } from "../state/marketState.js";
import type { OiAnalysisResult } from "../utils/oiAnalysis.js";

export type SmartMoneyDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type SmartMoneyEventType =
  | "LARGE_OI_SHIFT"
  | "PCR_DIVERGENCE"
  | "SWEEP_ORDER"
  | "ACCUMULATION"
  | "DISTRIBUTION"
  | "NONE";

export interface SmartMoneySignal {
  direction: SmartMoneyDirection;
  confidence: number;             // 0-100
  eventType: SmartMoneyEventType;
  detail: string;                 // Human-readable explanation
  institutionalBias: "BUYING" | "SELLING" | "HEDGING" | "NEUTRAL";
  reasoning: string;              // Debug / explainability metadata
}

// Rolling history for PCR divergence detection
const pcrHistory: Record<string, { pcr: number; spot: number; timestamp: number }[]> = {};
// Rolling OI accumulation tracker
const oiAccumulation: Record<string, { strike: number; ceOI: number; peOI: number }[]> = {};

export function analyzeSmartMoney(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  strikes: OptionStrikeData[],
  oi: OiAnalysisResult,
  spotPrice: number,
): SmartMoneySignal {
  const empty: SmartMoneySignal = {
    direction: "NEUTRAL",
    confidence: 0,
    eventType: "NONE",
    detail: "No significant institutional activity detected.",
    institutionalBias: "NEUTRAL",
    reasoning: "Insufficient data or market is quiet.",
  };

  if (strikes.length === 0 || spotPrice <= 0) return empty;

  // ── 1. Large OI Shift Detection ──────────────────────────────────────────
  // Any strike where OI change is > 3x average is a block-level institutional move
  const avgCeOiChange = strikes.reduce((s, x) => s + Math.abs(x.ceOIChange), 0) / strikes.length;
  const avgPeOiChange = strikes.reduce((s, x) => s + Math.abs(x.peOIChange), 0) / strikes.length;

  let largeOiStrikes: { strike: number; side: "CE" | "PE"; change: number }[] = [];
  strikes.forEach(s => {
    if (avgCeOiChange > 0 && Math.abs(s.ceOIChange) > avgCeOiChange * 3) {
      largeOiStrikes.push({ strike: s.strikePrice, side: "CE", change: s.ceOIChange });
    }
    if (avgPeOiChange > 0 && Math.abs(s.peOIChange) > avgPeOiChange * 3) {
      largeOiStrikes.push({ strike: s.strikePrice, side: "PE", change: s.peOIChange });
    }
  });

  // ── 2. PCR Divergence Detection ───────────────────────────────────────────
  // PCR rising while price falling = smart money accumulating puts (hedging / bearish)
  // PCR falling while price rising = smart money writing puts (bullish positioning)
  if (!pcrHistory[page]) pcrHistory[page] = [];
  pcrHistory[page].push({ pcr: oi.pcr, spot: spotPrice, timestamp: Date.now() });
  if (pcrHistory[page].length > 20) pcrHistory[page].shift();

  let pcrDivergence = false;
  let pcrDivergenceDir: SmartMoneyDirection = "NEUTRAL";
  let pcrDivergenceDetail = "";

  if (pcrHistory[page].length >= 5) {
    const hist = pcrHistory[page];
    const oldPcr  = hist[0].pcr;
    const newPcr  = hist[hist.length - 1].pcr;
    const oldSpot = hist[0].spot;
    const newSpot = hist[hist.length - 1].spot;

    const pcrChange  = newPcr - oldPcr;
    const spotChange = newSpot - oldSpot;

    // PCR rising significantly + price falling = bearish institutional
    if (pcrChange > 0.08 && spotChange < -20) {
      pcrDivergence = true;
      pcrDivergenceDir = "BEARISH";
      pcrDivergenceDetail = `PCR surged ${pcrChange.toFixed(2)} while spot fell ${Math.abs(spotChange).toFixed(0)} pts — institutional hedging/bearish positioning.`;
    }
    // PCR falling significantly + price rising = bullish institutional
    else if (pcrChange < -0.08 && spotChange > 20) {
      pcrDivergence = true;
      pcrDivergenceDir = "BULLISH";
      pcrDivergenceDetail = `PCR dropped ${Math.abs(pcrChange).toFixed(2)} while spot rose ${spotChange.toFixed(0)} pts — put writing = bullish institutional.`;
    }
  }

  // ── 3. Sweep Order Detection ──────────────────────────────────────────────
  // Multiple strikes simultaneously showing volume spikes = sweep order
  const ceSpikes = strikes.filter(s => {
    const avg = strikes.reduce((a, x) => a + x.ceVolume, 0) / strikes.length;
    return s.ceVolume > avg * 2.5;
  });
  const peSpikes = strikes.filter(s => {
    const avg = strikes.reduce((a, x) => a + x.peVolume, 0) / strikes.length;
    return s.peVolume > avg * 2.5;
  });

  const isSweep = ceSpikes.length >= 3 || peSpikes.length >= 3;
  const sweepDir: SmartMoneyDirection = ceSpikes.length > peSpikes.length ? "BEARISH" : "BULLISH";

  // ── 4. Accumulation / Distribution ───────────────────────────────────────
  // Sustained OI build at a strike above/below spot = positioning
  let accumulationSignal: SmartMoneyDirection = "NEUTRAL";
  const aboveSpotCeOi = strikes
    .filter(s => s.strikePrice > spotPrice)
    .reduce((a, s) => a + s.ceOIChange, 0);
  const belowSpotPeOi = strikes
    .filter(s => s.strikePrice < spotPrice)
    .reduce((a, s) => a + s.peOIChange, 0);

  if (aboveSpotCeOi < -50000 && belowSpotPeOi > 50000) {
    // CE OI reducing above + PE OI building below = bullish squeeze approaching
    accumulationSignal = "BULLISH";
  } else if (aboveSpotCeOi > 50000 && belowSpotPeOi < -50000) {
    // CE building above + PE reducing below = distribution
    accumulationSignal = "BEARISH";
  }

  // ── 5. Determine dominant signal ─────────────────────────────────────────
  let finalDirection: SmartMoneyDirection = "NEUTRAL";
  let finalEvent: SmartMoneyEventType = "NONE";
  let finalConfidence = 0;
  let finalDetail = empty.detail;
  let institutionalBias: SmartMoneySignal["institutionalBias"] = "NEUTRAL";
  const reasoningParts: string[] = [];

  if (isSweep) {
    finalEvent = "SWEEP_ORDER";
    finalDirection = sweepDir;
    finalConfidence = 80;
    finalDetail = `Sweep order detected across ${Math.max(ceSpikes.length, peSpikes.length)} strikes! Institutional ${sweepDir} sweep.`;
    institutionalBias = sweepDir === "BULLISH" ? "BUYING" : "SELLING";
    reasoningParts.push(`CE spikes=${ceSpikes.length}, PE spikes=${peSpikes.length}`);
  } else if (largeOiStrikes.length > 0) {
    finalEvent = "LARGE_OI_SHIFT";
    const netCeShift = largeOiStrikes.filter(x => x.side === "CE").reduce((a, x) => a + x.change, 0);
    const netPeShift = largeOiStrikes.filter(x => x.side === "PE").reduce((a, x) => a + x.change, 0);
    if (netPeShift > 0 && netCeShift < 0) {
      finalDirection = "BULLISH"; institutionalBias = "BUYING";
    } else if (netCeShift > 0 && netPeShift < 0) {
      finalDirection = "BEARISH"; institutionalBias = "SELLING";
    } else {
      finalDirection = "NEUTRAL"; institutionalBias = "HEDGING";
    }
    finalConfidence = 70;
    finalDetail = `Large block OI shift at ${largeOiStrikes.length} strike(s). Net institutional direction: ${finalDirection}.`;
    reasoningParts.push(`Avg CE OI chg=${avgCeOiChange.toFixed(0)}, Avg PE OI chg=${avgPeOiChange.toFixed(0)}`);
  } else if (pcrDivergence) {
    finalEvent = "PCR_DIVERGENCE";
    finalDirection = pcrDivergenceDir;
    finalConfidence = 65;
    finalDetail = pcrDivergenceDetail;
    institutionalBias = pcrDivergenceDir === "BULLISH" ? "BUYING" : "HEDGING";
    reasoningParts.push(`PCR history depth=${pcrHistory[page].length}`);
  } else if (accumulationSignal !== "NEUTRAL") {
    finalEvent = accumulationSignal === "BULLISH" ? "ACCUMULATION" : "DISTRIBUTION";
    finalDirection = accumulationSignal;
    finalConfidence = 55;
    finalDetail = `${finalEvent}: Smart money ${finalEvent === "ACCUMULATION" ? "accumulating below spot" : "distributing above spot"}.`;
    institutionalBias = accumulationSignal === "BULLISH" ? "BUYING" : "SELLING";
    reasoningParts.push(`Above spot CE OI chg=${aboveSpotCeOi}, Below spot PE OI chg=${belowSpotPeOi}`);
  }

  return {
    direction: finalDirection,
    confidence: finalConfidence,
    eventType: finalEvent,
    detail: finalDetail,
    institutionalBias,
    reasoning: reasoningParts.join(" | ") || "No strong institutional signal.",
  };
}
