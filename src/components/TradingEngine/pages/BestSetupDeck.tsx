/**
 * BestSetupDeck.tsx v4.0 (10X Dynamic Edition)
 * Visual Trading Telemetry System with Dynamic Analytics
 * Layout: [Header Tabs & Telemetry Strip] -> [CE Analytics] | [Center ATM Matrix] | [PE Analytics]
 */
import React, { useState, useEffect, useCallback } from "react";
import { 
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Minus, 
  RefreshCw, Activity, ShieldAlert, Zap, Compass, Flame, Crosshair
} from "lucide-react";
import OverallSummary from "./OverallSummary";

export type TrendBias = "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH";
export type OISignal  = "CE BUY" | "PE BUY" | "NEUTRAL";
export type EntryDir  = "CE" | "PE" | "WAIT";

export interface M {
  atmStrike: number; 
  spot: number; 
  pcrRatio: number; 
  trendBias: TrendBias;
  oiDefScore: number; 
  oiDefSignal: OISignal;
  ceTotalOI: number; 
  ceOIChange: number; 
  cePressure: number; 
  ceMom: number; 
  ceAvgPrem: number; 
  ceStr: number; 
  ceVolume: number;
  peTotalOI: number; 
  peOIChange: number; 
  peMomentum: number; 
  peMom: number; 
  peAvgPrem: number; 
  peStr: number; 
  peVolume: number;
  dayHigh: number; 
  dayLow: number; 
  prevHigh: number; 
  prevLow: number;
  bestEntry: EntryDir; 
  confidence: number;
  topScore: number;
}

interface Props { 
  activePage?: string; 
  spotPrice?: number; 
  overallScore?: number;
}

const CE  = "#00ff88";
const PE  = "#f43f5e";
const MID = "#38bdf8";

const BIAS_COLOR: Record<TrendBias, string> = {
  STRONG_BULLISH: "#00ff88",
  BULLISH: "#10b981",
  NEUTRAL: "#64748b",
  BEARISH: "#f97316",
  STRONG_BEARISH: "#f43f5e"
};

const BIAS_FILL: Record<TrendBias, number> = {
  STRONG_BULLISH: 100,
  BULLISH: 75,
  NEUTRAL: 50,
  BEARISH: 25,
  STRONG_BEARISH: 5
};

const api = (p: string) => `${typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:") ? "http://localhost:3000" : ""}${p}`;
const fL  = (n: number) => `${(n / 1e5).toFixed(1)}L`;
const fK  = (n: number) => Math.abs(n) >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
const sg  = (n: number) => n >= 0 ? "+" : "";

function getDefaultSpot(inst: string, fallback: number): number {
  if (inst === "BANKNIFTY") return 52140;
  if (inst === "SENSEX") return 80450;
  if (inst === "FINNIFTY") return 23410;
  return fallback > 0 ? fallback : 24520;
}

function mockMetrics(spotInput: number, inst: string): M {
  const spot = getDefaultSpot(inst, spotInput);
  const iv = inst === "SENSEX" ? 100 : inst === "BANKNIFTY" ? 100 : 50;
  const atm = Math.round(spot / iv) * iv;
  const pcr = 0.75 + Math.random() * 1.3;
  const bias: TrendBias = pcr > 1.45 ? "STRONG_BULLISH" : pcr > 1.15 ? "BULLISH" : pcr < 0.75 ? "STRONG_BEARISH" : pcr < 0.95 ? "BEARISH" : "NEUTRAL";
  const oidef = (Math.random() - 0.35) * 2800;
  const sig: OISignal = oidef > 350 ? "CE BUY" : oidef < -350 ? "PE BUY" : "NEUTRAL";
  const dH = spot + 90 + Math.random() * 110;
  const dL = spot - 90 - Math.random() * 110;
  const entry: EntryDir = sig === "CE BUY" ? "CE" : sig === "PE BUY" ? "PE" : "WAIT";
  const ceOI = (220 + Math.random() * 120) * 1e5;
  const peOI = (320 + Math.random() * 160) * 1e5;
  const peMom = 6000 + Math.random() * 24000;
  const confidence = Math.floor(60 + Math.random() * 38);
  const score = parseFloat((72 + (confidence * 0.25) + (pcr * 5)).toFixed(1));
  
  return {
    atmStrike: atm,
    spot,
    pcrRatio: parseFloat(pcr.toFixed(3)),
    trendBias: bias,
    oiDefScore: parseFloat(oidef.toFixed(1)),
    oiDefSignal: sig,
    ceTotalOI: ceOI,
    ceOIChange: (Math.random() - 0.45) * 110 * 1e5,
    cePressure: (Math.random() - 0.5) * 320,
    ceMom: -14000 - Math.random() * 6000,
    ceAvgPrem: -18 - Math.random() * 12,
    ceStr: 14000 + Math.random() * 4000,
    ceVolume: 1.2e6 + Math.random() * 5e6,
    peTotalOI: peOI,
    peOIChange: (Math.random() - 0.3) * 130 * 1e5,
    peMomentum: peMom,
    peMom: peMom + Math.random() * 4000,
    peAvgPrem: 4 + Math.random() * 8,
    peStr: 16000 + Math.random() * 4000,
    peVolume: 1.8e6 + Math.random() * 4.5e6,
    dayHigh: Math.round(dH),
    dayLow: Math.round(dL),
    prevHigh: Math.round(dH - 15 + Math.random() * 40),
    prevLow: Math.round(dL + 15 - Math.random() * 40),
    bestEntry: entry,
    confidence,
    topScore: Math.min(99.9, score)
  };
}

