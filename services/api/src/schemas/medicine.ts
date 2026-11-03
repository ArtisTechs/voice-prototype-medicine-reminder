import { z } from 'zod';
import { blankToNull, hhmm, isoDate, optText } from './common';

const medicineBase = {
  strength: optText(30),
  form: optText(20),
  doseUnit: optText(20),
  instructions: optText(200),
  slot: z.number().int().min(1).max(5).nullish(),
  barcode: z.preprocess(blankToNull, z.string().regex(/^[A-Za-z0-9 \-]{1,64}$/, 'Letters, digits, spaces and - only').nullable()).optional(),
  expiryDate: isoDate.nullish(),
};

export const medicineCreate = z.object({
  ...medicineBase,
  name: z.string().min(1).max(80),
  doseAmount: z.number().int().min(1).max(20).default(1),
  qty: z.number().int().min(0).max(10000).default(0),
  lowStockThreshold: z.number().int().min(0).max(1000).default(5),
  refillLeadDays: z.number().int().min(0).max(60).default(3),
});

export const medicineUpdate = z.object({
  ...medicineBase,
  name: z.string().min(1).max(80).optional(),
  doseAmount: z.number().int().min(1).max(20).optional(),
  qty: z.number().int().min(0).max(10000).optional(),
  lowStockThreshold: z.number().int().min(0).max(1000).optional(),
  refillLeadDays: z.number().int().min(0).max(60).optional(),
});

const days = z
  .array(z.number().int().min(0, 'Days are 0 (Monday) to 6 (Sunday)').max(6, 'Days are 0 (Monday) to 6 (Sunday)'))
  .min(1)
  .max(7)
  .transform((d) => [...new Set(d)].sort((a, b) => a - b));

export const scheduleCreate = z.object({
  time: hhmm,
  daysOfWeek: days.default([0, 1, 2, 3, 4, 5, 6]),
  active: z.boolean().default(true),
});

export const scheduleUpdate = z.object({
  time: hhmm.nullish(),
  daysOfWeek: days.nullish(),
  active: z.boolean().nullish(),
});

export type MedicineCreate = z.infer<typeof medicineCreate>;
export type MedicineUpdate = z.infer<typeof medicineUpdate>;
export type ScheduleCreate = z.infer<typeof scheduleCreate>;
export type ScheduleUpdate = z.infer<typeof scheduleUpdate>;
