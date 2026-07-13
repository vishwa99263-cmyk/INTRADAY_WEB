/**
 * PaperTrading.tsx — Virtual Paper Trading Dashboard
 * Housed on the main router's PAPER_TRADING tab.
 * Includes Layer 14, 15, and 16 card components, option flow, and live alerts feed,
 * alongside a collapsible manual trading terminal.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BookOpen, PlusCircle, X, TrendingUp, TrendingDown,
  RefreshCw, CheckCircle, AlertCircle, DollarSign, Target, Shield, ChevronDown, ChevronUp,
  Layers, Zap, Activity, BarChart2
} from "lucide-react";
import type { OptionStrike, TEPaperTrade } from "../../../types";
import TradeDetailsModal from "../shared/TradeDetailsModal";

// Import Layer Cards
import PaperTradingCard from "./PaperTradingCard";
import PerformanceCard from "./PerformanceCard";
import RiskCard from "./RiskCard";
import LiveSignalFeedCard from "./LiveSignalFeedCard";
import MarketTimeCard from "./MarketTimeCard";
import InstitutionalMacroCard from "./InstitutionalMacroCard";

// Consolidated tabs
import AutoStrategyTab from "./AutoStrategyTab";
import ORBAutomationTab from "./ORBAutomationTab";

// Import Layer Computations
import { computeInstitutionalMacro } from "../../../engine/institutionalMacroEngine";
import { computeMarketTime } from "../../../engine/marketTimeEngine";
import { computeOptionFlow } from "../../../engine/optionFlowEngine";
import { computeMarketBreadth } from "../../../engine/marketBreadthEngine";
import { computeHeavyweight } from "../../../engine/heavyweightEngine";
import { computeRange15M } from "../../../engine/range15mEngine";
import { computeOptionChain } from "../../../engine/optionChainEngine";
import { computeMomentum } from "../../../engine/momentumEngine";
import { computeSmartMoney } from "../../../engine/smartMoneyEngine";
import { computeProbability } from "../../../engine/probabilityEngine";
import { computeEntryZone } from "../../../engine/entryZoneEngine";
import { computeStrategyAlignment } from "../../../engine/strategyAlignmentEngine";
import { computeAIDecision } from "../../../engine/aiDecisionEngine";
import { computeOpportunities } from "../../../engine/opportunityEngine";
import { computeStrategies } from "../../../engine/strategiesEngine";
import { computePaperTrading } from "../../../engine/paperTradingEngine";
import { computePerformance } from "../../../engine/performanceEngine";
import { computeRisk } from "../../../engine/riskEngine";
import { runMicroScalpEngine } from "../../../engine/microScalpEngine";

interface Props {
  activePage: string;
  currentSpot: number;
  range15m: { high: number; low: number; isFallback?: boolean };
  overallScore: number;
  score5mNet: number;
  score15mNet: number;
  t10: number;
  t15: number;
  top25Score: number;
  top25ScoreDiff: number;
  pcr: number;
  advances: number;
  declines: number;
  support: number;
  resistance: number;
  stocks: any[];
  top25Stocks: any[];
  regimeResult: any;
  /** Raw option chain strikes for Layer 5 */
  optionChain?: OptionStrike[];
  /** Aggregate 30M score change across all stocks */
  score30mNet?: number;
  /** Aggregate 1H score change across all stocks */
  score1hNet?: number;
  /** Total volume across all constituent stocks */
  totalVolume?: number;
  /** Score backup data for Score Candle chart (symbol → {time → score}) */
  scoreBackup?: Record<string, Record<string, number>>;
  indiaVix?: number;
  spotChangePct?: number;
  // ── Intraday combination inputs for exhaustion detection ────────────────────
  /** Day open of the active index */
  dayOpen?: number;
  /** Day high of the active index */
  dayHigh?: number;
  /** Day low of the active index */
  dayLow?: number;
  /** Previous day close of the active index */
  prevClose?: number;
  /** BankNifty current spot (for Nifty exhaustion confirmation) */
  bankniftySpot?: number;
  /** BankNifty day open */
  bankniftyDayOpen?: number;
  /** BankNifty day high */
  bankniftyDayHigh?: number;
  /** BankNifty day low */
  bankniftyDayLow?: number;
  dayHighScore?: number;
  dayLowScore?: number;
  range15mResult?: any;
  bullishScore?: number;
  bearishScore?: number;
  aiAnalysis?: any;

  // Expanded props
  socket?: any;
  niftyOptionChain?: any[];
  sensexOptionChain?: any[];
  bankniftyOptionChain?: any[];
  candles5m?: any[];
  marketTimeResult?: any;
  aiBrainResult?: any;
  aiDecisionResult?: any;
  strategyAlignmentResult?: any;
  breadthResult?: any;
  momentumResult?: any;
  smartMoneyResult?: any;
  probabilityResult?: any;
  entryZoneResult?: any;
  opportunityResult?: any;
  strategiesResult?: any;
  riskResult?: any;
  dbTrades?: TEPaperTrade[];
  onTradePlaced?: () => void;
}

interface LotConfig {
  instrument: string;
  lot_size: number;
  updated_at: number;
}

const INITIAL_CAPITAL = 30000; // ₹30,000 starting capital (user set)

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

const computeLivePremium = (pos: TEPaperTrade, optionChain: any[], activePage: string, currentSpot?: number): number => {
  if (pos.direction === "BULL_SPREAD" || pos.direction === "BEAR_SPREAD") {
    const isCE = pos.direction === "BULL_SPREAD";
    const strikeGap = activePage === "SENSEX" ? 100 : 50;
    const strikeLong = pos.strike;
    const strikeShort = isCE ? pos.strike + strikeGap : pos.strike - strikeGap;
    
    const strikeRowLong = optionChain.find((s: any) => s.strikePrice === strikeLong);
    const strikeRowShort = optionChain.find((s: any) => s.strikePrice === strikeShort);
    
    const ltpLong = isCE
      ? (strikeRowLong?.ceLtp ?? strikeRowLong?.ceBid ?? pos.entry_price)
      : (strikeRowLong?.peLtp ?? strikeRowLong?.peBid ?? pos.entry_price);
      
    const ltpShort = isCE
      ? (strikeRowShort?.ceLtp ?? strikeRowShort?.ceBid ?? pos.entry_price * 0.6)
      : (strikeRowShort?.peLtp ?? strikeRowShort?.peBid ?? pos.entry_price * 0.6);
      
    const netPremium = ltpLong - ltpShort;
    return netPremium > 0 ? netPremium : pos.entry_price;
  } else {
    // 1. Try real-time option chain tick first
    const strikeData = optionChain.find((s: any) => s.strikePrice === pos.strike);
    let ltp = 0;
    if (strikeData) {
      ltp = pos.direction === "BUY_CE"
        ? (strikeData.ceLtp ?? strikeData.ceBid ?? 0)
        : (strikeData.peLtp ?? strikeData.peBid ?? 0);
    }
    
    // 2. Fallback: Greeks-based Theoretical Pricing if LTP is unavailable/stale
    if (ltp <= 0 && currentSpot && currentSpot > 0) {
      try {
        const parsed = JSON.parse(pos.notes || "{}");
        const metrics = parsed.metrics || {};
        
        let entrySpot = metrics.spotPrice || metrics.spot || (pos as any).entrySpot;
        if (!entrySpot) {
          // Fallback if not specified: guess entry spot based on strike
          entrySpot = pos.strike;
        }
        
        if (entrySpot > 0) {
          const delta = metrics.delta !== undefined ? Math.abs(metrics.delta) : 0.5;
          const gamma = metrics.gamma !== undefined ? metrics.gamma : 0.0015;
          const theta = metrics.theta !== undefined ? metrics.theta : -10;
          
          const spotChange = currentSpot - entrySpot;
          const directionSign = pos.direction === "BUY_CE" ? 1 : -1;
          
          const deltaEffect = delta * spotChange * directionSign;
          const gammaEffect = 0.5 * gamma * spotChange * spotChange;
          
          const timeElapsedDays = (Date.now() - pos.timestamp) / (24 * 60 * 60 * 1000);
          const thetaEffect = theta * timeElapsedDays;
          
          const theoreticalChange = deltaEffect + gammaEffect + thetaEffect;
          const theoreticalPremium = pos.entry_price + theoreticalChange;
          
          return Math.max(0.05, parseFloat(theoreticalPremium.toFixed(1)));
        }
      } catch (e) {}
    }
    
    return ltp > 0 ? ltp : pos.entry_price;
  }
};

