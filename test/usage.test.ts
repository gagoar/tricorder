import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_IDS } from "../src/fields";
import { FIVE_HOUR_WINDOW_S, MS_PER_S, resetsAtS, SEVEN_DAY_WINDOW_S } from "../src/pace";
import { plain, run, sandbox, writeConfig } from "./helpers";

// Only the usage fields are on, so the output is just "5h … · 7d …".
const FIVE_HOUR = "five_hour"; // names of the limits in the payload
const SEVEN_DAY = "seven_day";
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

// The earlier tests are about the animals, so they run with the reset note off.
// `resetNoteFrom` null means "not in the config at all", which is the real default.
function statusline(payload: unknown, fields: Record<string, boolean> = ONLY_USAGE, resetNoteFrom: string | null = "off") {
  const box = sandbox();
  writeConfig(box, { statusline: { fields, ...(resetNoteFrom === null ? {} : { pace: { resetNoteFrom } }) } });
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

// ---- the reset note: "(reset in 42m)" after the percent, in the same colour

const NOTE_USED = { hot: 70, hot7d: 60, over: 100, watchOut: 65, onTrack: 55 } as const;
const GONE = { hot5h: 40, hot7d: 20, over: 86, half: 50 } as const;

// Hand check. 5h = 18000 s. 40% gone leaves 10800 s = 180 min = 3h. 86% gone leaves 2520 s = 42 min.
// 50% gone leaves 9000 s = 150 min = 2h 30m. 7d = 604800 s. 20% gone leaves 483840 s = 8064 min = 5d 14h.
const NOTES = [
  { label: "Hot 5h", setting: null, used: NOTE_USED.hot, gone: GONE.hot5h, win: FIVE_HOUR, text: "5h 🦅 70% (reset in 3h)", colour: COLOUR_RED },
  { label: "Hot 7d", setting: null, used: NOTE_USED.hot7d, gone: GONE.hot7d, win: SEVEN_DAY, text: "7d 🦅 60% (reset in 5d 14h)", colour: COLOUR_RED },
  { label: "used-up 5h", setting: null, used: NOTE_USED.over, gone: GONE.over, win: FIVE_HOUR, text: "5h 🐉 100% (reset in 42m)", colour: COLOUR_MAGENTA },
  { label: "Watch out with the default (hot)", setting: null, used: NOTE_USED.watchOut, gone: GONE.half, win: FIVE_HOUR, text: "5h 🐎 65%", colour: COLOUR_ORANGE },
  { label: "Watch out with watchOut", setting: "watchOut", used: NOTE_USED.watchOut, gone: GONE.half, win: FIVE_HOUR, text: "5h 🐎 65% (reset in 2h 30m)", colour: COLOUR_ORANGE },
  { label: "On track with watchOut", setting: "watchOut", used: NOTE_USED.onTrack, gone: GONE.half, win: FIVE_HOUR, text: "5h 🐕 55%", colour: COLOUR_BLUE },
  { label: "On track with always", setting: "always", used: NOTE_USED.onTrack, gone: GONE.half, win: FIVE_HOUR, text: "5h 🐕 55% (reset in 2h 30m)", colour: COLOUR_BLUE },
  { label: "Hot with off", setting: "off", used: NOTE_USED.hot, gone: GONE.hot5h, win: FIVE_HOUR, text: "5h 🦅 70%", colour: COLOUR_RED },
] as const;

NOTES.forEach((n) => {
  test(`reset note: ${n.label} → "${n.text}"`, () => {
    const windowS = n.win === FIVE_HOUR ? FIVE_HOUR_WINDOW_S : SEVEN_DAY_WINDOW_S;
    const out = statusline({ rate_limits: { [n.win]: limit(n.used, n.gone, windowS) } }, ONLY_USAGE, n.setting);
    assert.equal(out.text, n.text);
    const note = n.text.slice(n.text.indexOf("(")).trim();
    if (n.text.includes("(")) assert.ok(out.raw.includes(`${n.colour}${note}`), "the note has the colour of the band");
  });
});

test("reset note: no reset time, no note, even with 'always'", () => {
  const out = statusline({ rate_limits: { five_hour: { used_percentage: USED.hot } } }, ONLY_USAGE, "always");
  assert.equal(out.text, "5h 75%");
});

test("reset note: both limits can carry one on the same line", () => {
  const limits = { five_hour: limit(NOTE_USED.hot, GONE.hot5h, FIVE_HOUR_WINDOW_S), seven_day: limit(NOTE_USED.hot7d, GONE.hot7d, SEVEN_DAY_WINDOW_S) };
  assert.equal(statusline({ rate_limits: limits }, ONLY_USAGE, null).text, "5h 🦅 70% (reset in 3h) · 7d 🦅 60% (reset in 5d 14h)");
});
