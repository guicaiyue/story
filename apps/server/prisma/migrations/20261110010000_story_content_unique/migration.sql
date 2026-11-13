-- M2.1 项目 1 前置：补上 `public.story_content.story_id` 的唯一约束。
--
-- 背景：Prisma schema 里 StoryContent.storyId 标了 `@unique`，但真正的 legacy
-- 库（legacy-schema.sql 与生产库）里 story_id 只是一个普通外键，**没有唯一
-- 约束**。这是 schema 与数据库的真实漂移。
--
-- 后果：任何走 `upsert` 的写法都会被翻译成
--   INSERT ... ON CONFLICT (story_id)
-- 并立刻报 42P10 "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification"。M2.1 的正文写回第一个踩到。
--
-- 处理：
--   1. 业务代码已改成「先查后写」，不再依赖这个约束（更稳）；
--   2. 这里再把约束补齐，让 schema 与库一致，避免以后其它 upsert 踩同一个坑。
--
-- 安全性：已核对 dev 与生产库均为 2197 行 / 2197 个不同 story_id（无重复），
-- 因此加唯一约束不会失败、也不会丢数据。仍用 DO 块做前置检查：万一存在重复，
-- 就**跳过**并保留 NOTICE，而不是让整次迁移失败。
--
-- Idempotent: safe to re-run.

BEGIN;

DO $$
DECLARE
  dup_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'story_content_story_id_key'
      AND conrelid = 'public.story_content'::regclass
  ) THEN
    RAISE NOTICE 'story_content_story_id_key already exists, skipping';
    RETURN;
  END IF;

  SELECT count(*) INTO dup_count
  FROM (
    SELECT story_id FROM public.story_content
    WHERE story_id IS NOT NULL
    GROUP BY story_id HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE 'story_content has % duplicated story_id value(s); skipping unique constraint', dup_count;
    RETURN;
  END IF;

  ALTER TABLE public.story_content
    ADD CONSTRAINT story_content_story_id_key UNIQUE (story_id);
END
$$;

COMMIT;
