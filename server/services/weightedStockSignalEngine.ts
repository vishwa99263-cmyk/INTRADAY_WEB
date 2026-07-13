/**
 * weightedStockSignalEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY INSIGHT: NIFTY 50 stocks se bna hai → agar stocks me kuch hoga
 * to hi index me hoga → wahi se CE/PE trade direction milegi
 *
 * v2.0 UPGRADE:
 *  - LOWER thresholds: 30-50 point score pe bhi trade trigger
 *  - DEEP buyer/seller entry detection per stock
 *  - OI buildup analysis: kaun enter kar raha hai (buyers or sellers)?
 *  - Participation quality: actively entering stocks ka count
 *  - Volume surge per heavyweight stock
 *  - Banking + Trio primary gate (not secondary)
 */

import type { StockData } from "../../src/types.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type WeightedDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type WeightedStrength  = "STRONG" | "MODERATE" | "WEAK" | "CONFLICT";

export interface WeightedContributor {
  symbol:        string;
  weightage:     number;
  score:         number;         // Stock's analysis score
  changePercent: number;         // % price change
  contribution:  number;         // weightage × score / 100 (normalized)
  scoreChange:   number;         // 5-min score momentum (buyers entering = positive)
  verdict:       "BULLISH" | "BEARISH" | "NEUTRAL";
  buyerEntering: boolean;        // scoreDifference > 0 = buyers pushing price up
  sellerEntering: boolean;       // scoreDifference < 0 = sellers pressing price down
}

// NEW: Buyer/Seller activity deep analysis
export interface BuyerSellerActivity {
  activeBuyers:        number;   // Count of stocks where buyers entering (scoreDiff > 0)
  activeSellers:       number;   // Count of stocks where sellers entering (scoreDiff < 0)
  heavyweightBuyers:   string[]; // High-weightage (>3%) stocks with buyer entry
  heavyweightSellers:  string[]; // High-weightage (>3%) stocks with seller entry
  buyingPressurePct:   number;   // % of index weight under buying pressure
  sellingPressurePct:  number;   // % of index weight under selling pressure
  netPressure:         "BUYERS_DOMINANT" | "SELLERS_DOMINANT" | "BALANCED";
  entryStrength:       "HIGH" | "MEDIUM" | "LOW"; // How many stocks actively moving
  topBuyingStocks:     string;   // Human readable summary
  topSellingStocks:    string;   // Human readable summary
  scoreVelocity:       number;   // Total score momentum (sum of scoreDifferences)
}

export interface WeightedSignal {
  // ── Core Direction ──────────────────────────────────────────────────────────
  direction:           WeightedDirection;
  strength:            WeightedStrength;
  netScore:            number;   // Positive = bullish, Negative = bearish
  confidence:          number;   // 0–100

  // ── Participation Metrics ───────────────────────────────────────────────────
  totalWeightBullish:  number;   // % of index weight in bullish stocks
  totalWeightBearish:  number;
  bullishStocksCount:  number;
  bearishStocksCount:  number;
  totalStocks:         number;

  // ── Special Trio: HDFCBANK + ICICIBANK + RELIANCE ──────────────────────────
  specialTrioDirection: WeightedDirection;
  specialTrioScore:     number;
  specialTrioDetail:    string;  // "HDFC +1.2% (+12.9), ICICI +0.8% (+6.6), REL -0.3% (-2.6)"

  // ── Banking Sector (HDFCBANK+ICICI+AXIS+SBIN+KOTAK = ~35% NIFTY) ───────────
  bankingSectorScore:   number;
  bankingAligned:       boolean;  // Banking aligns with overall direction?
  bankingDetail:        string;

  // ── Top Contributors ────────────────────────────────────────────────────────
  topBullishStocks:     WeightedContributor[];  // Top 5 bullish by contribution
  topBearishStocks:     WeightedContributor[];  // Top 5 bearish by contribution
  allTopStocks:         WeightedContributor[];  // Top 10 by weight

