/**
 * tradeAlarmEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Trade Alarm Engine — PC me Alarm bhejta hai jab bhi trade ho
 *
 * Features:
 *  - Trade ENTRY → 5-tone ascending alarm + OS notification (requireInteraction=true)
 *  - Trade EXIT  → 3-tone descending alarm
 *  - SL Trail    → 2-tone notification
 *  - Target Hit  → 3-tone victory alarm
 *  - Full trade details: Entry/SL/TP/WHY (stock weightage analysis, layer votes, etc.)
 *
 * Called by: autoTradingService.ts on every trade action
 * Emits: "trade-alarm" socket event → useTradeAlarm.ts hook on client
 */

import type { Server as SocketIOServer } from "socket.io";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AlarmType =
  | "ENTRY"
  | "EXIT_PROFIT"
  | "EXIT_LOSS"
  | "SL_TRAIL"
  | "SL_BREAKEVEN"
  | "TARGET_HIT"
  | "SL_HIT"
  | "FORCE_EXIT"
  | "THETA_EXIT"
  | "IV_CRUSH_EXIT"
  | "GAMMA_EXIT";

export interface TradeAlarmPayload {
  id:            string;       // Unique alarm ID
  tradeId:       string;       // Paper trade ID
  type:          AlarmType;
  instrument:    "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction:     "BUY_CE" | "BUY_PE";
  strike:        number;       // Strike price (e.g. 24500)
  optionSymbol:  string;       // Fyers symbol

  // Price levels
  entry:         number;       // Entry premium ₹
  sl:            number;       // Current SL ₹
  tp:            number;       // Target ₹
  currentLTP:    number;       // Live LTP at alarm time ₹
  pnl?:          number;       // Realized P&L for exits ₹
  lots:          number;
  lotSize:       number;

  // AI Decision Details
  confidence:    number;       // AI confidence %
  grade:         string;       // A+ / A / B / C
  strategyName:  string;       // "ORB_NAKED" / "FII_FLOW_INTRADAY" / etc.

  // WHY THIS TRADE WAS TAKEN
  whyTaken: {
    weightedStockScore:  number;   // Net weighted contribution
    weightedDirection:   string;   // BULLISH / BEARISH
    keyStockMovers:      string;   // "HDFCBANK +1.2%, ICICI +0.8%"
    specialTrioStatus:   string;   // "All 3 bullish (+21.1)"
    bankingSectorScore:  number;
    regimeLabel:         string;   // "TRENDING_BULL"
    breadthScore:        number;   // 68
    pcr:                 number;   // 1.24
    momentumScore:       number;   // 74
    smartMoneyBias:      string;   // "ACCUMULATION"
    gatesPassed:         number;   // 8/9
    totalGates:          number;   // 9
    layerConsensus:      string;   // "CE: 8 layers | PE: 2 | Neutral: 7"
    orbStatus:           string;   // "Above ORB high 24510"
    signalGrade:         string;   // "A"
    antigravityScore:    number;   // 82
    vix:                 number;
    vixCategory:         string;   // "NORMAL"
    strategyReason:      string;   // Full reason from strategy registry
  };

  // Daily progress
  tradesToday:   number;       // How many trades done today
  dailyPnl:      number;       // Today's realized P&L ₹
  dailyTarget:   number;       // Target ₹ (3000 default)

  timestamp:     number;       // Unix ms
}

// ── Alarm History (in-memory, last 50) ──────────────────────────────────────

const alarmHistory: TradeAlarmPayload[] = [];
const MAX_ALARM_HISTORY = 50;

export function getAlarmHistory(): TradeAlarmPayload[] {
  return [...alarmHistory];
}

// ── Core Emitter ───────────────────────────────────────────────────────────────

export function emitTradeAlarm(
  io: SocketIOServer,
  alarm: TradeAlarmPayload,
): void {
  // Store in history
  alarmHistory.unshift(alarm);
  if (alarmHistory.length > MAX_ALARM_HISTORY) {
    alarmHistory.length = MAX_ALARM_HISTORY;
  }

  // Emit to all connected clients
  io.emit("trade-alarm", alarm);

  // Log clearly
  const icon =
    alarm.type === "ENTRY"       ? "🚨 ENTRY" :
    alarm.type === "TARGET_HIT"  ? "✅ TARGET" :
    alarm.type === "SL_HIT"      ? "❌ SL HIT" :
    alarm.type === "SL_TRAIL"    ? "🔒 SL TRAIL" :
    alarm.type === "FORCE_EXIT"  ? "⏰ FORCE EXIT" :
    alarm.type === "EXIT_PROFIT" ? "✅ PROFIT EXIT" :
    alarm.type === "EXIT_LOSS"   ? "❌ LOSS EXIT" : "📢";

  console.log(
    `[TradeAlarm] ${icon} | ${alarm.instrument} ${alarm.direction} @ ₹${alarm.currentLTP.toFixed(1)}` +
    ` | Entry ₹${alarm.entry} | SL ₹${alarm.sl} | TP ₹${alarm.tp}` +
    (alarm.pnl !== undefined ? ` | P&L ₹${alarm.pnl.toFixed(0)}` : "") +
    ` | ${alarm.strategyName} | Conf ${alarm.confidence}%`
  );
}

// ── Factory Helpers ────────────────────────────────────────────────────────────

/**
 * Build a trade entry alarm payload from auto-trade data
 */
