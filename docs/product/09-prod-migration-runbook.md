# 09 · 生产迁移执行手册（M4）

> **状态（2026-11-13）：已执行完毕**。生产库已应用 5 条迁移，执行记录见
> [24-prod-deploy-20261113.md](24-prod-deploy-20261113.md)。
> 本文保留为**再次迁移时的操作手册**；其中 `scripts/m4-migrate-rehearsal.sh`
> 已于 2026-11-13 仓库收敛时删除，步骤 2 的演练改用
> `./scripts/preflight.sh --e2e`（临时容器 + 副本库，16 步）。

> 配套文档：**10-prod-migration-baseline.md**（既成基线，冻结）。
> 本文档 = 正式迁移方案：只补缺口、逐步幂等、可验收、回滚口径明确。
>
> 🔴 **红线**：生产库写入必须在单独维护窗口、由人执行或人在场。
> Agent 只产出脚本、演练报告与核对结果，**不执行生产写入**（03-decisions D7）。

---

## 1. 一句话方案

生产库的 M1 变更已是**冻结基线**（9 列 + `app` 9 表 + 1 条迁移记录）。
正式迁移**不回滚、不重建**，只补三处缺口，全部幂等：

| # | 缺口 | 影响 | 处理 |
| --- | --- | --- | --- |
| A | `app.audio_cache` / `app.audio_job` 不存在 | TTS 音频缓存索引无处落库，M4 音频接口在生产不可用 | 建表（`IF NOT EXISTS`） |
| B | 内容分级仍是旧口径：**聊斋志异 293 篇仍标 3-6** | **内容安全缺口** —— `/api/home` 已按 `ageBand` 过滤，但库里这些是 3-6，闸门会放行给孩子 | 按产品口径改 `age_band` |
| C | 重复空分类 `id=2`「睡前故事」仍在 | 后台分类列表出现同名空分类 | 有条件删除（仅在 0 篇时） |

对应的迁移文件：`apps/server/prisma/migrations/20261110000000_m4_prod_supplement/migration.sql`

---

## 2. 缺口 B 是内容安全问题，不只是数据一致性

这是**最容易漏掉、后果最直接**的一项。时间线：

1. 生产库 M1 回填时只把「分类 15/16/17（怪谈/恐怖/推理）」标成 `9+`。
2. 产品负责人随后在 dev 重排分级，把**聊斋志异（分类 13，293 篇）**也定为 `9+`。
3. 服务端 `/api/home` 已实现按 `ageBand` 过滤（内容安全闸）。
4. 但**生产库的数据没有跟着改** —— 聊斋在生产仍是 `3-6`。

后果：闸门按库里的 `age_band` 判断，于是在生产环境里，**293 篇聊斋会被当作
适龄内容放行给 3-6 的孩子**。dev 库因为已重排，测不出这个问题。

> 已在只读核对中实测确认（见 08 号文档 §2.2 的偏差列表）：
> `category_id=13 AND age_band<>'9+'` → **293** 篇。

**这也是为什么必须做「生产基线核对」而不是只信 dev 演练结果。**

---

## 3. 执行顺序（维护窗口）

### 步骤 0 · 冻结基线核对（只读，随时可跑）

```bash
./apps/server/scripts/prod-baseline-check.sh
```

要求：14 项通过。若出现**漂移**（基线不一致）→ **停止**，先查清是谁改的再继续。

### 步骤 1 · 快照（可恢复性优先）

```bash
docker exec postgres pg_dump -U postgres -d story \
  --format=custom --no-owner --no-privileges > /vol1/1000/story/backup/story-<date>.dump
```

校验快照可用（**不只是生成了文件**）：

```bash
docker exec -i postgres pg_restore --list < 快照文件 | grep -c "TABLE DATA"
```

### 步骤 2 · 在克隆库上演练迁移（强烈建议，非生产）

```bash
./scripts/preflight.sh --e2e
```

