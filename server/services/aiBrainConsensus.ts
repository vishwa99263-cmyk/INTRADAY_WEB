/**
 * aiBrainConsensus.ts
 * 
 * Unified Backend AI Brain Consensus Module.
 * Synthesizes Gemini V2 predictions, Antigravity Decisions, and SQLite self-learning
 * pattern statistics to generate a single validated consensus direction and sandbox state.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { AntigravityDecision } from "./antigravityEngine.js";
import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import { getISTTime } from "../utils/timerUtils.js";
import {
  getTimeSlot,
  getRegimeBucket,
  getPcrBucket,
  getBreadthBucket,
  getVixBucket,
  getMomBucket,
  type TradePattern
} from "./selfLearningEngine.js";

const DB_PATH = path.join(process.cwd(), "server", "storage", "indicators.db");

function getConsensusDB(): Database.Database {
  const db = new Database(DB_PATH, { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

export interface PatternStatus {
  isPromoted: boolean;
  winRate: number;
  totalTrades: number;
  reason: string;
}

export function getPatternStatus(patternKey: string): PatternStatus {
  try {
    const db = getConsensusDB();
    const record = db.prepare(
      "SELECT wins, losses FROM te_learning_patterns WHERE pattern_key = ?"
    ).get(patternKey) as { wins: number; losses: number } | undefined;

    if (!record) {
      db.close();
      return { isPromoted: true, winRate: 50, totalTrades: 0, reason: "New Pattern (Auto-Promoted for Discovery)" };
    }

    const total = record.wins + record.losses;
    if (total < 3) {
      db.close();
      return { isPromoted: false, winRate: total > 0 ? (record.wins / total) * 100 : 0, totalTrades: total, reason: `Insufficient trades (${total}/3, Sandbox)` };
    }

    const winRate = (record.wins / total) * 100;
    if (winRate < 50) {
      db.close();
      return { isPromoted: false, winRate, totalTrades: total, reason: `Sandbox (Win Rate: ${winRate.toFixed(1)}% < 50%)` };
    }

    // --- Automatic Demotion Protocol ---
    // If winRate >= 65 and total >= 3, check the last 5 completed real trades for this pattern key
    try {
      const recentRealTrades = db.prepare(
        "SELECT pnl, notes FROM te_paper_trades WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT 50"
      ).all() as { pnl: number; notes: string }[];

      const matchingTrades: { pnl: number }[] = [];
      for (const t of recentRealTrades) {
        try {
          const parsed = JSON.parse(t.notes || "{}");
          if (parsed.patternKey === patternKey) {
            matchingTrades.push(t);
          }
        } catch {}
        if (matchingTrades.length >= 5) break;
      }

      if (matchingTrades.length >= 5) {
        const winsCount = matchingTrades.filter(t => t.pnl > 0).length;
        const recentWinRate = (winsCount / matchingTrades.length) * 100;
        if (recentWinRate < 55) {
          db.close();
          return {
            isPromoted: false,
            winRate,
            totalTrades: total,
            reason: `Demoted (Recent Win Rate: ${recentWinRate.toFixed(1)}% < 55% over last 5 real trades)`
          };
        }
      }
    } catch (dbErr: any) {
      console.warn("[aiBrainConsensus] Demotion check warning:", dbErr.message);
    }

    db.close();
    return { isPromoted: true, winRate, totalTrades: total, reason: `Promoted (Win Rate: ${winRate.toFixed(1)}%)` };
  } catch (err: any) {
    console.error("[aiBrainConsensus] getPatternStatus error:", err.message);
    return { isPromoted: false, winRate: 0, totalTrades: 0, reason: "DB Error (Sandbox)" };
  }
}

export interface AIBrainConsensus {
  decision: "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";
  confidence: number;
  isPromoted: boolean;
  reason: string;
  patternKey: string;
}

export function getGlobalAIBrainConsensus(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  antigravity: AntigravityDecision,
  aiEngineV2: any,
  report: CompleteMarketReport,
  momentumScore: number,
  weightedScore: number,
  strategyName: string = "Micro Scalp"
): AIBrainConsensus {
  // 1. Fetch raw decisions
  const geminiDir = aiEngineV2?.tradeSetup?.direction || "WAIT";
  const antiSignal = antigravity.finalSignal || "WAIT";

  // 2. Build consensus direction
  let decision: AIBrainConsensus["decision"] = "WAIT";
  let reason = "";

  if (geminiDir === antiSignal && (geminiDir === "BUY_CE" || geminiDir === "BUY_PE")) {
    decision = geminiDir;
    reason = `Absolute Agreement: Gemini & Antigravity both say ${geminiDir}`;
  } else if (geminiDir === "BUY_PE" && antiSignal === "BUY_CE") {
    decision = "WAIT";
    reason = `Conflict Gating: Gemini PE vs Antigravity CE (Blocked)`;
  } else if (geminiDir === "BUY_CE" && antiSignal === "BUY_PE") {
    decision = "WAIT";
    reason = `Conflict Gating: Gemini CE vs Antigravity PE (Blocked)`;
  } else {
    // Partial agreement / neutral
    const trend = report.trend.overall || "RANGE";
    if (geminiDir === "BUY_PE" || antiSignal === "BUY_PE") {
      if (weightedScore < -5 || trend === "BEARISH") {
        decision = "BUY_PE";
        reason = `Bearish Bias: Partial signal with bearish macro support`;
      }
    } else if (geminiDir === "BUY_CE" || antiSignal === "BUY_CE") {
      if (weightedScore > 5 || trend === "BULLISH") {
        decision = "BUY_CE";
        reason = `Bullish Bias: Partial signal with bullish macro support`;
      }
    }
  }

  // 3. Compute current pattern key
  const { h, m } = getISTTime();
  const timeSlot = getTimeSlot(h, m);
  const regime = getRegimeBucket(report.trend.overall || "RANGE");
  const pcrBucket = getPcrBucket(report.oi.pcr || 1.0);
  const breadthBucket = getBreadthBucket(report.trend.strengthPct || 50);
  const vixBucket = getVixBucket(antigravity.indiaVix || 15);
  const momentumBucket = getMomBucket(momentumScore);
  const patternDir = (decision === "BUY_PE") ? "BUY_PE" : "BUY_CE";

  const patternKey = [
    timeSlot,
    regime,
    pcrBucket,
    breadthBucket,
    vixBucket,
    momentumBucket,
    patternDir,
    strategyName
  ].join("|");

  // 4. Query sandbox vs promotion status
  const status = getPatternStatus(patternKey);

  // Multi-Timeframe (MTF) Trend Gating:
  // If proposed direction is BUY_CE but 1-hour trend is BEARISH, downgrade promotion status.
  // If proposed direction is BUY_PE but 1-hour trend is BULLISH, downgrade promotion status.
  let isPromoted = status.isPromoted;
  let promotionReason = status.reason;
  if (isPromoted) {
    const trend1h = report.trend.trend1h;
    if (decision === "BUY_CE" && trend1h === "BEARISH") {
      isPromoted = false;
      promotionReason = `Downgraded to Sandbox: BUY_CE counter-trend to 1h BEARISH trend`;
    } else if (decision === "BUY_PE" && trend1h === "BULLISH") {
      isPromoted = false;
      promotionReason = `Downgraded to Sandbox: BUY_PE counter-trend to 1h BULLISH trend`;
    }
  }

  return {
    decision,
    confidence: Math.max(antigravity.confidence, aiEngineV2?.tradeSetup?.confidence || 50),
    isPromoted,
    reason: `${reason} | Sandbox Status: ${promotionReason}`,
    patternKey
  };
}
