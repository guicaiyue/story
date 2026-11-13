import type { Db } from '../db.js';

/**
 * 02-architecture §4.2 admin analytics.
 *
 * All figures come from `app.play_event` joined to the live legacy tables.
 * Deliberately no ranking or comparison between children (00-research
 * principle 7: 不制造焦虑) — aggregates are content- and time-oriented only.
 */
export async function getDashboard(db: Db) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalStories, published, draft, review, archived, missingCover, missingAudio, missingAge, families, children, plays24h] =
    await Promise.all([
      db.story.count(),
      db.story.count({ where: { status: 'published' } }),
      db.story.count({ where: { status: 'draft' } }),
      db.story.count({ where: { status: 'review' } }),
      db.story.count({ where: { status: 'archived' } }),
      db.story.count({ where: { coverUrl: null } }),
      db.story.count({ where: { audioUrl: null } }),
      db.story.count({ where: { ageBand: '' } }),
      db.family.count(),
      db.child.count(),
      db.playEvent.count({ where: { at: { gte: dayAgo } } }),
    ]);

  const total = totalStories || 1;
  const unhealthy = missingCover + missingAge;

  return {
    content: { total: totalStories, published, draft, review, archived },
    // 01-product-brief §6: 内容健康 = published 中缺封面/无音频/无年龄档占比 ≤ 5%
    health: {
      missingCover,
      missingAudio,
      missingAgeBand: missingAge,
      unhealthyRatio: Number(((unhealthy / total) * 100).toFixed(2)),
    },
    users: { families, children },
    plays24h,
  };
}

/**
 * Hour-of-day distribution — feeds the 睡前时段占比 target in 01-product-brief §6.
 *
 * `at` is `timestamptz`, and the server session runs in UTC while the product's
 * 「睡前时段 20:00–23:00」 is China local time. Grouping on the raw column would
 * therefore bucket every play 8 hours early and understate the headline metric
 * by an order of magnitude (observed: 6.2% vs the true ~66%). The conversion is
 * pinned explicitly rather than relying on the session timezone, so the figure
 * is identical regardless of where the service runs.
 */
/**
 * 写回故事正文（M2.1 项目 1）。
 *
 * 正文存在 `public.story_content.content`，摘要与字数是 `public.story_main`
 * 上的列。
 *
 * ⚠️ 这里刻意**不用 `upsert`**：Prisma schema 声明了 `storyId @unique`，但
 * 真正的 legacy 库里 `story_content` 只有主键，**没有 story_id 唯一约束**
 * （`legacy-schema.sql` 里 `story_id integer REFERENCES ...`，无 UNIQUE）。
 * Prisma 的 upsert 会翻译成 `INSERT ... ON CONFLICT (story_id)`，于是直接报
 * 42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification"。这是 schema 与数据库的真实漂移，已另行补迁移；
 * 但代码不应依赖那个约束才正确，所以这里用「先查后写」。
 *
 * 关于 `length`（03-decisions §5.3）：语义是**正文字数**，不是播放时长。
 * 实测生产/dev 库里这个冗余列**没有单一可复现的公式**（全库 2197 行里，
 * 去空白吻合 1547 行、去换行吻合 2028 行、原样仅 42 行）—— 它是老站用自己
 * 那套计数写进去的。这里统一按「去除所有空白后的字符数」重算，这是「字数」
 * 最合理的定义；老站读此列只用于展示字数量级，不会有正确性问题。
 * 计数放在 SQL 里做，以对齐 PG 的字符语义（codepoint，而非 JS 的 UTF-16）。
 */
export async function updateStoryContent(
  db: Db,
  storyId: number,
  input: { content: string; excerpt?: string | null },
) {
  const existing = await db.storyContent.findFirst({ where: { storyId }, select: { id: true } });
  if (existing) {
    await db.storyContent.update({ where: { id: existing.id }, data: { content: input.content } });
  } else {
    await db.storyContent.create({ data: { storyId, content: input.content } });
  }

  // 用 POSIX 字符类 `[[:space:]]` 而不是 `\s`：在 Prisma 的 tagged template 里
  // `'\s'` 会被双重转义成字面 `\s`（反斜杠+s），于是**匹配不到换行** ——
  // 实测同一条正文 `新的正文。\n第二段。` 得到 10（把换行算进去了）而不是 9。
  // POSIX 类不受转义层级影响，结果稳定。
  const [lenRow] = await db.$queryRaw<Array<{ len: number }>>`
    SELECT char_length(regexp_replace(${input.content}, '[[:space:]]', '', 'g'))::int AS len
  `;
  const length = lenRow?.len ?? 0;

  return db.story.update({
    where: { id: storyId },
    data: {
      length,
      // excerpt: undefined = 不改；null = 清空；字符串 = 覆盖。
      ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
    },
    select: { id: true, length: true, excerpt: true, updatedAt: true },
  });
}

