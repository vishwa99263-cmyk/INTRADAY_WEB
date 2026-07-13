/**
 * MomentumScanner.tsx — Layer 2: Momentum + Acceleration Engine
 * Detects fresh momentum, exhaustion, and top accelerating/weakening stocks.
 */

import React, { useMemo } from "react";
import { TrendingUp, TrendingDown, Zap, AlertCircle, CheckCircle, Activity } from "lucide-react";
import type { StockData } from "../../../types";

interface Props {
  stocks: StockData[];
  activePage: string;
}

type MomentumRating = "VERY_STRONG_BULL" | "BULLISH" | "NEUTRAL" | "WEAK" | "VERY_WEAK_BEAR";

interface StockMomentum {
  symbol: string;
  score: number;
  prevScore: number;
  acceleration: number;
  accel15m: number;
  accel30m: number;
  rating: MomentumRating;
  confidence: number;
  isFresh: boolean;
  isExhausted: boolean;
  changePercent: number;
  weightage: number;
  volume: number;
}

function getRating(score: number, accel: number): MomentumRating {
  if (score > 60 && accel > 3) return "VERY_STRONG_BULL";
  if (score > 30 && accel > 0) return "BULLISH";
  if (score < -60 && accel < -3) return "VERY_WEAK_BEAR";
  if (score < -30 && accel < 0) return "WEAK";
  return "NEUTRAL";
}

function getRatingColor(r: MomentumRating): string {
  switch (r) {
    case "VERY_STRONG_BULL": return "text-emerald-400";
    case "BULLISH":           return "text-green-400";
    case "NEUTRAL":           return "text-slate-400";
    case "WEAK":              return "text-orange-400";
    case "VERY_WEAK_BEAR":    return "text-red-400";
  }
}

function getConfidence(score: number, accel: number, accel15m: number): number {
  const base = Math.min(100, Math.abs(score) * 1.5);
  const accelBonus = Math.min(20, Math.abs(accel) * 2);
  const mtfBonus = Math.sign(accel) === Math.sign(accel15m) ? 10 : -10;
  return Math.min(100, Math.max(0, Math.round(base + accelBonus + mtfBonus)));
}

