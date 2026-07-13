/**
 * governorService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX-OS Governor — Master Safety Controller
 *
 * Responsibilities:
 *  1. Daily Loss Circuit Breaker   → ₹2,000 paper loss = auto-halt all new trades
 *  2. Consecutive Loss Guard       → 3 losses in a row = 30 min cooldown
 *  3. VIX Hard Gate                → VIX > 25 = pause all buying
 *  4. Emergency Kill Switch        → Manual halt via API
 *  5. Health Score                 → Live 0-100 score broadcast every 10s
 *  6. Broadcast                    → globalDataBus mein governor state update
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { globalBus } from "./globalDataBus.js";

// ── Config ─────────────────────────────────────────────────────────────────────
const GOVERNOR_CONFIG = {
  maxDailyLoss:        -2000,   // ₹ paper loss limit per day
  consecutiveLossMax:  3,       // Halt after N consecutive losses
  consecutiveCooldownMs: 30 * 60 * 1000, // 30 min cooldown
  vixHardGate:         25,      // VIX above this → pause buying
  healthCheckIntervalMs: 10000, // Broadcast every 10s
};

const DB_PATH   = path.join(process.cwd(), "server", "storage", "indicators.db");
const STATE_FILE = path.join(process.cwd(), "server", "storage", "governor_state.json");

// ── Types ──────────────────────────────────────────────────────────────────────
export interface GovernorState {
  killSwitch:          boolean;       // Manual emergency halt
  killSwitchReason:    string;
  circuitBreaker:      boolean;       // Auto daily-loss halt
  circuitBreakerReason: string;
  vixHalted:           boolean;
  consecutiveLossHalt: boolean;
  cooldownUntil:       number;        // Timestamp
  healthScore:         number;        // 0-100
  performanceScore:    number;        // 0-100 (win rate today)
  safetyScore:         number;        // 0-100
  riskScore:           number;        // 0-100 (drawdown %)
  dailyPnl:            number;        // Today's closed P&L
  dailyWins:           number;
  dailyLosses:         number;
  consecutiveLosses:   number;
  allTimeWinRate:      number;
  blockedPatterns:     number;
  lastUpdated:         number;
  version:             string;
}

const DEFAULT_STATE: GovernorState = {
  killSwitch:           false,
  killSwitchReason:     "",
  circuitBreaker:       false,
  circuitBreakerReason: "",
  vixHalted:            false,
  consecutiveLossHalt:  false,
  cooldownUntil:        0,
  healthScore:          100,
  performanceScore:     50,
  safetyScore:          100,
  riskScore:            0,
  dailyPnl:             0,
  dailyWins:            0,
  dailyLosses:          0,
  consecutiveLosses:    0,
  allTimeWinRate:       0,
  blockedPatterns:      0,
  lastUpdated:          Date.now(),
  version:              "AMEX-OS v4.0",
};

// ── Governor Service ───────────────────────────────────────────────────────────
class GovernorService {
  private state: GovernorState = { ...DEFAULT_STATE };
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.loadState();
    this.startHealthTicker();
    console.log("[Governor] 🛡️ AMEX-OS Governor initialized");
  }

  // ── Persistence ─────────────────────────────────────────────────────────────
  private loadState(): void {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
        // Only keep manual kill switch state across restarts
        this.state.killSwitch = saved.killSwitch ?? false;
        this.state.killSwitchReason = saved.killSwitchReason ?? "";
        console.log(`[Governor] Kill switch restored: ${this.state.killSwitch}`);
      }
    } catch { /* fresh state */ }
  }

  private saveState(): void {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        killSwitch: this.state.killSwitch,
        killSwitchReason: this.state.killSwitchReason,
      }, null, 2));
    } catch { /* ignore */ }
  }

  // ── DB Helpers ───────────────────────────────────────────────────────────────
  private getDB(): Database.Database | null {
    try {
      if (!fs.existsSync(DB_PATH)) return null;
      return new Database(DB_PATH, { timeout: 3000 });
    } catch { return null; }
  }

  private getTodayStats(): { pnl: number; wins: number; losses: number; consecutiveLosses: number } {
    const db = this.getDB();
    if (!db) return { pnl: 0, wins: 0, losses: 0, consecutiveLosses: 0 };
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const ts = todayStart.getTime();

      const rows = db.prepare(`
        SELECT pnl FROM te_paper_trades
        WHERE status = 'CLOSED' AND closed_at >= ?
        ORDER BY closed_at DESC
      `).all(ts) as { pnl: number }[];

      const pnl = rows.reduce((s, r) => s + (r.pnl || 0), 0);
      const wins = rows.filter(r => r.pnl > 0).length;
      const losses = rows.filter(r => r.pnl < 0).length;

      // Consecutive losses (most recent streak)
      let consecutiveLosses = 0;
      for (const r of rows) {
        if (r.pnl < 0) consecutiveLosses++;
        else break;
      }

      db.close();
      return { pnl, wins, losses, consecutiveLosses };
    } catch {
      try { db.close(); } catch { }
      return { pnl: 0, wins: 0, losses: 0, consecutiveLosses: 0 };
    }
  }

  private getAllTimeWinRate(): number {
    const db = this.getDB();
    if (!db) return 0;
    try {
      const row = db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins
        FROM te_paper_trades WHERE status = 'CLOSED'
      `).get() as { total: number; wins: number };
      db.close();
      return row.total > 0 ? Math.round((row.wins / row.total) * 100) : 0;
    } catch {
      try { db.close(); } catch { }
      return 0;
    }
  }

  private getBlockedPatternsCount(): number {
    const db = this.getDB();
    if (!db) return 0;
    try {
      const row = db.prepare(`
        SELECT COUNT(*) as cnt FROM te_learning_patterns
        WHERE is_blocked = 1 AND blocked_until > ?
      `).get(Date.now()) as { cnt: number };
      db.close();
      return row.cnt;
    } catch {
      try { db.close(); } catch { }
      return 0;
    }
  }

  // ── Health Score Calculation ─────────────────────────────────────────────────
  private computeScores(stats: ReturnType<typeof this.getTodayStats>, allTimeWinRate: number): void {
    const { pnl, wins, losses, consecutiveLosses } = stats;
    const total = wins + losses;
    const todayWinRate = total > 0 ? (wins / total) * 100 : 50;

    // Performance: today's win rate
    this.state.performanceScore = Math.round(todayWinRate);

    // Risk: how close to daily loss limit
    const lossRatio = Math.abs(Math.min(0, pnl)) / Math.abs(GOVERNOR_CONFIG.maxDailyLoss);
    this.state.riskScore = Math.round(Math.min(100, lossRatio * 100));

    // Safety: circuit breaker + VIX + consecutive loss state
    let safetyDeductions = 0;
    if (this.state.circuitBreaker)      safetyDeductions += 50;
    if (this.state.vixHalted)           safetyDeductions += 30;
    if (this.state.consecutiveLossHalt) safetyDeductions += 20;
    if (consecutiveLosses >= 2)         safetyDeductions += 10;
    this.state.safetyScore = Math.max(0, 100 - safetyDeductions);

    // Health: composite
    const winRateHealth  = Math.min(100, allTimeWinRate > 0 ? allTimeWinRate : 50);
    const riskHealth     = 100 - this.state.riskScore;
    const safetyHealth   = this.state.safetyScore;
    this.state.healthScore = Math.round((winRateHealth * 0.3 + riskHealth * 0.4 + safetyHealth * 0.3));
  }

  // ── Main Governor Tick ───────────────────────────────────────────────────────
  private runGovernorCheck(): void {
    const stats = this.getTodayStats();
    const allTimeWinRate = this.getAllTimeWinRate();
    const blockedPatterns = this.getBlockedPatternsCount();
    const vix = (globalBus.getField("indiaVix") as number) || 0;

    // ── 1. Daily Loss Circuit Breaker ──
    if (stats.pnl <= GOVERNOR_CONFIG.maxDailyLoss && !this.state.circuitBreaker) {
      this.state.circuitBreaker = true;
      this.state.circuitBreakerReason = `Daily loss ₹${Math.abs(stats.pnl).toFixed(0)} exceeded limit ₹${Math.abs(GOVERNOR_CONFIG.maxDailyLoss)}`;
      console.warn(`[Governor] 🔴 CIRCUIT BREAKER: ${this.state.circuitBreakerReason}`);
      globalBus.addLog(`Governor: Circuit Breaker triggered — ${this.state.circuitBreakerReason}`, "warn");
    }
    // Auto-reset at midnight (new day)
    if (stats.pnl > GOVERNOR_CONFIG.maxDailyLoss && this.state.circuitBreaker && !this.state.killSwitch) {
      this.state.circuitBreaker = false;
      this.state.circuitBreakerReason = "";
    }

    // ── 2. VIX Hard Gate ──
    if (vix > GOVERNOR_CONFIG.vixHardGate) {
      if (!this.state.vixHalted) {
        this.state.vixHalted = true;
        console.warn(`[Governor] ⚠️ VIX GATE: VIX=${vix.toFixed(1)} > ${GOVERNOR_CONFIG.vixHardGate} — buying paused`);
        globalBus.addLog(`Governor: VIX Gate active — VIX ${vix.toFixed(1)} > ${GOVERNOR_CONFIG.vixHardGate}`, "warn");
      }
    } else if (vix > 0 && this.state.vixHalted) {
      this.state.vixHalted = false;
    }

    // ── 3. Consecutive Loss Guard ──
    if (stats.consecutiveLosses >= GOVERNOR_CONFIG.consecutiveLossMax) {
      const cooldownExpired = Date.now() > this.state.cooldownUntil;
      if (cooldownExpired) {
        this.state.consecutiveLossHalt = true;
        this.state.cooldownUntil = Date.now() + GOVERNOR_CONFIG.consecutiveCooldownMs;
        const cooldownMins = GOVERNOR_CONFIG.consecutiveCooldownMs / 60000;
        console.warn(`[Governor] ⚠️ CONSECUTIVE LOSS HALT: ${stats.consecutiveLosses} losses in a row — ${cooldownMins}min cooldown`);
        globalBus.addLog(`Governor: Consecutive loss halt — ${stats.consecutiveLosses} losses, ${cooldownMins}min cooldown`, "warn");
      }
    } else if (Date.now() > this.state.cooldownUntil) {
      this.state.consecutiveLossHalt = false;
    }

    // ── Update state ──
    Object.assign(this.state, {
      dailyPnl:          stats.pnl,
      dailyWins:         stats.wins,
      dailyLosses:       stats.losses,
      consecutiveLosses: stats.consecutiveLosses,
      allTimeWinRate:    allTimeWinRate,
      blockedPatterns:   blockedPatterns,
      lastUpdated:       Date.now(),
    });

    this.computeScores(stats, allTimeWinRate);

    // Broadcast to dashboard
    (globalBus as any).updateGovernor(this.state);
  }

  // ── Background Ticker ────────────────────────────────────────────────────────
  private startHealthTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => {
      try { this.runGovernorCheck(); } catch (e) {
        console.error("[Governor] Tick error:", e);
      }
    }, GOVERNOR_CONFIG.healthCheckIntervalMs);
    // Run immediately on start
    setTimeout(() => { try { this.runGovernorCheck(); } catch { } }, 2000);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** True if ALL new trade entries should be blocked */
  isKillSwitchActive(): boolean {
    return (
      this.state.killSwitch ||
      this.state.circuitBreaker ||
      this.state.vixHalted ||
      (this.state.consecutiveLossHalt && Date.now() < this.state.cooldownUntil)
    );
  }

  /** Reason string for why trades are blocked */
  getHaltReason(): string {
    if (this.state.killSwitch)         return `Manual Kill Switch: ${this.state.killSwitchReason || "User activated"}`;
    if (this.state.circuitBreaker)     return this.state.circuitBreakerReason;
    if (this.state.vixHalted)          return `VIX Gate: VIX too high (>${GOVERNOR_CONFIG.vixHardGate})`;
    if (this.state.consecutiveLossHalt) {
      const minsLeft = Math.ceil((this.state.cooldownUntil - Date.now()) / 60000);
      return `Consecutive Loss Cooldown: ${minsLeft} min remaining`;
    }
    return "";
  }

  getState(): GovernorState { return { ...this.state }; }

  /** Manual kill switch — engage */
  engageKillSwitch(reason = "Manual emergency halt"): void {
    this.state.killSwitch = true;
    this.state.killSwitchReason = reason;
    this.saveState();
    console.warn(`[Governor] 🔴 KILL SWITCH ENGAGED: ${reason}`);
    globalBus.addLog(`Governor: Kill Switch ENGAGED — ${reason}`, "warn");
    this.runGovernorCheck();
  }

  /** Manual kill switch — restore */
  restoreSystem(): void {
    this.state.killSwitch = false;
    this.state.killSwitchReason = "";
    this.state.circuitBreaker = false;
    this.state.circuitBreakerReason = "";
    this.state.consecutiveLossHalt = false;
    this.state.cooldownUntil = 0;
    this.saveState();
    console.log("[Governor] 🟢 System RESTORED");
    globalBus.addLog("Governor: System Restored — all halts cleared", "info");
    this.runGovernorCheck();
  }

  /** Force a manual health check */
  forceCheck(): void { this.runGovernorCheck(); }
}

export const governorService = new GovernorService();
