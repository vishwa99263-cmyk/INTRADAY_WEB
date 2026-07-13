/**
 * TradingEngineLayout.tsx
 * Premium institutional trading terminal sidebar + content layout.
 */

import React from "react";
import {
  Zap, BarChart2, TrendingUp, Layers, BookOpen,
  FileText, ShieldCheck, Shield, Activity, Cpu, ChevronRight, X, Target, Brain, Calendar
} from "lucide-react";

export type TEPage =
  | "AMEX_OS"
  | "ENGINES"
  | "L1_REGIME"
  | "L2_BREADTH"
  | "L3_HEAVYWEIGHTS"
  | "L4_RANGES"
  | "L5_OPTION_CHAIN"
  | "L6_MOMENTUM"
  | "L7_SMART_MONEY"
  | "L8_PROBABILITY"
  | "L9_ENTRY_ZONE"
  | "L10_ALIGNMENT"
  | "L11_AI_DECISION"
  | "L12_OPPORTUNITIES"
  | "L13_STRATEGIES"
  | "L14_PAPER_TRADING"
  | "L15_PERFORMANCE"
  | "L16_RISK"
  | "L17_MACRO"
  | "AI_SIGNALS"
  | "MARKET_BREADTH"
  | "MOMENTUM_SCANNER"
  | "OPTION_CHAIN_ENGINE"
  | "PAPER_TRADING"
  | "TRADE_JOURNAL"
  | "RISK_MANAGER"
  | "PERFORMANCE"
  | "ALGO_TRADING"
  | "SYSTEM_HEALTH"
  | "ORB_AUTOMATION"
  | "NEWS"
  | "POSITION_TRADING"   // Layer 11+12+13
  | "AUTO_STRATEGY"     // AI Auto Strategy Dispatcher
  | "SMART_ORDER_QUEUE" // Smart Pending Orders with AI Brain Watch
  | "STRATEGY_LAB"     // 1-Month Paper Trade Lab — Best Strategy Finder
  | "SELF_LEARNING"    // AI Self-Learning Dashboard
  | "ADVANCE_AI"       // Advance AI Dashboard
  | "PROCESSOR"        // Engine Processor Tab
  | "CONTINUOUS_SCALP"; // ⚡ Continuous Scalping Engine (20k capital, data-driven)


interface NavItem {
  id: TEPage;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  priority: "high" | "medium" | "low";
}

const NAV_ITEMS: NavItem[] = [
  { id: "ENGINES",             label: "All Engines Dashboard",icon: <Layers size={16} />,      priority: "high" },
  { id: "L1_REGIME",           label: "L1: Market Regime",    icon: <Activity size={16} />,    priority: "high" },
  { id: "L2_BREADTH",          label: "L2: Market Breadth",   icon: <BarChart2 size={16} />,   priority: "high" },
  { id: "L3_HEAVYWEIGHTS",     label: "L3: Heavyweights",     icon: <TrendingUp size={16} />,  priority: "high" },
  { id: "L4_RANGES",           label: "L4: 15M Range",        icon: <Layers size={16} />,      priority: "high" },
  { id: "L5_OPTION_CHAIN",     label: "L5: Option Chain",     icon: <Layers size={16} />,      priority: "high" },
  { id: "L6_MOMENTUM",         label: "L6: Momentum Scanner", icon: <TrendingUp size={16} />,  priority: "high" },
  { id: "L7_SMART_MONEY",      label: "L7: Smart Money",      icon: <Zap size={16} />,         priority: "high" },
  { id: "L8_PROBABILITY",      label: "L8: Probability",      icon: <Activity size={16} />,    priority: "high" },
  { id: "L9_ENTRY_ZONE",       label: "L9: Entry Zone",       icon: <Target size={16} />,      priority: "high" },
  { id: "L10_ALIGNMENT",       label: "L10: Strategy Align",  icon: <Cpu size={16} />,         priority: "high" },
  { id: "L11_AI_DECISION",     label: "L11: AI Decision",     icon: <Zap size={16} />,         badge: "LIVE", priority: "high" },
  { id: "L12_OPPORTUNITIES",   label: "L12: Opportunities",   icon: <TrendingUp size={16} />,  priority: "high" },
  { id: "L13_STRATEGIES",      label: "L13: Strategies Matrix", icon: <Cpu size={16} />,       badge: "AUTO", priority: "high" },
  { id: "L15_PERFORMANCE",     label: "L15: Performance",     icon: <Activity size={16} />,    priority: "high" },
  { id: "L16_RISK",            label: "L16: Risk Management", icon: <ShieldCheck size={16} />, priority: "high" },
  { id: "L17_MACRO",           label: "L17: Institutional Macro", icon: <Layers size={16} />, priority: "high" },

  // ── Position Trading (Layer 11+12+13) ─────────────────────────────────────
  { id: "POSITION_TRADING",    label: "Position Trading",     icon: <Calendar size={16} />,    badge: "NEW", priority: "high" },

  // Analytics
  { id: "ADVANCE_AI",          label: "Advance AI",           icon: <Brain size={16} />,       badge: "🧠 AI", priority: "medium" },
  { id: "AI_SIGNALS",          label: "AI Signals Summary",   icon: <Zap size={16} />,         priority: "medium" },
  { id: "PAPER_TRADING",       label: "Simulated Paper Trading", icon: <BookOpen size={16} />,   badge: "TERM", priority: "medium" },
  { id: "CONTINUOUS_SCALP",    label: "⚡ Continuous Scalp",  icon: <Zap size={16} />,         badge: "HOT", priority: "medium" },
  { id: "RISK_MANAGER",        label: "Risk Manager UI",      icon: <ShieldCheck size={16} />, priority: "medium" },
  { id: "SMART_ORDER_QUEUE",   label: "Smart Order Queue",    icon: <Target size={16} />,      badge: "LIVE", priority: "medium" },
  { id: "STRATEGY_LAB",        label: "Strategy Lab (1M)",    icon: <Activity size={16} />,    badge: "LAB", priority: "medium" },
  { id: "ALGO_TRADING",        label: "AI Algo Trading",      icon: <Brain size={16} />,       badge: "AI", priority: "medium" },
  { id: "TRADE_JOURNAL",       label: "Trade Journal",        icon: <FileText size={16} />,    priority: "medium" },

  { id: "PERFORMANCE",         label: "Performance Analytics",icon: <BarChart2 size={16} />,   priority: "medium" },
  { id: "NEWS",                label: "News Intelligence",    icon: <FileText size={16} />,    badge: "NEW", priority: "medium" },
  { id: "SELF_LEARNING",       label: "AI Self-Learning",     icon: <Brain size={16} />,       badge: "🧠 AI", priority: "medium" },

  // Advanced
  { id: "AMEX_OS",             label: "AMEX-OS Architecture", icon: <Shield size={16} />,      badge: "OS", priority: "low" },
  { id: "PROCESSOR",           label: "Engine Processor",     icon: <Cpu size={16} />,         badge: "LOGS", priority: "low" },
  { id: "SYSTEM_HEALTH",       label: "System Health",        icon: <Activity size={16} />,    priority: "low" },
];

