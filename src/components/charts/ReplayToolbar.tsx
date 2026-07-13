import React, { useState } from "react";
import { Play, Pause, SkipForward, SkipBack, Shield, Clock, Eye, AlertTriangle } from "lucide-react";

export interface ReplayToolbarProps {
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  isActive: boolean;
  onToggleReplay: (active: boolean) => void;
  onPlay: () => void;
  onPause: () => void;
  onStep: (direction: "FORWARD" | "BACKWARD") => void;
  onSpeedChange: (speed: number) => void;
  onModeChange: (mode: "CANDLE" | "TICK") => void;
  onDateChange: (start: string, end: string) => void;
  currentVirtualTimeStr?: string;
  speed: number;
  mode: "CANDLE" | "TICK";
}

export const ReplayToolbar: React.FC<ReplayToolbarProps> = ({
  index,
  isActive,
  onToggleReplay,
  onPlay,
  onPause,
  onStep,
  onSpeedChange,
  onModeChange,
  onDateChange,
  currentVirtualTimeStr = "09:15:00 AM IST",
  speed,
  mode
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [startDate, setStartDate] = useState("2026-05-25T09:15");
  const [endDate, setEndDate] = useState("2026-05-25T15:30");

  const speeds = [1, 2, 5, 10, 25, 50, 100, 500, 1000];

  const handleToggle = () => {
    onToggleReplay(!isActive);
    if (isPlaying) {
      onPause();
      setIsPlaying(false);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    onPlay();
  };

  const handlePause = () => {
    setIsPlaying(false);
    onPause();
  };

  const handleStep = (dir: "FORWARD" | "BACKWARD") => {
    setIsPlaying(false);
    onStep(dir);
  };

  const handleInit = () => {
    const startUnix = new Date(startDate).getTime();
    const endUnix = new Date(endDate).getTime();
    if (isNaN(startUnix) || isNaN(endUnix)) {
      alert("Invalid Replay Date range!");
      return;
    }
    onDateChange(startDate, endDate);
  };

  return (
    <div className="flex-shrink-0 flex items-center justify-between border border-slate-850 bg-[#070b13] px-3.5 py-2 rounded-xl text-slate-100 gap-3 flex-wrap relative z-30 shadow-2xl">
      
      {/* Active Indicator / Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
            isActive
              ? "bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30"
              : "bg-slate-900 border-slate-850 text-slate-400 hover:text-slate-200"
          }`}
        >
          <Clock size={12} className={isActive ? "animate-pulse" : ""} />
          <span>{isActive ? "VIRTUAL REPLAY: ACTIVE" : "SIMULATE REPLAY"}</span>
        </button>
        {isActive && (
          <span className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded text-[10px] font-bold">
            <AlertTriangle size={10} />
            <span>Future Data Blocked</span>
          </span>
        )}
      </div>

      {isActive && (
        <>
          {/* Virtual Date Selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
              <span className="font-bold text-slate-500">START:</span>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-blue-500 text-[10px]"
              />
            </div>
            <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
              <span className="font-bold text-slate-500">END:</span>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-950 border border-slate-850 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none focus:border-blue-500 text-[10px]"
              />
            </div>
            <button
              onClick={handleInit}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] px-2.5 py-1 rounded"
            >
              LOAD HISTORY
            </button>
          </div>

          {/* Clock controls */}
          <div className="flex items-center gap-1.5 bg-slate-950/60 p-1 border border-slate-850 rounded-lg">
            <button
              onClick={() => handleStep("BACKWARD")}
              title="Step Backward (1s)"
              className="p-1.5 rounded hover:bg-slate-800 text-slate-450 hover:text-slate-100 transition-colors"
            >
              <SkipBack size={13} />
            </button>

            {isPlaying ? (
              <button
                onClick={handlePause}
                title="Pause Replay"
                className="p-1.5 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all"
              >
                <Pause size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handlePlay}
                title="Play Replay"
                className="p-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all"
              >
                <Play size={13} fill="currentColor" />
              </button>
            )}

            <button
              onClick={() => handleStep("FORWARD")}
              title="Step Forward (1s)"
              className="p-1.5 rounded hover:bg-slate-800 text-slate-455 hover:text-slate-100 transition-colors"
            >
              <SkipForward size={13} />
            </button>
          </div>

          {/* Mode Selector */}
          <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 border border-slate-850 rounded-lg">
            <button
              onClick={() => onModeChange("CANDLE")}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${
                mode === "CANDLE" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Candle Replay
            </button>
            <button
              onClick={() => onModeChange("TICK")}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${
                mode === "TICK" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Tick Replay
            </button>
          </div>

          {/* Replay Time Clock */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-850 px-2.5 py-1.5 rounded-lg text-xs font-mono">
            <span className="text-[10px] text-slate-500 font-sans font-black uppercase">Clock:</span>
            <span className="font-extrabold text-blue-400">{currentVirtualTimeStr}</span>
          </div>

          {/* Speed Selector */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-black uppercase text-slate-500">Speed:</span>
            <div className="flex bg-slate-950/60 p-0.5 border border-slate-850 rounded-lg overflow-x-auto max-w-[140px] md:max-w-none">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => onSpeedChange(s)}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${
                    speed === s ? "bg-slate-800 text-teal-400 font-extrabold" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
export default ReplayToolbar;
