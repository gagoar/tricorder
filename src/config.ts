import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readField } from "./account";
import { AUTO, buildFields, defaultFields, isAccountMode, type AccountMode, type FieldId } from "./fields";
import { DEFAULT_PACE, isResetNoteFrom, PCT_MAX, type PaceConfig } from "./pace";

const JSON_INDENT = 2;

// Writable, machine-local data dir. Lives outside the read-only plugin cache so
// it survives plugin updates. The binary resolves this same path whether Claude
// Code runs it as the statusline or as a hook.
export const DATA_DIR = join(homedir(), ".claude", "tricorder");
export const CONFIG_PATH = join(DATA_DIR, "config.json");
export const STATE_DIR = join(DATA_DIR, "state");
export const SOUNDS_DIR = join(DATA_DIR, "sounds");
export const SPEND_DIR = join(DATA_DIR, "spend");

export const QUESTION_SOUND = join(SOUNDS_DIR, "please-specify.mp3");
export const PERMISSION_SOUND = join(SOUNDS_DIR, "security-authorisation.mp3");
export const STOP_SOUND = join(SOUNDS_DIR, "transporter-complete.mp3");
export const PLAN_SOUND = join(SOUNDS_DIR, "engage.mp3");

export type SoundEvent = "question" | "permission" | "stop" | "plan";

export interface SoundEntry {
  readonly enabled: boolean;
  readonly file: string;
}

// Clicking the worktree link in the statusline: open the path (plain file://,
// no app dependency), copy it to the clipboard (needs TricorderBar.app to
// handle the click), or both.
export const WORKTREE_CLICK_MODES = ["open", "copy", "both"] as const;
export type WorktreeClickMode = (typeof WORKTREE_CLICK_MODES)[number];

export function isWorktreeClickMode(value: unknown): value is WorktreeClickMode {
  return (WORKTREE_CLICK_MODES as readonly unknown[]).includes(value);
}

// Monthly budget for pay-per-use accounts, in US dollars (Claude Code reports cost
// in USD). null = no budget set: only the month's spend is shown.
export interface BudgetConfig {
  readonly monthlyUsd: number | null;
}

// Which statusline fields are drawn (see src/fields.ts for the list), how the
// account type is decided, and the pace and budget settings.
export interface StatuslineConfig {
  readonly fields: Readonly<Record<FieldId, boolean>>;
  // "auto" detects the account type; the other two force it.
  readonly mode: AccountMode;
  readonly pace: PaceConfig;
  readonly budget: BudgetConfig;
}

export interface Config {
  muted: boolean;
  worktreeClick: WorktreeClickMode;
  statusline: StatuslineConfig;
  readonly sounds: Record<SoundEvent, SoundEntry>;
}

export const DEFAULT_CONFIG: Config = {
  // Sounds off by default; turn them on from the menu-bar app.
  muted: true,
  worktreeClick: "open",
  // Every field on, so nothing changes for an existing user until they choose.
  statusline: { fields: defaultFields(), mode: AUTO, pace: DEFAULT_PACE, budget: { monthlyUsd: null } },
  sounds: {
    // "Please specify how you would like to proceed" — plays when Claude waits
    // on you (Notification / AskUserQuestion).
    question: { enabled: true, file: QUESTION_SOUND },
    // "Security authorisation required" — a real permission prompt only appears
    // in manual mode; under auto + skipAutoPermissionPrompt it never fires, and
    // when it did it doubled up on questions. Off by default.
    permission: { enabled: false, file: PERMISSION_SOUND },
    // Transporter chime — plays when Claude finishes a turn (Stop). tars-voice
    // also speaks on Stop; disable one if the pair is too much.
    stop: { enabled: true, file: STOP_SOUND },
    // "Engage" — plays when a plan is presented (ExitPlanMode / EnterPlanMode).
    plan: { enabled: true, file: PLAN_SOUND },
  },
};

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function serialize(value: unknown): string {
  return JSON.stringify(value, null, JSON_INDENT) + "\n";
}

export function loadConfig(): Config {
  ensureDir(DATA_DIR);
  if (!existsSync(CONFIG_PATH)) {
    // Seed the effective config from the shipped defaults on first run.
    writeFileSync(CONFIG_PATH, serialize(DEFAULT_CONFIG));
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

const isPositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isShareBelowMax = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < PCT_MAX;

// A pace setting that is missing, not a number or out of range keeps its default.
function mergePace(base: PaceConfig, given: unknown): PaceConfig {
  const marginPts = readField(given, "marginPts");
  const minElapsedPct = readField(given, "minElapsedPct");
  const resetNoteFrom = readField(given, "resetNoteFrom");
  return {
    marginPts: isPositive(marginPts) ? marginPts : base.marginPts,
    minElapsedPct: isShareBelowMax(minElapsedPct) ? minElapsedPct : base.minElapsedPct,
    resetNoteFrom: isResetNoteFrom(resetNoteFrom) ? resetNoteFrom : base.resetNoteFrom,
  };
}

function mergeBudget(given: unknown): BudgetConfig {
  const value = readField(given, "monthlyUsd");
  return { monthlyUsd: isPositive(value) ? value : null };
}

function mergeStatusline(base: StatuslineConfig, override: Partial<StatuslineConfig> | undefined): StatuslineConfig {
  // Cast: the config file is user-edited JSON, so each value is checked with typeof below.
  const given = override?.fields as Partial<Record<string, unknown>> | undefined;
  const fields = buildFields((id) => {
    const value = given?.[id];
    return typeof value === "boolean" ? value : base.fields[id];
  });
  return { fields, mode: isAccountMode(override?.mode) ? override.mode : base.mode, pace: mergePace(base.pace, override?.pace), budget: mergeBudget(override?.budget) };
}

export function mergeConfig(base: Config, override: Partial<Config>): Config {
  const events = Object.keys(base.sounds) as readonly SoundEvent[];
  const sounds = Object.fromEntries(
    events.map((key) => {
      const o = override.sounds?.[key];
      return [key, o ? { ...base.sounds[key], ...o } : base.sounds[key]] as const;
    }),
  ) as Record<SoundEvent, SoundEntry>;
  return {
    muted: typeof override.muted === "boolean" ? override.muted : base.muted,
    worktreeClick: isWorktreeClickMode(override.worktreeClick) ? override.worktreeClick : base.worktreeClick,
    statusline: mergeStatusline(base.statusline, override.statusline),
    sounds,
  };
}

export function saveConfig(cfg: Config): void {
  ensureDir(DATA_DIR);
  writeFileSync(CONFIG_PATH, serialize(cfg));
}
