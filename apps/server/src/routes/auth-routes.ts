import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ok } from '../contract.js';
import type { SmsAdapter } from '../services/auth-service.js';
import { loginAsGuest, loginWithPassword, loginWithPhone } from '../services/auth-service.js';

const PhoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确');

/** C 端（App）手机号 + 验证码登录，保持不变。 */
const LoginBody = z.object({
  phone: PhoneSchema,
  code: z.string().min(4).max(8),
  nickname: z.string().trim().min(1).max(30).optional(),
});

/**
 * 运营后台账号 + 密码登录。
 *
 * 不走 `LoginBody`：后台不再接受手机号/验证码，web 端也不出现这些字段。
 * 长度上限只防超大请求；真正的口令强度由新增管理员那侧的规则保证。
 */
const AdminLoginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

const GuestBody = z.object({ nickname: z.string().trim().min(1).max(30).optional() });

/** 03-decisions D4: only the adapter is real; delivery is a no-op in M1. */
export function registerAuthRoutes(app: FastifyInstance, db: Db, sms: SmsAdapter, fixedCode: string): void {
  app.post('/api/auth/register-device', async (req) => {
    const body = GuestBody.parse(req.body ?? {});
    const { accountId } = await loginAsGuest(db, body.nickname ?? '游客');
    const token = app.jwt.sign({ sub: accountId, role: 'parent' });
    return ok({ token, accountId, role: 'parent', guest: true });
  });

  app.post('/api/auth/login', async (req) => {
    const body = LoginBody.parse(req.body);
    const { accountId, created } = await loginWithPhone(db, body, fixedCode);
    const token = app.jwt.sign({ sub: accountId, role: 'parent' });
    return ok({ token, accountId, role: 'parent', created });
  });

  /**
   * Request a verification code. In M1 the adapter is a no-op, so this endpoint
   * exists to keep the client contract stable until a real provider lands (M3).
   */
  app.post('/api/auth/send-code', async (req) => {
    const { phone } = z.object({ phone: PhoneSchema }).parse(req.body);
    await sms.sendCode(phone, fixedCode);
    return ok({ sent: true, channel: 'noop' });
  });

  /**
   * 02-architecture §4.2 admin login.
   *
   * 账号 + 密码；role/status 校验与 auditLog 三条既有行为保留。
   * 错误文案统一由 loginWithPassword 给出（未知账号/错密码都是 401）。
   */
  app.post('/api/admin/auth/login', async (req) => {
    const body = AdminLoginBody.parse(req.body);
    const { accountId, role, username } = await loginWithPassword(db, body);

    await db.auditLog.create({
      data: {
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: accountId,
        action: 'login',
        target: 'admin',
      },
    });

    const token = app.jwt.sign({ sub: accountId, role });
    return ok({ token, accountId, role, username });
  });
}
