/** IST-aware time utilities — single source of truth for all time logic */

export interface ISTTime {
  h: number;
  m: number;
  s: number;
  timeStr: string;    // "HH:MM"
  dayOfWeek: number;  // 0=Sun 6=Sat
  totalMinutes: number;
}

export function getISTTime(): ISTTime {
  const now   = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000; // UTC → IST (+5:30)
  const ist   = new Date(istMs);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const s = ist.getUTCSeconds();
  return {
    h, m, s,
    timeStr:      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    dayOfWeek:    ist.getUTCDay(),
    totalMinutes: h * 60 + m,
  };
}

/** True while IST time is within market hours (Mon–Fri 09:00–16:15) */
export function isMarketHours(): boolean {
  const { dayOfWeek, totalMinutes } = getISTTime();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  return totalMinutes >= 9 * 60 && totalMinutes <= 16 * 60 + 15;
}

export function isWeekend(): boolean {
  return [0, 6].includes(getISTTime().dayOfWeek);
}
