-- ---------------------------------------------------------------------------
-- 生产库收权整包（§7.5）· SQL 部分
--
-- STATUS: **NOT EXECUTED**. 需人工批准后执行（03-decisions D7 / §7.5 / §8）。
--
-- 本文件是「收权整包」中被批准后**可执行**的 SQL 部分；非 SQL 的配套改动
-- （pREST 配置、容器账号、WAF 方法白名单）列在文件末尾的 COMPANIONS 段落，
-- 供整包一次性审批，**不由本文件执行**。
--
-- 背景（03-decisions §7 实测，2026-11-09）：
--   * 公网域名 story-api.xirizhi.cn → 8.137.162.154，**确可达**。
--   * 其容器 `story-prest` 以 **`postgres` 超级用户**连库 → **绕过全部 GRANT**。
--   * 实测伪造浏览器 UA 后，POST/PUT/PATCH **确实穿透 WAF 并已送至数据库执行**
--     （打在不存在表上返回 42P01；换真实表名即可写入）。
--   * pREST 配置 `auth.enabled=false`、`access.restrict=false`；WAF 仅按 UA 拦截，
--     站点配置中**没有任何方法级规则**。
--
-- ⚠️ 能力边界（务必知悉）：
--   本 SQL 部分**只约束 `prest_story` 角色**（即 prest-multidb 那条路径），
--   **对公网 story-api 的超级用户路径无效**。真正堵住公网的是 COMPANIONS 的
--   第 1、2 项。因此本文件与 COMPANIONS 必须**作为整包一起评估**，
--   只执行本 SQL 会给人「已修好」的错觉，而公网仍可写。
--
-- 对老站（storynook.cn / story-api.xirizhi.cn）影响：无。读取用的 SELECT 全部保留。
--
-- Rollback：见文件末尾。
-- ---------------------------------------------------------------------------

BEGIN;

-- 1. 三张 legacy 内容表改为只读通道。
REVOKE INSERT, UPDATE, DELETE
  ON public.story_main, public.story_content, public.story_category
  FROM prest_story;

-- 2. 迁移记录表同样只应只读（§8.3 残留项 1；由方案 C 恢复写权限时副带产生）。
--    该表仅含迁移名与时间戳，无内容数据，但不应属写通道可达面。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public._m1_migrations
  FROM prest_story;

-- 3. 后续在 public 新建的表默认也只读，避免下次 CREATE TABLE 又把写权限带回来。
--
--    必须显式指定 FOR ROLE postgres：本库全部对象由 `postgres` 创建，
--    默认权限是按「创建者角色」记录的，用 current_user 会在以其他角色执行时
--    作用到错误的角色上。因此这里先断言该角色存在，缺失则整体失败（而不是
--    静默跳过，导致收权看似成功实则未生效）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    RAISE EXCEPTION 'role "postgres" not found: this script targets the production story DB, whose objects are owned by it';
  END IF;

  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE INSERT, UPDATE, DELETE ON TABLES FROM prest_story;
END
$$;

-- 4. `app` schema 含儿童个人信息，任何 pREST 可达角色都不应触达。
REVOKE ALL ON SCHEMA app FROM prest_story, anon, lingxibi;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM prest_story, anon, lingxibi;

COMMIT;

-- Verify -------------------------------------------------------------------
-- 期望：三张 legacy 表 = SELECT；_m1_migrations = SELECT。
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

-- ---------------------------------------------------------------------------
-- COMPANIONS —— §7.5 整包的其余部分（**非 SQL，不由本文件执行**）
--
-- 这三项需要改配置/容器，必须在同一批审批中一并决定，否则收权是空的：
--
--   1. 【最关键】pREST 启用只读白名单：
--        [access] restrict = true   + 只读表白名单
--      这是唯一在**应用层直接对公网生效**的措施。
--
--   2. `story-prest` 连库账号由 `postgres`（超级用户）换成非超级用户
--      （如 `prest_story`）。
--      ⚠️ 顺序要求：**必须先执行本文件第 1–3 项收紧**，否则只是把超级用户
--      换成一个可写角色，风险几乎不变（§7.5 建议 2 已注明）。
--
--   3. 雷池对该站点补**方法级白名单，仅放行 GET/OPTIONS**，补齐当前完全缺失的
--      方法管控。⚠️ 可被绕过（UA 同样可伪造），只能算纵深防御，不能替代 1、2。
-- ---------------------------------------------------------------------------

-- Rollback -----------------------------------------------------------------
-- 恢复 2026-11-09 方案 C 执行后的状态（即本文件执行前的状态）。
--
-- BEGIN;
-- GRANT INSERT, UPDATE, DELETE ON public.story_main     TO prest_story;
-- GRANT INSERT, UPDATE, DELETE ON public.story_content  TO prest_story;
-- GRANT INSERT, UPDATE, DELETE ON public.story_category TO prest_story;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   ON public._m1_migrations TO prest_story;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT INSERT, UPDATE, DELETE ON TABLES TO prest_story;
-- COMMIT;