export function buildEntryAlarm(params: {
  tradeId:        string;
  instrument:     "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction:      "BUY_CE" | "BUY_PE";
  strike:         number;
  optionSymbol:   string;
  entry:          number;
  sl:             number;
  tp:             number;
  lots:           number;
  lotSize:        number;
  confidence:     number;
  grade:          string;
  strategyName:   string;
  whyTaken:       TradeAlarmPayload["whyTaken"];
  tradesToday:    number;
  dailyPnl:       number;
  dailyTarget:    number;
}): TradeAlarmPayload {
  return {
    id: `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    tradeId: params.tradeId,
    type: "ENTRY",
    instrument: params.instrument,
    direction: params.direction,
    strike: params.strike,
    optionSymbol: params.optionSymbol,
    entry: params.entry,
    sl: params.sl,
    tp: params.tp,
    currentLTP: params.entry,
    lots: params.lots,
    lotSize: params.lotSize,
    confidence: params.confidence,
    grade: params.grade,
    strategyName: params.strategyName,
    whyTaken: params.whyTaken,
    tradesToday: params.tradesToday,
    dailyPnl: params.dailyPnl,
    dailyTarget: params.dailyTarget,
    timestamp: Date.now(),
  };
}

/**
 * Build an exit alarm payload
 */
export function buildExitAlarm(params: {
  tradeId:      string;
  instrument:   "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction:    "BUY_CE" | "BUY_PE";
  strike:       number;
  optionSymbol: string;
  entry:        number;
  sl:           number;
  tp:           number;
  exitPrice:    number;
  pnl:          number;
  lots:         number;
  lotSize:      number;
  exitReason:   string;
  strategyName: string;
  tradesToday:  number;
  dailyPnl:     number;
  dailyTarget:  number;
}): TradeAlarmPayload {
  const type: AlarmType =
    params.exitReason.includes("TARGET")     ? "TARGET_HIT"  :
    params.exitReason.includes("STOP LOSS")  ? "SL_HIT"      :
    params.exitReason.includes("TRAILING")   ? "SL_HIT"      :
    params.exitReason.includes("FORCE")      ? "FORCE_EXIT"  :
    params.exitReason.includes("THETA")      ? "THETA_EXIT"  :
    params.exitReason.includes("IV CRUSH")   ? "IV_CRUSH_EXIT":
    params.exitReason.includes("GAMMA")      ? "GAMMA_EXIT"  :
    params.pnl >= 0                          ? "EXIT_PROFIT" : "EXIT_LOSS";

  return {
    id: `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    tradeId: params.tradeId,
    type,
    instrument: params.instrument,
    direction: params.direction,
    strike: params.strike,
    optionSymbol: params.optionSymbol,
    entry: params.entry,
    sl: params.sl,
    tp: params.tp,
    currentLTP: params.exitPrice,
    pnl: params.pnl,
    lots: params.lots,
    lotSize: params.lotSize,
    confidence: 0,
    grade: "",
    strategyName: params.strategyName,
    whyTaken: {
      weightedStockScore: 0,
      weightedDirection: "",
      keyStockMovers: "",
      specialTrioStatus: "",
      bankingSectorScore: 0,
      regimeLabel: "",
      breadthScore: 0,
      pcr: 0,
      momentumScore: 0,
      smartMoneyBias: "",
      gatesPassed: 0,
      totalGates: 9,
      layerConsensus: "",
      orbStatus: "",
      signalGrade: "",
      antigravityScore: 0,
      vix: 0,
      vixCategory: "",
      strategyReason: params.exitReason,
    },
    tradesToday: params.tradesToday,
    dailyPnl: params.dailyPnl,
    dailyTarget: params.dailyTarget,
    timestamp: Date.now(),
  };
}

/**
 * Build a trailing SL update alarm
 */
export function buildSLTrailAlarm(params: {
  tradeId:      string;
  instrument:   "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction:    "BUY_CE" | "BUY_PE";
  strike:       number;
  optionSymbol: string;
  entry:        number;
  oldSL:        number;
  newSL:        number;
  tp:           number;
  currentLTP:   number;
  isBreakeven:  boolean;
  lots:         number;
  lotSize:      number;
  strategyName: string;
  tradesToday:  number;
  dailyPnl:     number;
  dailyTarget:  number;
}): TradeAlarmPayload {
  return {
    id: `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    tradeId: params.tradeId,
    type: params.isBreakeven ? "SL_BREAKEVEN" : "SL_TRAIL",
    instrument: params.instrument,
    direction: params.direction,
    strike: params.strike,
    optionSymbol: params.optionSymbol,
    entry: params.entry,
    sl: params.newSL,
    tp: params.tp,
    currentLTP: params.currentLTP,
    lots: params.lots,
    lotSize: params.lotSize,
    confidence: 0,
    grade: "",
    strategyName: params.strategyName,
    whyTaken: {
      weightedStockScore: 0,
      weightedDirection: "",
      keyStockMovers: `SL updated from ₹${params.oldSL.toFixed(1)} → ₹${params.newSL.toFixed(1)}`,
      specialTrioStatus: params.isBreakeven ? "BREAKEVEN achieved" : "Trailing SL active",
      bankingSectorScore: 0,
      regimeLabel: "",
      breadthScore: 0,
      pcr: 0,
      momentumScore: 0,
      smartMoneyBias: "",
      gatesPassed: 0,
      totalGates: 9,
      layerConsensus: "",
      orbStatus: "",
      signalGrade: "",
      antigravityScore: 0,
      vix: 0,
      vixCategory: "",
      strategyReason: params.isBreakeven
        ? `SL moved to BREAKEVEN ₹${params.newSL.toFixed(1)}`
        : `Trailing SL: ₹${params.oldSL.toFixed(1)} → ₹${params.newSL.toFixed(1)}`,
    },
    tradesToday: params.tradesToday,
    dailyPnl: params.dailyPnl,
    dailyTarget: params.dailyTarget,
    timestamp: Date.now(),
  };
}
