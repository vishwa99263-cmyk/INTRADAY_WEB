import React, { useMemo } from "react";
import { Brain, Zap, TrendingUp, Activity, Globe, Shield } from "lucide-react";
import type { AiBrainResult } from "../../../engine/aiBrainEngine";

interface Props {
  aiBrainResult?: AiBrainResult;
  macroSentimentScore?: number;
}

const CognitiveMatrixCard: React.FC<Props> = ({ aiBrainResult, macroSentimentScore = 50 }) => {
  const {
    convictionScore = 0,
    brainState = "COOLDOWN",
    ceVoteTotal = 0,
    peVoteTotal = 0,
    ceVoterCount = 0,
    peVoterCount = 0,
    neutralVoterCount = 0
  } = aiBrainResult || {};

  // Derive scores for the 4 pillars (0-100)
  const trendScore = useMemo(() => {
    const total = ceVoteTotal + peVoteTotal;
    if (total === 0) return 50;
    return Math.round((Math.max(ceVoteTotal, peVoteTotal) / total) * 100);
  }, [ceVoteTotal, peVoteTotal]);

  const flowScore = useMemo(() => {
    const activeVoters = ceVoterCount + peVoterCount;
    const totalVoters = activeVoters + neutralVoterCount;
    if (totalVoters === 0) return 0;
    return Math.round((activeVoters / totalVoters) * 100);
  }, [ceVoterCount, peVoterCount, neutralVoterCount]);

  const macroScore = Math.round(macroSentimentScore);
  const convScore = Math.round(convictionScore);

  const pillars = [
    { name: "TREND ALIGN", score: trendScore, icon: <TrendingUp size={14} />, color: trendScore > 60 ? "text-emerald-400" : trendScore < 40 ? "text-red-400" : "text-amber-400", bg: "bg-indigo-500", textFill: "text-indigo-400" },
    { name: "OPTION FLOW", score: flowScore, icon: <Activity size={14} />, color: flowScore > 60 ? "text-emerald-400" : "text-amber-400", bg: "bg-blue-500", textFill: "text-blue-400" },
    { name: "MACRO SENTIMENT", score: macroScore, icon: <Globe size={14} />, color: macroScore > 60 ? "text-emerald-400" : macroScore < 40 ? "text-red-400" : "text-amber-400", bg: "bg-purple-500", textFill: "text-purple-400" },
    { name: "CONVICTION", score: convScore, icon: <Zap size={14} />, color: convScore > 75 ? "text-emerald-400" : convScore > 50 ? "text-amber-400" : "text-slate-400", bg: "bg-fuchsia-500", textFill: "text-fuchsia-400" }
  ];

  const getBrainStateColor = () => {
    switch (brainState) {
      case "AGGRESSIVE": return "text-red-500 bg-red-500/10 border-red-500/30";
      case "CONSERVATIVE": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
      case "LEARNING": return "text-blue-400 bg-blue-500/10 border-blue-500/30";
      case "LOCKED": return "text-amber-400 bg-amber-500/10 border-amber-500/30";
      default: return "text-slate-400 bg-slate-500/10 border-slate-500/30";
    }
  };

  return (
    <div className="bg-slate-950/80 border border-slate-800/60 rounded-xl overflow-hidden relative">
      {/* Cybernetic Background grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        opacity: 0.5
      }} />

      <div className="p-4 relative z-10 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-slate-900/80 to-transparent">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Brain size={18} className="text-indigo-400 relative z-10" />
            <div className="absolute inset-0 bg-indigo-500/30 blur-md rounded-full animate-pulse" />
          </div>
          <span className="font-black text-white tracking-widest text-sm uppercase">Cognitive Matrix</span>
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border flex items-center gap-1 ${getBrainStateColor()}`}>
          <Shield size={10} />
          {brainState}
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4">
        {pillars.map((p, idx) => (
          <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 relative overflow-hidden group">
            {/* Glowing orb effect on hover */}
            <div className={`absolute -right-4 -top-4 w-16 h-16 ${p.bg} opacity-10 rounded-full blur-xl group-hover:opacity-20 transition-all duration-500`} />
            
            <div className="flex justify-between items-start mb-3 relative z-10">
              <div className="flex items-center gap-1.5">
                <span className={p.textFill}>{p.icon}</span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{p.name}</span>
              </div>
              <span className={`text-lg font-black ${p.color} font-mono leading-none`}>{p.score}<span className="text-[10px] text-slate-500">%</span></span>
            </div>
            
            {/* Custom Progress Track */}
            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 relative z-10">
              <div 
                className={`h-full rounded-full transition-all duration-1000 ease-out relative ${p.bg}`}
                style={{ width: `${p.score}%` }}
              >
                <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/30 blur-[2px]" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Neural Link Status */}
      <div className="px-4 py-2 border-t border-slate-800/60 bg-slate-900/30 flex justify-between items-center relative z-10">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[9px] text-slate-500 uppercase font-mono tracking-widest">Neural Link Active</span>
        </div>
        <div className="text-[9px] text-indigo-400/50 font-mono">SYNCS: {ceVoterCount + peVoterCount + neutralVoterCount} NODES</div>
      </div>
    </div>
  );
};

export default CognitiveMatrixCard;
