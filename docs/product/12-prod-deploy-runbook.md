# 12 · 生产 docker 部署 runbook（方案，未执行）

> 状态：**方案已落盘，未执行任何启动 / 未写生产库**（2026-11-11）。
> 配套文件：`docker-compose.prod.yml`、`.env.prod.example`、
> `docker/nginx/story-prod.conf`（可选）。
>
> 红线：生产库只读（DDL 待批准）、不碰 Vercel/Cloudflare、不 push main。
> **本 runbook 中标注「需批准」的步骤，执行前逐项确认。**

---

## 1. 这次要解决什么

`08-launch-plan.md` §8 恢复顺序的**第 2 项**：把 M4 的 server + admin 从「联调栈
（dev 库、绑 0.0.0.0:13300/18082）」变成「生产形态（连生产库、经 traefik 走
`api-story.xirizhi.cn` / `admin-story.xirizhi.cn`、不暴露调试端口）」。

**本轮只出方案与校验，不启动、不碰生产库。**

---

## 2. 文件清单（本轮新增）

| 文件 | 作用 |
| --- | --- |
| `docker-compose.prod.yml` | 生产编排：server + admin +（可选）nginx 反代 |
| `.env.prod.example` | 环境变量模板（无真实密钥，**要提交**） |
| `docker/nginx/story-prod.conf` | **可选** nginx 反代样例（默认不启用） |
| `docs/product/12-prod-deploy-runbook.md` | 本文件 |
| `.gitignore` | 加 `.env.prod` / `.env.prod.*`（防密钥进仓库） |

**为什么是独立文件而不是覆盖 `docker-compose.m4.yml`**（08 §A3 原方案是覆盖）：

1. m4 写死了 `container_name: story-server` / `story-admin`，与联调栈同名 → 覆盖时无法并存；
2. m4 发布宿主机端口 `13300`/`18082` 且绑 `0.0.0.0`，生产不该再暴露调试端口；
3. m4 的 `DATABASE_URL` 指向 dev 库，覆盖时漏改一项就连错库 —— 独立文件更安全。

---

## 3. ⚠️ 关键澄清：「生产库只读连接串」这个要求需要修正

任务要求「数据库用生产库**只读**连接串（示例）」。**直接照做会让新站完全不可用** ——
这不是猜测，是从代码里读出来的：

| 时机 | 操作 | 位置 | 只读会怎样 |
| --- | --- | --- | --- |
| **App 每次冷启动** | `POST /api/auth/register-device` → `account.create` | `auth-service.ts:34` | ❌ 建游客账号失败 → 无 token |
| App 读设置 | `GET /api/settings` → `setting.upsert`（**upsert 含写**） | `user-service.ts:57` | ❌ 首次无记录时插入失败 |
| 播放进度 | `PUT /api/progress/:id` → `progress.upsert` | `play-service.ts:13` | ❌ |
| 收藏 | `POST /api/favorites/:id` | 同族 | ❌ |
| 首次播放音频 | `audioCache.upsert` + `story_main` 回填时长 | `tts-service.ts:171` | ❌ |
| 播放埋点 | `POST /api/plays` | 同族 | ❌ |

**结论**：生产 server 必须能写 `app.*`（外加 TTS 回填写 `public.story_main.duration_sec`）。
`GET /api/health` 也能过（只 `SELECT 1`），所以「健康检查绿灯」**不能**证明可用 ——
这正是 04-dev-log §19 那条教训的反面形态。

**所以给两个口径（二选一，都要你拍板）：**

### A) 专用生产账号（推荐）
建一个只有必要权限的账号（**此 DDL/GRANT 属生产写操作，需你批准**）：

```sql
-- ⚠️ 需批准；建议在演练库先跑一遍
CREATE ROLE story_app LOGIN PASSWORD '<强随机>';
GRANT CONNECT ON DATABASE story TO story_app;
GRANT USAGE ON SCHEMA public, app TO story_app;
-- 读：内容表
GRANT SELECT ON ALL TABLES IN SCHEMA public TO story_app;
-- 写：只给 app 业务表（不含 audit_log 的删改等）
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO story_app;
-- TTS 回填时长需要它
GRANT UPDATE (duration_sec) ON public.story_main TO story_app;
-- 将来新建表也继承
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO story_app;
```