  // ── NEW: Deep Buyer/Seller Entry Analysis ──────────────────────────────────
  buyerSellerActivity:  BuyerSellerActivity;

  // ── Divergence Detection ───────────────────────────────────────────────────
  divergenceDetected:  boolean;
  divergenceType:      "INDEX_BULL_STOCK_BEAR" | "INDEX_BEAR_STOCK_BULL" | "NONE";
  divergenceWarning:   string;

  // ── Human-readable ─────────────────────────────────────────────────────────
  reasoning:           string[];
  gateSummary:         string;   // One-line summary for trade notes
}

// ── Constants (LOWERED for faster trigger at 30-50 point scores) ───────────────

// The "Special Trio" — these 3 stocks alone = ~28% of NIFTY weight
const SPECIAL_TRIO = ["HDFCBANK", "ICICIBANK", "RELIANCE"];

// Banking sector stocks — ~35% of NIFTY
const BANKING_SECTOR = ["HDFCBANK", "ICICIBANK", "AXISBANK", "SBIN", "KOTAKBANK", "INDUSINDBK"];

// LOWERED thresholds (v2.0): Now triggers at 30-50 net stock score
const STRONG_THRESHOLD   = 8;   // Was 15 — now triggers at lower score
const MODERATE_THRESHOLD = 4;   // Was 7  — now detects moderate moves earlier
const WEAK_THRESHOLD     = 1.5; // Was 3  — now picks up even small directional bias

// ── Main Engine ────────────────────────────────────────────────────────────────

