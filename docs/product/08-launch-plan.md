# 08 · 上线方案（老站关闭 + 生产 docker 部署 + APK release）

> ## ✅ 已恢复并执行完毕（2026-11-13）
>
> 本文档曾在 2026-11-10 暂停，**2026-11-13 已恢复执行并全部落地**：
> 生产 docker 部署已上线（`api-story` / `admin-story`）、0.1.2 release 已发布、
> 生产库迁移已应用 5 条、老站仍在线上服务。
> 执行记录见 [24-prod-deploy-20261113.md](24-prod-deploy-20261113.md)。
>
> 本文以下内容保留为**当时的方案档案**，其中「未执行」字样描述的是 11-10 时点，
> 不是现状。文中出现的 `docker-compose.m4.yml`、`scripts/m4-smoke.sh`、
> `scripts/m4-migrate-rehearsal.sh` 均已在 2026-11-13 删除，命令不可直接复制执行。

> 状态：**已执行（2026-11-13）**。下面这句是 11-10 暂停时的原始说明，保留以存史。
>
> 红线（沿用 03-decisions D7 并收紧）：生产写操作必须产品负责人**批准后**执行；
> 所有 DDL 先在演练库跑通；agent 不擅自停服务或改反代。
>
> 盘点时间：**2026-11-10 14:20–14:30 (Asia/Shanghai)**，全部命令为只读。

---

## 1. 现状盘点（只读实测）

### 1.1 ⚠️ 最重要的一条：线上老站不在 NAS 上，在 Vercel

这是本次盘点推翻的最大假设。原计划写「storynook.cn 现有静态老站停止服务」，
但实测：

```bash
$ curl -sI https://storynook.cn/ | grep -iE 'server|x-vercel|cf-cache'
server: cloudflare
x-vercel-cache: MISS
x-vercel-id: pdx1::hnd1::grt92-1794291967841-bcbea4681b6a
cf-cache-status: DYNAMIC

$ getent ahostsv4 storynook.cn
172.67.153.37   STREAM storynook.cn      # Cloudflare 回源，不是 NAS
```

结论：**`storynook.cn` = Cloudflare → Vercel（服务端渲染）**，与 NAS 无关。
NAS 上的 `story` 容器是**另一份更老的静态站**，挂在 traefik 上、域名
`story.xirizhi.cn`，且**公网访问不通**（见 1.3）。

**影响**：老站「关闭」这件事，动的不是 NAS 上的容器，而是 **Vercel 项目 +
Cloudflare DNS**。这两样 agent 都碰不到，必须人工操作。

### 1.2 线上老站与生产库的关系（已验证一致）

线上 `storynook.cn/story/N` 的数据就来自生产库 `story`，但**ID 有 +2 偏移**：

| 站点路径 | 站点标题 | 生产库 |
| --- | --- | --- |
| `/story/1` | 小老鼠打电话 | id=**3** 小老鼠打电话 |
| `/story/5` | 小胖猪哭了 | id=**7** 小胖猪哭了 |
| `/story/8` | 艾丽莎王后 | id=**10** 艾丽莎王后 |
| `/story/500` | 鸬鹚和戴胜 | id=**502** 鸬鹚和戴胜 |
| `/story/1000` | 没有鼻子的皇帝 | id=**1002** 没有鼻子的皇帝 |

```bash
$ docker exec postgres psql -U postgres -d story -tAc \
  "SELECT min(id)||' .. '||max(id)||' (count '||count(*)||')' FROM public.story_main;"
3 .. 2199 (count 2197)          # id 1、2 不存在 → 站点 N 对应库 N+2
```

**含义**：新站（M4 server）用自己的 `/api/stories/:id`，ID 就是库里的 id。
**老站 URL 与新站 URL 不是同一套编号**，SEO 与旧链接会指向不同故事 ——
迁移必须显式处理（见 §2.3 与 §4 风险 R3）。

### 1.3 生产容器清单（NAS）