连接串：`postgresql://story_app:<pass>@postgres:5432/story`

### B) 内测应急：暂用 `postgres` 超级用户
`postgresql://postgres:<pass>@postgres:5432/story`

**风险**：server 进程拥有整个库的完全权限，一旦被利用影响面大（风险 P3）。
内测可用，**公开前必须换 A**。

> 说明：任务里的「只读」在**开发/巡检脚本**语境下是对的（`prod-baseline-check.sh`
> 就是严格只读：`PGOPTIONS=-c default_transaction_read_only=on` + 建表自检）。
> 本 runbook 把「只读」严格限定在**巡检**用途，生产 server 不适用。

---

## 4. 域名与边缘（复用现有证书，零证书改动）

08 §1.5 已澄清：本机边缘是 **Traefik v3.4**（不是手写 nginx），路由靠容器 label。

已实测的真实形态：

```
traefik:        traefik-public (192.168.192.25)
postgres:       postgres-shared (172.32.0.4)
story-server:   dsh-dev_default          ← 联调栈，**连不到**生产库
trace: traefik --providers.docker.network=traefik-public
```

新增两条 label 路由（`docker-compose.prod.yml` 已写好）：

| 域名 | → 容器 | 证书 |
| --- | --- | --- |
| `api-story.xirizhi.cn` | `story-server-prod:3000` | 复用 `cert_1`（SAN `*.xirizhi.cn`） |
| `admin-story.xirizhi.cn` | `story-admin-prod:80` | 同上 |

**为什么走 label 而不是改 `/dynamic/*.yml`**：label 随容器生命周期自动增删，
回滚 = `docker compose down`；改 dynamic 文件要碰宿主 `/vol1/1000/docker/traefik/dynamic`
（本容器不可见，且属边缘配置）。这是 08 §C3 路线①。

---

## 5. 执行步骤（含批准标注）

### 步骤 0 · 校验（**已做，无需批准**）
见 §7 实测结果。

### 步骤 0.5 · 跑一遍部署前自检（**无需批准**）

```bash
./scripts/preflight.sh          # 迁移状态 + 三端测试（约 80s，只读）
./scripts/preflight.sh --e2e    # 再加端到端冒烟（临时起容器，连副本库）
```

一条命令回答「现在能不能上」，逐项 PASS/WARN/FAIL，最后给结论。实测输出：

```
PASS   迁移状态（story_m12_rehearsal） 全部已应用（5 个）
PASS   服务端测试              Tests  136 passed
PASS   后台测试                 Tests  63 passed
PASS   App 静态检查             No issues found
PASS   App 测试                   +85: All tests passed
PASS   端到端冒烟              合计 16 项，失败 0
```

约定：
- `TARGET_DB`（默认 `story_m12_rehearsal`）决定查哪个库的迁移账本；
- `--e2e` 用 `E2E_DB`（默认 `story_e2e_seed`，带管理员种子）跑 16 步；
  库不存在就标 SKIP，没有管理员账号则只跑 App 段（12 步）并注明；
- 有 FAIL 时退出码 1，日志在 `/tmp/preflight-*.log`。

### 步骤 1 · 准备生产环境变量（**无需批准，属本地文件**）

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
# 填 PROD_DATABASE_URL / PROD_JWT_SECRET / PROD_FIXED_SMS_CODE
# JWT:  openssl rand -base64 48
```

验证点：`docker compose --env-file .env.prod -f docker-compose.prod.yml config >/dev/null`
能通过（缺变量会在这里就报错）。

### 步骤 2 · 备份生产库（**只读，无需批准但必须做**）
08 §A4。**步骤 3 起若出问题，这是唯一退路。**

```bash
docker exec postgres pg_dump -U postgres -d story --format=custom \
  --no-owner --no-privileges > /vol1/1000/story/backup/story-$(date +%F).dump
