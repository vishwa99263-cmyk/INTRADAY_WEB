/**
 * server.ts — Pure Realtime Streaming Architecture
 *
 * Architecture:
 *   Fyers WS (Node SDK)
 *     → marketState (in-memory, single source of truth)
 *     → socketBroadcast (throttled Socket.IO emit)
 *     → React frontend (pure display layer)
 *
 * Removed:
 *   ❌ setInterval REST polling
 *   ❌ setInterval option chain refresh
 *   ❌ Client-side score / backup calculation
 *   ❌ Simulation mode / fake data
 *
 * Kept:
 *   ✅ Fyers OAuth2 auth endpoints
 *   ✅ Manual stock edit / CSV import
 *   ✅ IST-aware backup scheduler (5M / 15M / 30M / 1H)
 *   ✅ Disk-persistent backup restore
 *   ✅ Vite dev middleware / production static
 */

import dotenv from "dotenv";
import express      from "express";
import http         from "http";
import { Server as SocketIOServer } from "socket.io";
import path         from "path";
import fs           from "fs";
import { createServer as createViteServer } from "vite";
import { createRequire } from "module";
import crypto       from "crypto";
import { exec }     from "child_process";
import { fileURLToPath } from "url";

const _filename = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(_filename);

dotenv.config({ path: path.join(process.cwd(), ".env") });

// ── Service & State imports ────────────────────────────────────────────────────
import { db, initializeSchema }       from "./server/storage/db.js";
import { marketState }           from "./server/state/marketState.js";
import { startFyersSocket, stopFyersSocket, resubscribeOptionSymbols } from "./server/services/fyersSocket.js";
import { loadAllBackups, startBackupScheduler, takeSnapshot5m, clearBackup, importBackup, importAllBackup, getISTDateStr } from "./server/services/backupScheduler.js";
import { syncHistoricalBhavcopy, getStockVolumeAverages, seedStocksFromBhavcopy, getStockHistory, downloadAndParseBhavcopy, getRecentSignals } from "./server/services/bhavcopyService.js";
import { broadcastAll, broadcastStatus }                               from "./server/services/socketBroadcast.js";
import { fetchInitialChain, restoreLastSnapshot, startSnapshotTimer, startBackgroundMetricsTimer, getOptionChainState, liveOptionTicks, saveStockSnapshots, restoreStockSnapshots }   from "./server/services/optionChainStream.js";
import { recalcStock }                                                 from "./server/utils/calculateScore.js";
import { getISTTime }                                                  from "./server/utils/timerUtils.js";
import type { StockData, BackupSnapshots, TimedBackupStore }           from "./src/types.js";
import { loadAlertsFromDisk, saveAlertsToDisk, getAlertHistory } from "./server/services/alertEngine.js";
import { initChartEngine, onSpotTick, onOptionChainTick, getAllCandles, getCandles } from "./server/services/chartEngine.js";
import type { ChartInstrument, Timeframe } from "./server/services/chartEngine.js";
import { initChartRealtime, feedIndexTick, getRTCandles, getAllRTCandles, onCandleBroadcast } from "./server/services/chartRealtime.js";
import type { RTInstrument, RTTimeframe } from "./server/services/chartRealtime.js";
import { fetchFyersHistory } from "./server/services/chartHistory.js";
import { initIndicatorPipeline, processTickEnrichment, getLatestEnriched, getEnrichedFromDB } from "./server/services/indicatorPipeline.js";
import { enrichCandles, getEnrichedHistory, type RawCandle } from "./server/services/indicatorEngine.js";
import { closeIndicatorDB } from "./server/services/indicatorDB.js";
import { smartOrderQueueService } from "./server/services/smartOrderQueueService.js";
import { startRecorder, stopRecorder } from "./server/services/marketRecorder.js";
import { initReplaySession, playReplaySession, pauseReplaySession, stepReplaySession, setReplaySpeed } from "./server/services/replayEngine.js";
import { loadStrategies, getStrategies, addStrategy, editStrategy, deleteStrategy } from "./server/services/strategyStore.js";
import {
  saveSignal, getSignals, updateSignalResult,
  savePaperTrade, getPaperTrades, closePaperTrade, updatePaperTradeSL, updatePaperTradeNotes, deletePaperTrade,
  getLotConfig, getLotSize, updateLotConfig, upsertLotConfigs,
  activatePaperTrade, saveFiiDii, getFiiDiiHistory,
  getShadowTrades, saveShadowTrade, closeShadowTrade
} from "./server/services/tradingEngineDB.js";
import { runUltraBacktest, geminiOptimizeStrategy, type BacktestRules, type Indicator, type InstrumentType } from "./server/services/ultraBacktestEngine.js";
import { getQueue, addTask, clearQueue, triggerWorker } from "./server/services/backtestQueueManager.js";
import { initializeDailyPatterns, getPatternsSummary, getPatternsForDate, getAvailablePatternDates } from "./server/services/dailyPatterns.js";
import { initializeORBNakedEngine, shutdownORBNakedEngine, getORBEngineState, updateORBEngineSettings } from "./server/services/orbNakedEngine.js";

// ── Layer 11: Daily Structure Engine ──────────────────────────────────────────
import { computeDailyBias, getDailyBias, getAllDailyBiases } from "./server/services/positionStructureEngine.js";

// ── Layer 12: Position Trade Manager ──────────────────────────────────────────
import {
  openPositionTrade, closePositionTrade, getPositionTrades,
  updatePositionNotes, updatePositionPrices,
  calcPositionSetup, evaluatePositionConditions, estimateDailyTheta,
  type PositionTradeSetup, type PositionExitReason,
} from "./server/services/positionTradeEngine.js";

// ── Layer 13: Swing S&R Level Engine ──────────────────────────────────────────
import { computeSwingLevels, getSwingLevels, getAllSwingLevels, getProximityPenalty } from "./server/services/swingLevelEngine.js";

// ── AMEX L17: Signal Memory Engine ──────────────────────────────────────────
import { getSignalMemoryStats } from "./server/services/signalMemory.js";

// ── NEW: Self-Learning Engine ──────────────────────────────────────────────────
import { getLearningInsights, resetLearningData, continuousSelfLearning } from "./server/services/selfLearningEngine.js";
import { getAlarmHistory } from "./server/services/tradeAlarmEngine.js";
import { getAutoTradeConfig, saveAutoTradeConfig } from "./server/services/autoTradingService.js";
import { globalBus } from "./server/services/globalDataBus.js";
import { csGetTrades, getCsCapital } from "./server/services/continuousScalpEngine.js";
import { governorService } from "./server/services/governorService.js";

// ── AMEX News Intelligence Engine ──────────────────────────────────────────
import { getNewsForInstrument } from "./server/services/newsEngine.js";

// ── AMEX ML: Multi-Strategy Silent Runner ─────────────────────────────────────
import {
  processTick as mlProcessTick,
  getBestSignal, getAllStrategyStats,
  getRecentMLTrades, getMLSummary,
  type MarketContext as MLMarketContext,
} from "./server/services/multiStrategyRunner.js";




// Staggered initial chain loader to prevent Fyers API 429 rate limit errors on boot/reconnect
async function fetchInitialChainsSequentially() {
  const symbols = [
    "NSE:NIFTY50-INDEX",
    "BSE:SENSEX-INDEX",
    "NSE:NIFTYBANK-INDEX",
    "NSE:HDFCBANK-EQ",
    "NSE:RELIANCE-EQ",
    "NSE:ICICIBANK-EQ"
  ];
  console.log("[Boot-InitChain] 🚀 Starting staggered initial option chain fetch...");
  let someLoaded = false;
  for (const sym of symbols) {
    try {
      const loaded = await fetchInitialChain(sym, "");
      if (loaded) someLoaded = true;
      // Stagger by 2.5 seconds to prevent rate limits
      await new Promise(resolve => setTimeout(resolve, 2500));
    } catch (e: any) {
      console.error(`[Boot-InitChain] ❌ Error fetching initial chain for ${sym}:`, e.message);
    }
  }
  if (someLoaded) {
    console.log("[Boot-InitChain] ✅ Staggered fetch complete. Resubscribing symbols...");
    resubscribeOptionSymbols();
  } else {
    console.log("[Boot-InitChain] ⚠️ Staggered fetch completed. No new chains were loaded.");
  }
}

// ── Express / Socket.IO setup ─────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new SocketIOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});
const PORT = 3000;

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use("/dist", express.static(path.join(process.cwd(), "dist")));

// ── Stock initialisation data ─────────────────────────────────────────────────
const INITIAL_NIFTY_STOCKS = [
  { symbol: "HDFCBANK",   weightage: 10.73 }, { symbol: "ICICIBANK",  weightage: 8.21  },
  { symbol: "RELIANCE",   weightage: 8.78  }, { symbol: "BHARTIARTL", weightage: 5.26  },
  { symbol: "SBIN",       weightage: 4.03  }, { symbol: "LT",         weightage: 4.28  },
  { symbol: "INFY",       weightage: 3.76  }, { symbol: "AXISBANK",   weightage: 3.31  },
  { symbol: "ITC",        weightage: 2.76  }, { symbol: "KOTAKBANK",  weightage: 2.56  },
  { symbol: "M&M",        weightage: 2.63  }, { symbol: "TATACONSUM", weightage: 2.35  },
  { symbol: "TCS",        weightage: 2.35  }, { symbol: "BAJFINANCE", weightage: 2.29  },
  { symbol: "HINDUNILVR", weightage: 1.82  }, { symbol: "MARUTI",     weightage: 1.67  },
  { symbol: "SUNPHARMA",  weightage: 1.64  }, { symbol: "NTPC",       weightage: 1.58  },
  { symbol: "TITAN",      weightage: 1.56  }, { symbol: "ETERNAL",    weightage: 1.54  },
  { symbol: "TATASTEEL",  weightage: 1.54  }, { symbol: "BEL",        weightage: 1.43  },
  { symbol: "ULTRACEMCO", weightage: 1.31  }, { symbol: "SHRIRAMFIN", weightage: 1.30  },
  { symbol: "HCLTECH",    weightage: 1.28  }, { symbol: "HINDALCO",   weightage: 1.20  },
  { symbol: "POWERGRID",  weightage: 1.19  }, { symbol: "JSWSTEEL",   weightage: 1.05  },
  { symbol: "BAJAJFINSV", weightage: 0.98  }, { symbol: "ONGC",       weightage: 0.97  },
  { symbol: "ADANIPORTS", weightage: 0.96  }, { symbol: "BAJAJ-AUTO", weightage: 0.96  },
  { symbol: "EICHERMOT",  weightage: 0.95  }, { symbol: "GRASIM",     weightage: 0.94  },
  { symbol: "ASIANPAINT", weightage: 0.92  }, { symbol: "INDIGO",     weightage: 0.90  },
  { symbol: "COALINDIA",  weightage: 0.85  }, { symbol: "NESTLEIND",  weightage: 0.81  },
  { symbol: "SBILIFE",    weightage: 0.80  }, { symbol: "TECHM",      weightage: 0.75  },
  { symbol: "TRENT",      weightage: 0.75  }, { symbol: "JIOFIN",     weightage: 0.72  },
  { symbol: "APOLLOHOSP", weightage: 0.71  }, { symbol: "MAXHEALTH",  weightage: 0.71  },
  { symbol: "DRREDDY",    weightage: 0.70  }, { symbol: "TMPV",       weightage: 0.68  },
  { symbol: "CIPLA",      weightage: 0.67  }, { symbol: "HDFCLIFE",   weightage: 0.67  },
  { symbol: "WIPRO",      weightage: 0.50  }, { symbol: "ADANIENT",   weightage: 0.49  },
];

