/**
 * M2.1 四个补齐项的接口测试。
 *
 * 覆盖：
 *   1. PUT /api/admin/stories/:id/content —— 正文写回 + 摘要 + 校验 + audit_log
 *   2. GET /api/admin/analytics/{top,trend,categories} —— 真实聚合
 *   3. POST/PATCH/DELETE /api/admin/banners —— 增删改
 *   4. POST/PATCH /api/admin/accounts —— 新增/停用/改角色（含自保护）
 *
 * 全部只在 story_test 测试库上跑（tests/setup-test-db.ts 负责重建）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrateTestDb, seedTestDb, testPrisma } from './helpers/test-db.js';

const db = testPrisma();
let app: FastifyInstance;
let adminToken: string;
let editorToken: string;
let adminId: string;
let editorId: string;

beforeAll(async () => {
  await migrateTestDb(db);
  app = await buildApp({ db, jwtSecret: 'test-secret-value-at-least-16', fixedSmsCode: '123456' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/**
 * 每个用例前重建 fixture 与账号，避免用例之间互相污染
 * （这一组测试会改正文、删推荐位、停用账号）。
 */
beforeEach(async () => {
  await seedTestDb(db);
  await db.account.deleteMany({});
  const admin = await db.account.create({ data: { phone: '13900000001', nickname: '管理员', role: 'admin' } });
  const editor = await db.account.create({ data: { phone: '13900000002', nickname: '编辑', role: 'editor' } });
  adminId = admin.id;
  editorId = editor.id;

  const a = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { phone: '13900000001', code: '123456' } });
  adminToken = a.json().data.token;
  const e = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { phone: '13900000002', code: '123456' } });
  editorToken = e.json().data.token;
});

const asAdmin = () => ({ authorization: `Bearer ${adminToken}` });
const asEditor = () => ({ authorization: `Bearer ${editorToken}` });

