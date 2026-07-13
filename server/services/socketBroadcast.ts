import { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";
import { calcWeightedSummary } from "../utils/weightedSummary.js";
import { runStrategyEngine } from "./strategyEngine.js";
import { estimateMarketDirection } from "./marketDirectionEngine.js";
import { processTick as mlProcessTick, type MarketContext as MLMarketContext } from "./multiStrategyRunner.js";

// Decoupled throttle durations
const THROTTLE_MARKET_MS = 40;     // 25 updates per second for stocks and spots
const THROTTLE_OPTION_MS = 50;     // 20 updates per second for option chains

// Timers for each decoupled stream
let _pendingMarket: ReturnType<typeof setTimeout> | null = null;
let _pendingOptionTimers: Record<string, ReturnType<typeof setTimeout> | null> = {};

// Track whether AI engine is throttled to save SQLite database CPU write queue
let _pendingNiftyAI: boolean = false;
let _pendingSensexAI: boolean = false;
let _pendingBankniftyAI: boolean = false;

/**
 * Schedules a live market update broadcast (stocks, spots, summaries).
 * Collapses multiple rapid calls within THROTTLE_MARKET_MS.
 */
export function scheduleBroadcast(io: SocketIOServer): void {
  if (_pendingMarket) return;
  _pendingMarket = setTimeout(() => {
    _pendingMarket = null;
    broadcastLive(io);
  }, THROTTLE_MARKET_MS);
}

/**
 * Generic scheduler for Option Chain updates.
 */
export function scheduleOptionBroadcast(io: SocketIOServer, index: string): void {
  if (_pendingOptionTimers[index]) return;
  _pendingOptionTimers[index] = setTimeout(() => {
    _pendingOptionTimers[index] = null;
    broadcastOptionChain(io, index);
  }, THROTTLE_OPTION_MS);
}

export function scheduleNiftyOptionBroadcast(io: SocketIOServer): void {
  scheduleOptionBroadcast(io, "NIFTY");
}

export function scheduleSensexOptionBroadcast(io: SocketIOServer): void {
  scheduleOptionBroadcast(io, "SENSEX");
}

export function scheduleBankniftyOptionBroadcast(io: SocketIOServer): void {
  scheduleOptionBroadcast(io, "BANKNIFTY");
}

/** 
 * Immediately push the full, complete market state snapshot (including backups and option chains)
 * to all clients. Used on initial connection or manual structural changes.
 */
export function broadcastAll(io: SocketIOServer): void {
  const niftyArr      = Object.values(marketState.niftyStocks);
  const sensexArr     = Object.values(marketState.sensexStocks);
  const bankniftyArr  = Object.values(marketState.bankniftyStocks);

  // Emit full snapshot FIRST (non-blocking)
  io.emit("market-update", {
    niftyStocks:       niftyArr,
    sensexStocks:      sensexArr,
    bankniftyStocks:   bankniftyArr,
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
    niftyOptionChain:  marketState.niftyOptionChain,
    sensexOptionChain: marketState.sensexOptionChain,
    bankniftyOptionChain: marketState.bankniftyOptionChain,
    optionChain:       marketState.niftyOptionChain, // legacy fallback
    connectionStatus:  marketState.connectionStatus,
    alerts:            marketState.alerts,
    triggeredAlerts:   marketState.triggeredAlerts,
    serverTime:        Date.now(),
    isSimulating:      marketState.isSimulating,
    fyersAuthorized:   marketState.fyersAuthorized,
    fyersConfig: {
      app_id:       marketState.fyersConfig.app_id,
      redirect_uri: marketState.fyersConfig.redirect_uri,
      access_token: marketState.fyersConfig.access_token,
    },
    lastFyersError: marketState.lastFyersError,
    niftySummary:   calcWeightedSummary(niftyArr),
    sensexSummary:  calcWeightedSummary(sensexArr),
    bankniftySummary: calcWeightedSummary(bankniftyArr),
    niftyMarketDir: estimateMarketDirection("NIFTY"),
    sensexMarketDir: estimateMarketDirection("SENSEX"),
    bankniftyMarketDir: estimateMarketDirection("BANKNIFTY"),
  });

  // Also broadcast individual option chains so the client option state populates immediately
  io.emit("option-chain-update", { index: "NIFTY", chain: marketState.niftyOptionChain });
  io.emit("option-chain-update", { index: "SENSEX", chain: marketState.sensexOptionChain });
  io.emit("option-chain-update", { index: "BANKNIFTY", chain: marketState.bankniftyOptionChain });
  io.emit("option-chain-update", { index: "HDFCBANK", chain: marketState.hdfcbankOptionChain });
  io.emit("option-chain-update", { index: "RELIANCE", chain: marketState.relianceOptionChain });
  io.emit("option-chain-update", { index: "ICICIBANK", chain: marketState.icicibankOptionChain });
  io.emit("option-chain-update", { index: "CUSTOM_STOCK", chain: marketState.customStockOptionChain });

  // Run AI strategies asynchronously
  runStrategyEngine("NIFTY", io).catch(() => {});
  runStrategyEngine("SENSEX", io).catch(() => {});
  runStrategyEngine("BANKNIFTY", io).catch(() => {});
}

/** 
 * Pushes live real-time market updates ONLY.
 * Decoupled from heavy option chains to keep Socket.IO payload extremely lightweight.
 */
export function broadcastLive(io: SocketIOServer): void {
  const niftyArr      = Object.values(marketState.niftyStocks);
  const sensexArr     = Object.values(marketState.sensexStocks);
  const bankniftyArr  = Object.values(marketState.bankniftyStocks);

  // Emit lightweight market update (NO massive option chains included!)
  io.emit("market-update", {
    niftyStocks:       niftyArr,
    sensexStocks:      sensexArr,
    bankniftyStocks:   bankniftyArr,
    niftySpot:         marketState.niftySpot,
    sensexSpot:        marketState.sensexSpot,
    bankniftySpot:     marketState.bankniftySpot,
    niftyHistory:      marketState.niftyHistory,
    sensexHistory:     marketState.sensexHistory,
    bankniftyHistory:  marketState.bankniftyHistory,
    connectionStatus:  marketState.connectionStatus,
    serverTime:        Date.now(),
    isSimulating:      marketState.isSimulating,
    fyersAuthorized:   marketState.fyersAuthorized,
    fyersConfig: {
      app_id:       marketState.fyersConfig.app_id,
      redirect_uri: marketState.fyersConfig.redirect_uri,
      access_token: marketState.fyersConfig.access_token,
    },
    lastFyersError: marketState.lastFyersError,
    niftySummary:   calcWeightedSummary(niftyArr),
    sensexSummary:  calcWeightedSummary(sensexArr),
    bankniftySummary: calcWeightedSummary(bankniftyArr),
    niftyMarketDir: estimateMarketDirection("NIFTY"),
    sensexMarketDir: estimateMarketDirection("SENSEX"),
    bankniftyMarketDir: estimateMarketDirection("BANKNIFTY"),
  });

  // Run AI strategies on a fire-and-forget basis, throttled to 10hz to save SQL CPU
  if (!_pendingNiftyAI) {
    _pendingNiftyAI = true;
    setTimeout(() => {
      _pendingNiftyAI = false;
      runStrategyEngine("NIFTY", io).catch(() => {});
    }, 100);
  }

  if (!_pendingSensexAI) {
    _pendingSensexAI = true;
    setTimeout(() => {
      _pendingSensexAI = false;
      runStrategyEngine("SENSEX", io).catch(() => {});
    }, 100);
  }

  if (!_pendingBankniftyAI) {
    _pendingBankniftyAI = true;
    setTimeout(() => {
      _pendingBankniftyAI = false;
      runStrategyEngine("BANKNIFTY", io).catch(() => {});
    }, 100);
  }

  // ── AMEX ML: Multi-Strategy Runner — har tick par sabhi strategies check karo ──
  // Nifty net score = sum of all positive stocks - sum of all negative stocks
  const niftyScoreNet = niftyArr.reduce((acc, s: any) => acc + (s.score ?? 0), 0);
  const bnScoreNet    = bankniftyArr.reduce((acc, s: any) => acc + (s.score ?? 0), 0);
  const sxScoreNet    = sensexArr.reduce((acc, s: any) => acc + (s.score ?? 0), 0);

  try {
    const mlCtx: MLMarketContext = {
      serverTime:     Date.now(),
      niftySpot:      marketState.niftySpot     ?? 0,
      bankniftySpot:  marketState.bankniftySpot ?? 0,
      sensexSpot:     marketState.sensexSpot    ?? 0,
      niftyScore:     niftyScoreNet,
      bankniftyScore: bnScoreNet,
      sensexScore:    sxScoreNet,
      niftyPCR:       (marketState.niftyOptionChain as any)?.summary?.pcr ?? 1.0,
      bankniftyPCR:   (marketState.bankniftyOptionChain as any)?.summary?.pcr ?? 1.0,
      marketRegime:   String(estimateMarketDirection("NIFTY") ?? "RANGE"),
      aiConfidence:   (marketState as any).aiAnalysis?.confidence ?? 55,
    };
    mlProcessTick(mlCtx);
  } catch (_) {}
}

/**
 * Broadcasts option chain updates for the specified index.
 * Throttled separately to avoid clogging Socket.IO.
 */
export function broadcastOptionChain(io: SocketIOServer, index: string): void {
  let chainState: any = null;
  if (index === "NIFTY") chainState = marketState.niftyOptionChain;
  else if (index === "BANKNIFTY") chainState = marketState.bankniftyOptionChain;
  else if (index === "SENSEX") chainState = marketState.sensexOptionChain;
  else if (index === "HDFCBANK") chainState = marketState.hdfcbankOptionChain;
  else if (index === "RELIANCE") chainState = marketState.relianceOptionChain;
  else if (index === "ICICIBANK") chainState = marketState.icicibankOptionChain;
  else if (index === "CUSTOM_STOCK") chainState = marketState.customStockOptionChain;

  if (chainState) {
    io.emit("option-chain-update", { index, chain: chainState });
  }
}

/** Lightweight status-only emit for connection state changes */
export function broadcastStatus(io: SocketIOServer): void {
  io.emit("connection-status", {
    connectionStatus: marketState.connectionStatus,
    fyersAuthorized:  marketState.fyersAuthorized,
    lastFyersError:   marketState.lastFyersError,
    serverTime:       Date.now(),
  });
}
