import { Router } from 'express';
import { route } from '../../core/http';
import { checkRate } from '../../core/ratelimit';
import { loginIn, logoutIn, refreshIn, signupIn } from '../../schemas/auth';
import * as authService from '../../services/authService';

export const authRouter = Router();

const ip = (req: { ip?: string }) => req.ip ?? '-';

route(authRouter, 'post', '/auth/signup', { tag: 'auth', summary: 'Create a caregiver account', auth: false, body: signupIn, status: 201 }, async ({ req, body }) => {
  await checkRate('signup', ip(req), 10);
  return authService.signup(body);
});

route(authRouter, 'post', '/auth/login', { tag: 'auth', summary: 'Sign in', auth: false, body: loginIn }, async ({ req, body }) => {
  await checkRate('login', ip(req), 10);
  return authService.login(body);
});

route(authRouter, 'post', '/auth/refresh', { tag: 'auth', summary: 'Swap a refresh token for new tokens', auth: false, body: refreshIn }, async ({ req, body }) => {
  await checkRate('refresh', ip(req), 30);
  return authService.refresh(body.refreshToken);
});

route(authRouter, 'post', '/auth/logout', { tag: 'auth', summary: 'Sign out (revokes the refresh token)', body: logoutIn, status: 204 }, async ({ user, body }) => {
  await authService.logout(user, body.refreshToken, body.pushToken);
});
