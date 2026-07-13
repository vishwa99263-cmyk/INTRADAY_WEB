export interface StockData {
  symbol: string;
  ticker: string;
  ltp: number;
  changePercent: number;
  prevClose: number;
  volume: number;
  vwap?: number;
  weightage: number;
  score: number;
  backupScore: number;
  scoreDifference: number;
  ltpBackup: number;
  high?: number;
  low?: number;
  open?: number;
  change?: number;
  lastTradedTime?: string | number;

  // 15-minute backup columns (P & Q)
  score15m: number;
  score15mDiff: number;

  // 30-minute backup columns (R & S)
  score30m: number;
  score30mDiff: number;

  // 1-hour backup columns (T & U)
  score1h: number;
  score1hDiff: number;
}

export interface OptionStrike {
  strikePrice: number;
  ceVolume: number;
  ceOI: number;
  ceOIChange: number;
  ceLtp: number;
  ceChg: number;
  ceBid?: number;
  ceAsk?: number;
  ceIV?: number;
  ceDelta?: number;
  ceGamma?: number;
  ceTheta?: number;
  ceVega?: number;
  peVolume: number;
  peOI: number;
  peOIChange: number;
  peLtp: number;
  peChg: number;
  peBid?: number;
  peAsk?: number;
  peIV?: number;
  peDelta?: number;
  peGamma?: number;
  peTheta?: number;
  peVega?: number;
}

export interface OptionChainSummary {
  spotPrice: number;
  prevClose: number;
  high: number;
  low: number;
  atmStrike: number;
  pcr: number;
  callOI: number;
  callOIChange: number;
  callPressure: number;
  callMomentum: number;
  callAveragePremiumChange: number;
  callStrength: number;
  putOI: number;
  putOIChange: number;
  putMomentum: number;
  putAveragePremiumChange: number;
  putStrength: number;
  oiDifference: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
  rStrength: number;
  sStrength: number;
}

export interface BackupSnapshots {
  [symbol: string]: {
    [time: string]: number; // e.g., "09:15": score
  };
}

/** Persisted timed backup store — keyed by triggerKey (e.g. "15m:09:15") */
export interface TimedBackupStore {
  [triggerKey: string]: {
    [symbol: string]: number; // symbol → score snapshot
  };
}

export interface SheetState {
  niftyStocks: StockData[];
  sensexStocks: StockData[];
  bankniftyStocks: StockData[];
  niftyBackup: BackupSnapshots;
  sensexBackup: BackupSnapshots;
  bankniftyBackup: BackupSnapshots;
  niftyOptionChain: OptionStrike[];
  sensexOptionChain: OptionStrike[];
  bankniftyOptionChain: OptionStrike[];
  niftySpot: number;
  sensexSpot: number;
  bankniftySpot: number;
  niftyHistory: { high: number; low: number; prevClose: number };
  sensexHistory: { high: number; low: number; prevClose: number };
  bankniftyHistory: { high: number; low: number; prevClose: number };
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | "HDFCBANK" | "RELIANCE" | "ICICIBANK" | "CUSTOM_STOCK";
  activeTab: "LIVE" | "STOCK" | "BACKUP";
  darkMode: boolean;
  fyersConnected: boolean;
  fyersAuthorized: boolean;
  isSimulating: boolean;
}

export const TIME_COLUMNS = (() => {
  const cols = [];
  let h = 9, m = 0;
  while (h < 15 || (h === 15 && m <= 30)) {
    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    cols.push(timeStr);
    m += 5;
    if (m >= 60) {
      m = 0;
      h += 1;
    }
  }
  return cols;
})();

// ── New Streaming Architecture Types ─────────────────────────────────────────

export type ConnectionStatus = "LIVE" | "RECONNECTING" | "DISCONNECTED" | "EXPIRED";

export interface WeightedSummary {
  top10Sum:     number;
  next15Sum:    number;
  remainingSum: number;
  totalSum:     number;
  advances:     number;
  declines:     number;
  unchanged:    number;
  next12Sum?:   number;
}