export async function getAnalyticsOverview(db: Db) {
  const byHour = await db.$queryRaw<Array<{ hour: number; plays: bigint }>>`
    SELECT EXTRACT(HOUR FROM at AT TIME ZONE 'Asia/Shanghai')::int AS hour,
           count(*) AS plays
    FROM app.play_event
    GROUP BY 1
    ORDER BY 1
  `;
  return { byHour: byHour.map((r) => ({ hour: r.hour, plays: Number(r.plays) })) };
}

/**
 * 播放 Top 20（M2.1 项目 2）—— 按 `start` 事件次数排行。
 *
 * 只统计 `start`，因为一次收听会产生多条不同 event 记录（start/pause/
 * complete/stop），把全部事件计入会把「播放量」放大成「事件数」。用 start
 * 才是「被播放了多少次」。
 */
export async function getAnalyticsTop(db: Db, limit = 20) {
  const rows = await db.$queryRaw<Array<{ story_id: number; title: string | null; plays: bigint; completes: bigint }>>`
    SELECT e.story_id,
           m.title,
           count(*) FILTER (WHERE e.event = 'start')    AS plays,
           count(*) FILTER (WHERE e.event = 'complete') AS completes
    FROM app.play_event e
    LEFT JOIN public.story_main m ON m.id = e.story_id
    GROUP BY e.story_id, m.title
    HAVING count(*) FILTER (WHERE e.event = 'start') > 0
    ORDER BY plays DESC, e.story_id ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => {
    const plays = Number(r.plays);
    const completes = Number(r.completes);
    return {
      storyId: r.story_id,
      title: r.title,
      plays,
      completes,
      // 完播率以播放次数为分母，取一位小数（前端直接展示）。
      completionRate: plays > 0 ? Number(((completes / plays) * 100).toFixed(1)) : 0,
    };
  });
}

/**
 * 近 N 天播放/完播趋势（M2.1 项目 2）。
 *
 * 用 `generate_series` 补齐没有播放的日期，否则前端折线图会把空白日跳过、
 * 把 14 天画成 9 天。日期按 **Asia/Shanghai** 切分（同 byHour 的理由）。
 */
export async function getAnalyticsTrend(db: Db, days = 14) {
  const rows = await db.$queryRaw<Array<{ day: string; plays: bigint; completes: bigint }>>`
    WITH span AS (
      SELECT generate_series(
        (CURRENT_DATE AT TIME ZONE 'Asia/Shanghai') - (${days - 1} || ' days')::interval,
        (CURRENT_DATE AT TIME ZONE 'Asia/Shanghai'),
        '1 day'::interval
      )::date AS day
    ),
    agg AS (
      SELECT (at AT TIME ZONE 'Asia/Shanghai')::date AS day,
             count(*) FILTER (WHERE event = 'start')    AS plays,
             count(*) FILTER (WHERE event = 'complete') AS completes
      FROM app.play_event
      WHERE at >= ((CURRENT_DATE AT TIME ZONE 'Asia/Shanghai') - (${days - 1} || ' days')::interval)
      GROUP BY 1
    )
    SELECT to_char(s.day, 'YYYY-MM-DD') AS day,
           COALESCE(a.plays, 0)     AS plays,
           COALESCE(a.completes, 0) AS completes
    FROM span s
    LEFT JOIN agg a ON a.day = s.day
    ORDER BY s.day
  `;
  return rows.map((r) => {
    const plays = Number(r.plays);
    const completes = Number(r.completes);
    return {
      day: r.day,
      plays,
      completes,
      completionRate: plays > 0 ? Number(((completes / plays) * 100).toFixed(1)) : 0,
    };
  });
}

/**
 * 分类分布（M2.1 项目 2）—— 已发布内容按分类计数 + 各档年龄分布。
 *
 * 「内容」口径用 `status='published'`（与 App/老站可见范围一致），
 * 并显式标出 `ageBand` 分布，避免把 9+ 内容混进儿童端统计。
 */
export async function getAnalyticsCategories(db: Db) {
  const rows = await db.$queryRaw<Array<{ category_id: number | null; name: string | null; total: bigint; band_3_6: bigint; band_6_9: bigint; band_9plus: bigint }>>`
    SELECT m.category_id,
           COALESCE(c.name, m.category_name) AS name,
           count(*)                                              AS total,
           count(*) FILTER (WHERE m.age_band = '3-6')            AS band_3_6,
           count(*) FILTER (WHERE m.age_band = '6-9')            AS band_6_9,
           count(*) FILTER (WHERE m.age_band = '9+')             AS band_9plus
    FROM public.story_main m
    LEFT JOIN public.story_category c ON c.id = m.category_id
    WHERE m.status = 'published'
    GROUP BY m.category_id, COALESCE(c.name, m.category_name)
    ORDER BY total DESC, m.category_id ASC
  `;
  return rows.map((r) => ({
    categoryId: r.category_id,
    name: r.name ?? '未分类',
    total: Number(r.total),
    bands: {
      '3-6': Number(r.band_3_6),
      '6-9': Number(r.band_6_9),
      '9+': Number(r.band_9plus),
    },
  }));
}
