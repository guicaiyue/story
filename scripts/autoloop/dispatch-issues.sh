#!/usr/bin/env bash
# 这个仓库的活从哪里来：GitHub 上带「任务」标签的 issue → 中台事件（POST /v1/events）。
#
# 与 autoloop-console 的同一套入口同构：中台只认事件，客户端只认 /v1；issue 是人和 Agent
# 都能读的任务书，讨论、验收和 PR 链接都留在同一条线上，不额外造一个系统。
#
# 为什么不用中台的 GitHub webhook 适配器：那条路要求 GitHub 从公网 POST 到中台，而中台在
# tailnet 里。`POST /v1/events` 本来就是「把世界变成事件」，用一把来源密钥就够，出网方向
# 只有本机 → 中台。
#
# 幂等：中台对「同来源同 id」只记一次，所以重复跑不会派两遍。本地另记一份已派编号，
# 是为了不白跑请求、也为了让 --again 知道这是第几次派。
#
#   DISPATCH_REPO        仓库，默认 guicaiyue/story
#   DISPATCH_LABEL       标签，默认 任务
#   AUTOLOOP_URL         中台地址，默认读 ~/.agent-autoloop/config.json 的 url
#   AUTOLOOP_SOURCE_KEY  来源密钥（中台 source story），默认读 ~/.config/autoloop/dispatch-story.env
#   DISPATCH_AGAIN=1     已经派过的也再派一次（id 带上第几次，中台不会再拦）
#   DISPATCH_DRY=1       只打印要发的事件，不发请求
#
# 退出码：0 全部处理完（含「没有新单」）；1 至少一条发失败；2 配置不全。
set -euo pipefail

REPO="${DISPATCH_REPO:-guicaiyue/story}"
LABEL="${DISPATCH_LABEL:-任务}"
STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/autoloop-dispatch"
STATE="$STATE_DIR/${REPO//\//_}.json"
ENV_FILE="${AUTOLOOP_DISPATCH_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/autoloop/dispatch-story.env}"

die() {
  printf '%s\n' "$1" >&2
  exit 2
}

command -v gh >/dev/null || die '缺 gh（GitHub CLI）'
command -v jq >/dev/null || die '缺 jq'
command -v curl >/dev/null || die '缺 curl'

# 密钥只在文件里，600。谁要换中台或换来源，改这一份即可，不用改脚本。
# 写成 if：`[ -f x ] && { …; }` 在文件不存在时会返回 1，set -e 会当场退出。
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

HUB="${AUTOLOOP_URL:-}"
if [ -z "$HUB" ] && [ -f "$HOME/.agent-autoloop/config.json" ]; then
  HUB=$(jq -r '.url // empty' "$HOME/.agent-autoloop/config.json")
fi
[ -n "$HUB" ] || die "不知道中台在哪：设 AUTOLOOP_URL，或让 ~/.agent-autoloop/config.json 里有 url"
HUB="${HUB%/}"

KEY="${AUTOLOOP_SOURCE_KEY:-}"
[ -n "$KEY" ] || die "缺来源密钥：在 $ENV_FILE 里写 AUTOLOOP_SOURCE_KEY=<中台 source story 的密钥>（chmod 600）"

mkdir -p "$STATE_DIR"
[ -f "$STATE" ] || printf '{}\n' >"$STATE"

LIST=$(gh issue list -R "$REPO" --label "$LABEL" --state open --limit 50 \
  --json number,title,body,url,updatedAt) || die "拉不到 $REPO 的 issue（gh auth 或仓库名不对）"

total=$(jq 'length' <<<"$LIST")
sent=0
skipped=0
failed=0

while IFS= read -r item; do
  [ -n "$item" ] || continue
  number=$(jq -r '.number' <<<"$item")
  title=$(jq -r '.title // ""' <<<"$item")
  body=$(jq -r '.body // ""' <<<"$item")
  url=$(jq -r '.url // ""' <<<"$item")

  seen=$(jq -r --arg n "$number" '.[$n].count // 0' "$STATE")
  id="issue:$number"
  count=$((seen + 1))
  if [ "$seen" -gt 0 ]; then
    if [ "${DISPATCH_AGAIN:-0}" != "1" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    id="issue:$number:$count"
  fi

  # 字段上限照协议：id 200、subject 100、summary 200、detail 4000、link 500，
  # subject 只能是字母数字和 # . _ : / @ -。
  payload=$(jq -cn \
    --arg id "$id" \
    --arg subject "#$number" \
    --arg summary "$title" \
    --arg detail "$body" \
    --arg link "$url" \
    '{id: $id, type: "dispatch.task", subject: $subject,
      summary: ($summary[0:200]), detail: ($detail[0:4000]), link: ($link[0:500])}')

  if [ "${DISPATCH_DRY:-0}" = "1" ]; then
    printf 'dry %s → %s/v1/events\n%s\n' "$id" "$HUB" "$payload"
    continue
  fi

  if ! response=$(curl -sS -m 20 -w '\n%{http_code}' \
    -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d "$payload" "$HUB/v1/events"); then
    printf '#%s 发不出去（连不上 %s）\n' "$number" "$HUB" >&2
    failed=$((failed + 1))
    continue
  fi

  code=${response##*$'\n'}
  out=${response%$'\n'*}
  if [ "$code" != "200" ]; then
    printf '#%s 被拒：HTTP %s %s\n' "$number" "$code" "$out" >&2
    failed=$((failed + 1))
    continue
  fi

  routed=$(jq -r '.routed | join(" / ")' <<<"$out" 2>/dev/null || printf '')
  duplicate=$(jq -r '.duplicate // false' <<<"$out" 2>/dev/null || printf 'false')
  event=$(jq -r '.event // ""' <<<"$out" 2>/dev/null || printf '')

  if [ -z "$routed" ]; then
    printf '#%s → 事件 %s，但没有规则命中：检查 rules.json 里 source 与 types（dispatch.task）\n' "$number" "$event" >&2
    failed=$((failed + 1))
    continue
  fi

  jq --arg n "$number" --arg id "$id" --arg at "$(date -Is)" --argjson c "$count" \
    '.[$n] = {id: $id, count: $c, at: $at}' "$STATE" >"$STATE.tmp" && mv "$STATE.tmp" "$STATE"
  printf '#%s → 事件 %s%s，派给 %s\n' "$number" "$event" \
    "$([ "$duplicate" = "true" ] && printf '（中台早记过，按重复处理）')" "$routed"
  sent=$((sent + 1))
done < <(jq -c '.[]' <<<"$LIST")

printf '带「%s」的 open issue %s 条：新派 %s，跳过 %s，失败 %s\n' "$LABEL" "$total" "$sent" "$skipped" "$failed"
[ "$failed" -eq 0 ]
