import React from "react";

interface MarketDirSignals {
  netOverall: number;
  net5m: number;
  net15m: number;
  posBreath: number;
  negBreath: number;
  posToNegCount: number;
  negToPosCount: number;
}

interface MarketDir {
  status: "BULLISH" | "MILD_BULLISH" | "NEUTRAL" | "MILD_BEARISH" | "BEARISH";
  score: number;
  confidence: number;
  allowCE: boolean;
  allowPE: boolean;
  netShiftScore: number;
  signals: MarketDirSignals;
}

interface SummaryBoxesHeaderProps {
  isSensex: boolean;
  currentHighs: { posHigh: number; negLow: number; netHigh: number; netLow: number };
  livePos: number;
  liveNeg: number;
  todayOpen?: number;
  previousClose?: number;
  sensexOpen?: number;
  sensexPrev?: number;
  adjustFont: (amount: number) => void;
  darkMode: boolean;
  marketDir?: MarketDir;
}

export default function SummaryBoxesHeader({
  isSensex,
  currentHighs,
  livePos,
  liveNeg,
  todayOpen,
  previousClose,
  sensexOpen,
  sensexPrev,
  adjustFont,
  darkMode,
  marketDir
}: SummaryBoxesHeaderProps) {

  // Nifty Gap Analysis
  const niftyGapPoints = todayOpen !== undefined && previousClose !== undefined ? todayOpen - previousClose : 0;
  let niftyStatus = "";
  let niftyBoxClass = "";
  let niftyTextClass = "";
  if (niftyGapPoints > 15) {
    niftyStatus = "GAP UP 🔼";
    niftyBoxClass = "bg-green-950/80 border border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.15)]";
    niftyTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(74,222,128,0.4)]";
  } else if (niftyGapPoints < -15) {
    niftyStatus = "GAP DOWN 🔽";
    niftyBoxClass = "bg-red-950/80 border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]";
    niftyTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(248,113,113,0.4)]";
  } else {
    niftyStatus = "FLAT OPEN ➖";
    niftyBoxClass = "bg-[#050914] border border-white/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]";
    niftyTextClass = "text-slate-300";
  }

  // Sensex Gap Analysis
  const sensexGapPoints = sensexOpen !== undefined && sensexPrev !== undefined ? sensexOpen - sensexPrev : 0;
  let sensexStatus = "";
  let sensexBoxClass = "";
  let sensexTextClass = "";
  if (sensexGapPoints > 15) {
    sensexStatus = "GAP UP 🔼";
    sensexBoxClass = "bg-green-950/80 border border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.15)]";
    sensexTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(74,222,128,0.4)]";
  } else if (sensexGapPoints < -15) {
    sensexStatus = "GAP DOWN 🔽";
    sensexBoxClass = "bg-red-950/80 border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.15)]";
    sensexTextClass = "text-white font-bold drop-shadow-[0_0_5px_rgba(248,113,113,0.4)]";
  } else {
    sensexStatus = "FLAT OPEN ➖";
    sensexBoxClass = "bg-[#050914] border border-white/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]";
    sensexTextClass = "text-slate-300";
  }

  const posDiff = currentHighs.posHigh - livePos;
  const negDiff = currentHighs.negLow - liveNeg;

  return (
    <div className="flex justify-between items-center px-2 py-1 select-none border-b dark:border-slate-800/40 border-slate-200/60 mb-1 flex-nowrap overflow-x-auto scrollbar-none gap-2">
      <div className="flex items-center gap-2 flex-nowrap flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-455 font-sans">
            Score Summary Boxes Desk
          </span>
        </div>
        
        <div className="h-3.5 w-[1px] bg-slate-200 dark:bg-slate-800 flex-shrink-0 mx-0.5" />
        
        {/* Compact Overall Current & Highest Scores */}
        <div className="flex items-center gap-2.5 text-[9px] md:text-[9.5px] font-black font-mono select-none flex-nowrap flex-shrink-0">
          <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-0.5">
            <span>▲</span>
            <span>{posDiff === 0 ? "0" : `-${parseFloat(posDiff.toFixed(2))}`}</span>
            <span className="text-emerald-600 dark:text-emerald-350 font-black ml-1 text-[11px]">
              (DH: +{currentHighs.posHigh})
            </span>
          </span>
          
          <span className="text-slate-300 dark:text-slate-700 font-normal">|</span>
          
          <span className="text-indigo-500 dark:text-indigo-400 flex items-center gap-0.5">
            <span>{isSensex ? "T-22" : "T-25"}</span>
            <span className="font-black ml-1 text-[11px] text-slate-400 dark:text-slate-600">
              (
              <span className="text-emerald-500 dark:text-emerald-400">
                DH: {currentHighs.netHigh === -999 ? "0" : (currentHighs.netHigh > 0 ? `+${currentHighs.netHigh}` : currentHighs.netHigh)}
              </span>
              <span className="mx-1">|</span>
              <span className="text-rose-500 dark:text-rose-400">
                DL: {currentHighs.netLow === 999 ? "0" : (currentHighs.netLow > 0 ? `+${currentHighs.netLow}` : currentHighs.netLow)}
              </span>
              )
            </span>
          </span>
          
          <span className="text-slate-300 dark:text-slate-700 font-normal">|</span>
          
          <span className="text-rose-500 dark:text-rose-400 flex items-center gap-0.5">
            <span>▼</span>
            <span>{negDiff === 0 ? "0" : (negDiff > 0 ? `+${parseFloat(negDiff.toFixed(2))}` : parseFloat(negDiff.toFixed(2)))}</span>
            <span className="text-rose-600 dark:text-rose-350 font-black ml-1 text-[11px]">
              (DL: {currentHighs.negLow})
            </span>
          </span>
        </div>
      </div>

      {/* Toolbar Right Side */}
      <div className="flex items-center gap-2 flex-nowrap justify-end flex-shrink-0">

        {/* ── Market Health Widget ─────────────────────────────────── */}
        {marketDir && (() => {
          const { status, score, confidence, signals } = marketDir;

          const statusConfig = {
            BULLISH:      { label: "BULLISH",      icon: "🟢", bg: "bg-emerald-950/80 border-emerald-500/40", text: "text-emerald-400", glow: "shadow-[0_0_10px_rgba(16,185,129,0.3)]" },
            MILD_BULLISH: { label: "MILD BULL",    icon: "🔼", bg: "bg-emerald-950/50 border-emerald-700/30", text: "text-emerald-500", glow: "" },
            NEUTRAL:      { label: "NEUTRAL",      icon: "◆",  bg: "bg-slate-900/80 border-slate-700/40",    text: "text-slate-400",   glow: "" },
            MILD_BEARISH: { label: "MILD BEAR",    icon: "🔽", bg: "bg-red-950/50 border-red-700/30",        text: "text-rose-500",   glow: "" },
            BEARISH:      { label: "BEARISH",      icon: "🔴", bg: "bg-red-950/80 border-red-500/40",        text: "text-rose-400",   glow: "shadow-[0_0_10px_rgba(244,63,94,0.3)]" },
          }[status];

          const posToNeg = signals.posToNegCount ?? 0;
          const negToPos = signals.negToPosCount ?? 0;
          const hasShift = posToNeg > 0 || negToPos > 0;

          return (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[9px] font-black tracking-wider select-none transition-all duration-500 flex-shrink-0 ${statusConfig.bg} ${statusConfig.glow}`}>
              {/* Status Icon + Label */}
              <span className={`${statusConfig.text} flex items-center gap-0.5`}>
                <span>{statusConfig.icon}</span>
                <span>{statusConfig.label}</span>
              </span>

              <span className="text-slate-600">|</span>

              {/* Score */}
              <span className={`font-mono font-black ${statusConfig.text}`}>
                {score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2)}
              </span>

              <span className="text-slate-600">|</span>

              {/* Breadth */}
              <span className="text-slate-400 font-mono">
                <span className="text-emerald-500">{signals.posBreath.toFixed(0)}%</span>
                <span className="text-slate-600">/</span>
                <span className="text-rose-500">{signals.negBreath.toFixed(0)}%</span>
              </span>

              {/* Sentiment Shift Alert */}
              {hasShift && (
                <>
                  <span className="text-slate-600">|</span>
                  <span className={`font-mono animate-pulse ${posToNeg > negToPos ? "text-rose-400" : "text-emerald-400"}`}>
                    {posToNeg > 0 ? `⚠️${posToNeg}↓` : ""}
                    {negToPos > 0 ? `✅${negToPos}↑` : ""}
                  </span>
                </>
              )}
            </div>
          );
        })()}

        {/* Nifty Opening Status Badge */}
        {todayOpen !== undefined && previousClose !== undefined && (
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider select-none transition-all duration-300 flex-shrink-0 ${niftyBoxClass}`}>
            <span className={Math.abs(niftyGapPoints) > 15 ? "text-white/70" : "text-slate-400"}>NIFTY -</span>
            <span className={niftyTextClass}>
              {niftyStatus} {niftyGapPoints > 0 ? "+" : ""}{niftyGapPoints.toFixed(2)}
            </span>
          </div>
        )}

        {/* Sensex Opening Status Badge */}
        {sensexOpen !== undefined && sensexPrev !== undefined && (
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider select-none transition-all duration-300 flex-shrink-0 ${sensexBoxClass}`}>
            <span className={Math.abs(sensexGapPoints) > 15 ? "text-white/70" : "text-slate-400"}>SENSEX -</span>
            <span className={sensexTextClass}>
              {sensexStatus} {sensexGapPoints > 0 ? "+" : ""}{sensexGapPoints.toFixed(2)}
            </span>
          </div>
        )}

        {/* Spreadsheet-grade Toolbar Font Sizer */}
        <div className={`flex items-center gap-1.5 border rounded-lg px-2 py-0.5 select-none scale-90 transition-all flex-shrink-0 ${
          darkMode 
            ? "bg-[#0e1628]/90 border-[#263756]/80 text-slate-200" 
            : "bg-slate-100/90 border-slate-200/80 text-slate-700 shadow-sm"
        }`}>
          <button 
            onClick={() => adjustFont(-1)} 
            className="hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors font-black px-1.5 text-xs cursor-pointer select-none"
            title="Decrease Sizing"
          >
            &minus;
          </button>
          <div className="h-3 w-[1px] dark:bg-slate-800/60 bg-slate-200" />
          <span className="text-[8px] opacity-75 font-black uppercase tracking-wider font-sans">FONT</span>
          <div className="h-3 w-[1px] dark:bg-slate-800/60 bg-slate-200" />
          <button 
            onClick={() => adjustFont(1)} 
            className="hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors font-black px-1.5 text-xs cursor-pointer select-none"
            title="Increase Sizing"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

