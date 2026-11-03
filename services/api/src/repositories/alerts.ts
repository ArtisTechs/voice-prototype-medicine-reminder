import type { Prisma } from '@prisma/client';
import { isUniqueViolation, prisma, type Db } from '../core/prisma';

/** Inserts one alert; null when this caregiver already has one with the same dedup key. */
export async function insertDedup(data: Prisma.AlertUncheckedCreateInput, db: Db = prisma): Promise<number | null> {
  try {
    return (await db.alert.create({ data, select: { id: true } })).id;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

export async function list(userId: number, opts: { unread?: boolean; patientId?: number; limit: number; offset: number }) {
  const where: Prisma.AlertWhereInput = {
    userId,
    ...(opts.unread ? { readAt: null } : {}),
    ...(opts.patientId ? { patientId: opts.patientId } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: opts.limit, skip: opts.offset }),
  ]);
  return { total, items };
}

export const exists = async (userId: number, id: number) => (await prisma.alert.count({ where: { id, userId } })) > 0;

export const markRead = async (userId: number, id: number, at: Date) =>
  (await prisma.alert.updateMany({ where: { id, userId, readAt: null }, data: { readAt: at } })).count;

export const markAllRead = (userId: number, at: Date) =>
  prisma.alert.updateMany({ where: { userId, readAt: null }, data: { readAt: at } });

export async function unreadByPatient(userId: number): Promise<Map<number | null, number>> {
  const rows = await prisma.alert.groupBy({ by: ['patientId'], where: { userId, readAt: null }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.patientId, r._count._all]));
}

export const unpushedByIds = (ids: number[]) => prisma.alert.findMany({ where: { id: { in: ids }, pushedAt: null } });
export const markPushed = (ids: number[], at: Date) => prisma.alert.updateMany({ where: { id: { in: ids } }, data: { pushedAt: at } });
export const deleteBefore = async (before: Date) => (await prisma.alert.deleteMany({ where: { createdAt: { lt: before } } })).count;
