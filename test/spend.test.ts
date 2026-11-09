import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daysInMonth, monthElapsedPct, monthKey, monthSpendUsd, recordCost } from "../src/spend";

const EPSILON = 1e-9;
const at = (iso: string): number => Date.parse(iso);

// Hand check: which month a moment files under, and how many days it has.
const MONTHS = [
  { when: "2026-11-06T00:00:00Z", key: "2026-11", days: 30 },
  { when: "2026-12-31T23:00:00Z", key: "2026-12", days: 31 }, // December ends in a month that rolls into January
  { when: "2028-02-10T00:00:00Z", key: "2028-02", days: 29 }, // leap year
  { when: "2027-02-10T00:00:00Z", key: "2027-02", days: 28 },
  { when: "2026-01-01T00:00:00Z", key: "2026-01", days: 31 },
] as const;

MONTHS.forEach((m) => {
  test(`${m.key}: ${m.days} days`, () => {
    assert.equal(monthKey(at(m.when)), m.key);
    assert.equal(daysInMonth(at(m.when)), m.days);
  });
});

// Share of the month gone. 16 Nov 00:00 is 15 of 30 days. One millisecond before
// the month ends: 100 - 100 / (30 days in ms) = 99.99999996141975.
const ALMOST_FULL_PCT = 99.99999996141975;
const ELAPSED = [
  { label: "the 1st at 00:00 UTC is 0%", when: "2026-11-01T00:00:00Z", pct: 0 },
  { label: "16 Nov 00:00 UTC is 15 of 30 days = 50%", when: "2026-11-16T00:00:00Z", pct: 50 },
  { label: "16 Dec 12:00 UTC is 15.5 of 31 days = 50%", when: "2026-12-16T12:00:00Z", pct: 50 },
  { label: "one millisecond before the month ends is just under 100%", when: "2026-11-30T23:59:59.999Z", pct: ALMOST_FULL_PCT },
] as const;

ELAPSED.forEach((e) => {
  test(`monthElapsedPct: ${e.label}`, () => {
    assert.ok(Math.abs(monthElapsedPct(at(e.when)) - e.pct) < EPSILON);
  });
});

// Each scenario: costs reported by sessions at moments, then the month total checked
// at some moments. Costs are Claude Code's running cost of each session, in dollars.
const NOV_10 = "2026-11-10T00:00:00Z";
const NOV_10_MS = at(NOV_10);
const LEDGER_PREFIX = "tricorder-spend-";
const GOOD_FILE_USD = 2.5;
const SESSION_COST_USD = 1.5;
const SCENARIOS = [
  {
    name: "the same cost shown twice is counted once",
    steps: [{ session: "s1", cost: 1.5, when: NOV_10 }, { session: "s1", cost: 1.5, when: NOV_10 }],
    totals: [{ when: NOV_10, usd: 1.5 }],
  },
  {
    name: "cost grows: $1.00 then $1.50 counts $1.50",
    steps: [{ session: "s1", cost: 1, when: NOV_10 }, { session: "s1", cost: 1.5, when: NOV_10 }],
    totals: [{ when: NOV_10, usd: 1.5 }],
  },
  {
    name: "a resumed session starts again from zero: 1.00 + 0.50 + 0.20 = $1.70",
    steps: [{ session: "s1", cost: 1, when: NOV_10 }, { session: "s1", cost: 1.5, when: NOV_10 }, { session: "s1", cost: 0.2, when: NOV_10 }],
    totals: [{ when: NOV_10, usd: 1.7 }],
  },
  {
    name: "two sessions add up: $4 + $6 = $10",
    steps: [{ session: "a", cost: 4, when: NOV_10 }, { session: "b", cost: 6, when: NOV_10 }],
    totals: [{ when: NOV_10, usd: 10 }],
  },
  {
    name: "a session crossing into a new month: $3 on 31 Oct, $5 on 1 Nov → October $3, November $2",
    steps: [{ session: "s1", cost: 3, when: "2026-10-31T23:00:00Z" }, { session: "s1", cost: 5, when: "2026-11-01T01:00:00Z" }],
    totals: [{ when: "2026-10-31T23:00:00Z", usd: 3 }, { when: "2026-11-01T01:00:00Z", usd: 2 }],
  },
  {
    name: "an empty ledger is $0, and costs that make no sense add nothing",
    steps: [{ session: "s1", cost: -1, when: NOV_10 }, { session: "s1", cost: Number.NaN, when: NOV_10 }],
    totals: [{ when: NOV_10, usd: 0 }],
  },
] as const;

SCENARIOS.forEach((scenario) => {
  test(`ledger: ${scenario.name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), LEDGER_PREFIX));
    scenario.steps.forEach((s) => recordCost(dir, s.session, s.cost, at(s.when)));
    scenario.totals.forEach((t) => assert.ok(Math.abs(monthSpendUsd(dir, at(t.when)) - t.usd) < EPSILON, `${t.when}`));
  });
});

// A damaged ledger file must not silently lower the total: it is reported (and
// counted as $0). A file that simply does not exist yet is normal and silent.
test("ledger: an unreadable file is reported, a missing one is not", () => {
  const dir = mkdtempSync(join(tmpdir(), LEDGER_PREFIX));
  const problems: string[] = [];
  const report = (message: string): void => void problems.push(message);
  assert.equal(monthSpendUsd(dir, NOV_10_MS, report), 0);
  assert.equal(problems.length, 0);
  const monthDir = join(dir, monthKey(NOV_10_MS));
  mkdirSync(monthDir, { recursive: true });
  writeFileSync(join(monthDir, "broken.json"), "{ not json");
  writeFileSync(join(monthDir, "good.json"), JSON.stringify({ usd: GOOD_FILE_USD }));
  assert.equal(monthSpendUsd(dir, NOV_10_MS, report), GOOD_FILE_USD);
  assert.equal(problems.length, 1);
  assert.ok(problems[0]?.includes("broken.json"));
});

test("ledger: writing leaves no temporary files behind", () => {
  const dir = mkdtempSync(join(tmpdir(), LEDGER_PREFIX));
  recordCost(dir, "s1", SESSION_COST_USD, NOV_10_MS);
  const names = [join(monthKey(NOV_10_MS)), "last"].flatMap((d) => readdirSync(join(dir, d)));
  assert.deepEqual(names, ["s1.json", "s1.json"]);
});