interface Props {
  activePage: TEPage;
  onPageChange: (page: TEPage) => void;
  children: React.ReactNode;
}

const TradingEngineLayout: React.FC<Props> = ({ activePage, onPageChange, children }) => {
  return (
    <div className="flex h-full min-h-0 bg-[#040811]">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 w-52 bg-[#060d1a] border-r border-slate-800/60 flex flex-col"
        style={{ minHeight: "100%" }}
      >
        {/* Sidebar header */}
        <div className="px-4 py-3 border-b border-slate-800/60">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center shadow-[0_0_8px_rgba(99,102,241,0.6)]">
              <Cpu size={13} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-black text-white tracking-widest uppercase bg-gradient-to-r from-indigo-300 to-cyan-400 bg-clip-text text-transparent">AMEX</div>
              <div className="text-[11px] text-indigo-400 font-mono tracking-wider uppercase">Adaptive Market Engine</div>
            </div>
          </div>
        </div>

        {/* Priority sections */}
        <div className="flex-1 overflow-y-auto py-2 custom-dashboard-scrollbar">
          {/* High priority */}
          <div className="px-3 pt-2 pb-1">
            <div className="text-[11px] text-slate-600 uppercase tracking-widest font-black mb-1">Core Engine</div>
          </div>
          {NAV_ITEMS.filter(n => n.priority === "high").map(item => (
            <NavButton key={item.id} item={item} active={activePage === item.id} onClick={() => onPageChange(item.id)} />
          ))}

          <div className="px-3 pt-3 pb-1">
            <div className="text-[11px] text-slate-600 uppercase tracking-widest font-black mb-1">Analytics</div>
          </div>
          {NAV_ITEMS.filter(n => n.priority === "medium").map(item => (
            <NavButton key={item.id} item={item} active={activePage === item.id} onClick={() => onPageChange(item.id)} />
          ))}

          <div className="px-3 pt-3 pb-1">
            <div className="text-[11px] text-slate-600 uppercase tracking-widest font-black mb-1">Advanced</div>
          </div>
          {NAV_ITEMS.filter(n => n.priority === "low").map(item => (
            <NavButton key={item.id} item={item} active={activePage === item.id} onClick={() => onPageChange(item.id)} />
          ))}
        </div>

        {/* Sidebar footer */}
        <div className="px-4 py-2 border-t border-slate-800/60">
          <div className="text-[11px] text-slate-600 font-mono">AMEX™ v2.0 · CODETRADE</div>
        </div>
      </div>

      {/* ── Content Area (Bloomberg Terminal — Full Width) ───────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-dashboard-scrollbar bg-[#040811]">
        <div className="w-full min-h-full">
          {children}
        </div>
      </div>
    </div>
  );
};

const NavButton: React.FC<{ item: NavItem; active: boolean; onClick: () => void }> = ({
  item, active, onClick
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-150 cursor-pointer outline-none
      ${active
        ? "bg-indigo-600/20 border-l-2 border-indigo-500 text-indigo-300"
        : "border-l-2 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
      }`}
  >
    <span className={active ? "text-indigo-400" : "text-slate-500"}>{item.icon}</span>
    <span className="text-sm font-semibold flex-1">{item.label}</span>
    {item.badge && (
      <span className={`text-[11px] font-black px-1 py-0.5 rounded tracking-wider
        ${item.badge === "LIVE" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
        {item.badge}
      </span>
    )}
    {active && <ChevronRight size={10} className="text-indigo-500" />}
  </button>
);

export default TradingEngineLayout;