| 容器 | 镜像 | 状态 | 端口 | 作用 |
| --- | --- | --- | --- | --- |
| `postgres` | postgres:16-alpine | Up 5 weeks (healthy) | **5432/tcp（未发布宿主端口）** | 生产库 `story`，28MB |
| `story` | xirizhi/story:latest | Up 5 weeks | 80/tcp（traefik 内） | 老静态站（**非** storynook.cn） |
| `story-prest` | local/prest-multidb:9070bda | Up 5 weeks | 3000/tcp | 老站 API（`story-api.xirizhi.cn`） |
| `prest-multidb` | local/prest-multidb:9070bda | Up 4 weeks (healthy) | 127.0.0.1:13001 | 多库 pREST（含 story 别名） |
| `traefik` | traefik:v3.4 | Up 5 weeks | 8880→80, 8444→443 | **真正的边缘反代** |
| `safeline-*` (8 个) | chaitin-safeline 9.4.0 | Up 5 weeks | 9543→1443 等 | WAF，公网入口 |
| `story-admin` | story-admin:m4 | Up 57min (healthy) | 0.0.0.0:**18082**→80 | M4 后台（联调栈） |
| `story-server` | story-server:m4 | Up 57min (healthy) | 0.0.0.0:**13300**→3000 | M4 API（联调栈，连 dev 库） |
| `story-api-proxy` | nginx:alpine | **Created（未启动）** | — | 早前尝试的遗留 |
| `story-admin-proxy` | nginx:alpine | Up 18 hours | 0.0.0.0:15173→80 | 早前尝试的遗留 |

### 1.4 生产数据库

```bash
$ docker inspect postgres --format '{{json .NetworkSettings.Ports}}'
{"5432/tcp":null}                 # 没有发布宿主端口
$ docker inspect postgres --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{end}}'
/vol1/1000/docker/postgres/data -> /var/lib/postgresql/data
$ docker network inspect postgres-shared --format '{{range .Containers}}{{.Name}} {{.IPAddress}}{{end}}'
lingxibi-server-1 172.32.0.2 | kan-web 172.32.0.7 | postgres 172.32.0.4
story-prest 172.32.0.6 | n8n-n8n-1 172.32.0.10 | umami 172.32.0.3
ttrss 172.32.0.5 | prest-multidb 172.32.0.11
```

* 库大小 **28MB**，`public` 恰好 4 张表：`story_main=2197` / `story_content=2197`
  / `story_category=15` / `_m1_migrations=1`；`app` schema 9 张表，**无 `audio_cache`**。
* 正文长度 78 – 38979 字符；无评论表（老站也没有评论功能，实测页面无「评论/comment」）。
* 宿主磁盘 `/vol1`：868G 总量，**可用 458G**。

### 1.5 反向代理与 TLS（真实配置，不是猜测）

边缘是 **traefik v3.4**（不是手写 nginx）：

```bash
$ docker inspect traefik --format '{{.Config.Cmd}}'
--providers.docker=true --providers.docker.exposedbydefault=false
--providers.docker.network=traefik-public --providers.file.directory=/dynamic
--entrypoints.web.address=:80 --entrypoints.websecure.address=:443
```

路由靠**容器 label** 声明，实测两个域名：

```bash
$ docker inspect story  --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' | grep traefik
traefik.http.routers.story.rule=Host(`story.xirizhi.cn`)            # entrypoints=web
traefik.http.routers.story-prest.rule=Host(`story-api.xirizhi.cn`)  # entrypoints=web
```

HTTPS 由 `/dynamic/xirizhi-websecure.yml` 镜像生成（`story-https`、
`story-prest-https` 两个 router，entryPoint=websecure，`tls: {}` 复用全局证书）。

证书（`/dynamic/tls.yml`）只有一张：

```yaml
tls:
  certificates:
    - certFile: /certs/cert_1.crt     # ← 挂载自 SafeLine
      keyFile:  /certs/cert_1.key
```

挂载源：`/vol1/1000/docker/safeLine/resources/nginx/certs/cert_1.{crt,key}`
（**该路径在本容器内不可见**，属宿主/SafeLine 侧）。`dev-https.yml` 的注释写明
它是 **SAN `*.xirizhi.cn` 通配**，覆盖 `dev`，因此也覆盖 `story` / `story-api`。

