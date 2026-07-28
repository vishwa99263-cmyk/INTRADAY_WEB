/**
 * PendingTradeApproval.tsx
 * ════════════════════════════════════════════════════════════
 * Shadow-Trade Approval Notification Panel
 *
 * Appears as a floating panel (bottom-right) when the server
 * fires a "pending-trade-approval" or "approval-queue-update"
 * socket event.
 *
 * Each card shows:
 *   - Instrument + Direction + Strategy
 *   - Entry price, Target, SL, Qty
 *   - Confidence bar + Signal grade
 *   - Countdown timer (5 minutes TTL)
 *   - ✅ Approve → real Fyers order
 *   - ❌ Reject  → paper trade only
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  TrendingUp, TrendingDown, Clock, CheckCircle2, XCircle,
  AlertTriangle, Zap, Target, ShieldOff, Shield, ChevronDown,
  ChevronUp, Bell
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingApproval {
  id: string;
  paperId: string;
  instrument: string;         // NIFTY | BANKNIFTY | SENSEX
  direction: string;          // BUY_CE | BUY_PE
  strike: number;
  qty: number;
  entry_price: number;
  target: number;
  stop_loss: number;
  contractSymbol: string;
  strategyName: string;
  confidence: number;
  signalGrade: string;
  createdAt: number;
  expiresAt: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
}

interface Props {
  darkMode?: boolean;
}

const API = (path: string) => {
  const host = (typeof window !== "undefined" &&
    (window.location.protocol === "file:" || window.location.port === "5173"))
    ? "http://localhost:3000"
    : "";
  return `${host}${path}`;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getCountdownPercent(createdAt: number, expiresAt: number): number {
  const total = expiresAt - createdAt;
  const remaining = Math.max(0, expiresAt - Date.now());
  return (remaining / total) * 100;
}

function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A") return "#22c55e";
  if (grade === "B+" || grade === "B") return "#3b82f6";
  if (grade === "C") return "#f59e0b";
  return "#6b7280";
}

function directionLabel(direction: string): { label: string; color: string; icon: "up" | "down" } {
  if (direction === "BUY_CE") return { label: "CALL (CE)", color: "#22c55e", icon: "up" };
  if (direction === "BUY_PE") return { label: "PUT (PE)", color: "#ef4444", icon: "down" };
  return { label: direction, color: "#6b7280", icon: "up" };
}

// ── Approval Card ─────────────────────────────────────────────────────────────

interface CardProps {
  approval: PendingApproval;
  darkMode: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  loading: string | null;
}

const ApprovalCard: React.FC<CardProps> = ({ approval, darkMode, onApprove, onReject, loading }) => {
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const pct = getCountdownPercent(approval.createdAt, approval.expiresAt);
  const countdownStr = formatCountdown(approval.expiresAt);
  const isExpiring = pct < 30;
  const { label: dirLabel, color: dirColor, icon: dirIcon } = directionLabel(approval.direction);
  const isLoading = loading === approval.id;

  const potential = ((approval.target - approval.entry_price) * approval.qty).toFixed(0);
  const riskAmount = ((approval.entry_price - approval.stop_loss) * approval.qty).toFixed(0);

  const cardBg = darkMode
    ? "rgba(15, 23, 42, 0.97)"
    : "rgba(255, 255, 255, 0.98)";
  const borderColor = isExpiring ? "#ef4444" : "#6366f1";
  const textPrimary = darkMode ? "#f1f5f9" : "#0f172a";
  const textSecondary = darkMode ? "#94a3b8" : "#64748b";
  const subtleBg = darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";

  return (
    <div
      style={{
        background: cardBg,
        border: `2px solid ${borderColor}`,
        borderRadius: "16px",
        boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${borderColor}40`,
        overflow: "hidden",
        marginBottom: "12px",
        transition: "all 0.3s ease",
        animation: "slideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: `linear-gradient(135deg, ${dirColor}20 0%, ${borderColor}10 100%)`,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${borderColor}30`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            background: `${dirColor}20`,
            border: `1px solid ${dirColor}60`,
            borderRadius: "8px",
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}>
            {dirIcon === "up"
              ? <TrendingUp size={14} color={dirColor} />
              : <TrendingDown size={14} color={dirColor} />
            }
            <span style={{ color: dirColor, fontWeight: 700, fontSize: "13px", letterSpacing: "0.5px" }}>
              {approval.instrument} {dirLabel}
            </span>
          </div>
          <div style={{
            background: gradeColor(approval.signalGrade) + "25",
            border: `1px solid ${gradeColor(approval.signalGrade)}60`,
            borderRadius: "6px",
            padding: "3px 8px",
            fontSize: "11px",
            fontWeight: 700,
            color: gradeColor(approval.signalGrade),
            letterSpacing: "0.5px",
          }}>
            Grade {approval.signalGrade}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Countdown */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            color: isExpiring ? "#ef4444" : textSecondary,
            fontSize: "12px",
            fontWeight: 600,
            fontFamily: "monospace",
          }}>
            <Clock size={12} />
            {countdownStr}
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: "none", border: "none", cursor: "pointer", color: textSecondary, padding: "4px" }}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Countdown bar */}
      <div style={{ height: "3px", background: subtleBg }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: isExpiring
            ? "linear-gradient(90deg, #ef4444, #fbbf24)"
            : "linear-gradient(90deg, #6366f1, #818cf8)",
          transition: "width 1s linear",
          borderRadius: "0 3px 3px 0",
        }} />
      </div>

      {expanded && (
        <div style={{ padding: "14px 16px" }}>
          {/* Strategy */}
          <div style={{
            fontSize: "11px",
            color: textSecondary,
            marginBottom: "10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}>
            <Zap size={11} />
            <span>{approval.strategyName}</span>
            <span style={{ marginLeft: "auto", color: textSecondary }}>Strike: <strong style={{ color: textPrimary }}>{approval.strike}</strong></span>
          </div>

          {/* Price grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "8px",
            marginBottom: "12px",
          }}>
            {[
              { label: "Entry", value: `₹${approval.entry_price.toFixed(1)}`, color: "#6366f1" },
              { label: "Target", value: `₹${approval.target.toFixed(1)}`, color: "#22c55e" },
              { label: "Stop Loss", value: `₹${approval.stop_loss.toFixed(1)}`, color: "#ef4444" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: subtleBg, borderRadius: "8px", padding: "8px", textAlign: "center" }}>
                <div style={{ fontSize: "10px", color: textSecondary, marginBottom: "3px" }}>{label}</div>
                <div style={{ fontSize: "14px", fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Qty + P&L estimate */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 12px",
            background: subtleBg,
            borderRadius: "8px",
            marginBottom: "12px",
            fontSize: "12px",
          }}>
            <span style={{ color: textSecondary }}>
              Qty: <strong style={{ color: textPrimary }}>{approval.qty}</strong>
            </span>
            <span style={{ color: "#22c55e" }}>
              🎯 Potential: <strong>+₹{potential}</strong>
            </span>
            <span style={{ color: "#ef4444" }}>
              ⚠️ Risk: <strong>-₹{riskAmount}</strong>
            </span>
          </div>

          {/* Confidence bar */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "11px", color: textSecondary }}>AI Confidence</span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: approval.confidence >= 70 ? "#22c55e" : approval.confidence >= 50 ? "#f59e0b" : "#ef4444" }}>
                {approval.confidence.toFixed(0)}%
              </span>
            </div>
            <div style={{ height: "6px", background: subtleBg, borderRadius: "3px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${approval.confidence}%`,
                background: approval.confidence >= 70
                  ? "linear-gradient(90deg, #22c55e, #4ade80)"
                  : approval.confidence >= 50
                  ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                  : "linear-gradient(90deg, #ef4444, #f87171)",
                borderRadius: "3px",
                transition: "width 0.5s ease",
              }} />
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => onApprove(approval.id)}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: "11px",
                background: isLoading ? "#16a34a80" : "linear-gradient(135deg, #16a34a, #22c55e)",
                border: "none",
                borderRadius: "10px",
                color: "white",
                fontWeight: 700,
                fontSize: "13px",
                cursor: isLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                boxShadow: "0 4px 12px rgba(34,197,94,0.35)",
                transition: "all 0.2s ease",
                letterSpacing: "0.3px",
              }}
              onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
            >
              <CheckCircle2 size={15} />
              {isLoading ? "Sending..." : "✅ Approve & Execute"}
            </button>
            <button
              onClick={() => onReject(approval.id)}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: "11px",
                background: isLoading ? "rgba(239,68,68,0.3)" : "linear-gradient(135deg, #dc2626, #ef4444)",
                border: "none",
                borderRadius: "10px",
                color: "white",
                fontWeight: 700,
                fontSize: "13px",
                cursor: isLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                boxShadow: "0 4px 12px rgba(239,68,68,0.3)",
                transition: "all 0.2s ease",
                letterSpacing: "0.3px",
              }}
              onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
            >
              <XCircle size={15} />
              ❌ Reject
            </button>
          </div>

          {/* Paper trade note */}
          <div style={{
            marginTop: "10px",
            textAlign: "center",
            fontSize: "10px",
            color: textSecondary,
          }}>
            <Shield size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />
            Paper trade is already saved — this approval only affects real Fyers execution
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Panel Component ───────────────────────────────────────────────────────

