# 小故事铺 · 交付链（改一行代码 → 生产生效）技术审计

> 审计人：infra-analyst（技术审计组 · 工程化/交付链）
> 时间：2026-11-14
> 方式：**纯静态阅读**。未执行 `prod-deploy.sh`、未跑 `docker`、未构建、未 SSH NAS。
> 标注约定：**【事实】** = 仓库里能指到行号的东西；**【建议】** = 我的改造意见；**「暂缺」** = 仓库内无证据，需人工确认。
> 所有路径相对仓库根 `/home/xirizhi/Projects/story`。

---

## 1. 交付链路真相：一次上线到底经过什么

### 1.1 现状流程图（事实）

```
[人] 改 apps/** 代码
  │
  ├─(可选) [人] docker exec dsh-dev ./scripts/preflight.sh         ← 手动，可跳过
  │        └ 迁移账本(dev库) + 136 服务端测试 + 63 后台测试
  │
  ├─ [人] git push main → GitHub Actions ci.yml
  │        └ 只跑：pnpm install + server typecheck + admin typecheck + admin test（63）
  │        └ ✗ 不构建镜像、不打 tag、不部署、不跑服务端测试（ci.yml:7-9, 46-53）
  │
  └─(真正的上线) [人] 在 NAS 上，按顺序手敲 prod-deploy.sh 的子命令：
       status → backup → build → migrate → up → smoke
       （grants / admin 另跑；all = backup→build→migrate→up→smoke，prod-deploy.sh:180）
```

### 1.2 逐段责任与失败后果（事实）

| # | 动作 | 谁执行 | 失败会怎样 | 回滚路径 |
| --- | --- | --- | --- | --- |
| 1 | `preflight.sh` | 人（dev 容器内） | 只打印 FAIL，退出码 1，**不阻止**后面任何步骤；也可完全不跑 | 不适用 |
| 2 | `push main` | 人 | CI 红，但**生产照旧**；红线只覆盖 typecheck + 后台 63 测试 | 不适用 |
| 3 | `backup` | 人 | `pg_dump` 失败 → `set -e` 停（prod-deploy.sh:55-66）。备份落 `/vol1/1000/story/backup`（:32），**与库同机** | — |
| 4 | `build` | 人 | `docker build` 失败 → 停。同时打 `:m4` 与 `:prod-0.1.2`（:70-77） | 上一次镜像已被**同一 tag 覆盖**，无 registry、无 digest 记录 |
| 5 | `migrate` | 人（需 `DATABASE_URL` 超级用户） | 逐语句执行、**无事务**（migrate.mjs:184-207 + split-sql.mjs:40 剥离 BEGIN/COMMIT）→ 可停在半迁移状态，且账本不写 | 无 down 迁移，只能整库 `pg_restore --clean`（丢增量） |
| 6 | `up` | 人 | `config` 校验 → `up -d` → `sleep 15` → 只 `grep` 容器名（prod-deploy.sh:119-127）**不校验 healthy** | `docker compose down`（只摘容器，不动库） |
| 7 | `smoke` | 人 | 打域名/读路径/后台登录；`--write` 才写库并清理（:151-165） | 不适用（只增删游客账号） |
| 8 | 入口顺序 | — | 迁移(5)在起容器(6)之前：**新 schema 先于新代码生效**，老容器在窗口内跑在新库上 | 只有整库恢复 |

### 1.3 回滚能力评估（事实 + 判定）

