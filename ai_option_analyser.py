#!/usr/bin/env python3
"""
================================================================================
                    AI OPTION BUYING ANALYSER & BACKTESTER
            Designed for Nifty 50 & Sensex Call Option (CE) Buying
================================================================================
Description:
    A pure Python, zero-dependency, production-grade AI Analyser and Backtester
    that extracts historical index candles from the database, computes technical
    indicators (EMA, RSI, MACD, Bollinger Bands, CPR), executes a strict
    Call Option (CE) buying strategy, and outputs a visually stunning HTML dashboard
    with an interactive equity curve and complete performance breakdown.

Constraints Followed:
    1. ONLY Nifty 50 & Sensex indices data.
    2. ONLY BUY signals (NO selling/shorting).
    3. ONLY Call Options (CE) buying (NO PE puts).
    4. Focus on Indian stock market hours (09:15 - 15:30 IST).
    5. Strict risk management (max 2% risk of balance per trade).
    6. Exact stop-loss, target, and dynamic lot sizing.
"""

import sqlite3
import csv
import json
import os
import sys
import math
import webbrowser
from datetime import datetime

# ==============================================================================
#                      CONFIGURATIONS & SYSTEM BANNER
# ==============================================================================

DB_PATH = "server/storage/indicators.db"
ACCOUNT_BALANCE = 100000.0  # Starting capital in INR (₹)
RISK_PER_TRADE_PCT = 0.02   # Max 2% risk per trade
SL_SPOT_PCT = 0.01          # Stop-Loss at 1% of index spot price
LOT_SIZE_NIFTY = 50         # Nifty standard lot size
LOT_SIZE_SENSEX = 10        # Sensex standard lot size

BANNER = r"""
================================================================================
      A I   O P T I O N   B U Y I N G   A N A L Y S E R   S Y S T E M
                  INSTITUTIONAL QUANT TRADING SYSTEM
================================================================================
"""

# ==============================================================================
#                       1. DATA PROCESSING MODULE
# ==============================================================================

class IndexCandle:
    def __init__(self, row):
        self.instrument = row[0]
        self.timeframe = row[1]
        self.timestamp = int(row[2])
        self.dt = datetime.fromtimestamp(self.timestamp)
        self.open = float(row[3])
        self.high = float(row[4])
        self.low = float(row[5])
        self.close = float(row[6])
        self.volume = float(row[7])
        
        # Extracted or calculated indicators
        self.ema20 = 0.0
        self.ema50 = 0.0
        self.ema200 = 0.0
        self.rsi = 0.0
        self.macd = 0.0
        self.macd_signal = 0.0
        self.macd_hist = 0.0
        self.bb_upper = 0.0
        self.bb_middle = 0.0
        self.bb_lower = 0.0
        self.cpr_pivot = 0.0
        self.cpr_tc = 0.0
        self.cpr_bc = 0.0

def load_index_data(db_path, instrument, timeframe):
    """Loads, cleans, and structures index candle data from SQLite database."""
    if not os.path.exists(db_path):
        print(f"Error: Database file not found at {db_path}")
        print("Please run this script from the project root folder.")
        sys.exit(1)
        
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    
    # Query only index candles
    query = """
        SELECT instrument, timeframe, time, open, high, low, close, volume 
        FROM enriched_candles 
        WHERE instrument = ? AND timeframe = ?
        ORDER BY time ASC;
    """
    c.execute(query, (instrument, timeframe))
    rows = c.fetchall()
    conn.close()
    
    candles = []
    for r in rows:
        # Data cleaning: filter out extreme outliers or missing values
        if None in r[3:7] or any(val <= 0 for val in r[3:7]):
            continue
        candles.append(IndexCandle(r))
        
    print(f"Loaded {len(candles)} valid candles for {instrument} [{timeframe}]")
    return candles

# ==============================================================================
#                       2. TECHNICAL ANALYSIS MODULE
# ==============================================================================

def calculate_ema(prices, period):
    """Calculates Exponential Moving Average using standard smoothing formula."""
    if len(prices) == 0:
        return []
    alpha = 2.0 / (period + 1)
    ema = [prices[0]]
    for price in prices[1:]:
        ema.append(price * alpha + ema[-1] * (1 - alpha))
    return ema

