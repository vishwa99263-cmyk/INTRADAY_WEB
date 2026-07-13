/**
 * TradingViewDashboard.tsx
 *
 * Full-featured TradingView Advanced Chart widget integration.
 *
 * Features:
 *  ✅ TradingView Advanced Charting Library (via public widget CDN)
 *  ✅ All drawing tools, indicators, chart settings preserved
 *  ✅ NO stock search bar / watchlist
 *  ✅ Only NIFTY, BANKNIFTY, SENSEX — switching via custom buttons
 *  ✅ Side panel: Live Option Chain (passed via props) per selected index
 *  ✅ Paper Trade Overlay API:
 *      - plotEntryLine(price, side)   → draws Buy/Sell entry line
 *      - plotTPLine(price)            → draws Target Profit line
 *      - plotSLLine(price)            → draws Stop Loss line
 *      - clearPaperTrades()           → removes all paper trade lines
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  ShieldAlert,
  Crosshair,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Activity,
  BarChart3,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export interface PaperTradeEntry {
  id: string;
  type: "ENTRY" | "TP" | "SL";
  price: number;
  side?: "BUY" | "SELL";
  timestamp: number;
}

/** Methods exposed on the component ref for programmatic paper trade drawing */
export interface TradingViewDashboardRef {
  plotEntryLine: (price: number, side: "BUY" | "SELL") => PaperTradeEntry;
  plotTPLine: (price: number) => PaperTradeEntry;
  plotSLLine: (price: number) => PaperTradeEntry;
  clearPaperTrades: () => void;
  getCurrentIndex: () => IndexSymbol;
  switchIndex: (index: IndexSymbol) => void;
}

interface TradingViewDashboardProps {
  darkMode?: boolean;
  /** Live Option Chain render function — receives the active index symbol */
  renderOptionChain?: (index: IndexSymbol) => React.ReactNode;
  /** Live spot prices for each index */
  spotPrices?: Record<IndexSymbol, number>;
  /** Live changes for each index */
  spotChanges?: Record<IndexSymbol, number>;
  /** Initial index to load */
  defaultIndex?: IndexSymbol;
}

// ─── TradingView symbol map ────────────────────────────────────────────────────

const TV_SYMBOLS: Record<IndexSymbol, string> = {
  NIFTY: "NSE:NIFTY50",
  BANKNIFTY: "NSE:BANKNIFTY",
  SENSEX: "BSE:SENSEX",
};

const INDEX_META: Record<
  IndexSymbol,
  { label: string; color: string; accentHex: string; gradient: string }
> = {
  NIFTY: {
    label: "NIFTY 50",
    color: "text-emerald-400",
    accentHex: "#10b981",
    gradient: "from-emerald-500/20 via-emerald-500/5 to-transparent",
  },
  BANKNIFTY: {
    label: "BANK NIFTY",
    color: "text-violet-400",
    accentHex: "#8b5cf6",
    gradient: "from-violet-500/20 via-violet-500/5 to-transparent",
  },
  SENSEX: {
    label: "SENSEX",
    color: "text-amber-400",
    accentHex: "#f59e0b",
    gradient: "from-amber-500/20 via-amber-500/5 to-transparent",
  },
};

// ─── Unique ID helper ─────────────────────────────────────────────────────────

