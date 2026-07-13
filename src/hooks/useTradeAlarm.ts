/**
 * useTradeAlarm.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * React hook for trade alarms — OS notifications + loud audio alarm
 *
 * Features:
 *  - OS Notification with requireInteraction=true (stays until user clicks)
 *  - Loud multi-tone audio alarm (works even when tab is not focused)
 *  - Stores last 20 alarms for display in TradeAlarmPanel
 *  - Auto-requests notification permission on first trade
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AlarmType =
  | "ENTRY" | "EXIT_PROFIT" | "EXIT_LOSS" | "SL_TRAIL"
  | "SL_BREAKEVEN" | "TARGET_HIT" | "SL_HIT"
  | "FORCE_EXIT" | "THETA_EXIT" | "IV_CRUSH_EXIT" | "GAMMA_EXIT";

export interface TradeAlarmPayload {
  id:           string;
  tradeId:      string;
  type:         AlarmType;
  instrument:   "NIFTY" | "BANKNIFTY" | "SENSEX";
  direction:    "BUY_CE" | "BUY_PE";
  strike:       number;
  optionSymbol: string;
  entry:        number;
  sl:           number;
  tp:           number;
  currentLTP:   number;
  pnl?:         number;
  lots:         number;
  lotSize:      number;
  confidence:   number;
  grade:        string;
  strategyName: string;
  whyTaken: {
    weightedStockScore:  number;
    weightedDirection:   string;
    keyStockMovers:      string;
    specialTrioStatus:   string;
    bankingSectorScore:  number;
    regimeLabel:         string;
    breadthScore:        number;
    pcr:                 number;
    momentumScore:       number;
    smartMoneyBias:      string;
    gatesPassed:         number;
    totalGates:          number;
    layerConsensus:      string;
    orbStatus:           string;
    signalGrade:         string;
    antigravityScore:    number;
    vix:                 number;
    vixCategory:         string;
    strategyReason:      string;
  };
  tradesToday:  number;
  dailyPnl:     number;
  dailyTarget:  number;
  timestamp:    number;
}

// ── Audio Alarm Functions ──────────────────────────────────────────────────────

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  volume: number = 0.35,
): void {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(volume, ctx.currentTime + startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration + 0.05);
}

function playTradeAlarm(type: AlarmType, direction: "BUY_CE" | "BUY_PE"): void {
  try {
    const ctx = new AudioContext();

    if (type === "ENTRY") {
      // 5-tone ascending alarm — LOUD and unmissable
      const freqs = direction === "BUY_CE"
        ? [440, 523, 659, 784, 880]   // Rising (bullish)
        : [880, 784, 659, 523, 440];  // Falling (bearish)
      freqs.forEach((freq, i) => playTone(ctx, freq, i * 0.14, 0.2, 0.45));

    } else if (type === "TARGET_HIT" || type === "EXIT_PROFIT") {
      // 3-tone victory
      [523, 659, 784].forEach((freq, i) => playTone(ctx, freq, i * 0.18, 0.25, 0.5));

    } else if (type === "SL_HIT" || type === "EXIT_LOSS") {
      // 3-tone descending warning
      [400, 320, 240].forEach((freq, i) => playTone(ctx, freq, i * 0.18, 0.25, 0.45));

    } else if (type === "SL_TRAIL" || type === "SL_BREAKEVEN") {
      // 2-tone confirm
      [440, 550].forEach((freq, i) => playTone(ctx, freq, i * 0.15, 0.18, 0.25));

    } else if (type === "FORCE_EXIT" || type === "THETA_EXIT" || type === "IV_CRUSH_EXIT") {
      // Time exit: 2 descending tones
      [380, 280].forEach((freq, i) => playTone(ctx, freq, i * 0.2, 0.2, 0.35));
    }
  } catch {
    // AudioContext blocked — fallback to system beep is handled by OS notification
  }
}

// ── OS Notification Builder ────────────────────────────────────────────────────

function sendOsNotification(alarm: TradeAlarmPayload): void {
  if (!("Notification" in window)) return;

  const { type, instrument, direction, entry, sl, tp, pnl, confidence, whyTaken } = alarm;

  const isEntry = type === "ENTRY";
  const isPnl   = pnl !== undefined;

  const icon  = direction === "BUY_CE" ? "📈" : "📉";
  const emoji =
    type === "ENTRY"        ? (direction === "BUY_CE" ? "🟢" : "🔴") :
    type === "TARGET_HIT"   ? "✅" :
    type === "EXIT_PROFIT"  ? "✅" :
    type === "SL_HIT"       ? "❌" :
    type === "EXIT_LOSS"    ? "❌" :
    type === "SL_TRAIL"     ? "🔒" :
    type === "SL_BREAKEVEN" ? "🔒" :
    type === "FORCE_EXIT"   ? "⏰" : "📢";

  const title = isEntry
    ? `${emoji} ${instrument} ${direction.replace("BUY_", "")} TRADE TAKEN — Grade ${alarm.grade}`
    : isPnl
    ? `${emoji} ${type.replace("_", " ")}: ${instrument} ${direction.replace("BUY_", "")} ${pnl! >= 0 ? "+" : ""}₹${pnl!.toFixed(0)}`
    : `${emoji} ${type.replace("_", " ")}: ${instrument} ${direction.replace("BUY_", "")}`;

  const bodyLines: string[] = [];

  if (isEntry) {
    bodyLines.push(`Entry ₹${entry} | SL ₹${sl} | Target ₹${tp}`);
    bodyLines.push(`Why: ${whyTaken.keyStockMovers || "Multi-engine confluence"}`);
    bodyLines.push(`${whyTaken.gatesPassed}/${whyTaken.totalGates} gates | Confidence: ${confidence}%`);
    bodyLines.push(`${whyTaken.orbStatus || ""}`);
  } else if (type === "SL_TRAIL" || type === "SL_BREAKEVEN") {
    bodyLines.push(`SL moved → ₹${sl}`);
    if (type === "SL_BREAKEVEN") bodyLines.push("✅ Cost-to-cost secured!");
  } else if (isPnl) {
    bodyLines.push(`Exit @ ₹${alarm.currentLTP} | P&L: ${pnl! >= 0 ? "+" : ""}₹${pnl!.toFixed(0)}`);
    bodyLines.push(`Daily P&L: ₹${alarm.dailyPnl.toFixed(0)} / Target ₹${alarm.dailyTarget}`);
  }

  try {
    // User requested to stop Chrome popup messages, routing to system console instead
    console.log(`[TRADE ALARM] ${title}\n${bodyLines.join("\\n")}`);
  } catch {}
}

// ── Main Hook ──────────────────────────────────────────────────────────────────

export function useTradeAlarm(socket: Socket | null) {
  const [alarmHistory, setAlarmHistory] = useState<TradeAlarmPayload[]>([]);
  const [latestAlarm, setLatestAlarm]   = useState<TradeAlarmPayload | null>(null);
  const [notifAllowed, setNotifAllowed] = useState(false);
  const permissionRequested = useRef(false);

  // Request notification permission on mount
  useEffect(() => {
    if (permissionRequested.current) return;
    permissionRequested.current = true;

    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setNotifAllowed(true);
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(perm => {
        setNotifAllowed(perm === "granted");
      });
    }
  }, []);

  // Listen to trade-alarm socket events
  useEffect(() => {
    if (!socket) return;

    const handleAlarm = (alarm: TradeAlarmPayload) => {
      // Play audio alarm
      playTradeAlarm(alarm.type, alarm.direction);

      // Send OS notification
      if (notifAllowed || Notification.permission === "granted") {
        sendOsNotification(alarm);
      }

      // Update state
      setLatestAlarm(alarm);
      setAlarmHistory(prev => [alarm, ...prev].slice(0, 30));
    };

    socket.on("trade-alarm", handleAlarm);
    return () => { socket.off("trade-alarm", handleAlarm); };
  }, [socket, notifAllowed]);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return false;
    const perm = await Notification.requestPermission();
    setNotifAllowed(perm === "granted");
    return perm === "granted";
  }, []);

  return {
    alarmHistory,
    latestAlarm,
    notifAllowed,
    requestPermission,
  };
}
