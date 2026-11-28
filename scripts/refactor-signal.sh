#!/usr/bin/env bash
# 结构信号计算器：只输出事实，不做判断。
#
# 判断（谁是热点、要不要派活）在「小故事铺：重构评估」那一轮的 skill 里，
# 这里只回答三个问题：变了什么、变了多少、谁在变。
#
# 为什么不用「总行数」当判据：这个仓库里 docs / scripts / config 占大头，
# README、决策台账、迁移手册、验证脚本涨了都是「记录/护栏变强」，不该惊动结构治理。
#
# 用法：
#   bash scripts/refactor-signal.sh                 # JSON 到 stdout，人读摘要走 stderr
#   WINDOW_DAYS=30 bash scripts/refactor-signal.sh
#   LAYERS=apps/admin/src/pages bash scripts/refactor-signal.sh
#
# 配置优先从 pipeline.conf 的 refactor_* 读，环境变量可覆盖。
# 移植自 ~/Projects/autoloop-console/scripts/refactor-signal.sh（2026-11-28），
# 差量只有三处：默认目录、kind() 的分类规则（多了 .dart / 嵌套 scripts/）、
# check_layer 除了 `from '...'` 也认 Dart 的 `import '...'`。
set -euo pipefail
cd "$(dirname "$0")/.."
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

CONF=${CONF:-pipeline.conf}
# 取值时切掉行尾注释：conf 里 `refactor_layers = x  # 说明` 这种写法很常见，
# 不切的话 `#` 后面的字会当成第二个值传进 awk。所以这些键的值里不要写 #。
conf_get() { [ -f "$CONF" ] && sed -n "s/^$1 *= *//p" "$CONF" | head -1 | sed 's/[[:space:]]*#.*//' || true; }

