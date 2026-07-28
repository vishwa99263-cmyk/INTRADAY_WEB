// reset_today_pnl.cjs - Removes today's bad trades from DB to reset circuit breaker
// Run: node reset_today_pnl.cjs

const Database = require('better-sqlite3');
const db = new Database('server/storage/indicators.db');

const todayIST = new Date(Date.now() + 5.5*3600*1000).toISOString().slice(0,10);
console.log('Resetting paper trades for date:', todayIST);

// Find today's trades
const todayTrades = db.prepare(`
  SELECT id, instrument, direction, entry_price, exit_price, pnl, status, timestamp
  FROM te_paper_trades
  WHERE datetime(timestamp/1000, 'unixepoch', '+5 hours', '+30 minutes') >= ?
  ORDER BY timestamp DESC
`).all(todayIST + ' 00:00:00');

console.log('\nFound', todayTrades.length, 'trades today:');
todayTrades.forEach(t => {
  const time = new Date(t.timestamp + 5.5*3600*1000).toISOString().slice(11,19);
  console.log(` [${time}] ${t.instrument} ${t.direction} Entry:${t.entry_price} Exit:${t.exit_price} PNL:${t.pnl} Status:${t.status}`);
});

// Delete today's trades entirely (clean reset)
const delResult = db.prepare(`
  DELETE FROM te_paper_trades
  WHERE datetime(timestamp/1000, 'unixepoch', '+5 hours', '+30 minutes') >= ?
`).run(todayIST + ' 00:00:00');

console.log('\n✅ Deleted', delResult.changes, 'trades from today.');

// Verify new all-time total
const total = db.prepare("SELECT sum(pnl) as t FROM te_paper_trades WHERE status='CLOSED'").get();
console.log('New all-time closed P&L:', total.t?.toFixed(2));

// Check governor state file and reset it
const fs = require('fs');
const govPath = 'server/storage/governor_state.json';
if (fs.existsSync(govPath)) {
  const gov = JSON.parse(fs.readFileSync(govPath, 'utf8'));
  gov.circuitBreaker = false;
  gov.circuitBreakerReason = '';
  gov.consecutiveLossHalt = false;
  gov.cooldownUntil = 0;
  gov.killSwitch = false;
  gov.killSwitchReason = '';
  fs.writeFileSync(govPath, JSON.stringify(gov, null, 2));
  console.log('\n✅ Governor state reset — circuit breaker cleared.');
}

console.log('\n🎯 Done! Restart the server to apply changes.');
db.close();