const INITIAL_SENSEX_STOCKS = [
  { symbol: "HDFCBANK",   weightage: 7.810 }, { symbol: "ICICIBANK",  weightage: 5.89  },
  { symbol: "RELIANCE",   weightage: 11.94 }, { symbol: "BHARTIARTL", weightage: 7.67  },
  { symbol: "SBIN",       weightage: 5.87  }, { symbol: "LT",         weightage: 3.55  },
  { symbol: "INFY",       weightage: 3.00  }, { symbol: "AXISBANK",   weightage: 2.56  },
  { symbol: "ITC",        weightage: 2.56  }, { symbol: "KOTAKBANK",  weightage: 2.54  },
  { symbol: "M&M",        weightage: 2.56  }, { symbol: "TCS",        weightage: 5.41  },
  { symbol: "BAJFINANCE", weightage: 3.74  }, { symbol: "HINDUNILVR", weightage: 3.52  },
  { symbol: "MARUTI",     weightage: 2.75  }, { symbol: "SUNPHARMA",  weightage: 2.98  },
  { symbol: "NTPC",       weightage: 2.53  }, { symbol: "TITAN",      weightage: 2.44  },
  { symbol: "ETERNAL",    weightage: 1.54  }, { symbol: "TATASTEEL",  weightage: 1.79  },
  { symbol: "BEL",        weightage: 2.04  }, { symbol: "ULTRACEMCO", weightage: 2.24  },
  { symbol: "HCLTECH",    weightage: 2.03  }, { symbol: "POWERGRID",  weightage: 1.88  },
  { symbol: "BAJAJFINSV", weightage: 1.83  }, { symbol: "ADANIPORTS", weightage: 2.73  },
  { symbol: "ASIANPAINT", weightage: 1.65  }, { symbol: "INDIGO",     weightage: 1.10  },
  { symbol: "TECHM",      weightage: 0.89  }, { symbol: "TRENT",      weightage: 0.96  },
];

const INITIAL_BANKNIFTY_STOCKS = [
  { symbol: "HDFCBANK",   weightage: 29.13 }, { symbol: "ICICIBANK",  weightage: 22.90 },
  { symbol: "AXISBANK",   weightage: 11.23 }, { symbol: "SBIN",       weightage: 9.98  },
  { symbol: "KOTAKBANK",  weightage: 9.72  }, { symbol: "INDUSINDBK", weightage: 5.83  },
  { symbol: "BANKBARODA", weightage: 2.65  }, { symbol: "AUBANK",     weightage: 2.42  },
  { symbol: "FEDERALBNK", weightage: 2.21  }, { symbol: "IDFCFIRSTB", weightage: 1.85  },
  { symbol: "PNB",        weightage: 1.08  }, { symbol: "BANDHANBNK", weightage: 1.00  },
];

const TICKER_MAPPING: Record<string, string> = {
  "NIFTY 50": "NSE:NIFTY50-INDEX",
  "NIFTY BANK": "NSE:NIFTYBANK-INDEX",
  SENSEX:     "BSE:SENSEX-INDEX",
  HDFCBANK: "NSE:HDFCBANK-EQ",    ICICIBANK:  "NSE:ICICIBANK-EQ",
  RELIANCE: "NSE:RELIANCE-EQ",    BHARTIARTL: "NSE:BHARTIARTL-EQ",
  SBIN:     "NSE:SBIN-EQ",        LT:         "NSE:LT-EQ",
  INFY:     "NSE:INFY-EQ",        AXISBANK:   "NSE:AXISBANK-EQ",
  ITC:      "NSE:ITC-EQ",         KOTAKBANK:  "NSE:KOTAKBANK-EQ",
  "M&M":    "NSE:M&M-EQ",         TATACONSUM: "NSE:TATACONSUM-EQ",
  TCS:      "NSE:TCS-EQ",         BAJFINANCE: "NSE:BAJFINANCE-EQ",
  HINDUNILVR:"NSE:HINDUNILVR-EQ", MARUTI:     "NSE:MARUTI-EQ",
  SUNPHARMA:"NSE:SUNPHARMA-EQ",   NTPC:       "NSE:NTPC-EQ",
  TITAN:    "NSE:TITAN-EQ",       ETERNAL:    "NSE:ETERNAL-EQ",
  TATASTEEL:"NSE:TATASTEEL-EQ",   BEL:        "NSE:BEL-EQ",
  ULTRACEMCO:"NSE:ULTRACEMCO-EQ", SHRIRAMFIN: "NSE:SHRIRAMFIN-EQ",
  HCLTECH:  "NSE:HCLTECH-EQ",     HINDALCO:   "NSE:HINDALCO-EQ",
  POWERGRID:"NSE:POWERGRID-EQ",   JSWSTEEL:   "NSE:JSWSTEEL-EQ",
  BAJAJFINSV:"NSE:BAJAJFINSV-EQ", ONGC:       "NSE:ONGC-EQ",
  ADANIPORTS:"NSE:ADANIPORTS-EQ", "BAJAJ-AUTO":"NSE:BAJAJ-AUTO-EQ",
  EICHERMOT:"NSE:EICHERMOT-EQ",   GRASIM:     "NSE:GRASIM-EQ",
  ASIANPAINT:"NSE:ASIANPAINT-EQ", INDIGO:     "NSE:INDIGO-EQ",
  COALINDIA:"NSE:COALINDIA-EQ",   NESTLEIND:  "NSE:NESTLEIND-EQ",
  SBILIFE:  "NSE:SBILIFE-EQ",     TECHM:      "NSE:TECHM-EQ",
  TRENT:    "NSE:TRENT-EQ",       JIOFIN:     "NSE:JIOFIN-EQ",
  APOLLOHOSP:"NSE:APOLLOHOSP-EQ", MAXHEALTH:  "NSE:MAXHEALTH-EQ",
  DRREDDY:  "NSE:DRREDDY-EQ",     TMPV:       "NSE:TMPV-EQ",
  CIPLA:    "NSE:CIPLA-EQ",       HDFCLIFE:   "NSE:HDFCLIFE-EQ",
  WIPRO:    "NSE:WIPRO-EQ",       ADANIENT:   "NSE:ADANIENT-EQ",
  INDUSINDBK: "NSE:INDUSINDBK-EQ", BANKBARODA: "NSE:BANKBARODA-EQ",
  AUBANK:    "NSE:AUBANK-EQ",     FEDERALBNK: "NSE:FEDERALBNK-EQ",
  IDFCFIRSTB: "NSE:IDFCFIRSTB-EQ", PNB:        "NSE:PNB-EQ",
  BANDHANBNK: "NSE:BANDHANBNK-EQ",
};

function isValidTicker(t: string): boolean {
  return /^(NSE|BSE):[A-Z0-9&\-_]+-(EQ|INDEX)$/.test(t ?? "");
}
function getTicker(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return TICKER_MAPPING[s] ?? `NSE:${s}-EQ`;
}
function makeStock(symbol: string, weightage: number): StockData {
  return {
    symbol, weightage,
    ticker: getTicker(symbol),
    ltp: 0, changePercent: 0, prevClose: 0, volume: 0,
    score: 0, backupScore: 0, scoreDifference: 0, ltpBackup: 0,
    score15m: 0, score15mDiff: 0,
    score30m: 0, score30mDiff: 0,
    score1h:  0, score1hDiff:  0,
  };
}

// Populate marketState with initial stock objects
INITIAL_NIFTY_STOCKS.forEach(({ symbol, weightage }) => {
  marketState.niftyStocks[symbol] = makeStock(symbol, weightage);
});
INITIAL_SENSEX_STOCKS.forEach(({ symbol, weightage }) => {
  marketState.sensexStocks[symbol] = makeStock(symbol, weightage);
});
INITIAL_BANKNIFTY_STOCKS.forEach(({ symbol, weightage }) => {
  marketState.bankniftyStocks[symbol] = makeStock(symbol, weightage);
});

// Add NIFTY 50, SENSEX, and NIFTY BANK Index rows to stock maps
marketState.niftyStocks["NIFTY 50"] = makeStock("NIFTY 50", 0);
marketState.sensexStocks["SENSEX"] = makeStock("SENSEX", 0);
marketState.bankniftyStocks["NIFTY BANK"] = makeStock("NIFTY BANK", 0);

// Restore last stock snapshots
restoreStockSnapshots();
// Seed stock prices from SQLite indicators.db (fallback for weekend/market-closed)
seedStocksFromBhavcopy(marketState);

// ── Load backup stores from disk ──────────────────────────────────────────────
loadAllBackups();
loadStrategies();
initializeDailyPatterns().catch(e => console.error("[DailyPatterns init]", e));

// ── Wire chartRealtime broadcast → indicator enrichment ───────────────────────────────────────────
const BROADCAST_TF = new Set(["5m", "15m"]);
onCandleBroadcast((inst, tf) => {
  processTickEnrichment(inst, tf);

  // Push fresh candles to all clients when a 5M/15M candle closes
  // Frontend AutoStrategyTab uses this to update reversal indicators in real-time
  if (BROADCAST_TF.has(tf)) {
    try {
      const candles = getRTCandles(inst as RTInstrument, tf as RTTimeframe);
      if (candles && candles.length > 0) {
        io.emit("index-candles-update", { instrument: inst, tf, candles });
      }
    } catch (e) { /* non-critical */ }
  }
});

// ── Restore last option chain snapshot (fallback for market-closed / no token) ─
restoreLastSnapshot();

// ── Start IST-aware backup scheduler ─────────────────────────────────────────
startBackupScheduler(io);

// ── Start Smart Order Queue ──────────────────────────────────────────────────
smartOrderQueueService.setSocketServer(io);

// ── Start option chain snapshot auto-save (every 30s during market hours) ─────
startSnapshotTimer(io);

// ── Start background option metrics calculation loop (every 60s) ─────────────
startBackgroundMetricsTimer(io);

// ── Initialise realtime chart engine (tick-to-candle aggregator) ────────────────
initChartEngine(io);

// ── Initialise NIFTY/SENSEX dedicated realtime candle engine ──────────────────────
initChartRealtime(io).catch(e => console.error("[ChartRT init]", e));

// ── Initialise Indicator Pipeline (enrichment + SQLite persistence) ───────────
initIndicatorPipeline(io);



// ── Emit serverTime every second (for client countdown derivation) ─────────────
setInterval(() => {
  io.emit("server-time", { serverTime: Date.now() });
}, 1000);

// Broadcast engine logs to all connected WebSocket clients
globalBus.on("log", (logItem) => {
  io.emit("engine-log", logItem);
});

