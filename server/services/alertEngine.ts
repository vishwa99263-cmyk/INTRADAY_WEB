import fs from "fs";
import path from "path";
import type { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";
import type { CompleteMarketReport } from "../utils/marketAnalysis.js";
import type { AlertRule, TriggeredAlert } from "../../src/types.js";

export interface AIAlert {
  id: string;
  timestamp: number;
  category: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  confidence: number;
  strikeIndex: string;
  label: string;
  color: "green" | "red" | "yellow";
}

// Memory queue of last 50 analytical alerts
let alertHistory: Record<string, AIAlert[]> = {
  NIFTY: [],
  SENSEX: [],
  BANKNIFTY: [],
};

// Track states for flip detections
const lastOverallNetScores: Record<string, number> = { NIFTY: 0, SENSEX: 0, BANKNIFTY: 0 };
const lastPcrValues: Record<string, number> = { NIFTY: 1.0, SENSEX: 1.0, BANKNIFTY: 1.0 };
const lastVixValues: Record<string, number> = { NIFTY: 15.0, SENSEX: 15.0, BANKNIFTY: 15.0 };

const ALERTS_FILE = path.join(process.cwd(), "server", "storage", "alerts.json");

// ─── Alert Persistence ───────────────────────────────────────────────────────

export function saveAlertsToDisk(): void {
  try {
    const dir = path.dirname(ALERTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      ALERTS_FILE,
      JSON.stringify({
        alerts: marketState.alerts,
        triggeredAlerts: marketState.triggeredAlerts
      }),
      "utf8"
    );
  } catch (err) {
    console.error("[AlertEngine] Save alerts failed:", err);
  }
}

export function loadAlertsFromDisk(): void {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8"));
      if (Array.isArray(data.alerts)) marketState.alerts = data.alerts;
      if (Array.isArray(data.triggeredAlerts)) marketState.triggeredAlerts = data.triggeredAlerts;
      console.log(`[AlertEngine] Loaded ${marketState.alerts.length} rules and ${marketState.triggeredAlerts.length} triggered alerts`);
    }
  } catch (err) {
    console.error("[AlertEngine] Load alerts failed:", err);
  }
}

// ─── Analytical Alert Checking ───────────────────────────────────────────────

export function getAlertHistory(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): AIAlert[] {
  return alertHistory[page] || [];
}

