import type { OptionStrikeData } from "../state/marketState.js";

export interface StrikeVolumeFlag {
  strikePrice: number;
  ceVolumeSpike: boolean;
  peVolumeSpike: boolean;
}

export interface VolumeAnalysisResult {
  totalCeVolume: number;
  totalPeVolume: number;
  volumeRatio: number; // PE Vol / CE Vol
  volumeBias: "CE_DOMINATED" | "PE_DOMINATED" | "BALANCED";
  avgStrikeCeVolume: number;
  avgStrikePeVolume: number;
  strikeFlags: StrikeVolumeFlag[];
  hasMajorCeSpike: boolean;
  hasMajorPeSpike: boolean;
}

export function analyzeVolume(strikes: OptionStrikeData[]): VolumeAnalysisResult {
  if (strikes.length === 0) {
    return {
      totalCeVolume: 0, totalPeVolume: 0, volumeRatio: 1.0, volumeBias: "BALANCED",
      avgStrikeCeVolume: 0, avgStrikePeVolume: 0, strikeFlags: [], hasMajorCeSpike: false, hasMajorPeSpike: false
    };
  }

  let totalCeVolume = 0;
  let totalPeVolume = 0;

  strikes.forEach(s => {
    totalCeVolume += s.ceVolume;
    totalPeVolume  += s.peVolume;
  });

  const avgStrikeCeVolume = totalCeVolume / strikes.length;
  const avgStrikePeVolume = totalPeVolume / strikes.length;

  const strikeFlags: StrikeVolumeFlag[] = [];
  let hasMajorCeSpike = false;
  let hasMajorPeSpike = false;

  // Threshold for volume spike is 2.5 times the average strike volume
  const spikeThresholdMultiplier = 2.5;

  strikes.forEach(s => {
    const ceVolumeSpike = s.ceVolume > 0 && s.ceVolume > avgStrikeCeVolume * spikeThresholdMultiplier;
    const peVolumeSpike = s.peVolume > 0 && s.peVolume > avgStrikePeVolume * spikeThresholdMultiplier;

    if (ceVolumeSpike) hasMajorCeSpike = true;
    if (peVolumeSpike) hasMajorPeSpike = true;

    strikeFlags.push({
      strikePrice: s.strikePrice,
      ceVolumeSpike,
      peVolumeSpike,
    });
  });

  const volumeRatio = totalCeVolume > 0 ? parseFloat((totalPeVolume / totalCeVolume).toFixed(3)) : 1.0;
  let volumeBias: VolumeAnalysisResult["volumeBias"] = "BALANCED";
  if (volumeRatio > 1.2) volumeBias = "PE_DOMINATED";
  else if (volumeRatio < 0.8) volumeBias = "CE_DOMINATED";

  return {
    totalCeVolume,
    totalPeVolume,
    volumeRatio,
    volumeBias,
    avgStrikeCeVolume: Math.round(avgStrikeCeVolume),
    avgStrikePeVolume: Math.round(avgStrikePeVolume),
    strikeFlags,
    hasMajorCeSpike,
    hasMajorPeSpike,
  };
}