// ===========================================================================
// 项目 1：正文写回
// ===========================================================================
describe('PUT /api/admin/stories/:id/content（M2.1 项目 1）', () => {
  it('writes content + excerpt and recomputes length', async () => {
    const story = await db.story.findFirst({ where: { title: '小兔子找月亮' } });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '新的正文。\n第二段。', excerpt: '新的摘要' },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    // 「字数」= 去掉所有空白后的字符数：新的正文。第二段。 = 9
    expect(data.length).toBe(9);
    expect(data.excerpt).toBe('新的摘要');

    const fresh = await db.storyContent.findUnique({ where: { storyId: story!.id } });
    expect(fresh?.content).toBe('新的正文。\n第二段。');
    const meta = await db.story.findUnique({ where: { id: story!.id } });
    expect(meta?.length).toBe(9);
  });

  it('creates the content row when the story has none yet', async () => {
    const story = await db.story.findFirst({ where: { title: '小兔子找月亮' } });
    await db.storyContent.deleteMany({ where: { storyId: story!.id } });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '补写的正文' },
    });
    expect(res.statusCode).toBe(200);
    const fresh = await db.storyContent.findUnique({ where: { storyId: story!.id } });
    expect(fresh?.content).toBe('补写的正文');
  });

  it('editor may write content (same level as other edits)', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asEditor(),
      payload: { content: '编辑写的正文' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects empty content', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects whitespace-only content', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '   \n\t  ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects content over the length cap', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: 'x'.repeat(50001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an over-long excerpt', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '正文', excerpt: 'y'.repeat(1001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('can clear the excerpt explicitly with null', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '正文', excerpt: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.excerpt).toBeNull();
  });

  it('leaves the excerpt untouched when the field is omitted', async () => {
    const story = await db.story.findFirst({ where: { title: '小兔子找月亮' } });
    const before = (await db.story.findUnique({ where: { id: story!.id } }))!.excerpt;

    await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '只改正文' },
    });
    const after = (await db.story.findUnique({ where: { id: story!.id } }))!.excerpt;
    expect(after).toBe(before);
  });

  it('404s for an unknown story', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/stories/99999999/content',
      headers: asAdmin(),
      payload: { content: '正文' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires a token', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: {},
      payload: { content: '正文' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('writes an audit_log entry', async () => {
    const story = await db.story.findFirst();
    await app.inject({
      method: 'PUT',
      url: `/api/admin/stories/${story!.id}/content`,
      headers: asAdmin(),
      payload: { content: '留痕用正文' },
    });

    const audit = await db.auditLog.findFirst({
      where: { action: 'story.content.update', target: String(story!.id) },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(adminId);
  });
});

// ===========================================================================
// 项目 2：数据中心聚合
// ===========================================================================
describe('GET /api/admin/analytics/*（M2.1 项目 2）', () => {
  /** 造一批带时间与事件的播放记录。 */
  async function seedPlays() {
    await db.playEvent.deleteMany({});
    const stories = await db.story.findMany({ where: { status: 'published' }, orderBy: { id: 'asc' } });
    const first = stories[0]!;
    const second = stories[1]!;
    const now = Date.now();
    const rows: Array<{ id: string; storyId: number; event: string; at: Date }> = [];
    // first 播放 3 次、完播 2 次；second 播放 1 次、完播 0 次。
    for (let i = 0; i < 3; i += 1) rows.push({ id: `p_a_${i}`, storyId: first.id, event: 'start', at: new Date(now - i * 3600_000) });
    for (let i = 0; i < 2; i += 1) rows.push({ id: `p_ac_${i}`, storyId: first.id, event: 'complete', at: new Date(now - i * 3600_000) });
    rows.push({ id: 'p_b_0', storyId: second.id, event: 'start', at: new Date(now - 2 * 86400_000) });
    await db.playEvent.createMany({ data: rows });
    return { first, second };
  }

  it('ranks top stories by start events with completion rate', async () => {
    const { first } = await seedPlays();
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/top', headers: asAdmin() });
    expect(res.statusCode).toBe(200);

    const items = res.json().data.items as Array<{ storyId: number; title: string; plays: number; completes: number; completionRate: number }>;
    const top = items[0]!;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(top.storyId).toBe(first.id);
    expect(top.plays).toBe(3);
    expect(top.completes).toBe(2);
    expect(top.completionRate).toBeCloseTo(66.7, 1);
    expect(top.title).toBeTruthy();
  });

  it('counts only start events as plays, not every event', async () => {
    await seedPlays();
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/top', headers: asAdmin() });
    const items = res.json().data.items as Array<{ storyId: number; plays: number }>;
    // 5 条事件里只有 4 条是 start；若把 complete 也算进去会得到 5。
    expect(items.find((i) => i.plays > 3)).toBeUndefined();
    expect(items.reduce((s, i) => s + i.plays, 0)).toBe(4);
  });

  it('honours the limit parameter', async () => {
    await seedPlays();
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/top?limit=1', headers: asAdmin() });
    expect(res.json().data.items).toHaveLength(1);
  });

  it('rejects an out-of-range limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/top?limit=999', headers: asAdmin() });
    expect(res.statusCode).toBe(400);
  });

  it('returns a 14-day trend with empty days filled in', async () => {
    await seedPlays();
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/trend', headers: asAdmin() });
    expect(res.statusCode).toBe(200);

    const { days, items } = res.json().data as { days: number; items: Array<{ day: string; plays: number; completes: number }> };
    expect(days).toBe(14);
    // 连续 14 天，一天不缺 —— 否则前端折线会把空白日跳过。
    expect(items).toHaveLength(14);
    const dateSet = new Set(items.map((i) => i.day));
    expect(dateSet.size).toBe(14);
    // 日期升序。
    const sorted = [...items].sort((a, b) => a.day.localeCompare(b.day));
    expect(items.map((i) => i.day)).toEqual(sorted.map((i) => i.day));
    // 今天应有那 3 次 start。
    const todayPlays = items[items.length - 1]!.plays;
    expect(todayPlays).toBeGreaterThanOrEqual(1);
  });

  it('supports a custom trend window', async () => {
    await seedPlays();
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/trend?days=7', headers: asAdmin() });
    expect(res.json().data.days).toBe(7);
    expect(res.json().data.items).toHaveLength(7);
  });

  it('returns category distribution with age-band breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/categories', headers: asAdmin() });
    expect(res.statusCode).toBe(200);

    const items = res.json().data.items as Array<{ name: string; total: number; bands: Record<string, number> }>;
    expect(items.length).toBeGreaterThan(0);
    // 每个分类的 total 必须等于三档之和。
    for (const c of items) {
      const sum = (c.bands['3-6'] ?? 0) + (c.bands['6-9'] ?? 0) + (c.bands['9+'] ?? 0);
      expect(c.total).toBe(sum);
    }
    // 只有 published 计入：fixture 里 draft 那篇不算。
    const totalAll = items.reduce((s, c) => s + c.total, 0);
    expect(totalAll).toBe(4);
    expect(items.find((c) => c.name === '恐怖故事')?.bands['9+']).toBe(1);
  });

  it('requires a token on each analytics endpoint', async () => {
    for (const url of ['/api/admin/analytics/top', '/api/admin/analytics/trend', '/api/admin/analytics/categories']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('refuses a parent-role token', async () => {
    const guest = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/analytics/top',
      headers: { authorization: `Bearer ${guest.json().data.token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// 项目 3：推荐位增删
// ===========================================================================
describe('/api/admin/banners（M2.1 项目 3）', () => {
  it('creates a banner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/banners',
      headers: asAdmin(),
      payload: { title: '新推荐位', targetType: 'story', targetId: '8', sort: 5 },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.title).toBe('新推荐位');
    expect(data.status).toBe('active');
    expect(data.sort).toBe(5);

    const fresh = await db.banner.findUnique({ where: { id: data.id } });
    expect(fresh?.title).toBe('新推荐位');
  });

  it('rejects a banner without a title', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/banners', headers: asAdmin(), payload: { title: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid targetType', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/banners',
      headers: asAdmin(),
      payload: { title: 'x', targetType: 'video' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('editor cannot create a banner (admin-only)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/banners', headers: asEditor(), payload: { title: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('deletes a banner', async () => {
    const created = await db.banner.create({ data: { title: '待删除', imageUrl: '', sort: 1 } });
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/banners/${created.id}`, headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.deleted).toBe(true);
    expect(await db.banner.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('404s when deleting an unknown banner', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/banners/99999999', headers: asAdmin() });
    expect(res.statusCode).toBe(404);
  });

  it('editor cannot delete a banner', async () => {
    const created = await db.banner.create({ data: { title: '保留', imageUrl: '', sort: 1 } });
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/banners/${created.id}`, headers: asEditor() });
    expect(res.statusCode).toBe(403);
    expect(await db.banner.findUnique({ where: { id: created.id } })).toBeTruthy();
  });

  it('patches status and sort (hide / reorder)', async () => {
    const created = await db.banner.create({ data: { title: '可改', imageUrl: '', sort: 1 } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/banners/${created.id}`,
      headers: asAdmin(),
      payload: { status: 'hidden', sort: 99 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('hidden');
    expect(res.json().data.sort).toBe(99);
  });

  it('keeps list ordering by sort then id', async () => {
    await db.banner.deleteMany({});
    await db.banner.create({ data: { title: 'B', imageUrl: '', sort: 2 } });
    await db.banner.create({ data: { title: 'A', imageUrl: '', sort: 1 } });
    const res = await app.inject({ method: 'GET', url: '/api/admin/banners', headers: asAdmin() });
    expect((res.json().data as Array<{ title: string }>).map((b) => b.title)).toEqual(['A', 'B']);
  });

  it('writes audit entries for create and delete', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/banners',
      headers: asAdmin(),
      payload: { title: '留痕位' },
    });
    await app.inject({ method: 'DELETE', url: `/api/admin/banners/${created.json().data.id}`, headers: asAdmin() });

    expect(await db.auditLog.findFirst({ where: { action: 'banner.create' } })).toBeTruthy();
    expect(await db.auditLog.findFirst({ where: { action: 'banner.delete' } })).toBeTruthy();
  });
});

// ===========================================================================
// 项目 4：管理员管理
// ===========================================================================
describe('/api/admin/accounts（M2.1 项目 4）', () => {
  it('lists admin accounts including status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/accounts', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ role: string; status: string }>;
    expect(items.length).toBe(2);
    expect(items.every((i) => i.status === 'active')).toBe(true);
  });

  it('creates an editor account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: asAdmin(),
      payload: { phone: '13900000003', nickname: '新编辑', role: 'editor' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe('editor');
    expect(await db.account.findUnique({ where: { phone: '13900000003' } })).toBeTruthy();
  });

  it('rejects a duplicate phone with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: asAdmin(),
      payload: { phone: '13900000001', role: 'editor' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a malformed phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: asAdmin(),
      payload: { phone: '12345', role: 'editor' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('editor cannot create an admin account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: asEditor(),
      payload: { phone: '13900000004', role: 'editor' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('disables an account and then blocks its login', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${editorId}`,
      headers: asAdmin(),
      payload: { status: 'disabled' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('disabled');

    // 停用必须真的挡住登录，否则只是视觉效果。
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { phone: '13900000002', code: '123456' },
    });
    expect(login.statusCode).toBe(403);
  });

  it('an already-issued token stops working once the account is disabled', async () => {
    // 关键：token 里带着签发时的 role，停用后必须立即失效（不能等 token 过期）。
    const before = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asEditor() });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${editorId}`,
      headers: asAdmin(),
      payload: { status: 'disabled' },
    });

    const after = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asEditor() });
    expect(after.statusCode).toBe(403);
  });

  it('promotes an editor to admin and the change takes effect on existing tokens', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${editorId}`,
      headers: asAdmin(),
      payload: { role: 'admin' },
    });
    expect(res.json().data.role).toBe('admin');

    // 旧 editor token 现在应以库里的 admin 角色被接受（审核是 admin-only）。
    const story = await db.story.findFirst();
    await db.story.update({ where: { id: story!.id }, data: { status: 'review' } });
    const approve = await app.inject({
      method: 'POST',
      url: `/api/admin/stories/${story!.id}/review`,
      headers: asEditor(),
      payload: { action: 'approve' },
    });
    expect(approve.statusCode).toBe(200);
  });

  it('refuses to disable your own account', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${adminId}`,
      headers: asAdmin(),
      payload: { status: 'disabled' },
    });
    expect(res.statusCode).toBe(400);
    // 仍然可用。
    const still = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asAdmin() });
    expect(still.statusCode).toBe(200);
  });

  it('refuses to demote your own account', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${adminId}`,
      headers: asAdmin(),
      payload: { role: 'editor' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to remove the last usable admin', async () => {
    // 另建一个 admin 来执行操作，这样「目标」不是自己 —— 走的是「最后一个
    // admin」这条保护，而不是「不能操作自己」那条。
    const other = await db.account.create({ data: { phone: '13900000009', nickname: '另一个管理员', role: 'admin' } });
    const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { phone: '13900000009', code: '123456' } });
    const otherToken = login.json().data.token;

    // 先把原 admin 降级，于是 other 成为唯一 admin。
    await app.inject({ method: 'PATCH', url: `/api/admin/accounts/${adminId}`, headers: { authorization: `Bearer ${otherToken}` }, payload: { role: 'editor' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${other.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { role: 'editor' },
    });
    // 既是自己、又是最后一个 admin —— 两条保护都命中，必须是 400。
    expect(res.statusCode).toBe(400);
  });

  it('allows disabling a non-admin account when another admin remains', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/accounts/${editorId}`,
      headers: asAdmin(),
      payload: { status: 'disabled', nickname: '已停用编辑' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.nickname).toBe('已停用编辑');
  });

  it('404s for an unknown account', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/accounts/does-not-exist',
      headers: asAdmin(),
      payload: { role: 'editor' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('writes audit entries for create / disable / role change', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: asAdmin(),
      payload: { phone: '13900000008', role: 'editor' },
    });
    await app.inject({ method: 'PATCH', url: `/api/admin/accounts/${editorId}`, headers: asAdmin(), payload: { status: 'disabled' } });
    await app.inject({ method: 'PATCH', url: `/api/admin/accounts/${editorId}`, headers: asAdmin(), payload: { role: 'editor' } });

    expect(await db.auditLog.findFirst({ where: { action: 'account.create' } })).toBeTruthy();
    expect(await db.auditLog.findFirst({ where: { action: 'account.disable' } })).toBeTruthy();
    expect(await db.auditLog.findFirst({ where: { action: 'account.update' } })).toBeTruthy();
  });
});