**关键推论**：现有证书是 `*.xirizhi.cn`，**不包含 `storynook.cn`**。
若新站要用 `api.storynook.cn` / `admin.storynook.cn`，**证书必须另配**
（要么加进 SafeLine，要么继续用 Cloudflare 代理 + CF 证书）。

### 1.6 DNS 现状

```bash
$ getent hosts storynook.cn
2606:4700:3037::6815:48a3        # Cloudflare
$ getent ahostsv4 storynook.cn
172.67.153.37                    # Cloudflare
$ getent hosts story.xirizhi.cn
192.168.192.25                   # traefik（内网解析）
```

* `storynook.cn` / `www.storynook.cn` → **Cloudflare**（公网，源站 Vercel）。
* `story.xirizhi.cn` / `story-api.xirizhi.cn` → **192.168.192.25**（内网 traefik）。
* `api.storynook.cn` / `admin.storynook.cn` → **无解析**（未创建）。

`story.xirizhi.cn` 公网 443 实测 `HTTP 000`（12s 超时）→ **外网访问不到**，
只有内网 + DNS 指向 traefik 时才通。

### 1.7 M4 联调栈与生产库的网络隔离

```bash
$ docker inspect story-server --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
dsh-dev_default
$ docker exec story-server sh -c 'getent hosts postgres || echo 解析不到'
(解析不到 postgres)
```

`story-server` 只在 `dsh-dev_default`，**连不到** `postgres-shared` 里的生产库，
且其 `DATABASE_URL` 指向 `story-dev-postgres/story_dev`。
**生产部署必须给它接上 `postgres-shared` 并换连接串**（§3）。

### 1.8 GitHub 仓库

```bash
$ git remote -v
origin  https://github.com/guicaiyue/story.git
$ git branch -a
* feat/platform-v2        # 本次新代码（untracked，未提交）
  main                    # 7b9d091 = 老静态站
$ git ls-remote --tags origin
(空)                      # 远端没有任何 tag
```

* `main` = 老静态站（`index.html` / `css` / `Dockerfile` + 4 个 `test-*.js`）；
  **`main` 里没有 `apps/`**（`git ls-tree` 计数 0）。
* 新代码（`apps/server`、`apps/admin`、`apps/app`、`docker-compose.m4.yml`、
  `docs/`、`scripts/`）**全部未提交**，在 `feat/platform-v2` 上。
* 已有 CI：`.github/workflows/build-image.yml`（push main 时跑 4 个 contract test
  并构建推送镜像）。
* **`gh` CLI 未安装**，无 `GITHUB_TOKEN` / `GH_*` 环境变量，无 `~/.git-credentials`。
  → **建 release 需要人工或先配置凭据**（§5）。

### 1.9 APK 现状（已有产物，但有一个必须修的缺陷）

```bash
$ ls -la releases/
-rw------- 1 root root 51201551  storynook-0.1.0.apk
$ sha256sum releases/storynook-0.1.0.apk
475e546a3cf8bcb12c20aebd0350cfa494690d178343619b85a690b1e6b9ba40
```

⚠️ **这个 APK 不能发**：从 `lib/arm64-v8a/libapp.so` 提取到的基址是

```
http://127.0.0.1:3000
```

即构建时用了 `kApiBaseUrl` 的默认值，**在真机上指向手机自己**，装上去连不上
任何服务端。发布前必须用真实域名重新构建：

```bash
flutter build apk --release --dart-define=API_BASE_URL=https://<正式 API 域名>
```

另：`apps/app/pubspec.yaml` 的 `version: 1.0.0+1` 与文件名 `0.1.0`
**不一致**，需统一（建议 tag / 文件名都用 `0.1.0`，并改 pubspec 版本号）。

---

## 2. 迁移清单

### 2.1 内容数据：**不需要迁移**

老站与生产库**读的是同一份数据**（§1.2 已逐条验证标题一致）。所以：

| 对象 | 是否需要迁 | 说明 |
| --- | --- | --- |
| `public.story_main`（2197） | ❌ 已在生产库 | 新站直接读 |
| `public.story_content`（2197） | ❌ 已在生产库 | 同上 |
| `public.story_category`（15） | ❌ 已在生产库 | 同上 |
| 老站静态 HTML 页面 | ❌ 不必迁 | 服务端渲染，非内容载体；新站自己有页面 |
| 图片（`/images/`、`/img/`） | ⚠️ **待确认** | 见下 |
| 评论 | ❌ 不存在 | 实测老站无评论功能，库里也无评论表 |
| 法务页（about/contact/disclaimer/privacy） | ⚠️ 建议保留 | 4 页均 200 在线，见 §2.4 |

