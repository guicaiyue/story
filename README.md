# 小故事铺

面向儿童与家庭的在线故事阅读平台。前端为静态 HTML、CSS 与 JavaScript，数据 API 为 `https://story-api.xirizhi.cn/story/public`。

## 本地开发

开发不使用 Docker，也不会启动任何 Docker 服务。需要 Node.js 18+：

```bash
node scripts/dev-server.js
```

浏览器访问 <http://127.0.0.1:5173>。修改 HTML、CSS、JavaScript 或静态资源后，浏览器会自动刷新。

可用环境变量覆盖监听地址或端口：

```bash
HOST=0.0.0.0 PORT=5173 node scripts/dev-server.js
```

## 测试

```bash
node test-umami-tracker.js
node test-prest-client.js
node test-story-analytics.js
node test-edge-tts-analytics.js
```

## 发布

唯一发布入口是推送到 `main`。GitHub Actions [build-image.yml](.github/workflows/build-image.yml) 会运行全部契约测试，构建生产 Docker 镜像，并推送：

- `${DOCKERHUB_USERNAME}/story:<commit-sha>`
- `${DOCKERHUB_USERNAME}/story:latest`

所需 GitHub Secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`。本机生产服务的镜像拉取与升级由既有运行机制负责，不在此源码仓执行。

---

# 小故事铺 2.0 · M4 联调栈

> 📚 **文档索引：[docs/README.md](docs/README.md)** ——「做到哪了 / 该看哪份 / 三条命令」都在那里。

> 上面的静态站是**老站**，继续原样服务线上。本节讲的是 2.0 新三端里的
> **服务端 + 运营后台**如何一起打包、启动、验收、回滚。
>
> ⚠️ **本栈只连开发库，不碰生产**（`docs/product/03-decisions.md` D7）。
> 生产库 `story` 正在为 storynook.cn 提供内容，禁止任何写操作。

产物一览：

| 产物 | 说明 |
| --- | --- |
| `apps/server/Dockerfile` | 服务端镜像，多阶段 node:22-alpine + pnpm |
| `apps/admin/Dockerfile` | 后台镜像，`vite build` → `nginx:alpine` 静态层 |
| `docker-compose.m4.yml` | server + admin，复用 `story-dev-postgres` |
| `scripts/m4-smoke.sh` | 联调冒烟（8 项） |
| `scripts/m4-migrate-rehearsal.sh` | 迁移演练（快照 → 迁移 → 校验 → 回滚） |

## 怎么起

前置：开发库容器 `story-dev-postgres` 已在运行，且网络 `dsh-dev_default` 存在。

```bash
# 1. 确认开发库在（M1 建的，里面有 2197 条真实内容）
docker inspect story-dev-postgres >/dev/null && echo "dev 库 OK"

# 2. 起栈（首次会构建两个镜像）
docker compose -f docker-compose.m4.yml up -d

