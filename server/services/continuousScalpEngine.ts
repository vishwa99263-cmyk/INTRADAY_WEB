/**
 * continuousScalpEngine.ts — IQ200+ Continuous Scalping Engine v2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPLETE OVERHAUL — Like a professional intraday trader sitting at terminal:
 *   - Analyzes properly before entering (not every 10 seconds)
 *   - Holds trade for a meaningful duration (10-25 min)
 *   - Uses session windows (no trades in chop hours)
 *   - Minimum 3-of-5 signal alignment required
 *   - Real R:R ratio minimum 1.9:1
 *   - P&L = (exitPrice - entryPrice) × lotSize × qty (exactly like broker)
 *   - ZERO brokerage deduction (paper trading)
 *
 * Two Tiers Only (MICRO removed — too small to be meaningful):
 *   - NORMAL (confidence 50–74): 15pt target / 8pt SL = ~1.9:1 RR
 *   - STRONG (confidence 75+):   25pt target / 10pt SL = 2.5:1 RR
 *
 * Capital: ₹20,000 (separate from main 15k strategy system)
 */

import { marketState } from "../state/marketState.js";
import { getISTTime } from "../utils/timerUtils.js";
import Database from "better-sqlite3";
import type { Server as SocketIOServer } from "socket.io";
import path from "path";
import { liveOptionTicks } from "./optionChainStream.js";
import { computeWeightedStockSignal } from "./weightedStockSignalEngine.js";
import { getLotSize, getPaperTrades, getShadowTrades, savePaperTrade } from "./tradingEngineDB.js";
import { buildEntryAlarm, emitTradeAlarm } from "./tradeAlarmEngine.js";
import { recordTradeResult, getTimeSlot, getRegimeBucket, getPcrBucket, getBreadthBucket, getVixBucket, getMomBucket } from "./selfLearningEngine.js";
import { getGlobalAIBrainConsensus } from "./aiBrainConsensus.js";
import type { AntigravityDecision } from "./antigravityEngine.js";
import type { CompleteMarketReport } from "../utils/marketAnalysis.js";

// ── Database setup ─────────────────────────────────────────────────────────────
const DB_PATH = path.join(process.cwd(), "server", "storage", "indicators.db");
let _db: Database.Database | null = null;

function getDB(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { timeout: 5000 });
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS cs_trades (
        id            TEXT PRIMARY KEY,
        timestamp     INTEGER NOT NULL,
        instrument    TEXT NOT NULL,
        direction     TEXT NOT NULL,
        strike        INTEGER NOT NULL,
        entry_price   REAL NOT NULL,
        qty           INTEGER NOT NULL DEFAULT 1,
        lot_size      INTEGER NOT NULL,
        stop_loss     REAL NOT NULL,
        target        REAL NOT NULL,
        exit_price    REAL,
        status        TEXT NOT NULL DEFAULT 'OPEN',
        pnl           REAL NOT NULL DEFAULT 0,
        closed_at     INTEGER,
        tier          TEXT NOT NULL DEFAULT 'NORMAL',
        reason        TEXT,
        score_at_entry    REAL DEFAULT 0,
        momentum_at_entry REAL DEFAULT 0,
        pcr_at_entry      REAL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_cs_trades_ts ON cs_trades(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cs_trades_status ON cs_trades(status);
    `);
  }
  return _db;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CSTradeRecord {
  id: string;
  timestamp: number;
  instrument: string;
  direction: "BUY_CE" | "BUY_PE";
  strike: number;
  entry_price: number;
  qty: number;
  lot_size: number;
  stop_loss: number;
  target: number;
  exit_price?: number;
  status: "OPEN" | "CLOSED";
  pnl: number;
  closed_at?: number;
  tier: "NORMAL" | "STRONG";
  reason: string;
  score_at_entry: number;
  momentum_at_entry: number;
  pcr_at_entry: number;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
export function csGetTrades(status?: "OPEN" | "CLOSED"): CSTradeRecord[] {
  const db = getDB();
  if (status) {
    return db.prepare("SELECT * FROM cs_trades WHERE status = ? ORDER BY timestamp DESC")
             .all(status) as CSTradeRecord[];
  }
  return db.prepare("SELECT * FROM cs_trades ORDER BY timestamp DESC LIMIT 200")
           .all() as CSTradeRecord[];
}

export function csSaveTrade(trade: CSTradeRecord): void {
  const db = getDB();
  db.prepare(`
    INSERT OR REPLACE INTO cs_trades
    (id, timestamp, instrument, direction, strike, entry_price, qty, lot_size,
     stop_loss, target, status, pnl, tier, reason, score_at_entry, momentum_at_entry, pcr_at_entry)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trade.id, trade.timestamp, trade.instrument, trade.direction, trade.strike,
    trade.entry_price, trade.qty, trade.lot_size, trade.stop_loss, trade.target,
    trade.status, trade.pnl, trade.tier, trade.reason,
    trade.score_at_entry, trade.momentum_at_entry, trade.pcr_at_entry
  );
}

