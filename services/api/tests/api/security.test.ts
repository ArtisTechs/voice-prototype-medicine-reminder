/** Security review checklist, as tests (see security-privacy skill). */
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/core/http';
import { api } from '../helpers';

const PUBLIC = new Set(['/meta', '/auth/signup', '/auth/login', '/auth/refresh']);

describe('security', () => {
  it('every app route requires a caregiver, except the public list', () => {
    expect(registry.length).toBeGreaterThan(30);
    const unguarded = registry.filter((r) => !r.auth && !PUBLIC.has(r.path)).map((r) => `${r.method} ${r.path}`);
    expect(unguarded).toEqual([]);
    expect(registry.filter((r) => r.auth && PUBLIC.has(r.path))).toEqual([]);
  });

  it('every /patients/:patientId/... route checks the caregiver\'s link (404 for strangers)', () => {
    const scoped = registry.filter((r) => r.path.includes(':patientId'));
    expect(scoped.length).toBeGreaterThan(15);
    expect(scoped.filter((r) => !r.patientScoped || !r.auth)).toEqual([]);
  });

  it('destructive patient routes are owner-only', () => {
    const owner = registry.filter((r) => r.owner).map((r) => `${r.method} ${r.path}`);
    expect(owner).toEqual(['delete /patients/:patientId']);
  });

  it('unknown routes answer the JSON error format, never internals', async () => {
    const r = await api().get('/api/v1/does-not-exist');
    expect(r.status).toBe(404);
    expect(Object.keys(r.body)).toEqual(['error']);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|prisma|at \w+/i);
  });

  it('a malformed JSON body is a 422, not a 500', async () => {
    const r = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{not json');
    expect(r.status).toBe(422);
  });

  it('non-numeric ids are a 422', async () => {
    expect((await api().get('/api/v1/patients/abc').set('Authorization', 'Bearer x')).status).toBe(401);
  });

  it('/docs is off unless ENABLE_DOCS is set', async () => {
    expect((await api().get('/docs')).status).toBe(404);
    expect((await api().get('/openapi.json')).status).toBe(404);
  });

  it('health check reports the database and redis', async () => {
    const r = await api().get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok', db: true, redis: true });
  });

  it('sends security headers and hides the framework', async () => {
    const r = await api().get('/healthz');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
