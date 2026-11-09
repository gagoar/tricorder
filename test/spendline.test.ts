import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_IDS } from "../src/fields";
import { plain, run, sandbox, writeConfig } from "./helpers";

// Only the spend field is on, so the output is just the spend segment.
const ONLY_SPEND = Object.fromEntries(FIELD_IDS.map((id) => [id, id === "spend"]));
const COLOUR_MAGENTA = "\x1b[95m";
const BUDGET_USD = 200;
const STATUSLINE = "statusline";
const SMALL_SPEND_TEXT = "💰 $12.40";
const COSTS = { small: 12.4, whole: 62, second: 7.5, over: 250 } as const;

function show(box: ReturnType<typeof sandbox>, session: string, costUsd: number, extra: Record<string, unknown> = {}) {
  const payload = { session_id: session, cwd: "/", cost: { total_cost_usd: costUsd }, ...extra };
  const raw = run(box, [STATUSLINE], { stdin: JSON.stringify(payload) }).stdout;
  return { raw, text: plain(raw).trim() };
}

function payg(budgetUsd: number | null, mode = "payg") {
  const box = sandbox();
  writeConfig(box, { statusline: { mode, fields: ONLY_SPEND, budget: { monthlyUsd: budgetUsd } } });
  return box;
}

test("pay per use with no budget: this month's spend with cents", () => {
  assert.equal(show(payg(null), "s1", COSTS.small).text, SMALL_SPEND_TEXT);
});

test("whole dollars show without cents", () => {
  assert.equal(show(payg(null), "s1", COSTS.whole).text, "💰 $62");
});

test("the same session shown twice is counted once; a second session adds: 12.40 + 7.50 = $19.90", () => {
  const box = payg(null);
  show(box, "s1", COSTS.small);
  assert.equal(show(box, "s1", COSTS.small).text, SMALL_SPEND_TEXT);
  assert.equal(show(box, "s2", COSTS.second).text, "💰 $19.90");
});

test("over budget: $250 of $200 is 125%, the dragon in magenta", () => {
  const out = show(payg(BUDGET_USD), "s1", COSTS.over);
  assert.equal(out.text, "💰 $250/$200 🐉 125%");
  assert.ok(out.raw.includes(`${COLOUR_MAGENTA}125%`));
});

test("with a budget the share spent is shown ($62 of $200 = 31%) with some animal", () => {
  const text = show(payg(BUDGET_USD), "s1", COSTS.whole).text;
  assert.ok(text.startsWith("💰 $62/$200 "));
  assert.ok(text.endsWith(" 31%"));
});

test("subscription accounts never show spend, even though Claude Code sends a cost", () => {
  assert.equal(show(payg(BUDGET_USD, "subscription"), "s1", COSTS.whole).text, "");
});

test("account type unknown: spend shows only when the payload has no usage limits", () => {
  const box = payg(null, "auto"); // no account file in the sandbox → unknown
  assert.equal(show(box, "s1", COSTS.small).text, SMALL_SPEND_TEXT);
  const limits = { rate_limits: { five_hour: { used_percentage: 1 } } };
  assert.equal(show(box, "s2", COSTS.small, limits).text, "");
});

test("no cost in the payload, or no session: nothing is shown", () => {
  const box = payg(null);
  const noCost = run(box, [STATUSLINE], { stdin: JSON.stringify({ session_id: "s1", cwd: "/" }) }).stdout;
  assert.equal(plain(noCost).trim(), "");
  const noSession = run(box, [STATUSLINE], { stdin: JSON.stringify({ cwd: "/", cost: { total_cost_usd: COSTS.small } }) }).stdout;
  assert.equal(plain(noSession).trim(), "");
});

test("switching the field off hides it and stops counting", () => {
  const box = sandbox();
  writeConfig(box, { statusline: { mode: "payg", fields: { ...ONLY_SPEND, spend: false } } });
  assert.equal(show(box, "s1", COSTS.small).text, "");
});
