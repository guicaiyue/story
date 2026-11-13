#!/usr/bin/env node
/**
 * 本项目的迁移执行器（migrate.mjs）—— 按序应用 prisma/migrations/<name>/migration.sql。
 *
 * ===========================================================================
 * 为什么不用 `prisma migrate deploy`
 * ===========================================================================
 * 生产库与 dev 克隆都是 **Prisma 之前就存在的老库**：里面已经有表（2197 条线上
 * 内容），而且**没有 Prisma 的迁移历史**。`prisma migrate deploy` 对非空库会直接
 * 以 **P3005**（"The database schema is not empty"）拒绝执行 —— 这是 Prisma 对
 * 既有库的设计行为，不是配置问题。要绕过它只能逐条
 * `prisma migrate resolve --applied <name>` 手工替 Prisma 维护账本，收益为零。
 *
 * 所以：
 *   * **老库 / 非空库 / dev 克隆 / 生产库 → 一律用本脚本**（幂等、可重复）；
 *   * `prisma migrate deploy` **只用于全新空库**（仅此场景它才有意义）。
 *   口径详见 docs/product/07-m4-plan.md §4。
 *
 * ===========================================================================
 * 工作方式
 * ===========================================================================
 *   * 按目录名字典序读取 prisma/migrations/*\/migration.sql；
 *   * 用 public._m1_migrations 记录「是否已应用」，所以可反复重跑；
 *   * 每个迁移文件本身也写成幂等的（第二道防线）；
 *   * **首次成功执行后**写一条 baseline 标记到 public._m1_baseline，记录
 *     「本次基线是在何时、由谁、对哪个库、把哪些版本视为已应用」。
 *     该标记只写一次（ON CONFLICT DO NOTHING），重跑不会覆盖首次时间。
 *
 * ===========================================================================
 * 用法
 * ===========================================================================
 *   node scripts/migrate.mjs                       # 应用待执行迁移
 *   node scripts/migrate.mjs --status              # 只读：打印账本 + 基线 + 待执行
 *   node scripts/migrate.mjs --mark-applied <name>...
 *                                                  # 老库专用：把**已存在**的迁移
 *                                                  # 记为已应用但**不执行**它们，
 *                                                  # 相当于 `prisma migrate resolve
 *                                                  # --applied` 的替代品
 *
 * 环境变量：DATABASE_URL（必填；也可写在 apps/server/.env，见 load-env.mjs）。
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { splitStatements } from './split-sql.mjs';
import { loadDotEnv } from '../src/load-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', 'prisma', 'migrations');

const LEDGER_TABLE = 'public._m1_migrations';
const BASELINE_TABLE = 'public._m1_baseline';
const RUNNER_NAME = 'migrate.mjs';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
const flags = { status: false, help: false, markApplied: [] };

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--status') {
    flags.status = true;
  } else if (a === '--help' || a === '-h') {
    flags.help = true;
  } else if (a === '--mark-applied') {
    // 消费后续所有非 -- 开头的参数
    while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags.markApplied.push(argv[i + 1]);
      i += 1;
    }
  } else if (a.startsWith('--mark-applied=')) {
    flags.markApplied.push(...a.slice('--mark-applied='.length).split(',').filter(Boolean));
  } else {
    console.error(`未知参数：${a}（用 --help 看用法）`);
    process.exit(2);
  }
}

if (flags.help) {
  console.log(`用法：
  node scripts/migrate.mjs                        应用待执行迁移
  node scripts/migrate.mjs --status               只读：账本 + 基线 + 待执行
  node scripts/migrate.mjs --mark-applied <name>  把已存在的迁移记为已应用（不执行）`);
  process.exit(0);
}

loadDotEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required, e.g.:');
  console.error('  DATABASE_URL=postgresql://user:pass@host:5432/story node scripts/migrate.mjs');
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });

/** 磁盘上所有迁移目录名（字典序 = 应用顺序）。 */
async function migrationNames() {
  return (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** 账本是否存在（用 to_regclass，避免 information_schema 的 schema 歧义）。 */
async function ledgerExists() {
  const r = await db.$queryRawUnsafe(
    `SELECT to_regclass('${LEDGER_TABLE}') IS NOT NULL AS present`,
  );
  return r[0]?.present === true;
}

async function ensureLedger() {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

async function ensureBaselineTable() {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${BASELINE_TABLE} (
      id               text PRIMARY KEY,
      baseline_at      timestamptz NOT NULL DEFAULT now(),
      baseline_by      text NOT NULL DEFAULT current_user,
      database_name    text NOT NULL DEFAULT current_database(),
      runner           text NOT NULL DEFAULT '${RUNNER_NAME}',
      applied_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
      note             text
    )`);
}

async function appliedSet() {
  const rows = await db.$queryRawUnsafe(`SELECT name FROM ${LEDGER_TABLE}`);
  return new Set(rows.map((r) => r.name));
}

async function readBaseline() {
  const r = await db.$queryRawUnsafe(
    `SELECT baseline_at, baseline_by, database_name, runner, applied_versions, note
       FROM ${BASELINE_TABLE} WHERE id = 'baseline'`,
  );
  return r[0] ?? null;
}

/**
 * 写 baseline 标记 —— **只在不存在时写**，保留首次执行的时间。
 * 这就是「首次执行后记录已应用版本」的那一条记录。
 */
async function writeBaselineOnce(applied, note) {
  await ensureBaselineTable();
  const versions = JSON.stringify([...applied].sort());
  await db.$executeRawUnsafe(
    `INSERT INTO ${BASELINE_TABLE} (id, applied_versions, note)
     VALUES ('baseline', $1::jsonb, $2)
     ON CONFLICT (id) DO NOTHING`,
    versions,
    note,
  );
}

try {
  // -------------------------------------------------------------------------
  // --status：只读，不建表、不写入
  // -------------------------------------------------------------------------
  if (flags.status) {
    const names = await migrationNames();
    const hasLedger = await ledgerExists();
    const applied = hasLedger ? await appliedSet() : new Set();
    const hasBaselineTable = (
      await db.$queryRawUnsafe(`SELECT to_regclass('${BASELINE_TABLE}') IS NOT NULL AS present`)
    )[0]?.present === true;

    console.log(`迁移目录：${names.length} 个`);
    console.log(`账本 ${LEDGER_TABLE}：${hasLedger ? '存在' : '不存在'}`);
    for (const n of names) {
      console.log(`  ${applied.has(n) ? 'applied' : 'pending'}  ${n}`);
    }

    const pending = names.filter((n) => !applied.has(n));
    console.log(pending.length === 0 ? '待执行：无（已是最新）' : `待执行：${pending.length} 个`);

    if (hasBaselineTable) {
      const b = await readBaseline();
      if (b) {
        console.log(`\nbaseline 标记：`);
        console.log(`  时间     : ${b.baseline_at?.toISOString?.() ?? b.baseline_at}`);
        console.log(`  执行者   : ${b.baseline_by}`);
        console.log(`  数据库   : ${b.database_name}`);
        console.log(`  runner   : ${b.runner}`);
        console.log(`  已应用版本: ${JSON.stringify(b.applied_versions)}`);
        if (b.note) console.log(`  备注     : ${b.note}`);
      } else {
        console.log('\nbaseline 标记：无（该库尚未被本 runner 执行过）');
      }
    } else {
      console.log(`\nbaseline 标记：表 ${BASELINE_TABLE} 不存在（该库尚未被本 runner 执行过）`);
    }
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // --mark-applied：把**已存在**的迁移记为已应用，但不执行
  //
  // 老库专用路径：库里已经有这些变更（例如生产库的 M1 既成基线），但账本里
  // 没有记录。此时**不能**去执行它们（会重复跑 UPDATE/DELETE），只应记账。
  // 名称必须显式给出，且必须在磁盘上存在 —— 不做「把所有迁移都标记上」这种
  // 危险默认。
  // -------------------------------------------------------------------------
  if (flags.markApplied.length > 0) {
    const names = await migrationNames();
    const unknown = flags.markApplied.filter((n) => !names.includes(n));
    if (unknown.length > 0) {
      console.error(`这些迁移名在 prisma/migrations/ 下不存在，拒绝标记：${unknown.join(', ')}`);
      console.error(`磁盘上可用的迁移：${names.join(', ')}`);
      process.exit(2);
    }

    await ensureLedger();
    const applied = await appliedSet();
    let marked = 0;
    for (const n of flags.markApplied) {
      if (applied.has(n)) {
        console.log(`skip  ${n} (already recorded)`);
        continue;
      }
      await db.$executeRawUnsafe(`INSERT INTO ${LEDGER_TABLE} (name) VALUES ($1)`, n);
      applied.add(n);
      console.log(`mark  ${n} (recorded as applied WITHOUT executing)`);
      marked += 1;
    }

    await writeBaselineOnce(
      applied,
      `baseline via --mark-applied (${marked} version(s) recorded without executing)`,
    );
    console.log(
      marked === 0
        ? '没有新增标记；baseline 标记保持不变。'
        : `已标记 ${marked} 个版本为「已应用（未执行）」。`,
    );
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // 正常路径：应用待执行迁移
  // -------------------------------------------------------------------------
  const existedBefore = await ledgerExists();
  await ensureLedger();

  const names = await migrationNames();
  const applied = await appliedSet();

  let ran = 0;
  for (const name of names) {
    if (applied.has(name)) {
      console.log(`skip  ${name} (already applied)`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
    console.log(`apply ${name}`);
    for (const statement of splitStatements(sql)) {
      await db.$executeRawUnsafe(statement);
    }
    await db.$executeRawUnsafe(`INSERT INTO ${LEDGER_TABLE} (name) VALUES ($1)`, name);
    applied.add(name);
    ran += 1;
  }

  console.log(ran === 0 ? 'Database is up to date.' : `Applied ${ran} migration(s).`);

  // 首次执行后写 baseline 标记（记录已应用版本）。
  const note = existedBefore
    ? `baseline written after applying ${ran} migration(s); ledger pre-existed`
    : `baseline written on first run of ${RUNNER_NAME}; ledger created and ${ran} migration(s) applied`;
  await writeBaselineOnce(applied, note);

  const b = await readBaseline();
  if (b) {
    // baseline 是**首次执行那一刻**的冻结记录，故意不随后续迁移更新
    // （ON CONFLICT DO NOTHING）。所以这里把「冻结的基线」与「当前账本」
    // 分开报，避免看起来像数字对不上。
    console.log(
      `baseline (frozen at ${b.baseline_at?.toISOString?.() ?? b.baseline_at} by ` +
        `${b.baseline_by} on ${b.database_name}): ${b.applied_versions?.length ?? 0} version(s)`,
    );
    console.log(`ledger: ${applied.size}/${names.length} migration(s) applied`);
  }
} catch (err) {
  console.error('migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
