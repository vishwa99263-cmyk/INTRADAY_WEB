/**
 * MarketLayerCard.tsx
 * Premium Market Sentiment Layer Analysis
 * Shows T10 (Top 10) and N15 (Next 15) stock groups' weighted index contribution
 * based on: (weightage% / 100) × price change% = index point impact
 */

import React, { useMemo } from "react";

interface StockContribution {
  symbol: string;
  weightage: number;
  pctChange: number;
  score: number;
  wtdContrib: number;
  direction: "UP" | "DOWN" | "FLAT";
  ltp?: number;
}

interface LayerData {
  netScore: number;
  net5m: number;
  net15m: number;
  posCount: number;
  negCount: number;
  dominance: "BULLISH" | "BEARISH" | "NEUTRAL";
  posToNegCount: number;
  negToPosCount: number;
  posWeightPts: number;
  negWeightPts: number;
  netWeightPts: number;
  topContributors: StockContribution[];
}

interface MarketDir {
  status: "BULLISH" | "MILD_BULLISH" | "NEUTRAL" | "MILD_BEARISH" | "BEARISH";
  score: number;
  confidence: number;
  allowCE: boolean;
  allowPE: boolean;
  netShiftScore: number;
  t10Layer?: LayerData;
  n15Layer?: LayerData;
  signals: {
    netOverall: number;
    net5m: number;
    net15m: number;
    posBreath: number;
    negBreath: number;
    posToNegCount: number;
    negToPosCount: number;
  };
}

