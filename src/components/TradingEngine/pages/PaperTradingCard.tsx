/**
 * PaperTradingCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 14: Paper Trading — AMEX v2.0
 *
 * AMEX overhaul: auto-execution at confidence ≥ 55 (was 65),
 * volatility threshold relaxed to ≥ 40 (was 70), notifications
 * fire on every auto-execution, mustTrade flag surfaces minimum
 * activity warning when <2 trades placed during market hours.
 */
import React, { useMemo, useState, useEffect } from "react";
import {
  computePaperTrading,
  type PaperTradingResult,
  type AutoTradeSuggestion
} from "../../../engine/paperTradingEngine";
import type { StrategiesEngineOutput } from "../../../engine/strategiesEngine";
import type { AIDecisionResult }        from "../../../engine/aiDecisionEngine";
import type { OpportunityResult }       from "../../../engine/opportunityEngine";
import type { EntryZoneResult }         from "../../../engine/entryZoneEngine";
import type { StrategyAlignmentResult }   from "../../../engine/strategyAlignmentEngine";
import type { MarketTimeEngineResult }   from "../../../engine/marketTimeEngine";
import type { MomentumEngineOutput }     from "../../../engine/momentumEngine";
import type { SmartMoneySignal }         from "../../../engine/smartMoneyEngine";
import type { OptionFlowEngineOutput }   from "../../../engine/optionFlowEngine";
import type { TEPaperTrade }            from "../../../types";
import { Play, TrendingUp, TrendingDown, BookOpen, AlertCircle, ShoppingBag, CheckCircle, Database, Wallet, Info, Zap, Bell, Trash2 } from "lucide-react";
import { useAMEXNotifications, AMEXToastContainer } from "../../../hooks/useAMEXNotifications";
import TradeDetailsModal from "../shared/TradeDetailsModal";
import OpenPositionsLedgerCard from "../../OpenPositionsLedgerCard";

import type { RiskEngineResult } from "../../../engine/riskEngine";

export interface PaperTradingCardProps {
  activePage: string;
  spotPrice: number;
  entryZoneResult:         EntryZoneResult;
  strategyAlignmentResult: StrategyAlignmentResult;
  aiDecisionResult:        AIDecisionResult;
  opportunityResult:       OpportunityResult;
  strategiesResult:        StrategiesEngineOutput;
  dbTrades:                TEPaperTrade[];
  optionChain:             any[]; // live option chain strikes
  onTradePlaced?:          () => void;
  marketTimeResult?:       MarketTimeEngineResult;
  momentumResult?:         MomentumEngineOutput;
  smartMoneyResult?:       SmartMoneySignal;
  optionFlowResult?:       OptionFlowEngineOutput;
  volatilityScore?:        number;
  riskResult?:             RiskEngineResult;
}

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

