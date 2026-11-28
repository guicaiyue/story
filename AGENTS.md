# AGENTS.md — 小故事铺（story）

面向儿童与家庭的在线故事阅读平台。**本文件只写下次 Agent 不看到就会犯错的事**；
怎么用、怎么运维看 [README.md](README.md) 和 [docs/README.md](docs/README.md)。

## 一句话定位

单库 monorepo，**三端都在 `apps/`**：服务端、运营后台、安卓客户端。1.0 静态站**已于 2026-11-14 彻底删除**
（决策 D9），源码、根 Dockerfile、.dockerignore、四个契约测试全没了；**Flutter 客户端源码已于 2026-11-14
从 git 历史（`aacce1b`）恢复到 `apps/app`**，现版本 0.1.4+5。

## 怎么跑

```bash
# 本机门禁：两端类型检查 + 后台单测（中台四条规则与 skill 里说的就是这一条）
./scripts/gate.sh

# 服务端/后台的完整门禁 —— 要 pnpm + 能解析 story-dev-postgres；CI 跑不了（要 Postgres）
# 先起开发库：docker start story-dev-postgres
./scripts/preflight.sh

# 生产状态（只读）
./scripts/prod-deploy.sh status

# 安卓客户端（本机没装 Flutter/SDK；正式出包走 CI，见下）
cd apps/app && flutter pub get && flutter test        # 58 个用例
FLUTTER_CHECK=1 ./scripts/preflight.sh                 # 把 App 用例并进预检（默认关）
bash apps/app/tool/build-release-apk.sh                # 本机出包（要 Flutter + SDK + keystore）
```

**APK 出包在 CI**：`.github/workflows/android.yml`，推 `apps/app/**` 到 main 或手动触发。
Flutter 3.47.9 构建 → 从 secrets 还原 keystore → `tool/build-release-apk.sh`（同一条脚本，
CI 与本地不漂移）→ 按 versionName 建 GitHub Release。签名材料见
`~/Documents/story-keystore/`（唯一副本，进 restic 备份）。

## 技术栈

| 层 | 栈 | 生产入口 |
| --- | --- | --- |
| 服务端 | Node 22 + TS + Fastify 5 + Prisma 6 + zod | `api-story.xirizhi.cn` |
| 运营后台 | React 18 + Vite + TS + Ant Design 5 | `admin-story.xirizhi.cn` |
| 安卓客户端 | Flutter 3.47.9 / Dart 3.13.7，包名 `com.storynook.app`，provider + just_audio | APK 走 GitHub Releases 附件 |

## 目录与约定

```
apps/server      服务端（159 测试）
apps/admin       运营后台（66 测试，镜像内 nginx）
apps/app         Flutter 客户端（58 测试；签名材料与 APK 不入库，出包走 CI）
apps/app/tool/build-release-apk.sh  正式签名出包（自检版号/签名/基址）
apps/server/scripts  迁移执行器、开发种子、端到端冒烟
scripts/         宿主侧脚本（gate 本机门禁、preflight 预检、prod-deploy 上线一条龙、refactor-signal 结构信号）
.dsh/skills      中台四条规则的项目层 skill：story-dev / story-check / story-release / story-refactor
pipeline.conf    流水线适配（门禁命令、上线通道、重构信号口径），母本在 ~/work/dotfiles/ai/pipeline
docs/product     产品、决策、上线、发布（档案性质，读前看状态头）
```

## 中台流水线（2026-11-28 接）

四条规则：**小故事铺：开发 / 检查 / 发布 / 重构评估**（事件 `story.develop` / `.check` / `.publish` / `.refactor.signal`，
`cwd` 都是本仓库，skill 在上面那个 `.dsh/skills`）。改流程改 skill，不动规则表。

两条不看到就会做错的事：
- **上线事件由 CI 的 `deploy` job 自己发**（`story.deploy:<repo>:<sha>`）。发布轮**不要**再发一条：
  同 id 会被中台吞掉，不同 id 会让 NAS 装两次。
- **开发轮只 commit，不 push**：推 main 就是发布，那是发布轮的活。

## 五条硬约束（踩过坑才写下来）

