#!/usr/bin/env bash
# Regenerate the README/site screenshots from the mockup HTML — doc tooling
# only, not a runtime dependency of Tricorder itself. Requires Google Chrome
# (or set CHROME to another Chromium-based browser's binary).
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  echo "error: Chrome not found at $CHROME (set \$CHROME to another Chromium browser)" >&2
  exit 1
fi

mkdir -p assets

shot() {
  local html="$1" out="$2" w="$3" h="$4"
  "$CHROME" --headless=new --disable-gpu --force-device-scale-factor=2 --hide-scrollbars \
    --default-background-color=00000000 --window-size="${w},${h}" \
    --screenshot="assets/${out}" "file://$PWD/${html}" 2>/dev/null
  echo "wrote assets/${out}"
}

shot mockups/statusline.html statusline.png 780 155
shot mockups/menu.html menu.png 400 420
shot mockups/logo.html logo.png 240 240

echo "done. Inspect the PNGs under docs/assets/ before committing."
