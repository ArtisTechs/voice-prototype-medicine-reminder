/** Publish realtime hints to Redis. Call only after the DB commit. Messages carry ids, not records. */
import { getLogger } from '../core/logger';
import { redis } from '../core/redis';
import { utcnow } from '../core/timeutil';

const log = getLogger('realtime');

export const patientChannel = (patientId: number) => `patient:${patientId}`;
export const userChannel = (userId: number) => `user:${userId}`;

async function send(channel: string, msg: Record<string, unknown>): Promise<void> {
  try {
    await redis().publish(channel, JSON.stringify(msg));
  } catch {
    log.warn('publish_failed', { channel, type: msg.type });
  }
}

export const publish = (patientId: number, type: string, data: Record<string, unknown> = {}) =>
  send(patientChannel(patientId), { type, patientId, data, ts: utcnow().toISOString() });

export const publishUser = (userId: number, type: string, data: Record<string, unknown> = {}) =>
  send(userChannel(userId), { type, data, ts: utcnow().toISOString() });
