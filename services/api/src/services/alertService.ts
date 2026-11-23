/**
 * All alert rules live here (see notifications-jobs skill).
 *
 * Flow: raiseAlert() inserts rows (deduplicated per caregiver) and returns the new ids. After the
 * caller's work is done it runs dispatch() to publish realtime + queue push.
 */
import type { Medicine, Patient, Schedule } from '@prisma/client';
import { getLogger } from '../core/logger';
import { redis } from '../core/redis';
import { daysBetween, deviceToday, fmtTime } from '../core/timeutil';
import * as alertRepo from '../repositories/alerts';
import * as patientRepo from '../repositories/patients';
import * as userRepo from '../repositories/users';
import { prisma, type Db } from '../core/prisma';
import { publish, publishUser } from '../realtime/publisher';
import type { NotifyPrefs } from '../schemas/auth';

const log = getLogger('alerts');

export const PUSH_QUEUE = 'push:queue';

const SEVERITY: Record<string, string> = {
  missed: 'high', expired_dose: 'high', offline: 'high', low_stock: 'normal', expiry: 'normal', scan_unknown: 'normal', taken: 'info',
};

export interface CreatedItem {
  patientId: number | null;
  userId: number;
  alertId: number;
}

/** New alert ids, dispatched after the work is committed. */
export class Created {
  items: CreatedItem[] = [];
  extend(other: Created): void {
    this.items.push(...other.items);
  }
  get count(): number {
    return this.items.length;
  }
  get any(): boolean {
    return this.items.length > 0;
  }
}

const label = (m: Pick<Medicine, 'name' | 'strength'>) => (m.strength ? `${m.name} ${m.strength}`.trim() : m.name);
export { label as medicineLabel };

async function raiseAlert(
  patient: Patient,
  type: keyof NotifyPrefs,
  dedupKey: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  med?: Medicine,
  db: Db = prisma,
): Promise<Created> {
  const created = new Created();
  // `{med}` in title/body is replaced per caregiver, honouring the hide-medicine-names preference.
  for (const { user } of await patientRepo.caregivers(patient.id, db)) {
    if (!userRepo.pref(user, type)) continue;
    const word = med ? (userRepo.pref(user, 'hide_medicine_names') ? 'a medicine' : label(med)) : '';
    const alertId = await alertRepo.insertDedup(
      {
        userId: user.id,
        patientId: patient.id,
        type,
        severity: SEVERITY[type] ?? 'normal',
        title: title.replaceAll('{med}', word).slice(0, 120),
        body: body.replaceAll('{med}', word).slice(0, 300),
        data: { patientId: patient.id, url: `/patients/${patient.id}`, ...data } as object,
        dedupKey,
        createdAt: new Date(),
      },
      db,
    );
    if (alertId) created.items.push({ patientId: patient.id, userId: user.id, alertId });
  }
  return created;
}

/** After the work is committed: realtime hint to the patient's caregivers + queue push for the worker. */
export async function dispatch(created: Created): Promise<void> {
  if (!created.any) return;
  for (const patientId of new Set(created.items.map((i) => i.patientId).filter((p): p is number => p != null))) {
    await publish(patientId, 'alert.created');
  }
  for (const item of created.items) {
    if (item.patientId == null) await publishUser(item.userId, 'alert.created');
    try {
      await redis().lpush(PUSH_QUEUE, String(item.alertId));
    } catch {
      log.warn('push_queue_failed', { alertId: item.alertId });
    }
  }
  log.info('alerts_created', { count: created.count });
}

// ---- rules -------------------------------------------------------------------------------------

export const missed = (patient: Patient, med: Medicine, scheduleId: number, day: string, time: string, db?: Db) =>
  raiseAlert(
    patient, 'missed', `missed:${scheduleId}:${day}`, `${patient.displayName} missed a dose`,
    `${patient.displayName} missed {med} (${fmtTime(time)}).`, { scheduleId, date: day }, med, db,
  );

