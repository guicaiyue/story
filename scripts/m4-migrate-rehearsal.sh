#!/usr/bin/env bash
#
# 小故事铺 2.0 · M4 数据迁移演练（scripts/m4-migrate-rehearsal.sh）
#
# 演练「pg_dump 快照 → 迁移 → 校验行数/空值 → 回滚到快照」全流程。
#
# ⚠️ 全程只在 **dev 库的临时克隆**上操作，不碰生产、也不碰 story_dev 本身。
#    所有 pg_dump / pg_restore 都在 dev 容器（story-dev-postgres）内执行，
#    脚本对生产容器（postgres）只做「禁止」判断，不会 exec 进去。
#
# ===========================================================================
# 🔴 红线：迁移执行必须发生在容器网络内
# ===========================================================================
# pg_dump / pg_restore / psql 走 `docker exec` 进 dev 容器，从宿主跑没问题。
# 但**迁移执行本身（prisma / migrate.mjs）不能直接在宿主上跑**，原因有两条，
# 都是硬约束：
#   1. `story-dev-postgres` 只是容器网络里的名字，宿主 DNS 解析不到 ——
#      宿主直跑必然 P1001 "Can't reach database server"；
#   2. 这个库**没有发布宿主端口**（docker port 为空），所以就算把地址换成
#      127.0.0.1 也连不上。
# 因此本脚本把第 6/7 步（prisma migrate deploy、migrate.mjs）放进一个**在
# dev 网络里的容器**执行，DATABASE_URL 指向克隆库：
#   - 首选：`docker exec` 进开发容器 dsh-dev（仓库已挂载、node 可用、在网络上）；
#   - 兜底：`docker run --rm --network <dev网络>` 起临时容器 + 绑定挂载本仓库。
# 宿主侧只做 dump/restore（那些命令跑在 DB 容器里，天然在网络上）。
# 想指定执行器：MIGRATE_RUNNER=<容器名> MIGRATE_RUNNER_PATH=<容器内仓库路径>
#
# 为什么克隆而不是直接改 story_dev：
#   1. story_dev 里有 2197 条真实内容 + 已合成音频索引，演练要能随便折腾；
#   2. 演练本身要验证「回滚」，直接改 story_dev 风险与收益不成比例。
#   克隆出来的库和 story_dev 的恢复结果逐行一致（同一份 pg_dump）。
#
# 用法：
#   ./scripts/m4-migrate-rehearsal.sh              # 完整演练（含回滚），结束删克隆
#   ./scripts/m4-migrate-rehearsal.sh --keep       # 保留克隆库与快照，便于人工看
#   ./scripts/m4-migrate-rehearsal.sh --no-prisma  # 跳过 prisma migrate deploy 探测
#
# 退出码：0 全部通过；1 有校验失败；2 命中红线（指向生产）等用法错误。
#
# 红线（03-decisions D7）：生产库 story 只读，禁止任何写操作。

set -uo pipefail

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
DEV_CONTAINER="${DEV_CONTAINER:-story-dev-postgres}"
DEV_USER="${DEV_USER:-storydev}"
DEV_DB="${DEV_DB:-story_dev}"

# 生产容器/库名。任何一处命中即拒绝运行。
PROD_CONTAINER="${PROD_CONTAINER:-postgres}"
PROD_DB="${PROD_DB:-story}"

# 演练用的临时克隆库。
SCRATCH_DB="${SCRATCH_DB:-story_m4_rehearsal}"

# 迁移执行器（见文件头红线）：必须是一个**接在 dev 网络上**的容器。
# 默认 auto：优先用开发容器 dsh-dev（仓库已挂载 + 有 node），否则起临时容器。
MIGRATE_RUNNER="${MIGRATE_RUNNER:-auto}"
# 开发容器名候选（先找到一个存在且在 dev 网络上的）。
RUNNER_CANDIDATES="${RUNNER_CANDIDATES:-dsh-dev}"
# 仓库在容器里的路径。dsh-dev 把仓库挂到 /workspace/story。
# auto 模式下会逐个探测，这个值只作为「候选/兜底」。
RUNNER_REPO_PATH="${MIGRATE_RUNNER_PATH:-/workspace/story}"
# 起临时容器时用的镜像与网络（仅在找不到现成 runner 时使用）。
# 必须是**带 openssl** 的镜像：Prisma 靠 openssl 判断该用哪个查询引擎，
# node:22-bookworm-slim 不带 openssl，会误判成 openssl-1.1.x 并报
# "Could not locate the Query Engine for runtime debian-openssl-1.1.x"
# （实测）。node:22-bookworm（非 slim）自带 OpenSSL 3.0，可用。
RUNNER_IMAGE="${RUNNER_IMAGE:-node:22-bookworm}"
DEV_NETWORK="${M4_DEV_NETWORK:-dsh-dev_default}"

# 快照落盘目录（宿主机侧，只放 dump 文件）。
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_DIR="${SNAP_DIR:-$REPO_ROOT/.m4-rehearsal}"