1. **docker 构建文件全在仓库根**（2026-11-18 收敛，`apps/*` 下已没有 Dockerfile）：
   `Dockerfile.server` / `Dockerfile.admin` + 各自的 `<Dockerfile>.dockerignore` 白名单
   （BuildKit 约定：`-f Dockerfile.server` 只认 `Dockerfile.server.dockerignore`），
   加 `docker-compose.prod.yml`、`nginx-front.conf`、`.env*.example`。
   构建上下文永远是仓库根（`docker build -f Dockerfile.server .`；正式构建在 CI，
   本地 `./scripts/prod-deploy.sh build` 只出 `local-<时间戳>` tag 供离线排障）。
   **不要造根 `.dockerignore`**——它不匹配任何一个 Dockerfile，白名单会静默失效，
   1.4GB 上下文（含 487MB `node_modules`）会被整个传给 daemon。
2. **`js/` 与 `index.html` 已不存在**。如果你在找它们，说明在看旧文档或旧分支；
   1.0 源码只能从 git `499f138` 取（NAS 上的归档已随 `/vol1/1000/story` 备份区一起丢失，2026-11-23 实测）。
3. **镜像构建只能用 alpine 基础镜像 + 官方 `registry.npmjs.org`**。
   本机 registry 源不给 Debian tag；npmmirror 从构建容器不可达。详见 README「构建期的四个坑」。
4. **生产库 `story` 只读**。写操作走 runbook 里标注「需批准」的步骤；开发一律用 `story-dev-postgres`。
5. **推 `main` = 发布**（2026-11-23 改，旧约定「只跑检查不发布」已作废）。
   链路三段：`check`（类型检查 + 后台单测）→ `image`（构建并推
   `xirizhi/story-server:<sha>` / `story-admin:<sha>` 到 Docker Hub）→ `deploy`（发
   `story.deploy` 事件，NAS 上的 dsh 拉镜像 + 迁移 + 起容器 + 验收）。
   **镜像构建只在 CI 发生，不在部署机上构建**；NAS 的 `/vol1/1000/docker/story/`
   只有 `docker-compose.yaml` + `.env`，**没有源码**。
   回滚 = 改 `.env` 的 `STORY_TAG` 回上一个 sha。
   服务端 159 个测试 CI 跑不了（要 Postgres），真正的门禁是 `./scripts/preflight.sh`。
   **预检是开发期门禁，与 NAS 无关**：它连的是开发库 `story-dev-postgres`，脚本自己会
   检测 `/.dockerenv`，不在容器里就早退。本机开发库默认停着，要跑先 `docker start story-dev-postgres`。
   别信「NAS 上每 6 小时跑一次」——`story-preflight.timer` **从来没被创建过**。

## 当前状态（2026-11-23）

- 唯一分支 `main`。服务端/后台版本 0.1.2；客户端 **0.1.4+5**（tag `v0.1.4`，2026-11-23 CI 出包）。
- 生产在跑：**服务端 / 后台两个**域名 200，容器 `story-server-prod` / `story-admin-prod` healthy，
  TLS 到 2027-02-09。1.0 已彻底删除（D9），`story.xirizhi.cn` 返回 404 是正常的。
- **三端源码都在仓库**：`apps/server`、`apps/admin`、`apps/app`（Flutter，2026-11-14 恢复）。
  **APK 与 NAS 无关**：出包在 CI（`.github/workflows/android.yml`）、发布走 GitHub Releases 附件、
  功能测试在本机 arch 装包（waydroid）。NAS 只跑生产服务端 + 后台。
  **签名材料**：`~/Documents/story-keystore/`（唯一副本，进 restic 日备）+ GitHub secrets
  （`ANDROID_KEYSTORE_BASE64` / `STORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`）。
  证书 `CN=StoryNook`，SHA-256 `1D:06:C9:EA…:E9:20`，有效期至 2056-11-15。
  旧的（`69:39:67:FA…:73:87:F`，签 0.1.2 用的）已彻底丢失；2026-11-23 换新，当时无老用户，
  所以同包名重发没有兼容负担。**从 0.1.3 起同一 keystore 可持续升级。**
  keystore 路径易错：Gradle 的 `file(storeFile)` 与脚本的检查都以 `android/app/` 为基准，
  所以文件必须落 `apps/app/android/app/keystore/`，不是 `android/keystore/`。
- 待办：生产首个管理员用 `set-admin-password.mjs` 设账号密码（迁移前的老账号没有口径，上线窗口里做）、APK 真机验收、C 端接真实短信通道。
- 已知遗留：本机 `story-dev-postgres` 上只有 `story_dev` / `story_test` 两个库。
  **`story_e2e_seed` 已经不在了**（2026-11-23 实测），所以 `preflight --e2e` 会 SKIP 并提示
  「没有 story_e2e_seed 库」。要跑端到端得先造种子库，或 `E2E_DB=<库名>` 指定一个带 admin 账号的库。