// ── Primitives ─────────────────────────────────────────────────────────────

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

const VBar = ({ pct, color, w = 4 }: { pct: number; color: string; w?: number }) => (
  <div style={{ width: w, height: 32, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden", position: "relative", flexShrink: 0 }}>
    <div style={{ 
      position: "absolute", 
      bottom: 0, 
      width: "100%", 
      height: `${Math.min(100, Math.max(0, pct))}%`, 
      background: color, 
      boxShadow: `0 0 6px ${color}A0`, 
      borderRadius: 3, 
      transition: "height 500ms ease-out" 
    }} />
  </div>
);

const Pulse = ({ color, ping = false }: { color: string; ping?: boolean }) => (
  <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7, flexShrink: 0 }}>
    {ping && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: .75, animation: "ping 1s cubic-bezier(0,0,.2,1) infinite" }} />}
    <span style={{ position: "relative", display: "inline-flex", borderRadius: "50%", width: 7, height: 7, background: color }} />
  </span>
);

const Spikes = ({ count, filled, color, flip = false }: { count: number; filled: number; color: string; flip?: boolean }) => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
    {Array.from({ length: count }, (_, i) => {
      const idx = flip ? count - 1 - i : i;
      return <div key={i} style={{ width: 3, height: 7 + idx * 3.5, background: i < filled ? color : `${color}25`, borderRadius: 2 }} />;
    })}
  </div>
);

// ── Instrument Switcher Header Component ─────────────────────────────────────

