#!/usr/bin/env bash
# 一条命令把「小故事铺 + agent-autoloop」这套自动化装上（幂等，重复跑安全）。
#
#   bash scripts/autoloop/install.sh            # 装/更新两边
#   bash scripts/autoloop/install.sh --check    # 只检查现状，不改任何东西
#
# 它做四件事：
#   1. 本机：把派单脚本与两个 user unit 装上，挂 5 分钟的 issue 派单 timer
#   2. NAS ：把探针脚本与两个 system unit 装上，挂 10 分钟漂移探测 + 6 小时预检 timer
#   3. NAS ：把 story 的规则并进中台 rules.json（先 check 草稿，过了才覆盖）
#   4. 验证：中台规则通过、两个 timer 在跑、探针各跑一次且不发多余事件
#
# 前提（脚本会检查，缺了就说缺什么，不猜）：
#   - 本机有 gh（登录态）、jq、curl；能 ssh nas
#   - NAS 上中台在跑（systemctl is-active agent-autoloop），有 node-lts
#   - ~/.config/autoloop/dispatch-story.env 里有 AUTOLOOP_SOURCE_KEY（中台 source story 的密钥）
set -uo pipefail

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HUB_DIR=/vol1/1000/docker/autoloop
DEPLOY_DIR=/vol1/1000/docker/autoloop-story
NODE=/usr/local/bin/node-lts
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/autoloop/dispatch-story.env"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
run() { # 只在非 --check 时执行
  if [ "$CHECK" = "1" ]; then printf '  (check) %s\n' "$*"; else "$@"; fi
}

FAIL=0
need() { # 名字 命令
  if command -v "$2" >/dev/null 2>&1; then ok "本机有 $1"; else bad "本机缺 $1"; FAIL=1; fi
}

say "0/5 前置检查"
need gh gh
need jq jq
need curl curl
if ssh -o ConnectTimeout=8 -o BatchMode=yes nas true 2>/dev/null; then ok "能 ssh nas"; else bad "ssh nas 不通"; FAIL=1; fi
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
  if [ -n "${AUTOLOOP_SOURCE_KEY:-}" ]; then ok "有来源密钥（$ENV_FILE）"; else bad "$ENV_FILE 里没有 AUTOLOOP_SOURCE_KEY"; FAIL=1; fi
else
  bad "缺 $ENV_FILE（写 AUTOLOOP_SOURCE_KEY=<中台 source story 的密钥>，chmod 600）"
  FAIL=1
fi
if ssh nas "systemctl is-active --quiet agent-autoloop" 2>/dev/null; then ok "NAS 中台在跑"; else bad "NAS 中台没在跑"; FAIL=1; fi
[ "$FAIL" = "0" ] || { printf '\n先补齐上面标 ✗ 的项再跑。\n'; exit 1; }

say "1/5 本机：派单脚本 + user unit"
install -d -m 700 "${XDG_CACHE_HOME:-$HOME/.cache}/autoloop-dispatch"
install -d -m 700 "$(dirname "$ENV_FILE")"
chmod 755 "$REPO_DIR/scripts/autoloop/dispatch-issues.sh"
for f in story-dispatch-issues.service story-dispatch-issues.timer; do
  run install -m 644 "$REPO_DIR/scripts/autoloop/systemd/$f" "$HOME/.config/systemd/user/$f"
done
run systemctl --user daemon-reload
run systemctl --user enable --now story-dispatch-issues.timer
ok "派单 timer 已挂（5 分钟）"

say "2/5 NAS：探针脚本 + system unit"
run ssh nas "install -d -m 700 $DEPLOY_DIR"
for f in poll-prod.sh preflight-gate.sh; do
  run scp -q "$REPO_DIR/scripts/autoloop/$f" "nas:$DEPLOY_DIR/$f"
  run ssh nas "chmod 755 $DEPLOY_DIR/$f"
done
# 探针用的密钥文件：只在不存在时写，600
if [ "$CHECK" = "0" ]; then
  printf 'STORY_SOURCE_KEY=%s\n' "$AUTOLOOP_SOURCE_KEY" \
    | ssh nas "umask 077 && cat > $DEPLOY_DIR/probe.env && chmod 600 $DEPLOY_DIR/probe.env"
fi
for f in story-poll.service story-poll.timer story-preflight.service story-preflight.timer; do
  run scp -q "$REPO_DIR/scripts/autoloop/systemd/$f" "nas:/etc/systemd/system/$f"
done
run ssh nas "systemctl daemon-reload"
run ssh nas "systemctl enable --now story-poll.timer story-preflight.timer"
ok "两个 timer 已挂（10 分钟 / 6 小时）"

say "3/5 NAS：把 story 的规则并进中台"
run scp -q "$REPO_DIR/scripts/autoloop/merge-rules.py" "nas:$DEPLOY_DIR/merge-rules.py"
if [ "$CHECK" = "0" ]; then
  # 先写草稿、check 过了才覆盖：中台读的是 rules.json，写坏的后果是「旧规则继续跑 + 推一张告警卡」
  ssh nas "cd $HUB_DIR && cp rules.json $DEPLOY_DIR/rules.backup-\$(date +%Y%m%d-%H%M%S).json \
    && python3 $DEPLOY_DIR/merge-rules.py rules.json $DEPLOY_DIR/rules.new.json" || { bad "并规则失败"; exit 1; }
  if ssh nas "cd $HUB_DIR && AGENT_AUTOLOOP_HOME=$HUB_DIR $NODE app/bin/agent-autoloop.ts check $DEPLOY_DIR/rules.new.json"; then
    ssh nas "cp $DEPLOY_DIR/rules.new.json $HUB_DIR/rules.json && chmod 600 $HUB_DIR/rules.json"
    ok "规则已生效（旧版备份在 $DEPLOY_DIR/rules.backup-*.json）"
  else
    bad "草稿没通过 check，没有覆盖线上 rules.json"; exit 1
  fi
fi

say "4/5 验证"
run ssh nas "AGENT_AUTOLOOP_HOME=$HUB_DIR $NODE $HUB_DIR/app/bin/agent-autoloop.ts check"
run ssh nas "systemctl list-timers --all 'story-*' --no-pager | head -5"
run systemctl --user list-timers 'story-*' --no-pager | head -5

say "5/5 探针各跑一次（看它判断对不对）"
run ssh nas "systemctl start story-poll.service; journalctl -u story-poll -n 12 --no-pager | tail -12"
run ssh nas "STORY_SOURCE_KEY='' $DEPLOY_DIR/preflight-gate.sh 2>&1 | tail -8"

printf '\n装完了。看事件表：%s/scripts/autoloop/README.md\n' "$REPO_DIR"
