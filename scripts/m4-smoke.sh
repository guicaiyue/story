#!/usr/bin/env bash
#
# 小故事铺 2.0 · M4 联调冒烟（scripts/m4-smoke.sh）
#
# 验的是「M4 打包出来的这套栈真的能用」，不是单元测试。四项：
#   1. /api/health 返回 200 且 db=up
#   2. 管理员登录能拿到 JWT
#   3. /api/admin/stories 返回 2197 条（dev 库真实内容）
#   4. /api/stories/8/audio 返回 audio/mpeg（TTS 合成 + 缓存）
#
# 任一失败 → 非 0 退出。可重复执行，不写任何持久状态。
#
# 用法：
#   ./scripts/m4-smoke.sh                    # 打宿主机映射端口（默认）
#   BASE_URL=http://192.168.1.4:13300 ./scripts/m4-smoke.sh
#   ./scripts/m4-smoke.sh --in-container     # 在 compose 网络里对容器跑
#   M4_JSON_TOOL=node ./scripts/m4-smoke.sh  # 指定 JSON 解析器（默认 python3，其次 node）
#
# 红线（03-decisions D7）：只读探测，不写生产库。

set -uo pipefail

# ---------------------------------------------------------------------------
# 配置
#
# 默认地址不写死：这个脚本既可能在宿主上跑（此时 127.0.0.1 就是宿主），
# 也可能在开发容器 dsh-dev 里跑（此时 127.0.0.1 是容器自己，宿主端口要走
# host.docker.internal）。下面会自动挑一个能连通的，避免「栈是好的但脚本说
# 连不上」这种假失败。显式给 BASE_URL 时不再探测。
# ---------------------------------------------------------------------------
API_PORT="${M4_API_PORT:-13300}"
ADMIN_PORT="${M4_ADMIN_PORT:-18082}"
API_BASE="${BASE_URL:-}"
ADMIN_BASE="${ADMIN_BASE_URL:-}"

# 候选地址按「最可能是对的」排序：先 127.0.0.1（宿主场景），再
# host.docker.internal（开发容器场景）。
pick_base() {
  local port="$1" host
  for host in 127.0.0.1 host.docker.internal; do
    if curl -s -m 3 -o /dev/null "http://${host}:${port}/" 2>/dev/null; then
      printf 'http://%s:%s' "$host" "$port"; return 0
    fi
    # 返回码非 0 也可能是「连上了但 404」——用 -w 判断是否拿到 HTTP 响应。
    local code
    code="$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://${host}:${port}/" 2>/dev/null)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      printf 'http://%s:%s' "$host" "$port"; return 0
    fi
  done
  printf 'http://127.0.0.1:%s' "$port"
}

[ -n "$API_BASE" ]   || API_BASE="$(pick_base "$API_PORT")"
[ -n "$ADMIN_BASE" ] || ADMIN_BASE="$(pick_base "$ADMIN_PORT")"

ADMIN_PHONE="${M4_ADMIN_PHONE:-13900000001}"
ADMIN_CODE="${M4_FIXED_SMS_CODE:-123456}"

# dev 库真实内容条数（03-decisions §1：2197 / 2197 / 15）。
EXPECTED_STORIES="${M4_EXPECTED_STORIES:-2197}"
# 已合成音频、用于验证 audio 接口的故事（03-decisions §11.3 实测其中之一）。
AUDIO_STORY_ID="${M4_AUDIO_STORY_ID:-8}"

CURL_TIMEOUT="${M4_CURL_TIMEOUT:-30}"
# 音频首次请求要实时合成（p90 内容 7–30 秒），单独给长超时。
AUDIO_TIMEOUT="${M4_AUDIO_TIMEOUT:-120}"

IN_CONTAINER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --in-container)
      IN_CONTAINER=1
      API_BASE="${IN_CONTAINER_API_BASE:-http://server:3000}"
      ADMIN_BASE="${IN_CONTAINER_ADMIN_BASE:-http://admin}"
      shift ;;
    --base-url) API_BASE="$2"; shift 2 ;;
    --admin-url) ADMIN_BASE="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
