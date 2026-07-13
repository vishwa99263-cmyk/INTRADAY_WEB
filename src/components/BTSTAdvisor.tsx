import React from "react";
import { Sparkles, TrendingUp, TrendingDown, AlertCircle, Info, ShieldCheck } from "lucide-react";

interface BTSTAdvisorProps {
  spotPrice: number;
  dayHigh: number;
  dayLow: number;
  pcr: number;
  totalScore: number;
  darkMode: boolean;
  serverTime: number;
  activePage: string;
}

export default function BTSTAdvisor({
  spotPrice,
  dayHigh,
  dayLow,
  pcr,
  totalScore,
  darkMode,
  serverTime,
  activePage,
}: BTSTAdvisorProps) {
  // Convert serverTime (UTC ms) to IST Time
  const istDate = serverTime ? new Date(serverTime + 5.5 * 60 * 60 * 1000) : new Date();
  const h = istDate.getUTCHours();
  const m = istDate.getUTCMinutes();
  const totalMinutes = h * 60 + m;

  // BTST window is between 14:45 IST and 15:30 IST (totalMinutes 885 to 930)
  const isBtstWindow = totalMinutes >= 14 * 60 + 45 && totalMinutes <= 15 * 60 + 30;

  // Proximity calculations
  const pctFromHigh = dayHigh > 0 ? ((dayHigh - spotPrice) / spotPrice) * 100 : 999;
  const pctFromLow = spotPrice > 0 && dayLow > 0 ? ((spotPrice - dayLow) / spotPrice) * 100 : 999;

  // BTST decision model
  let recommendation: "GAP_UP_CE" | "GAP_DOWN_PE" | "STAY_CASH" = "STAY_CASH";
  let explanation = "";
  let confidence = "Low";

  if (totalScore >= 35 && pcr >= 1.15 && pctFromHigh <= 0.35) {
    recommendation = "GAP_UP_CE";
    explanation = `${activePage} heavyweights are showing strong closing demand, closing near Day High. High PCR and bullish stock score confirm smart money accumulation. High probability of GAP UP tomorrow.`;
    confidence = totalScore >= 60 && pcr >= 1.3 ? "High (85%)" : "Medium (70%)";
  } else if (totalScore <= -35 && pcr <= 0.85 && pctFromLow <= 0.35) {
    recommendation = "GAP_DOWN_PE";
    explanation = `${activePage} is trading weak near Day Low. Bearish PCR change and heavy selling in index weightages indicate overnight short carryover. High probability of GAP DOWN tomorrow.`;
    confidence = totalScore <= -60 && pcr <= 0.7 ? "High (82%)" : "Medium (68%)";
  } else {
    recommendation = "STAY_CASH";
    explanation = "Mixed signals or range-bound closing. Stock scores are conflicting with options PCR. Overnight carrying carries high risk of flat opening or theta decay. Recommending NO TRADE (Stay in Cash).";
    confidence = "N/A";
  }

  // Styles configuration
  const cardBorder = darkMode ? "border-[#1d2a45] bg-[#0e1628]/80 text-slate-100" : "bg-white border-slate-200 text-slate-900";
  const innerBg = darkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-150";

  return (
    <div className={`p-4 rounded-xl border shadow-lg ${cardBorder} flex flex-col gap-3.5 select-none font-sans`}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b pb-2 border-slate-700/50">
        <div className="flex items-center gap-2">
          {isBtstWindow ? (
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </span>
          ) : (
            <Info size={14} className="text-teal-400" />
          )}
          <h3 className="text-[10px] md:text-[11px] font-black uppercase tracking-wider text-teal-400">
            🎯 Tomorrow's Strategy & BTST Overnight Advisor
          </h3>
        </div>
        <div className="text-[9px] font-mono font-bold text-slate-400">
          IST Session: {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}
        </div>
      </div>

      {/* Timing Warning indicator */}
      {!isBtstWindow && (
        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[9.5px] font-semibold text-amber-450 leading-normal flex gap-1.5 items-center">
          <AlertCircle size={12} className="flex-shrink-0" />
          <span>BTST analysis activates at 2:45 PM. Displaying preview based on live session metrics:</span>
        </div>
      )}

      {/* Decision block */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 items-center">
        {/* Recommendation Tag */}
        <div className={`p-4 rounded-xl border text-center flex flex-col justify-center min-h-[90px] ${
          recommendation === "GAP_UP_CE" ? "bg-emerald-500/10 border-emerald-500/35 text-emerald-400" :
          recommendation === "GAP_DOWN_PE" ? "bg-rose-500/10 border-rose-500/35 text-rose-455" :
          "bg-amber-500/10 border-amber-500/35 text-amber-450"
        }`}>
          <span className="text-[8.5px] font-bold uppercase tracking-widest text-slate-400">BTST Decision</span>
          <span className="text-[13.5px] font-black mt-2 uppercase tracking-wide">
            {recommendation === "GAP_UP_CE" ? "🚀 GAP UP (Buy CE)" :
             recommendation === "GAP_DOWN_PE" ? "📉 GAP DOWN (Buy PE)" :
             "⚖️ NO OVERNIGHT TRADE"}
          </span>
          <span className="text-[8px] mt-1 opacity-80 uppercase tracking-widest">
            {recommendation === "STAY_CASH" ? "FLAT OPEN RISK" : `CONFIDENCE: ${confidence}`}
          </span>
        </div>

        {/* Factors list */}
        <div className={`p-3 rounded-xl border col-span-2 grid grid-cols-3 gap-2 ${innerBg}`}>
          <div className="text-center flex flex-col justify-center border-r border-slate-800/80">
            <span className="text-[7.5px] text-slate-400 uppercase font-black">Stock Score</span>
            <span className={`text-[11px] font-black mt-1 font-mono ${totalScore > 30 ? "text-emerald-400" : totalScore < -30 ? "text-rose-400" : "text-slate-200"}`}>
              {totalScore > 0 ? `+${totalScore}` : totalScore}
            </span>
            <span className="text-[7px] text-slate-500 uppercase mt-0.5">Need ±35</span>
          </div>

          <div className="text-center flex flex-col justify-center border-r border-slate-800/80">
            <span className="text-[7.5px] text-slate-400 uppercase font-black">Nifty PCR</span>
            <span className={`text-[11px] font-black mt-1 font-mono ${pcr >= 1.15 ? "text-emerald-400" : pcr <= 0.85 ? "text-rose-400" : "text-slate-200"}`}>
              {pcr.toFixed(2)}
            </span>
            <span className="text-[7px] text-slate-500 uppercase mt-0.5">Need &gt;1.15/&lt;0.85</span>
          </div>

          <div className="text-center flex flex-col justify-center">
            <span className="text-[7.5px] text-slate-400 uppercase font-black">Proximity</span>
            <span className="text-[9.5px] font-black mt-1 font-mono text-slate-300">
              {pctFromHigh <= pctFromLow ? `H: ${pctFromHigh.toFixed(2)}%` : `L: ${pctFromLow.toFixed(2)}%`}
            </span>
            <span className="text-[7px] text-slate-500 uppercase mt-0.5">Need &lt;0.35%</span>
          </div>
        </div>
      </div>

      {/* Explanatory text */}
      <div className={`p-3 rounded-xl border text-[11px] font-medium leading-relaxed ${
        recommendation === "GAP_UP_CE" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-350" :
        recommendation === "GAP_DOWN_PE" ? "border-rose-500/25 bg-rose-500/5 text-rose-350" :
        "border-slate-800 bg-slate-950/40 text-slate-400"
      }`}>
        <div className="flex gap-2 items-start">
          <ShieldCheck size={14} className="flex-shrink-0 mt-0.5 animate-pulse" />
          <p>{explanation}</p>
        </div>
      </div>
    </div>
  );
}
