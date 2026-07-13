import React, { useState, useEffect, useCallback } from "react";
import { Shield, ShieldCheck, ShieldAlert, Activity, Zap, Brain, Database, Server, TrendingUp, BarChart2, BookOpen, FlaskConical, LayoutDashboard, CheckCircle, RefreshCw, Lock, Unlock, GitBranch, Cpu, Eye } from "lucide-react";

const API = (p: string) => {
  const isLocal = typeof window !== "undefined" && (window.location.port === "5173" || window.location.protocol === "file:");
  return `${isLocal ? "http://localhost:3000" : ""}${p}`;
};

interface AmexGatingDashboardProps {
  darkMode: boolean;
  amexData?: any;
}

const SUBSYSTEMS = [
  { id: "CORE", label: "CORE", icon: <Server size={14}/>, color: "indigo", modules: ["Configuration","Infrastructure","Scheduler","Event Bus","API Gateway","Security","Cache","Database","Logging","Monitoring","Backup","Recovery"] },
  { id: "DATA", label: "DATA PLATFORM", icon: <Database size={14}/>, color: "cyan", modules: ["Data Collector","Data Validation","Data Cleaning","Feature Engineering","Feature Store","Data Quality","Historical Store"] },
  { id: "INTEL", label: "MARKET INTELLIGENCE", icon: <Eye size={14}/>, color: "violet", modules: ["Market Context","Heavyweight Intelligence","Option Flow Intelligence","Volume Intelligence","Volatility Intelligence","Breadth Intelligence","Trend Intelligence","Behaviour Intelligence","Prediction Intelligence"] },
  { id: "BRAIN", label: "AI BRAIN", icon: <Brain size={14}/>, color: "emerald", modules: ["Observe Engine","Understand Engine","Reasoning Engine","Probability Engine","Confidence Engine","Consensus Engine","Decision Engine","Explainability Engine"] },
  { id: "RISK", label: "RISK ENGINE", icon: <ShieldCheck size={14}/>, color: "amber", modules: ["Position Sizing","Exposure Control","SL/Target Engine","Daily Risk","Drawdown Protection","Cooldown Logic","Kill Switch","Circuit Breaker"] },
  { id: "TRADING", label: "TRADING", icon: <TrendingUp size={14}/>, color: "rose", modules: ["Signal Queue","Execution","Order Manager","Position Manager","Paper Trading","Replay","Trade Journal","Performance"] },
  { id: "MEMORY", label: "MEMORY", icon: <BookOpen size={14}/>, color: "sky", modules: ["Market Memory","Pattern Memory","Trade Memory","Strategy Memory","Expiry Memory","Volatility Memory","Heavyweight Memory","Option Flow Memory","Context Memory"] },
  { id: "LEARNING", label: "LEARNING", icon: <RefreshCw size={14}/>, color: "teal", modules: ["Pattern Discovery","Pattern Rating","Confidence Learning","Promotion","Demotion","Hard Block","Strategy Scoring","Behaviour Learning"] },
  { id: "EVOLUTION", label: "EVOLUTION", icon: <GitBranch size={14}/>, color: "orange", modules: ["Weight Optimizer","Threshold Optimizer","Risk Optimizer","Strategy Optimizer","Shadow Testing","Version Manager","Rollback","Self Calibration"] },
  { id: "EXPERIMENT", label: "EXPERIMENT LAB", icon: <FlaskConical size={14}/>, color: "pink", modules: ["A/B Testing","Strategy Sandbox","Model Comparison","Walk Forward Test","Monte Carlo","Simulation"] },
  { id: "DASHBOARD", label: "DASHBOARD", icon: <LayoutDashboard size={14}/>, color: "slate", modules: ["Live Market","Heavyweight","Option Flow","AI Brain","Prediction","Decision","Risk","Learning","Evolution","Replay","Performance","Analytics","System Health"] },
];

const AI_FLOW = ["Heavyweight","Option Flow","Market Breadth","Volume","Volatility","Price Action","Prediction","Probability","Confidence","Consensus","Risk","Decision"];

const MASTER_FLOW = ["Market","Data Collector","Validation","Cleaning","Feature Engineering","Feature Store","Market Intelligence","AI Brain","Risk Engine","Trading","Memory","Learning","Evolution","Governor Monitor"];

const COLOR_MAP: Record<string,string> = {
  indigo:"border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  cyan:"border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  violet:"border-violet-500/40 bg-violet-500/10 text-violet-300",
  emerald:"border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  amber:"border-amber-500/40 bg-amber-500/10 text-amber-300",
  rose:"border-rose-500/40 bg-rose-500/10 text-rose-300",
  sky:"border-sky-500/40 bg-sky-500/10 text-sky-300",
  teal:"border-teal-500/40 bg-teal-500/10 text-teal-300",
  orange:"border-orange-500/40 bg-orange-500/10 text-orange-300",
  pink:"border-pink-500/40 bg-pink-500/10 text-pink-300",
  slate:"border-slate-500/40 bg-slate-500/10 text-slate-300",
};

