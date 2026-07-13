#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
H=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
mkdir -p files
for f in svg-full/*.svg; do
  base=$(basename "$f" .svg)
  design="${base%%__*}"
  mkdir -p "files/$design"
  jpg="files/$design/$base.jpg"
  [ -f "$jpg" ] && continue
  W=$(grep -o 'width="[0-9]*"' "$f" | head -1 | grep -o '[0-9]*')
  Ht=$(grep -o 'height="[0-9]*"' "$f" | head -1 | grep -o '[0-9]*')
  wrap=/tmp/wrap-full.html
  printf '<!doctype html><html><head><style>*{margin:0}</style></head><body>%s</body></html>' "$(cat "$f")" > $wrap
  $H --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=$W,$Ht --screenshot=/tmp/full.png $wrap 2>/dev/null
  python3 - "$jpg" <<PY
from PIL import Image
import sys
Image.MAX_IMAGE_PIXELS = None
im = Image.open('/tmp/full.png').convert('RGB')
im.save(sys.argv[1], quality=92, dpi=(300,300), optimize=True)
PY
  echo "done $base"
done
echo "ALL RENDERS COMPLETE: $(find files -name '*.jpg' | wc -l) files"