const PendingTradeApproval: React.FC<Props> = ({ darkMode = false }) => {
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [notificationPlayed, setNotificationPlayed] = useState<Set<string>>(new Set());

  // Fetch pending trades on mount + request notification permission
  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await fetch(API("/api/te/pending-trades"));
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.pending)) {
            setPendingApprovals(data.pending.filter((a: PendingApproval) => a.status === "PENDING"));
          }
        }
      } catch (err) {
        console.error("[PendingApproval] Failed to fetch pending trades:", err);
      }
    };
    fetchPending();

    // 🔔 Request OS notification permission so alerts appear even when tab is in background
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().then(perm => {
          console.log("[PendingApproval] Browser notification permission:", perm);
        });
      }
    }
  }, []);

  // Play notification sound for new approvals
  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) { /* silently ignore */ }
  }, []);

  // Handler for socket events — called from parent via ref/prop or directly wired via socket
  const handleQueueUpdate = useCallback((approvals: PendingApproval[]) => {
    const pending = approvals.filter(a => a.status === "PENDING");
    setPendingApprovals(prev => {
      // Check for truly new items
      const prevIds = new Set(prev.map(p => p.id));
      const hasNew = pending.some(a => !prevIds.has(a.id));
      if (hasNew) {
        setMinimized(false);
        playNotificationSound();
      }
      return pending;
    });
  }, [playNotificationSound]);

  // Handler for single new approval pushed by server
  const handleNewApproval = useCallback((approval: PendingApproval) => {
    if (approval.status !== "PENDING") return;
    setPendingApprovals(prev => {
      const exists = prev.find(p => p.id === approval.id);
      if (exists) return prev;
      setMinimized(false);
      if (!notificationPlayed.has(approval.id)) {
        playNotificationSound();
        setNotificationPlayed(s => new Set([...s, approval.id]));
        // Browser notification
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(`🔔 Trade Approval Required — ${approval.instrument}`, {
              body: `${approval.direction.replace("BUY_", "")} @ ₹${approval.entry_price.toFixed(1)} | Confidence: ${approval.confidence.toFixed(0)}%\nApprove within 5 minutes to execute real trade.`,
              icon: "/favicon.ico",
              tag: `approval-${approval.id}`,
            });
          } catch { /* silently ignore */ }
        }
      }
      return [approval, ...prev];
    });
  }, [notificationPlayed, playNotificationSound]);

  // Expose handlers on window so socket hook can call them
  useEffect(() => {
    (window as any).__pendingApprovalHandlers = {
      onApprovalQueueUpdate: handleQueueUpdate,
      onNewPendingApproval: handleNewApproval,
    };
    return () => {
      delete (window as any).__pendingApprovalHandlers;
    };
  }, [handleQueueUpdate, handleNewApproval]);

  const handleApprove = async (id: string) => {
    setLoading(id);
    try {
      const res = await fetch(API(`/api/te/approve-trade/${id}`), { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setPendingApprovals(prev => prev.filter(a => a.id !== id));
      } else {
        alert(`❌ Approval failed: ${data.message}`);
      }
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    setLoading(id);
    try {
      const res = await fetch(API(`/api/te/reject-trade/${id}`), { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setPendingApprovals(prev => prev.filter(a => a.id !== id));
      }
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  if (pendingApprovals.length === 0) return null;

  const panelBg = darkMode ? "rgba(10, 15, 30, 0.95)" : "rgba(248, 250, 255, 0.97)";
  const headerBg = darkMode ? "rgba(99, 102, 241, 0.15)" : "rgba(99, 102, 241, 0.08)";
  const textPrimary = darkMode ? "#f1f5f9" : "#0f172a";
  const textSecondary = darkMode ? "#94a3b8" : "#64748b";

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(60px) scale(0.92); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes pulse-border {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
          50%       { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0); }
        }
        .approval-panel {
          animation: pulse-border 2.5s ease-in-out infinite;
        }
      `}</style>

      <div
        className="approval-panel"
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          width: "380px",
          maxHeight: "85vh",
          overflowY: "auto",
          background: panelBg,
          backdropFilter: "blur(20px)",
          borderRadius: "20px",
          border: "2px solid rgba(99, 102, 241, 0.5)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.2)",
          fontFamily: "'Inter', -apple-system, sans-serif",
          scrollbarWidth: "none",
        }}
      >
        {/* Panel Header */}
        <div
          style={{
            background: headerBg,
            borderBottom: "1px solid rgba(99,102,241,0.2)",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "sticky",
            top: 0,
            zIndex: 10,
            backdropFilter: "blur(20px)",
            borderRadius: "18px 18px 0 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              background: "linear-gradient(135deg, #6366f1, #818cf8)",
              borderRadius: "10px",
              padding: "7px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Bell size={16} color="white" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: textPrimary }}>
                🔔 Trade Approvals
              </div>
              <div style={{ fontSize: "11px", color: textSecondary }}>
                {pendingApprovals.length} awaiting your decision
              </div>
            </div>
          </div>
          <button
            onClick={() => setMinimized(m => !m)}
            style={{
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: "8px",
              padding: "5px 10px",
              cursor: "pointer",
              color: textSecondary,
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {minimized ? "Show" : "Hide"}
          </button>
        </div>

        {/* Cards */}
        {!minimized && (
          <div style={{ padding: "12px" }}>
            {pendingApprovals.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                darkMode={darkMode}
                onApprove={handleApprove}
                onReject={handleReject}
                loading={loading}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default PendingTradeApproval;