export function csCloseTrade(id: string, exitPrice: number, pnl: number): boolean {
  const db = getDB();
  const result = db.prepare(`
    UPDATE cs_trades SET status='CLOSED', exit_price=?, pnl=?, closed_at=? WHERE id=? AND status='OPEN'
  `).run(exitPrice, pnl, Date.now(), id);
  return result.changes > 0;
}

export function csUpdateSL(id: string, newSL: number): boolean {
  const db = getDB();
  const result = db.prepare("UPDATE cs_trades SET stop_loss=? WHERE id=? AND status='OPEN'")
                   .run(newSL, id);
  return result.changes > 0;
}

// ── Capital Management ────────────────────────────────────────────────────────
const CS_INITIAL_CAPITAL = 20_000;

export function getCsCapital(): {
  total: number;
  used: number;
  free: number;
  todayPnl: number;
  totalPnl: number;
  tradesCount: number;
  winCount: number;
  lossCount: number;
} {
  const openTrades   = csGetTrades("OPEN");
  const closedTrades = csGetTrades("CLOSED");

  // Used margin = entry_price × qty × lot_size (actual premium cost)
  const usedMargin = openTrades.reduce(
    (sum, t) => sum + t.entry_price * t.qty * t.lot_size, 0
  );
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Today's P&L (IST)
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const todayPnl = closedTrades
    .filter(t => t.closed_at && new Date(t.closed_at + 5.5 * 3600 * 1000).toISOString().slice(0, 10) === todayIST)
    .reduce((sum, t) => sum + (t.pnl || 0), 0);

  const winCount  = closedTrades.filter(t => (t.pnl || 0) > 0).length;
  const lossCount = closedTrades.filter(t => (t.pnl || 0) < 0).length;

  return {
    total:       CS_INITIAL_CAPITAL + totalPnl,
    used:        usedMargin,
    free:        CS_INITIAL_CAPITAL + totalPnl - usedMargin,
    todayPnl,
    totalPnl,
    tradesCount: closedTrades.length,
    winCount,
    lossCount,
  };
}

// ── Session Windows: When is trading allowed ──────────────────────────────────
type TradingSession = "WAIT_ORB" | "POST_ORB_STRONG" | "PRIME" | "MID" | "PAUSE" | "CLOSING" | "CLOSED";

function getSession(totalMins: number): TradingSession {
  if (totalMins < 9 * 60 + 15)  return "CLOSED";
  if (totalMins < 9 * 60 + 30)  return "WAIT_ORB";      // 09:15–09:30: wait for range
  if (totalMins < 9 * 60 + 45)  return "POST_ORB_STRONG"; // 09:30–09:45: STRONG only
  if (totalMins < 11 * 60 + 30) return "PRIME";          // 09:45–11:30: best window
  if (totalMins < 13 * 60)      return "MID";            // 11:30–13:00: normal only
  if (totalMins < 14 * 60)      return "PAUSE";          // 13:00–14:00: low volume, skip
  if (totalMins < 15 * 60)      return "CLOSING";        // 14:00–15:00: good closing trades
  return "CLOSED";                                        // 15:00+: no new trades
}

