/** DEVICE_PATH_SECRET: device paths only work behind /d/<secret>/ when it is set. */
import { afterEach, describe, expect, it } from 'vitest';
import { settings } from '../../src/core/config';
import { api, setup } from '../helpers';

const SECRET = 's3cret-path';
afterEach(() => {
  settings().DEVICE_PATH_SECRET = '';
});

describe('DEVICE_PATH_SECRET', () => {
  it('unset: plain paths work and /d/... is 404', async () => {
    await setup();
    expect((await api().get('/api/schedule').query({ device: 'pillbox' })).status).toBe(200);
    expect((await api().get('/d/anything/api/schedule').query({ device: 'pillbox' })).status).toBe(404);
  });

  it('set: the secret prefix works, query string included', async () => {
    await setup();
    settings().DEVICE_PATH_SECRET = SECRET;
    const r = await api().get(`/d/${SECRET}/api/schedule`).query({ device: 'pillbox' });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('doses');
    expect((await api().post(`/d/${SECRET}/api/events`).send({})).status).not.toBe(404);
  });

  it('set: the bare paths and a wrong secret are hidden', async () => {
    await setup();
    settings().DEVICE_PATH_SECRET = SECRET;
    expect((await api().get('/api/schedule').query({ device: 'pillbox' })).status).toBe(404);
    expect((await api().post('/api/events').send({})).status).toBe(404);
    expect((await api().get('/d/wrong/api/schedule').query({ device: 'pillbox' })).status).toBe(404);
    expect((await api().get(`/d/${SECRET}/api/v1/me`)).status).toBe(404);
  });

  it('set: the app API is unaffected', async () => {
    settings().DEVICE_PATH_SECRET = SECRET;
    expect((await api().get('/api/v1/me')).status).toBe(401);
  });
});
