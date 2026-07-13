/**
 * fyersSocket.ts — Server-side Fyers WebSocket Manager
 *
 * Owns the single Fyers WebSocket connection.
 * Routes incoming ticks to:
 *   - Index ticks → marketState.niftySpot / sensexSpot
 *   - Option ticks → optionChainStream.updateOptionTick (O(1) indexed)
 *   - Equity ticks → stock map mutation + recalcStock
 *
 * On connect: subscribes equity symbols + index symbols + option CE/PE symbols.
 * On reconnect: restores all subscriptions automatically.
 */

import { Server as SocketIOServer } from "socket.io";
import { marketState }              from "../state/marketState.js";
import { recalcStock }              from "../utils/calculateScore.js";
import { scheduleBroadcast, scheduleNiftyOptionBroadcast, scheduleSensexOptionBroadcast, scheduleBankniftyOptionBroadcast, broadcastStatus, scheduleOptionBroadcast } from "./socketBroadcast.js";
import { updateOptionTick, getOptionSymbols, saveLatestSnapshot } from "./optionChainStream.js";
import { onSpotTick } from "./chartEngine.js";
import { feedIndexTick } from "./chartRealtime.js";
import { recordTick } from "./marketRecorder.js";
import { calculateHeavyweightContribution } from "./heavyweightEngine.js";
import fyersSDK from "fyers-api-v3";

let activeSocket: any = null;

// ── Symbol collection & clean validation ──────────────────────────────────────

/** Cleans, trims, removes duplicates and filters malformed strings (like undefined/null) */
export function getCleanSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map(s => String(s || "").trim())
        .filter(s => s !== "" && !s.includes("undefined") && !s.includes("null") && s.includes(":"))
    )
  );
}

/** Helper to partition an array into chunked batches */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Collects core equity and index symbols for subscription */
export function getCoreSymbols(): string[] {
  const set = new Set<string>();
  Object.values(marketState.niftyStocks).forEach(s  => s.ticker && set.add(s.ticker));
  Object.values(marketState.sensexStocks).forEach(s => s.ticker && set.add(s.ticker));
  Object.values(marketState.bankniftyStocks).forEach(s => s.ticker && set.add(s.ticker));
  set.add("NSE:NIFTY50-INDEX");
  set.add("BSE:SENSEX-INDEX");
  set.add("NSE:NIFTYBANK-INDEX");
  set.add("NSE:INDIAVIX-INDEX");
  if (marketState.customStockSymbol) {
    set.add(`NSE:${marketState.customStockSymbol.toUpperCase()}-EQ`);
  }
  return Array.from(set);
}

/** All symbols combined (used primarily for logging) */
export function getSubscriptionSymbols(): string[] {
  const core = getCoreSymbols();
  const opts = getOptionSymbols();
  return getCleanSymbols([...core, ...opts]);
}

/**
 * Re-subscribe option CE/PE symbols after a new chain is loaded dynamically.
 * Called from optionChainStream after fetchInitialChain processes data.
 */
export function resubscribeOptionSymbols(): void {
  if (!activeSocket || marketState.connectionStatus !== "LIVE") return;
  const syms = getCleanSymbols(getOptionSymbols());
  if (syms.length === 0) {
    console.log("[FyersSocket] No active option symbols to dynamically subscribe.");
    return;
  }

  console.log(`[FyersSocket] [Re-sub] Subscribing ${syms.length} option symbols in FullMode`);
  console.log("[FyersSocket] First 10 option symbols:", syms.slice(0, 10));
  try {
    // Fyers SDK: subscribe(symbols[]) — no channel param
    activeSocket.subscribe(syms);
    // Set FullMode for all subscribed symbols (no channel param)
    activeSocket.mode(activeSocket.FullMode);
    console.log(`[FyersSocket] ✅ Dynamic option chain re-subscribed successfully (${syms.length} symbols).`);
  } catch (err) {
    console.error("[FyersSocket] ❌ Dynamic option re-subscription failed:", err);
  }
}

// ── Tick handler ──────────────────────────────────────────────────────────────

let _rawTickDebugCount = 0;

