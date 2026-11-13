import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { DashboardPage } from '../pages/DashboardPage';
import { renderWithProviders, okJson, errJson, seedSession } from '../test/helpers';

const dashboard = {
  content: { total: 2197, published: 2180, draft: 5, review: 12, archived: 0 },
  health: { missingCover: 2197, missingAudio: 2197, missingAgeBand: 0, unhealthyRatio: 100 },
  users: { families: 3, children: 4 },
  plays24h: 171,
};

const overview = { byHour: [{ hour: 20, plays: 120 }, { hour: 21, plays: 90 }, { hour: 9, plays: 10 }] };

describe('数据看板', () => {
  beforeEach(() => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('统计数字来自 dashboard 接口而非写死', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(dashboard) as never)
      .mockReturnValueOnce(okJson(overview) as never);

    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(screen.getByTestId('stat-grid')).toBeInTheDocument());
    expect(screen.getByText('171')).toBeInTheDocument();
    expect(screen.getByText('2,180')).toBeInTheDocument();
    // 待审核 12 出现在卡片与健康度两处
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
  });

  it('健康度区块展示缺封面与无音频的真实计数', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(dashboard) as never)
      .mockReturnValueOnce(okJson(overview) as never);

    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId('health-缺封面')).toHaveTextContent('2,197'));
    expect(screen.getByTestId('health-无音频')).toHaveTextContent('2,197');
    expect(screen.getByTestId('health-无年龄档')).toHaveTextContent('0');
  });

  it('请求都带上 Authorization 头', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(dashboard) as never)
      .mockReturnValueOnce(okJson(overview) as never);

    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('接口失败时展示错误与重试，不白屏', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(errJson('INTERNAL', '服务器内部错误', 500) as never);

    renderWithProviders(<DashboardPage />);
    expect(await screen.findByTestId('load-error')).toHaveTextContent('服务器内部错误');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('时段分布按小时渲染，含睡前时段图例', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(dashboard) as never)
      .mockReturnValueOnce(okJson(overview) as never);

    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId('hour-bars')).toBeInTheDocument());
    expect(screen.getByText(/20:00–22:00 睡前时段/)).toBeInTheDocument();
  });
});
