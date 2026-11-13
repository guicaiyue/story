-- ===========================================================================
-- 小故事铺 2.0 · 建首个生产管理员账号（**待批准，尚未执行**）
-- ===========================================================================
--
-- 为什么需要这一步：生产库 `app.account` 目前 **0 条账号**，而后台登录要求
--   role ∈ {admin, editor} 且 status = 'active'（见 apps/server/src/routes/auth-routes.ts:49-56）。
-- 没有这一步，生产 docker 起来后运营后台**谁都登不进去**。
--
-- 前置：迁移 20261110020000_m2_admin_status 已应用（否则没有 status 列）。
-- 幂等：重复执行只会把该账号纠正回 admin/active，不会报错、不会建第二条。
--
-- 用法（把 <PHONE> 换成你的手机号）：
--   docker exec -i postgres psql -U postgres -d story \
--       -v phone="'<PHONE>'" -f - < docs/product/21-prod-admin-seed.sql
-- ===========================================================================

BEGIN;

INSERT INTO app.account (id, phone, nickname, role, status)
VALUES ('acc_prod_admin_01', :phone, '内容运营', 'admin', 'active')
ON CONFLICT (id) DO UPDATE
  SET phone = EXCLUDED.phone,
      role  = 'admin',
      status = 'active';

-- 复核：应当恰好 1 行 role=admin / status=active
SELECT id, phone, nickname, role, status
FROM app.account
WHERE role = 'admin' AND status = 'active';

COMMIT;

-- 回滚（撤销这个账号）：
--   DELETE FROM app.account WHERE id = 'acc_prod_admin_01';
--
-- 注意：
--   * 登录用的是 **固定短信码**（服务端环境变量 FIXED_SMS_CODE），没有真实短信通道；
--   * 所以 FIXED_SMS_CODE 必须是强随机值，且只存在于 .env.prod（已 gitignore）；
--   * 上架前要接真实短信通道，并给这个账号绑定真实手机号。
