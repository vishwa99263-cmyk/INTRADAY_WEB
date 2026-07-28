import React from "react";

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
  const isBullishSupport = putMomentum < 0;
  const momentumPct = Math.min(100, Math.max(5, (Math.abs(putMomentum) / 500) * 100));

  return (
    <div className={`relative flex flex-col justify-between h-full p-1.5 px-2 rounded-xl border transition-all duration-300 min-w-0 ${
      darkMode 
        ? "bg-slate-950/90 border-rose-500/30 text-white shadow-[0_2px_12px_rgba(244,63,94,0.06)] hover:border-rose-500/50" 
        : "bg-rose-50/40 border-rose-200 text-slate-900 shadow-sm"
    }`}>
      {/* Top Accent Neon Line */}
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-rose-500 via-pink-400 to-red-600 rounded-t-xl shadow-[0_0_10px_rgba(244,63,94,0.8)]" />

      {/* Header Strip */}
      <div className="flex items-center justify-between min-w-0 pb-1 border-b border-rose-500/25">
        <div className="flex items-center gap-1.5 truncate">
          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse flex-shrink-0 shadow-[0_0_8px_rgba(244,63,94,0.9)]" />
          <span className="text-[10px] font-black uppercase tracking-wider text-rose-400 truncate">
            PUT METRICS (PE)
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[7.5px] font-bold px-1.5 py-0.2 rounded bg-rose-950/80 text-rose-300 border border-rose-500/40 uppercase">BUYER FLOW</span>
          <span className={`text-[7.5px] font-mono font-black uppercase px-1.5 py-0.2 rounded border truncate ${
            isBullishSupport
              ? "text-emerald-300 bg-emerald-950/70 border-emerald-700/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
              : "text-rose-300 bg-rose-950/70 border-rose-700/50 shadow-[0_0_8px_rgba(244,63,94,0.3)]"
          }`}>
            {isBullishSupport ? "BULL SUPP" : "WEAK SUPP"}
          </span>
        </div>
      </div>

      {/* Row 1: Total OI & OI Change & Momentum Score */}
      <div className="grid grid-cols-2 gap-1.5 my-1">
        {/* Total Put OI & Big OI Change */}
        <div className={`p-1.5 rounded-lg border flex items-center justify-between min-w-0 ${
          darkMode ? "bg-slate-900/70 border-slate-800/90 shadow-inner" : "bg-white border-rose-100"
        }`}>
          <div className="flex flex-col min-w-0">
            <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">TOTAL PE OI</span>
            <span className="font-mono text-[14px] font-black text-rose-400 truncate leading-tight drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]">
              +{totalPutOI.toFixed(2)}L
            </span>
          </div>

          {/* SECOND DATA: OI CHG */}
          <div className="flex flex-col items-end min-w-0">
            <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">OI CHG</span>
            <span className={`font-mono text-[11.5px] font-black leading-tight ${
              totalPutOIChange >= 0 ? "text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.4)]" : "text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]"
            }`}>
              {totalPutOIChange >= 0 ? "+" : ""}{totalPutOIChange.toFixed(2)}L {totalPutOIChange >= 0 ? "▲" : "▼"}
            </span>
          </div>
        </div>

        {/* Put Momentum Score */}
        <div className={`p-1.5 rounded-lg border flex flex-col justify-center min-w-0 ${
          isBullishSupport
            ? darkMode ? "bg-gradient-to-r from-emerald-950/40 to-slate-900/80 border-emerald-800/50 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]" : "bg-emerald-50 border-emerald-200"
            : darkMode ? "bg-gradient-to-r from-rose-950/40 to-slate-900/80 border-rose-800/50 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.15)]" : "bg-rose-50 border-rose-200"
        }`}>
          <div className="flex items-center justify-between text-[7px] font-black uppercase">
            <span className="text-slate-400">MOMENTUM SCORE</span>
            <span className={`text-[6.5px] font-mono font-bold ${isBullishSupport ? "text-emerald-400" : "text-rose-400"}`}>
              {isBullishSupport ? "PUT DECAY" : "PUT BUYING"}
            </span>
          </div>
          <div className="flex items-baseline justify-end min-w-0 my-0.5">
            <span className={`font-mono text-[15px] font-black leading-tight text-right ${isBullishSupport ? "text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]"}`}>
              {putMomentum > 0 ? "+" : ""}{putMomentum.toFixed(2)}
            </span>
          </div>
          <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800/60 p-[0.5px]">
            <div className={`h-full rounded-full transition-all duration-500 ${isBullishSupport ? "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]" : "bg-gradient-to-r from-rose-500 to-red-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]"}`} style={{ width: `${momentumPct}%` }} />
          </div>
        </div>
      </div>

      {/* Row 2: MOM, AVG PREM, STRENGTH */}
      <div className={`grid grid-cols-3 gap-1.5 p-1.5 rounded-lg border text-center ${
        darkMode ? "bg-slate-900/60 border-slate-800/80 shadow-sm" : "bg-white border-rose-100"
      }`}>
        <div className="flex flex-col">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">MOM</span>
          <span className="font-mono text-[11.5px] font-black text-amber-400 leading-tight drop-shadow-[0_0_6px_rgba(245,158,11,0.3)]">
            {putMomentum >= 0 ? "+" : ""}{putMomentum.toFixed(1)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">AVG PREM</span>
          <span className={`font-mono text-[11.5px] font-black leading-tight ${putAvgPremiumChange >= 0 ? "text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.3)]" : "text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.3)]"}`}>
            {putAvgPremiumChange >= 0 ? "+" : ""}{putAvgPremiumChange.toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">STRENGTH</span>
          <span className="font-mono text-[11.5px] font-black text-cyan-400 leading-tight drop-shadow-[0_0_6px_rgba(34,211,238,0.3)]">
            {putStrength.toFixed(0)}
          </span>
        </div>
      </div>
    </div>
  );
}
