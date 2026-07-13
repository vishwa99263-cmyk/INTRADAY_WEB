import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Clock, Eye, AlertCircle, Maximize2, Minimize2, RotateCcw } from "lucide-react";

export interface MiniChartWidgetProps {
  instrument: "NIFTY" | "SENSEX" | "BANKNIFTY";
  livePrice: number;
  socket?: any;
  darkMode?: boolean;
  heightClass?: string;
}

export const MiniChartWidget: React.FC<MiniChartWidgetProps> = ({
  instrument,
  livePrice,
  socket,
  darkMode = false,
  heightClass
}) => {
  const [timeframe, setTimeframe] = useState<"5m" | "15m">("5m");
  const [candles, setCandles] = useState<any[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  
  // Interactive navigation states
  const [candlesToShow, setCandlesToShow] = useState<number>(60);
  const [scrollOffset, setScrollOffset] = useState<number>(0);
  const [verticalScaleMultiplier, setVerticalScaleMultiplier] = useState<number>(1.0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null);

  // Mouse drag states
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragMode, setDragMode] = useState<"pan" | "priceScale" | "timeScale" | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [startScrollOffset, setStartScrollOffset] = useState<number>(0);
  const [startVerticalScale, setStartVerticalScale] = useState<number>(1.0);
  const [startCandlesToShow, setStartCandlesToShow] = useState<number>(60);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const theme = darkMode ? {
    bg: "#0f172a", // Slate dark background
    grid: "rgba(255, 255, 255, 0.04)",
    up: "#10b981", // High contrast green
    down: "#ef4444", // High contrast red
    vwap: "#00e5ff",
    highLine: "rgba(16, 185, 129, 0.5)",
    lowLine: "rgba(239, 68, 68, 0.5)",
    priceLine: "rgba(255, 255, 255, 0.4)",
    crosshair: "rgba(255, 255, 255, 0.15)",
    textMuted: "#64748b",
    textLight: "#cbd5e1",
    volColor: "rgba(0, 229, 255, 0.08)"
  } : {
    bg: "#ffffff", // Pure white professional terminal background
    grid: "rgba(0, 0, 0, 0.05)",
    up: "#10b981", // High contrast emerald
    down: "#ef4444", // High contrast rose
    vwap: "#0369a1", // Darker blue vwap
    highLine: "rgba(16, 185, 129, 0.6)",
    lowLine: "rgba(239, 68, 68, 0.6)",
    priceLine: "rgba(15, 23, 42, 0.4)",
    crosshair: "rgba(0, 0, 0, 0.15)",
    textMuted: "#475569", // Darker text for readability
    textLight: "#0f172a",
    volColor: "rgba(3, 105, 161, 0.06)"
  };

  const loadHistory = useCallback(async () => {
    try {
      const resp = await fetch(`/api/index-chart/history?instrument=${instrument}&tf=${timeframe}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      if (body?.candles) {
        const sorted = body.candles.map((c: any) => ({
          time: c.time || c[0],
          open: c.open || c[1],
          high: c.high || c[2],
          low: c.low || c[3],
          close: c.close || c[4],
          volume: c.volume || c[5] || 0,
          vwap: c.vwap || c[7] || c[4]
        })).sort((a: any, b: any) => a.time - b.time);
        setCandles(sorted);
      }
    } catch (err) {
      generateMockCandles();
    }
  }, [instrument, timeframe]);

  const generateMockCandles = () => {
    const list = [];
    let price = instrument === "NIFTY" ? 22850.0 : (instrument === "BANKNIFTY" ? 49000.0 : 75000.0);
    const start = Math.floor(Date.now() / 1000) - 100 * 300;
    for (let i = 0; i < 100; i++) {
      const open = price;
      const noise = (Math.random() - 0.49) * (price * 0.0006);
      const close = price + noise;
      list.push({
        time: start + i * 300,
        open,
        high: Math.max(open, close) + Math.random() * (price * 0.0003),
        low: Math.min(open, close) - Math.random() * (price * 0.0003),
        close,
        volume: Math.round(5000 + Math.random() * 20000),
        vwap: price
      });
      price = close;
    }
    setCandles(list);
  };

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Synchronize live websocket spot ticks
  useEffect(() => {
    if (!socket) return;
    
    const handleTick = (p: any) => {
      if (p.instrument !== instrument || p.tf !== timeframe) return;
      setCandles((prev) => {
        const last = prev[prev.length - 1];
        const newCandle = {
          time: p.candle.time || p.candle[0],
          open: p.candle.open || p.candle[1],
          high: p.candle.high || p.candle[2],
          low: p.candle.low || p.candle[3],
          close: p.candle.close || p.candle[4],
          volume: p.candle.volume || p.candle[5] || 0,
          vwap: p.candle.vwap || p.candle[7] || p.candle[4]
        };

        if (last && last.time === newCandle.time) {
          return [...prev.slice(0, -1), newCandle];
        } else {
          return [...prev, newCandle].slice(-200);
        }
      });
    };

    socket.on("index-chart-candle", handleTick);
    return () => {
      socket.off("index-chart-candle", handleTick);
    };
  }, [socket, instrument, timeframe]);

  // Esc key listener for fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // Reset view state
  const resetView = () => {
    setScrollOffset(0);
    setCandlesToShow(60);
    setVerticalScaleMultiplier(1.0);
  };

  // Draw chart onto HTML5 Canvas
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const rightAxisW = 60;
    const chartW = W - rightAxisW;
    const chartH = H - 20;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    // Visible candles slice based on navigation
    const endIndex = Math.max(candlesToShow, candles.length - scrollOffset);
    const startIndex = Math.max(0, endIndex - candlesToShow);
    const visibleCandles = candles.slice(startIndex, endIndex);

    if (visibleCandles.length === 0) return;

    // High and Low limits
    const sessionHigh = Math.max(...visibleCandles.map(c => c.high));
    const sessionLow = Math.min(...visibleCandles.map(c => c.low));
    
    // Scale ranges mathematically based on multiplier
    const sessionCenter = (sessionHigh + sessionLow) / 2;
    const sessionRange = sessionHigh - sessionLow || 1;
    const priceRange = sessionRange * verticalScaleMultiplier;
    
    const priceMax = sessionCenter + priceRange / 2;
    const priceMin = sessionCenter - priceRange / 2;

    const toX = (idx: number): number => {
      if (visibleCandles.length <= 1) return 5;
      return (idx / (visibleCandles.length - 1)) * (chartW - 10) + 5;
    };

    const toY = (price: number): number => {
      const pct = (price - priceMin) / priceRange;
      return chartH - pct * chartH;
    };

    // Draw Grid Lines (Horizontal & Vertical)
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 0.5;
    const horizontalGridLines = 5;
    for (let i = 0; i <= horizontalGridLines; i++) {
      const price = priceMin + (priceRange * i) / horizontalGridLines;
      const y = toY(price);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartW, y);
      ctx.stroke();

      // Right axis price print
      ctx.fillStyle = theme.textMuted;
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText(price.toFixed(1), chartW + 6, y + 3);
    }

    // Vertical grid lines
    const gridStep = Math.max(5, Math.round(visibleCandles.length / 5));
    visibleCandles.forEach((c, idx) => {
      if (idx % gridStep === 0) {
        const x = toX(idx);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartH);
        ctx.stroke();
      }
    });

    // Draw Session High & Low Horizontal Lines
    ctx.save();
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    
    // High line
    const yHigh = toY(sessionHigh);
    ctx.strokeStyle = theme.highLine;
    ctx.beginPath(); ctx.moveTo(0, yHigh); ctx.lineTo(chartW, yHigh); ctx.stroke();
    ctx.fillStyle = theme.highLine;
    ctx.font = "bold 8px 'Inter', sans-serif";
    ctx.fillText("SESSION HIGH", 5, yHigh - 3);

    // Low line
    const yLow = toY(sessionLow);
    ctx.strokeStyle = theme.lowLine;
    ctx.beginPath(); ctx.moveTo(0, yLow); ctx.lineTo(chartW, yLow); ctx.stroke();
    ctx.fillStyle = theme.lowLine;
    ctx.fillText("SESSION LOW", 5, yLow + 9);
    ctx.restore();

    // Draw Volume Histogram (Small bars at bottom)
    const maxVol = Math.max(...visibleCandles.map(c => c.volume)) || 1;
    const candleSpacing = (chartW - 10) / visibleCandles.length;
    const bodyW = Math.max(1.5, candleSpacing * 0.7);

    visibleCandles.forEach((c, idx) => {
      const x = toX(idx);
      const volH = (c.volume / maxVol) * 20;
      ctx.fillStyle = theme.volColor;
      ctx.fillRect(x - bodyW / 2, chartH - volH, bodyW, volH);
    });

    // Draw Candles (Wicks & Bodies)
    visibleCandles.forEach((c, idx) => {
      const x = toX(idx);
      const yOpen = toY(c.open);
      const yHigh = toY(c.high);
      const yLow = toY(c.low);
      const yClose = toY(c.close);

      const isBullish = c.close >= c.open;
      ctx.strokeStyle = isBullish ? theme.up : theme.down;
      ctx.fillStyle = isBullish ? theme.up : theme.down;
      ctx.lineWidth = Math.max(1, bodyW * 0.15);

      // Wick line
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body box
      const bodyH = Math.max(1.5, Math.abs(yOpen - yClose));
      ctx.fillRect(x - bodyW / 2, Math.min(yOpen, yClose), bodyW, bodyH);
    });

    // Draw VWAP line
    ctx.strokeStyle = theme.vwap;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    let firstVwap = true;
    visibleCandles.forEach((c, idx) => {
      if (c.vwap) {
        const x = toX(idx);
        const y = toY(c.vwap);
        if (firstVwap) {
          ctx.moveTo(x, y);
          firstVwap = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // Draw Current LTP line
    const curPrice = livePrice || (candles[candles.length - 1]?.close ?? 0);
    if (curPrice > 0) {
      const yLtp = toY(curPrice);
      ctx.save();
      ctx.strokeStyle = theme.priceLine;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yLtp);
      ctx.lineTo(chartW, yLtp);
      ctx.stroke();

      // Price Tag badge
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(chartW + 2, yLtp - 6, rightAxisW - 4, 13);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 8px monospace";
      ctx.fillText(curPrice.toFixed(1), chartW + 5, yLtp + 3);
      ctx.restore();
    }

    // Time Axis Labels
    const labelStep = Math.max(5, Math.round(visibleCandles.length / 5));
    visibleCandles.forEach((c, idx) => {
      if (idx % labelStep === 0) {
        const x = toX(idx);
        const date = new Date(c.time ? c.time * 1000 : Date.now());
        const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        ctx.fillStyle = theme.textMuted;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText(timeStr, x, chartH + 12);
      }
    });

    // Draw Crosshair Overlay
    if (crosshairPos) {
      ctx.save();
      ctx.strokeStyle = theme.crosshair;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 2]);

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(crosshairPos.x, 0);
      ctx.lineTo(crosshairPos.x, chartH);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, crosshairPos.y);
      ctx.lineTo(chartW, crosshairPos.y);
      ctx.stroke();

      // Draw hovered price tag on right axis
      const pct = (chartH - crosshairPos.y) / chartH;
      const crosshairPrice = priceMin + pct * priceRange;
      ctx.fillStyle = darkMode ? "#334155" : "#475569";
      ctx.fillRect(chartW + 2, crosshairPos.y - 7, rightAxisW - 4, 14);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 8.5px monospace";
      ctx.fillText(crosshairPrice.toFixed(1), chartW + 5, crosshairPos.y + 3);

      // Draw hovered time tag on bottom axis
      const hoverIdx = Math.round((crosshairPos.x - 5) / (chartW - 10) * (visibleCandles.length - 1));
      if (visibleCandles[hoverIdx]) {
        const date = new Date(visibleCandles[hoverIdx].time * 1000);
        const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        
        ctx.fillStyle = darkMode ? "#334155" : "#475569";
        ctx.fillRect(crosshairPos.x - 22, chartH + 2, 44, 12);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "center";
        ctx.fillText(timeStr, crosshairPos.x, chartH + 10);
      }

      ctx.restore();
    }

  }, [candles, livePrice, timeframe, candlesToShow, scrollOffset, verticalScaleMultiplier, crosshairPos, darkMode]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  // Adjust canvas size
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight - (isFullscreen ? 65 : 45); // Account for headers/footers
      drawChart();
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawChart, isFullscreen]);

  // Reset viewport when fullscreen toggles
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight - (isFullscreen ? 65 : 45);
    drawChart();
  }, [isFullscreen, drawChart]);

  // Hook scroll prevention wheel zoom manually
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onCanvasWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomChange = e.deltaY > 0 ? 3 : -3;
      setCandlesToShow(prev => Math.max(15, Math.min(150, prev + zoomChange)));
    };

    canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onCanvasWheel);
  }, []);

  // Mouse events for canvas dragging and tracking
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const W = canvas.width;
    const H = canvas.height;
    const rightAxisW = 60;
    const chartW = W - rightAxisW;
    const chartH = H - 20;

    let mode: "pan" | "priceScale" | "timeScale" | null = null;
    if (x >= chartW) {
      mode = "priceScale";
    } else if (y >= chartH) {
      mode = "timeScale";
    } else {
      mode = "pan";
    }

    setIsDragging(true);
    setDragMode(mode);
    setDragStart({ x: e.clientX, y: e.clientY });
    setStartScrollOffset(scrollOffset);
    setStartVerticalScale(verticalScaleMultiplier);
    setStartCandlesToShow(candlesToShow);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const W = canvas.width;
    const H = canvas.height;
    const rightAxisW = 60;
    const chartW = W - rightAxisW;
    const chartH = H - 20;

    if (isDragging && dragMode) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      if (dragMode === "pan") {
        const candleW = chartW / candlesToShow;
        // Dragging right scrolls back in time (increases offset)
        const dOffset = Math.round(dx / candleW);
        setScrollOffset(Math.max(0, Math.min(candles.length - candlesToShow, startScrollOffset + dOffset)));
      } else if (dragMode === "priceScale") {
        const multiplier = startVerticalScale * Math.exp(dy / 200);
        setVerticalScaleMultiplier(Math.max(0.1, Math.min(10.0, multiplier)));
      } else if (dragMode === "timeScale") {
        const dShow = Math.round(dx / 5);
        setCandlesToShow(Math.max(15, Math.min(150, startCandlesToShow - dShow)));
      }
    } else {
      // Hover crosshair coordinate calculation
      if (x < chartW && y < chartH) {
        setCrosshairPos({ x, y });
        
        const endIndex = Math.max(candlesToShow, candles.length - scrollOffset);
        const startIndex = Math.max(0, endIndex - candlesToShow);
        const visibleCandles = candles.slice(startIndex, endIndex);

        const idx = Math.round((x - 5) / (chartW - 10) * (visibleCandles.length - 1));
        setHoverIndex(Math.max(0, Math.min(visibleCandles.length - 1, idx)));
      } else {
        setCrosshairPos(null);
        setHoverIndex(null);
      }
    }
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
    setDragMode(null);
    setCrosshairPos(null);
    setHoverIndex(null);
  };

  const visibleEnd = Math.max(candlesToShow, candles.length - scrollOffset);
  const visibleStart = Math.max(0, visibleEnd - candlesToShow);
  const visibleCandles = useMemo(() => candles.slice(visibleStart, visibleEnd), [candles, visibleStart, visibleEnd]);

  const activeCandle = useMemo(() => {
    if (hoverIndex === null) return visibleCandles[visibleCandles.length - 1] || null;
    return visibleCandles[hoverIndex] || null;
  }, [visibleCandles, hoverIndex]);

  return (
    <div
      ref={containerRef}
      className={`flex flex-col justify-between overflow-hidden shadow-2xl transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-50 p-5 w-screen h-screen"
          : `w-full ${heightClass || "h-[220px]"} rounded-xl border p-2`
      } ${
        darkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-300 text-slate-800"
      }`}
      style={isFullscreen ? { maxWidth: "none" } : { maxWidth: "420px" }}
    >
      {/* Header Panel */}
      <div className="flex items-center justify-between border-b dark:border-slate-800 pb-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Eye size={12} className="text-blue-500" />
          <span className="text-[10px] font-black tracking-wider uppercase">
            {instrument} {isFullscreen ? "INTERACTIVE TERMINAL VIEW" : "LIVE PREVIEW"}
          </span>
        </div>
        
        {/* Navigation & scaling controls */}
        <div className="flex items-center gap-2">
          {/* Reset view */}
          <button
            onClick={resetView}
            title="Reset Chart View & Zoom Scale"
            className="p-1 rounded cursor-pointer hover:bg-slate-500/10 transition-colors text-slate-500 hover:text-slate-800 dark:hover:text-white"
          >
            <RotateCcw size={12} />
          </button>

          {/* Timeframe selector */}
          <div className={`flex p-0.5 rounded border ${
            darkMode ? "bg-slate-950 border-slate-800" : "bg-slate-100 border-slate-300"
          }`}>
            <button
              onClick={() => setTimeframe("5m")}
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold cursor-pointer transition-colors ${
                timeframe === "5m"
                  ? (darkMode ? "bg-slate-800 text-teal-400 font-extrabold" : "bg-white text-emerald-600 font-extrabold shadow-sm")
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              5M
            </button>
            <button
              onClick={() => setTimeframe("15m")}
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold cursor-pointer transition-colors ${
                timeframe === "15m"
                  ? (darkMode ? "bg-slate-800 text-teal-400 font-extrabold" : "bg-white text-emerald-600 font-extrabold shadow-sm")
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              15M
            </button>
          </div>

          {/* Full Screen mode trigger */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen (ESC)" : "Open Professional Fullscreen Chart"}
            className="p-1 rounded cursor-pointer hover:bg-slate-500/10 transition-colors text-slate-500 hover:text-slate-800 dark:hover:text-white"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className={`flex-1 min-h-0 w-full relative my-1 cursor-crosshair rounded-lg ${
        darkMode ? "bg-slate-950/60" : "bg-slate-50/50"
      }`}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className="absolute inset-0 w-full h-full block"
        />
      </div>

      {/* Tooltip Footer stats (OHLC values) */}
      {activeCandle && (
        <div className="flex items-center justify-between text-[8px] sm:text-[9.5px] font-mono text-slate-500 border-t dark:border-slate-800/80 pt-1.5 flex-shrink-0 select-text">
          <span>O: <span className={darkMode ? "text-slate-200" : "text-slate-900 font-bold"}>{activeCandle.open.toFixed(1)}</span></span>
          <span>H: <span className="text-emerald-500 font-bold">{activeCandle.high.toFixed(1)}</span></span>
          <span>L: <span className="text-rose-500 font-bold">{activeCandle.low.toFixed(1)}</span></span>
          <span>C: <span className={activeCandle.close >= activeCandle.open ? "text-emerald-500 font-extrabold" : "text-rose-500 font-extrabold"}>{activeCandle.close.toFixed(1)}</span></span>
          <span className="hidden sm:inline">V: <span className={darkMode ? "text-slate-350" : "text-slate-800"}>{activeCandle.volume.toLocaleString()}</span></span>
          {activeCandle.vwap && <span>VWAP: <span className="text-cyan-600 dark:text-cyan-400 font-bold">{activeCandle.vwap.toFixed(1)}</span></span>}
        </div>
      )}
    </div>
  );
};

export default MiniChartWidget;
