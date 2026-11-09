import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plain, readConfig, run, sandbox, writeConfig } from "./helpers";

const CONTEXT_USED_PCT = 42; // hand check: 42% used shows as "🔋 42%"
const ACCOUNT_SUBSCRIPTION = "subscription";
const ACCOUNT_FILE = ".claude.json";
const PLAN_PRO = "claude_pro";
const ACCOUNT_DIR_PREFIX = "tricorder-acct-";
const DESCRIBE = "describe";
const QUESTIONS = "questions";
// Hand count for a subscription: 12 fields + "Enable all" = 13 options → 4, 4, 4, 1 → the single one borrows: 4, 4, 3, 2.
// Pay per use has no 5h/7d fields but has spend: 11 fields + 1 = 12 options → 4, 4, 4.
const SUBSCRIPTION = { fields: 12, optionCounts: [4, 4, 3, 2] } as const;
const PAYG = { optionCounts: [4, 4, 4] } as const;

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

test("detect: reads the account file of CLAUDE_CONFIG_DIR", () => {
  const box = sandbox();
  const dir = mkdtempSync(join(tmpdir(), ACCOUNT_DIR_PREFIX));
  writeFileSync(join(dir, ACCOUNT_FILE), JSON.stringify({ oauthAccount: { organizationType: PLAN_PRO, hasExtraUsageEnabled: true } }));
  const out = JSON.parse(run(box, ["detect"], { configDir: dir }).stdout);
  assert.equal(out.type, ACCOUNT_SUBSCRIPTION);
  assert.equal(out.plan, PLAN_PRO);
  assert.equal(out.extraUsage, true);
});

test("detect: a config folder with no account entry is pay per use; a missing file is unknown", () => {
  const box = sandbox();
  const withFile = mkdtempSync(join(tmpdir(), ACCOUNT_DIR_PREFIX));
  writeFileSync(join(withFile, ACCOUNT_FILE), "{}");
  assert.equal(JSON.parse(run(box, ["detect"], { configDir: withFile }).stdout).type, "payg");
  const empty = mkdtempSync(join(tmpdir(), ACCOUNT_DIR_PREFIX));
  assert.equal(JSON.parse(run(box, ["detect"], { configDir: empty }).stdout).type, "unknown");
});

test("fields describe: lists fields with their explanation and on/off state", () => {
  const box = sandbox();
  run(box, ["fields", "set", "model"]);
  const out = JSON.parse(run(box, ["fields", DESCRIBE, "payg"]).stdout);
  assert.equal(out.type, "payg");
  const model = out.fields.find((f: { id: string }) => f.id === "model");
  assert.equal(model.enabled, true);
  assert.notEqual(model.shows, "");
  assert.equal(out.fields.find((f: { id: string }) => f.id === "context").enabled, false);
});

test("fields describe/questions: an unknown account type fails instead of being guessed", () => {
  const box = sandbox();
  [DESCRIBE, QUESTIONS].forEach((sub) => {
    const r = run(box, ["fields", sub, "subscripton"]);
    assert.equal(r.status, 1, sub);
    assert.ok(r.stderr.includes("unknown account type: subscripton"), sub);
    assert.equal(r.stdout, "", sub);
  });
});

test("fields questions: for a subscription gives 3 questions (4, 4, 3, 2 options) in one call", () => {
  const box = sandbox();
  const out = JSON.parse(run(box, ["fields", QUESTIONS, ACCOUNT_SUBSCRIPTION]).stdout);
  assert.equal(out.calls.length, 1);
  assert.deepEqual(out.calls[0].map((q: { options: unknown[] }) => q.options.length), SUBSCRIPTION.optionCounts);
  assert.equal(out.labels["Context window"], "context");
});

// Hand check: the options follow the statusline's left-to-right order, with "Enable all" first.
const QUESTION_LABELS_IN_ORDER = [
  "Enable all", "Mute icon", "Location", "Uncommitted changes",
  "Pull requests", "Context window", "Model", "5-hour usage",
  "7-day usage", "Plan link", "Other worktrees", "Sub-agents",
  "Start-up animation",
];

test("fields questions: options are listed in the order the statusline draws the fields", () => {
  const box = sandbox();
  const out = JSON.parse(run(box, ["fields", QUESTIONS, ACCOUNT_SUBSCRIPTION]).stdout);
  const labels = out.calls.flat().flatMap((q: { options: { label: string }[] }) => q.options.map((o) => o.label));
  assert.deepEqual(labels, QUESTION_LABELS_IN_ORDER);
});

