import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, SOUNDS_DIR, ensureDir, loadConfig, type SoundEvent } from "./config";
import { log } from "./log";

const AFPLAY = "/usr/bin/afplay";
const VALID_EVENTS: readonly SoundEvent[] = ["question", "permission", "stop", "plan"];
const DEBOUNCE_MS = 1500;
const LAST_SOUND_FILE = join(DATA_DIR, ".last-sound");

function isSoundEvent(value: string | undefined): value is SoundEvent {
  return value !== undefined && VALID_EVENTS.includes(value as SoundEvent);
}

// When run as a hook, CLAUDE_PLUGIN_ROOT points at the installed plugin. Copy any
// bundled sound the data dir is missing, so a fresh machine self-heals.
function ensureBundledSounds(): void {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root === undefined) return;
  const from = join(root, "sounds");
  if (!existsSync(from)) return;
  ensureDir(SOUNDS_DIR);
  readdirSync(from)
    .filter((name) => !existsSync(join(SOUNDS_DIR, name)))
    .forEach((name) => {
      copyFileSync(join(from, name), join(SOUNDS_DIR, name));
    });
}

// Several hooks can fire around one prompt (a question triggers Notification and
// PreToolUse both). Collapse them: if a sound played within DEBOUNCE_MS, skip.
function debounced(): boolean {
  const now = Date.now();
  try {
    const last = Number(readFileSync(LAST_SOUND_FILE, "utf8").trim());
    if (Number.isFinite(last) && now - last < DEBOUNCE_MS) return true;
  } catch {
    // no prior timestamp
  }
  try {
    ensureDir(DATA_DIR);
    writeFileSync(LAST_SOUND_FILE, String(now));
  } catch {
    // ignore write failure
  }
  return false;
}

export function playSound(eventArg: string | undefined): void {
  if (!isSoundEvent(eventArg)) {
    log("sound " + (eventArg ?? "?") + " → invalid event");
    return;
  }
  ensureBundledSounds();
  const cfg = loadConfig();
  if (cfg.muted) {
    log("sound " + eventArg + " → muted, skip");
    return;
  }
  const entry = cfg.sounds[eventArg];
  if (!entry.enabled) {
    log("sound " + eventArg + " → disabled, skip");
    return;
  }
  if (!existsSync(entry.file)) {
    log("sound " + eventArg + " → missing file " + entry.file);
    return;
  }
  if (debounced()) {
    log("sound " + eventArg + " → debounced, skip");
    return;
  }
  log("sound " + eventArg + " → play " + entry.file);
  // Detached fire-and-forget: the hook process can exit while the sound plays.
  const child = spawn(AFPLAY, [entry.file], { stdio: "ignore", detached: true });
  child.on("error", () => {
    // afplay missing or file unreadable — stay silent, never crash the hook.
  });
  child.unref();
}
