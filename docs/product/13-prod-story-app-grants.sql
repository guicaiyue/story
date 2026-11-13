-- ===========================================================================
-- 小故事铺 2.0 · 生产库专用最小权限账号 `story_app`
-- ===========================================================================
--
-- 🔴 状态：**待产品负责人审阅，尚未执行**（2026-11-11）。
--    本文件是「选定方案 A：专用最小权限账号」的 SQL 全文。
--    执行对象是**生产库 `story`**（容器 postgres）—— 属生产写操作，需批准。
--
-- 为什么不是「只读连接串」：生产 server 必须能写 `app.*`（游客注册、设置、
-- 进度、收藏、TTS 缓存索引）并回填 `public.story_main.duration_sec`。
-- 只读账号会让 App 全站失败，而 `/api/health` 仍返回 db=up（它只 SELECT 1）。
-- 详见 docs/product/12-prod-deploy-runbook.md §3。
--
-- 权限矩阵的来源：**逐条读 apps/server/src 的调用点**得出，不是照抄 schema。
--    见文件末尾「附：权限推导依据」。
--
-- 与 postgres 超级用户的区别（这就是本方案的价值）：
--    无 DDL（不能 CREATE/ALTER/DROP）、无超级用户、无跨库访问、
--    无 `_m1_migrations` 写权限（迁移必须另用高权账号，防止误跑 DDL）。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. 前置：把 <STRONG_PASSWORD> 换成强随机串
--    生成：openssl rand -base64 24
--    ⚠️ 该密码只应存在于 .env.prod（已 gitignore）与本次执行，不要写进仓库。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. 建角色（只有 LOGIN，没有 CREATEDB / CREATEROLE / SUPERUSER）
--    用 DO 块做到**幂等**：重复执行不会报「role already exists」。
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'story_app') THEN
    CREATE ROLE story_app LOGIN PASSWORD '<STRONG_PASSWORD>'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSE
    -- 已存在则只重置密码（便于轮换）
    ALTER ROLE story_app LOGIN PASSWORD '<STRONG_PASSWORD>'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- 连接与 schema 入口
GRANT CONNECT ON DATABASE story TO story_app;
GRANT USAGE ON SCHEMA public, app TO story_app;

-- ---------------------------------------------------------------------------
-- 2. public schema（老站内容表 + 新站要回填的时长）
--    来源：content-service / admin-service / tts-service
-- ---------------------------------------------------------------------------
-- 读：列表、详情、分类、正文、M2 数据分析（$queryRaw 聚合）
GRANT SELECT ON public.story_main, public.story_content, public.story_category TO story_app;

-- 写：
--   story_main   ← PATCH /admin/stories/:id（title/excerpt/categoryId/categoryName/
--                   ageBand/tags/coverUrl/audioUrl/durationSec/featured/status）
--                  + tts-service backfillStory（duration_sec, audio_url）
--                  + admin-service 正文写回（length, excerpt）
--   story_content← PUT /admin/stories/:id/content（新建或更新正文）
--   story_category ← PATCH /admin/categories/:id（name, sortId）
-- 注意：服务端**从不** INSERT/DELETE story_main 与 story_category（已 grep 确认），
--       所以刻意不给这两张表的 INSERT/DELETE —— 内容只能通过既有迁移/人工入库增加。
GRANT UPDATE ON public.story_main TO story_app;
GRANT INSERT, UPDATE ON public.story_content, public.story_category TO story_app;

-- 序列：只有「服务端会 INSERT 的表」才需要
--   story_content_id_seq ← db.storyContent.create
--   （story_main_id_seq / story_category_id_seq 刻意不给：服务端不 INSERT 这两张表）
GRANT USAGE ON SEQUENCE public.story_content_id_seq TO story_app;

-- `public._m1_migrations` 是迁移账本：**刻意不授权**。
-- 迁移（含 3 条待应用迁移）必须用高权账号执行，见 §6 与 runbook §5 步骤 3。

-- ---------------------------------------------------------------------------
-- 3. app schema（业务表）
--    全部来自 apps/server/src 的调用点统计：
--      create/upsert : account, child, setting, progress, favorite, playEvent,
--                      banner, auditLog, audioCache
--      update        : account, child, setting, progress, favorite, banner,
--                      audioCache
--      delete        : banner, favorite, audioCache
--      read-only     : family（仅 db.family.count()）
-- ---------------------------------------------------------------------------

-- 3.1 只读表
GRANT SELECT ON app.family TO story_app;

