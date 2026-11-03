/**
 * Time helpers. Instants are UTC `Date`s; device wall-clock times are DEVICE_TZ (Asia/Manila).
 * Local dates travel as 'YYYY-MM-DD' strings and local times as 'HH:MM' strings; the database
 * stores them in DATE / TIME columns, which Prisma hands over as UTC-midnight / 1970-01-01 Dates.
 */
import { settings } from './config';

export const utcnow = (): Date => new Date();

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function partsIn(instant: Date, tz = settings().DEVICE_TZ): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(instant)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out as unknown as Parts;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The wall clock in `tz` expressed as if it were UTC (milliseconds). */
function wallMs(instant: Date, tz: string): number {
  const p = partsIn(instant, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

export function deviceDate(instant: Date = utcnow(), tz = settings().DEVICE_TZ): string {
  const p = partsIn(instant, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** ISO-8601 with the zone's offset, to the second: 2026-10-30T07:00:00+08:00 */
export function deviceIso(instant: Date = utcnow(), tz = settings().DEVICE_TZ): string {
  const p = partsIn(instant, tz);
  const offMin = Math.round((wallMs(instant, tz) - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  const date = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
  return `${date}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Device-local date today. */
export const deviceToday = (): string => deviceDate();

/** 'HH:MM' on the device clock. */
export function deviceClock(instant: Date, tz = settings().DEVICE_TZ): string {
  const p = partsIn(instant, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** A device wall-clock moment (held in a Date as if it were UTC) -> the real UTC instant. */
export function localToUtc(local: Date, tz = settings().DEVICE_TZ): Date {
  const guess = local.getTime();
  let instant = guess - (wallMs(new Date(guess), tz) - guess);
  instant = guess - (wallMs(new Date(instant), tz) - instant); // settle across a DST edge
  return new Date(instant);
}

/** The UTC instant of a wall-clock dose time ('HH:MM') on a device-local date. */
export function doseInstant(day: string, hhmm: string): Date {
  return localToUtc(new Date(`${day}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}Z`));
}

/** Mon=0 .. Sun=6 */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export const minutesBetween = (a: Date, b: Date): number => Math.trunc((b.getTime() - a.getTime()) / 60000);

// ---- DB column conversions ----------------------------------------------------------------

export const dbDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
export const fromDbDate = (d: Date): string => d.toISOString().slice(0, 10);
export const dbTime = (hhmm: string): Date => new Date(`1970-01-01T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}Z`);
export const fromDbTime = (d: Date): string => d.toISOString().slice(11, 16);

/** 'h:mm AM/PM' for alert text. */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
