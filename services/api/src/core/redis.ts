import Redis from 'ioredis';
import { settings } from './config';

let client: Redis | null = null;

export function redis(): Redis {
  if (!client) {
    client = new Redis(settings().REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
    client.on('error', () => undefined); // callers handle failures; avoid unhandled 'error' events
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