interface MarketLayerCardProps {
  marketDir: MarketDir | null;
  activePage: string;
  darkMode: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusMeta(status: MarketDir["status"]) {
  switch (status) {
    case "BULLISH":      return { label: "BULLISH",    color: "#10b981", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.35)", glow: "0 0 20px rgba(16,185,129,0.25)" };
    case "MILD_BULLISH": return { label: "MILD BULL",  color: "#34d399", bg: "rgba(52,211,153,0.05)", border: "rgba(52,211,153,0.2)",  glow: "0 0 15px rgba(52,211,153,0.15)" };
    case "NEUTRAL":      return { label: "NEUTRAL",    color: "#94a3b8", bg: "rgba(148,163,184,0.04)", border: "rgba(148,163,184,0.15)", glow: "" };
    case "MILD_BEARISH": return { label: "MILD BEAR",  color: "#f87171", bg: "rgba(248,113,113,0.05)", border: "rgba(248,113,113,0.2)",  glow: "0 0 15px rgba(248,113,113,0.15)" };
    case "BEARISH":      return { label: "BEARISH",    color: "#ef4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.35)",  glow: "0 0 20px rgba(239,68,68,0.25)" };
  }
}

function dominanceColor(d: "BULLISH" | "BEARISH" | "NEUTRAL") {
  return d === "BULLISH" ? "#10b981" : d === "BEARISH" ? "#f43f5e" : "#94a3b8";
}

function contribColor(v: number) {
  return v > 0 ? "#10b981" : v < 0 ? "#f43f5e" : "#94a3b8";
}

// ── Stock Row ─────────────────────────────────────────────────────────────────

function StockRow({ s, maxAbs }: { s: StockContribution; maxAbs: number; key?: string }) {
  const barPct = maxAbs > 0 ? Math.min(100, (Math.abs(s.wtdContrib) / maxAbs) * 100) : 0;
  const clr = contribColor(s.wtdContrib);
  const shortSym = s.symbol.replace(/^(NSE:|BSE:)/, "").replace(/-EQ$/, "").slice(0, 7);

  return (
    <div className="flex items-center gap-1 py-[1.5px] group border-b border-white/[0.01] hover:bg-white/[0.02] px-1 rounded transition-colors duration-150">
      {/* Symbol */}
      <span
        className="text-[10.5px] font-black font-mono tracking-wider flex-shrink-0 w-[48px] truncate"
        style={{ color: clr, textShadow: `0 0 4px ${clr}40` }}
        title={s.symbol}
      >
        {shortSym}
      </span>

      {/* Contribution bar */}
      <div className="flex-1 relative h-[5px] rounded-full bg-slate-900/60 overflow-hidden border border-white/5">
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-500"
          style={{
            width: `${barPct}%`,
            background: `linear-gradient(90deg, ${clr}80, ${clr})`,
            left: s.wtdContrib >= 0 ? 0 : "auto",
            right: s.wtdContrib < 0 ? 0 : "auto",
            boxShadow: barPct > 30 ? `0 0 8px ${clr}60` : "none"
          }}
        />
      </div>

      {/* LTP */}
      <span className="text-[10px] font-mono text-slate-400 flex-shrink-0 w-[30px] text-right font-semibold">
        {s.ltp !== undefined ? s.ltp.toFixed(0) : "—"}
      </span>

      {/* Wt% */}
      <span className="text-[9.5px] font-mono text-slate-500 flex-shrink-0 w-[18px] text-right font-medium">
        {s.weightage.toFixed(1)}
      </span>

      {/* % Change */}
      <span
        className="text-[10px] font-black font-mono flex-shrink-0 w-[28px] text-right"
        style={{ color: clr }}
      >
        {s.pctChange > 0 ? "+" : ""}{s.pctChange.toFixed(1)}
      </span>

      {/* Contribution */}
      <span
        className="text-[10.5px] font-extrabold font-mono flex-shrink-0 w-[34px] text-right drop-shadow-sm"
        style={{ color: clr }}
      >
        {s.wtdContrib > 0 ? "+" : ""}{s.wtdContrib.toFixed(2)}
      </span>
    </div>
  );
}

// ── Layer Panel ───────────────────────────────────────────────────────────────

function LayerPanel({
  label, sublabel, layer, accent
}: {
  label: string;
  sublabel: string;
  layer: LayerData;
  accent: string;
}) {
  const maxAbs = useMemo(() =>
    Math.max(...(layer.topContributors.map(c => Math.abs(c.wtdContrib))), 0.001),
    [layer.topContributors]
  );

  const domColor = dominanceColor(layer.dominance);
  const netColor = contribColor(layer.netWeightPts);
  const totalStocks = layer.posCount + layer.negCount;
  const posPct = totalStocks > 0 ? (layer.posCount / totalStocks) * 100 : 50;

  const hasShift = layer.posToNegCount > 0 || layer.negToPosCount > 0;

  return (
    <div
      className="flex-1 min-w-0 flex flex-col gap-0.5 rounded-lg p-1.5 border transition-all duration-300 backdrop-blur-md"
      style={{
        background: `linear-gradient(135deg, ${accent}06 0%, rgba(13,18,34,0.7) 100%)`,
        borderColor: `${accent}25`,
        boxShadow: `inset 0 1px 1px rgba(255,255,255,0.03)`
      }}
    >
      {/* Layer Header */}
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
            style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
          />
          <span
            className="text-[12.5px] font-black uppercase tracking-wider bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent"
          >
            {label}
          </span>
          <span className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wide">{sublabel}</span>
        </div>

        {/* Dominance badge */}
        <span
          className="text-[9px] font-black px-2 py-0.5 rounded border tracking-wider font-mono shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
          style={{
            color: domColor,
            borderColor: `${domColor}35`,
            background: `${domColor}08`
          }}
        >
          {layer.dominance}
        </span>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-1 mb-0.5">
        {/* Net Weight Contribution */}
        <div
          className="rounded-lg p-0.5 px-1 flex flex-col items-center border transition-all duration-300 hover:border-slate-800"
          style={{ background: `${netColor}05`, borderColor: `${netColor}20` }}
        >
          <span className="text-[8px] text-slate-500 uppercase tracking-widest font-black">NET WT</span>
          <span
            className="text-[12px] font-black font-mono leading-tight mt-0.5"
            style={{ color: netColor, textShadow: `0 0 6px ${netColor}30` }}
          >
            {layer.netWeightPts > 0 ? "+" : ""}{layer.netWeightPts.toFixed(3)}
          </span>
        </div>

        {/* Breadth */}
        <div className="rounded-lg p-0.5 px-1 flex flex-col items-center border border-slate-900 bg-slate-950/40 transition-all duration-300 hover:border-slate-800">
          <span className="text-[8px] text-slate-500 uppercase tracking-widest font-black">BREADTH</span>
          <div className="flex items-center gap-1 mt-0.5 leading-none">
            <span className="text-[11px] font-extrabold text-emerald-400">{layer.posCount}▲</span>
            <span className="text-[8px] text-slate-650">·</span>
            <span className="text-[11px] font-extrabold text-rose-450">{layer.negCount}▼</span>
          </div>
        </div>

        {/* Velocity 5M */}
        <div className="rounded-lg p-0.5 px-1 flex flex-col items-center border border-slate-900 bg-slate-950/40 transition-all duration-300 hover:border-slate-800">
          <span className="text-[8px] text-slate-500 uppercase tracking-widest font-black">5M VEL</span>
          <span
            className="text-[12px] font-black font-mono leading-tight mt-0.5"
            style={{ color: contribColor(layer.net5m), textShadow: `0 0 6px ${contribColor(layer.net5m)}30` }}
          >
            {layer.net5m > 0 ? "+" : ""}{layer.net5m.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Pos / Neg bar */}
      <div className="flex gap-[1px] h-[3px] rounded-full overflow-hidden mb-0.5 border border-white/5 bg-slate-950/60">
        <div
          className="h-full rounded-l-full transition-all duration-500"
          style={{
            width: `${posPct}%`,
            background: "linear-gradient(90deg, #047857, #10b981)",
          }}
        />
        <div
          className="h-full rounded-r-full transition-all duration-500 flex-1"
          style={{ background: "linear-gradient(90deg, #be123c, #f43f5e)" }}
        />
      </div>

      {/* Sentiment Shift Alert */}
      {hasShift && (
        <div className="flex items-center justify-between px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/5 mb-0.5 animate-pulse">
          <span className="text-[9px] font-black text-amber-400 tracking-wider">⚠ SHIFT DETECTED</span>
          <div className="flex items-center gap-1.5">
            {layer.posToNegCount > 0 && (
              <span className="text-[9px] font-black font-mono text-rose-400">
                {layer.posToNegCount} P→N
              </span>
            )}
            {layer.negToPosCount > 0 && (
              <span className="text-[9px] font-black font-mono text-emerald-400">
                {layer.negToPosCount} N→P
              </span>
            )}
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="flex items-center gap-1 px-1 mb-0.5 border-b border-white/5 pb-0.5">
        <span className="text-[8px] text-slate-500 w-[48px] font-black uppercase tracking-wider">Stock</span>
        <span className="flex-1 text-[8px] text-slate-500 text-center font-black uppercase tracking-wider">Impact</span>
        <span className="text-[8px] text-slate-500 w-[30px] text-right font-black uppercase tracking-wider">Ltp</span>
        <span className="text-[8px] text-slate-500 w-[18px] text-right font-black uppercase tracking-wider">Wt</span>
        <span className="text-[8px] text-slate-500 w-[28px] text-right font-black uppercase tracking-wider">Chg%</span>
        <span className="text-[8px] text-slate-500 w-[34px] text-right font-black uppercase tracking-wider">Ctr</span>
      </div>

      {/* Stock Rows */}
      <div className="flex-1 flex flex-col justify-around gap-0.5 min-h-0">
        {layer.topContributors.length > 0 ? (
          layer.topContributors.slice(0, 5).map(s => (
            <StockRow key={s.symbol} s={s} maxAbs={maxAbs} />
          ))
        ) : (
          <span className="text-[10px] text-slate-600 text-center py-4 font-bold animate-pulse font-mono uppercase tracking-wider">Awaiting data…</span>
        )}
      </div>

      {/* Pos / Neg Weight Footer */}
      <div className="flex justify-between mt-0.5 pt-1 border-t border-white/5">
        <span className="text-[10px] font-mono font-black text-emerald-400/90 tracking-wide">
          +{layer.posWeightPts.toFixed(3)} pull
        </span>
        <span className="text-[10px] font-mono font-black text-rose-450/90 tracking-wide">
          {layer.negWeightPts.toFixed(3)} drag
        </span>
      </div>
    </div>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export default function MarketLayerCard({ marketDir, activePage, darkMode }: MarketLayerCardProps) {
  if (!marketDir) {
    return (
      <div className="rounded-xl border border-white/5 bg-[#0a0e1a]/80 backdrop-blur-md p-4 flex items-center justify-center min-h-[140px]">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-slate-650 border-t-slate-350 rounded-full animate-spin" />
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono animate-pulse">Awaiting market layer stream...</span>
        </div>
      </div>
    );
  }

  const meta = statusMeta(marketDir.status);
  const { t10Layer, n15Layer, signals } = marketDir;

  // Combined net
  const combinedNet = (t10Layer?.netWeightPts ?? 0) + (n15Layer?.netWeightPts ?? 0);

  return (
    <div
      className={`h-full flex flex-col gap-1.5 p-1.5 px-2 select-none transition-all duration-500 rounded-lg border relative overflow-hidden ${
        darkMode 
          ? "bg-slate-950/80 backdrop-blur-xl border-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.5)]" 
          : "bg-white border-slate-200 shadow-sm"
      }`}
      style={{
        boxShadow: darkMode && meta.glow ? `${meta.glow}, inset 0 1px 1px rgba(255,255,255,0.03)` : undefined,
        borderColor: darkMode ? meta.border : undefined
      }}
    >
      {/* Sci-Fi glowing background grids */}
      <div className="absolute top-0 left-0 w-32 h-32 rounded-full blur-[80px] opacity-[0.15] pointer-events-none" style={{ backgroundColor: meta.color }} />
      <div className="absolute inset-0 bg-[radial-gradient(#ffffff03_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

      {/* ── Card Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-1 relative z-10">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: meta.color, boxShadow: `0 0 10px ${meta.color}` }}
          />
          <span className="text-[12px] font-black uppercase tracking-[0.15em] bg-gradient-to-r from-slate-200 via-slate-400 to-slate-200 bg-clip-text text-transparent">
            {activePage} MARKET LAYER
          </span>
        </div>

        {/* Status Badge */}
        <div
          className="flex items-center gap-2 px-2.5 py-0.5 rounded-lg border shadow-md font-mono transition-all duration-300"
          style={{ 
            background: meta.bg, 
            borderColor: meta.border,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05)`
          }}
        >
          <span
            className="text-[11.5px] font-black tracking-widest uppercase"
            style={{ color: meta.color, textShadow: `0 0 6px ${meta.color}30` }}
          >
            {meta.label}
          </span>
          <span className="text-slate-700 text-[10px]">|</span>
          <span
            className="text-[12px] font-extrabold"
            style={{ color: meta.color }}
          >
            {marketDir.score > 0 ? "+" : ""}{marketDir.score.toFixed(3)}
          </span>
          <span className="text-slate-700 text-[10px]">|</span>
          <span className="text-[11px] font-black text-slate-300 drop-shadow-sm">
            {marketDir.confidence}%
          </span>
        </div>
      </div>

      {/* ── Direction Gate Row ─────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-1 relative z-10">
        {/* CE Gate */}
        <div
          className="rounded-lg p-0.5 px-1 flex flex-col items-center border transition-all duration-300 hover:border-slate-800"
          style={{
            borderColor: marketDir.allowCE ? "rgba(16,185,129,0.3)" : "rgba(244,63,94,0.15)",
            background: marketDir.allowCE ? "rgba(16,185,129,0.04)" : "rgba(244,63,94,0.02)"
          }}
        >
          <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">CE</span>
          <span className={`text-[12px] font-black mt-0.5 ${marketDir.allowCE ? "text-emerald-400 drop-shadow-[0_0_4px_rgba(16,185,129,0.2)]" : "text-rose-500/70"}`}>
            {marketDir.allowCE ? "ON" : "OFF"}
          </span>
        </div>

        {/* PE Gate */}
        <div
          className="rounded-lg p-0.5 px-1 flex flex-col items-center border transition-all duration-300 hover:border-slate-800"
          style={{
            borderColor: marketDir.allowPE ? "rgba(16,185,129,0.3)" : "rgba(244,63,94,0.15)",
            background: marketDir.allowPE ? "rgba(16,185,129,0.04)" : "rgba(244,63,94,0.02)"
          }}
        >
          <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">PE</span>
          <span className={`text-[12px] font-black mt-0.5 ${marketDir.allowPE ? "text-emerald-400 drop-shadow-[0_0_4px_rgba(16,185,129,0.2)]" : "text-rose-500/70"}`}>
            {marketDir.allowPE ? "ON" : "OFF"}
          </span>
        </div>

        {/* Breadth */}
        <div className="rounded-lg p-0.5 px-1 flex flex-col items-center border border-slate-900 bg-slate-950/40 transition-all duration-300 hover:border-slate-800">
          <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">BREADTH</span>
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-[12px] font-extrabold text-emerald-400">{signals.posBreath.toFixed(0)}%</span>
            <span className="text-slate-700 text-[10px] font-bold">/</span>
            <span className="text-[12px] font-extrabold text-rose-450">{signals.negBreath.toFixed(0)}%</span>
          </div>
        </div>

        {/* Combined net (T25 WT) */}
        <div
          className="rounded-lg p-0.5 px-1 flex flex-col items-center border transition-all duration-300 hover:border-slate-800"
          style={{
            borderColor: combinedNet >= 0 ? "rgba(16,185,129,0.25)" : "rgba(244,63,94,0.25)",
            background: combinedNet >= 0 ? "rgba(16,185,129,0.03)" : "rgba(244,63,94,0.03)"
          }}
        >
          <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">T25 WT</span>
          <span
            className="text-[12px] font-black font-mono mt-0.5"
            style={{ color: contribColor(combinedNet), textShadow: `0 0 6px ${contribColor(combinedNet)}30` }}
          >
            {combinedNet > 0 ? "+" : ""}{combinedNet.toFixed(3)}
          </span>
        </div>
      </div>

      {/* ── T10 + N15 Layer Panels ─────────────────────────────────── */}
      <div className="flex-1 flex gap-1 min-h-0 relative z-10">
        {t10Layer ? (
          <LayerPanel
            label="T-10"
            sublabel="Heavyweight"
            layer={t10Layer}
            accent="#6366f1"
          />
        ) : (
          <div className="flex-1 rounded-xl border border-slate-900 bg-slate-950/40 flex items-center justify-center min-h-[120px]">
            <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider font-mono animate-pulse">T10 Loading...</span>
          </div>
        )}

        {n15Layer ? (
          <LayerPanel
            label="N-15"
            sublabel="Midcap Weight"
            layer={n15Layer}
            accent="#f59e0b"
          />
        ) : (
          <div className="flex-1 rounded-xl border border-slate-900 bg-slate-950/40 flex items-center justify-center min-h-[120px]">
            <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider font-mono animate-pulse">N15 Loading...</span>
          </div>
        )}
      </div>

      {/* ── Bottom Signal Row ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-0.5 border-t border-slate-900 flex-wrap relative z-10 font-mono">
        <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">Velocity</span>
        {[
          { label: "NET", val: signals.netOverall },
          { label: "5M",  val: signals.net5m },
          { label: "15M", val: signals.net15m },
        ].map(({ label, val }) => (
          <div key={label} className="flex items-center gap-1">
            <span className="text-[9px] text-slate-500 font-bold">{label}:</span>
            <span
              className="text-[11.5px] font-black"
              style={{ color: contribColor(val) }}
            >
              {val > 0 ? "+" : ""}{val.toFixed(1)}
            </span>
          </div>
        ))}
        {/* Shift indicators */}
        {(signals.posToNegCount > 0 || signals.negToPosCount > 0) && (
          <div className="ml-auto flex items-center gap-1.5">
            {signals.posToNegCount > 0 && (
              <span className="text-[11px] font-black text-rose-450 animate-pulse bg-rose-950/30 px-1.5 py-0.5 rounded border border-rose-900/30">
                ⚠ {signals.posToNegCount}↓
              </span>
            )}
            {signals.negToPosCount > 0 && (
              <span className="text-[11px] font-black text-emerald-400 animate-pulse bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-900/30">
                ✅ {signals.negToPosCount}↑
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
