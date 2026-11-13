#!/usr/bin/env bash
# 在 NAS 上跑：定时做一次部署前自检，**只在有失败项时发事件**，全绿不花 Token。
#
# 由 story-preflight.timer 调用（每 6 小时）。preflight 必须在开发容器 dsh-dev 里跑：
# 宿主上没有 pnpm，也解析不到 story-dev-postgres。
#
# 两条踩过的坑，都写进这里了：
#   1. **不能并发跑**。两个 preflight 同时连 story-dev-postgres 会互相污染（实测服务端测试
#      24 failed / 67 passed，看起来像代码坏了，其实是两个进程在同一个库上建表删表）。
#      用 flock 串行化，抢不到锁就直接跳过这一轮。
#   2. **默认 TARGET_DB 指向的库已经删了**。`preflight.sh` 默认 `story_m12_rehearsal`，
#      2026-11-13 清理演练库时删掉了，所以迁移那一项永远 SKIP。这里显式用 `story_dev`。
#
# 输出约定（中台 `use: "command"` + `emits` 的接法）：脚本最后打印一段
# ```agent-autoloop { "events": [...] } ``` 代码块，中台把它变成事件；没有失败项就打印空数组。
#
# 环境：
#   STORY_DIR_IN_CONTAINER  容器里的仓库路径，默认 /workspace/story
#   STORY_DEV_CONTAINER     开发容器，默认 dsh-dev
#   TARGET_DB               迁移账本用哪个库，默认 story_dev
#   PREFLIGHT_ARGS          额外参数，比如 --e2e（会临时起容器，慢，默认不跑）
#   STORY_SOURCE_KEY        中台 source story 的密钥；有就直接发事件（中台在 NAS 本地）
#   HUB                     中台地址，默认 http://127.0.0.1:3350
#
# 退出码：0 = 跑完（无论有没有失败项）；1 = 容器/脚本本身起不来或拿不到锁。
set -uo pipefail

DIR="${STORY_DIR_IN_CONTAINER:-/workspace/story}"
CONTAINER="${STORY_DEV_CONTAINER:-dsh-dev}"
TARGET_DB="${TARGET_DB:-story_dev}"
ARGS="${PREFLIGHT_ARGS:-}"
LOG="/tmp/story-preflight.log"
LOCK="/tmp/story-preflight.lock"

say() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

# 串行化：同一时刻只允许一个 preflight 碰开发库
exec 9>"$LOCK"
if ! flock -n 9; then
  say "另一轮预检还在跑，这一轮跳过"
  printf '\n```agent-autoloop\n{"events":[]}\n```\n'
  exit 0
fi

if ! docker exec -e TARGET_DB="$TARGET_DB" "$CONTAINER" bash -lc \
  "cd $DIR && TARGET_DB=$TARGET_DB ./scripts/preflight.sh $ARGS" >"$LOG" 2>&1; then
  say "预检退出码非 0"
fi

# 失败项：preflight 每行是「PASS/WARN/FAIL/SKIP  名字  细节」
FAILS=$(grep -E '^FAIL' "$LOG" || true)
WARNS=$(grep -E '^WARN' "$LOG" || true)
TAIL=$(tail -c 1500 "$LOG" | tr -d '\r')

if [ -n "$FAILS" ]; then
  say "有失败项"
  printf '%s\n' "$FAILS"
  SUBJECT="preflight"
  SUMMARY="预检有 $(printf '%s\n' "$FAILS" | grep -c .) 项失败"
  DETAIL="$(printf '失败项：\n%s\n\n末尾输出：\n%s' "$FAILS" "$TAIL")"
  TYPE="story.preflight.failed"
elif [ -n "$WARNS" ]; then
  say "只有告警，按正常处理"
  printf '%s\n' "$WARNS"
  TYPE=""
else
  say "预检全绿"
  TYPE=""
fi

if [ -z "$TYPE" ]; then
  printf '\n```agent-autoloop\n{"events":[]}\n```\n'
  exit 0
fi

KEY="${STORY_SOURCE_KEY:-}"
if [ -n "$KEY" ]; then
  # 有来源密钥就直接 POST：事件 id 带上日期与小时，同一小时不会重复派活
  payload=$(jq -cn --arg id "preflight:$(date +%F-%H)" --arg t "$TYPE" \
    --arg s "$SUBJECT" --arg m "$SUMMARY" --arg d "$DETAIL" \
    '{id:$id, type:$t, subject:$s, summary:$m, detail:$d}')
  if curl -sS --max-time 15 -X POST "${HUB:-http://127.0.0.1:3350}/v1/events" \
    -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "$payload" >/dev/null; then
    say "已直接发事件 $TYPE（id=$id）"
  else
    say "发事件失败"
  fi
  printf '\n```agent-autoloop\n{"events":[]}\n```\n'
  exit 0
fi

# 没有来源密钥就走回执：中台把这段事件按规则的 emits 发出去
jq -cn --arg t "$TYPE" --arg s "$SUBJECT" --arg m "$SUMMARY" --arg d "$DETAIL" \
  '{events:[{id:("preflight:" + (now|todate|split("T")|.[0])), type:$t, subject:$s, summary:$m, detail:$d}]}' \
  | sed 's/^/```agent-autoloop\n/; s/$/\n```/'
printf '预检失败：%s\n' "$SUMMARY"
