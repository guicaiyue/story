import { PrismaClient } from '@prisma/client';

/**
 * Prisma reads the real production `story` database in place (03-decisions D1):
 * legacy `public` tables are queried directly, new tables live in `app`.
 * No data migration, no legacyId.
 */
export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: [{ level: 'warn', emit: 'stdout' }],
  });
}

export type Db = PrismaClient;
