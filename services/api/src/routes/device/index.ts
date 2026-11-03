/**
 * Fixed ESP32 endpoints. FROZEN contract: load the device-contract skill before editing.
 * Unauthenticated by necessity; only paired device ids are accepted, and every path is rate limited.
 * These are plain Express handlers (not core/http route()) because the firmware, not the app, defines them.
 */
import express, { Router, type RequestHandler } from 'express';
import { settings } from '../../core/config';
import { AppError, ValidationError, tooLarge } from '../../core/errors';
import { getLogger } from '../../core/logger';
import { checkRate } from '../../core/ratelimit';
import * as deviceService from '../../services/deviceService';
import * as scanService from '../../services/scanService';
import { eventIn, scheduleQuery } from '../../schemas/device';

const log = getLogger('device-routes');

export const deviceRouter = Router();

deviceRouter.get('/api/schedule', async (req, res) => {
  const q = scheduleQuery.safeParse(req.query);
  if (!q.success) throw new ValidationError(q.error);
  await checkRate('schedule', q.data.device, 30);
  const device = await deviceService.resolve(q.data.device, { detect: true });
  res.json(await deviceService.getSchedule(device));
});

/** The camera posts a raw JPEG. Anything else is left unparsed and answered with 415 by the handler. */
const rawJpeg: RequestHandler = (req, res, next) =>
  express.raw({ type: (r) => /^image\/jpe?g/i.test(r.headers['content-type'] ?? ''), limit: settings().SCAN_MAX_BYTES })(req, res, (err?: unknown) => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') return next(tooLarge('Image is larger than 2 MB.'));
    next(err);
  });

deviceRouter.post('/api/scan', rawJpeg, async (req, res) => {
  const ident = req.header('X-Device') ?? undefined;
  await checkRate('scan', ident ?? '-', 6);
  try {
    res.json(await scanService.scan(ident, Buffer.isBuffer(req.body) ? req.body : undefined, req.headers['content-type']));
  } catch (e) {
    // The camera gets a real error for a bad request, but never a 5xx: it would just retry into the 15 s limit.
    if (e instanceof AppError) throw e;
    log.exception('scan_failed', e);
    res.json({ found: false });
  }
});

deviceRouter.post('/api/events', express.json({ limit: '16kb' }), async (req, res) => {
  const body = eventIn.safeParse(req.body);
  if (!body.success) {
    // The device id is needed for the rate limit before anything else is trusted.
    throw new ValidationError(body.error);
  }
  await checkRate('events', body.data.device, 120);
  const fresh = await deviceService.recordEvent(body.data);
  res.json(fresh ? { ok: true } : { ok: true, duplicate: true });
});
