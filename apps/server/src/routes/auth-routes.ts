import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ok, AppError } from '../contract.js';
import type { SmsAdapter } from '../services/auth-service.js';
import { loginAsGuest, loginWithPhone } from '../services/auth-service.js';

const PhoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确');

const LoginBody = z.object({
  phone: PhoneSchema,
  code: z.string().min(4).max(8),
  nickname: z.string().trim().min(1).max(30).optional(),
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

  /** 02-architecture §4.2 admin login. M1 uses the same fixed-code flow. */
  app.post('/api/admin/auth/login', async (req) => {
    const body = LoginBody.parse(req.body);
    const { accountId } = await loginWithPhone(db, body, fixedCode);

    const account = await db.account.findUnique({ where: { id: accountId }, select: { role: true, status: true } });
    if (!account || !['admin', 'editor'].includes(account.role)) {
      throw AppError.forbidden('该账号无管理权限');
    }
    // 停用必须真的挡住登录，否则「停用」只是前端视觉效果（M2.1 项目 4）。
    if (account.status !== 'active') {
      throw AppError.forbidden('该账号已被停用');
    }

    await db.auditLog.create({
      data: {
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: accountId,
        action: 'login',
        target: 'admin',
      },
    });

    const token = app.jwt.sign({ sub: accountId, role: account.role });
    return ok({ token, accountId, role: account.role });
  });
}
