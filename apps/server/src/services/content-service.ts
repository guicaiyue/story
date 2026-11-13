import type { Db } from '../db.js';
import { AppError, type AgeBand, type PublicStoryQuery } from '../contract.js';

/** Fields safe to expose to the child-facing client. Body text is fetched separately. */
const listSelect = {
  id: true,
  title: true,
  excerpt: true,
  categoryId: true,
  categoryName: true,
  ageBand: true,
  tags: true,
  durationSec: true,
  coverUrl: true,
  audioUrl: true,
  featured: true,
  length: true,
  createdAt: true,
} as const;

export type StoryListItem = {
  id: number;
  title: string;
  excerpt: string | null;
  categoryId: number | null;
  categoryName: string | null;
  ageBand: string;
  tags: string[];
  durationSec: number;
  coverUrl: string | null;
  audioUrl: string | null;
  featured: boolean;
  length: number | null;
  createdAt: Date | null;
};

export type Paged<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/**
 * Public story listing.
 *
 * `status` is hard-coded to `published` here rather than taken as a parameter,
 * so no caller can widen the filter and surface drafts/archived content.
 * `ageBand` is applied only when supplied; the app is expected to pass the
 * child's band (00-research P1 / principle 2).
 */
export async function listPublicStories(db: Db, query: PublicStoryQuery): Promise<Paged<StoryListItem>> {
  const where = {
    status: 'published',
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.ageBand === undefined ? {} : { ageBand: query.ageBand }),
    ...(query.featured === undefined ? {} : { featured: query.featured }),
    ...(query.q === undefined ? {} : { title: { contains: query.q, mode: 'insensitive' as const } }),
  };

  const [total, items] = await Promise.all([
    db.story.count({ where }),
    db.story.findMany({
      where,
      select: listSelect,
      orderBy: { id: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/**
 * Story detail including body text, which lives in the separate legacy
 * `story_content` table (03-decisions §1). `category.name` wins over the
 * denormalised `story_main.category_name` (§5).
 */
export async function getPublicStory(db: Db, id: number): Promise<StoryListItem & { content: string }> {
  const story = await db.story.findFirst({
    where: { id, status: 'published' },
    select: { ...listSelect, content: { select: { content: true } }, category: { select: { name: true } } },
  });

  if (!story) throw AppError.notFound('故事不存在或未发布');

  const { content, category, ...rest } = story;
  return {
    ...rest,
    categoryName: category?.name ?? rest.categoryName ?? null,
    content: content?.content ?? '',
  };
}

/**
 * 只取正文，供 TTS 合成用。
 *
 * **只允许已发布内容**：音频是正文的完整朗读版，如果允许匿名取草稿音频，
 * 就等于绕过了 `status='published'` 这道内容安全闸（既泄露未审内容，
 * 也让 00-research P1 的「怪谈/恐怖内容不下发给孩子」失效）。
 *
 * 返回 `'missing'` 与 `'unpublished'` 区分「不存在」和「存在但未发布」，
 * 但路由对两者都回 404 —— 不向未授权调用方暴露草稿的存在。
 */
export type StoryContentResult =
  | { kind: 'ok'; content: string }
  | { kind: 'missing' }
  | { kind: 'unpublished' };

export async function getStoryContentForAudio(db: Db, id: number): Promise<StoryContentResult> {
  const story = await db.story.findUnique({
    where: { id },
    select: { status: true, content: { select: { content: true } } },
  });
  if (!story) return { kind: 'missing' };
  if (story.status !== 'published') return { kind: 'unpublished' };
  return { kind: 'ok', content: story.content?.content ?? '' };
}

/**
 * 「今晚听什么」的兜底：最新的**已发布且年龄档匹配**的故事。
 *
 * ⚠️ 这里的 `ageBand` 过滤是内容安全要求，不是可选优化。
 * 01-product-brief §4.1 / 00-research P1：恐怖/怪谈/推理默认不进儿童端。
 * 早期版本只按 `status='published'` 取最新一条，会把 9+ 的聊斋/怪谈当成
 * 3-6 孩子的首页第一张卡（实测命中过 story 2199《卷七·细柳》）。
 * 所以兜底和 featured 用**完全相同**的过滤条件，空结果时再往后退一级
 * （放宽 category/featured），但**绝不放宽 ageBand**。
 */
export async function newestPublishedForBand(db: Db, ageBand: AgeBand) {
  return db.story.findFirst({
    where: { status: 'published', ageBand },
    orderBy: { id: 'desc' },
    select: listSelect,
  });
}

export type CategoryItem = { id: number; name: string; sortId: number | null; storyCount: number };

/** Category list with published story counts, ordered by the legacy `sort_id DESC`. */
export async function listCategories(db: Db): Promise<CategoryItem[]> {
  const categories = await db.category.findMany({
    select: {
      id: true,
      name: true,
      sortId: true,
      _count: { select: { stories: { where: { status: 'published' } } } },
    },
    orderBy: [{ sortId: 'desc' }, { id: 'asc' }],
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    sortId: c.sortId,
    storyCount: c._count.stories,
  }));
}
