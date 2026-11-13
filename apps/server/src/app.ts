import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { Db } from './db.js';
import { ok, fail, AppError } from './contract.js';
import type { SmsAdapter } from './services/auth-service.js';
import { NoopSmsAdapter } from './services/auth-service.js';
import { registerAudioRoutes } from './routes/audio-routes.js';
import { registerContentRoutes } from './routes/content-routes.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { registerUserRoutes } from './routes/user-routes.js';
import { registerPlayRoutes } from './routes/play-routes.js';
import { registerAdminRoutes, type Role } from './routes/admin-routes.js';

export type BuildOptions = {
  db: Db;
  jwtSecret: string;
  fixedSmsCode?: string;
  sms?: SmsAdapter;
  logger?: boolean | object;
};

/**
 * Assembles the M1 server. Kept as a factory so tests can build an isolated
 * instance against the real database without binding a port.
 */
export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    // Trust the proxy chain (traefik -> nginx) so client IPs log correctly.
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: opts.jwtSecret });

  // `request.principal` (see types.ts) is populated by the hook below.
  const requireAuth = (req: unknown) => {
    const r = req as { principal?: { sub: string; role: string } | null };
    if (!r.principal) throw AppError.unauthorized();
    return r.principal;
  };

  /**
   * 后台鉴权（M2.1 项目 4）。
   *
   * 为什么不能只看 JWT：token 里带着签发时的 role，一旦管理员被**停用**或
   * **降级**，他手里的旧 token 在过期前仍然有效 —— 只看 token 等于停用无效。
   * 所以后台路由每次都回库确认 role/status，**以数据库为准**（token 只用来
   * 标识身份，不用来授权）。返回的是库里的当前角色，不是 token 里的旧角色。
   */
  const requireRole = async (req: unknown, roles: Role[]) => {
    const user = requireAuth(req);
    const account = await opts.db.account.findUnique({
      where: { id: user.sub },
      select: { role: true, status: true },
    });
    if (!account) throw AppError.unauthorized('账号不存在');
    if (account.status !== 'active') throw AppError.forbidden('该账号已被停用');
    if (!roles.includes(account.role as Role)) throw AppError.forbidden('需要更高的权限');
    return { sub: user.sub, role: account.role };
  };

  // Resolve the caller when a valid Bearer token is present; never reject here,
  // so anonymous access keeps working on public routes.
  app.addHook('onRequest', async (req) => {
    req.principal = null;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    try {
      req.principal = await req.jwtVerify<{ sub: string; role: string }>();
    } catch {
      req.principal = null;
    }
  });

  // 01-product-brief: /api/health is the M1 acceptance gate.
  app.get('/api/health', async () => {
    const start = Date.now();
    await opts.db.$queryRaw`SELECT 1`;
    return ok({
      status: 'ok',
      db: 'up',
      latencyMs: Date.now() - start,
      uptimeSec: Math.round(process.uptime()),
      version: '0.1.0-m1',
    });
  });

  registerContentRoutes(app, opts.db);
  registerAudioRoutes(app, opts.db);
  registerAuthRoutes(app, opts.db, opts.sms ?? new NoopSmsAdapter(), opts.fixedSmsCode ?? '123456');
  registerUserRoutes(app, opts.db, requireAuth);
  registerPlayRoutes(app, opts.db, requireAuth);
  registerAdminRoutes(app, opts.db, requireRole);

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send(fail('NOT_FOUND', '接口不存在'));
  });

  app.setErrorHandler((error: unknown, _req, reply) => {
    if (error instanceof AppError) {
      reply.code(error.status).send(fail(error.code, error.message, error.details));
      return;
    }
    if (error instanceof ZodError) {
      reply.code(400).send(fail('BAD_REQUEST', '参数校验失败', error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
      return;
    }
    const status = typeof (error as { statusCode?: unknown })?.statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    if (status >= 500) app.log.error({ err: error }, 'unhandled error');
    reply.code(status).send(fail(status >= 500 ? 'INTERNAL' : 'BAD_REQUEST', status >= 500 ? '服务器内部错误' : String((error as Error)?.message ?? '请求失败')));
  });

  return app;
}
