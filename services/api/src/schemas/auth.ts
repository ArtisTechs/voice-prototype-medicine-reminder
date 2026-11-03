import { z } from 'zod';
import { queryBool } from './common';

export const DEFAULT_NOTIFY_PREFS = {
  missed: true,
  taken: false,
  low_stock: true,
  expiry: true,
  expired_dose: true,
  offline: true,
  scan_unknown: true,
  hide_medicine_names: false,
};

export type NotifyPrefs = typeof DEFAULT_NOTIFY_PREFS;

export const signupIn = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80),
});

export const loginIn = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export const refreshIn = z.object({ refreshToken: z.string().min(10).max(2048) });

export const logoutIn = z.object({
  refreshToken: z.string().nullish(),
  pushToken: z.string().nullish(),
});

/** The app sends camelCase; the database keeps snake_case keys (see DEFAULT_NOTIFY_PREFS). */
export const notifyPrefsIn = z.object({
  missed: z.boolean().default(true),
  taken: z.boolean().default(false),
  lowStock: z.boolean().default(true),
  expiry: z.boolean().default(true),
  expiredDose: z.boolean().default(true),
  offline: z.boolean().default(true),
  scanUnknown: z.boolean().default(true),
  hideMedicineNames: z.boolean().default(false),
});

const SNAKE: Record<string, string> = {
  lowStock: 'low_stock', expiredDose: 'expired_dose', scanUnknown: 'scan_unknown', hideMedicineNames: 'hide_medicine_names',
};

export function prefsToDb(p: z.infer<typeof notifyPrefsIn>): NotifyPrefs {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [SNAKE[k] ?? k, v])) as NotifyPrefs;
}

export function prefsToApi(stored: unknown) {
  const merged = { ...DEFAULT_NOTIFY_PREFS, ...((stored as Partial<NotifyPrefs>) ?? {}) };
  return {
    missed: merged.missed, taken: merged.taken, lowStock: merged.low_stock, expiry: merged.expiry,
    expiredDose: merged.expired_dose, offline: merged.offline, scanUnknown: merged.scan_unknown,
    hideMedicineNames: merged.hide_medicine_names,
  };
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.includes('/') || tz === 'UTC';
  } catch {
    return false;
  }
}

export const meUpdate = z.object({
  name: z.string().min(1).max(80).optional(),
  timezone: z.string().refine(validZone, 'Unknown time zone').optional(),
  notifyPrefs: notifyPrefsIn.optional(),
});

export const pushTokenIn = z.object({
  token: z.string().min(10).max(255).regex(/^(ExponentPushToken|ExpoPushToken)\[.+\]$/, 'Not an Expo push token'),
  platform: z.enum(['ios', 'android', 'web', 'unknown']).default('unknown'),
});

export const alertsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  unread: queryBool,
  patientId: z.coerce.number().int().optional(),
});
