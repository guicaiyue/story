#!/bin/sh
set -e

# 可选：通过环境变量注入 Supabase 配置（二开增强）
# 仓库内 js/supabase-client.js 的 supabaseUrl/supabaseKey 默认为空，
# 部署时若设置 SUPABASE_URL 与 SUPABASE_KEY，则启动前自动替换。
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_KEY:-}" ]; then
  sed -i "s|const supabaseUrl = '';|const supabaseUrl = '${SUPABASE_URL}';|" /usr/share/nginx/html/js/supabase-client.js
  sed -i "s|const supabaseKey = '';|const supabaseKey = '${SUPABASE_KEY}';|" /usr/share/nginx/html/js/supabase-client.js
  echo "[entrypoint] SUPABASE_URL / SUPABASE_KEY injected"
else
  echo "[entrypoint] SUPABASE_URL / SUPABASE_KEY not set, keep repo defaults (empty)"
fi

exec /docker-entrypoint.sh "$@"
