/**
 * ESP32 contract. FROZEN: field names and types must match the firmware exactly.
 * See .claude/skills/device-contract.
 */
import { z } from 'zod';

// Firmware buffer limits (chars, ASCII).
export const SCHEDULE_LIMITS = { name: 23, dose: 15, instructions: 39, expiry: 10 } as const;
export const SCAN_LIMITS = { name: 31, dose: 19, instructions: 63, expiry: 10 } as const;
export const MAX_DOSES = 20;

export const EVENT_TYPES = [
  'due', 'taken', 'missed', 'expired', 'opened', 'closed', 'scan_ok', 'scan_expired', 'scan_unknown', 'scan_fail',
] as const;

export interface DoseOut {
  id: number;
  slot: number;
  name: string;
  dose: string;
  time: string;
  instructions: string;
  expiry: string;
  qty: number;
}

export interface ScanFound {
  found: true;
  name: string;
  dose: string;
  instructions: string;
  expiry: string;
  slot: number;
  qty: number;
  low: boolean;
  expired: boolean;
}

export const scheduleQuery = z.object({ device: z.string().min(1).max(32) });

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** The firmware sends Philippine local time without an offset; an offset, if present, is dropped. */
export const wallClock = z.string().transform((s, ctx) => {
  const m = WALL_CLOCK.exec(s.trim());
  const bad = () => {
    ctx.addIssue({ code: 'custom', message: 'Use the format YYYY-MM-DDTHH:MM:SS' });
    return z.NEVER;
  };
  if (!m) return bad();
  const [, y, mo, d, h, mi, sec] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec ?? 0)));
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || +h > 23 || +mi > 59 || +(sec ?? 0) > 59) return bad();
  return date; // wall-clock value held as if it were UTC
});

export const eventIn = z.object({
  device: z.string().min(1).max(32),
  type: z.string().min(1).max(20),
  slot: z.number().int().min(0).max(5).nullish(),
  doseId: z.number().int().min(0).nullish(),
  time: wallClock,
});

export type EventIn = z.infer<typeof eventIn>;
