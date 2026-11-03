import type { Device, Patient } from '@prisma/client';
import { prisma, type Db } from '../core/prisma';

export const byAnyId = (ident: string, db: Db = prisma) =>
  db.device.findFirst({ where: { OR: [{ deviceId: ident }, { cameraId: ident }] } });

export const byDeviceId = (deviceId: string, db: Db = prisma) => db.device.findUnique({ where: { deviceId } });
export const byCameraId = (cameraId: string, db: Db = prisma) => db.device.findUnique({ where: { cameraId } });

export const forPatient = (patientId: number, db: Db = prisma) =>
  db.device.findFirst({ where: { patients: { some: { id: patientId } } } });

/** Everyone who uses this device, first-paired first. */
export const patientsOn = (devicePk: number, db: Db = prisma): Promise<Patient[]> =>
  db.patient.findMany({ where: { deviceId: devicePk }, orderBy: { id: 'asc' } });

/** The patient plus everyone on the same device (they share its slots). */
export async function sharingIds(patientId: number, db: Db = prisma): Promise<number[]> {
  const p = await db.patient.findUnique({ where: { id: patientId }, select: { deviceId: true } });
  if (!p?.deviceId) return [patientId];
  const rows = await db.patient.findMany({ where: { deviceId: p.deviceId }, select: { id: true } });
  return rows.map((r) => r.id);
}

export const seenSince = (since: Date) => prisma.device.findMany({ where: { lastSeen: { gte: since } } });

export const forPatients = (patientIds: number[]) =>
  patientIds.length ? prisma.device.findMany({ where: { patients: { some: { id: { in: patientIds } } } } }) : Promise.resolve([] as Device[]);

export const create = (deviceId: string, cameraId: string, db: Db = prisma) =>
  db.device.create({ data: { deviceId, cameraId, slotState: {} } });

export const setCamera = (id: number, cameraId: string, db: Db = prisma) => db.device.update({ where: { id }, data: { cameraId } });

/** A device nobody uses any more is deleted. */
export async function deleteIfUnused(devicePk: number | null, db: Db = prisma): Promise<void> {
  if (devicePk == null) return;
  await db.device.deleteMany({ where: { id: devicePk, patients: { none: {} } } });
}

export async function touch(id: number, now: Date, camera = false, db: Db = prisma): Promise<void> {
  await db.device.update({ where: { id }, data: camera ? { cameraLastSeen: now } : { lastSeen: now } });
}

export const setSlotState = (id: number, slotState: object, db: Db = prisma) =>
  db.device.update({ where: { id }, data: { slotState } });

export const stale = (before: Date) => prisma.device.findMany({ where: { lastSeen: { not: null, lt: before } } });
