/**
 * App.tsx â€” Pure Display Layer
 *
 * REMOVED:
 *   âŒ Client-side Fyers WebSocket (fyersDataSocket)
 *   âŒ setInterval countdown timers (now derived from serverTime)
 *   âŒ Client-side score / backup calculations
 *   âŒ Market-tick dual-source state merging logic
 *   âŒ Repeated REST fetches / polling
 *
 * KEPT:
 *   âœ… Tab navigation, dark mode, print, formula bar
 *   âœ… CSV import / manual backup trigger via API
 *   âœ… Fyers OAuth2 redirect code capture â†’ POST to server
 *   âœ… All JSX rendering unchanged
 *
 * Single data source: useMarketSocket() hook â†’ server "market-update" events
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { StockData, BackupSnapshots, TIME_COLUMNS, OptionStrikeData, TEPaperTrade } from "./types";
import ExcelFormulaBar from "./components/ExcelFormulaBar";
import SummaryBoxes from "./components/SummaryBoxes";
import StockGrid from "./components/StockGrid";
import OptionChainGrid from "./components/OptionChainGrid";
import { printReport } from "./utils";
import FyersIntegration from "./components/FyersIntegration";
import LiveOptionChain from "./components/OptionChain/LiveOptionChain";
import OptionChainSummary from "./components/OptionChain/OptionChainSummary";
import { useMarketSocket } from "./hooks/useMarketSocket";
import AdvanceAI from "./components/AdvanceAI";
import StockAnalysis from "./components/StockAnalysis";
import ResizableBox from "./components/ResizableBox";
import SectorHeavyweights from "./components/SectorHeavyweights";
import MomentumScoreChart from "./components/charts/MomentumScoreChart";
import MiniChartWidget from "./components/charts/MiniChartWidget";
import TradingEngine from "./components/TradingEngine";
import TradingEngineCard from "./components/TradingEngineCard";
import HeroZeroBox from "./components/HeroZeroBox";
import AIOptionBuyingTips from "./components/AIOptionBuyingTips";
import OpenPositionsLedgerCard from "./components/OpenPositionsLedgerCard";
import PositionTradingDashboard from "./components/TradingEngine/pages/PositionTradingDashboard";
import BTSTAdvisor from "./components/BTSTAdvisor";
import MarketLayerCard from "./components/MarketLayerCard";
import TradingViewPage from "./components/charts/TradingViewPage";
import ProLiveChart from "./components/charts/ProLiveChart";
import { computeMarketRegime, type RegimeEngineInput } from "./engine/marketRegimeEngine";
import { useTradeAlarm } from "./hooks/useTradeAlarm";
import SelfLearningPermissionCard from "./components/SelfLearningPermissionCard";

import {
  Menu, Moon, Sun, ShieldCheck, RefreshCw, FileText,
  Layers, ChevronRight, Check, AlertCircle, BarChart2, TrendingUp, Info, Zap, BookOpen,
  Download, Upload, Trash2
} from "lucide-react";

// Preserve old OptionStrike shape for OptionChainGrid prop compatibility
import type { OptionStrike } from "./types";

const getApiUrl = (path: string) => {
  const host = (typeof window !== "undefined" && (window.location.protocol === "file:" || window.location.port === "5173"))
    ? "http://localhost:3000"
    : "";
  return `${host}${path}`;
};

const getBackupScoreCellClass = (scoreVal: number, darkMode: boolean, isNetScoreRow: boolean = false) => {
  if (isNaN(scoreVal)) {
    return darkMode ? "text-slate-550 bg-slate-955" : "text-slate-400 bg-slate-50/50";
  }
  if (scoreVal === 0) {
    return "bg-slate-100 text-black font-semibold";
  }

  const abs = Math.abs(scoreVal);
  if (isNetScoreRow) {
    // NET SCORE (aggregate) — 5 tiers scaled to index-level sums
    if (scoreVal > 0) {
      if (abs >= 40.0) return "bg-green-600 text-black font-black shadow-sm border border-green-700";
      if (abs >= 25.0) return "bg-green-500 text-black font-extrabold shadow-sm border border-green-600";
      if (abs >= 12.0) return "bg-green-400 text-black font-extrabold shadow-sm";
      if (abs >= 4.0)  return "bg-green-200 text-black font-bold";
      return "bg-green-50 text-black font-semibold";
    } else {
      if (abs >= 40.0) return "bg-red-600 text-black font-black shadow-sm border border-red-700";
      if (abs >= 25.0) return "bg-red-500 text-black font-extrabold shadow-sm border border-red-600";
      if (abs >= 12.0) return "bg-red-400 text-black font-extrabold shadow-sm";
      if (abs >= 4.0)  return "bg-red-200 text-black font-bold";
      return "bg-red-50 text-black font-semibold";
    }
  } else {
    // Individual stock — 5 tiers: 0→1.5→3.5→6→9→∞
    if (scoreVal > 0) {
      if (abs >= 9.0) return "bg-green-600 text-black font-black border border-green-700";
      if (abs >= 6.0) return "bg-green-500 text-black font-bold border border-green-600";
      if (abs >= 3.5) return "bg-green-400 text-black font-bold";
      if (abs >= 1.5) return "bg-green-200 text-black font-semibold";
      return "bg-green-50 text-black";
    } else {
      if (abs >= 9.0) return "bg-red-600 text-black font-black border border-red-700";
      if (abs >= 6.0) return "bg-red-500 text-black font-bold border border-red-600";
      if (abs >= 3.5) return "bg-red-400 text-black font-bold";
      if (abs >= 1.5) return "bg-red-200 text-black font-semibold";
      return "bg-red-50 text-black";
    }
  }
};

const checkIsExpiryToday = (selectedExpiry: string) => {
  if (!selectedExpiry) return { isToday: false, expiryLabel: "" };

  let expiryDate: Date | null = null;
  const fyersMatch = selectedExpiry.match(/^(\d{2})([A-Z]{3})(\d{4})$/i);
  if (fyersMatch) {
    const months: Record<string, number> = {
      JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,
      JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11
    };
    const d = parseInt(fyersMatch[1]);
    const m = months[fyersMatch[2].toUpperCase()];
    const y = parseInt(fyersMatch[3]);
    if (!isNaN(d) && m !== undefined && !isNaN(y)) {
      expiryDate = new Date(y, m, d);
    }
  } else if (/^\d+$/.test(selectedExpiry)) {
    const ts = parseInt(selectedExpiry, 10);
    const ms = ts < 10000000000 ? ts * 1000 : ts;
    expiryDate = new Date(ms);
  } else {
    const parsed = new Date(selectedExpiry);
    if (!isNaN(parsed.getTime())) expiryDate = parsed;
  }

  if (!expiryDate) return { isToday: false, expiryLabel: "" };

  const now = new Date();
  const isToday =
    expiryDate.getDate()     === now.getDate() &&
    expiryDate.getMonth()    === now.getMonth() &&
    expiryDate.getFullYear() === now.getFullYear();

  const expiryLabel = expiryDate.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });

  return { isToday, expiryLabel };
};

// ── ChartTabWrapper ────────────────────────────────────────────────────────────
// Owns its own independent index selector so the TV CHART tab doesn't
// couple to the main activePage (user can view BANKNIFTY chart while
// the LIVE tab is on NIFTY, for example).

interface ChartTabWrapperProps {
  niftySpot: number;
  bankniftySpot: number;
  sensexSpot: number;
  darkMode: boolean;
}

const CHART_INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
type ChartIndex = (typeof CHART_INDICES)[number];

const CHART_INDEX_META: Record<ChartIndex, { label: string; accent: string }> = {
  NIFTY:     { label: "NIFTY 50",   accent: "#10b981" },
  BANKNIFTY: { label: "BANK NIFTY", accent: "#8b5cf6" },
  SENSEX:    { label: "BSE SENSEX", accent: "#f59e0b" },
};

function ChartTabWrapper({ niftySpot, bankniftySpot, sensexSpot, darkMode }: ChartTabWrapperProps) {
  const [chartIndex, setChartIndex] = React.useState<ChartIndex>("NIFTY");

  const spotPrice =
    chartIndex === "NIFTY"
      ? niftySpot
      : chartIndex === "BANKNIFTY"
      ? bankniftySpot
      : sensexSpot;

  const bg    = darkMode ? "#0a0e1a" : "#f8fafc";
  const surf  = darkMode ? "#0d1117" : "#ffffff";
  const bdr   = darkMode ? "#1e2736" : "#e2e8f0";
  const muted = darkMode ? "#64748b" : "#94a3b8";
  const meta  = CHART_INDEX_META[chartIndex];

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden min-h-0"
      style={{ background: bg }}
    >
      {/* Index selector strip */}
      <div
        className="flex-shrink-0 flex items-center gap-2 px-4 py-2"
        style={{
          background: surf,
          borderBottom: `1px solid ${bdr}`,
        }}
      >
        <span
          className="text-[9px] font-black uppercase tracking-[0.2em] mr-2"
          style={{ color: muted }}
        >
          INDEX
        </span>
        {CHART_INDICES.map((idx) => {
          const m = CHART_INDEX_META[idx];
          const isActive = idx === chartIndex;
          return (
            <button
              key={idx}
              onClick={() => setChartIndex(idx)}
              className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
              style={{
                background: isActive
                  ? `${m.accent}22`
                  : "transparent",
                border: `1px solid ${isActive ? m.accent : bdr}`,
                color: isActive ? m.accent : muted,
                boxShadow: isActive ? `0 0 12px ${m.accent}33` : "none",
              }}
            >
              {m.label}
            </button>
          );
        })}

        {/* Live price badge */}
        <div className="ml-auto flex items-center gap-2">
          <span
            className="text-[10px] font-black tracking-tight tabular-nums"
            style={{ color: meta.accent }}
          >
            {spotPrice > 0
              ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })
              : "—"}
          </span>
          <span
            className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase"
            style={{
              background: `${meta.accent}22`,
              color: meta.accent,
            }}
          >
            LIVE
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ProLiveChart
          instrument={chartIndex}
          spotPrice={spotPrice}
          darkMode={darkMode}
        />
      </div>
    </div>
  );
}

// ── Last 10 Market Open Days Utility (excluding weekends) ──
const getLast10MarketOpenDays = () => {
  const dates = [];
  const now = new Date();
  // Adjust to IST
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const temp = new Date(istMs);
  
  while (dates.length < 10) {
    const day = temp.getUTCDay();
    if (day !== 0 && day !== 6) { // Not Sat or Sun
      const dStr = `${temp.getUTCFullYear()}-${String(temp.getUTCMonth() + 1).padStart(2, "0")}-${String(temp.getUTCDate()).padStart(2, "0")}`;
      dates.push(dStr);
    }
    temp.setUTCDate(temp.getUTCDate() - 1);
  }
  return dates;
};

