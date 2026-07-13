import React, { useState } from "react";
import { Layers } from "lucide-react";

interface LiveAnalyticsProps {
  spotPrice: number;
  prevClose: number;
  high: number;
  low: number;
  darkMode: boolean;
}

export default function LiveAnalytics({ spotPrice, prevClose, high, low, darkMode }: LiveAnalyticsProps) {
  const [fontSize, setFontSize] = useState(() => {
    return Number(localStorage.getItem("analytics-font-size")) || 12; // default 12px
  });

  const adjustFont = (amount: number) => {
    setFontSize(prev => {
      const next = Math.max(9, Math.min(18, prev + amount));
      localStorage.setItem("analytics-font-size", String(next));
      return next;
    });
  };

  const spotDifference = parseFloat((spotPrice - prevClose).toFixed(2));
  const changePercent = parseFloat(((spotDifference / prevClose) * 100).toFixed(2));
  const spotVsHigh = parseFloat((spotPrice - high).toFixed(2));
  const spotVsLow = parseFloat((spotPrice - low).toFixed(2));

  // Determine indicator proximity (if within 0.1% of high/low)
  const isNearHigh = Math.abs(spotVsHigh) < (prevClose * 0.001);
  const isNearLow = Math.abs(spotVsLow) < (prevClose * 0.001);

  // Styling gradients
  const getDiffColor = (val: number) => {
    if (val > 0) return darkMode ? "text-emerald-400 bg-emerald-950/25 border-emerald-500/20" : "text-emerald-700 bg-emerald-50 border-emerald-200";
    if (val < 0) return darkMode ? "text-rose-400 bg-rose-955/25 border-rose-500/20" : "text-rose-700 bg-rose-50 border-rose-200";
    return "text-slate-500 bg-slate-100 border-slate-200";
  };

  const getHighColor = () => {
    if (isNearHigh) return darkMode ? "bg-emerald-900 border-emerald-500 text-white font-bold" : "bg-emerald-650 border-emerald-700 text-white font-bold";
    return darkMode ? "text-rose-400 bg-rose-955/5 border-slate-850" : "text-rose-800 bg-rose-50/50 border-slate-200";
  };

  const getLowColor = () => {
    if (isNearLow) return darkMode ? "bg-rose-900 border-rose-500 text-white font-bold" : "bg-rose-600 border-rose-700 text-white font-bold";
    return darkMode ? "text-emerald-400 bg-emerald-955/5 border-slate-850" : "text-emerald-850 bg-emerald-50/50 border-slate-200";
  };

  return (
    <div className={`p-2.5 rounded-xl border shadow-sm select-none w-full h-full flex flex-col justify-between ${
      darkMode ? "bg-slate-955 border-slate-850 text-slate-350" : "bg-white border-slate-350 text-slate-700"
    }`} id="live-spot-analytics">
      <div className="flex items-center justify-between mb-2 border-b border-slate-205 dark:border-slate-800 pb-1 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Layers size={13} className="text-teal-500 animate-pulse" />
          <h3 className="text-[10px] font-black uppercase tracking-wider">Spot Price Analytics Engine</h3>
        </div>
        <div className="flex items-center gap-1 bg-slate-900/60 dark:bg-slate-900/90 border border-slate-700/50 rounded px-1.5 py-0.2 text-white font-mono select-none scale-90">
          <button onClick={() => adjustFont(-1)} className="hover:text-teal-400 font-bold px-1 text-[10px] cursor-pointer">&minus;</button>
          <span className="text-[8px] opacity-75 font-semibold">FONT</span>
          <button onClick={() => adjustFont(1)} className="hover:text-teal-400 font-bold px-1 text-[10px] cursor-pointer">+</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5 flex-1 content-center">
        {/* Spot */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${
          darkMode ? "bg-slate-900/60 border-slate-800" : "bg-slate-50 border-slate-200"
        }`}>
          <span className="uppercase font-bold text-slate-400 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>Live Spot Price</span>
          <span className="font-black font-mono tracking-tight text-emerald-600 dark:text-teal-400" style={{ fontSize: `${fontSize}px` }}>{spotPrice.toLocaleString()}</span>
        </div>

        {/* Prev close */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${
          darkMode ? "bg-slate-900/60 border-slate-800" : "bg-slate-50 border-slate-200"
        }`}>
          <span className="uppercase font-bold text-slate-400 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>Previous Close</span>
          <span className="font-black font-mono tracking-tight text-slate-800 dark:text-slate-200" style={{ fontSize: `${fontSize}px` }}>{prevClose.toLocaleString()}</span>
        </div>

        {/* High */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${
          darkMode ? "bg-slate-900/60 border-slate-800" : "bg-slate-50 border-slate-200"
        }`}>
          <span className="uppercase font-bold text-slate-400 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>Today High</span>
          <span className="font-black font-mono text-emerald-500 tracking-tight" style={{ fontSize: `${fontSize}px` }}>{high.toLocaleString()}</span>
        </div>

        {/* Low */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${
          darkMode ? "bg-slate-900/60 border-slate-800" : "bg-slate-50 border-slate-200"
        }`}>
          <span className="uppercase font-bold text-slate-400 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>Today Low</span>
          <span className="font-black font-mono text-rose-500 tracking-tight" style={{ fontSize: `${fontSize}px` }}>{low.toLocaleString()}</span>
        </div>

        {/* Day Range */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${
          darkMode ? "bg-amber-950/30 border-amber-800/60" : "bg-[#FFF8E1] border-amber-200"
        }`}>
          <span className="uppercase font-bold text-slate-400 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>Day Range</span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="font-black font-mono text-amber-500 tracking-tight drop-shadow-sm" style={{ fontSize: `${fontSize}px` }}>
              {(high > 0 && low > 0) ? (high - low).toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "0.0"}
            </span>
            <span className="text-[7.5px] uppercase tracking-wider px-1 py-0.2 text-center bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-400 rounded leading-none font-black ml-1 border border-amber-200 dark:border-amber-700/50">H-L</span>
          </div>
        </div>

        {/* Spot vs close */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${getDiffColor(spotDifference)}`}>
          <span className="uppercase font-bold opacity-90 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>SPOT vs CLOSE</span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="font-black font-mono tracking-tight" style={{ fontSize: `${fontSize}px` }}>
              {spotDifference > 0 ? `+${spotDifference}` : spotDifference}
            </span>
            <span className="font-black font-mono opacity-80" style={{ fontSize: `${fontSize * 0.85}px` }}>({changePercent > 0 ? "+" : ""}{changePercent}%)</span>
          </div>
        </div>

        {/* Spot vs High */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${getHighColor()}`}>
          <span className="uppercase font-bold opacity-90 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>SPOT vs HIGH</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="font-black font-mono tracking-tight" style={{ fontSize: `${fontSize}px` }}>{spotVsHigh > 0 ? `+${spotVsHigh}` : spotVsHigh}</span>
            {isNearHigh && (
              <span className="text-[7px] uppercase tracking-wider px-1 py-0.2 text-center bg-white text-emerald-800 rounded leading-none font-black">NEAR HIGH</span>
            )}
          </div>
        </div>

        {/* Spot vs Low */}
        <div className={`p-1.5 border rounded-lg flex flex-col justify-between ${getLowColor()}`}>
          <span className="uppercase font-bold opacity-90 leading-tight" style={{ fontSize: `${fontSize * 0.75}px` }}>SPOT vs LOW</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="font-black font-mono tracking-tight" style={{ fontSize: `${fontSize}px` }}>{spotVsLow > 0 ? `+${spotVsLow}` : spotVsLow}</span>
            {isNearLow && (
              <span className="text-[7px] uppercase tracking-wider px-1 py-0.2 text-center bg-white text-rose-800 rounded leading-none font-black">NEAR LOW</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
