import { useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { LockOutlined, MobileOutlined } from '@ant-design/icons';
import { useAuth } from '../auth';
import { tokens } from '../theme';

type FormValues = { phone: string; code: string };

/**
 * 登录页 —— 对齐设计稿的左右分栏：左侧品牌叙事，右侧登录卡片。
 *
 * 走真实的 POST /api/admin/auth/login（02-architecture §4.2）。
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
      await login(values.phone, values.code);
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
          <p>使用内容团队分配的手机号登录</p>

          {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} data-testid="login-error" /> : null}

          <Form<FormValues> layout="vertical" onFinish={onFinish} requiredMark={false} initialValues={{ phone: '', code: '' }}>
            <Form.Item
              name="phone"
              label="手机号"
              rules={[
                { required: true, message: '请输入手机号' },
                { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
              ]}
            >
              <Input size="large" prefix={<MobileOutlined />} placeholder="13900000001" autoComplete="username" />
            </Form.Item>

            <Form.Item name="code" label="验证码" rules={[{ required: true, message: '请输入验证码' }]}>
              <Input size="large" prefix={<LockOutlined />} placeholder="123456" autoComplete="one-time-code" />
            </Form.Item>

            <Button type="primary" size="large" htmlType="submit" loading={submitting} block style={{ marginTop: 4 }} data-testid="login-submit">
              登录
            </Button>
          </Form>

          <div className="login-hint" style={{ borderColor: tokens.brandLine, background: tokens.brandSoft }}>
            M1 阶段使用固定验证码（不发真实短信）。dev 环境管理员：<b>13900000001</b>，编辑：<b>13900000002</b>，
            验证码见服务端 <code>FIXED_SMS_CODE</code>。
          </div>
        </div>
      </section>
    </div>
  );
}
