import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpsPage } from '../pages/OpsPage';
import { FamiliesPage } from '../pages/FamiliesPage';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { SystemPage } from '../pages/SystemPage';
import { renderWithProviders, okJson, errJson, seedSession, mockFetchRoutes, callsOf } from '../test/helpers';

const categories = [
  { id: 1, name: '睡前故事', sortId: 10, storyCount: 199 },
  { id: 13, name: '聊斋志异', sortId: 0, storyCount: 293 },
];

const banners = [
  { id: 1, title: '今晚听什么 · 睡前精选', imageUrl: '/a.svg', targetType: 'story', targetId: '9', sort: 1, status: 'active' },
  { id: 3, title: '经典故事合集', imageUrl: '/c.svg', targetType: 'category', targetId: '10', sort: 3, status: 'hidden' },
];

describe('分类与推荐位', () => {
  beforeEach(() => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('渲染真实的分类与推荐位数据', async () => {
    mockFetchRoutes([
      ['/api/admin/categories', () => okJson(categories)],
      ['/api/admin/banners', () => okJson(banners)],
    ]);

    renderWithProviders(<OpsPage />, { route: '/ops' });

    expect(await screen.findByDisplayValue('睡前故事')).toBeInTheDocument();
    expect(screen.getByDisplayValue('聊斋志异')).toBeInTheDocument();
    expect(screen.getByText('今晚听什么 · 睡前精选')).toBeInTheDocument();
    expect(screen.getByText('展示中')).toBeInTheDocument();
  });

  it('修改分类名后调用 PATCH /api/admin/categories/:id', async () => {
    const user = userEvent.setup();
    mockFetchRoutes([
      ['/api/admin/categories/1', () => okJson({ id: 1, name: '睡前故事集', sortId: 10 })],
      ['/api/admin/categories', () => okJson(categories)],
      ['/api/admin/banners', () => okJson(banners)],
    ]);

    renderWithProviders(<OpsPage />, { route: '/ops' });
    await screen.findByDisplayValue('睡前故事');

    const input = screen.getByTestId('cat-name-1');
    await user.clear(input);
    await user.type(input, '睡前故事集');
    await user.click(screen.getByTestId('cat-save-1'));

    await waitFor(() => {
      const call = callsOf(globalThis.fetch).find(([u]) => u.includes('/api/admin/categories/1'));
      expect(call).toBeTruthy();
      expect(call![1]?.method).toBe('PATCH');
    });
  });

  it('切换推荐位状态调用 PATCH /api/admin/banners/:id', async () => {
    const user = userEvent.setup();
    mockFetchRoutes([
      ['/api/admin/banners/1', () => okJson(banners[0])],
      ['/api/admin/categories', () => okJson(categories)],
      ['/api/admin/banners', () => okJson(banners)],
    ]);

    renderWithProviders(<OpsPage />, { route: '/ops' });
    await screen.findByText('今晚听什么 · 睡前精选');

    await user.click(screen.getByTestId('banner-toggle-1'));

    await waitFor(() => {
      const call = callsOf(globalThis.fetch).find(([u]) => u.includes('/api/admin/banners/1'));
      expect(call).toBeTruthy();
      expect(String(call![1]?.body)).toContain('hidden');
    });
  });

  it('加载失败展示错误与重试', async () => {
    mockFetchRoutes([['/api/admin/categories', () => errJson('INTERNAL', '服务器内部错误', 500)]]);
    renderWithProviders(<OpsPage />, { route: '/ops' });

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  // ---- M2.1 项目 3：推荐位增删 ----

  it('新增推荐位 POST 到 /api/admin/banners', async () => {
    const user = userEvent.setup();
    mockFetchRoutes([
      [
        '/api/admin/banners',
        (_u, init) =>
          init?.method === 'POST'
            ? okJson({ id: 9, title: '新推荐位', imageUrl: '', targetType: 'story', targetId: '8', sort: 0, status: 'active' })
            : okJson(banners),
      ],
      ['/api/admin/categories', () => okJson(categories)],
    ]);

    renderWithProviders(<OpsPage />, { route: '/ops' });
    await screen.findByText('今晚听什么 · 睡前精选');

    await user.click(screen.getByTestId('banner-create-open'));
    await user.type(await screen.findByTestId('banner-title'), '新推荐位');
    await user.type(screen.getByTestId('banner-target'), '8');
    await user.click(screen.getByRole('button', { name: '创 建' }));

    await waitFor(() => {
      const call = callsOf(globalThis.fetch).find(([u, i]) => u.includes('/api/admin/banners') && i?.method === 'POST');
      expect(call).toBeTruthy();
      expect(String(call![1]?.body)).toContain('新推荐位');
    });
  });

  it('删除推荐位走 DELETE 并需确认', async () => {
    const user = userEvent.setup();
    mockFetchRoutes([
      [
        '/api/admin/banners/1',
        (_u, init) => (init?.method === 'DELETE' ? okJson({ id: 1, deleted: true }) : okJson(banners[0])),
      ],
      ['/api/admin/categories', () => okJson(categories)],
      ['/api/admin/banners', () => okJson(banners)],
    ]);

    renderWithProviders(<OpsPage />, { route: '/ops' });
    await screen.findByText('今晚听什么 · 睡前精选');

    await user.click(screen.getByTestId('banner-delete-1'));
    // Popconfirm 必须真的弹出来问一句，不能点一下就删。
    await user.click(await screen.findByRole('button', { name: '删 除' }));

    await waitFor(() => {
      const call = callsOf(globalThis.fetch).find(([u, i]) => u.includes('/api/admin/banners/1') && i?.method === 'DELETE');
      expect(call).toBeTruthy();
    });
  });

  it('改排序后才出现「保存排序」，PATCH 带 sort', async () => {
    const user = userEvent.setup();
    mockFetchRoutes([
      [
        '/api/admin/banners/1',
        (_u, init) => (init?.method === 'PATCH' ? okJson({ ...banners[0], sort: 42 }) : okJson(banners[0])),
      ],
      ['/api/admin/categories', () => okJson(categories)],
      ['/api/admin/banners', () => okJson(banners)],
    ]);

    renderWithProviders(<OpsPage />, { route: '/ops' });
    await screen.findByText('今晚听什么 · 睡前精选');

    // 未改动时不显示「保存排序」（按钮仍显示隐藏/展示）。
    expect(screen.queryByTestId('banner-save-sort-1')).toBeNull();

    const sortInput = screen.getByTestId('banner-sort-1');
    await user.clear(sortInput);
    await user.type(sortInput, '42');

    expect(await screen.findByTestId('banner-save-sort-1')).toBeInTheDocument();
    await user.click(screen.getByTestId('banner-save-sort-1'));

    await waitFor(() => {
      const call = callsOf(globalThis.fetch).find(([u, i]) => u.includes('/api/admin/banners/1') && i?.method === 'PATCH');
      expect(call).toBeTruthy();
      expect(String(call![1]?.body)).toContain('42');
    });
  });
});

describe('家庭与儿童档案', () => {
  beforeEach(() => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn());
  });

  const accounts = {
    items: [
      { id: 'acc_1', phone: '13900000001', nickname: '林知远', role: 'admin', createdAt: '2026-11-09T10:00:00.000Z', _count: { children: 1 } },
      { id: 'acc_2', phone: '13800000001', nickname: '朵朵妈', role: 'parent', createdAt: '2026-11-09T09:00:00.000Z', _count: { children: 2 } },
      { id: 'acc_3', phone: null, nickname: '游客', role: 'parent', createdAt: '2026-11-09T08:00:00.000Z', _count: { children: 0 } },
    ],
    total: 3,
    page: 1,
    pageSize: 20,
  };

  it('手机号脱敏展示，游客账号有兜底文案', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(okJson(accounts) as never);
    renderWithProviders(<FamiliesPage />, { route: '/families' });

    expect(await screen.findByText('139****0001')).toBeInTheDocument();
    expect(screen.getByText('138****0001')).toBeInTheDocument();
    expect(screen.getByText('游客账号')).toBeInTheDocument();
  });

  it('展示角色标签与儿童档案数量', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(okJson(accounts) as never);
    renderWithProviders(<FamiliesPage />, { route: '/families' });

    expect(await screen.findByText('管理员')).toBeInTheDocument();
    expect(screen.getAllByText('家长').length).toBeGreaterThan(0);
    expect(screen.getByText('2 个')).toBeInTheDocument();
  });

  it('请求带上分页参数', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(okJson(accounts) as never);
    renderWithProviders(<FamiliesPage />, { route: '/families' });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toContain('/api/admin/accounts');
    expect(url).toContain('page=1');
  });
});