# 3. 看状态：两个都应该是 (healthy)
docker compose -f docker-compose.m4.yml ps
```

起来之后：

| 入口 | 地址 | 说明 |
| --- | --- | --- |
| API | <http://127.0.0.1:13300/api/health> | 服务端直连 |
| 后台 | <http://127.0.0.1:18082/> | nginx 静态层，`/api/*` 反代到 server |

登录后台用开发库里的管理员：手机号 `13900000001`、验证码 `123456`
（固定验证码占位，见 D4；账号由 `apps/server/scripts/seed-dev-admin.mjs` 写入）。

> **端口为什么不是 3000/80**：宿主上 3000 被 chromium 容器占用、80 被多个服务
> 占用，所以映射到 13300 / 18082。要改就改 `docker-compose.m4.yml` 里的 ports。
>
> **为什么绑 0.0.0.0 而不是 127.0.0.1**：开发容器 `dsh-dev` 与宿主不在同一网络
> 命名空间，绑 127.0.0.1 时宿主能访问、`dsh-dev` 里不能，脚本会连不上。
> 想收紧：`M4_BIND=127.0.0.1 docker compose -f docker-compose.m4.yml up -d`。

## 怎么验

```bash
# 联调冒烟：health / 管理员登录 / 2197 条 / 音频 / 反代，共 8 项
./scripts/m4-smoke.sh
```

脚本会自动挑能连通的地址（宿主上用 127.0.0.1，`dsh-dev` 里用
`host.docker.internal`），也可显式指定：

```bash
BASE_URL=http://192.168.1.4:13300 ADMIN_BASE_URL=http://192.168.1.4:18082 ./scripts/m4-smoke.sh
```

单看某一项：

```bash
curl -s http://127.0.0.1:13300/api/health
curl -s -o /dev/null -D - -r 0-1023 http://127.0.0.1:13300/api/stories/8/audio
```

镜像大小：

```bash
docker images story-server:m4 story-admin:m4
```

## 怎么回滚

**代码/镜像回滚**（改坏了直接回到当前已构建的镜像）：

```bash
docker compose -f docker-compose.m4.yml down        # 停栈，保留数据卷
docker compose -f docker-compose.m4.yml up -d       # 用现有镜像重建
```

**数据库回滚**：先在 dev 库上演练，确认快照能恢复：

```bash
./scripts/m4-migrate-rehearsal.sh            # 完整演练，结束删克隆库
./scripts/m4-migrate-rehearsal.sh --keep     # 保留克隆库与快照，便于人工看
```

演练流程：`pg_dump` 快照 → 克隆库恢复 → 打回 pre-M1 → 跑迁移 → 校验
（行数 2197/2197/15、9 个新列、空值 0、外键完整、age_band）→ **从快照回滚** →
比对行数。全程只动克隆库，`story_dev` 与生产库都不写。

> 🔴 **迁移执行必须在容器网络内**。`pg_dump` / `pg_restore` / `psql` 走
> `docker exec` 进 DB 容器，从宿主跑没问题；但**迁移本身（prisma /
> `migrate.mjs`）不能在宿主上直跑**，两条硬约束：
> 1. `story-dev-postgres` 只是容器网络里的名字，宿主 DNS 解析不到 → P1001；
> 2. 这个库**没有发布宿主端口**（`docker port` 为空），换成 `127.0.0.1` 也连不上。
>
> 所以脚本会把迁移放进网络内的容器执行，并支持三种模式：
>
> ```bash
> MIGRATE_RUNNER=auto  ./scripts/m4-migrate-rehearsal.sh   # 默认：自动找（推荐）
> MIGRATE_RUNNER=dsh-dev ./scripts/m4-migrate-rehearsal.sh # 指定容器
> MIGRATE_RUNNER=temp  ./scripts/m4-migrate-rehearsal.sh   # 强制起临时容器
> ```
>
> `auto` 会按「开发容器 → 扫全部运行中容器 → 起临时容器」找执行器，找不到就
> 以退出码 2 停下并说明原因（不会像早期版本那样在第 6/7 步 P1001 后连锁失败）。
> 仓库路径会自动探测，也可显式给 `MIGRATE_RUNNER_PATH`。
> 临时容器用的镜像必须**带 openssl**（默认 `node:22-bookworm`）：`-slim` 不带，
> Prisma 会误判成 `openssl-1.1.x` 并报找不到查询引擎。

快照落在 `.m4-rehearsal/`（已在 `.gitignore` 里），默认保留最近 3 份。

> **生产库回滚**（**未执行，需单独批准**）：生产迁移必须先在维护窗口做
> `pg_dump` 快照并校验可恢复，再执行迁移；回滚用同一份快照恢复。
> 详见 `docs/product/07-m4-plan.md` §4。

## 常用操作

```bash
docker compose -f docker-compose.m4.yml logs -f server   # 跟服务端日志
docker compose -f docker-compose.m4.yml down             # 停栈
docker compose -f docker-compose.m4.yml down -v          # 停栈并删音频缓存卷
docker compose -f docker-compose.m4.yml build            # 重新构建两个镜像
```

音频缓存放在命名卷 `story-m4-audio-cache`（容器内 `/data/audio-cache`），
**不进镜像、不进 Postgres**。`down -v` 会删掉它，下次访问重新合成。

## 构建期的四个坑（改 Dockerfile 前先看）

1. **基础镜像只能用 alpine**：本机 Docker 的 registry 镜像源
   （`docker.fnnas.com`）只提供 alpine 系 tag，Debian 系（`node:22-bookworm-slim`）
   会返回 401。所以镜像用 `node:22-alpine`；Prisma 的查询引擎会自动装 musl 版。
2. **npm 源一律用官方 `registry.npmjs.org`**，不要换成镜像站。
   `registry.npmmirror.com` 从构建容器里**不可达**（curl 000 / 500，
   `ER_NO_SUCH_TABLE`），是它导致过构建失败。apk 源同理用默认的
   `dl-cdn.alpinelinux.org`（实测 `apk update` OK，28670 packages），
   不要 sed 换 aliyun。
3. **npmjs 拉大包速度波动大，`fetch-timeout` 必须放宽**：同一份 prisma
   17.6MB tarball，两次实测分别是 35s 和 >90s。默认 60s 超时会让构建随机失败
   （pnpm 报 error 23 / `TimeoutError`）。所以 `.npmrc` 里写了
   `fetch-timeout=600000` + `fetch-retries=5`。
4. **`node-linker` / `store-dir` 只能用命令行 `--config.*` 传**，写进 `.npmrc`
   无效：pnpm 11 不从 `.npmrc` 读 `node-linker`（实测 `.npmrc` 写了 `hoisted`，
   产出的 `.modules.yaml` 仍是 `nodeLinker: isolated`）。isolated 模式下依赖只
   落在 `apps/server/node_modules` 的符号链接上，运行时 `COPY` 根 `node_modules`
   会拷到一个空壳。而 `registry`、`verify-deps-before-run`、`fetch-timeout`
   是**必须**写进 `.npmrc` 的 —— `pnpm run` / `pnpm exec` 前那次隐式依赖检查
   install 只读 `.npmrc`，不读命令行。

## 相关文档

- 产品与范围：`docs/product/01-product-brief.md`
- 架构与 API：`docs/product/02-architecture.md`
- 决策与实测：`docs/product/03-decisions.md`
- M4 方案（含生产迁移与上线顺序）：`docs/product/07-m4-plan.md`
- **生产库 M1 基线（冻结，含核对 SQL）**：`docs/product/10-prod-migration-baseline.md`
- **生产迁移执行手册（缺口/顺序/验收/回滚）**：`docs/product/09-prod-migration-runbook.md`

### 生产库只读核对

```bash
./apps/server/scripts/prod-baseline-check.sh
```

把生产库现有的 M1 变更当作**冻结基线**逐项核对（列名/表/行数/权限/索引），
退出码 `0` 一致、`1` 漂移、`2` 守卫错误。**只读**：连接层用
`PGOPTIONS='-c default_transaction_read_only=on'`，并在启动时自检写入确实被拒。

> ⚠️ 别用 `psql -c "SET default_transaction_read_only=on; <写操作>"` 当只读守卫
> —— `SET` 只对**后续**事务生效，同一条 `-c` 里的语句仍可写。详见 08 号文档 §5。


