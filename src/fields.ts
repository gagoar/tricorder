// The catalogue of statusline fields: the single list the statusline, the
// `tricorder fields` command and the /tricorder:setup command all read, so what
// setup tells a user can never drift from what the statusline draws.
//
// This file must not import from config.ts (config.ts imports it for the
// defaults).

import { DEFAULT_PACE } from "./pace";

// "subscription" = signed in with a Claude account (Pro, Max, Team...).
// "payg"         = pay per use: an API key or a cloud-provider login.
// "unknown"      = the account could not be detected; every field is offered.
export const SUBSCRIPTION = "subscription";
export const PAYG = "payg";
export const UNKNOWN = "unknown";
export const AUTO = "auto";

// Each fixed set is written once; the types and the other sets are derived from it.
export const ACCOUNT_TYPES = [SUBSCRIPTION, PAYG] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const DETECTED_TYPES = [...ACCOUNT_TYPES, UNKNOWN] as const;
export type DetectedType = (typeof DETECTED_TYPES)[number];

export const ACCOUNT_MODES = [AUTO, ...ACCOUNT_TYPES] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

export function isAccountMode(value: unknown): value is AccountMode {
  return (ACCOUNT_MODES as readonly unknown[]).includes(value);
}

export function isDetectedType(value: unknown): value is DetectedType {
  return (DETECTED_TYPES as readonly unknown[]).includes(value);
}

export interface FieldInfo {
  readonly id: string;
  readonly name: string;
  readonly shows: string;
  // Example output, as plain text.
  readonly sample: string;
  // What its icons and colours mean. Empty when it has neither.
  readonly legend: string;
  readonly appliesTo: readonly AccountType[];
  readonly defaultOn: boolean;
}

const EVERY_ACCOUNT: readonly AccountType[] = ACCOUNT_TYPES;
const SUBSCRIPTION_ONLY: readonly AccountType[] = [SUBSCRIPTION];
const PAYG_ONLY: readonly AccountType[] = [PAYG];

// The "too early to tell" share is read from the default, so this text cannot disagree with it.
const EARLY_PCT = DEFAULT_PACE.minElapsedPct;

// Shared by the usage fields: what the animal and the colour of the percentage mean.
const PACE_LEGEND =
  `The animal and the colour compare your use with the time gone in the window: 🐢 green = well under an even pace, 🐕 blue = on pace, 🐎 orange = a little fast, 🦅 red = too fast, 🐉 magenta = limit reached. In the first ${EARLY_PCT}% of a window it is too early to tell, so a 🦥 sloth (grey) shows instead. (Margin and ${EARLY_PCT}% are settings: statusline.pace.)`;

// What the spend field shows and means, for accounts that pay per use.
const SPEND_LEGEND =
  `💰 = spend this month, in US dollars (calendar month, UTC). With a budget the animal and the colour compare the share of the budget spent with the share of the month gone: 🐢 green = well under an even pace, 🐕 blue = on pace, 🐎 orange = a little fast, 🦅 red = too fast, 🐉 magenta = over budget (more than 100% spent), 🦥 grey = the first ${EARLY_PCT}% of the month, too early to tell. The budget is not a limit. The figure is an estimate kept by tricorder: it misses sessions without a statusline, other machines and other tools using the same key.`;

