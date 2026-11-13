# 10 · 生产库 M1 基线（既成事实，冻结）

> 编号说明：本文件原为 `08-prod-migration-baseline.md`。因上线方案按产品要求
> 落在 `08-launch-plan.md`，本文件改编号为 **10**（内容未变），全部引用已同步。

> 决策来源：任务卡 `c-mwa0wan6-28qf7` —— 把生产库现有的 M1 变更当作**既成基线**
> 写进正式迁移方案：只做只读核对并冻结，不回滚。
>
> 本文档记录**基线的确切内容 + 核对方法 + 为什么不适用回滚**。
> 正式迁移的缺口清单见 **09-prod-migration-runbook.md**。

---

## 1. 快照时间与来源

| 项 | 值 |
| --- | --- |
| 基线快照时间 | **2026-11-10（M4 会话，Asia/Shanghai）** |
| 核对方式 | 只读 SQL（`information_schema` / `pg_indexes` / `pg_namespace`） |
| 核对脚本 | [apps/server/scripts/prod-baseline-check.sh](../../apps/server/scripts/prod-baseline-check.sh) |
| 生产库 | 容器 `postgres`，库 `story`，PostgreSQL 16.14，28 MB |
| 迁移记录 | `20261109000000_init @ 2026-11-09 11:33:00.792826+00` |

**基线写入的实际时间早于本次核对**：`_m1_migrations.applied_at` 显示
`2026-11-09 11:33:00 UTC`（= 19:33 本地）。这次核对只是**记录并冻结**它，
没有做任何写入。

---

## 2. 基线内容（逐项冻结）

### 2.1 `public.story_main` 追加的 9 列

| 列 | 类型 | NULL | 默认 |
| --- | --- | --- | --- |
| `age_band` | text | NOT NULL | `'3-6'` |
| `tags` | text[] | NOT NULL | `'{}'` |
| `status` | text | NOT NULL | `'published'` |
| `duration_sec` | integer | NOT NULL | `0` |
| `cover_url` | text | NULL | — |
| `audio_url` | text | NULL | — |
| `featured` | boolean | NOT NULL | `false` |
| `published_at` | timestamptz | NULL | — |
| `updated_at` | timestamptz | NOT NULL | `now()` |

### 2.2 行数与分布

| 项 | 冻结值 |
| --- | --- |
| `story_main` / `story_content` / `story_category` | **2197 / 2197 / 15** |
| `status='published'` | **2197**（全部已发布） |
| `age_band='3-6'` / `'9+'` | **2190 / 7** |
| `featured=true` | **0** |
| 空值（category_id / status / age_band / published_at） | **全为 0** |

### 2.3 索引

`story_main_pkey`、`story_main_status_age_band_idx`、`story_main_category_id_idx`

### 2.4 `app` schema —— 9 张表（冻结）

`account` `audit_log` `banner` `child` `family` `favorite` `play_event`
`progress` `setting`

### 2.5 权限（冻结）

| 对象 | 状态 |
| --- | --- |
| `app` nspacl | `{postgres=UC/postgres}` —— 仅属主，无 PUBLIC 授权 |
| `prest_story` 对 `app` 的表权限 | **0 条** |
| `public` nspacl | `anon=U`, `lingxibi=U`, `prest_story=U`（老站读通道，**保持不动**） |

> `public` 的授权是 D2「pREST 读通道不变」的一部分，**不属于**本轮要收紧的范围。
> 公网 pREST 的写穿透问题见 03-decisions §7 与 04-prest-hardening-plan.md。

---

## 3. 核对 SQL（可直接复制执行，全部只读）

