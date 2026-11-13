import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ok, AppError, StoryStatus, AgeBand } from '../contract.js';
import { getDashboard, getAnalyticsOverview, getAnalyticsTop, getAnalyticsTrend, getAnalyticsCategories, updateStoryContent } from '../services/admin-service.js';

const ListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: StoryStatus.optional(),
  ageBand: AgeBand.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

const StoryPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  excerpt: z.string().max(1000).nullish(),
  categoryId: z.coerce.number().int().positive().nullish(),
  ageBand: AgeBand.optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  coverUrl: z.string().max(500).nullish(),
  audioUrl: z.string().max(500).nullish(),
  durationSec: z.coerce.number().int().min(0).optional(),
  featured: z.coerce.boolean().optional(),
  status: StoryStatus.optional(),
});

const ReviewBody = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

/**
 * 正文写回（M2.1 项目 1）。
 *
 * 上限依据实测：dev 库最长正文 38979 字符，留一倍余量取 50000，既容得下
 * 现有内容，也能挡住误贴整本书。`excerpt` 与 StoryPatch 保持一致（≤1000）。
 */
const ContentBody = z.object({
  content: z
    .string()
    .min(1, '正文不能为空')
    .max(50000, '正文过长（上限 50000 字）')
    .refine((s) => s.trim().length > 0, '正文不能只有空白字符'),
  excerpt: z.string().max(1000, '摘要过长（上限 1000 字）').nullish(),
});

/** 推荐位新建（M2.1 项目 3）。 */
const BannerCreate = z.object({
  title: z.string().trim().min(1).max(100),
  imageUrl: z.string().max(500).default(''),
  targetType: z.enum(['story', 'category', 'url']).default('story'),
  targetId: z.string().max(100).nullish(),
  sort: z.coerce.number().int().default(0),
  status: z.enum(['active', 'hidden']).default('active'),
});

/** 管理员管理（M2.1 项目 4）。 */
const AccountCreate = z.object({
  phone: z.string().trim().regex(/^1\d{10}$/, '手机号格式不正确'),
  nickname: z.string().trim().max(50).default(''),
  role: z.enum(['admin', 'editor']).default('editor'),
});