-- 3.2 读 + 写（无删除）
--   account   : 游客注册 create / GET,PATCH /api/me / 后台管理员 create+update
--   child     : 孩子档案 create + update
--   setting   : upsert（读设置时可能首次插入）
--   progress  : upsert（播放进度）
--   play_event: create（播放埋点）
--   audit_log : create（后台操作留痕）
GRANT SELECT, INSERT, UPDATE ON
  app.account, app.child, app.setting, app.progress, app.play_event, app.audit_log
  TO story_app;

-- 3.3 读 + 写 + 删
--   favorite   : upsert + deleteMany（取消收藏）
--   banner     : 后台推荐位增删改
GRANT SELECT, INSERT, UPDATE, DELETE ON app.favorite, app.banner TO story_app;

-- 3.4 banner 主键是 autoincrement → 需要序列
GRANT USAGE ON SEQUENCE app.banner_id_seq TO story_app;

-- 3.5 TTS 音频缓存（**迁移 1 之后才存在** —— 见下方「顺序陷阱」）
--   audio_cache: getOrCreateAudio 的 findUnique/update/delete/upsert
--   audio_job  : 仅 apps/server/scripts/tts-backfill.mjs 使用（运维脚本）
--                一并授权，好处是批量回填不必用超级用户。
--
-- ⚠️ 顺序陷阱：截至 2026-11-11，生产 `app` schema **没有** audio_cache / audio_job
--    （只有 9 张表）。若直接对不存在的表 GRANT，会报
--    `ERROR: relation "app.audio_cache" does not exist` 而中断整段脚本。
--    所以用 DO 块**条件授权** —— 迁移前后跑都不报错，且迁移后自动生效
--    （§4 的 ALTER DEFAULT PRIVILEGES 也会覆盖新表，这是双保险）。
DO $$
BEGIN
  IF to_regclass('app.audio_cache') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app.audio_cache TO story_app;
  ELSE
    RAISE NOTICE '跳过 app.audio_cache 授权：表还不存在（待迁移 1 应用）';
  END IF;

  IF to_regclass('app.audio_job') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app.audio_job TO story_app;
  ELSE
    RAISE NOTICE '跳过 app.audio_job 授权：表还不存在（待迁移 1 应用）';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. 默认权限：让「将来新建的表」自动继承，避免每次迁移后手工补授权
--    ⚠️ FOR ROLE postgres 是关键：生产库所有表的 owner 都是 postgres，
--       迁移也由 postgres 执行；不写 FOR ROLE 则默认权限挂到执行者身上，不生效。
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO story_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO story_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO story_app;

-- ---------------------------------------------------------------------------
-- 5. 执行后核对（只读；期望值见注释）
-- ---------------------------------------------------------------------------
-- 5.1 角色属性：期望 t(login) / f(super) / f(createdb) / f(createrole)
-- SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
--   FROM pg_roles WHERE rolname = 'story_app';
--
-- 5.2 表级权限清单（期望与 §2/§3 一致，且**不含** _m1_migrations）
--     ⚠️ GROUP BY 必须写列表达式，不能写 `GROUP BY 1,2` —— 因为 SELECT 列表第 1 列
--        是拼接后的字符串，PostgreSQL 会报「aggregate functions are not allowed in
--        GROUP BY」（本条已实测踩到并修正）。
-- SELECT table_schema, table_name,
--        string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
--   FROM information_schema.role_table_grants
--  WHERE grantee = 'story_app'
--  GROUP BY table_schema, table_name
--  ORDER BY 1, 2;
--
-- 5.3 序列权限
--     ⚠️ information_schema.role_usage_grants 的列名是 object_schema/object_name，
--        **不是** table_schema/table_name（实测踩到并修正）。
-- SELECT object_schema, object_name, privilege_type
--   FROM information_schema.role_usage_grants
--  WHERE grantee = 'story_app' AND object_type = 'SEQUENCE'
--  ORDER BY 1, 2;
--
-- 5.4 权限能力自省（**推荐用这个代替「试跑 DDL」**）
--     下面几个函数是只读的，能直接证明「DDL 不可能」，不需要真的去执行
--     CREATE/DROP（那样既有风险，也会被执行闸门拦下）：
-- SELECT has_schema_privilege('story_app','public','CREATE') AS can_create_public,  -- 期望 false
--        has_schema_privilege('story_app','app','CREATE')    AS can_create_app,     -- 期望 false
--        has_schema_privilege('story_app','public','USAGE')  AS can_use_public,     -- 期望 true
--        EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON c.relowner = r.oid
--                WHERE r.rolname = 'story_app')              AS owns_any_table;     -- 期望 false
--
-- 5.5 端到端「真能干活」验证（比健康检查更有意义，见 runbook §5）
--   psql "postgresql://story_app:<pass>@<host>:5432/story" -c 'SELECT 1'
--   再由应用侧打一次 POST /api/auth/register-device（写路径）。

