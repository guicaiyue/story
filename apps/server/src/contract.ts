import { z } from 'zod';

/** 02-architecture §4: responses are `{ ok: true, data }` or `{ ok: false, error }`. */
export type ApiError = { code: string; message: string; details?: unknown };
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string, details?: unknown): ApiResponse<never> {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/** Error codes shared by services and routes. */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;

/** Raised by services; mapped to HTTP status by the route error handler. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(ErrorCode.BAD_REQUEST, message, 400, details);
  }
  static unauthorized(message = '未登录') {
    return new AppError(ErrorCode.UNAUTHORIZED, message, 401);
  }
  static forbidden(message = '无权访问') {
    return new AppError(ErrorCode.FORBIDDEN, message, 403);
  }
  static notFound(message = '资源不存在') {
    return new AppError(ErrorCode.NOT_FOUND, message, 404);
  }
  static conflict(message: string) {
    return new AppError(ErrorCode.CONFLICT, message, 409);
  }
}

// ---------------------------------------------------------------------------
// Shared query schemas
// ---------------------------------------------------------------------------

export const AgeBand = z.enum(['3-6', '6-9', '9+']);
export type AgeBand = z.infer<typeof AgeBand>;

export const StoryStatus = z.enum(['draft', 'review', 'published', 'archived']);
export type StoryStatus = z.infer<typeof StoryStatus>;

/**
 * Child-facing endpoints must never default to unfiltered results (00-research P1:
 * 恐怖/怪谈 content). `ageBand` defaults to 3-6 and `status` is forced to
 * `published` for public reads, so the safe path is the default path.
 */
export const PublicStoryQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  categoryId: z.coerce.number().int().positive().optional(),
  ageBand: AgeBand.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  featured: z.coerce.boolean().optional(),
});
export type PublicStoryQuery = z.infer<typeof PublicStoryQuery>;
