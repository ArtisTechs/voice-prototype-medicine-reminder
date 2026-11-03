/** Scan review and correction for the app, plus the scan pipeline's own rules. */
import { describe, expect, it } from 'vitest';
import { settings } from '../../src/core/config';
import { prisma } from '../../src/core/prisma';
import { identify } from '../../src/vision/pipeline';
import { api, auth, jpeg, makeUser, nothing, sees, setup, visionClient } from '../helpers';

const scan = async (data?: Buffer) =>
  api().post('/api/scan').set('Content-Type', 'image/jpeg').set('X-Device', 'pillbox-cam').send(data ?? (await jpeg()));

describe('scans in the app', () => {
  it('lists scans, serves the photo, and learns from a correction', async () => {
    const s = await setup();
    const h = auth(s.user);
    const pid = s.patient.id;
    await scan();
    const page = (await api().get(`/api/v1/patients/${pid}/scans`).set(h)).body;
    expect(page.total).toBe(1);
    const item = page.items[0];
    expect(item).toMatchObject({ found: false, medicineName: null, method: 'none' });
    const img = await api().get(item.imageUrl).set(h);
    expect(img.status).toBe(200);
    expect(img.body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const los = s.meds.losartan;
    const r = await api().post(`/api/v1/patients/${pid}/scans/${item.id}/correct`).set(h).send({ medicineId: los.id });
    expect(r.status).toBe(200);
    expect(r.body.correctedMedicineId).toBe(los.id);
    expect(r.body.correctedAt).toBeTruthy();
    expect(await prisma.referenceImage.count({ where: { medicineId: los.id, angle: 'correction' } })).toBe(1);
    const none = await api().post(`/api/v1/patients/${pid}/scans/${item.id}/correct`).set(h).send({ medicineId: null });
    expect(none.body.correctedNone).toBe(true);
  });

  it('is private to the patient\'s caregivers', async () => {
    const s = await setup();
    const stranger = await makeUser();
    await scan();
    const sid = (await prisma.scan.findFirst())!.id;
    const h = auth(stranger);
    expect((await api().get(`/api/v1/patients/${s.patient.id}/scans`).set(h)).status).toBe(404);
    expect((await api().get(`/api/v1/patients/${s.patient.id}/scans/${sid}/image`).set(h)).status).toBe(404);
  });

  it('shows the printed expiry the model read, as information only', async () => {
    const s = await setup();
    (await visionClient()).respond = () => sees(s.meds.losartan.id, 0.9, { readExpiry: '2028-01-31' });
    await scan();
    const item = (await api().get(`/api/v1/patients/${s.patient.id}/scans`).set(auth(s.user))).body.items[0];
    expect(item.ocrExpiry).toBe('2028-01-31');
    expect(item.method).toBe('llm');
    expect((await prisma.medicine.findUnique({ where: { id: s.meds.losartan.id } }))!.expiryDate!.toISOString().slice(0, 10)).toBe('2027-06-30');
  });
});

describe('pipeline rules', () => {
  const candidates = [{ id: 7, name: 'Losartan', strength: '50mg', barcode: null }];

  it('accepts a match only at or above SCAN_MIN_CONFIDENCE', async () => {
    const fake = await visionClient();
    fake.respond = () => sees(7, 0.7);
    expect((await identify(await jpeg(), candidates)).medicineId).toBe(7);
    fake.respond = () => sees(7, 0.69);
    const low = await identify(await jpeg(), candidates);
    expect(low).toMatchObject({ medicineId: null, reason: 'low_confidence' });
  });

  it('returns no match and a reason when there is nothing registered', async () => {
    const fake = await visionClient();
    expect(await identify(await jpeg(), [])).toMatchObject({ medicineId: null, reason: 'no_candidates' });
    expect(fake.calls).toBe(0);
  });

  it('gives up at the budget even if the client ignores the abort signal', async () => {
    (await visionClient()).respond = () => new Promise(() => undefined);
    settings().GEMINI_TIMEOUT_MS = 60_000; // the abort never fires first
    try {
      const t0 = performance.now();
      const m = await identify(await jpeg(), candidates, { budgetSeconds: 1 });
      expect(performance.now() - t0).toBeLessThan(2500);
      expect(m).toMatchObject({ medicineId: null, reason: 'timeout' });
    } finally {
      settings().GEMINI_TIMEOUT_MS = 8000;
    }
  });

  it('fuzzy-matches the name when the model gives no id (method "ocr")', async () => {
    (await visionClient()).respond = () => ({ ...nothing(), readName: 'Losartan', readStrength: '50 mg' });
    expect(await identify(await jpeg(), candidates)).toMatchObject({ medicineId: 7, method: 'ocr' });
  });

  it('passes at most one reference photo per medicine when SCAN_USE_REFERENCES is on', async () => {
    const s = await setup();
    const fake = await visionClient();
    settings().SCAN_USE_REFERENCES = true;
    try {
      for (const med of [s.meds.losartan, s.meds.metformin]) {
        for (const angle of ['front', 'back']) {
          await api().post(`/api/v1/patients/${s.patient.id}/medicines/${med.id}/photos`).set(auth(s.user)).field('angle', angle)
            .attach('file', await jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' });
        }
      }
      await scan();
      expect(fake.lastReferences.map((r) => r.medicineId).sort()).toEqual([s.meds.losartan.id, s.meds.metformin.id].sort());
    } finally {
      settings().SCAN_USE_REFERENCES = false;
    }
  });
});
