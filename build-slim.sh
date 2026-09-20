#!/usr/bin/env bash
# Default build: a ~15KB node-shim at plugin/bin/tricorder (committed, backup-friendly).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build plugin/bin

echo "[1/2] esbuild bundle -> build/tricorder.cjs"
npm run --silent bundle

echo "[2/2] node-shim -> plugin/bin/tricorder"
{ printf '#!/usr/bin/env node\n'; cat build/tricorder.cjs; } > plugin/bin/tricorder
chmod +x plugin/bin/tricorder

echo "done: plugin/bin/tricorder ($(wc -c < plugin/bin/tricorder | tr -d ' ') bytes)"
