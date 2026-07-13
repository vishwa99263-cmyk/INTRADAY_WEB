/**
 * strategyRegistry.ts
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * AMEX Strategy Registry â€” All Trading Strategies Database
 *
 * Architecture:
 *  - Each strategy is a pure config object (no logic inside)
 *  - AI Brain + Dispatcher reads these configs and decides which to run
 *  - New strategies: just add a new entry to STRATEGY_REGISTRY
 *
 * Config Fields:
 *  - conditions: When AI should consider this strategy
 *  - execution:  What trade to place (legs, direction rule)
 *  - risk:       SL / Target / time rules
 *
 * Pure TypeScript â€” no React, no side effects.
 */

// â”€â”€ Enums & Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type StrategyMode   = "INTRADAY" | "POSITIONAL";
export type HedgeType      = "NAKED" | "SPREAD" | "STRANGLE" | "IRON_CONDOR";
export type SessionType    = "OPENING" | "MID" | "CLOSING" | "ANY";
export type SLType         = "FIXED" | "TRAILING" | "BOTH";
export type MarketRegime   =
  | "TRENDING_BULL"
  | "TRENDING_BEAR"
  | "BREAKOUT"
  | "BREAKDOWN"
  | "RANGE"
  | "VOLATILE"
  | "ANY";

export type SignalDirection = "CE" | "PE" | "AI_DECIDES";

// â”€â”€ Breakout Validation Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Controls how strictly the system filters FAKE breakouts before deploying.

export interface BreakoutValidationConfig {
  // FILTER 1: Candle close
  requireCandleClose:    boolean;   // true = body must close above/below level (no wick traps)
  // FILTER 2: Volume
  requireVolumeConfirm:  boolean;   // true = volume must be >= volumeMultiplier x avg
  volumeMultiplier?:     number;    // e.g. 1.5 = 1.5x average volume required
  // FILTER 3: Hold candles (time filter)
  holdCandlesMin?:       number;    // how many candles price must stay beyond level (e.g. 2)
  holdTimeframeMin?:     number;    // candle timeframe in minutes (e.g. 5 = 5min candles)
  // FILTER 4: ATR distance
  requireATRDistance:    boolean;   // true = price must be >= atrMultiplier x ATR beyond level
  atrMultiplier?:        number;    // e.g. 0.5 = price must move 0.5 ATR beyond breakout level
  atrPeriod?:            number;    // ATR period (default 14)
  // FILTER 5: OI Check
  requireOIConfirm:      boolean;   // true = check OI unwinding at breakout level
  oiUnwindPct?:          number;    // min % of OI that must unwind at level (e.g. 10 = 10%)
  // FILTER 6: Higher TF confluence
  requireHTFConfluence:  boolean;   // true = 15min/1hr candle must confirm direction
  htfTimeframeMin?:      number;    // higher timeframe in minutes (e.g. 15)
  // FILTER 7: PCR shift
  requirePCRShift?:      boolean;   // true = PCR must shift in direction of breakout
  // Strictness level for UI display
  strictnessLevel:       "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
}

export type StrikePosType =
  | "ATM" | "ATM+1" | "ATM-1" | "ATM+2" | "ATM-2"
  | "OTM+1" | "OTM+2" | "OTM-1" | "OTM-2" | "SPREAD_LEG";

export interface StrategyLeg {
  action:         "BUY" | "SELL";
  side:           SignalDirection;         // CE or PE or AI_DECIDES
  position:       StrikePosType;           // Strike selection
  offsetPts?:     number;                  // Strike offset in points
  lotMultiplier?: number;                  // For ratio spreads (e.g. 2 = sell 2 lots)
}

export type ExpiryPreference = "WEEKLY" | "NEXT_WEEKLY" | "MONTHLY" | "AI_DECIDES";
export type IndexPreference  = "NIFTY" | "BANKNIFTY" | "SENSEX" | "AI_DECIDES";

export interface StrategyConditions {
  sessionTime:      SessionType[];           // Which session(s)
  allowedRegimes:   MarketRegime[];          // Which regimes
  vixMin:           number;                  // Min VIX (0 = no min)
  vixMax:           number;                  // Max VIX (99 = no max)
  minAIConfidence:  number;                  // AI Brain min confidence (0-100)
  minSmartMoney:    number;                  // Smart Money score min (0-100)
  minAlignScore:    number;                  // Strategy Alignment score min (0-100)
  requireBreakout?: boolean;                 // Range must be broken (up)
  requireBreakdown?: boolean;                // Range must be broken (down)
  requireExhaustionSignal?: boolean;         // Momentum exhaustion needed
  isExpiryDayOnly?: boolean;                 // Only on expiry day (Thursday)
  notExpiryDay?: boolean;                    // NOT on expiry day
  minBreadthScore?: number;                  // Min market breadth score
  // â”€â”€ Expiry & Index Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  preferredExpiry?: ExpiryPreference;       // WEEKLY / NEXT_WEEKLY / MONTHLY / AI_DECIDES
  preferredIndex?:  IndexPreference;        // NIFTY / BANKNIFTY / SENSEX / AI_DECIDES
}

export interface StrategyRisk {
  maxLossRs:         number;               // Max loss in â‚¹ per trade
  targetRs:          number;               // Target profit in â‚¹
  slType:            SLType;               // FIXED / TRAILING / BOTH
  fixedSLPct?:       number;               // Fixed SL as % of premium
  targetPct?:        number;               // Target as % of premium
  trailTriggerRs?:   number;               // â‚¹ profit to activate trailing SL
  trailStepRs?:      number;               // â‚¹ trailing step size
  squareOffTime?:    string;               // "HH:MM" for intraday (IST)
  maxHoldDays?:      number;               // Max days to hold (positional)
  riskRewardMin:     number;               // Minimum R:R ratio required
}

export interface StrategyDefinition {
  id:           string;                    // Unique strategy ID
  name:         string;                    // Display name
  description:  string;                   // What it does
  mode:         StrategyMode;             // INTRADAY or POSITIONAL
  hedgeType:    HedgeType;               // Trade structure
  capital:      { min: number; max: number }; // Capital range â‚¹
  priority:     number;                   // 1=highest priority when multiple trigger
  tags:         string[];                 // Category tags

  conditions:   StrategyConditions;      // When to fire
  legs:         StrategyLeg[];           // Trade legs to execute
  risk:         StrategyRisk;            // Risk management rules

  winRateHistorical: number;             // Historical win rate %
  isActive:     boolean;                 // Enable/disable toggle
  fullDescription?: string;              // Detailed strategy description for UI
  entryTrigger?:    string;              // Entry trigger summary
  exitTrigger?:     string;              // Exit trigger summary
  reEntryRule?:     string;              // Re-entry rule
  // \u2500\u2500 Fake Breakout Filter \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  breakoutValidation?: BreakoutValidationConfig;  // Rules to filter fake breakouts
}

