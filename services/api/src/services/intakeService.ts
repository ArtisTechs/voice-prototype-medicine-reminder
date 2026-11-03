/** Today timeline, history/adherence and the dashboard. Read side of intake records. */
import type { IntakeRecord, Medicine, Schedule, User } from '@prisma/client';
import { settings } from '../core/config';
import { badRequest } from '../core/errors';
import { prisma } from '../core/prisma';
import { addDays, daysBetween, deviceToday, doseInstant, fromDbDate, fromDbTime, utcnow, weekdayOf } from '../core/timeutil';
import * as alertRepo from '../repositories/alerts';
import * as deviceRepo from '../repositories/devices';
import * as eventRepo from '../repositories/events';
import * as medRepo from '../repositories/medicines';
import * as patientRepo from '../repositories/patients';
import { medicineLabel, activeScheduleDays, daysLeft } from './alertService';
import { doseText } from './deviceService';
import { isOnline } from './patientService';

const MAX_HISTORY_DAYS = 92;

type Status = 'upcoming' | 'due' | 'taken' | 'late' | 'missed' | 'expired';
type Counts = { total: number; taken: number; late: number; missed: number; expired: number; due: number; upcoming: number };

export function recordStatus(rec: Pick<IntakeRecord, 'status' | 'delayMinutes'>): string {
  if (rec.status === 'taken') return (rec.delayMinutes ?? 0) > settings().LATE_AFTER_MINUTES ? 'late' : 'taken';
  return rec.status;
}

/** Status of one dose today. Without a record, the clock decides (the device may not have reported yet). */
export function liveStatus(rec: IntakeRecord | undefined, med: Medicine, sched: Schedule, day: string, now: Date): Status {
  const expired = !!med.expiryDate && fromDbDate(med.expiryDate) < day;
  if (rec && rec.status !== 'due') return recordStatus(rec) as Status;
  const at = doseInstant(day, fromDbTime(sched.time));
  if (now < at) return expired ? 'expired' : 'upcoming';
  if (now.getTime() - at.getTime() > settings().MISSED_FALLBACK_MINUTES * 60_000) return 'missed';
  return expired ? 'expired' : 'due';
}

export async function today(patientId: number) {
  const now = utcnow();
  const day = deviceToday();
  const rows = await medRepo.deviceDoses([patientId], weekdayOf(day));
  const recs = new Map((await eventRepo.intakesForDay(patientId, day)).map((r) => [r.scheduleId, r]));
  const summary: Counts = { total: 0, taken: 0, late: 0, missed: 0, expired: 0, due: 0, upcoming: 0 };
  const doses = rows.map(({ schedule, medicine }) => {
    const rec = recs.get(schedule.id);
    const status = liveStatus(rec, medicine, schedule, day, now);
    summary[status] += 1;
    summary.total += 1;
    return {
      scheduleId: schedule.id,
      medicineId: medicine.id,
      medicineName: medicineLabel(medicine),
      slot: medicine.slot,
      time: fromDbTime(schedule.time),
      dose: doseText(medicine),
      instructions: medicine.instructions,
      status,
      takenAt: rec?.takenAt ?? null,
      delayMinutes: rec && rec.status === 'taken' ? rec.delayMinutes : null,
    };
  });
  return { date: day, doses, summary };
}

interface Totals {
  taken: number;
  late: number;
  missed: number;
  expired: number;
  adherence: number | null;
}

const emptyTotals = (): Totals => ({ taken: 0, late: 0, missed: 0, expired: 0, adherence: null });

function adherence<T extends Totals>(t: T): T {
  const done = t.taken + t.late;
  const denom = done + t.missed + t.expired;
  t.adherence = denom ? Math.round((1000 * done) / denom) / 10 : null;
  return t;
}

export async function history(patientId: number, from?: string, to?: string) {
  const end = to ?? deviceToday();
  const start = from ?? addDays(end, -6);
  if (start > end) throw badRequest('bad_range', 'The start date must be before the end date.');
  if (daysBetween(start, end) + 1 > MAX_HISTORY_DAYS) throw badRequest('range_too_long', `Choose at most ${MAX_HISTORY_DAYS} days.`);

  const recs = (await eventRepo.intakesBetween(patientId, start, end)).filter((r) => r.status !== 'due');
  const names = new Map((await prisma.medicine.findMany({ where: { patientId } })).map((m) => [m.id, medicineLabel(m)]));
  const overall = emptyTotals();
  const byDay = new Map<string, Totals & { date: string }>();
  const byMed = new Map<number, Totals & { medicineId: number; medicineName: string }>();
  const records = recs.map((r) => {
    const status = recordStatus(r) as 'taken' | 'late' | 'missed' | 'expired';
    const date = fromDbDate(r.doseDate);
    const day = byDay.get(date) ?? { date, ...emptyTotals() };
    byDay.set(date, day);
    const med = byMed.get(r.medicineId) ?? { medicineId: r.medicineId, medicineName: names.get(r.medicineId) ?? '?', ...emptyTotals() };
    byMed.set(r.medicineId, med);
    for (const bucket of [overall, day, med]) bucket[status] += 1;
    return {
      scheduleId: r.scheduleId, date, time: fromDbTime(r.scheduledTime), medicineId: r.medicineId,
      medicineName: names.get(r.medicineId) ?? '?', status, delayMinutes: r.delayMinutes, takenAt: r.takenAt,
    };
  });
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(adherence(byDay.get(d) ?? { date: d, ...emptyTotals() }));
  return {
    fromDate: start,
    toDate: end,
    overall: adherence(overall),
    days,
    medicines: [...byMed.values()].sort((a, b) => a.medicineName.localeCompare(b.medicineName)).map(adherence),
    records: records.reverse(),
  };
}

export async function dashboard(user: User) {
  const unread = await alertRepo.unreadByPatient(user.id);
  const day = deviceToday();
  const cards = [];
  for (const { patient, role } of await patientRepo.forUser(user.id)) {
    const t = await today(patient.id);
    const next = t.doses.find((d) => d.status === 'upcoming' || d.status === 'due');
    const low: { id: number; name: string; qty: number }[] = [];
    const expiring: { id: number; name: string; expiryDate: string; daysToExpiry: number }[] = [];
    for (const m of await medRepo.listForPatient(patient.id)) {
      const left = daysLeft(m.qty, m.doseAmount, activeScheduleDays(m.schedules));
      if (m.qty <= m.lowStockThreshold || left <= m.refillLeadDays) low.push({ id: m.id, name: medicineLabel(m), qty: m.qty });
      if (m.expiryDate) {
        const exp = fromDbDate(m.expiryDate);
        if (daysBetween(day, exp) <= 30) expiring.push({ id: m.id, name: medicineLabel(m), expiryDate: exp, daysToExpiry: daysBetween(day, exp) });
      }
    }
    const dev = await deviceRepo.forPatient(patient.id);
    cards.push({
      id: patient.id,
      displayName: patient.displayName,
      role,
      today: t.summary,
      nextDose: next ? { time: next.time, medicineName: next.medicineName, slot: next.slot } : null,
      unreadAlerts: unread.get(patient.id) ?? 0,
      lowStock: low,
      expiringSoon: expiring.sort((a, b) => a.daysToExpiry - b.daysToExpiry),
      device: dev ? { status: isOnline(dev) ? 'online' : 'offline', lastSeen: dev.lastSeen } : null,
    });
  }
  return { patients: cards, unreadAlerts: [...unread.values()].reduce((a, b) => a + b, 0) };
}
