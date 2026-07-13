import fs   from "fs";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { marketState } from "../state/marketState.js";
import { getISTTime } from "../utils/timerUtils.js";
import { recalcStock } from "../utils/calculateScore.js";
import { broadcastAll } from "./socketBroadcast.js";

const STORAGE_DIR = path.join(process.cwd(), "server", "storage");

function ensure(): void {
  if (!fs.existsSync(STORAGE_DIR))
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

export function getISTDateStr(): string {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

export const fp = (label: string, dateStr?: string) => {
  const d = dateStr || getISTDateStr();
  return path.join(STORAGE_DIR, `${label}_${d}.json`);
};

// ─── Disk persistence ─────────────────────────────────────────────────────────

// ─── Google Drive Auto Backup Helper ─────────────────────────────────────────

function copyToGoogleDrive(filename: string, fileContent: string): void {
  try {
    let drivePath = process.env.GOOGLE_DRIVE_BACKUP_PATH;
    if (!drivePath) {
      // Auto-detect common Google Drive folders on Windows
      const userProfile = process.env.USERPROFILE || "C:\\Users\\gt";
      const candidates = [
        path.join(userProfile, "Google Drive", "My Drive"),
        path.join(userProfile, "My Drive"),
        "G:\\My Drive",
        path.join(userProfile, "Google Drive")
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          drivePath = path.join(cand, "IntradayWebBackups");
          break;
        }
      }
    } else {
      drivePath = path.resolve(drivePath);
    }

    if (drivePath) {
      if (!fs.existsSync(drivePath)) {
        fs.mkdirSync(drivePath, { recursive: true });
      }
      const targetPath = path.join(drivePath, filename);
      fs.writeFileSync(targetPath, fileContent, "utf8");
      console.log(`[GoogleDriveSync] ☁️ Backup auto-saved to Google Drive: ${targetPath}`);
    }
  } catch (e: any) {
    console.warn(`[GoogleDriveSync] ⚠️ Auto-save to Google Drive failed:`, e.message);
  }
}

// ─── Disk persistence ─────────────────────────────────────────────────────────

function saveIndexScoresOnly(dStr: string, nifty: any, sensex: any, banknifty: any): void {
  try {
    const indexScores = {
      nifty: {
        "NIFTY 50": nifty["NIFTY 50"] || {}
      },
      sensex: {
        "SENSEX": sensex["SENSEX"] || {}
      },
      banknifty: {
        "NIFTY BANK": banknifty["NIFTY BANK"] || {}
      }
    };
    const indexDataStr = JSON.stringify(indexScores);
    fs.writeFileSync(fp("index_scores", dStr), indexDataStr, "utf8");
    copyToGoogleDrive(`index_scores_${dStr}.json`, indexDataStr);
  } catch (e) {
    console.error("[Backup] save index_scores failed:", e);
  }
}

function save5m(): void {
  ensure();
  const dStr = getISTDateStr();
  try {
    const data = JSON.stringify({ nifty: marketState.niftyBackup, sensex: marketState.sensexBackup, banknifty: marketState.bankniftyBackup });
    fs.writeFileSync(fp("5m", dStr), data, "utf8");
    copyToGoogleDrive(`5m_${dStr}.json`, data);
    saveIndexScoresOnly(dStr, marketState.niftyBackup, marketState.sensexBackup, marketState.bankniftyBackup);
  }
  catch (e) { console.error("[Backup] save 5m failed:", e); }
}

function saveTimed(label: "15m" | "30m" | "1h"): void {
  ensure();
  const dStr = getISTDateStr();
  try {
    const data = JSON.stringify({ nifty: marketState.niftyTimedBackup, sensex: marketState.sensexTimedBackup, banknifty: marketState.bankniftyTimedBackup });
    fs.writeFileSync(fp(label, dStr), data, "utf8");
    copyToGoogleDrive(`${label}_${dStr}.json`, data);
  }
  catch (e) { console.error(`[Backup] save ${label} failed:`, e); }
}

// ─── Restore on startup ───────────────────────────────────────────────────────

function restoreBackupScores(): void {
  for (const stock of Object.values(marketState.niftyStocks)) {
    const snaps = marketState.niftyBackup[stock.symbol];
    if (snaps) {
      const times = Object.keys(snaps).sort();
      if (times.length) stock.backupScore = snaps[times[times.length - 1]];
    }
    recalcStock(stock);
  }
  for (const stock of Object.values(marketState.sensexStocks)) {
    const snaps = marketState.sensexBackup[stock.symbol];
    if (snaps) {
      const times = Object.keys(snaps).sort();
      if (times.length) stock.backupScore = snaps[times[times.length - 1]];
    }
    recalcStock(stock);
  }
  for (const stock of Object.values(marketState.bankniftyStocks)) {
    const snaps = marketState.bankniftyBackup[stock.symbol];
    if (snaps) {
      const times = Object.keys(snaps).sort();
      if (times.length) stock.backupScore = snaps[times[times.length - 1]];
    }
    recalcStock(stock);
  }
}

function getLatestSnap(store: Record<string, Record<string, number>>, prefix: string): Record<string, number> {
  const keys = Object.keys(store).filter(k => k.startsWith(prefix)).sort();
  return keys.length ? store[keys[keys.length - 1]] ?? {} : {};
}

function restoreTimedBackups(): void {
  const n15 = getLatestSnap(marketState.niftyTimedBackup,  "15m:");
  const n30 = getLatestSnap(marketState.niftyTimedBackup,  "30m:");
  const n1h = getLatestSnap(marketState.niftyTimedBackup,  "1h:");
  const s15 = getLatestSnap(marketState.sensexTimedBackup, "15m:");
  const s30 = getLatestSnap(marketState.sensexTimedBackup, "30m:");
  const s1h = getLatestSnap(marketState.sensexTimedBackup, "1h:");
  const b15 = getLatestSnap(marketState.bankniftyTimedBackup, "15m:");
  const b30 = getLatestSnap(marketState.bankniftyTimedBackup, "30m:");
  const b1h = getLatestSnap(marketState.bankniftyTimedBackup, "1h:");
 
  for (const stock of Object.values(marketState.niftyStocks)) {
    if (n15[stock.symbol] !== undefined) stock.score15m = n15[stock.symbol];
    if (n30[stock.symbol] !== undefined) stock.score30m = n30[stock.symbol];
    if (n1h[stock.symbol] !== undefined) stock.score1h  = n1h[stock.symbol];
    recalcStock(stock);
  }
  for (const stock of Object.values(marketState.sensexStocks)) {
    if (s15[stock.symbol] !== undefined) stock.score15m = s15[stock.symbol];
    if (s30[stock.symbol] !== undefined) stock.score30m = s30[stock.symbol];
    if (s1h[stock.symbol] !== undefined) stock.score1h  = s1h[stock.symbol];
    recalcStock(stock);
  }
  for (const stock of Object.values(marketState.bankniftyStocks)) {
    if (b15[stock.symbol] !== undefined) stock.score15m = b15[stock.symbol];
    if (b30[stock.symbol] !== undefined) stock.score30m = b30[stock.symbol];
    if (b1h[stock.symbol] !== undefined) stock.score1h  = b1h[stock.symbol];
    recalcStock(stock);
  }
}

export function loadAllBackups(): void {
  ensure();
  const dStr = getISTDateStr();
  // 5M
  try {
    if (fs.existsSync(fp("5m", dStr))) {
      const d = JSON.parse(fs.readFileSync(fp("5m", dStr), "utf8"));
      if (d.nifty)  marketState.niftyBackup  = d.nifty;
      if (d.sensex) marketState.sensexBackup = d.sensex;
      if (d.banknifty) marketState.bankniftyBackup = d.banknifty;
      restoreBackupScores();
    }
  } catch (e) { console.error("[Backup] Load 5m failed:", e); }

  // Timed backups
  for (const label of ["15m", "30m", "1h"] as const) {
    try {
      if (fs.existsSync(fp(label, dStr))) {
        const d = JSON.parse(fs.readFileSync(fp(label, dStr), "utf8"));
        if (d.nifty)  Object.assign(marketState.niftyTimedBackup,  d.nifty);
        if (d.sensex) Object.assign(marketState.sensexTimedBackup, d.sensex);
        if (d.banknifty) Object.assign(marketState.bankniftyTimedBackup, d.banknifty);
      }
    } catch (e) { console.error(`[Backup] Load ${label} failed:`, e); }
  }
  restoreTimedBackups();
  console.log("[Backup] All backup stores loaded from disk");
}

// ─── Snapshot functions ───────────────────────────────────────────────────────

export function takeSnapshot5m(timeStr: string, io: SocketIOServer): void {
  console.log(`[Backup] 📸 5M snapshot @ ${timeStr}`);
  for (const stock of Object.values(marketState.niftyStocks)) {
    if (!marketState.niftyBackup[stock.symbol]) marketState.niftyBackup[stock.symbol] = {};
    marketState.niftyBackup[stock.symbol][timeStr] = stock.score;
    stock.backupScore = stock.score;
    stock.scoreDifference = 0;
  }
  for (const stock of Object.values(marketState.sensexStocks)) {
    if (!marketState.sensexBackup[stock.symbol]) marketState.sensexBackup[stock.symbol] = {};
    marketState.sensexBackup[stock.symbol][timeStr] = stock.score;
    stock.backupScore = stock.score;
    stock.scoreDifference = 0;
  }
  for (const stock of Object.values(marketState.bankniftyStocks)) {
    if (!marketState.bankniftyBackup[stock.symbol]) marketState.bankniftyBackup[stock.symbol] = {};
    marketState.bankniftyBackup[stock.symbol][timeStr] = stock.score;
    stock.backupScore = stock.score;
    stock.scoreDifference = 0;
  }

  // Freeze in memory by performing a full deep copy
  marketState.niftyBackup  = JSON.parse(JSON.stringify(marketState.niftyBackup));
  marketState.sensexBackup = JSON.parse(JSON.stringify(marketState.sensexBackup));
  marketState.bankniftyBackup = JSON.parse(JSON.stringify(marketState.bankniftyBackup));

  save5m();
  broadcastAll(io);
  io.emit("backup-update", { label: "5m", time: timeStr });
}

export function takeTimedSnapshot(label: "15m" | "30m" | "1h", timeStr: string, io: SocketIOServer): void {
  const key = `${label}:${timeStr}`;
  console.log(`[Backup] 📸 ${label} snapshot @ ${timeStr}`);

  const nSnap: Record<string, number> = {};
  for (const stock of Object.values(marketState.niftyStocks)) {
    nSnap[stock.symbol] = stock.score;
    if (label === "15m") { stock.score15m = stock.score; stock.score15mDiff = 0; }
    else if (label === "30m") { stock.score30m = stock.score; stock.score30mDiff = 0; }
    else { stock.score1h  = stock.score; stock.score1hDiff  = 0; }
  }
  marketState.niftyTimedBackup[key] = JSON.parse(JSON.stringify(nSnap));

  const sSnap: Record<string, number> = {};
  for (const stock of Object.values(marketState.sensexStocks)) {
    sSnap[stock.symbol] = stock.score;
    if (label === "15m") { stock.score15m = stock.score; stock.score15mDiff = 0; }
    else if (label === "30m") { stock.score30m = stock.score; stock.score30mDiff = 0; }
    else { stock.score1h  = stock.score; stock.score1hDiff  = 0; }
  }
  marketState.sensexTimedBackup[key] = JSON.parse(JSON.stringify(sSnap));

  const bSnap: Record<string, number> = {};
  for (const stock of Object.values(marketState.bankniftyStocks)) {
    bSnap[stock.symbol] = stock.score;
    if (label === "15m") { stock.score15m = stock.score; stock.score15mDiff = 0; }
    else if (label === "30m") { stock.score30m = stock.score; stock.score30mDiff = 0; }
    else { stock.score1h  = stock.score; stock.score1hDiff  = 0; }
  }
  marketState.bankniftyTimedBackup[key] = JSON.parse(JSON.stringify(bSnap));

  // Perform full deep copies of the timed backup stores
  marketState.niftyTimedBackup  = JSON.parse(JSON.stringify(marketState.niftyTimedBackup));
  marketState.sensexTimedBackup = JSON.parse(JSON.stringify(marketState.sensexTimedBackup));
  marketState.bankniftyTimedBackup = JSON.parse(JSON.stringify(marketState.bankniftyTimedBackup));

  saveTimed(label);
  broadcastAll(io);
  io.emit("backup-update", { label, time: timeStr });
}

// ─── Backup schedule tables ───────────────────────────────────────────────────

function buildTimes(startH: number, endH: number, stepMin: number, offsetMin = 0): string[] {
  const times: string[] = [];
  let totalMin = startH * 60 + offsetMin;
  const endMin  = endH  * 60 + 15; // allow up to HH:15 of endH
  while (totalMin <= endMin) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    totalMin += stepMin;
  }
  return times;
}

