import { promises as fs } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../src/core/config';
import { prisma } from '../../src/core/prisma';
import { redis } from '../../src/core/redis';
import { dbDate } from '../../src/core/timeutil';
import { withLock } from '../../src/jobs/locks';
import { deliver, type FetchLike } from '../../src/jobs/push';
import * as alertService from '../../src/services/alertService';
import { PUSH_QUEUE } from '../../src/services/alertService';
import * as monitor from '../../src/services/monitorService';
import { api, auth, makeMedicine, makePatient, makeSchedule, makeUser, pairDevice, ph } from '../helpers';

const OLD = new Date('2026-01-01T00:00:00Z');
let ctx: Awaited<ReturnType<typeof build>>;

async function build() {
  const user = await makeUser();
  const patient = await makePatient(user, 'owner', { displayName: 'Lola Rosa' });
  const dev = await pairDevice(patient);
  const los = await makeMedicine(patient);
  const s8 = await makeSchedule(los, '08:00');
  await prisma.schedule.update({ where: { id: s8.id }, data: { createdAt: OLD } });
  return { user, patient, dev, los, s8 };
}
beforeEach(async () => {
  ctx = await build();
});

const count = (type: string) => prisma.alert.count({ where: { type } });
const postEvent = (type: string, time: string, sid = ctx.s8.id) => api().post('/api/events').send({ device: 'pillbox', type, doseId: sid, time });

describe('alert inbox', () => {
  it('lists newest first, filters unread, marks read, and isolates users', async () => {
    const other = await makeUser();
    for (let i = 0; i < 3; i++) {
      await prisma.alert.create({ data: { userId: ctx.user.id, patientId: ctx.patient.id, type: 'missed', title: `t${i}`, body: 'b', dedupKey: `k${i}`, data: {} } });
    }
    const foreign = await prisma.alert.create({ data: { userId: other.id, type: 'missed', title: 'x', body: 'y', dedupKey: 'z', data: {} } });
    const h = auth(ctx.user);
    const page = (await api().get('/api/v1/alerts').query({ limit: 2 }).set(h)).body;
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items[0].title).toBe('t2');
    expect((await api().post(`/api/v1/alerts/${page.items[0].id}/read`).set(h)).status).toBe(204);
    expect((await api().get('/api/v1/alerts').query({ unread: true }).set(h)).body.total).toBe(2);
    expect((await api().post(`/api/v1/alerts/${foreign.id}/read`).set(h)).status).toBe(404);
    expect((await api().post('/api/v1/alerts/read-all').set(h)).status).toBe(204);
    expect((await api().get('/api/v1/alerts').query({ unread: true }).set(h)).body.total).toBe(0);
  });
});

