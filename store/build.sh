#!/usr/bin/env bash
# Rebuild all sellable assets from their HTML sources.
# Requires Chromium headless (any recent Chrome/Chromium works).
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-$(command -v chromium || command -v google-chrome || echo /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell)}"

pdf() { "$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer --print-to-pdf="$2" "$1"; }
png() { "$CHROME" --headless --disable-gpu --no-sandbox --window-size=1280,720 --screenshot="$2" "$1"; }

pdf products/practical-typescript/guide.html products/practical-typescript/practical-typescript-field-guide.pdf
pdf products/git-rescue/cheatsheet.html      products/git-rescue/git-rescue-kit.pdf
png covers/cover-practical-typescript.html   covers/cover-practical-typescript.png
png covers/cover-git-rescue.html             covers/cover-git-rescue.png

echo "Built: 2 PDFs + 2 covers"
