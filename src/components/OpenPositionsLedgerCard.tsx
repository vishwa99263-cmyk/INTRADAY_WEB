import React, { useMemo, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { OptionStrike, TEPaperTrade } from "../types";

export interface OpenPositionsLedgerCardProps {
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | string;
  spotPrice: number;
  dbTrades: TEPaperTrade[] | any[];
  optionChain: any[];
  niftyOptionChain?: any[];
  sensexOptionChain?: any[];
  bankniftyOptionChain?: any[];
  onTradeClosed?: () => void;
  darkMode?: boolean;
  forceInstrument?: "NIFTY" | "SENSEX" | "BANKNIFTY"; // lock card to one instrument
  tradeTypeFilter?: "INTRADAY" | "POSITIONAL";
  isRealTrade?: boolean;
}

const getApiUrl = (path: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

type FilterTab = "ALL" | "NIFTY" | "BANKNIFTY" | "SENSEX" | "PENDING" | "HISTORY";

export default function OpenPositionsLedgerCard({
  activePage,
  spotPrice,
  dbTrades,
  optionChain,
  niftyOptionChain,
  sensexOptionChain,
  bankniftyOptionChain,
  onTradeClosed,
  darkMode = false,
  forceInstrument,
  tradeTypeFilter,
  isRealTrade = false,
}: OpenPositionsLedgerCardProps) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>(forceInstrument ?? "ALL");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [fyersAutoTrade, setFyersAutoTrade] = useState(false);

  React.useEffect(() => {
    if (forceInstrument) {
      const stored = localStorage.getItem(`fyers_auto_trade_${forceInstrument}`);
      if (stored === "true") setFyersAutoTrade(true);

      // Sync from backend
      fetch(getApiUrl("/api/fyers/auto-trade-state"))
        .then(res => res.json())
        .then(data => {
          if (data.success && data.states) {
            const instVal = !!data.states[forceInstrument];
            setFyersAutoTrade(instVal);
            localStorage.setItem(`fyers_auto_trade_${forceInstrument}`, instVal ? "true" : "false");
          }
        })
        .catch(() => {});
    }
  }, [forceInstrument]);

  const handleToggleAutoTrade = () => {
    if (!forceInstrument) return;
    const nextVal = !fyersAutoTrade;
    setFyersAutoTrade(nextVal);
    localStorage.setItem(`fyers_auto_trade_${forceInstrument}`, nextVal ? "true" : "false");

    // Sync to backend
    fetch(getApiUrl("/api/fyers/auto-trade-state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrument: forceInstrument, enabled: nextVal }),
    }).catch(err => console.error("Failed to sync auto-trade state:", err));
  };

  const HEDGE_DIRS = new Set(["BULL_SPREAD", "BEAR_SPREAD"]);
  const isNakedTrade = (t: TEPaperTrade) =>
    !HEDGE_DIRS.has(t.direction) && !(t.notes || "").includes("Spread Hedge");

  const getCurrentPremium = (pos: TEPaperTrade): number => {
    const chain =
      pos.instrument === "NIFTY"
        ? (niftyOptionChain ?? optionChain)
        : pos.instrument === "BANKNIFTY"
        ? (bankniftyOptionChain ?? optionChain)
        : (sensexOptionChain ?? optionChain);
    const strikeData = chain?.find(s => s.strikePrice === pos.strike);
    if (!strikeData) return pos.entry_price;
    return pos.direction === "BUY_CE"
      ? (strikeData.ceLtp ?? pos.entry_price)
      : (strikeData.peLtp ?? pos.entry_price);
  };

  // OPEN trades (all instruments)
  const allOpenPositions = useMemo(() => {
    return dbTrades
      .filter(t => t.status === "OPEN" && isNakedTrade(t))
      .filter(t => !tradeTypeFilter || (t as any).tradeType === tradeTypeFilter || (t as any).strategyName === tradeTypeFilter)
      .map(pos => {
        const currentPremium = getCurrentPremium(pos);
        const lotMultiplier = isRealTrade ? 1 : (pos.lot_size || 1);
        const livePnl = (currentPremium - pos.entry_price) * pos.qty * lotMultiplier;
        return { ...pos, currentPremium, livePnl: parseFloat(livePnl.toFixed(1)) };
      });
  }, [dbTrades, niftyOptionChain, sensexOptionChain, bankniftyOptionChain, optionChain, tradeTypeFilter, isRealTrade]);

  // PENDING trades (all instruments)
  const allPendingPositions = useMemo(() => {
    return dbTrades
      .filter(t => (t.status as string) === "PENDING" && isNakedTrade(t))
      .filter(t => !tradeTypeFilter || (t as any).tradeType === tradeTypeFilter || (t as any).strategyName === tradeTypeFilter)
      .map(pos => ({
        ...pos,
        currentPremium: getCurrentPremium(pos),
        livePnl: 0,
      }));
  }, [dbTrades, niftyOptionChain, sensexOptionChain, bankniftyOptionChain, optionChain, tradeTypeFilter]);

  // ── Market-hours detection (IST 9:15 – 15:30) ──────────────────────────────
  const isMarketHours = useMemo(() => {
    const now  = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= 555 && mins < 930; // 9:15 = 555, 15:30 = 930
  }, []);

  // ── Today's midnight in ms ───────────────────────────────────────────────────
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  // CLOSED trades history
  // • During market hours  → TODAY only (intraday closed trades)
  // • Outside market hours → All history (old data visible on load)
  const allClosedTrades = useMemo(() => {
    return dbTrades
      .filter(t => t.status === "CLOSED" || t.status === "FAILED")
      .filter(t => !forceInstrument || t.instrument === forceInstrument)
      .filter(t => {
        if (!isMarketHours) return true; // outside hours: show everything
        const closedAt = (t as any).closed_at;
        if (!closedAt) return false;
        return Number(closedAt) >= todayStart; // during hours: today only
      })
      .sort((a, b) => ((b as any).closed_at || 0) - ((a as any).closed_at || 0))
      .slice(0, historyLimit);
  }, [dbTrades, forceInstrument, historyLimit, todayStart, isMarketHours]);


  const filtered = useMemo(() => {
    if (filterTab === "PENDING") {
      return forceInstrument
        ? allPendingPositions.filter(p => p.instrument === forceInstrument)
        : allPendingPositions;
    }
    const base = allOpenPositions;
    const inst = forceInstrument ?? (filterTab === "ALL" ? null : filterTab);
    if (inst) return base.filter(p => p.instrument === inst);
    return base;
  }, [allOpenPositions, allPendingPositions, filterTab, forceInstrument]);

  const totalPnl = allOpenPositions
    .filter(p => filterTab === "ALL" || p.instrument === filterTab)
    .reduce((s, p) => s + p.livePnl, 0);

  const niftyCount  = [...allOpenPositions, ...allPendingPositions].filter(p => p.instrument === "NIFTY").length;
  const bankniftyCount = [...allOpenPositions, ...allPendingPositions].filter(p => p.instrument === "BANKNIFTY").length;
  const sensexCount = [...allOpenPositions, ...allPendingPositions].filter(p => p.instrument === "SENSEX").length;
  const pendingCount = allPendingPositions.length;

  const handleManualClose = async (pos: any) => {
    if (closingId) return;
    setClosingId(pos.id);
    try {
      const url = isRealTrade
        ? getApiUrl(`/api/real-trades/close/${pos.id}`)
        : getApiUrl("/api/te/paper-trades/close");
      
      const body = isRealTrade
        ? { exit_price: parseFloat(pos.currentPremium.toFixed(1)), reason: "MANUAL" }
        : {
            id: pos.id,
            exit_price: parseFloat(pos.currentPremium.toFixed(1)),
            pnl: parseFloat(pos.livePnl.toFixed(1)),
            notes: `${pos.notes || ""} [Manually Closed]`,
          };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok && onTradeClosed) onTradeClosed();
    } catch (e) {
      console.error("Manual exit failed:", pos.id, e);
    } finally {
      setClosingId(null);
    }
  };

  const closedCount = allClosedTrades.length;

  const tabs: { key: FilterTab; label: string; count: number; color: string }[] = [
    { key: "ALL",       label: "ALL",       count: allOpenPositions.length + allPendingPositions.length, color: "#6366f1" },
    { key: "NIFTY",     label: "NIFTY",     count: niftyCount,     color: "#10b981" },
    { key: "BANKNIFTY", label: "BANKNIFTY", count: bankniftyCount, color: "#8b5cf6" },
    { key: "SENSEX",    label: "SENSEX",    count: sensexCount,    color: "#f59e0b" },
    { key: "PENDING",   label: "⏳ WAIT",   count: pendingCount,   color: "#f97316" },
    { key: "HISTORY",   label: "📜 HISTORY", count: closedCount,   color: "#64748b" },
  ];

  // ── Instrument accent colour ─────────────────────────────────────────────
  const instColor =
    forceInstrument === "NIFTY"     ? "#10b981" :
    forceInstrument === "BANKNIFTY" ? "#8b5cf6" :
    forceInstrument === "SENSEX"    ? "#f59e0b" : "#6366f1";

  // ── Instrument 1-2 letter initial + full display name ─────────────────────
  const instInitial =
    forceInstrument === "NIFTY"     ? "N" :
    forceInstrument === "BANKNIFTY" ? "B" :
    forceInstrument === "SENSEX"    ? "S" : "◈";

  const instName =
    forceInstrument === "NIFTY"     ? "NIFTY" :
    forceInstrument === "BANKNIFTY" ? "BANKNIFTY" :
    forceInstrument === "SENSEX"    ? "SENSEX" :
    forceInstrument ?? "POSITIONS";

  return (
    <div
      className="w-full flex flex-col select-none relative overflow-hidden rounded-lg transition-all duration-300"
      style={{
        background: "linear-gradient(145deg, #020508 0%, #04080f 60%, #020508 100%)",
        border: `1px solid ${instColor}28`,
        boxShadow: `0 0 20px ${instColor}08, 0 4px 24px rgba(0,0,0,0.7)`,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      {/* ── Top glow beam (instrument-colored) ─────────────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 h-[1.5px] pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${instColor}90, transparent)`,
                 boxShadow: `0 0 8px ${instColor}60` }}
      />
      {/* ── CRT scanline texture ────────────────────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.02) 2px, rgba(0,0,0,0.02) 4px)",
        }}
      />

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* HEADER ROW                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div
        className="relative z-10 flex items-center justify-between px-2 pt-2 pb-1.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        {/* LEFT: Instrument dot + icon + ACTIVE + FYERS AUTO */}
        <div className="flex items-center gap-1.5 min-w-0">

          {/* Colored instrument marker — NO text name */}
          <div
            className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
            style={{
              background: `${instColor}18`,
              border: `1px solid ${instColor}40`,
              boxShadow: `0 0 8px ${instColor}25`,
            }}
          >
            <span
              className="text-[9px] font-black leading-none"
              style={{ color: instColor }}
            >
              {instInitial}
            </span>
          </div>

          {/* Full instrument name — colored + glowing */}
          <span
            className="text-[9.5px] font-black uppercase tracking-widest leading-none truncate flex-shrink-0"
            style={{
              color: instColor,
              textShadow: `0 0 12px ${instColor}70`,
            }}
          >
            {instName}
          </span>

          {/* Pulsing ACTIVE badge */}
          {forceInstrument && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[7.5px] font-black uppercase tracking-widest flex-shrink-0"
              style={{
                color: "#818cf8",
                background: "rgba(99,102,241,0.1)",
                border: "1px solid rgba(99,102,241,0.28)",
                boxShadow: "inset 0 0 6px rgba(99,102,241,0.12)",
              }}
            >
              <span
                className="relative flex h-1.5 w-1.5"
              >
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500" />
              </span>
              ACTIVE
            </span>
          )}

          {/* FYERS AUTO toggle — icon-only dot + label, ultra compact */}
          {forceInstrument && (
            <button
              onClick={handleToggleAutoTrade}
              title={`Toggle Fyers Auto-Trade for ${forceInstrument}`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[7.5px] font-black uppercase tracking-widest transition-all cursor-pointer outline-none flex-shrink-0"
              style={{
                color: fyersAutoTrade ? "#10b981" : "#475569",
                background: fyersAutoTrade ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.02)",
                borderColor: fyersAutoTrade ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.06)",
                boxShadow: fyersAutoTrade ? "0 0 8px rgba(16,185,129,0.18)" : "none",
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: fyersAutoTrade ? "#10b981" : "#334155",
                  boxShadow: fyersAutoTrade ? "0 0 5px #10b981" : "none",
                  animation: fyersAutoTrade ? "pulse 1.5s infinite" : "none",
                }}
              />
              <span>AUTO</span>
            </button>
          )}
        </div>

        {/* RIGHT: Live PnL — micro compact */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {totalPnl >= 0
            ? <TrendingUp size={9} style={{ color: "#10b981" }} />
            : <TrendingDown size={9} style={{ color: "#f43f5e" }} />
          }
          <span
            className="text-[10.5px] font-black font-mono leading-none"
            style={{
              color: totalPnl >= 0 ? "#10b981" : "#f43f5e",
              textShadow: totalPnl >= 0 ? "0 0 10px rgba(16,185,129,0.4)" : "0 0 10px rgba(244,63,94,0.4)",
            }}
          >
            {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </span>
          {/* Lightning icon — quick nav */}
          <button
            onClick={() => {}}
            className="ml-0.5 w-4 h-4 flex items-center justify-center rounded"
            style={{ color: instColor, background: `${instColor}12`, border: `1px solid ${instColor}25` }}
            title="Settings"
          >
            <svg width="7" height="7" viewBox="0 0 10 12" fill="currentColor">
              <path d="M6 0L0 7h5l-1 5 6-8H5L6 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB ROW                                                           */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="relative z-10 px-2 pt-1 pb-1.5">

        {/* ── Multi-instrument tabs (no forceInstrument) ─────────────── */}
        {!forceInstrument && (
          <div className="flex items-center gap-1 flex-wrap">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilterTab(tab.key)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border transition-all cursor-pointer"
                style={{
                  background: filterTab === tab.key ? `${tab.color}18` : "transparent",
                  borderColor: filterTab === tab.key ? `${tab.color}45` : "rgba(255,255,255,0.05)",
                  color: filterTab === tab.key ? tab.color : "#334155",
                  boxShadow: filterTab === tab.key ? `0 0 8px ${tab.color}18` : "none",
                }}
              >
                <span>{tab.label}</span>
                <span
                  className="px-1 rounded text-[7.5px] font-black"
                  style={{
                    background: filterTab === tab.key ? `${tab.color}22` : "rgba(255,255,255,0.04)",
                    color: filterTab === tab.key ? tab.color : "#475569",
                  }}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── Instrument-locked mini tabs ─────────────────────────────── */}
        {forceInstrument && (
          <div className="flex items-center gap-1">
            {(["ALL", "PENDING", "HISTORY"] as const).map(key => {
              const count =
                key === "PENDING"
                  ? allPendingPositions.filter(p => p.instrument === forceInstrument).length
                  : key === "HISTORY"
                  ? closedCount
                  : filtered.length;
              const tabColor =
                key === "PENDING" ? "#f97316"
                : key === "HISTORY" ? "#64748b"
                : instColor;
              const isActive =
                key === "HISTORY"  ? filterTab === "HISTORY"
                : key === "PENDING" ? filterTab === "PENDING"
                : (filterTab !== "PENDING" && filterTab !== "HISTORY");
              const tabLabel =
                key === "PENDING" ? "⏳ WAIT"
                : key === "HISTORY" ? "📜 HIST"
                : "OPEN";
              return (
                <button
                  key={key}
                  onClick={() => setFilterTab(key === "ALL" ? forceInstrument : key)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border transition-all cursor-pointer"
                  style={{
                    background: isActive ? `${tabColor}18` : "transparent",
                    borderColor: isActive ? `${tabColor}45` : "rgba(255,255,255,0.05)",
                    color: isActive ? tabColor : "#334155",
                    boxShadow: isActive ? `0 0 8px ${tabColor}18` : "none",
                  }}
                >
                  <span>{tabLabel}</span>
                  <span
                    className="px-1 rounded text-[7.5px] font-black"
                    style={{
                      background: isActive ? `${tabColor}22` : "rgba(255,255,255,0.04)",
                      color: isActive ? tabColor : "#475569",
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* HISTORY VIEW */}
      {filterTab === "HISTORY" && (
        <div className="flex flex-col gap-1.5 px-2 pb-2 max-h-[260px] overflow-y-auto custom-dashboard-scrollbar">

          {/* ── Mode Indicator Banner ──────────────────────────────────── */}
          <div className="flex items-center justify-between pt-0.5">
            {isMarketHours ? (
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[7.5px] font-black uppercase tracking-widest border"
                style={{
                  color: "#10b981",
                  background: "rgba(16,185,129,0.08)",
                  borderColor: "rgba(16,185,129,0.25)",
                }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                TODAY · LIVE
              </div>
            ) : (
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[7.5px] font-black uppercase tracking-widest border"
                style={{
                  color: "#64748b",
                  background: "rgba(100,116,139,0.07)",
                  borderColor: "rgba(100,116,139,0.2)",
                }}
              >
                <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 1a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h1V1zm1 2H3v10h10V3h-1v1a1 1 0 0 1-2 0V3H6v1a1 1 0 0 1-2 0V3z"/>
                </svg>
                ALL HISTORY
              </div>
            )}
            <span className="text-[7px] text-slate-700 font-mono">
              {allClosedTrades.length} trade{allClosedTrades.length !== 1 ? "s" : ""}
            </span>
          </div>

          {allClosedTrades.length === 0 ? (
            <div className="text-center py-5 text-[9.5px] italic rounded-md border border-dashed text-slate-600 border-slate-800/40">
              {isMarketHours
                ? "📭 No trades closed today"
                : "📭 No trade history found"}
            </div>
          ) : (
            <>
              {allClosedTrades.map(t => {
                const pnl = (t as any).pnl ?? 0;
                const isWin = pnl > 0;
                const inst = t.instrument ?? "NIFTY";
                const instrColor = inst === "NIFTY" ? "#10b981" : inst === "BANKNIFTY" ? "#8b5cf6" : "#f59e0b";
                const closedAtMs = (t as any).closed_at;
                const closedAt = closedAtMs
                  ? new Date(closedAtMs).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "—";
                const entryAt = (t as any).entry_time
                  ? new Date((t as any).entry_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "—";
                // Show date prefix on old trades (outside market hours)
                const tradeDate = closedAtMs && !isMarketHours
                  ? new Date(closedAtMs).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                  : null;

                return (
                  <div key={t.id}
                    className="p-2 rounded-md flex flex-col gap-1 text-xs font-mono border"
                    style={{
                      background: isWin ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
                      borderColor: isWin ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
                      borderLeftColor: isWin ? "#10b981" : "#ef4444",
                      borderLeftWidth: "2px",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[8.5px] font-black px-1.5 py-0.5 rounded border uppercase"
                          style={{ color: instrColor, borderColor: `${instrColor}40`, background: `${instrColor}12` }}>
                          {inst}
                        </span>
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border uppercase ${
                          t.status === "FAILED" ? "bg-red-500/15 border-red-500/30 text-rose-500" : isWin ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-red-500/15 border-red-500/30 text-red-400"
                        }`}>
                          {t.status === "FAILED" ? "❌ FAILED" : isWin ? "✅ WIN" : "❌ LOSS"}
                        </span>
                        <span className="text-[9.5px] font-bold text-slate-300">{t.direction?.replace("BUY_", "")} {t.strike}</span>
                      </div>
                      <span className={`font-black text-[13px] ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                        {pnl >= 0 ? "+" : ""}₹{pnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-400">
                      <span>Entry: ₹{t.entry_price?.toFixed(1)} → Exit: ₹{((t as any).exit_price ?? 0).toFixed(1)}</span>
                      <span className="flex items-center gap-1">
                        {tradeDate && (
                          <span
                            className="text-[7.5px] font-black px-1 py-px rounded uppercase"
                            style={{ color: "#64748b", background: "rgba(100,116,139,0.12)", border: "1px solid rgba(100,116,139,0.2)" }}
                          >
                            {tradeDate}
                          </span>
                        )}
                        {entryAt} → {closedAt}
                      </span>
                    </div>
                    {t.strategyName && (
                      <div className="text-[8.5px] text-violet-400/90 truncate font-semibold">{t.strategyName}</div>
                    )}
                    {t.notes && (
                      <div className={`text-[8.5px] mt-1 font-semibold truncate ${t.status === "FAILED" ? "text-rose-400" : "text-slate-500"}`}>
                        {t.status === "FAILED" ? `Rejection: ${t.notes}` : t.notes}
                      </div>
                    )}
                  </div>
                );
              })}
              {allClosedTrades.length >= historyLimit && (
                <button onClick={() => setHistoryLimit(h => h + 10)}
                  className="text-[9.5px] font-bold text-slate-400 hover:text-slate-200 text-center py-1.5 border border-dashed border-slate-800 rounded cursor-pointer transition-colors">
                  Load more...
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Open/Pending Positions */}
      {filterTab !== "HISTORY" && (
      <div className="flex flex-col gap-1.5 px-2 pb-2 max-h-[240px] overflow-y-auto">
        {filtered.length > 0 ? (
          filtered.map(pos => {
            const isPending = (pos.status as string) === "PENDING";
            const priceRange = pos.target - pos.stop_loss;
            const premiumRatio = priceRange > 0
              ? Math.min(100, Math.max(0, ((pos.currentPremium - pos.stop_loss) / priceRange) * 100))
              : 50;
            const isCE = pos.direction === "BUY_CE";
            const inst = pos.instrument ?? activePage;
            const instrColor = inst === "NIFTY" ? "#10b981" : inst === "BANKNIFTY" ? "#8b5cf6" : "#f59e0b";
            const pnlColor = pos.livePnl >= 0 ? "text-emerald-400" : "text-rose-400";
            const dirBadge = isCE
              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
              : "bg-red-500/15 border-red-500/30 text-red-400";

            // Parse notes for hover tooltip
            let parsedNotes: any = null;
            try { parsedNotes = pos.notes ? JSON.parse(pos.notes) : null; } catch {}
            const why = parsedNotes?.whyTaken;
            const isHovered = hoveredId === pos.id;

            return (
              <div
                key={pos.id}
                className="p-2 rounded-md flex flex-col gap-1.5 text-xs font-mono border relative"
                style={{
                  background: isPending
                    ? "rgba(249,115,22,0.05)"
                    : "rgba(3,5,10,0.5)",
                  borderColor: isPending
                    ? "rgba(249,115,22,0.25)"
                    : `${instrColor}18`,
                  borderLeftColor: isPending ? "#f97316" : instrColor,
                  borderLeftWidth: "2px",
                }}
                onMouseEnter={() => setHoveredId(pos.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* WHY TAKEN tooltip on hover */}
                {isHovered && why && (
                  <div
                    className="absolute z-50 rounded-lg border shadow-2xl p-2.5 text-[8.5px] font-sans leading-relaxed"
                    style={{
                      bottom: "calc(100% + 6px)",
                      left: 0,
                      right: 0,
                      background: "linear-gradient(135deg, #0c1220 0%, #111827 100%)",
                      borderColor: `${instrColor}40`,
                      color: "#cbd5e1",
                      boxShadow: `0 8px 32px rgba(0,0,0,0.7), 0 0 12px ${instrColor}15`,
                      maxWidth: "340px",
                      minWidth: "260px",
                      pointerEvents: "none",
                    }}
                  >
                    <div className="text-[7.5px] font-black uppercase tracking-widest mb-1.5 flex items-center gap-1" style={{ color: instrColor }}>
                      <span>📋 WHY THIS TRADE</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span className="text-slate-500">Regime:</span>
                      <span className="font-bold text-blue-300">{why.regimeLabel || "—"}</span>
                      <span className="text-slate-500">Wtd Score:</span>
                      <span className={`font-bold ${(why.weightedStockScore || 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{why.weightedStockScore ?? "—"}</span>
                      <span className="text-slate-500">Direction:</span>
                      <span className="font-bold text-amber-300">{why.weightedDirection || "—"}</span>
                      <span className="text-slate-500">Momentum:</span>
                      <span className="font-bold text-cyan-300">{why.momentumScore ?? "—"}/100</span>
                      <span className="text-slate-500">PCR:</span>
                      <span className="font-bold text-violet-300">{why.pcr ?? "—"}</span>
                      <span className="text-slate-500">VIX:</span>
                      <span className="font-bold text-orange-300">{why.vix ?? "—"}</span>
                      <span className="text-slate-500">Smart Money:</span>
                      <span className="font-bold text-teal-300">{why.smartMoneyBias || "—"}</span>
                      <span className="text-slate-500">Signal Grade:</span>
                      <span className={`font-bold ${why.signalGrade === "A" ? "text-emerald-400" : why.signalGrade === "B" ? "text-blue-400" : "text-slate-400"}`}>{why.signalGrade || "—"}</span>
                      <span className="text-slate-500">Antigravity:</span>
                      <span className="font-bold text-indigo-300">{why.antigravityScore ?? "—"}</span>
                      <span className="text-slate-500">Gates:</span>
                      <span className="font-bold text-slate-300">{why.gatesPassed ?? "?"}/{why.totalGates ?? "?"}</span>
                    </div>
                    {why.keyStockMovers && (
                      <div className="mt-1.5 pt-1 border-t border-white/5">
                        <span className="text-slate-500">Key Movers: </span>
                        <span className="text-yellow-300/80">{why.keyStockMovers}</span>
                      </div>
                    )}
                    {why.orbStatus && (
                      <div className="mt-0.5">
                        <span className="text-slate-500">ORB: </span>
                        <span className="text-cyan-300/80">{why.orbStatus}</span>
                      </div>
                    )}
                    {parsedNotes?.reason && (
                      <div className="mt-1 pt-1 border-t border-white/5 text-[7.5px] text-slate-400 line-clamp-2">
                        {parsedNotes.reason.substring(0, 180)}
                      </div>
                    )}
                  </div>
                )}
                {/* Top Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {/* Instrument */}
                    <span
                      className="text-[9px] font-black px-1.5 py-0.5 rounded border uppercase"
                      style={{ color: instrColor, borderColor: `${instrColor}40`, background: `${instrColor}12` }}
                    >
                      {inst}
                    </span>

                    {/* PENDING badge */}
                    {isPending && (
                      <span className="text-[8.5px] font-black px-1.5 py-0.5 rounded border uppercase text-orange-400 border-orange-500/30 bg-orange-500/10 animate-pulse">
                        ⏳ PENDING
                      </span>
                    )}

                    {/* Direction */}
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border uppercase ${dirBadge}`}>
                      {pos.direction.replace("BUY_", "")}
                    </span>
                    <span className="font-black text-[12px] text-white font-mono">
                      {pos.strike}
                    </span>
                  </div>

                  {/* Action Button */}
                  {isPending ? (
                    <button
                      onClick={() => handleManualClose(pos)}
                      disabled={closingId === pos.id}
                      className={`text-[9.5px] font-black px-2 py-0.5 rounded border flex items-center gap-1 transition-all cursor-pointer ${
                        closingId === pos.id
                          ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                          : "border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/25 shadow-sm"
                      }`}
                    >
                      {closingId === pos.id
                        ? <><RefreshCw size={8} className="animate-spin" /> …</>
                        : "✕ CANCEL"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleManualClose(pos)}
                      disabled={closingId === pos.id}
                      className={`text-[9.5px] font-black px-2 py-0.5 rounded border flex items-center gap-1 transition-all cursor-pointer ${
                        closingId === pos.id
                          ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                          : "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/25 shadow-sm"
                      }`}
                    >
                      {closingId === pos.id
                        ? <><RefreshCw size={8} className="animate-spin" /> …</>
                        : "✕ CLOSE"}
                    </button>
                  )}
                </div>

                {/* Strategy row */}
                {pos.strategyName && (
                  <div className="text-[9px] font-black tracking-wide uppercase flex items-center gap-1 select-none mt-[-1px] mb-[1px]">
                    <span className="text-slate-400">STRATEGY:</span>
                    <span className="text-violet-400 truncate max-w-[220px]" title={pos.strategyName}>
                      {pos.strategyName}
                    </span>
                  </div>
                )}

                {/* Entry/LTP row */}
                <div
                  className="flex justify-between text-[10.5px] font-mono pb-1 border-b"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "#cbd5e1" }}
                >
                  <span className="font-semibold text-slate-300">
                    Qty: {pos.qty}{!isRealTrade && `×${pos.lot_size}`}
                  </span>
                  {isPending ? (
                    <span>
                      Entry: <span className="text-orange-400 font-black">₹{pos.entry_price.toFixed(1)}</span>
                      {" | "}LTP: <span className="text-cyan-300 font-black animate-pulse">₹{pos.currentPremium.toFixed(1)}</span>
                    </span>
                  ) : (
                    <span>
                      Entry ₹{pos.entry_price.toFixed(1)} → <span className="text-cyan-300 font-black text-[11.5px] animate-pulse drop-shadow">LTP ₹{pos.currentPremium.toFixed(1)}</span>
                    </span>
                  )}
                </div>

                {/* Progress bar / Awaiting Fill */}
                {isPending ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-[3px] rounded-full overflow-hidden bg-orange-500/10">
                      <div
                        className="h-full rounded-full animate-pulse"
                        style={{
                          width: `${Math.min(100, Math.abs(((pos.currentPremium - pos.entry_price) / pos.entry_price) * 100 * 10))}%`,
                          background: pos.currentPremium <= pos.entry_price ? "#f97316" : "#94a3b8",
                        }}
                      />
                    </div>
                    <span className="text-[8.5px] font-black text-orange-400 whitespace-nowrap">
                      {pos.currentPremium <= pos.entry_price
                        ? `₹${(pos.entry_price - pos.currentPremium).toFixed(1)} to fill`
                        : "Above entry"}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1 pt-0.5">
                    <div className="flex justify-between text-[9.5px] font-black font-mono text-slate-400 uppercase">
                      <span>SL ₹{pos.stop_loss.toFixed(0)}</span>
                      <span>LTP ₹{pos.currentPremium.toFixed(0)}</span>
                      <span>TGT ₹{pos.target.toFixed(0)}</span>
                    </div>
                    <div className="w-full h-[4px] rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${premiumRatio}%`, backgroundColor: pos.livePnl >= 0 ? "#10b981" : "#ef4444" }}
                      />
                    </div>
                  </div>
                )}

                {/* P&L or Awaiting */}
                {!isPending && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[9.5px] uppercase font-black tracking-wider text-slate-400">P&L:</span>
                    <span className={`font-black font-mono text-[14px] sm:text-[15px] tracking-tight ${pnlColor} drop-shadow-[0_0_4px_rgba(0,0,0,0.6)]`}>
                      {pos.livePnl >= 0 ? "+" : ""}₹{pos.livePnl.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-center py-5 text-[10.5px] italic rounded-md border border-dashed text-slate-500 border-slate-800/40">
            {filterTab === "PENDING"
              ? "No pending orders waiting to fill"
              : filterTab === "ALL"
              ? "No active or pending positions"
              : `No ${filterTab} positions`}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
