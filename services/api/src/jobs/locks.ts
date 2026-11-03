/** Redis locks so two workers never run the same job at once, and one scan per box at a time. */
import { randomUUID } from 'node:crypto';
import { redis } from '../core/redis';

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Runs `fn(true)` if this process got the lock, `fn(false)` otherwise. The lock is always released. */
export async function withLock<T>(name: string, ttlSeconds: number, fn: (got: boolean) => Promise<T>): Promise<T> {
  const r = redis();
  const token = randomUUID();
  const key = `lock:${name}`;
  const got = (await r.set(key, token, 'EX', ttlSeconds, 'NX')) === 'OK';
  try {
    return await fn(got);
  } finally {
    if (got) await r.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
