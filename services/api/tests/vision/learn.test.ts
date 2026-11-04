/** "Add a medicine by scanning it on the VOICE": the app arms a wait, the next scan is read, nothing else changes. */
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { api, auth, jpeg, makePatient, makeUser, nothing, pairDevice, visionClient } from '../helpers';

const scan = (data: Buffer) => api().post('/api/scan').set('Content-Type', 'image/jpeg').set('X-Device', 'pillbox-cam').send(data);

async function emptyBox() {
  const user = await makeUser();
  const patient = await makePatient(user);
  await pairDevice(patient);
  return { user, patient };
}

describe('scan to add a medicine', () => {
  it('reads the package of an empty box once the app is waiting, and keeps the box answer {"found":false}', async () => {
    const { user, patient } = await emptyBox();
    const fake = await visionClient();
    fake.respond = () => ({ ...nothing(), readName: 'Biogesic', readStrength: '500mg', readExpiry: '2027-05-31' });

    expect((await api().post(`/api/v1/patients/${patient.id}/scans/learn`).set(auth(user))).status).toBe(204);
    const r = await scan(await jpeg());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ found: false });
    expect(fake.calls).toBe(1);

    const list = await api().get(`/api/v1/patients/${patient.id}/scans`).set(auth(user));
    expect(list.body.items[0]).toMatchObject({ found: false, readName: 'Biogesic', readStrength: '500mg', ocrExpiry: '2027-05-31' });
    // This was expected, so nobody is told about an "unknown package".
    expect(await prisma.alert.count({ where: { type: 'scan_unknown' } })).toBe(0);
  });

  it('waits for one scan only', async () => {
    const { user, patient } = await emptyBox();
    const fake = await visionClient();
    fake.respond = () => ({ ...nothing(), readName: 'Biogesic' });
    await api().post(`/api/v1/patients/${patient.id}/scans/learn`).set(auth(user));
    await scan(await jpeg());
    await scan(await jpeg(1));
    expect(fake.calls).toBe(1); // the second press is an ordinary scan on an empty box: Gemini is not used
  });

  it('does not call Gemini for an empty box when the app is not waiting', async () => {
    await emptyBox();
    const fake = await visionClient();
    expect((await scan(await jpeg())).body).toEqual({ found: false });
    expect(fake.calls).toBe(0);
  });

  it('is only for people looking after that person', async () => {
    const { patient } = await emptyBox();
    const stranger = await makeUser({ email: 'stranger@example.com' });
    expect((await api().post(`/api/v1/patients/${patient.id}/scans/learn`).set(auth(stranger))).status).toBe(404);
    expect((await api().post(`/api/v1/patients/${patient.id}/scans/learn`)).status).toBe(401);
  });
});
