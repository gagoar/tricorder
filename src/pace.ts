// Pace: is a limit being used faster or slower than an even spread over its
// window? A window is the period a limit covers (5 hours, 7 days). The pace is
// the percentage of the limit used minus the percentage of the window that has
// passed, in percentage points. 0 means exactly on an even pace.
//
// Pure functions only, so the numbers can be checked by hand (see
// test/pace.test.ts). This file must not import from config.ts.

export interface PaceStyle {
  readonly name: string;
  // Terminal colour code (the part between "ESC[" and "m").
  readonly color: number | string;
  readonly icon: string;
}

// Four bands for the pace itself (Chill, On track, Watch out, Hot). "Over" is for a
// limit that is used up (or, for spend, a budget that is exceeded), and "Just
// started" (the sloth) is for the first moments of a window, when a pace would
// mean nothing.
export const PACE_STYLES = {
  early: { name: "Just started", color: 90, icon: "🦥" }, // grey: too early in the window to tell
  chill: { name: "Chill", color: 32, icon: "🐢" }, // green
  onTrack: { name: "On track", color: 94, icon: "🐕" }, // blue
  watchOut: { name: "Watch out", color: "38;5;214", icon: "🐎" }, // orange
  hot: { name: "Hot", color: 91, icon: "🦅" }, // red; the eagle is the closest emoji to a hawk
  over: { name: "Over", color: 95, icon: "🐉" }, // magenta
} as const satisfies Readonly<Record<string, PaceStyle>>;

// Derived from the table above, so a new band is added in one place.
export type PaceBand = keyof typeof PACE_STYLES;

// When "(reset in 42m)" follows a limit's percent:
// - "off": never.
// - "hot" (default): when the pace is Hot, or the limit is used up (Over).
// - "watchOut": from Watch out upward.
// - "always": whenever the reset time is known.
// A setting value that is also a band name: `satisfies` makes the compiler check they stay in step.
const WATCH_OUT = "watchOut" satisfies PaceBand;
export const RESET_NOTE_FROM = ["off", WATCH_OUT, "hot", "always"] as const;
export type ResetNoteFrom = (typeof RESET_NOTE_FROM)[number];

export function isResetNoteFrom(value: unknown): value is ResetNoteFrom {
  return (RESET_NOTE_FROM as readonly unknown[]).includes(value);
}

export interface PaceConfig {
  // Width of the "On track" band, in percentage points either side of even pace.
  // Default 10: a starting value that can be changed in the config.
  readonly marginPts: number;
  // Below this share of the window gone, the pace is too noisy to mean anything:
  // the sloth shows instead of a pace animal.
  readonly minElapsedPct: number;
  // From which band the time until the limit resets is shown.
  readonly resetNoteFrom: ResetNoteFrom;
}

export const DEFAULT_PACE = { marginPts: 10, minElapsedPct: 3, resetNoteFrom: "hot" } as const satisfies PaceConfig;

// Window lengths of the limits Claude Code reports in `rate_limits`.
export const FIVE_HOUR_WINDOW_S = 18_000; // 5 hours
export const SEVEN_DAY_WINDOW_S = 604_800; // 7 days

export const PCT_MAX = 100;
export const MS_PER_S = 1000;
// The band boundaries are multiples of the margin: Watch out reaches 2 margins.
const WATCH_OUT_MARGINS = 2;

// Share of the window that has passed, in percent. `resetsAtS` is when the
// window ends (epoch seconds), `windowS` its length in seconds.
// Hand check: window 18000 s, ends in 9000 s → half gone → 50.
export function elapsedPct(resetsAtS: number, nowS: number, windowS: number): number {
  return (1 - (resetsAtS - nowS) / windowS) * PCT_MAX;
}

