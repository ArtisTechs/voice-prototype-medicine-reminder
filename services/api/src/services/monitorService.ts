/** Timed checks the worker runs: missed-dose fallback, pillbox offline, refill, expiry, retention. */
import { settings } from '../core/config';
import { getLogger } from '../core/logger';
import { prisma } from '../core/prisma';
import * as storage from '../core/storage';
import { deviceClock, deviceDate, deviceToday, doseInstant, fromDbTime, partsIn, utcnow, weekdayOf } from '../core/timeutil';
import * as alertRepo from '../repositories/alerts';
import * as deviceRepo from '../repositories/devices';
import * as eventRepo from '../repositories/events';
import * as medRepo from '../repositories/medicines';
import * as patientRepo from '../repositories/patients';
import * as scanRepo from '../repositories/scans';
import * as userRepo from '../repositories/users';
import { publish } from '../realtime/publisher';
import * as alertService from './alertService';

const log = getLogger('monitor');
const { Created } = alertService;

/**
 * A dose more than MISSED_FALLBACK_MINUTES past its time today, with no record (and a schedule that
 * existed at the time), is missed. Only paired devices count: unslotted medicines never get reminders.
 */
export async function reconcileMissed() {
  const s = settings();
  const now = utcnow();
  const day = deviceToday();
  const created = new Created();
  const touched = new Set<number>();
  const patients = await prisma.patient.findMany({ where: { deviceId: { not: null } } });
  for (const patient of patients) {
    const recs = new Set((await eventRepo.intakesForDay(patient.id, day)).map((r) => r.scheduleId));
    for (const { schedule, medicine } of await medRepo.deviceDoses([patient.id], weekdayOf(day))) {
      if (recs.has(schedule.id)) continue;
      const time = fromDbTime(schedule.time);
      const at = doseInstant(day, time);
      if (now.getTime() - at.getTime() < s.MISSED_FALLBACK_MINUTES * 60_000 || schedule.createdAt > at) continue;
      const { created: isNew } = await eventRepo.ensureIntake({
        patientId: medicine.patientId, medicineId: medicine.id, scheduleId: schedule.id, day, time,
        status: 'missed', dueAt: at, source: 'fallback',
      });
      if (!isNew) continue;
      touched.add(patient.id);
      created.extend(await alertService.missed(patient, medicine, schedule.id, day, time));
    }
  }
  for (const pid of touched) await publish(pid, 'intake.updated');
  return created;
}

/** Alert once per outage when a pillbox has not been seen for OFFLINE_ALERT_MINUTES. */
export async function offlineDevices() {
  const created = new Created();
  const cutoff = new Date(utcnow().getTime() - settings().OFFLINE_ALERT_MINUTES * 60_000);
  for (const dev of await deviceRepo.stale(cutoff)) {
    const seen = dev.lastSeen as Date;
    const p = partsIn(seen);
    const [h, m] = deviceClock(seen).split(':').map(Number);
    const clock = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    const month = new Date(Date.UTC(2000, p.month - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const label = deviceDate(seen) === deviceToday() ? clock : `${clock} on ${month} ${p.day}`;
    for (const patient of await deviceRepo.patientsOn(dev.id)) {
      created.extend(await alertService.offline(patient, dev.deviceId, Math.floor(seen.getTime() / 1000), label));
    }
  }
  return created;
}

export async function inventory() {
  const created = new Created();
  for (const med of await medRepo.allActive()) {
    const patient = await patientRepo.byId(med.patientId);
    if (patient) created.extend(await alertService.lowStock(patient, med));
  }
  return created;
}

export async function expiry(today = deviceToday()) {
  const created = new Created();
  for (const med of await medRepo.expiringCandidates()) {
    const patient = await patientRepo.byId(med.patientId);
    if (patient) created.extend(await alertService.expiry(patient, med, today));
  }
  return created;
}

/** Retention: scans (and files) 30 d, device events 180 d, alerts 90 d, used/expired invites, old tokens. */
export async function cleanup(now = utcnow()) {
  const s = settings();
  const day = 86_400_000;
  const oldScans = await scanRepo.olderThan(new Date(now.getTime() - s.SCAN_RETENTION_DAYS * day));
  if (oldScans.length) await scanRepo.deleteByIds(oldScans.map((x) => x.id));
  const events = await eventRepo.deleteEventsBefore(new Date(now.getTime() - s.RETENTION_EVENTS_DAYS * day));
  const alerts = await alertRepo.deleteBefore(new Date(now.getTime() - s.RETENTION_ALERTS_DAYS * day));
  await patientRepo.deleteInvitesExpiredBefore(new Date(now.getTime() - day));
  await userRepo.deleteExpiredRefreshTokens(now);
  for (const sc of oldScans) await storage.remove(sc.imagePath);
  const counts = { scans: oldScans.length, events, alerts };
  log.info('cleanup_done', counts);
  return counts;
}
