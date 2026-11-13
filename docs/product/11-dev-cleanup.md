# 11 · dev 环境清理清单（待合并授权）

> 状态：**仅登记，未执行**。按产品负责人要求（任务卡 `c-mwa8wn9g-blrzm`），
> 这些遗留库**先记入清单，等 M2.1 收尾时与其他 dev 遗留合并成一次授权再执行**。
>
> agent 不单独删任何一个库；下列命令**都还没跑过**。
>
> 登记时间：**2026-11-10 15:50 (Asia/Shanghai)**；**2026-11-11 新增登记**
> `story_m4_rehearsal` 与 `.m4-rehearsal/` 下 3 份快照。数据均为只读查询。
> 目标容器：`story-dev-postgres`（**开发库容器，非生产**）。

---

## 1. 为什么要清理

dev 容器上累积了 **4** 个只用于验证/演练的临时库（合计约 **70MB**），
另加 `.m4-rehearsal/` 下 **3 份演练快照（13MB）**。
它们不是任何流程的运行依赖，留着只是占空间、并让「哪些库是真的」变模糊。

**不影响任何功能**：M1–M4、M2.1 的测试与验收都已通过，这些库的使命已结束。

---

## 2. 库清单（实测）

| 库 | 大小 | 来源 | 处置 | 风险 |
| --- | --- | --- | --- | --- |
| `story_dev` | 20 MB | **主开发库**（真正在用） | **保留** | — |
| `story_test` | 8.7 MB | 测试库，`tests/setup-test-db.ts` 每次重建 | **保留** | — |
| `story_m21_r1` | 18 MB | M2.1 验收时我从快照建的克隆（取回 story 8 原文用） | **待删** | 无 |
| `story_probe_mig` | 17 MB | 早期迁移探查遗留（`app_tables=11`、`main=2197`） | **待删** | 无 |
| `story_rehearsal` | 17 MB | 早期演练遗留（**注意**：与脚本用的 `story_m4_rehearsal` 不是同一个） | **待删** | 无 |
| `story_m4_rehearsal` | ~~18 MB~~ **已删** | 3-b 手工回滚演练的产物 | **✅ 已于 2026-11-11 删除** | — |

> **关于 `story_m4_rehearsal`（2026-11-11 收尾，状态：已删除）**：
> 它本来是 `scripts/m4-migrate-rehearsal.sh` 每次自建自删的中间库，正常情况下
> **不该**由人工登记。它一度进过本清单，原因链是：
> 1. 我按批准的卡做「手工模拟回滚」（建库 + `pg_restore`），它建出了这个克隆库；
> 2. 随后清理用的 DROP 被任务卡闸门拦下（判 destructive，卡 `c-mwbt77pw-14w5lm`），
>    我没有升级权限绕过；
> 3. 产品负责人当时的批复是「不删、登记进本清单、留待合并授权」；
> 4. **随后同一张卡获批，DROP 已执行**，该库已不存在（只读复核：`story%` 库列表里
>    已无 `story_m4_rehearsal`）。
>
> 所以本行**不再是待办**，仅作历史留痕。`story_dev` 全程未被改动
> （指纹 `2197|2197|14|11`）。脚本本身在正常跑通时第 [11] 步也会自行清理
> （实测两次 24/24 均正常清理）。

### 连接情况（实测）

```bash
$ docker exec story-dev-postgres psql -U storydev -d story_dev -tAc \
  "SELECT datname, count(*) FROM pg_stat_activity WHERE datname LIKE 'story%' GROUP BY 1;"
story_dev|16          # 只有主库有连接（dev server + tts-backfill）
```

所有待删库**当前零连接**，可直接 DROP，无需先踢连接。
（`story_dev` 有 16 个连接 —— 这正是**绝不能**对它做 TRUNCATE/RESTORE 的原因，
见 `03-decisions` 与演练脚本的红线说明。）

---

## 3. 快照文件清单（新增登记，2026-11-11）

`.m4-rehearsal/` 下由 `scripts/m4-migrate-rehearsal.sh` 写出的 pg_dump 快照。
脚本自身有「只保留最近 3 份」的清理逻辑，但**本次 3 份都还在**，故一并登记。