// ── Socket.IO connection handler ──────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Send full current state immediately to new client
  broadcastAll(io);
  socket.emit("smart-orders-update", smartOrderQueueService.getOrders());


  // Client requests a specific option chain expiry
  socket.on("select-expiry", async (data: { index?: "NIFTY" | "SENSEX" | "BANKNIFTY" | "HDFCBANK" | "RELIANCE" | "ICICIBANK" | "CUSTOM_STOCK"; expiry: string }) => {
    const page = data.index || "NIFTY";
    console.log(`[OptionChain] Expiry selected for ${page}: ${data.expiry}`);
    
    let symbol = "";
    if (page === "NIFTY") symbol = "NSE:NIFTY50-INDEX";
    else if (page === "SENSEX") symbol = "BSE:SENSEX-INDEX";
    else if (page === "BANKNIFTY") symbol = "NSE:NIFTYBANK-INDEX";
    else if (page === "HDFCBANK") symbol = "NSE:HDFCBANK-EQ";
    else if (page === "RELIANCE") symbol = "NSE:RELIANCE-EQ";
    else if (page === "ICICIBANK") symbol = "NSE:ICICIBANK-EQ";
    else if (page === "CUSTOM_STOCK") symbol = marketState.customStockSymbol ? `NSE:${marketState.customStockSymbol.toUpperCase()}-EQ` : "";

    if (!symbol) return;

    const chainState = getOptionChainState(symbol);
    if (chainState) {
      chainState.selectedExpiry = data.expiry;
      const loaded = await fetchInitialChain(symbol, data.expiry);
      if (loaded) resubscribeOptionSymbols(); // subscribe new CE/PE symbols in Fyers WS
    }
    broadcastAll(io);
  });

  // Client requests a full state sync (e.g. after reconnect)
  socket.on("request-state", () => {
    broadcastAll(io);
    socket.emit("smart-orders-update", smartOrderQueueService.getOrders());
  });

  // Client requests manual smart order cancellation
  socket.on("cancel-smart-order", (id: string) => {
    smartOrderQueueService.cancelOrder(id);
  });

  // Client requests full chart candle history
  socket.on("request-charts", () => {
    socket.emit("charts-init", getAllCandles());
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id} — ${reason}`);
  });
});

// ── Auth helpers ──────────────────────────────────────────────────────────────
function sha256(appId: string, secretKey: string): string {
  return crypto.createHash("sha256").update(`${appId}:${secretKey}`).digest("hex");
}

// ── API Routes ────────────────────────────────────────────────────────────────

/** Status ping */
app.get("/api/status", (_req, res) => {
  res.json({
    status: "online",
    time:   new Date().toISOString(),
    connectionStatus: marketState.connectionStatus,
    fyersAuthorized:  marketState.fyersAuthorized,
    isSimulating:     marketState.isSimulating,
    lastFyersError:   marketState.lastFyersError,
  });
});

// ── Governor API Routes ────────────────────────────────────────────────────────

/** GET /api/governor/status — Live governor health state */
app.get("/api/governor/status", (_req, res) => {
  res.json({ s: "ok", governor: governorService.getState() });
});

/** POST /api/governor/kill — Engage emergency kill switch */
app.post("/api/governor/kill", (req, res) => {
  const { reason } = req.body as { reason?: string };
  governorService.engageKillSwitch(reason || "Manual emergency halt via API");
  res.json({ s: "ok", message: "Kill switch engaged", state: governorService.getState() });
});

/** POST /api/governor/restore — Restore system (clear all halts) */
app.post("/api/governor/restore", (_req, res) => {
  governorService.restoreSystem();
  res.json({ s: "ok", message: "System restored", state: governorService.getState() });
});

// ─────────────────────────────────────────────────────────────────────────────

/** Get compiled daily patterns summary for NIFTY, SENSEX, BANKNIFTY */
app.get("/api/daily-patterns", (req, res) => {
  const { symbol } = req.query as { symbol?: string };
  if (symbol) {
    return res.json({ s: "ok", summary: getPatternsSummary(symbol) });
  }
  return res.json({
    s: "ok",
    nifty: getPatternsSummary("NIFTY"),
    sensex: getPatternsSummary("SENSEX"),
    banknifty: getPatternsSummary("BANKNIFTY"),
  });
});

/** Get available dates for daily patterns / velocity studies */
app.get("/api/daily-patterns/dates", async (req, res) => {
  const { symbol } = req.query as { symbol?: string };
  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol query parameter" });
  }
  try {
    const dates = await getAvailablePatternDates(symbol);
    res.json({ s: "ok", dates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Get velocity / daily patterns statistics for a specific symbol on a specific date */
app.get("/api/daily-patterns/datewise", async (req, res) => {
  const { symbol, date } = req.query as { symbol?: string; date?: string };
  if (!symbol || !date) {
    return res.status(400).json({ error: "Missing symbol or date query parameter" });
  }
  try {
    const summary = await getPatternsForDate(symbol, date);
    if (!summary) {
      return res.json({ s: "ok", summary: null, message: "No data available for this date" });
    }
    res.json({ s: "ok", summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Get current Fyers config */
app.get("/api/fyers/config", (_req, res) => {
  res.json({
    fyersConfig: {
      app_id:       marketState.fyersConfig.app_id,
      redirect_uri: marketState.fyersConfig.redirect_uri,
      // Never expose secret_key or access_token via GET
    },
    fyersAuthorized: marketState.fyersAuthorized,
    isSimulating:    marketState.isSimulating,
    lastFyersError:  marketState.lastFyersError,
  });
});

/** Save Fyers credentials and (re)start the server-side WebSocket */
app.post("/api/fyers/config", async (req, res) => {
  const { app_id, secret_key, redirect_uri, access_token } = req.body;
  if (app_id        !== undefined) marketState.fyersConfig.app_id        = app_id;
  if (secret_key    !== undefined) marketState.fyersConfig.secret_key    = secret_key;
  if (redirect_uri  !== undefined) marketState.fyersConfig.redirect_uri  = redirect_uri;
  if (access_token  !== undefined) marketState.fyersConfig.access_token  = access_token;

  if (access_token) {
    marketState.isSimulating = false;
    console.log("[Config] Token updated — starting server-side Fyers WebSocket...");
    startFyersSocket(access_token, io);
    // Also fetch initial option chains with new token (staggered to prevent 429)
    fetchInitialChainsSequentially().catch(console.error);
  }

  // Persist config to disk for auto-connect on restart
  try {
    fs.writeFileSync(
      path.join(process.cwd(), "fyers_config.json"),
      JSON.stringify(marketState.fyersConfig, null, 2),
      "utf8"
    );
    console.log("[Config] Saved fyers_config.json to disk");
  } catch (e: any) {
    console.error("[Config] Failed to save fyers_config.json:", e.message);
  }

  res.json({
    success:         true,
    fyersAuthorized: marketState.fyersAuthorized,
    isSimulating:    marketState.isSimulating,
    lastFyersError:  marketState.lastFyersError,
  });
});

/** Exchange Fyers auth-code for access token, then start WebSocket */
app.post("/api/fyers/validate", async (req, res) => {
  const { auth_code } = req.body;
  if (!auth_code) return res.status(400).json({ error: "auth_code required" });

  const { app_id, secret_key } = marketState.fyersConfig;
  if (!app_id || !secret_key)
    return res.status(400).json({ error: "Configure app_id and secret_key first" });

  try {
    const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        grant_type: "authorization_code",
        code:       auth_code,
        appIdHash:  sha256(app_id, secret_key),
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

    const data: any = await response.json();
    if (data.s !== "ok" || !data.access_token)
      throw new Error(data.message ?? "Token exchange failed");

    marketState.fyersConfig.access_token = data.access_token;
    marketState.isSimulating             = false;
    marketState.fyersAuthorized          = true;
    marketState.lastFyersError           = "";

    // Persist token to disk for auto-connect on restart
    try {
      fs.writeFileSync(
        path.join(process.cwd(), "fyers_config.json"),
        JSON.stringify(marketState.fyersConfig, null, 2),
        "utf8"
      );
      console.log("[Auth] Saved fyers_config.json with access token");
    } catch (e: any) {
      console.error("[Auth] Failed to save fyers_config.json:", e.message);
    }

    console.log("[Auth] Token exchanged — starting Fyers server WebSocket");
    startFyersSocket(data.access_token, io);
    // Fetch initial option chains sequentially (staggered to prevent 429)
    fetchInitialChainsSequentially().catch(console.error);

    res.json({ success: true, access_token: data.access_token, fyersAuthorized: true });
  } catch (err: any) {
    console.error("[Auth] Token exchange failed:", err.message);
    marketState.lastFyersError  = err.message;
    marketState.fyersAuthorized = false;
    marketState.isSimulating    = true;
    broadcastStatus(io);
    res.status(500).json({ error: err.message });
  }
});

/** Manually toggle Simulation Mode */
app.post("/api/fyers/simulate", (req, res) => {
  const { simulate } = req.body;
  if (typeof simulate !== "boolean") {
    return res.status(400).json({ error: "simulate (boolean) is required" });
  }
  marketState.isSimulating = simulate;
  console.log(`[Simulation] Simulation mode toggled manually to: ${simulate}`);
  broadcastAll(io);
  res.json({ success: true, isSimulating: marketState.isSimulating });
});

/** AMEX ML — Best Signal for Live Nifty Tab */
app.get("/api/ml/best-signal", (_req, res) => {
  const signal = getBestSignal();
  res.json({ success: true, signal });
});

/** AMEX ML — All Strategy Stats (win rates, weights) */
app.get("/api/ml/strategy-stats", (_req, res) => {
  const stats = getAllStrategyStats();
  const summary = getMLSummary();
  res.json({ success: true, stats, summary });
});

/** AMEX ML — Recent trades from all strategies */
app.get("/api/ml/trades", (req, res) => {
  const limit = Number((req.query as any).limit) || 200;
  const trades = getRecentMLTrades(limit);
  res.json({ success: true, trades });
});

/** Option chain — returns current live state from server memory (no file I/O) */
app.get("/api/option-chain", (_req, res) => {
  if (marketState.optionChain.strikes.length === 0) {
    return res.status(404).json({ s: "error", message: "No option chain data available" });
  }
  res.json({ s: "ok", data: marketState.optionChain });
});

/** Chart candles REST endpoint — GET /api/charts/:instrument/:tf */
app.get("/api/charts/:instrument/:tf", (req, res) => {
  const { instrument, tf } = req.params;
  const validInstruments = [
    "NIFTY_SPOT", "SENSEX_SPOT", "CE_PREMIUM", "PE_PREMIUM",
    "NET_SCORE", "PCR", "OI_DIFF", "MOMENTUM",
  ];
  const validTf = ["1m", "5m", "15m"];
  if (!validInstruments.includes(instrument) || !validTf.includes(tf)) {
    return res.status(400).json({ error: "Invalid instrument or timeframe" });
  }
  const data = getCandles(instrument as ChartInstrument, tf as Timeframe);
  res.json({ s: "ok", instrument, tf, count: data.length, candles: data });
});

/** NIFTY/SENSEX historical candles — GET /api/index-chart/history */
app.get("/api/index-chart/history", async (req, res) => {
  const { instrument, tf } = req.query as { instrument?: string; tf?: string };
  const validInstruments = ["NIFTY", "SENSEX", "BANKNIFTY"];
  const validTf = ["5m", "15m"];
  if (!instrument || !validInstruments.includes(instrument) || !tf || !validTf.includes(tf)) {
    return res.status(400).json({ error: "Invalid instrument or timeframe (5m/15m only supported)" });
  }

  const symbol = instrument === "NIFTY" ? "NSE:NIFTY50-INDEX" : (instrument === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "BSE:SENSEX-INDEX");

  try {
    // Serve chart from database
    const checkQuery = `
      SELECT timestamp, open, high, low, close, volume, oi, vwap
      FROM market_candles 
      WHERE symbol = $1 AND resolution = $2
      ORDER BY timestamp ASC
      LIMIT 2000
    `;
    const dbRes = await db.query(checkQuery, [symbol, tf]);
    if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
      const candlesList = dbRes.rows.map(r => [
        Math.floor(new Date(r.timestamp).getTime() / 1000),
        Number(r.open),
        Number(r.high),
        Number(r.low),
        Number(r.close),
        Number(r.volume),
        Number(r.oi || 0),
        Number(r.vwap || r.close)
      ]);
      return res.json({ s: "ok", instrument, tf, count: candlesList.length, candles: candlesList });
    }
  } catch (dbErr: any) {
    console.warn(`[DB History API] Query failed for ${symbol} @ ${tf} (possibly table does not exist or DB offline). Falling back to memory cache:`, dbErr.message);
  }

  try {
    // Fallback: serve from in-memory cache if DB empty or query failed
    const rtCandles = getRTCandles(instrument as RTInstrument, tf as RTTimeframe);
    if (rtCandles && rtCandles.length > 0) {
      return res.json({ s: "ok", instrument, tf, count: rtCandles.length, candles: rtCandles });
    }
    return res.json({ s: "ok", instrument, tf, count: 0, candles: [] });
  } catch (fallbackErr: any) {
    console.error("[DB History API] Fallback fetch failed:", fallbackErr.message);
    return res.json({ s: "ok", instrument, tf, count: 0, candles: [] });
  }
});

/** NIFTY/SENSEX all-timeframe snapshot (for request-index-charts socket event) */
app.get("/api/index-chart/all", (_req, res) => {
  res.json({ s: "ok", data: getAllRTCandles() });
});


/** Chart candles — all instruments snapshot */
app.get("/api/charts/all", (_req, res) => {
  res.json({ s: "ok", data: getAllCandles() });
});

// ── Indicator / Enriched Candle Endpoints ────────────────────────────────────

/**
 * GET /api/indicators/enriched?instrument=NIFTY&tf=5m
 *
 * Returns enriched candle history (with inline EMA, RSI, MACD, BB, VWAP values).
 * This is the primary endpoint for the analyzer engine.
 */
app.get("/api/indicators/enriched", (req, res) => {
  const { instrument, tf } = req.query as { instrument?: string; tf?: string };
  const validInstruments = ["NIFTY", "SENSEX", "BANKNIFTY"];
  const validTf = ["1m", "3m", "5m", "15m", "30m", "1H", "1D"];
  if (!instrument || !validInstruments.includes(instrument) || !tf || !validTf.includes(tf)) {
    return res.status(400).json({ error: "Invalid instrument or tf", usage: "GET /api/indicators/enriched?instrument=NIFTY&tf=5m" });
  }

  try {
    const raw = getRTCandles(instrument as RTInstrument, tf as RTTimeframe);
    const result = getEnrichedHistory(raw as RawCandle[], instrument, tf);
    res.json({ s: "ok", ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/indicators/latest?instrument=NIFTY&tf=5m
 *
 * Returns ONLY the latest enriched candle (single JSON object).
 * Ultra-lightweight — designed for high-frequency polling by the analyzer.
 */
app.get("/api/indicators/latest", (req, res) => {
  const { instrument, tf } = req.query as { instrument?: string; tf?: string };
  if (!instrument || !tf) {
    return res.status(400).json({ error: "Missing instrument or tf" });
  }

  const latest = getLatestEnriched(instrument, tf);
  if (!latest) {
    return res.status(404).json({ error: "No enriched candle available yet" });
  }

  res.json({
    s:          "ok",
    instrument,
    timeframe:  tf,
    timestamp:  Date.now(),
    candle:     latest,
  });
});

/**
 * GET /api/indicators/db?instrument=NIFTY&tf=5m&from=1716000000&to=1716086400&limit=500
 *
 * Queries enriched candles from SQLite database (for backtesting / replay).
 */
app.get("/api/indicators/db", (req, res) => {
  const { instrument, tf, from, to, limit } = req.query as {
    instrument?: string; tf?: string; from?: string; to?: string; limit?: string;
  };
  if (!instrument || !tf) {
    return res.status(400).json({ error: "Missing instrument or tf" });
  }

  const candles = getEnrichedFromDB(
    instrument,
    tf,
    Number(limit) || 200,
  );
  res.json({
    s:          "ok",
    instrument,
    timeframe:  tf,
    source:     "sqlite",
    count:      candles.length,
    candles,
  });
});

// ─── Alerts Endpoints ────────────────────────────────────────────────────────

/** Get AI analytical alerts history */
app.get("/api/alerts/ai", (req, res) => {
  const { instrument } = req.query as { instrument?: string };
  const inst = instrument === "SENSEX" ? "SENSEX" : "NIFTY";
  res.json({ s: "ok", alerts: getAlertHistory(inst) });
});

/** Get current alerts and history */
app.get("/api/alerts", (_req, res) => {
  res.json({
    alerts: marketState.alerts,
    triggeredAlerts: marketState.triggeredAlerts
  });
});

/** Create a new alert rule */
app.post("/api/alerts", (req, res) => {
  const rule = req.body;
  if (!rule.type || !rule.instrument || !rule.condition || rule.targetValue === undefined) {
    return res.status(400).json({ error: "Invalid alert rule format" });
  }

  const newRule = {
    id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    type: rule.type,
    instrument: rule.instrument,
    strike: rule.strike ? Number(rule.strike) : undefined,
    condition: rule.condition,
    targetValue: Number(rule.targetValue),
    note: rule.note || "",
    sound: rule.sound || "SIREN",
    priority: rule.priority || "MEDIUM",
    enabled: true,
    createdAt: Date.now(),
    triggered: false,
    autoResetOption: rule.autoResetOption || "manual"
  };

  marketState.alerts.unshift(newRule);
  saveAlertsToDisk();

  io.emit("alerts-update", {
    alerts: marketState.alerts,
    triggeredAlerts: marketState.triggeredAlerts
  });

  res.json({ success: true, rule: newRule });
});

/** Delete an alert rule */
app.post("/api/alerts/delete", (req, res) => {
  const { id } = req.body;
  marketState.alerts = marketState.alerts.filter(a => a.id !== id);
  saveAlertsToDisk();

  io.emit("alerts-update", {
    alerts: marketState.alerts,
    triggeredAlerts: marketState.triggeredAlerts
  });

  res.json({ success: true });
});

/** Toggle alert rule enabled state */
app.post("/api/alerts/toggle", (req, res) => {
  const { id } = req.body;
  const alert = marketState.alerts.find(a => a.id === id);
  if (alert) {
    alert.enabled = !alert.enabled;
    if (alert.enabled) alert.triggered = false;
    saveAlertsToDisk();

    io.emit("alerts-update", {
      alerts: marketState.alerts,
      triggeredAlerts: marketState.triggeredAlerts
    });
  }
  res.json({ success: true });
});

/** Clear triggered alerts history */
app.post("/api/alerts/clear-history", (req, res) => {
  marketState.triggeredAlerts = [];
  saveAlertsToDisk();

  io.emit("alerts-update", {
    alerts: marketState.alerts,
    triggeredAlerts: marketState.triggeredAlerts
  });

  res.json({ success: true });
});

// ─── Strategies Endpoints ────────────────────────────────────────────────────

/** Get all strategies */
app.get("/api/strategies", (_req, res) => {
  res.json({
    strategies: getStrategies()
  });
});

/** Create a new strategy */
app.post("/api/strategies", (req, res) => {
  const strat = req.body;
  if (!strat.name || !strat.objective) {
    return res.status(400).json({ error: "Strategy name and objective are required" });
  }
  const newStrat = addStrategy(strat);
  res.json({ success: true, strategy: newStrat });
});

/** Edit an existing strategy */
app.post("/api/strategies/edit", (req, res) => {
  const { id, fields } = req.body;
  if (!id || !fields) {
    return res.status(400).json({ error: "Strategy ID and fields to update are required" });
  }
  const updated = editStrategy(id, fields);
  if (!updated) {
    return res.status(404).json({ error: "Strategy not found" });
  }
  res.json({ success: true, strategy: updated });
});

/** Delete a strategy */
app.post("/api/strategies/delete", (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "Strategy ID is required" });
  }
  const success = deleteStrategy(id);
  if (!success) {
    return res.status(400).json({ error: "Failed to delete strategy (e.g. system default cannot be deleted)" });
  }
  res.json({ success: true });
});



// ─── Continuous Scalping Engine API ─────────────────────────────────────────

/** Get all CS trades (open + closed) */
app.get("/api/cs-trades", (_req, res) => {
  try {
    const open   = csGetTrades("OPEN");
    const closed = csGetTrades("CLOSED");
    res.json({ open, closed, success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Get CS capital summary */
app.get("/api/cs-capital", (_req, res) => {
  try {
    res.json({ ...getCsCapital(), success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Clear all CS trades (reset) — for testing */
app.post("/api/cs-clear", async (_req, res) => {
  try {
    // Use the already-connected db from the main storage
    await db.query("DELETE FROM cs_trades");
    res.json({ success: true, message: "All CS trades cleared" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


/** Manual 5M backup trigger (force-copy from UI button) */
app.post("/api/backup/trigger", (req, res) => {
  const { time } = req.body;
  if (!time) return res.status(400).json({ error: "time required" });
  takeSnapshot5m(time, io);
  res.json({ success: true, message: `5M snapshot triggered at ${time}` });
});

/** Clear active index 5M backup */
app.post("/api/backup/clear", (req, res) => {
  const { page, date } = req.body;
  if (page !== "NIFTY" && page !== "SENSEX" && page !== "BANKNIFTY") {
    return res.status(400).json({ error: "Invalid page parameter (must be NIFTY, SENSEX or BANKNIFTY)" });
  }
  clearBackup(page, io, date);
  res.json({ success: true, message: `5M backup cleared for ${page}` });
});

/** Import 5M backup data from CSV JSON payload */
app.post("/api/backup/import", (req, res) => {
  const { page, data, date } = req.body;
  if (page !== "NIFTY" && page !== "SENSEX" && page !== "BANKNIFTY") {
    return res.status(400).json({ error: "Invalid page parameter" });
  }
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Invalid import data format" });
  }
  importBackup(page, data, io, date);
  res.json({ success: true, message: `5M backup imported successfully for ${page}` });
});

/** Import 5M backup data for ALL indices from a single JSON backup payload */
app.post("/api/backup/import-all", (req, res) => {
  const { data, date } = req.body;
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Invalid import data format" });
  }
  try {
    importAllBackup(data, io, date);
    res.json({ success: true, message: "5M backup imported successfully for all indices" });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to import all index backup" });
  }
});

/** Get available dates that have backups */
app.get("/api/backup/available-dates", (req, res) => {
  try {
    const storageDir = path.join(process.cwd(), "server", "storage");
    if (!fs.existsSync(storageDir)) {
      return res.json({ dates: [getISTDateStr()] });
    }
    const files = fs.readdirSync(storageDir);
    const datesSet = new Set<string>();
    
    // Always include today's date
    datesSet.add(getISTDateStr());
    
    files.forEach(file => {
      const match = file.match(/^5m_(\d{4}-\d{2}-\d{2})\.json$/);
      if (match) {
        datesSet.add(match[1]);
      }
    });
    
    const sortedDates = Array.from(datesSet).sort((a, b) => b.localeCompare(a));
    res.json({ dates: sortedDates });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to retrieve available dates" });
  }
});

/** Retrieve specific date score backup data */
app.get("/api/backup/get", (req, res) => {
  const dateStr = (req.query.date as string) || getISTDateStr();
  const filePath = path.join(process.cwd(), "server", "storage", `5m_${dateStr}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse backup file" });
    }
  }
  return res.json({ nifty: {}, sensex: {}, banknifty: {} });
});

