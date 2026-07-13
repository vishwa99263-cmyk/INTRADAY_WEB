/**
 * LiveOptionChain.tsx — Pure Display Layer (Streaming Architecture)
 *
 * REMOVED:
 *   ❌ useNiftyOptionChain (polling / REST / client-side WS)
 *   ❌ fyersDataSocket (client-side Fyers WS subscription)
 *   ❌ fetchingMethod state machine
 *   ❌ setInterval refresh loops
 *
 * KEPT:
 *   ✅ Column visibility panel
 *   ✅ SummaryCards, ExpiryDropdown, SpotPricePanel, GreeksPanel, OptionChainTable
 *   ✅ All visual rendering unchanged
 * Data source: optionChainState prop pushed by server via "market-update" Socket.IO event
 */

import React, { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Sliders, X, Download, Upload, RefreshCw, Calendar, TrendingUp, TrendingDown, Minus } from "lucide-react";

import SummaryCards from "./SummaryCards.js";
import ExpiryDropdown from "./ExpiryDropdown.js";
import SpotPricePanel from "./SpotPricePanel.js";
import GreeksPanel from "./GreeksPanel.js";
import OptionChainTable, { TABLE_COLUMNS } from "./OptionChainTable.js";
import { calculateSupportResistance } from "./optionUtils.js";
import type { OptionChainState, OptionStrikeData, ExpiryItem } from "../../types.js";

// ── Props ──────────────────────────────────────────────────────────────────────

interface LiveOptionChainProps {
  fyersAuthorized: boolean;
  darkMode:        boolean;
  /** Full option chain state streamed from server (market-update → optionChain) */
  optionChainState: OptionChainState;
  /** Called when the user selects a different expiry — server re-fetches & re-subscribes */
  onSelectExpiry: (expiry: string) => void;
}

const CSV_HEADERS = [
  "strikePrice",
  "ceSymbol", "ceLtp", "ceBid", "ceAsk", "ceVolume", "ceOI", "ceOIChange", "ceOIChangePct", "ceLtpChgPct",
  "ceDelta", "ceGamma", "ceTheta", "ceVega", "ceIV",
  "peSymbol", "peLtp", "peBid", "peAsk", "peVolume", "peOI", "peOIChange", "peOIChangePct", "peLtpChgPct",
  "peDelta", "peGamma", "peTheta", "peVega", "peIV",
  "metadataSpotPrice", "metadataIndiaVix", "metadataHighPrice", "metadataLowPrice", "metadataSpotChange", "metadataSpotChangePct"
];

// ── Component ──────────────────────────────────────────────────────────────────

