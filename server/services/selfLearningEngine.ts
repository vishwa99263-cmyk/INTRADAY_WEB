/**
 * selfLearningEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Self-Learning Engine — Har trade ke result se seekhta hai
 *
 * Kaise kaam karta hai:
 *  1. Har trade close pe → pattern record karo (regime, time, PCR, breadth, etc.)
 *  2. Har 10 trades ke baad → patterns analyse karo
 *  3. Poor win rate patterns ko block karo / threshold badhaao
 *  4. High win rate patterns ko promote karo / threshold ghataao
 *  5. Confidence multiplier (0.6x – 1.4x) provide karo per pattern
 *
 * SQLite table: te_learning_patterns
 * Persists across server restarts.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TimeSlot      = "OPENING" | "MID_MORNING" | "MIDDAY" | "AFTERNOON" | "CLOSING";
export type RegimeBucket  = "TRENDING" | "RANGE" | "VOLATILE" | "BREAKOUT";
export type PcrBucket     = "LOW" | "NEUTRAL" | "HIGH";
export type BreadthBucket = "WEAK" | "MODERATE" | "STRONG";
export type VixBucket     = "LOW" | "NORMAL" | "HIGH";
export type MomBucket     = "WEAK" | "MODERATE" | "STRONG";

export interface TradePattern {
  timeSlot:        TimeSlot;
  regime:          RegimeBucket;
  pcrBucket:       PcrBucket;
  breadthBucket:   BreadthBucket;
  vixBucket:       VixBucket;
  momentumBucket:  MomBucket;
  direction:       "BUY_CE" | "BUY_PE";
  strategyName:    string;
}

export interface LearningRecord {
  patternKey:    string;    // JSON stringified pattern
  wins:          number;
  losses:        number;
  totalPnl:      number;
  winRate:       number;
  avgPnl:        number;
  lastUpdated:   number;   // timestamp
  isBlocked:     boolean;  // true if blocked after repeated losses
  blockedUntil:  number;   // timestamp when block expires
  adjustedBonus: number;   // -15 to +15 confidence adjustment
}

export interface LearningInsights {
  totalTrades:      number;
  overallWinRate:   number;
  bestPattern:      LearningRecord | null;
  worstPattern:     LearningRecord | null;
  blockedPatterns:  number;
  topWinRates:      Array<{ pattern: TradePattern; record: LearningRecord }>;
  promotedPatterns: Array<{ pattern: TradePattern; record: LearningRecord & { isPromoted: boolean; statusLabel: string } }>;
  sandboxPatterns:  Array<{ pattern: TradePattern; record: LearningRecord & { isPromoted: boolean; statusLabel: string } }>;
  improvements:     string[];   // What the AI learned / changed this week
  confidenceMultiplier: number; // Global multiplier based on recent performance
}

// ── DB Setup ───────────────────────────────────────────────────────────────────

const DB_PATH = path.join(process.cwd(), "server", "storage", "indicators.db");

function getDB(): Database.Database {
  if (!fs.existsSync(DB_PATH)) return null as any;
  const db = new Database(DB_PATH, { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS te_learning_patterns (
      pattern_key    TEXT PRIMARY KEY,
      wins           INTEGER DEFAULT 0,
      losses         INTEGER DEFAULT 0,
      total_pnl      REAL DEFAULT 0,
      last_updated   INTEGER,
      is_blocked     INTEGER DEFAULT 0,
      blocked_until  INTEGER DEFAULT 0,
      adjusted_bonus REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS te_learning_trades (
      id             TEXT PRIMARY KEY,
      pattern_key    TEXT NOT NULL,
      direction      TEXT NOT NULL,
      strategy_name  TEXT NOT NULL,
      outcome        TEXT NOT NULL,
      pnl            REAL DEFAULT 0,
      confidence     REAL DEFAULT 0,
      timestamp      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tlt_pattern ON te_learning_trades(pattern_key);
    CREATE INDEX IF NOT EXISTS idx_tlt_ts      ON te_learning_trades(timestamp DESC);
  `);
  return db;
}

// ── Pattern Key Builder ────────────────────────────────────────────────────────

function buildPatternKey(pattern: TradePattern): string {
  return [
    pattern.timeSlot,
    pattern.regime,
    pattern.pcrBucket,
    pattern.breadthBucket,
    pattern.vixBucket,
    pattern.momentumBucket,
    pattern.direction,
    pattern.strategyName,
  ].join("|");
}

// ── Bucket Classifiers ─────────────────────────────────────────────────────────

export function getTimeSlot(hour: number, minute: number): TimeSlot {
  const totalMins = hour * 60 + minute;
  if (totalMins < 10 * 60)           return "OPENING";      // 9:15 – 10:00
  if (totalMins < 11 * 60 + 30)      return "MID_MORNING";  // 10:00 – 11:30
  if (totalMins < 13 * 60)           return "MIDDAY";        // 11:30 – 13:00
  if (totalMins < 14 * 60 + 30)      return "AFTERNOON";     // 13:00 – 14:30
  return "CLOSING";                                           // 14:30 – 15:30
}

export function getPcrBucket(pcr: number): PcrBucket {
  if (pcr > 1.15)  return "HIGH";
  if (pcr < 0.85)  return "LOW";
  return "NEUTRAL";
}

export function getBreadthBucket(score: number): BreadthBucket {
  if (score >= 65) return "STRONG";
  if (score >= 40) return "MODERATE";
  return "WEAK";
}

export function getVixBucket(vix: number): VixBucket {
  if (vix < 13)  return "LOW";
  if (vix <= 20) return "NORMAL";
  return "HIGH";
}

export function getMomBucket(score: number): MomBucket {
  if (score >= 65) return "STRONG";
  if (score >= 40) return "MODERATE";
  return "WEAK";
}

export function getRegimeBucket(regime: string): RegimeBucket {
  if (regime.includes("TRENDING") || regime === "TRENDING") return "TRENDING";
  if (regime.includes("BREAK"))                              return "BREAKOUT";
  if (regime.includes("VOLAT"))                              return "VOLATILE";
  return "RANGE";
}

// ── Core Functions ─────────────────────────────────────────────────────────────

/**
 * Record a trade result and update learning patterns
 * Called when a paper trade is closed
 */
