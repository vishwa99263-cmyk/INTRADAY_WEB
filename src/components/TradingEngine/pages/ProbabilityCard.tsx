/**
 * ProbabilityCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 8: Probability Engine v1.0 — Premium Institutional UI Card
 *
 * Shows CE vs PE probability bars, confidence meter, dominant side badge,
 * 7-factor breakdown for both CE and PE sides, and setup quality indicator.
 */
import React, { useMemo, useEffect, useState } from "react";
import {
  computeProbability,
  DOMINANT_SIDE_META,
  SETUP_QUALITY_META,
  type ProbabilityEngineInput,
  type ProbabilityEngineResult,
} from "../../../engine/probabilityEngine";
import type { MarketRegimeResult }     from "../../../engine/marketRegimeEngine";
import type { MarketBreadthResult }     from "../../../engine/marketBreadthEngine";
import type { HeavyweightResult }       from "../../../engine/heavyweightEngine";
import type { Range15MResult }          from "../../../engine/range15mEngine";
import type { OptionChainEngineOutput } from "../../../engine/optionChainEngine";
import type { MomentumEngineOutput }    from "../../../engine/momentumEngine";
import type { SmartMoneySignal }        from "../../../engine/smartMoneyEngine";

// ── Props ─────────────────────────────────────────────────────────────────────
export interface ProbabilityCardProps {
  activePage: string;
  pcr: number;
  regimeResult:        MarketRegimeResult;
  breadthResult:       MarketBreadthResult;
  heavyweightResult?:  HeavyweightResult;
  range15mResult?:     Range15MResult;
  optionChainResult?:  OptionChainEngineOutput;
  momentumResult?:     MomentumEngineOutput;
  smartMoneyResult?:   SmartMoneySignal;
}

// ── Animated Probability Bar ──────────────────────────────────────────────────
function ProbBar({
  label, value, color, bg, icon,
}: {
  label: string; value: number; color: string; bg: string; icon: string;
}) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-black uppercase tracking-wider" style={{ color }}>
            {label}
          </span>
        </div>
        <span className="text-base font-black font-mono" style={{ color }}>
          {value}%
        </span>
      </div>
      <div className="w-full h-[7px] rounded-full bg-slate-800/60 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${width}%`,
            background: bg,
            boxShadow: `0 0 8px ${bg}60`,
          }}
        />
      </div>
    </div>
  );
}

