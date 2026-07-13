/**
 * TradingEngine/index.tsx
 * Main entry point for the Trading Engine Dashboard.
 * Renders the sidebar layout + routes to the active sub-page.
 */

import React, { useState, useMemo, lazy, Suspense, useEffect, useCallback } from "react";
import TradingEngineLayout, { type TEPage } from "./TradingEngineLayout";
import type { StockData, OptionStrike, AIAnalysisPayload } from "../../types";

// ── Eager-loaded (Priority 1) ────────────────────────────────────────────────
import AmexGatingDashboard from "../AmexGatingDashboard";
import AISignals from "./pages/AISignals";
import MarketBreadth from "./pages/MarketBreadth";
import MomentumScanner from "./pages/MomentumScanner";
import OptionChainEngine from "./pages/OptionChainEngine";
import PaperTrading from "./pages/PaperTrading";
import Engines from "./pages/Engines";
import ORBAutomationTab from "./pages/ORBAutomationTab";
import AutoStrategyTab from "./pages/AutoStrategyTab";


// ── Eager-loaded Card Components ─────────────────────────────────────────────
import MarketRegimeCard from "../MarketRegimeCard";
import MarketBreadthCard from "../MarketBreadthCard";
import HeavyweightCard from "./pages/HeavyweightCard";
import Range15MCard from "./pages/Range15MCard";
import OptionChainCard from "./pages/OptionChainCard";
import MomentumCard from "./pages/MomentumCard";
import SmartMoneyCard from "./pages/SmartMoneyCard";
import ProbabilityCard from "./pages/ProbabilityCard";
import EntryZoneCard from "./pages/EntryZoneCard";
import StrategyAlignmentCard from "./pages/StrategyAlignmentCard";
import AIDecisionCard from "./pages/AIDecisionCard";
import OpportunityCard from "./pages/OpportunityCard";
import StrategiesCard from "./pages/StrategiesCard";
import PaperTradingCard from "./pages/PaperTradingCard";
import PerformanceCard from "./pages/PerformanceCard";
import RiskCard from "./pages/RiskCard";
import LiveSignalFeedCard from "./pages/LiveSignalFeedCard";
import InstitutionalMacroCard from "./pages/InstitutionalMacroCard";

// ── Layer Engines ────────────────────────────────────────────────────────────
import { computeMarketTime } from "../../engine/marketTimeEngine";
import { computeOptionFlow } from "../../engine/optionFlowEngine";
import { computeMarketBreadth } from "../../engine/marketBreadthEngine";
import { computeHeavyweight } from "../../engine/heavyweightEngine";
import { computeRange15M } from "../../engine/range15mEngine";
import { computeOptionChain } from "../../engine/optionChainEngine";
import { computeMomentum } from "../../engine/momentumEngine";
import { computeSmartMoney } from "../../engine/smartMoneyEngine";
import { computeProbability } from "../../engine/probabilityEngine";
import { computeEntryZone } from "../../engine/entryZoneEngine";
import { computeStrategyAlignment } from "../../engine/strategyAlignmentEngine";
import { computeAIDecision } from "../../engine/aiDecisionEngine";
import { computeOpportunities } from "../../engine/opportunityEngine";
import { computeStrategies } from "../../engine/strategiesEngine";
import { computePaperTrading } from "../../engine/paperTradingEngine";
import { computePerformance } from "../../engine/performanceEngine";
import { computeRisk } from "../../engine/riskEngine";
import { computeRTPODE } from "../../engine/rtpodeEngine";
import { computeOptionBuyingSetup } from "../../engine/optionBuyingSetupEngine";
import { computeMultiIndexOption, toOIStrikes } from "../../engine/multiIndexOptionEngine";
import { computeSignalMemory } from "../../engine/signalMemoryEngine";
import { computePatternRecognition } from "../../engine/patternRecognitionEngine";
import { computeAiBrain } from "../../engine/aiBrainEngine";
import { useGlobalMacroSentiment } from "../../hooks/useGlobalMacroSentiment";
import { computeInstitutionalMacro } from "../../engine/institutionalMacroEngine";
import { type TEPaperTrade } from "../../types";

// ── Lazy-loaded (Priority 2+) ────────────────────────────────────────────────
const TradeJournal      = lazy(() => import("./pages/TradeJournal"));
const RiskManager       = lazy(() => import("./pages/RiskManager"));
const PerformanceAnalytics = lazy(() => import("./pages/PerformanceAnalytics"));
const AlgoTrading       = lazy(() => import("./pages/AlgoTrading"));
const SystemHealth      = lazy(() => import("./pages/SystemHealth"));
const NewsDashboard = lazy(() => import("./pages/NewsDashboard"));
const PositionTradingDashboard = lazy(() => import("./pages/PositionTradingDashboard"));
const SmartOrderQueuePanel = lazy(() => import("./pages/SmartOrderQueuePanel"));
const StrategyLabTab    = lazy(() => import("./pages/StrategyLabTab"));
const SelfLearningDashboard = lazy(() => import("../SelfLearningDashboard"));
const AdvanceAI = lazy(() => import("../AdvanceAI"));
const ProcessorTab = lazy(() => import("./pages/ProcessorTab"));
const ContinuousScalpTab = lazy(() => import("./pages/ContinuousScalpTab"));

// ── Props ────────────────────────────────────────────────────────────────────
export interface TradingEngineProps {
  niftyStocks: StockData[];
  sensexStocks: StockData[];
  bankniftyStocks?: StockData[];
  legacyOptionChain: OptionStrike[];    // Full option chain strikes
  optionChain: any;                     // Raw option chain with additional data
  niftyOptionChain?: any;
  sensexOptionChain?: any;
  bankniftyOptionChain?: any;
  hdfcbankOptionChain?: any;
  relianceOptionChain?: any;
  icicibankOptionChain?: any;
  customStockOptionChain?: any;
  customStockSymbol?: string;

  aiAnalysis: AIAnalysisPayload;         // Full AI analysis payload (Nifty)
  aiAnalysisSensex?: AIAnalysisPayload; // Full AI analysis payload (Sensex)
  aiAnalysisBanknifty?: AIAnalysisPayload;
  bullishScore: number;
  bearishScore: number;
  pcr: number;
  sentiment: string;
  currentSpot: number;
  niftySpot: number;
  sensexSpot: number;
  activePage: string;
  serverTime?: number;
  socket?: any;
  darkMode?: boolean;



  // Props for Engines dashboard
  range15m: any;
  regimeResult: any;
  regimeData: any;
  totalScore: number;
  advances: number;
  declines: number;
  top10ScoresSum: number;
  next15ScoresSum: number;
  /** Score backup for Score Candle chart — { symbol: { time: score } } */
  niftyBackup?: Record<string, Record<string, number>>;
  sensexBackup?: Record<string, Record<string, number>>;
  bankniftyBackup?: Record<string, Record<string, number>>;
  // ── Intraday day combination data ───────────────────────────────────────
  dayOpen?:  number;
  dayHigh?:  number;
  dayLow?:   number;
  prevClose?: number;
  bankniftySpot?:     number;
  bankniftyDayOpen?:  number;
  bankniftyDayHigh?:  number;
  bankniftyDayLow?:   number;
  alerts?: any;
  triggeredAlerts?: any;
  addAlertRule?: any;
  deleteAlertRule?: any;
  toggleAlertRule?: any;
  clearAlertHistory?: any;
}

// ── Page Spinner ─────────────────────────────────────────────────────────────
const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <div className="flex items-center gap-3 text-slate-500">
      <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      <span className="text-sm font-mono">Loading...</span>
    </div>
  </div>
);

