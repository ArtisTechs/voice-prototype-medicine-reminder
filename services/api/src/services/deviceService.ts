/** ESP32-facing behaviour. FROZEN contract: see .claude/skills/device-contract before editing. */
import type { Device, Medicine, Patient, Schedule } from '@prisma/client';
import { forbidden } from '../core/errors';
import { getLogger } from '../core/logger';
import { prisma } from '../core/prisma';
import { redis } from '../core/redis';
import { fit } from '../core/text';
import { deviceToday, doseInstant, fromDbDate, fromDbTime, localToUtc, minutesBetween, utcnow, weekdayOf } from '../core/timeutil';
import * as deviceRepo from '../repositories/devices';
import * as eventRepo from '../repositories/events';
import * as medRepo from '../repositories/medicines';
import { publish } from '../realtime/publisher';
import { MAX_DOSES, SCHEDULE_LIMITS, type DoseOut, type EventIn } from '../schemas/device';
import * as alertService from './alertService';

const log = getLogger('device');

const DOSE_EVENTS = new Set(['due', 'taken', 'missed', 'expired']);
/** Unpaired devices that polled within this window show up in the app as "found nearby". */
export const DETECT_SECONDS = 300;
const UNPAIRED_KEY = 'voice:unpaired';

export function doseText(med: Pick<Medicine, 'doseAmount' | 'doseUnit' | 'form'>): string {
  let unit = (med.doseUnit || med.form || 'tablet').trim().toLowerCase();
  if (med.doseAmount !== 1 && unit.length > 2 && !unit.endsWith('s')) unit += 's';
  return `${med.doseAmount} ${unit}`;
}

export const expiryText = (med: Pick<Medicine, 'expiryDate'>): string => (med.expiryDate ? fromDbDate(med.expiryDate) : '');

export const isExpired = (med: Pick<Medicine, 'expiryDate'>): boolean => !!med.expiryDate && fromDbDate(med.expiryDate) < deviceToday();

/** `detect`: remember an unknown id so the app can offer it for pairing (schedule polls only). */
export async function resolve(ident: string | undefined | null, opts: { camera?: boolean; detect?: boolean } = {}): Promise<Device> {
  const id = (ident ?? '').trim();
  let device: Device | null = null;
  if (id) device = opts.camera ? await deviceRepo.byCameraId(id) : await deviceRepo.byAnyId(id);
  if (device && !(await deviceRepo.patientsOn(device.id)).length) device = null; // nobody on it: treat as unpaired
  if (!device) {
    log.info('device_rejected', { camera: !!opts.camera });
    if (opts.detect && id) await rememberUnpaired(id);
    throw forbidden('device_not_registered', 'This device is not paired. Pair it in the caregiver app.');
  }
  return device;
}

/** Fails open like the rate limiter: detection is a convenience, typing the code still works. */
async function rememberUnpaired(ident: string): Promise<void> {
  const now = Date.now();
  try {
    const r = redis();
    await r.zadd(UNPAIRED_KEY, now, ident);
    await r.zremrangebyscore(UNPAIRED_KEY, 0, now - DETECT_SECONDS * 1000);
    await r.zremrangebyrank(UNPAIRED_KEY, 0, -21); // keep the 20 newest
  } catch {
    log.warn('detect_unavailable');
  }
}

/** Unknown device ids that polled in the last DETECT_SECONDS, newest first. */
export async function recentUnpaired(): Promise<{ ident: string; seen: Date }[]> {
  try {
    const rows = await redis().zrevrangebyscore(UNPAIRED_KEY, '+inf', Date.now() - DETECT_SECONDS * 1000, 'WITHSCORES');
    const out: { ident: string; seen: Date }[] = [];
    for (let i = 0; i < rows.length; i += 2) out.push({ ident: rows[i], seen: new Date(Number(rows[i + 1])) });
    return out;
  } catch {
    log.warn('detect_unavailable');
    return [];
  }
}

export async function forgetUnpaired(...idents: string[]): Promise<void> {
  try {
    await redis().zrem(UNPAIRED_KEY, ...idents);
  } catch {
    log.warn('detect_unavailable');
  }
}

export const patientIds = async (device: Device): Promise<number[]> => (await deviceRepo.patientsOn(device.id)).map((p) => p.id);

export async function publishAll(pids: number[], type: string, data?: Record<string, unknown>): Promise<void> {
  for (const pid of pids) await publish(pid, type, data);
}

export const heartbeat = (device: Device, camera = false) => deviceRepo.touch(device.id, utcnow(), camera);

const firstName = (p: Patient) => p.displayName.split(/\s+/).filter(Boolean)[0] ?? '?';

/** Every person's doses on this device. When it is shared, the name says whose dose it is. */
export async function buildSchedule(device: Device): Promise<{ doses: DoseOut[] }> {
  const patients = await deviceRepo.patientsOn(device.id);
  const rows = await medRepo.deviceDoses(patients.map((p) => p.id), weekdayOf(deviceToday()));
  const shared = patients.length > 1;
  const owner = new Map(patients.map((p) => [p.id, firstName(p)]));
  const nameOf = (m: Medicine) => {
    const label = alertService.medicineLabel(m);
    return shared ? `${owner.get(m.patientId)}: ${label}` : label;
  };
  if (rows.length > MAX_DOSES) log.warn('schedule_truncated', { device: device.deviceId, total: rows.length });
  return {
    doses: rows.slice(0, MAX_DOSES).map(({ schedule: s, medicine: m }) => ({
      id: s.id,
      slot: m.slot as number,
      name: fit(nameOf(m), SCHEDULE_LIMITS.name),
      dose: fit(doseText(m), SCHEDULE_LIMITS.dose),
      time: fromDbTime(s.time),
      instructions: fit(m.instructions, SCHEDULE_LIMITS.instructions),
      expiry: expiryText(m).slice(0, SCHEDULE_LIMITS.expiry),
      qty: Math.max(0, m.qty),
    })),
  };
}

