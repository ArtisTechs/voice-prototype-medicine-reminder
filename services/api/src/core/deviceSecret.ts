/**
 * Optional secret prefix for the ESP32 paths when the server is on the internet.
 *
 * The firmware only sends a fixed device id, so anyone who finds the server could post fake dose
 * events. With DEVICE_PATH_SECRET set, the device's BACKEND_URL becomes http://<host>:5055/d/<secret>;
 * the bare /api/schedule, /api/scan and /api/events answer 404. The secret is stripped here, before
 * anything can log the path.
 */
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { settings } from './config';
import { errorBody } from './errors';

const DEVICE_PATHS = new Set(['/api/schedule', '/api/scan', '/api/events']);

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const deviceSecret: RequestHandler = (req, res, next) => {
  const secret = settings().DEVICE_PATH_SECRET;
  if (!secret) return next();
  const [path, query = ''] = req.url.split('?', 2) as [string, string?];
  const notFound = () => res.status(404).json(errorBody('not_found', 'Not found.'));
  if (path.startsWith('/d/')) {
    const rest = path.slice(3);
    const slash = rest.indexOf('/');
    const given = slash === -1 ? rest : rest.slice(0, slash);
    const target = slash === -1 ? '' : rest.slice(slash);
    if (same(given, secret) && DEVICE_PATHS.has(target)) {
      req.url = target + (query ? `?${query}` : '');
      return next();
    }
    return notFound();
  }
  if (DEVICE_PATHS.has(path)) return notFound();
  next();
};
