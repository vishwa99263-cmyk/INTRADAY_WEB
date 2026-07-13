import React, { useState, useEffect } from "react";
import { 
  BarChart2, Download, CheckCircle, RefreshCw, AlertCircle, 
  TrendingUp, TrendingDown, Layers, Percent, Activity, ArrowLeft,
  Zap, Sparkles, ShieldAlert, Gauge
} from "lucide-react";

interface StockAverageData {
  symbol: string;
  last_date: string;
  last_open: number;
  last_high: number;
  last_low: number;
  last_close: number;
  last_avg: number;
  last_volume: number;
  last_turnover: number;
  last_delivery_vol: number;
  last_delivery_per: number;
  avg_vol_5d: number;
  avg_deliv_vol_5d: number;
  avg_deliv_per_5d: number;
  avg_vol_30d: number;
  avg_deliv_vol_30d: number;
  avg_deliv_per_30d: number;
  last_no_of_trades: number;
}

interface DailyRecord {
  symbol: string;
  trade_date: string;
  prev_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  avg_price: number;
  total_volume: number;
  turnover_lacs: number;
  delivery_volume: number;
  delivery_percentage: number;
  no_of_trades: number;
}

interface HistoryStats {
  maxClose: number;
  maxCloseDate: string;
  minClose: number;
  minCloseDate: string;
  avgClose: number;
  avgVolume: number;
  avgDeliveryPercent: number;
  netReturnPercent: number;
  latestPrice: number;
  latestDate: string;
}

interface QuantInsights {
  sentimentScore: number;
  sentimentLabel: string;
  rsiValue: number;
  rsiStatus: string;
  sma5: number;
  sma10: number;
  sma20: number;
  trendStatus: "Bullish" | "Bearish" | "Sideways";
  smartMoneyActivity: "High Accumulation" | "Institutional Distribution" | "Normal Consolidation" | "Institutional Sell-off" | "Retail Dominance";
  smartMoneyLabel: string;
  avgVolume20d: number;
  avgDelivery20d: number;
  avgDeliveryPer20d: number;
  avgTradesSize20d: number;
  latestTradesSize: number;
  volatilityDaily: number;
  support90d: number;
  resistance90d: number;
  proximityAlerts: string[];
  flags: { type: "info" | "success" | "warning" | "danger"; text: string }[];
}

function runQuantAnalysis(history: DailyRecord[]): QuantInsights {
  const count = history.length;
  const latest = history[0];
  
  // 1. Calculate SMA and RSI
  // Reverse to get chronological order (oldest to latest)
  const chronological = [...history].reverse();
  const prices = chronological.map(r => r.close_price);
  
  const sma5: number[] = [];
  const sma10: number[] = [];
  const sma20: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    sma5.push(i >= 4 ? prices.slice(i - 4, i + 1).reduce((s, p) => s + p, 0) / 5 : prices[i]);
    sma10.push(i >= 9 ? prices.slice(i - 9, i + 1).reduce((s, p) => s + p, 0) / 10 : prices[i]);
    sma20.push(i >= 19 ? prices.slice(i - 19, i + 1).reduce((s, p) => s + p, 0) / 20 : prices[i]);
  }

  // RSI 14
  const rsi: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      rsi.push(50);
      continue;
    }
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    if (i < 14) {
      avgGain += gain;
      avgLoss += loss;
      rsi.push(50);
    } else if (i === 14) {
      avgGain = (avgGain + gain) / 14;
      avgLoss = (avgLoss + loss) / 14;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
    } else {
      avgGain = (avgGain * 13 + gain) / 14;
      avgLoss = (avgLoss * 13 + loss) / 14;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
    }
  }

  // Back to descending order (index 0 is latest)
  const revSma5 = [...sma5].reverse();
  const revSma10 = [...sma10].reverse();
  const revSma20 = [...sma20].reverse();
  const revRsi = [...rsi].reverse();

  // 2. Volume & Delivery averages (past 20 trading days)
  const slice20 = history.slice(0, Math.min(20, count));
  const avgVolume20d = slice20.reduce((s, r) => s + r.total_volume, 0) / slice20.length;
  const avgDelivery20d = slice20.reduce((s, r) => s + r.delivery_volume, 0) / slice20.length;
  const avgDeliveryPer20d = slice20.reduce((s, r) => s + r.delivery_percentage, 0) / slice20.length;
  
  const tradesSizes = slice20.map(r => r.no_of_trades > 0 ? r.total_volume / r.no_of_trades : 0).filter(v => v > 0);
  const avgTradesSize20d = tradesSizes.length > 0 ? tradesSizes.reduce((s, v) => s + v, 0) / tradesSizes.length : 0;
  const latestTradesSize = latest.no_of_trades > 0 ? latest.total_volume / latest.no_of_trades : 0;

  // 3. Support & Resistance (90-day extreme closing prices)
  const closePrices = history.map(r => r.close_price);
  const support90d = Math.min(...closePrices);
  const resistance90d = Math.max(...closePrices);

  // Daily volatility (average high-low percentage)
  const dailyRanges = history.map(r => r.low_price > 0 ? ((r.high_price - r.low_price) / r.low_price) * 100 : 0);
  const volatilityDaily = dailyRanges.reduce((s, v) => s + v, 0) / count;

  // 4. Scoring Engine
  let score = 50;
  const flags: { type: "info" | "success" | "warning" | "danger"; text: string }[] = [];
  const proximityAlerts: string[] = [];

  const lClose = latest.close_price;
  const lSma20 = revSma20[0];
  const lSma10 = revSma10[0];
  const lSma5 = revSma5[0];
  const lRsi = revRsi[0];

  // Trend Scoring
  let trendStatus: "Bullish" | "Bearish" | "Sideways" = "Sideways";
  const pctDiffSMA20 = ((lClose - lSma20) / lSma20) * 100;
  if (pctDiffSMA20 > 0.75) {
    trendStatus = "Bullish";
    score += 15;
  } else if (pctDiffSMA20 < -0.75) {
    trendStatus = "Bearish";
    score -= 15;
  } else {
    trendStatus = "Sideways";
  }

  // Short term crossovers
  if (lClose > lSma5) score += 5;
  else if (lClose < lSma5) score -= 5;
  if (lClose > lSma10) score += 5;
  else if (lClose < lSma10) score -= 5;

  // RSI Scoring
  let rsiStatus = "Neutral";
  if (lRsi > 70) {
    rsiStatus = "Overbought";
    score -= 5; // potential correction risk
    flags.push({ type: "warning", text: `RSI Overbought (${lRsi.toFixed(1)}): Price is in an overextended zone, watch for short-term exhaustion.` });
  } else if (lRsi < 30) {
    rsiStatus = "Oversold";
    score += 10; // bullish mean reversion edge
    flags.push({ type: "success", text: `RSI Oversold (${lRsi.toFixed(1)}): High probability of a mean-reversion technical bounce.` });
  } else if (lRsi > 55) {
    rsiStatus = "Bullish Momentum";
    score += 5;
  } else if (lRsi < 45) {
    rsiStatus = "Bearish Bias";
    score -= 5;
  }

  // Smart Money Activity Analysis
  let smartMoneyActivity: QuantInsights["smartMoneyActivity"] = "Normal Consolidation";
  let smartMoneyLabel = "Standard retail and local broker flow.";
  
  const isCloseUp = latest.close_price >= (latest.prev_close > 0 ? latest.prev_close : latest.open_price);
  const volRatio = latest.total_volume / (avgVolume20d || 1);
  const delivRatio = latest.delivery_percentage / (avgDeliveryPer20d || 1);
  const tradeSizeRatio = latestTradesSize / (avgTradesSize20d || 1);

  if (volRatio >= 1.5 && latest.delivery_percentage >= 50) {
    if (isCloseUp) {
      smartMoneyActivity = "High Accumulation";
      smartMoneyLabel = "Heavy institutional accumulation detected on high delivery and volume spike.";
      score += 20;
      flags.push({ type: "success", text: `Smart Money Accumulation: Volume was ${volRatio.toFixed(1)}x avg, with ${latest.delivery_percentage.toFixed(1)}% deliverable buying.` });
    } else {
      smartMoneyActivity = "Institutional Distribution";
      smartMoneyLabel = "Large block sales and distribution by institutional desks.";
      score -= 20;
      flags.push({ type: "danger", text: `Institutional Distribution: High volume delivery selloff. Vol is ${volRatio.toFixed(1)}x avg.` });
    }
  } else if (volRatio >= 1.4 && tradeSizeRatio >= 1.4) {
    if (isCloseUp) {
      smartMoneyActivity = "High Accumulation";
      smartMoneyLabel = "Smart money buying detected via large block sizes per trade.";
      score += 15;
      flags.push({ type: "success", text: `Large Block Purchases: Average shares per transaction is ${tradeSizeRatio.toFixed(1)}x the 20-day average.` });
    } else {
      smartMoneyActivity = "Institutional Sell-off";
      smartMoneyLabel = "Institutional block selling. Large orders executed on the bid side.";
      score -= 15;
      flags.push({ type: "danger", text: `Large Block Liquidation: Order sizes are ${tradeSizeRatio.toFixed(1)}x higher than average with price dropping.` });
    }
  } else if (latest.delivery_percentage >= 60) {
    smartMoneyActivity = "High Accumulation";
    smartMoneyLabel = "Strong deliverable volume. Retail sellers exiting, institutional players taking delivery.";
    score += 10;
    flags.push({ type: "info", text: `High Delivery Block: ${latest.delivery_percentage.toFixed(1)}% delivery indicates long-term holding build-up.` });
  } else if (volRatio < 0.6 && tradeSizeRatio < 0.7) {
    smartMoneyActivity = "Retail Dominance";
    smartMoneyLabel = "Low institutional presence. Mostly minor retail churn.";
  }

  // Support / Resistance Proximity Alerts
  if (lClose <= support90d * 1.02) {
    proximityAlerts.push(`Price near 90d Support (₹${support90d.toFixed(2)})`);
    score += 10;
    flags.push({ type: "warning", text: `Near Support Zone: Trading within 2% of 90-day low (₹${support90d.toFixed(2)}). Watch for reversal candle.` });
  }
  if (lClose >= resistance90d * 0.98) {
    proximityAlerts.push(`Price near 90d Resistance (₹${resistance90d.toFixed(2)})`);
    score -= 10;
    flags.push({ type: "warning", text: `Near Resistance Zone: Trading within 2% of 90-day high (₹${resistance90d.toFixed(2)}). Watch for breakout or rejection.` });
  }

  // Clean score bounds
  const finalScore = Math.max(0, Math.min(100, score));

  let sentimentLabel = "Neutral";
  if (finalScore >= 80) sentimentLabel = "Strongly Bullish";
  else if (finalScore >= 60) sentimentLabel = "Bullish";
  else if (finalScore >= 40) sentimentLabel = "Neutral";
  else if (finalScore >= 20) sentimentLabel = "Bearish";
  else sentimentLabel = "Strongly Bearish";

  return {
    sentimentScore: finalScore,
    sentimentLabel,
    rsiValue: lRsi,
    rsiStatus,
    sma5: revSma5[0],
    sma10: revSma10[0],
    sma20: revSma20[0],
    trendStatus,
    smartMoneyActivity,
    smartMoneyLabel,
    avgVolume20d,
    avgDelivery20d,
    avgDeliveryPer20d,
    avgTradesSize20d,
    latestTradesSize,
    volatilityDaily,
    support90d,
    resistance90d,
    proximityAlerts,
    flags
  };
}

