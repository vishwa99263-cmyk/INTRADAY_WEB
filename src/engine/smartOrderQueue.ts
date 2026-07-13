// ── Smart Order Queue Engine ──────────────────────────────────────────────────
// Flow: Signal generated → AI calculates discount entry zone →
//       Pending LIMIT order placed → LTP monitor karo →
//       LTP == discountPrice → ORDER ACTIVE (execute)
//       Time limit ya price miss → ORDER EXPIRED/CANCELLED
// ─────────────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | "QUEUED"       // Signal generated, waiting for discount price
  | "MONITORING"   // Actively watching LTP for entry
  | "TRIGGERED"    // LTP reached discount price → order fired
  | "EXECUTED"     // Order placed at broker (Fyers API)
  | "EXPIRED"      // Time limit exceeded without fill
  | "CANCELLED"    // Manually cancelled or price ran away
  | "REJECTED";    // Broker rejected

export type OrderSide = "BUY" | "SELL";
export type OptionType = "CE" | "PE";
export type DiscountMethod =
  | "RETEST"          // Wait for price to retest breakout level (pullback entry)
  | "FIXED_PCT"       // Enter when option premium drops X% from signal price
  | "ATR_PULLBACK"    // Wait for 0.3 ATR pullback from signal candle high/low
  | "VWAP_TOUCH"      // Enter when price touches VWAP
  | "IMMEDIATE";      // No discount — enter at current LTP (market order)

export interface SmartOrderLeg {
  symbol:       string;      // Full trading symbol e.g. "NSE:NIFTY2562524500CE"
  strike:       number;      // Strike price
  optionType:   OptionType;
  side:         OrderSide;
  lots:         number;
  lotSize:      number;
  // Pricing
  signalLTP:    number;      // LTP when signal was generated
  discountPrice: number;     // Target entry price (must reach for order to fire)
  discountPct:  number;      // % discount from signal price
  currentLTP:   number;      // Live LTP (updated by watcher)
  fillPrice:    number;      // Actual fill price (after execution)
  // Thresholds
  maxEntryPrice: number;     // If LTP goes above this → cancel (price ran too far)
  minEntryPrice: number;     // If LTP drops below this → cancel (too cheap, something wrong)
}

export interface SmartPendingOrder {
  id:             string;           // Unique order ID
  strategyId:     string;
  strategyName:   string;
  // Signal context
  signalTime:     string;           // ISO timestamp when signal generated
  signalRegime:   string;           // Market regime at signal time
  aiConfidence:   number;           // AI confidence % at signal
  smartMoneyScore: number;          // Smart money score at signal
  direction:      "BULL" | "BEAR";
  index:          string;           // NIFTY / BANKNIFTY / SENSEX
  expiry:         string;           // Expiry date e.g. "26JUN25"
  // Discount logic
  discountMethod: DiscountMethod;
  underlyingSignalPrice: number;    // Index/stock price at signal time
  underlyingDiscountPrice: number;  // Target underlying price for entry
  underlyingCurrentPrice:  number;  // Current underlying LTP
  // Order legs (spread = 2 legs)
  legs:           SmartOrderLeg[];
  // Status
  status:         OrderStatus;
  statusMessage:  string;           // Human-readable status
  // Timing
  createdAt:      string;
  expiresAt:      string;           // Auto-cancel after this time
  triggeredAt:    string | null;    // When LTP matched
  executedAt:     string | null;    // When broker confirmed
  // Risk (post-execution)
  slPrice:        number;           // Stop loss level on underlying
  targetPrice:    number;           // Profit target level
  maxLossRs:      number;
  targetRs:       number;
  squareOffTime:  string;           // e.g. "15:25"
  // Paper or Live
  paperMode:      boolean;
  // Fill tracking
  totalPremiumPaid:   number;       // Net premium debit (spread)
  breakEvenPrice:     number;       // Underlying price needed to break even
  estimatedPnL:       number;       // Current estimated P&L
}

