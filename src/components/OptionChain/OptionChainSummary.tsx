import React, { useMemo } from "react";
import CallMetrics from "./CallMetrics.js";
import SentimentMetrics from "./SentimentMetrics.js";
import PutMetrics from "./PutMetrics.js";
import { OptionStrike } from "../../types.js";

interface OptionChainSummaryProps {
  strikes: OptionStrike[];
  spotPrice: number;
  strikeGap: number;
  darkMode?: boolean;
}

function OptionChainSummary({
  strikes,
  spotPrice,
  strikeGap,
  darkMode = false,
}: OptionChainSummaryProps) {
  
  // 1. Calculate ATM Strike
  const atmStrike = useMemo(() => {
    if (!spotPrice || !strikeGap) return 0;
    return Math.round(spotPrice / strikeGap) * strikeGap;
  }, [spotPrice, strikeGap]);

  // 2. Center 9 strikes around ATM (±4)
  const slicedStrikes = useMemo(() => {
    if (strikes.length === 0) return [];
    
    // Sort strikes in ascending order of strikePrice
    const sorted = [...strikes].sort((a, b) => a.strikePrice - b.strikePrice);
    
    // Find index of closest strike price to ATM strike
    let atmIndex = -1;
    let minDiff = Infinity;
    sorted.forEach((s, idx) => {
      const diff = Math.abs(s.strikePrice - atmStrike);
      if (diff < minDiff) {
        minDiff = diff;
        atmIndex = idx;
      }
    });

    if (atmIndex === -1) return [];

    // Slice 4 up, 4 down + ATM (total 9 strikes)
    const startIdx = Math.max(0, atmIndex - 4);
    const endIdx = Math.min(sorted.length - 1, atmIndex + 4);
    
    return sorted.slice(startIdx, endIdx + 1);
  }, [strikes, atmStrike]);

  // 3. Compute real-time institutional metrics
  const metrics = useMemo(() => {
    if (slicedStrikes.length === 0) {
      return {
        totalCallOI: 0,
        totalCallOIChange: 0,
        callPressure: 0,
        callMomentum: 0,
        callAvgPremiumChange: 0,
        callStrength: 0,
        totalPutOI: 0,
        totalPutOIChange: 0,
        putMomentum: 0,
        putAvgPremiumChange: 0,
        putStrength: 0,
        oiDifference: 0,
        pcr: 1.0,
      };
    }

    // Call Open Interest (expressed in Lakhs)
    const totalCallOI = slicedStrikes.reduce((sum, s) => sum + s.ceOI, 0) / 100000;
    const totalCallOIChange = slicedStrikes.reduce((sum, s) => sum + s.ceOIChange, 0) / 100000;

    // CALL Pressure Score = SUM(Call OI Change * Weightage)
    // where Weightage for strike i (i = -4 to +4 centered at ATM) is weight = 1.0 - (i * 0.2)
    // (i < 0 = lower strike, deep ITM = higher weight. i > 0 = higher strike, deep OTM = lower weight)
    let callPressure = 0;
    const atmIdxInSlice = slicedStrikes.findIndex(k => k.strikePrice === atmStrike);
    const effectiveAtmIdx = atmIdxInSlice !== -1 ? atmIdxInSlice : 4;
    
    slicedStrikes.forEach((s, index) => {
      const i = index - effectiveAtmIdx;
      const ceWeight = 1.0 - (i * 0.2);
      callPressure += (s.ceOIChange / 100000) * ceWeight;
    });

    // Call Momentum = (Call Buying - Call Selling)
    // - Call Buying = sum(CE Volume / 100000) for strikes where CE LTP change > 0
    // - Call Selling = sum(CE Volume / 100000) for strikes where CE LTP change < 0
    let callBuying = 0;
    let callSelling = 0;
    slicedStrikes.forEach(s => {
      const volLakhs = s.ceVolume / 100000;
      if (s.ceChg > 0) {
        callBuying += volLakhs;
      } else if (s.ceChg < 0) {
        callSelling += volLakhs;
      }
    });
    const callMomentum = callBuying - callSelling;

    // Call Average Premium Change = AVERAGE(Call Premium Change Range)
    const callAvgPremiumChange = slicedStrikes.reduce((sum, s) => sum + s.ceChg, 0) / slicedStrikes.length;

    // Call Strength Score = ABS(Call OI Change) + Volume Score
    const callVolumeScore = slicedStrikes.reduce((sum, s) => sum + s.ceVolume, 0) / 100000;
    const callStrength = Math.abs(totalCallOIChange) + callVolumeScore;

    // Put Open Interest (expressed in Lakhs)
    const totalPutOI = slicedStrikes.reduce((sum, s) => sum + s.peOI, 0) / 100000;
    const totalPutOIChange = slicedStrikes.reduce((sum, s) => sum + s.peOIChange, 0) / 100000;

    // Put Momentum = (Put Buying - Put Selling)
    // - Put Buying = sum(PE Volume / 100000) for strikes where PE LTP change > 0
    // - Put Selling = sum(PE Volume / 100000) for strikes where PE LTP change < 0
    let putBuying = 0;
    let putSelling = 0;
    slicedStrikes.forEach(s => {
      const volLakhs = s.peVolume / 100000;
      if (s.peChg > 0) {
        putBuying += volLakhs;
      } else if (s.peChg < 0) {
        putSelling += volLakhs;
      }
    });
    const putMomentum = putBuying - putSelling;

    // Put Average Premium Change = AVERAGE(Put Premium Change Range)
    const putAvgPremiumChange = slicedStrikes.reduce((sum, s) => sum + s.peChg, 0) / slicedStrikes.length;

    // Put Strength Score = ABS(Put OI Change) + Volume Score
    const putVolumeScore = slicedStrikes.reduce((sum, s) => sum + s.peVolume, 0) / 100000;
    const putStrength = Math.abs(totalPutOIChange) + putVolumeScore;

    // Sentiment Metrics
    // OI Difference Score = PUT Strength Score - CALL Strength Score
    const oiDifference = putStrength - callStrength;

    // Put-Call Ratio
    const rawTotalCallOI = slicedStrikes.reduce((sum, s) => sum + s.ceOI, 0);
    const rawTotalPutOI = slicedStrikes.reduce((sum, s) => sum + s.peOI, 0);
    const pcr = rawTotalCallOI > 0 ? rawTotalPutOI / rawTotalCallOI : 1.0;

    return {
      totalCallOI,
      totalCallOIChange,
      callPressure,
      callMomentum,
      callAvgPremiumChange,
      callStrength,
      totalPutOI,
      totalPutOIChange,
      putMomentum,
      putAvgPremiumChange,
      putStrength,
      oiDifference,
      pcr,
    };
  }, [slicedStrikes, atmStrike]);

  // Keep component mounted even when strikes is empty — overlay instead of early return
  const isEmptyStrikes = strikes.length === 0;

  return (
    <div className={`w-full flex flex-col gap-0.5 font-sans select-none border p-0.5 px-1.5 rounded-xl shadow-2xl relative overflow-hidden group transition-colors duration-300 ${
      darkMode ? "border-slate-800 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-900"
    }`}>
      {/* Loading overlay — keeps component mounted when strikes not yet loaded */}
      {isEmptyStrikes && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-xl pointer-events-none">
          <span className="font-mono text-xs uppercase tracking-wider text-slate-400 animate-pulse">Loading Option Summary…</span>
        </div>
      )}
      {/* Visual background terminal glow effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-rose-500/5 via-transparent to-emerald-500/5 pointer-events-none" />
      
      {/* Institutional Top Indicator Header */}
      <div className={`flex items-center justify-between pb-0.5 border-b relative z-10 ${
        darkMode ? "border-slate-800/80" : "border-slate-200"
      }`}>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-teal-500 animate-pulse" />
          <span className={`text-[9px] font-black uppercase tracking-widest ${
            darkMode ? "text-slate-400" : "text-slate-500"
          }`}>
            INSTITUTIONAL OPTION SUMMARY DECK
          </span>
        </div>
        <span className={`text-[8px] font-mono font-bold uppercase tracking-widest border px-2 py-0.2 rounded-full flex items-center gap-1 ${
          darkMode ? "text-teal-400 bg-slate-900 border-slate-800" : "text-teal-600 bg-slate-50 border-slate-200"
        }`}>
          <span className="w-1 h-1 rounded-full bg-emerald-500 animate-ping" />
          REALTIME
        </span>
      </div>

      {/* Grid: 3-column desktop layout, 2-column tablet adaptive layout, stack on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.2fr_0.6fr_1.2fr] gap-0 relative z-10">
        
        {/* LEFT COLUMN: CALL METRICS */}
        <CallMetrics
          totalCallOI={metrics.totalCallOI}
          totalCallOIChange={metrics.totalCallOIChange}
          callPressure={metrics.callPressure}
          callMomentum={metrics.callMomentum}
          callAvgPremiumChange={metrics.callAvgPremiumChange}
          callStrength={metrics.callStrength}
          darkMode={darkMode}
        />

        {/* CENTER COLUMN: MARKET SENTIMENT & BALANCE */}
        <SentimentMetrics
          atmStrike={atmStrike}
          oiDifference={metrics.oiDifference}
          pcr={metrics.pcr}
          callAvgPremiumChange={metrics.callAvgPremiumChange}
          putAvgPremiumChange={metrics.putAvgPremiumChange}
          callStrength={metrics.callStrength}
          putStrength={metrics.putStrength}
          darkMode={darkMode}
        />

        {/* RIGHT COLUMN: PUT METRICS */}
        <PutMetrics
          totalPutOI={metrics.totalPutOI}
          totalPutOIChange={metrics.totalPutOIChange}
          putMomentum={metrics.putMomentum}
          putAvgPremiumChange={metrics.putAvgPremiumChange}
          putStrength={metrics.putStrength}
          darkMode={darkMode}
        />
        
      </div>
    </div>
  );
}

export default React.memo(OptionChainSummary);