**关于图片**：老站图片由 Vercel 侧提供（`/images/story.png` 实测 137KB、200）；
NAS 的 `story` 容器里是另一套（`/img/story.png`，159KB，路径不同）。
`story_main.cover_url` 目前**全为 null**（M4 盘点：`missingCover=2197`），
说明老站的图是**按约定路径拼出来的**，不是库里的字段。
→ **待产品确认**：新站封面走哪条路？（见 §6 待拍板 Q2）

### 2.2 新站需要在生产库补的东西（DDL 清单）

生产库已有 `app` schema 9 张表（`account` `audit_log` `banner` `child` `family`
`favorite` `play_event` `progress` `setting`），缺 M4 的音频缓存与 M2.1 的两项：

| 迁移 | 补什么 | 现状 | 演练状态 |
| --- | --- | --- | --- |
| `20261110000000_m4_prod_supplement` | `app.audio_cache` + `app.audio_job`；分级修正（聊斋 9+）；删重复空分类 id=2 | 生产**未应用** | dev 已应用，演练 **24/24**（2026-11-11 修脚本后实测） |
| `20261110010000_story_content_unique` | `story_content.story_id` 唯一约束（修 schema/库漂移） | 生产**未应用** | dev 已应用 |
| `20261110020000_m2_admin_status` | `app.account.status`（停用管理员用） | 生产**未应用** | dev 已应用 |

> ⚠️ 第一条含**内容安全修正**：生产库现在聊斋志异（分类 13）293 篇仍是
> `age_band='3-6'`，而产品口径是 `9+`。不修的话，3-6 首页会把这些放给孩子。
> 详见 `09-prod-migration-runbook.md`。

### 2.3 初始化数据

| 项 | 内容 | 备注 |
| --- | --- | --- |
| 管理员账号 | 至少 1 个 `role='admin'` 的 `app.account` | 用手机号 + 固定验证码登录；`FIXED_SMS_CODE` **上线前必须改** |
| 推荐位 | `app.banner` 生产为 **0 行** | 需初始化首页推荐位（或留空由后台手工加） |
| 分类排序 | `story_category.sort_id` | 老站 id=1/2 同名「睡前故事」（id=2 为 0 篇），迁移会删 id=2 |
| 老站 URL 重定向 | `/story/N` → 新站 `/api/stories/(N+2)` 或新站页面 | **必须做**，否则旧链接全断（R3） |

### 2.4 静态页与图片处置

| 资产 | 现状 | 建议 |
| --- | --- | --- |
| `index.html` / `css/` / `js/` / `live2d/` | 在 git `main` + NAS `story` 容器 | 老站下线后可归档，不必迁 |
| `/page/about.html` 等 4 页法务页 | 线上 200 | **迁到新站**或保留在 Vercel/静态托管（合规需要） |
| `BingSiteAuth.xml` / `tencent*.txt` | 站点验证文件 | 新站根目录需放一份，否则搜索平台验证失效 |
| `/images/logo/*` | Vercel 提供 | 若新站要 logo，需落到新站静态目录或对象存储 |

---

## 3. 切换步骤（含命令、耗时、验证点、失败退回）

> 全程遵守红线：**第 3 步起的每个写操作，都需要你批准后我才执行**。
> 所有 DDL 先在 `story_m4_rehearsal` 演练库跑通（`scripts/m4-migrate-rehearsal.sh`）。

### 阶段 A：准备（不碰生产，可随时做）

**A1. 演练库全量演练**（~8 min）
```bash
./scripts/m4-migrate-rehearsal.sh          # 期望 24/24（+1 项预期 warning P3005）
./scripts/m4-smoke.sh                      # 期望 8/8
```
验证点：迁移在克隆库上跑通、回滚可回到迁移前。
失败退回：无副作用，直接修脚本重跑。

