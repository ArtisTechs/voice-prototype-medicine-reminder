/** One VOICE serving several people, moving between VOICEs, and auto-detecting unpaired ones. */
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { api, auth, makeMedicine, makePatient, makeSchedule, makeUser, pairDevice } from '../helpers';

const schedule = (device = 'pillbox') => api().get('/api/schedule').query({ device });

describe('shared VOICE', () => {
  it('two people share one VOICE', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const pa = await makePatient(a, 'owner', { displayName: 'Lola Rosa' });
    const pb = await makePatient(b, 'owner', { displayName: 'Lolo Ben' });
    await makeMedicine(pa, { slot: 1 });
    await makeMedicine(pb, { name: 'Metformin', strength: '500mg', slot: 2 });
    await pairDevice(pa, 'pillbox');
    const r = await api().put(`/api/v1/patients/${pb.id}/device`).set(auth(b)).send({ deviceId: 'pillbox' });
    expect(r.status).toBe(200);
    expect(r.body.people.map((p: any) => [p.name, p.current])).toEqual([['Another person', false], ['Lolo Ben', true]]);
    // B sees their own medicine, and that slot 1 is someone else's without its name.
    expect(r.body.slots[0]).toMatchObject({ medicineName: null, personName: 'Another person' });
    expect(r.body.slots[1]).toMatchObject({ medicineName: 'Metformin 500mg', personName: 'Lolo Ben' });
    expect(await prisma.device.count()).toBe(1);
  });

  it("the schedule has everyone's doses, prefixed with first names (23 chars total)", async () => {
    const user = await makeUser();
    const pa = await makePatient(user, 'owner', { displayName: 'Lola Rosa' });
    const pb = await makePatient(user, 'owner', { displayName: 'Lolo Ben' });
    const s1 = await makeSchedule(await makeMedicine(pa, { slot: 1 }), '08:00');
    const s2 = await makeSchedule(await makeMedicine(pb, { name: 'Metformin', strength: '500mg', slot: 2 }), '07:00');
    await pairDevice(pa);
    await pairDevice(pb);
    const doses = (await schedule()).body.doses;
    expect(doses.map((d: any) => [d.id, d.name])).toEqual([[s2.id, 'Lolo: Metformin 500mg'], [s1.id, 'Lola: Losartan 50mg']]);
    expect(doses.every((d: any) => d.name.length <= 23)).toBe(true);
  });

  it('events go to the person who owns the dose or slot', async () => {
    const user = await makeUser();
    const pa = await makePatient(user);
    const pb = await makePatient(user);
    await makeMedicine(pa, { slot: 1 });
    const medB = await makeMedicine(pb, { slot: 2, qty: 10 });
    const schedB = await makeSchedule(medB, '08:00');
    await pairDevice(pa);
    await pairDevice(pb);
    const r = await api().post('/api/events').send({ device: 'pillbox', type: 'taken', slot: 2, doseId: schedB.id, time: '2026-10-30T08:04:10' });
    expect(r.status).toBe(200);
    const rec = await prisma.intakeRecord.findFirst({ where: { scheduleId: schedB.id } });
    expect(rec).toMatchObject({ patientId: pb.id, status: 'taken' });
    expect((await prisma.medicine.findUnique({ where: { id: medB.id } }))!.qty).toBe(9);
    await api().post('/api/events').send({ device: 'pillbox', type: 'opened', slot: 2, time: '2026-10-30T09:00:00' });
    expect((await prisma.deviceEvent.findFirst({ where: { type: 'opened' } }))!.patientId).toBe(pb.id);
  });

  it('joining a VOICE with a clashing slot is refused with 409 slot_taken', async () => {
    const user = await makeUser();
    const pa = await makePatient(user);
    const pb = await makePatient(user, 'owner', { displayName: 'Lolo Ben' });
    await makeMedicine(pa, { slot: 3 });
    await makeMedicine(pb, { slot: 3 });
    await pairDevice(pa);
    const r = await api().put(`/api/v1/patients/${pb.id}/device`).set(auth(user)).send({ deviceId: 'pillbox' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('slot_taken');
    expect(r.body.error.message).toContain('Slot 3');
  });

  it("a medicine cannot take a slot another person uses on the same VOICE", async () => {
    const user = await makeUser();
    const pa = await makePatient(user);
    const pb = await makePatient(user);
    await makeMedicine(pa, { slot: 4 });
    await pairDevice(pa);
    await pairDevice(pb);
    const r = await api().post(`/api/v1/patients/${pb.id}/medicines`).set(auth(user)).send({ name: 'Metformin', slot: 4 });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('another person');
  });

  it('unpairing one person keeps the VOICE for the others; the last one deletes it', async () => {
    const user = await makeUser();
    const pa = await makePatient(user);
    const pb = await makePatient(user);
    await makeMedicine(pa, { slot: 1 });
    await pairDevice(pa);
    await pairDevice(pb);
    const h = auth(user);
    expect((await api().delete(`/api/v1/patients/${pb.id}/device`).set(h)).status).toBe(204);
    expect((await schedule()).status).toBe(200);
    expect((await api().delete(`/api/v1/patients/${pa.id}/device`).set(h)).status).toBe(204);
    expect(await prisma.device.count()).toBe(0);
    expect((await schedule()).status).toBe(403);
  });

  it('moving to another VOICE leaves the old one, which is deleted when empty', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    await pairDevice(patient, 'pillbox');
    const r = await api().put(`/api/v1/patients/${patient.id}/device`).set(auth(user)).send({ deviceId: 'kitchen' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ deviceId: 'kitchen', cameraId: 'kitchen-cam' });
    expect((await prisma.device.findMany()).map((d) => d.deviceId)).toEqual(['kitchen']);
    expect((await prisma.patient.findUnique({ where: { id: patient.id } }))!.deviceId).not.toBeNull();
  });

  it('an unpaired VOICE that polls is detected, then paired', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    const h = auth(user);
    expect((await schedule('voice-7')).status).toBe(403);
    let found = (await api().get('/api/v1/devices/nearby').set(h)).body;
    expect(found.map((d: any) => [d.deviceId, d.paired, d.people])).toEqual([['voice-7', false, 0]]);
    await api().put(`/api/v1/patients/${patient.id}/device`).set(h).send({ deviceId: 'voice-7' });
    found = (await api().get('/api/v1/devices/nearby').set(h)).body;
    expect(found.map((d: any) => [d.deviceId, d.paired, d.mine])).toEqual([['voice-7', true, true]]);
    expect((await schedule('voice-7')).status).toBe(200);
  });

  it("lists a VOICE someone else uses only while it is online", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await pairDevice(await makePatient(a));
    expect((await api().get('/api/v1/devices/nearby').set(auth(b))).body).toEqual([]);
    await schedule();
    const found = (await api().get('/api/v1/devices/nearby').set(auth(b))).body;
    expect(found.map((d: any) => [d.deviceId, d.paired, d.mine, d.status])).toEqual([['pillbox', true, false, 'online']]);
  });
});
