import Database from 'better-sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────
const SQLITE_PATH = path.join(__dirname, 'server/storage/indicators.db');
const PG_URL = 'postgres://market_analyst:SecretMarketPassword2026@localhost:5432/market_intelligence';
const BATCH_SIZE = 500;

// ─── Connect ──────────────────────────────────────────────────────────────────
console.log('🔌 Connecting to SQLite:', SQLITE_PATH);
const sqlite = new Database(SQLITE_PATH, { readonly: true });

console.log('🔌 Connecting to PostgreSQL...');
const pool = new pg.Pool({ connectionString: PG_URL });

// ─── Check SQLite Tables ──────────────────────────────────────────────────────
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('\n📋 SQLite Tables found:', tables.map(t => t.name));

// ─── Migrate candles table ────────────────────────────────────────────────────
async function migrateCandles() {
  // Check columns
  const cols = sqlite.prepare("PRAGMA table_info(candles)").all();
  console.log('\n📊 Candles table columns:', cols.map(c => c.name));

  const total = sqlite.prepare("SELECT COUNT(*) as cnt FROM candles").get();
  console.log(`\n🚀 Starting migration of ${total.cnt} candle rows...`);

  // Fetch all candles
  const rows = sqlite.prepare("SELECT * FROM candles ORDER BY timestamp ASC").all();

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const row of batch) {
      try {
        // Convert timestamp (SQLite stores as seconds or ms)
        let ts = row.timestamp;
        if (typeof ts === 'number' && ts < 1e12) {
          ts = new Date(ts * 1000); // seconds → ms
        } else {
          ts = new Date(ts);
        }

        // Map SQLite column names to PostgreSQL schema
        const symbol = row.symbol || 'UNKNOWN';
        const resolution = row.resolution || row.interval || row.timeframe || '1m';
        const open = parseFloat(row.open) || 0;
        const high = parseFloat(row.high) || 0;
        const low = parseFloat(row.low) || 0;
        const close = parseFloat(row.close) || 0;
        const volume = parseInt(row.volume) || 0;
        const oi = row.oi ? parseInt(row.oi) : null;
        const vwap = row.vwap ? parseFloat(row.vwap) : null;

        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9})`);
        params.push(ts, symbol, resolution, open, high, low, close, volume, oi, vwap);
        paramIdx += 10;
      } catch (e) {
        skipped++;
      }
    }

    if (values.length > 0) {
      try {
        await pool.query(
          `INSERT INTO market_candles (timestamp, symbol, resolution, open, high, low, close, volume, oi, vwap)
           VALUES ${values.join(',')}
           ON CONFLICT DO NOTHING`,
          params
        );
        inserted += values.length;
      } catch (e) {
        errors += values.length;
        console.error(`❌ Batch error at row ${i}:`, e.message);
      }
    }

    // Progress
    const pct = Math.round(((i + batch.length) / rows.length) * 100);
    process.stdout.write(`\r⏳ Progress: ${pct}% (${inserted} inserted, ${skipped} skipped, ${errors} errors)`);
  }

  console.log(`\n\n✅ Migration Complete!`);
  console.log(`   ✅ Inserted : ${inserted}`);
  console.log(`   ⚠️  Skipped  : ${skipped}`);
  console.log(`   ❌ Errors   : ${errors}`);
}

// ─── Check what other tables exist and their structure ────────────────────────
async function checkOtherTables() {
  for (const t of tables) {
    if (t.name === 'candles') continue;
    try {
      const count = sqlite.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
      console.log(`   📁 ${t.name}: ${count.cnt} rows`);
    } catch(e) {
      console.log(`   📁 ${t.name}: (cannot count)`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    console.log('\n📦 Other tables in SQLite:');
    await checkOtherTables();

    if (tables.find(t => t.name === 'candles')) {
      await migrateCandles();
    } else {
      console.log('\n⚠️  No "candles" table found. Checking actual table names above...');
    }
  } catch (err) {
    console.error('❌ Fatal error:', err.message);
  } finally {
    sqlite.close();
    await pool.end();
    console.log('\n🔌 Connections closed.');
  }
}

main();
