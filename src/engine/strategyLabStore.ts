// ── Strategy Lab Store ────────────────────────────────────────────────────────
// Runs ALL strategies simultaneously in paper trade mode (unlimited positions).
// 1-month tracking → shows leaderboard of best vs worst strategies.
// ─────────────────────────────────────────────────────────────────────────────

export type ExitReason = "TARGET" | "SL" | "TRAILING_SL" | "SQUARE_OFF" | "MANUAL";
export type TradeDirection = "BULL" | "BEAR";
export type LabStatus = "IDLE" | "RUNNING" | "PAUSED" | "COMPLETED";

export interface LabTradeRecord {
  id:             string;
  strategyId:     string;
  strategyName:   string;
  date:           string;          // "YYYY-MM-DD"
  entryTime:      string;          // "HH:mm"
  exitTime:       string;          // "HH:mm"
  direction:      TradeDirection;
  index:          string;          // NIFTY / BANKNIFTY / SENSEX
  expiry:         string;          // e.g. "26JUN25"
  entryPremium:   number;          // Rs. entry premium paid
  exitPremium:    number;          // Rs. exit premium received
  lots:           number;
  pnl:            number;          // Net P&L in Rs.
  exitReason:     ExitReason;
  regime:         string;          // Market regime at entry
  aiConfidence:   number;          // AI confidence % at entry
  fakeBreakoutFiltered: boolean;   // Was a fake breakout signal blocked?
}

export interface DailyPnL {
  date:      string;
  pnl:       number;
  trades:    number;
  runningTotal: number;
}

export interface StrategyLabResult {
  strategyId:       string;
  strategyName:     string;
  mode:             string;
  tags:             string[];
  // Performance
  totalTrades:      number;
  wins:             number;
  losses:           number;
  winRate:          number;          // %
  totalPnL:         number;          // Rs.
  avgWin:           number;          // Rs. avg profit per winning trade
  avgLoss:          number;          // Rs. avg loss per losing trade
  profitFactor:     number;          // Total wins / Total losses
  maxDrawdown:      number;          // Rs. max drawdown
  maxDrawdownPct:   number;          // % drawdown
  bestDay:          number;          // Rs. best single day
  worstDay:         number;          // Rs. worst single day
  avgDailyPnL:      number;          // Rs. avg per active day
  sharpeRatio:      number;          // Simplified Sharpe
  consecutiveWins:  number;          // Max consecutive wins
  consecutiveLoss:  number;          // Max consecutive losses
  // Data
  trades:           LabTradeRecord[];
  dailyPnL:         DailyPnL[];
  equityCurve:      number[];        // Running P&L array
  fakeBreakoutsBlocked: number;      // How many fake signals were filtered
  rank:             number;          // Leaderboard rank (1 = best)
  grade:            "A+" | "A" | "B+" | "B" | "C" | "D" | "F";  // Performance grade
}

export interface StrategyLabConfig {
  startDate:      string;           // "YYYY-MM-DD"
  endDate:        string;           // "YYYY-MM-DD"
  capitalPerStrategy: number;       // Rs. virtual capital per strategy
  maxPositionsPerStrategy: number;  // Unlimited in lab mode
  paperMode:      true;             // Always true in lab
  includeStrategyIds: string[];     // Which strategies to test (empty = all)
  notes:          string;
}

export interface StrategyLabState {
  status:         LabStatus;
  config:         StrategyLabConfig | null;
  startedAt:      string | null;
  lastUpdatedAt:  string | null;
  results:        StrategyLabResult[];
  totalDaysElapsed: number;
  totalTradesAllStrategies: number;
  bestStrategyId: string | null;
  worstStrategyId: string | null;
  fakeBreakoutsSaved: number;       // Total Rs. saved by fake breakout filter
}