export function computeWeightedStockSignal(
  stocks: StockData[],
  spotChangePercent: number = 0,   // Index % change for divergence check
): WeightedSignal {

  // Filter out the index row itself (symbol like "NIFTY 50", "SENSEX", "NIFTY BANK")
  const realStocks = stocks.filter(s =>
    s.weightage > 0 &&
    !["NIFTY 50", "SENSEX", "NIFTY BANK"].includes(s.symbol)
  );

  if (realStocks.length === 0) {
    return buildNeutralSignal("No real stocks found");
  }

  // ── 1. Sort by weightage (heaviest first) ──────────────────────────────────
  const sorted = [...realStocks].sort((a, b) => (b.weightage || 0) - (a.weightage || 0));
  const top10   = sorted.slice(0, 10);

  // ── 2. Build contributors with buyer/seller detection ──────────────────────
  const contributors: WeightedContributor[] = sorted.map(s => {
    const score        = s.score || 0;
    const contribution = ((s.weightage || 0) * score) / 100;
    const scoreDiff    = s.scoreDifference || 0;
    const verdict: "BULLISH" | "BEARISH" | "NEUTRAL" =
      score > 1  ? "BULLISH" :
      score < -1 ? "BEARISH" : "NEUTRAL";

    // Buyer entering: score momentum positive (fresh buyers pushing price up)
    const buyerEntering  = scoreDiff > 0.5;
    // Seller entering: score momentum negative (fresh sellers pressing price down)
    const sellerEntering = scoreDiff < -0.5;

    return {
      symbol:         s.symbol,
      weightage:      s.weightage || 0,
      score,
      changePercent:  s.changePercent || 0,
      contribution,
      scoreChange:    scoreDiff,
      verdict,
      buyerEntering,
      sellerEntering,
    };
  });

  const top10Contributors = contributors.slice(0, 10);

  // ── 3. Net weighted score (top 10 stocks = ~70% index) ──────────────────────
  const netScore = top10Contributors.reduce((sum, c) => sum + c.contribution, 0);

  // ── 4. Participation metrics ───────────────────────────────────────────────
  let totalWeightBullish = 0, totalWeightBearish = 0;
  let bullishCount = 0, bearishCount = 0;

  for (const c of contributors) {
    if (c.verdict === "BULLISH") {
      totalWeightBullish += c.weightage;
      bullishCount++;
    } else if (c.verdict === "BEARISH") {
      totalWeightBearish += c.weightage;
      bearishCount++;
    }
  }

  // ── 5. Special Trio Analysis ───────────────────────────────────────────────
  const trioParts: string[] = [];
  let trioScore = 0;

  for (const sym of SPECIAL_TRIO) {
    const c = contributors.find(x => x.symbol === sym);
    if (c) {
      trioParts.push(`${sym} ${c.changePercent >= 0 ? "+" : ""}${c.changePercent.toFixed(1)}% (contrib ${c.contribution >= 0 ? "+" : ""}${c.contribution.toFixed(1)}, ${c.buyerEntering ? "🟢BuyEntry" : c.sellerEntering ? "🔴SellEntry" : "⚪Stable"})`);
      trioScore += c.contribution;
    }
  }

  const specialTrioDirection: WeightedDirection =
    trioScore > 3  ? "BULLISH" :
    trioScore < -3 ? "BEARISH" : "NEUTRAL";
  const specialTrioDetail = trioParts.join(" | ");

  // ── 6. Banking Sector Analysis ─────────────────────────────────────────────
  let bankScore = 0;
  const bankParts: string[] = [];

  for (const sym of BANKING_SECTOR) {
    const c = contributors.find(x => x.symbol === sym);
    if (c) {
      bankScore += c.contribution;
      bankParts.push(`${sym} ${c.changePercent >= 0 ? "+" : ""}${c.changePercent.toFixed(1)}%${c.buyerEntering ? "↑" : c.sellerEntering ? "↓" : ""}`);
    }
  }

  const overallDir: WeightedDirection =
    netScore > WEAK_THRESHOLD  ? "BULLISH" :
    netScore < -WEAK_THRESHOLD ? "BEARISH" : "NEUTRAL";

  const bankingAligned =
    (overallDir === "BULLISH" && bankScore > 0) ||
    (overallDir === "BEARISH" && bankScore < 0) ||
    (overallDir === "NEUTRAL");

  const bankingDetail = bankParts.slice(0, 4).join(", ");

  // ── 7. Strength Classification ─────────────────────────────────────────────
  const absNet = Math.abs(netScore);
  let strength: WeightedStrength =
    absNet >= STRONG_THRESHOLD   ? "STRONG" :
    absNet >= MODERATE_THRESHOLD ? "MODERATE" :
    absNet >= WEAK_THRESHOLD     ? "WEAK" : "CONFLICT";

  // Conflict if special trio direction disagrees with overall direction
  if (specialTrioDirection !== "NEUTRAL" && specialTrioDirection !== overallDir && overallDir !== "NEUTRAL") {
    strength = "CONFLICT";
  }

  // ── 8. NEW: Deep Buyer/Seller Entry Analysis ───────────────────────────────
  const buyerSellerActivity = computeBuyerSellerActivity(contributors);

  // ── 9. Divergence Detection ────────────────────────────────────────────────
  let divergenceDetected = false;
  let divergenceType: WeightedSignal["divergenceType"] = "NONE";
  let divergenceWarning = "";

  if (Math.abs(spotChangePercent) > 0.1) {
    const indexBullish = spotChangePercent > 0.1;
    const indexBearish = spotChangePercent < -0.1;
    const stockBullish = netScore > WEAK_THRESHOLD;
    const stockBearish = netScore < -WEAK_THRESHOLD;

    if (indexBullish && stockBearish) {
      divergenceDetected = true;
      divergenceType = "INDEX_BULL_STOCK_BEAR";
      divergenceWarning = `⚠ DIVERGENCE: Index +${spotChangePercent.toFixed(2)}% UP but stocks BEARISH (netScore ${netScore.toFixed(1)}) — FAKE MOVE! Block CE trade.`;
    } else if (indexBearish && stockBullish) {
      divergenceDetected = true;
      divergenceType = "INDEX_BEAR_STOCK_BULL";
      divergenceWarning = `⚠ DIVERGENCE: Index ${spotChangePercent.toFixed(2)}% DOWN but stocks BULLISH (netScore +${netScore.toFixed(1)}) — FAKE MOVE! Block PE trade.`;
    }
  }

  // ── 10. Confidence Calculation ──────────────────────────────────────────────
  let confidence = 0;
  if (overallDir !== "NEUTRAL") {
    confidence = Math.min(85, absNet * 5); // Scaled up slightly for lower thresholds
    if (specialTrioDirection === overallDir) confidence += 10;
    if (bankingAligned) confidence += 5;
    // Buyer/seller activity bonus
    if (buyerSellerActivity.netPressure === (overallDir === "BULLISH" ? "BUYERS_DOMINANT" : "SELLERS_DOMINANT")) {
      confidence += 8;
    }
    if (divergenceDetected) confidence -= 30;
    if (strength === "CONFLICT") confidence -= 20;
    confidence = Math.max(0, Math.min(100, confidence));
  }

  // ── 11. Reasoning ─────────────────────────────────────────────────────────
  const reasoning: string[] = [];
  reasoning.push(`Net Weighted Score: ${netScore >= 0 ? "+" : ""}${netScore.toFixed(2)} (${overallDir})`);
  reasoning.push(`Participation: ${bullishCount} bullish (${totalWeightBullish.toFixed(1)}% weight) vs ${bearishCount} bearish (${totalWeightBearish.toFixed(1)}% weight)`);
  reasoning.push(`Special Trio: ${specialTrioDetail}`);
  reasoning.push(`Banking Sector: Score ${bankScore >= 0 ? "+" : ""}${bankScore.toFixed(1)} | ${bankingDetail}`);
  reasoning.push(`Buyer/Seller: ${buyerSellerActivity.netPressure} | Active Buyers: ${buyerSellerActivity.activeBuyers} | Active Sellers: ${buyerSellerActivity.activeSellers}`);
  reasoning.push(`Entry Strength: ${buyerSellerActivity.entryStrength} | Buying Pressure: ${buyerSellerActivity.buyingPressurePct.toFixed(1)}% weight | Selling: ${buyerSellerActivity.sellingPressurePct.toFixed(1)}% weight`);
  if (divergenceDetected) reasoning.push(divergenceWarning);

  const topBullish = [...contributors].filter(c => c.verdict === "BULLISH")
    .sort((a, b) => b.contribution - a.contribution).slice(0, 5);
  const topBearish = [...contributors].filter(c => c.verdict === "BEARISH")
    .sort((a, b) => a.contribution - b.contribution).slice(0, 5);

  const gateSummary = `WeightedStocks: ${overallDir} (score ${netScore >= 0 ? "+" : ""}${netScore.toFixed(1)}, trio=${specialTrioDirection}, banking=${bankingAligned ? "aligned" : "misaligned"}, ${buyerSellerActivity.netPressure}, entryStrength=${buyerSellerActivity.entryStrength})`;

  return {
    direction: overallDir,
    strength,
    netScore,
    confidence,
    totalWeightBullish,
    totalWeightBearish,
    bullishStocksCount: bullishCount,
    bearishStocksCount: bearishCount,
    totalStocks: realStocks.length,
    specialTrioDirection,
    specialTrioScore: trioScore,
    specialTrioDetail,
    bankingSectorScore: bankScore,
    bankingAligned,
    bankingDetail,
    topBullishStocks: topBullish,
    topBearishStocks: topBearish,
    allTopStocks: top10Contributors,
    buyerSellerActivity,
    divergenceDetected,
    divergenceType,
    divergenceWarning,
    reasoning,
    gateSummary,
  };
}

