/** GET /api/schedule?device=pillbox: frozen ESP32 contract. */
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { dbTime } from '../../src/core/timeutil';
import { MAX_DOSES } from '../../src/schemas/device';
import { api, makeMedicine, makePatient, makeSchedule, makeUser, pairDevice, setup } from '../helpers';

const DOSE_KEYS = ['id', 'slot', 'name', 'dose', 'time', 'instructions', 'expiry', 'qty'];

const getSchedule = (device = 'pillbox') => api().get('/api/schedule').query({ device });
const doses = async (device?: string) => (await getSchedule(device)).body.doses as Record<string, any>[];

describe('GET /api/schedule', () => {
  it('has the exact shape and types', async () => {
    await setup();
    const r = await getSchedule();
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(['doses']);
    expect(r.body.doses).toHaveLength(4);
    for (const d of r.body.doses) {
      expect(Object.keys(d).sort()).toEqual([...DOSE_KEYS].sort());
      expect(Number.isInteger(d.id) && Number.isInteger(d.slot) && Number.isInteger(d.qty)).toBe(true);
      expect(d.slot).toBeGreaterThanOrEqual(1);
      expect(d.slot).toBeLessThanOrEqual(5);
      expect(d.time).toMatch(/^\d\d:\d\d$/);
      for (const k of ['name', 'dose', 'time', 'instructions', 'expiry']) expect(typeof d[k]).toBe('string');
    }
  });

  it('matches the documented example entry exactly', async () => {
    const s = await setup();
    const entry = (await doses()).find((d) => d.id === s.scheds.losartan.id);
    expect(entry).toEqual({
      id: s.scheds.losartan.id, slot: 1, name: 'Losartan 50mg', dose: '1 tablet', time: '08:00',
      instructions: 'After breakfast', expiry: '2027-06-30', qty: 24,
    });
  });

  it('has one entry per dose time, sorted by time then slot', async () => {
    const s = await setup();
    const list = await doses();
    expect(list.map((d) => [d.time, d.slot])).toEqual([['08:00', 1], ['08:00', 2], ['13:00', 3], ['20:00', 2]]);
    expect(new Set(list.filter((d) => d.slot === 2).map((d) => d.id))).toEqual(new Set([s.scheds.metAm.id, s.scheds.metPm.id]));
  });

  it('keeps ids stable across calls and when a time is edited', async () => {
    const s = await setup();
    const first = (await doses()).map((d) => d.id);
    expect((await doses()).map((d) => d.id)).toEqual(first);
    await prisma.schedule.update({ where: { id: s.scheds.amlodipine.id }, data: { time: dbTime('06:30') } });
    const after = await doses();
    const moved = after.find((d) => d.slot === 3)!;
    expect(moved.id).toBe(s.scheds.amlodipine.id);
    expect(moved.time).toBe('06:30');
    expect(new Set(after.map((d) => d.id))).toEqual(new Set(first));
  });

  it('leaves out other weekdays, paused schedules and unslotted medicines', async () => {
    const s = await setup();
    // Frozen today is Friday (weekday 4).
    await makeSchedule(await makeMedicine(s.patient, { name: 'Weekly', slot: 4 }), '09:00', [0]);
    await makeSchedule(await makeMedicine(s.patient, { name: 'Spare', slot: null }), '09:00');
    await makeSchedule(await makeMedicine(s.patient, { name: 'Paused', slot: 5 }), '09:00', [0, 1, 2, 3, 4, 5, 6], false);
    const list = await doses();
    expect(list).toHaveLength(4);
    expect(new Set(list.map((d) => d.slot))).toEqual(new Set([1, 2, 3]));
  });

  it('leaves out inactive medicines', async () => {
    const s = await setup();
    await prisma.medicine.update({ where: { id: s.meds.amlodipine.id }, data: { active: false } });
    expect((await doses()).map((d) => d.slot)).not.toContain(3);
  });

  it('sends at most 20 doses', async () => {
    const s = await setup();
    for (let m = 0; m < 25; m++) await makeSchedule(s.meds.losartan, `10:${String(m).padStart(2, '0')}`);
    const list = await doses();
    expect(list).toHaveLength(MAX_DOSES);
    expect(list).toEqual([...list].sort((a, b) => a.time.localeCompare(b.time) || a.slot - b.slot));
  });

  it('cuts text to the firmware buffers at a word boundary', async () => {
    const s = await setup();
    await prisma.medicine.update({
      where: { id: s.meds.losartan.id },
      data: {
        name: 'Hydrochlorothiazide Extended Release', strength: '12.5mg',
        instructions: 'Take with a full glass of water after breakfast, do not crush', doseAmount: 2, doseUnit: 'capsule',
      },
    });
    const d = (await doses()).find((x) => x.slot === 1)!;
    expect(d.name).toBe('Hydrochlorothiazide');
    expect(d.name.length).toBeLessThanOrEqual(23);
    expect(d.instructions).toBe('Take with a full glass of water after');
    expect(d.instructions.length).toBeLessThanOrEqual(39);
    expect(d.dose).toBe('2 capsules');
    expect(d.expiry).toHaveLength(10);
  });

  it('keeps text at the limit and turns punctuation into ASCII', async () => {
    const s = await setup();
    await prisma.medicine.update({ where: { id: s.meds.losartan.id }, data: { name: 'A'.repeat(23), strength: null, instructions: 'Pagkatapos kumain — señora’s dose' } });
    let d = (await doses()).find((x) => x.slot === 1)!;
    expect(d.name).toBe('A'.repeat(23));
    expect(d.instructions).toBe("Pagkatapos kumain - senora's dose");
    expect(/^[\x20-\x7e]*$/.test(d.instructions)).toBe(true);
    await prisma.medicine.update({ where: { id: s.meds.losartan.id }, data: { name: 'A'.repeat(24) } });
    d = (await doses()).find((x) => x.slot === 1)!;
    expect(d.name).toBe('A'.repeat(23));
  });

  it('sends an empty string when there is no expiry date', async () => {
    const s = await setup();
    await prisma.medicine.update({ where: { id: s.meds.losartan.id }, data: { expiryDate: null } });
    expect((await doses()).find((x) => x.slot === 1)!.expiry).toBe('');
  });

  it('sends the current quantity, never negative', async () => {
    const s = await setup();
    await prisma.medicine.update({ where: { id: s.meds.losartan.id }, data: { qty: 0 } });
    expect((await doses()).find((x) => x.slot === 1)!.qty).toBe(0);
  });

  it('answers an empty list for a box with no doses', async () => {
    const user = await makeUser();
    await pairDevice(await makePatient(user), 'pillbox2');
    const r = await getSchedule('pillbox2');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ doses: [] });
  });

  it('is a heartbeat: last_seen is updated', async () => {
    const s = await setup();
    expect(s.device.lastSeen).toBeNull();
    await getSchedule();
    expect((await prisma.device.findUnique({ where: { deviceId: 'pillbox' } }))!.lastSeen).not.toBeNull();
  });

  it('answers 403 device_not_registered for an unknown box', async () => {
    await setup();
    const r = await getSchedule('stranger');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('device_not_registered');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('also knows the camera id', async () => {
    await setup();
    expect((await getSchedule('pillbox-cam')).status).toBe(200);
  });

  it('answers 422 without ?device', async () => {
    await setup();
    expect((await api().get('/api/schedule')).status).toBe(422);
  });

  it('only returns the doses of the people on this box', async () => {
    const s = await setup();
    const other = await makePatient(await makeUser());
    await pairDevice(other, 'pillbox9');
    await makeSchedule(await makeMedicine(other, { name: 'Other' }), '07:00');
    expect(new Set((await doses()).map((d) => d.id))).toEqual(new Set(Object.values(s.scheds).map((x) => x.id)));
  });

  it('is rate limited to 30 per minute per box', async () => {
    await setup();
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await getSchedule()).status);
    expect(codes[0]).toBe(200);
    expect(codes.at(-1)).toBe(429);
  });
});

