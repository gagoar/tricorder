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

- **Worktree / cwd** — a link whose click behavior is configurable (`worktreeClick` in config, default `open`): open it in the app associated with its extension via macOS LaunchServices (`file://`, no menu-bar app needed), copy the path to the clipboard, or both. Copy/both route through the menu-bar app, since a bare link can't write the clipboard on its own — see [Config](#config).
- **Uncommitted changes** — a yellow `*` after the branch name (`my-repo(main*)`, or `🌳 fix-login*` in a worktree) when the folder has edited, staged or new files that are not committed. Nothing is shown outside a git repository. It runs `git status --porcelain` each time the statusline redraws; switch the `dirty` field off if that is slow in a very large repository.
- **Context gauge** — percent only, colored green/yellow/red (green below 70%, yellow from 70%, red from 90%). It reports the truth; it cannot force a compact (the harness owns that).
- **Model** — the current session model.
- **5-hour and 7-day usage** (subscription accounts) — `5h 🐕 37% · 7d 🐢 12%`: the share of each usage limit used, with an animal for the pace (used % minus the % of the window gone): 🐢 Chill (green, more than `marginPts` under), 🐕 On track (blue, within `marginPts`), 🐎 Watch out (orange, up to twice `marginPts` over), 🦅 Hot (red, beyond that), 🐉 Over (magenta, limit used up). Below `minElapsedPct` of the window gone a 🦥 sloth (grey) shows instead, because the pace would mean nothing yet; without a reset time only the percent shows. `marginPts` (default 10) and `minElapsedPct` (default 3) are in the `statusline.pace` config block; see the main README for the worked numbers. Pay-per-use accounts send no limits and are not offered these fields.
- **Account email** (subscription accounts) — the sign-in email in grey at the right edge of line 1, after the plan link, so you can tell a personal and a work account apart. Read from `$CLAUDE_CONFIG_DIR/.claude.json` (else `~/.claude.json`); shown nothing if it cannot be found. 6 columns are kept free at the right edge while it shows. It also shows in screenshots: switch the `account` field off if that matters.
- **Monthly spend** (pay-per-use accounts) — `💰 $62/$200 🐕 31%`: this month's estimated spend in US dollars (calendar month, UTC), the budget set with `tricorder budget` (`statusline.budget.monthlyUsd`, not a limit), the pace animal (share of budget spent minus share of the month gone, same bands as above) and the share spent. 🐉 Over means more than 100% of the budget. With no budget: `💰 $62`. Claude Code reports only each session's own cost, so tricorder keeps a running total per session in `~/.claude/tricorder/spend/`; it is an estimate and misses sessions without a statusline, other machines and other tools on the same key. Subscription accounts do not show it.
- **PRs** — every PR created this session, each an `https` link.
- **Sub-agents** — one line per running sub-agent: type and model, comma-separated. The model is exact when the spawn set an override, or inherited from the session once the statusline has rendered at least once (no Claude Code hook payload carries the session's model name, only the statusline's does); until then it shows `default`. This only affects the statusline's own display — the menu-bar app never shows model, so it's unaffected either way.
- **Plan** — the plan file, right-aligned, a `file://` link.
- **🔇** — shown only when muted (a passive indicator; mute itself lives in the menu-bar app, not the statusline).

## What it ships

One binary, eleven subcommands, dispatched by the first argument:

| Subcommand | Wired to | Does |
|---|---|---|
| `tricorder statusline` | `statusLine.command` | renders the panel from the stdin payload + session state |
| `tricorder capture` | hooks (Pre/PostToolUse, PermissionRequest, Stop, UserPromptSubmit, SessionEnd, sub-agent lifecycle) | records attention state, PRs, sub-agents, and the plan path |
| `tricorder sound <event>` | `Notification` / `PermissionRequest` / `Stop` / plan hooks | plays the mapped sound unless muted, and stamps the session's "last sound" time for the menu-bar app's 🔊 indicator |
| `tricorder sound-enable <event> [on\|off\|toggle]` | menu-bar app | flips one sound's enabled flag |
| `tricorder sound-set <event> <url> [name]` | the [sound catalog page](https://gagoar.github.io/tricorder/sounds.html) | fetches a clip on demand (trekcore.com only) and assigns it to an event |
| `tricorder mute [on\|off\|toggle]` | menu-bar app | flips the global mute |
| `tricorder worktree-click <open\|copy\|both>` | `setup.sh` / menu-bar app | sets what clicking the worktree link does |
| `tricorder detect` | `/tricorder:setup` | prints the detected account type (subscription, payg or unknown) as JSON |
| `tricorder fields describe [type]` | `/tricorder:setup` | lists the statusline fields that apply to the account, with explanations and on/off state |
| `tricorder fields questions [type]` | `/tricorder:setup` | prints the exact tick-box questions the setup command asks (JSON) |
| `tricorder fields preview` | `/tricorder:setup` | draws the statusline for a made-up session with your chosen fields; touches nothing real |
| `tricorder budget [<dollars>\|off]` | `/tricorder:setup` / you | shows or sets the monthly budget (US dollars) used by the spend field |
| `tricorder fields set <id,id,...\|all>` | `/tricorder:setup` | sets exactly which statusline fields are on |
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
  "worktreeClick": "open",
  "statusline": {
    "mode": "auto",
    "fields": { "muteIcon": true, "location": true, "dirty": true, "prs": true, "context": true, "model": true,
                "usage5h": true, "usage7d": true, "spend": true, "plan": true, "account": true, "worktrees": true, "subagents": true, "intro": true },
    "pace": { "marginPts": 10, "minElapsedPct": 3 },
    "budget": { "monthlyUsd": null }
  },
  "sounds": {
    "question":   { "enabled": true,  "file": ".../please-specify.mp3" },
    "permission": { "enabled": false, "file": ".../security-authorisation.mp3" },
    "stop":       { "enabled": true,  "file": ".../transporter-complete.mp3" },
    "plan":       { "enabled": true,  "file": ".../engage.mp3" }
  }
}
```

Sounds are **muted by default** — turn them on from the menu-bar app. `permission` defaults off since under `auto` mode with `skipAutoPermissionPrompt` it never fires anyway, and when it did it doubled up on questions. Edit a `file` to change a sound (or pick one from the [sound catalog](https://gagoar.github.io/tricorder/sounds.html), which fetches it for you), flip `enabled` to silence one event, or set `muted` to silence all. Sounds seed from the plugin's `sounds/` into `~/.claude/tricorder/sounds/` on first play.

`statusline.fields` switches each statusline field on or off (all on by default). Run `/tricorder:setup` in Claude Code to see what each field shows and tick the ones you want, or use `tricorder fields set`. `statusline.mode` is `auto` (detect subscription vs pay per use from Claude Code's `.claude.json`), `subscription` or `payg`.

`worktreeClick` is `open` (a bare `file://` link, no app needed), `copy` (copies the path to the clipboard), or `both`. `copy`/`both` need the menu-bar app running — set it from `setup.sh`, or from the app's "Worktree Link" menu.

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
