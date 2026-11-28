# 后台登录：手机号 + 验证码 → 账号 + 密码

> **状态：方案待批准（2026-11-28）。** 本文件只做分析与方案；数据库字段、代码都还没改。
> 事项 `admin-login-password`，事件 `story.develop:admin-login-password:20261128-a1`。
>
> **基线（2026-11-28 实测，`./scripts/gate.sh`）**：服务端类型检查 PASS、后台类型检查 PASS、
> 后台单测 **63 passed**、服务端单测 **146 passed**（`story-dev-postgres` 本轮已起）。
> 技能与 AGENTS 里写的「服务端 136 用例」已过时，以 gate 实际输出 146 为准。
> App 用例未跑：本机没有 Flutter SDK，且本轮不动 `apps/app/**`。

## 1. 用户目标

`admin-story.xirizhi.cn` 的登录页从「手机号 + 短信验证码」改成「账号 + 密码」。
web 端不再出现手机号输入框、不发验证码。App 端（`apps/app`）与 C 端游客/家长体系不动。

## 2. 现状（2026-11-28 逐处核实）

| 位置 | 现状 |
| --- | --- |
| `apps/admin/src/pages/LoginPage.tsx:7,24,78-92` | 只有 `phone`、`code` 两个字段；调 `login(phone, code)`；页面底部还写着固定验证码与管理员手机号 |
| `apps/admin/src/auth.tsx:7,22-27` | `login(phone, code)`，会话里存 `phone` |
| `apps/admin/src/api/client.ts:14,222` | `AdminAccount.phone`；`adminLogin({ phone, code })` |
| `apps/admin/src/components/AppLayout.tsx:119` | 头像 Tooltip 显示 `account.phone` |
| `apps/admin/src/pages/SystemPage.tsx:51,93-110,143,245,313-323` | 「新增管理员」只收手机号，提示语是「对方用该手机号登录后台」；当前账号与列表都显示手机号 |
| `apps/server/src/routes/auth-routes.ts:10-14,44-69` | `/api/admin/auth/login` 复用 `LoginBody(phone, code)` → `loginWithPhone`，先建/找账号，再查 role/status、写 auditLog |
| `apps/server/prisma/schema.prisma:86-104` | `Account` 只有 `id / phone / nickname / role / status / createdAt`，**没有登录名，也没有密码字段** |
| `apps/server/src/routes/admin-routes.ts:344-366` | `POST /api/admin/accounts` 用手机号作为身份锚点，手机号唯一冲突返回 409 |
| `apps/server/tests/auth.test.ts:124-147` | 后台登录 2 条用例，走的都是手机号 + 验证码 |
| `apps/admin/src/pages/LoginPage.test.tsx` | 4 条用例，全部围着 phone/code 写 |
| `apps/server/scripts/seed-dev-admin.mjs:45-60` | dev 管理员/编辑账号只种手机号 |
| `apps/server/scripts/e2e-smoke.mjs:18-19,71-82` | 冒烟用 `ADMIN_PHONE` + `ADMIN_CODE` |

**结论：** 账号密码登录要落库，必须先给 `app.account` 加字段；没有可复用的现成口令字段，
也不接受明文或万能码。新增管理员、dev 种子、e2e 冒烟三处也必须一起改，否则新登录能进、
新管理员却进不来。

## 3. 方案（推荐）

### 3.1 数据模型与迁移

`Account` 追加两列，均可空：

```prisma
  /// 运营后台登录名；C 端家长/游客为 null。Postgres 唯一索引允许多个 NULL。
  username     String? @unique
  /// 运营后台密码哈希（scrypt）；C 端账号为 null。绝不存明文。
  passwordHash String? @map("password_hash")
```

新迁移 `apps/server/prisma/migrations/20261128120000_admin_password/migration.sql`：

```sql
BEGIN;
ALTER TABLE app.account ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE app.account ADD COLUMN IF NOT EXISTS password_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS account_username_key ON app.account (username);
COMMIT;
```

回滚 SQL（只在放弃这个功能时才需要）：

```sql
BEGIN;
DROP INDEX IF EXISTS app.account_username_key;
ALTER TABLE app.account DROP COLUMN IF EXISTS password_hash;
ALTER TABLE app.account DROP COLUMN IF EXISTS username;
COMMIT;
```

- **实际回滚方式是回滚镜像，不是删列**：两列是纯追加，旧版服务端/后台不认识它们也照常跑。
  删列会丢口令，只有确定不要这个功能才做。
