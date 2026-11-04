/** POST /patients/:id/medicines/read-package: the phone's photo is read by the same AI, nothing is stored. */
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { api, auth, failsWith, jpeg, makePatient, makeUser, nothing, visionClient } from '../helpers';

async function post(user: Awaited<ReturnType<typeof makeUser>>, pid: number, data: Buffer, type = 'image/jpeg') {
  return api().post(`/api/v1/patients/${pid}/medicines/read-package`).set(auth(user)).attach('file', data, { filename: 'box.jpg', contentType: type });
}

describe('read a package photo from the phone', () => {
  it('returns the printed name, strength and expiry', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    (await visionClient()).respond = () => ({ ...nothing(), readName: 'Biogesic', readStrength: '500mg', readExpiry: '2027-05-31', confidence: 0.9, source: 'printed' });
    const r = await post(user, patient.id, await jpeg());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ read: true, name: 'Biogesic', strength: '500mg', expiry: '2027-05-31', guessed: false, reason: null });
    expect(await prisma.scan.count()).toBe(0); // the phone photo is not kept
  });

  it('marks a name guessed from the look of the box', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    (await visionClient()).respond = () => ({ ...nothing(), readName: 'Biogesic', confidence: 0.6, source: 'appearance' });
    expect((await post(user, patient.id, await jpeg())).body).toMatchObject({ read: true, name: 'Biogesic', guessed: true });
  });

  it('says it could not read it (still 200) when the AI fails or sees nothing', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    const fake = await visionClient();
    fake.respond = () => nothing();
    expect((await post(user, patient.id, await jpeg())).body).toMatchObject({ read: false, name: null, guessed: false });
    fake.respond = failsWith('rate_limited');
    expect((await post(user, patient.id, await jpeg())).body).toMatchObject({ read: false, reason: 'rate_limited' });
  });

  it('refuses a file that is not a photo and strangers', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    expect((await post(user, patient.id, Buffer.from('not a photo'), 'text/plain')).status).toBe(415);
    const stranger = await makeUser({ email: 'stranger@example.com' });
    expect((await post(stranger, patient.id, await jpeg())).status).toBe(404);
  });
});
