import fs from "fs";
import path from "path";

export interface Strategy {
  id: string;
  name: string;
  objective: string;
  marketLogic: string;
  entryRules: string;
  exitRules: string;
  stopLossRules: string;
  confidenceFactors: string;
  realExample: string;
  commonMistakes: string;
  bestConditions: string;
  worstConditions: string;
  liveDashboardIntegration: string;
  notes?: string;
  isSystem?: boolean;
}

const STRATEGIES_FILE = path.join(process.cwd(), "server", "storage", "strategies.json");

const DEFAULT_STRATEGY: Strategy = {
  id: "strat-15m-range-engine",
  name: "First 15 Minute Range Engine",
  objective: "Capture intraday breakout direction using the first 15-minute market range.",
  marketLogic: "The first 15 minutes often reveal institutional intent. The range formed between 09:15 → 09:30 acts as an important support/resistance zone.",
  entryRules: "1. Enter BUY CE if the spot price breaks above the 15-minute high and the AI Confidence Engine shows a Bullish Score >= 70% with high confidence.\n2. Enter BUY PE if the spot price breaks below the 15-minute low and the AI Confidence Engine shows a Bearish Score >= 70% with high confidence.",
  exitRules: "1. Exit when the target price is reached (usually scaled by the 15-minute range height, e.g., 1.0x or 1.5x range height above entry).\n2. Exit if a momentum failure or trend reversal signal is triggered (e.g., 5M score flips to the opposite side).",
  stopLossRules: "1. Place stop loss at the 15-minute range midpoint or opposite range boundary.\n2. Max stop loss should not exceed 0.4x of the expected intraday move.",
  confidenceFactors: "15-factor AI confirmation (Overall Trend, 5M/15M Score deltas, T10/T15 sums, PCR value, Live Sentiment pill, Volume & OI Change dominance).",
  realExample: "BUY CE Example:\n15M High = 24,185\n15M Low = 24,102\nSpot = 24,210\nOverall = Positive\n5M = Positive\n15M = Positive\nT10 = Positive\nT15 = Positive\nAdvance > Decline\nResult: 🟢 BUY CE\n\nBUY PE Example:\n15M High = 24,185\n15M Low = 24,102\nSpot = 24,070\nOverall = Negative\nT10 = Negative\nT15 = Negative\nDecline > Advance\nResult: 🔴 BUY PE",
  commonMistakes: "1. Entering before the 15-minute range is frozen (i.e. before 09:30 IST).\n2. Trading breakouts when the market is in a highly compressed low-VIX regime with sideways Option Interest.",
  bestConditions: "High VIX and strong multi-timeframe trend alignment (HIGH_CONFIDENCE_BUY or HIGH_CONFIDENCE_SELL).",
  worstConditions: "Narrow sideways markets or range-bound regimes near heavy Call/Put OI walls.",
  liveDashboardIntegration: "Real-time updates directly linked to the \"First 15 Minute Range Engine\" card in the LIVE tab. Shows live signal indicators and calculations dynamically.",
  notes: "System default trading framework.",
  isSystem: true
};

let loadedStrategies: Strategy[] = [];

export function loadStrategies(): Strategy[] {
  try {
    const dir = path.dirname(STRATEGIES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(STRATEGIES_FILE)) {
      const data = fs.readFileSync(STRATEGIES_FILE, "utf8");
      loadedStrategies = JSON.parse(data);
    } else {
      loadedStrategies = [DEFAULT_STRATEGY];
      saveStrategies();
    }
  } catch (err) {
    console.error("[StrategyStore] Load strategies failed, using default:", err);
    loadedStrategies = [DEFAULT_STRATEGY];
  }
  return loadedStrategies;
}

export function saveStrategies(): void {
  try {
    const dir = path.dirname(STRATEGIES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(loadedStrategies, null, 2), "utf8");
  } catch (err) {
    console.error("[StrategyStore] Save strategies failed:", err);
  }
}

export function getStrategies(): Strategy[] {
  if (loadedStrategies.length === 0) {
    return loadStrategies();
  }
  return loadedStrategies;
}

export function addStrategy(strat: Omit<Strategy, "id">): Strategy {
  const newStrat: Strategy = {
    ...strat,
    id: `strat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    isSystem: false
  };
  loadedStrategies.push(newStrat);
  saveStrategies();
  return newStrat;
}

export function editStrategy(id: string, updatedFields: Partial<Strategy>): Strategy | null {
  const stratIndex = loadedStrategies.findIndex(s => s.id === id);
  if (stratIndex === -1) return null;

  const original = loadedStrategies[stratIndex];
  
  // Prevent altering isSystem directly
  const nextStrat: Strategy = {
    ...original,
    ...updatedFields,
    id: original.id, // cannot change id
    isSystem: original.isSystem // cannot change system status
  };

  loadedStrategies[stratIndex] = nextStrat;
  saveStrategies();
  return nextStrat;
}

export function deleteStrategy(id: string): boolean {
  const strat = loadedStrategies.find(s => s.id === id);
  if (!strat) return false;
  if (strat.isSystem) {
    console.warn(`[StrategyStore] Cannot delete system strategy: ${id}`);
    return false;
  }

  loadedStrategies = loadedStrategies.filter(s => s.id !== id);
  saveStrategies();
  return true;
}
