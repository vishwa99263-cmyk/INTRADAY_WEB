import React from "react";

interface CallMetricsProps {
  totalCallOI: number;
  totalCallOIChange: number;
  callPressure: number;
  callMomentum: number;
  callAvgPremiumChange: number;
  callStrength: number;
  darkMode?: boolean;
}

export default function CallMetrics({
  totalCallOI,
  totalCallOIChange,
  callPressure,
  callMomentum,
  callAvgPremiumChange,
  callStrength,
  darkMode = false,
}: CallMetricsProps) {
  const isBearish = callPressure > 0;
  const pressurePct = Math.min(100, Math.max(5, (Math.abs(callPressure) / 500) * 100));

  return (
    <div className={`relative flex flex-col justify-between h-full p-1.5 px-2 rounded-xl border transition-all duration-300 min-w-0 ${
      darkMode 
        ? "bg-slate-950/90 border-emerald-500/30 text-white shadow-[0_2px_12px_rgba(16,185,129,0.06)] hover:border-emerald-500/50" 
        : "bg-emerald-50/40 border-emerald-200 text-slate-900 shadow-sm"
    }`}>
      {/* Top Accent Neon Line */}
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 rounded-t-xl shadow-[0_0_10px_rgba(16,185,129,0.8)]" />

      {/* Header Strip */}
      <div className="flex items-center justify-between min-w-0 pb-1 border-b border-emerald-500/25">
        <div className="flex items-center gap-1.5 truncate">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 truncate">
            CALL METRICS (CE)
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[7.5px] font-bold px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 uppercase">BUYER FLOW</span>
          <span className={`text-[7.5px] font-mono font-black uppercase px-1.5 py-0.2 rounded border truncate ${
            isBearish
              ? "text-rose-300 bg-rose-950/70 border-rose-700/50 shadow-[0_0_8px_rgba(244,63,94,0.3)]"
              : "text-emerald-300 bg-emerald-950/70 border-emerald-700/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
          }`}>
            {isBearish ? "BEAR DOM" : "SHORT COV"}
          </span>
        </div>
      </div>

      {/* Row 1: Total OI & OI Change & Pressure Score */}
      <div className="grid grid-cols-2 gap-1.5 my-1">
        {/* Total Call OI & Big OI Change */}
        <div className={`p-1.5 rounded-lg border flex items-center justify-between min-w-0 ${
          darkMode ? "bg-slate-900/70 border-slate-800/90 shadow-inner" : "bg-white border-emerald-100"
        }`}>
          <div className="flex flex-col min-w-0">
            <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">TOTAL CE OI</span>
            <span className="font-mono text-[14px] font-black text-emerald-400 truncate leading-tight drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]">
              +{totalCallOI.toFixed(2)}L
            </span>
          </div>

          {/* SECOND DATA: OI CHG */}
          <div className="flex flex-col items-end min-w-0">
            <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">OI CHG</span>
            <span className={`font-mono text-[11.5px] font-black leading-tight ${
              totalCallOIChange >= 0 ? "text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.4)]"
            }`}>
              {totalCallOIChange >= 0 ? "+" : ""}{totalCallOIChange.toFixed(2)}L {totalCallOIChange >= 0 ? "▲" : "▼"}
            </span>
          </div>
        </div>

        {/* Call Pressure Score */}
        <div className={`p-1.5 rounded-lg border flex flex-col justify-center min-w-0 ${
          isBearish
            ? darkMode ? "bg-gradient-to-r from-rose-950/40 to-slate-900/80 border-rose-800/50 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.15)]" : "bg-rose-50 border-rose-200"
            : darkMode ? "bg-gradient-to-r from-emerald-950/40 to-slate-900/80 border-emerald-800/50 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]" : "bg-emerald-50 border-emerald-200"
        }`}>
          <div className="flex items-center justify-between text-[7px] font-black uppercase">
            <span className="text-slate-400">PRESSURE SCORE</span>
            <span className={`text-[6.5px] font-mono font-bold ${isBearish ? "text-rose-400" : "text-emerald-400"}`}>
              {isBearish ? "CALL SHORT" : "CALL BUYING"}
            </span>
          </div>
          <div className="flex items-baseline justify-end min-w-0 my-0.5">
            <span className={`font-mono text-[15px] font-black leading-tight text-right ${isBearish ? "text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]" : "text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]"}`}>
              {callPressure > 0 ? "+" : ""}{callPressure.toFixed(2)}
            </span>
          </div>
          <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800/60 p-[0.5px]">
            <div className={`h-full rounded-full transition-all duration-500 ${isBearish ? "bg-gradient-to-r from-rose-500 to-red-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]" : "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]"}`} style={{ width: `${pressurePct}%` }} />
          </div>
        </div>
      </div>

      {/* Row 2: MOM, AVG PREM, STRENGTH */}
      <div className={`grid grid-cols-3 gap-1.5 p-1.5 rounded-lg border text-center ${
        darkMode ? "bg-slate-900/60 border-slate-800/80 shadow-sm" : "bg-white border-emerald-100"
      }`}>
        <div className="flex flex-col">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">MOM</span>
          <span className="font-mono text-[11.5px] font-black text-amber-400 leading-tight drop-shadow-[0_0_6px_rgba(245,158,11,0.3)]">
            {callMomentum >= 0 ? "+" : ""}{callMomentum.toFixed(1)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">AVG PREM</span>
          <span className={`font-mono text-[11.5px] font-black leading-tight ${callAvgPremiumChange >= 0 ? "text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.3)]" : "text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.3)]"}`}>
            {callAvgPremiumChange >= 0 ? "+" : ""}{callAvgPremiumChange.toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-tight">STRENGTH</span>
          <span className="font-mono text-[11.5px] font-black text-cyan-400 leading-tight drop-shadow-[0_0_6px_rgba(34,211,238,0.3)]">
            {callStrength.toFixed(0)}
          </span>
        </div>
      </div>
    </div>
  );
}