export default function App() {
  // â”€â”€ UI state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [activePage, setActivePage] = useState<"NIFTY" | "SENSEX" | "BANKNIFTY" | "HDFCBANK" | "RELIANCE" | "ICICIBANK" | "CUSTOM_STOCK">("NIFTY");
  const [activeTab, setActiveTab] = useState<"LIVE" | "STOCK" | "OPTION" | "BACKUP" | "FYERS" | "TRADING" | "CHART" | "STOCK_ANALYSIS">("LIVE");

  const [darkMode, setDarkMode] = useState(true);
  const [showSelfLearningCard, setShowSelfLearningCard] = useState(false);

  // Check self-learning permission on startup
  useEffect(() => {
    const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
    const api = `${isLocal ? "http://localhost:3000" : ""}/api/te/self-learn/status`;
    fetch(api).then(r => r.json()).then(d => { if (d.needsPermission) setShowSelfLearningCard(true); }).catch(() => {});
  }, []);

  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    return Number(localStorage.getItem("optiongrid-font-size")) || 11; // default 11px
  });
  const [viewMode, setViewMode] = useState<"standard" | "detailed">("standard");

  // ── Database Sync States for Paper Trading ──
  const [dbTrades, setDbTrades] = useState<TEPaperTrade[]>([]);
  const loadTrades = useCallback(async () => {
    try {
      const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
      const apiUrl = `${isLocal ? "http://localhost:3000" : ""}/api/te/paper-trades`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const d = await res.json();
        setDbTrades(d.trades || []);
      }
    } catch (e) {
      console.error("Failed to load paper trades in main App:", e);
    }
  }, []);

  useEffect(() => {
    loadTrades();
    const interval = setInterval(loadTrades, 4000);
    return () => clearInterval(interval);
  }, [loadTrades]);

  // ── Pattern / Velocity Data ──
  const [patternSummary, setPatternSummary] = useState<any | null>(null);

  const loadPattern = useCallback(async () => {
    try {
      const datesRes = await fetch(getApiUrl(`/api/daily-patterns/dates?symbol=${activePage}`));
      if (datesRes.ok) {
        const dData = await datesRes.json();
        if (dData.s === "ok" && dData.dates.length > 0) {
          const latestDate = dData.dates[0];
          const r = await fetch(getApiUrl(`/api/daily-patterns/datewise?symbol=${activePage}&date=${latestDate}`));
          if (r.ok) {
            const d = await r.json();
            if (d.s === "ok") setPatternSummary(d.summary);
          }
        } else {
          setPatternSummary(null);
        }
      }
    } catch { }
  }, [activePage]);

  useEffect(() => {
    loadPattern();
    const interval = setInterval(loadPattern, 5000);
    return () => clearInterval(interval);
  }, [loadPattern]);
  const adjustFont = (amount: number) => {
    setFontSize(prev => {
      const next = Math.max(9, Math.min(18, prev + amount));
      localStorage.setItem("optiongrid-font-size", String(next));
      return next;
    });
  };

  const [activeCell, setActiveCell] = useState<{ symbol: string; field: string; value: string } | null>(null);
  const [manualBackupTime, setManualBackupTime] = useState("09:00");
  
  // Date-wise backup states
  const tradingDates = useMemo(() => getLast10MarketOpenDays(), []);
  const [availableBackupDates, setAvailableBackupDates] = useState<string[]>([]);
  const [selectedBackupDate, setSelectedBackupDate] = useState("");
  const [historicalBackup, setHistoricalBackup] = useState<any>(null);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);
  const [backupSearchText, setBackupSearchText] = useState("");

  // Load available backup dates from server
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(getApiUrl("/api/backup/available-dates"));
        if (res.ok) {
          const data = await res.json();
          if (data.dates && data.dates.length > 0) {
            setAvailableBackupDates(data.dates);
            setSelectedBackupDate(data.dates[0]);
            return;
          }
        }
      } catch (e) {
        console.error("Failed to load available backup dates:", e);
      }
      // Fallback
      setAvailableBackupDates(tradingDates);
      setSelectedBackupDate(tradingDates[0] || "");
    })();
  }, [tradingDates]);

  const backupGridRef = React.useRef<HTMLDivElement>(null);



  // ── Single source of truth: server socket ──────────────────────────────────
  const {
    socket,
    connectionStatus, fyersAuthorized, lastFyersError, isSimulating, isConnected,
    niftyStocksMap, sensexStocksMap, bankniftyStocksMap,
    niftySpot, sensexSpot, bankniftySpot,
    niftyHistory, sensexHistory, bankniftyHistory,
    niftyBackup, sensexBackup, bankniftyBackup,
    niftyTimedBackup, sensexTimedBackup, bankniftyTimedBackup,
    optionChain,
    niftyOptionChain,
    sensexOptionChain,
    bankniftyOptionChain,
    hdfcbankOptionChain,
    relianceOptionChain,
    icicibankOptionChain,
    customStockOptionChain,
    customStockSymbol,
    niftySummary, sensexSummary, bankniftySummary,
    niftyMarketDir, sensexMarketDir, bankniftyMarketDir,
    fyersConfig,
    aiAnalysis,
    serverTime,
    // Countdown strings — derived from serverTime on every "server-time" event
    countdown5m, countdown15m, countdown30m, countdown1h,
    selectExpiry,
    requestState,
    alerts,
    triggeredAlerts,
    activeTriggeredAlert,
    setActiveTriggeredAlert,
    addAlertRule,
    deleteAlertRule,
    toggleAlertRule,
    clearAlertHistory,
  } = useMarketSocket(activePage);

  // ── Trade Alarm System ─────────────────────────────────────────────────────────
  const { alarmHistory, latestAlarm, notifAllowed, requestPermission } = useTradeAlarm(socket);

  // ── Database averages for Live Nifty volume multipliers ──
  const [averages5dMap, setAverages5dMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchAverages = async () => {
      try {
        const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
        const apiUrl = `${isLocal ? "http://localhost:3000" : ""}/api/stocks/bhavcopy/averages`;
        const res = await fetch(apiUrl);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.averages) {
            const map: Record<string, number> = {};
            json.averages.forEach((item: any) => {
              if (item.symbol && item.avg_vol_5d) {
                map[item.symbol.toUpperCase()] = item.avg_vol_5d;
              }
            });
            setAverages5dMap(map);
          }
        }
      } catch (err) {
        console.error("Failed to fetch 5d average volumes in App.tsx:", err);
      }
    };
    fetchAverages();
    const interval = setInterval(fetchAverages, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const niftyExpiry = checkIsExpiryToday(niftyOptionChain?.selectedExpiry || "");
  const sensexExpiry = checkIsExpiryToday(sensexOptionChain?.selectedExpiry || "");
  const bankniftyExpiry = checkIsExpiryToday(bankniftyOptionChain?.selectedExpiry || "");
 
  const activeBanners: { id: string; label: string }[] = [];
  if (niftyExpiry.isToday) {
    activeBanners.push({
      id: "NIFTY",
      label: niftyExpiry.expiryLabel
    });
  }
  if (sensexExpiry.isToday) {
    activeBanners.push({
      id: "SENSEX",
      label: sensexExpiry.expiryLabel
    });
  }
  if (bankniftyExpiry.isToday) {
    activeBanners.push({
      id: "BANKNIFTY",
      label: bankniftyExpiry.expiryLabel
    });
  }

  // ── First 15M Range Engine state ───────────────────────────────────────
  const [niftyRange, setNiftyRange] = useState<{ high: number; low: number; frozen: boolean; date?: string }>(() => {
    const saved = localStorage.getItem("mios-nifty-15m-range");
    return saved ? JSON.parse(saved) : { high: 0, low: Infinity, frozen: false, date: "" };
  });
  const [sensexRange, setSensexRange] = useState<{ high: number; low: number; frozen: boolean; date?: string }>(() => {
    const saved = localStorage.getItem("mios-sensex-15m-range");
    return saved ? JSON.parse(saved) : { high: 0, low: Infinity, frozen: false, date: "" };
  });
  const [bankniftyRange, setBankniftyRange] = useState<{ high: number; low: number; frozen: boolean; date?: string }>(() => {
    const saved = localStorage.getItem("mios-banknifty-15m-range");
    return saved ? JSON.parse(saved) : { high: 0, low: Infinity, frozen: false, date: "" };
  });

  // Track 15M high/low range on server ticks
  // RULE: Only the FIRST 15-minute candle (09:15–09:30 IST) of each trading day
  //       is captured. The range freezes at 09:30 and stays fixed until the next
  //       trading day. On a new day (or if the stored date doesn't match today),
  //       the range resets automatically.
  useEffect(() => {
    if (!serverTime) return;

    // Convert serverTime to IST time (IST is UTC + 5:30)
    const istDate = new Date(serverTime + 5.5 * 60 * 60 * 1000);
    const h = istDate.getUTCHours();
    const m = istDate.getUTCMinutes();
    const totalMinutes = h * 60 + m;

    // Today's IST date string for day-boundary detection (YYYY-MM-DD)
    const todayIST = `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, "0")}-${String(istDate.getUTCDate()).padStart(2, "0")}`;

    const is15mPeriod = totalMinutes >= 9 * 60 + 15 && totalMinutes < 9 * 60 + 30;

    // Helper: update a single range (nifty or sensex)
    const updateRange = (
      spot: number,
      setRange: React.Dispatch<React.SetStateAction<{ high: number; low: number; frozen: boolean; date?: string }>>,
      storageKey: string,
    ) => {
      setRange(prev => {
        // ── New day? Reset the range ──
        if (prev.date && prev.date !== todayIST) {
          if (is15mPeriod && spot > 0) {
            const next = { high: spot, low: spot, frozen: false, date: todayIST };
            localStorage.setItem(storageKey, JSON.stringify(next));
            return next;
          }
          // New day but before 09:15 – just clear old data
          const next = { high: 0, low: Infinity, frozen: false, date: todayIST };
          localStorage.setItem(storageKey, JSON.stringify(next));
          return next;
        }

        // ── Already frozen for today – nothing to do ──
        if (prev.frozen) return prev;

        // ── Past 09:30 → freeze the range ──
        if (totalMinutes >= 9 * 60 + 30) {
          const next = { ...prev, frozen: true, date: todayIST };
          localStorage.setItem(storageKey, JSON.stringify(next));
          return next;
        }

        // ── Inside 09:15–09:30 → track high/low ──
        if (is15mPeriod && spot > 0) {
          const nextHigh = Math.max(prev.high, spot);
          const nextLow = prev.low === 0 || prev.low === Infinity ? spot : Math.min(prev.low, spot);
          if (nextHigh === prev.high && nextLow === prev.low) return prev; // no change
          const next = { high: nextHigh, low: nextLow, frozen: false, date: todayIST };
          localStorage.setItem(storageKey, JSON.stringify(next));
          return next;
        }

        return prev;
      });
    };

    updateRange(niftySpot, setNiftyRange, "mios-nifty-15m-range");
    updateRange(sensexSpot, setSensexRange, "mios-sensex-15m-range");
    updateRange(bankniftySpot, setBankniftyRange, "mios-banknifty-15m-range");
  }, [serverTime, niftySpot, sensexSpot, bankniftySpot]);

  // Fetch historical backup data on selectedBackupDate change
  useEffect(() => {
    if (!selectedBackupDate) return;
    
    // If it's today's date, and we already have live backup data in memory, don't fetch.
    const isToday = selectedBackupDate === tradingDates[0];
    const liveBackupData = activePage === "NIFTY" ? niftyBackup :
                           activePage === "BANKNIFTY" ? bankniftyBackup :
                           sensexBackup;
    const hasLiveData = Object.keys(liveBackupData || {}).length > 0;
    
    if (isToday && hasLiveData) {
      setHistoricalBackup(null);
      return;
    }
    
    (async () => {
      setIsLoadingHistorical(true);
      try {
        const res = await fetch(getApiUrl(`/api/backup/get?date=${selectedBackupDate}`));
        if (res.ok) {
          const data = await res.json();
          const fileBackup = activePage === "NIFTY" ? (data.nifty || {}) :
                             activePage === "BANKNIFTY" ? (data.banknifty || {}) :
                             (data.sensex || {});
          setHistoricalBackup(fileBackup);
        } else {
          setHistoricalBackup({});
        }
      } catch (err) {
        console.error("Failed to load historical backup:", err);
        setHistoricalBackup({});
      } finally {
        setIsLoadingHistorical(false);
      }
    })();
  }, [selectedBackupDate, activePage, tradingDates, niftyBackup, sensexBackup, bankniftyBackup]);

  // â”€â”€ Fyers OAuth2 redirect handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authCode = params.get("auth_code");
    if (!authCode) return;

    console.log("[Fyers Auth] Captured redirect auth_code from URL");
    (async () => {
      try {
        const res = await fetch(getApiUrl("/api/fyers/validate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth_code: authCode }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (data.access_token) localStorage.setItem("fyers_access_token", data.access_token);
          alert("Fyers connected successfully! Real-time data feed activated.");
          setActiveTab("FYERS");
        } else {
          alert("Fyers token validation failed: " + (data.error ?? "Verify credentials."));
        }
      } catch (e: any) {
        console.error("Error validating auth code:", e);
        alert("Network error exchanging auth code.");
      } finally {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      }
    })();
  }, []);

  // â”€â”€ Dark mode DOM sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // â”€â”€ Horizontal arrow-key scrolling for BACKUP tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const container = backupGridRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        container.scrollLeft -= 120;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        container.scrollLeft += 120;
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTab]);

  // â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleEditCell = async (symbol: string, field: string, value: string) => {
    try {
      const res = await fetch(getApiUrl("/api/stocks/edit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: activePage, symbol, field, value }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error ?? "Failed to commit cell edit");
    } catch (err) {
      console.error("Error committing cell change:", err);
    }
  };

  const handleCommitFormula = (newValue: string) => {
    if (activeCell) handleEditCell(activeCell.symbol, activeCell.field, newValue);
  };

  const handleCSVImport = async (importedData: any[]) => {
    try {
      const res = await fetch(getApiUrl("/api/stocks/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: activePage, data: importedData }),
      });
      if (res.ok) alert(`Successfully imported CSV into ${activePage} sheet!`);
    } catch (err) {
      console.error("Error importing CSV:", err);
    }
  };

  const handleTriggerBackup = async () => {
    try {
      const res = await fetch(getApiUrl("/api/backup/trigger"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: manualBackupTime }),
      });
      if (res.ok) alert(`Backup snapshot triggered for: ${manualBackupTime}`);
    } catch (err) {
      console.error("Error triggering backup:", err);
    }
  };

  const handleCSVBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        if (!text) return;

        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.length < 2) {
          alert("Invalid CSV: File must have headers and at least one data row.");
          return;
        }

        // Parse headers
        const headers = lines[0].split(",").map(h => h.trim().toUpperCase());
        const symbolIdx = headers.findIndex(h => h === "SYMBOL" || h === "A" || h === "TICKER" || h === "SYMBOL (A)");
        const finalSymbolIdx = symbolIdx !== -1 ? symbolIdx : 0;

        // Map time columns and their indexes
        const timeCols: { timeStr: string; index: number }[] = [];
        headers.forEach((h, idx) => {
          if (idx === finalSymbolIdx) return;
          // Check if header is a valid time format HH:MM
          if (/^\d{2}:\d{2}$/.test(h)) {
            timeCols.push({ timeStr: h, index: idx });
          }
        });

        if (timeCols.length === 0) {
          alert("Invalid CSV: No time columns (HH:MM format) found in the headers.");
          return;
        }

        const importedPayload: Record<string, Record<string, number>> = {};

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(",").map(p => p.trim());
          const rawSym = parts[finalSymbolIdx];
          if (!rawSym) continue;
          const symbol = rawSym.toUpperCase();
          
          importedPayload[symbol] = {};

          timeCols.forEach(col => {
            const valStr = parts[col.index];
            if (valStr !== undefined && valStr !== "" && valStr !== "—" && valStr !== "-") {
              const score = parseFloat(valStr);
              if (!isNaN(score)) {
                importedPayload[symbol][col.timeStr] = score;
              }
            }
          });
        }

        // Send to server
        const res = await fetch(getApiUrl("/api/backup/import"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page: activePage, data: importedPayload, date: selectedBackupDate })
        });

        if (res.ok) {
          alert(`Successfully imported backup data for ${activePage}!`);
        } else {
          const errData = await res.json();
          alert(`Failed to import data: ${errData.error || "Unknown server error"}`);
        }
      } catch (err: any) {
        alert(`Error reading/parsing CSV: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCSVBackupExport = () => {
    try {
      const csvRows = [];
      const headers = ["SYMBOL (A)", ...TIME_COLUMNS];
      csvRows.push(headers.join(","));

      currentStocksOnly.forEach(st => {
        const row = [st.symbol];
        TIME_COLUMNS.forEach(col => {
          const val = currentBackup[st.symbol]?.[col];
          row.push(val !== undefined && val !== null ? val.toFixed(3) : "");
        });
        csvRows.push(row.join(","));
      });

      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${activePage.toLowerCase()}_backup_scores.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleJSONBackupExport = async () => {
    try {
      const res = await fetch(getApiUrl(`/api/backup/get?date=${selectedBackupDate}`));
      if (!res.ok) throw new Error("Failed to fetch backup data from server");
      const data = await res.json();
      const jsonContent = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `all_indices_backup_${selectedBackupDate}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleJSONBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        if (!text) return;

        const importedPayload = JSON.parse(text);
        if (!importedPayload.nifty && !importedPayload.sensex && !importedPayload.banknifty) {
          alert("Invalid JSON format: Must contain nifty, sensex, or banknifty key.");
          return;
        }

        const res = await fetch(getApiUrl("/api/backup/import-all"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: importedPayload, date: selectedBackupDate })
        });

        if (res.ok) {
          alert(`Successfully imported all indices backup data!`);
          if (selectedBackupDate !== tradingDates[0]) {
            const res2 = await fetch(getApiUrl(`/api/backup/get?date=${selectedBackupDate}`));
            if (res2.ok) {
              const data = await res2.json();
              const fileBackup = activePage === "NIFTY" ? (data.nifty || {}) :
                                 activePage === "BANKNIFTY" ? (data.banknifty || {}) :
                                 (data.sensex || {});
              setHistoricalBackup(fileBackup);
            }
          }
        } else {
          const errData = await res.json();
          alert(`Failed to import JSON data: ${errData.error || "Unknown server error"}`);
        }
      } catch (err: any) {
        alert(`Error reading/parsing JSON file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCSVBackupClear = async () => {
    if (!confirm(`Are you absolutely sure you want to clear ALL backup score data for ${activePage}? This cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(getApiUrl("/api/backup/clear"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: activePage, date: selectedBackupDate })
      });
      if (res.ok) {
        alert(`Cleared all backup score data for ${activePage}.`);
      } else {
        const errData = await res.json();
        alert(`Clear failed: ${errData.error || "Unknown server error"}`);
      }
    } catch (err: any) {
      alert(`Clear failed: ${err.message}`);
    }
  };

  const handleSaveFyersConfig = async (newConfig: any) => {
    try {
      const res = await fetch(getApiUrl("/api/fyers/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig),
      });
      const data = await res.json();
      if (data.fyersAuthorized) {
        if (newConfig.access_token) localStorage.setItem("fyers_access_token", newConfig.access_token);
        alert("Fyers configuration saved & verified! Server-side WebSocket activated.");
      } else {
        alert("Configuration saved, but authorization failed: " + (data.lastFyersError ?? "Verify token."));
      }
    } catch (err) {
      console.error("Error setting Fyers config:", err);
      alert("Network error updating Fyers config.");
    }
  };

  const handleToggleSimulate = async (simulate: boolean) => {
    try {
      const res = await fetch(getApiUrl("/api/fyers/simulate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate }),
      });
      if (res.ok) {
        console.log(`[App] Simulation mode toggled successfully to: ${simulate}`);
      } else {
        alert("Failed to toggle simulation mode on server");
      }
    } catch (err) {
      console.error("Error toggling simulation mode:", err);
      alert("Error contacting server for simulation toggle");
    }
  };

  // â”€â”€ Derived display data with defensive safety guards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const niftyStocks = useMemo(() => Object.values(niftyStocksMap || {}), [niftyStocksMap]);
  const sensexStocks = useMemo(() => Object.values(sensexStocksMap || {}), [sensexStocksMap]);
  const bankniftyStocks = useMemo(() => Object.values(bankniftyStocksMap || {}), [bankniftyStocksMap]);

  // Calculate Gap Analysis data for Nifty, Sensex and Banknifty
  const gapAnalysisData = useMemo(() => {
    // Nifty
    const niftyRow = (niftyStocks || []).find(s => s.ticker === "NSE:NIFTY50-INDEX");
    const niftyOpen = niftyRow?.open || niftySpot || 0;
    const niftyPrev = niftyRow?.prevClose || niftyHistory?.prevClose || 0;
    const niftyGapPoints = niftyOpen > 0 && niftyPrev > 0 ? niftyOpen - niftyPrev : 0;
    const niftyGapPercent = niftyPrev > 0 ? (niftyGapPoints / niftyPrev) * 100 : 0;

    // Sensex
    const sensexRow = (sensexStocks || []).find(s => s.ticker === "BSE:SENSEX-INDEX");
    const sensexOpen = sensexRow?.open || sensexSpot || 0;
    const sensexPrev = sensexRow?.prevClose || sensexHistory?.prevClose || 0;
    const sensexGapPoints = sensexOpen > 0 && sensexPrev > 0 ? sensexOpen - sensexPrev : 0;
    const sensexGapPercent = sensexPrev > 0 ? (sensexGapPoints / sensexPrev) * 100 : 0;

    // Banknifty
    const bankniftyRow = (bankniftyStocks || []).find(s => s.ticker === "NSE:NIFTYBANK-INDEX");
    const bankniftyOpen = bankniftyRow?.open || bankniftySpot || 0;
    const bankniftyPrev = bankniftyRow?.prevClose || bankniftyHistory?.prevClose || 0;
    const bankniftyGapPoints = bankniftyOpen > 0 && bankniftyPrev > 0 ? bankniftyOpen - bankniftyPrev : 0;
    const bankniftyGapPercent = bankniftyPrev > 0 ? (bankniftyGapPoints / bankniftyPrev) * 100 : 0;

    const getGapStatusAndSignal = (gapPoints: number) => {
      if (gapPoints > 15) {
        return {
          status: "GAP UP ðŸ”¼",
          signal: gapPoints > 100 ? "Huge Gap Up - Watch for Profit Booking" : "Moderate Gap Up - Buy on Dip",
          styleClass: "bg-green-700/80 text-white px-3 py-1 rounded shadow-[0_0_10px_rgba(22,163,74,0.3)] font-bold text-xs",
          borderClass: "border-green-500/30 bg-green-950/20 text-green-300"
        };
      } else if (gapPoints < -15) {
        return {
          status: "GAP DOWN ðŸ”½",
          signal: gapPoints < -100 ? "Huge Gap Down - Watch for Short Covering" : "Moderate Gap Down - Sell on Rise",
          styleClass: "bg-red-700/80 text-white px-3 py-1 rounded shadow-[0_0_10px_rgba(220,38,38,0.3)] font-bold text-xs",
          borderClass: "border-red-500/30 bg-red-955/20 text-rose-300"
        };
      } else {
        return {
          status: "FLAT OPEN âž–",
          signal: "Range Bound - Wait for Direction",
          styleClass: "bg-slate-700/80 text-slate-200 px-3 py-1 rounded font-bold text-xs",
          borderClass: "border-slate-800 bg-slate-900/40 text-slate-400"
        };
      }
    };

    return {
      nifty: {
        open: niftyOpen,
        prev: niftyPrev,
        points: niftyGapPoints,
        percent: niftyGapPercent,
        ...getGapStatusAndSignal(niftyGapPoints)
      },
      sensex: {
        open: sensexOpen,
        prev: sensexPrev,
        points: sensexGapPoints,
        percent: sensexGapPercent,
        ...getGapStatusAndSignal(sensexGapPoints)
      },
      banknifty: {
        open: bankniftyOpen,
        prev: bankniftyPrev,
        points: bankniftyGapPoints,
        percent: bankniftyGapPercent,
        ...getGapStatusAndSignal(bankniftyGapPoints)
      }
    };
  }, [niftyStocks, sensexStocks, bankniftyStocks, niftySpot, sensexSpot, bankniftySpot, niftyHistory, sensexHistory, bankniftyHistory]);

  const currentStocks = activePage === "NIFTY" ? (niftyStocks || []) :
                        activePage === "BANKNIFTY" ? (bankniftyStocks || []) :
                        activePage === "SENSEX" ? (sensexStocks || []) :
                        [];
  const currentStocksOnly = useMemo(() =>
    currentStocks.filter(s => s.ticker !== "NSE:NIFTY50-INDEX" && s.ticker !== "BSE:SENSEX-INDEX" && s.ticker !== "NSE:NIFTYBANK-INDEX"),
    [currentStocks]
  );

  const filteredBackupStocks = useMemo(() => {
    let list = [...currentStocksOnly];
    if (backupSearchText.trim() !== "") {
      list = list.filter(st => st.symbol.toLowerCase().includes(backupSearchText.toLowerCase()));
    }
    // Sort by weightage descending by default for the best setup
    return list.sort((a, b) => (b.weightage || 0) - (a.weightage || 0));
  }, [currentStocksOnly, backupSearchText]);

  // Map new OptionChainState strikes → old OptionStrike shape for OptionChainGrid
  const legacyOptionChain: OptionStrike[] = useMemo(() =>
    (optionChain?.strikes || []).map(s => ({
      strikePrice: s.strikePrice || 0,
      ceVolume: s.ceVolume || 0,
      ceOI: s.ceOI || 0,
      ceOIChange: s.ceOIChange || 0,
      ceLtp: s.ceLtp || 0,
      ceChg: s.ceLtpChgPct || 0,
      ceBid: s.ceBid || 0,
      ceAsk: s.ceAsk || 0,
      ceIV: s.ceIV || 0,
      ceDelta: s.ceDelta || 0,
      ceGamma: s.ceGamma || 0,
      ceTheta: s.ceTheta || 0,
      ceVega: s.ceVega || 0,
      peVolume: s.peVolume || 0,
      peOI: s.peOI || 0,
      peOIChange: s.peOIChange || 0,
      peLtp: s.peLtp || 0,
      peChg: s.peLtpChgPct || 0,
      peBid: s.peBid || 0,
      peAsk: s.peAsk || 0,
      peIV: s.peIV || 0,
      peDelta: s.peDelta || 0,
      peGamma: s.peGamma || 0,
      peTheta: s.peTheta || 0,
      peVega: s.peVega || 0,
    })),
    [optionChain?.strikes]
  );

  // Compute PCR and sentiment metrics from legacyOptionChain
  const { pcr, sentiment } = useMemo(() => {
    const totalCallOI = legacyOptionChain.reduce((acc, curr) => acc + curr.ceOI, 0);
    const totalPutOI = legacyOptionChain.reduce((acc, curr) => acc + curr.peOI, 0);
    const totalOI = totalCallOI + totalPutOI;
    const pcrVal = totalOI ? parseFloat((totalPutOI / totalCallOI).toFixed(3)) : 1.0;
    const sentimentVal = pcrVal > 1.25 ? "Strongly Bullish" : pcrVal > 1.0 ? "Bullish" : pcrVal > 0.85 ? "Neutral" : pcrVal > 0.6 ? "Bearish" : "Strongly Bearish";
    return { pcr: pcrVal, sentiment: sentimentVal };
  }, [legacyOptionChain]);

  const currentSpot = activePage === "NIFTY" ? (niftySpot || niftyOptionChain?.spotPrice || optionChain?.spotPrice || 0) :
                      activePage === "BANKNIFTY" ? (bankniftySpot || bankniftyOptionChain?.spotPrice || optionChain?.spotPrice || 0) :
                      activePage === "SENSEX" ? (sensexSpot || sensexOptionChain?.spotPrice || optionChain?.spotPrice || 0) :
                      (optionChain?.spotPrice || 0);
  const currentHistory = activePage === "NIFTY" ? (niftyHistory || { high: 0, low: 0, prevClose: 0 }) :
                         activePage === "BANKNIFTY" ? (bankniftyHistory || { high: 0, low: 0, prevClose: 0 }) :
                         activePage === "SENSEX" ? (sensexHistory || { high: 0, low: 0, prevClose: 0 }) :
                         {
                           high: optionChain?.highPrice || 0,
                           low: optionChain?.lowPrice || 0,
                           prevClose: (optionChain?.spotPrice || 0) - (optionChain?.spotChange || 0)
                         };
  const liveBackup = activePage === "NIFTY" ? (niftyBackup || {}) :
                     activePage === "BANKNIFTY" ? (bankniftyBackup || {}) :
                     (sensexBackup || {});
  const currentBackup = useMemo(() => {
    const isToday = selectedBackupDate === tradingDates[0];
    if (isToday) {
      const hasLiveData = Object.keys(liveBackup || {}).length > 0;
      if (hasLiveData) return liveBackup;
    }
    return historicalBackup || {};
  }, [selectedBackupDate, tradingDates, liveBackup, historicalBackup]);

  const hasAnyBackupData = useMemo(() => {
    if (!currentBackup) return false;
    return Object.values(currentBackup).some(row => 
      row && Object.values(row).some(val => val !== null && val !== undefined)
    );
  }, [currentBackup]);

  // Auto-scroll to the latest column when BACKUP tab is opened
  useEffect(() => {
    if (activeTab === "BACKUP" && backupGridRef.current && hasAnyBackupData) {
      let latestColIdx = -1;
      for (let i = TIME_COLUMNS.length - 1; i >= 0; i--) {
        const col = TIME_COLUMNS[i];
        const hasData = Object.values(currentBackup).some(row => row && row[col] !== undefined && row[col] !== null);
        if (hasData) {
          latestColIdx = i;
          break;
        }
      }
      
      if (latestColIdx !== -1) {
        setTimeout(() => {
          if (backupGridRef.current) {
            backupGridRef.current.scrollLeft = 188 + (latestColIdx * 65) - (backupGridRef.current.clientWidth / 2);
          }
        }, 300);
      }
    }
  }, [activeTab, currentBackup, hasAnyBackupData]);
  const currentSummary = activePage === "NIFTY" ? (niftySummary || { top10Sum: 0, next15Sum: 0, remainingSum: 0, totalSum: 0, advances: 0, declines: 0, unchanged: 0 }) :
                         activePage === "BANKNIFTY" ? (bankniftySummary || { top10Sum: 0, next15Sum: 0, remainingSum: 0, totalSum: 0, advances: 0, declines: 0, unchanged: 0 }) :
                         activePage === "SENSEX" ? (sensexSummary || { top10Sum: 0, next15Sum: 0, remainingSum: 0, totalSum: 0, advances: 0, declines: 0, unchanged: 0 }) :
                         { top10Sum: 0, next15Sum: 0, remainingSum: 0, totalSum: 0, advances: 0, declines: 0, unchanged: 0 };
  const strikeGap = useMemo(() => {
    if (activePage === "NIFTY") return 50;
    if (activePage === "BANKNIFTY" || activePage === "SENSEX") return 100;
    if (legacyOptionChain && legacyOptionChain.length > 1) {
      const diff = Math.abs(legacyOptionChain[1].strikePrice - legacyOptionChain[0].strikePrice);
      if (diff > 0) return diff;
    }
    return 10;
  }, [activePage, legacyOptionChain]);
  const spotChange = optionChain?.spotChange || 0;
  const spotChangePct = optionChain?.spotChangePct || 0;
  const dayHigh = currentHistory.high || 0;
  const dayLow = currentHistory.low || 0;
  const ptsFromHigh = dayHigh > 0 ? currentSpot - dayHigh : 0;
  const pctFromHigh = dayHigh > 0 ? (ptsFromHigh / dayHigh) * 100 : 0;
  const ptsFromLow = dayLow > 0 ? currentSpot - dayLow : 0;
  const pctFromLow = dayLow > 0 ? (ptsFromLow / dayLow) * 100 : 0;

  const sortedByWeightage = useMemo(() => [...currentStocksOnly].sort((a, b) => (b.weightage || 0) - (a.weightage || 0)), [currentStocksOnly]);
  const top25 = sortedByWeightage.slice(0, activePage === "BANKNIFTY" ? 12 : (activePage === "SENSEX" ? 22 : 25));

  const topHeavySummary = useMemo(() => {
    const adv = top25.filter(s => s && s.changePercent > 0).length;
    const dec = top25.filter(s => s && s.changePercent < 0).length;
    return { advances: adv, declines: dec, net: adv - dec };
  }, [top25]);

  const { top10Sum: top10ScoresSum, next15Sum: next15ScoresSum, remainingSum: remainingScoresSum } = currentSummary;
  const { advances, declines, unchanged } = currentSummary;
  const totalScore = currentSummary.totalSum || 0;

  // ── Market Regime Engine data ─────────────────────────────────────────────
  const regimeData = useMemo(() => {
    const score5mNet = currentStocksOnly.reduce((acc, s) => acc + (s.scoreDifference || 0), 0);
    const score15mNet = currentStocksOnly.reduce((acc, s) => acc + (s.score15mDiff || 0), 0);
    const top25ScoreDiff = top25.reduce((acc, s) => acc + (s.scoreDifference || 0), 0);
    const supportWall = aiAnalysis?.report?.oi?.supportWall || currentHistory.low || 0;
    const resistanceWall = aiAnalysis?.report?.oi?.resistanceWall || currentHistory.high || 0;
    return { score5mNet, score15mNet, top25ScoreDiff, supportWall, resistanceWall };
  }, [currentStocksOnly, top25, aiAnalysis, currentHistory]);

  const positiveBigStocks = currentStocksOnly.filter(s => s && s.weightage > 3 && (s.score || 0) > 0);
  const negativeBigStocks = currentStocksOnly.filter(s => s && s.weightage > 3 && (s.score || 0) < 0);

  const displayHeavyweights = useMemo(() => {
    const targetSymbols = ["HDFCBANK", "ICICIBANK", "RELIANCE"];
    const targetStocks = targetSymbols
      .map(sym => currentStocksOnly.find(s => s.symbol.toUpperCase() === sym))
      .filter(Boolean) as StockData[];

    const otherHeavy = currentStocksOnly.filter(s =>
      s && s.weightage > 3 && !targetSymbols.includes(s.symbol.toUpperCase())
    );

    const otherPos = otherHeavy.filter(s => (s.score || 0) > 0).sort((a, b) => b.score - a.score);
    const otherNeg = otherHeavy.filter(s => (s.score || 0) < 0).sort((a, b) => a.score - b.score);

    const selectedOthers = [];
    const maxOthersEach = 3;
    for (let i = 0; i < maxOthersEach; i++) {
      if (otherPos[i]) selectedOthers.push(otherPos[i]);
      if (otherNeg[i]) selectedOthers.push(otherNeg[i]);
    }

    const combinedHeavy = [...targetStocks, ...selectedOthers];
    const uniqueHeavy: StockData[] = [];
    const seen = new Set<string>();
    combinedHeavy.forEach(s => {
      if (!seen.has(s.symbol)) {
        seen.add(s.symbol);
        uniqueHeavy.push(s);
      }
    });

    return uniqueHeavy.length % 2 === 0
      ? uniqueHeavy
      : uniqueHeavy.slice(0, uniqueHeavy.length - 1);
  }, [currentStocks]);



  // Compute 15M range fallback and scoring details
  const range15m = useMemo(() => {
    const isIndex = activePage === "NIFTY" || activePage === "SENSEX" || activePage === "BANKNIFTY";
    const raw = activePage === "BANKNIFTY" ? bankniftyRange : (activePage === "SENSEX" ? sensexRange : niftyRange);
    const spot = currentSpot;
    
    // If not set, use sensible fallback (±0.2% of spot)
    if (!isIndex || raw.high === 0 || raw.low === Infinity || raw.low === 0) {
      return {
        high: spot * 1.002,
        low: spot * 0.998,
        isFallback: true
      };
    }
    return { ...raw, isFallback: false };
  }, [activePage, niftyRange, sensexRange, currentSpot]);

  // ── Layer 1: Regime Result (computed at App level for Layer 2+ consumption) ─
  const regimeResult = useMemo(() => {
    const input: RegimeEngineInput = {
      spotPrice: currentSpot,
      range15mHigh: range15m.high,
      range15mLow: range15m.low,
      range15mFallback: range15m.isFallback ?? false,
      overallScore: totalScore,
      score5mNet: regimeData.score5mNet,
      score15mNet: regimeData.score15mNet,
      t10: top10ScoresSum, t15: next15ScoresSum,
      top25Score: top10ScoresSum + next15ScoresSum,
      top25ScoreDiff: regimeData.top25ScoreDiff,
      pcr, advances, declines,
      support: regimeData.supportWall,
      resistance: regimeData.resistanceWall,
    };
    return computeMarketRegime(input);
  }, [currentSpot, range15m, totalScore, regimeData, top10ScoresSum, next15ScoresSum, pcr, advances, declines]);

  // Compute option chain dominance metrics for the AI Confidence Engine
  const optionDominance = useMemo(() => {
    const totalCallOI = legacyOptionChain.reduce((acc, curr) => acc + curr.ceOI, 0);
    const totalPutOI = legacyOptionChain.reduce((acc, curr) => acc + curr.peOI, 0);
    const totalCallVol = legacyOptionChain.reduce((acc, curr) => acc + curr.ceVolume, 0);
    const totalPutVol = legacyOptionChain.reduce((acc, curr) => acc + curr.peVolume, 0);
    const totalCallOIchg = legacyOptionChain.reduce((acc, curr) => acc + curr.ceOIChange, 0);
    const totalPutOIchg = legacyOptionChain.reduce((acc, curr) => acc + curr.peOIChange, 0);

    const optionChainStrength = totalPutOI + totalCallOI > 0 ? (totalPutOI - totalCallOI) / (totalPutOI + totalCallOI) : 0;
    const volumeDominance = totalCallVol + totalPutVol > 0 ? (totalCallVol - totalPutVol) / (totalCallVol + totalPutVol) : 0;
    const oiDominance = totalPutOI + totalCallOI > 0 ? (totalPutOI - totalCallOI) / (totalPutOI + totalCallOI) : 0;
    const oiChangeDominance = totalPutOIchg + totalCallOIchg > 0 ? (totalPutOIchg - totalCallOIchg) / (totalPutOIchg + totalCallOIchg) : 0;

    return { optionChainStrength, volumeDominance, oiDominance, oiChangeDominance };
  }, [legacyOptionChain]);

  const bullishScore = useMemo(() => {
    let score = 0;
    const sortedByWeight = [...currentStocksOnly].sort((a, b) => b.weightage - a.weightage);
    const top10 = sortedByWeight.slice(0, 10);
    const nextSliceEnd = activePage === "SENSEX" ? 22 : 25;
    const next15 = sortedByWeight.slice(10, nextSliceEnd);
    
    const t10Sum = top10.reduce((acc, s) => acc + (s.score || 0), 0);
    const t15Sum = next15.reduce((acc, s) => acc + (s.score || 0), 0);
    const overallScore = currentStocksOnly.reduce((acc, s) => acc + (s.score || 0), 0);
    const score5mNet = currentStocksOnly.reduce((acc, s) => acc + (s.scoreDifference || 0), 0);
    const score15mNet = currentStocksOnly.reduce((acc, s) => acc + (s.score15mDiff || 0), 0);
    
    const advances = currentStocksOnly.filter(s => s.changePercent > 0).length;
    const declines = currentStocksOnly.filter(s => s.changePercent < 0).length;
    
    const positiveStocks = currentStocksOnly.filter(s => s.score > 0).length;
    const negativeStocks = currentStocksOnly.filter(s => s.score < 0).length;
    
    const support = aiAnalysis.report.oi.supportWall || currentHistory.low;
    const resistance = aiAnalysis.report.oi.resistanceWall || currentHistory.high;
    
    // Heavyweights logic
    const heavyStockList = currentStocksOnly.filter(s =>
      s.weightage > 3 || ["HDFCBANK", "ICICIBANK", "RELIANCE"].includes(s.symbol.toUpperCase())
    );
    const heavySum = heavyStockList.reduce((acc, s) => acc + (s.score || 0), 0);
    const hasHeavyweightAbove3 = heavyStockList.some(s => s.changePercent > 3);

    const hdfc = currentStocksOnly.find(s => s.symbol.toUpperCase() === "HDFCBANK")?.changePercent || 0;
    const icici = currentStocksOnly.find(s => s.symbol.toUpperCase() === "ICICIBANK")?.changePercent || 0;
    const reliance = currentStocksOnly.find(s => s.symbol.toUpperCase() === "RELIANCE")?.changePercent || 0;

    const { optionChainStrength, volumeDominance, oiDominance, oiChangeDominance } = optionDominance;

    // Apply the 22 weighted factors:
    if (aiAnalysis.report.trend.overall === "BULLISH") score += 10;
    if (score5mNet > 0) score += 5;
    if (score15mNet > 0) score += 5;
    if (t10Sum > 0) score += 10;
    if (t15Sum > 0) score += 10;
    if (overallScore > 50) score += 10;
    else if (overallScore > 0) score += 5;
    if (pcr > 1.2) score += 10;
    else if (pcr >= 1.0) score += 5;
    if (sentiment.toLowerCase().includes("strongly bullish")) score += 10;
    else if (sentiment.toLowerCase().includes("bullish")) score += 7;
    else if (sentiment.toLowerCase().includes("neutral")) score += 3;
    if (support > 0 && currentSpot >= support && currentSpot <= support * 1.01) score += 5;
    else if (support > 0 && currentSpot > support) score += 3;
    if (resistance > 0 && currentSpot > resistance) score += 5;
    if (advances > declines) score += 5;
    if (positiveStocks > negativeStocks) score += 5;
    if (hasHeavyweightAbove3) score += 5;
    if (hdfc > 0.5) score += 5;
    else if (hdfc > 0) score += 2;
    if (icici > 0.5) score += 5;
    else if (icici > 0) score += 2;
    if (reliance > 0.5) score += 5;
    else if (reliance > 0) score += 2;
    if (optionChainStrength > 0.1) score += 10;
    else if (optionChainStrength > 0) score += 5;
    if (volumeDominance > 0.1) score += 5;
    if (oiDominance > 0.1) score += 5;
    if (oiChangeDominance > 0.1) score += 10;
    else if (oiChangeDominance > 0) score += 5;

    const maxWeight = 145;
    return Math.round((score / maxWeight) * 100);
  }, [currentStocksOnly, currentSpot, activePage, range15m, aiAnalysis, pcr, currentHistory, sentiment, optionDominance]);

  const bearishScore = useMemo(() => {
    let score = 0;
    const sortedByWeight = [...currentStocksOnly].sort((a, b) => b.weightage - a.weightage);
    const top10 = sortedByWeight.slice(0, 10);
    const nextSliceEnd = activePage === "SENSEX" ? 22 : 25;
    const next15 = sortedByWeight.slice(10, nextSliceEnd);
    
    const t10Sum = top10.reduce((acc, s) => acc + (s.score || 0), 0);
    const t15Sum = next15.reduce((acc, s) => acc + (s.score || 0), 0);
    const overallScore = currentStocksOnly.reduce((acc, s) => acc + (s.score || 0), 0);
    const score5mNet = currentStocksOnly.reduce((acc, s) => acc + (s.scoreDifference || 0), 0);
    const score15mNet = currentStocksOnly.reduce((acc, s) => acc + (s.score15mDiff || 0), 0);
    
    const advances = currentStocksOnly.filter(s => s.changePercent > 0).length;
    const declines = currentStocksOnly.filter(s => s.changePercent < 0).length;
    
    const positiveStocks = currentStocksOnly.filter(s => s.score > 0).length;
    const negativeStocks = currentStocksOnly.filter(s => s.score < 0).length;
    
    const support = aiAnalysis.report.oi.supportWall || currentHistory.low;
    const resistance = aiAnalysis.report.oi.resistanceWall || currentHistory.high;
    
    // Heavyweights logic
    const heavyStockList = currentStocksOnly.filter(s =>
      s.weightage > 3 || ["HDFCBANK", "ICICIBANK", "RELIANCE"].includes(s.symbol.toUpperCase())
    );
    const hasHeavyweightBelowNeg3 = heavyStockList.some(s => s.changePercent < -3);

    const hdfc = currentStocksOnly.find(s => s.symbol.toUpperCase() === "HDFCBANK")?.changePercent || 0;
    const icici = currentStocksOnly.find(s => s.symbol.toUpperCase() === "ICICIBANK")?.changePercent || 0;
    const reliance = currentStocksOnly.find(s => s.symbol.toUpperCase() === "RELIANCE")?.changePercent || 0;

    const { optionChainStrength, volumeDominance, oiDominance, oiChangeDominance } = optionDominance;

    // Apply the 22 weighted factors for bearish:
    if (aiAnalysis.report.trend.overall === "BEARISH") score += 10;
    if (score5mNet < 0) score += 5;
    if (score15mNet < 0) score += 5;
    if (t10Sum < 0) score += 10;
    if (t15Sum < 0) score += 10;
    if (overallScore < -50) score += 10;
    else if (overallScore < 0) score += 5;
    if (pcr < 0.8) score += 10;
    else if (pcr <= 0.9) score += 5;
    if (sentiment.toLowerCase().includes("strongly bearish")) score += 10;
    else if (sentiment.toLowerCase().includes("bearish")) score += 7;
    else if (sentiment.toLowerCase().includes("neutral")) score += 3;
    if (support > 0 && currentSpot < support) score += 5;
    if (resistance > 0 && currentSpot <= resistance && currentSpot >= resistance * 0.99) score += 5;
    else if (resistance > 0 && currentSpot < resistance) score += 3;
    if (declines > advances) score += 5;
    if (negativeStocks > positiveStocks) score += 5;
    if (hasHeavyweightBelowNeg3) score += 5;
    if (hdfc < -0.5) score += 5;
    else if (hdfc < 0) score += 2;
    if (icici < -0.5) score += 5;
    else if (icici < 0) score += 2;
    if (reliance < -0.5) score += 5;
    else if (reliance < 0) score += 2;
    if (optionChainStrength < -0.1) score += 10;
    else if (optionChainStrength < 0) score += 5;
    if (volumeDominance < -0.1) score += 5;
    if (oiDominance < -0.1) score += 5;
    if (oiChangeDominance < -0.1) score += 10;
    else if (oiChangeDominance < 0) score += 5;

    const maxWeight = 145;
    return Math.round((score / maxWeight) * 100);
  }, [currentStocksOnly, currentSpot, activePage, range15m, aiAnalysis, pcr, currentHistory, sentiment, optionDominance]);

  const { signal, confidence, bias } = useMemo(() => {
    const sortedByWeight = [...currentStocksOnly].sort((a, b) => b.weightage - a.weightage);
    const top10 = sortedByWeight.slice(0, 10);
    const nextSliceEnd = activePage === "SENSEX" ? 22 : 25;
    const next15 = sortedByWeight.slice(10, nextSliceEnd);
    
    const t10Sum = top10.reduce((acc, s) => acc + (s.score || 0), 0);
    const t15Sum = next15.reduce((acc, s) => acc + (s.score || 0), 0);
    const overallScore = currentStocksOnly.reduce((acc, s) => acc + (s.score || 0), 0);
    const advances = currentStocksOnly.filter(s => s.changePercent > 0).length;
    const declines = currentStocksOnly.filter(s => s.changePercent < 0).length;

    const isAboveHigh = range15m.high > 0 && currentSpot > range15m.high;
    const isBelowLow = range15m.low > 0 && range15m.low !== Infinity && currentSpot < range15m.low;

    // Check Momentum
    const isStrongCeMomentum = isAboveHigh &&
      overallScore > 50 &&
      t10Sum > 20 &&
      t15Sum > 20 &&
      advances > declines * 2;

    const isStrongPeMomentum = isBelowLow &&
      overallScore < -50 &&
      t10Sum < -20 &&
      t15Sum < -20 &&
      declines > advances * 2;

    // Confidence Calculation using Agreement scaling:
    const maxScore = Math.max(bullishScore, bearishScore);
    const absDiff = Math.abs(bullishScore - bearishScore);
    const confidenceVal = Math.min(100, Math.round(maxScore + (100 - maxScore) * (absDiff / 100) * 0.5));

    let signalVal = "ðŸŸ¡ WAIT";
    let biasVal = "NEUTRAL";

    if (isStrongCeMomentum) {
      signalVal = "ðŸ”¥ STRONG CE MOMENTUM";
      biasVal = "BULLISH";
    } else if (isStrongPeMomentum) {
      signalVal = "ðŸ”¥ STRONG PE MOMENTUM";
      biasVal = "BEARISH";
    } else if (isAboveHigh && bullishScore >= 70) {
      signalVal = "ðŸŸ¢ BUY CE";
      biasVal = "BULLISH";
    } else if (isBelowLow && bearishScore >= 70) {
      signalVal = "ðŸ”´ BUY PE";
      biasVal = "BEARISH";
    } else {
      signalVal = "ðŸŸ¡ WAIT";
      biasVal = bullishScore > 55 ? "BULLISH" : bearishScore > 55 ? "BEARISH" : "NEUTRAL";
    }

    return { signal: signalVal, confidence: confidenceVal, bias: biasVal };
  }, [currentSpot, activePage, range15m, bullishScore, bearishScore, currentStocksOnly]);

  const getGradientClass = (score: number) => {
    if (score > 0) {
      if (score < 1) return "bg-[#00ff88]/5 text-[#00ff88] border-l-2 border-[#00ff88] font-semibold";
      if (score < 5) return "bg-[#00e5ff]/10 text-[#00e5ff] border-l-2 border-[#00e5ff] font-bold";
      return "bg-[#00ffaa]/15 text-[#00ffaa] border-l-2 border-[#00ffaa] font-black";
    } else if (score < 0) {
      const abs = Math.abs(score);
      if (abs < 1) return "bg-[#ff3366]/5 text-[#ff3366] border-l-2 border-[#ff3366] font-semibold";
      if (abs < 5) return "bg-[#ff2a5f]/10 text-[#ff2a5f] border-l-2 border-[#ff2a5f] font-bold";
      return "bg-[#ff0055]/15 text-[#ff0055] border-l-2 border-[#ff0055] font-black";
    }
    return "text-slate-400 dark:text-slate-200 border-l-2 border-slate-500 font-medium";
  };

  const getStockChipClass = (s: any, isPositive: boolean) => {
    const symbolUpper = s.symbol.toUpperCase();
    const isSuperHeavy = symbolUpper.includes("HDFCBANK") ||
      symbolUpper.includes("ICICIBANK") ||
      symbolUpper.includes("RELIANCE") ||
      symbolUpper.includes("RELAINCE") ||
      symbolUpper.includes("ICCICIBANK");
    const isHighVolatility = Math.abs(s.changePercent) > 1.0;

    let baseCls = "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-all ";

    if (isSuperHeavy) {
      // Super heavyweights get a premium gold/amber border, slightly larger scale, and extra bold text, but keeping their positive/negative font colors!
      baseCls += "border-2 border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/10 scale-105 font-black ";
      if (isPositive) {
        baseCls += "text-emerald-600 dark:text-emerald-450 ";
      } else {
        baseCls += "text-rose-650 dark:text-rose-500 ";
      }
    } else if (isHighVolatility) {
      // High performance/volatility (> 1%) gets a stronger color fill and a solid border
      baseCls += "font-extrabold ";
      if (isPositive) {
        baseCls += "bg-emerald-500/20 border border-emerald-500/50 text-emerald-600 dark:text-emerald-450 shadow-sm ";
      } else {
        baseCls += "bg-red-500/20 border border-red-500/50 text-rose-500 shadow-sm ";
      }
    } else {
      // Normal stocks get the default styling
      baseCls += "font-bold ";
      if (isPositive) {
        baseCls += "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-450 ";
      } else {
        baseCls += "bg-red-500/10 border border-red-500/20 text-rose-500 ";
      }
    }

    return { className: baseCls, isSuperHeavy, isHighVolatility };
  };

  // Heatmap styling helper for Top 25 Weightage Index summary cards.
  // maxVal: the highest absolute value among all three boxes — that box gets full opacity (1.0),
  // others are scaled proportionally so the dominant value always appears fully saturated.
  const getSummaryBoxStyle = (val: number, maxVal: number) => {
    if (val === 0 || maxVal === 0) {
      return {
        backgroundColor: darkMode ? "rgba(30, 41, 59, 0.25)" : "rgba(241, 245, 249, 0.35)",
        color: darkMode ? "#94a3b8" : "#64748b",
        borderColor: darkMode ? "rgba(30, 41, 59, 0.8)" : "rgba(226, 232, 240, 0.8)",
        labelColor: darkMode ? "#64748b" : "#94a3b8"
      };
    }
    
    const isPos = val > 0;
    const absVal = Math.abs(val);
    // Ratio is relative to the largest absolute value, so the dominant box is always 1.0
    const ratio = Math.min(1.0, absVal / maxVal);
    
    // Opacity range: 0.18 (near-zero) → 1.0 (dominant / largest absolute value)
    const alpha = 0.18 + ratio * 0.82;
    
    const bg = isPos 
      ? `rgba(16, 185, 129, ${alpha.toFixed(3)})` // emerald-500
      : `rgba(239, 68, 68, ${alpha.toFixed(3)})`;  // red-500
      
    let textColor = "#ffffff";
    let labelColor = "rgba(255, 255, 255, 0.85)";
    
    // Contrast check: switch to dark text on very light backgrounds
    if (!darkMode) {
      if (alpha <= 0.52) {
        textColor = isPos ? "#065f46" : "#9f1239";
        labelColor = isPos ? "#047857" : "#b91c1c";
      }
    } else {
      if (alpha <= 0.45) {
        textColor = isPos ? "#34d399" : "#f87171";
        labelColor = isPos ? "#10b981" : "#ef4444";
      }
    }
    
    const border = isPos
      ? `rgba(16, 185, 129, 0.45)`
      : `rgba(239, 68, 68, 0.45)`;
      
    return {
      backgroundColor: bg,
      color: textColor,
      borderColor: border,
      labelColor: labelColor
    };
  };

  // Status badge color
  const statusColor = {
    LIVE: "bg-emerald-500",
    RECONNECTING: "bg-amber-500 animate-pulse",
    DISCONNECTED: "bg-slate-500",
    EXPIRED: "bg-red-500",
  }[connectionStatus] ?? "bg-slate-500";

  return (
    <div className={`flex flex-col min-h-screen pb-[36px] font-sans ${darkMode ? "bg-slate-955 text-slate-100" : "bg-slate-50 text-slate-800"
      }`}>
      {/* ── Self-Learning Permission Card (startup modal) ── */}
      {showSelfLearningCard && (
        <SelfLearningPermissionCard onDismiss={() => setShowSelfLearningCard(false)} />
      )}
      {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-300 select-none bg-white text-black">
        <div className="flex items-center gap-4 md:gap-6">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-1.5 rounded text-white flex items-center justify-center font-bold">
              <Layers size={16} />
            </div>
            <div className="flex flex-col">
              <h1 className="text-sm font-bold tracking-tight text-black">SM ANALYZER</h1>
              <span className="text-[9px] text-slate-500 font-mono tracking-wide">Fyers API + Realtime WebSocket Engine</span>
            </div>
          </div>

          {/* Index selector */}
          <div className="flex bg-slate-100 p-0.5 rounded border border-gray-300">
            <button
              onClick={() => setActivePage("NIFTY")}
              className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${activePage === "NIFTY"
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
                }`}
            >NIFTY</button>
            <button
              onClick={() => setActivePage("BANKNIFTY")}
              className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${activePage === "BANKNIFTY"
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
                }`}
            >BANKNIFTY</button>
            <button
              onClick={() => setActivePage("SENSEX")}
              className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${activePage === "SENSEX"
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
                }`}
            >SENSEX</button>
          </div>

          {/* Stock selector */}
          <div className="flex bg-slate-100 p-0.5 rounded border border-gray-300">
            <button
              onClick={() => setActivePage("HDFCBANK")}
              className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${activePage === "HDFCBANK"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
                }`}
            >HDFCBANK</button>
            <button
              onClick={() => setActivePage("RELIANCE")}
              className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${activePage === "RELIANCE"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
                }`}
            >RELIANCE</button>
            <button
              onClick={() => setActivePage("ICICIBANK")}
              className={`px-3 py-1 text-xs font-bold rounded cursor-pointer transition-colors ${activePage === "ICICIBANK"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
                }`}
            >ICICIBANK</button>
          </div>

          {/* Custom Stock selector */}
          <div className="flex bg-slate-100 p-0.5 rounded border border-gray-300">
            <select
              value={["NIFTY", "SENSEX", "BANKNIFTY", "HDFCBANK", "RELIANCE", "ICICIBANK"].includes(activePage) ? "" : (customStockSymbol || "CUSTOM")}
              onChange={async (e) => {
                const sym = e.target.value;
                if (!sym) return;
                
                setActivePage("CUSTOM_STOCK");
                
                try {
                  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
                  const apiUrl = `${isLocal ? "http://localhost:3000" : ""}/api/te/select-custom-stock`;
                  const res = await fetch(apiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ symbol: sym })
                  });
                  if (!res.ok) {
                    console.error("Failed to select custom stock on backend");
                  }
                } catch (err) {
                  console.error("Error selecting custom stock:", err);
                }
              }}
              className="px-2 py-0.5 text-xs font-bold bg-white text-slate-800 rounded border border-gray-300 outline-none cursor-pointer"
            >
              <option value="">-- Custom Stock --</option>
              {[
                "SBIN", "TCS", "INFY", "BHARTIARTL", "LT", "AXISBANK", "ITC", "KOTAKBANK", "M&M",
                "TATACONSUM", "HINDUNILVR", "MARUTI", "SUNPHARMA", "NTPC", "TITAN", "TATASTEEL", 
                "BEL", "ULTRACEMCO", "SHRIRAMFIN", "HCLTECH", "HINDALCO", "POWERGRID", "JSWSTEEL", 
                "BAJAJFINSV", "ONGC", "ADANIPORTS", "BAJAJ-AUTO", "EICHERMOT", "GRASIM", "ASIANPAINT", 
                "INDIGO", "COALINDIA", "NESTLEIND", "SBILIFE", "TECHM", "TRENT", "APOLLOHOSP", 
                "DRREDDY", "CIPLA", "HDFCLIFE", "WIPRO", "ADANIENT", "INDUSINDBK", "BANKBARODA", 
                "AUBANK", "FEDERALBNK", "IDFCFIRSTB", "PNB", "BANDHANBNK"
              ].sort().map(sym => (
                <option key={sym} value={sym}>{sym}</option>
              ))}
            </select>
          </div>

          {/* Expiry Banner pills */}
          {activeBanners.map(b => (
            <div key={b.id} className="flex items-center gap-2 py-1.5 px-4 bg-red-600 text-white rounded-full select-none shadow-[0_2px_10px_rgba(220,38,38,0.6)] animate-pulse">
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              <span className="text-[12px] font-black uppercase tracking-wider text-white">
                {b.id} EXPIRY
              </span>
              <span className="text-[10.5px] font-bold opacity-90 tracking-wider border border-white/30 rounded px-2 py-0.5 bg-white/10">
                {b.label}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">

          {/* Connection status badge */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded font-mono border bg-slate-900 border-slate-700 text-slate-350">
            <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`}></span>
            {connectionStatus}
          </div>

          {/* Layout Resizer Mode Toggle */}
          <button
            onClick={() => setLayoutEditMode(!layoutEditMode)}
            title="Enable layout resizing and customization controls for all boxes"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded font-mono border cursor-pointer outline-none transition-colors ${layoutEditMode
                ? "bg-teal-900/30 border-teal-700 text-teal-400 font-bold hover:bg-teal-900/50"
                : "bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800"
              }`}
          >
            ðŸ”§ LAYOUT RESIZER: {layoutEditMode ? "ON" : "OFF"}
          </button>

          {/* Fyers auth badge */}
          <button
            onClick={() => setActiveTab("FYERS")}
            title="Configure Fyers Live API integration"
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded font-mono border cursor-pointer outline-none transition-colors ${fyersAuthorized
                ? "bg-emerald-900/20 border-emerald-800 text-emerald-600 hover:bg-emerald-900/40"
                : "bg-amber-900/20 border-amber-800 text-amber-600 hover:bg-amber-900/35"
              }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${fyersAuthorized ? "bg-emerald-500 animate-pulse" : "bg-amber-500 animate-ping"}`}></span>
            FYERS API: {fyersAuthorized ? "LIVE" : "OFFLINE"}
          </button>

          {/* Print */}
          <button
            onClick={() => printReport(`${activePage} Stock Market Dashboard`, "dashboard-print-root")}
            title="Print PDF Report"
            className="p-1.5 rounded border border-gray-300 font-bold cursor-pointer bg-white text-slate-700 hover:bg-slate-100"
          >
            <FileText size={16} />
          </button>
        </div>
      </header>



      <main className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "LIVE" && (
          <div className="flex-1 flex flex-row gap-1.5 p-1.5 overflow-hidden h-full min-h-0">
            {/* Left Column: Top 25/22 Index & Spot Price Analytics */}
            <ResizableBox id="live-left-panel" defaultWidth="25%" editMode={layoutEditMode} className="h-full min-h-0">
              <div className="w-full h-full flex flex-col gap-1.5 min-w-[270px] overflow-y-auto pr-1">

                {/* 2. Other analytics modules (Index Weightage Box) - HIGH-END VIBRANT PITCH BLACK DESIGN */}
                <div className={`flex-1 flex flex-col min-h-[350px] shadow-xl border rounded-2xl overflow-hidden relative transition-all duration-300 select-none ${
                  darkMode
                    ? "bg-gradient-to-br from-[#121c33]/90 via-[#0e1628]/95 to-[#0b101c]/90 border-[#1d2a45] text-slate-100 shadow-[0_0_25px_rgba(99,102,241,0.08)] hover:border-indigo-500/40"
                    : "bg-gradient-to-br from-slate-50/95 via-slate-100/90 to-slate-200/95 border-slate-200 text-slate-800 shadow-[0_0_25px_rgba(99,102,241,0.05)] hover:border-indigo-300"
                }`}>
                  {/* Neon Top Accent Line */}
                  <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-teal-400 via-indigo-500 to-purple-500 opacity-100" />

                  {/* Header */}
                  <div className="border-b flex-shrink-0 bg-[#064e3b] text-white border-emerald-800/60 shadow-sm relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 pointer-events-none" />
                    
                    <div className="p-1.5 pt-2 pb-0 flex flex-col items-center justify-center relative z-10 w-full">
                      <span className="text-[13px] font-black uppercase tracking-[0.15em] text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)] flex items-center justify-center mb-2">
                        {activePage} {activePage === "BANKNIFTY" ? "TOP 12" : (activePage === "SENSEX" ? "TOP 22" : "TOP 25")} WEIGHTAGE INDEX
                      </span>
                    </div>
                  </div>

                  {/* SUM Metrics Row */}
                  <div className={`grid grid-cols-3 border-b font-sans text-center flex-shrink-0 ${
                    darkMode ? "border-[#1d2a45]/80" : "border-slate-200/80"
                  }`}>
                    {/* SUM T10 */}
                    {(() => {
                      const _sumMaxT = Math.max(Math.abs(top10ScoresSum), Math.abs(next15ScoresSum), Math.abs(remainingScoresSum));
                      const styleObj = getSummaryBoxStyle(top10ScoresSum, _sumMaxT);
                      return (
                        <div
                          style={{ backgroundColor: styleObj.backgroundColor }}
                          className={`py-1 px-1 border-r transition-all duration-300 ${
                            darkMode ? "border-[#1d2a45]/85" : "border-slate-200/85"
                          }`}
                        >
                          <span
                            style={{ color: styleObj.labelColor }}
                            className="text-[8.5px] font-black tracking-wider uppercase"
                          >
                            SUM T10
                          </span>
                          <div
                            style={{ color: styleObj.color }}
                            className="text-[26px] font-black mt-0.5 tracking-tight drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.4)] leading-none"
                          >
                            {top10ScoresSum > 0 ? `+${top10ScoresSum.toFixed(2)}` : top10ScoresSum.toFixed(2)}
                          </div>
                        </div>
                      );
                    })()}

                    {/* SUM N15 */}
                    {(() => {
                      const _sumMaxN = Math.max(Math.abs(top10ScoresSum), Math.abs(next15ScoresSum), Math.abs(remainingScoresSum));
                      const styleObj = getSummaryBoxStyle(next15ScoresSum, _sumMaxN);
                      return (
                        <div
                          style={{ backgroundColor: styleObj.backgroundColor }}
                          className={`py-1 px-1 border-r transition-all duration-300 ${
                            darkMode ? "border-[#1d2a45]/85" : "border-slate-200/85"
                          }`}
                        >
                          <span
                            style={{ color: styleObj.labelColor }}
                            className="text-[8.5px] font-black tracking-wider uppercase"
                          >
                            SUM {activePage === "SENSEX" ? "N12" : "N15"}
                          </span>
                          <div
                            style={{ color: styleObj.color }}
                            className="text-[26px] font-black mt-0.5 tracking-tight drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.4)] leading-none"
                          >
                            {next15ScoresSum > 0 ? `+${next15ScoresSum.toFixed(2)}` : next15ScoresSum.toFixed(2)}
                          </div>
                        </div>
                      );
                    })()}

                    {/* OTHER 25 */}
                    {(() => {
                      const _sumMaxO = Math.max(Math.abs(top10ScoresSum), Math.abs(next15ScoresSum), Math.abs(remainingScoresSum));
                      const styleObj = getSummaryBoxStyle(remainingScoresSum, _sumMaxO);
                      return (
                        <div
                          style={{ backgroundColor: styleObj.backgroundColor }}
                          className="py-1 px-1 transition-all duration-300"
                        >
                          <span
                            style={{ color: styleObj.labelColor }}
                            className="text-[8.5px] font-black tracking-wider uppercase"
                          >
                            OTHER {activePage === "SENSEX" ? "8" : "25"}
                          </span>
                          <div
                            style={{ color: styleObj.color }}
                            className="text-[26px] font-black mt-0.5 tracking-tight drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.4)] leading-none"
                          >
                            {remainingScoresSum > 0 ? `+${remainingScoresSum.toFixed(2)}` : remainingScoresSum.toFixed(2)}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Stock Constituents Table */}
                  <div className="flex-1 overflow-auto custom-dashboard-scrollbar">
                    <table className="w-full text-left border-collapse text-[10.5px] font-sans">
                      <thead>
                        <tr className="border-b dark:border-[#1d2a45]/80">
                          <th className="py-1 pl-2 text-slate-500 font-mono text-[9px] sticky top-0 z-20 bg-slate-200 dark:bg-[#0e1628] border-b border-slate-300 dark:border-slate-800">#</th>
                          <th className="py-1 px-1.5 text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 sticky top-0 z-20 bg-slate-200 dark:bg-[#0e1628] border-b border-slate-300 dark:border-slate-800">SYMBOL</th>
                          <th className="py-1 px-1.5 text-center text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 sticky top-0 z-20 bg-slate-200 dark:bg-[#0e1628] border-b border-slate-300 dark:border-slate-800">SCORE</th>
                          <th className="py-1 px-1.5 text-center text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 sticky top-0 z-20 bg-slate-200 dark:bg-[#0e1628] border-b border-slate-300 dark:border-slate-800">15m DIFF</th>
                          {(activePage === "NIFTY" || activePage === "BANKNIFTY" || activePage === "SENSEX") && (
                            <th className="py-1 px-1.5 text-right text-[9px] font-black uppercase tracking-wider text-indigo-650 dark:text-indigo-400 sticky top-0 z-20 bg-slate-200 dark:bg-[#0e1628] border-b border-slate-300 dark:border-slate-800">VOL x5D</th>
                          )}
                          <th className="py-1 px-1.5 text-right text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 sticky top-0 z-20 bg-slate-200 dark:bg-[#0e1628] border-b border-slate-300 dark:border-slate-800">LTP</th>
                          <th className="py-1 pr-2 text-right text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 sticky top-0 z-20 bg-slate-200 dark:bg-[#0e1628] border-b border-slate-300 dark:border-slate-800">IMPACT</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${
                        darkMode ? "divide-[#1d2a45]/40 text-slate-200" : "divide-slate-200/50 text-slate-700"
                      }`}>
                        {top25.map((st, index) => {
                          const showSeparator = activePage !== "BANKNIFTY" && index === 9;
                          const rowBg = index % 2 === 0
                            ? (darkMode ? "bg-slate-950/10 hover:bg-indigo-950/20" : "bg-slate-100/10 hover:bg-indigo-50/20")
                            : (darkMode ? "bg-slate-955/5 hover:bg-indigo-950/15" : "bg-slate-50/10 hover:bg-indigo-50/15");
                          
                          const scoreVal = st.score;
                          const hasScore = scoreVal !== 0;
                          const scoreClass = hasScore 
                            ? (scoreVal > 0 
                              ? (darkMode 
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)] font-black"
                                : "bg-emerald-50 text-emerald-600 border border-emerald-250 font-black") 
                              : (darkMode 
                                ? "bg-rose-500/15 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)] font-black"
                                : "bg-rose-50 text-rose-600 border border-rose-250 font-black")) 
                            : (darkMode ? "bg-slate-800/80 text-slate-400" : "bg-slate-150 text-slate-600");

                          const diffVal = st.score15mDiff || 0;
                          const hasDiff = diffVal !== 0;
                          const diffClass = hasDiff 
                            ? (diffVal > 0 
                              ? (darkMode 
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)] font-black"
                                : "bg-emerald-50 text-emerald-600 border border-emerald-250 font-black") 
                              : (darkMode 
                                ? "bg-rose-500/15 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)] font-black"
                                : "bg-rose-50 text-rose-600 border border-rose-250 font-black")) 
                            : (darkMode ? "bg-slate-800/80 text-slate-400" : "bg-slate-150 text-slate-600");

                          return (
                            <React.Fragment key={st.symbol}>
                              <tr className={`transition-colors h-[22px] border-b ${rowBg} ${
                                darkMode ? "border-[#1d2a45]/30" : "border-slate-200/30"
                              }`}>
                                <td className="py-0.5 pl-2 text-slate-500 font-mono text-[9.5px]">{index + 1}</td>
                                <td className={`py-0.5 px-1.5 font-bold font-sans text-[11px] tracking-wide border-r border-slate-250/30 dark:border-slate-800/50 ${
                                  darkMode ? "text-slate-100" : "text-slate-800"
                                }`}>{st.symbol}</td>
                                <td className="py-0.5 px-1.5 text-center align-middle">
                                  <div className="flex items-center justify-center w-full">
                                    <span className={`${scoreClass} px-1.5 py-[0.5px] rounded text-[10px] font-extrabold shadow-sm w-12 text-center`}>
                                      {scoreVal > 0 ? `+${scoreVal.toFixed(2)}` : scoreVal.toFixed(2)}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-0.5 px-1.5 text-center align-middle">
                                  <div className="flex items-center justify-center w-full">
                                    <span className={`${diffClass} px-1.5 py-[0.5px] rounded text-[10px] font-extrabold shadow-sm w-12 text-center`}>
                                      {diffVal > 0 ? `+${diffVal.toFixed(2)}` : diffVal.toFixed(2)}
                                    </span>
                                  </div>
                                </td>
                                {(activePage === "NIFTY" || activePage === "BANKNIFTY" || activePage === "SENSEX") && (() => {
                                  const avg5d = averages5dMap[st.symbol.toUpperCase()];
                                  const rawVol = st.volume || 0;
                                  const isMultAvail = avg5d && avg5d > 0 && rawVol > 0;
                                  const mult = isMultAvail ? rawVol / avg5d : 0;
                                  return (
                                    <td className="py-0.5 px-1.5 text-right align-middle font-mono">
                                      <div className="flex items-center justify-end w-full">
                                        {isMultAvail ? (
                                          mult >= 1.0 ? (
                                            <span className={`px-1.5 py-[1px] rounded-sm text-[10px] border shadow-sm ${
                                              mult >= 2.0
                                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 dark:border-emerald-500/30 font-black"
                                                : "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20 dark:border-teal-500/30 font-extrabold"
                                            }`}>
                                              {mult.toFixed(2)}
                                            </span>
                                          ) : (
                                            <span className={`text-[10.5px] font-bold ${darkMode ? "text-slate-450" : "text-slate-550"}`}>
                                              {mult.toFixed(2)}
                                            </span>
                                          )
                                        ) : (
                                          <span className={`text-[10.5px] ${darkMode ? "text-slate-600" : "text-slate-400"}`}>—</span>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })()}
                                <td className={`py-0.5 px-1.5 text-right font-mono font-bold text-[11px] ${
                                  darkMode ? "text-slate-350" : "text-slate-650"
                                }`}>{st.ltp.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                <td className="py-0.5 pr-2 text-right font-mono font-bold text-[11px]">
                                  {(() => {
                                    const impactVal = (st.weightage / 100) * st.changePercent;
                                    const impactColor = impactVal > 0 
                                      ? (darkMode ? "text-emerald-400" : "text-emerald-600") 
                                      : impactVal < 0 
                                      ? (darkMode ? "text-rose-400" : "text-rose-600") 
                                      : (darkMode ? "text-slate-400" : "text-slate-550");
                                    return (
                                      <span className={impactColor}>
                                        {impactVal > 0 ? "+" : ""}{impactVal.toFixed(3)}
                                      </span>
                                    );
                                  })()}
                                </td>
                              </tr>
                              {showSeparator && (
                                <tr className="h-7 select-none pointer-events-none">
                                  <td colSpan={(activePage === "NIFTY" || activePage === "BANKNIFTY" || activePage === "SENSEX") ? 7 : 6} className="p-0 border-y border-emerald-600/50 text-[10px] uppercase tracking-[0.18em] text-center font-black py-1.5 bg-[#064e3b] text-emerald-100 shadow-sm">
                                    -- NEXT {activePage === "SENSEX" ? "12" : "15"} WEIGHTAGE STOCKS --
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2.5. Swing Position Trade Dashboard (Isolated for 2-5 days holds) */}
                <ResizableBox id="position-trading-card" editMode={layoutEditMode} className="flex-shrink-0 mt-2">
                  <PositionTradingDashboard
                    activePage={activePage}
                    spotPrice={currentSpot}
                    darkMode={darkMode}
                    expiryList={(() => {
                      const chain = activePage === "NIFTY" ? niftyOptionChain : activePage === "BANKNIFTY" ? bankniftyOptionChain : sensexOptionChain;
                      return [
                        chain?.selectedExpiry || "",
                        chain?.nextWeeklyExpiry || "",
                        chain?.monthlyExpiry || ""
                      ].filter(Boolean);
                    })()}
                  />
                </ResizableBox>

                <ResizableBox id="hero-zero-card" editMode={layoutEditMode} className="flex-shrink-0 mt-2">
                  <HeroZeroBox
                    activePage={activePage}
                    spotPrice={currentSpot}
                    optionChain={legacyOptionChain}
                    darkMode={darkMode}
                  />
                </ResizableBox>

                <ResizableBox id="live-engine-card" editMode={layoutEditMode} className="flex-shrink-0">
                  <TradingEngineCard
                    activePage={activePage}
                    spotPrice={currentSpot}
                    optionChain={legacyOptionChain}
                    strikeGap={strikeGap}
                    darkMode={darkMode}
                    regimeResult={regimeResult}
                    regimeData={regimeData}
                    bullishScore={bullishScore}
                    bearishScore={bearishScore}
                    pcr={pcr}
                    sentiment={sentiment}
                    range15m={range15m}
                    totalScore={totalScore}
                    advances={advances}
                    declines={declines}
                    heavyweights={currentStocksOnly}
                    aiAnalysis={aiAnalysis}
                  />
                </ResizableBox>

                <ResizableBox id="live-ai-buying-tips" editMode={layoutEditMode} className="flex-shrink-0">
                  <AIOptionBuyingTips strikes={legacyOptionChain} spotPrice={currentSpot} strikeGap={strikeGap} activePage={activePage} darkMode={darkMode} range15m={range15m} />
                </ResizableBox>

              </div>
            </ResizableBox>

            {/* Right: Dashboard */}
            <div className="flex-1 flex flex-col gap-1.5 overflow-hidden pr-1 h-full min-h-0">
              
              {/* Symmetrical split: Timeframes + Summary on the left, Sector Heavyweights sidebar on the right */}
              <div className="flex flex-col lg:flex-row gap-1.5 items-stretch w-full min-h-0">
                {/* Left Side: Timeframes & Option Summary Deck */}
                <div className="flex-1 flex flex-col gap-1.5 min-h-0">
                  <ResizableBox id="live-summary-boxes" editMode={layoutEditMode}>
                    <SummaryBoxes 
                      stocks={currentStocksOnly} 
                      backup={currentBackup} 
                      darkMode={darkMode} 
                      todayOpen={gapAnalysisData.nifty.open}
                      previousClose={gapAnalysisData.nifty.prev}
                      sensexOpen={gapAnalysisData.sensex.open}
                      sensexPrev={gapAnalysisData.sensex.prev}
                      bankniftyOpen={gapAnalysisData.banknifty?.open}
                      bankniftyPrev={gapAnalysisData.banknifty?.prev}
                      velocity={aiAnalysis?.report?.speed?.velocity ?? 0}
                      momentum={aiAnalysis?.momentum?.momentumScore ?? 0}
                      conviction={aiAnalysis?.antigravity?.confidence ?? 0}
                      alignment={aiAnalysis?.alignment?.alignmentScore ?? 0}
                      confidence={aiAnalysis?.report?.trend?.strengthPct ?? 0}
                      ceProb={(aiAnalysis as any)?.aiEngineV2?.probabilityBreakdown?.bullish ?? 0}
                      peProb={(aiAnalysis as any)?.aiEngineV2?.probabilityBreakdown?.bearish ?? 0}
                      breakout={aiAnalysis?.breakout}
                    />
                  </ResizableBox>
                  
                  {/* Option Summary + Market Layer Analysis — side by side */}
                  <div className="flex gap-1.5 w-full items-stretch">
                    <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                      <ResizableBox id="live-option-summary" editMode={layoutEditMode} className="w-full">
                        <OptionChainSummary strikes={legacyOptionChain} spotPrice={currentSpot} strikeGap={strikeGap} darkMode={darkMode} />
                      </ResizableBox>
                      
                      <ResizableBox id="live-open-positions-ledger" editMode={layoutEditMode} className="w-full">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 w-full">
                          <OpenPositionsLedgerCard
                            forceInstrument="NIFTY"
                            activePage={activePage}
                            spotPrice={currentSpot}
                            dbTrades={dbTrades}
                            optionChain={legacyOptionChain}
                            niftyOptionChain={niftyOptionChain?.strikes ?? legacyOptionChain}
                            onTradeClosed={loadTrades}
                            darkMode={darkMode}
                          />
                          <OpenPositionsLedgerCard
                            forceInstrument="BANKNIFTY"
                            activePage={activePage}
                            spotPrice={currentSpot}
                            dbTrades={dbTrades}
                            optionChain={legacyOptionChain}
                            bankniftyOptionChain={bankniftyOptionChain?.strikes ?? legacyOptionChain}
                            onTradeClosed={loadTrades}
                            darkMode={darkMode}
                          />
                          <OpenPositionsLedgerCard
                            forceInstrument="SENSEX"
                            activePage={activePage}
                            spotPrice={currentSpot}
                            dbTrades={dbTrades}
                            optionChain={legacyOptionChain}
                            sensexOptionChain={sensexOptionChain?.strikes ?? legacyOptionChain}
                            onTradeClosed={loadTrades}
                            darkMode={darkMode}
                          />
                        </div>
                      </ResizableBox>
                    </div>

                    {/* Right: Market Layer Analysis Card — spans full height */}
                    <ResizableBox id="live-market-layer-analysis-side" editMode={layoutEditMode} className="flex-shrink-0 w-[330px] xl:w-[380px]">
                      <div className="h-full">
                        <MarketLayerCard
                          marketDir={
                            activePage === "NIFTY"
                              ? niftyMarketDir
                              : activePage === "BANKNIFTY"
                              ? bankniftyMarketDir
                              : activePage === "SENSEX"
                              ? sensexMarketDir
                              : null
                          }
                          activePage={activePage}
                          darkMode={darkMode}
                        />
                      </div>
                    </ResizableBox>
                  </div>
                </div>

                {/* Right Side: Tall Sector Heavyweight monitoring panel */}
                <div className="w-full lg:w-[210px] xl:w-[220px] flex-shrink-0 flex flex-col gap-1.5 min-h-0">
                  <ResizableBox id="live-heavyweights-side" editMode={layoutEditMode} className="flex-shrink-0 h-auto">
                    <SectorHeavyweights stocks={currentStocksOnly} darkMode={darkMode} activePage={activePage} />
                  </ResizableBox>

                  <ResizableBox id="live-index-chart" editMode={layoutEditMode} className="flex-1 min-h-[200px]">
                    <MiniChartWidget
                      instrument={activePage}
                      livePrice={currentSpot}
                      socket={socket}
                      darkMode={darkMode}
                      heightClass="h-full"
                    />
                  </ResizableBox>
                </div>
              </div>


              {/* Option Chain Box (Full Width) */}
              <ResizableBox id="live-option-chain" editMode={layoutEditMode} className="w-full h-auto min-h-fit">
                <div className={`w-full h-auto flex flex-col gap-1.5 p-1 rounded-xl border shadow-lg ${
                  darkMode 
                    ? "bg-gradient-to-br from-[#121c33] via-[#0e1628] to-[#0b101c] border-[#1d2a45] text-slate-100" 
                    : "bg-white border-slate-200 text-slate-900"
                }`}>
                  <div className={`flex flex-wrap items-center justify-between border-b pb-1 px-2 flex-shrink-0 gap-2 ${
                    darkMode ? "border-[#1d2a45]/80" : "border-slate-200"
                  }`}>
                    <div className="flex items-center gap-2 flex-nowrap flex-shrink-0">
                      <h3 className="text-[10px] md:text-[11px] font-semibold tracking-normal text-teal-400 uppercase flex-shrink-0">
                        Real-Time {activePage} Derivative Chain Matrix (Option Chain)
                      </h3>
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-wider text-center flex-shrink-0 border ${
                        sentiment.includes("Bullish")
                          ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-250 dark:border-emerald-500/30 shadow-[0_0_8px_rgba(52,211,153,0.1)]"
                          : sentiment.includes("Bearish")
                          ? "bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-400 border-rose-250 dark:border-rose-500/30 shadow-[0_0_8px_rgba(244,63,94,0.1)]"
                          : "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-250 dark:border-amber-500/30"
                      }`}>
                        {sentiment}
                      </span>
                    </div>

                    {/* Consolidated Index Telemetry Pill */}
                    <div className={`flex items-center gap-2 px-2.5 py-0.5 rounded border text-[8.5px] font-mono select-none flex-nowrap ${
                      darkMode ? "bg-slate-900/60 border-slate-800/80" : "bg-slate-50 border-slate-200"
                    }`}>
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-slate-400">{activePage}:</span>
                        <span className={`font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                          {currentSpot > 0 ? currentSpot.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}
                        </span>
                        <span className={`inline-flex items-center font-bold px-1 rounded-sm text-[8px] ${
                          spotChange >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                        }`}>
                          {spotChange >= 0 ? "+" : ""}{spotChange.toFixed(1)} ({spotChange >= 0 ? "+" : ""}{spotChangePct.toFixed(2)}%)
                        </span>
                      </div>
                      <div className="h-2.5 w-px bg-slate-700/50"></div>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-bold">VIX:</span>
                        <span className={`font-black ${optionChain?.indiaVix && optionChain.indiaVix > 15 ? "text-orange-400" : "text-emerald-400"}`}>
                          {optionChain?.indiaVix ? `${optionChain.indiaVix.toFixed(2)}%` : "0.00%"}
                        </span>
                      </div>
                      <div className="h-2.5 w-px bg-slate-700/50"></div>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-bold">ATM:</span>
                        <span className={`font-black text-yellow-400`}>
                          {Math.round(currentSpot / strikeGap) * strikeGap}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 select-none">
                      {/* View Mode Toggles */}
                      <div className="flex gap-1 bg-slate-900/60 dark:bg-slate-900/90 border border-slate-700/50 rounded px-1 py-0.5 scale-90">
                        <button
                          type="button"
                          onClick={() => setViewMode("standard")}
                          className={`px-2 py-0.5 text-[9px] rounded font-black transition-all cursor-pointer ${
                            viewMode === "standard"
                              ? "bg-indigo-600 text-white shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          Standard
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode("detailed")}
                          className={`px-2 py-0.5 text-[9px] rounded font-black transition-all cursor-pointer ${
                            viewMode === "detailed"
                              ? "bg-indigo-600 text-white shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          Detailed
                        </button>
                      </div>
                      {/* Relocated Font Controls */}
                      <div className="flex items-center gap-1 bg-slate-900/60 dark:bg-slate-900/90 border border-slate-700/50 rounded px-1.5 py-0.5 text-white font-mono scale-90">
                        <button onClick={() => adjustFont(-1)} className="hover:text-teal-400 font-bold px-1 text-[10px] cursor-pointer">&minus;</button>
                        <span className="text-[8px] opacity-75 font-semibold">FONT</span>
                        <button onClick={() => adjustFont(1)} className="hover:text-teal-400 font-bold px-1 text-[10px] cursor-pointer">+</button>
                      </div>
                    </div>
                  </div>
                  <OptionChainGrid
                    strikes={legacyOptionChain}
                    spotPrice={currentSpot}
                    strikeGap={strikeGap}
                    darkMode={darkMode}
                    spotChange={optionChain?.spotChange || 0}
                    spotChangePct={optionChain?.spotChangePct || 0}
                    fontSize={fontSize}
                    dayHigh={dayHigh}
                    dayLow={dayLow}
                    viewMode={viewMode}
                  />
                </div>
              </ResizableBox>

              {/* ── MOMENTUM SCORE CHART (5m / 15m Candles + CE Signal) ── */}
              <ResizableBox id="live-momentum-chart" editMode={layoutEditMode} className="w-full flex-shrink-0">
                <MomentumScoreChart
                  instrument={activePage}
                  spotPrice={currentSpot}
                  aiAnalysis={aiAnalysis}
                  darkMode={darkMode}
                />
              </ResizableBox>

              <ResizableBox id="live-btst-advisor" editMode={layoutEditMode} className="w-full">
                <BTSTAdvisor
                  spotPrice={currentSpot}
                  dayHigh={dayHigh}
                  dayLow={dayLow}
                  pcr={pcr}
                  totalScore={totalScore}
                  darkMode={darkMode}
                  serverTime={serverTime}
                  activePage={activePage}
                />
              </ResizableBox>

            </div>
          </div>
        )}

        {/* STOCK TAB */}
        {activeTab === "STOCK" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-950 border-t dark:border-slate-850">
            <StockGrid
              stocks={currentStocks}
              page={activePage}
              darkMode={darkMode}
              onSelectCell={setActiveCell}
              onEditCell={handleEditCell}
              onCSVImport={handleCSVImport}
              fyersAuthorized={fyersAuthorized}
              isSimulating={isSimulating}
              countdownText={countdown5m}
              countdown15m={countdown15m}
              countdown30m={countdown30m}
              countdown1h={countdown1h}
            />
          </div>
        )}

        {/* BACKUP TAB */}
        {activeTab === "BACKUP" && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
            <div className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded border shadow-sm ${darkMode ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
              }`}>
              <div className="flex items-center gap-2">
                <Info size={16} className="text-teal-400" />
                <span className="text-xs leading-relaxed">
                  Every 5 minutes (09:00â€“16:00 IST) the server copies live scores into this backup sheet.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Search Box */}
                <div className="flex items-center gap-1.5 bg-slate-800/10 dark:bg-slate-800/30 px-2 py-0.5 rounded border border-slate-300/40 dark:border-slate-800 h-8">
                  <span className="text-[9px] uppercase tracking-wider font-black text-slate-450 dark:text-slate-400">Search:</span>
                  <input
                    type="text"
                    value={backupSearchText}
                    onChange={(e) => setBackupSearchText(e.target.value)}
                    placeholder="Search Symbol..."
                    className="bg-transparent border-0 outline-none text-xs w-28 text-slate-850 dark:text-slate-100 font-bold placeholder-slate-400"
                  />
                </div>
                <div className="h-6 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block" />

                {/* Date Picker Card */}
                <div className="flex items-center gap-1.5 bg-slate-800/10 dark:bg-slate-800/30 px-2 py-0.5 rounded border border-slate-300/40 dark:border-slate-800 h-8">
                  <span className="text-[9px] uppercase tracking-wider font-black text-slate-450 dark:text-slate-400">Date:</span>
                  <select
                    value={selectedBackupDate}
                    onChange={(e) => setSelectedBackupDate(e.target.value)}
                    className={`px-2 py-0.5 text-xs bg-transparent border-0 outline-none font-mono font-bold text-teal-600 dark:text-teal-400 cursor-pointer`}
                  >
                    {availableBackupDates.map((dStr, idx) => (
                      <option key={dStr} value={dStr} className={darkMode ? "bg-slate-950 text-slate-100" : "bg-white text-slate-800"}>
                        {dStr} {dStr === tradingDates[0] ? " (Today)" : ""}
                      </option>
                    ))}
                  </select>
                  {isLoadingHistorical && (
                    <div className="w-3.5 h-3.5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin ml-1" />
                  )}
                </div>

                <div className="h-6 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block" />

                <select
                  value={manualBackupTime}
                  onChange={(e) => setManualBackupTime(e.target.value)}
                  className={`px-3 py-1 text-xs border rounded outline-none h-8 font-mono font-bold ${darkMode ? "bg-slate-955 border-slate-800 text-teal-400" : "bg-white border-slate-300 text-slate-850"
                    }`}
                >
                  {TIME_COLUMNS.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
                <button
                  onClick={handleTriggerBackup}
                  className="px-3.5 py-1.5 text-xs text-white bg-teal-600 hover:bg-teal-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
                >
                  <RefreshCw size={12} /> Force Copy State
                </button>
                <div className="h-6 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block" />
                <button
                  onClick={handleCSVBackupExport}
                  className="px-3.5 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
                >
                  <Download size={12} /> Export CSV
                </button>
                <label
                  className="px-3.5 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
                >
                  <Upload size={12} /> Import CSV
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCSVBackupImport}
                    className="hidden"
                  />
                </label>
                <div className="h-6 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block" />
                <button
                  onClick={handleJSONBackupExport}
                  className="px-3.5 py-1.5 text-xs text-white bg-teal-650 hover:bg-teal-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
                >
                  <Download size={12} /> Export JSON (All Indices)
                </button>
                <label
                  className="px-3.5 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
                >
                  <Upload size={12} /> Import JSON (All Indices)
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleJSONBackupImport}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={handleCSVBackupClear}
                  className="px-3.5 py-1.5 text-xs text-white bg-rose-600 hover:bg-rose-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5 h-8"
                >
                  <Trash2 size={12} /> Clear Data
                </button>
              </div>
            </div>

            <div className="flex flex-row flex-1 min-h-0 gap-3">
              <ResizableBox id="backup-grid" editMode={layoutEditMode} className="flex-1 min-h-0 relative">
              <div
                ref={backupGridRef}
                tabIndex={0}
                className="w-full h-full overflow-auto border rounded bg-white dark:bg-slate-955 border-slate-350 dark:border-slate-850 shadow-md focus:outline-none focus:ring-1 focus:ring-teal-500/20 cursor-default"
              >
                {!hasAnyBackupData && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-955/85 backdrop-blur-[2px] z-50 text-center rounded">
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-full mb-3 text-amber-550 animate-pulse">
                      <Info size={28} />
                    </div>
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">No Score Backup Data Recorded</h3>
                    <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4 leading-relaxed">
                      No backups exist for <span className="text-teal-400 font-bold font-mono">{selectedBackupDate || "this date"}</span>. 
                      This happens on weekends, market holidays, or if the Fyers token was expired.
                    </p>
                    <button
                      onClick={handleTriggerBackup}
                      className="px-4 py-2 text-xs text-white bg-teal-600 hover:bg-teal-700 font-bold rounded shadow transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <RefreshCw size={12} /> Force Copy Today's State
                    </button>
                  </div>
                )}
                <table className="col-collapse border-collapse min-w-full text-left">
                  <thead>
                    <tr className={`h-8 font-bold text-[11px] uppercase ${darkMode ? "bg-slate-900 text-slate-300 border-b border-slate-850" : "bg-slate-200 text-slate-700 border-b border-slate-300"
                      }`}>
                      <th className="px-3 border text-center z-30 sticky top-0 left-0 bg-slate-200 dark:bg-slate-900 text-teal-600 dark:text-teal-400 w-12 text-[10px] font-bold border-slate-300 dark:border-slate-800">/</th>
                      <th className="px-3 border border-r-2 border-r-slate-300 dark:border-r-slate-700 font-bold z-30 sticky top-0 left-12 bg-slate-200 dark:bg-slate-900 text-teal-600 dark:text-teal-400 w-[140px] text-[10px] border-slate-300 dark:border-slate-800">SYMBOL (A)</th>
                      {TIME_COLUMNS.map(col => (
                        <th key={col} className="px-3 border font-mono text-[10px] sticky top-0 bg-slate-200 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-800">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-205 dark:divide-slate-850 text-xs font-mono">
                    {/* NET SCORE STICKY ROW */}
                    {hasAnyBackupData && (
                      <tr className={`h-7 font-semibold sticky top-[32px] z-20 ${darkMode ? "bg-slate-900 hover:bg-slate-900" : "bg-slate-100 hover:bg-slate-100"} border-b-2 border-double border-slate-305 dark:border-slate-800`}>
                        <td className="w-12 text-center text-[10px] font-bold h-7 bg-slate-200 dark:bg-slate-800 sticky left-0 z-30 border text-slate-550 dark:text-slate-400">Σ</td>
                        <td className="px-3 border border-r-2 border-r-slate-300 dark:border-r-slate-700 font-extrabold text-amber-600 dark:text-amber-400 bg-slate-150 dark:bg-slate-900 sticky left-12 z-30 uppercase">NET SCORE</td>
                        {TIME_COLUMNS.map(col => {
                          let sum = 0;
                          let colHasData = false;
                          currentStocksOnly.forEach(st => {
                            const backupRow = currentBackup[st.symbol];
                            const scoreVal = backupRow?.[col] ?? null;
                            if (scoreVal !== null) {
                              sum += scoreVal;
                              colHasData = true;
                            }
                          });
                          
                          const cellClass = colHasData ? getBackupScoreCellClass(sum, darkMode, true) : (darkMode ? "text-slate-700" : "text-slate-350");
                          return (
                            <td key={col} className={`px-3 border text-center text-[11px] ${cellClass}`}>
                              {colHasData ? (sum > 0 ? `+${sum.toFixed(2)}` : sum.toFixed(2)) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    )}

                    {filteredBackupStocks.map((st, rIdx) => (
                      <tr key={st.symbol} className={`h-7 ${darkMode ? "hover:bg-slate-900/40" : "hover:bg-slate-50"}`}>
                        <td className="w-12 text-center text-[10px] font-bold h-7 bg-slate-150 dark:bg-slate-900 sticky left-0 z-10 border text-slate-400">{rIdx + 1}</td>
                        <td className="px-3 border border-r-2 border-r-slate-300 dark:border-r-slate-700 font-bold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 sticky left-12 z-10 uppercase">{st.symbol}</td>
                        {TIME_COLUMNS.map(col => {
                          const backupRow = currentBackup[st.symbol];
                          const scoreVal = backupRow?.[col] ?? null;
                          const hasData = scoreVal !== null;
                          const cellClass = hasData ? getBackupScoreCellClass(scoreVal, darkMode, false) : (darkMode ? "text-slate-700" : "text-slate-350");
                          return (
                            <td key={col} className={`px-3 border text-center text-[11px] ${cellClass}`}>
                              {hasData ? (scoreVal > 0 ? `+${scoreVal.toFixed(2)}` : scoreVal.toFixed(2)) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </ResizableBox>

              {/* Side Box for Option Chain */}
              <ResizableBox id="backup-option-chain" editMode={layoutEditMode} className="w-[450px] xl:w-[500px] flex-shrink-0 min-h-0 flex flex-col">
                <div className="flex-1 overflow-auto bg-[#0a0e1a] rounded-xl border border-slate-800 p-2">
                  <OptionChainGrid
                    strikes={legacyOptionChain}
                    spotPrice={currentSpot}
                    strikeGap={strikeGap}
                    darkMode={darkMode}
                    spotChange={optionChain?.spotChange || 0}
                    spotChangePct={optionChain?.spotChangePct || 0}
                    fontSize={fontSize}
                    dayHigh={dayHigh}
                    dayLow={dayLow}
                    viewMode="detailed"
                  />
                </div>
              </ResizableBox>
            </div>
          </div>
        )}

        {/* FYERS TAB */}
        {activeTab === "FYERS" && (
          <ResizableBox id="fyers-integration" editMode={layoutEditMode} className="flex-1">
            <FyersIntegration
              fyersConfig={fyersConfig}
              fyersAuthorized={fyersAuthorized}
              isSimulating={isSimulating}
              lastFyersError={lastFyersError}
              onSaveConfig={handleSaveFyersConfig}
              onToggleSimulate={handleToggleSimulate}
              darkMode={darkMode}
            />
          </ResizableBox>
        )}

        {/* OPTION CHAIN TAB */}
        {activeTab === "OPTION" && (
          <div className="flex-1 flex flex-col overflow-hidden dark bg-slate-955 text-slate-100">
            <ResizableBox id="live-option-chain-tab" editMode={layoutEditMode} className="flex-1 min-h-0">
              <LiveOptionChain
                fyersAuthorized={fyersAuthorized}
                darkMode={true}
                optionChainState={optionChain}
                onSelectExpiry={selectExpiry}
              />
            </ResizableBox>
          </div>
        )}


        {/* TRADING ENGINE TAB */}
        {activeTab === "TRADING" && (() => {
          const activeIndexRow = currentStocks.find(s => s.ticker === "NSE:NIFTY50-INDEX" || s.ticker === "BSE:SENSEX-INDEX" || s.ticker === "NSE:NIFTYBANK-INDEX");
          const activeOpen = activeIndexRow?.open || (activePage === "NIFTY" ? gapAnalysisData.nifty.open : (activePage === "BANKNIFTY" ? gapAnalysisData.banknifty?.open : gapAnalysisData.sensex.open)) || 0;
          const activeHigh = activeIndexRow?.high || currentSpot || 0;
          const activeLow = activeIndexRow?.low || currentSpot || 0;
          const activePrev = activeIndexRow?.prevClose || (activePage === "NIFTY" ? gapAnalysisData.nifty.prev : (activePage === "BANKNIFTY" ? gapAnalysisData.banknifty?.prev : gapAnalysisData.sensex.prev)) || 0;

          const bnkRow = (bankniftyStocks || []).find(s => s.ticker === "NSE:NIFTYBANK-INDEX");
          const bnOpen = bnkRow?.open || gapAnalysisData.banknifty?.open || 0;
          const bnHigh = bnkRow?.high || bankniftySpot || 0;
          const bnLow = bnkRow?.low || bankniftySpot || 0;

          return (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#040811] min-h-0">
              <TradingEngine
                niftyStocks={Object.values(niftyStocksMap)}
                sensexStocks={Object.values(sensexStocksMap)}
                bankniftyStocks={Object.values(bankniftyStocksMap)}
                legacyOptionChain={legacyOptionChain}
                optionChain={optionChain}
                niftyOptionChain={niftyOptionChain}
                sensexOptionChain={sensexOptionChain}
                bankniftyOptionChain={bankniftyOptionChain}
                hdfcbankOptionChain={hdfcbankOptionChain}
                relianceOptionChain={relianceOptionChain}
                icicibankOptionChain={icicibankOptionChain}
                customStockOptionChain={customStockOptionChain}
                customStockSymbol={customStockSymbol}
                aiAnalysis={aiAnalysis}

                bullishScore={bullishScore}
                bearishScore={bearishScore}
                pcr={pcr}
                sentiment={sentiment}
                currentSpot={currentSpot}
                niftySpot={niftySpot}
                sensexSpot={sensexSpot}
                activePage={activePage}
                serverTime={serverTime}
                range15m={range15m}
                regimeResult={regimeResult}
                regimeData={regimeData}
                totalScore={totalScore}
                advances={advances}
                declines={declines}
                top10ScoresSum={top10ScoresSum}
                next15ScoresSum={next15ScoresSum}
                niftyBackup={niftyBackup}
                sensexBackup={sensexBackup}
                bankniftyBackup={bankniftyBackup}
                dayOpen={activeOpen}
                dayHigh={activeHigh}
                dayLow={activeLow}
                prevClose={activePrev}
                bankniftySpot={bankniftySpot}
                bankniftyDayOpen={bnOpen}
                bankniftyDayHigh={bnHigh}
                bankniftyDayLow={bnLow}
                darkMode={darkMode}
                alerts={alerts}
                triggeredAlerts={triggeredAlerts}
                addAlertRule={addAlertRule}
                deleteAlertRule={deleteAlertRule}
                toggleAlertRule={toggleAlertRule}
                clearAlertHistory={clearAlertHistory}
              />
            </div>
          );
        })()}

        {/* TV CHART TAB — ProLiveChart (lightweight-charts) */}
        {activeTab === "CHART" && (
          <ChartTabWrapper
            niftySpot={niftySpot}
            bankniftySpot={bankniftySpot}
            sensexSpot={sensexSpot}
            darkMode={darkMode}
          />
        )}

        {/* STOCK ANALYSIS TAB */}
        {activeTab === "STOCK_ANALYSIS" && (
          <div className="flex-1 flex flex-col overflow-auto bg-slate-950 p-5">
            <StockAnalysis />
          </div>
        )}
      </main>

      {/* Global animated fullscreen popup overlay for triggered alerts */}
      {activeTriggeredAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md select-none animate-fade-in">
          <div className={`w-full max-w-lg p-8 rounded-2xl border-2 shadow-2xl relative flex flex-col items-center text-center text-white ${activeTriggeredAlert.priority === "HIGH" || activeTriggeredAlert.priority === "CRITICAL"
              ? "bg-slate-950 border-rose-600 animate-pulse-border"
              : "bg-slate-900 border-teal-500"
            }`}>
            {/* Critical Flash Overlay */}
            {(activeTriggeredAlert.priority === "HIGH" || activeTriggeredAlert.priority === "CRITICAL") && (
              <div className="absolute inset-0 bg-rose-600/5 pointer-events-none rounded-2xl animate-flash-overlay z-0" />
            )}

            <div className="z-10 flex flex-col items-center w-full">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-4 ${activeTriggeredAlert.priority === "HIGH" || activeTriggeredAlert.priority === "CRITICAL"
                  ? "bg-rose-500/20 text-rose-500 animate-bounce"
                  : "bg-teal-500/20 text-teal-400"
                }`}>
                ðŸš¨
              </div>

              <h2 className={`text-2xl font-black uppercase tracking-wider ${activeTriggeredAlert.priority === "HIGH" || activeTriggeredAlert.priority === "CRITICAL"
                  ? "text-rose-500"
                  : "text-teal-400"
                }`}>
                {activeTriggeredAlert.priority} ALERT TRIGGERED
              </h2>

              <div className="mt-6 bg-slate-950/90 px-6 py-4 rounded-xl border border-slate-800 font-mono text-left w-full flex flex-col gap-2.5">
                <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                  <span className="text-slate-400 font-bold text-xs uppercase">Instrument:</span>
                  <span className="text-white font-extrabold text-sm">{activeTriggeredAlert.instrument}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                  <span className="text-slate-400 font-bold text-xs uppercase">Metric Trigger:</span>
                  <span className="text-amber-400 font-extrabold text-sm">{activeTriggeredAlert.title.split(":").pop()?.trim()}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                  <span className="text-slate-400 font-bold text-xs uppercase">Condition:</span>
                  <span className="text-slate-200 font-medium text-xs">{activeTriggeredAlert.message}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                  <span className="text-slate-400 font-bold text-xs uppercase">Current Value:</span>
                  <span className="text-emerald-400 font-black text-sm">{activeTriggeredAlert.value}</span>
                </div>
                {activeTriggeredAlert.note && (
                  <div className="pt-2">
                    <span className="text-slate-400 font-bold text-xs uppercase block mb-1">User Note:</span>
                    <p className="text-white font-medium text-xs italic bg-slate-900/60 p-2.5 rounded border border-slate-850">
                      "{activeTriggeredAlert.note}"
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setActiveTriggeredAlert(null)}
                className={`mt-8 w-full py-3.5 text-sm font-black uppercase tracking-wider rounded-xl shadow-lg transition-all transform active:scale-95 cursor-pointer ${activeTriggeredAlert.priority === "HIGH" || activeTriggeredAlert.priority === "CRITICAL"
                    ? "bg-rose-600 hover:bg-rose-700 text-white"
                    : "bg-teal-600 hover:bg-teal-700 text-white"
                  }`}
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Footer tab bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <footer className="flex items-center justify-between px-3 py-1 border-t border-gray-300 select-none bg-white text-black fixed bottom-0 left-0 right-0 z-[200] shadow-[0_-2px_10px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 border-r pr-2 border-slate-200">
            <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-40" disabled><ChevronRight size={14} className="rotate-180" /></button>
            <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-40" disabled><ChevronRight size={14} /></button>
          </div>
          <div className="flex items-center">
            {/* LIVE tab */}
            <button onClick={() => setActiveTab("LIVE")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "LIVE"
                  ? "bg-white text-emerald-650 font-black border-t-2 border-t-emerald-600 shadow border-r border-r-gray-300"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>{activePage === "NIFTY" ? "LIVE NIFTY" : (activePage === "BANKNIFTY" ? "LIVE BANKNIFTY" : "LIVE SENSEX")}</span>
            </button>
            {/* STOCK tab */}
            <button onClick={() => setActiveTab("STOCK")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "STOCK"
                  ? "bg-white text-emerald-650 font-black border-t-2 border-t-emerald-600 shadow border-r border-r-gray-300"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <FileText size={13} className="text-teal-500" />
              <span>{activePage === "NIFTY" ? "STOCK NIFTY" : (activePage === "BANKNIFTY" ? "STOCK BANKNIFTY" : "STOCK SENSEX")}</span>
            </button>
            {/* OPTION tab */}
            <button onClick={() => setActiveTab("OPTION")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "OPTION"
                  ? "bg-white text-emerald-650 font-black border-t-2 border-t-emerald-600 shadow border-r border-r-gray-300"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <TrendingUp size={13} className="text-emerald-500" />
              <span>LIVE OPTION CHAIN</span>
            </button>
            {/* BACKUP tab */}
            <button onClick={() => setActiveTab("BACKUP")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "BACKUP"
                  ? "bg-white text-emerald-650 font-black border-t-2 border-t-emerald-600 shadow border-r border-r-gray-300"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <BarChart2 size={13} className="text-violet-500" />
              <span>{activePage === "NIFTY" ? "NIFTY SCORE BACKUP" : (activePage === "BANKNIFTY" ? "BANKNIFTY SCORE BACKUP" : "SCORE BACKUP")}</span>
            </button>
            {/* FYERS tab */}
            <button onClick={() => setActiveTab("FYERS")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "FYERS"
                  ? "bg-white text-emerald-650 font-black border-t-2 border-t-emerald-600 shadow border-r border-r-gray-300"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <ShieldCheck size={13} className={fyersAuthorized ? "text-emerald-500 animate-pulse" : "text-amber-500"} />
              <span>FYERS CONNECT</span>
            </button>

            {/* TRADING ENGINE tab */}
            <button onClick={() => setActiveTab("TRADING")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "TRADING"
                  ? "bg-[#060d1a] text-indigo-400 font-black border-t-2 border-t-indigo-500 shadow border-r border-r-slate-800"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <Zap size={13} className="text-indigo-500" />
              <span>TRADING ENGINE</span>
            </button>
            {/* TV CHART tab */}
            <button onClick={() => setActiveTab("CHART")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "CHART"
                  ? "bg-[#0a0e1a] text-emerald-400 font-black border-t-2 border-t-emerald-500 shadow border-r border-r-slate-800"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <BarChart2 size={13} className="text-emerald-500" />
              <span>TV CHART</span>
            </button>
            {/* STOCK ANALYSIS tab */}
            <button onClick={() => setActiveTab("STOCK_ANALYSIS")}
              className={`px-4 py-1.5 text-xs font-semibold border-t flex items-center gap-1.5 cursor-pointer relative top-[-1px] ${activeTab === "STOCK_ANALYSIS"
                  ? "bg-[#0c1424] text-teal-400 font-black border-t-2 border-t-teal-500 shadow border-r border-r-slate-800"
                  : "bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}>
              <BarChart2 size={13} className="text-teal-400 animate-pulse" />
              <span>STOCK ANALYSIS (NSE)</span>
            </button>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-4 text-[11px] md:text-xs font-mono select-none opacity-80">
          <span>Active Cells: {currentStocks.length * 10}</span>
          <span>Advances: <b className="text-emerald-500 font-bold text-xs md:text-sm">{advances}</b></span>
          <span>Declines: <b className="text-rose-500 font-bold text-xs md:text-sm">{declines}</b></span>
          <span className={`text-white font-bold px-1.5 py-0.5 rounded text-[8px] tracking-wider ${connectionStatus === "LIVE" ? "bg-emerald-600 animate-pulse" : "bg-slate-600"
            }`}>{connectionStatus}</span>
        </div>
      </footer>

    </div>
  );
}

