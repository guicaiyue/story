import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrateTestDb, seedTestDb, testPrisma } from './helpers/test-db.js';

const db = testPrisma();
let app: FastifyInstance;
let adminToken: string;
let editorToken: string;

beforeAll(async () => {
  await migrateTestDb(db);
  await seedTestDb(db);
  app = await buildApp({ db, jwtSecret: 'test-secret-value-at-least-16', fixedSmsCode: '123456' });
  await app.ready();

  // admin + editor accounts, since review is admin-only.
  await db.account.create({ data: { phone: '13900000001', nickname: '管理员', role: 'admin' } });
  await db.account.create({ data: { phone: '13900000002', nickname: '编辑', role: 'editor' } });

  const admin = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { phone: '13900000001', code: '123456' } });
  adminToken = admin.json().data.token;
  const editor = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { phone: '13900000002', code: '123456' } });
  editorToken = editor.json().data.token;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const asAdmin = () => ({ authorization: `Bearer ${adminToken}` });
const asEditor = () => ({ authorization: `Bearer ${editorToken}` });

describe('GET /api/admin/dashboard', () => {
  it('returns content counts, health and user totals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.content.total).toBe(5);
    expect(data.content.published).toBe(4);
    expect(data.content.draft).toBe(1);
    expect(data.users.children).toBe(0);
  });

  it('reports missing cover/audio counts (TTS means no audio files yet)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asAdmin() });
    const { data } = res.json();
    expect(data.health.missingCover).toBe(5);
    expect(data.health.missingAudio).toBe(5);
    expect(data.health.missingAgeBand).toBe(0);
  });

  it('requires a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a parent-role token', async () => {
    const guest = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      headers: { authorization: `Bearer ${guest.json().data.token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/admin/stories', () => {
  it('lists drafts too (unlike the public endpoint)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/stories', headers: asAdmin() });
    const { data } = res.json();
    expect(data.total).toBe(5);
  });

  it('filters by status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/stories?status=draft', headers: asAdmin() });
    const { data } = res.json();
    expect(data.total).toBe(1);
    expect(data.items[0].title).toBe('尚未完成的草稿');
  });

  it('paginates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/stories?page=1&pageSize=2', headers: asAdmin() });
    const { data } = res.json();
    expect(data.items).toHaveLength(2);
    expect(data.totalPages).toBe(3);
  });

  it('filters by ageBand', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/stories?ageBand=9%2B', headers: asAdmin() });
    expect(res.json().data.total).toBe(1);
  });
});

describe('story review flow (02-architecture §4.2)', () => {
  it('admin can approve a review item, publishing it with a timestamp', async () => {
    const story = await db.story.findFirst({ where: { status: 'published' } });
    await db.story.update({ where: { id: story!.id }, data: { status: 'review', publishedAt: null } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/stories/${story!.id}/review`,
      headers: asAdmin(),
      payload: { action: 'approve' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.status).toBe('published');
    expect(data.publishedAt).toBeTruthy();

    const fresh = await db.story.findUnique({ where: { id: story!.id } });
    expect(fresh?.status).toBe('published');
  });

  it('admin can reject, returning the story to draft and recording the reason', async () => {
    const story = await db.story.findFirst({ where: { status: 'published' } });
    await db.story.update({ where: { id: story!.id }, data: { status: 'review' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/stories/${story!.id}/review`,
      headers: asAdmin(),
      payload: { action: 'reject', reason: '年龄档标注不当' },
    });
    expect(res.json().data.status).toBe('draft');

    const audit = await db.auditLog.findFirst({ where: { target: String(story!.id), action: 'story.reject' }, orderBy: { at: 'desc' } });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.detail)).toContain('年龄档标注不当');
  });

  it('editor cannot approve (admin-only per 02-architecture §5)', async () => {
    const story = await db.story.findFirst({ where: { status: 'published' } });
    await db.story.update({ where: { id: story!.id }, data: { status: 'review' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/stories/${story!.id}/review`,
      headers: asEditor(),
      payload: { action: 'approve' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('editor may submit a story for review', async () => {
    const story = await db.story.findFirst({ where: { status: 'draft' } });
    const res = await app.inject({ method: 'POST', url: `/api/admin/stories/${story!.id}/submit`, headers: asEditor() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('review');
  });

  it('404s for an unknown story', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stories/99999999/review',
      headers: asAdmin(),
      payload: { action: 'approve' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid action', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/stories/${story!.id}/review`,
      headers: asAdmin(),
      payload: { action: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/admin/stories/:id', () => {
  it('updates editable fields and keeps category_name in sync', async () => {
    const story = await db.story.findFirst({ where: { status: 'published' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/stories/${story!.id}`,
      headers: asAdmin(),
      payload: { title: '改过的标题', ageBand: '6-9', tags: ['睡前'] },
    });
    expect(res.statusCode).toBe(200);

    const fresh = await db.story.findUnique({ where: { id: story!.id } });
    expect(fresh?.title).toBe('改过的标题');
    expect(fresh?.ageBand).toBe('6-9');
    expect(fresh?.tags).toEqual(['睡前']);
  });

  it('rejects an invalid ageBand', async () => {
    const story = await db.story.findFirst();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/stories/${story!.id}`,
      headers: asAdmin(),
      payload: { ageBand: '12-15' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/admin/analytics/overview', () => {
  it('buckets play events by China local hour, not UTC', async () => {
    // A play at 20:30 Asia/Shanghai is 12:30 UTC. Grouping on the raw column
    // would put it in hour 12 and understate the 睡前 metric (see admin-service).
    await db.playEvent.deleteMany({});
    await db.playEvent.create({
      data: {
        id: 'pe_tz_1',
        storyId: (await db.story.findFirst())!.id,
        event: 'start',
        at: new Date('2026-11-09T12:30:00.000Z'), // 20:30 Shanghai
      },
    });
    await db.playEvent.create({
      data: {
        id: 'pe_tz_2',
        storyId: (await db.story.findFirst())!.id,
        event: 'start',
        at: new Date('2026-11-09T02:00:00.000Z'), // 10:00 Shanghai
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/analytics/overview', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const byHour = res.json().data.byHour as Array<{ hour: number; plays: number }>;

    const at20 = byHour.find((h) => h.hour === 20);
    expect(at20?.plays).toBe(1);
    // Must NOT be bucketed as UTC hour 12.
    expect(byHour.find((h) => h.hour === 12)).toBeUndefined();
  });
});

describe('admin ops endpoints', () => {
  it('lists categories with published story counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/categories', headers: asAdmin() });
    const { data } = res.json();
    expect(data.length).toBe(3);
    expect(data.find((c: { name: string }) => c.name === '睡前故事').storyCount).toBeGreaterThan(0);
  });

  it('admin can rename a category', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/categories/1',
      headers: asAdmin(),
      payload: { name: '睡前故事集' },
    });
    expect(res.json().data.name).toBe('睡前故事集');
  });

  it('editor cannot rename a category (admin-only)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/categories/1',
      headers: asEditor(),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists accounts with child counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/accounts', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBeGreaterThan(0);
  });

  it('lists audit entries newest first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data.items)).toBe(true);
  });
});
