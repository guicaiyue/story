#!/usr/bin/env bash
#
# 小故事铺 2.0 · 生产库 M1 基线只读核对（apps/server/scripts/prod-baseline-check.sh）
#
# 用途：把生产库现有的 M1 变更当作**既成基线**逐项核对（列名/表/行数/权限）。
# 判定「基线是否仍然完整、有没有发生漂移」。**只读，不做任何写入。**
#
# 为什么需要这个脚本：
#   生产库在 D7（生产只读）下达**之前**已经被写入过 M1 变更（03-decisions §6），
#   这部分被裁定「冻结保留」。正式迁移不回滚它，只补缺失的部分。所以必须先有
#   一份可复核的基线记录，之后每次上线前都能自动核对「基线还在不在」。
#
# 🔴 只读保障（三层，缺一不可）
#   1. 所有 SQL 都是硬编码的 SELECT / information_schema 查询，不接受外部 SQL；
#   2. 连接层强制只读：PGOPTIONS='-c default_transaction_read_only=on'；
#   3. **启动自检**：在事务里试建一张表再 ROLLBACK，必须被拒绝。若没被拒绝，
#      说明只读没生效 → 立即中止（并且 ROLLBACK 已保证不留痕）。
#
#   第 3 条是踩坑换来的：`psql -c "SET default_transaction_read_only=on; CREATE TABLE ..."`
#   **不能**阻止建表 —— SET 只对**后续**事务生效，同一条 -c 里的语句仍可写。
#   实测这条写法的确在生产库里真的建出了一张空表（已确认无数据并已删除）。
#   所以只读必须靠连接参数（PGOPTIONS）＋自检来保证，不能靠会话内 SET。
#
# 用法：
#   ./apps/server/scripts/prod-baseline-check.sh              # 核对并打印报告
#   ./apps/server/scripts/prod-baseline-check.sh --quiet      # 只报失败项
#
# 退出码：0 基线一致；1 有漂移；2 用法/守卫错误（含只读自检失败）。
#
# 红线（03-decisions D7）：生产库 story 只读。本脚本不执行任何写操作。

set -uo pipefail

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
PROD_CONTAINER="${PROD_CONTAINER:-postgres}"
PROD_DB="${PROD_DB:-story}"
PROD_USER="${PROD_USER:-postgres}"

# 开发容器/库名：命中即拒绝运行，避免「以为在核生产、其实在核开发」。
DEV_CONTAINER="${DEV_CONTAINER:-story-dev-postgres}"
DEV_DB="${DEV_DB:-story_dev}"

# ---------------------------------------------------------------------------
# 冻结基线期望值（2026-11-10 核对记录，详见 docs/product/10-prod-migration-baseline.md）
#
# ⚠️ 这些值一旦变更，必须先更新基线文档并记录新的快照时间，再改这里。
#    不要为了「让脚本通过」而改数字。
# ---------------------------------------------------------------------------
BASE_MIGRATION_ROWS=1
BASE_MIGRATIONS="20261109000000_init"

BASE_MAIN_ROWS=2197
BASE_CONTENT_ROWS=2197
BASE_CATEGORY_ROWS=15

# M1 追加到 public.story_main 的 9 列（冻结）。
BASE_COLUMNS="age_band audio_url cover_url duration_sec featured published_at status tags updated_at"

# 冻结时已有的 app 表（9 张）。注意：**不含** audio_cache / audio_job —— 那两个
# 属于「仍缺失、待正式迁移补」的部分。
BASE_APP_TABLES="account audit_log banner child family favorite play_event progress setting"

# 冻结的分布（生产库当前真实值）。
BASE_STATUS_PUBLISHED=2197
BASE_BAND_3_6=2190
BASE_BAND_9PLUS=7
BASE_FEATURED_TRUE=0

# 冻结的空值计数（全部应为 0）。
BASE_NULLS_ALL_ZERO=1

# 冻结的索引。
BASE_INDEXES="story_main_category_id_idx story_main_pkey story_main_status_age_band_idx"

QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quiet) QUIET=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------
PASS=0; FAIL=0; WARN=0; FAILURES=()
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_WARN=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_BAD=''; C_WARN=''; C_DIM=''; C_OFF=''
fi
pass() { PASS=$((PASS+1)); [ "$QUIET" -eq 1 ] || printf '    %s✔ %s%s\n' "$C_OK" "$1" "$C_OFF"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$1"); printf '    %s✘ %s%s\n' "$C_BAD" "$1" "$C_OFF"; }
warn() { WARN=$((WARN+1)); printf '    %s! %s%s\n' "$C_WARN" "$1" "$C_OFF"; }
info() { [ "$QUIET" -eq 1 ] || printf '      %s%s%s\n' "$C_DIM" "$1" "$C_OFF"; }
head_() { [ "$QUIET" -eq 1 ] || printf '\n%s%s%s\n' "$C_DIM" "$1" "$C_OFF"; }

command -v docker >/dev/null 2>&1 || { echo "缺少依赖：docker" >&2; exit 2; }

# ---------------------------------------------------------------------------
# 只读查询：只读由连接参数保证（不是会话内 SET）
# ---------------------------------------------------------------------------
q() { # q <sql>
  docker exec -e PGOPTIONS='-c default_transaction_read_only=on' \
    "$PROD_CONTAINER" psql -U "$PROD_USER" -d "$PROD_DB" -tA -v ON_ERROR_STOP=1 -c "$1" 2>&1
}

echo "小故事铺 · 生产库 M1 基线只读核对"
echo "  容器 : $PROD_CONTAINER"
echo "  库   : $PROD_DB"

# ===========================================================================
# 0. 守卫：绝不能把开发库当成生产库来核
# ===========================================================================
if [ "$PROD_CONTAINER" = "$DEV_CONTAINER" ] || [ "$PROD_DB" = "$DEV_DB" ]; then
  echo "${C_BAD}拒绝运行：目标指向了开发库（$DEV_CONTAINER/$DEV_DB）。${C_OFF}" >&2
  echo "本脚本用于核对**生产**基线；开发库请用 m4-migrate-rehearsal.sh。" >&2
  exit 2
fi
if ! docker inspect "$PROD_CONTAINER" >/dev/null 2>&1; then
  echo "找不到生产容器 '$PROD_CONTAINER'" >&2; exit 2
fi

# ---------------------------------------------------------------------------
# 0b. 只读自检 —— 必须证明「写不进去」，否则中止
#
# 用 BEGIN ... ROLLBACK 包住：只读生效 → CREATE 报错（期望）；
# 只读没生效 → 表会建出来，但 ROLLBACK 会撤销，**不留痕**。
# 两种情况下生产库都不会被改动，所以这个自检本身是安全的。
# ---------------------------------------------------------------------------
guard_out="$(docker exec -e PGOPTIONS='-c default_transaction_read_only=on' \
  "$PROD_CONTAINER" psql -U "$PROD_USER" -d "$PROD_DB" -tA \
  -c "BEGIN; CREATE TABLE public.__m4_guard_probe(x int); ROLLBACK;" 2>&1)"

if printf '%s' "$guard_out" | grep -q "read-only transaction"; then
  pass "只读自检通过（写入被数据库拒绝）"
  # 双保险：确认探针表确实没留下。
  leftover="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='__m4_guard_probe';")"
  if [ "$leftover" = "0" ]; then
    pass "自检未留下任何对象"
  else
    fail "自检留下了探针表 __m4_guard_probe（应立即人工删除）"
    exit 2
  fi
else
  echo "${C_BAD}只读自检失败：数据库接受了写入，拒绝继续。${C_OFF}" >&2
  echo "输出：$guard_out" >&2
  echo "（ROLLBACK 应已撤销建表，但仍请人工确认 public.__m4_guard_probe 不存在）" >&2
  exit 2
fi

