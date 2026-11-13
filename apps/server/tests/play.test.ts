import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrateTestDb, seedTestDb, testPrisma } from './helpers/test-db.js';

const db = testPrisma();
let app: FastifyInstance;
let token: string;
let storyId: number;

beforeAll(async () => {
  await migrateTestDb(db);
  const seeded = await seedTestDb(db);
  storyId = seeded.storyIds[0]!;
  app = await buildApp({ db, jwtSecret: 'test-secret-value-at-least-16' });
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
  token = res.json().data.token;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('progress', () => {
  it('creates then updates a single progress row per story', async () => {
    const first = await app.inject({
      method: 'PUT',
      url: `/api/progress/${storyId}`,
      headers: auth(),
      payload: { positionSec: 30 },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.positionSec).toBe(30);

    const second = await app.inject({
      method: 'PUT',
      url: `/api/progress/${storyId}`,
      headers: auth(),
      payload: { positionSec: 75 },
    });
    expect(second.json().data.positionSec).toBe(75);

    const rows = await db.progress.findMany({ where: { storyId } });
    expect(rows).toHaveLength(1);
  });

  it('lists progress newest first for 继续听', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/progress', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/progress/${storyId}`, payload: { positionSec: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it('404s for an unknown story', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/progress/99999999',
      headers: auth(),
      payload: { positionSec: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a negative position', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/progress/${storyId}`,
      headers: auth(),
      payload: { positionSec: -5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('favorites', () => {
  it('is idempotent when adding twice', async () => {
    await app.inject({ method: 'POST', url: `/api/favorites/${storyId}`, headers: auth() });
    const res = await app.inject({ method: 'POST', url: `/api/favorites/${storyId}`, headers: auth() });
    expect(res.json().data.favorited).toBe(true);
    const rows = await db.favorite.findMany({ where: { storyId } });
    expect(rows).toHaveLength(1);
  });

  it('lists and then removes a favorite', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/favorites', headers: auth() });
    expect(list.json().data.length).toBeGreaterThan(0);

    const del = await app.inject({ method: 'DELETE', url: `/api/favorites/${storyId}`, headers: auth() });
    expect(del.json().data.favorited).toBe(false);

    const after = await app.inject({ method: 'GET', url: '/api/favorites', headers: auth() });
    expect(after.json().data).toHaveLength(0);
  });
});

describe('play events', () => {
  it('accepts an anonymous play event for pre-login measurement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plays',
      payload: { storyId, event: 'start', positionSec: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.event).toBe('start');

    const row = await db.playEvent.findFirst({ where: { storyId }, orderBy: { at: 'desc' } });
    expect(row?.accountId).toBeNull();
  });

  it('attributes a play event to the account when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plays',
      headers: auth(),
      payload: { storyId, event: 'complete', positionSec: 300 },
    });
    expect(res.statusCode).toBe(200);
    const row = await db.playEvent.findFirst({ where: { event: 'complete' } });
    expect(row?.accountId).not.toBeNull();
  });

  it('rejects an unknown event type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plays',
      payload: { storyId, event: 'rewind' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('children and settings', () => {
  it('creates, lists and updates a child profile', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/children',
      headers: auth(),
      payload: { nickname: '朵朵', ageBand: '3-6', birthday: '2021-05-01' },
    });
    expect(created.statusCode).toBe(200);
    const childId = created.json().data.id;

    const listed = await app.inject({ method: 'GET', url: '/api/children', headers: auth() });
    expect(listed.json().data).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/children/${childId}`,
      headers: auth(),
      payload: { nickname: '朵朵朵' },
    });
    expect(patched.json().data.nickname).toBe('朵朵朵');
  });

  it('cannot read or modify another account\'s child', async () => {
    const other = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
    const otherToken = other.json().data.token;
    const mine = await app.inject({ method: 'GET', url: '/api/children', headers: auth() });
    const childId = mine.json().data[0].id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/children/${childId}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { nickname: 'HACKED' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns defaults then persists settings', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    expect(initial.json().data.parentGate).toBe(true);
    expect(initial.json().data.sleepTimerMin).toBe(30);

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: { dailyLimitMin: 20, parentGate: false },
    });
    expect(updated.json().data.dailyLimitMin).toBe(20);
    expect(updated.json().data.parentGate).toBe(false);
  });
});