// Hand check: with every field on, the made-up session shows these four lines.
const PREVIEW_LINE_1_START = "🔇 🌳 fix-login* (#12) · 🔋 42% · Opus 5.5 · 5h 🐕 37% · 7d 🐢 12%";
const PREVIEW_LINE_1_END = "🗺️ plan";
const PREVIEW_LINES = ["add-tests (#13)", "🤖 Explore Opus 4.8, review Sonnet 5"];
const PREVIEW_SHIP = "o≡≡≡>";

test("fields preview: with every field on, all ten fields are drawn, in catalogue order", () => {
  const box = sandbox();
  const lines = run(box, ["fields", "preview"]).stdout.trimEnd().split("\n");
  assert.ok(lines[0]?.startsWith(PREVIEW_LINE_1_START));
  assert.ok(lines[0]?.endsWith(PREVIEW_LINE_1_END));
  assert.deepEqual(lines.slice(1, PREVIEW_LINES.length + 1), PREVIEW_LINES);
  assert.ok(lines[PREVIEW_LINES.length + 1]?.startsWith(PREVIEW_SHIP));
});

test("fields preview: shows only the fields that are on", () => {
  const box = sandbox();
  run(box, ["fields", "set", "context,model"]);
  const out = run(box, ["fields", "preview"]).stdout.trimEnd();
  assert.equal(out, "🔋 42% · Opus 5.5");
});

test("fields preview: leaves the real config and session state alone", () => {
  const box = sandbox();
  run(box, ["fields", "set", "model"]);
  const before = readConfig(box);
  run(box, ["fields", "preview"]);
  assert.deepEqual(readConfig(box), before);
  assert.equal(existsSync(join(box.home, ".claude", "tricorder", "state", "preview")), false);
});

test("pay-per-use accounts are not offered the 5h/7d fields", () => {
  const box = sandbox();
  const described = JSON.parse(run(box, ["fields", DESCRIBE, "payg"]).stdout);
  const ids = described.fields.map((f: { id: string }) => f.id);
  assert.ok(!ids.includes("usage5h") && !ids.includes("usage7d"));
  const asked = JSON.parse(run(box, ["fields", QUESTIONS, "payg"]).stdout);
  assert.deepEqual(asked.calls[0].map((q: { options: unknown[] }) => q.options.length), PAYG.optionCounts);
  const sub = JSON.parse(run(box, ["fields", DESCRIBE, ACCOUNT_SUBSCRIPTION]).stdout);
  assert.ok(sub.fields.some((f: { id: string }) => f.id === "usage5h"));
});

// An account file with no signed-in account means pay per use; with one, a subscription.
function accountDir(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), ACCOUNT_DIR_PREFIX));
  writeFileSync(join(dir, ACCOUNT_FILE), JSON.stringify(contents));
  return dir;
}
const PAYG_ACCOUNT = {};
const SUBSCRIPTION_ACCOUNT = { oauthAccount: { organizationType: PLAN_PRO } };
const EXAMPLE_BUDGET = "/$200";

test("fields preview on a pay-per-use account shows spend with an example budget, and no usage limits", () => {
  const out = run(sandbox(), ["fields", "preview"], { configDir: accountDir(PAYG_ACCOUNT) }).stdout;
  assert.ok(out.includes("💰 $"));
  assert.ok(out.includes(EXAMPLE_BUDGET));
  assert.ok(out.includes("example budget of $200"));
  assert.ok(!out.includes("5h") && !out.includes("7d"));
});

test("fields preview on a subscription shows the usage limits and no spend", () => {
  const out = run(sandbox(), ["fields", "preview"], { configDir: accountDir(SUBSCRIPTION_ACCOUNT) }).stdout;
  assert.ok(out.includes("5h 🐕 37%") && out.includes("7d 🐢 12%"));
  assert.ok(!out.includes("💰"));
});

test("spend is offered to pay-per-use accounts only", () => {
  const box = sandbox();
  const ids = (type: string): string[] => JSON.parse(run(box, ["fields", DESCRIBE, type]).stdout).fields.map((f: { id: string }) => f.id);
  assert.ok(ids("payg").includes("spend"));
  assert.ok(!ids(ACCOUNT_SUBSCRIPTION).includes("spend"));
});
