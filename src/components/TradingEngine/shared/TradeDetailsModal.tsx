import React from "react";
import { X, Info, Shield, Target } from "lucide-react";

interface TradeDetailsModalProps {
  trade: any;
  onClose: () => void;
  darkMode?: boolean;
}

export default function TradeDetailsModal({ trade, onClose, darkMode = true }: TradeDetailsModalProps) {
  if (!trade) return null;

  const isCE = trade.direction === "BUY_CE" || trade.direction === "CE";
  const badgeBg = isCE
    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
    : "bg-red-500/10 border-red-500/20 text-red-400";

  let isJson = false;
  let parsedNotes: any = null;
  try {
    if (trade.notes && trade.notes.trim().startsWith("{")) {
      parsedNotes = JSON.parse(trade.notes);
      isJson = true;
    }
  } catch (e) {}

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none animate-fade-in">
      <div 
        className="w-full max-w-lg p-6 rounded-2xl border shadow-2xl relative flex flex-col gap-4 text-white"
        style={{
          background: "linear-gradient(135deg, #03050a 0%, #060a14 55%, #03050a 100%)",
          borderColor: "rgba(255,255,255,0.08)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
        }}
      >
        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-teal-500 via-indigo-500 to-purple-500 rounded-t-2xl" />

        {/* Close button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer transition-colors"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2 pb-2 border-b border-slate-900/60">
          <Info size={16} className="text-teal-455" />
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-300">
            TRADE EXECUTION AUDIT DETAILS
          </h2>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-slate-955/40 p-3 rounded-lg border border-slate-900">
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Trade ID:</span>
            <span className="text-slate-350 truncate" title={trade.id}>{trade.id}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Instrument:</span>
            <span className="text-slate-200 font-extrabold">{trade.instrument}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Option Type:</span>
            <span className={`px-1.5 py-0.5 rounded border inline-block text-center font-black ${badgeBg}`} style={{ width: 'fit-content' }}>
              {trade.direction.replace("BUY_", "")}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Strike Price:</span>
            <span className="text-white font-extrabold">{trade.strike}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Entry Price:</span>
            <span className="text-white font-bold">₹{trade.entry_price.toFixed(1)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">LTP / Exit:</span>
            <span className="text-blue-400 font-bold">₹{(trade.currentPremium ?? trade.exit_price ?? trade.entry_price).toFixed(1)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Lot Size / Qty:</span>
            <span className="text-slate-355">{trade.qty} × {trade.lot_size} ({trade.qty * trade.lot_size} Qty)</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Current Status:</span>
            <span className={`font-black uppercase ${trade.status === "OPEN" ? "text-amber-400 animate-pulse" : "text-slate-400"}`}>
              {trade.status}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Signal Category / Type:</span>
            <span className="text-teal-400 font-extrabold uppercase">{trade.strategyName || "MANUAL"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Execution Mode:</span>
            <span className="text-indigo-400 font-extrabold uppercase">{trade.signal_ref || "MANUAL"}</span>
          </div>
        </div>

        {/* SL & Target */}
        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          <div className="p-2.5 rounded-lg border border-slate-900 bg-red-955/5 flex flex-col gap-1">
            <div className="flex items-center gap-1 text-rose-400 font-bold">
              <Shield size={12} />
              <span>STOP LOSS</span>
            </div>
            <span className="text-white font-black text-sm">₹{trade.stop_loss.toFixed(1)}</span>
            <span className="text-[10px] text-slate-550">Premium Exit Target</span>
          </div>
          <div className="p-2.5 rounded-lg border border-slate-900 bg-emerald-955/5 flex flex-col gap-1">
            <div className="flex items-center gap-1 text-emerald-400 font-bold">
              <Target size={12} />
              <span>TAKE PROFIT</span>
            </div>
            <span className="text-white font-black text-sm">₹{trade.target.toFixed(1)}</span>
            <span className="text-[10px] text-slate-550">Premium Exit Target</span>
          </div>
        </div>

        {/* Execution Rules & Conditions */}
        {isJson ? (
          <>
            {/* Structured Indicators Grid */}
            <div className="flex flex-col gap-1 font-mono text-[9px]">
              <span className="text-slate-500 uppercase font-bold">Execution Market Indicators:</span>
              <div 
                className="grid grid-cols-4 gap-2 p-2 rounded-lg border bg-slate-950/20 text-xs text-slate-300"
                style={{ borderColor: "rgba(255,255,255,0.05)" }}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">Regime</span>
                  <span className="text-teal-400 font-extrabold truncate" title={parsedNotes.metrics?.regime ?? "UNKNOWN"}>{parsedNotes.metrics?.regime ?? "UNKNOWN"}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">Breadth Score</span>
                  <span className="text-sky-400 font-extrabold">{parsedNotes.metrics?.breadth ?? "N/A"}%</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">Momentum</span>
                  <span className="text-indigo-400 font-extrabold">{parsedNotes.metrics?.momentum ?? "N/A"}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">PCR Ratio</span>
                  <span className="text-amber-400 font-extrabold">{parsedNotes.metrics?.pcr ?? "N/A"}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">Probability</span>
                  <span className="text-emerald-400 font-extrabold">{parsedNotes.metrics?.probability ?? "N/A"}%</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">VIX / Volatility</span>
                  <span className="text-pink-400 font-extrabold">{parsedNotes.metrics?.volatility ?? "N/A"}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">Bullish Score</span>
                  <span className="text-emerald-400 font-extrabold">{parsedNotes.metrics?.bullishScore !== undefined ? `${parsedNotes.metrics.bullishScore}%` : "N/A"}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 uppercase font-black text-[8px]">Bearish Score</span>
                  <span className="text-rose-400 font-extrabold">{parsedNotes.metrics?.bearishScore !== undefined ? `${parsedNotes.metrics.bearishScore}%` : "N/A"}</span>
                </div>
              </div>
            </div>

            {/* Structural / Price Levels at Execution */}
            {parsedNotes.metrics && (parsedNotes.metrics.spot !== undefined || parsedNotes.metrics.callWall !== undefined || parsedNotes.metrics.putWall !== undefined) && (
              <div className="flex flex-col gap-1 font-mono text-[9px]">
                <span className="text-slate-500 uppercase font-bold">Execution Structural Levels:</span>
                <div 
                  className="grid grid-cols-3 gap-2 p-2 rounded-lg border bg-slate-950/20 text-xs text-slate-300"
                  style={{ borderColor: "rgba(255,255,255,0.05)" }}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Index Spot</span>
                    <span className="text-white font-extrabold">₹{parsedNotes.metrics.spot?.toLocaleString("en-IN", { maximumFractionDigits: 1 }) ?? "N/A"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Put Wall (Sup)</span>
                    <span className="text-emerald-400 font-extrabold">₹{parsedNotes.metrics.putWall ?? "N/A"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Call Wall (Res)</span>
                    <span className="text-rose-400 font-extrabold">₹{parsedNotes.metrics.callWall ?? "N/A"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">5m Low / High</span>
                    <span className="text-slate-350 truncate">
                      {parsedNotes.metrics.low5m > 0 ? `₹${parsedNotes.metrics.low5m.toFixed(0)}` : "N/A"} / {parsedNotes.metrics.high5m > 0 ? `₹${parsedNotes.metrics.high5m.toFixed(0)}` : "N/A"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">15m Low / High</span>
                    <span className="text-slate-350 truncate">
                      {parsedNotes.metrics.low15m > 0 ? `₹${parsedNotes.metrics.low15m.toFixed(0)}` : "N/A"} / {parsedNotes.metrics.high15m > 0 ? `₹${parsedNotes.metrics.high15m.toFixed(0)}` : "N/A"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Option Delta</span>
                    <span className="text-teal-400 font-extrabold">{parsedNotes.metrics.delta ? parsedNotes.metrics.delta.toFixed(2) : "N/A"}</span>
                  </div>
                </div>
              </div>
            )}
            {/* Advanced Execution Dynamics (Speed, Buildup, Breadth Ratio) */}
            {parsedNotes.metrics && (parsedNotes.metrics.velocity !== undefined || parsedNotes.metrics.netCeBuildup !== undefined || parsedNotes.metrics.advances !== undefined) && (
              <div className="flex flex-col gap-1 font-mono text-[9px]">
                <span className="text-slate-500 uppercase font-bold">Advanced Execution Dynamics:</span>
                <div 
                  className="grid grid-cols-3 gap-2 p-2 rounded-lg border bg-slate-950/20 text-xs text-slate-300"
                  style={{ borderColor: "rgba(255,255,255,0.05)" }}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Price Velocity</span>
                    <span className="text-teal-400 font-extrabold">{parsedNotes.metrics.velocity?.toFixed(1) ?? "N/A"} pts/sec</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Speed Grade</span>
                    <span className="text-indigo-400 font-extrabold uppercase">
                      {parsedNotes.metrics.priceActionGrade ?? "N/A"} ({parsedNotes.metrics.marketState?.replace("_MARKET", "") ?? "N/A"})
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Market Breadth</span>
                    <span className="text-sky-400 font-extrabold">
                      ▲{parsedNotes.metrics.advances ?? "N/A"} / ▼{parsedNotes.metrics.declines ?? "N/A"}
                    </span>
                  </div>
                  <div className="flex flex-col col-span-3 gap-0.5 pt-1 border-t border-slate-900/60">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Option Chain Buildup Dynamics</span>
                    <span className="text-amber-400 font-bold uppercase text-[10px]">
                      CE: {parsedNotes.metrics.netCeBuildup?.replace(/_/g, " ") ?? "N/A"} | PE: {parsedNotes.metrics.netPeBuildup?.replace(/_/g, " ") ?? "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {/* Option Greeks at Execution */}
            {parsedNotes.metrics && (parsedNotes.metrics.gamma !== undefined || parsedNotes.metrics.theta !== undefined || parsedNotes.metrics.iv !== undefined) && (
              <div className="flex flex-col gap-1 font-mono text-[9px]">
                <span className="text-slate-500 uppercase font-bold">Option Greeks at Execution:</span>
                <div 
                  className="grid grid-cols-4 gap-2 p-2 rounded-lg border bg-slate-950/20 text-xs text-slate-300"
                  style={{ borderColor: "rgba(255,255,255,0.05)" }}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Delta (Δ)</span>
                    <span className="text-teal-400 font-extrabold">{parsedNotes.metrics.delta ? parsedNotes.metrics.delta.toFixed(2) : "N/A"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Gamma (Γ)</span>
                    <span className="text-indigo-400 font-extrabold">{parsedNotes.metrics.gamma ? parsedNotes.metrics.gamma.toFixed(4) : "N/A"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Theta (Θ)</span>
                    <span className="text-rose-400 font-extrabold">{parsedNotes.metrics.theta ? parsedNotes.metrics.theta.toFixed(1) : "N/A"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Vega (V)</span>
                    <span className="text-sky-400 font-extrabold">{parsedNotes.metrics.vega ? parsedNotes.metrics.vega.toFixed(1) : "N/A"}</span>
                  </div>
                  <div className="flex flex-col col-span-4 gap-0.5 pt-1 border-t border-slate-900/60">
                    <span className="text-slate-500 uppercase font-black text-[8px]">Implied Volatility (IV)</span>
                    <span className="text-amber-400 font-bold text-[10px]">
                      {parsedNotes.metrics.iv !== undefined ? `${(parsedNotes.metrics.iv * (parsedNotes.metrics.iv < 1.0 ? 100 : 1)).toFixed(1)}%` : "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Strategy Alignment Row */}
            <div className="flex flex-col gap-1 font-mono text-[9px]">
              <span className="text-slate-500 uppercase font-bold">Confirming Strategies / Layers:</span>
              <div 
                className="p-2 rounded-lg border bg-slate-950/20 text-xs flex flex-wrap gap-1"
                style={{ borderColor: "rgba(255,255,255,0.05)" }}
              >
                {Array.isArray(parsedNotes.metrics?.alignment) && parsedNotes.metrics.alignment.length > 0 ? (
                  parsedNotes.metrics.alignment.map((strat: string, idx: number) => (
                    <span 
                      key={idx} 
                      className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold text-[9px] uppercase tracking-wider"
                    >
                      {strat.replace(/_/g, " ")}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500 text-[10px] italic">
                    {typeof parsedNotes.metrics?.alignment === "number" 
                      ? `${parsedNotes.metrics.alignment} Strategy Aligned` 
                      : parsedNotes.metrics?.alignment ?? "N/A"}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 font-mono text-xs">
              <span className="text-slate-500 uppercase font-bold text-[9px]">Execution Reason / Notes:</span>
              <div 
                className="p-2.5 rounded-lg border text-slate-355 leading-relaxed max-h-[85px] overflow-y-auto whitespace-pre-line bg-slate-950/60"
                style={{ borderColor: "rgba(255,255,255,0.05)" }}
              >
                {parsedNotes.reason || "Manual placement — No automated trigger condition details recorded."}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5 font-mono text-xs">
            <span className="text-slate-500 uppercase font-bold text-[9px]">Execution Audit Reasoning & Conditions:</span>
            <div 
              className="p-3 rounded-lg border text-slate-300 leading-relaxed max-h-[140px] overflow-y-auto whitespace-pre-line bg-slate-950/60"
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              {trade.notes || "Manual placement — No automated trigger condition details recorded."}
            </div>
          </div>
        )}

        {/* P&L */}
        <div className="flex items-center justify-between border-t border-slate-900 pt-3 mt-1 font-mono text-sm font-bold">
          <span className="text-slate-400 uppercase">Trade P&L Result:</span>
          <span className={`text-base font-black ${
            (trade.livePnl ?? trade.pnl) >= 0 ? "text-emerald-400" : "text-rose-500"
          }`}>
            {(trade.livePnl ?? trade.pnl) >= 0 ? "+" : ""}₹{(trade.livePnl ?? trade.pnl).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>
    </div>
  );
}
