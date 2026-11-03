import { z } from 'zod';
import { deviceCode } from './common';

export const patientCreate = z.object({
  displayName: z.string().min(1).max(60),
  note: z.string().max(200).nullish(),
});

export const patientUpdate = z.object({
  displayName: z.string().min(1).max(60).optional(),
  note: z.string().max(200).nullish(),
});

export const inviteAccept = z.object({ code: z.string().length(6) });

export const devicePair = z.object({
  deviceId: deviceCode,
  cameraId: deviceCode.nullish(),
});
