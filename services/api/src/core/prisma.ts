import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ log: ['warn'] });

/** A Prisma client or the one handed to a $transaction callback. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