function handleTick(msg: any, io: SocketIOServer): void {
  if (!msg || !msg.symbol) return;
  const { symbol, ltp } = msg;

  // ── Debug: log first 5 raw ticks so we can verify field names ───────────
  if (_rawTickDebugCount < 5) {
    _rawTickDebugCount++;
    console.log(`[FyersSocket] RAW TICK #${_rawTickDebugCount}:`, JSON.stringify(msg));
  }

  // ── 1. Index ticks ──────────────────────────────────────────────────────
  if (symbol === "NSE:NIFTY50-INDEX") {
    if (typeof ltp === "number" && ltp > 0) {
      marketState.niftySpot = ltp;
      if (ltp > marketState.niftyHistory.high) marketState.niftyHistory.high = ltp;
      if (marketState.niftyHistory.low === 0 || ltp < marketState.niftyHistory.low)
        marketState.niftyHistory.low = ltp;
      // Also update option chain spot price if chain is loaded
      if (marketState.niftyOptionChain.strikes.length > 0) {
        marketState.niftyOptionChain.spotPrice = ltp;
        if (msg.ch !== undefined)  marketState.niftyOptionChain.spotChange = msg.ch;
        if (msg.chp !== undefined) marketState.niftyOptionChain.spotChangePct = msg.chp;
        scheduleNiftyOptionBroadcast(io);
      }
      
      // Also update the index row inside niftyStocks if it exists
      const idxStock = marketState.niftyStocks["NIFTY 50"];
      if (idxStock) {
        idxStock.ltp = ltp;
        idxStock.high = msg.high_price ?? (idxStock.high || ltp);
        idxStock.low = msg.low_price ?? (idxStock.low || ltp);
        idxStock.open = msg.open_price ?? (idxStock.open || ltp);
        idxStock.prevClose = msg.prev_close ?? msg.prev_close_price ?? idxStock.prevClose;
        idxStock.change = msg.ch ?? idxStock.change;
        idxStock.volume = msg.vol_traded_today ?? msg.volume ?? idxStock.volume;
        idxStock.lastTradedTime = msg.last_traded_time ?? idxStock.lastTradedTime;
        let chp = msg.chp;
        if (chp == null || isNaN(chp))
          chp = idxStock.prevClose > 0 ? ((ltp - idxStock.prevClose) / idxStock.prevClose) * 100 : 0;
        idxStock.changePercent = parseFloat(chp.toFixed(2));
        recalcStock(idxStock);
      }

      // Feed chart engine with spot tick
      onSpotTick(symbol, ltp, msg.vol_traded_today ?? msg.volume ?? 0);
      // Feed dedicated NIFTY chart realtime engine
      feedIndexTick("NIFTY", ltp, msg.vol_traded_today ?? msg.volume ?? 0);

      // Record Nifty spot ticks to raw_ticks partitioned hypertable
      recordTick(
        "NSE:NIFTY50-INDEX",
        ltp,
        msg.vol_traded_today ?? msg.volume ?? 0,
        msg.bid ?? 0,
        msg.ask ?? 0,
        msg.bid_qty ?? 0,
        msg.ask_qty ?? 0,
        msg.oi ?? 0,
        msg.vwap ?? 0
      );
    }
    scheduleBroadcast(io);
    return;
  }
  if (symbol === "BSE:SENSEX-INDEX") {
    if (typeof ltp === "number" && ltp > 0) {
      marketState.sensexSpot = ltp;
      if (ltp > marketState.sensexHistory.high) marketState.sensexHistory.high = ltp;
      if (marketState.sensexHistory.low === 0 || ltp < marketState.sensexHistory.low)
        marketState.sensexHistory.low = ltp;
      // Also update option chain spot price if chain is loaded
      if (marketState.sensexOptionChain.strikes.length > 0) {
        marketState.sensexOptionChain.spotPrice = ltp;
        if (msg.ch !== undefined)  marketState.sensexOptionChain.spotChange = msg.ch;
        if (msg.chp !== undefined) marketState.sensexOptionChain.spotChangePct = msg.chp;
        scheduleSensexOptionBroadcast(io);
      }
      
      // Also update the index row inside sensexStocks if it exists
      const idxStock = marketState.sensexStocks["SENSEX"];
      if (idxStock) {
        idxStock.ltp = ltp;
        idxStock.high = msg.high_price ?? (idxStock.high || ltp);
        idxStock.low = msg.low_price ?? (idxStock.low || ltp);
        idxStock.open = msg.open_price ?? (idxStock.open || ltp);
        idxStock.prevClose = msg.prev_close ?? msg.prev_close_price ?? idxStock.prevClose;
        idxStock.change = msg.ch ?? idxStock.change;
        idxStock.volume = msg.vol_traded_today ?? msg.volume ?? idxStock.volume;
        idxStock.lastTradedTime = msg.last_traded_time ?? idxStock.lastTradedTime;
        let chp = msg.chp;
        if (chp == null || isNaN(chp))
          chp = idxStock.prevClose > 0 ? ((ltp - idxStock.prevClose) / idxStock.prevClose) * 100 : 0;
        idxStock.changePercent = parseFloat(chp.toFixed(2));
        recalcStock(idxStock);
      }

      // Feed chart engine with Sensex spot tick
      onSpotTick(symbol, ltp, msg.vol_traded_today ?? msg.volume ?? 0);
      // Feed dedicated SENSEX chart realtime engine
      feedIndexTick("SENSEX", ltp, msg.vol_traded_today ?? msg.volume ?? 0);

      // Record Sensex spot ticks to raw_ticks partitioned hypertable
      recordTick(
        "BSE:SENSEX-INDEX",
        ltp,
        msg.vol_traded_today ?? msg.volume ?? 0,
        msg.bid ?? 0,
        msg.ask ?? 0,
        msg.bid_qty ?? 0,
        msg.ask_qty ?? 0,
        msg.oi ?? 0,
        msg.vwap ?? 0
      );
    }
    scheduleBroadcast(io);
    return;
  }
  if (symbol === "NSE:NIFTYBANK-INDEX") {
    if (typeof ltp === "number" && ltp > 0) {
      marketState.bankniftySpot = ltp;
      if (ltp > marketState.bankniftyHistory.high) marketState.bankniftyHistory.high = ltp;
      if (marketState.bankniftyHistory.low === 0 || ltp < marketState.bankniftyHistory.low)
        marketState.bankniftyHistory.low = ltp;
      // Also update option chain spot price if chain is loaded
      if (marketState.bankniftyOptionChain.strikes.length > 0) {
        marketState.bankniftyOptionChain.spotPrice = ltp;
        if (msg.ch !== undefined)  marketState.bankniftyOptionChain.spotChange = msg.ch;
        if (msg.chp !== undefined) marketState.bankniftyOptionChain.spotChangePct = msg.chp;
        scheduleBankniftyOptionBroadcast(io);
      }
      
      // Also update the index row inside bankniftyStocks if it exists
      const idxStock = marketState.bankniftyStocks["NIFTY BANK"];
      if (idxStock) {
        idxStock.ltp = ltp;
        idxStock.high = msg.high_price ?? (idxStock.high || ltp);
        idxStock.low = msg.low_price ?? (idxStock.low || ltp);
        idxStock.open = msg.open_price ?? (idxStock.open || ltp);
        idxStock.prevClose = msg.prev_close ?? msg.prev_close_price ?? idxStock.prevClose;
        idxStock.change = msg.ch ?? idxStock.change;
        idxStock.volume = msg.vol_traded_today ?? msg.volume ?? idxStock.volume;
        idxStock.lastTradedTime = msg.last_traded_time ?? idxStock.lastTradedTime;
        let chp = msg.chp;
        if (chp == null || isNaN(chp))
          chp = idxStock.prevClose > 0 ? ((ltp - idxStock.prevClose) / idxStock.prevClose) * 100 : 0;
        idxStock.changePercent = parseFloat(chp.toFixed(2));
        recalcStock(idxStock);
      }

      // Feed chart engine with spot tick
      onSpotTick(symbol, ltp, msg.vol_traded_today ?? msg.volume ?? 0);
      // Feed dedicated BANKNIFTY chart realtime engine
      feedIndexTick("BANKNIFTY", ltp, msg.vol_traded_today ?? msg.volume ?? 0);

      // Record Bank Nifty spot ticks to raw_ticks partitioned hypertable
      recordTick(
        "NSE:NIFTYBANK-INDEX",
        ltp,
        msg.vol_traded_today ?? msg.volume ?? 0,
        msg.bid ?? 0,
        msg.ask ?? 0,
        msg.bid_qty ?? 0,
        msg.ask_qty ?? 0,
        msg.oi ?? 0,
        msg.vwap ?? 0
      );
    }
    scheduleBroadcast(io);
    return;
  }
  if (symbol === "NSE:INDIAVIX-INDEX") {
    if (typeof ltp === "number" && ltp > 0) {
      marketState.niftyOptionChain.indiaVix = ltp;
      marketState.sensexOptionChain.indiaVix = ltp;
      marketState.bankniftyOptionChain.indiaVix = ltp;
      scheduleNiftyOptionBroadcast(io);
      scheduleSensexOptionBroadcast(io);
      scheduleBankniftyOptionBroadcast(io);
    }
    scheduleBroadcast(io);
    return;
  }

  // ── 2. Option chain ticks (CE/PE) — O(1) indexed lookup ─────────────────
  if (updateOptionTick(msg, io)) return;

  // ── 3. Equity stock ticks ───────────────────────────────────────────────
  if (symbol === "NSE:HDFCBANK-EQ") {
    marketState.hdfcbankOptionChain.spotPrice = ltp;
    if (msg.ch !== undefined)  marketState.hdfcbankOptionChain.spotChange = msg.ch;
    if (msg.chp !== undefined) marketState.hdfcbankOptionChain.spotChangePct = msg.chp;
    scheduleOptionBroadcast(io, "HDFCBANK");
  } else if (symbol === "NSE:RELIANCE-EQ") {
    marketState.relianceOptionChain.spotPrice = ltp;
    if (msg.ch !== undefined)  marketState.relianceOptionChain.spotChange = msg.ch;
    if (msg.chp !== undefined) marketState.relianceOptionChain.spotChangePct = msg.chp;
    scheduleOptionBroadcast(io, "RELIANCE");
  } else if (symbol === "NSE:ICICIBANK-EQ") {
    marketState.icicibankOptionChain.spotPrice = ltp;
    if (msg.ch !== undefined)  marketState.icicibankOptionChain.spotChange = msg.ch;
    if (msg.chp !== undefined) marketState.icicibankOptionChain.spotChangePct = msg.chp;
    scheduleOptionBroadcast(io, "ICICIBANK");
  } else if (marketState.customStockSymbol && symbol === `NSE:${marketState.customStockSymbol.toUpperCase()}-EQ`) {
    marketState.customStockOptionChain.spotPrice = ltp;
    if (msg.ch !== undefined)  marketState.customStockOptionChain.spotChange = msg.ch;
    if (msg.chp !== undefined) marketState.customStockOptionChain.spotChangePct = msg.chp;
    scheduleOptionBroadcast(io, "CUSTOM_STOCK");
  }

  let tickRecorded = false;
  const tryUpdate = (map: Record<string, any>, index: "NIFTY" | "SENSEX" | "BANKNIFTY"): boolean => {
    const isNifty = index === "NIFTY";
    const isBanknifty = index === "BANKNIFTY";
    const spot = isNifty ? marketState.niftySpot : (isBanknifty ? marketState.bankniftySpot : marketState.sensexSpot);
    for (const stock of Object.values(map)) {
      if ((stock as any).ticker !== symbol) continue;
      if (typeof ltp !== "number" || ltp <= 0) break;
      stock.ltp            = ltp;
      stock.prevClose      = msg.prev_close ?? msg.prev_close_price ?? stock.prevClose;
      stock.high           = msg.high_price  ?? stock.high;
      stock.low            = msg.low_price   ?? stock.low;
      stock.open           = msg.open_price  ?? stock.open;
      stock.change         = msg.ch          ?? stock.change;
      stock.volume         = msg.vol_traded_today ?? msg.volume ?? stock.volume;
      stock.lastTradedTime = msg.last_traded_time ?? stock.lastTradedTime;
      let chp = msg.chp;
      if (chp == null || isNaN(chp))
        chp = stock.prevClose > 0 ? ((ltp - stock.prevClose) / stock.prevClose) * 100 : 0;
      stock.changePercent = parseFloat(chp.toFixed(2));
      recalcStock(stock);

      // Record tick to database spooled queue (only once per stock tick message)
      if (!tickRecorded) {
        recordTick(
          symbol,
          ltp,
          msg.vol_traded_today ?? msg.volume ?? 0,
          msg.bid ?? 0,
          msg.ask ?? 0,
          msg.bid_qty ?? 0,
          msg.ask_qty ?? 0,
          msg.oi ?? 0,
          msg.vwap ?? 0
        );
        tickRecorded = true;
      }

      // Recalculate Heavyweights on stock update and spool to DB
      calculateHeavyweightContribution(
        index,
        stock.symbol,
        ltp,
        stock.prevClose,
        spot
      );

      return true;
    }
    return false;
  };

  const niftyUpdated = tryUpdate(marketState.niftyStocks, "NIFTY");
  const bankniftyUpdated = tryUpdate(marketState.bankniftyStocks, "BANKNIFTY");
  const sensexUpdated = tryUpdate(marketState.sensexStocks, "SENSEX");
  if (niftyUpdated || bankniftyUpdated || sensexUpdated)
    scheduleBroadcast(io);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startFyersSocket(token: string, io: SocketIOServer): void {
  stopFyersSocket(); // close any existing connection cleanly

  if (!fyersSDK || !token) {
    marketState.connectionStatus = "DISCONNECTED";
    marketState.fyersAuthorized  = false;
    broadcastStatus(io);
    return;
  }

  marketState.connectionStatus = "RECONNECTING";
  broadcastStatus(io);

  try {
    let socketToken = token;
    if (!socketToken.includes(":")) {
      socketToken = `${marketState.fyersConfig.app_id}:${token}`;
    }
    const skt = fyersSDK.fyersDataSocket.getInstance(socketToken);
    activeSocket = skt;

    skt.on("connect", () => {
      console.log("[FyersSocket] 🟢 Connected to Fyers WebSocket");
      marketState.connectionStatus = "LIVE";
      marketState.fyersAuthorized  = true;
      marketState.isSimulating     = false;
      marketState.lastFyersError   = "";

      // Mark option chains as live
      marketState.niftyOptionChain.isLive = true;
      marketState.sensexOptionChain.isLive = true;

      // ── Step 1: Subscribe all core symbols (equity + indices) ──────────
      const coreSymbols = getCleanSymbols(getCoreSymbols());
      console.log(`[FyersSocket] Subscribing ${coreSymbols.length} core symbols (equities + indices):`, coreSymbols);
      try {
        // Fyers SDK subscribe(): accepts string[] — no channel param
        skt.subscribe(coreSymbols);
        skt.mode(skt.FullMode);
        console.log("[FyersSocket] ✅ Core symbols subscribed in FullMode");
      } catch (err) {
        console.error("[FyersSocket] ❌ Core symbol subscription error:", err);
      }

      // ── Step 2: Subscribe option CE/PE symbols (if chain is loaded) ────
      const optionSymbols = getCleanSymbols(getOptionSymbols());
      if (optionSymbols.length > 0) {
        console.log(`[FyersSocket] Subscribing ${optionSymbols.length} option symbols (CE+PE)`);
        console.log("[FyersSocket] First 10 option symbols:", optionSymbols.slice(0, 10));
        try {
          skt.subscribe(optionSymbols);
          // mode() sets FullMode globally for all subscribed symbols
          skt.mode(skt.FullMode);
          console.log(`[FyersSocket] ✅ Option symbols subscribed successfully (${optionSymbols.length} symbols).`);
        } catch (err) {
          console.error("[FyersSocket] ❌ Option subscription error:", err);
        }
      } else {
        console.log("[FyersSocket] No option symbols yet — will subscribe after REST chain loads via resubscribeOptionSymbols()");
      }

      broadcastStatus(io);
    });

    skt.on("message", (msg: any) => handleTick(msg, io));

    skt.on("error", (err: any) => {
      const errMsg = typeof err === "string" ? err : err?.message ?? "WebSocket error";
      console.error("[FyersSocket] Error:", errMsg);
      const isExpiry = /expired|unauthorized|token/i.test(errMsg);
      marketState.connectionStatus = isExpiry ? "EXPIRED" : "DISCONNECTED";
      marketState.fyersAuthorized  = false;
      marketState.lastFyersError   = errMsg;

      // DO NOT clear option chain — preserve last snapshot
      marketState.niftyOptionChain.isLive = false;
      marketState.sensexOptionChain.isLive = false;

      // Save whatever we have before going offline
      saveLatestSnapshot();

      broadcastStatus(io);
    });

    skt.on("close", () => {
      console.log("[FyersSocket] Connection closed");
      if (marketState.connectionStatus === "LIVE") {
        marketState.connectionStatus   = "RECONNECTING";
        marketState.niftyOptionChain.isLive = false;
        marketState.sensexOptionChain.isLive = false;

        // Save current state as snapshot
        saveLatestSnapshot();

        broadcastStatus(io);
      }
    });

    skt.connect();
    skt.autoreconnect(10); // up to 10 reconnect attempts with back-off
    console.log("[FyersSocket] Socket initialised — awaiting connection...");
  } catch (err: any) {
    console.error("[FyersSocket] Init failed:", err.message);
    marketState.connectionStatus = "DISCONNECTED";
    marketState.fyersAuthorized  = false;
    marketState.lastFyersError   = err.message;
    broadcastStatus(io);
  }
}

export function stopFyersSocket(): void {
  if (activeSocket) {
    // Save snapshot before closing
    saveLatestSnapshot();
    try { activeSocket.close(); } catch (_) {}
    activeSocket = null;
  }
  marketState.connectionStatus   = "DISCONNECTED";
  marketState.fyersAuthorized    = false;
  marketState.niftyOptionChain.isLive = false;
  marketState.sensexOptionChain.isLive = false;
}