| 维度 | 现状 | 判定 |
| --- | --- | --- |
| 镜像 tag | `docker-compose.prod.yml:31` 写死 `story-server:m4`、`:104` `story-admin:m4`；`prod-deploy.sh:71,75` 每次重建都覆盖这两个 tag | **可变 tag = 没有应用层回滚**。旧镜像退化成 `<none>`，出事只能重建源码，而源码可能已前进 |
| 镜像留痕 | 无 registry、无 `revision` 标签 | 回答不了「生产跑的是哪个 commit」（poll-prod.sh:65-66 自承） |
| DB 迁移 | 只有 `migration.sql`，无 `*.down.sql`；runner 无事务、无 dry-run、无库名护栏 | **不可逆**，回滚粒度=整库 |
| 备份 | 有真实恢复演练记录（`12-…:369-389` 一次；`24-…md:20-34` 上线前一次） | **演练是真的，但一次性**：无保留策略、无异地、无定期复演 |
| 域名/边缘 | traefik label 随容器生命周期增删（`12-…:118-120`） | 摘域名 = `stop`，可秒回 |

**结论（事实层面）**：这条链路**能上线、不能回滚**。它靠「上线前手工备份 + 出事整库恢复 + 人肉重建镜像」兜底，而不是靠不可变产物。

---

## 2. 脆弱点清单（按严重度）

| 级别 | 脆弱点 | 证据 | 后果 |
| --- | --- | --- | --- |
| **S1** | 镜像 tag 可变，dev/prod 共用一个 tag | `docker-compose.prod.yml:31,104`；`prod-deploy.sh:70-77`；`preflight.sh:111` 拿 `story-server:m4` 起 e2e | ① 无法按版本回滚；② `--e2e` 验的不是「将上线的镜像」；③ 谁重建了 `:m4`（dev 栈同名），下一次 `up -d` 可能把 **dev 构建**推上生产 |
| **S2** | 后台镜像**无法从干净检出重建** | `apps/admin/Dockerfile:54` `COPY apps/admin/public`，但该目录不存在（`git ls-tree HEAD apps/admin/` 无、`git log -- apps/admin/public` 空） | 只能靠层缓存重建；`--no-cache` 或任意 src 变更即断链（构建未实跑，**暂缺**报错原文，但 COPY 源缺失必失败） |
| **S3** | 迁移无原子性、无 down、无护栏 | `apps/server/scripts/migrate.mjs:184-207`（逐语句，成功后写账本）；`scripts/split-sql.mjs:40`（剥 BEGIN/COMMIT）；`migrate.mjs:296` | 半迁移时账本无记录 → 靠「迁移文件自幂等」兜；**任何 `DATABASE_URL` 都被接受**，连生产只需一次手滑 |
| **S4** | 生产漂移探测实际是关的 | `poll-prod.sh:24` 默认 `CONTAINER=story`；`story-poll.service:12` 写死 `STORY_CONTAINER=story`（1.0 已退役→静默跳过，`poll-prod.sh:73-75`）；`:65-66` 自承 2.0 容器无 revision 标签 | 「线上与 main 不一致」这条最重要的告警**永不触发** |
| **S5** | 门禁查 dev 库而非生产；6 小时一次、单机依赖 | `preflight.sh:15` 默认 `TARGET_DB=story_m12_rehearsal`（库已删）；`preflight-gate.sh:30` 改 `story_dev`；`story-preflight.timer:5-7` 每 6h；`story-preflight.service:10-11` 依赖 `dsh-dev` + `/workspace/story` | 生产账本漂移**无自动检测**；门禁与开发机强耦合，NAS 关机 = 门禁消失且无人知晓 |
| **S6** | `up` 不验健康，靠 `sleep 15` | `scripts/prod-deploy.sh:119-127` | unhealthy 也报「成功」；`admin` 虽 `depends_on: service_healthy`（compose:112-114），但 `up -d` 不等待，脚本照样绿 |
| **S7** | 编排缺硬化：日志无上限、无资源限制、无 secrets | `docker-compose.prod.yml:35-56`（env 明文）、`:58-61`；全文无 `logging:` / `deploy.resources` / `secrets:`（已 grep） | json-file 无上限 → 磁盘被日志吃满；TTS 与 Node 争内存无隔离；密钥在 `docker inspect` 明文可见 |
| **S8** | 构建期四坑 = 单点网络依赖 | `apps/server/Dockerfile:6-7,12-19`、`:74`、`:78-82` | 构建成功依赖跨境到 npmjs 的瞬时带宽，不可复现；四坑写进 README = 把环境债固化成流程 |
| **S9** | 手工步骤与身份耦合 | `prod-deploy.sh:120`（`.env.prod` 手备）、`:139`（从文件 grep 固定码）、`:142`（`ADMIN_PHONE` 占位） | 「上线」= 一个人的 shell 历史；换人要重读 426 行 runbook |
| **S10** | 备份同机、无保留策略 | `prod-deploy.sh:32,55-66` | 单盘故障 = 备份一起没；备份目录只增不减 |
| **S11** | CI 与镜像环境漂移、CI 不构建镜像 | `.github/workflows/ci.yml:35`（pnpm 10）、`:40`（node 24）vs `apps/server/Dockerfile:12,20`（node 22 + pnpm 11.20.0）；ci.yml 无任何 `docker build` | 「CI 绿」不能证明镜像能构建；S2 这类断链 CI 永远发现不了 |
| **S12** | 重复 lockfile / 产物入库 | `apps/server/pnpm-lock.yaml`（62 KB，已停更）与根 `pnpm-lock.yaml`（144 KB，权威）；`apps/admin/tsconfig.tsbuildinfo` 已提交 | 有人按子目录 lock 安装 → 依赖树与镜像不一致 |
| **S13** | 健康接口版本号硬编码 | `apps/server/src/app.ts:87`（`0.1.0-m1`）；`/api/health` 只 `SELECT 1`（:79-88） | 绿灯 ≠ 可写（`12-…:60-62` 已有此教训）；线上版本无法自查 |
| **S14** | 弱固定码兜底仍在代码里 | `apps/server/src/env.ts:17`、`apps/server/src/app.ts:93`（`?? '123456'`） | compose 用 `:?` 强制了（compose:48），但只要绕过 compose 起容器（preflight e2e、临时排查）就回到弱码 |