docker exec -i postgres pg_restore --list < <上面文件> | grep -c 'TABLE DATA'
```

### 步骤 3 · 🔴 建生产库账号 / 补缺失表（**需批准 —— 生产 DDL，本轮不做**）

**两个独立的缺口**（实测，见 §7）：

| 缺口 | 现状 | 不补会怎样 |
| --- | --- | --- |
| `app.audio_cache` / `app.audio_job` **不存在** | 生产 `app` 只有 9 张表 | **音频接口 500**：`tts-service.ts:125` 直接 `db.audioCache.findUnique` → 表不存在报错 |
| `app.account.status` 列**不存在** | 生产 account 只有 5 列（无 status） | **后台管理员管理 500**：`admin-routes.ts:376` 明确 `select status` |

对应迁移（已存在，**生产未应用**，08 §2.2）：

```
20261110000000_m4_prod_supplement   # audio_cache + audio_job + 分级修正 + 删空分类
20261110010000_story_content_unique # story_content.story_id 唯一约束
20261110020000_m2_admin_status      # app.account.status
```

**待你批准的执行方式**（不在本轮）：

```bash
# 先在演练库跑通（08 §A1，期望 24/24；+1 项预期 warning P3005）
./scripts/m4-migrate-rehearsal.sh && ./scripts/m4-smoke.sh
# 再在生产执行（唯一的生产 DDL 步骤）
docker run --rm --network postgres-shared -e DATABASE_URL=<生产串> \
  story-server:m4 node scripts/migrate.mjs
```

> ⚠️ 第一条含**内容安全修正**（聊斋 293 篇 3-6 → 9+），见 09-runbook 与 08 §2.2。
> ⚠️ 生产 `app.account` 的 status 缺失**说明生产后台的管理员管理功能现在是坏的** ——
> 这点在 08 里没写明，属本轮新发现。

### 步骤 4 · 🟠 启动生产栈（**需批准**）

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

验证点：
- `story-server-prod` 健康（`healthy`）；
- 容器内 `wget -qO- http://127.0.0.1:3000/api/health` → `db=up`；
- **`db=up` 不等于可用** —— 必须再打一次真实写路径（见步骤 5）。

### 步骤 5 · 端到端预检（**只读，无需批准**）

```bash
# 1) 走真实域名（内网解析到 traefik）
curl -s -o /dev/null -w '%{http_code}\n' https://api-story.xirizhi.cn/api/health   # 期望 200

# 2) 验「写路径真的通」—— 只读账号/权限问题会在这里暴露，健康检查发现不了
curl -s -X POST https://api-story.xirizhi.cn/api/auth/register-device \
  -H 'Content-Type: application/json' -d '{}' | head -c 200

# 3) 首页（App 的第一个真实请求）
curl -s 'https://api-story.xirizhi.cn/api/home?ageBand=3-6' | head -c 300

# 4) 后台
curl -s -o /dev/null -w '%{http_code}\n' https://admin-story.xirizhi.cn/healthz    # 期望 200
```

### 步骤 6 · 老站回归（**只读，无需批准**）

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://story-api.xirizhi.cn/story/public/story_main?limit=1     # 期望 200
```

新增 router 只加 `api-story` / `admin-story` 两个 Host，老站 `story` /
`story-api` 路由不受影响。

---

## 6. 回滚

| 场景 | 命令 | 影响 |
| --- | --- | --- |
| 生产栈起不来 / 配错 | `docker compose --env-file .env.prod -f docker-compose.prod.yml down` | 只删新容器 + 新网络引用；**不动生产库**、不动老站 |
| 只想摘掉域名 | `docker compose ... stop server admin` | traefik label 随之失效，域名 404；老站不受影响 |
| 迁移后要退 | 用步骤 2 的 dump `pg_restore` | ⚠️ 丢迁移后增量写入，需停写窗口（08 §B2 说明） |
| 音频缓存卷 | `docker volume rm story-prod-audio-cache` | 可再生（重新 TTS），无数据损失 |

**关键**：新栈用**独立容器名**（`story-server-prod` / `story-admin-prod`）
与独立卷（`story-prod-audio-cache`），与联调栈、老站完全不冲突 ——
所以回滚是「删掉新东西」，不会波及既有服务。

---

## 7. 本地 dry-run 实测结果（本轮已做）

**只跑 `compose config` 校验，未启动任何容器、未连生产库。**

```bash
$ docker compose version
Docker Compose version v2.40.3

