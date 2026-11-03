import type { Prisma, User } from '@prisma/client';
import { prisma, type Db } from '../core/prisma';
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs } from '../schemas/auth';

export const byId = (id: number) => prisma.user.findUnique({ where: { id } });
export const byEmail = (email: string, db: Db = prisma) => db.user.findUnique({ where: { email } });
export const emailTaken = async (email: string) => (await prisma.user.count({ where: { email } })) > 0;

export const create = (data: Omit<Prisma.UserUncheckedCreateInput, 'notifyPrefs'> & { notifyPrefs?: object }) =>
  prisma.user.create({ data: { ...data, notifyPrefs: data.notifyPrefs ?? { ...DEFAULT_NOTIFY_PREFS } } });

export const update = (id: number, data: Prisma.UserUpdateInput) => prisma.user.update({ where: { id }, data });
export const remove = (id: number, db: Db = prisma) => db.user.delete({ where: { id } });

/** Does this caregiver want alerts of this type? Missing keys fall back to the defaults. */
export function pref(user: Pick<User, 'notifyPrefs'>, key: keyof NotifyPrefs): boolean {
  const merged = { ...DEFAULT_NOTIFY_PREFS, ...((user.notifyPrefs as Partial<NotifyPrefs> | null) ?? {}) };
  return Boolean(merged[key] ?? true);
}

// ---- refresh tokens --------------------------------------------------------------------------

export const addRefreshToken = (jti: string, userId: number, expiresAt: Date) =>
  prisma.refreshToken.create({ data: { jti, userId, expiresAt } });

export const refreshTokenByJti = (jti: string) => prisma.refreshToken.findUnique({ where: { jti } });

/** Revokes a live token. Returns false if someone else revoked it first (race or reuse). */
export async function revokeRefreshToken(jti: string, at: Date): Promise<boolean> {
  const res = await prisma.refreshToken.updateMany({ where: { jti, revokedAt: null }, data: { revokedAt: at } });
  return res.count === 1;
}

export const revokeAllRefreshTokens = (userId: number, at: Date) =>
  prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });

export const deleteExpiredRefreshTokens = (before: Date) =>
  prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: before } } });

// ---- push tokens -----------------------------------------------------------------------------

export const upsertPushToken = (userId: number, token: string, platform: string) =>
  prisma.pushToken.upsert({ where: { token }, create: { userId, token, platform }, update: { userId, platform } });

export const deletePushToken = (userId: number, token: string) => prisma.pushToken.deleteMany({ where: { userId, token } });
export const pushTokensForUsers = (userIds: number[]) => prisma.pushToken.findMany({ where: { userId: { in: userIds } } });
export const deletePushTokens = (tokens: string[]) => prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