export interface LTPSnapshot {
  symbol:       string;
  ltp:          number;
  timestamp:    string;
  change:       number;
  changePct:    number;
  volume:       number;
  oi:           number;
}

// ── Discount Price Calculator ─────────────────────────────────────────────────

export interface DiscountCalcInput {
  method:         DiscountMethod;
  signalLTP:      number;         // Option premium at signal time
  underlyingLTP:  number;         // Index price at signal time
  atr:            number;         // 14-period ATR of underlying
  vwap:           number;         // Current VWAP
  breakoutLevel:  number;         // ORB High/Low or key level
  direction:      "BULL" | "BEAR";
  optionType:     OptionType;
}

export interface DiscountCalcResult {
  discountPrice:     number;      // Target option premium for entry
  underlyingTarget:  number;      // Underlying price at which option hits discount
  discountPct:       number;      // % below current premium
  rationale:         string;      // Human-readable explanation
  maxWaitMinutes:    number;      // How long to wait before cancelling
  maxEntryPrice:     number;      // Cancel if premium goes above this (ran away)
}

export function calculateDiscountEntry(input: DiscountCalcInput): DiscountCalcResult {
  const { method, signalLTP, underlyingLTP, atr, vwap, breakoutLevel, direction, optionType } = input;

  switch (method) {
    case "IMMEDIATE":
      return {
        discountPrice:    signalLTP,
        underlyingTarget: underlyingLTP,
        discountPct:      0,
        rationale:        "Immediate entry at current LTP — no discount wait.",
        maxWaitMinutes:   0,
        maxEntryPrice:    signalLTP * 1.05,
      };

    case "FIXED_PCT": {
      // Wait for 5-8% premium reduction (option comes back slightly)
      const pct = optionType === "CE" ? 0.06 : 0.06;
      const dp  = +(signalLTP * (1 - pct)).toFixed(1);
      return {
        discountPrice:    dp,
        underlyingTarget: direction === "BULL"
          ? +(breakoutLevel).toFixed(0)            // Retest breakout level
          : +(breakoutLevel).toFixed(0),
        discountPct:      pct * 100,
        rationale:        `Wait for ${(pct*100).toFixed(0)}% option premium pullback. Entry at Rs.${dp} instead of Rs.${signalLTP}.`,
        maxWaitMinutes:   20,
        maxEntryPrice:    signalLTP * 1.15,        // Cancel if premium spikes 15%+
      };
    }

    case "RETEST": {
      // Wait for underlying to retest the breakout level
      const retestLevel = direction === "BULL"
        ? +(breakoutLevel).toFixed(0)              // Retest ORB High from above
        : +(breakoutLevel).toFixed(0);             // Retest ORB Low from below
      // Approximate option premium at retest: slightly lower for calls, higher for puts
      const premiumAtRetest = direction === "BULL"
        ? +(signalLTP * 0.90).toFixed(1)           // Call cheaper on pullback
        : +(signalLTP * 0.90).toFixed(1);
      return {
        discountPrice:    premiumAtRetest,
        underlyingTarget: retestLevel,
        discountPct:      10,
        rationale:        `Wait for underlying to retest ${retestLevel}. Option entry at ~Rs.${premiumAtRetest}. Better R:R than chasing.`,
        maxWaitMinutes:   30,
        maxEntryPrice:    signalLTP * 1.20,
      };
    }

    case "ATR_PULLBACK": {
      // Wait for 0.3x ATR pullback on underlying
      const pullback     = +(atr * 0.3).toFixed(1);
      const pullbackLevel = direction === "BULL"
        ? +(underlyingLTP - pullback).toFixed(1)   // Nifty pulls back 0.3 ATR
        : +(underlyingLTP + pullback).toFixed(1);
      const premiumPullback = +(signalLTP * 0.88).toFixed(1);
      return {
        discountPrice:    premiumPullback,
        underlyingTarget: pullbackLevel,
        discountPct:      12,
        rationale:        `Wait for 0.3 ATR (${pullback} pts) pullback to ${pullbackLevel}. Option at ~Rs.${premiumPullback}.`,
        maxWaitMinutes:   25,
        maxEntryPrice:    signalLTP * 1.25,
      };
    }

    case "VWAP_TOUCH": {
      // Wait for price to touch VWAP (mean reversion entry)
      const premiumAtVwap = +(signalLTP * 0.92).toFixed(1);
      return {
        discountPrice:    premiumAtVwap,
        underlyingTarget: vwap,
        discountPct:      8,
        rationale:        `Wait for underlying to touch VWAP at ${vwap}. Disciplined entry at ~Rs.${premiumAtVwap}.`,
        maxWaitMinutes:   45,
        maxEntryPrice:    signalLTP * 1.18,
      };
    }

    default:
      return {
        discountPrice:    signalLTP,
        underlyingTarget: underlyingLTP,
        discountPct:      0,
        rationale:        "Immediate entry.",
        maxWaitMinutes:   0,
        maxEntryPrice:    signalLTP * 1.1,
      };
  }
}

