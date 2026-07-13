/**
 * StrategiesCard.tsx  (AMEX v3.0 — L13 COMPLETE REPLACEMENT)
 * ═══════════════════════════════════════════════════════════════════════
 * Layer 13: Auto Strategy AI — Live Weighted Score Dashboard
 *
 * Dikhata hai:
 *  1. Overall Confidence Score (circular gauge)
 *  2. Market Environment Badge (Trending / Sideways / High VIX etc.)
 *  3. Per-Layer Breakdown Table (score bar + weight + contribution)
 *  4. Strategy Readiness Panel (which strategies are close to firing)
 *  5. Weight Editor (manual sliders — overrides self-learning weights)
 *  6. Fire Threshold progress bar
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  computeWeightedScore,
  getStrategyThreshold,
  getStrategyCategory,
  detectMarketEnvironment,
  recommendStrategyCategory,
  DEFAULT_LAYER_WEIGHTS,
  normalizeWeights,
  type LayerWeights,
  type LayerScoreItem,
  type WeightedScoreResult,
  type MarketEnvironment,
} from "../../../engine/weightedScoringEngine";
import { STRATEGY_REGISTRY }  from "../../../engine/strategyRegistry";
import type { MarketRegimeResult }      from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult }     from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }       from "../../../engine/heavyweightEngine";
import type { Range15MResult }          from "../../../engine/range15mEngine";
import type { OptionChainEngineOutput } from "../../../engine/optionChainEngine";
import type { MomentumEngineOutput }    from "../../../engine/momentumEngine";
import type { SmartMoneySignal }        from "../../../engine/smartMoneyEngine";
import type { ProbabilityEngineResult } from "../../../engine/probabilityEngine";
import type { EntryZoneResult }         from "../../../engine/entryZoneEngine";
import type { StrategyAlignmentResult } from "../../../engine/strategyAlignmentEngine";
import type { AIDecisionResult }        from "../../../engine/aiDecisionEngine";
import type { OpportunityResult }       from "../../../engine/opportunityEngine";
import {
  Activity, Zap, Target, Brain, Shield, TrendingUp,
  TrendingDown, Sliders, ChevronDown, ChevronUp,
  RefreshCw, CheckCircle2, AlertCircle, Clock,
} from "lucide-react";

// ── Props ──────────────────────────────────────────────────────────────
export interface StrategiesCardProps {
  activePage:              string;
  spotPrice:               number;
  regimeResult:            MarketRegimeResult;
  breadthResult:           MarketBreadthResult;
  heavyweightResult?:      HeavyweightResult;
  range15mResult?:         Range15MResult;
  optionChainResult?:      OptionChainEngineOutput;
  momentumResult?:         MomentumEngineOutput;
  smartMoneyResult?:       SmartMoneySignal;
  probabilityResult:       ProbabilityEngineResult;
  entryZoneResult:         EntryZoneResult;
  strategyAlignmentResult: StrategyAlignmentResult;
  aiDecisionResult:        AIDecisionResult;
  opportunityResult:       OpportunityResult;
  indiaVix?:               number;
  pcr?:                    number;
  isExpiryDay?:            boolean;
  sessionType?:            string;
  previousActiveStrategy?: string;
  previousStrategyScore?:  number;
  switchHistory?:          string[];
}

// ── Helpers ────────────────────────────────────────────────────────────
const API = (p: string) => {
  const isLocal = typeof window !== "undefined" &&
    (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${p}`;
};

const ENV_COLORS: Record<MarketEnvironment, { bg: string; text: string; border: string; label: string }> = {
  TRENDING_BULLISH:  { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/40", label: "📈 Trending Bullish" },
  TRENDING_BEARISH:  { bg: "bg-rose-500/15",    text: "text-rose-300",    border: "border-rose-500/40",    label: "📉 Trending Bearish" },
  BREAKOUT_BULLISH:  { bg: "bg-cyan-500/15",    text: "text-cyan-300",    border: "border-cyan-500/40",    label: "🚀 Breakout Bullish" },
  BREAKOUT_BEARISH:  { bg: "bg-orange-500/15",  text: "text-orange-300",  border: "border-orange-500/40",  label: "💥 Breakout Bearish" },
  SIDEWAYS_RANGE:    { bg: "bg-slate-500/15",   text: "text-slate-300",   border: "border-slate-500/40",   label: "↔️ Sideways Range"  },
  HIGH_VOLATILITY:   { bg: "bg-amber-500/15",   text: "text-amber-300",   border: "border-amber-500/40",   label: "⚡ High Volatility"  },
  PRE_EXPIRY:        { bg: "bg-violet-500/15",  text: "text-violet-300",  border: "border-violet-500/40",  label: "⏰ Pre-Expiry"       },
  UNKNOWN:           { bg: "bg-slate-700/20",   text: "text-slate-400",   border: "border-slate-600/40",   label: "❓ Unknown"          },
};

const STATUS_COLORS = {
  STRONG: "text-emerald-400",
  OK:     "text-cyan-400",
  WEAK:   "text-amber-400",
  FAIL:   "text-rose-400",
};

const STATUS_BAR_COLORS = {
  STRONG: "bg-emerald-500",
  OK:     "bg-cyan-500",
  WEAK:   "bg-amber-500",
  FAIL:   "bg-rose-600",
};

// Score → color gradient
function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 60) return "text-cyan-400";
  if (score >= 45) return "text-amber-400";
  return "text-rose-400";
}
function scoreGradient(score: number): string {
  if (score >= 75) return "from-emerald-600 to-teal-600";
  if (score >= 60) return "from-cyan-600 to-blue-600";
  if (score >= 45) return "from-amber-600 to-orange-600";
  return "from-rose-700 to-red-700";
}

// ── Main Component ─────────────────────────────────────────────────────
const StrategiesCard: React.FC<StrategiesCardProps> = (props) => {
  const {
    regimeResult, breadthResult, momentumResult, optionChainResult,
    smartMoneyResult, probabilityResult, entryZoneResult,
    strategyAlignmentResult, aiDecisionResult, activePage,
    indiaVix = 15, pcr = 1.0, isExpiryDay = false, sessionType = "MID",
    range15mResult,
  } = props;

  const [weights, setWeights] = useState<LayerWeights>(DEFAULT_LAYER_WEIGHTS);
  const [showWeightEditor, setShowWeightEditor] = useState(false);
  const [showAllLayers, setShowAllLayers]       = useState(false);
  const [savingWeights, setSavingWeights]       = useState(false);
  const [lastSaved, setLastSaved]               = useState<string>("");

  // Load weights from server on mount
  useEffect(() => {
    fetch(API("/api/te/layer-weights"))
      .then(r => r.json())
      .then(d => {
        if (d.weights && Object.keys(d.weights).length > 0) {
          setWeights(w => ({ ...w, ...d.weights }));
        }
      })
      .catch(() => {});
  }, []);

  // Build DispatcherInput from props
  const dispatcherInput = useMemo(() => ({
    spotPrice:          props.spotPrice,
    indexSymbol:        activePage,
    indiaVix,
    pcr,
    aiConfidence:       aiDecisionResult?.confidence ?? 50,
    aiDirection:        (aiDecisionResult?.direction === "BUY_CE" ? "BUY_CE" :
                        aiDecisionResult?.direction === "BUY_PE" ? "BUY_PE" : "WAIT") as any,
    regime:             regimeResult?.regime ?? "RANGE",
    sessionType,
    smartMoneyScore:    smartMoneyResult?.score ?? 50,
    alignmentScore:     strategyAlignmentResult?.score ?? 50,
    breadthScore:       breadthResult?.score ?? 50,
    momentumScore:      momentumResult?.score ?? 50,
    patternScore:       50,
    probabilityScore:   probabilityResult?.winProbability ?? 50,
    entryZoneScore:     entryZoneResult?.score ?? 50,
    rangeBreakout:      range15mResult?.breakout ?? false,
    rangeBreakdown:     range15mResult?.breakdown ?? false,
    momentumExhaustion: momentumResult?.exhaustion ?? false,
    isExpiryDay,
    isMarketOpen:       true,
    optionChain:        [],
    currentState:       {} as any,
  }), [props, indiaVix, pcr, sessionType, isExpiryDay]);

  // Detect market environment
  const marketEnv = useMemo(() => detectMarketEnvironment(dispatcherInput as any), [dispatcherInput]);
  const envStyle  = ENV_COLORS[marketEnv] ?? ENV_COLORS.UNKNOWN;
  const recCategories = useMemo(() => recommendStrategyCategory(marketEnv, indiaVix), [marketEnv, indiaVix]);

  // Compute score for best matching strategy
  const normalizedWeights = useMemo(() => normalizeWeights(weights), [weights]);

  const allScores = useMemo(() => {
    return STRATEGY_REGISTRY
      .filter(s => s.isActive)
      .map(s => ({
        strategy: s,
        result: computeWeightedScore(dispatcherInput as any, s, normalizedWeights),
        category: getStrategyCategory(s),
        threshold: getStrategyThreshold(s),
      }))
      .sort((a, b) => b.result.totalScore - a.result.totalScore);
  }, [dispatcherInput, normalizedWeights]);

  const bestScore = allScores[0];
  const topScore  = bestScore?.result.totalScore ?? 0;
  const scoreRes  = bestScore?.result;

  // Strategy readiness — show top 6
  const readinessGroups = useMemo(() => {
    const ready    = allScores.filter(s => s.result.shouldFire).slice(0, 3);
    const close    = allScores.filter(s => !s.result.shouldFire && s.result.totalScore >= s.threshold - 10).slice(0, 3);
    const watching = allScores.filter(s => !s.result.shouldFire && s.result.totalScore < s.threshold - 10).slice(0, 3);
    return { ready, close, watching };
  }, [allScores]);

  // Save weights to server
  const saveWeights = async () => {
    setSavingWeights(true);
    try {
      await fetch(API("/api/te/layer-weights"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights: normalizedWeights }),
      });
      setLastSaved(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }));
    } catch { /* ignore */ }
    setSavingWeights(false);
  };

  const resetWeights = () => setWeights(DEFAULT_LAYER_WEIGHTS);

  const layersToShow = showAllLayers
    ? (scoreRes?.breakdown ?? [])
    : (scoreRes?.breakdown.slice(0, 8) ?? []);

  // Circular gauge SVG
  const gaugeRadius  = 54;
  const gaugeCircum  = 2 * Math.PI * gaugeRadius;
  const gaugeFill    = (topScore / 100) * gaugeCircum;

  return (
    <div className="bg-gradient-to-br from-slate-900 via-[#0d1117] to-slate-900 rounded-2xl border border-slate-700/50 overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-700/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Auto Strategy AI</h3>
              <p className="text-slate-500 text-[10px]">L13 · Weighted Confidence Engine</p>
            </div>
          </div>
          {/* Market Env badge */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${envStyle.bg} ${envStyle.text} ${envStyle.border}`}>
            {envStyle.label}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* ── Score Gauge + Stats Row ──────────────────────────────── */}
        <div className="flex items-center gap-5">

          {/* Circular Gauge */}
          <div className="relative shrink-0">
            <svg width="130" height="130" viewBox="0 0 130 130">
              {/* Background track */}
              <circle cx="65" cy="65" r={gaugeRadius} fill="none"
                stroke="#1e2736" strokeWidth="10" />
              {/* Score fill */}
              <circle cx="65" cy="65" r={gaugeRadius} fill="none"
                stroke={topScore >= 65 ? "#10b981" : topScore >= 50 ? "#06b6d4" : topScore >= 35 ? "#f59e0b" : "#ef4444"}
                strokeWidth="10"
                strokeDasharray={`${gaugeFill} ${gaugeCircum}`}
                strokeLinecap="round"
                transform="rotate(-90 65 65)"
                style={{ transition: "stroke-dasharray 0.8s ease" }}
              />
              {/* Threshold marker */}
              {bestScore && (() => {
                const thresh    = bestScore.threshold;
                const threshAng = (thresh / 100) * 2 * Math.PI - Math.PI / 2;
                const mx = 65 + (gaugeRadius + 8) * Math.cos(threshAng);
                const my = 65 + (gaugeRadius + 8) * Math.sin(threshAng);
                return <circle cx={mx} cy={my} r="4" fill="#f59e0b" />;
              })()}
              {/* Center text */}
              <text x="65" y="58" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold" fontFamily="monospace">
                {topScore.toFixed(0)}
              </text>
              <text x="65" y="72" textAnchor="middle" fill="#64748b" fontSize="10">
                / 100
              </text>
              <text x="65" y="84" textAnchor="middle"
                fill={topScore >= (bestScore?.threshold ?? 65) ? "#10b981" : "#94a3b8"}
                fontSize="8" fontWeight="bold">
                {topScore >= (bestScore?.threshold ?? 65) ? "● FIRE" : `need ${bestScore?.threshold ?? 65}%`}
              </text>
            </svg>
          </div>

          {/* Right stats */}
          <div className="flex-1 space-y-2.5">
            {/* Direction */}
            <div className="flex items-center gap-2">
              {scoreRes?.direction === "CE" ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-bold text-sm">BUY CE</span>
                </div>
              ) : scoreRes?.direction === "PE" ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30">
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-400 font-bold text-sm">BUY PE</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/40 border border-slate-600/30">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-400 font-bold text-sm">WAIT</span>
                </div>
              )}
            </div>

            {/* Recommended strategy type */}
            <div>
              <div className="text-slate-500 text-[10px] mb-1">Recommended for {marketEnv.replace("_", " ")}</div>
              <div className="flex flex-wrap gap-1">
                {recCategories.map(cat => (
                  <span key={cat} className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[10px] font-semibold">
                    {cat}
                  </span>
                ))}
              </div>
            </div>

            {/* Missing score */}
            {(scoreRes?.missingScore ?? 0) > 0 && (
              <div className="text-[11px] text-amber-400/80 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" />
                Need {(scoreRes?.missingScore ?? 0).toFixed(1)}% more → weak: {scoreRes?.weakLayers.slice(0, 2).join(", ")}
              </div>
            )}
          </div>
        </div>

        {/* ── Strategy Readiness Panel ─────────────────────────────── */}
        <div className="space-y-1.5">
          <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <Target className="w-3 h-3" /> Strategy Readiness
          </div>

          {readinessGroups.ready.length > 0 && (
            <div className="space-y-1">
              {readinessGroups.ready.map(({ strategy, result }) => (
                <div key={strategy.id}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-white text-[11px] font-semibold">{strategy.name}</span>
                    <span className="text-emerald-500/60 text-[10px]">{getStrategyCategory(strategy)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-300 font-bold text-sm font-mono">{result.totalScore.toFixed(0)}%</span>
                    <span className="text-emerald-600 text-[10px]">≥{result.threshold}%</span>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {readinessGroups.close.length > 0 && (
            <div className="space-y-1">
              {readinessGroups.close.map(({ strategy, result }) => (
                <div key={strategy.id}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-slate-300 text-[11px]">{strategy.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-300 font-bold text-sm font-mono">{result.totalScore.toFixed(0)}%</span>
                    <span className="text-amber-600 text-[10px]">need {result.threshold}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {readinessGroups.ready.length === 0 && readinessGroups.close.length === 0 && (
            <div className="px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/30 text-slate-500 text-[11px] text-center">
              No strategy near threshold · Best: {allScores[0]?.result.totalScore.toFixed(0) ?? 0}% / {allScores[0]?.threshold ?? 65}%
            </div>
          )}
        </div>

        {/* ── Layer Score Breakdown ────────────────────────────────── */}
        <div>
          <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5 mb-2">
            <Zap className="w-3 h-3" /> Layer Breakdown
            <span className="text-slate-600 font-normal normal-case">(best strategy: {bestScore?.strategy.name ?? "—"})</span>
          </div>

          <div className="space-y-1">
            {layersToShow.map((layer: LayerScoreItem) => (
              <div key={layer.layerId} className="flex items-center gap-2">
                <div className="w-28 shrink-0 text-slate-400 text-[10px] truncate" title={layer.layerName}>
                  {layer.layerName.replace(" Engine", "").replace(" (PCR)", "").replace(" (FII/DII)", "")}
                </div>
                {/* Score bar */}
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${STATUS_BAR_COLORS[layer.status]}`}
                    style={{ width: `${Math.round(layer.rawScore * 100)}%` }}
                  />
                </div>
                <div className={`w-8 text-right text-[10px] font-bold font-mono shrink-0 ${STATUS_COLORS[layer.status]}`}>
                  {Math.round(layer.rawScore * 100)}%
                </div>
                <div className="w-10 text-right text-[10px] text-slate-600 shrink-0">
                  w:{layer.weight.toFixed(0)}
                </div>
              </div>
            ))}
          </div>

          {(scoreRes?.breakdown?.length ?? 0) > 8 && (
            <button
              onClick={() => setShowAllLayers(!showAllLayers)}
              className="mt-2 flex items-center gap-1 text-slate-500 hover:text-slate-300 text-[10px] transition-colors"
            >
              {showAllLayers ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showAllLayers ? "Show less" : `Show all ${scoreRes?.breakdown.length} layers`}
            </button>
          )}
        </div>

        {/* ── Weight Editor ────────────────────────────────────────── */}
        <div className="border-t border-slate-700/40 pt-3">
          <button
            onClick={() => setShowWeightEditor(!showWeightEditor)}
            className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-[11px] transition-colors w-full"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Weight Editor</span>
            {showWeightEditor ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </button>

          {showWeightEditor && (
            <div className="mt-3 space-y-2">
              <div className="text-slate-600 text-[10px] mb-2">
                Total = {(Object.values(weights) as number[]).reduce((a, b) => a + b, 0).toFixed(0)} (will auto-normalize to 100)
              </div>
              {(Object.entries(weights) as [keyof LayerWeights, number][]).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <div className="w-32 text-slate-500 text-[10px] truncate shrink-0">
                    {key.replace("L", "").replace("_", " ")}
                  </div>
                  <input
                    type="range" min={1} max={30} step={0.5} value={val}
                    onChange={e => setWeights(w => ({ ...w, [key]: Number(e.target.value) }))}
                    className="flex-1 h-1 accent-violet-500"
                  />
                  <span className="w-6 text-right text-violet-400 text-[10px] font-mono shrink-0">
                    {val.toFixed(0)}
                  </span>
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={saveWeights}
                  disabled={savingWeights}
                  className="flex-1 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5"
                >
                  {savingWeights ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                  {savingWeights ? "Saving..." : "Save Weights"}
                </button>
                <button
                  onClick={resetWeights}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-[11px] transition-colors"
                  title="Reset to defaults"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              {lastSaved && (
                <div className="text-center text-[10px] text-emerald-500">✓ Saved at {lastSaved}</div>
              )}
            </div>
          )}
        </div>

        {/* ── Top contributors footer ───────────────────────────────── */}
        {scoreRes?.topContributors && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="text-slate-600 text-[10px]">Top:</span>
            {scoreRes.topContributors.map(name => (
              <span key={name} className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 text-[10px]">
                {name.replace(" Engine", "").replace(" (FII/DII)", "")}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategiesCard;
