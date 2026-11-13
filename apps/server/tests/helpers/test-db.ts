/**
 * Rebuilds the isolated test database (`story_test`) from the real migration
 * file plus a small deterministic fixture set.
 *
 * Tests must never run against production `story`: the fixture inserts only a
 * handful of rows, so tests can assert exact counts while the real database
 * keeps its 2197 rows.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { splitStatements } from '../../scripts/split-sql.mjs';
import { loadDotEnv } from '../../src/load-env.mjs';

// Must run at module scope: TEST_DATABASE_URL below is evaluated on import, and
// test files build their client from it before any test body executes.
loadDotEnv();

const here = dirname(fileURLToPath(import.meta.url));
const PRISMA_DIR = join(here, '..', '..', 'prisma');
const LEGACY_SCHEMA = join(PRISMA_DIR, 'legacy-schema.sql');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');

// No fallback connection string on purpose: a hard-coded default here once
// carried the production superuser password into a public repository. Tests
// must name their database explicitly (apps/server/.env, see .env.example), and
// that database must never be production.
const configured = process.env.TEST_DATABASE_URL;
if (!configured) {
  throw new Error(
    'TEST_DATABASE_URL 未设置：把 .env.example 复制成 apps/server/.env 并填好测试库连接串（必须是独立的 story_test，不能指向生产库）',
  );
}

export const TEST_DATABASE_URL: string = configured;

/**
 * Rebuilds the test database from scratch:
 *   1. legacy pre-M1 tables (a faithful replica of production before migration)
 *   2. **every** migration in prisma/migrations, in filename order
 *
 * Step 1 matters: the init migration ALTERs the legacy tables, so it can only
 * run against a database that already has them.
 *
 * Migrations are discovered rather than hard-coded: hard-coding a single file
 * means a newly added migration is silently skipped here, so tests would pass
 * against a stale schema and only fail in production. That is the exact drift
 * this helper must not have.
 */
export async function migrateTestDb(db: PrismaClient): Promise<void> {
  const legacy = await readFile(LEGACY_SCHEMA, 'utf8');
  for (const statement of splitStatements(legacy)) {
    await db.$executeRawUnsafe(statement);
  }

  const dirs = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (dirs.length === 0) {
    throw new Error(`no migrations found under ${MIGRATIONS_DIR}`);
  }

  for (const dir of dirs) {
    const sql = await readFile(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
    for (const statement of splitStatements(sql)) {
      await db.$executeRawUnsafe(statement);
    }
  }
}

/** Deterministic fixtures. Wipes app data and legacy rows first. */
export async function seedTestDb(db: PrismaClient): Promise<{ storyIds: number[]; publicCount: number }> {
  await db.$executeRawUnsafe('TRUNCATE app.play_event, app.favorite, app.progress, app.setting, app.child, app.family, app.account, app.banner, app.audit_log CASCADE');
  await db.$executeRawUnsafe('TRUNCATE public.story_content, public.story_main, public.story_category RESTART IDENTITY CASCADE');

  const bedtime = await db.category.create({ data: { name: '睡前故事', sortId: 10 } });
  const classics = await db.category.create({ data: { name: '经典故事', sortId: 0 } });
  const spooky = await db.category.create({ data: { name: '恐怖故事', sortId: 0 } });

  const rows = [
    { title: '小兔子找月亮', categoryId: bedtime.id, ageBand: '3-6', status: 'published', featured: true, length: 320 },
    { title: '勇敢的小刺猬', categoryId: bedtime.id, ageBand: '3-6', status: 'published', featured: false, length: 410 },
    { title: '会飞的种子', categoryId: classics.id, ageBand: '6-9', status: 'published', featured: false, length: 900 },
    { title: '深夜怪谈', categoryId: spooky.id, ageBand: '9+', status: 'published', featured: false, length: 1500 },
    { title: '尚未完成的草稿', categoryId: classics.id, ageBand: '3-6', status: 'draft', featured: false, length: 100 },
  ];

  const storyIds: number[] = [];
  for (const row of rows) {
    const story = await db.story.create({ data: { ...row, excerpt: `${row.title} 的简介` } });
    storyIds.push(story.id);
    await db.storyContent.create({ data: { storyId: story.id, content: `${row.title} 的正文内容。\n第二段。` } });
  }

  return { storyIds, publicCount: rows.filter((r) => r.status === 'published').length };
}

export function testPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } }, log: [] });
}
