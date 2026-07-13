/**
 * signalMemoryEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AMEX Layer 17: Signal Memory & Self-Learning Engine
 *
 * Purpose:
 *  - Remembers last 50 signals with outcomes (WIN / LOSS / PENDING)
 *  - Tracks win rate per market condition pattern
 *  - Produces a confidence multiplier for aiBrainEngine
 *  - Enforces cooldown after consecutive losses
 *  - Persists to localStorage across refreshes
 *
 * Pure TypeScript — no React, no side effects (localStorage accessed via
 * injected adapter so the engine stays testable).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalDirection   = "BUY_CE" | "BUY_PE" | "WAIT" | "NO_TRADE";
export type SignalOutcome     = "WIN" | "LOSS" | "BREAKEVEN" | "PENDING";
export type MemoryBrainState  = "AGGRESSIVE" | "CONSERVATIVE" | "LEARNING" | "LOCKED";

export interface SignalConditionSnapshot {
  pcrBucket:       "LOW" | "NEUTRAL" | "HIGH";      // <0.8 | 0.8–1.2 | >1.2
  vixBucket:       "LOW" | "MEDIUM" | "HIGH";        // <12 | 12–18 | >18
  regimeBucket:    "TREND" | "RANGE" | "VOLATILE";
  momentumBucket:  "WEAK" | "MODERATE" | "STRONG";   // <40 | 40–70 | >70
  timeSession:     "OPENING" | "MIDDAY" | "CLOSING"; // 9:15–10:30 | 10:30–14:00 | 14:00–15:30
  isExpiryDay:     boolean;
}

export interface SignalRecord {
  id:          string;
  timestamp:   number;
  direction:   SignalDirection;
  confidence:  number;
  grade:       string;
  conditions:  SignalConditionSnapshot;
  outcome:     SignalOutcome;
  pnl?:        number;   // ₹ actual P&L if known
}

export interface ConditionWinRate {
  conditionKey:  string;
  wins:          number;
  losses:        number;
  winRate:       number;  // 0–100
  sampleSize:    number;
}

export interface SignalMemoryResult {
  /** All stored signals (newest first) */
  signals:              SignalRecord[];

  /** Overall win rate across all signals */
  overallWinRate:       number;

  /** Win rate in last 10 signals */
  recentWinRate:        number;

  /** Confidence multiplier for AI Brain: 0.6 – 1.3 */
  confidenceMultiplier: number;

  /** Consecutive losses in a row */
  consecutiveLosses:    number;

  /** Is cooldown active? */
  cooldownActive:       boolean;

  /** Cooldown ends at (epoch ms) */
  cooldownEndsAt:       number;

  /** Cooldown remaining seconds */
  cooldownRemainingSeconds: number;

  /** Best performing condition */
  bestCondition:        ConditionWinRate | null;

  /** Worst performing condition */
  worstCondition:       ConditionWinRate | null;

  /** Per-condition win rates */
  conditionWinRates:    ConditionWinRate[];

  /** Overall brain state */
  brainState:           MemoryBrainState;

  /** Total signals recorded */
  totalSignals:         number;

  /** Total wins */
  wins:                 number;

  /** Total losses */
  losses:               number;
}

export interface SignalMemoryInput {
  /** Current AI decision (to compare against new signals) */
  currentDirection:   SignalDirection;
  currentConfidence:  number;
  currentGrade:       string;

  /** Market condition snapshot */
  pcr:                number;
  indiaVix:           number;
  regime:             string;
  momentumScore:      number;
  isExpiryDay?:       boolean;

  /** Closed paper trades (to resolve PENDING outcomes) */
  closedTrades?: Array<{
    direction:    string;
    entry_price:  number;
    exit_price:   number;
    timestamp:    number;
    closed_at?:   number;
  }>;