/** Full option strike row with live CE/PE data + Greeks */
export interface OptionStrikeData {
  strikePrice: number;
  ceSymbol: string; peSymbol: string;
  ceLtp: number;  ceBid: number;  ceAsk: number;
  ceVolume: number; ceOI: number; ceOIChange: number; ceOIChangePct: number;
  ceLtpChgPct: number;
  ceDelta: number; ceGamma: number; ceTheta: number; ceVega: number; ceIV: number;
  peLtp: number;  peBid: number;  peAsk: number;
  peVolume: number; peOI: number; peOIChange: number; peOIChangePct: number;
  peLtpChgPct: number;
  peDelta: number; peGamma: number; peTheta: number; peVega: number; peIV: number;
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

/** Option chain state pushed from server via market-update */
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
  monthlyExpiry?:   string;
  nextWeeklyExpiry?: string;
  monthlyMetrics?:  CalculatedChainMetrics;
  nextWeeklyMetrics?: CalculatedChainMetrics;
}

/** Full payload emitted by the server's market-update event */
export interface MarketUpdatePayload {
  niftyStocks:       StockData[];
  sensexStocks:      StockData[];
  bankniftyStocks?:  StockData[];
  niftySpot:         number;
  sensexSpot:        number;
  bankniftySpot?:    number;
  niftyHistory:      { high: number; low: number; prevClose: number };
  sensexHistory:     { high: number; low: number; prevClose: number };
  bankniftyHistory?: { high: number; low: number; prevClose: number };
  niftyBackup:       BackupSnapshots;
  sensexBackup:      BackupSnapshots;
  bankniftyBackup?:  BackupSnapshots;
  niftyTimedBackup:  TimedBackupStore;
  sensexTimedBackup: TimedBackupStore;
  bankniftyTimedBackup?: TimedBackupStore;
  niftyOptionChain:  OptionChainState;
  sensexOptionChain: OptionChainState;
  bankniftyOptionChain?: OptionChainState;
  hdfcbankOptionChain?: OptionChainState;
  relianceOptionChain?: OptionChainState;
  icicibankOptionChain?: OptionChainState;
  customStockOptionChain?: OptionChainState;
  customStockSymbol?: string;
  optionChain?:      OptionChainState;
  connectionStatus:  ConnectionStatus;
  serverTime:        number;
  isSimulating:      boolean;
  fyersAuthorized:   boolean;
  fyersConfig: {
    app_id:       string;
    redirect_uri: string;
    access_token: string;
  };
  lastFyersError: string;
  niftySummary:   WeightedSummary;
  sensexSummary:  WeightedSummary;
  bankniftySummary?: WeightedSummary;
}

// ── Advance AI Type Definitions ──────────────────────────────────────────────

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

// BreakoutState is now defined above with extended fields

export interface MomentumStateResult {
  momentumScore: number;
  momentumLabel: "STRONG_MOMENTUM" | "NORMAL_MOMENTUM" | "LOW_MOMENTUM";
  hasVolumeSpike: boolean;
  hasBigCandle: boolean;
  hasFollowThrough: boolean;
  direction: "UP" | "DOWN" | "NONE";
}

export interface AIStrategySetup {
  strategyName: string;
  signalType: "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE_ZONE";
  recommendedStrike: string;
  recommendedPremium: number;
  stopLoss: number;
  target: number;
  confidencePct: number;
  winRateGrade: "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  setupDetails: string;
  // Layer 7 additions
  stopLossType: "PREMIUM_BASED" | "LEVEL_BASED";
  levelBasedSL: number;
  riskRewardRatio: number;
  positionSizeGrade: "FULL" | "HALF" | "QUARTER";
  reasoning: string;
}

export interface TrendAnalysisResult {
  trend5m: "BULLISH" | "BEARISH" | "SIDEWAYS";
  trend15m: "BULLISH" | "BEARISH" | "SIDEWAYS";
  trend30m: "BULLISH" | "BEARISH" | "SIDEWAYS";
  trend1h: "BULLISH" | "BEARISH" | "SIDEWAYS";
  overall: "BULLISH" | "BEARISH" | "SIDEWAYS";
  alignment: "HIGH_CONFIDENCE_BUY" | "HIGH_CONFIDENCE_SELL" | "MIXED";
  strengthPct: number;
  isReversal: boolean;
  reversalType: "BULLISH_REVERSAL" | "BEARISH_REVERSAL" | "NONE";
  // Layer 2: Market Structure
  structureType: "UPTREND" | "DOWNTREND" | "RANGE_BOUND" | "TRANSITION";
  higherHighs: boolean;
  lowerLows: boolean;
  keyLevel: number;
}