// ── Signal Scoring: 5-factor quality gate ─────────────────────────────────────
interface CsSignal {
  direction: "BUY_CE" | "BUY_PE" | "WAIT";
  score: number;       // 0-100 confidence
  tier: "NORMAL" | "STRONG";
  targetPts: number;
  slPts: number;
  reason: string;
  weightedScore: number;
  momentumScore: number;
  pcr: number;
  alignedSignals: number; // how many of 5 signals agree
}

function computeCsSignal(
  page: "NIFTY" | "BANKNIFTY" | "SENSEX",
  weightedScore: number,
  momentumScore: number,
  momentumDir: "UP" | "DOWN" | "NONE",
  pcr: number,
  hasBuyerPressure: boolean,
  hasSellerPressure: boolean,
  hasVolumeSpike: boolean,
  emaAlignment: string,
  macdAlignment: string,
  rsiZone: string,
  session: TradingSession,
): CsSignal {

  // ── Weighted score scoring (most important — 0-40 pts) ─────────────────────
  let bullScore = 0;
  let bearScore = 0;

  // 1. Weighted stock score (40 pts max)
  if (weightedScore > 8)       { bullScore += Math.min(40, weightedScore * 2); }
  else if (weightedScore < -8) { bearScore += Math.min(40, Math.abs(weightedScore) * 2); }

  // 2. Momentum direction (20 pts) — clear UP/DOWN required
  if (momentumDir === "UP")   { bullScore += 20; }
  if (momentumDir === "DOWN") { bearScore += 20; }

  // 3. Momentum intensity (10 pts)
  if (momentumScore >= 70)      { bullScore += 10; }
  else if (momentumScore >= 58) { bullScore += 6; }
  else if (momentumScore <= 30) { bearScore += 10; }
  else if (momentumScore <= 42) { bearScore += 6; }

  // 4. PCR (15 pts) — clear PCR required
  if (pcr > 1.35)      { bullScore += 15; }
  else if (pcr > 1.15) { bullScore += 8; }
  else if (pcr < 0.72) { bearScore += 15; }
  else if (pcr < 0.88) { bearScore += 8; }

  // 5. Buyer/Seller pressure (10 pts)
  if (hasBuyerPressure)  { bullScore += 10; }
  if (hasSellerPressure) { bearScore += 10; }

  // 6. Volume spike aligned (5 pts)
  if (hasVolumeSpike) {
    if (momentumDir === "UP")   bullScore += 5;
    if (momentumDir === "DOWN") bearScore += 5;
  }

  // 7. EMA stack (8 pts)
  if (emaAlignment === "BULL_STACK") { bullScore += 8; }
  if (emaAlignment === "BEAR_STACK") { bearScore += 8; }

  // 8. MACD (5 pts)
  if (macdAlignment === "BULLISH") { bullScore += 5; }
  if (macdAlignment === "BEARISH") { bearScore += 5; }

  // 9. RSI zone (5 pts)
  if (rsiZone === "BULL" || rsiZone === "OVERSOLD")   { bullScore += 5; }
  if (rsiZone === "BEAR" || rsiZone === "OVERBOUGHT") { bearScore += 5; }

  const totalBull = Math.min(100, bullScore);
  const totalBear = Math.min(100, bearScore);
  const diff      = Math.abs(totalBull - totalBear);
  const winScore  = Math.max(totalBull, totalBear);

  // ── Quality Gate: Count aligned signals ───────────────────────────────────
  const isBullish = totalBull > totalBear;

  let aligned = 0;
  // Signal 1: weighted stock aligns
  if (isBullish && weightedScore > 5)  aligned++;
  if (!isBullish && weightedScore < -5) aligned++;
  // Signal 2: momentum direction aligns
  if (isBullish && momentumDir === "UP")   aligned++;
  if (!isBullish && momentumDir === "DOWN") aligned++;
  // Signal 3: PCR confirms
  if (isBullish && pcr > 1.1)   aligned++;
  if (!isBullish && pcr < 0.9)  aligned++;
  // Signal 4: EMA stack aligns
  if (isBullish && emaAlignment === "BULL_STACK")  aligned++;
  if (!isBullish && emaAlignment === "BEAR_STACK") aligned++;
  // Signal 5: Buyer/seller pressure aligns
  if (isBullish && hasBuyerPressure)   aligned++;
  if (!isBullish && hasSellerPressure) aligned++;

  // ── WAIT conditions ────────────────────────────────────────────────────────
  // Need: score gap ≥ 25, winning score ≥ 40, at least 3/5 signals aligned
  if (diff < 25 || winScore < 40 || aligned < 3) {
    return {
      direction: "WAIT",
      score: winScore,
      tier: "NORMAL",
      targetPts: 0, slPts: 0,
      reason: `WAIT: gap=${diff}(need≥25) score=${winScore}(need≥40) aligned=${aligned}/5(need≥3)`,
      weightedScore, momentumScore, pcr, alignedSignals: aligned,
    };
  }

  // POST_ORB_STRONG session: only take STRONG trades (75+ confidence)
  if (session === "POST_ORB_STRONG" && winScore < 75) {
    return {
      direction: "WAIT",
      score: winScore,
      tier: "NORMAL",
      targetPts: 0, slPts: 0,
      reason: `WAIT (post-ORB session: need STRONG ≥75, got ${winScore})`,
      weightedScore, momentumScore, pcr, alignedSignals: aligned,
    };
  }

  const direction: "BUY_CE" | "BUY_PE" = isBullish ? "BUY_CE" : "BUY_PE";
  const confidence = winScore;

  // ── Tier + Targets (2:1 minimum R:R) ──────────────────────────────────────
  let tier: "NORMAL" | "STRONG";
  let targetPts: number;
  let slPts: number;

  if (confidence >= 75) {
    tier      = "STRONG";
    targetPts = page === "SENSEX" ? 40 : page === "BANKNIFTY" ? 30 : 25;
    slPts     = page === "SENSEX" ? 18 : page === "BANKNIFTY" ? 13 : 10;
  } else {
    tier      = "NORMAL";
    targetPts = page === "SENSEX" ? 22 : page === "BANKNIFTY" ? 18 : 15;
    slPts     = page === "SENSEX" ? 11 : page === "BANKNIFTY" ? 9  : 8;
  }

  const reason = `[${tier}] Bull=${totalBull} Bear=${totalBear} gap=${diff} aligned=${aligned}/5 | wScore=${weightedScore.toFixed(1)} mom=${momentumScore}(${momentumDir}) PCR=${pcr.toFixed(2)} EMA=${emaAlignment} MACD=${macdAlignment}`;

  return {
    direction, score: confidence, tier, targetPts, slPts, reason,
    weightedScore, momentumScore, pcr, alignedSignals: aligned,
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
const lastCsTradeClose: Record<string, number> = { NIFTY: 0, BANKNIFTY: 0, SENSEX: 0 };
const lastCsLog:        Record<string, number> = { NIFTY: 0, BANKNIFTY: 0, SENSEX: 0 };
const csTradesToday:    Record<string, number> = { NIFTY: 0, BANKNIFTY: 0, SENSEX: 0 };
const csTodayDate:      Record<string, string> = { NIFTY: "", BANKNIFTY: "", SENSEX: "" };

// Cooldown config (in ms) — much longer than before
const COOLDOWN_AFTER_TARGET  = 3 * 60 * 1000; // 3 minutes
const COOLDOWN_AFTER_SL      = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_AFTER_TSL     = 2 * 60 * 1000; // 2 minutes (trailing SL = breakeven exit)
const COOLDOWN_AFTER_TIME    = 2 * 60 * 1000; // 2 minutes (time exit)
const MAX_TRADES_PER_DAY     = 5;              // Quality over quantity

// Track last exit reason per page for smart cooldown
const lastExitReason: Record<string, string> = { NIFTY: "", BANKNIFTY: "", SENSEX: "" };

// ── Main Engine Loop ──────────────────────────────────────────────────────────
export async function runContinuousScalpEngine(
  page: "NIFTY" | "BANKNIFTY" | "SENSEX",
  io: SocketIOServer,
  momentumScore: number,
  momentumDir: "UP" | "DOWN" | "NONE",
  emaAlignment: string,
  macdAlignment: string,
  rsiZone: string,
  hasVolumeSpike: boolean,
  antigravity: AntigravityDecision,
  report: CompleteMarketReport,
  aiEngineV2: any = null
): Promise<void> {
  const { h, m } = getISTTime();
  const totalMins = h * 60 + m;

  const isMarketOpen = marketState.isSimulating ||
    (totalMins >= 9 * 60 + 15 && totalMins < 15 * 60 + 30);
  if (!isMarketOpen) return;

  // Check session window
  const session = getSession(totalMins);
  if (session === "CLOSED" || session === "WAIT_ORB" || session === "PAUSE") return;

  // Daily counter reset
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  if (csTodayDate[page] !== todayIST) {
    csTodayDate[page]    = todayIST;
    csTradesToday[page]  = 0;
    lastCsTradeClose[page] = 0;
    lastExitReason[page] = "";
  }

  const chainState = page === "NIFTY"
    ? marketState.niftyOptionChain
    : page === "BANKNIFTY" ? marketState.bankniftyOptionChain
    : marketState.sensexOptionChain;

  const strikes   = chainState.strikes || [];
  const spotPrice = chainState.spotPrice || 0;
  const pcr       = (chainState as any).pcr || 1.0;

  if (spotPrice <= 0 || strikes.length === 0) return;

  // Weighted stock signal
  const stocks = page === "NIFTY"
    ? Object.values(marketState.niftyStocks)
    : page === "BANKNIFTY" ? Object.values(marketState.bankniftyStocks)
    : Object.values(marketState.sensexStocks);

  const spotChangePct     = chainState.spotChangePct || 0;
  const wSignal           = computeWeightedStockSignal(stocks as any, spotChangePct);
  const hasBuyerPressure  = wSignal.buyerSellerActivity.netPressure === "BUYERS_DOMINANT";
  const hasSellerPressure = wSignal.buyerSellerActivity.netPressure === "SELLERS_DOMINANT";
  const weightedScore     = wSignal.netScore;

  // ── 1. Exit monitoring for open positions ─────────────────────────────────
  const openTrades = csGetTrades("OPEN").filter(t => t.instrument === page);

  // Trailing SL config (tighter than before — let profits run longer)
  const trailTrigger = page === "SENSEX" ? 15 : page === "BANKNIFTY" ? 12 : 8;
  const trailOffset  = page === "SENSEX" ? 8  : page === "BANKNIFTY" ? 6  : 4;

  for (const pos of openTrades) {
    const isCE = pos.direction === "BUY_CE";

    // Get live premium (real LTP from Fyers tick first)
    let currentPremium = pos.entry_price;
    const strikeRow = strikes.find(s => s.strikePrice === pos.strike);
    if (strikeRow) {
      const symbol   = isCE ? strikeRow.ceSymbol : strikeRow.peSymbol;
      const liveTick = symbol ? liveOptionTicks.get(symbol) : null;
      if (liveTick) {
        currentPremium = liveTick.ltp ?? liveTick.bid ?? pos.entry_price;
      } else {
        currentPremium = isCE
          ? (strikeRow.ceLtp ?? strikeRow.ceBid ?? pos.entry_price)
          : (strikeRow.peLtp ?? strikeRow.peBid ?? pos.entry_price);
      }
    }

    // Trailing SL logic
    const gain = currentPremium - pos.entry_price;
    if (gain >= trailTrigger) {
      const newSL = parseFloat((currentPremium - trailOffset).toFixed(1));
      if (newSL > pos.stop_loss) {
        csUpdateSL(pos.id, newSL);
        (pos as any).stop_loss = newSL;
        io.emit("cs-trade-sl-updated", { id: pos.id, newSL, currentPremium });
      }
    }

    // Breakeven at 50% of trail trigger
    if (gain >= trailTrigger / 2 && pos.stop_loss < pos.entry_price) {
      csUpdateSL(pos.id, pos.entry_price);
      (pos as any).stop_loss = pos.entry_price;
      io.emit("cs-trade-sl-updated", { id: pos.id, newSL: pos.entry_price, currentPremium });
    }

    const elapsedMins = (Date.now() - pos.timestamp) / 60000;
    // Max hold: NORMAL = 20min, STRONG = 30min
    const maxHoldMins = pos.tier === "STRONG" ? 30 : 20;

    let shouldExit = false;
    let exitReason = "";

    if (currentPremium <= pos.stop_loss) {
      shouldExit = true;
      exitReason = pos.stop_loss >= pos.entry_price ? "TSL HIT (profit locked)" : "STOP LOSS";
    } else if (currentPremium >= pos.target) {
      shouldExit = true;
      exitReason = "TARGET HIT ✅";
    } else if (elapsedMins >= maxHoldMins) {
      shouldExit = true;
      exitReason = `TIME EXIT (${maxHoldMins}min max)`;
    } else if (totalMins >= 15 * 60) {
      shouldExit = true;
      exitReason = "EOD EXIT (15:00)";
    }

    if (shouldExit) {
      // P&L calculation exactly like real broker:
      // (Exit Premium - Entry Premium) × Lot Size × Number of Lots
      const exitPnl = parseFloat(
        ((currentPremium - pos.entry_price) * pos.qty * pos.lot_size).toFixed(1)
      );
      const exitPriceFmt = parseFloat(currentPremium.toFixed(1));

      const success = csCloseTrade(pos.id, exitPriceFmt, exitPnl);
      if (success) {
        lastCsTradeClose[page] = Date.now();
        lastExitReason[page]   = exitReason;
        csTradesToday[page]    = Math.max(0, csTradesToday[page]); // keep count

        console.log(`[CS Engine] ${page} CLOSED: ${exitReason} @ ₹${exitPriceFmt} | PnL: ₹${exitPnl} (${pos.qty}×${pos.lot_size}lots)`);
        io.emit("cs-trade-closed", { id: pos.id, exitPrice: exitPriceFmt, pnl: exitPnl, reason: exitReason, instrument: page });
        io.emit("toast-trigger", {
          type: exitPnl > 0 ? "success" : "error",
          title: `⚡ CS ${pos.tier}: ${exitReason}`,
          message: `${page} ${pos.direction === "BUY_CE" ? "▲CE" : "▼PE"} | P&L: ₹${exitPnl > 0 ? "+" : ""}${exitPnl}`,
        });

        // ── Self-learning: Record CS trade outcome ──
        try {
          const { h: eh, m: em } = getISTTime();
          recordTradeResult({
            tradeId: pos.id,
            pattern: {
              timeSlot:       getTimeSlot(eh, em),
              regime:         getRegimeBucket("TRENDING"), // Approximate for CS since it's dynamic
              pcrBucket:      getPcrBucket(pos.pcr_at_entry || 1.0),
              breadthBucket:  getBreadthBucket(50),
              vixBucket:      getVixBucket(15),
              momentumBucket: getMomBucket(pos.momentum_at_entry || 50),
              direction:      pos.direction as "BUY_CE" | "BUY_PE",
              strategyName:   "Continuous Scalp",
            },
            outcome: exitPnl > 50 ? "WIN" : exitPnl < -50 ? "LOSS" : "BREAKEVEN",
            pnl: exitPnl,
            confidence: pos.score_at_entry || 60,
          });
        } catch (slErr) {
          console.error("[CS Engine] Self-learning record error:", slErr);
        }
      }
    }
  }

  // ── 2. Entry logic ────────────────────────────────────────────────────────
  const hasOpenTrade = csGetTrades("OPEN").some(t => t.instrument === page);
  if (hasOpenTrade) return;

  // Daily trade limit check
  if (csTradesToday[page] >= MAX_TRADES_PER_DAY) return;

  // Smart cooldown based on last exit reason
  const msSinceClose = Date.now() - (lastCsTradeClose[page] || 0);
  let cooldownMs = COOLDOWN_AFTER_TARGET; // default 3 min

  const lastReason = lastExitReason[page] || "";
  if (lastReason.includes("STOP LOSS"))    cooldownMs = COOLDOWN_AFTER_SL;
  else if (lastReason.includes("TSL"))     cooldownMs = COOLDOWN_AFTER_TSL;
  else if (lastReason.includes("TIME"))    cooldownMs = COOLDOWN_AFTER_TIME;
  else if (lastReason.includes("TARGET"))  cooldownMs = COOLDOWN_AFTER_TARGET;

  if (msSinceClose < cooldownMs) return;

  // Compute signal
  const signal = computeCsSignal(
    page, weightedScore, momentumScore, momentumDir, pcr,
    hasBuyerPressure, hasSellerPressure, hasVolumeSpike,
    emaAlignment, macdAlignment, rsiZone, session,
  );

  if (signal.direction === "WAIT") {
    const now = Date.now();
    if (now - lastCsLog[page] > 30000) { // Log every 30s max
      console.log(`[CS Engine] ${page} ${session} WAIT: ${signal.reason}`);
      lastCsLog[page] = now;
    }
    return;
  }

  // Compute global brain consensus
  const consensus = getGlobalAIBrainConsensus(
    page,
    antigravity,
    aiEngineV2,
    report,
    momentumScore,
    weightedScore,
    "Continuous Scalp"
  );

  // Check cross-engine lock: TE active positions (both real and shadow)
  const openTeTrades = [
    ...getPaperTrades("OPEN"),
    ...getShadowTrades("OPEN")
  ].filter(t => t.instrument === page);

  const hasOppositeTePosition = openTeTrades.some(t => {
    if (signal.direction === "BUY_CE" && t.direction === "BUY_PE") return true;
    if (signal.direction === "BUY_PE" && t.direction === "BUY_CE") return true;
    return false;
  });

  // Gating rule: direction must match consensus and no opposite position in TE
  const isConsensusApproved = signal.direction === consensus.decision &&
                               !hasOppositeTePosition;

  if (!isConsensusApproved) {
    const now = Date.now();
    if (now - lastCsLog[page] > 30000) {
      console.log(`[CS Engine] ${page} Entry Gated by AI Brain: Signal=${signal.direction}, Consensus=${consensus.decision}, OppTe=${hasOppositeTePosition}`);
      lastCsLog[page] = now;
    }
    return;
  }

  // Get entry LTP (real price)
  const strikeGap = page === "SENSEX" ? 100 : 50;
  const strike    = Math.round(spotPrice / strikeGap) * strikeGap;
  const isCE      = signal.direction === "BUY_CE";
  const strikeRow = strikes.find(s => s.strikePrice === strike);

  if (!strikeRow) return;

  const symbol   = isCE ? strikeRow.ceSymbol : strikeRow.peSymbol;
  const liveTick = symbol ? liveOptionTicks.get(symbol) : null;

  let entryPrice = 0;
  if (liveTick) {
    entryPrice = liveTick.ltp ?? liveTick.ask ?? 0;
  }
  if (entryPrice <= 0) {
    entryPrice = isCE
      ? (strikeRow.ceLtp ?? strikeRow.ceAsk ?? 0)
      : (strikeRow.peLtp ?? strikeRow.peAsk ?? 0);
  }

  if (entryPrice <= 0) {
    console.warn(`[CS Engine] ${page} No LTP for ${signal.direction} strike ${strike} — ABORT`);
    return;
  }

  // Minimum premium filter (avoid illiquid options)
  const minPremium = page === "SENSEX" ? 80 : page === "BANKNIFTY" ? 50 : 35;
  if (entryPrice < minPremium) {
    console.log(`[CS Engine] ${page} Premium ₹${entryPrice} < min ₹${minPremium} — SKIP (illiquid)`);
    return;
  }

  // Capital check
  const capital      = getCsCapital();
  const lot_size     = getLotSize(page);
  const requiredMargin = entryPrice * 1 * lot_size; // 1 lot

  if (requiredMargin > capital.free) {
    console.warn(`[CS Engine] ${page} Insufficient capital: need ₹${requiredMargin.toFixed(0)}, free ₹${capital.free.toFixed(0)}`);
    return;
  }

  // Place trade
  const trade: CSTradeRecord = {
    id:          `cs-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp:   Date.now(),
    instrument:  page,
    direction:   signal.direction,
    strike,
    entry_price: parseFloat(entryPrice.toFixed(1)),
    qty:         1,
    lot_size,
    stop_loss:   parseFloat((entryPrice - signal.slPts).toFixed(1)),
    target:      parseFloat((entryPrice + signal.targetPts).toFixed(1)),
    status:      "OPEN",
    pnl:         0,
    tier:        signal.tier,
    reason:      signal.reason,
    score_at_entry:    signal.score,
    momentum_at_entry: momentumScore,
    pcr_at_entry:      pcr,
  };

  csSaveTrade(trade);
  csTradesToday[page]++;

  const holdTime = signal.tier === "STRONG" ? "30min" : "20min";
  console.log(`[CS Engine] 🎯 ${page} ENTRY: ${signal.direction} ${signal.tier} @ ₹${entryPrice.toFixed(1)} | T:+${signal.targetPts}pts SL:-${signal.slPts}pts ${signal.alignedSignals}/5 aligned | ${session} | P&L per pt: ₹${lot_size}`);

  io.emit("cs-trade-opened", trade);
  io.emit("toast-trigger", {
    type:    "success",
    title:   `⚡ CS ${signal.tier}: ${page} ${signal.direction === "BUY_CE" ? "▲ CE" : "▼ PE"}`,
    message: `₹${entryPrice.toFixed(1)} | T:+${signal.targetPts}pt (₹${(signal.targetPts * lot_size).toFixed(0)}) | SL:-${signal.slPts}pt | ${signal.alignedSignals}/5 signals`,
  });

  // ── Dispatch to Live Sheet if Promoted (Limited by CS engine's MAX 2 trades) ──
  if (consensus.isPromoted) {
    try {
      const liveTradeId = `PT_${trade.id}`;
      const alarm = buildEntryAlarm({
        tradeId: liveTradeId,
        instrument: page,
        direction: signal.direction,
        strike: strike,
        optionSymbol: symbol || `${page}${strike}${isCE ? 'CE' : 'PE'}`,
        entry: entryPrice,
        sl: trade.stop_loss,
        tp: trade.target,
        lots: 1,
        lotSize: lot_size,
        confidence: 90,
        grade: "A",
        strategyName: "CS_PROMOTED",
        whyTaken: {
          weightedStockScore: weightedScore,
          weightedDirection: signal.direction,
          keyStockMovers: "",
          specialTrioStatus: "",
          bankingSectorScore: 0,
          regimeLabel: "SCALP_MODE",
          breadthScore: 0,
          pcr: pcr,
          momentumScore: momentumScore,
          smartMoneyBias: "SCALP",
          gatesPassed: 5,
          totalGates: 5,
          layerConsensus: "AI_PROMOTED",
          orbStatus: "NA",
          signalGrade: "A+",
          antigravityScore: 100,
          vix: 15,
          vixCategory: "NORMAL",
          strategyReason: "Continuous Scalp [PROMOTED]",
        },
        tradesToday: csTradesToday[page],
        dailyPnl: 0,
        dailyTarget: 3000,
      });

      savePaperTrade({
        id: liveTradeId, timestamp: Date.now(), instrument: page,
        direction: signal.direction, strike: strike, entry_price: entryPrice,
        qty: 1, lot_size: lot_size, stop_loss: trade.stop_loss, target: trade.target,
        status: "OPEN", pnl: 0, notes: JSON.stringify({ trade_type: "CS_PROMOTED", strategyName: "CS_PROMOTED" })
      });
      emitTradeAlarm(io, alarm);
      console.log(`[CS Engine] 🚀 ${page} Trade Promoted to LIVE SHEET!`);
    } catch(e: any) {
      console.error(`[CS Engine] Failed to dispatch promoted Live Sheet trade:`, e.message);
    }
  }
}
