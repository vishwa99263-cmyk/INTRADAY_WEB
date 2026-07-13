/**
 * orbNakedEngine.ts — Isolated ORB Naked CE/PE Buying Strategy Engine
 */

import fs from "fs";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";
import { getISTTime } from "../utils/timerUtils.js";
import { savePaperTrade, closePaperTrade, getLotSize } from "./tradingEngineDB.js";
import { executeFyersOrder } from "./fyersOrderBridge.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ORBIndexState {
  high: number;
  low: number;
  rangeEstablished: boolean;
  tradedToday: boolean;
  activeTradeId: string | null;
  activeTradeStrike: number | null;
  activeTradeDirection: "BUY_CE" | "BUY_PE" | null;
  activeTradeEntryPrice: number | null;
  activeTradeQty: number | null;
  activeTradeOptionSymbol: string | null;
}

export interface ORBEngineState {
  isActive: boolean;
  targetPoints: number;
  slPoints: number;
  lotSizeMultiplier: number;
  isRealMode: boolean;
  lastUpdatedDate: string; // "YYYY-MM-DD"
  indices: Record<string, ORBIndexState>;
}

// ── Default State ──────────────────────────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), "server", "storage", "orb_naked_state.json");

const createDefaultIndexState = (): ORBIndexState => ({
  high: 0,
  low: 0,
  rangeEstablished: false,
  tradedToday: false,
  activeTradeId: null,
  activeTradeStrike: null,
  activeTradeDirection: null,
  activeTradeEntryPrice: null,
  activeTradeQty: null,
  activeTradeOptionSymbol: null,
});

let engineState: ORBEngineState = {
  isActive: true, // Force hamesha true as per user request
  targetPoints: 30,
  slPoints: 15,
  lotSizeMultiplier: 1,
  isRealMode: false,
  lastUpdatedDate: "",
  indices: {
    NIFTY: createDefaultIndexState(),
    BANKNIFTY: createDefaultIndexState(),
    SENSEX: createDefaultIndexState(),
  },
};

let _io: SocketIOServer | null = null;
let engineInterval: ReturnType<typeof setInterval> | null = null;

// ── Persistence ────────────────────────────────────────────────────────────────

function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      // Merge keys to preserve defaults if file is old
      engineState = {
        ...engineState,
        ...parsed,
        isActive: true, // Force always active
        indices: {
          ...engineState.indices,
          ...(parsed.indices || {}),
        },
      };
      console.log("[ORBEngine] Loaded state from storage");
    }
  } catch (err: any) {
    console.error("[ORBEngine] Failed to load state:", err.message);
  }
}

function saveState(): void {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(engineState, null, 2), "utf8");
  } catch (err: any) {
    console.error("[ORBEngine] Failed to save state:", err.message);
  }
}

// ── Public Accessors ───────────────────────────────────────────────────────────

export function getORBEngineState(): ORBEngineState {
  return engineState;
}

export function updateORBEngineSettings(settings: {
  isActive?: boolean;
  targetPoints?: number;
  slPoints?: number;
  lotSizeMultiplier?: number;
  isRealMode?: boolean;
}): void {
  engineState.isActive = true; // Force always active
  if (settings.targetPoints !== undefined) engineState.targetPoints = settings.targetPoints;
  if (settings.slPoints !== undefined) engineState.slPoints = settings.slPoints;
  if (settings.lotSizeMultiplier !== undefined) engineState.lotSizeMultiplier = settings.lotSizeMultiplier;
  if (settings.isRealMode !== undefined) engineState.isRealMode = settings.isRealMode;

  saveState();
  broadcastORBState();
  console.log("[ORBEngine] Settings updated:", settings);
}

function broadcastORBState(): void {
  if (_io) {
    _io.emit("orb-naked-state", engineState);
  }
}

// ── Reset Logic ────────────────────────────────────────────────────────────────

function checkAndResetDaily(todayStr: string): boolean {
  if (engineState.lastUpdatedDate !== todayStr) {
    console.log(`[ORBEngine] 🌅 New trading day detected (${todayStr}). Resetting ORB levels and traded flags.`);
    engineState.lastUpdatedDate = todayStr;
    engineState.indices = {
      NIFTY: createDefaultIndexState(),
      BANKNIFTY: createDefaultIndexState(),
      SENSEX: createDefaultIndexState(),
    };
    saveState();
    broadcastORBState();
    return true;
  }
  return false;
}

// ── Helper: Strike Selection & Chain Lookup ────────────────────────────────────

