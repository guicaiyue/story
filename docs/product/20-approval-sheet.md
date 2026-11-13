# 20 · 批准清单（一页决定生产三步）

日期：2026-11-12　状态：**已于 2026-11-13 执行完毕** → 执行记录见 [24-prod-deploy-20261113.md](24-prod-deploy-20261113.md)
配套：[12-prod-deploy-runbook.md](12-prod-deploy-runbook.md)（完整手册）、[18-progress-log.md](18-progress-log.md)（进度）

---

## 0. 现在是什么状态

```
代码  服务端 136 ✅   后台 63 ✅   App 87 ✅   端到端 16/16 ✅   迁移彩排 ✅   备份恢复演练 ✅
生产  数据库只被读过（story_main=2197，迁移账本 1 条，未变）
镜像  story-server:m4 / story-admin:m4 与当前源码一致
```

**结论：技术上已经可以上。下面三步都是「生产写操作」，按约定需要你逐项点头。**

---

## ① 把 4 个迁移应用到生产库 `story`

**做什么**：按序执行 `apps/server/prisma/migrations/` 里还没应用的 4 个：

```
20261109010000_audio_cache            新增 app.audio_cache / app.audio_job
20261110000000_m4_prod_supplement     内容分级修正 + 删掉空的重复分类 id=2
20261110010000_story_content_unique   story_content(story_id) 唯一约束
20261110020000_m2_admin_status        app.account.status（后台管理员状态）
```

**命令**（在生产库那台机器上，用超级用户跑）：

```bash
DATABASE_URL='postgresql://postgres:<密码>@postgres:5432/story' node apps/server/scripts/migrate.mjs
```

**耗时**：秒级（2197 行，全部是加表/加列/加约束）。
**影响面**：新增 2 张表、1 个列、1 个唯一约束；`story_main` 行数不变。
**唯一的数据变化**：`story_category` 15 → 14 —— 删掉 `id=2`「睡前故事」，它与 `id=1` 同名且 **0 篇故事**挂在它下面（SQL 见 `20261110000000/migration.sql:96`）。
**证据**：已在**生产数据的副本**上完整跑过（runbook §7.2），迁移后 `story_main=2197`、孤儿引用 0、音频接口从 500 变 200。
**失败怎么退**：这是本页唯一有真实回滚成本的一步 ——

```bash
# 回到执行前（会丢掉执行后新产生的数据，确认后再用）
docker exec -i postgres pg_restore -U postgres -d story --clean --if-exists --no-owner \
  < /vol1/1000/story/backup/story-20261112-2121.dump
```

**怎么算成功**：`migrate.mjs --status` 显示 `待执行：0 个`，且 `select count(*) from public.story_main` = 2197。

---

## ② 建 `story_app` 专用账号并授权

**做什么**：执行 [13-prod-story-app-grants.sql](13-prod-story-app-grants.sql)（253 行，幂等）：

- 建角色 `story_app`（LOGIN，**非**超级用户、无 DDL）；
- 只给业务需要的权限：`public` 读 + 必要的写；`app.*` 读写；
- **不给** `_m1_migrations` 写权限（迁移必须另用高权账号，防止误跑 DDL）。

**为什么必须做**：现在生产服务如果直接用 postgres 超级用户，任何一处 SQL 注入都能 DDL/跨库。
**耗时**：秒级。
**可逆**：`DROP ROLE story_app;`（文件 §6 已写）。
**前提**：执行前把 SQL 里的 `<STRONG_PASSWORD>` 换成 `openssl rand -base64 24` 的结果，并同步写进 `.env.prod`。

**怎么算成功**：用 `story_app` 连一次库能 `select`，且 `create table` 被拒绝。

---

## ②b 建首个生产管理员账号（**否则后台谁都登不进去**）

**为什么需要**：生产库 `app.account` 现在 **0 条账号**，而后台登录要求 `role ∈ {admin, editor}`
且 `status = 'active'`（`apps/server/src/routes/auth-routes.ts:49-56`）。少了这步，③ 起完容器后
运营后台是**打不开的**——这不是猜测，是刚查过的现网状态。

**做什么**：执行 [21-prod-admin-seed.sql](21-prod-admin-seed.sql)（幂等，39 行）：

```bash
docker exec -i postgres psql -U postgres -d story \
    -v phone="'<你的手机号>'" -f - < docs/product/21-prod-admin-seed.sql
```

**已在副本库验证**：插入 1 行成功、重复执行仍只有 1 行（幂等）、复核查询返回 `role=admin / status=active`。
**可逆**：`DELETE FROM app.account WHERE id = 'acc_prod_admin_01';`
**怎么算成功**：后台用该手机号 + `FIXED_SMS_CODE` 能登录并进到「数据看板」。

> ⚠️ 登录用的是**固定短信码**（无真实短信通道）。所以 `PROD_FIXED_SMS_CODE` 必须是强随机值，
> 且只存在 `.env.prod` 里。上架前要接真实短信并绑定真实手机号。

---

## ③ 起生产容器（`api-story` / `admin-story` 才会真正可访问）

**做什么**：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

**会创建**：卷 `story-prod-audio-cache` + 容器 `story-server-prod` / `story-admin-prod`。
**不会创建**新网络（已 dry-run 确认，全部引用既有 `postgres-shared` / `traefik-public`）。
**域名**：靠容器上的 traefik label 暴露 `api-story.xirizhi.cn` / `admin-story.xirizhi.cn`。
**耗时**：起容器 + healthcheck 约 30 秒。
**可逆**：`docker compose ... down`（不动数据卷）。
**怎么算成功**：

```bash
curl -s https://api-story.xirizhi.cn/api/health     # {"ok":true,"data":{"status":"ok","db":"up"}}

# 端到端 16 步（手机号用 ②b 建的那个，验证码是 .env.prod 里的 PROD_FIXED_SMS_CODE）
BASE=https://api-story.xirizhi.cn \
ADMIN_PHONE=<②b 的手机号> ADMIN_CODE=<固定码> \
node apps/server/scripts/e2e-smoke.mjs
```

---

## 执行顺序与配合方式

```
① 迁移 → 我报 status 与行数 → 你确认
② 授权 → 我验证 story_app 能读不能 DDL → 你确认
②b 建管理员 → 我确认能登录 → 你确认
③ 起容器 → 我跑 16 步冒烟与后台登录
```

每步之间我都会停下来等确认，失败就停在那一步、不再往下走。

---

## 另外两件（不阻塞上线，但迟早要定）

| 事 | 选项 | 我的建议 |
| --- | --- | --- |
| `apps/` 那 218 个文件要不要提交 | 5 个提交（方案见 [16-commit-plan.md](16-commit-plan.md)） | **要提交**。现在 `v0.1.1` tag 指向的提交里没有 App 源码，发 release 会不一致 |
| 0.1.2 发不发 | 升 `pubspec` 到 `0.1.2+3` → 出包 → 更新 sha 与 notes | 平板适配已就绪，建议发；但**必须先升版号**，否则与已发布包同 versionCode |

---

## 我不做、也不建议现在做的事

- ❌ 轮换共享 postgres 超级用户口令（会同时重启 ttrss / AI 监控 / pREST，需单独窗口，见 [15-prod-credential-rotation.md](15-prod-credential-rotation.md)）
- ❌ 用超级用户长期跑生产服务（② 就是为了不再这样）
- ❌ 在没有备份的情况下执行 ①（备份已就绪：`story-20261112-2121.dump`，且做过恢复演练）
