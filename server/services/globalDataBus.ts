/**
 * globalDataBus.ts
 * ═══════════════════════════════════════════════════════════════════════
 * AMEX v3.0 — Central Global Data Bus (Operator / Singleton)
 *
 * This is the SINGLE SOURCE OF TRUTH for all real-time data across
 * the entire trading platform.
 *
 * Architecture:
 *  - Server-side singleton (runs 24/7, never stops)
 *  - ALL engines write here when they produce data
 *  - The Strategy Dispatcher reads from here
 *  - Client gets snapshots via /api/te/global-state
 *  - WebSocket clients get live push on every update
 *
 * Data Sources Connected:
 *  ✓ TradingEngine L1–L17 (all engine outputs)
 *  ✓ StockAnalysis (sector strength, top movers)
 *  ✓ AdvanceAI (AI signal and confidence)
 *  ✓ LiveOptionChain (PCR, OI walls, max pain)
 *  ✓ MarketBreadth (A/D ratio, advance-decline)
 *  ✓ SmartMoney (FII/DII flow)
 *  ✓ Reversal Indicators (R01–R12)
 *  ✓ Self-Learning Layer Weights
 */

import { EventEmitter } from "events";
import fs from "fs";
import path from "path";

// ── Types ──────────────────────────────────────────────────────────────

export interface SectorStrength {
  sector:      string;
  bullish:     number;  // % stocks bullish
  score:       number;  // 0–100
  topStock:    string;
}

export interface StockSignal {
  symbol:      string;
  direction:   "BULLISH" | "BEARISH" | "NEUTRAL";
  score:       number;   // 0–100
  reason:      string;
}

export interface GlobalDataState {
  // ── Metadata ──────────────────────────────────────────────────────
  lastUpdated:           number;          // Timestamp ms
  dataQuality:           number;          // 0–100 (how fresh/complete)
  marketOpen:            boolean;

  // ── L1: Market Regime ─────────────────────────────────────────────
  regime:                string;          // TRENDING_BULL, RANGE etc.
  regimeConfidence:      number;          // 0–100
  regimeReasons:         string[];

  // ── L2: Market Breadth ────────────────────────────────────────────
  breadthScore:          number;          // 0–100
  advanceCount:          number;
  declineCount:          number;
  adRatio:               number;

  // ── L3: Momentum ──────────────────────────────────────────────────
  momentumScore:         number;          // 0–100
  momentumDirection:     "UP" | "DOWN" | "FLAT";
  momentumExhaustion:    boolean;

  // ── L4: 15M Range ─────────────────────────────────────────────────
  rangeHigh:             number;
  rangeLow:              number;
  rangeBreakout:         boolean;
  rangeBreakdown:        boolean;

  // ── L5: Option Chain ──────────────────────────────────────────────
  pcr:                   number;          // Put-Call Ratio
  maxPain:               number;          // Max Pain level
  atmIV:                 number;          // ATM Implied Volatility
  oiWallCE:              number;          // Strongest CE resistance
  oiWallPE:              number;          // Strongest PE support
  indiaVix:              number;

  // ── L6: Option Flow ───────────────────────────────────────────────
  ceFlowScore:           number;          // 0–100 CE buying pressure
  peFlowScore:           number;          // 0–100 PE buying pressure
  ivSkew:                number;          // Skew CE-PE IV diff

  // ── L7: Smart Money (FII/DII) ─────────────────────────────────────
  smartMoneyScore:       number;          // 0–100
  fiiNetBuy:             number;          // ₹ crore
  diiNetBuy:             number;          // ₹ crore
  smartMoneyDirection:   "BUY" | "SELL" | "NEUTRAL";

  // ── L8: Pattern Recognition ────────────────────────────────────────
  patternScore:          number;          // 0–100
  detectedPattern:       string;          // e.g. "Bullish Engulfing"
  patternDirection:      "BULLISH" | "BEARISH" | "NEUTRAL";

  // ── L9: Probability ───────────────────────────────────────────────
  probabilityScore:      number;          // 0–100 win probability

  // ── L10: Entry Zone ───────────────────────────────────────────────
  entryZoneScore:        number;          // 0–100 (how good is entry zone)
  entryZoneType:         string;          // e.g. "VWAP Bounce", "EMA Support"