function getStockBias(row: StockAverageData): "Bullish" | "Bearish" | "Neutral" {
  const isCloseUp = row.last_close >= row.last_open;
  const volSpike = row.last_volume / (row.avg_vol_5d || 1);
  
  if (isCloseUp) {
    if (row.last_delivery_per >= 50 || volSpike >= 1.2) {
      return "Bullish";
    }
  } else {
    if (row.last_delivery_per >= 50 || volSpike >= 1.2) {
      return "Bearish";
    }
  }
  return "Neutral";
}

function getStockSignal(row: StockAverageData): "STRONG ENTRY" | "ENTRY" | "EARLY" | "" {
  try {
    const avgT = row.avg_vol_5d;
    const avgD = row.avg_deliv_vol_5d;
    if (avgT <= 0 || avgD <= 0) return "";

    const ttqDiff = row.last_volume - avgT;
    const ttqPercentVal = ttqDiff > 0 ? (ttqDiff / avgT) * 100 : 0;

    const dqDiff = row.last_delivery_vol - avgD;
    const dqPercentVal = dqDiff > 0 ? (dqDiff / avgD) * 100 : 0;

    // 1. STRONG ENTRY
    if (row.last_delivery_vol > avgD && row.last_volume > avgT && ttqPercentVal > 80 && dqPercentVal > 80) {
      if (row.last_close > row.last_avg && row.last_close > row.last_open && row.last_delivery_per > 50) {
        return "STRONG ENTRY";
      }
      return "ENTRY";
    }

    // 2. EARLY
    if (ttqPercentVal > 40 && dqPercentVal > 40 && row.last_close > row.last_avg && row.last_close > row.last_open && row.last_delivery_per > 45) {
      return "EARLY";
    }

    return "";
  } catch (e) {
    return "";
  }
}

const getApiUrl = (path: string) => {
  const host = (typeof window !== "undefined" && (window.location.protocol === "file:" || window.location.port === "5173"))
    ? "http://localhost:3000"
    : "";
  return `${host}${path}`;
};

