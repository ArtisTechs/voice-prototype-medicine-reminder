import { Router } from 'express';
import { z } from 'zod';
import { route } from '../../core/http';
import { isoDate } from '../../schemas/common';
import * as intakeService from '../../services/intakeService';

export const activityRouter = Router();

route(activityRouter, 'get', '/dashboard', { tag: 'dashboard', summary: 'Home screen: every patient card' }, async ({ user }) => intakeService.dashboard(user));

route(activityRouter, 'get', '/patients/:patientId/today', { tag: 'today', summary: "Today's doses with live status" }, async ({ params }) =>
  intakeService.today(params.patientId),
);

route(
  activityRouter, 'get', '/patients/:patientId/history',
  { tag: 'history', summary: 'Intake history and adherence', query: z.object({ from: isoDate.optional(), to: isoDate.optional() }) },
  async ({ params, query }) => intakeService.history(params.patientId, query.from, query.to),
);
