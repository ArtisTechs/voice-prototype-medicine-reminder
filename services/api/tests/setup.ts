/**
 * Test harness: real MySQL (the *_test database) + real Redis (db 15). Every test starts from an
 * empty database and a frozen clock. Gemini is replaced by a fake (tests/helpers.ts).
 */
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, vi } from 'vitest';

process.env.ENV = 'test';
process.env.EXPO_PUSH_ENABLED = 'false';
process.env.SCAN_DIR = path.join(os.tmpdir(), 'voice-test-scans');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.GEMINI_API_KEY = '';
process.env.DEVICE_PATH_SECRET = '';
process.env.SEED_DEMO = 'false';
process.env.REDIS_URL = `${(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379').replace(/\/\d+$/, '')}/15`;

// Device "now": 2026-10-30 07:00 Asia/Manila (= 2026-10-29 23:00 UTC), a Friday.
export const FROZEN_UTC = new Date('2026-10-29T23:00:00Z');

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_UTC);
  const { prisma } = await import('../src/core/prisma');
  const { redis } = await import('../src/core/redis');
  // Cascades empty every table that hangs off these three.
  await prisma.$transaction([
    prisma.$executeRawUnsafe('DELETE FROM users'),
    prisma.$executeRawUnsafe('DELETE FROM patients'),
    prisma.$executeRawUnsafe('DELETE FROM devices'),
  ]);
  await redis().flushdb();
  const { setVisionClient } = await import('../src/vision/pipeline');
  const { FakeVision } = await import('./helpers');
  setVisionClient(new FakeVision());
});

afterAll(async () => {
  vi.useRealTimers();
  const { disconnect } = await import('../src/core/prisma');
  const { closeRedis } = await import('../src/core/redis');
  await Promise.allSettled([disconnect(), closeRedis()]);
});