const StrategyExecutionMonitor: React.FC<{ trades: TEPaperTrade[] }> = ({ trades }) => {
  const stats = useMemo(() => {
    const counts: Record<string, { open: number; closed: number; total: number; pnl: number }> = {
      HERO_ZERO: { open: 0, closed: 0, total: 0, pnl: 0 },
      GAMMA_SCALPING: { open: 0, closed: 0, total: 0, pnl: 0 },
      MOMENTUM_SCALPING: { open: 0, closed: 0, total: 0, pnl: 0 },
      DELTA_NEUTRAL_STRADDLE: { open: 0, closed: 0, total: 0, pnl: 0 },
      BERSERKER_SCALP: { open: 0, closed: 0, total: 0, pnl: 0 },
      MANUAL: { open: 0, closed: 0, total: 0, pnl: 0 },
      OTHERS: { open: 0, closed: 0, total: 0, pnl: 0 },
    };

    trades.forEach(t => {
      let sType = "MANUAL";
      try {
        if (t.notes) {
          const parsed = JSON.parse(t.notes);
          if (parsed.scalpType) {
            sType = parsed.scalpType;
          } else if (parsed.strategyName) {
            sType = parsed.strategyName;
          } else if (t.strategyName) {
            sType = t.strategyName;
          } else if (parsed.type === "MANUAL") {
            sType = "MANUAL";
          } else {
            sType = "OTHERS";
          }
        } else if (t.strategyName) {
          sType = t.strategyName;
        } else {
          sType = "MANUAL";
        }
      } catch {
        sType = t.strategyName || "MANUAL";
      }

      let key = "OTHERS";
      const upperType = String(sType).toUpperCase();
      if (upperType.includes("HERO_ZERO") || upperType.includes("HERO")) key = "HERO_ZERO";
      else if (upperType.includes("GAMMA")) key = "GAMMA_SCALPING";
      else if (upperType.includes("MOMENTUM") || upperType.includes("MOM")) key = "MOMENTUM_SCALPING";
      else if (upperType.includes("STRADDLE") || upperType.includes("DELTA_NEUTRAL")) key = "DELTA_NEUTRAL_STRADDLE";
      else if (upperType.includes("BERSERKER") || upperType.includes("MICRO")) key = "BERSERKER_SCALP";
      else if (upperType === "MANUAL" || upperType === "") key = "MANUAL";
      else key = "OTHERS";

      if (!counts[key]) {
        counts[key] = { open: 0, closed: 0, total: 0, pnl: 0 };
      }

      if (t.status === "OPEN") {
        counts[key].open += 1;
      } else {
        counts[key].closed += 1;
        counts[key].pnl += t.pnl || 0;
      }
      counts[key].total += 1;
    });

    return counts;
  }, [trades]);

  const strategyMetadata: Record<string, { label: string; desc: string; color: string }> = {
    HERO_ZERO: { label: "Hero Zero", desc: "High delta expiry option flush", color: "from-purple-500/20 to-purple-700/5 text-purple-400 border-purple-500/30" },
    GAMMA_SCALPING: { label: "Gamma Scalping", desc: "Fast expiry delta-neutral expansion", color: "from-cyan-500/20 to-cyan-700/5 text-cyan-400 border-cyan-500/30" },
    MOMENTUM_SCALPING: { label: "Momentum Scalping", desc: "Trend velocity breakout scalp", color: "from-emerald-500/20 to-emerald-700/5 text-emerald-400 border-emerald-500/30" },
    DELTA_NEUTRAL_STRADDLE: { label: "Neutral Straddle", desc: "Consolidation premium decay collection", color: "from-blue-500/20 to-blue-700/5 text-blue-400 border-blue-500/30" },
    BERSERKER_SCALP: { label: "Berserker Scalp", desc: "High velocity micro-scalp trigger", color: "from-rose-500/20 to-rose-700/5 text-rose-400 border-rose-500/30" },
    MANUAL: { label: "Manual Trade", desc: "User executed manual orders", color: "from-amber-500/20 to-amber-700/5 text-amber-400 border-amber-500/30" },
    OTHERS: { label: "Other Strategy", desc: "General auto indicator strategy", color: "from-slate-500/20 to-slate-700/5 text-slate-400 border-slate-500/30" },
  };

  // Check if there are any trades at all
  const hasTrades = (Object.values(stats) as any[]).some(s => s.total > 0);
  if (!hasTrades) {
    return (
      <div className="border border-slate-800/80 rounded-xl bg-slate-950/20 p-5 text-center text-slate-500 font-mono text-xs">
        No auto-trading or manual trade counts recorded yet today. Waiting for entries...
      </div>
    );
  }

  return (
    <div className="border border-slate-800/80 rounded-xl bg-slate-950/20 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-indigo-400" />
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-300">
            Paper Trade Strategy Monitor
          </h2>
        </div>
        <span className="text-xs font-mono text-slate-500">Tracked Strategies</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.entries(stats) as [string, any][]).map(([key, data]) => {
          const meta = strategyMetadata[key] || strategyMetadata.OTHERS;
          if (data.total === 0) return null; // Only show active strategies that have trades
          return (
            <div key={key} className={`rounded-lg border bg-gradient-to-br ${meta.color} p-3 flex flex-col justify-between h-28`}>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-black uppercase tracking-wider font-mono">{meta.label}</span>
                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${data.open > 0 ? "bg-emerald-500/25 text-emerald-400 border border-emerald-500/20" : "bg-slate-800 text-slate-500"}`}>
                    {data.open > 0 ? `${data.open} Active` : "Inactive"}
                  </span>
                </div>
                <div className="text-[10px] opacity-60 leading-3 mb-2">{meta.desc}</div>
              </div>
              <div className="flex items-end justify-between border-t border-slate-800/30 pt-1.5 mt-auto">
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-500 font-mono">TRADES (O/C)</span>
                  <span className="text-xs font-bold text-slate-300 font-mono">{data.open} / {data.closed}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[9px] text-slate-500 font-mono">REALIZED PNL</span>
                  <span className={`text-xs font-black font-mono ${data.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {data.pnl >= 0 ? `+₹${data.pnl.toFixed(0)}` : `-₹${Math.abs(data.pnl).toFixed(0)}`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PaperTrading: React.FC<Props> = (props) => {
  const {
    activePage,
    currentSpot,
    range15m,
    overallScore,
    score5mNet,
    score15mNet,
    t10,
    t15,
    top25Score,
    top25ScoreDiff,
    pcr,
    advances,
    declines,
    support,
    resistance,
    stocks,
    top25Stocks,
    regimeResult,
    optionChain,
    score30mNet,
    score1hNet,
    totalVolume,
    scoreBackup,
    indiaVix,
    spotChangePct,
    dayOpen      = 0,
    dayHigh      = 0,
    dayLow       = 0,
    prevClose    = 0,
    bankniftySpot    = 0,
    bankniftyDayOpen = 0,
    bankniftyDayHigh = 0,
    bankniftyDayLow  = 0,
    dayHighScore,
    dayLowScore,
    range15mResult: parentRange15mResult,
    bullishScore = 50,
    bearishScore = 50,
    aiAnalysis,

    // Consolidated props
    socket,
    niftyOptionChain,
    sensexOptionChain,
    bankniftyOptionChain,
    candles5m,
    marketTimeResult: parentMarketTimeResult,
    aiBrainResult,
    aiDecisionResult: parentAiDecisionResult,
    strategyAlignmentResult: parentStrategyAlignmentResult,
    breadthResult: parentBreadthResult,
    momentumResult: parentMomentumResult,
    smartMoneyResult: parentSmartMoneyResult,
    probabilityResult: parentProbabilityResult,
    entryZoneResult: parentEntryZoneResult,
    opportunityResult: parentOpportunityResult,
    strategiesResult: parentStrategiesResult,
    riskResult: parentRiskResult,
    dbTrades: parentDbTrades,
    onTradePlaced: parentOnTradePlaced,
  } = props;

  // ── Database Sync States ──────────────────────────────────────────────────
  const [trades, setTrades] = useState<TEPaperTrade[]>([]);
  const [lotConfig, setLotConfig] = useState<LotConfig[]>([]);
  const [fiiDiiHistory, setFiiDiiHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"OPEN" | "CLOSED">("OPEN");
  const [terminalSubTab, setTerminalSubTab] = useState<"AUTO_DISPATCHER" | "MANUAL_TRADING" | "ORB_AUTOMATION" | "AUTO_CONSOLE" | "MICRO_SCALP">("AUTO_DISPATCHER");
  const [selectedTradeForDetails, setSelectedTradeForDetails] = useState<any | null>(null);
  
  // Manual Terminal UI Expand State
  const [manualTerminalOpen, setManualTerminalOpen] = useState(false);
  const [prefilledStrategy, setPrefilledStrategy] = useState<string>("MANUAL");

  // Form State
  const [form, setForm] = useState({
    direction: "BUY_CE" as "BUY_CE" | "BUY_PE" | "BULL_SPREAD" | "BEAR_SPREAD",
    strike: "",
    entry_price: "",
    qty: "1",
    stop_loss: "",
    target: "",
    notes: "",
  });

  // Load trades + configuration + FII/DII from DB
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tradesRes, lotRes, fiiDiiRes] = await Promise.all([
        fetch(getApiUrl("/api/te/paper-trades?limit=1000")),
        fetch(getApiUrl("/api/te/lot-config")),
        fetch(getApiUrl("/api/te/fii-dii?limit=30")),
      ]);
      if (tradesRes.ok) {
        const d = await tradesRes.json();
        setTrades(d.trades || []);
      }
      if (lotRes.ok) {
        const d = await lotRes.json();
        setLotConfig(d.lotConfig || []);
      }
      if (fiiDiiRes.ok) {
        const d = await fiiDiiRes.json();
        setFiiDiiHistory(d.fiiDiiHistory || []);
      }
    } catch (e) {
      console.error("Error loading paper trades ledger:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const macroResult = useMemo(() => {
    return computeInstitutionalMacro(fiiDiiHistory);
  }, [fiiDiiHistory]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 4000);
    return () => clearInterval(interval);
  }, [loadAll]);

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

  const marketTimeResult = useMemo(() => {
    return computeMarketTime(currentTime);
  }, [currentTime]);

  const agg30mNet = score30mNet ?? stocks.reduce((a: number, s: any) => a + (s.score30mDiff || 0), 0);
  const agg1hNet  = score1hNet  ?? stocks.reduce((a: number, s: any) => a + (s.score1hDiff  || 0), 0);
  const aggVolume = totalVolume ?? stocks.reduce((a: number, s: any) => a + (s.volume       || 0), 0);
  const changePercent = stocks.length > 0
    ? stocks.reduce((a: number, s: any) => a + (s.changePercent || 0), 0) / stocks.length
    : 0;

  const breadthResult = useMemo(() =>
    computeMarketBreadth({
      advances,
      declines,
      totalStocks: stocks.length,
      stocks: stocks.map((s: any) => ({
        symbol: s.symbol,
        score: s.score,
        weightage: s.weightage,
        changePercent: s.changePercent,
        scoreDifference: s.scoreDifference,
      })),
      top25Stocks: top25Stocks.map((s: any) => ({
        symbol: s.symbol,
        score: s.score,
        weightage: s.weightage,
        changePercent: s.changePercent,
        scoreDifference: s.scoreDifference,
      })),
      overallScore,
      t10,
      t15,
      top25ScoreDiff,
      spotPrice: currentSpot,
      regimeResult,
    }),
    [advances, declines, stocks, top25Stocks, overallScore, t10, t15, top25ScoreDiff, currentSpot, regimeResult]
  );

  const heavyweightResult = useMemo(() =>
    computeHeavyweight({
      stocks: stocks.map((s: any) => ({
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
    [stocks, regimeResult, breadthResult]
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
      strikes: (optionChain ?? []) as any,
      spotPrice: currentSpot,
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
    }),
    [optionChain, currentSpot, regimeResult, breadthResult, heavyweightResult, range15mResult]
  );

  const momentumResult = useMemo(() =>
    computeMomentum({
      overallScore,
      scoreDifference: score5mNet,
      score15mDiff: score15mNet,
      score30mDiff: agg30mNet,
      score1hDiff: agg1hNet,
      changePercent,
      volume: aggVolume,
      // ── Intraday combination inputs ──
      spotPrice:        currentSpot,
      dayOpen,
      dayHigh,
      dayLow,
      prevClose,
      activePage,
      bankniftySpot,
      bankniftyDayOpen,
      bankniftyDayHigh,
      bankniftyDayLow,
      // ── Layer inputs ──
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
    }),
    [overallScore, score5mNet, score15mNet, agg30mNet, agg1hNet, changePercent, aggVolume,
     currentSpot, dayOpen, dayHigh, dayLow, prevClose, activePage,
     bankniftySpot, bankniftyDayOpen, bankniftyDayHigh, bankniftyDayLow,
     regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult]
  );

  const oiTotals = useMemo(() => {
    const chain = optionChain ?? [];
    return {
      totalCallOI:       chain.reduce((a: number, s: any) => a + (s.ceOI       || 0), 0),
      totalPutOI:        chain.reduce((a: number, s: any) => a + (s.peOI       || 0), 0),
      totalCallOIChange: chain.reduce((a: number, s: any) => a + (s.ceOIChange || 0), 0),
      totalPutOIChange:  chain.reduce((a: number, s: any) => a + (s.peOIChange || 0), 0),
      totalCallVolume:   chain.reduce((a: number, s: any) => a + (s.ceVolume   || 0), 0),
      totalPutVolume:    chain.reduce((a: number, s: any) => a + (s.peVolume   || 0), 0),
    };
  }, [optionChain]);

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
      overallScore,
      scoreDifference: score5mNet,
      score15mDiff: score15mNet,
      volume: aggVolume,
      changePercent,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, pcr, oiTotals,
     overallScore, score5mNet, score15mNet, aggVolume, changePercent]
  );

  const probabilityResult = useMemo(() => {
    let tradingMode = "INTRADAY";
    try {
      const riskSettings = JSON.parse(localStorage.getItem("te_risk_settings") || "{}");
      tradingMode = riskSettings.tradingMode || "INTRADAY";
    } catch (e) {}

    return computeProbability({
      regimeResult, breadthResult, heavyweightResult, range15mResult,
      optionChainResult, momentumResult,
      smartMoneyResult,
      pcr,
      optionChain,
      spotPrice: currentSpot,
      score15mDiff: score15mNet,
      // Pass exhaustion side so PE/CE probability reflects reversal zone
      intradayExhaustionSide: momentumResult.intradayExhaustionSide,
      institutionalMacroResult: macroResult,
      tradingMode: tradingMode as "INTRADAY" | "SWING",
    });
  }, [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, pcr, optionChain, currentSpot, score15mNet, macroResult]
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

  const aiDecisionResult = useMemo(() => {
    let tradingMode = "INTRADAY";
    try {
      const riskSettings = JSON.parse(localStorage.getItem("te_risk_settings") || "{}");
      tradingMode = riskSettings.tradingMode || "INTRADAY";
    } catch (e) {}

    return computeAIDecision({
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
      indiaVix,
      spotChangePct,
      marketTimeResult,
      institutionalMacroResult: macroResult,
      tradingMode: tradingMode as "INTRADAY" | "SWING",
    });
  }, [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult, strategyAlignmentResult, indiaVix, spotChangePct, marketTimeResult, macroResult]
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
      optionChain: optionChain ?? [],
      spotPrice: currentSpot,
      activePage,
      strategiesResult,
      aiDecisionResult,
      currentTimeMs: currentTime,
    }),
    [optionChain, currentSpot, activePage, strategiesResult, aiDecisionResult, currentTime]
  );

  const paperTradingResult = useMemo(() => {
    let tradingMode = "INTRADAY";
    try {
      const riskSettings = JSON.parse(localStorage.getItem("te_risk_settings") || "{}");
      tradingMode = riskSettings.tradingMode || "INTRADAY";
    } catch (e) {}

    return computePaperTrading({
      entryZoneResult,
      strategyAlignmentResult,
      aiDecisionResult,
      opportunityResult,
      strategiesResult,
      spotPrice: currentSpot,
      activePage,
      dbTrades: trades,
      marketTimeResult,
      optionFlowResult,
      volatilityScore: probabilityResult.volatilityScore,
      optionChain,
      range15mResult,
      dayHigh: activePage === "BANKNIFTY" ? bankniftyDayHigh : dayHigh,
      dayLow: activePage === "BANKNIFTY" ? bankniftyDayLow : dayLow,
      tradingMode: tradingMode as "INTRADAY" | "SWING",
    });
  }, [entryZoneResult, strategyAlignmentResult, aiDecisionResult, opportunityResult, strategiesResult, currentSpot, activePage, trades, marketTimeResult, optionFlowResult, probabilityResult.volatilityScore, optionChain, range15mResult, dayHigh, dayLow, bankniftyDayHigh, bankniftyDayLow]);

  const performanceResult = useMemo(() =>
    computePerformance({
      paperTradingOutput: paperTradingResult,
      dbTrades: trades,
    }),
    [paperTradingResult, trades]
  );

  // ── Micro Scalp Live Engine ───────────────────────────────────────────────
  const [microScalpLastTime, setMicroScalpLastTime] = useState(0);
  const [microScalpTradeCount, setMicroScalpTradeCount] = useState(0);
  const [prevSmartMoney, setPrevSmartMoney] = useState(0);

  const microScalpLive = useMemo(() => {
    const ms = momentumResult;
    const oc = optionChainResult;
    const sm = smartMoneyResult;
    const pr = probabilityResult;
    const br = breadthResult;
    const re = regimeResult;
    const sa = strategyAlignmentResult;

    return runMicroScalpEngine({
      spotPrice:             currentSpot,
      indexSymbol:           (activePage === "NIFTY" || activePage === "SENSEX" || activePage === "BANKNIFTY") ? activePage : "NIFTY",
      indiaVix:              indiaVix ?? 14,
      ceProbability:         pr?.ceProbability ?? 50,
      peProbability:         pr?.peProbability ?? 50,
      setupQuality:          pr?.setupQuality ?? "MODERATE",
      trapOverride:          pr?.trapOverride ?? false,
      confidenceLevel:       pr?.confidenceLevel ?? 50,
      pmaeAlert:             !!pr?.pmaeAlert,
      volatilityScore:       pr?.volatilityScore ?? 50,
      smartMoneyScore:       sm?.smartMoneyScore ?? 0,
      institutionalBias:     sm?.institutionalBias ?? "NONE",
      trapType:              sm?.trapType ?? "NONE",
      overrideSignal:        sm?.overrideSignal ?? false,
      prevSmartMoneyScore:   prevSmartMoney,
      momentumScore:         ms?.momentumScore ?? 50,
      acceleration:          ms?.acceleration ?? 0,
      freshMomentumDetected: ms?.freshMomentumDetected ?? false,
      intradayExhaustionSide: ms?.intradayExhaustionSide ?? "NONE",
      intradayMovePoints:    ms?.intradayMovePoints ?? 0,
      momentumGrade:         ms?.momentumGrade ?? "C",
      volumeConviction:      ms?.volumeConviction ?? 0,
      exhaustionBullish:     ms?.exhaustion?.bullish ?? false,
      exhaustionBearish:     ms?.exhaustion?.bearish ?? false,
      pcr:                   pcr,
      pcrScore:              oc?.pcrScore ?? 50,
      callWall:              oc?.oiWalls?.callWall ?? 0,
      putWall:               oc?.oiWalls?.putWall ?? 0,
      callWallStrength:      oc?.oiWalls?.callWallStrength ?? 0,
      putWallStrength:       oc?.oiWalls?.putWallStrength ?? 0,
      maxPain:               oc?.maxPain ?? 0,
      optionChainScore:      oc?.optionChainScore ?? 50,
      callUnwinding:         oc?.oiWritingUnwinding?.callUnwinding ?? 0,
      putWriting:            oc?.oiWritingUnwinding?.putWriting ?? 0,
      breadthScore:          br?.breadthScore ?? 50,
      divergenceType:        br?.divergenceType ?? "NONE",
      breadthTrend:          br?.breadthTrend ?? "STABLE",
      regime:                re?.regime ?? "RANGE",
      regimeConfidence:      re?.confidence ?? 50,
      tradeReadiness:        sa?.tradeReadiness ?? "PARTIALLY_ALIGNED",
      alignmentGrade:        sa?.alignmentGrade ?? "C",
      highSeverityConflicts: (sa?.conflicts ?? []).filter((c: any) => c.severity === "HIGH").length,
      recentWinRate:         50,
      confidenceMultiplier:  1.0,
      consecutiveLosses:     0,
      cooldownActive:        false,
      brainState:            "LEARNING",
      rtpodeDirection:       "NO_SIGNAL",
      rtpodeConfidence:      0,
      rtpodeAligned:         false,
      lastMicroScalpTime:    microScalpLastTime,
      dailyPnlRs:            trades.reduce((a, t) => a + t.pnl, 0),
      openPositionCount:     trades.filter(t => t.status === "OPEN" && t.instrument === activePage).length,
      dailyTradeCount:       microScalpTradeCount,
      isExpiryDay:           marketTimeResult?.isExpiryDay ?? false,
      sessionType:           marketTimeResult?.sessionType ?? "MID",
    });
  }, [currentSpot, activePage, indiaVix, momentumResult, optionChainResult, smartMoneyResult,
      probabilityResult, breadthResult, regimeResult, strategyAlignmentResult,
      pcr, prevSmartMoney, microScalpLastTime, trades, microScalpTradeCount, marketTimeResult]);

  // Sync prevSmartMoney every 5 minutes
  useEffect(() => {
    const t = setInterval(() => setPrevSmartMoney(smartMoneyResult?.smartMoneyScore ?? 0), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [smartMoneyResult?.smartMoneyScore]);

  const riskResult = useMemo(() =>
    computeRisk({
      paperTradingOutput: paperTradingResult,
      performanceResult,
      spotPrice: currentSpot,
      activePage,
      indiaVix,
      regimeType: regimeResult.regime,
      aiConfidence: aiDecisionResult.decisionConfidence,
      optionChain,
    }),
    [paperTradingResult, performanceResult, currentSpot, activePage, indiaVix, regimeResult.regime, aiDecisionResult.decisionConfidence, optionChain]
  );

  // Sync open positions with realtime option premium and calculate floating live P&L
  const openPositionsWithLtp = useMemo(() => {
    return paperTradingResult.openPositions.map(pos => {
      const currentPremium = computeLivePremium(pos, optionChain ?? [], activePage, currentSpot);
      const livePnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;

      return {
        ...pos,
        currentPremium,
        livePnl: parseFloat(livePnl.toFixed(1)),
      };
    });
  }, [paperTradingResult.openPositions, optionChain, activePage]);

  // Pre-fill manual order entry parameters when strategy alerts trigger
  useEffect(() => {
    const sug = paperTradingResult.autoTradeSuggestion;
    if (!sug) return;
    setForm(f => ({
      ...f,
      direction: sug.direction,
      strike: String(sug.strike),
      entry_price: String(sug.entry_price.toFixed(1)),
      stop_loss: String(sug.stop_loss.toFixed(1)),
      target: String(sug.target.toFixed(1)),
      notes: `[${sug.strategyName}] ${sug.notes}`,
    }));
    setPrefilledStrategy(sug.strategyName);
  }, [paperTradingResult.autoTradeSuggestion]);

  // Lot sizes configs
  const currentLotSize = useMemo(() => {
    const row = lotConfig.find(c => c.instrument === activePage);
    return row?.lot_size || (activePage === "NIFTY" ? 65 : 20);
  }, [lotConfig, activePage]);

  // ── Hedge Filter: exclude spread/hedge trades, keep only naked entries ──
  const HEDGE_DIRS = new Set(["BULL_SPREAD", "BEAR_SPREAD"]);
  const isNakedTrade = (t: TEPaperTrade) => true;

  // ── Manual Portfolio Stats (naked trades only) ────────────────────────────
  const stats = useMemo(() => {
    const nakedTrades = trades.filter(isNakedTrade);
    // Today's trades only (IST midnight boundary)
    const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const todayTrades = nakedTrades.filter(t => {
      const d = new Date(t.timestamp + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      return d === todayIST;
    });
    const open   = nakedTrades.filter(t => t.status === "OPEN");
    const closed = nakedTrades.filter(t => t.status === "CLOSED");
    const todayClosed = todayTrades.filter(t => t.status === "CLOSED");
    const todayPnl  = todayClosed.reduce((a, t) => a + t.pnl, 0);
    const totalPnl  = nakedTrades.reduce((a, t) => a + t.pnl, 0);
    const wins      = todayClosed.filter(t => t.pnl > 0).length;
    const losses    = todayClosed.filter(t => t.pnl < 0).length;
    const winRate   = todayClosed.length > 0 ? (wins / todayClosed.length) * 100 : 0;
    const usedMargin      = open.reduce((a, t) => a + t.entry_price * t.qty * t.lot_size, 0);
    // Capital: always ₹15,000 base + today's realized P&L
    const availableCapital = INITIAL_CAPITAL + todayPnl - usedMargin;
    const totalWins   = todayClosed.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const totalLosses = Math.abs(todayClosed.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 99 : 1;
    return { open: open.length, closed: closed.length, totalPnl: todayPnl, allTimePnl: totalPnl, wins, losses, winRate, usedMargin, availableCapital, profitFactor, todayTrades, todayClosed };
  }, [trades]);

  // ── Place Trade Manual ────────────────────────────────────────────────────
  const placeTrade = async () => {
    const entryP = parseFloat(form.entry_price);
    const strikeN = parseFloat(form.strike);
    const qty = parseInt(form.qty);
    if (!entryP || !strikeN || !qty) { alert("Please complete: Strike, Entry Price, and Lot Qty"); return; }

    const lot = currentLotSize;
    const sl = parseFloat(form.stop_loss) || entryP * 0.8;
    const tgt = parseFloat(form.target) || entryP * 1.5;

    const strikeRow = optionChain?.find(s => s.strikePrice === strikeN);
    const isCE = form.direction === "BUY_CE" || form.direction === "BULL_SPREAD";

    const rawDelta = isCE ? strikeRow?.ceDelta : strikeRow?.peDelta;
    const deltaVal = rawDelta !== undefined ? Math.abs(Number(rawDelta)) : undefined;

    const rawGamma = isCE ? strikeRow?.ceGamma : strikeRow?.peGamma;
    const gammaVal = rawGamma !== undefined ? Number(rawGamma) : undefined;

    const rawTheta = isCE ? strikeRow?.ceTheta : strikeRow?.peTheta;
    const thetaVal = rawTheta !== undefined ? Number(rawTheta) : undefined;

    const rawVega = isCE ? strikeRow?.ceVega : strikeRow?.peVega;
    const vegaVal = rawVega !== undefined ? Number(rawVega) : undefined;

    const rawIV = isCE ? strikeRow?.ceIV : strikeRow?.peIV;
    const ivVal = rawIV !== undefined ? Number(rawIV) : undefined;

    const newTrade: Omit<TEPaperTrade, "created_at"> = {
      id: `pt-manual-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: Date.now(),
      instrument: activePage,
      direction: form.direction,
      strike: strikeN,
      entry_price: entryP,
      qty,
      lot_size: lot,
      stop_loss: sl,
      target: tgt,
      status: "OPEN",
      pnl: 0,
      strategyName: prefilledStrategy || "MANUAL",
      confidence: aiDecisionResult?.decisionConfidence ?? 75,
      notes: JSON.stringify({
        type: "MANUAL",
        reason: form.notes || "Manual Trade Entry Console",
        metrics: {
          regime: regimeResult?.regime || "UNKNOWN",
          breadth: breadthResult?.breadthScore ?? 50,
          momentum: momentumResult?.momentumScore ?? 50,
          pcr: pcr,
          probability: (form.direction === "BUY_CE" || form.direction === "BULL_SPREAD") ? (probabilityResult?.ceProbability ?? 50) : (probabilityResult?.peProbability ?? 50),
          confidence: aiDecisionResult?.decisionConfidence ?? 75,
          alignment: strategyAlignmentResult?.alignedLayers
            ? strategyAlignmentResult.alignedLayers
                .filter((l: any) => l.vote === ((form.direction === "BUY_CE" || form.direction === "BULL_SPREAD") ? "BULLISH" : "BEARISH"))
                .map((l: any) => l.layerName)
            : [],
          spotPrice: currentSpot,
          volatility: probabilityResult?.volatilityScore ?? 50,
          bullishScore,
          bearishScore,
          spot: currentSpot,
          putWall: support,
          callWall: resistance,
          low5m: parentRange15mResult?.low5m ?? range15m?.low ?? 0,
          high5m: parentRange15mResult?.high5m ?? range15m?.high ?? 0,
          low15m: parentRange15mResult?.low15m ?? range15m?.low ?? 0,
          high15m: parentRange15mResult?.high15m ?? range15m?.high ?? 0,
          delta: deltaVal,
          gamma: gammaVal,
          theta: thetaVal,
          vega: vegaVal,
          iv: ivVal,
          velocity: aiAnalysis?.report?.speed?.velocity ?? 0,
          priceActionGrade: aiAnalysis?.report?.speed?.priceActionGrade ?? "WEAK",
          marketState: aiAnalysis?.report?.speed?.marketState ?? "SLOW_MARKET",
          netCeBuildup: aiAnalysis?.report?.oi?.netCeBuildup ?? "NONE",
          netPeBuildup: aiAnalysis?.report?.oi?.netPeBuildup ?? "NONE",
          advances: advances,
          declines: declines
        }
      }),
    };

    try {
      const res = await fetch(getApiUrl("/api/te/paper-trades"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTrade),
      });
      if (res.ok) {
        await loadAll();
        setShowForm(false);
        setForm({ direction: "BUY_CE", strike: "", entry_price: "", qty: "1", stop_loss: "", target: "", notes: "" });
      }
    } catch (e) {
      console.error("Failed to place manual trade:", e);
    }
  };

  // ── Close Trade Manual ────────────────────────────────────────────────────
  const closeTrade = async (trade: TEPaperTrade) => {
    const exitP = parseFloat(closePrice);
    if (!exitP) { alert("Enter exact exit premium price"); return; }

    const pnl = (exitP - trade.entry_price) * trade.qty * trade.lot_size;

    try {
      const res = await fetch(getApiUrl("/api/te/paper-trades/close"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trade.id, exit_price: exitP, pnl }),
      });
      if (res.ok) {
        await loadAll();
        setClosingId(null);
        setClosePrice("");
      }
    } catch (e) {
      console.error("Failed to close paper trade:", e);
    }
  };

  // ── Delete Trade Manual ──────────────────────────────────────────────────
  const deleteTrade = async (id: string) => {
    if (!window.confirm("Confirm delete of this paper trade?")) return;
    try {
      const res = await fetch(getApiUrl(`/api/te/paper-trades/${id}`), { method: "DELETE" });
      if (res.ok) {
        await loadAll();
      }
    } catch (e) {
      console.error("Failed to delete trade:", e);
    }
  };

  const displayedTrades = useMemo(() => {
    const raw = trades
      .filter(t => t.status === activeTab && t.instrument === activePage && isNakedTrade(t))
      .sort((a, b) => b.timestamp - a.timestamp);

    if (activeTab === "CLOSED") return raw;

    return raw.map(pos => {
      const currentPremium = computeLivePremium(pos, optionChain ?? [], activePage, currentSpot);
      const livePnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;

      return {
        ...pos,
        currentPremium,
        livePnl: parseFloat(livePnl.toFixed(1)),
      };
    });
  }, [trades, activeTab, activePage, optionChain]);

  return (
    <div className="p-4 space-y-6" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/40 pb-4">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <BookOpen size={18} className="text-indigo-400" /> Virtual Paper Trading Engine
          </h1>
          <p className="text-base text-slate-500 mt-0.5">
            Automatic & manual paper simulation environment · {activePage} Instruments
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          <button onClick={loadAll} className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 cursor-pointer transition-colors">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setManualTerminalOpen(t => !t)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-indigo-500/30 hover:bg-indigo-500/5 text-indigo-400 rounded-lg text-base font-black transition-colors cursor-pointer"
          >
            {manualTerminalOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span>Manual Order Terminal</span>
          </button>
        </div>
      </div>

      {/* ── CONSOLIDATED SUB-TABS SELECTOR ── */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {[
      { id: "AUTO_DISPATCHER",  label: "🤖 AI Auto Dispatcher" },
          { id: "MICRO_SCALP",      label: "⚡ Micro Scalp Engine" },
          { id: "MANUAL_TRADING",   label: "📈 Manual Order & Journal" },
          { id: "ORB_AUTOMATION",   label: "🎯 ORB Naked Auto" },
          { id: "AUTO_CONSOLE",     label: "📊 Auto Console & Reports" }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setTerminalSubTab(tab.id as any)}
            className={`px-4 py-2 text-sm font-black rounded-lg transition-all cursor-pointer border
              ${terminalSubTab === tab.id
                ? "bg-indigo-600/25 border-indigo-500 text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.2)]"
                : "border-slate-800 text-slate-450 hover:text-slate-200 hover:bg-slate-900/40"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── SUB-TAB CONTENTS ── */}
      {terminalSubTab === "AUTO_DISPATCHER" && (
        <AutoStrategyTab
          socket={socket}
          spotPrice={currentSpot}
          indexSymbol={activePage}
          indiaVix={indiaVix ?? 0}
          pcr={pcr}
          optionChain={(optionChain ?? []).map((s: any) => ({
            strikePrice: s.strikePrice,
            ceLtp: s.ceLtp ?? 0,
            peLtp: s.peLtp ?? 0,
            ceOI: s.ceOI ?? 0,
            peOI: s.peOI ?? 0,
          }))}
          isMarketOpen={true} // Bypassed per user request so it trades anytime
          aiConfidence={parentAiDecisionResult?.decisionConfidence ?? 75}
          aiDirection={(parentAiDecisionResult?.finalDecision ?? "WAIT") as any}
          regime={regimeResult?.regime ?? "RANGE"}
          sessionType={marketTimeResult?.sessionType ?? "MID"}
          smartMoneyScore={smartMoneyResult?.smartMoneyScore ?? 50}
          alignmentScore={strategyAlignmentResult?.alignmentScore ?? 50}
          breadthScore={breadthResult?.breadthScore ?? 50}
          rangeBreakout={range15mResult?.rangeBreakout ?? false}
          rangeBreakdown={range15mResult?.rangeBreakdown ?? false}
          momentumExhaustion={momentumResult?.exhaustion?.bullish || momentumResult?.exhaustion?.bearish || false}
          isExpiryDay={marketTimeResult?.isExpiryDay ?? false}
          candles5m={candles5m}
          prevClose={prevClose || undefined}
          momentumScore={momentumResult?.momentumScore}
          patternScore={aiAnalysis?.consensusConfidence}
          probabilityScore={probabilityResult?.confidenceLevel}
          entryZoneScore={entryZoneResult?.confidence}
          aiAnalysis={aiAnalysis}
          scoreBackup={scoreBackup}
        />
      )}

      {terminalSubTab === "ORB_AUTOMATION" && (
        <ORBAutomationTab
          socket={socket}
          niftyOptionChain={niftyOptionChain}
          sensexOptionChain={sensexOptionChain}
          bankniftyOptionChain={bankniftyOptionChain}
        />
      )}

      {/* ── MICRO SCALP ENGINE PANEL ──────────────────────────────────────── */}
      {terminalSubTab === "MICRO_SCALP" && (
        <div className="space-y-4">
          {/* Header + Score Bar */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                  <Zap size={18} className="text-violet-400" />
                </div>
                <div>
                  <h2 className="text-base font-black text-white uppercase tracking-wider">⚡ Micro Scalp Engine</h2>
                  <p className="text-xs text-slate-500 font-mono">Unified Probability Score + 11 Scalp Types • ₹50 Brokerage Auto-Deducted</p>
                </div>
              </div>
              {/* Probability Score Ring */}
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center">
                  <div className={`text-4xl font-black font-mono ${
                    microScalpLive.probabilityScore >= 80 ? "text-emerald-400" :
                    microScalpLive.probabilityScore >= 65 ? "text-lime-400" :
                    microScalpLive.probabilityScore >= 50 ? "text-amber-400" :
                    "text-slate-500"
                  }`}>
                    {microScalpLive.probabilityScore}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono uppercase">Score /100</div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className={`px-3 py-1 rounded-full text-xs font-black uppercase border ${
                    microScalpLive.signal?.grade === "PREMIUM" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" :
                    microScalpLive.signal?.grade === "STRONG"  ? "bg-lime-500/20 border-lime-500/40 text-lime-300" :
                    microScalpLive.signal?.grade === "MICRO"   ? "bg-amber-500/20 border-amber-500/40 text-amber-300" :
                    "bg-slate-800 border-slate-700 text-slate-500"
                  }`}>
                    {microScalpLive.signal?.grade ?? "NO SIGNAL"}
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-black uppercase border ${
                    microScalpLive.dominantDirection === "CE" ? "bg-blue-500/20 border-blue-500/40 text-blue-300" :
                    microScalpLive.dominantDirection === "PE" ? "bg-red-500/20 border-red-500/40 text-red-300" :
                    "bg-slate-800 border-slate-700 text-slate-500"
                  }`}>
                    {microScalpLive.dominantDirection === "CE" ? "🟢 BUY CE" :
                     microScalpLive.dominantDirection === "PE" ? "🔴 BUY PE" : "⚪ WAIT"}
                  </div>
                </div>
              </div>
            </div>

            {/* Score Progress Bar */}
            <div className="space-y-1.5 mb-4">
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>NO TRADE</span>
                <span>MICRO SCALP</span>
                <span>STRONG</span>
                <span>PREMIUM</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    microScalpLive.probabilityScore >= 80 ? "bg-gradient-to-r from-emerald-500 to-emerald-400" :
                    microScalpLive.probabilityScore >= 65 ? "bg-gradient-to-r from-lime-500 to-lime-400" :
                    microScalpLive.probabilityScore >= 50 ? "bg-gradient-to-r from-amber-500 to-amber-400" :
                    microScalpLive.probabilityScore >= 35 ? "bg-gradient-to-r from-orange-600 to-orange-500" :
                    "bg-slate-700"
                  }`}
                  style={{ width: `${microScalpLive.probabilityScore}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-600">
                <span>0</span><span>35</span><span>50</span><span>65</span><span>80</span><span>100</span>
              </div>
            </div>

            {/* Daily Stats Bar */}
            <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-800">
              <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-500 font-mono uppercase">Daily P&L</div>
                <div className={`text-sm font-black font-mono ${stats.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {stats.totalPnl >= 0 ? "+" : ""}₹{stats.totalPnl.toFixed(0)}
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-500 font-mono uppercase">Trades Left</div>
                <div className="text-sm font-black font-mono text-slate-300">
                  {microScalpLive.dailyStats.tradesRemaining}/15
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-500 font-mono uppercase">Open Pos</div>
                <div className="text-sm font-black font-mono text-slate-300">{stats.open}</div>
              </div>
              <div className={`rounded-lg p-2 text-center ${microScalpLive.dailyStats.circuitBreakerHit ? "bg-rose-500/20 border border-rose-500/30" : "bg-slate-900/60"}`}>
                <div className="text-[10px] text-slate-500 font-mono uppercase">Circuit</div>
                <div className={`text-xs font-black font-mono ${microScalpLive.dailyStats.circuitBreakerHit ? "text-rose-400" : "text-emerald-400"}`}>
                  {microScalpLive.dailyStats.circuitBreakerHit ? "🔴 TRIPPED" : "🟢 OK"}
                </div>
              </div>
            </div>
          </div>

          {/* Block Reasons / Alerts */}
          {!microScalpLive.tradeAllowed && microScalpLive.blockReasons.length > 0 && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-1.5">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={14} className="text-rose-400" />
                <span className="text-xs font-black uppercase text-rose-400">Trading Blocked</span>
              </div>
              {microScalpLive.blockReasons.map((r, i) => (
                <div key={i} className="text-xs font-mono text-rose-300 flex items-start gap-2">
                  <span className="text-rose-500 mt-0.5">▸</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}

          {/* Top Active Signal */}
          {microScalpLive.signal && microScalpLive.tradeAllowed && (
            <div className={`rounded-xl border p-5 ${
              microScalpLive.signal.grade === "PREMIUM" ? "border-emerald-500/40 bg-emerald-500/5" :
              microScalpLive.signal.grade === "STRONG"  ? "border-lime-500/40 bg-lime-500/5" :
              "border-amber-500/40 bg-amber-500/5"
            }`}>
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 rounded bg-violet-500/20">
                      <Activity size={13} className="text-violet-400" />
                    </div>
                    <span className="text-xs font-black uppercase text-violet-300 tracking-wider">
                      🎯 TOP SIGNAL — {microScalpLive.signal.scalpType.replace(/_/g, " ")}
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      microScalpLive.signal.grade === "PREMIUM" ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" :
                      "border-lime-500/40 text-lime-300 bg-lime-500/10"
                    }`}>{microScalpLive.signal.grade}</span>
                  </div>

                  {/* Signal Details Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <div className="bg-slate-900/60 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-mono">DIRECTION</div>
                      <div className={`text-sm font-black ${microScalpLive.signal.direction === "CE" ? "text-blue-400" : microScalpLive.signal.direction === "PE" ? "text-red-400" : "text-amber-400"}`}>
                        {microScalpLive.signal.direction === "CE" ? "🟢 BUY CE" : microScalpLive.signal.direction === "PE" ? "🔴 BUY PE" : "🟡 HEDGE"}
                      </div>
                    </div>
                    <div className="bg-slate-900/60 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-mono">LOTS</div>
                      <div className="text-sm font-black text-white">{microScalpLive.signal.recommendedLots} lot{microScalpLive.signal.recommendedLots > 1 ? "s" : ""}</div>
                    </div>
                    <div className="bg-slate-900/60 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-mono">SL / TGT</div>
                      <div className="text-sm font-black text-white font-mono">
                        -₹{microScalpLive.signal.slPremiumDrop} / +₹{microScalpLive.signal.targetPremiumMove}
                      </div>
                    </div>
                    <div className="bg-slate-900/60 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-mono">MAX HOLD</div>
                      <div className="text-sm font-black text-slate-300">{microScalpLive.signal.maxHoldMinutes} min</div>
                    </div>
                  </div>

                  {/* P&L Estimate */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                    <DollarSign size={13} className="text-amber-400 shrink-0" />
                    <div className="flex items-center gap-4 flex-wrap">
                      <div>
                        <span className="text-[10px] text-slate-500 font-mono">GROSS P&L</span>
                        <span className="text-sm font-black text-emerald-400 font-mono ml-2">+₹{microScalpLive.signal.grossPnlEstimate.toFixed(0)}</span>
                      </div>
                      <div className="text-slate-700">|</div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-mono">BROKERAGE</span>
                        <span className="text-sm font-black text-rose-400 font-mono ml-2">-₹50</span>
                      </div>
                      <div className="text-slate-700">|</div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-mono">NET P&L EST</span>
                        <span className={`text-sm font-black font-mono ml-2 ${microScalpLive.signal.netPnlEstimate >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {microScalpLive.signal.netPnlEstimate >= 0 ? "+" : ""}₹{microScalpLive.signal.netPnlEstimate.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Reasons */}
                  <div className="mt-3 space-y-1">
                    {microScalpLive.signal.reasons.map((r, i) => (
                      <div key={i} className="text-[11px] text-slate-400 font-mono flex items-start gap-2">
                        <span className="text-violet-500 mt-0.5">▸</span><span>{r}</span>
                      </div>
                    ))}
                  </div>

                  {/* Exit Mode Tip */}
                  {(microScalpLive.signal as any).exitModeLabel && (
                    <div className={`mt-2 px-3 py-1.5 rounded-lg text-[11px] font-mono flex items-center gap-2 ${
                      (microScalpLive.signal as any).exitMode === "FULL"
                        ? "bg-violet-500/10 border border-violet-500/20 text-violet-300"
                        : "bg-cyan-500/10 border border-cyan-500/20 text-cyan-300"
                    }`}>
                      <span>{(microScalpLive.signal as any).exitMode === "FULL" ? "🚀" : "⚡"}</span>
                      <span>{(microScalpLive.signal as any).exitModeLabel}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* All Active Signals */}
          {microScalpLive.allSignals.length > 1 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 size={13} className="text-slate-400" />
                <span className="text-xs font-black uppercase text-slate-400 tracking-wider">
                  All Active Signals ({microScalpLive.allSignals.length})
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {microScalpLive.allSignals.slice(1).map((sig, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-800/60 bg-slate-900/40">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        sig.direction === "CE" ? "border-blue-500/30 text-blue-300 bg-blue-500/10" :
                        sig.direction === "PE" ? "border-red-500/30 text-red-300 bg-red-500/10" :
                        "border-amber-500/30 text-amber-300 bg-amber-500/10"
                      }`}>{sig.direction}</span>
                      <span className="text-[11px] text-slate-300 font-mono">{sig.scalpType.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-black font-mono ${
                        sig.netPnlEstimate >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}>Net ₹{sig.netPnlEstimate.toFixed(0)}</span>
                      <span className={`text-[10px] font-black font-mono px-1.5 rounded ${
                        sig.probabilityScore >= 65 ? "text-lime-400 bg-lime-500/10" : "text-amber-400 bg-amber-500/10"
                      }`}>{sig.probabilityScore}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score Breakdown */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
            <div className="text-xs font-black uppercase text-slate-400 tracking-wider mb-3">📊 Score Breakdown</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Base Prob", val: microScalpLive.scoreBreakdown.base, color: "blue" },
                { label: "Regime", val: microScalpLive.scoreBreakdown.regimeBonus, color: "violet" },
                { label: "Smart Money", val: microScalpLive.scoreBreakdown.smartMoneyBonus, color: "indigo" },
                { label: "Momentum", val: microScalpLive.scoreBreakdown.momentumBonus, color: "cyan" },
                { label: "Breadth", val: microScalpLive.scoreBreakdown.breadthBonus, color: "teal" },
                { label: "Trap Clear", val: microScalpLive.scoreBreakdown.trapClearBonus, color: "emerald" },
                { label: "Volume", val: microScalpLive.scoreBreakdown.volumeBonus, color: "lime" },
                { label: "OI Wall", val: microScalpLive.scoreBreakdown.oiWallBonus, color: "amber" },
                { label: "RTPODE", val: microScalpLive.scoreBreakdown.rtpodeBonus, color: "orange" },
                { label: "Trap Penalty", val: microScalpLive.scoreBreakdown.trapPenalty, color: "rose" },
                { label: "Cooldown", val: microScalpLive.scoreBreakdown.cooldownPenalty, color: "red" },
                { label: "Divergence", val: microScalpLive.scoreBreakdown.divergencePenalty, color: "pink" },
              ].map((item, i) => (
                <div key={i} className="bg-slate-900/60 rounded p-2">
                  <div className="text-[9px] text-slate-500 font-mono uppercase">{item.label}</div>
                  <div className={`text-sm font-black font-mono ${item.val > 0 ? "text-emerald-400" : item.val < 0 ? "text-rose-400" : "text-slate-500"}`}>
                    {item.val > 0 ? "+" : ""}{item.val.toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800 flex justify-between items-center">
              <span className="text-xs font-mono text-slate-500">TOTAL SCORE</span>
              <span className={`text-2xl font-black font-mono ${
                microScalpLive.scoreBreakdown.total >= 65 ? "text-emerald-400" :
                microScalpLive.scoreBreakdown.total >= 50 ? "text-amber-400" : "text-slate-500"
              }`}>{microScalpLive.scoreBreakdown.total} / 100</span>
            </div>
          </div>
        </div>
      )}

      {terminalSubTab === "MANUAL_TRADING" && (
        <div className="space-y-6">
          {/* ── CAPITAL + ACTIVE TRADE DASHBOARD ─────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Capital */}
            <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/30 to-slate-900/60 p-4">
              <div className="text-[10px] text-slate-500 font-mono uppercase mb-1">Starting Capital</div>
              <div className="text-2xl font-black text-indigo-300 font-mono">₹{INITIAL_CAPITAL.toLocaleString()}</div>
              <div className="text-[10px] text-slate-600 font-mono mt-1">Fixed · ₹15,000</div>
            </div>
            {/* Available */}
            <div className={`rounded-xl border p-4 bg-gradient-to-br from-slate-900/60 to-slate-950/40 ${stats.availableCapital >= INITIAL_CAPITAL ? "border-emerald-500/30" : "border-rose-500/30"}`}>
              <div className="text-[10px] text-slate-500 font-mono uppercase mb-1">Available Capital</div>
              <div className={`text-2xl font-black font-mono ${stats.availableCapital >= INITIAL_CAPITAL ? "text-emerald-400" : "text-rose-400"}`}>
                ₹{Math.max(0, stats.availableCapital).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-600 font-mono mt-1">After margin & P&L</div>
            </div>
            {/* Today P&L */}
            <div className={`rounded-xl border p-4 bg-gradient-to-br from-slate-900/60 to-slate-950/40 ${stats.totalPnl >= 0 ? "border-emerald-500/30" : "border-rose-500/30"}`}>
              <div className="text-[10px] text-slate-500 font-mono uppercase mb-1">Today's P&L</div>
              <div className={`text-2xl font-black font-mono ${stats.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {stats.totalPnl >= 0 ? "+" : ""}₹{stats.totalPnl.toFixed(0)}
              </div>
              <div className="text-[10px] text-slate-600 font-mono mt-1">{stats.wins}W / {stats.losses}L · {stats.winRate.toFixed(0)}% win rate</div>
            </div>
            {/* Open Positions */}
            <div className={`rounded-xl border p-4 bg-gradient-to-br from-slate-900/60 to-slate-950/40 ${stats.open > 0 ? "border-amber-500/30" : "border-slate-800"}`}>
              <div className="text-[10px] text-slate-500 font-mono uppercase mb-1">Open Position</div>
              <div className={`text-2xl font-black font-mono ${stats.open > 0 ? "text-amber-400" : "text-slate-500"}`}>
                {stats.open} / 1
              </div>
              <div className="text-[10px] text-slate-600 font-mono mt-1">Max 1 at a time</div>
            </div>
          </div>

          {/* ── ACTIVE OPEN TRADE (1 at a time) ──────────────────────────────── */}
          {(() => {
            const openTrades = trades.filter(t => t.status === "OPEN" && isNakedTrade(t));
            if (openTrades.length === 0) return (
              <div className="rounded-xl border border-slate-800 bg-slate-950/20 p-5 text-center">
                <div className="text-slate-500 font-mono text-sm">⏳ No open position right now</div>
                <div className="text-slate-600 font-mono text-xs mt-1">System will enter when signal aligns</div>
              </div>
            );
            const pos = openTrades[0];
            const currentPremium = computeLivePremium(pos, optionChain ?? [], activePage, currentSpot);
            const livePnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;
            const isProfit = livePnl >= 0;
            return (
              <div className={`rounded-xl border p-5 ${isProfit ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-sm font-black text-white uppercase tracking-wider">
                      🔴 ACTIVE TRADE — {pos.direction === "BUY_CE" ? "BUY CE" : "BUY PE"}
                    </span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${pos.direction === "BUY_CE" ? "border-blue-500/30 text-blue-300 bg-blue-500/10" : "border-red-500/30 text-red-300 bg-red-500/10"}`}>
                      {pos.instrument}
                    </span>
                  </div>
                  <div className={`text-2xl font-black font-mono ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                    {isProfit ? "+" : ""}₹{livePnl.toFixed(0)}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div className="bg-slate-900/60 rounded p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-mono">STRIKE</div>
                    <div className="text-sm font-black text-white font-mono">{pos.strike}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-mono">ENTRY</div>
                    <div className="text-sm font-black text-slate-200 font-mono">₹{pos.entry_price.toFixed(1)}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-mono">LIVE</div>
                    <div className={`text-sm font-black font-mono ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>₹{currentPremium.toFixed(1)}</div>
                  </div>
                  <div className="bg-slate-900/60 rounded p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-mono">QTY × LOT</div>
                    <div className="text-sm font-black text-slate-200 font-mono">{pos.qty} × {pos.lot_size}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-rose-950/30 border border-rose-500/20 rounded p-2 text-center">
                    <div className="text-[9px] text-rose-400 font-mono">STOP LOSS</div>
                    <div className="text-sm font-black text-rose-300 font-mono">₹{pos.stop_loss.toFixed(1)}</div>
                  </div>
                  <div className="bg-emerald-950/30 border border-emerald-500/20 rounded p-2 text-center">
                    <div className="text-[9px] text-emerald-400 font-mono">TARGET</div>
                    <div className="text-sm font-black text-emerald-300 font-mono">₹{pos.target.toFixed(1)}</div>
                  </div>
                </div>
                {pos.strategyName && (
                  <div className="mt-3 text-[10px] font-mono text-slate-500 flex items-center gap-2">
                    <span className="text-violet-500">▸</span>
                    <span>Strategy: {pos.strategyName}</span>
                    <span className="text-slate-700">·</span>
                    <span>At: {new Date(pos.timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                )}
                {/* Close this trade */}
                <div className="mt-4 flex items-center gap-2">
                  <input
                    type="number"
                    value={closingId === pos.id ? closePrice : ""}
                    onChange={e => { setClosingId(pos.id); setClosePrice(e.target.value); }}
                    placeholder="Exit premium ₹"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white font-mono outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => closeTrade(pos)}
                    className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-sm font-black transition-colors cursor-pointer"
                  >
                    Close Trade
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── TODAY'S TRADE HISTORY ──────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/20 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-slate-400" />
                <span className="text-xs font-black uppercase text-slate-300 tracking-wider">Today's Trades</span>
              </div>
              <span className="text-xs font-mono text-slate-500">{stats.todayClosed?.length ?? 0} closed · {stats.open} open</span>
            </div>
            {(!stats.todayClosed || stats.todayClosed.length === 0) ? (
              <div className="text-center py-4 text-slate-600 font-mono text-xs">No closed trades today</div>
            ) : (
              <div className="space-y-2">
                {(stats.todayClosed ?? []).slice().reverse().map((t: TEPaperTrade) => {
                  const isW = t.pnl > 0;
                  return (
                    <div key={t.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${isW ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5"}`}>
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded font-mono ${t.direction === "BUY_CE" ? "bg-blue-500/20 text-blue-300" : "bg-red-500/20 text-red-300"}`}>
                          {t.direction === "BUY_CE" ? "CE" : "PE"}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">₹{t.strike} · Entry ₹{t.entry_price.toFixed(1)} → Exit ₹{(t.exit_price ?? 0).toFixed(1)}</span>
                        {t.strategyName && <span className="text-[10px] text-slate-600 font-mono hidden md:block">{t.strategyName}</span>}
                      </div>
                      <div className={`text-sm font-black font-mono ${isW ? "text-emerald-400" : "text-rose-400"}`}>
                        {isW ? "+" : ""}₹{t.pnl.toFixed(0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── MANUAL TERMINAL ─────────────────────────────────────────────── */}
          <div className="border border-slate-800/80 rounded-xl bg-slate-950/20 overflow-hidden">
            <button
              onClick={() => setManualTerminalOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <PlusCircle size={15} className="text-indigo-400" />
                <h2 className="text-base font-black uppercase tracking-wider text-slate-300">
                  Manual Order Entry
                </h2>
                {stats.open >= 1 && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-2 py-0.5 font-mono">
                    1 position open — close first
                  </span>
                )}
              </div>
              <span className="text-sm text-slate-500 font-mono">
                {manualTerminalOpen ? "[- CLOSE]" : "[+ OPEN]"}
              </span>
            </button>

            {manualTerminalOpen && (
              <div className="p-5 border-t border-slate-800/60 space-y-5 bg-[#0a0f1e]/40">
                {/* Header info */}

                <div className="flex items-center justify-between">
                  <div className="text-base text-slate-400">
                    Setup manual orders directly onto the database ledger. Current Lot Size: <span className="text-indigo-400 font-bold">{currentLotSize}</span>
                  </div>
                  <button
                    onClick={() => setShowForm(f => !f)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-black transition-colors cursor-pointer"
                  >
                    <PlusCircle size={11} /> New Manual Trade
                  </button>
                </div>

                {/* New Trade Form */}
                {showForm && (
                  <div className="rounded-xl border border-indigo-500/20 bg-slate-950/60 p-4 space-y-4">
                    <div className="text-base font-black text-slate-200">Submit Manual Entry Details</div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div>
                        <label className="text-sm text-slate-500 uppercase font-black mb-1 block">Direction</label>
                        <div className="flex gap-1">
                          {(["BUY_CE", "BUY_PE"] as const).map(d => (
                            <button key={d} onClick={() => setForm(f => ({ ...f, direction: d }))}
                              className={`flex-1 py-1.5 rounded text-sm font-black transition-all cursor-pointer
                                ${form.direction === d
                                  ? d === "BUY_CE" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                                  : "bg-slate-850 text-slate-500 hover:bg-slate-800"}`}>
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                      <FormField label="Strike" value={form.strike} onChange={v => setForm(f => ({ ...f, strike: v }))} placeholder="e.g. 23500" />
                      <FormField label="Entry Price (₹)" value={form.entry_price} onChange={v => setForm(f => ({ ...f, entry_price: v }))} placeholder="e.g. 105" />
                      <FormField label="Qty (lots)" value={form.qty} onChange={v => setForm(f => ({ ...f, qty: v }))} placeholder="1" />
                      <FormField label="Stop Loss (₹)" value={form.stop_loss} onChange={v => setForm(f => ({ ...f, stop_loss: v }))} placeholder="Optional" />
                      <FormField label="Target (₹)" value={form.target} onChange={v => setForm(f => ({ ...f, target: v }))} placeholder="Optional" />
                      <div className="col-span-1 md:col-span-2">
                        <label className="text-sm text-slate-500 uppercase font-black mb-1 block">Trade Execution Notes</label>
                        <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500 transition-colors"
                          placeholder="Why entering manual execution?" />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 cursor-pointer">Cancel</button>
                      <button onClick={placeTrade}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-black transition-colors cursor-pointer">
                        Place Manual Order
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-tabs inside manual journal */}
                <div className="flex gap-1 border-b border-slate-900">
                  {(["OPEN", "CLOSED"] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1.5 text-sm font-black transition-colors cursor-pointer border-b-2 -mb-px
                        ${activeTab === tab ? "text-indigo-400 border-indigo-500" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
                      {tab} Positions ({trades.filter(t => t.status === tab && t.instrument === activePage && isNakedTrade(t)).length})
                    </button>
                  ))}
                </div>

                {/* Trades Table List */}
                <div className="rounded-lg border border-slate-900/60 bg-slate-950/40 overflow-hidden">
                  {displayedTrades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-600">
                      <BookOpen size={20} className="mb-1 opacity-20" />
                      <div className="text-sm font-mono italic">No {activeTab.toLowerCase()} manual records on {activePage}</div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm font-mono">
                        <thead>
                          <tr className="border-b border-slate-900 text-sm text-slate-500 uppercase">
                            <th className="p-2 pl-3 text-left">Time</th>
                            <th className="p-2 text-left">Dir</th>
                            <th className="p-2 text-right">Strike</th>
                            <th className="p-2 text-right">Entry</th>
                            <th className="p-2 text-right">Qty</th>
                            <th className="p-2 text-right">SL</th>
                            <th className="p-2 text-right">Target</th>
                            {activeTab === "CLOSED" && <th className="p-2 text-right">Exit</th>}
                            <th className="p-2 text-right">P&L</th>
                            <th className="p-2 pr-3 text-right">Delete</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900/60">
                          {displayedTrades.map((t) => (
                            <React.Fragment key={t.id}>
                              <tr className="hover:bg-slate-900/20 text-slate-300">
                                <td className="p-2 pl-3 text-slate-500">
                                  {new Date(t.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} {new Date(t.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </td>
                                <td className="p-2">
                                  <span className={`text-sm font-black px-1 rounded
                                    ${t.direction === "BUY_CE" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                                    {t.direction.replace("BUY_", "")}
                                  </span>
                                </td>
                                <td className="p-2 text-right">{t.strike}</td>
                                <td className="p-2 text-right font-bold text-white">₹{t.entry_price}</td>
                                <td className="p-2 text-right text-slate-400">{t.qty} × {t.lot_size}</td>
                                <td className="p-2 text-right text-red-400">₹{t.stop_loss}</td>
                                <td className="p-2 text-right text-emerald-400">₹{t.target}</td>
                                {activeTab === "CLOSED" && <td className="p-2 text-right text-white">₹{t.exit_price}</td>}
                                <td className="p-2 text-right">
                                  <span className={`font-black ${(t.livePnl ?? t.pnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {(t.livePnl ?? t.pnl) >= 0 ? "+" : ""}₹{(t.livePnl ?? t.pnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                                  </span>
                                </td>
                                <td className="p-2 pr-3 text-right font-mono">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => setSelectedTradeForDetails(t)}
                                      className="px-2 py-0.5 bg-blue-500/10 hover:bg-blue-500/25 border border-blue-500/20 text-blue-400 rounded text-sm font-black cursor-pointer transition-colors"
                                    >
                                      Details
                                    </button>
                                    {t.status === "OPEN" && (
                                      <button
                                        onClick={() => setClosingId(closingId === t.id ? null : t.id)}
                                        className="px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/20 text-amber-400 rounded text-sm font-black cursor-pointer transition-colors"
                                      >
                                        Close
                                      </button>
                                    )}
                                    <button
                                      onClick={() => deleteTrade(t.id)}
                                      className="text-slate-655 hover:text-red-400 cursor-pointer transition-colors"
                                    >
                                      <X size={10} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {/* Closing slider modal inline */}
                              {closingId === t.id && (
                                <tr className="bg-amber-500/5">
                                  <td colSpan={10} className="px-3 py-2">
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm text-amber-400 font-black">Close Price:</span>
                                      <input type="number" value={closePrice} onChange={e => setClosePrice(e.target.value)}
                                        className="w-20 bg-slate-900 border border-amber-500/20 rounded px-2 py-1 text-sm text-white outline-none focus:border-amber-500"
                                        placeholder="Premium" autoFocus />
                                      <button onClick={() => closeTrade(t)} className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-black cursor-pointer">Confirm Close</button>
                                      <button onClick={() => setClosingId(null)} className="text-slate-500 hover:text-slate-350 cursor-pointer text-sm">Cancel</button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {terminalSubTab === "AUTO_CONSOLE" && (
        <div className="space-y-6">
          {/* ── LAYER 14: AUTOMATED PAPER TRADING CONSOLE ─────────────────────── */}
          <PaperTradingCard
            activePage={activePage}
            spotPrice={currentSpot}
            entryZoneResult={entryZoneResult}
            strategyAlignmentResult={strategyAlignmentResult}
            aiDecisionResult={aiDecisionResult}
            opportunityResult={opportunityResult}
            strategiesResult={strategiesResult}
            dbTrades={trades}
            optionChain={optionChain ?? []}
            onTradePlaced={loadAll}
            marketTimeResult={marketTimeResult}
            momentumResult={momentumResult}
            smartMoneyResult={smartMoneyResult}
            volatilityScore={probabilityResult.volatilityScore}
            riskResult={riskResult}
          />

          {/* ── LAYER 15, 16 & 17: PERFORMANCE, RISK & INSTITUTIONAL MACRO ───────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* L15 Card */}
            <PerformanceCard
              activePage={activePage}
              paperTradingOutput={paperTradingResult}
              dbTrades={trades}
            />

            {/* L16 Card */}
            <RiskCard
              activePage={activePage}
              spotPrice={currentSpot}
              paperTradingOutput={paperTradingResult}
              performanceResult={performanceResult}
              indiaVix={indiaVix}
              regimeType={regimeResult.regime}
              aiConfidence={aiDecisionResult.decisionConfidence}
            />

            {/* L17 Card */}
            <InstitutionalMacroCard
              fiiDiiHistory={fiiDiiHistory}
              macroResult={macroResult}
              onRefresh={loadAll}
            />
          </div>

          {/* ── STICKY BOTTOM-LEFT HUD: LIVE ALERTS AND PIPELINE SIGNALS ───────── */}
          <LiveSignalFeedCard
            activePage={activePage}
            spotPrice={currentSpot}
            marketTimeResult={marketTimeResult}
            riskResult={riskResult}
            aiDecisionResult={aiDecisionResult}
            strategiesResult={strategiesResult}
            openPositions={openPositionsWithLtp}
            dbTrades={trades}
            optionChain={optionChain}
            probabilityResult={probabilityResult}
          />
        </div>
      )}

      {selectedTradeForDetails && (
        <TradeDetailsModal
          trade={selectedTradeForDetails}
          onClose={() => setSelectedTradeForDetails(null)}
          darkMode={true}
        />
      )}
    </div>
  );
};

// Sub-components helpers
const FormField: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({
  label, value, onChange, placeholder
}) => (
  <div>
    <label className="text-sm text-slate-500 uppercase font-black mb-1 block">{label}</label>
    <input type="number" value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500 transition-colors"
      placeholder={placeholder} />
  </div>
);

export default PaperTrading;

