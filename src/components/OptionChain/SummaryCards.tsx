import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Activity, BarChart3, Layers, ArrowUpRight, ArrowDownRight, Zap, Shield, Target } from "lucide-react";
import { OptionStrike, OptionStrikeData } from "../../types.js";

interface SummaryCardsProps {
  spotPrice: number;
  spotChange: number;
  spotChangePct: number;
  highPrice: number;
  lowPrice: number;
  totalCallOi: number;
  totalPutOi: number;
  pcr: number;
  indiaVix: number;
  selectedExpiryLabel: string;
  atmStrike: number;
  maxPain: number;
  resistance: number;
  support: number;
  lastRefresh: string;
  strikes: (OptionStrike | OptionStrikeData)[];
}

export default function SummaryCards({
  spotPrice,
  spotChange,
  spotChangePct,
  highPrice,
  lowPrice,
  totalCallOi,
  totalPutOi,
  pcr,
  indiaVix,
  atmStrike,
  maxPain,
  resistance,
  support,
  strikes
}: SummaryCardsProps) {

  const getPcrSentiment = (val: number) => {
    if (val >= 1.4) return { label: "Extremely Bullish", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: "🟢" };
    if (val >= 1.1) return { label: "Bullish", color: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/30", icon: "🟢" };
    if (val >= 0.9) return { label: "Neutral", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/30", icon: "⚪" };
    if (val >= 0.7) return { label: "Bearish", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30", icon: "🔴" };
    return { label: "Extremely Bearish", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", icon: "🔴" };
  };

  const pcrSentiment = getPcrSentiment(pcr);

  const formatLakh = (n: number) => {
    if (!n) return "0.00L";
    return (n / 100000).toFixed(2) + "L";
  };

  const refSpot = spotPrice || atmStrike;

  // Total OI for CE vs PE bar calculation
  const totalOi = totalCallOi + totalPutOi;
  const callOiPct = totalOi > 0 ? (totalCallOi / totalOi) * 100 : 50;
  const putOiPct = totalOi > 0 ? (totalPutOi / totalOi) * 100 : 50;

  // Spot price range position
  const spotRange = highPrice > lowPrice ? highPrice - lowPrice : 1;
  const spotPosInRange = highPrice > lowPrice ? ((spotPrice - lowPrice) / spotRange) * 100 : 50;

  const cardVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: (i: number) => ({ 
      opacity: 1, 
      y: 0, 
      transition: { duration: 0.3, delay: i * 0.05 } 
    })
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      
      {/* ── Card 1: Spot Price ──────────────────────────────────────── */}
      <motion.div 
        custom={0}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="p-4 rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900 to-slate-950"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.15em]">Spot Price</span>
          <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
            spotChange >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
          }`}>
            {spotChange >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {spotChange >= 0 ? `+${spotChangePct}%` : `${spotChangePct}%`}
          </span>
        </div>
        
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-black font-mono text-white tracking-tight">
            {spotPrice > 0 ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "0.00"}
          </span>
          <span className={`text-sm font-bold font-mono ${spotChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {spotChange >= 0 ? `+${spotChange.toFixed(2)}` : spotChange.toFixed(2)}
          </span>
        </div>

        {/* Day Range Bar */}
        <div className="relative">
          <div className="flex justify-between text-[8px] font-bold text-slate-500 mb-1">
            <span>LOW {lowPrice > 0 ? lowPrice.toLocaleString("en-IN", {minimumFractionDigits: 2}) : "—"}</span>
            <span>HIGH {highPrice > 0 ? highPrice.toLocaleString("en-IN", {minimumFractionDigits: 2}) : "—"}</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
            <div className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 rounded-full" style={{ width: "100%" }} />
            {spotPrice > 0 && (
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_6px_rgba(255,255,255,0.6)] border-2 border-slate-900"
                style={{ left: `${Math.min(Math.max(spotPosInRange, 2), 98)}%`, transform: "translate(-50%, -50%)" }}
              />
            )}
          </div>
        </div>
      </motion.div>

      {/* ── Card 2: PCR & Sentiment ──────────────────────────────── */}
      <motion.div 
        custom={1}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="p-4 rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900 to-slate-950"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.15em]">Put-Call Ratio</span>
          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${pcrSentiment.bg} ${pcrSentiment.color} ${pcrSentiment.border} border`}>
            {pcrSentiment.icon} {pcrSentiment.label}
          </span>
        </div>

        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-3xl font-black font-mono text-teal-400 tracking-tight">
            {pcr > 0 ? pcr.toFixed(2) : "0.00"}
          </span>
        </div>

        {/* OI Split Bar */}
        <div>
          <div className="flex justify-between text-[8px] font-bold mb-1">
            <span className="text-rose-400">CE {formatLakh(totalCallOi)}</span>
            <span className="text-emerald-400">{formatLakh(totalPutOi)} PE</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden flex">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${callOiPct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-rose-600 to-rose-400 rounded-l-full"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${putOiPct}%` }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-r-full"
            />
          </div>
          <div className="flex justify-between text-[8px] font-mono text-slate-500 mt-0.5">
            <span>{callOiPct.toFixed(1)}%</span>
            <span>{putOiPct.toFixed(1)}%</span>
          </div>
        </div>
      </motion.div>

      {/* ── Card 3: Key Levels ──────────────────────────────────── */}
      <motion.div 
        custom={2}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="p-4 rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900 to-slate-950"
      >
        <div className="flex items-center gap-1.5 mb-3">
          <Target size={12} className="text-amber-400" />
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.15em]">Key Levels</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <span className="text-[8px] font-black text-amber-500/70 uppercase tracking-wider">ATM</span>
            <span className="text-sm font-black font-mono text-amber-400 mt-0.5">
              {atmStrike > 0 ? atmStrike.toLocaleString("en-IN") : "—"}
            </span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-lg bg-violet-500/5 border border-violet-500/20">
            <span className="text-[8px] font-black text-violet-500/70 uppercase tracking-wider">Max Pain</span>
            <span className="text-sm font-black font-mono text-violet-400 mt-0.5">
              {maxPain > 0 ? maxPain.toLocaleString("en-IN") : "—"}
            </span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
            <span className="text-[8px] font-black text-cyan-500/70 uppercase tracking-wider">VIX</span>
            <span className={`text-sm font-black font-mono mt-0.5 ${indiaVix > 15 ? "text-orange-400" : "text-cyan-400"}`}>
              {indiaVix > 0 ? indiaVix.toFixed(2) : "—"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="flex items-center justify-between p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/15">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              <span className="text-[8px] font-black text-rose-400/70 uppercase">Resistance</span>
            </div>
            <span className="text-[11px] font-black font-mono text-rose-400">
              {resistance > 0 ? resistance.toLocaleString("en-IN") : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[8px] font-black text-emerald-400/70 uppercase">Support</span>
            </div>
            <span className="text-[11px] font-black font-mono text-emerald-400">
              {support > 0 ? support.toLocaleString("en-IN") : "—"}
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── Card 4: India VIX + Market Internals ──────────────── */}
      <motion.div 
        custom={3}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="p-4 rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900 to-slate-950"
      >
        <div className="flex items-center gap-1.5 mb-3">
          <Zap size={12} className="text-orange-400" />
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.15em]">Market Pulse</span>
        </div>

        {/* India VIX Gauge */}
        <div className="mb-3">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className={`text-2xl font-black font-mono ${indiaVix > 20 ? "text-red-400" : indiaVix > 15 ? "text-orange-400" : "text-emerald-400"}`}>
              {indiaVix > 0 ? indiaVix.toFixed(2) : "0.00"}
            </span>
            <span className="text-[9px] font-bold text-slate-500">INDIA VIX</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((indiaVix / 30) * 100, 100)}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className={`h-full rounded-full ${
                indiaVix > 20 ? "bg-gradient-to-r from-red-600 to-red-400" 
                : indiaVix > 15 ? "bg-gradient-to-r from-orange-600 to-orange-400" 
                : "bg-gradient-to-r from-emerald-600 to-emerald-400"
              }`}
            />
          </div>
          <div className="flex justify-between text-[7px] font-bold text-slate-600 mt-0.5">
            <span>LOW FEAR</span>
            <span>HIGH FEAR</span>
          </div>
        </div>

        {/* Total OI Summary */}
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/15">
            <span className="text-[7px] font-black text-slate-500 uppercase block">Total CE OI</span>
            <span className="text-[11px] font-black font-mono text-rose-400">{formatLakh(totalCallOi)}</span>
          </div>
          <div className="text-center p-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
            <span className="text-[7px] font-black text-slate-500 uppercase block">Total PE OI</span>
            <span className="text-[11px] font-black font-mono text-emerald-400">{formatLakh(totalPutOi)}</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
