import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_IDS } from "../src/fields";
import { FIVE_HOUR_WINDOW_S, MS_PER_S, resetsAtS, SEVEN_DAY_WINDOW_S } from "../src/pace";
import { plain, run, sandbox, writeConfig } from "./helpers";

// Only the usage fields are on, so the output is just "5h … · 7d …".
const ONLY_USAGE = Object.fromEntries(FIELD_IDS.map((id) => [id, id === "usage5h" || id === "usage7d"]));
const HALF = 50; // half of the window gone
const USED = { onTrack: 55, watchOut: 65, hot: 75, chill: 30, over: 100, early: 5, noReset: 40 } as const;
const EARLY_GONE = 0.55; // percent of the window gone: under the 3% minimum
const COLOUR_BLUE = "\x1b[94m";
const COLOUR_ORANGE = "\x1b[38;5;214m";
const COLOUR_RED = "\x1b[91m";
const COLOUR_GREEN = "\x1b[32m";
const COLOUR_MAGENTA = "\x1b[95m";
const COLOUR_GREY = "\x1b[90m";

// A limit whose window is `elapsed`% gone, with `used`% of the limit used.
function limit(used: number, elapsed: number, windowS: number) {
  return { used_percentage: used, resets_at: resetsAtS(elapsed, Date.now() / MS_PER_S, windowS) };
}

function statusline(payload: unknown, fields: Record<string, boolean> = ONLY_USAGE) {
  const box = sandbox();
  writeConfig(box, { statusline: { fields } });
  const raw = run(box, ["statusline"], { stdin: JSON.stringify(payload) }).stdout;
  return { raw, text: plain(raw).trim() };
}

// Hand check at half the window: 55% used = +5 (On track), 65% = +15 (Watch out), 75% = +25 (Hot), 30% = -20 (Chill).
const AT_HALF = [
  { used: USED.onTrack, text: "5h 🐕 55%", colour: COLOUR_BLUE },
  { used: USED.watchOut, text: "5h 🐎 65%", colour: COLOUR_ORANGE },
  { used: USED.hot, text: "5h 🦅 75%", colour: COLOUR_RED },
  { used: USED.chill, text: "5h 🐢 30%", colour: COLOUR_GREEN },
] as const;

AT_HALF.forEach((row) => {
  test(`5h limit, half the window gone, ${row.used}% used → "${row.text}" in its colour`, () => {
    const out = statusline({ rate_limits: { five_hour: limit(row.used, HALF, FIVE_HOUR_WINDOW_S) } });
    assert.equal(out.text, row.text);
    assert.ok(out.raw.includes(`${row.colour}${row.used}%`));
  });
});

test("7d limit uses a 7-day window: half gone and 55% used is On track", () => {
  assert.equal(statusline({ rate_limits: { seven_day: limit(USED.onTrack, HALF, SEVEN_DAY_WINDOW_S) } }).text, "7d 🐕 55%");
});

test("both limits show on one line, 5h first", () => {
  const out = statusline({ rate_limits: { five_hour: limit(USED.onTrack, HALF, FIVE_HOUR_WINDOW_S), seven_day: limit(USED.chill, HALF, SEVEN_DAY_WINDOW_S) } });
  assert.equal(out.text, "5h 🐕 55% · 7d 🐢 30%");
});

test("a limit that is used up shows the dragon in magenta", () => {
  const out = statusline({ rate_limits: { five_hour: limit(USED.over, HALF, FIVE_HOUR_WINDOW_S) } });
  assert.equal(out.text, "5h 🐉 100%");
  assert.ok(out.raw.includes(`${COLOUR_MAGENTA}100%`));
});

test("early in a window (0.55% gone, under 3%) a grey sloth shows", () => {
  const out = statusline({ rate_limits: { five_hour: limit(USED.early, EARLY_GONE, FIVE_HOUR_WINDOW_S) } });
  assert.equal(out.text, "5h 🦥 5%");
  assert.ok(out.raw.includes(`${COLOUR_GREY}5%`));
});

test("a limit used up early in its window is the dragon, not the sloth", () => {
  const out = statusline({ rate_limits: { five_hour: limit(USED.over, EARLY_GONE, FIVE_HOUR_WINDOW_S) } });
  assert.equal(out.text, "5h 🐉 100%");
});

test("without a reset time the percent shows with no animal (the pace is unknown)", () => {
  assert.equal(statusline({ rate_limits: { five_hour: { used_percentage: USED.noReset } } }).text, "5h 40%");
});

test("no rate_limits in the payload (pay-per-use accounts): nothing is shown", () => {
  assert.equal(statusline({}).text, "");
});

test("switching 5h off leaves only 7d", () => {
  const fields = { ...ONLY_USAGE, usage5h: false };
  const out = statusline({ rate_limits: { five_hour: limit(USED.onTrack, HALF, FIVE_HOUR_WINDOW_S), seven_day: limit(USED.onTrack, HALF, SEVEN_DAY_WINDOW_S) } }, fields);
  assert.equal(out.text, "7d 🐕 55%");
});
