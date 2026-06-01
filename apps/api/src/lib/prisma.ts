/**
 * Singleton Prisma client. Lazy-initialised so unit tests that don't need a
 * DB don't accidentally open a connection.
 */
import { PrismaClient } from '@prisma/client';
import { getConfig } from '../config.js';

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!client) {
    const { env } = getConfig();
    client = new PrismaClient({
      log: env.FREELLM_LOG_LEVEL === 'debug' || env.FREELLM_LOG_LEVEL === 'trace'
        ? ['query', 'error', 'warn']
        : ['error', 'warn'],
    });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
