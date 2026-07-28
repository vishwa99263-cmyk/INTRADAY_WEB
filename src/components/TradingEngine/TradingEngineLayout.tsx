/**
 * TradingEngineLayout.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * 10X PREMIUM TRADING ENGINE — SIDEBAR TAB SYSTEM
 *
 * Features:
 *  • Collapsible sidebar with icon-only compact mode
 *  • Glowing active tab indicator with color-coded priority groups
 *  • Live badge system (LIVE / HOT / AI / NEW / AUTO)
 *  • Animated pulse dots on live tabs
 *  • Group separators with section headers
 *  • Pinned "BEST SETUP" quick-access tab at top
 *  • Bottom system info bar with live clock
 */

import React, { useState, useEffect } from "react";
import {
  Zap, BarChart2, TrendingUp, Layers, BookOpen,
  FileText, ShieldCheck, Shield, Activity, Cpu,
  ChevronRight, Target, Brain, Calendar, Menu, X,
  Crosshair, Radio, Sparkles, FlaskConical, Infinity,
  ScanLine, Atom, Binary, Eye, GitBranch, Network,
  ChevronLeft
} from "lucide-react";

export type TEPage =
  | "AMEX_OS"
  | "ENGINES"
  | "BEST_SETUP"
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
  | "POSITION_TRADING"
  | "AUTO_STRATEGY"
  | "SMART_ORDER_QUEUE"
  | "STRATEGY_LAB"
  | "SELF_LEARNING"
  | "ADVANCE_AI"
  | "PROCESSOR"
  | "CONTINUOUS_SCALP";

// ─────────────────────────────────────────────────────────────────────────────
//  NAV CONFIG
// ─────────────────────────────────────────────────────────────────────────────

type BadgeType = "LIVE" | "HOT" | "AI" | "NEW" | "AUTO" | "OS" | "LOGS" | "LAB" | "TERM";

interface NavItem {
  id: TEPage;
  label: string;
  shortLabel?: string;
  icon: React.ReactNode;
  badge?: BadgeType;
  pulse?: boolean;
  color?: string; // accent color for active glow
}

