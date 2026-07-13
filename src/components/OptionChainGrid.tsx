import React, { useState, useEffect, useRef, useMemo } from "react";
import { OptionStrike } from "../types.js";
import { ShieldAlert, Award, TrendingUp, Compass } from "lucide-react";
import { motion } from "framer-motion";

interface OptionChainGridProps {
  strikes: OptionStrike[];
  spotPrice: number;
  strikeGap: number;
  darkMode: boolean;
  spotChange?: number;
  spotChangePct?: number;
  fontSize: number;
  dayHigh?: number;
  dayLow?: number;
  viewMode?: "standard" | "detailed";
}

function OptionChainGrid({
  strikes,
  spotPrice,
  strikeGap,
  darkMode,
  spotChange = 0,
  spotChangePct = 0,
  fontSize,
  dayHigh = 0,
  dayLow = 0,
  viewMode = "detailed"
}: OptionChainGridProps) {
  // ── Declare ALL hooks at the very top (obey Rules of Hooks) ────────────────
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate ATM Strike (safe fallback if strikes empty)
  const atm = strikes.length > 0 ? Math.round(spotPrice / strikeGap) * strikeGap : 0;

  // Auto-focus ATM on load / strikes change (hook order invariant)
  useEffect(() => {
    if (strikes.length === 0) return;
    if (focusedIndex === null) {
      const atmIndex = strikes.findIndex(s => s.strikePrice === atm);
      if (atmIndex !== -1) {
        setFocusedIndex(atmIndex);
      }
    }
  }, [strikes, atm, focusedIndex]);

  // Auto-scroll the focused row into view (hook order invariant)
  useEffect(() => {
    if (focusedIndex !== null && containerRef.current) {
      const container = containerRef.current;
      const row = container.querySelector(`[data-row-index="${focusedIndex}"]`) as HTMLElement;
      if (row) {
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        const rowTop = row.offsetTop;
        const rowBottom = rowTop + row.clientHeight;

        if (rowTop < containerTop) {
          container.scrollTop = rowTop;
        } else if (rowBottom > containerBottom) {
          container.scrollTop = rowBottom - container.clientHeight;
        }
      }
    }
  }, [focusedIndex]);

  // Key handler (ordinary helper function)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (strikes.length === 0) return;
    let nextIndex = focusedIndex;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (focusedIndex === null) {
        nextIndex = 0;
      } else {
        nextIndex = Math.min(strikes.length - 1, focusedIndex + 1);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (focusedIndex === null) {
        nextIndex = strikes.length - 1;
      } else {
        nextIndex = Math.max(0, focusedIndex - 1);
      }
    }
    if (nextIndex !== focusedIndex && nextIndex !== null) {
      setFocusedIndex(nextIndex);
    }
  };

  // ── Component calculations (calculated safely even if strikes is empty) ────
  // Find global top 3 CE and PE OI levels
  const ceSortedByOI = strikes.length > 0 ? [...strikes].sort((a, b) => b.ceOI - a.ceOI) : [];
  const r1Strike = ceSortedByOI[0]?.strikePrice || atm;
  const r2Strike = ceSortedByOI[1]?.strikePrice || atm;
  const r3Strike = ceSortedByOI[2]?.strikePrice || atm;
  const r1Val = ceSortedByOI[0]?.ceOI || 0;
  const r2Val = ceSortedByOI[1]?.ceOI || 0;
  const r3Val = ceSortedByOI[2]?.ceOI || 0;

  const peSortedByOI = strikes.length > 0 ? [...strikes].sort((a, b) => b.peOI - a.peOI) : [];
  const s1Strike = peSortedByOI[0]?.strikePrice || atm;
  const s2Strike = peSortedByOI[1]?.strikePrice || atm;
  const s3Strike = peSortedByOI[2]?.strikePrice || atm;
  const s1Val = peSortedByOI[0]?.peOI || 0;
  const s2Val = peSortedByOI[1]?.peOI || 0;
  const s3Val = peSortedByOI[2]?.peOI || 0;

  const maxCeOI = r1Val;
  const secondMaxCeOI = r2Val;
  const thirdMaxCeOI = r3Val;
  
  const maxPeOI = s1Val;
  const secondMaxPeOI = s2Val;
  const thirdMaxPeOI = s3Val;

  // Resistance & Support Strengths % (using formula: ((Largest - Second) / Largest) * 100)
  const rStrength = maxCeOI ? parseFloat((((maxCeOI - secondMaxCeOI) / maxCeOI) * 100).toFixed(2)) : 100;
  const sStrength = maxPeOI ? parseFloat((((maxPeOI - secondMaxPeOI) / maxPeOI) * 100).toFixed(2)) : 100;

  // Core Open Interest aggregates removed (relocated to App.tsx dashboard metrics)

  const refSpot = spotPrice || atm;

  const ceZoneAnalysis = useMemo(() => {
    const ceZoneRows = strikes.filter(r => r.strikePrice >= atm);
    const volRows = ceZoneRows.filter(r => Number(r.ceVolume) > 0).sort((a, b) => Number(b.ceVolume) - Number(a.ceVolume));
    const oiRows = ceZoneRows.filter(r => Number(r.ceOI) > 0).sort((a, b) => Number(b.ceOI) - Number(a.ceOI));
    const oiChgRows = ceZoneRows.filter(r => Number(r.ceOIChange) > 0).sort((a, b) => Number(b.ceOIChange) - Number(a.ceOIChange));

    const getVal = (row: any, key: string) => row ? Number(row[key]) : 0;
    const calcGap = (l1: number, l2: number) => {
      if (l2 > 0) return ((l1 - l2) * 100) / l2;
      if (l1 > 0) return 100.0;
      return 0.0;
    };

    return {
      vol: [volRows[0]?.strikePrice || 0, volRows[1]?.strikePrice || 0, volRows[2]?.strikePrice || 0],
      oi: [oiRows[0]?.strikePrice || 0, oiRows[1]?.strikePrice || 0, oiRows[2]?.strikePrice || 0],
      oiChg: [oiChgRows[0]?.strikePrice || 0, oiChgRows[1]?.strikePrice || 0, oiChgRows[2]?.strikePrice || 0],
      volGap: calcGap(getVal(volRows[0], "ceVolume"), getVal(volRows[1], "ceVolume")),
      oiGap: calcGap(getVal(oiRows[0], "ceOI"), getVal(oiRows[1], "ceOI")),
      oiChgGap: calcGap(getVal(oiChgRows[0], "ceOIChange"), getVal(oiChgRows[1], "ceOIChange")),
    };
  }, [strikes, atm]);

  const peZoneAnalysis = useMemo(() => {
    const peZoneRows = strikes.filter(r => r.strikePrice <= atm);
    const volRows = peZoneRows.filter(r => Number(r.peVolume) > 0).sort((a, b) => Number(b.peVolume) - Number(a.peVolume));
    const oiRows = peZoneRows.filter(r => Number(r.peOI) > 0).sort((a, b) => Number(b.peOI) - Number(a.peOI));
    const oiChgRows = peZoneRows.filter(r => Number(r.peOIChange) > 0).sort((a, b) => Number(b.peOIChange) - Number(a.peOIChange));

    const getVal = (row: any, key: string) => row ? Number(row[key]) : 0;
    const calcGap = (l1: number, l2: number) => {
      if (l2 > 0) return ((l1 - l2) * 100) / l2;
      if (l1 > 0) return 100.0;
      return 0.0;
    };

    return {
      vol: [volRows[0]?.strikePrice || 0, volRows[1]?.strikePrice || 0, volRows[2]?.strikePrice || 0],
      oi: [oiRows[0]?.strikePrice || 0, oiRows[1]?.strikePrice || 0, oiRows[2]?.strikePrice || 0],
      oiChg: [oiChgRows[0]?.strikePrice || 0, oiChgRows[1]?.strikePrice || 0, oiChgRows[2]?.strikePrice || 0],
      volGap: calcGap(getVal(volRows[0], "peVolume"), getVal(volRows[1], "peVolume")),
      oiGap: calcGap(getVal(oiRows[0], "peOI"), getVal(oiRows[1], "peOI")),
      oiChgGap: calcGap(getVal(oiChgRows[0], "peOIChange"), getVal(oiChgRows[1], "peOIChange")),
    };
  }, [strikes, atm]);

  const visibilityAnalysis = useMemo(() => {
    const ceVolStrike = ceZoneAnalysis.vol[0] || 0;
    const ceOiStrike = ceZoneAnalysis.oi[0] || 0;
    const ceOiChgStrike = ceZoneAnalysis.oiChg[0] || 0;

    const ceVolDist = ceVolStrike > 0 ? Math.abs(ceVolStrike - atm) : Infinity;
    const ceOiDist = ceOiStrike > 0 ? Math.abs(ceOiStrike - atm) : Infinity;
    const ceOiChgDist = ceOiChgStrike > 0 ? Math.abs(ceOiChgStrike - atm) : Infinity;

    const minCeDist = Math.min(ceVolDist, ceOiDist, ceOiChgDist);
    const showAllCe = minCeDist === Infinity;

    const peVolStrike = peZoneAnalysis.vol[0] || 0;
    const peOiStrike = peZoneAnalysis.oi[0] || 0;
    const peOiChgStrike = peZoneAnalysis.oiChg[0] || 0;

    const peVolDist = peVolStrike > 0 ? Math.abs(peVolStrike - atm) : Infinity;
    const peOiDist = peOiStrike > 0 ? Math.abs(peOiStrike - atm) : Infinity;
    const peOiChgDist = peOiChgStrike > 0 ? Math.abs(peOiChgStrike - atm) : Infinity;

    const minPeDist = Math.min(peVolDist, peOiDist, peOiChgDist);
    const showAllPe = minPeDist === Infinity;

    return {
      ceVolVisible: showAllCe || (ceVolDist === minCeDist),
      ceOiVisible: showAllCe || (ceOiDist === minCeDist),
      ceOiChgVisible: showAllCe || (ceOiChgDist === minCeDist),
      peVolVisible: showAllPe || (peVolDist === minPeDist),
      peOiVisible: showAllPe || (peOiDist === minPeDist),
      peOiChgVisible: showAllPe || (peOiChgDist === minPeDist),
    };
  }, [atm, ceZoneAnalysis, peZoneAnalysis]);

  // Find R1/R2 and S1/S2 values based on closest Large1 to ATM (atm)
  const r1_r2 = useMemo(() => {
    if (strikes.length === 0) return { r1: null, r2: null };
    const candidates = [
      { strike: ceZoneAnalysis.vol[0], type: "V" },
      { strike: ceZoneAnalysis.oi[0], type: "OI" },
      { strike: ceZoneAnalysis.oiChg[0], type: "Chg" }
    ].filter(c => c && c.strike > 0);

    const grouped: { [strike: number]: string[] } = {};
    candidates.forEach(c => {
      if (!grouped[c.strike]) {
        grouped[c.strike] = [];
      }
      grouped[c.strike].push(c.type);
    });

    const levels = Object.keys(grouped).map(strikeStr => {
      const strike = Number(strikeStr);
      return {
        strike,
        types: grouped[strike],
        distance: Math.abs(strike - atm)
      };
    });

    levels.sort((a, b) => a.distance - b.distance);

    return {
      r1: levels[0] || null,
      r2: levels[1] || null,
      r3: levels[2] || null
    };
  }, [ceZoneAnalysis, atm, strikes]);

  const s1_s2 = useMemo(() => {
    if (strikes.length === 0) return { s1: null, s2: null, s3: null };
    const candidates = [
      { strike: peZoneAnalysis.vol[0], type: "V" },
      { strike: peZoneAnalysis.oi[0], type: "OI" },
      { strike: peZoneAnalysis.oiChg[0], type: "Chg" }
    ].filter(c => c && c.strike > 0);

    const grouped: { [strike: number]: string[] } = {};
    candidates.forEach(c => {
      if (!grouped[c.strike]) {
        grouped[c.strike] = [];
      }
      grouped[c.strike].push(c.type);
    });

    const levels = Object.keys(grouped).map(strikeStr => {
      const strike = Number(strikeStr);
      return {
        strike,
        types: grouped[strike],
        distance: Math.abs(strike - atm)
      };
    });

    levels.sort((a, b) => a.distance - b.distance);

    return {
      s1: levels[0] || null,
      s2: levels[1] || null,
      s3: levels[2] || null
    };
  }, [peZoneAnalysis, atm, strikes]);

  // Defensive empty check — NOTE: we no longer unmount the grid when strikes is empty.
  // Instead we render an overlay so the DOM stays stable and doesn't blink.
  const isEmptyStrikes = !strikes || strikes.length === 0;

  const formatLakh = (n: number, withSign = false) => {
    const lakhs = n / 100000;
    const formatted = lakhs.toFixed(2) + "L";
    if (withSign && lakhs > 0) {
      return "+" + formatted;
    }
    return formatted;
  };

  const formatIV = (iv: number) => {
    if (!iv) return "—";
    if (iv < 1) return (iv * 100).toFixed(1) + "%";
    return iv.toFixed(1) + "%";
  };

  const formatGreek = (val?: number, decimals = 2) => {
    if (val === undefined || isNaN(val) || val === null) return "—";
    return val.toFixed(decimals);
  };

  const formatBidAsk = (bid?: number, ask?: number) => {
    if (bid === undefined || ask === undefined || bid === null || ask === null || (!bid && !ask)) return "—";
    return `${bid.toFixed(1)} / ${ask.toFixed(1)}`;
  };

  const getHighlightClassCommon = (rank: number) => {
    if (rank === 1) {
      // Large 1: Dark Red
      return "anti-flicker-cell px-2 py-1.5 border-2 border-[#EF4444] text-center text-[11px] font-black text-[#FFFFFF] bg-[#B91C1C] shadow-[0_0_12px_rgba(185,28,28,0.45),inset_0_0_8px_rgba(239,68,68,0.3)] relative z-10 hover:scale-[1.03] hover:brightness-110 transition-all duration-150 rounded";
    }
    if (rank === 2) {
      // Large 2: Bright Yellow
      return "anti-flicker-cell px-2 py-1.5 border-2 border-[#FACC15] text-center text-[11px] font-black text-[#111827] bg-[#EAB308] shadow-[0_0_12px_rgba(234,179,8,0.4),inset_0_0_8px_rgba(250,204,21,0.3)] relative z-10 hover:scale-[1.02] hover:brightness-110 transition-all duration-150 rounded";
    }
    if (rank === 3) {
      // Large 3: Strong Pink
      return "anti-flicker-cell px-2 py-1.5 border-2 border-[#F472B6] text-center text-[11px] font-black text-[#FFFFFF] bg-[#DB2777] shadow-[0_0_12px_rgba(219,39,119,0.4),inset_0_0_8px_rgba(244,114,182,0.3)] relative z-10 hover:scale-[1.01] hover:brightness-110 transition-all duration-150 rounded";
    }
    return "";
  };

  const getVolumeHighlightClass = (rank: number) => getHighlightClassCommon(rank);

  const getCeHighlightClass = (rank: number) => getVolumeHighlightClass(rank);
  const getPeHighlightClass = (rank: number) => getHighlightClassCommon(rank);
  const getCeVolumeHighlightClass = (rank: number) => getVolumeHighlightClass(rank);

  const getGapColorClass = (val: number) => {
    if (val > 50) return darkMode ? "text-emerald-400 font-black drop-shadow-[0_0_5px_rgba(16,185,129,0.35)]" : "text-emerald-600 font-black";
    if (val > 15) return darkMode ? "text-yellow-400 font-black drop-shadow-[0_0_5px_rgba(234,179,8,0.35)]" : "text-yellow-600 font-black";
    return darkMode ? "text-slate-100 font-extrabold" : "text-slate-700 font-bold";
  };

  // Sentiment analysis variables removed (relocated to App.tsx)



  const cardVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.25 } }
  };

  // Gradient calculator for CE OI heatmap (Red - Call triggers resistance/sellers)
  const getCeOiBg = (val: number) => {
    if (!maxCeOI) return "";
    const ratio = val / maxCeOI;
    if (ratio > 0.8) return darkMode ? "bg-rose-950 text-rose-300" : "bg-rose-100/90 text-rose-900 border-rose-200";
    if (ratio > 0.5) return darkMode ? "bg-rose-900/40 text-rose-400" : "bg-rose-50 text-rose-700 border-rose-100";
    return "";
  };

  // Gradient calculator for PE OI heatmap (Green - Put triggers support/buyers)
  const getPeOiBg = (val: number) => {
    if (!maxPeOI) return "";
    const ratio = val / maxPeOI;
    if (ratio > 0.8) return darkMode ? "bg-emerald-950 text-emerald-300" : "bg-emerald-100/90 text-emerald-950 border-emerald-200";
    if (ratio > 0.5) return darkMode ? "bg-emerald-900/40 text-emerald-400" : "bg-emerald-50 text-emerald-900 border-emerald-100";
    return "";
  };

  // Call Activity Levels (CE L1, L2, L3)
  const ceL1 = r1_r2.r1;
  const ceL2 = r1_r2.r2;
  const ceL3 = r1_r2.r3;

  // Put Activity Levels (PE L1, L2, L3)
  const peL1 = s1_s2.s1;
  const peL2 = s1_s2.s2;
  const peL3 = s1_s2.s3;

  const borderColClass = darkMode ? "border-slate-700/85" : "border-slate-300";
  const cellTextClass = darkMode ? "text-slate-100 font-bold" : "text-slate-800 font-semibold";

  // ── Smart R1 / S1 Highlight Logic ───────────────────────────────────────────
  // Condition 1 (Primary): All 3 CE boxes visible AND 2+ of them have % > 15
  //   → highlight S1 (CE pressure is strong = support confirmed below)
  const ceAllVisible =
    visibilityAnalysis.ceVolVisible &&
    visibilityAnalysis.ceOiVisible &&
    visibilityAnalysis.ceOiChgVisible;

  const ceBoxesAbove15 = [
    visibilityAnalysis.ceVolVisible   ? ceZoneAnalysis.volGap   : 0,
    visibilityAnalysis.ceOiVisible    ? ceZoneAnalysis.oiGap    : 0,
    visibilityAnalysis.ceOiChgVisible ? ceZoneAnalysis.oiChgGap : 0,
  ].filter(v => v > 15).length;

  const cond1_highlightS1 = ceAllVisible && ceBoxesAbove15 >= 2;

  // Condition 2 (Fallback): only VISIBLE boxes count for max% calculation
  const ceMaxGap = Math.max(
    visibilityAnalysis.ceVolVisible   ? ceZoneAnalysis.volGap   : 0,
    visibilityAnalysis.ceOiVisible    ? ceZoneAnalysis.oiGap    : 0,
    visibilityAnalysis.ceOiChgVisible ? ceZoneAnalysis.oiChgGap : 0,
  );
  const peMaxGap = Math.max(
    visibilityAnalysis.peVolVisible   ? peZoneAnalysis.volGap   : 0,
    visibilityAnalysis.peOiVisible    ? peZoneAnalysis.oiGap    : 0,
    visibilityAnalysis.peOiChgVisible ? peZoneAnalysis.oiChgGap : 0,
  );

  // R1 highlight: Cond1 fail + CE dominant + visible CE max% > 15
  const cond2_highlightR1 = !cond1_highlightS1
    && ceMaxGap > peMaxGap
    && ceMaxGap > 15;

  // S1 highlight (fallback): Cond1 fail + PE dominant + visible PE max% > 15
  const cond2_highlightS1 = !cond1_highlightS1
    && peMaxGap > ceMaxGap
    && peMaxGap > 15;

  // Final flags
  const highlightR1 = cond2_highlightR1;
  const highlightS1 = cond1_highlightS1 || cond2_highlightS1;

  return (
    <div className="w-full h-auto flex flex-col gap-2 select-none relative">
      {/* Loading overlay — shown when strikes not yet received; keeps the grid mounted */}
      {isEmptyStrikes && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-slate-950/80 backdrop-blur-sm pointer-events-none">
          <span className="font-mono text-xs uppercase tracking-wider text-slate-400 animate-pulse">
            Loading Option Chain…
          </span>
        </div>
      )}
      <style>{`
        /* Premium custom scrollbar styling */
        .option-chain-container::-webkit-scrollbar {
          height: 6px;
          width: 6px;
        }
        .option-chain-container::-webkit-scrollbar-track {
          background: ${darkMode ? "rgba(15,23,42,0.4)" : "rgba(241,245,249,0.5)"};
          border-radius: 8px;
        }
        .option-chain-container::-webkit-scrollbar-thumb {
          background: ${darkMode ? "rgba(99,102,241,0.25)" : "rgba(99,102,241,0.2)"};
          border-radius: 8px;
          transition: all 0.2s ease;
        }
        .option-chain-container::-webkit-scrollbar-thumb:hover {
          background: ${darkMode ? "rgba(99,102,241,0.55)" : "rgba(99,102,241,0.5)"};
        }
        
        @keyframes antigravity-float {
          0% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-4px);
          }
          100% {
            transform: translateY(0px);
          }
        }
        .float-animation {
          display: inline-flex;
          animation: antigravity-float 2.5s ease-in-out infinite;
        }
        .option-chain-table {
          table-layout: fixed !important;
          width: 100% !important;
          border-collapse: collapse !important;
        }
        .option-chain-table th, 
        .option-chain-table td {
          white-space: nowrap !important;
          padding: 5px 6px !important;
          border: 1px solid ${darkMode ? "#1d2a45" : "#e2e8f0"} !important;
          text-overflow: ellipsis;
          overflow: hidden;
          transition: all 0.18s ease;
        }
        .center-strike-column {
          width: 110px !important;
          min-width: 110px !important;
          max-width: 110px !important;
          overflow: hidden !important;
          padding: 5px 4px !important;
          text-align: center !important;
        }
        .pe-ltp-header {
          padding-left: 6px !important;
          border-left: 3px solid ${darkMode ? "rgba(34,211,238,0.4)" : "#0891b2"} !important;
        }
        .ltp-column {
          width: 10% !important;
          min-width: 85px !important;
        }

        /* Alternating zebra backgrounds inside NTM */
        .ntm-row-even {
          background-color: ${darkMode ? "rgba(17, 26, 48, 0.85)" : "rgba(224, 231, 255, 0.4)"} !important;
        }
        .ntm-row-odd {
          background-color: ${darkMode ? "rgba(9, 14, 27, 0.8)" : "rgba(248, 250, 252, 0.65)"} !important;
        }

        /* Line by line border separation inside NTM (4 up and 4 down) */
        .ntm-cell {
          border-top: 1.5px solid ${darkMode ? "#3b4f7a" : "#94a3b8"} !important;
          border-bottom: 1.5px solid ${darkMode ? "#3b4f7a" : "#94a3b8"} !important;
        }
        
        .ntm-strike-cell {
          border-top: 1.5px solid ${darkMode ? "#3b4f7a" : "#94a3b8"} !important;
          border-bottom: 1.5px solid ${darkMode ? "#3b4f7a" : "#94a3b8"} !important;
          border-left: 2.5px solid ${darkMode ? "#3b4f7a" : "#64748b"} !important;
          border-right: 2.5px solid ${darkMode ? "#3b4f7a" : "#64748b"} !important;
        }
        
        /* The ATM Row Cells - Light Yellow background + bold golden borders */
        .atm-cell {
          background-color: ${darkMode ? "rgba(234, 179, 8, 0.16)" : "rgba(254, 240, 138, 0.65)"} !important;
          border-top: 2.5px solid ${darkMode ? "#eab308" : "#d97706"} !important;
          border-bottom: 2.5px solid ${darkMode ? "#eab308" : "#d97706"} !important;
        }

        .atm-strike-cell {
          background-color: ${darkMode ? "rgba(234, 179, 8, 0.28)" : "rgba(254, 240, 138, 0.95)"} !important;
          border: 2.5px solid ${darkMode ? "#eab308" : "#d97706"} !important;
          color: ${darkMode ? "#facc15" : "#713f12"} !important;
          font-weight: 900 !important;
        }

        /* NTM Zone boundary separation */
        .ntm-boundary-top {
          border-top: 2.5px solid ${darkMode ? "#6366f1" : "#4f46e5"} !important;
        }
        .ntm-boundary-bottom {
          border-bottom: 2.5px solid ${darkMode ? "#6366f1" : "#4f46e5"} !important;
        }
      `}</style>
      {strikes.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-slate-400 font-mono">
          Loading Option Chain data...
        </div>
      ) : (
        <>
          {/* Real-time Option Strike Spreadsheet */}
          <div 
            ref={containerRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className={`w-full h-auto overflow-x-auto overflow-y-visible focus:outline-none focus:ring-2 focus:ring-teal-500/50 cursor-default option-chain-container transition-all text-current`}
          >
            <table className={`option-chain-table border-collapse w-full text-center ${viewMode === "detailed" ? "min-w-[1610px]" : "min-w-[1050px]"}`}>
              <colgroup>
                {viewMode === "standard" ? (
                  <>
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "110px", minWidth: "110px", maxWidth: "110px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "110px" }} />
                  </>
                ) : (
                  <>
                    {/* CE Side (10 columns) */}
                    <col style={{ width: "55px" }} />   {/* IV */}
                    <col style={{ width: "60px" }} />   {/* Delta */}
                    <col style={{ width: "60px" }} />   {/* Gamma */}
                    <col style={{ width: "60px" }} />   {/* Theta */}
                    <col style={{ width: "60px" }} />   {/* Vega */}
                    <col style={{ width: "115px" }} />  {/* Bid/Ask */}
                    <col style={{ width: "75px" }} />   {/* Vol */}
                    <col style={{ width: "85px" }} />   {/* OI */}
                    <col style={{ width: "95px" }} />   {/* OI Chg */}
                    <col style={{ width: "85px" }} />   {/* LTP */}
                    
                    {/* Strike */}
                    <col style={{ width: "110px", minWidth: "110px", maxWidth: "110px" }} />
                    
                    {/* PE Side (10 columns) */}
                    <col style={{ width: "85px" }} />   {/* LTP */}
                    <col style={{ width: "115px" }} />  {/* Bid/Ask */}
                    <col style={{ width: "75px" }} />   {/* Vol */}
                    <col style={{ width: "95px" }} />   {/* OI Chg */}
                    <col style={{ width: "85px" }} />   {/* OI */}
                    <col style={{ width: "55px" }} />   {/* IV */}
                    <col style={{ width: "60px" }} />   {/* Delta */}
                    <col style={{ width: "60px" }} />   {/* Gamma */}
                    <col style={{ width: "60px" }} />   {/* Theta */}
                    <col style={{ width: "60px" }} />   {/* Vega */}
                  </>
                )}
              </colgroup>
              <thead>
                {/* Blank Placeholder % Gap Boxes with Spot Box in middle */}
                <tr className={darkMode ? "bg-[#0e1628]/40 text-slate-200" : "bg-slate-50/40 text-slate-800"}>
                  {viewMode === "standard" ? (
                    <>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.ceVolVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightR1 ? "ring-2 ring-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            ceZoneAnalysis.volGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : ceZoneAnalysis.volGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {ceZoneAnalysis.volGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.ceOiVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightR1 ? "ring-2 ring-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            ceZoneAnalysis.oiGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : ceZoneAnalysis.oiGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {ceZoneAnalysis.oiGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.ceOiChgVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightR1 ? "ring-2 ring-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            ceZoneAnalysis.oiChgGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : ceZoneAnalysis.oiChgGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {ceZoneAnalysis.oiChgGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        {/* Day High Box above CE LTP */}
                        <div className={`h-7 w-full rounded-lg border flex items-center justify-between px-2 shadow-md transition-all duration-300 ${
                          darkMode
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[inset_0_0_6px_rgba(16,185,129,0.1)]"
                            : "bg-emerald-50 border-emerald-200 text-emerald-800"
                        }`}>
                          <span className={`font-black uppercase tracking-wider ${darkMode ? "text-emerald-400/85" : "text-emerald-600"}`} style={{ fontSize: `${Math.max(7, fontSize - 3)}px` }}>HIGH</span>
                          <span className="font-black font-mono" style={{ fontSize: `${fontSize + 1.5}px` }}>
                            {dayHigh > 0 ? Math.round(dayHigh) : "0"}
                          </span>
                        </div>
                      </th>
                    </>
                  ) : (
                    <>
                      {/* Detailed CE side Gaps */}
                      <th colSpan={6} className={`p-1 border ${borderColClass}`} />
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.ceVolVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightR1 ? "ring-2 ring-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            ceZoneAnalysis.volGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : ceZoneAnalysis.volGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {ceZoneAnalysis.volGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.ceOiVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightR1 ? "ring-2 ring-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            ceZoneAnalysis.oiGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : ceZoneAnalysis.oiGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {ceZoneAnalysis.oiGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.ceOiChgVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightR1 ? "ring-2 ring-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            ceZoneAnalysis.oiChgGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : ceZoneAnalysis.oiChgGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {ceZoneAnalysis.oiChgGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        {/* Day High Box above CE LTP (Detailed) */}
                        <div className={`h-7 w-full rounded-lg border flex items-center justify-between px-2.5 shadow-sm transition-all duration-300 ${
                          darkMode
                            ? "bg-emerald-950/60 border-emerald-600 text-emerald-400 shadow-[inset_0_0_8px_rgba(16,185,129,0.15)]"
                            : "bg-[#E8F5E9] border-[#43A047]/60 text-[#1B5E20]"
                        }`}>
                          <span className="font-black uppercase tracking-wider flex items-center gap-1 text-[8px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            HIGH
                          </span>
                          <span className="font-extrabold font-mono" style={{ fontSize: `${fontSize + 1.5}px` }}>
                            {dayHigh > 0 ? dayHigh.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "0.0"}
                          </span>
                        </div>
                      </th>
                    </>
                  )}

                  {/* Spot Box spans rowSpan={3} in the center with a premium black glassmorphism layout */}
                  <th 
                    rowSpan={3}
                    className={`border-x center-strike-column relative p-2 transition-all duration-300 ${
                      darkMode 
                        ? "bg-slate-955/95 border-slate-850 shadow-[0_8px_32px_rgba(0,0,0,0.65),inset_0_1px_1px_rgba(255,255,255,0.05)] text-slate-100" 
                        : "bg-slate-50 border-slate-300 shadow-[0_6px_20px_rgba(0,0,0,0.05),inset_0_1.5px_0_rgba(255,255,255,0.8)] text-slate-900"
                    }`}
                    style={{ width: "110px", minWidth: "110px", maxWidth: "110px", verticalAlign: "middle" }}
                  >
                    {/* Glowing Top Accent Line: Green for positive day, Red for negative day */}
                    <div className={`absolute top-0 left-0 right-0 h-[3px] shadow-[0_1.5px_8px_rgba(0,0,0,0.2)] transition-all duration-300 ${
                      spotChange >= 0 
                        ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 shadow-[0_1.5px_6px_rgba(16,185,129,0.5)]" 
                        : "bg-gradient-to-r from-rose-500 via-pink-500 to-rose-500 shadow-[0_1.5px_6px_rgba(239,68,68,0.5)]"
                    }`} />

                    <div className="flex flex-col items-center justify-between text-center select-none w-full font-mono py-0.5">
                      {/* Premium Header */}
                      <div className="flex items-center justify-between w-full px-0.5 select-none mb-1">
                        <span className={`font-black tracking-wider uppercase leading-none ${
                          darkMode ? "text-slate-500" : "text-slate-400"
                        }`} style={{ fontSize: `${Math.max(7, fontSize - 3)}px` }}>SPOT TICKER</span>
                        <div className="flex items-center gap-1">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                              spotChange >= 0 ? "bg-emerald-400" : "bg-rose-400"
                            }`}></span>
                            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                              spotChange >= 0 ? "bg-emerald-500" : "bg-rose-500"
                            }`}></span>
                          </span>
                          <span className={`font-black tracking-wider uppercase ${
                            spotChange >= 0 
                              ? "text-emerald-500 dark:text-emerald-400" 
                              : "text-rose-500 dark:text-rose-400"
                          }`} style={{ fontSize: `${Math.max(6, fontSize - 4)}px` }}>LIVE</span>
                        </div>
                      </div>

                      {/* Glowing spot value (Center) */}
                      <div className="flex justify-center items-center w-full mt-1.5 select-none">
                        <span className={`font-black tracking-tight block leading-none transition-all duration-300 ${
                          spotChange >= 0 
                            ? "text-emerald-500 dark:text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]" 
                            : "text-rose-500 dark:text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.4)]"
                        }`} style={{ fontSize: `${fontSize + 6}px` }}>
                          {spotPrice > 0 ? spotPrice.toFixed(1) : "0.0"}
                        </span>
                      </div>

                      {/* Footer telemetry and change indicators */}
                      <div className="flex flex-col gap-1 w-full mt-2 select-none">
                        {/* Range Telemetry pill */}
                        <div className={`w-full border rounded py-0.5 px-1.5 flex items-center justify-between transition-all duration-300 ${
                          darkMode 
                            ? "bg-slate-900/60 border-slate-800 text-slate-350" 
                            : "bg-slate-100 border-slate-200 text-slate-705"
                        }`}>
                          <span className={`font-extrabold ${darkMode ? "text-slate-500" : "text-slate-400"}`} style={{ fontSize: `${Math.max(7, fontSize - 3)}px` }}>RANGE:</span>
                          <span className={`font-black ${darkMode ? "text-amber-450" : "text-amber-600"}`} style={{ fontSize: `${Math.max(7, fontSize - 3)}px` }}>
                            {dayHigh > 0 && dayLow > 0 
                              ? (dayHigh - dayLow).toFixed(1)
                              : "0.0"}
                          </span>
                        </div>

                        {/* Spot value change percentage badges */}
                        <div className="flex gap-1 w-full justify-between leading-none mt-1">
                          {/* Absolute Change Badge */}
                          <div className={`flex-1 flex justify-center items-center py-0.5 rounded font-black border transition-all duration-300 ${
                            spotChange >= 0 
                              ? darkMode ? "bg-emerald-950/60 border-emerald-600 text-emerald-400 shadow-[inset_0_0_8px_rgba(16,185,129,0.15)]" : "bg-[#E8F5E9] border-[#43A047]/60 text-[#1B5E20]"
                              : darkMode ? "bg-rose-950/60 border-rose-600 text-rose-400 shadow-[inset_0_0_8px_rgba(239,68,68,0.15)]" : "bg-[#FFEBEE] border-[#E53935]/60 text-[#B71C1C]"
                          }`} style={{ fontSize: `${fontSize - 1.5}px` }}>
                            {spotChange >= 0 ? `+${spotChange.toFixed(0)}` : spotChange.toFixed(0)}
                          </div>

                          {/* Percentage Change Badge */}
                          <div className={`flex-1 flex justify-center items-center py-0.5 rounded font-black border transition-all duration-300 ${
                            spotChange >= 0 
                              ? darkMode ? "bg-emerald-950/60 border-emerald-600 text-emerald-400 shadow-[inset_0_0_8px_rgba(16,185,129,0.15)]" : "bg-[#E8F5E9] border-[#43A047]/60 text-[#1B5E20]"
                              : darkMode ? "bg-rose-950/60 border-rose-600 text-rose-400 shadow-[inset_0_0_8px_rgba(239,68,68,0.15)]" : "bg-[#FFEBEE] border-[#E53935]/60 text-[#B71C1C]"
                          }`} style={{ fontSize: `${fontSize - 1.5}px` }}>
                            {spotChange >= 0 ? `+${spotChangePct.toFixed(1)}%` : `${spotChangePct.toFixed(1)}%`}
                          </div>
                        </div>
                      </div>
                    </div>
                  </th>

                  {/* PE side blank placeholder boxes */}
                  {viewMode === "standard" ? (
                    <>
                      <th className={`p-1 border ${borderColClass}`}>
                        {/* Day Low Box above PE LTP */}
                        <div className={`h-7 w-full rounded-lg border flex items-center justify-between px-2.5 shadow-sm transition-all duration-300 ${
                          darkMode
                            ? "bg-rose-950/60 border-rose-600 text-rose-400 shadow-[inset_0_0_8px_rgba(239,68,68,0.15)]"
                            : "bg-[#FFEBEE] border-[#E53935]/60 text-[#B71C1C]"
                        }`}>
                          <span className="font-black uppercase tracking-wider flex items-center gap-1 text-[8px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                            LOW
                          </span>
                          <span className="font-extrabold font-mono" style={{ fontSize: `${fontSize + 1.5}px` }}>
                            {dayLow > 0 ? dayLow.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "0.0"}
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.peOiChgVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightS1 ? "ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            peZoneAnalysis.oiChgGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : peZoneAnalysis.oiChgGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {peZoneAnalysis.oiChgGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.peOiVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightS1 ? "ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            peZoneAnalysis.oiGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : peZoneAnalysis.oiGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {peZoneAnalysis.oiGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.peVolVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightS1 ? "ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            peZoneAnalysis.volGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : peZoneAnalysis.volGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {peZoneAnalysis.volGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                    </>
                  ) : (
                    <>
                      <th className={`p-1 border ${borderColClass}`}>
                        {/* Day Low Box above PE LTP (Detailed) */}
                        <div className={`h-7 w-full rounded-lg border flex items-center justify-between px-2 shadow-md transition-all duration-300 ${
                          darkMode
                            ? "bg-rose-500/10 border-rose-500/20 text-rose-400 shadow-[inset_0_0_6px_rgba(239,68,68,0.1)]"
                            : "bg-rose-50 border-rose-200 text-rose-805"
                        }`}>
                          <span className={`font-black uppercase tracking-wider ${darkMode ? "text-rose-455/85" : "text-rose-600"}`} style={{ fontSize: `${Math.max(7, fontSize - 3)}px` }}>LOW</span>
                          <span className="font-black font-mono" style={{ fontSize: `${fontSize + 1.5}px` }}>
                            {dayLow > 0 ? Math.round(dayLow) : "0"}
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`} /> {/* PE Bid/Ask */}
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.peVolVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightS1 ? "ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            peZoneAnalysis.volGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : peZoneAnalysis.volGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {peZoneAnalysis.volGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.peOiChgVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightS1 ? "ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            peZoneAnalysis.oiChgGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : peZoneAnalysis.oiChgGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {peZoneAnalysis.oiChgGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th className={`p-1 border ${borderColClass}`}>
                        <div className={`h-7 w-full rounded-lg border bg-yellow-100 border-yellow-400 flex items-center justify-center shadow-md transition-all duration-300 relative ${
                          visibilityAnalysis.peOiVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                        } ${highlightS1 ? "ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : ""}`}>
                          <div className={`absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r ${
                            peZoneAnalysis.oiGap > 50 
                              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                              : peZoneAnalysis.oiGap > 15 
                                ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.7)]" 
                                : "bg-slate-400"
                          }`} />
                          <span className="text-black font-black font-mono pl-1" style={{ fontSize: `${fontSize + 2.5}px` }}>
                            {peZoneAnalysis.oiGap.toFixed(1)}%
                          </span>
                        </div>
                      </th>
                      <th colSpan={5} className={`p-1 border ${borderColClass}`} /> {/* PE IV, Delta, Gamma, Theta, Vega */}
                    </>
                  )}
                </tr>

                {/* ROW 1: OI Support & Resistance Walls */}
                <tr className={`border-b ${darkMode ? "bg-[#070c16]/80 border-[#1d2a45]" : "bg-slate-100/70 border-slate-300"}`}>
                  <th colSpan={viewMode === "standard" ? 4 : 10} className={`p-2 border-r ${borderColClass}`}>
                    <div className="flex items-center justify-center gap-1.5 flex-nowrap overflow-x-visible">
                      <span className="font-black text-rose-500 uppercase tracking-wider mr-2 font-mono" style={{ fontSize: `${fontSize - 1}px` }}>CE OI Resistance:</span>
                      {/* R1 Card */}
                      <div className={`px-2.5 py-1 rounded-lg font-black tracking-wide border transition-all duration-300 shadow-sm hover:scale-[1.02] flex-shrink-0 ${
                        highlightR1
                          ? "bg-rose-600 text-white border-rose-455 shadow-[0_0_12px_rgba(239,68,68,0.45)] scale-[1.02] animate-pulse ring-2 ring-rose-404/60"
                          : darkMode
                            ? "bg-rose-955/30 text-rose-100 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.18)]"
                            : "bg-gradient-to-r from-red-50 to-rose-50 text-rose-800 border-rose-300"
                      }`} style={{ fontSize: `${fontSize}px` }}>
                        <span className={`mr-1 font-black ${highlightR1 ? "text-white" : "text-rose-500 dark:text-rose-400"}`}>R1:</span>
                        <span>{r1Strike}</span>
                        <span className="text-[9px] opacity-75 font-mono ml-1.5">({formatLakh(r1Val)})</span>
                        {highlightR1 && <span className="ml-1.5 text-[8.5px] font-black tracking-widest text-yellow-300 animate-pulse">⚡ DOM</span>}
                      </div>
                      
                      {/* R2 Card */}
                      <div className={`px-2.5 py-1 rounded-lg font-extrabold border shadow-sm transition-all duration-300 hover:scale-[1.01] flex-shrink-0 ${
                        darkMode 
                          ? "bg-rose-955/15 text-rose-200 border-rose-500/35" 
                          : "bg-rose-50/60 text-rose-800 border-rose-200"
                      }`} style={{ fontSize: `${fontSize}px` }}>
                        <span className="text-rose-500/90 dark:text-rose-400/90 mr-1 font-bold">R2:</span>
                        <span>{r2Strike}</span>
                        <span className="text-[9px] opacity-70 font-mono ml-1.5">({formatLakh(r2Val)})</span>
                      </div>
                      
                      {/* R3 Card */}
                      <div className={`px-2.5 py-1 rounded-lg font-bold border shadow-sm transition-all duration-300 flex-shrink-0 ${
                        darkMode 
                          ? "bg-rose-955/10 text-rose-300/80 border-rose-500/20" 
                          : "bg-rose-50/40 text-rose-705 border-rose-100"
                      }`} style={{ fontSize: `${fontSize}px` }}>
                        <span className="text-rose-500/70 dark:text-rose-400/70 mr-1 font-semibold">R3:</span>
                        <span>{r3Strike}</span>
                        <span className="text-[8.5px] opacity-65 font-mono ml-1.5">({formatLakh(r3Val)})</span>
                      </div>
                    </div>
                  </th>
                  <th colSpan={viewMode === "standard" ? 4 : 10} className={`p-2 border-l ${borderColClass}`}>
                    <div className="flex items-center justify-center gap-1.5 flex-nowrap overflow-x-visible">
                      <span className="font-black text-emerald-500 uppercase tracking-wider mr-2 font-mono" style={{ fontSize: `${fontSize - 1}px` }}>PE OI Support:</span>
                      {/* S1 Card */}
                      <div className={`px-2.5 py-1 rounded-lg font-black tracking-wide border transition-all duration-300 shadow-sm hover:scale-[1.02] flex-shrink-0 ${
                        highlightS1
                          ? "bg-emerald-505 text-white border-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.5)] scale-[1.02] animate-pulse ring-2 ring-emerald-300/60"
                          : darkMode
                            ? "bg-emerald-950/30 text-emerald-100 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.18)]"
                            : "bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-800 border-emerald-300"
                      }`} style={{ fontSize: `${fontSize}px` }}>
                        <span className={`mr-1 font-black ${highlightS1 ? "text-white" : "text-emerald-500 dark:text-emerald-450"}`}>S1:</span>
                        <span>{s1Strike}</span>
                        <span className="text-[9px] opacity-75 font-mono ml-1.5">({formatLakh(s1Val)})</span>
                        {cond1_highlightS1 && <span className="ml-1.5 text-[8.5px] font-black tracking-widest text-yellow-255 animate-pulse">⚡ WALL</span>}
                        {cond2_highlightS1 && !cond1_highlightS1 && <span className="ml-1.5 text-[8.5px] font-black tracking-widest text-yellow-255 animate-pulse">⚡ DOM</span>}
                      </div>
                      
                      {/* S2 Card */}
                      <div className={`px-2.5 py-1 rounded-lg font-extrabold border shadow-sm transition-all duration-300 hover:scale-[1.01] flex-shrink-0 ${
                        darkMode 
                          ? "bg-emerald-955/15 text-emerald-200 border-emerald-500/35" 
                          : "bg-emerald-50/60 text-emerald-800 border-emerald-200"
                      }`} style={{ fontSize: `${fontSize}px` }}>
                        <span className="text-emerald-500/90 dark:text-emerald-400/90 mr-1 font-bold">S2:</span>
                        <span>{s2Strike}</span>
                        <span className="text-[9px] opacity-70 font-mono ml-1.5">({formatLakh(s2Val)})</span>
                      </div>
                      
                      {/* S3 Card */}
                      <div className={`px-2.5 py-1 rounded-lg font-bold border shadow-sm transition-all duration-300 flex-shrink-0 ${
                        darkMode 
                          ? "bg-emerald-955/10 text-emerald-300/80 border-emerald-500/20" 
                          : "bg-emerald-50/40 text-emerald-705 border-emerald-100"
                      }`} style={{ fontSize: `${fontSize}px` }}>
                        <span className="text-emerald-500/70 dark:text-emerald-400/70 mr-1 font-semibold">S3:</span>
                        <span>{s3Strike}</span>
                        <span className="text-[8.5px] opacity-65 font-mono ml-1.5">({formatLakh(s3Val)})</span>
                      </div>
                    </div>
                  </th>
                </tr>

                {/* ROW 2: Near-ATM Large Activity Levels */}
                <tr className={`border-b ${darkMode ? "bg-[#0b1220]/45 border-[#1d2a45]" : "bg-slate-100/50 border-slate-300"}`}>
                  {/* CE Side Call Activity Spikes (L1, L2, L3) */}
                  <th colSpan={viewMode === "standard" ? 4 : 10} className={`p-2 border-r ${borderColClass}`}>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <span className="font-black text-[#B91C1C] dark:text-rose-400 uppercase tracking-wider mr-2 font-mono" style={{ fontSize: `${fontSize - 1}px` }}>CE Large Spikes:</span>
                      {ceL1 ? (
                        <div className="px-2.5 py-1 rounded-lg font-black border bg-[#B91C1C] text-white border-[#EF4444] shadow-sm flex items-center gap-1.5 transition-all hover:scale-[1.02]" style={{ fontSize: `${fontSize}px` }}>
                          <span>L1: {ceL1.strike}</span>
                          <span className="text-[8px] bg-black/35 px-1 py-0.2 rounded font-mono">({ceL1.types.join("/")})</span>
                        </div>
                      ) : <span className="text-[10px] font-mono text-slate-500">—</span>}
                      {ceL2 && (
                        <div className="px-2.5 py-1 rounded-lg font-black border bg-[#EAB308] text-[#111827] border-[#FACC15] shadow-sm flex items-center gap-1.5 transition-all hover:scale-[1.01]" style={{ fontSize: `${fontSize}px` }}>
                          <span>L2: {ceL2.strike}</span>
                          <span className="text-[8px] bg-black/10 px-1 py-0.2 rounded font-mono">({ceL2.types.join("/")})</span>
                        </div>
                      )}
                      {ceL3 && (
                        <div className="px-2.5 py-1 rounded-lg font-black border bg-[#DB2777] text-white border-[#F472B6] shadow-sm flex items-center gap-1.5 transition-all hover:scale-[1.01]" style={{ fontSize: `${fontSize}px` }}>
                          <span>L3: {ceL3.strike}</span>
                          <span className="text-[8px] bg-black/25 px-1 py-0.2 rounded font-mono">({ceL3.types.join("/")})</span>
                        </div>
                      )}
                    </div>
                  </th>
                  {/* PE Side Put Activity Spikes (L1, L2, L3) */}
                  <th colSpan={viewMode === "standard" ? 4 : 10} className={`p-2 border-l ${borderColClass}`}>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <span className="font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mr-2 font-mono" style={{ fontSize: `${fontSize - 1}px` }}>PE Large Spikes:</span>
                      {peL1 ? (
                        <div className="px-2.5 py-1 rounded-lg font-black border bg-[#B91C1C] text-white border-[#EF4444] shadow-sm flex items-center gap-1.5 transition-all hover:scale-[1.02]" style={{ fontSize: `${fontSize}px` }}>
                          <span>L1: {peL1.strike}</span>
                          <span className="text-[8px] bg-black/35 px-1 py-0.2 rounded font-mono">({peL1.types.join("/")})</span>
                        </div>
                      ) : <span className="text-[10px] font-mono text-slate-500">—</span>}
                      {peL2 && (
                        <div className="px-2.5 py-1 rounded-lg font-black border bg-[#EAB308] text-[#111827] border-[#FACC15] shadow-sm flex items-center gap-1.5 transition-all hover:scale-[1.01]" style={{ fontSize: `${fontSize}px` }}>
                          <span>L2: {peL2.strike}</span>
                          <span className="text-[8px] bg-black/10 px-1 py-0.2 rounded font-mono">({peL2.types.join("/")})</span>
                        </div>
                      )}
                      {peL3 && (
                        <div className="px-2.5 py-1 rounded-lg font-black border bg-[#DB2777] text-white border-[#F472B6] shadow-sm flex items-center gap-1.5 transition-all hover:scale-[1.01]" style={{ fontSize: `${fontSize}px` }}>
                          <span>L3: {peL3.strike}</span>
                          <span className="text-[8px] bg-black/25 px-1 py-0.2 rounded font-mono">({peL3.types.join("/")})</span>
                        </div>
                      )}
                    </div>
                  </th>
                </tr>

                {/* Parameter Column Headers */}
                <tr className={`h-7.5 font-semibold text-[9px] md:text-[10px] uppercase tracking-wider ${
                  darkMode ? "text-slate-350 bg-[#0e1628] border-b border-[#1d2a45]" : "text-slate-700 bg-slate-100 border-b border-slate-300"
                }`}>
                  {viewMode === "standard" ? (
                    <>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>CE VOLUME</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>CE OI</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>CE OI CHANGE</th>
                      <th className={`px-1.5 md:px-2 border font-semibold text-teal-400 bg-teal-950/15 ltp-column ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>CE LTP</th>
                    </>
                  ) : (
                    <>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>IV</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>DELTA</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>GAMMA</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>THETA</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>VEGA</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>BID / ASK</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>VOLUME</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>OI</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>OI CHG</th>
                      <th className={`px-1.5 md:px-2 border font-semibold text-teal-400 bg-teal-950/15 ltp-column ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>LTP</th>
                    </>
                  )}
                  <th 
                    className={`px-1.5 md:px-2 border center-strike-column ${
                      darkMode ? "bg-[#0b1220] text-cyan-400 border-[#1d2a45]" : "bg-slate-100 text-cyan-705 border-slate-300"
                    }`} 
                    style={{ 
                      fontSize: `${fontSize}px`,
                      width: "110px", 
                      minWidth: "110px",
                      maxWidth: "110px",
                      verticalAlign: "middle"
                    }}
                  >
                    STRIKE
                  </th>
                  {viewMode === "standard" ? (
                    <>
                      <th className={`px-1.5 md:px-2 border font-semibold text-teal-400 bg-teal-950/15 pe-ltp-header ltp-column ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>PE LTP</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>PE OI CHANGE</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>PE OI</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>PE VOLUME</th>
                    </>
                  ) : (
                    <>
                      <th className={`px-1.5 md:px-2 border font-semibold text-teal-400 bg-teal-950/15 pe-ltp-header ltp-column ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>LTP</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>BID / ASK</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>VOLUME</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>OI CHG</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass}`} style={{ fontSize: `${fontSize}px` }}>OI</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>IV</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>DELTA</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>GAMMA</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>THETA</th>
                      <th className={`px-1.5 md:px-2 border font-semibold ${borderColClass} text-slate-450 dark:text-slate-400`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>VEGA</th>
                    </>
                  )}
                </tr>
              </thead>
              
              <tbody className={`divide-y font-mono text-[10px] md:text-[11px] ${
                darkMode ? "divide-[#1d2a45]/60" : "divide-slate-300"
              }`}>
                {strikes.map((s, index) => {
                  const isAtm = s.strikePrice === atm;
                  const isResistance = s.strikePrice === r1Strike;
                  const isSupport = s.strikePrice === s1Strike;
                  const isFocused = index === focusedIndex;

                  // Color mapping states
                  const ceOiGradient = getCeOiBg(s.ceOI);
                  const peOiGradient = getPeOiBg(s.peOI);

                  // Shaded background for ITM (In the money) options - Premium Amber Satin-Gradient Highlights
                  const ceOtmClass = s.strikePrice < atm 
                    ? (darkMode 
                        ? "bg-gradient-to-r from-amber-500/[0.04] to-amber-500/[0.01] hover:from-amber-500/[0.07] hover:to-amber-500/[0.02]" 
                        : "bg-gradient-to-r from-amber-100/25 to-amber-50/5 hover:from-amber-100/40 hover:to-amber-50/10") 
                    : "";
                  const peOtmClass = s.strikePrice > atm 
                    ? (darkMode 
                        ? "bg-gradient-to-l from-amber-500/[0.04] to-amber-500/[0.01] hover:from-amber-500/[0.07] hover:to-amber-500/[0.02]" 
                        : "bg-gradient-to-l from-amber-100/25 to-amber-50/5 hover:from-amber-100/40 hover:to-amber-50/10") 
                    : "";

                  // Find ATM index to identify Near-The-Money 4-up / 4-down zone
                  const atmIndex = strikes.findIndex(row => row.strikePrice === atm);
                  const isNearMoney = atmIndex !== -1 && Math.abs(index - atmIndex) <= 4;
                  const isNtmBoundaryTop = atmIndex !== -1 && index === atmIndex - 4;
                  const isNtmBoundaryBottom = atmIndex !== -1 && index === atmIndex + 4;

                  // Define the premium custom border and background classes to apply
                  let cellBorderClass = "";
                  if (isAtm) {
                    cellBorderClass = "atm-cell";
                  } else if (isNearMoney) {
                    const isEven = index % 2 === 0;
                    cellBorderClass = `ntm-cell ${isEven ? "ntm-row-even" : "ntm-row-odd"}`;
                    if (isNtmBoundaryTop) {
                      cellBorderClass += " ntm-boundary-top";
                    }
                    if (isNtmBoundaryBottom) {
                      cellBorderClass += " ntm-boundary-bottom";
                    }
                  } else {
                    cellBorderClass = borderColClass;
                  }

                  // ATM cell background highlight
                  const atmBgClass = isAtm ? "atm-cell" : "";

                  // Row styling - alternate slate and high visibility zone badges
                  let rowBgClass = "";
                  if (isFocused) {
                    rowBgClass = "bg-teal-500/10 dark:bg-teal-500/25 ring-2 ring-teal-500/60 shadow-[inset_0_0_12px_rgba(20,184,166,0.3)] font-bold text-teal-200";
                  } else if (isAtm) {
                    rowBgClass = darkMode 
                      ? "bg-yellow-500/10 font-black border-y-2 border-yellow-500/30 text-yellow-250 shadow-[inset_0_0_15px_rgba(234,179,8,0.25)]"
                      : "bg-yellow-200/50 font-black border-y-2 border-yellow-400 text-yellow-950 shadow-sm";
                  } else if (isResistance) {
                    rowBgClass = darkMode 
                      ? "bg-rose-950/10 border-y border-rose-900/50 shadow-[inset_0_0_10px_rgba(244,63,94,0.06)]" 
                      : "bg-rose-50/30 border-y border-rose-150";
                  } else if (isSupport) {
                    rowBgClass = darkMode 
                      ? "bg-emerald-950/10 border-y border-emerald-900/50 shadow-[inset_0_0_10px_rgba(16,185,129,0.06)]" 
                      : "bg-emerald-50/30 border-y border-emerald-150";
                  } else if (isNearMoney) {
                    // Alternate slate-indigo backgrounds inside the 4-up/4-down zone line-by-line
                    const isEven = index % 2 === 0;
                    rowBgClass = isEven
                      ? (darkMode ? "bg-[#111a30]/85 hover:bg-[#16223e]/90 text-slate-100" : "bg-indigo-50/50 hover:bg-indigo-100/60 text-slate-900")
                      : (darkMode ? "bg-[#090e1b]/80 hover:bg-[#0e1628]/85 text-slate-200" : "bg-slate-50/80 hover:bg-slate-100/90 text-slate-800");
                  } else {
                    const isEven = index % 2 === 0;
                    rowBgClass = isEven 
                      ? (darkMode ? "bg-[#0e1628]/60 hover:bg-[#121c35]/80" : "bg-white hover:bg-slate-50")
                      : (darkMode ? "bg-[#0a101f]/45 hover:bg-[#0e1628]/75" : "bg-slate-50 hover:bg-slate-100");
                  }

                  return (
                    <tr
                      key={s.strikePrice}
                      data-row-index={index}
                      onClick={() => setFocusedIndex(index)}
                      className={`h-9.5 transition-all cursor-pointer ${rowBgClass}`}
                    >
                      {/* CE Side details */}
                      {viewMode === "standard" ? (
                        <>
                          {/* Volume */}
                          {(() => {
                            const idx = ceZoneAnalysis.vol.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getCeVolumeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(s.ceVolume)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(s.ceVolume)}
                              </td>
                            );
                          })()}
                          {/* OI */}
                          {(() => {
                            const idx = ceZoneAnalysis.oi.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getCeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span className="font-black">{formatLakh(s.ceOI)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                    {s.strikePrice === r1Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-650 text-white font-black leading-none animate-pulse flex-shrink-0">R1</span>
                                    )}
                                    {s.strikePrice === r2Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-800 text-rose-100 font-bold leading-none flex-shrink-0">R2</span>
                                    )}
                                    {s.strikePrice === r3Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-rose-950 text-rose-300 font-medium leading-none flex-shrink-0">R3</span>
                                    )}
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${ceOiGradient || ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                <div className="flex items-center justify-center gap-1">
                                  <span className="font-extrabold">{formatLakh(s.ceOI)}</span>
                                  {s.strikePrice === r1Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-650 text-white font-black leading-none animate-pulse flex-shrink-0">R1</span>
                                  )}
                                  {s.strikePrice === r2Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-800 text-rose-100 font-bold leading-none flex-shrink-0">R2</span>
                                  )}
                                  {s.strikePrice === r3Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-rose-955 text-rose-300 font-medium leading-none flex-shrink-0">R3</span>
                                  )}
                                </div>
                              </td>
                            );
                          })()}
                          {/* OI Change */}
                          {(() => {
                            const val = s.ceOIChange;
                            const idx = ceZoneAnalysis.oiChg.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getCeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(val, true)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            const colorClass = val > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/25 font-extrabold" : "text-emerald-700 bg-emerald-50 font-extrabold") 
                              : val < 0 
                              ? (darkMode ? "text-rose-455 bg-rose-955/25 font-extrabold" : "text-rose-700 bg-rose-50 font-extrabold") 
                              : (darkMode ? "text-slate-400 font-medium" : "text-slate-505 font-medium");
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] ${colorClass} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(val, true)}
                              </td>
                            );
                          })()}
                          {/* CE LTP */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] font-black ltp-column ${
                            s.ceChg > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/20" : "text-emerald-700 bg-emerald-50/70") 
                              : s.ceChg < 0 
                              ? (darkMode ? "text-rose-405 bg-rose-950/20" : "text-rose-700 bg-rose-50/70") 
                              : (darkMode ? "text-slate-100" : "text-slate-800")
                          } ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                            {s.ceLtp.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Detailed Mode CE Side: IV, Delta, Gamma, Theta, Vega, Bid/Ask, Vol, OI, OI Chg, LTP */}
                          {/* IV */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatIV(s.ceIV || 0)}
                          </td>
                          {/* Delta */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${
                            (s.ceDelta !== undefined && (
                              (s.ceDelta >= 0.30 && s.ceDelta <= 0.35) ||
                              (s.ceDelta >= 30 && s.ceDelta <= 35)
                            ))
                              ? (darkMode ? "bg-yellow-500/30 text-yellow-300 font-extrabold border-yellow-500/50" : "bg-yellow-100 text-yellow-900 font-extrabold border-yellow-300")
                              : (darkMode ? "text-slate-400" : "text-slate-500")
                          } ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.ceDelta)}
                          </td>
                          {/* Gamma */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.ceGamma)}
                          </td>
                          {/* Theta */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.ceTheta)}
                          </td>
                          {/* Vega */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.ceVega)}
                          </td>
                          {/* Bid/Ask */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatBidAsk(s.ceBid, s.ceAsk)}
                          </td>
                          {/* Volume */}
                          {(() => {
                            const idx = ceZoneAnalysis.vol.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getCeVolumeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(s.ceVolume)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(s.ceVolume)}
                              </td>
                            );
                          })()}
                          {/* OI */}
                          {(() => {
                            const idx = ceZoneAnalysis.oi.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getCeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span className="font-black">{formatLakh(s.ceOI)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                    {s.strikePrice === r1Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-650 text-white font-black leading-none animate-pulse flex-shrink-0">R1</span>
                                    )}
                                    {s.strikePrice === r2Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-800 text-rose-100 font-bold leading-none flex-shrink-0">R2</span>
                                    )}
                                    {s.strikePrice === r3Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-rose-950 text-rose-300 font-medium leading-none flex-shrink-0">R3</span>
                                    )}
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${ceOiGradient || ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                <div className="flex items-center justify-center gap-1">
                                  <span className="font-extrabold">{formatLakh(s.ceOI)}</span>
                                  {s.strikePrice === r1Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-650 text-white font-black leading-none animate-pulse flex-shrink-0">R1</span>
                                  )}
                                  {s.strikePrice === r2Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-red-800 text-rose-100 font-bold leading-none flex-shrink-0">R2</span>
                                  )}
                                  {s.strikePrice === r3Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-rose-955 text-rose-300 font-medium leading-none flex-shrink-0">R3</span>
                                  )}
                                </div>
                              </td>
                            );
                          })()}
                          {/* OI Change */}
                          {(() => {
                            const val = s.ceOIChange;
                            const idx = ceZoneAnalysis.oiChg.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getCeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(val, true)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            const colorClass = val > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/25 font-extrabold" : "text-emerald-700 bg-emerald-50 font-extrabold") 
                              : val < 0 
                              ? (darkMode ? "text-rose-455 bg-rose-955/25 font-extrabold" : "text-rose-700 bg-rose-50 font-extrabold") 
                              : (darkMode ? "text-slate-400 font-medium" : "text-slate-505 font-medium");
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] ${colorClass} ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(val, true)}
                              </td>
                            );
                          })()}
                          {/* LTP */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] font-black ltp-column ${
                            s.ceChg > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/20" : "text-emerald-700 bg-emerald-50/70") 
                              : s.ceChg < 0 
                              ? (darkMode ? "text-rose-405 bg-rose-950/20" : "text-rose-700 bg-rose-50/70") 
                              : (darkMode ? "text-slate-100" : "text-slate-800")
                          } ${ceOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                            {s.ceLtp.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </>
                      )}

                      {/* CENTRAL STICKY STRIKE */}
                      <td className={`anti-flicker-cell px-2.5 font-mono text-center border relative select-all transition-all duration-200 center-strike-column ${
                        isAtm 
                          ? "atm-strike-cell"
                          : isFocused
                          ? "bg-gradient-to-r from-teal-500 to-emerald-500 text-white font-black shadow-lg scale-[1.03] z-30 transform border-teal-400"
                          : isNearMoney
                          ? `ntm-strike-cell ${index % 2 === 0 ? "ntm-row-even" : "ntm-row-odd"}${
                              isNtmBoundaryTop ? " ntm-boundary-top" : ""
                            }${isNtmBoundaryBottom ? " ntm-boundary-bottom" : ""}`
                          : darkMode 
                          ? "bg-slate-900/50 text-slate-100 font-extrabold border-slate-700/80"
                          : "bg-slate-100/60 text-slate-900 font-extrabold border-slate-300"
                      }`} style={{ fontSize: `${fontSize + 1}px`, width: "110px", minWidth: "110px", maxWidth: "110px" }}>
                        {s.strikePrice}
                        {isAtm && (
                          <span className="absolute -right-1 top-1 inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400 animate-ping"></span>
                        )}
                      </td>

                      {/* PE Side details */}
                      {viewMode === "standard" ? (
                        <>
                          {/* PE LTP */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] font-black pe-ltp-header ltp-column ${
                            s.peChg > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/20" : "text-emerald-700 bg-emerald-50/70") 
                              : s.peChg < 0 
                              ? (darkMode ? "text-rose-405 bg-rose-950/20" : "text-rose-700 bg-rose-50/70") 
                              : (darkMode ? "text-slate-100" : "text-slate-800")
                          } ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                            {s.peLtp.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          {/* PE OI Change */}
                          {(() => {
                            const val = s.peOIChange;
                            const idx = peZoneAnalysis.oiChg.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getPeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(val, true)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            const colorClass = val > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/25 font-extrabold" : "text-emerald-700 bg-emerald-50 font-extrabold") 
                              : val < 0 
                              ? (darkMode ? "text-rose-455 bg-rose-955/25 font-extrabold" : "text-rose-700 bg-rose-50 font-extrabold") 
                              : (darkMode ? "text-slate-400 font-medium" : "text-slate-505 font-medium");
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] ${colorClass} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(val, true)}
                              </td>
                            );
                          })()}
                          {/* PE OI */}
                          {(() => {
                            const idx = peZoneAnalysis.oi.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getPeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    {s.strikePrice === s1Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-650 text-white font-black leading-none animate-pulse flex-shrink-0">S1</span>
                                    )}
                                    {s.strikePrice === s2Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-800 text-emerald-100 font-bold leading-none flex-shrink-0">S2</span>
                                    )}
                                    {s.strikePrice === s3Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-950 text-emerald-300 font-medium leading-none flex-shrink-0">S3</span>
                                    )}
                                    <span className="font-black">{formatLakh(s.peOI)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${peOiGradient || peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                <div className="flex items-center justify-center gap-1">
                                  {s.strikePrice === s1Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-650 text-white font-black leading-none animate-pulse flex-shrink-0">S1</span>
                                  )}
                                  {s.strikePrice === s2Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-800 text-emerald-100 font-bold leading-none flex-shrink-0">S2</span>
                                  )}
                                  {s.strikePrice === s3Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-955 text-emerald-300 font-medium leading-none flex-shrink-0">S3</span>
                                  )}
                                  <span className="font-extrabold">{formatLakh(s.peOI)}</span>
                                </div>
                              </td>
                            );
                          })()}
                          {/* Volume */}
                          {(() => {
                            const idx = peZoneAnalysis.vol.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getPeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(s.peVolume)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(s.peVolume)}
                              </td>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          {/* Detailed Mode PE Side: LTP, Bid/Ask, Vol, OI Chg, OI, IV, Delta, Gamma, Theta, Vega */}
                          {/* LTP */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] font-black pe-ltp-header ltp-column ${
                            s.peChg > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/20" : "text-emerald-700 bg-emerald-50/70") 
                              : s.peChg < 0 
                              ? (darkMode ? "text-rose-405 bg-rose-950/20" : "text-rose-700 bg-rose-50/70") 
                              : (darkMode ? "text-slate-100" : "text-slate-800")
                          } ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                            {s.peLtp.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          {/* Bid/Ask */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatBidAsk(s.peBid, s.peAsk)}
                          </td>
                          {/* Volume */}
                          {(() => {
                            const idx = peZoneAnalysis.vol.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getPeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(s.peVolume)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(s.peVolume)}
                              </td>
                            );
                          })()}
                          {/* OI Change */}
                          {(() => {
                            const val = s.peOIChange;
                            const idx = peZoneAnalysis.oiChg.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getPeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    <span>{formatLakh(val, true)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            const colorClass = val > 0 
                              ? (darkMode ? "text-emerald-400 bg-emerald-950/25 font-extrabold" : "text-emerald-700 bg-emerald-50 font-extrabold") 
                              : val < 0 
                              ? (darkMode ? "text-rose-455 bg-rose-955/25 font-extrabold" : "text-rose-700 bg-rose-50 font-extrabold") 
                              : (darkMode ? "text-slate-400 font-medium" : "text-slate-505 font-medium");
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} text-[10.5px] md:text-[11.5px] ${colorClass} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                {formatLakh(val, true)}
                              </td>
                            );
                          })()}
                          {/* OI */}
                          {(() => {
                            const idx = peZoneAnalysis.oi.indexOf(s.strikePrice);
                            const rank = idx !== -1 ? idx + 1 : 0;
                            if (rank > 0) {
                              return (
                                <td className={getPeHighlightClass(rank)} style={{ fontSize: `${fontSize}px` }}>
                                  <div className="flex items-center justify-center gap-1 w-full h-full">
                                    {s.strikePrice === s1Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-650 text-white font-black leading-none animate-pulse flex-shrink-0">S1</span>
                                    )}
                                    {s.strikePrice === s2Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-800 text-emerald-100 font-bold leading-none flex-shrink-0">S2</span>
                                    )}
                                    {s.strikePrice === s3Strike && (
                                      <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-950 text-emerald-300 font-medium leading-none flex-shrink-0">S3</span>
                                    )}
                                    <span className="font-black">{formatLakh(s.peOI)}</span>
                                    <span className="text-[7.5px] font-mono bg-black/35 text-white px-0.8 py-0.2 rounded font-black leading-none flex-shrink-0">L{rank}</span>
                                  </div>
                                </td>
                              );
                            }
                            return (
                              <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${cellTextClass} ${peOiGradient || peOtmClass} ${atmBgClass}`} style={{ fontSize: `${fontSize}px` }}>
                                <div className="flex items-center justify-center gap-1">
                                  {s.strikePrice === s1Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-650 text-white font-black leading-none animate-pulse flex-shrink-0">S1</span>
                                  )}
                                  {s.strikePrice === s2Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-800 text-emerald-105 font-bold leading-none flex-shrink-0">S2</span>
                                  )}
                                  {s.strikePrice === s3Strike && (
                                    <span className="text-[8px] md:text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-955 text-emerald-300 font-medium leading-none flex-shrink-0">S3</span>
                                  )}
                                  <span className="font-extrabold">{formatLakh(s.peOI)}</span>
                                </div>
                              </td>
                            );
                          })()}
                          {/* IV */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatIV(s.peIV || 0)}
                          </td>
                          {/* Delta */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${
                            (s.peDelta !== undefined && (
                              (Math.abs(s.peDelta) >= 0.30 && Math.abs(s.peDelta) <= 0.35) ||
                              (Math.abs(s.peDelta) >= 30 && Math.abs(s.peDelta) <= 35)
                            ))
                              ? (darkMode ? "bg-yellow-500/30 text-yellow-300 font-extrabold border-yellow-500/50" : "bg-yellow-100 text-yellow-900 font-extrabold border-yellow-300")
                              : (darkMode ? "text-slate-400" : "text-slate-500")
                          } ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.peDelta)}
                          </td>
                          {/* Gamma */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.peGamma)}
                          </td>
                          {/* Theta */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.peTheta)}
                          </td>
                          {/* Vega */}
                          <td className={`anti-flicker-cell px-1.5 md:px-2 border ${cellBorderClass} ${darkMode ? "text-slate-400" : "text-slate-500"} ${peOtmClass} ${atmBgClass}`} style={{ fontSize: `${Math.max(8.5, fontSize - 2)}px` }}>
                            {formatGreek(s.peVega)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default React.memo(OptionChainGrid);
