#!/usr/bin/env bash
# Build the Tricorder.app URL-scheme handler (tricorder://) from AppleScript.
set -euo pipefail
cd "$(dirname "$0")"

APP="plugin/handler/Tricorder.app"
PL="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy

chmod +x plugin/handler/handle-url.sh

rm -rf "$APP"
osacompile -o "$APP" plugin/handler/tricorder-url.applescript

# No Dock icon; register the tricorder:// scheme.
# (osacompile already sets NSAppleEventsUsageDescription, so we don't re-add it.)
"$PB" -c "Add :LSUIElement bool true" "$PL"
"$PB" -c "Add :CFBundleURLTypes array" "$PL"
"$PB" -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.gago.tricorder" "$PL"
"$PB" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PL"
"$PB" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string tricorder" "$PL"

echo "built $APP"
