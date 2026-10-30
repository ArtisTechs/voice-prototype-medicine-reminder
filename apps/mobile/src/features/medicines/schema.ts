import { z } from 'zod';

import type { Medicine, MedicineInput } from '../../api/types';

const whole = (label: string, min: number, max: number) =>
  z
    .number({ error: `Enter the ${label} as a number.` })
    .int(`Use a whole number for the ${label}.`)
    .min(min, `The ${label} must be at least ${min}.`)
    .max(max, `The ${label} must be ${max} or less.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .optional()
    .nullable();

export const FORMS = ['tablet', 'capsule', 'liquid', 'other'] as const;

export const medicineSchema = z.object({
  name: z.string().trim().min(1, 'Enter the medicine name.').max(80, 'Use 80 characters or fewer.'),
  strength: optionalText(30),
  form: z.enum(FORMS),
  doseAmount: whole('dose', 1, 20),
  instructions: optionalText(200),
  slot: z.number().int().min(1).max(5).nullable(),
  barcode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{0,64}$/, 'A barcode has only letters, numbers, spaces or dashes.')
    .optional()
    .nullable(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  qty: whole('number of pills', 0, 10000),
  lowStockThreshold: whole('low-stock warning', 0, 1000),
  refillLeadDays: whole('refill reminder', 0, 60),
});
export type MedicineFormValues = z.infer<typeof medicineSchema>;

export const UNIT_FOR_FORM: Record<(typeof FORMS)[number], string> = {
  tablet: 'tablet',
  capsule: 'capsule',
  liquid: 'ml',
  other: 'dose',
};

export const emptyMedicine: MedicineFormValues = {
  name: '',
  strength: '',
  form: 'tablet',
  doseAmount: 1,
  instructions: '',
  slot: null,
  barcode: '',
  expiryDate: null,
  qty: 30,
  lowStockThreshold: 5,
  refillLeadDays: 3,
};

export function fromMedicine(m: Medicine): MedicineFormValues {
  const form = (FORMS as readonly string[]).includes(m.form ?? '') ? (m.form as MedicineFormValues['form']) : 'other';
  return {
    name: m.name,
    strength: m.strength ?? '',
    form,
    doseAmount: m.doseAmount,
    instructions: m.instructions ?? '',
    slot: m.slot,
    barcode: m.barcode ?? '',
    expiryDate: m.expiryDate,
    qty: m.qty,
    lowStockThreshold: m.lowStockThreshold,
    refillLeadDays: m.refillLeadDays,
  };
}

/** Form values -> API body. Empty text becomes null so the server clears it. */
export function toInput(v: MedicineFormValues): MedicineInput {
  const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  return {
    name: v.name.trim(),
    strength: blank(v.strength),
    form: v.form,
    doseAmount: v.doseAmount,
    doseUnit: UNIT_FOR_FORM[v.form],
    instructions: blank(v.instructions),
    slot: v.slot,
    barcode: blank(v.barcode),
    expiryDate: v.expiryDate,
    qty: v.qty,
    lowStockThreshold: v.lowStockThreshold,
    refillLeadDays: v.refillLeadDays,
  };
}

/** Backend field names in validation errors -> form field names (same in camelCase). */
export const SERVER_FIELD: Record<string, keyof MedicineFormValues> = {
  name: 'name',
  strength: 'strength',
  doseAmount: 'doseAmount',
  instructions: 'instructions',
  slot: 'slot',
  barcode: 'barcode',
  expiryDate: 'expiryDate',
  qty: 'qty',
  lowStockThreshold: 'lowStockThreshold',
  refillLeadDays: 'refillLeadDays',
};
