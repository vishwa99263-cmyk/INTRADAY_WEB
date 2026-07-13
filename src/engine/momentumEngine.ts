/**
 * momentumEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 6: Momentum Engine v2 (Acceleration + Smart Speed Layer)
 *
 * Measures: "Price speed + acceleration + volume conviction + breakout sustainability"
 *
 * Identifies:
 *   - Real momentum vs fake spikes
 *   - Early breakout ignition
 *   - Exhaustion + trap zones
 *   - Institutional continuation flow
 *   - Range breakout validity (Layer 4 confirmation)
 *
 * Pure TypeScript — no React, no side effects.
 * Consumes Layers 1–5 outputs.
 * Output consumed by Layers 7, 8, 9, 10, 11, 12.
 */

import type { MarketRegimeResult } from "./marketRegimeEngine";
import type { MarketBreadthResult } from "./marketBreadthEngine";
import type { HeavyweightResult }   from "./heavyweightEngine";
import type { Range15MResult }       from "./range15mEngine";
import type { OptionChainEngineOutput } from "./optionChainEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MomentumDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type MomentumGrade     = "A" | "B" | "C" | "D";

export interface MomentumEngineOutput {
  /** Composite momentum score 0–100 (50 = neutral) */
  momentumScore: number;

  /** Directional classification */
  momentumDirection: MomentumDirection;

  /** Speed change: positive = accelerating, negative = decelerating */
  acceleration: number;

  /** Volume conviction bonus applied (0, 15, or 25) */
  volumeConviction: number;

  /** Whether a fresh early-ignition signal is detected */
  freshMomentumDetected: boolean;

  /** Raw range layer influence applied (+20 / -20 / 0) */
  rangeInfluence: number;

  /** Raw option chain layer influence applied (+15 / -15 / 0) */
  optionChainInfluence: number;

  /** Raw breadth layer influence applied (+10 / -10 / 0) */
  breadthInfluence: number;

  /** Exhaustion flags */
  exhaustion: {
    bullish: boolean;
    bearish: boolean;
  };

  /**
   * Intraday Range Exhaustion Side:
   * - "REVERSAL_UP"   → market moved too far UP (Nifty 250+, Sensex 800+, BN 220+) → PE likely
   * - "REVERSAL_DOWN" → market moved too far DOWN → CE recovery likely
   * - "NONE"          → no exhaustion detected
   */
  intradayExhaustionSide: "REVERSAL_UP" | "REVERSAL_DOWN" | "NONE";

  /** How many points the index has moved from day open (signed) */
  intradayMovePoints: number;

  /** Institutional quality grade */
  momentumGrade: MomentumGrade;

  /** Human-readable reasons */
  reasoning: string[];

  /** Raw sub-components for diagnostics */
  components: {
    momentumCore: number;
    accelerationContrib: number;
    volumeContrib: number;
    rangeContrib: number;
    optionContrib: number;
    breadthContrib: number;
  };
}

export interface MomentumEngineInput {
  // ── Raw Market Stream ───────────────────────────────────────────────────
  /** Overall index score (sum across all constituent stocks) */
  overallScore: number;
  /** 5M net score change (sum of scoreDifference) */
  scoreDifference: number;
  /** 15M net score change */
  score15mDiff: number;
  /** 30M net score change */
  score30mDiff: number;
  /** 1H net score change */
  score1hDiff: number;
  /** Current aggregate changePercent (spot % change from prev close) */
  changePercent: number;
  /** Current total volume across all stocks */
  volume: number;
  /** Average typical volume (optional — falls back to volume-based heuristic) */
  avgVolume?: number;
  /** Previous 5M score difference (for acceleration delta) */
  prevScoreDifference?: number;

  // ── Intraday Combination Inputs (all optional, safe fallback to 0) ──────────
  /** Current spot price of the active index */
  spotPrice?: number;
  /** Day open price (from live feed) */
  dayOpen?: number;
  /** Day high so far */
  dayHigh?: number;
  /** Day low so far */
  dayLow?: number;
  /** Previous day close */
  prevClose?: number;
  /** Active page — determines exhaustion thresholds */
  activePage?: "NIFTY" | "SENSEX" | "BANKNIFTY";
  /** BankNifty spot (used as confirmation when activePage is NIFTY) */
  bankniftySpot?: number;
  /** BankNifty day open */
  bankniftyDayOpen?: number;
  /** BankNifty day high */
  bankniftyDayHigh?: number;
  /** BankNifty day low */
  bankniftyDayLow?: number;

