# M4 · 联调、打包与上线方案

> 状态：**已执行完毕（2026-11-13 生产上线）**。本文作为 M4 方案档案保留，
> 实际执行记录见 [24-prod-deploy-20261113.md](24-prod-deploy-20261113.md)。
> 文中提到的 `docker-compose.m4.yml`、`m4-smoke.sh`、`m4-migrate-rehearsal.sh`
> 已在 2026-11-13 仓库收敛时删除，本文命令不可直接复制执行。
> 依据：`01-product-brief.md` §8 里程碑、`02-architecture.md`、`03-decisions.md` D7（生产库只读）。

## 1. M4 目标

把「服务端 + Web 后台 + 安卓 App」从各自的 dev 环境，变成**一套可一起启动、可被真实验收、可回滚**的部署单元。

验收口径（缺一不可）：

1. `docker compose up -d` 起 server + admin + db，`/api/health` 200；
2. 后台能用真实账号登录、看板/列表/审核可用；
3. App 指向这套服务端能完成「首页 → 播放（TTS）→ 进度上报 → 收藏」；
4. 一条内容从「草稿」到「上架」再到 App 可见，全链路可复现；
5. 迁移脚本在 dev 库演练通过，且有回滚脚本；
6. 生产库**零写入**（除非单独批准的迁移窗口）。

## 2. 部署拓扑

```
                 ┌──────────── NAS 宿主 nginx（443） ────────────┐
用户/家长 ──HTTPS──▶│ storynook.cn        → 静态站（现有，不动）      │
                 │ api.storynook.cn    → server:3000              │
                 │ admin.storynook.cn  → admin 静态产物（nginx）   │
                 └───────────────────────────────────────────────┘
安卓 App ──HTTPS──▶ api.storynook.cn/api/*
```

- 服务端与后台各自打镜像；后台是静态产物 + nginx，不需要 node 运行时；
- 数据库沿用现有 `postgres` 容器，新表放 `app` schema（D4），老表 `public` 只读；
- 音频缓存放宿主卷（`/vol1/1000/story/audio-cache`），不进镜像、不进 Postgres。

## 3. 打包

| 产物 | 方式 | 备注 |
| --- | --- | --- |
| `story-server` | 多阶段 Dockerfile（node:22 → 运行层） | 暴露 3000；健康检查 `/api/health` |
| `story-admin` | `vite build` → nginx:alpine | 环境变量 `VITE_API_BASE` 构建期注入 |
| `story-app` | `flutter build apk --release` | **需要 Android SDK**；无 SDK 时先出 `flutter build web` 作演示包 |

## 4. 数据迁移（dev → prod）

**原则**：迁移只做「追加」，不删不改老数据；先 dev 演练，再走批准窗口。

### 4.1 迁移工具口径（**以 `migrate.mjs` 为准**）

生产库与 dev 克隆都是 **Prisma 之前就存在的老库**：里面已经有表（2197 条线上
内容），且**没有 Prisma 的迁移历史**。对这种库执行 `prisma migrate deploy` 会直接
以 **P3005**（"The database schema is not empty"）拒绝 —— 这是 Prisma 对既有库的
设计行为，不是配置问题（已在克隆库上复现）。

| 场景 | 用哪个工具 | 原因 |
| --- | --- | --- |
| **生产库 / legacy 老库 / dev 克隆** | **`apps/server/scripts/migrate.mjs`** | 幂等、可重复；账本 `public._m1_migrations` 自维护，不依赖 Prisma 迁移历史 |
| **全新空库**（新环境从零搭） | `prisma migrate deploy` | 空库才有 baseline，此时 Prisma 的迁移语义才有意义 |

`migrate.mjs` 的特性：

* 按目录名字典序应用 `prisma/migrations/<name>/migration.sql`；
* 用 `public._m1_migrations` 记「已应用」，重跑安全；
* **首次成功执行后**写一条 baseline 标记到 `public._m1_baseline`
  （记录时间/执行者/库名/runner/已应用版本），只写一次、重跑不覆盖；
* 支持三个子模式：

```bash
node scripts/migrate.mjs                        # 应用待执行迁移
node scripts/migrate.mjs --status               # 只读：账本 + baseline + 待执行
node scripts/migrate.mjs --mark-applied <name>  # 老库：把**已存在**的迁移记为已应用（不执行）
```

> `--mark-applied` 是本项目对 `prisma migrate resolve --applied` 的替代：生产库的
> M1 变更已作为**冻结基线**存在（见 08 号文档），账本里却可能没有记录。此时**不能**
> 重复执行那些迁移（会重跑 UPDATE/DELETE），只应记账。

### 4.2 执行步骤（维护窗口）

1. **冻结基线核对**（只读，随时可跑）：`./apps/server/scripts/prod-baseline-check.sh`，
   要求无漂移（详见 08 号文档）；
