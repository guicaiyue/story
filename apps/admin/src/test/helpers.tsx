import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import { vi } from 'vitest';
import { AuthProvider } from '../auth';

/**
 * Renders a page inside the same providers as the real app
 * (Ant Design theme/locale + auth + router), so tests exercise real wiring.
 */
export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  return render(
    <ConfigProvider theme={{ token: { colorPrimary: '#D98E5A' } }}>
      <AntApp>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AuthProvider>
      </AntApp>
    </ConfigProvider>,
  );
}

/** Builds a successful `{ ok: true, data }` envelope response. */
export function okJson(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Builds an error `{ ok: false, error }` envelope response. */
export function errJson(code: string, message: string, status = 400) {
  return Promise.resolve(
    new Response(JSON.stringify({ ok: false, error: { code, message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Seeds a fake admin session so authenticated pages render. */
export function seedSession(role = 'admin') {
  localStorage.setItem('story_admin_token', 'test-token');
  localStorage.setItem('story_admin_account', JSON.stringify({ accountId: 'acc_1', role, phone: '13900000001', nickname: '测试管理员' }));
}

/**
 * URL-based fetch mock.
 *
 * 为什么不用 `.mockReturnValueOnce(...)` 按顺序铺：页面并发发请求
 * （`Promise.all`）时，**到达顺序不保证**，按顺序铺会随机错配 —— 表现为
 * 「明明给了数据却渲染不出」。按 URL 分派没有这个问题，而且加一个请求
 * 也不用去数第几个。
 *
 * @param routes 形如 `[['/api/admin/banners', () => okJson(banners)], ...]`，
 *               按先后顺序匹配（先匹配到的赢），支持返回 `errJson(...)`。
 */
export function mockFetchRoutes(
  routes: Array<[match: string, respond: (url: string, init?: RequestInit) => unknown]>,
  fallback: (url: string, init?: RequestInit) => unknown = (url) =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: false, error: { code: 'NOT_MOCKED', message: `no mock for ${url}` } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [match, respond] of routes) {
      if (url.includes(match)) return respond(url, init) as never;
    }
    return fallback(url, init) as never;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** 记录所有请求，便于断言「发了哪些调用」。 */
export function callsOf(fn: unknown): Array<[string, RequestInit | undefined]> {
  return (fn as { mock: { calls: Array<[RequestInfo | URL, RequestInit | undefined]> } }).mock.calls.map((c) => [
    String(c[0]),
    c[1],
  ]);
}
