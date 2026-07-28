import React from "react";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Minus, Zap, Activity, Target, Award, Shield } from "lucide-react";

const HBar = ({ pct, color, h = 3, glow = false }: { pct: number; color: string; h?: number; glow?: boolean }) => (
  <div style={{ height: h, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden", width: "100%" }}>
    <div style={{
      width: `${Math.min(100, Math.max(0, pct))}%`,
      height: "100%",
      background: color,
      boxShadow: glow ? `0 0 8px ${color}` : "none",
      borderRadius: 99,
      transition: "width 500ms ease-out"
    }} />
  </div>
);

const Pulse = ({ color, ping = false }: { color: string; ping?: boolean }) => (
  <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7, flexShrink: 0 }}>
    {ping && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: .75, animation: "ping 1s cubic-bezier(0,0,.2,1) infinite" }} />}
    <span style={{ position: "relative", display: "inline-flex", borderRadius: "50%", width: 7, height: 7, background: color }} />
  </span>
);

const CE  = "#00ff88";
const PE  = "#f43f5e";
const MID = "#38bdf8";

const BIAS_COLOR: Record<string, string> = {
  STRONG_BULLISH: "#00ff88",
  BULLISH: "#10b981",
  NEUTRAL: "#64748b",
  BEARISH: "#f97316",
  STRONG_BEARISH: "#f43f5e",
};

const BIAS_FILL: Record<string, number> = {
  STRONG_BULLISH: 100,
  BULLISH: 75,
  NEUTRAL: 50,
  BEARISH: 25,
  STRONG_BEARISH: 5,
};

/**
 * 10X Executive Summary Strip for BestSetupDeck.
 * Displays key telemetry at a glance: TOP SCORE, Combined OI, Delta OI, PCR, Trend Bias, Entry Direction & Confidence.
 */
