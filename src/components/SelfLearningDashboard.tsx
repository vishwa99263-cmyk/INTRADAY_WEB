/**
 * SelfLearningDashboard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Self-Learning Visualization — shows what the AI has learned from trades
 *
 * Features:
 *  - Win rate by time slot (heatmap)
 *  - Win rate by strategy (table)
 *  - AI confidence adjustments (what patterns were boosted/blocked)
 *  - "What AI learned" improvement log
 *  - Overall multiplier display
 */

import React, { useEffect, useState, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LearningPattern {
  pattern: {
    timeSlot: string;
    regime: string;
    pcrBucket: string;
    breadthBucket: string;
    vixBucket: string;
    momentumBucket: string;
    direction: string;
    strategyName: string;
  };
  record: {
    patternKey: string;
    wins: number;
    losses: number;
    totalPnl: number;
    winRate: number;
    avgPnl: number;
    lastUpdated: number;
    isBlocked: boolean;
    blockedUntil: number;
    adjustedBonus: number;
    isPromoted: boolean;
    statusLabel: string;
  };
}

interface LearningInsights {
  totalTrades: number;
  overallWinRate: number;
  bestPattern: any;
  worstPattern: any;
  blockedPatterns: number;
  topWinRates: LearningPattern[];
  promotedPatterns: LearningPattern[];
  sandboxPatterns: LearningPattern[];
  improvements: string[];
  confidenceMultiplier: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" &&
    (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

function WinRateBar({ rate, wins, losses }: { rate: number; wins: number; losses: number }) {
  const color =
    rate >= 65 ? "#22c55e" :
    rate >= 50 ? "#f59e0b" :
    rate >= 35 ? "#f97316" : "#ef4444";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          width: `${Math.min(100, rate)}%`, height: "100%",
          background: color, borderRadius: 3,
          transition: "width 0.5s ease",
        }} />
      </div>
      <div style={{ color, fontSize: 11, fontWeight: 700, minWidth: 36 }}>
        {rate.toFixed(0)}%
      </div>
      <div style={{ color: "#475569", fontSize: 9 }}>
        {wins}W/{losses}L
      </div>
    </div>
  );
}

