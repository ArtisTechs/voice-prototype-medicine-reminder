import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/prisma';
import { api, auth, makeUser } from '../helpers';

const signup = (email = 'new@example.com', password = 'secret123', name = 'Ana') =>
  api().post('/api/v1/auth/signup').send({ email, password, name });

describe('auth', () => {
  it('signup returns tokens and stores an argon2id hash', async () => {
    const r = await signup('Ana@Example.com');
    expect(r.status).toBe(201);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeTruthy();
    const user = await prisma.user.findUnique({ where: { email: 'ana@example.com' } });
    expect(user!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('refuses a duplicate email with 409 email_taken', async () => {
    await signup();
    const r = await signup('NEW@example.com');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('email_taken');
  });

  it('validates signup fields with 422 and a field list', async () => {
    const r = await signup('not-an-email', 'short');
    expect(r.status).toBe(422);
    const fields = r.body.error.details.map((d: any) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('login works, and a wrong password looks the same as an unknown email', async () => {
    await makeUser({ email: 'x@example.com' });
    const ok = await api().post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'password123' });
    expect(ok.status).toBe(200);
    const badPw = await api().post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'nope' });
    const noUser = await api().post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'nope' });
    expect(badPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPw.body).toEqual(noUser.body);
    expect(badPw.body.error.code).toBe('invalid_credentials');
  });

  it('rotates refresh tokens, and reusing an old one ends every session', async () => {
    const tokens = (await signup()).body;
    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(tokens.refreshToken);
    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(reuse.status).toBe(401);
    const after = await api().post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(after.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('an access token cannot be used to refresh', async () => {
    const tokens = (await signup()).body;
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: tokens.accessToken })).status).toBe(401);
  });

  it('protected routes need a valid token', async () => {
    expect((await api().get('/api/v1/me')).status).toBe(401);
    expect((await api().get('/api/v1/me').set('Authorization', 'Bearer junk')).status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const tokens = (await signup()).body;
    const r = await api().post('/api/v1/auth/logout').set('Authorization', `Bearer ${tokens.accessToken}`).send({ refreshToken: tokens.refreshToken });
    expect(r.status).toBe(204);
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken })).status).toBe(401);
  });

  it('rate limits login to 10 per minute per address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await api().post('/api/v1/auth/login').send({ email: 'a@example.com', password: 'x' })).status);
    expect(codes.at(-1)).toBe(429);
  });

  it('GET and PATCH /me', async () => {
    const user = await makeUser();
    const me = (await api().get('/api/v1/me').set(auth(user))).body;
    expect(me.timezone).toBe('Asia/Manila');
    expect(me.notifyPrefs.taken).toBe(false);
    expect(me.notifyPrefs.missed).toBe(true);
    expect(Object.keys(me.notifyPrefs).sort()).toEqual(['expiredDose', 'expiry', 'hideMedicineNames', 'lowStock', 'missed', 'offline', 'scanUnknown', 'taken']);
    const r = await api().patch('/api/v1/me').set(auth(user)).send({ name: 'Bea', notifyPrefs: { ...me.notifyPrefs, taken: true } });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Bea');
    expect(r.body.notifyPrefs.taken).toBe(true);
    expect((await api().patch('/api/v1/me').set(auth(user)).send({ timezone: 'Mars/Base' })).status).toBe(422);
    expect((await api().patch('/api/v1/me').set(auth(user)).send({ timezone: 'Asia/Tokyo' })).body.timezone).toBe('Asia/Tokyo');
  });

  it('registering a push token is idempotent and validates the format', async () => {
    const user = await makeUser();
    const body = { token: 'ExponentPushToken[abc123xyz]', platform: 'android' };
    for (let i = 0; i < 2; i++) expect((await api().post('/api/v1/me/push-tokens').set(auth(user)).send(body)).status).toBe(204);
    expect(await prisma.pushToken.count()).toBe(1);
    expect((await api().post('/api/v1/me/push-tokens').set(auth(user)).send({ token: 'nope-nope-nope' })).status).toBe(422);
  });

  it('GET /api/v1/meta is public and has no personal data', async () => {
    const r = await api().get('/api/v1/meta');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['deviceTz', 'name', 'serverTime', 'version']);
    expect(r.body.serverTime).toBe('2026-10-30T07:00:00+08:00');
  });
});