const DOT_MAP: Record<string,string> = {
  indigo:"bg-indigo-400", cyan:"bg-cyan-400", violet:"bg-violet-400",
  emerald:"bg-emerald-400", amber:"bg-amber-400", rose:"bg-rose-400",
  sky:"bg-sky-400", teal:"bg-teal-400", orange:"bg-orange-400",
  pink:"bg-pink-400", slate:"bg-slate-400",
};

export default function AmexGatingDashboard({ darkMode, amexData }: AmexGatingDashboardProps) {
  const [activeTab, setActiveTab] = useState<"ARCHITECTURE"|"MASTER_FLOW"|"AI_FLOW"|"GOVERNOR">("ARCHITECTURE");
  const [selectedSystem, setSelectedSystem] = useState<string|null>(null);
  const [governorLive, setGovernorLive] = useState<any>(null);
  const [govLoading, setGovLoading] = useState(false);

  const killSwitch = governorLive
    ? (governorLive.killSwitch || governorLive.circuitBreaker || governorLive.vixHalted || governorLive.consecutiveLossHalt)
    : false;

  const fetchGovernor = useCallback(async () => {
    try {
      const res = await fetch(API("/api/governor/status"));
      if (res.ok) { const d = await res.json(); setGovernorLive(d.governor); }
    } catch { /* server offline */ }
  }, []);

  useEffect(() => {
    fetchGovernor();
    const id = setInterval(fetchGovernor, 10000);
    return () => clearInterval(id);
  }, [fetchGovernor]);

  const handleKillSwitch = async () => {
    setGovLoading(true);
    try {
      const endpoint = killSwitch ? "/api/governor/restore" : "/api/governor/kill";
      await fetch(API(endpoint), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Manual via AMEX-OS Dashboard" }) });
      await fetchGovernor();
    } catch { } finally { setGovLoading(false); }
  };

  const tabs = [
    { id: "ARCHITECTURE" as const, label: "Architecture", icon: <Cpu size={13}/> },
    { id: "MASTER_FLOW" as const, label: "Master Flow", icon: <Activity size={13}/> },
    { id: "AI_FLOW" as const, label: "AI Decision Flow", icon: <Brain size={13}/> },
    { id: "GOVERNOR" as const, label: "Governor", icon: <Shield size={13}/> },
  ];

  return (
    <div className="w-full min-h-full bg-[#040811] text-white p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.4)]">
            <Shield size={20} className="text-white"/>
          </div>
          <div>
            <h1 className="text-lg font-black tracking-widest bg-gradient-to-r from-indigo-300 via-cyan-300 to-violet-300 bg-clip-text text-transparent uppercase">AMEX-OS</h1>
            <p className="text-[11px] text-slate-500 font-mono tracking-wider">Adaptive Market Execution Operating System · v4.0</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${killSwitch ? "border-red-500/50 bg-red-500/10 text-red-400" : "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"}`}>
            <div className={`w-2 h-2 rounded-full ${killSwitch ? "bg-red-500" : "bg-emerald-500 animate-pulse"}`}/>
            {killSwitch ? "SYSTEM HALTED" : "SYSTEM LIVE"}
          </div>
          <button
            onClick={handleKillSwitch}
            disabled={govLoading}
            className={`px-3 py-1.5 rounded-lg border text-xs font-black uppercase transition-all cursor-pointer ${killSwitch ? "border-emerald-500 text-emerald-400 hover:bg-emerald-500/10" : "border-red-500 text-red-400 hover:bg-red-500/10"}`}
          >
            {govLoading ? <><RefreshCw size={12} className="inline mr-1 animate-spin"/>...</> : killSwitch ? <><Unlock size={12} className="inline mr-1"/>Restore</> : <><Lock size={12} className="inline mr-1"/>Kill Switch</>}
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-slate-900/60 border border-slate-800/60 rounded-xl p-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === t.id ? "bg-indigo-600 text-white shadow-[0_0_10px_rgba(99,102,241,0.3)]" : "text-slate-500 hover:text-slate-300"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ARCHITECTURE TAB */}
      {activeTab === "ARCHITECTURE" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {SUBSYSTEMS.map(sys => {
              const isSelected = selectedSystem === sys.id;
              const colorCls = COLOR_MAP[sys.color] || COLOR_MAP.slate;
              const dotCls = DOT_MAP[sys.color] || DOT_MAP.slate;
              return (
                <div key={sys.id}
                  onClick={() => setSelectedSystem(isSelected ? null : sys.id)}
                  className={`rounded-xl border p-3 cursor-pointer transition-all duration-200 ${colorCls} ${isSelected ? "ring-1 ring-indigo-500/50 scale-[1.02]" : "hover:scale-[1.01]"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="opacity-80">{sys.icon}</span>
                    <span className="text-[11px] font-black tracking-wider uppercase">{sys.label}</span>
                    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/20`}>{sys.modules.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {sys.modules.slice(0, isSelected ? undefined : 4).map(m => (
                      <span key={m} className="flex items-center gap-1 text-[10px] font-mono opacity-80">
                        <span className={`w-1.5 h-1.5 rounded-full ${dotCls} ${killSwitch ? "opacity-30" : ""}`}/>
                        {m}
                      </span>
                    ))}
                    {!isSelected && sys.modules.length > 4 && (
                      <span className="text-[10px] opacity-50">+{sys.modules.length - 4} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-slate-600 font-mono text-center">Click any subsystem to expand modules · {SUBSYSTEMS.reduce((a,s)=>a+s.modules.length,0)} total modules across {SUBSYSTEMS.length} subsystems</div>
        </div>
      )}

      {/* MASTER FLOW TAB */}
      {activeTab === "MASTER_FLOW" && (
        <div className="space-y-4">
          <h2 className="text-sm font-black text-slate-400 uppercase tracking-wider">End-to-End Execution Pipeline</h2>
          <div className="flex flex-col items-center gap-0">
            {MASTER_FLOW.map((step, i) => {
              const isGovernor = step === "Governor Monitor";
              const isAI = step === "AI Brain";
              const isRisk = step === "Risk Engine";
              const color = isGovernor ? "border-amber-500/60 bg-amber-500/10 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
                : isAI ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                : isRisk ? "border-rose-500/60 bg-rose-500/10 text-rose-300"
                : "border-slate-700/60 bg-slate-800/40 text-slate-300";
              return (
                <React.Fragment key={step}>
                  <div className={`w-full max-w-sm rounded-xl border px-4 py-2.5 text-center text-sm font-bold transition-all ${color} ${killSwitch && !isGovernor ? "opacity-30" : ""}`}>
                    {isGovernor && <Shield size={14} className="inline mr-1 mb-0.5"/>}
                    {isAI && <Brain size={14} className="inline mr-1 mb-0.5"/>}
                    {step}
                  </div>
                  {i < MASTER_FLOW.length - 1 && (
                    <div className={`w-px h-5 ${killSwitch ? "bg-slate-800" : "bg-gradient-to-b from-indigo-500/60 to-indigo-500/20"}`}/>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {killSwitch && <div className="text-center text-red-400 font-bold text-sm animate-pulse">⛔ KILL SWITCH ACTIVE — Pipeline Halted by Governor</div>}
        </div>
      )}

      {/* AI DECISION FLOW TAB */}
      {activeTab === "AI_FLOW" && (
        <div className="space-y-4">
          <h2 className="text-sm font-black text-slate-400 uppercase tracking-wider">AI Decision Synthesis Flow</h2>
          <div className="grid grid-cols-3 gap-2 max-w-lg mx-auto">
            {AI_FLOW.slice(0, 7).map((node, i) => (
              <div key={node} className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-center text-[11px] font-bold text-violet-300">
                {node}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-indigo-500/50"/>
            <Zap size={14} className="text-indigo-400"/>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-indigo-500/50"/>
          </div>
          <div className="flex flex-col items-center gap-2">
            {["Probability","Confidence","Consensus","Risk","Decision"].map((node, i) => {
              const isLast = node === "Decision";
              return (
                <React.Fragment key={node}>
                  <div className={`rounded-xl border px-6 py-2 text-center font-bold transition-all ${isLast ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200 text-sm shadow-[0_0_15px_rgba(99,102,241,0.3)]" : "border-slate-700/60 bg-slate-800/40 text-slate-300 text-xs"}`}>
                    {node} Engine
                  </div>
                  {!isLast && <div className="w-px h-4 bg-indigo-500/40"/>}
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex justify-center gap-4 mt-2">
            {["BUY CE","WAIT","SELL PE"].map((action, i) => {
              const color = i===0?"border-emerald-500/60 bg-emerald-500/15 text-emerald-300":i===1?"border-amber-500/60 bg-amber-500/15 text-amber-300":"border-rose-500/60 bg-rose-500/15 text-rose-300";
              return <div key={action} className={`rounded-xl border px-5 py-2 text-sm font-black ${color}`}>{action}</div>;
            })}
          </div>
        </div>
      )}

      {/* GOVERNOR TAB */}
      {activeTab === "GOVERNOR" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className="text-amber-400"/>
            <h2 className="text-sm font-black text-amber-300 uppercase tracking-wider">Governor — Master Safety Controller</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Health Monitor",       value: governorLive?.healthScore ?? 100,       unit: "%", icon: <Activity size={14}/>,    color: "emerald", threshold: 80 },
              { label: "Performance Monitor",  value: governorLive?.performanceScore ?? 50,   unit: "%", icon: <BarChart2 size={14}/>,   color: "cyan",    threshold: 75 },
              { label: "Safety Monitor",        value: governorLive?.safetyScore ?? 100,        unit: "%", icon: <ShieldCheck size={14}/>, color: "indigo",  threshold: 90 },
              { label: "Risk Monitor",          value: governorLive?.riskScore ?? 0,            unit: "%", icon: <ShieldAlert size={14}/>, color: "amber",   threshold: 50 },
            ].map(metric => {
              const isOk = metric.label === "Risk Monitor" ? metric.value < metric.threshold : metric.value >= metric.threshold;
              return (
                <div key={metric.label} className={`rounded-xl border p-3 ${isOk ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex items-center gap-1.5 mb-2 text-slate-400 text-xs font-bold">{metric.icon}{metric.label}</div>
                  <div className={`text-2xl font-black ${isOk ? "text-emerald-400" : "text-red-400"}`}>{metric.value}{metric.unit}</div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2">
                    <div className={`h-1.5 rounded-full ${isOk ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${metric.label==="Risk Monitor"?metric.value:metric.value}%` }}/>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Live Daily Stats */}
          {governorLive && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Today P&L", value: `${governorLive.dailyPnl >= 0 ? "+" : ""}₹${Math.round(governorLive.dailyPnl).toLocaleString("en-IN")}`, color: governorLive.dailyPnl >= 0 ? "text-emerald-400" : "text-rose-400" },
                { label: "Win / Loss", value: `${governorLive.dailyWins}W / ${governorLive.dailyLosses}L`, color: "text-slate-300" },
                { label: "All-time Win%", value: `${governorLive.allTimeWinRate}%`, color: governorLive.allTimeWinRate >= 55 ? "text-emerald-400" : "text-amber-400" },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-3 py-2 text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">{s.label}</div>
                  <div className={`text-sm font-black ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
          {/* Halt reason */}
          {killSwitch && governorLive && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[11px] text-red-400 font-mono text-center">
              ⛔ {governorLive.killSwitchReason || governorLive.circuitBreakerReason || "System Halted"}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { label: "Rollback Manager", desc: "Ready to revert to v3.8", icon: <RefreshCw size={14}/>, status: "STANDBY", color: "slate" },
              { label: "Version Control", desc: "Current: AMEX™ v4.0", icon: <GitBranch size={14}/>, status: "ACTIVE", color: "indigo" },
              { label: "Emergency Kill Switch", desc: killSwitch ? "ENGAGED — All engines stopped" : "Armed & Ready", icon: <Lock size={14}/>, status: killSwitch ? "ENGAGED" : "ARMED", color: killSwitch ? "red" : "amber" },
            ].map(item => (
              <div key={item.label} className={`rounded-xl border p-3 ${item.color==="red"?"border-red-500/50 bg-red-500/10":item.color==="amber"?"border-amber-500/30 bg-amber-500/5":item.color==="indigo"?"border-indigo-500/30 bg-indigo-500/5":"border-slate-700/50 bg-slate-800/30"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={item.color==="red"?"text-red-400":item.color==="amber"?"text-amber-400":item.color==="indigo"?"text-indigo-400":"text-slate-400"}>{item.icon}</span>
                  <span className="text-xs font-black text-slate-300">{item.label}</span>
                  <span className={`ml-auto text-[10px] font-black px-1.5 py-0.5 rounded ${item.status==="ENGAGED"?"bg-red-500/20 text-red-400":item.status==="ACTIVE"?"bg-emerald-500/20 text-emerald-400":"bg-slate-700 text-slate-400"}`}>{item.status}</span>
                </div>
                <p className="text-[11px] text-slate-500 font-mono">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-center">
            <button
              onClick={handleKillSwitch}
              disabled={govLoading}
              className={`px-8 py-3 rounded-xl font-black text-sm uppercase tracking-widest border-2 transition-all cursor-pointer ${killSwitch ? "border-emerald-500 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.2)]" : "border-red-500 text-red-400 bg-red-500/10 hover:bg-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.2)] animate-pulse"}`}>
              {govLoading ? "⏳ Processing..." : killSwitch ? "🟢 RESTORE SYSTEM" : "🔴 EMERGENCY KILL SWITCH"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