// ── Order Builder ─────────────────────────────────────────────────────────────
export function buildSmartOrder(params: {
  strategyId:       string;
  strategyName:     string;
  direction:        "BULL" | "BEAR";
  index:            string;
  expiry:           string;
  discountMethod:   DiscountMethod;
  aiConfidence:     number;
  smartMoneyScore:  number;
  signalRegime:     string;
  underlyingLTP:    number;
  breakoutLevel:    number;
  atr:              number;
  vwap:             number;
  atm:              number;         // ATM strike
  signalOptionLTP:  number;         // Option premium at signal
  optionType:       OptionType;
  symbol:           string;
  lots:             number;
  lotSize:          number;
  maxLossRs:        number;
  targetRs:         number;
  squareOffTime:    string;
  paperMode:        boolean;
}): SmartPendingOrder {
  const disc = calculateDiscountEntry({
    method:         params.discountMethod,
    signalLTP:      params.signalOptionLTP,
    underlyingLTP:  params.underlyingLTP,
    atr:            params.atr,
    vwap:           params.vwap,
    breakoutLevel:  params.breakoutLevel,
    direction:      params.direction,
    optionType:     params.optionType,
  });

  const now     = new Date();
  const expires = new Date(now.getTime() + disc.maxWaitMinutes * 60000);

  const leg: SmartOrderLeg = {
    symbol:        params.symbol,
    strike:        params.atm,
    optionType:    params.optionType,
    side:          "BUY",
    lots:          params.lots,
    lotSize:       params.lotSize,
    signalLTP:     params.signalOptionLTP,
    discountPrice: disc.discountPrice,
    discountPct:   disc.discountPct,
    currentLTP:    params.signalOptionLTP,
    fillPrice:     0,
    maxEntryPrice: disc.maxEntryPrice,
    minEntryPrice: disc.discountPrice * 0.7,   // If drops 30% below target, something wrong
  };

  return {
    id:                `ORD_${params.strategyId}_${Date.now()}`,
    strategyId:        params.strategyId,
    strategyName:      params.strategyName,
    signalTime:        now.toISOString(),
    signalRegime:      params.signalRegime,
    aiConfidence:      params.aiConfidence,
    smartMoneyScore:   params.smartMoneyScore,
    direction:         params.direction,
    index:             params.index,
    expiry:            params.expiry,
    discountMethod:    params.discountMethod,
    underlyingSignalPrice:   params.underlyingLTP,
    underlyingDiscountPrice: disc.underlyingTarget,
    underlyingCurrentPrice:  params.underlyingLTP,
    legs:              [leg],
    status:            "QUEUED",
    statusMessage:     `Waiting for ${params.index} to reach ${disc.underlyingTarget} (discount entry zone)`,
    createdAt:         now.toISOString(),
    expiresAt:         expires.toISOString(),
    triggeredAt:       null,
    executedAt:        null,
    slPrice:           params.direction === "BULL"
                         ? params.underlyingLTP - params.atr * 1.5
                         : params.underlyingLTP + params.atr * 1.5,
    targetPrice:       params.direction === "BULL"
                         ? params.underlyingLTP + params.atr * 2.0
                         : params.underlyingLTP - params.atr * 2.0,
    maxLossRs:         params.maxLossRs,
    targetRs:          params.targetRs,
    squareOffTime:     params.squareOffTime,
    paperMode:         params.paperMode,
    totalPremiumPaid:  0,
    breakEvenPrice:    disc.discountPrice,
    estimatedPnL:      0,
  };
}