【建议】S1–S4 这周修；S5–S8 一个月内；S9–S14 随 CI/CD 改造一起收。

---

## 3. 测试门禁：为什么 136 个测试进不了 CI，三条路怎么选

### 3.1 根因（事实，不是「缺 Postgres」四个字）

| 要求 | 证据 | 对 CI 的含义 |
| --- | --- | --- |
| 一个**空的、可建 schema 的** Postgres 库 | `tests/helpers/test-db.ts:76-77`（`TRUNCATE … CASCADE`）、迁移里 `CREATE SCHEMA app` + `REVOKE ALL ON SCHEMA app FROM PUBLIC`（`prisma/migrations/20261109000000_init/migration.sql:11-13`） | GitHub 托管 runner **没有** 库；service container 完全够用（无需 superuser 扩展） |
| 库必须是**独占**的 | `apps/server/vitest.config.ts:27`（`fileParallelism: false`）；`scripts/run-tests.mjs:56-75`（`pg_try_advisory_lock(741852963)`，等锁上限 20 分钟） | 两套测试同时跑会互相删表（`run-tests.mjs:5-12` 的实测事故）；CI 并发 job 必须各起各的库 |
| `TEST_DATABASE_URL` 环境变量 | `run-tests.mjs:37-43`；`load-env.mjs:43`（env 优先，`.env` 只是兜底） | **好消息**：不需要把 `.env` 塞进 CI，直接给 env 即可——`ci.yml` 现在只是没给库 |

即：**技术上没有障碍，只是没人写那 20 行 YAML**。

### 3.2 三条路的成本与风险