function MultiplierGauge({ value }: { value: number }) {
  const color =
    value >= 1.1 ? "#22c55e" :
    value >= 1.0 ? "#f59e0b" :
    value >= 0.9 ? "#f97316" : "#ef4444";
  const label =
    value >= 1.1 ? "AGGRESSIVE 🚀" :
    value >= 1.0 ? "NORMAL ✅" :
    value >= 0.9 ? "CONSERVATIVE ⚠" : "RESTRICTED 🚫";

  return (
    <div style={{
      background: "#1e293b", borderRadius: 12, padding: "14px 16px",
      border: `1px solid ${color}33`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div>
        <div style={{ color: "#64748b", fontSize: 9, marginBottom: 4, letterSpacing: 0.8 }}>
          AI CONFIDENCE MODE
        </div>
        <div style={{ color, fontSize: 18, fontWeight: 800 }}>
          {value.toFixed(2)}x
        </div>
        <div style={{ color: "#94a3b8", fontSize: 10 }}>{label}</div>
      </div>
      <div style={{
        width: 56, height: 56,
        borderRadius: "50%",
        background: `conic-gradient(${color} ${Math.min(100, value * 70)}%, #1e293b 0)`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "#0f172a",
          display: "flex", alignItems: "center", justifyContent: "center",
          color, fontSize: 11, fontWeight: 800,
        }}>
          {(value * 100 - 100 >= 0 ? "+" : "")}{((value - 1) * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface SelfLearningDashboardProps {
  darkMode?: boolean;
}

export default function SelfLearningDashboard({ darkMode = true }: SelfLearningDashboardProps) {
  const [insights, setInsights]   = useState<LearningInsights | null>(null);
  const [loading, setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [tradeTypeFilter, setTradeTypeFilter] = useState<"ALL" | "INTRADAY" | "SWING">("ALL");

  const bg   = darkMode ? "#0b1221" : "#f8fafc";
  const surf = darkMode ? "#0f172a" : "#ffffff";
  const bdr  = darkMode ? "#1e293b" : "#e2e8f0";
  const txt  = darkMode ? "#f8fafc" : "#0f172a";
  const muted = darkMode ? "#64748b" : "#94a3b8";

  const fetchInsights = async () => {
    try {
      setLoading(true);
      const res = await fetch(getApiUrl("/api/te/learning-insights"));
      if (res.ok) {
        const data = await res.json();
        setInsights(data.insights);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error("[SelfLearning] Fetch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Reset all AI learning data? This will remove all win/loss patterns.")) return;
    try {
      const res = await fetch(getApiUrl("/api/te/learning-reset"), { method: "POST" });
      if (res.ok) {
        await fetchInsights();
        alert("Learning data reset successfully.");
      }
    } catch (err) {
      console.error("[SelfLearning] Reset failed:", err);
    }
  };

  useEffect(() => {
    fetchInsights();
    const interval = setInterval(fetchInsights, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const filteredInsights = useMemo(() => {
    if (!insights) return null;
    
    const filterFn = (item: LearningPattern) => {
      if (tradeTypeFilter === "ALL") return true;
      const isSwing = item.pattern.strategyName.endsWith("_SWING");
      return tradeTypeFilter === "SWING" ? isSwing : !isSwing;
    };
    
    return {
      ...insights,
      topWinRates: insights.topWinRates.filter(filterFn),
      promotedPatterns: insights.promotedPatterns.filter(filterFn),
      sandboxPatterns: insights.sandboxPatterns.filter(filterFn),
    };
  }, [insights, tradeTypeFilter]);

  const timeSlots = ["OPENING", "MID_MORNING", "MIDDAY", "AFTERNOON", "CLOSING"];
  const timeSlotLabels: Record<string, string> = {
    OPENING: "9:15–10:00", MID_MORNING: "10:00–11:30",
    MIDDAY: "11:30–13:00", AFTERNOON: "13:00–14:30", CLOSING: "14:30–15:30",
  };

  return (
    <div style={{
      background: bg, minHeight: "100%",
      padding: 24, fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 24,
      }}>
        <div>
          <div style={{ color: txt, fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>
            🧠 AI Self-Learning Engine
          </div>
          <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>
            Last refreshed: {lastRefresh.toLocaleTimeString("en-IN")}
            {insights && ` • ${insights.totalTrades} total trades analyzed`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {/* Filter Tabs */}
          <div style={{ display: "flex", background: "#1e293b", borderRadius: 8, padding: 4 }}>
            {(["ALL", "INTRADAY", "SWING"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setTradeTypeFilter(tab)}
                style={{
                  background: tradeTypeFilter === tab ? "#3b82f6" : "transparent",
                  color: tradeTypeFilter === tab ? "#fff" : "#94a3b8",
                  border: "none", borderRadius: 6, padding: "4px 12px",
                  fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.2s"
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
            onClick={fetchInsights}
            style={{
              background: "#1e293b", color: "#94a3b8", border: "1px solid #334155",
              borderRadius: 8, padding: "6px 14px", fontSize: 11, cursor: "pointer",
            }}
          >
            🔄 Refresh
          </button>
          <button
            onClick={handleReset}
            style={{
              background: "#dc262622", color: "#f87171", border: "1px solid #ef444433",
              borderRadius: 8, padding: "6px 14px", fontSize: 11, cursor: "pointer",
            }}
          >
            🗑 Reset All
          </button>
          </div>
        </div>
      </div>

      {loading && !insights ? (
        <div style={{ textAlign: "center", padding: 60, color: muted, fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🧠</div>
          Loading AI learning data...
        </div>
      ) : !insights || insights.totalTrades === 0 ? (
        <div style={{
          background: surf, border: `1px solid ${bdr}`, borderRadius: 16,
          padding: 48, textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <div style={{ color: txt, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            AI is Still Learning
          </div>
          <div style={{ color: muted, fontSize: 13, maxWidth: 400, margin: "0 auto" }}>
            The AI will start building pattern knowledge after 5+ paper trades. 
            Each completed trade teaches the AI which market conditions produce the best results.
          </div>
          <div style={{
            marginTop: 24, display: "flex", gap: 16, justifyContent: "center",
            flexWrap: "wrap",
          }}>
            {["OPENING ORB", "FII Flow", "PCR Extreme", "Smart Money", "OI Wall Scalp"].map(s => (
              <div key={s} style={{
                background: "#1e293b", borderRadius: 8, padding: "8px 14px",
                color: "#64748b", fontSize: 11,
              }}>
                📈 {s}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* ── Left Column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Overall stats */}
            <div style={{
              background: surf, border: `1px solid ${bdr}`, borderRadius: 16, padding: 20,
            }}>
              <div style={{ color: muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 16 }}>
                OVERALL PERFORMANCE
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[
                  { label: "Win Rate", value: `${insights.overallWinRate.toFixed(0)}%`,
                    color: insights.overallWinRate >= 55 ? "#22c55e" : "#f87171" },
                  { label: "Trades", value: String(insights.totalTrades), color: "#3b82f6" },
                  { label: "Blocked", value: String(insights.blockedPatterns), color: "#f59e0b" },
                ].map(item => (
                  <div key={item.label} style={{
                    background: "#1e293b", borderRadius: 10, padding: "12px", textAlign: "center",
                  }}>
                    <div style={{ color: muted, fontSize: 9, marginBottom: 4 }}>{item.label}</div>
                    <div style={{ color: item.color, fontSize: 22, fontWeight: 800 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Confidence multiplier */}
            <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: 16, padding: 20 }}>
              <div style={{ color: muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 12 }}>
                AI CONFIDENCE MULTIPLIER
              </div>
              <MultiplierGauge value={insights.confidenceMultiplier} />
              <div style={{ color: "#475569", fontSize: 10, marginTop: 10 }}>
                This multiplier is applied to all trade signals based on recent performance.
              </div>
            </div>

            {/* What AI learned */}
            <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: 16, padding: 20 }}>
              <div style={{ color: muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 12 }}>
                💡 WHAT AI LEARNED
              </div>
              {insights.improvements.map((imp, i) => (
                <div key={i} style={{
                  padding: "8px 0", borderBottom: `1px solid ${bdr}`,
                  color: txt, fontSize: 11, lineHeight: 1.5,
                }}>
                  {imp}
                </div>
              ))}
            </div>
          </div>

          {/* ── Right Column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Top patterns */}
            <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: 16, padding: 20 }}>
              <div style={{ color: muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 16 }}>
                🏆 TOP PERFORMING PATTERNS
              </div>
              {(!filteredInsights || filteredInsights.topWinRates.length === 0) ? (
                <div style={{ color: muted, fontSize: 11, padding: 16, textAlign: "center" }}>
                  No patterns yet for this filter — trade more to generate insights!
                </div>
              ) : (
                filteredInsights.topWinRates.map((item, i) => (
                  <div key={item.record.patternKey} style={{
                    padding: "10px 0", borderBottom: `1px solid ${bdr}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <div>
                        <span style={{
                          background: "#3b82f622", color: "#60a5fa",
                          borderRadius: 4, padding: "1px 6px", fontSize: 9, fontWeight: 700, marginRight: 6,
                        }}>
                          #{i + 1}
                        </span>
                        <span style={{ color: txt, fontSize: 11, fontWeight: 600 }}>
                          {item.pattern.strategyName}
                        </span>
                      </div>
                      <div style={{
                        color: item.record.adjustedBonus > 0 ? "#22c55e" : "#f87171",
                        fontSize: 10, fontWeight: 700,
                      }}>
                        {item.record.adjustedBonus > 0 ? "+" : ""}{item.record.adjustedBonus}% conf
                      </div>
                    </div>
                    <div style={{ color: muted, fontSize: 9, marginBottom: 6 }}>
                      {timeSlotLabels[item.pattern.timeSlot] || item.pattern.timeSlot} •{" "}
                      {item.pattern.regime} • {item.pattern.direction}
                    </div>
                    <WinRateBar
                      rate={item.record.winRate}
                      wins={item.record.wins}
                      losses={item.record.losses}
                    />
                    <div style={{ color: "#22c55e", fontSize: 9, marginTop: 4 }}>
                      Avg P&L: ₹{item.record.avgPnl.toFixed(0)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Time slot heatmap */}
            <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: 16, padding: 20 }}>
              <div style={{ color: muted, fontSize: 10, letterSpacing: 0.8, marginBottom: 16 }}>
                ⏱ WIN RATE BY TIME SLOT
              </div>
              {timeSlots.map(slot => {
                const slotPatterns = filteredInsights ? filteredInsights.topWinRates.filter(p => p.pattern.timeSlot === slot) : [];
                const avgWin = slotPatterns.length > 0
                  ? slotPatterns.reduce((s, p) => s + p.record.winRate, 0) / slotPatterns.length
                  : null;
                const color =
                  avgWin === null ? "#334155" :
                  avgWin >= 65   ? "#22c55e" :
                  avgWin >= 50   ? "#f59e0b" : "#ef4444";

                return (
                  <div key={slot} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "6px 0",
                    borderBottom: `1px solid ${bdr}`,
                  }}>
                    <div style={{ minWidth: 100, color: muted, fontSize: 9 }}>
                      {timeSlotLabels[slot]}
                    </div>
                    <div style={{
                      flex: 1, height: 16, background: "#1e293b", borderRadius: 4,
                      overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${avgWin ?? 0}%`, height: "100%",
                        background: color, borderRadius: 4,
                        transition: "width 0.5s ease",
                      }} />
                    </div>
                    <div style={{
                      color, fontSize: 10, fontWeight: 700, minWidth: 40, textAlign: "right",
                    }}>
                      {avgWin !== null ? `${avgWin.toFixed(0)}%` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>

        {/* ── Phase 2: Sandbox vs Promoted Grid ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16
        }}>
          {/* Promoted Patterns */}
          <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: 16, padding: 20 }}>
            <div style={{ color: "#22c55e", fontSize: 10, fontWeight: 800, letterSpacing: 0.8, marginBottom: 16 }}>
              🟢 PROMOTED PATTERNS (REAL TRADING APPROVED)
            </div>
            {!filteredInsights || filteredInsights.promotedPatterns.length === 0 ? (
              <div style={{ color: muted, fontSize: 11, padding: 16, textAlign: "center" }}>
                No promoted patterns yet. 65%+ win rate on 3+ shadow trades is required for promotion.
              </div>
            ) : (
              filteredInsights.promotedPatterns.map((item) => (
                <div key={item.record.patternKey} style={{
                  padding: "10px 0", borderBottom: `1px solid ${bdr}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div>
                      <span style={{ color: txt, fontSize: 11, fontWeight: 600 }}>
                        {item.pattern.strategyName}
                      </span>
                    </div>
                    <div style={{ color: "#22c55e", fontSize: 10, fontWeight: 700 }}>
                      Win Rate: {item.record.winRate.toFixed(0)}% ({item.record.wins + item.record.losses} Trades)
                    </div>
                  </div>
                  <div style={{ color: muted, fontSize: 9 }}>
                    Time: {timeSlotLabels[item.pattern.timeSlot]} | Regime: {item.pattern.regime} | Direction: {item.pattern.direction}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 9, marginTop: 4 }}>
                    Status: {item.record.statusLabel}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Sandbox Patterns */}
          <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: 16, padding: 20 }}>
            <div style={{ color: "#f59e0b", fontSize: 10, fontWeight: 800, letterSpacing: 0.8, marginBottom: 16 }}>
              🟡 SANDBOX PATTERNS (SHADOW MODE SCALPING)
            </div>
            {!filteredInsights || filteredInsights.sandboxPatterns.length === 0 ? (
              <div style={{ color: muted, fontSize: 11, padding: 16, textAlign: "center" }}>
                No active sandbox patterns yet.
              </div>
            ) : (
              filteredInsights.sandboxPatterns.map((item) => (
                <div key={item.record.patternKey} style={{
                  padding: "10px 0", borderBottom: `1px solid ${bdr}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div>
                      <span style={{ color: txt, fontSize: 11, fontWeight: 600 }}>
                        {item.pattern.strategyName}
                      </span>
                    </div>
                    <div style={{ color: "#f59e0b", fontSize: 10, fontWeight: 700 }}>
                      Win Rate: {item.record.winRate.toFixed(0)}% ({item.record.wins + item.record.losses} Trades)
                    </div>
                  </div>
                  <div style={{ color: muted, fontSize: 9 }}>
                    Time: {timeSlotLabels[item.pattern.timeSlot]} | Regime: {item.pattern.regime} | Direction: {item.pattern.direction}
                  </div>
                  <div style={{ color: "#f87171", fontSize: 9, marginTop: 4 }}>
                    Status: {item.record.statusLabel}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