**A2. 修 APK 基址并重建**（~10 min，依赖 Flutter SDK 已就绪）
```bash
cd apps/app
flutter build apk --release \
  --dart-define=API_BASE_URL=https://<正式 API 域名>
sha256sum build/app/outputs/flutter-apk/app-release.apk
```
验证点：`strings` 提取 `libapp.so` 应看到正式域名，**不再有 127.0.0.1**。
失败退回：不发布即可，无副作用。

**A3. 准备生产 compose 覆盖文件**（不启动）
新增 `docker-compose.prod.yml`（覆盖，非替换）：

```yaml
# 生产覆盖：接生产库 + 收紧绑定 + 真实密钥（走 .env，不进 git）
services:
  server:
    environment:
      # 关键：从 dsh-dev_default 换到 postgres-shared，才能连到生产 postgres
      DATABASE_URL: postgresql://<user>:<pass>@postgres:5432/story
      JWT_SECRET: ${PROD_JWT_SECRET:?set in .env}
      FIXED_SMS_CODE: ${PROD_FIXED_SMS_CODE:?must not be 123456}
    networks: [prod]
  admin:
    networks: [prod]
networks:
  prod:
    name: postgres-shared
    external: true
```

**A4. 生产库备份 + 校验可恢复性**（~1 min，**只读生产**）
```bash
docker exec postgres pg_dump -U postgres -d story \
  --format=custom --no-owner --no-privileges > /vol1/1000/story/backup/story-$(date +%F).dump
docker exec -i postgres pg_restore --list < <上面那个文件> | grep -c 'TABLE DATA'
```
验证点：dump 文件存在且 `pg_restore --list` 能解析、含 4 张表数据。
失败退回：重跑；本步不改数据。

### 阶段 B：迁移生产库（**需批准**）

**B1. 基线核对（只读）**（~30 s）
```bash
./apps/server/scripts/prod-baseline-check.sh     # 期望 14 项通过 / 3 项待补
```
验证点：无「漂移」项；3 项待补正是 §2.2 要补的。

**B2. 应用三条迁移**（~2 min，**唯一的生产 DDL 步骤**）
```bash
# 在能解析 postgres 的容器网络内执行（生产 postgres 未发布宿主端口）
docker run --rm --network postgres-shared -e DATABASE_URL=... \
  story-server:m4 node scripts/migrate.mjs
```
预期输出：`apply 20261110000000_m4_prod_supplement` /
`20261110010000_story_content_unique` / `20261110020000_m2_admin_status`。
验证点（全部只读）：
- `app` 表 9 → **11**（+audio_cache +audio_job）
- `age_band` 3-6 / 6-9 / 9+ = **721 / 1176 / 300**
- `story_category` 15 → **14**（id=2 已删）
- `story_main` 仍 **2197**（内容一分未少）
- `category_id IN (13,15,16,17) AND age_band<>'9+'` = **0**

失败退回：`pg_restore` 阶段 A4 的快照。**注意**：这会丢迁移后的增量写入，
窗口内需停止写流量。

**B3. 初始化管理员**（~1 min，**需批准**）
```bash
# 仅当生产 app.account 里没有 admin 时
docker exec postgres psql -U postgres -d story -c \
  "INSERT INTO app.account (id, phone, nickname, role, status) VALUES ('acc_admin_1','<手机号>','管理员','admin','active');"
```
验证点：能登录后台（阶段 C2）。
失败退回：`DELETE FROM app.account WHERE id='acc_admin_1';`

**B4. 老站回归**（~1 min，只读）
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://story-api.xirizhi.cn/story/public/story_main?limit=1
```
验证点：200（三张 legacy 表仍在 `public`，本次只改 `story_main.age_band` 的值）。
失败退回：迁移不动结构，老站读通道未变；若分级修正影响老站展示，按 §4 R4 处理。

### 阶段 C：新站上线（**需批准**）

**C1. 启动生产栈**（~2 min）
```bash
docker compose -f docker-compose.m4.yml -f docker-compose.prod.yml up -d
```
验证点：`story-server` 连上生产库、`/api/health` 返回 `db=up`。
失败退回：`docker compose down`，回到联调栈（dev 库），生产库未被改。

**C2. 端到端预检**（~2 min，**只读**）
```bash
./scripts/m4-smoke.sh            # 期望 8/8（注意会把 2197 当作期望值）
```
外加人工：
- 后台 `https://<admin 域名>` 用管理员登录；
- App（阶段 A2 的 APK）装真机，走「首页 → 播放 → 进度 → 收藏」。