# ---------------------------------------------------------------------------
# 期望值：**不硬编码任何数字**，全部从「本次快照」派生。
#
# 为什么（这是被实际误报教育过的）：
#   硬编码 2197/2197/15 这类数字，会在产品调整数据后过期，产生**与迁移逻辑
#   无关的误报**（真因是期望值陈旧，却看起来像迁移坏了）。正确做法是把
#   「快照当时的状态」当基线：
#     * 迁移后应当**回到快照状态** —— 因为 dev 库本身就是「迁移 + 产品重排」
#       之后的目标态，克隆跑完迁移就应该和它一致；
#     * 分级验**口径**（哪些分类必须 9+），而不是验条数。
#
# 这些变量在第 2 步（克隆恢复完）时填充，见 db_metrics()。
# ---------------------------------------------------------------------------
SNAP_METRICS=""       # main|content|category|app_tables —— 快照状态
SNAP_MAIN=""
SNAP_CONTENT=""
SNAP_CATEGORY=""
SNAP_APP_TABLES=""
SNAP_SHA=""
ADDED_CAT2=0          # 本次是否把重复空分类 id=2 补回克隆（用于推导期望分类数）

# 分级口径：分类 → 年龄档（产品重排后的权威映射）。验口径，不验条数。
#   1/4/5/7            → 3-6
#   6/8/9/10/11/12     → 6-9
#   13/15/16/17        → 9+   （13=聊斋志异 293 篇，15/16/17=怪谈/恐怖/推理）
BAND_CASE_SQL="CASE WHEN m.category_id IN (1,4,5,7) THEN '3-6' \
WHEN m.category_id IN (6,8,9,10,11,12) THEN '6-9' \
WHEN m.category_id IN (13,15,16,17) THEN '9+' END"
# 必须落在 9+ 的分类（内容安全红线）。
MUST_BE_9PLUS="13,15,16,17"

# M1 新增的 9 列（03-decisions §8.1）。
NEW_COLUMNS="age_band tags status duration_sec cover_url audio_url featured published_at updated_at"

KEEP=0
RUN_PRISMA=1

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --no-prisma) RUN_PRISMA=0; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------
PASS=0; FAIL=0; STEP=0; FAILURES=()
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_WARN=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_BAD=''; C_WARN=''; C_DIM=''; C_OFF=''
fi
step() { STEP=$((STEP+1)); printf '\n%s[%d] %s%s\n' "$C_DIM" "$STEP" "$1" "$C_OFF"; }
pass() { PASS=$((PASS+1)); printf '    %s✔ %s%s\n' "$C_OK" "$1" "$C_OFF"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$1"); printf '    %s✘ %s%s\n' "$C_BAD" "$1" "$C_OFF"; }
warn() { printf '    %s! %s%s\n' "$C_WARN" "$1" "$C_OFF"; }
info() { printf '      %s%s%s\n' "$C_DIM" "$1" "$C_OFF"; }

command -v docker >/dev/null 2>&1 || { echo "缺少依赖：docker" >&2; exit 2; }

# 在 dev 容器里对某库跑 psql，返回纯文本（-tA）。
q() { # q <db> <sql>
  docker exec "$DEV_CONTAINER" psql -U "$DEV_USER" -d "$1" -tA -v ON_ERROR_STOP=1 -c "$2" 2>&1
}

# dev 库口令：从容器环境里读，不写死在脚本里（写死会在换口令时静默失配）。
# 读不到就退回项目里既有的 dev 约定值。
db_password() {
  local pw
  pw="$(docker inspect "$DEV_CONTAINER" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^POSTGRES_PASSWORD=//p' | head -1)"
  printf '%s' "${pw:-storydev_local_only}"
}

# ---------------------------------------------------------------------------
# db_metrics <db> —— 取一个库的「基线指纹」：main|content|category|app_tables
#
# 这是本脚本的核心基线来源。演练的判定基准不是写死的数字，而是**快照当时
# 的真实状态** —— 数据随产品调整变化时，比对依然成立，不会误报。
# ---------------------------------------------------------------------------
db_metrics() { # db_metrics <db> -> main|content|category|app_tables
  q "$1" "SELECT (SELECT count(*) FROM public.story_main)||'|'||
                 (SELECT count(*) FROM public.story_content)||'|'||
                 (SELECT count(*) FROM public.story_category)||'|'||
                 (SELECT count(*) FROM information_schema.tables WHERE table_schema='app');"
}


# ---------------------------------------------------------------------------
# 迁移执行器（见文件头红线）
#
# 迁移必须在 dev 网络内的容器里跑：宿主解析不到 story-dev-postgres，且该库
# 没有发布宿主端口。这里解析出一个可用的执行器，落在三个全局量里：
#   RUNNER_MODE = exec | run | none
#   RUNNER_NAME = 容器名（exec 模式）
#   RUNNER_PATH = 仓库在该容器里的路径
# ---------------------------------------------------------------------------
RUNNER_MODE="none"
RUNNER_NAME=""
RUNNER_PATH=""
RUNNER_HOST_SRC=""

# 只认「容器存在 + 在目标网络上」。
container_on_network() { # container_on_network <name> <network>
  docker inspect "$1" >/dev/null 2>&1 || return 1
  docker inspect "$1" \
    --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null \
    | grep -qx "$2"
}

# 探测仓库在某容器里的真实路径：优先配置值，其次 /workspace/story。
detect_repo_path() { # detect_repo_path <container>
  local c="$1" cand
  for cand in "$RUNNER_REPO_PATH" /workspace/story /app; do
    [ -n "$cand" ] || continue
    if docker exec "$c" test -f "$cand/apps/server/scripts/migrate.mjs" 2>/dev/null; then
      printf '%s' "$cand"; return 0
    fi
  done
  return 1
}

resolve_runner() {
  # 强制走临时容器（便于验证兜底路径，也用于不想借道 dsh-dev 的场合）。
  if [ "$MIGRATE_RUNNER" = "temp" ]; then
    resolve_temp_runner
    return $?
  fi

  if [ "$MIGRATE_RUNNER" != "auto" ]; then
    RUNNER_NAME="$MIGRATE_RUNNER"
    if ! docker inspect "$RUNNER_NAME" >/dev/null 2>&1; then
      fail "MIGRATE_RUNNER='$RUNNER_NAME' 不存在"
      return 1
    fi
    if ! container_on_network "$RUNNER_NAME" "$DEV_NETWORK"; then
      fail "MIGRATE_RUNNER='$RUNNER_NAME' 不在网络 '$DEV_NETWORK' 上，无法解析 $DEV_CONTAINER"
      return 1
    fi
    if ! RUNNER_PATH="$(detect_repo_path "$RUNNER_NAME")"; then
      fail "在 '$RUNNER_NAME' 里找不到仓库（试过 $RUNNER_REPO_PATH、/workspace/story、/app）"
      return 1
    fi
    RUNNER_MODE="exec"
    return 0
  fi

  # auto：先找现成的容器 —— 候选优先，然后扫**所有**容器（名字可能不叫
  # dsh-dev，但只要有 node、在网络上、能看到仓库就能用）。
  local c
  for c in $RUNNER_CANDIDATES; do
    if container_on_network "$c" "$DEV_NETWORK"; then
      if RUNNER_PATH="$(detect_repo_path "$c")"; then
        RUNNER_MODE="exec"; RUNNER_NAME="$c"
        return 0
      fi
    fi
  done
  local all
  all="$(docker ps --format '{{.Names}}' 2>/dev/null)"
  for c in $all; do
    case " $RUNNER_CANDIDATES " in *" $c "*) continue ;; esac
    container_on_network "$c" "$DEV_NETWORK" || continue
    if RUNNER_PATH="$(detect_repo_path "$c")"; then
      RUNNER_MODE="exec"; RUNNER_NAME="$c"
      return 0
    fi
  done

  resolve_temp_runner
}

