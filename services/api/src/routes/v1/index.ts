import express, { Router } from 'express';
import { settings } from '../../core/config';
import { route } from '../../core/http';
import { deviceIso } from '../../core/timeutil';
import { activityRouter } from './activity';
import { alertsRouter } from './alerts';
import { authRouter } from './auth';
import { medicinesRouter } from './medicines';
import { meRouter } from './me';
import { patientsRouter } from './patients';
import { scansRouter } from './scans';

export const v1Router = Router();
v1Router.use(express.json({ limit: '100kb' }));

/** Public, no personal data. The app's first screen calls this to show the server is reachable. */
route(v1Router, 'get', '/meta', { tag: 'meta', summary: 'Server reachable?', auth: false }, async () => ({
  name: 'VOICE API',
  version: '1.0.0',
  deviceTz: settings().DEVICE_TZ,
  serverTime: deviceIso(),
}));

for (const r of [authRouter, meRouter, patientsRouter, medicinesRouter, scansRouter, activityRouter, alertsRouter]) v1Router.use(r);