// â”€â”€ Strategy Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const STRATEGY_REGISTRY: StrategyDefinition[] = [

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // INTRADAY STRATEGIES
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  {
    id:          "ORB_NAKED",
    name:        "ORB Naked Breakout",
    description: "Buys ATM CE or PE on Opening Range Breakout. Price above 9:15-9:30 high â†’ CE. Price below low â†’ PE.",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 10000, max: 25000 },
    priority:    1,
    tags:        ["breakout", "opening", "momentum"],

    conditions: {
      sessionTime:     ["OPENING"],
      allowedRegimes:  ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin:          0,
      vixMax:          20,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireBreakout: true,
      minBreadthScore: 20,
    },

    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],

    risk: {
      maxLossRs:     3000,
      targetRs:      3000,
      slType:        "BOTH",
      trailTriggerRs: 1500,
      trailStepRs:    500,
      squareOffTime: "15:25",
      riskRewardMin:  1.5,
    },

    winRateHistorical: 64.5,
    isActive: true,
  },

  {
    id:          "ORB_SPREAD",
    name:        "ORB Bull/Bear Spread",
    description: "Hedged ORB â€” Bull Call Spread on breakout, Bear Put Spread on breakdown. Defined risk, Â±â‚¹3000 P&L gate.",
    mode:        "INTRADAY",
    hedgeType:   "SPREAD",
    capital:     { min: 15000, max: 50000 },
    priority:    2,
    tags:        ["breakout", "hedged", "spread", "opening"],

    conditions: {
      sessionTime:     ["OPENING"],
      allowedRegimes:  ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin:          14,
      vixMax:          99,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireBreakout: true,
    },

    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",    offsetPts: 0 },
      { action: "SELL", side: "AI_DECIDES", position: "SPREAD_LEG", offsetPts: 100 }, // hedge leg
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       3000,
      slType:         "FIXED",
      squareOffTime:  "15:25",
      riskRewardMin:  1.5,
    },

    winRateHistorical: 66.2,
    isActive: true,
  },

  {
    id:          "BREAKOUT_MOMENTUM",
    name:        "Breakout Momentum Engine",
    description: "Enters CE/PE on strong 15M range break backed by breadth â‰¥ 60 and accelerating momentum.",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 10000, max: 30000 },
    priority:    3,
    tags:        ["breakout", "momentum", "mid-session"],

    conditions: {
      sessionTime:     ["OPENING", "MID"],
      allowedRegimes:  ["BREAKOUT", "TRENDING_BULL"],
      vixMin:          0,
      vixMax:          22,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireBreakout: true,
      minBreadthScore: 20,
    },

    legs: [
      { action: "BUY", side: "CE", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       4500,
      slType:         "BOTH",
      trailTriggerRs: 2000,
      trailStepRs:    500,
      squareOffTime:  "15:25",
      riskRewardMin:  1.5,
    },

    winRateHistorical: 64.5,
    isActive: true,
  },

  {
    id:          "INSTITUTIONAL_BREAKDOWN",
    name:        "Institutional Breakdown Trap",
    description: "Enters PE on 15M range low breakdown + Smart Money bearish flow + PCR weak.",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 10000, max: 30000 },
    priority:    4,
    tags:        ["breakdown", "smart-money", "bearish"],

    conditions: {
      sessionTime:     ["OPENING", "MID", "CLOSING"],
      allowedRegimes:  ["BREAKDOWN", "TRENDING_BEAR"],
      vixMin:          0,
      vixMax:          25,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireBreakdown: true,
    },

    legs: [
      { action: "BUY", side: "PE", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       4500,
      slType:         "BOTH",
      trailTriggerRs: 2000,
      trailStepRs:    500,
      squareOffTime:  "15:25",
      riskRewardMin:  1.5,
    },

    winRateHistorical: 62.8,
    isActive: true,
  },

  {
    id:          "FII_FLOW_INTRADAY",
    name:        "FII Flow Intraday Rider",
    description: "Rides strong institutional option writing flow. Smart Money Score â‰¥ 75, aligns with OI chain direction.",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 10000, max: 40000 },
    priority:    5,
    tags:        ["smart-money", "institutional", "mid-session"],

    conditions: {
      sessionTime:     ["MID"],
      allowedRegimes:  ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      vixMin:          0,
      vixMax:          20,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
    },

    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       5000,
      slType:         "BOTH",
      trailTriggerRs: 2000,
      trailStepRs:    700,
      squareOffTime:  "15:25",
      riskRewardMin:  1.8,
    },

    winRateHistorical: 72.4,
    isActive: true,
  },

  {
    id:          "PCR_EXTREME_PLAY",
    name:        "PCR Extreme Reversal",
    description: "Contrarian play â€” enters when PCR is extreme (< 0.7 = oversold â†’ CE, > 1.5 = overbought â†’ PE).",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 10000, max: 25000 },
    priority:    7,
    tags:        ["contrarian", "pcr", "reversal"],

    conditions: {
      sessionTime:     ["MID", "CLOSING"],
      allowedRegimes:  ["RANGE", "VOLATILE"],
      vixMin:          0,
      vixMax:          30,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireExhaustionSignal: true,
    },

    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       3500,
      slType:         "FIXED",
      squareOffTime:  "15:25",
      riskRewardMin:  1.2,
    },

    winRateHistorical: 58.0,
    isActive: true,
  },

  {
    id:          "PRE_EXPIRY_MOMENTUM",
    name:        "Pre-Expiry Thursday Momentum",
    description: "On expiry day (Thursday), captures directional move 10:30-1:00 PM on strong momentum.",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 10000, max: 25000 },
    priority:    6,
    tags:        ["expiry", "momentum", "thursday"],

    conditions: {
      sessionTime:     ["MID"],
      allowedRegimes:  ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      vixMin:          0,
      vixMax:          25,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      isExpiryDayOnly: true,
    },

    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       5000,
      slType:         "BOTH",
      trailTriggerRs: 2000,
      trailStepRs:    600,
      squareOffTime:  "13:30",
      riskRewardMin:  1.6,
    },

    winRateHistorical: 67.5,
    isActive: true,
  },

  {
    id:          "OI_WALL_SCALP",
    name:        "OI Wall Reversal Scalp",
    description: "Scalps reversal near max-pain OI walls. Spot near max CE wall â†’ PE, near max PE wall â†’ CE.",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 15000, max: 35000 },
    priority:    8,
    tags:        ["scalp", "reversal", "oi-wall"],

    conditions: {
      sessionTime:     ["MID", "CLOSING"],
      allowedRegimes:  ["RANGE", "VOLATILE"],
      vixMin:          0,
      vixMax:          25,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireExhaustionSignal: true,
    },

    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       3000,
      slType:         "FIXED",
      squareOffTime:  "15:25",
      riskRewardMin:  1.0,
    },

    winRateHistorical: 61.0,
    isActive: true,
  },

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // POSITIONAL STRATEGIES
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  {
    id:          "WEEKLY_SWING_CE",
    name:        "Weekly Swing CE Buyer",
    description: "Buys ATM/OTM CE on strong weekly bullish regime. Holds 2-4 days with trailing SL.",
    mode:        "POSITIONAL",
    hedgeType:   "NAKED",
    capital:     { min: 20000, max: 100000 },
    priority:    1,
    tags:        ["swing", "weekly", "bullish", "positional"],

    conditions: {
      sessionTime:     ["OPENING", "MID", "ANY"],
      allowedRegimes:  ["TRENDING_BULL", "BREAKOUT"],
      vixMin:          0,
      vixMax:          18,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireBreakout: true,
      notExpiryDay:    true,
      minBreadthScore: 20,
    },

    legs: [
      { action: "BUY", side: "CE", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       6000,
      slType:         "BOTH",
      trailTriggerRs: 2500,
      trailStepRs:    800,
      maxHoldDays:    4,
      riskRewardMin:  2.0,
    },

    winRateHistorical: 61.0,
    isActive: true,
  },

  {
    id:          "WEEKLY_SWING_PE",
    name:        "Weekly Swing PE Buyer",
    description: "Buys ATM/OTM PE on strong weekly bearish regime. Holds 2-4 days with trailing SL.",
    mode:        "POSITIONAL",
    hedgeType:   "NAKED",
    capital:     { min: 20000, max: 100000 },
    priority:    2,
    tags:        ["swing", "weekly", "bearish", "positional"],

    conditions: {
      sessionTime:     ["OPENING", "MID", "ANY"],
      allowedRegimes:  ["TRENDING_BEAR", "BREAKDOWN"],
      vixMin:          0,
      vixMax:          22,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      requireBreakdown: true,
      notExpiryDay:    true,
    },

    legs: [
      { action: "BUY", side: "PE", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       6000,
      slType:         "BOTH",
      trailTriggerRs: 2500,
      trailStepRs:    800,
      maxHoldDays:    4,
      riskRewardMin:  2.0,
    },

    winRateHistorical: 63.0,
    isActive: true,
  },

  {
    id:          "MONTHLY_TREND_RIDER",
    name:        "Monthly Trend Rider",
    description: "Buys monthly ATM option when monthly expiry shows strong directional conviction. 5-15 day hold.",
    mode:        "POSITIONAL",
    hedgeType:   "NAKED",
    capital:     { min: 30000, max: 150000 },
    priority:    3,
    tags:        ["monthly", "trend", "positional", "high-conviction"],

    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      vixMin:          0,
      vixMax:          20,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      minBreadthScore: 20,
    },

    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       9000,
      slType:         "BOTH",
      trailTriggerRs: 4000,
      trailStepRs:    1000,
      maxHoldDays:    15,
      riskRewardMin:  3.0,
    },

    winRateHistorical: 58.0,
    isActive: true,
  },

  {
    id:          "FII_POSITIONAL",
    name:        "FII Positional Flow Rider",
    description: "Multi-day positional ride on sustained FII buying/selling flow detected by Smart Money engine.",
    mode:        "POSITIONAL",
    hedgeType:   "NAKED",
    capital:     { min: 25000, max: 100000 },
    priority:    4,
    tags:        ["institutional", "fii", "positional", "smart-money"],

    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["TRENDING_BULL", "TRENDING_BEAR"],
      vixMin:          0,
      vixMax:          18,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      notExpiryDay:    true,
    },

    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       7000,
      slType:         "BOTH",
      trailTriggerRs: 3000,
      trailStepRs:    800,
      maxHoldDays:    6,
      riskRewardMin:  2.3,
    },

    winRateHistorical: 68.0,
    isActive: true,
  },

  {
    id:          "WEEKLY_SPREAD_POSITIONAL",
    name:        "Weekly Bull/Bear Spread",
    description: "Hedged weekly spread â€” limited risk, ideal for uncertain markets. Holds till Thursday expiry.",
    mode:        "POSITIONAL",
    hedgeType:   "SPREAD",
    capital:     { min: 20000, max: 60000 },
    priority:    5,
    tags:        ["spread", "hedged", "weekly", "positional"],

    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN", "RANGE"],
      vixMin:          13,
      vixMax:          99,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
      notExpiryDay:    true,
    },

    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",       offsetPts: 0   },
      { action: "SELL", side: "AI_DECIDES", position: "SPREAD_LEG", offsetPts: 150 },
    ],

    risk: {
      maxLossRs:      3000,
      targetRs:       5000,
      slType:         "FIXED",
      maxHoldDays:    5,
      riskRewardMin:  1.6,
    },

    winRateHistorical: 64.0,
    isActive: true,
  },

  // â”€â”€ 8 NEW STRATEGIES (User Provided) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // S14: ORB Spread
  {
    id: "S14_ORB_SPREAD",
    name: "Opening Range Breakout Spread",
    description: "Bull Call / Bear Put spread on ORB breakout. Index F&O | Intraday | Hedged | 10k-50k",
    fullDescription: "Opening range high/low calculate hota hai market open ke baad. Agar price ORB High ke upar jaaye â†’ Bull Call Spread deploy hota hai. Agar price ORB Low ke neeche jaaye â†’ Bear Put Spread deploy hota hai. Position continuously monitor hoti hai profit/loss ke liye.",
    entryTrigger: "Price > ORB High â†’ Bull Call Spread | Price < ORB Low â†’ Bear Put Spread | No active position",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same session mein re-entry nahi. Agli trading day pe reset.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 2,
    tags: ["orb", "spread", "hedged", "opening"],
    conditions: {
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING"], vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20, minBreadthScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "AI_DECIDES", position: "ATM+1", lotMultiplier: 1 },
    ],
    risk: { slType: "FIXED", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "15:25", trailTriggerRs: 1500, trailStepRs: 500 },
    capital: { min: 10000, max: 50000 }, winRateHistorical: 57.0, isActive: true,
    breakoutValidation: {
      requireCandleClose:   true,   // Sirf wick cross nahi chalega â€” body close chahiye
      requireVolumeConfirm: true,   // Volume 1.5x average se zyada hona chahiye
      volumeMultiplier:     1.5,
      holdCandlesMin:       2,      // 2 candles tak price level ke upar/neeche tikni chahiye
      holdTimeframeMin:     5,      // 5-minute candles
      requireATRDistance:   true,   // Price 0.5 ATR door jaaye level se
      atrMultiplier:        0.5,
      atrPeriod:            14,
      requireOIConfirm:     true,   // OI unwinding confirm kare breakout level pe
      oiUnwindPct:          10,
      requireHTFConfluence: true,   // 15min chart ka trend confirm kare
      htfTimeframeMin:      15,
      requirePCRShift:      true,   // PCR shift direction confirm kare
      strictnessLevel:      "HIGH",
    },
  },

  // S15: Evening Momentum Spread
  {
    id: "S15_EVENING_MOMENTUM_SPREAD",
    name: "Evening Price + Momentum Spread",
    description: "Commodity/Index F&O evening (8PM). Bull/Bear spread on price change + 14-period momentum. | 2Lac+",
    fullDescription: "Roz 8:00 PM pe monitoring shuru hoti hai. Agar price % change > +5% aur 14-period momentum > +30 â†’ Bull Call Spread. Agar price % change < -5% aur momentum < -30 â†’ Bear Put Spread. Position tab tak monitor hoti hai jab tak profit/loss ya time exit na ho jaaye.",
    entryTrigger: "8:00 PM pe monitoring | Price change > +5% + Momentum > +30 â†’ Bull Call Spread | Price change < -5% + Momentum < -30 â†’ Bear Put Spread",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 11:25 PM",
    reEntryRule: "Same session exit ke baad re-entry nahi. Agli eligible session pe fresh monitoring.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 8,
    tags: ["evening", "commodity", "momentum", "spread"],
    conditions: {
      allowedRegimes: ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      sessionTime: ["ANY"], vixMin: 0, vixMax: 40,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "AI_DECIDES", position: "ATM+1", lotMultiplier: 1 },
    ],
    risk: { slType: "FIXED", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "23:25" },
    capital: { min: 200000, max: 500000 }, winRateHistorical: 53.5, isActive: true,
  },

  // S16: EMA 9/21 Crossover Spread
  {
    id: "S16_EMA_CROSSOVER_SPREAD",
    name: "Intraday EMA Crossover Bull/Bear Spread",
    description: "EMA 9/21 crossover par Bull Call ya Bear Put Spread. Index F&O | Intraday | Hedged | 10k-50k",
    fullDescription: "Roz 9:14 AM se monitoring shuru hoti hai. EMA9 > EMA21 cross kare â†’ Bull Call Spread (ATM Call buy + OTM Call sell). EMA9 < EMA21 cross kare â†’ Bear Put Spread (ATM Put buy + OTM Put sell). Ek baar position open ho to naye crossover signals ignore hote hain.",
    entryTrigger: "9:14 AM se monitoring | EMA9 > EMA21 â†’ Bull Call Spread | EMA9 < EMA21 â†’ Bear Put Spread | No active position",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same trading day mein re-entry nahi. Agli session pe eligible.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 3,
    tags: ["ema", "crossover", "spread", "intraday"],
    conditions: {
      allowedRegimes: ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      sessionTime: ["OPENING", "MID"], vixMin: 0, vixMax: 22,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20, minBreadthScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "NIFTY",
    },
    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "AI_DECIDES", position: "ATM+1", lotMultiplier: 1 },
    ],
    risk: { slType: "FIXED", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "15:25", trailTriggerRs: 1500, trailStepRs: 400 },
    capital: { min: 10000, max: 50000 }, winRateHistorical: 58.5, isActive: true,
  },

  // S17: ORB + Momentum Confirmation Spread
  {
    id: "S17_ORB_MOMENTUM_SPREAD",
    name: "ORB + Momentum Confirmation Spread",
    description: "ORB breakout + momentum > 0 confirmation par Bull/Bear spread. Index F&O | 10k-50k",
    fullDescription: "Opening range establish hoti hai user-defined time window se. Bullish setup tab hoga jab price ORB High ke upar jaaye aur momentum > 0 ho. Bearish setup tab hoga jab price ORB Low ke neeche jaaye aur momentum < 0 ho. Dono conditions zaroori hain â€” sirf price breakout kaafi nahi.",
    entryTrigger: "Price > ORB High + Momentum > 0 â†’ Bull Call Spread | Price < ORB Low + Momentum < 0 â†’ Bear Put Spread",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same session mein re-entry nahi. Agli trading day pe reset.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 2,
    tags: ["orb", "momentum", "spread", "confirmed"],
    conditions: {
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING"], vixMin: 0, vixMax: 22,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20, minBreadthScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "AI_DECIDES", position: "ATM+1", lotMultiplier: 1 },
    ],
    risk: { slType: "BOTH", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "15:25", trailTriggerRs: 1500, trailStepRs: 500 },
    capital: { min: 10000, max: 50000 }, winRateHistorical: 61.0, isActive: true,
    breakoutValidation: {
      requireCandleClose:   true,    // Body close MUST happen (sabse important filter)
      requireVolumeConfirm: true,    // Volume 2x average chahiye (momentum ke saath)
      volumeMultiplier:     2.0,
      holdCandlesMin:       2,       // 2 candles hold kare
      holdTimeframeMin:     5,
      requireATRDistance:   true,    // 0.6 ATR move chahiye breakout ke baad
      atrMultiplier:        0.6,
      atrPeriod:            14,
      requireOIConfirm:     true,    // OI confirm kare
      oiUnwindPct:          15,
      requireHTFConfluence: true,    // 15min + Momentum dono confirm karein
      htfTimeframeMin:      15,
      requirePCRShift:      true,
      strictnessLevel:      "EXTREME",  // Momentum strategy â€” sabse strict filter
    },
  },

  // S18: ORB High Call Ratio Spread
  {
    id: "S18_ORB_CALL_RATIO",
    name: "ORB High Breakout Call Ratio Spread",
    description: "ORB High breakout â†’ Buy 1 ATM CE + Sell 2 OTM CE. Nifty | Intraday | 10k-50k | Bearish bias",
    fullDescription: "9:15-9:30 AM ke beech Opening Range form hoti hai. 9:30 AM ke baad agar price ORB High ke upar jaaye â†’ Call Ratio Spread deploy: 1 ATM Call buy + 2 higher-strike OTM Calls sell. Structure controlled bullish move pe benefit deta hai. Unlimited upside risk hai isliye proper strike selection zaroori hai.",
    entryTrigger: "9:15-9:30 ORB form hoti hai. 9:30 ke baad price > ORB High â†’ Buy 1 ATM CE + Sell 2 OTM CE",
    exitTrigger: "Configured Profit Target OR Stop Loss hit hone par OR Time = 3:25 PM",
    reEntryRule: "Same session mein re-entry nahi. Agli trading day pe reset.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 4,
    tags: ["orb", "call-ratio", "breakout", "hedge"],
    conditions: {
      allowedRegimes: ["BREAKOUT", "TRENDING_BULL"],
      sessionTime: ["OPENING", "MID"], vixMin: 0, vixMax: 20,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20, minBreadthScore: 20,
      requireBreakout: true,
      preferredExpiry: "WEEKLY", preferredIndex: "NIFTY",
    },
    legs: [
      { action: "BUY",  side: "CE", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "CE", position: "ATM+2", lotMultiplier: 2 },
    ],
    risk: { slType: "FIXED", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "15:25" },
    capital: { min: 10000, max: 50000 }, winRateHistorical: 55.0, isActive: true,
    breakoutValidation: {
      requireCandleClose:   true,    // Ratio spread â€” galat entry bahut costly
      requireVolumeConfirm: true,    // Volume 2x minimum
      volumeMultiplier:     2.0,
      holdCandlesMin:       3,       // 3 candles hold kare (extra strict for ratio)
      holdTimeframeMin:     5,
      requireATRDistance:   true,    // 0.7 ATR door jaaye
      atrMultiplier:        0.7,
      atrPeriod:            14,
      requireOIConfirm:     true,    // Call OI at ORB High level unwind ho raha ho
      oiUnwindPct:          20,
      requireHTFConfluence: true,
      htfTimeframeMin:      15,
      requirePCRShift:      true,
      strictnessLevel:      "EXTREME",  // Ratio spread â€” max risk
    },
  },

  // S19: ORB Low Put Ratio Spread
  {
    id: "S19_ORB_PUT_RATIO",
    name: "ORB Low Breakdown Put Ratio Spread",
    description: "ORB Low breakdown â†’ Buy 1 ATM PE + Sell 2 OTM PE. Nifty | Intraday | 2Lac+ | Bullish bias",
    fullDescription: "9:15-9:30 AM ke beech Opening Range form hoti hai. 9:30 AM ke baad agar price ORB Low ke neeche jaaye â†’ Put Ratio Spread deploy: 1 ATM Put buy + 2 lower-strike OTM Puts sell. Controlled bearish movement pe benefit. Strong downside move mein significant risk hota hai isliye discipline zaroori.",
    entryTrigger: "9:15-9:30 ORB form hoti hai. 9:30 ke baad price < ORB Low â†’ Buy 1 ATM PE + Sell 2 OTM PE",
    exitTrigger: "Configured Profit Target OR Stop Loss hit OR Configured Square-Off Time",
    reEntryRule: "Same session mein re-entry nahi. Agli trading day pe reset.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 4,
    tags: ["orb", "put-ratio", "breakdown", "hedge"],
    conditions: {
      allowedRegimes: ["BREAKDOWN", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID"], vixMin: 0, vixMax: 20,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20, minBreadthScore: 20,
      requireBreakdown: true,
      preferredExpiry: "WEEKLY", preferredIndex: "NIFTY",
    },
    legs: [
      { action: "BUY",  side: "PE", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "PE", position: "ATM-2", lotMultiplier: 2 },
    ],
    risk: { slType: "FIXED", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "15:25" },
    capital: { min: 200000, max: 500000 }, winRateHistorical: 54.5, isActive: true,
    breakoutValidation: {
      requireCandleClose:   true,
      requireVolumeConfirm: true,
      volumeMultiplier:     2.0,
      holdCandlesMin:       3,       // 3 candles hold kare below level
      holdTimeframeMin:     5,
      requireATRDistance:   true,
      atrMultiplier:        0.7,
      atrPeriod:            14,
      requireOIConfirm:     true,    // Put OI at ORB Low level unwind ho raha ho
      oiUnwindPct:          20,
      requireHTFConfluence: true,
      htfTimeframeMin:      15,
      requirePCRShift:      true,
      strictnessLevel:      "EXTREME",
    },
  },

  // S20: Rolling 1-Hour Range Break Spread
  {
    id: "S20_ROLLING_1HR_RANGE_SPREAD",
    name: "Rolling 1-Hour Range Break Spread",
    description: "Rolling 1hr high/low breakout par Bull/Bear spread. | Intraday | 2Lac+ | Index + Commodity F&O",
    fullDescription: "9:30 AM se monitoring shuru hoti hai. Continuously pichle 1 ghante ka high/low calculate hota hai. Agar price previous 1hr High ke upar jaaye â†’ Bull Call Spread. Agar price previous 1hr Low ke neeche jaaye â†’ Bear Put Spread. Opposite breakout hone par bhi exit trigger hota hai.",
    entryTrigger: "9:30 AM se rolling 1hr high/low track. Price > 1hr High â†’ Bull Call Spread | Price < 1hr Low â†’ Bear Put Spread",
    exitTrigger: "P&L >= +Rs3000 OR <= -Rs3000 OR Opposite breakout signal OR Time = 3:25 PM",
    reEntryRule: "Same session exit ke baad re-entry nahi. Agli day pe fresh start.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 5,
    tags: ["rolling", "1hr", "range", "spread"],
    conditions: {
      allowedRegimes: ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      sessionTime: ["MID", "CLOSING"], vixMin: 0, vixMax: 24,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20, minBreadthScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "AI_DECIDES", position: "ATM+1", lotMultiplier: 1 },
    ],
    risk: { slType: "FIXED", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "15:25", trailTriggerRs: 1500, trailStepRs: 400 },
    capital: { min: 200000, max: 500000 }, winRateHistorical: 56.0, isActive: true,
    breakoutValidation: {
      requireCandleClose:   true,    // Rolling range â€” wick breaks bahut common
      requireVolumeConfirm: true,
      volumeMultiplier:     1.5,
      holdCandlesMin:       2,
      holdTimeframeMin:     5,
      requireATRDistance:   true,
      atrMultiplier:        0.4,
      atrPeriod:            14,
      requireOIConfirm:     false,   // Rolling range â€” OI optional
      requireHTFConfluence: true,    // 1hr chart confirm kare (HTF is 1hr)
      htfTimeframeMin:      60,
      requirePCRShift:      false,
      strictnessLevel:      "MEDIUM",
    },
  },

  // S21: Price + Volume Confirmed Breakout Spread
  {
    id: "S21_PRICE_VOLUME_BREAKOUT_SPREAD",
    name: "Price + Volume Confirmed Breakout Spread",
    description: "Volume-confirmed breakout par Bull/Bear spread. | Commodity + Index F&O | 2Lac+",
    fullDescription: "Configured trading window ke during instrument monitor hota hai. Breakout signal tab valid hoga jab price predefined level cross kare aur volume configured threshold se zyada ho. Volume confirmation false signals ko filter karta hai. Ek time mein sirf ek position allowed hai.",
    entryTrigger: "Price > Breakout Level + Volume > Threshold â†’ Bull Call Spread | Price < Breakdown Level + Volume > Threshold â†’ Bear Put Spread",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Configured time limit OR Scheduled square-off",
    reEntryRule: "Same monitoring window mein re-entry nahi. Agli cycle pe eligible.",
    mode: "INTRADAY", hedgeType: "SPREAD", priority: 3,
    tags: ["volume", "breakout", "confirmed", "spread"],
    conditions: {
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID"], vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20, minBreadthScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [
      { action: "BUY",  side: "AI_DECIDES", position: "ATM",   lotMultiplier: 1 },
      { action: "SELL", side: "AI_DECIDES", position: "ATM+1", lotMultiplier: 1 },
    ],
    risk: { slType: "BOTH", fixedSLPct: 100, targetPct: 100, maxLossRs: 3000, targetRs: 3000, riskRewardMin: 1.0, squareOffTime: "15:25", trailTriggerRs: 1500, trailStepRs: 500 },
    capital: { min: 200000, max: 500000 }, winRateHistorical: 59.0, isActive: true,
    breakoutValidation: {
      requireCandleClose:   true,
      requireVolumeConfirm: true,    // Volume already strategy ka core filter hai
      volumeMultiplier:     1.8,
      holdCandlesMin:       2,
      holdTimeframeMin:     5,
      requireATRDistance:   true,
      atrMultiplier:        0.5,
      atrPeriod:            14,
      requireOIConfirm:     true,
      oiUnwindPct:          10,
      requireHTFConfluence: true,
      htfTimeframeMin:      15,
      requirePCRShift:      false,
      strictnessLevel:      "HIGH",
    },
  },

  // S22: Dual-MACD Trend Continuation with P&L Exit
  {
    id: "S22_DUAL_MACD_CONTINUATION",
    name: "Dual-MACD Trend Continuation with P&L Exit",
    description: "Enters ATM Call/Put options when fast MACD crosses slow MACD on a 5-minute timeframe. | Intraday | Naked",
    fullDescription: "Fast MACD crosses above slow MACD to buy ATM Call, and crosses below to buy ATM Put on a 5-minute timeframe. Slower MACD is used as broader trend reference.",
    entryTrigger: "Fast MACD crosses Slow MACD on 5-Minute Timeframe. Starts daily at 9:15 AM.",
    exitTrigger: "P&L >= +Rs2000 OR P&L <= -Rs2000 OR Time = 3:10 PM",
    reEntryRule: "Same trading day mein re-entry nahi. Square-off ke baad stop for the day.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 10000, max: 50000 },
    priority: 3,
    tags: ["macd", "crossover", "trend-following", "intraday"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 2000,
      targetRs: 2000,
      slType: "FIXED",
      fixedSLPct: 20,
      targetPct: 20,
      squareOffTime: "15:10",
      riskRewardMin: 1.0
    },
    winRateHistorical: 57.5,
    isActive: true
  },

  // S23: EMA-9 EMA-21 Crossover Alert with P&L Exit
  {
    id: "S23_EMA_9_21_CROSSOVER",
    name: "EMA-9 EMA-21 Crossover Alert with P&L Exit",
    description: "Buys ATM CE/PE when EMA 9 crosses EMA 21 on a 5-minute timeframe and monitors P&L exit. | Intraday | Naked",
    fullDescription: "EMA 9 crosses above EMA 21 to trigger Call entry, and crosses below to trigger Put entry. Individual trade exits are managed by position P&L limits or 3:10 PM square-off.",
    entryTrigger: "EMA 9 crosses EMA 21 on 5-Minute Timeframe. Starts daily at 9:15 AM.",
    exitTrigger: "P&L >= +Rs2000 OR P&L <= -Rs2000 OR Time = 3:10 PM",
    reEntryRule: "Same day re-entry not allowed after exit.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 10000 },
    priority: 3,
    tags: ["ema", "crossover", "intraday", "naked"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 2000,
      targetRs: 2000,
      slType: "FIXED",
      fixedSLPct: 20,
      targetPct: 20,
      squareOffTime: "15:10",
      riskRewardMin: 1.0
    },
    winRateHistorical: 58.0,
    isActive: true
  },

  // S24: Linear Reg Slope Crossover Trend Entry
  {
    id: "S24_LIN_REG_SLOPE_CROSSOVER",
    name: "Linear Reg Slope Crossover Trend Entry",
    description: "Buys ATM CE/PE when fast LinReg Slope crosses slow LinReg Slope. Slower slope is the broader trend reference. | Intraday | Naked",
    fullDescription: "Enters ATM Call options when fast Linear Regression Slope crosses above slow slope, and ATM Put options when fast slope crosses below slow slope. Managed by strategy P&L limits.",
    entryTrigger: "Fast LinReg Slope crosses Slow LinReg Slope. Starts daily at 9:15 AM.",
    exitTrigger: "P&L >= +Rs2000 OR P&L <= -Rs2000 OR Time = 3:10 PM",
    reEntryRule: "Same session re-entry not allowed. Resets next day.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 10000 },
    priority: 4,
    tags: ["linear-regression", "slope", "crossover", "intraday"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 2000,
      targetRs: 2000,
      slType: "FIXED",
      fixedSLPct: 20,
      targetPct: 20,
      squareOffTime: "15:10",
      riskRewardMin: 1.0
    },
    winRateHistorical: 56.0,
    isActive: true
  },

  // S25: NIFTY ADX ROC High Volatility Option Buy
  {
    id: "S25_NIFTY_ADX_ROC_BUY",
    name: "NIFTY ADX ROC High Volatility Option Buy",
    description: "Enters NIFTY option buy positions when ADX > 25 and ROC determines direction (ROC > 0 = 1 Strike OTM CE, ROC < 0 = 2 Strike OTM PE). | Intraday | Naked",
    fullDescription: "Monitors NIFTY 50 using ADX and ROC on 5-minute candles. Allows entry only when ADX > 25. Triggers 1 strike OTM CE if ROC > 0, and 2 strikes OTM PE if ROC < 0.",
    entryTrigger: "ADX > 25 and ROC > 0 (CE) or ROC < 0 (PE) on 5-Minute candles. Starts at 9:15 AM.",
    exitTrigger: "Unrealized P&L >= +Rs3000 OR Unrealized P&L <= -Rs3000 OR Time = 3:00 PM",
    reEntryRule: "No re-entry after exit within same day.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 10000, max: 30000 },
    priority: 2,
    tags: ["adx", "roc", "high-volatility", "option-buy"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "NIFTY"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "OTM+1" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      fixedSLPct: 30,
      targetPct: 30,
      squareOffTime: "15:00",
      riskRewardMin: 1.0
    },
    winRateHistorical: 61.0,
    isActive: true
  },

  // S26: SMA 20 Option Buy
  {
    id: "S26_SMA_20_OPTION_BUY",
    name: "SMA 20 Option Buy",
    description: "Buys ATM CE when candle closes above SMA 20, and ATM PE when candle closes below SMA 20 on 5-minute candles. | Intraday | Naked",
    fullDescription: "Monitors NIFTY 50 using SMA 20 on a 5-minute chart. Enters ATM Call on close above SMA 20, and ATM Put on close below SMA 20. Managed by â‚¹2000 target/stop.",
    entryTrigger: "Candle close above/below SMA 20 on 5-Minute timeframe. Starts at 9:15 AM.",
    exitTrigger: "Unrealized P&L >= +Rs2000 OR Unrealized P&L <= -Rs2000 OR Time = 3:10 PM",
    reEntryRule: "Stop for the day after square-off.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 15000 },
    priority: 4,
    tags: ["sma", "trend-following", "option-buy", "intraday"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["TRENDING_BULL", "TRENDING_BEAR", "BREAKOUT", "BREAKDOWN"],
      vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "NIFTY"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 2000,
      targetRs: 2000,
      slType: "FIXED",
      fixedSLPct: 20,
      targetPct: 20,
      squareOffTime: "15:10",
      riskRewardMin: 1.0
    },
    winRateHistorical: 55.0,
    isActive: true
  },

  // S27: DI Momentum Trend Entry
  {
    id: "S27_DI_MOMENTUM_TREND",
    name: "DI Momentum Trend Entry",
    description: "Enters a NIFTY ATM Call when DI > 25 and Momentum > 0. Bullish only trend-following strategy. | Intraday | Naked",
    fullDescription: "Monitors Directional Index (DI) and Momentum indicators on a 5-minute timeframe. Buys NIFTY ATM Call when DI > 25 AND Momentum > 0. Exits on â‚¹3000 target/stop.",
    entryTrigger: "DI > 25 and Momentum > 0 on 5-Minute timeframe. Starts at 9:15 AM.",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:10 PM",
    reEntryRule: "Resets next day. No re-entry same day.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 15000 },
    priority: 3,
    tags: ["di", "momentum", "bullish-only", "intraday"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["TRENDING_BULL", "BREAKOUT"],
      vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "NIFTY"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      fixedSLPct: 30,
      targetPct: 30,
      squareOffTime: "15:10",
      riskRewardMin: 1.0
    },
    winRateHistorical: 56.5,
    isActive: true
  },

  // S28: 10AM 5% Movers Basket Buy
  {
    id: "S28_MOVERS_10AM_BASKET",
    name: "10AM 5% Movers Basket Buy",
    description: "Buys equities showing > +5% intraday change at 10:00 AM with combined Â±â‚¹1000 portfolio exit. | Intraday | Equity",
    fullDescription: "Scans predefined stock basket at 10:00 AM. Buys stocks showing greater than +5% intraday change vs previous close. Monitors combined portfolio P&L.",
    entryTrigger: "Time = 10:00 AM and Daily Stock Change > +5%.",
    exitTrigger: "Combined Portfolio P&L >= +Rs1000 OR Combined Portfolio P&L <= -Rs1000",
    reEntryRule: "No re-entry same day after portfolio exit.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 10000 },
    priority: 4,
    tags: ["equity", "basket", "momentum", "intraday"],
    conditions: {
      sessionTime: ["MID"],
      allowedRegimes: ["ANY" as any],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 0, minSmartMoney: 0, minAlignScore: 0
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 1000,
      targetRs: 1000,
      slType: "FIXED",
      riskRewardMin: 1.0
    },
    winRateHistorical: 54.0,
    isActive: true
  },

  // S29: On-Demand Put Option Averaging
  {
    id: "S29_PUT_OPTION_AVERAGING",
    name: "On-Demand Put Option Averaging",
    description: "Averaging-down Put buying strategy. Buys new Put every â‚¹10 premium decline. Fixed â‚¹10 target/stop per leg. | Overnight | F&O",
    fullDescription: "Manually activated bearish strategy. Buys Put options. If premium drops by â‚¹10 from last entry price, buys another Put. Each leg has a target/stop of â‚¹10. Re-entry on stop loss.",
    entryTrigger: "Manual start. Subsequent entries when premium <= Last Entry - Rs10.",
    exitTrigger: "Individual leg target (+Rs10) or stop loss (-Rs10) hit.",
    reEntryRule: "Re-entry occurs only on stop loss hit or next Rs10 premium decline.",
    mode: "POSITIONAL",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 10000 },
    priority: 5,
    tags: ["put-buy", "averaging", "bearish", "overnight"],
    conditions: {
      sessionTime: ["ANY"],
      allowedRegimes: ["ANY" as any],
      vixMin: 0, vixMax: 99,
      minAIConfidence: 0, minSmartMoney: 0, minAlignScore: 0
    },
    legs: [
      { action: "BUY", side: "PE", position: "ATM" }
    ],
    risk: {
      maxLossRs: 10000,
      targetRs: 15000,
      slType: "FIXED",
      riskRewardMin: 1.0
    },
    winRateHistorical: 52.5,
    isActive: true
  },

  // S30: On-Demand Call Option Averaging
  {
    id: "S30_CALL_OPTION_AVERAGING",
    name: "On-Demand Call Option Averaging",
    description: "Averaging-down Call buying strategy. Buys new Call every â‚¹10 premium decline. Fixed â‚¹10 target/stop per leg. | Overnight | F&O",
    fullDescription: "Manually activated bullish strategy. Buys Call options. If premium drops by â‚¹10 from last entry price, buys another Call. Each leg has a target/stop of â‚¹10. Re-entry on stop loss.",
    entryTrigger: "Manual start. Subsequent entries when premium <= Last Entry - Rs10.",
    exitTrigger: "Individual leg target (+Rs10) or stop loss (-Rs10) hit.",
    reEntryRule: "Re-entry occurs only on stop loss hit or next Rs10 premium decline.",
    mode: "POSITIONAL",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 10000 },
    priority: 5,
    tags: ["call-buy", "averaging", "bullish", "overnight"],
    conditions: {
      sessionTime: ["ANY"],
      allowedRegimes: ["ANY" as any],
      vixMin: 0, vixMax: 99,
      minAIConfidence: 0, minSmartMoney: 0, minAlignScore: 0
    },
    legs: [
      { action: "BUY", side: "CE", position: "ATM" }
    ],
    risk: {
      maxLossRs: 10000,
      targetRs: 15000,
      slType: "FIXED",
      riskRewardMin: 1.0
    },
    winRateHistorical: 52.5,
    isActive: true
  },

  // S31: On-Demand Call Option Pyramiding
  {
    id: "S31_CALL_OPTION_PYRAMIDING",
    name: "On-Demand Call Option Pyramiding",
    description: "Scale-in winner Call buying strategy. Buys next Call if previous Call's premium increases by â‚¹10 (up to 4 entries). | Overnight | F&O",
    fullDescription: "Bullish pyramiding setup. Buys first Call immediately at market. Adds a new Call only when previous leg is in â‚¹10 profit. Individual â‚¹10 stop per leg. Max 4 total entries.",
    entryTrigger: "Manual start. Subsequent entries when previous entry premium >= Entry Price + Rs10.",
    exitTrigger: "Individual leg stop loss (-Rs10) hit, or max 4 entries completed.",
    reEntryRule: "Manual restart required after completion. No automatic re-entry.",
    mode: "POSITIONAL",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 10000 },
    priority: 5,
    tags: ["call-buy", "pyramiding", "bullish", "scale-in"],
    conditions: {
      sessionTime: ["ANY"],
      allowedRegimes: ["ANY" as any],
      vixMin: 0, vixMax: 99,
      minAIConfidence: 0, minSmartMoney: 0, minAlignScore: 0
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 10000,
      targetRs: 20000,
      slType: "FIXED",
      riskRewardMin: 1.0
    },
    winRateHistorical: 55.5,
    isActive: true
  },

  // S32: On-Demand Put Option Pyramiding
  {
    id: "S32_PUT_OPTION_PYRAMIDING",
    name: "On-Demand Put Option Pyramiding",
    description: "Scale-in winner Put buying strategy. Buys next Put if previous Put's premium increases by â‚¹10 (up to 4 entries). | Overnight | F&O",
    fullDescription: "Bearish pyramiding setup. Buys first Put immediately at market. Adds a new Put only when previous leg is in â‚¹10 profit. Individual â‚¹10 stop per leg. Max 4 total entries.",
    entryTrigger: "Manual start. Subsequent entries when previous entry premium >= Entry Price + Rs10.",
    exitTrigger: "Individual leg stop loss (-Rs10) hit, or max 4 entries completed.",
    reEntryRule: "Manual restart required after completion. No automatic re-entry.",
    mode: "POSITIONAL",
    hedgeType: "NAKED",
    capital: { min: 5000, max: 10000 },
    priority: 5,
    tags: ["put-buy", "pyramiding", "bearish", "scale-in"],
    conditions: {
      sessionTime: ["ANY"],
      allowedRegimes: ["ANY" as any],
      vixMin: 0, vixMax: 99,
      minAIConfidence: 0, minSmartMoney: 0, minAlignScore: 0
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs: 10000,
      targetRs: 20000,
      slType: "FIXED",
      riskRewardMin: 1.0
    },
    winRateHistorical: 55.0,
    isActive: true
  },

  // S33: ATR-ROC High Volatility Option Buy
  {
    id: "S33_ATR_ROC_VOLATILITY_BUY",
    name: "ATR-ROC High Volatility Option Buy",
    description: "Buys 1 strike OTM CE/PE when ATR > 50 and ROC determines direction (ROC > 0 = CE, ROC < 0 = PE). | Intraday | Naked",
    fullDescription: "Monitors ATR and ROC on the selected timeframe. Entry allowed only when ATR > 50 indicating high volatility. ROC determines direction. Exits on â‚¹3000 target/stop.",
    entryTrigger: "ATR > 50 and ROC > 0 (CE) or ROC < 0 (PE) on 5-Minute timeframe. Starts at 9:15 AM.",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:00 PM",
    reEntryRule: "No re-entry after square-off for the day.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 10000, max: 30000 },
    priority: 3,
    tags: ["atr", "roc", "high-volatility", "option-buy"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "OTM+1" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      fixedSLPct: 30,
      targetPct: 30,
      squareOffTime: "15:00",
      riskRewardMin: 1.0
    },
    winRateHistorical: 56.0,
    isActive: true
  },

  // S34: Bollinger Band High Volatility Option Buy
  {
    id: "S34_BB_VOLATILITY_BUY",
    name: "Bollinger Band High Volatility Option Buy",
    description: "Buys 1 strike OTM CE on close above Upper BB, and OTM PE on close below Lower BB. | Intraday | Naked",
    fullDescription: "Monitors NIFTY 50 Bollinger Band breakouts on 5-minute candles. Price closes above Upper BB â†’ buy CE. Price closes below Lower BB â†’ buy PE. Exits on â‚¹3000 target/stop.",
    entryTrigger: "Price close above/below Bollinger Bands. Starts daily at 9:15 AM.",
    exitTrigger: "Unrealized P&L >= +Rs3000 OR Unrealized P&L <= -Rs3000 OR Time = 3:10 PM",
    reEntryRule: "No re-entry after square-off for the day.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 10000, max: 25000 },
    priority: 3,
    tags: ["bollinger-bands", "breakout", "high-volatility", "intraday"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 25,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "NIFTY"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "OTM+1" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      fixedSLPct: 25,
      targetPct: 25,
      squareOffTime: "15:10",
      riskRewardMin: 1.0
    },
    winRateHistorical: 59.5,
    isActive: true
  },

  // S35: Std Deviation ROC High Volatility Option Buy
  {
    id: "S35_STDDEV_ROC_BUY",
    name: "Std Deviation ROC High Volatility Option Buy",
    description: "Buys 1 strike OTM CE/PE when Standard Deviation > 22 and ROC determines direction (ROC > 0 = CE, ROC < 0 = PE). | Intraday | Naked",
    fullDescription: "Buys 1 strike OTM options when Standard Deviation > 22 (volatility expansion) and ROC determines direction. Managed by fixed target/stop of â‚¹3000.",
    entryTrigger: "StdDev > 22 and ROC > 0 (CE) or ROC < 0 (PE). Starts daily at 9:15 AM.",
    exitTrigger: "Unrealized P&L >= +Rs3000 OR Unrealized P&L <= -Rs3000 OR Time = 3:10 PM",
    reEntryRule: "No re-entry after exit. Resets next day.",
    mode: "INTRADAY",
    hedgeType: "NAKED",
    capital: { min: 10000, max: 30000 },
    priority: 3,
    tags: ["standard-deviation", "roc", "high-volatility", "option-buy"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "OTM+1" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      fixedSLPct: 25,
      targetPct: 25,
      squareOffTime: "15:10",
      riskRewardMin: 1.0
    },
    winRateHistorical: 57.0,
    isActive: true
  },

  // S36: High ADX Opening Long Straddle
  {
    id: "S36_HIGH_ADX_LONG_STRADDLE",
    name: "High ADX Opening Long Straddle",
    description: "Deploys ATM Long Straddle (buys ATM CE + ATM PE) before 10:00 AM if ADX > 50. | Intraday | Straddle",
    fullDescription: "Monitors morning volatility using 14-period ADX on a 5-minute chart. If ADX is above 50 before 10:00 AM, buys one ATM Call and one ATM Put (Long Straddle).",
    entryTrigger: "ADX > 50 before 10:00 AM. Daily monitoring starts at 9:15 AM.",
    exitTrigger: "Combined P&L >= +Rs3000 OR Combined P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "No re-entry same day. Resets next day.",
    mode: "INTRADAY",
    hedgeType: "SPREAD",
    capital: { min: 10000, max: 50000 },
    priority: 2,
    tags: ["straddle", "adx", "volatility", "intraday"],
    conditions: {
      sessionTime: ["OPENING"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 40,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "CE", position: "ATM" },
      { action: "BUY", side: "PE", position: "ATM" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      squareOffTime: "15:25",
      riskRewardMin: 1.0
    },
    winRateHistorical: 58.5,
    isActive: true
  },

  // S37: Volatility Spike OTM2 Long Strangle
  {
    id: "S37_VIX_SPIKE_OTM2_STRANGLE",
    name: "Volatility Spike OTM2 Long Strangle",
    description: "Buys 1 OTM Call + 1 OTM Put (Long Strangle) at 9:20 AM if India VIX rises > 5% or crashes < -3%. | Intraday | Strangle",
    fullDescription: "Monitors India VIX at 9:20 AM. If VIX increases by more than 5% or declines by more than 3%, enters a Long Strangle by buying one OTM Call and one OTM Put.",
    entryTrigger: "India VIX Change > +5% or < -3% at 9:20 AM.",
    exitTrigger: "Combined P&L >= +Rs2000 OR Combined P&L <= -Rs2000 OR Time = 3:20 PM",
    reEntryRule: "No re-entry for the day.",
    mode: "INTRADAY",
    hedgeType: "SPREAD",
    capital: { min: 5000, max: 10000 },
    priority: 3,
    tags: ["strangle", "india-vix", "vix-spike", "volatility"],
    conditions: {
      sessionTime: ["OPENING"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 40,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "CE", position: "OTM-1" },
      { action: "BUY", side: "PE", position: "OTM-1" }
    ],
    risk: {
      maxLossRs: 2000,
      targetRs: 2000,
      slType: "FIXED",
      squareOffTime: "15:20",
      riskRewardMin: 1.0
    },
    winRateHistorical: 56.0,
    isActive: true
  },

  // S38: Opening Range Break Long Straddle
  {
    id: "S38_ORB_LONG_STRADDLE",
    name: "Opening Range Break Long Straddle",
    description: "Deploys ATM Long Straddle (buys ATM CE + ATM PE) when price closes outside the 9:15-9:30 AM Opening Range. | Intraday | Straddle",
    fullDescription: "Calculates high/low of the 9:15-9:30 AM range. If price closes above range high or below range low, triggers ATM Long Straddle (both CE and PE buy).",
    entryTrigger: "Candle close above ORB High or below ORB Low. Monitoring starts at 9:30 AM.",
    exitTrigger: "Combined P&L >= +Rs3000 OR Combined P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "No re-entry allowed after exit.",
    mode: "INTRADAY",
    hedgeType: "SPREAD",
    capital: { min: 10000, max: 50000 },
    priority: 2,
    tags: ["straddle", "orb", "breakout", "intraday"],
    conditions: {
      sessionTime: ["OPENING", "MID"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "CE", position: "ATM" },
      { action: "BUY", side: "PE", position: "ATM" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      squareOffTime: "15:25",
      riskRewardMin: 1.0
    },
    winRateHistorical: 59.0,
    isActive: true
  },

  // S39: Expiry Last Hour Long Straddle (Alternate Index)
  {
    id: "S39_EXPIRY_LAST_HOUR_STRADDLE",
    name: "Expiry Last Hour Long Straddle (Alternate Index)",
    description: "Deploys ATM Long Straddle (CE + PE buy) in last trading hour (2:30 PM) on a non-expiring index to avoid heavy decay. | Hedged | Expiry",
    fullDescription: "Runs on expiry day at 2:30 PM. Deploys an ATM Long Straddle on a non-expiring index (e.g. trading Sensex on Nifty expiry day) to capture last-hour volatility while avoiding decay.",
    entryTrigger: "Expiry Day and Time = 2:30 PM. No open positions.",
    exitTrigger: "Combined P&L >= +Rs3000 OR Combined P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "No re-entry allowed after exit.",
    mode: "INTRADAY",
    hedgeType: "SPREAD",
    capital: { min: 10000, max: 50000 },
    priority: 2,
    tags: ["straddle", "expiry", "last-hour", "hedged"],
    conditions: {
      sessionTime: ["CLOSING"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 40,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      isExpiryDayOnly: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "CE", position: "ATM" },
      { action: "BUY", side: "PE", position: "ATM" }
    ],
    risk: {
      maxLossRs: 3000,
      targetRs: 3000,
      slType: "FIXED",
      squareOffTime: "15:25",
      riskRewardMin: 1.0
    },
    winRateHistorical: 57.0,
    isActive: true
  },

  // S40: Intraday Long Straddle to Long Strangle Adjustment
  {
    id: "S40_STRADDLE_TO_STRANGLE_ADJUST",
    name: "Intraday Long Straddle to Long Strangle Adjustment",
    description: "Enters ATM Long Straddle at 9:20 AM. Adjusts to Strangle by selling leg and buying OTM when either leg premium rises by 50%. | Hedged | Expiry",
    fullDescription: "Buys ATM Call and ATM Put at 9:20 AM. If Call premium rises by 50%, exits old Call and buys a new OTM Call. If Put rises by 50%, exits old Put and buys new OTM Put. Converts Straddle to Strangle.",
    entryTrigger: "Time = 9:20 AM. Deploys ATM Long Straddle.",
    exitTrigger: "Combined P&L >= +Rs2000 OR Combined P&L <= -Rs2000 OR Time = 3:20 PM",
    reEntryRule: "No re-entry. Resets next day.",
    mode: "INTRADAY",
    hedgeType: "SPREAD",
    capital: { min: 15000, max: 50000 },
    priority: 2,
    tags: ["straddle", "strangle", "adjustment", "hedged"],
    conditions: {
      sessionTime: ["OPENING"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "CE", position: "ATM" },
      { action: "BUY", side: "PE", position: "ATM" }
    ],
    risk: {
      maxLossRs: 2000,
      targetRs: 2000,
      slType: "FIXED",
      squareOffTime: "15:20",
      riskRewardMin: 1.0
    },
    winRateHistorical: 58.0,
    isActive: true
  },

  // S41: Gap Open Long Straddle
  {
    id: "S41_GAP_OPEN_LONG_STRADDLE",
    name: "Gap Open Long Straddle",
    description: "Deploys ATM Long Straddle (ATM CE + PE buy) immediately if market opens with a gap up or gap down. | Hedged",
    fullDescription: "Monitors opening price vs previous day close. If open price is different from previous day close (gap open), immediately deploys an ATM Long Straddle. Exits on Â±â‚¹2000 P&L limit.",
    entryTrigger: "Market Gap Up or Gap Down open. Deploys ATM Long Straddle immediately.",
    exitTrigger: "Combined P&L >= +Rs2000 OR Combined P&L <= -Rs2000 OR Time = 3:20 PM",
    reEntryRule: "No re-entry for the day.",
    mode: "INTRADAY",
    hedgeType: "SPREAD",
    capital: { min: 10000, max: 50000 },
    priority: 2,
    tags: ["straddle", "gap-open", "volatility", "hedged"],
    conditions: {
      sessionTime: ["OPENING"],
      allowedRegimes: ["BREAKOUT", "BREAKDOWN", "TRENDING_BULL", "TRENDING_BEAR"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES"
    },
    legs: [
      { action: "BUY", side: "CE", position: "ATM" },
      { action: "BUY", side: "PE", position: "ATM" }
    ],
    risk: {
      maxLossRs: 2000,
      targetRs: 2000,
      slType: "FIXED",
      squareOffTime: "15:20",
      riskRewardMin: 1.0
    },
    winRateHistorical: 56.5,
    isActive: true
  },


  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // REVERSAL STRATEGIES (AI Auto Strategy Dispatcher)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // R01: Linear Regression Angle Reversal
  {
    id: "R01_LINEAR_REG_ANGLE_REVERSAL",
    name: "Linear Regression Angle Reversal",
    description: "Bearish reversal when LR Angle crosses below +25; Bullish reversal when LR Angle crosses above -25. Index F&O | Intraday | 0-10k",
    fullDescription: "Daily 9:15 AM se monitoring shuru hoti hai. 5-minute timeframe pe 14-period Linear Regression Angle track hota hai. Jab angle positive zone (+25) se neeche cross kare â†’ Bearish reversal entry (PE buy). Jab angle negative zone (-25) se upar cross kare â†’ Bullish reversal entry (CE buy). Position open hone par configured P&L ya time-based exit monitor hota hai.",
    entryTrigger: "9:15 AM se | LR Angle (14, 5min, Close) crosses below +25 â†’ PE entry | LR Angle crosses above -25 â†’ CE entry",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same session exit ke baad re-entry allowed nahi. Agli trading day pe reset.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 5,
    tags: ["reversal", "linear-regression", "angle", "indicator"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID", "CLOSING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "AI_DECIDES", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 56.0, isActive: true,
  },

  // R02: MFI 14 Reversal
  {
    id: "R02_MFI14_REVERSAL",
    name: "MFI 14 Reversal",
    description: "Bullish reversal when MFI(14) crosses above oversold (20); Bearish reversal when crosses below overbought (80). Index F&O | Intraday | 0-10k",
    fullDescription: "Daily 9:15 AM se monitoring shuru hoti hai. 5-minute timeframe pe 14-period Money Flow Index (MFI) track hota hai. MFI < 20 (oversold zone) se upar cross kare â†’ CE buy entry. MFI > 80 (overbought zone) se neeche cross kare â†’ PE buy entry. Entry ke baad P&L ya time exit monitor hota hai.",
    entryTrigger: "9:15 AM se | MFI(14, 5min) crosses above 20 â†’ CE entry | MFI crosses below 80 â†’ PE entry",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same session mein ek hi trade. Exit ke baad re-entry nahi.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 5,
    tags: ["reversal", "mfi", "overbought", "oversold", "indicator"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID", "CLOSING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "AI_DECIDES", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 57.5, isActive: true,
  },

  // R03: Momentum 14 Reversal
  {
    id: "R03_MOMENTUM14_REVERSAL",
    name: "Momentum 14 Reversal",
    description: "Reversal on Momentum(14) zero-line cross: positive â†’ CE; negative â†’ PE. Index F&O | Intraday | 0-10k",
    fullDescription: "Daily 9:15 AM se monitoring shuru hoti hai. 5-minute timeframe pe 14-period Momentum oscillator track hota hai. Jab Momentum zero line ke upar cross kare (negative se positive) â†’ Bullish reversal CE entry. Jab zero line ke neeche cross kare (positive se negative) â†’ Bearish reversal PE entry.",
    entryTrigger: "9:15 AM se | Momentum(14, 5min) crosses above 0 â†’ CE entry | Momentum crosses below 0 â†’ PE entry",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same session mein ek hi trade. Exit ke baad re-entry nahi.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 5,
    tags: ["reversal", "momentum", "zero-cross", "indicator"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID", "CLOSING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "AI_DECIDES", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 56.5, isActive: true,
  },

  // R04: RSI Reversal
  {
    id: "R04_RSI_REVERSAL",
    name: "RSI Reversal",
    description: "CE on RSI(14) cross above 30 (oversold exit); PE on RSI cross below 70 (overbought exit). Index F&O | Intraday | 0-10k",
    fullDescription: "Daily 9:15 AM se monitoring shuru hoti hai. 5-minute timeframe pe 14-period RSI track hota hai. RSI 30 ke neeche jakar waapis 30 ke upar cross kare â†’ Bullish reversal CE entry. RSI 70 ke upar jakar waapis 70 ke neeche cross kare â†’ Bearish reversal PE entry. Entry ke baad P&L ya 3:25 PM time-based exit.",
    entryTrigger: "9:15 AM se | RSI(14, 5min) crosses above 30 â†’ CE entry | RSI crosses below 70 â†’ PE entry",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same session mein ek hi trade. Exit ke baad re-entry nahi.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 4,
    tags: ["reversal", "rsi", "overbought", "oversold", "indicator"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID", "CLOSING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "AI_DECIDES", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 59.0, isActive: true,
  },

  // R05: Stochastic Reversal
  {
    id: "R05_STOCHASTIC_REVERSAL",
    name: "Stochastic Reversal",
    description: "CE on Stoch %K/%D cross above 20 (oversold); PE on cross below 80 (overbought). Index F&O | Intraday | 0-10k",
    fullDescription: "Daily 9:15 AM se monitoring shuru hoti hai. 5-minute timeframe pe Stochastic (14,3,3) track hota hai. Jab %K aur %D dono 20 ke neeche hoon aur %K, %D ke upar cross kare â†’ Bullish reversal CE entry. Jab %K aur %D dono 80 ke upar hoon aur %K, %D ke neeche cross kare â†’ Bearish reversal PE entry.",
    entryTrigger: "9:15 AM se | Stoch(14,3,3) %K crosses above %D in oversold zone (<20) â†’ CE | %K crosses below %D in overbought zone (>80) â†’ PE",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Time = 3:25 PM",
    reEntryRule: "Same session mein ek hi trade. Exit ke baad re-entry nahi.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 4,
    tags: ["reversal", "stochastic", "overbought", "oversold", "indicator"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID", "CLOSING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "AI_DECIDES", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 58.0, isActive: true,
  },

  // R06: Opening Range High Reversal
  {
    id: "R06_ORB_HIGH_REVERSAL",
    name: "Opening Range High Reversal",
    description: "PE entry when price touches/exceeds ORB High and fails to sustain â€” rejection reversal. Index F&O | Intraday | 0-10k",
    fullDescription: "9:15-9:30 AM ke beech Opening Range High establish hoti hai. Jab price ORB High ke upar jaaye lekin sustain na kare (rejection/wick pattern) aur RSI overbought zone mein ho â†’ PE buy entry for bearish reversal. Agar price clearly ORB High ke upar close kare to breakout hai, reversal nahi.",
    entryTrigger: "9:30 ke baad | Price touches/slightly exceeds ORB High â†’ fails to close above â†’ PE entry (Reversal)",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Price closes above ORB High (stop) OR Time = 3:25 PM",
    reEntryRule: "Same session mein ek hi reversal trade. Exit ke baad fresh signal ka wait karo.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 6,
    tags: ["reversal", "orb-high", "rejection", "opening-range"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BEAR"],
      sessionTime: ["OPENING", "MID"],
      vixMin: 0, vixMax: 28,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "PE", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 57.0, isActive: true,
  },

  // R07: Opening Range Low Reversal
  {
    id: "R07_ORB_LOW_REVERSAL",
    name: "Opening Range Low Reversal",
    description: "CE entry when price touches/breaches ORB Low and fails â€” rejection reversal. Index F&O | Intraday | 0-10k",
    fullDescription: "9:15-9:30 AM ke beech Opening Range Low establish hoti hai. Jab price ORB Low ke neeche jaaye lekin sustain na kare (rejection/bullish engulf) aur RSI oversold zone mein ho â†’ CE buy entry for bullish reversal. Agar price clearly ORB Low ke neeche close kare to breakdown hai, reversal nahi.",
    entryTrigger: "9:30 ke baad | Price touches/slightly breaks ORB Low â†’ fails to close below â†’ CE entry (Reversal)",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Price closes below ORB Low (stop) OR Time = 3:25 PM",
    reEntryRule: "Same session mein ek hi reversal trade. Exit ke baad fresh signal ka wait karo.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 6,
    tags: ["reversal", "orb-low", "rejection", "opening-range"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL"],
      sessionTime: ["OPENING", "MID"],
      vixMin: 0, vixMax: 28,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "CE", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 57.0, isActive: true,
  },

  // R08: Day High Rejection
  {
    id: "R08_DAY_HIGH_REJECTION",
    name: "Day High Rejection Reversal",
    description: "PE entry on Day's High rejection â€” price tags Day High but fails, bearish reversal. Index F&O | Intraday | 0-10k",
    fullDescription: "Intraday Day High continuously track hota hai. Jab price current Day High ko touch kare ya usse thoda upar jaaye lekin strong bearish rejection candle (wick, engulf, pin bar) dikhe â†’ PE buy entry. Momentum aur RSI overbought confirmation chahiye. Strong upside conviction ho to avoid karo.",
    entryTrigger: "Price tags Day High â†’ bearish rejection candle confirmed + RSI > 65 â†’ PE entry",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR New Day High breakout (stop) OR Time = 3:25 PM",
    reEntryRule: "Har new Day High rejection par re-entry allowed hai (max 2 per day).",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 7,
    tags: ["reversal", "day-high", "rejection", "bearish"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE"],
      sessionTime: ["MID", "CLOSING"],
      vixMin: 0, vixMax: 28,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "PE", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 58.5, isActive: true,
  },

  // R09: Day Low Rejection
  {
    id: "R09_DAY_LOW_REJECTION",
    name: "Day Low Rejection Reversal",
    description: "CE entry on Day's Low rejection â€” price tags Day Low but fails, bullish reversal. Index F&O | Intraday | 0-10k",
    fullDescription: "Intraday Day Low continuously track hota hai. Jab price current Day Low ko touch kare ya usse thoda neeche jaaye lekin strong bullish rejection candle (hammer, bullish engulf) dikhe â†’ CE buy entry. RSI oversold confirmation chahiye. Strong downside momentum ho to avoid karo.",
    entryTrigger: "Price tags Day Low â†’ bullish rejection candle confirmed + RSI < 35 â†’ CE entry",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR New Day Low breakdown (stop) OR Time = 3:25 PM",
    reEntryRule: "Har new Day Low rejection par re-entry allowed hai (max 2 per day).",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 7,
    tags: ["reversal", "day-low", "rejection", "bullish"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE"],
      sessionTime: ["MID", "CLOSING"],
      vixMin: 0, vixMax: 28,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "CE", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 58.5, isActive: true,
  },

  // R10: Last Hour High Rejection
  {
    id: "R10_LAST_HOUR_HIGH_REJECTION",
    name: "Last Hour High Rejection",
    description: "PE entry when price fails at the last-hour session high (2:15-3:15 PM window). Index F&O | Intraday | 0-10k",
    fullDescription: "2:15 PM ke baad last hour monitoring shuru hoti hai. Last hour high continuously track hota hai (2:15-3:15 PM window). Jab price last hour high ko touch kare aur rejection dikhe (wick candle, bearish pattern) â†’ PE entry. Closing hour mein volatility high hoti hai, isliye tight SL use karo.",
    entryTrigger: "After 2:15 PM | Price tags Last Hour High â†’ bearish rejection â†’ PE entry",
    exitTrigger: "P&L >= +Rs2000 OR P&L <= -Rs2000 OR Time = 3:25 PM (hard)",
    reEntryRule: "Last hour mein ek hi trade allowed hai.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 8,
    tags: ["reversal", "last-hour", "high-rejection", "closing"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BEAR"],
      sessionTime: ["CLOSING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "PE", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 2000, targetRs: 2000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 56.0, isActive: true,
  },

  // R11: Last Hour Low Rejection
  {
    id: "R11_LAST_HOUR_LOW_REJECTION",
    name: "Last Hour Low Rejection",
    description: "CE entry when price fails at the last-hour session low (2:15-3:15 PM window). Index F&O | Intraday | 0-10k",
    fullDescription: "2:15 PM ke baad last hour monitoring shuru hoti hai. Last hour low continuously track hota hai (2:15-3:15 PM window). Jab price last hour low ko touch kare aur bullish rejection dikhe (hammer, bullish wicks) â†’ CE entry. Closing session mein tight SL zaroori hai.",
    entryTrigger: "After 2:15 PM | Price tags Last Hour Low â†’ bullish rejection â†’ CE entry",
    exitTrigger: "P&L >= +Rs2000 OR P&L <= -Rs2000 OR Time = 3:25 PM (hard)",
    reEntryRule: "Last hour mein ek hi trade allowed hai.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 8,
    tags: ["reversal", "last-hour", "low-rejection", "closing"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL"],
      sessionTime: ["CLOSING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "CE", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 2000, targetRs: 2000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 56.0, isActive: true,
  },

  // R12: Daily Gap Reversal
  {
    id: "R12_DAILY_GAP_REVERSAL",
    name: "Daily Gap Reversal",
    description: "Reversal play on gap-up/gap-down opens that fail to hold â€” Gap Fill trade. Index F&O | Intraday | 0-10k",
    fullDescription: "Market open pe gap detect hota hai (previous close vs current open). Gap-up open (>0.3%) aur price fails to hold â†’ PE entry (gap fill expected). Gap-down open (<-0.3%) aur price fails to extend â†’ CE entry (gap fill expected). Gap fills are high probability in range-bound markets. RSI + volume confirmation chahiye.",
    entryTrigger: "Gap-up open (>0.3%) â†’ price starts falling in first 15 min â†’ PE entry | Gap-down open (<-0.3%) â†’ price starts rising in first 15 min â†’ CE entry",
    exitTrigger: "P&L >= +Rs3000 OR P&L <= -Rs3000 OR Gap filled to previous close OR Time = 3:25 PM",
    reEntryRule: "Gap reversal ek hi baar per day. No re-entry same direction.",
    mode: "INTRADAY", hedgeType: "NAKED", priority: 6,
    tags: ["reversal", "gap", "gap-fill", "opening"],
    conditions: {
      allowedRegimes: ["RANGE", "VOLATILE", "TRENDING_BULL", "TRENDING_BEAR"],
      sessionTime: ["OPENING"],
      vixMin: 0, vixMax: 30,
      minAIConfidence: 35, minSmartMoney: 20, minAlignScore: 20,
      requireExhaustionSignal: true,
      preferredExpiry: "WEEKLY", preferredIndex: "AI_DECIDES",
    },
    legs: [{ action: "BUY", side: "AI_DECIDES", position: "ATM", lotMultiplier: 1 }],
    risk: {
      slType: "FIXED", maxLossRs: 3000, targetRs: 3000,
      riskRewardMin: 1.0, squareOffTime: "15:25",
      trailTriggerRs: 1500, trailStepRs: 400,
    },
    capital: { min: 0, max: 10000 }, winRateHistorical: 60.0, isActive: true,
  },  // S42: Quick 3/9 EMA Crossover Scalp
  {
    id:          "S42_EMA_SCALP",
    name:        "Quick 3/9 EMA Crossover Scalp",
    description: "Super-fast scalp based on 3 vs 9 EMA crossovers. Tight target & SL. | Intraday | Naked",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 5000, max: 20000 },
    priority:    1,
    tags:        ["scalp", "ema", "fast"],
    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["ANY" as any],
      vixMin:          0,
      vixMax:          99,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs:      1000,
      targetRs:       1200,
      slType:         "FIXED",
      fixedSLPct:     5, // Tight 5% SL
      targetPct:      8, // Tight 8% Target
      squareOffTime:  "15:25",
      riskRewardMin:  1.0,
    },
    winRateHistorical: 62.0,
    isActive: true,
  },

  // S43: VIX Spike Momentum Scalp
  {
    id:          "S43_VIX_SPIKE_SCALP",
    name:        "VIX Spike Momentum Scalp",
    description: "Scalps VIX spikes / sudden changes. Enters ATM option buy on sudden VIX movement. | Intraday | Naked",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 5000, max: 20000 },
    priority:    1,
    tags:        ["scalp", "vix", "momentum"],
    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["ANY" as any],
      vixMin:          0,
      vixMax:          99,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs:      1500,
      targetRs:       2000,
      slType:         "FIXED",
      fixedSLPct:     8, // Tight 8% SL
      targetPct:      12, // Tight 12% Target
      squareOffTime:  "15:25",
      riskRewardMin:  1.2,
    },
    winRateHistorical: 60.5,
    isActive: true,
  },

  // S44: Bollinger Band Edge Reversal Scalp
  {
    id:          "S44_BOLLINGER_BAND_SCALP",
    name:        "Bollinger Band Edge Reversal Scalp",
    description: "Fast mean-reversion scalp from outer Bollinger Band edges. | Intraday | Naked",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 5000, max: 20000 },
    priority:    2,
    tags:        ["scalp", "bb", "reversal"],
    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["ANY" as any],
      vixMin:          0,
      vixMax:          99,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs:      1000,
      targetRs:       1500,
      slType:         "FIXED",
      fixedSLPct:     6, // Tight 6% SL
      targetPct:      10, // Tight 10% Target
      squareOffTime:  "15:25",
      riskRewardMin:  1.4,
    },
    winRateHistorical: 59.0,
    isActive: true,
  },

  // S45: Volume Velocity Scalp
  {
    id:          "S45_VOLUME_BURST_SCALP",
    name:        "Volume Velocity Scalp",
    description: "Scalps sudden institutional volume expansion bursts. Rides high momentum. | Intraday | Naked",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 5000, max: 20000 },
    priority:    1,
    tags:        ["scalp", "volume", "momentum"],
    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["ANY" as any],
      vixMin:          0,
      vixMax:          99,
      minAIConfidence: 35,
      minSmartMoney: 20,
      minAlignScore: 20,
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs:      1200,
      targetRs:       1800,
      slType:         "FIXED",
      fixedSLPct:     7, // Tight 7% SL
      targetPct:      11, // Tight 11% Target
      squareOffTime:  "15:25",
      riskRewardMin:  1.4,
    },
    winRateHistorical: 61.5,
    isActive: true,
  },

  {
    id:          "BERSERKER_MICRO_SCALP",
    name:        "Berserker Micro-Scalp",
    description: "Fallback strategy for ultra-aggressive micro-scalping when GlobalScore < 70%. Bypasses all strict filters.",
    mode:        "INTRADAY",
    hedgeType:   "NAKED",
    capital:     { min: 5000, max: 20000 },
    priority:    10,
    tags:        ["scalp", "berserker", "aggressive"],
    conditions: {
      sessionTime:     ["ANY"],
      allowedRegimes:  ["ANY" as any],
      vixMin:          0,
      vixMax:          99,
      minAIConfidence: 0,
      minSmartMoney: 0,
      minAlignScore: 0,
    },
    legs: [
      { action: "BUY", side: "AI_DECIDES", position: "ATM" }
    ],
    risk: {
      maxLossRs:      1000,
      targetRs:       1500,
      slType:         "FIXED",
      fixedSLPct:     7, // Tight 7% SL
      targetPct:      10, // Tight 10% Target
      squareOffTime:  "15:25",
      riskRewardMin:  1.4,
    },
    winRateHistorical: 55.0,
    isActive: true,
  },

];

// â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Get all active strategies */
export function getActiveStrategies(): StrategyDefinition[] {
  return STRATEGY_REGISTRY.filter(s => s.isActive);
}

/** Get strategies by mode */
export function getStrategiesByMode(mode: StrategyMode): StrategyDefinition[] {
  return STRATEGY_REGISTRY.filter(s => s.isActive && s.mode === mode);
}

/** Get strategy by ID */
export function getStrategyById(id: string): StrategyDefinition | undefined {
  return STRATEGY_REGISTRY.find(s => s.id === id);
}

/** Get strategies sorted by priority */
export function getStrategiesByPriority(): StrategyDefinition[] {
  return [...STRATEGY_REGISTRY.filter(s => s.isActive)].sort((a, b) => a.priority - b.priority);
}