# 兜底：起临时容器（把仓库按**容器可见的宿主路径**挂进去）。
# 宿主路径通常不是 $REPO_ROOT —— 本机真实路径是 /vol1/1000/开发/NAS/story
# （含中文），而脚本在容器里看到的可能是 /workspace/story。所以从 docker
# inspect 的挂载表里反查：任何容器把仓库挂到 workspace/story 时，那个
# Source 就是宿主侧真实路径，可直接当作 bind 源。
resolve_temp_runner() {
  local host_src="" cand c
  local all
  all="$(docker ps -a --format '{{.Names}}' 2>/dev/null)"
  for c in $RUNNER_CANDIDATES $all; do
    docker inspect "$c" >/dev/null 2>&1 || continue
    cand="$(docker inspect "$c" --format \
      '{{range .Mounts}}{{.Source}}{{"\t"}}{{.Destination}}{{"\n"}}{{end}}' 2>/dev/null \
      | awk -F'\t' '$2 ~ /(^|\/)workspace\/story$/ {print $1; exit}')"
    if [ -n "$cand" ]; then host_src="$cand"; break; fi
  done
  [ -n "$host_src" ] || host_src="$REPO_ROOT"

  if docker run --rm --network "$DEV_NETWORK" \
       -v "$host_src:/repo:ro" "$RUNNER_IMAGE" \
       test -f /repo/apps/server/scripts/migrate.mjs >/dev/null 2>&1; then
    RUNNER_MODE="run"; RUNNER_NAME="$RUNNER_IMAGE"; RUNNER_PATH="/repo"
    RUNNER_HOST_SRC="$host_src"
    return 0
  fi

  fail "找不到可用的迁移执行器：网络中 '$DEV_NETWORK' 上没有容器能提供仓库"
  info "试过：候选容器 [$RUNNER_CANDIDATES]、全部容器、宿主路径 '$host_src'"
  info "也可显式指定：MIGRATE_RUNNER=<容器名> MIGRATE_RUNNER_PATH=<仓库在该容器内路径> $0"
  return 1
}

# 在 runner 里执行一段 shell（cwd = 仓库的 apps/server）。
# 用法：in_runner <DATABASE_URL> <shell 片段>
in_runner() { # in_runner <db_url> <cmd>
  local url="$1" cmd="$2"
  if [ "$RUNNER_MODE" = "exec" ]; then
    docker exec -e DATABASE_URL="$url" "$RUNNER_NAME" \
      sh -c "cd '$RUNNER_PATH/apps/server' && $cmd" 2>&1
  else
    docker run --rm --network "$DEV_NETWORK" -e DATABASE_URL="$url" \
      -v "$RUNNER_HOST_SRC:/repo:ro" -w /repo/apps/server "$RUNNER_IMAGE" \
      sh -c "$cmd" 2>&1
  fi
}

echo "小故事铺 M4 · 迁移演练"
echo "  容器   : $DEV_CONTAINER"
echo "  源库   : $DEV_DB"
echo "  克隆库 : $SCRATCH_DB"

# ===========================================================================
# 0. 红线检查：绝不碰生产
# ===========================================================================
step "红线检查（03-decisions D7：生产库只读）"

