# Tricorder

An always-on Claude Code session panel plus Star Trek attention sounds.

The statusline shows, on multiple lines and only when there's something to show:

```
🔔 main (worktree:/…/feature-x) · ctx 142k/200k · 71% · Opus 4.8
PRs: #12  #13  #15
▸ Reverse-engineer terrain | Explore · Sonnet 5
▸ Design the plan          | Plan · Opus 4.8
plan: my-plan.md
```

- **Worktree / cwd** — rendered as a `file://` link (Cmd-click to open).
- **Context gauge** — real tokens and percent from the payload, colored green/yellow/red, with `⚠ >200k` when the window is exceeded. It reports the truth; it cannot force a compact (the harness owns that).
- **Model** — the current session model.
- **PRs** — every PR created this session, each an `https` link.
- **Sub-agents** — one line per running sub-agent: description, type, and model. The model is exact only when the spawn set an override; otherwise it shows `default`.
- **Plan** — the plan file, a `file://` link.
- **🔔 / 🔇** — the mute glyph.

## What it ships

One binary, four subcommands, dispatched by the first argument:

| Subcommand | Wired to | Does |
|---|---|---|
| `tricorder statusline` | `statusLine.command` | renders the panel from the stdin payload + session state |
| `tricorder capture` | `PreToolUse` / `PostToolUse` hooks | records PRs, sub-agents, and the plan path |
| `tricorder sound <event>` | `Notification` / `PermissionRequest` / `Stop` hooks | plays the mapped sound unless muted |
| `tricorder mute [on\|off\|toggle]` | you, or the iTerm2 component | flips mute |

`capture` and `sound` arrive as plugin hooks and **merge** with your existing hooks. The statusline is the one line you add yourself — plugins cannot contribute a `statusLine`.

## Install

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
  "muted": false,
  "sounds": {
    "question":   { "enabled": true, "file": ".../please-specify.mp3" },
    "permission": { "enabled": true, "file": ".../security-authorisation.mp3" },
    "stop":       { "enabled": true, "file": ".../transporter-complete.mp3" }
  }
}
```

Edit a `file` to change a sound, flip `enabled` to silence one event, or set `muted` to silence all. Sounds seed from the plugin's `sounds/` into `~/.claude/tricorder/sounds/` on first play.

`stop` overlaps with tars-voice, which also speaks on turn end. Disable one if the pair is too much.

## Mute from the iTerm2 status bar

`scripts/iterm-mute.py` is an iTerm2 status bar component with a clickable mute glyph. Copy it to `~/Library/Application Support/iTerm2/Scripts/AutoLaunch/`, enable iTerm2's Python API, then add the "Tricorder mute" component in the status bar settings. `capture` also publishes `user.tricorder_prs`, `user.tricorder_subagents`, `user.tricorder_plan`, and `user.tricorder_muted` as iTerm2 variables you can show with plain Interpolated String components.

## Build (from tricorder-src)

```
npm install
npm run build   # esbuild bundle -> Node SEA binary -> plugin/bin/tricorder (codesigned)
```

The binary lands in `plugin/bin/`, so building is packaging.
