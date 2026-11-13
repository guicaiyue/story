import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrateTestDb, seedTestDb, testPrisma } from './helpers/test-db.js';

const db = testPrisma();
let app: FastifyInstance;

beforeAll(async () => {
  await migrateTestDb(db);
  await seedTestDb(db);
  app = await buildApp({ db, jwtSecret: 'test-secret-value-at-least-16', fixedSmsCode: '123456' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('GET /api/health', () => {
  it('returns 200 with db status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.db).toBe('up');
  });
});

describe('response envelope (02-architecture §4)', () => {
  it('wraps success as { ok: true, data }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories' });
    const body = res.json();
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('data');
    expect(body).not.toHaveProperty('error');
  });

  it('wraps errors as { ok: false, error: { code, message } }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories/99999999' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });

  it('returns 404 envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/stories', () => {
  it('lists only published stories', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories' });
    const { data } = res.json();
    expect(data.total).toBe(4);
    expect(data.items.every((s: { title: string }) => s.title !== '尚未完成的草稿')).toBe(true);
  });

  it('paginates with page/pageSize and reports totalPages', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories?page=1&pageSize=2' });
    const { data } = res.json();
    expect(data.items).toHaveLength(2);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(2);
    expect(data.total).toBe(4);
    expect(data.totalPages).toBe(2);
  });

  it('filters by ageBand', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories?ageBand=9%2B' });
    const { data } = res.json();
    expect(data.total).toBe(1);
    expect(data.items[0].title).toBe('深夜怪谈');
  });

  it('filters by categoryId', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories?categoryId=1' });
    const { data } = res.json();
    expect(data.total).toBe(2);
  });

  it('searches title case-insensitively', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/stories?q=${encodeURIComponent('小兔子')}` });
    const { data } = res.json();
    expect(data.total).toBe(1);
    expect(data.items[0].title).toBe('小兔子找月亮');
  });

  it('filters featured stories', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories?featured=true' });
    const { data } = res.json();
    expect(data.total).toBe(1);
  });

  it('rejects an invalid ageBand', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories?ageBand=12-15' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('rejects pageSize above the cap', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories?pageSize=500' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/stories/:id', () => {
  it('returns detail joined from story_main + story_content', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories/1' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.title).toBe('小兔子找月亮');
    expect(data.content).toContain('正文内容');
  });

  it("prefers category.name over the denormalised category_name", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories/1' });
    expect(res.json().data.categoryName).toBe('睡前故事');
  });

  it('404s for an unpublished story', async () => {
    const draft = await db.story.findFirst({ where: { status: 'draft' } });
    const res = await app.inject({ method: 'GET', url: `/api/stories/${draft!.id}` });
    expect(res.statusCode).toBe(404);
  });

  it('400s on a non-numeric id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stories/abc' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/categories', () => {
  it('returns categories with published counts, sort_id desc first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories' });
    const { data } = res.json();
    expect(data).toHaveLength(3);
    expect(data[0].name).toBe('睡前故事');
    expect(data[0].storyCount).toBe(2);
  });
});

describe('GET /api/home', () => {
  it('aggregates tonight pick, featured and categories for anonymous callers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/home' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.tonight.title).toBe('小兔子找月亮');
    expect(Array.isArray(data.featured)).toBe(true);
    expect(data.categories).toHaveLength(3);
    expect(data.continueListening).toEqual([]);
  });

  it('defaults to the 3-6 band when ageBand is omitted', async () => {
    // 首页是孩子打开 App 的第一屏，「不传」必须等于「按最小孩子过滤」，
    // 而不是「不过滤」。否则 9+ 的怪谈会直接出现在 3-6 的首页上。
    const res = await app.inject({ method: 'GET', url: '/api/home' });
    const { data } = res.json();
    expect(data.tonight.ageBand).toBe('3-6');
    expect(data.tonight.title).not.toBe('深夜怪谈');
  });

  it('never surfaces 9+ content in the 3-6 home (内容安全闸)', async () => {
    // 01-product-brief §4.1 / 00-research P1：恐怖/怪谈/推理默认不进儿童端。
    // 这个用例锁住回归：曾经 featured 只看 featured=true + published，
    // 把 9+ 的《卷七·细柳》当成了 3-6 的「今晚听什么」。
    const res = await app.inject({ method: 'GET', url: '/api/home?ageBand=3-6' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.tonight.ageBand).toBe('3-6');
    const all = [data.tonight, ...data.featured].filter(Boolean);
    expect(all.every((s: { ageBand: string }) => s.ageBand === '3-6')).toBe(true);
  });

  it('honours an explicit 9+ band', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/home?ageBand=9%2B' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.tonight.ageBand).toBe('9+');
    expect(data.tonight.title).toBe('深夜怪谈');
  });

  it('rejects an invalid ageBand', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/home?ageBand=12-15' });
    expect(res.statusCode).toBe(400);
  });

  it('falls back to the newest published story in-band when nothing is featured', async () => {
    // 今晚听什么 is the app's first screen; it must not go null just because
    // no editor has curated a featured slot yet. The fallback must respect the
    // age gate — 深夜怪谈 is 9+, so it must NOT be the 3-6 fallback.
    await db.story.updateMany({ data: { featured: false } });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/home?ageBand=3-6' });
      const { data } = res.json();
      expect(data.featured).toEqual([]);
      expect(data.tonight).not.toBeNull();
      expect(data.tonight.ageBand).toBe('3-6');
      expect(data.tonight.title).not.toBe('深夜怪谈');
    } finally {
      await db.story.updateMany({ where: { title: '小兔子找月亮' }, data: { featured: true } });
    }
  });

  it('keeps the fallback in-band even when the band has no featured story', async () => {
    // 3-6 有 2 篇 published 但都不 featured → 兜底必须选 3-6 里最新的那篇，
    // 不能因为 9+ 的 id 更大就把它捞上来。
    await db.story.updateMany({ data: { featured: false } });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/home?ageBand=3-6' });
      const { data } = res.json();
      expect(data.tonight.ageBand).toBe('3-6');
      expect(['小兔子找月亮', '勇敢的小刺猬']).toContain(data.tonight.title);
    } finally {
      await db.story.updateMany({ where: { title: '小兔子找月亮' }, data: { featured: true } });
    }
  });

  it('returns a null tonight rather than crossing the age gate', async () => {
    // 年龄闸优先于「首页不能空」：当某一档完全没有可推内容时，宁可 tonight=null
    // 也不能下探别的年龄档去凑一篇。
    await db.story.updateMany({ data: { featured: false } });
    await db.story.updateMany({ where: { ageBand: '6-9' }, data: { status: 'draft' } });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/home?ageBand=6-9' });
      const { data } = res.json();
      expect(data.tonight).toBeNull();
      expect(data.featured).toEqual([]);
    } finally {
      await db.story.updateMany({ where: { title: '会飞的种子' }, data: { status: 'published' } });
      await db.story.updateMany({ where: { title: '小兔子找月亮' }, data: { featured: true } });
    }
  });
});
