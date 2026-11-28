import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '../pages/LoginPage';
import { renderWithProviders, okJson, errJson } from '../test/helpers';

describe('登录页', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('渲染品牌文案与账号密码表单', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByText('登录运营后台')).toBeInTheDocument();
    expect(screen.getByText(/把故事挑好/)).toBeInTheDocument();
    expect(screen.getByLabelText('账号')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入账号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument();
  });

  it('账号格式非法时不发请求', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByPlaceholderText('请输入账号'), 'ab');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'secret-pass');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByText(/账号需为 3–32 位/)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('成功登录会调用 /api/admin/auth/login 并写入 token', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(
      okJson({ token: 'jwt-abc', accountId: 'acc_1', role: 'admin', username: 'admin-user' }) as never,
    );

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('请输入账号'), 'admin-user');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'secret-pass');
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
    await user.type(screen.getByPlaceholderText('请输入账号'), 'parent-user');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'secret-pass');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-error')).toHaveTextContent('该账号无管理权限');
    expect(localStorage.getItem('story_admin_token')).toBeNull();
  });

  it('登录页不再出现手机号与验证码相关 UI 与文案', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.queryByText(/手机号/)).toBeNull();
    expect(screen.queryByText(/验证码/)).toBeNull();
    expect(screen.queryByPlaceholderText('13900000001')).toBeNull();
    expect(screen.queryByPlaceholderText('123456')).toBeNull();
  });

  it('密码错误时展示统一错误，且不写入 token', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(errJson('UNAUTHORIZED', '账号或密码错误', 401) as never);

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('请输入账号'), 'admin-user');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'wrong-pass');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-error')).toHaveTextContent('账号或密码错误');
    expect(localStorage.getItem('story_admin_token')).toBeNull();
  });

  it('提交的 body 只有账号与密码，不带 phone/code', async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockReturnValueOnce(
      okJson({ token: 'jwt-abc', accountId: 'acc_1', role: 'admin', username: 'admin-user' }) as never,
    );

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('请输入账号'), 'admin-user');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'secret-pass');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ username: 'admin-user', password: 'secret-pass' });
  });
});
