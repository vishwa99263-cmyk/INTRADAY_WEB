import { db } from "../storage/db.js";

export interface AIFeatureRecord {
  symbol: string;
  pcr: number;
  oiDelta: number;
  volumeDelta: number;
  heavyweightScore: number;
  momentumScore: number;
  breadthScore: number;
  vwapDist: number;
  atmIv: number;
  maxPainDist: number;
}

export class AIFeatureStore {
  private static buffer: any[][] = [];
  private static isInitialized = false;

  /** Initialize hypertable structures in database */
  public static async initTable(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const ddl = `
        CREATE TABLE IF NOT EXISTS ai_feature_store (
          timestamp TIMESTAMPTZ NOT NULL,
          symbol TEXT NOT NULL,
          pcr REAL,
          oi_delta REAL,
          volume_delta REAL,
          heavyweight_score REAL,
          momentum_score REAL,
          breadth_score REAL,
          vwap_dist REAL,
          atm_iv REAL,
          max_pain_dist REAL
        );
      `;
      await db.query(ddl);
      
      // Attempt conversion to hypertable (TimescaleDB)
      try {
        await db.query("SELECT create_hypertable('ai_feature_store', 'timestamp', if_not_exists => TRUE);");
      } catch (_) {
        // Standard relational fallback if running in standalone Postgres
      }

      this.isInitialized = true;
      console.log("[AIFeatureStore] 🧠 AI Feature hypertable initialized.");

      // Start buffer flush timer loop (runs every 5 seconds)
      setInterval(() => this.flushBuffer(), 5000);

    } catch (err: any) {
      console.error("[AIFeatureStore] ❌ DDL Initialization failed:", err.message);
    }
  }

  /** Buffer and enqueue real-time feature row */
  public static recordFeatures(feat: AIFeatureRecord): void {
    const ts = new Date().toISOString();
    this.buffer.push([
      ts,
      feat.symbol,
      feat.pcr,
      feat.oiDelta,
      feat.volumeDelta,
      feat.heavyweightScore,
      feat.momentumScore,
      feat.breadthScore,
      feat.vwapDist,
      feat.atmIv,
      feat.maxPainDist
    ]);
  }

  /** Write buffered records using bulk insert */
  private static async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await db.bulkInsert("ai_feature_store", [
        "timestamp", "symbol", "pcr", "oi_delta", "volume_delta", 
        "heavyweight_score", "momentum_score", "breadth_score", 
        "vwap_dist", "atm_iv", "max_pain_dist"
      ], batch);
    } catch (err: any) {
      console.error("[AIFeatureStore] ❌ Failed to flush features batch:", err.message);
    }
  }
}
