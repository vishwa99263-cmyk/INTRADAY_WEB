import React, { useMemo } from "react";
import { Zap, TrendingUp, TrendingDown, Flame } from "lucide-react";
import { OptionStrike } from "../types";

interface AIOptionBuyingTipsProps {
  strikes: OptionStrike[];
  spotPrice: number;
  strikeGap: number;
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | "BANKNIFTY";
  darkMode?: boolean;
  range15m: { high: number; low: number; isFallback?: boolean };
}

export default function AIOptionBuyingTips({
  strikes,
  spotPrice,
  strikeGap,
  activePage,
  darkMode = false,
  range15m,
}: AIOptionBuyingTipsProps) {
  // Expiry check logic (Nifty = Thursday, Sensex = Friday)
  const isExpiryDay = useMemo(() => {
    const day = new Date().getDay();
    if (activePage === "NIFTY" && day === 4) return true; // Thursday
    if (activePage === "SENSEX" && day === 5) return true; // Friday
    return false;
  }, [activePage]);

  // ATM Strike for Hero-Zero option premium targeting
  const atmStrike = useMemo(() => {
    if (!spotPrice || !strikeGap) return 0;
    return Math.round(spotPrice / strikeGap) * strikeGap;
  }, [spotPrice, strikeGap]);

  // CE Setup (Call Option Buying Trigger using 15M High)
  const ceSetup = useMemo(() => {
    const trigger = Math.round(range15m.high);
    const target = trigger + strikeGap;
    const sl = trigger - (strikeGap / 2);
    const isBreached = spotPrice >= range15m.high;

    // Use the closest strike price matching the trigger to display target CE premium
    const targetStrike = Math.round(trigger / strikeGap) * strikeGap;
    const ceRow = strikes.find(s => s.strikePrice === targetStrike);
    const premium = ceRow ? ceRow.ceLtp : 0;

    return { trigger, target, sl, isBreached, premium, targetStrike };
  }, [range15m.high, strikeGap, spotPrice, strikes]);

  // PE Setup (Put Option Buying Trigger using 15M Low)
  const peSetup = useMemo(() => {
    const trigger = Math.round(range15m.low);
    const target = trigger - strikeGap;
    const sl = trigger + (strikeGap / 2);
    const isBreached = spotPrice <= range15m.low;

    // Use the closest strike price matching the trigger to display target PE premium
    const targetStrike = Math.round(trigger / strikeGap) * strikeGap;
    const peRow = strikes.find(s => s.strikePrice === targetStrike);
    const premium = peRow ? peRow.peLtp : 0;

    return { trigger, target, sl, isBreached, premium, targetStrike };
  }, [range15m.low, strikeGap, spotPrice, strikes]);

  if (strikes.length === 0 || !spotPrice) return null;

  return (
    <div className={`w-full flex flex-col gap-1.5 font-sans select-none border p-2 rounded-lg shadow-md transition-all duration-300 ${
      darkMode ? "border-slate-800 bg-slate-955 text-slate-100" : "border-slate-300 bg-white text-slate-850"
    }`}>
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-teal-500 via-indigo-500 to-purple-500" />

      {/* Header */}
      <div className={`flex items-center justify-between pb-1 border-b relative z-10 ${
        darkMode ? "border-slate-850" : "border-slate-200"
      }`}>
        <div className="flex items-center gap-1">
          <Zap size={11} className="text-teal-500 animate-pulse" />
          <span className={`text-[9.5px] font-black uppercase tracking-widest ${
            darkMode ? "text-slate-400" : "text-slate-650"
          }`}>
            AI BUY-SIDE TRIGGERS (15M RANGE)
          </span>
        </div>
        {isExpiryDay && (
          <span className="text-[7.5px] font-mono font-black text-purple-650 dark:text-purple-300 bg-purple-500/10 px-1 rounded flex items-center gap-0.5">
            <Flame size={8} className="animate-bounce" /> EXPIRY ACTIVE
          </span>
        )}
      </div>

      {/* Triggers Section (2 columns) */}
      <div className="grid grid-cols-2 gap-1.5 relative z-10">
        {/* CE Buy Strategy */}
        <div className={`p-1.5 rounded-md border flex flex-col gap-1 transition-all duration-300 ${
          ceSetup.isBreached
            ? (darkMode ? "bg-emerald-950/10 border-emerald-500/30" : "bg-emerald-50 border-emerald-300")
            : (darkMode ? "bg-slate-900/10 border-slate-850" : "bg-slate-50 border-slate-200")
        }`}>
          <div className="flex justify-between items-center text-[8.5px] font-black">
            <span className={`uppercase flex items-center gap-0.5 ${
              darkMode ? "text-emerald-400" : "text-emerald-700"
            }`}>
              <TrendingUp size={9} /> CALL BUY (CE)
            </span>
            <span className={ceSetup.isBreached ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}>
              {ceSetup.isBreached ? "ACTIVE" : "AWAITING"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-0.5 font-mono text-center text-[9px]">
            <div className={`flex flex-col py-0.5 rounded border ${
              darkMode ? "bg-black/20 border-slate-800" : "bg-white border-slate-200"
            }`}>
              <span className="text-[6px] text-slate-500 font-extrabold uppercase">Trigger</span>
              <span className={`font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{ceSetup.trigger}</span>
            </div>
            <div className={`flex flex-col py-0.5 rounded border ${
              darkMode ? "bg-black/20 border-slate-800" : "bg-white border-slate-200"
            }`}>
              <span className="text-[6px] text-slate-500 font-extrabold uppercase">Target</span>
              <span className={`font-black ${darkMode ? "text-emerald-400" : "text-emerald-700"}`}>{ceSetup.target}</span>
            </div>
            <div className={`flex flex-col py-0.5 rounded border ${
              darkMode ? "bg-black/20 border-slate-800" : "bg-white border-slate-200"
            }`}>
              <span className="text-[6px] text-slate-500 font-extrabold uppercase">Stop Loss</span>
              <span className={`font-black ${darkMode ? "text-rose-400" : "text-rose-650"}`}>{ceSetup.sl}</span>
            </div>
          </div>
        </div>

        {/* PE Buy Strategy */}
        <div className={`p-1.5 rounded-md border flex flex-col gap-1 transition-all duration-300 ${
          peSetup.isBreached
            ? (darkMode ? "bg-rose-955/10 border-rose-500/30" : "bg-rose-50 border-rose-300")
            : (darkMode ? "bg-slate-900/10 border-slate-850" : "bg-slate-50 border-slate-200")
        }`}>
          <div className="flex justify-between items-center text-[8.5px] font-black">
            <span className={`uppercase flex items-center gap-0.5 ${
              darkMode ? "text-rose-400" : "text-rose-700"
            }`}>
              <TrendingDown size={9} /> PUT BUY (PE)
            </span>
            <span className={peSetup.isBreached ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-slate-500"}>
              {peSetup.isBreached ? "ACTIVE" : "AWAITING"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-0.5 font-mono text-center text-[9px]">
            <div className={`flex flex-col py-0.5 rounded border ${
              darkMode ? "bg-black/20 border-slate-800" : "bg-white border-slate-200"
            }`}>
              <span className="text-[6px] text-slate-500 font-extrabold uppercase">Trigger</span>
              <span className={`font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{peSetup.trigger}</span>
            </div>
            <div className={`flex flex-col py-0.5 rounded border ${
              darkMode ? "bg-black/20 border-slate-800" : "bg-white border-slate-200"
            }`}>
              <span className="text-[6px] text-slate-500 font-extrabold uppercase">Target</span>
              <span className={`font-black ${darkMode ? "text-emerald-400" : "text-emerald-700"}`}>{peSetup.target}</span>
            </div>
            <div className={`flex flex-col py-0.5 rounded border ${
              darkMode ? "bg-black/20 border-slate-800" : "bg-white border-slate-200"
            }`}>
              <span className="text-[6px] text-slate-500 font-extrabold uppercase">Stop Loss</span>
              <span className={`font-black ${darkMode ? "text-rose-400" : "text-rose-650"}`}>{peSetup.sl}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Expiry Hero-Zero Panel (Compact & only visible on expiry day) */}
      {isExpiryDay && (
        <div className={`p-1.5 rounded-md border flex flex-col gap-1 relative z-10 ${
          darkMode ? "bg-purple-950/10 border-purple-500/30" : "bg-purple-50/50 border-purple-250"
        }`}>
          <div className="flex justify-between items-center text-[8px] font-black text-purple-700 dark:text-purple-300">
            <span className="flex items-center gap-0.5"><Flame size={10} /> EXPIRY HERO-ZERO (LTP TARGETS)</span>
            <span className="font-mono text-[7px] opacity-75">WINDOW: 12:30-15:15</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[8.5px] font-mono">
            {/* OTM CE */}
            <div className={`p-1 rounded border ${
              darkMode ? "bg-black/20 border-slate-850" : "bg-white border-slate-200"
            }`}>
              <div className="flex justify-between font-bold text-slate-500 text-[7.5px]">
                <span>CE {ceSetup.targetStrike}</span>
                <span className="text-emerald-600 dark:text-emerald-400">LTP: ₹{ceSetup.premium.toFixed(1)}</span>
              </div>
              <div className="flex justify-between mt-1 text-[8px] border-t dark:border-slate-800/40 border-slate-100 pt-1">
                <span>2x: <b className={darkMode ? "text-white" : "text-slate-800"}>₹{(ceSetup.premium * 2).toFixed(0)}</b></span>
                <span>4x: <b className="text-amber-600">₹{(ceSetup.premium * 4).toFixed(0)}</b></span>
                <span>8x: <b className="text-purple-500">₹{(ceSetup.premium * 8).toFixed(0)}</b></span>
              </div>
            </div>

            {/* OTM PE */}
            <div className={`p-1 rounded border ${
              darkMode ? "bg-black/20 border-slate-850" : "bg-white border-slate-200"
            }`}>
              <div className="flex justify-between font-bold text-slate-500 text-[7.5px]">
                <span>PE {peSetup.targetStrike}</span>
                <span className="text-rose-650 dark:text-rose-400">LTP: ₹{peSetup.premium.toFixed(1)}</span>
              </div>
              <div className="flex justify-between mt-1 text-[8px] border-t dark:border-slate-800/40 border-slate-100 pt-1">
                <span>2x: <b className={darkMode ? "text-white" : "text-slate-800"}>₹{(peSetup.premium * 2).toFixed(0)}</b></span>
                <span>4x: <b className="text-amber-600">₹{(peSetup.premium * 4).toFixed(0)}</b></span>
                <span>8x: <b className="text-purple-500">₹{(peSetup.premium * 8).toFixed(0)}</b></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