  /** localStorage key to use (allows isolation per instrument) */
  storageKey?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_STORAGE_KEY   = "amex_signal_memory_v1";
const MAX_SIGNALS           = 50;
const COOLDOWN_MS           = 30 * 60 * 1000;   // 30 min after 3 consecutive losses
const COOLDOWN_TRIGGER      = 3;                  // consecutive losses to trigger cooldown

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function pcrBucket(pcr: number): SignalConditionSnapshot["pcrBucket"] {
  if (pcr < 0.8) return "LOW";
  if (pcr > 1.2) return "HIGH";
  return "NEUTRAL";
}

function vixBucket(vix: number): SignalConditionSnapshot["vixBucket"] {
  if (vix < 12) return "LOW";
  if (vix > 18) return "HIGH";
  return "MEDIUM";
}

function regimeBucket(regime: string): SignalConditionSnapshot["regimeBucket"] {
  if (regime.includes("TREND")) return "TREND";
  if (regime.includes("VOLAT")) return "VOLATILE";
  return "RANGE";
}

function momentumBucket(score: number): SignalConditionSnapshot["momentumBucket"] {
  if (score < 40) return "WEAK";
  if (score > 70) return "STRONG";
  return "MODERATE";
}

function timeSession(ts: number): SignalConditionSnapshot["timeSession"] {
  const istDate = new Date(ts + 5.5 * 60 * 60 * 1000);
  const mins    = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
  if (mins < 630)  return "OPENING";  // before 10:30
  if (mins < 840)  return "MIDDAY";   // before 14:00
  return "CLOSING";
}

function conditionKey(c: SignalConditionSnapshot): string {
  return `${c.pcrBucket}_${c.vixBucket}_${c.regimeBucket}_${c.momentumBucket}_${c.timeSession}${c.isExpiryDay ? "_EXP" : ""}`;
}

/** localStorage adapter — safe for SSR / test environments */
const storage = {
  get(key: string): SignalRecord[] {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (!raw) return [];
      return JSON.parse(raw) as SignalRecord[];
    } catch {
      return [];
    }
  },
  set(key: string, signals: SignalRecord[]): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, JSON.stringify(signals));
      }
    } catch {
      // storage quota exceeded — trim and retry
      try {
        const trimmed = signals.slice(0, Math.floor(MAX_SIGNALS / 2));
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(key, JSON.stringify(trimmed));
        }
      } catch { /* silent fail */ }
    }
  },
};

// ── Outcome Resolver ──────────────────────────────────────────────────────────