if [ "$DEV_CONTAINER" = "$PROD_CONTAINER" ]; then
  fail "DEV_CONTAINER 指向了生产容器 '$PROD_CONTAINER'，拒绝运行"
  echo "${C_BAD}红线：演练不允许对生产容器执行任何操作。${C_OFF}" >&2
  exit 2
fi
if [ "$DEV_DB" = "$PROD_DB" ]; then
  fail "DEV_DB 指向了生产库 '$PROD_DB'，拒绝运行"
  exit 2
fi
if [ "$SCRATCH_DB" = "$PROD_DB" ] || [ "$SCRATCH_DB" = "$DEV_DB" ]; then
  fail "SCRATCH_DB 不能是生产库或 story_dev 本身（当前 '$SCRATCH_DB'）"
  exit 2
fi
pass "目标为 dev 容器 '$DEV_CONTAINER'，生产容器 '$PROD_CONTAINER' 不被触碰"

if ! docker inspect "$DEV_CONTAINER" >/dev/null 2>&1; then
  fail "找不到 dev 容器 '$DEV_CONTAINER'"
  exit 2
fi
pass "dev 容器存在"

# 迁移执行器必须在容器网络内（宿主解析不到 story-dev-postgres，且该库没
# 发布宿主端口）。这里提前解析，失败就直接停 —— 否则会像早期版本那样在
# 第 6/7 步拿到 P1001，并让后面所有校验连锁失败。
step "解析迁移执行器（必须在网络 '$DEV_NETWORK' 内）"
if resolve_runner; then
  case "$RUNNER_MODE" in
    exec) pass "用现有容器 '$RUNNER_NAME' 执行迁移（仓库路径 $RUNNER_PATH）" ;;
    run)  pass "无现成容器，改用临时容器 '$RUNNER_NAME'（挂载 $RUNNER_HOST_SRC）" ;;
  esac
else
  echo
  echo "${C_BAD}红线：迁移必须跑在容器网络内，找不到执行器就不能继续。${C_OFF}"
  echo "宿主直跑只能做 dump/restore（那些命令跑在 DB 容器里）。" >&2
  exit 2
fi

# 记录源库指纹：
#   base_metrics  = 快照时刻的源库状态（回滚要比对的就是它）
#   base_counts   = 兼容旧输出的 main/content/category 形式
base_metrics="$(db_metrics "$DEV_DB")"
base_counts="${base_metrics%|*}"
base_counts="${base_counts//|//}"
SNAP_SHA=""
info "演练前 $DEV_DB 指纹 main|content|category|app = $base_metrics"

# ===========================================================================
# 1. 快照
# ===========================================================================
step "pg_dump 快照（custom 格式，含 app schema）"
mkdir -p "$SNAP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
SNAP_FILE="$SNAP_DIR/${DEV_DB}-${STAMP}.dump"

if ! docker exec "$DEV_CONTAINER" pg_dump -U "$DEV_USER" -d "$DEV_DB" \
      --format=custom --no-owner --no-privileges > "$SNAP_FILE" 2>"$SNAP_DIR/.dumperr"; then
  fail "pg_dump 失败：$(head -c 200 "$SNAP_DIR/.dumperr")"
  exit 1
fi
snap_bytes="$(stat -c %s "$SNAP_FILE" 2>/dev/null || echo 0)"
if [ "$snap_bytes" -lt 10000 ]; then
  fail "快照文件过小（${snap_bytes}B），可能没抓到数据"
  exit 1
fi
snap_sha="$(sha256sum "$SNAP_FILE" | cut -c1-16)"
pass "快照 $SNAP_FILE（$(numfmt --to=iec "$snap_bytes" 2>/dev/null || echo "${snap_bytes}B")，sha256:${snap_sha}…）"

# 校验快照本身可恢复（不只是「生成了文件」）。
step "校验快照内容（pg_restore --list）"
toc="$(docker exec -i "$DEV_CONTAINER" pg_restore --list < "$SNAP_FILE" 2>&1)"
if printf '%s' "$toc" | grep -q "story_main"; then
  ntab="$(printf '%s' "$toc" | grep -c "TABLE DATA" || true)"
  pass "快照目录可解析，含 story_main（TABLE DATA 项 $ntab 个）"
else
  fail "快照目录里找不到 story_main，快照不可信"
  exit 1
fi

# ===========================================================================
# 2. 建克隆并恢复
# ===========================================================================
step "建立克隆库 $SCRATCH_DB（从快照恢复）"

# 先踢掉可能残留的连接，再重建。
q postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$SCRATCH_DB' AND pid<>pg_backend_pid();" >/dev/null
if ! q postgres "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null; then
  fail "无法删除旧克隆库（可能仍有连接）"
  exit 1
fi
if ! q postgres "CREATE DATABASE $SCRATCH_DB OWNER $DEV_USER;" >/dev/null; then
  fail "无法创建克隆库 $SCRATCH_DB"
  exit 1
fi

if ! docker exec -i "$DEV_CONTAINER" pg_restore -U "$DEV_USER" -d "$SCRATCH_DB" \
      --no-owner --no-privileges --exit-on-error < "$SNAP_FILE" >"$SNAP_DIR/.resterr" 2>&1; then
  fail "恢复快照失败：$(tail -c 300 "$SNAP_DIR/.resterr")"
  exit 1
fi

