/**
 * TradeAlarmPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Floating trade monitor widget — always visible in bottom-right corner
 *
 * Shows:
 *  - Active trade with LIVE P&L ticker
 *  - Entry / SL / Target with color-coded progress bars
 *  - WHY this trade was taken (stock analysis breakdown)
 *  - Daily P&L progress toward ₹1K–₹5K target
 *  - Alarm history (last 10 alarms)
 *  - Collapsible / expandable
 */

import React, { useState, useEffect, useRef } from "react";
import type { TradeAlarmPayload } from "../hooks/useTradeAlarm";

// ── Sub-components ─────────────────────────────────────────────────────────────

function PnlBar({ value, target }: { value: number; target: number }) {
  const pct = Math.min(100, Math.max(0, (value / target) * 100));
  const color = value < 0 ? "#ef4444" : value >= target ? "#22c55e" : "#f59e0b";
  return (
    <div style={{ width: "100%", height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%",
        background: color,
        transition: "width 0.5s ease",
        borderRadius: 3,
      }} />
    </div>
  );
}

function AlarmBadge({ type }: { type: string }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    ENTRY:         { bg: "#16a34a22", text: "#4ade80", label: "ENTRY" },
    TARGET_HIT:    { bg: "#16a34a33", text: "#22c55e", label: "✅ TARGET" },
    EXIT_PROFIT:   { bg: "#16a34a22", text: "#4ade80", label: "✅ PROFIT" },
    SL_HIT:        { bg: "#dc262622", text: "#f87171", label: "❌ SL HIT" },
    EXIT_LOSS:     { bg: "#dc262622", text: "#f87171", label: "❌ LOSS" },
    SL_TRAIL:      { bg: "#0ea5e922", text: "#38bdf8", label: "🔒 SL TRAIL" },
    SL_BREAKEVEN:  { bg: "#0ea5e922", text: "#38bdf8", label: "🔒 BREAKEVEN" },
    FORCE_EXIT:    { bg: "#f59e0b22", text: "#fbbf24", label: "⏰ FORCED" },
    THETA_EXIT:    { bg: "#f59e0b22", text: "#fbbf24", label: "🕐 THETA" },
    IV_CRUSH_EXIT: { bg: "#7c3aed22", text: "#a78bfa", label: "📉 IV CRUSH" },
    GAMMA_EXIT:    { bg: "#7c3aed22", text: "#a78bfa", label: "⚡ GAMMA" },
  };
  const c = cfg[type] || { bg: "#33333322", text: "#aaa", label: type };
  return (
    <span style={{
      background: c.bg, color: c.text, border: `1px solid ${c.text}33`,
      padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
    }}>
      {c.label}
    </span>
  );
}

