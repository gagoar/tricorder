import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, emailOf, resolveType } from "../src/account";

const SUBSCRIPTION = "subscription";
const NOT_OBJECTS: readonly unknown[] = [null, undefined, true, "text"];

test("classify: signed in with a Pro account, extra usage off", () => {
  const d = classify({ oauthAccount: { organizationType: "claude_pro", hasExtraUsageEnabled: false } });
  assert.deepEqual(d, { type: SUBSCRIPTION, plan: "claude_pro", extraUsage: false });
});

test("classify: subscription with extra usage on", () => {
  const d = classify({ oauthAccount: { organizationType: "claude_max", hasExtraUsageEnabled: true } });
  assert.deepEqual(d, { type: SUBSCRIPTION, plan: "claude_max", extraUsage: true });
});

test("classify: a readable file with no oauthAccount is pay per use", () => {
  assert.deepEqual(classify({ somethingElse: "x" }), { type: "payg", plan: null, extraUsage: false });
});

test("classify: anything that is not an object is unknown, not a guess", () => {
  NOT_OBJECTS.forEach((bad) => assert.equal(classify(bad).type, "unknown"));
});

test("resolveType: auto uses the detection, a forced mode wins", () => {
  assert.equal(resolveType("auto", SUBSCRIPTION), SUBSCRIPTION);
  assert.equal(resolveType("payg", SUBSCRIPTION), "payg");
  assert.equal(resolveType("auto", "unknown"), "unknown");
});

const EMAIL = "you@example.com";
// What emailOf reads from a parsed .claude.json (null = no usable email).
const EMAIL_CASES = [
  { label: "a signed-in account", parsed: { oauthAccount: { emailAddress: EMAIL } }, email: EMAIL },
  { label: "an empty address", parsed: { oauthAccount: { emailAddress: "" } }, email: null },
  { label: "an address that is not text", parsed: { oauthAccount: { emailAddress: 42 } }, email: null },
  { label: "no account entry (pay per use)", parsed: { other: true }, email: null },
  { label: "an account entry without an address", parsed: { oauthAccount: {} }, email: null },
  { label: "a file that is not an object", parsed: "text", email: null },
  { label: "nothing at all", parsed: null, email: null },
] as const;

EMAIL_CASES.forEach((c) => {
  test(`emailOf: ${c.label} → ${c.email}`, () => {
    assert.equal(emailOf(c.parsed), c.email);
  });
});