/** Copy Column M (live score) to Column N, P, R, or T on the server */
app.post("/api/stocks/copy-column", (req, res) => {
  const { page, targetCol } = req.body;
  if (page !== "NIFTY" && page !== "SENSEX") {
    return res.status(400).json({ error: "Invalid page parameter (must be NIFTY or SENSEX)" });
  }
  if (!["N", "P", "R", "T"].includes(targetCol)) {
    return res.status(400).json({ error: "Invalid targetCol parameter (must be N, P, R, or T)" });
  }

  const stocks = page === "NIFTY" ? marketState.niftyStocks : marketState.sensexStocks;
  const timeStr = getISTTime().timeStr;

  for (const stock of Object.values(stocks)) {
    if (targetCol === "N") {
      stock.backupScore = stock.score;
      const backupMap = page === "NIFTY" ? marketState.niftyBackup : marketState.sensexBackup;
      if (!backupMap[stock.symbol]) backupMap[stock.symbol] = {};
      backupMap[stock.symbol][timeStr] = stock.score;
    } else if (targetCol === "P") {
      stock.score15m = stock.score;
      const timedMap = page === "NIFTY" ? marketState.niftyTimedBackup : marketState.sensexTimedBackup;
      const key = `15m:${timeStr}`;
      if (!timedMap[key]) timedMap[key] = {};
      timedMap[key][stock.symbol] = stock.score;
    } else if (targetCol === "R") {
      stock.score30m = stock.score;
      const timedMap = page === "NIFTY" ? marketState.niftyTimedBackup : marketState.sensexTimedBackup;
      const key = `30m:${timeStr}`;
      if (!timedMap[key]) timedMap[key] = {};
      timedMap[key][stock.symbol] = stock.score;
    } else if (targetCol === "T") {
      stock.score1h = stock.score;
      const timedMap = page === "NIFTY" ? marketState.niftyTimedBackup : marketState.sensexTimedBackup;
      const key = `1h:${timeStr}`;
      if (!timedMap[key]) timedMap[key] = {};
      timedMap[key][stock.symbol] = stock.score;
    }
    recalcStock(stock);
  }

  // Save to disk
  const dStr = getISTDateStr();
  if (targetCol === "N") {
    try {
      fs.writeFileSync(
        path.join(process.cwd(), "server", "storage", `5m_${dStr}.json`),
        JSON.stringify({ nifty: marketState.niftyBackup, sensex: marketState.sensexBackup, banknifty: marketState.bankniftyBackup }),
        "utf8"
      );
    } catch (e) {
      console.error("[Backup] save 5m failed:", e);
    }
  } else {
    const label = targetCol === "P" ? "15m" : targetCol === "R" ? "30m" : "1h";
    try {
      fs.writeFileSync(
        path.join(process.cwd(), "server", "storage", `${label}_${dStr}.json`),
        JSON.stringify({ nifty: marketState.niftyTimedBackup, sensex: marketState.sensexTimedBackup, banknifty: marketState.bankniftyTimedBackup }),
        "utf8"
      );
    } catch (e) {
      console.error(`[Backup] save ${label} failed:`, e);
    }
  }

  broadcastAll(io);
  res.json({ success: true, message: `Successfully copied Column M (SCORE) data to Column ${targetCol}` });
});