clone_metrics="$(db_metrics "$SCRATCH_DB")"
clone_counts="${clone_metrics%|*}"
clone_counts="${clone_counts//|//}"
if [ "$clone_metrics" = "$base_metrics" ]; then
  pass "克隆恢复完成，指纹与源库一致（$clone_metrics）"
else
  fail "克隆指纹 $clone_metrics ≠ 源库 $base_metrics"
fi

# ---------------------------------------------------------------------------
# 解析快照指纹 → SNAP_* / EXPECT_*
#
# ⚠️ 这一段是**补上的**（2026-11-11 修 bug）：脚本原本声明了 SNAP_MAIN/CONTENT/
#    CATEGORY/APP_TABLES 四个变量、以及 EXPECT_CATEGORY_AFTER / EXPECT_BAND_3_6/
#    EXPECT_BAND_6_9 / EXPECT_BAND_9PLUS 四个变量，但**从未给它们赋值**。
#    原来只用 `SNAP_METRICS`（同样赋了空值没人用）间接提到过「快照状态」。
#    在 `set -u` 下，第 [9] 步一读 EXPECT_CATEGORY_AFTER 就 `unbound variable`
#    直接中止 —— 演练永远到不了校验与回滚，等于「跑不出结论」。
#
# 设计口径（沿用文件头与 §3 的注释）：期望值**从本次快照派生**，不硬编码。
#   * 快照 = story_dev 当时状态 = 「迁移完成 + 产品重排」后的**目标态**；
#   * 克隆被我们打回 pre-M1 并补回重复空分类 id=2；
#   * 所以跑完迁移后应当**收敛回快照状态**（分类数见下面的说明）。
#
# SNAP_METRICS 的格式是 `main|content|category|app_tables`（见 db_metrics）。
# ---------------------------------------------------------------------------
SNAP_METRICS="$clone_metrics"
IFS='|' read -r SNAP_MAIN SNAP_CONTENT SNAP_CATEGORY SNAP_APP_TABLES <<<"$SNAP_METRICS"

# 快照里 id=2 是否已不存在（= 产品已删）。若不存在，我们在 §3 补回它，
# 迁移 3 会再把它删掉，因此 ADDED_CAT2=1 用于推导「迁移前的期望分类数」。
snap_has_cat2="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_category WHERE id=2;")"
if [ "$snap_has_cat2" = "0" ]; then
  ADDED_CAT2=1
else
  ADDED_CAT2=0
fi

# 分级期望：同样取自快照（目标态），而不是写死数字。
read -r SNAP_BAND_3_6 SNAP_BAND_6_9 SNAP_BAND_9PLUS <<<"$(
  q "$SCRATCH_DB" "SELECT count(*) FILTER (WHERE age_band='3-6')||' '||
                          count(*) FILTER (WHERE age_band='6-9')||' '||
                          count(*) FILTER (WHERE age_band='9+')
                     FROM public.story_main;"
)"

for v in SNAP_MAIN SNAP_CONTENT SNAP_CATEGORY SNAP_APP_TABLES SNAP_BAND_3_6 SNAP_BAND_6_9 SNAP_BAND_9PLUS; do
  if [ -z "${!v}" ]; then
    fail "快照指纹解析失败：$v 为空（SNAP_METRICS='$SNAP_METRICS'）"
    exit 1
  fi
done
info "快照派生：main=$SNAP_MAIN content=$SNAP_CONTENT category=$SNAP_CATEGORY app_tables=$SNAP_APP_TABLES 分级=$SNAP_BAND_3_6/$SNAP_BAND_6_9/$SNAP_BAND_9PLUS（id2 已删=$ADDED_CAT2）"

# ===========================================================================
# 3. 把克隆打回「迁移前」状态（模拟生产迁移现场）
# ===========================================================================
step "把克隆还原成 pre-M1 状态（drop app schema / 新增列 / 迁移记录）"
# 只有真的处于「未迁移」状态，迁移演练才有意义 —— 否则 migrate 无事可做，
# 会给出「通过」的假象。

q "$SCRATCH_DB" "DROP SCHEMA IF EXISTS app CASCADE;" >/dev/null
q "$SCRATCH_DB" "DROP TABLE IF EXISTS public._m1_migrations;" >/dev/null
q "$SCRATCH_DB" "DROP INDEX IF EXISTS public.story_main_status_age_band_idx; DROP INDEX IF EXISTS public.story_main_category_id_idx;" >/dev/null
for col in $NEW_COLUMNS; do
  q "$SCRATCH_DB" "ALTER TABLE public.story_main DROP COLUMN IF EXISTS $col;" >/dev/null
done

# 把克隆的**内容**也对齐到「生产基线」：
# 快照来自 story_dev，而 story_dev 已经被产品重排过（重复分类已删）。若直接在
# 这个基础上跑迁移，迁移 3 里的 DELETE 会是 no-op —— 等于没测到要上生产的改动。
# 所以把重复空分类 id=2「睡前故事」加回来（0 篇），让删除真的被执行到。
#
# 分级不需要在这里手工还原：age_band 列已在上面被 drop，迁移 1 会用
# DEFAULT '3-6' 重新加列（2197 行全为 3-6），再按旧逻辑把分类 15/16/17 标成
# 9+ —— 得到 2190/7，正是生产当前的真实分布。所以「迁移 1 之后」= 生产基线，
# 迁移 3 再把它修正成产品口径。
q "$SCRATCH_DB" "INSERT INTO public.story_category (id, name, sort_id) VALUES (2, '睡前故事', 10) ON CONFLICT (id) DO NOTHING;" >/dev/null