const TIMES_5M  = buildTimes(9, 16, 5,  0);   // 09:00 … 16:00
const TIMES_15M = buildTimes(9, 16, 15, 0);   // 09:00 … 16:00
const TIMES_30M = buildTimes(9, 16, 30, 15);  // 09:15 … 16:15
const TIMES_1H  = buildTimes(9, 16, 60, 15);  // 09:15 … 16:15

// ─── Scheduler ────────────────────────────────────────────────────────────────

const _lastTriggered: Record<string, string> = { "5m": "", "15m": "", "30m": "", "1h": "" };

export function startBackupScheduler(io: SocketIOServer): void {
  // Check every second — only trigger within the first 5 seconds of a minute
  setInterval(() => {
    const { h, m, s, timeStr, dayOfWeek, totalMinutes } = getISTTime();

    if (dayOfWeek === 0 || dayOfWeek === 6) return;         // weekend
    if (s >= 5) return;                                      // only first 5s of minute
    if (totalMinutes < 9 * 60 || totalMinutes > 16 * 60 + 15) return; // outside window

    if (TIMES_5M.includes(timeStr)  && timeStr !== _lastTriggered["5m"])  { _lastTriggered["5m"]  = timeStr; takeSnapshot5m(timeStr, io); }
    if (TIMES_15M.includes(timeStr) && timeStr !== _lastTriggered["15m"]) { _lastTriggered["15m"] = timeStr; takeTimedSnapshot("15m", timeStr, io); }
    if (TIMES_30M.includes(timeStr) && timeStr !== _lastTriggered["30m"]) { _lastTriggered["30m"] = timeStr; takeTimedSnapshot("30m", timeStr, io); }
    if (TIMES_1H.includes(timeStr)  && timeStr !== _lastTriggered["1h"])  { _lastTriggered["1h"]  = timeStr; takeTimedSnapshot("1h",  timeStr, io); }
  }, 1000);

  // Midnight IST reset (checked every 30s to avoid drift)
  setInterval(() => {
    const { h, m } = getISTTime();
    if (h === 0 && m === 0) {
      console.log("[Backup] 🌙 Midnight IST reset");
      marketState.niftyBackup       = {};
      marketState.sensexBackup      = {};
      marketState.bankniftyBackup   = {};
      marketState.niftyTimedBackup  = {};
      marketState.sensexTimedBackup = {};
      marketState.bankniftyTimedBackup = {};
      Object.assign(_lastTriggered, { "5m": "", "15m": "", "30m": "", "1h": "" });
      for (const stock of Object.values(marketState.niftyStocks)) {
        stock.backupScore = 0; stock.scoreDifference = 0;
        stock.score15m = 0;   stock.score15mDiff = 0;
        stock.score30m = 0;   stock.score30mDiff = 0;
        stock.score1h  = 0;   stock.score1hDiff  = 0;
      }
      for (const stock of Object.values(marketState.sensexStocks)) {
        stock.backupScore = 0; stock.scoreDifference = 0;
        stock.score15m = 0;   stock.score15mDiff = 0;
        stock.score30m = 0;   stock.score30mDiff = 0;
        stock.score1h  = 0;   stock.score1hDiff  = 0;
      }
      for (const stock of Object.values(marketState.bankniftyStocks)) {
        stock.backupScore = 0; stock.scoreDifference = 0;
        stock.score15m = 0;   stock.score15mDiff = 0;
        stock.score30m = 0;   stock.score30mDiff = 0;
        stock.score1h  = 0;   stock.score1hDiff  = 0;
      }
      save5m(); saveTimed("15m"); saveTimed("30m"); saveTimed("1h");
      broadcastAll(io);
    }
  }, 30_000);

  console.log("[Backup] ✅ Scheduler started — 5M/15M/30M/1H IST crons active");
}

