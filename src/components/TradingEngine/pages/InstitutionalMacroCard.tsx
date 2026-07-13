/**
 * InstitutionalMacroCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 17: Institutional Macro Engine Card UI
 *
 * Displays FII & DII flows, macro bias gauge, reasons ledger, and manual entry inputs.
 */
import React, { useState } from "react";
import { Layers } from "lucide-react";
import type { TEFiiDii, InstitutionalMacroResult } from "../../../engine/institutionalMacroEngine";

export interface InstitutionalMacroCardProps {
  fiiDiiHistory: TEFiiDii[];
  macroResult: InstitutionalMacroResult;
  onRefresh: () => void;
}

const InstitutionalMacroCard: React.FC<InstitutionalMacroCardProps> = ({
  fiiDiiHistory,
  macroResult,
  onRefresh,
}) => {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [fiiCash, setFiiCash] = useState("");
  const [diiCash, setDiiCash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || fiiCash === "" || diiCash === "") {
      setError("Fill all fields.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/te/fii-dii", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date,
          fii_cash: parseFloat(fiiCash),
          dii_cash: parseFloat(diiCash),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save data.");
      }

      setFiiCash("");
      setDiiCash("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      onRefresh(); // Trigger parent reload
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const biasColors = {
    BULLISH: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    BEARISH: "text-red-400 border-red-500/30 bg-red-500/10",
    NEUTRAL: "text-amber-400 border-amber-500/35 bg-amber-500/10",
  };

  const glowShadow =
    macroResult.institutionalBias === "BULLISH"
      ? "rgba(16,185,129,0.08)"
      : macroResult.institutionalBias === "BEARISH"
      ? "rgba(239,68,68,0.08)"
      : "rgba(245,158,11,0.08)";

  return (
    <div
      className="relative select-none overflow-hidden rounded-xl h-full flex flex-col justify-between"
      style={{
        background: "linear-gradient(135deg, #03050a 0%, #060a14 55%, #03050a 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: `0 2px 28px ${glowShadow}`,
      }}
    >
      {/* Top indicator line */}
      <div
        className="absolute top-0 left-0 w-full h-[1.5px]"
        style={{
          background:
            macroResult.institutionalBias === "BULLISH"
              ? "linear-gradient(90deg, transparent 5%, #10b981 50%, transparent 95%)"
              : macroResult.institutionalBias === "BEARISH"
              ? "linear-gradient(90deg, transparent 5%, #ef4444 50%, transparent 95%)"
              : "linear-gradient(90deg, transparent 5%, #f59e0b 50%, transparent 95%)",
        }}
      />

      <div className="relative z-10 px-4 py-4 flex flex-col h-full justify-between">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3 border-b border-slate-800/40 pb-2">
          <div className="flex items-center gap-1.5">
            <Layers size={14} className="text-indigo-400" />
            <span className="text-sm font-black uppercase tracking-[0.15em] text-slate-400">
              🏛️ INSTITUTIONAL MACRO ENGINE · LAYER 17
            </span>
          </div>
          <span
            className={`text-xs font-black font-mono uppercase px-2 py-0.5 rounded border tracking-wide ${
              biasColors[macroResult.institutionalBias]
            }`}
          >
            BIAS: {macroResult.institutionalBias}
          </span>
        </div>

        {/* ── CONTENT GRID ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
          {/* LEFT COLUMN: Gauges, Flow, Score */}
          <div className="space-y-3.5 pr-0 md:pr-3 md:border-r border-slate-800/40 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Macro Metrics
              </span>
              <div className="grid grid-cols-3 gap-2">
                {/* Combined Flow */}
                <div className="col-span-2 px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-[9px] text-slate-500 uppercase font-black">COMBINED NET FLOW</span>
                  <span
                    className={`text-sm font-black font-mono mt-1 ${
                      macroResult.netCombinedFlow > 0 ? "text-emerald-400" : macroResult.netCombinedFlow < 0 ? "text-red-400" : "text-amber-400"
                    }`}
                  >
                    {macroResult.netCombinedFlow > 0 ? "+" : ""}
                    {macroResult.netCombinedFlow.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Cr
                  </span>
                </div>

                {/* Macro Score */}
                <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-[9px] text-slate-500 uppercase font-black">MACRO SCORE</span>
                  <span
                    className={`text-sm font-black font-mono mt-1 ${
                      macroResult.macroScore >= 60 ? "text-emerald-400" : macroResult.macroScore <= 40 ? "text-red-400" : "text-amber-400"
                    }`}
                  >
                    {macroResult.macroScore}
                  </span>
                </div>
              </div>
            </div>

            {/* FII and DII breakdown */}
            <div className="grid grid-cols-2 gap-2">
              <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase font-black block">FII NET FLOW</span>
                <span
                  className={`text-xs font-bold font-mono mt-0.5 block ${
                    macroResult.fiiNetCash > 0 ? "text-emerald-400" : macroResult.fiiNetCash < 0 ? "text-red-400" : "text-slate-400"
                  }`}
                >
                  {macroResult.fiiNetCash > 0 ? "+" : ""}
                  {macroResult.fiiNetCash.toFixed(1)} Cr
                </span>
              </div>
              <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase font-black block">DII NET FLOW</span>
                <span
                  className={`text-xs font-bold font-mono mt-0.5 block ${
                    macroResult.diiNetCash > 0 ? "text-emerald-400" : macroResult.diiNetCash < 0 ? "text-red-400" : "text-slate-400"
                  }`}
                >
                  {macroResult.diiNetCash > 0 ? "+" : ""}
                  {macroResult.diiNetCash.toFixed(1)} Cr
                </span>
              </div>
            </div>

            {/* Reasons Ledger */}
            <div className="space-y-1 bg-slate-950/40 border border-slate-900 rounded-lg p-2 max-h-[80px] overflow-y-auto flex-1">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                Institutional Macro Rationale
              </span>
              {macroResult.reasons.map((reason, idx) => (
                <div key={idx} className="text-[10px] font-medium text-slate-400 flex items-start gap-1 leading-normal">
                  <span className="text-slate-600">•</span>
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT COLUMN: Form & Mini History */}
          <div className="flex flex-col justify-between space-y-3">
            {/* Manual entry form */}
            <form onSubmit={handleSubmit} className="space-y-2 bg-slate-900/20 border border-slate-800/40 rounded-lg p-2.5">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                Manual Macro Input
              </span>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase block mb-0.5">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase block mb-0.5">FII Cash (Cr)</label>
                  <input
                    type="number"
                    value={fiiCash}
                    onChange={(e) => setFiiCash(e.target.value)}
                    placeholder="e.g. -250"
                    className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase block mb-0.5">DII Cash (Cr)</label>
                  <input
                    type="number"
                    value={diiCash}
                    onChange={(e) => setDiiCash(e.target.value)}
                    placeholder="e.g. 1100"
                    className="w-full bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                {error && (
                  <span className="text-[9px] text-red-400 font-bold max-w-[65%] truncate" title={error}>
                    {error}
                  </span>
                )}
                {success && (
                  <span className="text-[9px] text-emerald-400 font-bold animate-pulse">
                    Saved Successfully!
                  </span>
                )}
                {!error && !success && <span />}

                <button
                  type="submit"
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-[10px] font-bold text-white uppercase px-3 py-1 rounded transition duration-150 flex items-center gap-1"
                >
                  {loading ? "Saving..." : "Save Flow"}
                </button>
              </div>
            </form>

            {/* Mini History Table */}
            <div className="flex-1 bg-slate-950/20 border border-slate-800/40 rounded-lg p-2 flex flex-col justify-between max-h-[85px] overflow-y-auto">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                Macro History (Recent Logs)
              </span>
              <div className="flex-1 space-y-1">
                {fiiDiiHistory.length === 0 ? (
                  <span className="text-[9px] text-slate-650 italic block py-2 text-center">No entries found</span>
                ) : (
                  fiiDiiHistory.slice(0, 3).map((hist, idx) => {
                    const combined = hist.fii_cash + hist.dii_cash;
                    return (
                      <div key={idx} className="flex items-center justify-between text-[9px] font-mono border-b border-slate-800/20 pb-0.5 last:border-0 last:pb-0">
                        <span className="text-slate-500">{hist.date}</span>
                        <div className="flex gap-2">
                          <span className={hist.fii_cash >= 0 ? "text-emerald-450" : "text-red-455"}>
                            FII: {hist.fii_cash >= 0 ? "+" : ""}{hist.fii_cash}
                          </span>
                          <span className={hist.dii_cash >= 0 ? "text-emerald-450" : "text-red-455"}>
                            DII: {hist.dii_cash >= 0 ? "+" : ""}{hist.dii_cash}
                          </span>
                          <span className={`font-bold ${combined >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {combined >= 0 ? "▲" : "▼"} {Math.abs(combined)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstitutionalMacroCard;
