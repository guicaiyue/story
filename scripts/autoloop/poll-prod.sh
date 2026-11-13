#!/usr/bin/env bash
# 在 NAS 上跑：核对「GitHub main / 生产容器镜像 revision / 三个域名」三方是否一致。
#
# 由 story-poll.timer 定时调用，不花 Token：没事什么都不发，有事才发一条事件给中台，
# 由中台的规则决定派给谁。和 autoloop-console 的 poll-release.sh 是同一个思路：
# 探针只做确定性的判断，Agent 只处理判断结果。
#
# 事件 id 是稳定的（drift:<sha> / outage:<域名>:<日期>），中台对同来源同 id 只记一次，
# 所以同一个故障不会被反复派活；修好之后换 SHA 或换日期，才会重新发。
#
# 环境（unit 里给，密钥放 600 的文件）：
#   STORY_REPO       仓库，默认 guicaiyue/story
#   STORY_DIR        部署用的检出目录，默认 /vol1/1000/开发/NAS/story
#   STORY_CONTAINER  静态站容器，默认 story
#   HUB              中台地址，默认 http://127.0.0.1:3350
#   STORY_SOURCE_KEY 中台 source story 的密钥
#   API_HOST / ADMIN_HOST / SITE_HOST  三个域名
#
# 退出码：0 一切正常或事件已发；1 探测本身出错（不影响下一次定时）。
set -uo pipefail

REPO="${STORY_REPO:-guicaiyue/story}"
DIR="${STORY_DIR:-/vol1/1000/开发/NAS/story}"
CONTAINER="${STORY_CONTAINER:-story}"
HUB="${HUB:-http://127.0.0.1:3350}"
API_HOST="${API_HOST:-api-story.xirizhi.cn}"
ADMIN_HOST="${ADMIN_HOST:-admin-story.xirizhi.cn}"
SITE_HOST="${SITE_HOST:-story.xirizhi.cn}"
KEY="${STORY_SOURCE_KEY:-}"

say() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

emit() { # id type subject summary detail
  local id="$1" type="$2" subject="$3" summary="$4" detail="$5"
  if [ -z "$KEY" ]; then
    say "缺 STORY_SOURCE_KEY，不发送：$id $type"
    return 1
  fi
  local payload
  payload=$(jq -cn --arg id "$id" --arg type "$type" --arg s "$subject" \
    --arg m "$summary" --arg d "$detail" \
    '{id:$id, type:$type, subject:$s, summary:$m, detail:$d}')
  curl -sS --max-time 15 -X POST "$HUB/v1/events" \
    -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
    -d "$payload" >/dev/null && say "已发事件 $id（$type）"
}

STATE="${STORY_STATE:-/vol1/1000/docker/autoloop-story/.last-main}"

# ① main 上的提交
MAIN=$(gh api "repos/$REPO/commits/main" --jq .sha 2>/dev/null || true)
if [ -z "$MAIN" ]; then
  say "查不到 $REPO 的 main（gh 登录态或网络）"
  emit "probe:no-main" "story.probe.failed" "main" \
    "查不到 main 的提交" "story-poll.sh 在 $(hostname) 上拿不到 $REPO 的 main，gh 可能掉登录或网络不通。" || true
  exit 1
fi

# ② 生产静态站容器跑的镜像 revision
REV=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)
if [ -z "$REV" ] || [ "$REV" = "<no value>" ]; then
  say "读不到 $CONTAINER 的镜像 revision"
  emit "drift:unknown-rev:$MAIN" "story.drift" "revision" \
    "生产容器读不到 revision" "容器 $CONTAINER 不存在或镜像没打 org.opencontainers.image.revision 标签；main 是 ${MAIN:0:12}。" || true
elif [ "$REV" != "$MAIN" ]; then
  say "生产 revision ${REV:0:12} ≠ main ${MAIN:0:12}"
  emit "drift:$MAIN" "story.drift" "revision" \
    "生产落后 main：${REV:0:7} → ${MAIN:0:7}" \
    "静态站容器 $CONTAINER 跑的镜像 revision 是 $REV，GitHub main 是 $MAIN。Watchtower 可能没跟上，或镜像推送失败。" || true
else
  say "revision 一致：${MAIN:0:12}"
fi

# ②b main 变了就发一条「发布后核对」，让 Agent 去核对 CI → 镜像 → 冒烟那一段。
# 这条和漂移不是一回事：漂移是「线上没跟上」，这里是「有人推了新提交，请核对有没有真上线」。
LAST=$(cat "$STATE" 2>/dev/null || echo "")
if [ "$MAIN" != "$LAST" ]; then
  if [ -n "$LAST" ]; then
    say "main 从 ${LAST:0:12} 变成 ${MAIN:0:12}"
    emit "verify:$MAIN" "story.release.verify" "main" \
      "main 新提交 ${MAIN:0:7}" \
      "GitHub main 从 $LAST 变成 $MAIN。按这个仓库的发布链，推 main 就是发布：CI 四个契约测试 → buildx 推镜像 → n8n Watchtower webhook → Watchtower 拉新镜像。请核对这一段有没有真的走完。" || true
  else
    say "第一次记录 main：${MAIN:0:12}（不发事件，避免一装上就派活）"
  fi
  printf '%s' "$MAIN" > "$STATE" 2>/dev/null || say "写不了状态文件 $STATE（下一轮会重复判断）"
fi

# ③ 三个域名
DOWN=""
for pair in "api:https://$API_HOST/api/health" "admin:https://$ADMIN_HOST/" "site:https://$SITE_HOST/"; do
  name=${pair%%:*}
  url=${pair#*:}
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$url" 2>/dev/null || echo 000)
  say "$name $code $url"
  case "$code" in
    2*|3*) ;;
    *) DOWN="$DOWN $name=$code" ;;
  esac
done

if [ -n "$DOWN" ]; then
  emit "outage:$(date +%F):$(printf '%s' "$DOWN" | tr -d ' =:' | head -c 40)" "story.outage" "outage" \
    "生产域名异常：$DOWN" \
    "story-poll.sh 在 $(hostname) 上探测到异常：$DOWN（main ${MAIN:0:12}）。api 走 https://$API_HOST/api/health，admin 走 https://$ADMIN_HOST/，site 走 https://$SITE_HOST/。" || true
else
  say "三个域名都正常"
fi

exit 0