$ docker compose --env-file .env.prod.example -f docker-compose.prod.yml config --quiet
（通过，无输出 = 语法与变量插值均正确）
```

> 用 `.env.prod.example` 当 `--env-file` 是为了让 dry-run 不依赖真实的
> `.env.prod`（本轮不该也不需要创建它）。

### 本轮只读盘点结论（全部为只读查询）

| 项 | 实测 | 含义 |
| --- | --- | --- |
| 边缘 | traefik v3.4，`--providers.docker.network=traefik-public` | 走 label，不是 nginx |
| 证书 | `cert_1`：CN `xirizhi.cn`，**SAN `*.xirizhi.cn`** | ✅ 覆盖 `api-story` / `admin-story` |
| ⏰ 证书到期 | `notAfter = 2026-11-13 18:02:55 GMT` | 🔴 **距今约 2 天**，见风险 P1 |
| 生产 `app` 表 | 9 张（含 account/banner/...），**无 audio_cache/audio_job** | 🔴 音频接口会 500 |
| 生产 `account` 列 | id / phone / nickname / role / created_at，**无 status** | 🔴 后台管理员管理会 500 |
| `story_content` 约束 | 只有 pkey + fkey，**无 story_id 唯一约束** | 🟡 迁移 2 待补（schema 漂移） |
| 生产 stories | `story_main` = 2197 | ✅ 与基线一致 |
| 网络 | `postgres-shared` 与 `traefik-public` 均已存在 | ✅ external 引用有效 |

---

### 7.1 追加实测（2026-11-12，`up` 之前能做的都做完了）

本轮把「不需要批准」的部分全部验证完，结论：**镜像能跑、编排能起、只差两个批准项。**

| # | 动作 | 结果 |
| --- | --- | --- |
| 1 | 生成 `.env.prod`（0600，本机文件，runbook 步骤 1） | ✅ `PROD_JWT_SECRET`=openssl 48B、`PROD_FIXED_SMS_CODE`=随机 8 位（**不是 123456**）；`PROD_DATABASE_URL` 留 `story_app:CHANGE_ME` 占位，等授权 |
| 2 | `compose --env-file .env.prod -f docker-compose.prod.yml config --quiet` | ✅ 通过 |
| 3 | 外部网络实查 | ✅ `postgres-shared`、`traefik-public` 都存在；traefik 容器确实挂在 `traefik-public` |
| 4 | 镜像与源码一致性 | ✅ `apps/server/src`、`apps/admin/src` 自镜像构建时间（11-10 13:16）后**未改过**，`story-server:m4` / `story-admin:m4` 是当前源码 |
| 5 | **生产模式启服务**（`story-server:m4`，NODE_ENV=production，连 **dev 库**，临时容器，已删） | ✅ `/api/health` 200；`/api/stories`、`/api/categories` 200 且返回真实数据 |
| 6 | **后台镜像 + 反代**（`story-admin:m4` + server，临时容器，已删） | ✅ `/` 200；`/api/health` 经 nginx 反代 200（`db:"up"`）；`/api/stories` 200；SPA 深链 `/stories` 200 |
| 7 | `compose --dry-run up -d` | ✅ 计划只有：建卷 `story-prod-audio-cache` + 起 `story-server-prod` / `story-admin-prod`（含 healthcheck 等待）；**不新建网络** |

> ⚠️ 第 7 条要记住的原因：这台机器 `docker network create` 已报
> 「all predefined address pools have been fully subnetted」（地址池耗尽）。
> 生产编排**恰好不需要新网络**（全部引用既有 external），所以不受影响；
> 但以后任何要新建 bridge 网络的 compose 都会起不来，先记在这里。

**仍然必须由产品负责人批准的两项（本轮没有做，也不该做）：**

1. 生产库 M1 迁移 + `story_app` 授权（§7 表里那三行 🔴：缺 `audio_cache`/`audio_job`、
   `account` 缺 `status`、`story_content` 缺唯一约束）——属于生产库写操作，逐条批准；
2. `docker compose ... up -d`（起在 traefik-public 上，域名会被真正路由）。

### 7.2 生产迁移彩排（2026-11-12，**在生产数据的副本上**做的，生产库只被读过）

生产库当前只应用了 1 个迁移，还有 4 个 pending —— 这就是 §7 表里那三行 🔴 的来源。
彩排步骤与结果：

| # | 动作 | 结果 |
| --- | --- | --- |
| 1 | 生产库只读导出（`pg_dump`），灌进 dev 实例上的 `story_m12_rehearsal` | ✅ 基线一致：`story_main=2197`、`story_category=15`、`app` 表 9 张、账本 1 条 |
| 2 | `node scripts/migrate.mjs --status` | ✅ 列出 4 个 pending |
| 3 | `node scripts/migrate.mjs`（按序执行 4 个） | ✅ `audio_cache` → `m4_prod_supplement` → `story_content_unique` → `m2_admin_status`，账本记到 5/5，写 baseline |
| 4 | 迁移后结构 | ✅ `app` 表 9→**11**（新增 `audio_cache`、`audio_job`）；`account.status` 就位；`story_content(story_id)` 唯一约束就位 |
| 5 | 迁移后数据 | ✅ `story_main=2197` 不变；孤儿引用 0 |
| 6 | ⚠️ 唯一的数据变化 | `story_category` 15→**14**：迁移有意删除 `id=2`「睡前故事」这个**空重复分类**（生产上 `category_id=2` 的故事数为 **0**，SQL 见 `m4_prod_supplement/migration.sql:96`）。不是丢数据 |
| 7 | 用**生产镜像**连迁移后的库跑功能 | ✅ `/api/health` `db:up`；`/api/stories`、`/api/categories`、`/api/stories/8`、`/api/stories/8/audio` 全 200（音频接口在缺表时本来会 500）；`POST /api/auth/register-device` 200 并返回 JWT —— **写路径通**，说明 `account.status` 这类新列已生效 |

**结论：4 个迁移在真实生产数据上是安全的、可重复的（幂等），唯一副作用是删掉那个空重复分类。**
执行到生产仍属生产库写操作，**需要产品负责人逐条批准**（runbook §5 步骤 3 起）。

彩排库 `story_m12_rehearsal` 保留在 dev 实例上（28MB），部署当天可直接对照。

### 7.3 端到端冒烟（2026-11-12，生产镜像 + 生产数据副本，**16/16 通过**）

前面的验证都是单项。这一步回答的是「这么上线，App 到底能不能用」：
用 `story-server:m4` 连**生产数据的副本**（`story_e2e_seed` = 迁移彩排库 + 开发种子），
按 App 的真实顺序走一遍，再看后台。

```bash
# 服务
docker run -d --name smoke-e2e --network dsh-dev_default -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://storydev:***@story-dev-postgres:5432/story_e2e_seed \
  -e JWT_SECRET=... -e FIXED_SMS_CODE=87654321 story-server:m4
