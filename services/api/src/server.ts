import { createServer } from 'node:http';
import { createApp } from './app';
import { checkProd, settings } from './core/config';
import { getLogger } from './core/logger';
import { disconnect } from './core/prisma';
import { closeRedis } from './core/redis';
import { startPushConsumer } from './jobs/push';
import { runStartupJobs, startScheduler } from './jobs/scheduler';
import { attachWebSocket } from './realtime/wsServer';

const log = getLogger('server');

async function main() {
  checkProd();
  const s = settings();
  const server = createServer(createApp());
  // The camera and WiFi are slow; keep sockets open long enough for a 10 s scan answer.
  server.requestTimeout = 30_000;
  const wss = attachWebSocket(server);
  server.listen(s.PORT, '0.0.0.0', () => log.info('listening', { port: s.PORT, env: s.ENV }));

  let embedded: { stop: () => Promise<void> } | null = null;
  if (s.EMBED_WORKER) {
    const scheduler = startScheduler();
    const consumer = startPushConsumer();
    log.info('embedded_worker_started', { jobs: scheduler.count });
    void runStartupJobs().catch((e) => log.exception('startup_jobs_failed', e));
    embedded = {
      stop: async () => {
        scheduler.stop();
        await consumer.stop();
      },
    };
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    log.info('shutting_down');
    await embedded?.stop();
    wss.clients.forEach((c) => c.close(1001));
    server.close();
    await Promise.allSettled([disconnect(), closeRedis()]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  log.exception('startup_failed', e);
  process.exit(1);
});