// ── Grade Calculator ──────────────────────────────────────────────────────────
export function calculateGrade(result: StrategyLabResult): StrategyLabResult["grade"] {
  const { winRate, profitFactor, totalPnL, maxDrawdown } = result;
  const drawdownPct = totalPnL > 0 ? Math.abs(maxDrawdown) / totalPnL : 1;

  if (winRate >= 65 && profitFactor >= 2.0 && totalPnL > 10000 && drawdownPct < 0.3) return "A+";
  if (winRate >= 60 && profitFactor >= 1.7 && totalPnL > 5000) return "A";
  if (winRate >= 55 && profitFactor >= 1.4 && totalPnL > 0) return "B+";
  if (winRate >= 50 && profitFactor >= 1.2 && totalPnL > 0) return "B";
  if (winRate >= 45 && totalPnL > 0) return "C";
  if (totalPnL > 0) return "D";
  return "F";
}

// ── Profit Factor ─────────────────────────────────────────────────────────────
export function calcProfitFactor(trades: LabTradeRecord[]): number {
  const totalWins  = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const totalLoss  = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  return totalLoss === 0 ? (totalWins > 0 ? 9.99 : 0) : +(totalWins / totalLoss).toFixed(2);
}

// ── Max Drawdown ──────────────────────────────────────────────────────────────
export function calcMaxDrawdown(equityCurve: number[]): { dd: number; pct: number } {
  let peak = 0, maxDD = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) maxDD = dd;
  }
  return { dd: -maxDD, pct: peak > 0 ? (maxDD / peak) * 100 : 0 };
}

// ── Sharpe (simplified) ───────────────────────────────────────────────────────
export function calcSharpe(dailyPnl: number[]): number {
  if (dailyPnl.length < 2) return 0;
  const avg = dailyPnl.reduce((s, v) => s + v, 0) / dailyPnl.length;
  const std = Math.sqrt(dailyPnl.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / dailyPnl.length);
  return std === 0 ? 0 : +(avg / std * Math.sqrt(252)).toFixed(2);
}

// ── Consecutive Streaks ───────────────────────────────────────────────────────
export function calcStreaks(trades: LabTradeRecord[]): { wins: number; losses: number } {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curW++; curL = 0; maxW = Math.max(maxW, curW); }
    else            { curL++; curW = 0; maxL = Math.max(maxL, curL); }
  }
  return { wins: maxW, losses: maxL };
}

// ── Build Result from Trades ──────────────────────────────────────────────────
export function buildResult(
  strategyId: string,
  strategyName: string,
  mode: string,
  tags: string[],
  trades: LabTradeRecord[]
): StrategyLabResult {
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);

  // Daily P&L
  const dailyMap: Record<string, number> = {};
  const dailyTradeMap: Record<string, number> = {};
  for (const t of trades) {
    dailyMap[t.date] = (dailyMap[t.date] ?? 0) + t.pnl;
    dailyTradeMap[t.date] = (dailyTradeMap[t.date] ?? 0) + 1;
  }
  let running = 0;
  const dailyPnL: DailyPnL[] = Object.keys(dailyMap).sort().map(date => {
    running += dailyMap[date];
    return { date, pnl: dailyMap[date], trades: dailyTradeMap[date], runningTotal: running };
  });

  // Equity curve
  const equityCurve: number[] = [];
  let eq = 0;
  for (const t of trades) { eq += t.pnl; equityCurve.push(eq); }

  const { dd, pct } = calcMaxDrawdown(equityCurve);
  const { wins: cw, losses: cl } = calcStreaks(trades);
  const dailyPnlArr = dailyPnL.map(d => d.pnl);

  const result: StrategyLabResult = {
    strategyId, strategyName, mode, tags,
    totalTrades:   trades.length,
    wins:          wins.length,
    losses:        losses.length,
    winRate:       trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
    totalPnL:      +totalPnL.toFixed(0),
    avgWin:        wins.length  ? +(wins.reduce((s,t)=>s+t.pnl,0)   / wins.length).toFixed(0) : 0,
    avgLoss:       losses.length? +(losses.reduce((s,t)=>s+t.pnl,0) / losses.length).toFixed(0): 0,
    profitFactor:  calcProfitFactor(trades),
    maxDrawdown:   +dd.toFixed(0),
    maxDrawdownPct:+pct.toFixed(1),
    bestDay:       dailyPnlArr.length ? +Math.max(...dailyPnlArr).toFixed(0) : 0,
    worstDay:      dailyPnlArr.length ? +Math.min(...dailyPnlArr).toFixed(0) : 0,
    avgDailyPnL:   dailyPnlArr.length ? +(dailyPnlArr.reduce((s,v)=>s+v,0)/dailyPnlArr.length).toFixed(0):0,
    sharpeRatio:   calcSharpe(dailyPnlArr),
    consecutiveWins:  cw,
    consecutiveLoss:  cl,
    trades, dailyPnL, equityCurve,
    fakeBreakoutsBlocked: trades.filter(t => t.fakeBreakoutFiltered).length,
    rank:  0,
    grade: "C",
  };
  result.grade = calculateGrade(result);
  return result;
}

