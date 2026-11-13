import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { StoryEditPage } from '../pages/StoryEditPage';
import { renderWithProviders, okJson, errJson, seedSession } from '../test/helpers';

const detail = {
  id: 42,
  title: '小兔子找月亮',
  excerpt: '一段简介',
  categoryId: 1,
  categoryName: '睡前故事',
  ageBand: '3-6',
  tags: ['睡前'],
  status: 'draft',
  featured: false,
  durationSec: 0,
  coverUrl: null,
  audioUrl: null,
  length: 879,
  publishedAt: null,
  updatedAt: '2026-11-09T10:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  content: '正文第一段。\n第二段。',
};

const categories = [{ id: 1, name: '睡前故事', sortId: 10, storyCount: 199 }];

/** StoryEditPage reads :id from the route, so mount it under a real Route. */
function renderEdit() {
  return renderWithProviders(
    <Routes>
      <Route path="/stories/:id" element={<StoryEditPage />} />
    </Routes>,
    { route: '/stories/42' },
  );
}

describe('故事编辑', () => {
  beforeEach(() => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('从接口载入详情并回填表单', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderEdit();

    expect(await screen.findByTestId('edit-title')).toHaveValue('小兔子找月亮');
    expect(screen.getByTestId('edit-content')).toHaveValue('正文第一段。\n第二段。');
  });

  it('展示正文字数与状态，不把字数当播放时长', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderEdit();

    expect(await screen.findByText(/正文字数 879/)).toBeInTheDocument();
    expect(screen.getByText('草稿')).toBeInTheDocument();
    // 时长字段独立存在，默认 0
    expect(screen.getByLabelText('时长（秒）')).toHaveValue('0');
  });

  it('保存时 PATCH 到 /api/admin/stories/:id', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never)
      .mockReturnValueOnce(okJson({ id: 42, title: '新标题', status: 'draft' }) as never)
      .mockReturnValueOnce(okJson({ ...detail, title: '新标题' }) as never);

    renderEdit();
    const title = await screen.findByTestId('edit-title');

    await user.clear(title);
    await user.type(title, '新标题');
    await user.click(screen.getByTestId('edit-save'));

    await waitFor(() => {
      const call = vi.mocked(globalThis.fetch).mock.calls.find(
        (c) => String(c[0]).endsWith('/api/admin/stories/42') && (c[1] as RequestInit)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      expect(String((call![1] as RequestInit).body)).toContain('新标题');
    });
  });

  it('草稿状态显示「提交审核」入口', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderEdit();
    expect(await screen.findByTestId('edit-submit')).toBeInTheDocument();
  });

  it('已上架状态不显示提交审核按钮', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson({ ...detail, status: 'published' }) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderEdit();
    await screen.findByTestId('edit-title');
    expect(screen.queryByTestId('edit-submit')).not.toBeInTheDocument();
  });

  it('故事不存在时展示错误与返回入口', async () => {
    vi.mocked(globalThis.fetch).mockReturnValueOnce(errJson('NOT_FOUND', '故事不存在', 404) as never);

    renderEdit();
    expect(await screen.findByTestId('edit-error')).toHaveTextContent('故事不存在');
    expect(screen.getByTestId('edit-back')).toBeInTheDocument();
  });

  // ---- M2.1 项目 1：正文写回 ----

  it('正文可编辑（不再是只读）', async () => {
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderEdit();

    const textarea = await screen.findByTestId('edit-content');
    expect(textarea).toHaveValue('正文第一段。\n第二段。');
    // 关键：readOnly 必须已解除，否则「可改正文」是假的。
    expect(textarea).not.toHaveAttribute('readonly');
  });

  it('保存正文 PUT 到 /api/admin/stories/:id/content，且不触发 PATCH', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never)
      .mockReturnValueOnce(okJson({ id: 42, length: 12, excerpt: '一段简介', updatedAt: '2026-11-10T00:00:00.000Z' }) as never)
      .mockReturnValueOnce(okJson({ ...detail, content: '改过的正文', length: 12 }) as never);

    renderEdit();
    const textarea = await screen.findByTestId('edit-content');

    await user.clear(textarea);
    await user.type(textarea, '改过的正文');
    await user.click(screen.getByTestId('edit-content-save'));

    await waitFor(() => {
      const call = vi.mocked(globalThis.fetch).mock.calls.find(
        (c) => String(c[0]).endsWith('/api/admin/stories/42/content') && (c[1] as RequestInit)?.method === 'PUT',
      );
      expect(call).toBeTruthy();
      expect(String((call![1] as RequestInit).body)).toContain('改过的正文');
    });

    // 正文保存走的是 content 端点，不应顺带 PATCH 基本信息。
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some(
        (c) => String(c[0]).endsWith('/api/admin/stories/42') && (c[1] as RequestInit)?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('正文为空时拒绝提交，不发请求', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never);

    renderEdit();
    const textarea = await screen.findByTestId('edit-content');

    await user.clear(textarea);
    await user.click(screen.getByTestId('edit-content-save'));

    await waitFor(() => expect(screen.getByText('正文为空，未提交保存')).toBeInTheDocument());
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(false);
  });

  it('正文保存失败时把服务端错误原样提示', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch)
      .mockReturnValueOnce(okJson(detail) as never)
      .mockReturnValueOnce(okJson(categories) as never)
      .mockReturnValueOnce(errJson('BAD_REQUEST', '正文过长（上限 50000 字）', 400) as never);

    renderEdit();
    const textarea = await screen.findByTestId('edit-content');

    await user.clear(textarea);
    await user.type(textarea, '短正文');
    await user.click(screen.getByTestId('edit-content-save'));

    expect(await screen.findByText('正文过长（上限 50000 字）')).toBeInTheDocument();
  });
});
