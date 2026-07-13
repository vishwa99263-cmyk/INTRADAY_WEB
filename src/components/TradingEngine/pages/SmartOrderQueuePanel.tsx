import React, { useState, useEffect, useCallback } from "react";
import {
  Zap, Target, TrendingUp, TrendingDown,
  Eye, CheckCircle, Activity, ChevronDown, ChevronUp,
  Shield, Crosshair, Timer
} from "lucide-react";
import type {
  SmartPendingOrder, OrderStatus, DiscountMethod, LiveMarketSnapshot
} from "../../../engine/smartOrderQueue";
import {
  getOrderStatusColor, getOrderStatusIcon,
  aiBrainEvaluateOrder, getCancelReasonLabel, getCancelSeverityStyle
} from "../../../engine/smartOrderQueue";

// ── NO demo/fake orders — queue starts empty ──────────────────────────────────
// Real orders are added ONLY when AI engine generates live signals.
// Fyers historical data se live signals aate hain — tab tak queue khali rahegi.

// ── Countdown timer ───────────────────────────────────────────────────────────
function useCountdown(expiresAt: string) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("00:00"); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return remaining;
}

// ── AI Brain Watch Panel ──────────────────────────────────────────────────────
// Compact 2-col grid showing all 8 AI conditions with live status.
// Uses live market snapshot from parent props.
const AiBrainWatchPanel: React.FC<{
  order: SmartPendingOrder;
  marketSnapshot?: LiveMarketSnapshot;
}> = ({ order, marketSnapshot }) => {
  // If parent didn't provide snapshot, build fallback/mock
  const [snapshot, setSnapshot] = React.useState<LiveMarketSnapshot>(() => ({
    currentRegime:     order.signalRegime,
    aiConfidence:      order.aiConfidence,
    smartMoneyScore:   order.smartMoneyScore,
    vix:               14.5,
    vixAtSignal:       14.0,
    breadthScore:      55,
    underlyingLTP:     order.underlyingCurrentPrice,
    oiWallAbove:       order.direction === "BULL" ? order.underlyingCurrentPrice + 120 : null,
    oiWallBelow:       order.direction === "BEAR" ? order.underlyingCurrentPrice - 120 : null,
    pcrCurrent:        1.1,
    pcrAtSignal:       1.0,
    timeNow:           new Date().toISOString(),
  }));

  // Update snapshot when prop changes
  React.useEffect(() => {
    if (marketSnapshot) {
      setSnapshot({
        ...marketSnapshot,
        // Ensure index/spot is matched
        underlyingLTP: marketSnapshot.underlyingLTP || order.underlyingCurrentPrice,
      });
    }
  }, [marketSnapshot, order.underlyingCurrentPrice]);

  const decision = aiBrainEvaluateOrder(order, snapshot);

  // All 8 condition checks for display
  const conditions = [
    {
      label:   "Time Window",
      icon:    "⌛",
      ok:      new Date(order.expiresAt) > new Date(),
      detail:  `Expiry: ${new Date(order.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
    },
    {
      label:   "Regime Match",
      icon:    "🔄",
      ok:      !(order.direction === "BULL"
                  ? ["TRENDING_BEAR","BREAKDOWN","VOLATILE"].includes(snapshot.currentRegime)
                  : ["TRENDING_BULL","BREAKOUT"].includes(snapshot.currentRegime)),
      detail:  snapshot.currentRegime.replace(/_/g," "),
    },
    {
      label:   "AI Confidence",
      icon:    "🧠",
      ok:      snapshot.aiConfidence >= 55 && (order.aiConfidence - snapshot.aiConfidence) < 15,
      detail:  `${snapshot.aiConfidence}% (signal: ${order.aiConfidence}%)`,
    },
    {
      label:   "Smart Money",
      icon:    "🏦",
      ok:      snapshot.smartMoneyScore >= 45 && (order.smartMoneyScore - snapshot.smartMoneyScore) < 20,
      detail:  `Score: ${snapshot.smartMoneyScore} (signal: ${order.smartMoneyScore})`,
    },
    {
      label:   "VIX Level",
      icon:    "💥",
      ok:      !(snapshot.vix >= 20 && (snapshot.vix - snapshot.vixAtSignal) >= 3),
      detail:  `VIX: ${snapshot.vix.toFixed(1)} (signal: ${snapshot.vixAtSignal})`,
    },
    {
      label:   "Price Zone",
      icon:    "🎯",
      ok:      Math.abs(snapshot.underlyingLTP - order.underlyingDiscountPrice) <= 80,
      detail:  `${Math.abs(snapshot.underlyingLTP - order.underlyingDiscountPrice).toFixed(0)} pts from discount`,
    },
    {
      label:   "OI Wall",
      icon:    "🧱",
      ok:      order.direction === "BULL"
                ? (snapshot.oiWallAbove === null || snapshot.oiWallAbove - snapshot.underlyingLTP >= 50)
                : (snapshot.oiWallBelow === null || snapshot.underlyingLTP - snapshot.oiWallBelow >= 50),
      detail:  order.direction === "BULL"
                ? `Wall: ${snapshot.oiWallAbove?.toLocaleString() ?? "None"}`
                : `Wall: ${snapshot.oiWallBelow?.toLocaleString() ?? "None"}`,
    },
    {
      label:   "Mkt Breadth",
      icon:    "📊",
      ok:      order.direction === "BULL" ? snapshot.breadthScore >= 35 : snapshot.breadthScore <= 65,
      detail:  `Breadth: ${snapshot.breadthScore}/100`,
    },
  ];

  const passCount = conditions.filter(c => c.ok).length;
  const allGreen  = passCount === 8;

  return (
    <div className="rounded-lg border border-slate-700/30 bg-slate-950/60 p-2.5">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${allGreen ? "bg-emerald-400" : passCount >= 6 ? "bg-amber-400" : "bg-red-500"}`}/>
          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">AI Brain Watch</span>
        </div>
        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
          allGreen       ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" :
          passCount >= 6 ? "text-amber-400 bg-amber-500/10 border-amber-500/25" :
                           "text-red-400 bg-red-500/10 border-red-500/25"
        }`}>
          {passCount}/8 OK
        </span>
      </div>

      {/* 2-column condition grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {conditions.map(c => (
          <div
            key={c.label}
            title={c.detail}
            className={`flex items-center gap-1.5 rounded px-2 py-1.5 border ${
              c.ok
                ? "bg-emerald-950/30 border-emerald-500/15"
                : "bg-red-950/30 border-red-500/25 animate-pulse"
            }`}
          >
            <span className="text-xs flex-shrink-0">{c.icon}</span>
            <div className="min-w-0">
              <div className={`text-[11px] font-black truncate ${c.ok ? "text-emerald-300" : "text-red-300"}`}>
                {c.label}
              </div>
              <div className="text-[10px] text-slate-500 truncate">{c.detail}</div>
            </div>
            <span className={`text-[11px] ml-auto flex-shrink-0 ${c.ok ? "text-emerald-400" : "text-red-400"}`}>
              {c.ok ? "✓" : "✗"}
            </span>
          </div>
        ))}
      </div>

      {/* AI Decision Banner */}
      {decision.shouldCancel ? (
        <div className={`mt-2 rounded px-2.5 py-2 border ${getCancelSeverityStyle(decision.severity)}`}>
          <div className="text-[11px] font-black uppercase tracking-widest mb-0.5">
            🤖 AI CANCEL DECISION — {decision.severity}
          </div>
          <div className="text-[11px] text-slate-300 leading-relaxed">{decision.explanation}</div>
          {decision.savedLoss > 0 && (
            <div className="text-[10px] text-emerald-400 mt-1 font-mono">
              💰 Est. Loss Bachaaya: ₹{decision.savedLoss.toFixed(0)}
            </div>
          )}
          <div className="text-[10px] text-slate-500 mt-1 font-mono italic">
            🧠 AI thought: "{decision.aiThought}"
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded px-2.5 py-1.5 bg-emerald-950/20 border border-emerald-500/15">
          <div className="text-[11px] text-emerald-400 font-mono">
            🤖 AI: Order valid — sab conditions theek hain. Discount price ka wait karo.
          </div>
        </div>
      )}
    </div>
  );
};

// Helper to format ISO time to e.g., "17 Jun 02:37 pm"
function formatOrderTime(isoString: string) {
  const d = new Date(isoString);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d.getDate();
  const month = months[d.getMonth()];
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${day} ${month} ${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
}

// Helper to format and classify expiry date (e.g. 26JUN25 -> 26 Jun 25 (Monthly))
function parseExpiry(expiryStr: string) {
  if (!expiryStr) return { date: "N/A", type: "Weekly" };
  const match = expiryStr.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/i);
  if (!match) return { date: expiryStr, type: "Weekly" };

  const day = parseInt(match[1], 10);
  const rawMonth = match[2].toUpperCase();
  const year = match[3];

  const months: Record<string, string> = {
    JAN: "Jan", FEB: "Feb", MAR: "Mar", APR: "Apr", MAY: "May", JUN: "Jun",
    JUL: "Jul", AUG: "Aug", SEP: "Sep", OCT: "Oct", NOV: "Nov", DEC: "Dec"
  };
  const formattedMonth = months[rawMonth] || rawMonth;
  const formattedDate = `${day} ${formattedMonth} ${year}`;
  
  // Last week of month (day >= 24) is standard monthly contract
  const type = day >= 24 ? "Monthly" : "Weekly";
  return { date: formattedDate, type };
}

// ── Order Card ────────────────────────────────────────────────────────────────
const OrderCard: React.FC<{
  order: SmartPendingOrder;
  onCancel?: (id: string) => void;
  marketSnapshot?: LiveMarketSnapshot;
}> = ({ order, onCancel, marketSnapshot }) => {
  const [expanded, setExpanded] = useState(false);
  const countdown = useCountdown(order.expiresAt);
  const statusStyle = getOrderStatusColor(order.status);
  const isActive = order.status === "MONITORING" || order.status === "QUEUED";
  const leg = order.legs[0];

  // Progress: how close current LTP is to discount price
  const progress = leg
    ? Math.min(100, Math.max(0,
        ((leg.signalLTP - leg.currentLTP) / (leg.signalLTP - leg.discountPrice)) * 100
      ))
    : 0;

  const methodLabels: Record<DiscountMethod, string> = {
    RETEST:       "Retest Entry",
    FIXED_PCT:    "% Pullback",
    ATR_PULLBACK: "ATR Pullback",
    VWAP_TOUCH:   "VWAP Touch",
    IMMEDIATE:    "Immediate",
  };

  const formattedTime = formatOrderTime(order.triggeredAt || order.signalTime);
  const expiryInfo = parseExpiry(order.expiry);

  return (
    <div className={`rounded-xl border bg-gradient-to-br from-slate-900/90 to-slate-950 overflow-hidden ${isActive ? "border-indigo-500/30" : "border-slate-700/20"}`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/20"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Direction icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${order.direction === "BULL" ? "bg-emerald-500/15" : "bg-rose-500/15"}`}>
          {order.direction === "BULL"
            ? <TrendingUp size={16} className="text-emerald-400"/>
            : <TrendingDown size={16} className="text-rose-400"/>}
        </div>

        {/* Name + index */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-black text-slate-100 truncate">{order.strategyName}</div>
            <div className="text-[13px] text-indigo-400 font-mono">
              {methodLabels[order.discountMethod]}
            </div>
          </div>
          {leg && (
            <div className="text-[14px] text-slate-300 font-mono mt-1 bg-slate-900/40 px-2.5 py-2 rounded border border-slate-800/30 space-y-1.5">
              <div>
                <span className="text-slate-400">Active Time:</span> <span className="text-amber-300 font-bold">{formattedTime}</span>{" "}
                <span className="text-slate-500">|</span> <span className="text-indigo-300 font-black">{order.index}</span>{" "}
                <span className={`font-black ${order.direction === "BULL" ? "text-emerald-400" : "text-rose-400"}`}>{leg.side}_{leg.optionType}</span>{" "}
                <span className="text-slate-200 font-black">{leg.strike.toLocaleString()}</span>{" "}
                <span className="text-emerald-300 font-black">₹{leg.discountPrice}</span>
              </div>
              <div className="text-[13px] text-slate-400 flex items-center gap-1.5 pt-0.5 border-t border-slate-800/40">
                <span>📅 Expiry:</span>
                <span className="text-slate-200 font-bold">{expiryInfo.date}</span>
                <span className={`px-1.5 py-0.2 rounded text-[11px] font-bold ${
                  expiryInfo.type === "Monthly" 
                    ? "bg-purple-500/15 text-purple-300 border border-purple-500/20" 
                    : "bg-blue-500/15 text-blue-300 border border-blue-500/20"
                }`}>
                  {expiryInfo.type}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Status badge */}
        <div className={`px-2.5 py-0.5 rounded-full border text-[13px] font-black flex items-center gap-1 flex-shrink-0 ${statusStyle}`}>
          <span>{getOrderStatusIcon(order.status)}</span>
          <span>{order.status}</span>
        </div>

        {/* Paper badge */}
        {order.paperMode && (
          <span className="text-[12px] font-black px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 flex-shrink-0">
            PAPER
          </span>
        )}

        {expanded ? <ChevronUp size={16} className="text-slate-500 flex-shrink-0"/> : <ChevronDown size={16} className="text-slate-500 flex-shrink-0"/>}
      </div>

      {/* LTP Progress Bar (only when monitoring) */}
      {isActive && leg && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] text-slate-400">Signal LTP: <span className="text-slate-300 font-mono">Rs.{leg.signalLTP}</span></span>
            <span className="text-[13px] text-slate-400">Current: <span className="text-amber-300 font-mono font-black">Rs.{leg.currentLTP}</span></span>
            <span className="text-[13px] text-slate-400">Discount: <span className="text-emerald-300 font-mono font-black">Rs.{leg.discountPrice}</span></span>
          </div>
          <div className="h-2 rounded-full bg-slate-800/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[13px] text-slate-500">{progress.toFixed(0)}% discount pe pahuncha</span>
            <span className={`text-[13px] font-mono font-black ${
              parseInt(countdown) <= 5 ? "text-red-400" : "text-amber-400"
            }`}>
              <Timer size={12} className="inline mr-0.5"/>⏳ {countdown}
            </span>
          </div>
          <div className="mt-2 text-[13px] text-slate-300 bg-slate-900/60 rounded px-2.5 py-1.5 border border-slate-800/20 font-mono">
            {order.statusMessage}
          </div>
        </div>
      )}

      {/* Executed P&L */}
      {order.status === "EXECUTED" && (
        <div className="px-4 pb-3">
          <div className={`rounded-lg p-2.5 border ${order.estimatedPnL >= 0 ? "bg-emerald-950/30 border-emerald-500/20" : "bg-rose-950/30 border-rose-500/20"}`}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-slate-400">Unrealized P&L</span>
              <span className={`text-[17px] font-black font-mono ${order.estimatedPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {order.estimatedPnL >= 0 ? "+" : ""}₹{order.estimatedPnL.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[13px] text-slate-500">Fill: <span className="text-slate-300 font-mono">Rs.{leg?.fillPrice}</span></span>
              <span className="text-[13px] text-slate-500">SL: <span className="text-rose-400 font-mono">{order.slPrice.toLocaleString()}</span></span>
              <span className="text-[13px] text-slate-500">Target: <span className="text-emerald-400 font-mono">{order.targetPrice.toLocaleString()}</span></span>
            </div>
          </div>
          <div className="mt-2 text-[13px] text-emerald-300 bg-emerald-950/20 rounded px-2.5 py-1.5 font-mono">{order.statusMessage}</div>
        </div>
      )}

      {/* Expired / Cancelled message */}
      {(order.status === "EXPIRED" || order.status === "CANCELLED") && (
        <div className="px-4 pb-3">
          <div className="text-[9px] text-slate-500 bg-slate-900/40 rounded px-2 py-1 font-mono">{order.statusMessage}</div>
        </div>
      )}

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-slate-800/40 px-4 py-3 space-y-3">
          {/* AI Context at Signal */}
          <div>
            <div className="text-[9px] text-indigo-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1">
              <Activity size={9}/> Signal Context
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-slate-900/50 rounded px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 uppercase font-black">AI Confidence</div>
                <div className={`text-[13px] font-black mt-0.5 ${order.aiConfidence >= 70 ? "text-emerald-400" : order.aiConfidence >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                  {order.aiConfidence}%
                </div>
              </div>
              <div className="bg-slate-900/50 rounded px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 uppercase font-black">Smart Money</div>
                <div className={`text-[13px] font-black mt-0.5 ${order.smartMoneyScore >= 70 ? "text-emerald-400" : "text-amber-400"}`}>
                  {order.smartMoneyScore}
                </div>
              </div>
              <div className="bg-slate-900/50 rounded px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 uppercase font-black">Regime</div>
                <div className="text-[9px] font-black text-amber-300 mt-0.5">{order.signalRegime.replace(/_/g," ")}</div>
              </div>
            </div>
          </div>

          {/* Discount Entry Plan */}
          <div>
            <div className="text-[9px] text-amber-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1">
              <Crosshair size={9}/> Discount Entry Plan
            </div>
            <div className="rounded-lg bg-slate-900/60 border border-amber-500/15 p-2.5 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[9px] text-slate-500">Method</span>
                <span className="text-[9px] font-black text-amber-300">{order.discountMethod.replace(/_/g," ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-slate-500">Underlying at Signal</span>
                <span className="text-[9px] font-mono text-slate-300">{order.underlyingSignalPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-slate-500">Discount Target</span>
                <span className="text-[9px] font-mono font-black text-emerald-300">{order.underlyingDiscountPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-slate-500">Option Discount Price</span>
                <span className="text-[9px] font-mono font-black text-emerald-300">Rs.{leg?.discountPrice}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-slate-500">Max Entry (Cancel above)</span>
                <span className="text-[9px] font-mono text-rose-400">Rs.{leg?.maxEntryPrice}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-slate-500">Break Even</span>
                <span className="text-[9px] font-mono text-slate-300">{order.breakEvenPrice.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Risk */}
          <div>
            <div className="text-[11px] text-rose-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1">
              <Shield size={9}/> Risk Management
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-slate-900/50 rounded px-2 py-1.5 text-center">
                <div className="text-[10px] text-slate-500 uppercase font-black">Max Loss</div>
                <div className="text-[12px] font-black text-rose-400 font-mono mt-0.5">₹{order.maxLossRs.toLocaleString()}</div>
              </div>
              <div className="bg-slate-900/50 rounded px-2 py-1.5 text-center">
                <div className="text-[10px] text-slate-500 uppercase font-black">Target</div>
                <div className="text-[12px] font-black text-emerald-400 font-mono mt-0.5">₹{order.targetRs.toLocaleString()}</div>
              </div>
              <div className="bg-slate-900/50 rounded px-2 py-1.5 text-center">
                <div className="text-[10px] text-slate-500 uppercase font-black">Square Off</div>
                <div className="text-[12px] font-black text-slate-200 font-mono mt-0.5">{order.squareOffTime || "N/A (Positional)"}</div>
              </div>
            </div>
          </div>

          {/* Exit Plan & Trade Type */}
          <div>
            <div className="text-[11px] text-violet-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1">
              🚪 Exit Plan & Trade Type
            </div>
            <div className="rounded-lg bg-slate-900/60 border border-violet-500/15 p-2.5 space-y-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Trade Type:</span>
                <span className={`font-black ${!order.squareOffTime ? "text-purple-400" : "text-amber-400"}`}>
                  {!order.squareOffTime ? "POSITIONAL (NRML)" : "INTRADAY (MIS)"}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Hold Strategy:</span>
                <span className="text-slate-300 font-bold">
                  {!order.squareOffTime ? `Hold till Expiry (${expiryInfo.date})` : "Auto-Exit same day (MIS)"}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 leading-relaxed bg-slate-950/40 p-2 rounded border border-slate-800/30">
                💡 <span className="text-violet-300 font-bold">Exit Plan:</span>{" "}
                {!order.squareOffTime
                  ? `Positional trade hai. Target (₹${order.targetPrice.toLocaleString()}) ya Stop Loss (₹${order.slPrice.toLocaleString()}) hit hone ka wait karein. Expiry day (${expiryInfo.date}) ko market close hone se pehle auto-squareoff ya exit karein.`
                  : `Intraday trade hai. Target (₹${order.targetPrice.toLocaleString()}) ya Stop Loss (₹${order.slPrice.toLocaleString()}) aate hi exit lein. Bacha hua position auto square-off time ${order.squareOffTime} PM pe exit ho jayega.`
                }
              </div>
            </div>
          </div>

          {/* AI Brain Watch — compact conditions panel */}
          {isActive && (
            <AiBrainWatchPanel order={order} marketSnapshot={marketSnapshot} />
          )}

          {/* Cancel button */}
          {isActive && onCancel && (
            <button
              onClick={() => onCancel(order.id)}
              className="w-full py-1.5 rounded-lg border border-rose-500/30 text-rose-400 text-[10px] font-black hover:bg-rose-500/10 transition-all"
            >
              ❌ Cancel This Order
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Method Selector ───────────────────────────────────────────────────────────
const METHOD_OPTIONS: { value: DiscountMethod; label: string; desc: string; icon: string }[] = [
  { value: "RETEST",       label: "Retest Entry",   desc: "Breakout ke baad level retest hone pe entry", icon: "🔄" },
  { value: "ATR_PULLBACK", label: "ATR Pullback",    desc: "0.3 ATR pullback hone pe entry",              icon: "📉" },
  { value: "FIXED_PCT",    label: "% Pullback",      desc: "Option premium 6% sasta hone pe entry",       icon: "📊" },
  { value: "VWAP_TOUCH",   label: "VWAP Touch",      desc: "Price VWAP ko touch kare tab entry",          icon: "〰️" },
  { value: "IMMEDIATE",    label: "Immediate (Mkt)", desc: "Seedha current LTP pe entry (no discount)",   icon: "⚡" },
];

interface SmartOrderQueuePanelProps {
  socket?: any;
  legacyOptionChain?: any[];
  underlyingLTP?: number;
  marketSnapshot?: LiveMarketSnapshot;
  isMarketOpen?: boolean;
}

// ── Main Component ────────────────────────────────────────────────────────────
const SmartOrderQueuePanel: React.FC<SmartOrderQueuePanelProps> = ({
  socket,
  legacyOptionChain = [],
  underlyingLTP,
  marketSnapshot,
  isMarketOpen = false,
}) => {
  const [orders, setOrders] = useState<SmartPendingOrder[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<DiscountMethod>("RETEST");
  const [filterStatus, setFilterStatus] = useState<OrderStatus | "ALL">("ALL");
  const [showMethodPicker, setShowMethodPicker] = useState(false);

  // Sync real pending orders from backend Socket.IO
  useEffect(() => {
    if (!socket) return;

    const handleSync = (data: SmartPendingOrder[]) => {
      if (Array.isArray(data)) {
        setOrders(data);
      }
    };

    socket.on("smart-orders-update", handleSync);
    // Request initial state on load
    socket.emit("request-state");

    return () => {
      socket.off("smart-orders-update", handleSync);
    };
  }, [socket]);

  // Sync with live LTP and check triggers (Executes ONLY when actual LTP touches the discount price AND market is open)
  useEffect(() => {
    if (!legacyOptionChain || legacyOptionChain.length === 0) return;

    setOrders(prev => prev.map(o => {
      if (o.status !== "MONITORING" && o.status !== "QUEUED") return o;

      const leg = o.legs[0];
      if (!leg) return o;

      // Find actual option strike CE/PE price
      const matchedStrike = legacyOptionChain.find(s => s.strikePrice === leg.strike);
      let actualPremium = leg.currentLTP;
      if (matchedStrike) {
        const premium = leg.optionType === "CE" ? matchedStrike.ceLtp : matchedStrike.peLtp;
        if (typeof premium === "number" && premium > 0) {
          actualPremium = premium;
        }
      }

      const currentUnderlying = underlyingLTP ?? o.underlyingCurrentPrice;

      // Rule: Order tab active/executed when actual LTP touches/crosses discount price AND market is open
      if (actualPremium <= leg.discountPrice) {
        if (!isMarketOpen) {
          return {
            ...o,
            underlyingCurrentPrice: currentUnderlying,
            legs: [{ ...leg, currentLTP: actualPremium }],
            statusMessage: `⏳ Real LTP Rs.${actualPremium} نے discount Rs.${leg.discountPrice} ko touch kiya! Lekin market off hai, isliye order pending rahega jab tak market open nahi hota.`,
          };
        }

        // Asynchronously transition from TRIGGERED to EXECUTED after 1s broker delay
        setTimeout(() => {
          setOrders(currentOrders => currentOrders.map(item => {
            if (item.id === o.id && item.status === "TRIGGERED") {
              return {
                ...item,
                status: "EXECUTED" as OrderStatus,
                executedAt: new Date().toISOString(),
                legs: item.legs.map(l => ({ ...l, fillPrice: l.currentLTP })),
                totalPremiumPaid: item.legs[0].currentLTP * item.legs[0].lots * item.legs[0].lotSize,
                statusMessage: `✅ Order executed at Rs.${item.legs[0].currentLTP} (Real LTP touched discount).`,
              };
            }
            return item;
          }));
        }, 1000);

        return {
          ...o,
          status: "TRIGGERED" as OrderStatus,
          triggeredAt: new Date().toISOString(),
          underlyingCurrentPrice: currentUnderlying,
          legs: [{ ...leg, currentLTP: actualPremium }],
          statusMessage: `⚡ Real LTP Rs.${actualPremium} ne discount Rs.${leg.discountPrice} ko touch kiya! Firing order...`,
        };
      }

      // Check max entry limit (Price ran away)
      if (actualPremium > leg.maxEntryPrice) {
        return {
          ...o,
          status: "CANCELLED" as OrderStatus,
          statusMessage: `❌ Price ran away: Real LTP Rs.${actualPremium} crossed max entry Rs.${leg.maxEntryPrice}.`,
        };
      }

      // Check time expiry
      const now = new Date();
      if (new Date(o.expiresAt) < now) {
        return {
          ...o,
          status: "EXPIRED" as OrderStatus,
          statusMessage: `⌛ Time expired: Real LTP did not touch discount price within time limit.`,
        };
      }

      // Maintain pending status otherwise
      return {
        ...o,
        underlyingCurrentPrice: currentUnderlying,
        legs: [{ ...leg, currentLTP: actualPremium }],
        statusMessage: `${o.index} discount zone ka wait. Current: ${currentUnderlying.toLocaleString()} | Option LTP: Rs.${actualPremium}`,
      };
    }));
  }, [legacyOptionChain, underlyingLTP]);

  const handleCancel = useCallback((id: string) => {
    if (socket) {
      socket.emit("cancel-smart-order", id);
    } else {
      setOrders(prev => prev.map(o => o.id === id
        ? { ...o, status: "CANCELLED" as OrderStatus, statusMessage: "Manually cancelled by user." }
        : o
      ));
    }
  }, [socket]);

  const filteredOrders = filterStatus === "ALL"
    ? orders
    : orders.filter(o => o.status === filterStatus);

  const counts = {
    monitoring: orders.filter(o => o.status === "MONITORING" || o.status === "QUEUED").length,
    triggered:  orders.filter(o => o.status === "TRIGGERED").length,
    executed:   orders.filter(o => o.status === "EXECUTED").length,
    expired:    orders.filter(o => o.status === "EXPIRED" || o.status === "CANCELLED").length,
  };

  const statusFilters: Array<{ key: OrderStatus | "ALL"; label: string; count: number; color: string }> = [
    { key: "ALL",        label: "Sab",       count: orders.length, color: "text-slate-300 border-slate-600/40 bg-slate-800/30" },
    { key: "MONITORING", label: "Monitoring", count: counts.monitoring, color: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
    { key: "TRIGGERED",  label: "Triggered",  count: counts.triggered,  color: "text-indigo-400 border-indigo-500/30 bg-indigo-500/10" },
    { key: "EXECUTED",   label: "Executed",   count: counts.executed,   color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
    { key: "EXPIRED",    label: "Expired",    count: counts.expired,    color: "text-slate-500 border-slate-700/30 bg-slate-800/20" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-950 border border-indigo-500/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <Crosshair size={14} className="text-indigo-400"/>
              </div>
              <h2 className="text-sm font-black text-white">Smart Order Queue</h2>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/25">PAPER MODE</span>
            </div>
            <p className="text-[10px] text-slate-400 max-w-md">
              Signal generate hone ke baad system <span className="text-amber-300 font-black">discount price</span> ka wait karta hai.
              Jab LTP target pe aaye tab order automatically execute hota hai.
            </p>
          </div>
          <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
            <div className="text-[22px] font-black text-indigo-400 mt-1">{counts.monitoring}</div>
            <div className="text-[9px] text-slate-500 uppercase tracking-widest">Monitoring</div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { label: "Pending",  value: counts.monitoring, color: "text-amber-400" },
            { label: "Triggered", value: counts.triggered, color: "text-indigo-400" },
            { label: "Executed",  value: counts.executed,  color: "text-emerald-400" },
            { label: "Expired",   value: counts.expired,   color: "text-slate-500" },
          ].map(s => (
            <div key={s.label} className="bg-slate-900/60 rounded-lg px-2 py-2 text-center border border-slate-700/20">
              <div className={`text-[18px] font-black ${s.color}`}>{s.value}</div>
              <div className="text-[8px] text-slate-500 uppercase tracking-widest">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Discount Method Selector */}
      <div className="rounded-xl border border-slate-700/30 bg-slate-900/60 p-3">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setShowMethodPicker(m => !m)}
        >
          <div className="flex items-center gap-2">
            <Target size={12} className="text-amber-400"/>
            <span className="text-[10px] font-black text-slate-200">Default Discount Method</span>
            <span className="text-[9px] font-black px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
              {METHOD_OPTIONS.find(m => m.value === selectedMethod)?.label}
            </span>
          </div>
          {showMethodPicker ? <ChevronUp size={12} className="text-slate-500"/> : <ChevronDown size={12} className="text-slate-500"/>}
        </div>

        {showMethodPicker && (
          <div className="mt-3 space-y-1.5">
            {METHOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setSelectedMethod(opt.value); setShowMethodPicker(false); }}
                className={`w-full flex items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-all border ${
                  selectedMethod === opt.value
                    ? "bg-indigo-500/15 border-indigo-500/30"
                    : "bg-slate-900/40 border-slate-700/20 hover:bg-slate-800/40"
                }`}
              >
                <span className="text-base">{opt.icon}</span>
                <div>
                  <div className={`text-[10px] font-black ${selectedMethod === opt.value ? "text-indigo-300" : "text-slate-300"}`}>{opt.label}</div>
                  <div className="text-[9px] text-slate-500">{opt.desc}</div>
                </div>
                {selectedMethod === opt.value && <CheckCircle size={12} className="text-indigo-400 ml-auto mt-0.5 flex-shrink-0"/>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {statusFilters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilterStatus(f.key)}
            className={`px-2.5 py-1 rounded-lg border text-[9px] font-black transition-all flex items-center gap-1 ${
              filterStatus === f.key ? f.color : "text-slate-500 border-slate-700/20 bg-slate-900/30"
            }`}
          >
            {f.label}
            <span className="text-[8px] opacity-75">({f.count})</span>
          </button>
        ))}
      </div>

      {/* Orders list */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-indigo-500/20 bg-gradient-to-br from-indigo-950/20 via-slate-900/60 to-slate-950 p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
              <Eye size={24} className="text-indigo-400/60"/>
            </div>
            <div className="text-[13px] font-black text-slate-300 mb-1">Live Signal ka Intezaar</div>
            <div className="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed mb-3">
              Abhi koi active signal nahi hai. Jab AI engine market mein
              valid breakout / pattern detect karega, tab yahan order
              automatically aayega — real LTP ke saath.
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"/>
              <span className="text-[10px] font-black text-amber-400">
                {isMarketOpen ? "Market OPEN — monitoring..." : "Market CLOSED — signals aane par yahan dikhenge"}
              </span>
            </div>
            <div className="mt-4 text-[9px] text-slate-600 font-mono">
              ⚠️ Koi fake / demo data nahi dikhaya jayega. Sirf real signals.
            </div>
          </div>
        ) : (
          filteredOrders.map(order => (
            <OrderCard key={order.id} order={order} onCancel={handleCancel} marketSnapshot={marketSnapshot}/>
          ))
        )}
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-slate-700/20 bg-slate-900/40 p-4">
        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1">
          <Zap size={9}/> Ye Kaise Kaam Karta Hai
        </div>
        <div className="space-y-2">
          {[
            { step: "1", icon: "🔍", label: "Signal Detect",   desc: "AI breakout/pattern signal generate karta hai" },
            { step: "2", icon: "📊", label: "Fake Filter",     desc: "7 filters se fake breakout block hota hai" },
            { step: "3", icon: "🎯", label: "Discount Calc",   desc: "AI best entry price (discount zone) calculate karta hai" },
            { step: "4", icon: "👁", label: "LTP Monitor",     desc: "Har second LTP vs discount price compare hota hai" },
            { step: "5", icon: "⚡", label: "Auto Execute",    desc: "LTP = Discount Price → Order turant fire hota hai" },
            { step: "6", icon: "🛡", label: "SL + Target",    desc: "Order ke saath SL aur target auto set ho jaate hain" },
          ].map(s => (
            <div key={s.step} className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-[8px] font-black text-indigo-400 flex items-center justify-center flex-shrink-0">
                {s.step}
              </div>
              <span className="text-base">{s.icon}</span>
              <div>
                <span className="text-[9px] font-black text-slate-200">{s.label} </span>
                <span className="text-[9px] text-slate-500">— {s.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Execution History ─────────────────────────────────────────────── */}
      {(() => {
        const historyOrders = orders.filter(o =>
          o.status === "EXECUTED" || o.status === "EXPIRED" || o.status === "CANCELLED"
        ).sort((a, b) => {
          const tA = a.executedAt || a.createdAt;
          const tB = b.executedAt || b.createdAt;
          return new Date(tB).getTime() - new Date(tA).getTime();
        });

        const totalPnl = historyOrders
          .filter(o => o.status === "EXECUTED" && o.realizedPnl != null)
          .reduce((sum, o) => sum + (o.realizedPnl ?? 0), 0);

        const handleCopyHistory = () => {
          const lines = historyOrders.map(o => {
            const t = new Date(o.executedAt || o.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            const pnl = o.realizedPnl != null ? `₹${o.realizedPnl.toFixed(0)}` : "--";
            return `${t} | ${o.status} | ${o.direction} | Entry: ${o.legs?.[0]?.discountPrice?.toFixed(0) ?? "--"} | P&L: ${pnl} | ${o.symbol ?? ""}`;
          });
          navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
        };

        return (
          <div className="rounded-xl border border-slate-700/25 bg-[#060d1a] overflow-hidden">
            {/* History Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/50">
              <div className="flex items-center gap-2">
                <CheckCircle size={12} className="text-emerald-400"/>
                <span className="text-[9px] font-black text-slate-300 uppercase tracking-wider">Execution History</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 font-mono">{historyOrders.length}</span>
              </div>
              <div className="flex items-center gap-3">
                {historyOrders.length > 0 && (
                  <span className={`text-[9px] font-black font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toFixed(0)} today
                  </span>
                )}
                {historyOrders.length > 0 && (
                  <button
                    onClick={handleCopyHistory}
                    className="text-[8px] text-slate-500 hover:text-slate-300 font-mono px-2 py-0.5 rounded border border-slate-700/30 hover:border-slate-600/50 transition-colors"
                  >
                    📋 Copy
                  </button>
                )}
              </div>
            </div>

            {/* History Table */}
            {historyOrders.length === 0 ? (
              <div className="py-6 text-center">
                <div className="text-[10px] text-slate-600 font-mono">Abhi koi executed / expired order nahi hai</div>
                <div className="text-[9px] text-slate-700 mt-1">Jab order execute ya expire hoga tab yahan dikhega</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/40">
                {historyOrders.slice(0, 20).map(o => {
                  const t = o.executedAt || o.createdAt;
                  const timeStr = t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--";
                  const entryPrice = o.legs?.[0]?.discountPrice;
                  const currentLTP = o.legs?.[0]?.currentLTP;
                  const isExec = o.status === "EXECUTED";
                  const isCancelled = o.status === "CANCELLED";
                  const pnl = o.realizedPnl;

                  return (
                    <div key={o.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/20 transition-colors">
                      {/* Status dot */}
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isExec ? 'bg-emerald-400' : isCancelled ? 'bg-amber-500' : 'bg-slate-600'}`}/>

                      {/* Time */}
                      <span className="text-[8px] font-mono text-slate-500 w-14 flex-shrink-0">{timeStr}</span>

                      {/* Direction badge */}
                      <span className={`text-[7px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${o.direction === "BULL" ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'}`}>
                        {o.direction === "BULL" ? "CE" : "PE"}
                      </span>

                      {/* Symbol / Strike */}
                      <span className="text-[9px] font-mono text-slate-300 flex-1 truncate">{o.symbol ?? `Strike ~${entryPrice?.toFixed(0) ?? '--'}`}</span>

                      {/* Entry price */}
                      <span className="text-[9px] font-mono text-slate-400 flex-shrink-0">₹{entryPrice?.toFixed(0) ?? '--'}</span>

                      {/* P&L or status */}
                      {isExec && pnl != null ? (
                        <span className={`text-[9px] font-black font-mono flex-shrink-0 ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}
                        </span>
                      ) : (
                        <span className={`text-[8px] font-mono flex-shrink-0 ${isExec ? 'text-emerald-500' : isCancelled ? 'text-amber-500' : 'text-slate-600'}`}>
                          {o.status}
                        </span>
                      )}
                    </div>
                  );
                })}
                {historyOrders.length > 20 && (
                  <div className="py-2 text-center text-[8px] text-slate-600 font-mono">
                    +{historyOrders.length - 20} aur orders... filter se dekho
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default SmartOrderQueuePanel;
