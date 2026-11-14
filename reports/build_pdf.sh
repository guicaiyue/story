#!/usr/bin/env bash
# 报告构建：md → html →（注入代码块样式覆盖）→ pdf
#
# 为什么需要这一步：Skill 自带的 md_to_pdf.py 里 `code { background:#fdf2e9 }` 会把
# 围栏代码块染成一条条肉色横带（因为 <pre> 自己没背景）。这里不改 Skill，只在生成
# 的 HTML 里补一段覆盖样式，再交给 WeasyPrint 出 PDF。
#
# 用法：./build_pdf.sh <输入.md> <输出.pdf> <标题>
set -euo pipefail

MD="$1"
PDF="${2%.pdf}.pdf"
TITLE="$3"
HTML="${PDF%.pdf}.html"

HV_DIR="$HOME/.dsh/skills/hv-analysis"
PY="$HOME/.cache/khazix-skills/hv-analysis/bin/python"

"$PY" "$HV_DIR/scripts/md_to_pdf.py" "$MD" "$HTML" --title "$TITLE" >/dev/null

python3 - "$HTML" <<'PY'
import sys
p = sys.argv[1]
css = """
<style>
pre {
  background: #f7f9fb;
  border: 1px solid #e3e8ee;
  border-left: 3px solid #1a5276;
  border-radius: 3pt;
  padding: 3mm 4mm;
  margin: 3mm 0 4mm 0;
}
pre code {
  background: transparent;
  color: #24323d;
  padding: 0;
  font-size: 8.8pt;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
"""
s = open(p, encoding='utf-8').read()
if '</head>' in s:
    s = s.replace('</head>', css + '</head>', 1)
else:
    s = css + s
open(p, 'w', encoding='utf-8').write(s)
print("css injected")
PY

"$PY" - "$HTML" "$PDF" <<'PY'
import sys
from weasyprint import HTML
HTML(filename=sys.argv[1], base_url=sys.argv[1]).write_pdf(sys.argv[2])
print("pdf written")
PY

pdfinfo "$PDF" | grep -E "^Pages"
ls -lh "$PDF"
