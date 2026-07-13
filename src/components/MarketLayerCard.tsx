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
    case "BULLISH":      return { label: "BULLISH",    color: "#10b981", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.4)",  glow: "0 0 16px rgba(16,185,129,0.35)" };
    case "MILD_BULLISH": return { label: "MILD BULL",  color: "#34d399", bg: "rgba(52,211,153,0.07)", border: "rgba(52,211,153,0.25)", glow: "" };
    case "NEUTRAL":      return { label: "NEUTRAL",    color: "#94a3b8", bg: "rgba(148,163,184,0.06)",border: "rgba(148,163,184,0.2)", glow: "" };
    case "MILD_BEARISH": return { label: "MILD BEAR",  color: "#f87171", bg: "rgba(248,113,113,0.07)",border: "rgba(248,113,113,0.25)",glow: "" };
    case "BEARISH":      return { label: "BEARISH",    color: "#ef4444", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.4)",  glow: "0 0 16px rgba(239,68,68,0.35)" };
  }
}

function dominanceColor(d: "BULLISH" | "BEARISH" | "NEUTRAL") {
  return d === "BULLISH" ? "#10b981" : d === "BEARISH" ? "#f87171" : "#94a3b8";
}

function contribColor(v: number) {
  return v > 0 ? "#10b981" : v < 0 ? "#f87171" : "#94a3b8";
}

// ── Stock Row ─────────────────────────────────────────────────────────────────

