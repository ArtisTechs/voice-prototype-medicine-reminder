/** Reference photos of medicine packages (shown in the app; optionally sent to Gemini with a scan). */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Medicine, ReferenceImage } from '@prisma/client';
import { badRequest, conflict, notFound, tooLarge, unsupportedMedia } from '../core/errors';
import { getLogger } from '../core/logger';
import * as storage from '../core/storage';
import { utcnow } from '../core/timeutil';
import * as medRepo from '../repositories/medicines';
import { publish } from '../realtime/publisher';

const log = getLogger('references');

export const MAX_PHOTOS = 12;
export const MAX_UPLOAD = 8 * 1024 * 1024;
export const ANGLES = ['front', 'back', 'side', 'correction', 'other'];
// services/api/seed_assets, whether we run from src/ (tsx) or from dist/src/ (compiled).
export const SEED_ASSETS = [path.resolve(__dirname, '..', '..', 'seed_assets'), path.resolve(__dirname, '..', '..', '..', 'seed_assets')].find((p) => existsSync(p)) ?? path.resolve(__dirname, '..', '..', 'seed_assets');

export const photoUrl = (patientId: number, medicineId: number, photoId: number) =>
  `/api/v1/patients/${patientId}/medicines/${medicineId}/photos/${photoId}/image`;

export async function addPhoto(med: Medicine, data: Buffer, angle: string, opts: { notify?: boolean } = {}): Promise<ReferenceImage> {
  if (!ANGLES.includes(angle)) throw badRequest('invalid_angle', 'Choose front, back or side.');
  if (data.length > MAX_UPLOAD) throw tooLarge('The photo is larger than 8 MB.');
  if (!storage.isImage(data)) throw unsupportedMedia('Send a JPEG or PNG photo.');
  if ((await medRepo.referenceCount(med.id)) >= MAX_PHOTOS) {
    throw conflict('too_many_photos', `A medicine can have at most ${MAX_PHOTOS} photos. Delete one first.`);
  }
  let clean: Buffer;
  try {
    clean = await storage.reencodeJpeg(data);
  } catch {
    throw unsupportedMedia('That photo could not be read. Send a JPEG or PNG photo.');
  }
  const rel = storage.newRelPath('refs', utcnow());
  await storage.writeBytes(rel, clean);
  const ref = await medRepo.addReference({ medicineId: med.id, angle, path: rel });
  if (opts.notify !== false) await publish(med.patientId, 'medicine.updated', { medicineId: med.id });
  log.info('reference_added', { medicineId: med.id });
  return ref;
}

export async function getPhoto(med: Medicine, photoId: number): Promise<ReferenceImage> {
  const ref = await medRepo.referenceById(med.id, photoId);
  if (!ref) throw notFound('not_found', 'Photo not found.');
  return ref;
}

export async function deletePhoto(med: Medicine, photoId: number): Promise<void> {
  const ref = await getPhoto(med, photoId);
  await medRepo.deleteReference(ref.id);
  await storage.remove(ref.path);
  await publish(med.patientId, 'medicine.updated', { medicineId: med.id });
}

/** Attach seed_assets/<Medicine name>/*.jpg to the demo medicines that have no photos yet. */
export async function seedDemoReferences(medicines: Medicine[]): Promise<void> {
  let folders: string[];
  try {
    folders = (await fs.readdir(SEED_ASSETS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return;
  }
  for (const folder of folders) {
    for (const med of medicines.filter((m) => m.name === folder && m.active)) {
      if (await medRepo.referenceCount(med.id)) continue;
      const files = (await fs.readdir(path.join(SEED_ASSETS, folder))).filter((f) => f.endsWith('.jpg')).sort();
      for (const file of files) {
        const stem = path.basename(file, '.jpg');
        await addPhoto(med, await fs.readFile(path.join(SEED_ASSETS, folder, file)), ANGLES.includes(stem) ? stem : 'other', { notify: false });
      }
    }
  }
}
