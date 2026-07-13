/**
 * ProLiveChart.tsx
 *
 * Professional live candlestick chart powered by lightweight-charts v5.
 *
 * Features:
 *  ✅ Real-time candle updates via useChartStream + spotPrice tick
 *  ✅ Interactive time-scale (horizontal drag = zoom) & price-scale (vertical drag = stretch)
 *  ✅ Blue candle logic — gap-up >50 pts OR missing data candle
 *  ✅ Fullscreen toggle
 *  ✅ Multi-timeframe selector (1m, 3m, 5m, 15m, 30m, 1h)
 *  ✅ Dynamic price color (green tick-up / red tick-down)
 *  ✅ Volume histogram pane
 *  ✅ VWAP line overlay
 *  ✅ Dark / light theme
 *  ✅ Session High / Low dashed price lines
 *  ✅ Current-price blinking marker
 *
 * lightweight-charts v5 API:
 *   chart.addSeries(CandlestickSeries, options)
 *   chart.addSeries(HistogramSeries, options)
 *   chart.addSeries(LineSeries, options)
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
} from "lightweight-charts";
import { useChartStream, type StreamCandle } from "../../hooks/useChartStream";
import {
  Maximize2,
  Minimize2,
  Activity,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProLiveChartProps {
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX";
  spotPrice: number;
  darkMode?: boolean;
}

type TF = "1m" | "3m" | "5m" | "15m" | "30m" | "1h";

const TIMEFRAMES: TF[] = ["1m", "3m", "5m", "15m", "30m", "1h"];

// ─── Theme ────────────────────────────────────────────────────────────────────

function buildTheme(dark: boolean) {
  return {
    bg:         dark ? "#0a0e1a" : "#ffffff",
    surface:    dark ? "#0d1117" : "#f8fafc",
    surfaceAlt: dark ? "#111827" : "#f1f5f9",
    border:     dark ? "#1e2736" : "#e2e8f0",
    text:       dark ? "#e2e8f0" : "#1e293b",
    textMuted:  dark ? "#64748b" : "#94a3b8",
    grid:       dark ? "#1e2736" : "#f1f5f9",
    crosshair:  dark ? "#4b5563" : "#cbd5e1",
    accent:     "#6366f1",
    vwap:       "#f59e0b",
    up:         "#10b981",
    down:       "#ef4444",
    blue:       "#2563eb",
    blueWick:   "#3b82f6",
  };
}

// ─── Color constants ──────────────────────────────────────────────────────────

const GREEN = "#10b981";
const RED   = "#ef4444";
const BLUE  = "#2563eb";
const BLUE_WICK = "#3b82f6";

// ─── Instrument meta ──────────────────────────────────────────────────────────

const INST_META: Record<string, { label: string; accent: string }> = {
  NIFTY:     { label: "NIFTY 50",   accent: "#10b981" },
  BANKNIFTY: { label: "BANK NIFTY", accent: "#8b5cf6" },
  SENSEX:    { label: "BSE SENSEX", accent: "#f59e0b" },
};

// ─── VWAP computation ─────────────────────────────────────────────────────────

function computeVWAP(candles: StreamCandle[]): LineData<Time>[] {
  let cumTPV = 0;
  let cumVol = 0;
  return candles.map((c) => {
    const vol = c.volume > 0 ? c.volume : 1;
    const tp  = (c.high + c.low + c.close) / 3;
    cumTPV += tp * vol;
    cumVol += vol;
    return { time: c.time as Time, value: cumTPV / cumVol };
  });
}

// ─── Blue-candle conversion ───────────────────────────────────────────────────

function toCandleData(candles: StreamCandle[]): CandlestickData<Time>[] {
  return candles.map((c, i) => {
    const prev = i > 0 ? candles[i - 1] : null;
    const isGapUp   = prev !== null && c.open - prev.close > 50;
    const isMissing = !c.open || !c.close || !c.high || !c.low;
    const isBlue    = isGapUp || isMissing;

    return {
      time:        c.time as Time,
      open:        c.open,
      high:        c.high,
      low:         c.low,
      close:       c.close,
      color:       isBlue ? BLUE  : c.close >= c.open ? GREEN : RED,
      wickColor:   isBlue ? BLUE_WICK : c.close >= c.open ? GREEN : RED,
      borderColor: isBlue ? BLUE_WICK : c.close >= c.open ? GREEN : RED,
    };
  });
}

function toVolumeData(candles: StreamCandle[]): HistogramData<Time>[] {
  return candles.map((c) => ({
    time:  c.time as Time,
    value: c.volume,
    color: c.close >= c.open
      ? "rgba(16,185,129,0.25)"
      : "rgba(239,68,68,0.25)",
  }));
}

// ─── REST history fetch ───────────────────────────────────────────────────────

async function fetchHistory(instrument: string, tf: string): Promise<StreamCandle[]> {
  try {
    const base =
      typeof window !== "undefined" &&
      (window.location.port === "5173" || window.location.protocol === "file:")
        ? "http://localhost:3000"
        : "";
    const res = await fetch(`${base}/api/index-chart/history?instrument=${instrument}&tf=${tf}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body?.candles) return [];
    return (body.candles as any[])
      .map((c: any) => ({
        time:   c.time   ?? c[0],
        open:   c.open   ?? c[1],
        high:   c.high   ?? c[2],
        low:    c.low    ?? c[3],
        close:  c.close  ?? c[4],
        volume: c.volume ?? c[5] ?? 0,
      }))
      .sort((a: StreamCandle, b: StreamCandle) => a.time - b.time);
  } catch {
    return [];
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

const ProLiveChart: React.FC<ProLiveChartProps> = ({
  instrument,
  spotPrice,
  darkMode = true,
}) => {
  const theme = useMemo(() => buildTheme(darkMode), [darkMode]);
  const meta  = INST_META[instrument] ?? INST_META.NIFTY;

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTf,     setActiveTf]     = useState<TF>("5m");
  const [candles,      setCandles]      = useState<StreamCandle[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [connected,    setConnected]    = useState(false);
  const [priceDir,     setPriceDir]     = useState<"up" | "down" | "flat">("flat");

  const prevSpotRef = useRef<number>(0);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef      = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<IChartApi | null>(null);
  const candleSeriesRef   = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef   = useRef<ISeriesApi<"Histogram">   | null>(null);
  const vwapSeriesRef     = useRef<ISeriesApi<"Line">        | null>(null);
  const hlHighSeriesRef   = useRef<ISeriesApi<"Line">        | null>(null);
  const hlLowSeriesRef    = useRef<ISeriesApi<"Line">        | null>(null);
  const priceLineRef      = useRef<any>(null);

  // ── Price direction flash ──────────────────────────────────────────────────
  useEffect(() => {
    if (spotPrice === 0 || prevSpotRef.current === 0) {
      prevSpotRef.current = spotPrice;
      return;
    }
    if (spotPrice > prevSpotRef.current)      setPriceDir("up");
    else if (spotPrice < prevSpotRef.current) setPriceDir("down");
    else                                       setPriceDir("flat");
    prevSpotRef.current = spotPrice;
    const t = setTimeout(() => setPriceDir("flat"), 600);
    return () => clearTimeout(t);
  }, [spotPrice]);

  // ── Candle history load ────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoading(true);
    setCandles([]);
    const data = await fetchHistory(instrument, activeTf);
    setCandles(data);
    setLoading(false);
  }, [instrument, activeTf]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Chart stream ───────────────────────────────────────────────────────────
  const { connected: streamConnected } = useChartStream({
    instrument,
    activeTf,
    onCandle: useCallback((candle: StreamCandle) => {
      setCandles((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.time === candle.time) {
          return [...prev.slice(0, -1), candle];
        }
        return [...prev, candle].slice(-500);
      });
    }, []),
    onInit: useCallback(
      (data: Record<string, Record<string, StreamCandle[]>>) => {
        const tfData = data[instrument]?.[activeTf];
        if (tfData && tfData.length > 0) {
          setCandles(tfData.sort((a, b) => a.time - b.time));
          setLoading(false);
        }
      },
      [instrument, activeTf]
    ),
  });

  useEffect(() => { setConnected(streamConnected); }, [streamConnected]);

  // ── Chart init (recreate on theme/darkMode change only) ────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Destroy previous
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current    = null;
      candleSeriesRef.current  = null;
      volumeSeriesRef.current  = null;
      vwapSeriesRef.current    = null;
      hlHighSeriesRef.current  = null;
      hlLowSeriesRef.current   = null;
    }

    const chart = createChart(container, {
      layout: {
        background:  { type: ColorType.Solid, color: theme.bg },
        textColor:   theme.textMuted,
        fontFamily:  "'Inter', 'JetBrains Mono', monospace",
        fontSize:    11,
      },
      grid: {
        vertLines: { color: theme.grid, style: LineStyle.Dotted },
        horzLines: { color: theme.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.crosshair, labelBackgroundColor: theme.accent },
        horzLine: { color: theme.crosshair, labelBackgroundColor: theme.accent },
      },
      rightPriceScale: {
        borderColor: theme.border,
        mode:        PriceScaleMode.Normal,
        autoScale:   true,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor:    theme.border,
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    12,
        barSpacing:     10,
        fixLeftEdge:    false,
      },
      handleScroll: {
        mouseWheel:       true,
        pressedMouseMove: true,
        horzTouchDrag:    true,
        vertTouchDrag:    false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch:      true,
      },
      width:  container.clientWidth,
      height: container.clientHeight,
    });

    chartRef.current = chart;

    // ── Candlestick series (v5 API) ────────────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:       GREEN,
      downColor:     RED,
      borderUpColor: GREEN,
      borderDownColor: RED,
      wickUpColor:   GREEN,
      wickDownColor: RED,
      priceLineVisible: false,
    });
    candleSeriesRef.current = candleSeries;

    // ── Volume histogram (v5 API) ──────────────────────────────────────────
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat:  { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.80, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // ── VWAP line (v5 API) ────────────────────────────────────────────────
    const vwapSeries = chart.addSeries(LineSeries, {
      color:                 theme.vwap,
      lineWidth:             1,
      lineStyle:             LineStyle.Dashed,
      priceLineVisible:      false,
      lastValueVisible:      true,
      title:                 "VWAP",
      crosshairMarkerVisible: false,
    });
    vwapSeriesRef.current = vwapSeries;

    // ── Session High line ──────────────────────────────────────────────────
    const hlHigh = chart.addSeries(LineSeries, {
      color:                 "rgba(16,185,129,0.45)",
      lineWidth:             1,
      lineStyle:             LineStyle.Dashed,
      priceLineVisible:      false,
      lastValueVisible:      false,
      crosshairMarkerVisible: false,
      title:                 "S.HIGH",
    });
    hlHighSeriesRef.current = hlHigh;

    // ── Session Low line ───────────────────────────────────────────────────
    const hlLow = chart.addSeries(LineSeries, {
      color:                 "rgba(239,68,68,0.45)",
      lineWidth:             1,
      lineStyle:             LineStyle.Dashed,
      priceLineVisible:      false,
      lastValueVisible:      false,
      crosshairMarkerVisible: false,
      title:                 "S.LOW",
    });
    hlLowSeriesRef.current = hlLow;

    // ── Auto-resize ────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({
          width:  container.clientWidth,
          height: container.clientHeight,
        });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current    = null;
      candleSeriesRef.current  = null;
      volumeSeriesRef.current  = null;
      vwapSeriesRef.current    = null;
      hlHighSeriesRef.current  = null;
      hlLowSeriesRef.current   = null;
    };
  }, [darkMode, theme]); // Recreate only on theme change

  // ── Push candle data to chart ──────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const candleData = toCandleData(candles);
    const volData    = toVolumeData(candles);
    const vwapData   = computeVWAP(candles);

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current?.setData(volData);
    vwapSeriesRef.current?.setData(vwapData);

    // Session High / Low dashed lines
    const sessionHigh = Math.max(...candles.map((c) => c.high));
    const sessionLow  = Math.min(...candles.map((c) => c.low));
    const first = candles[0].time as Time;
    const last  = candles[candles.length - 1].time as Time;

    hlHighSeriesRef.current?.setData([
      { time: first, value: sessionHigh },
      { time: last,  value: sessionHigh },
    ]);
    hlLowSeriesRef.current?.setData([
      { time: first, value: sessionLow },
      { time: last,  value: sessionLow },
    ]);

    // Scroll to latest
    chartRef.current?.timeScale().scrollToRealTime();
  }, [candles]);

  // ── Real-time spot tick → update last candle + price line ─────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || spotPrice <= 0 || candles.length === 0) return;

    const last = candles[candles.length - 1];
    if (!last) return;

    const isBull = spotPrice >= last.open;
    const updated: CandlestickData<Time> = {
      time:        last.time as Time,
      open:        last.open,
      high:        Math.max(last.high, spotPrice),
      low:         Math.min(last.low,  spotPrice),
      close:       spotPrice,
      color:       isBull ? GREEN : RED,
      wickColor:   isBull ? GREEN : RED,
      borderColor: isBull ? GREEN : RED,
    };

    try { candleSeriesRef.current.update(updated); } catch { /* chart rebuilding */ }

    // Remove old price line
    if (priceLineRef.current) {
      try { candleSeriesRef.current.removePriceLine(priceLineRef.current); } catch { /* ignore */ }
    }
    // Draw new current price line
    priceLineRef.current = candleSeriesRef.current.createPriceLine({
      price:              spotPrice,
      color:              isBull ? GREEN : RED,
      lineWidth:          1,
      lineStyle:          LineStyle.Solid,
      axisLabelVisible:   true,
      title: `▶ ${spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    });
  }, [spotPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fullscreen ESC ─────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && isFullscreen) setIsFullscreen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isFullscreen]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const lastCandle  = candles[candles.length - 1];
  const openPrice   = lastCandle?.open ?? 0;
  const change      = spotPrice > 0 && openPrice > 0 ? spotPrice - openPrice : 0;
  const changePct   = openPrice > 0 ? (change / openPrice) * 100 : 0;
  const sessionHigh = candles.length > 0 ? Math.max(...candles.map((c) => c.high)) : 0;
  const sessionLow  = candles.length > 0 ? Math.min(...candles.map((c) => c.low))  : 0;

  const priceColor =
    priceDir === "up"   ? GREEN :
    priceDir === "down" ? RED   :
    change >= 0         ? GREEN : RED;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={isFullscreen ? "fixed inset-0 z-[9999] flex flex-col" : "flex flex-col w-full h-full min-h-0"}
      style={{ background: theme.bg, fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Header Row 1: Symbol + Price + Controls ──────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-2 flex-wrap gap-2"
        style={{ background: theme.surface, borderBottom: `1px solid ${theme.border}` }}
      >
        {/* Left: instrument info + live dot */}
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ background: connected ? "#10b981" : "#ef4444" }}
            />
            <span
              className="relative inline-flex rounded-full h-2.5 w-2.5"
              style={{ background: connected ? "#10b981" : "#ef4444" }}
            />
          </span>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: meta.accent }}>
              {meta.label}
            </div>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: theme.textMuted }}>
              {connected ? "LIVE" : "CONNECTING..."} · {activeTf.toUpperCase()} CHART
            </div>
          </div>
        </div>

        {/* Center: Large price display */}
        <div className="flex items-end gap-3">
          <div
            className="font-black tabular-nums transition-colors duration-300"
            style={{
              fontSize: "clamp(28px, 4vw, 44px)",
              lineHeight: 1,
              color: priceColor,
              textShadow: priceDir !== "flat" ? `0 0 20px ${priceColor}55` : "none",
              letterSpacing: "-0.02em",
            }}
          >
            {spotPrice > 0
              ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : "—"}
          </div>
          <div className="flex flex-col items-start pb-1">
            <span className="text-xs font-bold tabular-nums" style={{ color: change >= 0 ? GREEN : RED }}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] font-semibold" style={{ color: change >= 0 ? GREEN : RED }}>
              ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Right: Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={loadHistory}
            title="Reload history"
            className="p-1.5 rounded-lg transition-colors"
            style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, color: theme.textMuted }}
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            className="p-1.5 rounded-lg transition-colors"
            style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, color: theme.textMuted }}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* ── Header Row 2: Stats + Timeframe selector ──────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 flex-wrap gap-3"
        style={{ background: theme.surface, borderBottom: `1px solid ${theme.border}` }}
      >
        {/* Session stats */}
        <div className="flex items-center gap-4 text-[10px] font-semibold">
          <span style={{ color: theme.textMuted }}>
            OPEN <span style={{ color: theme.text }}>
              {openPrice > 0 ? openPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"}
            </span>
          </span>
          <span style={{ color: theme.textMuted }}>
            H <span style={{ color: GREEN }}>
              {sessionHigh > 0 ? sessionHigh.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"}
            </span>
          </span>
          <span style={{ color: theme.textMuted }}>
            L <span style={{ color: RED }}>
              {sessionLow > 0 ? sessionLow.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"}
            </span>
          </span>
          <span style={{ color: theme.textMuted }}>
            RANGE <span style={{ color: "#f59e0b" }}>
              {sessionHigh > 0 && sessionLow > 0
                ? (sessionHigh - sessionLow).toLocaleString("en-IN", { minimumFractionDigits: 2 })
                : "—"}
            </span>
          </span>
        </div>

        {/* Timeframe pills */}
        <div
          className="flex items-center rounded-lg overflow-hidden"
          style={{ border: `1px solid ${theme.border}` }}
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setActiveTf(tf)}
              className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-all"
              style={{
                background:  activeTf === tf ? meta.accent : "transparent",
                color:       activeTf === tf ? "#fff" : theme.textMuted,
                borderRight: tf !== "1h" ? `1px solid ${theme.border}` : "none",
              }}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* ── Legend strip ─────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-5 px-4 py-1 text-[9px] font-semibold uppercase tracking-wider"
        style={{ background: theme.surface, borderBottom: `1px solid ${theme.border}`, color: theme.textMuted }}
      >
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm inline-block" style={{ background: GREEN }} />
          Bullish
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm inline-block" style={{ background: RED }} />
          Bearish
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-sm inline-block" style={{ background: BLUE }} />
          Gap-Up / Missing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 inline-block" style={{ borderTop: "2px dashed #f59e0b" }} />
          VWAP
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 inline-block" style={{ borderTop: "1px dashed rgba(16,185,129,0.6)" }} />
          S.High
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 inline-block" style={{ borderTop: "1px dashed rgba(239,68,68,0.6)" }} />
          S.Low
        </span>
      </div>

      {/* ── Chart canvas ──────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {/* Loading overlay */}
        {loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-20"
            style={{ background: theme.bg }}
          >
            <Activity size={32} className="animate-pulse mb-3" style={{ color: meta.accent }} />
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: theme.textMuted }}>
              Loading {meta.label} · {activeTf.toUpperCase()}...
            </div>
          </div>
        )}

        {/* Chart mount — no pointer-events blocking so axes remain draggable */}
        <div
          ref={containerRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-1 text-[9px]"
        style={{ background: theme.surface, borderTop: `1px solid ${theme.border}`, color: theme.textMuted }}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <TrendingUp size={10} />
            {candles.length} candles · {activeTf.toUpperCase()}
          </span>
          <span
            className="px-1.5 py-0.5 rounded font-bold uppercase"
            style={{
              background: connected ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
              color:      connected ? "#10b981" : "#ef4444",
              fontSize:   "8px",
            }}
          >
            {connected ? "● LIVE" : "○ OFFLINE"}
          </span>
        </div>
        <span>Drag time-axis: zoom · Drag price-axis: scale · Scroll: pan</span>
      </div>
    </div>
  );
};

export default ProLiveChart;
