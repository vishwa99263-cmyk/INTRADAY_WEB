/**
 * MomentumScoreChart.tsx
 *
 * Premium dark-mode chart box for the LIVE Nifty / Sensex tabs.
 * Renders:
 *   1. A Momentum Score Gauge (0-100) with color zones
 *   2. 5-minute SVG candlestick chart (real-time via socket)
 *   3. 15-minute SVG candlestick chart (real-time via socket)
 *   4. Filter status row (VWAP / ADX / MACD / RSI)
 *   5. BUY CE / WATCH / NO TRADE signal badge
 *
 * Data flows:
 *   - Candles: useChartStream → index-chart-candle socket events
 *   - Momentum: aiAnalysis.momentum from market-update
 *   - Score details: aiAnalysis.aiEngineV2 or derivations from candles
 *
 * Design: Dark, glassmorphism premium UI, micro-animations
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useChartStream, StreamCandle } from "../../hooks/useChartStream";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  instrument: "NIFTY" | "SENSEX" | "BANKNIFTY";
  spotPrice:  number;
  aiAnalysis?: any;
  darkMode?:  boolean;
}

interface CandleBarProps {
  candle: StreamCandle;
  x: number;
  width: number;
  minPrice: number;
  maxPrice: number;
  chartH: number;
  isLast?: boolean;
}

// ── Score calculation from raw candle stream ───────────────────────────────────

interface ScoreState {
  score:       number;
  roc:         number;
  rsiEst:      number;
  macdHist:    number;
  adxEst:      number;
  volRatio:    number;
  aboveVWAP:   boolean;
  vwap:        number;
  adxStrong:   boolean;
  adxBullish:  boolean;
  signal:      "BUY_CE" | "WATCH" | "NO_TRADE";
  label:       string;
  color:       string;
  entryLtp:    number;
  stopLoss:    number;
  target:      number;
}

// Simple client-side RSI (14 period) for display purposes
function calcRSI14(closes: number[]): number {
  if (closes.length < 15) return 50;
  const period = 14;
  const diffs = closes.slice(-period - 1).map((v, i, arr) => i === 0 ? 0 : v - arr[i - 1]).slice(1);
  const gains = diffs.map(d => Math.max(d, 0));
  const losses = diffs.map(d => Math.abs(Math.min(d, 0)));
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

// Simple EMA
function calcEMA(vals: number[], period: number): number[] {
  if (vals.length === 0) return [];
  const alpha = 2 / (period + 1);
  const result: number[] = [vals[0]];
  for (let i = 1; i < vals.length; i++) {
    result.push(vals[i] * alpha + result[i - 1] * (1 - alpha));
  }
  return result;
}

// Session VWAP
function calcSessionVWAP(candles: StreamCandle[]): number {
  if (candles.length === 0) return 0;
  // Detect today's session — reset on same IST calendar date
  let cumTPV = 0, cumVol = 0;
  for (const c of candles) {
    const vol = c.volume > 0 ? c.volume : 1;
    const tp  = (c.high + c.low + c.close) / 3;
    cumTPV += tp * vol;
    cumVol += vol;
  }
  return cumVol > 0 ? cumTPV / cumVol : 0;
}

// ADX simple estimate (directional trend from EMA slope + range expansion)
function estimateADX(candles: StreamCandle[]): { adx: number; bullish: boolean; strong: boolean } {
  if (candles.length < 20) return { adx: 0, bullish: false, strong: false };
  const slice = candles.slice(-20);
  const closes = slice.map(c => c.close);
  const highs  = slice.map(c => c.high);
  const lows   = slice.map(c => c.low);

  // TR-based simple ADX proxy
  const trs: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;

  // DI proxy: compare upward vs downward moves
  let upSum = 0, downSum = 0;
  for (let i = 1; i < slice.length; i++) {
    const up   = highs[i]  - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    if (up > down && up > 0) upSum += up;
    else if (down > up && down > 0) downSum += down;
  }
  const total = upSum + downSum;
  const adxProxy = total > 0 ? (Math.abs(upSum - downSum) / total) * 100 : 0;
  const adx = Math.min(100, Math.round(adxProxy));

  // Trend direction: last close vs 10-period EMA
  const ema10 = calcEMA(closes, 10);
  const bullish = closes[closes.length - 1] > ema10[ema10.length - 1];

  return { adx, bullish, strong: adx >= 25 };
}

function computeScore(candles15m: StreamCandle[], spot: number): ScoreState {
  const closes  = candles15m.map(c => c.close);
  const vols    = candles15m.map(c => c.volume > 0 ? c.volume : 1);

  // ROC (5 periods)
  const rocRaw = closes.length >= 6
    ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
    : 0;
  const roc = Math.max(0, rocRaw);

  // RSI
  const rsiEst = calcRSI14(closes);

  // MACD Histogram estimate (EMA12 - EMA26 delta direction)
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - (ema26[i] ?? v));
  const signal9  = calcEMA(macdLine, 9);
  const macdHist = macdLine.length > 0
    ? (macdLine[macdLine.length - 1] - signal9[signal9.length - 1])
    : 0;

  // ADX
  const { adx: adxEst, bullish: adxBullish, strong: adxStrong } = estimateADX(candles15m);

  // Volume momentum
  const volMA = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
  const volRatio = volMA > 0 ? vols[vols.length - 1] / volMA : 1;

  // VWAP
  const vwap = calcSessionVWAP(candles15m);
  const aboveVWAP = vwap > 0 ? spot > vwap : true;

  // Scoring
  const rocScore  = roc >= 1.5 ? 20 : roc >= 1.0 ? 16 : roc >= 0.5 ? 12 : roc >= 0.2 ? 8 : roc > 0 ? 4 : 0;
  const rsiScore  = rsiEst >= 60 && rsiEst <= 70 ? 20 : rsiEst >= 55 ? 16 : rsiEst >= 50 ? 12 : rsiEst >= 45 ? 4 : 0;
  const macdScore = macdHist > 0 ? (macdHist > 5 ? 20 : macdHist > 2 ? 16 : 12) : 0;
  const adxScore  = adxEst >= 40 && adxBullish ? 25 : adxEst >= 30 && adxBullish ? 20 : adxEst >= 25 && adxBullish ? 15 : adxEst >= 20 ? 5 : 0;
  const volScore  = volRatio >= 3 ? 15 : volRatio >= 2 ? 12 : volRatio >= 1.5 ? 9 : volRatio >= 1.2 ? 6 : volRatio >= 1 ? 3 : 0;

  const score = Math.min(100, Math.round(rocScore + rsiScore + macdScore + adxScore + volScore));

  const allConditions =
    score >= 60 && aboveVWAP && adxStrong && adxBullish && macdHist > 0 &&
    rsiEst >= 50 && rsiEst <= 70;

  const signal: ScoreState["signal"] = allConditions ? "BUY_CE" : score >= 50 ? "WATCH" : "NO_TRADE";

  const label =
    score >= 80 ? "ULTRA STRONG" :
    score >= 70 ? "STRONG" :
    score >= 60 ? "MODERATE" :
    score >= 50 ? "TRANSITION" : "WEAK";

  const color =
    score >= 80 ? "#00ff88" :
    score >= 70 ? "#22c55e" :
    score >= 60 ? "#86efac" :
    score >= 50 ? "#fbbf24" : "#64748b";

  const entryLtp = spot;
  const stopLoss = vwap > 0 ? Math.min(spot - 30, vwap * 0.985) : spot * 0.985;
  const target   = spot * 1.02;

  return {
    score, roc, rsiEst, macdHist, adxEst, volRatio,
    aboveVWAP, vwap, adxStrong, adxBullish,
    signal, label, color,
    entryLtp, stopLoss, target,
  };
}

// ── SVG Candlestick Chart in Stock Chart Style ──────────────────────────────────

const CandleChart: React.FC<{
  candles: StreamCandle[];
  tf: string;
  instrument: string;
  darkMode?: boolean;
}> = ({ candles, tf, instrument, darkMode = true }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Display the last 48 candles for high resolution
  const display = candles.slice(-48);

  const minPrice = useMemo(() =>
    display.length > 0 ? Math.min(...display.map(c => c.low)) * 0.9995 : 0,
    [display]);
  const maxPrice = useMemo(() =>
    display.length > 0 ? Math.max(...display.map(c => c.high)) * 1.0005 : 1,
    [display]);

  // Viewport grid coordinate configuration
  const chartW = 600;
  const chartH = 170;
  const candleAreaW = 540; // 90% width for candles, 10% (60px) for Y-axis price labels
  const candleAreaH = 140; // 140px high chart, 30px for bottom X-axis time labels
  const xAxisY = 153;

  const priceRange = maxPrice - minPrice || 1;
  const toY = (p: number) => candleAreaH - ((p - minPrice) / priceRange) * candleAreaH;

  const barW = display.length > 0 ? (candleAreaW / display.length) * 0.76 : 1;
  const barGap = display.length > 0 ? (candleAreaW / display.length) * 0.24 : 0;

  // Real-time VWAP calculation
  let cumTPV = 0, cumVol = 0;
  const vwapLine = display.map(c => {
    const vol = c.volume > 0 ? c.volume : 1;
    cumTPV += ((c.high + c.low + c.close) / 3) * vol;
    cumVol += vol;
    return cumVol > 0 ? cumTPV / cumVol : c.close;
  });

  const vwapPath = vwapLine
    .map((v, i) => {
      const x = i * (barW + barGap) + barW / 2 + barGap / 2;
      const y = toY(v);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  // Volume calculations for background bars
  const maxVol = display.length > 0 ? Math.max(...display.map(c => c.volume)) : 1;

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  return (
    <div className={`relative w-full rounded-lg overflow-hidden border transition-all duration-300 ${
      darkMode 
        ? "bg-slate-950/60 border-slate-900/80 shadow-[inset_0_1.5px_4px_rgba(0,0,0,0.5)]" 
        : "bg-slate-50 border-slate-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
    }`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-2.5 py-1 border-b select-none ${
        darkMode ? "border-slate-900/60 bg-slate-950/45" : "border-slate-200 bg-slate-100/40"
      }`}>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className={`text-[9.5px] font-black uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
            {instrument} · {tf} CHART
          </span>
        </div>
        <span className={`text-[11px] font-mono font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
          {display.length > 0
            ? `${display[display.length - 1].close.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
            : "—"}
        </span>
      </div>

      {/* SVG Stock Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartW} ${chartH}`}
        preserveAspectRatio="none"
        className="w-full h-auto block"
        style={{ height: `${chartH}px` }}
      >
        {/* Vertical divider separating candle canvas and Y-Axis */}
        <line
          x1={candleAreaW}
          y1={0}
          x2={candleAreaW}
          y2={candleAreaH}
          stroke={darkMode ? "rgba(148, 163, 184, 0.12)" : "rgba(71, 85, 105, 0.12)"}
          strokeWidth={0.8}
        />

        {/* Horizontal X-Axis divider separating chart canvas and Timeline */}
        <line
          x1={0}
          y1={candleAreaH}
          x2={chartW}
          y2={candleAreaH}
          stroke={darkMode ? "rgba(148, 163, 184, 0.12)" : "rgba(71, 85, 105, 0.12)"}
          strokeWidth={0.8}
        />

        {/* Horizontal grid lines & Y-Axis labels */}
        {[0.25, 0.5, 0.75].map(lvl => {
          const y = lvl * candleAreaH;
          const price = maxPrice - lvl * priceRange;
          return (
            <g key={lvl}>
              {/* Grid Line */}
              <line
                x1={0}
                y1={y}
                x2={candleAreaW}
                y2={y}
                stroke={darkMode ? "rgba(148, 163, 184, 0.05)" : "rgba(71, 85, 105, 0.07)"}
                strokeWidth={0.5}
                strokeDasharray="3,3"
              />
              {/* Axis Label */}
              <text
                x={candleAreaW + 5}
                y={y + 3}
                fill={darkMode ? "#64748b" : "#475569"}
                className="font-mono font-bold"
                style={{ fontSize: "8px" }}
              >
                {price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </text>
            </g>
          );
        })}

        {/* Vertical grid lines & X-Axis timeline labels */}
        {display.map((c, i) => {
          const step = Math.max(4, Math.floor(display.length / 5));
          if (i % step !== 0) return null;
          const x = i * (barW + barGap) + barGap / 2;
          const midX = x + barW / 2;
          return (
            <g key={`grid-v-${c.time}`}>
              {/* Vertical Grid Line */}
              <line
                x1={midX}
                y1={0}
                x2={midX}
                y2={candleAreaH}
                stroke={darkMode ? "rgba(148, 163, 184, 0.04)" : "rgba(71, 85, 105, 0.05)"}
                strokeWidth={0.5}
                strokeDasharray="3,3"
              />
              {/* X-axis time label */}
              <text
                x={midX}
                y={xAxisY + 3}
                textAnchor="middle"
                fill={darkMode ? "#64748b" : "#475569"}
                className="font-mono font-bold"
                style={{ fontSize: "8px" }}
              >
                {formatTime(c.time)}
              </text>
            </g>
          );
        })}

        {/* Semi-transparent volume bars at the base of the chart */}
        {display.map((c, i) => {
          const x = i * (barW + barGap) + barGap / 2;
          const isBull = c.close >= c.open;
          const volHeight = maxVol > 0 ? (c.volume / maxVol) * 22 : 0;
          const volY = candleAreaH - volHeight;

          return (
            <rect
              key={`vol-${c.time}`}
              x={x}
              y={volY}
              width={barW}
              height={volHeight}
              fill={isBull ? "rgba(16, 185, 129, 0.12)" : "rgba(244, 63, 94, 0.12)"}
              rx={0.5}
            />
          );
        })}

        {/* Candles (Wicks & Bodies) */}
        {display.map((c, i) => {
          const x = i * (barW + barGap) + barGap / 2;
          const midX = x + barW / 2;
          const isBull = c.close >= c.open;
          const color = isBull ? "#10b981" : "#f43f5e";
          const bodyTop = toY(Math.max(c.open, c.close));
          const bodyBottom = toY(Math.min(c.open, c.close));
          const bodyH = Math.max(1.5, bodyBottom - bodyTop);
          const wickTop = toY(c.high);
          const wickBottom = toY(c.low);
          const isLast = i === display.length - 1;

          return (
            <g key={c.time}>
              {/* Wick */}
              <line
                x1={midX}
                y1={wickTop}
                x2={midX}
                y2={wickBottom}
                stroke={color}
                strokeWidth={1}
                opacity={0.8}
              />
              {/* Body */}
              <rect
                x={x}
                y={bodyTop}
                width={barW}
                height={bodyH}
                fill={color}
                stroke={color}
                strokeWidth={0.5}
                rx={0.5}
                style={isLast ? { filter: `drop-shadow(0 0 3px ${color}80)` } : {}}
              />
            </g>
          );
        })}

        {/* VWAP Line Overlay */}
        {vwapPath && (
          <path
            d={vwapPath}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1}
            strokeDasharray="2,1.5"
            opacity={0.8}
          />
        )}

        {/* Real-time Last Price Tracker Tag */}
        {display.length > 0 && (() => {
          const lastCandle = display[display.length - 1];
          const lastY = toY(lastCandle.close);
          const isBull = lastCandle.close >= lastCandle.open;
          const color = isBull ? "#10b981" : "#f43f5e";
          return (
            <g>
              {/* Horizontal line tracking last price */}
              <line
                x1={0}
                y1={lastY}
                x2={candleAreaW}
                y2={lastY}
                stroke={color}
                strokeWidth={0.8}
                strokeDasharray="2,2"
                opacity={0.7}
              />
              {/* Price box on the Y-Axis */}
              <rect
                x={candleAreaW + 2}
                y={lastY - 6.5}
                width={55}
                height={13}
                rx={2}
                fill={color}
              />
              <text
                x={candleAreaW + 29.5}
                y={lastY + 3.5}
                textAnchor="middle"
                fill="#ffffff"
                className="font-mono font-black"
                style={{ fontSize: "8.5px" }}
              >
                {lastCandle.close.toFixed(1)}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* VWAP indicator watermark label */}
      <div className="absolute bottom-6 left-2 select-none pointer-events-none opacity-50">
        <span className="text-[7.5px] text-amber-400 font-black font-mono tracking-wider">⚡ VWAP</span>
      </div>
    </div>
  );
};

// ── Momentum Score Gauge ───────────────────────────────────────────────────────

const ScoreGauge: React.FC<{ score: number; color: string; label: string }> = ({
  score, color, label,
}) => {
  const pct = Math.min(100, Math.max(0, score));

  // SVG arc gauge
  const R = 52;
  const cx = 65, cy = 72;
  const startAngle = -210;
  const endAngle   = 30;
  const totalArc   = endAngle - startAngle; // 240°
  const fillAngle  = startAngle + (pct / 100) * totalArc;

  function polarToXY(angle: number, r: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arc(startA: number, endA: number, r: number, large: boolean) {
    const s = polarToXY(startA, r);
    const e = polarToXY(endA, r);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large ? 1 : 0} 1 ${e.x} ${e.y}`;
  }

  const trackPath = arc(startAngle, endAngle, R, true);
  const fillPath  = arc(startAngle, fillAngle, R, pct > 50);

  // Zone coloring segments
  const zones = [
    { from: 0,  to: 50, color: "#475569" },
    { from: 50, to: 60, color: "#f59e0b" },
    { from: 60, to: 70, color: "#86efac" },
    { from: 70, to: 80, color: "#22c55e" },
    { from: 80, to: 100, color: "#00ff88" },
  ];

  const zoneArcs = zones.map(z => {
    const sA = startAngle + (z.from / 100) * totalArc;
    const eA = startAngle + (z.to / 100) * totalArc;
    return { path: arc(sA, eA, R, (z.to - z.from) > 50), color: z.color };
  });

  return (
    <div className="flex flex-col items-center w-full">
      <svg viewBox="0 0 130 90" className="w-full" style={{ maxWidth: 160 }}>
        {/* Zone tracks */}
        {zoneArcs.map((z, i) => (
          <path key={i} d={z.path} fill="none" stroke={z.color} strokeWidth={6} opacity={0.25} strokeLinecap="round" />
        ))}

        {/* Track background */}
        <path d={trackPath} fill="none" stroke="#1e293b" strokeWidth={8} strokeLinecap="round" />

        {/* Fill */}
        <path
          d={fillPath}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 6px ${color}80)`,
            transition: "d 0.6s ease",
          }}
        />

        {/* Score text */}
        <text x={cx} y={cy - 6} textAnchor="middle" className="font-black"
          style={{ fontSize: 29, fontWeight: 900, fontFamily: "monospace", fill: color }}>
          {pct}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle"
          style={{ fontSize: 9, fontWeight: 700, fill: "#64748b", fontFamily: "sans-serif", letterSpacing: 2, textTransform: "uppercase" }}>
          /100
        </text>
        <text x={cx} y={cy + 26} textAnchor="middle"
          style={{ fontSize: 10, fontWeight: 800, fill: color, fontFamily: "sans-serif", letterSpacing: 1.5, textTransform: "uppercase" }}>
          {label}
        </text>

        {/* Zone ticks */}
        {[0, 50, 60, 70, 80, 100].map(v => {
          const a = startAngle + (v / 100) * totalArc;
          const outer = polarToXY(a, R + 6);
          const inner = polarToXY(a, R - 2);
          return (
            <line key={v}
              x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
              stroke="#475569" strokeWidth={1}
            />
          );
        })}
      </svg>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────

const MomentumScoreChart: React.FC<Props> = ({ instrument, spotPrice, aiAnalysis }) => {
  const [candles5m,  setCandles5m]  = useState<StreamCandle[]>([]);
  const [candles15m, setCandles15m] = useState<StreamCandle[]>([]);
  const [activeTf, setActiveTf]     = useState<"5m" | "15m">("5m");

  // Feed real-time candles for 5m
  const handle5mCandle = useCallback((c: StreamCandle) => {
    setCandles5m(prev => {
      const arr = [...prev];
      const last = arr[arr.length - 1];
      if (last && last.time === c.time) {
        arr[arr.length - 1] = c;
      } else {
        arr.push(c);
        if (arr.length > 120) arr.shift();
      }
      return arr;
    });
  }, []);

  const handle15mCandle = useCallback((c: StreamCandle) => {
    setCandles15m(prev => {
      const arr = [...prev];
      const last = arr[arr.length - 1];
      if (last && last.time === c.time) {
        arr[arr.length - 1] = c;
      } else {
        arr.push(c);
        if (arr.length > 60) arr.shift();
      }
      return arr;
    });
  }, []);

  const handleInit = useCallback((data: Record<string, Record<string, StreamCandle[]>>) => {
    const inst = instrument;
    if (data[inst]) {
      if (data[inst]["5m"])  setCandles5m(data[inst]["5m"].slice(-120));
      if (data[inst]["15m"]) setCandles15m(data[inst]["15m"].slice(-60));
    }
  }, [instrument]);

  // 5m stream
  useChartStream({
    instrument,
    activeTf: "5m",
    onCandle: handle5mCandle,
    onInit: handleInit,
  });

  // 15m stream
  useChartStream({
    instrument,
    activeTf: "15m",
    onCandle: handle15mCandle,
  });

  // Compute momentum score from 15m candles
  const scoreState = useMemo(() =>
    computeScore(candles15m, spotPrice),
    [candles15m, spotPrice]
  );

  const {
    score, color, label, signal, rsiEst, macdHist, adxEst,
    aboveVWAP, vwap, adxStrong, adxBullish, volRatio,
    entryLtp, stopLoss, target,
  } = scoreState;

  // Signal styling
  const signalStyle = {
    BUY_CE:   "bg-emerald-950/80 border-emerald-500 text-emerald-400 shadow-[0_0_20px_rgba(34,197,94,0.35)] animate-pulse",
    WATCH:    "bg-amber-950/60 border-amber-500/60 text-amber-400",
    NO_TRADE: "bg-slate-900 border-slate-700 text-slate-400",
  }[signal];

  const signalIcon = {
    BUY_CE:   "⚡ BUY CE NOW",
    WATCH:    "👁 WATCH CLOSELY",
    NO_TRADE: "⏸ NO TRADE",
  }[signal];

  return (
    <div className="relative flex flex-col gap-2 p-3 rounded-2xl bg-[#040812] border border-slate-800/80 shadow-[0_0_30px_rgba(20,184,166,0.12)] overflow-hidden select-none">
      {/* Neon accent line */}
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-teal-500 via-indigo-500 to-purple-500" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse shadow-[0_0_6px_rgba(45,212,191,0.8)]" />
          <span className="text-[12px] font-black uppercase tracking-widest text-teal-400">
            {instrument} · Momentum Score
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-400 font-bold tabular-nums">
          15m · CE Only
        </span>
      </div>

      {/* Gauge + Breakdown row */}
      <div className="flex items-start gap-3">
        {/* Gauge */}
        <div className="w-[130px] flex-shrink-0">
          <ScoreGauge score={score} color={color} label={label} />
        </div>

        {/* Breakdown */}
        <div className="flex-1 flex flex-col gap-1 mt-1">
          {[
            { name: "ROC",    val: scoreState.roc,     max: 20, raw: `${scoreState.roc.toFixed(1)}%` },
            { name: "RSI",    val: rsiEst,              max: 100, raw: `${rsiEst}` },
            { name: "MACD",   val: macdHist,            max: 30, raw: `${macdHist.toFixed(1)}` },
            { name: "ADX",    val: adxEst,              max: 100, raw: `${adxEst.toFixed(0)}` },
            { name: "VOL",    val: (volRatio - 1) * 20, max: 40, raw: `${volRatio.toFixed(1)}x` },
          ].map(({ name, val, max, raw }) => (
            <div key={name} className="flex items-center gap-1.5">
              <span className="text-[10.5px] text-slate-400 font-extrabold w-10 text-right">{name}</span>
              <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, (val / max) * 100))}%`,
                    background: val >= 0 ? color : "#f43f5e",
                  }}
                />
              </div>
              <span className="text-[10.5px] font-bold font-mono text-slate-200 w-10">{raw}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filter Status Row */}
      <div className="grid grid-cols-4 gap-1">
        {[
          { label: "VWAP",  pass: aboveVWAP,  tip: `${aboveVWAP ? ">" : "<"} ${Math.round(vwap)}` },
          { label: "ADX",   pass: adxStrong,  tip: `${adxEst.toFixed(0)} ${adxStrong ? "✓" : "✗"}` },
          { label: "DI+>-", pass: adxBullish, tip: adxBullish ? "Bullish" : "Bearish" },
          { label: "RSI",   pass: rsiEst >= 50 && rsiEst <= 70, tip: `${rsiEst}` },
        ].map(({ label, pass, tip }) => (
          <div
            key={label}
            title={tip}
            className={`flex flex-col items-center p-1 rounded-lg border text-center transition-all cursor-help ${
              pass
                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-400"
                : "bg-rose-950/30 border-rose-500/20 text-rose-400"
            }`}
          >
            <span className="text-[8.5px] font-black uppercase tracking-wider">{label}</span>
            <span className="text-[13px] font-black mt-0.5">{pass ? "✓" : "✗"}</span>
            <span className="text-[8px] font-mono font-bold text-slate-300 mt-0.5 truncate w-full text-center">{tip}</span>
          </div>
        ))}
      </div>

      {/* Signal Banner */}
      <div className={`flex items-center justify-center gap-2 p-2 rounded-xl border-2 font-black text-[14px] uppercase tracking-wider transition-all ${signalStyle}`}>
        {signalIcon}
      </div>

      {/* Entry Setup (shown only on BUY CE) */}
      {signal === "BUY_CE" && (
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            { label: "Entry", val: Math.round(entryLtp).toLocaleString("en-IN"), color: "text-white" },
            { label: "SL", val: Math.round(stopLoss).toLocaleString("en-IN"), color: "text-rose-400" },
            { label: "Target", val: Math.round(target).toLocaleString("en-IN"), color: "text-emerald-400" },
          ].map(({ label, val, color }) => (
            <div key={label} className="flex flex-col items-center p-1.5 rounded-lg bg-black/40 border border-slate-800">
              <span className="text-[9px] uppercase text-slate-500 font-bold">{label}</span>
              <span className={`text-[13px] font-black font-mono mt-0.5 ${color}`}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Candle Charts Section */}
      <div>
        {/* Timeframe Tabs */}
        <div className="flex gap-1 mb-1.5">
          {(["5m", "15m"] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setActiveTf(tf)}
              className={`px-2.5 py-0.5 rounded text-[9px] font-black uppercase transition-all cursor-pointer ${
                activeTf === tf
                  ? "bg-teal-500/20 border border-teal-500/50 text-teal-400"
                  : "bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300"
              }`}
            >
              {tf}
            </button>
          ))}
          <span className="ml-auto text-[7.5px] text-slate-600 font-mono self-center">CANDLE CHART</span>
        </div>

        {/* Chart */}
        <CandleChart
          candles={activeTf === "5m" ? candles5m : candles15m}
          tf={activeTf}
          instrument={instrument}
          height={130}
          maxBars={activeTf === "5m" ? 48 : 32}
        />
      </div>

      {/* Score Zone Legend */}
      <div className="flex items-center gap-1 justify-center">
        {[
          { range: "<50", color: "#64748b", label: "No Trade" },
          { range: "50-60", color: "#f59e0b", label: "Watch" },
          { range: "60-70", color: "#86efac", label: "Potential" },
          { range: "≥70", color: "#22c55e", label: "BUY CE" },
          { range: "≥80", color: "#00ff88", label: "Ultra" },
        ].map(z => (
          <div key={z.range} className="flex items-center gap-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: z.color }} />
            <span className="text-[6.5px] text-slate-500 font-mono">{z.range}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MomentumScoreChart;
