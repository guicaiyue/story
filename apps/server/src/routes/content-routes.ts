import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ok, AgeBand } from '../contract.js';
import {
  listPublicStories,
  getPublicStory,
  listCategories,
  newestPublishedForBand,
} from '../services/content-service.js';

const IdParam = z.object({ id: z.coerce.number().int().positive() });

const StoryQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  categoryId: z.coerce.number().int().positive().optional(),
  ageBand: AgeBand.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  featured: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/**
 * `/api/home` 的查询参数。
 *
 * `ageBand` **默认 3-6**，与 `PublicStoryQuery` 里「不传就不按年龄过滤」的
 * 语义刻意不同：首页是孩子打开 App 的第一屏，默认必须落在最保守的年龄档上。
 * 不传等于「给最小的孩子看」，而不是「给所有人看」。
 */
const HomeQuery = z.object({
  ageBand: AgeBand.default('3-6'),
});

/**
 * Public content routes (02-architecture §4.1).
 * Anonymous read; responses are `{ ok, data }`.
 */
export function registerContentRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/stories', async (req) => {
    const query = StoryQuery.parse(req.query);
    return ok(await listPublicStories(db, query));
  });

  app.get('/api/stories/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    return ok(await getPublicStory(db, id));
  });

  app.get('/api/categories', async () => ok(await listCategories(db)));

  /**
   * Home aggregate (02-architecture §4.1). `continueListening` is omitted for
   * anonymous callers rather than erroring, so the app can render before login.
   *
   * `ageBand` defaults to `3-6`（最保守的那一档）：这是**内容安全默认值**，
   * 不是普通分页参数。01-product-brief §4.1 / 00-research P1 要求恐怖/怪谈/
   * 推理默认不进儿童端，所以「不传就不过滤」是错的 —— 不传等于按最小孩子
   * 过滤。App 应把孩子的年龄档显式传上来。
   */
  app.get('/api/home', async (req) => {
    const { ageBand } = HomeQuery.parse(req.query);

    const [featured, categories] = await Promise.all([
      // featured 必须同时满足 published + 年龄档，否则 9+ 的聊斋/怪谈会
      // 混进 3-6 的首页（实测命中过 story 2199《卷七·细柳》）。
      listPublicStories(db, { page: 1, pageSize: 6, featured: true, ageBand }),
      listCategories(db),
    ]);

    let continueListening: unknown[] = [];
    if (req.principal) {
      const rows = await db.progress.findMany({
        where: { accountId: req.principal.sub },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          storyId: true,
          positionSec: true,
          updatedAt: true,
          story: { select: { id: true, title: true, coverUrl: true, durationSec: true, ageBand: true } },
        },
      });
      continueListening = rows;
    }

    // 01-product-brief §4.1: 「今晚听什么」 must never be empty — it is the app's
    // first screen. Featured picks win; otherwise fall back to the newest
    // published story **in the same age band** so the CTA works before any
    // editor has curated anything, without ever crossing the age gate.
    const tonight = featured.items[0] ?? (await newestPublishedForBand(db, ageBand));
    return ok({ tonight, featured: featured.items, categories, continueListening });
  });
}
