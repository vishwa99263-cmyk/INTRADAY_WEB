import type { StockData, BackupSnapshots, TimedBackupStore, AlertRule, TriggeredAlert } from "../../src/types.js";

// ── Option Chain types ────────────────────────────────────────────────────

export interface OptionStrikeData {
  strikePrice: number;
  ceSymbol: string; peSymbol: string;
  ceLtp: number;  ceBid: number;  ceAsk: number;
  ceVolume: number; ceOI: number; ceOIChange: number; ceOIChangePct: number;
  ceLtpChgPct: number;
  ceDelta: number; ceGamma: number; ceTheta: number; ceVega: number; ceIV: number;
  cePrevOI?: number;
  peLtp: number;  peBid: number;  peAsk: number;
  peVolume: number; peOI: number; peOIChange: number; peOIChangePct: number;
  peLtpChgPct: number;
  peDelta: number; peGamma: number; peTheta: number; peVega: number; peIV: number;
  pePrevOI?: number;
}

export interface ExpiryItem {
  label: string;
  value: string;
  expiryFlag?: string;
}

export interface CalculatedChainMetrics {
  pcr: number;
  supportWall: number;
  resistanceWall: number;
  sentiment: string;
  totalCallOi: number;
  totalPutOi: number;
  strikes?: {
    strikePrice: number;
    ceOI: number;
    ceOIChange: number;
    ceVolume: number;
    ceLtp: number;
    peOI: number;
    peOIChange: number;
    peVolume: number;
    peLtp: number;
  }[];
}

export interface OptionChainState {
  expiryList:       ExpiryItem[];
  selectedExpiry:   string;
  strikes:          OptionStrikeData[];
  totalCallOi:      number;
  totalPutOi:       number;
  indiaVix:         number;
  spotPrice:        number;
  spotChange:       number;
  spotChangePct:    number;
  highPrice:        number;
  lowPrice:         number;
  lastSnapshotTime: string | null;  // ISO timestamp of last saved snapshot
  isLive:           boolean;        // true = live WS ticks, false = restored snapshot
  monthlyExpiry?: string;
  nextWeeklyExpiry?: string;
  monthlyMetrics?: CalculatedChainMetrics;
  nextWeeklyMetrics?: CalculatedChainMetrics;
}

export type ConnectionStatus = "LIVE" | "RECONNECTING" | "DISCONNECTED" | "EXPIRED";

export interface FyersConfig {
  app_id:       string;
  secret_key:   string;
  redirect_uri: string;
  access_token: string;
}

export interface MarketStateType {
  niftyStocks:      Record<string, StockData>;
  sensexStocks:     Record<string, StockData>;
  bankniftyStocks:  Record<string, StockData>;
  niftySpot:        number;
  sensexSpot:       number;
  bankniftySpot:    number;
  niftyHistory:     { high: number; low: number; prevClose: number };
  sensexHistory:    { high: number; low: number; prevClose: number };
  bankniftyHistory: { high: number; low: number; prevClose: number };
  niftyBackup:      BackupSnapshots;
  sensexBackup:     BackupSnapshots;
  bankniftyBackup:  BackupSnapshots;
  niftyTimedBackup:  TimedBackupStore;
  sensexTimedBackup: TimedBackupStore;
  bankniftyTimedBackup: TimedBackupStore;
  niftyOptionChain:  OptionChainState;
  sensexOptionChain: OptionChainState;
  bankniftyOptionChain: OptionChainState;
  hdfcbankOptionChain: OptionChainState;
  relianceOptionChain: OptionChainState;
  icicibankOptionChain: OptionChainState;
  customStockOptionChain: OptionChainState;
  customStockSymbol: string;
  optionChain:      OptionChainState;
  connectionStatus: ConnectionStatus;
  isSimulating:     boolean;
  fyersConfig:      FyersConfig;
  lastFyersError:   string;
  fyersAuthorized:  boolean;
  alerts:           AlertRule[];
  triggeredAlerts:  TriggeredAlert[];
}

const initialOptionChain = (): OptionChainState => ({
  expiryList:       [],
  selectedExpiry:   "",
  strikes:          [],
  totalCallOi:      0,
  totalPutOi:       0,
  indiaVix:         0,
  spotPrice:        0,
  spotChange:       0,
  spotChangePct:    0,
  highPrice:        0,
  lowPrice:         0,
  lastSnapshotTime: null,
  isLive:           false,
});

export const marketState: MarketStateType = {
  niftyStocks:  {},
  sensexStocks: {},
  bankniftyStocks: {},
  niftySpot:  0,
  sensexSpot: 0,
  bankniftySpot: 0,
  niftyHistory:  { high: 0, low: 0, prevClose: 0 },
  sensexHistory: { high: 0, low: 0, prevClose: 0 },
  bankniftyHistory: { high: 0, low: 0, prevClose: 0 },
  niftyBackup:       {},
  sensexBackup:      {},
  bankniftyBackup:   {},
  niftyTimedBackup:  {},
  sensexTimedBackup: {},
  bankniftyTimedBackup: {},
  niftyOptionChain:  initialOptionChain(),
  sensexOptionChain: initialOptionChain(),
  bankniftyOptionChain: initialOptionChain(),
  hdfcbankOptionChain: initialOptionChain(),
  relianceOptionChain: initialOptionChain(),
  icicibankOptionChain: initialOptionChain(),
  customStockOptionChain: initialOptionChain(),
  customStockSymbol: "",
  get optionChain() {
    return this.niftyOptionChain;
  },
  set optionChain(val) {
    this.niftyOptionChain = val;
  },
  connectionStatus: "DISCONNECTED",
  isSimulating:     true,
  fyersConfig: {
    app_id:       "R8T7ETPIPG-100",
    secret_key:   "I83VB7I7VP",
    redirect_uri: "http://127.0.0.1:3000",
    access_token: "",
  },
  lastFyersError:  "",
  fyersAuthorized: false,
  alerts:          [],
  triggeredAlerts: [],
};