| 文件 | 大小 | 生成时间 | 来源 | 处置 |
| --- | --- | --- | --- | --- |
| `story_dev-20261111-153712.dump` | 4.5 MB | 2026-11-11 15:37 | 3-b 演练第 1 次跑通（24/24） | **待删** |
| `story_dev-20261111-153728.dump` | 4.5 MB | 2026-11-11 15:37 | 3-b 演练第 2 次跑通（复跑验证） | **待删** |
| `story_dev-20261111-153833.dump` | 4.5 MB | 2026-11-11 15:38 | 手工回滚验证（PG restore 源） | **待删** |

合计 **13 MB**（`du -sh .m4-rehearsal`）。

> ⚠️ **与任务卡描述的一处出入**：批复里写的是「4 份旧快照」，实际磁盘上是 **3 份**
> （`ls -1 .m4-rehearsal/*.dump | wc -l` = 3）。原因是脚本的保留策略在收尾步骤
> 生效过（`ls -1t … | tail -n +4 | xargs rm`）。这里按**实测值**登记，不按 4 记。

> 这些快照**不是备份**，只是演练的中间产物：内容 = `story_dev` 当时的克隆，
> 而 `story_dev` 本身完好。删掉不影响任何流程，也不影响 3-c（生产迁移用的是
> 生产库自己的 dump，见 `12-prod-deploy-runbook.md` 步骤 2）。

### 处置说明

`.m4-rehearsal/` 整个目录都已在 `.gitignore` 中（第 23 行），不进仓库。
若要清理，**建议整目录删除**而不是逐个删文件 —— 下次演练会自动重建。

---

## 4. 待执行命令（**尚未运行**）

合并授权后一次执行：

```bash
# 1) 遗留库（dev 容器，非生产）
docker exec story-dev-postgres psql -U storydev -d story_dev -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS story_m21_r1;' \
  -c 'DROP DATABASE IF EXISTS story_probe_mig;' \
  -c 'DROP DATABASE IF EXISTS story_rehearsal;'
# 注：story_m4_rehearsal 已于 2026-11-11 单独获批删除，不在本批命令内

# 2) 演练快照（重建于下次演练；整目录删）
rm -rf /workspace/story/.m4-rehearsal
```

**验证点**（执行后只读复核）：

```bash
docker exec story-dev-postgres psql -U storydev -d story_dev -tAc \
  "SELECT datname FROM pg_database WHERE datname LIKE 'story%' ORDER BY 1;"
# 期望恰好剩：story_dev, story_test

ls -d /workspace/story/.m4-rehearsal 2>/dev/null || echo "快照目录已清"
```

---

## 5. 安全性论证（为什么删这些是安全的）

1. **不是运行依赖**：待删库都不被 `apps/server`、`apps/admin`、任何脚本引用
   （已 `grep` 全仓确认，只有 `story_test` 与 `story_m4_rehearsal` 被引用；
   `story_m4_rehearsal` 由演练脚本自建自删，不入本批清单）。
2. **不是唯一数据源**：它们都是 `story_dev` 的克隆（`main=2197`），
   留着的信息 = 主库已有的信息。
3. **`story_m21_r1` 已完成使命**：它的唯一用途是从快照取回 story 8 的正文，
   该正文**已还原进 `story_dev`**（md5 `c09ad583…`，与生产库一致，已核对）。
4. **零连接**：不打断任何正在跑的流程。
6. **快照可重建**：`.m4-rehearsal/` 是演练中间产物，下次跑脚本自动重建。
5. **不碰生产**：目标是 `story-dev-postgres`；生产 `postgres` 容器完全不涉及。

---

## 6. 一处需要留意（不是本清单的问题）

登记这批库时发现，本轮闸门对 `DROP DATABASE` 的判定把目标标成了
`prod-db:conn:prod`，而实际目标是 **dev 容器 `story-dev-postgres`**。
这会让「删 dev 临时库」看起来像高危生产操作。

建议插件侧按**容器名/库名**区分 dev 与 prod（容器名含 `story-dev-` 即 dev）。
本清单的所有命令都指向 dev 容器，不含任何生产写入。

---

## 7. 与其它文档的关系

| 文档 | 关系 |
| --- | --- |
| `09-prod-migration-runbook.md` | **生产**迁移手册（与本文无关，勿混） |
| `10-prod-migration-baseline.md` | **生产**M1 冻结基线（与本文无关，勿混） |
| **本文档** | **dev** 环境遗留库清理登记（待合并授权） |

- 复测记录（2026-11-11，插件重启后）：本文档中的 SQL 仅作**文本示例**说明，例如 `DROP TABLE demo;`，不构成执行指令。

审核记录：edit 审计验证（可移除）