**C3. 反代接入（**需批准，且**需先解决证书问题**）**

两条路线，二选一：

| 路线 | 做法 | 证书 | 需人工？ |
| --- | --- | --- | --- |
| **① 用 `*.xirizhi.cn`** | 给 `story-server` / `story-admin` 加 traefik label，新增 `api-story.xirizhi.cn` / `admin-story.xirizhi.cn` router | 现成通配证书，**零改动** | agent 可做（改 compose label） |
| **② 用 `*.storynook.cn`** | 在 SafeLine 加 `storynook.cn` 证书，或继续 Cloudflare 代理 | **需新证书** | 需人工（SafeLine / CF 控制台） |

验证点：`curl -sI https://<域名>/api/health` → 200。
失败退回：删掉新增的 router 文件/label（`providers.file.watch` 热加载，或
`docker compose up -d` 重建 label）。旧站路由不受影响。

**C4. 切流量 / 关老站**（**需人工**，agent 碰不到 Vercel/Cloudflare）

| 顺序 | 动作 | 谁做 | 失败退回 |
| --- | --- | --- | --- |
| 1 | 新站先在**非公开域名**验证通过（C2/C3） | agent | — |
| 2 | DNS 把 `storynook.cn` 从 Vercel 切到 NAS（或 CF 回源改 NAS） | **人工**（CF 控制台） | CF 改回原 Vercel 记录，回滚 <5 min |
| 3 | 观察 24h（错误率、播放成功率） | 人工 | 同上 |
| 4 | Vercel 项目**暂停**（不删，留退路） | **人工** | 恢复 Vercel 部署 |
| 5 | 老站静态页归档（`story` 容器可先停） | agent（**需批准**） | `docker start story` |

**建议**：第 2 步用 **Cloudflare 灰度**（先切 10% 或先切
`api-storynook` 子域），不要一次性全切。

### 阶段 D：收尾

* 监控：`/api/health` 1 分钟探测、错误日志按 code 聚合、TTS 合成成功率。
* 观察期结束后再删 Vercel 项目与老容器（**保留至少 2 周**）。

---

## 4. 风险与红线

### 4.1 红线（硬约束）

1. **生产写操作必须产品负责人批准后由 agent 执行**；本文档 §3 标注「需批准」
   的每一步，执行前单独确认。
2. **所有 DDL 先在演练库跑通**（`m4-migrate-rehearsal.sh` **24/24**），才允许进生产。
3. **备份未验证可恢复前，不得执行 B2**。
4. **不得由 agent 改 DNS / 停 Vercel / 改 SafeLine 证书**（无凭据、且属平台操作）。
5. 生产库只读红线（D7）在**批准的维护窗口内**临时放宽为「只允许 §3 B2/B3 的
   写操作」，窗口结束立即恢复。

### 4.2 风险清单