describe('数据中心', () => {
  beforeEach(() => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn());
  });

  const overview = { byHour: [{ hour: 20, plays: 600 }, { hour: 21, plays: 400 }, { hour: 8, plays: 100 }] };
  const top = {
    items: [
      { storyId: 9, title: '小兔子找月亮', plays: 12, completes: 9, completionRate: 75 },
      { storyId: 7, title: '勇敢的小刺猬', plays: 5, completes: 1, completionRate: 20 },
    ],
  };
  const trend = {
    days: 14,
    items: [
      { day: '2026-11-08', plays: 3, completes: 1, completionRate: 33.3 },
      { day: '2026-11-09', plays: 0, completes: 0, completionRate: 0 },
      { day: '2026-11-10', plays: 7, completes: 5, completionRate: 71.4 },
    ],
  };
  const cats = {
    items: [
      { categoryId: 1, name: '睡前故事', total: 199, bands: { '3-6': 199, '6-9': 0, '9+': 0 } },
      { categoryId: 13, name: '聊斋志异', total: 293, bands: { '3-6': 0, '6-9': 0, '9+': 293 } },
    ],
  };

  /**
   * 按 URL 分派 mock。
   *
   * 页面用 Promise.all 并发拉四个端点，**到达顺序不保证**，所以不能用
   * mockReturnValueOnce 按顺序铺 —— 会随机错配。按 URL 匹配才稳。
   */
  function mockAll(o: unknown = overview, t: unknown = top, tr: unknown = trend, c: unknown = cats) {
    return mockFetchRoutes([
      ['/api/admin/analytics/overview', () => okJson(o)],
      ['/api/admin/analytics/top', () => okJson(t)],
      ['/api/admin/analytics/trend', () => okJson(tr)],
      ['/api/admin/analytics/categories', () => okJson(c)],
    ]);
  }

  it('睡前时段占比按真实事件计算', async () => {
    mockAll();
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    // (600 + 400) / 1100 = 90.9%
    await waitFor(() => expect(screen.getByTestId('bedtime-ratio')).toHaveTextContent('90.9'));
  });

  it('累计播放取自 overview 的事件总和', async () => {
    mockAll();
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    // 600 + 400 + 100 = 1100
    await waitFor(() => expect(screen.getByTestId('total-plays')).toHaveTextContent('1,100'));
  });

  it('渲染播放 Top 20 的真实排行与完播率', async () => {
    mockAll();
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    expect(await screen.findByTestId('analytics-top')).toBeInTheDocument();
    expect(screen.getByText('小兔子找月亮')).toBeInTheDocument();
    // 完播率与完播次数都展示，便于核对不是编的数字。
    expect(screen.getByTestId('top-rate-9')).toHaveTextContent('75%');
    expect(screen.getByTestId('top-rate-9')).toHaveTextContent('(9)');
  });

  it('渲染近 14 天趋势，零播放日也保留', async () => {
    mockAll();
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    expect(await screen.findByTestId('analytics-trend')).toBeInTheDocument();
    // 三条数据（含一条 0 播放）都应出现 —— 零值日不能被跳过。
    expect(screen.getByText('11-08')).toBeInTheDocument();
    expect(screen.getByText('11-09')).toBeInTheDocument();
    expect(screen.getByText('11-10')).toBeInTheDocument();
  });

  it('趋势完播率按真实数据计算', async () => {
    mockAll();
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    // (1 + 0 + 5) / (3 + 0 + 7) = 60.0%
    await waitFor(() => expect(screen.getByTestId('trend-rate')).toHaveTextContent('60.0'));
  });

  it('渲染分类分布并标出 9+ 档', async () => {
    mockAll();
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    expect(await screen.findByTestId('analytics-categories')).toBeInTheDocument();
    expect(screen.getByText('睡前故事')).toBeInTheDocument();
    expect(screen.getByText('聊斋志异')).toBeInTheDocument();
    // 聊斋 293 篇都是 9+，必须显示警示标记。
    expect(screen.getByText('9+ 293')).toBeInTheDocument();
  });

  it('请求的是四个真实分析端点，且趋势带上天数', async () => {
    mockAll();
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(4));
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/admin/analytics/overview'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/admin/analytics/top'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/admin/analytics/trend'))).toBe(true);
    expect(urls.some((u) => u.includes('days=14'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/admin/analytics/categories'))).toBe(true);
  });

  it('没有播放事件时给出提示而非空白', async () => {
    mockAll({ byHour: [] }, { items: [] }, { days: 14, items: [] }, { items: [] });
    renderWithProviders(<AnalyticsPage />, { route: '/analytics' });

    expect(await screen.findByText('暂无播放事件')).toBeInTheDocument();
    expect(screen.getByText('暂无播放记录')).toBeInTheDocument();
  });
});

