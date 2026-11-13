# 生产库凭据：暴露面核查与轮换清单

日期：2026-11-12　状态：**源码已修，轮换待排期**

## 1. 发生了什么

2026-11-11 的任务卡 c-mwbvil7x 报出：`apps/server/tests/helpers/test-db.ts` 的
`TEST_DATABASE_URL` 回退值里硬编码了 NAS 共享 postgres 的**超级用户密码**，而
`github.com/guicaiyue/story` 是 public 仓库。

核查结论（2026-11-12）：

| 检查项 | 结果 |
| --- | --- |
| 该文件是否已提交进 git | **否**（`apps/` 整棵树都还是未跟踪状态） |
| git 历史里是否出现过该字符串 | **否**（`git log --all -S '<密码>'` 为空） |
| 该密码是什么 | NAS 共享 postgres（`/vol1/1000/docker/postgres`）的超级用户密码 |
| 生产 story 库在哪 | 同一台共享 postgres 上的 `story` 库 |
| 共享实例上还有谁用这个密码 | `postgres`、`ttrss`、`story-prest`(pREST)、`ai-goofish-monitor-app` 四个容器；磁盘上明文出现在 `ttrss/docker-compose.yml`、`ai-xianyu-monitor/.env`、`story/.env`、`postgres/.env` |
| 生产 postgres 上是否存在 `story_test` 库 | **存在** —— 说明回退链接曾被真实使用过（测试连到过生产实例，只是写了另一个库） |

所以：**没有已发生的公开泄露**，但回退值一旦随 `apps/` 一起提交就会立刻泄露；而且
「测试会连到生产实例」这件事已经被 `story_test` 库坐实了。

## 2. 已做的修复（2026-11-12）

1. `apps/server/tests/helpers/test-db.ts`：删掉回退连接串，改为**必须**由
   `TEST_DATABASE_URL` 提供，缺失时报错并指回 `.env.example`。
2. 删掉构建产物 `apps/server/dist/tests/helpers/test-db.js`（内含旧回退值，gitignored）。
3. 全仓（排除 `node_modules`/`.git`）检索该密码：**0 处**。
4. 回归：`pnpm test`（apps/server）→ **136 passed / 6 files**，确认是走
   `apps/server/.env` 的 `story_test`。

## 3. 仍然存在的暴露面（需要轮换才能消掉）

- 该密码值已经写进了任务卡账本 `cards.json` 与一条会话投影缓存
  （`/data/dsh/dsh-task-cards/cards.json`、`storages/session_projcache/...`）。
  文件权限 0600/root，但它会随面板、备份、导出一起流动。
- 四个容器仍在用同一个超级用户密码；其中 pREST 直连生产 `story` 库。

**结论：修复代码只能止血，不能假装密码没被写下来过 —— 要轮换。**

## 4. 轮换清单（需要一次 30–60 分钟窗口，有人守着）

爆炸半径：共享 postgres 上所有库 + 4 个消费方。**生产库操作，逐步确认，不一把梭。**

### 阶段 A：准备（不改任何东西）
- [ ] 列全消费方：`docker ps` 逐个 `docker inspect` 查 `POSTGRES_PASSWORD`；
      `grep -r '<密码>' /vol1/1000/docker --include='*.yml' --include='.env*'`
- [ ] 确认每个消费方对应的库与账号：`ttrss`、`story-prest`→`story`、`ai-goofish-monitor`
- [ ] 生成新密码（≥32 位随机），**先不落盘到仓库**，只放临时文件
- [ ] 备份：`docker exec postgres pg_dumpall -U postgres > /tmp/pg-before-rotation.sql`，
      并验证文件非空、可 `psql -l` 打开

### 阶段 B：先给 story 用专用账号（推荐优先做这条，比轮换更值）
- [ ] 执行 `docs/product/13-prod-story-app-grants.sql`，建 `story_app`（只读/读写按需），
      生产 `story` 只授予它需要的权限
- [ ] 把 pREST（`story-prest`）与 M1 服务端切到 `story_app`，不再用超级用户
- [ ] 验收：`curl` 生产读接口 200；写接口做一次可回滚的写并核对

### 阶段 C：轮换超级用户密码
- [ ] `ALTER USER postgres PASSWORD '<新密码>'`（一条，可回滚：旧密码先记在临时文件）
- [ ] 依次更新并重启：`postgres`（compose `.env`）→ `ttrss` → `ai-goofish-monitor` → `story-prest`
- [ ] 每改一个立刻验证它自己的健康检查，失败就停下，不要继续往下改
- [ ] `docker exec postgres psql -U postgres -c 'select 1'`，容器内新密码可用

### 阶段 D：收尾
- [ ] 全部服务健康：`docker ps` 无 unhealthy、ttrss 能读、AI 监控能连、pREST 能读生产
- [ ] 删掉 `/tmp` 里的新旧密码临时文件与备份（备份按需保留到确认稳定）
- [ ] 在任务卡里结掉 c-mwbvil7x，写明：源码已修 + 轮换完成时间 + 谁验的
- [ ] 任务卡账本里的明文密码：轮换完成后它已失效，可**不**改历史记录（账本不该被篡改），
      但此后新卡正文要做脱敏（见下文）

## 5. 防复发（写进规范，不靠记性）

- **测试永远不许有回退连接串**：缺 `TEST_DATABASE_URL` 就报错（本次已改成这样）。
- **仓库里禁止出现任何真实口令**：`apps/` 里的默认值一律 `CHANGE_ME`；
  提交前跑一次 `git diff --cached | grep -iE 'password|secret|token'` 人工扫一眼。
- **`story_test` 不应存在于生产实例上**：确认后删除，测试库只允许出现在
  `story-dev-postgres`。
- **任务卡正文脱敏**：卡片是长期账本，会把细节原样留存；含口令/密钥的卡在
  生成时就该打码。这是 dsh-task-cards 的待修项，已记入插件优化清单。

## 6. 为什么不是现在做

轮换会同时重启 ttrss / AI 监控 / pREST，影响与 story 无关的服务；且属于
「生产基础设施 + 不可逆」操作，需要你在场逐步确认。代码侧已经止血，
真正的泄露通道（public 仓库）已经关闭，排期做即可。
