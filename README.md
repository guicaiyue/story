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

> Flutter 客户端（`apps/app`）已移出本仓库，不在任何分支上。0.1.2 源码归档在 NAS
> `/vol1/1000/story/backup/src/story-app-0.1.2-src.tar.gz`（118 KB / 101 文件），
> 签名材料在 `backup/keystore/`，APK 走 GitHub Releases 附件（`backup/apk/` 留有副本）。

## 文档索引

**先读 [docs/README.md](docs/README.md)** —— 「做到哪了 / 该看哪份 / 三条命令」都在那里。
只要读一页就够的是 [docs/handover.md](docs/handover.md)。

## 服务端与运营后台

### 一键上线（生产）

```bash
./scripts/prod-deploy.sh status        # 只读：生产库 / 容器 / 域名
./scripts/prod-deploy.sh backup        # 带时间戳的 pg_dump
./scripts/prod-deploy.sh build         # 构建 story-server:m4 / story-admin:m4
./scripts/prod-deploy.sh migrate       # 应用待执行迁移（需 DATABASE_URL）
./scripts/prod-deploy.sh up            # docker compose up -d
./scripts/prod-deploy.sh smoke         # 域名 + 读路径 + 后台登录/接口（不写库）
```

`all` = backup → build → migrate → up → smoke。`grants` / `admin` 需单独跑。
生产编排是 [docker-compose.prod.yml](docker-compose.prod.yml)，环境变量读 `.env.prod`（**不入库**）。
完整手册：[docs/product/12-prod-deploy-runbook.md](docs/product/12-prod-deploy-runbook.md)。

### 改完代码检查

```bash
docker exec dsh-dev bash -lc 'cd /vol1/1000/开发/NAS/story && ./scripts/preflight.sh'
```

`preflight.sh` 必须在开发容器里跑（宿主上没有 pnpm，也解析不到 `story-dev-postgres`）。
它检查迁移账本 + 服务端测试 + 后台测试；`--e2e` 再加 16 步端到端冒烟（临时容器 + 副本库）。

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
