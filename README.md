<p align="center">
  <img src="docs/assets/logo.png" width="120" alt="Tricorder logo — a Starfleet delta">
</p>

<h1 align="center">Tricorder</h1>

<p align="center">
  <em>Full sensor sweep of your Claude Code sessions — an always-on statusline, a Starfleet away-team view in your macOS menu bar, and attention klaxons.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-black?logo=apple" alt="macOS">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License">
  <img src="https://img.shields.io/badge/built%20with-TypeScript%20%2B%20Swift-orange" alt="TypeScript + Swift">
  <img src="https://img.shields.io/badge/made%20for-Claude%20Code-5f43b2" alt="Made for Claude Code">
</p>

<p align="center">
  <img src="docs/assets/statusline.png" width="700" alt="Tricorder statusline: worktree link, context gauge, model, PR links, and running sub-agents">
</p>

<p align="center">
  <strong><a href="https://gagoar.github.io/tricorder/">Live site</a></strong> ·
  <a href="https://gagoar.github.io/tricorder/sounds.html">Sound catalog</a> ·
  <a href="#install">Install</a>
</p>

## What is this

Tricorder is a personal Claude Code plugin plus a native macOS menu-bar app. The
plugin renders a multi-line statusline (worktree, context gauge, model, PRs,
running sub-agents, plan link) and tags every session's attention state from
Claude Code's own hooks. The menu-bar app — `TricorderBar`, plain Swift, no
Xcode required — turns that into one glanceable icon across all your sessions,
lets you jump straight to the one that needs you, restore whole project
families after a restart, and pick your own Star Trek attention sounds from a
public catalog.

It's deeply wired to **iTerm2** by name (session focus, restore, and the
Enterprise flyby all script iTerm2 directly) and needs **Node** on `PATH` at
runtime (or the optional dependency-free build below).

## Features