export function checkAndTriggerAlerts(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  report: CompleteMarketReport,
  io: SocketIOServer
): void {
  const currentNetScore = report.trend.strengthPct - 50; // Proxy for net stock scores
  const lastScore = lastOverallNetScores[page];

  const now = Date.now();
  const indexLabel = page;

  const pushAlert = (alert: Omit<AIAlert, "id" | "timestamp">) => {
    const fullAlert: AIAlert = {
      ...alert,
      id: `${page}-${now}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: now,
    };
    alertHistory[page].unshift(fullAlert);
    if (alertHistory[page].length > 50) {
      alertHistory[page].pop();
    }
    // Emit single live alert
    io.emit("ai-alert", { page, alert: fullAlert });
  };

  // 1. Weighted Score Flip
  if (lastScore !== 0) {
    if (lastScore < 0 && currentNetScore > 0) {
      pushAlert({
        category: "SCORE_FLIP",
        priority: "HIGH",
        confidence: 85,
        strikeIndex: indexLabel,
        label: `BULLISH SCORE FLIP: Stock sentiment flipped POSITIVE (Weighted strength: ${report.trend.strengthPct}%)`,
        color: "green",
      });
    } else if (lastScore > 0 && currentNetScore < 0) {
      pushAlert({
        category: "SCORE_FLIP",
        priority: "HIGH",
        confidence: 85,
        strikeIndex: indexLabel,
        label: `BEARISH SCORE FLIP: Stock sentiment flipped NEGATIVE (Weighted strength: ${report.trend.strengthPct}%)`,
        color: "red",
      });
    }
  }
  lastOverallNetScores[page] = currentNetScore;

  // 2. PCR Shift
  const lastPcr = lastPcrValues[page];
  const currentPcr = report.oi.pcr;
  if (Math.abs(currentPcr - lastPcr) >= 0.05) {
    const isBullish = currentPcr > lastPcr;
    pushAlert({
      category: "PCR_SHIFT",
      priority: "MEDIUM",
      confidence: 70,
      strikeIndex: `PCR: ${currentPcr}`,
      label: `PCR Shift detected: ${lastPcr} → ${currentPcr} (${isBullish ? "Support Strengthening" : "Resistance Building"})`,
      color: isBullish ? "green" : "red",
    });
  }
  lastPcrValues[page] = currentPcr;

  const lastVix = lastVixValues[page];
  const currentVix = (page === "NIFTY" ? marketState.niftyOptionChain.indiaVix : marketState.sensexOptionChain.indiaVix) || lastVix;
  if (lastVix > 0 && currentVix > lastVix * 1.025) {
    pushAlert({
      category: "VIX_SPIKE",
      priority: "HIGH",
      confidence: 75,
      strikeIndex: `VIX: ${currentVix}`,
      label: `VIX SPIKE: India VIX jumped to ${currentVix.toFixed(2)}. Anticipate volatility expansion!`,
      color: "yellow",
    });
  }
  lastVixValues[page] = currentVix;

  // 4. Dynamic Volatility Expansion
  if (report.strikes.volatilityExpansion) {
    const lastAlert = alertHistory[page].find(a => a.category === "VOLATILITY_EXPANSION");
    if (!lastAlert || now - lastAlert.timestamp > 300_000) {
      pushAlert({
        category: "VOLATILITY_EXPANSION",
        priority: "MEDIUM",
        confidence: 80,
        strikeIndex: `ATM Strike: ${report.strikes.atmStrike}`,
        label: report.strikes.volatilityReason,
        color: "yellow",
      });
    }
  }

  // 5. Option Chain Volume Spikes
  report.volume.strikeFlags.forEach(f => {
    if (f.ceVolumeSpike) {
      const lastSpike = alertHistory[page].find(
        a => a.category === "CE_VOLUME_SPIKE" && a.strikeIndex === `STRIKE ${f.strikePrice}`
      );
      if (!lastSpike || now - lastSpike.timestamp > 120_000) {
        pushAlert({
          category: "CE_VOLUME_SPIKE",
          priority: "MEDIUM",
          confidence: 75,
          strikeIndex: `STRIKE ${f.strikePrice}`,
          label: `Unusual Call (CE) buying/writing volume on strike ${f.strikePrice}!`,
          color: "red",
        });
      }
    }
    if (f.peVolumeSpike) {
      const lastSpike = alertHistory[page].find(
        a => a.category === "PE_VOLUME_SPIKE" && a.strikeIndex === `STRIKE ${f.strikePrice}`
      );
      if (!lastSpike || now - lastSpike.timestamp > 120_000) {
        pushAlert({
          category: "PE_VOLUME_SPIKE",
          priority: "MEDIUM",
          confidence: 75,
          strikeIndex: `STRIKE ${f.strikePrice}`,
          label: `Unusual Put (PE) buying/writing volume on strike ${f.strikePrice}!`,
          color: "green",
        });
      }
    }
  });

  // 6. Trend Reversal Trigger
  if (report.trend.isReversal && report.trend.reversalType !== "NONE") {
    const lastRev = alertHistory[page].find(a => a.category === "TREND_REVERSAL");
    if (!lastRev || now - lastRev.timestamp > 180_000) {
      const isBullish = report.trend.reversalType === "BULLISH_REVERSAL";
      pushAlert({
        category: "TREND_REVERSAL",
        priority: "HIGH",
        confidence: 82,
        strikeIndex: indexLabel,
        label: `TREND REVERSAL: Flipped to ${isBullish ? "BULLISH" : "BEARISH"} reversal structure in short timeframe (5m/15m)`,
        color: isBullish ? "green" : "red",
      });
    }
  }
}

// ─── Custom User Alert Rules Checking ────────────────────────────────────────

export function checkCustomAlerts(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  report: CompleteMarketReport,
  momentumScore: number,
  io: SocketIOServer
): void {
  const now = Date.now();
  const spotPrice = page === "NIFTY" ? marketState.niftySpot : (page === "BANKNIFTY" ? marketState.bankniftySpot : marketState.sensexSpot);
  const stocks = (page === "NIFTY" ? Object.values(marketState.niftyStocks) : (page === "BANKNIFTY" ? Object.values(marketState.bankniftyStocks) : Object.values(marketState.sensexStocks)))
    .filter(s => s.ticker !== "NSE:NIFTY50-INDEX" && s.ticker !== "BSE:SENSEX-INDEX" && s.ticker !== "NSE:NIFTYBANK-INDEX");
  const netScore = parseFloat(stocks.reduce((sum, s) => sum + s.score, 0).toFixed(3));
  const chain = page === "NIFTY" ? marketState.niftyOptionChain : (page === "BANKNIFTY" ? marketState.bankniftyOptionChain : marketState.sensexOptionChain);
  const oiDiff = chain.totalCallOi - chain.totalPutOi;
  const pcr = report.oi.pcr;

  let alertsChanged = false;

  marketState.alerts.forEach((alert) => {
    if (!alert.enabled || alert.instrument !== page) return;

    // Check reset conditions if already triggered
    if (alert.triggered) {
      if (alert.autoResetOption === "1m" && alert.lastTriggeredAt && now - alert.lastTriggeredAt >= 60_000) {
        alert.triggered = false;
        alertsChanged = true;
        console.log(`[AlertEngine] Auto-reset alert ${alert.id} after 1 minute.`);
      } else if (alert.autoResetOption === "5m" && alert.lastTriggeredAt && now - alert.lastTriggeredAt >= 300_000) {
        alert.triggered = false;
        alertsChanged = true;
        console.log(`[AlertEngine] Auto-reset alert ${alert.id} after 5 minutes.`);
      } else {
        return; // skip if already triggered and not auto-reset yet
      }
    }

    let liveValue: number | null = null;

    switch (alert.type) {
      case "SPOT_PRICE":
        liveValue = spotPrice;
        break;
      case "CE_PREMIUM":
        if (alert.strike) {
          const chain = alert.instrument === "NIFTY" ? marketState.niftyOptionChain : marketState.sensexOptionChain;
          const row = chain.strikes.find(s => s.strikePrice === alert.strike);
          if (row) liveValue = row.ceLtp;
        }
        break;
      case "PE_PREMIUM":
        if (alert.strike) {
          const chain = alert.instrument === "NIFTY" ? marketState.niftyOptionChain : marketState.sensexOptionChain;
          const row = chain.strikes.find(s => s.strikePrice === alert.strike);
          if (row) liveValue = row.peLtp;
        }
        break;
      case "NET_SCORE":
        liveValue = netScore;
        break;
      case "OI_DIFFERENCE":
        liveValue = oiDiff;
        break;
      case "PCR":
        liveValue = pcr;
        break;
      case "MOMENTUM_SCORE":
        liveValue = momentumScore;
        break;
      default:
        break;
    }

    if (liveValue === null || isNaN(liveValue)) return;

    let isMatched = false;
    switch (alert.condition) {
      case "ABOVE":
        isMatched = liveValue > alert.targetValue;
        break;
      case "BELOW":
        isMatched = liveValue < alert.targetValue;
        break;
      case "TOUCH":
        // 0.05% tolerance for Spot Price, or absolute 0.5 points for premiums/scores
        const tolerance = alert.type === "SPOT_PRICE" ? alert.targetValue * 0.0005 : 0.5;
        isMatched = Math.abs(liveValue - alert.targetValue) <= tolerance;
        break;
      default:
        break;
    }

    if (isMatched) {
      alert.triggered = true;
      alert.lastTriggeredAt = now;
      alertsChanged = true;

      const triggeredAlert: TriggeredAlert = {
        id: `trigger-${alert.id}-${now}`,
        alertId: alert.id,
        title: `🚨 ${alert.priority} ALERT: ${alert.instrument} ${alert.type}`,
        message: `${alert.instrument} ${alert.type} is ${alert.condition} ${alert.targetValue} (Current: ${liveValue})`,
        value: liveValue,
        instrument: alert.instrument,
        priority: alert.priority,
        sound: alert.sound,
        timestamp: now,
        note: alert.note
      };

      marketState.triggeredAlerts.unshift(triggeredAlert);
      if (marketState.triggeredAlerts.length > 50) {
        marketState.triggeredAlerts.pop();
      }

      console.log(`[AlertEngine] 🔔 Alert Triggered: ${triggeredAlert.title} - ${triggeredAlert.message}`);
      io.emit("price-alert-triggered", triggeredAlert);
      saveAlertsToDisk();
    }
  });

  if (alertsChanged) {
    io.emit("alerts-update", {
      alerts: marketState.alerts,
      triggeredAlerts: marketState.triggeredAlerts
    });
  }
}