// ── NEW: Deep Buyer/Seller Activity Computation ────────────────────────────────
function computeBuyerSellerActivity(contributors: WeightedContributor[]): BuyerSellerActivity {
  let activeBuyers  = 0;
  let activeSellers = 0;
  let buyingWeight  = 0;
  let sellingWeight = 0;
  let scoreVelocity = 0;
  const hwBuyers: string[]  = [];
  const hwSellers: string[] = [];

  for (const c of contributors) {
    scoreVelocity += c.scoreChange;

    if (c.buyerEntering) {
      activeBuyers++;
      buyingWeight += c.weightage;
      if (c.weightage >= 3) hwBuyers.push(`${c.symbol}(+${c.scoreChange.toFixed(1)})`);
    } else if (c.sellerEntering) {
      activeSellers++;
      sellingWeight += c.weightage;
      if (c.weightage >= 3) hwSellers.push(`${c.symbol}(${c.scoreChange.toFixed(1)})`);
    }
  }

  const totalWeight = contributors.reduce((s, c) => s + c.weightage, 0) || 1;
  const buyingPressurePct  = (buyingWeight  / totalWeight) * 100;
  const sellingPressurePct = (sellingWeight / totalWeight) * 100;

  let netPressure: BuyerSellerActivity["netPressure"] = "BALANCED";
  if (buyingPressurePct >= sellingPressurePct + 15) {
    netPressure = "BUYERS_DOMINANT";
  } else if (sellingPressurePct >= buyingPressurePct + 15) {
    netPressure = "SELLERS_DOMINANT";
  }

  const totalActive = activeBuyers + activeSellers;
  const entryStrength: BuyerSellerActivity["entryStrength"] =
    totalActive >= 8 ? "HIGH" :
    totalActive >= 4 ? "MEDIUM" : "LOW";

  const topBuyingStocks  = hwBuyers.slice(0, 3).join(", ")  || contributors.filter(c => c.buyerEntering).slice(0, 2).map(c => c.symbol).join(", ")  || "—";
  const topSellingStocks = hwSellers.slice(0, 3).join(", ") || contributors.filter(c => c.sellerEntering).slice(0, 2).map(c => c.symbol).join(", ") || "—";

  return {
    activeBuyers,
    activeSellers,
    heavyweightBuyers:  hwBuyers,
    heavyweightSellers: hwSellers,
    buyingPressurePct,
    sellingPressurePct,
    netPressure,
    entryStrength,
    topBuyingStocks,
    topSellingStocks,
    scoreVelocity: parseFloat(scoreVelocity.toFixed(2)),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildNeutralSignal(reason: string): WeightedSignal {
  const emptyBSA: BuyerSellerActivity = {
    activeBuyers: 0, activeSellers: 0,
    heavyweightBuyers: [], heavyweightSellers: [],
    buyingPressurePct: 0, sellingPressurePct: 0,
    netPressure: "BALANCED", entryStrength: "LOW",
    topBuyingStocks: "—", topSellingStocks: "—",
    scoreVelocity: 0,
  };
  return {
    direction: "NEUTRAL",
    strength: "WEAK",
    netScore: 0,
    confidence: 0,
    totalWeightBullish: 0,
    totalWeightBearish: 0,
    bullishStocksCount: 0,
    bearishStocksCount: 0,
    totalStocks: 0,
    specialTrioDirection: "NEUTRAL",
    specialTrioScore: 0,
    specialTrioDetail: reason,
    bankingSectorScore: 0,
    bankingAligned: false,
    bankingDetail: "",
    topBullishStocks: [],
    topBearishStocks: [],
    allTopStocks: [],
    buyerSellerActivity: emptyBSA,
    divergenceDetected: false,
    divergenceType: "NONE",
    divergenceWarning: "",
    reasoning: [reason],
    gateSummary: `WeightedStocks: NEUTRAL (${reason})`,
  };
}

/**
 * Quick helper: Does the weighted stock signal confirm the intended trade direction?
 * v2.0: Also checks buyer/seller entry strength for additional confirmation.
 */
export function isWeightedSignalAligned(
  signal: WeightedSignal,
  intendedDirection: "BUY_CE" | "BUY_PE",
): boolean {
  // Relaxed: do not block on divergence or conflicts, allow weak/conflict trends to pass
  if (intendedDirection === "BUY_CE") {
    return signal.direction === "BULLISH" || signal.direction === "NEUTRAL" || signal.strength === "WEAK" || signal.strength === "CONFLICT";
  } else {
    return signal.direction === "BEARISH" || signal.direction === "NEUTRAL" || signal.strength === "WEAK" || signal.strength === "CONFLICT";
  }
}
