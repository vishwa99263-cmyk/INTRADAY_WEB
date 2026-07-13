/**
 * useAMEXNotifications.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Notification System
 *
 * Fires three simultaneous alert channels for every new signal:
 *   1. Browser Push Notification (via Notification API)
 *   2. In-app Toast (returned as state to render in parent components)
 *   3. Sound alert (AudioContext short beep, optional)
 *
 * Deduplicates: will not re-fire for the same signal ID within 3 minutes.
 */

import { useState, useCallback, useRef, useEffect } from "react";

export type AMEXToastType = "BUY_CE" | "BUY_PE" | "MICRO_ALERT" | "FORCE_SIGNAL" | "RISK_HALT" | "INFO";

export interface AMEXToast {
  id: string;
  type: AMEXToastType;
  title: string;
  message: string;
  confidence?: number;
  timestamp: number;
  tradeType?: string;
  strike?: number;
  entryPrice?: number;
}

interface NotificationPayload {
  signalId: string;
  type: AMEXToastType;
  title: string;
  message: string;
  confidence?: number;
  tradeType?: string;
  strike?: number;
  entryPrice?: number;
  playSound?: boolean;
}

const DEDUP_WINDOW_MS = 3 * 60 * 1000;   // 3-minute dedup window
const TOAST_DISPLAY_MS = 8000;            // Auto-dismiss toasts after 8 seconds

// Short ascending beep sequence for buy, descending for sell/alert
function playBeep(type: AMEXToastType) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };

    if (type === "BUY_CE") {
      playTone(440, 0, 0.12);
      playTone(554, 0.14, 0.12);
      playTone(659, 0.28, 0.18);
    } else if (type === "BUY_PE") {
      playTone(659, 0, 0.12);
      playTone(554, 0.14, 0.12);
      playTone(440, 0.28, 0.18);
    } else if (type === "RISK_HALT") {
      playTone(220, 0, 0.3);
      playTone(180, 0.35, 0.3);
    } else {
      playTone(523, 0, 0.15);
      playTone(523, 0.2, 0.1);
    }
  } catch {
    // AudioContext unavailable — silently skip
  }
}

function fireBrowserNotification(title: string, body: string, type: AMEXToastType) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const iconColor = type === "BUY_CE" ? "🟢" : type === "BUY_PE" ? "🔴" : type === "RISK_HALT" ? "🚨" : "🔔";
  try {
    new Notification(`${iconColor} ${title}`, {
      body,
      tag: `amex-${type}`,  // replaces duplicate tag notifications
      silent: true,         // we handle sound ourselves
    });
  } catch {
    // Notifications blocked or unavailable
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function useAMEXNotifications() {
  const [toasts, setToasts] = useState<AMEXToast[]>([]);
  const recentSignals = useRef<Map<string, number>>(new Map());
  const permissionRequested = useRef(false);

  // Request browser notification permission once on first mount
  useEffect(() => {
    if (!permissionRequested.current && typeof window !== "undefined" && "Notification" in window) {
      permissionRequested.current = true;
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  // Auto-dismiss toasts after TOAST_DISPLAY_MS
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - TOAST_DISPLAY_MS;
      setToasts(prev => prev.filter(t => t.timestamp > cutoff));
    }, TOAST_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const fireNotification = useCallback((payload: NotificationPayload) => {
    const now = Date.now();

    // Dedup check
    const lastFired = recentSignals.current.get(payload.signalId);
    if (lastFired && now - lastFired < DEDUP_WINDOW_MS) return;
    recentSignals.current.set(payload.signalId, now);

    // 1. In-app toast
    const toast: AMEXToast = {
      id: `toast-${now}-${Math.random().toString(36).slice(2, 5)}`,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      confidence: payload.confidence,
      timestamp: now,
      tradeType: payload.tradeType,
      strike: payload.strike,
      entryPrice: payload.entryPrice,
    };
    setToasts(prev => [toast, ...prev].slice(0, 5)); // max 5 stacked toasts

    // 2. Browser notification
    fireBrowserNotification(payload.title, payload.message, payload.type);

    // 3. Sound (optional, default on)
    if (payload.playSound !== false) {
      playBeep(payload.type);
    }
  }, []);

  return { toasts, fireNotification, dismissToast };
}

// ── Notification Toast Renderer (standalone component) ─────────────────────
import React from "react";
import { X, TrendingUp, TrendingDown, AlertTriangle, Zap } from "lucide-react";

export const AMEXToastContainer: React.FC<{
  toasts: AMEXToast[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => {
        const isCE   = toast.type === "BUY_CE";
        const isPE   = toast.type === "BUY_PE";
        const isHalt = toast.type === "RISK_HALT";
        const isMicro = toast.type === "MICRO_ALERT" || toast.type === "FORCE_SIGNAL";

        const bg = isCE
          ? "bg-emerald-950/95 border-emerald-500/50"
          : isPE
          ? "bg-rose-950/95 border-rose-500/50"
          : isHalt
          ? "bg-red-950/95 border-red-500/50"
          : "bg-indigo-950/95 border-indigo-500/50";

        const iconColor = isCE ? "text-emerald-400" : isPE ? "text-rose-400" : isHalt ? "text-red-400" : "text-indigo-400";

        const Icon = isCE ? TrendingUp : isPE ? TrendingDown : isHalt ? AlertTriangle : Zap;

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-2xl min-w-[280px] max-w-[360px] animate-[slideInRight_0.3s_ease-out] ${bg}`}
          >
            <div className={`flex-shrink-0 mt-0.5 ${iconColor}`}>
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[11px] font-black tracking-wider uppercase ${iconColor}`}>
                {toast.title}
              </div>
              <div className="text-[10px] text-slate-300 mt-0.5 leading-tight">{toast.message}</div>
              {(toast.strike || toast.entryPrice) && (
                <div className="flex gap-3 mt-1">
                  {toast.strike && (
                    <span className="text-[9px] text-slate-400 font-mono">Strike: <span className="text-white font-bold">{toast.strike}</span></span>
                  )}
                  {toast.entryPrice && (
                    <span className="text-[9px] text-slate-400 font-mono">LTP: <span className="text-white font-bold">₹{toast.entryPrice}</span></span>
                  )}
                  {toast.confidence && (
                    <span className="text-[9px] text-slate-400 font-mono">Conf: <span className={`font-bold ${iconColor}`}>{toast.confidence}%</span></span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
