/** Image files on the scans volume. Paths are always generated, never taken from input. */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { settings } from './config';

export const root = (): string => settings().SCAN_DIR;

export const isJpeg = (data: Buffer): boolean => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
export const isPng = (data: Buffer): boolean =>
  data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
export const isImage = (data: Buffer): boolean => isJpeg(data) || isPng(data);

export function newRelPath(kind: string, when: Date): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${y}/${m}/${randomUUID().replace(/-/g, '')}.jpg`;
}

/** Resolve a stored relative path, refusing anything that would leave the scans directory. */
export function absolute(rel: string): string {
  const base = path.resolve(root());
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('path escapes the scans directory');
  return full;
}

export async function writeBytes(rel: string, data: Buffer): Promise<void> {
  const full = absolute(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, full);
}

/** Strips EXIF/GPS, applies rotation and normalises size for reference images. */
export async function reencodeJpeg(data: Buffer, maxSide = 1280): Promise<Buffer> {
  return sharp(data).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

export const readBytes = (rel: string): Promise<Buffer> => fs.readFile(absolute(rel));

export async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(absolute(rel));
    return true;
  } catch {
    return false;
  }
}

export async function remove(rel: string): Promise<void> {
  try {
    await fs.unlink(absolute(rel));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
