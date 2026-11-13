#!/usr/bin/env bash
# 部署前自检：一条命令回答「现在能不能上」。
#
#   ./scripts/preflight.sh              # 只读检查：迁移状态 + 三端测试
#   ./scripts/preflight.sh --e2e        # 再加端到端冒烟（会临时起一个容器，连副本库）
#   TARGET_DB=story_m12_rehearsal ./scripts/preflight.sh
#
# 在开发容器里跑（需要 pnpm / flutter / node；--e2e 还需要 docker）。
# 退出码 0 = 全通；1 = 有失败项（逐项打印原因，不中断后续检查）。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET_DB="${TARGET_DB:-story_m12_rehearsal}"
E2E=0
[ "${1:-}" = "--e2e" ] && E2E=1

FAILED=0
declare -a ROWS=()

record() { # name status detail
  ROWS+=("$1|$2|$3")
  [ "$2" = "FAIL" ] && FAILED=1
  printf '%-6s %-28s %s\n' "$2" "$1" "${3:-}"
}

have() { command -v "$1" >/dev/null 2>&1; }

# 这个脚本必须在**开发容器**里跑：宿主上既没有 flutter，也解析不到 story-dev-postgres。
# 之前有人在宿主上跑，服务端测试报「Can't reach database server at story-dev-postgres:5432」，
# 看起来像测试坏了，其实是跑错地方。这里先判定，早退并给出一条能直接用的命令。
IN_CONTAINER=0
[[ -f /.dockerenv ]] && IN_CONTAINER=1
if [[ "$IN_CONTAINER" = "0" ]]; then
  printf '\033[33m⚠️  当前不在容器里（没有 /.dockerenv）。\033[0m\n'
  printf '   本脚本需要 pnpm / flutter / 能解析 story-dev-postgres —— 宿主上都没有。\n'
  printf '   正确跑法：\n'
  printf "     docker exec dsh-dev bash -lc 'cd %s && ./scripts/preflight.sh%s'\n" \
    "$ROOT" "${1:-}"
  printf '   （只想看生产状态用 ./scripts/prod-deploy.sh status，那条在宿主上跑）\n'
  printf '   确实要在宿主上跑（只为看它怎么坏）：HOST_OK=1 ./scripts/preflight.sh\n\n'
  [[ "${HOST_OK:-0}" == "1" ]] || exit 2
fi

# ① 迁移状态（只读：账本 + 待执行数）
if have node; then
  DB_URL="${DATABASE_URL:-postgresql://storydev:storydev_local_only@story-dev-postgres:5432/$TARGET_DB}"
  OUT="$(cd apps/server && DATABASE_URL="$DB_URL" node scripts/migrate.mjs --status 2>&1 || true)"
  PENDING="$(printf '%s' "$OUT" | grep -c '^  pending' || true)"
  if printf '%s' "$OUT" | grep -q '待执行'; then
    APPLIED="$(printf '%s' "$OUT" | grep -c '^  applied' || true)"
    if [ "$PENDING" = "0" ]; then
      record "迁移状态（$TARGET_DB）" "PASS" "全部已应用（$APPLIED 个）"
    else
      record "迁移状态（$TARGET_DB）" "WARN" "还有 $PENDING 个待执行（生产上线前必须处理）"
    fi
  else
    record "迁移状态（$TARGET_DB）" "SKIP" "读不到账本（库不存在或连不上）"
  fi
else
  record "迁移状态" "SKIP" "没有 node"
fi

# ② 服务端测试
if have pnpm; then
  if (cd apps/server && pnpm test >/tmp/preflight-server.log 2>&1); then
    T="$(grep -oE 'Tests +[0-9]+ passed' /tmp/preflight-server.log | tail -1)"
    record "服务端测试" "PASS" "${T:-通过}"
  else
    record "服务端测试" "FAIL" "见 /tmp/preflight-server.log 末尾"
  fi

  # ③ 后台测试
  if (cd apps/admin && pnpm test >/tmp/preflight-admin.log 2>&1); then
    T="$(grep -oE 'Tests +[0-9]+ passed' /tmp/preflight-admin.log | tail -1)"
    record "后台测试" "PASS" "${T:-通过}"
  else
    record "后台测试" "FAIL" "见 /tmp/preflight-admin.log 末尾"
  fi
else
  record "服务端/后台测试" "SKIP" "没有 pnpm"