export const taken = (patient: Patient, med: Medicine, scheduleId: number, day: string, time: string, delay: number, db?: Db) =>
  raiseAlert(
    patient, 'taken', `taken:${scheduleId}:${day}`, `${patient.displayName} took a dose`,
    `${patient.displayName} took {med} (${fmtTime(time)}${delay > 0 ? `, ${delay} min late` : ''}).`,
    { scheduleId, date: day }, med, db,
  );

export const expiredDose = (patient: Patient, med: Medicine, scheduleId: number, day: string, time: string, db?: Db) =>
  raiseAlert(
    patient, 'expired_dose', `expdose:${scheduleId}:${day}`, 'Expired medicine is due',
    `{med} is past its expiry date and was due at ${fmtTime(time)}. Please replace it.`, { medicineId: med.id }, med, db,
  );

/** Pills left / pills used per day. Infinity when nothing is scheduled. */
export function daysLeft(qty: number, doseAmount: number, scheduleDays: number[][]): number {
  const perDay = doseAmount * scheduleDays.reduce((sum, d) => sum + new Set(d).size / 7, 0);
  return perDay <= 0 ? Infinity : qty / perDay;
}

export const activeScheduleDays = (schedules: Pick<Schedule, 'daysOfWeek' | 'active'>[]): number[][] =>
  schedules.filter((s) => s.active).map((s) => s.daysOfWeek as number[]);

/** Low stock or refill reminder: qty <= threshold or days left <= refill lead time. Once a day. */
export async function lowStock(patient: Patient, med: Medicine, db: Db = prisma): Promise<Created> {
  const scheds = await db.schedule.findMany({ where: { medicineId: med.id, active: true } });
  const left = daysLeft(med.qty, med.doseAmount, activeScheduleDays(scheds));
  if (med.qty > med.lowStockThreshold && left > med.refillLeadDays) return new Created();
  const floor = Math.floor(left);
  const daysTxt = Number.isFinite(left) ? ` (about ${floor} day${floor !== 1 ? 's' : ''})` : '';
  return raiseAlert(
    patient, 'low_stock', `refill:${med.id}:${deviceToday()}`, 'Time to refill',
    `{med} is running low: ${med.qty} left${daysTxt}.`, { medicineId: med.id, qty: med.qty }, med, db,
  );
}

/** 30 / 7 / 0 days before expiry; each bucket once per expiry date. */
export async function expiry(patient: Patient, med: Medicine, today: string, db: Db = prisma): Promise<Created> {
  if (!med.expiryDate) return new Created();
  const exp = med.expiryDate.toISOString().slice(0, 10);
  const left = daysBetween(today, exp);
  const bucket = left <= 0 ? 0 : left <= 7 ? 7 : left <= 30 ? 30 : null;
  if (bucket === null) return new Created();
  const body =
    left < 0
      ? `{med} expired on ${exp}. Please replace it.`
      : left === 0
        ? '{med} expires today. Please replace it.'
        : `{med} expires in ${left} day${left !== 1 ? 's' : ''} (${exp}).`;
  return raiseAlert(
    patient, 'expiry', `expiry:${med.id}:${exp}:${bucket}`, left > 0 ? 'Medicine expiring' : 'Medicine expired', body,
    { medicineId: med.id }, med, db,
  );
}

export const offline = (patient: Patient, deviceId: string, lastSeenEpoch: number, since: string, db?: Db) =>
  raiseAlert(
    patient, 'offline', `offline:${deviceId}:${lastSeenEpoch}`, 'MIRA is offline',
    `${patient.displayName}'s MIRA has not checked in since ${since}. Check its power and WiFi.`, { deviceId }, undefined, db,
  );

export const scanUnknown = (patient: Patient, scanId: number, db?: Db) =>
  raiseAlert(
    patient, 'scan_unknown', `scan:${scanId}`, 'Unknown medicine scanned',
    `The MIRA camera could not recognise a package for ${patient.displayName}. Tap to review.`,
    { scanId, url: `/patients/${patient.id}/scans` }, undefined, db,
  );

/** Exposed for the raise-twice dedup test. */
export const raise = raiseAlert;
