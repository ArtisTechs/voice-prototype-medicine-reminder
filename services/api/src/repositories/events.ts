import type { IntakeRecord, Prisma } from '@prisma/client';
import { isUniqueViolation, prisma, type Db } from '../core/prisma';
import { dbDate, dbTime } from '../core/timeutil';

/** Returns the new id, or null when the event is a duplicate (idempotency key hit). */
export async function insertEvent(data: Prisma.DeviceEventUncheckedCreateInput, db: Db = prisma): Promise<number | null> {
  try {
    return (await db.deviceEvent.create({ data, select: { id: true } })).id;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

export const deleteEventsBefore = async (before: Date) =>
  (await prisma.deviceEvent.deleteMany({ where: { receivedAt: { lt: before } } })).count;

// ---- intake records --------------------------------------------------------------------------

export const getIntake = (scheduleId: number, day: string, db: Db = prisma) =>
  db.intakeRecord.findUnique({ where: { scheduleId_doseDate: { scheduleId, doseDate: dbDate(day) } } });

/** Insert-or-fetch: concurrent events for one dose end up on the same row. */
export async function ensureIntake(
  data: { patientId: number; medicineId: number; scheduleId: number; day: string; time: string; status: string; dueAt?: Date; source?: string },
  db: Db = prisma,
): Promise<{ record: IntakeRecord; created: boolean }> {
  try {
    const record = await db.intakeRecord.create({
      data: {
        patientId: data.patientId, medicineId: data.medicineId, scheduleId: data.scheduleId,
        doseDate: dbDate(data.day), scheduledTime: dbTime(data.time), status: data.status,
        dueAt: data.dueAt, source: data.source ?? 'device',
      },
    });
    return { record, created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const record = await getIntake(data.scheduleId, data.day, db);
    if (!record) throw e;
    return { record, created: false };
  }
}

export const updateIntake = (id: number, data: Prisma.IntakeRecordUncheckedUpdateInput, db: Db = prisma) =>
  db.intakeRecord.update({ where: { id }, data });

export const intakesForDay = (patientId: number, day: string, db: Db = prisma) =>
  db.intakeRecord.findMany({ where: { patientId, doseDate: dbDate(day) } });

export const intakesBetween = (patientId: number, start: string, end: string, db: Db = prisma) =>
  db.intakeRecord.findMany({
    where: { patientId, doseDate: { gte: dbDate(start), lte: dbDate(end) } },
    orderBy: [{ doseDate: 'asc' }, { scheduledTime: 'asc' }, { id: 'asc' }],
  });
