import * as fs from "fs";
import * as path from "path";

export type SignalOutcome = "WIN" | "LOSS" | "NEUTRAL" | "PENDING";
export type TimeZone = "MORNING" | "MIDDAY" | "AFTERNOON";
export type VixZone  = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export interface SignalRecord {
  id: string;
  timestamp: number;
  page: "NIFTY" | "SENSEX" | "BANKNIFTY";
  signal: string;           // BUY_CE / BUY_PE / WAIT / NO_TRADE
  grade: string;            // A/B/C/D
  score: number;            // antigravityScore at signal time
  spotAtSignal: number;     // Index spot when signal fired
  outcome: SignalOutcome;
  spotAtOutcome?: number;   // Index spot 5 min after signal
  pnlPct?: number;          // Approximate direction move %
  // ── Update 4: Enhanced tracking fields ─────────────────────────────
  timeZone?: TimeZone;       // MORNING (9:15-11), MIDDAY (11-13), AFTERNOON (13-15:30)
  vixAtSignal?: number;     // India VIX at signal time
  vixZone?: VixZone;        // LOW/NORMAL/HIGH/EXTREME
  dailyBiasAtSignal?: string; // STRONG_BULL/BULL/NEUTRAL/BEAR/STRONG_BEAR
  tradeType?: "INTRADAY" | "POSITIONAL";  // Which trade mode
  outcome30m?: SignalOutcome; // Outcome 30 min after (for positional check)
  spotAt30m?: number;         // Spot 30 min after signal
}

export interface SignalMemoryStats {
  totalSignals: number;
  wins: number;
  losses: number;
  neutral: number;
  winRate: number;          // 0-100
  recentWinRate: number;    // Last 10 signals
  confidenceMultiplier: number;
  lastUpdated: number;
  // ── Update 4: Zone-based win rates ────────────────────────────────
  winRateByTimeZone: Record<TimeZone, number>;       // Win rate per time zone
  winRateByVix: Record<VixZone, number>;             // Win rate per VIX zone
  bestTimeZone: TimeZone | null;                     // Which time zone performs best
  bestVixZone: VixZone | null;                       // Which VIX zone performs best
  suggestAvoidMorning: boolean;                      // true if morning win rate < 40%
  suggestAvoidHighVix: boolean;                      // true if HIGH_VIX signals keep losing
}

const MEMORY_FILE = path.join(process.cwd(), "server", "storage", "signal_memory.json");
const MAX_SIGNALS = 100;  // Increased from 50 to 100 for better statistical analysis

// In-memory store
const memoryStore: Record<string, SignalRecord[]> = { NIFTY: [], SENSEX: [], BANKNIFTY: [] };
let _lastStats: Record<string, SignalMemoryStats> = {};

// ── Load from disk on startup ─────────────────────────────────────────────────
function loadMemory(): void {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
      if (data.NIFTY)  memoryStore.NIFTY  = data.NIFTY;
      if (data.SENSEX) memoryStore.SENSEX = data.SENSEX;
      if (data.BANKNIFTY) memoryStore.BANKNIFTY = data.BANKNIFTY;
      console.log("[SignalMemory] Loaded signal history from disk.");
    }
  } catch (e) {
    console.warn("[SignalMemory] Could not load from disk:", e);
  }
}

function saveMemory(): void {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2));
  } catch (e) {
    console.warn("[SignalMemory] Could not save to disk:", e);
  }
}

// Load on module init
loadMemory();

