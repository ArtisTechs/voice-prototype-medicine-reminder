/** Reading first, a labelled guess from the package's look second, and never a loose guess on the box's answer. */
import { describe, expect, it } from 'vitest';
import { settings } from '../../src/core/config';
import { prisma } from '../../src/core/prisma';
import { api, auth, jpeg, makePatient, makeUser, nothing, pairDevice, sees, setup, visionClient } from '../helpers';
import { identify } from '../../src/vision/pipeline';

const scan = (data: Buffer) => api().post('/api/scan').set('Content-Type', 'image/jpeg').set('X-Device', 'pillbox-cam').send(data);

describe('guessing from the look of the package', () => {
  it('a registered medicine needs more confidence when it was recognised by look only', async () => {
    const s = await setup();
    const fake = await visionClient();
    fake.respond = () => sees(s.meds.losartan.id, 0.85, { source: 'appearance' });
    expect((await scan(await jpeg())).body).toEqual({ found: false }); // 0.85 is enough for printed text, not for a look

    fake.respond = () => sees(s.meds.losartan.id, 0.92, { source: 'appearance' });
    const r = await scan(await jpeg());
    expect(r.body.found).toBe(true);
    expect(r.body.name).toBe('Losartan 50mg'); // still the database's words, not the model's
    const row = await prisma.scan.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect(row.guessed).toBe(true);
  });

  it('printed text keeps the normal threshold and is not marked as a guess', async () => {
    const s = await setup();
    (await visionClient()).respond = () => sees(s.meds.losartan.id, 0.75, { source: 'printed' });
    expect((await scan(await jpeg())).body.found).toBe(true);
    expect((await prisma.scan.findFirstOrThrow({ orderBy: { id: 'desc' } })).guessed).toBe(false);
  });

  it('a guessed name is shown as a guess and never matched by text', async () => {
    const candidates = [{ id: 7, name: 'Losartan', strength: '50mg', barcode: null }];
    (await visionClient()).respond = () => ({ ...nothing(), readName: 'Losartan', readStrength: '50mg', confidence: 0.8, source: 'appearance' });
    const m = await identify(await jpeg(), candidates);
    expect(m).toMatchObject({ medicineId: null, readName: 'Losartan', guessed: true });
  });

  it('add-a-medicine shows the app a guess from looks, flagged as guessed', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    await pairDevice(patient);
    (await visionClient()).respond = () => ({ ...nothing(), readName: 'Biogesic', readStrength: '500mg', confidence: 0.7, source: 'appearance' });
    await api().post(`/api/v1/patients/${patient.id}/scans/learn`).set(auth(user));
    await scan(await jpeg());
    const list = await api().get(`/api/v1/patients/${patient.id}/scans`).set(auth(user));
    expect(list.body.items[0]).toMatchObject({ readName: 'Biogesic', guessed: true });
  });

  it('SCAN_GUESS_FROM_LOOKS=false ignores anything that was not printed', async () => {
    const user = await makeUser();
    const patient = await makePatient(user);
    await pairDevice(patient);
    settings().SCAN_GUESS_FROM_LOOKS = false;
    try {
      (await visionClient()).respond = () => ({ ...nothing(), readName: 'Biogesic', confidence: 0.7, source: 'appearance' });
      await api().post(`/api/v1/patients/${patient.id}/scans/learn`).set(auth(user));
      await scan(await jpeg());
      const list = await api().get(`/api/v1/patients/${patient.id}/scans`).set(auth(user));
      expect(list.body.items[0].readName).toBeNull();
    } finally {
      settings().SCAN_GUESS_FROM_LOOKS = true;
    }
  });
});
