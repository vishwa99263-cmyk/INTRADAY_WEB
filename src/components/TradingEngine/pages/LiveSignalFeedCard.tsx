/**
 * LiveSignalFeedCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Live Option Chain Paper Trade Signal Feed Card (Bottom-Left Widget Panel)
 *
 * Sticky collapsible HUD panel displaying real-time Option Chain signals,
 * live premium LTPs, OI changes, EAME statuses, and active paper trade flow.
 *
 * Pure Display Layer consuming real socket Option Chain strikes and EAME states.
 */
import React, { useState, useMemo, useEffect, useRef } from "react";
import { Radio, ChevronDown, ChevronUp, Zap, TrendingUp, TrendingDown, ShieldOff, X, Volume2, VolumeX } from "lucide-react";
import type { MarketTimeEngineResult } from "../../../engine/marketTimeEngine";
import type { RiskEngineResult }       from "../../../engine/riskEngine";
import type { AIDecisionResult }       from "../../../engine/aiDecisionEngine";
import type { StrategiesEngineOutput } from "../../../engine/strategiesEngine";
import type { OptionFlowEngineOutput } from "../../../engine/optionFlowEngine";
import type { ProbabilityEngineResult, PMAEAlert } from "../../../engine/probabilityEngine";
import type { RTSignalOutput }         from "../../../engine/rtpodeEngine";
import type { OptionBuyingSetup }      from "../../../engine/optionBuyingSetupEngine";
import type { MultiIndexOptionResult } from "../../../engine/multiIndexOptionEngine";
import type { AiBrainResult }          from "../../../engine/aiBrainEngine";
import type { SignalMemoryResult }      from "../../../engine/signalMemoryEngine";
import type { PatternRecognitionResult } from "../../../engine/patternRecognitionEngine";
import type { TEPaperTrade, OptionStrike } from "../../../types";
import { useAMEXNotifications, AMEXToastContainer } from "../../../hooks/useAMEXNotifications";
import { useJarvisVoice } from "../../../hooks/useJarvisVoice";
import AiBrainPanel from "./AiBrainPanel";

export interface LiveSignalFeedProps {
  activePage: string;
  spotPrice: number;
  marketTimeResult: MarketTimeEngineResult;
  riskResult: RiskEngineResult;
  aiDecisionResult: AIDecisionResult;
  strategiesResult: StrategiesEngineOutput;
  openPositions: any[];
  dbTrades: TEPaperTrade[];
  optionChain?: OptionStrike[];
  optionFlowResult?: OptionFlowEngineOutput;
  probabilityResult?: ProbabilityEngineResult;
  rtpodeResult?: RTSignalOutput;          // RTPODE profit scanner
  optionBuyingSetup?: OptionBuyingSetup;  // AMEX L15: CE/PE Buy Setup Engine
  multiIndexResult?: MultiIndexOptionResult; // AMEX L5.5: Multi-Index Intelligence
  aiBrainResult?: AiBrainResult;           // AMEX L16: AI Brain Synthesizer
  signalMemoryResult?: SignalMemoryResult; // AMEX L17: Signal Memory
  patternResult?: PatternRecognitionResult; // AMEX L18: Pattern Recognition
  isInline?: boolean;
  brainLocked?: boolean;
  onToggleBrainLock?: () => void;
}

