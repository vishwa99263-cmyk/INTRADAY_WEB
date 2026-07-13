/**
 * MyPaperTrading.tsx — Manual Virtual Paper Trading Dashboard
 * Housed on the main router's MY_PAPER_TRADING tab.
 * Copy of PaperTrading.tsx with AI disabled, separate trades, and custom header.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BookOpen, PlusCircle, X, TrendingUp, TrendingDown,
  RefreshCw, CheckCircle, AlertCircle, DollarSign, Target, Shield, ChevronDown, ChevronUp
} from "lucide-react";
import type { OptionStrike, TEPaperTrade } from "../../../types";

// Import Layer Cards
import PaperTradingCard from "./PaperTradingCard";
import PerformanceCard from "./PerformanceCard";
import RiskCard from "./RiskCard";
import LiveSignalFeedCard from "./LiveSignalFeedCard";

// Import Layer Computations
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

interface Props {
  activePage: "NIFTY" | "SENSEX";
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
  onPageChange?: (page: any) => void;
}

interface LotConfig {
  instrument: string;
  lot_size: number;
  updated_at: number;
}

const INITIAL_CAPITAL = 15000; // ₹15,000

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

const MyPaperTrading: React.FC<Props> = (props) => {
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
    onPageChange,
  } = props;

  // ── Database Sync States ──────────────────────────────────────────────────
  const [trades, setTrades] = useState<TEPaperTrade[]>([]);
  const [lotConfig, setLotConfig] = useState<LotConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"PENDING" | "OPEN" | "CLOSED">("OPEN");
  
  // Manual Terminal UI Expand State
  const [manualTerminalOpen, setManualTerminalOpen] = useState(true); // Open by default for manual paper trading

  // Form State
  const [form, setForm] = useState({
    direction: "BUY_CE" as "BUY_CE" | "BUY_PE",
    strike: "",
    entry_price: "",
    qty: "1",
    stop_loss: "",
    target: "",
    notes: "",
  });

  // Load trades + configuration from DB
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tradesRes, lotRes] = await Promise.all([
        fetch(getApiUrl("/api/te/paper-trades?limit=1000")),
        fetch(getApiUrl("/api/te/lot-config")),
      ]);
      if (tradesRes.ok) {
        const d = await tradesRes.json();
        // ONLY fetch trades belonging to My Paper Trade (starts with my-pt-)
        const filtered = (d.trades || []).filter((t: TEPaperTrade) => t.id.startsWith("my-pt-"));
        setTrades(filtered);
      }
      if (lotRes.ok) {
        const d = await lotRes.json();
        setLotConfig(d.lotConfig || []);
      }
    } catch (e) {
      console.error("Error loading paper trades ledger:", e);
    } finally {
      setLoading(false);
    }
  }, []);

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
      regimeResult,
      breadthResult,
      heavyweightResult,
      range15mResult,
      optionChainResult,
    }),
    [overallScore, score5mNet, score15mNet, agg30mNet, agg1hNet, changePercent, aggVolume,
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

  const probabilityResult = useMemo(() =>
    computeProbability({
      regimeResult, breadthResult, heavyweightResult, range15mResult,
      optionChainResult, momentumResult,
      smartMoneyResult,
      pcr,
      optionChain,
      spotPrice: currentSpot,
      score15mDiff: score5mNet, // Fixed to use score5mNet or score15mNet
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, pcr, optionChain, currentSpot, score5mNet]
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
      indiaVix,
      spotChangePct,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, probabilityResult,
     entryZoneResult, strategyAlignmentResult, indiaVix, spotChangePct]
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

  const paperTradingResult = useMemo(() =>
    computePaperTrading({
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
    }),
    [entryZoneResult, strategyAlignmentResult, aiDecisionResult, opportunityResult, strategiesResult, currentSpot, activePage, trades, marketTimeResult, optionFlowResult, probabilityResult.volatilityScore, optionChain]
  );

  const performanceResult = useMemo(() =>
    computePerformance({
      paperTradingOutput: paperTradingResult,
      dbTrades: trades,
    }),
    [paperTradingResult, trades]
  );

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
      const strikeData = (optionChain ?? []).find((s: any) => s.strikePrice === pos.strike);
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
  }, [paperTradingResult.openPositions, optionChain]);

  // Lot sizes configs
  const currentLotSize = useMemo(() => {
    const row = lotConfig.find(c => c.instrument === activePage);
    return row?.lot_size || (activePage === "NIFTY" ? 65 : 20);
  }, [lotConfig, activePage]);

  // ── Hedge Filter: exclude spread/hedge trades, keep only naked entries ──
  const HEDGE_DIRS = new Set(["BULL_SPREAD", "BEAR_SPREAD"]);
  const isNakedTrade = (t: TEPaperTrade) => !HEDGE_DIRS.has(t.direction) && !(t.notes || "").includes("Spread Hedge");

  // ── Place Trade Manual ────────────────────────────────────────────────────
  const placeTrade = async () => {
    const entryP = parseFloat(form.entry_price);
    const strikeN = parseFloat(form.strike);
    const qty = parseInt(form.qty);
    if (!entryP || !strikeN || !qty) { alert("Please complete: Strike, Entry Price, and Lot Qty"); return; }

    const lot = currentLotSize;
    const sl = parseFloat(form.stop_loss) || entryP * 0.8;
    const tgt = parseFloat(form.target) || entryP * 1.5;

    const newTrade: Omit<TEPaperTrade, "created_at"> = {
      id: `my-pt-manual-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
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
      notes: form.notes || "Manual Trade Entry Console",
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

  const displayedTrades = trades
    .filter(t => t.status === activeTab && t.instrument === activePage && isNakedTrade(t))
    .sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="p-4 space-y-6" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/40 pb-4">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <BookOpen size={18} className="text-emerald-400" /> My Paper Trading Engine
          </h1>
          <p className="text-base text-slate-500 mt-0.5">
            Manual paper simulation environment · {activePage} Instruments
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange?.("PAPER_TRADING")}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-indigo-500/40 hover:bg-indigo-500/10 text-indigo-400 rounded-lg text-base font-black transition-all cursor-pointer shadow-[0_0_10px_rgba(99,102,241,0.1)] hover:shadow-[0_0_15px_rgba(99,102,241,0.2)]"
          >
            <BookOpen size={13} />
            <span>Automated Paper Trade</span>
          </button>
          <button onClick={loadAll} className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 cursor-pointer transition-colors">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setManualTerminalOpen(t => !t)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-500/30 hover:bg-emerald-500/5 text-emerald-400 rounded-lg text-base font-black transition-colors cursor-pointer"
          >
            {manualTerminalOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span>Manual Order Terminal</span>
          </button>
        </div>
      </div>

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
        aiEnabled={false}
      />

      {/* ── COLLAPSIBLE MANUAL TERMINAL ────────────────────────────────────── */}
      <div className="border border-slate-800/80 rounded-xl bg-slate-950/20 overflow-hidden">
        <button
          onClick={() => setManualTerminalOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-900/40 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <PlusCircle size={15} className="text-emerald-400" />
            <h2 className="text-base font-black uppercase tracking-wider text-slate-300">
              Manual Order Entry & Closed Journal Console
            </h2>
          </div>
          <span className="text-sm text-slate-500 font-mono">
            {manualTerminalOpen ? "[- CLOSE TERMINAL]" : "[+ OPEN TERMINAL]"}
          </span>
        </button>

        {manualTerminalOpen && (
          <div className="p-5 border-t border-slate-800/60 space-y-5 bg-[#0a0f1e]/40">
            
            {/* Header info */}
            <div className="flex items-center justify-between">
              <div className="text-base text-slate-400">
                Setup manual orders directly onto the database ledger. Current Lot Size: <span className="text-emerald-400 font-bold">{currentLotSize}</span>
              </div>
              <button
                onClick={() => setShowForm(f => !f)}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-black transition-colors cursor-pointer"
              >
                <PlusCircle size={11} /> New Manual Trade
              </button>
            </div>

            {/* New Trade Form */}
            {showForm && (
              <div className="rounded-xl border border-emerald-500/20 bg-slate-950/60 p-4 space-y-4">
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
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-black transition-colors cursor-pointer">
                    Place Manual Order
                  </button>
                </div>
              </div>
            )}

            {/* Sub-tabs inside manual journal */}
            <div className="flex gap-1 border-b border-slate-900">
              {(["PENDING", "OPEN", "CLOSED"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-sm font-black transition-colors cursor-pointer border-b-2 -mb-px
                    ${activeTab === tab ? "text-emerald-400 border-emerald-500" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
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
                        <th className="p-2 text-left max-w-[200px]">Purpose</th>
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
                            <td className="p-2 text-left max-w-[200px]">
                              <span className="text-slate-400 truncate block cursor-help text-xs" title={t.notes}>{t.notes || "—"}</span>
                            </td>
                            <td className="p-2 text-right">
                              <span className={`font-black ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {t.pnl >= 0 ? "+" : ""}₹{t.pnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                              </span>
                            </td>
                            <td className="p-2 pr-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {t.status === "OPEN" && (
                                  <button
                                    onClick={() => setClosingId(closingId === t.id ? null : t.id)}
                                    className="px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/20 text-amber-400 rounded text-sm font-black cursor-pointer transition-colors"
                                  >
                                    Close
                                  </button>
                                )}
                                {t.status === "PENDING" && (
                                  <button
                                    onClick={() => deleteTrade(t.id)}
                                    className="px-2 py-0.5 bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/20 text-rose-400 rounded text-sm font-black cursor-pointer transition-colors"
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteTrade(t.id)}
                                  className="text-slate-600 hover:text-red-400 cursor-pointer transition-colors"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* Closing slider modal inline */}
                          {closingId === t.id && (
                            <tr className="bg-amber-500/5">
                              <td colSpan={11} className="px-3 py-2">
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

      {/* ── LAYER 15 & 16: PERFORMANCE & RISK ANALYTICS ───────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
      </div>
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

export default MyPaperTrading;
