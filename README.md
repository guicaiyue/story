# 小故事铺

面向儿童与家庭的在线故事阅读平台。

| 层 | 目录 | 形态 | 生产入口 |
| --- | --- | --- | --- |
| 服务端 | `apps/server` | Node 22 + TS + Fastify 5 + Prisma 6 | <https://api-story.xirizhi.cn> |
| 运营后台 | `apps/admin` | React 18 + Vite + Ant Design 5，镜像内 nginx | <https://admin-story.xirizhi.cn> |

> **1.0 静态站已于 2026-11-14 彻底删除**（决策 D9）：容器、镜像、部署目录、Traefik 路由、
> 以及仓库里的源码（`index.html` / `css` / `js` / `live2d` / `webfonts` / `img`）、
> 它专属的 `Dockerfile` / `.dockerignore` / `docker/nginx.conf` / `scripts/dev-server.js` /
> 四个契约测试，全部移除。整份归档在 NAS
> `/vol1/1000/story/backup/retire-1.0-20261114-000508/story-1.0-source-20261114-041342.tar.gz`
> （2.8 MB / 57 条目，sha256 `a4a72c60…5784`），另仍在 git 历史里（删除提交的父提交可取出）。
> 要恢复请看 [docs/product/03-decisions.md](docs/product/03-decisions.md) 的 D9。

> **安卓客户端（`apps/app`）**：Flutter 3.47.9 / Dart 3.13.7，包名 `com.storynook.app`，
> 当前 **0.1.4+5**。**出包在 CI**（`.github/workflows/android.yml`），推 `apps/app/**` 到 main
> 或手动触发，Flutter 构建 → 从 secrets 还原 keystore → 发 GitHub Release 附件。
> 本机不需要 Flutter / Android SDK。签名材料唯一副本在 `~/Documents/story-keystore/`
> （进 restic 日备），CI 从 4 个 `ANDROID_*` secrets 取。见 [apps/app/README.md](apps/app/README.md)。

## 文档索引

**先读 [docs/README.md](docs/README.md)** —— 「做到哪了 / 该看哪份 / 三条命令」都在那里。
只要读一页就够的是 [docs/handover.md](docs/handover.md)。

## 服务端与运营后台

### 发布链路（2026-11-23 起：推 main 就是发布）

```
① git push origin main
② GitHub Actions  ci.yml
     check  → server/admin 类型检查 + 后台单测
     image  → 构建并推 xirizhi/story-server:<sha> / story-admin:<sha> 到 Docker Hub
     deploy → 发 story.deploy 事件（detail 带 sha）
③ NAS 部署机（/vol1/1000/docker/story/，只有 compose + .env，没有源码）
     docker compose pull → run --rm migrate → up -d → 验收
```

**镜像只在 CI 构建**，部署机上不跑 `docker build`。回滚 = 改 `.env` 里的
`STORY_TAG` 回上一个 sha，再 `pull` + `up -d`。

**`deploy` 这一步的绿就是真的上线了**：NAS 那边失败时回的是「没上线：…」，而中台的
失败前缀只认「没跑成」，所以「没上线」会被记成 done。`ci.yml` 因此不看 `state` 一个字段，
还看摘要内容——只有「上线了 / 没事可做」才 `exit 0`，其余（含空）直接红。以前只看
`state`，结果是 **CI 绿、生产没上线**（2026-11-18 的 run #236 就是这样）。

**验收看两处**：容器 `story-server-prod` / `story-admin-prod` 都 healthy；`api-story.xirizhi.cn/api/health`
的 `data.version` 等于 `apps/server/package.json` 的版本（它从 package.json 读，不是写死的，
改版本号忘了同步会被 `tests/content.test.ts` 拦住）。

### 运维命令

```bash
./scripts/prod-deploy.sh status        # 只读：生产库 / 容器 / 域名
./scripts/prod-deploy.sh backup        # 带时间戳的 pg_dump
./scripts/prod-deploy.sh migrate       # 迁移（容器内跑，需 .env.prod 的 PROD_MIGRATE_DATABASE_URL）
./scripts/prod-deploy.sh up            # docker compose pull + up -d
./scripts/prod-deploy.sh smoke         # 域名 + 读路径 + 后台登录/接口（不写库）
./scripts/prod-deploy.sh grants        # 建/更新 story_app 并授权（需 STORY_APP_PASSWORD）
./scripts/prod-deploy.sh admin --phone <手机号>   # 建首个管理员
```

`all` = backup → migrate → up → smoke（**不含 build**；`grants` / `admin` 需单独跑）。
`build` 保留但只用于离线排障，产物 tag 是 `local-<时间戳>`，不能当发布物。