/** Timed backup retrieval */
app.get("/api/timedbackup/get", (_req, res) => {
  res.json({
    nifty:  marketState.niftyTimedBackup,
    sensex: marketState.sensexTimedBackup,
    banknifty: marketState.bankniftyTimedBackup,
  });
});

/** Current market state snapshot (for initial page load) */
app.get("/api/market/state", (_req, res) => {
  res.json({
    niftyStocks:       Object.values(marketState.niftyStocks),
    sensexStocks:      Object.values(marketState.sensexStocks),
    bankniftyStocks:   Object.values(marketState.bankniftyStocks),
    niftySpot:         marketState.niftySpot,
    sensexSpot:        marketState.sensexSpot,
    bankniftySpot:     marketState.bankniftySpot,
    niftyHistory:      marketState.niftyHistory,
    sensexHistory:     marketState.sensexHistory,
    bankniftyHistory:  marketState.bankniftyHistory,
    niftyBackup:       marketState.niftyBackup,
    sensexBackup:      marketState.sensexBackup,
    bankniftyBackup:   marketState.bankniftyBackup,
    niftyTimedBackup:  marketState.niftyTimedBackup,
    sensexTimedBackup: marketState.sensexTimedBackup,
    bankniftyTimedBackup: marketState.bankniftyTimedBackup,
    connectionStatus:  marketState.connectionStatus,
    fyersAuthorized:   marketState.fyersAuthorized,
    lastFyersError:    marketState.lastFyersError,
    serverTime:        Date.now(),
  });
});

/** Sync past 3 months of historical stock data from NSE Bhavcopy */
app.post("/api/stocks/bhavcopy/sync", async (req, res) => {
  const days = req.body.days ? parseInt(req.body.days) : 90;
  console.log(`[API] 🔄 Initiated Bhavcopy sync request for past ${days} days.`);
  
  // Return immediately or run in background to prevent HTTP timeout
  res.json({ success: true, message: `Syncing last ${days} days of Bhavcopy in background...` });

  try {
    // Run in background
    syncHistoricalBhavcopy(days).then(result => {
      console.log(`[API] ✅ Bhavcopy historical sync complete. Synced: ${result.syncedDates.length} days, Failed: ${result.failedDates.length} days.`);
    }).catch(err => {
      console.error(`[API] ❌ Bhavcopy background sync failed:`, err.message);
    });
  } catch (err: any) {
    console.error(`[API] ❌ Bhavcopy sync dispatch failed:`, err.message);
  }
});

