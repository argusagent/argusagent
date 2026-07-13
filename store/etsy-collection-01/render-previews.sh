#!/usr/bin/env bash
set -e
H=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
mkdir -p previews-png
for f in previews/*.svg; do
  base=$(basename "$f" .svg)
  W=$(grep -o 'width="[0-9]*"' "$f" | head -1 | grep -o '[0-9]*')
  Ht=$(grep -o 'height="[0-9]*"' "$f" | head -1 | grep -o '[0-9]*')
  cat > /tmp/wrap.html <<HTML
<!doctype html><html><head><style>*{margin:0}</style></head><body>$(cat "$f")</body></html>
HTML
  $H --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=$W,$Ht --screenshot="previews-png/$base.png" /tmp/wrap.html 2>/dev/null
done
echo "done: $(ls previews-png | wc -l) previews"
