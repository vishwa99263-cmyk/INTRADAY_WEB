/**
 * useMarketSocket.ts
 *
 * Single Socket.IO hook that owns the connection lifecycle.
 * Frontend is a PURE display layer — no calculations, no backups, no fetches.
 *
 * Server emits:
 *   "market-update"     → full state snapshot (throttled ≤10/s)
 *   "connection-status" → lightweight connection change event
 *   "server-time"       → { serverTime: number } every 1s
 *   "backup-update"     → { label, time } after each snapshot
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  StockData,
  BackupSnapshots,
  TimedBackupStore,
  ConnectionStatus,
  OptionChainState,
  WeightedSummary,
  MarketUpdatePayload,
  AIAnalysisPayload,
  AlertRule,
  TriggeredAlert,
} from "../types";

// ── Default empty state ───────────────────────────────────────────────────────

const DEFAULT_OPTION_CHAIN: OptionChainState = {
  expiryList: [], selectedExpiry: "", strikes: [],
  totalCallOi: 0, totalPutOi: 0, indiaVix: 0,
  spotPrice: 0, spotChange: 0, spotChangePct: 0, highPrice: 0, lowPrice: 0,
  lastSnapshotTime: null, isLive: false,
};

const DEFAULT_SUMMARY: WeightedSummary = {
  top10Sum: 0, next15Sum: 0, remainingSum: 0, totalSum: 0,
  advances: 0, declines: 0, unchanged: 0,
};

const DEFAULT_AI_STATE = (page: "NIFTY" | "SENSEX" | "BANKNIFTY" | "HDFCBANK" | "RELIANCE" | "ICICIBANK" | "CUSTOM_STOCK"): AIAnalysisPayload => ({
  page: page as any,
  report: {
    trend: {
      trend5m: "SIDEWAYS", trend15m: "SIDEWAYS", trend30m: "SIDEWAYS", trend1h: "SIDEWAYS", overall: "SIDEWAYS",
      alignment: "MIXED", strengthPct: 50, isReversal: false, reversalType: "NONE",
      structureType: "RANGE_BOUND", higherHighs: false, lowerLows: false, keyLevel: 0,
    },
    oi: {
      pcr: 1.0, sentiment: "SIDEWAYS", resistanceWall: 0, resistanceOi: 0, supportWall: 0, supportOi: 0,
      maxPainStrike: 0, buildups: [], netCeBuildup: "NONE", netPeBuildup: "NONE"
    },
    volume: {
      totalCeVolume: 0, totalPeVolume: 0, volumeRatio: 1.0, volumeBias: "BALANCED",
      avgStrikeCeVolume: 0, avgStrikePeVolume: 0, strikeFlags: [], hasMajorCeSpike: false, hasMajorPeSpike: false
    },
    speed: { velocity: 0, marketState: "SLOW_MARKET", momentumState: "LOW_MOMENTUM", accelerating: false, priceActionGrade: "WEAK" },
    strikes: { atmStrike: 0, recommendedCe: null, recommendedPe: null, volatilityExpansion: false, volatilityReason: "" },
    timestamp: Date.now()
  },
  breakout: {
    high5m: 0, low5m: 0, high15m: 0, low15m: 0,
    rangeEstablished5m: false, rangeEstablished15m: false,
    breakoutType: "NONE", breakoutStatus: "Establishing range...",
    trapProbability: 0, trapType: "NONE", reasoning: "Awaiting range establishment.",
  },
  momentum: { momentumScore: 0, momentumLabel: "LOW_MOMENTUM", hasVolumeSpike: false, hasBigCandle: false, hasFollowThrough: false, direction: "NONE" },
  expirySetup: {
    strategyName: "OPEN PRICE RANGE BREAKOUT", signalType: "WAIT", recommendedStrike: "NONE",
    recommendedPremium: 0, stopLoss: 0, target: 0, confidencePct: 50,
    winRateGrade: "LOW_CONFIDENCE", riskLevel: "MEDIUM", setupDetails: "Waiting for confirmation...",
    stopLossType: "PREMIUM_BASED", levelBasedSL: 0, riskRewardRatio: 0,
    positionSizeGrade: "QUARTER", reasoning: "",
  },
  alerts: [],
  smartMoney: {
    direction: "NEUTRAL", confidence: 0, eventType: "NONE",
    detail: "Awaiting market data...", institutionalBias: "NEUTRAL", reasoning: "",
  },
  alignment: {
    alignmentScore: 0, alignmentGrade: "NO_SIGNAL", dominantStrategy: "NONE",
    tradeDirection: "NONE", strategiesAgreeing: [], strategiesConflicting: [],
    noTradeFilter: true, noTradeReason: "Awaiting data.", reasoning: "",
  },
  antigravity: {
    finalSignal: "NO_TRADE", signalGrade: "D", antigravityScore: 0, confidence: 0,
    marketRegime: "RANGING", activeFilters: [], reasoning: "",
    gradeExplanation: "NO TRADE ZONE — Protecting capital until signals confirm.",
    scoreBreakdown: { marketStructure: 0, smartMoney: 0, breakoutConfirmation: 0, momentumStrength: 0, timeValidity: 0 },
    timestamp: Date.now(),
  },
  signalMemory: {
    totalSignals: 0, wins: 0, losses: 0, neutral: 0,
    winRate: 50, recentWinRate: 50, confidenceMultiplier: 1.0, lastUpdated: Date.now(),
  },
  signalHistory: [],
  backtest: null,
});


// ── IST countdown derivation (pure math — no setInterval needed) ──────────────

function deriveCountdowns(serverTime: number) {
  // serverTime is UTC epoch ms (Date.now() from server)
  const istDate = new Date(serverTime + 5.5 * 60 * 60 * 1000);
  const totalSec = istDate.getUTCHours() * 3600 + istDate.getUTCMinutes() * 60 + istDate.getUTCSeconds();

  // 5M: every 5 min from 09:00
  const rem5m  = 300  - (totalSec % 300);
  // 15M: every 15 min from 09:00
  const rem15m = 900  - (totalSec % 900);
  // 30M: every 30 min offset +15 min
  const rem30m = 1800 - ((totalSec - 15 * 60 + 86400) % 1800);
  // 1H: every 60 min offset +15 min
  const rem1h  = 3600 - ((totalSec - 15 * 60 + 86400) % 3600);

  const fmt = (s: number) => {
    const mm = Math.floor(s / 60), ss = s % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")} remaining`;
  };

  return {
    countdown5m:  fmt(Math.max(0, rem5m)),
    countdown15m: fmt(Math.max(0, rem15m)),
    countdown30m: fmt(Math.max(0, rem30m)),
    countdown1h:  fmt(Math.max(0, rem1h)),
    secs5m:  Math.max(0, rem5m),
    secs15m: Math.max(0, rem15m),
    secs30m: Math.max(0, rem30m),
    secs1h:  Math.max(0, rem1h),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface MarketSocketReturn {
  // Connection
  socket:           Socket | null;
  connectionStatus: ConnectionStatus;
  fyersAuthorized:  boolean;
  lastFyersError:   string;
  isSimulating:     boolean;
  isConnected:      boolean;

  // Market data
  niftyStocksMap:   Record<string, StockData>;
  sensexStocksMap:  Record<string, StockData>;
  bankniftyStocksMap: Record<string, StockData>;
  niftySpot:        number;
  sensexSpot:       number;
  bankniftySpot:    number;
  niftyHistory:     { high: number; low: number; prevClose: number };
  sensexHistory:    { high: number; low: number; prevClose: number };
  bankniftyHistory: { high: number; low: number; prevClose: number };

  // Backups
  niftyBackup:      BackupSnapshots;
  sensexBackup:     BackupSnapshots;
  bankniftyBackup:  BackupSnapshots;
  niftyTimedBackup: TimedBackupStore;
  sensexTimedBackup:TimedBackupStore;
  bankniftyTimedBackup: TimedBackupStore;

  // Option chain (live from server WebSocket ticks)
  optionChain:      OptionChainState;
  niftyOptionChain: OptionChainState;
  sensexOptionChain:OptionChainState;
  bankniftyOptionChain: OptionChainState;
  hdfcbankOptionChain: OptionChainState;
  relianceOptionChain: OptionChainState;
  icicibankOptionChain: OptionChainState;
  customStockOptionChain: OptionChainState;
  customStockSymbol: string;

  // Advance AI State
  aiAnalysis:       AIAnalysisPayload;

  // Summaries
  niftySummary:     WeightedSummary;
  sensexSummary:    WeightedSummary;
  bankniftySummary: WeightedSummary;
  niftyMarketDir:   any;
  sensexMarketDir:  any;
  bankniftyMarketDir: any;

  // Fyers config (for OAuth2 flow in browser)
  fyersConfig:      { app_id: string; secret_key: string; redirect_uri: string; access_token: string };

  // Server time & derived countdowns
  serverTime:       number;
  countdown5m:      string;
  countdown15m:     string;
  countdown30m:     string;
  countdown1h:      string;
  secs5m:           number;
  secs15m:          number;
  secs30m:          number;
  secs1h:           number;

  // Actions
  selectExpiry: (expiry: string) => void;
  requestState: () => void;

  // Alerts
  alerts: AlertRule[];
  triggeredAlerts: TriggeredAlert[];
  activeTriggeredAlert: TriggeredAlert | null;
  setActiveTriggeredAlert: (alert: TriggeredAlert | null) => void;
  addAlertRule: (rule: Omit<AlertRule, "id" | "createdAt" | "triggered">) => Promise<boolean>;
  deleteAlertRule: (id: string) => Promise<boolean>;
  toggleAlertRule: (id: string) => Promise<boolean>;
  clearAlertHistory: () => Promise<boolean>;
}

function playFallbackBeep(soundName: string, priority: string) {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;
    
    if (priority === "CRITICAL" || priority === "HIGH") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(587.33, now + 0.15); // D5
      osc.frequency.setValueAtTime(880, now + 0.3);
      osc.frequency.setValueAtTime(587.33, now + 0.45);
      
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.setValueAtTime(0.5, now + 0.45);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
      
      osc.start(now);
      osc.stop(now + 0.7);
    } else {
      osc.type = "sine";
      if (soundName === "MARKET_BELL") {
        osc.frequency.setValueAtTime(523.25, now); // C5 bell chime
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);
      } else if (soundName === "TRADING_ALERT") {
        osc.frequency.setValueAtTime(659.25, now); // E5 ping
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      } else {
        osc.frequency.setValueAtTime(349.23, now); // F4 caution
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      }
      osc.start(now);
      osc.stop(now + 1.2);
    }
  } catch (e) {
    console.error("[useMarketSocket] Web Audio fallback synth failed:", e);
  }
}

export function useMarketSocket(activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | "HDFCBANK" | "RELIANCE" | "ICICIBANK" | "CUSTOM_STOCK" = "NIFTY"): MarketSocketReturn {
  const socketRef = useRef<Socket | null>(null);

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("DISCONNECTED");
  const [fyersAuthorized,  setFyersAuthorized]  = useState(false);
  const [lastFyersError,   setLastFyersError]   = useState("");
  const [isSimulating,     setIsSimulating]     = useState(true);
  const [isConnected,      setIsConnected]      = useState(false);

  // Advance AI State Map
  const [aiAnalysisMap, setAiAnalysisMap] = useState<Record<string, AIAnalysisPayload>>({
    NIFTY: DEFAULT_AI_STATE("NIFTY"),
    SENSEX: DEFAULT_AI_STATE("SENSEX"),
    BANKNIFTY: DEFAULT_AI_STATE("BANKNIFTY"),
    HDFCBANK: DEFAULT_AI_STATE("HDFCBANK"),
    RELIANCE: DEFAULT_AI_STATE("RELIANCE"),
    ICICIBANK: DEFAULT_AI_STATE("ICICIBANK"),
    CUSTOM_STOCK: DEFAULT_AI_STATE("CUSTOM_STOCK"),
  });

  // Alerts
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>([]);
  const [activeTriggeredAlert, setActiveTriggeredAlert] = useState<TriggeredAlert | null>(null);

  // Market data
  const [niftyStocksMap,  setNiftyStocksMap]  = useState<Record<string, StockData>>({});
  const [sensexStocksMap, setSensexStocksMap] = useState<Record<string, StockData>>({});
  const [bankniftyStocksMap, setBankniftyStocksMap] = useState<Record<string, StockData>>({});
  const [niftySpot,       setNiftySpot]       = useState(0);
  const [sensexSpot,      setSensexSpot]      = useState(0);
  const [bankniftySpot,   setBankniftySpot]   = useState(0);
  const [niftyHistory,    setNiftyHistory]    = useState({ high: 0, low: 0, prevClose: 0 });
  const [sensexHistory,   setSensexHistory]   = useState({ high: 0, low: 0, prevClose: 0 });
  const [bankniftyHistory, setBankniftyHistory] = useState({ high: 0, low: 0, prevClose: 0 });

  // Backups
  const [niftyBackup,       setNiftyBackup]      = useState<BackupSnapshots>({});
  const [sensexBackup,      setSensexBackup]     = useState<BackupSnapshots>({});
  const [bankniftyBackup,   setBankniftyBackup]  = useState<BackupSnapshots>({});
  const [niftyTimedBackup,  setNiftyTimedBackup] = useState<TimedBackupStore>({});
  const [sensexTimedBackup, setSensexTimedBackup]= useState<TimedBackupStore>({});
  const [bankniftyTimedBackup, setBankniftyTimedBackup] = useState<TimedBackupStore>({});

  // Option chain
  const [niftyOptionChain, setNiftyOptionChain] = useState<OptionChainState>(DEFAULT_OPTION_CHAIN);
  const [sensexOptionChain, setSensexOptionChain] = useState<OptionChainState>(DEFAULT_OPTION_CHAIN);
  const [bankniftyOptionChain, setBankniftyOptionChain] = useState<OptionChainState>(DEFAULT_OPTION_CHAIN);
  const [hdfcbankOptionChain, setHdfcbankOptionChain] = useState<OptionChainState>(DEFAULT_OPTION_CHAIN);
  const [relianceOptionChain, setRelianceOptionChain] = useState<OptionChainState>(DEFAULT_OPTION_CHAIN);
  const [icicibankOptionChain, setIcicibankOptionChain] = useState<OptionChainState>(DEFAULT_OPTION_CHAIN);
  const [customStockOptionChain, setCustomStockOptionChain] = useState<OptionChainState>(DEFAULT_OPTION_CHAIN);
  const [customStockSymbol, setCustomStockSymbol] = useState<string>("");

  // Summaries
  const [niftySummary,  setNiftySummary]  = useState<WeightedSummary>(DEFAULT_SUMMARY);
  const [sensexSummary, setSensexSummary] = useState<WeightedSummary>(DEFAULT_SUMMARY);
  const [bankniftySummary, setBankniftySummary] = useState<WeightedSummary>(DEFAULT_SUMMARY);

  const [niftyMarketDir,  setNiftyMarketDir]  = useState<any>(null);
  const [sensexMarketDir, setSensexMarketDir] = useState<any>(null);
  const [bankniftyMarketDir, setBankniftyMarketDir] = useState<any>(null);

  // Fyers config (secret_key is server-only but the FyersIntegration form needs the field)
  const [fyersConfig, setFyersConfig] = useState({
    app_id: "R8T7ETPIPG-100", secret_key: "", redirect_uri: "http://127.0.0.1:3000", access_token: "",
  });

  // Server time & countdowns
  const [serverTime, setServerTime] = useState(Date.now());
  const [countdowns, setCountdowns] = useState(() => deriveCountdowns(Date.now()));

  // ── Throttled updates buffering refs ────────────────────────────────────────
  const pendingMarketUpdateRef = useRef<MarketUpdatePayload | null>(null);
  const pendingOptionChainsRef = useRef<Record<string, OptionChainState>>({});
  const pendingAIUpdatesRef = useRef<Record<string, AIAnalysisPayload>>({});
  const pendingAlertsUpdateRef = useRef<{ alerts: AlertRule[]; triggeredAlerts: TriggeredAlert[] } | null>(null);
  const pendingConnectionStatusRef = useRef<{
    connectionStatus: ConnectionStatus;
    fyersAuthorized: boolean;
    lastFyersError: string;
    serverTime: number;
  } | null>(null);
  const pendingServerTimeRef = useRef<number | null>(null);

  // Flags for first-load (immediate apply)
  const isFirstUpdateRef = useRef(true);
  const isFirstOptionChainRef = useRef<Record<string, boolean>>({});

  // ── Apply functions (unthrottled / direct commits) ─────────────────────────
  const applyPayload = useCallback((payload: MarketUpdatePayload) => {
    if (payload.niftyStocks && payload.niftyStocks.length > 0)
      setNiftyStocksMap(Object.fromEntries(payload.niftyStocks.map(s => [s.symbol, s])));
    if (payload.sensexStocks && payload.sensexStocks.length > 0)
      setSensexStocksMap(Object.fromEntries(payload.sensexStocks.map(s => [s.symbol, s])));
    if (payload.bankniftyStocks && payload.bankniftyStocks.length > 0)
      setBankniftyStocksMap(Object.fromEntries(payload.bankniftyStocks.map(s => [s.symbol, s])));

    if (payload.niftySpot !== undefined) setNiftySpot(payload.niftySpot);
    if (payload.sensexSpot !== undefined) setSensexSpot(payload.sensexSpot);
    if (payload.bankniftySpot !== undefined) setBankniftySpot(payload.bankniftySpot);

    if (payload.niftyHistory)     setNiftyHistory(payload.niftyHistory);
    if (payload.sensexHistory)    setSensexHistory(payload.sensexHistory);
    if (payload.bankniftyHistory) setBankniftyHistory(payload.bankniftyHistory);

    if (payload.niftyBackup) setNiftyBackup(payload.niftyBackup);
    if (payload.sensexBackup) setSensexBackup(payload.sensexBackup);
    if (payload.bankniftyBackup) setBankniftyBackup(payload.bankniftyBackup);
    if (payload.niftyTimedBackup) setNiftyTimedBackup(payload.niftyTimedBackup);
    if (payload.sensexTimedBackup) setSensexTimedBackup(payload.sensexTimedBackup);
    if (payload.bankniftyTimedBackup) setBankniftyTimedBackup(payload.bankniftyTimedBackup);

    const ocNifty = (payload as any).niftyOptionChain as OptionChainState | undefined;
    const ocSensex = (payload as any).sensexOptionChain as OptionChainState | undefined;
    const ocBanknifty = (payload as any).bankniftyOptionChain as OptionChainState | undefined;
    if (ocNifty && ocNifty.strikes.length > 0) setNiftyOptionChain(ocNifty);
    if (ocSensex && ocSensex.strikes.length > 0) setSensexOptionChain(ocSensex);
    if (ocBanknifty && ocBanknifty.strikes.length > 0) setBankniftyOptionChain(ocBanknifty);

    const ocHdfc = payload.hdfcbankOptionChain;
    const ocReliance = payload.relianceOptionChain;
    const ocIcici = payload.icicibankOptionChain;
    const ocCustom = payload.customStockOptionChain;
    if (ocHdfc && ocHdfc.strikes.length > 0) setHdfcbankOptionChain(ocHdfc);
    if (ocReliance && ocReliance.strikes.length > 0) setRelianceOptionChain(ocReliance);
    if (ocIcici && ocIcici.strikes.length > 0) setIcicibankOptionChain(ocIcici);
    if (ocCustom && ocCustom.strikes.length > 0) setCustomStockOptionChain(ocCustom);

    if (payload.customStockSymbol !== undefined) setCustomStockSymbol(payload.customStockSymbol);

    if (payload.niftySummary && payload.niftySummary.totalSum !== 0) setNiftySummary(payload.niftySummary);
    if (payload.sensexSummary && payload.sensexSummary.totalSum !== 0) setSensexSummary(payload.sensexSummary);
    if (payload.bankniftySummary && payload.bankniftySummary.totalSum !== 0) setBankniftySummary(payload.bankniftySummary);

    if ((payload as any).niftyMarketDir)  setNiftyMarketDir((payload as any).niftyMarketDir);
    if ((payload as any).sensexMarketDir) setSensexMarketDir((payload as any).sensexMarketDir);
    if ((payload as any).bankniftyMarketDir) setBankniftyMarketDir((payload as any).bankniftyMarketDir);

    if ((payload as any).alerts !== undefined) setAlerts((payload as any).alerts);
    if ((payload as any).triggeredAlerts !== undefined) setTriggeredAlerts((payload as any).triggeredAlerts);

    if (payload.connectionStatus !== undefined) setConnectionStatus(payload.connectionStatus);
    if (payload.fyersAuthorized !== undefined) setFyersAuthorized(payload.fyersAuthorized);
    if (payload.lastFyersError !== undefined) setLastFyersError(payload.lastFyersError);
    if (payload.isSimulating !== undefined) setIsSimulating(payload.isSimulating);
    if (payload.fyersConfig) setFyersConfig(prev => ({ ...prev, ...payload.fyersConfig }));

    if (payload.serverTime) {
      setServerTime(payload.serverTime);
      setCountdowns(deriveCountdowns(payload.serverTime));
    }
  }, []);

  const applyOptionChain = useCallback((index: string, chain: OptionChainState) => {
    if (index === "NIFTY") setNiftyOptionChain(chain);
    else if (index === "BANKNIFTY") setBankniftyOptionChain(chain);
    else if (index === "SENSEX") setSensexOptionChain(chain);
    else if (index === "HDFCBANK") setHdfcbankOptionChain(chain);
    else if (index === "RELIANCE") setRelianceOptionChain(chain);
    else if (index === "ICICIBANK") setIcicibankOptionChain(chain);
    else if (index === "CUSTOM_STOCK") setCustomStockOptionChain(chain);
  }, []);

  // Stable refs for event listeners
  const applyPayloadRef = useRef(applyPayload);
  const applyOptionChainRef = useRef(applyOptionChain);
  useEffect(() => {
    applyPayloadRef.current = applyPayload;
    applyOptionChainRef.current = applyOptionChain;
  }, [applyPayload, applyOptionChain]);

  // Request browser notification permissions on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
  }, []);

  // ── Throttled loop effect (batch flushes refs to React state) ────────────────
  useEffect(() => {
    const intervalId = setInterval(() => {
      // 1. Commit Market Updates
      if (pendingMarketUpdateRef.current) {
        applyPayloadRef.current(pendingMarketUpdateRef.current);
        pendingMarketUpdateRef.current = null;
      }

      // 2. Commit Option Chains
      const optKeys = Object.keys(pendingOptionChainsRef.current);
      if (optKeys.length > 0) {
        optKeys.forEach(index => {
          applyOptionChainRef.current(index, pendingOptionChainsRef.current[index]);
        });
        pendingOptionChainsRef.current = {};
      }

      // 3. Commit AI Updates
      const aiKeys = Object.keys(pendingAIUpdatesRef.current);
      if (aiKeys.length > 0) {
        setAiAnalysisMap(prev => {
          const next = { ...prev };
          aiKeys.forEach(page => {
            next[page] = pendingAIUpdatesRef.current[page];
          });
          return next;
        });
        pendingAIUpdatesRef.current = {};
      }

      // 4. Commit Alerts
      if (pendingAlertsUpdateRef.current) {
        const alertsData = pendingAlertsUpdateRef.current;
        pendingAlertsUpdateRef.current = null;
        setAlerts(alertsData.alerts);
        setTriggeredAlerts(alertsData.triggeredAlerts);
      }

      // 5. Commit Connection Status
      if (pendingConnectionStatusRef.current) {
        const conn = pendingConnectionStatusRef.current;
        pendingConnectionStatusRef.current = null;
        setConnectionStatus(conn.connectionStatus);
        setFyersAuthorized(conn.fyersAuthorized);
        setLastFyersError(conn.lastFyersError);
        if (conn.serverTime) {
          setServerTime(conn.serverTime);
          setCountdowns(deriveCountdowns(conn.serverTime));
        }
      }

      // 6. Commit Server Time
      if (pendingServerTimeRef.current !== null) {
        const time = pendingServerTimeRef.current;
        pendingServerTimeRef.current = null;
        setServerTime(time);
        setCountdowns(deriveCountdowns(time));
      }
    }, 350);

    return () => clearInterval(intervalId);
  }, []);

  // ── Socket lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    const skt = io("http://localhost:3000", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
    socketRef.current = skt;

    skt.on("connect", () => {
      console.log("[Socket] 🟢 Connected to server");
      setIsConnected(true);
      skt.emit("request-state");
    });

    skt.on("disconnect", (reason) => {
      console.log("[Socket] 🔴 Disconnected:", reason);
      setIsConnected(false);
      if (reason !== "io server disconnect") {
        setConnectionStatus("RECONNECTING");
      } else {
        setConnectionStatus("DISCONNECTED");
      }
    });

    skt.on("connect_error", (error) => {
      console.error("[Socket] Connection Error:", error.message);
      setIsConnected(false);
      setConnectionStatus("DISCONNECTED");
      setLastFyersError("Socket connection failed: " + error.message);
    });

    skt.on("reconnect_attempt", (attempt) => {
      console.log("[Socket] Reconnecting, attempt #", attempt);
      setConnectionStatus("RECONNECTING");
    });

    skt.on("reconnect_failed", () => {
      console.error("[Socket] Reconnection failed after 5 attempts");
      setIsConnected(false);
      setConnectionStatus("DISCONNECTED");
      setLastFyersError("Socket reconnection failed after maximum attempts.");
    });

    skt.on("market-update", (payload: MarketUpdatePayload) => {
      if (isFirstUpdateRef.current) {
        isFirstUpdateRef.current = false;
        applyPayloadRef.current(payload);
      } else {
        pendingMarketUpdateRef.current = payload;
      }
    });

    skt.on("option-chain-update", (data: { index: "NIFTY" | "SENSEX" | "BANKNIFTY" | "HDFCBANK" | "RELIANCE" | "ICICIBANK" | "CUSTOM_STOCK"; chain: OptionChainState }) => {
      if (!data.chain || data.chain.strikes.length === 0) return;
      if (!isFirstOptionChainRef.current[data.index]) {
        isFirstOptionChainRef.current[data.index] = true;
        applyOptionChainRef.current(data.index, data.chain);
      } else {
        pendingOptionChainsRef.current[data.index] = data.chain;
      }
    });

    skt.on("ai-update", (data: { page: "NIFTY" | "SENSEX" | "BANKNIFTY"; payload: AIAnalysisPayload }) => {
      pendingAIUpdatesRef.current[data.page] = data.payload;
    });

    skt.on("alerts-update", (data: { alerts: AlertRule[]; triggeredAlerts: TriggeredAlert[] }) => {
      pendingAlertsUpdateRef.current = data;
    });

    skt.on("price-alert-triggered", (triggeredAlert: TriggeredAlert) => {
      console.log("[Socket] 🚨 Alert Triggered:", triggeredAlert);

      // 1. Play Alarm Sound
      try {
        const soundMap: Record<string, string> = {
          SIREN: "/sounds/siren.mp3",
          MARKET_BELL: "/sounds/market-bell.mp3",
          TRADING_ALERT: "/sounds/trading-alert.mp3",
          WARNING_ALARM: "/sounds/warning.mp3",
        };
        const soundFile = soundMap[triggeredAlert.sound] || "/sounds/siren.mp3";
        const audio = new Audio(soundFile);
        if (triggeredAlert.priority === "HIGH" || triggeredAlert.priority === "CRITICAL") {
          audio.volume = 1.0;
        } else {
          audio.volume = 0.6;
        }
        audio.play().catch(err => {
          console.warn("[useMarketSocket] Audio autoplay blocked or failed, using synth fallback:", err.message);
          playFallbackBeep(triggeredAlert.sound, triggeredAlert.priority);
        });
      } catch (err: any) {
        console.error("[useMarketSocket] Audio playback failed, using synth fallback:", err.message);
        playFallbackBeep(triggeredAlert.sound, triggeredAlert.priority);
      }

      // 2. HTML5 System/Device Notification
      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          try {
            new Notification(triggeredAlert.title, {
              body: `${triggeredAlert.message}${triggeredAlert.note ? `\n"${triggeredAlert.note}"` : ""}`,
              icon: "/alert-icon.png",
              tag: triggeredAlert.id
            });
          } catch (e) {
            console.error("[useMarketSocket] Browser notification failed to post:", e);
          }
        }
      }

      // 3. Set Active Triggered Alert for Modal/Fullscreen popup
      setActiveTriggeredAlert(triggeredAlert);
    });

    skt.on("connection-status", (data: {
      connectionStatus: ConnectionStatus;
      fyersAuthorized: boolean;
      lastFyersError: string;
      serverTime: number;
    }) => {
      pendingConnectionStatusRef.current = data;
    });

    skt.on("server-time", (data: { serverTime: number }) => {
      pendingServerTimeRef.current = data.serverTime;
    });

    return () => {
      skt.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const selectExpiry = useCallback((expiry: string) => {
    socketRef.current?.emit("select-expiry", { index: activePage, expiry });
  }, [activePage]);

  const requestState = useCallback(() => {
    socketRef.current?.emit("request-state");
  }, []);

  const addAlertRule = useCallback(async (rule: Omit<AlertRule, "id" | "createdAt" | "triggered">) => {
    try {
      const res = await fetch("http://localhost:3000/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      return res.ok;
    } catch (err) {
      console.error("[useMarketSocket] Add alert rule failed:", err);
      return false;
    }
  }, []);

  const deleteAlertRule = useCallback(async (id: string) => {
    try {
      const res = await fetch("http://localhost:3000/api/alerts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      return res.ok;
    } catch (err) {
      console.error("[useMarketSocket] Delete alert rule failed:", err);
      return false;
    }
  }, []);

  const toggleAlertRule = useCallback(async (id: string) => {
    try {
      const res = await fetch("http://localhost:3000/api/alerts/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      return res.ok;
    } catch (err) {
      console.error("[useMarketSocket] Toggle alert rule failed:", err);
      return false;
    }
  }, []);

  const clearAlertHistory = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:3000/api/alerts/clear-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return res.ok;
    } catch (err) {
      console.error("[useMarketSocket] Clear alert history failed:", err);
      return false;
    }
  }, []);

  return {
    socket:            socketRef.current,
    connectionStatus,  fyersAuthorized, lastFyersError, isSimulating, isConnected,
    niftyStocksMap,    sensexStocksMap,    bankniftyStocksMap,
    niftySpot,         sensexSpot,         bankniftySpot,
    niftyHistory,      sensexHistory,      bankniftyHistory,
    niftyBackup,       sensexBackup,       bankniftyBackup,
    niftyTimedBackup,  sensexTimedBackup,  bankniftyTimedBackup,
    optionChain: activePage === "NIFTY" ? niftyOptionChain :
                 activePage === "BANKNIFTY" ? bankniftyOptionChain :
                 activePage === "SENSEX" ? sensexOptionChain :
                 activePage === "HDFCBANK" ? hdfcbankOptionChain :
                 activePage === "RELIANCE" ? relianceOptionChain :
                 activePage === "ICICIBANK" ? icicibankOptionChain :
                 customStockOptionChain,
    niftyOptionChain,
    sensexOptionChain,
    bankniftyOptionChain,
    hdfcbankOptionChain,
    relianceOptionChain,
    icicibankOptionChain,
    customStockOptionChain,
    customStockSymbol,
    niftySummary,      sensexSummary,      bankniftySummary,
    niftyMarketDir,    sensexMarketDir,    bankniftyMarketDir,
    fyersConfig,
    serverTime,
    aiAnalysis:        aiAnalysisMap[activePage] || DEFAULT_AI_STATE(activePage),
    ...countdowns,
    selectExpiry,
    requestState,
    alerts,
    triggeredAlerts,
    activeTriggeredAlert,
    setActiveTriggeredAlert,
    addAlertRule,
    deleteAlertRule,
    toggleAlertRule,
    clearAlertHistory,
  };
}
