import React, { useMemo, useState, useEffect } from "react";
import { Zap, Flame, Check, X, AlertTriangle, TrendingUp, HelpCircle } from "lucide-react";
import { OptionStrike } from "../types";

interface HeroZeroBoxProps {
  activePage: "NIFTY" | "SENSEX" | "BANKNIFTY" | "BANKNIFTY";
  spotPrice: number;
  optionChain: OptionStrike[];
  darkMode: boolean;
}

export default function HeroZeroBox({
  activePage,
  spotPrice,
  optionChain = [],
  darkMode,
}: HeroZeroBoxProps) {
  const [simulateExpiry, setSimulateExpiry] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Expiry check logic (Nifty = Thursday, Sensex = Friday)
  const isExpiryDay = useMemo(() => {
    if (simulateExpiry) return true;
    const day = currentTime.getDay();
    if (activePage === "NIFTY" && day === 4) return true; // Thursday
    if (activePage === "SENSEX" && day === 5) return true; // Friday
    return false;
  }, [currentTime, activePage, simulateExpiry]);

  // Expiry high volatility window (12:30 PM - 3:15 PM IST)
  const isExpiryWindow = useMemo(() => {
    if (simulateExpiry) return true;
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    const timeVal = hours * 60 + minutes;
    return timeVal >= 12 * 60 + 30 && timeVal <= 15 * 60 + 15; // 12:30 to 15:15
  }, [currentTime, simulateExpiry]);

  // Compute Hero Zero signals
  const heroData = useMemo(() => {
    const spotPx = spotPrice || 0;
    const strikeGap = activePage === "SENSEX" ? 100 : 50;
    const atmStrike = spotPx > 0 ? Math.round(spotPx / strikeGap) * strikeGap : 0;

    if (optionChain.length === 0 || !isExpiryDay) {
      return {
        active: false,
        signal: "WAIT" as const,
        ceStrike: 0,
        peStrike: 0,
        cePremium: 0,
        pePremium: 0,
        pcrVal: 1.0,
        reasons: isExpiryDay ? ["Waiting for option chain data feed..."] : ["Monitoring. Hero-Zero is active only on Expiry days (Thursday for Nifty, Friday for Sensex)."],
      };
    }

    // PCR Calculation
    const totalCallOi = optionChain.reduce((sum, s) => sum + s.ceOI, 0);
    const totalPutOi = optionChain.reduce((sum, s) => sum + s.peOI, 0);
    const pcrVal = totalCallOi > 0 ? parseFloat((totalPutOi / totalCallOi).toFixed(2)) : 1.0;

    // Average volume for baseline
    const avgCeVolume = optionChain.reduce((sum, s) => sum + s.ceVolume, 0) / optionChain.length;
    const avgPeVolume = optionChain.reduce((sum, s) => sum + s.peVolume, 0) / optionChain.length;

    // 1. Find best cheap out-of-the-money (OTM) strikes (Ideal premium range: ₹5 to ₹20)
    // For CE: we search above ATM
    const otmCalls = optionChain
      .filter(s => s.strikePrice > atmStrike && s.ceLtp >= 4 && s.ceLtp <= 22)
      .sort((a, b) => a.strikePrice - b.strikePrice); // closest to ATM first
    
    // For PE: we search below ATM
    const otmPuts = optionChain
      .filter(s => s.strikePrice < atmStrike && s.peLtp >= 4 && s.peLtp <= 22)
      .sort((a, b) => b.strikePrice - a.strikePrice); // closest to ATM first

    const bestCeRow = otmCalls[0] || optionChain.find(s => s.strikePrice === atmStrike + strikeGap) || null;
    const bestPeRow = otmPuts[0] || optionChain.find(s => s.strikePrice === atmStrike - strikeGap) || null;

    const ceStrike = bestCeRow ? bestCeRow.strikePrice : atmStrike + strikeGap;
    const peStrike = bestPeRow ? bestPeRow.strikePrice : atmStrike - strikeGap;
    const cePremium = bestCeRow ? bestCeRow.ceLtp : 0;
    const pePremium = bestPeRow ? bestPeRow.peLtp : 0;

    // 2. Score the setups for high-velocity Hero-Zero breakouts
    let ceScore = 0;
    let peScore = 0;
    const triggerReasons: string[] = [];

    // PCR bias
    if (pcrVal > 1.15) ceScore += 1.5;
    if (pcrVal < 0.80) peScore += 1.5;

    // ATM volume surges
    const atmRow = optionChain.find(s => s.strikePrice === atmStrike);
    if (atmRow) {
      if (atmRow.ceVolume > avgCeVolume * 1.5) ceScore += 1;
      if (atmRow.peVolume > avgPeVolume * 1.5) peScore += 1;
    }

    // OTM volume spikes (heavy retail/institutional spec buying)
    if (bestCeRow && bestCeRow.ceVolume > avgCeVolume * 1.4) {
      ceScore += 1.5;
      triggerReasons.push(`OTM CE Strike ${ceStrike} shows massive volume spike (${Math.round(bestCeRow.ceVolume / avgCeVolume)}x avg).`);
    }
    if (bestPeRow && bestPeRow.peVolume > avgPeVolume * 1.4) {
      peScore += 1.5;
      triggerReasons.push(`OTM PE Strike ${peStrike} shows massive volume spike (${Math.round(bestPeRow.peVolume / avgPeVolume)}x avg).`);
    }

    // Option premium rate of change (velocity check)
    if (bestCeRow && bestCeRow.ceChg > 10) ceScore += 1;
    if (bestPeRow && bestPeRow.peChg > 10) peScore += 1;

    let signal: "HERO_CE" | "HERO_PE" | "WAIT" = "WAIT";

    // Setup window validation
    if (isExpiryWindow) {
      if (ceScore >= 2.5 && ceScore > peScore) {
        signal = "HERO_CE";
        triggerReasons.push("🔥 CE Option sellers are caught in a short squeeze trap at resistance.");
        triggerReasons.push(`📊 PCR is highly bullish at ${pcrVal}.`);
        triggerReasons.push(`💰 ATM Call Volume is running hot, supporting rapid momentum.`);
      } else if (peScore >= 2.5 && peScore > ceScore) {
        signal = "HERO_PE";
        triggerReasons.push("🔥 PE Option sellers are caught in a short squeeze trap at support.");
        triggerReasons.push(`📊 PCR is highly bearish at ${pcrVal}.`);
        triggerReasons.push(`💰 ATM Put Volume is running hot, supporting rapid momentum.`);
      }
    } else {
      triggerReasons.push("⏳ Outside of Hero-Zero trade window. Best results between 12:30 and 15:15 IST.");
    }

    if (signal === "WAIT") {
      triggerReasons.push("Balanced seller writing. Theta decay is currently evaporating OTM premiums.");
      triggerReasons.push(`PCR remains flat at ${pcrVal}.`);
    }

    return {
      active: true,
      signal,
      ceStrike,
      peStrike,
      cePremium,
      pePremium,
      pcrVal,
      reasons: triggerReasons,
    };
  }, [optionChain, spotPrice, isExpiryDay, isExpiryWindow, activePage, simulateExpiry]);

  // Locked values when signal triggers
  const [lockedSignal, setLockedSignal] = useState<"HERO_CE" | "HERO_PE" | "WAIT">("WAIT");
  const [lockedStrike, setLockedStrike] = useState<number>(0);
  const [lockedEntry, setLockedEntry] = useState<number>(0);
  const [lastPage, setLastPage] = useState<"NIFTY" | "SENSEX" | "BANKNIFTY">(activePage);

  useEffect(() => {
    if (activePage !== lastPage) {
      setLastPage(activePage);
      setLockedSignal("WAIT");
      setLockedStrike(0);
      setLockedEntry(0);
      return;
    }

    if (heroData.signal === "WAIT") {
      setLockedSignal("WAIT");
      setLockedStrike(0);
      setLockedEntry(0);
    } else if (heroData.signal !== lockedSignal) {
      setLockedSignal(heroData.signal);
      if (heroData.signal === "HERO_CE") {
        setLockedStrike(heroData.ceStrike);
        setLockedEntry(heroData.cePremium);
      } else {
        setLockedStrike(heroData.peStrike);
        setLockedEntry(heroData.pePremium);
      }
    }
  }, [heroData.signal, activePage, lastPage, heroData.ceStrike, heroData.peStrike, heroData.cePremium, heroData.pePremium, lockedSignal]);

  const signalStyle = {
    HERO_CE: "bg-emerald-950/90 border-emerald-500/90 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] animate-pulse",
    HERO_PE: "bg-rose-950/90 border-rose-500/90 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.4)] animate-pulse",
    WAIT: "bg-slate-900/50 border-slate-800 text-slate-400"
  }[heroData.signal];

  const signalText = {
    HERO_CE: "🚀 HERO-ZERO CALL ACTIVE (CE)",
    HERO_PE: "💥 HERO-ZERO PUT ACTIVE (PE)",
    WAIT: "⏸ MONITORING VOLATILITY"
  }[heroData.signal];

  return (
    <div className={`p-3.5 rounded-2xl flex flex-col gap-3 border shadow-[0_4px_25px_rgba(139,92,246,0.08)] relative overflow-hidden transition-all duration-300 select-none ${
      darkMode 
        ? "bg-gradient-to-br from-[#1b1230]/90 via-[#0e0a1c]/95 to-[#080512]/90 border-[#311f4d]" 
        : "bg-gradient-to-br from-purple-50/95 via-slate-100/90 to-purple-100/95 border-purple-200 text-slate-800"
    }`}>
      {/* Top Accent Line (Expiry Purple) */}
      <div className={`absolute top-0 left-0 w-full h-[2px] ${
        heroData.signal === "HERO_CE" 
          ? "bg-emerald-500" 
          : heroData.signal === "HERO_PE" 
            ? "bg-rose-500" 
            : "bg-gradient-to-r from-purple-500 via-fuchsia-500 to-indigo-500"
      }`} />

      {/* Header */}
      <div className="flex items-center justify-between border-b pb-1.5 dark:border-slate-800/60 border-slate-200/60 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Flame size={12} className="text-purple-400 animate-bounce" />
          <span className={`text-[10px] font-black uppercase tracking-widest ${darkMode ? "text-purple-300" : "text-purple-700"}`}>
            Expiry Hero-Zero Desk
          </span>
        </div>
        
        {/* Toggle Simulation */}
        <button 
          onClick={() => setSimulateExpiry(!simulateExpiry)}
          className={`text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
            simulateExpiry 
              ? "bg-purple-500/20 border-purple-500 text-purple-300" 
              : "dark:bg-slate-900 bg-white dark:border-slate-800 border-slate-300 text-slate-500 hover:text-purple-400"
          }`}
        >
          {simulateExpiry ? "SIMULATING EXPIRY" : "LIVE MODE"}
        </button>
      </div>

      {/* Info Warning if Not Expiry Day */}
      {!isExpiryDay && (
        <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[9.5px] text-amber-500 leading-tight">
          <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
          <span>Hero-Zero trades are inactive today. Tap the <b>"LIVE MODE"</b> button above to simulate an active Expiry Session for demo purposes.</span>
        </div>
      )}

      {/* Expiry Status Badges */}
      {isExpiryDay && (
        <div className="flex justify-between items-center text-[8.5px] font-black uppercase tracking-wider px-1 py-0.5">
          <span className="text-slate-500">Session Status:</span>
          <span className={isExpiryWindow ? "text-emerald-400 animate-pulse" : "text-amber-500"}>
            {isExpiryWindow ? "🟢 VOLATILITY WINDOW ACTIVE" : "⏳ AWAITING WINDOW (12:30-15:15)"}
          </span>
        </div>
      )}

      {/* Signal Banner */}
      <div className={`flex items-center justify-center py-2 px-2.5 rounded-xl border font-black text-xs uppercase tracking-wider text-center ${signalStyle}`}>
        {signalText}
      </div>

      {/* Hero Targets (Shown only on Signal) */}
      {heroData.signal !== "WAIT" && (
        <div className="flex flex-col gap-2 border-t border-b dark:border-slate-800/40 border-slate-200/60 py-2.5">
          {/* Strike details */}
          <div className="flex justify-between items-center px-1">
            <span className={`text-[8px] font-black uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Target Strike Info</span>
            <span className="text-[8.5px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.2 rounded">
              {lockedSignal === "HERO_CE" ? "OTM CE" : "OTM PE"}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 font-mono text-center">
            {/* Strike */}
            <div className="flex flex-col items-center p-1 rounded-lg dark:bg-black/40 border dark:border-slate-850 bg-slate-100/60 border-slate-200/60">
              <span className="text-[7px] uppercase text-slate-500 font-black">Strike</span>
              <span className="text-[11px] font-black text-slate-350 dark:text-white mt-0.5">
                {lockedStrike}
              </span>
            </div>

            {/* Entry Buy Premium */}
            <div className="flex flex-col items-center p-1 rounded-lg dark:bg-purple-950/20 border dark:border-purple-500/30 bg-purple-50/50 border-purple-200/60">
              <span className="text-[7px] uppercase text-purple-600 dark:text-purple-400 font-black">Buy LTP</span>
              <span className="text-[11px] font-black text-purple-600 dark:text-purple-300 mt-0.5">
                ₹{lockedEntry.toFixed(2)}
              </span>
            </div>

            {/* Stop Loss */}
            <div className="flex flex-col items-center p-1 rounded-lg dark:bg-rose-950/20 border dark:border-rose-500/30 bg-rose-50/50 border-rose-200/60">
              <span className="text-[7px] uppercase text-rose-600 dark:text-rose-400 font-black">Stop Loss</span>
              <span className="text-[11px] font-black text-rose-600 dark:text-rose-300 mt-0.5">
                ₹0.00
              </span>
            </div>

            {/* Multiplier (Jackpot) Target */}
            <div className="flex flex-col items-center p-1 rounded-lg dark:bg-emerald-950/20 border dark:border-emerald-500/30 bg-emerald-50/50 border-emerald-200/60">
              <span className="text-[7px] uppercase text-emerald-600 dark:text-emerald-400 font-black">Target (5x)</span>
              <span className="text-[11px] font-black text-emerald-600 dark:text-emerald-300 mt-0.5">
                ₹{(lockedEntry * 5).toFixed(0)}
              </span>
            </div>
          </div>

          {/* Return Multipliers Slider/Progress */}
          <div className="flex flex-col gap-1 px-1">
            <span className={`text-[7.5px] font-black uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Return Jackpot Targets</span>
            <div className="grid grid-cols-3 gap-1 font-mono text-[9.5px]">
              <div className="flex justify-between items-center px-1.5 py-0.5 rounded dark:bg-black/30 border dark:border-slate-800 bg-slate-50 border-slate-200">
                <span className="text-slate-450 font-bold">Double (2x):</span>
                <span className="text-emerald-400 font-black">₹{(lockedEntry * 2).toFixed(1)}</span>
              </div>
              <div className="flex justify-between items-center px-1.5 py-0.5 rounded dark:bg-black/30 border dark:border-slate-800 bg-slate-50 border-slate-200 animate-pulse">
                <span className="text-amber-450 font-bold">Jackpot (4x):</span>
                <span className="text-amber-400 font-black">₹{(lockedEntry * 4).toFixed(1)}</span>
              </div>
              <div className="flex justify-between items-center px-1.5 py-0.5 rounded dark:bg-purple-950/30 border dark:border-purple-500/20 bg-purple-50 border-purple-200">
                <span className="text-purple-450 font-bold">Hero (8x):</span>
                <span className="text-purple-300 font-black">₹{(lockedEntry * 8).toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Monitor list (CE & PE OTM strike premiums) */}
      <div className="grid grid-cols-2 gap-1.5 font-mono text-center">
        {/* CE OTM Option */}
        <div className={`flex flex-col p-1.5 rounded-lg border transition-all duration-300 ${
          heroData.signal === "HERO_CE" 
            ? "bg-emerald-950/20 border-emerald-500/50" 
            : "dark:bg-black/20 dark:border-slate-850 bg-slate-100/30 border-slate-200/40"
        }`}>
          <div className="flex justify-between items-center px-1">
            <span className="text-[7.5px] font-black text-slate-500">OTM CE ({heroData.ceStrike || "—"})</span>
            {heroData.signal === "HERO_CE" && <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 rounded font-black animate-pulse">HERO CE</span>}
          </div>
          <div className="flex justify-between items-baseline mt-1 px-1">
            <span className="text-[9.5px] text-slate-500">Premium:</span>
            <span className={`text-[11px] font-black ${heroData.signal === "HERO_CE" ? "text-emerald-400 animate-pulse" : "dark:text-slate-350 text-slate-700"}`}>
              ₹{(heroData.cePremium || 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* PE OTM Option */}
        <div className={`flex flex-col p-1.5 rounded-lg border transition-all duration-300 ${
          heroData.signal === "HERO_PE" 
            ? "bg-rose-950/20 border-rose-500/50" 
            : "dark:bg-black/20 dark:border-slate-850 bg-slate-100/30 border-slate-200/40"
        }`}>
          <div className="flex justify-between items-center px-1">
            <span className="text-[7.5px] font-black text-slate-500">OTM PE ({heroData.peStrike || "—"})</span>
            {heroData.signal === "HERO_PE" && <span className="text-[8px] bg-rose-500/20 text-rose-400 px-1 rounded font-black animate-pulse">HERO PE</span>}
          </div>
          <div className="flex justify-between items-baseline mt-1 px-1">
            <span className="text-[9.5px] text-slate-500">Premium:</span>
            <span className={`text-[11px] font-black ${heroData.signal === "HERO_PE" ? "text-rose-400 animate-pulse" : "dark:text-slate-350 text-slate-700"}`}>
              ₹{(heroData.pePremium || 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Reasons & Logs */}
      <div className="space-y-1.5 border-t dark:border-slate-800/60 border-slate-200/60 pt-2 flex-shrink-0">
        <span className={`text-[8px] font-black uppercase tracking-wider block ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
          HERO-ZERO ACTION LOGS &amp; STATS
        </span>
        <div className="space-y-1 font-mono text-[9px] dark:text-purple-300 text-purple-700">
          {heroData.reasons.map((reason, idx) => (
            <div key={idx} className="flex items-start gap-1 leading-tight py-0.5">
              <span className="text-purple-400 font-bold">•</span>
              <span>{reason}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