const MomentumScanner: React.FC<Props> = ({ stocks, activePage }) => {
  const momentumData = useMemo((): StockMomentum[] => {
    return stocks.map(s => {
      const accel = s.scoreDifference || 0;
      const accel15m = s.score15mDiff || 0;
      const accel30m = s.score30mDiff || 0;
      const prevScore = (s.score || 0) - accel;
      const rating = getRating(s.score, accel);
      const confidence = getConfidence(s.score, accel, accel15m);

      // Fresh momentum: score was near neutral, now accelerating positively
      const isFresh = Math.abs(prevScore) < 30 && accel > 2 && s.score > 0;
      // Exhausted: score was high but acceleration now negative
      const isExhausted = Math.abs(s.score) > 50 && accel < -2;

      return { symbol: s.symbol, score: s.score, prevScore, acceleration: accel, accel15m, accel30m, rating, confidence, isFresh, isExhausted, changePercent: s.changePercent, weightage: s.weightage, volume: s.volume };
    });
  }, [stocks]);

  const topAccelerating = useMemo(() =>
    [...momentumData].filter(s => s.acceleration > 0).sort((a, b) => b.acceleration - a.acceleration).slice(0, 12),
    [momentumData]
  );

  const topWeakening = useMemo(() =>
    [...momentumData].filter(s => s.acceleration < 0).sort((a, b) => a.acceleration - b.acceleration).slice(0, 8),
    [momentumData]
  );

  const freshMomentum = useMemo(() => momentumData.filter(s => s.isFresh).slice(0, 5), [momentumData]);
  const exhausted = useMemo(() => momentumData.filter(s => s.isExhausted).slice(0, 5), [momentumData]);

  const netAccel = useMemo(() => momentumData.reduce((a, s) => a + s.acceleration, 0), [momentumData]);
  const netAccel15m = useMemo(() => momentumData.reduce((a, s) => a + s.accel15m, 0), [momentumData]);
  const netAccel30m = useMemo(() => momentumData.reduce((a, s) => a + s.accel30m, 0), [momentumData]);

  const overallMomentum = netAccel > 5 ? "ACCELERATING ↑" : netAccel < -5 ? "DECELERATING ↓" : "FLAT →";
  const overallColor = netAccel > 5 ? "text-emerald-400" : netAccel < -5 ? "text-red-400" : "text-amber-400";

  return (
    <div className="p-4 space-y-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <Activity size={18} className="text-indigo-400" /> Momentum Scanner
          </h1>
          <p className="text-base text-slate-500 mt-0.5">Score acceleration · Fresh momentum detection · Exhaustion alerts · {activePage}</p>
        </div>
        <div className={`text-base font-black ${overallColor}`}>{overallMomentum}</div>
      </div>

      {/* Net Acceleration KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "5m Net Acceleration", value: netAccel, suffix: "pts" },
          { label: "15m Net Acceleration", value: netAccel15m, suffix: "pts" },
          { label: "30m Net Acceleration", value: netAccel30m, suffix: "pts" },
        ].map(item => (
          <div key={item.label} className={`rounded-xl border p-4 ${item.value > 0 ? "border-emerald-500/20 bg-emerald-500/5" : item.value < 0 ? "border-red-500/20 bg-red-500/5" : "border-slate-700/30 bg-slate-900/30"}`}>
            <div className="text-sm text-slate-500 uppercase tracking-wider font-black mb-1">{item.label}</div>
            <div className={`text-2xl font-black ${item.value > 0 ? "text-emerald-400" : item.value < 0 ? "text-red-400" : "text-slate-400"}`}>
              {item.value > 0 ? "+" : ""}{item.value.toFixed(1)}
            </div>
          </div>
        ))}
      </div>

      {/* Alerts: Fresh + Exhausted */}
      {(freshMomentum.length > 0 || exhausted.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {freshMomentum.length > 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap size={13} className="text-emerald-400" />
                <span className="text-sm font-black text-emerald-400 uppercase tracking-wider">🟢 Fresh Momentum</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {freshMomentum.map(s => (
                  <div key={s.symbol} className="bg-emerald-500/15 text-emerald-300 px-2 py-1 rounded text-sm font-bold">
                    {s.symbol} <span className="text-emerald-500">+{s.acceleration.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {exhausted.length > 0 && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={13} className="text-orange-400" />
                <span className="text-sm font-black text-orange-400 uppercase tracking-wider">⚠️ Momentum Exhaustion</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {exhausted.map(s => (
                  <div key={s.symbol} className="bg-orange-500/15 text-orange-300 px-2 py-1 rounded text-sm font-bold">
                    {s.symbol} <span className="text-orange-500">{s.acceleration.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tables side by side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Accelerating */}
        <div className="rounded-xl border border-emerald-500/20 bg-[#060d10] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-emerald-500/15 flex items-center gap-2">
            <TrendingUp size={12} className="text-emerald-400" />
            <span className="text-sm font-black text-emerald-400 uppercase tracking-wider">Top Accelerating</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "380px" }}>
            <table className="w-full text-base">
              <thead className="sticky top-0 bg-[#060d10]">
                <tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
                  <th className="p-2 pl-3 text-left">Symbol</th>
                  <th className="p-2 text-right">Score</th>
                  <th className="p-2 text-right">Accel</th>
                  <th className="p-2 pr-3 text-right">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/20">
                {topAccelerating.map((s, i) => (
                  <tr key={s.symbol} className={`hover:bg-emerald-500/5 transition-colors ${i % 2 === 0 ? "bg-slate-950/20" : ""}`}>
                    <td className="p-2 pl-3 font-bold text-slate-200">
                      {s.isFresh && <span className="text-emerald-400 mr-1">●</span>}
                      {s.symbol}
                    </td>
                    <td className="p-2 text-right">
                      <span className={`font-mono text-sm font-bold ${s.score > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {s.score > 0 ? "+" : ""}{s.score.toFixed(1)}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono text-emerald-400 font-bold">
                      +{s.acceleration.toFixed(1)}
                    </td>
                    <td className="p-2 pr-3 text-right">
                      <span className={`text-sm font-black ${getRatingColor(s.rating)}`}>
                        {s.rating.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Weakening */}
        <div className="rounded-xl border border-red-500/20 bg-[#100608] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-red-500/15 flex items-center gap-2">
            <TrendingDown size={12} className="text-red-400" />
            <span className="text-sm font-black text-red-400 uppercase tracking-wider">Top Weakening</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "380px" }}>
            <table className="w-full text-base">
              <thead className="sticky top-0 bg-[#100608]">
                <tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
                  <th className="p-2 pl-3 text-left">Symbol</th>
                  <th className="p-2 text-right">Score</th>
                  <th className="p-2 text-right">Accel</th>
                  <th className="p-2 pr-3 text-right">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/20">
                {topWeakening.map((s, i) => (
                  <tr key={s.symbol} className={`hover:bg-red-500/5 transition-colors ${i % 2 === 0 ? "bg-slate-950/20" : ""}`}>
                    <td className="p-2 pl-3 font-bold text-slate-200">
                      {s.isExhausted && <span className="text-orange-400 mr-1">⚠</span>}
                      {s.symbol}
                    </td>
                    <td className="p-2 text-right">
                      <span className={`font-mono text-sm font-bold ${s.score > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {s.score > 0 ? "+" : ""}{s.score.toFixed(1)}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono text-red-400 font-bold">
                      {s.acceleration.toFixed(1)}
                    </td>
                    <td className="p-2 pr-3 text-right">
                      <span className={`text-sm font-black ${getRatingColor(s.rating)}`}>
                        {s.rating.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Full Momentum Table */}
      <div className="rounded-xl border border-slate-800/50 bg-[#08101a] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800/50">
          <span className="text-sm font-black text-slate-400 uppercase tracking-wider">Complete Momentum Map</span>
        </div>
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "320px" }}>
          <table className="w-full text-base">
            <thead className="sticky top-0 bg-[#08101a]">
              <tr className="border-b border-slate-800/30 text-sm text-slate-500 uppercase">
                <th className="p-2 pl-4 text-left">Symbol</th>
                <th className="p-2 text-right">Score</th>
                <th className="p-2 text-right">5m Δ</th>
                <th className="p-2 text-right">15m Δ</th>
                <th className="p-2 text-right">30m Δ</th>
                <th className="p-2 text-right">Conf%</th>
                <th className="p-2 pr-4 text-right">Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/20">
              {momentumData.sort((a, b) => Math.abs(b.acceleration) - Math.abs(a.acceleration)).map((s, i) => (
                <tr key={s.symbol} className={`hover:bg-slate-800/20 transition-colors ${i % 2 === 0 ? "bg-slate-950/20" : ""}`}>
                  <td className="p-2 pl-4 font-bold text-slate-200 font-sans">{s.symbol}</td>
                  <td className="p-2 text-right font-mono">
                    <span className={`text-sm font-bold ${s.score > 0 ? "text-emerald-400" : s.score < 0 ? "text-red-400" : "text-slate-500"}`}>
                      {s.score > 0 ? "+" : ""}{s.score.toFixed(1)}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">
                    <span className={`text-sm font-bold ${s.acceleration > 0 ? "text-emerald-400" : s.acceleration < 0 ? "text-red-400" : "text-slate-500"}`}>
                      {s.acceleration > 0 ? "+" : ""}{s.acceleration.toFixed(1)}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">
                    <span className={`text-sm ${s.accel15m > 0 ? "text-emerald-400" : s.accel15m < 0 ? "text-red-400" : "text-slate-600"}`}>
                      {s.accel15m > 0 ? "+" : ""}{s.accel15m.toFixed(1)}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">
                    <span className={`text-sm ${s.accel30m > 0 ? "text-emerald-400" : s.accel30m < 0 ? "text-red-400" : "text-slate-600"}`}>
                      {s.accel30m > 0 ? "+" : ""}{s.accel30m.toFixed(1)}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.confidence >= 65 ? "bg-emerald-500" : s.confidence >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${s.confidence}%` }} />
                      </div>
                      <span className="text-sm text-slate-400 font-mono w-6 text-right">{s.confidence}%</span>
                    </div>
                  </td>
                  <td className="p-2 pr-4 text-right">
                    <span className={`text-sm font-black ${getRatingColor(s.rating)}`}>
                      {s.rating.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MomentumScanner;

