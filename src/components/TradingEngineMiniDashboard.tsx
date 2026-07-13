import React, { useMemo } from "react";
import { Zap, TrendingUp, TrendingDown, Target, BrainCircuit, Activity, ShieldCheck, CheckCircle2, ChevronRight } from "lucide-react";
import { computeMarketRegime } from "../engine/marketRegimeEngine";
import { computeMomentum } from "../engine/momentumEngine";
import { computeSmartMoney } from "../engine/smartMoneyEngine";
import { computeStrategyAlignment } from "../engine/strategyAlignmentEngine";
import { computeEntryZone } from "../engine/entryZoneEngine";
import { computeAIDecision } from "../engine/aiDecisionEngine";
import { computeRange15M } from "../engine/range15mEngine";
import { computeMarketBreadth } from "../engine/marketBreadthEngine";
import { computeHeavyweight } from "../engine/heavyweightEngine";

interface TradingEngineMiniProps {
  activePage: string;
  currentSpot: number;
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
  darkMode: boolean;
  score30mNet?: number;
  score1hNet?: number;
  totalVolume?: number;
  indiaVix?: number;
  spotChangePct?: number;
  stocks: any[];
  velocity?: number;
}

export default function TradingEngineMiniDashboard({
  activePage,
  currentSpot,
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
  darkMode,
  score30mNet = 0,
  score1hNet = 0,
  totalVolume = 0,
  indiaVix = 15,
  spotChangePct = 0,
  stocks = [],
  velocity = 0
}: TradingEngineMiniProps) {

  // Re-run the engine core logic for the important layers
  const regimeResult = useMemo(() => computeMarketRegime({
    spotPrice: currentSpot, range15mHigh: currentSpot + 50, range15mLow: currentSpot - 50, range15mFallback: true,
    overallScore, score5mNet, score15mNet, top25Score, top25ScoreDiff,
    pcr, advances, declines, t10, t15, support, resistance
  }), [overallScore, score5mNet, score15mNet, top25Score, top25ScoreDiff, pcr, advances, declines, t10, t15, currentSpot, support, resistance]);

  const breadthResult = useMemo(() => computeMarketBreadth({
    advances, declines, totalStocks: advances + declines,
    stocks, top25Stocks: stocks.slice(0, 25), t10, t15, top25ScoreDiff,
    top25Score, pcr, overallScore, spotPrice: currentSpot, support, resistance, regimeResult
  } as any), [advances, declines, stocks, t10, t15, top25ScoreDiff, top25Score, pcr, overallScore, currentSpot, support, resistance, regimeResult]);

  const heavyweightResult = useMemo(() => computeHeavyweight({
    stocks, score5mNet, regimeResult, breadthResult
  } as any), [stocks, score5mNet, regimeResult, breadthResult]);

  const range15mResult = useMemo(() => computeRange15M({
    spotPrice: currentSpot,
    rangeHigh: currentSpot + 50, // mock fallback
    rangeLow: currentSpot - 50,  // mock fallback
    isFallback: true,
    regimeResult, breadthResult, heavyweightResult
  }), [currentSpot, regimeResult, breadthResult, heavyweightResult]);

  const momentumResult = useMemo(() => computeMomentum({
    overallScore, scoreDifference: score5mNet, score15mDiff: score15mNet, score30mDiff: score30mNet, score1hDiff: score1hNet,
    changePercent: spotChangePct, volume: totalVolume,
    regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult: { institutionalBias: "NEUTRAL" } as any
  }), [overallScore, score5mNet, score15mNet, score30mNet, score1hNet, spotChangePct, totalVolume, regimeResult, breadthResult, heavyweightResult, range15mResult]);

  const smartMoneyResult = useMemo(() => computeSmartMoney({
    pcr, totalCallOI: 0, totalPutOI: 0, totalCallOIChange: 0, totalPutOIChange: 0,
    totalCallVolume: 0, totalPutVolume: 0, overallScore, scoreDifference: score5mNet,
    score15mDiff: score15mNet, volume: totalVolume, changePercent: spotChangePct,
    regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult: { pcr } as any, momentumResult
  } as any), [pcr, overallScore, score5mNet, score15mNet, totalVolume, spotChangePct, regimeResult, breadthResult, heavyweightResult, range15mResult, momentumResult]);

  const entryZoneResult = useMemo(() => computeEntryZone({
    spotPrice: currentSpot, rangeHigh: currentSpot + 50, rangeLow: currentSpot - 50,
    regimeResult, breadthResult, heavyweightResult, range15mResult, optionChainResult: { pcr } as any,
    momentumResult, smartMoneyResult, probabilityResult: { confidenceLevel: 50, volatilityScore: 10 } as any
  }), [currentSpot, regimeResult, breadthResult, heavyweightResult, range15mResult, momentumResult, smartMoneyResult]);

  const strategyAlignmentResult = useMemo(() => computeStrategyAlignment({
    regimeResult, breadthResult, heavyweightResult, range15mResult,
    optionChainResult: { pcr } as any, momentumResult, smartMoneyResult,
    probabilityResult: { confidenceLevel: 50, volatilityScore: 10 } as any, entryZoneResult
  }), [regimeResult, breadthResult, heavyweightResult, range15mResult, momentumResult, smartMoneyResult, entryZoneResult]);

  const aiDecisionResult = useMemo(() => computeAIDecision({
    regimeResult, breadthResult, heavyweightResult, range15mResult,
    optionChainResult: { pcr } as any, momentumResult, smartMoneyResult,
    probabilityResult: { confidenceLevel: 50, volatilityScore: 10 } as any,
    entryZoneResult, strategyAlignmentResult, indiaVix, spotChangePct
  }), [regimeResult, breadthResult, heavyweightResult, range15mResult, momentumResult, smartMoneyResult, entryZoneResult, strategyAlignmentResult, indiaVix, spotChangePct]);

  const bg = darkMode ? "bg-[#0b101d]" : "bg-white";
  const border = darkMode ? "border-[#1e293b]" : "border-slate-200";
  const textTitle = darkMode ? "text-slate-400" : "text-slate-500";
  
  const isCE = aiDecisionResult.finalDecision === "BUY_CE";
  const isPE = aiDecisionResult.finalDecision === "BUY_PE";

  return (
    <div className={`rounded-xl border ${border} ${bg} p-2.5 flex flex-col gap-2.5 shadow-sm font-['Inter'] mt-1`}>
      <div className="flex items-center justify-between border-b border-slate-800/40 pb-1.5 px-1">
        <h3 className={`text-[10px] font-black uppercase tracking-widest ${textTitle} flex items-center gap-1.5`}>
          <BrainCircuit size={13} className="text-indigo-400" />
          Trading Engine
        </h3>
        <span className="text-[9px] font-bold text-slate-500 bg-slate-800/30 px-1.5 py-0.5 rounded">
          {activePage}
        </span>
      </div>

      {/* AI Decision - Highlight */}
      <div className={`p-2.5 rounded border flex flex-col gap-1 items-center justify-center ${
        isCE ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
        isPE ? "bg-red-500/10 border-red-500/20 text-red-400" :
        "bg-amber-500/10 border-amber-500/20 text-amber-400"
      }`}>
        <span className="text-[9px] font-black tracking-widest uppercase opacity-80">Final Decision</span>
        <div className="flex items-center gap-1.5 text-sm font-black">
          {isCE ? <TrendingUp size={14} /> : isPE ? <TrendingDown size={14} /> : <ShieldCheck size={14} />}
          {aiDecisionResult.finalDecision.replace("_", " ")}
          <span className="opacity-60 ml-1">({aiDecisionResult.confidence}%)</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {/* Entry Zone */}
        <div className="p-1.5 rounded bg-slate-900/30 border border-slate-800/50 flex flex-col">
          <span className="text-[8px] font-bold text-slate-500 uppercase">Entry Zone</span>
          <span className="text-[11px] font-black text-slate-200 mt-0.5 font-mono">
            ₹{(entryZoneResult.entryPrice || currentSpot).toFixed(1)}
          </span>
          <div className="flex justify-between items-center mt-1 pt-1 border-t border-slate-800/40">
            <span className="text-[8px] font-mono text-red-400">SL: {entryZoneResult.stopLoss}</span>
            <span className="text-[8px] font-mono text-emerald-400">T: {entryZoneResult.target}</span>
          </div>
        </div>

        {/* Strategy */}
        <div className="p-1.5 rounded bg-slate-900/30 border border-slate-800/50 flex flex-col justify-between">
          <span className="text-[8px] font-bold text-slate-500 uppercase">Strategy</span>
          <span className="text-[9px] font-bold text-indigo-400 leading-tight mt-0.5 break-words">
            {strategyAlignmentResult.activeSetup === "NO_STRATEGY" ? "STANDBY" : strategyAlignmentResult.activeSetup}
          </span>
        </div>

        {/* Smart Money */}
        <div className="p-1.5 rounded bg-slate-900/30 border border-slate-800/50 flex flex-col">
          <span className="text-[8px] font-bold text-slate-500 uppercase">Smart Money</span>
          <span className={`text-[9px] font-bold mt-0.5 ${smartMoneyResult.institutionalBias === "BUYING" ? "text-emerald-400" : smartMoneyResult.institutionalBias === "SELLING" ? "text-red-400" : "text-slate-300"}`}>
            {smartMoneyResult.institutionalBias}
          </span>
          <span className="text-[8px] text-slate-400 mt-auto pt-1 line-clamp-1">
            Dir: {smartMoneyResult.direction}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {/* Regime */}
        <div className="p-1.5 rounded bg-slate-900/30 border border-slate-800/50 flex flex-col">
          <span className="text-[8px] font-bold text-slate-500 uppercase">Regime</span>
          <span className={`text-[10px] font-bold mt-0.5 ${regimeResult.isBullish ? "text-emerald-400" : regimeResult.isBearish ? "text-red-400" : "text-amber-400"}`}>
            {regimeResult.regime.replace(/_/g, " ")}
          </span>
        </div>

        {/* Momentum */}
        <div className="p-1.5 rounded bg-slate-900/30 border border-slate-800/50 flex flex-col">
          <span className="text-[8px] font-bold text-slate-500 uppercase">Momentum</span>
          <span className="text-[10px] font-bold text-sky-400 mt-0.5 whitespace-nowrap">
            G-{momentumResult.momentumGrade} ({momentumResult.momentumScore})
          </span>
        </div>

        {/* Velocity */}
        <div className="p-1.5 rounded bg-slate-900/30 border border-slate-800/50 flex flex-col">
          <span className="text-[8px] font-bold text-slate-500 uppercase">Velocity</span>
          <span className={`text-[10px] font-bold mt-0.5 ${velocity > 15 ? "text-rose-400" : velocity > 5 ? "text-amber-400" : "text-slate-300"}`}>
            {velocity.toFixed(1)} <span className="text-[8px] opacity-60">pts/s</span>
          </span>
        </div>
      </div>
    </div>
  );
}