export interface StrikeBuildup {
  strikePrice: number;
  ceBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
  peBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
}

export interface OiAnalysisResult {
  pcr: number;
  sentiment: "BULLISH" | "BEARISH" | "SIDEWAYS" | "STRONG_BULLISH" | "STRONG_BEARISH";
  resistanceWall: number;
  resistanceOi: number;
  supportWall: number;
  supportOi: number;
  maxPainStrike: number;
  buildups: StrikeBuildup[];
  netCeBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
  netPeBuildup: "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NONE";
}

export interface StrikeVolumeFlag {
  strikePrice: number;
  ceVolumeSpike: boolean;
  peVolumeSpike: boolean;
}

export interface VolumeAnalysisResult {
  totalCeVolume: number;
  totalPeVolume: number;
  volumeRatio: number;
  volumeBias: "CE_DOMINATED" | "PE_DOMINATED" | "BALANCED";
  avgStrikeCeVolume: number;
  avgStrikePeVolume: number;
  strikeFlags: StrikeVolumeFlag[];
  hasMajorCeSpike: boolean;
  hasMajorPeSpike: boolean;
}

export interface RecommendedStrike {
  strikePrice: number;
  symbol: string;
  premium: number;
  quality: "HIGH" | "MEDIUM" | "LOW_PREMIUM";
}

export interface StrikeSelectionResult {
  atmStrike: number;
  recommendedCe: RecommendedStrike | null;
  recommendedPe: RecommendedStrike | null;
  volatilityExpansion: boolean;
  volatilityReason: string;
}

export interface CompleteMarketReport {
  trend: TrendAnalysisResult;
  oi: OiAnalysisResult;
  volume: VolumeAnalysisResult;
  speed: {
    velocity: number;
    marketState: "FAST_MARKET" | "SLOW_MARKET";
    momentumState: "HIGH_MOMENTUM" | "LOW_MOMENTUM";
    accelerating: boolean;
    priceActionGrade: "STRONG" | "MODERATE" | "WEAK";
  };
  strikes: StrikeSelectionResult;
  timestamp: number;
}

// ── Smart Money Engine Types ─────────────────────────────────────────────────
export type SmartMoneyDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type SmartMoneyEventType =
  | "LARGE_OI_SHIFT" | "PCR_DIVERGENCE" | "SWEEP_ORDER"
  | "ACCUMULATION" | "DISTRIBUTION" | "NONE";

export interface SmartMoneySignal {
  direction: SmartMoneyDirection;
  confidence: number;
  eventType: SmartMoneyEventType;
  detail: string;
  institutionalBias: "BUYING" | "SELLING" | "HEDGING" | "NEUTRAL";
  reasoning: string;
}

// ── Strategy Alignment Types ─────────────────────────────────────────────────
export type AlignmentGrade = "FULL_ALIGNMENT" | "PARTIAL_ALIGNMENT" | "CONFLICTING" | "NO_SIGNAL";
export type TradeDirection = "BULLISH" | "BEARISH" | "NONE";

export interface StrategyAlignment {
  alignmentScore: number;
  alignmentGrade: AlignmentGrade;
  dominantStrategy: string;
  tradeDirection: TradeDirection;
  strategiesAgreeing: string[];
  strategiesConflicting: string[];
  noTradeFilter: boolean;
  noTradeReason: string;
  reasoning: string;
}

// ── ANTIGRAVITY Decision Engine Types ────────────────────────────────────────
export type SignalGrade = "A" | "B" | "C" | "D";
export type MarketRegime = "TRENDING" | "RANGING" | "VOLATILE" | "EXPIRY_DAY";
export type FinalSignal = "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";

export interface AntigravityDecision {
  finalSignal: FinalSignal;
  signalGrade: SignalGrade;
  antigravityScore: number;       // -100 to +100
  confidence: number;
  marketRegime: MarketRegime;
  activeFilters: string[];
  reasoning: string;
  gradeExplanation: string;
  scoreBreakdown: {
    marketStructure: number;
    smartMoney: number;
    breakoutConfirmation: number;
    momentumStrength: number;
    timeValidity: number;
  };
  timestamp: number;
}