```sql
-- 0) 只读保障：连接层强制。注意不要用 `SET default_transaction_read_only=on;`
--    和 DDL 写在同一条 -c 里 —— 那样**拦不住**（见 §5 的教训）。
--    psql 请加：PGOPTIONS='-c default_transaction_read_only=on'

-- 1) 迁移记录
SELECT name, applied_at FROM public._m1_migrations ORDER BY 1;

-- 2) M1 的 9 列（含类型/非空/默认）
SELECT column_name, data_type, is_nullable, COALESCE(column_default,'-') AS dflt
FROM information_schema.columns
WHERE table_schema='public' AND table_name='story_main'
  AND column_name IN ('age_band','tags','status','duration_sec','cover_url',
                      'audio_url','featured','published_at','updated_at')
ORDER BY column_name;

-- 3) 行数与分布
SELECT (SELECT count(*) FROM public.story_main)     AS main,
       (SELECT count(*) FROM public.story_content)  AS content,
       (SELECT count(*) FROM public.story_category) AS category,
       (SELECT count(*) FROM public.story_main WHERE status='published') AS published,
       (SELECT count(*) FROM public.story_main WHERE age_band='3-6')     AS band_3_6,
       (SELECT count(*) FROM public.story_main WHERE age_band='9+')      AS band_9plus,
       (SELECT count(*) FROM public.story_main WHERE featured)           AS featured_true;

-- 4) 空值
SELECT count(*) FILTER (WHERE category_id  IS NULL) AS cat_null,
       count(*) FILTER (WHERE status       IS NULL) AS status_null,
       count(*) FILTER (WHERE age_band     IS NULL) AS band_null,
       count(*) FILTER (WHERE published_at IS NULL) AS pub_null
FROM public.story_main;

-- 5) 索引
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='story_main' ORDER BY 1;

-- 6) app 表
SELECT table_name FROM information_schema.tables
WHERE table_schema='app' ORDER BY 1;

-- 7) 权限
SELECT nspname, nspacl FROM pg_namespace WHERE nspname IN ('app','public');
SELECT count(*) AS prest_app_grants FROM information_schema.role_table_grants
WHERE grantee='prest_story' AND table_schema='app';
```

自动核对（推荐，含只读自检）：

```bash
./apps/server/scripts/prod-baseline-check.sh
```

退出码 `0` 表示基线一致；`1` 表示漂移；`2` 表示守卫/用法错误。

---

## 4. 为什么不回滚（**回滚不适用**）

1. **基线已被业务依赖。** 老站（storynook.cn / story-api.xirizhi.cn）正在线上
   读取 `public` 三表；`status` / `published_at` 回填后，公开接口才只返回
   已发布内容。回滚列或回填值会直接改变线上行为。
2. **回滚本身比保留更危险。** 要回滚 9 列意味着 `DROP COLUMN` + 丢掉回填值；
   `app` schema 里有账号/收藏/进度等**已经产生真实用户数据**的表。回滚等于
   删用户数据。
3. **决策已裁定。** 03-decisions §6 明确「冻结保留」，本任务卡再次确认。
4. **API 已按新形态实现。** 服务端整套代码（Prisma schema、路由、TTS 索引）
   都假设这 9 列与 `app` schema 存在；回滚会让 M1–M4 的代码全部失效。

因此正式迁移**只补缺口**（见 09 号文档），不重建、不覆盖基线里已有的对象。

---

## 5. ⚠️ 教训：只读守卫不能靠会话内 `SET`

本轮核对时踩到一个真实坑，记录在此以免重犯：

```bash
# ❌ 这样**拦不住**写入 —— SET 只对**后续**事务生效，
#    同一条 -c 里的语句仍在可写的事务里执行。
psql -c "SET default_transaction_read_only = on; CREATE TABLE public.t_probe(x int);"
# → CREATE TABLE   ← 真的建出来了
```

上例在生产库里**确实建出了一张空表**（`public.t_probe`，0 行），已确认无数据
后立即删除，并核对生产库恢复到 2197/2197/15、`public` 恰好 4 张表。

**可靠做法（三选一，都已实测能拦住写入）**：

| 手法 | 结果 |
| --- | --- |
| `PGOPTIONS='-c default_transaction_read_only=on' psql -c "..."` | ✔ 拦住 |
| `psql -c "BEGIN TRANSACTION READ ONLY; ...; COMMIT;"` | ✔ 拦住 |
| `psql -c "SET default_transaction_read_only=on" -c "DDL"`（分两条 `-c`） | ✔ 拦住 |

`prod-baseline-check.sh` 用的是 **PGOPTIONS**，并在启动时**自检**：
在事务里试建表再 `ROLLBACK`，若没被拒绝就立即中止（`ROLLBACK` 保证不留痕）。

---

## 6. 与其他文档的关系

| 文档 | 关系 |
| --- | --- |
| 03-decisions §6 | 基线写入的历史披露与「冻结保留」裁定 |
| 03-decisions D7 | 生产库只读红线 |
| **09-prod-migration-runbook.md** | 正式迁移：缺口清单、执行顺序、验收、回滚口径 |
| 07-m4-plan.md §4 | M4 原计划（**其 `prisma migrate deploy` 一步在本库不可行**，见 09 号文档 §5） |
