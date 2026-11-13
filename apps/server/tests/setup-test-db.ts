/**
 * One-time bootstrap for the isolated test database.
 * Run via `pnpm test:setup` (or automatically by `pnpm test`).
 *
 * Applies the same migration file as production, then loads fixtures. Safe to
 * re-run: it truncates first.
 */
import { migrateTestDb, seedTestDb, testPrisma, TEST_DATABASE_URL } from './helpers/test-db.js';
import { loadDotEnv } from '../src/load-env.mjs';

// Load .env before the helper reads TEST_DATABASE_URL at module scope.
loadDotEnv();

const db = testPrisma();

try {
  console.log(`preparing test database at ${TEST_DATABASE_URL.replace(/:[^:@]+@/, ':<redacted>@')}`);
  await migrateTestDb(db);
  const { publicCount } = await seedTestDb(db);
  console.log(`test database ready (${publicCount} published fixture stories)`);
} catch (err) {
  console.error('test database setup failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