| 方案 | 实现成本 | 单次 CI 增量 | 主要风险 |
| --- | --- | --- | --- |
| **A. service container（推荐）** | 约 20 行 YAML，零代码改动 | +40–70s（拉库 + 5 个迁移 + 136 测试） | 库是「裸 Postgres」，与生产老库有细微差异；但 `legacy-schema.sql` 已复刻老库形态，差异可控 |
| **B. testcontainers** | 改 `run-tests.mjs`：起容器 → 导出 `TEST_DATABASE_URL` → 跑 → 销毁；加 devDependency | +30–60s，镜像可缓存 | 要 runner 有 docker（托管有，自托管未必）；与「测试不改运行环境」的现有设计冲突 |
| **C. 复用 docker compose + 自托管 runner** | 最高：一台常驻 runner + compose 编排 | 与开发环境 1:1 | 把 CI 绑回**单机** = S5 换壳；NAS 关机就没门禁；并发与库隔离自己管 |

**推荐 A，B 作为「以后要跑 e2e 时」的演进路线，C 只用来跑「上线前 e2e」而不用作门禁。**

### 3.3 方案 A 的 YAML 骨架【建议】

```yaml
# .github/workflows/ci.yml 里新增一个 job（与现有 check 并行）
  server-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: storydev
          POSTGRES_PASSWORD: storydev_local_only
          POSTGRES_DB: story_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U storydev -d story_test"
          --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      # load-env.mjs:43 保证「env 优先于 .env」，所以不需要往 CI 塞 .env
      TEST_DATABASE_URL: postgresql://storydev:storydev_local_only@127.0.0.1:5432/story_test
      DATABASE_URL: postgresql://storydev:storydev_local_only@127.0.0.1:5432/story_dev
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v4
        with: { version: 11.20.0 }        # 与 Dockerfile:20 对齐，别再 10
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: pnpm }   # 与 Dockerfile:12 对齐
      - run: pnpm install --frozen-lockfile --registry https://registry.npmjs.org
      - run: pnpm --filter @story/server test
        # run-tests.mjs 自己拿咨询锁 + 自己跑 setup-test-db，无需额外 flock
```

【建议】顺带把 `concurrency` 的 `cancel-in-progress` 留着（`ci.yml:21-23`）；两个 job 各自起库，互不影响。

---

## 4. 构建期四坑：环境问题还是设计问题

| 坑 | 表面原因 | 真根因 | 判定 |
| --- | --- | --- | --- |
| ① 只能 alpine（`server/Dockerfile:6-7,12`；README:68-70） | 本机 registry 源 `docker.fnnas.com` 对 Debian tag 返 401 | 构建机被绑在**残缺内网镜像源**上；Dockerfile 为迁就它放弃 `bookworm-slim` 的 glibc | **环境债**，被写进了代码 |
| ② 只能用官方 npmjs（`:13-19`，README:71-73） | npmmirror 从构建容器不可达（curl 000/500） | 构建时**必须出公网**；没有本地 registry 缓存层 | **环境债** |
| ③ fetch-timeout 必须 600s（`:74`，README:74-76） | prisma 17.6 MB tarball 35s–>90s 抖动 | 同 ②，加「没把 pnpm store 做成可复用资产」 | **环境债**，缓解手段是设计补丁 |
| ④ node-linker 只能 `hoisted`（`:54-58,80`，README:77-81） | 运行时 `COPY /app/node_modules`（`:152`）要求「可整棵拷走的目录树」，pnpm 默认 isolated 是符号链接森林 | **纯设计债**：用「拷整棵 node_modules」代替「让包管理器产出可部署目录」 | **设计问题** |

### 4.1 更稳的替代（按收益排序）【建议】

1. **用 `pnpm deploy` 替掉 hoisted + 手工 `rm -rf`**
   `pnpm deploy --filter @story/server --prod /out` 直接产出「真文件、无符号链接、只含生产依赖」的目录。收益：删掉 `:78-82` 的 hoisted hack、删掉 `:105-135` 整段 prod-deps + 手工 prune 清单（那份清单本身就是维护债，漏一个包就 500）。