function getStrikeGap(index: string): number {
  return index === "NIFTY" ? 50 : 100;
}

function getIndexOptionChain(index: string) {
  if (index === "NIFTY") return marketState.niftyOptionChain;
  if (index === "BANKNIFTY") return marketState.bankniftyOptionChain;
  return marketState.sensexOptionChain;
}

// ── Core Engine Processing Loop ────────────────────────────────────────────────

async function processTick(): Promise<void> {
  const ist = getISTTime();
  const todayStr = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Daily reset check
  checkAndResetDaily(todayStr);

  const { totalMinutes } = ist;
  const isMarketOpen = totalMinutes >= 555 && totalMinutes <= 930; // 09:15 to 15:30 IST

  // Loop indices
  for (const indexName of ["NIFTY", "BANKNIFTY", "SENSEX"] as const) {
    const idxState = engineState.indices[indexName];
    const spotPrice = indexName === "NIFTY"
      ? marketState.niftySpot
      : (indexName === "BANKNIFTY" ? marketState.bankniftySpot : marketState.sensexSpot);

    if (spotPrice <= 0) continue;

    // ── 1. Establish Range (09:15 to 09:30 IST) ──────────────────────────────
    if (totalMinutes >= 555 && totalMinutes < 570) {
      if (idxState.high === 0 || idxState.low === 0) {
        idxState.high = spotPrice;
        idxState.low = spotPrice;
        idxState.rangeEstablished = false;
        console.log(`[ORBEngine] [${indexName}] Opening price captured: ₹${spotPrice}`);
      } else {
        idxState.high = Math.max(idxState.high, spotPrice);
        idxState.low = Math.min(idxState.low, spotPrice);
      }
      saveState();
      broadcastORBState();
    }

    // Mark range established at 09:30
    if (totalMinutes >= 570 && !idxState.rangeEstablished && idxState.high > 0) {
      idxState.rangeEstablished = true;
      saveState();
      broadcastORBState();
      console.log(`[ORBEngine] [${indexName}] Range Established. High: ₹${idxState.high.toFixed(1)}, Low: ₹${idxState.low.toFixed(1)}`);
    }

    // ── 2. Active Trade Tracking (PnL Monitoring & Exit Conditions) ──────────
    if (idxState.activeTradeId && idxState.activeTradeStrike) {
      const chain = getIndexOptionChain(indexName);
      const row = chain.strikes.find(s => s.strikePrice === idxState.activeTradeStrike);

      if (row) {
        const optionLtp = idxState.activeTradeDirection === "BUY_CE" ? row.ceLtp : row.peLtp;
        
        if (optionLtp > 0 && idxState.activeTradeEntryPrice) {
          const entryPrice = idxState.activeTradeEntryPrice;
          const targetPrice = entryPrice + engineState.targetPoints;
          const slPrice = entryPrice - engineState.slPoints;

          let shouldExit = false;
          let exitReason = "";

          if (optionLtp >= targetPrice) {
            shouldExit = true;
            exitReason = "TARGET_HIT";
          } else if (optionLtp <= slPrice) {
            shouldExit = true;
            exitReason = "STOP_LOSS_HIT";
          } else if (totalMinutes >= 925) { // 3:25 PM IST auto square-off
            shouldExit = true;
            exitReason = "3:25PM_SQUARE_OFF";
          }

          if (shouldExit) {
            const lotSize = getLotSize(indexName);
            const pnlPoints = optionLtp - entryPrice;
            const totalPnL = pnlPoints * (idxState.activeTradeQty || 1) * lotSize;

            console.log(`[ORBEngine] [${indexName}] Exit triggered: ${exitReason}. LTP: ${optionLtp}, Entry: ${entryPrice}, PnL: ${totalPnL.toFixed(1)}`);

            // 1. Close local paper trade
            closePaperTrade(idxState.activeTradeId, optionLtp, totalPnL);

            // 2. Dispatch webhook to Fyers Automate if real trading is toggled
            if (engineState.isRealMode) {
              await executeFyersOrder(
                {
                  id: idxState.activeTradeId,
                  instrument: indexName,
                  direction: idxState.activeTradeDirection!,
                  strike: idxState.activeTradeStrike!,
                  qty: idxState.activeTradeQty! * lotSize,
                  entry_price: entryPrice,
                  exit_price: optionLtp,
                },
                "EXIT"
              );
            }

            // 3. Clear active trade state
            idxState.activeTradeId = null;
            idxState.activeTradeStrike = null;
            idxState.activeTradeDirection = null;
            idxState.activeTradeEntryPrice = null;
            idxState.activeTradeQty = null;
            idxState.activeTradeOptionSymbol = null;

            saveState();
            broadcastORBState();
          }
        }
      }
    }

    // ── 3. Breakout Detection & Entry Triggers (After 09:30 IST) ─────────────
    if (
      engineState.isActive &&
      idxState.rangeEstablished &&
      !idxState.tradedToday &&
      !idxState.activeTradeId &&
      isMarketOpen &&
      totalMinutes >= 570
    ) {
      let triggerDirection: "BUY_CE" | "BUY_PE" | null = null;

      if (spotPrice > idxState.high) {
        triggerDirection = "BUY_CE";
      } else if (spotPrice < idxState.low) {
        triggerDirection = "BUY_PE";
      }

      if (triggerDirection) {
        // ATM strike calculations
        const gap = getStrikeGap(indexName);
        const atmStrike = Math.round(spotPrice / gap) * gap;
        const chain = getIndexOptionChain(indexName);
        const row = chain.strikes.find(s => s.strikePrice === atmStrike);

        if (row) {
          const optionLtp = triggerDirection === "BUY_CE" ? row.ceLtp : row.peLtp;
          const optionSymbol = triggerDirection === "BUY_CE" ? row.ceSymbol : row.peSymbol;

          if (optionLtp > 0 && optionSymbol) {
            const lotSize = getLotSize(indexName);
            const qty = engineState.lotSizeMultiplier;
            const tradeId = `orb-naked-${indexName.toLowerCase()}-${Date.now()}`;

            console.log(`[ORBEngine] [${indexName}] Breakout Entry Triggered: ${triggerDirection} @ Spot ₹${spotPrice}. ATM Strike: ${atmStrike}, Option LTP: ₹${optionLtp}`);

            // 1. Create and save paper trade payload
            const paperTrade = {
              id: tradeId,
              timestamp: Date.now(),
              instrument: indexName,
              direction: triggerDirection,
              strike: atmStrike,
              entry_price: optionLtp,
              qty,
              lot_size: lotSize,
              stop_loss: optionLtp - engineState.slPoints,
              target: optionLtp + engineState.targetPoints,
              status: "OPEN" as const,
              pnl: 0,
              notes: JSON.stringify({
                type: "ORB_NAKED",
                reason: `Opening Range Breakout (${triggerDirection})`,
                metrics: {
                  high: idxState.high,
                  low: idxState.low,
                  spot: spotPrice,
                  orbTarget: optionLtp + engineState.targetPoints,
                  orbSL: optionLtp - engineState.slPoints,
                },
              }),
            };

            savePaperTrade(paperTrade);

            // 2. Dispatch real order to Fyers Automate if enabled
            if (engineState.isRealMode) {
              await executeFyersOrder(
                {
                  id: tradeId,
                  instrument: indexName,
                  direction: triggerDirection,
                  strike: atmStrike,
                  qty: qty * lotSize,
                  entry_price: optionLtp,
                },
                "ENTRY"
              );
            }

            // 3. Update engine index state
            idxState.activeTradeId = tradeId;
            idxState.activeTradeStrike = atmStrike;
            idxState.activeTradeDirection = triggerDirection;
            idxState.activeTradeEntryPrice = optionLtp;
            idxState.activeTradeQty = qty;
            idxState.activeTradeOptionSymbol = optionSymbol;
            idxState.tradedToday = true;

            saveState();
            broadcastORBState();
          }
        }
      }
    }
  }
}

// ── Startup & Shutdown ─────────────────────────────────────────────────────────

export function initializeORBNakedEngine(io: SocketIOServer): void {
  _io = io;
  loadState();

  // Socket sync event on connection
  io.on("connection", (socket) => {
    socket.emit("orb-naked-state", engineState);

    socket.on("request-orb-state", () => {
      socket.emit("orb-naked-state", engineState);
    });
  });

  if (engineInterval) clearInterval(engineInterval);
  engineInterval = setInterval(() => {
    processTick().catch(err => {
      console.error("[ORBEngine] Error in tick loop:", err.message);
    });
  }, 1000);

  console.log("[ORBEngine] 🚀 Isolated ORB Naked Strategy Engine initialized.");
}

export function shutdownORBNakedEngine(): void {
  if (engineInterval) {
    clearInterval(engineInterval);
    engineInterval = null;
  }
  saveState();
  console.log("[ORBEngine] Isolated ORB Naked Strategy Engine shut down.");
}