const InstrumentSwitch = ({ selected, onSelect }: { selected: string; onSelect: (inst: string) => void }) => {
  const instruments = [
    { key: "NIFTY", label: "NIFTY 50" },
    { key: "BANKNIFTY", label: "BANKNIFTY" },
    { key: "FINNIFTY", label: "FINNIFTY" },
    { key: "SENSEX", label: "SENSEX" }
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(0,0,0,0.4)", padding: "3px 4px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
      {instruments.map(({ key, label }) => {
        const active = selected === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            style={{
              fontSize: 9,
              fontWeight: 800,
              padding: "3px 8px",
              borderRadius: 4,
              border: active ? `1px solid ${MID}80` : "1px solid transparent",
              background: active ? `linear-gradient(135deg, ${MID}30, ${MID}10)` : "transparent",
              color: active ? "#ffffff" : "#64748b",
              boxShadow: active ? `0 0 10px ${MID}40` : "none",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 200ms ease",
              letterSpacing: "0.03em"
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

// ── Call (CE) Telemetry Column ───────────────────────────────────────────────

const CECol = ({ m }: { m: M }) => {
  const c = CE;
  const totalOI = m.ceTotalOI + m.peTotalOI || 1;
  const oiPct = Math.min(100, (m.ceTotalOI / totalOI) * 100);
  const chgPct = Math.min(100, (Math.abs(m.ceOIChange) / (Math.abs(m.ceOIChange) + Math.abs(m.peOIChange) + 1)) * 100);
  const prsPct = Math.min(100, (Math.abs(m.cePressure) / 320) * 100);
  const isPos = m.ceOIChange >= 0;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      height: "100%",
      padding: "10px 12px",
      background: `linear-gradient(180deg, ${c}09 0%, rgba(0,0,0,0) 100%)`,
      borderRadius: "8px 0 0 8px"
    }}>
      {/* Label Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <TrendingUp size={12} color={c} />
          <span style={{ fontSize: 10, fontWeight: 900, color: c, letterSpacing: "0.05em" }}>CALL (CE) BUILDUP</span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, color: `${c}CC` }}>{oiPct.toFixed(0)}% SHARE</span>
      </div>

      {/* Total OI */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 8, color: "#64748b", fontWeight: 700 }}>TOTAL CE OI</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: c, textShadow: `0 0 10px ${c}60` }}>+{fL(m.ceTotalOI)}</span>
        </div>
        <HBar pct={oiPct} color={c} h={3} glow />
      </div>

      {/* OI Change */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.02)", padding: "4px 6px", borderRadius: 4 }}>
        {isPos ? <ArrowUpRight size={10} color={c} /> : <ArrowDownRight size={10} color={PE} />}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 7, color: "#64748b", fontWeight: 700 }}>ΔOI SHIFT</span>
          <span style={{ fontSize: 10, fontWeight: 900, color: isPos ? c : PE }}>{sg(m.ceOIChange)}{fK(m.ceOIChange)}</span>
        </div>
        <div style={{ flex: 1, marginLeft: 4 }}><HBar pct={chgPct} color={isPos ? c : PE} h={2} /></div>
      </div>

      {/* Pressure Meter */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#64748b", fontWeight: 700 }}>
          <span>CALL PRESSURE</span>
          <span style={{ color: m.cePressure < 0 ? PE : c, fontWeight: 900 }}>{sg(m.cePressure)}{Math.abs(m.cePressure).toFixed(0)}</span>
        </div>
        <HBar pct={prsPct} color={m.cePressure < 0 ? PE : c} h={3} glow />
      </div>

      {/* Volumetric Metrics */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyBetween: "space-between", gap: 6, background: "rgba(0,0,0,0.2)", padding: "6px", borderRadius: 4 }}>
        <VBar pct={Math.min(100, (m.ceStr / 20000) * 100)} color={c} w={5} />
        <VBar pct={Math.min(100, Math.abs(m.ceAvgPrem) * 4)} color={m.ceAvgPrem >= 0 ? c : PE} w={5} />
        <VBar pct={Math.min(100, (m.ceVolume / 8e6) * 100)} color={`${c}90`} w={5} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8 }}>
            <span style={{ color: "#64748b" }}>STRENGTH:</span>
            <span style={{ fontWeight: 900, color: c }}>{fK(m.ceStr)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8 }}>
            <span style={{ color: "#64748b" }}>PREM DECAY:</span>
            <span style={{ fontWeight: 900, color: m.ceAvgPrem >= 0 ? c : PE }}>{sg(m.ceAvgPrem)}{m.ceAvgPrem.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Signal Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4 }}>
        <span style={{ fontSize: 8, color: "#64748b", fontWeight: 800 }}>MOMENTUM</span>
        <Spikes count={6} filled={Math.round((m.ceStr / 20000) * 6)} color={c} />
      </div>
    </div>
  );
};

// ── Center ATM & Market Matrix Column ────────────────────────────────────────

