#!/usr/bin/env bash
# 小故事铺 · 生产上线一条龙（可分段执行，每段幂等）
#
# 为什么有这个脚本：上线那天的 11 个动作（取备份 → 建镜像 → 迁移 → 授权 → 建管理员 →
# 起容器 → 验域名/写路径/后台）全靠手敲，顺序错了就是事故。这里把它们固定成子命令，
# 每段先打印将要做什么，再执行，失败即停（set -euo pipefail）。
#
# 用法：
#   ./scripts/prod-deploy.sh status        # 只读：生产库/容器/域名的当前状态
#   ./scripts/prod-deploy.sh backup        # 取一份带时间戳的生产备份
#   ./scripts/prod-deploy.sh build         # 构建 server/admin 生产镜像
#   ./scripts/prod-deploy.sh migrate       # 应用待执行迁移（需 DATABASE_URL）
#   ./scripts/prod-deploy.sh grants        # 建/更新 story_app 并授权（需 STORY_APP_PASSWORD）
#   ./scripts/prod-deploy.sh admin --phone 13800138000   # 建首个管理员
#   ./scripts/prod-deploy.sh up            # docker compose up -d
#   ./scripts/prod-deploy.sh smoke         # 域名 + 读路径 + 后台登录/接口（不写库）
#   ./scripts/prod-deploy.sh smoke --write # 再加游客注册 + TTS，结束自动清理
#   ./scripts/prod-deploy.sh all           # backup → build → migrate → up → smoke（不含 grants/admin）
#
# 需要的环境变量（缺了就报错，不猜）：
#   DATABASE_URL            迁移用（超级用户）
#   STORY_APP_PASSWORD      仅 grants 需要
#   PG_CONTAINER            默认 postgres
#   API_HOST / ADMIN_HOST   默认 api-story.xirizhi.cn / admin-story.xirizhi.cn
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_CONTAINER="${PG_CONTAINER:-postgres}"
API_HOST="${API_HOST:-api-story.xirizhi.cn}"
ADMIN_HOST="${ADMIN_HOST:-admin-story.xirizhi.cn}"
COMPOSE=(docker compose --env-file "$REPO/.env.prod" -f "$REPO/docker-compose.prod.yml")
BACKUP_DIR="${BACKUP_DIR:-/vol1/1000/story/backup}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

need() { [[ -n "${!1:-}" ]] || die "环境变量 $1 未设置"; }

cmd_status() {
  say "生产库"
  docker exec "$PG_CONTAINER" psql -U postgres -d story -tAc "
    select 'migrations=' || count(*) from public._m1_migrations;
    select 'stories='    || count(*) from public.story_main;
    select 'categories=' || count(*) from public.story_category;
    select 'accounts='   || count(*) from app.account;
    select 'admins='     || count(*) from app.account where role='admin' and status='active';
    select 'story_app='  || count(*) from pg_roles where rolname='story_app';"
  say "容器"
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'story-(server|admin)-prod' || echo "（生产容器未运行）"
  say "域名"
  printf 'api   %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$API_HOST/api/health" || echo ERR)"
  printf 'admin %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$ADMIN_HOST/" || echo ERR)"
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  local ts file
  ts=$(date +%Y%m%d-%H%M)
  file="$BACKUP_DIR/story-$ts.dump"
  say "备份生产库 → $file"
  docker exec "$PG_CONTAINER" pg_dump -U postgres -d story -Fc -f "/tmp/story-$ts.dump"
  docker cp "$PG_CONTAINER:/tmp/story-$ts.dump" "$file"
  docker exec "$PG_CONTAINER" rm -f "/tmp/story-$ts.dump"
  ls -l "$file"
  echo "回滚用：docker exec -i $PG_CONTAINER pg_restore -U postgres -d story --clean --if-exists < $file"
}

cmd_build() {
  say "构建 server 镜像"
  docker build -f "$REPO/apps/server/Dockerfile" \
    -t story-server:m4 -t story-server:prod-0.1.2 \
    --build-arg NPM_REGISTRY=https://registry.npmjs.org "$REPO"
  say "构建 admin 镜像"
  docker build -f "$REPO/apps/admin/Dockerfile" \
    -t story-admin:m4 -t story-admin:prod-0.1.2 \
    --build-arg VITE_API_BASE= --build-arg NPM_REGISTRY=https://registry.npmjs.org "$REPO"
  docker images --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' | grep -E 'story-(server|admin)'
}

cmd_migrate() {
  need DATABASE_URL
  say "迁移状态（只读）"
  ( cd "$REPO/apps/server" && DATABASE_URL="$DATABASE_URL" node scripts/migrate.mjs --status )
  say "应用迁移"
  ( cd "$REPO/apps/server" && DATABASE_URL="$DATABASE_URL" node scripts/migrate.mjs )
}

