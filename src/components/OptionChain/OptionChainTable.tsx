import React, { useState, useMemo } from "react";
import { OptionStrikeRow, isItm } from "./optionUtils.js";
import { Search } from "lucide-react";

interface ColDef {
  key: string;
  label: string;
  side: "CE" | "PE" | "CENTER";
}

export const TABLE_COLUMNS: ColDef[] = [
  // CE Side
  { key: "ceOI",          label: "CE OI",         side: "CE" },
  { key: "ceOIChange",    label: "CE OI CHG",     side: "CE" },
  { key: "ceVolume",      label: "CE VOLUME",     side: "CE" },
  { key: "ceIV",          label: "CE IV",         side: "CE" },
  { key: "ceDelta",       label: "CE DELTA",      side: "CE" },
  { key: "ceTheta",       label: "CE THETA",      side: "CE" },
  { key: "ceVega",        label: "CE VEGA",       side: "CE" },
  { key: "ceLtp",         label: "CE LTP",        side: "CE" },
  
  // Center
  { key: "strikePrice",   label: "STRIKE",        side: "CENTER" },
  
  // PE Side
  { key: "peLtp",         label: "PE LTP",        side: "PE" },
  { key: "peVega",        label: "PE VEGA",       side: "PE" },
  { key: "peTheta",       label: "PE THETA",      side: "PE" },
  { key: "peDelta",       label: "PE DELTA",      side: "PE" },
  { key: "peIV",          label: "PE IV",         side: "PE" },
  { key: "peVolume",      label: "PE VOLUME",     side: "PE" },
  { key: "peOIChange",    label: "PE OI CHG",     side: "PE" },
  { key: "peOI",          label: "PE OI",         side: "PE" },
];

interface OptionChainTableProps {
  rows: OptionStrikeRow[];
  spotPrice: number;
  atmStrike: number;
  loading: boolean;
  visibleCols: Record<string, boolean>;
}

export const safeNumber = (n: any): number => {
  const num = Number(n);
  return Number.isFinite(num) ? num : 0;
};

