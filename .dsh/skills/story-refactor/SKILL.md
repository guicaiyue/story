---
name: story-refactor
description: 小故事铺（story）的结构信号评估：先排假信号，再判形状还是边界，最后出一份能被开发轮逐条核的方案。这一轮不改代码。中台把「小故事铺：重构评估」派过来时使用。
---

# 小故事铺：重构评估

**先加载 `pipeline-refactor`**（判断框架、三条硬约束、输出骨架、禁止项全在那里）。加载不到就写 `BLOCKED.md` 说明。
配置读仓库根的 `pipeline.conf` 的 `refactor_*` 段。

## 一、取数

```bash
bash scripts/refactor-signal.sh          # JSON 到 stdout，人读摘要到 stderr
```

它给事实表：`byKind`（按类别的账）、`sourceFiles`（逐文件净增与被改次数）、`probes`（只有 `role: trigger` 的参与触发）。

**别只信事件 detail 里那几个数字**——那只是摘要（协议上限 4000 字符）。基线 commit 在不在也要核：不在说明基线脏了，要报。

## 二、这个仓库的假信号长什么样（2026-11-28 实测）

`docs` / `scripts` / `config` 通常占大头：README、AGENTS、`docs/product/`（决策台账、迁移手册、上线记录）、`scripts/*.sh`、`pnpm-lock.yaml`。
这些涨了是「记录变强 / 护栏变强」，不是腐化。

`refactor_source_dirs` 只收三处源码：`apps/server/src`（约 2.3k 行）、`apps/admin/src`（约 4.2k 行）、`apps/app/lib`（约 5.6k 行）。
其余目录即便后缀像源码也不进触发（`apps/app/tool/`、`vite.config.ts` 这类脚本涨了不该惊动结构治理）。

## 三、目录约定与本项目的层

| 位置 | 是什么 |
| --- | --- |
| `apps/server/src/routes` · `apps/admin/src/pages` · `apps/app/lib/screens` | **三层**，每层内文件不许互相 import |
| `apps/server/src/services` · `apps/admin/src/api` | 共享机制，允许被上面引用 |
| `apps/server/prisma/migrations` | 迁移，只增不改；动它就是数据模型变更，不是重构 |

层内跨文件 import 由 `probes` 里的 `cross-import` 盯（`role: trigger`）。`gate.sh` 完全看不见这一类腐化。

## 四、红线（命中就 ask，不是「小心一点」）

- 迁移（`apps/server/prisma/migrations`、`scripts/migrate.mjs`）
- 部署形态（`Dockerfile*`、`docker-compose.prod.yml`、`ci.yml`、`.env.prod`）
- 三端共用契约（API 字段、model 名、`/api/health` 的形状）——动它就不是重构，是协议变更
- 生产库、签名材料（`~/Documents/story-keystore/`）

## 五、验收（写进方案里，能被下一环重放）

| 改动 | 验什么 |
| --- | --- |
| 纯搬文件 / 移代码 | 两端类型检查零错 + 后台 63 用例全绿；**用例一个不改还全绿**才是行为保持的证据 |
| 任何改动 | `./scripts/gate.sh` |
| 后台界面类 | `pnpm --filter @story/admin build` |
| 动 `apps/app/**` | 本机没有 Flutter SDK，方案里必须写清「靠 CI 的 `android.yml` 验」，并说明哪条用例能看见行为没变 |

## 六、ask（这一轮一律先问，不直接派活）

选项固定两个：`继续，派给开发` / `先停下`。正文第一行要能独立读懂：
`小故事铺 结构信号 L<n>：<要动哪几个文件、为什么、改完怎么验>`，然后按 `pipeline-refactor` 的骨架写价值 → 依据 → 方案。

人答「继续」才发 `story.develop`，`subject` 用 `重构-<热点>`（稳定、可复现，重复派会命中原 plan）。答「先停下」或没人答就什么都不派，写清为什么停。

## 七、本轮允许写的文件

只有 `.refactor-baseline.json`，而且**只在判定「要动手并已派给开发」时**推进：

```json
{"reviewedCommit": "<当前 HEAD>", "reviewCount": <旧值+1>, "reviewedAt": "<今天>", "reviewedTag": "<最近 tag 或空>"}
```

判无事就**不要动它**——基线一动，下次同一状态会换一个事件 id 再发一条，等于自己叫自己。

其余文件一律只读。
