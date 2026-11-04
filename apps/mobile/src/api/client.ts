import { clearTokens, loadTokens, saveTokens, type Tokens } from '../auth/tokenStore';
import { ApiError } from '../lib/apiError';

// A release build without EXPO_PUBLIC_API_URL still talks to the hosted server; only dev builds fall back to localhost.
const HOSTED_API_URL = 'https://voice-prototype-medicine-reminder.onrender.com';
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:5055' : HOSTED_API_URL)).replace(/\/$/, '');

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  timeoutMs?: number;
};

let onAuthLost: () => void = () => {};
/** AuthProvider registers what happens when the session cannot be refreshed. */
export function setOnAuthLost(fn: () => void) {
  onAuthLost = fn;
}

let refreshing: Promise<Tokens | null> | null = null;

/** Single-flight refresh: concurrent 401s share one /auth/refresh call. */
export function refreshTokens(): Promise<Tokens | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const current = await loadTokens();
      if (!current) return null;
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) return null;
        const next = (await res.json()) as Tokens;
        await saveTokens(next);
        return next;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function buildUrl(path: string, query?: Options['query']) {
  const qs = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${API_URL}${path}${qs ? `?${qs}` : ''}`;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json();
    const e = data?.error;
    if (e) return new ApiError(res.status, e.code ?? 'error', e.message ?? 'Something went wrong.', e.details);
  } catch {
    // not JSON
  }
  return new ApiError(res.status, 'error', 'Something went wrong.');
}

async function send(path: string, opts: Options, token?: string): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'network', "We couldn't reach the server. Check your internet, then try again. It can take a minute to wake up.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Free hosting puts the server to sleep when idle and the first request then takes up to a minute.
 * Call this when the app opens so it is awake by the time someone has typed their password.
 */
export function wakeServer(): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  fetch(`${API_URL}/healthz`, { signal: controller.signal })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}

/** Typed call to /api/v1. Adds the bearer token, refreshes once on 401, maps errors to ApiError. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const useAuth = opts.auth !== false;
  const tokens = useAuth ? await loadTokens() : null;
  let res: Response;
  try {
    res = await send(path, opts, tokens?.accessToken);
  } catch (e) {
    // One quiet retry for reads: the first request after a long idle often fails while the server wakes up.
    if (!(e instanceof ApiError && e.code === 'network') || (opts.method ?? 'GET') !== 'GET') throw e;
    res = await send(path, opts, tokens?.accessToken);
  }
  if (res.status === 401 && useAuth && tokens) {
    const next = await refreshTokens();
    if (!next) {
      await clearTokens();
      onAuthLost();
      throw new ApiError(401, 'unauthorized', 'Please sign in again.');
    }
    res = await send(path, opts, next.accessToken);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function wsUrl(token: string): string {
  return `${API_URL.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(token)}`;
}

export function fileUrl(path: string): string {
  return `${API_URL}${path}`;
}
