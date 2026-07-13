import React, { useMemo, useState } from "react";
import { BookOpen, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { OptionStrike, TEPaperTrade } from "../types";

export interface OpenPositionsLedgerCardProps {
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | string;
  spotPrice: number;
  dbTrades: TEPaperTrade[];
  optionChain: any[];
  niftyOptionChain?: any[];
  sensexOptionChain?: any[];
  bankniftyOptionChain?: any[];
  onTradeClosed?: () => void;
  darkMode?: boolean;
  forceInstrument?: "NIFTY" | "SENSEX" | "BANKNIFTY"; // lock card to one instrument
  tradeTypeFilter?: "INTRADAY" | "POSITIONAL";
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
}: OpenPositionsLedgerCardProps) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>(forceInstrument ?? "ALL");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(10);

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
        const livePnl = (currentPremium - pos.entry_price) * pos.qty * pos.lot_size;
        return { ...pos, currentPremium, livePnl: parseFloat(livePnl.toFixed(1)) };
      });
  }, [dbTrades, niftyOptionChain, sensexOptionChain, bankniftyOptionChain, optionChain, tradeTypeFilter]);

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

  // CLOSED trades history
  const allClosedTrades = useMemo(() => {
    return dbTrades
      .filter(t => t.status === "CLOSED")
      .filter(t => !forceInstrument || t.instrument === forceInstrument)
      .sort((a, b) => ((b as any).closed_at || 0) - ((a as any).closed_at || 0))
      .slice(0, historyLimit);
  }, [dbTrades, forceInstrument, historyLimit]);

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
      const res = await fetch(getApiUrl("/api/te/paper-trades/close"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pos.id,
          exit_price: parseFloat(pos.currentPremium.toFixed(1)),
          pnl: parseFloat(pos.livePnl.toFixed(1)),
          notes: `${pos.notes || ""} [Manually Closed]`,
        }),
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

  return (
    <div
      className="w-full flex flex-col gap-1.5 font-sans select-none border rounded-lg shadow-md transition-all duration-300 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #03050a 0%, #060a14 55%, #03050a 100%)",
        borderColor: "rgba(255,255,255,0.06)",
        color: "#f1f5f9",
        boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
      }}
    >
      {/* Top accent */}
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-teal-500 via-indigo-500 to-purple-500" />

      <div className="p-2 pb-0">
        {/* Header */}
        <div className="flex items-center justify-between pb-1.5 border-b border-white/5">
          <div className="flex items-center gap-1.5">
            <BookOpen size={11} className={forceInstrument === "NIFTY" ? "text-emerald-400" : forceInstrument === "BANKNIFTY" ? "text-purple-400" : forceInstrument === "SENSEX" ? "text-amber-400" : "text-teal-400"} />
            <span className="text-[9.5px] font-black uppercase tracking-widest text-slate-400">
              {forceInstrument ? `${forceInstrument} POSITIONS` : "Open Positions Ledger"}
            </span>
            {forceInstrument && (
              <span className="text-[7.5px] font-black px-1.5 py-0.5 rounded border uppercase text-indigo-400 bg-indigo-500/10 border-indigo-500/30 shadow-[inset_0_0_8px_rgba(99,102,241,0.15)] flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-indigo-500 animate-ping" />
                ACTIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {totalPnl >= 0
              ? <TrendingUp size={10} className="text-emerald-400" />
              : <TrendingDown size={10} className="text-rose-400" />}
            <span className={`text-[10px] font-black font-mono ${totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* Filter Tabs — only when not force-locked */}
        {!forceInstrument && (
          <div className="flex items-center gap-1 pt-1.5 pb-1 flex-wrap">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilterTab(tab.key)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[8.5px] font-black uppercase tracking-wider border transition-all cursor-pointer"
                style={{
                  background: filterTab === tab.key ? `${tab.color}18` : "transparent",
                  borderColor: filterTab === tab.key ? `${tab.color}50` : "rgba(255,255,255,0.06)",
                  color: filterTab === tab.key ? tab.color : "#64748b",
                }}
              >
                {tab.label}
                <span
                  className="px-1 py-px rounded text-[7.5px] font-black"
                  style={{
                    background: filterTab === tab.key ? `${tab.color}25` : "rgba(255,255,255,0.04)",
                    color: filterTab === tab.key ? tab.color : "#475569",
                  }}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Mini tabs when force-locked */}
        {forceInstrument && (
          <div className="flex items-center gap-1 pt-1.5 pb-1">
            {(["ALL", "PENDING", "HISTORY"] as const).map(key => {
              const count = key === "PENDING"
                ? allPendingPositions.filter(p => p.instrument === forceInstrument).length
                : key === "HISTORY" ? closedCount
                : filtered.length;
              const color = key === "PENDING" ? "#f97316" : key === "HISTORY" ? "#64748b" : (forceInstrument === "NIFTY" ? "#10b981" : forceInstrument === "BANKNIFTY" ? "#8b5cf6" : "#f59e0b");
              const isActive = key === "HISTORY" ? filterTab === "HISTORY" : key === "PENDING" ? filterTab === "PENDING" : (filterTab !== "PENDING" && filterTab !== "HISTORY");
              return (
                <button
                  key={key}
                  onClick={() => setFilterTab(key === "ALL" ? forceInstrument : key)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[8.5px] font-black uppercase tracking-wider border transition-all cursor-pointer"
                  style={{
                    background: isActive ? `${color}18` : "transparent",
                    borderColor: isActive ? `${color}50` : "rgba(255,255,255,0.06)",
                    color: isActive ? color : "#64748b",
                  }}
                >
                  {key === "PENDING" ? "⏳ WAIT" : key === "HISTORY" ? "📜 HIST" : "OPEN"}
                  <span className="px-1 py-px rounded text-[7.5px] font-black" style={{ background: "rgba(255,255,255,0.05)" }}>
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
        <div className="flex flex-col gap-1.5 px-2 pb-2 max-h-[260px] overflow-y-auto">
          {allClosedTrades.length === 0 ? (
            <div className="text-center py-5 text-[10px] italic rounded-md border border-dashed text-slate-600 border-slate-800/40">
              No closed trades yet
            </div>
          ) : (
            <>
              {allClosedTrades.map(t => {
                const pnl = (t as any).pnl ?? 0;
                const isWin = pnl > 0;
                const inst = t.instrument ?? "NIFTY";
                const instrColor = inst === "NIFTY" ? "#10b981" : inst === "BANKNIFTY" ? "#8b5cf6" : "#f59e0b";
                const closedAt = (t as any).closed_at ? new Date((t as any).closed_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
                const entryAt = (t as any).entry_time ? new Date((t as any).entry_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
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
                        <span className="text-[7.5px] font-black px-1 py-px rounded border uppercase"
                          style={{ color: instrColor, borderColor: `${instrColor}40`, background: `${instrColor}12` }}>
                          {inst}
                        </span>
                        <span className={`text-[9px] font-black px-1.5 py-px rounded border uppercase ${
                          isWin ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-red-500/15 border-red-500/30 text-red-400"
                        }`}>
                          {isWin ? "✅ WIN" : "❌ LOSS"}
                        </span>
                        <span className="text-[8.5px] text-slate-500">{t.direction?.replace("BUY_", "")} {t.strike}</span>
                      </div>
                      <span className={`font-black text-[11px] ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                        {pnl >= 0 ? "+" : ""}₹{pnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex justify-between text-[8px] text-slate-600">
                      <span>Entry: ₹{t.entry_price?.toFixed(1)} → Exit: ₹{((t as any).exit_price ?? 0).toFixed(1)}</span>
                      <span>{entryAt} → {closedAt}</span>
                    </div>
                    {t.strategyName && (
                      <div className="text-[7.5px] text-violet-400/70 truncate">{t.strategyName}</div>
                    )}
                  </div>
                );
              })}
              {allClosedTrades.length >= historyLimit && (
                <button onClick={() => setHistoryLimit(h => h + 10)}
                  className="text-[9px] text-slate-500 hover:text-slate-300 text-center py-1.5 border border-dashed border-slate-800 rounded cursor-pointer transition-colors">
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
            const pnlColor = pos.livePnl >= 0 ? "text-emerald-400" : "text-rose-500";
            const dirBadge = isCE
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400";

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
                      className="text-[7.5px] font-black px-1 py-px rounded border uppercase"
                      style={{ color: instrColor, borderColor: `${instrColor}40`, background: `${instrColor}12` }}
                    >
                      {inst}
                    </span>

                    {/* PENDING badge */}
                    {isPending && (
                      <span className="text-[7.5px] font-black px-1 py-px rounded border uppercase text-orange-400 border-orange-500/30 bg-orange-500/10 animate-pulse">
                        ⏳ PENDING
                      </span>
                    )}

                    {/* Direction */}
                    <span className={`text-[9px] font-black px-1 py-px rounded border uppercase ${dirBadge}`}>
                      {pos.direction.replace("BUY_", "")}
                    </span>
                    <span className="font-bold text-[10px] text-slate-300">
                      {pos.strike}
                    </span>
                  </div>

                  {/* Action Button */}
                  {isPending ? (
                    <button
                      onClick={() => handleManualClose(pos)}
                      disabled={closingId === pos.id}
                      className={`text-[8.5px] font-black px-1.5 py-0.5 rounded border flex items-center gap-0.5 transition-all cursor-pointer ${
                        closingId === pos.id
                          ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                          : "border-orange-500/30 bg-orange-500/5 text-orange-400 hover:bg-orange-500/20"
                      }`}
                    >
                      {closingId === pos.id
                        ? <><RefreshCw size={7} className="animate-spin" /> …</>
                        : "✕ CANCEL"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleManualClose(pos)}
                      disabled={closingId === pos.id}
                      className={`text-[8.5px] font-black px-1.5 py-0.5 rounded border flex items-center gap-0.5 transition-all cursor-pointer ${
                        closingId === pos.id
                          ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                          : "border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/20"
                      }`}
                    >
                      {closingId === pos.id
                        ? <><RefreshCw size={7} className="animate-spin" /> …</>
                        : "✕ CLOSE"}
                    </button>
                  )}
                </div>

                {/* Strategy row */}
                {pos.strategyName && (
                  <div className="text-[8px] font-black tracking-wide uppercase flex items-center gap-1 select-none mt-[-2px] mb-[1px]">
                    <span className="text-slate-500">STRATEGY:</span>
                    <span className="text-violet-400/90 truncate max-w-[170px]" title={pos.strategyName}>
                      {pos.strategyName}
                    </span>
                  </div>
                )}

                {/* Entry/LTP row */}
                <div
                  className="flex justify-between text-[9.5px] pb-1 border-b"
                  style={{ borderColor: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                >
                  <span>Qty: {pos.qty}×{pos.lot_size}</span>
                  {isPending ? (
                    <span>
                      Entry Target: <span className="text-orange-400 font-bold">₹{pos.entry_price.toFixed(1)}</span>
                      {" | "}LTP: <span className="text-blue-400 font-bold animate-pulse">₹{pos.currentPremium.toFixed(1)}</span>
                    </span>
                  ) : (
                    <span>
                      ₹{pos.entry_price.toFixed(1)} → <span className="text-blue-400 font-bold animate-pulse">₹{pos.currentPremium.toFixed(1)}</span>
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
                    <span className="text-[8px] font-black text-orange-400 whitespace-nowrap">
                      {pos.currentPremium <= pos.entry_price
                        ? `₹${(pos.entry_price - pos.currentPremium).toFixed(1)} to fill`
                        : "Above entry"}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[8.5px] font-bold text-slate-500 uppercase">
                      <span>SL {pos.stop_loss.toFixed(0)}</span>
                      <span>LTP {pos.currentPremium.toFixed(0)}</span>
                      <span>TGT {pos.target.toFixed(0)}</span>
                    </div>
                    <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${premiumRatio}%`, backgroundColor: pos.livePnl >= 0 ? "#10b981" : "#ef4444" }}
                      />
                    </div>
                  </div>
                )}

                {/* P&L or Awaiting */}
                {!isPending && (
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-[8.5px] uppercase font-bold text-slate-500">P&L:</span>
                    <span className={`font-black text-[11px] ${pnlColor}`}>
                      {pos.livePnl >= 0 ? "+" : ""}₹{pos.livePnl.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-center py-5 text-[10px] italic rounded-md border border-dashed text-slate-600 border-slate-800/40">
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
