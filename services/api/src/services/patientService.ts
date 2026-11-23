/** Patients, caregiver sharing (invite codes), device pairing, account deletion. */
import { randomInt } from 'node:crypto';
import type { Device, Invite, Patient, User } from '@prisma/client';
import { settings } from '../core/config';
import { badRequest, conflict, notFound } from '../core/errors';
import { getLogger } from '../core/logger';
import { isUniqueViolation, prisma } from '../core/prisma';
import * as storage from '../core/storage';
import { utcnow } from '../core/timeutil';
import * as deviceRepo from '../repositories/devices';
import * as medRepo from '../repositories/medicines';
import * as patientRepo from '../repositories/patients';
import * as scanRepo from '../repositories/scans';
import * as userRepo from '../repositories/users';
import { publish, publishUser } from '../realtime/publisher';
import * as deviceService from './deviceService';
import { medicineLabel } from './alertService';

const log = getLogger('patients');

/** No 0/O/1/I so codes are easy to read aloud and type. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_DAYS = 7;
export const OTHER_PERSON = 'Another person';

export async function createPatient(user: User, data: { displayName: string; note?: string | null }): Promise<Patient> {
  const patient = await prisma.$transaction(async (tx) => {
    const p = await patientRepo.create(data.displayName.trim(), data.note, tx);
    await patientRepo.addCaregiver(p.id, user.id, 'owner', tx);
    return p;
  });
  await publishUser(user.id, 'patients.changed');
  return patient;
}

export async function updatePatient(patientId: number, data: { displayName?: string; note?: string | null }): Promise<Patient> {
  const patient = await patientRepo.update(patientId, {
    ...(data.displayName !== undefined ? { displayName: data.displayName.trim() } : {}),
    ...(data.note !== undefined ? { note: data.note } : {}),
  });
  await publish(patientId, 'patient.updated');
  return patient;
}

/** Deletes the patient and every row (cascade) and file that belongs to it. */
export async function deletePatient(patientId: number): Promise<void> {
  const files = [...(await scanRepo.imagePathsForPatient(patientId)), ...(await scanRepo.referencePathsForPatient(patientId))];
  const patient = await patientRepo.byId(patientId);
  await prisma.$transaction(async (tx) => {
    await patientRepo.remove(patientId, tx);
    await deviceRepo.deleteIfUnused(patient?.deviceId ?? null, tx);
  });
  for (const rel of files) await storage.remove(rel);
  log.info('patient_deleted', { patientId, files: files.length });
}

export async function leavePatient(user: User, patientId: number): Promise<void> {
  if ((await patientRepo.caregiverCount(patientId)) <= 1) {
    await deletePatient(patientId);
    return;
  }
  await prisma.$transaction(async (tx) => {
    const link = await patientRepo.link(user.id, patientId, tx);
    if (link?.role === 'owner') {
      // Hand ownership to the longest-standing remaining caregiver.
      const heir = (await patientRepo.caregivers(patientId, tx)).find((c) => c.user.id !== user.id);
      if (heir) await patientRepo.setRole(patientId, heir.user.id, 'owner', tx);
    }
    await patientRepo.removeCaregiver(patientId, user.id, tx);
  });
  await publish(patientId, 'patient.updated');
}

