/**
 * jarvisRoutes.ts — Clean Modular Express Router for JARVIS AI Engine & FYERS Real Trading
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this router into any Express app:
 *   import { jarvisRouter } from "./server/routes/jarvisRoutes.js";
 *   app.use("/api", jarvisRouter);
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import { marketState } from "../state/marketState.js";
import {
  evaluateJarvisScalper,
  getScalperEngineState,
  getScalperEngineStateAsync,
  updateScalperSettings,
  triggerJarvisScalpEntry,
  resetCapital,
  clearJarvisHistory,
  getCapitalState,
  forceExitTrade,
} from "../services/jarvisScalperEngine.js";
import {
  getFunds,
  getPositions,
  getOrders,
  getTradebook,
  placeOrder,
  cancelOrder,
} from "../services/fyersTradeService.js";
import { startFyersSocket } from "../services/fyersSocket.js";

export const jarvisRouter = Router();

// ── JARVIS Micro-Scalper State & Control Routes ────────────────────────────────
jarvisRouter.get("/jarvis/scalper/state", async (req, res) => {
  try {
    const data = await getScalperEngineStateAsync();
    res.json({ s: "ok", data });
  } catch (err: any) {
    res.json({ s: "ok", data: getScalperEngineState() });
  }
});

jarvisRouter.post("/jarvis/scalper/toggle", (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  const settings = updateScalperSettings({ enabled });
  res.json({ s: "ok", settings });
});

jarvisRouter.post("/jarvis/scalper/settings", (req, res) => {
  const { targetProfitGoal, maxDailyScalps } = req.body as { targetProfitGoal?: number; maxDailyScalps?: number };
  const settings = updateScalperSettings({
    ...(targetProfitGoal !== undefined ? { targetProfitGoal } : {}),
    ...(maxDailyScalps !== undefined ? { maxDailyScalps } : {}),
  });
  res.json({ s: "ok", settings });
});

jarvisRouter.post("/jarvis/scalper/trigger-test", (req, res) => {
  const { instrument = "NIFTY", direction = "BUY_CE" } = req.body as { instrument?: "NIFTY" | "BANKNIFTY" | "SENSEX"; direction?: "BUY_CE" | "BUY_PE" };
  const spot = instrument === "NIFTY" ? (marketState.niftySpot || 24500)
    : instrument === "BANKNIFTY" ? (marketState.bankniftySpot || 52500)
    : (marketState.sensexSpot || 80500);

  triggerJarvisScalpEntry(instrument, direction, spot, 25.5, 30.0, 35, 15, (req as any).io);
  res.json({ s: "ok", message: `Test ${instrument} ${direction} scalp triggered successfully!` });
});

jarvisRouter.post("/jarvis/scalper/force-exit/:tradeId", (req, res) => {
  const { tradeId } = req.params;
  const success = forceExitTrade(tradeId, (req as any).io);
  if (success) {
    res.json({ s: "ok", message: `Trade ${tradeId} manually exited successfully.` });
  } else {
    res.status(404).json({ s: "error", message: `Trade ${tradeId} not found or already closed.` });
  }
});

jarvisRouter.post("/jarvis/scalper/clear-history", (req, res) => {
  clearJarvisHistory();
  res.json({ s: "ok", message: "All scalp trades and order history cleared to 00", state: getScalperEngineState() });
});

jarvisRouter.post("/jarvis/capital/reset", (req, res) => {
  resetCapital();
  res.json({ s: "ok", message: "Capital reset to ₹1,50,000", capital: getCapitalState() });
});

jarvisRouter.get("/jarvis/capital", (req, res) => {
  res.json({ s: "ok", capital: getCapitalState() });
});

// ── FYERS Direct API Gateway Routes ───────────────────────────────────────────
jarvisRouter.get("/fyers/funds", async (req, res) => {
  if (!marketState.fyersAuthorized && !marketState.fyersConfig.access_token) {
    return res.status(401).json({ error: "Fyers not connected" });
  }
  try {
    const data = await getFunds();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

jarvisRouter.get("/fyers/positions", async (req, res) => {
  if (!marketState.fyersAuthorized && !marketState.fyersConfig.access_token) {
    return res.status(401).json({ error: "Fyers not connected" });
  }
  try {
    const data = await getPositions();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

jarvisRouter.get("/fyers/orders", async (req, res) => {
  if (!marketState.fyersAuthorized && !marketState.fyersConfig.access_token) {
    return res.status(401).json({ error: "Fyers not connected" });
  }
  try {
    const data = await getOrders();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

jarvisRouter.get("/fyers/tradebook", async (req, res) => {
  if (!marketState.fyersAuthorized && !marketState.fyersConfig.access_token) {
    return res.status(401).json({ error: "Fyers not connected" });
  }
  try {
    const data = await getTradebook();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

jarvisRouter.get("/fyers/config", (req, res) => {
  res.json({
    fyersConfig: {
      app_id: marketState.fyersConfig.app_id,
      redirect_uri: marketState.fyersConfig.redirect_uri,
    },
    fyersAuthorized: marketState.fyersAuthorized,
    isSimulating: marketState.isSimulating,
    lastFyersError: marketState.lastFyersError,
  });
});

jarvisRouter.post("/fyers/config", async (req, res) => {
  const { app_id, secret_key, redirect_uri, access_token } = req.body;
  if (app_id !== undefined) marketState.fyersConfig.app_id = app_id;
  if (secret_key !== undefined) marketState.fyersConfig.secret_key = secret_key;
  if (redirect_uri !== undefined) marketState.fyersConfig.redirect_uri = redirect_uri;
  if (access_token !== undefined) marketState.fyersConfig.access_token = access_token;

  if (access_token) {
    marketState.isSimulating = false;
    marketState.fyersAuthorized = true;
    startFyersSocket(access_token, (req as any).io);
  }

  try {
    fs.writeFileSync(
      path.join(process.cwd(), "fyers_config.json"),
      JSON.stringify(marketState.fyersConfig, null, 2),
      "utf8"
    );
  } catch (e: any) {
    console.error("[JarvisRoutes] Failed to save fyers_config.json:", e.message);
  }

  res.json({
    success: true,
    fyersAuthorized: marketState.fyersAuthorized,
    isSimulating: marketState.isSimulating,
    lastFyersError: marketState.lastFyersError,
  });
});

jarvisRouter.get("/fyers/login-url", (req, res) => {
  try {
    const configFile = path.join(process.cwd(), "fyers_config.json");
    if (fs.existsSync(configFile)) {
      const configData = JSON.parse(fs.readFileSync(configFile, "utf8"));
      if (configData.app_id) marketState.fyersConfig.app_id = configData.app_id;
      if (configData.secret_key) marketState.fyersConfig.secret_key = configData.secret_key;
      if (configData.redirect_uri) marketState.fyersConfig.redirect_uri = configData.redirect_uri;
    }
  } catch (e: any) {
    console.error("[JarvisRoutes] Reload config error:", e.message);
  }

  const { app_id, redirect_uri } = marketState.fyersConfig;
  if (!app_id || !redirect_uri) return res.status(400).json({ error: "Configure app_id and redirect_uri first" });

  const loginUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${app_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=code&state=amex_os`;
  res.json({ loginUrl, app_id, redirect_uri });
});
