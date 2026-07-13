import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FileText, ArrowUpRight, Clock, AlertTriangle, RefreshCw,
  TrendingUp, TrendingDown, ShieldAlert, Award, AlertCircle
} from "lucide-react";

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
}

interface NewsResult {
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  sentimentScore: number;
  news: NewsItem[];
  lastUpdated: number;
}

interface Props {
  activePage: string;
}

const BULLISH_KEYWORDS = [
  "surge", "soar", "gain", "high", "jump", "record", "rally", "positive",
  "growth", "buy", "bull", "up", "rise", "soaring", "expansion", "beat", "inflow", "support"
];

const BEARISH_KEYWORDS = [
  "fall", "drop", "plunge", "low", "crash", "negative", "loss", "sell",
  "bear", "fear", "slip", "sink", "weak", "down", "decline", "outflow", "pressure", "slowdown"
];

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

const NewsDashboard: React.FC<Props> = ({ activePage }) => {
  const [data, setData] = useState<NewsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Normalize instrument for backend API
  const instrument = useMemo(() => {
    if (activePage === "BANKNIFTY" || activePage === "SENSEX") {
      return activePage;
    }
    return "NIFTY"; // Default fallback
  }, [activePage]);

  const fetchNews = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await fetch(getApiUrl(`/api/news/${instrument}`));
      if (!res.ok) {
        throw new Error(`Failed to fetch news (status: ${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      console.error("[NewsDashboard] error:", e);
      setError(e.message || "Failed to load news feed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [instrument]);

  useEffect(() => {
    fetchNews();
    // Auto-refresh every 2 minutes
    const interval = setInterval(() => fetchNews(true), 120000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  // Extract driving sentiment keywords from articles client-side
  const drivers = useMemo(() => {
    if (!data || !data.news) return { bullish: [], bearish: [] };
    const bullishCounts: Record<string, number> = {};
    const bearishCounts: Record<string, number> = {};

    data.news.forEach(item => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      BULLISH_KEYWORDS.forEach(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, "g");
        const matches = text.match(regex);
        if (matches) {
          bullishCounts[kw] = (bullishCounts[kw] || 0) + matches.length;
        }
      });
      BEARISH_KEYWORDS.forEach(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, "g");
        const matches = text.match(regex);
        if (matches) {
          bearishCounts[kw] = (bearishCounts[kw] || 0) + matches.length;
        }
      });
    });

    const bullishSorted = Object.keys(bullishCounts)
      .sort((a, b) => bullishCounts[b] - bullishCounts[a])
      .slice(0, 6);
    const bearishSorted = Object.keys(bearishCounts)
      .sort((a, b) => bearishCounts[b] - bearishCounts[a])
      .slice(0, 6);

    return { bullish: bullishSorted, bearish: bearishSorted };
  }, [data]);

  // Semicircle gauge calculation
  const gaugeNeedleRotation = useMemo(() => {
    if (!data) return 0;
    const score = data.sentimentScore; // -100 to 100
    // Semicircle: -90 deg (Bearish) to +90 deg (Bullish)
    return (score / 100) * 90;
  }, [data]);

  const getSentimentDetails = (sentiment: "BULLISH" | "BEARISH" | "NEUTRAL") => {
    switch (sentiment) {
      case "BULLISH":
        return {
          color: "text-emerald-400",
          bgColor: "bg-emerald-500/10",
          borderColor: "border-emerald-500/20",
          badgeColor: "bg-emerald-500/20 text-emerald-300",
          glowColor: "shadow-[0_0_15px_rgba(16,185,129,0.3)]",
          label: "Bullish Bias"
        };
      case "BEARISH":
        return {
          color: "text-rose-400",
          bgColor: "bg-rose-500/10",
          borderColor: "border-rose-500/20",
          badgeColor: "bg-rose-500/20 text-rose-300",
          glowColor: "shadow-[0_0_15px_rgba(244,63,94,0.3)]",
          label: "Bearish Bias"
        };
      default:
        return {
          color: "text-amber-400",
          bgColor: "bg-amber-500/10",
          borderColor: "border-amber-500/20",
          badgeColor: "bg-amber-500/20 text-amber-300",
          glowColor: "shadow-[0_0_15px_rgba(245,158,11,0.3)]",
          label: "Neutral Bias"
        };
    }
  };

  const activeDetails = useMemo(() => {
    if (!data) return getSentimentDetails("NEUTRAL");
    return getSentimentDetails(data.sentiment);
  }, [data]);

  return (
    <div className="w-full p-6 space-y-6 bg-[#040811] min-h-screen text-slate-100">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800/60 pb-5 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded font-mono font-bold tracking-widest uppercase">
              AMEX News Intelligence
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1">
            News Sentiment Intelligence
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Aggregated RSS feeds parsed in real-time, matching market direction indexes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data && (
            <div className="text-right hidden sm:block">
              <span className="text-xs text-slate-500 block font-mono">Last Updated</span>
              <span className="text-xs text-slate-300 font-mono">
                {new Date(data.lastUpdated).toLocaleTimeString()}
              </span>
            </div>
          )}
          <button
            onClick={() => fetchNews(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800/80 bg-slate-900/50 hover:bg-slate-800/80 text-slate-300 hover:text-white transition duration-150 text-sm font-semibold disabled:opacity-40"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <span className="text-sm font-mono text-slate-400">Fetching news feeds...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 border border-red-500/10 bg-red-950/5 rounded-xl max-w-xl mx-auto p-8 space-y-4 text-center">
          <AlertCircle size={40} className="text-red-500" />
          <h3 className="text-lg font-bold text-white">Failed to Load News Intelligence</h3>
          <p className="text-sm text-slate-400">{error}</p>
          <button
            onClick={() => fetchNews(false)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition duration-150"
          >
            Retry Fetch
          </button>
        </div>
      ) : !data ? (
        <div className="text-center py-20 text-slate-500">No news data available.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: Sentiment Meter & Drivers */}
          <div className="lg:col-span-4 space-y-6">
            {/* Sentiment Gauge Card */}
            <div className={`backdrop-blur-md bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 ${activeDetails.glowColor}`}>
              <div className="absolute top-4 left-4 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest">{data.instrument} BIAS</span>
              </div>

              {/* Gauge Graph */}
              <div className="relative w-48 h-28 mt-8 flex justify-center items-end">
                {/* Arc Background */}
                <svg className="w-full h-full" viewBox="0 0 100 50">
                  <path
                    d="M 10 50 A 40 40 0 0 1 90 50"
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  {/* Bullish / Bearish gradient segments */}
                  <path
                    d="M 10 50 A 40 40 0 0 1 50 50"
                    fill="none"
                    stroke="url(#bearish-grad)"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 50 50 A 40 40 0 0 1 90 50"
                    fill="none"
                    stroke="url(#bullish-grad)"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="bearish-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#f43f5e" />
                      <stop offset="100%" stopColor="#eab308" />
                    </linearGradient>
                    <linearGradient id="bullish-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#eab308" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* Needle */}
                <div
                  className="absolute bottom-0 w-1.5 h-16 bg-slate-300 origin-bottom rounded-full shadow-[0_0_8px_rgba(255,255,255,0.5)]"
                  style={{
                    transform: `rotate(${gaugeNeedleRotation}deg)`,
                    transition: "transform 1s cubic-bezier(0.34, 1.56, 0.64, 1)",
                    bottom: "-2px"
                  }}
                />
                {/* Needle Center Pin */}
                <div className="absolute bottom-[-6px] w-4.5 h-4.5 rounded-full bg-slate-200 border-2 border-slate-900 z-10 shadow-md" />
              </div>

              {/* Gauge labels */}
              <div className="w-full flex justify-between px-2 text-[10px] text-slate-500 font-mono mt-2 border-b border-slate-800/30 pb-4">
                <span>BEARISH (-100)</span>
                <span>NEUTRAL</span>
                <span>BULLISH (+100)</span>
              </div>

              {/* Score breakdown */}
              <div className="text-center mt-4">
                <span className={`text-4xl font-extrabold tracking-tight ${activeDetails.color}`}>
                  {data.sentimentScore > 0 ? `+${data.sentimentScore}` : data.sentimentScore}
                </span>
                <div className={`mt-2 px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase inline-block border ${activeDetails.badgeColor} ${activeDetails.borderColor}`}>
                  {activeDetails.label}
                </div>
              </div>
            </div>

            {/* Keyword Drivers Card */}
            <div className="backdrop-blur-md bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-300 border-b border-slate-800/50 pb-2">
                Top Sentiment Drivers
              </h2>
              <div className="space-y-4">
                {/* Bullish keywords */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 mb-2">
                    <TrendingUp size={14} />
                    <span>Bullish Signals</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {drivers.bullish.length > 0 ? (
                      drivers.bullish.map(word => (
                        <span
                          key={word}
                          className="text-xs px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-medium capitalize"
                        >
                          {word}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500 italic font-mono">No active bullish markers</span>
                    )}
                  </div>
                </div>

                {/* Bearish keywords */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 mb-2">
                    <TrendingDown size={14} />
                    <span>Bearish Signals</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {drivers.bearish.length > 0 ? (
                      drivers.bearish.map(word => (
                        <span
                          key={word}
                          className="text-xs px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono font-medium capitalize"
                        >
                          {word}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500 italic font-mono">No active bearish markers</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Information Card */}
            <div className="backdrop-blur-md bg-indigo-950/10 border border-indigo-900/25 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-indigo-400">
                <FileText size={15} />
                <h3 className="text-xs font-black uppercase tracking-wider font-mono">How it works</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                The AMEX news engine monitors official RSS feeds for {data.instrument} directly. Every headline is parsed, stripping tags and metadata, and mapped against an institutional sentiment scoring matrix. Aggregated indexes compile current volatility ratings, updating automatically to give context on macro market movements.
              </p>
            </div>
          </div>

          {/* RIGHT: Live News list */}
          <div className="lg:col-span-8">
            <div className="backdrop-blur-md bg-slate-900/40 border border-slate-800/60 rounded-xl flex flex-col h-[650px] overflow-hidden">
              {/* Header inside list */}
              <div className="px-6 py-4 border-b border-slate-800/60 flex justify-between items-center bg-slate-900/20">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Live Stream Feed ({data.news.length} Articles)
                </h2>
                <span className="text-xs text-slate-500 font-mono uppercase">ET MARKETS / MONEYCONTROL</span>
              </div>

              {/* Scrollable list */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40 custom-dashboard-scrollbar">
                {data.news.map((item, idx) => {
                  const itemDetails = getSentimentDetails(item.sentiment);
                  const isFallbackLink = item.link === "https://economictimes.indiatimes.com/markets";
                  return (
                    <div key={idx} className="p-6 hover:bg-slate-900/20 transition duration-150 group">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-2">
                        {/* Sentiment badge and date */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded border tracking-wider font-mono uppercase ${itemDetails.badgeColor} ${itemDetails.borderColor}`}>
                            {item.sentiment} ({item.score > 0 ? `+${item.score}` : item.score})
                          </span>
                          <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                            <Clock size={11} />
                            {item.pubDate ? new Date(item.pubDate).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            }) : "Recent"}
                          </span>
                        </div>

                        {/* Source indicator */}
                        <span className="text-[10px] text-slate-600 font-mono uppercase bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                          {item.link.includes("moneycontrol.com") ? "Moneycontrol" : "ET Markets"}
                        </span>
                      </div>

                      {/* Headline link */}
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group-hover:text-indigo-400 text-slate-100 font-bold text-base transition duration-150 inline-flex items-start gap-1 mb-2 leading-snug"
                      >
                        <span>{item.title}</span>
                        <ArrowUpRight size={14} className="text-slate-600 group-hover:text-indigo-400 flex-shrink-0 mt-1 transition duration-150" />
                      </a>

                      {/* Description */}
                      <p className="text-sm text-slate-400 leading-relaxed font-normal">
                        {item.description}
                        {isFallbackLink && (
                          <span className="text-xs text-slate-500 italic block mt-1">
                            * System cache fallback feed.
                          </span>
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewsDashboard;