2. **`--ignore-scripts` 解耦 `prisma/` 与依赖层**
   现在 `prisma/` 必须在 install 前就位（`:60-61,77`），**每改一个迁移就 bust 整个依赖层**。改成 deps 阶段 `pnpm install --frozen-lockfile --ignore-scripts`（只 COPY lock + package.json），build 阶段再 `COPY prisma` + `prisma generate`。
3. **预下载 prisma 引擎，别在构建里下**
   `PRISMA_ENGINES_MIRROR` 指内网，或把 `libquery_engine-linux-musl-openssl-3.0.x.so.node` 归档复用；`:95` 已有断言，把它升级成「缺引擎即 fail fast」。这直接消掉坑 ③。
4. **pin digest 而非 tag**
   `ARG NODE_IMAGE=node:22-alpine` → `node:22-alpine@sha256:…`，`nginx:alpine` 同理（`admin/Dockerfile:10`）。收益：基础镜像不再漂移，构建可复现。
5. **本地 registry 缓存层**：内网 `registry:2` 或 Verdaccio，既当 base 镜像 mirror（解 ① 的 401）又当 npm cache（解 ②③）。这是把环境债一次还掉的唯一办法。
6. **bun 构建（可选）**：快，但本仓库是 `lockfileVersion 9.0` + `allowBuilds`（`pnpm-workspace.yaml:9-16`），切 bun 要重建锁与 postinstall 语义。**不建议**作为第一步；真要试先只换 admin 静态构建（无原生依赖）。**暂缺**实测。

**一句话**：①②③是环境债（内网 registry + digest pin），④是设计债（`pnpm deploy`）。四坑写进 README 是**正确的止血**，但也把「构建靠运气」合法化了。

---

## 5. CI/CD 改造：保守档与激进档

现状一句话：**推 main 只跑静态检查，上线靠手动脚本**（`ci.yml:11-16`；`AGENTS.md` 第 1 条硬约束）。1.0 的 `build-image.yml` + Watchtower 已随 D9 删除（`12-…:10-13`），现在是「有 CI 无 CD」。

### 5.1 保守档：tag 触发 + 人为批准（推荐先做）

```
git tag v0.1.3 → 打 tag 是发布动作
   ↓ GitHub Actions
[构建] server/admin 镜像，tag = v0.1.3-<sha>，打 label revision=<sha>
   ↓ push 到 GHCR（或内网 registry）
[批准] environment: production → 需要 1 人 approve（GitHub Environments）
   ↓
[部署] 在 NAS 上执行：docker compose pull / up -d --wait；迁移作为独立 job 再批一次
```

风险：NAS 要能拉 GHCR（**暂缺**实测；`docker.fnnas.com` 401 说明镜像源有策略，pull 外部 registry 需先验）；证书在宿主侧（`12-…:395` P1），CI 不碰。迁移步骤见 5.3。

```yaml
# .github/workflows/release.yml 骨架
name: release
on:
  push: { tags: ["v*"] }
permissions: { contents: read, packages: write }
jobs:
  build:
    runs-on: ubuntu-latest
    environment: production          # ← 人为批准闸门
    steps:
      - uses: actions/checkout@v7
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
      - name: build server
        run: |
          TAG="${GITHUB_REF_NAME}-$(git rev-parse --short HEAD)"
          docker build -f apps/server/Dockerfile \
            --label org.opencontainers.image.revision=${GITHUB_SHA} \
            --build-arg NPM_REGISTRY=https://registry.npmjs.org \
            -t ghcr.io/OWNER/story-server:${TAG} .
          docker push ghcr.io/OWNER/story-server:${TAG}
      - name: build admin
        run: |
          TAG="${GITHUB_REF_NAME}-$(git rev-parse --short HEAD)"
          docker build -f apps/admin/Dockerfile \
            --label org.opencontainers.image.revision=${GITHUB_SHA} \
            --build-arg VITE_API_BASE= -t ghcr.io/OWNER/story-admin:${TAG} .
          docker push ghcr.io/OWNER/story-admin:${TAG}
```