# 冒烟（脚本已入库：apps/server/scripts/e2e-smoke.mjs）
BASE=http://smoke-e2e:3000 ADMIN_CODE=87654321 node apps/server/scripts/e2e-smoke.mjs
```

| # | 步骤 | 结果 |
| --- | --- | --- |
| 1–5 | 注册游客设备 → 首页聚合 → 分类 → 故事列表 → 故事详情 | ✅ 200 |
| 6–8 | 播放上报（event=start）→ 写阅读进度 → 读回进度 | ✅ 200 |
| 9–11 | 收藏 → 收藏列表 → 我的信息 | ✅ 200 |
| 12 | **音频**（`/api/stories/:id/audio`，真实内容 + TTS） | ✅ 200 |
| 13–16 | 后台固定码登录 → 仪表盘 → 故事列表 → 分析概览 | ✅ 200 |

**不只看状态码，还查了落库**（这才是「真能用」）：

```
favorite=2   progress=20   play_event=2357→2359   audio_cache=1   accounts=6
```

`audio_cache=1` 说明音频接口不只是返回 200，而是真的合成并缓存了 MP3——这正是缺迁移时会 500 的那个接口。

脚本留在 `apps/server/scripts/e2e-smoke.mjs`，以后每次部署前跑一遍即可（不需要生产库，连副本即可）。

### 7.4 生产备份与恢复演练（2026-11-12，**备份是真备份，恢复是真恢复**）

上线前必须有一条「出事了能退回去」的路。本轮做了完整的一次：

| 步骤 | 结果 |
| --- | --- |
| `pg_dump -Fc --no-owner --no-privileges` 导出生产 `story` | ✅ `/vol1/1000/story/backup/story-20261112-2121.dump`，**4.2 MB** |
| `pg_restore --list` 清点 | ✅ 13 张表带数据 |
| **恢复演练**：恢复到 dev 实例的临时库 `story_restore_drill` | ✅ 无错误 |
| 校验行数 | ✅ `story_main=2197`、`categories=15`、`app` 表 9 张 —— 与生产逐项一致 |
| 清理 | ✅ 演练库已删，生产库全程只被读 |

意义：**这份 dump 被证明是可恢复的**，不是「生成成功就算数」。
真出问题时命令是：

```bash
docker exec -i postgres pg_restore -U postgres -d story --clean --if-exists --no-owner \
  < /vol1/1000/story/backup/story-20261112-2121.dump