describe('管理员与日志', () => {
  beforeEach(() => {
    seedSession('admin');
    vi.stubGlobal('fetch', vi.fn());
  });

  const audit = {
    items: [
      { id: 'a1', actorId: 'acc_1', action: 'story.approve', target: '101', detail: { note: 'ok' }, at: '2026-11-09T12:00:00.000Z' },
      { id: 'a2', actorId: 'acc_2', action: 'login', target: 'admin', detail: null, at: '2026-11-09T11:00:00.000Z' },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  };

  /**
   * 两组账号分开：页面会分两次请求 role=admin 与 role=editor 再合并。
   * 若两个 role 都返回同一份列表，行会**重复出现**（同一 id 渲染两次），
   * 表现为 getByText 报 "Found multiple elements"。所以这里必须按 role 分开。
   */
  const adminsOnly = {
    items: [
      { id: 'acc_1', phone: '13900000001', nickname: '测试管理员', role: 'admin', status: 'active', createdAt: '2026-11-01T00:00:00.000Z', _count: { children: 0 } },
    ],
    total: 1,
    page: 1,
    pageSize: 100,
  };

  const editorsOnly = {
    items: [
      { id: 'acc_2', phone: '13900000002', nickname: '小编', role: 'editor', status: 'disabled', createdAt: '2026-11-02T00:00:00.000Z', _count: { children: 0 } },
    ],
    total: 1,
    page: 1,
    pageSize: 100,
  };

  /**
   * SystemPage 发三个请求（admin 列表 / editor 列表 / 审计），且前两个并发。
   * 按 URL + role 分派，避免顺序错配。
   */
  function mockSystem(au: unknown = audit) {
    return mockFetchRoutes([
      ['/api/admin/accounts', (u, init) => {
        if (init?.method === 'POST') return okJson({ id: 'acc_3', phone: '13900000003', nickname: '新同事', role: 'editor', status: 'active' });
        if (init?.method === 'PATCH') return okJson({ ...editorsOnly.items[0], status: 'active' });
        return u.includes('role=editor') ? okJson(editorsOnly) : okJson(adminsOnly);
      }],
      ['/api/admin/audit', () => okJson(au)],
    ]);
  }

  it('把动作码翻译成中文并展示对象', async () => {
    mockSystem();
    renderWithProviders(<SystemPage />, { route: '/system' });

    expect(await screen.findByText('审核通过')).toBeInTheDocument();
    expect(screen.getByText('登录后台')).toBeInTheDocument();
    expect(screen.getByText('故事 #101')).toBeInTheDocument();
  });

  it('展示当前登录账号与角色', async () => {
    mockSystem();
    renderWithProviders(<SystemPage />, { route: '/system' });

    expect(await screen.findByText('测试管理员')).toBeInTheDocument();
    // 「超级管理员」既出现在当前账号卡片，也出现在表格的角色下拉里，
    // 所以用 getAllByText（至少出现一次即可）。
    expect(screen.getAllByText(/超级管理员/).length).toBeGreaterThan(0);
  });

  it('展示管理员列表与状态', async () => {
    mockSystem();
    renderWithProviders(<SystemPage />, { route: '/system' });

    const table = within(await screen.findByTestId('admins-table'));
    expect(table.getByText('小编')).toBeInTheDocument();
    expect(table.getByText('可用')).toBeInTheDocument();
    expect(table.getByText('已停用')).toBeInTheDocument();
  });

  it('只请求后台角色（admin + editor），不混入家长账号', async () => {
    mockSystem();
    renderWithProviders(<SystemPage />, { route: '/system' });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    const urls = callsOf(globalThis.fetch).map(([u]) => u);
    expect(urls.filter((u) => u.includes('role=admin')).length).toBe(1);
    expect(urls.filter((u) => u.includes('role=editor')).length).toBe(1);
    expect(urls.some((u) => u.includes('role=parent'))).toBe(false);
  });

  it('当前账号那行不给停用入口', async () => {
    mockSystem();
    renderWithProviders(<SystemPage />, { route: '/system' });

    const table = within(await screen.findByTestId('admins-table'));
    // seedSession 里 accountId = acc_1，即列表里的 admin。
    expect(table.getByText('当前账号')).toBeInTheDocument();
    expect(table.queryByTestId('admin-toggle-acc_1')).toBeNull();
    // 别人（editor）可以停用。
    expect(table.getByTestId('admin-toggle-acc_2')).toBeInTheDocument();
  });

  it('新增管理员会 POST 到 /api/admin/accounts', async () => {
    mockSystem();
    renderWithProviders(<SystemPage />, { route: '/system' });
    await screen.findByTestId('admins-table');

    await userEvent.click(screen.getByTestId('admin-create-open'));
    await userEvent.type(await screen.findByTestId('admin-phone'), '13900000003');
    await userEvent.type(screen.getByTestId('admin-nickname'), '新同事');
    await userEvent.click(screen.getByRole('button', { name: '创 建' }));

    await waitFor(() => {
      const call = callsOf(globalThis.fetch).find(([, i]) => i?.method === 'POST');
      expect(call).toBeTruthy();
      expect(call![0]).toContain('/api/admin/accounts');
      expect(String(call![1]?.body)).toContain('13900000003');
    });
  });

  it('停用走 PATCH 并带上 status', async () => {
    mockSystem();
    renderWithProviders(<SystemPage />, { route: '/system' });
    await screen.findByTestId('admins-table');

    // acc_2 已是 disabled，所以按钮是「启用」；点它会发 status=active。
    await userEvent.click(screen.getByTestId('admin-toggle-acc_2'));
    await userEvent.click(await screen.findByRole('button', { name: '确 定' }));

    await waitFor(() => {
      const call = callsOf(globalThis.fetch).find(([, i]) => i?.method === 'PATCH');
      expect(call).toBeTruthy();
      expect(call![0]).toContain('/api/admin/accounts/acc_2');
      expect(String(call![1]?.body)).toContain('active');
    });
  });

  it('加载失败时提示错误', async () => {
    mockFetchRoutes([['/api/admin', () => errJson('INTERNAL', '服务器内部错误', 500)]]);
    renderWithProviders(<SystemPage />, { route: '/system' });

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
  });
});
