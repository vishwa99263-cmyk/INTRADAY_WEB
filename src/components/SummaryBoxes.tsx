import React, { useState, useMemo, useRef, useEffect } from "react";
import { StockData, BackupSnapshots, TIME_COLUMNS } from "../types.js";

// Helper Sparkline Component
function Sparkline({ points, strokeColor }: { points: number[]; strokeColor: string }) {
  if (points.length < 2) {
    return (
      <div className="h-3 flex items-center justify-center text-[6.5px] text-slate-500/70 font-mono italic">
        Waiting...
      </div>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const padding = 1.0;

  const width = 120;
  const height = 6;

  const pathD = points
    .map((val, idx) => {
      const x = (idx / (points.length - 1)) * (width - padding * 2) + padding;
      const y = height - ((val - min) / range) * (height - padding * 2) - padding;
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const fillD = `${pathD} L ${(width - padding).toFixed(1)} ${height} L ${padding.toFixed(1)} ${height} Z`;
  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 6)}`;

  return (
    <div className="w-full h-2.5 flex items-center justify-center mt-0 opacity-90 hover:opacity-100 transition-opacity px-1 pb-0">
      <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.00" />
          </linearGradient>
        </defs>
        {min < 0 && max > 0 && (
          <line
            x1={0}
            y1={height - ((0 - min) / range) * (height - padding * 2) - padding}
            x2={width}
            y2={height - ((0 - min) / range) * (height - padding * 2) - padding}
            stroke="rgba(255, 255, 255, 0.10)"
            strokeDasharray="1,1"
            strokeWidth="0.3"
          />
        )}
        <path
          d={fillD}
          fill={`url(#${gradId})`}
        />
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.0"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={width - padding}
          cy={height - ((points[points.length - 1] - min) / range) * (height - padding * 2) - padding}
          r="0.8"
          fill={strokeColor}
        />
      </svg>
    </div>
  );
}

interface SummaryBoxesProps {
  stocks: StockData[];
  backup: BackupSnapshots;
  darkMode: boolean;
  todayOpen?: number;
  previousClose?: number;
  sensexOpen?: number;
  sensexPrev?: number;
  bankniftyOpen?: number;
  bankniftyPrev?: number;
  velocity?: number;
  momentum?: number;
  conviction?: number;
  alignment?: number;
  confidence?: number;
  ceProb?: number;
  peProb?: number;
  /** BreakoutState from aiAnalysis — gives high15m/low15m for current interval volatility */
  breakout?: { high15m: number; low15m: number; high5m: number; low5m: number };
}

interface BoxValues {
  top10Pos: number;
  next15Pos: number;
  all50Pos: number;
  netScore: number;
  all50Neg: number;
  top10Neg: number;
  next15Neg: number;
}

// ── Mini circular gauge used in the header ──────────────────────────────────
function MiniGauge({ value, label, color, extra }: { value: number; label: string; color: string; extra?: string }) {
  const r = 15.5;
  const circ = 2 * Math.PI * r; // ≈ 97.4
  const offset = circ - (Math.min(Math.max(value, 0), 100) / 100) * circ;
  const stroke =
    color === 'green'  ? '#34d399' :
    color === 'amber'  ? '#fbbf24' :
    color === 'red'    ? '#f87171' : '#818cf8';
  const glow =
    color === 'green'  ? 'rgba(52,211,153,0.8)'  :
    color === 'amber'  ? 'rgba(251,191,36,0.8)'  :
    color === 'red'    ? 'rgba(248,113,113,0.8)' : 'rgba(129,140,248,0.8)';
  return (
    <div className="flex items-center bg-[#0B1120] rounded-full border border-slate-800/80 shadow-[0_0_12px_rgba(0,0,0,0.6)] p-[2px]">
      <div className="relative w-9 h-9 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2.5" />
          <circle
            cx="18" cy="18" r="15.5" fill="none"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ filter: `drop-shadow(0 0 4px ${glow})`, transition: 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        <div className="flex flex-col items-center justify-center z-10">
          <span className="text-[12px] font-black text-white leading-none tracking-tighter drop-shadow-md">
            {Math.round(value)}
          </span>
          {extra ? (
            <span className="text-[3px] font-black uppercase tracking-[0.1em] mt-[1px]" style={{ color: stroke }}>
              {extra}
            </span>
          ) : (
            <span className="text-[3.5px] font-black text-slate-400 uppercase tracking-[0.12em] mt-[1.5px]">
              {label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniProbBar({ label, value, color, bg }: { label: string; value: number; color: string; bg: string; }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5 w-48">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }}></span>
        <span className="text-[10px] font-black uppercase tracking-wider leading-none" style={{ color }}>{label}</span>
      </div>
      <div className="w-full h-[6px] rounded-full overflow-hidden bg-slate-800/60">
        <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${width}%`, background: bg, boxShadow: `0 0 8px ${color}60` }} />
      </div>
    </div>
  );
}

function SummaryBoxes({ stocks, backup, darkMode, todayOpen, previousClose, sensexOpen, sensexPrev, bankniftyOpen, bankniftyPrev, velocity = 0, momentum = 0, conviction = 0, alignment = 0, confidence = 0, ceProb = 0, peProb = 0, breakout }: SummaryBoxesProps) {
  const isSensex = stocks.length === 30;
  const isBanknifty = stocks.length === 12;

  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Day High / Day Low Score ───────────────────────────────────────────────
  // Uses localStorage so value survives page refresh.
  // State ONLY goes UP (for pos) or DOWN (for neg) — never resets mid-day.
  // Automatically resets on new trading day (key includes today's date).
  // Tab identifier: separate DH/DL per index
  const tabId = isBanknifty ? "BANKNIFTY" : isSensex ? "SENSEX" : "NIFTY";

  const todayKey = useMemo(() => {
    const d = new Date();
    // Use local date (IST-friendly) to avoid UTC midnight edge-cases
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return `${dateStr}_${tabId}`;
  }, [tabId]);

  const [dayHighScore, setDayHighScore] = useState<number>(() => {
    try {
      const d = new Date();
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const tab = stocks.length === 12 ? "BANKNIFTY" : stocks.length === 30 ? "SENSEX" : "NIFTY";
      const v = localStorage.getItem(`dayHighScore_${dateStr}_${tab}`);
      return v ? parseFloat(v) : 0;
    } catch { return 0; }
  });

  const [dayLowScore, setDayLowScore] = useState<number>(() => {
    try {
      const d = new Date();
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const tab = stocks.length === 12 ? "BANKNIFTY" : stocks.length === 30 ? "SENSEX" : "NIFTY";
      const v = localStorage.getItem(`dayLowScore_${dateStr}_${tab}`);
      return v ? parseFloat(v) : 0;
    } catch { return 0; }
  });

  // Stable refs to avoid stale closure in useEffect
  const dayHighRef = useRef(dayHighScore);
  const dayLowRef  = useRef(dayLowScore);

  // ── Reload DH/DL from localStorage whenever tab changes ──────────────────
  // (useState initializer runs only once at mount; this handles tab switching)
  useEffect(() => {
    const storedHigh = localStorage.getItem(`dayHighScore_${todayKey}`);
    const storedLow  = localStorage.getItem(`dayLowScore_${todayKey}`);
    const newHigh = storedHigh ? parseFloat(storedHigh) : 0;
    const newLow  = storedLow  ? parseFloat(storedLow)  : 0;
    setDayHighScore(newHigh);
    setDayLowScore(newLow);
    dayHighRef.current = newHigh;
    dayLowRef.current  = newLow;
  }, [todayKey]); // todayKey = date_TABID → changes on tab switch


  const [fontSize, setFontSize] = useState(() => {
    return Number(localStorage.getItem("summary-font-size")) || 12; // default 12px
  });

  const adjustFont = (amount: number) => {
    setFontSize(prev => {
      const next = Math.max(9, Math.min(18, prev + amount));
      localStorage.setItem("summary-font-size", String(next));
      return next;
    });
  };

  // Dynamic background style generator based on net score value (big vs small, positive vs negative)
  // Highly optimized to be extremely subtle and soft (ekdum halka light)
  const getCardBgStyle = (netScore: number) => {
    if (netScore === 0) return {};
    
    const absScore = Math.abs(netScore);
    const intensity = Math.min(absScore / 45, 1); // Full solid color intensity at 45 score difference
    
    if (netScore > 0) {
      if (darkMode) {
        // Extremely subtle green opacity: 0.02 (base) to 0.08 (peak intensity)
        const opacity = 0.02 + intensity * 0.06;
        return {
          background: `linear-gradient(135deg, rgba(16, 185, 129, ${opacity}), rgba(4, 120, 87, ${opacity * 0.5}))`,
          borderColor: `rgba(52, 211, 153, ${0.06 + intensity * 0.14})`
        };
      } else {
        // Extremely soft green opacity for light mode: 0.03 (base) to 0.10 (peak intensity)
        const opacity = 0.03 + intensity * 0.07;
        return {
          background: `linear-gradient(135deg, rgba(16, 185, 129, ${opacity}), rgba(5, 150, 105, ${opacity * 0.6}))`,
          borderColor: `rgba(16, 185, 129, ${0.08 + intensity * 0.17})`,
          color: "#000000"
        };
      }
    } else {
      if (darkMode) {
        // Extremely subtle red opacity: 0.02 (base) to 0.08 (peak intensity)
        const opacity = 0.02 + intensity * 0.06;
        return {
          background: `linear-gradient(135deg, rgba(239, 68, 68, ${opacity}), rgba(153, 27, 27, ${opacity * 0.5}))`,
          borderColor: `rgba(248, 113, 113, ${0.06 + intensity * 0.14})`
        };
      } else {
        // Extremely soft red opacity for light mode: 0.03 (base) to 0.10 (peak intensity)
        const opacity = 0.03 + intensity * 0.07;
        return {
          background: `linear-gradient(135deg, rgba(239, 68, 68, ${opacity}), rgba(220, 38, 38, ${opacity * 0.6}))`,
          borderColor: `rgba(239, 68, 68, ${0.08 + intensity * 0.17})`,
          color: "#000000"
        };
      }
    }
  };

  // Pre-calculate sparkline data for Overall, 5M, 15M, 30M, and 1H based on backup snapshots
  const sparklines = useMemo(() => {
    const isSensexLocal = stocks.length === 30;
    const isBankniftyLocal = stocks.length === 12;
    const nextSliceEnd = isBankniftyLocal ? 12 : (isSensexLocal ? 22 : 25);
    const sortedByWeight = [...stocks].sort((a, b) => b.weightage - a.weightage);
    const top25Stocks = sortedByWeight.slice(0, nextSliceEnd);

    const data: Record<string, number[]> = {
      OVERALL: [],
      "5M": [],
      "15M": [],
      "30M": [],
      "1H": []
    };

    if (!backup || Object.keys(backup).length === 0) {
      return data;
    }

    const activeCols = TIME_COLUMNS.filter(col => {
      return top25Stocks.some(st => backup[st.symbol]?.[col] !== undefined);
    });

    if (activeCols.length === 0) {
      return data;
    }

    activeCols.forEach((col, colIdx) => {
      const scoresAtCol: Record<string, number> = {};
      top25Stocks.forEach(st => {
        scoresAtCol[st.symbol] = backup[st.symbol]?.[col] ?? 0;
      });

      const overallNet = Object.values(scoresAtCol).reduce((sum, s) => sum + s, 0);
      data.OVERALL.push(overallNet);

      if (colIdx > 0) {
        const prevCol = activeCols[colIdx - 1];
        const diff5m = top25Stocks.reduce((sum, st) => {
          return sum + ((backup[st.symbol]?.[col] ?? 0) - (backup[st.symbol]?.[prevCol] ?? 0));
        }, 0);
        data["5M"].push(diff5m);
      } else {
        data["5M"].push(0);
      }

      if (colIdx >= 3) {
        const prevCol = activeCols[colIdx - 3];
        const diff15m = top25Stocks.reduce((sum, st) => {
          return sum + ((backup[st.symbol]?.[col] ?? 0) - (backup[st.symbol]?.[prevCol] ?? 0));
        }, 0);
        data["15M"].push(diff15m);
      } else {
        data["15M"].push(0);
      }

      if (colIdx >= 6) {
        const prevCol = activeCols[colIdx - 6];
        const diff30m = top25Stocks.reduce((sum, st) => {
          return sum + ((backup[st.symbol]?.[col] ?? 0) - (backup[st.symbol]?.[prevCol] ?? 0));
        }, 0);
        data["30M"].push(diff30m);
      } else {
        data["30M"].push(0);
      }

      if (colIdx >= 12) {
        const prevCol = activeCols[colIdx - 12];
        const diff1h = top25Stocks.reduce((sum, st) => {
          return sum + ((backup[st.symbol]?.[col] ?? 0) - (backup[st.symbol]?.[prevCol] ?? 0));
        }, 0);
        data["1H"].push(diff1h);
      } else {
        data["1H"].push(0);
      }
    });

    return data;
  }, [stocks, backup]);

  // Compute box variables for a given set of scores
  const getBoxMetrics = (scores: { symbol: string; score: number }[], originalStocks: StockData[]): BoxValues => {
    const isSensexLocal = originalStocks.length === 30;
    const isBankniftyLocal = originalStocks.length === 12;
    const nextSliceEnd = isBankniftyLocal ? 12 : (isSensexLocal ? 22 : 25);

    // Sort in descending weightage order, matches original stocks
    const mapped = originalStocks.map(st => {
      const match = scores.find(sc => sc.symbol === st.symbol);
      return {
        symbol: st.symbol,
        weightage: st.weightage,
        score: match ? match.score : 0
      };
    });

    // Sort by weightage descending first to find top 10 and next weighted stocks
    const sortedByWeight = [...mapped].sort((a, b) => b.weightage - a.weightage);
    const top10Weighted = sortedByWeight.slice(0, 10);
    const nextWeighted = sortedByWeight.slice(10, nextSliceEnd);

    // POSITIVE:
    // T10 = sum of ONLY POSITIVE scores from top 10 weighted stocks
    const top10Pos = top10Weighted.filter(m => m.score > 0).reduce((acc, curr) => acc + curr.score, 0);
    // N15 or N12 = sum of ONLY POSITIVE scores from next 15/12 weighted stocks
    const next15Pos = nextWeighted.filter(m => m.score > 0).reduce((acc, curr) => acc + curr.score, 0);
    // All 50/30 positive sum (retained unchanged)
    const all50Pos = mapped.filter(m => m.score > 0).reduce((acc, curr) => acc + curr.score, 0);

    // TOTALS:
    // Calculate Net Score only from Top 25 (or Top 22 for SENSEX) weightage stocks
    const netScore = sortedByWeight.slice(0, nextSliceEnd).reduce((acc, curr) => acc + curr.score, 0);

    // NEGATIVE:
    // All 50/30 negative sum (retained unchanged)
    const all50Neg = mapped.filter(m => m.score < 0).reduce((acc, curr) => acc + curr.score, 0);
    // T10 = sum of ONLY NEGATIVE scores from top 10 weighted stocks
    const top10Neg = top10Weighted.filter(m => m.score < 0).reduce((acc, curr) => acc + curr.score, 0);
    // N15 or N12 = sum of ONLY NEGATIVE scores from next 15/12 weighted stocks
    const next15Neg = nextWeighted.filter(m => m.score < 0).reduce((acc, curr) => acc + curr.score, 0);

    return {
      top10Pos: parseFloat(top10Pos.toFixed(2)),
      next15Pos: parseFloat(next15Pos.toFixed(2)),
      all50Pos: parseFloat(all50Pos.toFixed(2)),
      netScore: parseFloat(netScore.toFixed(2)),
      all50Neg: parseFloat(all50Neg.toFixed(2)),
      top10Neg: parseFloat(top10Neg.toFixed(2)),
      next15Neg: parseFloat(next15Neg.toFixed(2))
    };
  };

  // Compute metrics for each of the 5 timeframe boxes with premium duration color configurations
  const boxes = [
    {
      name: "OVERALL",
      values: getBoxMetrics(stocks.map(s => ({ symbol: s.symbol, score: s.score })), stocks),
      accentBar: "bg-emerald-500 shadow-[0_-3px_12px_rgba(16,185,129,0.55)]",
      accentBorder: "hover:border-emerald-500/40 hover:shadow-[0_4px_30px_rgba(16,185,129,0.16)]",
      accentText: "text-emerald-500 dark:text-emerald-400"
    },
    {
      name: "5M",
      values: getBoxMetrics(stocks.map(s => ({ symbol: s.symbol, score: s.scoreDifference })), stocks),
      accentBar: "bg-sky-400 shadow-[0_-3px_12px_rgba(56,189,248,0.55)]",
      accentBorder: "hover:border-sky-400/40 hover:shadow-[0_4px_30px_rgba(56,189,248,0.16)]",
      accentText: "text-sky-500 dark:text-sky-400"
    },
    {
      name: "15M",
      values: getBoxMetrics(stocks.map(s => ({ symbol: s.symbol, score: s.score15mDiff })), stocks),
      accentBar: "bg-blue-500 shadow-[0_-3px_12px_rgba(59,130,246,0.55)]",
      accentBorder: "hover:border-blue-500/40 hover:shadow-[0_4px_30px_rgba(59,130,246,0.16)]",
      accentText: "text-blue-500 dark:text-blue-400"
    },
    {
      name: "30M",
      values: getBoxMetrics(stocks.map(s => ({ symbol: s.symbol, score: s.score30mDiff })), stocks),
      accentBar: "bg-indigo-500 shadow-[0_-3px_12px_rgba(99,102,241,0.55)]",
      accentBorder: "hover:border-indigo-500/40 hover:shadow-[0_4px_30px_rgba(99,102,241,0.16)]",
      accentText: "text-indigo-500 dark:text-indigo-400"
    },
    {
      name: "1H",
      values: getBoxMetrics(stocks.map(s => ({ symbol: s.symbol, score: s.score1hDiff })), stocks),
      accentBar: "bg-fuchsia-500 shadow-[0_-3px_12px_rgba(217,70,239,0.55)]",
      accentBorder: "hover:border-fuchsia-500/40 hover:shadow-[0_4px_30px_rgba(217,70,239,0.16)]",
      accentText: "text-fuchsia-500 dark:text-fuchsia-400"
    }
  ];

  // ── Live overall positive/negative score (memoized for stable useEffect dependency) ──
  const { livePos, liveNeg } = useMemo(() => {
    const ob = boxes.find(b => b.name === "OVERALL");
    return ob
      ? { livePos: ob.values.all50Pos, liveNeg: ob.values.all50Neg }
      : { livePos: 0, liveNeg: 0 };
  }, [boxes]);

  const posDelta = livePos - dayHighScore;
  const negDelta = liveNeg - dayLowScore;

  // ── Update Day High / Day Low Score via useEffect ─────────────────────────
  // RULE: dayHighScore only goes UP. dayLowScore only goes DOWN.
  // Comparison uses refs to avoid stale-closure issues.
  useEffect(() => {
    if (livePos > dayHighRef.current) {
      dayHighRef.current = livePos;
      setDayHighScore(livePos);
      try { localStorage.setItem(`dayHighScore_${todayKey}`, String(livePos)); } catch {}
    }
  }, [livePos, todayKey]);

  useEffect(() => {
    if (liveNeg < dayLowRef.current) {
      dayLowRef.current = liveNeg;
      setDayLowScore(liveNeg);
      try { localStorage.setItem(`dayLowScore_${todayKey}`, String(liveNeg)); } catch {}
    }
  }, [liveNeg, todayKey]);


  // Dynamic Sentiment status micro-pill generator using requested thresholds (5.0 / -5.0)
  const getSentiment = (netScore: number) => {
    if (netScore > 5.0) {
      return {
        label: "BULLISH",
        textClass: darkMode ? "text-emerald-400" : "text-emerald-800",
        bgClass: darkMode ? "bg-emerald-500/10 border-emerald-500/25 shadow-[0_0_8px_rgba(16,185,129,0.15)]" : "bg-emerald-50 border-emerald-200",
        icon: "▲"
      };
    }
    if (netScore < -5.0) {
      return {
        label: "BEARISH",
        textClass: darkMode ? "text-rose-400" : "text-rose-800",
        bgClass: darkMode ? "bg-rose-500/10 border-rose-500/25 shadow-[0_0_8px_rgba(244,63,94,0.15)]" : "bg-rose-50 border-rose-200",
        icon: "▼"
      };
    }
    return {
      label: "NEUTRAL",
      textClass: darkMode ? "text-slate-400" : "text-slate-700",
      bgClass: darkMode ? "bg-slate-500/5 border-slate-500/20" : "bg-slate-100 border-slate-200",
      icon: "◆"
    };
  };

  // Dynamic mathematical Heatmap conditional formatting system
  const getHeatmapStyle = (value: number, maxExpected: number) => {
    if (value === 0) {
      return darkMode 
        ? { backgroundColor: "rgba(71, 85, 105, 0.12)", borderColor: "rgba(71, 85, 105, 0.2)" } 
        : { backgroundColor: "rgba(241, 245, 249, 0.9)", borderColor: "rgba(226, 232, 240, 1)" };
    }
    const intensity = Math.min(Math.abs(value) / maxExpected, 1);
    const finalOpacity = Math.max(0.15, intensity);
    if (value > 0) {
      return { 
        backgroundColor: `rgba(22, 163, 74, ${finalOpacity})`,
        borderColor: `rgba(34, 197, 94, ${Math.min(finalOpacity + 0.15, 1)})`
      };
    } else {
      return { 
        backgroundColor: `rgba(220, 38, 38, ${finalOpacity})`,
        borderColor: `rgba(239, 68, 68, ${Math.min(finalOpacity + 0.15, 1)})`
      };
    }
  };

  // Dynamic text color contrast formatter: dark font on light background, white font on dark background
  const getTextColor = (value: number, maxExpected: number) => {
    if (value === 0) {
      return darkMode ? "text-slate-300 font-medium" : "text-slate-600 font-medium";
    }
    if (darkMode) {
      return "text-white font-black drop-shadow-sm";
    }
    // In light mode, backgrounds are bright/pastel, so white text is unreadable. Always use black.
    return "text-black font-black";
  };

  // Gap calculations for Nifty and Sensex Opening Status Badges
  const niftyGapPoints = (todayOpen !== undefined && previousClose !== undefined) ? todayOpen - previousClose : 0;
  let niftyStatus = "";
  let niftyBoxClass = "";
  let niftyTextClass = "";

  if (niftyGapPoints > 15) {
    niftyStatus = "GU 🔼";
    niftyBoxClass = "bg-green-950/80 border border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.15)]";
    niftyTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(74,222,128,0.4)]";
  } else if (niftyGapPoints < -15) {
    niftyStatus = "GD 🔽";
    niftyBoxClass = "bg-red-950/80 border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]";
    niftyTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(248,113,113,0.4)]";
  } else {
    niftyStatus = "FLAT OPEN ➖";
    niftyBoxClass = "bg-[#050914] border border-white/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]";
    niftyTextClass = "text-slate-300";
  }

  const sensexGapPoints = (sensexOpen !== undefined && sensexPrev !== undefined) ? sensexOpen - sensexPrev : 0;
  let sensexStatus = "";
  let sensexBoxClass = "";
  let sensexTextClass = "";

  if (sensexGapPoints > 15) {
    sensexStatus = "GU 🔼";
    sensexBoxClass = "bg-green-950/80 border border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.15)]";
    sensexTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(74,222,128,0.4)]";
  } else if (sensexGapPoints < -15) {
    sensexStatus = "GD 🔽";
    sensexBoxClass = "bg-red-950/80 border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]";
    sensexTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(248,113,113,0.4)]";
  } else {
    sensexStatus = "FLAT OPEN ➖";
    sensexBoxClass = "bg-[#050914] border border-white/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]";
    sensexTextClass = "text-slate-300";
  }

  const bankniftyGapPoints = (bankniftyOpen !== undefined && bankniftyPrev !== undefined) ? bankniftyOpen - bankniftyPrev : 0;
  let bankniftyStatus = "";
  let bankniftyBoxClass = "";
  let bankniftyTextClass = "";

  if (bankniftyGapPoints > 15) {
    bankniftyStatus = "GU 🔼";
    bankniftyBoxClass = "bg-green-950/80 border border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.15)]";
    bankniftyTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(74,222,128,0.4)]";
  } else if (bankniftyGapPoints < -15) {
bankniftyStatus = "GD 🔽";
    bankniftyBoxClass = "bg-red-950/80 border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]";
    bankniftyTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(248,113,113,0.4)]";
  } else {
    bankniftyStatus = "FLAT OPEN ➖";
    bankniftyBoxClass = "bg-[#050914] border border-white/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]";
    bankniftyTextClass = "text-slate-300";
  }

  return (
    <div className={`flex flex-col gap-0.5 w-full relative ${darkMode ? "" : ""}`}>
      {/* Spreadsheet-grade Toolbar Font Sizer (Absolute Top Right) */}
      <div className={`absolute top-0 right-2 z-50 flex items-center gap-1.5 border rounded-lg px-2 py-0.5 select-none scale-[0.8] origin-top-right transition-all shadow-md ${
        darkMode 
          ? "bg-[#0e1628]/90 border-[#263756]/80 text-slate-200" 
          : "bg-slate-100/90 border-slate-200/80 text-slate-700 shadow-sm"
      }`}>
        <button 
          onClick={() => adjustFont(-1)} 
          className="hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors font-black px-1.5 text-xs cursor-pointer select-none"
          title="Decrease Sizing"
        >
          &minus;
        </button>
        <div className="h-3 w-[1px] dark:bg-slate-800/60 bg-slate-200" />
        <span className="text-[8px] opacity-75 font-black uppercase tracking-wider font-sans">FONT</span>
        <div className="h-3 w-[1px] dark:bg-slate-800/60 bg-slate-200" />
        <button 
          onClick={() => adjustFont(1)} 
          className="hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors font-black px-1.5 text-xs cursor-pointer select-none"
          title="Increase Sizing"
        >
          +
        </button>
      </div>

      {/* Premium Autopsy Header Toolbar */}
      <div 
        className="flex items-center px-3 py-1.5 select-none flex-wrap gap-1 rounded-xl"
        style={{
          background: "linear-gradient(135deg, rgba(6,11,23,0.85) 0%, rgba(4,8,16,0.95) 50%, rgba(10,17,40,0.85) 100%)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.05)",
          marginBottom: "4px"
        }}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Ultra-Premium Title Badge */}
          <div className="relative flex items-center gap-2 px-2.5 py-1 rounded-xl bg-[#050814] border border-[#1e1b4b] shadow-[0_0_20px_rgba(79,70,229,0.15),inset_0_0_12px_rgba(99,102,241,0.1)] overflow-hidden z-10">
            {/* Core Background Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-transparent to-fuchsia-900/30 animate-pulse" />
            
            {/* Cyberpunk Glowing Core */}
            <div className="relative flex items-center justify-center w-3 h-3 z-10">
              <div className="absolute w-full h-full bg-cyan-400/40 rounded-full animate-ping" />
              <div className="absolute w-1.5 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,1)]" />
              <div className="w-[3px] h-[3px] bg-white rounded-full z-10 shadow-[0_0_5px_white]" />
            </div>

            {/* Typography */}
            <div className="relative flex flex-col justify-center z-10">
              <span className="text-[12px] font-black tracking-[0.12em] uppercase bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-indigo-300 to-fuchsia-300 drop-shadow-[0_0_8px_rgba(99,102,241,0.6)] leading-none mb-[2px]">
                {isBanknifty ? "BANKNIFTY" : (isSensex ? "SENSEX" : "NIFTY")}
              </span>
              <span className="text-[8px] font-black tracking-[0.3em] uppercase text-indigo-400/90 leading-none">
                FLOW
              </span>
            </div>
            
            {/* Edge Highlights */}
            <div className="absolute left-0 top-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
            <div className="absolute right-0 bottom-0 w-[1px] h-full bg-gradient-to-t from-transparent via-fuchsia-500/50 to-transparent" />
          </div>

          {/* Header Gauges Row */}
          <div className="flex items-start gap-0.5 ml-1 pl-1.5 border-l border-indigo-500/20">
            {/* Conviction Gauge */}
            <div className="flex flex-col items-center">
              <div className="flex items-center bg-[#0d0906] rounded-full border border-[#3d2911] shadow-[0_0_10px_rgba(245,158,11,0.15)] p-[1.5px]">
                <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#2a1d0d]" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#f59e0b]" strokeWidth="2.5" strokeDasharray="97.4" strokeDashoffset={97.4 - (conviction * 0.974)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s ease-out" }} />
                  </svg>
                  <div className="flex flex-col items-center justify-center translate-y-[-1px]">
                    <span className="text-[10px] leading-none mb-[1px]">⏳</span>
                    <span className="text-[11px] font-black text-white leading-none tracking-tighter drop-shadow-md">{Math.round(conviction)}%</span>
                  </div>
                </div>
              </div>
              <span className="text-[7px] font-black text-slate-300 uppercase tracking-[0.1em] mt-1" style={{ textShadow: "0 0 2px rgba(255,255,255,0.2)" }}>CONVICTION</span>
            </div>

            {/* Momentum Gauge */}
            <div className="flex flex-col items-center">
              <div className="flex items-center bg-[#04110d] rounded-full border border-[#0d2e23] shadow-[0_0_10px_rgba(16,185,129,0.15)] p-[1.5px]">
                <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#0f2e22]" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#10b981]" strokeWidth="2.5" strokeDasharray="97.4" strokeDashoffset={97.4 - (momentum * 0.974)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s ease-out" }} />
                  </svg>
                  <span className="text-[12px] font-black text-white leading-none tracking-tighter drop-shadow-md">{Math.round(momentum)}</span>
                </div>
              </div>
              <span className="text-[7px] font-black text-slate-400 uppercase tracking-[0.1em] mt-1">MOMENTUM</span>
            </div>

            {/* Alignment Gauge */}
            <div className="flex flex-col items-center">
              <div className="flex items-center bg-[#070b14] rounded-full border border-[#111c33] shadow-[0_0_10px_rgba(59,130,246,0.1)] p-[1.5px]">
                <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#101b33]" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#10b981]" strokeWidth="2.5" strokeDasharray="97.4" strokeDashoffset={97.4 - (alignment * 0.974)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s ease-out" }} />
                  </svg>
                  <span className="text-[11px] font-black text-white leading-none tracking-tighter" style={{ textShadow: "1px 0 #ef4444, -1px 0 #06b6d4" }}>{Math.round(alignment)}%</span>
                </div>
              </div>
              <span className="text-[7px] font-black uppercase tracking-[0.1em] mt-1 text-blue-400" style={{ textShadow: "0 0 3px rgba(96,165,250,0.5)" }}>ALIGNMENT</span>
            </div>

            {/* Confidence Gauge */}
            <div className="flex flex-col items-center">
              <div className="flex items-center bg-[#0f0702] rounded-full border border-[#331806] shadow-[0_0_10px_rgba(249,115,22,0.15)] p-[1.5px]">
                <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#2a1305]" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#f97316]" strokeWidth="2.5" strokeDasharray="97.4" strokeDashoffset={97.4 - (confidence * 0.974)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s ease-out" }} />
                  </svg>
                  <span className="text-[12px] font-black text-white leading-none tracking-tighter drop-shadow-md">{Math.round(confidence)}</span>
                </div>
              </div>
              <span className="text-[7px] font-black text-slate-400 uppercase tracking-[0.1em] mt-1">CONFIDENCE</span>
              <div className="flex items-center gap-[4px] mt-[1.5px]">
                <span className="text-[7px] font-black text-emerald-400 font-mono tracking-tighter">CE:{ceProb}%</span>
                <span className="text-[7px] text-slate-600 leading-none">|</span>
                <span className="text-[7px] font-black text-rose-400 font-mono tracking-tighter">PE:{peProb}%</span>
              </div>
            </div>

            {/* HW Bias Gauge */}
            {(() => {
              const top5 = [...stocks].sort((a,b) => (Number(b.weightage)||0) - (Number(a.weightage)||0)).slice(0, 5);
              const hwNetScore = top5.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
              const hwGauge = Math.max(0, Math.min(100, 50 + (hwNetScore * 1.5)));
              return (
                <div className="flex flex-col items-center ml-1">
                  <div className="flex items-center bg-[#0d0411] rounded-full border border-[#2b0d3d] shadow-[0_0_10px_rgba(217,70,239,0.15)] p-[1.5px]">
                    <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#1e0a29]" strokeWidth="2.5" />
                        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#d946ef]" strokeWidth="2.5" strokeDasharray="97.4" strokeDashoffset={97.4 - (hwGauge * 0.974)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s ease-out" }} />
                      </svg>
                      <span className="text-[11px] font-black text-white leading-none tracking-tighter drop-shadow-md">{Math.round(hwGauge)}%</span>
                    </div>
                  </div>
                  <span className="text-[7px] font-black text-fuchsia-400 uppercase tracking-[0.1em] mt-1" style={{ textShadow: "0 0 3px rgba(217,70,239,0.5)" }}>HW-BIAS</span>
                </div>
              );
            })()}

            {/* Breadth Gauge */}
            {(() => {
              const advances = stocks.filter(s => (Number(s.score) || 0) > 0).length;
              const declines = stocks.filter(s => (Number(s.score) || 0) < 0).length;
              const total = Math.max(1, advances + declines);
              const breadthPct = (advances / total) * 100;
              return (
                <div className="flex flex-col items-center ml-1">
                  <div className="flex items-center bg-[#020e11] rounded-full border border-[#0a313d] shadow-[0_0_10px_rgba(6,182,212,0.15)] p-[1.5px]">
                    <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#061d26]" strokeWidth="2.5" />
                        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#06b6d4]" strokeWidth="2.5" strokeDasharray="97.4" strokeDashoffset={97.4 - (breadthPct * 0.974)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s ease-out" }} />
                      </svg>
                      <span className="text-[12px] font-black text-white leading-none tracking-tighter drop-shadow-md">{Math.round(breadthPct)}</span>
                    </div>
                  </div>
                  <span className="text-[7px] font-black text-cyan-400 uppercase tracking-[0.1em] mt-1" style={{ textShadow: "0 0 3px rgba(6,182,212,0.5)" }}>BREADTH</span>
                  <div className="flex items-center gap-[4px] mt-[1.5px]">
                    <span className="text-[7px] font-black text-emerald-400 font-mono tracking-tighter">A:{advances}</span>
                    <span className="text-[7px] text-slate-600 leading-none">|</span>
                    <span className="text-[7px] font-black text-rose-400 font-mono tracking-tighter">D:{declines}</span>
                  </div>
                </div>
              );
            })()}

            {/* Gravity Gauge */}
            {(() => {
              const gravityRaw = (momentum + (velocity * 2) + alignment) / 3;
              const gravity = Math.max(0, Math.min(100, gravityRaw));
              return (
                <div className="flex flex-col items-center ml-1">
                  <div className="flex items-center bg-[#110206] rounded-full border border-[#3d0a16] shadow-[0_0_10px_rgba(225,29,72,0.15)] p-[1.5px]">
                    <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#26050e]" strokeWidth="2.5" />
                        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-[#e11d48]" strokeWidth="2.5" strokeDasharray="97.4" strokeDashoffset={97.4 - (gravity * 0.974)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s ease-out" }} />
                      </svg>
                      <span className="text-[12px] font-black text-white leading-none tracking-tighter drop-shadow-md">{Math.round(gravity)}</span>
                    </div>
                  </div>
                  <span className="text-[7px] font-black text-rose-500 uppercase tracking-[0.1em] mt-1" style={{ textShadow: "0 0 3px rgba(225,29,72,0.5)" }}>GRAVITY</span>
                </div>
              );
            })()}

            {/* CE/PE Probability Bars */}
            <div className="flex flex-col gap-1.5 ml-1 border-l border-slate-700/40 pl-2 justify-center bg-[#050b14] px-2 py-1 rounded-lg shadow-inner">
              <MiniProbBar
                label="CE PROBABILITY"
                value={ceProb}
                color="#10b981"
                bg="#10b981"
              />
              <MiniProbBar
                label="PE PROBABILITY"
                value={peProb}
                color="#ef4444"
                bg="#ef4444"
              />
            </div>

            {/* Gap Opening (Moved to Flow Tab) */}
            <div className="flex flex-col justify-center ml-1 border-l border-slate-700/40 pl-2 bg-[#050b14] px-2 py-1 rounded-lg shadow-inner gap-1">
              <span className="text-[9px] font-black text-amber-400 tracking-widest uppercase flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
                GAP OPENING
              </span>
              <div className="flex items-center gap-2">
                {todayOpen !== undefined && previousClose !== undefined && (
                  <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black border transition-all duration-300 ${niftyBoxClass}`}>
                    <span className="text-slate-400">N:</span>
                    <span className={`text-[10px] font-mono ${niftyTextClass}`}>
                      {niftyStatus} {niftyGapPoints > 0 ? "+" : ""}{niftyGapPoints.toFixed(1)}
                    </span>
                  </div>
                )}
                {sensexOpen !== undefined && sensexPrev !== undefined && (
                  <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black border transition-all duration-300 ${sensexBoxClass}`}>
                    <span className="text-slate-400">S:</span>
                    <span className={`text-[10px] font-mono ${sensexTextClass}`}>
                      {sensexStatus} {sensexGapPoints > 0 ? "+" : ""}{sensexGapPoints.toFixed(1)}
                    </span>
                  </div>
                )}
                {bankniftyOpen !== undefined && bankniftyPrev !== undefined && (
                  <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black border transition-all duration-300 ${bankniftyBoxClass}`}>
                    <span className="text-slate-400">BN:</span>
                    <span className={`text-[10px] font-mono ${bankniftyTextClass}`}>
                      {bankniftyStatus} {bankniftyGapPoints > 0 ? "+" : ""}{bankniftyGapPoints.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Time-Interval Market Velocity Studies Card (Advanced Dynamic Engine) */}
          {(() => {
            const activeIndex = stocks.find(s => s.ticker?.includes("INDEX")) || stocks[0];
            const h15 = breakout?.high15m ?? 0;
            const l15 = breakout?.low15m  ?? 0;
            const use15m = h15 > 0 && l15 > 0 && h15 > l15;
            const marketRange = use15m
              ? (h15 - l15)
              : (activeIndex?.high > 0 && activeIndex?.low > 0 ? (activeIndex.high - activeIndex.low) : 0);
            const basePrice = use15m
              ? ((h15 + l15) / 2)
              : (activeIndex?.open > 0 ? activeIndex.open : activeIndex?.ltp ?? 1);
            const volPct = basePrice > 0 && marketRange > 0 ? (marketRange / basePrice) * 100 : 0;
            const [speedLabel, speedColor, barColor, icon] = volPct >= 0.15
              ? ["FAST / HIGH VOL", "text-rose-400 bg-rose-500/10 border-rose-500/20", "bg-rose-500", "⚡"]
              : volPct >= 0.08
              ? ["MODERATE", "text-indigo-400 bg-indigo-500/10 border-indigo-500/20", "bg-indigo-500", "📈"]
              : ["SLOW", "text-slate-400 bg-slate-500/10 border-slate-500/20", "bg-slate-600", "⏳"];

            const nowIST = new Date(Date.now() + 5.5 * 3_600_000);
            const h = nowIST.getUTCHours();
            const m = nowIST.getUTCMinutes();
            const mFloor = m - (m % 15);
            const mEnd = mFloor + 15;
            const hEnd = h + (mEnd >= 60 ? 1 : 0);
            const timeLabel = `${String(h).padStart(2,'0')}:${String(mFloor).padStart(2,'0')} – ${String(hEnd).padStart(2,'0')}:${String(mEnd % 60).padStart(2,'0')}`;

            return (
              <div className="flex items-center gap-1.5 ml-auto">
                {/* DH/DL */}
                <div className="flex items-center gap-1.5 pr-0.5">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-950/80 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)] text-emerald-400">
                    <span className="text-[11px] opacity-80 font-sans font-black tracking-wider">DH</span>
                    <span className="text-[15px] font-black leading-none drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]">{dayHighScore.toFixed(1)}</span>
                    <span className={`text-[10px] font-bold ${posDelta < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      ({posDelta >= 0 ? "+" : ""}{posDelta.toFixed(1)})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-rose-950/80 border border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.25)] text-rose-400">
                    <span className="text-[11px] opacity-80 font-sans font-black tracking-wider">DL</span>
                    <span className="text-[15px] font-black leading-none drop-shadow-[0_0_5px_rgba(251,113,133,0.5)]">{dayLowScore.toFixed(1)}</span>
                    <span className={`text-[10px] font-bold ${negDelta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      ({negDelta > 0 ? "+" : ""}{negDelta.toFixed(1)})
                    </span>
                  </div>
                </div>

                <div 
                  className="flex items-center gap-2 px-3 py-1 rounded-xl shadow-lg flex-shrink-0 transition-all duration-500"
                  style={{
                    background: "linear-gradient(90deg, rgba(3,46,35,0.4) 0%, rgba(2,31,23,0.6) 100%)",
                    border: "1px solid rgba(4,120,87,0.3)",
                    boxShadow: "inset 0 0 20px rgba(16,185,129,0.05)"
                  }}
                >
                  <div className="flex items-center gap-1.5 border-r border-emerald-600/30 pr-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 drop-shadow-md">
                      VELOCITY ENGINE
                    </span>
                    <div className="text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-1.5 bg-emerald-950/40 px-2 py-0.5 rounded-lg border border-emerald-500/20 shadow-[inset_0_0_8px_rgba(16,185,129,0.1)]">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                      {timeLabel}
                    </div>
                  </div>
                <div className="flex items-center gap-2">
                  <div className="text-[11px] font-mono font-black text-white bg-black/40 px-2 py-0.5 rounded-lg border border-white/5 shadow-inner">
                    ₹{marketRange.toFixed(1)}
                  </div>
                  <div className="flex items-center gap-1.5 bg-black/40 px-2 py-0.5 rounded-lg border border-white/5 shadow-inner">
                    <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${Math.min(100, (volPct / 0.30) * 100)}%` }} />
                    </div>
                    <span className="font-bold text-teal-400 text-[10px] font-mono">{volPct.toFixed(3)}%</span>
                  </div>
                  <div>
                    <span className={`px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase shadow-sm ${speedColor} ${speedLabel.includes("FAST") ? "animate-[pulse_0.7s_ease-in-out_infinite]" : ""}`}>
                      {icon} {speedLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-950/60 px-2 py-0.5 rounded-lg border border-slate-800 shadow-inner border-l-2 border-l-sky-500/50">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Tick Pace:</span>
                    <span className={`text-[10px] font-black ${velocity > 15 ? "text-rose-400" : velocity > 5 ? "text-amber-400" : "text-emerald-400"}`}>
                      {velocity.toFixed(1)} <span className="text-[8px] opacity-70">pts/s</span>
                    </span>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${velocity > 15 ? "bg-rose-500/20 text-rose-300 animate-[pulse_0.5s_ease-in-out_infinite] shadow-[0_0_8px_rgba(225,29,72,0.8)]" : velocity > 5 ? "bg-amber-500/20 text-amber-300 animate-[pulse_0.8s_ease-in-out_infinite]" : "bg-emerald-500/20 text-emerald-300"}`}>
                      {velocity > 15 ? "HIGH VOL" : velocity > 5 ? "FAST" : "SLOW"}
                    </span>
                  </div>
                </div>
              </div>
              </div>
            );
          })()}

        </div>

      </div>



      {/* Grid containing the 5 timeframe cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-1 w-full" id="institutional-summary-boxes">
        {boxes.map((box) => {
          const v = box.values;
          const sentiment = getSentiment(v.netScore);

          // Calculate Strength Ratio % from positive and negative overall scores
          const totalAbs = v.all50Pos + Math.abs(v.all50Neg);
          const posPercent = totalAbs > 0 ? Math.round((v.all50Pos / totalAbs) * 100) : 50;
          const negPercent = 100 - posPercent;

          return (
            <div
              key={box.name}
              style={getCardBgStyle(v.netScore)}
              className={`border rounded-lg flex flex-col shadow-sm select-none duration-300 hover:scale-[1.01] transition-transform relative overflow-hidden ${
                darkMode
                  ? "bg-gradient-to-br from-[#121c33]/95 via-[#0e1628]/98 to-[#0b101c]/95 backdrop-blur-md text-white shadow-[0_2px_15px_rgba(99,102,241,0.04)] border-[#1d2a45] " + box.accentBorder
                  : "bg-gradient-to-br from-slate-50/95 via-slate-100/90 to-slate-200/95 backdrop-blur-md text-black shadow-[0_2px_10px_rgba(148,163,184,0.03)] border-slate-200 hover:border-indigo-300 hover:shadow-[0_4px_15px_rgba(99,102,241,0.05)]"
              }`}
            >
              {/* Glowing Top Accent Strip Color-matched to duration */}
              <div className={`h-[3px] w-full ${box.accentBar}`} />

              {/* Box Header - Transparent & Dynamic Status Badge */}
              <div className="flex items-center justify-between px-1.5 pt-1 pb-0.5 select-none border-b dark:border-slate-800/40 border-slate-200/60">
                <span className="font-sans font-black tracking-widest text-[10px] uppercase text-black dark:text-white drop-shadow-sm">
                  {box.name}
                </span>

                {/* Strength Ratio % mini-box */}
                <div className="flex items-center text-[8px] font-bold select-none gap-0.5">
                  <span className={`bg-green-700 dark:bg-green-800 text-white rounded-sm font-black transition-all duration-200 ${
                    posPercent > negPercent
                      ? "text-[12px] px-1.5 py-0.2 shadow-[0_0_8px_rgba(34,197,94,0.5)] z-10"
                      : posPercent < negPercent
                        ? "text-[7px] px-0.5 py-0.1 opacity-45"
                        : "text-[8.5px] px-1 py-0.1"
                  }`}>
                    {posPercent}%
                  </span>
                  <span className="text-slate-500 text-[0.45rem] mx-0.2">|</span>
                  <span className={`bg-red-700 dark:bg-red-800 text-white rounded-sm font-black transition-all duration-200 ${
                    negPercent > posPercent
                      ? "text-[12px] px-1.5 py-0.2 shadow-[0_0_8px_rgba(239,68,68,0.5)] z-10"
                      : negPercent < posPercent
                        ? "text-[7px] px-0.5 py-0.1 opacity-45"
                        : "text-[8.5px] px-1 py-0.1"
                  }`}>
                    {negPercent}%
                  </span>
                </div>
                
                {/* Dynamic Sentiment Status Micro-pill */}
                <div className={`flex items-center gap-0.5 text-[7px] font-black uppercase tracking-wider px-1.5 py-0.1 rounded-full border shadow-sm ${sentiment.bgClass} ${sentiment.textClass}`}>
                  <span className="scale-[0.65]">{sentiment.icon}</span>
                  <span>{sentiment.label}</span>
                </div>
              </div>

              {/* POSITIVES INSTRUMENT PANEL POCKET */}
              <div className={`mx-0.5 mt-0.5 mb-0.5 p-0.5 rounded-md border ${
                darkMode 
                  ? "bg-black/20 border-slate-800/50 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]" 
                  : "bg-slate-200/35 border-slate-300/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
              }`}>
                <div className="grid grid-cols-12 text-xs font-sans">
                  {/* All Positive score sum */}
                  <div 
                    className={`anti-flicker-cell col-span-6 flex flex-col justify-center items-center py-0.5 px-0.5 border-r min-h-[26px] rounded-l-md transition-all ${
                      darkMode ? "border-slate-800/85" : "border-slate-200"
                    } ${getTextColor(v.all50Pos, 50)}`}
                    style={getHeatmapStyle(v.all50Pos, 50)}
                  >
                    <span className="text-[7px] tracking-wider opacity-85 font-sans font-extrabold mb-0.5 leading-tight" style={{ fontSize: `${fontSize * 0.55}px` }}>
                      {isBanknifty ? "ALL 12 POS" : (isSensex ? "ALL 30 POS" : "ALL 50 POS")}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <span className="text-[8px] opacity-80">▲</span>
                      <span className="font-black tracking-tight" style={{ fontSize: `${fontSize * 1.1}px` }}>
                        {v.all50Pos > 0 ? `+${v.all50Pos}` : v.all50Pos}
                      </span>
                    </div>
                  </div>

                  {/* Right stack - T10 & N15 dynamic badges with color heat-mapping */}
                  <div className="col-span-6 flex flex-col gap-0.5 pl-0.5 justify-center">
                    {/* Top 10 Positive */}
                    <div 
                      className={`anti-flicker-cell flex justify-between items-center px-0.5 py-0 rounded transition-all border ${getTextColor(v.top10Pos, 100)}`}
                      style={getHeatmapStyle(v.top10Pos, 100)}
                    >
                      <span className="opacity-80 font-black text-[7px] uppercase tracking-wider">T10</span>
                      <span className="font-black flex items-center gap-0.5" style={{ fontSize: `${fontSize * 0.75}px` }}>
                        <span>▲</span>
                        <span>+{v.top10Pos}</span>
                      </span>
                    </div>
                    {/* Next 15/12 Positive */}
                    <div 
                      className={`anti-flicker-cell flex justify-between items-center px-0.5 py-0 rounded transition-all border ${getTextColor(v.next15Pos, 100)}`}
                      style={getHeatmapStyle(v.next15Pos, 100)}
                    >
                      <span className="opacity-80 font-black text-[7px] uppercase tracking-wider">{isBanknifty ? "N2" : (isSensex ? "N12" : "N15")}</span>
                      <span className="font-black flex items-center gap-0.5" style={{ fontSize: `${fontSize * 0.75}px` }}>
                        <span>▲</span>
                        <span>+{v.next15Pos}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* NET SCORE CENTRAL HERO DECK */}
              <div className="px-0.5 py-0.5 border-y dark:border-slate-800/40 border-slate-200/60">
                <div 
                  className={`anti-flicker-cell flex items-center justify-between px-1.5 py-0.5 rounded-md border relative overflow-hidden transition-all duration-350 ${getTextColor(v.netScore, 60)}`}
                  style={getHeatmapStyle(v.netScore, 60)}
                >
                  {/* Left accent vertical indicator bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[2px] ${
                    v.netScore > 0 
                      ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" 
                      : v.netScore < 0 
                        ? "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]" 
                        : "bg-slate-450"
                  }`} />
                  
                  <div className="flex items-center gap-1 pl-1">
                      <span className="font-sans text-[8px] tracking-wider uppercase font-black opacity-85">
                      {isBanknifty ? "T-12 Net" : (isSensex ? "T-22 Net" : "T-25 Net")}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-0.5">
                    <span className="text-[8px] opacity-75">
                      {v.netScore > 0 ? "▲" : v.netScore < 0 ? "▼" : "◆"}
                    </span>
                    <span className="font-sans font-black transition-colors duration-350" style={{ fontSize: `${fontSize * 1.1}px` }}>
                      {v.netScore > 0 ? `+${v.netScore}` : v.netScore}
                    </span>
                  </div>
                </div>
              </div>

              {/* NEGATIVES INSTRUMENT PANEL POCKET */}
              <div className={`mx-0.5 mt-0.5 mb-0.5 p-0.5 rounded-md border ${
                darkMode 
                  ? "bg-black/20 border-slate-800/50 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]" 
                  : "bg-slate-200/35 border-slate-300/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
              }`}>
                <div className="grid grid-cols-12 text-xs font-sans">
                  {/* All Negative score sum */}
                  <div 
                    className={`anti-flicker-cell col-span-6 flex flex-col justify-center items-center py-0.5 px-0.5 border-r min-h-[26px] rounded-l-md transition-all ${
                      darkMode ? "border-slate-800/85" : "border-slate-200"
                    } ${getTextColor(v.all50Neg, 50)}`}
                    style={getHeatmapStyle(v.all50Neg, 50)}
                  >
                    <span className="text-[7px] tracking-wider opacity-85 font-sans font-extrabold mb-0.5 leading-tight" style={{ fontSize: `${fontSize * 0.55}px` }}>
                      {isBanknifty ? "ALL 12 NEG" : (isSensex ? "ALL 30 NEG" : "ALL 50 NEG")}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <span className="text-[8px] opacity-80">▼</span>
                      <span className="font-black tracking-tight" style={{ fontSize: `${fontSize * 1.1}px` }}>
                        {v.all50Neg}
                      </span>
                    </div>
                  </div>

                  {/* Right stack - T10 & N15 dynamic badges with color heat-mapping */}
                  <div className="col-span-6 flex flex-col gap-0.5 pl-0.5 justify-center">
                    {/* Top 10 Negative */}
                    <div 
                      className={`anti-flicker-cell flex justify-between items-center px-0.5 py-0 rounded transition-all border ${getTextColor(v.top10Neg, 100)}`}
                      style={getHeatmapStyle(v.top10Neg, 100)}
                    >
                      <span className="opacity-80 font-black text-[7px] uppercase tracking-wider">T10</span>
                      <span className="font-black flex items-center gap-0.5" style={{ fontSize: `${fontSize * 0.75}px` }}>
                        <span>▼</span>
                        <span>{v.top10Neg}</span>
                      </span>
                    </div>
                    {/* Next 15/12 Negative */}
                    <div 
                      className={`anti-flicker-cell flex justify-between items-center px-0.5 py-0 rounded transition-all border ${getTextColor(v.next15Neg, 100)}`}
                      style={getHeatmapStyle(v.next15Neg, 100)}
                    >
                      <span className="opacity-80 font-black text-[7px] uppercase tracking-wider">{isBanknifty ? "N2" : (isSensex ? "N12" : "N15")}</span>
                      <span className="font-black flex items-center gap-0.5" style={{ fontSize: `${fontSize * 0.75}px` }}>
                        <span>▼</span>
                        <span>{v.next15Neg}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sparkline trend for this timeframe */}
              <Sparkline
                points={sparklines[box.name] || []}
                strokeColor={
                  box.name === "OVERALL"
                    ? "#10b981"
                    : box.name === "5M"
                    ? "#38bdf8"
                    : box.name === "15M"
                    ? "#3b82f6"
                    : box.name === "30M"
                    ? "#6366f1"
                    : "#d946ef"
                }
              />

            </div>
          );
        })}
      </div>
    </div>
  );
}

export default React.memo(SummaryBoxes);
