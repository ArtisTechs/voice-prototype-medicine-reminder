/** POST /api/scan: frozen ESP32 contract (shape, limits, flags, errors, < 10 s, image saved). */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { settings } from '../../src/core/config';
import { prisma } from '../../src/core/prisma';
import { api, failsWith, jpeg, makeMedicine, makePatient, makeUser, nothing, sees, setup, visionClient } from '../helpers';

const FOUND_KEYS = ['found', 'name', 'dose', 'instructions', 'expiry', 'slot', 'qty', 'low', 'expired'];

const scan = (data: Buffer, device = 'pillbox-cam', type = 'image/jpeg') =>
  api().post('/api/scan').set('Content-Type', type).set('X-Device', device).send(data);

describe('POST /api/scan', () => {
  it('answers with the exact shape and values, from the database, within 10 s', async () => {
    const s = await setup();
    (await visionClient()).respond = () => sees(s.meds.losartan.id, 0.95, { readName: 'WRONG NAME 999mg', readExpiry: '2030-01-01' });
    const t0 = performance.now();
    const r = await scan(await jpeg());
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual([...FOUND_KEYS].sort());
    // Nothing the model read leaks into the answer.
    expect(r.body).toEqual({
      found: true, name: 'Losartan 50mg', dose: '1 tablet', instructions: 'After breakfast', expiry: '2027-06-30',
      slot: 1, qty: 24, low: false, expired: false,
    });
  });

  it('answers exactly {"found":false} when nothing matches', async () => {
    await setup();
    const r = await scan(await jpeg());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ found: false });
  });

  it('sets low when qty is at or under the threshold', async () => {
    const s = await setup();
    (await visionClient()).respond = () => sees(s.meds.metformin.id);
    const body = (await scan(await jpeg())).body;
    expect(body).toMatchObject({ found: true, low: true, qty: 4, slot: 2 });
  });

  it('sets expired when the stored expiry is before today', async () => {
    const s = await setup();
    (await visionClient()).respond = () => sees(s.meds.amlodipine.id);
    const body = (await scan(await jpeg())).body;
    expect(body).toMatchObject({ expired: true, expiry: '2026-09-30' });
  });

  it('answers slot 0 when the medicine has no slot', async () => {
    const s = await setup();
    await prisma.medicine.update({ where: { id: s.meds.losartan.id }, data: { slot: null } });
    (await visionClient()).respond = () => sees(s.meds.losartan.id);
    expect((await scan(await jpeg())).body).toMatchObject({ found: true, slot: 0 });
  });

  it('shortens text to the camera limits (31 / 19 / 63)', async () => {
    const s = await setup();
    await prisma.medicine.update({
      where: { id: s.meds.losartan.id },
      data: {
        name: 'Losartan Potassium Film-Coated Tablets',
        instructions: 'Take one tablet every morning after breakfast with a full glass of water please',
        doseUnit: 'film-coated tablet', doseAmount: 2,
      },
    });
    (await visionClient()).respond = () => sees(s.meds.losartan.id);
    const body = (await scan(await jpeg())).body;
    expect(body.name.length).toBeLessThanOrEqual(31);
    expect(/^[\x20-\x7e]*$/.test(body.name)).toBe(true);
    expect(body.dose.length).toBeLessThanOrEqual(19);
    expect(body.instructions.length).toBeLessThanOrEqual(63);
    expect(body.name).toBe('Losartan Potassium Film-Coated');
  });

  it('saves the image with its result', async () => {
    const s = await setup();
    (await visionClient()).respond = () => sees(s.meds.losartan.id, 0.9, { readExpiry: '2027-06-30' });
    await scan(await jpeg());
    const row = (await prisma.scan.findFirst())!;
    expect(row.found).toBe(true);
    expect(row.method).toBe('llm');
    expect(row.score).toBeCloseTo(0.9);
    expect(row.medicineId).toBe(s.meds.losartan.id);
    expect(row.readExpiry).toBe('2027-06-30');
    expect((row.result as any).name).toBe('Losartan 50mg');
    await expect(fs.access(path.join(settings().SCAN_DIR, row.imagePath))).resolves.toBeUndefined();
  });

  it('raises an unknown-scan alert when nothing matches', async () => {
    await setup();
    await scan(await jpeg());
    expect(await prisma.alert.count({ where: { type: 'scan_unknown' } })).toBe(1);
  });

  it('refuses a non-JPEG with 415', async () => {
    await setup();
    expect((await scan(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]), 'pillbox-cam', 'image/png')).status).toBe(415);
    expect((await scan(Buffer.from('not a jpeg'))).status).toBe(415);
  });

  it('refuses an image over the size limit with 413', async () => {
    await setup();
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(settings().SCAN_MAX_BYTES + 10)]);
    expect((await scan(big)).status).toBe(413);
  });

  it('answers 403 for an unknown camera or a missing header', async () => {
    await setup();
    expect((await scan(await jpeg(), 'stranger-cam')).status).toBe(403);
    const r = await api().post('/api/scan').set('Content-Type', 'image/jpeg').send(await jpeg());
    expect(r.status).toBe(403);
  });

  it("never matches another box's medicine", async () => {
    await setup();
    const other = await makePatient(await makeUser());
    const secret = await makeMedicine(other, { name: 'Secret', barcode: '4801111111113', slot: 1 });
    const fake = await visionClient();
    fake.respond = () => sees(secret.id); // the model names a medicine that is not on this box
    expect((await scan(await jpeg())).body).toEqual({ found: false });
    expect(fake.lastCandidates.map((c) => c.name)).not.toContain('Secret');
  });

  // ---- failures: never a 5xx, always inside the budget ------------------------------------------

  it.each(['timeout', 'rate_limited', 'error', 'no_key'] as const)('answers found:false (200) when Gemini fails: %s', async (reason) => {
    await setup();
    (await visionClient()).respond = failsWith(reason);
    const r = await scan(await jpeg());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ found: false });
    expect(await prisma.scan.count()).toBe(1);
  });

  it('answers found:false when the request to Gemini hangs, inside the budget', async () => {
    await setup();
    const budget = settings().SCAN_BUDGET_SECONDS;
    (await visionClient()).respond = () => new Promise(() => undefined); // never answers
    settings().SCAN_BUDGET_SECONDS = 1.2;
    settings().GEMINI_TIMEOUT_MS = 800;
    try {
      const t0 = performance.now();
      const r = await scan(await jpeg());
      expect(performance.now() - t0).toBeLessThan(3000);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ found: false });
    } finally {
      settings().SCAN_BUDGET_SECONDS = budget;
      settings().GEMINI_TIMEOUT_MS = 8000;
    }
  });

  it('answers found:false for a bad model reply (low confidence, unknown id)', async () => {
    const s = await setup();
    const fake = await visionClient();
    fake.respond = () => sees(s.meds.losartan.id, 0.4);
    expect((await scan(await jpeg())).body).toEqual({ found: false });
    fake.respond = () => sees(424242, 0.99);
    expect((await scan(await jpeg())).body).toEqual({ found: false });
  });

  it('falls back to the printed name when the model names no id', async () => {
    const s = await setup();
    (await visionClient()).respond = () => ({ ...nothing(), readName: 'Metformn', readStrength: '500 mg', confidence: 0.2 });
    const body = (await scan(await jpeg())).body;
    expect(body).toMatchObject({ found: true, name: 'Metformin 500mg', slot: 2 });
    expect((await prisma.scan.findFirst())!.method).toBe('ocr');
    expect(s.meds.metformin.id).toBe((await prisma.scan.findFirst())!.medicineId);
  });

  it('answers a second press while a scan is running with found:false, without a second Gemini call', async () => {
    const s = await setup();
    const fake = await visionClient();
    let release: () => void = () => undefined;
    fake.respond = () => new Promise((resolve) => (release = () => resolve(sees(s.meds.losartan.id))));
    const first = scan(await jpeg()).then((r) => r);
    for (let i = 0; i < 60 && fake.calls === 0; i++) await new Promise((r) => setTimeout(r, 25));
    const second = await scan(await jpeg());
    expect(second.body).toEqual({ found: false });
    expect(fake.calls).toBe(1);
    release();
    expect((await first).body).toMatchObject({ found: true });
  });

  it('stays under the local Gemini quota instead of collecting 429s', async () => {
    await setup();
    const fake = await visionClient();
    settings().GEMINI_MAX_PER_MINUTE = 2;
    try {
      // Keep each press under the per-box rate limit by changing the camera each time.
      for (let i = 0; i < 3; i++) await scan(await jpeg(i));
      expect(fake.calls).toBe(2);
    } finally {
      settings().GEMINI_MAX_PER_MINUTE = 10;
    }
  });

  it('only sends registered medicines to Gemini, without patient data', async () => {
    await setup();
    const fake = await visionClient();
    await scan(await jpeg());
    expect(fake.lastCandidates.map((c) => c.name).sort()).toEqual(['Amlodipine', 'Losartan', 'Metformin']);
    expect(Object.keys(fake.lastCandidates[0]).sort()).toEqual(['barcode', 'id', 'name', 'strength']);
  });
});

