const Database = require('better-sqlite3');
const db = new Database('server/storage/indicators.db');

const ist = (ts) => new Date(ts).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'});

// Today's IST date
const todayIST = new Date(Date.now() + 5.5*3600*1000).toISOString().slice(0,10);

const rows = db.prepare("SELECT id, instrument, direction, strike, entry_price, exit_price, stop_loss, target, status, pnl, qty, lot_size, notes, timestamp FROM te_paper_trades ORDER BY timestamp DESC LIMIT 200").all();

const todayTrades = rows.filter(r => {
  const d = new Date(r.timestamp + 5.5*3600*1000).toISOString().slice(0,10);
  return d === todayIST;
});

console.log('=== TODAY (' + todayIST + ') TRADES ===');
console.log('Count:', todayTrades.length);

let totalPnl = 0;
todayTrades.forEach(t => {
  totalPnl += (t.pnl || 0);
  const slPct = t.entry_price > 0 ? ((t.entry_price - t.stop_loss) / t.entry_price * 100).toFixed(1) : '?';
  console.log(
    ist(t.timestamp), '|', t.instrument, t.direction,
    '| Strike:', t.strike,
    '| Entry:', t.entry_price, '| Exit:', t.exit_price,
    '| SL:', t.stop_loss, '('+slPct+'%)', '| Target:', t.target,
    '| Status:', t.status, '| PNL:', t.pnl,
    '| Qty:', t.qty, 'x', t.lot_size
  );
});
console.log('\nTODAY TOTAL PNL:', totalPnl.toFixed(2));

// Yesterday + all time
const allClosed = db.prepare("SELECT sum(pnl) as total, count(*) as cnt, count(CASE WHEN pnl > 0 THEN 1 END) as wins, count(CASE WHEN pnl < 0 THEN 1 END) as losses FROM te_paper_trades WHERE status = 'CLOSED'").get();
const openTrades = db.prepare("SELECT * FROM te_paper_trades WHERE status = 'OPEN'").all();
const bigLosses = db.prepare("SELECT * FROM te_paper_trades WHERE pnl < -500 ORDER BY pnl ASC LIMIT 20").all();

console.log('\n=== ALL TIME ===');
console.log('Total closed:', allClosed.cnt, '| Wins:', allClosed.wins, '| Losses:', allClosed.losses, '| Total PNL:', (allClosed.total||0).toFixed(2));
console.log('Open positions:', openTrades.length);
openTrades.forEach(t => {
  console.log('  OPEN:', t.instrument, t.direction, 'Entry:', t.entry_price, 'SL:', t.stop_loss, 'Target:', t.target);
});

console.log('\n=== BIG LOSSES (< -500) ===');
bigLosses.forEach(t => {
  const date = new Date(t.timestamp + 5.5*3600*1000).toISOString().slice(0,10);
  console.log(date, t.instrument, t.direction, 'Entry:', t.entry_price, 'Exit:', t.exit_price, 'SL:', t.stop_loss, 'PNL:', t.pnl, 'Qty:', t.qty*t.lot_size);
});

db.close();
