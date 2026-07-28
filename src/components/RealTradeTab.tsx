/**
 * RealTradeTab.tsx
 * ════════════════════════════════════════════════════════════
 * AMEX Real Trade Dashboard
 *
 * Completely separate from paper trades.
 * Shows:
 *  - Fyers account summary (balance, margin, available funds)
 *  - Live Fyers positions (direct from Fyers API)
 *  - Real trades placed via the approval system (with live P&L)
 *  - Pending trade approval cards inline (approve / reject here too)
 *  - Today's real trade summary (trades count, net P&L)
 *  - Approval notification history
 *
 * Paper trades are NOT shown here — fully isolated.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp, TrendingDown, Clock, CheckCircle2, XCircle, RefreshCw,
  AlertTriangle, Zap, Target, Shield, Bell, IndianRupee, BarChart3,
  Wallet, Activity, ChevronDown, ChevronUp, Eye, EyeOff, ArrowUpRight,
  ArrowDownRight, Minus, CircleDot, AlertCircle
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RealTrade {
  id: string;
  paperId: string;
  fyersOrderId?: string;
  instrument: string;
  direction: string;
  strike: number;
  contractSymbol: string;
  qty: number;
  entry_price: number;
  fyers_entry_price?: number;
  exit_price?: number;
  stop_loss: number;
  target: number;
  strategyName: string;
  status: "OPEN" | "CLOSED" | "FAILED";
  pnl?: number;
  live_pnl?: number;
  live_ltp?: number;
  opened_at: number;
  closed_at?: number;
  close_reason?: string;
}

interface PendingApproval {
  id: string;
  paperId: string;
  instrument: string;
  direction: string;
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

interface FyersFund {
  title: string;
  equityAmount: number;
  commodityAmount: number;
}

interface FyersPosition {
  symbol: string;
  side: number;
  qty: number;
  netAvgPrice: number;
  ltp: number;
  pl: number;
  productType: string;
}

interface Props {
  darkMode?: boolean;
  fyersAuthorized?: boolean;
}

// ── API Helper ────────────────────────────────────────────────────────────────

const API = (p: string) => {
  const host = (typeof window !== "undefined" &&
    (window.location.protocol === "file:" || window.location.port === "5173"))
    ? "http://localhost:3000" : "";
  return `${host}${p}`;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, digits = 1): string {
  return n?.toFixed(digits) ?? "—";
}

function fmtINR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function tsToIST(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function dirLabel(direction: string): { text: string; color: string; icon: "up" | "down" } {
  if (direction === "BUY_CE") return { text: "CALL ▲", color: "#22c55e", icon: "up" };
  if (direction === "BUY_PE") return { text: "PUT ▼", color: "#ef4444", icon: "down" };
  return { text: direction, color: "#6b7280", icon: "up" };
}

function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A") return "#22c55e";
  if (grade === "B+" || grade === "B") return "#3b82f6";
  if (grade === "C") return "#f59e0b";
  return "#6b7280";
}

function formatCountdown(expiresAt: number): string {
  const rem = Math.max(0, expiresAt - Date.now());
  const m = Math.floor(rem / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Approval card (inline in Real Trade tab)
const ApprovalCard: React.FC<{
  approval: PendingApproval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  loading: string | null;
  style?: React.CSSProperties;
}> = ({ approval, onApprove, onReject, loading, style }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const pct = Math.max(0, ((approval.expiresAt - Date.now()) / (approval.expiresAt - approval.createdAt)) * 100);
  const isExpiring = pct < 30;
  const { text: dirText, color: dirColor } = dirLabel(approval.direction);
  const isLoading = loading === approval.id;
  const potProfit = ((approval.target - approval.entry_price) * approval.qty).toFixed(0);
  const riskAmt = ((approval.entry_price - approval.stop_loss) * approval.qty).toFixed(0);

  return (
    <div style={{
      border: `2px solid ${isExpiring ? "#ef4444" : "#6366f1"}`,
      borderRadius: "14px",
      overflow: "hidden",
      background: "rgba(99,102,241,0.06)",
      animation: "slideInLeft 0.4s ease",
      ...style,
    }}>
      {/* Countdown bar */}
      <div style={{ height: "4px", background: "rgba(255,255,255,0.1)" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: isExpiring ? "linear-gradient(90deg,#ef4444,#fbbf24)" : "linear-gradient(90deg,#6366f1,#818cf8)",
          transition: "width 1s linear",
        }} />
      </div>

      <div style={{ padding: "14px 16px" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: dirColor, fontWeight: 800, fontSize: "14px" }}>
              {approval.instrument} {dirText}
            </span>
            <span style={{
              background: gradeColor(approval.signalGrade) + "25",
              border: `1px solid ${gradeColor(approval.signalGrade)}60`,
              borderRadius: "5px", padding: "2px 7px",
              fontSize: "10px", fontWeight: 700, color: gradeColor(approval.signalGrade),
            }}>
              Grade {approval.signalGrade}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: isExpiring ? "#ef4444" : "#94a3b8", fontSize: "12px", fontWeight: 700, fontFamily: "monospace" }}>
            <Clock size={11} /> {formatCountdown(approval.expiresAt)}
          </div>
        </div>

        {/* Prices */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", marginBottom: "10px" }}>
          {[
            { l: "Entry", v: `₹${fmt(approval.entry_price)}`, c: "#a5b4fc" },
            { l: "Target", v: `₹${fmt(approval.target)}`, c: "#4ade80" },
            { l: "SL", v: `₹${fmt(approval.stop_loss)}`, c: "#f87171" },
            { l: "Strike", v: String(approval.strike), c: "#94a3b8" },
          ].map(({ l, v, c }) => (
            <div key={l} style={{ background: "rgba(255,255,255,0.05)", borderRadius: "7px", padding: "6px 8px", textAlign: "center" }}>
              <div style={{ fontSize: "9px", color: "#64748b", marginBottom: "2px" }}>{l}</div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Info row */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b", marginBottom: "12px" }}>
          <span>Qty: <b style={{ color: "#e2e8f0" }}>{approval.qty}</b></span>
          <span style={{ color: "#4ade80" }}>🎯 +₹{potProfit}</span>
          <span style={{ color: "#f87171" }}>⚠️ -₹{riskAmt}</span>
          <span>AI: <b style={{ color: approval.confidence >= 70 ? "#4ade80" : "#fbbf24" }}>{approval.confidence.toFixed(0)}%</b></span>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => onApprove(approval.id)}
            disabled={isLoading}
            style={{
              flex: 1, padding: "10px",
              background: isLoading ? "#16a34a60" : "linear-gradient(135deg,#16a34a,#22c55e)",
              border: "none", borderRadius: "9px", color: "white",
              fontWeight: 700, fontSize: "12px", cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
              boxShadow: "0 3px 10px rgba(34,197,94,0.3)", letterSpacing: "0.3px",
            }}
          >
            <CheckCircle2 size={13} />
            {isLoading ? "Executing..." : "✅ APPROVE & EXECUTE"}
          </button>
          <button
            onClick={() => onReject(approval.id)}
            disabled={isLoading}
            style={{
              flex: 0.5, padding: "10px",
              background: "linear-gradient(135deg,#dc2626,#ef4444)",
              border: "none", borderRadius: "9px", color: "white",
              fontWeight: 700, fontSize: "12px", cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
              boxShadow: "0 3px 10px rgba(239,68,68,0.25)",
            }}
          >
            <XCircle size={13} />
            Reject
          </button>
        </div>

        <div style={{ marginTop: "8px", textAlign: "center", fontSize: "10px", color: "#475569" }}>
          <Shield size={9} style={{ display: "inline", verticalAlign: "middle", marginRight: "3px" }} />
          Paper trade already saved — this only executes real Fyers order
        </div>
      </div>
    </div>
  );
};

// Real trade row
const TradeRow: React.FC<{
  trade: RealTrade;
  onClose: (id: string, ltp: number) => void;
  loadingClose: string | null;
}> = ({ trade, onClose, loadingClose }) => {
  const { text: dirText, color: dirColor } = dirLabel(trade.direction);
  const isOpen = trade.status === "OPEN";
  const pnl = isOpen ? (trade.live_pnl ?? 0) : (trade.pnl ?? 0);
  const pnlColor = pnl > 0 ? "#22c55e" : pnl < 0 ? "#ef4444" : "#94a3b8";
  const ltp = trade.live_ltp ?? trade.entry_price;
  const pnlPct = trade.entry_price > 0 ? ((ltp - trade.entry_price) / trade.entry_price * 100) : 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "120px 100px 70px 80px 80px 80px 90px 90px 100px auto",
      gap: "0",
      alignItems: "center",
      padding: "10px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      transition: "background 0.2s",
    }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
    >
      {/* Instrument + direction */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div style={{
          width: "3px", height: "32px", borderRadius: "2px",
          background: isOpen ? "#6366f1" : trade.status === "FAILED" ? "#ef4444" : "#22c55e",
        }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: "12px", color: "#e2e8f0" }}>{trade.instrument}</div>
          <div style={{ fontSize: "10px", color: dirColor, fontWeight: 600 }}>{dirText}</div>
        </div>
      </div>

      {/* Strategy */}
      <div style={{ fontSize: "10px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {trade.strategyName}
      </div>

      {/* Strike */}
      <div style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>{trade.strike}</div>

      {/* Entry */}
      <div style={{ fontSize: "12px", color: "#a5b4fc", fontWeight: 700 }}>₹{fmt(trade.entry_price)}</div>

      {/* LTP */}
      <div style={{ fontSize: "12px", color: isOpen ? "#e2e8f0" : "#64748b", fontWeight: isOpen ? 700 : 400 }}>
        {isOpen ? `₹${fmt(ltp)}` : (trade.exit_price ? `₹${fmt(trade.exit_price)}` : "—")}
      </div>

      {/* Target */}
      <div style={{ fontSize: "11px", color: "#4ade80" }}>₹{fmt(trade.target)}</div>

      {/* SL */}
      <div style={{ fontSize: "11px", color: "#f87171" }}>₹{fmt(trade.stop_loss)}</div>

      {/* P&L */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <div style={{ fontSize: "13px", fontWeight: 800, color: pnlColor }}>
          {pnl >= 0 ? "+" : ""}₹{Math.abs(pnl).toFixed(0)}
        </div>
        <div style={{ fontSize: "9px", color: pnlColor, opacity: 0.8 }}>
          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
        </div>
      </div>

      {/* Status + time */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{
          fontSize: "9px", fontWeight: 700, letterSpacing: "0.5px",
          padding: "2px 6px", borderRadius: "4px", display: "inline-block",
          background: isOpen ? "rgba(99,102,241,0.2)" : trade.status === "FAILED" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
          color: isOpen ? "#818cf8" : trade.status === "FAILED" ? "#f87171" : "#4ade80",
        }}>
          {trade.status}
        </span>
        {trade.status === "FAILED" && trade.notes && (
          <span style={{ fontSize: "8.5px", color: "#f87171", marginTop: "2px", maxWidth: "120px", display: "block", wordBreak: "break-word" }}>
            Rejection: {trade.notes}
          </span>
        )}
        <span style={{ fontSize: "9px", color: "#475569" }}>{tsToIST(trade.opened_at)}</span>
      </div>

      {/* Action */}
      <div style={{ textAlign: "right" }}>
        {isOpen && (
          <button
            onClick={() => onClose(trade.id, ltp)}
            disabled={loadingClose === trade.id}
            style={{
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "6px", padding: "4px 10px",
              color: "#f87171", fontSize: "10px", fontWeight: 600, cursor: "pointer",
            }}
          >
            {loadingClose === trade.id ? "..." : "Close"}
          </button>
        )}
        {trade.fyersOrderId && (
          <div style={{ fontSize: "9px", color: "#334155", marginTop: "2px" }}>#{trade.fyersOrderId.slice(-6)}</div>
        )}
      </div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────

const RealTradeTab: React.FC<Props> = ({ darkMode = true, fyersAuthorized = false }) => {
  const [trades, setTrades] = useState<RealTrade[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [funds, setFunds] = useState<FyersFund[] | null>(null);
  const [positions, setPositions] = useState<FyersPosition[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [tradebook, setTradebook] = useState<any[]>([]);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [holdingsOverall, setHoldingsOverall] = useState<any>(null);
  const [showHoldings, setShowHoldings] = useState(false);
  const [todayPnl, setTodayPnl] = useState(0);
  const [livePnl, setLivePnl] = useState(0);
  const [loadingFunds, setLoadingFunds] = useState(false);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState<string | null>(null);
  const [closeLoading, setCloseLoading] = useState<string | null>(null);
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [showPositions, setShowPositions] = useState(true);
  const [showOrders, setShowOrders] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"ALL" | "OPEN" | "CLOSED">("ALL");
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch(API("/api/real-trades"));
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setTrades(data.trades || []);
          setTodayPnl(data.todayPnl || 0);
          setLivePnl(data.livePnl || 0);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch(API("/api/te/pending-trades"));
      if (res.ok) {
        const data = await res.json();
        if (data.success) setPendingApprovals(data.pending || []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchFunds = useCallback(async () => {
    if (!fyersAuthorized) return;
    setLoadingFunds(true);
    try {
      const res = await fetch(API("/api/fyers/funds"));
      if (res.ok) {
        const data = await res.json();
        if (data.success) setFunds(Array.isArray(data.funds) ? data.funds : [data.funds]);
      }
    } catch { /* ignore */ }
    setLoadingFunds(false);
  }, [fyersAuthorized]);

  const fetchPositions = useCallback(async () => {
    if (!fyersAuthorized) return;
    setLoadingPositions(true);
    try {
      const res = await fetch(API("/api/fyers/positions"));
      if (res.ok) {
        const data = await res.json();
        if (data.success) setPositions(data.positions || []);
      }
    } catch { /* ignore */ }
    setLoadingPositions(false);
  }, [fyersAuthorized]);

  const fetchOrders = useCallback(async () => {
    if (!fyersAuthorized) return;
    try {
      const res = await fetch(API("/api/fyers/orders"));
      if (res.ok) {
        const data = await res.json();
        if (data.success) setOrders(data.orders || []);
      }
    } catch { /* ignore */ }
  }, [fyersAuthorized]);

  const fetchTradebook = useCallback(async () => {
    if (!fyersAuthorized) return;
    try {
      const res = await fetch(API("/api/fyers/tradebook"));
      if (res.ok) {
        const data = await res.json();
        if (data.success) setTradebook(data.trades || []);
      }
    } catch { /* ignore */ }
  }, [fyersAuthorized]);

  const fetchHoldings = useCallback(async () => {
    if (!fyersAuthorized) return;
    try {
      const res = await fetch(API("/api/fyers/holdings"));
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setHoldings(data.holdings || []);
          setHoldingsOverall(data.overall || null);
        }
      }
    } catch { /* ignore */ }
  }, [fyersAuthorized]);

  const fetchAll = useCallback(() => {
    fetchTrades();
    fetchPending();
    fetchFunds();
    fetchPositions();
    fetchOrders();
    fetchTradebook();
    fetchHoldings();
    setLastRefresh(Date.now());
  }, [fetchTrades, fetchPending, fetchFunds, fetchPositions, fetchOrders, fetchTradebook, fetchHoldings]);

  // Initial load + auto-refresh every 5s
  useEffect(() => {
    fetchAll();
    refreshTimerRef.current = setInterval(fetchAll, 5000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [fetchAll]);

  // Socket bridge handlers
  useEffect(() => {
    (window as any).__realTradeHandlers = {
      onRealTradeUpdate: (data: any) => {
        if (data?.trades) setTrades(data.trades);
        if (data?.todayPnl !== undefined) setTodayPnl(data.todayPnl);
        if (data?.livePnl !== undefined) setLivePnl(data.livePnl);
      }
    };
    // Also hook into approval handlers so we update pending list
    const existingApprovalHandlers = (window as any).__pendingApprovalHandlers || {};
    const origOnQueueUpdate = existingApprovalHandlers.onApprovalQueueUpdate;
    (window as any).__pendingApprovalHandlers = {
      ...existingApprovalHandlers,
      onApprovalQueueUpdate: (approvals: PendingApproval[]) => {
        setPendingApprovals(approvals.filter(a => a.status === "PENDING"));
        if (origOnQueueUpdate) origOnQueueUpdate(approvals);
      },
      onNewPendingApproval: (approval: PendingApproval) => {
        if (approval.status === "PENDING") {
          setPendingApprovals(prev => {
            if (prev.find(p => p.id === approval.id)) return prev;
            return [approval, ...prev];
          });
        }
        if (existingApprovalHandlers.onNewPendingApproval) {
          existingApprovalHandlers.onNewPendingApproval(approval);
        }
      },
    };
    return () => { delete (window as any).__realTradeHandlers; };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleApprove = async (id: string) => {
    setApprovalLoading(id);
    try {
      const res = await fetch(API(`/api/te/approve-trade/${id}`), { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setPendingApprovals(prev => prev.filter(a => a.id !== id));
        await fetchTrades();
      } else {
        alert(`Approval failed: ${data.message}`);
      }
    } catch (err: any) { alert(`Error: ${err.message}`); }
    setApprovalLoading(null);
  };

  const handleReject = async (id: string) => {
    setApprovalLoading(id);
    try {
      const res = await fetch(API(`/api/te/reject-trade/${id}`), { method: "POST" });
      const data = await res.json();
      if (data.success) setPendingApprovals(prev => prev.filter(a => a.id !== id));
    } catch (err: any) { alert(`Error: ${err.message}`); }
    setApprovalLoading(null);
  };

  const handleClose = async (id: string, exitPrice: number) => {
    setCloseLoading(id);
    try {
      const res = await fetch(API(`/api/real-trades/close/${id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exit_price: exitPrice, reason: "MANUAL" }),
      });
      const data = await res.json();
      if (data.success) await fetchTrades();
    } catch (err: any) { alert(`Error: ${err.message}`); }
    setCloseLoading(null);
  };

  const handleExitAllPositions = async () => {
    if (!window.confirm("⚠️ Exit ALL open Fyers positions at market? This cannot be undone.")) return;
    try {
      const res = await fetch(API("/api/fyers/exit-positions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productType: "INTRADAY" }),
      });
      const data = await res.json();
      if (data.success) {
        alert("✅ Exit all positions request sent to Fyers.");
        setTimeout(fetchAll, 1500);
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  const [testScalpLoading, setTestScalpLoading] = useState(false);
  const handleTestScalp = async () => {
    if (testScalpLoading) return;
    setTestScalpLoading(true);
    try {
      const res = await fetch(API("/api/te/test-scalp"), { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Test scalp order sent:\n${data.message}`);
        setTimeout(fetchAll, 1000);
      } else {
        alert(`❌ Test scalp failed:\n${data.error || data.message}`);
      }
    } catch (e: any) {
      alert(`❌ Test scalp error: ${e.message}`);
    } finally {
      setTestScalpLoading(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      const res = await fetch(API(`/api/fyers/orders/${orderId}`), { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Order ${orderId} cancelled.`);
        fetchOrders();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (err: any) { alert(`Error: ${err.message}`); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const todayTrades = trades.filter(t => {
    const tradeDate = new Date(t.opened_at + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    return tradeDate === today;
  });
  const openCount = trades.filter(t => t.status === "OPEN").length;
  const closedToday = todayTrades.filter(t => t.status === "CLOSED").length;
  const failedToday = todayTrades.filter(t => t.status === "FAILED").length;
  const totalRealPnl = todayPnl + livePnl;

  const filteredTrades = trades.filter(t => {
    if (activeFilter === "OPEN") return t.status === "OPEN";
    if (activeFilter === "CLOSED") return t.status === "CLOSED" || t.status === "FAILED";
    return true;
  }).slice(0, showAllTrades ? undefined : 20);

  // Available margin from funds
  const availableMargin = Array.isArray(funds)
    ? funds.find(f => f && typeof f.title === "string" && f.title.toLowerCase().includes("available"))?.equityAmount ?? 0
    : 0;
  const usedMargin = Array.isArray(funds)
    ? funds.find(f => f && typeof f.title === "string" && f.title.toLowerCase().includes("utilized"))?.equityAmount ?? 0
    : 0;
  const totalFunds = Array.isArray(funds)
    ? funds.find(f => f && typeof f.title === "string" && f.title.toLowerCase().includes("total"))?.equityAmount ?? 0
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────────

  const bg = "#070d1b";
  const surf = "#0d1424";
  const surf2 = "#111827";
  const border = "rgba(255,255,255,0.07)";
  const textPri = "#e2e8f0";
  const textSec = "#64748b";
  const textMut = "#334155";
  const accent = "#6366f1";

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
      background: bg, color: textPri,
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <style>{`
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes pulseBorder {
          0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.4); }
          50%      { box-shadow: 0 0 0 6px rgba(99,102,241,0); }
        }
        .rt-hover-row:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px",
        background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.04) 100%)",
        borderBottom: `1px solid ${border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            background: "linear-gradient(135deg, #6366f1, #818cf8)",
            borderRadius: "10px", padding: "8px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Activity size={18} color="white" />
          </div>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 800, color: textPri, letterSpacing: "0.5px" }}>
              REAL TRADE CENTER
            </div>
            <div style={{ fontSize: "11px", color: textSec }}>
              Fyers Live Execution • Paper trades are completely separate
            </div>
          </div>
          {!fyersAuthorized && (
            <div style={{
              background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: "8px", padding: "5px 12px",
              display: "flex", alignItems: "center", gap: "6px",
              fontSize: "11px", color: "#fbbf24", fontWeight: 600,
            }}>
              <AlertCircle size={12} /> Not authenticated — connect Fyers first
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ fontSize: "10px", color: textMut, fontFamily: "monospace" }}>
            Refreshed: {new Date(lastRefresh).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
          </div>
          <button
            onClick={handleTestScalp}
            disabled={testScalpLoading}
            style={{
              background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: "8px", padding: "7px 14px",
              color: "#fbbf24", fontWeight: 600, fontSize: "12px", cursor: testScalpLoading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <Activity size={13} /> {testScalpLoading ? "Scalping..." : "Test Scalp"}
          </button>
          <button
            onClick={fetchAll}
            style={{
              background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: "8px", padding: "7px 14px",
              color: "#818cf8", fontWeight: 600, fontSize: "12px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Main content with scroll ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", scrollbarWidth: "none" }}>

        {/* ── Pending Approvals section ── */}
        {pendingApprovals.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: "10px",
              marginBottom: "12px",
            }}>
              <div style={{
                background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)",
                borderRadius: "8px", padding: "5px 12px",
                fontSize: "12px", fontWeight: 800, color: "#818cf8",
                display: "flex", alignItems: "center", gap: "6px",
                animation: "pulseBorder 2s ease-in-out infinite",
              }}>
                <Bell size={13} /> {pendingApprovals.length} TRADE{pendingApprovals.length > 1 ? "S" : ""} AWAITING APPROVAL
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "12px" }}>
              {pendingApprovals.map(a => (
                <ApprovalCard
                  key={a.id}
                  approval={a}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  loading={approvalLoading}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Stats row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px", marginBottom: "20px" }}>
          {[
            {
              label: "Today's Net P&L",
              value: fmtINR(totalRealPnl),
              sub: `${closedToday} closed + ${openCount} open`,
              color: totalRealPnl >= 0 ? "#22c55e" : "#ef4444",
              icon: <IndianRupee size={16} />,
              bg: totalRealPnl >= 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            },
            {
              label: "Realized P&L",
              value: fmtINR(todayPnl),
              sub: `${closedToday} trades closed today`,
              color: todayPnl >= 0 ? "#22c55e" : "#ef4444",
              icon: <CheckCircle2 size={16} />,
              bg: "rgba(255,255,255,0.04)",
            },
            {
              label: "Live Unrealized",
              value: fmtINR(livePnl),
              sub: `${openCount} positions open`,
              color: livePnl >= 0 ? "#4ade80" : "#f87171",
              icon: <Activity size={16} />,
              bg: "rgba(255,255,255,0.04)",
            },
            {
              label: "Available Margin",
              value: fmtINR(availableMargin),
              sub: `Total: ${fmtINR(totalFunds)}`,
              color: "#818cf8",
              icon: <Wallet size={16} />,
              bg: "rgba(99,102,241,0.08)",
            },
            {
              label: "Pending Approvals",
              value: String(pendingApprovals.length),
              sub: "Awaiting your decision",
              color: pendingApprovals.length > 0 ? "#fbbf24" : "#4ade80",
              icon: <Bell size={16} />,
              bg: pendingApprovals.length > 0 ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.04)",
            },
            {
              label: "Failed Orders",
              value: String(failedToday),
              sub: "Fyers execution failures",
              color: failedToday > 0 ? "#ef4444" : "#4ade80",
              icon: <AlertTriangle size={16} />,
              bg: "rgba(255,255,255,0.04)",
            },
          ].map(({ label, value, sub, color, icon, bg: cardBg }) => (
            <div key={label} style={{
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: "12px",
              padding: "14px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ fontSize: "10px", color: textSec, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
                <div style={{ color, opacity: 0.7 }}>{icon}</div>
              </div>
              <div style={{ fontSize: "22px", fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: "10px", color: textMut, marginTop: "4px" }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Fyers Funds ── */}
        {fyersAuthorized && Array.isArray(funds) && funds.length > 0 && (() => {
          const getAmt = (keyword: string) =>
            funds.find(f => f && typeof f.title === "string" && f.title.toLowerCase().includes(keyword.toLowerCase()))?.equityAmount ?? 0;
          const available   = getAmt("available balance");
          const total       = getAmt("total balance");
          const utilized    = getAmt("utilized");
          const pnl         = getAmt("realized profit");
          const startOfDay  = getAmt("limit at start");

          return (
            <div style={{ background: surf, border: `1px solid ${border}`, borderRadius: "12px", marginBottom: "16px", overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: "8px" }}>
                <Wallet size={14} color="#818cf8" />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#818cf8", letterSpacing: "0.5px" }}>FYERS ACCOUNT BALANCE</span>
                <span style={{ marginLeft: "auto", fontSize: "10px", color: textMut }}>Live • FAJ97931</span>
              </div>

              {/* 4 Key Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0" }}>
                {[
                  { label: "Available", value: available, color: "#22c55e", bg: "rgba(34,197,94,0.08)" },
                  { label: "Total Balance", value: total, color: "#818cf8", bg: "rgba(129,140,248,0.08)" },
                  { label: "Utilized", value: utilized, color: utilized > 0 ? "#f59e0b" : textSec, bg: "rgba(245,158,11,0.06)" },
                  { label: "Today P&L", value: pnl, color: pnl >= 0 ? "#22c55e" : "#ef4444", bg: pnl >= 0 ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)" },
                ].map((item, i) => (
                  <div key={i} style={{
                    padding: "14px 16px",
                    borderRight: i < 3 ? `1px solid ${border}` : "none",
                    background: item.bg,
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: "9px", color: textSec, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.8px" }}>{item.label}</div>
                    <div style={{ fontSize: "15px", fontWeight: 800, color: item.color, fontVariantNumeric: "tabular-nums" }}>
                      ₹{Math.abs(item.value).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                    {item.label === "Today P&L" && (
                      <div style={{ fontSize: "9px", color: item.color, marginTop: "2px" }}>{pnl >= 0 ? "▲ Profit" : "▼ Loss"}</div>
                    )}
                    {item.label === "Available" && (
                      <div style={{ fontSize: "9px", color: textSec, marginTop: "2px" }}>Start: ₹{startOfDay.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* All fields detail */}
              <div style={{ borderTop: `1px solid ${border}`, padding: "8px 16px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                  {funds.map((f, i) => f && f.title ? (
                    <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "10px" }}>
                      <span style={{ color: textSec }}>{f.title}:</span>
                      <span style={{
                        color: (f.equityAmount || 0) > 0 ? "#e2e8f0" : (f.equityAmount || 0) < 0 ? "#ef4444" : textSec,
                        fontWeight: 600,
                      }}>₹{(f.equityAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  ) : null)}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Fyers Positions ── */}
        {fyersAuthorized && (
          <div style={{
            background: surf, border: `1px solid ${border}`,
            borderRadius: "12px", marginBottom: "16px", overflow: "hidden",
          }}>
            <button
              onClick={() => setShowPositions(p => !p)}
              style={{
                width: "100%", padding: "12px 16px",
                borderBottom: showPositions ? `1px solid ${border}` : "none",
                display: "flex", alignItems: "center", gap: "8px",
                background: "none", border: "none", cursor: "pointer", color: textPri, textAlign: "left",
              }}
            >
              <BarChart3 size={14} color="#22c55e" />
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#22c55e", letterSpacing: "0.5px" }}>FYERS POSITIONS ({positions.length})</span>
              <span style={{ marginLeft: "auto", color: textSec }}>{showPositions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
              {positions.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleExitAllPositions(); }}
                  style={{
                    marginLeft: "8px", padding: "3px 10px",
                    background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.5)",
                    borderRadius: "6px", color: "#f87171", fontSize: "10px", fontWeight: 700,
                    cursor: "pointer",
                  }}
                  title="Exit all open Fyers positions at market"
                >
                  🚨 EXIT ALL
                </button>
              )}
            </button>

            {showPositions && (
              positions.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center", color: textSec, fontSize: "12px" }}>
                  {loadingPositions ? "Loading positions..." : "No open positions in Fyers"}
                </div>
              ) : (
                <div>
                  {/* Header */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 80px 80px 90px 80px 100px 90px",
                    padding: "8px 16px",
                    fontSize: "9px", fontWeight: 700, color: textSec,
                    letterSpacing: "0.8px", textTransform: "uppercase",
                    borderBottom: `1px solid ${border}`,
                  }}>
                    <span>Symbol</span><span>Side</span><span>Qty</span>
                    <span>Avg Price</span><span>LTP</span><span>P&L</span><span>Type</span>
                  </div>
                  {positions.map((pos, i) => (
                    <div key={i} style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 80px 80px 90px 80px 100px 90px",
                      padding: "10px 16px",
                      borderBottom: `1px solid ${border}`,
                      fontSize: "12px",
                    }}>
                      <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "11px" }}>{pos.symbol}</span>
                      <span style={{ color: pos.side === 1 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                        {pos.side === 1 ? "BUY" : "SELL"}
                      </span>
                      <span style={{ color: textPri }}>{pos.qty}</span>
                      <span style={{ color: "#a5b4fc" }}>₹{fmt(pos.netAvgPrice)}</span>
                      <span style={{ color: textPri }}>₹{fmt(pos.ltp)}</span>
                      <span style={{ color: pos.pl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                        {pos.pl >= 0 ? "+" : ""}₹{pos.pl.toFixed(0)}
                      </span>
                      <span style={{ color: textSec, fontSize: "10px" }}>{pos.productType}</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* ── Real Trades Table ── */}
        <div style={{
          background: surf, border: `1px solid ${border}`,
          borderRadius: "12px", overflow: "hidden",
        }}>
          {/* Table header */}
          <div style={{
            padding: "12px 16px", borderBottom: `1px solid ${border}`,
            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Activity size={14} color={accent} />
              <span style={{ fontSize: "12px", fontWeight: 700, color: accent, letterSpacing: "0.5px" }}>
                REAL TRADES ({trades.length})
              </span>
            </div>
            <div style={{ display: "flex", gap: "6px", marginLeft: "12px" }}>
              {(["ALL", "OPEN", "CLOSED"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  style={{
                    padding: "3px 10px", borderRadius: "6px", fontSize: "10px",
                    fontWeight: activeFilter === f ? 700 : 400,
                    cursor: "pointer",
                    background: activeFilter === f ? `${accent}25` : "transparent",
                    border: `1px solid ${activeFilter === f ? accent : border}`,
                    color: activeFilter === f ? "#818cf8" : textSec,
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", fontSize: "10px", color: textMut }}>
              Showing {filteredTrades.length} of {trades.length} trades
            </div>
          </div>

          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "120px 100px 70px 80px 80px 80px 90px 90px 100px auto",
            padding: "8px 16px",
            fontSize: "9px", fontWeight: 700, color: textSec,
            letterSpacing: "0.8px", textTransform: "uppercase",
            borderBottom: `1px solid ${border}`,
            background: "rgba(255,255,255,0.02)",
          }}>
            <span>Instrument</span><span>Strategy</span><span>Strike</span>
            <span>Entry</span><span>LTP/Exit</span><span>Target</span>
            <span>Stop Loss</span><span>P&L</span><span>Status</span><span>Action</span>
          </div>

          {/* Trade rows */}
          {filteredTrades.length === 0 ? (
            <div style={{
              padding: "40px 20px", textAlign: "center", color: textSec,
              display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
            }}>
              <Activity size={32} color={textMut} />
              <div style={{ fontSize: "14px", fontWeight: 600 }}>No real trades yet</div>
              <div style={{ fontSize: "12px", color: textMut }}>
                Paper trades are placed automatically. Approve the notifications above to execute real trades.
              </div>
            </div>
          ) : (
            filteredTrades.map(trade => (
              <TradeRow
                key={trade.id}
                trade={trade}
                onClose={handleClose}
                loadingClose={closeLoading}
              />
            ))
          )}

          {/* Show more */}
          {trades.length > 20 && (
            <div style={{ padding: "12px", textAlign: "center" }}>
              <button
                onClick={() => setShowAllTrades(s => !s)}
                style={{
                  background: "rgba(99,102,241,0.1)", border: `1px solid rgba(99,102,241,0.3)`,
                  borderRadius: "8px", padding: "7px 20px",
                  color: "#818cf8", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                }}
              >
                {showAllTrades ? "Show Less" : `Show All ${trades.length} Trades`}
              </button>
            </div>
          )}
        </div>

        {/* ── Fyers Orders history ── */}
        {fyersAuthorized && orders.length > 0 && (
          <div style={{
            background: surf, border: `1px solid ${border}`,
            borderRadius: "12px", marginTop: "16px", overflow: "hidden",
          }}>
            <button
              onClick={() => setShowOrders(o => !o)}
              style={{
                width: "100%", padding: "12px 16px",
                borderBottom: showOrders ? `1px solid ${border}` : "none",
                display: "flex", alignItems: "center", gap: "8px",
                background: "none", border: "none", cursor: "pointer", color: textPri, textAlign: "left",
              }}
            >
              <CircleDot size={14} color="#f59e0b" />
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#f59e0b", letterSpacing: "0.5px" }}>
                TODAY'S FYERS ORDERS ({orders.length})
              </span>
              <span style={{ marginLeft: "auto", color: textSec }}>{showOrders ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
            </button>
            {showOrders && (
              <div>
                <div style={{
                  display: "grid", gridTemplateColumns: "2fr 80px 80px 80px 80px 80px 80px",
                  padding: "8px 16px", fontSize: "9px", fontWeight: 700, color: textSec,
                  letterSpacing: "0.8px", textTransform: "uppercase", borderBottom: `1px solid ${border}`,
                }}>
                  <span>Symbol</span><span>Side</span><span>Qty</span><span>Type</span>
                  <span>Price</span><span>Status</span><span>Order ID</span>
                </div>
                {orders.slice(0, 30).map((o, i) => (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "2fr 80px 80px 80px 80px 80px 80px",
                    padding: "9px 16px", borderBottom: `1px solid ${border}`,
                    fontSize: "11px",
                  }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{o.symbol || "—"}</span>
                    <span style={{ color: o.side === 1 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{o.side === 1 ? "BUY" : "SELL"}</span>
                    <span style={{ color: textPri }}>{o.qty}</span>
                    <span style={{ color: textSec, fontSize: "10px" }}>{o.type === 1 ? "LIMIT" : o.type === 2 ? "MARKET" : String(o.type)}</span>
                    <span style={{ color: "#a5b4fc" }}>₹{fmt(o.limitPrice ?? o.tradedPrice ?? 0)}</span>
                    <span style={{ color: o.status === 2 ? "#22c55e" : o.status === 5 ? "#ef4444" : "#f59e0b", fontSize: "10px" }}>
                      {o.status === 2 ? "FILLED" : o.status === 5 ? "REJECTED" : o.status === 1 ? "PENDING" : String(o.status)}
                    </span>
                    <span style={{ color: textMut, fontSize: "9px", fontFamily: "monospace" }}>{String(o.id || "").slice(-8)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Fyers Holdings ── */}
        {fyersAuthorized && (
          <div style={{ background: surf, border: `1px solid ${border}`, borderRadius: "12px", marginBottom: "16px", overflow: "hidden" }}>
            <button
              onClick={() => { setShowHoldings(p => !p); if (!showHoldings) fetchHoldings(); }}
              style={{
                width: "100%", padding: "12px 16px",
                borderBottom: showHoldings ? `1px solid ${border}` : "none",
                display: "flex", alignItems: "center", gap: "8px",
                background: "none", border: "none", cursor: "pointer", color: textPri, textAlign: "left",
              }}
            >
              <TrendingUp size={14} color="#06b6d4" />
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#06b6d4", letterSpacing: "0.5px" }}>
                HOLDINGS ({holdings.length})
              </span>
              {holdingsOverall && (
                <span style={{
                  marginLeft: "8px", fontSize: "11px", fontWeight: 700,
                  color: holdingsOverall.total_pl >= 0 ? "#22c55e" : "#ef4444",
                }}>
                  {holdingsOverall.total_pl >= 0 ? "▲" : "▼"} ₹{Math.abs(holdingsOverall.total_pl || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  &nbsp;({(holdingsOverall.pnl_perc || 0).toFixed(2)}%)
                </span>
              )}
              <span style={{ marginLeft: "auto", color: textSec }}>{showHoldings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
            </button>

            {showHoldings && (
              <div>
                {/* Overall Summary */}
                {holdingsOverall && (
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
                    borderBottom: `1px solid ${border}`,
                  }}>
                    {[
                      { label: "Invested", val: `₹${(holdingsOverall.total_investment || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: textSec },
                      { label: "Current Value", val: `₹${(holdingsOverall.total_current_value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "#e2e8f0" },
                      { label: "Total P&L", val: `₹${Math.abs(holdingsOverall.total_pl || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: holdingsOverall.total_pl >= 0 ? "#22c55e" : "#ef4444" },
                      { label: "P&L %", val: `${(holdingsOverall.pnl_perc || 0).toFixed(2)}%`, color: holdingsOverall.pnl_perc >= 0 ? "#22c55e" : "#ef4444" },
                    ].map((item, i) => (
                      <div key={i} style={{
                        padding: "10px 16px", textAlign: "center",
                        borderRight: i < 3 ? `1px solid ${border}` : "none",
                        background: i === 2 ? (holdingsOverall.total_pl >= 0 ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)") : "transparent",
                      }}>
                        <div style={{ fontSize: "9px", color: textSec, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.8px" }}>{item.label}</div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: item.color }}>{item.val}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Per-stock rows */}
                {holdings.length === 0 ? (
                  <div style={{ padding: "20px", textAlign: "center", color: textSec, fontSize: "12px" }}>No holdings found</div>
                ) : (
                  <div>
                    {/* Header */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "2.5fr 70px 70px 90px 90px 90px 80px",
                      padding: "8px 16px", fontSize: "9px", fontWeight: 700, color: textSec,
                      letterSpacing: "0.8px", textTransform: "uppercase", borderBottom: `1px solid ${border}`,
                    }}>
                      <span>Symbol</span><span>Qty</span><span>T+1</span>
                      <span>Cost Price</span><span>LTP</span><span>Mkt Value</span><span>P&L</span>
                    </div>
                    {holdings.map((h, i) => {
                      const plColor = h.pl > 0 ? "#22c55e" : h.pl < 0 ? "#ef4444" : textSec;
                      const plPct = h.costPrice > 0 ? ((h.ltp - h.costPrice) / h.costPrice * 100) : 0;
                      return (
                        <div key={i} style={{
                          display: "grid",
                          gridTemplateColumns: "2.5fr 70px 70px 90px 90px 90px 80px",
                          padding: "10px 16px", borderBottom: `1px solid ${border}`, fontSize: "11px",
                          background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        }}>
                          <div>
                            <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "11px" }}>
                              {h.symbol?.replace("NSE:", "").replace("-EQ", "") || "—"}
                            </div>
                            <div style={{ color: textMut, fontSize: "9px" }}>{h.isin || ""}</div>
                          </div>
                          <span style={{ color: textPri }}>{h.quantity ?? h.remainingQuantity ?? 0}</span>
                          <span style={{ color: h.qty_t1 > 0 ? "#f59e0b" : textSec }}>{h.qty_t1 ?? 0}</span>
                          <span style={{ color: textSec }}>₹{fmt(h.costPrice ?? 0)}</span>
                          <span style={{ color: "#a5b4fc", fontWeight: 600 }}>₹{fmt(h.ltp ?? 0)}</span>
                          <span style={{ color: textPri }}>₹{(h.marketVal || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                          <div>
                            <div style={{ color: plColor, fontWeight: 700 }}>
                              {h.pl >= 0 ? "+" : ""}₹{Math.abs(h.pl || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            </div>
                            <div style={{ color: plColor, fontSize: "9px" }}>
                              {plPct >= 0 ? "+" : ""}{plPct.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ height: "20px" }} />
      </div>
    </div>
  );
};

export default RealTradeTab;