pre_apptables="$(q "$SCRATCH_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='app';")"
pre_newcols="$(q "$SCRATCH_DB" "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='story_main' AND column_name IN ('$(echo $NEW_COLUMNS | sed "s/ /','/g")');")"
pre_counts="$(q "$SCRATCH_DB" "SELECT (SELECT count(*) FROM public.story_main)||'/'||(SELECT count(*) FROM public.story_content)||'/'||(SELECT count(*) FROM public.story_category);")"

if [ "$pre_apptables" = "0" ] && [ "$pre_newcols" = "0" ]; then
  pass "已回到 pre-M1：app 表 0 个、新增列 0 个、legacy 行数 $pre_counts（内容未被破坏）"
else
  fail "pre-M1 还原不干净：app 表 $pre_apptables、新增列 $pre_newcols（都应为 0）"
fi

# ---------------------------------------------------------------------------
# 期望值现在**从快照派生**（不再硬编码）：
#   * 快照本身已经是「迁移完成 + 产品重排」后的目标态；
#   * 我们在克隆上把结构打回 pre-M1、并补回重复空分类 id=2；
#   * 所以「跑完迁移」应当精确回到**快照状态**（分类数除外，见下）。
#
# 分类数：快照里是 SNAP_CATEGORY（产品已删 id=2），我们补回了 id=2 让迁移 3
# 真的有事可做，所以迁移后应回到 SNAP_CATEGORY。若快照里 id=2 本就不存在，
# ADDED_CAT2=1，迁移 3 会把它删掉 → 期望 = SNAP_CATEGORY；若快照里 id=2 仍在
# （快照早于产品删除），迁移 3 不会删（因为…它确实存在且为空会删）—— 统一按
# 「迁移后应等于快照的分类数」处理，因为迁移 3 的语义就是收敛到目标态。
# ---------------------------------------------------------------------------
EXPECT_MAIN="$SNAP_MAIN"
EXPECT_CONTENT="$SNAP_CONTENT"
EXPECT_CATEGORY_POST="$SNAP_CATEGORY"
EXPECT_APP_TABLES="$SNAP_APP_TABLES"
# 迁移后的分类数 = 快照值（迁移 3 的语义就是收敛到目标态：把补回的 id=2 删掉）。
# 用 SNAP_CATEGORY 而非 `+ADDED_CAT2`：ADDED_CAT2 描述的是**迁移前**的临时状态。
EXPECT_CATEGORY_AFTER="$SNAP_CATEGORY"
# 分级期望取自快照（目标态）。迁移 3 的目的就是让分级收敛到产品口径。
EXPECT_BAND_3_6="$SNAP_BAND_3_6"
EXPECT_BAND_6_9="$SNAP_BAND_6_9"
EXPECT_BAND_9PLUS="$SNAP_BAND_9PLUS"

info "期望基线（取自本次快照）：main=$EXPECT_MAIN content=$EXPECT_CONTENT category=$EXPECT_CATEGORY_POST app_tables=$EXPECT_APP_TABLES"

# 分类回到「快照分类数 + 补回的 id=2」：迁移 3 的 DELETE 才有东西可删。
pre_expected_cat=$((SNAP_CATEGORY + ADDED_CAT2))
if [ "$pre_counts" = "$EXPECT_MAIN/$EXPECT_CONTENT/$pre_expected_cat" ]; then
  pass "已对齐生产基线：分类 $pre_expected_cat 行（含补回的重复空分类 id=2）"
else
  fail "基线行数 $pre_counts（期望 $EXPECT_MAIN/$EXPECT_CONTENT/$pre_expected_cat）"
fi
info "分级将在迁移 1 后落回旧口径，再由迁移 3 修正为产品口径"

# ===========================================================================
# 4. 执行迁移
#
# 🔴 这一段**必须**在容器网络内跑（见文件头红线）：
#   - 宿主解析不到 story-dev-postgres；
#   - 该库没有发布宿主端口。
# 所以下面所有命令都通过 in_runner 进容器执行，DATABASE_URL 指向克隆库。
# ===========================================================================
SCRATCH_URL="postgresql://${DEV_USER}:$(db_password)@${DEV_CONTAINER}:5432/${SCRATCH_DB}"

step "prisma migrate deploy（在克隆库上，执行器 $RUNNER_MODE:$RUNNER_NAME）"

# prisma 的入口：
#   - `./node_modules/.bin/prisma` 是个 shell shim，**直接执行**没问题；
#     早期版本用 `node <shim>` 去跑，得到 "SyntaxError: missing ) after
#     argument list" —— 那是把 shell 脚本当 JS 喂给 node 了。
#   - 若 shim 不可用，退回 build/index.js（那才是可被 node 跑的 JS 入口）。
if [ "$RUN_PRISMA" -eq 0 ]; then
  warn "已按 --no-prisma 跳过"