/** Sync only today's stock data from NSE Bhavcopy */
app.post("/api/stocks/bhavcopy/sync-today", async (req, res) => {
  console.log(`[API] 🔄 Initiated Bhavcopy sync request for TODAY.`);
  try {
    const today = new Date();
    const result = await downloadAndParseBhavcopy(today);
    if (result.success) {
      if (result.rowsInserted > 0) {
        // Seed new values into in-memory marketState
        seedStocksFromBhavcopy(marketState);
        broadcastAll(io);
        return res.json({ success: true, message: `Successfully fetched today's data (${result.rowsInserted} records).` });
      } else {
        return res.json({ success: true, message: `Today's data is already up-to-date in database.` });
      }
    } else {
      return res.status(400).json({ success: false, error: result.error || "Today's data is not available." });
    }
  } catch (err: any) {
    console.error(`[API] ❌ Bhavcopy sync for today failed:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Get computed 5-day and 30-day volume & delivery averages */
app.get("/api/stocks/bhavcopy/averages", async (_req, res) => {
  try {
    const averages = await getStockVolumeAverages();
    res.json({ success: true, averages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Get recent ENTRY / STRONG ENTRY signals for all stocks in past 30 days */
app.get("/api/stocks/bhavcopy/recent-signals", async (_req, res) => {
  try {
    const signals = await getRecentSignals(30);
    res.json({ success: true, signals });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Get 90-day historical data for a specific stock symbol */
app.get("/api/stocks/bhavcopy/history/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    if (!symbol) {
      return res.status(400).json({ success: false, error: "Symbol parameter is required" });
    }
    const history = await getStockHistory(symbol);

    // Prepend today's live data from in-memory marketState to provide real-time analysis
    const cleanSym = symbol.toUpperCase();
    const stockLive = marketState.niftyStocks[cleanSym] || marketState.sensexStocks[cleanSym] || marketState.bankniftyStocks[cleanSym];
    const todayStr = getISTDateStr();
    const hasToday = history.some((row: any) => row.trade_date === todayStr);

    if (!hasToday && stockLive && stockLive.ltp > 0) {
      const todayRecord = {
        symbol: cleanSym,
        trade_date: todayStr,
        prev_close: stockLive.prevClose || stockLive.ltp,
        open_price: stockLive.open || stockLive.prevClose || stockLive.ltp,
        high_price: stockLive.high || stockLive.ltp,
        low_price: stockLive.low || stockLive.ltp,
        close_price: stockLive.ltp,
        avg_price: stockLive.vwap || stockLive.ltp,
        total_volume: stockLive.volume || 0,
        turnover_lacs: parseFloat(((stockLive.volume * stockLive.ltp) / 100000).toFixed(2)),
        delivery_volume: Math.round(stockLive.volume * 0.45),
        delivery_percentage: 45,
        no_of_trades: Math.round(stockLive.volume / 100) || 1
      };
      history.unshift(todayRecord);
    }

    if (!history || history.length === 0) {
      return res.json({ success: true, history: [], stats: null });
    }

    // Compute statistics
    let maxClose = -Infinity;
    let maxCloseDate = "";
    let minClose = Infinity;
    let minCloseDate = "";
    let totalClose = 0;
    let totalVolume = 0;
    let totalDeliveryPercent = 0;

    history.forEach((row: any) => {
      const close = row.close_price;
      const date = row.trade_date;
      
      if (close > maxClose) {
        maxClose = close;
        maxCloseDate = date;
      }
      if (close < minClose) {
        minClose = close;
        minCloseDate = date;
      }
      totalClose += close;
      totalVolume += row.total_volume;
      totalDeliveryPercent += row.delivery_percentage;
    });

    const count = history.length;
    const avgClose = totalClose / count;
    const avgVolume = totalVolume / count;
    const avgDeliveryPercent = totalDeliveryPercent / count;

    // Calculate Net Return %: from oldest close to latest close
    const oldestRecord = history[count - 1] as any;
    const latestRecord = history[0] as any;
    const oldestPrice = oldestRecord.prev_close > 0 ? oldestRecord.prev_close : oldestRecord.open_price;
    const latestPrice = latestRecord.close_price;
    const netReturnPercent = oldestPrice > 0 ? ((latestPrice - oldestPrice) / oldestPrice) * 100 : 0;

    const stats = {
      maxClose,
      maxCloseDate,
      minClose,
      minCloseDate,
      avgClose: parseFloat(avgClose.toFixed(2)),
      avgVolume: parseFloat(avgVolume.toFixed(0)),
      avgDeliveryPercent: parseFloat(avgDeliveryPercent.toFixed(2)),
      netReturnPercent: parseFloat(netReturnPercent.toFixed(2)),
      latestPrice,
      latestDate: (latestRecord as any).trade_date
    };

    res.json({ success: true, history, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// NEW: Self-Learning Engine API Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/te/learning-insights — All pattern learning data for SelfLearningDashboard */
app.get("/api/te/learning-insights", (_req, res) => {
  try {
    const insights = getLearningInsights();
    res.json({ success: true, insights });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/learning-reset — Reset all AI learning data */
app.post("/api/te/learning-reset", (_req, res) => {
  try {
    resetLearningData();
    res.json({ success: true, message: "AI learning data reset successfully." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// AMEX v3.0 — Global Data Bus + Self-Learning v3 API Endpoints
// ────────────────────────────────────────────────────────────

/** GET /api/te/engine-logs — Get last 200 logs from engine */
app.get("/api/te/engine-logs", (_req, res) => {
  try {
    res.json({ success: true, logs: globalBus.getLogs() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/te/global-state — Full Global Data Bus snapshot */
app.get("/api/te/global-state", (_req, res) => {
  try {
    res.json({ success: true, state: globalBus.getState() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/te/autotrade/status — Get current autotrading status */
app.get("/api/te/autotrade/status", (_req, res) => {
  try {
    const config = getAutoTradeConfig();
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/autotrade/status — Update autotrading status */
app.post("/api/te/autotrade/status", (req, res) => {
  try {
    const configUpdate = req.body;
    const updated = saveAutoTradeConfig(configUpdate);
    io.emit("autotrade-status-update", updated);
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/te/layer-weights — Current layer weights */
app.get("/api/te/layer-weights", (_req, res) => {
  try {
    res.json({ success: true, weights: globalBus.getCurrentWeights() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/layer-weights — Update layer weights (manual or from self-learning) */
app.post("/api/te/layer-weights", (req, res) => {
  try {
    const { weights } = req.body;
    if (!weights || typeof weights !== "object") {
      return res.status(400).json({ success: false, error: "weights object required" });
    }
    globalBus.saveWeights(weights);
    res.json({ success: true, message: "Layer weights updated" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/te/self-learn/status — Current self-learning status (for permission card) */
app.get("/api/te/self-learn/status", (_req, res) => {
  try {
    const status = continuousSelfLearning.getStatus();
    const insights = getLearningInsights();
    res.json({ success: true, ...status, insights });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/self-learn/approve — User approves self-learning */
app.post("/api/te/self-learn/approve", (_req, res) => {
  try {
    continuousSelfLearning.userApprove();
    res.json({ success: true, message: "Self-learning approved and running" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/self-learn/deny — User denies self-learning */
app.post("/api/te/self-learn/deny", (_req, res) => {
  try {
    continuousSelfLearning.userDeny();
    res.json({ success: true, message: "Self-learning disabled" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/self-learn/recalibrate — Force weight recalibration now */
app.post("/api/te/self-learn/recalibrate", (_req, res) => {
  try {
    continuousSelfLearning.forceRecalibrate();
    res.json({ success: true, message: "Recalibration triggered" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/self-learn/reset — Reset all learning + weights to defaults */
app.post("/api/te/self-learn/reset", (_req, res) => {
  try {
    continuousSelfLearning.resetAll();
    res.json({ success: true, message: "All learning data and weights reset to defaults" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/te/global-state/update — Frontend pushes data to global bus */
app.post("/api/te/global-state/update", (req, res) => {
  try {
    const patch = req.body;
    globalBus.update(patch);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/te/alarm-history — Get last 50 trade alarms */
app.get("/api/te/alarm-history", (_req, res) => {
  try {
    const history = getAlarmHistory();
    res.json({ success: true, history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** CSV stock import */
app.post("/api/stocks/import", (req, res) => {
  const { page, data } = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: "Expected array" });

  const map = page === "NIFTY" ? marketState.niftyStocks : (page === "BANKNIFTY" ? marketState.bankniftyStocks : marketState.sensexStocks);
  data.forEach((row: any) => {
    if (!row.symbol) return;
    const stock = map[row.symbol.toUpperCase()] ?? map[row.symbol];
    if (!stock) return;
    if (row.ticker !== undefined) {
      stock.ticker = row.ticker.trim().toUpperCase();
    }
    if (row.ltp         !== undefined) stock.ltp         = parseFloat(row.ltp);
    if (row.prevClose   !== undefined) stock.prevClose   = parseFloat(row.prevClose);
    if (row.volume      !== undefined) stock.volume      = parseInt(row.volume);
    if (row.weightage   !== undefined) stock.weightage   = parseFloat(row.weightage);
    if (row.changePercent !== undefined) stock.changePercent = parseFloat(row.changePercent);
    recalcStock(stock);
  });

  broadcastAll(io);
  saveStockSnapshots();
  res.json({ success: true });
});

/** Manual cell edit */
app.post("/api/stocks/edit", (req, res) => {
  const { page, symbol, field, value } = req.body;
  const map   = page === "NIFTY" ? marketState.niftyStocks : (page === "BANKNIFTY" ? marketState.bankniftyStocks : marketState.sensexStocks);
  const stock = map[symbol];
  if (!stock) return res.status(404).json({ error: "Stock not found" });

  if (field === "ticker") {
    stock.ticker = String(value).trim().toUpperCase();
    // Note: stock ticker changes don't need option resubscribe
    // Equity symbol subscription is handled on next full WS reconnect
  } else {
    const num = parseFloat(value);
    if (isNaN(num)) return res.status(400).json({ error: "Numeric value required" });

    if      (field === "ltp")           { stock.ltp           = num; stock.changePercent = stock.prevClose > 0 ? parseFloat((((num - stock.prevClose) / stock.prevClose) * 100).toFixed(2)) : 0; }
    else if (field === "changePercent") { stock.changePercent = num; stock.ltp           = parseFloat((stock.prevClose * (1 + num / 100)).toFixed(2)); }
    else if (field === "prevClose")     { stock.prevClose     = num; stock.changePercent = stock.prevClose > 0 ? parseFloat((((stock.ltp - num) / num) * 100).toFixed(2)) : 0; }
    else if (field === "weightage")     { stock.weightage     = num; }
    else if (field === "volume")        { stock.volume        = Math.round(num); }

    recalcStock(stock);
  }

  broadcastAll(io);
  saveStockSnapshots();
  res.json({ success: true, stock });
});

/** Run AI Python Backtester */
app.post("/api/backtest/run", (req, res) => {
  console.log("[Backtest API] Triggering python ai_option_analyser.py...");
  exec("python ai_option_analyser.py", (error, stdout, stderr) => {
    if (error) {
      console.error("[Backtest API] Execution failed:", error.message);
      return res.status(500).json({ success: false, error: error.message, stderr });
    }
    console.log("[Backtest API] Script executed successfully");
    res.json({ success: true, stdout, stderr });
  });
});

// ── REST Replay Endpoints ───────────────────────────────────────────────────

/** Initialize market replay session */
app.post("/api/replay/init", (req, res) => {
  const { sessionId, index, startTime, endTime } = req.body;
  if (!sessionId || !index || !startTime || !endTime) {
    return res.status(400).json({ error: "Missing required parameters: sessionId, index, startTime, endTime" });
  }
  const session = initReplaySession(sessionId, index, Number(startTime), Number(endTime));
  res.json({ success: true, session });
});

/** Start market replay session clock */
app.post("/api/replay/play", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }
  playReplaySession(sessionId, io);
  res.json({ success: true, message: `Replay session ${sessionId} started playing.` });
});

/** Pause market replay session clock */
app.post("/api/replay/pause", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }
  pauseReplaySession(sessionId);
  res.json({ success: true, message: `Replay session ${sessionId} paused.` });
});

/** Step market replay session clock forward/backward */
app.post("/api/replay/step", async (req, res) => {
  const { sessionId, direction } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }
  await stepReplaySession(sessionId, io, direction || "FORWARD");
  res.json({ success: true, message: `Replay session ${sessionId} stepped ${direction || "FORWARD"}.` });
});

/** Set market replay speed factor */
app.post("/api/replay/speed", (req, res) => {
  const { sessionId, speed } = req.body;
  if (!sessionId || speed === undefined) {
    return res.status(400).json({ error: "sessionId and speed required" });
  }
  setReplaySpeed(sessionId, Number(speed));
  res.json({ success: true, message: `Replay speed for ${sessionId} updated to ${speed}x.` });
});

// ── Trading Engine API Routes ─────────────────────────────────────────────────

/** GET /api/te/signals — fetch AI signal history */
app.get("/api/te/signals", (req, res) => {
  const { instrument, limit, days } = req.query as { instrument?: string; limit?: string; days?: string };
  const signals = getSignals(instrument, Number(limit) || 200, Number(days) || 90);
  res.json({ success: true, signals });
});

/** POST /api/te/signals — save a new AI signal */
app.post("/api/te/signals", (req, res) => {
  const signal = req.body;
  if (!signal.id || !signal.signal || !signal.instrument) {
    return res.status(400).json({ error: "id, instrument, and signal are required" });
  }
  saveSignal(signal);
  res.json({ success: true });
});

/** POST /api/te/signals/result — update signal outcome (WIN/LOSS/NEUTRAL) */
app.post("/api/te/signals/result", (req, res) => {
  const { id, result, exit_price, pnl } = req.body;
  if (!id || !result) return res.status(400).json({ error: "id and result required" });
  updateSignalResult(id, result, exit_price, pnl);
  res.json({ success: true });
});

/** GET /api/te/paper-trades — fetch paper trades */
app.get("/api/te/paper-trades", (req, res) => {
  const { status, limit } = req.query as { status?: string; limit?: string };
  const validStatus = ["OPEN", "CLOSED"];
  const s = validStatus.includes(status ?? "") ? (status as "OPEN" | "CLOSED") : undefined;
  const trades = getPaperTrades(s, Number(limit) || 1000);

  // Enrich trades with extracted metadata from notes and live data if open
  const enrichedTrades = trades.map(t => {
    let extraData: any = {};
    if (t.notes) {
      try {
        const parsed = JSON.parse(t.notes);
        if (parsed.strategyName) extraData.strategyName = parsed.strategyName;
        if (parsed.scalpType) extraData.scalpType = parsed.scalpType;
        if (parsed.confidence) extraData.confidence = parsed.confidence;
        
        if (t.status === "OPEN" && parsed.symbol) {
          const liveTick = liveOptionTicks.get(parsed.symbol);
          if (liveTick) {
            extraData.livePrice = liveTick.ltp ?? liveTick.bid ?? t.entry_price;
            extraData.liveGreeks = {
              delta: liveTick.delta,
              theta: liveTick.theta,
              gamma: liveTick.gamma,
              iv: liveTick.iv
            };
          }
        }
      } catch (_) {}
    }
    return { ...t, ...extraData };
  });

  res.json({ success: true, trades: enrichedTrades });
});

/** POST /api/te/paper-trades — create a new paper trade */
app.post("/api/te/paper-trades", (req, res) => {
  const trade = req.body;
  if (!trade.id || !trade.instrument || !trade.direction || !trade.strike || !trade.entry_price) {
    return res.status(400).json({ error: "id, instrument, direction, strike, entry_price required" });
  }
  savePaperTrade(trade);
  res.json({ success: true });
});

/** POST /api/te/paper-trades/close — close an open paper trade */
app.post("/api/te/paper-trades/close", (req, res) => {
  const { id, exit_price, pnl } = req.body;
  if (!id || exit_price === undefined || pnl === undefined) {
    return res.status(400).json({ error: "id, exit_price, and pnl required" });
  }
  const ok = closePaperTrade(id, Number(exit_price), Number(pnl));
  if (!ok) return res.status(404).json({ error: "Trade not found or already closed" });
  res.json({ success: true });
});

/** GET /api/te/shadow-trades — fetch shadow trades */
app.get("/api/te/shadow-trades", (req, res) => {
  const { status, limit } = req.query as { status?: string; limit?: string };
  const validStatus = ["OPEN", "CLOSED"];
  const s = validStatus.includes(status ?? "") ? (status as "OPEN" | "CLOSED") : undefined;
  const trades = getShadowTrades(s, Number(limit) || 1000);

  // Enrich trades with extracted metadata from notes and live data if open
  const enrichedTrades = trades.map(t => {
    let extraData: any = {};
    if (t.notes) {
      try {
        const parsed = JSON.parse(t.notes);
        if (parsed.strategyName) extraData.strategyName = parsed.strategyName;
        if (parsed.scalpType) extraData.scalpType = parsed.scalpType;
        if (parsed.confidence) extraData.confidence = parsed.confidence;
        
        if (t.status === "OPEN" && parsed.symbol) {
          const liveTick = liveOptionTicks.get(parsed.symbol);
          if (liveTick) {
            extraData.livePrice = liveTick.ltp ?? liveTick.bid ?? t.entry_price;
            extraData.liveGreeks = {
              delta: liveTick.delta,
              theta: liveTick.theta,
              gamma: liveTick.gamma,
              iv: liveTick.iv
            };
          }
        }
      } catch (_) {}
    }
    return { ...t, ...extraData };
  });

  res.json({ success: true, trades: enrichedTrades });
});

/** POST /api/te/shadow-trades — create a new shadow trade */
app.post("/api/te/shadow-trades", (req, res) => {
  const trade = req.body;
  if (!trade.id || !trade.instrument || !trade.direction || !trade.strike || !trade.entry_price) {
    return res.status(400).json({ error: "id, instrument, direction, strike, entry_price required" });
  }
  saveShadowTrade(trade);
  res.json({ success: true });
});

/** POST /api/te/shadow-trades/close — close an open shadow trade */
app.post("/api/te/shadow-trades/close", (req, res) => {
  const { id, exit_price, pnl } = req.body;
  if (!id || exit_price === undefined || pnl === undefined) {
    return res.status(400).json({ error: "id, exit_price, and pnl required" });
  }
  const ok = closeShadowTrade(id, Number(exit_price), Number(pnl));
  if (!ok) return res.status(404).json({ error: "Trade not found or already closed" });
  res.json({ success: true });
});

/** POST /api/te/paper-trades/notes — update notes on a paper trade */
app.post("/api/te/paper-trades/notes", (req, res) => {
  const { id, notes } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  updatePaperTradeNotes(id, notes ?? "");
  res.json({ success: true });
});

/** DELETE /api/te/paper-trades/:id — delete a paper trade */
app.delete("/api/te/paper-trades/:id", (req, res) => {
  const { id } = req.params;
  const ok = deletePaperTrade(id);
  if (!ok) return res.status(404).json({ error: "Trade not found" });
  res.json({ success: true });
});

/** POST /api/te/paper-trades/activate — activate a pending paper trade */
app.post("/api/te/paper-trades/activate", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  const ok = activatePaperTrade(id);
  if (!ok) return res.status(404).json({ error: "Trade not found or already active" });
  res.json({ success: true });
});

/** GET /api/te/fii-dii — get FII/DII net flows */
app.get("/api/te/fii-dii", (req, res) => {
  const limit = Number(req.query.limit) || 30;
  res.json({ success: true, fiiDiiHistory: getFiiDiiHistory(limit) });
});

/** POST /api/te/fii-dii — save FII/DII net flows */
app.post("/api/te/fii-dii", (req, res) => {
  const { date, fii_cash, dii_cash } = req.body;
  if (!date || fii_cash === undefined || dii_cash === undefined) {
    return res.status(400).json({ error: "date, fii_cash, and dii_cash required" });
  }
  saveFiiDii(date, Number(fii_cash), Number(dii_cash));
  res.json({ success: true });
});

/** GET /api/te/lot-config — fetch all lot size configurations */
app.get("/api/te/lot-config", (_req, res) => {
  res.json({ success: true, lotConfig: getLotConfig() });
});

/** POST /api/te/lot-config — update lot size configurations (bulk) */
app.post("/api/te/lot-config", (req, res) => {
  const { configs } = req.body as { configs?: { instrument: string; lot_size: number }[] };
  if (!Array.isArray(configs) || configs.length === 0) {
    return res.status(400).json({ error: "configs array required" });
  }
  for (const c of configs) {
    if (!c.instrument || typeof c.lot_size !== "number" || c.lot_size < 1) {
      return res.status(400).json({ error: `Invalid entry: ${JSON.stringify(c)}` });
    }
  }
  upsertLotConfigs(configs);
  res.json({ success: true, lotConfig: getLotConfig() });
});

/** GET /api/te/orb-naked/state — fetch ORB Naked engine state */
app.get("/api/te/orb-naked/state", (_req, res) => {
  res.json({ success: true, state: getORBEngineState() });
});

/** POST /api/te/orb-naked/settings — update ORB Naked engine settings */
app.post("/api/te/orb-naked/settings", (req, res) => {
  const settings = req.body;
  updateORBEngineSettings(settings);
  res.json({ success: true, state: getORBEngineState() });
});

// ── Ultra Backtest & AI Strategy API Routes ──────────────────────────────────

const GEMINI_API_KEY_SERVER = process.env.GEMINI_API_KEY || "";

/**
 * POST /api/ai-generate-strategy
 * Prompts Gemini to generate a strategy based on selected indicators & timeframe.
 */
app.post("/api/ai-generate-strategy", async (req, res) => {
  const { instrument, timeframe, indicators, riskProfile, strategyFocus } = req.body as {
    instrument: string;
    timeframe: string;
    indicators: string[];
    riskProfile: string;
    strategyFocus: string;
  };

  if (!instrument || !indicators || indicators.length === 0) {
    return res.status(400).json({ error: "instrument and indicators are required" });
  }

  const prompt = `You are an expert Algorithmic Trader specializing in Indian NSE/BSE derivative strategies.
Generate a complete trading strategy for:
- Instrument: ${instrument}
- Timeframe: ${timeframe || "15m"}
- Indicators: ${indicators.join(", ")}
- Strategy Focus: ${strategyFocus || "OPTION_BUYING"}
- Risk Profile: ${riskProfile || "MODERATE"}

Return a JSON object with this exact schema:
{
  "strategyName": "string",
  "description": "2-3 sentence description",
  "entryRules": ["rule 1", "rule 2", "rule 3"],
  "exitRules": ["exit rule 1", "exit rule 2"],
  "rsiOversold": number,
  "rsiOverbought": number,
  "targetPct": number,
  "stopLossPct": number,
  "adxStrength": number,
  "stochOversold": number,
  "stochOverbought": number,
  "bestTimeOfDay": "string (e.g. 9:30-11:00 AM IST)",
  "avoidConditions": ["condition to avoid 1", "condition to avoid 2"],
  "expectedWinRate": number,
  "riskRewardRatio": "string (e.g. 1:2.5)",
  "marketRegimeSuited": "string (e.g. Trending Bull or Range-Bound)",
  "indicatorSettings": { "key": "value" }
}
Respond with ONLY the valid JSON object.`;

  try {
    if (!GEMINI_API_KEY_SERVER) {
      return res.json({
        success: true,
        strategy: {
          strategyName: `${instrument} ${indicators.slice(0, 2).join("+")} Strategy`,
          description: `A multi-indicator ${strategyFocus} strategy for ${instrument} using ${indicators.join(", ")} on ${timeframe} timeframe.`,
          entryRules: [`RSI oversold crossup below 35`, `MACD bullish crossover`, `Price above VWAP`],
          exitRules: [`Premium gain > 50%`, `Stop loss at 30% premium loss`],
          rsiOversold: 35, rsiOverbought: 65, targetPct: 50, stopLossPct: 30, adxStrength: 22,
          stochOversold: 25, stochOverbought: 75, bestTimeOfDay: "9:30-11:30 AM IST",
          avoidConditions: ["High VIX (>18)", "Pre-expiry Thursday afternoon"],
          expectedWinRate: 58, riskRewardRatio: "1:2", marketRegimeSuited: "Trending",
          indicatorSettings: {},
        },
        geminiUsed: false,
      });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY_SERVER}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
    const data: any = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    const strategy = JSON.parse(text.trim());
    console.log(`[AI Strategy] Generated strategy for ${instrument} using ${indicators.join(", ")}`);
    res.json({ success: true, strategy, geminiUsed: true });
  } catch (err: any) {
    console.error("[AI Strategy] Gemini call failed:", err.message);
    res.json({
      success: true,
      strategy: {
        strategyName: `${instrument} Multi-Indicator Strategy`,
        description: `Auto-generated ${strategyFocus} strategy for ${instrument} on ${timeframe} timeframe using ${indicators.join(", ")}.`,
        entryRules: [`RSI oversold bounce`, `MACD crossover confirmation`, `EMA alignment`],
        exitRules: [`Target: 50% premium gain`, `Stop loss: 30% premium loss`, `Time exit: 3:00 PM IST`],
        rsiOversold: 35, rsiOverbought: 65, targetPct: 50, stopLossPct: 30, adxStrength: 22,
        stochOversold: 25, stochOverbought: 75, bestTimeOfDay: "9:30-11:30 AM IST",
        avoidConditions: ["High India VIX", "Expiry day morning"],
        expectedWinRate: 55, riskRewardRatio: "1:1.8", marketRegimeSuited: "Trending",
        indicatorSettings: {},
      },
      geminiUsed: false,
      error: err.message,
    });
  }
});

/** POST /api/te/select-custom-stock — set and load custom F&O stock option chain */
app.post("/api/te/select-custom-stock", async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  const baseSymbol = symbol.toUpperCase().replace("NSE:", "").replace("-EQ", "");
  marketState.customStockSymbol = baseSymbol;

  const fyersSymbol = `NSE:${baseSymbol}-EQ`;
  console.log(`[CustomStock] Selecting custom stock ${baseSymbol} (Fyers symbol: ${fyersSymbol})`);

  const loaded = await fetchInitialChain(fyersSymbol, "");
  if (loaded) {
    resubscribeOptionSymbols();
  }

  broadcastAll(io);
  res.json({
    success: true,
    customStockSymbol: baseSymbol,
    customStockOptionChain: marketState.customStockOptionChain,
  });
});

/**
 * POST /api/auto-backtest
 * Runs ultra-backtest on historical candles from the in-memory/SQLite store.
 */
app.post("/api/auto-backtest", async (req, res) => {
  const {
    instrument = "NIFTY",
    timeframe = "15m",
    indicators = ["RSI", "MACD", "EMA9", "EMA21"],
    riskProfile = "MODERATE",
    strategyFocus = "OPTION_BUYING",
    rsiOversold = 35,
    rsiOverbought = 65,
    targetPct = 50,
    stopLossPct = 30,
    adxStrength = 22,
    stochOversold = 25,
    stochOverbought = 75,
    maxTradesPerDay = 3,
  } = req.body as Partial<BacktestRules> & { instrument?: string; timeframe?: string; indicators?: string[] };

  try {
    const inst = (instrument as InstrumentType);

    // Pull enriched candles from in-memory store
    const tf = timeframe as any;
    const rawCandles = getRTCandles(inst, tf);

    if (!rawCandles || rawCandles.length < 20) {
      return res.status(400).json({
        error: "Not enough candle data for backtesting. The system needs at least 20 candles. Ensure Fyers WebSocket is connected and market data is streaming.",
      });
    }

    const rules: BacktestRules = {
      instrument: inst,
      timeframe,
      selectedIndicators: (indicators as Indicator[]),
      riskProfile: riskProfile as "LOW" | "MODERATE" | "HIGH",
      strategyFocus: strategyFocus as "OPTION_BUYING" | "OPTION_SELLING" | "FUTURES",
      rsiOversold: Number(rsiOversold),
      rsiOverbought: Number(rsiOverbought),
      targetPct: Number(targetPct),
      stopLossPct: Number(stopLossPct),
      adxStrength: Number(adxStrength),
      stochOversold: Number(stochOversold),
      stochOverbought: Number(stochOverbought),
      maxTradesPerDay: Number(maxTradesPerDay),
      macdCross: true,
      bbBreakout: true,
      emaAlignment: true,
    };

    // Option chain integration (call/put walls as S/R)
    const chainState = inst === "BANKNIFTY"
      ? marketState.bankniftyOptionChain
      : inst === "NIFTY"
        ? marketState.niftyOptionChain
        : marketState.sensexOptionChain;

    const strikes: any[] = chainState?.strikes ?? [];
    let callWall: number | undefined;
    let putWall:  number | undefined;
    if (strikes.length > 0) {
      const maxCE = strikes.reduce((a: any, b: any) => (b.ceOI || 0) > (a.ceOI || 0) ? b : a, strikes[0]);
      const maxPE = strikes.reduce((a: any, b: any) => (b.peOI || 0) > (a.peOI || 0) ? b : a, strikes[0]);
      callWall = maxCE?.strikePrice;
      putWall  = maxPE?.strikePrice;
    }

    // Run backtest (compute PCR from OI totals since OptionChainState doesn't have pcr field directly)
    const pcrValue = chainState?.totalCallOi && chainState.totalCallOi > 0
      ? chainState.totalPutOi / chainState.totalCallOi
      : undefined;
    const result = runUltraBacktest(rawCandles, rules, { callWall, putWall, pcr: pcrValue });

    // Gemini AI optimization (non-blocking, best-effort)
    let geminiResult = { analysis: "", optimizedRules: {}, pineScriptNotes: "" };
    try {
      geminiResult = await geminiOptimizeStrategy(result, rules);
    } catch (gErr: any) {
      console.warn("[AutoBacktest] Gemini optimization skipped:", gErr.message);
    }

    result.geminiAnalysis = geminiResult.analysis;
    result.optimizedRules = geminiResult.optimizedRules;

    console.log(`[AutoBacktest] ${inst}/${timeframe}: ${result.stats.totalTrades} trades, ${result.stats.winRate}% WR, P&L ₹${result.stats.totalPnl}`);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error("[AutoBacktest] Failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistent Historical Backtesting API
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/backtest/queue — Get current tasks queue */
app.get("/api/backtest/queue", (req, res) => {
  res.json({ success: true, queue: getQueue() });
});

/** POST /api/backtest/queue/add — Add a strategy to the backtest queue */
app.post("/api/backtest/queue/add", (req, res) => {
  const { strategyId, instrument } = req.body;
  if (!strategyId || !instrument) {
    return res.status(400).json({ error: "strategyId and instrument are required" });
  }
  const task = addTask(strategyId, instrument as any);
  res.json({ success: true, task });
});

/** POST /api/backtest/queue/run — Manually start/resume queue execution */
app.post("/api/backtest/queue/run", (req, res) => {
  triggerWorker();
  res.json({ success: true, message: "Worker triggered." });
});

/** POST /api/backtest/queue/clear — Clear the backtest queue */
app.post("/api/backtest/queue/clear", (req, res) => {
  clearQueue();
  res.json({ success: true });
});

/** GET /api/backtest/strategies — Fetch registered strategies */
app.get("/api/backtest/strategies", (req, res) => {
  try {
    const list = getStrategies();
    res.json({ success: true, strategies: list });
  } catch (err: any) {
    console.error("[BacktestStrategiesAPI] Failed to fetch strategies:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/backtest/runs — Fetch completed runs from the database */
app.get("/api/backtest/runs", async (req, res) => {
  try {
    const dbRes = await db.query("SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT 50");
    res.json({ success: true, runs: dbRes.rows });
  } catch (err: any) {
    console.error("[BacktestRunsAPI] Failed to fetch runs:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 11: Daily Bias API
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/daily-bias — Returns daily bias for all instruments */
app.get("/api/daily-bias", (_req, res) => {
  res.json({ success: true, biases: getAllDailyBiases() });
});

/** GET /api/daily-bias/:instrument — Returns daily bias for one instrument */
app.get("/api/daily-bias/:instrument", (req, res) => {
  const inst = req.params.instrument.toUpperCase() as any;
  const bias = getDailyBias(inst);
  if (!bias) return res.json({ success: false, error: "Not yet computed. Wait for 1D candle data." });
  res.json({ success: true, bias });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 12: Position Trade API
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/position-trades — Returns all position trades */
app.get("/api/position-trades", (req, res) => {
  const status = req.query.status as string | undefined;
  const trades = getPositionTrades(status as any ?? "ALL");
  res.json({ success: true, trades, count: trades.length });
});

/** POST /api/position-trades — Open a new position trade */
app.post("/api/position-trades", (req, res) => {
  try {
    const setup: PositionTradeSetup = req.body;
    if (!setup.instrument || !setup.direction || !setup.entryPrice) {
      return res.status(400).json({ success: false, error: "Missing required fields: instrument, direction, entryPrice" });
    }
    const trade = openPositionTrade(setup);
    res.json({ success: true, trade });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/position-trades/:id/close — Close a position trade */
app.post("/api/position-trades/:id/close", (req, res) => {
  const { id } = req.params;
  const { exitPrice, reason } = req.body;
  if (!exitPrice) return res.status(400).json({ success: false, error: "exitPrice required" });
  const trade = closePositionTrade(id, Number(exitPrice), reason as PositionExitReason);
  if (!trade) return res.status(404).json({ success: false, error: "Trade not found or already closed" });
  res.json({ success: true, trade });
});

/** POST /api/position-trades/:id/notes — Update notes */
app.post("/api/position-trades/:id/notes", (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  updatePositionNotes(id, notes ?? "");
  res.json({ success: true });
});

/** POST /api/position-trades/evaluate — Evaluate conditions for a position trade */
app.post("/api/position-trades/evaluate", (req, res) => {
  const { instrument, lots } = req.body;
  const inst = (instrument ?? "NIFTY").toUpperCase() as any;
  const chainKey = inst === "NIFTY" ? "niftyOptionChain" :
                   inst === "BANKNIFTY" ? "bankniftyOptionChain" :
                   inst === "SENSEX" ? "sensexOptionChain" :
                   inst === "HDFCBANK" ? "hdfcbankOptionChain" :
                   inst === "RELIANCE" ? "relianceOptionChain" :
                   inst === "ICICIBANK" ? "icicibankOptionChain" :
                   "customStockOptionChain";
  const vix  = marketState[chainKey]?.indiaVix ?? 0;
  const bias = getDailyBias(inst);
  const eval_ = evaluatePositionConditions(inst, vix, bias, lots ?? 1);
  res.json({ success: true, evaluation: eval_, vix, dailyBias: bias });
});

/** POST /api/position-trades/calc-setup — Calculate SL/Target for a position setup */
app.post("/api/position-trades/calc-setup", (req, res) => {
  const { instrument, direction, strike, expiry, optionSymbol, entryPrice, lots, daysToExpiry } = req.body;
  const inst = (instrument ?? "NIFTY").toUpperCase() as any;
  const chainKey = inst === "NIFTY" ? "niftyOptionChain" :
                   inst === "BANKNIFTY" ? "bankniftyOptionChain" :
                   inst === "SENSEX" ? "sensexOptionChain" :
                   inst === "HDFCBANK" ? "hdfcbankOptionChain" :
                   inst === "RELIANCE" ? "relianceOptionChain" :
                   inst === "ICICIBANK" ? "icicibankOptionChain" :
                   "customStockOptionChain";
  const vix      = marketState[chainKey]?.indiaVix ?? 0;
  let lotSize   = getLotSize(inst);
  if (lotSize <= 1) {
    const DEFAULT_LOT_SIZES: Record<string, number> = {
      NIFTY: 75,
      BANKNIFTY: 35,
      SENSEX: 20,
      HDFCBANK: 550,
      RELIANCE: 250,
      ICICIBANK: 700
    };
    lotSize = DEFAULT_LOT_SIZES[inst.toUpperCase()] ?? 20;
  }
  const bias     = getDailyBias(inst);

  const setup = calcPositionSetup(
    inst, direction, strike, expiry, optionSymbol ?? "",
    entryPrice, lots ?? 1, lotSize, vix, daysToExpiry ?? 7, bias
  );
  res.json({ success: true, setup });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 13: Swing S&R Level API
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/swing-levels — Returns swing levels for all instruments */
app.get("/api/swing-levels", (_req, res) => {
  res.json({ success: true, levels: getAllSwingLevels() });
});

/** GET /api/swing-levels/:instrument — Returns swing levels for one instrument */
app.get("/api/swing-levels/:instrument", (req, res) => {
  const inst = req.params.instrument.toUpperCase() as any;
  const levels = getSwingLevels(inst);
  if (!levels) return res.json({ success: false, error: "Not yet computed. Wait for 1D candle data." });
  res.json({ success: true, levels });
});

/** GET /api/swing-levels/:instrument/proximity — Proximity penalty for direction */
app.get("/api/swing-levels/:instrument/proximity", (req, res) => {
  const inst      = req.params.instrument.toUpperCase() as any;
  const direction = (req.query.direction as string ?? "BUY_CE") as "BUY_CE" | "BUY_PE";
  const penalty   = getProximityPenalty(inst, direction);
  const levels    = getSwingLevels(inst);
  res.json({
    success: true,
    penalty,
    proximityWarning: levels?.proximityWarning ?? false,
    proximityDetail:  levels?.proximityDetail  ?? "N/A",
  });
});

/** GET /api/signal-memory/:instrument — Returns signal memory statistics */
app.get("/api/signal-memory/:instrument", (req, res) => {
  const inst = req.params.instrument.toUpperCase() as any;
  const stats = getSignalMemoryStats(inst);
  res.json({ success: true, stats });
});

/** GET /api/news/:instrument — Returns live news and sentiment for instrument */
app.get("/api/news/:instrument", async (req, res) => {
  try {
    const inst = req.params.instrument.toUpperCase() as any;
    const data = await getNewsForInstrument(inst);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Utility: Auto-cleanup daily logs older than 3 days ────────────────────────
function cleanupOldLogs() {
  try {
    const rootDir = process.cwd();
    const files = fs.readdirSync(rootDir);
    const now = Date.now();
    const maxAgeMs = 3 * 24 * 60 * 60 * 1000; // 3 Days in milliseconds

    let deletedCount = 0;
    files.forEach(file => {
      if (file.endsWith(".log") && file.match(/^\d{4}-\d{2}-\d{2}\.log$/)) {
        const filePath = path.join(rootDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAgeMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`[LogCleanup] 🗑️ Deleted old daily log file: ${file}`);
        }
      }
    });
    if (deletedCount > 0) {
      console.log(`[LogCleanup] ✅ Completed. Cleaned up ${deletedCount} daily log files.`);
    } else {
      console.log(`[LogCleanup] ✅ Completed. No old daily log files found to delete.`);
    }
  } catch (err: any) {
    console.error("[LogCleanup] ❌ Failed to cleanup old log files:", err.message);
  }
}

// ── Boot server ───────────────────────────────────────────────────────────────
async function startServer() {
  // Run log cleanup on boot
  cleanupOldLogs();

  // Initialize Database Schema if not exists
  await initializeSchema();

  // Start high-performance timescaledb background recording spooler
  startRecorder();

  // Start isolated ORB Naked Engine
  initializeORBNakedEngine(io);


  // Step 1 & 2: Auto history loader on server start
  try {
    const { HistoricalImporter } = await import("./server/services/historicalImporter.js");
    await HistoricalImporter.autoBackfillIfNeeded("NIFTY");
    await HistoricalImporter.autoBackfillIfNeeded("SENSEX");
    await HistoricalImporter.autoBackfillIfNeeded("BANKNIFTY");
  } catch (err: any) {
    console.error("[Boot] Auto historical backfiller failed:", err.message);
  }

  // ── Layer 11 + 13 Startup: Compute daily bias and swing levels from 1D candles ──
  try {
    const { getRTCandles } = await import("./server/services/chartRealtime.js");
    const { enrichCandles } = await import("./server/services/indicatorEngine.js");
    type RawCandleType = import("./server/services/indicatorEngine.js").RawCandle;

    for (const inst of ["NIFTY", "SENSEX", "BANKNIFTY"] as const) {
      const raw1D = getRTCandles(inst, "1D");
      if (raw1D.length >= 20) {
        const enriched = enrichCandles(raw1D as RawCandleType[]);
        computeDailyBias(inst, enriched);    // Layer 11
        computeSwingLevels(inst, enriched);  // Layer 13
      } else {
        console.log(`[Boot] Layer11/13: ${inst} has only ${raw1D.length} daily candles — will recompute when data arrives.`);
      }
    }
    console.log("[Boot] ✅ Layer 11 (DailyBias) + Layer 13 (SwingLevels) initialized.");
  } catch (err: any) {
    console.error("[Boot] Layer11/13 init failed:", err.message);
  }

  // Register process shutdown hooks for graceful termination
  const shutdown = () => {
    console.log("\n[Server] 🛑 Shutdown signal received. Closing pipelines...");
    try {
      saveStockSnapshots();
    } catch (e: any) {
      console.error("[Shutdown] Failed to save stock snapshots:", e.message);
    }
    stopRecorder();
    stopFyersSocket();
    closeIndicatorDB();
    shutdownORBNakedEngine();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), "dist");
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // Load alert rules and triggered alert history from disk
  loadAlertsFromDisk();

  // Load persisted Fyers config from fyers_config.json on startup
  try {
    const configFile = path.join(process.cwd(), "fyers_config.json");
    if (fs.existsSync(configFile)) {
      const configData = JSON.parse(fs.readFileSync(configFile, "utf8"));
      if (configData.app_id) marketState.fyersConfig.app_id = configData.app_id;
      if (configData.secret_key) marketState.fyersConfig.secret_key = configData.secret_key;
      if (configData.redirect_uri) marketState.fyersConfig.redirect_uri = configData.redirect_uri;
      if (configData.access_token) marketState.fyersConfig.access_token = configData.access_token;
      console.log("[Boot] Loaded Fyers config from fyers_config.json (token present:", !!configData.access_token, ")");
    }
  } catch (e: any) {
    console.error("[Boot] Failed to load fyers_config.json:", e.message);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 CODETRADE Server running → http://localhost:${PORT}`);
    console.log(`   Architecture: Pure Realtime Streaming (Server-side Fyers WebSocket)`);

    // Start background backtester queue worker
    triggerWorker();

    // Auto-connect if token already saved
    if (marketState.fyersConfig.access_token) {
      console.log("[Boot] Saved token found — connecting Fyers WebSocket...");
      marketState.isSimulating = false;
      startFyersSocket(marketState.fyersConfig.access_token, io);
      // Fetch initial option chains sequentially (staggered to prevent 429)
      fetchInitialChainsSequentially().catch(console.error);
    } else {
      console.log("[Boot] No token saved. Awaiting authentication via /api/fyers/config");
    }
  });
}

startServer();
