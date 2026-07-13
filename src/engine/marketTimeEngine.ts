/**
 * marketTimeEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Market Session Time Engine v1.0 (Institutional Time Controller)
 *
 * Tracks local IST clock, classifies active session phases (Opening, Midday, Slow, Expiry),
 * enforces trading execution locks, and calculates counts to open and close.
 *
 * Pure TypeScript — no React, no side effects.
 */

export interface MarketTimeEngineResult {
  currentTime: string;       // IST current time string "HH:MM:SS"
  marketStatus: "PRE_OPEN" | "LIVE_MARKET" | "POST_MARKET" | "CLOSED";
  sessionType: "OPENING" | "MID" | "SLOW" | "CLOSING";
  isTradingAllowed: boolean;
  volatilityLevel: "LOW" | "NORMAL" | "HIGH";
  countdownToOpen: string;
  countdownToClose: string;
  
  // Detailed session flags
  session: {
    isMarketOpen: boolean;
    isTradingAllowed: boolean;
    isVolatilityHigh: boolean;
    isOpeningHour: boolean;
    isClosingHour: boolean;
  };
}

function formatCountdown(sec: number): string {
  if (sec <= 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function computeMarketTime(currentTimeMs: number): MarketTimeEngineResult {
  // Convert UTC timestamp to IST (+5:30) values explicitly
  const istDate = new Date(currentTimeMs + 19800000); // 5.5 * 3600 * 1000

  const dayOfWeek = istDate.getUTCDay(); // 0=Sun, 6=Sat
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const seconds = istDate.getUTCSeconds();
  const totalMins = hours * 60 + minutes;
  const totalSecs = totalMins * 60 + seconds;

  const currentTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  let marketStatus: "PRE_OPEN" | "LIVE_MARKET" | "POST_MARKET" | "CLOSED" = "CLOSED";

  if (!isWeekend) {
    if (totalMins >= 9 * 60 && totalMins < 9 * 60 + 15) {
      marketStatus = "PRE_OPEN";
    } else if (totalMins >= 9 * 60 + 15 && totalMins <= 15 * 60 + 30) {
      marketStatus = "LIVE_MARKET";
    } else if (totalMins > 15 * 60 + 30 && totalMins <= 16 * 60) {
      marketStatus = "POST_MARKET";
    }
  }

  const isTradingAllowed = marketStatus === "LIVE_MARKET";

  // Volatility detection
  const isVolatilityHigh = marketStatus === "LIVE_MARKET" && (
    (totalMins >= 9 * 60 + 15 && totalMins <= 9 * 60 + 45) || // 9:15 - 9:45
    (totalMins >= 14 * 60 + 45 && totalMins <= 15 * 60 + 30)   // 14:45 - 15:30
  );

  const volatilityLevel: "LOW" | "NORMAL" | "HIGH" = 
    isVolatilityHigh ? "HIGH" : 
    (marketStatus === "CLOSED" ? "LOW" : "NORMAL");

  // Session flags
  const isMarketOpen = marketStatus !== "CLOSED";
  const isOpeningHour = marketStatus === "LIVE_MARKET" && (totalMins >= 9 * 60 + 15 && totalMins < 10 * 60 + 30);
  const isClosingHour = marketStatus === "LIVE_MARKET" && (totalMins >= 14 * 60 + 45 && totalMins <= 15 * 60 + 30);

  // Session type classification
  let sessionType: "OPENING" | "MID" | "SLOW" | "CLOSING" = "MID";
  if (totalMins >= 9 * 60 + 15 && totalMins < 10 * 60 + 30) {
    sessionType = "OPENING";
  } else if (totalMins >= 10 * 60 + 30 && totalMins < 12 * 60 + 30) {
    sessionType = "MID";
  } else if (totalMins >= 12 * 60 + 30 && totalMins < 14 * 60 + 45) {
    sessionType = "SLOW";
  } else {
    sessionType = "CLOSING";
  }

  // Countdowns to open & close
  let countdownToOpen = "00:00:00";
  let countdownToClose = "00:00:00";

  if (marketStatus === "LIVE_MARKET") {
    const secsToClose = (15 * 3600 + 30 * 60) - totalSecs;
    countdownToClose = formatCountdown(secsToClose);
  } else {
    // CLOSED / PRE_OPEN / POST_MARKET
    let targetDate = new Date(currentTimeMs);
    let found = false;
    
    for (let i = 0; i < 10; i++) {
      const checkIst = new Date(targetDate.getTime() + 19800000);
      const checkDay = checkIst.getUTCDay();
      const checkIsWeekend = checkDay === 0 || checkDay === 6;
      
      if (!checkIsWeekend) {
        // Compute 09:15:00 IST of this date in UTC ms
        // Set hours/minutes/seconds of the checkIst copy
        const copyIst = new Date(checkIst);
        copyIst.setUTCHours(9, 15, 0, 0);
        const openTimeMs = copyIst.getTime() - 19800000;
        
        if (openTimeMs > currentTimeMs) {
          const diffSec = Math.floor((openTimeMs - currentTimeMs) / 1000);
          countdownToOpen = formatCountdown(diffSec);
          found = true;
          break;
        }
      }
      targetDate.setDate(targetDate.getDate() + 1);
    }
    if (!found) {
      countdownToOpen = "00:00:00";
    }
  }

  return {
    currentTime,
    marketStatus,
    sessionType,
    isTradingAllowed,
    volatilityLevel,
    countdownToOpen,
    countdownToClose,
    session: {
      isMarketOpen,
      isTradingAllowed,
      isVolatilityHigh,
      isOpeningHour,
      isClosingHour,
    },
  };
}
