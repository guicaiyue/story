#!/usr/bin/env node
/**
 * 给已有管理员设置登录名 / 重置密码（一次性运维脚本）。
 *
 * 为什么需要它：后台登录从「手机号 + 验证码」改成「账号 + 密码」后，
 * 迁移前就存在的管理员（包括生产首个 admin）没有 username/password_hash，
 * 直接上线会让所有人进不了后台。上线窗口里先用它给首个管理员补凭证。
 *
 * 用法：
 *   # dev（默认库来自 apps/server/.env）
 *   node scripts/set-admin-password.mjs --username admin --password 'dev-admin-password'
 *
 *   # 指定某个管理员
 *   node scripts/set-admin-password.mjs --account-id acc_xxx --username editor --password '...'
 *
 *   # 生产：必须显式给迁移连接串 + --confirm-prod（DDL/写入都要批准）
 *   DATABASE_URL="$PROD_MIGRATE_DATABASE_URL" \
 *     node scripts/set-admin-password.mjs --username admin --password '...' --confirm-prod
 *
 * 口令只以哈希落库；输出不会打印明文。
 */
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from '../src/load-env.mjs';
import { hashPassword } from './hash-password.mjs';

loadDotEnv();

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${name} 需要一个值`);
    process.exit(2);
  }
  return value;
};

const accountId = valueOf('--account-id');
const username = valueOf('--username');
const password = valueOf('--password') ?? process.env.ADMIN_PASSWORD;
const confirmProd = args.includes('--confirm-prod');

if (!username || !password) {
  console.error("用法：node scripts/set-admin-password.mjs --username <账号> --password <口令> [--account-id <id>] [--confirm-prod]");
  process.exit(2);
}
if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
  console.error('账号需为 3–32 位字母、数字、点、下划线或连字符');
  process.exit(2);
}
if (password.length < 8 || password.length > 128) {
  console.error('口令需为 8–128 个字符');
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
// 与 seed-dev-admin.mjs 同一口径：生产库名恰好是 `story`；dev/test 是 story_dev / story_test。
if (/\/story(\?|$)/.test(url) && !confirmProd) {
  console.error('REFUSING TO RUN: DATABASE_URL 看起来指向生产 story 库。');
  console.error('生产写入需要批准；确认后加 --confirm-prod 再跑。');
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const account = accountId
    ? await db.account.findUnique({ where: { id: accountId }, select: { id: true, role: true, username: true } })
    : await db.account.findFirst({
        where: { role: 'admin' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, username: true },
      });

  if (!account) {
    console.error(accountId ? `找不到账号 ${accountId}` : '找不到任何 admin 账号');
    process.exitCode = 1;
    return;
  }

  const clash = await db.account.findUnique({ where: { username }, select: { id: true } });
  if (clash && clash.id !== account.id) {
    console.error(`账号名 ${username} 已被 ${clash.id} 占用`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.account.update({ where: { id: account.id }, data: { username, passwordHash } });

  await db.auditLog.create({
    data: {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actorId: 'system',
      action: 'account.credential.set',
      target: account.id,
      detail: { username },
    },
  });

  console.log(`updated ${account.id}: username=${username} password=<hashed>`);
}

main()
  .catch((err) => {
    console.error('set-admin-password failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
