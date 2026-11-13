-- M2.1 项目 4：管理员账号管理所需的 `status` 列。
--
-- 为什么要加列：M2.1 要求「停用管理员」。原 Account 只有 role，没有可用性
-- 状态；如果只在前端把账号隐藏，被停用的人仍能登录并调用接口 —— 那是假停用。
-- 所以状态必须落到数据库，并在**登录**与**鉴权**两处同时校验。
--
-- Idempotent: safe to re-run. Additive only；既有账号默认 active（= 不受影响）。

BEGIN;

ALTER TABLE app.account
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- 只允许两个取值。用 DO 块包住，重复执行不会因为约束已存在而失败。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_status_check'
  ) THEN
    ALTER TABLE app.account
      ADD CONSTRAINT account_status_check CHECK (status IN ('active', 'disabled'));
  END IF;
END
$$;

-- 后台按「角色 + 状态」筛人，加组合索引。
CREATE INDEX IF NOT EXISTS account_role_status_idx ON app.account (role, status);

COMMIT;