export async function getSchedule(device: Device): Promise<{ doses: DoseOut[] }> {
  await heartbeat(device);
  const out = await buildSchedule(device);
  await publishAll(await patientIds(device), 'device.updated');
  return out;
}

/**
 * The local date of the dose an event refers to. A dose at 23:50 missed at 00:20 belongs to the
 * previous day; an event up to 60 min early (clock skew) belongs to the same day.
 */
export function doseDateFor(eventLocal: Date, doseTime: string): string {
  const day = eventLocal.toISOString().slice(0, 10);
  const candidate = Date.parse(`${day}T${doseTime}:00Z`);
  if (candidate - eventLocal.getTime() > 60 * 60_000) {
    return new Date(eventLocal.getTime() - 86_400_000).toISOString().slice(0, 10);
  }
  return day;
}

/** Store an event and apply its side effects. Returns false if it was a duplicate. */
export async function recordEvent(body: EventIn): Promise<boolean> {
  const device = await resolve(body.device);
  const now = utcnow();
  const occurred = localToUtc(body.time);
  const doseId = body.doseId ?? 0;
  await heartbeat(device);
  const pids = await patientIds(device);

  // The event belongs to whoever owns the dose (or the slot); otherwise to the first person.
  let found = DOSE_EVENTS.has(body.type) && doseId ? await medRepo.getSchedule(doseId) : null;
  if (found && !pids.includes(found.medicine.patientId)) found = null;
  const slotMed = body.slot && !found ? await medRepo.bySlot(pids, body.slot) : null;
  const ownerId = found ? found.medicine.patientId : slotMed ? slotMed.patientId : pids[0];

  const outcome = await prisma.$transaction(async (tx) => {
    const eventId = await eventRepo.insertEvent(
      {
        deviceId: device.deviceId, patientId: ownerId, type: body.type, slot: body.slot || null, doseId,
        localTime: body.time, occurredAt: occurred, receivedAt: now,
      },
      tx,
    );
    if (eventId === null) return null;

    let created = new alertService.Created();
    if (DOSE_EVENTS.has(body.type) && doseId) {
      if (found) created = await doseEvent(tx, body.type, found.medicine, found.schedule, body.time, occurred);
      else log.warn('event_unknown_dose', { type: body.type, doseId });
    } else if ((body.type === 'opened' || body.type === 'closed') && body.slot) {
      const state = { ...((device.slotState as Record<string, unknown>) ?? {}) };
      state[String(body.slot)] = { lidOpen: body.type === 'opened', at: occurred.toISOString() };
      await deviceRepo.setSlotState(device.id, state, tx);
    }
    return { eventId, created };
  });

  if (outcome === null) {
    log.info('event_duplicate', { type: body.type, doseId });
    return false;
  }
  if (DOSE_EVENTS.has(body.type)) await publish(ownerId, 'intake.updated');
  else await publishAll(pids, 'device.updated');
  await alertService.dispatch(outcome.created);
  log.info('event_recorded', { type: body.type, doseId, eventId: outcome.eventId });
  return true;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function doseEvent(
  tx: Tx, type: string, med: Medicine, sched: Schedule, local: Date, occurred: Date,
): Promise<alertService.Created> {
  const created = new alertService.Created();
  const day = doseDateFor(local, fromDbTime(sched.time));
  const time = fromDbTime(sched.time);
  const patient = (await tx.patient.findUnique({ where: { id: med.patientId } })) as Patient;
  const { record } = await eventRepo.ensureIntake(
    { patientId: med.patientId, medicineId: med.id, scheduleId: sched.id, day, time, status: 'due' }, tx,
  );

  if (type === 'due') {
    if (!record.dueAt) await eventRepo.updateIntake(record.id, { dueAt: occurred, source: 'device' }, tx);
  } else if (type === 'taken') {
    const delay = Math.max(0, minutesBetween(doseInstant(day, time), occurred));
    // Only the event that flips the row decrements stock, so a second "taken" cannot double-count.
    const flipped = await tx.intakeRecord.updateMany({
      where: { id: record.id, status: { not: 'taken' } },
      data: { status: 'taken', takenAt: occurred, delayMinutes: delay, source: 'device' },
    });
    if (flipped.count === 1) {
      await medRepo.decrementQty(med.id, tx);
      const fresh = (await medRepo.byId(med.id, tx)) as Medicine;
      created.extend(await alertService.taken(patient, fresh, sched.id, day, time, delay, tx));
      created.extend(await alertService.lowStock(patient, fresh, tx));
    }
  } else if (type === 'missed') {
    const flipped = await tx.intakeRecord.updateMany({
      where: { id: record.id, status: 'due' }, data: { status: 'missed', source: 'device' },
    });
    if (flipped.count === 1) created.extend(await alertService.missed(patient, med, sched.id, day, time, tx));
  } else if (type === 'expired') {
    const flipped = await tx.intakeRecord.updateMany({
      where: { id: record.id, status: { not: 'taken' } }, data: { status: 'expired', source: 'device' },
    });
    if (flipped.count === 1) created.extend(await alertService.expiredDose(patient, med, sched.id, day, time, tx));
  }
  return created;
}