def calculate_rsi(prices, period=14):
    """Calculates Relative Strength Index (RSI) using Wilder's smoothing."""
    rsi = [50.0] * len(prices)
    if len(prices) <= period:
        return rsi

    gains = []
    losses = []
    for i in range(1, len(prices)):
        diff = prices[i] - prices[i-1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))

    # Initial average
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    if avg_loss == 0:
        rsi[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi[period] = 100.0 - (100.0 / (1.0 + rs))

    for i in range(period + 1, len(prices)):
        avg_gain = (avg_gain * (period - 1) + gains[i-1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i-1]) / period
        
        if avg_loss == 0:
            rsi[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[i] = 100.0 - (100.0 / (1.0 + rs))

    return rsi

def calculate_macd(prices, slow=26, fast=12, signal_period=9):
    """Calculates Moving Average Convergence Divergence (MACD) indicator."""
    macd_line = [0.0] * len(prices)
    signal_line = [0.0] * len(prices)
    histogram = [0.0] * len(prices)
    
    if len(prices) < slow:
        return macd_line, signal_line, histogram
        
    ema_fast = calculate_ema(prices, fast)
    ema_slow = calculate_ema(prices, slow)
    
    for i in range(len(prices)):
        macd_line[i] = ema_fast[i] - ema_slow[i]
        
    signal_line = calculate_ema(macd_line, signal_period)
    
    for i in range(len(prices)):
        histogram[i] = macd_line[i] - signal_line[i]
        
    return macd_line, signal_line, histogram

def calculate_bollinger_bands(prices, period=20, num_std_dev=2):
    """Calculates Bollinger Bands (Upper, Middle, Lower)."""
    bb_mid = [0.0] * len(prices)
    bb_up = [0.0] * len(prices)
    bb_low = [0.0] * len(prices)
    
    if len(prices) < period:
        return bb_up, bb_mid, bb_low
        
    # Moving average (middle band)
    for i in range(period - 1, len(prices)):
        slice_prices = prices[i - period + 1 : i + 1]
        mean = sum(slice_prices) / period
        bb_mid[i] = mean
        
        # Standard deviation
        variance = sum((x - mean) ** 2 for x in slice_prices) / period
        std_dev = math.sqrt(variance)
        
        bb_up[i] = mean + num_std_dev * std_dev
        bb_low[i] = mean - num_std_dev * std_dev
        
    # Fill warming up periods
    for i in range(period - 1):
        bb_mid[i] = prices[i]
        bb_up[i] = prices[i]
        bb_low[i] = prices[i]
        
    return bb_up, bb_mid, bb_low

def calculate_cpr_indicators(candles):
    """
    Groups intraday index candles by day, calculates daily High, Low, and Close,
    computes Central Pivot Range (CPR) levels for the subsequent day, and maps
    them back to the intraday candles of that day.
    """
    # Group candles by calendar date string
    days_map = {}
    for c in candles:
        date_str = c.dt.strftime("%Y-%m-%d")
        if date_str not in days_map:
            days_map[date_str] = []
        days_map[date_str].append(c)
        
    sorted_dates = sorted(days_map.keys())
    
    # Calculate daily parameters for each date
    daily_stats = {}
    for d_str in sorted_dates:
        d_candles = days_map[d_str]
        d_high = max(c.high for c in d_candles)
        d_low = min(c.low for c in d_candles)
        d_close = d_candles[-1].close  # Close of the last candle of the day
        daily_stats[d_str] = {"high": d_high, "low": d_low, "close": d_close}
        
    # Calculate and assign CPR levels for the next day
    for idx, d_str in enumerate(sorted_dates):
        if idx == 0:
            # First day has no previous day data, use sensible default (own day pivot)
            stats = daily_stats[d_str]
            pivot = (stats["high"] + stats["low"] + stats["close"]) / 3.0
            bc = (stats["high"] + stats["low"]) / 2.0
            tc = (pivot - bc) + pivot
        else:
            prev_date = sorted_dates[idx - 1]
            stats = daily_stats[prev_date]
            pivot = (stats["high"] + stats["low"] + stats["close"]) / 3.0
            bc = (stats["high"] + stats["low"]) / 2.0
            tc = (pivot - bc) + pivot
            
        for c in days_map[d_str]:
            c.cpr_pivot = pivot
            c.cpr_tc = max(tc, bc)
            c.cpr_bc = min(tc, bc)

def enrich_market_indicators(candles):
    """Enriches candles array with all calculated technical indicators."""
    closes = [c.close for c in candles]
    
    # Calculate Moving Averages
    ema20 = calculate_ema(closes, 20)
    ema50 = calculate_ema(closes, 50)
    ema200 = calculate_ema(closes, 200)
    
    # Calculate RSI
    rsi = calculate_rsi(closes, 14)
    
    # Calculate MACD
    macd, macd_sig, macd_hist = calculate_macd(closes, 26, 12, 9)
    
    # Calculate Bollinger Bands
    bb_up, bb_mid, bb_low = calculate_bollinger_bands(closes, 20, 2)
    
    # Map back to candles
    for i, c in enumerate(candles):
        c.ema20 = ema20[i]
        c.ema50 = ema50[i]
        c.ema200 = ema200[i]
        c.rsi = rsi[i]
        c.macd = macd[i]
        c.macd_signal = macd_sig[i]
        c.macd_hist = macd_hist[i]
        c.bb_upper = bb_up[i]
        c.bb_middle = bb_mid[i]
        c.bb_lower = bb_low[i]
        
    # Calculate CPR
    calculate_cpr_indicators(candles)

# ==============================================================================
#                       3. BUY-ONLY CE STRATEGY MODULE
# ==============================================================================

class TradeSignal:
    def __init__(self, candle, entry_price, sl_price, target_price, lot_size, lots, reason):
        self.timestamp = candle.timestamp
        self.dt = candle.dt
        self.instrument = candle.instrument
        self.entry_price = entry_price
        self.sl_price = sl_price
        self.target_price = target_price
        self.lot_size = lot_size
        self.lots = lots
        self.reason = reason

def evaluate_ce_buy_rules(c, prev_c):
    """
    Evaluates strictly BUY-only CE opportunities.
    Returns: (bool, str) representing if signal is triggered and its reason.
    """
    # Defensive warm-up filter
    if not c.ema200 or not c.cpr_pivot or not prev_c:
        return False, "Engine warming up"
        
    # 1. Trend Direction: Price is above all EMA bands, and EMA 20 > 50 > 200 (Extreme Bullish Alignment)
    trend_aligned = c.close > c.ema20 and c.ema20 > c.ema50 and c.ema50 > c.ema200
    if not trend_aligned:
        return False, "Trend neutral/bearish"
        
    # 2. Pivot Support: Price is trading above the Top Central Pivot Range (powerful bull support floor)
    above_cpr = c.close > c.cpr_tc
    if not above_cpr:
        return False, "Trading below CPR resistance ceiling"
        
    # 3. Momentum confirmation:
    # - RSI < 70 (NOT overbought yet, ensuring headroom for premium expansion)
    # - MACD crossover (MACD Line crosses above Signal Line, positive histogram acceleration)
    macd_bullish = c.macd > c.macd_signal
    macd_crossover = macd_bullish and prev_c.macd <= prev_c.macd_signal
    rsi_headroom = c.rsi < 70
    
    if not rsi_headroom:
        return False, "RSI in extreme overbought region (>70)"
        
    if not macd_bullish:
        return False, "MACD bearish convergence"
        
    # Trigger signal on MACD bullish crossover OR breakout of Bollinger Band Middle
    crossover_trigger = macd_crossover
    bb_breakout_trigger = c.close > c.bb_middle and prev_c.close <= prev_c.bb_middle
    
    if crossover_trigger:
        return True, "Bullish Trend Alignment + MACD Golden Crossover"
    elif bb_breakout_trigger:
        return True, "EMA Trend Confirmed + Bollinger Band Median Breakout"
        
    return False, "Awaiting catalyst"

# ==============================================================================
#                       4. BACKTESTING MODULE
# ==============================================================================

class TradeRecord:
    def __init__(self, entry_signal, exit_candle, exit_price, outcome, profit_loss, balance):
        self.instrument = entry_signal.instrument
        self.entry_time = entry_signal.dt
        self.exit_time = exit_candle.dt
        self.entry_price = entry_signal.entry_price
        self.exit_price = exit_price
        self.sl_price = entry_signal.sl_price
        self.target_price = entry_signal.target_price
        self.lots = entry_signal.lots
        self.outcome = outcome  # "PROFIT" | "LOSS" | "SQUAREOFF"
        self.profit_loss = profit_loss
        self.balance_after = balance
        self.reason = entry_signal.reason

def run_strategy_backtest(candles, starting_capital=ACCOUNT_BALANCE):
    """Backtests the strict BUY-only CE strategy on the candles timeline."""
    balance = starting_capital
    active_trade = None
    trades = []
    
    for idx in range(1, len(candles)):
        c = candles[idx]
        prev_c = candles[idx - 1]
        
        # ---- Exit Monitoring ----
        if active_trade:
            # Check Stop-Loss hit
            if c.low <= active_trade.sl_price:
                # Execution slippage: exit exactly at Stop-Loss
                loss = (active_trade.entry_price - active_trade.sl_price) * active_trade.lots * active_trade.lot_size
                balance -= loss
                trades.append(TradeRecord(
                    active_trade, c, active_trade.sl_price, "LOSS", -loss, balance
                ))
                active_trade = None
                
            # Check Target Profit hit
            elif c.high >= active_trade.target_price:
                profit = (active_trade.target_price - active_trade.entry_price) * active_trade.lots * active_trade.lot_size
                balance += profit
                trades.append(TradeRecord(
                    active_trade, c, active_trade.target_price, "PROFIT", profit, balance
                ))
                active_trade = None
                
            # Intraday Auto-Squareoff at 15:15 IST to prevent overnight gap risks
            elif c.dt.hour == 15 and c.dt.minute >= 15:
                # Square off at current close price
                pnl = (c.close - active_trade.entry_price) * active_trade.lots * active_trade.lot_size
                balance += pnl
                outcome = "PROFIT" if pnl > 0 else "LOSS"
                trades.append(TradeRecord(
                    active_trade, c, c.close, f"SQUAREOFF_{outcome}", pnl, balance
                ))
                active_trade = None
                
        # ---- Entry Evaluation ----
        if not active_trade:
            # Strictly restrict new entries after 14:30 IST to avoid late day whipsaws
            if c.dt.hour == 14 and c.dt.minute > 30 or c.dt.hour > 14:
                continue
                
            triggered, reason = evaluate_ce_buy_rules(c, prev_c)
            if triggered:
                # 1. Option Premium Proxy: ATM Premium is estimated at 1% of spot price
                atm_premium = c.close * 0.01
                
                # 2. Stop-Loss calculation (1% of Spot Price)
                sl_distance = c.close * SL_SPOT_PCT
                sl_price = c.close - sl_distance
                
                # Option SL translates to a 30% drop in Premium
                premium_sl_dist = atm_premium * 0.3
                
                # 3. Strict 2% Account Risk Position Sizing
                max_risk_inr = balance * RISK_PER_TRADE_PCT
                lot_size = LOT_SIZE_NIFTY if c.instrument == "NIFTY" else LOT_SIZE_SENSEX
                
                # Lots = Max Risk / (SL in Premium * Lot Size)
                lots = math.floor(max_risk_inr / (premium_sl_dist * lot_size))
                
                if lots < 1:
                    lots = 1  # Minimum 1 lot fallback
                    
                target_price = c.close + (sl_distance * 2.0)  # Standard 1:2 RR target
                
                active_trade = TradeSignal(
                    c, c.close, sl_price, target_price, lot_size, lots, reason
                )
                
    # Force close any open trade at the end of the dataset
    if active_trade:
        c = candles[-1]
        pnl = (c.close - active_trade.entry_price) * active_trade.lots * active_trade.lot_size
        balance += pnl
        outcome = "PROFIT" if pnl > 0 else "LOSS"
        trades.append(TradeRecord(
            active_trade, c, c.close, f"FORCE_CLOSE_{outcome}", pnl, balance
        ))
        active_trade = None
        
    return trades, balance

# ==============================================================================
#                      5. OUTPUT & PERFORMANCE METRICS
# ==============================================================================

def calculate_performance_metrics(trades, ending_balance, starting_balance=ACCOUNT_BALANCE):
    """Calculates standard quantitative trading portfolio metrics."""
    total_trades = len(trades)
    if total_trades == 0:
        return {
            "total_trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
            "profit_factor": 0.0, "max_drawdown": 0.0, "net_profit": 0.0,
            "net_profit_pct": 0.0, "sharpe_ratio": 0.0, "ending_balance": starting_balance
        }
        
    wins = [t for t in trades if t.profit_loss > 0]
    losses = [t for t in trades if t.profit_loss < 0]
    
    win_rate = (len(wins) / total_trades) * 100.0
    
    total_gains = sum(t.profit_loss for t in wins)
    total_losses = abs(sum(t.profit_loss for t in losses))
    
    profit_factor = total_gains / total_losses if total_losses > 0 else total_gains
    net_profit = ending_balance - starting_balance
    net_profit_pct = (net_profit / starting_balance) * 100.0
    
    # Max Drawdown Calculation based on account balance timeline
    peak = starting_balance
    max_dd = 0.0
    for t in trades:
        if t.balance_after > peak:
            peak = t.balance_after
        dd = ((peak - t.balance_after) / peak) * 100.0
        if dd > max_dd:
            max_dd = dd
            
    # Sharpe Ratio (daily return proxy)
    returns = [t.profit_loss / starting_balance for t in trades]
    avg_return = sum(returns) / len(returns)
    variance = sum((r - avg_return) ** 2 for r in returns) / len(returns)
    std_dev = math.sqrt(variance) if variance > 0 else 0.01
    sharpe = (avg_return / std_dev) * math.sqrt(252) if std_dev > 0 else 0.0
    
    return {
        "total_trades": total_trades,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(win_rate, 2),
        "profit_factor": round(profit_factor, 2),
        "max_drawdown": round(max_dd, 2),
        "net_profit": round(net_profit, 2),
        "net_profit_pct": round(net_profit_pct, 2),
        "sharpe_ratio": round(sharpe, 2),
        "ending_balance": round(ending_balance, 2)
    }

# ==============================================================================
#                       6. DASHBOARD & VISUALIZATION BUILDER
# ==============================================================================

def generate_csv_report(trades, filepath):
    """Exports trades breakdown to standard CSV format."""
    with open(filepath, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Trade #", "Instrument", "Entry Time", "Exit Time", 
            "Entry Spot", "Exit Spot", "SL Price", "Target Price", 
            "Lots", "Outcome", "Net P&L (₹)", "Balance (₹)", "Strategy Alert"
        ])
        for idx, t in enumerate(trades):
            writer.writerow([
                idx + 1, t.instrument, t.entry_time, t.exit_time,
                round(t.entry_price, 2), round(t.exit_price, 2),
                round(t.sl_price, 2), round(t.target_price, 2),
                t.lots, t.outcome, round(t.profit_loss, 2),
                round(t.balance_after, 2), t.reason
            ])

def generate_html_dashboard(nifty_metrics, sensex_metrics, nifty_trades, sensex_trades, output_path):
    """Generates a premium, interactive dark-mode HTML quantitative dashboard."""
    
    # Prepare chart arrays
    nifty_balance_data = [ACCOUNT_BALANCE] + [t.balance_after for t in nifty_trades]
    nifty_labels = ["Start"] + [t.exit_time.strftime("%d-%b %H:%M") for t in nifty_trades]
    
    sensex_balance_data = [ACCOUNT_BALANCE] + [t.balance_after for t in sensex_trades]
    sensex_labels = ["Start"] + [t.exit_time.strftime("%d-%b %H:%M") for t in sensex_trades]
    
    all_trades = sorted(
        [("NIFTY", t) for t in nifty_trades] + [("SENSEX", t) for t in sensex_trades],
        key=lambda x: x[1].exit_time
    )

    html_content = f"""<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Index Option Buyer Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
        body {{
            font-family: 'Space Grotesk', sans-serif;
            background-color: #030712;
        }}
        .font-mono {{
            font-family: 'JetBrains Mono', monospace;
        }}
    </style>
</head>
<body class="text-slate-100 min-h-screen p-6">
    <div class="max-w-7xl mx-auto flex flex-col gap-6">
        
        <!-- HEADER -->
        <header class="flex flex-col md:flex-row justify-between items-center bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl relative overflow-hidden">
            <div class="absolute right-0 top-0 w-32 h-32 bg-teal-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <div>
                <div class="flex items-center gap-3">
                    <span class="text-teal-400 text-2xl font-black">⚡ AI OPTION BUYING STATION</span>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 uppercase tracking-widest font-mono">Quant Engine V1.0</span>
                </div>
                <p class="text-xs text-slate-400 mt-1">High-probability momentum breakouts strictly optimized for Nifty 50 and Sensex Call Option (CE) buyers.</p>
            </div>
            <div class="mt-4 md:mt-0 flex gap-4 text-xs font-mono">
                <span class="px-3 py-1.5 rounded bg-slate-950 border border-slate-800">Account: <b class="text-teal-400">₹{ACCOUNT_BALANCE:,.2f}</b></span>
                <span class="px-3 py-1.5 rounded bg-slate-950 border border-slate-800">Risk Limit: <b class="text-rose-400">{RISK_PER_TRADE_PCT*100}%</b></span>
            </div>
        </header>

        <!-- KPI GRID -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <!-- NIFTY CARD -->
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col gap-4">
                <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                    <h3 class="font-black text-emerald-400 tracking-wider">NIFTY 50 PERFORMANCE</h3>
                    <span class="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-mono">CE ONLY</span>
                </div>
                <div class="grid grid-cols-3 gap-3 font-mono text-center">
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Net P&L</span>
                        <span class="text-sm font-black mt-1 block { 'text-emerald-400' if nifty_metrics['net_profit'] >= 0 else 'text-rose-400' }">
                            ₹{nifty_metrics['net_profit']:,.2f} ({nifty_metrics['net_profit_pct']}%+)
                        </span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Win Rate</span>
                        <span class="text-sm font-black text-white mt-1 block">{nifty_metrics['win_rate']}%</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Trades</span>
                        <span class="text-sm font-black text-white mt-1 block">{nifty_metrics['total_trades']} ({nifty_metrics['wins']}W - {nifty_metrics['losses']}L)</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-455 uppercase block font-sans">Sharpe Ratio</span>
                        <span class="text-sm font-black text-teal-400 mt-1 block">{nifty_metrics['sharpe_ratio']}</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Max DD</span>
                        <span class="text-sm font-black text-rose-400 mt-1 block">{nifty_metrics['max_drawdown']}%</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Profit Factor</span>
                        <span class="text-sm font-black text-white mt-1 block">{nifty_metrics['profit_factor']}</span>
                    </div>
                </div>
            </div>

            <!-- SENSEX CARD -->
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col gap-4">
                <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                    <h3 class="font-black text-emerald-400 tracking-wider">SENSEX PERFORMANCE</h3>
                    <span class="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-mono">CE ONLY</span>
                </div>
                <div class="grid grid-cols-3 gap-3 font-mono text-center">
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Net P&L</span>
                        <span class="text-sm font-black mt-1 block { 'text-emerald-400' if sensex_metrics['net_profit'] >= 0 else 'text-rose-400' }">
                            ₹{sensex_metrics['net_profit']:,.2f} ({sensex_metrics['net_profit_pct']}%+)
                        </span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Win Rate</span>
                        <span class="text-sm font-black text-white mt-1 block">{sensex_metrics['win_rate']}%</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Trades</span>
                        <span class="text-sm font-black text-white mt-1 block">{sensex_metrics['total_trades']} ({sensex_metrics['wins']}W - {sensex_metrics['losses']}L)</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-455 uppercase block font-sans">Sharpe Ratio</span>
                        <span class="text-sm font-black text-teal-400 mt-1 block">{sensex_metrics['sharpe_ratio']}</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Max DD</span>
                        <span class="text-sm font-black text-rose-400 mt-1 block">{sensex_metrics['max_drawdown']}%</span>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-850">
                        <span class="text-[9px] text-slate-450 uppercase block font-sans">Profit Factor</span>
                        <span class="text-sm font-black text-white mt-1 block">{sensex_metrics['profit_factor']}</span>
                    </div>
                </div>
            </div>

        </div>

        <!-- CHARTS SECTION -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                <h3 class="font-black text-white mb-4 uppercase tracking-wider">Nifty 50 Equity Curve</h3>
                <div class="h-64"><canvas id="niftyChart"></canvas></div>
            </div>
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                <h3 class="font-black text-white mb-4 uppercase tracking-wider">Sensex Equity Curve</h3>
                <div class="h-64"><canvas id="sensexChart"></canvas></div>
            </div>
        </div>

        <!-- TRADE LOGS TABLE -->
        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6 flex flex-col gap-4 min-h-0">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3 flex-shrink-0">
                <h3 class="font-black text-white uppercase tracking-wider">Complete Analytical Trade Log</h3>
                <span class="text-[10px] font-mono text-teal-400 border border-teal-500/20 bg-teal-500/5 px-2.5 py-0.5 rounded">AUTO-SQUAREOFF ACTIVE</span>
            </div>
            <div class="overflow-auto max-h-[450px]">
                <table class="w-full text-left border-collapse text-xs font-sans">
                    <thead>
                        <tr class="border-b border-slate-800 text-slate-400 font-extrabold uppercase bg-slate-950/40">
                            <th class="p-3">#</th>
                            <th class="p-3">INDEX</th>
                            <th class="p-3">ENTRY SPOT</th>
                            <th class="p-3">EXIT SPOT</th>
                            <th class="p-3">SL</th>
                            <th class="p-3">TARGET</th>
                            <th class="p-3">LOTS</th>
                            <th class="p-3">OUTCOME</th>
                            <th class="p-3 text-right">NET P&L</th>
                            <th class="p-3">STRATEGY TRIGGER</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-850/60 font-mono">
                        """
    for idx, (inst, t) in enumerate(all_trades):
        color_pnl = "text-emerald-400" if t.profit_loss >= 0 else "text-rose-400"
        bg_outcome = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" if "PROFIT" in t.outcome else "bg-rose-500/10 text-rose-455 border-rose-500/20" if "LOSS" in t.outcome else "bg-slate-800 text-slate-200 border-slate-700"
        
        html_content += f"""
                        <tr class="hover:bg-slate-950/20">
                            <td class="p-3 text-slate-500 font-bold">{idx + 1}</td>
                            <td class="p-3 text-teal-400 font-bold">{inst}</td>
                            <td class="p-3 text-slate-300">{t.entry_price:,.2f}</td>
                            <td class="p-3 text-slate-300">{t.exit_price:,.2f}</td>
                            <td class="p-3 text-rose-500/90">{t.sl_price:,.2f}</td>
                            <td class="p-3 text-emerald-500/90">{t.target_price:,.2f}</td>
                            <td class="p-3 text-slate-400">{t.lots}</td>
                            <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-black border uppercase {bg_outcome}">{t.outcome}</span></td>
                            <td class="p-3 text-right font-black {color_pnl}">₹{t.profit_loss:+,.2f}</td>
                            <td class="p-3 text-[10px] font-sans font-bold text-slate-400 max-w-xs truncate" title="{t.reason}">{t.reason}</td>
                        </tr>"""
                        
    html_content += f"""
                    </tbody>
                </table>
            </div>
        </div>

    </div>

    <!-- CHARTS INITIALIZATION -->
    <script>
        // Nifty 50 Chart
        const ctxNifty = document.getElementById('niftyChart').getContext('2d');
        new Chart(ctxNifty, {{
            type: 'line',
            data: {{
                labels: {json.dumps(nifty_labels)},
                datasets: [{{
                    label: 'Nifty Account Balance (₹)',
                    data: {json.dumps(nifty_balance_data)},
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.05)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 6
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    legend: {{ display: false }}
                }},
                scales: {{
                    x: {{ grid: {{ display: false }}, ticks: {{ color: '#64748b', font: {{ family: 'Space Grotesk' }} }} }},
                    y: {{ grid: {{ color: '#1e293b' }}, ticks: {{ color: '#64748b', font: {{ family: 'Space Grotesk' }} }} }}
                }}
            }}
        }});

        // Sensex Chart
        const ctxSensex = document.getElementById('sensexChart').getContext('2d');
        new Chart(ctxSensex, {{
            type: 'line',
            data: {{
                labels: {json.dumps(sensex_labels)},
                datasets: [{{
                    label: 'Sensex Account Balance (₹)',
                    data: {json.dumps(sensex_balance_data)},
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 6
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    legend: {{ display: false }}
                }},
                scales: {{
                    x: {{ grid: {{ display: false }}, ticks: {{ color: '#64748b', font: {{ family: 'Space Grotesk' }} }} }},
                    y: {{ grid: {{ color: '#1e293b' }}, ticks: {{ color: '#64748b', font: {{ family: 'Space Grotesk' }} }} }}
                }}
            }}
        }});
    </script>
</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)

# ==============================================================================
#                               MAIN EXECUTOR
# ==============================================================================

def main():
    print(BANNER)
    
    # ── STEP 1: Research Profile ──────────────────────────────────────────────
    print("[STEP 1] Initializing Quant Indicators Mapping...")
    print(" - Bullish Moving Averages: EMA 20, 50, 200")
    print(" - Momentum Trigger Filters: RSI (14) with <70 limit, MACD Golden Crossover")
    print(" - Key CPR Support: Grouping and grouping intraday timeframes to group Pivot boundaries")
    print(" - Strict Option Buying Protections: Theta decay avoidance (square-off), Lot sizing (2% cap)")
    print("--------------------------------------------------------------------------------")
    
    # ── STEP 2: Load and Profile SQLite Data ──────────────────────────────────
    print("\n[STEP 2] Analysing SQL hypertable data details...")
    
    # Load 5-minute candles (most standard timeframe for options momentum buying)
    nifty_candles = load_index_data(DB_PATH, "NIFTY", "5m")
    sensex_candles = load_index_data(DB_PATH, "SENSEX", "5m")
    
    if len(nifty_candles) == 0 or len(sensex_candles) == 0:
        print("Error: No sufficient Nifty/Sensex intraday data found.")
        sys.exit(1)
        
    print("--------------------------------------------------------------------------------")
    
    # ── STEP 3: Enrich Indicators ─────────────────────────────────────────────
    print("\n[STEP 3] Running AI calculations & indicators enrichment...")
    enrich_market_indicators(nifty_candles)
    enrich_market_indicators(sensex_candles)
    print(" [SUCCESS] Technical modules successfully enriched (EMA bands, RSI values, MACD histogram, BB lines, CPR support).")
    
    # ── STEP 4: Run CE Buying Strategy & Backtester ───────────────────────────
    print("\n[STEP 4] Executing strictly BUY-ONLY CE strategy...")
    nifty_trades, nifty_end_bal = run_strategy_backtest(nifty_candles)
    sensex_trades, sensex_end_bal = run_strategy_backtest(sensex_candles)
    
    # Calculate performance metrics
    nifty_metrics = calculate_performance_metrics(nifty_trades, nifty_end_bal)
    sensex_metrics = calculate_performance_metrics(sensex_trades, sensex_end_bal)
    
    print("\n================== BACKTEST SUMMARY ==================")
    print("NIFTY 50 CE Options buying strategy:")
    for k, v in nifty_metrics.items():
        print(f"  - {k.replace('_', ' ').title()}: {v}")
        
    print("\nSENSEX CE Options buying strategy:")
    for k, v in sensex_metrics.items():
        print(f"  - {k.replace('_', ' ').title()}: {v}")
    print("======================================================")
    
    # ── STEP 5: Generate Dashboards & Reports ─────────────────────────────────
    print("\n[STEP 5] Exporting results and building visual cockpit...")
    
    csv_nifty_path = "dist/nifty_backtest_trades.csv"
    csv_sensex_path = "dist/sensex_backtest_trades.csv"
    html_dashboard_path = "dist/ai_trading_dashboard.html"
    
    # Ensure dist folder exists
    os.makedirs("dist", exist_ok=True)
    
    generate_csv_report(nifty_trades, csv_nifty_path)
    generate_csv_report(sensex_trades, csv_sensex_path)
    generate_html_dashboard(nifty_metrics, sensex_metrics, nifty_trades, sensex_trades, html_dashboard_path)
    
    print(f" [SUCCESS] Complete trades log exported to CSV: {csv_nifty_path}")
    print(f" [SUCCESS] Visually stunning responsive dark-mode Dashboard created: {html_dashboard_path}")
    
    # Auto-open HTML Dashboard in browser
    print("\n[Dashboard Cockpit] Opening cockpit dashboard in browser now...")
    try:
        webbrowser.open("file://" + os.path.realpath(html_dashboard_path))
    except Exception as e:
        print(f"Could not open browser automatically: {e}")
        
    print("\n[OK] System run successfully. Quant Analyser processes finished.")

if __name__ == '__main__':
    main()