const CtrCol = ({ m, inst, setInst, loading, refresh }: { m: M; inst: string; setInst: (s: string) => void; loading: boolean; refresh: () => void }) => {
  const bc = BIAS_COLOR[m.trendBias];
  const bf = BIAS_FILL[m.trendBias];
  const ec = m.bestEntry === "CE" ? CE : m.bestEntry === "PE" ? PE : "#64748b";
  const EIcon = m.bestEntry === "CE" ? ArrowUpRight : m.bestEntry === "PE" ? ArrowDownRight : Minus;
  
  const allP = [m.dayLow, m.prevLow, m.spot, m.prevHigh, m.dayHigh];
  const minP = Math.min(...allP);
  const maxP = Math.max(...allP);
  const rng  = maxP - minP || 1;
  const pp   = (p: number) => `${Math.max(0, Math.min(100, ((p - minP) / rng) * 100))}%`;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      height: "100%",
      padding: "10px 10px",
      background: "rgba(0,0,0,0.15)"
    }}>
      {/* Instrument Switcher & Refresh */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <InstrumentSwitch selected={inst} onSelect={setInst} />
        <button 
          onClick={refresh} 
          style={{ 
            background: "rgba(255,255,255,0.04)", 
            border: "1px solid rgba(255,255,255,0.08)", 
            borderRadius: 4, 
            cursor: "pointer", 
            color: "#94a3b8", 
            padding: "4px 6px",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 9,
            fontWeight: 700
          }}
        >
          <RefreshCw size={9} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          <span>SYNC</span>
        </button>
      </div>

      {/* ATM Strike & PCR Big Banner */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "linear-gradient(135deg, rgba(15,23,42,0.8), rgba(2,6,23,0.9))",
        padding: "8px 12px",
        borderRadius: 6,
        border: `1px solid ${ec}30`,
        boxShadow: `0 0 15px ${ec}15`
      }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 7, color: "#64748b", fontWeight: 800, letterSpacing: "0.08em" }}>ATM STRIKE</span>
          <span style={{ fontSize: 22, fontWeight: 900, color: "#f8fafc", textShadow: `0 0 20px ${ec}60`, lineHeight: 1 }}>
            {m.atmStrike.toLocaleString("en-IN")}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 7, color: "#64748b", fontWeight: 800 }}>PCR RATIO</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: m.pcrRatio > 1.15 ? CE : m.pcrRatio < 0.85 ? PE : "#f59e0b" }}>
            {m.pcrRatio.toFixed(2)}
          </span>
          <div style={{ width: 45, marginTop: 2 }}>
            <HBar pct={Math.min(100, (m.pcrRatio / 2) * 100)} color={m.pcrRatio > 1 ? CE : PE} h={2} />
          </div>
        </div>
      </div>

      {/* Trend Bias Indicator Gauge */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "#64748b", fontWeight: 800 }}>TREND BIAS & REGIME</span>
          <span style={{ fontSize: 9, fontWeight: 900, color: bc }}>{m.trendBias.replace("_", " ")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${bf}%`, height: "100%", background: `linear-gradient(90deg, ${bc}50, ${bc})`, boxShadow: `0 0 10px ${bc}`, borderRadius: 3, transition: "width 500ms ease-out" }} />
          </div>
          <Pulse color={bc} ping />
        </div>
      </div>

      {/* OI Defense Signal */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.02)", padding: "4px 8px", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <ShieldAlert size={10} color={m.oiDefSignal === "CE BUY" ? CE : m.oiDefSignal === "PE BUY" ? PE : "#64748b"} />
          <span style={{ fontSize: 8, color: "#64748b", fontWeight: 800 }}>OI DEFENSE</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 900, color: m.oiDefSignal === "CE BUY" ? CE : m.oiDefSignal === "PE BUY" ? PE : "#64748b" }}>
          {sg(m.oiDefScore)}{Math.abs(m.oiDefScore).toFixed(0)} ({m.oiDefSignal})
        </span>
      </div>

      {/* Live Price Ruler (Day Low -> Spot -> Day High) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "#64748b", fontWeight: 800 }}>
          <span>LOW: {m.dayLow}</span>
          <span style={{ color: ec, fontWeight: 900 }}>SPOT: {m.spot}</span>
          <span>HIGH: {m.dayHigh}</span>
        </div>
        <div style={{ position: "relative", height: 14, background: "rgba(255,255,255,0.03)", borderRadius: 3, overflow: "hidden" }}>
          {/* Day range bar */}
          <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: pp(m.dayLow), right: `${100 - parseFloat(pp(m.dayHigh))}%`, height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2 }} />
          {/* Day High/Low indicators */}
          <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, left: pp(m.dayHigh), background: CE }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, left: pp(m.dayLow), background: PE }} />
          {/* Spot marker */}
          <div style={{ position: "absolute", top: 0, bottom: 0, width: 3, left: pp(m.spot), background: ec, boxShadow: `0 0 8px ${ec}`, zIndex: 10, transition: "left 500ms ease-out" }} />
        </div>
      </div>

      {/* Actionable Entry Directive & Confidence */}
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 6, 
        background: `linear-gradient(90deg, ${ec}15, rgba(0,0,0,0.3))`, 
        padding: "5px 8px", 
        borderRadius: 5,
        border: `1px solid ${ec}35`
      }}>
        <div style={{ 
          width: 20, 
          height: 20, 
          borderRadius: 4, 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center", 
          background: `${ec}25`, 
          border: `1px solid ${ec}50`, 
          flexShrink: 0 
        }}>
          <EIcon size={11} color={ec} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, fontWeight: 900, color: ec }}>SETUP: {m.bestEntry} ENTRY</span>
            <span style={{ fontSize: 9, fontWeight: 900, color: ec }}>{m.confidence}% CONF</span>
          </div>
          <HBar pct={m.confidence} color={ec} h={3} glow />
        </div>
      </div>
    </div>
  );
};

// ── Put (PE) Telemetry Column ────────────────────────────────────────────────

const PECol = ({ m }: { m: M }) => {
  const c = PE;
  const totalOI = m.ceTotalOI + m.peTotalOI || 1;
  const oiPct = Math.min(100, (m.peTotalOI / totalOI) * 100);
  const chgPct = Math.min(100, (Math.abs(m.peOIChange) / (Math.abs(m.ceOIChange) + Math.abs(m.peOIChange) + 1)) * 100);
  const momPct = Math.min(100, (m.peMomentum / 30000) * 100);
  const isPos = m.peOIChange >= 0;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      height: "100%",
      padding: "10px 12px",
      background: `linear-gradient(180deg, ${c}09 0%, rgba(0,0,0,0) 100%)`,
      borderRadius: "0 8px 8px 0"
    }}>
      {/* Label Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: `${c}CC` }}>{oiPct.toFixed(0)}% SHARE</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: c, letterSpacing: "0.05em" }}>PUT (PE) BUILDUP</span>
          <TrendingDown size={12} color={c} />
        </div>
      </div>

      {/* Total OI */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: c, textShadow: `0 0 10px ${c}60` }}>+{fL(m.peTotalOI)}</span>
          <span style={{ fontSize: 8, color: "#64748b", fontWeight: 700 }}>TOTAL PE OI</span>
        </div>
        <HBar pct={oiPct} color={c} h={3} glow />
      </div>

      {/* OI Change */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.02)", padding: "4px 6px", borderRadius: 4 }}>
        <div style={{ flex: 1, marginRight: 4 }}><HBar pct={chgPct} color={isPos ? CE : c} h={2} /></div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 7, color: "#64748b", fontWeight: 700 }}>ΔOI SHIFT</span>
          <span style={{ fontSize: 10, fontWeight: 900, color: isPos ? CE : c }}>{sg(m.peOIChange)}{fK(m.peOIChange)}</span>
        </div>
        {isPos ? <ArrowUpRight size={10} color={CE} /> : <ArrowDownRight size={10} color={c} />}
      </div>

      {/* Momentum Meter */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#64748b", fontWeight: 700 }}>
          <span>PUT MOMENTUM</span>
          <span style={{ color: MID, fontWeight: 900 }}>{fK(m.peMomentum)}</span>
        </div>
        <HBar pct={momPct} color={MID} h={3} glow />
      </div>

      {/* Volumetric Metrics */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyBetween: "space-between", gap: 6, background: "rgba(0,0,0,0.2)", padding: "6px", borderRadius: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8 }}>
            <span style={{ color: "#64748b" }}>STRENGTH:</span>
            <span style={{ fontWeight: 900, color: c }}>{fK(m.peStr)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8 }}>
            <span style={{ color: "#64748b" }}>PREM DECAY:</span>
            <span style={{ fontWeight: 900, color: m.peAvgPrem >= 0 ? CE : c }}>+{m.peAvgPrem.toFixed(1)}%</span>
          </div>
        </div>
        <VBar pct={Math.min(100, (m.peStr / 20000) * 100)} color={c} w={5} />
        <VBar pct={Math.min(100, Math.abs(m.peAvgPrem) * 10)} color={CE} w={5} />
        <VBar pct={Math.min(100, (m.peVolume / 8e6) * 100)} color={`${c}90`} w={5} />
      </div>

      {/* Signal Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4 }}>
        <Spikes count={6} filled={Math.round((m.peStr / 20000) * 6)} color={c} flip />
        <span style={{ fontSize: 8, color: "#64748b", fontWeight: 800 }}>MOMENTUM</span>
      </div>
    </div>
  );
};

// ── Main Deck Component ──────────────────────────────────────────────────────

const BestSetupDeck: React.FC<Props> = ({ activePage = "NIFTY", spotPrice = 24500, overallScore }) => {
  const [inst, setInst] = useState(activePage);
  const [spot, setSpot] = useState(spotPrice);
  const [m, setM]       = useState<M>(() => mockMetrics(spotPrice, activePage));
  const [loading, setLoading] = useState(false);

  useEffect(() => { setInst(activePage); }, [activePage]);
  useEffect(() => { setSpot(spotPrice); setM(mockMetrics(spotPrice, inst)); }, [spotPrice, inst]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(api(`/api/best-setup-deck?instrument=${inst}`));
      if (r.ok) {
        const d = await r.json();
        if (d.success && d.metrics) {
          setM(d.metrics);
          setLoading(false);
          return;
        }
      }
    } catch {}
    setM(mockMetrics(spot + (Math.random() - 0.5) * 12, inst));
    setLoading(false);
  }, [inst, spot]);

  useEffect(() => { refresh(); }, [inst]);
  useEffect(() => { 
    const id = setInterval(refresh, 10000); 
    return () => clearInterval(id); 
  }, [refresh]);

  const ec = m.bestEntry === "CE" ? CE : m.bestEntry === "PE" ? PE : "#1e293b";
  const bc = BIAS_COLOR[m.trendBias];

  return (
    <div style={{
      width: "100%",
      position: "relative",
      overflow: "hidden",
      userSelect: "none",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      background: "linear-gradient(145deg, #020508 0%, #080d1a 50%, #020508 100%)",
      border: `1px solid ${ec}30`,
      boxShadow: `0 0 35px ${ec}12, 0 4px 25px rgba(0,0,0,0.85)`,
      borderRadius: 12,
      display: "flex",
      flexDirection: "column",
      gap: 0
    }}>
      {/* Top Cyber Glow Beam */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        pointerEvents: "none",
        background: `linear-gradient(90deg, ${CE}, ${MID} 30%, ${bc} 50%, ${MID} 70%, ${PE})`,
        boxShadow: `0 0 15px ${bc}`,
        zIndex: 10
      }} />

      {/* Top Instrument Switch & ATM Control Bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justify: "space-between",
        padding: "6px 12px",
        background: "rgba(0,0,0,0.5)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        zIndex: 2
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <InstrumentSwitch selected={inst} onSelect={setInst} />
          <div style={{ height: 16, width: 1, background: "rgba(255,255,255,0.1)" }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 8, color: "#64748b", fontWeight: 800 }}>ATM:</span>
            <span style={{ fontSize: 13, fontWeight: 900, color: "#f8fafc" }}>{m.atmStrike.toLocaleString("en-IN")}</span>
            <span style={{ fontSize: 8, color: "#64748b", fontWeight: 800 }}>SPOT:</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: ec }}>{m.spot.toLocaleString("en-IN")}</span>
          </div>
        </div>

        {/* Real-time Sentiment Dynamic Badge */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          borderRadius: 6,
          background: m.trendBias?.includes("BULLISH") ? "rgba(0, 255, 136, 0.15)" : m.trendBias?.includes("BEARISH") ? "rgba(244, 63, 94, 0.15)" : "rgba(100, 116, 139, 0.15)",
          border: `1px solid ${bc}50`,
          boxShadow: `0 0 12px ${bc}30`
        }}>
          <Pulse color={bc} ping />
          <span style={{ fontSize: 8, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>NOW SENTIMENT:</span>
          <span style={{ fontSize: 10, fontWeight: 900, color: bc, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {m.trendBias?.includes("BULLISH") ? "🔥 BULLISH" : m.trendBias?.includes("BEARISH") ? "❄️ BEARISH" : "⚡ NEUTRAL"}
          </span>
        </div>

        <button 
          onClick={refresh} 
          style={{ 
            background: "rgba(255,255,255,0.04)", 
            border: "1px solid rgba(255,255,255,0.08)", 
            borderRadius: 4, 
            cursor: "pointer", 
            color: "#94a3b8", 
            padding: "3px 8px",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 9,
            fontWeight: 800
          }}
        >
          <RefreshCw size={9} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          <span>SYNC LIVE</span>
        </button>
      </div>

      {/* Top Executive Overall Summary Bar with Top Score */}
      <OverallSummary m={m} topScore={overallScore ?? m.topScore} />

      {/* Main 2-Column Telemetry Matrix */}
      <div style={{
        position: "relative",
        zIndex: 1,
        display: "grid",
        gridTemplateColumns: "50% 50%",
        height: 250
      }}>
        <CECol m={m} />
        <PECol m={m} />
      </div>

      {/* Bottom Heat Status Bar */}
      <div style={{
        height: 4,
        pointerEvents: "none",
        background: `linear-gradient(90deg, ${CE}60, ${ec}, ${PE}60)`,
        opacity: .8
      }} />
    </div>
  );
};

export default BestSetupDeck;
