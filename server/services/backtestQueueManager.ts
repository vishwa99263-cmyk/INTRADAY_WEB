import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "../storage/db.js";
import { runUltraBacktest, type BacktestRules, type RawCandle, type FullBacktestResult } from "./ultraBacktestEngine.js";
import { getStrategies } from "./strategyStore.js";
import { getHistoricalData } from "../config/historyProvider.js";
import { DataValidationEngine } from "./dataValidation.js";
import { writeCandlesToDB } from "./candleGenerator.js";
import type { CompiledCandle } from "./candleGenerator.js";

export interface QueueTask {
  id: string;
  strategyId: string;
  instrument: "NIFTY" | "BANKNIFTY" | "SENSEX";
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  createdAt: string;
  completedAt: string | null;
  resultId: string | null;
  error: string | null;
}

const QUEUE_FILE = path.join(process.cwd(), "server", "storage", "backtest_queue.json");

let workerActive = false;

function initQueueFile() {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(QUEUE_FILE)) {
    fs.writeFileSync(QUEUE_FILE, "[]", "utf8");
  } else {
    // If tasks are stuck in PROCESSING (e.g. server crashed/restarted), reset them to PENDING
    try {
      const raw = fs.readFileSync(QUEUE_FILE, "utf8");
      const list = JSON.parse(raw) as QueueTask[];
      let modified = false;
      const updated = list.map(t => {
        if (t.status === "PROCESSING") {
          modified = true;
          return { ...t, status: "PENDING" as const, progress: 0 };
        }
        return t;
      });
      if (modified) {
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(updated, null, 2), "utf8");
      }
    } catch (e) {
      console.error("[BacktestQueue] Error loading/repairing queue file on startup:", e);
      fs.writeFileSync(QUEUE_FILE, "[]", "utf8");
    }
  }
}

export function getQueue(): QueueTask[] {
  try {
    initQueueFile();
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    return JSON.parse(raw) as QueueTask[];
  } catch (e) {
    console.error("[BacktestQueue] Error reading queue:", e);
    return [];
  }
}

export function saveQueue(queue: QueueTask[]): void {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf8");
  } catch (e) {
    console.error("[BacktestQueue] Error saving queue:", e);
  }
}

export function addTask(strategyId: string, instrument: "NIFTY" | "BANKNIFTY" | "SENSEX"): QueueTask {
  const queue = getQueue();
  
  // Check if a task is already pending/processing for this strategy and instrument
  const existing = queue.find(t => t.strategyId === strategyId && t.instrument === instrument && (t.status === "PENDING" || t.status === "PROCESSING"));
  if (existing) {
    return existing;
  }

  const newTask: QueueTask = {
    id: crypto.randomUUID(),
    strategyId,
    instrument,
    status: "PENDING",
    progress: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
    resultId: null,
    error: null
  };

  queue.push(newTask);
  saveQueue(queue);
  
  // Start background worker
  triggerWorker();

  return newTask;
}

export function clearQueue(): void {
  saveQueue([]);
}