export function recordTradeResult(params: {
  tradeId:       string;
  pattern:       TradePattern;
  outcome:       "WIN" | "LOSS" | "BREAKEVEN";
  pnl:           number;
  confidence:    number;
}): void {
  try {
    const db = getDB();
    if (!db) return;

    const patternKey = buildPatternKey(params.pattern);
    const isWin   = params.outcome === "WIN";
    const isLoss  = params.outcome === "LOSS";

    // ── Upsert pattern record ──────────────────────────────────────────────
    const existing = db.prepare(
      "SELECT * FROM te_learning_patterns WHERE pattern_key = ?"
    ).get(patternKey) as LearningRecord | undefined;

    if (!existing) {
      db.prepare(`
        INSERT INTO te_learning_patterns (pattern_key, wins, losses, total_pnl, last_updated, is_blocked, blocked_until, adjusted_bonus)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0)
      `).run(patternKey, isWin ? 1 : 0, isLoss ? 1 : 0, params.pnl, Date.now());
    } else {
      db.prepare(`
        UPDATE te_learning_patterns
        SET wins = wins + ?, losses = losses + ?, total_pnl = total_pnl + ?, last_updated = ?
        WHERE pattern_key = ?
      `).run(isWin ? 1 : 0, isLoss ? 1 : 0, params.pnl, Date.now(), patternKey);
    }

    // ── Record trade in history ────────────────────────────────────────────
    db.prepare(`
      INSERT INTO te_learning_trades (id, pattern_key, direction, strategy_name, outcome, pnl, confidence, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.tradeId, patternKey,
      params.pattern.direction, params.pattern.strategyName,
      params.outcome, params.pnl, params.confidence, Date.now()
    );

    // ── Analyze and adjust pattern ─────────────────────────────────────────
    analyzeAndAdjustPattern(db, patternKey);

    db.close();
  } catch (err: any) {
    console.error("[SelfLearning] recordTradeResult error:", err.message);
  }
}

/**
 * After each trade result, re-analyze the pattern and adjust thresholds
 */
function analyzeAndAdjustPattern(db: Database.Database, patternKey: string): void {
  const record = db.prepare(
    "SELECT * FROM te_learning_patterns WHERE pattern_key = ?"
  ).get(patternKey) as any;

  if (!record) return;

  const total    = record.wins + record.losses;
  if (total < 5) return; // Need at least 5 trades to judge

  const winRate  = (record.wins / total) * 100;
  const avgPnl   = record.total_pnl / total;

  let adjustedBonus = 0;
  let isBlocked     = false;
  let blockedUntil  = 0;

  // ── Adjust confidence bonus based on win rate ──────────────────────────
  if (winRate >= 70) {
    adjustedBonus = 12;   // Great pattern → boost confidence by 12%
  } else if (winRate >= 60) {
    adjustedBonus = 6;    // Good pattern → boost by 6%
  } else if (winRate >= 50) {
    adjustedBonus = 0;    // Neutral
  } else if (winRate >= 35) {
    adjustedBonus = -8;   // Poor pattern → raise threshold by 8%
  } else if (winRate >= 20) {
    adjustedBonus = -15;  // Bad pattern → raise threshold by 15%
    if (total >= 10) {
      // Block for 24 hours if consistently bad
      isBlocked    = true;
      blockedUntil = Date.now() + 24 * 60 * 60 * 1000;
      console.log(`[SelfLearning] BLOCKED pattern "${patternKey}" (WinRate ${winRate.toFixed(0)}%, ${total} trades)`);
    }
  } else {
    // Very bad: < 20% win rate
    adjustedBonus = -20;
    isBlocked     = true;
    blockedUntil  = Date.now() + 48 * 60 * 60 * 1000; // 48hr block
    console.log(`[SelfLearning] HARD BLOCKED "${patternKey}" (WinRate ${winRate.toFixed(0)}%, avgPnl ₹${avgPnl.toFixed(0)})`);
  }

  db.prepare(`
    UPDATE te_learning_patterns
    SET adjusted_bonus = ?, is_blocked = ?, blocked_until = ?
    WHERE pattern_key = ?
  `).run(adjustedBonus, isBlocked ? 1 : 0, blockedUntil, patternKey);
}

/**
 * Get confidence bonus for a specific pattern (before placing trade)
 * Returns: -20 to +12 (applied to AI confidence)
 */
export function getConfidenceBonus(pattern: TradePattern): number {
  try {
    const db = getDB();
    if (!db) return 0;

    const patternKey = buildPatternKey(pattern);
    const record = db.prepare(
      "SELECT adjusted_bonus, is_blocked, blocked_until, wins, losses FROM te_learning_patterns WHERE pattern_key = ?"
    ).get(patternKey) as any;

    db.close();

    if (!record) return 0; // No history → neutral

    // Check if blocked
    if (record.is_blocked && Date.now() < record.blocked_until) {
      return -999; // Signal to block this pattern
    }

    return record.adjusted_bonus || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a pattern is blocked
 */
export function isPatternBlocked(pattern: TradePattern): boolean {
  const bonus = getConfidenceBonus(pattern);
  return bonus <= -999;
}

/**
 * Get all learning insights for the dashboard
 */
export function getLearningInsights(): LearningInsights {
  let db: any = null;
  try {
    db = getDB();
    if (!db) return buildEmptyInsights();

    const allPatterns = db.prepare(
      "SELECT * FROM te_learning_patterns ORDER BY last_updated DESC"
    ).all() as any[];

    const totalTradesRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM te_learning_trades"
    ).get() as any;

    const totalTrades = totalTradesRow?.cnt || 0;

    if (allPatterns.length === 0) {
      db.close();
      return buildEmptyInsights();
    }

    // Fetch closed real trades for automatic demotion check
    let recentRealTrades: { pnl: number; notes: string }[] = [];
    try {
      recentRealTrades = db.prepare(
        "SELECT pnl, notes FROM te_paper_trades WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT 50"
      ).all() as { pnl: number; notes: string }[];
    } catch (e: any) {
      console.warn("[SelfLearning] Could not fetch real trades for demotion check:", e.message);
    }

    // Calculate win rates
    const withWinRate = allPatterns.map((p: any) => {
      const total   = p.wins + p.losses;
      const winRate = total > 0 ? (p.wins / total) * 100 : 0;
      const avgPnl  = total > 0 ? p.total_pnl / total : 0;
      return { ...p, winRate, avgPnl, total };
    }).filter((p: any) => p.total >= 3); // Only count patterns with 3+ trades

    const overallWins   = allPatterns.reduce((s: number, p: any) => s + p.wins, 0);
    const overallLosses = allPatterns.reduce((s: number, p: any) => s + p.losses, 0);
    const overallTotal  = overallWins + overallLosses;
    const overallWinRate = overallTotal > 0 ? (overallWins / overallTotal) * 100 : 0;

    // Best / worst patterns
    const sorted = [...withWinRate].sort((a: any, b: any) => b.winRate - a.winRate);
    const best   = sorted[0] || null;
    const worst  = sorted[sorted.length - 1] || null;

    const blockedCount = allPatterns.filter(
      (p: any) => p.is_blocked && Date.now() < p.blocked_until
    ).length;

    // Top 5 best patterns
    const topWinRates = sorted.slice(0, 5).map((p: any) => ({
      pattern: parsePatternKey(p.pattern_key),
      record: {
        patternKey: p.pattern_key,
        wins: p.wins,
        losses: p.losses,
        totalPnl: p.total_pnl,
        winRate: p.winRate,
        avgPnl: p.avgPnl,
        lastUpdated: p.last_updated,
        isBlocked: p.is_blocked === 1,
        blockedUntil: p.blocked_until,
        adjustedBonus: p.adjusted_bonus,
      } as LearningRecord,
    }));

    // Categorize all patterns into promotedPatterns vs sandboxPatterns
    const promotedPatterns: any[] = [];
    const sandboxPatterns: any[] = [];

    for (const p of allPatterns) {
      const total = p.wins + p.losses;
      const winRate = total > 0 ? (p.wins / total) * 100 : 0;
      const avgPnl = total > 0 ? p.total_pnl / total : 0;
      const parsedKey = parsePatternKey(p.pattern_key);

      let isPromoted = total >= 3 && winRate >= 65;
      let statusLabel = total < 3 ? `Sandbox (${total}/3 trades)` : (winRate >= 65 ? "Promoted" : `Sandbox (Win Rate: ${winRate.toFixed(1)}%)`);

      if (isPromoted) {
        // Demotion check
        const matchingTrades: { pnl: number }[] = [];
        for (const t of recentRealTrades) {
          try {
            const parsed = JSON.parse(t.notes || "{}");
            if (parsed.patternKey === p.pattern_key) {
              matchingTrades.push(t);
            }
          } catch {}
          if (matchingTrades.length >= 5) break;
        }

        if (matchingTrades.length >= 5) {
          const winsCount = matchingTrades.filter(t => t.pnl > 0).length;
          const recentWinRate = (winsCount / matchingTrades.length) * 100;
          if (recentWinRate < 55) {
            isPromoted = false;
            statusLabel = `Demoted (Win Rate: ${recentWinRate.toFixed(1)}% < 55% over last 5 real trades)`;
          }
        }
      }

      const patternObj = {
        pattern: parsedKey,
        record: {
          patternKey: p.pattern_key,
          wins: p.wins,
          losses: p.losses,
          totalPnl: p.total_pnl,
          winRate,
          avgPnl,
          lastUpdated: p.last_updated,
          isBlocked: p.is_blocked === 1,
          blockedUntil: p.blocked_until,
          adjustedBonus: p.adjusted_bonus,
          isPromoted,
          statusLabel
        }
      };

      if (isPromoted) {
        promotedPatterns.push(patternObj);
      } else {
        sandboxPatterns.push(patternObj);
      }
    }

    // Generate improvements list
    const improvements: string[] = [];
    if (best && best.winRate >= 65) {
      improvements.push(`✅ Best pattern: ${best.winRate.toFixed(0)}% win rate on "${best.pattern_key.split("|")[0]} ${best.pattern_key.split("|")[6]}" trades (+${best.adjusted_bonus}% confidence boost)`);
    }
    if (worst && worst.winRate <= 35 && worst.total >= 5) {
      improvements.push(`⚠ Weak pattern: "${worst.pattern_key.split("|")[0]}" at ${worst.winRate.toFixed(0)}% win rate (threshold raised -${Math.abs(worst.adjusted_bonus)}%)`);
    }
    if (blockedCount > 0) {
      improvements.push(`🚫 ${blockedCount} pattern(s) temporarily blocked due to poor performance`);
    }

    // Overall multiplier based on recent performance
    let confidenceMultiplier = 1.0;
    if (overallWinRate >= 65) confidenceMultiplier = 1.15;
    else if (overallWinRate >= 55) confidenceMultiplier = 1.05;
    else if (overallWinRate <= 35) confidenceMultiplier = 0.85;
    else if (overallWinRate <= 45) confidenceMultiplier = 0.95;

    db.close();

    return {
      totalTrades,
      overallWinRate,
      bestPattern: best ? {
        patternKey: best.pattern_key,
        wins: best.wins, losses: best.losses,
        totalPnl: best.total_pnl, winRate: best.winRate, avgPnl: best.avgPnl,
        lastUpdated: best.last_updated, isBlocked: false, blockedUntil: 0,
        adjustedBonus: best.adjusted_bonus,
      } : null,
      worstPattern: worst ? {
        patternKey: worst.pattern_key,
        wins: worst.wins, losses: worst.losses,
        totalPnl: worst.total_pnl, winRate: worst.winRate, avgPnl: worst.avgPnl,
        lastUpdated: worst.last_updated, isBlocked: worst.is_blocked === 1,
        blockedUntil: worst.blocked_until, adjustedBonus: worst.adjusted_bonus,
      } : null,
      blockedPatterns: blockedCount,
      topWinRates,
      promotedPatterns,
      sandboxPatterns,
      improvements,
      confidenceMultiplier,
    };
  } catch (err: any) {
    console.error("[SelfLearning] getLearningInsights error:", err.message);
    if (db) {
      try { db.close(); } catch {}
    }
    return buildEmptyInsights();
  }
}

function buildEmptyInsights(): LearningInsights {
  return {
    totalTrades: 0, overallWinRate: 0,
    bestPattern: null, worstPattern: null,
    blockedPatterns: 0, topWinRates: [],
    promotedPatterns: [], sandboxPatterns: [],
    improvements: ["AI is still learning — trade more to generate insights!"],
    confidenceMultiplier: 1.0,
  };
}

function parsePatternKey(key: string): TradePattern {
  const parts = key.split("|");
  return {
    timeSlot:       (parts[0] || "OPENING")  as TimeSlot,
    regime:         (parts[1] || "RANGE")    as RegimeBucket,
    pcrBucket:      (parts[2] || "NEUTRAL")  as PcrBucket,
    breadthBucket:  (parts[3] || "MODERATE") as BreadthBucket,
    vixBucket:      (parts[4] || "NORMAL")   as VixBucket,
    momentumBucket: (parts[5] || "MODERATE") as MomBucket,
    direction:      (parts[6] || "BUY_CE")   as "BUY_CE" | "BUY_PE",
    strategyName:   parts[7] || "UNKNOWN",
  };
}

/**
 * Reset all learning data (for manual override)
 */
export function resetLearningData(): void {
  try {
    const db = getDB();
    if (!db) return;
    db.prepare("DELETE FROM te_learning_patterns").run();
    db.prepare("DELETE FROM te_learning_trades").run();
    db.close();
    console.log("[SelfLearning] All learning data reset.");
  } catch (err: any) {
    console.error("[SelfLearning] resetLearningData error:", err.message);
  }
}

// -------------------------------------------------------------------------------
// AMEX v3.0 � Continuous Self-Learning Controller
// Server-side singleton: runs even when browser tab changes or is minimized
// -------------------------------------------------------------------------------

import { globalBus } from "./globalDataBus";
import { DEFAULT_LAYER_WEIGHTS } from "../../src/engine/weightedScoringEngine";

const APPROVAL_FILE = path.join(process.cwd(), "server", "storage", "sl_approval.json");
const WEIGHTS_FILE  = path.join(process.cwd(), "server", "storage", "layer_weights.json");

interface SLApprovalState {
  approved:       boolean;
  approvedAt:     number;
  totalApprovals: number;
  lastRun:        number;
  pendingEntries: Array<{ tradeId: string; strategyId: string; direction: string; layerState: any; entryTime: number }>;
}

class ContinuousSelfLearning {
  private approval: SLApprovalState;
  private recalibTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer:    ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.approval = this.loadApproval();
    if (this.approval.approved) {
      console.log("[SelfLearning v3] Resuming from previous approval");
      this.startBackground();
    }
  }

  private loadApproval(): SLApprovalState {
    try { if (fs.existsSync(APPROVAL_FILE)) return JSON.parse(fs.readFileSync(APPROVAL_FILE, "utf-8")); } catch {}
    return { approved: false, approvedAt: 0, totalApprovals: 0, lastRun: 0, pendingEntries: [] };
  }

  private saveApproval(): void {
    try { fs.writeFileSync(APPROVAL_FILE, JSON.stringify(this.approval, null, 2)); } catch {}
  }

  needsPermission(): boolean {
    const sevenDays = 7 * 24 * 3600 * 1000;
    return !this.approval.approved || (Date.now() - this.approval.approvedAt > sevenDays);
  }

  userApprove(): void {
    this.approval.approved = true;
    this.approval.approvedAt = Date.now();
    this.approval.totalApprovals++;
    this.saveApproval();
    this.startBackground();
    globalBus.updateSelfLearning(true, ["Learning approved - background analysis started"], 0);
  }

  userDeny(): void { this.approval.approved = false; this.saveApproval(); }
  isActive(): boolean { return this.approval.approved; }

  logTradeEntry(tradeId: string, strategyId: string, direction: string, layerState: any): void {
    if (!this.approval.approved) return;
    this.approval.pendingEntries.push({ tradeId, strategyId, direction, layerState, entryTime: Date.now() });
    this.saveApproval();
  }

  logTradeClose(tradeId: string, pnl: number): void {
    if (!this.approval.approved) return;
    const idx = this.approval.pendingEntries.findIndex(e => e.tradeId === tradeId);
    if (idx !== -1) { this.approval.pendingEntries.splice(idx, 1); }
    this.approval.lastRun = Date.now();
    this.saveApproval();
    if (this.approval.pendingEntries.length % 5 === 0) this.recalibrateWeights();
  }

  private startBackground(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      try { const i = getLearningInsights(); globalBus.updateSelfLearning(true, i.improvements ?? [], i.totalTrades); } catch {}
    }, 30000);
    if (this.recalibTimer) clearInterval(this.recalibTimer);
    this.recalibTimer = setInterval(() => {
      const now = new Date(Date.now() + 5.5 * 3600 * 1000);
      const hhmm = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (hhmm >= 935 && hhmm <= 940) {
        const lastD = new Date(this.approval.lastRun + 5.5 * 3600 * 1000).toDateString();
        if (lastD !== now.toDateString()) { this.recalibrateWeights(); }
      }
    }, 60000);
  }

  recalibrateWeights(): void {
    try {
      const insights = getLearningInsights();
      if (insights.totalTrades < 3) return;
      const w: Record<string, number> = { ...(DEFAULT_LAYER_WEIGHTS as any) };
      if (fs.existsSync(WEIGHTS_FILE)) { Object.assign(w, JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf-8")).weights ?? {}); }
      for (const { pattern, record } of insights.topWinRates) {
        if (record.winRate >= 70 && pattern.regime === "TRENDING") w["L1_REGIME"] = Math.min(28, (w["L1_REGIME"] ?? 20) + 0.5);
        if (record.winRate >= 70 && pattern.timeSlot === "OPENING") w["L13_SESSION"] = Math.min(12, (w["L13_SESSION"] ?? 5) + 0.5);
      }
      globalBus.saveWeights(w);
      this.approval.lastRun = Date.now();
      this.saveApproval();
      globalBus.updateSelfLearning(true, ["Weights recalibrated from " + insights.totalTrades + " trades"], insights.totalTrades);
    } catch (e) { console.error("[SelfLearning v3] recalibrate error:", e); }
  }

  getStatus() {
    return { needsPermission: this.needsPermission(), isActive: this.approval.approved, approvedAt: this.approval.approvedAt, lastRun: this.approval.lastRun, pendingTrades: this.approval.pendingEntries.length };
  }

  forceRecalibrate(): void { this.recalibrateWeights(); }
  resetAll(): void { resetLearningData(); globalBus.saveWeights({} as any); }
}

export const continuousSelfLearning = new ContinuousSelfLearning();


/**
 * Get dynamic tuning multipliers for Micro Scalp Engine targets based on past performance
 */
export function getMicroScalpTuning(scalpType: string): { targetMult: number; slMult: number } {
  try {
    const db = getDB();
    if (!db) return { targetMult: 1.0, slMult: 1.0 };

    const trades = db.prepare(
      "SELECT outcome FROM te_learning_trades WHERE strategy_name LIKE ?"
    ).all(`%${scalpType}%`) as { outcome: string }[];

    db.close();

    const total = trades.length;
    if (total < 3) return { targetMult: 1.0, slMult: 1.0 };

    const wins = trades.filter(t => t.outcome === 'WIN').length;
    const winRate = (wins / total) * 100;

    if (winRate >= 65) {
      return { targetMult: 1.25, slMult: 1.10 };
    } else if (winRate <= 40) {
      return { targetMult: 0.75, slMult: 0.85 };
    }
    
    return { targetMult: 1.0, slMult: 1.0 };
  } catch (err) {
    console.error('[SelfLearning] getMicroScalpTuning error:', err);
    return { targetMult: 1.0, slMult: 1.0 };
  }
}

/**
 * Phase 4 True AI: Dynamically calculate optimal Target and SL multipliers
 * based on recent historical performance for a given pattern.
 * Objective: Optimize for "Big Profits" dynamically.
 */
export function getTrueAITradeTuning(patternKey: string): { targetMult: number; slMult: number; reason: string } {
  try {
    const db = getDB();
    if (!db) return { targetMult: 1.0, slMult: 1.0, reason: "DB Offline" };

    // Fetch the last 20 trades for this exact pattern
    const trades = db.prepare(
      "SELECT outcome, pnl FROM te_learning_trades WHERE pattern_key = ? ORDER BY timestamp DESC LIMIT 20"
    ).all(patternKey) as { outcome: string, pnl: number }[];

    db.close();

    if (trades.length < 3) {
      return { targetMult: 1.0, slMult: 1.0, reason: `AI Exploring Pattern (${trades.length}/3)` };
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = (wins.length / trades.length) * 100;

    let avgWin = 0;
    if (wins.length > 0) {
      avgWin = wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length;
    }

    let avgLoss = 0;
    if (losses.length > 0) {
      avgLoss = losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losses.length;
    }

    // AI True Reinforcement Logic for "Big Profits"
    let targetMult = 1.0;
    let slMult = 1.0;
    let strategyLabel = "Standard AI";

    if (winRate >= 60 && avgWin > avgLoss * 1.5) {
      // High win rate AND big historical wins => Stretch Target for Big Profit, Normal SL
      targetMult = 1.5;
      slMult = 0.9;
      strategyLabel = "Big Profit Hunter (High Conviction)";
    } else if (winRate < 40 && avgLoss > avgWin) {
      // Low win rate and big losses => Tighten SL heavily, shrink target to take whatever we get
      targetMult = 0.8;
      slMult = 0.6;
      strategyLabel = "Defensive Mode (High Risk)";
    } else if (avgWin > avgLoss * 2.5) {
      // Massive outliers => Jackpot pattern
      targetMult = 2.0;
      slMult = 1.0;
      strategyLabel = "Jackpot Breakout (Ultra Big Profit)";
    } else if (winRate >= 70) {
      // Very consistent, but normal RR => push targets slightly
      targetMult = 1.25;
      slMult = 1.0;
      strategyLabel = "High Consistency (Momentum Push)";
    }

    return {
      targetMult,
      slMult,
      reason: `AI Phase 4: ${strategyLabel} [WinRate: ${winRate.toFixed(0)}%, AvgWin: ₹${avgWin.toFixed(0)}, AvgLoss: ₹${avgLoss.toFixed(0)}]`
    };
  } catch (err) {
    console.error('[SelfLearning] getTrueAITradeTuning error:', err);
    return { targetMult: 1.0, slMult: 1.0, reason: "Error computing AI tuning" };
  }
}