fi

# ④ App 测试（flutter analyze + test）
if have flutter; then
  if (cd apps/app && flutter analyze >/tmp/preflight-analyze.log 2>&1); then
    record "App 静态检查" "PASS" "No issues found"
  else
    record "App 静态检查" "FAIL" "见 /tmp/preflight-analyze.log"
  fi
  if (cd apps/app && flutter test >/tmp/preflight-app.log 2>&1); then
    T="$(grep -oE '\+[0-9]+: All tests passed' /tmp/preflight-app.log | tail -1)"
    record "App 测试" "PASS" "${T:-通过}"
  else
    record "App 测试" "FAIL" "见 /tmp/preflight-app.log 末尾"
  fi
else
  record "App 检查" "SKIP" "没有 flutter"
fi

# ⑤ 端到端冒烟（可选）：临时容器连副本库，跑 App 与后台的真实旅程
#
# 用 E2E_DB（默认 story_e2e_seed）而不是迁移彩排库：彩排库是生产副本，里面没有
# 后台管理员账号，后台那 4 步必然 403。没有可用的冒烟库时只跑 App 段并标注。
if [ "$E2E" = "1" ]; then
  E2E_DB="${E2E_DB:-story_e2e_seed}"
  if ! have docker; then
    record "端到端冒烟" "SKIP" "没有 docker"
  else
    HAS_DB="$(docker exec story-dev-postgres psql -U storydev -d story_dev -tAc \
      "select 1 from pg_database where datname='$E2E_DB'" 2>/dev/null | tr -d ' ')"
    HAS_ADMIN="$(docker exec story-dev-postgres psql -U storydev -d "$E2E_DB" -tAc \
      "select 1 from app.account where role='admin' limit 1" 2>/dev/null | tr -d ' ')"
    if [ "$HAS_DB" != "1" ]; then
      record "端到端冒烟" "SKIP" "没有 $E2E_DB 库（先跑一次种子或指定 E2E_DB）"
    else
      NAME="preflight-e2e-$$"
      docker rm -f "$NAME" >/dev/null 2>&1 || true
      docker run -d --name "$NAME" --network dsh-dev_default \
        -e NODE_ENV=production -e PORT=3000 \
        -e DATABASE_URL="postgresql://storydev:storydev_local_only@story-dev-postgres:5432/$E2E_DB" \
        -e JWT_SECRET="preflight-only-secret-ignore-32chars" \
        -e FIXED_SMS_CODE="${FIXED_SMS_CODE:-87654321}" \
        story-server:m4 >/dev/null 2>&1 || true
      OK=0
      for _ in $(seq 1 30); do
        if docker run --rm --network dsh-dev_default curlimages/curl:latest -fsS \
            "http://$NAME:3000/api/health" >/dev/null 2>&1; then OK=1; break; fi
        sleep 1
      done
      if [ "$OK" != "1" ]; then
        record "端到端冒烟" "FAIL" "服务没起来（看 docker logs $NAME）"
      else
        # 有管理员才跑后台 4 步；没有就只验 App 段（12 步）
        if [ "$HAS_ADMIN" = "1" ]; then
          ADMIN_CODE="${FIXED_SMS_CODE:-87654321}" BASE="http://$NAME:3000" \
            node apps/server/scripts/e2e-smoke.mjs >/tmp/preflight-e2e.log 2>&1
          RC=$?
          record "端到端冒烟" "$([ $RC = 0 ] && echo PASS || echo FAIL)" "$(grep -oE '合计 [0-9]+ 项，失败 [0-9]+' /tmp/preflight-e2e.log | tail -1)（见 /tmp/preflight-e2e.log）"
        else
          BASE="http://$NAME:3000" node apps/server/scripts/e2e-smoke.mjs >/tmp/preflight-e2e.log 2>&1
          RC=$?
          record "端到端冒烟" "$([ $RC = 0 ] && echo PASS || echo FAIL)" "仅 App 段（$E2E_DB 无管理员账号）"
        fi
      fi
      docker rm -f "$NAME" >/dev/null 2>&1 || true
    fi
  fi
fi

echo
echo "———— 汇总 ————"
[ "$FAILED" = "0" ] && echo "结论：可以进入下一步（有人工批准项时仍需逐项确认）" || echo "结论：有失败项，先修再上"
exit "$FAILED"
