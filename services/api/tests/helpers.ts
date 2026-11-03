import type { Device, Medicine, Patient, Schedule, User } from '@prisma/client';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/core/prisma';
import { createToken, hashPassword } from '../src/core/security';
import { dbDate, dbTime } from '../src/core/timeutil';
import { DEFAULT_NOTIFY_PREFS } from '../src/schemas/auth';
import type { ReferencePhoto, VisionClient, VisionRead } from '../src/vision/gemini';
import { VisionError } from '../src/vision/gemini';
import type { Candidate } from '../src/vision/match';

let app: ReturnType<typeof createApp> | undefined;
export const api = () => request((app ??= createApp()));

// ---- auth ------------------------------------------------------------------------------------

export const auth = (user: User) => ({ Authorization: `Bearer ${createToken(user.id, 'access').token}` });

// ---- factories -------------------------------------------------------------------------------

let counter = 0;
let pwHash: Promise<string> | undefined;

export async function makeUser(over: Partial<{ email: string; name: string; notifyPrefs: object }> = {}): Promise<User> {
  const n = ++counter;
  pwHash ??= hashPassword('password123');
  return prisma.user.create({
    data: {
      email: over.email ?? `user${n}@example.com`, passwordHash: await pwHash, name: over.name ?? `User ${n}`,
      notifyPrefs: over.notifyPrefs ?? { ...DEFAULT_NOTIFY_PREFS },
    },
  });
}

export async function makePatient(user?: User, role: 'owner' | 'member' = 'owner', over: Partial<{ displayName: string }> = {}): Promise<Patient> {
  const patient = await prisma.patient.create({ data: { displayName: over.displayName ?? 'Lola Test' } });
  if (user) await prisma.patientCaregiver.create({ data: { patientId: patient.id, userId: user.id, role } });
  return patient;
}

export async function pairDevice(patient: Patient, deviceId = 'pillbox', cameraId?: string): Promise<Device> {
  const dev =
    (await prisma.device.findUnique({ where: { deviceId } })) ??
    (await prisma.device.create({ data: { deviceId, cameraId: cameraId ?? `${deviceId}-cam`, slotState: {} } }));
  await prisma.patient.update({ where: { id: patient.id }, data: { deviceId: dev.id } });
  return dev;
}

export async function makeMedicine(patient: Patient, over: Record<string, unknown> = {}): Promise<Medicine> {
  return prisma.medicine.create({
    data: {
      patientId: patient.id, name: 'Losartan', strength: '50mg', form: 'tablet', doseAmount: 1, doseUnit: 'tablet',
      instructions: 'After breakfast', slot: 1, expiryDate: dbDate('2027-06-30'), qty: 24, lowStockThreshold: 5, refillLeadDays: 3,
      ...over,
    } as never,
  });
}

export async function makeSchedule(med: Medicine, at = '08:00', days: number[] = [0, 1, 2, 3, 4, 5, 6], active = true): Promise<Schedule> {
  return prisma.schedule.create({ data: { medicineId: med.id, time: dbTime(at), daysOfWeek: days, active, createdAt: new Date() } });
}

/** A caregiver, a patient, the paired `pillbox`, and three medicines (one expired, one low). */
export async function setup() {
  const user = await makeUser();
  const patient = await makePatient(user);
  const device = await pairDevice(patient);
  const losartan = await makeMedicine(patient, { barcode: '4800123456786' });
  const metformin = await makeMedicine(patient, {
    name: 'Metformin', strength: '500mg', slot: 2, qty: 4, lowStockThreshold: 6, instructions: 'With meals', barcode: '4800987654328',
  });
  const amlodipine = await makeMedicine(patient, {
    name: 'Amlodipine', strength: '5mg', slot: 3, qty: 18, expiryDate: dbDate('2026-09-30'), instructions: 'After lunch',
  });
  const scheds = {
    losartan: await makeSchedule(losartan, '08:00'),
    metAm: await makeSchedule(metformin, '08:00'),
    metPm: await makeSchedule(metformin, '20:00'),
    amlodipine: await makeSchedule(amlodipine, '13:00'),
  };
  return { user, patient, device, meds: { losartan, metformin, amlodipine }, scheds };
}
export type Setup = Awaited<ReturnType<typeof setup>>;

// ---- images + fake Gemini ----------------------------------------------------------------------

/** A small valid JPEG. `seed` just varies the colour. */
export async function jpeg(seed = 0): Promise<Buffer> {
  return sharp({ create: { width: 160, height: 120, channels: 3, background: { r: 60 + (seed % 150), g: 110, b: 180 } } }).jpeg().toBuffer();
}

type Responder = (candidates: Candidate[], image: Buffer, refs?: ReferencePhoto[]) => VisionRead | Promise<VisionRead>;

/** Stands in for Gemini. By default it recognises nothing (medicineId null, nothing readable). */
export class FakeVision implements VisionClient {
  calls = 0;
  lastCandidates: Candidate[] = [];
  lastReferences: ReferencePhoto[] = [];
  respond: Responder = () => nothing();

  async identify(image: Buffer, candidates: Candidate[], opts: { signal: AbortSignal; references?: ReferencePhoto[] }): Promise<VisionRead> {
    this.calls++;
    this.lastCandidates = candidates;
    this.lastReferences = opts.references ?? [];
    return this.respond(candidates, image, opts.references);
  }
}

export const nothing = (): VisionRead => ({ medicineId: null, readName: '', readStrength: '', readExpiry: null, confidence: 0 });
export const sees = (medicineId: number, confidence = 0.95, over: Partial<VisionRead> = {}): VisionRead => ({
  medicineId, readName: '', readStrength: '', readExpiry: null, confidence, ...over,
});
export const failsWith = (reason: 'timeout' | 'rate_limited' | 'error' | 'no_key'): Responder => () => {
  throw new VisionError(reason);
};

export async function visionClient(): Promise<FakeVision> {
  const pipeline = await import('../src/vision/pipeline');
  const fake = new FakeVision();
  pipeline.setVisionClient(fake);
  return fake;
}

// ---- time ----------------------------------------------------------------------------------------

/** Philippine wall-clock time on 2026-10-<day> as a UTC instant (PH = UTC+8). */
export const ph = (hh: number, mm = 0, day = 30): Date => new Date(Date.UTC(2026, 9, day, hh, mm) - 8 * 3600_000);
