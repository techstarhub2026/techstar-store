import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';

export const prisma = new PrismaClient({
  log: config.isDev ? ['warn', 'error'] : ['error'],
});

/** Rows a customer may see: not soft-deleted. */
export const live = { deletedAt: null } as const;

export async function disconnect() {
  await prisma.$disconnect();
}
