import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_IDS } from "../src/fields";
import { plain, run, sandbox, writeConfig } from "./helpers";

const EMAIL = "you@example.com"; // 16 characters
const SESSION = "s1";
const WIDTH = 60;
// Hand count, in terminal columns. The plan link is "🗺️" (2 columns) + " plan" (5) = 7.
// With the email: the right side is plan + 2 spaces + email = 7 + 2 + 16 = 25.
const COLUMNS_FREE_FOR_EMAIL = 6;
const COLUMNS_FREE_FOR_PLAN_ONLY = 1;
const PLAN_LINK_COLUMNS = 7;
const SEPARATOR_COLUMNS = 2;
const EMAIL_COLUMNS = EMAIL.length;

const only = (...ids: string[]): Record<string, boolean> => Object.fromEntries(FIELD_IDS.map((id) => [id, ids.includes(id)]));

function boxWith(fields: Record<string, boolean>, signedIn: boolean) {
  const box = sandbox();
  writeConfig(box, { statusline: { fields } });
  writeFileSync(join(box.home, ".claude.json"), JSON.stringify(signedIn ? { oauthAccount: { emailAddress: EMAIL } } : {}));
  const planDir = join(box.home, ".claude", "tricorder", "state", SESSION);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, "plan.txt"), "/example/plan.md\n");
  return box;
}

// The line as drawn, without the final newline, and how many spaces come before the text.
function drawn(box: ReturnType<typeof sandbox>) {
  const out = run(box, ["statusline"], { stdin: JSON.stringify({ session_id: SESSION, cwd: "/" }), columns: WIDTH }).stdout;
  const line = plain(out).replace("\n", "");
  return { line, leading: line.length - line.trimStart().length, text: line.trim() };
}

test("the email alone is pushed right, leaving 6 columns free: 60 - 16 - 6 = 38 spaces", () => {
  const d = drawn(boxWith(only("account"), true));
  assert.equal(d.text, EMAIL);
  assert.equal(d.leading, WIDTH - EMAIL_COLUMNS - COLUMNS_FREE_FOR_EMAIL);
});

test("plan link and email together: plan, two spaces, email; 60 - 25 - 6 = 29 spaces", () => {
  const d = drawn(boxWith(only("plan", "account"), true));
  assert.equal(d.text, `🗺️ plan  ${EMAIL}`);
  assert.equal(d.leading, WIDTH - (PLAN_LINK_COLUMNS + SEPARATOR_COLUMNS + EMAIL_COLUMNS) - COLUMNS_FREE_FOR_EMAIL);
});

test("without the email the plan link keeps its old position, 1 column free: 60 - 7 - 1 = 52 spaces", () => {
  const d = drawn(boxWith(only("plan"), true));
  assert.equal(d.text, "🗺️ plan");
  assert.equal(d.leading, WIDTH - PLAN_LINK_COLUMNS - COLUMNS_FREE_FOR_PLAN_ONLY);
});

test("with the account field off, no email is shown even when signed in", () => {
  assert.equal(drawn(boxWith(only("plan"), true)).text.includes(EMAIL), false);
});

test("no account entry (pay per use): no email, nothing is shown", () => {
  assert.equal(drawn(boxWith(only("account"), false)).text, "");
});