// ── Factor Row ────────────────────────────────────────────────────────────────
function FactorRow({ label, ceVal, peVal, maxVal }: {
  label: string; ceVal: number; peVal: number; maxVal: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[65px] h-[4px] rounded-full bg-slate-800/40 overflow-hidden flex justify-end">
        <div
          className="h-full rounded-full bg-emerald-500/70 transition-all duration-700"
          style={{ width: `${(ceVal / maxVal) * 100}%` }}
        />
      </div>
      <span className="text-sm text-slate-500 text-center w-[80px] leading-tight">{label}</span>
      <div className="w-[65px] h-[4px] rounded-full bg-slate-800/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-red-500/70 transition-all duration-700"
          style={{ width: `${(peVal / maxVal) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ── Confidence Arc ────────────────────────────────────────────────────────────
function ConfidenceArc({ value, dominantSide }: { value: number; dominantSide: "CE" | "PE" | "WAIT" }) {
  const [dashOffset, setDashOffset] = useState(251.2);
  const radius = 36;
  const circ   = 2 * Math.PI * radius;
  const color  =
    dominantSide === "CE"   ? "#10b981" :
    dominantSide === "PE"   ? "#ef4444" : "#f59e0b";

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setDashOffset(circ - (value / 100) * circ)
    );
    return () => cancelAnimationFrame(id);
  }, [value, circ]);

  return (
    <svg width="88" height="88" viewBox="0 0 88 88"
      style={{ filter: `drop-shadow(0 0 10px ${color}50)` }}>
      <circle cx="44" cy="44" r={radius} fill="none"
        stroke="rgba(255,255,255,0.04)" strokeWidth="8" />
      <circle cx="44" cy="44" r={radius} fill="none"
        stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 44 44)"
        style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x="44" y="40" textAnchor="middle" fill="white"
        fontSize="18" fontWeight="900" fontFamily="'Inter',sans-serif">
        {value}
      </text>
      <text x="44" y="52" textAnchor="middle" fill="rgba(148,163,184,0.5)"
        fontSize="7" fontWeight="700" fontFamily="'Inter',sans-serif" letterSpacing="0.1em">
        CONFIDENCE
      </text>
    </svg>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────
const ProbabilityCard: React.FC<ProbabilityCardProps> = (props) => {
  const {
    activePage, pcr,
    regimeResult, breadthResult, heavyweightResult,
    range15mResult, optionChainResult, momentumResult, smartMoneyResult,
  } = props;

  const result: ProbabilityEngineResult = useMemo(() =>
    computeProbability({
      regimeResult, breadthResult, heavyweightResult,
      range15mResult, optionChainResult, momentumResult, smartMoneyResult, pcr,
    }),
    [regimeResult, breadthResult, heavyweightResult, range15mResult,
     optionChainResult, momentumResult, smartMoneyResult, pcr]
  );

  const sideMeta    = DOMINANT_SIDE_META[result.dominantSide];
  const qualityMeta = SETUP_QUALITY_META[result.setupQuality];
  const f           = result.factors;

  const accentColor =
    result.dominantSide === "CE"   ? "#10b981" :
    result.dominantSide === "PE"   ? "#ef4444" : "#f59e0b";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(135deg, #04070e 0%, #060b17 55%, #040810 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 28px ${sideMeta.glow}`,
      }}
    >
      {/* Top accent */}
      <div className="absolute top-0 left-0 w-full h-[1.5px]" style={{
        background: `linear-gradient(90deg, transparent 5%, ${accentColor}80 50%, transparent 95%)`,
      }} />

      {/* Trap override pulse */}
      {result.trapOverride && (
        <div className="absolute inset-0 pointer-events-none rounded-xl animate-pulse"
          style={{ boxShadow: "inset 0 0 40px rgba(239,68,68,0.10)" }} />
      )}

      <div className="relative z-10 px-3 py-2">

        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: accentColor }} />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-500">
              🎯 PROBABILITY ENGINE · L8
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {result.trapOverride && (
              <span className="text-sm font-black px-1.5 py-0.5 rounded border bg-red-900/40 text-red-300 border-red-700/40 animate-pulse">
                ⚠ TRAP OVERRIDE
              </span>
            )}
            <span className={`text-sm font-black uppercase px-1.5 py-0.5 rounded ${qualityMeta.bg} ${qualityMeta.color}`}>
              {qualityMeta.label}
            </span>
            <span className={`text-sm font-black uppercase px-2 py-0.5 rounded border ${sideMeta.bg} ${sideMeta.color} ${sideMeta.border}`}>
              {sideMeta.emoji} {sideMeta.label}
            </span>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        <div className="flex items-stretch gap-3 flex-wrap xl:flex-nowrap">

          {/* Col 1: Confidence Arc */}
          <div className="flex flex-col items-center justify-center min-w-[90px] gap-1">
            <ConfidenceArc value={result.confidenceLevel} dominantSide={result.dominantSide} />
            <div className="flex gap-1">
              <span className="text-sm font-mono text-emerald-400 font-black">CE:{result.ceProbability}%</span>
              <span className="text-sm text-slate-600">|</span>
              <span className="text-sm font-mono text-red-400 font-black">PE:{result.peProbability}%</span>
            </div>
          </div>

          {/* Col 2: Probability Bars */}
          <div className="flex flex-col justify-center gap-2.5 flex-1 min-w-[140px]">
            <ProbBar
              label="CE Probability"
              value={result.ceProbability}
              color="#10b981"
              bg="linear-gradient(90deg,#059669,#10b981)"
              icon="🟢"
            />
            <ProbBar
              label="PE Probability"
              value={result.peProbability}
              color="#ef4444"
              bg="linear-gradient(90deg,#dc2626,#ef4444)"
              icon="🔴"
            />
            {/* Separator */}
            <div className="pt-1 border-t border-slate-800/30">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Regime</span>
                <span className="text-sm font-black text-indigo-400">{regimeResult.regime}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-sm text-slate-600">PCR</span>
                <span className={`text-sm font-black font-mono ${pcr > 1.05 ? "text-emerald-400" : pcr < 0.95 ? "text-red-400" : "text-amber-400"}`}>
                  {pcr.toFixed(2)} {pcr > 1.05 ? "↑ Bullish" : pcr < 0.95 ? "↓ Bearish" : "→ Neutral"}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-sm text-slate-600">Breadth</span>
                <span className={`text-sm font-black font-mono ${breadthResult.breadthScore > 55 ? "text-emerald-400" : breadthResult.breadthScore < 45 ? "text-red-400" : "text-amber-400"}`}>
                  {breadthResult.breadthScore} {breadthResult.breadthBias}
                </span>
              </div>
            </div>
          </div>

          {/* Col 3: Factor Comparison Grid */}
          <div className="flex flex-col justify-center gap-1 min-w-[230px]">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-sm font-black text-emerald-500 uppercase w-[65px] text-right">CE</span>
              <span className="text-sm text-slate-600 w-[80px] text-center uppercase tracking-wider">Factor</span>
              <span className="text-sm font-black text-red-500 uppercase w-[65px]">PE</span>
            </div>
            <FactorRow label="Regime"     ceVal={f.ceRegime}      peVal={f.peRegime}      maxVal={15} />
            <FactorRow label="Breadth"    ceVal={f.ceBreadth}     peVal={f.peBreadth}     maxVal={15} />
            <FactorRow label="Heavywt"    ceVal={f.ceHeavyweight} peVal={f.peHeavyweight} maxVal={15} />
            <FactorRow label="Momentum"   ceVal={f.ceMomentum}    peVal={f.peMomentum}    maxVal={15} />
            <FactorRow label="Smart $"    ceVal={f.ceSmartMoney}  peVal={f.peSmartMoney}  maxVal={20} />
            <FactorRow label="PCR"        ceVal={f.cePCR}         peVal={f.pePCR}         maxVal={10} />
            <FactorRow label="15M Range"  ceVal={f.ceRange}       peVal={f.peRange}       maxVal={10} />

            <div className="mt-1 pt-1 border-t border-slate-800/30 flex items-center justify-between">
              <span className="text-sm font-black text-emerald-400 font-mono">
                TOTAL CE: {result.ceProbability}
              </span>
              <span className="text-sm text-slate-600">vs</span>
              <span className="text-sm font-black text-red-400 font-mono">
                PE: {result.peProbability}
              </span>
            </div>
          </div>
        </div>

        {/* ── REASONING STRIP ──────────────────────────────────────────── */}
        {result.reasoning.length > 0 && (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg border border-slate-800/30 bg-slate-900/20">
            <div className="text-sm text-slate-400 leading-relaxed space-y-0.5">
              {result.reasoning.map((r, i) => (
                <div key={i}>{r}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProbabilityCard;
export type { ProbabilityEngineResult };
export { computeProbability };

