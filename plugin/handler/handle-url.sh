#!/bin/bash
# Dispatch a tricorder:// URL opened from a statusline OSC 8 link.
#   tricorder://mute            -> toggle mute
#   tricorder://open?path=<enc> -> `open <path>` (extension's default app)
url="$1"
bin="$HOME/.claude/tricorder-src/plugin/bin/tricorder"

case "$url" in
  "tricorder://mute")
    exec "$bin" mute toggle
    ;;
  "tricorder://open?path="*)
    enc="${url#tricorder://open?path=}"
    # percent-decode: turn %XX into \xXX and let printf interpret it
    path=$(printf '%b' "${enc//%/\\x}")
    exec open "$path"
    ;;
esac