  // ── L11: Strategy Alignment ────────────────────────────────────────
  alignmentScore:        number;          // 0–100 multi-layer alignment

  // ── L12: AI Brain Decision ────────────────────────────────────────
  aiConfidence:          number;          // 0–100
  aiDirection:           "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";
  aiReasons:             string[];
  aiScore:               number;          // Raw AI score

  // ── Session / Market Time ─────────────────────────────────────────
  sessionType:           string;          // OPENING, MID, CLOSING
  isExpiryDay:           boolean;
  currentTime:           string;          // "HH:MM"

  // ── StockAnalysis Tab Data ────────────────────────────────────────
  topBullishStocks:      StockSignal[];   // Top 5 bullish stocks
  topBearishStocks:      StockSignal[];   // Top 5 bearish stocks
  sectorStrength:        SectorStrength[];// Sector breakdown

  // ── AdvanceAI Tab Data ────────────────────────────────────────────
  advanceAISignal:       "BUY" | "SELL" | "HOLD" | null;
  advanceAIScore:        number;          // 0–100
  advanceAIReasons:      string[];

  // ── Market Spot Prices ────────────────────────────────────────────
  niftySpot:             number;
  sensexSpot:            number;
  bankniftySpot:         number;

  // ── Layer Weights (from Self-Learning) ────────────────────────────
  layerWeights:          Record<string, number>;

  // ── Self-Learning State ───────────────────────────────────────────
  selfLearningActive:    boolean;
  selfLearningLastRun:   number;          // Timestamp
  selfLearningInsights:  string[];        // Recent learnings
  totalTradesLearned:    number;

  // ── Governor State ────────────────────────────────────────────────
  governorState:         any | null;      // GovernorState object
}

// ── Default State ─────────────────────────────────────────────────────

export const DEFAULT_GLOBAL_STATE: GlobalDataState = {
  lastUpdated:           0,
  dataQuality:           0,
  marketOpen:            false,
  regime:                "RANGE",
  regimeConfidence:      0,
  regimeReasons:         [],
  breadthScore:          50,
  advanceCount:          0,
  declineCount:          0,
  adRatio:               1,
  momentumScore:         50,
  momentumDirection:     "FLAT",
  momentumExhaustion:    false,
  rangeHigh:             0,
  rangeLow:              0,
  rangeBreakout:         false,
  rangeBreakdown:        false,
  pcr:                   1.0,
  maxPain:               0,
  atmIV:                 0,
  oiWallCE:              0,
  oiWallPE:              0,
  indiaVix:              15,
  ceFlowScore:           50,
  peFlowScore:           50,
  ivSkew:                0,
  smartMoneyScore:       50,
  fiiNetBuy:             0,
  diiNetBuy:             0,
  smartMoneyDirection:   "NEUTRAL",
  patternScore:          50,
  detectedPattern:       "",
  patternDirection:      "NEUTRAL",
  probabilityScore:      50,
  entryZoneScore:        50,
  entryZoneType:         "",
  alignmentScore:        50,
  aiConfidence:          50,
  aiDirection:           "WAIT",
  aiReasons:             [],
  aiScore:               50,
  sessionType:           "MID",
  isExpiryDay:           false,
  currentTime:           "09:30",
  topBullishStocks:      [],
  topBearishStocks:      [],
  sectorStrength:        [],
  advanceAISignal:       null,
  advanceAIScore:        0,
  advanceAIReasons:      [],
  niftySpot:             0,
  sensexSpot:            0,
  bankniftySpot:         0,
  layerWeights:          {},
  selfLearningActive:    false,
  selfLearningLastRun:   0,
  selfLearningInsights:  [],
  totalTradesLearned:    0,
  governorState:         null,
};

// ── Global Data Bus Singleton ──────────────────────────────────────────

class GlobalDataBus extends EventEmitter {
  private state: GlobalDataState = { ...DEFAULT_GLOBAL_STATE };
  private weightsFile = path.join(process.cwd(), "server", "storage", "layer_weights.json");
  private subscribers: Set<(state: GlobalDataState) => void> = new Set();
  private logs: { timestamp: number; level: "info" | "warn" | "error"; message: string }[] = [];

  constructor() {
    super();
    this.setMaxListeners(100);
    this.loadWeights();
    console.log("[GlobalDataBus] 🚀 Central Data Bus initialized");
  }

