/**
 * SelfLearningPermissionCard.tsx
 * ═══════════════════════════════════════════════════════════════════════
 * AMEX v3.0 — Self-Learning Permission Card
 *
 * Yeh card sabse pehle dikhta hai jab SM Analyzer khulta hai.
 * User ko allow/deny karna hota hai.
 * 
 * Agar allow kiya:
 *   - Background mein analysis shuru ho jati hai
 *   - Tab change karo, minimize karo — kuch band nahi hoga
 *   - Server pe chalta rahega hamesha
 * 
 * Agar deny kiya:
 *   - Normal mode — sirf basic trading
 *   - Self-learning disabled
 */

import React, { useEffect, useState } from "react";
import { Brain, Zap, Shield, Clock, TrendingUp, Activity, CheckCircle, XCircle, RotateCcw, ChevronRight } from "lucide-react";

interface SelfLearningStatus {
  needsPermission:  boolean;
  isActive:         boolean;
  approvedAt:       number;
  lastRun:          number;
  pendingTrades:    number;
  insights?: {
    totalTrades:    number;
    overallWinRate: number;
    improvements:   string[];
  };
}

const API = (path: string) => {
  const isLocal = typeof window !== "undefined" &&
    (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${path}`;
};

interface Props {
  onDismiss: () => void;
}

export default function SelfLearningPermissionCard({ onDismiss }: Props) {
  const [status, setStatus]       = useState<SelfLearningStatus | null>(null);
  const [loading, setLoading]     = useState(true);
  const [approving, setApproving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(API("/api/te/self-learn/status"));
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ needsPermission: true, isActive: false, approvedAt: 0, lastRun: 0, pendingTrades: 0 });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await fetch(API("/api/te/self-learn/approve"), { method: "POST" });
      await fetchStatus();
      setTimeout(onDismiss, 1500);
    } catch {
      setApproving(false);
    }
  };

  const handleDeny = async () => {
    try {
      await fetch(API("/api/te/self-learn/deny"), { method: "POST" });
    } catch { /* ignore */ }
    onDismiss();
  };

  const handleReset = async () => {
    if (!confirm("Reset all AI learning data? This cannot be undone.")) return;
    try {
      await fetch(API("/api/te/self-learn/reset"), { method: "POST" });
      await fetchStatus();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="flex items-center gap-3 text-slate-300">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <span>Initializing AI...</span>
        </div>
      </div>
    );
  }

  // Already active — show mini status card
  if (status?.isActive && !status.needsPermission) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onDismiss}>
        <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl shadow-emerald-900/30"
          onClick={e => e.stopPropagation()}>
          
          {/* Glow orb */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-lg">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Self-Learning AI</h2>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 text-sm font-medium">Active & Learning</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-800/60 rounded-xl p-3 text-center">
              <div className="text-emerald-400 font-bold text-xl">{status.insights?.totalTrades ?? 0}</div>
              <div className="text-slate-500 text-xs mt-0.5">Trades Analyzed</div>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3 text-center">
              <div className="text-cyan-400 font-bold text-xl">{status.insights?.overallWinRate ?? "0.0"}%</div>
              <div className="text-slate-500 text-xs mt-0.5">Win Rate</div>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-3 text-center">
              <div className="text-violet-400 font-bold text-xl">{status.pendingTrades}</div>
              <div className="text-slate-500 text-xs mt-0.5">Open Trades</div>
            </div>
          </div>

          {status.insights?.improvements?.slice(-2).map((imp, i) => (
            <div key={i} className="text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2 mb-2 font-mono">
              {imp}
            </div>
          ))}

          <div className="flex gap-2 mt-4">
            <button
              onClick={onDismiss}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-sm transition-colors"
            >
              Continue Trading ✓
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl transition-colors"
              title="Reset learning data"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Permission request card
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md">
      <div className="relative bg-gradient-to-br from-slate-900 via-[#0f0f1a] to-slate-900 border border-violet-500/30 rounded-2xl p-7 max-w-lg w-full mx-4 shadow-2xl shadow-violet-900/40">
        
        {/* Animated glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-violet-600/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute bottom-0 right-0 w-32 h-32 bg-indigo-600/10 rounded-full blur-2xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center gap-4 mb-6 relative">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-violet-900/50">
              <Brain className="w-8 h-8 text-white" />
            </div>
            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">!</span>
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-0.5">AMEX v3.0</div>
            <h1 className="text-white font-bold text-2xl">Self-Learning AI</h1>
            <p className="text-violet-400 text-sm">wants to analyze your trades</p>
          </div>
        </div>

        {/* Description */}
        <p className="text-slate-400 text-sm leading-relaxed mb-5">
          Allow the AI to <span className="text-violet-300 font-medium">learn from every trade</span> you make.
          It will analyze which market conditions lead to wins and automatically
          <span className="text-emerald-400 font-medium"> adjust strategy weights</span> daily.
        </p>

        {/* Features */}
        <div className="space-y-2.5 mb-6">
          {[
            { icon: Activity, color: "text-violet-400", bg: "bg-violet-500/10", text: "Analyzes all 15 market layers at trade entry" },
            { icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", text: "Auto-recalibrates weights at 3:35 PM daily" },
            { icon: Shield, color: "text-cyan-400", bg: "bg-cyan-500/10", text: "Blocks consistently losing patterns automatically" },
            { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", text: "Continues when you minimize or change tabs" },
            { icon: Zap, color: "text-rose-400", bg: "bg-rose-500/10", text: "Never stops — server-side, always running" },
          ].map(({ icon: Icon, color, bg, text }, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${bg}`}>
              <div className={`${color} shrink-0`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-slate-300 text-sm">{text}</span>
            </div>
          ))}
        </div>

        {/* Toggle details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-4"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showDetails ? "rotate-90" : ""}`} />
          How does it work?
        </button>

        {showDetails && (
          <div className="bg-slate-800/50 rounded-xl p-4 mb-4 text-xs text-slate-400 space-y-1.5 font-mono border border-slate-700/40">
            <div>1. Trade entry → snapshot all 15 layer scores</div>
            <div>2. Trade close → record Win/Loss + P&L</div>
            <div>3. Every 5 trades → real-time micro-adjustment</div>
            <div>4. 3:35 PM daily → full weight recalibration</div>
            <div>5. Next session → better weights loaded automatically</div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={approving}
            className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-violet-900/40 flex items-center justify-center gap-2"
          >
            {approving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Activating...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Allow Learning
              </>
            )}
          </button>
          <button
            onClick={handleDeny}
            className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-xl font-medium text-sm transition-all border border-slate-700/50 flex items-center gap-2"
          >
            <XCircle className="w-4 h-4" />
            Skip
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          You can change this anytime in Settings → Self-Learning AI
        </p>
      </div>
    </div>
  );
}
