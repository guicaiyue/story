import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewPage } from '../pages/ReviewPage';
import { renderWithProviders, okJson, errJson, seedSession } from '../test/helpers';

const reviewStory = (over: Record<string, unknown> = {}) => ({
  id: 101,
  title: '动物园规则怪谈',
  excerpt: '待审内容',
  categoryId: 15,
  ageBand: '9+',
  tags: [],
  status: 'review',
  featured: false,
  durationSec: 0,
  coverUrl: null,
  audioUrl: null,
  length: 1500,
  publishedAt: null,
  updatedAt: '2026-11-09T10:00:00.000Z',
  ...over,
});

const page = (items: unknown[], total = items.length) => ({ items, page: 1, pageSize: 20, total, totalPages: 1 });

describe('审核队列', () => {
  beforeEach(() => {
    seedSession('admin');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('只请求 status=review 的故事', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(okJson(page([reviewStory()])) as never);
    renderWithProviders(<ReviewPage />, { route: '/review' });

    await screen.findByText('动物园规则怪谈');
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toContain('status=review');
  });

  it('展示待审核总数', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(okJson(page([reviewStory()], 12)) as never);
    renderWithProviders(<ReviewPage />, { route: '/review' });

    expect(await screen.findByText(/待审核 12 篇/)).toBeInTheDocument();
  });

  it('通过 => 调用 review 接口并携带 approve，随后刷新列表', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(page([reviewStory()])) as never)
      .mockReturnValueOnce(okJson({ id: 101, status: 'published', publishedAt: '2026-11-09T12:00:00.000Z' }) as never)
      .mockReturnValueOnce(okJson(page([])) as never);

    renderWithProviders(<ReviewPage />, { route: '/review' });
    await screen.findByText('动物园规则怪谈');

    await user.click(screen.getByTestId('approve-101'));

    await waitFor(() => {
      const call = vi.mocked(globalThis.fetch).mock.calls.find((c) => String(c[0]).includes('/review'));
      expect(call).toBeTruthy();
      expect(String(call![0])).toContain('/api/admin/stories/101/review');
      expect(String((call![1] as RequestInit).body)).toContain('approve');
    });
  });

  it('驳回 => 打开弹窗并提交 reject 与原因', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(page([reviewStory()])) as never)
      .mockReturnValueOnce(okJson({ id: 101, status: 'draft', publishedAt: null }) as never)
      .mockReturnValueOnce(okJson(page([])) as never);

    renderWithProviders(<ReviewPage />, { route: '/review' });
    await screen.findByText('动物园规则怪谈');

    await user.click(screen.getByTestId('reject-101'));
    expect(await screen.findByText(/驳回《动物园规则怪谈》/)).toBeInTheDocument();

    await user.type(screen.getByTestId('reject-reason'), '年龄档标注不当');
    await user.click(screen.getByRole('button', { name: /确认驳回/ }));

    await waitFor(() => {
      const call = vi.mocked(globalThis.fetch).mock.calls.find((c) => String(c[0]).includes('/review'));
      const body = String((call![1] as RequestInit).body);
      expect(body).toContain('reject');
      expect(body).toContain('年龄档标注不当');
    });
  });

  it('editor 无权审核时展示服务端 403 文案', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(page([reviewStory()])) as never)
      .mockReturnValueOnce(errJson('FORBIDDEN', '需要更高的权限', 403) as never);

    renderWithProviders(<ReviewPage />, { route: '/review' });
    await screen.findByText('动物园规则怪谈');
    await user.click(screen.getByTestId('approve-101'));

    expect(await screen.findByText('需要更高的权限')).toBeInTheDocument();
  });

  it('队列为空时展示空状态', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(okJson(page([], 0)) as never);
    renderWithProviders(<ReviewPage />, { route: '/review' });

    expect(await screen.findByText(/审核队列已清空/)).toBeInTheDocument();
  });

  it('加载失败时在表格内提示错误', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(errJson('INTERNAL', '服务器内部错误', 500) as never);
    renderWithProviders(<ReviewPage />, { route: '/review' });

    expect(await screen.findByText(/加载失败：服务器内部错误/)).toBeInTheDocument();
  });
});
