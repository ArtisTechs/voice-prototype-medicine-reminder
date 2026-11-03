import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, jpeg, makePatient, makeUser, pairDevice } from '../helpers';

let h: Record<string, string>;
let pid: number;

beforeEach(async () => {
  const user = await makeUser();
  const patient = await makePatient(user);
  await pairDevice(patient);
  h = auth(user);
  pid = patient.id;
});

const base = (over: Record<string, unknown> = {}) => ({
  name: 'Losartan', strength: '50mg', form: 'tablet', doseAmount: 1, doseUnit: 'tablet', instructions: 'After breakfast', slot: 1,
  barcode: '4800123456786', expiryDate: '2027-06-30', qty: 24, lowStockThreshold: 5, refillLeadDays: 3, ...over,
});
const create = (over: Record<string, unknown> = {}) => api().post(`/api/v1/patients/${pid}/medicines`).set(h).send(base(over));
const url = (id: number) => `/api/v1/patients/${pid}/medicines/${id}`;
const device = async () => (await api().get('/api/schedule').query({ device: 'pillbox' })).body.doses as any[];

describe('medicines', () => {
  it('create, edit, list, delete', async () => {
    const r = await create();
    expect(r.status).toBe(201);
    const med = r.body;
    expect(med).toMatchObject({ label: 'Losartan 50mg', lowStock: false, expired: false });
    const upd = await api().patch(url(med.id)).set(h).send({ qty: 3, instructions: '  ' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ qty: 3, lowStock: true, instructions: null });
    expect((await api().get(`/api/v1/patients/${pid}/medicines`).set(h)).body).toHaveLength(1);
    expect((await api().delete(url(med.id)).set(h)).status).toBe(204);
    expect((await api().get(url(med.id)).set(h)).status).toBe(404);
    expect((await api().get(`/api/v1/patients/${pid}/medicines`).set(h)).body).toEqual([]);
  });

  it('a minimal create gets defaults', async () => {
    const r = await api().post(`/api/v1/patients/${pid}/medicines`).set(h).send({ name: 'Vitamin C' });
    expect(r.status).toBe(201);
    expect([r.body.doseAmount, r.body.qty, r.body.lowStockThreshold, r.body.refillLeadDays, r.body.slot]).toEqual([1, 0, 5, 3, null]);
  });

  it('a slot can hold one medicine; deleting frees it', async () => {
    const first = (await create()).body;
    const r = await create({ name: 'Other' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('slot_taken');
    await api().delete(url(first.id)).set(h);
    expect((await create({ name: 'Other' })).status).toBe(201);
  });

  it('validates every field', async () => {
    const r = await create({ slot: 6, doseAmount: 0, qty: -1, barcode: '<script>', expiryDate: '31/12/2027' });
    expect(r.status).toBe(422);
    const fields = r.body.error.details.map((d: any) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['slot', 'doseAmount', 'qty', 'barcode', 'expiryDate']));
  });

  it('flags an expired medicine', async () => {
    expect((await create({ expiryDate: '2026-09-30' })).body.expired).toBe(true);
  });

  it('dose times: CRUD and the device schedule follow', async () => {
    const med = (await create()).body;
    const surl = `${url(med.id)}/schedules`;
    const s1 = (await api().post(surl).set(h).send({ time: '08:00' })).body;
    const s2 = (await api().post(surl).set(h).send({ time: '20:00', daysOfWeek: [4, 4, 0] })).body;
    expect(s1).toMatchObject({ time: '08:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    expect(s2.daysOfWeek).toEqual([0, 4]);
    expect((await api().post(surl).set(h).send({ time: '08:00' })).status).toBe(409);
    expect((await device()).map((d) => [d.id, d.time])).toEqual([[s1.id, '08:00'], [s2.id, '20:00']]);
    // Edit the time: same id, new time.
    const upd = await api().patch(`${surl}/${s1.id}`).set(h).send({ time: '07:30' });
    expect(upd.body).toMatchObject({ id: s1.id, time: '07:30' });
    // Not today (frozen Friday = 4): leaves the device schedule but stays stored.
    await api().patch(`${surl}/${s2.id}`).set(h).send({ daysOfWeek: [0] });
    expect((await device()).map((d) => d.id)).toEqual([s1.id]);
    expect((await api().delete(`${surl}/${s1.id}`).set(h)).status).toBe(204);
    expect(await device()).toEqual([]);
    const detail = (await api().get(url(med.id)).set(h)).body;
    expect(detail.schedules.map((s: any) => s.id)).toEqual([s2.id]);
  });

  it('validates dose times', async () => {
    const med = (await create()).body;
    const surl = `${url(med.id)}/schedules`;
    expect((await api().post(surl).set(h).send({ time: '25:00' })).status).toBe(422);
    expect((await api().post(surl).set(h).send({ time: '08:00', daysOfWeek: [7] })).status).toBe(422);
    expect((await api().post(surl).set(h).send({ time: '08:00', daysOfWeek: [] })).status).toBe(422);
  });

  it('days left and the refill rule', async () => {
    const med = (await create({ qty: 7, lowStockThreshold: 2, refillLeadDays: 3 })).body;
    for (const t of ['08:00', '20:00']) await api().post(`${url(med.id)}/schedules`).set(h).send({ time: t });
    let m = (await api().get(url(med.id)).set(h)).body;
    expect(m).toMatchObject({ daysLeft: 3.5, lowStock: false });
    m = (await api().patch(url(med.id)).set(h).send({ qty: 6 })).body;
    expect(m).toMatchObject({ daysLeft: 3, lowStock: true });
  });

  it('reference photos: upload, fetch (authenticated), list, count, delete', async () => {
    const med = (await create()).body;
    const purl = `${url(med.id)}/photos`;
    const r = await api().post(purl).set(h).field('angle', 'front').attach('file', await jpeg(), { filename: 'front.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(201);
    const photo = r.body;
    expect(photo.angle).toBe('front');
    expect(photo.url.endsWith(`/photos/${photo.id}/image`)).toBe(true);
    const img = await api().get(photo.url).set(h);
    expect(img.status).toBe(200);
    expect(img.body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect((await api().get(photo.url)).status).toBe(401);
    expect((await api().get(purl).set(h)).body.map((p: any) => p.id)).toEqual([photo.id]);
    expect((await api().get(url(med.id)).set(h)).body.photoCount).toBe(1);
    expect((await api().post(purl).set(h).attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' })).status).toBe(415);
    const badAngle = await api().post(purl).set(h).field('angle', 'top').attach('file', await jpeg(), { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(badAngle.status).toBe(400);
    expect((await api().delete(`${purl}/${photo.id}`).set(h)).status).toBe(204);
    expect((await api().get(purl).set(h)).body).toEqual([]);
  });
});