WINDOW_DAYS=${WINDOW_DAYS:-$(conf_get refactor_window_days)}; WINDOW_DAYS=${WINDOW_DAYS:-90}
BASE_FILE=${BASE_FILE:-.refactor-baseline.json}
LAYERS=${LAYERS:-$(conf_get refactor_layers)}
LAYERS=${LAYERS:-apps/server/src/routes apps/admin/src/pages apps/app/lib/screens}
LAYERS=${LAYERS//,/ }
SRC_DIRS=${SRC_DIRS:-$(conf_get refactor_source_dirs)}
SRC_DIRS=${SRC_DIRS:-apps/server/src apps/admin/src apps/app/lib}
SRC_DIRS=${SRC_DIRS//,/ }
GOLDEN=${GOLDEN:-$(conf_get refactor_snapshot_path)}; GOLDEN=${GOLDEN:-scripts/golden}

for bin in git jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "refactor-signal: 缺 $bin" >&2; exit 1; }
done

# ── 基线：上次评估的落点。脚本只读，永不写——推进由评估轮那一轮做 ──
base_commit=""; base_tag=""; base_at=""; base_count=0
if [ -f "$BASE_FILE" ]; then
  base_commit=$(jq -r '.reviewedCommit // ""' "$BASE_FILE")
  base_tag=$(jq -r '.reviewedTag // ""'    "$BASE_FILE")
  base_at=$(jq -r '.reviewedAt // ""'      "$BASE_FILE")
  base_count=$(jq -r '.reviewCount // 0'   "$BASE_FILE")
fi
if [ -z "$base_commit" ] || ! git cat-file -e "${base_commit}^{commit}" 2>/dev/null; then
  base_commit=$(git rev-list --max-parents=0 HEAD | tail -1)
  base_tag=""; base_at=""; base_count=0; fallback=true
else
  fallback=false
fi
base_short=$(git rev-parse --short "$base_commit")
base_days=$(git log -1 --format=%ad --date=short "$base_commit")
head_short=$(git rev-parse --short HEAD)

# ── 分类：按路径与后缀，纯机械。asset 计 0（锁文件、构建物、二进制） ──
KIND_AWK='
function inSrc(p,  i, arr, n) {
  n = split(ENVIRON["SRC_DIRS"], arr, " ")
  if (n == 0) return 1
  for (i = 1; i <= n; i++) if (p == arr[i] || index(p, arr[i] "/") == 1) return 1
  return 0
}
function kind(p) {
  if (p ~ /(^|\/)(dist|build|node_modules|\.cache|\.dart_tool|\.dev-data|\.audio-cache)\//) return "asset"
  if (p ~ /\.(lock|map|snap|dump)$/ || p ~ /\.min\.(js|css)$/)               return "asset"
  if (p ~ /\.(png|jpe?g|gif|ico|woff2?|ttf|eot|svg|webp|pdf|zip|apk|aab|mp3|wav)$/) return "asset"
  if (p ~ /\.md$/ || p ~ /(^|\/)docs\//)                                     return "docs"
  if (p ~ /(^|\/)(scripts|test|tests)\//)                                    return "scripts"
  if (p ~ /\.(json|ya?ml|toml|conf|ini)$/ || p ~ /^\.github\//)              return "config"
  if (p ~ /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|html|dart)$/)              return "source"
  return "other"
}
'

git -c core.quotepath=false diff --numstat "$base_commit"..HEAD 2>/dev/null \
| awk -F'\t' "$KIND_AWK"'NF==3 { k=kind($3); add[k]+=$1; del[k]+=$2; cnt[k]++ }
    END{ for (k in cnt) printf "%s %d %d %d\n", k, add[k], del[k], cnt[k] }' \
| while read -r k a d c; do
    [ -z "${k:-}" ] && continue
    jq -n --arg k "$k" --argjson a "$a" --argjson d "$d" --argjson c "$c" \
      '{kind:$k, add:$a, del:$d, files:$c, lines:($a+$d)}'
  done | jq -s 'sort_by(-.lines)' > "$TMPD/kinds.json"

# ── 源码逐文件：净增 + 窗口内被改次数。热点是这两个数的交叉，判断不在这 ──
src_files=$(
  git -c core.quotepath=false diff --numstat "$base_commit"..HEAD 2>/dev/null \
  | SRC_DIRS="$SRC_DIRS" awk -F'\t' "$KIND_AWK"'NF==3 && kind($3)=="source" && inSrc($3) {printf "%s %d %d\n", $3, $1, $2}' \
  | while read -r p a d; do
      c=$(git log --since="${WINDOW_DAYS} days ago" --oneline -- "$p" 2>/dev/null | wc -l)
      printf '%s\t%d\t%d\t%d\n' "$p" "$a" "$d" "$c"
    done \
  | jq -R -s 'split("\n")|map(select(length>0)|split("\t"))|map(
      {path:.[0], add:(.[1]|tonumber), del:(.[2]|tonumber),
       net:((.[1]|tonumber)-(.[2]|tonumber)), commits:(.[3]|tonumber)})|sort_by(-.net)'
)

# ── probe：分两类。trigger 参与触发，reference 只作参考 ──
props='[]'

check_layer() {
  local layer=$1 v=0 f g others
  local files; files=$(find "$layer" -maxdepth 1 -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.dart' \) 2>/dev/null)
  for f in $files; do for g in $files; do
    [ "$f" = "$g" ] && continue
    others=$(basename "$g"); others=${others%.*}
    # TS/JS: from './x' ／ Dart: import './x.dart' 或 import 'x.dart'
    grep -qE "(from ['\"](\./|\.\./${layer##*/}/)${others}(\.(ts|tsx|js|mjs|dart))?['\"]|import ['\"](\./|\.\./${layer##*/}/)${others}\.dart['\"])" "$f" 2>/dev/null \
      && v=$((v+1))
  done; done
  printf '%s' "$v"
}

# 层内互相 import：腐化的第一条症状，diff 行数永远看不见它。参与触发。
for layer in $LAYERS; do
  [ -d "$layer" ] || continue
  n=$(check_layer "$layer")
  props=$(jq -n --argjson p "$props" --arg l "$layer" --argjson n "$n" \
    '$p + [{probe:"cross-import", role:"trigger", layer:$l, violations:$n}]')
done

# 结构快照：只作参考，不参与触发（本项目暂无快照目录，会整段跳过）。
if [ -d "$GOLDEN/expected" ]; then
  total=$(find "$GOLDEN/expected" -type f -name '*.txt' 2>/dev/null | wc -l)
  changed=$(git -c core.quotepath=false diff --name-only "$base_commit"..HEAD -- "$GOLDEN" 2>/dev/null | wc -l)
  props=$(jq -n --argjson p "$props" --arg g "$GOLDEN" --argjson t "$total" --argjson c "$changed" \
    '$p + [{probe:"structure-snapshot", role:"reference", path:$g, total:$t, changed:$c}]')
fi

src_dir_add=$(git -c core.quotepath=false diff --numstat "$base_commit"..HEAD 2>/dev/null \
  | SRC_DIRS="$SRC_DIRS" awk -F'\t' "$KIND_AWK"'NF==3 && kind($3)=="source" && inSrc($3) {a+=$1; d+=$2; n++} END{printf "%d %d %d\n", a+0, d+0, n+0}')
read -r sd_add sd_del sd_files <<<"$src_dir_add"
sd_lines=$(( sd_add + sd_del ))

jq -n --argjson kinds "$(cat "$TMPD/kinds.json")" --argjson files "$src_files" \
  --argjson probes "$props" \
  --arg baseCommit "$base_commit" --arg baseTag "$base_tag" --arg baseShort "$base_short" \
  --arg baseDays "$base_days" --arg headShort "$head_short" --arg baseAt "$base_at" \
  --argjson baseFallback "$fallback" --argjson reviewCount "$base_count" \
  --argjson winDays "$WINDOW_DAYS" --argjson sdLines "$sd_lines" --argjson sdFiles "$sd_files" \
  '{baseline:{commit:$baseCommit, tag:$baseTag, short:$baseShort, at:$baseAt,
              commitDate:$baseDays, fallback:$baseFallback, reviewCount:$reviewCount},
    head:$headShort,
    window:{days:$winDays},
    srcDirLines:$sdLines,
    srcDirFiles:$sdFiles,
    byKind:$kinds,
    sourceFiles:$files,
    probes:$probes}' > "$TMPD/out.json"

# 人读摘要（stderr），JSON 走 stdout
src_lines=$(jq '[.byKind[]|select(.kind=="source")|.lines]|add // 0' "$TMPD/out.json")
src_files_n=$(jq '[.byKind[]|select(.kind=="source")|.files]|add // 0' "$TMPD/out.json")
all_lines=$(jq '[.byKind[].lines]|add // 0' "$TMPD/out.json")
share=0; [ "$all_lines" -gt 0 ] && share=$(( src_lines * 100 / all_lines ))
{
  echo "── 基线 ${base_short}（${base_days}，评估 ${base_count} 次）→ ${head_short}"
  echo "── 源码 ${src_files_n} 文件 / ${src_lines} 行，占全仓变更 ${share}%"
  jq -r '.byKind[]|"   \(.kind)\t\(.lines) 行\t\(.files) 文件"' "$TMPD/out.json"
  echo "── 长胖 top3"
  jq -r '.sourceFiles[:3][]|"   \(.path)\t净增\(.net)\t改\(.commits)次"' "$TMPD/out.json"
  jq -r '.probes[]|"── \(.probe) [\(.role)] \(if .violations then "违规 \(.violations)" elif .changed then "变更 \(.changed)/\(.total)" else .value end)"' "$TMPD/out.json"
} >&2

cat "$TMPD/out.json"
