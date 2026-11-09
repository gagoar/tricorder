import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plain, readConfig, run, sandbox, writeConfig } from "./helpers";

const CONTEXT_USED_PCT = 42; // hand check: 42% used shows as "🔋 42%"
const FIELD_COUNT = 9; // location, prs, context, model, muteIcon, plan, worktrees, subagents, intro

// A session-less payload (no session_id) so nothing is written to the state
// folder. The folder is not a git repo, so the location shows as "🌳 <name>".
function payload(dir: string): string {
  return JSON.stringify({ cwd: dir, model: { display_name: "Opus 5.5" }, context_window: { used_percentage: CONTEXT_USED_PCT } });
}
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "tricorder-proj-"));
  const p = join(dir, "proj");
  mkdirSync(p);
  return p;
}
function statusline(box: ReturnType<typeof sandbox>, dir: string): string {
  return plain(run(box, ["statusline"], { stdin: payload(dir) }).stdout).trim();
}

test("statusline: with default settings every field shows (muted icon, location, context, model)", () => {
  const box = sandbox();
  assert.equal(statusline(box, project()), `🔇 🌳 proj · 🔋 ${CONTEXT_USED_PCT}% · Opus 5.5`);
});

test("statusline: switching context and the mute icon off removes them", () => {
  const box = sandbox();
  writeConfig(box, { statusline: { fields: { context: false, muteIcon: false } } });
  assert.equal(statusline(box, project()), "🌳 proj · Opus 5.5");
});

test("statusline: with every line-1 field off nothing is printed", () => {
  const box = sandbox();
  writeConfig(box, { statusline: { fields: { location: false, context: false, model: false, muteIcon: false } } });
  assert.equal(statusline(box, project()), "");
});

test("fields: an unknown sub-command, even an inherited name like toString, prints usage and fails", () => {
  const box = sandbox();
  ["bogus", "toString"].forEach((name) => {
    const r = run(box, ["fields", name]);
    assert.equal(r.status, 1, name);
    assert.ok(r.stderr.includes("usage: tricorder fields"), name);
  });
});

test("fields set: exactly the listed fields are on, the rest are off", () => {
  const box = sandbox();
  const r = run(box, ["fields", "set", "context,model"]);
  assert.equal(r.status, 0);
  const f = readConfig(box).statusline.fields;
  assert.equal(f.context, true);
  assert.equal(f.model, true);
  assert.equal(f.location, false);
  assert.equal(f.subagents, false);
});

test("fields set all: every field on again", () => {
  const box = sandbox();
  run(box, ["fields", "set", "model"]);
  run(box, ["fields", "set", "all"]);
  assert.ok(Object.values(readConfig(box).statusline.fields).every((v) => v));
});

test("fields set: an unknown id fails and leaves the config unchanged", () => {
  const box = sandbox();
  run(box, ["fields", "set", "model"]);
  const r = run(box, ["fields", "set", "model,bogus"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("unknown field(s): bogus"));
  assert.equal(readConfig(box).statusline.fields.context, false); // still the earlier result
});

test("fields set: an empty list changes nothing", () => {
  const box = sandbox();
  run(box, ["fields", "set", "model"]);
  const r = run(box, ["fields", "set", ""]);
  assert.ok(r.stdout.includes("nothing changed"));
  assert.equal(readConfig(box).statusline.fields.model, true);
  assert.equal(readConfig(box).statusline.fields.context, false);
});

test("fields describe: lists fields with their explanation and on/off state", () => {
  const box = sandbox();
  run(box, ["fields", "set", "model"]);
  const out = JSON.parse(run(box, ["fields", "describe"]).stdout);
  assert.equal(out.fields.length, FIELD_COUNT);
  const model = out.fields.find((f: { id: string }) => f.id === "model");
  assert.equal(model.enabled, true);
  assert.notEqual(model.shows, "");
  assert.equal(out.fields.find((f: { id: string }) => f.id === "context").enabled, false);
});
