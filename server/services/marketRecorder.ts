import { db } from "../storage/db.js";

// Decoupled Buffer Queue Spool Arrays
let tickBuffer: any[][] = [];
let optionSnapshotBuffer: any[][] = [];
let strikeDetailBuffer: any[][] = [];
let heavyweightBuffer: any[][] = [];
let scoreBuffer: any[][] = [];

const BATCH_INTERVAL_MS = 250;
let recorderInterval: ReturnType<typeof setInterval> | null = null;

/** Start background batch writing thread loop */
export function startRecorder(): void {
  if (recorderInterval) return;

  console.log("[MarketRecorder] 🟢 Spooled batch-queue recorder initialized.");
  recorderInterval = setInterval(async () => {
    await flushBuffers();
  }, BATCH_INTERVAL_MS);
}

/** Stop recorder loop cleanly */
export function stopRecorder(): void {
  if (recorderInterval) {
    clearInterval(recorderInterval);
    recorderInterval = null;
  }
}

/** Asynchronously flush all spooled queues using Postgres Bulk Copy/Insert operations */
async function flushBuffers() {
  // 1. Flush Ticks Queue
  if (tickBuffer.length > 0) {
    const batch = [...tickBuffer];
    tickBuffer = [];
    db.bulkInsert("raw_ticks", [
      "timestamp", "symbol", "ltp", "volume", "bid", "ask", "bid_qty", "ask_qty", "oi", "vwap"
    ], batch).catch(err => {
      console.error("[MarketRecorder] ❌ Failed to flush raw_ticks batch:", err.message);
    });
  }

  // 2. Flush Option Chain Snapshots Queue
  if (optionSnapshotBuffer.length > 0) {
    const batch = [...optionSnapshotBuffer];
    optionSnapshotBuffer = [];
    db.bulkInsert("option_chain_snapshots", [
      "timestamp", "index_symbol", "atm_strike", "pcr", "max_pain",
      "support_zone", "resistance_zone", "total_call_oi", "total_put_oi",
      "ce_writing_vol", "pe_writing_vol", "ce_unwinding_oi", "pe_unwinding_oi"
    ], batch).catch(err => {
      console.error("[MarketRecorder] ❌ Failed to flush option_chain_snapshots batch:", err.message);
    });
  }

  // 3. Flush Strike Detail Matrix Queue
  if (strikeDetailBuffer.length > 0) {
    const batch = [...strikeDetailBuffer];
    strikeDetailBuffer = [];
    db.bulkInsert("option_strike_details", [
      "timestamp", "index_symbol", "strike_price", "ce_ltp", "ce_oi", "ce_oi_change",
      "ce_volume", "ce_iv", "pe_ltp", "pe_oi", "pe_oi_change", "pe_volume", "pe_iv"
    ], batch).catch(err => {
      console.error("[MarketRecorder] ❌ Failed to flush option_strike_details batch:", err.message);
    });
  }

  // 4. Flush Heavyweights Queue
  if (heavyweightBuffer.length > 0) {
    const batch = [...heavyweightBuffer];
    heavyweightBuffer = [];
    db.bulkInsert("heavyweight_contributions", [
      "timestamp", "index_symbol", "stock_symbol", "ltp", "weightage",
      "contribution_points", "contribution_pct", "momentum_score", "acceleration_score", "divergence_score"
    ], batch).catch(err => {
      console.error("[MarketRecorder] ❌ Failed to flush heavyweight_contributions batch:", err.message);
    });
  }

  // 5. Flush Custom Score Warehouse Queue
  if (scoreBuffer.length > 0) {
    const batch = [...scoreBuffer];
    scoreBuffer = [];
    db.bulkInsert("custom_score_warehouse", [
      "timestamp", "index_symbol", "top10_pos_sum", "top10_neg_sum", "top25_pos_sum", "top25_neg_sum",
      "live_momentum_diff", "heavyweight_net_score", "confidence_score", "market_strength", "internal_breadth"
    ], batch).catch(err => {
      console.error("[MarketRecorder] ❌ Failed to flush custom_score_warehouse batch:", err.message);
    });
  }
}

// ── Ingestion Helpers called by WebSocket Feed Ticks ─────────────────────────

/** Enqueue raw index or stock tick */
export function recordTick(
  symbol: string,
  ltp: number,
  volume: number,
  bid: number,
  ask: number,
  bidQty = 0,
  askQty = 0,
  oi = 0,
  vwap = 0
): void {
  const ts = new Date().toISOString();
  tickBuffer.push([ts, symbol, ltp, volume, bid, ask, bidQty, askQty, oi, vwap]);
}

/** Enqueue detailed option chain metadata snapshot */
export function recordOptionSnapshot(
  indexSymbol: string,
  atmStrike: number,
  pcr: number,
  maxPain: number,
  supportZone: number,
  resistanceZone: number,
  totalCallOi: number,
  totalPutOi: number,
  ceWritingVol = 0,
  peWritingVol = 0,
  ceUnwindingOi = 0,
  peUnwindingOi = 0
): void {
  const ts = new Date().toISOString();
  optionSnapshotBuffer.push([
    ts, indexSymbol, atmStrike, pcr, maxPain, supportZone, resistanceZone,
    totalCallOi, totalPutOi, ceWritingVol, peWritingVol, ceUnwindingOi, peUnwindingOi
  ]);
}

/** Enqueue single strike option detail matrix log */
export function recordStrikeDetail(
  indexSymbol: string,
  strikePrice: number,
  ceLtp: number,
  ceOi: number,
  ceOiChange: number,
  ceVolume: number,
  ceIv: number,
  peLtp: number,
  peOi: number,
  peOiChange: number,
  peVolume: number,
  peIv: number
): void {
  const ts = new Date().toISOString();
  strikeDetailBuffer.push([
    ts, indexSymbol, strikePrice, ceLtp, ceOi, ceOiChange, ceVolume, ceIv,
    peLtp, peOi, peOiChange, peVolume, peIv
  ]);
}

/** Enqueue index stock heavyweight contribution metrics */
export function recordHeavyweight(
  indexSymbol: string,
  stockSymbol: string,
  ltp: number,
  weightage: number,
  contributionPoints: number,
  contributionPct: number,
  momentumScore: number,
  accelerationScore: number,
  divergenceScore: number
): void {
  const ts = new Date().toISOString();
  heavyweightBuffer.push([
    ts, indexSymbol, stockSymbol, ltp, weightage, contributionPoints,
    contributionPct, momentumScore, accelerationScore, divergenceScore
  ]);
}

/** Enqueue custom performance indicators and breadths */
export function recordCustomScores(
  indexSymbol: string,
  top10Pos: number,
  top10Neg: number,
  top25Pos: number,
  top25Neg: number,
  liveMomentumDiff: number,
  heavyweightNetScore: number,
  confidenceScore: number,
  marketStrength: number,
  internalBreadth: number
): void {
  const ts = new Date().toISOString();
  scoreBuffer.push([
    ts, indexSymbol, top10Pos, top10Neg, top25Pos, top25Neg,
    liveMomentumDiff, heavyweightNetScore, confidenceScore, marketStrength, internalBreadth
  ]);
}
