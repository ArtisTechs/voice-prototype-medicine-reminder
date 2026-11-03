import { Router } from 'express';
import { route } from '../../core/http';
import { notFound } from '../../core/errors';
import { utcnow } from '../../core/timeutil';
import * as alertRepo from '../../repositories/alerts';
import { publishUser } from '../../realtime/publisher';
import { alertsQuery } from '../../schemas/auth';

export const alertsRouter = Router();

route(alertsRouter, 'get', '/alerts', { tag: 'alerts', summary: 'My alert inbox', query: alertsQuery }, async ({ user, query }) => {
  const { total, items } = await alertRepo.list(user.id, { unread: query.unread, patientId: query.patientId, limit: query.limit, offset: query.offset });
  return {
    items: items.map((a) => ({
      id: a.id, patientId: a.patientId, type: a.type, severity: a.severity, title: a.title, body: a.body, data: a.data,
      readAt: a.readAt, createdAt: a.createdAt,
    })),
    total, limit: query.limit, offset: query.offset,
  };
});

route(alertsRouter, 'post', '/alerts/read-all', { tag: 'alerts', summary: 'Mark every alert read', status: 204 }, async ({ user }) => {
  await alertRepo.markAllRead(user.id, utcnow());
  await publishUser(user.id, 'alert.read');
});

route(alertsRouter, 'post', '/alerts/:alertId/read', { tag: 'alerts', summary: 'Mark one alert read', status: 204 }, async ({ user, params }) => {
  const changed = await alertRepo.markRead(user.id, params.alertId, utcnow());
  if (changed === 0 && !(await alertRepo.exists(user.id, params.alertId))) throw notFound('not_found', 'Alert not found.');
  await publishUser(user.id, 'alert.read');
});
