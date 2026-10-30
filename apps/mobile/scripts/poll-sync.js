// Dev-only. Docker Desktop on Windows delivers no file events for bind mounts, so Metro cannot
// watch the source there. The source is mounted read-only at SYNC_FROM (/host); this script copies
// it into the container's own /app (where inotify works) and keeps it in sync by polling mtimes.
//   node scripts/poll-sync.js --once   initial copy, then exit (used before tests)
//   node scripts/poll-sync.js          initial copy, then poll every second
const fs = require('fs');
const path = require('path');

const FROM = process.env.SYNC_FROM || '/host';
const TO = process.cwd();
const ROOTS = ['src', 'assets', '__tests__', 'scripts', 'app.config.ts', 'tsconfig.json', 'jest.setup.ts', 'package.json', 'package-lock.json'];
const IGNORE = /(^|\/)(node_modules|\.expo|\.git)(\/|$)/;
let known = new Map();

function walk(rel, out) {
  if (IGNORE.test(rel)) return;
  let st;
  try {
    st = fs.statSync(path.join(FROM, rel));
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(path.join(FROM, rel))) walk(path.join(rel, name), out);
  } else {
    out.set(rel, st.mtimeMs);
  }
}

function sync(log) {
  const now = new Map();
  for (const r of ROOTS) walk(r, now);
  for (const [rel, mtime] of now) {
    if (known.get(rel) === mtime) continue;
    const dst = path.join(TO, rel);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(FROM, rel), dst);
      if (log) console.log(`[sync] ${rel}`);
    } catch {
      now.delete(rel); // retry next tick
    }
  }
  for (const rel of known.keys()) {
    if (!now.has(rel)) {
      fs.rmSync(path.join(TO, rel), { force: true });
      if (log) console.log(`[sync] removed ${rel}`);
    }
  }
  known = now;
}

if (!fs.existsSync(FROM)) {
  console.log(`[sync] ${FROM} not mounted; nothing to do`);
  process.exit(0);
}
sync(false);
console.log(`[sync] copied ${known.size} files from ${FROM}`);
if (!process.argv.includes('--once')) setInterval(() => sync(true), 1000);
