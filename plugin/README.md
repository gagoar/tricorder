# Tricorder

An always-on Claude Code session panel plus Star Trek attention sounds. See
the [repo README](../README.md) and the
[live site](https://gagoar.github.io/tricorder/) for the full picture,
screenshots, and the sound catalog — this file covers the plugin itself.

The statusline shows, on multiple lines and only when there's something to show:

```
🔔 main · 🔋 71% · Opus 4.8                                    🗺️ plan
🪖 #12  #13  #15
🤖 Explore Opus 4.8, review Sonnet 5
```

- **Worktree / cwd** — a `file://` link (Cmd-click to open it in the app associated with its extension via macOS LaunchServices — no menu-bar app needed for this).
- **Context gauge** — percent only, colored green/yellow/red (green below 70%, yellow from 70%, red from 90%). It reports the truth; it cannot force a compact (the harness owns that).
- **Model** — the current session model.
- **PRs** — every PR created this session, each an `https` link.
- **Sub-agents** — one line per running sub-agent: type and model, comma-separated. The model is exact when the spawn set an override, or inherited from the session once the statusline has rendered at least once (no Claude Code hook payload carries the session's model name, only the statusline's does); until then it shows `default`. This only affects the statusline's own display — the menu-bar app never shows model, so it's unaffected either way.
- **Plan** — the plan file, right-aligned, a `file://` link.
- **🔇** — shown only when muted (a passive indicator; mute itself lives in the menu-bar app, not the statusline).

## What it ships

One binary, ten subcommands, dispatched by the first argument:

| Subcommand | Wired to | Does |
|---|---|---|
| `tricorder statusline` | `statusLine.command` | renders the panel from the stdin payload + session state |
| `tricorder capture` | hooks (Pre/PostToolUse, PermissionRequest, Stop, UserPromptSubmit, SessionEnd, sub-agent lifecycle) | records attention state, PRs, sub-agents, and the plan path |
| `tricorder sound <event>` | `Notification` / `PermissionRequest` / `Stop` / plan hooks | plays the mapped sound unless muted |
| `tricorder sound-enable <event> [on\|off\|toggle]` | menu-bar app | flips one sound's enabled flag |
| `tricorder sound-set <event> <url> [name]` | the [sound catalog page](https://gagoar.github.io/tricorder/sounds.html) | fetches a clip on demand (trekcore.com only) and assigns it to an event |
| `tricorder mute [on\|off\|toggle]` | menu-bar app | flips the global mute |
| `tricorder warp` | menu-bar app / `tricorder://warp` | flies the Enterprise across a fresh iTerm2 tab |
| `tricorder status` | menu-bar app (polled every 1s) | prints a JSON snapshot of all sessions + config |
| `tricorder ack <id>` | menu-bar app | clears a session's attention state |
| `tricorder logs [n\|clear]` | menu-bar app / you | shows or clears the activity log |

`capture` and `sound` arrive as plugin hooks and **merge** with your existing hooks. The statusline is the one line you add yourself — plugins cannot contribute a `statusLine`. The rest are driven by the native macOS menu-bar app, `TricorderBar` — see the repo README for building and installing it.

## Install

This is the statusline path — fully independent of the menu-bar app, no
build step required. See the [repo README](../README.md#install) for the
menu-bar-app-only path, or for running both together.

```
/plugin marketplace add ~/.claude/tricorder-src
/plugin install tricorder@tricorder
```

Then add the statusline to `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "\"${CLAUDE_PLUGIN_ROOT}\"/bin/tricorder statusline"
}
```

If `${CLAUDE_PLUGIN_ROOT}` does not expand in that context, point it at the binary's absolute path instead (the installed copy under `~/.claude/plugins/cache/`, or your dev build at `~/.claude/tricorder-src/plugin/bin/tricorder`).

## Config

Effective config lives at `~/.claude/tricorder/config.json`, seeded on first run:

```json
{
  "muted": true,
  "sounds": {
    "question":   { "enabled": true,  "file": ".../please-specify.mp3" },
    "permission": { "enabled": false, "file": ".../security-authorisation.mp3" },
    "stop":       { "enabled": true,  "file": ".../transporter-complete.mp3" },
    "plan":       { "enabled": true,  "file": ".../engage.mp3" }
  }
}
```

Sounds are **muted by default** — turn them on from the menu-bar app. `permission` defaults off since under `auto` mode with `skipAutoPermissionPrompt` it never fires anyway, and when it did it doubled up on questions. Edit a `file` to change a sound (or pick one from the [sound catalog](https://gagoar.github.io/tricorder/sounds.html), which fetches it for you), flip `enabled` to silence one event, or set `muted` to silence all. Sounds seed from the plugin's `sounds/` into `~/.claude/tricorder/sounds/` on first play.

`stop` overlaps with tars-voice, which also speaks on turn end. Disable one if the pair is too much.

## Mute from the iTerm2 status bar (optional, superseded by the menu-bar app)

`scripts/iterm-mute.py` is an iTerm2 status bar component with a clickable mute glyph. Copy it to `~/Library/Application Support/iTerm2/Scripts/AutoLaunch/`, enable iTerm2's Python API, then add the "Tricorder mute" component in the status bar settings. `capture` also publishes `user.tricorder_prs`, `user.tricorder_subagents`, `user.tricorder_plan`, and `user.tricorder_muted` as iTerm2 variables you can show with plain Interpolated String components. The native menu-bar app (`TricorderBar`, see the repo README) does all of this and more without any iTerm2 scripting setup.

## Build (from tricorder-src)

```
npm install
npm run build       # esbuild bundle -> node-shim -> plugin/bin/tricorder (~30KB, committed)
npm run build:bar   # swiftc -> plugin/bar/TricorderBar.app (no Xcode required)
```

The binary lands in `plugin/bin/`, so building is packaging. `npm run build:sea` produces an optional ~119MB standalone binary with no Node dependency.
