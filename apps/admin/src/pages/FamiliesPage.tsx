import { useCallback, useEffect, useState } from 'react';
import { Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, type AccountItem } from '../api/client';
import { PageHead, PaperCard, AsyncBlock } from '../components/ui';
import { tokens } from '../theme';

/**
 * 家庭与儿童档案 —— 只读视图。
 *
 * 数据来自 GET /api/admin/accounts（含每个账号的儿童数）。
 * 00-research §6：儿童个人信息默认仅家长可见，后台**只读**，
 * 因此本页不提供编辑与导出，避免扩大数据暴露面。
 */
export function FamiliesPage() {
  const [items, setItems] = useState<AccountItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.accounts({ page, pageSize });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}****${p.slice(7)}` : '游客账号');

  const columns: ColumnsType<AccountItem> = [
    { title: 'ID', dataIndex: 'id', width: 220, ellipsis: true, render: (v: string) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{v}</span> },
    { title: '昵称', dataIndex: 'nickname' },
    { title: '手机号', dataIndex: 'phone', width: 140, render: (p: string | null) => maskPhone(p) },
    {
      title: '角色',
      dataIndex: 'role',
      width: 110,
      render: (r: string) =>
        r === 'admin' ? <Tag color="orange">管理员</Tag> : r === 'editor' ? <Tag color="blue">编辑</Tag> : <Tag style={{ color: tokens.ink2, background: tokens.surface2, border: 'none' }}>家长</Tag>,
    },
    {
      title: '儿童档案',
      key: 'children',
      width: 110,
      align: 'right',
      render: (_v, row) => `${row._count.children} 个`,
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false }),
    },
  ];

  return (
    <>
      <PageHead title="家庭与儿童档案" sub={`共 ${total} 个账号 · 儿童个人信息只读`} />

      <AsyncBlock loading={loading} error={error} onRetry={load}>
        <PaperCard>
          <Table<AccountItem>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={items}
            pagination={{ current: page, pageSize, total, onChange: setPage, showTotal: (t) => `共 ${t} 个` }}
            data-testid="families-table"
          />
          <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--ink-3)', fontSize: 12 }}>
            合规说明：儿童信息按《儿童个人信息网络保护规定》最小必要原则处理，后台不提供导出与编辑入口。
          </p>
        </PaperCard>
      </AsyncBlock>
    </>
  );
}
