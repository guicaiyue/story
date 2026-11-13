-- M4 migration 3: 补齐生产库相对基线的**缺口**（03-decisions §6 / 08 号基线文档）。
--
-- 背景（owner decision c-mwa0wan6-28qf7）：
--   生产库在 D7 之前已被写入过 M1 变更（9 列 + app schema 9 表 + 1 条迁移记录）。
--   该部分被裁定为「既成基线」，**冻结保留、不回滚**。因此本迁移：
--     * 不重建、不覆盖基线里已有的任何东西（全部 IF NOT EXISTS / 条件更新）；
--     * 只补「基线里没有」的部分；
--     * 只做**幂等**操作 —— 重跑任意次结果一致。
--
-- 本迁移补三件事：
--   A. app.audio_cache + app.audio_job —— 基线里缺这两张表（M1 的 migration 2
--      从未在生产执行过）。TTS 音频缓存索引要用。
--   B. 内容分级修正 —— 生产仍沿用旧口径（聊斋等仍是 3-6）。这**不只是数据
--      一致性问题，是内容安全缺口**：服务端 /api/home 已按 ageBand 过滤
--      （01-product-brief §4.1），但生产库里聊斋志异是 3-6，过滤闸会把它
--      当成适龄内容放行给 3-6 的孩子。必须按产品口径修正。
--   C. 删除重复空分类 id=2（0 篇）—— 产品已在 dev 执行，生产待补。
--
-- ⚠️ B 与 C 是**对既有数据的修改**（UPDATE / DELETE），不是纯追加。
--    这是产品明确口径（c-mwa0wan6-28qf7 的同一批决策），且都满足幂等与安全
--    前置条件。09 号文档「回滚」一节说明了为何**回滚不适用**。
--
-- Idempotent: safe to re-run. 已在基线里的对象不会被改动。

BEGIN;

-- ---------------------------------------------------------------------------
-- A. app schema —— 补齐 audio_cache / audio_job（与 M1 migration 2 一致）
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.audio_cache (
  story_id     integer PRIMARY KEY,
  file_path    text        NOT NULL,
  mime_type    text        NOT NULL DEFAULT 'audio/mpeg',
  byte_size    integer     NOT NULL,
  duration_sec integer     NOT NULL,
  voice        text        NOT NULL,
  char_count   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_hit_at  timestamptz NOT NULL DEFAULT now(),
  hit_count    integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS audio_cache_last_hit_idx ON app.audio_cache (last_hit_at DESC);

CREATE TABLE IF NOT EXISTS app.audio_job (
  id          text PRIMARY KEY,
  story_id    integer     NOT NULL,
  state       text        NOT NULL DEFAULT 'pending',
  attempts    integer     NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audio_job_state_idx ON app.audio_job (state);
CREATE INDEX IF NOT EXISTS audio_job_story_idx ON app.audio_job (story_id);

-- ---------------------------------------------------------------------------
-- B. 内容分级修正（产品口径，按 category_id 映射）
--
--   每档都带 `age_band IS DISTINCT FROM <目标>` 条件，所以：
--     * 已经是目标值的行**不被触碰**（幂等，且不产生无谓的 updated_at 变动）；
--     * 重跑不会重复写。
--
--   映射来自 dev 库（产品已重排的权威口径）：
--     3-6 : 1 睡前故事 / 4 儿童故事 / 5 格林童话 / 7 益智故事            = 721
--     6-9 : 6 民间故事 / 8 历史故事 / 9 寓言故事 / 10 经典故事
--           11 成语故事 / 12 童话作文                                   = 1176
--     9+  : 13 聊斋志异 / 15 规则怪谈 / 16 恐怖故事 / 17 推理小说        = 300
--   合计 2197。
--
--   注意 15/16/17 在基线里已是 9+（M1 migration 1 设过），这里再断言一次
--   不会有副作用；真正被改的是 13（聊斋，293 篇）以及 6/8/9/10/11/12（升到 6-9）。
-- ---------------------------------------------------------------------------
UPDATE public.story_main SET age_band = '3-6'
  WHERE category_id IN (1, 4, 5, 7)
    AND age_band IS DISTINCT FROM '3-6';

UPDATE public.story_main SET age_band = '6-9'
  WHERE category_id IN (6, 8, 9, 10, 11, 12)
    AND age_band IS DISTINCT FROM '6-9';

UPDATE public.story_main SET age_band = '9+'
  WHERE category_id IN (13, 15, 16, 17)
    AND age_band IS DISTINCT FROM '9+';

-- ---------------------------------------------------------------------------
-- C. 删除重复空分类 id=2（与 id=1 同名「睡前故事」，且 0 篇内容）
--
--   安全前置条件写在 WHERE 里：**只有当它确实没有任何故事时才删**。
--   若该分类下意外挂了内容，这条语句会是 no-op（不会级联删故事）。
--   幂等：删掉后重跑，NOT EXISTS 仍成立但没有匹配行。
-- ---------------------------------------------------------------------------
DELETE FROM public.story_category c
  WHERE c.id = 2
    AND NOT EXISTS (SELECT 1 FROM public.story_main m WHERE m.category_id = c.id);

-- ---------------------------------------------------------------------------
-- D. 权限：app 保持 service-only（与 migration 1/2 相同的收口）
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;

DO $$
DECLARE
  owner_role text := current_user;
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC',
    owner_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC',
    owner_role
  );

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prest_story') THEN
    REVOKE ALL ON SCHEMA app FROM prest_story;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM prest_story;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM prest_story;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA app FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lingxibi') THEN
    REVOKE ALL ON SCHEMA app FROM lingxibi;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM lingxibi;
  END IF;
END
$$;

COMMIT;