export default function StockAnalysis() {
  // Averages list states
  const [data, setData] = useState<StockAverageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingToday, setSyncingToday] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [error, setError] = useState("");

  // Column widths state for resizable history table
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    date: 100,
    open: 75,
    high: 75,
    low: 75,
    close: 75,
    avgPrice: 80,
    change: 80,
    volume: 110,
    turnover: 100,
    delivQty: 110,
    trades: 90,
    avgTTQ: 110,
    avgDQ: 110,
    smartMoney: 110,
    smartMoneyAvg: 110,
    ttqPercent: 85,
    dqPercent: 85,
    smPercent: 85,
    delivPer: 85,
    signal: 110,
  });

  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const startX = React.useRef<number>(0);
  const startWidth = React.useRef<number>(0);

  const handleMouseDown = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    setResizingCol(colKey);
    startX.current = e.clientX;
    startWidth.current = colWidths[colKey] || 80;
  };

  useEffect(() => {
    if (!resizingCol) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX.current;
      const newWidth = Math.max(45, startWidth.current + deltaX);
      setColWidths(prev => ({
        ...prev,
        [resizingCol]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      setResizingCol(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingCol]);

  // Selected stock history states
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<DailyRecord[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [quantInsights, setQuantInsights] = useState<QuantInsights | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "STRONG ENTRY" | "ENTRY" | "EARLY" | "HVD" | ">">("all");

  // UI Tabs & Interactions States
  const [activeTab, setActiveTab] = useState<"all" | "bullish" | "bearish" | "neutral" | "signals">("all");
  const [recentSignals, setRecentSignals] = useState<any[]>([]);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Fetch averages list
  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(getApiUrl("/api/stocks/bhavcopy/averages"));
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.averages || []);
      } else {
        setError(json.error || "Failed to fetch averages.");
      }
    } catch (err: any) {
      setError(err.message || "Network failure.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchRecentSignals = async () => {
    setLoadingSignals(true);
    setError("");
    try {
      const res = await fetch(getApiUrl("/api/stocks/bhavcopy/recent-signals"));
      const json = await res.json();
      if (res.ok && json.success) {
        setRecentSignals(json.signals || []);
      } else {
        setError(json.error || "Failed to fetch recent signals.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load signals.");
    } finally {
      setLoadingSignals(false);
    }
  };

  useEffect(() => {
    if (activeTab === "signals") {
      fetchRecentSignals();
    }
  }, [activeTab]);

  // Fetch history for selected stock symbol
  useEffect(() => {
    if (!selectedSymbol) {
      setHistoryData([]);
      setHistoryStats(null);
      setQuantInsights(null);
      return;
    }

    const fetchHistory = async () => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const res = await fetch(getApiUrl(`/api/stocks/bhavcopy/history/${selectedSymbol}`));
        const json = await res.json();
        if (res.ok && json.success) {
          const hist = json.history || [];
          setHistoryData(hist);
          setHistoryStats(json.stats || null);
          if (hist.length > 0) {
            setQuantInsights(runQuantAnalysis(hist));
          } else {
            setQuantInsights(null);
          }
        } else {
          setHistoryError(json.error || `Failed to fetch history for ${selectedSymbol}.`);
        }
      } catch (err: any) {
        setHistoryError(err.message || "Failed to connect to history service.");
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistory();
  }, [selectedSymbol]);

  // Dispatch history sync trigger
  const handleSyncHistorical = async () => {
    setSyncing(true);
    setSyncMessage("Request dispatched to backend. Syncing in background...");
    setError("");
    try {
      const res = await fetch(getApiUrl("/api/stocks/bhavcopy/sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 90 }) 
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSyncMessage(json.message);
        setTimeout(fetchData, 3000);
        setTimeout(fetchData, 10000);
      } else {
        setError(json.error || "Failed to trigger historical sync.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to contact sync service.");
    } finally {
      setSyncing(false);
    }
  };

  // Dispatch today's data sync trigger
  const handleSyncToday = async () => {
    setSyncingToday(true);
    setSyncMessage("");
    setError("");
    try {
      const res = await fetch(getApiUrl("/api/stocks/bhavcopy/sync-today"), {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSyncMessage(json.message);
        fetchData();
      } else {
        setError(json.error || "Failed to fetch today's data.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to contact sync service.");
    } finally {
      setSyncingToday(false);
    }
  };

  // Render Live session intelligence analysis card
  const renderLiveIntelCard = () => {
    if (historyData.length === 0 || !quantInsights) return null;
    
    // Check if the first row is indeed today's live data
    const latestRow = historyData[0];
    const changePct = latestRow.prev_close > 0 
      ? ((latestRow.close_price - latestRow.prev_close) / latestRow.prev_close) * 100 
      : 0;

    const volRatio = latestRow.total_volume / (quantInsights.avgVolume20d || 1);

    // Smart interpretation of current session
    let interpretation = "";
    let alertType: "info" | "success" | "warning" | "danger" = "info";
    let signalLabel = "NEUTRAL RANGE";

    if (changePct >= 1.5 && volRatio >= 1.5) {
      interpretation = `${selectedSymbol} is experiencing a massive bullish breakout with institutional volume loading. Buying delivery ratio is high. Ideal setup for momentum long (CE).`;
      alertType = "success";
      signalLabel = "STRONG BULLISH BREAKOUT";
    } else if (changePct <= -1.5 && volRatio >= 1.5) {
      interpretation = `${selectedSymbol} has breached key support zones on massive selling volumes. Institutional distribution is active. Avoid longs; high risk of continued correction.`;
      alertType = "danger";
      signalLabel = "STRONG BEARISH DISTRIBUTION";
    } else if (changePct > 0.5 && volRatio > 1.1) {
      interpretation = `Healthy buying accumulation with moderate volume support. Positive structure remains intact. Good for steady upside targets.`;
      alertType = "success";
      signalLabel = "ACCUMULATING BUY";
    } else if (changePct < -0.5 && volRatio > 1.1) {
      interpretation = `Selling pressure active with volume support. The stock is sliding towards support lines. Monitor key levels (₹${quantInsights.support90d.toFixed(2)}) for reversals.`;
      alertType = "warning";
      signalLabel = "DISTRIBUTION PRESSURING";
    } else if (latestRow.delivery_percentage > 55) {
      interpretation = `High delivery-percentage accumulation detected (retail supply absorbing into long-term holdings). Reversal build-up likely.`;
      alertType = "info";
      signalLabel = "DELIVERY ACCUMULATION";
    } else {
      interpretation = `Stock is consolidating inside a standard intraday range. Institutional volume presence is low. Sideways structure.`;
      alertType = "info";
      signalLabel = "CONSOLIDATION SIDEWAYS";
    }

    const alertBorders = {
      success: "border-emerald-500/35 bg-emerald-500/5 text-emerald-400",
      danger: "border-rose-500/35 bg-rose-500/5 text-rose-455",
      warning: "border-amber-500/35 bg-amber-500/5 text-amber-450",
      info: "border-blue-500/35 bg-blue-500/5 text-blue-400"
    };

    return (
      <div className="p-3 rounded-xl border shadow-md flex flex-col gap-2.5 bg-slate-900 border-slate-800 animate-fade-in">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">
              Today's Live Intel & Intraday Picture
            </h3>
          </div>
          <span className="text-[9.5px] font-bold text-slate-500 font-mono">Date: {latestRow.trade_date} (IST Session)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 items-center">
          {/* Key Metric 1: Live LTP */}
          <div className="bg-slate-950/40 border border-slate-850 p-2 rounded-lg text-center flex flex-col justify-center">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Live LTP</span>
            <span className="text-xl font-black text-white mt-0.5 font-mono">₹{latestRow.close_price.toFixed(2)}</span>
            <span className={`text-[10px] font-bold mt-0.5 font-mono ${changePct >= 0 ? "text-emerald-400" : "text-rose-455"}`}>
              {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
            </span>
          </div>

          {/* Key Metric 2: Today's Range */}
          <div className="bg-slate-950/40 border border-slate-850 p-2 rounded-lg text-center flex flex-col justify-center">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Intraday Range</span>
            <span className="text-[12.5px] font-bold text-slate-200 mt-1 font-mono">
              H: ₹{latestRow.high_price.toFixed(1)}
            </span>
            <span className="text-[12.5px] font-bold text-slate-400 font-mono">
              L: ₹{latestRow.low_price.toFixed(1)}
            </span>
          </div>

          {/* Key Metric 3: Live Vol vs 5d Avg */}
          <div className="bg-slate-950/40 border border-slate-850 p-2 rounded-lg text-center flex flex-col justify-center">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Volume Multiplier</span>
            <span className={`text-xl font-black mt-0.5 font-mono ${volRatio >= 1.5 ? "text-emerald-400" : volRatio > 1.0 ? "text-teal-400" : "text-slate-400"}`}>
              {volRatio.toFixed(2)}x
            </span>
            <span className="text-[9px] text-slate-500 mt-0.5 font-semibold uppercase">of 20d Average</span>
          </div>

          {/* Key Metric 4: Session Status */}
          <div className="bg-slate-950/40 border border-slate-850 p-2 rounded-lg text-center flex flex-col justify-center">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Session Bias</span>
            <span className={`text-xs font-black uppercase mt-1 px-1.5 py-0.2 rounded border inline-block mx-auto ${
              alertType === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
              alertType === "danger" ? "bg-rose-500/10 border-rose-500/30 text-rose-455" :
              alertType === "warning" ? "bg-amber-500/10 border-amber-500/30 text-amber-450" :
              "bg-blue-500/10 border-blue-500/30 text-blue-400"
            }`}>
              {signalLabel}
            </span>
          </div>
        </div>

        {/* Live Analysis Paragraph */}
        <div className={`p-3 rounded-xl border text-xs md:text-sm leading-relaxed font-bold ${alertBorders[alertType]}`}>
          <div className="flex gap-3 items-start">
            <Sparkles size={16} className="flex-shrink-0 mt-1 animate-pulse" />
            <div className="space-y-1">
              <span className="text-xs md:text-sm font-black uppercase tracking-wider block">Live Quant Verdict:</span>
              <p className="text-slate-100 font-extrabold">{interpretation}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render SVG Area Sparkline Chart for History View
  const renderSparkline = () => {
    if (historyData.length < 2) return null;

    const prices = historyData.map(r => r.close_price).reverse(); // Chronological order
    const maxVal = Math.max(...prices);
    const minVal = Math.min(...prices);
    const range = maxVal - minVal || 1;

    const width = 800;
    const height = 110;
    const padding = 15;

    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;

    const points = prices.map((price, idx) => {
      const x = padding + (idx / (prices.length - 1)) * usableWidth;
      const y = padding + usableHeight - ((price - minVal) / range) * usableHeight;
      return { x, y, price, date: historyData[historyData.length - 1 - idx].trade_date };
    });

    const pathD = points.reduce((acc, p, idx) => {
      return acc + `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }, "");

    const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`;

    const maxPoint = points.find(p => p.price === maxVal);
    const minPoint = points.find(p => p.price === minVal);

    // Calculate SMA20
    const sma20Period = 20;
    const sma20Prices: number[] = [];
    for (let i = 0; i < prices.length; i++) {
      if (i >= sma20Period - 1) {
        const sum = prices.slice(i - sma20Period + 1, i + 1).reduce((s, p) => s + p, 0);
        sma20Prices.push(sum / sma20Period);
      } else {
        sma20Prices.push(prices[i]);
      }
    }

    const smaPoints = sma20Prices.map((price, idx) => {
      const x = padding + (idx / (prices.length - 1)) * usableWidth;
      const y = padding + usableHeight - ((price - minVal) / range) * usableHeight;
      return { x, y };
    });

    const smaPathD = smaPoints.reduce((acc, p, idx) => {
      return acc + `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }, "");

    const hoverRecord = hoverIndex !== null ? historyData[historyData.length - 1 - hoverIndex] : null;
    const hoverSmaVal = hoverIndex !== null ? sma20Prices[hoverIndex] : null;

    return (
      <div className="relative w-full overflow-hidden p-2.5 px-3 rounded-xl bg-slate-950/40 border border-slate-850 shadow-inner">
        <div className="flex items-center justify-between text-xs font-sans font-black text-slate-500 uppercase tracking-widest mb-1.5">
          <div className="flex items-center gap-2">
            <Activity size={12} className="text-teal-400" />
            <span>90-Day Closing Price Trendline</span>
          </div>
          <div className="flex items-center gap-3 text-[9px] font-mono font-semibold lowercase tracking-normal text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-teal-500 rounded" /> close price</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 border-t border-dashed border-amber-500" /> 20-day SMA</span>
          </div>
        </div>
        
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24 overflow-visible select-none">
          <defs>
            <linearGradient id="area-grad-inline" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#334155" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />

          {/* Shaded Area */}
          <path d={areaD} fill="url(#area-grad-inline)" />

          {/* Stroke Line */}
          <path d={pathD} fill="none" stroke="#14b8a6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

          {/* SMA20 Line */}
          <path d={smaPathD} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.75" />

          {/* Max Price Marker */}
          {maxPoint && (
            <g>
              <circle cx={maxPoint.x} cy={maxPoint.y} r="6" fill="#10b981" stroke="#0f172a" strokeWidth="2" />
              <text x={maxPoint.x} y={maxPoint.y - 10} fontSize="10" fill="#10b981" fontWeight="bold" textAnchor="middle" className="font-mono">
                ₹{maxPoint.price.toFixed(1)} (High)
              </text>
            </g>
          )}

          {/* Min Price Marker */}
          {minPoint && (
            <g>
              <circle cx={minPoint.x} cy={minPoint.y} r="6" fill="#ef4444" stroke="#0f172a" strokeWidth="2" />
              <text x={minPoint.x} y={minPoint.y + 16} fontSize="10" fill="#ef4444" fontWeight="bold" textAnchor="middle" className="font-mono">
                ₹{minPoint.price.toFixed(1)} (Low)
              </text>
            </g>
          )}

          {/* Crosshair line */}
          {hoverIndex !== null && (
            <line 
              x1={points[hoverIndex].x} 
              y1={padding} 
              x2={points[hoverIndex].x} 
              y2={height - padding} 
              stroke="#38bdf8" 
              strokeWidth="1" 
              strokeDasharray="4,4" 
            />
          )}

          {/* Crosshair Dots */}
          {hoverIndex !== null && (
            <g>
              <circle 
                cx={points[hoverIndex].x} 
                cy={points[hoverIndex].y} 
                r="5" 
                fill="#14b8a6" 
                stroke="#0f172a" 
                strokeWidth="2" 
              />
              <circle 
                cx={smaPoints[hoverIndex].x} 
                cy={smaPoints[hoverIndex].y} 
                r="4" 
                fill="#f59e0b" 
                stroke="#0f172a" 
                strokeWidth="1.5" 
              />
            </g>
          )}

          {/* Mouse interaction listener layer */}
          <rect
            x={padding}
            y={padding}
            width={usableWidth}
            height={usableHeight}
            fill="transparent"
            onMouseMove={(e) => {
              const svgElement = e.currentTarget.ownerSVGElement;
              if (!svgElement) return;
              const rect = svgElement.getBoundingClientRect();
              const clientX = e.clientX - rect.left;
              const scaleX = width / rect.width;
              const svgX = clientX * scaleX;
              
              const relativeX = svgX - padding;
              let idx = Math.round((relativeX / usableWidth) * (prices.length - 1));
              idx = Math.max(0, Math.min(prices.length - 1, idx));
              
              setHoverIndex(idx);
              setHoverPos({ x: svgX, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => {
              setHoverIndex(null);
              setHoverPos(null);
            }}
            className="cursor-crosshair"
          />
        </svg>

        {/* Floating Tooltip Card */}
        {hoverRecord && hoverPos && (
          <div 
            className="absolute pointer-events-none bg-slate-950/95 border border-slate-800 rounded-xl p-3 shadow-2xl flex flex-col gap-1 text-[9px] font-mono text-slate-350 z-30 min-w-[130px]"
            style={{ 
              left: `${Math.min(width - 150, Math.max(20, hoverPos.x - 65))}px`,
              top: `${Math.min(height - 110, Math.max(10, hoverPos.y - 110))}px`
            }}
          >
            <span className="font-sans font-black text-white text-[9.5px] border-b border-slate-850 pb-1 mb-0.5">
              {new Date(hoverRecord.trade_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
            <div className="flex justify-between">
              <span className="text-slate-500">Close:</span>
              <span className="font-bold text-white">₹{hoverRecord.close_price.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">SMA(20):</span>
              <span className="font-bold text-amber-500">₹{hoverSmaVal?.toFixed(1) || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Vol:</span>
              <span className="font-bold text-slate-200">{(hoverRecord.total_volume / 100000).toFixed(1)}L</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Deliv:</span>
              <span className="font-bold text-teal-400">{hoverRecord.delivery_percentage.toFixed(1)}%</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderQuantAnalysisDashboard = () => {
    if (!quantInsights) return null;

    const {
      sentimentScore,
      sentimentLabel,
      rsiValue,
      rsiStatus,
      sma20,
      trendStatus,
      smartMoneyActivity,
      smartMoneyLabel,
      avgVolume20d,
      avgDeliveryPer20d,
      avgTradesSize20d,
      latestTradesSize,
      volatilityDaily,
      support90d,
      resistance90d,
      flags
    } = quantInsights;

    // Determine color schemes
    const sentimentColor = 
      sentimentScore >= 80 ? "text-emerald-400" :
      sentimentScore >= 60 ? "text-teal-400" :
      sentimentScore >= 40 ? "text-slate-350" :
      sentimentScore >= 20 ? "text-amber-500" : "text-rose-500";

    const sentimentBg = 
      sentimentScore >= 80 ? "bg-emerald-500/10 border-emerald-500/20" :
      sentimentScore >= 60 ? "bg-teal-500/10 border-teal-500/20" :
      sentimentScore >= 40 ? "bg-slate-800/40 border-slate-700/50" :
      sentimentScore >= 20 ? "bg-amber-500/10 border-amber-500/20" : "bg-rose-500/10 border-rose-500/20";

    // SVG parameters for radial gauge
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (sentimentScore / 100) * circumference;

    return (
      <div className="bg-slate-900 border border-slate-800/90 rounded-xl p-3 shadow-md flex flex-col gap-3 font-sans select-none animate-fade-in">
        
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-teal-500/10 rounded-lg border border-teal-500/20 text-teal-400">
              <Sparkles size={15} className="animate-pulse" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wider">
                AI Quantitative Insights & Analytics
              </h3>
              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                90-day mathematical scan of momentum, institutional deliveries, order sizes and key technical levels.
              </p>
            </div>
          </div>
          <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-slate-400 tracking-wider">
            QUANT ENGINE v2.0
          </span>
        </div>

        {/* 3-Column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          
          {/* Column 1: Radial Sentiment Gauge */}
          <div className={`p-2.5 rounded-xl border ${sentimentBg} flex flex-col items-center justify-center text-center gap-2 relative overflow-hidden min-h-[165px]`}>
            {/* Background glowing gradient */}
            <div className="absolute inset-0 bg-radial-gradient from-transparent to-slate-950/20 opacity-30 pointer-events-none" />

            <div className="relative flex items-center justify-center w-20 h-20">
              <svg className="w-full h-full transform -rotate-90">
                {/* Track circle */}
                <circle
                  cx="40"
                  cy="40"
                  r={radius}
                  className="stroke-slate-950 fill-transparent"
                  strokeWidth="6"
                />
                {/* Value circle */}
                <circle
                  cx="40"
                  cy="40"
                  r={radius}
                  className="fill-transparent transition-all duration-1000 ease-out"
                  stroke={
                    sentimentScore >= 60 ? "#14b8a6" : // Teal
                    sentimentScore >= 40 ? "#64748b" : // Slate
                    "#f43f5e" // Rose
                  }
                  strokeWidth="6"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              {/* Centered stats */}
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-lg font-black text-white font-mono">{sentimentScore}%</span>
                <span className="text-[6.5px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Rating</span>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <span className={`text-xs font-black tracking-wide uppercase ${sentimentColor}`}>
                {sentimentLabel}
              </span>
              <p className="text-[8.5px] text-slate-400 mt-0.5 max-w-[200px] leading-relaxed font-semibold">
                Sentiment rating is synthesized from trend, volume pressure, and RSI levels.
              </p>
            </div>
          </div>

          {/* Column 2: 2x2 Quant Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Trend status */}
            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80 flex flex-col justify-between shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-slate-455 uppercase tracking-wider">Trend Setup</span>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                  trendStatus === "Bullish" ? "bg-emerald-500/10 text-emerald-400" :
                  trendStatus === "Bearish" ? "bg-rose-500/10 text-rose-455" :
                  "bg-slate-800 text-slate-400"
                }`}>
                  {trendStatus}
                </span>
              </div>
              <div className="mt-1.5 space-y-1">
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-slate-500">SMA(20)</span>
                  <span className="font-bold text-slate-300">₹{sma20.toFixed(1)}</span>
                </div>
                <p className="text-[8px] text-slate-400 font-semibold leading-relaxed">
                  Price is trading {historyData[0].close_price >= sma20 ? "above" : "below"} SMA.
                </p>
              </div>
            </div>
 
            {/* Momentum RSI */}
            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80 flex flex-col justify-between shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-slate-455 uppercase tracking-wider">Momentum (RSI)</span>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                  rsiStatus === "Overbought" ? "bg-rose-500/10 text-rose-400 animate-pulse" :
                  rsiStatus === "Oversold" ? "bg-emerald-500/10 text-emerald-400 animate-pulse" :
                  "bg-teal-500/15 text-teal-300"
                }`}>
                  {rsiValue.toFixed(0)}
                </span>
              </div>
              <div className="mt-1.5 space-y-1">
                <div className="w-full bg-slate-850 h-1 rounded-full overflow-hidden relative">
                  <div 
                    className={`h-full rounded-full ${
                      rsiValue > 70 ? "bg-rose-500" :
                      rsiValue < 30 ? "bg-emerald-500" :
                      "bg-teal-500"
                    }`}
                    style={{ width: `${rsiValue}%` }}
                  />
                </div>
                <p className="text-[8px] text-slate-400 font-semibold leading-relaxed">
                  RSI is {rsiStatus.toLowerCase()} (30-70).
                </p>
              </div>
            </div>
 
            {/* Smart Money Activity */}
            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80 flex flex-col justify-between shadow-inner col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-slate-455 uppercase tracking-wider">Institutional Flow</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase flex items-center gap-1 ${
                  smartMoneyActivity.includes("Accumulation") ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" :
                  smartMoneyActivity.includes("Distribution") || smartMoneyActivity.includes("Sell-off") ? "bg-rose-500/10 text-rose-455 border border-rose-500/25" :
                  "bg-slate-800 text-slate-400"
                }`}>
                  <Zap size={10} />
                  <span>{smartMoneyActivity}</span>
                </span>
              </div>
              <div className="mt-1.5 space-y-1">
                <div className="grid grid-cols-2 gap-2 text-[9.5px] font-mono">
                  <div className="flex justify-between items-center bg-slate-900/40 p-0.5 rounded px-1.5 border border-slate-850">
                    <span className="text-slate-500">Deliv %</span>
                    <span className="font-black text-slate-300">{historyData[0].delivery_percentage.toFixed(1)}% <span className="text-[7.5px] text-slate-500 font-normal">(avg {avgDeliveryPer20d.toFixed(0)}%)</span></span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900/40 p-0.5 rounded px-1.5 border border-slate-850">
                    <span className="text-slate-500">Avg Trade</span>
                    <span className="font-black text-slate-300">{Math.round(latestTradesSize).toLocaleString("en-IN")} <span className="text-[7.5px] text-slate-500 font-normal">(avg {Math.round(avgTradesSize20d).toLocaleString("en-IN")})</span></span>
                  </div>
                </div>
                <p className="text-[8px] text-slate-400 font-semibold leading-relaxed mt-0.5">
                  {smartMoneyLabel}
                </p>
              </div>
            </div>
          </div>

          {/* Column 3: Scanned Signals / Alerts */}
          <div className="p-2.5 rounded-xl bg-slate-950/30 border border-slate-850/80 flex flex-col gap-1.5 min-h-[165px]">
            <span className="text-[9px] font-bold text-slate-455 uppercase tracking-wider mb-0.5 flex items-center gap-1.5">
              <ShieldAlert size={12} className="text-amber-500" />
              <span>Real-Time Signals Scan ({flags.length})</span>
            </span>
 
            <div className="flex-grow overflow-y-auto max-h-[120px] pr-1 space-y-1.5 custom-scrollbar">
              {flags.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-4 gap-1.5">
                  <CheckCircle size={16} className="text-slate-650" />
                  <span className="text-[9px] text-slate-500 font-mono italic leading-relaxed uppercase">
                    No critical breakouts or volatility spikes scanned. Stock is consolidating normally.
                  </span>
                </div>
              ) : (
                flags.map((flag, idx) => {
                  const alertBg = 
                    flag.type === "danger" ? "bg-rose-500/10 border-rose-500/25 text-rose-350" :
                    flag.type === "success" ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-350" :
                    flag.type === "warning" ? "bg-amber-500/10 border-amber-500/25 text-amber-350" :
                    "bg-blue-500/10 border-blue-500/25 text-blue-350";
 
                  return (
                    <div 
                      key={idx} 
                      className={`p-1.5 rounded-lg border text-[9px] font-sans font-semibold leading-relaxed flex gap-2 ${alertBg}`}
                    >
                      <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                      <span>{flag.text}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        {/* Bottom Quick-Info strip */}
        <div className="flex flex-wrap items-center justify-between text-[9px] font-mono text-slate-500 border-t border-slate-850 pt-1.5">
          <div className="flex gap-4">
            <span><b>Support (90d):</b> <span className="text-rose-455">₹{support90d.toFixed(1)}</span></span>
            <span><b>Resistance (90d):</b> <span className="text-emerald-400">₹{resistance90d.toFixed(1)}</span></span>
            <span><b>90d Volatility:</b> <span className="text-slate-400">{volatilityDaily.toFixed(2)}% daily range</span></span>
          </div>
          <span>Updated: {new Date(historyData[0].trade_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
        </div>

      </div>
    );
  };

  // Render Detailed Historical view of a single stock
  const renderHistoryView = () => {
    const getRolling5dAvgVolume = (currentIndex: number) => {
      const slice = historyData.slice(currentIndex, currentIndex + 5);
      if (slice.length === 0) return 0;
      const sum = slice.reduce((acc, r) => acc + r.total_volume, 0);
      return sum / slice.length;
    };

    const getRolling5dAvgDelivQty = (currentIndex: number) => {
      const slice = historyData.slice(currentIndex, currentIndex + 5);
      if (slice.length === 0) return 0;
      const sum = slice.reduce((acc, r) => acc + r.delivery_volume, 0);
      return sum / slice.length;
    };

    const getRolling5dAvgSmartMoney = (currentIndex: number) => {
      const slice = historyData.slice(currentIndex, currentIndex + 5);
      if (slice.length === 0) return 0;
      const sum = slice.reduce((acc, r) => {
        const sm = r.no_of_trades > 0 ? r.total_volume / r.no_of_trades : 0;
        return acc + sm;
      }, 0);
      return sum / slice.length;
    };

    const getSignal = (idx: number): "STRONG ENTRY" | "ENTRY" | "EARLY" | "HVD" | ">" | "" => {
      try {
        const row = historyData[idx];
        if (!row) return "";
        
        const avgT = getRolling5dAvgVolume(idx);
        const avgD = getRolling5dAvgDelivQty(idx);
        
        const ttqDiff = row.total_volume - avgT;
        const ttqPercentVal = avgT > 0 && ttqDiff > 0 ? (ttqDiff / avgT) * 100 : 0;
        
        const dqDiff = row.delivery_volume - avgD;
        const dqPercentVal = avgD > 0 && dqDiff > 0 ? (dqDiff / avgD) * 100 : 0;
        
        const prevRow = historyData[idx + 1];
        if (!prevRow) return "";
        
        const prevAvgT = getRolling5dAvgVolume(idx + 1);
        
        // 1. STRONG ENTRY (ENTRY conditions + immediate bullish price trend/delivery)
        if (row.delivery_volume > avgD && row.total_volume > avgT && ttqPercentVal > 80 && dqPercentVal > 80) {
          if (row.close_price > row.avg_price && row.close_price > prevRow.close_price && row.delivery_percentage > 50) {
            return "STRONG ENTRY";
          }
          return "ENTRY";
        }
        
        // 2. EARLY (Early institutional interest + momentum before full 80% breakout)
        if (ttqPercentVal > 40 && dqPercentVal > 40 && row.close_price > row.avg_price && row.close_price > prevRow.close_price && row.delivery_percentage > 45) {
          return "EARLY";
        }
        
        // 3. HVD: K6>L6, B7>F6, O6>50
        if (row.delivery_volume > avgD && prevRow.close_price > row.avg_price && row.delivery_percentage > 50) {
          return "HVD";
        }
        
        // 4. >: K6<I7, B7<F6
        if (row.delivery_volume < prevAvgT && prevRow.close_price < row.avg_price) {
          return ">";
        }
        
        return "";
      } catch (e) {
        return "";
      }
    };



    return (
      <div className="flex flex-col gap-3 w-full select-none font-sans text-slate-100 animate-fade-in">
        {/* ── Premium Header ── */}
        <div className="relative p-3 rounded-xl overflow-hidden border border-indigo-500/20 shadow-xl"
          style={{ background: "linear-gradient(135deg, #0a0f1e 0%, #0d1526 50%, #080e1c 100%)" }}>
          {/* Glow orbs */}
          <div className="absolute -top-6 -left-6 w-32 h-32 rounded-full bg-indigo-600/10 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full bg-violet-600/10 blur-2xl pointer-events-none" />

          <div className="flex flex-col md:flex-row items-center justify-between gap-4 relative">
            <div className="flex items-center gap-4 w-full md:w-auto">
              <button
                onClick={() => setSelectedSymbol(null)}
                className="p-2.5 bg-slate-800/80 hover:bg-indigo-600/20 border border-slate-700 hover:border-indigo-500/40 rounded-xl font-black text-xs uppercase tracking-wider cursor-pointer outline-none transition-all flex items-center gap-1.5 text-slate-200 hover:text-indigo-300"
              >
                <ArrowLeft size={14} />
                <span>Back</span>
              </button>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-black uppercase tracking-wider bg-gradient-to-r from-indigo-300 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
                    {selectedSymbol}
                  </h2>
                  <span className="text-base font-black text-slate-400">Historical Report</span>
                  <span className="text-[10px] font-black px-2.5 py-1 rounded-lg border bg-cyan-500/10 border-cyan-500/30 text-cyan-300 tracking-widest font-mono uppercase animate-pulse">
                    📊 90-Day Full Report
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 font-semibold leading-relaxed">
                  Daily price boundaries · Volume analysis · Delivery % · Smart Money signals
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Loading / Error status */}
        {historyLoading ? (
          <div className="rounded-2xl border border-indigo-500/20 p-20 flex flex-col items-center justify-center gap-3"
            style={{ background: "linear-gradient(135deg,#080e1c,#0d1526)" }}>
            <RefreshCw size={36} className="text-indigo-400 animate-spin" />
            <span className="text-xs text-indigo-300 uppercase font-black tracking-widest">Loading Historical Timeline...</span>
          </div>
        ) : historyError ? (
          <div className="rounded-2xl border border-rose-500/20 p-16 flex flex-col items-center justify-center gap-3 text-center"
            style={{ background: "linear-gradient(135deg,#1a080e,#120610)" }}>
            <AlertCircle size={40} className="text-rose-500 animate-pulse" />
            <div className="space-y-1">
              <h4 className="text-sm font-black text-rose-300 uppercase tracking-wide">Database History Query Failed</h4>
              <p className="text-xs text-slate-400 max-w-sm font-semibold">{historyError}</p>
            </div>
            <button
              onClick={() => setSelectedSymbol(selectedSymbol)}
              className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs uppercase font-bold transition-all cursor-pointer"
            >
              Retry Load
            </button>
          </div>
        ) : historyData.length === 0 ? (
          <div className="rounded-2xl border border-amber-500/20 p-20 flex flex-col items-center justify-center gap-4 text-center"
            style={{ background: "linear-gradient(135deg,#12100a,#0e0c07)" }}>
            <AlertCircle size={44} className="text-amber-500/60 animate-pulse" />
            <div className="space-y-1">
              <h4 className="text-sm font-black text-amber-300 uppercase tracking-wide">No Records Found for {selectedSymbol}</h4>
              <p className="text-xs text-slate-400 max-w-md font-semibold">
                This symbol does not have any recorded data in local `stock_bhavcopy` database table. Ensure you run the 3-month sync.
              </p>
            </div>
            <button
              onClick={() => setSelectedSymbol(null)}
              className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs uppercase font-bold transition-all cursor-pointer"
            >
              Return to stock list
            </button>
          </div>
        ) : (
          <>
            {/* Summary statistics row */}
            {historyStats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {/* Latest Close */}
                <div className="relative p-3 rounded-xl border border-indigo-500/20 overflow-hidden shadow-md flex flex-col justify-between"
                  style={{ background: "linear-gradient(135deg,#0d1220,#0a0f1c)" }}>
                  <div className="absolute top-0 right-0 w-16 h-16 rounded-full bg-indigo-600/10 blur-xl pointer-events-none" />
                  <div>
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider block">Latest Close</span>
                    <span className="text-xl md:text-2xl font-black text-white mt-1.5 font-mono block">₹{historyStats.latestPrice.toFixed(2)}</span>
                  </div>
                  <span className="text-[10px] text-indigo-300 font-bold mt-1.5 font-mono block">
                    As of {new Date(historyStats.latestDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>

                {/* Net Return */}
                <div className={`relative p-3 rounded-xl border overflow-hidden shadow-md flex flex-col justify-between ${
                  historyStats.netReturnPercent >= 0 ? 'border-emerald-500/20' : 'border-rose-500/20'
                }`} style={{ background: historyStats.netReturnPercent >= 0 ? 'linear-gradient(135deg,#071a0f,#050e09)' : 'linear-gradient(135deg,#1a0708,#0e0405)' }}>
                  <div className={`absolute top-0 right-0 w-16 h-16 rounded-full blur-xl pointer-events-none ${ historyStats.netReturnPercent >= 0 ? 'bg-emerald-600/10' : 'bg-rose-600/10'}`} />
                  <div>
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-wider block">Net Return</span>
                    <div className={`flex items-center gap-1 mt-1.5 font-black font-mono text-xl md:text-2xl ${ historyStats.netReturnPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {historyStats.netReturnPercent >= 0 ? <TrendingUp size={18} className="text-emerald-400" /> : <TrendingDown size={18} className="text-rose-455" />}
                      <span>{historyStats.netReturnPercent >= 0 ? "+" : ""}{historyStats.netReturnPercent}%</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold mt-1.5 font-mono block">Past 90 Days Summary</span>
                </div>

                {/* Avg Delivery */}
                <div className="relative p-3 rounded-xl border border-cyan-500/20 overflow-hidden shadow-md flex flex-col justify-between"
                  style={{ background: "linear-gradient(135deg,#071418,#040c10)" }}>
                  <div className="absolute top-0 right-0 w-16 h-16 rounded-full bg-cyan-600/10 blur-xl pointer-events-none" />
                  <div>
                    <span className="text-[10px] font-black text-cyan-400 uppercase tracking-wider block">Avg Delivery %</span>
                    <span className="text-xl md:text-2xl font-black text-cyan-300 mt-1.5 font-mono block">{historyStats.avgDeliveryPercent.toFixed(2)}%</span>
                  </div>
                  <span className="text-[10px] text-cyan-455 font-bold mt-1.5 font-mono block">90-Day Institutional Holding Avg</span>
                </div>

                {/* Active Signals */}
                <div className="relative p-3 rounded-xl border border-violet-500/20 overflow-hidden shadow-md flex flex-col justify-between"
                  style={{ background: "linear-gradient(135deg,#12071a,#0a040f)" }}>
                  <div className="absolute top-0 right-0 w-16 h-16 rounded-full bg-violet-600/10 blur-xl pointer-events-none" />
                  <div>
                    <span className="text-[10px] font-black text-violet-400 uppercase tracking-wider flex items-center gap-1 block">
                      <Sparkles size={12} className="text-violet-400 animate-pulse" /> Active Signals (90d)
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 mt-2 font-mono text-[10px] font-bold">
                      <div className="flex justify-between items-center bg-violet-955/20 px-1.5 py-0.2 rounded border border-violet-900/10">
                        <span className="text-slate-400">STRONG:</span>
                        <span className="text-emerald-400 font-extrabold">{historyData.filter((_, idx) => getSignal(idx) === "STRONG ENTRY").length}</span>
                      </div>
                      <div className="flex justify-between items-center bg-violet-955/20 px-1.5 py-0.2 rounded border border-violet-900/10">
                        <span className="text-slate-400">ENTRY:</span>
                        <span className="text-teal-400 font-extrabold">{historyData.filter((_, idx) => getSignal(idx) === "ENTRY").length}</span>
                      </div>
                      <div className="flex justify-between items-center bg-violet-955/20 px-1.5 py-0.2 rounded border border-violet-900/10">
                        <span className="text-slate-400">EARLY:</span>
                        <span className="text-fuchsia-400 font-extrabold">{historyData.filter((_, idx) => getSignal(idx) === "EARLY").length}</span>
                      </div>
                      <div className="flex justify-between items-center bg-violet-955/20 px-1.5 py-0.2 rounded border border-violet-900/10">
                        <span className="text-slate-400">HVD:</span>
                        <span className="text-blue-400 font-extrabold">{historyData.filter((_, idx) => getSignal(idx) === "HVD").length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}



            {/* Live Session Intraday Analysis Card */}
            {renderLiveIntelCard()}

            {/* Sparkline trendline */}
            {renderSparkline()}

            {/* AI Quantitative Analysis Dashboard */}
            {renderQuantAnalysisDashboard()}

            {/* ── Table Container ── */}
            <div className="rounded-2xl border border-slate-700/40 shadow-2xl overflow-hidden flex flex-col"
              style={{ background: "linear-gradient(180deg,#070d1a 0%,#050a14 100%)" }}>
              {/* Signal Filter Bar */}
              <div className="flex items-center gap-2 p-3 border-b border-slate-800/60 flex-wrap"
                style={{ background: "linear-gradient(90deg,#0a1020,#080d1a)" }}>
                <span className="text-[10px] uppercase font-black text-slate-600 tracking-wider mr-2 font-sans">Filter Timeline:</span>
                <button
                  onClick={() => setHistoryFilter("all")}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${
                    historyFilter === "all"
                      ? "bg-slate-800 border-slate-700 text-white shadow-md shadow-slate-950/20"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  All Days <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-950 text-[9px] text-slate-400 font-mono font-bold">{historyData.length}</span>
                </button>
                
                <button
                  onClick={() => setHistoryFilter("STRONG ENTRY")}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                    historyFilter === "STRONG ENTRY"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-450 shadow-md shadow-emerald-950/10"
                      : "border-transparent text-emerald-500/60 hover:text-emerald-500"
                  }`}
                >
                  <span>🔥 Strong Entry</span>
                  <span className={`px-1.5 py-0.2 rounded-full font-mono font-bold text-[9px] ${
                    historyFilter === "STRONG ENTRY" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-950 text-emerald-500/60"
                  }`}>{historyData.filter((_, idx) => getSignal(idx) === "STRONG ENTRY").length}</span>
                </button>

                <button
                  onClick={() => setHistoryFilter("ENTRY")}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                    historyFilter === "ENTRY"
                      ? "bg-teal-500/10 border-teal-500/30 text-teal-400 shadow-md shadow-teal-950/10"
                      : "border-transparent text-teal-500/60 hover:text-teal-400"
                  }`}
                >
                  <span>⚡ Entry Only</span>
                  <span className={`px-1.5 py-0.2 rounded-full font-mono font-bold text-[9px] ${
                    historyFilter === "ENTRY" ? "bg-teal-500/20 text-teal-300" : "bg-slate-950 text-teal-500/60"
                  }`}>{historyData.filter((_, idx) => getSignal(idx) === "ENTRY").length}</span>
                </button>

                <button
                  onClick={() => setHistoryFilter("EARLY")}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                    historyFilter === "EARLY"
                      ? "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-400 shadow-md shadow-fuchsia-950/10"
                      : "border-transparent text-fuchsia-500/60 hover:text-fuchsia-400"
                  }`}
                >
                  <span>🚀 Early Entry</span>
                  <span className={`px-1.5 py-0.2 rounded-full font-mono font-bold text-[9px] ${
                    historyFilter === "EARLY" ? "bg-fuchsia-500/20 text-fuchsia-300" : "bg-slate-950 text-fuchsia-500/60"
                  }`}>{historyData.filter((_, idx) => getSignal(idx) === "EARLY").length}</span>
                </button>

                <button
                  onClick={() => setHistoryFilter("HVD")}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                    historyFilter === "HVD"
                      ? "bg-blue-500/10 border-blue-500/30 text-blue-450 shadow-md shadow-blue-950/10"
                      : "border-transparent text-blue-500/60 hover:text-blue-550"
                  }`}
                >
                  <span>💎 HVD Only</span>
                  <span className={`px-1.5 py-0.2 rounded-full font-mono font-bold text-[9px] ${
                    historyFilter === "HVD" ? "bg-blue-500/20 text-blue-300" : "bg-slate-950 text-blue-500/60"
                  }`}>{historyData.filter((_, idx) => getSignal(idx) === "HVD").length}</span>
                </button>

                <button
                  onClick={() => setHistoryFilter(">")}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                    historyFilter === ">"
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-450 shadow-md shadow-amber-950/10"
                      : "border-transparent text-amber-550 hover:text-amber-500"
                  }`}
                >
                  <span>📈 Momentum (&gt;)</span>
                  <span className={`px-1.5 py-0.2 rounded-full font-mono font-bold text-[9px] ${
                    historyFilter === ">" ? "bg-amber-500/20 text-amber-300" : "bg-slate-950 text-amber-550"
                  }`}>{historyData.filter((_, idx) => getSignal(idx) === ">").length}</span>
                </button>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="text-left border-collapse font-mono text-[13px] table-fixed w-max" style={{ width: "fit-content" }}>
                  <colgroup>
                    <col style={{ width: `${colWidths.date}px` }} />
                    <col style={{ width: `${colWidths.open}px` }} />
                    <col style={{ width: `${colWidths.high}px` }} />
                    <col style={{ width: `${colWidths.low}px` }} />
                    <col style={{ width: `${colWidths.close}px` }} />
                    <col style={{ width: `${colWidths.avgPrice}px` }} />
                    <col style={{ width: `${colWidths.change}px` }} />
                    <col style={{ width: `${colWidths.ttqPercent}px` }} />
                    <col style={{ width: `${colWidths.dqPercent}px` }} />
                    <col style={{ width: `${colWidths.smPercent}px` }} />
                    <col style={{ width: `${colWidths.delivPer}px` }} />
                    <col style={{ width: `${colWidths.signal}px` }} />
                    <col style={{ width: `${colWidths.volume}px` }} />
                    <col style={{ width: `${colWidths.turnover}px` }} />
                    <col style={{ width: `${colWidths.delivQty}px` }} />
                    <col style={{ width: `${colWidths.trades}px` }} />
                    <col style={{ width: `${colWidths.smartMoney}px` }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "linear-gradient(90deg,#0a1120,#080e1a)" }} className="text-[11px] font-black uppercase tracking-wider select-none border-b-2 border-indigo-500/20">
                      <th className="relative py-3 px-1 text-center border-r border-slate-800/50 text-indigo-300">
                        Date
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "date")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Open
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "open")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        High
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "high")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Low
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "low")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Close
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "close")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Avg Price
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "avgPrice")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Change %
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "change")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        TTQ%
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "ttqPercent")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        DQ%
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "dqPercent")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        SM%
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "smPercent")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Deliv %
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "delivPer")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-center border-r border-slate-800/80">
                        Signal
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "signal")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Traded Qty (Lakh)
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "volume")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Turnover (Lacs)
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "turnover")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Deliv Qty (Lakh)
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "delivQty")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right border-r border-slate-800/80">
                        Trades
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "trades")}
                        />
                      </th>
                      <th className="relative py-3 px-1 text-right">
                        Smart Money
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 active:bg-teal-500 z-20"
                          onMouseDown={(e) => handleMouseDown(e, "smartMoney")}
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/30">
                    {historyData
                      .map((row, originalIdx) => ({ row, originalIdx }))
                      .filter(({ originalIdx }) => {
                        if (historyFilter === "all") return true;
                        return getSignal(originalIdx) === historyFilter;
                      })
                      .map(({ row, originalIdx }) => {
                        const prevCloseVal = row.prev_close > 0 ? row.prev_close : row.open_price;
                        const changePercent = prevCloseVal > 0 ? ((row.close_price - prevCloseVal) / prevCloseVal) * 100 : 0;
                        const isPositive = row.close_price >= prevCloseVal;
                        const sig = getSignal(originalIdx);
                        const rowBg = sig === 'STRONG ENTRY' ? 'rgba(16,185,129,0.04)'
                          : sig === 'ENTRY'  ? 'rgba(20,184,166,0.03)'
                          : sig === 'EARLY'  ? 'rgba(217,70,239,0.03)'
                          : sig === 'HVD'    ? 'rgba(59,130,246,0.03)'
                          : originalIdx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent';

                        return (
                          <tr key={originalIdx}
                            style={{ background: rowBg }}
                            className="hover:bg-indigo-500/5 transition-colors">
                            <td className="py-2 px-1 text-center text-indigo-300 font-bold whitespace-nowrap overflow-hidden text-ellipsis border-r border-slate-800/40">
                              {row.trade_date ? new Date(row.trade_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                            </td>
                            <td className="py-2 px-1 text-right text-slate-400 overflow-hidden text-ellipsis border-r border-slate-800/40">₹{row.open_price.toFixed(2)}</td>
                            <td className="py-2 px-1 text-right text-emerald-500 font-bold overflow-hidden text-ellipsis border-r border-slate-800/40">₹{row.high_price.toFixed(2)}</td>
                            <td className="py-2 px-1 text-right text-rose-600 font-bold overflow-hidden text-ellipsis border-r border-slate-800/40">₹{row.low_price.toFixed(2)}</td>
                            <td className={`py-2 px-1 text-right font-black text-[13px] border-r border-slate-800/40 overflow-hidden text-ellipsis ${isPositive ? "text-emerald-300" : "text-rose-400"}`}>
                              ₹{row.close_price.toFixed(2)}
                            </td>
                            <td className="py-2 px-1 text-right text-sky-400/70 overflow-hidden text-ellipsis border-r border-slate-800/40">₹{row.avg_price.toFixed(2)}</td>
                            <td className={`py-2 px-1 text-right font-bold border-r border-slate-800/40 overflow-hidden text-ellipsis ${ isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                              {isPositive ? "+" : ""}{changePercent.toFixed(2)}%
                            </td>
                            {/* TTQ% */}
                            {(() => {
                              const avgT = getRolling5dAvgVolume(originalIdx);
                              const diff = row.total_volume - avgT;
                              const val = avgT > 0 && diff > 0 ? (diff / avgT) * 100 : 0;
                              return (
                                <td className={`py-2 px-1 text-right font-bold overflow-hidden text-ellipsis border-r border-slate-800/40 ${val > 80 ? "text-emerald-300" : val > 0 ? "text-emerald-500/70" : "text-slate-600"}`}>
                                  {val > 0 ? `+${val.toFixed(2)}%` : <span className="text-slate-800 select-none">—</span>}
                                </td>
                              );
                            })()}
                            {/* DQ% */}
                            {(() => {
                              const avgD = getRolling5dAvgDelivQty(originalIdx);
                              const diff = row.delivery_volume - avgD;
                              const val = avgD > 0 && diff > 0 ? (diff / avgD) * 100 : 0;
                              return (
                                <td className={`py-2 px-1 text-right font-bold overflow-hidden text-ellipsis border-r border-slate-800/40 ${val > 80 ? "text-cyan-300" : val > 0 ? "text-cyan-500/70" : "text-slate-600"}`}>
                                  {val > 0 ? `+${val.toFixed(2)}%` : <span className="text-slate-800 select-none">—</span>}
                                </td>
                              );
                            })()}
                            {/* SM% */}
                            {(() => {
                              const smVal = row.no_of_trades > 0 ? row.total_volume / row.no_of_trades : 0;
                              const avgS = getRolling5dAvgSmartMoney(originalIdx);
                              const diff = smVal - avgS;
                              const val = avgS > 0 && diff > 0 ? (diff / avgS) * 100 : 0;
                              return (
                                <td className={`py-2 px-1 text-right font-bold overflow-hidden text-ellipsis border-r border-slate-800/40 ${val > 80 ? "text-fuchsia-300" : val > 0 ? "text-fuchsia-500/70" : "text-slate-600"}`}>
                                  {val > 0 ? `+${val.toFixed(2)}%` : <span className="text-slate-800 select-none">—</span>}
                                </td>
                              );
                            })()}
                            {/* Deliv % */}
                            <td className="py-2 px-1 text-right whitespace-nowrap overflow-hidden text-ellipsis border-r border-slate-800/40">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                row.delivery_percentage >= 60 ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-[0_0_6px_rgba(6,182,212,0.2)]"
                                : row.delivery_percentage >= 40 ? "bg-blue-500/10 text-blue-300 border border-blue-500/20"
                                : "bg-slate-900 text-slate-600"
                              }`}>
                                {row.delivery_percentage.toFixed(2)}%
                              </span>
                            </td>
                            {/* SIGNAL */}
                            {(() => {
                              const signal = getSignal(originalIdx);

                              if (signal === "STRONG ENTRY") {
                                return (
                                  <td className="py-2 px-1 text-center whitespace-nowrap overflow-hidden text-ellipsis font-bold border-r border-slate-800/40">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-gradient-to-r from-emerald-500/25 to-teal-500/25 text-emerald-300 border border-emerald-450/40 animate-pulse tracking-wide shadow shadow-emerald-950/20">
                                      STRONG ENTRY
                                    </span>
                                  </td>
                                );
                              }
                              if (signal === "ENTRY") {
                                return (
                                  <td className="py-2 px-1 text-center whitespace-nowrap overflow-hidden text-ellipsis font-bold border-r border-slate-800/40">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse">
                                      ENTRY
                                    </span>
                                  </td>
                                );
                              }
                              if (signal === "EARLY") {
                                return (
                                  <td className="py-2 px-1 text-center whitespace-nowrap overflow-hidden text-ellipsis font-bold border-r border-slate-800/40">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/25">
                                      EARLY
                                    </span>
                                  </td>
                                );
                              }
                              if (signal === "HVD") {
                                return (
                                  <td className="py-2 px-1 text-center whitespace-nowrap overflow-hidden text-ellipsis font-bold border-r border-slate-800/40">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-500/15 text-blue-400 border border-blue-500/25">
                                      HVD
                                    </span>
                                  </td>
                                );
                              }
                              if (signal === ">") {
                                return (
                                  <td className="py-2 px-1 text-center whitespace-nowrap overflow-hidden text-ellipsis font-black text-slate-400 text-sm border-r border-slate-800/40">
                                    &gt;
                                  </td>
                                );
                              }
                              return (
                                <td className="py-2 px-1 text-center whitespace-nowrap overflow-hidden text-ellipsis text-slate-600 font-normal italic border-r border-slate-800/40">
                                  —
                                </td>
                              );
                            })()}
                            {/* Traded Qty (Lakh) */}
                            <td className="py-2 px-1 text-right text-violet-300 overflow-hidden text-ellipsis border-r border-slate-800/40">{(row.total_volume / 100000).toFixed(2)} L</td>
                            {/* Turnover (Lacs) */}
                            <td className="py-2 px-1 text-right text-amber-300/70 overflow-hidden text-ellipsis border-r border-slate-800/40">{(row.turnover_lacs).toFixed(2)} L</td>
                            {/* Deliv Qty (Lakh) */}
                            <td className="py-2 px-1 text-right text-cyan-300/80 overflow-hidden text-ellipsis border-r border-slate-800/40">{(row.delivery_volume / 100000).toFixed(2)} L</td>
                            {/* Trades */}
                            <td className="py-2 px-1 text-right text-slate-400 overflow-hidden text-ellipsis border-r border-slate-800/40">
                              {row.no_of_trades ? row.no_of_trades.toLocaleString("en-IN") : "0"}
                            </td>
                            {/* Smart Money */}
                            <td className="py-2 px-1 text-right text-orange-300/70 overflow-hidden text-ellipsis">
                              {row.no_of_trades > 0 ? (row.total_volume / row.no_of_trades).toFixed(2) : "0.00"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // If a stock is selected, render the historical full view
  if (selectedSymbol) {
    return renderHistoryView();
  }

  // Otherwise, render the default averages list view
  return (
    <div className="flex flex-col gap-5 w-full select-none font-sans text-slate-100 animate-fade-in">
      
      {/* ── HEADER DECK ──────────────────────────────────────────────────────── */}
      <div className="p-5 rounded-2xl border bg-slate-900 border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 shadow-2xl">
        <div className="flex items-center gap-3.5 w-full md:w-auto">
          <BarChart2 size={34} className="text-teal-400 animate-pulse flex-shrink-0" />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg md:text-xl font-black uppercase tracking-wider text-white">
                NSE Stock Bhavcopy & Delivery Analytics Engine
              </h2>
              <span className="text-[10px] font-black px-2.5 py-0.5 rounded-lg border bg-teal-500/10 border-teal-500/30 text-teal-300 tracking-widest font-mono uppercase">
                15 Index Heavyweights
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-semibold leading-relaxed">
              Consolidated NSE daily reports. Click any stock symbol below to view its complete 90-day history.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-200 border border-slate-750 hover:border-slate-700 rounded-xl font-black text-xs uppercase tracking-wider cursor-pointer outline-none transition-all flex items-center gap-2"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
          
          <button
            onClick={handleSyncToday}
            disabled={syncingToday}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-500/10 cursor-pointer outline-none transition-all flex items-center gap-2"
          >
            <Download size={13} className={syncingToday ? "animate-bounce" : ""} />
            <span>{syncingToday ? "Syncing..." : "⚡ Fetch Today's Data"}</span>
          </button>

          <button
            onClick={handleSyncHistorical}
            disabled={syncing}
            className="px-5 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-teal-500/10 cursor-pointer outline-none transition-all flex items-center gap-2"
          >
            <Download size={13} className={syncing ? "animate-bounce" : ""} />
            <span>{syncing ? "Syncing..." : "⚡ Sync 3 Month History"}</span>
          </button>
        </div>
      </div>

      {/* ── NOTIFICATIONS & ERROR STATUSES ───────────────────────────────────── */}
      {syncMessage && (
        <div className="p-3.5 rounded-xl border bg-emerald-500/10 border-emerald-500/35 text-emerald-350 text-xs font-semibold font-mono flex items-center gap-2">
          <CheckCircle size={15} />
          <span>{syncMessage}</span>
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-xl border bg-rose-500/10 border-rose-500/35 text-rose-350 text-xs font-semibold font-mono flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* ── FILTER TABS ─────────────────────────────────────────────────────── */}
      {data.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/40 p-1.5 rounded-xl border border-slate-800/80">
          <div className="flex items-center gap-1.5 p-1 flex-wrap">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${
                activeTab === "all"
                  ? "bg-slate-800 border-slate-700 text-white shadow-md shadow-slate-950/20"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              All Stocks <span className="ml-1.5 px-2 py-0.5 rounded-full bg-slate-950 text-slate-400 font-mono font-bold text-[10px]">{data.length}</span>
            </button>
            
            <button
              onClick={() => setActiveTab("bullish")}
              className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "bullish"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-450 shadow-md shadow-emerald-950/10"
                  : "border-transparent text-emerald-500/60 hover:text-emerald-400"
              }`}
            >
              <span>🔥 Bullish Setup</span>
              <span className={`px-1.5 py-0.5 rounded-full font-mono font-bold text-[9px] ${
                activeTab === "bullish" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-950 text-emerald-500/60"
              }`}>{data.filter(r => getStockBias(r) === "Bullish").length}</span>
            </button>

            <button
              onClick={() => setActiveTab("bearish")}
              className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "bearish"
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-455 shadow-md shadow-rose-950/10"
                  : "border-transparent text-rose-500/60 hover:text-rose-400"
              }`}
            >
              <span>💀 Bearish Setup</span>
              <span className={`px-1.5 py-0.5 rounded-full font-mono font-bold text-[9px] ${
                activeTab === "bearish" ? "bg-rose-500/20 text-rose-300" : "bg-slate-950 text-rose-500/60"
              }`}>{data.filter(r => getStockBias(r) === "Bearish").length}</span>
            </button>

            <button
              onClick={() => setActiveTab("neutral")}
              className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "neutral"
                  ? "bg-slate-800 border-slate-700 text-slate-350 shadow-md shadow-slate-950/20"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>⚖️ Neutral</span>
              <span className={`px-1.5 py-0.5 rounded-full font-mono font-bold text-[9px] ${
                activeTab === "neutral" ? "bg-slate-900 text-slate-400 border border-slate-850" : "bg-slate-950 text-slate-500"
              }`}>{data.filter(r => getStockBias(r) === "Neutral").length}</span>
            </button>

            <button
              onClick={() => setActiveTab("signals")}
              className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${
                activeTab === "signals"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-450 shadow-md shadow-emerald-950/10"
                  : "border-transparent text-emerald-500/60 hover:text-emerald-400"
              }`}
            >
              <span>📢 Entry Signals (1M)</span>
              {recentSignals.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full font-mono font-bold text-[9px] ${
                  activeTab === "signals" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-950 text-emerald-500/60"
                }`}>{recentSignals.length}</span>
              )}
            </button>
          </div>
          <div className="px-3 text-[9.5px] font-semibold text-slate-500 italic pr-3 hidden md:block">
            * Grouped: Bullish first, then Neutral, then Bearish
          </div>
        </div>
      )}

      {/* ── DATA SHEET TABLE ────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col min-h-[400px]">
        
        {loading || (activeTab === "signals" && loadingSignals) ? (
          <div className="flex-grow flex flex-col items-center justify-center py-20 gap-3 font-mono">
            <RefreshCw size={36} className="text-teal-400 animate-spin" />
            <span className="text-xs text-slate-450 uppercase font-black tracking-widest">LOADING HISTORICAL DATA MATRIX...</span>
          </div>
        ) : activeTab === "signals" ? (
          recentSignals.length === 0 ? (
            <div className="flex-grow flex flex-col items-center justify-center py-20 gap-4 text-center px-6">
              <AlertCircle size={44} className="text-amber-500/40 animate-pulse" />
              <div className="space-y-1">
                <h4 className="text-sm font-black text-white uppercase tracking-wide">NO SIGNALS DETECTED</h4>
                <p className="text-xs text-slate-400 max-w-md font-semibold leading-relaxed">
                  No ENTRY or STRONG ENTRY signals were triggered by any stock in the last 1 month (30 trading days).
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto select-text">
              <table className="w-full text-left border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="bg-slate-950/80 text-slate-450 border-b border-slate-800 font-sans text-[10px] font-black uppercase tracking-wider">
                    <th className="py-4 px-4.5">Date</th>
                    <th className="py-4 px-3">Stock</th>
                    <th className="py-4 px-3 text-center">Signal Type</th>
                    <th className="py-4 px-3 text-right">Close Price</th>
                    <th className="py-4 px-3 text-right">Traded Qty (Lakh)</th>
                    <th className="py-4 px-3 text-right">Deliv %</th>
                    <th className="py-4 px-3 text-right">5d Avg Vol (Lakh)</th>
                    <th className="py-4 px-3 text-right">5d Avg Deliv (Lakh)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 bg-slate-900/40">
                  {recentSignals.map((row, idx) => {
                    const isClosePositive = row.close_price >= row.prev_close;
                    return (
                      <tr key={idx} className="hover:bg-slate-850/45 transition-colors">
                        <td className="py-3 px-4.5 text-slate-400 whitespace-nowrap">
                          {new Date(row.trade_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="py-3 px-3 font-bold font-sans text-white text-xs whitespace-nowrap">
                          <span 
                            onClick={() => setSelectedSymbol(row.symbol)}
                            className="underline hover:text-teal-400 cursor-pointer font-bold"
                            title="Click to view 90-day history report"
                          >
                            {row.symbol}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider animate-pulse ${
                            row.signal === "STRONG ENTRY" ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300" :
                            "bg-teal-500/10 border border-teal-500/20 text-teal-400"
                          }`}>
                            {row.signal}
                          </span>
                        </td>
                        <td className={`py-3 px-3 text-right font-black ${isClosePositive ? "text-emerald-400" : "text-rose-450"}`}>
                          ₹{row.close_price.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right text-slate-200">
                          {(row.total_volume / 100000).toFixed(2)} L
                        </td>
                        <td className="py-3 px-3 text-right text-teal-450 font-bold">
                          {row.delivery_percentage.toFixed(2)}%
                        </td>
                        <td className="py-3 px-3 text-right text-slate-450">
                          {(row.avg_vol_5d / 100000).toFixed(2)} L
                        </td>
                        <td className="py-3 px-3 text-right text-slate-450">
                          {(row.avg_deliv_vol_5d / 100000).toFixed(2)} L
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : data.length === 0 ? (
          <div className="flex-grow flex flex-col items-center justify-center py-20 gap-4 text-center px-6">
            <AlertCircle size={44} className="text-amber-500/40 animate-pulse" />
            <div className="space-y-1">
              <h4 className="text-sm font-black text-white uppercase tracking-wide">NO DATA RECORDED IN DATABASE</h4>
              <p className="text-xs text-slate-400 max-w-md font-semibold leading-relaxed">
                Table 'stock_bhavcopy' exists but is currently empty. Click the <b>"Sync 3 Month History"</b> button above to download the daily NSE Bhavcopy files.
              </p>
            </div>
            <button
              onClick={handleSyncHistorical}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
            >
              🚀 Trigger Auto-Seed Download Now
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto select-text">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="bg-slate-950/80 text-slate-450 border-b border-slate-800 font-sans text-[10px] font-black uppercase tracking-wider">
                  <th className="py-4 px-4.5">Stock</th>
                  <th className="py-4 px-3 text-center">Trend Bias</th>
                  <th className="py-4 px-3">Date</th>
                  <th className="py-4 px-3 text-right">Open</th>
                  <th className="py-4 px-3 text-right">High</th>
                  <th className="py-4 px-3 text-right">Low</th>
                  <th className="py-4 px-3 text-right">Close</th>
                  <th className="py-4 px-3 text-right">Avg Price</th>
                  <th className="py-4 px-3 text-right">Traded Qty (Lakh)</th>
                  <th className="py-4 px-3 text-right">Turnover (Lacs)</th>
                  <th className="py-4 px-3 text-right">Deliv Qty (Lakh)</th>
                  <th className="py-4 px-3 text-right">Deliv %</th>
                  <th className="py-4 px-3 text-right">No. of Trades</th>
                  <th className="py-4 px-3 text-right">5d Avg Vol (Lakh)</th>
                  <th className="py-4 px-3 text-right">30d Avg Vol (Lakh)</th>
                  <th className="py-4 px-4.5 text-center">Status Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850 bg-slate-900/40">
                {(() => {
                  const filteredData = data.filter(row => {
                    if (activeTab === "all") return true;
                    return getStockBias(row).toLowerCase() === activeTab;
                  });

                  const biasOrder = { Bullish: 1, Neutral: 2, Bearish: 3 };
                  const sortedData = [...filteredData].sort((a, b) => {
                    const biasA = getStockBias(a);
                    const biasB = getStockBias(b);
                    return biasOrder[biasA] - biasOrder[biasB];
                  });

                  return sortedData.map((row) => {
                    const bias = getStockBias(row);
                    const volSpike = row.last_volume / (row.avg_vol_5d || 1);
                    const isVolSpike = volSpike >= 1.5;
                    
                    const delivSpike = row.last_delivery_per - (row.avg_deliv_per_30d || 0);
                    const isHighDeliv = row.last_delivery_per >= 55 && delivSpike >= 5;
                    
                    const isClosePositive = row.last_close >= row.last_open;

                    const activeSignal = getStockSignal(row);
                    const hasEntrySignal = activeSignal === "STRONG ENTRY" || activeSignal === "ENTRY" || activeSignal === "EARLY";

                    return (
                      <tr key={row.symbol} className="hover:bg-slate-850/45 transition-colors">
                        {/* Stock Symbol */}
                        <td className="py-3 px-4.5 font-bold font-sans text-white text-xs whitespace-nowrap">
                          {hasEntrySignal ? (
                            <span 
                              onClick={() => setSelectedSymbol(row.symbol)}
                              className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-300 font-black cursor-pointer tracking-wider shadow-sm transition-all animate-pulse"
                              title={`Click to view 90-day history report (Latest Signal: ${activeSignal})`}
                            >
                              {row.symbol}
                            </span>
                          ) : (
                            <span 
                              onClick={() => setSelectedSymbol(row.symbol)}
                              className="underline hover:text-teal-400 cursor-pointer select-text font-bold"
                              title="Click to view 90-day history report"
                            >
                              {row.symbol}
                            </span>
                          )}
                        </td>

                        {/* Trend Bias */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            bias === "Bullish" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" :
                            bias === "Bearish" ? "bg-rose-500/10 text-rose-455 border border-rose-500/25" :
                            "bg-slate-800 text-slate-450"
                          }`}>
                            {bias === "Bullish" ? "🔥 Bullish" : bias === "Bearish" ? "💀 Bearish" : "⚖️ Neutral"}
                          </span>
                        </td>

                      {/* Date */}
                      <td className="py-3 px-3 text-slate-450 whitespace-nowrap">
                        {row.last_date ? new Date(row.last_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                      </td>

                      {/* Open */}
                      <td className="py-3 px-3 text-right text-slate-350">
                        ₹{row.last_open.toFixed(2)}
                      </td>

                      {/* High */}
                      <td className="py-3 px-3 text-right text-emerald-450 font-bold">
                        ₹{row.last_high.toFixed(2)}
                      </td>

                      {/* Low */}
                      <td className="py-3 px-3 text-right text-rose-455 font-bold">
                        ₹{row.last_low.toFixed(2)}
                      </td>

                      {/* Close */}
                      <td className={`py-3 px-3 text-right font-black text-xs ${isClosePositive ? "text-emerald-400" : "text-rose-450"}`}>
                        ₹{row.last_close.toFixed(2)}
                      </td>

                      {/* Avg Price */}
                      <td className="py-3 px-3 text-right text-slate-400">
                        ₹{row.last_avg.toFixed(2)}
                      </td>

                      {/* Traded Qty (Volume) */}
                      <td className="py-3 px-3 text-right text-slate-200">
                        {(row.last_volume / 100000).toFixed(2)} L
                      </td>

                      {/* Turnover Lacs */}
                      <td className="py-3 px-3 text-right text-slate-300">
                        {row.last_turnover.toLocaleString("en-IN", { maximumFractionDigits: 1 })} L
                      </td>

                      {/* Deliv Qty */}
                      <td className="py-3 px-3 text-right text-teal-400">
                        {(row.last_delivery_vol / 100000).toFixed(2)} L
                      </td>

                      {/* Deliv % */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          row.last_delivery_per >= 60 ? "bg-teal-500/15 text-teal-300 border border-teal-500/30"
                          : row.last_delivery_per >= 40 ? "bg-blue-500/10 text-blue-300"
                          : "bg-slate-950 text-slate-450"
                        }`}>
                          {row.last_delivery_per.toFixed(2)}%
                        </span>
                      </td>
                      {/* No. of Trades */}
                      <td className="py-3 px-3 text-right text-slate-300">
                        {row.last_no_of_trades ? row.last_no_of_trades.toLocaleString("en-IN") : "0"}
                      </td>

                      {/* 5d Avg Vol */}
                      <td className="py-3 px-3 text-right text-slate-450">
                        {(row.avg_vol_5d / 100000).toFixed(2)} L
                      </td>

                      {/* 30d Avg Vol */}
                      <td className="py-3 px-3 text-right text-slate-450 font-bold">
                        {(row.avg_vol_30d / 100000).toFixed(2)} L
                      </td>

                      {/* Status flags */}
                      <td className="py-3 px-4.5 text-center whitespace-nowrap">
                        <div className="flex justify-center items-center gap-1.5 font-sans font-black text-[9px] uppercase tracking-wider">
                          {activeSignal === "STRONG ENTRY" && (
                            <span className="px-1.5 py-0.5 rounded bg-gradient-to-r from-emerald-500/25 to-teal-500/25 text-emerald-300 border border-emerald-450/40 animate-pulse" title="Latest Signal: STRONG ENTRY">
                              🔥 STRONG ENTRY
                            </span>
                          )}
                          {activeSignal === "ENTRY" && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 animate-pulse" title="Latest Signal: ENTRY">
                              ⚡ ENTRY
                            </span>
                          )}
                          {activeSignal === "EARLY" && (
                            <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/15 border border-fuchsia-500/25 text-fuchsia-300" title="Latest Signal: EARLY">
                              🚀 EARLY
                            </span>
                          )}
                          {isVolSpike && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 animate-pulse" title={`Volume is ${volSpike.toFixed(1)}x greater than 5-day average`}>
                              🔥 {volSpike.toFixed(1)}x Spike
                            </span>
                          )}
                          {isHighDeliv && (
                            <span className="px-1.5 py-0.5 rounded bg-teal-500/15 border border-teal-500/35 text-teal-300" title={`High delivery percentage indicating heavy institutional accumulation`}>
                              🚀 Institutional Buy
                            </span>
                          )}
                          {!activeSignal && !isVolSpike && !isHighDeliv && (
                            <span className="text-slate-500 font-normal normal-case italic">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
              </tbody>
            </table>
          </div>
        )}

      </div>
      
    </div>
  );
}