function GradeChip({ grade }: { grade: string }) {
  const color =
    grade === "A" || grade === "A+" ? "#22c55e" :
    grade === "B"                   ? "#f59e0b" :
    grade === "C"                   ? "#f87171" : "#6b7280";
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}55`,
      padding: "1px 7px", borderRadius: 4, fontSize: 11, fontWeight: 800,
    }}>
      {grade || "–"}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface TradeAlarmPanelProps {
  alarmHistory: TradeAlarmPayload[];
  latestAlarm:  TradeAlarmPayload | null;
  notifAllowed: boolean;
  onRequestPermission: () => void;
  /** Optional: live current LTP of active option */
  liveLtp?: number;
}

export function TradeAlarmPanel({
  alarmHistory,
  latestAlarm,
  notifAllowed,
  onRequestPermission,
  liveLtp,
}: TradeAlarmPanelProps) {
  const [expanded, setExpanded]     = useState(true);
  const [tab, setTab]               = useState<"active" | "history" | "why">("active");
  const [flash, setFlash]           = useState(false);
  const prevAlarmId                 = useRef<string>("");

  // Flash animation on new alarm
  useEffect(() => {
    if (latestAlarm && latestAlarm.id !== prevAlarmId.current) {
      prevAlarmId.current = latestAlarm.id;
      setFlash(true);
      setTimeout(() => setFlash(false), 3000);
      // Auto-expand on new entry alarm
      if (latestAlarm.type === "ENTRY") {
        setExpanded(true);
        setTab("active");
      }
    }
  }, [latestAlarm]);

  // Find most recent open trade alarm (ENTRY without a close alarm)
  const activeAlarm = (() => {
    if (!alarmHistory.length) return null;
    const entryAlarms = alarmHistory.filter(a => a.type === "ENTRY");
    if (!entryAlarms.length) return null;
    const latest = entryAlarms[0];
    // Check if this trade has been closed
    const closeAlarm = alarmHistory.find(a =>
      a.tradeId === latest.tradeId &&
      ["TARGET_HIT", "SL_HIT", "EXIT_PROFIT", "EXIT_LOSS", "FORCE_EXIT",
       "THETA_EXIT", "IV_CRUSH_EXIT", "GAMMA_EXIT"].includes(a.type)
    );
    return closeAlarm ? null : latest;
  })();

  // Compute live P&L if we have an active trade
  const computedLtp = liveLtp ?? activeAlarm?.currentLTP ?? 0;
  const computedPnl = activeAlarm
    ? (computedLtp - activeAlarm.entry) * activeAlarm.lots * activeAlarm.lotSize
    : 0;

  // Get daily stats from latest alarm
  const dailyPnl    = latestAlarm?.dailyPnl ?? 0;
  const dailyTarget = latestAlarm?.dailyTarget ?? 3000;
  const tradesToday = latestAlarm?.tradesToday ?? 0;

  if (!expanded) {
    // Collapsed pill
    return (
      <div
        onClick={() => setExpanded(true)}
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: flash ? "#16a34a" : "#0f172a",
          border: `1px solid ${flash ? "#22c55e" : "#334155"}`,
          borderRadius: 40, padding: "8px 16px",
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
          transition: "all 0.3s ease",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 18 }}>{activeAlarm ? "🟢" : "⚫"}</span>
        <div>
          <div style={{ color: "#f8fafc", fontSize: 12, fontWeight: 700 }}>
            {activeAlarm
              ? `${activeAlarm.instrument} ${activeAlarm.direction.replace("BUY_", "")} LIVE`
              : "No Active Trade"}
          </div>
          {activeAlarm && (
            <div style={{ color: computedPnl >= 0 ? "#4ade80" : "#f87171", fontSize: 11 }}>
              {computedPnl >= 0 ? "+" : ""}₹{computedPnl.toFixed(0)}
            </div>
          )}
        </div>
        <div style={{ color: "#64748b", fontSize: 10 }}>▲</div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      width: 340,
      background: "#0b1221",
      border: `1px solid ${flash ? "#22c55e88" : "#1e293b"}`,
      borderRadius: 16,
      boxShadow: flash
        ? "0 0 0 2px #22c55e44, 0 8px 40px rgba(0,0,0,0.7)"
        : "0 8px 40px rgba(0,0,0,0.6)",
      overflow: "hidden",
      transition: "all 0.3s ease",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        background: "linear-gradient(135deg, #0f172a, #1e293b)",
        borderBottom: "1px solid #1e293b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: activeAlarm ? "#22c55e" : "#374151",
            boxShadow: activeAlarm ? "0 0 6px #22c55e" : "none",
            animation: activeAlarm ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ color: "#f8fafc", fontWeight: 700, fontSize: 12, letterSpacing: 0.5 }}>
            TRADE MONITOR
          </span>
          {!notifAllowed && (
            <button
              onClick={onRequestPermission}
              style={{
                background: "#f59e0b22", color: "#fbbf24",
                border: "1px solid #f59e0b55", borderRadius: 4,
                padding: "2px 6px", fontSize: 9, cursor: "pointer",
              }}
              title="Enable PC notifications for trade alarms"
            >
              🔔 Enable
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 600 }}>
            {tradesToday}/5 trades
          </span>
          <button
            onClick={() => setExpanded(false)}
            style={{
              background: "none", border: "none", color: "#64748b",
              cursor: "pointer", fontSize: 14, lineHeight: 1,
            }}
          >▼</button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{
        display: "flex", background: "#0f172a",
        borderBottom: "1px solid #1e293b",
      }}>
        {(["active", "why", "history"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "7px 0", border: "none",
              background: tab === t ? "#1e293b" : "transparent",
              color: tab === t ? "#f8fafc" : "#64748b",
              fontSize: 10, fontWeight: tab === t ? 700 : 400,
              cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.7,
              borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              transition: "all 0.2s",
            }}
          >
            {t === "active" ? "TRADE" : t === "why" ? "WHY" : "HISTORY"}
          </button>
        ))}
      </div>

      {/* ── Active Trade Tab ── */}
      {tab === "active" && (
        <div style={{ padding: 14 }}>
          {activeAlarm ? (
            <>
              {/* Trade header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ color: "#f8fafc", fontWeight: 800, fontSize: 14 }}>
                    {activeAlarm.instrument} {activeAlarm.direction.replace("BUY_", "")}
                  </div>
                  <div style={{ color: "#64748b", fontSize: 10 }}>
                    Strike {activeAlarm.strike} • {activeAlarm.strategyName}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <GradeChip grade={activeAlarm.grade} />
                  <AlarmBadge type="ENTRY" />
                </div>
              </div>

              {/* Price levels */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8, marginBottom: 12,
              }}>
                {[
                  { label: "ENTRY", value: activeAlarm.entry, color: "#94a3b8" },
                  { label: "SL", value: activeAlarm.sl, color: "#f87171" },
                  { label: "TARGET", value: activeAlarm.tp, color: "#4ade80" },
                ].map(item => (
                  <div key={item.label} style={{
                    background: "#1e293b", borderRadius: 8, padding: "6px 8px", textAlign: "center",
                  }}>
                    <div style={{ color: "#64748b", fontSize: 8, letterSpacing: 0.8, marginBottom: 2 }}>
                      {item.label}
                    </div>
                    <div style={{ color: item.color, fontWeight: 700, fontSize: 13 }}>
                      ₹{item.value.toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Live P&L */}
              <div style={{
                background: computedPnl >= 0 ? "#16a34a15" : "#dc262615",
                border: `1px solid ${computedPnl >= 0 ? "#22c55e33" : "#ef444433"}`,
                borderRadius: 10, padding: "8px 12px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 12,
              }}>
                <div>
                  <div style={{ color: "#64748b", fontSize: 9 }}>LIVE LTP</div>
                  <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 15 }}>
                    ₹{computedLtp.toFixed(1)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#64748b", fontSize: 9 }}>UNREALIZED P&L</div>
                  <div style={{
                    color: computedPnl >= 0 ? "#4ade80" : "#f87171",
                    fontWeight: 800, fontSize: 16,
                  }}>
                    {computedPnl >= 0 ? "+" : ""}₹{computedPnl.toFixed(0)}
                  </div>
                </div>
              </div>

              {/* Confidence bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "#64748b", fontSize: 9 }}>AI CONFIDENCE</span>
                  <span style={{ color: "#f8fafc", fontSize: 10, fontWeight: 700 }}>
                    {activeAlarm.confidence}%
                  </span>
                </div>
                <PnlBar value={activeAlarm.confidence} target={100} />
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: 24, color: "#64748b", fontSize: 12 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚫</div>
              No active trade
              <div style={{ fontSize: 10, marginTop: 4, color: "#334155" }}>
                Waiting for next signal...
              </div>
            </div>
          )}

          {/* Daily P&L progress */}
          <div style={{
            background: "#1e293b", borderRadius: 10, padding: "10px 12px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#94a3b8", fontSize: 9, fontWeight: 600 }}>
                DAILY P&L
              </span>
              <span style={{
                color: dailyPnl >= dailyTarget ? "#22c55e" : dailyPnl >= 0 ? "#f8fafc" : "#f87171",
                fontWeight: 800, fontSize: 12,
              }}>
                {dailyPnl >= 0 ? "+" : ""}₹{dailyPnl.toFixed(0)}
                <span style={{ color: "#64748b", fontWeight: 400 }}> / ₹{dailyTarget}</span>
              </span>
            </div>
            <PnlBar value={dailyPnl} target={dailyTarget} />
            <div style={{
              display: "flex", justifyContent: "space-between", marginTop: 6,
            }}>
              <span style={{ color: "#475569", fontSize: 9 }}>
                {tradesToday}/5 trades today
              </span>
              <span style={{
                color: dailyPnl >= dailyTarget ? "#22c55e" : "#64748b",
                fontSize: 9,
              }}>
                {dailyPnl >= dailyTarget ? "✅ Target achieved!" : `₹${(dailyTarget - dailyPnl).toFixed(0)} to go`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── WHY Tab ── */}
      {tab === "why" && (
        <div style={{ padding: 14, maxHeight: 320, overflowY: "auto" }}>
          {(activeAlarm || latestAlarm) ? (() => {
            const alarm = activeAlarm || latestAlarm!;
            const why   = alarm.whyTaken;
            return (
              <>
                <div style={{ color: "#64748b", fontSize: 9, marginBottom: 10, letterSpacing: 0.8 }}>
                  WHY THIS TRADE WAS TAKEN
                </div>

                {/* Weighted Stock Signal — THE KEY INSIGHT */}
                <div style={{
                  background: "#1e293b", borderRadius: 8, padding: "8px 10px", marginBottom: 8,
                  borderLeft: `3px solid ${why.weightedStockScore > 0 ? "#22c55e" : why.weightedStockScore < 0 ? "#f87171" : "#64748b"}`,
                }}>
                  <div style={{ color: "#94a3b8", fontSize: 9, marginBottom: 4, fontWeight: 600 }}>
                    📊 NIFTY 50 STOCK WEIGHT SIGNAL
                  </div>
                  <div style={{ color: "#f8fafc", fontSize: 11, fontWeight: 700 }}>
                    {why.weightedDirection} ({why.weightedStockScore > 0 ? "+" : ""}{why.weightedStockScore.toFixed(1)} net score)
                  </div>
                  {why.keyStockMovers && (
                    <div style={{ color: "#94a3b8", fontSize: 9, marginTop: 3, lineHeight: 1.5 }}>
                      {why.keyStockMovers}
                    </div>
                  )}
                  {why.specialTrioStatus && (
                    <div style={{ color: "#7dd3fc", fontSize: 9, marginTop: 3 }}>
                      Trio: {why.specialTrioStatus}
                    </div>
                  )}
                </div>

                {/* Gate summary */}
                <div style={{
                  background: "#1e293b", borderRadius: 8, padding: "8px 10px", marginBottom: 8,
                  borderLeft: "3px solid #3b82f6",
                }}>
                  <div style={{ color: "#94a3b8", fontSize: 9, marginBottom: 4, fontWeight: 600 }}>
                    🔒 9-GATE FILTER SYSTEM
                  </div>
                  <div style={{ color: "#4ade80", fontSize: 13, fontWeight: 800 }}>
                    {why.gatesPassed}/{why.totalGates} GATES PASSED
                  </div>
                  {why.layerConsensus && (
                    <div style={{ color: "#94a3b8", fontSize: 9, marginTop: 3 }}>
                      {why.layerConsensus}
                    </div>
                  )}
                </div>

                {/* Market signals */}
                {[
                  { label: "📈 Regime",      val: why.regimeLabel || "–" },
                  { label: "🌊 Breadth",     val: `${why.breadthScore}/100` },
                  { label: "📉 PCR",         val: why.pcr?.toFixed(2) || "–" },
                  { label: "⚡ Momentum",    val: `${why.momentumScore}/100` },
                  { label: "🏦 Smart Money", val: why.smartMoneyBias || "–" },
                  { label: "🕯️ ORB",         val: why.orbStatus || "–" },
                  { label: "📊 AG Score",    val: `${why.antigravityScore?.toFixed(0)}/100` },
                  { label: "🌡️ VIX",         val: `${why.vix?.toFixed(1)} (${why.vixCategory})` },
                ].map(item => (
                  <div key={item.label} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "4px 0", borderBottom: "1px solid #1e293b",
                  }}>
                    <span style={{ color: "#64748b", fontSize: 10 }}>{item.label}</span>
                    <span style={{ color: "#f8fafc", fontSize: 10, fontWeight: 600 }}>{item.val}</span>
                  </div>
                ))}
              </>
            );
          })() : (
            <div style={{ textAlign: "center", padding: 24, color: "#64748b", fontSize: 11 }}>
              No trade data to explain yet.
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {tab === "history" && (
        <div style={{ maxHeight: 320, overflowY: "auto", padding: "8px 0" }}>
          {alarmHistory.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: "#64748b", fontSize: 11 }}>
              No alarms yet today.
            </div>
          ) : (
            alarmHistory.slice(0, 15).map((alarm, i) => (
              <div key={alarm.id || i} style={{
                padding: "8px 14px",
                borderBottom: "1px solid #1e293b",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                    <AlarmBadge type={alarm.type} />
                    <span style={{ color: "#94a3b8", fontSize: 10 }}>
                      {alarm.instrument} {alarm.direction.replace("BUY_", "")}
                    </span>
                  </div>
                  <div style={{ color: "#475569", fontSize: 9 }}>
                    ₹{alarm.currentLTP.toFixed(1)} •{" "}
                    {new Date(alarm.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                </div>
                {alarm.pnl !== undefined && (
                  <div style={{
                    color: alarm.pnl >= 0 ? "#4ade80" : "#f87171",
                    fontWeight: 700, fontSize: 12,
                  }}>
                    {alarm.pnl >= 0 ? "+" : ""}₹{alarm.pnl.toFixed(0)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