~~原命令 `./scripts/m4-migrate-rehearsal.sh` 要看到 20/20 通过~~ —— 该脚本已删除，
现在用 `preflight.sh --e2e`（16 步端到端，含临时容器 + 副本库）。该脚本在 dev 库的克隆上跑「快照 → 迁移 → 校验 → 回滚」，
**不碰生产**，且会把迁移放进容器网络内执行（宿主直跑连不上 dev 库）。

### 步骤 3 · 执行迁移（由人执行）

迁移 runner 是项目自带的幂等脚本（**不是** `prisma migrate deploy`，原因见 §5）：

```bash
# 在能解析 story-dev-postgres / 生产库的容器网络内执行
DATABASE_URL='postgresql://<user>:<pass>@<host>:5432/story' \
  node apps/server/scripts/migrate.mjs
```

预期输出：`apply 20261110000000_m4_prod_supplement` + `Applied 1 migration(s).`
（若已执行过：`skip ...` + `Database is up to date.`）

### 步骤 4 · 迁移后核对

```bash
./apps/server/scripts/prod-baseline-check.sh
```

**注意**：迁移会**有意改变**基线的三项数字，所以要按新口径核对：

| 项 | 迁移前（基线） | 迁移后（期望） |
| --- | --- | --- |
| `app` 表数 | 9 | **11**（+audio_cache +audio_job） |
| `age_band='3-6'` | 2190 | **721** |
| `age_band='6-9'` | 0 | **1176** |
| `age_band='9+'` | 7 | **300** |
| `story_category` 行数 | 15 | **14** |
| `story_main` 行数 | 2197 | **2197**（不变） |

迁移后应**更新 `prod-baseline-check.sh` 里的 `BASE_*` 常量与 08 号文档**，
把基线推进到迁移后的状态（连同新的快照时间）。

### 步骤 5 · 老站回归（D2：读通道不变）

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://story-api.xirizhi.cn/story/public/story_main?limit=1
```

要求 200。三张 legacy 表都在 `public`，本次迁移**不改它们的结构**，
只改了 `story_main.age_band` 的值与删了一个空分类行。

---

## 4. 验收标准

1. `prod-baseline-check.sh` 的漂移项为 0（按 §3 步骤 4 的新口径）；
2. 行数 `story_main=2197`、`story_content=2197`（迁移不增删内容）；
3. `app` 表 = 11 张，且 `prest_story` 对 `app` 的表权限 = 0；
4. 内容安全：`category_id IN (13,15,16,17) AND age_band<>'9+'` = **0**；
5. 老站三接口 200；
6. 幂等：把迁移记录删掉重跑一次，结果指纹（含逐行 `md5(age_band)`）完全一致。

---

## 5. 为什么不用 `prisma migrate deploy`（已拍板）

**口径（任务卡 `c-mwa0wamy-1hyz4`）**：老库用 `migrate.mjs`，`prisma migrate deploy`
**只用于全新空库**。`07-m4-plan.md` §4 已按此同步。

原因：

* 生产库与 dev 克隆都是 **Prisma 之前就存在的老库**（2197 条线上内容），且**没有
  Prisma 的迁移历史**；
* Prisma 对非空库要求先做 baseline，否则直接以 **P3005**
  （"The database schema is not empty"）拒绝执行 —— 已在克隆库上稳定复现；
* 绕过方式只有 `prisma migrate resolve --applied <name>` 逐条手工 baseline，
  等于绕过 Prisma 的迁移语义，收益为零。

**所以本项目用自带的幂等 runner**：[apps/server/scripts/migrate.mjs](../../apps/server/scripts/migrate.mjs)

| 模式 | 命令 | 用途 |
| --- | --- | --- |
| 应用 | `node scripts/migrate.mjs` | 按序应用待执行迁移 |
| 只读查看 | `node scripts/migrate.mjs --status` | 账本 + baseline + 待执行（不写库） |
| 老库记账 | `node scripts/migrate.mjs --mark-applied <name>` | 把**已存在**的迁移记为已应用，**不执行** |

### 5.1 baseline 标记

首次成功执行后，runner 会往 `public._m1_baseline` 写**一条**记录：

| 列 | 含义 |
| --- | --- |
| `id` | 固定 `'baseline'` |
| `baseline_at` | 首次执行时间（**只写一次，重跑不覆盖**） |
| `baseline_by` | 执行时的数据库角色（`current_user`） |
| `database_name` | 库名（`current_database()`） |
| `runner` | 固定 `migrate.mjs` |
| `applied_versions` | 那一刻的已应用版本（jsonb 数组） |
| `note` | 产生方式说明（正常应用 / `--mark-applied`） |

它是**冻结的快照**，故意不随后续迁移更新 —— 所以 `--status` 会分别显示
「baseline（冻结）」与「ledger（当前账本）」，两者数字不同是正常的。

查看：

```sql
SELECT * FROM public._m1_baseline;
```

或 `node scripts/migrate.mjs --status`。

---

## 6. 回滚口径

### 6.1 基线部分：**回滚不适用**

见 **10-prod-migration-baseline.md §4**（基线已被线上依赖、`app` schema 里已有
真实用户数据、API 已按新形态实现）。基线**冻结保留**。

### 6.2 本次补的三项：按「是否需要」分档

| 缺口 | 回滚方式 | 建议 |
| --- | --- | --- |
| A. `audio_cache`/`audio_job` | `DROP TABLE app.audio_cache, app.audio_job CASCADE;` | 可回滚（纯新增，无依赖）。但**回滚等于 M4 音频缓存不可用**，通常没必要 |
| B. 内容分级 | 反向 `UPDATE` 回旧值 | **不建议回滚** —— 回滚会把聊斋重新放给 3-6 的孩子，属内容安全回退 |
| C. 分类删除 | `INSERT` 回 `id=2` | 可回滚（一行空分类） |

### 6.3 灾难回滚（整库）

只有在迁移造成**意外破坏**时才用：

```bash
docker exec -i postgres pg_restore -U postgres -d story --clean --if-exists \
  --no-owner --no-privileges < /vol1/1000/story/backup/story-<date>.dump