- **Multi-line statusline** — worktree link, a color-graded context-window gauge, model, PR links, running sub-agents with their model, and a plan-file link. Only non-empty lines render. A one-shot mini-ship animation greets each new session.
- **Away-team menu bar** — one icon reflects the highest-priority state across every session (🔴 security, 🟡 question, 🟢 done). Click a row to focus that session's iTerm2 tab, wherever it is.
- **Restore Sessions** — after a crash or reboot, reopen whole project families in fresh iTerm2 windows with one click, grouped automatically by directory.
- **Attention klaxons** — four Star Trek voice/chime cues, muted by default, toggled per-event from the menu.
- **Sound catalog** — browse and preview real clips from a public archive on the [site](https://gagoar.github.io/tricorder/sounds.html), and assign one to an event with a click — fetched on demand, nothing extra bundled in this repo.
- **Fly the Enterprise** 🚀 — because you can.

## Screenshots

<p align="center"><img src="docs/assets/statusline.png" width="700" alt="Statusline"><br>
<sub>Worktree · context gauge · model — PR links — running sub-agents with model — plan link (right-aligned)</sub></p>

<p align="center"><img src="docs/assets/menu.png" width="380" alt="Menu-bar dropdown"><br>
<sub>Every session, its state and age, Restore Sessions, mute/sound toggles, and a live activity tail</sub></p>

## Requirements

- macOS (uses AppKit, AppleScript, `afplay`)
- **iTerm2** — session focus, restore, warp, and log-tail all target it by name; no fallback for other terminals
- **Node** on `PATH` at runtime (the shipped binary is a Node shim) — or run `npm run build:sea` for a ~119MB standalone binary with no Node dependency
- A Swift toolchain (`swiftc` — no Xcode) to build the menu-bar app
- Claude Code with plugin support

## Install

**1. Install the plugin**
```
/plugin marketplace add ~/.claude/tricorder-src
/plugin install tricorder@tricorder
```
This wires the `capture` and `sound` hooks automatically — they merge with any hooks you already have.

**2. Wire the statusline** — plugins can't contribute one, so add this once to `~/.claude/settings.json`:
```json
"statusLine": {
  "type": "command",
  "command": "\"${CLAUDE_PLUGIN_ROOT}\"/bin/tricorder statusline"
}
```

**3. Build and launch the menu-bar app**
```
npm install
npm run build:bar
cp plugin/bar/TricorderBar.app ~/Applications/ -R
sed "s|__HOME__|$HOME|g" bar/com.gago.tricorder.bar.plist > ~/Library/LaunchAgents/com.gago.tricorder.bar.plist
launchctl load ~/Library/LaunchAgents/com.gago.tricorder.bar.plist
```
The first time it focuses a session or restores one, macOS asks permission for Tricorder to control iTerm2 — allow it.

**Optional: dependency-free binary**
```
npm run build:sea
```
Produces a self-contained binary that doesn't need Node on `PATH`.

## Configuration

Effective config lives at `~/.claude/tricorder/config.json`, seeded on first run. `muted` is `true` by default.

| Event | Default | Line |
|---|---|---|
| `question` | on | "Please specify how you would like to proceed" |
| `permission` | **off** | "Security authorisation required" |
| `stop` | on | Transporter chime |
| `plan` | on | "Engage" |

Pick a different clip for any event from the [sound catalog](https://gagoar.github.io/tricorder/sounds.html) — it fetches on demand into `~/.claude/tricorder/sounds/` and updates the config for you. Override a menu-bar icon by dropping `~/.claude/tricorder/icons/<state>.svg`.

## CLI reference

| Command | Wired to | Does |
|---|---|---|
| `statusline` | `statusLine` setting | Renders the panel |
| `capture` | hooks | Records session state |
| `sound <event>` | hooks | Plays a configured sound if not muted |
| `sound-enable <event> [on\|off\|toggle]` | menu | Flips one sound's enabled flag |
| `sound-set <event> <url> [name]` | catalog page | Fetches a pick and assigns it to an event (trekcore.com only) |
| `mute [on\|off\|toggle]` | menu | Flips the global mute |
| `warp` | menu / URL | Flies the Enterprise |
| `status` | menu (polled) | JSON snapshot for the menu-bar app |
| `ack <id>` | menu | Clears a session's attention state |
| `logs [n\|clear]` | menu | Shows or clears the activity log |

## How it works

Claude Code hooks call `tricorder capture` on every meaningful event, which
writes tiny per-session state files under `~/.claude/tricorder/state/`.
`tricorder statusline` renders from that state plus the stdin payload Claude
Code gives it. `TricorderBar.swift` polls `tricorder status` on a 1-second
background timer and only ever reads cached results when you open the menu,
so opening it is instant no matter how much is going on.

## Credits

- Menu-bar icons: [Star Trek Icons](https://github.com/adejong5/star-trek-icons) by Andrew DeJong, **CC BY-SA 4.0** — several sourced/scaled from The Noun Project (see [`bar/icons/ATTRIBUTION.md`](bar/icons/ATTRIBUTION.md) for per-icon credit).
- Sound catalog clips stream live from the public [trekcore.com audio archive](https://www.trekcore.com/audio/) — **no audio is bundled or redistributed by this repo**; Tricorder fetches your pick the same way clicking the link yourself would. The four default sounds shipped in `plugin/sounds/` are short fan-sourced clips included for personal, non-commercial use — replace them with your own audio if you're forking this for wider distribution.
- LCARS site styling informed by [mttaggart/lcars-css](https://github.com/mttaggart/lcars-css) and [joernweissenborn/lcars](https://github.com/joernweissenborn/lcars) (both MIT). Font: [Antonio](https://fonts.google.com/specimen/Antonio) (OFL).
- *Star Trek* and related marks are owned by CBS Studios / Paramount. This is a non-commercial personal project, not affiliated with or endorsed by them.

## License

[MIT](LICENSE) for the code. See Credits above for the icon and sound provenance, which carry their own terms.
