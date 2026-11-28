#!/usr/bin/env bash
# 小故事铺的单一门禁：一条命令回答「这批改动能不能交给检查」。
#
#   ./scripts/gate.sh              # 两端类型检查 + 后台单测；开发库在的时候顺带跑服务端用例
#   FLUTTER_CHECK=1 ./scripts/gate.sh   # 再并进 App 的 58 个用例（要 Flutter SDK，本机默认没有）
#
# 为什么有它：CI 的 check job 只跑一半（服务端全量用例要 Postgres，CI 里没有库），
# 而 preflight.sh 必须在开发容器里跑。两条命令各说一半，agent 每轮都要猜。
# 这里把「本机能跑的都跑一遍」固定下来，缺什么就显式 SKIP 并写清怎么补——
# **SKIP 不是通过**：检查轮看到 SKIP 要问一句「这条改动需不需要那一条」。
#
# 退出码：0 = 全部通过（允许有 SKIP）；1 = 有 FAIL。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILED=0
declare -a ROWS=()

record() { # name status detail
  ROWS+=("$1|$2|$3")
  [ "$2" = "FAIL" ] && FAILED=1
  printf '%-6s %-24s %s\n' "$2" "$1" "${3:-}"
}

have() { command -v "$1" >/dev/null 2>&1; }

# ── ① 类型检查：两端，永远跑。CI 的 check job 跑的也是这两条 ──
if have pnpm; then
  if pnpm --filter @story/server typecheck >/tmp/gate-server-tsc.log 2>&1; then
    record "服务端类型检查" PASS "tsc 0 错"
  else
    record "服务端类型检查" FAIL "见 /tmp/gate-server-tsc.log 末尾"
  fi
  if pnpm --filter @story/admin typecheck >/tmp/gate-admin-tsc.log 2>&1; then
    record "后台类型检查" PASS "tsc 0 错"
  else
    record "后台类型检查" FAIL "见 /tmp/gate-admin-tsc.log 末尾"
  fi
else
  record "类型检查" SKIP "没有 pnpm"
fi

# ── ② 后台单测（63）。NODE_ENV=test 必须显式给 ──
# 本机不少 shell 里 NODE_ENV=production，vitest 会拿到 React 的生产构建，
# 每个用例都报「act(...) is not supported in production builds」，看着像 63 条全红。
if have pnpm; then
  if NODE_ENV=test pnpm --filter @story/admin test >/tmp/gate-admin-test.log 2>&1; then
    T="$(grep -oE 'Tests +[0-9]+ passed' /tmp/gate-admin-test.log | tail -1)"
    record "后台单测" PASS "${T:-通过}"
  else
    record "后台单测" FAIL "见 /tmp/gate-admin-test.log 末尾（先确认不是 NODE_ENV=production 造成的假红）"
  fi
fi

# ── ③ 服务端单测（全量）：要开发库 story-dev-postgres + apps/server/.env 里的 TEST_DATABASE_URL ──
DEV_DB_UP=0
if have docker && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'story-dev-postgres'; then
  DEV_DB_UP=1
fi
if [ "$DEV_DB_UP" = "1" ] && have pnpm; then
  if (cd apps/server && pnpm test >/tmp/gate-server-test.log 2>&1); then
    T="$(grep -oE 'Tests +[0-9]+ passed' /tmp/gate-server-test.log | tail -1)"
    record "服务端单测" PASS "${T:-通过}"
  else
    record "服务端单测" FAIL "见 /tmp/gate-server-test.log 末尾"
  fi
else
  record "服务端单测" SKIP "开发库没跑或没装 docker：docker start story-dev-postgres 后重跑"
fi

# ── ④ App 用例（58）：默认不跑，本机没有 Flutter/SDK ──
if [ "${FLUTTER_CHECK:-0}" = "1" ]; then
  if have flutter; then
    if (cd apps/app && flutter test >/tmp/gate-app-test.log 2>&1); then
      T="$(grep -oE '[0-9]+ (tests passed|passed)' /tmp/gate-app-test.log | tail -1)"
      record "App 用例" PASS "${T:-通过}"
    else
      record "App 用例" FAIL "见 /tmp/gate-app-test.log 末尾"
    fi
  else
    record "App 用例" SKIP "没有 Flutter SDK（出包与用例都在 CI 的 android.yml）"
  fi
fi

echo
echo "———— 汇总 ————"
echo "服务端全量用例的完整门禁是 ./scripts/preflight.sh（必须在开发容器里跑）"
[ "$FAILED" = "0" ] && echo "结论：本机能跑的都过了（SKIP 项要自己判需不需要）" || echo "结论：有失败项，先修再交检查"
exit "$FAILED"
