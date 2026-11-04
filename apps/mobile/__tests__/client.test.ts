import { api, setOnAuthLost } from '../src/api/client';
import { loadTokens, resetTokenCache, saveTokens } from '../src/auth/tokenStore';
import { ApiError } from '../src/lib/apiError';

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('api client', () => {
  const fetchMock = jest.fn();
  beforeEach(async () => {
    resetTokenCache();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await saveTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new-access' ? json(200, { ok: 1 }) : json(401, { error: { code: 'unauthorized', message: 'x' } });
    });
    // Two parallel calls share one refresh (single flight).
    const [a, b] = await Promise.all([api('/api/v1/me'), api('/api/v1/dashboard')]);
    expect(a).toEqual({ ok: 1 });
    expect(b).toEqual({ ok: 1 });
    const refreshCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    expect((await loadTokens())?.refreshToken).toBe('new-refresh');
  });

  it('signs out when refresh fails', async () => {
    const lost = jest.fn();
    setOnAuthLost(lost);
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh') ? json(401, {}) : json(401, { error: { code: 'unauthorized', message: 'x' } }),
    );
    await expect(api('/api/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalled();
    expect(await loadTokens()).toBeNull();
  });

  it('maps the error envelope and network failures', async () => {
    fetchMock.mockImplementationOnce(() =>
      json(409, { error: { code: 'slot_taken', message: 'Slot 2 already has a medicine.', details: null } }),
    );
    await expect(api('/api/v1/x', { method: 'POST', body: {} })).rejects.toEqual(
      new ApiError(409, 'slot_taken', 'Slot 2 already has a medicine.'),
    );
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    await expect(api('/api/v1/x')).rejects.toMatchObject({ code: 'network' });
  });

  it('retries a read once when the server is still waking up, but never a write', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')))
      .mockImplementationOnce(() => json(200, { ok: true }));
    await expect(api('/api/v1/x')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    await expect(api('/api/v1/x', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
