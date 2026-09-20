#!/usr/bin/env bash
# Optional build: a self-contained Node SEA binary at dist/tricorder (~119MB, no node needed).
set -euo pipefail
cd "$(dirname "$0")"

FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
BIN="dist/tricorder"
mkdir -p build dist

echo "[1/5] esbuild bundle"
npm run --silent bundle
echo "[2/5] SEA blob"
node --experimental-sea-config sea.json
echo "[3/5] copy node runtime"
cp "$(command -v node)" "$BIN"
echo "[4/5] strip signature + inject blob"
codesign --remove-signature "$BIN"
npx --yes postject "$BIN" NODE_SEA_BLOB build/tricorder.blob \
  --sentinel-fuse "$FUSE" \
  --macho-segment-name NODE_SEA
echo "[5/5] ad-hoc codesign"
codesign --sign - "$BIN"

echo "done: $BIN"