STEP=0
FAILURES=()

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_BAD=''; C_DIM=''; C_OFF=''
fi

step()  { STEP=$((STEP + 1)); printf '\n%s[%d] %s%s\n' "$C_DIM" "$STEP" "$1" "$C_OFF"; }
pass()  { PASS=$((PASS + 1)); printf '    %s✔ %s%s\n' "$C_OK" "$1" "$C_OFF"; }
fail()  { FAIL=$((FAIL + 1)); FAILURES+=("$1"); printf '    %s✘ %s%s\n' "$C_BAD" "$1" "$C_OFF"; }

# 依赖：curl；JSON 解析用 python3 或 node（二选一，见下）。
need() {
  command -v "$1" >/dev/null 2>&1 || { echo "缺少依赖：$1" >&2; exit 3; }
}
need curl
# JSON 解析优先用 python3，没有就退回 node —— 两者宿主上都可能有/都没有。
# 当前 dsh-dev 里 python3 由我们显式确认过存在，但宿主环境不保证。
JSON_TOOL="${M4_JSON_TOOL:-}"
if [ -z "$JSON_TOOL" ]; then
  if command -v python3 >/dev/null 2>&1; then JSON_TOOL=python3
  elif command -v node >/dev/null 2>&1; then JSON_TOOL=node
  fi
fi

jget() {
  # jget <json> <dotted.path> — 取不到就输出空串，不抛异常。
  if [ "$JSON_TOOL" = "python3" ]; then
    python3 -c '
import json,sys
try:
    cur = json.loads(sys.argv[1])
except Exception:
    print(""); sys.exit(0)
for part in sys.argv[2].split("."):
    if isinstance(cur, list):
        try: cur = cur[int(part)]
        except Exception: print(""); sys.exit(0)
    elif isinstance(cur, dict):
        cur = cur.get(part)
    else:
        print(""); sys.exit(0)
    if cur is None:
        print(""); sys.exit(0)
print(cur if not isinstance(cur,(dict,list)) else json.dumps(cur))
' "$1" "$2"
  elif [ "$JSON_TOOL" = "node" ]; then
    # 直接读 argv，不读 stdin —— 读 stdin 会在无输入时挂住。
    node -e '
const cur0 = JSON.parse(process.argv[1]);
let cur = cur0;
for (const part of process.argv[2].split(".")) {
  if (Array.isArray(cur)) cur = cur[Number(part)];
  else if (cur && typeof cur === "object") cur = cur[part];
  else { console.log(""); process.exit(0); }
  if (cur === undefined || cur === null) { console.log(""); process.exit(0); }
}
console.log(typeof cur === "object" ? JSON.stringify(cur) : String(cur));
' "$1" "$2" 2>/dev/null
  else
    printf ''
  fi
}

jlen() {
  # jlen <json> <dotted.path> — 取数组长度，失败输出 -1。
  if [ "$JSON_TOOL" = "python3" ]; then
    python3 -c '
import json,sys
try:
    cur = json.loads(sys.argv[1])
    for p in sys.argv[2].split("."):
        cur = cur[int(p)] if isinstance(cur, list) else cur.get(p)
    print(len(cur))
except Exception:
    print(-1)
' "$1" "$2"
  elif [ "$JSON_TOOL" = "node" ]; then
    node -e '
let cur = JSON.parse(process.argv[1]);
for (const p of process.argv[2].split(".")) {
  cur = Array.isArray(cur) ? cur[Number(p)] : cur[p];
}
console.log(Array.isArray(cur) ? cur.length : -1);
' "$1" "$2" 2>/dev/null || printf -- '-1'
  else
    printf -- '-1'
  fi
}

