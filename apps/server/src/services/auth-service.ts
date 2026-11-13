import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.js';
import { AppError } from '../contract.js';

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
