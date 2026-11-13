import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { NoopSmsAdapter } from '../src/services/auth-service.js';
import { migrateTestDb, seedTestDb, testPrisma } from './helpers/test-db.js';

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

describe('POST /api/auth/register-device', () => {
  it('creates a guest account and returns a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.token).toBeTruthy();
    expect(data.guest).toBe(true);
    expect(data.role).toBe('parent');
  });

  it('creates a distinct account per call (no account reuse)', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
    const b = await app.inject({ method: 'POST', url: '/api/auth/register-device', payload: {} });
    expect(a.json().data.accountId).not.toBe(b.json().data.accountId);
  });
});

describe('POST /api/auth/login (03-decisions D4)', () => {
  it('logs in with the fixed code and creates the account once', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone: '13800000001', code: '123456' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.created).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone: '13800000001', code: '123456' },
    });
    expect(second.json().data.created).toBe(false);
    expect(second.json().data.accountId).toBe(first.json().data.accountId);
  });

  it('rejects a wrong verification code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone: '13800000002', code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed phone number', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone: '12345', code: '123456' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not leak whether an account exists on a wrong code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { phone: '13800000001', code: '999999' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('验证码错误');
  });
});

describe('POST /api/auth/send-code', () => {
  it('routes through the SMS adapter without sending anything', async () => {
    const before = sms.sent.length;
    const res = await app.inject({ method: 'POST', url: '/api/auth/send-code', payload: { phone: '13800000009' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.channel).toBe('noop');
    expect(sms.sent.length).toBe(before + 1);
    expect(sms.sent.at(-1)?.phone).toBe('13800000009');
  });
});

describe('GET /api/me', () => {
  it('rejects a request with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer not-a-jwt' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns the account for a valid token', async () => {
    const token = await guestToken();
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe('parent');
  });
});

describe('POST /api/admin/auth/login', () => {
  it('rejects a parent account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { phone: '13800000003', code: '123456' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('issues an admin token for an admin account and writes an audit row', async () => {
    await db.account.create({ data: { phone: '13900000001', nickname: '管理员', role: 'admin' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { phone: '13900000001', code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe('admin');

    const audits = await db.auditLog.findMany({ where: { action: 'login' } });
    expect(audits.length).toBeGreaterThan(0);
  });
});
