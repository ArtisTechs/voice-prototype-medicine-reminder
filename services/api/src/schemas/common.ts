import { z } from 'zod';

/** Blank or whitespace-only text becomes null, so forms can send "" for "nothing". */
export const blankToNull = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v);

export const optText = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable()).optional();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a real date');

export const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a 24-hour time like 08:00')
  .transform((s) => s.slice(0, 5));

export const queryBool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

export const deviceCode = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - and _');

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