  // ── Layer 1 ─────────────────────────────────────────────────────────────
  regimeResult: MarketRegimeResult;

  // ── Layer 2 ─────────────────────────────────────────────────────────────
  breadthResult: MarketBreadthResult;

  // ── Layer 3 (optional) ───────────────────────────────────────────────────
  heavyweightResult?: HeavyweightResult;

  // ── Layer 4 (optional) ───────────────────────────────────────────────────
  range15mResult?: Range15MResult;

  // ── Layer 5 (optional) ───────────────────────────────────────────────────
  optionChainResult?: OptionChainEngineOutput;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function safe(v: number | undefined | null, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

// Sigmoid normalisation: maps raw value to 0–100 centred at 0
function sigmoid100(raw: number, k = 0.05): number {
  return clamp(Math.round(100 / (1 + Math.exp(-k * raw))));
}

// Assign momentum grade
function assignGrade(
  score: number,
  accel: number,
  fresh: boolean,
  exhausted: boolean,
): MomentumGrade {
  if (exhausted) return "D";
  if (fresh) return "A";
  if ((score >= 70 && accel > 3) || (score <= 30 && accel < -3)) return "A";
  if ((score >= 60 && accel > 0) || (score <= 40 && accel < 0))  return "B";
  if (Math.abs(score - 50) >= 10)                                 return "C";
  return "D";
}

// ── Main Engine ───────────────────────────────────────────────────────────────

export function computeMomentum(input: MomentumEngineInput): MomentumEngineOutput {
  const {
    overallScore = 0,
    scoreDifference = 0,
    score15mDiff = 0,
    score30mDiff = 0,
    score1hDiff = 0,
    changePercent = 0,
    volume = 0,
    avgVolume = 0,
    prevScoreDifference = 0,
    spotPrice   = 0,
    dayOpen     = 0,
    dayHigh     = 0,
    dayLow      = 0,
    prevClose   = 0,
    activePage  = "NIFTY",
    bankniftySpot     = 0,
    bankniftyDayOpen  = 0,
    bankniftyDayHigh  = 0,
    bankniftyDayLow   = 0,
    regimeResult = {} as any,
    breadthResult = { breadthBias: "NEUTRAL", breadthHealth: "MODERATE" } as any,
    heavyweightResult,
    range15mResult,
    optionChainResult,
  } = input || {};

  const reasoning: string[] = [];

  // Sanitise all inputs
  const S   = safe(overallScore);
  const D5  = safe(scoreDifference);
  const D15 = safe(score15mDiff);
  const D30 = safe(score30mDiff);
  const D1H = safe(score1hDiff);
  const chg = safe(changePercent);
  const vol = safe(volume, 1);
  const avg = safe(avgVolume, vol); // fallback to current volume if avgVolume missing

  // ── 1. Momentum Core ──────────────────────────────────────────────────────
  // Normalise scores to ±100 range first via sigmoid, then weight
  const sCentered  = sigmoid100(S,   0.04) - 50;   // overall score → –50..+50
  const dCentered  = sigmoid100(D5,  0.1)  - 50;   // 5M diff → –50..+50
  const d15Centered = sigmoid100(D15, 0.08) - 50;  // 15M diff → –50..+50
  const chgCentered = clamp(chg * 10, -50, 50);    // changePercent scaled

  const momentumCore =
    sCentered   * 0.35 +
    dCentered   * 0.30 +
    d15Centered * 0.20 +
    chgCentered * 0.15;

  // ── 2. Acceleration Engine ────────────────────────────────────────────────
  // Acceleration = rate of change of 5M momentum + 15M contribution
  const acceleration = (D5 - prevScoreDifference) + (D15 * 0.5);

  // Clamp to reasonable display range
  const accelClamped = Math.max(-100, Math.min(100, acceleration));

  // ── 3. Volume Conviction ──────────────────────────────────────────────────
  const volRatio = avg > 0 ? vol / avg : 1;
  const volumeConviction: number =
    volRatio >= 1.5 ? 25 :
    volRatio >= 1.2 ? 15 : 0;

  // Volume declining = negative conviction signal
  const volumeDeclining = volRatio < 0.85;

  // ── 4. Range Breakout Confirmation (Layer 4) ──────────────────────────────
  let rangeInfluence = 0;
  if (range15mResult) {
    if (range15mResult.rangeBreakout)         rangeInfluence = +20;
    else if (range15mResult.rangeBreakdown)   rangeInfluence = -20;
    else if (range15mResult.falseBreakout)    rangeInfluence = -10;  // trap zone
    else if (range15mResult.spotPosition === "ABOVE_RANGE_HIGH") rangeInfluence = +8;
    else if (range15mResult.spotPosition === "BELOW_RANGE_LOW")  rangeInfluence = -8;
  }

  // ── 5. Option Flow Alignment (Layer 5) ───────────────────────────────────
  let optionChainInfluence = 0;
  if (optionChainResult) {
    if      (optionChainResult.institutionalBias === "BULLISH") optionChainInfluence = +15;
    else if (optionChainResult.institutionalBias === "BEARISH") optionChainInfluence = -15;
    // Smart money bonus
    if      (optionChainResult.smartMoneyDirection === "BULLISH") optionChainInfluence += 5;
    else if (optionChainResult.smartMoneyDirection === "BEARISH") optionChainInfluence -= 5;
    // Clamp
    optionChainInfluence = Math.max(-20, Math.min(20, optionChainInfluence));
  }

  // ── 6. Breadth Confirmation (Layer 2) ────────────────────────────────────
  let breadthInfluence = 0;
  if      (breadthResult.breadthBias === "BULLISH") breadthInfluence = +10;
  else if (breadthResult.breadthBias === "BEARISH") breadthInfluence = -10;

  // Extra breadth penalty for extreme weakness
  if (breadthResult.breadthHealth === "VERY_WEAK") breadthInfluence -= 5;
  else if (breadthResult.breadthHealth === "HEALTHY") breadthInfluence += 5;

  // ── 7. Heavyweight Overlay (Layer 3, optional) ────────────────────────────
  let hwOverlay = 0;
  if (heavyweightResult) {
    if      (heavyweightResult.heavyweightDirection === "STRONG_BULLISH") hwOverlay = +8;
    else if (heavyweightResult.heavyweightDirection === "BULLISH")        hwOverlay = +4;
    else if (heavyweightResult.heavyweightDirection === "BEARISH")        hwOverlay = -4;
    else if (heavyweightResult.heavyweightDirection === "STRONG_BEARISH") hwOverlay = -8;
  }

  // ── 8. Score-Based Exhaustion Detection ──────────────────────────────────
  // Bullish exhaustion: very high score but momentum fading + volume falling
  const bullishExhaustion =
    S > 70 &&
    acceleration < 0 &&
    volumeDeclining;

  // Bearish exhaustion: very low score but momentum bouncing without volume
  const bearishExhaustion =
    S < 30 &&
    acceleration > 0 &&
    volumeDeclining;

  const anyExhaustion = bullishExhaustion || bearishExhaustion;

  // ── 8b. Intraday Combination-Based Exhaustion ─────────────────────────────
  //
  // Real market me sirf "open se kitne points upar" se exhaustion nahi hota.
  // Combination check karna padta hai:
  //   prevClose → kahan se aaya?
  //   dayOpen   → gap up/down tha?
  //   dayLow    → kitna neeche gaya?
  //   dayHigh   → kitna upar gaya?
  //
  // Logic:
  //  dayRange   = dayHigh - dayLow            (total intraday range covered)
  //  gapPoints  = dayOpen - prevClose          (+ve = gap up, -ve = gap down)
  //  upMove     = spot - dayLow               (how far spot has risen from bottom)
  //  downMove   = dayHigh - spot              (how far spot has fallen from top)
  //  rangeCoverage = upMove / dayRange        (0 = at low, 1 = at high)
  //
  // Upside Exhaustion (PE signal) when ANY two of:
  //   A) spot is near dayHigh (within 1% of dayHigh)
  //   B) upMove from dayLow >= exhaustion threshold (e.g. Nifty 280pts)
  //   C) Gap UP (>= 50pts) AND spot is still above dayOpen (hasn't filled gap)
  //   D) rangeCoverage >= 0.80 (spot is in top 20% of day's range)
  //
  // Downside Exhaustion (CE signal) when ANY two of:
  //   A) spot is near dayLow (within 1% of dayLow)
  //   B) downMove from dayHigh >= threshold
  //   C) Gap DOWN (<= -50pts) AND spot is still below dayOpen
  //   D) rangeCoverage <= 0.20 (spot is in bottom 20% of day's range)

  // Per-index exhaustion thresholds (move from day low / day high)
  const EXHST = {
    NIFTY:     { upFromLow: 280, downFromHigh: 280, gapMin: 50,  bnConfirm: 600 },
    SENSEX:    { upFromLow: 900, downFromHigh: 900, gapMin: 150, bnConfirm: 0   },
    BANKNIFTY: { upFromLow: 600, downFromHigh: 600, gapMin: 150, bnConfirm: 0   },
  };
  const thr = EXHST[activePage] || EXHST.NIFTY;

  let intradayMovePoints = 0;  // spot vs dayOpen (for display)
  let intradayExhaustionSide: "REVERSAL_UP" | "REVERSAL_DOWN" | "NONE" = "NONE";
  let exhaustionReason = "";

  const hasData = spotPrice > 0 && dayHigh > 0 && dayLow > 0 && dayHigh >= dayLow;

  if (hasData) {
    intradayMovePoints = dayOpen > 0 ? spotPrice - dayOpen : 0;

    const dayRange       = dayHigh - dayLow;                         // total range
    const upMove         = spotPrice - dayLow;                       // rise from day low
    const downMove       = dayHigh - spotPrice;                      // fall from day high
    const rangeCoverage  = dayRange > 0 ? upMove / dayRange : 0.5;  // 0=at low, 1=at high
    const gapPoints      = prevClose > 0 ? dayOpen - prevClose : 0; // +ve gap up, -ve gap dn
    const nearDayHigh    = dayHigh > 0 && (dayHigh - spotPrice) / dayHigh < 0.005; // within 0.5%
    const nearDayLow     = dayLow  > 0 && (spotPrice - dayLow)  / dayLow  < 0.005; // within 0.5%

    // BankNifty confirmation data (only relevant for NIFTY page)
    const bnRange    = (bankniftyDayHigh > 0 && bankniftyDayLow > 0) ? bankniftyDayHigh - bankniftyDayLow : 0;
    const bnUpMove   = bankniftySpot > 0 && bankniftyDayLow > 0 ? bankniftySpot - bankniftyDayLow : 0;
    const bnDownMove = bankniftySpot > 0 && bankniftyDayHigh > 0 ? bankniftyDayHigh - bankniftySpot : 0;
    const bnRangeCoverage = bnRange > 0 ? bnUpMove / bnRange : 0.5;

    // ── UPSIDE EXHAUSTION CHECK (PE reversal zone) ──────────────────────
    const condA_up = nearDayHigh;                            // spot near day high
    const condB_up = upMove >= thr.upFromLow;               // risen enough from low
    const condC_up = gapPoints >= thr.gapMin && spotPrice > dayOpen; // gap up + still holding
    const condD_up = rangeCoverage >= 0.80;                  // top 20% of day range

    const upCondsMet = [condA_up, condB_up, condC_up, condD_up].filter(Boolean).length;

    // BN confirmation for NIFTY: BN also in top 75%+ of its range
    const bnConfirmsUp = activePage !== "NIFTY" || thr.bnConfirm === 0 ||
      (bnRange > 0 && bnRangeCoverage >= 0.70);

    // ── DOWNSIDE EXHAUSTION CHECK (CE recovery zone) ───────────────────
    const condA_dn = nearDayLow;                             // spot near day low
    const condB_dn = downMove >= thr.downFromHigh;           // fallen enough from high
    const condC_dn = gapPoints <= -thr.gapMin && spotPrice < dayOpen; // gap down + still below
    const condD_dn = rangeCoverage <= 0.20;                  // bottom 20% of day range

    const dnCondsMet = [condA_dn, condB_dn, condC_dn, condD_dn].filter(Boolean).length;

    const bnConfirmsDn = activePage !== "NIFTY" || thr.bnConfirm === 0 ||
      (bnRange > 0 && bnRangeCoverage <= 0.30);

    // ── DECISION: need at least 2 conditions to trigger exhaustion ──────
    if (upCondsMet >= 2 && bnConfirmsUp) {
      intradayExhaustionSide = "REVERSAL_UP";
      const reasons: string[] = [];
      if (condA_up) reasons.push(`Near dayHigh (${dayHigh.toFixed(0)})`);
      if (condB_up) reasons.push(`+${upMove.toFixed(0)}pts from dayLow (${dayLow.toFixed(0)})`);
      if (condC_up) reasons.push(`Gap Up ${gapPoints.toFixed(0)}pts + above open`);
      if (condD_up) reasons.push(`Top ${(rangeCoverage * 100).toFixed(0)}% of day range`);
      exhaustionReason = reasons.join(" | ");
    } else if (dnCondsMet >= 2 && bnConfirmsDn) {
      intradayExhaustionSide = "REVERSAL_DOWN";
      const reasons: string[] = [];
      if (condA_dn) reasons.push(`Near dayLow (${dayLow.toFixed(0)})`);
      if (condB_dn) reasons.push(`${downMove.toFixed(0)}pts from dayHigh (${dayHigh.toFixed(0)})`);
      if (condC_dn) reasons.push(`Gap Down ${Math.abs(gapPoints).toFixed(0)}pts + below open`);
      if (condD_dn) reasons.push(`Bottom ${(rangeCoverage * 100).toFixed(0)}% of day range`);
      exhaustionReason = reasons.join(" | ");
    }
  }


  // ── 9. Fresh Momentum Detection (High-Value Early Signal) ─────────────────
  const freshMomentumDetected =
    S < 55 &&
    Math.abs(S) < 65 &&
    acceleration > 5 &&
    volumeConviction > 15;

  // ── 10. Final Momentum Score ──────────────────────────────────────────────
  // Base 50 = neutral; components shift toward 0 (bearish) or 100 (bullish)
  const accelContrib = clamp(accelClamped * 0.3, -30, 30);

  let rawScore =
    50 +
    momentumCore * 0.4 +
    accelContrib +
    volumeConviction +       // always positive (0, +15, +25)
    rangeInfluence +
    optionChainInfluence +
    breadthInfluence +
    hwOverlay;

  // Exhaustion penalty
  if (anyExhaustion) rawScore = rawScore + (bullishExhaustion ? -15 : +15);

  // Intraday range exhaustion penalty: dampen the score toward neutral
  // When market has moved 250+ pts up, even if score looks bullish, suppress it
  if (intradayExhaustionSide === "REVERSAL_UP") rawScore = rawScore - 20;
  else if (intradayExhaustionSide === "REVERSAL_DOWN") rawScore = rawScore + 20;

  // Fresh momentum bonus (anticipatory)
  if (freshMomentumDetected) rawScore = Math.min(rawScore + 8, 100);

  const momentumScore = clamp(Math.round(rawScore));

  // ── 11. Direction ─────────────────────────────────────────────────────────
  let momentumDirection: MomentumDirection;
  // Intraday exhaustion overrides direction to reflect reversal potential
  if (intradayExhaustionSide === "REVERSAL_UP") {
    // Market ran too far up → momentum is turning BEARISH
    momentumDirection = momentumScore < 60 ? "BEARISH" : "NEUTRAL";
  } else if (intradayExhaustionSide === "REVERSAL_DOWN") {
    // Market ran too far down → momentum is turning BULLISH
    momentumDirection = momentumScore > 40 ? "BULLISH" : "NEUTRAL";
  } else if (momentumScore > 65 && acceleration > 0) {
    momentumDirection = "BULLISH";
  } else if (momentumScore < 35 && acceleration < 0) {
    momentumDirection = "BEARISH";
  } else {
    momentumDirection = "NEUTRAL";
  }

  // ── 12. Grade ─────────────────────────────────────────────────────────────
  const momentumGrade = assignGrade(momentumScore, acceleration, freshMomentumDetected, anyExhaustion);

  // ── 13. Reasoning ─────────────────────────────────────────────────────────
  if (freshMomentumDetected) {
    reasoning.push(`🚀 FRESH MOMENTUM DETECTED — Early breakout ignition (score ${momentumScore}, accel ${acceleration.toFixed(1)})`);
  }

  if (intradayExhaustionSide === "REVERSAL_UP") {
    reasoning.push(`🔄 INTRADAY EXHAUSTION (UP): ${exhaustionReason} → PE reversal zone`);
  } else if (intradayExhaustionSide === "REVERSAL_DOWN") {
    reasoning.push(`🔄 INTRADAY EXHAUSTION (DOWN): ${exhaustionReason} → CE recovery zone`);
  }

  if (bullishExhaustion) {
    reasoning.push(`⚠ BULLISH EXHAUSTION — Score ${S.toFixed(0)} high but momentum fading + volume declining`);
  } else if (bearishExhaustion) {
    reasoning.push(`⚠ BEARISH EXHAUSTION — Score ${S.toFixed(0)} low but bouncing without conviction`);
  }

  if (range15mResult?.rangeBreakout) {
    reasoning.push(`✅ Range Breakout confirmed (+${rangeInfluence} pts) — trend day likely`);
  } else if (range15mResult?.rangeBreakdown) {
    reasoning.push(`✅ Range Breakdown confirmed (${rangeInfluence} pts) — bearish trend`);
  } else if (range15mResult?.falseBreakout) {
    reasoning.push(`⚠ False breakout detected (${rangeInfluence} pts) — trap zone`);
  }

  if (optionChainResult) {
    reasoning.push(
      `Option Chain: ${optionChainResult.institutionalBias} bias (${optionChainInfluence > 0 ? "+" : ""}${optionChainInfluence} pts)`
    );
  }

  reasoning.push(
    `Breadth: ${breadthResult.breadthBias} | Acceleration: ${acceleration > 0 ? "+" : ""}${acceleration.toFixed(1)} | Volume: ${volRatio.toFixed(2)}×`
  );

  reasoning.push(
    `Momentum Grade ${momentumGrade} — Score ${momentumScore}/100 (${momentumDirection})`
  );

  return {
    momentumScore,
    momentumDirection,
    acceleration: parseFloat(accelClamped.toFixed(2)),
    volumeConviction,
    freshMomentumDetected,
    rangeInfluence,
    optionChainInfluence,
    breadthInfluence,
    exhaustion: {
      bullish: bullishExhaustion,
      bearish: bearishExhaustion,
    },
    intradayExhaustionSide,
    intradayMovePoints: parseFloat(intradayMovePoints.toFixed(1)),
    momentumGrade,
    reasoning,
    components: {
      momentumCore:        parseFloat((momentumCore * 0.4).toFixed(2)),
      accelerationContrib: parseFloat(accelContrib.toFixed(2)),
      volumeContrib:       volumeConviction,
      rangeContrib:        rangeInfluence,
      optionContrib:       optionChainInfluence,
      breadthContrib:      breadthInfluence,
    },
  };
}

// ── Direction Metadata (for UI) ───────────────────────────────────────────────

export interface MomentumDirectionMeta {
  label:       string;
  emoji:       string;
  color:       string;
  bgColor:     string;
  borderColor: string;
  glowColor:   string;
}

export const MOMENTUM_DIRECTION_META: Record<MomentumDirection, MomentumDirectionMeta> = {
  BULLISH: {
    label: "BULLISH MOMENTUM",
    emoji: "🚀",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/15",
    borderColor: "border-emerald-500/40",
    glowColor: "rgba(16,185,129,0.20)",
  },
  BEARISH: {
    label: "BEARISH MOMENTUM",
    emoji: "🔻",
    color: "text-red-400",
    bgColor: "bg-red-500/15",
    borderColor: "border-red-500/40",
    glowColor: "rgba(239,68,68,0.20)",
  },
  NEUTRAL: {
    label: "NEUTRAL / CHOP",
    emoji: "〰",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    glowColor: "rgba(245,158,11,0.12)",
  },
};

export const MOMENTUM_GRADE_META: Record<MomentumGrade, { color: string; label: string; bg: string }> = {
  A: { color: "text-emerald-400", bg: "bg-emerald-500/20", label: "INSTITUTIONAL" },
  B: { color: "text-sky-400",     bg: "bg-sky-500/15",     label: "CONFIRMED"     },
  C: { color: "text-amber-400",   bg: "bg-amber-500/15",   label: "DEVELOPING"    },
  D: { color: "text-slate-400",   bg: "bg-slate-800/60",   label: "WEAK / CHOP"   },
};