// Inverse of elapsedPct: when a window that is `elapsedPctGone` percent gone ends,
// in epoch seconds. Hand check: 50% of an 18000 s window gone at second 1000 → ends at 1000 + 9000 = 10000.
export function resetsAtS(elapsedPctGone: number, nowS: number, windowS: number): number {
  return nowS + (1 - elapsedPctGone / PCT_MAX) * windowS;
}

// Chill below -margin, On track within ±margin, Watch out up to 2 margins
// above, Hot beyond that. The edges belong to the calmer band.
export function bandForDeviation(deviationPts: number, marginPts: number): Exclude<PaceBand, "over" | "early"> {
  if (deviationPts < -marginPts) return "chill";
  if (deviationPts <= marginPts) return "onTrack";
  if (deviationPts <= WATCH_OUT_MARGINS * marginPts) return "watchOut";
  return "hot";
}

// The pace part shared by limits and budgets: no pace when the window is
// unknown or already over, the sloth when it has only just started, otherwise
// the deviation decides.
function paceBand(usedPct: number, elapsed: number | null, cfg: PaceConfig): PaceBand | null {
  if (elapsed === null || elapsed > PCT_MAX) return null;
  if (elapsed < cfg.minElapsedPct) return "early";
  return bandForDeviation(usedPct - elapsed, cfg.marginPts);
}

// The band for a monthly budget. Unlike a limit, a budget can be exceeded: Over
// means more than 100% of it is spent. Spending exactly the budget is not Over.
// Hand check: budget 200, spent 250 → 125% → Over; spent 200 → 100% → not Over.
export function budgetBand(usedPct: number, elapsed: number | null, cfg: PaceConfig): PaceBand | null {
  return usedPct > PCT_MAX ? "over" : paceBand(usedPct, elapsed, cfg);
}

// The band for a limit with a fixed allowance (5h, 7d). `elapsed` is the share
// of the window gone, or null when unknown.
// - Used up (100% or more): Over, whatever the time. You cannot use more.
// - Window unknown or already past its end: no pace (null).
// - Less than `minElapsedPct` of the window gone: Just started (the sloth).
// - Otherwise the pace decides.
export function limitBand(usedPct: number, elapsed: number | null, cfg: PaceConfig): PaceBand | null {
  return usedPct >= PCT_MAX ? "over" : paceBand(usedPct, elapsed, cfg);
}

const bands = (...list: PaceBand[]): readonly PaceBand[] => list;

// The bands that show the reset note, per setting ("always" is handled apart: it
// also covers the case of no pace at all). A missing setting is a compile error.
const NOTE_BANDS = {
  off: bands(),
  watchOut: bands(WATCH_OUT, "hot", "over"),
  hot: bands("hot", "over"),
} as const satisfies Record<Exclude<ResetNoteFrom, "always">, readonly PaceBand[]>;

// Should the reset note show for this band? `band` is null when there is no pace.
export function showsResetNote(band: PaceBand | null, from: ResetNoteFrom): boolean {
  if (from === "always") return true;
  return band !== null && NOTE_BANDS[from].includes(band);
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

// "3h 32m" or "3h": a larger unit and the smaller one after it, without a zero part.
const twoUnits = (big: number, bigUnit: string, small: number, smallUnit: string): string =>
  small ? `${big}${bigUnit} ${small}${smallUnit}` : `${big}${bigUnit}`;

// Time left, short: under an hour "42m", under a day "3h 32m", longer "5d 4h".
// Rounded up to the next minute, so it never shows "0m". Hand check:
// 2520 s → 42m · 3540 s → 59m · 3600 s → 1h · 12720 s → 3h 32m · 86400 s → 1d · 446400 s → 5d 4h.
export function formatRemaining(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / SECONDS_PER_MINUTE));
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  if (minutes < MINUTES_PER_DAY) return twoUnits(Math.floor(minutes / MINUTES_PER_HOUR), "h", minutes % MINUTES_PER_HOUR, "m");
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return twoUnits(Math.floor(minutes / MINUTES_PER_DAY), "d", hours, "h");
}