export async function createInvite(user: User, patientId: number): Promise<Invite> {
  for (let i = 0; i < 5; i++) {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    try {
      return await patientRepo.createInvite({ patientId, code, createdBy: user.id, expiresAt: new Date(utcnow().getTime() + INVITE_DAYS * 86_400_000) });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw conflict('invite_failed', 'Could not create a code. Try again.');
}

export async function acceptInvite(user: User, code: string): Promise<Patient> {
  const invalid = () => badRequest('invite_invalid', 'That code is not valid or has expired. Ask for a new one.');
  const patient = await prisma.$transaction(async (tx) => {
    const invite = await patientRepo.inviteByCode(code.trim().toUpperCase(), tx);
    if (!invite || invite.usedAt || invite.expiresAt < utcnow()) throw invalid();
    if (!(await patientRepo.useInvite(invite.id, user.id, utcnow(), tx))) throw invalid();
    if (!(await patientRepo.link(user.id, invite.patientId, tx))) await patientRepo.addCaregiver(invite.patientId, user.id, 'member', tx);
    return (await patientRepo.byId(invite.patientId, tx)) as Patient;
  });
  await publish(patient.id, 'patient.updated');
  await publishUser(user.id, 'patients.changed');
  return patient;
}

// ---- devices -----------------------------------------------------------------------------------

function checkCodes(deviceId: string, cameraId: string): void {
  if (deviceId === cameraId) throw badRequest('invalid_device', 'The MIRA and camera codes must be different.');
}

/**
 * Put the person on a MIRA. A MIRA can serve several people; their medicines share its 5 slots.
 * Moving to another MIRA leaves the old one, which is deleted once nobody uses it.
 */
export async function pairDevice(patientId: number, data: { deviceId: string; cameraId?: string | null }): Promise<Device> {
  const { device, pids } = await prisma.$transaction(async (tx) => {
    const patient = (await patientRepo.byId(patientId, tx)) as Patient;
    const oldPk = patient.deviceId;
    let dev = await deviceRepo.byDeviceId(data.deviceId, tx);
    if (!dev) {
      const cameraId = data.cameraId || `${data.deviceId}-cam`;
      checkCodes(data.deviceId, cameraId);
      if ((await deviceRepo.byAnyId(data.deviceId, tx)) || (await deviceRepo.byAnyId(cameraId, tx))) {
        throw conflict('device_taken', 'That code belongs to another MIRA. Check the code and try again.');
      }
      dev = await deviceRepo.create(data.deviceId, cameraId, tx);
    } else {
      if (data.cameraId && data.cameraId !== dev.cameraId) {
        checkCodes(dev.deviceId, data.cameraId);
        const clash = await deviceRepo.byAnyId(data.cameraId, tx);
        if (clash && clash.id !== dev.id) throw conflict('device_taken', 'That camera code belongs to another MIRA.');
        dev = await deviceRepo.setCamera(dev.id, data.cameraId, tx);
      }
      const others = (await deviceRepo.patientsOn(dev.id, tx)).filter((p) => p.id !== patientId).map((p) => p.id);
      if (others.length) {
        const mine = await medRepo.usedSlots([patientId], tx);
        const theirs = await medRepo.usedSlots(others, tx);
        const overlap = [...mine].filter((s) => theirs.has(s)).sort();
        if (overlap.length) {
          throw conflict(
            'slot_taken',
            `Slot ${overlap.join(', ')} on this MIRA is already used by another person. Move ${patient.displayName}'s medicine to a free slot first.`,
          );
        }
      }
    }
    await patientRepo.setDevice(patientId, dev.id, tx);
    if (oldPk !== dev.id) await deviceRepo.deleteIfUnused(oldPk, tx);
    return { device: dev, pids: (await deviceRepo.patientsOn(dev.id, tx)).map((p) => p.id) };
  });
  await deviceService.forgetUnpaired(device.deviceId);
  await deviceService.publishAll(pids, 'device.updated');
  log.info('device_paired', { patientId, people: pids.length });
  return device;
}

/** Takes only this person off the MIRA. Others on it keep using it. */
export async function unpairDevice(patientId: number): Promise<void> {
  const others = await prisma.$transaction(async (tx) => {
    const patient = (await patientRepo.byId(patientId, tx)) as Patient;
    const oldPk = patient.deviceId;
    await patientRepo.setDevice(patientId, null, tx);
    const rest = oldPk ? (await deviceRepo.patientsOn(oldPk, tx)).map((p) => p.id) : [];
    await deviceRepo.deleteIfUnused(oldPk, tx);
    return rest;
  });
  await deviceService.publishAll([patientId, ...others], 'device.updated');
}

export function isOnline(device: Pick<Device, 'lastSeen'> | null | undefined): boolean {
  if (!device?.lastSeen) return false;
  return (utcnow().getTime() - device.lastSeen.getTime()) / 1000 <= settings().ONLINE_WINDOW_SECONDS;
}

export async function deviceStatus(user: User, patientId: number) {
  const device = await deviceRepo.forPatient(patientId);
  if (!device) throw notFound('no_device', 'No MIRA is paired yet.');
  const people = await deviceRepo.patientsOn(device.id);
  const visible = new Set((await patientRepo.forUser(user.id)).map((r) => r.patient.id));
  const names = new Map(people.map((p) => [p.id, visible.has(p.id) ? p.displayName : OTHER_PERSON]));
  const meds = new Map<number, Awaited<ReturnType<typeof medRepo.listForPatient>>[number]>();
  for (const p of people) for (const m of await medRepo.listForPatient(p.id)) if (m.slot) meds.set(m.slot, m);
  const shared = people.length > 1;
  const state = (device.slotState ?? {}) as Record<string, { lidOpen?: boolean; at?: string }>;
  const slots = [1, 2, 3, 4, 5].map((n) => {
    const s = state[String(n)] ?? {};
    const m = meds.get(n);
    const mine = !!m && visible.has(m.patientId);
    return {
      slot: n,
      medicineId: mine ? m!.id : null,
      medicineName: mine ? medicineLabel(m!) : null,
      // Whose medicine it is when the MIRA is shared ("Another person" for people you don't look after).
      personName: m && shared ? names.get(m.patientId) ?? null : null,
      lidOpen: s.lidOpen ?? null,
      lastEventAt: s.at ?? null,
    };
  });
  return {
    deviceId: device.deviceId,
    cameraId: device.cameraId,
    status: isOnline(device) ? 'online' : 'offline',
    lastSeen: device.lastSeen,
    cameraLastSeen: device.cameraLastSeen,
    slots,
    people: people.map((p) => ({ patientId: visible.has(p.id) ? p.id : null, name: names.get(p.id)!, current: p.id === patientId })),
  };
}

/**
 * MIRAs to offer when pairing: unpaired ones polling right now, paired ones checking in now, and the
 * ones the caregiver's people already use. Unpaired first, then yours, newest first.
 */
export async function nearbyDevices(user: User) {
  const mine = new Set((await patientRepo.forUser(user.id)).map((r) => r.patient.id));
  const since = new Date(utcnow().getTime() - deviceService.DETECT_SECONDS * 1000);
  const found = [...(await deviceRepo.seenSince(since)), ...(await deviceRepo.forPatients([...mine]))];
  const unique = new Map(found.map((d) => [d.id, d]));
  const out: { deviceId: string; paired: boolean; status: string; lastSeen: Date | null; people: number; mine: boolean }[] = [];
  for (const d of unique.values()) {
    const people = await deviceRepo.patientsOn(d.id);
    if (!people.length) continue;
    out.push({
      deviceId: d.deviceId, paired: true, status: isOnline(d) ? 'online' : 'offline', lastSeen: d.lastSeen,
      people: people.length, mine: people.some((p) => mine.has(p.id)),
    });
  }
  const known = new Set(out.map((o) => o.deviceId));
  for (const { ident, seen } of await deviceService.recentUnpaired()) {
    if (!known.has(ident)) out.push({ deviceId: ident, paired: false, status: 'online', lastSeen: seen, people: 0, mine: false });
  }
  return out.sort(
    (a, b) => Number(a.paired) - Number(b.paired) || Number(!a.mine) - Number(!b.mine) || (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0),
  );
}

/** Delete on request: the user, their tokens and alerts, and patients nobody else looks after. */
export async function deleteAccount(user: User): Promise<void> {
  for (const { patient } of await patientRepo.forUser(user.id)) await leavePatient(user, patient.id);
  await userRepo.remove(user.id);
  log.info('account_deleted', { userId: user.id });
}
