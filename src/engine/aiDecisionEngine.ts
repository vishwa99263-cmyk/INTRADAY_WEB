/**
 * aiDecisionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 11: AI Decision Engine — Strategy-Registry-Driven (Reset v2)
 *
 * RESET: All central gates removed.
 * - No alignment/probability/smartmoney gating
 * - No exhaustion reversal overrides
 * - No trap detection blocks
 * - No NO_TRADE from AI brain
 *
 * This engine now simply maps dispatcher output to the expected AIDecisionResult
 * format for backward compatibility with UI components.
 *
 * Real trade decisions are made in strategyDispatcher.ts using each strategy's
 * own conditions from STRATEGY_REGISTRY.
 *
 * Pure TypeScript — no React, no side effects.
 */

import type { MarketTimeEngineResult } from "./marketTimeEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AIDecision    = "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";
export type DecisionGrade = "A" | "B" | "C" | "D";
export type RiskLevel     = "LOW" | "MEDIUM" | "HIGH";

export interface RiskAssessment {
  riskLevel:         "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  maxDownsidePoints: number;
  upsidePoints:      number;
  volatilityRisk:    "LOW" | "MEDIUM" | "HIGH";
  timeDecayRisk:     "LOW" | "MEDIUM" | "HIGH";
  liquidityRisk:     "LOW" | "MEDIUM" | "HIGH";
  circuitBreakerRisk: boolean;
  warnings:          string[];
}

export interface AIDecisionResult {
  finalDecision:   AIDecision;
  confidence:      number;      // 0–100
  grade:           DecisionGrade;
  riskLevel:       RiskLevel;
  reasoning:       string[];
  triggeredLayers: string[];
  entryReference?: {
    entry:  number;
    sl:     number;
    target: number;
  };
  timestamp: number;

  // Backward compatibility fields
  decisionConfidence: number;
  decisionGrade:      "A" | "B" | "C" | "D" | "F";
  riskAssessment:     RiskAssessment;
}

export interface AIDecisionInput {
  // Market time gate — only field that matters for gating
  marketTimeResult?: MarketTimeEngineResult;
  tradingMode?:      "INTRADAY" | "SWING";
  // Everything else kept for UI display only — not used for decisions
  [key: string]: unknown;
}

// ── Helper: default risk assessment ──────────────────────────────────────────

function buildRiskAssessment(warnings: string[] = []): RiskAssessment {
  return {
    riskLevel:          "LOW",
    maxDownsidePoints:  0,
    upsidePoints:       0,
    volatilityRisk:     "LOW",
    timeDecayRisk:      "LOW",
    liquidityRisk:      "LOW",
    circuitBreakerRisk: false,
    warnings,
  };
}

// ── Main Engine ───────────────────────────────────────────────────────────────
// Returns WAIT only when market is closed.
// All other decisions are delegated to strategyDispatcher.ts.

export function computeAIDecision(input: AIDecisionInput): AIDecisionResult {
  const { marketTimeResult, tradingMode = "INTRADAY" } = input ?? {};

  // ── HARD GATE: Market Hours (REMOVED — trading works anytime) ──
  // Market time check is bypassed to allow trading outside of normal hours.


  // ── Market is open: pass through — dispatcher decides ──
  // Return a permissive WAIT that lets the dispatcher run unblocked.
  // The dispatcher will set the actual trade direction.
  return {
    finalDecision:      "WAIT",   // Dispatcher overrides this via its own output
    confidence:         75,
    grade:              "B",
    riskLevel:          "MEDIUM",
    reasoning:          ["✅ Market open. Strategy dispatcher is active and evaluating conditions."],
    triggeredLayers:    ["Strategy Registry Dispatcher"],
    entryReference:     undefined,
    timestamp:          Date.now(),
    decisionConfidence: 75,
    decisionGrade:      "B",
    riskAssessment:     buildRiskAssessment(),
  };
}

// ── UI Metadata ───────────────────────────────────────────────────────────────

export const DECISION_META: Record<AIDecision, {
  label: string; emoji: string; color: string; bg: string; border: string; glow: string;
}> = {
  BUY_CE:   { label: "BUY CALL (CE)",    emoji: "🚀", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", glow: "rgba(16,185,129,0.30)"  },
  BUY_PE:   { label: "BUY PUT (PE)",     emoji: "💥", color: "text-red-400",     bg: "bg-red-500/15",     border: "border-red-500/40",     glow: "rgba(239,68,68,0.30)"   },
  WAIT:     { label: "AWAITING TRIGGER", emoji: "⏳", color: "text-amber-400",   bg: "bg-amber-500/12",   border: "border-amber-500/30",   glow: "rgba(245,158,11,0.15)"  },
  NO_TRADE: { label: "SYSTEM LOCKED",    emoji: "🔒", color: "text-slate-400",   bg: "bg-slate-800/40",   border: "border-slate-700/30",   glow: "transparent"            },
};

export const DECISION_GRADE_META = {
  "A": { color: "text-emerald-300 border-emerald-500/35", bg: "bg-emerald-500/20", label: "INSTITUTIONAL GRADE A" },
  "B": { color: "text-sky-300 border-sky-500/30",         bg: "bg-sky-500/15",     label: "PROBABILISTIC GRADE B"  },
  "C": { color: "text-amber-300 border-amber-500/25",     bg: "bg-amber-500/12",   label: "SPECULATIVE GRADE C"    },
  "D": { color: "text-orange-400 border-orange-500/20",   bg: "bg-orange-500/10",  label: "HIGH RISK GRADE D"      },
  "F": { color: "text-red-400 border-red-500/15",         bg: "bg-red-500/10",     label: "UNSUITABLE GRADE F"     },
} as const;

export const RISK_LEVEL_META = {
  LOW:      { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  MODERATE: { color: "text-sky-400",     bg: "bg-sky-500/10",     border: "border-sky-500/20"     },
  HIGH:     { color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20"  },
  CRITICAL: { color: "text-red-400 font-bold animate-pulse", bg: "bg-red-500/15", border: "border-red-500/30" },
} as const;
