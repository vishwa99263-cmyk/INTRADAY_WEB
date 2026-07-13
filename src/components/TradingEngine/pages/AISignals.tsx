/**
 * AISignals.tsx — Layer 4: AI Signal Engine
 *
 * Composite weighted signal combining:
 *   Breadth (20%) + Momentum (20%) + Acceleration (25%) + Option Chain (25%) + Volume (10%)
 *
 * Surfaces the existing Antigravity engine output + adds full reason breakdown.
 * Saves signals to DB via REST API.
 */

import React, { useMemo, useEffect, useRef, useState, useCallback } from "react";
import {
  TrendingUp, TrendingDown, Minus, Zap, BarChart2,
  Layers, Activity, Volume2, Clock, AlertCircle, CheckCircle,
  RefreshCw, ChevronDown, ChevronRight, Info
} from "lucide-react";
import type { StockData, OptionStrike, AIAnalysisPayload } from "../../../types";

interface Props {
  stocks: StockData[];
  optionChain: OptionStrike[];
  aiAnalysis: AIAnalysisPayload;
  spotPrice: number;
  activePage: string;
  pcr: number;
  bullishScore: number;
  bearishScore: number;
}

interface SignalRecord {
  id: string;
  timestamp: number;
  signal: string;
  confidence: number;
  grade: string;
  instrument: string;
  reason: string;
  entry_price: number;
  stop_loss: number;
  target: number;
  result: string;
  breadth_score: number;
  momentum_score: number;
  oi_score: number;
}

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

// ── Score Layer Calculators ────────────────────────────────────────────────────

function calcBreadthScore(stocks: StockData[]): number {
  if (!stocks.length) return 50;
  const adv = stocks.filter(s => s.changePercent > 0).length;
  const dec = stocks.filter(s => s.changePercent < 0).length;
  const total = stocks.length;
  const adr = (adv / (adv + dec + 0.001));
  const posScores = stocks.filter(s => s.score > 0).length;
  const top10 = [...stocks].sort((a, b) => b.weightage - a.weightage).slice(0, 10);
  const top10Bullish = top10.filter(s => s.score > 0).length / 10;
  return Math.round((adr * 0.4 + posScores / total * 0.4 + top10Bullish * 0.2) * 100);
}

function calcMomentumScore(stocks: StockData[]): number {
  if (!stocks.length) return 50;
  const total = stocks.length;
  const accelerating = stocks.filter(s => (s.scoreDifference || 0) > 0).length;
  const net15m = stocks.reduce((acc, s) => acc + (s.score15mDiff || 0), 0);
  const netScore = stocks.reduce((acc, s) => acc + (s.score || 0), 0);
  const base = accelerating / total;
  const momentumDir = netScore > 0 ? 1 : netScore < 0 ? -1 : 0;
  const raw = base * 0.6 + (net15m > 0 ? 0.3 : net15m < 0 ? 0 : 0.15) + (momentumDir > 0 ? 0.1 : 0);
  return Math.round(Math.min(1, Math.max(0, raw)) * 100);
}

function calcAccelerationScore(stocks: StockData[]): number {
  if (!stocks.length) return 50;
  const net = stocks.reduce((acc, s) => acc + (s.scoreDifference || 0), 0);
  const net15 = stocks.reduce((acc, s) => acc + (s.score15mDiff || 0), 0);
  const net30 = stocks.reduce((acc, s) => acc + (s.score30mDiff || 0), 0);
  // Normalise to 0-100 where 0 = strong down, 100 = strong up
  const combined = net * 0.5 + net15 * 0.3 + net30 * 0.2;
  return Math.min(100, Math.max(0, Math.round(50 + combined * 0.3)));
}

