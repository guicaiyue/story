import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';
import { AppError } from '../contract.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password.js';

/**
 * SMS delivery adapter (03-decisions D4).
 *
 * M1 sends nothing: this is a no-op that logs. A real provider (Aliyun/Tencent)
 * is plugged in at M3 by implementing this interface — routes never change.
 */
export interface SmsAdapter {
  sendCode(phone: string, code: string): Promise<void>;
}

export class NoopSmsAdapter implements SmsAdapter {
  readonly sent: Array<{ phone: string; code: string; at: string }> = [];

  constructor(private readonly log: (msg: string, meta?: unknown) => void = () => {}) {}

  async sendCode(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code, at: new Date().toISOString() });
    this.log('[sms:noop] verification code not actually sent (M1 placeholder)', {
      phone,
      code,
    });
  }
}

/**
 * Guest login (03-decisions D6): upgrade rules are deliberately undecided, so
 * this only ever creates a standalone guest account. It never binds a phone.
 */
export async function loginAsGuest(db: Db, nickname = '游客'): Promise<{ accountId: string }> {
  const account = await db.account.create({
    data: { nickname, role: 'parent' },
    select: { id: true },
  });
  return { accountId: account.id };
}

/**
 * Phone login with the fixed placeholder code (03-decisions D4).
 *
 * The `phone` is matched against existing accounts so a returning parent keeps
 * their children/progress. Guest->phone linking is intentionally NOT implemented
 * until the upgrade rules are decided (D6).
 */
export async function loginWithPhone(
  db: Db,
  input: { phone: string; code: string; nickname?: string },
  expectedCode: string,
): Promise<{ accountId: string; created: boolean }> {
  if (input.code !== expectedCode) {
    throw AppError.unauthorized('验证码错误');
  }

  const existing = await db.account.findUnique({
    where: { phone: input.phone },
    select: { id: true },
  });
  if (existing) return { accountId: existing.id, created: false };

  const account = await db.account.create({
    data: {
      phone: input.phone,
      nickname: input.nickname ?? `家长${input.phone.slice(-4)}`,
      role: 'parent',
      family: { create: {} },
      setting: { create: {} },
    },
    select: { id: true },
  });
  return { accountId: account.id, created: true };
}

/**
 * 运营后台账号密码登录。
 *
 * 与手机号入口完全分开：这里**不建账号**，未知账号与错密码返回同一个 401，
 * 不泄露账号是否存在。密码校验通过后才检查 role/status —— 这样被停用/无权限
 * 的账号只有在口令正确时才会看到对应提示，不会变成账号枚举通道。
 *
 * 账号存在但没有 passwordHash（迁移前的老管理员）也按「账号或密码错误」处理；
 * 先用 set-admin-password 设置口令，或由管理员在后台重置。
 */
export async function loginWithPassword(
  db: Db,
  input: { username: string; password: string },
): Promise<{ accountId: string; role: string; username: string }> {
  const account = await db.account.findUnique({
    where: { username: input.username },
    select: { id: true, role: true, status: true, username: true, passwordHash: true },
  });

  // 账号不存在时也跑一次同参数 scrypt，避免靠耗时区分账号是否存在。
  const stored = account?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const valid = await verifyPassword(input.password, stored);
  if (!account || !account.passwordHash || !valid) {
    throw AppError.unauthorized('账号或密码错误');
  }

  if (!['admin', 'editor'].includes(account.role)) {
    throw AppError.forbidden('该账号无管理权限');
  }
  // 停用必须真的挡住登录，否则「停用」只是前端视觉效果（M2.1 项目 4）。
  if (account.status !== 'active') {
    throw AppError.forbidden('该账号已被停用');
  }

  return { accountId: account.id, role: account.role, username: account.username ?? input.username };
}