| # | 风险 | 影响 | 缓解 | 退回 |
| --- | --- | --- | --- | --- |
| R1 | **`storynook.cn` 在 Vercel 上**，与 NAS 无关 | 「关老站」不是停容器，而是停 Vercel | 已在本盘点澄清；切换需人工 | CF DNS 改回 |
| R2 | 证书只有 `*.xirizhi.cn` | `api.storynook.cn` 无法直接上 | 走路线①（复用通配）或先申请证书 | 不切域名 |
| R3 | **老站 ID 与新站 ID 差 2** | 2197 条旧链接全断，SEO 掉 | 新站加 `/story/:n →/:n+2` 重定向；或保留旧路由 | 保留 Vercel 一段时间 |
| R4 | 分级修正（聊斋 9+）改变老站展示 | 老站可能少 293 篇入口 | B4 回归；必要时老站单独容忍 | 改回（但**回滚分级=内容安全回退**，见 09 §6.2） |
| R5 | `FIXED_SMS_CODE=123456` 若带到生产 | **任何人可登录后台** | A3 强制 `.env` 注入且非默认值 | 立刻改并重签 token |
| R6 | 音频缓存卷是命名卷 | 生产换机/重建丢缓存 | 可重新 TTS 合成（派生数据）；必要时改宿主卷 | 重新合成 |
| R7 | 生产 postgres 无宿主端口 | 不能在宿主直跑迁移 | 走 `--network postgres-shared` 容器内执行 | — |
| R8 | 现有 APK 基址是 `127.0.0.1` | 装上去完全不可用 | A2 重建 + 校验 `libapp.so` | 不发 release |
| R9 | `pubspec` 1.0.0 与文件名 0.1.0 不一致 | 版本混乱 | 统一为 0.1.0 | — |
| R10 | 生产 `app.banner` 为 0 | 首页推荐位空白 | B3 后初始化，或后台手工加 | 无影响 |
| R11 | Vercel 侧另有静态资源（images/） | 新站缺图 | §2.1 待确认；先保留 Vercel 静态 | 保留 Vercel |

---

## 5. GitHub release 步骤

### 5.0 前置（当前**不满足**）

```bash
$ which gh                 # 无输出 → 未安装
$ env | grep -i '^GH'      # 无输出 → 无 token
$ cat ~/.git-credentials   # 无文件
```

→ **建 release 需要先二选一**：
- 人工在 GitHub 网页建（最快，推荐首次）；
- 或安装 `gh` 并提供 token（对「后续版本自动化」更有价值）。

### 5.1 tag 命名

约定 **`v<semver>`**，与 APK 文件名解耦：

| 用途 | 名字 |
| --- | --- |
| git tag | `v0.1.0` |
| Release 标题 | `小故事铺 0.1.0（内测）` |
| APK 资产名 | `storynook-0.1.0.apk` |

> 远端当前**没有任何 tag**（`git ls-remote --tags` 为空），所以 `v0.1.0` 可用。

### 5.2 release notes 模板

```markdown
## 小故事铺 0.1.0（内测）

首个内测版本：儿童故事 App + 后台管理 + 音频自动合成。

### 功能
- 首页按年龄档推荐（3-6 / 6-9 / 9+），9+ 内容不进儿童端
- 故事播放（服务端 TTS 合成，支持拖动与续播）
- 收藏、播放进度、家长设置（时长/睡眠定时/年龄档）

### 安装
1. 下载 `storynook-0.1.0.apk`
2. Android 设置里允许「安装未知来源应用」
3. 安装后打开即可，无需注册（游客身份）

### 校验
- SHA-256：`<填入 sha256sum 输出>`
- 支持架构：arm64-v8a、armeabi-v7a

### 已知限制
- 仅内测，未上架应用商店
- 音频首次播放需实时合成，约 3–10 秒
```

### 5.3 上传与校验

```bash
# 1) 确认工作区干净、版本一致（pubspec 改 0.1.0 后）
grep '^version:' apps/app/pubspec.yaml           # 期望 0.1.0+1

# 2) 打 tag（需批准；当前分支 feat/platform-v2 需先合入 main 或直接打）
git tag -a v0.1.0 -m "小故事铺 0.1.0"
git push origin v0.1.0

# 3) 生成校验和
sha256sum releases/storynook-0.1.0.apk | tee releases/storynook-0.1.0.apk.sha256

# 4) 建 release 并上传（人工网页，或 gh 配置后）
gh release create v0.1.0 \
  releases/storynook-0.1.0.apk \
  releases/storynook-0.1.0.apk.sha256 \
  --title "小故事铺 0.1.0（内测）" \
  --notes-file docs/product/release-notes-0.1.0.md
```

### 5.4 后续版本：tag 自动构建

新增 `.github/workflows/release-apk.yml`（**待建，本次不落盘**）：

```yaml
name: Release APK
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.47.9' }
      - run: |
          cd apps/app
          flutter pub get
          flutter build apk --release \
            --dart-define=API_BASE_URL=${{ vars.API_BASE_URL }}
      - run: sha256sum build/app/outputs/flutter-apk/app-release.apk
      - uses: softprops/action-gh-release@v2
        with:
          files: apps/app/build/app/outputs/flutter-apk/app-release.apk
```

