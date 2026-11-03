/** Medicines, inventory and schedules. Schedule ids are the device dose ids. */
import type { Medicine, Schedule } from '@prisma/client';
import { conflict, notFound } from '../core/errors';
import { prisma } from '../core/prisma';
import { dbDate, dbTime, fromDbDate, fromDbTime } from '../core/timeutil';
import * as deviceRepo from '../repositories/devices';
import * as medRepo from '../repositories/medicines';
import * as patientRepo from '../repositories/patients';
import { publish } from '../realtime/publisher';
import type { MedicineCreate, MedicineUpdate, ScheduleCreate, ScheduleUpdate } from '../schemas/medicine';
import * as alertService from './alertService';
import { isExpired } from './deviceService';

const MAX_SCHEDULES_PER_MEDICINE = 8;

export type MedicineFull = medRepo.MedicineWithSchedules;

export function scheduleOut(s: Schedule) {
  return { id: s.id, medicineId: s.medicineId, time: fromDbTime(s.time), daysOfWeek: s.daysOfWeek as number[], active: s.active };
}

export async function toOut(med: MedicineFull) {
  const left = alertService.daysLeft(med.qty, med.doseAmount, alertService.activeScheduleDays(med.schedules));
  return {
    id: med.id,
    patientId: med.patientId,
    name: med.name,
    strength: med.strength,
    form: med.form,
    doseAmount: med.doseAmount,
    doseUnit: med.doseUnit,
    instructions: med.instructions,
    slot: med.slot,
    barcode: med.barcode,
    expiryDate: med.expiryDate ? fromDbDate(med.expiryDate) : null,
    qty: med.qty,
    lowStockThreshold: med.lowStockThreshold,
    refillLeadDays: med.refillLeadDays,
    active: med.active,
    label: alertService.medicineLabel(med),
    lowStock: med.qty <= med.lowStockThreshold || left <= med.refillLeadDays,
    expired: isExpired(med),
    daysLeft: Number.isFinite(left) ? Math.round(left * 10) / 10 : null,
    schedules: med.schedules.map(scheduleOut),
    photoCount: await medRepo.referenceCount(med.id),
  };
}

export async function get(patientId: number, medicineId: number): Promise<MedicineFull> {
  const med = await medRepo.get(patientId, medicineId);
  if (!med || !med.active) throw notFound('not_found', 'Medicine not found.');
  return med;
}

async function checkSlot(patientId: number, slot: number | null | undefined, exclude?: number): Promise<void> {
  if (!slot) return;
  const holder = await medRepo.bySlot(await deviceRepo.sharingIds(patientId), slot, exclude);
  if (!holder) return;
  if (holder.patientId !== patientId) {
    throw conflict('slot_taken', `Slot ${slot} on this VOICE is used by another person. Choose another slot.`);
  }
  throw conflict('slot_taken', `Slot ${slot} already has a medicine. Choose another slot or empty it first.`);
}

export async function list(patientId: number) {
  return Promise.all((await medRepo.listForPatient(patientId)).map(toOut));
}

export async function create(patientId: number, data: MedicineCreate): Promise<MedicineFull> {
  await checkSlot(patientId, data.slot);
  const med = await medRepo.create({
    patientId, name: data.name.trim(), strength: data.strength ?? null, form: data.form ?? null,
    doseAmount: data.doseAmount, doseUnit: data.doseUnit ?? null, instructions: data.instructions ?? null,
    slot: data.slot ?? null, barcode: data.barcode ?? null, expiryDate: data.expiryDate ? dbDate(data.expiryDate) : null,
    qty: data.qty, lowStockThreshold: data.lowStockThreshold, refillLeadDays: data.refillLeadDays,
  });
  await publish(patientId, 'medicine.updated', { medicineId: med.id });
  return get(patientId, med.id);
}

export async function update(patientId: number, medicineId: number, data: MedicineUpdate): Promise<MedicineFull> {
  const med = await get(patientId, medicineId);
  if (data.slot !== undefined) await checkSlot(patientId, data.slot, med.id);
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v === null && ['name', 'doseAmount', 'qty', 'lowStockThreshold', 'refillLeadDays'].includes(k)) continue;
    changes[k] = k === 'expiryDate' ? (v ? dbDate(v as string) : null) : v;
  }
  const created = await prisma.$transaction(async (tx) => {
    const updated = await medRepo.update(med.id, changes, tx);
    if (data.qty !== undefined || data.lowStockThreshold !== undefined) {
      const patient = (await patientRepo.byId(patientId, tx))!;
      return alertService.lowStock(patient, updated as Medicine, tx);
    }
    return new alertService.Created();
  });
  await publish(patientId, 'medicine.updated', { medicineId: med.id });
  await alertService.dispatch(created);
  return get(patientId, med.id);
}

/** Soft delete: keeps intake history; frees the slot; its doses leave the device schedule. */
export async function deactivate(patientId: number, medicineId: number): Promise<void> {
  const med = await get(patientId, medicineId);
  await medRepo.update(med.id, { active: false, slot: null });
  await publish(patientId, 'medicine.updated', { medicineId: med.id });
}

export async function addSchedule(patientId: number, medicineId: number, data: ScheduleCreate): Promise<Schedule> {
  const med = await get(patientId, medicineId);
  if (med.schedules.length >= MAX_SCHEDULES_PER_MEDICINE) {
    throw conflict('too_many_schedules', `A medicine can have at most ${MAX_SCHEDULES_PER_MEDICINE} dose times.`);
  }
  if (med.schedules.some((s) => fromDbTime(s.time) === data.time)) {
    throw conflict('schedule_exists', 'This medicine already has a dose at that time.');
  }
  const sched = await medRepo.createSchedule({
    medicineId: med.id, time: dbTime(data.time), daysOfWeek: data.daysOfWeek, active: data.active, createdAt: new Date(),
  });
  await publish(patientId, 'medicine.updated', { medicineId: med.id });
  return sched;
}

async function findSchedule(patientId: number, medicineId: number, scheduleId: number): Promise<Schedule> {
  const s = await medRepo.scheduleFor(patientId, medicineId, scheduleId);
  if (!s) throw notFound('not_found', 'Dose time not found.');
  return s;
}

export async function updateSchedule(patientId: number, medicineId: number, scheduleId: number, data: ScheduleUpdate): Promise<Schedule> {
  await findSchedule(patientId, medicineId, scheduleId);
  const sched = await medRepo.updateSchedule(scheduleId, {
    ...(data.time ? { time: dbTime(data.time) } : {}),
    ...(data.daysOfWeek ? { daysOfWeek: data.daysOfWeek } : {}),
    ...(data.active != null ? { active: data.active } : {}),
  });
  await publish(patientId, 'medicine.updated', { medicineId });
  return sched;
}

export async function deleteSchedule(patientId: number, medicineId: number, scheduleId: number): Promise<void> {
  await findSchedule(patientId, medicineId, scheduleId);
  await medRepo.deleteSchedule(scheduleId);
  await publish(patientId, 'medicine.updated', { medicineId });
}
