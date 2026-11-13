/**
 * 小故事铺 M2 后台 · API 客户端
 *
 * 所有页面数据都来自 apps/server 的真实接口（/api 与 /api/admin/*），
 * 前端**不内置任何假数据**。响应封套见 02-architecture §4：
 *   { ok: true, data } | { ok: false, error: { code, message } }
 */

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

const TOKEN_KEY = 'story_admin_token';
const ACCOUNT_KEY = 'story_admin_account';

export type AdminAccount = { accountId: string; role: string; nickname?: string; phone?: string };

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAccount(): AdminAccount | null {
  const raw = localStorage.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminAccount;
  } catch {
    return null;
  }
}

export function setSession(token: string, account: AdminAccount): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}

/** Typed API error carrying the server's error code for precise UI handling. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Query params; undefined/null/'' entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
};

function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Performs a request and unwraps the envelope.
 *
 * On 401 the session is cleared so the app can route back to login: M1 tokens
 * are plain JWTs with no refresh flow.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (res.status === 401) {
    clearSession();
    throw new ApiError('UNAUTHORIZED', payload && !payload.ok ? payload.error.message : '登录已过期，请重新登录', 401);
  }

  if (!payload) {
    throw new ApiError('INTERNAL', `响应解析失败（HTTP ${res.status}）`, res.status);
  }
  if (!payload.ok) {
    throw new ApiError(payload.error.code, payload.error.message, res.status);
  }
  return payload.data;
}

// ---------------------------------------------------------------------------
// 类型（对齐 apps/server 的 admin-routes.ts）
// ---------------------------------------------------------------------------

export type StoryStatus = 'draft' | 'review' | 'published' | 'archived';

export type AdminStoryListItem = {
  id: number;
  title: string;
  excerpt: string | null;
  categoryId: number | null;
  ageBand: string;
  tags: string[];
  status: StoryStatus;
  featured: boolean;
  durationSec: number;
  coverUrl: string | null;
  audioUrl: string | null;
  length: number | null;
  publishedAt: string | null;
  updatedAt: string;
};

export type AdminStoryDetail = AdminStoryListItem & {
  categoryName: string | null;
  createdAt: string | null;
  content: string;
};

export type Paged<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

export type Dashboard = {
  content: { total: number; published: number; draft: number; review: number; archived: number };
  health: { missingCover: number; missingAudio: number; missingAgeBand: number; unhealthyRatio: number };
  users: { families: number; children: number };
  plays24h: number;
};

export type CategoryItem = { id: number; name: string; sortId: number | null; storyCount: number };

export type BannerItem = {
  id: number;
  title: string;
  imageUrl: string;
  targetType: 'story' | 'category' | 'url';
  targetId: string | null;
  sort: number;
  status: string;
};

export type AccountItem = {
  id: string;
  phone: string | null;
  nickname: string;
  role: string;
  status: string;
  createdAt: string;
  _count: { children: number };
};

export type AuditItem = {
  id: string;
  actorId: string;
  action: string;
  target: string;
  detail: unknown;
  at: string;
};

export type AnalyticsOverview = { byHour: Array<{ hour: number; plays: number }> };

/** 播放 Top 排行项（M2.1 项目 2）。 */
export type AnalyticsTopItem = {
  storyId: number;
  title: string | null;
  plays: number;
  completes: number;
  completionRate: number;
};

/** 趋势中的一天（M2.1 项目 2）。 */
export type AnalyticsTrendPoint = {
  day: string;
  plays: number;
  completes: number;
  completionRate: number;
};

/** 分类分布项（M2.1 项目 2）。 */
export type AnalyticsCategoryItem = {
  categoryId: number | null;
  name: string;
  total: number;
  bands: Record<string, number>;
};

