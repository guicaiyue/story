import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '../pages/LoginPage';
import { renderWithProviders, okJson, errJson } from '../test/helpers';

describe('登录页', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('渲染品牌文案与登录表单', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByText('登录运营后台')).toBeInTheDocument();
    expect(screen.getByText(/把故事挑好/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('13900000001')).toBeInTheDocument();
  });

  it('手机号格式非法时不发请求', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByPlaceholderText('13900000001'), '12345');
    await user.type(screen.getByPlaceholderText('123456'), '123456');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByText('手机号格式不正确')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('成功登录会调用 /api/admin/auth/login 并写入 token', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(okJson({ token: 'jwt-abc', accountId: 'acc_1', role: 'admin' }) as never);

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('13900000001'), '13900000001');
    await user.type(screen.getByPlaceholderText('123456'), '123456');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(localStorage.getItem('story_admin_token')).toBe('jwt-abc');
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('账号无管理权限时展示服务端返回的 403 文案', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(errJson('FORBIDDEN', '该账号无管理权限', 403) as never);

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('13900000001'), '13800000001');
    await user.type(screen.getByPlaceholderText('123456'), '123456');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-error')).toHaveTextContent('该账号无管理权限');
    expect(localStorage.getItem('story_admin_token')).toBeNull();
  });
});
