import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { dbDate, dbTime, doseInstant } from '../../src/core/timeutil';
import * as hub from '../../src/realtime/hub';
import { publish, publishUser } from '../../src/realtime/publisher';
import { api, auth, makeMedicine, makePatient, makeSchedule, makeUser, pairDevice, ph } from '../helpers';

let ctx: Awaited<ReturnType<typeof build>>;

async function build() {
  const user = await makeUser();
  const patient = await makePatient(user);
  await pairDevice(patient);
  const los = await makeMedicine(patient);
  const amlo = await makeMedicine(patient, { name: 'Amlodipine', strength: '5mg', slot: 3, expiryDate: dbDate('2026-09-30') });
  return {
    user, patient, los,
    s8: await makeSchedule(los, '08:00'),
    s13: await makeSchedule(amlo, '13:00'),
    s20: await makeSchedule(los, '20:00'),
  };
}
beforeEach(async () => {
  ctx = await build();
});

const event = (type: string, sid: number, time: string) => api().post('/api/events').send({ device: 'pillbox', type, doseId: sid, time });
// Fresh token every time: some tests move the clock past the 15 minute access-token lifetime.
const today = async () => (await api().get(`/api/v1/patients/${ctx.patient.id}/today`).set(auth(ctx.user))).body;

describe('today', () => {
  it('shows upcoming doses, and an expired medicine as expired', async () => {
    const body = await today();
    expect(body.date).toBe('2026-10-30');
    expect(Object.fromEntries(body.doses.map((d: any) => [d.scheduleId, d.status]))).toEqual({
      [ctx.s8.id]: 'upcoming', [ctx.s13.id]: 'expired', [ctx.s20.id]: 'upcoming',
    });
    expect(body.summary.total).toBe(3);
  });

  it('follows the day: due, taken, late, missed', async () => {
    const status = async (id: number) => (await today()).doses.find((d: any) => d.scheduleId === id);
    vi.setSystemTime(ph(8, 5));
    expect((await status(ctx.s8.id)).status).toBe('due');
    await event('taken', ctx.s8.id, '2026-10-30T08:04:00');
    const d8 = await status(ctx.s8.id);
    expect(d8).toMatchObject({ status: 'taken', delayMinutes: 4 });
    expect(d8.takenAt).toBeTruthy();
    vi.setSystemTime(ph(20, 40));
    expect((await status(ctx.s20.id)).status).toBe('missed'); // no event yet, but past the 35 min window
    await event('taken', ctx.s20.id, '2026-10-30T20:25:00');
    expect(await status(ctx.s20.id)).toMatchObject({ status: 'late', delayMinutes: 25 });
  });
});

describe('history', () => {
  it('computes adherence per overall, day and medicine', async () => {
    const rows: [string, string, number | null][] = [['2026-10-27', 'taken', 0], ['2026-10-28', 'taken', 40], ['2026-10-29', 'missed', null]];
    for (const [day, status, delay] of rows) {
      await prisma.intakeRecord.create({
        data: {
          patientId: ctx.patient.id, medicineId: ctx.los.id, scheduleId: ctx.s8.id, doseDate: dbDate(day), scheduledTime: dbTime('08:00'),
          status, delayMinutes: delay, dueAt: doseInstant(day, '08:00'),
        },
      });
    }
    const r = await api().get(`/api/v1/patients/${ctx.patient.id}/history`).query({ from: '2026-10-24', to: '2026-10-30' }).set(auth(ctx.user));
    expect(r.status).toBe(200);
    expect(r.body.overall).toEqual({ taken: 1, late: 1, missed: 1, expired: 0, adherence: 66.7 });
    expect(r.body.days).toHaveLength(7);
    expect(r.body.days[0].adherence).toBeNull(); // no data shows as "-", not 0%
    expect(r.body.medicines[0].medicineName).toBe('Losartan 50mg');
    expect(r.body.records.map((x: any) => x.status)).toEqual(['missed', 'late', 'taken']);
  });

  it('validates the date range and defaults to the last 7 days', async () => {
    const url = `/api/v1/patients/${ctx.patient.id}/history`;
    const h = auth(ctx.user);
    expect((await api().get(url).query({ from: '2026-01-01', to: '2026-10-30' }).set(h)).status).toBe(400);
    expect((await api().get(url).query({ from: '2026-10-30', to: '2026-10-01' }).set(h)).status).toBe(400);
    const d = (await api().get(url).set(h)).body;
    expect([d.fromDate, d.toDate]).toEqual(['2026-10-24', '2026-10-30']);
  });
});

describe('dashboard', () => {
  it('summarises each patient', async () => {
    await prisma.medicine.update({ where: { id: ctx.los.id }, data: { qty: 2 } });
    await prisma.alert.create({ data: { userId: ctx.user.id, patientId: ctx.patient.id, type: 'missed', title: 't', body: 'b', dedupKey: 'k1', data: {} } });
    const body = (await api().get('/api/v1/dashboard').set(auth(ctx.user))).body;
    const card = body.patients[0];
    expect(body.unreadAlerts).toBe(1);
    expect(card.unreadAlerts).toBe(1);
    expect(card.today.total).toBe(3);
    expect(card.nextDose.time).toBe('08:00');
    expect(card.lowStock.map((m: any) => m.name)).toEqual(['Losartan 50mg']);
    expect(card.expiringSoon[0]).toMatchObject({ name: 'Amlodipine 5mg', daysToExpiry: -30 });
    expect(card.device.status).toBe('offline');
  });
});

describe('realtime hub', () => {
  class FakeSocket implements hub.Socket {
    sent: any[] = [];
    private close: () => void = () => undefined;
    send(d: string) {
      this.sent.push(JSON.parse(d));
    }
    onClose(cb: () => void) {
      this.close = cb;
    }
    disconnect() {
      this.close();
    }
  }
  const waitFor = async (pred: () => boolean, ms = 3000) => {
    for (let t = 0; t < ms && !pred(); t += 25) await new Promise((r) => setTimeout(r, 25));
    return pred();
  };

  it('forwards only its own patients, re-subscribes on patients.changed, and pings', async () => {
    const sock = new FakeSocket();
    const ids = [1];
    const served = hub.serve(sock, 77, async () => [...ids], 200);
    await new Promise((r) => setTimeout(r, 200));
    await publish(1, 'intake.updated');
    await publish(2, 'intake.updated');
    expect(await waitFor(() => sock.sent.some((m) => m.patientId === 1))).toBe(true);
    ids.push(2);
    await publishUser(77, 'patients.changed');
    await new Promise((r) => setTimeout(r, 300));
    await publish(2, 'alert.created');
    expect(await waitFor(() => sock.sent.some((m) => m.patientId === 2 && m.type === 'alert.created'))).toBe(true);
    expect(sock.sent.some((m) => m.patientId === 2 && m.type === 'intake.updated')).toBe(false);
    expect(await waitFor(() => sock.sent.some((m) => m.type === 'ping'))).toBe(true);
    sock.disconnect();
    await served;
  });

  it('a missed event reaches the socket within 2 s', async () => {
    const sock = new FakeSocket();
    const served = hub.serve(sock, ctx.user.id, async () => [ctx.patient.id]);
    await new Promise((r) => setTimeout(r, 200));
    await event('missed', ctx.s8.id, '2026-10-30T08:30:00');
    expect(await waitFor(() => ['intake.updated', 'alert.created'].every((t) => sock.sent.some((m) => m.type === t)), 2000)).toBe(true);
    sock.disconnect();
    await served;
  });
});