// Order here is the order the fields appear on the statusline, left to right,
// then top to bottom (line 1: mute icon, location with its uncommitted-changes
// mark and PR tags, context,
// model, 5-hour and 7-day usage or monthly spend, plan link at the right edge; then the other-worktrees line, then the
// sub-agents line). The start-up animation comes last: it only shows for the
// first seconds. Setup lists the fields in this same order.
export const FIELDS = [
  {
    id: "muteIcon",
    name: "Mute icon",
    shows: "A speaker icon at the start of the line while sounds are muted.",
    sample: "🔇",
    legend: "🔇 = sounds are muted.",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "location",
    name: "Location",
    shows: "The folder and branch you are working in, as a clickable link. In a worktree session it shows the branch with a tree icon.",
    sample: "my-repo(main)   or   🌳 fix-login",
    legend: "Clicking opens the folder, copies the path, or both (see worktreeClick in the config).",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "dirty",
    name: "Uncommitted changes",
    shows: "A yellow * after the branch name when the folder has changes that are not committed yet (edited, staged or new files).",
    sample: "my-repo(main*)   or   🌳 fix-login*",
    legend: "Yellow *. Nothing is shown for a folder that is not a git repository.",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "prs",
    name: "Pull requests",
    shows: "A clickable tag for each pull request this session opened from the current branch.",
    sample: "(#12)",
    legend: "Cyan.",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "context",
    name: "Context window",
    shows: "How full the model's context window is.",
    sample: "🔋 42%",
    legend: "🔋 = context window. Green below 70%, yellow 70-89%, red from 90%.",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "model",
    name: "Model",
    shows: "The name of the model this session is using.",
    sample: "Opus 5.5",
    legend: "",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "usage5h",
    name: "5-hour usage",
    shows: "How much of your 5-hour usage limit you have used, and whether you are using it faster or slower than an even pace.",
    sample: "5h 🐕 37%",
    legend: PACE_LEGEND,
    appliesTo: SUBSCRIPTION_ONLY,
    defaultOn: true,
  },
  {
    id: "usage7d",
    name: "7-day usage",
    shows: "How much of your 7-day usage limit you have used, and whether you are using it faster or slower than an even pace.",
    sample: "7d 🐢 12%",
    legend: PACE_LEGEND,
    appliesTo: SUBSCRIPTION_ONLY,
    defaultOn: true,
  },
  {
    id: "spend",
    name: "Monthly spend",
    shows: "What you have spent this month on Claude usage (an estimate), and, if you set a monthly budget, how that compares with an even spread of the budget over the month.",
    sample: "💰 $62/$200 🐕 31%   (no budget set: 💰 $62)",
    legend: SPEND_LEGEND,
    appliesTo: PAYG_ONLY,
    defaultOn: true,
  },
  {
    id: "plan",
    name: "Plan link",
    shows: "A link to the current plan file, at the right edge, once the session has one.",
    sample: "🗺️ plan",
    legend: "🗺️ = plan file. Grey text.",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "worktrees",
    name: "Other worktrees",
    shows: "A second line listing the other worktrees this session has visited, each with its pull requests.",
    sample: "fix-login (#12)  add-tests",
    legend: "",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "subagents",
    name: "Sub-agents",
    shows: "A line listing the sub-agents running right now, with the model each one uses.",
    sample: "🤖 Explore Opus 4.8, review Sonnet 5",
    legend: "🤖 = sub-agents. Model names in grey.",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
  {
    id: "intro",
    name: "Start-up animation",
    shows: "A small ship that crosses the line for the first 4 seconds of a session.",
    sample: "o≡≡≡>",
    legend: "Cyan.",
    appliesTo: EVERY_ACCOUNT,
    defaultOn: true,
  },
] as const satisfies readonly FieldInfo[];

export type Field = (typeof FIELDS)[number];
export type FieldId = Field["id"];

export const FIELD_IDS: readonly FieldId[] = FIELDS.map((f) => f.id);

export function isFieldId(value: unknown): value is FieldId {
  return (FIELD_IDS as readonly unknown[]).includes(value);
}

// The one place a per-field table is built. Every FieldId is present because the
// keys come from FIELD_IDS, which is why the cast is safe; callers need no cast of their own.
export function buildFields(valueFor: (id: FieldId) => boolean): Readonly<Record<FieldId, boolean>> {
  return Object.fromEntries(FIELD_IDS.map((id) => [id, valueFor(id)])) as Record<FieldId, boolean>;
}

export function defaultFields(): Readonly<Record<FieldId, boolean>> {
  return buildFields((id) => FIELDS.some((f) => f.id === id && f.defaultOn));
}

// A field applies to an account type if it lists it. An undetected account
// ("unknown") is offered every field, so nothing is hidden by a wrong guess.
export function fieldsFor(type: DetectedType): readonly Field[] {
  // Cast: `as const` gives each field its own tuple type; widened here so one `includes` fits all of them.
  return FIELDS.filter((f) => type === UNKNOWN || (f.appliesTo as readonly AccountType[]).includes(type));
}
