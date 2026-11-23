import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { NoopSmsAdapter } from '../src/services/auth-service.js';
import { migrateTestDb, seedTestDb, testPrisma } from './helpers/test-db.js';

/**
 * 外部端「补充账号信息」：`GET/PUT /api/me` 与 `POST /api/me/bind-phone`。
 *
 * 这一组用例锁的是最小闭环：游客账号绑上手机号之后，`GET /api/me` 能读到手机号、
 * 家庭行被补齐；换设备用手机号登录能回同一个 accountId。
 */
const db = testPrisma();
const sms = new NoopSmsAdapter();
let app: FastifyInstance;

beforeAll(async () => {
  await migrateTestDb(db);
  await seedTestDb(db);
  app = await buildApp({ db, jwtSecret: 'test-secret-value-at-least-16', fixedSmsCode: '123456', sms });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

async function guestToken(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
  return res.json().data.token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('GET /api/me', () => {
  it('returns the guest account with a null phone and no family', async () => {
    const token = await guestToken();
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.phone).toBeNull();
    expect(data.role).toBe('parent');
  });

  it('401s without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /api/me', () => {
  it('updates the nickname and persists it', async () => {
    const token = await guestToken();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me',
      headers: auth(token),
      payload: { nickname: '小明妈妈' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.nickname).toBe('小明妈妈');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(me.json().data.nickname).toBe('小明妈妈');
  });

  it('rejects an empty nickname', async () => {
    const token = await guestToken();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me',
      headers: auth(token),
      payload: { nickname: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/me/bind-phone', () => {
  it('binds a free phone to the current guest account and fills in the family row', async () => {
    const token = await guestToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/bind-phone',
      headers: auth(token),
      payload: { phone: '13900000001', code: '123456' },
    });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.phone).toBe('13900000001');
    // 游客账号本来没有 family，绑定后必须补齐，否则后台「家庭」永远是 0。
    expect(data.family).not.toBeNull();
  });

  it('lets the same person log in on another device and land on the same account', async () => {
    const token = await guestToken();
    const bound = await app.inject({
      method: 'POST',
      url: '/api/me/bind-phone',
      headers: auth(token),
      payload: { phone: '13900000002', code: '123456' },
    });
    const boundId = bound.json().data.id;

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone: '13900000002', code: '123456' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.accountId).toBe(boundId);
    expect(login.json().data.created).toBe(false);
  });

  it('rejects a wrong code with 401 and does not bind anything', async () => {
    const token = await guestToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/bind-phone',
      headers: auth(token),
      payload: { phone: '13900000003', code: '000000' },
    });

    expect(res.statusCode).toBe(401);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(me.json().data.phone).toBeNull();
  });

  it('rejects a phone that already belongs to another account with 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone: '13900000004', code: '123456' },
    });

    const token = await guestToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/bind-phone',
      headers: auth(token),
      payload: { phone: '13900000004', code: '123456' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects an invalid phone format', async () => {
    const token = await guestToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/bind-phone',
      headers: auth(token),
      payload: { phone: '12345', code: '123456' },
    });
    expect(res.statusCode).toBe(400);
  });
});
