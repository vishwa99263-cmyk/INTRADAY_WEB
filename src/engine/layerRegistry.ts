/**
 * layerRegistry.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Trading Intelligence System — Layer Architecture Registry
 *
 * Central registry for all 16 analysis layers.
 * Every layer must register here before implementation.
 *
 * Rules:
 *   1. Do NOT modify READY layers.
 *   2. Each layer declares its inputs, outputs, and consumers.
 *   3. New layers connect to existing outputs — never break upstream contracts.
 *   4. Status transitions: WAITING → IN_PROGRESS → READY
 */

// ── Layer Status ──────────────────────────────────────────────────────────────

export type LayerStatus = "READY" | "IN_PROGRESS" | "WAITING";

// ── Layer Definition ──────────────────────────────────────────────────────────

export interface LayerDefinition {
  id: number;
  name: string;
  engineFile: string | null;       // src/engine/<file>.ts  (null = not yet created)
  cardFile: string | null;         // src/components/<file>.tsx
  status: LayerStatus;
  description: string;
  consumes: number[];              // Layer IDs this layer reads from
  produces: string[];              // Output fields exposed to downstream
  consumedBy: number[];            // Layer IDs that will read this layer's output
  tips?: {                         // Specific bullish and bearish tips
    bullish: string;
    bearish: string;
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const LAYER_REGISTRY: LayerDefinition[] = [
  {
    id: 1,
    name: "Market Regime Engine",
    engineFile: "src/engine/marketRegimeEngine.ts",
    cardFile: "src/components/MarketRegimeCard.tsx",
    status: "READY",
    description:
      "Classifies market into 6 regimes: TRENDING_BULL, TRENDING_BEAR, BREAKOUT, BREAKDOWN, RANGE, VOLATILE. " +
      "Uses spot vs 15M range, score alignment, PCR, and A/D ratio.",
    consumes: [],
    produces: [
      "regime",        // MarketRegime enum
      "confidence",    // 0–100
      "reasons",       // string[]
      "diagnostics",   // Record<MarketRegime, number>
    ],
    consumedBy: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    tips: {
      bullish: "Regime is TRENDING_BULL or BREAKOUT. Spot remains above VWAP and EMA bounds.",
      bearish: "Regime is TRENDING_BEAR or BREAKDOWN. Spot remains below VWAP and EMA bounds."
    }
  },
  {
    id: 2,
    name: "Market Breadth Engine",
    engineFile: "src/engine/marketBreadthEngine.ts",
    cardFile: "src/components/MarketBreadthCard.tsx",
    status: "READY",
    description:
      "Measures true stock participation behind index moves. " +
      "Detects divergences between index direction and breadth health. " +
      "5-component weighted score: ADR (30%), Participation (20%), Top25 (20%), Weighted (20%), Momentum (10%).",
    consumes: [1],
    produces: [
      "breadthScore",           // 0–100
      "breadthBias",            // BULLISH | BEARISH | NEUTRAL
      "breadthHealth",          // HEALTHY | MODERATE | WEAK | VERY_WEAK
      "adr",                    // 0–1
      "divergence",             // string alert
      "divergenceType",         // enum
      "topContributors",        // StockContributor[]
      "bottomContributors",     // StockContributor[]
      "components",             // sub-scores
    ],
    consumedBy: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    tips: {
      bullish: "Advances exceed Declines significantly (ADR > 1). Breadth Score > 60% with positive flows.",
      bearish: "Declines exceed Advances significantly (ADR < 1). Breadth Score < 40% with negative flows."
    }
  },
  {
    id: 3,
    name: "Heavyweight Engine",
    engineFile: "src/engine/heavyweightEngine.ts",
    cardFile: "src/components/TradingEngine/pages/HeavyweightCard.tsx",
    status: "READY",
    description:
      "Measures heavyweight stock impact on index movement. " +
      "Identifies bullish/bearish pressure from top-weighted stocks, concentration risk, " +
      "and special trio impact (HDFCBANK, ICICIBANK, RELIANCE).",
    consumes: [1, 2],
    produces: [
      "heavyweightScore",
      "heavyweightDirection",
      "heavyweightPressure",
      "concentrationScore",
      "specialHeavyweightImpact",
      "topHeavyweightImpact",
    ],
    consumedBy: [8, 9, 10, 11, 12],
    tips: {
      bullish: "Heavyweight score > 60%. Key movers (Reliance, HDFC Bank, ICICI Bank) are green.",
      bearish: "Heavyweight score < 40%. Key movers (Reliance, HDFC Bank, ICICI Bank) are red."
    }
  },
  {
    id: 4,
    name: "First 15M Range Engine",
    engineFile: "src/engine/range15mEngine.ts",
    cardFile: "src/components/TradingEngine/pages/Range15MCard.tsx",
    status: "READY",
    description:
      "Institutional opening range analysis (09:15–09:30). " +
      "Detects breakout, breakdown, false breakouts, range quality, " +
      "trend day probability, and range confidence.",
    consumes: [1, 2, 3],
    produces: [
      "rangeHigh",
      "rangeLow",
      "rangeWidth",
      "rangeQuality",
      "spotPosition",
      "rangeBreakout",
      "rangeBreakdown",
      "falseBreakout",
      "trendDayProbability",
      "rangeConfidence",
    ],
    consumedBy: [8, 9, 10, 11, 12, 13, 14],
    tips: {
      bullish: "Spot breaches and sustains above the 15M Range High level on expanding volume.",
      bearish: "Spot breaches and sustains below the 15M Range Low level on expanding volume."
    }
  },
  {
    id: 5,
    name: "Option Chain Engine",
    engineFile: "src/engine/optionChainEngine.ts",
    cardFile: "src/components/TradingEngine/pages/OptionChainCard.tsx",
    status: "READY",
    description:
      "Institutional option chain intelligence — PCR, OI walls, Max Pain, Smart Money Flow, " +
      "OI writing/unwinding patterns. Converts raw option chain into institutional intent signal.",
    consumes: [1, 2, 3, 4],
    produces: [
      "pcr",
      "pcrScore",
      "oiWalls",
      "maxPain",
      "smartMoneyDirection",
      "smartMoneyScore",
      "oiWritingUnwinding",
      "optionChainScore",
      "institutionalBias",
      "liquidityZones",
    ],
    consumedBy: [6, 7, 8, 9, 10, 11, 12],
    tips: {
      bullish: "PCR rises (> 1.0) indicating Put writing. Call unwinding (CE OI decrease) observed at ATM.",
      bearish: "PCR falls (< 0.9) indicating Call writing. Put unwinding (PE OI decrease) observed at ATM."
    }
  },
  {
    id: 6,
    name: "Momentum Engine",
    engineFile: "src/engine/momentumEngine.ts",
    cardFile: "src/components/TradingEngine/pages/MomentumCard.tsx",
    status: "READY",
    description:
      "Acceleration + Speed layer — measures price momentum, volume conviction, breakout sustainability. " +
      "Detects real momentum vs fake spikes, exhaustion traps, and fresh institutional breakout ignition.",
    consumes: [1, 2, 3, 4, 5],
    produces: [
      "momentumScore",
      "momentumDirection",
      "acceleration",
      "volumeConviction",
      "freshMomentumDetected",
      "exhaustion",
      "momentumGrade",
      "rangeInfluence",
      "optionChainInfluence",
    ],
    consumedBy: [7, 8, 9, 10, 11, 12],
    tips: {
      bullish: "Momentum Score > 60. Fresh momentum detected (UP direction) with high volume conviction.",
      bearish: "Momentum Score < 40. Fresh momentum detected (DOWN direction) with high volume conviction."
    }
  },
  {
    id: 7,
    name: "Smart Money Engine",
    engineFile: "src/engine/smartMoneyEngine.ts",
    cardFile: "src/components/TradingEngine/pages/SmartMoneyCard.tsx",
    status: "READY",
    description:
      "Institutional flow detection — OI put/call writing, volume spikes, score acceleration. " +
      "Detects ACCUMULATION / DISTRIBUTION / TRAP zones with override signal mechanism.",
    consumes: [1, 2, 3, 4, 5, 6],
    produces: [
      "smartMoneyScore",
      "flowDirection",
      "institutionalBias",
      "trapType",
      "confidence",
      "overrideSignal",
      "scoreCandleOutput",
    ],
    consumedBy: [8, 9, 10, 11, 12],
    tips: {
      bullish: "Institutional Accumulation pattern detected. Flow direction is BULLISH on block trades.",
      bearish: "Institutional Distribution pattern detected. Flow direction is BEARISH on block trades."
    }
  },
  {
    id: 8,
    name: "Probability Engine",
    engineFile: "src/engine/probabilityEngine.ts",
    cardFile: "src/components/TradingEngine/pages/ProbabilityCard.tsx",
    status: "READY",
    description:
      "First decision-quantification layer — 7-factor weighted CE vs PE probability model. " +
      "Trap override, setup quality grading (STRONG/MODERATE/WEAK/NO_TRADE), institutional PCR rules.",
    consumes: [1, 2, 3, 4, 5, 6, 7, 17],
    produces: [
      "ceProbability",
      "peProbability",
      "dominantSide",
      "confidenceLevel",
      "marketBias",
      "setupQuality",
      "trapOverride",
    ],
    consumedBy: [9, 10, 11, 12],
    tips: {
      bullish: "CE Probability > 60%. Setup quality is STRONG/MODERATE with no trap alerts.",
      bearish: "PE Probability > 60%. Setup quality is STRONG/MODERATE with no trap alerts."
    }
  },
  {
    id: 9,
    name: "Entry Zone Engine",
    engineFile: "src/engine/entryZoneEngine.ts",
    cardFile: "src/components/TradingEngine/pages/EntryZoneCard.tsx",
    status: "READY",
    description:
      "First execution-level precision layer — converts probability into entry zone, stop loss, target, " +
      "risk/reward ratio. Supports breakout/breakdown/range edge entry modes.",
    consumes: [1, 2, 3, 4, 5, 6, 7, 8],
    produces: [
      "entryZone",
      "entryPrice",
      "stopLoss",
      "target",
      "riskReward",
      "rrQuality",
      "entryConfidence",
      "entryMode",
    ],
    consumedBy: [10, 11, 12, 14],
    tips: {
      bullish: "Spot trades inside optimal BUY CE Entry Zone. High Risk-to-Reward ratio (R:R > 1.5).",
      bearish: "Spot trades inside optimal BUY PE Entry Zone. High Risk-to-Reward ratio (R:R > 1.5)."
    }
  },
  {
    id: 10,
    name: "Strategy Alignment Engine",
    engineFile: "src/engine/strategyAlignmentEngine.ts",
    cardFile: "src/components/TradingEngine/pages/StrategyAlignmentCard.tsx",
    status: "READY",
    description:
      "Cross-validates all engine outputs and determines if conditions align for a trade. " +
      "Requires minimum alignment score before generating signals.",
    consumes: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    produces: [
      "alignmentScore",
      "alignedLayers",
      "conflictingLayers",
      "tradeReadiness",
    ],
    consumedBy: [11, 12, 14],
    tips: {
      bullish: "Alignment Score > 60% with dominant BULLISH votes from L1-L9. No critical conflicts.",
      bearish: "Alignment Score > 60% with dominant BEARISH votes from L1-L9. No critical conflicts."
    }
  },
  {
    id: 11,
    name: "AI Decision Engine",
    engineFile: "src/engine/aiDecisionEngine.ts",
    cardFile: "src/components/TradingEngine/pages/AIDecisionCard.tsx",
    status: "READY",
    description:
      "Final AI-driven decision layer. Synthesizes all 10 upstream engines into a single " +
      "BUY_CE / BUY_PE / WAIT / NO_TRADE decision with confidence and reasoning.",
    consumes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17],
    produces: [
      "finalDecision",
      "decisionConfidence",
      "decisionGrade",
      "reasoning",
      "riskAssessment",
    ],
    consumedBy: [12, 13, 14],
    tips: {
      bullish: "Decision is BUY_CE with Grade A/B and Confidence > 70% based on full layout alignment.",
      bearish: "Decision is BUY_PE with Grade A/B and Confidence > 70% based on full layout alignment."
    }
  },
  {
    id: 12,
    name: "Opportunity Engine",
    engineFile: "src/engine/opportunityEngine.ts",
    cardFile: "src/components/TradingEngine/pages/OpportunityCard.tsx",
    status: "READY",
    description:
      "Scans for high-probability trading opportunities across all analysis layers. " +
      "Ranks and prioritizes setups.",
    consumes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    produces: [
      "opportunities",
      "topOpportunity",
      "opportunityScore",
    ],
    consumedBy: [13, 14],
    tips: {
      bullish: "CE Opportunity ranks #1 with high setup score and optimal entry condition.",
      bearish: "PE Opportunity ranks #1 with high setup score and optimal entry condition."
    }
  },
  {
    id: 13,
    name: "Strategies Module",
    engineFile: "src/engine/strategiesEngine.ts",
    cardFile: "src/components/TradingEngine/pages/StrategiesCard.tsx",
    status: "READY",
    description:
      "Pre-defined and custom trading strategies. " +
      "Maps AI decisions and opportunities to specific strategy templates.",
    consumes: [11, 12],
    produces: [
      "activeStrategy",
      "strategySignals",
      "strategyPerformance",
    ],
    consumedBy: [14, 15],
    tips: {
      bullish: "Active strategy is CE-biased (e.g. Range Breakout CE, Pullback CE trigger active).",
      bearish: "Active strategy is PE-biased (e.g. Range Breakdown PE, Pullback PE trigger active)."
    }
  },
  {
    id: 14,
    name: "Paper Trading Engine",
    engineFile: "src/engine/paperTradingEngine.ts",
    cardFile: "src/components/TradingEngine/pages/PaperTradingCard.tsx",
    status: "READY",
    description:
      "Executes virtual trades based on AI decisions. " +
      "Tracks positions, P&L, and trade history with DB persistence.",
    consumes: [9, 10, 11, 12, 13],
    produces: [
      "openPositions",
      "closedTrades",
      "dailyPnL",
      "tradeHistory",
    ],
    consumedBy: [15, 16],
    tips: {
      bullish: "CE Paper trade executed successfully at optimal entry. Trailing SL and Targets active.",
      bearish: "PE Paper trade executed successfully at optimal entry. Trailing SL and Targets active."
    }
  },
  {
    id: 15,
    name: "Performance Engine",
    engineFile: "src/engine/performanceEngine.ts",
    cardFile: "src/components/TradingEngine/pages/PerformanceCard.tsx",
    status: "READY",
    description:
      "Tracks and analyzes trading performance metrics — win rate, profit factor, " +
      "drawdown, Sharpe ratio, and cumulative P&L.",
    consumes: [14],
    produces: [
      "winRate",
      "profitFactor",
      "maxDrawdown",
      "sharpeRatio",
      "cumulativePnL",
    ],
    consumedBy: [16],
    tips: {
      bullish: "Win rate > 60% and rising profit factor observed on CE execution cycles.",
      bearish: "Win rate > 60% and rising profit factor observed on PE execution cycles."
    }
  },
  {
    id: 16,
    name: "Risk Engine",
    engineFile: "src/engine/riskEngine.ts",
    cardFile: "src/components/TradingEngine/pages/RiskCard.tsx",
    status: "READY",
    description:
      "Real-time risk management — position sizing, daily loss limits, consecutive loss tracking, " +
      "and circuit breakers.",
    consumes: [14, 15],
    produces: [
      "riskScore",
      "positionSize",
      "dailyLossRemaining",
      "circuitBreakerActive",
    ],
    consumedBy: [],
    tips: {
      bullish: "Risk score is low/moderate. Position sizing is standard (Full/Half) with safe limits.",
      bearish: "Risk score is high. Position sizing reduced (Quarter) or circuit breaker active (Halt)."
    }
  },
  {
    id: 17,
    name: "Institutional Macro Engine",
    engineFile: "src/engine/institutionalMacroEngine.ts",
    cardFile: "src/components/TradingEngine/pages/InstitutionalMacroCard.tsx",
    status: "READY",
    description:
      "Evaluates FII & DII cash segment transaction values to calculate institutional bias and a macro score (0-100).",
    consumes: [],
    produces: [
      "fiiNetCash",
      "diiNetCash",
      "netCombinedFlow",
      "institutionalBias",
      "macroScore",
      "reasons",
    ],
    consumedBy: [8, 11],
    tips: {
      bullish: "FII & DII net flows are positive. Institutional bias is BULLISH.",
      bearish: "FII & DII net flows are negative. Institutional bias is BEARISH."
    }
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get a layer by ID */
export function getLayer(id: number): LayerDefinition | undefined {
  return LAYER_REGISTRY.find(l => l.id === id);
}

/** Get all layers that feed into a given layer */
export function getUpstreamLayers(id: number): LayerDefinition[] {
  const layer = getLayer(id);
  if (!layer) return [];
  return layer.consumes.map(cid => getLayer(cid)).filter(Boolean) as LayerDefinition[];
}

/** Get all layers that consume a given layer's output */
export function getDownstreamLayers(id: number): LayerDefinition[] {
  const layer = getLayer(id);
  if (!layer) return [];
  return layer.consumedBy.map(cid => getLayer(cid)).filter(Boolean) as LayerDefinition[];
}

/** Get all READY layers */
export function getReadyLayers(): LayerDefinition[] {
  return LAYER_REGISTRY.filter(l => l.status === "READY");
}

/** Get all WAITING layers */
export function getWaitingLayers(): LayerDefinition[] {
  return LAYER_REGISTRY.filter(l => l.status === "WAITING");
}

/** Validate that a layer's dependencies are all READY before it can be built */
export function canBuild(id: number): { ok: boolean; missing: string[] } {
  const layer = getLayer(id);
  if (!layer) return { ok: false, missing: ["Layer not found"] };
  const missing = layer.consumes
    .map(cid => getLayer(cid))
    .filter(l => l && l.status !== "READY")
    .map(l => `Layer ${l!.id}: ${l!.name}`);
  return { ok: missing.length === 0, missing };
}
