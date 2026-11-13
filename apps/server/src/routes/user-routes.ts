import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ok, AgeBand, AppError } from '../contract.js';
import {
  listChildren,
  createChild,
  updateChild,
  getSetting,
  updateSetting,
  getMe,
} from '../services/user-service.js';

const ChildBody = z.object({
  nickname: z.string().trim().min(1).max(20),
  birthday: z.coerce.date().nullish(),
  ageBand: AgeBand.optional(),
  avatar: z.string().max(500).nullish(),
});

const SettingBody = z.object({
  dailyLimitMin: z.coerce.number().int().min(0).max(600).optional(),
  sleepTimerMin: z.coerce.number().int().min(0).max(180).optional(),
  ageFilter: AgeBand.optional(),
  parentGate: z.coerce.boolean().optional(),
});

const MeBody = z.object({ nickname: z.string().trim().min(1).max(30).optional() });

/** Authenticated parent routes: profile, children, settings (02-architecture §4.1). */
export function registerUserRoutes(app: FastifyInstance, db: Db, requireAuth: (req: unknown) => { sub: string; role: string }): void {
  app.get('/api/me', async (req) => {
    const user = requireAuth(req);
    return ok(await getMe(db, user.sub));
  });

  app.put('/api/me', async (req) => {
    const user = requireAuth(req);
    const body = MeBody.parse(req.body ?? {});
    const account = await db.account.update({
      where: { id: user.sub },
      data: body,
      select: { id: true, phone: true, nickname: true, role: true },
    });
    return ok(account);
  });

  app.get('/api/children', async (req) => {
    const user = requireAuth(req);
    return ok(await listChildren(db, user.sub));
  });

  app.post('/api/children', async (req) => {
    const user = requireAuth(req);
    const body = ChildBody.parse(req.body);
    return ok(await createChild(db, user.sub, { ...body, birthday: body.birthday ?? null }));
  });

  app.patch('/api/children/:id', async (req) => {
    const user = requireAuth(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = ChildBody.partial().parse(req.body ?? {});
    return ok(await updateChild(db, user.sub, id, body));
  });

  app.get('/api/settings', async (req) => {
    const user = requireAuth(req);
    return ok(await getSetting(db, user.sub));
  });

  app.put('/api/settings', async (req) => {
    const user = requireAuth(req);
    const body = SettingBody.parse(req.body ?? {});
    return ok(await updateSetting(db, user.sub, body));
  });
}

/** Kept explicit so an accidental unauthenticated call fails loudly. */
export function assertOwnership(accountId: string, resourceAccountId: string): void {
  if (accountId !== resourceAccountId) throw AppError.forbidden();
}
