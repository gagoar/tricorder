#!/usr/bin/env node
// Safely merge Tricorder's statusLine into a Claude Code settings.json —
// preserves every other key, backs up the original first, and asks before
// overwriting a *different* statusLine someone already has configured.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const JSON_INDENT = 2;
const TRICORDER_COMMAND = '"${CLAUDE_PLUGIN_ROOT}"/bin/tricorder statusline';

const target = process.argv[2] || path.join(require("node:os").homedir(), ".claude", "settings.json");

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("patch-statusline: could not parse " + file + ": " + err.message);
    process.exit(1);
  }
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = file + ".bak-" + stamp;
  fs.copyFileSync(file, dest);
  return dest;
}

const settings = readSettings(target);
const desired = { type: "command", command: TRICORDER_COMMAND };
const current = settings.statusLine;
const alreadyOurs =
  current && typeof current === "object" && current.type === "command" && current.command === TRICORDER_COMMAND;

if (alreadyOurs) {
  console.log("statusLine already set to Tricorder — nothing to change.");
  process.exit(0);
}

if (current !== undefined) {
  console.log("A different statusLine is already configured in " + target + ":");
  console.log(JSON.stringify(current, null, JSON_INDENT));
  console.log("Refusing to overwrite it automatically. Add this to " + target + " yourself if you want it:");
  console.log(JSON.stringify({ statusLine: desired }, null, JSON_INDENT));
  process.exit(2);
}

const backedUpTo = backup(target);
settings.statusLine = desired;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(settings, null, JSON_INDENT) + "\n");

console.log("Wrote statusLine to " + target + (backedUpTo ? " (backup: " + backedUpTo + ")" : ""));
