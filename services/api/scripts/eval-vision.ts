/**
 * Scan accuracy + timing over tests/vision_samples with the REAL Gemini model (make eval-vision).
 *
 * Layout: tests/vision_samples/<Medicine name>/*.jpg (expected = that demo medicine),
 *         tests/vision_samples/none/*.jpg (expected = not found).
 * The demo medicines are registered in memory (no database). Needs GEMINI_API_KEY; the free tier is rate
 * limited, so photos are sent one at a time with a pause (EVAL_PAUSE_MS, default 6000).
 * Exit code 1 if accuracy < --min-accuracy (0.8), any wrong medicine, or any answer over the 10 s budget.
 *
 *   npm run eval-vision -- [--samples tests/vision_samples] [--min-accuracy 0.8]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { settings } from '../src/core/config';
import { closeRedis } from '../src/core/redis';
import { DEMO_MEDICINES } from '../prisma/seed';
import { identify } from '../src/vision/pipeline';
import type { Candidate } from '../src/vision/match';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

async function main() {
  const s = settings();
  if (!s.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set (put it in .env). Nothing to evaluate.');
    process.exit(2);
  }
  const samples = path.resolve(arg('samples', path.join(__dirname, '..', 'tests', 'vision_samples')));
  const minAccuracy = Number(arg('min-accuracy', '0.8'));
  const pause = Number(process.env.EVAL_PAUSE_MS ?? 6000);
  const meds: Candidate[] = DEMO_MEDICINES.map((m, i) => ({ id: i + 1, name: m.name, strength: m.strength, barcode: m.barcode }));
  const nameOf = new Map(meds.map((m) => [m.id, m.name]));

  const rows: { sample: string; expected: string | null; got: string | null; method: string; score: number | null; ms: number; reason?: string }[] = [];
  const folders = (await fs.readdir(samples, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const folder of folders) {
    const expected = folder === 'none' ? null : folder;
    const files = (await fs.readdir(path.join(samples, folder))).filter((f) => /\.jpe?g$/i.test(f)).sort();
    for (const file of files) {
      const match = await identify(await fs.readFile(path.join(samples, folder, file)), meds);
      rows.push({
        sample: `${folder}/${file}`, expected, got: match.medicineId ? nameOf.get(match.medicineId) ?? null : null,
        method: match.method, score: match.score, ms: match.timings.total ?? 0, reason: match.reason,
      });
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, pause));
    }
  }

  console.log(`\n\n${'sample'.padEnd(36)} ${'expected'.padEnd(11)} ${'got'.padEnd(11)} ${'method'.padEnd(6)} ${'conf'.padStart(5)} ${'ms'.padStart(6)}`);
  for (const r of rows) {
    const mark = r.expected === r.got ? 'ok' : r.got ? 'WRONG' : `miss${r.reason ? ` (${r.reason})` : ''}`;
    console.log(`${r.sample.padEnd(36)} ${(r.expected ?? '-').padEnd(11)} ${(r.got ?? '-').padEnd(11)} ${r.method.padEnd(6)} ${String(r.score ?? '').padStart(5)} ${String(r.ms).padStart(6)}  ${mark}`);
  }
  const n = rows.length;
  const correct = rows.filter((r) => r.expected === r.got).length;
  const wrong = rows.filter((r) => r.got && r.expected !== r.got).length;
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(n - 1, Math.round(p * (n - 1)))] ?? 0;
  const accuracy = n ? correct / n : 0;
  console.log(`\nsamples=${n} accuracy=${(accuracy * 100).toFixed(1)}% wrong_medicine=${wrong} not_found=${n - correct - wrong}`);
  console.log(`ms p50=${pct(0.5)} p95=${pct(0.95)} max=${times.at(-1) ?? 0} budget=${s.SCAN_BUDGET_SECONDS * 1000} model=${s.GEMINI_MODEL}`);
  const failed = accuracy < minAccuracy || wrong > 0 || (times.at(-1) ?? 0) > s.SCAN_BUDGET_SECONDS * 1000;
  console.log('RESULT:', failed ? 'FAIL' : 'PASS');
  await closeRedis();
  process.exit(failed ? 1 : 0);
}

void main();
