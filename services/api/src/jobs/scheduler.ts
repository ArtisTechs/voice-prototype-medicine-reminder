/** node-cron setup. Jobs call services; the alert rules live in services/alertService.ts. */
import cron from 'node-cron';
import { settings } from '../core/config';
import { getLogger } from '../core/logger';
import * as alertService from '../services/alertService';
import * as monitor from '../services/monitorService';
import { withLock } from './locks';

const log = getLogger('jobs');

type JobFn = () => Promise<alertService.Created | { [k: string]: number } | void>;

/** One run at a time across workers; errors are logged, never raised. */
export function job(name: string, fn: JobFn, ttl = 300): () => Promise<void> {
  return async () => {
    await withLock(name, ttl, async (mine) => {
      if (!mine) return;
      const t0 = Date.now();
      try {
        const result = await fn();
        let created = 0;
        if (result instanceof alertService.Created) {
          created = result.count;
          await alertService.dispatch(result);
        }
        log.info('job_done', { job: name, ms: Date.now() - t0, created });
      } catch (e) {
        log.exception('job_failed', e, { job: name });
      }
    });
  };
}

export const JOBS = {
  reconcileMissed: job('reconcile_missed', () => monitor.reconcileMissed()),
  offline: job('offline', () => monitor.offlineDevices()),
  inventory: job('inventory', () => monitor.inventory()),
  expiry: job('expiry', () => monitor.expiry()),
  cleanup: job('cleanup', () => monitor.cleanup(), 1800),
};

export function startScheduler(): { stop(): void; count: number } {
  const timezone = settings().DEVICE_TZ;
  const tasks = [
    cron.schedule('* * * * *', JOBS.reconcileMissed, { timezone }),
    cron.schedule('* * * * *', JOBS.offline, { timezone }),
    cron.schedule('0 9 * * *', JOBS.inventory, { timezone }),
    cron.schedule('0 */6 * * *', JOBS.inventory, { timezone }),
    cron.schedule('30 8 * * *', JOBS.expiry, { timezone }),
    cron.schedule('0 3 * * *', JOBS.cleanup, { timezone }),
  ];
  return { count: tasks.length, stop: () => tasks.forEach((t) => t.stop()) };
}

/** Catch up after downtime: expiry buckets and stock are checked once at start. */
export async function runStartupJobs(): Promise<void> {
  await JOBS.expiry();
  await JOBS.inventory();
}
