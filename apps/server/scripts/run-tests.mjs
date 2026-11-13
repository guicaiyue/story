#!/usr/bin/env node
/**
 * 跑服务端测试，但先拿一把**数据库级的锁**，保证同一时刻只有一套测试在动 `story_test`。
 *
 * 为什么需要：
 *   测试每次都 `TRUNCATE` + 重跑迁移建表，两套测试连同一个库会互相删表。
 *   2026-11-13 22:20 的 preflight 失败就是这么来的：门禁 `preflight-gate.sh` 自己用
 *   flock 串行化了，但开发容器里还有另一个进程在同一时刻跑 `pnpm test`，
 *   Postgres 留下 `ERROR: tuple concurrently updated`（两条迁移同时
 *   `REVOKE ALL ON ALL TABLES IN SCHEMA app`），服务端测试于是大面积 500、断言失败。
 *   flock 只挡得住「都经过门禁」的调用，挡不住直接进容器跑测试的人。
 *
 * 为什么用 Postgres 咨询锁而不是文件锁：
 *   冲突发生在库上，锁就加在库上。文件锁只在同一台机器/同一个挂载命名空间里有效，
 *   而宿主、开发容器、别的检出都可能连同一个 `story-dev-postgres`。
 *   会话级咨询锁在连接断开时由 Postgres 自动释放，进程被 kill 也不会留下死锁。
 *
 * 用法：`pnpm test`（package.json 的 test 脚本指向这里）。退出码与测试本身一致。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from '../src/load-env.mjs';

loadDotEnv();

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// 任意固定值，只要所有跑这套测试的进程用同一个。改它等于换一把锁。
const LOCK_KEY = 741852963;
const WAIT_LIMIT_MS = 20 * 60 * 1000;
const RETRY_MS = 2000;

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error(
    'TEST_DATABASE_URL 未设置：把 .env.example 复制成 apps/server/.env 并填好测试库连接串（必须是独立的 story_test，不能指向生产库）',
  );
  process.exit(2);
}

// 咨询锁挂在**会话**上，加锁和解锁必须是同一条连接。Prisma 默认用连接池，
// 两次 $queryRaw 可能落在不同连接上，所以这把锁专用一个 connection_limit=1 的客户端。
const lockUrl = (() => {
  const u = new URL(url);
  u.searchParams.set('connection_limit', '1');
  return u.toString();
})();

const db = new PrismaClient({ datasources: { db: { url: lockUrl } }, log: [] });
const redacted = url.replace(/:[^:@]+@/, ':<redacted>@');

async function acquire() {
  const started = Date.now();
  let announced = false;
  for (;;) {
    const rows = await db.$queryRaw`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
    if (rows[0]?.locked === true) return true;
    if (!announced) {
      console.log(`另一个测试进程正在用这个库，等它跑完再开始（${redacted}）`);
      announced = true;
    }
    if (Date.now() - started > WAIT_LIMIT_MS) {
      console.error(
        `等了 ${Math.round(WAIT_LIMIT_MS / 60000)} 分钟仍拿不到测试库的锁：可能有别的测试卡住了。` +
          '先在容器里确认没有残留的 vitest/tsx 进程再重跑。',
      );
      return false;
    }
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}

// 优先用本包自带的 bin，找不到再退回 pnpm exec（两者的行为一致）。
function bin(name) {
  const local = join(root, 'node_modules', '.bin', name);
  return existsSync(local) ? [local, []] : ['pnpm', ['exec', name]];
}

function run(name, args) {
  const [command, prefix] = bin(name);
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...prefix, ...args], { cwd: root, stdio: 'inherit' });
    child.on('close', (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
    child.on('error', (err) => {
      console.error(`起不来 ${name}：${err.message}`);
      resolvePromise(1);
    });
  });
}

async function release() {
  try {
    await db.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  } catch {
    // 连接已经断了也无所谓：会话锁随连接一起消失。
  }
  await db.$disconnect().catch(() => {});
}

let finished = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (finished) return;
    finished = true;
    release().finally(() => process.exit(130));
  });
}

try {
  if (!(await acquire())) {
    await db.$disconnect().catch(() => {});
    process.exit(1);
  }
} catch (err) {
  // 连不上库（容器没起来、库名写错）时给一句人话，别让测试报一堆 500。
  console.error(`连不上测试库 ${redacted}：${err instanceof Error ? err.message : err}`);
  await db.$disconnect().catch(() => {});
  process.exit(1);
}

let code = 1;
try {
  // 与原来的 `tsx tests/setup-test-db.ts && vitest run` 等价，只是中间不再允许别人插进来。
  code = await run('tsx', ['tests/setup-test-db.ts']);
  if (code === 0) code = await run('vitest', ['run']);
} finally {
  finished = true;
  await release();
}

process.exit(code);
