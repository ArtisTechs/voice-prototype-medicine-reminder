import Redis from 'ioredis';
import { settings } from './config';
import { getLogger } from './logger';

let client: Redis | null = null;
let reported = false;

/** Log (once) why Redis is unreachable. Host only: never the password. */
function report(err: Error): void {
  if (reported) return;
  reported = true;
  let host = '?';
  try { const u = new URL(settings().REDIS_URL); host = u.host; } catch { host = '(REDIS_URL is not a valid URL)'; }
  getLogger('redis').warn('redis_unreachable', { host, error: err.message });
}

export function redis(): Redis {
  if (!client) {
    client = new Redis(settings().REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
    client.on('error', report); // callers handle failures; this only logs once
  }
  return client;
}

/** A separate connection for SUBSCRIBE (a subscribed connection cannot run other commands). */
export function newSubscriber(): Redis {
  const sub = new Redis(settings().REDIS_URL, { maxRetriesPerRequest: null });
  sub.on('error', () => undefined);
  return sub;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    const c = client;
    client = null;
    await c.quit().catch(() => undefined);
  }
}
