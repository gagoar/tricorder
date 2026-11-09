import { test } from "node:test";
import assert from "node:assert/strict";
import { bandForDeviation, DEFAULT_PACE, elapsedPct, FIVE_HOUR_WINDOW_S, limitBand, PACE_STYLES, resetsAtS, SEVEN_DAY_WINDOW_S, type PaceBand } from "../src/pace";

// Each band spelled out once for the tests; `satisfies` makes it a compile error if the bands in src/pace.ts change.
const BAND = { early: "early", chill: "chill", onTrack: "onTrack", watchOut: "watchOut", hot: "hot", over: "over" } as const satisfies { readonly [K in PaceBand]: K };
const NOW_S = 1000;
const EPSILON = 1e-9;
const HALF_WINDOW = 50; // percent of the window gone
const SIX_SEVENTHS_PCT = 85.71428571428571; // 100 × 6/7
const EXPECTED_WINDOWS_S = { five: 18_000, seven: 604_800 } as const; // 5 × 3600 s, 7 × 86400 s

// Hand check: seconds left ÷ window length = share left; 100 - that share = share gone.
const ELAPSED = [
  { label: "5-hour window (18000 s) ending in 9000 s is half gone", endsInS: 9000, windowS: FIVE_HOUR_WINDOW_S, gone: 50 },
  { label: "7-day window (604800 s) ending in 1 day (86400 s) is 6/7 gone", endsInS: 86_400, windowS: SEVEN_DAY_WINDOW_S, gone: SIX_SEVENTHS_PCT },
] as const;

ELAPSED.forEach((row) => {
  test(`elapsedPct: ${row.label}`, () => {
    assert.ok(Math.abs(elapsedPct(NOW_S + row.endsInS, NOW_S, row.windowS) - row.gone) < EPSILON);
  });
});

test("resetsAtS is the inverse of elapsedPct: half of an 18000 s window gone at second 1000 ends at 10000", () => {
  const END_S = 10_000; // 1000 + 9000 s left
  assert.equal(resetsAtS(HALF_WINDOW, NOW_S, FIVE_HOUR_WINDOW_S), END_S);
  assert.ok(Math.abs(elapsedPct(END_S, NOW_S, FIVE_HOUR_WINDOW_S) - HALF_WINDOW) < EPSILON);
});

test("windows: 5 hours = 18000 s, 7 days = 604800 s", () => {
  assert.deepEqual({ five: FIVE_HOUR_WINDOW_S, seven: SEVEN_DAY_WINDOW_S }, EXPECTED_WINDOWS_S);
});

// Half the window is gone. Used → deviation (used - 50) → band, checked by hand.
const AT_HALF_WINDOW = [
  { used: 30, deviation: -20, band: BAND.chill },
  { used: 39.9, deviation: -10.1, band: BAND.chill },
  { used: 40, deviation: -10, band: BAND.onTrack }, // the edge belongs to the calmer band
  { used: 55, deviation: 5, band: BAND.onTrack },
  { used: 60, deviation: 10, band: BAND.onTrack },
  { used: 60.1, deviation: 10.1, band: BAND.watchOut },
  { used: 65, deviation: 15, band: BAND.watchOut },
  { used: 70, deviation: 20, band: BAND.watchOut },
  { used: 70.1, deviation: 20.1, band: BAND.hot },
  { used: 75, deviation: 25, band: BAND.hot },
] as const;

AT_HALF_WINDOW.forEach((row) => {
  test(`half the window gone, ${row.used}% used → ${row.deviation} points → ${row.band}`, () => {
    assert.equal(limitBand(row.used, HALF_WINDOW, DEFAULT_PACE), row.band);
  });
});

const MARGINS = [
  { deviation: 6, margin: 5, band: BAND.watchOut },
  { deviation: 6, margin: 10, band: BAND.onTrack },
] as const;

MARGINS.forEach((row) => {
  test(`bandForDeviation: ${row.deviation} points with margin ${row.margin} → ${row.band}`, () => {
    assert.equal(bandForDeviation(row.deviation, row.margin), row.band);
  });
});

// Over: a limit that is used up, whatever the time. 99% at 10% gone is +89: Hot.
const OVER_CASES = [
  { used: 100, gone: 10, band: BAND.over },
  { used: 99, gone: 10, band: BAND.hot },
  { used: 100, gone: 1, band: BAND.over }, // wins over the "too early" rule
  { used: 100, gone: null, band: BAND.over },
] as const;

OVER_CASES.forEach((row) => {
  test(`${row.used}% used with ${row.gone}% of the window gone → ${row.band}`, () => {
    assert.equal(limitBand(row.used, row.gone, DEFAULT_PACE), row.band);
  });
});

// Under 3% gone: the sloth. Unknown or already past the end: no pace. Exactly 3% is enough (50 - 3 = +47: Hot).
const NO_PACE = [
  { used: 50, gone: 2.9, band: BAND.early },
  { used: 50, gone: 0, band: BAND.early },
  { used: 50, gone: 3, band: BAND.hot },
  { used: 50, gone: null, band: null },
  { used: 50, gone: 100.5, band: null },
] as const;

NO_PACE.forEach((row) => {
  test(`${row.used}% used with ${row.gone}% of the window gone → ${row.band ?? "no pace"}`, () => {
    assert.equal(limitBand(row.used, row.gone, DEFAULT_PACE), row.band);
  });
});

test("every band has an animal, a colour and a name; the six animals differ", () => {
  const styles = Object.values(PACE_STYLES);
  assert.equal(new Set(styles.map((s) => s.icon)).size, styles.length);
  assert.ok(styles.every((s) => !!s.name));
});
