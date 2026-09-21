#!/usr/bin/env bash
# Interactive Tricorder setup — asks what you want, defaults to both.
# The statusline and the menu-bar app are fully independent; say no to
# either without breaking the other.
set -uo pipefail
cd "$(dirname "$0")"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
# No real TTY (piped/CI/non-interactive) -> read from /dev/null so `read`
# fails immediately and quietly, falling through to defaults, instead of
# printing "Device not configured" noise from a missing /dev/tty.
TTY_SOURCE=/dev/null
[ -r /dev/tty ] && TTY_SOURCE=/dev/tty
ok()   { echo "${GREEN}✓${RESET} $1"; }
warn() { echo "${YELLOW}!${RESET} $1"; }
info() { echo "${DIM}  $1${RESET}"; }

ask_yn() { # prompt, default(Y|N) -> prints "yes" or "no"
  local prompt="$1" default="$2" ans
  local hint="Y/n"; [ "$default" = "N" ] && hint="y/N"
  read -r -p "$prompt [$hint] " ans 2>/dev/null <"$TTY_SOURCE" || ans=""
  ans="${ans:-$default}"
  case "$ans" in [Yy]*) echo "yes" ;; *) echo "no" ;; esac
}

ask_worktree_click() { # -> prints "open" | "copy" | "both"
  local ans
  echo "  1) Open the directory (default, works with no app installed)"
  echo "  2) Copy the path"
  echo "  3) Both"
  read -r -p "  Clicking the worktree link should [1]: " ans 2>/dev/null <"$TTY_SOURCE" || ans=""
  case "$ans" in
    2) echo "copy" ;;
    3) echo "both" ;;
    *) echo "open" ;;
  esac
}

echo "${BOLD}🖖 Tricorder setup${RESET}"
echo "The statusline (terminal panel) and the menu-bar app are independent."
echo "Default is both — press enter to accept, or answer no to skip one."
echo

WANT_STATUSLINE=$(ask_yn "Install the statusline?" Y)
WANT_BAR=$(ask_yn "Install the menu-bar app?" Y)
echo

if [ "$WANT_STATUSLINE" = "no" ] && [ "$WANT_BAR" = "no" ]; then
  warn "Nothing selected — nothing to do."
  exit 0
fi

STATUSLINE_OK=0
BAR_OK=0

# ---- statusline -------------------------------------------------------------
if [ "$WANT_STATUSLINE" = "yes" ]; then
  echo "${BOLD}Statusline${RESET}"
  if ! command -v claude >/dev/null 2>&1; then
    warn "the 'claude' CLI isn't on PATH — can't run /plugin commands automatically."
    info "Run these yourself inside a Claude Code session instead:"
    info "  /plugin marketplace add $PWD"
    info "  /plugin install tricorder@tricorder"
  else
    if claude plugin marketplace add "$PWD" 2>&1 | sed 's/^/  /'; then ok "marketplace registered"; fi
    if claude plugin install tricorder@tricorder 2>&1 | sed 's/^/  /'; then
      ok "plugin installed"
    else
      warn "plugin install reported an error — check the output above"
    fi
    if node scripts/patch-statusline.js 2>&1 | sed 's/^/  /'; then
      STATUSLINE_OK=1
      ok "statusLine wired in ~/.claude/settings.json"
    else
      warn "statusLine not changed automatically — see the message above"
    fi
    echo
    echo "  Clicking the worktree path in the statusline can open it, copy it, or both."
    WORKTREE_CLICK_MODE=$(ask_worktree_click)
    node plugin/bin/tricorder worktree-click "$WORKTREE_CLICK_MODE" >/dev/null 2>&1 \
      && ok "worktree link set to '$WORKTREE_CLICK_MODE'"
    if [ "$WORKTREE_CLICK_MODE" != "open" ] && [ "$WANT_BAR" = "no" ]; then
      warn "copy/both need the menu-bar app running to handle the click — install it too, or the link will do nothing."
    fi
  fi
  echo
fi

# ---- menu-bar app -------------------------------------------------------------
if [ "$WANT_BAR" = "yes" ]; then
  echo "${BOLD}Menu-bar app${RESET}"
  if ! command -v swiftc >/dev/null 2>&1; then
    warn "swiftc not found — install Xcode Command Line Tools (xcode-select --install) and re-run this script."
  else
    if bash build-bar.sh 2>&1 | sed 's/^/  /'; then
      ok "built plugin/bar/TricorderBar.app"
      rm -rf "$HOME/Applications/TricorderBar.app"
      mkdir -p "$HOME/Applications"
      cp -R plugin/bar/TricorderBar.app "$HOME/Applications/TricorderBar.app"
      /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
        -f "$HOME/Applications/TricorderBar.app" >/dev/null 2>&1
      mkdir -p "$HOME/Library/LaunchAgents"
      sed "s|__HOME__|$HOME|g" bar/com.gago.tricorder.bar.plist > "$HOME/Library/LaunchAgents/com.gago.tricorder.bar.plist"
      launchctl unload "$HOME/Library/LaunchAgents/com.gago.tricorder.bar.plist" >/dev/null 2>&1 || true
      if launchctl load "$HOME/Library/LaunchAgents/com.gago.tricorder.bar.plist" 2>&1 | sed 's/^/  /'; then
        BAR_OK=1
        ok "launched — look for the icon in your menu bar"
        info "macOS will ask once to let Tricorder control iTerm2 — allow it."
      else
        warn "LaunchAgent load reported an error — check the output above"
      fi
    else
      warn "build failed — check the output above"
    fi
  fi
  echo
fi

# ---- summary ------------------------------------------------------------------
echo "${BOLD}Done${RESET}"
if [ "$WANT_STATUSLINE" = "yes" ]; then
  if [ "$STATUSLINE_OK" = 1 ]; then ok "Statusline: restart Claude Code sessions to see it"
  else warn "Statusline: not fully configured (see above)"; fi
fi
if [ "$WANT_BAR" = "yes" ]; then
  if [ "$BAR_OK" = 1 ]; then ok "Menu-bar app: running now"
  else warn "Menu-bar app: not fully configured (see above)"; fi
fi

# The script's own exit code reflects "ran to completion", not the truthiness
# of the last status line above.
exit 0
