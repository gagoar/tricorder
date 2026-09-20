#!/usr/bin/env python3
"""Tricorder mute toggle — an iTerm2 status bar component.

Install:
  1) cp to  ~/Library/Application Support/iTerm2/Scripts/AutoLaunch/
  2) iTerm2 > Settings > General > Magic > Enable Python API  (then restart iTerm2)
  3) iTerm2 > Settings > Profiles > <profile> > Session > Configure Status Bar,
     drag "Tricorder mute" into the bar.

Shows 🔔 on / 🔇 muted, refreshes every 2s, and toggles on click.
"""
import json
import os
import subprocess

import iterm2

CONFIG = os.path.expanduser("~/.claude/tricorder/config.json")
BIN = os.path.expanduser("~/.claude/tricorder-src/plugin/bin/tricorder")
UPDATE_CADENCE_SECONDS = 2


def is_muted() -> bool:
    try:
        with open(CONFIG, encoding="utf-8") as handle:
            return bool(json.load(handle).get("muted", False))
    except Exception:
        return False


async def main(connection) -> None:
    component = iterm2.StatusBarComponent(
        short_description="Tricorder mute",
        detailed_description="Toggle Tricorder attention sounds",
        knobs=[],
        exemplar="🔔 on",
        update_cadence=UPDATE_CADENCE_SECONDS,
        identifier="com.gago.tricorder.mute",
    )

    @iterm2.StatusBarRPC
    async def render(knobs):  # noqa: ANN001, ANN202
        return "🔇 muted" if is_muted() else "🔔 on"

    @iterm2.RPC
    async def onclick(session_id):  # noqa: ANN001, ANN202
        subprocess.run([BIN, "mute", "toggle"], check=False)

    await component.async_register(connection, render, onclick=onclick)


iterm2.run_forever(main)