function calcOIScore(optionChain: OptionStrike[], pcr: number): number {
  if (!optionChain.length) return 50;
  const putWriting = optionChain.filter(s => s.peOIChange > 0).reduce((a, s) => a + s.peOIChange, 0);
  const callWriting = optionChain.filter(s => s.ceOIChange > 0).reduce((a, s) => a + s.ceOIChange, 0);
  const pcrScore = pcr > 1.3 ? 80 : pcr > 1.1 ? 65 : pcr > 0.9 ? 50 : pcr > 0.7 ? 35 : 20;
  const oiDirScore = putWriting > callWriting ? 65 : putWriting < callWriting ? 35 : 50;
  return Math.round(pcrScore * 0.5 + oiDirScore * 0.5);
}

function calcVolumeScore(stocks: StockData[]): number {
  if (!stocks.length) return 50;
  const avgVol = stocks.reduce((a, s) => a + s.volume, 0) / stocks.length;
  const aboveAvg = stocks.filter(s => s.changePercent > 0 && s.volume > avgVol).length;
  const belowAvg = stocks.filter(s => s.changePercent < 0 && s.volume > avgVol).length;
  if (aboveAvg + belowAvg === 0) return 50;
  return Math.round((aboveAvg / (aboveAvg + belowAvg)) * 100);
}

// ── Signal Derivation ─────────────────────────────────────────────────────────

function deriveSignal(
  breadth: number, momentum: number, accel: number, oi: number, volume: number
): { signal: "BUY_CE" | "BUY_PE" | "WAIT"; composite: number; direction: number } {
  const composite = Math.round(
    breadth * 0.20 + momentum * 0.20 + accel * 0.25 + oi * 0.25 + volume * 0.10
  );
  const direction = composite - 50; // positive = bullish
  let signal: "BUY_CE" | "BUY_PE" | "WAIT" = "WAIT";
  if (composite >= 65 && direction > 0) signal = "BUY_CE";
  else if (composite <= 35 && direction < 0) signal = "BUY_PE";
  return { signal, composite, direction };
}

// ── Component ─────────────────────────────────────────────────────────────────

