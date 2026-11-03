import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../core/prisma';

export const create = (data: Prisma.ScanUncheckedCreateInput, db: Db = prisma) => db.scan.create({ data });
export const get = (patientId: number, id: number, db: Db = prisma) => db.scan.findFirst({ where: { id, patientId } });
export const update = (id: number, data: Prisma.ScanUncheckedUpdateInput, db: Db = prisma) => db.scan.update({ where: { id }, data });

export async function list(patientId: number, limit: number, offset: number) {
  const [total, items] = await Promise.all([
    prisma.scan.count({ where: { patientId } }),
    prisma.scan.findMany({ where: { patientId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset }),
  ]);
  return { total, items };
}

export const olderThan = (before: Date) => prisma.scan.findMany({ where: { createdAt: { lt: before } } });
export const deleteByIds = (ids: number[]) => prisma.scan.deleteMany({ where: { id: { in: ids } } });
export const imagePathsForPatient = async (patientId: number) =>
  (await prisma.scan.findMany({ where: { patientId }, select: { imagePath: true } })).map((s) => s.imagePath);
export const referencePathsForPatient = async (patientId: number) =>
  (await prisma.referenceImage.findMany({ where: { medicine: { patientId } }, select: { path: true } })).map((r) => r.path);
