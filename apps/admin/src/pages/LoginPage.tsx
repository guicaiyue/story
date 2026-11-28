import { useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../auth';

type FormValues = { username: string; password: string };

/**
 * 登录页 —— 对齐设计稿的左右分栏：左侧品牌叙事，右侧登录卡片。
 *
 * 走真实的 POST /api/admin/auth/login（02-architecture §4.2）。
 * web 后台是内部工具：只收账号 + 密码，不出现手机号与验证码。
 * 非 admin/editor 账号会被服务端以 403 拒绝，错误原样展示。
 */
export function LoginPage() {
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.username, values.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <section className="login-brand">
        <div className="login-logo">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v18H6.5A2.5 2.5 0 0 1 4 18.5v-13Z" stroke="#3F5B57" strokeWidth="1.6" />
            <path d="M8 3v18" stroke="#D98E5A" strokeWidth="1.6" />
            <path d="M12 8h4M12 12h4" stroke="#3A3330" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          小故事铺 · 运营后台
        </div>

        <div>
          <h1>
            把故事挑好，
            <br />
            把孩子哄睡。
          </h1>
          <p style={{ marginTop: 16 }}>
            从静态站升级为内容平台的第一版后台：选品、审核、上架、看数据都在这里完成。
          </p>
        </div>

        <div className="login-stats">
          <span className="login-stat">
            <b>2,197</b>
            <span>篇故事</span>
          </span>
          <span className="login-stat">
            <b>15</b>
            <span>个分类</span>
          </span>
          <span className="login-stat">
            <b>0</b>
            <span>个音频（TTS 实时合成）</span>
          </span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h2>登录运营后台</h2>
          <p>使用内容团队分配的账号登录</p>

          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} data-testid="login-error" /> : null}

          <Form<FormValues> layout="vertical" onFinish={onFinish} requiredMark={false} initialValues={{ username: '', password: '' }}>
            <Form.Item
              name="username"
              label="账号"
              rules={[
                { required: true, message: '请输入账号' },
                { pattern: /^[A-Za-z0-9._-]{3,32}$/, message: '账号需为 3–32 位字母、数字、点、下划线或连字符' },
              ]}
            >
              <Input size="large" prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" />
            </Form.Item>

            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password size="large" prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>

            <Button type="primary" size="large" htmlType="submit" loading={submitting} block style={{ marginTop: 4 }} data-testid="login-submit">
              登录
            </Button>
          </Form>
        </div>
      </section>
    </div>
  );
}
