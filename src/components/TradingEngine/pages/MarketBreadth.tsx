/**
 * MarketBreadth.tsx — Layer 1: Market Breadth Engine
 * Calculates advancing/declining/ADR/breadth score from existing stock data.
 */

import React, { useMemo } from "react";
import { BarChart2, TrendingUp, TrendingDown, Minus, Award, AlertCircle } from "lucide-react";
import type { StockData } from "../../../types";

interface Props {
  stocks: StockData[];
  activePage: string;
  niftySpot?: number;
  sensexSpot?: number;
}

const MarketBreadth: React.FC<Props> = ({ stocks, activePage }) => {
  const data = useMemo(() => {
    if (!stocks.length) return null;

    const advancing = stocks.filter(s => s.changePercent > 0);
    const declining = stocks.filter(s => s.changePercent < 0);
    const unchanged = stocks.filter(s => s.changePercent === 0);
    const total = stocks.length;

    const adr = advancing.length / (advancing.length + declining.length + 0.001);
    const positiveScores = stocks.filter(s => s.score > 0).length;
    const negativeScores = stocks.filter(s => s.score < 0).length;

    const sortedByWeight = [...stocks].sort((a, b) => b.weightage - a.weightage);
    const top10 = sortedByWeight.slice(0, 10);
    const top10Bullish = top10.filter(s => s.score > 0).length;

    // Breadth Score 0-100
    const breadthScore = Math.round(
      (adr * 0.4 + positiveScores / total * 0.4 + top10Bullish / 10 * 0.2) * 100
    );

    // Weighted contribution per stock
    const totalWeightage = stocks.reduce((a, s) => a + s.weightage, 0);
    const contributions = stocks.map(s => ({
      ...s,
      contribution: (s.weightage / totalWeightage) * (s.score || 0),
    })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    const topContributors = contributions.filter(s => s.contribution > 0).slice(0, 7);
    const bottomContributors = contributions.filter(s => s.contribution < 0).slice(0, 7);

    // Tier breakdown
    const top10AdvDec = { adv: top10.filter(s => s.changePercent > 0).length, dec: top10.filter(s => s.changePercent < 0).length };
    const nextSliceEnd = activePage === "BANKNIFTY" ? 12 : (activePage === "SENSEX" ? 22 : 25);
    const next = sortedByWeight.slice(10, nextSliceEnd);
    const nextAdvDec = { adv: next.filter(s => s.changePercent > 0).length, dec: next.filter(s => s.changePercent < 0).length };

    // Net score sums
    const netScore = stocks.reduce((a, s) => a + (s.score || 0), 0);
    const net15m = stocks.reduce((a, s) => a + (s.score15mDiff || 0), 0);
    const netAccel = stocks.reduce((a, s) => a + (s.scoreDifference || 0), 0);

    return {
      advancing: advancing.length,
      declining: declining.length,
      unchanged: unchanged.length,
      total,
      adr,
      positiveScores,
      negativeScores,
      top10Bullish,
      breadthScore,
      topContributors,
      bottomContributors,
      top10AdvDec,
      nextAdvDec,
      netScore,
      net15m,
      netAccel,
    };
  }, [stocks, activePage]);

  if (!data) return <EmptyState />;

  const { breadthScore } = data;
  const verdict = breadthScore >= 65 ? "BULLISH" : breadthScore <= 35 ? "BEARISH" : "NEUTRAL";
  const verdictColor = verdict === "BULLISH" ? "text-emerald-400" : verdict === "BEARISH" ? "text-red-400" : "text-amber-400";
  const verdictBg = verdict === "BULLISH" ? "border-emerald-500/30 bg-[#061510]" : verdict === "BEARISH" ? "border-red-500/30 bg-[#150606]" : "border-amber-500/30 bg-[#12100a]";

  return (
    <div className="p-4 space-y-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <BarChart2 size={18} className="text-indigo-400" /> Market Breadth Engine
          </h1>
          <p className="text-base text-slate-500 mt-0.5">Advance/Decline · Score Breadth · Weightage Contribution · {activePage}</p>
        </div>
        <div className={`px-3 py-1.5 rounded-lg border text-base font-black ${verdictBg} ${verdictColor}`}>
          {verdict}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-6 gap-2">
        <KPICard label="Advancing" value={data.advancing} color="text-emerald-400" bg="border-emerald-500/20 bg-emerald-500/5" icon={<TrendingUp size={14} />} />
        <KPICard label="Declining" value={data.declining} color="text-red-400" bg="border-red-500/20 bg-red-500/5" icon={<TrendingDown size={14} />} />
        <KPICard label="Unchanged" value={data.unchanged} color="text-slate-400" bg="border-slate-700/30 bg-slate-900/30" icon={<Minus size={14} />} />
        <KPICard label="ADR" value={data.adr.toFixed(2)} color={data.adr > 1 ? "text-emerald-400" : "text-red-400"} bg="border-slate-700/30 bg-slate-900/30" />
        <KPICard label="+ve Scores" value={data.positiveScores} color="text-emerald-400" bg="border-emerald-500/10 bg-emerald-500/5" />
        <KPICard label="-ve Scores" value={data.negativeScores} color="text-red-400" bg="border-red-500/10 bg-red-500/5" />
      </div>

      {/* Breadth Score Gauge */}
      <div className={`rounded-2xl border p-5 ${verdictBg}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-slate-500 uppercase tracking-widest font-black">Market Breadth Score</div>
          <div className={`text-3xl font-black ${verdictColor}`}>{breadthScore}<span className="text-xl">/100</span></div>
        </div>
        <div className="h-3 bg-slate-800/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${breadthScore >= 65 ? "bg-emerald-500" : breadthScore >= 50 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${breadthScore}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-slate-600 mt-1">
          <span>BEARISH (0)</span><span>NEUTRAL (50)</span><span>BULLISH (100)</span>
        </div>

        {/* Net Scores row */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <NetScoreBox label="Net Score" value={data.netScore} />
          <NetScoreBox label="15m Net Diff" value={data.net15m} />
          <NetScoreBox label="5m Accel" value={data.netAccel} />
        </div>
      </div>

      {/* Tier breakdown */}
      <div className="grid grid-cols-2 gap-3">
        <TierCard title={`Top 10 Heavyweights`} adv={data.top10AdvDec.adv} dec={data.top10AdvDec.dec} bullish={data.top10Bullish} />
        <TierCard title={`Next ${activePage === "SENSEX" ? "12" : "15"} Stocks`} adv={data.nextAdvDec.adv} dec={data.nextAdvDec.dec} bullish={data.nextAdvDec.adv} />
      </div>

      {/* Contributors Tables side by side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Top Contributors */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-emerald-500/15 flex items-center gap-2">
            <TrendingUp size={12} className="text-emerald-400" />
            <span className="text-sm font-black text-emerald-400 uppercase tracking-wider">Top Bullish Contributors</span>
          </div>
          <table className="w-full text-base">
            <thead><tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
              <th className="p-2 pl-3 text-left">Symbol</th>
              <th className="p-2 text-center">Score</th>
              <th className="p-2 text-center">Wt%</th>
              <th className="p-2 pr-3 text-right">Chg%</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800/20">
              {data.topContributors.map(s => (
                <tr key={s.symbol} className="hover:bg-emerald-500/5 transition-colors">
                  <td className="p-2 pl-3 font-bold text-slate-200">{s.symbol}</td>
                  <td className="p-2 text-center">
                    <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-sm font-bold">+{s.score.toFixed(1)}</span>
                  </td>
                  <td className="p-2 text-center text-slate-400 font-mono">{s.weightage.toFixed(1)}</td>
                  <td className="p-2 pr-3 text-right text-emerald-400 font-mono">+{s.changePercent.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom Contributors */}
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-red-500/15 flex items-center gap-2">
            <TrendingDown size={12} className="text-red-400" />
            <span className="text-sm font-black text-red-400 uppercase tracking-wider">Top Bearish Contributors</span>
          </div>
          <table className="w-full text-base">
            <thead><tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
              <th className="p-2 pl-3 text-left">Symbol</th>
              <th className="p-2 text-center">Score</th>
              <th className="p-2 text-center">Wt%</th>
              <th className="p-2 pr-3 text-right">Chg%</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800/20">
              {data.bottomContributors.map(s => (
                <tr key={s.symbol} className="hover:bg-red-500/5 transition-colors">
                  <td className="p-2 pl-3 font-bold text-slate-200">{s.symbol}</td>
                  <td className="p-2 text-center">
                    <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-sm font-bold">{s.score.toFixed(1)}</span>
                  </td>
                  <td className="p-2 text-center text-slate-400 font-mono">{s.weightage.toFixed(1)}</td>
                  <td className="p-2 pr-3 text-right text-red-400 font-mono">{s.changePercent.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Sub-components
const KPICard: React.FC<{ label: string; value: number | string; color: string; bg: string; icon?: React.ReactNode }> = ({
  label, value, color, bg, icon
}) => (
  <div className={`rounded-xl border p-3 ${bg}`}>
    <div className="flex items-center gap-1 mb-1">
      {icon && <span className={color}>{icon}</span>}
      <span className="text-sm text-slate-500 uppercase tracking-wider font-black">{label}</span>
    </div>
    <div className={`text-2xl font-black ${color}`}>{value}</div>
  </div>
);

const NetScoreBox: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="text-center">
    <div className="text-sm text-slate-600 mb-0.5">{label}</div>
    <div className={`text-lg font-black ${value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-slate-500"}`}>
      {value > 0 ? "+" : ""}{value.toFixed(1)}
    </div>
  </div>
);

const TierCard: React.FC<{ title: string; adv: number; dec: number; bullish: number }> = ({
  title, adv, dec, bullish
}) => {
  const total = adv + dec;
  const pct = total > 0 ? Math.round((adv / total) * 100) : 50;
  return (
    <div className="rounded-xl border border-slate-800/50 bg-[#08101a] p-4">
      <div className="text-sm text-slate-500 uppercase font-black tracking-wider mb-3">{title}</div>
      <div className="flex items-center gap-4">
        <div className="text-center"><div className="text-2xl font-black text-emerald-400">{adv}</div><div className="text-sm text-slate-500">Adv</div></div>
        <div className="flex-1 h-2 bg-red-500/20 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-center"><div className="text-2xl font-black text-red-400">{dec}</div><div className="text-sm text-slate-500">Dec</div></div>
      </div>
      <div className="text-center mt-2 text-sm text-slate-500">{pct}% advancing</div>
    </div>
  );
};

const EmptyState = () => (
  <div className="flex items-center justify-center h-64 text-slate-600">
    <div className="text-center">
      <BarChart2 size={32} className="mx-auto mb-2 opacity-30" />
      <div className="text-base">Waiting for market data...</div>
    </div>
  </div>
);

export default MarketBreadth;