function OptionChainTable({
  rows,
  spotPrice,
  atmStrike,
  loading,
  visibleCols
}: OptionChainTableProps) {
  const [strikeSearch, setStrikeSearch] = useState<string>("");

  const filteredRows = useMemo(() => {
    if (!strikeSearch) return rows;
    return rows.filter((r) => String(r.strikePrice).includes(strikeSearch));
  }, [rows, strikeSearch]);

  const activeCols = useMemo(() => {
    return TABLE_COLUMNS.filter((c) => visibleCols[c.key]);
  }, [visibleCols]);

  const formatK = (n: any) => {
    const num = safeNumber(n);
    return (num / 100000).toFixed(2) + "L";
  };

  const formatOIChange = (n: any) => {
    const num = safeNumber(n);
    return (num / 100000).toFixed(3) + "L";
  };

  const fmt = (n: any, d = 2) => {
    const num = safeNumber(n);
    return num.toFixed(d);
  };
  
  const pctCls = (n: number) => 
    n > 0 ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 dark:bg-emerald-950/20 font-bold" : n < 0 ? "text-rose-600 dark:text-rose-400 bg-rose-500/5 dark:bg-rose-950/20 font-bold" : "text-slate-400";

  const ceZoneAnalysis = useMemo(() => {
    const ceZoneRows = rows.filter(r => r.strikePrice >= atmStrike);
    
    const volRows = ceZoneRows.filter(r => safeNumber(r.ceVolume) > 0).sort((a, b) => safeNumber(b.ceVolume) - safeNumber(a.ceVolume));
    const oiRows = ceZoneRows.filter(r => safeNumber(r.ceOI) > 0).sort((a, b) => safeNumber(b.ceOI) - safeNumber(a.ceOI));
    const oiChgRows = ceZoneRows.filter(r => safeNumber(r.ceOIChange) > 0).sort((a, b) => safeNumber(b.ceOIChange) - safeNumber(a.ceOIChange));

    return {
      vol: [volRows[0]?.strikePrice || 0, volRows[1]?.strikePrice || 0, volRows[2]?.strikePrice || 0],
      oi: [oiRows[0]?.strikePrice || 0, oiRows[1]?.strikePrice || 0, oiRows[2]?.strikePrice || 0],
      oiChg: [oiChgRows[0]?.strikePrice || 0, oiChgRows[1]?.strikePrice || 0, oiChgRows[2]?.strikePrice || 0],
    };
  }, [rows, atmStrike]);

  const peZoneAnalysis = useMemo(() => {
    const peZoneRows = rows.filter(r => r.strikePrice <= atmStrike);
    
    const volRows = peZoneRows.filter(r => safeNumber(r.peVolume) > 0).sort((a, b) => safeNumber(b.peVolume) - safeNumber(a.peVolume));
    const oiRows = peZoneRows.filter(r => safeNumber(r.peOI) > 0).sort((a, b) => safeNumber(b.peOI) - safeNumber(a.peOI));
    const oiChgRows = peZoneRows.filter(r => safeNumber(r.peOIChange) > 0).sort((a, b) => safeNumber(b.peOIChange) - safeNumber(a.peOIChange));

    return {
      vol: [volRows[0]?.strikePrice || 0, volRows[1]?.strikePrice || 0, volRows[2]?.strikePrice || 0],
      oi: [oiRows[0]?.strikePrice || 0, oiRows[1]?.strikePrice || 0, oiRows[2]?.strikePrice || 0],
      oiChg: [oiChgRows[0]?.strikePrice || 0, oiChgRows[1]?.strikePrice || 0, oiChgRows[2]?.strikePrice || 0],
    };
  }, [rows, atmStrike]);

  const getHighlightClass = (rank: number) => {
    if (rank === 1) {
      // Large 1: Dark Red
      return "anti-flicker-cell px-2 py-1.5 border-2 border-[#EF4444] text-center text-[11px] font-black text-[#FFFFFF] bg-[#B91C1C] shadow-[0_0_12px_rgba(185,28,28,0.45),inset_0_0_8px_rgba(239,68,68,0.3)] transition-all hover:scale-[1.03] hover:brightness-110 rounded";
    }
    if (rank === 2) {
      // Large 2: Bright Yellow
      return "anti-flicker-cell px-2 py-1.5 border-2 border-[#FACC15] text-center text-[11px] font-black text-[#111827] bg-[#EAB308] shadow-[0_0_12px_rgba(234,179,8,0.4),inset_0_0_8px_rgba(250,204,21,0.3)] transition-all hover:scale-[1.02] hover:brightness-110 rounded";
    }
    if (rank === 3) {
      // Large 3: Strong Pink
      return "anti-flicker-cell px-2 py-1.5 border-2 border-[#F472B6] text-center text-[11px] font-black text-[#FFFFFF] bg-[#DB2777] shadow-[0_0_12px_rgba(219,39,119,0.4),inset_0_0_8px_rgba(244,114,182,0.3)] transition-all hover:scale-[1.01] hover:brightness-110 rounded";
    }
    return "";
  };

  const renderCell = (col: ColDef, row: OptionStrikeRow, isAtm: boolean) => {
    const k = col.key as keyof OptionStrikeRow;
    const v = safeNumber(row[k]);

    const itmCe = isItm(row.strikePrice, spotPrice, "CE");
    const itmPe = isItm(row.strikePrice, spotPrice, "PE");
    
    // Background shading for ITM vs OTM
    let cellBg = "bg-transparent";
    if (col.side === "CE" && itmCe) {
      cellBg = "bg-rose-500/10 dark:bg-rose-950/20"; // CE ITM Shading
    } else if (col.side === "PE" && itmPe) {
      cellBg = "bg-emerald-500/10 dark:bg-emerald-950/20"; // PE ITM Shading
    }

    let rank = 0;
    if (col.key === "ceVolume") {
      const idx = ceZoneAnalysis.vol.indexOf(row.strikePrice);
      if (idx !== -1) rank = idx + 1;
    } else if (col.key === "ceOI") {
      const idx = ceZoneAnalysis.oi.indexOf(row.strikePrice);
      if (idx !== -1) rank = idx + 1;
    } else if (col.key === "ceOIChange") {
      const idx = ceZoneAnalysis.oiChg.indexOf(row.strikePrice);
      if (idx !== -1) rank = idx + 1;
    } else if (col.key === "peVolume") {
      const idx = peZoneAnalysis.vol.indexOf(row.strikePrice);
      if (idx !== -1) rank = idx + 1;
    } else if (col.key === "peOI") {
      const idx = peZoneAnalysis.oi.indexOf(row.strikePrice);
      if (idx !== -1) rank = idx + 1;
    } else if (col.key === "peOIChange") {
      const idx = peZoneAnalysis.oiChg.indexOf(row.strikePrice);
      if (idx !== -1) rank = idx + 1;
    }

    switch (col.key) {
      case "strikePrice":
        return (
          <td
            key="strikePrice"
            className={`anti-flicker-cell px-3 py-2 font-black text-center border border-slate-200 dark:border-slate-800 text-xs md:text-sm sticky left-0 z-10 transition-all ${
              isAtm
                ? "bg-amber-500 text-slate-955 font-black shadow-[inset_0_1px_3px_rgba(255,255,255,0.4)] shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                : "bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            }`}
          >
            {row.strikePrice.toLocaleString("en-IN")}
          </td>
        );

      case "ceLtp":
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-xs font-black text-rose-600 dark:text-rose-400 ${cellBg}`}>
            {fmt(v)}
          </td>
        );
      case "peLtp":
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-xs font-black text-emerald-600 dark:text-emerald-400 ${cellBg}`}>
            {fmt(v)}
          </td>
        );

      case "ceDelta":
      case "peDelta":
        const isCe = col.key === "ceDelta";
        const deltaColor = isCe 
          ? (v > 0.5 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-slate-500 dark:text-slate-400")
          : (Math.abs(v) > 0.5 ? "text-rose-600 dark:text-rose-400 font-bold" : "text-slate-500 dark:text-slate-400");
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[11px] ${deltaColor} ${cellBg}`}>
            {v.toFixed(3)}
          </td>
        );

      case "ceIV":
      case "peIV":
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[11px] font-bold text-amber-600 dark:text-amber-400 ${cellBg}`}>
            {`${v.toFixed(2)}%`}
          </td>
        );

      case "ceOIChange":
      case "peOIChange":
        if (rank > 0) {
          return (
            <td key={col.key} className={getHighlightClass(rank)}>
              {`${v > 0 ? "+" : ""}${formatOIChange(v)}`}
            </td>
          );
        }
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[11px] ${pctCls(v)} ${cellBg}`}>
            {`${v > 0 ? "+" : ""}${formatOIChange(v)}`}
          </td>
        );

      case "ceOI":
      case "peOI":
        if (rank > 0) {
          return (
            <td key={col.key} className={getHighlightClass(rank)}>
              {formatK(v)}
            </td>
          );
        }
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[11px] font-extrabold text-slate-700 dark:text-slate-300 ${cellBg}`}>
            {formatK(v)}
          </td>
        );

      case "ceVolume":
      case "peVolume":
        if (rank > 0) {
          return (
            <td key={col.key} className={getHighlightClass(rank)}>
              {formatK(v)}
            </td>
          );
        }
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[11px] text-slate-500 dark:text-slate-400 ${cellBg}`}>
            {formatK(v)}
          </td>
        );

      case "ceGamma":
      case "peGamma":
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[10px] text-slate-450 dark:text-slate-500 ${cellBg}`}>
            {v.toFixed(4)}
          </td>
        );

      case "ceTheta":
      case "peTheta":
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[10px] ${v < 0 ? "text-rose-500 dark:text-rose-450" : "text-slate-450 dark:text-slate-500"} ${cellBg}`}>
            {v.toFixed(2)}
          </td>
        );

      case "ceVega":
      case "peVega":
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-[10px] text-violet-600 dark:text-violet-400/80 ${cellBg}`}>
            {v.toFixed(2)}
          </td>
        );

      default:
        return (
          <td key={col.key} className={`anti-flicker-cell px-2 py-2 border border-slate-200 dark:border-slate-800/50 text-center text-xs ${cellBg}`}>
            {v.toFixed(2)}
          </td>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xl transition-colors duration-305">
      {/* Search Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">NSE NIFTY WEEKLY CHAIN</span>
        
        {/* Search strike price */}
        <div className="relative">
          <input
            type="text"
            value={strikeSearch}
            onChange={(e) => setStrikeSearch(e.target.value.replace(/\D/g, ""))}
            placeholder="Search Strike Price..."
            className="w-48 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500/40 text-xs px-2.5 py-1.5 pl-8 rounded-lg outline-none text-slate-800 dark:text-white font-mono placeholder-slate-400 dark:placeholder-slate-500 transition-all"
          />
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {loading && rows.length === 0 ? (
          /* Loading skeleton */
          <div className="p-8 space-y-4 animate-pulse">
            <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-1/4"></div>
            <div className="h-10 bg-slate-100 dark:bg-slate-900 rounded"></div>
            {[...Array(8)].map((_, idx) => (
              <div key={idx} className="h-8 bg-slate-100/50 dark:bg-slate-900/50 rounded flex gap-4">
                <div className="flex-1 bg-slate-100/30 dark:bg-slate-900/30 rounded"></div>
                <div className="w-16 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="flex-1 bg-slate-100/30 dark:bg-slate-900/30 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <table className="border-collapse min-w-full text-center relative select-none">
            <thead className="sticky top-0 z-20 shadow-md">
              {/* Top grouping row */}
              <tr className="h-7 text-[9px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400">
                {activeCols.some((c) => c.side === "CE") && (
                  <th
                    colSpan={activeCols.filter((c) => c.side === "CE").length}
                    className="border border-slate-200 dark:border-slate-800 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 py-1"
                  >
                    ◀ CALL OPTIONS (CE)
                  </th>
                )}
                {visibleCols["strikePrice"] && (
                  <th className="border border-slate-200 dark:border-slate-800 bg-slate-200 dark:bg-slate-900 text-slate-700 dark:text-slate-300 w-[110px] py-1">STRIKE</th>
                )}
                {activeCols.some((c) => c.side === "PE") && (
                  <th
                    colSpan={activeCols.filter((c) => c.side === "PE").length}
                    className="border border-slate-200 dark:border-slate-800 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 py-1"
                  >
                    PUT OPTIONS (PE) ▶
                  </th>
                )}
              </tr>

              {/* Column labels row */}
              <tr className="h-9 text-[10px] font-bold uppercase bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                {activeCols.map((col) => (
                  <th
                    key={col.key}
                    className={`px-2 border border-slate-200 dark:border-slate-800 whitespace-nowrap py-1.5 ${
                      col.key === "strikePrice"
                        ? "sticky left-0 z-10 bg-slate-200 dark:bg-slate-900 text-slate-800 dark:text-white font-black w-[110px] border-r border-slate-200 dark:border-slate-800"
                        : col.side === "CE"
                        ? "text-rose-600 dark:text-rose-300"
                        : "text-emerald-600 dark:text-emerald-300"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredRows.map((row) => {
                const isAtm = row.strikePrice === atmStrike;
                return (
                  <tr
                    key={row.strikePrice}
                    className={`h-9 font-mono transition-all duration-150 ${
                      isAtm
                        ? "border-y-2 border-yellow-500/60 bg-yellow-500/10 dark:bg-yellow-950/20 font-bold"
                        : "hover:bg-slate-100 dark:hover:bg-slate-900/60 odd:bg-slate-50/50 dark:odd:bg-slate-950/20 even:bg-transparent dark:even:bg-slate-900/10"
                    }`}
                  >
                    {activeCols.map((col) => renderCell(col, row, isAtm))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!loading && filteredRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 dark:text-slate-400 font-mono text-xs uppercase tracking-wider">
            No strike prices matched your search query.
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(OptionChainTable);