  // ── Read State ──────────────────────────────────────────────────────
  getState(): GlobalDataState {
    return { ...this.state };
  }

  getField<K extends keyof GlobalDataState>(key: K): GlobalDataState[K] {
    return this.state[key];
  }

  // ── Update State (partial update) ───────────────────────────────────
  update(patch: Partial<GlobalDataState>): void {
    this.state = {
      ...this.state,
      ...patch,
      lastUpdated: Date.now(),
    };
    this.recalcDataQuality();
    this.emit("update", this.state);
    this.notifySubscribers();
  }

  // ── Subscribe to updates ─────────────────────────────────────────────
  subscribe(cb: (state: GlobalDataState) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private notifySubscribers(): void {
    for (const cb of this.subscribers) {
      try { cb(this.state); } catch { /* ignore */ }
    }
  }

  // ── Layer-specific update methods ────────────────────────────────────

  updateRegime(regime: string, confidence: number, reasons: string[]): void {
    this.update({ regime, regimeConfidence: confidence, regimeReasons: reasons });
  }

  updateBreadth(score: number, advance: number, decline: number): void {
    this.update({
      breadthScore: score,
      advanceCount: advance,
      declineCount: decline,
      adRatio: decline > 0 ? advance / decline : 1,
    });
  }

  updateMomentum(score: number, direction: "UP" | "DOWN" | "FLAT", exhaustion: boolean): void {
    this.update({ momentumScore: score, momentumDirection: direction, momentumExhaustion: exhaustion });
  }

  updateOptionChain(pcr: number, maxPain: number, atmIV: number, oiWallCE: number, oiWallPE: number, vix: number): void {
    this.update({ pcr, maxPain, atmIV, oiWallCE, oiWallPE, indiaVix: vix });
  }

  updateSmartMoney(score: number, fiiNet: number, diiNet: number): void {
    const dir = fiiNet > 0 ? "BUY" : fiiNet < 0 ? "SELL" : "NEUTRAL";
    this.update({ smartMoneyScore: score, fiiNetBuy: fiiNet, diiNetBuy: diiNet, smartMoneyDirection: dir });
  }

  updateAIBrain(confidence: number, direction: GlobalDataState["aiDirection"], reasons: string[], rawScore: number): void {
    this.update({ aiConfidence: confidence, aiDirection: direction, aiReasons: reasons, aiScore: rawScore });
  }

  updateAlignment(score: number): void {
    this.update({ alignmentScore: score });
  }

  updateProbability(score: number): void {
    this.update({ probabilityScore: score });
  }

  updateEntryZone(score: number, type: string): void {
    this.update({ entryZoneScore: score, entryZoneType: type });
  }

  updatePattern(score: number, pattern: string, direction: "BULLISH" | "BEARISH" | "NEUTRAL"): void {
    this.update({ patternScore: score, detectedPattern: pattern, patternDirection: direction });
  }

  updateSpots(nifty: number, sensex: number, banknifty: number): void {
    this.update({ niftySpot: nifty, sensexSpot: sensex, bankniftySpot: banknifty });
  }

  updateSession(type: string, isExpiry: boolean, time: string, marketOpen: boolean): void {
    this.update({ sessionType: type, isExpiryDay: isExpiry, currentTime: time, marketOpen });
  }

  // From StockAnalysis tab
  updateStockData(bullish: StockSignal[], bearish: StockSignal[], sectors: SectorStrength[]): void {
    this.update({ topBullishStocks: bullish, topBearishStocks: bearish, sectorStrength: sectors });
  }

  // From AdvanceAI tab
  updateAdvanceAI(signal: GlobalDataState["advanceAISignal"], score: number, reasons: string[]): void {
    this.update({ advanceAISignal: signal, advanceAIScore: score, advanceAIReasons: reasons });
  }

  // Self-learning updates
  updateSelfLearning(active: boolean, insights: string[], totalTrades: number): void {
    this.update({ selfLearningActive: active, selfLearningInsights: insights, totalTradesLearned: totalTrades });
  }

  // Governor state update
  updateGovernor(governorState: any): void {
    this.update({ governorState });
  }

  // ── Layer Weights (persistent) ────────────────────────────────────────

  private loadWeights(): void {
    try {
      if (fs.existsSync(this.weightsFile)) {
        const raw = fs.readFileSync(this.weightsFile, "utf-8");
        const parsed = JSON.parse(raw);
        this.state.layerWeights = parsed.weights ?? {};
        console.log("[GlobalDataBus] ✅ Layer weights loaded from storage");
      }
    } catch {
      console.log("[GlobalDataBus] ℹ️ No weights file, using defaults");
    }
  }

  saveWeights(weights: Record<string, number>): void {
    this.state.layerWeights = weights;
    try {
      fs.writeFileSync(this.weightsFile, JSON.stringify({
        weights,
        updatedAt: Date.now(),
        updatedBy: "self-learning",
      }, null, 2));
      console.log("[GlobalDataBus] 💾 Layer weights saved");
    } catch (e) {
      console.error("[GlobalDataBus] ❌ Failed to save weights:", e);
    }
    this.emit("weightsUpdated", weights);
  }

  getCurrentWeights(): Record<string, number> {
    return { ...this.state.layerWeights };
  }

  // ── Data Quality Score ────────────────────────────────────────────────

  private recalcDataQuality(): void {
    const now = Date.now();
    const age = now - this.state.lastUpdated;
    const freshness = Math.max(0, 100 - Math.floor(age / 1000)); // -1 per second stale
    const completeness = this.checkCompleteness();
    this.state.dataQuality = Math.round((freshness * 0.4 + completeness * 0.6));
  }

  private checkCompleteness(): number {
    let score = 0;
    const s = this.state;
    if (s.regime !== "RANGE" || s.regimeConfidence > 0) score += 15;
    if (s.breadthScore !== 50)                           score += 10;
    if (s.momentumScore !== 50)                          score += 10;
    if (s.pcr !== 1.0 || s.maxPain > 0)                 score += 15;
    if (s.smartMoneyScore !== 50)                        score += 15;
    if (s.aiConfidence !== 50)                           score += 20;
    if (s.alignmentScore !== 50)                         score += 10;
    if (s.niftySpot > 0)                                 score += 5;
    return Math.min(100, score);
  }

  // ── Convert to DispatcherInput format ────────────────────────────────

  toDispatcherInput(indexSymbol: string, optionChain: any[]): Partial<Record<string, any>> {
    const s = this.state;
    return {
      spotPrice:          indexSymbol === "NIFTY" ? s.niftySpot :
                          indexSymbol === "SENSEX" ? s.sensexSpot : s.bankniftySpot,
      indexSymbol,
      indiaVix:           s.indiaVix,
      pcr:                s.pcr,
      aiConfidence:       s.aiConfidence,
      aiDirection:        s.aiDirection,
      regime:             s.regime,
      sessionType:        s.sessionType,
      smartMoneyScore:    s.smartMoneyScore,
      alignmentScore:     s.alignmentScore,
      breadthScore:       s.breadthScore,
      momentumScore:      s.momentumScore,
      patternScore:       s.patternScore,
      probabilityScore:   s.probabilityScore,
      entryZoneScore:     s.entryZoneScore,
      rangeBreakout:      s.rangeBreakout,
      rangeBreakdown:     s.rangeBreakdown,
      momentumExhaustion: s.momentumExhaustion,
      isExpiryDay:        s.isExpiryDay,
      isMarketOpen:       s.marketOpen,
      optionChain,
      layerWeights:       Object.keys(s.layerWeights).length > 0 ? s.layerWeights : undefined,
    };
  }

  // ── Logging System ───────────────────────────────────────────────────

  addLog(message: string, level: "info" | "warn" | "error" = "info"): void {
    const logItem = { timestamp: Date.now(), level, message };
    this.logs.push(logItem);
    if (this.logs.length > 200) {
      this.logs.shift();
    }
    this.emit("log", logItem);
    
    // Also output to normal server console
    const prefix = `[AMEX-${level.toUpperCase()}]`;
    if (level === "error") {
      console.error(prefix, message);
    } else if (level === "warn") {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }
  }

  getLogs(): { timestamp: number; level: "info" | "warn" | "error"; message: string }[] {
    return [...this.logs];
  }
}

// ── Export singleton ───────────────────────────────────────────────────

export const globalBus = new GlobalDataBus();
export type { GlobalDataBus };
