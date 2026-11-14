#!/usr/bin/env bash
# 小故事铺 · Android release 出包（一条命令，带签名与自检）
#
# 为什么有这个脚本：
#   0.1.0 / 0.1.1 的包是 **debug 签名**，而且是「先 build 再想起来要签名」——
#   两次发布都靠人记步骤。这里把「升版号 → 注入基址 → 出包 → 验签名 → 验基址 → 归档 sha256」
#   固定成一条命令，任何一步不对就非零退出。
#
# 用法：
#   ./tool/build-release-apk.sh                 # 用 kProdApiBaseUrl（正式域名）
#   API_BASE_URL=http://192.168.1.4:13300 ./tool/build-release-apk.sh   # 指定基址
#   SKIP_TESTS=1 ./tool/build-release-apk.sh    # 跳过 flutter test（不建议）
#
# 前置：
#   apps/app/android/key.properties + android/keystore/storynook-release.jks
#   缺失时脚本**拒绝出包**（Gradle 会回落 debug 签名，那种包不能发布）。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/../.." && pwd)"
API_BASE_URL="${API_BASE_URL:-https://api-story.xirizhi.cn}"
OUT_DIR="$REPO_DIR/releases"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

cd "$APP_DIR"

# ---------------------------------------------------------------------------
# 1. 签名材料必须齐（否则 Gradle 静默回落 debug）
# ---------------------------------------------------------------------------
say "1/6 检查签名材料"
[[ -f android/key.properties ]] || die "缺 android/key.properties —— 见 apps/app/android/README 或 docs/product/24-prod-deploy-20261113.md §8"
KS=$(grep -E '^storeFile=' android/key.properties | cut -d= -f2-)
[[ -f "android/app/$KS" ]] || die "key.properties 指向的 keystore 不存在：android/app/$KS"
echo "keystore: android/app/$KS"

# ---------------------------------------------------------------------------
# 2. 版号：versionName+versionCode 必须比已发布的高，否则 Android 拒绝升级
# ---------------------------------------------------------------------------
say "2/6 检查版号"
VERSION_LINE=$(grep -E '^version:' pubspec.yaml)
VERSION_NAME=$(echo "$VERSION_LINE" | sed -E 's/^version: *([0-9.]+)\+([0-9]+).*/\1/')
VERSION_CODE=$(echo "$VERSION_LINE" | sed -E 's/^version: *([0-9.]+)\+([0-9]+).*/\2/')
echo "pubspec: $VERSION_NAME+$VERSION_CODE"
LAST_APK=$(ls -1 "$OUT_DIR"/storynook-*.apk 2>/dev/null | sed -E 's/.*storynook-([0-9.]+)\.apk/\1/' | sort -V | tail -1 || true)
if [[ -n "$LAST_APK" && "$LAST_APK" == "$VERSION_NAME" && "${FORCE:-0}" != "1" ]]; then
  die "releases/ 里已经有 $VERSION_NAME 的包；改 pubspec.yaml 的版本与 +N 再出包（或 FORCE=1 重切同一版本）"
fi
echo "上一个已发布版本: ${LAST_APK:-（无）}"

# ---------------------------------------------------------------------------
# 3. 测试
# ---------------------------------------------------------------------------
if [[ "${SKIP_TESTS:-0}" == "1" ]]; then
  say "3/6 跳过测试（SKIP_TESTS=1）"
else
  say "3/6 跑测试"
  flutter test
fi

# ---------------------------------------------------------------------------
# 4. 出包
# ---------------------------------------------------------------------------
say "4/6 构建 release APK（基址 $API_BASE_URL）"
flutter build apk --release --dart-define=API_BASE_URL="$API_BASE_URL"

APK="build/app/outputs/flutter-apk/app-release.apk"
[[ -f "$APK" ]] || die "没找到产物 $APK"

# ---------------------------------------------------------------------------
# 5. 自检：签名不是 debug、版号对、基址已烧进去
# ---------------------------------------------------------------------------
say "5/6 自检产物"
# SDK 位置：环境变量 → android/local.properties 的 sdk.dir（Flutter 写的） → 常见默认
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$SDK" && -f android/local.properties ]]; then
  SDK=$(grep -E '^sdk\.dir=' android/local.properties | cut -d= -f2- || true)
fi
SDK="${SDK:-$HOME/Android/Sdk}"
[[ -d "$SDK/build-tools" ]] || die "找不到 Android SDK（试过 ANDROID_HOME / local.properties / $HOME/Android/Sdk）"
echo "SDK: $SDK"
APKSIGNER=$(ls "$SDK"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)
AAPT=$(ls "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)

[[ -n "$APKSIGNER" && -n "$AAPT" ]] || die "SDK 里找不到 apksigner / aapt2（$SDK/build-tools）"

# 注意：这里所有「命令 | head」都改成先存变量再取行。
# 在 `set -o pipefail` 下，`aapt2 ... | head -1` 会因为 head 提前关管道让 aapt2 收到 SIGPIPE，
# 整条脚本以 141 退出（本轮实测踩到）。
BADGING=$("$AAPT" dump badging "$APK" 2>/dev/null)
FIRST_LINE=$(printf '%s\n' "$BADGING" | sed -n '1p')
echo "$FIRST_LINE"
case "$FIRST_LINE" in
  *"versionName='$VERSION_NAME'"*) ;;
  *) die "versionName 不符，期望 $VERSION_NAME" ;;
esac
case "$FIRST_LINE" in
  *"versionCode='$VERSION_CODE'"*) ;;
  *) die "versionCode 不符，期望 $VERSION_CODE" ;;
esac

CERTS=$("$APKSIGNER" verify --print-certs "$APK" 2>&1)
case "$CERTS" in
  *'CN=StoryNook'*) ;;
  *) die "签名不是正式 keystore（多半回落成了 debug）：$CERTS" ;;
esac
printf '%s\n' "$CERTS" | sed -n '/SHA-256 digest/{p;q;}'

# 基址：不允许 127.0.0.1 进包（0.1.0 就是这么坏的）
python3 - "$APK" "$API_BASE_URL" <<'PY'
import sys, zipfile
apk, base = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(apk)
libs = [n for n in z.namelist() if n.endswith('libapp.so')]
if not libs:
    sys.exit('✗ APK 里没有 libapp.so')
for n in libs:
    data = z.read(n)
    if base.encode() not in data:
        sys.exit(f'✗ {n} 里没有注入的基址 {base}')
    if b'127.0.0.1:3000' in data:
        sys.exit(f'✗ {n} 里仍带 127.0.0.1:3000 回落')
print(f'✓ 基址 {base} 已在 {len(libs)} 个 ABI 中')
PY

# ---------------------------------------------------------------------------
# 6. 归档
# ---------------------------------------------------------------------------
say "6/6 归档到 releases/"
mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/storynook-$VERSION_NAME.apk"
cp "$APK" "$DEST"
( cd "$OUT_DIR" && sha256sum "storynook-$VERSION_NAME.apk" > "storynook-$VERSION_NAME.apk.sha256" )
ls -l "$DEST" "$DEST.sha256"
cat "$DEST.sha256"

say "完成"
echo "包：$DEST"
echo "记得：APK 不进 git（.gitignore 已排除），走 GitHub Release 附件。"
