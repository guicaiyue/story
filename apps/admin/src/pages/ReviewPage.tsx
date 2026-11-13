import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Input, Modal, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, ApiError, type AdminStoryListItem } from '../api/client';
import { PageHead, PaperCard } from '../components/ui';
import { tokens } from '../theme';

/**
 * 审核队列 —— 只列 status=review 的故事，通过/驳回直接落库。
 *
 * 后端约束（02-architecture §5）：通过/驳回仅 admin 可操作，
 * editor 调用会得到 403，此处把错误原样提示，不静默失败。
 */
export function ReviewPage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<AdminStoryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<AdminStoryListItem | null>(null);
  const [reason, setReason] = useState('');
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.stories({ page, pageSize, status: 'review' });
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

  const approve = async (row: AdminStoryListItem) => {
    setBusyId(row.id);
    try {
      const res = await api.reviewStory(row.id, 'approve');
      message.success(`《${row.title}》已通过，状态 ${res.status}`);
      await load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    try {
      await api.reviewStory(rejecting.id, 'reject', reason || undefined);
      message.success(`《${rejecting.title}》已驳回`);
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const columns: ColumnsType<AdminStoryListItem> = [
    { title: 'ID', dataIndex: 'id', width: 78 },
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
      title: '年龄档',
      dataIndex: 'ageBand',
      width: 96,
      render: (b: string) => <Tag color={b === '9+' ? 'orange' : 'default'}>{b} 岁</Tag>,
    },
    {
      title: '简介',
      dataIndex: 'excerpt',
      ellipsis: true,
      render: (v: string | null) => <span style={{ color: 'var(--ink-2)' }}>{v ?? '—'}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_v, row) => (
        <Space size={4}>
          <Button size="small" type="primary" loading={busyId === row.id} onClick={() => void approve(row)} data-testid={`approve-${row.id}`}>
            通过
          </Button>
          <Button size="small" danger onClick={() => setRejecting(row)} data-testid={`reject-${row.id}`}>
            驳回
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHead title="审核队列" sub={`待审核 ${total} 篇 · 通过后立即上架，驳回回到草稿`} />

      <PaperCard>
        <Table<AdminStoryListItem>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={items}
          loading={loading}
          locale={{ emptyText: error ? `加载失败：${error}` : '审核队列已清空 🎉' }}
          pagination={{ current: page, pageSize, total, onChange: setPage, showTotal: (t) => `共 ${t} 篇` }}
          data-testid="review-table"
        />
      </PaperCard>

      <Modal
        open={Boolean(rejecting)}
        title={`驳回《${rejecting?.title ?? ''}》`}
        okText="确认驳回"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: busyId === rejecting?.id }}
        onOk={() => void confirmReject()}
        onCancel={() => {
          setRejecting(null);
          setReason('');
        }}
      >
        <p style={{ color: 'var(--ink-2)' }}>驳回后故事会回到「草稿」，编辑可修改后重新提审。</p>
        <Input.TextArea
          rows={3}
          placeholder="驳回原因（可选，会记入操作日志）"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="reject-reason"
        />
      </Modal>
    </>
  );
}