describe('rules', () => {
  it('the missed fallback fires once, and only after the 35 minute window', async () => {
    vi.setSystemTime(ph(8, 30));
    expect((await monitor.reconcileMissed()).any).toBe(false);
    vi.setSystemTime(ph(8, 36));
    expect((await monitor.reconcileMissed()).count).toBe(1);
    expect(await prisma.intakeRecord.findFirst({ where: { scheduleId: ctx.s8.id } })).toMatchObject({ status: 'missed', source: 'fallback' });
    expect((await monitor.reconcileMissed()).any).toBe(false);
    expect(await count('missed')).toBe(1);
  });

  it('the fallback skips a schedule created after the dose time', async () => {
    await prisma.schedule.update({ where: { id: ctx.s8.id }, data: { createdAt: ph(9) } });
    vi.setSystemTime(ph(9, 30));
    expect((await monitor.reconcileMissed()).any).toBe(false);
  });

  it('a device "missed" and the fallback share one alert', async () => {
    vi.setSystemTime(ph(8, 31));
    await postEvent('missed', '2026-10-30T08:30:00');
    vi.setSystemTime(ph(8, 40));
    await monitor.reconcileMissed();
    expect(await count('missed')).toBe(1);
  });

  it('offline: one alert per outage after 10 minutes', async () => {
    const setSeen = (minutesAgo: number) => prisma.device.update({ where: { id: ctx.dev.id }, data: { lastSeen: new Date(Date.now() - minutesAgo * 60_000) } });
    await setSeen(11);
    expect((await monitor.offlineDevices()).count).toBe(1);
    expect((await monitor.offlineDevices()).any).toBe(false);
    const alert = (await prisma.alert.findFirst({ where: { type: 'offline' } }))!;
    expect(alert.body).toContain('Lola Rosa');
    expect(alert.severity).toBe('high');
    // Back online, then offline again: a new outage, a new alert.
    await setSeen(12.5);
    expect((await monitor.offlineDevices()).count).toBe(1);
  });

  it('is not offline within 10 minutes', async () => {
    await prisma.device.update({ where: { id: ctx.dev.id }, data: { lastSeen: new Date(Date.now() - 9 * 60_000) } });
    expect((await monitor.offlineDevices()).any).toBe(false);
  });

  it('refill: pills left / daily use <= the lead time, once a day', async () => {
    await prisma.medicine.update({ where: { id: ctx.los.id }, data: { qty: 10, lowStockThreshold: 2, refillLeadDays: 3 } });
    expect((await monitor.inventory()).any).toBe(false); // 10 days left
    await prisma.medicine.update({ where: { id: ctx.los.id }, data: { qty: 3 } }); // 3 days left == lead time
    expect((await monitor.inventory()).count).toBe(1);
    expect((await monitor.inventory()).any).toBe(false);
    expect((await prisma.alert.findFirst({ where: { type: 'low_stock' } }))!.body).toContain('3 left');
  });

  it.each([
    ['2026-11-25', 30], ['2026-11-05', 7], ['2026-10-30', 0], ['2026-09-01', 0], ['2027-01-01', null],
  ] as const)('expiry %s falls in bucket %s', async (expiry, bucket) => {
    await prisma.medicine.update({ where: { id: ctx.los.id }, data: { expiryDate: dbDate(expiry) } });
    const created = await monitor.expiry('2026-10-30');
    if (bucket === null) {
      expect(created.any).toBe(false);
      return;
    }
    expect((await prisma.alert.findFirst({ where: { type: 'expiry' } }))!.dedupKey.endsWith(`:${bucket}`)).toBe(true);
    expect((await monitor.expiry('2026-10-30')).any).toBe(false);
  });

  it('expiry walks through the buckets once each', async () => {
    await prisma.medicine.update({ where: { id: ctx.los.id }, data: { expiryDate: dbDate('2026-12-01') } });
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-24', '2026-12-01', '2026-12-05']) await monitor.expiry(day);
    expect(await count('expiry')).toBe(3);
  });

  it('"taken" alerts are off by default; hide-medicine-names hides names', async () => {
    await postEvent('taken', '2026-10-30T08:02:00');
    expect(await count('taken')).toBe(0);
    await prisma.user.update({ where: { id: ctx.user.id }, data: { notifyPrefs: { taken: true, hide_medicine_names: true } } });
    await postEvent('missed', '2026-10-31T08:30:00');
    const missed = (await prisma.alert.findFirst({ where: { type: 'missed' } }))!;
    expect(missed.body).toContain('a medicine');
    expect(missed.body).not.toContain('Losartan');
  });

  it('every caregiver gets a missed alert', async () => {
    const helper = await makeUser();
    await prisma.patientCaregiver.create({ data: { patientId: ctx.patient.id, userId: helper.id, role: 'member' } });
    await postEvent('missed', '2026-10-30T08:30:00');
    const users = (await prisma.alert.findMany({ where: { type: 'missed' } })).map((a) => a.userId);
    expect(new Set(users)).toEqual(new Set([ctx.user.id, helper.id]));
  });

  it('a duplicate dedup key is raised once per caregiver', async () => {
    const first = await alertService.raise(ctx.patient, 'offline', 'k', 't', 'b');
    const second = await alertService.raise(ctx.patient, 'offline', 'k', 't', 'b');
    expect(first.count).toBe(1);
    expect(second.any).toBe(false);
  });

  it('retention removes scans older than 30 days and their files', async () => {
    const old = 'scans/old/x.jpg';
    const full = path.join(settings().SCAN_DIR, old);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, Buffer.from([0xff, 0xd8, 0xff]));
    const mk = (imagePath: string, days: number) =>
      prisma.scan.create({ data: { patientId: ctx.patient.id, deviceId: 'pillbox-cam', imagePath, found: false, method: 'none', durationMs: 1, result: {}, timings: {}, createdAt: new Date(Date.now() - days * 86_400_000) } });
    await mk(old, 31);
    await mk('scans/new/y.jpg', 29);
    const counts = await monitor.cleanup();
    expect(counts.scans).toBe(1);
    await expect(fs.access(full)).rejects.toThrow();
    expect(await prisma.scan.count()).toBe(1);
  });
});

describe('push', () => {
  it('delivers, drops dead tokens, and never sends twice', async () => {
    await prisma.pushToken.createMany({
      data: [
        { userId: ctx.user.id, token: 'ExponentPushToken[good]', platform: 'android' },
        { userId: ctx.user.id, token: 'ExponentPushToken[dead]', platform: 'android' },
      ],
    });
    const a = await prisma.alert.create({ data: { userId: ctx.user.id, patientId: ctx.patient.id, type: 'missed', title: 'Missed', body: 'b', dedupKey: 'm1', data: { url: '/patients/1' } } });
    const seen: any[] = [];
    const fetchFn: FetchLike = async (_url, init) => {
      const msgs = JSON.parse(init.body);
      seen.push(...msgs);
      return {
        ok: true, status: 200,
        json: async () => ({ data: msgs.map((m: any) => (m.to.endsWith('[good]') ? { status: 'ok', id: '1' } : { status: 'error', details: { error: 'DeviceNotRegistered' } })) }),
      };
    };
    settings().EXPO_PUSH_ENABLED = true;
    try {
      expect(await deliver([a.id], fetchFn)).toBe(1);
      expect(new Set(seen.map((m) => m.to))).toEqual(new Set(['ExponentPushToken[good]', 'ExponentPushToken[dead]']));
      expect(seen[0]).toMatchObject({ channelId: 'alerts', data: { url: '/patients/1' } });
      expect((await prisma.pushToken.findMany()).map((t) => t.token)).toEqual(['ExponentPushToken[good]']);
      expect((await prisma.alert.findUnique({ where: { id: a.id } }))!.pushedAt).not.toBeNull();
      expect(await deliver([a.id], fetchFn)).toBe(0); // already pushed
    } finally {
      settings().EXPO_PUSH_ENABLED = false;
    }
  });

  it('a missed event queues a push for the worker', async () => {
    await postEvent('missed', '2026-10-30T08:30:00');
    const alert = (await prisma.alert.findFirst({ where: { type: 'missed' } }))!;
    expect(Number(await redis().rpop(PUSH_QUEUE))).toBe(alert.id);
  });
});

describe('locks', () => {
  it('are exclusive and released afterwards', async () => {
    await withLock('t', 5, async (a) => {
      await withLock('t', 5, async (b) => {
        expect([a, b]).toEqual([true, false]);
      });
    });
    await withLock('t', 5, async (c) => expect(c).toBe(true));
  });
});
