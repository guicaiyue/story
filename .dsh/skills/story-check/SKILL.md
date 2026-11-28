---
name: story-check
description: 核小故事铺（story）的一批改动是否真的做完、真的能用。中台把「小故事铺：检查」派过来时使用——你是新会话，没写过这批代码，只看证据。
---

# 小故事铺：检查

**先加载 `pipeline-check`**（五问、审查清单通用项、通过/退回句式、回执协议都在那里）。加载不到就写 `BLOCKED.md`。
配置读仓库根的 `pipeline.conf`。

## 本项目只核这几条

| 核什么 | 怎么核 |
| --- | --- |
| 门禁 | `./scripts/gate.sh` **自己跑一遍**。它里面 `SKIP` 的项要判「这一批需不需要它」——需要就是没验，不是通过 |
| 假红识别 | 后台单测整片红且报 `act(...) is not supported in production builds` = 跑测的人 `NODE_ENV=production`，不是代码坏。用 `NODE_ENV=test` 复跑再判 |
| 服务端 136 用例 | 只有开发库（`story-dev-postgres`）在的时候才会跑。计划里写「136 用例全绿」但这一轮没有库 → 退回 |
| 本机验不了的改动 | diff 动到 `apps/app/**`、`.github/workflows/**`、`Dockerfile*`：本机没有 Flutter/SDK、也不跑 CI。要求 plan 里写清「靠 CI 的哪一条」，**不接受「应该没问题」** |
| 构建文件 | 新增/改 Dockerfile 必须在仓库根、`.dockerignore` 同名同目录（BuildKit 只认 `<Dockerfile>.dockerignore`）；**仓库根出现 `.dockerignore` 就是错** |
| 生产库只读 | diff 里出现对 `story` 库的写操作（migrate / grants / admin / `psql` 写入 / `.env.prod` 的迁移串）→ 退回并 `ask` |
| 版本一致性 | 改了 `apps/server/package.json` 的 version，`/api/health` 的期望与 `tests/content.test.ts` 是否同步 |
| 迁移 | 新增迁移文件时：能不能回滚、有没有先备份、`preflight.sh --status` 会不会有 pending。答不上来就是没想清楚 |
| 断言只增不减 | `git diff origin/main...HEAD -- apps/**/*.test.*` 里用例数只能涨；少了要有站得住理由 |
| 文档对齐 | 改到了 `AGENTS.md` 里写着的五条硬约束（构建文件位置 / 镜像在 CI / 生产库只读 / alpine 与 npmjs / 推 main 即发布）时，文档要跟着改 |

## 跑之前先想：会不会写坏东西

- `gate.sh`、`preflight.sh` 只连开发库 `story-dev-postgres`，不碰生产。
- `./scripts/prod-deploy.sh status` 是**只读**的，可以跑；它的 `migrate` / `grants` / `admin` / `up` / `backup` **一律不许在检查轮执行**（那是发布轮或人的事）。
- 检查轮不改代码：发现问题是退回，不是自己动手。

## 通过 / 退回

按 `pipeline-check` 的句式。退回要写三样：**哪一问、证据（文件:行 / 命令输出 / 数字）、要它做到什么**。

## 高危，先问人

发布链路、迁移、生产库、签名材料：发 `ask`。
