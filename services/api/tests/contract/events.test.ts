/** POST /api/events: frozen ESP32 contract. Every type, idempotency, side effects. */
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { newSubscriber, redis } from '../../src/core/redis';
import { dbTime } from '../../src/core/timeutil';
import { EVENT_TYPES } from '../../src/schemas/device';
import { PUSH_QUEUE } from '../../src/services/alertService';
import { api, makeMedicine, makePatient, makeSchedule, makeUser, pairDevice, setup } from '../helpers';

const ev = (type: string, doseId: number | null = 0, slot?: number, time = '2026-10-30T08:00:05', device = 'pillbox') => ({
  device, type, time, ...(doseId !== null ? { doseId } : {}), ...(slot !== undefined ? { slot } : {}),
});
const post = (body: object) => api().post('/api/events').send(body);
const intake = (scheduleId: number) => prisma.intakeRecord.findFirst({ where: { scheduleId } });
const qty = async (id: number) => (await prisma.medicine.findUnique({ where: { id } }))!.qty;
const alerts = (type?: string) => prisma.alert.findMany({ where: type ? { type } : {} });

describe('POST /api/events', () => {
  it.each(EVENT_TYPES)('accepts %s with a 2xx', async (type) => {
    const s = await setup();
    const sid = ['due', 'taken', 'missed', 'expired'].includes(type) ? s.scheds.losartan.id : 0;
    const r = await post(ev(type, sid, 1));
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(300);
    expect(r.body).toEqual({ ok: true });
    expect(await prisma.deviceEvent.count({ where: { type } })).toBe(1);
  });

  it('due starts the delay clock', async () => {
    const s = await setup();
    await post(ev('due', s.scheds.losartan.id, 1, '2026-10-30T08:00:00'));
    const rec = (await intake(s.scheds.losartan.id))!;
    expect(rec.status).toBe('due');
    expect(rec.dueAt!.toISOString()).toBe('2026-10-30T00:00:00.000Z');
  });

  it('taken lowers the quantity and records the delay', async () => {
    const s = await setup();
    const sid = s.scheds.losartan.id;
    await post(ev('due', sid, 1, '2026-10-30T08:00:00'));
    await post(ev('taken', sid, 1, '2026-10-30T08:04:10'));
    const rec = (await intake(sid))!;
    expect(rec.status).toBe('taken');
    expect(rec.delayMinutes).toBe(4);
    expect(await qty(s.meds.losartan.id)).toBe(23);
  });

  it('taken uses the dose amount', async () => {
    const s = await setup();
    await prisma.medicine.update({ where: { id: s.meds.losartan.id }, data: { doseAmount: 2 } });
    await post(ev('taken', s.scheds.losartan.id, 1));
    expect(await qty(s.meds.losartan.id)).toBe(22);
  });

  it('a duplicate taken is idempotent', async () => {
    const s = await setup();
    const body = ev('taken', s.scheds.losartan.id, 1, '2026-10-30T08:04:10');
    const r1 = await post(body);
    const r2 = await post(body);
    expect(r1.body).toEqual({ ok: true });
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ ok: true, duplicate: true });
    expect(await qty(s.meds.losartan.id)).toBe(23);
    expect(await prisma.deviceEvent.count()).toBe(1);
  });

  it('a second taken with another time does not decrement twice', async () => {
    const s = await setup();
    const sid = s.scheds.losartan.id;
    await post(ev('taken', sid, 1, '2026-10-30T08:04:10'));
    await post(ev('taken', sid, 1, '2026-10-30T08:05:00'));
    expect(await qty(s.meds.losartan.id)).toBe(23);
  });

  it('quantity never goes below zero', async () => {
    const s = await setup();
    await prisma.medicine.update({ where: { id: s.meds.losartan.id }, data: { qty: 0 } });
    expect((await post(ev('taken', s.scheds.losartan.id, 1))).status).toBe(200);
    expect(await qty(s.meds.losartan.id)).toBe(0);
  });

  it('missed is recorded and alerts the caregivers (push is queued)', async () => {
    const s = await setup();
    const sid = s.scheds.losartan.id;
    await post(ev('due', sid, 1, '2026-10-30T08:00:00'));
    await post(ev('missed', sid, 1, '2026-10-30T08:30:00'));
    expect((await intake(sid))!.status).toBe('missed');
    const missed = await alerts('missed');
    expect(missed).toHaveLength(1);
    expect(missed[0].userId).toBe(s.user.id);
    expect(missed[0].body).toContain('missed');
    expect(missed[0].body).toContain('8:00 AM');
    expect(Number(await redis().rpop(PUSH_QUEUE))).toBe(missed[0].id);
  });

  it('a duplicate missed raises one alert', async () => {
    const s = await setup();
    const body = ev('missed', s.scheds.losartan.id, 1, '2026-10-30T08:30:00');
    await post(body);
    await post(body);
    expect(await alerts('missed')).toHaveLength(1);
  });

  it('taken after missed upgrades the record', async () => {
    const s = await setup();
    const sid = s.scheds.losartan.id;
    await post(ev('missed', sid, 1, '2026-10-30T08:30:00'));
    await post(ev('taken', sid, 1, '2026-10-30T08:31:00'));
    const rec = (await intake(sid))!;
    expect(rec.status).toBe('taken');
    expect(rec.delayMinutes).toBe(31);
  });

  it('a miss reported after midnight belongs to the previous day', async () => {
    const s = await setup();
    await prisma.schedule.update({ where: { id: s.scheds.metPm.id }, data: { time: dbTime('23:50') } });
    await post(ev('missed', s.scheds.metPm.id, 2, '2026-10-31T00:20:00'));
    expect((await intake(s.scheds.metPm.id))!.doseDate.toISOString().slice(0, 10)).toBe('2026-10-30');
  });

  it('expired is recorded and alerts', async () => {
    const s = await setup();
    await post(ev('expired', s.scheds.amlodipine.id, 3, '2026-10-30T13:00:00'));
    expect((await intake(s.scheds.amlodipine.id))!.status).toBe('expired');
    expect(await alerts('expired_dose')).toHaveLength(1);
  });

  it('opened / closed update the slot state', async () => {
    await setup();
    const slotState = async () => (await prisma.device.findUnique({ where: { deviceId: 'pillbox' } }))!.slotState as any;
    await post(ev('opened', 0, 4, '2026-10-30T10:00:00'));
    expect((await slotState())['4'].lidOpen).toBe(true);
    await post(ev('closed', 0, 4, '2026-10-30T10:00:30'));
    expect((await slotState())['4'].lidOpen).toBe(false);
  });

  it.each([0, null])('doseId %s is stored as 0', async (doseId) => {
    await setup();
    expect((await post(ev('scan_ok', doseId))).status).toBe(200);
    expect((await prisma.deviceEvent.findFirst({ where: { type: 'scan_ok' } }))!.doseId).toBe(0);
  });

  it('a missing doseId and doseId 0 are the same event', async () => {
    await setup();
    const body = ev('scan_unknown', null);
    await post(body);
    expect((await post({ ...body, doseId: 0 })).body.duplicate).toBe(true);
  });

  it('an unknown dose id is still accepted', async () => {
    await setup();
    expect((await post(ev('taken', 999999, 1))).status).toBe(200);
    expect(await prisma.intakeRecord.count()).toBe(0);
  });

  it("ignores another box's dose", async () => {
    await setup();
    const p = await makePatient(await makeUser());
    await pairDevice(p, 'pillbox7');
    const m = await makeMedicine(p, { qty: 10 });
    const sched = await makeSchedule(m);
    await post(ev('taken', sched.id, 1));
    expect(await qty(m.id)).toBe(10);
  });

  it('stores an event type it does not know', async () => {
    await setup();
    expect((await post(ev('battery_low', 0))).status).toBe(200);
  });

  it('rejects a time that is not a time with 422', async () => {
    await setup();
    const r = await post({ device: 'pillbox', type: 'taken', doseId: 1, time: 'yesterday' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('validation_error');
  });

  it('keeps the wall clock when a client adds an offset', async () => {
    const s = await setup();
    await post(ev('due', s.scheds.losartan.id, 1, '2026-10-30T08:00:00+08:00'));
    expect((await prisma.deviceEvent.findFirst({ where: { type: 'due' } }))!.localTime.toISOString()).toBe('2026-10-30T08:00:00.000Z');
  });

  it('answers 403 device_not_registered for an unknown box', async () => {
    await setup();
    const r = await post(ev('taken', 1, 1, undefined, 'intruder'));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('device_not_registered');
  });

  it('is a heartbeat', async () => {
    await setup();
    await post(ev('closed', 0, 1));
    expect((await prisma.device.findUnique({ where: { deviceId: 'pillbox' } }))!.lastSeen).not.toBeNull();
  });

  it('accepts a resend of the 8 buffered events without side effects', async () => {
    const s = await setup();
    const batch = [...Array(7).keys()].map((i) => ev('opened', 0, 1, `2026-10-30T09:0${i}:00`));
    batch.push(ev('taken', s.scheds.losartan.id, 1));
    for (const b of batch) await post(b);
    for (const b of batch) expect((await post(b)).body.duplicate).toBe(true);
    expect(await qty(s.meds.losartan.id)).toBe(23);
  });

  it('is rate limited to 120 per minute per box', async () => {
    await setup();
    const codes: number[] = [];
    for (let i = 0; i < 121; i++) codes.push((await post(ev('opened', 0, 1, `2026-10-30T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`))).status);
    expect(codes[0]).toBe(200);
    expect(codes.at(-1)).toBe(429);
  });

  it('publishes a realtime hint when a dose is taken', async () => {
    const s = await setup();
    const sub = newSubscriber();
    const seen: string[] = [];
    sub.on('message', (_c, data) => seen.push(JSON.parse(data).type));
    await sub.subscribe(`patient:${s.patient.id}`);
    await post(ev('taken', s.scheds.losartan.id, 1));
    for (let i = 0; i < 30 && !seen.includes('intake.updated'); i++) await new Promise((r) => setTimeout(r, 50));
    sub.disconnect();
    expect(seen).toContain('intake.updated');
  });
});