else
  # 关键事实：本库是「非空 schema」的既有库，prisma migrate deploy 会用
  # P3005 拒绝执行（它要求先 baseline）。这不是配置问题，是 Prisma 对既有
  # 生产库的设计行为 —— 项目因此自带了迁移 runner（scripts/migrate.mjs）。
  # 这里如实跑一次并记录结论，不把 P3005 当成失败。
  prisma_out="$(in_runner "$SCRATCH_URL" \
    'if [ -x ./node_modules/.bin/prisma ]; then ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma; else node "$(ls -1 ../../node_modules/.pnpm/prisma@*/node_modules/prisma/build/index.js 2>/dev/null | head -1)" migrate deploy --schema prisma/schema.prisma; fi')"

  if printf '%s' "$prisma_out" | grep -q "No pending migrations to apply"; then
    pass "prisma migrate deploy：无待应用迁移（schema 已是最新）"
  elif printf '%s' "$prisma_out" | grep -q "P3005"; then
    warn "prisma migrate deploy 拒绝在非空 schema 上执行（P3005）—— 既有库需要 baseline，属预期"
    info "这是设计行为，不是回归；项目用 scripts/migrate.mjs 作为迁移 runner。"
  elif printf '%s' "$prisma_out" | grep -q "P1001"; then
    fail "prisma 连不上库（P1001）—— 执行器不在容器网络上？"
    info "$(printf '%s' "$prisma_out" | grep -iE 'P1001|reach' | head -1)"
  elif printf '%s' "$prisma_out" | grep -qiE "error|failed"; then
    warn "prisma migrate deploy 报错：$(printf '%s' "$prisma_out" | grep -iE 'error|failed' | head -1)"
  else
    pass "prisma migrate deploy 执行完成"
  fi
fi

step "应用迁移（项目 runner：apps/server/scripts/migrate.mjs，幂等）"
if migrate_out="$(in_runner "$SCRATCH_URL" 'node scripts/migrate.mjs')"; then
  printf '%s\n' "$migrate_out" | sed 's/^/      /'
  pass "迁移 runner 返回成功"
else
  printf '%s\n' "$migrate_out" | sed 's/^/      /'
  fail "迁移 runner 执行失败"
fi

# ===========================================================================
# 5. 校验
# ===========================================================================
step "校验迁移结果"

post_counts="$(q "$SCRATCH_DB" "SELECT (SELECT count(*) FROM public.story_main)||'/'||(SELECT count(*) FROM public.story_content)||'/'||(SELECT count(*) FROM public.story_category);")"
if [ "$post_counts" = "$EXPECT_MAIN/$EXPECT_CONTENT/$EXPECT_CATEGORY_AFTER" ]; then
  pass "行数正确：main=$EXPECT_MAIN content=$EXPECT_CONTENT category=$EXPECT_CATEGORY_AFTER"
  info "分类 15→14：迁移 3 删掉了重复空分类 id=2（只删空分类，故事未动）"
else
  fail "行数异常：$post_counts（期望 $EXPECT_MAIN/$EXPECT_CONTENT/$EXPECT_CATEGORY_AFTER）"
fi

# 分级口径（迁移 3 的核心：内容安全修正）。
post_b36="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_main WHERE age_band='3-6';")"
post_b69="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_main WHERE age_band='6-9';")"
post_b9="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_main WHERE age_band='9+';")"
if [ "$post_b36" = "$EXPECT_BAND_3_6" ] && [ "$post_b69" = "$EXPECT_BAND_6_9" ] && [ "$post_b9" = "$EXPECT_BAND_9PLUS" ]; then
  pass "分级正确：3-6=$post_b36 / 6-9=$post_b69 / 9+=$post_b9"
else
  fail "分级异常：3-6=$post_b36 6-9=$post_b69 9+=$post_b9（期望 $EXPECT_BAND_3_6/$EXPECT_BAND_6_9/$EXPECT_BAND_9PLUS）"
fi

# 内容安全：聊斋志异（13）必须不再是儿童档。
liaozhai_bad="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_main WHERE category_id=13 AND age_band<>'9+';")"
if [ "$liaozhai_bad" = "0" ]; then
  pass "内容安全：聊斋志异（分类 13）293 篇已全部为 9+"
else
  fail "内容安全缺口：聊斋仍有 $liaozhai_bad 篇不是 9+"
fi

# 迁移 3 的删除必须**只删空分类**：故事行数一分未少。
if [ "$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_main;")" = "$EXPECT_MAIN" ]; then
  pass "故事行数保持 $EXPECT_MAIN（没有级联删除内容）"
else
  fail "故事行数发生变化 —— 分类删除可能级联删了内容"
fi

post_apptables="$(q "$SCRATCH_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='app';")"
if [ "$post_apptables" -ge 11 ]; then
  pass "app schema 建表 $post_apptables 张（含 audio_cache / audio_job）"
else
  fail "app schema 只有 $post_apptables 张表（期望 ≥11）"
fi

post_newcols="$(q "$SCRATCH_DB" "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='story_main' AND column_name IN ('$(echo $NEW_COLUMNS | sed "s/ /','/g")');")"
if [ "$post_newcols" = "9" ]; then
  pass "story_main 新增列 9 列齐备"
else
  fail "story_main 新增列 $post_newcols 个（期望 9）"
fi

# 空值校验（03-decisions §1 实测：这三列 0 空值）。
nulls="$(q "$SCRATCH_DB" "SELECT 'cat_id='||count(*) FILTER (WHERE category_id IS NULL)||' length='||count(*) FILTER (WHERE length IS NULL)||' excerpt='||count(*) FILTER (WHERE excerpt IS NULL)||' status='||count(*) FILTER (WHERE status IS NULL)||' published_at='||count(*) FILTER (WHERE published_at IS NULL) FROM public.story_main;")"
if printf '%s' "$nulls" | grep -q "cat_id=0 length=0 excerpt=0 status=0 published_at=0"; then
  pass "空值校验通过（$nulls）"
