/** Caregiver auth: argon2 passwords, JWT access + rotating refresh tokens with reuse detection. */
import type { User } from '@prisma/client';
import { conflict, unauthorized } from '../core/errors';
import { getLogger } from '../core/logger';
import { createToken, decodeToken, hashPassword, needsRehash, verifyPassword } from '../core/security';
import { utcnow } from '../core/timeutil';
import * as userRepo from '../repositories/users';

const log = getLogger('auth');

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
}

let dummyHash: Promise<string> | null = null;

async function issue(userId: number): Promise<Tokens> {
  const access = createToken(userId, 'access');
  const refresh = createToken(userId, 'refresh');
  await userRepo.addRefreshToken(refresh.jti, userId, refresh.expiresAt);
  return { accessToken: access.token, refreshToken: refresh.token, tokenType: 'bearer' };
}

export async function signup(data: { email: string; password: string; name: string }): Promise<Tokens> {
  const email = data.email.toLowerCase();
  if (await userRepo.emailTaken(email)) throw conflict('email_taken', 'An account with this email already exists. Try signing in.');
  const user = await userRepo.create({ email, passwordHash: await hashPassword(data.password), name: data.name.trim() });
  log.info('signup', { userId: user.id });
  return issue(user.id);
}

export async function login(data: { email: string; password: string }): Promise<Tokens> {
  const bad = () => unauthorized('invalid_credentials', 'Email or password is not right.');
  const user = await userRepo.byEmail(data.email.toLowerCase());
  if (!user) {
    dummyHash ??= hashPassword('timing-equaliser-not-a-password');
    await verifyPassword(await dummyHash, data.password); // same work either way
    throw bad();
  }
  if (!(await verifyPassword(user.passwordHash, data.password))) throw bad();
  if (needsRehash(user.passwordHash)) await userRepo.update(user.id, { passwordHash: await hashPassword(data.password) });
  log.info('login', { userId: user.id });
  return issue(user.id);
}

export async function refresh(token: string): Promise<Tokens> {
  const bad = () => unauthorized('invalid_token', 'Please sign in again.');
  const data = decodeToken(token, 'refresh');
  if (!data) throw bad();
  const row = await userRepo.refreshTokenByJti(data.jti);
  if (!row) throw bad();
  // A revoked token (or one revoked a moment ago by a parallel call) is presented again: assume
  // theft and end every session of this user.
  if (row.revokedAt || !(await userRepo.revokeRefreshToken(row.jti, utcnow()))) {
    await userRepo.revokeAllRefreshTokens(row.userId, utcnow());
    log.warn('refresh_reuse_detected', { userId: row.userId });
    throw bad();
  }
  return issue(row.userId);
}

export async function logout(user: User, refreshToken?: string | null, pushToken?: string | null): Promise<void> {
  const data = decodeToken(refreshToken ?? '', 'refresh');
  if (data && Number(data.sub) === user.id) await userRepo.revokeRefreshToken(data.jti, utcnow());
  if (pushToken) await userRepo.deletePushToken(user.id, pushToken);
}
