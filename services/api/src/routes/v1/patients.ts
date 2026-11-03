import type { Patient } from '@prisma/client';
import { Router } from 'express';
import { route } from '../../core/http';
import * as patientRepo from '../../repositories/patients';
import { devicePair, inviteAccept, patientCreate, patientUpdate } from '../../schemas/patient';
import * as patientService from '../../services/patientService';

export const patientsRouter = Router();

const out = (p: Patient, role: string) => ({ id: p.id, displayName: p.displayName, note: p.note, role });

route(patientsRouter, 'get', '/patients', { tag: 'patients', summary: 'Patients I look after' }, async ({ user }) =>
  (await patientRepo.forUser(user.id)).map((r) => out(r.patient, r.role)),
);

route(patientsRouter, 'post', '/patients', { tag: 'patients', summary: 'Add a patient', body: patientCreate, status: 201 }, async ({ user, body }) =>
  out(await patientService.createPatient(user, body), 'owner'),
);

route(patientsRouter, 'get', '/patients/:patientId', { tag: 'patients', summary: 'One patient' }, async ({ params, link }) =>
  out((await patientRepo.byId(params.patientId)) as Patient, link.role),
);

route(patientsRouter, 'patch', '/patients/:patientId', { tag: 'patients', summary: 'Rename a patient', body: patientUpdate }, async ({ params, body, link }) =>
  out(await patientService.updatePatient(params.patientId, body), link.role),
);

/** Owner only: deletes the patient and all their data and photos. */
route(patientsRouter, 'delete', '/patients/:patientId', { tag: 'patients', summary: 'Delete a patient and all their data', owner: true, status: 204 }, async ({ params }) => {
  await patientService.deletePatient(params.patientId);
});

route(patientsRouter, 'post', '/patients/:patientId/leave', { tag: 'patients', summary: 'Stop looking after this patient', status: 204 }, async ({ user, params }) => {
  await patientService.leavePatient(user, params.patientId);
});

// ---- caregivers + invites -----------------------------------------------------------------------

route(patientsRouter, 'get', '/patients/:patientId/caregivers', { tag: 'invites', summary: 'Caregivers of a patient' }, async ({ params }) =>
  (await patientRepo.caregivers(params.patientId)).map((c) => ({ id: c.user.id, name: c.user.name, role: c.role })),
);

route(patientsRouter, 'post', '/patients/:patientId/invites', { tag: 'invites', summary: 'Create an invite code', status: 201 }, async ({ user, params }) => {
  const invite = await patientService.createInvite(user, params.patientId);
  return { code: invite.code, expiresAt: invite.expiresAt };
});

route(patientsRouter, 'post', '/invites/accept', { tag: 'invites', summary: 'Join a patient with an invite code', body: inviteAccept }, async ({ user, body }) => {
  const patient = await patientService.acceptInvite(user, body.code);
  const link = await patientRepo.link(user.id, patient.id);
  return out(patient, link?.role ?? 'member');
});

// ---- device pairing -------------------------------------------------------------------------------

route(patientsRouter, 'get', '/patients/:patientId/device', { tag: 'devices', summary: 'Paired VOICE and its slots' }, async ({ user, params }) =>
  patientService.deviceStatus(user, params.patientId),
);

route(patientsRouter, 'put', '/patients/:patientId/device', { tag: 'devices', summary: 'Pair a VOICE by its code', body: devicePair }, async ({ user, params, body }) => {
  await patientService.pairDevice(params.patientId, body);
  return patientService.deviceStatus(user, params.patientId);
});

route(patientsRouter, 'delete', '/patients/:patientId/device', { tag: 'devices', summary: 'Unpair the VOICE', status: 204 }, async ({ params }) => {
  await patientService.unpairDevice(params.patientId);
});

route(patientsRouter, 'get', '/devices/nearby', { tag: 'devices', summary: 'VOICEs to offer when pairing' }, async ({ user }) =>
  patientService.nearbyDevices(user),
);
