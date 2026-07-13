export interface SpeedAnalysisResult {
  velocity: number;                              // Price points moved per second
  marketState: "FAST_MARKET" | "SLOW_MARKET";
  momentumState: "HIGH_MOMENTUM" | "LOW_MOMENTUM";
  accelerating: boolean;                         // Velocity increasing over last 3 readings
  priceActionGrade: "STRONG" | "MODERATE" | "WEAK"; // Quality of price movement
}

interface PriceTick {
  price: number;
  timestamp: number;
}

export class MarketSpeedTracker {
  private history: PriceTick[] = [];
  private readonly windowMs = 10_000; // 10 seconds sliding window
  private lastVelocities: number[] = [];        // Track last 3 velocity readings

  public addTick(price: number): SpeedAnalysisResult {
    const now = Date.now();
    this.history.push({ price, timestamp: now });

    // Prune ticks older than the sliding window
    const cutoff = now - this.windowMs;
    this.history = this.history.filter(tick => tick.timestamp >= cutoff);

    if (this.history.length < 2) {
      return {
        velocity: 0,
        marketState: "SLOW_MARKET",
        momentumState: "LOW_MOMENTUM",
        accelerating: false,
        priceActionGrade: "WEAK",
      };
    }

    const firstTick = this.history[0];
    const lastTick = this.history[this.history.length - 1];

    const timeDiffSec = (lastTick.timestamp - firstTick.timestamp) / 1000;
    const priceDiff = Math.abs(lastTick.price - firstTick.price);

    const velocity = timeDiffSec > 0 ? parseFloat((priceDiff / timeDiffSec).toFixed(3)) : 0;

    // Track last 3 velocities for acceleration detection
    this.lastVelocities.push(velocity);
    if (this.lastVelocities.length > 3) this.lastVelocities.shift();

    // Acceleration: velocity consistently increasing over last 3 readings
    let accelerating = false;
    if (this.lastVelocities.length === 3) {
      accelerating = this.lastVelocities[1] > this.lastVelocities[0] &&
                     this.lastVelocities[2] > this.lastVelocities[1];
    }

    // Thresholds: > 1.2 pts/sec is FAST for indices
    const isFast = velocity > 1.2;

    // Price action grade based on velocity + consistency
    let priceActionGrade: SpeedAnalysisResult["priceActionGrade"] = "WEAK";
    if (velocity > 2.0 || (velocity > 1.2 && accelerating)) {
      priceActionGrade = "STRONG";
    } else if (velocity > 0.6) {
      priceActionGrade = "MODERATE";
    }

    return {
      velocity,
      marketState: isFast ? "FAST_MARKET" : "SLOW_MARKET",
      momentumState: isFast ? "HIGH_MOMENTUM" : "LOW_MOMENTUM",
      accelerating,
      priceActionGrade,
    };
  }

  public getLatestResult(): SpeedAnalysisResult {
    if (this.history.length < 2) {
      return { velocity: 0, marketState: "SLOW_MARKET", momentumState: "LOW_MOMENTUM", accelerating: false, priceActionGrade: "WEAK" };
    }
    const firstTick = this.history[0];
    const lastTick = this.history[this.history.length - 1];
    const timeDiffSec = (lastTick.timestamp - firstTick.timestamp) / 1000;
    const priceDiff = Math.abs(lastTick.price - firstTick.price);
    const velocity = timeDiffSec > 0 ? parseFloat((priceDiff / timeDiffSec).toFixed(3)) : 0;
    const isFast = velocity > 1.2;
    const accelerating = this.lastVelocities.length === 3 &&
      this.lastVelocities[1] > this.lastVelocities[0] &&
      this.lastVelocities[2] > this.lastVelocities[1];
    let priceActionGrade: SpeedAnalysisResult["priceActionGrade"] = "WEAK";
    if (velocity > 2.0 || (velocity > 1.2 && accelerating)) priceActionGrade = "STRONG";
    else if (velocity > 0.6) priceActionGrade = "MODERATE";
    return {
      velocity,
      marketState: isFast ? "FAST_MARKET" : "SLOW_MARKET",
      momentumState: isFast ? "HIGH_MOMENTUM" : "LOW_MOMENTUM",
      accelerating,
      priceActionGrade,
    };
  }
}
