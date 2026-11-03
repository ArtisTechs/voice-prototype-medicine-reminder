/** Worker entrypoint: node-cron jobs + the Expo push consumer. Same code and image as the API. */
import { settings } from './core/config';
import { getLogger } from './core/logger';
import { disconnect } from './core/prisma';
import { closeRedis } from './core/redis';
import { startPushConsumer } from './jobs/push';
import { runStartupJobs, startScheduler } from './jobs/scheduler';

const log = getLogger('worker');

async function main() {
  settings();
  const scheduler = startScheduler();
  log.info('worker_started', { jobs: scheduler.count });
  await runStartupJobs();
  const consumer = startPushConsumer();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    scheduler.stop();
    await consumer.stop();
    await Promise.allSettled([disconnect(), closeRedis()]);
    log.info('worker_stopped');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  log.exception('worker_failed', e);
  process.exit(1);
});