export function triggerWorker(): void {
  if (workerActive) return;
  workerActive = true;
  console.log("[BacktestQueue] ⚙️ Background worker started.");
  
  // Run async loop
  (async () => {
    while (true) {
      try {
        const queue = getQueue();
        const pendingTask = queue.find(t => t.status === "PENDING");
        
        if (!pendingTask) {
          console.log("[BacktestQueue] 💤 No pending backtest tasks found. Worker sleeping.");
          workerActive = false;
          break;
        }

        // Process this task
        pendingTask.status = "PROCESSING";
        pendingTask.progress = 10;
        saveQueue(queue);

        console.log(`[BacktestQueue] 🚀 Processing backtest task ${pendingTask.id} (${pendingTask.instrument} + ${pendingTask.strategyId})`);

        try {
          const resultId = await runBacktestTask(pendingTask, (progressNum) => {
            // Progress callback
            const updatedQueue = getQueue();
            const taskToUpdate = updatedQueue.find(t => t.id === pendingTask.id);
            if (taskToUpdate) {
              taskToUpdate.progress = progressNum;
              saveQueue(updatedQueue);
            }
          });

          // Mark task as completed
          const finalQueue = getQueue();
          const taskToComplete = finalQueue.find(t => t.id === pendingTask.id);
          if (taskToComplete) {
            taskToComplete.status = "COMPLETED";
            taskToComplete.progress = 100;
            taskToComplete.completedAt = new Date().toISOString();
            taskToComplete.resultId = resultId;
            saveQueue(finalQueue);
          }
          console.log(`[BacktestQueue] ✅ Successfully completed backtest task ${pendingTask.id}`);

        } catch (err: any) {
          console.error(`[BacktestQueue] ❌ Failed task ${pendingTask.id}:`, err);
          const finalQueue = getQueue();
          const taskToFail = finalQueue.find(t => t.id === pendingTask.id);
          if (taskToFail) {
            taskToFail.status = "FAILED";
            taskToFail.progress = 0;
            taskToFail.error = err.message || String(err);
            saveQueue(finalQueue);
          }
        }

      } catch (loopErr) {
        console.error("[BacktestQueue] Loop error:", loopErr);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Delay before next task
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  })();
}

/**
 * Ensures historical candles exist and runs backtest.
 */
async function runBacktestTask(task: QueueTask, progressCb: (progress: number) => void): Promise<string> {
  const symbol = task.instrument === "NIFTY" 
    ? "NSE:NIFTY50-INDEX" 
    : (task.instrument === "BANKNIFTY" ? "NSE:NIFTYBANK-INDEX" : "BSE:SENSEX-INDEX");
  
  progressCb(15);

  // 1. Check database candle count
  const checkRes = await db.query(`
    SELECT COUNT(*) as count 
    FROM market_candles 
    WHERE symbol = $1 AND resolution = '1m'
  `, [symbol]);
  
  const existingCount = Number(checkRes.rows[0]?.count ?? 0);
  console.log(`[BacktestQueue] Symbol ${symbol} has ${existingCount} candles in DB.`);

  // 2. Fetch/Backfill if missing or low (less than 1000 candles)
  if (existingCount < 1000) {
    console.log(`[BacktestQueue] ⚠️ Low historical candles for ${symbol}. Backfilling...`);
    progressCb(25);
    
    // Fetch last 30 days of data
    const nowSec = Math.floor(Date.now() / 1000);
    const rangeFrom = nowSec - (30 * 24 * 3600); // 30 days
    const rangeTo = nowSec - 60; // 1 minute ago (completed candles)

    const apiRes = await getHistoricalData({
      symbol,
      resolution: "1",
      date_format: "0",
      range_from: String(rangeFrom),
      range_to: String(rangeTo),
      cont_flag: "1",
      oi_flag: "1"
    });

    if (apiRes && apiRes.s === "ok" && apiRes.candles && apiRes.candles.length > 0) {
      console.log(`[BacktestQueue] Downloaded ${apiRes.candles.length} candles for ${symbol}. Importing...`);
      progressCb(45);

      const tickRows: any[][] = [];
      const candleRows: CompiledCandle[] = [];

      apiRes.candles.forEach(c => {
        const time = c[0];
        const open = c[1];
        const high = c[2];
        const low = c[3];
        const close = c[4];
        const volume = c[5] ?? 0;
        const oi = c[6] ?? 0;
        const ts = new Date(time * 1000).toISOString();

        const validTick = DataValidationEngine.validateAndRepairTick({
          timestamp: ts,
          symbol,
          ltp: close,
          volume,
          bid: close * 0.9999,
          ask: close * 1.0001,
          oi
        });

        if (validTick) {
          tickRows.push([
            validTick.timestamp,
            validTick.symbol,
            validTick.ltp,
            validTick.volume,
            validTick.bid,
            validTick.ask,
            0,
            0,
            validTick.oi,
            validTick.ltp
          ]);

          candleRows.push({
            timestamp: validTick.timestamp,
            symbol,
            resolution: "1m",
            open,
            high,
            low,
            close: validTick.ltp,
            volume: validTick.volume,
            oi: validTick.oi,
            vwap: validTick.ltp,
            deltaVolume: 0,
            buyPressure: 0,
            sellPressure: 0,
            momentum: 0
          });
        }
      });

      if (tickRows.length > 0) {
        await db.bulkInsert("raw_ticks", [
          "timestamp", "symbol", "ltp", "volume", "bid", "ask", "bid_qty", "ask_qty", "oi", "vwap"
        ], tickRows);
      }

      if (candleRows.length > 0) {
        await writeCandlesToDB(candleRows);
      }
      console.log(`[BacktestQueue] Ingestion completed. Imported ${candleRows.length} candles.`);
    } else {
      console.warn(`[BacktestQueue] Could not get backfill data for ${symbol}. Using whatever is available.`);
    }
  }

  progressCb(60);

  // 3. Query all 1m candles for backtesting
  const candleRes = await db.query(`
    SELECT timestamp, open, high, low, close, volume, oi, vwap
    FROM market_candles
    WHERE symbol = $1 AND resolution = '1m'
    ORDER BY timestamp ASC
  `, [symbol]);

  if (candleRes.rows.length === 0) {
    throw new Error(`No candle data available in database for symbol ${symbol}`);
  }

  progressCb(75);

  const rawCandles: RawCandle[] = candleRes.rows.map(r => ({
    time: Math.floor(new Date(r.timestamp).getTime() / 1000),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    oi: Number(r.oi || 0),
    vwap: Number(r.vwap || r.close),
  }));

  console.log(`[BacktestQueue] Running ultra backtester on ${rawCandles.length} candles for strategy ${task.strategyId}`);

  // Find strategy details if user-defined or default system strategy
  const strategies = getStrategies();
  const customStrat = strategies.find(s => s.id === task.strategyId);

  const rules: BacktestRules = {
    instrument: task.instrument,
    timeframe: "1m",
    selectedIndicators: ["RSI", "MACD", "BB", "Stochastic", "ATR", "ADX", "EMA9", "EMA21", "EMA50", "VWAP", "Volume"],
    riskProfile: "MODERATE",
    strategyFocus: "OPTION_BUYING",
    strategyId: task.strategyId,
    targetPct: 50,
    stopLossPct: 30,
    maxTradesPerDay: 5,
  };

  progressCb(85);

  // Run backtester
  const result: FullBacktestResult = runUltraBacktest(rawCandles, rules);
  
  progressCb(90);

  // 4. Save results to backtest_runs in postgres
  const insertQuery = `
    INSERT INTO backtest_runs (
      strategy_name, index_symbol, start_time, end_time,
      total_trades, win_rate, profit_factor, sharpe_ratio, max_drawdown, avg_rr,
      strategy_config, trade_logs
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `;

  const startTime = new Date(rawCandles[0].time * 1000).toISOString();
  const endTime = new Date(rawCandles[rawCandles.length - 1].time * 1000).toISOString();
  const avgRR = result.stats.avgLoss !== 0 ? Math.abs(result.stats.avgWin / result.stats.avgLoss) : 0;

  const strategyName = customStrat ? customStrat.name : mapStrategyIdToName(task.strategyId);

  const dbRes = await db.query(insertQuery, [
    strategyName,
    symbol,
    startTime,
    endTime,
    result.stats.totalTrades,
    result.stats.winRate,
    result.stats.profitFactor,
    result.stats.sharpeRatio,
    result.stats.maxDrawdown,
    avgRR,
    JSON.stringify(rules),
    JSON.stringify(result.trades)
  ]);

  const insertedId = dbRes.rows[0]?.id;
  if (!insertedId) {
    throw new Error("Failed to insert backtest run results into database");
  }

  return String(insertedId);
}

function mapStrategyIdToName(id: string): string {
  switch (id) {
    case "ORB_NAKED":
      return "9:30 AM Opening Range Breakout (ORB)";
    case "VWAP_VOLUME":
      return "VWAP & Volume Momentum";
    case "EXPIRY_1PM_BURST":
      return "Expiry Day 1 PM Momentum Burst";
    case "OI_SHIFT_TRAP":
      return "OI Shift Trap";
    case "EMA_CROSSOVER":
      return "EMA Crossover Strategy";
    default:
      return id;
  }
}
