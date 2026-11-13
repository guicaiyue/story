import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Input, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api, type AdminStoryListItem, type StoryStatus } from '../api/client';
import { PageHead, PaperCard } from '../components/ui';
import { ageBands, statusMeta, tokens } from '../theme';

const STATUS_OPTIONS: Array<{ value: StoryStatus; label: string }> = [
  { value: 'published', label: '已上架' },
  { value: 'review', label: '待审核' },
  { value: 'draft', label: '草稿' },
  { value: 'archived', label: '已归档' },
];

/**
 * 故事列表 —— 服务端分页 + 筛选 + 批量操作。
 *
 * 数据来自 GET /api/admin/stories（page/pageSize/status/ageBand/categoryId/q），
 * 筛选条件写入 URL search params，便于分享与刷新恢复。
 */
export function StoriesPage() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<AdminStoryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '20');
  const status = (params.get('status') ?? '') as StoryStatus | '';
  const band = params.get('band') ?? '';
  const categoryId = params.get('categoryId') ?? '';
  const q = params.get('q') ?? '';

  const patchParams = useCallback(
    (next: Record<string, string | number | undefined>) => {
      const merged = new URLSearchParams(params);
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '') merged.delete(key);
        else merged.set(key, String(value));
      }
      setParams(merged, { replace: true });
    },
    [params, setParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.stories({
        page,
        pageSize,
        ...(status ? { status } : {}),
        ...(band ? { ageBand: band } : {}),
        ...(categoryId ? { categoryId: Number(categoryId) } : {}),
        ...(q ? { q } : {}),
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, band, categoryId, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.categories().then((c) => setCategories(c.map((x) => ({ id: x.id, name: x.name })))).catch(() => setCategories([]));
  }, []);

  /** 批量提交审核：逐条调用真实的 /submit 接口，并汇总结果。 */
  const bulkSubmit = async () => {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of selected) {
      try {
        await api.submitStory(id);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    setSelected([]);
    if (ok) message.success(`已提交 ${ok} 篇进入审核队列`);
    if (failed) message.error(`${failed} 篇提交失败`);
    void load();
  };

  /** 批量上下架：PATCH 每条故事的状态。 */
  const bulkSetStatus = async (next: StoryStatus) => {
    setBusy(true);
    let ok = 0;
    for (const id of selected) {
      try {
        await api.updateStory(id, { status: next });
        ok += 1;
      } catch {
        /* 汇总统计由下方消息体现 */
      }
    }
    setBusy(false);
    setSelected([]);
    message.success(`已更新 ${ok} 篇`);
    void load();
  };

  const columns: ColumnsType<AdminStoryListItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 76,
      sorter: false,
    },
    {
      title: '标题',
      dataIndex: 'title',
      render: (title: string, row) => (
        <Link to={`/stories/${row.id}`} style={{ color: tokens.teal, fontWeight: 500 }}>
          {title}
        </Link>
      ),
    },
    {
      title: '分类',
      dataIndex: 'categoryId',
      width: 130,
      render: (id: number | null) => categories.find((c) => c.id === id)?.name ?? <span style={{ color: 'var(--ink-3)' }}>未分类</span>,
    },
    {
      title: '年龄档',
      dataIndex: 'ageBand',
      width: 100,
      render: (b: string) => <Tag color={b === '9+' ? 'orange' : 'default'}>{b} 岁</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: StoryStatus) => {
        const meta = statusMeta[s];
        return meta ? <Tag style={{ color: meta.color, background: meta.bg, border: 'none' }}>{meta.label}</Tag> : <Tag>{s}</Tag>;
      },
    },
    {
      title: '字数',
      dataIndex: 'length',
      width: 90,
      align: 'right',
      render: (n: number | null) => (n ? n.toLocaleString('zh-CN') : '—'),
    },
    {
      title: '推荐',
      dataIndex: 'featured',
      width: 70,
      align: 'center',
      render: (f: boolean) => (f ? '★' : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      render: (_v, row) => (
        <Space size={4}>
          <Link to={`/stories/${row.id}`}>
            <Button size="small" type="link">
              编辑
            </Button>
          </Link>
          {row.status === 'draft' ? (
            <Button
              size="small"
              type="link"
              onClick={async () => {
                await api.submitStory(row.id);
                message.success('已提交审核');
                void load();
              }}
            >
              提审
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title="故事列表"
        sub={`共 ${total.toLocaleString('zh-CN')} 篇 · 服务端分页`}
        actions={
          <Tooltip title="重新加载">
            <Button icon={<ReloadOutlined />} onClick={() => void load()} />
          </Tooltip>
        }
      />

      <PaperCard>
        <div className="toolbar">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索标题"
            defaultValue={q}
            style={{ width: 240 }}
            onPressEnter={(e) => patchParams({ q: (e.target as HTMLInputElement).value, page: 1 })}
            data-testid="search-input"
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 130 }}
            value={status || undefined}
            options={STATUS_OPTIONS}
            onChange={(v) => patchParams({ status: v ?? '', page: 1 })}
            data-testid="status-filter"
          />
          <Select
            placeholder="年龄档"
            allowClear
            style={{ width: 120 }}
            value={band || undefined}
            options={ageBands.map((b) => ({ value: b, label: `${b} 岁` }))}
            onChange={(v) => patchParams({ band: v ?? '', page: 1 })}
            data-testid="band-filter"
          />
          <Select
            placeholder="分类"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 160 }}
            value={categoryId || undefined}
            options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            onChange={(v) => patchParams({ categoryId: v ?? '', page: 1 })}
          />
          <span className="grow" />
          {selected.length > 0 ? (
            <Space>
              <span style={{ color: 'var(--ink-3)' }}>已选 {selected.length} 篇</span>
              <Button size="small" loading={busy} onClick={() => void bulkSubmit()}>
                批量提审
              </Button>
              <Button size="small" loading={busy} onClick={() => void bulkSetStatus('published')}>
                批量上架
              </Button>
              <Button size="small" danger loading={busy} onClick={() => void bulkSetStatus('archived')}>
                批量归档
              </Button>
            </Space>
          ) : null}
        </div>

        <Table<AdminStoryListItem>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={items}
          loading={loading}
          locale={{ emptyText: error ? `加载失败：${error}` : '没有符合条件的故事' }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as number[]),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t.toLocaleString('zh-CN')} 篇`,
            onChange: (p, ps) => patchParams({ page: p, pageSize: ps }),
          }}
          data-testid="stories-table"
        />
      </PaperCard>
    </>
  );
}