```

⚠️ 这会把库恢复到快照时刻 —— **期间产生的真实用户数据会丢失**。
必须由人评估后执行。

---

## 7. 幂等性保证（已实测）

迁移文件满足：

* 所有建对象语句用 `IF NOT EXISTS`；
* 所有 `UPDATE` 带 `age_band IS DISTINCT FROM <目标>`，已正确的行不被触碰；
* 删除分类带 `NOT EXISTS (SELECT 1 FROM story_main WHERE category_id=c.id)`
  前置条件 —— 若该分类意外有内容，语句退化为 no-op，**不会级联删故事**；
* 权限语句全部 `REVOKE`（重复执行无副作用）。

**验证记录**（在 dev 库的生产基线克隆上，2026-11-10）：

| 验证 | 结果 |
| --- | --- |
| 首次执行 | `app` 表 9→11；分级 → 721/1176/300；分类 15→14 |
| 删掉记录行重跑（runner） | 指纹完全一致（含逐行 `md5(age_band)`） |
| 直接重复执行 `migration.sql` 三次 | 0 错误，状态稳定 |
| 给分类 2 挂 1 篇内容后再跑 | 分类 2 **保留未被删**（前置条件生效） |

---

## 8. 仍需产品负责人决定

1. **迁移窗口时间**（07-m4-plan §8.2）；
2. **是否授权 agent 生成脚本、由人在窗口执行**（默认如此，符合红线）；
3. **缺口 B 是否纳入本次窗口** —— 它是内容安全修正，建议必须纳入；
   若因故推迟，应临时在服务端加保险（例如按 `category_id` 兜底过滤），
   否则生产环境 3-6 首页仍可能放行聊斋。

> ✅ 已拍板（任务卡 `c-mwa0wamy-1hyz4`）：迁移工具口径 —— 老库用 `migrate.mjs`，
> `prisma migrate deploy` 只用于全新空库；`07-m4-plan.md` §4 已同步。
> ✅ 已拍板（任务卡 `c-mwa0wan6-28qf7`）：生产 M1 既成基线**冻结保留、不回滚**。
