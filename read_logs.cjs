const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logFile = path.join(__dirname, '2026-07-24.log');
if (!fs.existsSync(logFile)) {
  console.log("Log file not found:", logFile);
  process.exit(1);
}

const fileStream = fs.createReadStream(logFile);
const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity
});

let count = 0;
const nonDebugLines = [];

rl.on('line', (line) => {
  count++;
  if (!line.includes('"level":"debug"')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      try {
        const parsed = JSON.parse(trimmed);
        nonDebugLines.push(`${count} [${parsed.level.toUpperCase()}] ${parsed.datetime} - ${parsed.message} - ${JSON.stringify(parsed.data || parsed.err || {})}`);
      } catch (e) {
        nonDebugLines.push(`${count} [RAW] ${trimmed}`);
      }
    }
  }
});

rl.on('close', () => {
  fs.writeFileSync(path.join(__dirname, 'positional_logs_new.txt'), nonDebugLines.join('\n'));
  console.log(`Done. Scanned ${count} lines. Found ${nonDebugLines.length} non-debug lines.`);
  process.exit(0);
});
