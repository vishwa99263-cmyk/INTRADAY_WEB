/**
 * aiBrainEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX 10X AI Brain — Combined Score Engine (Updated & Profitable)
 *
 * 3 Core Pillars:
 *   OI Quality  (0-40 pts) — PCR, sentiment, walls, OI buildup
 *   Momentum    (0-35 pts) — Speed, directional alignment, exhaustion
 *   AI Signal   (0-25 pts) — AI confidence, win-streak history, VIX state
 *
 * Total: 0-100
 * >= 75 → STRONG (High conviction real trade)
 * >= 60 → GOOD   (Solid real trade)
 * >= 50 → WEAK   (Micro-scalp / small position)
 * <  50 → BLOCK  (Blocked from real trade execution)
 */

import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { MomentumStateResult } from "./momentumEngine.js";
import { marketState } from "../state/marketState.js";
import { getPaperTrades } from "./tradingEngineDB.js";
import { getISTTime } from "../utils/timerUtils.js";

export interface AIBrainResult {
  allowTrade:   boolean;
  totalScore:   number;          // 0–100
  oiScore:      number;          // 0–40
  momentumScore: number;         // 0–35
  aiScore:      number;          // 0–25
  grade:        "STRONG" | "GOOD" | "WEAK" | "BLOCK";
  summary:      string;
  reason:       string;
}

/** Normalize input trade direction to standard BUY_CE or BUY_PE */
function normalizeDirection(rawDir: string): "BUY_CE" | "BUY_PE" {
  const upper = (rawDir || "").toUpperCase().trim();
  if (upper === "BUY_PE" || upper === "PE" || upper === "SHORT" || upper === "PUT" || upper === "BEAR") {
    return "BUY_PE";
  }
  return "BUY_CE";
}

// ── OI Quality Score (0-40 pts) ───────────────────────────────────────────────
function scoreOI(direction: "BUY_CE" | "BUY_PE", report: CompleteMarketReport, spotPrice: number): number {
  let score = 0;
  const oi = report?.oi as any;
  if (!oi) return 20; // Neutral fallback

  const pcr            = oi.pcr ?? 1.0;
  const sentiment      = oi.sentiment ?? "SIDEWAYS";
  const resistanceWall = oi.resistanceWall ?? 0;
  const supportWall    = oi.supportWall    ?? 0;
  const netCeType      = oi.netCeBuildup?.type ?? "NEUTRAL";
  const netPeType      = oi.netPeBuildup?.type ?? "NEUTRAL";

  // ── 1. PCR Score (0-15 pts) ──────────────────────────────────
  if (direction === "BUY_CE") {
    // Bullish Call buying: High PCR (>1.2) = heavy Put writing support
    if (pcr > 1.4)       score += 15; // Very bullish — Put writers strong
    else if (pcr > 1.2)  score += 12;
    else if (pcr > 1.0)  score += 9;
    else if (pcr > 0.85) score += 5;
    else                 score += 2;  // Low PCR (<0.85) — Call writers heavy overhead
  } else {
    // Bearish Put buying: Low PCR (<0.8) = heavy Call writing resistance
    if (pcr < 0.7)       score += 15; // Very bearish — Call writers dominating
    else if (pcr < 0.85) score += 12;
    else if (pcr < 1.0)  score += 9;
    else if (pcr < 1.15) score += 5;
    else                 score += 2;  // High PCR (>1.15) — Put support below
  }

  // ── 2. Sentiment Alignment (0-12 pts) ────────────────────────
  const sentimentMap: Record<string, Record<string, number>> = {
    BUY_CE: {
      STRONG_BULLISH: 12, BULLISH: 10, SIDEWAYS: 6,
      BEARISH: 2,         STRONG_BEARISH: 0,
    },
    BUY_PE: {
      STRONG_BEARISH: 12, BEARISH: 10, SIDEWAYS: 6,
      BULLISH: 2,         STRONG_BULLISH: 0,
    },
  };
  score += sentimentMap[direction]?.[sentiment] ?? 6;

  // ── 3. OI Wall Position & Room to Move (0-8 pts) ─────────────
  if (direction === "BUY_CE") {
    let wallScore = 0;
    if (supportWall > 0 && spotPrice >= supportWall) wallScore += 4; // Bouncing from support
    else if (supportWall === 0) wallScore += 2;

    if (resistanceWall > 0) {
      const distToRes = resistanceWall - spotPrice;
      if (distToRes > 40 || distToRes < -5) wallScore += 4; // Clear room to rise or breakout
      else wallScore += 2;
    } else {
      wallScore += 2;
    }
    score += Math.min(8, wallScore);
  } else {
    let wallScore = 0;
    if (resistanceWall > 0 && spotPrice <= resistanceWall) wallScore += 4; // Rejecting from resistance
    else if (resistanceWall === 0) wallScore += 2;

    if (supportWall > 0) {
      const distToSup = spotPrice - supportWall;
      if (distToSup > 40 || distToSup < -5) wallScore += 4; // Clear room to fall or breakdown
      else wallScore += 2;
    } else {
      wallScore += 2;
    }
    score += Math.min(8, wallScore);
  }

  // ── 4. OI Buildup Dynamics (0-5 pts) ──────────────────────────
  if (direction === "BUY_CE") {
    if (netCeType === "SHORT_COVER" || netPeType === "SHORT_BUILD") score += 5; // CE short cover / PE short build (Put writing)
    else if (netCeType === "LONG_BUILD" || netCeType === "NEUTRAL") score += 3;
    else score += 1;
  } else {
    if (netCeType === "SHORT_BUILD" || netPeType === "LONG_BUILD") score += 5;  // CE short build (Call writing) / PE long build
    else if (netPeType === "SHORT_COVER" || netPeType === "NEUTRAL") score += 3;
    else score += 1;
  }

  return Math.min(40, score);
}

