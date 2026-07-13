import React from "react";
import { ArrowUpRight, ArrowDownRight, Eye } from "lucide-react";

interface SpotPricePanelProps {
  spotPrice: number;
  spotChange: number;
  spotChangePct: number;
  highPrice: number;
  lowPrice: number;
  indiaVix: number;
  atmStrike: number;
  onToggleColumns: () => void;
  showColPanel: boolean;
}

export default function SpotPricePanel({
  spotPrice,
  spotChange,
  spotChangePct,
  highPrice,
  lowPrice,
  indiaVix,
  atmStrike,
  onToggleColumns,
  showColPanel
}: SpotPricePanelProps) {
  const isPositive = spotChange >= 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 bg-slate-900 border-y border-slate-800 text-[11px] font-mono select-none">
      <div className="flex flex-wrap items-center gap-6">
        {/* Nifty Spot Price */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-400">NIFTY 50 INDEX:</span>
          <span className="font-black text-white text-xs">
            {spotPrice > 0 ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}
          </span>
          <span className={`flex items-center font-bold px-1 rounded ${
            isPositive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
          }`}>
            {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {isPositive ? `+${spotChange.toFixed(2)}` : spotChange.toFixed(2)} ({isPositive ? `+${spotChangePct}%` : `${spotChangePct}%`})
          </span>
        </div>

        <div className="h-3 w-px bg-slate-850"></div>

        {/* Day High / Low */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">HIGH:</span>
            <span className="font-bold text-emerald-400">
              {highPrice > 0 ? highPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">LOW:</span>
            <span className="font-bold text-rose-400">
              {lowPrice > 0 ? lowPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}
            </span>
          </div>
        </div>

        <div className="h-3 w-px bg-slate-850"></div>

        {/* India Vix */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500 font-medium">INDIA VIX:</span>
          <span className={`font-black ${indiaVix > 15 ? "text-orange-400" : "text-emerald-400"}`}>
            {indiaVix > 0 ? `${indiaVix.toFixed(2)}%` : "0.00%"}
          </span>
        </div>

        <div className="h-3 w-px bg-slate-850"></div>

        {/* ATM Strike */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500 font-medium">ATM STRIKE:</span>
          <span className="font-black text-yellow-400">
            {atmStrike > 0 ? atmStrike.toLocaleString("en-IN") : "0"}
          </span>
        </div>
      </div>

      {/* Columns configuration button */}
      <button
        onClick={onToggleColumns}
        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
          showColPanel
            ? "bg-teal-600 border-transparent text-white shadow-md shadow-teal-900/20"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600 hover:text-white"
        }`}
      >
        <Eye size={12} />
        <span>Columns</span>
      </button>
    </div>
  );
}
