import React, { useState, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { StockData } from "../types.js";

interface SectorHeavyweightsProps {
  stocks: StockData[];
  darkMode: boolean;
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | "BANKNIFTY" | "BANKNIFTY";
}

export default function SectorHeavyweights({ stocks, darkMode, activePage }: SectorHeavyweightsProps) {
  const [fontSize, setFontSize] = useState(() => {
    return Number(localStorage.getItem("heavyweight-panel-font-size")) || 12; // default 12px
  });

  const adjustFont = (amount: number) => {
    setFontSize(prev => {
      const next = Math.max(9, Math.min(18, prev + amount));
      localStorage.setItem("heavyweight-panel-font-size", String(next));
      return next;
    });
  };

  // Group and sort heavyweights
  const { positiveGroup, negativeGroup, uniqueHeavy } = useMemo(() => {
    const targetSymbols = ["HDFCBANK", "ICICIBANK", "RELIANCE", "BHARTIARTL"];

    // ALL stocks with weightage >= 3.0% (priority + heavyweights only)
    const allHeavy = stocks.filter(s => s && ((s.weightage || 0) >= 3.0 || targetSymbols.includes(s.symbol.toUpperCase())));

    // De-duplicate
    const uniqueHeavyAll: StockData[] = [];
    const seen = new Set<string>();

    // Priority symbols first
    targetSymbols.forEach(sym => {
      const found = allHeavy.find(s => s.symbol.toUpperCase() === sym);
      if (found && !seen.has(found.symbol)) {
        seen.add(found.symbol);
        uniqueHeavyAll.push(found);
      }
    });

    // Then rest of weight >= 3% stocks
    allHeavy.forEach(s => {
      if (s && !seen.has(s.symbol)) {
        seen.add(s.symbol);
        uniqueHeavyAll.push(s);
      }
    });

    // NO extra filter — show ONLY weight >= 3% stocks
    const filteredHeavy = uniqueHeavyAll;

    // Group 1: Positive Group (Sorted highest positive first)
    const positive = filteredHeavy
      .filter(s => (s.changePercent || 0) >= 0)
      .sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));

    // Group 2: Negative Group (Sorted most negative first)
    const negative = filteredHeavy
      .filter(s => (s.changePercent || 0) < 0)
      .sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0));

    return { positiveGroup: positive, negativeGroup: negative, uniqueHeavy: filteredHeavy };
  }, [stocks]);

  // Compute Top 25/22 Heavyweight Summary
  const topHeavySummary = useMemo(() => {
    const sorted = [...stocks].sort((a, b) => (b.weightage || 0) - (a.weightage || 0));
    const topN = sorted.slice(0, activePage === "BANKNIFTY" ? 12 : (activePage === "SENSEX" ? 22 : 25));
    const adv = topN.filter(s => s && s.changePercent > 0).length;
    const dec = topN.filter(s => s && s.changePercent < 0).length;
    return {
      advances: adv,
      declines: dec,
      net: adv - dec
    };
  }, [stocks, activePage]);

  const renderStockRow = (s: StockData) => {
    const symbolUpper = s.symbol.toUpperCase();
    // BHARTIARTL gets priority (amber) styling only in SENSEX tab; plain in NIFTY tab
    const isPriority = symbolUpper === "HDFCBANK" || symbolUpper === "ICICIBANK" || symbolUpper === "RELIANCE"
      || (symbolUpper === "BHARTIARTL" && activePage === "SENSEX");

    let pct = s.changePercent;
    if ((pct === undefined || pct === 0) && s.ltp > 0 && s.prevClose > 0) {
      pct = ((s.ltp - s.prevClose) / s.prevClose) * 100;
    }
    pct = pct || 0;
    const isPos = pct >= 0;
    const formattedPct = `${isPos ? "+" : ""}${pct.toFixed(2)}%`;

    return (
      <div
        key={s.symbol}
        className={`flex items-center justify-start gap-2 px-2 py-[2px] rounded-lg transition-all select-none duration-200 ${
          darkMode
            ? "hover:bg-[#121c35]/40 text-slate-100"
            : "hover:bg-slate-100 text-slate-800"
        }`}
        style={{ fontSize: `${fontSize}px` }}
      >
        {/* Stock Symbol */}
        <div className="w-[82px] flex-shrink-0">
          {isPriority ? (
            <span className={`px-1.5 py-0 rounded font-black uppercase tracking-wider text-[11px] border select-text transition-all inline-block ${
              darkMode
                ? "bg-amber-500/10 border-amber-500/30 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.12)]"
                : "bg-amber-100 border-amber-300 text-amber-800 shadow-sm"
            }`}>
              {s.symbol}
            </span>
          ) : (
            <span className={`font-extrabold uppercase tracking-wider select-text ${
              darkMode ? "text-slate-200" : "text-slate-700"
            }`}>
              {s.symbol}
            </span>
          )}
        </div>

        {/* % Change — Right next to stock name */}
        <span
          className={`font-black font-mono rounded px-2 py-0.5 shadow-sm leading-none transition-all ${
            pct > 0
              ? (darkMode 
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]" 
                : "bg-emerald-100 text-emerald-700 border border-emerald-300 font-extrabold")
              : pct < 0
              ? (darkMode 
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.2)]" 
                : "bg-rose-100 text-rose-700 border border-rose-300 font-extrabold")
              : (darkMode 
                ? "bg-slate-800 text-slate-200 border border-slate-700" 
                : "bg-slate-200 text-slate-800 border border-slate-300 font-bold")
          }`}
          style={{
            fontSize: `${Math.max(fontSize, 11)}px`,
            minWidth: "58px",
            textAlign: "center",
            display: "inline-block",
            letterSpacing: "0.04em"
          }}
        >
          {formattedPct}
        </span>
      </div>
    );
  };

  return (
    <div 
      className={`flex flex-col h-full w-full rounded-2xl border shadow-xl relative select-none overflow-hidden transition-all duration-300 ${
        darkMode 
          ? "bg-[#040812] border-amber-500/25 text-slate-100 shadow-[0_0_25px_rgba(245,158,11,0.06)] hover:border-amber-500/40" 
          : "bg-gradient-to-br from-[#f8fafc]/98 via-[#f1f5f9]/95 to-[#e2e8f0]/98 border-slate-200 text-slate-800 hover:border-indigo-300 hover:shadow-[0_8px_25px_rgba(99,102,241,0.06)]"
      }`}
      id="sector-heavyweights-panel"
    >
      {/* Top glowing neon bar matched to heavyweights theme */}
      <div className="h-[3px] w-full bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 shadow-[0_1px_8px_rgba(245,158,11,0.65)]" />

      {/* Visual background gradient glow effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-transparent to-transparent pointer-events-none" />

      {/* Header */}
      <div className={`flex items-center justify-between border-b px-3.5 py-2.5 flex-shrink-0 relative z-10 ${
        darkMode ? "border-slate-800/80" : "border-slate-200/60"
      }`}>
        <div className="flex items-center gap-2">
          {/* Pulsing Telemetry LED indicator */}
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
          <h3 className="text-[10px] md:text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 font-sans whitespace-nowrap">
            Heavyweight &gt;3%
          </h3>
        </div>

        {/* Spreadsheet-grade Toolbar Font Sizer */}
        <div className={`flex items-center gap-1.5 border rounded-lg px-2 py-0.5 select-none scale-90 transition-all ${
          darkMode 
            ? "bg-[#0e1628]/95 border-[#263756]/80 text-slate-200" 
            : "bg-slate-100/90 border-slate-200/80 text-slate-700 shadow-sm"
        }`}>
          <button 
            onClick={() => adjustFont(-1)} 
            className="hover:text-amber-500 transition-colors font-black px-1.5 text-xs cursor-pointer select-none"
            title="Decrease Sizing"
          >
            &minus;
          </button>
          <div className="h-3 w-[1px] dark:bg-slate-800/60 bg-slate-200" />
          <span className="text-[8px] opacity-75 font-black uppercase tracking-wider font-sans">FONT</span>
          <div className="h-3 w-[1px] dark:bg-slate-800/60 bg-slate-200" />
          <button 
            onClick={() => adjustFont(1)} 
            className="hover:text-amber-500 transition-colors font-black px-1.5 text-xs cursor-pointer select-none"
            title="Increase Sizing"
          >
            +
          </button>
        </div>
      </div>

      {/* Body List */}
      <div className="flex-1 flex flex-col gap-0 px-3 py-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 min-h-0 relative z-10">
        {/* Group 1: Positives */}
        {positiveGroup.map(s => renderStockRow(s))}

        {/* Divider if both groups have elements */}
        {positiveGroup.length > 0 && negativeGroup.length > 0 && (
          <div className={`border-t-2 my-[2px] flex-shrink-0 ${
            darkMode ? "border-slate-700/80" : "border-slate-350"
          }`} />
        )}

        {/* Group 2: Negatives */}
        {negativeGroup.map(s => renderStockRow(s))}

        {uniqueHeavy.length === 0 && (
          <div className="text-[10px] text-slate-400 italic text-center py-6">
            No heavyweights (&gt;3%)
          </div>
        )}

        {/* ADV / DEC Panel Layout (Comes right after the last stock) */}
        <div className={`mt-1 py-1 border-t relative z-10 ${
          darkMode ? "border-slate-800/80" : "border-slate-200/60"
        }`}>
          <div className={`p-1 rounded-xl border flex items-center justify-around font-sans ${
            darkMode ? "bg-black/25 border-slate-800/60 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]" : "bg-slate-200/20 border-slate-200"
          }`}>
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">ADV</span>
              <span className="text-xl md:text-2xl font-black text-emerald-500 dark:text-emerald-400 leading-none mt-1">
                {topHeavySummary.advances}
              </span>
            </div>
            <div className="w-[1px] h-8 bg-slate-200 dark:bg-slate-800/60" />
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">DEC</span>
              <span className="text-xl md:text-2xl font-black text-rose-500 dark:text-rose-455 leading-none mt-1">
                {topHeavySummary.declines}
              </span>
            </div>
            <div className="w-[1px] h-8 bg-slate-200 dark:bg-slate-800/60" />
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">NET</span>
              <span className={`px-2 py-0.5 rounded border font-black text-[10px] leading-none mt-1 transition-all ${
                topHeavySummary.net >= 0 
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-450 dark:text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]" 
                  : "bg-rose-500/10 border-rose-500/20 text-rose-500 dark:text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.1)]"
              }`}>
                {topHeavySummary.net >= 0 ? "+" : ""}{topHeavySummary.net}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
