import type { Patient, PatientCaregiver, User } from '@prisma/client';
import { prisma, type Db } from '../core/prisma';

export const link = (userId: number, patientId: number, db: Db = prisma) =>
  db.patientCaregiver.findUnique({ where: { patientId_userId: { patientId, userId } } });

export const byId = (id: number, db: Db = prisma) => db.patient.findUnique({ where: { id } });

export async function forUser(userId: number): Promise<{ patient: Patient; role: string }[]> {
  const rows = await prisma.patientCaregiver.findMany({
    where: { userId },
    include: { patient: true },
    orderBy: { patientId: 'asc' },
  });
  return rows.map((r) => ({ patient: r.patient, role: r.role }));
}

export async function patientIdsForUser(userId: number): Promise<number[]> {
  const rows = await prisma.patientCaregiver.findMany({ where: { userId }, select: { patientId: true } });
  return rows.map((r) => r.patientId);
}

export async function caregivers(patientId: number, db: Db = prisma): Promise<{ user: User; role: string }[]> {
  const rows = await db.patientCaregiver.findMany({
    where: { patientId },
    include: { user: true },
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
  });
  return rows.map((r) => ({ user: r.user, role: r.role }));
}

export const caregiverCount = (patientId: number, db: Db = prisma) => db.patientCaregiver.count({ where: { patientId } });

export const create = (displayName: string, note: string | null | undefined, db: Db = prisma) =>
  db.patient.create({ data: { displayName, note: note ?? null } });

export const update = (id: number, data: { displayName?: string; note?: string | null }, db: Db = prisma) =>
  db.patient.update({ where: { id }, data });

export const remove = (id: number, db: Db = prisma) => db.patient.delete({ where: { id } });

export const addCaregiver = (patientId: number, userId: number, role: 'owner' | 'member', db: Db = prisma) =>
  db.patientCaregiver.create({ data: { patientId, userId, role } });

export const removeCaregiver = (patientId: number, userId: number, db: Db = prisma) =>
  db.patientCaregiver.delete({ where: { patientId_userId: { patientId, userId } } });

export const setRole = (patientId: number, userId: number, role: 'owner' | 'member', db: Db = prisma) =>
  db.patientCaregiver.update({ where: { patientId_userId: { patientId, userId } }, data: { role } });

export const setDevice = (patientId: number, deviceId: number | null, db: Db = prisma) =>
  db.patient.update({ where: { id: patientId }, data: { deviceId } });

export type { PatientCaregiver };

// ---- invites ---------------------------------------------------------------------------------

export const createInvite = (data: { patientId: number; code: string; createdBy: number; expiresAt: Date }, db: Db = prisma) =>
  db.invite.create({ data });

export const inviteByCode = (code: string, db: Db = prisma) => db.invite.findUnique({ where: { code } });

/** Marks a live invite used. False when someone used it first. */
export async function useInvite(id: number, userId: number, at: Date, db: Db = prisma): Promise<boolean> {
  const res = await db.invite.updateMany({ where: { id, usedAt: null }, data: { usedBy: userId, usedAt: at } });
  return res.count === 1;
}

export const deleteInvitesExpiredBefore = (before: Date) => prisma.invite.deleteMany({ where: { expiresAt: { lt: before } } });
