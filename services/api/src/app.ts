import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { settings } from './core/config';
import { deviceSecret } from './core/deviceSecret';
import { docsRouter } from './core/docs';
import { errorHandler, notFoundHandler } from './core/errors';
import { getLogger } from './core/logger';
import { prisma } from './core/prisma';
import { redis } from './core/redis';
import { deviceRouter } from './routes/device';
import { v1Router } from './routes/v1';

const log = getLogger('app');

export function createApp(): Express {
  const s = settings();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal'); // Caddy / Docker network

  app.use(deviceSecret); // first, so the secret never reaches routing or logs
  if (!s.ENABLE_DOCS) app.use(helmet());
  app.use(cors({ origin: s.corsOrigins, credentials: true }));

  app.get('/healthz', async (_req, res) => {
    let db = false;
    let redisOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      log.warn('health_db_failed');
    }
    try {
      redisOk = (await redis().ping()) === 'PONG';
    } catch {
      log.warn('health_redis_failed');
    }
    const ok = db && redisOk;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', db, redis: redisOk });
  });

  if (s.ENABLE_DOCS) app.use(docsRouter());
  app.use(deviceRouter);
  app.use('/api/v1', v1Router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