// ── LTP Monitor (checks each order against live LTP) ─────────────────────────
export function checkOrderTrigger(
  order: SmartPendingOrder,
  ltpSnapshots: LTPSnapshot[]
): { shouldTrigger: boolean; shouldCancel: boolean; reason: string } {
  const now = new Date();

  // Check expiry
  if (new Date(order.expiresAt) < now) {
    return { shouldTrigger: false, shouldCancel: true, reason: "Time expired — discount price not reached within window." };
  }

  // Find LTP for each leg
  for (const leg of order.legs) {
    const snap = ltpSnapshots.find(s => s.symbol === leg.symbol);
    if (!snap) continue;

    // LTP reached discount price or better
    if (snap.ltp <= leg.discountPrice) {
      return { shouldTrigger: true, shouldCancel: false, reason: `LTP Rs.${snap.ltp} reached discount Rs.${leg.discountPrice} ✓` };
    }

    // LTP ran away — too expensive now
    if (snap.ltp > leg.maxEntryPrice) {
      return { shouldTrigger: false, shouldCancel: true, reason: `LTP Rs.${snap.ltp} exceeded max entry Rs.${leg.maxEntryPrice} — price ran away.` };
    }
  }

  return { shouldTrigger: false, shouldCancel: false, reason: "Monitoring — waiting for discount price..." };
}

// ── Status color helper ───────────────────────────────────────────────────────
export function getOrderStatusColor(status: OrderStatus): string {
  switch (status) {
    case "QUEUED":     return "text-amber-400 bg-amber-500/10 border-amber-500/25";
    case "MONITORING": return "text-sky-400 bg-sky-500/10 border-sky-500/25";
    case "TRIGGERED":  return "text-indigo-400 bg-indigo-500/10 border-indigo-500/25";
    case "EXECUTED":   return "text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
    case "EXPIRED":    return "text-slate-500 bg-slate-800/30 border-slate-700/20";
    case "CANCELLED":  return "text-rose-400 bg-rose-500/10 border-rose-500/25";
    case "REJECTED":   return "text-red-500 bg-red-500/10 border-red-500/25";
    default:           return "text-slate-400 bg-slate-800/20 border-slate-700/20";
  }
}

