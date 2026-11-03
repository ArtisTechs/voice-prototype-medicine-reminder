/**
 * WebSocket fan-out: Redis pub/sub channels -> one socket per app session.
 * Messages are refetch hints ({type, patientId, data, ts}); the app invalidates its queries.
 */
import { getLogger } from '../core/logger';
import { newSubscriber } from '../core/redis';
import { patientChannel, userChannel } from './publisher';

const log = getLogger('hub');
const PING_MS = 25_000;

/** The bits of a `ws` WebSocket the hub needs (lets tests use a fake). */
export interface Socket {
  send(data: string): void;
  onClose(cb: () => void): void;
}

/** Resolves when the socket closes. */
export async function serve(
  socket: Socket,
  userId: number,
  loadPatientIds: () => Promise<number[]>,
  pingMs = PING_MS,
): Promise<void> {
  const sub = newSubscriber();
  const subscribed = new Set<string>();
  let closed = false;

  const syncChannels = async () => {
    const wanted = new Set([userChannel(userId), ...(await loadPatientIds()).map(patientChannel)]);
    const gone = [...subscribed].filter((c) => !wanted.has(c));
    const added = [...wanted].filter((c) => !subscribed.has(c));
    if (gone.length) await sub.unsubscribe(...gone);
    if (added.length) await sub.subscribe(...added);
    subscribed.clear();
    wanted.forEach((c) => subscribed.add(c));
  };

  sub.on('message', (_channel: string, data: string) => {
    if (closed) return;
    try {
      if ((JSON.parse(data) as { type?: string }).type === 'patients.changed') void syncChannels().catch(() => undefined);
    } catch {
      /* not JSON: forward anyway */
    }
    socket.send(data);
  });

  await syncChannels();
  const ping = setInterval(() => !closed && socket.send(JSON.stringify({ type: 'ping' })), pingMs);

  await new Promise<void>((resolve) => socket.onClose(resolve));
  closed = true;
  clearInterval(ping);
  log.info('ws_closed');
  sub.disconnect();
}
