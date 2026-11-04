import { Router } from 'express';
import multer from 'multer';
import { route } from '../../core/http';
import { notFound, unsupportedMedia } from '../../core/errors';
import * as storage from '../../core/storage';
import * as medRepo from '../../repositories/medicines';
import { medicineCreate, medicineUpdate, scheduleCreate, scheduleUpdate } from '../../schemas/medicine';
import * as medicineService from '../../services/medicineService';
import * as referenceService from '../../services/referenceService';
import * as scanService from '../../services/scanService';

export const medicinesRouter = Router();
const M = '/patients/:patientId/medicines';

route(medicinesRouter, 'get', M, { tag: 'medicines', summary: 'Medicines of a patient' }, async ({ params }) => medicineService.list(params.patientId));

route(medicinesRouter, 'post', M, { tag: 'medicines', summary: 'Add a medicine', body: medicineCreate, status: 201 }, async ({ params, body }) =>
  medicineService.toOut(await medicineService.create(params.patientId, body)),
);

route(medicinesRouter, 'get', `${M}/:medicineId`, { tag: 'medicines', summary: 'One medicine' }, async ({ params }) =>
  medicineService.toOut(await medicineService.get(params.patientId, params.medicineId)),
);

route(medicinesRouter, 'patch', `${M}/:medicineId`, { tag: 'medicines', summary: 'Edit a medicine', body: medicineUpdate }, async ({ params, body }) =>
  medicineService.toOut(await medicineService.update(params.patientId, params.medicineId, body)),
);

route(medicinesRouter, 'delete', `${M}/:medicineId`, { tag: 'medicines', summary: 'Remove a medicine (history is kept)', status: 204 }, async ({ params }) => {
  await medicineService.deactivate(params.patientId, params.medicineId);
});

// ---- schedules ------------------------------------------------------------------------------------

route(medicinesRouter, 'post', `${M}/:medicineId/schedules`, { tag: 'schedules', summary: 'Add a dose time', body: scheduleCreate, status: 201 }, async ({ params, body }) =>
  medicineService.scheduleOut(await medicineService.addSchedule(params.patientId, params.medicineId, body)),
);

route(medicinesRouter, 'patch', `${M}/:medicineId/schedules/:scheduleId`, { tag: 'schedules', summary: 'Change a dose time', body: scheduleUpdate }, async ({ params, body }) =>
  medicineService.scheduleOut(await medicineService.updateSchedule(params.patientId, params.medicineId, params.scheduleId, body)),
);

route(medicinesRouter, 'delete', `${M}/:medicineId/schedules/:scheduleId`, { tag: 'schedules', summary: 'Remove a dose time', status: 204 }, async ({ params }) => {
  await medicineService.deleteSchedule(params.patientId, params.medicineId, params.scheduleId);
});

// ---- fill the add-medicine form from a photo of the box ----------------------------------------

const uploadOnce = multer({ storage: multer.memoryStorage(), limits: { fileSize: referenceService.MAX_UPLOAD, files: 1 } }).single('file');

route(
  medicinesRouter, 'post', `${M}/read-package`,
  { tag: 'medicines', summary: 'Read the name, strength and expiry from a photo of a package (multipart: file); nothing is saved', middleware: [uploadOnce], docBody: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
  async ({ req }) => {
    if (!req.file) throw unsupportedMedia('Send a JPEG or PNG photo.');
    return scanService.readPackage(req.file.buffer);
  },
);

// ---- reference photos ---------------------------------------------------------------------------

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: referenceService.MAX_UPLOAD, files: 1 } }).single('file');
const P = `${M}/:medicineId/photos`;

const photoOut = (patientId: number, medicineId: number, ref: { id: number; angle: string; createdAt: Date }) => ({
  id: ref.id, angle: ref.angle, url: referenceService.photoUrl(patientId, medicineId, ref.id), createdAt: ref.createdAt,
});

route(medicinesRouter, 'get', P, { tag: 'medicines', summary: 'Reference photos of a medicine' }, async ({ params }) => {
  const med = await medicineService.get(params.patientId, params.medicineId);
  return (await medRepo.referenceImages(med.id)).map((r) => photoOut(params.patientId, med.id, r));
});

route(
  medicinesRouter, 'post', P,
  { tag: 'medicines', summary: 'Add a reference photo (multipart: file, angle)', status: 201, middleware: [upload], docBody: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, angle: { type: 'string' } } } } } },
  async ({ req, params }) => {
    const med = await medicineService.get(params.patientId, params.medicineId);
    if (!req.file) throw unsupportedMedia('Send a JPEG or PNG photo.');
    const angle = typeof req.body?.angle === 'string' && req.body.angle ? req.body.angle : 'front';
    return photoOut(params.patientId, med.id, await referenceService.addPhoto(med, req.file.buffer, angle));
  },
);

route(medicinesRouter, 'get', `${P}/:photoId/image`, { tag: 'medicines', summary: 'The photo itself (JPEG)' }, async ({ res, params }) => {
  const med = await medRepo.get(params.patientId, params.medicineId);
  if (!med) throw notFound('not_found', 'Photo not found.');
  const ref = await referenceService.getPhoto(med, params.photoId);
  if (!(await storage.exists(ref.path))) throw notFound('not_found', 'Photo not found.');
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }).send(await storage.readBytes(ref.path));
});

route(medicinesRouter, 'delete', `${P}/:photoId`, { tag: 'medicines', summary: 'Delete a reference photo', status: 204 }, async ({ params }) => {
  const med = await medicineService.get(params.patientId, params.medicineId);
  await referenceService.deletePhoto(med, params.photoId);
});