cmd_grants() {
  need STORY_APP_PASSWORD
  local tmp
  tmp=$(mktemp)
  sed "s/<STRONG_PASSWORD>/$STORY_APP_PASSWORD/g" "$REPO/docs/product/13-prod-story-app-grants.sql" > "$tmp"
  say "建/更新 story_app 并授权"
  docker cp "$tmp" "$PG_CONTAINER:/tmp/grants.sql" >/dev/null
  docker exec "$PG_CONTAINER" psql -U postgres -d story -v ON_ERROR_STOP=1 -f /tmp/grants.sql | tail -5
  rm -f "$tmp"
  say "自检（能否登录 / 是否禁止 DDL）"
  docker exec "$PG_CONTAINER" psql \
    "postgresql://story_app:$STORY_APP_PASSWORD@127.0.0.1:5432/story" -tAc \
    "select 'login_ok';
     select 'can_ddl_public=' || has_schema_privilege('story_app','public','CREATE');
     select 'can_use_app='    || has_schema_privilege('story_app','app','USAGE');"
}

cmd_admin() {
  local phone=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --phone) phone="$2"; shift 2 ;;
      *) die "未知参数 $1" ;;
    esac
  done
  [[ -n "$phone" ]] || die "用法：prod-deploy.sh admin --phone <手机号>"
  say "建首个管理员（幂等）phone=$phone"
  docker exec -i "$PG_CONTAINER" psql -U postgres -d story -v phone="'$phone'" -f - \
    < "$REPO/docs/product/21-prod-admin-seed.sql"
}

cmd_up() {
  [[ -f "$REPO/.env.prod" ]] || die "缺 .env.prod"
  say "校验 compose"
  "${COMPOSE[@]}" config >/dev/null && echo "config OK"
  say "起生产栈"
  "${COMPOSE[@]}" up -d
  sleep 15
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'story-(server|admin)-prod'
}

cmd_smoke() {
  local base="https://$API_HOST" code tok
  say "健康"
  curl -s --max-time 15 "$base/api/health"; echo
  say "读路径"
  printf 'categories %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/api/categories")"
  printf 'stories    %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/api/stories?page=1&pageSize=1")"
  printf 'admin-ui   %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$ADMIN_HOST/")"
  printf 'admin-api  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$ADMIN_HOST/api/health")"
  say "后台登录 + 后台接口"
  code=$(grep -E '^PROD_FIXED_SMS_CODE=' "$REPO/.env.prod" | cut -d= -f2-)
  tok=$(curl -s --max-time 15 -X POST "$base/api/admin/auth/login" \
        -H 'content-type: application/json' \
        -d "{\"phone\":\"${ADMIN_PHONE:-13800138000}\",\"code\":\"$code\"}" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("data",{}).get("token",""))')
  [[ -n "$tok" ]] || die "后台登录失败（检查 ADMIN_PHONE / PROD_FIXED_SMS_CODE / 管理员是否 active）"
  echo "login OK"
  for p in /api/admin/dashboard /api/admin/stories /api/admin/categories /api/admin/analytics/overview; do
    printf '%-34s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "authorization: Bearer $tok" "$base$p")"
  done
  # 写路径：默认不跑（会在生产库留一条游客账号）。
  # 加 --write 时跑一次，并在结束时把这条账号删干净。
  if [[ "${1:-}" == "--write" ]]; then
    say "写路径（游客注册 + TTS 合成），结束后清理"
    local resp accid
    resp=$(curl -s --max-time 20 -X POST "$base/api/auth/register-device" \
           -H 'content-type: application/json' -d '{"deviceId":"smoke-'"$(date +%s)"'"}')
    echo "$resp" | head -c 160; echo
    accid=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("accountId",""))' 2>/dev/null || true)
    [[ -n "$accid" ]] || die "游客注册失败（story_app 写权限可能没生效）"
    printf 'audio      %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 "$base/api/stories/3/audio")"
    docker exec "$PG_CONTAINER" psql -U postgres -d story -tAc \
      "delete from app.audio_cache; delete from app.account where id='$accid';" >/dev/null
    # 音频文件落在命名卷里，DB 行删掉后文件还在 —— 一并清掉，否则卷里越积越多
    docker exec story-server-prod sh -c 'rm -rf /data/audio-cache/stories' 2>/dev/null || true
    echo "已清理游客账号 $accid、audio_cache 行与音频文件"
  fi

  say "冒烟完成"
}

sub="${1:-status}"; shift || true
case "$sub" in
  status)  cmd_status ;;
  backup)  cmd_backup ;;
  build)   cmd_build ;;
  migrate) cmd_migrate ;;
  grants)  cmd_grants ;;
  admin)   cmd_admin "$@" ;;
  up)      cmd_up ;;
  smoke)   cmd_smoke "$@" ;;
  all)     cmd_backup; cmd_build; cmd_migrate; cmd_up; cmd_smoke ;;
  *) die "未知子命令 $sub（status|backup|build|migrate|grants|admin|up|smoke|all）" ;;
esac