export function clearBackup(page: "NIFTY" | "SENSEX" | "BANKNIFTY", io: SocketIOServer, dateStr?: string): void {
  const dStr = dateStr || getISTDateStr();
  console.log(`[Backup] 🗑 Clear backup requested for ${page} on date ${dStr}`);
  
  if (dStr === getISTDateStr()) {
    if (page === "NIFTY") {
      marketState.niftyBackup = {};
      for (const stock of Object.values(marketState.niftyStocks)) {
        stock.backupScore = 0;
        recalcStock(stock);
      }
    } else if (page === "BANKNIFTY") {
      marketState.bankniftyBackup = {};
      for (const stock of Object.values(marketState.bankniftyStocks)) {
        stock.backupScore = 0;
        recalcStock(stock);
      }
    } else {
      marketState.sensexBackup = {};
      for (const stock of Object.values(marketState.sensexStocks)) {
        stock.backupScore = 0;
        recalcStock(stock);
      }
    }
    broadcastAll(io);
  }
  
  // Write empty object to the specific date file
  try {
    const emptyData = JSON.stringify({ nifty: {}, sensex: {}, banknifty: {} });
    fs.writeFileSync(fp("5m", dStr), emptyData, "utf8");
    fs.writeFileSync(fp("index_scores", dStr), emptyData, "utf8");
    copyToGoogleDrive(`index_scores_${dStr}.json`, emptyData);
  } catch (e) {
    console.error(`[Backup] clear file write failed for ${dStr}:`, e);
  }
}