- **生产迁移不在开发轮执行**（D7：生产库只读，只产出 migration 文件）。开发轮只对
  `story_dev` 跑 `node scripts/migrate.mjs`；测试库 `story_test` 由
  `tests/helpers/test-db.ts` 自动按目录顺序应用全部迁移。生产库等发布轮走部署迁移，
  那一步仍按「动生产库先问」的规矩确认。
- **上线前备份**：生产迁移前按 `prod-deploy.sh backup` 留库备份；开发库可重建，不备份。
- **pending 检查**：迁移文件提交后、dev 库执行前，`node scripts/migrate.mjs --status`
  会把它列为 pending（预期）；对 `story_dev` 执行后应清空。生产 pending 由发布轮核对。
- `preflight.sh --status` 读的是 `story_dev` 的账本，开发轮执行完迁移后不应再有 pending。

### 3.2 密码哈希

新增 `apps/server/src/services/password.ts`，只用 `node:crypto`，不加依赖：

- `scrypt`，参数 N=16384 / r=8 / p=1，16 字节随机 salt，64 字节 key；
- 存储格式 `scrypt$16384$8$1$<salt base64url>$<hash base64url>`；
- `hashPassword(plain): Promise<string>`、`verifyPassword(plain, stored): Promise<boolean>`；
- 比较用 `timingSafeEqual`；格式坏掉直接返回 false，不抛 500；
- 后台登录**没有固定码、没有万能码**，空口令/空账号在 zod 层就拒。

### 3.3 后台登录接口

`POST /api/admin/auth/login` 请求体改为 `{ username, password }`（新建 `AdminLoginBody`，
C 端 `/api/auth/login` 的 `LoginBody(phone, code)` 保持不动）：

1. 按 `username` 查 `id / role / status / passwordHash`；
2. 用户不存在时也跑一次预置的 dummy hash，再返回 401 `账号或密码错误` —— 不泄露账号是否存在；
3. 密码错误返回**同一个** 401 `账号或密码错误`；
4. 密码正确后才做 role 校验（403 `该账号无管理权限`）与 status 校验（403 `该账号已被停用`）；
5. 成功写 auditLog（`action=login`、`target=admin`）、签 JWT，返回 `{ token, accountId, role, username }`。

保留的既有行为：role 校验、`status=disabled` 拦截、auditLog 三条一条不丢。
旧实现「admin 登录会顺手给陌生手机号建家长账号」的副作用随手机号入口一起消失。

### 3.4 新增/修改管理员

- `POST /api/admin/accounts` 请求体改为 `{ username, password, nickname?, role }`：
  - `username`：`^[a-zA-Z0-9._-]{3,32}$`，唯一，冲突 409 `该账号名已存在`；
  - `password`：8–128 字符，进库前哈希；auditLog 只记 `username/role`，**绝不记密码**；
  - 返回体去掉 `phone`，加 `username`。
- `PATCH /api/admin/accounts/:id` 增加可选的 `username` / `password`（重置口令），
  同样哈希、同样只审计字段名。这样老管理员和忘记密码的人有落点。
- `GET /api/admin/accounts` 的 select 加 `username`；页面不再显示管理员手机号。

### 3.5 前端

- `LoginPage`：账号、密码、登录按钮；删掉手机号/验证码字段、固定码说明与管理员手机号提示；
  密码用 `Input.Password`；错误仍原样展示服务端文案。
- `auth.tsx` / `api/client.ts`：`login(username, password)`；`AdminAccount` 用 `username` 取代 `phone`；
  删掉后台已不再使用的 `sendCode`。
- `AppLayout`：头像 Tooltip 显示账号名，不再显示手机号。
- `SystemPage`：新增管理员表单改为「账号 + 初始密码 + 昵称 + 角色」；表格列「账号」；
  当前账号卡片显示账号名；成功提示改为「管理员已创建，请把账号和初始密码交给对方」。
- `FamiliesPage` 的手机号列**保留**：那是 C 端家庭数据，只读展示，不是登录输入框；
  如果要求 web 端任何位置都不出现手机号，需要单独确认（会动到家庭档案页的信息面）。

### 3.6 dev 种子、老管理员、e2e

- `seed-dev-admin.mjs`：admin 登录名 `admin`，editor 登录名 `editor`；dev 专用初始密码
  在脚本里打印一次（不进 git 的生产秘密）。哈希实现与 `password.ts` 共用，避免两套格式。