# 把整段响应体收进变量，同时把 HTTP 状态码单独打印到最后一行。
http_get() {
  # http_get <url> [extra curl args...]
  local url="$1"; shift
  curl -sS -m "$CURL_TIMEOUT" -w $'\n%{http_code}' "$@" "$url" 2>&1
}

echo "小故事铺 M4 冒烟测试"
echo "  API   : $API_BASE"
echo "  ADMIN : $ADMIN_BASE"

# ---------------------------------------------------------------------------
# 1. 健康检查
# ---------------------------------------------------------------------------
step "GET $API_BASE/api/health 期望 200 且 db=up"
raw="$(http_get "$API_BASE/api/health")"
code="$(printf '%s' "$raw" | tail -n1)"
body="$(printf '%s' "$raw" | sed '$d')"
if [ "$code" = "200" ]; then
  dbstate="$(jget "$body" "data.db")"
  if [ "$dbstate" = "up" ]; then
    pass "health 200，db=up（latency $(jget "$body" "data.latencyMs")ms）"
  else
    fail "health 200 但 db='$dbstate'（应为 up）"
  fi
else
  fail "health 返回 $code（应为 200）：$(printf '%s' "$body" | head -c 200)"
fi

# ---------------------------------------------------------------------------
# 2. 管理员登录
# ---------------------------------------------------------------------------
step "POST $API_BASE/api/admin/auth/login 期望拿到 token"
raw="$(curl -sS -m "$CURL_TIMEOUT" -w $'\n%{http_code}' \
  -X POST "$API_BASE/api/admin/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$ADMIN_PHONE\",\"code\":\"$ADMIN_CODE\"}" 2>&1)"
code="$(printf '%s' "$raw" | tail -n1)"
body="$(printf '%s' "$raw" | sed '$d')"
TOKEN="$(jget "$body" "data.token")"
ROLE="$(jget "$body" "data.role")"
if [ "$code" = "200" ] && [ -n "$TOKEN" ]; then
  pass "登录成功，role=$ROLE"
else
  fail "登录失败（HTTP $code）：$(printf '%s' "$body" | head -c 200)"
  echo
  echo "${C_BAD}登录失败，后续需要鉴权的用例无法继续。${C_OFF}"
  echo "提示：dev 库的管理员由 apps/server/scripts/seed-dev-admin.mjs 写入，"
  echo "      首次需要先跑一次该脚本（见 README「怎么验」）。"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. 后台故事列表条数
# ---------------------------------------------------------------------------
step "GET $API_BASE/api/admin/stories 期望 total=$EXPECTED_STORIES"
raw="$(curl -sS -m "$CURL_TIMEOUT" -w $'\n%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/admin/stories?page=1&pageSize=20" 2>&1)"
code="$(printf '%s' "$raw" | tail -n1)"
body="$(printf '%s' "$raw" | sed '$d')"
total="$(jget "$body" "data.total")"
items="$(jlen "$body" "data.items")"
if [ "$code" != "200" ]; then
  fail "列表接口返回 $code（应为 200）：$(printf '%s' "$body" | head -c 200)"
elif [ "$total" != "$EXPECTED_STORIES" ]; then
  fail "total=$total，期望 $EXPECTED_STORIES（dev 库真实内容条数）"
else
  pass "total=$total，本页返回 $items 条"
fi

# 顺带验一下公开接口（App/老站路径）也是同一个库。
step "GET $API_BASE/api/stories 期望只返回已发布内容"
raw="$(http_get "$API_BASE/api/stories?page=1&pageSize=5")"
code="$(printf '%s' "$raw" | tail -n1)"
body="$(printf '%s' "$raw" | sed '$d')"
pubtotal="$(jget "$body" "data.total")"
if [ "$code" = "200" ] && [ -n "$pubtotal" ]; then
  pass "公开列表 200，published total=$pubtotal"
else
  fail "公开列表失败（HTTP $code）：$(printf '%s' "$body" | head -c 200)"
fi

