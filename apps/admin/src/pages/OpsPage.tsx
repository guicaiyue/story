import { useCallback, useEffect, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { api, type BannerItem, type CategoryItem } from '../api/client';
import { PageHead, PaperCard, AsyncBlock } from '../components/ui';
import { tokens } from '../theme';

/**
 * 分类与推荐位 —— 运营配置页面。
 *
 * 数据来自 GET /api/admin/categories 与 /api/admin/banners。
 * 推荐位支持新增 / 停用（隐藏）/ 排序 / 删除（M2.1 项目 3，均仅 admin）。
 */
export function OpsPage() {
  const { message } = App.useApp();
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<number, { name?: string; sortId?: number }>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  // 推荐位：新增弹窗 + 行内排序草稿 + 删除中状态。
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sortDraft, setSortDraft] = useState<Record<number, number>>({});
  const [form] = Form.useForm<{ title: string; imageUrl?: string; targetType: string; targetId?: string; sort: number }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, b] = await Promise.all([api.categories(), api.banners()]);
      setCategories(c);
      setBanners(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveCategory = async (row: CategoryItem) => {
    const patch = editing[row.id];
    if (!patch || (patch.name === undefined && patch.sortId === undefined)) return;
    setSavingId(row.id);
    try {
      await api.updateCategory(row.id, patch);
      message.success(`「${patch.name ?? row.name}」已更新`);
      setEditing((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败（可能是权限不足）');
    } finally {
      setSavingId(null);
    }
  };

  const toggleBanner = async (row: BannerItem) => {
    setSavingId(row.id);
    try {
      await api.updateBanner(row.id, { status: row.status === 'active' ? 'hidden' : 'active' });
      message.success('推荐位状态已更新');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSavingId(null);
    }
  };

  /** 新增推荐位（M2.1 项目 3）。 */
  const createBanner = async () => {
    let values: { title: string; imageUrl?: string; targetType: string; targetId?: string; sort: number };
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败，AntD 已就地提示
    }
    setCreating(true);
    try {
      await api.createBanner({
        title: values.title,
        imageUrl: values.imageUrl ?? '',
        targetType: values.targetType,
        targetId: values.targetId ?? null,
        sort: values.sort ?? 0,
      });
      message.success('推荐位已创建');
      setCreateOpen(false);
      form.resetFields();
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建失败（仅管理员可操作）');
    } finally {
      setCreating(false);
    }
  };

  /** 行内保存排序（M2.1 项目 3）。 */
  const saveBannerSort = async (row: BannerItem) => {
    const next = sortDraft[row.id];
    if (next === undefined || next === row.sort) return;
    setSavingId(row.id);
    try {
      await api.updateBanner(row.id, { sort: next });
      message.success('排序已更新');
      setSortDraft((p) => {
        const n = { ...p };
        delete n[row.id];
        return n;
      });
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '排序保存失败');
    } finally {
      setSavingId(null);
    }
  };

  /** 删除推荐位（M2.1 项目 3）。 */
  const deleteBanner = async (row: BannerItem) => {
    setSavingId(row.id);
    try {
      await api.deleteBanner(row.id);
      message.success(`「${row.title}」已删除`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setSavingId(null);
    }
  };

  const categoryColumns: ColumnsType<CategoryItem> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '名称',
      dataIndex: 'name',
      render: (name: string, row) => (
        <Input
          size="small"
          defaultValue={name}
          style={{ maxWidth: 200 }}
          onChange={(e) => setEditing((p) => ({ ...p, [row.id]: { ...p[row.id], name: e.target.value } }))}
          data-testid={`cat-name-${row.id}`}
        />
      ),
    },
    {
      title: '排序',
      dataIndex: 'sortId',
      width: 130,
      render: (sortId: number | null, row) => (
        <InputNumber
          size="small"
          defaultValue={sortId ?? 0}
          style={{ width: 90 }}
          onChange={(v) => setEditing((p) => ({ ...p, [row.id]: { ...p[row.id], sortId: v ?? 0 } }))}
        />
      ),
    },
    {
      title: '故事数',
      dataIndex: 'storyCount',
      width: 100,
      align: 'right',
      render: (n: number) => n.toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      render: (_v, row) => (
        <Button
          size="small"
          type="link"
          disabled={!editing[row.id]}
          loading={savingId === row.id}
          onClick={() => void saveCategory(row)}
          data-testid={`cat-save-${row.id}`}
        >
          保存
        </Button>
      ),
    },
  ];

  const bannerColumns: ColumnsType<BannerItem> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '标题', dataIndex: 'title' },
    {
      title: '目标',
      key: 'target',
      width: 170,
      render: (_v, row) => (
        <span style={{ color: 'var(--ink-2)' }}>
          {row.targetType} · {row.targetId ?? '—'}
        </span>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 120,
      render: (sort: number, row) => (
        <InputNumber
          size="small"
          style={{ width: 80 }}
          value={sortDraft[row.id] ?? sort}
          onChange={(v) =>
            setSortDraft((p) => {
              const n = { ...p };
              if (v === null || v === undefined || v === sort) delete n[row.id];
              else n[row.id] = v;
              return n;
            })
          }
          data-testid={`banner-sort-${row.id}`}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) =>
        s === 'active' ? <Tag color="green">展示中</Tag> : <Tag style={{ color: tokens.ink2, background: tokens.surface3, border: 'none' }}>已隐藏</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      render: (_v, row) => (
        <Space size={4}>
          {sortDraft[row.id] !== undefined ? (
            <Button size="small" type="link" loading={savingId === row.id} onClick={() => void saveBannerSort(row)} data-testid={`banner-save-sort-${row.id}`}>
              保存排序
            </Button>
          ) : (
            <Button size="small" type="link" loading={savingId === row.id} onClick={() => void toggleBanner(row)} data-testid={`banner-toggle-${row.id}`}>
              {row.status === 'active' ? '隐藏' : '展示'}
            </Button>
          )}
          <Popconfirm title="删除这个推荐位？" okText="删除" cancelText="取消" onConfirm={() => void deleteBanner(row)}>
            <Button size="small" type="link" danger data-testid={`banner-delete-${row.id}`}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHead title="分类与推荐位" sub="分类排序影响老站与 App 的展示顺序；推荐位用于首页 banner" />

      <AsyncBlock loading={loading} error={error} onRetry={load}>
        <div className="grid-2">
          <PaperCard title="分类管理" hint={`共 ${categories.length} 个`}>
            <Table<CategoryItem> rowKey="id" size="small" columns={categoryColumns} dataSource={categories} pagination={false} data-testid="categories-table" />
          </PaperCard>

          <PaperCard
            title="首页推荐位"
            hint={`共 ${banners.length} 个`}
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} data-testid="banner-create-open">
                新增推荐位
              </Button>
            }
          >
            <Table<BannerItem> rowKey="id" size="small" columns={bannerColumns} dataSource={banners} pagination={false} data-testid="banners-table" />
            <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--ink-3)', fontSize: 12 }}>
              排序值越小越靠前；「隐藏」保留记录但不在 App 展示。新增与删除仅管理员可操作。
            </p>
          </PaperCard>
        </div>
      </AsyncBlock>

      <Modal
        title="新增推荐位"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void createBanner()}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ targetType: 'story', sort: 0 }} preserve={false}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：今晚听什么" data-testid="banner-title" />
          </Form.Item>
          <Form.Item name="targetType" label="跳转类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'story', label: '故事' },
                { value: 'category', label: '分类' },
                { value: 'url', label: '外链' },
              ]}
            />
          </Form.Item>
          <Form.Item name="targetId" label="目标 ID / 地址">
            <Input placeholder="故事或分类填 ID；外链填完整地址" data-testid="banner-target" />
          </Form.Item>
          <Form.Item name="imageUrl" label="图片地址">
            <Input placeholder="留空表示暂无配图" />
          </Form.Item>
          <Form.Item name="sort" label="排序" style={{ marginBottom: 0 }}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