interface NavGroup {
  title: string;
  key: string;
  color: string;
  glow: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "⚡ BEST SETUP",
    key: "pinned",
    color: "#00ff88",
    glow: "rgba(0,255,136,0.3)",
    items: [
      { id: "BEST_SETUP", label: "Best Setup Deck", shortLabel: "SETUP", icon: <Crosshair size={14} />, badge: "LIVE", pulse: true, color: "#00ff88" },
      { id: "ENGINES",    label: "All Engines",     shortLabel: "DASH",  icon: <Layers size={14} />,    color: "#818cf8" },
    ],
  },
  {
    title: "CORE ENGINE — L1→L9",
    key: "core",
    color: "#818cf8",
    glow: "rgba(129,140,248,0.25)",
    items: [
      { id: "L1_REGIME",       label: "L1: Market Regime",    shortLabel: "L1",  icon: <ScanLine size={14} />,    color: "#818cf8" },
      { id: "L2_BREADTH",      label: "L2: Market Breadth",   shortLabel: "L2",  icon: <Network size={14} />,     color: "#818cf8" },
      { id: "L3_HEAVYWEIGHTS", label: "L3: Heavyweights",     shortLabel: "L3",  icon: <TrendingUp size={14} />,  color: "#818cf8" },
      { id: "L4_RANGES",       label: "L4: 15M Range",        shortLabel: "L4",  icon: <GitBranch size={14} />,   color: "#818cf8" },
      { id: "L5_OPTION_CHAIN", label: "L5: Option Chain",     shortLabel: "L5",  icon: <Atom size={14} />,        color: "#818cf8" },
      { id: "L6_MOMENTUM",     label: "L6: Momentum",         shortLabel: "L6",  icon: <Activity size={14} />,    color: "#818cf8" },
      { id: "L7_SMART_MONEY",  label: "L7: Smart Money",      shortLabel: "L7",  icon: <Eye size={14} />,         color: "#818cf8" },
      { id: "L8_PROBABILITY",  label: "L8: Probability",      shortLabel: "L8",  icon: <Binary size={14} />,      color: "#818cf8" },
      { id: "L9_ENTRY_ZONE",   label: "L9: Entry Zone",       shortLabel: "L9",  icon: <Target size={14} />,      color: "#818cf8" },
    ],
  },
  {
    title: "DECISION — L10→L17",
    key: "decision",
    color: "#22d3ee",
    glow: "rgba(34,211,238,0.22)",
    items: [
      { id: "L10_ALIGNMENT",   label: "L10: Strategy Align",  shortLabel: "L10", icon: <GitBranch size={14} />,  color: "#22d3ee" },
      { id: "L11_AI_DECISION", label: "L11: AI Decision",     shortLabel: "L11", icon: <Brain size={14} />,      badge: "LIVE", pulse: true, color: "#22d3ee" },
      { id: "L12_OPPORTUNITIES",label:"L12: Opportunities",   shortLabel: "L12", icon: <Sparkles size={14} />,   color: "#22d3ee" },
      { id: "L13_STRATEGIES",  label: "L13: Strategies",      shortLabel: "L13", icon: <Cpu size={14} />,        badge: "AUTO", color: "#22d3ee" },
      { id: "L15_PERFORMANCE", label: "L15: Performance",     shortLabel: "L15", icon: <BarChart2 size={14} />,  color: "#22d3ee" },
      { id: "L16_RISK",        label: "L16: Risk Manager",    shortLabel: "L16", icon: <ShieldCheck size={14} />,color: "#22d3ee" },
      { id: "L17_MACRO",       label: "L17: Institutional",   shortLabel: "L17", icon: <Layers size={14} />,     color: "#22d3ee" },
    ],
  },
  {
    title: "POSITION TRADING",
    key: "positional",
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.22)",
    items: [
      { id: "POSITION_TRADING", label: "Position Trading",  shortLabel: "POS",  icon: <Calendar size={14} />,    badge: "NEW",  color: "#f59e0b" },
      { id: "CONTINUOUS_SCALP", label: "⚡ Continuous Scalp",shortLabel: "SCALP",icon: <Zap size={14} />,         badge: "HOT",  pulse: true, color: "#f59e0b" },
      { id: "AUTO_STRATEGY",    label: "Auto Strategy AI",  shortLabel: "AUTO", icon: <Brain size={14} />,       badge: "AI",   color: "#f59e0b" },
      { id: "SMART_ORDER_QUEUE",label: "Smart Order Queue", shortLabel: "SOQ",  icon: <Target size={14} />,      badge: "LIVE", color: "#f59e0b" },
    ],
  },
  {
    title: "ANALYTICS",
    key: "analytics",
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.2)",
    items: [
      { id: "ADVANCE_AI",    label: "Advance AI",           shortLabel: "ADV", icon: <Brain size={14} />,       badge: "AI",   color: "#a78bfa" },
      { id: "AI_SIGNALS",    label: "AI Signals Summary",   shortLabel: "SIG", icon: <Radio size={14} />,       color: "#a78bfa" },
      { id: "STRATEGY_LAB",  label: "Strategy Lab (1M)",    shortLabel: "LAB", icon: <FlaskConical size={14} />,badge: "LAB",  color: "#a78bfa" },
      { id: "ALGO_TRADING",  label: "AI Algo Trading",      shortLabel: "ALGO",icon: <Infinity size={14} />,    badge: "AI",   color: "#a78bfa" },
      { id: "PAPER_TRADING", label: "Paper Trading",        shortLabel: "PAPER",icon: <BookOpen size={14} />,   badge: "TERM", color: "#a78bfa" },
      { id: "TRADE_JOURNAL", label: "Trade Journal",        shortLabel: "JNL", icon: <FileText size={14} />,    color: "#a78bfa" },
      { id: "PERFORMANCE",   label: "Performance Analytics",shortLabel: "PERF",icon: <BarChart2 size={14} />,   color: "#a78bfa" },
      { id: "NEWS",          label: "News Intelligence",    shortLabel: "NEWS",icon: <FileText size={14} />,    badge: "NEW",  color: "#a78bfa" },
      { id: "SELF_LEARNING", label: "AI Self-Learning",     shortLabel: "SELF",icon: <Brain size={14} />,       badge: "AI",   color: "#a78bfa" },
      { id: "ORB_AUTOMATION",label: "ORB Automation",       shortLabel: "ORB", icon: <Target size={14} />,      color: "#a78bfa" },
    ],
  },
  {
    title: "SYSTEM",
    key: "system",
    color: "#64748b",
    glow: "rgba(100,116,139,0.18)",
    items: [
      { id: "AMEX_OS",       label: "AMEX-OS Architecture",shortLabel: "OS",  icon: <Shield size={14} />,     badge: "OS",   color: "#64748b" },
      { id: "PROCESSOR",     label: "Engine Processor",    shortLabel: "PROC",icon: <Cpu size={14} />,        badge: "LOGS", color: "#64748b" },
      { id: "SYSTEM_HEALTH", label: "System Health",       shortLabel: "SYS", icon: <Activity size={14} />,   color: "#64748b" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  BADGE COLOR MAP
// ─────────────────────────────────────────────────────────────────────────────

const BADGE_STYLES: Record<BadgeType, string> = {
  LIVE: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  HOT:  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  AI:   "bg-violet-500/20 text-violet-300 border-violet-500/30",
  NEW:  "bg-sky-500/20 text-sky-300 border-sky-500/30",
  AUTO: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  OS:   "bg-slate-500/20 text-slate-400 border-slate-500/30",
  LOGS: "bg-slate-600/20 text-slate-500 border-slate-600/30",
  LAB:  "bg-teal-500/20 text-teal-300 border-teal-500/30",
  TERM: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
};

// ─────────────────────────────────────────────────────────────────────────────
//  LIVE CLOCK HOOK
// ─────────────────────────────────────────────────────────────────────────────

function useLiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAV BUTTON
// ─────────────────────────────────────────────────────────────────────────────

interface NavButtonProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ item, active, collapsed, onClick }) => {
  const color = item.color ?? "#818cf8";
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className="relative w-full flex items-center gap-2.5 px-2.5 py-[7px] text-left transition-all duration-150 cursor-pointer outline-none rounded-lg group"
      style={{
        background: active
          ? `linear-gradient(90deg, ${color}14, ${color}06, transparent)`
          : "transparent",
        borderLeft: active ? `2px solid ${color}` : "2px solid transparent",
      }}
    >
      {/* Active left glow */}
      {active && (
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-3/4 rounded-r"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        />
      )}

      {/* Icon */}
      <span
        className="flex-shrink-0 transition-colors duration-150"
        style={{ color: active ? color : "#475569" }}
      >
        {item.icon}
      </span>

      {/* Label (hidden when collapsed) */}
      {!collapsed && (
        <>
          <span
            className="text-[11.5px] font-semibold flex-1 truncate transition-colors duration-150 leading-none"
            style={{ color: active ? color : "#94a3b8" }}
          >
            {item.label}
          </span>

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Pulse indicator */}
            {item.pulse && (
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ backgroundColor: item.badge === "LIVE" ? "#10b981" : item.badge === "HOT" ? "#f43f5e" : "#a78bfa" }}
                />
                <span
                  className="relative inline-flex rounded-full h-1.5 w-1.5"
                  style={{ backgroundColor: item.badge === "LIVE" ? "#10b981" : item.badge === "HOT" ? "#f43f5e" : "#a78bfa" }}
                />
              </span>
            )}

            {/* Badge */}
            {item.badge && (
              <span
                className={`text-[8.5px] font-black px-1 py-0.5 rounded border uppercase tracking-wider leading-none ${BADGE_STYLES[item.badge]}`}
              >
                {item.badge}
              </span>
            )}

            {/* Chevron when active */}
            {active && <ChevronRight size={9} style={{ color }} />}
          </div>
        </>
      )}

      {/* Hover glow tooltip in collapsed mode */}
      {collapsed && item.badge && (
        <div className="absolute left-full ml-1 z-50 hidden group-hover:flex">
          <span className={`text-[8px] font-black px-1 py-0.5 rounded border uppercase ${BADGE_STYLES[item.badge]}`}>
            {item.badge}
          </span>
        </div>
      )}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION HEADER