/** 正文写回结果（M2.1 项目 1）。 */
export type StoryContentResult = {
  id: number;
  length: number;
  excerpt: string | null;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// 接口封装
// ---------------------------------------------------------------------------

export const api = {
  // --- 认证（02-architecture §4.2）---
  adminLogin: (body: { phone: string; code: string; nickname?: string }) =>
    request<{ token: string; accountId: string; role: string }>('/api/admin/auth/login', { method: 'POST', body }),

  sendCode: (phone: string) => request<{ sent: boolean; channel: string }>('/api/auth/send-code', { method: 'POST', body: { phone } }),

  me: () => request<{ id: string; phone: string | null; nickname: string; role: string }>('/api/me'),

  // --- 看板与数据 ---
  dashboard: () => request<Dashboard>('/api/admin/dashboard'),
  analyticsOverview: () => request<AnalyticsOverview>('/api/admin/analytics/overview'),
  /** M2.1 项目 2：播放 Top 排行。 */
  analyticsTop: (limit = 20) => request<{ items: AnalyticsTopItem[] }>('/api/admin/analytics/top', { query: { limit } }),
  /** M2.1 项目 2：近 N 天播放/完播趋势。 */
  analyticsTrend: (days = 14) => request<{ days: number; items: AnalyticsTrendPoint[] }>('/api/admin/analytics/trend', { query: { days } }),
  /** M2.1 项目 2：分类分布。 */
  analyticsCategories: () => request<{ items: AnalyticsCategoryItem[] }>('/api/admin/analytics/categories'),

  // --- 故事 ---
  stories: (query: {
    page: number;
    pageSize: number;
    status?: StoryStatus;
    ageBand?: string;
    categoryId?: number;
    q?: string;
  }) => request<Paged<AdminStoryListItem>>('/api/admin/stories', { query }),

  story: (id: number) => request<AdminStoryDetail>(`/api/admin/stories/${id}`),

  updateStory: (id: number, body: Partial<{
    title: string; excerpt: string | null; categoryId: number | null; ageBand: string;
    tags: string[]; coverUrl: string | null; audioUrl: string | null;
    durationSec: number; featured: boolean; status: StoryStatus;
  }>) => request<{ id: number; title: string; status: StoryStatus }>(`/api/admin/stories/${id}`, { method: 'PATCH', body }),

  /** M2.1 项目 1：正文写回（PUT = 整篇替换语义）。 */
  updateStoryContent: (id: number, body: { content: string; excerpt?: string | null }) =>
    request<StoryContentResult>(`/api/admin/stories/${id}/content`, { method: 'PUT', body }),

  submitStory: (id: number) => request<{ id: number; status: StoryStatus }>(`/api/admin/stories/${id}/submit`, { method: 'POST' }),

  reviewStory: (id: number, action: 'approve' | 'reject', reason?: string) =>
    request<{ id: number; status: StoryStatus; publishedAt: string | null }>(`/api/admin/stories/${id}/review`, {
      method: 'POST',
      body: { action, ...(reason ? { reason } : {}) },
    }),

  // --- 分类与推荐位 ---
  categories: () => request<CategoryItem[]>('/api/admin/categories'),
  updateCategory: (id: number, body: { name?: string; sortId?: number }) =>
    request<{ id: number; name: string; sortId: number | null }>(`/api/admin/categories/${id}`, { method: 'PATCH', body }),

  banners: () => request<BannerItem[]>('/api/admin/banners'),
  updateBanner: (id: number, body: Partial<{ title: string; imageUrl: string; targetType: string; targetId: string | null; sort: number; status: string }>) =>
    request<BannerItem>(`/api/admin/banners/${id}`, { method: 'PATCH', body }),

  /** M2.1 项目 3：新建推荐位（仅 admin）。 */
  createBanner: (body: { title: string; imageUrl?: string; targetType?: string; targetId?: string | null; sort?: number; status?: string }) =>
    request<BannerItem>('/api/admin/banners', { method: 'POST', body }),

  /** M2.1 项目 3：删除推荐位（仅 admin）。 */
  deleteBanner: (id: number) => request<{ id: number; deleted: boolean }>(`/api/admin/banners/${id}`, { method: 'DELETE' }),

  // --- 用户与系统 ---
  accounts: (query: { page: number; pageSize: number; role?: string }) =>
    request<{ items: AccountItem[]; total: number; page: number; pageSize: number }>('/api/admin/accounts', { query }),

  /** M2.1 项目 4：新增管理员（仅 admin）。 */
  createAccount: (body: { phone: string; nickname?: string; role?: string }) =>
    request<AccountItem>('/api/admin/accounts', { method: 'POST', body }),

  /** M2.1 项目 4：改角色 / 停用 / 改昵称（仅 admin）。 */
  updateAccount: (id: string, body: { nickname?: string; role?: string; status?: string }) =>
    request<AccountItem>(`/api/admin/accounts/${id}`, { method: 'PATCH', body }),

  audit: (query: { page: number; pageSize: number }) => request<{ items: AuditItem[]; total: number; page: number; pageSize: number }>('/api/admin/audit', { query }),
};