配套必改一处：`docker-compose.prod.yml:31,104` 不能再写 `:m4`，改 `${STORY_SERVER_IMAGE}`（值来自 `.env.prod`，形如 `ghcr.io/OWNER/story-server:v0.1.3-a1b2c3d`），**回滚 = 把那个变量改回上一个值再 `up -d`**。

### 5.2 激进档：GHCR + Watchtower/Dokploy/Coolify + 独立迁移任务

| 维度 | 保守档 | 激进档 |
| --- | --- | --- |
| 触发 | tag | tag（生产）/ main（预发） |
| 批准 | GitHub Environment 人工 approve | 平台 UI 一键 promote，或 label 批准 |
| 部署执行 | NAS 上手工 `compose up -d --wait` | Watchtower 轮询 / Dokploy、Coolify 拉 compose |
| 回滚 | 改 env 里的镜像 tag | 平台「回滚到上一版本」（本质同一件事，但有一键） |
| 迁移 | 人跑 `migrate.mjs` | 一次性 job（`compose run --rm migrate`）在 up 之前，失败阻断 promote |
| 风险 | NAS 要能 pull 外部 registry；`up --wait` 行为待验（**暂缺**） | 多一个控制面（平台自身成了新单点）；Watchtower 自动重建 → 叠加 `12-…:102-104` 的 traefik 2–5s 502 窗口；**迁移与滚动更新不原子**，Watchtower 完全不等迁移 |

**迁移步骤（保守档 → 渐进）**：

1. 先只做「构建 + 推 GHCR + 不改部署」（纯增量，零风险）。**同时修 S2**（`admin/Dockerfile:54`），否则 CI 第一次跑 `--no-cache` 就红。
2. 加 `environment: production` 人工批准，把 tag 命名规范写进 `docs/product/12-…`。
3. compose 改成变量注入镜像 + `--wait`，跑一次「上 v0.1.3 → 回 v0.1.2」的真回滚演练（这是**第一次**能演练应用层回滚）。
4. 最后才考虑平台化（Dokploy/Coolify）。Watchtower 不建议用于 2.0：它会在迁移未跑的情况下替换容器（这正是 1.0 时代的老毛病）。

---

## 6. 可观测性与应急：现在有什么、缺什么

【事实】

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| 日志 | pino → stdout → docker json-file，**无 max-size、无轮转、无集中收集** | `apps/server/src/index.ts:16`；compose 全文无 `logging:` |
| 健康检查 | 容器内 `wget /api/health`（`SELECT 1`），compose 与 Dockerfile 各写一份 | `docker-compose.prod.yml:72-77`、`apps/server/Dockerfile:167-168`、`apps/server/src/app.ts:79-88` |
| 域名探针 | 每 10 分钟探 api/admin，两次非 2xx 才报（去抖正确） | `poll-prod.sh:100-142`、`story-poll.timer:4-7` |
| 版本漂移 | **已失效**（探的是退役的 `story` 容器） | `poll-prod.sh:24,67-75`、`story-poll.service:12` |
| 告警出口 | 仅本机中台 `127.0.0.1:3350/v1/events` → agent 派活 | `poll-prod.sh:25,34-47`、`preflight-gate.sh:22-23` |
| 证书到期 | 有记录（到 2027-02-09），**无自动提醒** | `handover.md:50` |
| 指标/追踪 | 无 | — |
| 应急手册 | 有，且质量高（回滚表、恢复演练） | `12-…:246-257,369-389`、`24-…:207-224` |

【缺】三条最要命：**① 生产漂移没人管（S4）；② 告警单点（中台/NAS 挂 = 全静默）；③ 日志吃满磁盘且事后无法检索。**

### 6.1 最小可用生产可观测性 5 条【建议】

