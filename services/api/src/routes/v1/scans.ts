import { Router } from 'express';
import { z } from 'zod';
import { route } from '../../core/http';
import { notFound } from '../../core/errors';
import * as storage from '../../core/storage';
import * as scanRepo from '../../repositories/scans';
import { pageQuery } from '../../schemas/common';
import * as scanService from '../../services/scanService';

export const scansRouter = Router();
const S = '/patients/:patientId/scans';

route(scansRouter, 'get', S, { tag: 'scans', summary: 'Camera scans of a patient', query: pageQuery }, async ({ params, query }) => {
  const { total, items } = await scanRepo.list(params.patientId, query.limit, query.offset);
  const names = await scanService.medicineNames(params.patientId);
  return { items: items.map((s) => scanService.scanOut(s, names)), total, limit: query.limit, offset: query.offset };
});

/** The add-medicine screen asks the MIRA to read the next package it sees; the result is the newest scan (readName, readStrength). */
route(scansRouter, 'post', `${S}/learn`, { tag: 'scans', summary: 'Wait for the next scan from this MIRA (add a medicine by scanning it)', status: 204 }, async ({ params }) => {
  await scanService.armLearn(params.patientId);
});

route(scansRouter, 'get', `${S}/:scanId/image`, { tag: 'scans', summary: 'The scan photo (JPEG)' }, async ({ res, params }) => {
  const scan = await scanService.getScan(params.patientId, params.scanId);
  if (!(await storage.exists(scan.imagePath))) throw notFound('not_found', 'The photo was deleted.');
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }).send(await storage.readBytes(scan.imagePath));
});

route(
  scansRouter, 'post', `${S}/:scanId/correct`,
  { tag: 'scans', summary: 'Set the right medicine (or none); it becomes a reference photo', body: z.object({ medicineId: z.number().int().nullable() }) },
  async ({ params, body }) => scanService.correct(params.patientId, params.scanId, body.medicineId),
);
