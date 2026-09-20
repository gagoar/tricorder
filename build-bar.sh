#!/usr/bin/env bash
# Build the native menu-bar app TricorderBar.app from Swift (no Xcode).
set -euo pipefail
cd "$(dirname "$0")"

APP="plugin/bar/TricorderBar.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

echo "[1/3] swiftc -> $APP/Contents/MacOS/TricorderBar"
swiftc -O -o "$APP/Contents/MacOS/TricorderBar" bar/TricorderBar.swift bar/Relaunch.swift \
  -framework AppKit -framework Foundation

echo "[2/3] Info.plist + Star Trek icons"
cp bar/Info.plist "$APP/Contents/Info.plist"
mkdir -p "$APP/Contents/Resources"
cp bar/icons/idle.svg bar/icons/question.svg bar/icons/done.svg bar/icons/security.svg "$APP/Contents/Resources/"

echo "[3/3] ad-hoc codesign"
codesign --force --deep --sign - "$APP"

echo "built $APP"
codesign -dv "$APP" 2>&1 | sed -n '1,2p' || true
