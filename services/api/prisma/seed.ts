/**
 * Demo data. Idempotent: does nothing if the demo caregiver exists. `--reset` removes it first.
 *   npm run seed [-- --reset]      (in Docker: make seed / make reset-seed)
 */
import { prisma, disconnect } from '../src/core/prisma';
import { getLogger } from '../src/core/logger';
import { hashPassword } from '../src/core/security';
import { addDays, dbDate, dbTime, deviceToday, doseInstant } from '../src/core/timeutil';
import { DEFAULT_NOTIFY_PREFS } from '../src/schemas/auth';
import * as patientRepo from '../src/repositories/patients';
import * as referenceService from '../src/services/referenceService';

const log = getLogger('seed');

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'demo1234';

export function ean13(body12: string): string {
  const total = [...body12].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0);
  return body12 + String((10 - (total % 10)) % 10);
}

// name, strength, slot, instructions, barcode, expiry, qty, threshold, times
export const DEMO_MEDICINES = [
  { name: 'Losartan', strength: '50mg', slot: 1, instructions: 'After breakfast', barcode: ean13('480012345678'), expiry: '2027-06-30', qty: 24, threshold: 5, times: ['08:00'] },
  { name: 'Metformin', strength: '500mg', slot: 2, instructions: 'With meals', barcode: ean13('480098765432'), expiry: '2027-03-31', qty: 4, threshold: 6, times: ['08:00', '20:00'] },
  // Past its expiry date on purpose, to show the expired state.
  { name: 'Amlodipine', strength: '5mg', slot: 3, instructions: 'After lunch', barcode: ean13('480055512345'), expiry: '2026-09-30', qty: 18, threshold: 5, times: ['13:00'] },
];

export async function reset(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) return;
  for (const { patient } of await patientRepo.forUser(user.id)) await prisma.patient.delete({ where: { id: patient.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

/** Three past days: mostly on time, one late, one missed. */
async function history(patientId: number, medicineId: number, scheduleId: number, time: string, today: string) {
  const pattern: Record<number, [number | null, string]> = { 3: [0, 'taken'], 2: [25, 'taken'], 1: [null, 'missed'] };
  for (const [ago, [delay0, status0]] of Object.entries(pattern)) {
    let [delay, status] = [delay0, status0];
    if (status === 'missed' && scheduleId % 2 === 0) [delay, status] = [4, 'taken'];
    const day = addDays(today, -Number(ago));
    const due = doseInstant(day, time);
    await prisma.intakeRecord.create({
      data: {
        patientId, medicineId, scheduleId, doseDate: dbDate(day), scheduledTime: dbTime(time), status, dueAt: due,
        takenAt: status === 'taken' ? new Date(due.getTime() + (delay ?? 0) * 60_000) : null,
        delayMinutes: status === 'taken' ? delay : null,
      },
    });
  }
}

export async function seed(): Promise<boolean> {
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) return false;
  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD), name: 'Demo Caregiver', notifyPrefs: { ...DEFAULT_NOTIFY_PREFS } },
  });
  const device =
    (await prisma.device.findUnique({ where: { deviceId: 'pillbox' } })) ??
    (await prisma.device.create({ data: { deviceId: 'pillbox', cameraId: 'pillbox-cam', slotState: {} } }));
  const patient = await prisma.patient.create({ data: { displayName: 'Lola Rosa', note: 'Demo patient', deviceId: device.id } });
  await prisma.patientCaregiver.create({ data: { patientId: patient.id, userId: user.id, role: 'owner' } });

  const today = deviceToday();
  const meds = [];
  for (const d of DEMO_MEDICINES) {
    const med = await prisma.medicine.create({
      data: {
        patientId: patient.id, name: d.name, strength: d.strength, form: 'tablet', doseAmount: 1, doseUnit: 'tablet',
        instructions: d.instructions, slot: d.slot, barcode: d.barcode, expiryDate: dbDate(d.expiry), qty: d.qty,
        lowStockThreshold: d.threshold, refillLeadDays: 3,
      },
    });
    meds.push(med);
    for (const t of d.times) {
      const sched = await prisma.schedule.create({ data: { medicineId: med.id, time: dbTime(t), daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } });
      await history(patient.id, med.id, sched.id, t, today);
    }
  }
  await referenceService.seedDemoReferences(meds);
  return true;
}

async function main() {
  if (process.argv.includes('--reset')) {
    await reset();
    log.info('seed_reset');
  }
  const created = await seed();
  log.info('seed_done', { created });
  await disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    log.exception('seed_failed', e);
    process.exit(1);
  });
}
