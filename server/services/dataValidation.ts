export interface RawTickRecord {
  timestamp: string;
  symbol: string;
  ltp: number;
  volume: number;
  bid: number;
  ask: number;
  oi: number;
  vwap?: number;
}

export class DataValidationEngine {
  private static lastValidTicks: Map<string, RawTickRecord> = new Map();

  /**
   * Cleanses, filters, validates and repairs a tick data block.
   */
  public static validateAndRepairTick(tick: RawTickRecord): RawTickRecord | null {
    if (!tick || !tick.symbol) return null;

    const key = tick.symbol;
    const lastValid = this.lastValidTicks.get(key);

    // 1. Guard against negative or extreme prices/metrics
    if (tick.ltp <= 0 || isNaN(tick.ltp) || !isFinite(tick.ltp)) {
      if (lastValid) {
        tick.ltp = lastValid.ltp;
      } else {
        return null; // Discard since no historical baseline exists yet
      }
    }

    // 2. Validate Bid-Ask Spreads
    if (tick.bid <= 0 || tick.ask <= 0 || tick.bid > tick.ask) {
      if (lastValid) {
        tick.bid = lastValid.bid;
        tick.ask = lastValid.ask;
      } else {
        tick.bid = tick.ltp * 0.9995;
        tick.ask = tick.ltp * 1.0005;
      }
    }

    // 3. Ensure non-negative and non-decreasing cumulative volume
    if (tick.volume < 0 || isNaN(tick.volume)) {
      tick.volume = lastValid ? lastValid.volume : 0;
    } else if (lastValid && tick.volume < lastValid.volume) {
      // Net ticks can reset at day boundaries, otherwise carry over
      const isNewSession = new Date(tick.timestamp).getDate() !== new Date(lastValid.timestamp).getDate();
      if (!isNewSession) {
        tick.volume = lastValid.volume;
      }
    }

    // 4. Smooth anomalous Open Interest spikes (>= 100% shift in <= 1 sec)
    if (tick.oi < 0 || isNaN(tick.oi)) {
      tick.oi = lastValid ? lastValid.oi : 0;
    } else if (lastValid && lastValid.oi > 0) {
      const oiDiffPct = Math.abs(tick.oi - lastValid.oi) / lastValid.oi;
      const timeDiffMs = new Date(tick.timestamp).getTime() - new Date(lastValid.timestamp).getTime();
      
      if (oiDiffPct >= 1.0 && timeDiffMs <= 1000) {
        console.warn(`[DataValidation] ⚠️ Anomalous OI spike detected for ${tick.symbol} (${(oiDiffPct * 100).toFixed(1)}%). Auto-smoothing.`);
        // Interpolate or carry forward last valid OI
        tick.oi = lastValid.oi;
      }
    }

    // Store as last valid baseline
    this.lastValidTicks.set(key, { ...tick });
    return tick;
  }

  /**
   * Filters out duplicate timestamp records for the same symbol constituent.
   */
  public static filterDuplicateTicks(ticks: RawTickRecord[]): RawTickRecord[] {
    const seen = new Set<string>();
    return ticks.filter(t => {
      const key = `${t.symbol}_${new Date(t.timestamp).getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