2. **生产库快照**：`pg_dump story`，落 `/vol1/1000/story/backup/<date>.dump`，
   并用 `pg_restore --list` 校验可恢复（不只是「生成了文件」）；
3. **dev 克隆演练**：`./scripts/m4-migrate-rehearsal.sh`，要求 **24/24 通过**（另有 1 项预期 warning：P3005 属既有库设计行为）。
   > 注：历史上本文档写「25/25」；2026-11-11 修脚本未定义变量 bug 后实测为 24 项，见 `04-dev-log.md` §27。
   （快照 → 迁移 → 校验 → 回滚，全程不碰生产）；
4. **执行迁移**（**老库用 migrate.mjs**）：
   ```bash
   DATABASE_URL='postgresql://<user>:<pass>@<host>:5432/story' \
     node apps/server/scripts/migrate.mjs
   ```
   若该库的 M1 变更已存在但账本为空，先记账：
   ```bash
   node apps/server/scripts/migrate.mjs --mark-applied 20261109000000_init
   ```
5. **幂等种子**：只补分类映射与 `status/age_band` 回填（已有值不覆盖）——
   这部分已并入 `20261110000000_m4_prod_supplement`，其 `UPDATE` 均带
   `IS DISTINCT FROM` 条件；
6. **校验 SQL**：行数、空值率、外键完整性、内容安全（聊斋/怪谈必须 9+）、
   老站 pREST 三个接口 200；随后重跑步骤 1 的核对脚本（按迁移后的新口径）；
7. **回滚**：
   * 基线部分 **回滚不适用**（见 08 号文档 §4）；
   * 本次新增部分可 `DROP`/反向 `UPDATE`，但**分级修正不建议回滚**（属内容安全）；
   * 灾难场景才整库 `pg_restore`（会丢期间用户数据，须人工评估）。

**红线**：生产库写入必须在单独维护窗口、由人执行或人在场；agent 只产出脚本与演练报告。

> 详细缺口清单、验收标准与回滚分档见 **09-prod-migration-runbook.md**；
> 冻结基线的确切内容与核对 SQL 见 **10-prod-migration-baseline.md**。

## 5. 安全与合规

| 项 | 要求 |
| --- | --- |
| 管理端鉴权 | JWT + 角色（admin/editor）；密码/验证码不落日志；登录失败限流 |
| App 鉴权 | 游客 device token；敏感写接口校验归属；不收集通讯录/位置 |
| 儿童数据 | 只存昵称/生日（可空）/年龄档；提供删除入口；不上传头像原图（可先不做头像） |
| 家长门 | 付费、设置、退出儿童模式必须过门；门失败不锁死 |
| 内容安全 | 恐怖/怪谈不进儿童端；age_band 人工复核后才 published |
| 传输 | 全站 HTTPS；API 只走 443；CORS 白名单只放 admin/app 域 |
| 依赖 | 服务端 `pnpm audit` 无 high；镜像不带 devDependencies |

## 6. 灰度与监控

- **灰度**：先只对内（家里 3 个账号）用一天，看错误率与播放成功率；
- **监控**：`/api/health` 探测（1 分钟）、错误日志按 code 聚合、播放事件断点；
- **回滚**：镜像回退到上一 tag；数据库回滚口径见 §4.2 第 7 步
  （**基线部分回滚不适用**，见 08 号文档 §4）；
- **数据看板**：睡前时段占比、完播率、TTS 合成成功率三个指标进后台看板。

## 7. 上线顺序（建议）

1. 服务端 + 后台先上（App 继续连 dev）；
2. 观察 24h：错误率、合成成功率、pREST 老站是否受影响；
3. App 出 APK（需 SDK）、内测分发；
4. 老站加「下载 App」入口，逐步把内容页流量导向 App；
5. 两周后评估是否把老站改为调用新 API（老站只读，风险低）。

## 8. 需要产品负责人拍板的事

> 已拍板：§4 的迁移工具口径 —— **老库用 `migrate.mjs`，`prisma migrate deploy`
> 只用于全新空库**（任务卡 `c-mwa0wamy-1hyz4`）。
> 生产库 M1 既成基线按**冻结保留**处理（任务卡 `c-mwa0wan6-28qf7`）。

1. 域名与证书：`api.storynook.cn` / `admin.storynook.cn` 是否现在申请；
2. 生产迁移窗口：选一个夜间时段，是否允许 agent 生成脚本、由我执行；
3. APK 分发方式：内测链接 / 应用商店（后者需要软著与备案）；
4. 是否保留老站作为内容预览入口（M4 期间）；
5. 生产内容分级修正（聊斋/怪谈必须 9+）是否纳入本次窗口 ——
   属内容安全修正，建议必须纳入，详见 09 号文档 §8。