```

（`--clean` 会先删对象再建；只有确认要回滚到这一刻时才用。）

## 8. 风险与待你拍板

| # | 风险 / 问题 | 说明 | 建议 |
| --- | --- | --- | --- |
| **P1** | 🔴 **证书 2026-11-13 到期（约 2 天后）** | `cert_1` 是 `*.xirizhi.cn` 通配；到期后新域名与**所有** `*.xirizhi.cn` 站一起失效 | 续期属 SafeLine/宿主侧（agent 碰不到，08 §1.5）。**建议先续证书再切域名**，或接受内测期内短暂失效 |
| **P2** | 🔴 **生产库缺 audio_cache** | 音频接口直接 500。App 主功能是播放 → 不补等于不能听 | 步骤 3 迁移（需批准） |
| **P3** | 🟠 **连接串权限口径** | 「只读」不可用；用 postgres 超级用户则权限过大 | 选 §3 A 或 B；**建议 A** |
| **P4** | 🟠 **`FIXED_SMS_CODE` 弱值** | 123456 = 任何人可登录后台（08 §4.2 R5） | `.env.prod` 用长随机值（compose 已强制必填） |
| **P5** | 🟡 **生产 `app.banner` 为 0 行** | 首页推荐位空白（08 §2.3 R10） | 不阻塞；可后台手工加 |
| **P6** | 🟡 **封面图全空** | 08 §8 Q2 决定「先占位」 | 不阻塞 |
| **P7** | 🟡 **老站 ID 差 2 重定向未做** | 08 §8 Q3 决定要做，属第 3 项 | 本项不含 |

### 需要你批准的步骤（汇总）

| # | 步骤 | 类型 | 本轮是否执行 |
| --- | --- | --- | --- |
| 3-a | 建 `story_app` 账号 + GRANT（§3 A） | 生产写 | ❌ 待批准 |
| 3-b | 在演练库跑 `m4-migrate-rehearsal.sh` | 只碰演练库 | ❌ |
| 3-c | 生产执行 3 条迁移（含聊斋分级修正） | **生产 DDL** | ❌ 待批准 |
| 4 | `up -d` 启动生产栈 | 启动容器 | ❌ 待批准 |
| — | 续 `*.xirizhi.cn` 证书 | 平台操作 | ❌ 需人工（agent 无凭据） |

**现在不需要你批准、也还没做的事**：建 `.env.prod`（含真实密钥）、备份 dump、
起任何容器、任何生产 DDL。

---

## 9. 与其它文档的关系

| 文档 | 关系 |
| --- | --- |
| `08-launch-plan.md` §8 | 本项是恢复顺序第 2 项；§1.5/§C3 是本文件网络与证书的依据 |
| `09-prod-migration-runbook.md` | 步骤 3 的迁移细节与验收、回滚分档 |
| `10-prod-migration-baseline.md` | M1 冻结基线；`prod-baseline-check.sh` 的来源 |
| `03-decisions.md` D7 | 生产只读红线（本文件 §3 说明其适用范围） |
| **本文件** | 生产部署的编排、启动、健康检查、回滚 |
