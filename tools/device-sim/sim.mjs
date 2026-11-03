#!/usr/bin/env node
/**
 * Acts like the two ESP32 boards (main `pillbox` + `pillbox-cam`) against the backend.
 * Needs Node 22+ and nothing else:  node sim.mjs --base http://localhost:5055 day
 *
 * Commands:
 *   poll                         GET /api/schedule once and print it
 *   watch                        poll every 60 s like the firmware (Ctrl+C to stop)
 *   event <type> [doseId]        POST one event (time = now, PH)
 *   scan <file.jpg>              POST a JPEG like the ESP32-CAM
 *   offline-buffer               send 8 buffered events, then resend them all (must be idempotent)
 *   day                          full-day walk-through with checks (exit code 1 on failure)
 *
 * The `day` scan needs GEMINI_API_KEY on the server; without it the scan check fails with "found:false".
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const base = opt('base', 'http://localhost:5055').replace(/\/$/, '');
const device = opt('device', 'pillbox');
const cam = opt('cam', 'pillbox-cam');
const email = opt('email', 'demo@example.com');
const password = opt('password', 'demo1234');
const sampleOpt = opt('sample', null);
const expectOpt = opt('expect', null);
const [cmd, ...rest] = args;

// ---- time: the firmware clock is fixed to UTC+8 ----------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const wall = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const phNow = () => new Date(Date.now() + 8 * 3600_000);
const phDate = (d = phNow()) => wall(d).slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// ---- http ---------------------------------------------------------------------------------------------
let token = null;
async function call(method, p, { body, raw, headers = {}, timeout = 15000 } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token && p.startsWith('/api/v1')) h.Authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(base + p, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, secs: (performance.now() - t0) / 1000 };
}

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${!ok && detail ? ` - ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok) failures++;
  return ok;
}

// ---- firmware actions -----------------------------------------------------------------------------
async function poll() {
  const r = await call('GET', `/api/schedule?device=${encodeURIComponent(device)}`);
  if (r.status !== 200) {
    console.error(`schedule failed: ${r.status} ${JSON.stringify(r.body)}`);
    process.exit(1);
  }
  return { doses: r.body.doses, secs: r.secs };
}

const sendEvent = (type, doseId = 0, slot, at = phNow()) =>
  call('POST', '/api/events', { body: { device, type, doseId, time: wall(at), ...(slot !== undefined ? { slot } : {}) } });

const sendScan = async (file) => call('POST', '/api/scan', { raw: await readFile(file), headers: { 'Content-Type': 'image/jpeg', 'X-Device': cam }, timeout: 15000 });

// ---- scenarios --------------------------------------------------------------------------------------
async function login() {
  const r = await call('POST', '/api/v1/auth/login', { body: { email, password } });
  if (r.status === 200) {
    token = r.body.accessToken;
    return true;
  }
  console.log(`  (app API login unavailable: ${r.status}; alert checks skipped)`);
  return false;
}

async function pickDay(doses) {
  const today = phDate();
  let pid = null;
  if (token) {
    const pats = await call('GET', '/api/v1/patients');
    pid = pats.status === 200 && pats.body.length ? pats.body[0].id : null;
  }
  if (pid === null) return { day: today, pending: doses.filter((d) => d.expiry >= today) };
  const live = {};
  const t = await call('GET', `/api/v1/patients/${pid}/today`);
  if (t.status === 200) for (const d of t.body.doses) live[d.scheduleId] = d.status;
  for (let offset = 0; offset < 15; offset++) {
    const day = addDays(today, offset);
    const h = await call('GET', `/api/v1/patients/${pid}/history?from=${day}&to=${day}`);
    const done = new Set(h.status === 200 ? h.body.records.map((r) => r.scheduleId) : []);
    const pending = doses.filter(
      (d) => !done.has(d.id) && d.expiry && d.expiry >= day && (offset > 0 || ['upcoming', 'due'].includes(live[d.id] ?? 'upcoming')),
    );
    if (pending.length >= 2) {
      if (offset) console.log(`  (today's doses are already done; simulating ${day})`);
      return { day, pending };
    }
  }
  return { day: today, pending: [] };
}

async function alertIds() {
  const r = await call('GET', '/api/v1/alerts?limit=50');
  return new Set(r.status === 200 ? r.body.items.map((a) => a.id) : []);
}

async function waitAlert(type, before, seconds = 5) {
  const start = performance.now();
  while ((performance.now() - start) / 1000 < seconds) {
    const r = await call('GET', '/api/v1/alerts?limit=20');
    const hit = r.status === 200 && r.body.items.find((a) => a.type === type && !before.has(a.id));
    if (hit) return { alert: hit, secs: (performance.now() - start) / 1000 };
    await sleep(300);
  }
  return { alert: null, secs: seconds };
}

async function day() {
  console.log(`== Full day against ${base} (device=${device}) ==`);
  const { doses, secs } = await poll();
  check(secs < 2, `schedule answered in ${secs.toFixed(2)}s with ${doses.length} doses`);
  check(doses.length > 0, 'schedule has doses (run `make seed`)');
  if (!doses.length) return;
  const loggedIn = await login();
  const { day: today, pending } = await pickDay(doses);
  if (pending.length < 2) {
    console.log('  Not enough untaken, unexpired doses. Run `make reset-seed` and try again.');
    failures++;
    return;
  }
  const [a, b] = pending;
  const at = (dose, minutes = 0) => {
    const [hh, mm] = dose.time.split(':').map(Number);
    return new Date(Date.parse(`${today}T00:00:00Z`) + (hh * 60 + mm + minutes) * 60_000 + (Date.now() % 60_000));
  };

  console.log(`-> ${today} dose ${a.id} (${a.name}, slot ${a.slot}, ${a.time}) becomes due, lid opened after 3 min`);
  let r = await sendEvent('due', a.id, a.slot, at(a));
  check(r.status === 200, 'due accepted', r.body);
  r = await sendEvent('taken', a.id, a.slot, at(a, 3));
  check(r.status === 200, 'taken accepted', r.body);
  const after = (await poll()).doses;
  const newQty = after.find((d) => d.id === a.id)?.qty;
  const amount = parseInt(a.dose, 10);
  check(newQty === Math.max(0, a.qty - amount), `qty went down ${a.qty} -> ${newQty}`);

  console.log(`-> Dose ${b.id} (${b.name}, ${b.time}) becomes due, nobody opens the lid for 30 min`);
  const before = loggedIn ? await alertIds() : new Set();
  r = await sendEvent('due', b.id, b.slot, at(b));
  check(r.status === 200, 'due accepted');
  const missedAt = at(b, 30);
  r = await sendEvent('missed', b.id, b.slot, missedAt);
  check(r.status === 200, 'missed accepted');
  if (loggedIn) {
    const { alert, secs: s } = await waitAlert('missed', before);
    check(alert !== null, `caregiver got a missed alert in ${s.toFixed(1)}s`, 'no alert within 5 s');
  }
  console.log('-> Network blip: the firmware resends the missed event');
  r = await sendEvent('missed', b.id, b.slot, missedAt);
  check(r.status === 200 && r.body?.duplicate === true, 'resend is idempotent', r.body);

  const sample = sampleOpt ?? path.join(HERE, 'samples', 'losartan.jpg');
  console.log(`-> CAMERA button: scanning ${path.basename(sample)}`);
  const sc = await sendScan(sample);
  check(sc.status === 200 && sc.secs < 10, `scan answered in ${sc.secs.toFixed(2)}s`, [sc.status, sc.body]);
  const expected = (expectOpt ?? 'Losartan').toLowerCase();
  check(sc.body?.found === true && String(sc.body.name).toLowerCase().includes(expected), `scan identified ${sc.body?.name}`, sc.body);
  r = await sendEvent(sc.body?.found ? 'scan_ok' : 'scan_unknown');
  check(r.status === 200, 'scan result event accepted');
}

async function offlineBuffer() {
  const base0 = phNow();
  base0.setUTCSeconds(0, 0);
  const batch = Array.from({ length: 8 }, (_, i) => ({ type: i % 2 === 0 ? 'opened' : 'closed', slot: (i % 5) + 1, when: new Date(base0.getTime() - (8 - i) * 60_000) }));
  for (const e of batch) {
    const r = await sendEvent(e.type, 0, e.slot, e.when);
    check(r.status === 200 && !r.body?.duplicate, `buffered ${e.type} slot ${e.slot} stored`);
  }
  for (const e of batch) {
    const r = await sendEvent(e.type, 0, e.slot, e.when);
    check(r.status === 200 && r.body?.duplicate === true, `resend ${e.type} slot ${e.slot} is a duplicate`);
  }
}

switch (cmd) {
  case 'poll': {
    const { doses, secs } = await poll();
    console.log(JSON.stringify({ doses }, null, 2));
    console.log(`(${Math.round(secs * 1000)} ms)`);
    break;
  }
  case 'watch':
    for (;;) {
      const { doses } = await poll();
      console.log(`${wall(phNow()).slice(11, 19)} ${doses.length} doses: ${doses.map((d) => `${d.time} s${d.slot}`).join(', ')}`);
      await sleep(60_000);
    }
  case 'event': {
    const r = await sendEvent(rest[0], Number(rest[1] ?? 0));
    console.log(r.status, JSON.stringify(r.body));
    break;
  }
  case 'scan': {
    const r = await sendScan(rest[0]);
    console.log(r.status, JSON.stringify(r.body), `(${r.secs.toFixed(2)}s)`);
    break;
  }
  case 'offline-buffer':
    await offlineBuffer();
    break;
  case 'day':
    await day();
    break;
  default:
    console.error('usage: node sim.mjs [--base URL] [--device pillbox] [--cam pillbox-cam] <poll|watch|event <type> [doseId]|scan <file>|offline-buffer|day>');
    process.exit(2);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
if (cmd === 'day' || cmd === 'offline-buffer') console.log('\nAll checks passed');