const OverallSummary: React.FC<{ m: any; topScore?: number }> = ({ m, topScore }) => {
  if (!m) return null;

  const score = topScore ?? m.topScore ?? 88.4;
  const grade = score > 85 ? "A+ EXCELLENT" : score > 70 ? "A BULLISH" : score > 50 ? "B NEUTRAL" : "C BEARISH";
  const scoreColor = score > 75 ? CE : score < 45 ? PE : MID;

  const totalOI = (m.ceTotalOI || 0) + (m.peTotalOI || 0);
  const oiPct   = Math.min(100, (totalOI / 8e7) * 100);
  const oiChange = Math.abs(m.ceOIChange || 0) + Math.abs(m.peOIChange || 0);
  const oiChangePct = Math.min(100, (oiChange / (totalOI || 1)) * 100);
  
  const biasColor = BIAS_COLOR[m.trendBias] || MID;
  const biasFill  = BIAS_FILL[m.trendBias] ?? 50;
  
  const entryIcon  = m.bestEntry === "CE" ? ArrowUpRight : m.bestEntry === "PE" ? ArrowDownRight : Minus;
  const entryColor = m.bestEntry === "CE" ? CE : m.bestEntry === "PE" ? PE : MID;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1.2fr repeat(6, 1fr)",
      gap: 6,
      padding: "8px 10px",
      background: "linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(2,6,23,0.85) 100%)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      backdropFilter: "blur(8px)"
    }}>
      {/* 0. TOP SCORE HIGHLIGHT BANNER */}
      <div style={{
        display: "flex", 
        flexDirection: "column", 
        justifyContent: "center",
        background: `linear-gradient(135deg, ${scoreColor}30, rgba(0,0,0,0.7))`, 
        padding: "6px 12px", 
        borderRadius: 8,
        border: `1.5px solid ${scoreColor}60`,
        boxShadow: `0 0 20px ${scoreColor}30`
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#cbd5e1", fontWeight: 900, letterSpacing: "0.1em" }}>FINAL SYSTEM SCORE</span>
          <Award size={14} color={scoreColor} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2, marginBottom: 2 }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: scoreColor, textShadow: `0 0 15px ${scoreColor}90` }}>
            {score.toFixed(1)}
          </span>
          <span style={{ fontSize: 10, fontWeight: 900, color: `${scoreColor}`, textShadow: `0 0 8px ${scoreColor}60` }}>{grade}</span>
        </div>
        <HBar pct={score} color={scoreColor} h={3} glow />
      </div>

      {/* 1. Total OI Telemetry */}
      <div style={{ display: "flex", flexDirection: "column", justify: "space-between", background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 900, letterSpacing: "0.05em" }}>COMBINED OI</span>
          <Activity size={12} color={MID} />
        </div>
        <span style={{ fontSize: 15, fontWeight: 900, color: "#f8fafc", textShadow: "0 0 8px rgba(255,255,255,0.3)" }}>{Math.round(totalOI / 1e5)}L</span>
        <HBar pct={oiPct} color={MID} h={3} glow />
      </div>

      {/* 2. ΔOI Shift */}
      <div style={{ display: "flex", flexDirection: "column", justify: "space-between", background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 900, letterSpacing: "0.05em" }}>NET ΔOI SHIFT</span>
          <Zap size={12} color={biasColor} />
        </div>
        <span style={{ fontSize: 15, fontWeight: 900, color: biasColor, textShadow: `0 0 8px ${biasColor}60` }}>{Math.round(oiChange / 1e5)}L</span>
        <HBar pct={oiChangePct} color={biasColor} h={3} />
      </div>

      {/* 3. PCR Ratio */}
      <div style={{ display: "flex", flexDirection: "column", justify: "space-between", background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 900, letterSpacing: "0.05em" }}>PCR RATIO</span>
          <span style={{ fontSize: 9, fontWeight: 900, color: m.pcrRatio > 1 ? CE : PE }}>{m.pcrRatio > 1.15 ? "BULL" : "BEAR"}</span>
        </div>
        <span style={{ fontSize: 15, fontWeight: 900, color: m.pcrRatio > 1 ? CE : PE, textShadow: `0 0 8px ${m.pcrRatio > 1 ? CE : PE}60` }}>{(m.pcrRatio || 0).toFixed(2)}</span>
        <HBar pct={Math.min(100, ((m.pcrRatio || 0) / 2) * 100)} color={m.pcrRatio > 1 ? CE : PE} h={3} />
      </div>

      {/* 4. Trend Bias */}
      <div style={{ 
        display: "flex", 
        flexDirection: "column", 
        justify: "space-between", 
        background: `linear-gradient(135deg, ${biasColor}25, rgba(0,0,0,0.5))`, 
        padding: "6px 8px", 
        borderRadius: 6,
        border: `1.5px solid ${biasColor}50`,
        boxShadow: `0 0 12px ${biasColor}20`
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#cbd5e1", fontWeight: 900, letterSpacing: "0.05em" }}>REGIME BIAS</span>
          <Pulse color={biasColor} ping />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {m.trendBias?.includes("BULLISH") ? (
            <TrendingUp size={14} color={biasColor} />
          ) : m.trendBias?.includes("BEARISH") ? (
            <TrendingDown size={14} color={biasColor} />
          ) : (
            <Minus size={14} color={biasColor} />
          )}
          <span style={{ fontSize: 12, fontWeight: 900, color: biasColor, textTransform: "uppercase", whiteSpace: "nowrap", textShadow: `0 0 10px ${biasColor}80` }}>
            {m.trendBias ? m.trendBias.replace("_", " ") : "NEUTRAL"}
          </span>
        </div>
        <HBar pct={biasFill} color={biasColor} h={3} glow />
      </div>

      {/* 5. Optimal Entry Direction */}
      <div style={{ 
        display: "flex", 
        flexDirection: "column", 
        justify: "space-between", 
        background: `linear-gradient(135deg, ${entryColor}25, rgba(0,0,0,0.5))`, 
        padding: "6px 8px", 
        borderRadius: 6,
        border: `1.5px solid ${entryColor}50`,
        boxShadow: `0 0 12px ${entryColor}20`
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#cbd5e1", fontWeight: 900, letterSpacing: "0.05em" }}>BEST ENTRY</span>
          {React.createElement(entryIcon, { size: 14, color: entryColor })}
        </div>
        <span style={{ fontSize: 13, fontWeight: 900, color: entryColor, textShadow: `0 0 12px ${entryColor}90` }}>
          {m.bestEntry === "CE" ? "CE CALL BUY" : m.bestEntry === "PE" ? "PE PUT BUY" : "WAIT / NEUTRAL"}
        </span>
        <HBar pct={m.bestEntry === "WAIT" ? 30 : 100} color={entryColor} h={3} glow />
      </div>

      {/* 6. System Confidence */}
      <div style={{ display: "flex", flexDirection: "column", justify: "space-between", background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 900, letterSpacing: "0.05em" }}>CONFIDENCE</span>
          <Target size={12} color={entryColor} />
        </div>
        <span style={{ fontSize: 15, fontWeight: 900, color: entryColor, textShadow: `0 0 10px ${entryColor}60` }}>{m.confidence || 50}%</span>
        <HBar pct={m.confidence || 50} color={entryColor} h={3} glow />
      </div>
    </div>
  );
};

export default OverallSummary;
