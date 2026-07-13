import React from "react";
import { Compass, Activity, Shield, TrendingUp, TrendingDown } from "lucide-react";

interface SentimentMetricsProps {
  atmStrike: number;
  oiDifference: number;
  pcr: number;
  callAvgPremiumChange: number;
  putAvgPremiumChange: number;
  callStrength: number;
  putStrength: number;
  darkMode?: boolean;
}

export default function SentimentMetrics({
  atmStrike,
  oiDifference,
  pcr,
  callAvgPremiumChange,
  putAvgPremiumChange,
  callStrength,
  putStrength,
  darkMode = false,
}: SentimentMetricsProps) {
  
  // Advanced OI Difference Score Color Logic & Dominance Classification:
  const isCallDominant = callStrength > putStrength;
  
  let dominationText = "";
  let differenceColor = "";
  let sideLabel = "";

  const greenColor = "bg-green-800 dark:bg-green-950 border border-green-700/50 shadow-[0_0_12px_rgba(22,163,74,0.2)] text-white";
  const redColor = "bg-red-800 dark:bg-red-950 border border-red-700/50 shadow-[0_0_12px_rgba(220,38,38,0.2)] text-white";

  if (isCallDominant) {
    const isCeBuy = callAvgPremiumChange > 0;
    dominationText = isCeBuy ? "CE BUY SIDE (BULLISH)" : "PE BUY SIDE (BEARISH)";
    sideLabel = isCeBuy ? "CE Buy" : "PE Buy";
    differenceColor = isCeBuy ? greenColor : redColor;
  } else {
    const isPeBuy = putAvgPremiumChange > 0;
    dominationText = isPeBuy ? "PE BUY SIDE (BEARISH)" : "CE BUY SIDE (BULLISH)";
    sideLabel = isPeBuy ? "PE Buy" : "CE Buy";
    differenceColor = isPeBuy ? redColor : greenColor;
  }

  // Sentiment Classification
  const sentiment = pcr > 1.35 
    ? { label: "STRONG BULLISH", color: "text-emerald-400 bg-emerald-950/40 border-emerald-800" }
    : pcr > 1.05 
    ? { label: "BULLISH", color: "text-teal-400 bg-teal-950/20 border-teal-900" }
    : pcr > 0.90 
    ? { label: "NEUTRAL", color: "text-slate-400 bg-slate-900/40 border-slate-800" }
    : pcr > 0.65 
    ? { label: "BEARISH", color: "text-rose-400 bg-rose-950/20 border-rose-900" }
    : { label: "STRONG BEARISH", color: "text-red-400 bg-red-950/40 border-red-800" };

  return (
    <div className={`relative flex flex-col gap-[2px] p-1 pt-1.5 rounded-xl border flex-1 transition-all duration-300 group ${
      darkMode 
        ? "bg-gradient-to-b from-slate-950/85 via-slate-900/50 to-slate-950/90 border-slate-800/80 text-white shadow-[0_4px_24px_rgba(0,0,0,0.5)] hover:border-slate-700/50" 
        : "bg-gradient-to-b from-slate-50/95 via-slate-100/90 to-slate-200/95 border-slate-200 text-slate-900 shadow-[0_4px_24px_rgba(0,0,0,0.06)] hover:border-slate-350"
    }`}>
      {/* Premium Gold Top Accent Bar */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-400 rounded-t-xl shadow-[0_1px_8px_rgba(234,179,8,0.4)]" />

      {/* Section Header */}
      <div className={`flex items-center justify-between pb-0.5 relative z-10 ${
        darkMode ? "border-slate-800/80" : "border-slate-200"
      }`}>
        <span className={`text-[8.5px] font-black tracking-wider uppercase flex items-center gap-1 whitespace-nowrap ${
          darkMode ? "text-teal-400" : "text-teal-650"
        }`}>
          <Compass size={10} className="animate-spin-slow" />
          SENTIMENT & BALANCE
        </span>
        <div className="flex items-center gap-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
          <span className={`text-[7.5px] font-mono font-bold uppercase tracking-wider border px-1 py-0.1 rounded ${
            darkMode ? "bg-slate-900 border-slate-800/80 text-slate-400" : "bg-white border-slate-200 text-slate-600"
          }`}>
            METRICS
          </span>
        </div>
      </div>

      {/* ATM Strike Indicator */}
      <div className={`p-0.5 px-1.5 rounded-lg border transition-all duration-300 flex items-center justify-between relative z-10 ${
        darkMode 
          ? "bg-slate-950/65 border-slate-900/90 hover:border-slate-800 shadow-[inset_0_1.5px_4px_rgba(0,0,0,0.6)]" 
          : "bg-white/80 border-slate-200 hover:border-slate-300 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-[8.5px] font-black text-slate-500 uppercase tracking-wide">ATM</span>
          <span className="text-[9px] font-black text-slate-400 dark:text-slate-600">—</span>
          <span className="text-[13px] md:text-[14px] font-black font-mono text-yellow-500 dark:text-yellow-455 drop-shadow-[0_0_3px_rgba(234,179,8,0.25)]">
            {atmStrike.toLocaleString()}
          </span>
        </div>
        <div className={`p-0.5 rounded border scale-90 ${
          darkMode ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" : "bg-yellow-55 text-yellow-600 border-yellow-200"
        }`}>
          <Activity size={10} className="animate-pulse" />
        </div>
      </div>

      {/* OI Difference Score (Dominance Bar) */}
      <div className={`p-1 px-1.5 rounded-lg border flex flex-col transition-all duration-300 relative z-10 border-l-[4px] border-l-white/60 ${differenceColor}`}>
        <div className="flex justify-between items-center">
          <span className="text-[8.5px] font-black uppercase tracking-wide opacity-85 text-white/90">OI Def. Score</span>
          <span className="text-[10px] font-mono font-black px-1.5 py-0.2 rounded bg-black/60 border border-white/10 text-white uppercase origin-right shadow-sm scale-90">
            {sideLabel}
          </span>
        </div>
        <span className="text-[17px] font-black font-mono tracking-tight mt-0.5 text-white text-center">
          {oiDifference >= 0 ? "+" : ""}{oiDifference.toFixed(2)}
        </span>
        <span className="text-[10px] md:text-[11.5px] leading-snug font-black uppercase tracking-wide mt-0.5 block text-yellow-300 drop-shadow-[0_2px_5px_rgba(0,0,0,0.7)] text-center whitespace-nowrap">
          {dominationText}
        </span>
      </div>

      {/* PCR & Bias Deck */}
      <div className="grid grid-cols-2 gap-[1px] text-xs relative z-10">
        {/* PCR */}
        <div className={`p-1 rounded-lg border flex flex-col justify-between h-[42px] transition-colors shadow-sm ${
          darkMode 
            ? "bg-slate-950/35 border-slate-900 hover:border-slate-800 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]" 
            : "bg-white/80 border-slate-200 hover:border-slate-300 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
        }`}>
          <span className={`text-[8.5px] font-black uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>PCR Ratio</span>
          <span className="text-[12px] md:text-[13px] font-black font-mono text-amber-500 dark:text-yellow-400 drop-shadow-[0_0_3px_rgba(234,179,8,0.2)] mt-0.5">
            {pcr.toFixed(3)}
          </span>
        </div>

        {/* Bias classification */}
        <div className={`p-1 rounded-lg border flex flex-col justify-between h-[42px] transition-colors shadow-sm ${
          darkMode 
            ? "bg-slate-950/35 border-slate-900 hover:border-slate-800 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]" 
            : "bg-white/80 border-slate-200 hover:border-slate-350 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
        }`}>
          <span className={`text-[8.5px] font-black uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Trend Bias</span>
          <span className="text-[9.5px] font-black text-center py-0.5 px-1 rounded truncate border bg-black border-yellow-500/30 text-yellow-400 max-w-[105px] mt-0.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)]">
            {sentiment.label}
          </span>
        </div>
      </div>
    </div>
  );
}
