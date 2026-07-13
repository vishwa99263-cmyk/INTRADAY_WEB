import { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";
import { compileMarketReport, CompleteMarketReport } from "../utils/marketAnalysis.js";
import { MarketSpeedTracker } from "../utils/speedAnalysis.js";
import { updateBreakoutEngine, getBreakoutState, BreakoutState } from "./breakoutEngine.js";
import { calculateMomentumState, MomentumStateResult } from "./momentumEngine.js";
import { generateExpiryStrategySetups, AIStrategySetup } from "./expiryStrategyEngine.js";
import { getDailyBias } from "./positionStructureEngine.js";
import { checkAndTriggerAlerts, getAlertHistory, checkCustomAlerts, AIAlert } from "./alertEngine.js";
import { analyzeSmartMoney, SmartMoneySignal } from "./smartMoneyEngine.js";
import { computeStrategyAlignment, StrategyAlignment } from "./strategyAlignmentEngine.js";
import { runAntigravityEngine, AntigravityDecision, setConfidenceMultiplier } from "./antigravityEngine.js";
import { updateCrashEngine } from "./crashDetectionEngine.js";
import {
  recordSignal, resolvePendingSignals, getSignalMemoryStats,
  getSignalHistory, SignalMemoryStats, SignalRecord
} from "./signalMemory.js";
import { runBacktest, BacktestResult } from "./backtestEngine.js";
import { runAIEngineV2, AIEngineV2Payload } from "./aiResearchLab.js";
import { runServerSideAutoTrading } from "./autoTradingService.js";
import { runContinuousScalpEngine } from "./continuousScalpEngine.js";
import { saveSignal } from "./tradingEngineDB.js";

// Instantiated speed trackers
const niftySpeedTracker  = new MarketSpeedTracker();
const sensexSpeedTracker = new MarketSpeedTracker();
const bankniftySpeedTracker = new MarketSpeedTracker();

// Track last emitted signal to avoid recording duplicates
const lastEmittedSignal: Record<string, string> = { NIFTY: "", SENSEX: "", BANKNIFTY: "" };
// Track last DB logged signal to avoid duplicate DB insertions on every tick
const lastDbLoggedSignal: Record<string, string> = { NIFTY: "", SENSEX: "", BANKNIFTY: "" };

export interface AIAnalysisPayload {
  page: "NIFTY" | "SENSEX" | "BANKNIFTY";
  report: CompleteMarketReport;
  breakout: BreakoutState;
  momentum: MomentumStateResult;
  expirySetup: AIStrategySetup;
  alerts: AIAlert[];
  // New ANTIGRAVITY fields
  smartMoney: SmartMoneySignal;
  alignment: StrategyAlignment;
  antigravity: AntigravityDecision;
  signalMemory: SignalMemoryStats;
  signalHistory: SignalRecord[];
  backtest: BacktestResult | null;
  aiEngineV2?: AIEngineV2Payload;
  crashState?: { isMacroCrash: boolean; reason: string };
}

// Memory cache of latest states
const latestPayloads: Record<string, AIAnalysisPayload | null> = {
  NIFTY: null,
  SENSEX: null,
  BANKNIFTY: null,
};

export function getLatestAIState(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): AIAnalysisPayload | null {
  return latestPayloads[page];
}

/**
 * Runs the complete ANTIGRAVITY AI analysis (10 layers) and broadcasts.
 * Invoked on every tick broadcast.
 */
/**
 * Runs the complete ANTIGRAVITY AI analysis (10 layers) and broadcasts.
 * Invoked on every tick broadcast.
 */
export async function runStrategyEngine(page: "NIFTY" | "SENSEX" | "BANKNIFTY", io: SocketIOServer): Promise<void> {
  const isNifty    = page === "NIFTY";
  const isBanknifty = page === "BANKNIFTY";
  const spotPrice  = isNifty ? marketState.niftySpot  : (isBanknifty ? marketState.bankniftySpot : marketState.sensexSpot);
  if (spotPrice <= 0) return;

  const stocks       = isNifty ? Object.values(marketState.niftyStocks)  : (isBanknifty ? Object.values(marketState.bankniftyStocks) : Object.values(marketState.sensexStocks));
  const optionStrikes = isNifty ? marketState.niftyOptionChain.strikes : (isBanknifty ? marketState.bankniftyOptionChain.strikes : marketState.sensexOptionChain.strikes);
  const strikeGap     = isNifty ? 50 : 100;

  // ── Layer 2a: Price speed velocity ─────────────────────────────────────────
  const tracker     = isNifty ? niftySpeedTracker : (isBanknifty ? bankniftySpeedTracker : sensexSpeedTracker);
  const speedResult = tracker.addTick(spotPrice);

  // ── Layer 2b: Compile full market report (with spot+page for structure) ────
  const report = compileMarketReport(stocks, optionStrikes, spotPrice, strikeGap, speedResult, page);

  // ── Layer 3: Smart Money Analysis ──────────────────────────────────────────
  const smartMoney = analyzeSmartMoney(page, optionStrikes, report.oi, spotPrice);

  // ── Layer 4: Breakout + Trap Detection ────────────────────────────────────
  const hasVolumeSpike = report.volume.hasMajorCeSpike || report.volume.hasMajorPeSpike;
  const isFastMarket   = speedResult.marketState === "FAST_MARKET";
  const breakout = updateBreakoutEngine(
    page, spotPrice, hasVolumeSpike, isFastMarket,
    report.oi.sentiment, speedResult.priceActionGrade
  );

  // ── Layer 5: Momentum ──────────────────────────────────────────────────────
  const momentum = calculateMomentumState(page, spotPrice, report, breakout);

  // ── Layer 7: Expiry Strategy + Risk Management ────────────────────────────
  const expirySetup = generateExpiryStrategySetups(page, spotPrice, report, breakout, momentum);

  // ── Option Chain variables for Antigravity & Alignment ────────────────────
  const optionChain = isNifty ? marketState.niftyOptionChain : (isBanknifty ? marketState.bankniftyOptionChain : marketState.sensexOptionChain);
  const indiaVix = optionChain.indiaVix || 0;
  const selectedExpiry = optionChain.selectedExpiry || "";
  const dailyBias = getDailyBias(page);

  // ── Layer 5b: Strategy Alignment ──────────────────────────────────────────
  const alignment = computeStrategyAlignment(breakout, momentum, expirySetup, smartMoney, report, dailyBias);

  // ── Layer 8: Resolve pending signals and get win rate stats ───────────────
  resolvePendingSignals(page, spotPrice);
  const signalMemory = getSignalMemoryStats(page);
  const signalHistory = getSignalHistory(page).slice(0, 20);

  // Apply adaptive confidence multiplier from signal memory to antigravity engine
  setConfidenceMultiplier(signalMemory.confidenceMultiplier);

  // ── Layer 17: Macro Crash Detection ───────────────────────────────────────
  const crashState = updateCrashEngine(page, spotPrice, indiaVix);
  
  // ── Layer 6 + 10: ANTIGRAVITY Master Engine ────────────────────────────────
  const antigravity = runAntigravityEngine(
    page, report, breakout, momentum, expirySetup, smartMoney, alignment, indiaVix, dailyBias, selectedExpiry, crashState.isMacroCrash
  );

  // ── Layer 9: Backtest (cached, runs 1×/hour) ───────────────────────────────
  const backtest = runBacktest(page, stocks);

  // ── Layer 11: Institutional Multi-Layer AI Engine V2.0 ──────────────────────
  const aiEngineV2 = await runAIEngineV2(
    page,
    report,
    breakout,
    momentum,
    smartMoney,
    spotPrice,
    antigravity.antigravityScore
  );

  // ── Alert checks ───────────────────────────────────────────────────────────
  checkAndTriggerAlerts(page, report, io);
  checkCustomAlerts(page, report, momentum.momentumScore, io);
  const alerts = getAlertHistory(page);

  // ── Record significant new signals to memory ───────────────────────────────
  const currentSignalKey = `${antigravity.finalSignal}-${antigravity.signalGrade}`;
  if (
    (antigravity.finalSignal === "BUY_CE" || antigravity.finalSignal === "BUY_PE") &&
    antigravity.signalGrade <= "B" &&
    currentSignalKey !== lastEmittedSignal[page]
  ) {
    recordSignal(page, antigravity.finalSignal, antigravity.signalGrade, antigravity.antigravityScore, spotPrice);
    lastEmittedSignal[page] = currentSignalKey;
  } else if (antigravity.finalSignal === "WAIT" || antigravity.finalSignal === "NO_TRADE") {
    lastEmittedSignal[page] = ""; // Reset so next signal gets recorded
  }

  // ── Record ALL signal state transitions to SQLite DB for study/research ──
  const currentDbSignalKey = `${antigravity.finalSignal}-${antigravity.signalGrade}`;
  if (currentDbSignalKey !== lastDbLoggedSignal[page]) {
    const sigId = `sig-${page.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    
    // Format reason to include AI scores, regime, reasoning, and aligned strategy gates
    const gatesList = alignment.strategiesAgreeing && alignment.strategiesAgreeing.length > 0
      ? alignment.strategiesAgreeing.join(", ")
      : "None";
    const dbReason = `Score: ${antigravity.antigravityScore} | Regime: ${antigravity.marketRegime} | Gates: ${gatesList} | Reasoning: ${antigravity.reasoning}`;

    saveSignal({
      id: sigId,
      timestamp: Date.now(),
      instrument: page,
      signal: antigravity.finalSignal,
      confidence: antigravity.antigravityScore,
      grade: antigravity.signalGrade,
      reason: dbReason,
      entry_price: spotPrice,
      exit_price: null,
      target: null,
      stop_loss: null,
      pnl: null,
      result: "PENDING",
      breadth_score: Math.round(report.trend.strengthPct || 50),
      momentum_score: momentum.momentumScore,
      oi_score: report.oi ? report.oi.pcr : null
    });
    
    lastDbLoggedSignal[page] = currentDbSignalKey;
  }

  // ── Assemble and broadcast unified payload ──────────────────────────────────
  const payload: AIAnalysisPayload = {
    page,
    report,
    breakout,
    momentum,
    expirySetup,
    alerts,
    smartMoney,
    alignment,
    antigravity,
    signalMemory,
    signalHistory,
    backtest,
    aiEngineV2,
    crashState,
  };

  latestPayloads[page] = payload;

  // Emit primary unified payload
  io.emit("ai-update", { page, payload });

  // Emit specific sub-component payloads
  io.emit("strategy-update",        { page, strategy: expirySetup });
  io.emit("momentum-update",        { page, momentum });
  io.emit("breakout-update",        { page, breakout });
  io.emit("expiry-strategy-update", { page, expirySetup });
  io.emit("antigravity-update",     { page, antigravity });
  io.emit("smart-money-update",     { page, smartMoney });

  // ── Server-Side Automated Paper Trading Execution ──
  runServerSideAutoTrading(page, spotPrice, antigravity, alignment, report, momentum, breakout, io, aiEngineV2).catch(e => {
    console.error(`[ServerAutoTrader Error] [${page}]`, e.message);
  });

  // ── Continuous Scalp Engine (20k capital, data-driven, non-stop) ──
  runContinuousScalpEngine(
    page, io,
    momentum.momentumScore,
    momentum.direction,
    momentum.emaAlignment,
    momentum.macdAlignment,
    momentum.rsiZone,
    momentum.hasVolumeSpike,
    antigravity,
    report,
    aiEngineV2
  ).catch(e => {
    console.error(`[CS Engine Error] [${page}]`, e.message);
  });
}