const AISignals: React.FC<Props> = ({
  stocks, optionChain, aiAnalysis, spotPrice, activePage, pcr, bullishScore, bearishScore
}) => {
  const [signalHistory, setSignalHistory] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedReason, setExpandedReason] = useState(false);
  const lastSavedRef = useRef<string>("");

  // ── Layer scores ──────────────────────────────────────────────────────────
  const breadthScore = useMemo(() => calcBreadthScore(stocks), [stocks]);
  const momentumScore = useMemo(() => calcMomentumScore(stocks), [stocks]);
  const accelScore = useMemo(() => calcAccelerationScore(stocks), [stocks]);
  const oiScore = useMemo(() => calcOIScore(optionChain, pcr), [optionChain, pcr]);
  const volumeScore = useMemo(() => calcVolumeScore(stocks), [stocks]);

  const { signal, composite, direction } = useMemo(
    () => deriveSignal(breadthScore, momentumScore, accelScore, oiScore, volumeScore),
    [breadthScore, momentumScore, accelScore, oiScore, volumeScore]
  );

  // Also consume existing Antigravity engine
  const agSignal = aiAnalysis?.antigravity?.finalSignal ?? "WAIT";
  const agConf = aiAnalysis?.antigravity?.confidence ?? 0;
  const agGrade = aiAnalysis?.antigravity?.signalGrade ?? "D";
  const agReason = aiAnalysis?.antigravity?.reasoning ?? "";

  // Best signal: take the one with higher confidence
  const finalSignal = agConf > 70 && agSignal !== "NO_TRADE" ? agSignal : signal;
  const finalConf = agConf > 70 ? agConf : (finalSignal === "BUY_PE" ? (100 - composite) : composite);

  const expirySetup = aiAnalysis?.expirySetup;
  const sgBreakdown = aiAnalysis?.antigravity?.scoreBreakdown;

  // Build reason text
  const reasonParts = useMemo(() => [
    `Market Breadth: ${breadthScore}% — ${breadthScore > 60 ? "Bullish majority advancing" : breadthScore < 40 ? "Bearish majority declining" : "Mixed breadth"}`,
    `Momentum: ${momentumScore}% — ${momentumScore > 60 ? "Stocks accelerating upward" : momentumScore < 40 ? "Stocks decelerating" : "Neutral momentum"}`,
    `Acceleration (15m): ${accelScore}% — Net score change: ${stocks.reduce((a, s) => a + (s.score15mDiff || 0), 0).toFixed(1)}`,
    `Option Chain (PCR ${pcr.toFixed(2)}): ${oiScore}% — ${oiScore > 60 ? "Put writing dominates (bullish)" : oiScore < 40 ? "Call writing dominates (bearish)" : "Balanced OI"}`,
    `Volume: ${volumeScore}% — ${volumeScore > 60 ? "Buyers driving high volume" : volumeScore < 40 ? "Sellers driving high volume" : "Average volume distribution"}`,
    agReason ? `Antigravity: ${agReason}` : "",
  ].filter(Boolean), [breadthScore, momentumScore, accelScore, oiScore, volumeScore, pcr, agReason, stocks]);

  // ── Load history ──────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl(`/api/te/signals?instrument=${activePage}&limit=20`));
      if (res.ok) {
        const data = await res.json();
        setSignalHistory(data.signals || []);
      }
    } catch { /* silent */ }
  }, [activePage]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Auto-save signal when it changes meaningfully ─────────────────────────
  useEffect(() => {
    if (finalConf < 30 || spotPrice <= 0) return;
    const key = `${finalSignal}-${Math.round(finalConf)}-${Math.round(spotPrice / 10)}`;
    if (key === lastSavedRef.current) return;
    lastSavedRef.current = key;

    const record: SignalRecord = {
      id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      signal: finalSignal,
      confidence: finalConf,
      grade: agGrade,
      instrument: activePage,
      reason: reasonParts.join(" | "),
      entry_price: spotPrice,
      stop_loss: expirySetup?.stopLoss ?? 0,
      target: expirySetup?.target ?? 0,
      result: "PENDING",
      breadth_score: breadthScore,
      momentum_score: momentumScore,
      oi_score: oiScore,
    };

    fetch(getApiUrl("/api/te/signals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).then(() => {
      setSignalHistory(prev => [record, ...prev].slice(0, 20));
    }).catch(() => {});
  }, [finalSignal, finalConf, spotPrice, activePage]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const layers = [
    { label: "Market Breadth",   score: breadthScore, weight: 20,  icon: <BarChart2 size={13} />,  color: scoreColor(breadthScore) },
    { label: "Momentum",         score: momentumScore, weight: 20, icon: <TrendingUp size={13} />, color: scoreColor(momentumScore) },
    { label: "Acceleration",     score: accelScore,   weight: 25,  icon: <Activity size={13} />,   color: scoreColor(accelScore) },
    { label: "Option Chain (OI)", score: oiScore,     weight: 25,  icon: <Layers size={13} />,     color: scoreColor(oiScore) },
    { label: "Volume",            score: volumeScore,  weight: 10, icon: <Volume2 size={13} />,    color: scoreColor(volumeScore) },
  ];

  return (
    <div className="p-4 space-y-4 min-h-full" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Zap size={18} className="text-indigo-400" />
            AI Signal Engine
          </h1>
          <p className="text-base text-slate-500 mt-0.5">4-layer composite confidence engine · {activePage}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-slate-500 font-mono">{new Date().toLocaleTimeString("en-IN")}</div>
          <button
            onClick={loadHistory}
            className="p-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Main Signal Card ── */}
      <div className={`relative rounded-2xl border overflow-hidden
        ${finalSignal === "BUY_CE"
          ? "border-emerald-500/30 bg-[#061510]"
          : finalSignal === "BUY_PE"
          ? "border-red-500/30 bg-[#150606]"
          : "border-slate-700/50 bg-[#090d1a]"
        }`}
        style={{
          boxShadow: finalSignal === "BUY_CE"
            ? "0 0 40px rgba(16,185,129,0.12)"
            : finalSignal === "BUY_PE"
            ? "0 0 40px rgba(239,68,68,0.12)"
            : "none"
        }}
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            {/* Signal + Grade */}
            <div>
              <div className="text-sm text-slate-500 uppercase tracking-widest font-black mb-2">Current Signal</div>
              <div className={`text-3xl font-black tracking-tight flex items-center gap-3
                ${finalSignal === "BUY_CE" ? "text-emerald-400" : finalSignal === "BUY_PE" ? "text-red-400" : "text-amber-400"}`}>
                {finalSignal === "BUY_CE" ? <TrendingUp size={28} /> : finalSignal === "BUY_PE" ? <TrendingDown size={28} /> : <Minus size={28} />}
                {finalSignal === "BUY_CE" ? "BUY CE" : finalSignal === "BUY_PE" ? "BUY PE" : "WAIT"}
              </div>
              {finalSignal !== "WAIT" && (
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-sm font-black px-2 py-0.5 rounded-full
                    ${agGrade === "A" ? "bg-emerald-500/20 text-emerald-400" :
                      agGrade === "B" ? "bg-blue-500/20 text-blue-400" :
                      agGrade === "C" ? "bg-amber-500/20 text-amber-400" :
                      "bg-slate-700/50 text-slate-400"}`}>
                    GRADE {agGrade}
                  </span>
                  <span className="text-sm text-slate-500">· Antigravity Engine</span>
                </div>
              )}
            </div>

            {/* Confidence Gauge */}
            <div className="text-center">
              <div className="text-sm text-slate-500 uppercase tracking-widest font-black mb-1">Confidence</div>
              <ConfidenceRing value={finalConf} />
            </div>

            {/* Entry Setup */}
            {expirySetup && expirySetup.signalType !== "WAIT" && (
              <div className="text-right">
                <div className="text-sm text-slate-500 uppercase tracking-widest font-black mb-1">Setup</div>
                <div className="text-base text-slate-300 font-mono">Strike: <span className="text-white font-bold">{expirySetup.recommendedStrike}</span></div>
                <div className="text-base text-slate-300 font-mono">SL: <span className="text-red-400 font-bold">{expirySetup.stopLoss}</span></div>
                <div className="text-base text-slate-300 font-mono">Target: <span className="text-emerald-400 font-bold">{expirySetup.target}</span></div>
                <div className="text-sm text-slate-500 mt-1">{expirySetup.strategyName}</div>
              </div>
            )}
          </div>

          {/* Reason (collapsible) */}
          <div className="mt-4 rounded-lg bg-slate-900/50 border border-slate-800/50 p-3">
            <button
              onClick={() => setExpandedReason(r => !r)}
              className="w-full flex items-center justify-between text-base text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <Info size={12} />
                Signal Reasoning
              </span>
              {expandedReason ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {expandedReason && (
              <div className="mt-2 space-y-1.5">
                {reasonParts.map((r, i) => (
                  <div key={i} className="text-base text-slate-300 flex gap-1.5">
                    <span className="text-indigo-500 mt-0.5">·</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Layer Breakdown ── */}
      <div className="grid grid-cols-5 gap-2">
        {layers.map(layer => (
          <LayerCard key={layer.label} {...layer} />
        ))}
      </div>

      {/* ── Antigravity Score Breakdown ── */}
      {sgBreakdown && (
        <div className="rounded-xl border border-slate-800/50 bg-[#080d1a] p-4">
          <div className="text-sm text-slate-500 uppercase tracking-widest font-black mb-3">Antigravity Engine Breakdown</div>
          <div className="grid grid-cols-5 gap-2">
            {[
              { label: "Market Structure", value: sgBreakdown.marketStructure, max: 30 },
              { label: "Smart Money", value: sgBreakdown.smartMoney, max: 25 },
              { label: "Breakout", value: sgBreakdown.breakoutConfirmation, max: 20 },
              { label: "Momentum", value: sgBreakdown.momentumStrength, max: 15 },
              { label: "Time Validity", value: sgBreakdown.timeValidity, max: 10 },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-sm text-slate-500 mb-1">{item.label}</div>
                <div className={`text-base font-black ${item.value > 0 ? "text-emerald-400" : item.value < 0 ? "text-red-400" : "text-slate-500"}`}>
                  {item.value > 0 ? "+" : ""}{item.value}
                </div>
                <div className="text-sm text-slate-600">/{item.max}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Signal History ── */}
      <div className="rounded-xl border border-slate-800/50 bg-[#080d1a] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between">
          <div className="text-base font-black text-slate-300 uppercase tracking-wider">Signal History</div>
          <div className="text-sm text-slate-600">Last 20 signals · Persisted to DB</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="border-b border-slate-800/50 text-sm text-slate-500 uppercase tracking-wider">
                <th className="p-2 pl-4 text-left">Time</th>
                <th className="p-2 text-left">Signal</th>
                <th className="p-2 text-center">Conf%</th>
                <th className="p-2 text-center">Grade</th>
                <th className="p-2 text-right">Entry</th>
                <th className="p-2 pr-4 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/30">
              {signalHistory.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-slate-600 py-6 text-base">No signals yet — waiting for market data</td></tr>
              ) : signalHistory.map((s, i) => (
                <tr key={s.id} className={`hover:bg-slate-800/20 transition-colors ${i % 2 === 0 ? "bg-slate-950/30" : ""}`}>
                  <td className="p-2 pl-4 text-slate-500 font-mono">{new Date(s.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="p-2">
                    <span className={`font-black text-sm px-1.5 py-0.5 rounded
                      ${s.signal === "BUY_CE" ? "bg-emerald-500/20 text-emerald-400" :
                        s.signal === "BUY_PE" ? "bg-red-500/20 text-red-400" :
                        "bg-amber-500/20 text-amber-400"}`}>
                      {s.signal}
                    </span>
                  </td>
                  <td className="p-2 text-center font-mono font-bold text-slate-300">{Math.round(s.confidence)}%</td>
                  <td className="p-2 text-center">
                    <span className={`text-sm font-black
                      ${s.grade === "A" ? "text-emerald-400" : s.grade === "B" ? "text-blue-400" : s.grade === "C" ? "text-amber-400" : "text-slate-500"}`}>
                      {s.grade || "—"}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono text-slate-300">{s.entry_price > 0 ? s.entry_price.toLocaleString("en-IN", { minimumFractionDigits: 0 }) : "—"}</td>
                  <td className="p-2 pr-4 text-right">
                    <span className={`text-sm font-semibold
                      ${s.result === "WIN" ? "text-emerald-400" : s.result === "LOSS" ? "text-red-400" : "text-slate-500"}`}>
                      {s.result}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 65) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 65) return "bg-emerald-500/10 border-emerald-500/20";
  if (score >= 50) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

const LayerCard: React.FC<{ label: string; score: number; weight: number; icon: React.ReactNode; color: string }> = ({
  label, score, weight, icon, color
}) => (
  <div className={`rounded-xl border p-3 ${scoreBg(score)}`}>
    <div className="flex items-center justify-between mb-2">
      <span className={`${color}`}>{icon}</span>
      <span className="text-sm text-slate-600 font-black">{weight}%</span>
    </div>
    <div className={`text-2xl font-black ${color}`}>{score}%</div>
    <div className="text-sm text-slate-500 mt-0.5 leading-tight">{label}</div>
    <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${score >= 65 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"}`}
        style={{ width: `${score}%` }}
      />
    </div>
  </div>
);

const ConfidenceRing: React.FC<{ value: number }> = ({ value }) => {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, Math.max(0, value)) / 100);
  const color = value >= 65 ? "#10b981" : value >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative w-20 h-20 flex items-center justify-center">
      <svg width="80" height="80" className="-rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={r} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xl font-black text-white leading-none">{Math.round(value)}</div>
        <div className="text-sm text-slate-500 font-mono">CONF%</div>
      </div>
    </div>
  );
};

export default AISignals;

