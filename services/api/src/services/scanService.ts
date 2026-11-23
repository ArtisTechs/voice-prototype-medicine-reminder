/** POST /api/scan behaviour (contract: answer < 10 s, never a 5xx) and scan review/correction for the app. */
import type { Medicine, Scan } from '@prisma/client';
import sharp from 'sharp';
import { settings } from '../core/config';
import { notFound, unsupportedMedia } from '../core/errors';
import { getLogger } from '../core/logger';
import { prisma } from '../core/prisma';
import { redis } from '../core/redis';
import * as storage from '../core/storage';
import { fit } from '../core/text';
import { utcnow } from '../core/timeutil';
import * as medRepo from '../repositories/medicines';
import * as scanRepo from '../repositories/scans';
import { withLock } from '../jobs/locks';
import { publish } from '../realtime/publisher';
import { SCAN_LIMITS, type ScanFound } from '../schemas/device';
import * as vision from '../vision/pipeline';
import * as alertService from './alertService';
import * as deviceService from './deviceService';
import * as referenceService from './referenceService';
import * as medicineService from './medicineService';
import * as patientRepo from '../repositories/patients';

const log = getLogger('scan');

/** Everything in the answer comes from the medicine's database row, never from the model. */
export function scanAnswer(med: Medicine): ScanFound {
  return {
    found: true,
    name: fit(alertService.medicineLabel(med), SCAN_LIMITS.name),
    dose: fit(deviceService.doseText(med), SCAN_LIMITS.dose),
    instructions: fit(med.instructions, SCAN_LIMITS.instructions),
    expiry: deviceService.expiryText(med).slice(0, SCAN_LIMITS.expiry),
    slot: med.slot ?? 0,
    qty: Math.max(0, med.qty),
    low: med.qty <= med.lowStockThreshold,
    expired: deviceService.isExpired(med),
  };
}

// ---- "add a medicine by scanning it on the MIRA" -------------------------------------------------

const LEARN_SECONDS = 180;
const learnKey = (patientId: number) => `scan:learn:${patientId}`;

/** The app is open on the add-medicine screen and waiting for the next scan from this person's MIRA. */
export async function armLearn(patientId: number): Promise<void> {
  await redis().set(learnKey(patientId), '1', 'EX', LEARN_SECONDS);
}

/** The first of these people who is waiting for a scan (fails open: no Redis means no learning). */
async function learningPatient(patientIds: number[]): Promise<number | null> {
  try {
    for (const pid of patientIds) if (await redis().get(learnKey(pid))) return pid;
  } catch {
    /* ignore */
  }
  return null;
}

export function checkImage(data: Buffer | undefined, contentType: string | undefined): asserts data is Buffer {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(data) || !['image/jpeg', 'image/jpg'].includes(type) || !storage.isJpeg(data)) {
    throw unsupportedMedia('Send a JPEG image with Content-Type: image/jpeg.');
  }
}

/** Up to one small reference photo per medicine (opt-in: it makes the call slower). */
async function loadReferences(meds: Medicine[]) {
  const refs = await medRepo.firstReferences(meds.map((m) => m.id));
  const first = new Map<number, string>();
  for (const r of refs) if (!first.has(r.medicineId)) first.set(r.medicineId, r.path);
  const out = [];
  for (const [medicineId, rel] of [...first].slice(0, 4)) {
    try {
      out.push({ medicineId, image: await sharp(await storage.readBytes(rel)).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer() });
    } catch {
      /* a missing file just means no reference for that medicine */
    }
  }
  return out;
}

