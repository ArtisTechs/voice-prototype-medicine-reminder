/**
 * Expo push sender: BRPOP alert ids from Redis, send through the Expo push service.
 * https://docs.expo.dev/push-notifications/sending-notifications/ (batches of <= 100 messages).
 */
import { settings } from '../core/config';
import { getLogger } from '../core/logger';
import { redis } from '../core/redis';
import { utcnow } from '../core/timeutil';
import * as alertRepo from '../repositories/alerts';
import * as userRepo from '../repositories/users';
import { PUSH_QUEUE } from '../services/alertService';

const log = getLogger('push');
const BATCH = 100;
const RETRIES = 3;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface Ticket {
  status?: string;
  details?: { error?: string };
}

/** One message per (alert, token). */
export async function buildMessages(alertIds: number[]) {
  const alerts = await alertRepo.unpushedByIds(alertIds);
  const tokens = alerts.length ? await userRepo.pushTokensForUsers([...new Set(alerts.map((a) => a.userId))]) : [];
  const byUser = new Map<number, string[]>();
  for (const t of tokens) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t.token]);
  const messages: Record<string, unknown>[] = [];
  for (const a of alerts) {
    for (const token of byUser.get(a.userId) ?? []) {
      messages.push({
        to: token, title: a.title, body: a.body, sound: 'default', priority: 'high', channelId: 'alerts',
        data: { alertId: a.id, patientId: a.patientId, url: (a.data as { url?: string } | null)?.url ?? '/alerts' },
      });
    }
  }
  return messages;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendBatch(fetchFn: FetchLike, messages: unknown[]): Promise<Ticket[]> {
  const s = settings();
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (s.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${s.EXPO_ACCESS_TOKEN}`;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const r = await fetchFn(s.EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(10_000) });
      if (r.status < 500) {
        if (!r.ok) throw new Error(`push http ${r.status}`);
        return ((await r.json()) as { data?: Ticket[] }).data ?? [];
      }
    } catch (e) {
      log.warn('push_http_error', { attempt, error: e instanceof Error ? e.name : 'error' });
    }
    await sleep(2 ** attempt * (settings().ENV === 'test' ? 1 : 1000));
  }
  log.error('push_gave_up', { count: messages.length });
  return [];
}

/** Send push for these alerts. Returns how many messages Expo accepted. */
export async function deliver(alertIds: number[], fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<number> {
  const messages = await buildMessages(alertIds);
  if (!messages.length || !settings().EXPO_PUSH_ENABLED) {
    if (messages.length) log.info('push_disabled', { count: messages.length });
    await alertRepo.markPushed(alertIds, utcnow());
    return 0;
  }
  let ok = 0;
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    const tickets = await sendBatch(fetchFn, chunk);
    chunk.forEach((msg, n) => {
      const t = tickets[n];
      if (t?.status === 'ok') ok++;
      else if (t?.details?.error === 'DeviceNotRegistered') dead.push(msg.to as string);
    });
  }
  if (dead.length) await userRepo.deletePushTokens(dead);
  await alertRepo.markPushed(alertIds, utcnow());
  log.info('push_sent', { ok, removedTokens: dead.length });
  return ok;
}

export interface Consumer {
  stop(): Promise<void>;
}

/** Long-running loop used by the worker. */
export function startPushConsumer(): Consumer {
  let stopped = false;
  // BRPOP blocks its connection, so it gets its own.
  const r = redis().duplicate();
  r.on('error', () => undefined);
  const loop = (async () => {
    while (!stopped) {
      try {
        const item = await r.brpop(PUSH_QUEUE, 2);
        if (!item) continue;
        const ids = [Number(item[1])];
        // Drain what else is waiting so one batch covers a burst.
        while (ids.length < BATCH) {
          const more = await r.rpop(PUSH_QUEUE);
          if (!more) break;
          ids.push(Number(more));
        }
        await deliver(ids);
      } catch (e) {
        if (stopped) break;
        log.exception('push_consumer_error', e);
        await sleep(1000);
      }
    }
  })();
  return {
    async stop() {
      stopped = true;
      r.disconnect();
      await loop.catch(() => undefined);
    },
  };
}
