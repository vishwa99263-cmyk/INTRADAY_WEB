/**
 * OptionChainEngine.tsx — Layer 3: Option Chain Analysis Engine
 * Analyzes PCR, OI, OI Change, Call/Put Writing/Unwinding, Max Pain, Smart Money.
 */

import React, { useMemo } from "react";
import { Layers, TrendingUp, TrendingDown, Shield, Eye, AlertCircle } from "lucide-react";
import type { OptionStrike, AIAnalysisPayload } from "../../../types";

interface Props {
  optionChain: OptionStrike[];
  aiAnalysis: AIAnalysisPayload;
  spotPrice: number;
  activePage: string;
  pcr: number;
}

interface StrikeActivity {
  strike: number;
  ceOI: number;
  peOI: number;
  ceOIChange: number;
  peOIChange: number;
  ceVolume: number;
  peVolume: number;
  ceActivity: "WRITING" | "UNWINDING" | "NEUTRAL";
  peActivity: "WRITING" | "UNWINDING" | "NEUTRAL";
  distFromSpot: number;
}

const OptionChainEngine: React.FC<Props> = ({ optionChain, aiAnalysis, spotPrice, activePage, pcr }) => {
  const analysis = useMemo(() => {
    if (!optionChain.length) return null;

    const totalCeOI = optionChain.reduce((a, s) => a + s.ceOI, 0);
    const totalPeOI = optionChain.reduce((a, s) => a + s.peOI, 0);
    const totalCeVol = optionChain.reduce((a, s) => a + s.ceVolume, 0);
    const totalPeVol = optionChain.reduce((a, s) => a + s.peVolume, 0);
    const totalCeOIChg = optionChain.reduce((a, s) => a + s.ceOIChange, 0);
    const totalPeOIChg = optionChain.reduce((a, s) => a + s.peOIChange, 0);

    // Call/Put Writing and Unwinding
    const callWriting = optionChain.filter(s => s.ceOIChange > 0).sort((a, b) => b.ceOIChange - a.ceOIChange);
    const callUnwinding = optionChain.filter(s => s.ceOIChange < 0).sort((a, b) => a.ceOIChange - b.ceOIChange);
    const putWriting = optionChain.filter(s => s.peOIChange > 0).sort((a, b) => b.peOIChange - a.peOIChange);
    const putUnwinding = optionChain.filter(s => s.peOIChange < 0).sort((a, b) => a.peOIChange - b.peOIChange);

    // Max Pain — find strike where total OI loss for all option holders is minimized
    let maxPainStrike = aiAnalysis?.report?.oi?.maxPainStrike || 0;
    if (!maxPainStrike && spotPrice > 0) {
      // Simple approximation: strike with max total OI
      const peak = [...optionChain].sort((a, b) => (b.ceOI + b.peOI) - (a.ceOI + a.peOI))[0];
      maxPainStrike = peak?.strikePrice ?? 0;
    }

    // Support/Resistance walls from OI
    const aboveSpot = optionChain.filter(s => s.strikePrice > spotPrice);
    const belowSpot = optionChain.filter(s => s.strikePrice < spotPrice);
    const resistanceWall = aboveSpot.sort((a, b) => b.ceOI - a.ceOI)[0]?.strikePrice || aiAnalysis?.report?.oi?.resistanceWall || 0;
    const supportWall = belowSpot.sort((a, b) => b.peOI - a.peOI)[0]?.strikePrice || aiAnalysis?.report?.oi?.supportWall || 0;

    // OI Score: bullish when put writing > call writing (sellers expect support)
    const putWriteSum = putWriting.reduce((a, s) => a + s.peOIChange, 0);
    const callWriteSum = callWriting.reduce((a, s) => a + s.ceOIChange, 0);
    const oiNetScore = putWriteSum - callWriteSum;

    // 0-100 score
    const pcrScore = pcr > 1.3 ? 80 : pcr > 1.1 ? 65 : pcr > 0.9 ? 50 : pcr > 0.7 ? 35 : 20;
    const oiDirScore = oiNetScore > 0 ? 65 : oiNetScore < 0 ? 35 : 50;
    const oiEngineScore = Math.round(pcrScore * 0.5 + oiDirScore * 0.5);

    // Strike-level activity
    const avgCeChg = optionChain.reduce((a, s) => a + Math.abs(s.ceOIChange), 0) / optionChain.length;
    const avgPeChg = optionChain.reduce((a, s) => a + Math.abs(s.peOIChange), 0) / optionChain.length;

    const strikesActivity: StrikeActivity[] = optionChain
      .filter(s => spotPrice > 0 ? Math.abs(s.strikePrice - spotPrice) < spotPrice * 0.03 : true)
      .map(s => ({
        strike: s.strikePrice,
        ceOI: s.ceOI,
        peOI: s.peOI,
        ceOIChange: s.ceOIChange,
        peOIChange: s.peOIChange,
        ceVolume: s.ceVolume,
        peVolume: s.peVolume,
        ceActivity: s.ceOIChange > avgCeChg * 0.5 ? "WRITING" : s.ceOIChange < -avgCeChg * 0.5 ? "UNWINDING" : "NEUTRAL",
        peActivity: s.peOIChange > avgPeChg * 0.5 ? "WRITING" : s.peOIChange < -avgPeChg * 0.5 ? "UNWINDING" : "NEUTRAL",
        distFromSpot: spotPrice > 0 ? s.strikePrice - spotPrice : 0,
      }))
      .sort((a, b) => Math.abs(a.distFromSpot) - Math.abs(b.distFromSpot));

    const signal = oiEngineScore >= 65 ? "BULLISH" : oiEngineScore <= 35 ? "BEARISH" : "NEUTRAL";

    return {
      totalCeOI, totalPeOI, totalCeVol, totalPeVol, totalCeOIChg, totalPeOIChg,
      callWriting: callWriting.slice(0, 5), callUnwinding: callUnwinding.slice(0, 3),
      putWriting: putWriting.slice(0, 5), putUnwinding: putUnwinding.slice(0, 3),
      maxPainStrike, resistanceWall, supportWall,
      oiEngineScore, signal, pcrScore, oiDirScore,
      strikesActivity: strikesActivity.slice(0, 14),
    };
  }, [optionChain, pcr, spotPrice, aiAnalysis]);

  const smartMoney = aiAnalysis?.smartMoney;
  const oiReport = aiAnalysis?.report?.oi;

  if (!analysis) return (
    <div className="flex items-center justify-center h-64 text-slate-600">
      <div className="text-center"><Layers size={32} className="mx-auto mb-2 opacity-30" /><div className="text-base">Waiting for option chain data...</div></div>
    </div>
  );

  const signalColor = analysis.signal === "BULLISH" ? "text-emerald-400" : analysis.signal === "BEARISH" ? "text-red-400" : "text-amber-400";
  const signalBg = analysis.signal === "BULLISH" ? "border-emerald-500/30 bg-[#061510]" : analysis.signal === "BEARISH" ? "border-red-500/30 bg-[#150606]" : "border-amber-500/30 bg-[#12100a]";

  return (
    <div className="p-4 space-y-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <Layers size={18} className="text-indigo-400" /> Option Chain Engine
          </h1>
          <p className="text-base text-slate-500 mt-0.5">OI · PCR · Smart Money · Writing/Unwinding · {activePage}</p>
        </div>
        <div className={`px-4 py-2 rounded-xl border text-base font-black ${signalBg} ${signalColor}`}>
          {analysis.signal} · {analysis.oiEngineScore}%
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-2">
        <OIKPICard label="PCR" value={pcr.toFixed(3)} color={pcr > 1.1 ? "text-emerald-400" : pcr < 0.9 ? "text-red-400" : "text-amber-400"} sub={pcr > 1.25 ? "Strongly Bullish" : pcr > 1.0 ? "Bullish" : pcr > 0.85 ? "Neutral" : "Bearish"} />
        <OIKPICard label="Total Call OI" value={fmt(analysis.totalCeOI)} color="text-red-400" sub={`Chg: ${analysis.totalCeOIChg > 0 ? "+" : ""}${fmt(analysis.totalCeOIChg)}`} />
        <OIKPICard label="Total Put OI" value={fmt(analysis.totalPeOI)} color="text-emerald-400" sub={`Chg: ${analysis.totalPeOIChg > 0 ? "+" : ""}${fmt(analysis.totalPeOIChg)}`} />
        <OIKPICard label="Max Pain" value={analysis.maxPainStrike > 0 ? analysis.maxPainStrike.toLocaleString("en-IN") : "—"} color="text-amber-400" sub={`Spot: ${spotPrice > 0 ? spotPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}`} />
      </div>

      {/* OI Strength + Levels */}
      <div className="grid grid-cols-3 gap-3">
        {/* OI Strength Meter */}
        <div className={`rounded-2xl border p-5 ${signalBg}`}>
          <div className="text-sm text-slate-500 uppercase font-black tracking-wider mb-2">OI Engine Score</div>
          <div className={`text-4xl font-black ${signalColor}`}>{analysis.oiEngineScore}<span className="text-2xl">/100</span></div>
          <div className="mt-3 h-2 bg-slate-800/60 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${analysis.oiEngineScore >= 65 ? "bg-emerald-500" : analysis.oiEngineScore >= 50 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${analysis.oiEngineScore}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="text-center"><div className="text-sm text-slate-600">PCR Score</div><div className="font-black text-slate-300">{analysis.pcrScore}</div></div>
            <div className="text-center"><div className="text-sm text-slate-600">OI Dir Score</div><div className="font-black text-slate-300">{analysis.oiDirScore}</div></div>
          </div>
        </div>

        {/* Support/Resistance */}
        <div className="rounded-xl border border-slate-800/50 bg-[#08101a] p-4">
          <div className="text-sm text-slate-500 uppercase font-black tracking-wider mb-4">Key OI Levels</div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <div><div className="text-sm text-slate-500">Resistance Wall</div><div className="text-base font-black text-red-400">{analysis.resistanceWall > 0 ? analysis.resistanceWall.toLocaleString("en-IN") : "—"}</div></div>
              <Shield size={16} className="text-red-400 opacity-50" />
            </div>
            <div className="flex justify-between items-center p-2.5 rounded-lg bg-slate-800/30 border border-slate-700/30">
              <div><div className="text-sm text-slate-500">Spot Price</div><div className="text-base font-black text-white">{spotPrice > 0 ? spotPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}</div></div>
              <div className="text-sm text-slate-500">←NOW</div>
            </div>
            <div className="flex justify-between items-center p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div><div className="text-sm text-slate-500">Support Wall</div><div className="text-base font-black text-emerald-400">{analysis.supportWall > 0 ? analysis.supportWall.toLocaleString("en-IN") : "—"}</div></div>
              <Shield size={16} className="text-emerald-400 opacity-50" />
            </div>
            {analysis.maxPainStrike > 0 && (
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div><div className="text-sm text-slate-500">Max Pain</div><div className="text-base font-black text-amber-400">{analysis.maxPainStrike.toLocaleString("en-IN")}</div></div>
                <AlertCircle size={16} className="text-amber-400 opacity-50" />
              </div>
            )}
          </div>
        </div>

        {/* Smart Money Panel */}
        <div className="rounded-xl border border-slate-800/50 bg-[#08101a] p-4">
          <div className="text-sm text-slate-500 uppercase font-black tracking-wider mb-3">Smart Money Flow</div>
          {smartMoney ? (
            <div className="space-y-3">
              <div className={`text-xl font-black ${smartMoney.direction === "BULLISH" ? "text-emerald-400" : smartMoney.direction === "BEARISH" ? "text-red-400" : "text-slate-400"}`}>
                {smartMoney.direction}
              </div>
              <div className="text-sm text-slate-400">{smartMoney.detail}</div>
              <div className="flex flex-wrap gap-1">
                <span className={`text-sm font-black px-1.5 py-0.5 rounded ${smartMoney.institutionalBias === "BUYING" ? "bg-emerald-500/20 text-emerald-400" : smartMoney.institutionalBias === "SELLING" ? "bg-red-500/20 text-red-400" : "bg-slate-700/50 text-slate-400"}`}>
                  {smartMoney.institutionalBias}
                </span>
                <span className="text-sm font-black px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">
                  {smartMoney.eventType}
                </span>
              </div>
              <div>
                <div className="text-sm text-slate-600 mb-1">Institutional Confidence</div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${smartMoney.confidence}%` }} />
                </div>
                <div className="text-sm text-slate-500 mt-0.5 text-right">{smartMoney.confidence}%</div>
              </div>
            </div>
          ) : (
            <div className="text-slate-600 text-base">No smart money signal</div>
          )}
        </div>
      </div>

      {/* Writing/Unwinding Tables */}
      <div className="grid grid-cols-2 gap-3">
        {/* Call Side */}
        <div className="rounded-xl border border-red-500/20 bg-[#100608] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-red-500/15">
            <span className="text-sm font-black text-red-400 uppercase tracking-wider">📞 Call Activity</span>
          </div>
          <table className="w-full text-base">
            <thead><tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
              <th className="p-2 pl-3 text-left">Strike</th>
              <th className="p-2 text-right">OI</th>
              <th className="p-2 text-right">OI Chg</th>
              <th className="p-2 pr-3 text-right">Activity</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800/20">
              {analysis.callWriting.slice(0, 4).map(s => (
                <tr key={`cw-${s.strikePrice}`} className="hover:bg-red-500/5">
                  <td className="p-2 pl-3 font-bold text-slate-200">{s.strikePrice.toLocaleString("en-IN")}</td>
                  <td className="p-2 text-right text-slate-400 font-mono">{fmt(s.ceOI)}</td>
                  <td className="p-2 text-right text-red-400 font-mono font-bold">+{fmt(s.ceOIChange)}</td>
                  <td className="p-2 pr-3 text-right"><span className="text-sm bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-black">WRITING</span></td>
                </tr>
              ))}
              {analysis.callUnwinding.slice(0, 2).map(s => (
                <tr key={`cu-${s.strikePrice}`} className="hover:bg-slate-800/20">
                  <td className="p-2 pl-3 font-bold text-slate-400">{s.strikePrice.toLocaleString("en-IN")}</td>
                  <td className="p-2 text-right text-slate-500 font-mono">{fmt(s.ceOI)}</td>
                  <td className="p-2 text-right text-emerald-400 font-mono">{fmt(s.ceOIChange)}</td>
                  <td className="p-2 pr-3 text-right"><span className="text-sm bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded font-black">UNWIND</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Put Side */}
        <div className="rounded-xl border border-emerald-500/20 bg-[#060d10] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-emerald-500/15">
            <span className="text-sm font-black text-emerald-400 uppercase tracking-wider">🤚 Put Activity</span>
          </div>
          <table className="w-full text-base">
            <thead><tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
              <th className="p-2 pl-3 text-left">Strike</th>
              <th className="p-2 text-right">OI</th>
              <th className="p-2 text-right">OI Chg</th>
              <th className="p-2 pr-3 text-right">Activity</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800/20">
              {analysis.putWriting.slice(0, 4).map(s => (
                <tr key={`pw-${s.strikePrice}`} className="hover:bg-emerald-500/5">
                  <td className="p-2 pl-3 font-bold text-slate-200">{s.strikePrice.toLocaleString("en-IN")}</td>
                  <td className="p-2 text-right text-slate-400 font-mono">{fmt(s.peOI)}</td>
                  <td className="p-2 text-right text-emerald-400 font-mono font-bold">+{fmt(s.peOIChange)}</td>
                  <td className="p-2 pr-3 text-right"><span className="text-sm bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-black">WRITING</span></td>
                </tr>
              ))}
              {analysis.putUnwinding.slice(0, 2).map(s => (
                <tr key={`pu-${s.strikePrice}`} className="hover:bg-slate-800/20">
                  <td className="p-2 pl-3 font-bold text-slate-400">{s.strikePrice.toLocaleString("en-IN")}</td>
                  <td className="p-2 text-right text-slate-500 font-mono">{fmt(s.peOI)}</td>
                  <td className="p-2 text-right text-red-400 font-mono">{fmt(s.peOIChange)}</td>
                  <td className="p-2 pr-3 text-right"><span className="text-sm bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded font-black">UNWIND</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ATM Strike Activity */}
      {analysis.strikesActivity.length > 0 && (
        <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800/50">
            <span className="text-sm font-black text-slate-400 uppercase tracking-wider">ATM Zone Activity (±3% from Spot)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead><tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
                <th className="p-2 pl-4 text-left">Strike</th>
                <th className="p-2 text-right">CE OI</th>
                <th className="p-2 text-right">CE Δ</th>
                <th className="p-2 text-center">CE Act</th>
                <th className="p-2 text-center">PE Act</th>
                <th className="p-2 text-right">PE Δ</th>
                <th className="p-2 pr-4 text-right">PE OI</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800/20">
                {analysis.strikesActivity.map((s, i) => (
                  <tr key={s.strike} className={`hover:bg-slate-800/20 transition-colors ${Math.abs(s.distFromSpot) < 100 ? "bg-indigo-500/5" : i % 2 === 0 ? "bg-slate-950/20" : ""}`}>
                    <td className="p-2 pl-4 font-bold text-slate-200 font-mono">
                      {s.strike.toLocaleString("en-IN")}
                      {Math.abs(s.distFromSpot) < 100 && <span className="ml-1 text-sm text-indigo-400">ATM</span>}
                    </td>
                    <td className="p-2 text-right text-slate-400 font-mono text-sm">{fmt(s.ceOI)}</td>
                    <td className={`p-2 text-right font-mono font-bold text-sm ${s.ceOIChange > 0 ? "text-red-400" : s.ceOIChange < 0 ? "text-emerald-400" : "text-slate-500"}`}>{s.ceOIChange > 0 ? "+" : ""}{fmt(s.ceOIChange)}</td>
                    <td className="p-2 text-center"><ActivityBadge act={s.ceActivity} side="CE" /></td>
                    <td className="p-2 text-center"><ActivityBadge act={s.peActivity} side="PE" /></td>
                    <td className={`p-2 text-right font-mono font-bold text-sm ${s.peOIChange > 0 ? "text-emerald-400" : s.peOIChange < 0 ? "text-red-400" : "text-slate-500"}`}>{s.peOIChange > 0 ? "+" : ""}{fmt(s.peOIChange)}</td>
                    <td className="p-2 pr-4 text-right text-slate-400 font-mono text-sm">{fmt(s.peOI)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// Helpers
function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

const OIKPICard: React.FC<{ label: string; value: string; color: string; sub?: string }> = ({ label, value, color, sub }) => (
  <div className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-3">
    <div className="text-sm text-slate-500 uppercase tracking-wider font-black mb-1">{label}</div>
    <div className={`text-2xl font-black ${color}`}>{value}</div>
    {sub && <div className="text-sm text-slate-600 mt-0.5">{sub}</div>}
  </div>
);

const ActivityBadge: React.FC<{ act: "WRITING" | "UNWINDING" | "NEUTRAL"; side: "CE" | "PE" }> = ({ act, side }) => {
  if (act === "NEUTRAL") return <span className="text-sm text-slate-600">—</span>;
  const isWritingBullish = side === "PE" && act === "WRITING" || side === "CE" && act === "UNWINDING";
  const color = isWritingBullish ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400";
  return <span className={`text-sm font-black px-1 py-0.5 rounded ${color}`}>{act}</span>;
};

export default OptionChainEngine;

