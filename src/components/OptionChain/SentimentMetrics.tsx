import React from "react";
import { Zap, TrendingUp, TrendingDown } from "lucide-react";

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
  const isCallDominant = callStrength > putStrength;
  let sideLabel = "";
  let dominationText = "";

  if (isCallDominant) {
    const isCeBuy = callAvgPremiumChange > 0;
    sideLabel     = isCeBuy ? "CE BUY" : "PE BUY";
    dominationText = isCeBuy ? "BULLISH" : "BEARISH";
  } else {
    const isPeBuy = putAvgPremiumChange > 0;
    sideLabel     = isPeBuy ? "PE BUY" : "CE BUY";
    dominationText = isPeBuy ? "BEARISH" : "BULLISH";
  }

  const isCeBuySignal = sideLabel === "CE BUY";

  const sentiment =
    pcr > 1.35 ? { label: "STRONG BULL", color: "text-emerald-400 bg-emerald-950/70 border-emerald-500/50" }
    : pcr > 1.05 ? { label: "BULLISH",   color: "text-teal-300 bg-teal-950/50 border-teal-500/40" }
    : pcr > 0.9  ? { label: "NEUTRAL",   color: "text-slate-300 bg-slate-900/60 border-slate-600/40" }
    : pcr > 0.65 ? { label: "BEARISH",   color: "text-rose-400 bg-rose-950/60 border-rose-500/40" }
    :              { label: "STRONG BEAR",color: "text-red-400 bg-red-950/70 border-red-500/50" };

  const totalPower = putStrength + callStrength;
  const pePercent  = totalPower > 0 ? Math.min(92, Math.max(8, (putStrength / totalPower) * 100)) : 50;

  return (
    <div className={`relative flex flex-col justify-between h-full p-1.5 px-2 rounded-xl border transition-all duration-300 min-w-0 ${
      darkMode 
        ? "bg-slate-950/95 border-cyan-500/30 text-white shadow-[0_2px_12px_rgba(6,182,212,0.06)] hover:border-cyan-500/50" 
        : "bg-white border-slate-200 text-slate-900 shadow-sm"
    }`}>
      {/* Top Accent Neon Line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-cyan-400 via-amber-400 to-rose-500 rounded-t-xl shadow-[0_0_6px_rgba(6,182,212,0.6)]" />

      {/* Header Strip */}
      <div className="flex items-center justify-between min-w-0 pb-0.5 border-b border-cyan-500/15">
        <div className="flex items-center gap-1.5 truncate">
          <Zap size={10} className="text-cyan-400 animate-pulse flex-shrink-0" />
          <span className="text-[8.5px] font-black uppercase tracking-wider text-cyan-300 truncate">
            OI DATA STRATEGY DECK
          </span>
        </div>
        <span className={`text-[7px] font-mono font-black uppercase px-1.5 py-0.2 rounded-full flex items-center gap-1 border ${
          darkMode ? "text-cyan-400 bg-cyan-950/50 border-cyan-800/40" : "text-cyan-700 bg-cyan-50 border-cyan-200"
        }`}>
          <span className="w-1 h-1 rounded-full bg-cyan-400 animate-ping" />
          LIVE
        </span>
      </div>

      {/* Main Row: ATM Strike (Small compact box), PCR Ratio & OI Def Score (LAMBA BOX WITH DARK RED BG) */}
      <div className="grid grid-cols-12 gap-1 my-0.5 items-stretch">
        {/* ATM Strike - SMALL COMPACT BOX (col-span-3) */}
        <div className={`col-span-3 p-1 px-1.5 rounded-lg border flex flex-col justify-center min-w-0 ${
          darkMode ? "bg-slate-900/60 border-slate-800/80" : "bg-slate-50 border-slate-200"
        }`}>
          <span className="text-[6px] font-black text-slate-400 uppercase tracking-tight">ATM STRIKE</span>
          <span className="font-mono text-[13px] font-black text-amber-400 truncate leading-tight drop-shadow-[0_0_6px_rgba(245,158,11,0.25)]">
            {atmStrike ? atmStrike.toLocaleString() : "—"}
          </span>
        </div>

        {/* PCR Ratio (col-span-3) */}
        <div className={`col-span-3 p-1 px-1.5 rounded-lg border flex flex-col justify-center min-w-0 ${
          darkMode ? "bg-slate-900/60 border-slate-800/80" : "bg-slate-50 border-slate-200"
        }`}>
          <div className="flex items-center justify-between text-[6px] font-black text-slate-400 uppercase">
            <span>PCR</span>
            <span className={`text-[5.5px] font-mono font-black px-0.5 rounded border ${sentiment.color}`}>
              {sentiment.label}
            </span>
          </div>
          <span className="font-mono text-[13px] font-black text-cyan-400 truncate leading-tight drop-shadow-[0_0_6px_rgba(34,211,238,0.25)]">
            {pcr.toFixed(3)}
          </span>
        </div>

        {/* OI Def Score - LAMBA BOX WITH DARK RED BACKGROUND (col-span-6) */}
        <div className={`col-span-6 p-1 px-2 rounded-lg border flex flex-col justify-center min-w-0 shadow-[0_0_12px_rgba(225,29,72,0.35)] transition-all ${
          darkMode 
            ? "bg-gradient-to-r from-red-950 via-rose-950/90 to-slate-950 border-red-500/70 text-white" 
            : "bg-red-900 border-red-700 text-white"
        }`}>
          <div className="flex items-center justify-between text-[7px] font-black uppercase">
            <span className="text-rose-300 font-bold tracking-wider">OI DEF SCORE</span>
            <div className="flex items-center gap-1">
              <span className={`text-[6.5px] font-mono font-bold px-1.5 py-0.2 rounded border uppercase ${
                isCeBuySignal
                  ? "text-emerald-300 bg-emerald-950/90 border-emerald-500/60"
                  : "text-rose-200 bg-red-950/90 border-rose-500/70"
              }`}>
                {sideLabel}
              </span>
              <span className={`text-[6.5px] font-black px-1 py-0.2 rounded border uppercase flex items-center gap-0.5 ${
                isCeBuySignal
                  ? "text-emerald-300 bg-emerald-950/90 border-emerald-500/60"
                  : "text-rose-200 bg-red-950/90 border-rose-500/70"
              }`}>
                {isCeBuySignal ? <TrendingUp size={8}/> : <TrendingDown size={8}/>}
                {dominationText}
              </span>
            </div>
          </div>
          <div className="flex items-baseline justify-between min-w-0 mt-0.5">
            <span className="font-mono text-[17px] font-black text-rose-100 leading-tight drop-shadow-[0_0_10px_rgba(244,63,94,0.7)] tracking-tight">
              {oiDifference >= 0 ? "+" : ""}{oiDifference.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: Power Split Bar combined */}
      <div className={`p-1 px-1.5 rounded-lg border flex flex-col justify-center gap-1 ${
        darkMode ? "bg-slate-900/40 border-slate-800/60" : "bg-slate-100 border-slate-200"
      }`}>
        <div className="flex items-center justify-between text-[6.5px] font-mono font-black uppercase">
          <span className="text-emerald-400">PE {putStrength.toFixed(0)} ({pePercent.toFixed(0)}%)</span>
          <span className="text-slate-400 text-[6px] uppercase tracking-wider">PUT / CALL POWER</span>
          <span className="text-rose-400">CE {callStrength.toFixed(0)} ({(100 - pePercent).toFixed(0)}%)</span>
        </div>
        <div className="w-full h-[4px] bg-slate-950 rounded-full overflow-hidden flex border border-slate-800/80">
          <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500" style={{ width: `${pePercent}%` }} />
          <div className="h-full bg-gradient-to-r from-pink-500 to-rose-500 transition-all duration-500" style={{ width: `${100 - pePercent}%` }} />
        </div>
      </div>
    </div>
  );
}
