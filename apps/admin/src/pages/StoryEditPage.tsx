import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { App, Button, Checkbox, Form, Input, InputNumber, Select, Space, Spin, Tag } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { api, ApiError, type AdminStoryDetail } from '../api/client';
import { PageHead, PaperCard } from '../components/ui';
import { ageBands, statusMeta } from '../theme';

type FormValues = {
  title: string;
  excerpt: string;
  categoryId: number | null;
  ageBand: string;
  tags: string[];
  coverUrl: string;
  audioUrl: string;
  durationSec: number;
  featured: boolean;
  content: string;
};

/**
 * 故事编辑 —— 正文写入 public.story_content，其余字段写入 public.story_main。
 *
 * 注意（03-decisions §5）：`length` 是正文字数，不是播放时长；
 * 时长走独立的 durationSec 字段，此页不做自动推算。
 */
export function StoryEditPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [story, setStory] = useState<AdminStoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);

  const storyId = Number(id);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .story(storyId)
      .then((s) => {
        if (!alive) return;
        setStory(s);
        form.setFieldsValue({
          title: s.title,
          excerpt: s.excerpt ?? '',
          categoryId: s.categoryId,
          ageBand: s.ageBand,
          tags: s.tags ?? [],
          coverUrl: s.coverUrl ?? '',
          audioUrl: s.audioUrl ?? '',
          durationSec: s.durationSec,
          featured: s.featured,
          content: s.content,
        });
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [storyId, form]);

  useEffect(() => {
    api.categories().then((c) => setCategories(c.map((x) => ({ id: x.id, name: x.name })))).catch(() => setCategories([]));
  }, []);

  const onSave = async (values: FormValues) => {
    setSaving(true);
    try {
      await api.updateStory(storyId, {
        title: values.title,
        excerpt: values.excerpt || null,
        categoryId: values.categoryId ?? null,
        ageBand: values.ageBand,
        tags: values.tags ?? [],
        coverUrl: values.coverUrl || null,
        audioUrl: values.audioUrl || null,
        durationSec: values.durationSec ?? 0,
        featured: Boolean(values.featured),
      });
      message.success('已保存');
      const fresh = await api.story(storyId);
      setStory(fresh);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /**
   * 正文单独保存（M2.1 项目 1）。
   *
   * 刻意与「基本信息保存」分开：正文写入的是 public.story_content，影响的是
   * 老站正在读取的内容，属于更高风险的改动 —— 单独按钮 + 单独确认，避免
   * 改个标题就顺带把整篇正文覆盖了。
   */
  const onSaveContent = async () => {
    const content = (form.getFieldValue('content') as string | undefined) ?? '';
    if (content.trim().length === 0) {
      // 用与表单校验不同的文案，便于测试与用户区分「校验提示」和「提交被拒」。
      message.error('正文为空，未提交保存');
      return;
    }
    setSavingContent(true);
    try {
      await api.updateStoryContent(storyId, { content });
      message.success('正文已保存');
      const fresh = await api.story(storyId);
      setStory(fresh);
      form.setFieldsValue({ content: fresh.content });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '正文保存失败');
    } finally {
      setSavingContent(false);
    }
  };

  const submitForReview = async () => {
    try {
      await api.submitStory(storyId);
      message.success('已提交审核');
      setStory(await api.story(storyId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : '提交失败');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (error || !story) {
    return (
      <>
        <PageHead title="故事编辑" />
        <PaperCard>
          <p data-testid="edit-error">{error ?? '故事不存在'}</p>
          <Link to="/stories">
            <Button icon={<ArrowLeftOutlined />} data-testid="edit-back">返回列表</Button>
          </Link>
        </PaperCard>
      </>
    );
  }

  const meta = statusMeta[story.status];

  return (
    <>
      <PageHead
        title={`编辑 · ${story.title}`}
        sub={
          <Space size={8}>
            <span>ID {story.id}</span>
            {meta ? <Tag style={{ color: meta.color, background: meta.bg, border: 'none' }}>{meta.label}</Tag> : null}
            <span>正文字数 {story.length?.toLocaleString('zh-CN') ?? '—'}</span>
          </Space>
        }
        actions={
          <Space>
            <Link to="/stories">
              <Button icon={<ArrowLeftOutlined />}>返回</Button>
            </Link>
            {story.status === 'draft' ? <Button onClick={() => void submitForReview()} data-testid="edit-submit">提交审核</Button> : null}
            <Button type="primary" loading={saving} onClick={() => form.submit()} data-testid="edit-save">
              保存
            </Button>
          </Space>
        }
      />

      <Form<FormValues> form={form} layout="vertical" onFinish={onSave}>
        <div className="grid-2">
          <PaperCard title="基本信息">
            <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
              <Input data-testid="edit-title" />
            </Form.Item>

            <Form.Item name="excerpt" label="简介">
              <Input.TextArea rows={3} />
            </Form.Item>

            <Space size={12} style={{ display: 'flex' }} wrap>
              <Form.Item name="categoryId" label="分类" style={{ minWidth: 180, marginBottom: 12 }}>
                <Select
                  allowClear
                  placeholder="未分类"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Form.Item>
              <Form.Item name="ageBand" label="年龄档" style={{ minWidth: 140, marginBottom: 12 }}>
                <Select options={ageBands.map((b) => ({ value: b, label: `${b} 岁` }))} data-testid="edit-band" />
              </Form.Item>
              <Form.Item name="durationSec" label="时长（秒）" style={{ minWidth: 140, marginBottom: 12 }}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Space>

            <Form.Item name="tags" label="标签">
              <Select mode="tags" placeholder="回车添加标签" />
            </Form.Item>

            <Form.Item name="featured" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>加入「今晚听什么」推荐池</Checkbox>
            </Form.Item>
          </PaperCard>

          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <PaperCard title="资源">
              <Form.Item name="coverUrl" label="封面地址">
                <Input placeholder="留空表示暂无封面" />
              </Form.Item>
              <Form.Item name="audioUrl" label="音频地址" style={{ marginBottom: 0 }}>
                <Input placeholder="留空表示走 TTS 实时合成" />
              </Form.Item>
            </PaperCard>

            <PaperCard title="内容安全">
              <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.8 }}>
                9+ 内容（恐怖/怪谈/推理）默认不进入儿童端推荐池；只有 <b>published</b> 且年龄档匹配的故事会展示。
                本页保存不改变上架状态。
              </p>
            </PaperCard>
          </div>
        </div>

        <PaperCard
          title="正文"
          hint="来自 public.story_content"
          style={{ marginTop: 14 }}
          extra={
            <Button
              type="primary"
              size="small"
              loading={savingContent}
              onClick={() => void onSaveContent()}
              data-testid="edit-content-save"
            >
              保存正文
            </Button>
          }
        >
          <Form.Item
            name="content"
            style={{ marginBottom: 0 }}
            rules={[
              {
                validator: (_r, v: string) =>
                  typeof v === 'string' && v.trim().length > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('正文不能为空')),
              },
            ]}
          >
            <Input.TextArea rows={14} data-testid="edit-content" />
          </Form.Item>
          <p style={{ margin: '10px 0 0', color: 'var(--ink-3)', fontSize: 12 }}>
            正文写入 <code>public.story_content</code>，保存后老站与 App 立即读到新内容。
            字数（length）由服务端按去空白字符数重算，不在此处手填。
          </p>
        </PaperCard>
      </Form>
    </>
  );
}
