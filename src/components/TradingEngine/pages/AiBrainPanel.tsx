/**
 * AiBrainPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Layer 16/17/18: AI Brain Dashboard Widget
 *
 * A premium HUD panel visualizing the master AI conviction grade,
 * layer consensus voting, detected intraday price/OI patterns,
 * self-learning win rates, and dynamic layer weights.
 */
import React from "react";
import {
  Brain, Award, Shield, AlertTriangle, TrendingUp, TrendingDown,
  Clock, CheckCircle, HelpCircle, Activity, ChevronRight, Globe
} from "lucide-react";
import type { AiBrainResult, BrainDecision, ConvictionGrade, BrainState } from "../../../engine/aiBrainEngine";
import type { SignalMemoryResult } from "../../../engine/signalMemoryEngine";
import type { PatternRecognitionResult } from "../../../engine/patternRecognitionEngine";
import CognitiveMatrixCard from "./CognitiveMatrixCard";

export interface AiBrainPanelProps {
  aiBrainResult?: AiBrainResult;
  signalMemoryResult?: SignalMemoryResult;
  patternResult?: PatternRecognitionResult;
  brainLocked?: boolean;
  onToggleBrainLock?: () => void;
}

const AiBrainPanel: React.FC<AiBrainPanelProps> = ({
  aiBrainResult,
  signalMemoryResult,
  patternResult,
  brainLocked = false,
  onToggleBrainLock,
}) => {
  if (!aiBrainResult) {
    return (
      <div className="p-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/20 text-center text-slate-500 text-sm font-mono">
        🧠 AI Brain is initializing...
      </div>
    );
  }

  const {
    finalDecision,
    baseDecision,
    convictionScore,
    convictionGrade,
    brainState,
    votes = [],
    ceVoterCount = 0,
    peVoterCount = 0,
    neutralVoterCount = 0,
    weights,
    memoryAdjustedConfidence,
    patternBoost = 0,
    patternDetected,
    cooldownBlocking,
    macroSentiment = "NEUTRAL",
    macroSentimentScore = 0,
    latestNewsHeadlines = [],
    contradictionPenalty = 0,
    reasoning = [],
  } = aiBrainResult;

  // Decision UI configuration
  const decisionConfig: Record<BrainDecision, { label: string; color: string; bg: string; border: string }> = {
    BUY_CE: {
      label: "🟢 BUY CE",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
    },
    BUY_PE: {
      label: "🔴 BUY PE",
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
    },
    WAIT: {
      label: "🟡 WAIT",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
    },
    NO_TRADE: {
      label: "⛔ NO TRADE",
      color: "text-slate-400",
      bg: "bg-slate-500/10",
      border: "border-slate-500/30",
    },
  };

  const dec = decisionConfig[finalDecision] || decisionConfig.WAIT;

  // Grade color map
  const gradeColors: Record<ConvictionGrade, string> = {
    "A+": "text-emerald-400 border-emerald-400 bg-emerald-950/50",
    A: "text-emerald-500 border-emerald-500 bg-emerald-950/20",
    B: "text-blue-400 border-blue-400 bg-blue-950/20",
    C: "text-amber-400 border-amber-400 bg-amber-950/20",
    D: "text-orange-400 border-orange-400 bg-orange-950/20",
    F: "text-red-500 border-red-500 bg-red-950/20",
  };

  const gradeColor = gradeColors[convictionGrade] || "text-slate-400 border-slate-700 bg-slate-900";

  // Brain State configs
  const stateConfig: Record<BrainState, { label: string; bg: string; text: string; animate?: boolean }> = {
    AGGRESSIVE: { label: "AGGRESSIVE", bg: "bg-emerald-500/20 border-emerald-500/40", text: "text-emerald-400" },
    CONSERVATIVE: { label: "CONSERVATIVE", bg: "bg-amber-500/20 border-amber-500/40", text: "text-amber-400" },
    LEARNING: { label: "LEARNING", bg: "bg-indigo-500/20 border-indigo-500/40", text: "text-indigo-400", animate: true },
    LOCKED: { label: "LOCKED", bg: "bg-rose-950 border-rose-800", text: "text-rose-400" },
    COOLDOWN: { label: "COOLDOWN", bg: "bg-red-500/20 border-red-500/40", text: "text-red-400 animate-pulse", animate: true },
  };

  const state = stateConfig[brainState] || { label: brainState, bg: "bg-slate-800", text: "text-slate-400" };

  // SVG Circular Gauge calculation
  const radius = 24;
  const stroke = 4;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (convictionScore / 100) * circumference;

  const getGaugeColor = (score: number) => {
    if (score >= 75) return "#10b981"; // emerald
    if (score >= 50) return "#f59e0b"; // amber
    return "#ef4444"; // red
  };

  const voterTotal = ceVoterCount + peVoterCount + neutralVoterCount;
  const cePct = voterTotal > 0 ? (ceVoterCount / voterTotal) * 100 : 0;
  const pePct = voterTotal > 0 ? (peVoterCount / voterTotal) * 100 : 0;
  const neutralPct = voterTotal > 0 ? (neutralVoterCount / voterTotal) * 100 : 0;

  return (
    <div className="space-y-3 p-3 rounded-xl border border-slate-900 bg-slate-950/40 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-2">
        <div className="flex items-center gap-1.5">
          <Brain size={14} className="text-indigo-400" />
          <span className="text-xs font-black text-slate-300 uppercase tracking-widest">
            AMEX AI BRAIN v2.0
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onToggleBrainLock && (
            <button
              onClick={onToggleBrainLock}
              className={`text-[9px] font-black px-1.5 py-0.5 rounded border tracking-wider cursor-pointer transition-colors ${
                brainLocked
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/25 animate-pulse"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
              title={brainLocked ? "Click to Unlock AI Brain" : "Click to Lock AI Brain"}
            >
              {brainLocked ? "🔒 LOCKED" : "🔓 UNLOCKED"}
            </button>
          )}
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border tracking-wider ${state.bg} ${state.text} ${state.animate ? "animate-pulse" : ""}`}>
            {state.label}
          </span>
        </div>
      </div>

      {/* ── AI COGNITIVE MATRIX WIDGET ── */}
      <CognitiveMatrixCard aiBrainResult={aiBrainResult} macroSentimentScore={macroSentimentScore} />

      {/* Conviction & Score Row */}
      <div className="grid grid-cols-12 gap-3 items-center">
        {/* SVG Circle Gauge */}
        <div className="col-span-4 flex justify-center relative">
          <svg className="w-16 h-16 transform -rotate-90">
            <circle
              className="text-slate-900"
              strokeWidth={stroke}
              stroke="currentColor"
              fill="transparent"
              r={radius}
              cx="32"
              cy="32"
            />
            <circle
              strokeWidth={stroke}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              stroke={getGaugeColor(convictionScore)}
              fill="transparent"
              r={radius}
              cx="32"
              cy="32"
              className="transition-all duration-500 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs font-black text-slate-200 leading-none">{convictionScore}%</span>
            <span className="text-[8px] text-slate-500 font-bold uppercase mt-0.5">Conv</span>
          </div>
        </div>

        {/* Action / Decision Meta */}
        <div className="col-span-8 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Verdict:</span>
            <span className={`text-xs font-black px-2 py-0.5 rounded border ${dec.bg} ${dec.border} ${dec.color}`}>
              {dec.label}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold">Grade:</span>
            <span className={`text-xs font-black px-2 py-0.2 rounded border ${gradeColor}`}>
              {convictionGrade}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-650">L11 Base Verdict:</span>
            <span className="text-slate-400 font-bold">{baseDecision}</span>
          </div>
        </div>
      </div>

      {/* Consensus Bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[9px] text-slate-500 font-bold uppercase tracking-wider">
          <span>Consensus</span>
          <span className="flex gap-1.5">
            <span className="text-emerald-400">CE: {ceVoterCount}</span>
            <span className="text-red-400">PE: {peVoterCount}</span>
            <span className="text-slate-450">N: {neutralVoterCount}</span>
          </span>
        </div>
        <div className="h-1.5 w-full bg-slate-900 rounded-full flex overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${cePct}%` }} title={`CE: ${ceVoterCount}`} />
          <div className="h-full bg-slate-600 transition-all duration-300" style={{ width: `${neutralPct}%` }} title={`Neutral: ${neutralVoterCount}`} />
          <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${pePct}%` }} title={`PE: ${peVoterCount}`} />
        </div>
      </div>

      {/* Pattern Recognition Widget */}
      {patternResult && (
        <div className="p-2 rounded border border-slate-900 bg-slate-950/60 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
              🔍 PATTERN SCANNER (L18)
            </span>
            {patternResult.primaryPattern.name !== "NONE" && (
              <span className={`text-[8px] font-black px-1.5 rounded border ${
                patternResult.primaryPattern.strength === "STRONG" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 animate-pulse" :
                patternResult.primaryPattern.strength === "MODERATE" ? "bg-amber-500/20 border-amber-500/40 text-amber-400" :
                "bg-slate-900 border-slate-800 text-slate-400"
              }`}>
                {patternResult.primaryPattern.strength}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <span className="text-xs text-slate-300 font-bold truncate max-w-[200px]" title={patternResult.primaryPattern.description}>
              {patternResult.primaryPattern.name === "NONE" ? "Searching intraday setups..." : patternResult.primaryPattern.name.replace(/_/g, " ")}
            </span>
            {patternResult.primaryPattern.confidence > 0 && (
              <span className="text-xs text-indigo-400 font-bold">{patternResult.primaryPattern.confidence}%</span>
            )}
          </div>

          {patternBoost !== 0 && (
            <div className={`text-[9px] font-bold flex items-center gap-1 ${patternBoost > 0 ? "text-emerald-400" : "text-red-400"}`}>
              <span>{patternBoost > 0 ? "▲" : "▼"}</span>
              <span>Pattern Boost: {patternBoost > 0 ? "+" : ""}{patternBoost}% confidence multiplier</span>
            </div>
          )}
        </div>
      )}

      {/* Signal Memory (Win Rate & Learning) Widget */}
      {signalMemoryResult && (
        <div className="p-2 rounded border border-slate-900 bg-slate-950/60 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
              🧠 SIGNAL MEMORY & LEARNING (L17)
            </span>
            <span className="text-[9px] text-slate-450 font-bold">
              {signalMemoryResult.signals.length} recorded
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex flex-col border-r border-slate-900/60 pr-2">
              <span className="text-slate-500 text-[9px] uppercase">Overall Win Rate</span>
              <span className={`text-[13px] font-black ${
                signalMemoryResult.overallWinRate >= 60 ? "text-emerald-400" :
                signalMemoryResult.overallWinRate >= 45 ? "text-amber-400" : "text-red-405"
              }`}>
                {signalMemoryResult.overallWinRate.toFixed(0)}%
              </span>
            </div>
            <div className="flex flex-col pl-1">
              <span className="text-slate-500 text-[9px] uppercase">Recent Win Rate</span>
              <span className={`text-[13px] font-black ${
                signalMemoryResult.recentWinRate >= 60 ? "text-emerald-400" :
                signalMemoryResult.recentWinRate >= 45 ? "text-amber-400" : "text-red-405"
              }`}>
                {signalMemoryResult.recentWinRate.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Cooldown Alert */}
          {signalMemoryResult.cooldownActive && (
            <div className="p-1 rounded bg-red-950/30 border border-red-800/40 text-[9px] text-red-400 font-bold flex items-center gap-1.5 animate-pulse mt-1">
              <Clock size={10} />
              <span>COOLDOWN ACTIVE: {Math.floor(signalMemoryResult.cooldownRemainingSeconds / 60)}m {signalMemoryResult.cooldownRemainingSeconds % 60}s remaining (3 consecutive losses)</span>
            </div>
          )}

          {/* Memory Multiplier */}
          {signalMemoryResult.confidenceMultiplier !== 1.0 && (
            <div className={`text-[9px] font-bold flex items-center gap-1 ${signalMemoryResult.confidenceMultiplier > 1.0 ? "text-emerald-400" : "text-red-400"}`}>
              <span>{signalMemoryResult.confidenceMultiplier > 1.0 ? "▲" : "▼"}</span>
              <span>Memory Mult: {signalMemoryResult.confidenceMultiplier.toFixed(2)}x confidence adjustment</span>
            </div>
          )}
        </div>
      )}

      {/* Global Macro Intel (L19) Widget */}
      <div className="p-2 rounded border border-slate-900 bg-slate-950/60 space-y-1.5 overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <Globe size={10} className="text-blue-400" />
            GLOBAL MACRO INTEL (L19)
          </span>
          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${
            macroSentiment === "BULLISH" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" :
            macroSentiment === "BEARISH" ? "bg-red-500/20 border-red-500/40 text-red-400" :
            "bg-slate-800 border-slate-700 text-slate-400"
          }`}>
            {macroSentiment} {macroSentimentScore > 0 ? `+${macroSentimentScore}` : macroSentimentScore}
          </span>
        </div>

        {/* Scrolling News Ticker */}
        {latestNewsHeadlines.length > 0 ? (
          <div className="relative w-full overflow-hidden h-4 bg-slate-900/50 rounded flex items-center">
            <div className="absolute whitespace-nowrap animate-marquee text-[10px] text-slate-300 font-mono flex gap-8">
              {latestNewsHeadlines.map((hl, i) => (
                <span key={i} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                  {hl}
                </span>
              ))}
              {/* Duplicate for seamless looping */}
              {latestNewsHeadlines.map((hl, i) => (
                <span key={`dup-${i}`} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                  {hl}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-[9px] text-slate-500 animate-pulse">Syncing global feeds...</div>
        )}
      </div>

      {/* Dynamic Weight Tuning Panel */}
      {weights && (
        <div className="space-y-1">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">
            ⚙️ ACTIVE WEIGHT TUNING (VIX ADJUSTED)
          </span>
          <div className="grid grid-cols-3 gap-1 text-[9px] font-bold">
            <div className="flex justify-between border border-slate-900 bg-slate-950/40 p-1 rounded">
              <span className="text-slate-500">MOM</span>
              <span className="text-slate-350">{weights.momentum.toFixed(1)}</span>
            </div>
            <div className="flex justify-between border border-slate-900 bg-slate-950/40 p-1 rounded">
              <span className="text-slate-500">SM</span>
              <span className="text-slate-350">{weights.smartMoney.toFixed(1)}</span>
            </div>
            <div className="flex justify-between border border-slate-900 bg-slate-950/40 p-1 rounded">
              <span className="text-slate-500">PROB</span>
              <span className="text-slate-350">{weights.probability.toFixed(1)}</span>
            </div>
            <div className="flex justify-between border border-slate-900 bg-slate-950/40 p-1 rounded">
              <span className="text-slate-500">ALIGN</span>
              <span className="text-slate-350">{weights.alignment.toFixed(1)}</span>
            </div>
            <div className="flex justify-between border border-slate-900 bg-slate-950/40 p-1 rounded">
              <span className="text-slate-500">ZONE</span>
              <span className="text-slate-350">{weights.entryZone.toFixed(1)}</span>
            </div>
            <div className="flex justify-between border border-slate-900 bg-slate-950/40 p-1 rounded">
              <span className="text-slate-500">CHAIN</span>
              <span className="text-slate-350">{weights.optionChain.toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Brain Reasoning Log */}
      {reasoning.length > 0 && (
        <div className="space-y-1 pt-1.5 border-t border-slate-900">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">
            🧠 BRAIN REASONING LOG
          </span>
          <div className="space-y-0.5 text-[9.5px] text-slate-400">
            {reasoning.slice(0, 3).map((item, idx) => (
              <div key={idx} className="flex items-start gap-1 leading-tight">
                <ChevronRight size={10} className="text-indigo-400 mt-0.5 shrink-0" />
                <span className="truncate max-w-[280px]" title={item}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AiBrainPanel;
