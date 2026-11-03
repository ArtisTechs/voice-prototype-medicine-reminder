import type { Medicine, Prisma, ReferenceImage, Schedule } from '@prisma/client';
import { prisma, type Db } from '../core/prisma';

export type MedicineWithSchedules = Prisma.MedicineGetPayload<{ include: { schedules: true } }>;

const withSchedules = { schedules: { orderBy: [{ time: 'asc' as const }, { id: 'asc' as const }] } };

export const get = (patientId: number, id: number, db: Db = prisma): Promise<MedicineWithSchedules | null> =>
  db.medicine.findFirst({ where: { id, patientId }, include: withSchedules });

export const byId = (id: number, db: Db = prisma) => db.medicine.findUnique({ where: { id } });

export async function listForPatient(patientId: number, activeOnly = true, db: Db = prisma): Promise<MedicineWithSchedules[]> {
  const rows = await db.medicine.findMany({
    where: { patientId, ...(activeOnly ? { active: true } : {}) },
    include: withSchedules,
  });
  // Slotted medicines first (by slot), then the rest by name.
  return rows.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.name.localeCompare(b.name));
}

/** The active medicine in `slot` among people who share one device (slots are physical). */
export const bySlot = (patientIds: number[], slot: number, excludeId?: number, db: Db = prisma) =>
  db.medicine.findFirst({
    where: { patientId: { in: patientIds }, slot, active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { id: 'asc' },
  });

export async function usedSlots(patientIds: number[], db: Db = prisma): Promise<Set<number>> {
  const rows = await db.medicine.findMany({
    where: { patientId: { in: patientIds }, slot: { not: null }, active: true },
    select: { slot: true },
  });
  return new Set(rows.map((r) => r.slot as number));
}

/**
 * Active schedules of active, slotted medicines that run on `weekday` (Mon=0), sorted by time then slot.
 * Pass every person on a shared device to get that device's whole schedule.
 */
export async function deviceDoses(patientIds: number[], weekday: number, db: Db = prisma): Promise<{ schedule: Schedule; medicine: Medicine }[]> {
  if (!patientIds.length) return [];
  const rows = await db.schedule.findMany({
    where: { active: true, medicine: { patientId: { in: patientIds }, active: true, slot: { not: null } } },
    include: { medicine: true },
  });
  return rows
    .filter((s) => (s.daysOfWeek as number[]).includes(weekday))
    .map(({ medicine, ...schedule }) => ({ schedule: schedule as Schedule, medicine }))
    .sort(
      (a, b) =>
        a.schedule.time.getTime() - b.schedule.time.getTime() ||
        (a.medicine.slot ?? 0) - (b.medicine.slot ?? 0) ||
        a.schedule.id - b.schedule.id,
    );
}

export const getSchedule = async (scheduleId: number, db: Db = prisma) => {
  const row = await db.schedule.findUnique({ where: { id: scheduleId }, include: { medicine: true } });
  if (!row) return null;
  const { medicine, ...schedule } = row;
  return { schedule: schedule as Schedule, medicine };
};

export const scheduleFor = (patientId: number, medicineId: number, scheduleId: number, db: Db = prisma) =>
  db.schedule.findFirst({ where: { id: scheduleId, medicineId, medicine: { patientId } } });

export const allActive = (db: Db = prisma): Promise<MedicineWithSchedules[]> =>
  db.medicine.findMany({ where: { active: true }, include: withSchedules });

export const expiringCandidates = (db: Db = prisma) =>
  db.medicine.findMany({ where: { active: true, expiryDate: { not: null } } });

export const create = (data: Prisma.MedicineUncheckedCreateInput, db: Db = prisma) => db.medicine.create({ data });
export const update = (id: number, data: Prisma.MedicineUncheckedUpdateInput, db: Db = prisma) => db.medicine.update({ where: { id }, data });

/** qty - dose_amount, never below zero, in one statement so concurrent events cannot lose a decrement. */
export async function decrementQty(id: number, db: Db = prisma): Promise<void> {
  await db.$executeRaw`UPDATE medicines SET qty = GREATEST(qty - dose_amount, 0) WHERE id = ${id}`;
}

export const createSchedule = (data: Prisma.ScheduleUncheckedCreateInput, db: Db = prisma) => db.schedule.create({ data });
export const updateSchedule = (id: number, data: Prisma.ScheduleUncheckedUpdateInput, db: Db = prisma) => db.schedule.update({ where: { id }, data });
export const deleteSchedule = (id: number, db: Db = prisma) => db.schedule.delete({ where: { id } });

// ---- reference photos --------------------------------------------------------------------------

export const referenceImages = (medicineId: number, db: Db = prisma): Promise<ReferenceImage[]> =>
  db.referenceImage.findMany({ where: { medicineId }, orderBy: { id: 'asc' } });

export const referenceCount = (medicineId: number, db: Db = prisma) => db.referenceImage.count({ where: { medicineId } });
export const addReference = (data: { medicineId: number; angle: string; path: string }, db: Db = prisma) => db.referenceImage.create({ data });
export const referenceById = (medicineId: number, id: number, db: Db = prisma) => db.referenceImage.findFirst({ where: { id, medicineId } });
export const deleteReference = (id: number, db: Db = prisma) => db.referenceImage.delete({ where: { id } });
export const firstReferences = (medicineIds: number[], db: Db = prisma) =>
  db.referenceImage.findMany({ where: { medicineId: { in: medicineIds } }, orderBy: { id: 'asc' } });
