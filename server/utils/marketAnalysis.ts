import { analyzeTrend, TrendAnalysisResult } from "./trendAnalysis.js";
import { analyzeOI, OiAnalysisResult } from "./oiAnalysis.js";
import { analyzeVolume, VolumeAnalysisResult } from "./volumeAnalysis.js";
import { selectStrikes, StrikeSelectionResult } from "./strikeSelection.js";
import type { SpeedAnalysisResult } from "./speedAnalysis.js";
import type { StockData } from "../../src/types.js";
import type { OptionStrikeData } from "../state/marketState.js";

export interface CompleteMarketReport {
  trend: TrendAnalysisResult;
  oi: OiAnalysisResult;
  volume: VolumeAnalysisResult;
  speed: SpeedAnalysisResult;
  strikes: StrikeSelectionResult;
  timestamp: number;
}

export function compileMarketReport(
  stocks: StockData[],
  optionStrikes: OptionStrikeData[],
  spotPrice: number,
  strikeGap: number,
  speedResult: SpeedAnalysisResult,
  page: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY",
): CompleteMarketReport {
  // Pass page + spotPrice to analyzeTrend for Layer 2 market structure detection
  const trend = analyzeTrend(stocks, page, spotPrice);
  const oi = analyzeOI(optionStrikes, spotPrice);
  const volume = analyzeVolume(optionStrikes);
  const strikes = selectStrikes(optionStrikes, spotPrice, strikeGap);

  return {
    trend,
    oi,
    volume,
    speed: speedResult,
    strikes,
    timestamp: Date.now(),
  };
}