// ── Record a new signal ─────────────────────────────────────────────────────────
export function recordSignal(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  signal: string,
  grade: string,
  score: number,
  spotAtSignal: number,
  // Update 4: new optional context fields
  extras?: {
    vixAtSignal?: number;
    dailyBiasAtSignal?: string;
    tradeType?: "INTRADAY" | "POSITIONAL";
  },
): string {
  const id = `${page}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

  // Determine time zone
  const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  const timeZone: TimeZone = istHour < 11 ? "MORNING" : istHour < 13 ? "MIDDAY" : "AFTERNOON";

  // Determine VIX zone
  const vix = extras?.vixAtSignal ?? 0;
  const vixZone: VixZone = vix <= 0 ? "NORMAL" : vix < 13 ? "LOW" : vix < 18 ? "NORMAL" : vix < 25 ? "HIGH" : "EXTREME";

  const record: SignalRecord = {
    id, timestamp: Date.now(), page, signal, grade, score, spotAtSignal,
    outcome: "PENDING",
    timeZone,
    vixAtSignal: extras?.vixAtSignal,
    vixZone,
    dailyBiasAtSignal: extras?.dailyBiasAtSignal,
    tradeType: extras?.tradeType,
  };
  memoryStore[page].unshift(record);
  if (memoryStore[page].length > MAX_SIGNALS) memoryStore[page].pop();
  saveMemory();
  return id;
}

// ── Resolve pending signals (call every 5 min with current spot) ───────────────
export function resolvePendingSignals(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  currentSpot: number,
  cutoffMs = 5 * 60 * 1000  // 5 minutes
): void {
  const now = Date.now();
  let changed = false;

  memoryStore[page].forEach(r => {
    if (r.outcome !== "PENDING") return;
    if (now - r.timestamp < cutoffMs) return; // Not yet resolved

    r.spotAtOutcome = currentSpot;
    const movePct = ((currentSpot - r.spotAtSignal) / r.spotAtSignal) * 100;
    r.pnlPct = parseFloat(movePct.toFixed(3));

    // Grade outcome
    if (r.signal === "BUY_CE") {
      r.outcome = movePct > 0.2 ? "WIN" : movePct < -0.2 ? "LOSS" : "NEUTRAL";
    } else if (r.signal === "BUY_PE") {
      r.outcome = movePct < -0.2 ? "WIN" : movePct > 0.2 ? "LOSS" : "NEUTRAL";
    } else {
      r.outcome = "NEUTRAL";
    }
    changed = true;
  });

  if (changed) {
    recomputeStats(page);
    saveMemory();
  }
}

// Update 4: 30-min resolution for positional trades ───────────────────────
/** Resolves the 30-min outcome for positional signals (independent of 5-min outcome) */
export function resolvePendingSignals30m(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  currentSpot: number,
): void {
  const cutoff = 30 * 60 * 1000;
  const now = Date.now();
  let changed = false;

  memoryStore[page].forEach(r => {
    if (r.outcome30m !== undefined) return;       // Already resolved
    if (r.tradeType !== "POSITIONAL") return;     // Only for positional
    if (now - r.timestamp < cutoff) return;       // Not 30 min yet

    r.spotAt30m = currentSpot;
    const movePct = ((currentSpot - r.spotAtSignal) / r.spotAtSignal) * 100;

    if (r.signal === "BUY_CE") {
      r.outcome30m = movePct > 0.3 ? "WIN" : movePct < -0.3 ? "LOSS" : "NEUTRAL";
    } else if (r.signal === "BUY_PE") {
      r.outcome30m = movePct < -0.3 ? "WIN" : movePct > 0.3 ? "LOSS" : "NEUTRAL";
    } else {
      r.outcome30m = "NEUTRAL";
    }
    changed = true;
  });

  if (changed) saveMemory();
}

// ── Compute stats ─────────────────────────────────────────────────────────────
function zoneWinRate(
  records: SignalRecord[],
  getter: (r: SignalRecord) => string | undefined,
  zone: string,
): number {
  const zoneRecs = records.filter(r => getter(r) === zone);
  if (zoneRecs.length === 0) return 50; // Default 50% if no data
  const wins = zoneRecs.filter(r => r.outcome === "WIN").length;
  return Math.round((wins / zoneRecs.length) * 100);
}

function recomputeStats(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): SignalMemoryStats {
  const records = memoryStore[page].filter(r => r.outcome !== "PENDING");
  const wins    = records.filter(r => r.outcome === "WIN").length;
  const losses  = records.filter(r => r.outcome === "LOSS").length;
  const neutral = records.filter(r => r.outcome === "NEUTRAL").length;
  const total   = records.length;

  const winRate = total > 0 ? Math.round((wins / total) * 100) : 50;

  // Recent win rate: last 10 resolved signals
  const recent = records.slice(0, 10);
  const recentWins = recent.filter(r => r.outcome === "WIN").length;
  const recentWinRate = recent.length > 0 ? Math.round((recentWins / recent.length) * 100) : 50;

  // Adaptive confidence multiplier
  let confidenceMultiplier = 1.0;
  if (recentWinRate > 70) confidenceMultiplier = Math.min(1.2, 1.0 + (recentWinRate - 70) / 100);
  else if (recentWinRate < 40) confidenceMultiplier = Math.max(0.75, 1.0 - (40 - recentWinRate) / 100);

  // Update 4: Zone-based win rates
  const wrMorning   = zoneWinRate(records, r => r.timeZone, "MORNING");
  const wrMidday    = zoneWinRate(records, r => r.timeZone, "MIDDAY");
  const wrAfternoon = zoneWinRate(records, r => r.timeZone, "AFTERNOON");
  const wrLowVix    = zoneWinRate(records, r => r.vixZone,  "LOW");
  const wrNormalVix = zoneWinRate(records, r => r.vixZone,  "NORMAL");
  const wrHighVix   = zoneWinRate(records, r => r.vixZone,  "HIGH");
  const wrExtremeVix = zoneWinRate(records, r => r.vixZone, "EXTREME");

  const timeRates: Record<TimeZone, number> = { MORNING: wrMorning, MIDDAY: wrMidday, AFTERNOON: wrAfternoon };
  const vixRates:  Record<VixZone,  number> = { LOW: wrLowVix, NORMAL: wrNormalVix, HIGH: wrHighVix, EXTREME: wrExtremeVix };

  const bestTimeZone = (["MORNING", "MIDDAY", "AFTERNOON"] as TimeZone[]).reduce<TimeZone | null>(
    (best, zone) => !best || timeRates[zone] > timeRates[best] ? zone : best, null
  );
  const bestVixZone  = (["LOW", "NORMAL", "HIGH", "EXTREME"] as VixZone[]).reduce<VixZone | null>(
    (best, zone) => !best || vixRates[zone] > vixRates[best] ? zone : best, null
  );

  const stats: SignalMemoryStats = {
    totalSignals: total, wins, losses, neutral, winRate, recentWinRate,
    confidenceMultiplier, lastUpdated: Date.now(),
    winRateByTimeZone: timeRates,
    winRateByVix: vixRates,
    bestTimeZone,
    bestVixZone,
    suggestAvoidMorning: wrMorning < 40 && records.filter(r => r.timeZone === "MORNING").length >= 5,
    suggestAvoidHighVix: wrHighVix < 35 && records.filter(r => r.vixZone === "HIGH").length >= 5,
  };

  _lastStats[page] = stats;
  return stats;
}

export function getSignalMemoryStats(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): SignalMemoryStats {
  if (_lastStats[page]) return _lastStats[page];
  return recomputeStats(page);
}

export function getSignalHistory(page: "NIFTY" | "SENSEX" | "BANKNIFTY"): SignalRecord[] {
  return memoryStore[page];
}