/** Resolve PENDING signals by matching closed trades */
function resolvePending(
  signals: SignalRecord[],
  closedTrades: SignalMemoryInput["closedTrades"] = [],
): SignalRecord[] {
  if (!closedTrades || closedTrades.length === 0) return signals;

  return signals.map(sig => {
    if (sig.outcome !== "PENDING") return sig;

    // Find a closed trade within 30 min of signal that matches direction
    const match = closedTrades.find(t => {
      const tradeTime = t.closed_at || t.timestamp;
      const deltaMs   = Math.abs(tradeTime - sig.timestamp);
      const dirMatch  = t.direction === sig.direction;
      return dirMatch && deltaMs < 30 * 60 * 1000;
    });

    if (!match) return sig;

    const pnl      = (match.exit_price - match.entry_price) * (sig.direction === "BUY_PE" ? -1 : 1);
    const outcome: SignalOutcome =
      pnl > 5   ? "WIN"       :
      pnl < -5  ? "LOSS"      :
                  "BREAKEVEN";

    return { ...sig, outcome, pnl };
  });
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeSignalMemory(input: SignalMemoryInput): SignalMemoryResult {
  const {
    currentDirection,
    currentConfidence,
    currentGrade,
    pcr,
    indiaVix,
    regime,
    momentumScore,
    isExpiryDay   = false,
    closedTrades  = [],
    storageKey    = DEFAULT_STORAGE_KEY,
  } = input;

  const now = Date.now();

  // 1. Load existing signals from localStorage
  let signals = storage.get(storageKey);

  // 2. Resolve any PENDING outcomes from closed trades
  signals = resolvePending(signals, closedTrades);

  // 3. Build current condition snapshot
  const conditions: SignalConditionSnapshot = {
    pcrBucket:      pcrBucket(pcr),
    vixBucket:      vixBucket(indiaVix),
    regimeBucket:   regimeBucket(regime),
    momentumBucket: momentumBucket(momentumScore),
    timeSession:    timeSession(now),
    isExpiryDay,
  };

  // 4. If a new tradeable signal, record it
  if (currentDirection === "BUY_CE" || currentDirection === "BUY_PE") {
    // Don't duplicate — skip if last signal was same direction within 5 min
    const last = signals[0];
    const isDuplicate = last &&
      last.direction === currentDirection &&
      (now - last.timestamp) < 5 * 60 * 1000;

    if (!isDuplicate) {
      const newRecord: SignalRecord = {
        id:         `sig_${now}`,
        timestamp:  now,
        direction:  currentDirection,
        confidence: currentConfidence,
        grade:      currentGrade,
        conditions,
        outcome:    "PENDING",
      };
      signals = [newRecord, ...signals].slice(0, MAX_SIGNALS);
      storage.set(storageKey, signals);
    }
  } else {
    // Even if WAIT/NO_TRADE — save resolved outcomes
    storage.set(storageKey, signals);
  }

  // 5. Compute win/loss stats from resolved signals
  const resolved = signals.filter(s => s.outcome !== "PENDING");
  const wins     = resolved.filter(s => s.outcome === "WIN").length;
  const losses   = resolved.filter(s => s.outcome === "LOSS").length;
  const total    = resolved.length;

  const overallWinRate = total > 0 ? Math.round((wins / total) * 100) : 50;

  // Recent 10 signals
  const recent10   = resolved.slice(0, 10);
  const recentWins = recent10.filter(s => s.outcome === "WIN").length;
  const recentWinRate = recent10.length > 0
    ? Math.round((recentWins / recent10.length) * 100)
    : overallWinRate;

  // 6. Consecutive losses (from newest)
  let consecutiveLosses = 0;
  for (const sig of signals) {
    if (sig.outcome === "LOSS") consecutiveLosses++;
    else if (sig.outcome !== "PENDING") break;
  }

  // 7. Cooldown logic
  let cooldownActive = false;
  let cooldownEndsAt = 0;

  // Check if a cooldown was previously stored
  try {
    const storedCooldown = typeof localStorage !== "undefined"
      ? localStorage.getItem(`${storageKey}_cooldown`)
      : null;
    if (storedCooldown) {
      const endsAt = parseInt(storedCooldown, 10);
      if (endsAt > now) {
        cooldownActive = true;
        cooldownEndsAt = endsAt;
      } else {
        // Expired — clear it
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem(`${storageKey}_cooldown`);
        }
      }
    }
  } catch { /* ignore */ }

  // Trigger new cooldown if consecutive losses hit threshold
  if (consecutiveLosses >= COOLDOWN_TRIGGER && !cooldownActive) {
    cooldownEndsAt = now + COOLDOWN_MS;
    cooldownActive = true;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`${storageKey}_cooldown`, String(cooldownEndsAt));
      }
    } catch { /* ignore */ }
  }

  const cooldownRemainingSeconds = cooldownActive
    ? Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))
    : 0;

  // 8. Per-condition win rates
  const conditionMap: Record<string, { wins: number; losses: number }> = {};
  resolved.forEach(sig => {
    const key = conditionKey(sig.conditions);
    if (!conditionMap[key]) conditionMap[key] = { wins: 0, losses: 0 };
    if (sig.outcome === "WIN")  conditionMap[key].wins++;
    if (sig.outcome === "LOSS") conditionMap[key].losses++;
  });

  const conditionWinRates: ConditionWinRate[] = Object.entries(conditionMap)
    .map(([key, { wins: w, losses: l }]) => ({
      conditionKey: key,
      wins: w,
      losses: l,
      winRate: (w + l) > 0 ? Math.round((w / (w + l)) * 100) : 50,
      sampleSize: w + l,
    }))
    .filter(c => c.sampleSize >= 3)
    .sort((a, b) => b.winRate - a.winRate);

  const bestCondition  = conditionWinRates[0]  ?? null;
  const worstCondition = conditionWinRates[conditionWinRates.length - 1] ?? null;

  // 9. Confidence multiplier: 0.6 – 1.3
  // Base: recent win rate (50% = 1.0x, 70% = 1.15x, 30% = 0.75x)
  let multiplier = 1.0;
  if (total >= 5) {
    multiplier = 0.6 + (recentWinRate / 100) * 0.7; // 0.6 at 0%, 1.3 at 100%
  }
  // Cooldown penalty
  if (cooldownActive) multiplier = Math.min(multiplier, 0.65);
  // Consecutive losses light penalty
  if (consecutiveLosses >= 2) multiplier -= 0.10;
  multiplier = clamp(multiplier, 0.55, 1.30);
  multiplier = parseFloat(multiplier.toFixed(2));

  // 10. Brain state
  let brainState: MemoryBrainState = "LEARNING";
  if (cooldownActive)          brainState = "LOCKED";
  else if (total < 5)          brainState = "LEARNING";
  else if (recentWinRate >= 65) brainState = "AGGRESSIVE";
  else if (recentWinRate >= 45) brainState = "CONSERVATIVE";
  else                          brainState = "LOCKED";

  return {
    signals,
    overallWinRate,
    recentWinRate,
    confidenceMultiplier: multiplier,
    consecutiveLosses,
    cooldownActive,
    cooldownEndsAt,
    cooldownRemainingSeconds,
    bestCondition,
    worstCondition,
    conditionWinRates,
    brainState,
    totalSignals: signals.length,
    wins,
    losses,
  };
}
