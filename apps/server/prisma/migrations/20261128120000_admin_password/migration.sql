-- 后台登录从「手机号 + 验证码」改成「账号 + 密码」所需的凭证列。
--
-- 为什么要加列：Account 原本只有 phone，运营后台没有可落密码的地方。
-- 密码按要求走哈希（scrypt，见 src/services/password.ts），绝不存明文。
--
-- 两列都可空：
--   * C 端家长/游客没有运营后台登录名，保持 NULL；
--   * 既有管理员在设置口令前也是 NULL，由 set-admin-password 或后台「新增管理员」补齐。
-- Postgres 的唯一索引允许多个 NULL，所以 C 端账号不会互相冲突。
--
-- Idempotent: safe to re-run. Additive only；旧版服务端不认识这两列也照常运行。

BEGIN;

ALTER TABLE app.account
  ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE app.account
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS account_username_key ON app.account (username);

COMMIT;
