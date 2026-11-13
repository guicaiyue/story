# 小故事铺 2.0 · 文档索引

新同学（或三个月后的自己）从这里进。**先看「现在该看哪份」，再看底下按主题分的清单。**

## 现在该看哪份

| 你想干什么 | 打开 |
| --- | --- |
| 一句话知道项目做到哪了、卡在哪 | [product/18-progress-log.md](product/18-progress-log.md) |
| **目标达成对照（含未达成项）** | [product/22-objective-audit.md](product/22-objective-audit.md) |
| **上线执行记录（2026-11-13 已上线）** | **[product/24-prod-deploy-20261113.md](product/24-prod-deploy-20261113.md)** |
| **收尾全量验证（一次跑完的证据）** | [product/23-final-verification.md](product/23-final-verification.md) |
| **交接一页（只要读这一页）** | [handover.md](handover.md) |
| 把服务跑起来（生产） | 根目录 [README.md](../README.md) 的「2.0 服务端与运营后台」一节 |
| 改完代码检查有没有坏 | `./scripts/preflight.sh`（详见下文「三条命令」） |
| **决定要不要上生产（历史清单，已执行）** | [product/20-approval-sheet.md](product/20-approval-sheet.md) |
| 上线 / 重新上线（生产） | `./scripts/prod-deploy.sh status\|backup\|build\|migrate\|grants\|admin\|up\|smoke`；手册见 [product/12-prod-deploy-runbook.md](product/12-prod-deploy-runbook.md) |
| 发版 | [product/release-notes-0.1.2.md](product/release-notes-0.1.2.md) |
| 查某个决定为什么这么定 | [product/03-decisions.md](product/03-decisions.md) |

## 三条命令

| 命令 | 干什么 | 什么时候跑 |
| --- | --- | --- |
| `./scripts/preflight.sh` | 迁移账本 + 服务端/后台测试 | 每次改完代码 |
| `./scripts/preflight.sh --e2e` | 再加端到端冒烟（临时容器 + 副本库，16 步） | 准备上线前 |
| `./scripts/prod-deploy.sh status` | 生产库 / 容器 / 域名一眼看完（只读） | 任何时候 |
| `./scripts/prod-deploy.sh smoke` | 生产全链路冒烟（`--write` 才写库，自动清理） | 上线后 / 重启后 |

端到端冒烟本体是 `apps/server/scripts/e2e-smoke.mjs`，也可以单独对着任意服务跑：
`BASE=http://host:3000 ADMIN_CODE=123456 node apps/server/scripts/e2e-smoke.mjs`。

## 产品与决策

| 文档 | 内容 |
| --- | --- |
| [product/00-research.md](product/00-research.md) | 用户与市场调研（分龄优先、睡前场景） |
| [product/01-product-brief.md](product/01-product-brief.md) | 产品定位与范围 |
| [product/02-architecture.md](product/02-architecture.md) | 三端架构与接口约定 |
| [product/03-decisions.md](product/03-decisions.md) | **决策台账**（D1–D7 等，改方向先来这里） |
| [product/04-dev-log.md](product/04-dev-log.md) | 开发日志（按天，含踩坑） |
| [product/06-working-baseline.md](product/06-working-baseline.md) | 工作基线与约定 |

## 上线与迁移

| 文档 | 内容 |
| --- | --- |
| [product/12-prod-deploy-runbook.md](product/12-prod-deploy-runbook.md) | **生产部署 runbook**：§7.1 编排验证 / §7.2 迁移彩排 / §7.3 端到端 / §7.4 备份与恢复演练 |
| [product/09-prod-migration-runbook.md](product/09-prod-migration-runbook.md) | 迁移执行手册 |
| [product/10-prod-migration-baseline.md](product/10-prod-migration-baseline.md) | 迁移前的生产基线（行数、指纹） |
| [product/13-prod-story-app-grants.sql](product/13-prod-story-app-grants.sql) | `story_app` 专用账号授权 SQL（**已执行**） |
| [product/21-prod-admin-seed.sql](product/21-prod-admin-seed.sql) | 建首个生产管理员账号（幂等，**已于 11-13 执行**） |
| [product/15-prod-credential-rotation.md](product/15-prod-credential-rotation.md) | 生产口令暴露面核查与轮换清单 |
| [product/11-dev-cleanup.md](product/11-dev-cleanup.md) | 开发库残留清理 |

## 发布

| 文档 | 内容 |
| --- | --- |
| [product/release-notes-0.1.2.md](product/release-notes-0.1.2.md) | 0.1.2 发版说明（平板适配，**已出包**：versionCode 3 / 正式签名） |
| [product/16-commit-plan.md](product/16-commit-plan.md) | `apps/` 那批工作的提交方案（**已于 2026-11-13 执行**并合并进 `main`） |

## 近期的三份复核记录

| 文档 | 内容 |
| --- | --- |
| [product/17-tablet-support.md](product/17-tablet-support.md) | 平板适配：断点、侧边导航、内容收窄、播放器双栏 |
| [product/19-design-review-2026-11-12.md](product/19-design-review-2026-11-12.md) | 三份设计稿逐屏截图复核（修掉 5 处渲染缺陷） |
| [product/18-progress-log.md](product/18-progress-log.md) | 进度与介入记录（做到哪、卡在哪、谁要出手） |

## 目录约定

```
apps/server           服务端（Fastify + Prisma，136 测试）
apps/admin            运营后台（React + Vite + nginx，63 测试）
apps/server/scripts   迁移执行器、开发种子、端到端冒烟
scripts/              宿主侧脚本（preflight 预检、prod-deploy 上线一条龙）
docs/product          产品、决策、上线、发布
```

> Flutter 客户端已移出本仓库，不在任何分支上：0.1.2 源码归档在 NAS
> `/vol1/1000/story/backup/src/story-app-0.1.2-src.tar.gz`，APK 走 GitHub Releases。

## 一条硬规矩

**生产库 `story` 只读，除非走 runbook 里标注「需批准」的步骤。**
所有脚本默认连 `story-dev-postgres`；连错库应当响亮地失败，而不是静默跑起来。
