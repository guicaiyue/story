import { useCallback, useEffect, useState } from 'react';
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { api, type AccountItem, type AuditItem } from '../api/client';
import { useAuth } from '../auth';
import { PageHead, PaperCard, AsyncBlock } from '../components/ui';
import { tokens } from '../theme';

/** 操作日志的动作名 → 中文说明 */
const ACTION_LABEL: Record<string, string> = {
  login: '登录后台',
  'story.submit': '提交审核',
  'story.approve': '审核通过',
  'story.reject': '审核驳回',
  'story.content.update': '保存正文',
  'banner.create': '新增推荐位',
  'banner.update': '更新推荐位',
  'banner.delete': '删除推荐位',
  'category.update': '更新分类',
  'account.create': '新增管理员',
  'account.update': '修改管理员',
  'account.disable': '停用管理员',
};

const ROLE_LABEL: Record<string, string> = { admin: '超级管理员', editor: '编辑', parent: '家长' };

/**
 * 管理员与日志 —— 管理员管理（M2.1 项目 4）+ 操作审计。
 *
 * 管理员列表/新增/停用/改角色全部走 /api/admin/accounts（仅 admin）。
 * 服务端对「改自己」与「最后一个管理员」有保护，前端把这些失败原样提示出来。
 */
export function SystemPage() {
  const { message } = App.useApp();
  const { account } = useAuth();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  // 管理员列表
  const [admins, setAdmins] = useState<AccountItem[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [adminsError, setAdminsError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ phone: string; nickname?: string; role: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.audit({ page, pageSize });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadAdmins = useCallback(async () => {
    setAdminsLoading(true);
    setAdminsError(null);
    try {
      // 只看后台角色（admin + editor），家长账号不属于「管理员管理」。
      const [a, e] = await Promise.all([
        api.accounts({ page: 1, pageSize: 100, role: 'admin' }),
        api.accounts({ page: 1, pageSize: 100, role: 'editor' }),
      ]);
      setAdmins([...a.items, ...e.items].sort((x, y) => x.createdAt.localeCompare(y.createdAt)));
    } catch (err) {
      setAdminsError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setAdminsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

  const createAdmin = async () => {
    let values: { phone: string; nickname?: string; role: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    try {
      await api.createAccount({ phone: values.phone, nickname: values.nickname ?? '', role: values.role });
      message.success('管理员已创建，对方用该手机号 + 验证码即可登录后台');
      setCreateOpen(false);
      form.resetFields();
      await loadAdmins();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  /** 停用 / 启用。 */
  const toggleStatus = async (row: AccountItem) => {
    setBusyId(row.id);
    try {
      await api.updateAccount(row.id, { status: row.status === 'active' ? 'disabled' : 'active' });
      message.success(row.status === 'active' ? `已停用「${row.nickname || row.phone}」` : '已重新启用');
      await loadAdmins();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  /** 改角色。 */
  const changeRole = async (row: AccountItem, role: string) => {
    setBusyId(row.id);
    try {
      await api.updateAccount(row.id, { role });
      message.success('角色已更新');
      await loadAdmins();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '改角色失败');
    } finally {
      setBusyId(null);
    }
  };

  const adminColumns: ColumnsType<AccountItem> = [
    { title: '昵称', dataIndex: 'nickname', render: (n: string) => n || <span style={{ color: 'var(--ink-3)' }}>未命名</span> },
    { title: '手机号', dataIndex: 'phone', width: 140, render: (p: string | null) => p ?? '—' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 150,
      render: (role: string, row) => {
        const isSelf = row.id === account?.accountId;
        return (
          <Select
            size="small"
            value={role}
            style={{ width: 120 }}
            disabled={busyId === row.id}
            onChange={(v) => void changeRole(row, v)}
            options={[
              { value: 'admin', label: '超级管理员' },
              { value: 'editor', label: '编辑' },
            ]}
            data-testid={`admin-role-${row.id}`}
            // 自己的角色改不动（服务端也会拒），这里直接禁用，避免无谓报错。
            title={isSelf ? '不能修改自己的角色' : undefined}
          />
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) =>
        s === 'active' ? (
          <Tag color="green">可用</Tag>
        ) : (
          <Tag style={{ color: tokens.danger, background: tokens.dangerSoft, border: 'none' }}>已停用</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_v, row) => {
        const isSelf = row.id === account?.accountId;
        if (isSelf) return <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>当前账号</span>;
        return (
          <Popconfirm
            title={row.status === 'active' ? '停用后该账号将无法登录后台，确定？' : '重新启用该账号？'}
            okText="确定"
            cancelText="取消"
            onConfirm={() => void toggleStatus(row)}
          >
            <Button size="small" type="link" danger={row.status === 'active'} loading={busyId === row.id} data-testid={`admin-toggle-${row.id}`}>
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  const columns: ColumnsType<AuditItem> = [
    {
      title: '时间',
      dataIndex: 'at',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false }),
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 140,
      render: (a: string) => <Tag style={{ color: tokens.teal, background: tokens.tealSoft, border: 'none' }}>{ACTION_LABEL[a] ?? a}</Tag>,
    },
    {
      title: '对象',
      dataIndex: 'target',
      width: 120,
      render: (t: string, row) => (row.action.startsWith('story.') ? `故事 #${t}` : t),
    },
    {
      title: '操作人',
      dataIndex: 'actorId',
      width: 230,
      ellipsis: true,
      render: (v: string) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{v}</span>,
    },
    {
      title: '详情',
      dataIndex: 'detail',
      render: (d: unknown) => (d ? <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{JSON.stringify(d)}</span> : '—'),
    },
  ];

  return (
    <>
      <PageHead title="管理员与日志" sub="管理员来自 app.account；操作审计来自 app.audit_log" />

      <div className="grid-3" style={{ marginBottom: 14 }}>
        <PaperCard title="当前账号">
          <div className="stat-value" style={{ fontSize: 20 }}>
            {account?.nickname ?? '—'}
          </div>
          <div className="stat-foot" style={{ marginTop: 4 }}>
            角色：{ROLE_LABEL[account?.role ?? ''] ?? account?.role} · {account?.phone ?? ''}
          </div>
          <div className="stat-foot">账号 ID：{account?.accountId}</div>
        </PaperCard>

        <PaperCard title="权限范围">
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.9 }}>
            <b>admin</b>：内容 CRUD、审核通过/驳回、分类与推荐位修改、管理员管理。
            <br />
            <b>editor</b>：内容编辑与提审；审核与推荐位管理会返回 403。
          </p>
        </PaperCard>

        <PaperCard title="停用说明">
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.9 }}>
            停用会立刻生效：既挡登录，也让该账号**已签发的 token** 失效（服务端每次请求都回库核对状态）。
            系统至少保留一个可用管理员，且不能停用自己。
          </p>
        </PaperCard>
      </div>

      <PaperCard
        title="管理员"
        hint={`共 ${admins.length} 个`}
        style={{ marginBottom: 14 }}
        extra={
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} data-testid="admin-create-open">
            新增管理员
          </Button>
        }
      >
        <AsyncBlock loading={adminsLoading} error={adminsError} onRetry={loadAdmins}>
          <Table<AccountItem>
            rowKey="id"
            size="small"
            columns={adminColumns}
            dataSource={admins}
            pagination={false}
            data-testid="admins-table"
          />
        </AsyncBlock>
      </PaperCard>

      <AsyncBlock loading={loading} error={error} onRetry={load}>
        <PaperCard title="操作日志" hint={`共 ${total} 条`}>
          <Table<AuditItem>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={items}
            pagination={{ current: page, pageSize, total, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
            data-testid="audit-table"
          />
        </PaperCard>
      </AsyncBlock>

      <Modal
        title="新增管理员"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void createAdmin()}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ role: 'editor' }} preserve={false}>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
            ]}
          >
            <Input placeholder="对方用该手机号登录后台" data-testid="admin-phone" />
          </Form.Item>
          <Form.Item name="nickname" label="昵称">
            <Input placeholder="选填" data-testid="admin-nickname" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
            <Select
              options={[
                { value: 'editor', label: '编辑（内容编辑与提审）' },
                { value: 'admin', label: '超级管理员（全部权限）' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Space />
    </>
  );
}
