---
name: story-dev
description: 在小故事铺（story）做前半程：分析 → 开发自测 → 交棒给检查。中台把「小故事铺：开发」派过来时使用；用户说「改一下后台」「服务端报错」「App 那个页面」时也用。
---

# 小故事铺：开发

**先加载 `pipeline-dev`**（新活与退回分流、四段、验收做法、交棒协议都在那里）。加载不到就写 `BLOCKED.md` 说明，别凭印象做。
配置读仓库根的 `pipeline.conf`。

## 这个仓库的五条硬约束（踩过坑才写下来）

1. **docker 构建文件全在仓库根**：`Dockerfile.server` / `Dockerfile.admin` + 同名 `.dockerignore`，构建上下文永远是仓库根。
   **不要造根 `.dockerignore`**——它不匹配任何 Dockerfile，白名单会静默失效，1.4 GB 上下文（含 487 MB `node_modules`）被整个传给 daemon。
2. **镜像只在 CI 构建**（`ci.yml` 的 `image` job，tag = commit sha）。本机 `./scripts/prod-deploy.sh build` 只出 `local-<时间戳>`，不能当发布物。
3. **生产库 `story` 只读**。开发一律用 `story-dev-postgres`；迁移、写库、`prod-deploy` 的 migrate/grants/admin 都是「先 ask」。
4. **基础镜像只能 alpine + 官方 `registry.npmjs.org`**：本机 registry 源不给 Debian tag，npmmirror 从构建容器不可达。
5. **推 main = 发布**。开发轮**只 commit，不 push、不打 tag**——推之前还有一道检查。

## 三端各自怎么自测

| 改哪 | 自测 |
| --- | --- |
| `apps/server` | `./scripts/gate.sh`（类型检查 + 后台单测；开发库在的时候顺带服务端 136 用例）。改 schema 走 `apps/server/scripts/migrate.mjs`，plan 里写清这条迁移能不能回滚 |
| `apps/admin` | `./scripts/gate.sh`（含后台 63 用例）。界面/交互类再加 `pnpm --filter @story/admin build`；能起 `pnpm --filter @story/admin dev` 就自己点一遍 |
| `apps/app` | **本机没有 Flutter SDK，跑不了 `flutter test`**。改动只能写进 plan，靠 CI 的 `android.yml`（推 `apps/app/**` 或手动触发）验。**不许在回执里写「本机跑了 58 个用例」** |

`./scripts/gate.sh` 里 SKIP 的项，要在 plan 里写明「为什么这一轮不需要它」。

## 两个容易搞错的诊断

- 后台单测整片红、报 `act(...) is not supported in production builds`：**是你这个 shell 里 `NODE_ENV=production`**，不是代码坏了。`gate.sh` 里已经显式给 `NODE_ENV=test`；自己手跑时也要给。
- `pnpm --filter …` 前面那次隐式依赖检查报 `ERR_PNPM_*`：先 `pnpm install --frozen-lockfile --registry https://registry.npmjs.org`，别改 lockfile。

## 版本号

- 服务端/后台版本在 `apps/server/package.json` / `apps/admin/package.json`；`/api/health` 的 `data.version` 从前者读，`tests/content.test.ts` 守着两者一致——改一处就要连期望一起改。
- App 版本在 `apps/app/pubspec.yaml`（`version: 0.1.4+5`），只有出 APK 时才动。

## 验收做到哪一层（本项目的命令）

| 改了什么 | 要求 |
| --- | --- |
| 迁移 / 数据模型 / 接口合同 | `gate.sh` 全绿 + plan 写清回滚方式；动到已发布的接口要先 `ask` |
| 后台界面 / 交互 | `gate.sh` + `pnpm --filter @story/admin build`，能起 dev 就截图 |
| 文案 / 样式 / 修 bug | `gate.sh` |
| `apps/app/**` | 本机只能静态读代码；验收交给 CI，plan 里写明「未在本机跑」 |
| 只改文档 / skill / 脚本 | `gate.sh`（确认没连带坏掉） |

## 高危，先问人

生产库任何写操作、迁移、`prod-deploy.sh` 的 migrate/grants/admin、发布链路（`ci.yml` / `Dockerfile*` / `.env.prod`）、签名材料（`~/Documents/story-keystore/`）、删数据。

## 交棒

`notice` key 用 `story-<事项>`，分阶段原地改写。事件是 `story.check`，形状与规矩见 `pipeline-dev`。**结束卡不要自己结**，由检查结。