const LiveSignalFeedCard: React.FC<LiveSignalFeedProps> = (props) => {
  const {
    activePage,
    spotPrice,
    marketTimeResult,
    riskResult,
    aiDecisionResult,
    strategiesResult,
    openPositions,
    dbTrades,
    optionChain = [],
    optionFlowResult,
    probabilityResult,
    rtpodeResult,
    optionBuyingSetup,
    multiIndexResult,
    aiBrainResult,
    signalMemoryResult,
    patternResult,
    isInline = false,
    brainLocked = false,
    onToggleBrainLock,
  } = props;

  const [isOpen, setIsOpen] = useState(true);
  const [activeAlert, setActiveAlert] = useState<PMAEAlert | null>(null);
  const [isExitUpdateVisible, setIsExitUpdateVisible] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  // Jarvis Voice Assistant (L20)
  const { isMuted, toggleMute, speak, voicesLoaded } = useJarvisVoice();

  // 1-Lot Strict Mode State
  const [isStrictOneLot, setIsStrictOneLot] = useState(true);
  useEffect(() => {
    try {
      const riskSettings = JSON.parse(window.localStorage.getItem("te_risk_settings") || "{}");
      if (riskSettings.strictOneLotMode !== undefined) {
        setIsStrictOneLot(riskSettings.strictOneLotMode);
      }
    } catch (e) {}
  }, []);

  // Rate-limiting alert generation to 1 per 10-15 minutes minimum
  useEffect(() => {
    const currentAlert = probabilityResult?.pmaeAlert;
    if (currentAlert) {
      const now = Date.now();
      const isNew = !activeAlert ||
                    activeAlert.direction !== currentAlert.direction ||
                    (now - activeAlert.timestamp >= 10 * 60 * 1000);
      if (isNew) {
        setActiveAlert({
          ...currentAlert,
          timestamp: now
        });
        
        // Voice Announcement for PMAE Alerts
        if (currentAlert.direction === "BULLISH") {
          speak(`Alert. ${activePage} Bullish momentum detected. ${currentAlert.message}`, "URGENT", 0);
        } else if (currentAlert.direction === "BEARISH") {
          speak(`Alert. ${activePage} Bearish momentum detected. ${currentAlert.message}`, "URGENT", 0);
        }
      }
    } else {
      if (activeAlert && (Date.now() - activeAlert.timestamp >= 10 * 60 * 1000)) {
        setActiveAlert(null);
      }
    }
  }, [probabilityResult?.pmaeAlert, activeAlert, activePage, speak]);

  // Voice Announcement for AI Brain Master Verdict Changes
  const prevBrainDecisionRef = useRef<string>("WAIT");
  useEffect(() => {
    if (aiBrainResult) {
      if (aiBrainResult.finalDecision !== prevBrainDecisionRef.current && aiBrainResult.finalDecision !== "WAIT") {
        if (aiBrainResult.convictionScore >= 75) {
          const type = aiBrainResult.finalDecision === "BUY_CE" ? "Call" : "Put";
          speak(`AI Brain conviction reached ${aiBrainResult.convictionScore} percent. Executing ${type} trade protocol.`, "URGENT", 0);
        }
        prevBrainDecisionRef.current = aiBrainResult.finalDecision;
      }
    }
  }, [aiBrainResult?.finalDecision, aiBrainResult?.convictionScore, speak]);

  // 1. Calculate Local Option Chain Signal Engine metrics as fallbacks
  const spotPx = spotPrice || 0;
  const strikeGap = activePage === "SENSEX" ? 100 : 50;
  const localAtmStrike = spotPx > 0 ? Math.round(spotPx / strikeGap) * strikeGap : 0;
  const atmRow = optionChain.find(s => s.strikePrice === (optionFlowResult?.activeDecision.strike || localAtmStrike));

  // PCR Calculation from strikes
  const totalCallOi = optionChain.reduce((sum, s) => sum + s.ceOI, 0);
  const totalPutOi = optionChain.reduce((sum, s) => sum + s.peOI, 0);
  const pcrVal = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(2)) : 1.0;

  // Average volumes for spike calculation
  const avgCeVolume = optionChain.length > 0 ? optionChain.reduce((sum, s) => sum + s.ceVolume, 0) / optionChain.length : 0;
  const avgPeVolume = optionChain.length > 0 ? optionChain.reduce((sum, s) => sum + s.peVolume, 0) / optionChain.length : 0;

  // BUY CE Conditions — AMEX relaxed: any 2-of-4 key conditions
  const isSpotNearStrike    = localAtmStrike > 0 && Math.abs(spotPx - localAtmStrike) <= strikeGap * 0.4;
  const isBreakoutConfirmed = strategiesResult.signal === "BUY_CE" || aiDecisionResult.finalDecision === "BUY_CE";
  const isPeOiIncreasing    = atmRow ? atmRow.peOIChange > 0 : false;
  const isCeOiUnwinding     = atmRow ? atmRow.ceOIChange < 0 : false;
  const isCeVolumeSpike     = atmRow ? atmRow.ceVolume > avgCeVolume * 1.15 : false;
  const isPcrCeTrigger      = pcrVal > 1.04; // relaxed from 1.05
  // AMEX: require 2-of-4 CE conditions
  const ceConds = [isPeOiIncreasing, isCeOiUnwinding, isCeVolumeSpike, isPcrCeTrigger].filter(Boolean).length;
  const buyCeSignal = (isSpotNearStrike || isBreakoutConfirmed) && ceConds >= 2;

  // BUY PE Conditions — AMEX relaxed: any 2-of-4 key conditions
  const isSpotBreaksSupport = localAtmStrike > 0 && spotPx < localAtmStrike;
  const isCeOiIncreasing    = atmRow ? atmRow.ceOIChange > 0 : false;
  const isPeOiUnwinding     = atmRow ? atmRow.peOIChange < 0 : false;
  const isPeVolumeSpike     = atmRow ? atmRow.peVolume > avgPeVolume * 1.15 : false;
  const isPcrPeTrigger      = pcrVal < 0.96; // relaxed from 0.95
  // AMEX: require 2-of-4 PE conditions
  const peConds = [isCeOiIncreasing, isPeOiUnwinding, isPeVolumeSpike, isPcrPeTrigger].filter(Boolean).length;
  const buyPeSignal = isSpotBreaksSupport && peConds >= 2;

  let localSignal: "BUY_CE" | "BUY_PE" | "WAIT" = "WAIT";
  if (optionChain.length > 0) {
    if (buyCeSignal) localSignal = "BUY_CE";
    else if (buyPeSignal) localSignal = "BUY_PE";
  }

  // 2. Consume central Option Flow calculations if available, else use fallbacks
  const detectedSignal = optionFlowResult ? optionFlowResult.activeDecision.direction : localSignal;
  const optionConfidence = optionFlowResult ? optionFlowResult.activeDecision.confidence : 50;
  const atmStrike = optionFlowResult ? optionFlowResult.activeDecision.strike : localAtmStrike;
  const liquidity = optionFlowResult ? optionFlowResult.activeDecision.liquidity : "LOW";
  const smartMoney = optionFlowResult ? optionFlowResult.activeDecision.smartMoney : "NEUTRAL";
  const oiFlow = optionFlowResult ? optionFlowResult.activeDecision.oiFlow : "NEUTRAL";
  const trapRisk = optionFlowResult ? optionFlowResult.activeDecision.trapRisk : "LOW";
  const expiryMode = optionFlowResult ? optionFlowResult.expiryMode : "NORMAL";
  const riskMultiplier = optionFlowResult ? optionFlowResult.riskMultiplier : 1.0;

  // Formatting helpers
  const formatOi = (oi: number) => {
    if (oi >= 100000) return `${(oi / 100000).toFixed(1)}L`;
    if (oi >= 1000) return `${(oi / 1000).toFixed(1)}K`;
    return String(oi);
  };

  const formatOiChange = (oi: number) => {
    return `${(oi / 100000).toFixed(3)}L`;
  };

  // Derive Reasons Stack
  const signalReasons = useMemo(() => {
    if (optionFlowResult) return optionFlowResult.reasons;

    const reasons: string[] = [];
    if (optionChain.length === 0) {
      reasons.push("⚠ Option chain data stream is offline");
      return reasons;
    }

    if (detectedSignal === "BUY_CE") {
      reasons.push("✔ Call Unwinding detected (CE OI ↓)");
      reasons.push("✔ Put Writing support building (PE OI ↑)");
      reasons.push("✔ Volume spike in CE LTP");
      reasons.push(`✔ PCR imbalance (${pcrVal})`);
      reasons.push(isBreakoutConfirmed ? "✔ Breakout confirmed" : "✔ Strike support holding");
    } else if (detectedSignal === "BUY_PE") {
      reasons.push("✔ Call Writing resistance building (CE OI ↑)");
      reasons.push("✔ Put Unwinding detected (PE OI ↓)");
      reasons.push("✔ Volume spike in PE LTP");
      reasons.push(`✔ PCR imbalance (${pcrVal})`);
      reasons.push("✔ Support strike broken");
    } else {
      if (!isPeOiIncreasing && !isCeOiIncreasing) reasons.push("✔ OI writing is flat (no active writers)");
      if (!isCeOiUnwinding && !isPeOiUnwinding) reasons.push("✔ No active unwinding detected");
      if (!isCeVolumeSpike && !isPeVolumeSpike) reasons.push("✔ Volume is within normal bounds");
      if (pcrVal >= 0.95 && pcrVal <= 1.05) reasons.push(`✔ PCR is in neutral equilibrium (${pcrVal})`);
      else reasons.push(`✔ PCR bias is ${pcrVal > 1.05 ? "bullish" : "bearish"} (${pcrVal})`);
    }
    return reasons;
  }, [optionChain.length, detectedSignal, pcrVal, isBreakoutConfirmed, isPeOiIncreasing, isCeOiIncreasing, isCeOiUnwinding, isPeOiUnwinding, isCeVolumeSpike, isPeVolumeSpike, isSpotNearStrike, optionFlowResult]);

  // AMEX: Unlimited daily trades (hard cap removed — risk engine enforces ₹3,000 limit instead)
  const todayStr = new Date().toDateString();
  const tradesToday = useMemo(() => {
    return dbTrades.filter(
      t => new Date(t.timestamp).toDateString() === todayStr
    ).length;
  }, [dbTrades, todayStr]);
  const limitStatus = riskResult.circuitBreakerActive ? "BLOCKED" : "ACTIVE";

  // Force-signal timer: track seconds since last non-WAIT signal
  const lastSignalRef = useRef<number>(0);
  const [secSinceSignal, setSecSinceSignal] = useState(0);
  useEffect(() => {
    if (detectedSignal !== "WAIT") lastSignalRef.current = Date.now();
    const t = setInterval(() => {
      setSecSinceSignal(lastSignalRef.current > 0 ? Math.floor((Date.now() - lastSignalRef.current) / 1000) : 0);
    }, 1000);
    return () => clearInterval(t);
  }, [detectedSignal]);
  const forceSignalWarning = secSinceSignal > 0 && secSinceSignal >= 300; // >5 minutes

  // AMEX Notifications
  const { toasts, fireNotification, dismissToast } = useAMEXNotifications();
  const prevSignalRef = useRef<string>("WAIT");
  useEffect(() => {
    if (detectedSignal !== "WAIT" && detectedSignal !== prevSignalRef.current) {
      prevSignalRef.current = detectedSignal;
      const isCE = detectedSignal === "BUY_CE";
      fireNotification({
        signalId: `lsf-${detectedSignal}-${Math.floor(Date.now() / 60000)}`,
        type: isCE ? "BUY_CE" : "BUY_PE",
        title: isCE ? "⚡ BUY CE SIGNAL" : "⚡ BUY PE SIGNAL",
        message: `${activePage} ${isCE ? "Call" : "Put"} setup detected | PCR: ${pcrVal} | Conf: ${optionConfidence}%`,
        confidence: optionConfidence,
        strike: atmStrike,
        playSound: true,
      });
    }
  }, [detectedSignal, activePage, pcrVal, optionConfidence, atmStrike, fireNotification]);

  // RTPODE Notifications — only fire on a genuine new signal
  const prevRtpodeSignalRef = useRef<string>("");
  useEffect(() => {
    if (!rtpodeResult) return;
    if (
      rtpodeResult.direction !== "NO_SIGNAL" &&
      rtpodeResult.signalId &&
      rtpodeResult.signalId !== prevRtpodeSignalRef.current
    ) {
      prevRtpodeSignalRef.current = rtpodeResult.signalId;
      const isCE = rtpodeResult.direction === "BUY_CE";
      fireNotification({
        signalId: rtpodeResult.signalId,
        type: isCE ? "BUY_CE" : "BUY_PE",
        title: `🏦 RTPODE: ${isCE ? "BUY CE" : "BUY PE"} — ₹${rtpodeResult.optionProfitMin}+ POTENTIAL`,
        message: `${activePage} | Conf: ${rtpodeResult.confidence}% | Move: ${rtpodeResult.expectedMovePoints}pts | Vol: ${rtpodeResult.volatilityScore.toFixed(0)}`,
        confidence: rtpodeResult.confidence,
        strike: rtpodeResult.atmStrike,
        playSound: true,
      });
    }
  }, [rtpodeResult, activePage, fireNotification]);

  // Last Closed Position (Last Exit Area)
  const lastClosedTrade = useMemo(() => {
    const closed = dbTrades.filter(t => t.status === "CLOSED");
    if (closed.length === 0) return null;
    return [...closed].sort((a, b) => (b.closed_at || b.timestamp) - (a.closed_at || a.timestamp))[0];
  }, [dbTrades]);

  // Re-show exit update area when a new closed trade occurs
  useEffect(() => {
    if (lastClosedTrade) {
      setIsExitUpdateVisible(true);
    }
  }, [lastClosedTrade?.timestamp, lastClosedTrade?.instrument]);

  // Extract exit information
  const exitDetails = useMemo(() => {
    if (!lastClosedTrade) return null;
    const points = lastClosedTrade.exit_price - lastClosedTrade.entry_price;
    const reasonStr = lastClosedTrade.notes && lastClosedTrade.notes.includes("Closed:") 
      ? lastClosedTrade.notes.split("Closed:")[1].replace("]", "").trim() 
      : "OI Reversal / Target Hit";
    return {
      entry: lastClosedTrade.entry_price,
      exit: lastClosedTrade.exit_price,
      points: parseFloat(points.toFixed(1)),
      reason: reasonStr,
    };
  }, [lastClosedTrade]);

  // Active floating positions
  const activeTrade = openPositions.length > 0 ? openPositions[0] : null;

  // Dynamic liquidity color blocks
  const getLiquidityBlocks = () => {
    if (liquidity === "HIGH") return "██████████";
    if (liquidity === "MEDIUM") return "██████░░░░";
    return "██░░░░░░░░";
  };

  return (
    <>
      {/* AMEX Global Toast Container */}
      <AMEXToastContainer toasts={toasts} onDismiss={dismissToast} />

      {isVisible && (
        <div
          className={`${isInline ? "w-full max-w-md mx-auto" : "fixed bottom-4 left-4 z-50 w-80"} rounded-xl overflow-hidden transition-all duration-300 font-mono text-sm border relative`}
          style={{
            background: "linear-gradient(135deg, #03050a 0%, #060a14 100%)",
            borderColor: detectedSignal !== "WAIT" ? "rgba(16,185,129,0.3)" : forceSignalWarning ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.05)",
            boxShadow: forceSignalWarning ? "0 10px 30px rgba(245,158,11,0.15)" : "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          {/* Close Panel Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsVisible(false);
            }}
            className="absolute top-2.5 right-2.5 z-55 text-slate-400 hover:text-red-500 cursor-pointer transition-colors"
            title="Close Panel"
          >
            <X size={12} />
          </button>

          {/* Header */}
          <div
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center justify-between px-3 py-2 cursor-pointer bg-slate-950/80 border-b border-white/5 select-none"
          >
            <div className="flex items-center gap-1.5">
              <Radio size={12} className={detectedSignal !== "WAIT" ? "text-emerald-400 animate-pulse" : "text-slate-500"} />
              <span className="font-black text-slate-200 tracking-wider">
                ⚡ AMEX SIGNAL FEED
              </span>
              {forceSignalWarning && (
                <span className="text-sm font-black text-amber-400 bg-amber-900/30 border border-amber-600/40 px-1 py-0.5 rounded animate-pulse">
                  {Math.floor(secSinceSignal / 60)}m SILENT
                </span>
              )}
              {isStrictOneLot && (
                <span className="text-[9px] font-black text-emerald-400 bg-emerald-900/30 border border-emerald-500/40 px-1 py-0.5 rounded ml-1 tracking-widest whitespace-nowrap">
                  1-LOT
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mr-4">
              <button
                onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                className={`p-1 rounded flex items-center gap-1 transition-colors ${
                  isMuted ? "text-slate-500 bg-slate-900/50 hover:bg-slate-800" : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30"
                }`}
                title={isMuted ? "Enable Jarvis Voice Assistant" : "Mute Jarvis Voice Assistant"}
              >
                {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} className="animate-pulse" />}
                <span className="text-[9px] font-black font-mono">JARVIS</span>
              </button>
              {isOpen ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronUp size={12} className="text-slate-400" />}
            </div>
          </div>

      {isOpen && (
        <div className="p-3.5 space-y-3.5">
          {/* PMAE Alert Card */}
          {activeAlert && (
            <div className="space-y-2 p-3 rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/30 to-slate-950/80 shadow-[0_0_15px_rgba(99,102,241,0.12)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-[1.5px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1 animate-pulse">
                  🚨 PMAE MARKET MOVE ALERT
                </span>
                <span className="text-sm text-slate-500 font-mono">LIVE</span>
              </div>

              <div className="mt-1">
                <div className="text-base font-black tracking-wider flex items-center gap-1.5" style={{ color: activeAlert.direction === "UP" ? "#10b981" : "#ef4444" }}>
                  {activeAlert.direction === "UP" ? "🟢 UP MOVE EXPECTED" : "🔴 DOWN MOVE EXPECTED"}
                  <span className="text-white text-sm font-extrabold bg-white/10 px-1 py-0.2 rounded font-mono">
                    {activeAlert.confidence}%
                  </span>
                </div>
                <div className="text-sm text-slate-300 font-bold mt-0.5">
                  Expected Move: <span className="text-indigo-300">{activeAlert.expectedMove}</span>
                </div>
              </div>

              <div className="space-y-1 pt-1.5 border-t border-slate-900/60 mt-1">
                <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">REASON SUMMARY:</span>
                <div className="space-y-0.5 font-mono text-sm">
                  {activeAlert.reasons.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-slate-300">
                      <span className="text-emerald-400">✔</span>
                      <span>{r.replace("✔", "").trim()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── RTPODE: Profit Opportunity Panel ────────────────────────── */}
          {rtpodeResult && (
            <div
              className="space-y-2 p-3 rounded-xl border relative overflow-hidden"
              style={{
                background: rtpodeResult.direction === "BUY_CE"
                  ? "linear-gradient(135deg,rgba(16,185,129,0.08) 0%,rgba(5,8,18,0.95) 100%)"
                  : rtpodeResult.direction === "BUY_PE"
                  ? "linear-gradient(135deg,rgba(239,68,68,0.08) 0%,rgba(5,8,18,0.95) 100%)"
                  : "linear-gradient(135deg,rgba(15,23,42,0.6) 0%,rgba(5,8,18,0.95) 100%)",
                borderColor: rtpodeResult.direction === "BUY_CE"
                  ? "rgba(16,185,129,0.35)"
                  : rtpodeResult.direction === "BUY_PE"
                  ? "rgba(239,68,68,0.35)"
                  : "rgba(255,255,255,0.06)",
                boxShadow: rtpodeResult.direction !== "NO_SIGNAL"
                  ? `0 0 20px ${rtpodeResult.direction === "BUY_CE" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)"}`
                  : "none",
              }}
            >
              {/* Gradient top bar */}
              <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
                background: rtpodeResult.direction === "BUY_CE"
                  ? "linear-gradient(90deg,transparent,#10b981,transparent)"
                  : rtpodeResult.direction === "BUY_PE"
                  ? "linear-gradient(90deg,transparent,#ef4444,transparent)"
                  : "linear-gradient(90deg,transparent,#334155,transparent)",
              }} />

              {/* Header row */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  🏦 RTPODE SCANNER
                </span>
                <span className={`text-sm font-black px-1.5 py-0.5 rounded border tracking-wider ${
                  rtpodeResult.direction === "BUY_CE"
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 animate-pulse"
                    : rtpodeResult.direction === "BUY_PE"
                    ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse"
                    : "bg-slate-900 border-slate-800 text-slate-500"
                }`}>
                  {rtpodeResult.direction === "BUY_CE" ? "🟢 BUY CE" : rtpodeResult.direction === "BUY_PE" ? "🔴 BUY PE" : "⛔ NO SIGNAL"}
                </span>
              </div>

              {/* Signal body — only show detailed stats when signal fires */}
              {rtpodeResult.direction !== "NO_SIGNAL" ? (
                <div className="space-y-2">
                  {/* Confidence + ATM */}
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm text-slate-500 uppercase tracking-wider">Confidence</span>
                      <span className={`text-[16px] font-black font-mono ${rtpodeResult.direction === "BUY_CE" ? "text-emerald-400" : "text-red-400"}`}>
                        {rtpodeResult.confidence}%
                      </span>
                    </div>
                    <div className="flex flex-col border-l border-slate-800/60 pl-3">
                      <span className="text-sm text-slate-500 uppercase tracking-wider">ATM Strike</span>
                      <span className="text-base font-black font-mono text-slate-200">{rtpodeResult.atmStrike}</span>
                    </div>
                    <div className="flex flex-col border-l border-slate-800/60 pl-3">
                      <span className="text-sm text-slate-500 uppercase tracking-wider">Vol Score</span>
                      <span className="text-base font-black font-mono text-amber-400">{rtpodeResult.volatilityScore.toFixed(0)}</span>
                    </div>
                  </div>

                  {/* Score bars */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-emerald-500 font-black uppercase">UP SCORE</span>
                      <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${rtpodeResult.upScore}%` }} />
                      </div>
                      <span className="text-sm font-mono text-emerald-400 font-black">{rtpodeResult.upScore}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-red-500 font-black uppercase">DOWN SCORE</span>
                      <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${rtpodeResult.downScore}%` }} />
                      </div>
                      <span className="text-sm font-mono text-red-400 font-black">{rtpodeResult.downScore}</span>
                    </div>
                  </div>

                  {/* Expected Move + Profit */}
                  <div className="p-2 rounded-lg border border-slate-800/60 bg-slate-950/40 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400 font-bold">Expected Move</span>
                      <span className="text-sm font-black font-mono text-white">±{rtpodeResult.expectedMovePoints} pts</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400 font-bold">Profit Potential</span>
                      <span className="text-sm font-black font-mono text-amber-300">₹{rtpodeResult.optionProfitMin} – ₹{rtpodeResult.optionProfitMax}</span>
                    </div>
                  </div>

                  {/* Confirmed reasons */}
                  {rtpodeResult.reasons.length > 0 && (
                    <div className="space-y-0.5">
                      {rtpodeResult.reasons.slice(0, 4).map((r, i) => (
                        <div key={i} className="flex items-center gap-1 text-sm font-mono text-slate-300">
                          <span className="text-emerald-400 font-black">✔</span>
                          <span>{r.replace("✔ ", "")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* NO_SIGNAL: show why it was blocked */
                <div className="space-y-0.5 pt-0.5">
                  <span className="text-sm font-black text-slate-600 uppercase tracking-wider block">Why no signal:</span>
                  {rtpodeResult.blockedReasons.slice(0, 3).map((r, i) => (
                    <div key={i} className="flex items-start gap-1 text-sm font-mono text-slate-500">
                      <span className="text-red-600 mt-0.5">•</span>
                      <span>{r.replace("❌ ", "")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── AMEX L15: Option Buying Setup Panel ────────────────────── */}
          {optionBuyingSetup && optionBuyingSetup.direction !== "WAIT" && optionBuyingSetup.selectedStrike && optionBuyingSetup.levels && (
            <div
              className="space-y-2 p-3 rounded-xl border relative overflow-hidden"
              style={{
                background: optionBuyingSetup.direction === "BUY_CE"
                  ? "linear-gradient(135deg,rgba(16,185,129,0.10) 0%,rgba(3,7,18,0.97) 100%)"
                  : "linear-gradient(135deg,rgba(239,68,68,0.10) 0%,rgba(3,7,18,0.97) 100%)",
                borderColor: optionBuyingSetup.direction === "BUY_CE"
                  ? "rgba(16,185,129,0.40)"
                  : "rgba(239,68,68,0.40)",
                boxShadow: optionBuyingSetup.direction === "BUY_CE"
                  ? "0 0 24px rgba(16,185,129,0.12)"
                  : "0 0 24px rgba(239,68,68,0.12)",
              }}
            >
              {/* Gradient shimmer line */}
              <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
                background: optionBuyingSetup.direction === "BUY_CE"
                  ? "linear-gradient(90deg,transparent,#10b981,transparent)"
                  : "linear-gradient(90deg,transparent,#ef4444,transparent)",
              }} />

              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  🎯 BUYING SETUP ENGINE
                </span>
                <div className="flex items-center gap-1.5">
                  {/* Tier badge */}
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border tracking-wider ${
                    optionBuyingSetup.tier === "TIER_1_INSTITUTIONAL"
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-400"
                      : optionBuyingSetup.tier === "TIER_2_PROBABILISTIC"
                      ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-400"
                      : "bg-slate-700/30 border-slate-700/40 text-slate-400"
                  }`}>
                    {optionBuyingSetup.tier === "TIER_1_INSTITUTIONAL" ? "T1 INST" : optionBuyingSetup.tier === "TIER_2_PROBABILISTIC" ? "T2 PROB" : "T3 SPEC"}
                  </span>
                  <span className={`text-xs font-black px-1.5 py-0.5 rounded border tracking-wider animate-pulse ${
                    optionBuyingSetup.direction === "BUY_CE"
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                      : "bg-red-500/20 border-red-500/40 text-red-400"
                  }`}>
                    {optionBuyingSetup.direction === "BUY_CE" ? "🟢 BUY CE" : "🔴 BUY PE"}
                  </span>
                </div>
              </div>

              {/* Strike + Quality Score */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Strike</span>
                  <span className="text-base font-black font-mono text-slate-100">
                    {optionBuyingSetup.selectedStrike.strikePrice}
                    <span className="text-xs text-slate-500 font-normal ml-1">{optionBuyingSetup.selectedStrike.position}</span>
                  </span>
                </div>
                <div className="flex flex-col border-l border-slate-800/60 pl-3">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Quality</span>
                  <span className={`text-base font-black font-mono ${
                    optionBuyingSetup.setupScore >= 75 ? "text-emerald-400"
                      : optionBuyingSetup.setupScore >= 50 ? "text-amber-400"
                      : "text-red-400"
                  }`}>
                    {optionBuyingSetup.setupScore}
                    <span className="text-slate-500 text-xs font-normal">/100</span>
                  </span>
                </div>
                <div className="flex flex-col border-l border-slate-800/60 pl-3">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">R:R</span>
                  <span className="text-base font-black font-mono text-indigo-400">
                    1:{optionBuyingSetup.levels.riskReward.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Premium Levels Table */}
              <div className="grid grid-cols-4 gap-1 text-center">
                <div className="flex flex-col p-1 rounded bg-slate-950/60 border border-slate-900">
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider">ENTRY</span>
                  <span className="text-xs font-black font-mono text-white">
                    ₹{optionBuyingSetup.levels.entryPremium.toFixed(0)}
                  </span>
                </div>
                <div className="flex flex-col p-1 rounded bg-slate-950/60 border border-red-900/40">
                  <span className="text-[9px] text-red-500 uppercase tracking-wider">SL</span>
                  <span className="text-xs font-black font-mono text-red-400">
                    ₹{optionBuyingSetup.levels.slPremium.toFixed(0)}
                  </span>
                </div>
                <div className="flex flex-col p-1 rounded bg-slate-950/60 border border-emerald-900/40">
                  <span className="text-[9px] text-emerald-500 uppercase tracking-wider">T1</span>
                  <span className="text-xs font-black font-mono text-emerald-400">
                    ₹{optionBuyingSetup.levels.t1Premium.toFixed(0)}
                  </span>
                </div>
                <div className="flex flex-col p-1 rounded bg-slate-950/60 border border-amber-900/40">
                  <span className="text-[9px] text-amber-500 uppercase tracking-wider">T2</span>
                  <span className="text-xs font-black font-mono text-amber-400">
                    ₹{optionBuyingSetup.levels.t2Premium.toFixed(0)}
                  </span>
                </div>
              </div>

              {/* P&L per lot */}
              <div className="flex justify-between items-center text-xs border-t border-slate-900/60 pt-1.5">
                <span className="text-slate-500 font-bold">Risk/lot</span>
                <span className="text-red-400 font-black font-mono">-₹{optionBuyingSetup.levels.riskPerLot.toLocaleString("en-IN")}</span>
                <span className="text-slate-500 font-bold">T1 Reward</span>
                <span className="text-emerald-400 font-black font-mono">+₹{optionBuyingSetup.levels.rewardT1PerLot.toLocaleString("en-IN")}</span>
              </div>

              {/* Spot levels */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-600">Spot SL</span>
                <span className="text-red-400 font-mono font-bold">{optionBuyingSetup.spotSL}</span>
                <span className="text-slate-600">Spot T1</span>
                <span className="text-emerald-400 font-mono font-bold">{optionBuyingSetup.spotT1}</span>
                <span className="text-slate-600">T2</span>
                <span className="text-amber-400 font-mono font-bold">{optionBuyingSetup.spotT2}</span>
              </div>

              {/* Triggered conditions */}
              {optionBuyingSetup.triggeredBy.length > 0 && (
                <div className="space-y-0.5 border-t border-slate-900/60 pt-1.5">
                  {optionBuyingSetup.triggeredBy.slice(0, 3).map((t, i) => (
                    <div key={i} className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                      <span className={optionBuyingSetup.direction === "BUY_CE" ? "text-emerald-500" : "text-red-500"}>▸</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Expiry note */}
              {optionBuyingSetup.expiryNote && (
                <div className="text-[10px] text-indigo-400 italic border-t border-slate-900/40 pt-1">
                  📅 {optionBuyingSetup.expiryNote}
                </div>
              )}
            </div>
          )}

          {/* ── AMEX L5.5: Multi-Index Intelligence Panel ───────────────── */}
          {multiIndexResult && (
            <div className="space-y-1.5 p-2.5 rounded-lg border border-slate-900/80 bg-slate-950/40">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  🌐 MULTI-INDEX INTELLIGENCE
                </span>
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border tracking-wider ${
                  multiIndexResult.overallBias === "BULLISH"
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                    : multiIndexResult.overallBias === "BEARISH"
                    ? "bg-red-500/20 border-red-500/40 text-red-400"
                    : multiIndexResult.overallBias === "DIVERGENT"
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-400 animate-pulse"
                    : "bg-slate-800/50 border-slate-700 text-slate-400"
                }`}>
                  {multiIndexResult.overallBias}
                </span>
              </div>

              {/* Composite score bar */}
              <div className="space-y-0.5">
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Composite Score</span>
                  <span className="font-mono font-black text-slate-300">{multiIndexResult.compositeScore} / 100</span>
                </div>
                <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      multiIndexResult.compositeScore >= 55 ? "bg-emerald-500"
                        : multiIndexResult.compositeScore <= 45 ? "bg-red-500"
                        : "bg-slate-500"
                    }`}
                    style={{ width: `${multiIndexResult.compositeScore}%` }}
                  />
                </div>
              </div>

              {/* Per-index mini badges */}
              <div className="flex gap-1 flex-wrap">
                {multiIndexResult.indexSnapshots.slice(0, 3).map((snap) => (
                  <div key={snap.name} className="flex flex-col items-center px-1.5 py-0.5 rounded border border-slate-800/60 bg-slate-950/60">
                    <span className="text-[9px] text-slate-500 font-bold">{snap.name}</span>
                    <span className={`text-[10px] font-black ${
                      snap.pcrBias === "BULLISH" ? "text-emerald-400" : snap.pcrBias === "BEARISH" ? "text-red-400" : "text-slate-400"
                    }`}>
                      PCR {snap.pcr.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Divergence / Trap alert */}
              {(multiIndexResult.divergenceDetected || multiIndexResult.crossIndexTrap) && (
                <div className="text-[10px] text-amber-400 font-bold border-t border-slate-900/50 pt-1 flex items-center gap-1">
                  <span className="animate-pulse">⚠</span>
                  <span>{multiIndexResult.crossIndexTrap ? multiIndexResult.trapDescription : multiIndexResult.divergenceDescription}</span>
                </div>
              )}

              {/* VIX override warning */}
              {multiIndexResult.vixOverride && (
                <div className="text-[10px] text-red-400 font-bold flex items-center gap-1">
                  <span>🔺</span>
                  <span>High VIX — signals suppressed (Conf: {multiIndexResult.vixAdjustedConfidence}%)</span>
                </div>
              )}
            </div>
          )}

          {/* ── AMEX L16: AI Brain Synthesizer Panel ─────────────────────── */}
          {aiBrainResult && (
            <AiBrainPanel
              aiBrainResult={aiBrainResult}
              signalMemoryResult={signalMemoryResult}
              patternResult={patternResult}
              brainLocked={brainLocked}
              onToggleBrainLock={onToggleBrainLock}
            />
          )}

          {/* Low Volatility NO TRADE ZONE */}
          {!activeAlert && (
            <div className="space-y-2 p-3 rounded-xl border border-slate-900 bg-slate-950/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-slate-500 uppercase tracking-wider">ZONE STATUS</span>
                <span className="text-sm font-black px-1.5 py-0.2 rounded border border-slate-800 bg-slate-900/50 text-slate-400">
                  NO TRADE ZONE
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm font-mono text-slate-400 pt-1">
                <div className="flex flex-col p-1.5 rounded border border-slate-900/50 bg-slate-950/20">
                  <span className="text-sm text-slate-500 font-black">UPBREAK PROB</span>
                  <span className="text-white font-extrabold mt-0.5">{probabilityResult?.upProbability ?? 50}%</span>
                </div>
                <div className="flex flex-col p-1.5 rounded border border-slate-900/50 bg-slate-950/20">
                  <span className="text-sm text-slate-500 font-black">DOWNBREAK PROB</span>
                  <span className="text-white font-extrabold mt-0.5">{probabilityResult?.downProbability ?? 50}%</span>
                </div>
              </div>

              <div className="space-y-1.5 pt-1.5 border-t border-slate-900/50 text-sm">
                <div className="flex justify-between items-center text-slate-400">
                  <span>Upcoming Breakout Prob:</span>
                  <span className="text-indigo-400 font-bold">
                    {Math.max(probabilityResult?.upProbability ?? 0, probabilityResult?.downProbability ?? 0)}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Volatility Score:</span>
                  <span className={`font-bold ${probabilityResult && probabilityResult.volatilityScore >= 60 ? "text-emerald-400" : "text-slate-500"}`}>
                    {probabilityResult?.volatilityScore ?? 0} / 100
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>OI Buildup:</span>
                  <span className="text-slate-200 font-medium">
                    {atmRow ? `CE: ${formatOiChange(atmRow.ceOIChange)} | PE: ${formatOiChange(atmRow.peOIChange)}` : "Flat"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Range Compression:</span>
                  <span className="text-slate-200 font-medium">
                    {strategiesResult.signal === "WAIT" || (probabilityResult && probabilityResult.volatilityScore < 60) ? "COMPRESSING" : "NORMAL"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Live Option Data (Real LTP) */}
          <div className="space-y-2 border-t border-slate-900 pt-2.5">
            <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
              📈 LIVE OPTION DATA (REAL LTP)
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded border border-slate-900 bg-slate-950/60 flex flex-col justify-between">
                <div className="flex justify-between text-slate-400">
                  <span>CE LTP:</span>
                  <span className="text-emerald-400 font-bold">₹{atmRow ? atmRow.ceLtp.toFixed(2) : "0.00"}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-500 mt-1">
                  <span>OI: {atmRow ? formatOi(atmRow.ceOI) : "0L"}</span>
                  <span className={atmRow && atmRow.ceOIChange > 0 ? "text-emerald-400" : atmRow && atmRow.ceOIChange < 0 ? "text-red-400" : "text-slate-500"}>
                    {atmRow && atmRow.ceOIChange > 0 ? "↑" : atmRow && atmRow.ceOIChange < 0 ? "↓" : "→"}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded border border-slate-900 bg-slate-950/60 flex flex-col justify-between">
                <div className="flex justify-between text-slate-400">
                  <span>PE LTP:</span>
                  <span className="text-red-400 font-bold">₹{atmRow ? atmRow.peLtp.toFixed(2) : "0.00"}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-500 mt-1">
                  <span>OI: {atmRow ? formatOi(atmRow.peOI) : "0L"}</span>
                  <span className={atmRow && atmRow.peOIChange > 0 ? "text-emerald-400" : atmRow && atmRow.peOIChange < 0 ? "text-red-400" : "text-slate-500"}>
                    {atmRow && atmRow.peOIChange > 0 ? "↑" : atmRow && atmRow.peOIChange < 0 ? "↓" : "→"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Reason Engine */}
          <div className="space-y-1.5 border-t border-slate-900 pt-2.5">
            <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
              🧠 REASON ENGINE (FROM REAL DATA ONLY)
            </span>
            <div className="space-y-1">
              {signalReasons.slice(0, 4).map((rule, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-slate-400 leading-tight">
                  <span className={rule.startsWith("✔") ? "text-emerald-400" : rule.startsWith("❌") ? "text-rose-500" : "text-amber-400"}>
                    {rule.startsWith("✔") ? "✔" : rule.startsWith("❌") ? "❌" : "·"}
                  </span>
                  <span>{rule.startsWith("✔") || rule.startsWith("❌") || rule.startsWith("⚠") ? rule.slice(2) : rule}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Paper Trade */}
          <div className="space-y-1.5 border-t border-slate-900 pt-2.5">
            <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
              📊 ACTIVE PAPER TRADE
            </span>

            {activeTrade ? (
              <div className="p-2 rounded border border-indigo-500/25 bg-indigo-500/5 space-y-1">
                <div className="flex items-center justify-between text-slate-350 font-bold">
                  <span>{activeTrade.instrument} {activeTrade.direction.replace("BUY_", "")} {activeTrade.strike}</span>
                  <span className="text-sm text-indigo-400 font-extrabold uppercase animate-pulse">RUNNING</span>
                </div>
                <div className="flex justify-between text-sm text-slate-500 border-b border-slate-900/60 pb-1">
                  <span>Entry: ₹{activeTrade.entry_price.toFixed(2)}</span>
                  <span>LTP: ₹{activeTrade.currentPremium.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center pt-0.5">
                  <span className="text-slate-400 font-bold">PnL:</span>
                  <span className={`font-black font-mono text-sm ${activeTrade.livePnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {activeTrade.livePnl >= 0 ? "+" : ""}₹{activeTrade.livePnl.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-2 text-slate-600 italic border border-dashed border-slate-900 rounded bg-slate-950/10">
                Awaiting trade trigger conditions...
              </div>
            )}
          </div>

          {/* Exit Update Area */}
          <div className="space-y-1.5 border-t border-slate-900 pt-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
                🔴 EXIT UPDATE
              </span>
              {exitDetails && isExitUpdateVisible && (
                <button
                  onClick={() => setIsExitUpdateVisible(false)}
                  className="text-slate-500 hover:text-slate-350 transition-colors p-0.5 rounded hover:bg-slate-900/50"
                  title="Dismiss Exit Alert"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {exitDetails && isExitUpdateVisible ? (
              <div className="p-2 rounded border border-slate-900 bg-slate-950/40 space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span className="font-bold">{lastClosedTrade?.instrument} Exit Alert</span>
                  <span className={`font-black ${exitDetails.points >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {exitDetails.points >= 0 ? "+" : ""}{exitDetails.points} points
                  </span>
                </div>
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Entry: {exitDetails.entry.toFixed(0)} | Exit: {exitDetails.exit.toFixed(0)}</span>
                  <span className="text-indigo-400 font-extrabold max-w-[120px] truncate" title={exitDetails.reason}>
                    {exitDetails.reason}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-2 text-slate-650 italic">
                {exitDetails ? "Exit alert dismissed" : "No closed trades recorded today"}
              </div>
            )}
          </div>

          {/* Control Bar Footer */}
          <div className="flex items-center justify-between border-t border-slate-900 pt-2.5 text-sm font-bold text-slate-500">
            <div className="flex items-center gap-1">
              <span className="text-slate-600">Daily Trades:</span>
              <span className="text-slate-350">{tradesToday} / 3</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-600">System Lock:</span>
              <span className={`font-black ${limitStatus === "ACTIVE" ? "text-indigo-400" : "text-red-400"}`}>
                {limitStatus === "ACTIVE" ? "UNLOCKED" : "LOCKED"}
              </span>
            </div>
          </div>

        </div>
      )}
    </div>
    )}
    </>
  );
};

export default LiveSignalFeedCard;