export function importBackup(
  page: "NIFTY" | "SENSEX" | "BANKNIFTY",
  importedData: Record<string, Record<string, number>>,
  io: SocketIOServer,
  dateStr?: string
): void {
  const dStr = dateStr || getISTDateStr();
  console.log(`[Backup] 📥 Import backup requested for ${page} on date ${dStr}`);
  
  // Load existing file for that date first to merge
  let fileData: any = { nifty: {}, sensex: {}, banknifty: {} };
  const filePath = fp("5m", dStr);
  if (fs.existsSync(filePath)) {
    try {
      fileData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {}
  }
  
  if (!fileData.nifty) fileData.nifty = {};
  if (!fileData.sensex) fileData.sensex = {};
  if (!fileData.banknifty) fileData.banknifty = {};

  const targetBackup = page === "NIFTY" ? fileData.nifty : (page === "BANKNIFTY" ? fileData.banknifty : fileData.sensex);
  
  // Merge imported data
  for (const [symbol, times] of Object.entries(importedData)) {
    const upperSym = symbol.toUpperCase();
    if (!targetBackup[upperSym]) targetBackup[upperSym] = {};
    for (const [time, score] of Object.entries(times)) {
      targetBackup[upperSym][time] = score;
    }
  }

  // Write merged back to date file
  try {
    fs.writeFileSync(filePath, JSON.stringify(fileData), "utf8");
    saveIndexScoresOnly(dStr, fileData.nifty, fileData.sensex, fileData.banknifty);
  } catch (e) {
    console.error(`[Backup] import file write failed for ${dStr}:`, e);
  }
  
  // If today's date, sync with live memory
  if (dStr === getISTDateStr()) {
    if (page === "NIFTY") marketState.niftyBackup = fileData.nifty;
    else if (page === "BANKNIFTY") marketState.bankniftyBackup = fileData.banknifty;
    else marketState.sensexBackup = fileData.sensex;

    const stocks = page === "NIFTY" ? marketState.niftyStocks : (page === "BANKNIFTY" ? marketState.bankniftyStocks : marketState.sensexStocks);
    for (const stock of Object.values(stocks)) {
      const snaps = (page === "NIFTY" ? marketState.niftyBackup : (page === "BANKNIFTY" ? marketState.bankniftyBackup : marketState.sensexBackup))[stock.symbol];
      if (snaps) {
        const times = Object.keys(snaps).sort();
        if (times.length) {
          stock.backupScore = snaps[times[times.length - 1]];
        }
      }
      recalcStock(stock);
    }
    broadcastAll(io);
  }
}

export function importAllBackup(
  importedPayload: any,
  io: SocketIOServer,
  dateStr?: string
): void {
  const dStr = dateStr || getISTDateStr();
  console.log(`[Backup] 📥 Import ALL backup requested on date ${dStr}`);
  
  if (!importedPayload || typeof importedPayload !== "object") {
    throw new Error("Invalid imported payload format");
  }

  const fileData = {
    nifty: importedPayload.nifty || {},
    sensex: importedPayload.sensex || {},
    banknifty: importedPayload.banknifty || {},
  };

  const filePath = fp("5m", dStr);
  try {
    const dataStr = JSON.stringify(fileData);
    fs.writeFileSync(filePath, dataStr, "utf8");
    copyToGoogleDrive(`5m_${dStr}.json`, dataStr);
    saveIndexScoresOnly(dStr, fileData.nifty, fileData.sensex, fileData.banknifty);
  } catch (e) {
    console.error(`[Backup] importAll write failed for ${dStr}:`, e);
  }

  // If today's date, sync with live memory
  if (dStr === getISTDateStr()) {
    marketState.niftyBackup = fileData.nifty;
    marketState.sensexBackup = fileData.sensex;
    marketState.bankniftyBackup = fileData.banknifty;

    // Recalculate nifty
    for (const stock of Object.values(marketState.niftyStocks)) {
      const snaps = marketState.niftyBackup[stock.symbol];
      if (snaps) {
        const times = Object.keys(snaps).sort();
        if (times.length) stock.backupScore = snaps[times[times.length - 1]];
      }
      recalcStock(stock);
    }
    // Recalculate sensex
    for (const stock of Object.values(marketState.sensexStocks)) {
      const snaps = marketState.sensexBackup[stock.symbol];
      if (snaps) {
        const times = Object.keys(snaps).sort();
        if (times.length) stock.backupScore = snaps[times[times.length - 1]];
      }
      recalcStock(stock);
    }
    // Recalculate banknifty
    for (const stock of Object.values(marketState.bankniftyStocks)) {
      const snaps = marketState.bankniftyBackup[stock.symbol];
      if (snaps) {
        const times = Object.keys(snaps).sort();
        if (times.length) stock.backupScore = snaps[times[times.length - 1]];
      }
      recalcStock(stock);
    }

    broadcastAll(io);
  }
}

