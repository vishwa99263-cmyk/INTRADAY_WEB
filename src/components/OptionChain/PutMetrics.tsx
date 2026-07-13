import React from "react";
import { Award } from "lucide-react";

interface PutMetricsProps {
  totalPutOI: number;
  totalPutOIChange: number;
  putMomentum: number;
  putAvgPremiumChange: number;
  putStrength: number;
  darkMode?: boolean;
}

export default function PutMetrics({
  totalPutOI,
  totalPutOIChange,
  putMomentum,
  putAvgPremiumChange,
  putStrength,
  darkMode = false,
}: PutMetricsProps) {
  
  // PUT Momentum Score Color Logic:
  // - Green if bullish support building (positive momentum, meaning Put premium is rising or Put buying is active)
  // - Red if weakening support (negative momentum)
  const isBullishSupport = putMomentum < 0;

  // OI Change Color Logic
  const oiChgColor = totalPutOIChange >= 0 
    ? (darkMode ? "text-emerald-400" : "text-emerald-600") 
    : (darkMode ? "text-rose-400" : "text-rose-600");

  return (
    <div className={`relative flex flex-col gap-[2px] p-1 pt-1.5 rounded-xl border flex-1 transition-all duration-300 group ${
      darkMode 
        ? "bg-gradient-to-b from-slate-950/85 via-slate-900/50 to-slate-950/90 border-slate-800/80 text-white shadow-[0_4px_24px_rgba(0,0,0,0.5)] hover:border-slate-700/50" 
        : "bg-gradient-to-b from-slate-50/95 via-slate-100/90 to-slate-200/95 border-slate-200 text-slate-900 shadow-[0_4px_24px_rgba(0,0,0,0.06)] hover:border-slate-350"
    }`}>
      {/* Premium Green Top Accent Bar */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-emerald-600/80 via-teal-500/90 to-emerald-500/70 rounded-t-xl shadow-[0_1px_8px_rgba(16,185,129,0.4)]" />

      {/* Section Header */}
      <div className={`flex items-center justify-between pb-0.5 relative z-10 ${
        darkMode ? "border-slate-800/80" : "border-slate-200"
      }`}>
        <span className="text-[10px] font-black text-emerald-500 tracking-widest uppercase flex items-center gap-1 animate-pulse-slow">
          <Award size={12} className="text-emerald-500" />
          PUT METRICS (PE)
        </span>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span className={`text-[9px] font-mono font-bold uppercase tracking-widest border px-1.5 py-0.2 rounded ${
            darkMode ? "bg-slate-900 border-slate-800/80 text-slate-400" : "bg-white border-slate-200 text-slate-600"
          }`}>
            PE DATA
          </span>
        </div>
      </div>

      {/* Grid of Main Metrics */}
      <div className="grid grid-cols-2 gap-[1px] relative z-10">
        {/* Total PUT Open Interest */}
        <div className={`p-1 rounded-lg border transition-all duration-300 flex flex-col justify-between ${
          darkMode 
            ? "bg-slate-950/65 border-slate-900/90 hover:border-slate-800 shadow-[inset_0_1.5px_4px_rgba(0,0,0,0.6)]" 
            : "bg-white/80 border-slate-200 hover:border-slate-355 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
        }`}>
          <span className="text-[8.5px] font-black text-slate-500 uppercase tracking-wide block">Total OI</span>
          <span className="font-mono mt-0.5 block text-amber-500 dark:text-yellow-400 drop-shadow-[0_0_3px_rgba(234,179,8,0.2)]">
            <span className="text-[9.5px] font-black mr-0.5 opacity-75">OI</span>
            <span className="text-[13px] md:text-[14px] font-black">+{totalPutOI.toFixed(2)}L</span>
          </span>
        </div>

        {/* Total PUT OI Change */}
        <div className={`p-1 rounded-lg border transition-all duration-300 flex flex-col justify-between ${
          darkMode 
            ? "bg-slate-950/65 border-slate-900/90 hover:border-slate-800 shadow-[inset_0_1.5px_4px_rgba(0,0,0,0.6)]" 
            : "bg-white/80 border-slate-200 hover:border-slate-355 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
        }`}>
          <span className="text-[8.5px] font-black text-slate-500 uppercase tracking-wide block">OI Change</span>
          <div className="flex items-baseline justify-between w-full mt-0.5">
            <span className="text-[13px] md:text-[14px] font-black font-mono text-amber-500 dark:text-yellow-400 drop-shadow-[0_0_3px_rgba(234,179,8,0.2)]">
              {totalPutOIChange.toFixed(3)}L
            </span>
            <span className={`text-[8.5px] font-bold px-1 py-0.2 rounded scale-90 ${
              totalPutOIChange >= 0 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
            }`}>
              {totalPutOIChange >= 0 ? "▲" : "▼"}
            </span>
          </div>
        </div>
      </div>

      {/* PUT Momentum Score (Hedge Support Indicator) */}
      <div className={`p-1 rounded-lg border transition-all duration-300 flex flex-col relative z-10 border-l-[3px] ${
        isBullishSupport 
          ? darkMode
            ? "bg-gradient-to-r from-emerald-950/20 via-emerald-900/10 to-transparent border-emerald-500/25 border-l-emerald-500 text-emerald-400 shadow-[0_2px_10px_rgba(16,185,129,0.06)]"
            : "bg-gradient-to-r from-emerald-50/70 via-emerald-100/30 to-transparent border-emerald-200 border-l-emerald-500 text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.04)]"
          : darkMode
            ? "bg-gradient-to-r from-red-950/20 via-red-900/10 to-transparent border-red-500/25 border-l-red-500 text-red-400 shadow-[0_2px_10px_rgba(239,68,68,0.06)]"
            : "bg-gradient-to-r from-red-50/70 via-red-100/30 to-transparent border-red-200 border-l-red-500 text-red-700 shadow-[0_2px_8px_rgba(239,68,68,0.04)]"
      }`}>
        <div className="flex justify-between items-center">
          <span className={`text-[8.5px] font-black uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>PUT Momentum Score</span>
          <span className={`text-[8px] font-mono px-1 py-0.2 rounded font-black border uppercase tracking-wider scale-90 origin-right ${
            isBullishSupport
              ? darkMode
                ? "bg-emerald-950/80 border-emerald-800/60 text-emerald-300"
                : "bg-emerald-50 border-emerald-200 text-emerald-700"
              : darkMode
                ? "bg-red-950/80 border-red-800/60 text-red-300"
                : "bg-red-50 border-red-200 text-red-700"
          }`}>
            {isBullishSupport ? "BULL SUPPORT" : "WEAK SUPPORT"}
          </span>
        </div>
        <span className={`text-[17px] font-black font-mono tracking-tight mt-0.5 ${
          isBullishSupport 
            ? (darkMode ? "text-emerald-400" : "text-emerald-600") 
            : (darkMode ? "text-red-400" : "text-red-600")
        }`}>
          {putMomentum > 0 ? "+" : ""}{putMomentum.toFixed(2)}
        </span>
      </div>

      {/* Grid of Secondary Metrics */}
      <div className="grid grid-cols-3 gap-[1px] relative z-10">
        {/* PUT Momentum */}
        <div className={`p-1 rounded-lg border flex flex-col justify-between h-[42px] transition-colors shadow-sm ${
          darkMode 
            ? "bg-slate-950/35 border-slate-900 hover:border-slate-800 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]" 
            : "bg-white/80 border-slate-200 hover:border-slate-350 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
        }`}>
          <span className={`text-[8.5px] font-black uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Momentum</span>
          <span className="text-[12px] md:text-[13px] font-black font-mono truncate text-amber-500 dark:text-yellow-400 drop-shadow-[0_0_3px_rgba(234,179,8,0.2)]">
            {putMomentum >= 0 ? "+" : ""}{putMomentum.toFixed(2)}
          </span>
        </div>

        {/* PUT Avg Premium Change */}
        <div className={`p-1 rounded-lg border flex flex-col justify-between h-[42px] transition-colors shadow-sm ${
          darkMode 
            ? "bg-slate-950/35 border-slate-900 hover:border-slate-800 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]" 
            : "bg-white/80 border-slate-200 hover:border-slate-350 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
        }`}>
          <span className={`text-[8.5px] font-black uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Avg Prem</span>
          <span className="text-[12px] md:text-[13px] font-black font-mono truncate text-amber-500 dark:text-yellow-400 drop-shadow-[0_0_3px_rgba(234,179,8,0.2)]">
            {putAvgPremiumChange >= 0 ? "+" : ""}{putAvgPremiumChange.toFixed(2)}%
          </span>
        </div>

        {/* PUT Strength Score */}
        <div className={`p-1 rounded-lg border flex flex-col justify-between h-[42px] transition-colors shadow-sm ${
          darkMode 
            ? "bg-slate-950/35 border-slate-900 hover:border-slate-800 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]" 
            : "bg-white/80 border-slate-200 hover:border-slate-350 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]"
        }`}>
          <span className={`text-[8.5px] font-black uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Strength</span>
          <span className="text-[12px] md:text-[13px] font-black font-mono truncate text-amber-500 dark:text-yellow-400 drop-shadow-[0_0_3px_rgba(234,179,8,0.2)]">
            {putStrength.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}
