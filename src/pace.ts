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

export interface PaceConfig {
  // Width of the "On track" band, in percentage points either side of even pace.
  // Default 10: a starting value that can be changed in the config.
  readonly marginPts: number;
  // Below this share of the window gone, the pace is too noisy to mean anything:
  // the sloth shows instead of a pace animal.
  readonly minElapsedPct: number;
}

export const DEFAULT_PACE = { marginPts: 10, minElapsedPct: 3 } as const satisfies PaceConfig;

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

// The band for a limit with a fixed allowance (5h, 7d). `elapsed` is the share
// of the window gone, or null when unknown.
// - Used up (100% or more): Over, whatever the time. You cannot use more.
// - Window unknown or already past its end: no pace (null).
// - Less than `minElapsedPct` of the window gone: Just started (the sloth).
// - Otherwise the pace decides.
export function limitBand(usedPct: number, elapsed: number | null, cfg: PaceConfig): PaceBand | null {
  if (usedPct >= PCT_MAX) return "over";
  if (elapsed === null || elapsed > PCT_MAX) return null;
  if (elapsed < cfg.minElapsedPct) return "early";
  return bandForDeviation(usedPct - elapsed, cfg.marginPts);
}