环境变量在 `.env.prod`（**不入库**），两个连接串分开：
`PROD_DATABASE_URL` 给应用（`story_app`，无 DDL 权限）、
`PROD_MIGRATE_DATABASE_URL` 给迁移（超级用户）。
完整手册：[docs/product/12-prod-deploy-runbook.md](docs/product/12-prod-deploy-runbook.md)。

**docker 相关文件全部在仓库根**（2026-11-18 收敛，`apps/*` 下已没有 Dockerfile）：

| 文件 | 用途 |
| --- | --- |
| [Dockerfile.server](Dockerfile.server) + [Dockerfile.server.dockerignore](Dockerfile.server.dockerignore) | 服务端镜像（多阶段，运行层 node22-alpine） |
| [Dockerfile.admin](Dockerfile.admin) + [Dockerfile.admin.dockerignore](Dockerfile.admin.dockerignore) | 后台镜像（运行层 nginx:alpine） |
| [docker-compose.prod.yml](docker-compose.prod.yml) | 生产编排（server + admin + 可选 nginx-front） |
| [nginx-front.conf](nginx-front.conf) | **可选** nginx 反代样例（profile `nginx-front`，默认不启用） |

构建上下文永远是**仓库根**（CI 的 build-push-action 也是这么设的）。
白名单（`.dockerignore`）必须与 Dockerfile 同名同目录，BuildKit 只认 `<Dockerfile>.dockerignore`。

### 改完代码检查

```bash
docker start story-dev-postgres   # 首次或库停了才要
./scripts/preflight.sh
```

`preflight.sh` 要 pnpm + 能解析 `story-dev-postgres`（开发库，不是生产库）。
脚本自己检测 `/.dockerenv`，不在容器里就早退并提示。
**它是开发期门禁，与 NAS 生产环境无关**——`story-preflight.timer` 从来没被创建过。

它检查迁移账本 + 服务端测试（136）+ 后台测试（63）；`--e2e` 再加 16 步端到端冒烟
（临时容器 + 副本库）。注意 `story_e2e_seed` 这个种子库现在不存在，`--e2e` 会 SKIP，
要跑就用 `E2E_DB=<带 admin 账号的库名>` 指定。

### 生产库只读核对

```bash
./apps/server/scripts/prod-baseline-check.sh
```

把生产库的 M1 变更当**冻结基线**逐项核对（列名/表/行数/权限/索引）。
退出码 `0` 一致、`1` 漂移、`2` 守卫错误。**只读**：连接层用
`PGOPTIONS='-c default_transaction_read_only=on'`，启动时自检写入确实被拒。

> ⚠️ 别用 `psql -c "SET default_transaction_read_only=on; <写操作>"` 当只读守卫
> —— `SET` 只对**后续**事务生效，同一条 `-c` 里的语句仍可写。见 08 号文档 §5。

## 构建期的四个坑（改 Dockerfile 前先看）

1. **基础镜像只能用 alpine**：本机 Docker 的 registry 镜像源（`docker.fnnas.com`）
   只提供 alpine 系 tag，Debian 系（`node:22-bookworm-slim`）会返回 401。
   所以用 `node:22-alpine`；Prisma 查询引擎会自动装 musl 版。
2. **npm 源一律用官方 `registry.npmjs.org`**，不要换镜像站。
   `registry.npmmirror.com` 从构建容器里**不可达**（curl 000 / 500，`ER_NO_SUCH_TABLE`），
   导致过构建失败。apk 源同理用默认的 `dl-cdn.alpinelinux.org`，不要 sed 换 aliyun。
3. **`fetch-timeout` 必须放宽**：同一份 prisma 17.6MB tarball，两次实测 35s 和 >90s。
   默认 60s 会让构建随机失败（pnpm error 23 / `TimeoutError`）。
   所以 `.npmrc` 写了 `fetch-timeout=600000` + `fetch-retries=5`。
4. **`node-linker` / `store-dir` 只能用命令行 `--config.*` 传**，写进 `.npmrc` 无效
   （pnpm 11 不从 `.npmrc` 读 `node-linker`）。isolated 模式下依赖只落在
   `apps/server/node_modules` 的符号链接上，运行时 `COPY` 根 `node_modules` 会拷到空壳。
   而 `registry`、`verify-deps-before-run`、`fetch-timeout` 是**必须**写进 `.npmrc` 的
   —— `pnpm run` / `pnpm exec` 前那次隐式依赖检查 install 只读 `.npmrc`，不读命令行。

## 相关文档

- 产品与范围：`docs/product/01-product-brief.md`
- 架构与 API：`docs/product/02-architecture.md`
- 决策台账：`docs/product/03-decisions.md`
- **生产库 M1 基线（冻结，含核对 SQL）**：`docs/product/10-prod-migration-baseline.md`
- **生产迁移执行手册**：`docs/product/09-prod-migration-runbook.md`
- 上线执行记录（2026-11-13 已上线）：`docs/product/24-prod-deploy-20261113.md`
