import React, { useMemo } from "react";
import { ShieldAlert, Award, TrendingUp, Compass } from "lucide-react";
import { OptionStrike } from "../types.js";

interface OptionAnalyticsBoxProps {
  strikes: OptionStrike[];
  spotPrice: number;
  strikeGap: number;
}

export default function OptionAnalyticsBox({ strikes, spotPrice, strikeGap }: OptionAnalyticsBoxProps) {
  // Calculate ATM Strike
  const atm = useMemo(() => {
    if (strikes.length === 0 || !spotPrice || !strikeGap) return 0;
    return Math.round(spotPrice / strikeGap) * strikeGap;
  }, [strikes, spotPrice, strikeGap]);

  // Resistance = CE Highest OI
  const resistanceData = useMemo(() => {
    if (strikes.length === 0) return { r1: 0, r2: 0, strength: 100 };
    const ceOIs = strikes.map(s => s.ceOI);
    const maxCeOI = Math.max(...ceOIs);
    const secondMaxCeOI = Math.max(...ceOIs.filter(oi => oi !== maxCeOI));
    const r1 = strikes.find(s => s.ceOI === maxCeOI)?.strikePrice || atm;
    const r2 = strikes.find(s => s.ceOI === secondMaxCeOI)?.strikePrice || atm;
    const strength = maxCeOI ? parseFloat((((maxCeOI - secondMaxCeOI) / maxCeOI) * 100).toFixed(2)) : 100;
    return { r1, r2, strength };
  }, [strikes, atm]);

  // Support = PE Highest OI
  const supportData = useMemo(() => {
    if (strikes.length === 0) return { s1: 0, s2: 0, strength: 100 };
    const peOIs = strikes.map(s => s.peOI);
    const maxPeOI = Math.max(...peOIs);
    const secondMaxPeOI = Math.max(...peOIs.filter(oi => oi !== maxPeOI));
    const s1 = strikes.find(s => s.peOI === maxPeOI)?.strikePrice || atm;
    const s2 = strikes.find(s => s.peOI === secondMaxPeOI)?.strikePrice || atm;
    const strength = maxPeOI ? parseFloat((((maxPeOI - secondMaxPeOI) / maxPeOI) * 100).toFixed(2)) : 100;
    return { s1, s2, strength };
  }, [strikes, atm]);

  // Core Open Interest aggregates & PCR
  const pcrData = useMemo(() => {
    if (strikes.length === 0) return { pcr: 1.0, totalPutOI: 0, totalCallOI: 0 };
    const totalCallOI = strikes.reduce((acc, curr) => acc + curr.ceOI, 0);
    const totalPutOI = strikes.reduce((acc, curr) => acc + curr.peOI, 0);
    const totalOI = totalCallOI + totalPutOI;
    const pcr = totalOI ? parseFloat((totalPutOI / totalCallOI).toFixed(3)) : 1.0;
    return { pcr, totalPutOI, totalCallOI };
  }, [strikes]);

  const formatLakh = (n: number) => {
    return (n / 100000).toFixed(2) + "L";
  };

  // Sentiment analysis
  const sentiment = pcrData.pcr > 1.25 ? "Strongly Bullish" : pcrData.pcr > 1.0 ? "Bullish" : pcrData.pcr > 0.85 ? "Neutral" : pcrData.pcr > 0.6 ? "Bearish" : "Strongly Bearish";
  const sentimentColor = pcrData.pcr > 1.0 ? "text-emerald-400 font-bold" : pcrData.pcr > 0.85 ? "text-yellow-400 font-semibold" : "text-red-400 font-bold";

  return (
    <div className="flex flex-col gap-2.5 p-3 rounded-2xl border border-slate-850 bg-slate-950/95 text-slate-100 shadow-xl backdrop-blur-md">
      {/* Title */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-350">
            Option Analytics Box
          </span>
        </div>
      </div>

      {/* Top Row: Resistance & Support */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Resistance */}
        <div className="flex flex-col gap-1.5 p-2 rounded-xl border border-red-950/30 bg-red-950/15 shadow-[0_0_10px_rgba(239,68,68,0.03)]">
          <div className="flex items-center gap-1.5 text-[9px] md:text-[10px] font-black text-red-400">
            <ShieldAlert size={12} className="animate-pulse" />
            RESISTANCE WALL
          </div>
          <div className="grid grid-cols-2 gap-1 text-[9.5px] font-mono mt-0.5">
            <div className="flex flex-col">
              <span className="opacity-75 text-slate-400">R1 (Primary):</span>
              <span className="text-xs font-black text-red-400">{resistanceData.r1}</span>
            </div>
            <div className="flex flex-col">
              <span className="opacity-75 text-slate-400">R2 (Sec):</span>
              <span className="text-xs font-black text-red-500/70">{resistanceData.r2}</span>
            </div>
          </div>
          <div className="flex justify-between items-center text-[9px] font-bold mt-1 pt-1.5 border-t border-slate-800/60 text-slate-350">
            <span>Strength:</span>
            <span className="font-black font-mono text-red-400">{resistanceData.strength}%</span>
          </div>
        </div>

        {/* Support */}
        <div className="flex flex-col gap-1.5 p-2 rounded-xl border border-emerald-950/30 bg-emerald-955/15 shadow-[0_0_10px_rgba(16,185,129,0.03)]">
          <div className="flex items-center gap-1.5 text-[9px] md:text-[10px] font-black text-emerald-400">
            <Award size={12} className="animate-pulse" />
            SUPPORT WALL
          </div>
          <div className="grid grid-cols-2 gap-1 text-[9.5px] font-mono mt-0.5">
            <div className="flex flex-col">
              <span className="opacity-75 text-slate-400">S1 (Primary):</span>
              <span className="text-xs font-black text-emerald-400">{supportData.s1}</span>
            </div>
            <div className="flex flex-col">
              <span className="opacity-75 text-slate-400">S2 (Sec):</span>
              <span className="text-xs font-black text-emerald-500/75">{supportData.s2}</span>
            </div>
          </div>
          <div className="flex justify-between items-center text-[9px] font-bold mt-1 pt-1.5 border-t border-slate-800/60 text-slate-350">
            <span>Strength:</span>
            <span className="font-black font-mono text-emerald-400">{supportData.strength}%</span>
          </div>
        </div>
      </div>

      {/* Bottom Row: PCR & Live Sentiment */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* PCR */}
        <div className="flex flex-col gap-1.5 p-2 rounded-xl border border-slate-800 bg-slate-900/20 justify-between">
          <div>
            <div className="text-[9px] md:text-[10px] font-black text-slate-400">
              PUT CALL RATIO (PCR)
            </div>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-black font-mono text-slate-200">{pcrData.pcr}</span>
              <span className="text-[7.5px] text-slate-500">({formatLakh(pcrData.totalPutOI)}/{formatLakh(pcrData.totalCallOI)})</span>
            </div>
          </div>
          <div className="text-[9px] font-bold flex justify-between items-center border-t border-slate-800/60 pt-1 text-slate-450">
            <span>Bias:</span>
            <span className="font-extrabold text-slate-350">{pcrData.pcr > 1 ? "Put Dom" : "Call Dom"}</span>
          </div>
        </div>

        {/* Live Sentiment */}
        <div className="flex flex-col gap-1.5 p-2 rounded-xl border border-slate-800 bg-slate-900/20 justify-between">
          <div>
            <div className="flex items-center gap-1 text-[9px] md:text-[10px] font-black text-slate-400">
              <Compass size={11} className="text-slate-400 animate-pulse" />
              LIVE SENTIMENT
            </div>
            <div className="text-xs font-black mt-0.5">
              <span className={`${sentimentColor} animate-pulse`}>{sentiment}</span>
            </div>
          </div>
          <div className="text-[7.5px] text-slate-500 leading-tight">
            *Real-time OI bias.
          </div>
        </div>
      </div>
    </div>
  );
}