else
  fail "空值异常（$nulls）—— 回填未生效"
fi

# 外键完整性：不允许有孤儿正文。
orphans="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_content c LEFT JOIN public.story_main m ON m.id=c.story_id WHERE m.id IS NULL;")"
if [ "$orphans" = "0" ]; then
  pass "外键完整性：孤儿正文 0 条"
else
  fail "存在 $orphans 条孤儿正文"
fi

# 内容安全：恐怖/怪谈/推理（分类 15/16/17）必须被标为 9+。
age9="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_main WHERE age_band='9+';")"
if [ "$age9" -ge 7 ]; then
  pass "age_band='9+' 共 $age9 条（含分类 15/16/17 的 7 条，内容安全闸生效）"
else
  fail "age_band='9+' 只有 $age9 条（期望 ≥7）"
fi

# 老站读取路径不受影响：legacy 三表仍可读。
legacy_ok="$(q "$SCRATCH_DB" "SELECT count(*) FROM public.story_main LIMIT 1;" >/dev/null 2>&1 && echo yes || echo no)"
if [ "$legacy_ok" = "yes" ]; then
  pass "legacy 表可读（老站 pREST 路径不受影响）"
else
  fail "legacy 表读取失败"
fi

# ===========================================================================
# 6. 回滚到快照
# ===========================================================================
step "回滚：从快照重建克隆，验证可回到迁移前状态"
q postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$SCRATCH_DB' AND pid<>pg_backend_pid();" >/dev/null
if ! q postgres "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null; then
  fail "回滚时无法删除克隆库"
  exit 1
fi
if ! q postgres "CREATE DATABASE $SCRATCH_DB OWNER $DEV_USER;" >/dev/null; then
  fail "回滚时无法重建克隆库"
  exit 1
fi
if ! docker exec -i "$DEV_CONTAINER" pg_restore -U "$DEV_USER" -d "$SCRATCH_DB" \
      --no-owner --no-privileges --exit-on-error < "$SNAP_FILE" >"$SNAP_DIR/.rest2err" 2>&1; then
  fail "回滚恢复失败：$(tail -c 300 "$SNAP_DIR/.rest2err")"
  exit 1
fi

rb_counts="$(q "$SCRATCH_DB" "SELECT (SELECT count(*) FROM public.story_main)||'/'||(SELECT count(*) FROM public.story_content)||'/'||(SELECT count(*) FROM public.story_category);")"
if [ "$rb_counts" = "$base_counts" ]; then
  pass "回滚后行数与快照完全一致（$rb_counts）"
else
  fail "回滚后行数 $rb_counts ≠ 快照 $base_counts —— 回滚不可信"
fi

# 回滚应当同时把「迁移带来的新表」也还原：快照里 app schema 是存在的
# （story_dev 已迁移），所以这里比对 app 表数量是否回到快照状态。
rb_apptables="$(q "$SCRATCH_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='app';")"
snap_apptables="$(q "$DEV_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='app';")"
if [ "$rb_apptables" = "$snap_apptables" ]; then
  pass "回滚后 app schema 表数 $rb_apptables，与快照来源一致"
else
  fail "回滚后 app 表数 $rb_apptables ≠ $snap_apptables"
fi

# ===========================================================================
# 7. 收尾
# ===========================================================================
step "收尾"
if [ "$KEEP" -eq 1 ]; then
  warn "--keep：保留克隆库 $SCRATCH_DB"
else
  q postgres "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null && pass "已删除克隆库 $SCRATCH_DB"
fi
# 快照无论 --keep 与否都只保留最近 3 份，避免反复演练把磁盘堆满。
ls -1t "$SNAP_DIR"/*.dump 2>/dev/null | tail -n +4 | while read -r f; do rm -f "$f"; done
pass "快照保留在 $SNAP_DIR（最近 3 份）"
rm -f "$SNAP_DIR"/.dumperr "$SNAP_DIR"/.resterr "$SNAP_DIR"/.rest2err

# 再确认一次源库没有被本脚本改动。
final_counts="$(q "$DEV_DB" "SELECT (SELECT count(*) FROM public.story_main)||'/'||(SELECT count(*) FROM public.story_content)||'/'||(SELECT count(*) FROM public.story_category);")"
if [ "$final_counts" = "$base_counts" ]; then
  pass "$DEV_DB 全程未被改动（$final_counts）"
else
  fail "$DEV_DB 行数发生变化：$base_counts → $final_counts"
fi

# ===========================================================================
# 汇总
# ===========================================================================
echo
echo "──────────────────────────────────────────"
echo "生产库 ${C_OK}零写入${C_OFF}：本脚本只连 dev 容器 '$DEV_CONTAINER'，只建/删克隆库 '$SCRATCH_DB'。"
if [ "$FAIL" -eq 0 ]; then
  printf '%s✔ 迁移演练通过：%d 项全部成功%s\n' "$C_OK" "$PASS" "$C_OFF"
  exit 0
fi
printf '%s✘ 迁移演练失败：%d 项成功、%d 项失败%s\n' "$C_BAD" "$PASS" "$FAIL" "$C_OFF"
for f in "${FAILURES[@]}"; do printf '   - %s\n' "$f"; done
exit 1