# ---------------------------------------------------------------------------
# 4. 音频接口
# ---------------------------------------------------------------------------
step "GET $API_BASE/api/stories/$AUDIO_STORY_ID/audio 期望 audio/mpeg"
# -D - 拿响应头，-o 丢正文（音频有 MB 级），-r 只取前 1KB。
hdrs="$(curl -sS -m "$AUDIO_TIMEOUT" -o /dev/null -D - -r 0-1023 \
  "$API_BASE/api/stories/$AUDIO_STORY_ID/audio" 2>&1)"
code="$(printf '%s' "$hdrs" | awk 'NR==1{print $2}')"
ctype="$(printf '%s' "$hdrs" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')"
cache="$(printf '%s' "$hdrs" | tr -d '\r' | awk 'tolower($1)=="x-audio-cache:"{print $2}')"
dur="$(printf '%s' "$hdrs" | tr -d '\r' | awk 'tolower($1)=="x-audio-duration:"{print $2}')"
if [ "$code" = "200" ] || [ "$code" = "206" ]; then
  if [ "$ctype" = "audio/mpeg" ]; then
    pass "audio/mpeg，HTTP $code，cache=$cache，duration=${dur}s"
  else
    fail "返回 200/206 但 Content-Type='$ctype'（应为 audio/mpeg）"
  fi
else
  fail "音频接口返回 $code（应为 200/206）"
  printf '%s\n' "$hdrs" | head -5 | sed 's/^/      /'
fi

# ---------------------------------------------------------------------------
# 5. admin 容器（nginx 静态层 + /api 反代）
# ---------------------------------------------------------------------------
step "GET $ADMIN_BASE/ 期望后台页面 + /api 反代可用"
raw="$(http_get "$ADMIN_BASE/")"
code="$(printf '%s' "$raw" | tail -n1)"
body="$(printf '%s' "$raw" | sed '$d')"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -qi '<div id="root"'; then
  pass "后台页面 200（含 #root 挂载点）"
else
  fail "后台页面返回 $code 或内容不含 #root"
fi

step "GET $ADMIN_BASE/api/health 期望 nginx 把 /api 反代到 server"
raw="$(http_get "$ADMIN_BASE/api/health")"
code="$(printf '%s' "$raw" | tail -n1)"
body="$(printf '%s' "$raw" | sed '$d')"
if [ "$code" = "200" ] && [ "$(jget "$body" "data.db")" = "up" ]; then
  pass "反代 /api/health 200，db=up"
else
  fail "反代失败（HTTP $code）：$(printf '%s' "$body" | head -c 200)"
fi

# 反代也要能过音频（大响应 + Range 透传）。
step "GET $ADMIN_BASE/api/stories/$AUDIO_STORY_ID/audio 期望反代透传音频"
hdrs="$(curl -sS -m "$AUDIO_TIMEOUT" -o /dev/null -D - -r 0-1023 \
  "$ADMIN_BASE/api/stories/$AUDIO_STORY_ID/audio" 2>&1)"
code="$(printf '%s' "$hdrs" | awk 'NR==1{print $2}')"
ctype="$(printf '%s' "$hdrs" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')"
if [ "$code" = "200" ] || [ "$code" = "206" ]; then
  if [ "$ctype" = "audio/mpeg" ]; then
    pass "反代音频 $ctype，HTTP $code"
  else
    fail "反代音频 Content-Type='$ctype'（应为 audio/mpeg）"
  fi
else
  fail "反代音频返回 $code（应为 200/206）"
fi

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo
echo "──────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf '%s✔ 冒烟通过：%d 项全部成功%s\n' "$C_OK" "$PASS" "$C_OFF"
  exit 0
fi
printf '%s✘ 冒烟失败：%d 项成功、%d 项失败%s\n' "$C_BAD" "$PASS" "$FAIL" "$C_OFF"
for f in "${FAILURES[@]}"; do printf '   - %s\n' "$f"; done
exit 1