-- ---------------------------------------------------------------------------
-- 6. 回滚（撤销本账号）
-- ---------------------------------------------------------------------------
-- 先改连接串再执行；单独 DROP OWNED 不会影响 postgres 拥有的表。
-- DROP OWNED BY story_app;   -- 清掉它拥有的对象（应为空）与所有授权
-- DROP ROLE story_app;

-- ---------------------------------------------------------------------------
-- 附：权限推导依据（可复核）
-- ----------------------------------------------------------------------------- 命令（本轮只读执行）：
--   grep -rnoE 'db\.[a-zA-Z]+\.(create|createMany|upsert|update|delete|deleteMany)'
--     apps/server/src/ | sort -u
--   grep -rnoE 'db\.[a-zA-Z]+\.(delete|deleteMany)' apps/server/src/ | sort -u
-- 结果：
--   create/upsert: account, audioCache, auditLog, banner, child, favorite,
--                  playEvent, progress, setting, storyContent
--   update       : account, audioCache, banner, child, favorite, progress,
--                  setting, story, storyContent, category(store.update)
--   delete       : banner, favorite, audioCache
--   family       : 仅 count() → 只读
--   story/category: 无 create/delete → 不给 INSERT/DELETE
-- 只读 SQL 确认生产现状（本轮）：
--   app schema 现有 9 张表（**无 audio_cache/audio_job** → 迁移 1 待应用）
--   public 有 story_main / story_content / story_category / _m1_migrations
--   序列：app.banner_id_seq, public.{story_main,story_content,story_category}_id_seq
--   所有表 owner = postgres

-- ---------------------------------------------------------------------------
-- 附二：演练记录（在 **dev 库 story_dev** 跑过，2026-11-11）
-- ---------------------------------------------------------------------------
-- 做法：把本文件里的 `story_app` 替换为 `story_app_rehearsal`、
--       `ON DATABASE story` 替换为 `story_dev`、`FOR ROLE postgres` 替换为
--       `FOR ROLE storydev`（dev 库 owner 是 storydev），其余原样执行。
--
-- 结果（全部实测，非推断）：
--   [1] 脚本执行        exit 0，无 error；建角色 → 授权 → 默认权限全部成功
--   [2] 角色属性        login=t, super=f, createdb=f, createrole=f  ✅
--   [3] 表级权限        与设计逐表一致：
--         public.story_main     : SELECT,UPDATE          （无 INSERT/DELETE ✅）
--         public.story_content  : INSERT,SELECT,UPDATE
--         public.story_category : INSERT,SELECT,UPDATE
--         app.family            : SELECT                 （只读 ✅）
--         app.account/child/setting/progress/play_event/audit_log : INSERT,SELECT,UPDATE
--         app.favorite/banner   : DELETE,INSERT,SELECT,UPDATE
--         app.audio_cache/job   : DELETE,INSERT,SELECT,UPDATE
--         `_m1_migrations`      : **0 条授权** ✅
--   [4] 序列权限        app.banner_id_seq, public.story_content_id_seq 各 USAGE
--                       （story_main_id_seq / story_category_id_seq 刻意无 ✅）
--   [5] DDL 不可能       has_schema_privilege(CREATE)=false（public 与 app 都是）
--                       owns_any_table=false, rolsuper=false, rolcreatedb=false ✅
--   [6] 业务写路径      以该角色实跑并在同一事务 ROLLBACK：
--                       account / setting / progress / favorite / play_event /
--                       child / audit_log 的 INSERT +
--                       story_main.duration_sec、story_content.content、
--                       story_category.sort_id 的 UPDATE —— 全部成功，残留 0 ✅
--   [7] 「表不存在」分支 用不存在的表名验证：正确走 RAISE NOTICE 跳过，
--                       不会因 `relation does not exist` 中断（生产迁移前即此状态）✅
--
-- 演练踩到并已修正的两个坑（已写进 §5 注释）：
--   a) `docker exec` 不加 `-i` 时 stdin 不会被送进 psql —— heredoc 会**静默不执行**
--      （退出码 0、无输出，看起来像成功）。必须 `docker exec -i`。
--   b) §5.2/§5.3 两条核对查询原本写错：`GROUP BY 1,2` 触发
--      "aggregate functions are not allowed in GROUP BY"；序列权限视图的列名是
--      `object_schema/object_name` 而非 `table_schema/table_name`。
--
-- 另注（与本授权无关，但 App 依赖）：`app.setting` 与 `app.progress` 的 `id`
-- 列**没有默认值**，由应用侧显式生成（Prisma cuid）。生产上若它们也如此，
-- 手工 SQL 插入必须自带 id —— 已实测踩到。