- 新增 `apps/server/scripts/set-admin-password.mjs`：对已有管理员按 id/手机号设置
  `username` + `password_hash`，用于生产首个管理员与密码重置；需要写库，**执行前先 ask**。
- `e2e-smoke.mjs`：`ADMIN_PHONE`/`ADMIN_CODE` 改为 `ADMIN_USERNAME`/`ADMIN_PASSWORD`；
  未给口令时仍可 SKIP 后台那一步。

### 3.7 测试计划

服务端（`apps/server/tests/auth.test.ts` + 新增 `tests/password.test.ts`）：

- 正确账号密码 → 200、role=admin、auditLog 多一条；
- 密码错误 → 401，文案 `账号或密码错误`，不写 auditLog、不发 token；
- 账号不存在 → 401，**与密码错误同一文案**（不泄露账号是否存在）；
- 被停用账号 + 正确密码 → 403 `该账号已被停用`；
- 家长账号设了口令 → 403 `该账号无管理权限`；
- 没有 passwordHash 的老账号 → 401 同一文案；
- 哈希工具：hash/verify 往返、错误口令、坏格式不抛异常。

后台（`LoginPage.test.tsx`，现有 4 条只改不删，另增）：

- 渲染账号/密码表单，且**不再出现** phone/code 的 label、placeholder、固定码提示；
- 账号或密码为空时不发请求；
- 成功登录 POST `/api/admin/auth/login`，body 是 `{ username, password }`，写入 token；
- 401 统一错误展示，且不写 token；
- 403 无权限/停用文案仍原样展示。

`SystemPage` 用例：新增管理员 POST body 带账号与初始密码、不带手机号；列表显示账号。
用例总数只增不减；确需改写的旧断言在 plan 里逐条写清原因（手机号字段已从后台登录移除）。

### 3.8 不动的东西

- `apps/app/**` 不动，App 登录方式不变；本机没有 Flutter SDK，不需要 CI 的 `android.yml` 验。
- C 端 `/api/auth/login`、`/api/auth/send-code`、游客注册、绑定手机号不动。
- 服务端/后台版本号不动（没有语义版本发布需求）。
- 生产库、`prod-deploy.sh migrate/grants/admin` 不在开发轮执行。

## 4. 风险与待批准

**待批准的就是迁移本身**：`app.account` 加 `username` / `password_hash` 两列，并把
`POST /api/admin/accounts` 的请求体从手机号改成账号+初始密码。批准后按第 5 节顺序做。

- **上线顺序风险**：发布后老管理员还没有口令，会进不了后台。缓解：发布窗口里先用
  `set-admin-password.mjs` 给首个管理员设好账号密码，再切流量；旧镜像仍能跑（新列是追加）。
- **没有限流**：密码登录理论上可被暴力尝试。这一轮先不做限流（内部后台、单 IP 暴露面小），
  在 plan 里留成后续项；如果要求这一轮就加，需要另开一条。
- **手机号仍出现在家庭档案页**（只读）。见 3.5 的说明。

## 5. 批准后的执行顺序

1. schema + 迁移文件 + 回滚 SQL；`node scripts/migrate.mjs` 对 `story_dev` 执行；
2. `password.ts` + 单测；登录接口、管理员新增/重置接口 + 服务端用例（先红后绿）；
3. 前端登录页/会话/客户端/系统页 + 后台用例；
4. dev 种子、`set-admin-password.mjs`、e2e 冒烟；
5. `./scripts/gate.sh`（服务端 146+新用例、后台 63+新用例）+
   `pnpm --filter @story/admin build`；界面回归连跑 ≥3 次；
6. 更新本 plan 的 todo 与实测数字、AGENTS 待办、dev log；
7. `git commit`（**不 push**），发 `story.check` 交棒。

## 6. Todo

- [x] 分清新活/退回、逐处核实现状、量基线（63 / 146）
- [x] 方案、迁移 SQL、回滚、测试计划
- [ ] **等批准：`app.account` 加两列 + 管理员创建接口改账号密码**
- [ ] schema / 迁移 / 回滚 SQL，dev 库执行
- [ ] 密码哈希工具 + 单测
- [ ] 后台登录接口改造 + 服务端用例
- [ ] 管理员新增/重置接口 + 用例
- [ ] 前端登录页/会话/客户端/系统页 + 后台用例
- [ ] dev 种子 / set-admin-password / e2e 冒烟
- [ ] gate + admin build + 界面回归 ≥3 次
- [ ] 文档同步（AGENTS 待办、dev log、本 plan 数字）
- [ ] commit（不 push）+ `story.check` 交棒