// ── Main Component ───────────────────────────────────────────────────────────
const TradingEngine: React.FC<TradingEngineProps> = (props) => {
  const [activeTEPage, setActiveTEPage] = useState<TEPage>("ENGINES");

  const {
    niftyStocks, sensexStocks, bankniftyStocks = [], legacyOptionChain, optionChain,
    niftyOptionChain, sensexOptionChain, bankniftyOptionChain,
    hdfcbankOptionChain, relianceOptionChain, icicibankOptionChain, customStockOptionChain, customStockSymbol,
    aiAnalysis, aiAnalysisSensex, aiAnalysisBanknifty,

    bullishScore, bearishScore, pcr, currentSpot, niftySpot, sensexSpot, activePage, serverTime,
    range15m, regimeResult, regimeData, totalScore, advances, declines, top10ScoresSum, next15ScoresSum,
    niftyBackup, sensexBackup, bankniftyBackup,
    dayOpen = 0, dayHigh = 0, dayLow = 0, prevClose = 0,
    bankniftySpot = 0, bankniftyDayOpen = 0, bankniftyDayHigh = 0, bankniftyDayLow = 0,
    socket, darkMode,
    alerts, triggeredAlerts, addAlertRule, deleteAlertRule, toggleAlertRule, clearAlertHistory,
  } = props;


  const scoreBackup = activePage === "NIFTY" ? (niftyBackup ?? {}) :
                      activePage === "BANKNIFTY" ? (bankniftyBackup ?? {}) :
                      activePage === "SENSEX" ? (sensexBackup ?? {}) :
                      {};

  const currentStocks = activePage === "NIFTY" ? niftyStocks :
                        activePage === "BANKNIFTY" ? bankniftyStocks :
                        activePage === "SENSEX" ? sensexStocks :
                        niftyStocks; // Fallback to Nifty for stocks
  const currentAI = activePage === "NIFTY" ? aiAnalysis :
                    activePage === "BANKNIFTY" ? (aiAnalysisBanknifty || aiAnalysis) :
                    activePage === "SENSEX" ? (aiAnalysisSensex || aiAnalysis) :
                    aiAnalysis;

  // Compute stocks filter and sorted slices for breadth/heavyweights
  const currentStocksOnly = useMemo(() =>
    currentStocks.filter(s => s.ticker !== "NSE:NIFTY50-INDEX" && s.ticker !== "BSE:SENSEX-INDEX" && s.ticker !== "NSE:NIFTYBANK-INDEX"),
    [currentStocks]
  );
  const sortedByWeightage = useMemo(() => [...currentStocksOnly].sort((a, b) => (b.weightage || 0) - (a.weightage || 0)), [currentStocksOnly]);
  const top25 = useMemo(() => sortedByWeightage.slice(0, activePage === "BANKNIFTY" ? 12 : (activePage === "SENSEX" ? 22 : 25)), [sortedByWeightage, activePage]);

  // ── AMEX Layer 19: Global Macro Sentiment ─────────────────────────
  const macroSentimentResult = useGlobalMacroSentiment();

  // ── Database Sync States ──────────────────────────────────────────────────
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
      console.error("Failed to load paper trades in main router:", e);
    }
  }, []);

  const [fiiDiiHistory, setFiiDiiHistory] = useState<any[]>([]);
  const loadFiiDii = useCallback(async () => {
    try {
      const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
      const apiUrl = `${isLocal ? "http://localhost:3000" : ""}/api/te/fii-dii?limit=30`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const d = await res.json();
        setFiiDiiHistory(d.fiiDiiHistory || []);
      }
    } catch (e) {
      console.error("Failed to load FII/DII history in main router:", e);
    }
  }, []);

  // ── 5M Candles for Reversal Indicator Calculation ────────────────────────────────
  // Used by AutoStrategyTab → computeReversalFrontend() to compute
  // RSI, MFI, LR Angle, Stochastic, Momentum, ORB High/Low, Gap% etc.
  const [candles5m, setCandles5m] = useState<Array<{
    time: number; open: number; high: number; low: number; close: number; volume: number;
  }>>([]);

  const loadCandles5m = useCallback(async () => {
    try {
      const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
      const base   = isLocal ? "http://localhost:3000" : "";
      // Map activePage → instrument name expected by the API
      const instrument = activePage === "SENSEX" ? "SENSEX" : activePage === "BANKNIFTY" ? "BANKNIFTY" : "NIFTY";

      // Try enriched endpoint first (returns objects with all indicators)
      try {
        const enrichedUrl = `${base}/api/indicators/enriched?instrument=${instrument}&tf=5m`;
        const eRes = await fetch(enrichedUrl);
        if (eRes.ok) {
          const eData = await eRes.json();
          if (Array.isArray(eData.candles) && eData.candles.length > 0) {
            // Enriched candles are already objects {time, open, high, low, close, volume, ...}
            setCandles5m(eData.candles.map((c: any) => ({
              time: c.time, open: c.open, high: c.high,
              low: c.low, close: c.close, volume: c.volume ?? 0,
            })));
            return;
          }
        }
      } catch (_) {}

      // Fallback: raw history endpoint (returns arrays [t, o, h, l, c, v, oi, vwap])
      const histUrl = `${base}/api/index-chart/history?instrument=${instrument}&tf=5m`;
      const res = await fetch(histUrl);
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.candles) && d.candles.length > 0) {
          // Each element may be an array [time, open, high, low, close, volume] or object
          const mapped = d.candles.map((c: any) =>
            Array.isArray(c)
              ? { time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] ?? 0 }
              : { time: c.time ?? c.t, open: c.open ?? c.o, high: c.high ?? c.h,
                  low: c.low ?? c.l, close: c.close ?? c.c, volume: c.volume ?? c.v ?? 0 }
          );
          setCandles5m(mapped);
        }
      }
    } catch (e) {
      // Silently ignore — indicator engine handles missing data gracefully
    }
  }, [activePage]);


  // Load on mount, on index switch, and refresh every 5 minutes
  useEffect(() => {
    loadCandles5m();
    const id = setInterval(loadCandles5m, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadCandles5m]);

  // Real-time candle update via socket — fires on every 5M bar close
  // Server emits 'index-candles-update' from onCandleBroadcast when a new candle closes
  useEffect(() => {
    if (!socket) return;
    const instrument = activePage === "SENSEX" ? "SENSEX" : activePage === "BANKNIFTY" ? "BANKNIFTY" : "NIFTY";

    const handleCandleUpdate = (data: { instrument: string; tf: string; candles: any[] }) => {
      // Only update if it's the right instrument and 5m timeframe
      if (data.instrument !== instrument || data.tf !== "5m") return;
      if (!Array.isArray(data.candles) || data.candles.length === 0) return;

      const mapped = data.candles.map((c: any) =>
        Array.isArray(c)
          ? { time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] ?? 0 }
          : { time: c.time ?? c.t, open: c.open ?? c.o, high: c.high ?? c.h,
              low: c.low ?? c.l, close: c.close ?? c.c, volume: c.volume ?? c.v ?? 0 }
      );
      setCandles5m(mapped);
    };

    socket.on("index-candles-update", handleCandleUpdate);
    return () => socket.off("index-candles-update", handleCandleUpdate);
  }, [socket, activePage]);


  const [brainLocked, setBrainLocked] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("te_brain_locked") === "true";
    }
    return false;
  });

  const handleToggleBrainLock = useCallback(() => {
    setBrainLocked(prev => {
      const next = !prev;
      localStorage.setItem("te_brain_locked", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    loadTrades();
    loadFiiDii();
    const interval = setInterval(() => {
      loadTrades();
      loadFiiDii();
    }, 4000);
    return () => clearInterval(interval);
  }, [loadTrades, loadFiiDii]);

  const macroResult = useMemo(() => {
    return computeInstitutionalMacro(fiiDiiHistory);
  }, [fiiDiiHistory]);

  // ── Core Engine Live Computations (L1 - L16) ──────────────────────────────
  const [lastActiveStrategy, setLastActiveStrategy] = useState<string>("NO_STRATEGY");
  const [previousStrategyScore, setPreviousStrategyScore] = useState<number>(0);
  const [switchHistory, setSwitchHistory] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // ── Sync dayHighScore & dayLowScore in date-keyed localStorage ──
  const [dayHighScore, setDayHighScore] = useState<number>(() => {
    const dateKey = new Date().toDateString();
    const saved = localStorage.getItem(`codetrade-day-high-score-${activePage}-${dateKey}`);
    return saved ? Number(saved) : -Infinity;
  });

  const [dayLowScore, setDayLowScore] = useState<number>(() => {
    const dateKey = new Date().toDateString();
    const saved = localStorage.getItem(`codetrade-day-low-score-${activePage}-${dateKey}`);
    return saved ? Number(saved) : Infinity;
  });

  useEffect(() => {
    const dateKey = new Date().toDateString();
    const highKey = `codetrade-day-high-score-${activePage}-${dateKey}`;
    const lowKey = `codetrade-day-low-score-${activePage}-${dateKey}`;

    // Calculate currentStocksOnly score sum:
    const currentScoreSum = currentStocksOnly.reduce((acc, s) => acc + (s.score || 0), 0);

    const savedHigh = localStorage.getItem(highKey);
    const savedLow = localStorage.getItem(lowKey);

    let currentHigh = savedHigh ? Number(savedHigh) : -Infinity;
    let currentLow = savedLow ? Number(savedLow) : Infinity;

    if (currentScoreSum > currentHigh || savedHigh === null) {
      currentHigh = currentScoreSum;
      localStorage.setItem(highKey, String(currentHigh));
    }
    if (currentScoreSum < currentLow || savedLow === null) {
      currentLow = currentScoreSum;
      localStorage.setItem(lowKey, String(currentLow));
    }

    setDayHighScore(currentHigh);
    setDayLowScore(currentLow);
  }, [activePage, currentStocksOnly]);

  const marketTimeResult = useMemo(() => {
    return computeMarketTime(currentTime);
  }, [currentTime]);

  const agg30mNetCalculated = useMemo(() => currentStocksOnly.reduce((a, s) => a + (s.score30mDiff || 0), 0), [currentStocksOnly]);
  const agg1hNetCalculated = useMemo(() => currentStocksOnly.reduce((a, s) => a + (s.score1hDiff || 0), 0), [currentStocksOnly]);
  const aggVolumeCalculated = useMemo(() => currentStocksOnly.reduce((a, s) => a + (s.volume || 0), 0), [currentStocksOnly]);
  const changePercentCalculated = useMemo(() => currentStocksOnly.length > 0
    ? currentStocksOnly.reduce((a, s) => a + (s.changePercent || 0), 0) / currentStocksOnly.length
    : 0, [currentStocksOnly]);

  const breadthResult = useMemo(() =>
    computeMarketBreadth({
      advances,
      declines,
      totalStocks: currentStocksOnly.length,
      stocks: currentStocksOnly.map((s: any) => ({
        symbol: s.symbol,
        score: s.score,
        weightage: s.weightage,
        changePercent: s.changePercent,
        scoreDifference: s.scoreDifference,
      })),
      top25Stocks: top25.map((s: any) => ({
        symbol: s.symbol,
        score: s.score,
        weightage: s.weightage,
        changePercent: s.changePercent,
        scoreDifference: s.scoreDifference,
      })),
      overallScore: totalScore,
      t10: top10ScoresSum,
      t15: next15ScoresSum,
      top25ScoreDiff: regimeData.top25ScoreDiff,
      spotPrice: currentSpot,
      regimeResult,
    }),
    [advances, declines, currentStocksOnly, top25, totalScore, top10ScoresSum, next15ScoresSum, regimeData.top25ScoreDiff, currentSpot, regimeResult]
  );

  const heavyweightResult = useMemo(() =>
    computeHeavyweight({
      stocks: currentStocksOnly.map((s: any) => ({
        symbol: s.symbol,
        weightage: s.weightage,
        score: s.score,
        scoreDifference: s.scoreDifference,
        score15mDiff: s.score15mDiff || 0,
        score30mDiff: s.score30mDiff || 0,
        score1hDiff: s.score1hDiff || 0,
        changePercent: s.changePercent,
        ltp: s.ltp,
        volume: s.volume,
      })),
      regimeResult,
      breadthResult,
    }),
    [currentStocksOnly, regimeResult, breadthResult]
  );

  const range15mResult = useMemo(() =>
    computeRange15M({
      spotPrice: currentSpot,
      rangeHigh: range15m.high,
      rangeLow: range15m.low,
      isFallback: range15m.isFallback ?? true,
      regimeResult,
      breadthResult,
      heavyweightResult,
    }),
    [currentSpot, range15m, regimeResult, breadthResult, heavyweightResult]
  );

  const optionChainResult = useMemo(() =>
    computeOptionChain({
      strikes: (legacyOptionChain ?? []) as any,
      spotPrice: currentSpot,
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
    }),
    [legacyOptionChain, currentSpot, regimeResult, breadthResult, heavyweightResult, range15mResult]
  );

  const momentumResult = useMemo(() =>
    computeMomentum({
      overallScore: totalScore,
      scoreDifference: regimeData.score5mNet,
      score15mDiff: regimeData.score15mNet,
      score30mDiff: agg30mNetCalculated,
      score1hDiff: agg1hNetCalculated,
      changePercent: changePercentCalculated,
      volume: aggVolumeCalculated,
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      spotPrice: currentSpot,
      dayOpen: activePage === "BANKNIFTY" ? bankniftyDayOpen : dayOpen,
      dayHigh: activePage === "BANKNIFTY" ? bankniftyDayHigh : dayHigh,
      dayLow: activePage === "BANKNIFTY" ? bankniftyDayLow : dayLow,
      prevClose,
      activePage,
      bankniftySpot,
      bankniftyDayOpen,
      bankniftyDayHigh,
      bankniftyDayLow,
    }),
    [totalScore, regimeData.score5mNet, regimeData.score15mNet, agg30mNetCalculated, agg1hNetCalculated, changePercentCalculated, aggVolumeCalculated,
     regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult,
     currentSpot, dayOpen, dayHigh, dayLow, prevClose, activePage,
     bankniftySpot, bankniftyDayOpen, bankniftyDayHigh, bankniftyDayLow]
  );

  const activeOptionChain = useMemo(() => {
    if (activePage === "NIFTY") return niftyOptionChain;
    if (activePage === "BANKNIFTY") return bankniftyOptionChain;
    if (activePage === "SENSEX") return sensexOptionChain;
    if (activePage === "HDFCBANK") return hdfcbankOptionChain;
    if (activePage === "RELIANCE") return relianceOptionChain;
    if (activePage === "ICICIBANK") return icicibankOptionChain;
    return customStockOptionChain;
  }, [activePage, niftyOptionChain, bankniftyOptionChain, sensexOptionChain, hdfcbankOptionChain, relianceOptionChain, icicibankOptionChain, customStockOptionChain]);

  const oiTotals = useMemo(() => {
    const chain = legacyOptionChain ?? [];
    return {
      totalCallOI:       chain.reduce((a: number, s: any) => a + (s.ceOI       || 0), 0),
      totalPutOI:        chain.reduce((a: number, s: any) => a + (s.peOI       || 0), 0),
      totalCallOIChange: chain.reduce((a: number, s: any) => a + (s.ceOIChange || 0), 0),
      totalPutOIChange:  chain.reduce((a: number, s: any) => a + (s.peOIChange || 0), 0),
      totalCallVolume:   chain.reduce((a: number, s: any) => a + (s.ceVolume   || 0), 0),
      totalPutVolume:    chain.reduce((a: number, s: any) => a + (s.peVolume   || 0), 0),
    };
  }, [legacyOptionChain]);

  const smartMoneyResult = useMemo(() =>
    computeSmartMoney({
      regimeResult, breadthResult, heavyweightResult, range15mResult,
      optionChainResult, momentumResult,
      pcr,
      totalCallOI:       oiTotals.totalCallOI,
      totalPutOI:        oiTotals.totalPutOI,
      totalCallOIChange: oiTotals.totalCallOIChange,
      totalPutOIChange:  oiTotals.totalPutOIChange,
      totalCallVolume:   oiTotals.totalCallVolume,
      totalPutVolume:    oiTotals.totalPutVolume,
      overallScore: totalScore,
      scoreDifference: regimeData.score5mNet,
      score15mDiff: regimeData.score15mNet,
      volume: aggVolumeCalculated,
      changePercent: changePercentCalculated,
      monthlyMetrics: activeOptionChain?.monthlyMetrics,
      nextWeeklyMetrics: activeOptionChain?.nextWeeklyMetrics,
      spotPrice: currentSpot,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, pcr, oiTotals,
     totalScore, regimeData.score5mNet, regimeData.score15mNet, aggVolumeCalculated, changePercentCalculated, activeOptionChain, currentSpot]
  );

  const probabilityResult = useMemo(() =>
    computeProbability({
      regimeResult, breadthResult, heavyweightResult, range15mResult,
      optionChainResult, momentumResult,
      smartMoneyResult,
      pcr,
      optionChain: legacyOptionChain,
      spotPrice: currentSpot,
      score15mDiff: regimeData.score5mNet,
      isMacroCrash: currentAI?.crashState?.isMacroCrash ?? false,
      intradayExhaustionSide: momentumResult.intradayExhaustionSide,
      monthlyMetrics: activeOptionChain?.monthlyMetrics,
      nextWeeklyMetrics: activeOptionChain?.nextWeeklyMetrics,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, pcr, legacyOptionChain, currentSpot, regimeData.score15mNet, activeOptionChain, currentAI]
  );

  const entryZoneResult = useMemo(() =>
    computeEntryZone({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      spotPrice: currentSpot,
      rangeHigh: range15m.high,
      rangeLow: range15m.low,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     currentSpot, range15m]
  );

  const strategyAlignmentResult = useMemo(() =>
    computeStrategyAlignment({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      entryZoneResult,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult]
  );

  const aiDecisionResult = useMemo(() =>
    computeAIDecision({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      entryZoneResult,
      strategyAlignmentResult,
      indiaVix: optionChain?.indiaVix,
      spotChangePct: optionChain?.spotChangePct,
      marketTimeResult, // ── AMEX: market-hours hard gate
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult, strategyAlignmentResult, optionChain, marketTimeResult]
  );

  const opportunityResult = useMemo(() =>
    computeOpportunities({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      entryZoneResult,
      strategyAlignmentResult,
      aiDecisionResult,
      spotPrice: currentSpot,
      activePage,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult, strategyAlignmentResult, aiDecisionResult, currentSpot, activePage]
  );

  const strategiesResult = useMemo(() =>
    computeStrategies({
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      entryZoneResult,
      strategyAlignmentResult,
      aiDecisionResult,
      opportunityResult,
      spotPrice: currentSpot,
      activePage,
      previousActiveStrategy: lastActiveStrategy,
      previousStrategyScore,
      marketTimeResult,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult, momentumResult, smartMoneyResult, probabilityResult, entryZoneResult, strategyAlignmentResult, aiDecisionResult, opportunityResult, currentSpot, activePage, lastActiveStrategy, previousStrategyScore, marketTimeResult]
  );

  useEffect(() => {
    const active = strategiesResult.activeStrategy;
    const score = strategiesResult.strategyScore;
    if (active && active !== "NO_STRATEGY" && active !== lastActiveStrategy) {
      setLastActiveStrategy(active);
      setPreviousStrategyScore(score);
      setSwitchHistory(prev => {
        const next = [active, ...prev.filter(x => x !== active)];
        return next.slice(0, 3);
      });
    }
  }, [strategiesResult.activeStrategy, strategiesResult.strategyScore, lastActiveStrategy]);

  const optionFlowResult = useMemo(() =>
    computeOptionFlow({
      optionChain: legacyOptionChain ?? [],
      spotPrice: currentSpot,
      activePage,
      strategiesResult,
      aiDecisionResult,
      currentTimeMs: currentTime,
    }),
    [legacyOptionChain, currentSpot, activePage, strategiesResult, aiDecisionResult, currentTime]
  );

  const paperTradingResult = useMemo(() =>
    computePaperTrading({
      entryZoneResult,
      strategyAlignmentResult,
      aiDecisionResult,
      opportunityResult,
      strategiesResult,
      spotPrice: currentSpot,
      activePage,
      dbTrades,
      marketTimeResult,
      optionFlowResult,
      volatilityScore: probabilityResult.volatilityScore,
      optionChain: legacyOptionChain,
      range15mResult,
      dayHigh: activePage === "BANKNIFTY" ? bankniftyDayHigh : dayHigh,
      dayLow: activePage === "BANKNIFTY" ? bankniftyDayLow : dayLow,
    }),
    [entryZoneResult, strategyAlignmentResult, aiDecisionResult, opportunityResult, strategiesResult, currentSpot, activePage, dbTrades, marketTimeResult, optionFlowResult, probabilityResult.volatilityScore, legacyOptionChain, range15mResult, dayHigh, dayLow, bankniftyDayHigh, bankniftyDayLow]
  );

  const performanceResult = useMemo(() =>
    computePerformance({
      paperTradingOutput: paperTradingResult,
      dbTrades,
    }),
    [paperTradingResult, dbTrades]
  );

  const riskResult = useMemo(() =>
    computeRisk({
      paperTradingOutput: paperTradingResult,
      performanceResult,
      spotPrice: currentSpot,
      activePage,
      indiaVix: optionChain?.indiaVix,
      regimeType: regimeResult.regime,
      aiConfidence: aiDecisionResult.decisionConfidence,
      optionChain: legacyOptionChain,
    }),
    [paperTradingResult, performanceResult, currentSpot, activePage, optionChain, regimeResult.regime, aiDecisionResult.decisionConfidence, legacyOptionChain]
  );

  // ── RTPODE: Real-Time Profit Opportunity Detection Engine ──
  const rtpodeResult = useMemo(() =>
    computeRTPODE({
      spotPrice: currentSpot,
      activePage,
      marketTimeResult,
      optionChain: legacyOptionChain ?? [],
      pcr,
      momentumResult,
      smartMoneyResult,
      breadthResult,
      probabilityResult,
      optionChainResult,
      totalCallOI:       oiTotals.totalCallOI,
      totalPutOI:        oiTotals.totalPutOI,
      totalCallOIChange: oiTotals.totalCallOIChange,
      totalPutOIChange:  oiTotals.totalPutOIChange,
      totalCallVolume:   oiTotals.totalCallVolume,
      totalPutVolume:    oiTotals.totalPutVolume,
      scoreDifference:   regimeData.score5mNet,
      score15mDiff:      regimeData.score15mNet,
      rangeHigh:         range15m.high,
      rangeLow:          range15m.low,
    }),
    [currentSpot, activePage, marketTimeResult, legacyOptionChain, pcr,
     momentumResult, smartMoneyResult, breadthResult, probabilityResult, optionChainResult,
     oiTotals, regimeData, range15m]
  );

  // ── Multi-Index Option Intelligence Engine ───────────────────────────────
  const multiIndexResult = useMemo(() =>
    computeMultiIndexOption({
      activePage,
      niftyChain:     toOIStrikes(niftyOptionChain),
      niftySpot:      niftySpot,
      bankniftyChain: toOIStrikes(bankniftyOptionChain),
      bankniftySpot:  bankniftySpot,
      sensexChain:    toOIStrikes(sensexOptionChain),
      sensexSpot:     sensexSpot,
      stockChains: [
        { symbol: "HDFCBANK",  strikes: toOIStrikes(hdfcbankOptionChain),  spotPrice: 0 },
        { symbol: "RELIANCE",  strikes: toOIStrikes(relianceOptionChain),  spotPrice: 0 },
        { symbol: "ICICIBANK", strikes: toOIStrikes(icicibankOptionChain), spotPrice: 0 },
      ],
      indiaVix: optionChain?.indiaVix,
    }),
    [activePage, niftyOptionChain, bankniftyOptionChain, sensexOptionChain,
     hdfcbankOptionChain, relianceOptionChain, icicibankOptionChain,
     niftySpot, bankniftySpot, sensexSpot, optionChain?.indiaVix]
  );

  // ── AMEX Option Buying Setup Engine (L15) ────────────────────────────────
  const optionBuyingSetup = useMemo(() =>
    computeOptionBuyingSetup({
      aiDecisionResult,
      entryZoneResult,
      probabilityResult,
      optionChainResult,
      momentumResult,
      rawStrikes: (legacyOptionChain ?? []) as any,
      spotPrice: currentSpot,
      instrument: activePage,
      lotSize: (activePage === "NIFTY" ? 75 : activePage === "BANKNIFTY" ? 35 : activePage === "SENSEX" ? 20 :
                activePage === "HDFCBANK" ? 550 : activePage === "RELIANCE" ? 250 : activePage === "ICICIBANK" ? 700 : 75),
      maxRiskPerTrade: 5000,
      indiaVix: optionChain?.indiaVix,
    }),
    [aiDecisionResult, entryZoneResult, probabilityResult, optionChainResult,
     momentumResult, legacyOptionChain, currentSpot, activePage, optionChain?.indiaVix]
  );

  // ── AMEX L17: Signal Memory Engine ──────────────────────────────────
  const signalMemoryResult = useMemo(() =>
    computeSignalMemory({
      currentDirection:  aiDecisionResult.finalDecision as any,
      currentConfidence: aiDecisionResult.confidence,
      currentGrade:      aiDecisionResult.grade,
      pcr,
      indiaVix:          optionChain?.indiaVix ?? 15,
      regime:            regimeResult.regime,
      momentumScore:     momentumResult?.momentumScore ?? 50,
      storageKey:        `amex_signal_memory_${activePage}`,
      closedTrades:      paperTradingResult.closedPositions?.map(t => ({
        direction:   t.direction,
        entry_price: t.entry_price,
        exit_price:  t.exit_price ?? t.entry_price,
        timestamp:   t.created_at ?? Date.now(),
        closed_at:   t.closed_at ?? undefined,
      })) ?? [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiDecisionResult.finalDecision, aiDecisionResult.confidence, pcr,
     optionChain?.indiaVix, regimeResult.regime, momentumResult?.momentumScore,
     activePage, paperTradingResult.closedPositions]
  );

  // ── AMEX L18: Pattern Recognition Engine ───────────────────────────
  const patternResult = useMemo(() =>
    computePatternRecognition({
      candles:          [],   // ProLiveChart feeds candles separately — pass empty for now
      spotPrice:        currentSpot,
      prevClose:        prevClose ?? 0,
      maxPain:          optionChainResult?.maxPainStrike ?? 0,
      totalCeOIChange:  oiTotals.totalCallOIChange,
      totalPeOIChange:  oiTotals.totalPutOIChange,
      avgOIChange:      (Math.abs(oiTotals.totalCallOIChange) + Math.abs(oiTotals.totalPutOIChange)) / 2,
      indiaVix:         optionChain?.indiaVix,
    }),
    [currentSpot, prevClose, optionChainResult?.maxPainStrike,
     oiTotals.totalCallOIChange, oiTotals.totalPutOIChange, optionChain?.indiaVix]
  );

  // ── AMEX L16: AI Brain Master Synthesizer ─────────────────────────
  const aiBrainResult = useMemo(() =>
    computeAiBrain({
      aiDecisionResult,
      momentumResult,
      smartMoneyResult,
      probabilityResult,
      strategyAlignmentResult,
      entryZoneResult,
      regimeResult,
      optionChainResult,
      multiIndexResult,
      indiaVix:             optionChain?.indiaVix,
      marketTimeResult,
      signalMemoryResult,
      patternResult,
      macroSentimentResult,
      forceLocked:          brainLocked,
    }),
    [aiDecisionResult, momentumResult, smartMoneyResult, probabilityResult,
     strategyAlignmentResult, entryZoneResult, regimeResult, optionChainResult,
     multiIndexResult, optionChain?.indiaVix, marketTimeResult,
     signalMemoryResult, patternResult, macroSentimentResult, brainLocked]
  );

  const openPositionsWithLtp = useMemo(() => {
    return paperTradingResult.openPositions.map(pos => {
      const strikeData = (legacyOptionChain ?? []).find((s: any) => s.strikePrice === pos.strike);
      let currentPremium = pos.entry_price;

      if (strikeData) {
        currentPremium = pos.direction === "BUY_CE" 
          ? (strikeData.ceLtp ?? strikeData.ceBid ?? pos.entry_price)
          : (strikeData.peLtp ?? strikeData.peBid ?? pos.entry_price);
      }
      
      const livePnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;

      return {
        ...pos,
        currentPremium,
        livePnl: parseFloat(livePnl.toFixed(1)),
      };
    });
  }, [paperTradingResult.openPositions, legacyOptionChain]);

  const renderPage = () => {
    switch (activeTEPage) {
      case "ENGINES":
        return (
          <Engines
            activePage={activePage}
            currentSpot={currentSpot}
            range15m={range15m}
            overallScore={totalScore}
            score5mNet={regimeData.score5mNet}
            score15mNet={regimeData.score15mNet}
            t10={top10ScoresSum}
            t15={next15ScoresSum}
            top25Score={top10ScoresSum + next15ScoresSum}
            top25ScoreDiff={regimeData.top25ScoreDiff}
            pcr={pcr}
            advances={advances}
            declines={declines}
            support={regimeData.supportWall}
            resistance={regimeData.resistanceWall}
            stocks={currentStocksOnly}
            top25Stocks={top25}
            regimeResult={regimeResult}
            optionChain={legacyOptionChain}
            scoreBackup={scoreBackup}
            indiaVix={optionChain?.indiaVix}
            spotChangePct={optionChain?.spotChangePct}
            rtpodeResult={rtpodeResult}
            monthlyMetrics={activeOptionChain?.monthlyMetrics}
            nextWeeklyMetrics={activeOptionChain?.nextWeeklyMetrics}
            monthlyExpiry={activeOptionChain?.monthlyExpiry}
            nextWeeklyExpiry={activeOptionChain?.nextWeeklyExpiry}
          />
        );

      case "L1_REGIME":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded uppercase tracking-wider">Layer 1</span>
                <span className="text-xs text-slate-500 font-mono">REGIME ENGINE</span>
              </div>
              <h1 className="text-xl font-black text-white tracking-tight">Market Regime Classifier</h1>
              <p className="text-sm text-slate-400 mt-0.5">Real-time market regime classification engine — {activePage}</p>
            </div>
            <MarketRegimeCard
              activePage={activePage}
              currentSpot={currentSpot}
              range15m={range15m}
              overallScore={totalScore}
              score5mNet={regimeData.score5mNet}
              score15mNet={regimeData.score15mNet}
              t10={top10ScoresSum}
              t15={next15ScoresSum}
              top25Score={top10ScoresSum + next15ScoresSum}
              top25ScoreDiff={regimeData.top25ScoreDiff}
              pcr={pcr}
              advances={advances}
              declines={declines}
              support={regimeData.supportWall}
              resistance={regimeData.resistanceWall}
              darkMode={true}
            />
          </div>
        );

      case "L2_BREADTH":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded uppercase tracking-wider">Layer 2</span>
                <span className="text-xs text-slate-500 font-mono">BREADTH ENGINE</span>
              </div>
              <h1 className="text-xl font-black text-white tracking-tight">Market Breadth Analysis</h1>
              <p className="text-sm text-slate-400 mt-0.5">Constituent stock participation &amp; advances/declines — {activePage}</p>
            </div>
            <MarketBreadthCard
              activePage={activePage}
              advances={advances}
              declines={declines}
              overallScore={totalScore}
              t10={top10ScoresSum}
              t15={next15ScoresSum}
              top25ScoreDiff={regimeData.top25ScoreDiff}
              currentSpot={currentSpot}
              stocks={currentStocksOnly}
              top25Stocks={top25}
              regimeResult={regimeResult}
              darkMode={true}
            />
          </div>
        );

      case "L3_HEAVYWEIGHTS":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 3: Heavyweight Impact Tracker</h1>
              <p className="text-sm text-slate-500">Analysis of high-weightage index movers ({activePage === "BANKNIFTY" ? "BANKNIFTY" : activePage === "SENSEX" ? "SENSEX" : "NIFTY"})</p>
            </div>
            <HeavyweightCard
              activePage={activePage}
              stocks={currentStocksOnly}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
            />
          </div>
        );

      case "L4_RANGES":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 4: 15M Range Regulator</h1>
              <p className="text-sm text-slate-500">Intraday dynamic range, support, & resistance boundaries ({activePage})</p>
            </div>
            <Range15MCard
              activePage={activePage}
              spotPrice={currentSpot}
              rangeHigh={range15m.high}
              rangeLow={range15m.low}
              isFallback={range15m.isFallback || false}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
            />
          </div>
        );

      case "L5_OPTION_CHAIN":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 5: Option Chain Analysis</h1>
              <p className="text-sm text-slate-500">Option chain open interest & strike level pressure ({activePage})</p>
            </div>
            <OptionChainCard
              activePage={activePage}
              spotPrice={currentSpot}
              optionChain={legacyOptionChain ?? []}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
            />
          </div>
        );

      case "L6_MOMENTUM":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 6: Momentum Scanner</h1>
              <p className="text-sm text-slate-500">Real-time price & volume momentum speeds ({activePage})</p>
            </div>
            <MomentumCard
              activePage={activePage}
              overallScore={totalScore}
              scoreDifference={regimeData.score5mNet}
              score15mDiff={regimeData.score15mNet}
              score30mDiff={agg30mNetCalculated}
              score1hDiff={agg1hNetCalculated}
              changePercent={changePercentCalculated}
              volume={aggVolumeCalculated}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
              optionChainResult={optionChainResult}
            />
          </div>
        );

      case "L7_SMART_MONEY":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 7: Smart Money Flow</h1>
              <p className="text-sm text-slate-500">Institutional block orders & dynamic PCR scanning ({activePage})</p>
            </div>
            <SmartMoneyCard
              activePage={activePage}
              pcr={pcr}
              totalCallOI={oiTotals.totalCallOI}
              totalPutOI={oiTotals.totalPutOI}
              totalCallOIChange={oiTotals.totalCallOIChange}
              totalPutOIChange={oiTotals.totalPutOIChange}
              totalCallVolume={oiTotals.totalCallVolume}
              totalPutVolume={oiTotals.totalPutVolume}
              overallScore={totalScore}
              scoreDifference={regimeData.score5mNet}
              score15mDiff={regimeData.score15mNet}
              volume={aggVolumeCalculated}
              changePercent={changePercentCalculated}
              scoreBackup={scoreBackup}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
              optionChainResult={optionChainResult}
              momentumResult={momentumResult}
            />
          </div>
        );

      case "L8_PROBABILITY":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 8: Probability Movement Alert Engine</h1>
              <p className="text-sm text-slate-500">PMAE move alert calculations & breakout probabilities ({activePage})</p>
            </div>
            <ProbabilityCard
              activePage={activePage}
              pcr={pcr}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
              optionChainResult={optionChainResult}
              momentumResult={momentumResult}
              smartMoneyResult={smartMoneyResult}
            />
          </div>
        );

      case "L9_ENTRY_ZONE":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 9: Entry Zone Regulator</h1>
              <p className="text-sm text-slate-500">Dynamic execution levels & risk-to-reward optimal pricing ({activePage})</p>
            </div>
            <EntryZoneCard
              activePage={activePage}
              spotPrice={currentSpot}
              rangeHigh={range15m.high}
              rangeLow={range15m.low}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
              optionChainResult={optionChainResult}
              momentumResult={momentumResult}
              smartMoneyResult={smartMoneyResult}
              probabilityResult={probabilityResult}
            />
          </div>
        );

      case "L10_ALIGNMENT":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 10: Strategy Alignment Matrix</h1>
              <p className="text-sm text-slate-500">Cross-layer correlation & confluence scores ({activePage})</p>
            </div>
            <StrategyAlignmentCard
              activePage={activePage}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
              optionChainResult={optionChainResult}
              momentumResult={momentumResult}
              smartMoneyResult={smartMoneyResult}
              probabilityResult={probabilityResult}
              entryZoneResult={entryZoneResult}
            />
          </div>
        );

      case "L11_AI_DECISION":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 11: AI Decision Module</h1>
              <p className="text-sm text-slate-500">Global decision consensus & directional execution confidence ({activePage})</p>
            </div>
            <AIDecisionCard
              activePage={activePage}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
              optionChainResult={optionChainResult}
              momentumResult={momentumResult}
              smartMoneyResult={smartMoneyResult}
              probabilityResult={probabilityResult}
              entryZoneResult={entryZoneResult}
              strategyAlignmentResult={strategyAlignmentResult}
              indiaVix={optionChain?.indiaVix}
              spotChangePct={optionChain?.spotChangePct}
            />
          </div>
        );

      case "L12_OPPORTUNITIES":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 12: Opportunity Scanner</h1>
              <p className="text-sm text-slate-500">Trade opportunity candidates & relative signal strength ranking ({activePage})</p>
            </div>
            <OpportunityCard
              activePage={activePage}
              spotPrice={currentSpot}
              regimeResult={regimeResult}
              breadthResult={breadthResult}
              heavyweightResult={heavyweightResult}
              range15mResult={range15mResult}
              optionChainResult={optionChainResult}
              momentumResult={momentumResult}
              smartMoneyResult={smartMoneyResult}
              probabilityResult={probabilityResult}
              entryZoneResult={entryZoneResult}
              strategyAlignmentResult={strategyAlignmentResult}
              aiDecisionResult={aiDecisionResult}
            />
          </div>
        );

      case "L13_STRATEGIES":
        return (
          <AutoStrategyTab
            socket={socket}
            spotPrice={currentSpot}
            indexSymbol={activePage}
            indiaVix={optionChain?.indiaVix ?? 0}
            pcr={pcr}
            optionChain={(legacyOptionChain ?? []).map(s => ({
              strikePrice: s.strikePrice,
              ceLtp: s.ceLtp ?? 0,
              peLtp: s.peLtp ?? 0,
              ceOI: s.ceOI ?? 0,
              peOI: s.peOI ?? 0,
            }))}
            isMarketOpen={marketTimeResult?.isMarketOpen ?? false}
            aiConfidence={aiBrainResult?.convictionScore ?? aiDecisionResult?.decisionConfidence ?? 0}
            aiDirection={(aiBrainResult?.finalDecision ?? aiDecisionResult?.finalDecision ?? "WAIT") as any}
            regime={regimeResult?.regime ?? "RANGE"}
            sessionType={marketTimeResult?.sessionType ?? "MID"}
            smartMoneyScore={smartMoneyResult?.smartMoneyScore ?? 0}
            alignmentScore={strategyAlignmentResult?.alignmentScore ?? 0}
            breadthScore={breadthResult?.breadthScore ?? 0}
            rangeBreakout={range15mResult?.rangeBreakout ?? false}
            rangeBreakdown={range15mResult?.rangeBreakdown ?? false}
            momentumExhaustion={momentumResult?.exhaustion?.bullish || momentumResult?.exhaustion?.bearish || false}
            isExpiryDay={marketTimeResult?.isExpiryDay ?? false}
            candles5m={candles5m}
            prevClose={prevClose || undefined}
            momentumScore={momentumResult?.momentumScore}
            patternScore={patternResult?.consensusConfidence}
            probabilityScore={probabilityResult?.confidenceLevel}
            entryZoneScore={entryZoneResult?.confidence}
            aiAnalysis={currentAI}
            scoreBackup={scoreBackup}
          />
        );

      case "L14_PAPER_TRADING":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 14: Simulated Auto Trading Console</h1>
              <p className="text-sm text-slate-500">Virtual ₹15k margin account auto execution simulation ({activePage})</p>
            </div>
            <PaperTradingCard
              activePage={activePage}
              spotPrice={currentSpot}
              entryZoneResult={entryZoneResult}
              strategyAlignmentResult={strategyAlignmentResult}
              aiDecisionResult={aiDecisionResult}
              opportunityResult={opportunityResult}
              strategiesResult={strategiesResult}
              dbTrades={dbTrades}
              optionChain={legacyOptionChain ?? []}
              onTradePlaced={loadTrades}
              marketTimeResult={marketTimeResult}
              momentumResult={momentumResult}
              smartMoneyResult={smartMoneyResult}
              volatilityScore={probabilityResult.volatilityScore}
              riskResult={riskResult}
            />
          </div>
        );

      case "L15_PERFORMANCE":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 15: Simulated Portfolio Performance</h1>
              <p className="text-sm text-slate-500">Win rates, drawdowns, and account growth metrics ({activePage})</p>
            </div>
            <PerformanceCard
              activePage={activePage}
              paperTradingOutput={paperTradingResult}
              dbTrades={dbTrades}
            />
          </div>
        );

      case "L16_RISK":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <h1 className="text-lg font-black text-white">Layer 16: Risk Management Controller</h1>
              <p className="text-sm text-slate-500">Position sizing & daily loss circuit breaker status ({activePage})</p>
            </div>
            <RiskCard
              activePage={activePage}
              spotPrice={currentSpot}
              paperTradingOutput={paperTradingResult}
              performanceResult={performanceResult}
              indiaVix={optionChain?.indiaVix}
              regimeType={regimeResult.regime}
              aiConfidence={aiDecisionResult.decisionConfidence}
            />
          </div>
        );

      case "L17_MACRO":
        return (
          <div className="w-full p-6 space-y-5">
            <div className="border-b border-slate-800/40 pb-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-black text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded uppercase tracking-wider">Layer 17</span>
                <span className="text-xs text-slate-500 font-mono">INSTITUTIONAL MACRO ENGINE</span>
              </div>
              <h1 className="text-xl font-black text-white tracking-tight">Institutional Macro Bias</h1>
              <p className="text-sm text-slate-400 mt-0.5">Real-time institutional FII/DII flow tracking &amp; macro bias classifier</p>
            </div>
            <div className="grid grid-cols-1 max-w-6xl h-[600px]">
              <InstitutionalMacroCard
                fiiDiiHistory={fiiDiiHistory}
                macroResult={macroResult}
                onRefresh={loadFiiDii}
              />
            </div>
          </div>
        );

      case "AI_SIGNALS":
        return (
          <AISignals
            stocks={currentStocks}
            optionChain={legacyOptionChain}
            aiAnalysis={currentAI}
            spotPrice={currentSpot}
            activePage={activePage}
            pcr={pcr}
            bullishScore={bullishScore}
            bearishScore={bearishScore}
          />
        );

      case "MARKET_BREADTH":
        return (
          <MarketBreadth
            stocks={currentStocks}
            activePage={activePage}
            niftySpot={niftySpot}
            sensexSpot={sensexSpot}
          />
        );

      case "MOMENTUM_SCANNER":
        return (
          <MomentumScanner
            stocks={currentStocks}
            activePage={activePage}
          />
        );

      case "OPTION_CHAIN_ENGINE":
        return (
          <OptionChainEngine
            optionChain={legacyOptionChain}
            aiAnalysis={currentAI}
            spotPrice={currentSpot}
            activePage={activePage}
            pcr={pcr}
          />
        );

      case "PAPER_TRADING":
        return (
          <PaperTrading
            activePage={activePage}
            currentSpot={currentSpot}
            range15m={range15m}
            overallScore={totalScore}
            score5mNet={regimeData.score5mNet}
            score15mNet={regimeData.score15mNet}
            t10={top10ScoresSum}
            t15={next15ScoresSum}
            top25Score={top10ScoresSum + next15ScoresSum}
            top25ScoreDiff={regimeData.top25ScoreDiff}
            pcr={pcr}
            advances={advances}
            declines={declines}
            support={regimeData.supportWall}
            resistance={regimeData.resistanceWall}
            stocks={currentStocksOnly}
            top25Stocks={top25}
            regimeResult={regimeResult}
            optionChain={legacyOptionChain}
            scoreBackup={scoreBackup}
            indiaVix={optionChain?.indiaVix}
            spotChangePct={optionChain?.spotChangePct}
            dayOpen={activePage === "BANKNIFTY" ? bankniftyDayOpen : dayOpen}
            dayHigh={activePage === "BANKNIFTY" ? bankniftyDayHigh : dayHigh}
            dayLow={activePage === "BANKNIFTY" ? bankniftyDayLow : dayLow}
            prevClose={prevClose}
            bankniftySpot={bankniftySpot}
            bankniftyDayOpen={bankniftyDayOpen}
            bankniftyDayHigh={bankniftyDayHigh}
            bankniftyDayLow={bankniftyDayLow}
            dayHighScore={dayHighScore}
            dayLowScore={dayLowScore}
            range15mResult={range15mResult}
            bullishScore={bullishScore}
            bearishScore={bearishScore}
            aiAnalysis={currentAI}

            socket={socket}
            niftyOptionChain={niftyOptionChain}
            sensexOptionChain={sensexOptionChain}
            bankniftyOptionChain={bankniftyOptionChain}
            candles5m={candles5m}
            marketTimeResult={marketTimeResult}
            aiBrainResult={aiBrainResult}
            aiDecisionResult={aiDecisionResult}
            strategyAlignmentResult={strategyAlignmentResult}
            breadthResult={breadthResult}
            momentumResult={momentumResult}
            smartMoneyResult={smartMoneyResult}
            probabilityResult={probabilityResult}
            entryZoneResult={entryZoneResult}
            opportunityResult={opportunityResult}
            strategiesResult={strategiesResult}
            riskResult={riskResult}
            dbTrades={dbTrades}
            onTradePlaced={loadTrades}
          />
        );

      case "TRADE_JOURNAL":
        return (
          <Suspense fallback={<PageLoader />}>
            <TradeJournal activePage={activePage} />
          </Suspense>
        );

      case "RISK_MANAGER":
        return (
          <Suspense fallback={<PageLoader />}>
            <RiskManager activePage={activePage} />
          </Suspense>
        );

      case "PERFORMANCE":
        return (
          <Suspense fallback={<PageLoader />}>
            <PerformanceAnalytics activePage={activePage} />
          </Suspense>
        );

      case "ALGO_TRADING":
        return (
          <Suspense fallback={<PageLoader />}>
            <AlgoTrading activePage={activePage} aiAnalysis={currentAI} />
          </Suspense>
        );

      case "ORB_AUTOMATION":
        return (
          <ORBAutomationTab
            socket={socket}
            niftyOptionChain={niftyOptionChain}
            sensexOptionChain={sensexOptionChain}
            bankniftyOptionChain={bankniftyOptionChain}
          />
        );


      case "SYSTEM_HEALTH":
        return (
          <Suspense fallback={<PageLoader />}>
            <SystemHealth serverTime={serverTime} activePage={activePage} />
          </Suspense>
        );
      case "NEWS":
        return (
          <Suspense fallback={<PageLoader />}>
            <NewsDashboard activePage={activePage as "NIFTY" | "BANKNIFTY" | "SENSEX"} />
          </Suspense>
        );
      case "POSITION_TRADING":
        return (
          <Suspense fallback={<PageLoader />}>
            <PositionTradingDashboard
              activePage={activePage as "NIFTY" | "BANKNIFTY" | "SENSEX"}
              spotPrice={currentSpot}
              darkMode={darkMode ?? false}
              expiryList={activeOptionChain?.expiryList || []}
            />
          </Suspense>
        );

      case "AUTO_STRATEGY":
        return (
          <AutoStrategyTab
            socket={socket}
            spotPrice={currentSpot}
            indexSymbol={activePage}
            indiaVix={optionChain?.indiaVix ?? 0}
            pcr={pcr}
            optionChain={(legacyOptionChain ?? []).map(s => ({
              strikePrice: s.strikePrice,
              ceLtp: s.ceLtp ?? 0,
              peLtp: s.peLtp ?? 0,
              ceOI: s.ceOI ?? 0,
              peOI: s.peOI ?? 0,
            }))}
            isMarketOpen={marketTimeResult?.isMarketOpen ?? false}
            aiConfidence={aiBrainResult?.convictionScore ?? aiDecisionResult?.decisionConfidence ?? 0}
            aiDirection={(aiBrainResult?.finalDecision ?? aiDecisionResult?.finalDecision ?? "WAIT") as any}
            regime={regimeResult?.regime ?? "RANGE"}
            sessionType={marketTimeResult?.sessionType ?? "MID"}
            smartMoneyScore={smartMoneyResult?.smartMoneyScore ?? 0}
            alignmentScore={strategyAlignmentResult?.alignmentScore ?? 0}
            breadthScore={breadthResult?.breadthScore ?? 0}
            rangeBreakout={range15mResult?.rangeBreakout ?? false}
            rangeBreakdown={range15mResult?.rangeBreakdown ?? false}
            momentumExhaustion={momentumResult?.exhaustion?.bullish || momentumResult?.exhaustion?.bearish || false}
            isExpiryDay={marketTimeResult?.isExpiryDay ?? false}
            candles5m={candles5m}
            prevClose={prevClose || undefined}
            momentumScore={momentumResult?.momentumScore}
            patternScore={patternResult?.consensusConfidence}
            probabilityScore={probabilityResult?.confidenceLevel}
            entryZoneScore={entryZoneResult?.confidence}
            aiAnalysis={currentAI}
            scoreBackup={scoreBackup}
          />
        );

      case "SMART_ORDER_QUEUE":
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading Smart Order Queue...</div>}>
            <div className="p-4">
              <SmartOrderQueuePanel
                socket={socket}
                legacyOptionChain={legacyOptionChain}
                underlyingLTP={currentSpot}
                isMarketOpen={marketTimeResult?.isMarketOpen ?? false}
                marketSnapshot={{
                  currentRegime: regimeResult?.regime ?? "RANGE",
                  aiConfidence: aiBrainResult?.convictionScore ?? aiDecisionResult?.decisionConfidence ?? 0,
                  smartMoneyScore: smartMoneyResult?.smartMoneyScore ?? 0,
                  vix: optionChain?.indiaVix ?? 14.5,
                  vixAtSignal: optionChain?.indiaVix ?? 14.0,
                  breadthScore: breadthResult?.breadthScore ?? 50,
                  underlyingLTP: currentSpot,
                  oiWallAbove: null,
                  oiWallBelow: null,
                  pcrCurrent: pcr,
                  pcrAtSignal: pcr,
                  timeNow: new Date().toISOString(),
                }}
              />
            </div>
          </Suspense>
        );

      case "STRATEGY_LAB":
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading Strategy Lab...</div>}>
            <div className="p-4">
              <StrategyLabTab />
            </div>
          </Suspense>
        );

      case "SELF_LEARNING":
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading AI Self-Learning Dashboard...</div>}>
            <SelfLearningDashboard darkMode={true} />
          </Suspense>
        );

      case "ADVANCE_AI":
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading Advance AI Dashboard...</div>}>
            <AdvanceAI
              aiAnalysis={currentAI}
              darkMode={true}
              alerts={alerts}
              triggeredAlerts={triggeredAlerts}
              addAlertRule={addAlertRule}
              deleteAlertRule={deleteAlertRule}
              toggleAlertRule={toggleAlertRule}
              clearAlertHistory={clearAlertHistory}
              optionChain={optionChain}
              stocks={currentStocksOnly}
            />
          </Suspense>
        );
      case "PROCESSOR":
        return (
          <Suspense fallback={<PageLoader />}>
            <ProcessorTab
              socket={socket}
              aiAnalysis={aiAnalysis}
              aiAnalysisSensex={aiAnalysisSensex}
              aiAnalysisBanknifty={aiAnalysisBanknifty}
              niftyOptionChain={niftyOptionChain}
              sensexOptionChain={sensexOptionChain}
              bankniftyOptionChain={bankniftyOptionChain}
              niftySpot={niftySpot}
              sensexSpot={sensexSpot}
              bankniftySpot={bankniftySpot}
              activePage={activePage}
            />
          </Suspense>
        );

      case "CONTINUOUS_SCALP":
        return (
          <Suspense fallback={<PageLoader />}>
            <ContinuousScalpTab socket={socket} activePage={activePage} />
          </Suspense>
        );

      case "AMEX_OS":
        return (
          <AmexGatingDashboard darkMode={true} amexData={currentAI} />
        );

    }
  };

  const isEngineSubPage = useMemo(() => {
    return activeTEPage.startsWith("L") || activeTEPage === "PAPER_TRADING";
  }, [activeTEPage]);

  return (
    <TradingEngineLayout activePage={activeTEPage} onPageChange={setActiveTEPage}>
      {renderPage()}
      {isEngineSubPage && (
        <LiveSignalFeedCard
          activePage={activePage}
          spotPrice={currentSpot}
          marketTimeResult={marketTimeResult}
          riskResult={riskResult}
          aiDecisionResult={aiDecisionResult}
          strategiesResult={strategiesResult}
          openPositions={openPositionsWithLtp}
          dbTrades={dbTrades}
          optionChain={legacyOptionChain}
          probabilityResult={probabilityResult}
          rtpodeResult={rtpodeResult}
          optionBuyingSetup={optionBuyingSetup}
          multiIndexResult={multiIndexResult}
          aiBrainResult={aiBrainResult}
          signalMemoryResult={signalMemoryResult}
          patternResult={patternResult}
          brainLocked={brainLocked}
          onToggleBrainLock={handleToggleBrainLock}
        />
      )}
    </TradingEngineLayout>
  );
};

export default TradingEngine;

