import type { User } from '@prisma/client';
import { Router } from 'express';
import { route } from '../../core/http';
import { meUpdate, prefsToApi, prefsToDb, pushTokenIn } from '../../schemas/auth';
import * as userRepo from '../../repositories/users';
import * as patientService from '../../services/patientService';

export const meRouter = Router();

const out = (u: User) => ({
  id: u.id, email: u.email, name: u.name, timezone: u.timezone, notifyPrefs: prefsToApi(u.notifyPrefs), createdAt: u.createdAt,
});

route(meRouter, 'get', '/me', { tag: 'me', summary: 'My profile and notification settings' }, async ({ user }) => out(user));

route(meRouter, 'patch', '/me', { tag: 'me', summary: 'Update my profile', body: meUpdate }, async ({ user, body }) =>
  out(
    await userRepo.update(user.id, {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      ...(body.notifyPrefs ? { notifyPrefs: prefsToDb(body.notifyPrefs) } : {}),
    }),
  ),
);

/** Delete on request: account, tokens, alerts and every patient nobody else looks after. */
route(meRouter, 'delete', '/me', { tag: 'me', summary: 'Delete my account and data', status: 204 }, async ({ user }) => {
  await patientService.deleteAccount(user);
});

route(meRouter, 'post', '/me/push-tokens', { tag: 'me', summary: 'Register an Expo push token', body: pushTokenIn, status: 204 }, async ({ user, body }) => {
  await userRepo.upsertPushToken(user.id, body.token, body.platform);
});