function StockRow({ s, maxAbs }: { s: StockContribution; maxAbs: number; key?: string }) {
  const barPct = maxAbs > 0 ? Math.min(100, (Math.abs(s.wtdContrib) / maxAbs) * 100) : 0;
  const clr = contribColor(s.wtdContrib);
  const shortSym = s.symbol.replace(/^(NSE:|BSE:)/, "").replace(/-EQ$/, "").slice(0, 7);

  return (
    <div className="flex items-center gap-0.5 py-0.5 group">
      {/* Symbol */}
      <span
        className="text-[11.5px] font-semibold font-mono tracking-tight flex-shrink-0 w-[46px] truncate"
        style={{ color: clr }}
        title={s.symbol}
      >
        {shortSym}
      </span>

      {/* Contribution bar */}
      <div className="flex-1 relative h-[4.5px] rounded-full bg-white/5 overflow-hidden">
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-500"
          style={{
            width: `${barPct}%`,
            background: `linear-gradient(90deg, ${clr}99, ${clr})`,
            left: s.wtdContrib >= 0 ? 0 : "auto",
            right: s.wtdContrib < 0 ? 0 : "auto",
            boxShadow: barPct > 40 ? `0 0 6px ${clr}80` : "none"
          }}
        />
      </div>

      {/* LTP */}
      <span className="text-[10.5px] font-mono text-slate-400 flex-shrink-0 w-[28px] text-right">
        {s.ltp !== undefined ? s.ltp.toFixed(0) : "—"}
      </span>

      {/* Wt% */}
      <span className="text-[10px] font-mono text-slate-550 flex-shrink-0 w-[18px] text-right">
        {s.weightage.toFixed(1)}
      </span>

      {/* % Change */}
      <span
        className="text-[11px] font-semibold font-mono flex-shrink-0 w-[28px] text-right"
        style={{ color: clr }}
      >
        {s.pctChange > 0 ? "+" : ""}{s.pctChange.toFixed(1)}
      </span>

      {/* Contribution */}
      <span
        className="text-[11px] font-bold font-mono flex-shrink-0 w-[32px] text-right"
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
      className="flex-1 min-w-0 flex flex-col gap-0.5 rounded-xl p-1 border transition-all duration-300"
      style={{
        background: `linear-gradient(135deg, ${accent}08 0%, rgba(10,14,26,0.95) 100%)`,
        borderColor: `${accent}30`,
      }}
    >
      {/* Layer Header */}
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
          />
          <span
            className="text-[13px] font-black uppercase tracking-wider"
            style={{ color: accent }}
          >
            {label}
          </span>
          <span className="text-[10px] text-slate-500 font-semibold">{sublabel}</span>
        </div>

        {/* Dominance badge */}
        <span
          className="text-[11px] font-bold px-1.5 py-0.5 rounded-md border"
          style={{
            color: domColor,
            borderColor: `${domColor}40`,
            background: `${domColor}10`
          }}
        >
          {layer.dominance}
        </span>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-0.5 mb-0.5">
        {/* Net Weight Contribution */}
        <div
          className="rounded-lg px-1 py-px flex flex-col items-center border"
          style={{ background: `${netColor}08`, borderColor: `${netColor}25` }}
        >
          <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">NET WT</span>
          <span
            className="text-[12.5px] font-bold font-mono leading-tight"
            style={{ color: netColor }}
          >
            {layer.netWeightPts > 0 ? "+" : ""}{layer.netWeightPts.toFixed(3)}
          </span>
        </div>

        {/* Breadth */}
        <div className="rounded-lg px-1 py-px flex flex-col items-center border border-white/5 bg-white/[0.02]">
          <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">BREADTH</span>
          <div className="flex items-center gap-0.5 mt-0.5 leading-none">
            <span className="text-[11px] font-bold text-emerald-400">{layer.posCount}▲</span>
            <span className="text-[9px] text-slate-650">·</span>
            <span className="text-[11px] font-bold text-rose-400">{layer.negCount}▼</span>
          </div>
        </div>

        {/* Velocity 5M */}
        <div className="rounded-lg px-1 py-px flex flex-col items-center border border-white/5 bg-white/[0.02]">
          <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">5M VEL</span>
          <span
            className="text-[12.5px] font-bold font-mono leading-tight"
            style={{ color: contribColor(layer.net5m) }}
          >
            {layer.net5m > 0 ? "+" : ""}{layer.net5m.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Pos / Neg bar */}
      <div className="flex gap-px h-[4.5px] rounded-full overflow-hidden mb-0.5">
        <div
          className="h-full rounded-l-full transition-all duration-500"
          style={{
            width: `${posPct}%`,
            background: "linear-gradient(90deg, #059669, #10b981)",
          }}
        />
        <div
          className="h-full rounded-r-full transition-all duration-500 flex-1"
          style={{ background: "linear-gradient(90deg, #dc2626, #ef4444)" }}
        />
      </div>

      {/* Sentiment Shift Alert */}
      {hasShift && (
        <div className="flex items-center gap-1.5 px-1 py-0.5 rounded border border-amber-550/20 bg-amber-550/5 mb-0.5 animate-pulse">
          <span className="text-[11px] font-bold text-amber-400">⚠ SHIFT DETECTED</span>
          {layer.posToNegCount > 0 && (
            <span className="text-[11px] font-bold font-mono text-rose-400">
              {layer.posToNegCount} POS→NEG
            </span>
          )}
          {layer.negToPosCount > 0 && (
            <span className="text-[11px] font-bold font-mono text-emerald-400">
              {layer.negToPosCount} NEG→POS
            </span>
          )}
        </div>
      )}

      {/* Column Headers */}
      <div className="flex items-center gap-0.5 px-0.5 mb-px">
        <span className="text-[9.5px] text-slate-550 w-[46px] font-bold uppercase">Stock</span>
        <span className="flex-1 text-[9.5px] text-slate-550 text-center font-bold uppercase">Impact</span>
        <span className="text-[9.5px] text-slate-550 w-[28px] text-right font-bold uppercase">Ltp</span>
        <span className="text-[9.5px] text-slate-550 w-[18px] text-right font-bold uppercase">Wt</span>
        <span className="text-[9.5px] text-slate-550 w-[28px] text-right font-bold uppercase">Chg%</span>
        <span className="text-[9.5px] text-slate-550 w-[32px] text-right font-bold uppercase">Ctr</span>
      </div>

      {/* Stock Rows */}
      <div className="flex-1 flex flex-col justify-around gap-0.5 min-h-0">
        {layer.topContributors.length > 0 ? (
          layer.topContributors.map(s => (
            <StockRow key={s.symbol} s={s} maxAbs={maxAbs} />
          ))
        ) : (
          <span className="text-[10px] text-slate-650 text-center py-2 font-bold">Awaiting data…</span>
        )}
      </div>

      {/* Pos / Neg Weight Footer */}
      <div className="flex justify-between mt-0.5 pt-0.5 border-t border-white/5">
        <span className="text-[11px] font-mono font-bold text-emerald-500">
          +{layer.posWeightPts.toFixed(3)} pull
        </span>
        <span className="text-[11px] font-mono font-bold text-rose-500">
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
      <div className="rounded-xl border border-white/5 bg-[#0a0e1a]/90 p-3 flex items-center justify-center min-h-[120px]">
        <span className="text-[11px] text-slate-650 animate-pulse">Awaiting Market Direction Data…</span>
      </div>
    );
  }

  const meta = statusMeta(marketDir.status);
  const { t10Layer, n15Layer, signals } = marketDir;

  // Combined net
  const combinedNet = (t10Layer?.netWeightPts ?? 0) + (n15Layer?.netWeightPts ?? 0);

  return (
    <div
      className="h-full flex flex-col gap-1.5 p-1.5 px-2 select-none transition-all duration-500 rounded-xl border"
      style={{
        background: "linear-gradient(135deg, rgba(10,14,26,0.98) 0%, rgba(6,9,18,0.99) 100%)",
        borderColor: meta.border,
        boxShadow: meta.glow || "none",
      }}
    >
      {/* ── Card Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
          />
          <span className="text-[12px] font-bold uppercase tracking-wider text-slate-350">
            {activePage} Market Layer
          </span>
        </div>

        {/* Status Badge */}
        <div
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded border"
          style={{ background: meta.bg, borderColor: meta.border }}
        >
          <span
            className="text-[13px] font-black tracking-wider"
            style={{ color: meta.color, textShadow: meta.glow ? `0 0 8px ${meta.color}` : "none" }}
          >
            {meta.label}
          </span>
          <span className="text-slate-600 text-[10px]">|</span>
          <span
            className="text-[13px] font-bold font-mono"
            style={{ color: meta.color }}
          >
            {marketDir.score > 0 ? "+" : ""}{marketDir.score.toFixed(3)}
          </span>
          <span className="text-slate-600 text-[10px]">|</span>
          <span className="text-[11.5px] font-bold text-slate-350">
            {marketDir.confidence}%
          </span>
        </div>
      </div>

      {/* ── Direction Gate Row ─────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-0.5">
        {/* CE Gate */}
        <div
          className="rounded px-1.5 py-px flex flex-col items-center border gap-0"
          style={{
            borderColor: marketDir.allowCE ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)",
            background: marketDir.allowCE ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.06)"
          }}
        >
          <span className="text-[9px] text-slate-500 font-bold uppercase">CE</span>
          <span className={`text-[12.5px] font-bold ${marketDir.allowCE ? "text-emerald-400" : "text-rose-450"}`}>
            {marketDir.allowCE ? "ON" : "OFF"}
          </span>
        </div>

        {/* PE Gate */}
        <div
          className="rounded px-1.5 py-px flex flex-col items-center border gap-0"
          style={{
            borderColor: marketDir.allowPE ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.3)",
            background: marketDir.allowPE ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.06)"
          }}
        >
          <span className="text-[9px] text-slate-500 font-bold uppercase">PE</span>
          <span className={`text-[12.5px] font-bold ${marketDir.allowPE ? "text-emerald-400" : "text-rose-450"}`}>
            {marketDir.allowPE ? "ON" : "OFF"}
          </span>
        </div>

        {/* Breadth */}
        <div className="rounded px-1.5 py-px flex flex-col items-center border border-white/5 bg-white/[0.02] gap-0">
          <span className="text-[9px] text-slate-500 font-bold uppercase">BREADTH</span>
          <div className="flex items-center gap-0.5">
            <span className="text-[12.5px] font-bold text-emerald-400">{signals.posBreath.toFixed(0)}%</span>
            <span className="text-slate-650 text-[9px]">/</span>
            <span className="text-[12.5px] font-bold text-rose-400">{signals.negBreath.toFixed(0)}%</span>
          </div>
        </div>

        {/* Combined net */}
        <div
          className="rounded px-1.5 py-px flex flex-col items-center border gap-0"
          style={{
            borderColor: combinedNet >= 0 ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)",
            background: combinedNet >= 0 ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)"
          }}
        >
          <span className="text-[9px] text-slate-500 font-bold uppercase">T25 WT</span>
          <span
            className="text-[12.5px] font-bold font-mono"
            style={{ color: contribColor(combinedNet) }}
          >
            {combinedNet > 0 ? "+" : ""}{combinedNet.toFixed(3)}
          </span>
        </div>
      </div>

      {/* ── T10 + N15 Layer Panels ─────────────────────────────────── */}
      <div className="flex-1 flex gap-0.5 min-h-0">
        {t10Layer ? (
          <LayerPanel
            label="T-10"
            sublabel="Heavy"
            layer={t10Layer}
            accent="#6366f1"
          />
        ) : (
          <div className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-center min-h-[100px]">
            <span className="text-[10px] text-slate-500 font-bold">T10 loading…</span>
          </div>
        )}

        {n15Layer ? (
          <LayerPanel
            label="N-15"
            sublabel="Mid"
            layer={n15Layer}
            accent="#f59e0b"
          />
        ) : (
          <div className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-center min-h-[100px]">
            <span className="text-[10px] text-slate-500 font-bold">N15 loading…</span>
          </div>
        )}
      </div>

      {/* ── Bottom Signal Row ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-0.5 border-t border-white/[0.04] flex-wrap">
        <span className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">Vel:</span>
        {[
          { label: "NET", val: signals.netOverall },
          { label: "5M",  val: signals.net5m },
          { label: "15M", val: signals.net15m },
        ].map(({ label, val }) => (
          <div key={label} className="flex items-center gap-0.5">
            <span className="text-[10px] text-slate-500 font-semibold">{label}:</span>
            <span
              className="text-[12px] font-bold font-mono"
              style={{ color: contribColor(val) }}
            >
              {val > 0 ? "+" : ""}{val.toFixed(1)}
            </span>
          </div>
        ))}
        {/* Shift indicators */}
        {(signals.posToNegCount > 0 || signals.negToPosCount > 0) && (
          <div className="ml-auto flex items-center gap-1">
            {signals.posToNegCount > 0 && (
              <span className="text-[12px] font-bold text-rose-400 animate-pulse">
                ⚠ {signals.posToNegCount}↓
              </span>
            )}
            {signals.negToPosCount > 0 && (
              <span className="text-[12px] font-bold text-emerald-400 animate-pulse">
                ✅ {signals.negToPosCount}↑
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