// ── Rank all results ──────────────────────────────────────────────────────────
export function rankResults(results: StrategyLabResult[]): StrategyLabResult[] {
  // Sort by composite score: 60% P&L + 25% Win Rate + 15% Profit Factor
  const scored = results.map(r => {
    const score = (r.totalPnL / 1000) * 0.6 + r.winRate * 0.25 + r.profitFactor * 10 * 0.15;
    return { ...r, _score: score };
  });
  scored.sort((a, b) => b._score - a._score);
  return scored.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ── Simulate a single paper trade (demo/backtest simulation) ──────────────────
// In real usage this would be called by the live paper trading engine.
// Here we generate realistic simulated data based on strategy win rate.
export function simulateTrade(
  strategyId: string,
  strategyName: string,
  historicalWinRate: number,  // 0-100
  date: string,
  direction: TradeDirection,
  index: string,
  expiry: string,
  regime: string,
  aiConfidence: number,
  maxLossRs: number,
  targetRs: number,
  fakeBreakoutFiltered: boolean
): LabTradeRecord {
  const isWin    = Math.random() * 100 < historicalWinRate;
  const exitReasons: ExitReason[] = isWin
    ? (Math.random() > 0.4 ? ["TARGET"] : ["TRAILING_SL"])
    : (Math.random() > 0.6 ? ["SL"] : ["SQUARE_OFF"]);
  const exitReason = exitReasons[0];

  // Realistic P&L: wins get 70-100% of target, losses get 50-100% of maxLoss
  const pnl = isWin
    ? +(targetRs  * (0.7 + Math.random() * 0.3)).toFixed(0)
    : -(maxLossRs * (0.5 + Math.random() * 0.5)).toFixed(0);

  const entryHour = 9 + Math.floor(Math.random() * 5);
  const entryMin  = Math.floor(Math.random() * 59);
  const exitHour  = Math.min(15, entryHour + Math.floor(Math.random() * 3));
  const exitMin   = Math.floor(Math.random() * 59);

  return {
    id:          `${strategyId}_${date}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    strategyId,
    strategyName,
    date,
    entryTime:   `${String(entryHour).padStart(2,"0")}:${String(entryMin).padStart(2,"0")}`,
    exitTime:    `${String(exitHour).padStart(2,"0")}:${String(exitMin).padStart(2,"0")}`,
    direction,
    index,
    expiry,
    entryPremium: +(100 + Math.random() * 200).toFixed(0),
    exitPremium:  +(100 + Math.random() * 200).toFixed(0),
    lots:         1,
    pnl,
    exitReason,
    regime,
    aiConfidence,
    fakeBreakoutFiltered,
  };
}

// ── Generate 1-month simulation for all strategies ────────────────────────────
export function generateMonthSimulation(
  strategies: Array<{ id: string; name: string; mode: string; tags: string[]; winRateHistorical: number; risk: { maxLossRs?: number; targetRs?: number } }>,
  startDate: Date = new Date()
): StrategyLabState {
  const results: StrategyLabResult[] = [];
  const indices  = ["NIFTY", "BANKNIFTY", "SENSEX"];
  const regimes  = ["BREAKOUT", "TRENDING_BULL", "TRENDING_BEAR", "RANGE", "VOLATILE"];
  const expiries = ["26JUN25", "03JUL25", "10JUL25", "31JUL25"];

  // Generate 22 trading days (approx 1 month)
  const tradingDays: string[] = [];
  const cur = new Date(startDate);
  while (tradingDays.length < 22) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) { // Skip Sat & Sun
      tradingDays.push(cur.toISOString().slice(0, 10));
    }
    cur.setDate(cur.getDate() + 1);
  }

  let totalFakeSaved = 0;

  for (const strat of strategies) {
    const trades: LabTradeRecord[] = [];
    const maxLoss = strat.risk.maxLossRs ?? 3000;
    const target  = strat.risk.targetRs  ?? 3000;

    for (const date of tradingDays) {
      // Each strategy may or may not have a trade on a given day (realistic)
      const tradeProbability = strat.mode === "INTRADAY" ? 0.65 : 0.30;
      if (Math.random() > tradeProbability) continue;

      // Sometimes fake breakout filter blocks the trade
      const fakeBlocked = Math.random() < 0.18; // 18% of signals are fake
      if (fakeBlocked) {
        totalFakeSaved += maxLoss * 0.7; // approximate saving
        // Still log it as a blocked record
        const t = simulateTrade(strat.id, strat.name, strat.winRateHistorical,
          date, Math.random() > 0.5 ? "BULL" : "BEAR",
          indices[Math.floor(Math.random() * indices.length)],
          expiries[Math.floor(Math.random() * expiries.length)],
          regimes[Math.floor(Math.random() * regimes.length)],
          50 + Math.floor(Math.random() * 30),
          maxLoss, target, true);
        t.pnl = 0; // blocked — no P&L
        trades.push(t);
        continue;
      }

      const t = simulateTrade(
        strat.id, strat.name, strat.winRateHistorical,
        date,
        Math.random() > 0.5 ? "BULL" : "BEAR",
        indices[Math.floor(Math.random() * indices.length)],
        expiries[Math.floor(Math.random() * expiries.length)],
        regimes[Math.floor(Math.random() * regimes.length)],
        55 + Math.floor(Math.random() * 35),
        maxLoss, target, false
      );
      trades.push(t);
    }

    const result = buildResult(strat.id, strat.name, strat.mode, strat.tags, trades);
    results.push(result);
  }

  const ranked = rankResults(results);
  const sorted = [...ranked].sort((a, b) => b.totalPnL - a.totalPnL);

  return {
    status:       "COMPLETED",
    config: {
      startDate:  tradingDays[0],
      endDate:    tradingDays[tradingDays.length - 1],
      capitalPerStrategy: 50000,
      maxPositionsPerStrategy: 999, // unlimited
      paperMode:  true,
      includeStrategyIds: [],
      notes: "1 Month Lab Test — All 21 strategies simultaneously",
    },
    startedAt:    tradingDays[0],
    lastUpdatedAt: new Date().toISOString(),
    results:      ranked,
    totalDaysElapsed: tradingDays.length,
    totalTradesAllStrategies: ranked.reduce((s, r) => s + r.totalTrades, 0),
    bestStrategyId:  sorted[0]?.strategyId ?? null,
    worstStrategyId: sorted[sorted.length - 1]?.strategyId ?? null,
    fakeBreakoutsSaved: +totalFakeSaved.toFixed(0),
  };
}