const AccountPatch = z.object({
  nickname: z.string().trim().max(50).optional(),
  role: z.enum(['admin', 'editor']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export type Role = 'parent' | 'admin' | 'editor';

/** audit_log 的 id 目前是应用侧生成（表无默认值）。 */
function auditId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 02-architecture §4.2 / §5: admin+editor read, only admin publishes or deletes. */
export function registerAdminRoutes(
  app: FastifyInstance,
  db: Db,
  /**
   * 后台鉴权：回库校验 role/status，因此是异步的（见 app.ts 的说明）。
   * 返回**库里当前的** role，不是 token 里的旧值。
   */
  requireRole: (req: unknown, roles: Role[]) => Promise<{ sub: string; role: string }>,
): void {
  const anyRole: Role[] = ['admin', 'editor'];
  const adminOnly: Role[] = ['admin'];

  app.get('/api/admin/dashboard', async (req) => {
    await requireRole(req, anyRole);
    return ok(await getDashboard(db));
  });

  app.get('/api/admin/stories', async (req) => {
    await requireRole(req, anyRole);
    const query = ListQuery.parse(req.query);
    const where = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.ageBand === undefined ? {} : { ageBand: query.ageBand }),
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.q === undefined ? {} : { title: { contains: query.q, mode: 'insensitive' as const } }),
    };

    const [total, items] = await Promise.all([
      db.story.count({ where }),
      db.story.findMany({
        where,
        select: {
          id: true, title: true, excerpt: true, categoryId: true, ageBand: true,
          tags: true, status: true, featured: true, durationSec: true,
          coverUrl: true, audioUrl: true, length: true, publishedAt: true, updatedAt: true,
        },
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return ok({ items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) });
  });

  app.get('/api/admin/stories/:id', async (req) => {
    await requireRole(req, anyRole);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const story = await db.story.findUnique({
      where: { id },
      select: {
        id: true, title: true, excerpt: true, categoryId: true, categoryName: true,
        ageBand: true, tags: true, status: true, featured: true, durationSec: true,
        coverUrl: true, audioUrl: true, length: true, createdAt: true, updatedAt: true,
        content: { select: { content: true } },
      },
    });
    if (!story) throw AppError.notFound('故事不存在');
    return ok(story);
  });

  app.patch('/api/admin/stories/:id', async (req) => {
    await requireRole(req, anyRole);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = StoryPatch.parse(req.body ?? {});

    const existing = await db.story.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound('故事不存在');

    const updated = await db.story.update({
      where: { id },
      data: {
        ...body,
        // Keep the denormalised legacy column in step so the old static site
        // stays consistent while it still reads public.story_main.
        ...(body.categoryId === undefined
          ? {}
          : { categoryName: body.categoryId === null ? null : (await db.category.findUnique({ where: { id: body.categoryId }, select: { name: true } }))?.name ?? null }),
      },
      select: { id: true, title: true, status: true, ageBand: true, updatedAt: true },
    });
    return ok(updated);
  });

  /**
   * 正文写回（M2.1 项目 1）。
   *
   * 用 PUT 而非 PATCH：正文是整体替换语义（整篇文本），不是字段级合并。
   * 权限与其它内容编辑一致（admin + editor），并写 audit_log 留痕。
   */
  app.put('/api/admin/stories/:id/content', async (req) => {
    const actor = await requireRole(req, anyRole);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = ContentBody.parse(req.body ?? {});

    const existing = await db.story.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound('故事不存在');

    const updated = await updateStoryContent(db, id, {
      content: body.content,
      // undefined = 未提供（不改摘要）；null = 清空；字符串 = 覆盖。
      excerpt: body.excerpt === undefined ? undefined : body.excerpt,
    });

    await db.auditLog.create({
      data: {
        id: auditId(),
        actorId: actor.sub,
        action: 'story.content.update',
        target: String(id),
        detail: { length: updated.length, excerptChanged: body.excerpt !== undefined },
      },
    });

    return ok(updated);
  });

  app.post('/api/admin/stories/:id/submit', async (req) => {
    const actor = await requireRole(req, anyRole);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const existing = await db.story.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw AppError.notFound('故事不存在');

    const updated = await db.story.update({ where: { id }, data: { status: 'review' }, select: { id: true, status: true } });
    await db.auditLog.create({ data: { id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor.sub, action: 'story.submit', target: String(id) } });
    return ok(updated);
  });

  app.post('/api/admin/stories/:id/review', async (req) => {
    const actor = await requireRole(req, adminOnly);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = ReviewBody.parse(req.body);

    const existing = await db.story.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound('故事不存在');

    const status = body.action === 'approve' ? 'published' : 'draft';
    const updated = await db.story.update({
      where: { id },
      data: { status, ...(body.action === 'approve' ? { publishedAt: new Date() } : {}) },
      select: { id: true, status: true, publishedAt: true },
    });
    await db.auditLog.create({ data: { id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor.sub, action: `story.${body.action}`, target: String(id), detail: body.reason ? { reason: body.reason } : undefined } });
    return ok(updated);
  });

  app.get('/api/admin/categories', async (req) => {
    await requireRole(req, anyRole);
    const categories = await db.category.findMany({
      select: { id: true, name: true, sortId: true, _count: { select: { stories: true } } },
      orderBy: { id: 'asc' },
    });
    return ok(categories.map((c) => ({ id: c.id, name: c.name, sortId: c.sortId, storyCount: c._count.stories })));
  });

  app.patch('/api/admin/categories/:id', async (req) => {
    await requireRole(req, adminOnly);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({ name: z.string().trim().min(1).max(50).optional(), sortId: z.coerce.number().int().optional() }).parse(req.body ?? {});
    const existing = await db.category.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound('分类不存在');
    return ok(await db.category.update({ where: { id }, data: body, select: { id: true, name: true, sortId: true } }));
  });

  app.get('/api/admin/banners', async (req) => {
    await requireRole(req, anyRole);
    return ok(await db.banner.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }));
  });

  /**
   * 新建推荐位（M2.1 项目 3）。
   *
   * only admin：推荐位直接影响 App 首页，与分类改名的权限级别一致
   * （02-architecture §5）。
   */
  app.post('/api/admin/banners', async (req) => {
    const actor = await requireRole(req, adminOnly);
    const body = BannerCreate.parse(req.body ?? {});
    const created = await db.banner.create({
      data: {
        title: body.title,
        imageUrl: body.imageUrl,
        targetType: body.targetType,
        targetId: body.targetId ?? null,
        sort: body.sort,
        status: body.status,
      },
    });
    await db.auditLog.create({
      data: { id: auditId(), actorId: actor.sub, action: 'banner.create', target: String(created.id), detail: { title: created.title } },
    });
    return ok(created);
  });

  app.patch('/api/admin/banners/:id', async (req) => {
    const actor = await requireRole(req, adminOnly);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(100).optional(),
        imageUrl: z.string().max(500).optional(),
        targetType: z.enum(['story', 'category', 'url']).optional(),
        targetId: z.string().max(100).nullish(),
        sort: z.coerce.number().int().optional(),
        status: z.enum(['active', 'hidden']).optional(),
      })
      .parse(req.body ?? {});
    const existing = await db.banner.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound('推荐位不存在');
    const updated = await db.banner.update({ where: { id }, data: body });
    await db.auditLog.create({
      data: { id: auditId(), actorId: actor.sub, action: 'banner.update', target: String(id), detail: { fields: Object.keys(body) } },
    });
    return ok(updated);
  });

  /** 删除推荐位（M2.1 项目 3）。admin only，写 audit_log。 */
  app.delete('/api/admin/banners/:id', async (req) => {
    const actor = await requireRole(req, adminOnly);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const existing = await db.banner.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!existing) throw AppError.notFound('推荐位不存在');

    await db.banner.delete({ where: { id } });
    await db.auditLog.create({
      data: { id: auditId(), actorId: actor.sub, action: 'banner.delete', target: String(id), detail: { title: existing.title } },
    });
    return ok({ id, deleted: true });
  });

  /**
   * 管理员列表（M2.1 项目 4）。
   *
   * 只返回后台角色（admin/editor）—— 家长/游客账号不属于「管理员管理」，
   * 混进来会让页面无法使用（且暴露家长手机号）。需要看家长账号时用
   * /api/admin/accounts 的 includeParents 开关。
   */
  app.get('/api/admin/accounts', async (req) => {
    await requireRole(req, adminOnly);
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(20),
        role: z.enum(['admin', 'editor', 'parent', 'all']).default('all'),
      })
      .parse(req.query);

    const where = query.role === 'all' ? {} : { role: query.role };
    const [total, items] = await Promise.all([
      db.account.count({ where }),
      db.account.findMany({
        where,
        select: { id: true, phone: true, nickname: true, role: true, status: true, createdAt: true, _count: { select: { children: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return ok({ items, total, page: query.page, pageSize: query.pageSize });
  });

  /**
   * 新增管理员（M2.1 项目 4）。仅 admin。
   *
   * 用手机号作为身份锚点（与登录一致），账号在对方首次验证码登录时直接可用。
   * 手机号全局唯一，重复即 409。
   */
  app.post('/api/admin/accounts', async (req) => {
    const actor = await requireRole(req, adminOnly);
    const body = AccountCreate.parse(req.body ?? {});

    const existing = await db.account.findUnique({ where: { phone: body.phone }, select: { id: true } });
    if (existing) throw AppError.conflict('该手机号已存在账号');

    const created = await db.account.create({
      data: { phone: body.phone, nickname: body.nickname, role: body.role },
      select: { id: true, phone: true, nickname: true, role: true, status: true, createdAt: true },
    });
    await db.auditLog.create({
      data: { id: auditId(), actorId: actor.sub, action: 'account.create', target: created.id, detail: { phone: body.phone, role: body.role } },
    });
    return ok(created);
  });

  /**
   * 改角色 / 停用 / 改昵称（M2.1 项目 4）。仅 admin。
   *
   * 两条自保护规则（否则会把后台锁死）：
   *   1. 不能改自己的角色或停用自己 —— 一次误操作就再没人能进后台；
   *   2. 不能让「最后一个可用 admin」消失（降级或停用都算）。
   */
  app.patch('/api/admin/accounts/:id', async (req) => {
    const actor = await requireRole(req, adminOnly);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = AccountPatch.parse(req.body ?? {});

    const target = await db.account.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
    if (!target) throw AppError.notFound('账号不存在');

    const nextRole = body.role ?? target.role;
    const nextStatus = body.status ?? target.status;
    const losesAdmin = target.role === 'admin' && (nextRole !== 'admin' || nextStatus !== 'active');

    if (losesAdmin && target.id === actor.sub) {
      throw AppError.badRequest('不能降级或停用自己的账号');
    }
    if (losesAdmin) {
      const remaining = await db.account.count({ where: { role: 'admin', status: 'active', id: { not: target.id } } });
      if (remaining === 0) throw AppError.badRequest('系统必须保留至少一个可用管理员');
    }

    const updated = await db.account.update({
      where: { id },
      data: { ...(body.nickname === undefined ? {} : { nickname: body.nickname }), role: nextRole, status: nextStatus },
      select: { id: true, phone: true, nickname: true, role: true, status: true },
    });

    const changed = Object.keys(body);
    if (changed.length > 0) {
      await db.auditLog.create({
        data: {
          id: auditId(),
          actorId: actor.sub,
          action: body.status === 'disabled' ? 'account.disable' : 'account.update',
          target: id,
          detail: { fields: changed, role: nextRole, status: nextStatus },
        },
      });
    }
    return ok(updated);
  });

  app.get('/api/admin/analytics/overview', async (req) => {
    await requireRole(req, anyRole);
    return ok(await getAnalyticsOverview(db));
  });

  /** 播放 Top N（M2.1 项目 2）。默认 20，上限 100 防止扫全表。 */
  app.get('/api/admin/analytics/top', async (req) => {
    await requireRole(req, anyRole);
    const { limit } = z
      .object({ limit: z.coerce.number().int().positive().max(100).default(20) })
      .parse(req.query);
    return ok({ items: await getAnalyticsTop(db, limit) });
  });

  /** 近 N 天播放/完播趋势（M2.1 项目 2）。默认 14 天，上限 90。 */
  app.get('/api/admin/analytics/trend', async (req) => {
    await requireRole(req, anyRole);
    const { days } = z
      .object({ days: z.coerce.number().int().positive().max(90).default(14) })
      .parse(req.query);
    return ok({ days, items: await getAnalyticsTrend(db, days) });
  });

  /** 分类分布（M2.1 项目 2）。 */
  app.get('/api/admin/analytics/categories', async (req) => {
    await requireRole(req, anyRole);
    return ok({ items: await getAnalyticsCategories(db) });
  });

  app.get('/api/admin/audit', async (req) => {
    await requireRole(req, anyRole);
    const query = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(20) }).parse(req.query);
    const [total, items] = await Promise.all([
      db.auditLog.count(),
      db.auditLog.findMany({ orderBy: { at: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return ok({ items, total, page: query.page, pageSize: query.pageSize });
  });
}