export async function scan(deviceIdent: string | undefined, data: Buffer | undefined, contentType: string | undefined): Promise<Record<string, unknown>> {
  const device = await deviceService.resolve(deviceIdent, { camera: true });
  checkImage(data, contentType);
  await deviceService.heartbeat(device, true);
  const now = utcnow();
  const rel = storage.newRelPath('scans', now);
  await storage.writeBytes(rel, data);

  // A shared MIRA can hold anyone's medicine. An unknown package goes to the first person.
  const pids = await deviceService.patientIds(device);
  const meds: Medicine[] = [];
  for (const pid of pids) meds.push(...(await medRepo.listForPatient(pid)));

  const learning = await learningPatient(pids);

  // One scan at a time per box: a second press while one is running is answered "not found".
  const match = await withLock(`scan:${device.id}`, 15, async (got) => {
    if (!got) {
      log.warn('scan_busy');
      return { medicineId: null, method: 'none', score: null, readExpiry: null, reason: 'busy', timings: { total: 0 } } as vision.Match;
    }
    return vision.identify(
      data,
      meds.map((m) => ({ id: m.id, name: m.name, strength: m.strength, barcode: m.barcode })),
      { learn: learning !== null, ...(settings().SCAN_USE_REFERENCES ? { references: () => loadReferences(meds) } : {}) },
    );
  });

  const med = meds.find((m) => m.id === match.medicineId);
  // Not a registered medicine, but the AI read (or recognised) a name: offer it as a suggestion. Exactly {"found":false}
  // when nothing was read. Old firmware ignores the extra keys.
  const suggestion = !med && match.readName ? [match.readName, match.readStrength].filter(Boolean).join(' ') : '';
  const answer: Record<string, unknown> = med
    ? { ...scanAnswer(med) }
    : suggestion
      ? {
          found: false,
          guess: fit(suggestion, SCAN_LIMITS.name),
          guessed: !!match.guessed,
          // Printed expiry date, only when the AI read one: lets the box warn about an expired package that is not registered.
          ...(match.readExpiry ? { expiry: match.readExpiry, expired: match.readExpiry < new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) } : {}),
        }
      : { found: false };
  const ownerId = med ? med.patientId : learning ?? pids[0];
  if (learning !== null) await redis().del(learnKey(learning)).catch(() => undefined);

  const row = await scanRepo.create({
    patientId: ownerId, deviceId: device.cameraId, imagePath: rel, found: !!med, method: match.method, score: match.score,
    medicineId: med?.id ?? null, result: answer as object, readExpiry: match.readExpiry, readName: match.readName ?? null, readStrength: match.readStrength ?? null, guessed: !!match.guessed, timings: match.timings,
    durationMs: match.timings.total ?? 0, createdAt: now,
  });
  let created = new alertService.Created();
  if (!med && learning === null) {
    const patient = await patientRepo.byId(ownerId);
    if (patient) created = await alertService.scanUnknown(patient, row.id);
  }
  await publish(ownerId, 'scan.created', { scanId: row.id });
  await alertService.dispatch(created);
  log.info('scan_done', { scanId: row.id, method: match.method, score: match.score, reason: match.reason, ...Object.fromEntries(Object.entries(match.timings).map(([k, v]) => [`ms_${k}`, v])) });
  return answer;
}

// ---- read a package photo taken with the phone (add a medicine) ------------------------------------

export interface PackageRead {
  read: boolean;
  name: string | null;
  strength: string | null;
  expiry: string | null;
  /** The name is a guess from how the package looks, not printed text. */
  guessed: boolean;
  reason: string | null;
}

/** Same reader as the MIRA scan, for a photo from the caregiver's phone. The photo is not stored. */
export async function readPackage(image: Buffer): Promise<PackageRead> {
  if (!storage.isImage(image)) throw unsupportedMedia('Send a JPEG or PNG photo.');
  let jpeg: Buffer;
  try {
    jpeg = await sharp(image).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    throw unsupportedMedia('That photo could not be read. Send a JPEG or PNG photo.');
  }
  const m = await vision.identify(jpeg, [], { learn: true });
  const name = m.readName ?? null;
  return { read: !!name, name, strength: m.readStrength ?? null, expiry: m.readExpiry, guessed: !!m.guessed && !!name, reason: name ? null : m.reason ?? 'no_match' };
}

// ---- review in the app -----------------------------------------------------------------------

export function scanOut(s: Scan, names: Map<number, string>) {
  return {
    id: s.id,
    found: s.found,
    method: s.method,
    score: s.score,
    medicineId: s.medicineId,
    medicineName: s.medicineId ? names.get(s.medicineId) ?? null : null,
    correctedMedicineId: s.correctedMedicineId,
    correctedNone: s.correctedNone,
    correctedAt: s.correctedAt,
    ocrExpiry: s.readExpiry,
    readName: s.readName,
    readStrength: s.readStrength,
    guessed: s.guessed,
    durationMs: s.durationMs,
    imageUrl: `/api/v1/patients/${s.patientId}/scans/${s.id}/image`,
    createdAt: s.createdAt,
  };
}

export async function medicineNames(patientId: number): Promise<Map<number, string>> {
  const rows = await prisma.medicine.findMany({ where: { patientId } });
  return new Map(rows.map((m) => [m.id, alertService.medicineLabel(m)]));
}

export async function getScan(patientId: number, scanId: number): Promise<Scan> {
  const s = await scanRepo.get(patientId, scanId);
  if (!s) throw notFound('not_found', 'Scan not found.');
  return s;
}

/** Set the right medicine (or none). A medicine answer is added as a new reference photo. */
export async function correct(patientId: number, scanId: number, medicineId: number | null) {
  const s = await getScan(patientId, scanId);
  if (medicineId !== null) {
    const med = await medicineService.get(patientId, medicineId);
    let data: Buffer;
    try {
      data = await storage.readBytes(s.imagePath);
    } catch {
      throw notFound('not_found', 'The photo was deleted, so it cannot be learned from.');
    }
    await referenceService.addPhoto(med, data, 'correction', { notify: false });
  }
  const updated = await scanRepo.update(s.id, { correctedAt: utcnow(), correctedNone: medicineId === null, correctedMedicineId: medicineId });
  await publish(patientId, 'scan.created', { scanId: s.id });
  return scanOut(updated, await medicineNames(patientId));
}
