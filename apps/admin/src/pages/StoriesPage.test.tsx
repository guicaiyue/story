import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoriesPage } from '../pages/StoriesPage';
import { renderWithProviders, okJson, errJson, seedSession } from '../test/helpers';

const story = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  title: '小兔子找月亮',
  excerpt: '简介',
  categoryId: 1,
  ageBand: '3-6',
  tags: [],
  status: 'published',
  featured: false,
  durationSec: 0,
  coverUrl: null,
  audioUrl: null,
  length: 320,
  publishedAt: null,
  updatedAt: '2026-11-09T10:00:00.000Z',
  ...over,
});

const page = (items: unknown[], total = items.length) => ({ items, page: 1, pageSize: 20, total, totalPages: 1 });

const categories = [{ id: 1, name: '睡前故事', sortId: 10, storyCount: 199 }];

describe('故事列表', () => {
  beforeEach(() => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn());
  });

  /** 每个用例先给故事列表与分类两个请求准备响应。 */
  function mockList(stories: unknown[], total?: number) {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(page(stories, total)) as never)
      .mockReturnValueOnce(okJson(categories) as never);
  }

  it('渲染接口返回的故事行与总数', async () => {
    mockList([story()], 2197);
    renderWithProviders(<StoriesPage />, { route: '/stories' });

    expect(await screen.findByText('小兔子找月亮')).toBeInTheDocument();
    expect(screen.getAllByText(/共 2,197 篇/).length).toBeGreaterThan(0);
  });

  it('请求 URL 带上分页参数', async () => {
    mockList([story()]);
    renderWithProviders(<StoriesPage />, { route: '/stories?page=3&pageSize=50' });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toContain('page=3');
    expect(url).toContain('pageSize=50');
  });

  it('状态筛选写入 URL 并重新请求', async () => {
    const user = userEvent.setup();
    mockList([story({ status: 'review' })]);
    // 筛选后的第二次请求
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(page([story({ status: 'review' })])) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderWithProviders(<StoriesPage />, { route: '/stories' });
    await screen.findByText('小兔子找月亮');

    // AntD 的 Select 在 jsdom 下不会因 click 而展开，需直接 mouseDown 选择器。
    const select = screen.getByTestId('status-filter');
    fireEvent.mouseDown(select.querySelector('.ant-select-selector')!);
    const option = await waitFor(() => {
      const el = document.querySelector('.ant-select-item-option[title="待审核"]');
      if (!el) throw new Error('option not rendered');
      return el as HTMLElement;
    });
    await user.click(option);

    await waitFor(() => {
      const urls = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('status=review'))).toBe(true);
    });
  });

  it('标题搜索触发带 q 的请求', async () => {
    const user = userEvent.setup();
    mockList([story()]);
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(page([story()])) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderWithProviders(<StoriesPage />, { route: '/stories' });
    await screen.findByText('小兔子找月亮');

    await user.type(screen.getByTestId('search-input'), '兔{Enter}');

    await waitFor(() => {
      const urls = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('q=') && u.includes('%E5%85%94'))).toBe(true);
    });
  });

  it('加载失败时展示错误文案而非空白表格', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(errJson('INTERNAL', '服务器内部错误', 500) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderWithProviders(<StoriesPage />, { route: '/stories' });
    expect(await screen.findByText(/加载失败：服务器内部错误/)).toBeInTheDocument();
  });

  it('选中多行后出现批量操作按钮', async () => {
    const user = userEvent.setup();
    mockList([story({ id: 1 }), story({ id: 2, title: '勇敢的小刺猬' })]);
    renderWithProviders(<StoriesPage />, { route: '/stories' });

    await screen.findByText('小兔子找月亮');
    const checkboxes = screen.getAllByRole('checkbox');
    // 第一个是表头全选，取数据行
    await user.click(checkboxes[1]!);

    await waitFor(() => expect(screen.getByText(/已选 1 篇/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /批量提审/ })).toBeInTheDocument();
  });

  it('批量提审逐条调用 submit 接口', async () => {
    const user = userEvent.setup();
    mockList([story({ id: 7, status: 'draft' })]);
    renderWithProviders(<StoriesPage />, { route: '/stories' });

    await screen.findByText('小兔子找月亮');
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]!);

    // submit + 之后 reload（列表 + 分类）
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson({ id: 7, status: 'review' }) as never)
      .mockReturnValueOnce(okJson(page([story({ id: 7, status: 'review' })])) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    await user.click(screen.getByRole('button', { name: /批量提审/ }));

    await waitFor(() => {
      const urls = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/api/admin/stories/7/submit'))).toBe(true);
    });
  });

  it('表格展示分类名与年龄档', async () => {
    mockList([story({ ageBand: '9+' })]);
    renderWithProviders(<StoriesPage />, { route: '/stories' });

    await screen.findByText('小兔子找月亮');
    expect(screen.getByText('睡前故事')).toBeInTheDocument();
    expect(screen.getByText('9+ 岁')).toBeInTheDocument();
  });

  it('空结果时展示空状态文案', async () => {
    mockList([], 0);
    renderWithProviders(<StoriesPage />, { route: '/stories?q=zzz' });

    expect(await screen.findByText('没有符合条件的故事')).toBeInTheDocument();
  });

  it('为每行提供编辑链接', async () => {
    mockList([story({ id: 42 })]);
    renderWithProviders(<StoriesPage />, { route: '/stories' });

    const link = await screen.findByRole('link', { name: '小兔子找月亮' });
    expect(link).toHaveAttribute('href', '/stories/42');
  });
});

describe('故事列表 · 状态标签', () => {
  it('不同状态渲染不同标签', async () => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(page([story({ id: 1, status: 'draft' }), story({ id: 2, title: 'B', status: 'archived' })])) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderWithProviders(<StoriesPage />, { route: '/stories' });
    const table = await screen.findByTestId('stories-table');
    expect(within(table).getByText('草稿')).toBeInTheDocument();
    expect(within(table).getByText('已归档')).toBeInTheDocument();
  });
});