// ── Signal Memory Types ──────────────────────────────────────────────────────
export type SignalOutcome = "WIN" | "LOSS" | "NEUTRAL" | "PENDING";

export interface SignalRecord {
  id: string;
  timestamp: number;
  page: "NIFTY" | "SENSEX" | "BANKNIFTY";
  signal: string;
  grade: string;
  score: number;
  spotAtSignal: number;
  outcome: SignalOutcome;
  spotAtOutcome?: number;
  pnlPct?: number;
}

export interface SignalMemoryStats {
  totalSignals: number;
  wins: number;
  losses: number;
  neutral: number;
  winRate: number;
  recentWinRate: number;
  confidenceMultiplier: number;
  lastUpdated: number;
}

// ── Backtest Engine Types ────────────────────────────────────────────────────
export interface BacktestResult {
  page: "NIFTY" | "SENSEX" | "BANKNIFTY";
  totalSignals: number;
  estimatedWins: number;
  estimatedLosses: number;
  estimatedWinRate: number;
  strategyBreakdown: {
    strategyName: string;
    signals: number;
    estimatedWinRate: number;
  }[];
  lastRunAt: number;
  reasoning: string;
}

export interface BreakoutState {
  high5m: number;
  low5m: number;
  high15m: number;
  low15m: number;
  rangeEstablished5m: boolean;
  rangeEstablished15m: boolean;
  breakoutType: "BULLISH_BREAKOUT" | "BEARISH_BREAKDOWN" | "FAKE_BREAKOUT" | "NONE";
  breakoutStatus: string;
  trapProbability: number;
  trapType: "BULL_TRAP" | "BEAR_TRAP" | "FALSE_BREAKOUT" | "NONE";
  reasoning: string;
}

export interface AIAnalysisPayload {
  page: "NIFTY" | "SENSEX" | "BANKNIFTY";
  report: CompleteMarketReport;
  breakout: BreakoutState;
  momentum: MomentumStateResult;
  expirySetup: AIStrategySetup;
  alerts: AIAlert[];
  // ANTIGRAVITY new fields
  smartMoney: SmartMoneySignal;
  alignment: StrategyAlignment;
  antigravity: AntigravityDecision;
  signalMemory: SignalMemoryStats;
  signalHistory: SignalRecord[];
  backtest: BacktestResult | null;
  aiEngineV2?: any;
  crashState?: { isMacroCrash: boolean; reason: string };
}

export interface AlertRule {
  id: string;
  type: "SPOT_PRICE" | "CE_PREMIUM" | "PE_PREMIUM" | "NET_SCORE" | "OI_DIFFERENCE" | "PCR" | "MOMENTUM_SCORE";
  instrument: "NIFTY" | "SENSEX" | "BANKNIFTY";
  strike?: number;
  condition: "ABOVE" | "BELOW" | "TOUCH";
  targetValue: number;
  note: string;
  sound: "SIREN" | "MARKET_BELL" | "TRADING_ALERT" | "WARNING_ALARM";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  enabled: boolean;
  createdAt: number;
  triggered: boolean;
  autoResetOption?: "1m" | "5m" | "manual";
  lastTriggeredAt?: number;
}

export interface TriggeredAlert {
  id: string;
  alertId: string;
  title: string;
  message: string;
  value: number;
  instrument: "NIFTY" | "SENSEX" | "BANKNIFTY";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sound: "SIREN" | "MARKET_BELL" | "TRADING_ALERT" | "WARNING_ALARM";
  timestamp: number;
  note: string;
}

export interface TEPaperTrade {
  id: string;
  timestamp: number;
  instrument: string;
  direction: "BUY_CE" | "BUY_PE" | "BULL_SPREAD" | "BEAR_SPREAD";
  strike: number;
  entry_price: number;
  qty: number;
  lot_size: number;
  stop_loss: number;
  target: number;
  exit_price?: number;
  status: "OPEN" | "CLOSED";
  pnl: number;
  notes: string;
  signal_ref?: string;
  created_at: number;
  closed_at?: number;
  
  // Dual-compatibility fields
  entryPrice?: number;
  strategyName?: string;
  confidence?: number;
}
