-- ---------------------------------------------------------------------------
-- 03-decisions D7 附录 · 方案 C 处置脚本
--
-- STATUS: EXECUTED ONCE (2026-11-09) to restore item 6.
--
-- 背景：在 D7 下达前，曾对生产 story 库做了 6 项写入（详见 03-decisions §6）。
-- 按方案 C，仅将**未经批准的第 6 项**恢复到变更前状态；其余 5 项冻结不动。
--
-- 第 6 项 = 「REVOKE INSERT/UPDATE/DELETE ... FROM prest_story + 改默认权限」。
-- 本脚本把它改回变更前观测到的状态（2026-11-09 实测快照）：
--
--   变更前 role_table_grants:
--     story_main / story_content / story_category → DELETE,INSERT,SELECT,UPDATE
--   变更前 pg_default_acl（postgres@public, TABLES）:
--     {anon=r/postgres, lingxibi=r/postgres, prest_story=arwd/postgres}
--
-- 本脚本**只动 prest_story 对这三张 legacy 表的写权限与 public 默认权限**，
-- 不触碰：
--   * story_main 的 9 个新增列（第 1 项，冻结）
--   * 2197 行回填（第 2 项，冻结）
--   * 7 行 age_band='9+'（第 3 项，冻结）
--   * app schema 与 9 张空表（第 4 项，冻结）
--   * public._m1_migrations（第 5 项，冻结）
--
-- 作用域说明：仅 `public` schema。`app` schema 属于第 4 项，不在本处置范围。
--
-- 注意：公网 pREST 路径以 postgres 超级用户连库（03-decisions §7），
-- 本脚本不改变该路径的暴露面 —— 恢复写权限不会使安全状况比变更前更差，
-- 但 §7 的方法管控缺口依然独立存在。
--
-- 回滚（如需再次收紧，等价于第 6 项的原始效果）：见文件末尾。
-- ---------------------------------------------------------------------------

BEGIN;

-- 恢复第 6 项变更前：prest_story 对三张 legacy 表拥有 INSERT/UPDATE/DELETE
-- （SELECT 从未被撤销，无需重复授予，但显式写出以保证幂等语义清晰）。
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.story_main, public.story_content, public.story_category
  TO prest_story;

-- 恢复第 6 项变更前：public schema 下由 postgres 新建的表，默认授予 prest_story
-- 读写权限（arwd = INSERT/SELECT/UPDATE/DELETE）。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT INSERT, UPDATE, DELETE ON TABLES TO prest_story;

COMMIT;

-- 核对 ---------------------------------------------------------------------
-- 期望：三张 legacy 表 = DELETE,INSERT,SELECT,UPDATE；
--       pg_default_acl(postgres@public,TABLES) 含 prest_story=arwd/postgres
--
--   SELECT table_name,
--          string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND grantee = 'prest_story'
--    GROUP BY 1 ORDER BY 1;
--
--   SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclacl
--     FROM pg_default_acl
--    WHERE defaclnamespace::regnamespace::text = 'public';

-- 如需再次收紧（等同第 6 项效果），执行：
--   BEGIN;
--   REVOKE INSERT, UPDATE, DELETE
--     ON public.story_main, public.story_content, public.story_category
--     FROM prest_story;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     REVOKE INSERT, UPDATE, DELETE ON TABLES FROM prest_story;
--   COMMIT;