function LiveOptionChain({
  fyersAuthorized,
  darkMode,
  optionChainState,
  onSelectExpiry,
}: LiveOptionChainProps) {

  // CSV Import/Export local states
  const [importedStrikes, setImportedStrikes] = useState<OptionStrikeData[] | null>(null);
  const [importedMeta, setImportedMeta] = useState<{
    spotPrice: number;
    indiaVix: number;
    highPrice: number;
    lowPrice: number;
    spotChange: number;
    spotChangePct: number;
  } | null>(null);

  // Unpack server-streamed state
  const {
    expiryList,
    selectedExpiry,
    strikes: strikeRows,
    totalCallOi,
    totalPutOi,
    indiaVix,
    spotPrice,
    spotChange,
    spotChangePct,
    highPrice,
    lowPrice,
    monthlyExpiry,
    nextWeeklyExpiry,
    monthlyMetrics,
    nextWeeklyMetrics,
  } = optionChainState;

  // ── Expiry Classification ────────────────────────────────────────────────────
  // Auto-classify each expiry in the list as: CURRENT_WEEKLY, NEXT_WEEKLY, MONTHLY
  type ExpiryKind = "CURRENT_WEEKLY" | "NEXT_WEEKLY" | "MONTHLY";

  const classifyExpiry = useCallback((expItem: ExpiryItem): ExpiryKind => {
    // Use server-provided flags first
    if (expItem.expiryFlag === "M") return "MONTHLY";
    // If server provided monthlyExpiry, match it
    if (monthlyExpiry && expItem.value === monthlyExpiry) return "MONTHLY";
    if (nextWeeklyExpiry && expItem.value === nextWeeklyExpiry) return "NEXT_WEEKLY";
    // Fallback: parse date, first weekly = current, second = next
    return "CURRENT_WEEKLY";
  }, [monthlyExpiry, nextWeeklyExpiry]);

  // Build classified list
  const classifiedExpiries = useMemo(() => {
    const weekly: ExpiryItem[] = [];
    const nextWeekly: ExpiryItem[] = [];
    const monthly: ExpiryItem[] = [];
    expiryList.forEach(e => {
      const kind = classifyExpiry(e);
      if (kind === "MONTHLY") monthly.push(e);
      else if (kind === "NEXT_WEEKLY") nextWeekly.push(e);
      else weekly.push(e);
    });
    // Fallback: if no next weekly identified, treat 2nd weekly as next
    if (nextWeekly.length === 0 && weekly.length >= 2) {
      nextWeekly.push(weekly.splice(1, 1)[0]);
    }
    // If no monthly flagged, treat last expiry as monthly
    if (monthly.length === 0 && expiryList.length >= 3) {
      monthly.push(expiryList[expiryList.length - 1]);
    }
    return { weekly, nextWeekly, monthly };
  }, [expiryList, classifyExpiry]);

  // Active expiry tab
  type ExpiryTab = "CURRENT_WEEKLY" | "NEXT_WEEKLY" | "MONTHLY" | "ALL";
  const [activeExpiryTab, setActiveExpiryTab] = useState<ExpiryTab>("CURRENT_WEEKLY");

  // When user clicks a tab, auto-select that expiry on server
  const handleExpiryTabClick = useCallback((tab: ExpiryTab) => {
    setActiveExpiryTab(tab);
    let target: ExpiryItem | undefined;
    if (tab === "CURRENT_WEEKLY") target = classifiedExpiries.weekly[0];
    else if (tab === "NEXT_WEEKLY") target = classifiedExpiries.nextWeekly[0];
    else if (tab === "MONTHLY") target = classifiedExpiries.monthly[0];
    if (target) onSelectExpiry(target.value);
  }, [classifiedExpiries, onSelectExpiry]);

  // Detect which tab the current selectedExpiry belongs to
  const currentTab = useMemo((): ExpiryTab => {
    if (classifiedExpiries.weekly.some(e => e.value === selectedExpiry)) return "CURRENT_WEEKLY";
    if (classifiedExpiries.nextWeekly.some(e => e.value === selectedExpiry)) return "NEXT_WEEKLY";
    if (classifiedExpiries.monthly.some(e => e.value === selectedExpiry)) return "MONTHLY";
    return "CURRENT_WEEKLY";
  }, [selectedExpiry, classifiedExpiries]);

  // Current expiry metrics (current weekly from live chain)
  const currentWeeklyPCR = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(2)) : 1.0;

  // Format expiry label: if it looks like a unix timestamp, convert to DD-MM-YYYY
  // Otherwise pass through as-is (server already formats as DD-MM-YYYY)
  const formatExpiryLabel = (item: { label: string; value: string } | undefined): string => {
    if (!item) return "--";
    // If label is already DD-MM-YYYY format, use directly
    if (/^\d{2}-\d{2}-\d{4}$/.test(item.label)) return item.label;
    // If value is numeric unix timestamp, format it
    if (!isNaN(Number(item.value)) && Number(item.value) > 1_000_000_000) {
      const d = new Date(Number(item.value) * 1000);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}-${mm}-${d.getFullYear()}`;
    }
    return item.label || "--";
  };

  const currentWeeklyLabel = formatExpiryLabel(classifiedExpiries.weekly[0]);
  const nextWeeklyLabel    = formatExpiryLabel(classifiedExpiries.nextWeekly[0]);
  const monthlyLabel       = formatExpiryLabel(classifiedExpiries.monthly[0]);

  // Resolve current active states
  const displayStrikes = importedStrikes || strikeRows;
  const displaySpotPrice = importedMeta ? importedMeta.spotPrice : spotPrice;
  const displayIndiaVix = importedMeta ? importedMeta.indiaVix : indiaVix;
  const displayHighPrice = importedMeta ? importedMeta.highPrice : highPrice;
  const displayLowPrice = importedMeta ? importedMeta.lowPrice : lowPrice;
  const displaySpotChange = importedMeta ? importedMeta.spotChange : spotChange;
  const displaySpotChangePct = importedMeta ? importedMeta.spotChangePct : spotChangePct;

  const displayTotalCallOi = useMemo(() => {
    return importedStrikes 
      ? displayStrikes.reduce((acc, r) => acc + (r.ceOI || 0), 0)
      : totalCallOi;
  }, [importedStrikes, displayStrikes, totalCallOi]);

  const displayTotalPutOi = useMemo(() => {
    return importedStrikes 
      ? displayStrikes.reduce((acc, r) => acc + (r.peOI || 0), 0)
      : totalPutOi;
  }, [importedStrikes, displayStrikes, totalPutOi]);

  // Derived fields
  const pcr = displayTotalCallOi > 0 ? parseFloat((displayTotalPutOi / displayTotalCallOi).toFixed(3)) : 0;
  const atmStrike = Math.round(displaySpotPrice / 50) * 50;

  // Max pain: strike with maximum total OI on both sides
  const maxPain = useMemo(() => {
    if (!displayStrikes.length) return 0;
    let maxOI = 0; let mpStrike = 0;
    displayStrikes.forEach(r => {
      const total = (r.ceOI || 0) + (r.peOI || 0);
      if (total > maxOI) { maxOI = total; mpStrike = r.strikePrice; }
    });
    return mpStrike;
  }, [displayStrikes]);

  const { resistance, support } = useMemo(() => calculateSupportResistance(displayStrikes), [displayStrikes]);

  const selectedExpiryLabel = useMemo(() => {
    const m = expiryList.find(e => e.value === selectedExpiry);
    return m ? m.label : "";
  }, [expiryList, selectedExpiry]);

  // CSV Action Handlers
  const handleCSVExport = () => {
    try {
      const csvRows = [];
      csvRows.push(CSV_HEADERS.join(","));
      
      displayStrikes.forEach(r => {
        const row = CSV_HEADERS.map(h => {
          if (h === "metadataSpotPrice") return displaySpotPrice;
          if (h === "metadataIndiaVix") return displayIndiaVix;
          if (h === "metadataHighPrice") return displayHighPrice;
          if (h === "metadataLowPrice") return displayLowPrice;
          if (h === "metadataSpotChange") return displaySpotChange;
          if (h === "metadataSpotChangePct") return displaySpotChangePct;

          const val = r[h as keyof OptionStrikeData];
          return val !== undefined && val !== null ? val : "";
        });
        csvRows.push(row.join(","));
      });

      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const cleanLabel = selectedExpiryLabel ? selectedExpiryLabel.replace(/\s+/g, "_") : "option_chain";
      link.setAttribute("href", url);
      link.setAttribute("download", `${cleanLabel}_option_chain.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        if (!text) return;

        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.length < 2) {
          alert("Invalid CSV: File must have headers and at least one data row.");
          return;
        }

        const headers = lines[0].split(",").map(h => h.trim());
        const parsedStrikes: OptionStrikeData[] = [];
        let parsedMeta = null;

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(",").map(p => p.trim());
          const strikeRow: any = {};
          
          headers.forEach((h, idx) => {
            const val = parts[idx];
            if (val !== undefined) {
              if (["ceSymbol", "peSymbol"].includes(h)) {
                strikeRow[h] = val;
              } else {
                strikeRow[h] = val === "" ? 0 : Number(val);
              }
            }
          });

          if (strikeRow.strikePrice) {
            parsedStrikes.push(strikeRow as OptionStrikeData);
            
            // Read metadata from first row
            if (i === 1 && strikeRow.metadataSpotPrice !== undefined) {
              parsedMeta = {
                spotPrice: Number(strikeRow.metadataSpotPrice || 0),
                indiaVix: Number(strikeRow.metadataIndiaVix || 0),
                highPrice: Number(strikeRow.metadataHighPrice || 0),
                lowPrice: Number(strikeRow.metadataLowPrice || 0),
                spotChange: Number(strikeRow.metadataSpotChange || 0),
                spotChangePct: Number(strikeRow.metadataSpotChangePct || 0),
              };
            }
          }
        }

        if (parsedStrikes.length === 0) {
          alert("No valid strike rows found in CSV.");
          return;
        }

        setImportedStrikes(parsedStrikes);
        if (parsedMeta) {
          setImportedMeta(parsedMeta);
        }
        alert(`Successfully imported ${parsedStrikes.length} strikes from CSV!`);
      } catch (err: any) {
        alert(`Failed to parse CSV: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Column visibility panel
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    TABLE_COLUMNS.forEach(c => {
      init[c.key] = ["ceOI", "ceOIChange", "ceVolume", "ceIV", "ceDelta", "ceLtp",
        "strikePrice", "peLtp", "peDelta", "peIV", "peVolume", "peOIChange", "peOI"].includes(c.key);
    });
    return init;
  });
  const [showColPanel, setShowColPanel] = useState(false);

  // Connection status derived from server state
  const { isLive, lastSnapshotTime } = optionChainState;
  const status: "LIVE" | "SNAPSHOT" | "DISCONNECTED" | "EXPIRED" =
    isLive ? "LIVE"
    : (!fyersAuthorized && strikeRows.length > 0) ? "SNAPSHOT"
    : !fyersAuthorized ? "DISCONNECTED"
    : "SNAPSHOT";

  // NOTE: We no longer do an early return when strikeRows is empty because
  // that unmounts the entire UI causing the matrix box to disappear (blink).
  // Instead we track it and show an overlay inside the stable render tree.
  const isEmptyChain = strikeRows.length === 0 && !importedStrikes;

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-y-auto p-4 gap-4 relative ${
      darkMode ? "bg-slate-955 text-slate-100" : "bg-slate-50 text-slate-800"
    }`}>

      {/* Loading overlay — only shown when chain is empty; keeps the grid mounted */}
      {isEmptyChain && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm pointer-events-none">
          <AlertCircle size={36} className="text-amber-500 mb-3 animate-pulse" />
          <p className="font-mono text-xs uppercase tracking-wider text-slate-400 text-center max-w-xs">
            {fyersAuthorized
              ? "Loading option chain…"
              : "No cached data. Authorize Fyers under the FYERS CONNECT tab."}
          </p>
        </div>
      )}

      {/* Expired banner */}
      {status === "DISCONNECTED" && !importedStrikes && (
        <div className="bg-orange-500/10 border border-orange-500/30 text-orange-300 p-3.5 rounded-xl flex items-center justify-between gap-4 text-xs font-sans">
          <div className="flex items-center gap-2">
            <AlertCircle className="text-orange-400 flex-shrink-0 animate-bounce" size={16} />
            <div>
              <span className="font-extrabold block">Fyers API Disconnected</span>
              <span className="text-[10px] opacity-80">To resume real-time feeds, please log in under the FYERS CONNECT tab.</span>
            </div>
          </div>
        </div>
      )}

      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 p-3 rounded-xl border border-slate-800/80">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-6 w-1 bg-teal-500 rounded-full" />
          <h2 className="text-sm font-black uppercase tracking-widest text-white">
            NIFTY Weekly Derivatives Terminal
          </h2>
          <div className="flex flex-wrap items-center gap-1.5 ml-2">
            {importedStrikes && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                🔵 IMPORTED OFFLINE CSV DATA
              </span>
            )}
            {!importedStrikes && status === "LIVE" && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-450 animate-pulse" />
                🟢 LIVE OPTION STREAM
              </span>
            )}
            {!importedStrikes && status === "SNAPSHOT" && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black tracking-wider bg-orange-500/10 text-orange-400 border border-orange-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-450" />
                🟠 MARKET CLOSED (LAST SNAPSHOT)
                {lastSnapshotTime && (
                  <span className="text-[8px] font-mono opacity-70 ml-1">
                    {new Date(lastSnapshotTime).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </span>
            )}
            {!importedStrikes && status === "DISCONNECTED" && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-450" />
                🔴 FYERS DISCONNECTED
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {importedStrikes && (
            <button
              onClick={() => {
                setImportedStrikes(null);
                setImportedMeta(null);
              }}
              className="px-3.5 py-1.5 text-xs text-white bg-rose-600 hover:bg-rose-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8 animate-pulse"
              title="Reset view back to live market stream data"
            >
              <RefreshCw size={12} /> Reset to Live
            </button>
          )}
          <button
            onClick={handleCSVExport}
            className="px-3.5 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
            title="Export all option chain rows as a CSV file"
          >
            <Download size={12} /> Export CSV
          </button>
          <label
            className="px-3.5 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
            title="Import offline option chain rows from a CSV file"
          >
            <Upload size={12} /> Import CSV
            <input
              type="file"
              accept=".csv"
              onChange={handleCSVImport}
              className="hidden"
            />
          </label>

          <ExpiryDropdown
            selectedExpiry={selectedExpiry}
            onChange={(val: string) => onSelectExpiry(val)}
            expiryList={
              currentTab === "CURRENT_WEEKLY" ? (classifiedExpiries.weekly.length > 0 ? classifiedExpiries.weekly : expiryList)
              : currentTab === "NEXT_WEEKLY"  ? (classifiedExpiries.nextWeekly.length > 0 ? classifiedExpiries.nextWeekly : expiryList)
              : (classifiedExpiries.monthly.length > 0 ? classifiedExpiries.monthly : expiryList)
            }
            loading={false}
            lastRefresh={new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
            onRefresh={() => onSelectExpiry(selectedExpiry)}
          />
        </div>
      </div>

      {/* ── Expiry Type Tabs ────────────────────────────────────────────── */}
      {expiryList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {([
            { id: "CURRENT_WEEKLY" as const, label: "📅 Current Weekly", sub: currentWeeklyLabel, color: "teal",   available: classifiedExpiries.weekly.length > 0 },
            { id: "NEXT_WEEKLY"    as const, label: "📆 Next Weekly",    sub: nextWeeklyLabel,   color: "indigo", available: classifiedExpiries.nextWeekly.length > 0 },
            { id: "MONTHLY"        as const, label: "🗓 Monthly",         sub: monthlyLabel,      color: "amber",  available: classifiedExpiries.monthly.length > 0 },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => handleExpiryTabClick(tab.id)}
              disabled={!tab.available}
              title={`Switch to ${tab.label} expiry`}
              className={`flex flex-col items-start px-3 py-1.5 rounded-lg border text-left transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                currentTab === tab.id
                  ? tab.color === "teal"   ? "bg-teal-500/15 border-teal-500/50 text-teal-300 shadow-[0_0_12px_rgba(20,184,166,0.15)]"
                    : tab.color === "indigo" ? "bg-indigo-500/15 border-indigo-500/50 text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.15)]"
                    : "bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              <span className="text-[11px] font-black tracking-wider">{tab.label}</span>
              <span className={`text-[9px] font-mono mt-0.5 ${
                currentTab === tab.id
                  ? tab.color === "teal" ? "text-teal-400" : tab.color === "indigo" ? "text-indigo-400" : "text-amber-400"
                  : "text-slate-600"
              }`}>
                {tab.sub || (tab.available ? "Available" : "No data")}
              </span>
            </button>
          ))}
          <div className="ml-auto text-[10px] text-slate-600 font-mono">
            {expiryList.length} expir{expiryList.length === 1 ? "y" : "ies"} available
          </div>
        </div>
      )}

      {/* ── Multi-Expiry Comparison Strip ─────────────────────────────── */}
      {(nextWeeklyMetrics || monthlyMetrics) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Current Weekly */}
          <div className={`p-3 rounded-xl border ${
            currentTab === "CURRENT_WEEKLY"
              ? "bg-teal-500/8 border-teal-500/30"
              : "bg-slate-900 border-slate-800/60"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-teal-400">📅 Current Weekly</span>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
                currentWeeklyPCR >= 1.2 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                : currentWeeklyPCR <= 0.8 ? "text-red-400 bg-red-500/10 border-red-500/30"
                : "text-slate-400 bg-slate-800 border-slate-700"
              }`}>
                PCR {currentWeeklyPCR}
              </span>
            </div>
            <div className="text-[9px] text-slate-500 font-mono mb-2">{currentWeeklyLabel}</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-600 uppercase">CE OI</span>
                <span className="font-mono font-bold text-red-400">
                  {totalCallOi >= 1e5 ? `${(totalCallOi/1e5).toFixed(1)}L` : `${(totalCallOi/1000).toFixed(0)}K`}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-600 uppercase">PE OI</span>
                <span className="font-mono font-bold text-emerald-400">
                  {totalPutOi >= 1e5 ? `${(totalPutOi/1e5).toFixed(1)}L` : `${(totalPutOi/1000).toFixed(0)}K`}
                </span>
              </div>
            </div>
            {currentTab === "CURRENT_WEEKLY" && (
              <div className="mt-2 text-[10px] text-teal-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse inline-block" />
                ACTIVE
              </div>
            )}
          </div>

          {/* Next Weekly */}
          <div className={`p-3 rounded-xl border ${
            currentTab === "NEXT_WEEKLY"
              ? "bg-indigo-500/8 border-indigo-500/30"
              : "bg-slate-900 border-slate-800/60"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">📆 Next Weekly</span>
              {nextWeeklyMetrics && (
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
                  nextWeeklyMetrics.pcr >= 1.2 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                  : nextWeeklyMetrics.pcr <= 0.8 ? "text-red-400 bg-red-500/10 border-red-500/30"
                  : "text-slate-400 bg-slate-800 border-slate-700"
                }`}>
                  PCR {nextWeeklyMetrics.pcr.toFixed(2)}
                </span>
              )}
            </div>
            <div className="text-[9px] text-slate-500 font-mono mb-2">{nextWeeklyLabel}</div>
            {nextWeeklyMetrics ? (
              <div className="space-y-1">
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-600 uppercase">Resistance Wall</span>
                    <span className="font-mono font-bold text-red-400">{nextWeeklyMetrics.resistanceWall > 0 ? nextWeeklyMetrics.resistanceWall : "--"}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-600 uppercase">Support Wall</span>
                    <span className="font-mono font-bold text-emerald-400">{nextWeeklyMetrics.supportWall > 0 ? nextWeeklyMetrics.supportWall : "--"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <span className={`font-bold ${
                    nextWeeklyMetrics.sentiment === "BULLISH" ? "text-emerald-400" : nextWeeklyMetrics.sentiment === "BEARISH" ? "text-red-400" : "text-slate-400"
                  }`}>
                    {nextWeeklyMetrics.sentiment === "BULLISH" ? "↑" : nextWeeklyMetrics.sentiment === "BEARISH" ? "↓" : "→"} {nextWeeklyMetrics.sentiment}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-slate-600 italic">Not available — switch to next weekly expiry</div>
            )}
            {currentTab === "NEXT_WEEKLY" && (
              <div className="mt-2 text-[10px] text-indigo-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block" />
                ACTIVE
              </div>
            )}
          </div>

          {/* Monthly */}
          <div className={`p-3 rounded-xl border ${
            currentTab === "MONTHLY"
              ? "bg-amber-500/8 border-amber-500/30"
              : "bg-slate-900 border-slate-800/60"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">🗓 Monthly</span>
              {monthlyMetrics && (
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
                  monthlyMetrics.pcr >= 1.2 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                  : monthlyMetrics.pcr <= 0.8 ? "text-red-400 bg-red-500/10 border-red-500/30"
                  : "text-slate-400 bg-slate-800 border-slate-700"
                }`}>
                  PCR {monthlyMetrics.pcr.toFixed(2)}
                </span>
              )}
            </div>
            {/* Monthly Expiry Date — format: 30-06-2026 (Monthly) */}
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[10px] font-black font-mono text-amber-300">{monthlyLabel}</span>
              {monthlyLabel !== "--" && (
                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">Monthly</span>
              )}
            </div>
            {monthlyMetrics ? (
              <div className="space-y-1">
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-600 uppercase">Resistance Wall</span>
                    <span className="font-mono font-bold text-red-400">{monthlyMetrics.resistanceWall > 0 ? monthlyMetrics.resistanceWall : "--"}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-600 uppercase">Support Wall</span>
                    <span className="font-mono font-bold text-emerald-400">{monthlyMetrics.supportWall > 0 ? monthlyMetrics.supportWall : "--"}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-600 uppercase">Total CE OI</span>
                    <span className="font-mono font-bold text-red-400">
                      {monthlyMetrics.totalCallOi >= 1e5 ? `${(monthlyMetrics.totalCallOi/1e5).toFixed(1)}L` : `${(monthlyMetrics.totalCallOi/1000).toFixed(0)}K`}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-600 uppercase">Total PE OI</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {monthlyMetrics.totalPutOi >= 1e5 ? `${(monthlyMetrics.totalPutOi/1e5).toFixed(1)}L` : `${(monthlyMetrics.totalPutOi/1000).toFixed(0)}K`}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-slate-600 italic">Not available — switch to monthly expiry</div>
            )}
            {currentTab === "MONTHLY" && (
              <div className="mt-2 text-[10px] text-amber-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                ACTIVE
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <SummaryCards
        spotPrice={displaySpotPrice}
        spotChange={displaySpotChange}
        spotChangePct={displaySpotChangePct}
        highPrice={displayHighPrice}
        lowPrice={displayLowPrice}
        totalCallOi={displayTotalCallOi}
        totalPutOi={displayTotalPutOi}
        pcr={pcr}
        indiaVix={displayIndiaVix}
        selectedExpiryLabel={selectedExpiryLabel}
        atmStrike={atmStrike}
        maxPain={maxPain}
        resistance={resistance}
        support={support}
        lastRefresh={new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
        strikes={displayStrikes}
      />

      {/* Spot ticker */}
      <SpotPricePanel
        spotPrice={displaySpotPrice}
        spotChange={displaySpotChange}
        spotChangePct={displaySpotChangePct}
        highPrice={displayHighPrice}
        lowPrice={displayLowPrice}
        indiaVix={displayIndiaVix}
        atmStrike={atmStrike}
        onToggleColumns={() => setShowColPanel(p => !p)}
        showColPanel={showColPanel}
      />

      {/* Column filter panel */}
      <AnimatePresence>
        {showColPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl border border-slate-800 bg-slate-900 p-4 overflow-hidden"
          >
            <div className="flex justify-between items-center pb-2 mb-3 border-b border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Sliders size={12} className="text-teal-400" />
                Customize Columns Visibility
              </span>
              <div className="flex gap-3 text-[10px] font-bold">
                <button onClick={() => setVisibleCols(prev => { const n = { ...prev }; TABLE_COLUMNS.forEach(c => { n[c.key] = true; }); return n; })} className="text-teal-400 hover:text-teal-300">Show All</button>
                <button onClick={() => setVisibleCols(prev => { const n = { ...prev }; TABLE_COLUMNS.forEach(c => { n[c.key] = c.key === "strikePrice"; }); return n; })} className="text-rose-400 hover:text-rose-300">Clear All</button>
                <button onClick={() => setVisibleCols(() => { const init: Record<string,boolean>={}; TABLE_COLUMNS.forEach(c => { init[c.key]=["ceOI","ceOIChange","ceVolume","ceIV","ceDelta","ceLtp","strikePrice","peLtp","peDelta","peIV","peVolume","peOIChange","peOI"].includes(c.key); }); return init; })} className="text-slate-400 hover:text-slate-350">Reset</button>
                <button onClick={() => setShowColPanel(false)} className="text-slate-500 hover:text-white pl-2"><X size={12} /></button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <span className="text-[9px] font-black text-rose-450 uppercase tracking-widest block mb-2">Call Options (CE)</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TABLE_COLUMNS.filter(c => c.side === "CE").map(col => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer group">
                      <input type="checkbox" checked={visibleCols[col.key]} onChange={e => setVisibleCols(prev => ({ ...prev, [col.key]: e.target.checked }))} className="accent-teal-500 w-3 h-3 cursor-pointer" />
                      <span className={`text-[11px] font-medium group-hover:text-teal-400 transition-colors ${visibleCols[col.key] ? "text-slate-200" : "text-slate-500"}`}>{col.label.replace("CE ", "")}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-[9px] font-black text-emerald-450 uppercase tracking-widest block mb-2">Put Options (PE)</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TABLE_COLUMNS.filter(c => c.side === "PE").map(col => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer group">
                      <input type="checkbox" checked={visibleCols[col.key]} onChange={e => setVisibleCols(prev => ({ ...prev, [col.key]: e.target.checked }))} className="accent-teal-500 w-3 h-3 cursor-pointer" />
                      <span className={`text-[11px] font-medium group-hover:text-teal-400 transition-colors ${visibleCols[col.key] ? "text-slate-200" : "text-slate-500"}`}>{col.label.replace("PE ", "")}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Greeks panel */}
      <GreeksPanel rows={displayStrikes} resistance={resistance} support={support} />

      {/* Main option chain table */}
      <OptionChainTable
        rows={displayStrikes}
        spotPrice={displaySpotPrice}
        atmStrike={atmStrike}
        loading={false}
        visibleCols={visibleCols}
      />
    </div>
  );
}

export default React.memo(LiveOptionChain);