const PaperTradingCard: React.FC<PaperTradingCardProps> = (props) => {
  // Hedge filter: exclude spread/hedge trades from stats and display
  const HEDGE_DIRS = new Set(["BULL_SPREAD", "BEAR_SPREAD"]);
  const isNakedTrade = (t: TEPaperTrade) => true;

  const {
    activePage,
    spotPrice,
    entryZoneResult,
    strategyAlignmentResult,
    aiDecisionResult,
    opportunityResult,
    strategiesResult,
    dbTrades,
    optionChain,
    onTradePlaced,
    marketTimeResult,
    momentumResult,
    smartMoneyResult,
    optionFlowResult,
    volatilityScore,
    riskResult,
  } = props;

  const [executing, setExecuting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const { toasts, fireNotification, dismissToast } = useAMEXNotifications();
  const lastAutoTradeRef = React.useRef<number>(0); // dedup guard: tracks last auto-execution timestamp
  const [listTab, setListTab] = useState<"OPEN" | "CLOSED">("OPEN");
  const [selectedTradeForDetails, setSelectedTradeForDetails] = useState<any | null>(null);

  // Helper to parse entry & exit reasoning from notes
  const parseTradeNotes = (notes: string = "") => {
    const exitMatch = notes.match(/\[(.*?)\]/);
    const exitReason = exitMatch ? exitMatch[1] : "";
    const entryReason = notes.replace(/\[.*?\]/, "").trim();
    return {
      entryReason: entryReason || "Manual order entry",
      exitReason: exitReason || (notes.includes("Manually Closed") ? "Manually Closed" : "")
    };
  };

  // ── Browser Push Notification System ──
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
  }, []);

  const notifyTrade = (instrument: string, direction: string, entryPrice: number) => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("🚀 Antigravity Trade Executed!", {
          body: `Order Placed: ${instrument} ${direction} at ₹${entryPrice.toFixed(1)}\nTarget: ₹2,000/lot Alpha Mode Active.`,
          icon: "/favicon.ico"
        });
      }
    }
  };

  const result: PaperTradingResult = useMemo(() => {
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
      spotPrice,
      activePage,
      dbTrades,
      marketTimeResult,
      optionFlowResult,
      volatilityScore,
      optionChain,
      tradingMode: tradingMode as "INTRADAY" | "SWING",
    });
  }, [
    entryZoneResult,
    strategyAlignmentResult,
    aiDecisionResult,
    opportunityResult,
    strategiesResult,
    spotPrice,
    activePage,
    dbTrades,
    marketTimeResult,
    optionFlowResult,
    volatilityScore,
    optionChain,
  ]);

  // Live P&L matching for open and pending positions
  const openAndPendingPositionsWithLtp = useMemo(() => {
    const raw = dbTrades.filter(t => (t.status === "OPEN" || t.status === "PENDING") && t.instrument === activePage && isNakedTrade(t));
    return raw.map(pos => {
      const currentPremium = computeLivePremium(pos, optionChain ?? [], activePage, spotPrice);
      const livePnl = pos.status === "PENDING" ? 0 : (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;

      return {
        ...pos,
        currentPremium,
        livePnl: parseFloat(livePnl.toFixed(1)),
      };
    });
  }, [dbTrades, optionChain, activePage]);

  const openPositionsWithLtp = useMemo(() => {
    return openAndPendingPositionsWithLtp.filter(p => p.status === "OPEN");
  }, [openAndPendingPositionsWithLtp]);

  // Calculate live overall P&L (daily closed + open floating)
  const totalLivePnl = useMemo(() => {
    const openFloating = openPositionsWithLtp.reduce((sum, p) => sum + p.livePnl, 0);
    return result.dailyPnL + openFloating;
  }, [result.dailyPnL, openPositionsWithLtp]);

  const todayStr = new Date().toDateString();
  const closedToday = useMemo(() => {
    return result.closedTrades.filter(
      t => t.closed_at ? new Date(t.closed_at).toDateString() === todayStr : false
    );
  }, [result.closedTrades, todayStr]);

  const dailyClosedPnL = useMemo(() => {
    return closedToday.reduce((sum, t) => sum + t.pnl, 0);
  }, [closedToday]);

  const openFloatingPnL = useMemo(() => {
    return openPositionsWithLtp.reduce((sum, p) => sum + p.livePnl, 0);
  }, [openPositionsWithLtp]);

  const totalDailyPnL = dailyClosedPnL + openFloatingPnL;

  const INITIAL_CAPITAL = 15000;
  const totalClosedPnL = dbTrades.filter(isNakedTrade).reduce((sum, t) => sum + t.pnl, 0);
  const virtualCapital = INITIAL_CAPITAL + totalClosedPnL + openFloatingPnL;
  const usedMargin = openPositionsWithLtp.reduce((sum, pos) => sum + (pos.entry_price * pos.qty * pos.lot_size), 0);
  const remainingCapital = Math.max(0, INITIAL_CAPITAL + totalClosedPnL - usedMargin);

  const tradesToday = useMemo(() => {
    return dbTrades.filter(
      t => new Date(t.timestamp).toDateString() === todayStr && isNakedTrade(t)
    ).length;
  }, [dbTrades, todayStr]);

  const pauseReason = useMemo(() => {
    let tradingMode = "INTRADAY";
    try {
      const riskSettings = JSON.parse(localStorage.getItem("te_risk_settings") || "{}");
      tradingMode = riskSettings.tradingMode || "INTRADAY";
    } catch (e) {}

    if (localStorage.getItem("te_force_active") === "true") {
      return "";
    }

    if (!optionChain || optionChain.length === 0) {
      return "Execution Locked: Awaiting Option Chain live stream.";
    }

    // Get IST time
    const date = new Date();
    const ist = new Date(date.getTime() + 19800000);
    const totalMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();

    if (optionFlowResult && tradingMode === "INTRADAY") {
      if (optionFlowResult.expiryMode === "EXPIRY" && totalMins >= (14 * 60 + 30)) {
        return "Execution Blocked: Theta Crush Zone (Expiry Day > 14:30 IST)";
      }
      if (optionFlowResult.expiryMode === "EXPIRY_PRE" && totalMins < 10 * 60) {
        return "Execution Blocked: Expiry-1 Morning Risk Window (09:15-10:00 IST)";
      }
      if (optionFlowResult.activeDecision.trapRisk === "HIGH") {
        return "Execution Blocked: High Trap Risk detected by Option Flow Engine";
      }
      if (optionFlowResult.activeDecision.liquidity === "LOW") {
        return "Execution Blocked: Low Strike Liquidity detected by Option Flow Engine";
      }
    }

    if (tradingMode === "INTRADAY" && marketTimeResult && !marketTimeResult.isTradingAllowed) {
      return "Execution Locked: Outside Market Session hours.";
    }
    if (riskResult && riskResult.circuitBreakerActive) {
      return "Execution Blocked: RISK LIMIT HIT (Daily Max Loss ₹3,000)";
    }
    return "Execution Paused: Risk circuit breaker tripped.";
  }, [marketTimeResult, optionChain, optionFlowResult, riskResult]);

  const executeAutoTrade = async () => {
    if (!result.autoTradeSuggestion || executing) return;
    setExecuting(true);

    try {
      let tradingMode = "INTRADAY";
      try {
        const riskSettings = JSON.parse(localStorage.getItem("te_risk_settings") || "{}");
        tradingMode = riskSettings.tradingMode || "INTRADAY";
      } catch (e) {}

      const notesJson = JSON.stringify({
        trade_type: tradingMode === "SWING" ? "POSITIONAL" : "INTRADAY",
        reason: result.autoTradeSuggestion.notes
      });

      const res = await fetch(getApiUrl("/api/te/paper-trades"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...result.autoTradeSuggestion,
          status: result.autoTradeSuggestion.status || "OPEN",
          notes: notesJson,
          pnl: 0,
          created_at: Date.now(),
        }),
      });

      if (res.ok) {
        setSuccessMsg("Auto Order Executed!");
        if (onTradePlaced) onTradePlaced();
        if (result.autoTradeSuggestion) {
          notifyTrade(
            result.autoTradeSuggestion.instrument,
            result.autoTradeSuggestion.direction,
            result.autoTradeSuggestion.entry_price
          );
        }
        setTimeout(() => setSuccessMsg(""), 3000);
      } else {
        console.error("Server rejected paper trade submission");
      }
    } catch (e) {
      console.error("API call to place paper trade failed:", e);
    } finally {
      setExecuting(false);
    }
  };

  // ── AMEX Auto Execution Trigger (confidence >= 55, volatility >= 40) ──
  useEffect(() => {
    if (!result.autoTradeSuggestion || executing) return;

    // Dedup guard: prevent rapid-fire duplicate auto-executions (30s cooldown)
    const now = Date.now();
    if (now - lastAutoTradeRef.current < 30000) return;

    let tradingMode = "INTRADAY";
    try {
      const riskSettings = JSON.parse(localStorage.getItem("te_risk_settings") || "{}");
      tradingMode = riskSettings.tradingMode || "INTRADAY";
    } catch (e) {}

    // AMEX: primary gate is confidence >= 55 (baked in engine)
    // volatility threshold relaxed to 15 (was 40, originally 70) — calm markets should still trade
    const isVolOk = (volatilityScore ?? 0) >= 15;
    const isRiskAllowed = riskResult ? riskResult.tradeAllowed : true;
    const isLive = tradingMode === "SWING" ? true : (marketTimeResult ? marketTimeResult.isTradingAllowed : true);
    const noCircuitBreaker = riskResult ? !riskResult.circuitBreakerActive : true;

    const isAutoExecution = isVolOk && isRiskAllowed && isLive && noCircuitBreaker;

    if (isAutoExecution) {
      lastAutoTradeRef.current = now; // lock dedup before executing
      executeAutoTrade();
      // Fire AMEX notification
      const s = result.autoTradeSuggestion;
      const isCE = s.direction === "BUY_CE";
      fireNotification({
        signalId: s.id,
        type: isCE ? "BUY_CE" : "BUY_PE",
        title: `⚡ AUTO TRADE: ${s.direction}`,
        message: `${s.instrument} ${s.tradeType ?? s.strategyName} | Strike ${s.strike} | LTP ₹${s.entry_price} | ${s.signalMode ?? "FULL_SIGNAL"}`,
        confidence: s.confidence,
        strike: s.strike,
        entryPrice: s.entry_price,
        tradeType: s.tradeType,
        playSound: true,
      });
    }
  }, [result.autoTradeSuggestion, volatilityScore, riskResult, marketTimeResult, executing]);

  // ── Auto Exit & Pending Activation Loop ──
  useEffect(() => {
    const pendingTrades = dbTrades.filter(t => t.status === "PENDING" && t.instrument === activePage && isNakedTrade(t));
    if (openPositionsWithLtp.length === 0 && pendingTrades.length === 0) return;

    const runEngineChecks = async () => {
      let tradingMode = "INTRADAY";
      try {
        const riskSettings = JSON.parse(localStorage.getItem("te_risk_settings") || "{}");
        tradingMode = riskSettings.tradingMode || "INTRADAY";
      } catch (e) {}

      // ── 1. Check Pending Trade Activations ──
      for (const pos of pendingTrades) {
        const currentPremium = computeLivePremium(pos, optionChain ?? [], activePage, spotPrice);

        if (currentPremium > 0 && currentPremium <= pos.entry_price) {
          try {
            const res = await fetch(getApiUrl("/api/te/paper-trades/activate"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: pos.id }),
            });
            if (res.ok && onTradePlaced) {
              onTradePlaced();
            }
          } catch (e) {
            console.error("Failed to activate pending trade:", pos.id, e);
          }
        }
      }

      // ── 2. Check Open Trade Exits ──
      if (openPositionsWithLtp.length > 0) {
        const nowMs = Date.now();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(nowMs + istOffset);
        const hours = istDate.getUTCHours();
        const minutes = istDate.getUTCMinutes();
        const totalMinutes = hours * 60 + minutes;
        const isTimeExit = tradingMode === "INTRADAY" && totalMinutes >= (15 * 60 + 25);

        for (const pos of openPositionsWithLtp) {
          const currentPremium = pos.currentPremium;
          let exitReason = "";
          let shouldExit = false;

          const isReverseDecision = (pos.direction === "BUY_CE" && aiDecisionResult.finalDecision === "BUY_PE") ||
                                    (pos.direction === "BUY_PE" && aiDecisionResult.finalDecision === "BUY_CE");
          
          let isIndicatorReverse = false;
          if (momentumResult && smartMoneyResult) {
            if (pos.direction === "BUY_CE") {
              isIndicatorReverse = momentumResult.momentumDirection === "BEARISH" && smartMoneyResult.flowDirection === "BEARISH";
            } else if (pos.direction === "BUY_PE") {
              isIndicatorReverse = momentumResult.momentumDirection === "BULLISH" && smartMoneyResult.flowDirection === "BULLISH";
            }
          }

          const daysHeld = (nowMs - pos.timestamp) / (24 * 60 * 60 * 1000);
          const isSwingTimeDecayExit = tradingMode === "SWING" && daysHeld >= 4;

          if (isTimeExit) {
            shouldExit = true;
            exitReason = "FORCE TIME EXIT (15:25 IST)";
          } else if (isSwingTimeDecayExit) {
            shouldExit = true;
            exitReason = "SWING TIME DECAY EXIT (4 Days Hold Limit)";
          } else if (isReverseDecision || isIndicatorReverse) {
            shouldExit = true;
            exitReason = "SIGNAL REVERSE EXIT";
          } else if (currentPremium <= pos.stop_loss) {
            shouldExit = true;
            exitReason = "STOP LOSS HIT";
          } else if (currentPremium >= pos.target) {
            shouldExit = true;
            exitReason = "TARGET HIT";
          }

          if (shouldExit) {
            const exitPnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;
            try {
              const res = await fetch(getApiUrl("/api/te/paper-trades/close"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: pos.id,
                  exit_price: parseFloat(currentPremium.toFixed(1)),
                  pnl: parseFloat(exitPnl.toFixed(1)),
                  notes: `${pos.notes || ""} [Auto Closed: ${exitReason}]`,
                }),
              });
              if (res.ok && onTradePlaced) {
                onTradePlaced();
              }
            } catch (e) {
              console.error("Auto exit call failed for trade ID:", pos.id, e);
            }
          }
        }
      }
    };

    runEngineChecks();
  }, [openPositionsWithLtp, dbTrades, optionChain, activePage, onTradePlaced, aiDecisionResult.finalDecision, momentumResult, smartMoneyResult]);

  const handleManualClose = async (pos: any) => {
    try {
      const res = await fetch(getApiUrl("/api/te/paper-trades/close"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pos.id,
          exit_price: pos.currentPremium,
          pnl: pos.livePnl,
          notes: `${pos.notes || ""} [Manually Closed]`,
        }),
      });

      if (res.ok && onTradePlaced) {
        onTradePlaced();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteTrade = async (id: string) => {
    if (!window.confirm("Confirm delete of this paper trade?")) return;
    try {
      const res = await fetch(getApiUrl(`/api/te/paper-trades/${id}`), { method: "DELETE" });
      if (res.ok && onTradePlaced) {
        onTradePlaced();
      }
    } catch (e) {
      console.error("Failed to delete trade:", e);
    }
  };

  const accentColor = totalLivePnl >= 0 ? "#10b981" : "#ef4444";
  const glowShadow = totalLivePnl >= 0 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)";

  return (
    <>
      <AMEXToastContainer toasts={toasts} onDismiss={dismissToast} />
      <div
        className="relative select-none overflow-hidden rounded-xl"
        style={{
          background: "linear-gradient(135deg, #03050a 0%, #060a14 55%, #03050a 100%)",
          border: "1px solid rgba(255,255,255,0.05)",
          boxShadow: `0 2px 28px ${glowShadow}`,
        }}
      >
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${accentColor} 50%, transparent 95%)`,
      }} />

      <div className="relative z-10 px-4 py-4">
        {/* ── HEADER ───────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3.5 border-b border-slate-800/40 pb-2">
          <div className="flex items-center gap-1.5">
            <Zap size={14} style={{ color: "#818cf8" }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400">
              ⚡ AMEX · PAPER TRADING · LAYER 14
            </span>
            {riskResult?.mustTrade && (
              <span className="text-sm font-black text-amber-400 bg-amber-900/25 border border-amber-600/40 px-1.5 py-0.5 rounded-full animate-pulse ml-1">
                ⚠ MIN TRADE REQUIRED
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const current = localStorage.getItem("te_force_active") === "true";
                localStorage.setItem("te_force_active", current ? "false" : "true");
                window.location.reload();
              }}
              className={`text-[10px] font-black px-2 py-0.5 rounded border transition-all cursor-pointer ${
                localStorage.getItem("te_force_active") === "true"
                  ? "bg-amber-600/20 border-amber-500/40 text-amber-400"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-350"
              }`}
            >
              {localStorage.getItem("te_force_active") === "true" ? "🔌 FORCE ACTIVE ON" : "🔌 NORMAL MODE"}
            </button>
            <span className={`text-sm font-black font-mono uppercase px-2 py-0.5 rounded border ${
              result.status === "ACTIVE"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}>{result.status}</span>
          </div>
        </div>

        {/* ── MAIN GRID LAYOUT ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* Column 1: Portfolio Stats & Capital (Span 6) */}
          <div className="lg:col-span-6 flex flex-col justify-between border-r border-slate-800/30 pr-0 lg:pr-4">
            <div className="space-y-3">
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block">
                📡 AUTO PAPER TRADE PANEL
              </span>
              
              {/* Account Capital Breakdown */}
              <div className="space-y-2 p-2.5 rounded-lg border border-slate-900 bg-slate-950/40 font-mono text-sm">
                <div className="flex justify-between items-center text-slate-400">
                  <span>Portfolio Funds (Main):</span>
                  <span className="text-white font-extrabold">₹{virtualCapital.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Used:</span>
                  <span className="text-amber-400 font-extrabold">₹{usedMargin.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Remaining:</span>
                  <span className="text-emerald-400 font-extrabold">₹{remainingCapital.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span>
                </div>
                <div className="flex justify-between items-center text-slate-400 border-t border-slate-900/50 pt-1.5 mt-1.5 font-bold">
                  <span>Today Condition (P&L):</span>
                  <span className={`font-black ${totalDailyPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {totalDailyPnL >= 0 ? "PROFIT: +" : "LOSS: -"}₹{Math.abs(totalDailyPnL).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </span>
                </div>
              </div>

              {/* Today Statistics */}
              <div className="grid grid-cols-2 gap-3 text-sm font-mono">
                <div className="p-2 rounded border border-slate-900 bg-slate-950/20 flex flex-col justify-between">
                  <span className="text-sm text-slate-500 uppercase font-black">Trades Today</span>
                  <span className="text-base text-white font-black mt-1 leading-none">
                    {tradesToday}
                  </span>
                </div>
                <div className="p-2 rounded border border-slate-900 bg-slate-950/20 flex flex-col justify-between">
                  <span className="text-sm text-slate-500 uppercase font-black">Max Loss Limit</span>
                  <span className={`text-base font-black mt-1 leading-none ${riskResult?.circuitBreakerActive ? "text-rose-500 font-black animate-pulse" : "text-slate-400"}`}>
                    {riskResult?.circuitBreakerActive ? "LIMIT HIT" : "₹3,000"}
                  </span>
                </div>
              </div>

              {/* Loss tracker */}
              <div className="p-2.5 rounded-lg border border-slate-900 bg-slate-950/20 font-mono text-sm space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Max Loss Hit:</span>
                  <span className={`font-black ${totalDailyPnL <= -3000 ? "text-rose-500" : "text-white"}`}>
                    ₹{Math.max(0, -totalDailyPnL).toLocaleString("en-IN", { maximumFractionDigits: 1 })} / ₹3,000
                  </span>
                </div>
                {riskResult?.circuitBreakerActive && (
                  <div className="text-sm text-rose-500 font-black tracking-wider uppercase text-center border border-rose-500/20 bg-rose-500/5 py-1 rounded animate-pulse">
                    🚨 RISK LIMIT HIT: AUTO TRADING HALTED
                  </div>
                )}
              </div>

              {/* Daily closed PnL */}
              <div className="p-2 rounded border border-slate-900 bg-slate-950/20 text-sm flex items-center justify-between font-mono">
                <span className="text-slate-500 font-bold">Today Closed P&L:</span>
                <span className={`font-black ${dailyClosedPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {dailyClosedPnL >= 0 ? "+" : ""}₹{dailyClosedPnL.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                </span>
              </div>
            </div>

            <div className="text-sm text-slate-600 font-mono mt-3 leading-normal flex items-start gap-1">
              <Info size={9} className="mt-0.5 flex-shrink-0" />
              <span>Starting capital is ₹1,00,000. strict ₹3,000 daily loss control circuit breaker limits.</span>
            </div>
          </div>

          {/* Column 2: Suggestions & Closed Trades History (Span 6) */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            {/* Auto-Execution suggestion */}
            <div>
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block mb-2">
                AUTO-EXECUTION ORDER CONSOLE
              </span>

              {result.autoTradeSuggestion ? (
                <div className="rounded-lg border border-purple-500/25 bg-purple-500/5 p-2.5 space-y-2 relative overflow-hidden">
                  <div className="flex items-center justify-between border-b border-purple-500/10 pb-1.5">
                    <span className="text-sm font-black font-mono text-purple-400 uppercase tracking-wider flex items-center gap-1">
                      <ShoppingBag size={10} /> SUGGESTION ARMED
                    </span>
                    <span className="text-sm font-mono text-slate-500">
                      Ref: {result.autoTradeSuggestion.signal_ref}
                    </span>
                  </div>

                  <p className="text-sm text-slate-400 font-medium font-mono leading-tight">
                    🚀 SUGGESTED: {result.autoTradeSuggestion.strategyName} (Conf: {result.autoTradeSuggestion.confidence}%)
                  </p>

                  <div className="grid grid-cols-2 gap-1.5 text-sm font-mono text-slate-500 bg-slate-950/50 p-1.5 rounded border border-slate-900/60">
                    <div>Class: <span className={result.autoTradeSuggestion.direction === "BUY_CE" ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>{result.autoTradeSuggestion.direction.replace("BUY_", "")}</span></div>
                    <div>Strike: <span className="text-white font-bold">{result.autoTradeSuggestion.strike}</span></div>
                    <div>Entry: <span className="text-white font-bold">₹{result.autoTradeSuggestion.entry_price.toFixed(1)}</span></div>
                    <div>Lots: <span className="text-white font-bold">{result.autoTradeSuggestion.qty} ({result.autoTradeSuggestion.qty * result.autoTradeSuggestion.lot_size} Qty)</span></div>
                  </div>

                  {successMsg ? (
                    <div className="text-sm text-emerald-400 font-bold flex items-center justify-center gap-1 py-1.5 rounded bg-emerald-500/10">
                      <CheckCircle size={11} /> {successMsg}
                    </div>
                  ) : (
                    <button
                      onClick={executeAutoTrade}
                      disabled={executing || result.status !== "ACTIVE"}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm font-black transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Play size={10} className={executing ? "animate-pulse" : ""} />
                      {executing ? "Routing..." : "PLACE AUTO-TRADE ORDER"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg border border-slate-900 bg-slate-950/20 text-center py-5 text-sm text-slate-500 italic">
                  {result.status === "PAUSED" 
                    ? pauseReason
                    : "No signals cleared the Strategy conviction requirements."}
                </div>
              )}
            </div>

            {/* Closed trades ledger */}
            <div className="mt-3.5 border-t border-slate-800/30 pt-3">
              <span className="text-sm font-black text-slate-500 uppercase tracking-wider block mb-1.5">
                CLOSED TRADES JOURNAL (LAST 2 LOGS)
              </span>
              <div className="space-y-1.5 max-h-[105px] overflow-y-auto pr-1">
                {result.closedTrades.filter(isNakedTrade).length === 0 ? (
                  <div className="text-center py-4 text-sm text-slate-600 italic">
                    No closed trades recorded today
                  </div>
                ) : (
                  [...result.closedTrades].filter(isNakedTrade).sort((a,b) => b.timestamp - a.timestamp).slice(0, 2).map((trade) => (
                    <div
                      key={trade.id}
                      className="p-2 rounded bg-slate-950/30 border border-slate-900/60 flex items-center justify-between text-sm font-mono"
                    >
                      <div className="flex flex-col">
                        <span className="text-slate-300 font-bold">{trade.instrument} ATM {trade.strike}</span>
                        <span className="text-slate-500 text-sm mt-0.5">
                          {trade.direction.replace("BUY_", "")} | Entry: ₹{trade.entry_price.toFixed(0)} → Exit: ₹{trade.exit_price?.toFixed(0)}
                        </span>
                      </div>
                      <span className={`font-black ${trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {trade.pnl >= 0 ? "+" : ""}₹{trade.pnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>

        {/* ── OPEN POSITIONS DUAL LEDGER ROW (INTRADAY & POSITIONAL SIDE BY SIDE) ── */}
        <div className="mt-5 border-t border-slate-800/40 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OpenPositionsLedgerCard
              activePage={activePage}
              spotPrice={spotPrice}
              dbTrades={dbTrades}
              optionChain={optionChain}
              onTradeClosed={onTradePlaced}
              darkMode={true}
              tradeTypeFilter="INTRADAY"
            />
            <OpenPositionsLedgerCard
              activePage={activePage}
              spotPrice={spotPrice}
              dbTrades={dbTrades}
              optionChain={optionChain}
              onTradeClosed={onTradePlaced}
              darkMode={true}
              tradeTypeFilter="POSITIONAL"
            />
          </div>
        </div>

        {/* ── DETAILED PAPER TRADING LEDGER (ALL TRADES) ─────────────────────── */}
        <div className="mt-5 border-t border-slate-800/40 pt-4">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-indigo-400" />
              <span className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                📜 SIMULATED TRANSACTION JOURNAL ({activePage})
              </span>
            </div>

            <div className="flex gap-1.5 bg-slate-950/80 p-0.5 rounded-lg border border-slate-900/60 font-mono">
              <button
                onClick={() => setListTab("OPEN")}
                className={`px-3 py-1 rounded text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  listTab === "OPEN"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                OPEN POSITIONS ({openAndPendingPositionsWithLtp.length})
              </button>
              <button
                onClick={() => setListTab("CLOSED")}
                className={`px-3 py-1 rounded text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  listTab === "CLOSED"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                CLOSED HISTORY ({dbTrades.filter(t => t.status === "CLOSED" && t.instrument === activePage && isNakedTrade(t)).length})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[260px] overflow-y-auto pr-1 rounded-lg border border-slate-900/80 bg-slate-950/30">
            {listTab === "OPEN" ? (
              openAndPendingPositionsWithLtp.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-600 font-mono italic">
                  No active open or pending positions currently running on {activePage}
                </div>
              ) : (
                <table className="w-full text-sm font-mono text-slate-300 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-900 text-slate-500 text-left uppercase">
                      <th className="p-2.5 pl-3">Time</th>
                      <th className="p-2.5">Type</th>
                      <th className="p-2.5 text-right">Strike</th>
                      <th className="p-2.5 text-right">Qty</th>
                      <th className="p-2.5 text-right">Entry</th>
                      <th className="p-2.5 text-right">LTP</th>
                      <th className="p-2.5 text-right">SL / Target</th>
                      <th className="p-2.5 text-right">Floating P&L</th>
                      <th className="p-2.5 pl-4">Why Taken (Entry Reason)</th>
                      <th className="p-2.5 pr-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/30">
                    {[...openAndPendingPositionsWithLtp]
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((trade) => {
                        const { entryReason } = parseTradeNotes(trade.notes);
                        return (
                          <tr key={trade.id} className="hover:bg-slate-900/10">
                            <td className="p-2.5 pl-3 text-slate-500 whitespace-nowrap">
                              {new Date(trade.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} {new Date(trade.timestamp).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit"
                              })}
                            </td>
                            <td className="p-2.5">
                              <span className={`font-black px-1.5 py-0.2 rounded border text-[10px] ${
                                (trade.direction === "BUY_CE" || trade.direction === "BULL_SPREAD")
                                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                  : "bg-red-500/10 border-red-500/20 text-red-400"
                              }`}>
                                {trade.direction.replace("BUY_", "")}
                              </span>
                            </td>
                            <td className="p-2.5 text-right text-slate-400 font-bold">{trade.strike}</td>
                            <td className="p-2.5 text-right text-slate-500">{trade.qty} × {trade.lot_size}</td>
                            <td className="p-2.5 text-right text-slate-400 font-bold">₹{trade.entry_price.toFixed(1)}</td>
                            <td className="p-2.5 text-right text-blue-400 font-bold animate-pulse">₹{trade.currentPremium.toFixed(1)}</td>
                            <td className="p-2.5 text-right text-slate-550">
                              {trade.status === "PENDING" ? (
                                <span className="text-slate-500 font-mono">—</span>
                              ) : (
                                <>
                                  <span className="text-red-400/80 font-bold">₹{trade.stop_loss.toFixed(0)}</span>
                                  <span className="mx-1 text-slate-600">/</span>
                                  <span className="text-emerald-400/80 font-bold">₹{trade.target.toFixed(0)}</span>
                                </>
                              )}
                            </td>
                            <td className="p-2.5 text-right font-black">
                              {trade.status === "PENDING" ? (
                                <span className="text-amber-400 font-bold">LIMIT PENDING</span>
                              ) : (
                                <span className={trade.livePnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                                  {trade.livePnl >= 0 ? "+" : ""}₹{trade.livePnl.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 pl-4 text-slate-400 text-left max-w-[200px] truncate" title={entryReason}>
                              {entryReason}
                            </td>
                            <td className="p-2.5 pr-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setSelectedTradeForDetails(trade)}
                                  className="px-2 py-0.5 text-xs font-black rounded border border-blue-500/30 bg-blue-500/5 text-blue-400 hover:bg-blue-500/20 transition-all cursor-pointer"
                                >
                                  DETAILS
                                </button>
                                <button
                                  onClick={() => handleManualClose(trade)}
                                  className="px-2 py-0.5 text-xs font-black rounded border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                                >
                                  CLOSE
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )
            ) : (
              dbTrades.filter(t => t.status === "CLOSED" && t.instrument === activePage && isNakedTrade(t)).length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-600 font-mono italic">
                  No closed trades recorded today on {activePage}
                </div>
              ) : (
                <table className="w-full text-sm font-mono text-slate-300 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-900 text-slate-500 text-left uppercase">
                      <th className="p-2.5 pl-3">Time</th>
                      <th className="p-2.5">Type</th>
                      <th className="p-2.5 text-right">Strike</th>
                      <th className="p-2.5 text-right">Qty</th>
                      <th className="p-2.5 text-right">Entry</th>
                      <th className="p-2.5 text-right">Exit</th>
                      <th className="p-2.5 text-right">Realised P&L</th>
                      <th className="p-2.5 pl-4">Why Taken (Entry Reason)</th>
                      <th className="p-2.5 pl-4">Outcome / Failure Reason</th>
                      <th className="p-2.5 pr-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/30">
                    {dbTrades
                      .filter(t => t.status === "CLOSED" && t.instrument === activePage && isNakedTrade(t))
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((trade) => {
                        const { entryReason, exitReason } = parseTradeNotes(trade.notes);
                        const isWin = trade.pnl >= 0;
                        return (
                          <tr key={trade.id} className="hover:bg-slate-900/10">
                            <td className="p-2.5 pl-3 text-slate-500 whitespace-nowrap">
                              {new Date(trade.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} {new Date(trade.timestamp).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit"
                              })}
                            </td>
                            <td className="p-2.5">
                              <span className={`font-black px-1.5 py-0.2 rounded border text-xs ${
                                (trade.direction === "BUY_CE" || trade.direction === "BULL_SPREAD")
                                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                  : "bg-red-500/10 border-red-500/20 text-red-400"
                              }`}>
                                {trade.direction.replace("BUY_", "")}
                              </span>
                            </td>
                            <td className="p-2.5 text-right text-slate-400 font-bold">{trade.strike}</td>
                            <td className="p-2.5 text-right text-slate-500">{trade.qty} × {trade.lot_size}</td>
                            <td className="p-2.5 text-right text-slate-400 font-bold">₹{trade.entry_price.toFixed(1)}</td>
                            <td className="p-2.5 text-right text-slate-300 font-bold">₹{trade.exit_price?.toFixed(1) ?? "0.0"}</td>
                            <td className="p-2.5 text-right font-black">
                              <span className={isWin ? "text-emerald-400" : "text-red-400"}>
                                {isWin ? "+" : ""}₹{trade.pnl.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                              </span>
                            </td>
                            <td className="p-2.5 pl-4 text-slate-400 text-left max-w-[200px] truncate" title={entryReason}>
                              {entryReason}
                            </td>
                            <td className="p-2.5 pl-4 text-left max-w-[200px] truncate">
                              {exitReason ? (
                                <span className={isWin ? "text-emerald-400/90 font-bold" : "text-rose-400/90 font-bold"}>
                                  {isWin ? "✅ " : "❌ "}{exitReason}
                                </span>
                              ) : (
                                <span className={isWin ? "text-emerald-500/70 font-bold" : "text-red-500/70 font-bold"}>
                                  {isWin ? "SUCCESS" : "FAIL"}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 pr-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setSelectedTradeForDetails(trade)}
                                  className="px-2 py-0.5 text-xs font-black rounded border border-blue-500/30 bg-blue-500/5 text-blue-400 hover:bg-blue-500/20 transition-all cursor-pointer"
                                >
                                  DETAILS
                                </button>
                                <button
                                  onClick={() => handleDeleteTrade(trade.id)}
                                  className="p-1 text-slate-600 hover:text-rose-400 transition-colors cursor-pointer"
                                  title="Delete Record"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )
            )}
          </div>
        </div>

      </div>
      {selectedTradeForDetails && (
        <TradeDetailsModal
          trade={selectedTradeForDetails}
          onClose={() => setSelectedTradeForDetails(null)}
          darkMode={true}
        />
      )}
    </div>
    </>
  );
};

export default PaperTradingCard;