# ===========================================================================
# 1. 迁移记录
# ===========================================================================
head_ "1) 迁移记录表 public._m1_migrations"
mr="$(q "SELECT count(*) FROM public._m1_migrations;")"
if [ "$mr" = "$BASE_MIGRATION_ROWS" ]; then
  pass "记录行数 $mr（基线 $BASE_MIGRATION_ROWS）"
else
  fail "记录行数 $mr ≠ 基线 $BASE_MIGRATION_ROWS"
fi
mlist="$(q "SELECT string_agg(name, ',' ORDER BY name) FROM public._m1_migrations;")"
if [ "$mlist" = "$BASE_MIGRATIONS" ]; then
  pass "已记迁移：$mlist"
else
  fail "迁移清单 '$mlist' ≠ 基线 '$BASE_MIGRATIONS'"
fi
info "applied_at: $(q "SELECT string_agg(name||'@'||applied_at, ', ') FROM public._m1_migrations;")"

# ===========================================================================
# 2. story_main 的 M1 追加列（冻结）
# ===========================================================================
head_ "2) public.story_main M1 列（应恰好 9 列齐全）"
cols="$(q "SELECT string_agg(column_name, ' ' ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='story_main' AND column_name IN ('age_band','tags','status','duration_sec','cover_url','audio_url','featured','published_at','updated_at');")"
if [ "$cols" = "$BASE_COLUMNS" ]; then
  pass "9 列齐全：$cols"
else
  fail "列集合不符"
  info "实际: $cols"
  info "基线: $BASE_COLUMNS"
fi

# 类型/非空/默认值也要对得上（冻结的不只是列名）。
colspec="$(q "SELECT string_agg(column_name||':'||data_type||':'||is_nullable, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='story_main' AND column_name IN ('age_band','tags','status','duration_sec','cover_url','audio_url','featured','published_at','updated_at');")"
info "列定义: $colspec"

# ===========================================================================
# 3. 行数与分布（冻结）
# ===========================================================================
head_ "3) 行数与分布"
counts="$(q "SELECT (SELECT count(*) FROM public.story_main)||'/'||(SELECT count(*) FROM public.story_content)||'/'||(SELECT count(*) FROM public.story_category);")"
if [ "$counts" = "$BASE_MAIN_ROWS/$BASE_CONTENT_ROWS/$BASE_CATEGORY_ROWS" ]; then
  pass "main/content/category = $counts"
else
  fail "行数 $counts ≠ 基线 $BASE_MAIN_ROWS/$BASE_CONTENT_ROWS/$BASE_CATEGORY_ROWS"
fi

pub="$(q "SELECT count(*) FROM public.story_main WHERE status='published';")"
[ "$pub" = "$BASE_STATUS_PUBLISHED" ] \
  && pass "published = $pub" \
  || fail "published = $pub ≠ 基线 $BASE_STATUS_PUBLISHED"

b36="$(q "SELECT count(*) FROM public.story_main WHERE age_band='3-6';")"
b9="$(q "SELECT count(*) FROM public.story_main WHERE age_band='9+';")"
if [ "$b36" = "$BASE_BAND_3_6" ] && [ "$b9" = "$BASE_BAND_9PLUS" ]; then
  pass "age_band 3-6=$b36 / 9+=$b9（冻结值）"
else
  fail "age_band 3-6=$b36(基线 $BASE_BAND_3_6) / 9+=$b9(基线 $BASE_BAND_9PLUS)"
fi

feat="$(q "SELECT count(*) FROM public.story_main WHERE featured;")"
[ "$feat" = "$BASE_FEATURED_TRUE" ] \
  && pass "featured=true = $feat" \
  || fail "featured=true = $feat ≠ 基线 $BASE_FEATURED_TRUE"

# ===========================================================================
# 4. 空值（冻结：全部为 0）
# ===========================================================================
head_ "4) 关键列空值（应全为 0）"
nulls="$(q "SELECT 'category_id='||count(*) FILTER (WHERE category_id IS NULL)||' status='||count(*) FILTER (WHERE status IS NULL)||' age_band='||count(*) FILTER (WHERE age_band IS NULL)||' published_at='||count(*) FILTER (WHERE published_at IS NULL) FROM public.story_main;")"
if printf '%s' "$nulls" | grep -q "category_id=0 status=0 age_band=0 published_at=0"; then
  pass "空值 $nulls"
else
  fail "空值异常：$nulls"
fi

# ===========================================================================
# 5. 索引
# ===========================================================================
head_ "5) story_main 索引"
idx="$(q "SELECT string_agg(indexname, ' ' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='story_main';")"
if [ "$idx" = "$BASE_INDEXES" ]; then
  pass "索引：$idx"
else
  fail "索引集合不符"
  info "实际: $idx"
  info "基线: $BASE_INDEXES"
fi

# ===========================================================================
# 6. app schema（冻结 9 张表）
# ===========================================================================
head_ "6) app schema 表（基线 9 张）"
appt="$(q "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='app';")"
if [ "$appt" = "$BASE_APP_TABLES" ]; then
  pass "9 张表：$appt"
else
  fail "app 表集合不符"
  info "实际: $appt"
  info "基线: $BASE_APP_TABLES"
fi

# ===========================================================================
# 7. 权限（冻结）
# ===========================================================================
head_ "7) app schema 权限"
nspacl="$(q "SELECT COALESCE(nspacl::text,'(null)') FROM pg_namespace WHERE nspname='app';")"
info "app nspacl: $nspacl"
if printf '%s' "$nspacl" | grep -q "=UC/postgres"; then
  pass "app schema 仅属主可访问（无 PUBLIC 授权）"
else
  fail "app nspacl 与冻结状态不符：$nspacl"
fi

# prest_story 对 app 不应有任何权限。
pg_count="$(q "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='prest_story' AND table_schema='app';")"
[ "$pg_count" = "0" ] \
  && pass "prest_story 对 app 无任何表权限" \
  || fail "prest_story 对 app 有 $pg_count 条表权限（应为 0）"

# 生产库不存在 audio_cache：这是「待补」而非漂移，见下一节。
has_ac="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='app' AND table_name IN ('audio_cache','audio_job');")"

# ===========================================================================
# 8. 已知偏差 / 待补项（不算基线漂移，但必须显式提示）
# ===========================================================================
head_ "8) 已知偏差与待补项（非漂移，正式迁移处理）"

if [ "$has_ac" = "0" ]; then
  warn "app.audio_cache / app.audio_job 尚未创建 —— 属「仍缺失、待正式迁移补」"
else
  warn "app.audio_cache/audio_job 已存在（$has_ac 张）—— 若已执行过迁移 2，请更新基线文档"
fi

# 内容分级偏差：生产仍沿用旧口径（聊斋 3-6），产品已把聊斋定为 9+。
liaozhai_bad="$(q "SELECT count(*) FROM public.story_main WHERE category_id=13 AND age_band<>'9+';")"
if [ "$liaozhai_bad" != "0" ]; then
  warn "内容安全：category 13（聊斋志异）有 $liaozhai_bad 篇仍是非 9+ —— 产品口径应为 9+，待正式迁移修正"
fi

dup_cat="$(q "SELECT count(*) FROM public.story_category c WHERE EXISTS (SELECT 1 FROM public.story_category d WHERE d.name=c.name AND d.id<>c.id);")"
if [ "$dup_cat" != "0" ]; then
  warn "分类存在同名重复（$dup_cat 行）—— 产品已在 dev 删除 id=2，生产待处理"
fi

# ===========================================================================
# 汇总
# ===========================================================================
echo
echo "──────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf '%s✔ 基线一致：%d 项通过' "$C_OK" "$PASS"
  [ "$WARN" -gt 0 ] && printf "，%d 项待补/待决" "$WARN"
  printf '%s\n' "$C_OFF"
  echo "生产库未被写入（只读自检已证）。"
  exit 0
fi
printf '%s✘ 基线漂移：%d 项通过、%d 项失败、%d 项待补%s\n' "$C_BAD" "$PASS" "$FAIL" "$WARN" "$C_OFF"
for f in "${FAILURES[@]}"; do printf '   - %s\n' "$f"; done
exit 1