export function getOrderStatusIcon(status: OrderStatus): string {
  switch (status) {
    case "QUEUED":     return "⏳";
    case "MONITORING": return "👁";
    case "TRIGGERED":  return "⚡";
    case "EXECUTED":   return "✅";
    case "EXPIRED":    return "⌛";
    case "CANCELLED":  return "❌";
    case "REJECTED":   return "🚫";
    default:           return "•";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── AI BRAIN AUTO-CANCELLATION ENGINE ────────────────────────────────────────
// Har pending order ko continuously evaluate karta hai.
// Agar koi bhi cancel condition true ho → order cancel + reason explain karo.
// ─────────────────────────────────────────────────────────────────────────────

export type CancelReason =
  | "TIME_EXPIRED"           // Discount window close ho gayi
  | "REGIME_CHANGED"         // Market regime order ke against ho gaya
  | "AI_CONFIDENCE_DROPPED"  // AI confidence signal level se neeche aayi
  | "SMART_MONEY_EXIT"       // Smart money alag direction mein gaya
  | "VIX_SPIKE"              // India VIX bahut zyada badh gayi
  | "PRICE_RAN_AWAY"         // Price target se bahut door nikal gayi
  | "OI_WALL_DETECTED"       // Bada OI wall aage hai — price ruk sakta hai
  | "BREADTH_DETERIORATED"   // Market breadth negative ho gayi
  | "NO_CANCEL";             // Cancel nahi karna — order valid hai

export type CancelSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AICancelDecision {
  shouldCancel:  boolean;
  reason:        CancelReason;
  severity:      CancelSeverity;
  explanation:   string;          // Hinglish explanation for user
  confidenceLost: number;         // Kitna confidence gira (0-100)
  savedLoss:     number;          // Approximate Rs. loss bachaaya
  aiThought:     string;          // AI ka internal reasoning (1 line)
}

// ── Live market snapshot jo AI evaluate karta hai ────────────────────────────
export interface LiveMarketSnapshot {
  currentRegime:      string;         // e.g. "TRENDING_BEAR"
  aiConfidence:       number;         // Current AI confidence %
  smartMoneyScore:    number;         // Current smart money score
  vix:                number;         // India VIX current value
  vixAtSignal:        number;         // VIX jab signal aaya tha
  breadthScore:       number;         // Market breadth (0–100)
  underlyingLTP:      number;         // Current index price
  oiWallAbove:        number | null;  // Next OI wall strike above (CE side)
  oiWallBelow:        number | null;  // Next OI wall strike below (PE side)
  pcrCurrent:         number;         // Current Put-Call Ratio
  pcrAtSignal:        number;         // PCR jab signal aaya tha
  timeNow:            string;         // ISO timestamp
}

// ── Cancellation Rules Table ──────────────────────────────────────────────────
// Har rule independent check hai. Pehla jo true ho woh cancel trigger karta hai
// (priority order mein hain — sabse important pehle).

interface CancelRule {
  id:        CancelReason;
  check:     (order: SmartPendingOrder, snap: LiveMarketSnapshot) => boolean;
  severity:  CancelSeverity;
  explain:   (order: SmartPendingOrder, snap: LiveMarketSnapshot) => string;
  thought:   (order: SmartPendingOrder, snap: LiveMarketSnapshot) => string;
  savedLoss: (order: SmartPendingOrder) => number;
}

const CANCEL_RULES: CancelRule[] = [

  // ── Rule 1: TIME EXPIRED ────────────────────────────────────────────────────
  {
    id:       "TIME_EXPIRED",
    severity: "HIGH",
    check:    (order) => new Date(order.expiresAt) < new Date(),
    explain:  (order) => {
      const waited = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000);
      return `⌛ ${waited} minute wait kiya — discount price ${order.legs[0]?.discountPrice} nahi aaya. ` +
             `Price aage nikal gayi ya level hold kar rahi hai. Fresh signal ka wait karo.`;
    },
    thought:  (o) => `Waited ${Math.round((Date.now()-new Date(o.createdAt).getTime())/60000)}m, discount not reached. Stale signal — cancel.`,
    savedLoss: (o) => o.maxLossRs * 0.4,
  },

  // ── Rule 2: REGIME CHANGED (Most Critical) ──────────────────────────────────
  {
    id:       "REGIME_CHANGED",
    severity: "CRITICAL",
    check:    (order, snap) => {
      // Bull order → regime bear/breakdown ban gaya
      if (order.direction === "BULL" &&
          (snap.currentRegime === "TRENDING_BEAR" || snap.currentRegime === "BREAKDOWN" || snap.currentRegime === "VOLATILE"))
        return true;
      // Bear order → regime bull/breakout ban gaya
      if (order.direction === "BEAR" &&
          (snap.currentRegime === "TRENDING_BULL" || snap.currentRegime === "BREAKOUT"))
        return true;
      return false;
    },
    explain:  (order, snap) =>
      `🚨 REGIME SHIFT! Order ${order.direction === "BULL" ? "Bullish" : "Bearish"} tha lekin market ab ` +
      `${snap.currentRegime.replace(/_/g," ")} mein hai. Signal invalid ho gaya hai — ` +
      `iss regime mein entry karna = guaranteed loss. CANCEL kiya.`,
    thought:  (o, s) => `Direction ${o.direction} vs regime ${s.currentRegime} — complete mismatch. Cancel immediately.`,
    savedLoss: (o) => o.maxLossRs * 0.95,
  },

  // ── Rule 3: AI CONFIDENCE DROPPED ──────────────────────────────────────────
  {
    id:       "AI_CONFIDENCE_DROPPED",
    severity: "HIGH",
    check:    (order, snap) => {
      // Agar confidence signal ke waqt se 15+ points giri aur 55% se neeche aayi
      const dropped = order.aiConfidence - snap.aiConfidence;
      return dropped >= 15 && snap.aiConfidence < 55;
    },
    explain:  (order, snap) => {
      const dropped = order.aiConfidence - snap.aiConfidence;
      return `📉 AI confidence ${order.aiConfidence}% se gir ke ${snap.aiConfidence}% ho gayi ` +
             `(−${dropped} points). Matlab naye data points signal ko support nahi kar rahe. ` +
             `Low confidence pe entry = risky trade. Cancel kiya.`;
    },
    thought:  (o, s) => `Confidence fell ${o.aiConfidence}→${s.aiConfidence}%. Signal reliability lost. Not worth the risk.`,
    savedLoss: (o) => o.maxLossRs * 0.7,
  },

  // ── Rule 4: SMART MONEY EXIT ────────────────────────────────────────────────
  {
    id:       "SMART_MONEY_EXIT",
    severity: "HIGH",
    check:    (order, snap) => {
      // Smart money score signal se 20+ points gira AND 45 se neeche gaya
      const dropped = order.smartMoneyScore - snap.smartMoneyScore;
      return dropped >= 20 && snap.smartMoneyScore < 45;
    },
    explain:  (order, snap) => {
      const dropped = order.smartMoneyScore - snap.smartMoneyScore;
      return `🏦 Smart Money score ${order.smartMoneyScore} se gir ke ${snap.smartMoneyScore} ho gaya ` +
             `(−${dropped} pts). FII/DII flow humari direction ke against ho gaya hai. ` +
             `Smart money ke khilaf trade = bahut risky. Cancel kiya.`;
    },
    thought:  (o, s) => `Smart money score ${o.smartMoneyScore}→${s.smartMoneyScore}. Institutions moved opposite. Abort.`,
    savedLoss: (o) => o.maxLossRs * 0.8,
  },

  // ── Rule 5: VIX SPIKE ───────────────────────────────────────────────────────
  {
    id:       "VIX_SPIKE",
    severity: "CRITICAL",
    check:    (_order, snap) => {
      // VIX 3+ points upar gayi aur 20 se upar hai
      const vixChange = snap.vix - snap.vixAtSignal;
      return vixChange >= 3 && snap.vix >= 20;
    },
    explain:  (_order, snap) => {
      const vixChange = (snap.vix - snap.vixAtSignal).toFixed(1);
      return `💥 India VIX ${snap.vixAtSignal} se badh ke ${snap.vix} ho gayi (+${vixChange} points). ` +
             `High VIX = extreme volatility = option premiums unpredictable. ` +
             `Is environment mein spread strategy kaam nahi karti. Cancel kiya.`;
    },
    thought:  (_, s) => `VIX spiked to ${s.vix}. Volatility too high for spread strategies. Risk management override.`,
    savedLoss: (o) => o.maxLossRs * 0.85,
  },

  // ── Rule 6: PRICE RAN AWAY ──────────────────────────────────────────────────
  {
    id:       "PRICE_RAN_AWAY",
    severity: "MEDIUM",
    check:    (order, snap) => {
      // Bull order: price itni zyada upar gayi ki discount zone kabhi nahi aayega
      if (order.direction === "BULL") {
        const distanceFromDiscount = snap.underlyingLTP - order.underlyingDiscountPrice;
        return distanceFromDiscount > 80; // 80 points door
      }
      // Bear order: price itna neeche gayi
      if (order.direction === "BEAR") {
        const distanceFromDiscount = order.underlyingDiscountPrice - snap.underlyingLTP;
        return distanceFromDiscount > 80;
      }
      return false;
    },
    explain:  (order, snap) => {
      const dist = Math.abs(snap.underlyingLTP - order.underlyingDiscountPrice);
      return `🏃 Price discount zone se bahut door nikal gayi (${dist.toFixed(0)} pts). ` +
             `Discount target ${order.underlyingDiscountPrice.toLocaleString()} tha, ` +
             `current ${snap.underlyingLTP.toLocaleString()} hai. ` +
             `Ab premium bahut mehanga hoga — chasing karna theek nahi. Cancel kiya.`;
    },
    thought:  (o, s) => `Price ran ${Math.abs(s.underlyingLTP-o.underlyingDiscountPrice).toFixed(0)}pts from discount zone. Entry now too expensive.`,
    savedLoss: (o) => o.maxLossRs * 0.5,
  },

  // ── Rule 7: OI WALL DETECTED ────────────────────────────────────────────────
  {
    id:       "OI_WALL_DETECTED",
    severity: "MEDIUM",
    check:    (order, snap) => {
      // Bull order: target ke pehle bada CE OI wall hai (resistance)
      if (order.direction === "BULL" && snap.oiWallAbove !== null) {
        const wallDist = snap.oiWallAbove - snap.underlyingLTP;
        return wallDist < 50; // Wall sirf 50 points door
      }
      // Bear order: target ke pehle bada PE OI wall hai (support)
      if (order.direction === "BEAR" && snap.oiWallBelow !== null) {
        const wallDist = snap.underlyingLTP - snap.oiWallBelow;
        return wallDist < 50;
      }
      return false;
    },
    explain:  (order, snap) => {
      const wall = order.direction === "BULL" ? snap.oiWallAbove : snap.oiWallBelow;
      return `🧱 Bada OI wall ${wall?.toLocaleString()} pe detect hua — sirf ${
        Math.abs((wall ?? 0) - snap.underlyingLTP).toFixed(0)
      } pts door. ` +
             `Yahan bahut saara ${order.direction === "BULL" ? "Call" : "Put"} OI hai jo price ko ` +
             `${order.direction === "BULL" ? "upar" : "neeche"} jaane se rok sakta hai. ` +
             `Target hit hone ki probability kam ho gayi. Cancel kiya.`;
    },
    thought:  (o, s) => `OI wall at ${o.direction==="BULL"?s.oiWallAbove:s.oiWallBelow} blocks target. R:R no longer valid.`,
    savedLoss: (o) => o.maxLossRs * 0.45,
  },

  // ── Rule 8: BREADTH DETERIORATED ───────────────────────────────────────────
  {
    id:       "BREADTH_DETERIORATED",
    severity: "MEDIUM",
    check:    (order, snap) => {
      // Bull order ke liye breadth 35 se neeche — zyada stocks neeche ja rahe
      if (order.direction === "BULL" && snap.breadthScore < 35) return true;
      // Bear order ke liye breadth 65 se upar — zyada stocks upar ja rahe
      if (order.direction === "BEAR" && snap.breadthScore > 65) return true;
      return false;
    },
    explain:  (order, snap) =>
      `📊 Market breadth score ${snap.breadthScore}/100 — direction ke against hai. ` +
      `${order.direction === "BULL"
        ? "Zyada stocks gir rahe hain — index upar nahi jaayega aasaani se."
        : "Zyada stocks chadh rahe hain — index neeche nahi aayega."} ` +
      `Broad market support nahi hai. Cancel kiya.`,
    thought:  (o, s) => `Breadth ${s.breadthScore} conflicts with ${o.direction} direction. Market not supporting the trade.`,
    savedLoss: (o) => o.maxLossRs * 0.4,
  },

  // ── Default: No Cancel ──────────────────────────────────────────────────────
  {
    id:        "NO_CANCEL",
    severity:  "LOW",
    check:     () => true, // fallback — always at end
    explain:   () => "✅ Sab conditions theek hain. Order valid hai — discount price ka wait karo.",
    thought:   () => "All checks passed. Order remains active.",
    savedLoss: () => 0,
  },
];

// ── Main AI Brain Evaluator ───────────────────────────────────────────────────
export function aiBrainEvaluateOrder(
  order:    SmartPendingOrder,
  snapshot: LiveMarketSnapshot
): AICancelDecision {
  // Only evaluate active orders
  if (order.status !== "MONITORING" && order.status !== "QUEUED") {
    return {
      shouldCancel:   false,
      reason:         "NO_CANCEL",
      severity:       "LOW",
      explanation:    "Order already in terminal state — no evaluation needed.",
      confidenceLost: 0,
      savedLoss:      0,
      aiThought:      "Non-active order. Skip.",
    };
  }

  // Run through rules in priority order
  for (const rule of CANCEL_RULES) {
    if (rule.check(order, snapshot)) {
      const isCancel = rule.id !== "NO_CANCEL";
      const confidenceLost = isCancel
        ? Math.max(0, order.aiConfidence - snapshot.aiConfidence)
        : 0;

      return {
        shouldCancel:   isCancel,
        reason:         rule.id,
        severity:       rule.severity,
        explanation:    rule.explain(order, snapshot),
        confidenceLost,
        savedLoss:      rule.savedLoss(order),
        aiThought:      rule.thought(order, snapshot),
      };
    }
  }

  // Shouldn't reach here but just in case
  return {
    shouldCancel:   false,
    reason:         "NO_CANCEL",
    severity:       "LOW",
    explanation:    "✅ Order valid — monitoring jari hai.",
    confidenceLost: 0,
    savedLoss:      0,
    aiThought:      "All good.",
  };
}

// ── Batch Evaluator (all pending orders ek saath) ─────────────────────────────
export interface BatchCancelResult {
  orderId:    string;
  decision:   AICancelDecision;
}

export function aiBrainEvaluateAll(
  orders:   SmartPendingOrder[],
  snapshot: LiveMarketSnapshot
): BatchCancelResult[] {
  return orders
    .filter(o => o.status === "MONITORING" || o.status === "QUEUED")
    .map(o => ({ orderId: o.id, decision: aiBrainEvaluateOrder(o, snapshot) }));
}

// ── Severity color helper ─────────────────────────────────────────────────────
export function getCancelSeverityStyle(severity: CancelSeverity): string {
  switch (severity) {
    case "CRITICAL": return "text-red-400 bg-red-500/10 border-red-500/30";
    case "HIGH":     return "text-orange-400 bg-orange-500/10 border-orange-500/30";
    case "MEDIUM":   return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    case "LOW":      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  }
}

export function getCancelReasonLabel(reason: CancelReason): string {
  switch (reason) {
    case "TIME_EXPIRED":          return "⌛ Time Expired";
    case "REGIME_CHANGED":        return "🚨 Regime Shift";
    case "AI_CONFIDENCE_DROPPED": return "📉 AI Confidence Giri";
    case "SMART_MONEY_EXIT":      return "🏦 Smart Money Exit";
    case "VIX_SPIKE":             return "💥 VIX Spike";
    case "PRICE_RAN_AWAY":        return "🏃 Price Ran Away";
    case "OI_WALL_DETECTED":      return "🧱 OI Wall Detected";
    case "BREADTH_DETERIORATED":  return "📊 Breadth Weak";
    case "NO_CANCEL":             return "✅ Order Valid";
  }
}