const uid = () =>
  `pt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── TradingView Widget Script loader ─────────────────────────────────────────

function loadTradingViewScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).TradingView) {
      resolve();
      return;
    }
    const existing = document.getElementById("tv-widget-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.id = "tv-widget-script";
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("TradingView script failed to load"));
    document.head.appendChild(script);
  });
}

// ─── Paper Trade Line Canvas Overlay ─────────────────────────────────────────
/**
 * Draws paper trade lines on a canvas overlay that sits on top of the TV iframe.
 * The lines render at relative vertical positions derived from price mapping
 * against known high/low price range stored in state.
 *
 * For full production accuracy these should be injected via the
 * TradingView Charting Library's `createOrderLine()` API (requires a paid license).
 * This implementation uses a canvas overlay which works with the free widget.
 */

interface OverlayLine {
  id: string;
  type: "ENTRY_BUY" | "ENTRY_SELL" | "TP" | "SL";
  price: number;
  label: string;
}

interface PaperTradeOverlayProps {
  lines: OverlayLine[];
  priceRange: { high: number; low: number } | null;
  darkMode: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const LINE_COLORS: Record<OverlayLine["type"], string> = {
  ENTRY_BUY: "#10b981",   // emerald
  ENTRY_SELL: "#ef4444",  // rose
  TP: "#06b6d4",          // cyan
  SL: "#f97316",          // orange
};

const PaperTradeOverlay: React.FC<PaperTradeOverlayProps> = ({
  lines,
  priceRange,
  darkMode,
  containerRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const { width, height } = container.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    if (!priceRange || lines.length === 0) return;

    const { high, low } = priceRange;
    const range = high - low || 1;

    // Reserve ~15% top and bottom for TradingView's own UI chrome
    const topPad = height * 0.15;
    const bottomPad = height * 0.15;
    const chartH = height - topPad - bottomPad;

    lines.forEach((line) => {
      // Clamp price within visible range
      const clamped = Math.max(low, Math.min(high, line.price));
      const pct = 1 - (clamped - low) / range; // 0 = bottom, 1 = top
      const y = topPad + pct * chartH;

      const color = LINE_COLORS[line.type];

      // ── Dashed horizontal line ─────────────────────────────────────────
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // ── Price label pill on the right ──────────────────────────────────
      const pillText = `${line.label}  ${line.price.toLocaleString("en-IN")}`;
      const fontSize = 11;
      ctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
      const tw = ctx.measureText(pillText).width;
      const ph = 18;
      const pw = tw + 16;
      const px = width - pw - 8;
      const py = y - ph / 2;

      ctx.globalAlpha = 0.92;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, 4);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.setLineDash([]);
      ctx.fillText(pillText, px + 8, py + 13);
      ctx.restore();
    });
  }, [lines, priceRange, containerRef]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [draw, containerRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    />
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const TradingViewDashboard = forwardRef<
  TradingViewDashboardRef,
  TradingViewDashboardProps
>(
  (
    {
      darkMode = true,
      renderOptionChain,
      spotPrices,
      spotChanges,
      defaultIndex = "NIFTY",
    },
    ref
  ) => {
    const [activeIndex, setActiveIndex] = useState<IndexSymbol>(defaultIndex);
    const [scriptReady, setScriptReady] = useState(false);
    const [widgetReady, setWidgetReady] = useState(false);
    const [panelOpen, setPanelOpen] = useState(true);
    const [paperTrades, setPaperTrades] = useState<OverlayLine[]>([]);
    const [priceRange, setPriceRange] = useState<{
      high: number;
      low: number;
    } | null>(null);
    const [addTradeModal, setAddTradeModal] = useState<{
      type: "ENTRY" | "TP" | "SL";
    } | null>(null);
    const [tradePrice, setTradePrice] = useState("");
    const [tradeSide, setTradeSide] = useState<"BUY" | "SELL">("BUY");

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const tvWidgetRef = useRef<any>(null);
    const widgetContainerId = useRef(`tv_chart_${Date.now()}`);

    // ── Load TradingView script ──────────────────────────────────────────────
    useEffect(() => {
      loadTradingViewScript()
        .then(() => setScriptReady(true))
        .catch((e) => console.error("[TV Dashboard] Script load error:", e));
    }, []);

    // ── Initialize / re-initialize widget when script ready or index changes ─
    const initWidget = useCallback(
      (symbol: IndexSymbol) => {
        if (!(window as any).TradingView) return;

        // Destroy old widget if any
        if (tvWidgetRef.current) {
          try {
            tvWidgetRef.current.remove?.();
          } catch (_) {
            /* ignore */
          }
          tvWidgetRef.current = null;
        }

        setWidgetReady(false);

        const tvSymbol = TV_SYMBOLS[symbol];
        const theme = darkMode ? "dark" : "light";

        /*
         * TradingView Widget Configuration
         * - search_enabled: false   → removes the symbol search bar
         * - watchlist: []           → no watchlist
         * - hide_side_toolbar: false → keep all drawing tools on left
         * - allow_symbol_change: false → prevents manual symbol switching
         */
        const widget = new (window as any).TradingView.widget({
          // ── Container
          container_id: widgetContainerId.current,
          autosize: true,

          // ── Locked to single symbol
          symbol: tvSymbol,
          interval: "5",

          // ── UI restrictions
          allow_symbol_change: false,       // No search / symbol switching
          hide_top_toolbar: false,          // Keep indicator/toolbar row
          hide_side_toolbar: false,         // Keep drawing tools
          hide_legend: false,
          withdateranges: true,
          save_image: true,

          // ── Remove search / watchlist surfaces
          // (Advanced Charting Library flags — gracefully ignored on widget)
          disabled_features: [
            "header_symbol_search",
            "symbol_search_hot_key",
            "header_compare",
            "display_market_status",
            "go_to_date",
            "timeframes_toolbar",
            "use_localstorage_for_settings",
          ],
          enabled_features: [
            "study_templates",
            "side_toolbar_in_fullscreen_mode",
            "header_fullscreen_button",
            "header_screenshot",
            "header_undo_redo",
            "header_indicators",
            "header_chart_type",
            "header_resolutions",
            "drawing_templates",
          ],

          // ── Aesthetics
          theme,
          locale: "en",
          timezone: "Asia/Kolkata",
          toolbar_bg: darkMode ? "#0d1117" : "#f8fafc",
          overrides: darkMode
            ? {
                "paneProperties.background": "#0d1117",
                "paneProperties.backgroundType": "solid",
                "paneProperties.gridLinesMode": "both",
                "paneProperties.vertGridProperties.color": "#1e2736",
                "paneProperties.horzGridProperties.color": "#1e2736",
                "scalesProperties.textColor": "#94a3b8",
                "scalesProperties.lineColor": "#1e2736",
                "mainSeriesProperties.candleStyle.upColor": "#10b981",
                "mainSeriesProperties.candleStyle.downColor": "#ef4444",
                "mainSeriesProperties.candleStyle.borderUpColor": "#10b981",
                "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
                "mainSeriesProperties.candleStyle.wickUpColor": "#10b981",
                "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
              }
            : {
                "paneProperties.background": "#ffffff",
                "paneProperties.backgroundType": "solid",
                "paneProperties.vertGridProperties.color": "#f1f5f9",
                "paneProperties.horzGridProperties.color": "#f1f5f9",
                "scalesProperties.textColor": "#475569",
                "mainSeriesProperties.candleStyle.upColor": "#10b981",
                "mainSeriesProperties.candleStyle.downColor": "#ef4444",
                "mainSeriesProperties.candleStyle.borderUpColor": "#10b981",
                "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
              },

          // ── Chart studies (pre-loaded indicators)
          studies: ["RSI@tv-basicstudies", "VWAP@tv-basicstudies"],

          // ── No watchlist
          watchlist: [],
          details: false,
          hotlist: false,
          calendar: false,
          news: [],
          show_popup_button: false,

          // ── Callbacks
          onChartReady: () => {
            setWidgetReady(true);
            tvWidgetRef.current = widget;
          },
        });

        tvWidgetRef.current = widget;
      },
      [darkMode]
    );

    useEffect(() => {
      if (scriptReady) {
        initWidget(activeIndex);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scriptReady, activeIndex, darkMode]);

    // ── Update price range from spotPrices for overlay positioning ───────────
    useEffect(() => {
      if (!spotPrices) return;
      const sp = spotPrices[activeIndex];
      if (sp && sp > 0) {
        // Derive a ±2% band around current price as rough visible range
        const band = sp * 0.02;
        setPriceRange({ high: sp + band, low: sp - band });
      }
    }, [spotPrices, activeIndex]);

    // ── Index switch handler ────────────────────────────────────────────────
    const handleIndexSwitch = useCallback(
      (idx: IndexSymbol) => {
        if (idx === activeIndex) return;
        setPaperTrades([]); // Clear trades on index change
        setActiveIndex(idx);
      },
      [activeIndex]
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Paper Trade Drawing API
    // ─────────────────────────────────────────────────────────────────────────

    /** Plot an Entry line (Buy = green, Sell = red) */
    const plotEntryLine = useCallback(
      (price: number, side: "BUY" | "SELL"): PaperTradeEntry => {
        const id = uid();
        const line: OverlayLine = {
          id,
          type: side === "BUY" ? "ENTRY_BUY" : "ENTRY_SELL",
          price,
          label: `${side} ENTRY`,
        };
        setPaperTrades((prev) => [...prev, line]);
        // Auto-expand price range if needed
        setPriceRange((prev) => {
          if (!prev) return { high: price * 1.01, low: price * 0.99 };
          return {
            high: Math.max(prev.high, price * 1.005),
            low: Math.min(prev.low, price * 0.995),
          };
        });
        return { id, type: "ENTRY", price, side, timestamp: Date.now() };
      },
      []
    );

    /** Plot a Take Profit line (cyan) */
    const plotTPLine = useCallback((price: number): PaperTradeEntry => {
      const id = uid();
      setPaperTrades((prev) => [
        ...prev,
        { id, type: "TP", price, label: "TARGET TP" },
      ]);
      setPriceRange((prev) => {
        if (!prev) return { high: price * 1.01, low: price * 0.99 };
        return { high: Math.max(prev.high, price * 1.005), low: prev.low };
      });
      return { id, type: "TP", price, timestamp: Date.now() };
    }, []);

    /** Plot a Stop Loss line (orange) */
    const plotSLLine = useCallback((price: number): PaperTradeEntry => {
      const id = uid();
      setPaperTrades((prev) => [
        ...prev,
        { id, type: "SL", price, label: "STOP LOSS" },
      ]);
      setPriceRange((prev) => {
        if (!prev) return { high: price * 1.01, low: price * 0.99 };
        return { high: prev.high, low: Math.min(prev.low, price * 0.995) };
      });
      return { id, type: "SL", price, timestamp: Date.now() };
    }, []);

    /** Remove all paper trade overlays */
    const clearPaperTrades = useCallback(() => {
      setPaperTrades([]);
    }, []);

    // ── Expose API via ref ───────────────────────────────────────────────────
    useImperativeHandle(
      ref,
      () => ({
        plotEntryLine,
        plotTPLine,
        plotSLLine,
        clearPaperTrades,
        getCurrentIndex: () => activeIndex,
        switchIndex: handleIndexSwitch,
      }),
      [plotEntryLine, plotTPLine, plotSLLine, clearPaperTrades, activeIndex, handleIndexSwitch]
    );

    // ── Add Trade Modal Handler ──────────────────────────────────────────────
    const handleAddTrade = () => {
      const price = parseFloat(tradePrice);
      if (!price || isNaN(price)) return;
      if (addTradeModal?.type === "ENTRY") plotEntryLine(price, tradeSide);
      else if (addTradeModal?.type === "TP") plotTPLine(price);
      else if (addTradeModal?.type === "SL") plotSLLine(price);
      setTradePrice("");
      setAddTradeModal(null);
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────────

    const meta = INDEX_META[activeIndex];
    const sp = spotPrices?.[activeIndex] ?? 0;
    const ch = spotChanges?.[activeIndex] ?? 0;
    const isUp = ch >= 0;

    const bg = darkMode ? "#0a0e1a" : "#f8fafc";
    const surface = darkMode ? "#0d1117" : "#ffffff";
    const border = darkMode ? "#1e2736" : "#e2e8f0";
    const text = darkMode ? "#e2e8f0" : "#1e293b";
    const textMuted = darkMode ? "#64748b" : "#94a3b8";
    const pillBg = darkMode ? "#131929" : "#f1f5f9";

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          background: bg,
          fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
          overflow: "hidden",
        }}
      >
        {/* ── Top toolbar ──────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 16px",
            background: surface,
            borderBottom: `1px solid ${border}`,
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          {/* Brand */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginRight: "8px",
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${meta.accentHex}33, ${meta.accentHex}11)`,
                border: `1px solid ${meta.accentHex}44`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BarChart3 size={15} color={meta.accentHex} />
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: text,
              }}
            >
              INDEX CHART
            </span>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 28,
              background: border,
              flexShrink: 0,
            }}
          />

          {/* Index selector buttons */}
          {(["NIFTY", "BANKNIFTY", "SENSEX"] as IndexSymbol[]).map((idx) => {
            const m = INDEX_META[idx];
            const isActive = idx === activeIndex;
            const price = spotPrices?.[idx] ?? 0;
            const chg = spotChanges?.[idx] ?? 0;
            const up = chg >= 0;
            return (
              <button
                key={idx}
                onClick={() => handleIndexSwitch(idx)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: isActive
                    ? `1.5px solid ${m.accentHex}`
                    : `1.5px solid ${border}`,
                  background: isActive
                    ? `linear-gradient(135deg, ${m.accentHex}1a, ${m.accentHex}08)`
                    : pillBg,
                  cursor: "pointer",
                  transition: "all 0.18s ease",
                  position: "relative",
                  overflow: "hidden",
                  minWidth: 110,
                }}
                title={`Switch to ${m.label}`}
              >
                {isActive && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: m.accentHex,
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: isActive ? m.accentHex : textMuted,
                  }}
                >
                  {m.label}
                </span>
                {price > 0 && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: isActive ? text : textMuted,
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    {price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                    <span
                      style={{
                        fontSize: 10,
                        marginLeft: 5,
                        color: up ? "#10b981" : "#ef4444",
                      }}
                    >
                      {up ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}
                    </span>
                  </span>
                )}
              </button>
            );
          })}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Paper Trade Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: textMuted,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginRight: 2,
              }}
            >
              Paper Trade
            </span>

            {/* Entry Button */}
            <button
              onClick={() => {
                setAddTradeModal({ type: "ENTRY" });
                setTradePrice(sp > 0 ? sp.toFixed(1) : "");
              }}
              title="Add Entry Line"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 6,
                border: "1.5px solid #10b98133",
                background: "#10b98111",
                color: "#10b981",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <Crosshair size={12} />
              ENTRY
            </button>

            {/* TP Button */}
            <button
              onClick={() => {
                setAddTradeModal({ type: "TP" });
                setTradePrice(sp > 0 ? (sp * 1.005).toFixed(1) : "");
              }}
              title="Add Target Profit Line"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 6,
                border: "1.5px solid #06b6d433",
                background: "#06b6d411",
                color: "#06b6d4",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <Target size={12} />
              TP
            </button>

            {/* SL Button */}
            <button
              onClick={() => {
                setAddTradeModal({ type: "SL" });
                setTradePrice(sp > 0 ? (sp * 0.995).toFixed(1) : "");
              }}
              title="Add Stop Loss Line"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 6,
                border: "1.5px solid #f9731633",
                background: "#f9731611",
                color: "#f97316",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <ShieldAlert size={12} />
              SL
            </button>

            {/* Clear */}
            {paperTrades.length > 0 && (
              <button
                onClick={clearPaperTrades}
                title="Clear all paper trade lines"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: `1.5px solid ${border}`,
                  background: "transparent",
                  color: textMuted,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <Trash2 size={12} />
                CLEAR ({paperTrades.length})
              </button>
            )}
          </div>

          {/* Option chain panel toggle */}
          <button
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? "Collapse option chain" : "Expand option chain"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 10px",
              borderRadius: 6,
              border: `1.5px solid ${meta.accentHex}44`,
              background: `${meta.accentHex}11`,
              color: meta.accentHex,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {panelOpen ? (
              <>
                <ChevronRight size={13} /> Hide Chain
              </>
            ) : (
              <>
                <ChevronLeft size={13} /> Show Chain
              </>
            )}
          </button>
        </div>

        {/* ── Main Body: Chart + Option Chain ──────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Chart area */}
          <div
            ref={chartContainerRef}
            style={{
              flex: 1,
              minWidth: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* TradingView widget mount point */}
            <div
              id={widgetContainerId.current}
              style={{
                width: "100%",
                height: "100%",
                position: "absolute",
                inset: 0,
              }}
            />

            {/* Loading state */}
            {!widgetReady && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: surface,
                  zIndex: 20,
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    border: `3px solid ${meta.accentHex}33`,
                    borderTopColor: meta.accentHex,
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                <p style={{ color: textMuted, fontSize: 13, fontWeight: 500 }}>
                  Loading TradingView Chart…
                </p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {/* Paper Trade canvas overlay */}
            {paperTrades.length > 0 && (
              <PaperTradeOverlay
                lines={paperTrades}
                priceRange={priceRange}
                darkMode={darkMode}
                containerRef={chartContainerRef}
              />
            )}

            {/* Active paper trades legend (bottom-left) */}
            {paperTrades.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: 12,
                  zIndex: 15,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  background: darkMode
                    ? "rgba(13,17,23,0.88)"
                    : "rgba(255,255,255,0.92)",
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  backdropFilter: "blur(8px)",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: textMuted,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: 2,
                  }}
                >
                  Paper Trades
                </span>
                {paperTrades.map((line) => (
                  <div
                    key={line.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11,
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 2,
                        background: LINE_COLORS[line.type],
                        borderRadius: 1,
                      }}
                    />
                    <span style={{ color: LINE_COLORS[line.type], fontWeight: 600 }}>
                      {line.label}
                    </span>
                    <span style={{ color: text }}>
                      {line.price.toLocaleString("en-IN")}
                    </span>
                    <button
                      onClick={() =>
                        setPaperTrades((prev) =>
                          prev.filter((l) => l.id !== line.id)
                        )
                      }
                      style={{
                        background: "none",
                        border: "none",
                        color: textMuted,
                        cursor: "pointer",
                        padding: 0,
                        fontSize: 11,
                        lineHeight: 1,
                      }}
                      title="Remove this line"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Option Chain side panel */}
          {panelOpen && renderOptionChain && (
            <div
              style={{
                width: 420,
                flexShrink: 0,
                borderLeft: `1px solid ${border}`,
                background: surface,
                overflowY: "auto",
                overflowX: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Panel header */}
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: `1px solid ${border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                  background: `linear-gradient(135deg, ${meta.accentHex}0d, transparent)`,
                }}
              >
                <Activity size={14} color={meta.accentHex} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: meta.accentHex,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {meta.label} Option Chain
                </span>
                {sp > 0 && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: '"JetBrains Mono", monospace',
                      color: isUp ? "#10b981" : "#ef4444",
                    }}
                  >
                    {sp.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                    <span style={{ fontSize: 10, marginLeft: 4 }}>
                      {isUp ? "▲" : "▼"} {Math.abs(ch).toFixed(2)}
                    </span>
                  </span>
                )}
              </div>

              {/* Option chain content */}
              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {renderOptionChain(activeIndex)}
              </div>
            </div>
          )}
        </div>

        {/* ── Add Paper Trade Modal ─────────────────────────────────────────── */}
        {addTradeModal && (
          <div
            onClick={() => setAddTradeModal(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: surface,
                border: `1px solid ${border}`,
                borderRadius: 14,
                padding: "24px 28px",
                minWidth: 320,
                boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
              }}
            >
              {/* Modal header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 20,
                }}
              >
                {addTradeModal.type === "ENTRY" && (
                  <Crosshair size={18} color="#10b981" />
                )}
                {addTradeModal.type === "TP" && (
                  <Target size={18} color="#06b6d4" />
                )}
                {addTradeModal.type === "SL" && (
                  <ShieldAlert size={18} color="#f97316" />
                )}
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: text,
                  }}
                >
                  {addTradeModal.type === "ENTRY"
                    ? "Add Entry Line"
                    : addTradeModal.type === "TP"
                    ? "Add Target Profit Line"
                    : "Add Stop Loss Line"}
                </span>
              </div>

              {/* Side selector (only for Entry) */}
              {addTradeModal.type === "ENTRY" && (
                <div style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: textMuted,
                      letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Direction
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["BUY", "SELL"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setTradeSide(s)}
                        style={{
                          flex: 1,
                          padding: "8px 0",
                          borderRadius: 7,
                          border:
                            tradeSide === s
                              ? `1.5px solid ${s === "BUY" ? "#10b981" : "#ef4444"}`
                              : `1.5px solid ${border}`,
                          background:
                            tradeSide === s
                              ? s === "BUY"
                                ? "#10b98122"
                                : "#ef444422"
                              : "transparent",
                          color:
                            tradeSide === s
                              ? s === "BUY"
                                ? "#10b981"
                                : "#ef4444"
                              : textMuted,
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        {s === "BUY" ? (
                          <TrendingUp size={14} />
                        ) : (
                          <TrendingDown size={14} />
                        )}
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Price input */}
              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: textMuted,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Price (₹)
                </label>
                <input
                  type="number"
                  value={tradePrice}
                  onChange={(e) => setTradePrice(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTrade()}
                  placeholder="e.g. 24500"
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: `1.5px solid ${border}`,
                    background: darkMode ? "#131929" : "#f8fafc",
                    color: text,
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: '"JetBrains Mono", monospace',
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setAddTradeModal(null)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 8,
                    border: `1.5px solid ${border}`,
                    background: "transparent",
                    color: textMuted,
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTrade}
                  style={{
                    flex: 2,
                    padding: "10px 0",
                    borderRadius: 8,
                    border: "none",
                    background:
                      addTradeModal.type === "ENTRY"
                        ? tradeSide === "BUY"
                          ? "linear-gradient(135deg, #10b981, #059669)"
                          : "linear-gradient(135deg, #ef4444, #dc2626)"
                        : addTradeModal.type === "TP"
                        ? "linear-gradient(135deg, #06b6d4, #0891b2)"
                        : "linear-gradient(135deg, #f97316, #ea580c)",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Zap size={14} />
                  Plot on Chart
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

TradingViewDashboard.displayName = "TradingViewDashboard";

export default TradingViewDashboard;

// ─────────────────────────────────────────────────────────────────────────────
// Standalone usage example (for reference / direct embedding in a new page)
// ─────────────────────────────────────────────────────────────────────────────
//
// import TradingViewDashboard, { TradingViewDashboardRef } from './TradingViewDashboard';
//
// const dashRef = useRef<TradingViewDashboardRef>(null);
//
// // Programmatically add paper trade lines:
// dashRef.current?.plotEntryLine(24500, 'BUY');
// dashRef.current?.plotTPLine(24650);
// dashRef.current?.plotSLLine(24350);
// dashRef.current?.clearPaperTrades();
// dashRef.current?.switchIndex('BANKNIFTY');