// ── Momentum Score (0-35 pts) ─────────────────────────────────────────────────
function scoreMomentum(direction: "BUY_CE" | "BUY_PE", momentum: MomentumStateResult): number {
  if (!momentum) return 15; // Neutral fallback

  const momScore  = momentum.momentumScore   ?? 50;
  const momDir    = (momentum as any).direction ?? "FLAT";
  const isExhaust = (momentum as any).isExhausted ?? false;

  let score = 0;

  // ── 1. Raw Momentum Score (0-20 pts) ─────────────────────────
  score += Math.round((momScore / 100) * 20);

  // ── 2. Direction Alignment (0-10 pts) ────────────────────────
  const isCE = direction === "BUY_CE";
  if (isCE && momDir === "UP")         score += 10;
  else if (isCE && momDir === "FLAT")  score += 5;
  else if (!isCE && momDir === "DOWN") score += 10;
  else if (!isCE && momDir === "FLAT") score += 5;
  else score += 1; // Counter-momentum

  // ── 3. High Momentum & Speed Bonus (+5 pts) ──────────────────
  if (momScore >= 75) score += 5;

  // ── 4. Exhaustion Penalty (-5 pts) ───────────────────────────
  if (isExhaust) score = Math.max(0, score - 5);

  return Math.min(35, score);
}

// ── AI Signal & History Score (0-25 pts) ──────────────────────────────────────
function scoreAI(aiConfidence: number, instrument: string): number {
  let score = 0;

  // ── 1. AI Confidence → Points (0-20 pts) ─────────────────────
  if (aiConfidence >= 80)      score += 20;
  else if (aiConfidence >= 70) score += 17;
  else if (aiConfidence >= 60) score += 14;
  else if (aiConfidence >= 50) score += 10;
  else if (aiConfidence >= 40) score += 6;
  else                         score += 2;

  // ── 2. Recent Streak Check (-8 to +5 pts) ────────────────────
  try {
    const recent = getPaperTrades("CLOSED")
      .filter(t => t.instrument === instrument)
      .slice(0, 5);
    let streak = 0;
    for (const t of recent) { if ((t.pnl ?? 0) < 0) streak++; else break; }

    if (streak === 0 && (recent[0]?.pnl ?? 0) > 0) score += 5; // Winning streak bonus
    else if (streak >= 4) score = Math.max(0, score - 8); // Severe loss streak penalty
    else if (streak >= 2) score = Math.max(0, score - 3); // Mild loss streak penalty
  } catch {}

  // ── 3. VIX Adjustment ─────────────────────────────────────────
  const vix = marketState.niftyOptionChain.indiaVix || 15;
  if (vix > 28)      score = Math.max(0, score - 5); // Extreme volatility risk
  else if (vix < 11) score = Math.max(0, score - 3); // Compressed premium risk

  return Math.min(25, Math.max(0, score));
}

// ── MAIN ENGINE ───────────────────────────────────────────────────────────────
export function evaluateAIBrain(
  instrument:   string,
  spotPrice:    number,
  rawDirection: string,
  aiConfidence: number,
  report:       CompleteMarketReport,
  momentum:     MomentumStateResult,
): AIBrainResult {
  const direction = normalizeDirection(rawDirection);

  // Hard block: market hours only (9:15 AM – 3:30 PM)
  const { h, m } = getISTTime();
  const totalMin = h * 60 + m;
  const inMarketHours = totalMin >= 9 * 60 + 15 && totalMin <= 15 * 60 + 30;

  if (!inMarketHours) {
    return {
      allowTrade: false, totalScore: 0,
      oiScore: 0, momentumScore: 0, aiScore: 0,
      grade: "BLOCK",
      summary: `🚫 [AIBrain] Market closed`,
      reason:  `Outside market hours`,
    };
  }

  const oiScore       = scoreOI(direction, report, spotPrice);
  const momentumPts   = scoreMomentum(direction, momentum);
  const aiScore       = scoreAI(aiConfidence, instrument);
  const totalScore    = oiScore + momentumPts + aiScore;

  // ── Grade & Decision ──────────────────────────────────────────
  let grade: AIBrainResult["grade"];
  let allowTrade: boolean;

  if (totalScore >= 75)      { grade = "STRONG"; allowTrade = true;  }
  else if (totalScore >= 60) { grade = "GOOD";   allowTrade = true;  }
  else if (totalScore >= 50) { grade = "WEAK";   allowTrade = true;  }
  else                       { grade = "BLOCK";  allowTrade = false; }

  const pcr = (report?.oi as any)?.pcr ?? 1.0;
  const reason = `OI:${oiScore}/40 | Mom:${momentumPts}/35 | AI:${aiScore}/25 | PCR:${pcr.toFixed(2)}`;

  const summary = allowTrade
    ? `✅ [AIBrain] ${instrument} ${direction} | ${totalScore}/100 (${grade}) | ${reason}`
    : `🚫 [AIBrain] ${instrument} BLOCKED | ${totalScore}/100 | ${reason}`;

  return { allowTrade, totalScore, oiScore, momentumScore: momentumPts, aiScore, grade, summary, reason };
}
