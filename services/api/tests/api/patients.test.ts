import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { settings } from '../../src/core/config';
import { prisma } from '../../src/core/prisma';
import { api, auth, makeMedicine, makePatient, makeUser, pairDevice } from '../helpers';

describe('patients', () => {
  it('creates and lists patients', async () => {
    const user = await makeUser();
    const r = await api().post('/api/v1/patients').set(auth(user)).send({ displayName: 'Lolo Ben' });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('owner');
    const list = (await api().get('/api/v1/patients').set(auth(user))).body;
    expect(list.map((p: any) => p.displayName)).toEqual(['Lolo Ben']);
  });

  it('answers 404 (not 403) for every patient route when the caregiver is not linked', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const patient = await makePatient(owner);
    const med = await makeMedicine(patient);
    await pairDevice(patient);
    const pid = patient.id;
    const routes: [string, string][] = [
      ['get', `/api/v1/patients/${pid}`], ['patch', `/api/v1/patients/${pid}`], ['get', `/api/v1/patients/${pid}/medicines`],
      ['get', `/api/v1/patients/${pid}/medicines/${med.id}`], ['patch', `/api/v1/patients/${pid}/medicines/${med.id}`],
      ['delete', `/api/v1/patients/${pid}/medicines/${med.id}`], ['get', `/api/v1/patients/${pid}/device`],
      ['post', `/api/v1/patients/${pid}/invites`], ['get', `/api/v1/patients/${pid}/caregivers`], ['delete', `/api/v1/patients/${pid}`],
      ['get', `/api/v1/patients/${pid}/today`], ['get', `/api/v1/patients/${pid}/history`], ['get', `/api/v1/patients/${pid}/scans`],
    ];
    for (const [method, url] of routes) {
      const r = await (api() as any)[method](url).set(auth(stranger)).send(method === 'patch' ? {} : undefined);
      expect([method, url, r.status]).toEqual([method, url, 404]);
    }
  });

  it('invite flow: a code joins a second caregiver once', async () => {
    const owner = await makeUser();
    const helper = await makeUser();
    const patient = await makePatient(owner);
    const r = await api().post(`/api/v1/patients/${patient.id}/invites`).set(auth(owner));
    expect(r.status).toBe(201);
    const code: string = r.body.code;
    expect(code).toHaveLength(6);
    expect(/[01OI]/.test(code)).toBe(false);
    const acc = await api().post('/api/v1/invites/accept').set(auth(helper)).send({ code: code.toLowerCase() });
    expect(acc.status).toBe(200);
    expect(acc.body.role).toBe('member');
    const cgs = (await api().get(`/api/v1/patients/${patient.id}/caregivers`).set(auth(helper))).body;
    expect(new Set(cgs.map((c: any) => c.role))).toEqual(new Set(['owner', 'member']));
    const third = await makeUser();
    const used = await api().post('/api/v1/invites/accept').set(auth(third)).send({ code });
    expect(used.status).toBe(400);
    expect(used.body.error.code).toBe('invite_invalid');
  });

  it('rejects an expired invite', async () => {
    const owner = await makeUser();
    const helper = await makeUser();
    const patient = await makePatient(owner);
    await prisma.invite.create({ data: { patientId: patient.id, code: 'ABCDEF', createdBy: owner.id, expiresAt: new Date(Date.now() - 60_000) } });
    expect((await api().post('/api/v1/invites/accept').set(auth(helper)).send({ code: 'ABCDEF' })).status).toBe(400);
  });

  it('a member cannot delete the patient', async () => {
    const owner = await makeUser();
    const helper = await makeUser();
    const patient = await makePatient(owner);
    await prisma.patientCaregiver.create({ data: { patientId: patient.id, userId: helper.id, role: 'member' } });
    expect((await api().delete(`/api/v1/patients/${patient.id}`).set(auth(helper))).status).toBe(404);
  });

  it('pairs a device and shows its status and slots', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    await makeMedicine(patient, { slot: 2 });
    const h = auth(user);
    const r = await api().put(`/api/v1/patients/${patient.id}/device`).set(h).send({ deviceId: 'pillbox' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cameraId: 'pillbox-cam', status: 'offline', lastSeen: null });
    expect(r.body.slots.map((s: any) => s.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(r.body.slots[1].medicineName).toBe('Losartan 50mg');
    await api().get('/api/schedule').query({ device: 'pillbox' }); // heartbeat
    const status = (await api().get(`/api/v1/patients/${patient.id}/device`).set(h)).body;
    expect(status.status).toBe('online');
    expect(status.lastSeen).toBeTruthy();
  });

  it('is offline after 3 minutes without a heartbeat', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    const dev = await pairDevice(patient);
    await prisma.device.update({ where: { id: dev.id }, data: { lastSeen: new Date(Date.now() - 4 * 60_000) } });
    expect((await api().get(`/api/v1/patients/${patient.id}/device`).set(auth(user))).body.status).toBe('offline');
  });

  it("refuses a code that is another VOICE's camera with 409 device_taken", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const pa = await makePatient(a);
    const pb = await makePatient(b);
    await pairDevice(pa, 'pillbox');
    const r = await api().put(`/api/v1/patients/${pb.id}/device`).set(auth(b)).send({ deviceId: 'pillbox-cam' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('device_taken');
  });

  it('validates the device code', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    expect((await api().put(`/api/v1/patients/${patient.id}/device`).set(auth(user)).send({ deviceId: 'pill box!' })).status).toBe(422);
  });

  it('an unpaired box is refused by the firmware API', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    await pairDevice(patient);
    await api().delete(`/api/v1/patients/${patient.id}/device`).set(auth(user));
    expect((await api().get('/api/schedule').query({ device: 'pillbox' })).status).toBe(403);
  });

  it('deleting an account removes orphaned patients, their files and their VOICE, and hands shared patients on', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const mine = await makePatient(me);
    const shared = await makePatient(me);
    await prisma.patientCaregiver.create({ data: { patientId: shared.id, userId: other.id, role: 'member' } });
    const med = await makeMedicine(mine);
    await pairDevice(mine);
    const rel = 'scans/test/delete-me.jpg';
    const full = path.join(settings().SCAN_DIR, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, Buffer.from([0xff, 0xd8, 0xff]));
    await prisma.scan.create({ data: { patientId: mine.id, deviceId: 'pillbox-cam', imagePath: rel, found: false, method: 'none', durationMs: 1, result: {}, timings: {} } });

    expect((await api().delete('/api/v1/me').set(auth(me))).status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: me.id } })).toBeNull();
    expect(await prisma.patient.count({ where: { id: mine.id } })).toBe(0);
    expect(await prisma.medicine.count({ where: { id: med.id } })).toBe(0);
    expect(await prisma.device.count({ where: { deviceId: 'pillbox' } })).toBe(0); // nobody else used that VOICE
    await expect(fs.access(full)).rejects.toThrow();
    expect(await prisma.patient.count({ where: { id: shared.id } })).toBe(1);
    expect((await api().get(`/api/v1/patients/${shared.id}`).set(auth(other))).body.role).toBe('owner');
  });
});