// ─────────────────────────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string; color: string; glow: string; collapsed: boolean }> = ({
  title, color, glow, collapsed,
}) => {
  if (collapsed) {
    return (
      <div
        className="mx-2 my-1 h-px rounded"
        style={{ background: `linear-gradient(90deg, ${color}40, transparent)` }}
      />
    );
  }
  return (
    <div className="px-3 pt-3 pb-1">
      <div
        className="text-[9px] font-black uppercase tracking-widest leading-none"
        style={{ color, textShadow: `0 0 8px ${glow}` }}
      >
        {title}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN LAYOUT
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  activePage: TEPage;
  onPageChange: (page: TEPage) => void;
  children: React.ReactNode;
}

const TradingEngineLayout: React.FC<Props> = ({ activePage, onPageChange, children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const clock = useLiveClock();

  const marketOpen = (() => {
    const h = clock.getHours();
    const m = clock.getMinutes();
    const mins = h * 60 + m;
    return mins >= 555 && mins < 930; // 9:15 – 15:30 IST
  })();

  const timeStr = clock.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  return (
    <div className="flex h-full min-h-0" style={{ background: "#030610" }}>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex flex-col border-r transition-all duration-300 relative"
        style={{
          width: collapsed ? 44 : 208,
          borderColor: "rgba(255,255,255,0.05)",
          background: "linear-gradient(180deg, #06091a 0%, #040812 100%)",
        }}
      >
        {/* Top beam accent */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, #818cf850, transparent)" }}
        />

        {/* ── Sidebar Header ───────────────────────────────────────────── */}
        <div
          className="flex items-center gap-2 px-2.5 py-3 border-b"
          style={{ borderColor: "rgba(255,255,255,0.05)" }}
        >
          {/* Logo */}
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              boxShadow: "0 0 12px rgba(99,102,241,0.5)",
            }}
          >
            <Cpu size={14} className="text-white" />
          </div>

          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div
                className="text-[12px] font-black uppercase tracking-widest leading-none"
                style={{
                  background: "linear-gradient(90deg, #a5b4fc, #67e8f9)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                AMEX
              </div>
              <div className="text-[8.5px] text-indigo-400/70 font-mono tracking-wider uppercase leading-none mt-0.5">
                Trading Engine
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(v => !v)}
            className="flex-shrink-0 p-1 rounded-lg transition-all hover:bg-white/5"
            style={{ color: "#475569" }}
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        </div>

        {/* ── Nav Groups ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 custom-dashboard-scrollbar">
          {NAV_GROUPS.map(group => (
            <div key={group.key}>
              <SectionHeader
                title={group.title}
                color={group.color}
                glow={group.glow}
                collapsed={collapsed}
              />
              <div className={`${collapsed ? "px-1" : "px-2"} space-y-0.5`}>
                {group.items.map(item => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={activePage === item.id}
                    collapsed={collapsed}
                    onClick={() => onPageChange(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Sidebar Footer ────────────────────────────────────────────── */}
        <div
          className="px-2.5 py-2 border-t"
          style={{ borderColor: "rgba(255,255,255,0.04)" }}
        >
          {!collapsed ? (
            <div className="space-y-1">
              {/* Market Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="relative flex h-1.5 w-1.5"
                  >
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75`}
                      style={{ backgroundColor: marketOpen ? "#10b981" : "#f43f5e" }}
                    />
                    <span
                      className="relative inline-flex rounded-full h-1.5 w-1.5"
                      style={{ backgroundColor: marketOpen ? "#10b981" : "#f43f5e" }}
                    />
                  </span>
                  <span className="text-[8.5px] font-bold" style={{ color: marketOpen ? "#10b981" : "#f43f5e" }}>
                    {marketOpen ? "MARKET OPEN" : "MARKET CLOSED"}
                  </span>
                </div>
                <span className="text-[8.5px] text-slate-600 font-mono">{timeStr}</span>
              </div>
              <div className="text-[8px] text-slate-700 font-mono">AMEX™ v3.0 · CODETRADE</div>
            </div>
          ) : (
            /* Collapsed footer: just the status dot */
            <div className="flex justify-center">
              <span
                className="relative flex h-2 w-2"
              >
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ backgroundColor: marketOpen ? "#10b981" : "#f43f5e" }}
                />
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ backgroundColor: marketOpen ? "#10b981" : "#f43f5e" }}
                />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── CONTENT AREA ────────────────────────────────────────────────── */}
      <div
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-dashboard-scrollbar"
        style={{ background: "#030610" }}
      >
        {/* Page top accent bar */}
        <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-1.5 border-b"
          style={{
            background: "rgba(3,6,16,0.95)",
            backdropFilter: "blur(12px)",
            borderColor: "rgba(255,255,255,0.04)",
          }}
        >
          <div className="flex items-center gap-2">
            {/* Active page breadcrumb */}
            {(() => {
              const flat = NAV_GROUPS.flatMap(g => g.items);
              const current = flat.find(i => i.id === activePage);
              const group   = NAV_GROUPS.find(g => g.items.some(i => i.id === activePage));
              if (!current || !group) return null;
              return (
                <>
                  <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: group.color + "80" }}>
                    {group.title.replace(/^[⚡\s]+/, "")}
                  </span>
                  <ChevronRight size={9} style={{ color: "#334155" }} />
                  <div className="flex items-center gap-1.5">
                    <span style={{ color: current.color ?? group.color }}>
                      {current.icon}
                    </span>
                    <span
                      className="text-[11px] font-black uppercase tracking-wider"
                      style={{ color: current.color ?? group.color }}
                    >
                      {current.label}
                    </span>
                  </div>
                  {current.badge && (
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wider ${BADGE_STYLES[current.badge]}`}>
                      {current.badge}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8.5px] font-mono" style={{ color: marketOpen ? "#10b981" : "#64748b" }}>
              {timeStr}
            </span>
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: marketOpen ? "#10b981" : "#334155",
                boxShadow: marketOpen ? "0 0 6px #10b981" : "none",
              }}
            />
          </div>
        </div>

        {/* Page content */}
        <div className="w-full min-h-full">
          {children}
        </div>
      </div>
    </div>
  );
};

export default TradingEngineLayout;