1. **日志有界 + 可检索**：compose 加 `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`，日常巡检 `docker logs story-server-prod | grep '"level":50'`。
2. **健康检查换成「写路径探针」**：新增 `GET /api/ready`，做一次 `SELECT 1` + `app.setting` upsert + 读回；healthcheck 指它。理由：`12-…:60-62` 已验证「`db=up` 不等于可用」（只读账号事故）。
3. **真版本自查**：镜像打 `org.opencontainers.image.revision`，`/api/health` 返回 `{sha, buildTime}`（替掉 `app.ts:87` 的硬编码 `0.1.0-m1`），并把 `poll-prod.sh` 的 revision 比对对象改成 `story-server-prod`（今天它比的是退役容器 = S4）。
4. **告警要有第二出口 + 死信箱**：中台事件之外，同时 POST 到 Telegram/邮件 webhook；再加一个 **dead-man switch**（healthchecks.io 之类的每分钟 ping）——探针自己死了才会有人知道。
5. **备份三件事**：保留策略（如 7 日 + 4 周）、异地一份（NAS 之外）、**每季度一次自动恢复演练**（把 `12-…:369-389` 那次手工演练脚本化，跑在 `story_restore_drill` 库上、跑完即删）。

【建议】把「证书到期日」「备份最近成功时间」也做成探针项——这两项现在都只活在人脑里。

---

## 7. 结论：只做 3 件事

### ① 让镜像成为不可变产物（修 S1 + S2 + S11）

- compose 的 `image:` 改成变量（`${STORY_SERVER_IMAGE}`），构建 tag 带版本 + sha，打 `revision` label；
- 先修 `apps/admin/Dockerfile:54`（`COPY apps/admin/public`，目录不存在）；
- CI 加一步「两个镜像都能 `--no-cache` 构建」——今天就能抓出 S2 这类断链。
> 收益：**第一次拥有应用层回滚能力**，「生产跑的是哪个 commit」变成可查事实。

### ② 把 136 个服务端测试搬进 CI（修 S5 门禁失效）

按 3.3 的 service container 方案，20 行 YAML。顺带把 pnpm/node 版本对齐（`ci.yml:35,40` vs `Dockerfile:12,20`）。
> 收益：门禁从「NAS 每 6 小时查 dev 库、失败发事件给 agent」变成「合入前必红」。生产库账本漂移仍未覆盖——那条交给 ③ 的版本/漂移探针。

### ③ 把「出事有人知道」补齐（修 S4 + S7 日志 + 告警单点）

- `poll-prod.sh` 的 revision 检查指向 `story-server-prod`；
- compose 加日志上限与资源限制；
- 告警加第二出口 + dead-man switch。
> 收益：从「靠人想起来跑 `status`」变成「异常 10 分钟内必然有人（或 agent）被叫醒」。

**可以继续拖的**：激进档平台化、bun 迁移、`pnpm deploy` 重构（收益明确但排在①之后）、CI 跑 e2e（依赖 dind，性价比最低）。

---

## 附：本次审计未覆盖 / 需人工确认

| 项 | 原因 | 建议怎么补 |
| --- | --- | --- |
| admin 镜像是否真会构建失败（S2） | 纪律要求不执行 docker build | dev 容器跑 `docker build --no-cache -f apps/admin/Dockerfile .` |
| NAS 能否 pull GHCR | 无法 SSH | NAS 上 `docker pull ghcr.io/OWNER/story-server:test` |
| `compose up -d --wait` 在 v2.40.3 的行为 | 不执行生产命令 | 用 override 在 dev 栈上验 |
| `.env.prod` 实际内容（密钥强度、镜像变量） | 已 gitignore、不在仓库 | 人工按 `15-prod-credential-rotation.md` 复核 |
| 生产库当前迁移账本 | 未连生产 | `./scripts/prod-deploy.sh status`（只读） |
