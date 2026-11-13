#!/usr/bin/env bash
# 一条命令把 docs/design 下的原型渲成 PNG（不需要图形浏览器）。
#
#   ./scripts/design-shots.sh                # 全部（phone / tablet / admin）
#   ./scripts/design-shots.sh phone,tablet   # 只渲指定分组
#   OUT=/tmp/shots ./scripts/design-shots.sh # 换个输出目录
#
# 依赖：本机有 docker，且已拉过 browserless/chrome（镜像里带 puppeteer + chrome）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESIGN="$ROOT/docs/design"
TARGET="${1:-all}"
OUT="${OUT:-$DESIGN/screenshots}"
IMAGE="${IMAGE:-browserless/chrome:latest}"

mkdir -p "$OUT"
TMP="$(mktemp -d)"
# 容器里跑 chrome 的是非 root 用户，临时目录要放开写权限。
chmod 777 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# 用临时目录接产物：容器里跑 chrome 的不是 root，直接写仓库目录会 EACCES。
docker run --rm \
  -e NODE_PATH=/usr/src/app/node_modules \
  -e TARGET="$TARGET" \
  -v "$DESIGN:/designs:ro" \
  -v "$ROOT/scripts:/scripts:ro" \
  -v "$TMP:/out" \
  "$IMAGE" node /scripts/design-shots.cjs

# 临时目录里的 PNG 归 root 读，复制回仓库时恢复正常归属。
cp -R "$TMP"/. "$OUT"/
echo "产物：$OUT/<分组>/"
