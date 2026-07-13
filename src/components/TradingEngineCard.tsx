import React, { useMemo, useState, useEffect } from "react";
import { Zap, TrendingUp, TrendingDown, Activity, Check, X, AlertTriangle, ArrowUpRight, ArrowDownRight, Layers } from "lucide-react";
import { OptionStrike, StockData } from "../types";

interface TradingEngineCardProps {
  activePage: string;
  spotPrice: number;
  optionChain: OptionStrike[];
  darkMode: boolean;
  strikeGap: number;
  regimeResult?: any;
  regimeData?: any;
  bullishScore?: number;
  bearishScore?: number;
  pcr?: number;
  sentiment?: string;
  range15m?: any;
  totalScore?: number;
  advances?: number;
  declines?: number;
  heavyweights?: StockData[];
  aiAnalysis?: any;
}

export default function TradingEngineCard({
  activePage,
  spotPrice,
  optionChain = [],
  darkMode,
  strikeGap,
  regimeResult,
  regimeData,
  bullishScore,
  bearishScore,
  pcr,
  sentiment,
  range15m,
  totalScore,
  advances,
  declines,
  heavyweights,
  aiAnalysis,
}: TradingEngineCardProps) {
  // Compute PCR, setups (Breakout, Trend Reversal, Momentum), and premium entry levels
  // Compute PCR, setups (Breakout, Trend Reversal, Momentum), and premium entry levels
  const metrics = useMemo(() => {
    const spotPx = spotPrice || 0;

    const atmStrike = spotPx > 0 ? Math.round(spotPx / strikeGap) * strikeGap : 0;
    
    if (optionChain.length === 0) {
      return {
        pcrVal: 1.0,
        atmRow: null,
        atmStrike: 0,
        signal: "WAIT" as const,
        setupType: "NONE" as const,
        writersDominance: "NEUTRAL" as const,
        reasons: ["⚠ Option chain stream offline"],
        entry: 0,
        sl: 0,
        target: 0,
        ceLtp: 0,
        peLtp: 0,
        conditions: {
          peOiInc: false,
          ceOiDec: false,
          ceVolSpike: false,
          pcrBullish: false,
          ceOiInc: false,
          peOiDec: false,
          peVolSpike: false,
          pcrBearish: false
        }
      };
    }

    const atmRow = optionChain.find(s => s.strikePrice === atmStrike) || null;

    // PCR Calculation (Put OI / Call OI) - higher means Put Sellers (bulls) dominate
    const totalCallOi = optionChain.reduce((sum, s) => sum + s.ceOI, 0);
    const totalPutOi = optionChain.reduce((sum, s) => sum + s.peOI, 0);
    const pcrValCalculated = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(2)) : 1.0;

    // Averages for volume spike detection
    const avgCeVolume = optionChain.reduce((sum, s) => sum + s.ceVolume, 0) / optionChain.length;
    const avgPeVolume = optionChain.reduce((sum, s) => sum + s.peVolume, 0) / optionChain.length;

    // Key base triggers (focused on writers)
    const peOiInc = atmRow ? atmRow.peOIChange > 0 : false;     // Put Writing (bullish shorts added)
    const ceOiDec = atmRow ? atmRow.ceOIChange < 0 : false;     // Call Unwinding (bearish shorts covered)
    const ceVolSpike = atmRow ? atmRow.ceVolume > avgCeVolume * 1.15 : false;
    const pcrBullish = pcrValCalculated > 1.04;
    const ceOiInc = atmRow ? atmRow.ceOIChange > 0 : false;     // Call Writing (bearish shorts added)
    const peOiDec = atmRow ? atmRow.peOIChange < 0 : false;     // Put Unwinding (bullish shorts covered)
    const peVolSpike = atmRow ? atmRow.peVolume > avgPeVolume * 1.15 : false;
    const pcrBearish = pcrValCalculated < 0.96;

    // Find major support/resistance levels by looking for maximum OI strikes
    let maxCallOi = 0;
    let resistanceStrike = atmStrike;
    let maxPutOi = 0;
    let supportStrike = atmStrike;

    optionChain.forEach(strike => {
      if (strike.ceOI > maxCallOi) {
        maxCallOi = strike.ceOI;
        resistanceStrike = strike.strikePrice;
      }
      if (strike.peOI > maxPutOi) {
        maxPutOi = strike.peOI;
        supportStrike = strike.strikePrice;
      }
    });

    // Scoring systems for different setups (Breakout, Trend Reversal, Momentum)
    // 1. CE setups (Bullish):
    let ceBreakoutScore = 0;
    let ceReversalScore = 0;
    let ceMomentumScore = 0;
    
    // 2. PE setups (Bearish):
    let peBreakdownScore = 0;
    let peReversalScore = 0;
    let peMomentumScore = 0;

    // Calculate CE Breakout Score:
    if (spotPx >= resistanceStrike) ceBreakoutScore += 3;
    else if (spotPx >= resistanceStrike - strikeGap * 0.4) ceBreakoutScore += 1;
    if (ceOiDec) ceBreakoutScore += 2;
    if (peOiInc) ceBreakoutScore += 1;
    if (pcrValCalculated > 1.05) ceBreakoutScore += 1;
    if (pcrValCalculated > 1.20) ceBreakoutScore += 1;
    if (ceVolSpike) ceBreakoutScore += 1;

    // Calculate CE Reversal Score:
    if (spotPx <= supportStrike + strikeGap) ceReversalScore += 3;
    if (peOiInc) ceReversalScore += 2;
    if (atmRow && atmRow.ceLtp > 0 && atmRow.ceChg > 1) ceReversalScore += 2;
    if (pcrValCalculated > 0.95) ceReversalScore += 1;

    // Calculate CE Momentum Score:
    if (atmRow && atmRow.ceChg > 8) ceMomentumScore += 3;
    if (atmRow && atmRow.ceVolume > avgCeVolume * 1.3) ceMomentumScore += 2;
    if (ceOiDec) ceMomentumScore += 1;
    if (pcrValCalculated > 1.02) ceMomentumScore += 1;

    // Calculate PE Breakdown Score:
    if (spotPx <= supportStrike) peBreakdownScore += 3;
    else if (spotPx <= supportStrike + strikeGap * 0.4) peBreakdownScore += 1;
    if (peOiDec) peBreakdownScore += 2;
    if (ceOiInc) peBreakdownScore += 1;
    if (pcrValCalculated < 0.95) peBreakdownScore += 1;
    if (pcrValCalculated < 0.80) peBreakdownScore += 1;
    if (peVolSpike) peBreakdownScore += 1;

    // Calculate PE Reversal Score:
    if (spotPx >= resistanceStrike - strikeGap) peReversalScore += 3;
    if (ceOiInc) peReversalScore += 2;
    if (atmRow && atmRow.peLtp > 0 && atmRow.peChg > 1) peReversalScore += 2;
    if (pcrValCalculated < 1.05) peReversalScore += 1;

    // Calculate PE Momentum Score:
    if (atmRow && atmRow.peChg > 8) peMomentumScore += 3;
    if (atmRow && atmRow.peVolume > avgPeVolume * 1.3) peMomentumScore += 2;
    if (peOiDec) peMomentumScore += 1;
    if (pcrValCalculated < 0.98) peMomentumScore += 1;

    // ── Multi-Engine Cross-Tab Analysis Alignment Scoring ──
    let ceScore = 0;
    let peScore = 0;
    const reasons: string[] = [];

    // Add baseline Options Chain scores (scale to 0-3 points)
    const ceChainScore = Math.max(ceBreakoutScore, ceReversalScore, ceMomentumScore);
    const peChainScore = Math.max(peBreakdownScore, peReversalScore, peMomentumScore);
    ceScore += Math.min(3, ceChainScore * 0.5);
    peScore += Math.min(3, peChainScore * 0.5);

    // 1. Layer 1: Market Regime classifier
    const regime = regimeResult?.regime || "NEUTRAL";
    if (regime === "BULLISH_TREND") {
      ceScore += 2;
      reasons.push("⚖ L1 Regime: STRONG BULLISH TREND classifier active.");
    } else if (regime === "BEARISH_TREND") {
      peScore += 2;
      reasons.push("⚖ L1 Regime: STRONG BEARISH TREND classifier active.");
    } else if (regime === "RANGE_BOUND") {
      ceScore -= 1.2;
      peScore -= 1.2;
      reasons.push("⚖ L1 Regime: RANGE BOUND warning (conservative filter active).");
    } else if (regime === "HIGH_VOLATILITY") {
      ceScore += 1;
      peScore += 1;
      reasons.push("⚖ L1 Regime: HIGH VOLATILITY detected (wider targets projected).");
    }

    // 2. Layer 2: Market Breadth advances vs declines
    const advCount = advances ?? 0;
    const decCount = declines ?? 0;
    const totScore = totalScore ?? 0;
    if (advCount > decCount) {
      ceScore += 1.5;
      reasons.push(`📊 L2 Breadth: Advances (${advCount}) > Declines (${decCount}) indicating buyer build.`);
    } else if (decCount > advCount) {
      peScore += 1.5;
      reasons.push(`📊 L2 Breadth: Declines (${decCount}) > Advances (${advCount}) indicating seller build.`);
    }
    if (totScore > 25) {
      ceScore += 1;
      reasons.push(`📊 L2 Sum: Overall stocks score is highly positive (+${totScore.toFixed(0)}).`);
    } else if (totScore < -25) {
      peScore += 1;
      reasons.push(`📊 L2 Sum: Overall stocks score is highly negative (${totScore.toFixed(0)}).`);
    }

    // 3. Layer 3: Institutional Heavyweights tracker
    const positiveHeavies = (heavyweights || []).filter(s => s.changePercent > 0 && (s.weightage > 3 || ["HDFCBANK", "ICICIBANK", "RELIANCE"].includes(s.symbol.toUpperCase()))).length;
    const negativeHeavies = (heavyweights || []).filter(s => s.changePercent < 0 && (s.weightage > 3 || ["HDFCBANK", "ICICIBANK", "RELIANCE"].includes(s.symbol.toUpperCase()))).length;
    if (positiveHeavies > negativeHeavies) {
      ceScore += 1.5;
      reasons.push(`🏛 L3 Heavyweights: Positive Movers (${positiveHeavies}) > Negative (${negativeHeavies}).`);
    } else if (negativeHeavies > positiveHeavies) {
      peScore += 1.5;
      reasons.push(`🏛 L3 Heavyweights: Negative Movers (${negativeHeavies}) > Positive (${positiveHeavies}).`);
    }
    const hdfc = (heavyweights || []).find(s => s.symbol.toUpperCase() === "HDFCBANK")?.changePercent || 0;
    const reliance = (heavyweights || []).find(s => s.symbol.toUpperCase() === "RELIANCE")?.changePercent || 0;
    if (hdfc > 0.4 && reliance > 0.4) {
      ceScore += 1;
      reasons.push("🏛 L3 Giants: HDFC Bank & Reliance trading in green (heavyweight push).");
    } else if (hdfc < -0.4 && reliance < -0.4) {
      peScore += 1;
      reasons.push("🏛 L3 Giants: HDFC Bank & Reliance trading in red (heavyweight drop).");
    }

    // 4. Layer 4: 15M Range Regulator
    const rHigh = range15m?.high || 0;
    const rLow = range15m?.low || 0;
    if (rHigh > 0 && spotPx > rHigh) {
      ceScore += 2;
      reasons.push(`🚀 L4 Range: Spot breached 15M High (${Math.round(rHigh)}) - Breakout Mode.`);
    } else if (rLow > 0 && rLow !== Infinity && spotPx < rLow) {
      peScore += 2;
      reasons.push(`🚀 L4 Range: Spot breached 15M Low (${Math.round(rLow)}) - Breakdown Mode.`);
    }

    // 5. Layer 5/7: Option Chain & Smart Money PCR
    const pcrVal = pcr ?? pcrValCalculated;
    if (pcrVal > 1.04) {
      ceScore += 1.5;
      reasons.push(`📈 L7 PCR: Put Sellers Floor dominates Calls (PCR: ${pcrVal.toFixed(2)}).`);
    } else if (pcrVal < 0.96) {
      peScore += 1.5;
      reasons.push(`📈 L7 PCR: Call Sellers Ceiling dominates Puts (PCR: ${pcrVal.toFixed(2)}).`);
    }

    if (spotPx >= resistanceStrike) {
      ceScore += 1.5;
      reasons.push(`🔥 L5 Trapped Writers: Breached Call Sellers Strike ${resistanceStrike} (Short covering trigger).`);
    }
    if (spotPx <= supportStrike) {
      peScore += 1.5;
      reasons.push(`🔥 L5 Trapped Writers: Breached Put Sellers Strike ${supportStrike} (Long unwinding trigger).`);
    }

    // 6. Layer 11: AI Sentiment Module
    const bullScore = bullishScore ?? 50;
    const bearScore = bearishScore ?? 50;
    if (bullScore > 65) {
      ceScore += 2;
      reasons.push(`🧠 L11 AI Sentiment: High bullish consensus (${bullScore}% agreement).`);
    } else if (bearScore > 65) {
      peScore += 2;
      reasons.push(`🧠 L11 AI Sentiment: High bearish consensus (${bearScore}% agreement).`);
    }
    if (bullScore > 80) ceScore += 1;
    if (bearScore > 80) peScore += 1;

    let signal: "BUY_CE" | "BUY_PE" | "WAIT" = "WAIT";
    let setupType: "BREAKOUT" | "TREND_REVERSAL" | "HIGH_MOMENTUM" | "NONE" = "NONE";
    let writersDominance: "CE_WRITERS" | "PE_WRITERS" | "NEUTRAL" = "NEUTRAL";

    // Trigger threshold is 6.0 points for a high conviction multi-engine alignment
    const TRIGGER_THRESHOLD = 6.0;

    if (ceScore >= TRIGGER_THRESHOLD && ceScore > peScore) {
      signal = "BUY_CE";
      writersDominance = "PE_WRITERS";
      if (rHigh > 0 && spotPx > rHigh) {
        setupType = "BREAKOUT";
        reasons.unshift(`🚀 Setup: MULTI-TAB BULLISH BREAKOUT (Score: ${ceScore.toFixed(1)}/15)`);
      } else if (spotPx <= supportStrike + strikeGap) {
        setupType = "TREND_REVERSAL";
        reasons.unshift(`🔄 Setup: MULTI-TAB BULLISH REVERSAL (Score: ${ceScore.toFixed(1)}/15)`);
      } else {
        setupType = "HIGH_MOMENTUM";
        reasons.unshift(`⚡ Setup: MULTI-TAB BULLISH MOMENTUM (Score: ${ceScore.toFixed(1)}/15)`);
      }
    } else if (peScore >= TRIGGER_THRESHOLD && peScore > ceScore) {
      signal = "BUY_PE";
      writersDominance = "CE_WRITERS";
      if (rLow > 0 && rLow !== Infinity && spotPx < rLow) {
        setupType = "BREAKOUT";
        reasons.unshift(`🚀 Setup: MULTI-TAB BEARISH BREAKDOWN (Score: ${peScore.toFixed(1)}/15)`);
      } else if (spotPx >= resistanceStrike - strikeGap) {
        setupType = "TREND_REVERSAL";
        reasons.unshift(`🔄 Setup: MULTI-TAB BEARISH REVERSAL (Score: ${peScore.toFixed(1)}/15)`);
      } else {
        setupType = "HIGH_MOMENTUM";
        reasons.unshift(`⚡ Setup: MULTI-TAB BEARISH MOMENTUM (Score: ${peScore.toFixed(1)}/15)`);
      }
    } else {
      signal = "WAIT";
      setupType = "NONE";
      writersDominance = "NEUTRAL";
      reasons.unshift(`⚖ Setup: CONVERGING RANGE (Scores CE: ${ceScore.toFixed(1)} | PE: ${peScore.toFixed(1)})`);
    }

    // Trading setups offsets
    const slOffset = activePage === "SENSEX" ? 50 : (activePage === "NIFTY" || activePage === "BANKNIFTY") ? 25 : strikeGap;
    const tgtOffset = activePage === "SENSEX" ? 100 : (activePage === "NIFTY" || activePage === "BANKNIFTY") ? 50 : (strikeGap * 2);
    
    return {
      pcrVal: pcrVal,
      atmRow,
      atmStrike,
      signal,
      setupType,
      writersDominance,
      reasons,
      entry: spotPx,
      sl: signal === "BUY_CE" ? spotPx - slOffset : signal === "BUY_PE" ? spotPx + slOffset : 0,
      target: signal === "BUY_CE" ? spotPx + tgtOffset : signal === "BUY_PE" ? spotPx - tgtOffset : 0,
      ceLtp: atmRow ? atmRow.ceLtp : 0,
      peLtp: atmRow ? atmRow.peLtp : 0,
      conditions: {
        peOiInc,
        ceOiDec,
        ceVolSpike,
        pcrBullish,
        ceOiInc,
        peOiDec,
        peVolSpike,
        pcrBearish
      }
    };
  }, [optionChain, spotPrice, activePage, regimeResult, regimeData, bullishScore, bearishScore, pcr, sentiment, range15m, totalScore, advances, declines, heavyweights, aiAnalysis, strikeGap]);

  // Trade status lifecycle state machine
  const [tradeStatus, setTradeStatus] = useState<"INACTIVE" | "ACTIVE" | "T1_HIT" | "SL_HIT" | "TARGET_HIT">("INACTIVE");

  // Track the signal direction when trade is closed (to block duplicate re-entry on the same signal)
  const [exitSignalDirection, setExitSignalDirection] = useState<"BUY_CE" | "BUY_PE" | "WAIT">("WAIT");

  // Locked values when signal triggers
  const [lockedSignal, setLockedSignal] = useState<"BUY_CE" | "BUY_PE" | "WAIT">("WAIT");
  const [lockedSetupType, setLockedSetupType] = useState<string>("NONE");
  const [lockedEntry, setLockedEntry] = useState<number>(0);
  const [lockedSl, setLockedSl] = useState<number>(0);
  const [lockedTarget, setLockedTarget] = useState<number>(0); // Target 1 (Safe Profit Booking)
  const [lockedTarget2, setLockedTarget2] = useState<number>(0); // Target 2 (Max Target)
  const [lockedStrike, setLockedStrike] = useState<number>(0);
  
  const [lockedOptionEntry, setLockedOptionEntry] = useState<number>(0);
  const [lockedOptionSl, setLockedOptionSl] = useState<number>(0);
  const [lockedOptionTarget, setLockedOptionTarget] = useState<number>(0); // Target 1 Premium Target
  const [lockedOptionTarget2, setLockedOptionTarget2] = useState<number>(0); // Target 2 Premium Target

  const [lastPage, setLastPage] = useState<string>(activePage);
  // Live actionable tip generator based on current active signals
  const liveTip = useMemo(() => {
    const isCE = metrics.signal === "BUY_CE";
    const isPE = metrics.signal === "BUY_PE";
    
    if (isCE) {
      let details = "";
      if (metrics.setupType.includes("BREAKOUT")) {
        details = `${activePage} has broken out of the 15-minute range high. The trend is strongly bullish with heavyweight support. Consider buying CE options near the entry trigger and trail SL once Target 1 is hit.`;
      } else if (metrics.setupType.includes("TREND_REVERSAL")) {
        details = `${activePage} is showing a bullish trend reversal near the support wall. Put writers are aggressively defending this level. Consider CE entry with tight stop-loss at support.`;
      } else {
        details = `Strong bullish momentum detected. Stock breadth (advances) and heavyweight movers are fully aligned. Look for CE buying opportunities on minor pullbacks.`;
      }
      return {
        type: "BULLISH",
        title: `🟢 LIVE BULLISH TIP (${activePage} BUY CE)`,
        text: details
      };
    } else if (isPE) {
      let details = "";
      if (metrics.setupType.includes("BREAKOUT")) {
        details = `${activePage} has broken down below the 15-minute range low. Strong institutional selling pressure. Consider buying PE options at the breakdown level with SL above the range low.`;
      } else if (metrics.setupType.includes("TREND_REVERSAL")) {
        details = `${activePage} is facing heavy resistance at the call writing wall. Sellers are blocking further upside. Consider PE entry with stop-loss just above the resistance strike.`;
      } else {
        details = `Strong bearish momentum detected. Declines dominate advances and heavyweight stocks are red. Look for PE buying opportunities on minor pullbacks.`;
      }
      return {
        type: "BEARISH",
        title: `🔴 LIVE BEARISH TIP (${activePage} BUY PE)`,
        text: details
      };
    } else {
      const rHigh = range15m?.high || 0;
      const rLow = range15m?.low || 0;
      const rangeText = rHigh > 0 && rLow > 0 && rLow !== Infinity
        ? `breakout above 15M High (${Math.round(rHigh)}) or breakdown below 15M Low (${Math.round(rLow)})`
        : "a clear breakout or breakdown from the opening range";
      
      return {
        type: "WAIT",
        title: `⏸ LIVE STANDBY TIP (${activePage} RANGE BOUND)`,
        text: `Market is in a sideways range. Avoid early entry to prevent premium decay. Standby for ${rangeText}.`
      };
    }
  }, [metrics.signal, metrics.setupType, activePage, range15m]);

  const resetLockedLevels = () => {
    setLockedSignal("WAIT");
    setLockedSetupType("NONE");
    setLockedEntry(0);
    setLockedSl(0);
    setLockedTarget(0);
    setLockedTarget2(0);
    setLockedStrike(0);
    setLockedOptionEntry(0);
    setLockedOptionSl(0);
    setLockedOptionTarget(0);
    setLockedOptionTarget2(0);
  };

  // Sync, lock and monitor trade exits (SL / Target hits)
  useEffect(() => {
    // Page switched: clear all state and reset to standby
    if (activePage !== lastPage) {
      setLastPage(activePage);
      resetLockedLevels();
      setTradeStatus("INACTIVE");
      setExitSignalDirection("WAIT");
      return;
    }

    // Reset exit lock when the live signal changes away from the closed signal direction
    if (exitSignalDirection !== "WAIT" && metrics.signal !== exitSignalDirection) {
      setExitSignalDirection("WAIT");
      setTradeStatus("INACTIVE");
    }

    // A. RESET CYCLE: If live signal goes back to WAIT and we are not in a closed state, restore card back to standby
    if (metrics.signal === "WAIT" && exitSignalDirection === "WAIT") {
      resetLockedLevels();
      setTradeStatus("INACTIVE");
    } else {
      // B. ENTRY TRIGGER: Lock values if a signal is generated and we are currently INACTIVE and have not blocked this signal direction
      if (tradeStatus === "INACTIVE" && metrics.signal !== "WAIT" && metrics.signal !== exitSignalDirection) {
        const entryPrice = spotPrice || 0;
        const atm = entryPrice > 0 ? Math.round(entryPrice / strikeGap) * strikeGap : 0;
        const cushion = activePage === "SENSEX" ? 30 : (activePage === "NIFTY" || activePage === "BANKNIFTY") ? 15 : Math.max(1, strikeGap * 0.3);
        const offset = activePage === "SENSEX" ? 50 : (activePage === "NIFTY" || activePage === "BANKNIFTY") ? 25 : strikeGap;
        const safetyThreshold = (activePage === "NIFTY" || activePage === "BANKNIFTY" || activePage === "SENSEX") ? 10 : (offset * 0.4);

        // Find support and resistance strikes
        let maxCallOi = 0;
        let resistanceStrike = atm;
        let maxPutOi = 0;
        let supportStrike = atm;

        optionChain.forEach(strike => {
          if (strike.ceOI > maxCallOi) {
            maxCallOi = strike.ceOI;
            resistanceStrike = strike.strikePrice;
          }
          if (strike.peOI > maxPutOi) {
            maxPutOi = strike.peOI;
            supportStrike = strike.strikePrice;
          }
        });

        const atmRow = optionChain.find(s => s.strikePrice === atm) || null;
        const optionEntry = atmRow ? (metrics.signal === "BUY_CE" ? atmRow.ceLtp : atmRow.peLtp) : 0;

        let spotEntry = entryPrice;
        let spotSl = 0;
        let spotTarget = 0;
        let spotTarget2 = 0;

        if (metrics.signal === "BUY_CE") {
          // Entry spot
          if (metrics.setupType.includes("BREAKOUT")) {
            spotEntry = resistanceStrike;
            spotSl = resistanceStrike - offset;
          } else if (metrics.setupType.includes("TREND_REVERSAL")) {
            spotEntry = supportStrike + (strikeGap * 0.2);
            spotSl = supportStrike - cushion;
          } else {
            spotEntry = entryPrice;
            spotSl = entryPrice - offset;
          }

          // Safety check
          if (spotSl >= spotEntry - safetyThreshold) {
            spotSl = spotEntry - offset;
          }

          const risk = spotEntry - spotSl;
          spotTarget = spotEntry + risk; // T1 (1:1 Risk Reward)
          spotTarget2 = spotEntry + risk * 2; // T2 (1:2 Risk Reward)
        } else {
          // Entry spot for PE
          if (metrics.setupType.includes("BREAKOUT")) {
            spotEntry = supportStrike;
            spotSl = supportStrike + offset;
          } else if (metrics.setupType.includes("TREND_REVERSAL")) {
            spotEntry = resistanceStrike - (strikeGap * 0.2);
            spotSl = resistanceStrike + cushion;
          } else {
            spotEntry = entryPrice;
            spotSl = entryPrice + offset;
          }

          // Safety check
          if (spotSl <= spotEntry + safetyThreshold) {
            spotSl = spotEntry + offset;
          }

          const risk = spotSl - spotEntry;
          spotTarget = spotEntry - risk; // T1 (1:1 Risk Reward)
          spotTarget2 = spotEntry - risk * 2; // T2 (1:2 Risk Reward)
        }

        // Project premium options (approx 0.5 delta)
        const optionSl = Math.max(optionEntry * 0.5, optionEntry - Math.abs(spotEntry - spotSl) * 0.5);
        const optionTarget = optionEntry + Math.abs(spotTarget - spotEntry) * 0.5;
        const optionTarget2 = optionEntry + Math.abs(spotTarget2 - spotEntry) * 0.5;

        setLockedSignal(metrics.signal);
        setLockedSetupType(metrics.setupType);
        setLockedEntry(spotEntry);
        setLockedStrike(atm);
        setLockedOptionEntry(optionEntry);
        setLockedOptionSl(optionSl);
        setLockedOptionTarget(optionTarget);
        setLockedOptionTarget2(optionTarget2);
        setLockedSl(spotSl);
        setLockedTarget(spotTarget);
        setLockedTarget2(spotTarget2);
        setTradeStatus("ACTIVE");
      }

      // C. MONITORING EXIT: While active, monitor live prices against locked exits
      if (tradeStatus === "ACTIVE" || tradeStatus === "T1_HIT") {
        // Find current live premium of the locked strike option
        const lockedStrikeRow = optionChain.find(s => s.strikePrice === lockedStrike);
        const livePremium = lockedStrikeRow 
          ? (lockedSignal === "BUY_CE" ? lockedStrikeRow.ceLtp : lockedStrikeRow.peLtp) 
          : 0;

        if (lockedSignal === "BUY_CE") {
          if (tradeStatus === "ACTIVE") {
            // Target 1 Hit check (trail SL to Entry)
            if (spotPrice >= lockedTarget || (livePremium > 0 && livePremium >= lockedOptionTarget)) {
              setTradeStatus("T1_HIT");
              setLockedSl(lockedEntry); // Trail Spot SL to Entry
              setLockedOptionSl(lockedOptionEntry); // Trail Option SL to Entry Premium
            }
            // Stop Loss Hit check
            else if (spotPrice <= lockedSl || (livePremium > 0 && livePremium <= lockedOptionSl)) {
              setTradeStatus("SL_HIT");
              setExitSignalDirection(lockedSignal);
              resetLockedLevels();
            }
          } else if (tradeStatus === "T1_HIT") {
            // Target 2 Hit check
            if (spotPrice >= lockedTarget2 || (livePremium > 0 && livePremium >= lockedOptionTarget2)) {
              setTradeStatus("TARGET_HIT");
              setExitSignalDirection(lockedSignal);
              resetLockedLevels();
            }
            // Trailed SL Hit check
            else if (spotPrice <= lockedSl || (livePremium > 0 && livePremium <= lockedOptionSl)) {
              setTradeStatus("SL_HIT");
              setExitSignalDirection(lockedSignal);
              resetLockedLevels();
            }
          }
        } else if (lockedSignal === "BUY_PE") {
          if (tradeStatus === "ACTIVE") {
            // Target 1 Hit check (trail SL to Entry)
            if (spotPrice <= lockedTarget || (livePremium > 0 && livePremium >= lockedOptionTarget)) {
              setTradeStatus("T1_HIT");
              setLockedSl(lockedEntry); // Trail Spot SL to Entry
              setLockedOptionSl(lockedOptionEntry); // Trail Option SL to Entry Premium
            }
            // Stop Loss Hit check
            else if (spotPrice >= lockedSl || (livePremium > 0 && livePremium <= lockedOptionSl)) {
              setTradeStatus("SL_HIT");
              setExitSignalDirection(lockedSignal);
              resetLockedLevels();
            }
          } else if (tradeStatus === "T1_HIT") {
            // Target 2 Hit check
            if (spotPrice <= lockedTarget2 || (livePremium > 0 && livePremium >= lockedOptionTarget2)) {
              setTradeStatus("TARGET_HIT");
              setExitSignalDirection(lockedSignal);
              resetLockedLevels();
            }
            // Trailed SL Hit check
            else if (spotPrice >= lockedSl || (livePremium > 0 && livePremium <= lockedOptionSl)) {
              setTradeStatus("SL_HIT");
              setExitSignalDirection(lockedSignal);
              resetLockedLevels();
            }
          }
        }
      }
    }
  }, [metrics.signal, activePage, spotPrice, optionChain, lockedSignal, lastPage, tradeStatus, lockedStrike, lockedSl, lockedTarget, lockedTarget2, lockedOptionSl, lockedOptionTarget, lockedOptionTarget2, exitSignalDirection, lockedEntry, lockedOptionEntry, strikeGap]);

  // Manage banner timeout for closed trades
  useEffect(() => {
    if (tradeStatus === "SL_HIT" || tradeStatus === "TARGET_HIT") {
      const timer = setTimeout(() => {
        setTradeStatus("INACTIVE");
      }, 8000); // 8 seconds display timeout
      return () => clearTimeout(timer);
    }
  }, [tradeStatus]);

  // Adjust style & text of signal banner based on status
  const signalStyle = useMemo(() => {
    if (tradeStatus === "SL_HIT") {
      return "bg-red-950/90 border-red-500/80 text-red-400 font-black border animate-pulse";
    }
    if (tradeStatus === "TARGET_HIT") {
      return "bg-emerald-950/90 border-emerald-500/80 text-emerald-400 font-black border animate-pulse";
    }
    if (tradeStatus === "T1_HIT") {
      return "bg-amber-950/95 border-amber-500/80 text-amber-400 font-black border animate-pulse";
    }
    if (tradeStatus === "INACTIVE" && exitSignalDirection !== "WAIT" && metrics.signal === exitSignalDirection) {
      return "bg-slate-900/80 border-slate-700 text-slate-400 font-bold border";
    }
    return {
      BUY_CE: "bg-emerald-950/80 border-emerald-500/80 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse",
      BUY_PE: "bg-rose-950/80 border-rose-500/80 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse",
      WAIT: "bg-slate-900/50 border-slate-800 text-slate-400"
    }[metrics.signal];
  }, [tradeStatus, metrics.signal, exitSignalDirection]);

  const signalText = useMemo(() => {
    if (tradeStatus === "SL_HIT") {
      return "🔴 STOP LOSS HIT (SIGNAL CLOSED)";
    }
    if (tradeStatus === "TARGET_HIT") {
      return "🟢 TARGET 2 ACHIEVED (SIGNAL CLOSED)";
    }
    if (tradeStatus === "T1_HIT") {
      return "🟢 T1 HIT: SL TRAILED TO ENTRY (PARTIAL BOOKED)";
    }
    if (tradeStatus === "INACTIVE" && exitSignalDirection !== "WAIT" && metrics.signal === exitSignalDirection) {
      return "⏸ WAITING FOR NEW SETUP (COOLDOWN)";
    }
    return {
      BUY_CE: "⚡ BUY CALL OPTION (CE)",
      BUY_PE: "⚡ BUY PUT OPTION (PE)",
      WAIT: "⏸ AWAITING TREND SETUP"
    }[metrics.signal];
  }, [tradeStatus, metrics.signal, exitSignalDirection]);

  return (
    <div className={`p-3.5 rounded-2xl flex flex-col gap-3 border shadow-[0_4px_25px_rgba(99,102,241,0.06)] relative overflow-hidden transition-all duration-300 select-none ${
      darkMode 
        ? "bg-gradient-to-br from-[#121c33]/90 via-[#0e1628]/95 to-[#0b101c]/90 border-[#1d2a45]" 
        : "bg-gradient-to-br from-slate-50/95 via-slate-100/90 to-slate-200/95 border-slate-200 text-slate-800"
    }`}>
      {/* Neon Top Accent Line */}
      <div className={`absolute top-0 left-0 w-full h-[2px] ${
        tradeStatus === "SL_HIT" || tradeStatus === "TARGET_HIT" || (tradeStatus === "INACTIVE" && exitSignalDirection !== "WAIT" && metrics.signal === exitSignalDirection)
          ? "bg-gradient-to-r from-slate-500 via-slate-650 to-slate-800"
          : metrics.signal === "BUY_CE" 
            ? "bg-emerald-500" 
            : metrics.signal === "BUY_PE" 
              ? "bg-rose-500" 
              : "bg-gradient-to-r from-teal-400 via-indigo-500 to-purple-500"
      }`} />

      {/* Header */}
      <div className="flex items-center justify-between border-b pb-1.5 dark:border-slate-800/60 border-slate-200/60 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity size={12} className="text-teal-400 animate-pulse" />
          <span className={`text-[10px] font-black uppercase tracking-widest ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
            Trading Engine Intelligence
          </span>
        </div>
        <span className="text-[8px] font-mono font-bold px-2 py-0.5 rounded border dark:border-teal-500/20 dark:bg-teal-950/40 border-teal-200 bg-teal-50 text-teal-600 shadow-sm">
          AMEX LIVE FEED
        </span>
      </div>

      {/* Signal Banner */}
      <div className={`flex items-center justify-center py-2 px-2.5 rounded-xl border font-black text-xs uppercase tracking-wider text-center ${signalStyle}`}>
        {signalText}
      </div>

      {/* Setup & Writer Dominance Badges */}
      {metrics.signal !== "WAIT" && (tradeStatus === "ACTIVE" || tradeStatus === "T1_HIT") && (
        <div className="flex flex-col gap-1.5 px-2 py-1.5 rounded-lg dark:bg-black/30 bg-slate-200/50 border dark:border-slate-880/40 border-slate-350/35">
          {/* Strategy Setup */}
          <div className="flex items-center justify-between">
            <span className={`text-[8.5px] uppercase font-black ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Active Strategy Setup:</span>
            <span className={`text-[9.5px] font-black uppercase tracking-wider flex items-center gap-1 ${
              lockedSetupType.includes("BREAKOUT") ? "text-amber-400" :
              lockedSetupType.includes("TREND_REVERSAL") ? "text-indigo-400 animate-pulse" :
              "text-sky-455 font-extrabold"
            }`}>
              {lockedSetupType.includes("BREAKOUT") ? "🚀 Breakout / Breakdown" :
               lockedSetupType.includes("TREND_REVERSAL") ? "🔄 Trend Reversal" :
               "⚡ High Momentum"}
            </span>
          </div>
          {/* Option Writer Dominance */}
          <div className="flex items-center justify-between border-t dark:border-slate-800/30 border-slate-200/50 pt-1">
            <span className={`text-[8.5px] uppercase font-black ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Seller Dominance:</span>
            <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded border ${
              metrics.writersDominance === "PE_WRITERS" 
                ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                : "text-rose-400 border-rose-500/30 bg-rose-500/10"
            }`}>
              {metrics.writersDominance === "PE_WRITERS" ? "🟢 Put Sellers (Bullish Shorts)" : "🔴 Call Sellers (Bearish Shorts)"}
            </span>
          </div>
        </div>
      )}

      {/* Real-time Targets (Shown only on CE / PE Signal and while trade is active) */}
      {metrics.signal !== "WAIT" && (tradeStatus === "ACTIVE" || tradeStatus === "T1_HIT") && (
        <div className="flex flex-col gap-2.5 border-t border-b dark:border-slate-800/40 border-slate-200/60 py-2">
          {/* Spot Index Levels */}
          <div className="flex flex-col gap-1">
            <span className={`text-[8px] font-black uppercase tracking-wider text-left px-1 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Optimal Spot Targets (LOCKED)</span>
            <div className="grid grid-cols-4 gap-1.5 font-mono text-center">
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-black/40 border dark:border-slate-850 bg-slate-100/60 border-slate-200/60">
                <span className="text-[7px] uppercase text-slate-500 font-extrabold leading-tight">Entry Spot</span>
                <span className="text-[10.5px] font-black text-slate-350 dark:text-white mt-0.5">
                  {lockedEntry > 0 ? Math.round(lockedEntry) : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-black/40 border dark:border-slate-850 bg-slate-100/60 border-slate-200/60">
                <span className="text-[7px] uppercase text-slate-500 font-extrabold leading-tight">
                  {tradeStatus === "T1_HIT" ? "Trailed SL" : "SL Spot"}
                </span>
                <span className={`text-[10.5px] font-black mt-0.5 ${tradeStatus === "T1_HIT" ? "text-amber-500 animate-pulse" : "text-rose-500"}`}>
                  {lockedSl > 0 ? Math.round(lockedSl) : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-black/40 border dark:border-slate-850 bg-slate-100/60 border-slate-200/60">
                <span className="text-[7px] uppercase text-slate-500 font-extrabold leading-tight">T1 (Book 1)</span>
                <span className={`text-[10.5px] font-black mt-0.5 ${tradeStatus === "T1_HIT" ? "text-slate-400 line-through" : "text-emerald-500"}`}>
                  {lockedTarget > 0 ? Math.round(lockedTarget) : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-black/40 border dark:border-slate-850 bg-slate-100/60 border-slate-200/60">
                <span className="text-[7px] uppercase text-slate-500 font-extrabold leading-tight">T2 (Book 2)</span>
                <span className="text-[10.5px] font-black text-teal-400 mt-0.5">
                  {lockedTarget2 > 0 ? Math.round(lockedTarget2) : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Option Premium Levels (LTP-based) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center px-1">
              <span className={`text-[8px] font-black uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Option Premium (LTP) Levels (LOCKED)</span>
              <span className="text-[7px] text-teal-400 font-black bg-teal-500/10 px-1.5 py-0.2 rounded border border-teal-500/20">Delta 0.5</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 font-mono text-center">
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-emerald-950/20 border dark:border-emerald-500/30 bg-emerald-50/50 border-emerald-200/60">
                <span className="text-[6.5px] uppercase text-emerald-600 dark:text-emerald-400 font-black leading-tight">Buy LTP</span>
                <span className="text-[10.5px] font-black text-emerald-600 dark:text-emerald-300 mt-0.5">
                  {lockedOptionEntry > 0 ? `₹${lockedOptionEntry.toFixed(1)}` : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-rose-950/20 border dark:border-rose-500/30 bg-rose-50/50 border-rose-200/60">
                <span className="text-[6.5px] uppercase text-rose-600 dark:text-rose-400 font-black leading-tight">
                  {tradeStatus === "T1_HIT" ? "Trailed SL" : "Option SL"}
                </span>
                <span className={`text-[10.5px] font-black mt-0.5 ${tradeStatus === "T1_HIT" ? "text-amber-400 animate-pulse" : "text-rose-600 dark:text-rose-300"}`}>
                  {lockedOptionSl > 0 ? `₹${lockedOptionSl.toFixed(1)}` : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-emerald-950/20 border dark:border-emerald-500/30 bg-emerald-50/50 border-emerald-200/60">
                <span className="text-[6.5px] uppercase text-emerald-600 dark:text-emerald-400 font-black leading-tight">T1 LTP</span>
                <span className={`text-[10.5px] font-black mt-0.5 ${tradeStatus === "T1_HIT" ? "text-slate-400 line-through" : "text-emerald-600 dark:text-emerald-300"}`}>
                  {lockedOptionTarget > 0 ? `₹${lockedOptionTarget.toFixed(1)}` : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center p-1 rounded-lg dark:bg-emerald-950/20 border dark:border-emerald-500/30 bg-emerald-50/50 border-emerald-200/60">
                <span className="text-[6.5px] uppercase text-emerald-600 dark:text-emerald-400 font-black leading-tight">T2 LTP</span>
                <span className="text-[10.5px] font-black text-teal-600 dark:text-teal-300 mt-0.5">
                  {lockedOptionTarget2 > 0 ? `₹${lockedOptionTarget2.toFixed(1)}` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strike & Premium Pricing Section */}
      <div className="grid grid-cols-2 gap-1.5 font-mono text-center">
        {/* CE side */}
        <div className={`flex flex-col p-1.5 rounded-lg border transition-all duration-300 ${
          metrics.signal === "BUY_CE" && tradeStatus === "ACTIVE"
            ? "bg-emerald-950/20 border-emerald-500/50 shadow-sm" 
            : "dark:bg-black/20 dark:border-slate-850 bg-slate-100/30 border-slate-200/40"
        }`}>
          <div className="flex justify-between items-center px-1">
            <span className="text-[7.5px] font-black text-slate-500">ATM CE</span>
            {metrics.signal === "BUY_CE" && tradeStatus === "ACTIVE" && <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 rounded font-black">BUY</span>}
          </div>
          <div className="flex justify-between items-baseline mt-1 px-1">
            <span className="text-[10px] text-slate-450 dark:text-slate-400 font-bold">Strike: {metrics.atmStrike || "—"}</span>
            <span className={`text-[12px] font-black ${metrics.signal === "BUY_CE" && tradeStatus === "ACTIVE" ? "text-emerald-400 font-black animate-pulse" : "dark:text-slate-200 text-slate-800"}`}>
              ₹{(metrics.ceLtp ?? 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* PE side */}
        <div className={`flex flex-col p-1.5 rounded-lg border transition-all duration-300 ${
          metrics.signal === "BUY_PE" && tradeStatus === "ACTIVE"
            ? "bg-rose-950/20 border-rose-500/50 shadow-sm" 
            : "dark:bg-black/20 dark:border-slate-850 bg-slate-100/30 border-slate-200/40"
        }`}>
          <div className="flex justify-between items-center px-1">
            <span className="text-[7.5px] font-black text-slate-500">ATM PE</span>
            {metrics.signal === "BUY_PE" && tradeStatus === "ACTIVE" && <span className="text-[8px] bg-rose-500/20 text-rose-400 px-1 rounded font-black">BUY</span>}
          </div>
          <div className="flex justify-between items-baseline mt-1 px-1">
            <span className="text-[10px] text-slate-450 dark:text-slate-400 font-bold">Strike: {metrics.atmStrike || "—"}</span>
            <span className={`text-[12px] font-black ${metrics.signal === "BUY_PE" && tradeStatus === "ACTIVE" ? "text-rose-400 font-black animate-pulse" : "dark:text-slate-200 text-slate-800"}`}>
              ₹{(metrics.peLtp ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Reason Checklist */}
      <div className="space-y-1 pt-0.5">
        <span className={`text-[8px] font-black uppercase tracking-wider block ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
          REASON CHECKLIST (SELLER BIAS)
        </span>
        <div className="space-y-1 text-[10.5px]">
          {/* PCR Condition */}
          <div className="flex items-center justify-between">
            <span className={darkMode ? "text-slate-400" : "text-slate-600"}>PCR (Put vs Call Sellers):</span>
            <div className="flex items-center gap-1.5">
              <span className={`font-mono font-bold ${
                metrics.pcrVal > 1.04 ? "text-emerald-500" : metrics.pcrVal < 0.96 ? "text-rose-500" : "text-slate-400"
              }`}>{metrics.pcrVal}</span>
              {metrics.pcrVal < 0.96 || metrics.pcrVal > 1.04 ? (
                <Check size={10} className="text-emerald-500" />
              ) : (
                <X size={10} className="text-slate-500" />
              )}
            </div>
          </div>

          {/* Call Unwinding Condition */}
          <div className="flex items-center justify-between">
            <span className={darkMode ? "text-slate-400" : "text-slate-600"}>CE Shorts Covering (CE OI ↓):</span>
            {metrics.conditions.ceOiDec ? (
              <Check size={10} className="text-emerald-500" />
            ) : (
              <X size={10} className="text-slate-500" />
            )}
          </div>

          {/* Put Writing Condition */}
          <div className="flex items-center justify-between">
            <span className={darkMode ? "text-slate-400" : "text-slate-600"}>PE Shorts Built (PE OI ↑):</span>
            {metrics.conditions.peOiInc ? (
              <Check size={10} className="text-emerald-500" />
            ) : (
              <X size={10} className="text-slate-500" />
            )}
          </div>

          {/* Volume Spike Condition */}
          <div className="flex items-center justify-between">
            <span className={darkMode ? "text-slate-400" : "text-slate-600"}>ATM Sellers Pressure:</span>
            {metrics.conditions.ceVolSpike || metrics.conditions.peVolSpike ? (
              <Check size={10} className="text-emerald-500" />
            ) : (
              <X size={10} className="text-slate-500" />
            )}
          </div>
        </div>
      </div>

      {/* Strategy Summary List */}
      <div className="space-y-1.5 border-t dark:border-slate-800/60 border-slate-200/60 pt-2 flex-shrink-0">
        <span className={`text-[8px] font-black uppercase tracking-wider block ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
          OPTION WRITER (SHORT) ANALYSIS &amp; CONTEXT
        </span>
        <div className="space-y-1 font-mono text-[9px] dark:text-slate-350 text-slate-700">
          {metrics.reasons.map((reason, idx) => (
            <div key={idx} className="flex items-start gap-1 leading-tight py-0.5">
              <span className="text-teal-400 font-bold">•</span>
              <span>{reason}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Live Actionable Trading Tip Box */}
      <div className={`mt-3.5 p-3 rounded-lg border flex flex-col gap-1.5 shadow-sm transition-all duration-300 ${
        darkMode
          ? "bg-slate-950/40 border-slate-800/40 text-slate-100"
          : "bg-slate-100/70 border-slate-200 text-slate-800"
      } ${
        liveTip.type === "BULLISH"
          ? "border-l-4 border-l-emerald-500"
          : liveTip.type === "BEARISH"
          ? "border-l-4 border-l-rose-500"
          : "border-l-4 border-l-amber-500"
      }`}>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-[9.5px] font-black uppercase tracking-wider ${
            liveTip.type === "BULLISH" ? "text-emerald-400" : liveTip.type === "BEARISH" ? "text-rose-400" : "text-amber-400"
          }`}>
            {liveTip.title}
          </span>
        </div>
        <p className={`text-[10px] leading-relaxed font-bold ${
          darkMode ? "text-slate-200" : "text-slate-700"
        }`}>
          {liveTip.text}
        </p>
      </div>
    </div>
  );
}