要点：
- `API_BASE_URL` 放 **repository variable**（`vars.`），不硬编码进仓库；
- tag 即版本，`pubspec` 的 `version` 建议用 tag 校验（不一致就失败）；
- 签名：内测可用 debug 签名；**上架前必须换 release keystore 并妥善保管**。

---

## 6. 需要你拍板（阻塞后续执行）

| # | 问题 | 建议 |
| --- | --- | --- |
| Q1 | **API / 后台域名用哪套？** `api-story.xirizhi.cn`（现成证书，今天能用）还是 `api.storynook.cn`（需新证书） | 内测先用 `*.xirizhi.cn`，公开前再迁 `storynook.cn` |
| Q2 | **封面图怎么办？** 新站没有图片资源，`cover_url` 全空 | 先留空/用占位图；或把 Vercel 的 `/images/` 同步过来 |
| Q3 | **老站 URL 重定向做不做？** 差 2 的 ID 偏移会让 2197 条旧链接断掉 | 建议做 `/story/N → /story/N+2` 重定向 |
| Q4 | **法务 4 页迁到新站还是留在静态托管？** | 建议迁到新站（合规、单点维护） |
| Q5 | **迁移窗口时间？** B2 期间需停写 | 建议夜间，窗口 30 分钟内可完成 |
| Q6 | **GitHub release 由谁建？** 当前无 `gh`、无 token | 首次人工网页建，之后配 token 走自动化 |
| Q7 | **是否授权 agent 执行 B2/B3（生产 DDL）？** 红线要求逐项批准 | 建议：先批准 B1（只读），B2/B3 在窗口内单独确认 |

---

## 7. 与其它文档的关系

| 文档 | 关系 |
| --- | --- |
| `07-m4-plan.md` §4 | 迁移工具口径（老库用 `migrate.mjs`） |
| `10-prod-migration-baseline.md` | 生产 M1 冻结基线 + 核对 SQL + 回滚不适用 |
| `09-prod-migration-runbook.md` | 迁移缺口清单、执行顺序、验收、回滚分档 |
| **本文档** | 上线三件事的总方案（含 Vercel 这一关键澄清） |

---

## 8. 产品负责人拍板（2026-11-11，恢复产品化）

> 由产品负责人（Lead）逐项决定 §6 的 Q1–Q7，作为恢复执行的依据。

| # | 决策 | 说明 |
| --- | --- | --- |
| Q1 | **内测用 `api-story.xirizhi.cn` / `admin-story.xirizhi.cn`**（现成证书），公开前再迁 `*.storynook.cn` | 今天可用，不阻塞内测 |
| Q2 | **封面图先占位**：统一生成一张品牌占位图；不阻塞上线，后续从 Vercel `/images/` 批量同步 | 避免因图片卡住 |
| Q3 | **做重定向**：`/story/N → /story/N+2`（301，在边缘/反代做），并把 2197 条旧链接映射表落盘 | 保护老站存量流量 |
| Q4 | **法务 4 页迁到新站**（合规单点维护） | 统一入口 |
| Q5 | **迁移窗口：夜间 02:00–03:00（Asia/Shanghai）**，目标 30 分钟内完成，超时回滚 | 低峰期 |
| Q6 | **首次 GitHub release 人工网页创建**（附 APK + sha256 + 安装说明），之后配 token 走自动化 | 当前无 gh/token |
| Q7 | **批准 B1（只读核对）**；**B2/B3（生产 DDL）在窗口内逐项批准后执行**，每步我先看 SQL 与影响 | 严守红线 D7 |

### 恢复后的执行顺序（只做 agent 能做的部分）
1. APK 用真实 API 地址重建（`api-story.xirizhi.cn`）+ 版本号/签名确认 → 发布候选；
2. 生产 docker 部署：prod compose（server + admin + 反代），复用现有证书；**不动生产库**；
3. 产出「Vercel 关闭 + Cloudflare DNS + 重定向」的人工操作清单（agent 不碰这两处）；
4. 法务 4 页迁入新站；
5. 迁移演练复跑 + 窗口执行清单（B2/B3 逐项待批）。
