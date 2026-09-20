import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const JSON_INDENT = 2;

// Writable, machine-local data dir. Lives outside the read-only plugin cache so
// it survives plugin updates. The binary resolves this same path whether Claude
// Code runs it as the statusline or as a hook.
export const DATA_DIR = join(homedir(), ".claude", "tricorder");
export const CONFIG_PATH = join(DATA_DIR, "config.json");
export const STATE_DIR = join(DATA_DIR, "state");
export const SOUNDS_DIR = join(DATA_DIR, "sounds");

export const QUESTION_SOUND = join(SOUNDS_DIR, "please-specify.mp3");
export const PERMISSION_SOUND = join(SOUNDS_DIR, "security-authorisation.mp3");
export const STOP_SOUND = join(SOUNDS_DIR, "transporter-complete.mp3");
export const PLAN_SOUND = join(SOUNDS_DIR, "engage.mp3");

export type SoundEvent = "question" | "permission" | "stop" | "plan";

export interface SoundEntry {
  readonly enabled: boolean;
  readonly file: string;
}

export interface Config {
  muted: boolean;
  readonly sounds: Record<SoundEvent, SoundEntry>;
}

export const DEFAULT_CONFIG: Config = {
  // Sounds off by default; turn them on from the menu-bar app.
  muted: true,
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

function mergeConfig(base: Config, override: Partial<Config>): Config {
  const events = Object.keys(base.sounds) as readonly SoundEvent[];
  const sounds = Object.fromEntries(
    events.map((key) => {
      const o = override.sounds?.[key];
      return [key, o ? { ...base.sounds[key], ...o } : base.sounds[key]] as const;
    }),
  ) as Record<SoundEvent, SoundEntry>;
  return {
    muted: typeof override.muted === "boolean" ? override.muted : base.muted,
    sounds,
  };
}

export function saveConfig(cfg: Config): void {
  ensureDir(DATA_DIR);
  writeFileSync(CONFIG_PATH, serialize(cfg));
}
