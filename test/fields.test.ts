import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultFields, FIELD_IDS, FIELDS, fieldsFor, isFieldId } from "../src/fields";
import { mergeConfig, DEFAULT_CONFIG } from "../src/config";
import { parseFieldList } from "../src/fieldscmd";

test("catalogue: ids are unique and every field is on by default", () => {
  assert.equal(new Set(FIELD_IDS).size, FIELDS.length);
  assert.ok(Object.values(defaultFields()).every((v) => v === true));
});

// The order the fields are drawn on line 1 of the statusline, left to right.
const LINE_1_ORDER = ["muteIcon", "location", "dirty", "prs", "context", "model", "usage5h", "usage7d", "spend", "remote", "plan", "account"];

test("catalogue: fields are listed in the order the statusline draws them", () => {
  assert.deepEqual(FIELD_IDS.slice(0, LINE_1_ORDER.length), LINE_1_ORDER);
  assert.deepEqual(FIELD_IDS.slice(LINE_1_ORDER.length), ["worktrees", "subagents", "intro"]);
});

test("catalogue: every field is explained (shows + sample are not empty)", () => {
  FIELDS.forEach((f) => {
    assert.notEqual(f.shows.trim(), "", f.id);
    assert.notEqual(f.sample.trim(), "", f.id);
  });
});

test("fieldsFor: an undetected account is offered every field", () => {
  assert.equal(fieldsFor("unknown").length, FIELDS.length);
});

test("isFieldId accepts catalogue ids only", () => {
  assert.equal(isFieldId("context"), true);
  assert.equal(isFieldId("contxt"), false);
});

test("parseFieldList: 'all' is every field", () => {
  assert.deepEqual(parseFieldList("all").ids, FIELD_IDS);
  assert.deepEqual(parseFieldList(" ALL ").ids, FIELD_IDS);
});

test("parseFieldList: a list keeps order, trims spaces, reports unknown ids", () => {
  const r = parseFieldList("model, context ,bogus");
  assert.deepEqual(r.ids, ["model", "context"]);
  assert.deepEqual(r.unknown, ["bogus"]);
});

test("parseFieldList: empty text gives nothing", () => {
  const r = parseFieldList("");
  assert.deepEqual(r.ids, []);
  assert.deepEqual(r.unknown, []);
});

test("mergeConfig: an old config with no statusline block gets every default", () => {
  const merged = mergeConfig(DEFAULT_CONFIG, { muted: false });
  assert.deepEqual(merged.statusline.fields, defaultFields());
  assert.equal(merged.statusline.mode, "auto");
});

test("mergeConfig: keeps valid switches, ignores unknown ids and non-booleans", () => {
  // `as never`: the whole point is to feed values the types forbid, as a hand-edited config file would.
  const merged = mergeConfig(DEFAULT_CONFIG, {
    statusline: { fields: { context: false, model: "yes", bogus: true }, mode: "payg" },
  } as never);
  assert.equal(merged.statusline.fields.context, false);
  assert.equal(merged.statusline.fields.model, true); // "yes" is not a boolean: default kept
  assert.equal("bogus" in merged.statusline.fields, false);
  assert.equal(merged.statusline.mode, "payg");
});

const CUSTOM_PACE = { marginPts: 5, minElapsedPct: 0 } as const;
const BAD_PACE = { marginPts: -3, minElapsedPct: "x" } as const;

test("mergeConfig: pace settings keep valid numbers; anything else keeps the default", () => {
  const ok = mergeConfig(DEFAULT_CONFIG, { statusline: { pace: CUSTOM_PACE } } as never);
  assert.deepEqual(ok.statusline.pace, CUSTOM_PACE);
  const bad = mergeConfig(DEFAULT_CONFIG, { statusline: { pace: BAD_PACE } } as never);
  assert.deepEqual(bad.statusline.pace, DEFAULT_CONFIG.statusline.pace);
  assert.deepEqual(mergeConfig(DEFAULT_CONFIG, { muted: false }).statusline.pace, DEFAULT_CONFIG.statusline.pace);
});

test("mergeConfig: an invalid mode falls back to auto", () => {
  // `as never`: feeds a value the types forbid, as a hand-edited config file would.
  const merged = mergeConfig(DEFAULT_CONFIG, { statusline: { fields: {}, mode: "gold" } } as never);
  assert.equal(merged.statusline.mode, "auto");
});
