import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ok } from '../contract.js';
import {
  upsertProgress,
  listProgress,
  addFavorite,
  removeFavorite,
  listFavorites,
  recordPlayEvent,
} from '../services/play-service.js';

const StoryIdParam = z.object({ storyId: z.coerce.number().int().positive() });

const ProgressBody = z.object({ positionSec: z.coerce.number().int().min(0) });

const PlayBody = z.object({
  storyId: z.coerce.number().int().positive(),
  event: z.enum(['start', 'pause', 'complete', 'stop']),
  positionSec: z.coerce.number().int().min(0).default(0),
  childId: z.string().min(1).nullish(),
});

/** Playback routes: progress / favorites / play events (02-architecture §4.1). */
export function registerPlayRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: (req: unknown) => { sub: string; role: string },
): void {
  app.put('/api/progress/:storyId', async (req) => {
    const user = requireAuth(req);
    const { storyId } = StoryIdParam.parse(req.params);
    const { positionSec } = ProgressBody.parse(req.body);
    return ok(await upsertProgress(db, { accountId: user.sub, storyId, positionSec }));
  });

  app.get('/api/progress', async (req) => {
    const user = requireAuth(req);
    return ok(await listProgress(db, user.sub));
  });

  app.post('/api/favorites/:storyId', async (req) => {
    const user = requireAuth(req);
    const { storyId } = StoryIdParam.parse(req.params);
    return ok(await addFavorite(db, user.sub, storyId));
  });

  app.delete('/api/favorites/:storyId', async (req) => {
    const user = requireAuth(req);
    const { storyId } = StoryIdParam.parse(req.params);
    return ok(await removeFavorite(db, user.sub, storyId));
  });

  app.get('/api/favorites', async (req) => {
    const user = requireAuth(req);
    return ok(await listFavorites(db, user.sub));
  });

  /**
   * Play events are accepted anonymously (accountId null) so pre-login playback
   * is still measurable; 01-product-brief §6 hinges on the 睡前时段占比 metric.
   */
  app.post('/api/plays', async (req) => {
    const body = PlayBody.parse(req.body);
    const user = req.principal;
    return ok(      await recordPlayEvent(db, {
        accountId: user?.sub ?? null,
        childId: body.childId ?? null,
        storyId: body.storyId,
        event: body.event,
        positionSec: body.positionSec,
      }),
    );
  });
}
