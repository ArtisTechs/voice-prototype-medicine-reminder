/** Fixed-window rate limits in Redis. Fails open: a Redis outage must not stop the pillbox. */
import { settings } from './config';
import { rateLimited } from './errors';
import { getLogger } from './logger';
import { redis } from './redis';

const log = getLogger('ratelimit');

export async function checkRate(scope: string, ident: string, limit: number, windowS = 60): Promise<void> {
  if (!settings().RATE_LIMIT_ENABLED) return;
  const bucket = Math.floor(Date.now() / 1000 / windowS);
  const key = `rl:${scope}:${ident}:${bucket}`;
  let count: number;
  try {
    const r = redis();
    count = await r.incr(key);
    if (count === 1) await r.expire(key, windowS + 5);
  } catch {
    log.warn('ratelimit_unavailable', { scope });
    return;
  }
  if (count > limit) throw rateLimited('Too many requests. Try again in a minute.');
}
