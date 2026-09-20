import { loadConfig, saveConfig, type SoundEvent } from "./config";
import { getAttention, getItermId, getLabel, listSessions, listSubagents, setAttention } from "./state";
import { log } from "./log";

const HOURS_STALE = 6;
const MS_PER_HOUR = 3600000;
const STALE_MS = HOURS_STALE * MS_PER_HOUR;
const LABEL_FALLBACK_LEN = 8;

const SOUND_EVENTS: readonly SoundEvent[] = ["question", "permission", "stop", "plan"];

interface SessionStatus {
  readonly id: string;
  readonly label: string;
  readonly state: string;
  readonly at: number;
  readonly iterm: string;
  // Running sub-agent count. "working" is a real, active state — this makes it
  // impossible to mistake a session that's mid-fanout for an idle one.
  readonly agents: number;
}

function sessionStatus(id: string, now: number): SessionStatus | null {
  const a = getAttention(id);
  if (a === null || now - a.at >= STALE_MS) return null;
  return {
    id,
    label: getLabel(id) ?? id.slice(0, LABEL_FALLBACK_LEN),
    state: a.state,
    at: a.at,
    iterm: getItermId(id) ?? "",
    agents: listSubagents(id).length,
  };
}

// `tricorder status` → single JSON blob the menu-bar app polls.
export function status(): void {
  const now = Date.now();
  const cfg = loadConfig();
  const sessions = listSessions()
    .map((id) => sessionStatus(id, now))
    .filter((s): s is SessionStatus => s !== null);
  const payload = {
    muted: cfg.muted,
    sounds: {
      question: cfg.sounds.question.enabled,
      permission: cfg.sounds.permission.enabled,
      plan: cfg.sounds.plan.enabled,
      stop: cfg.sounds.stop.enabled,
    },
    sessions,
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

// `tricorder ack <id>` → clear a session's attention (the focus-acknowledge path).
export function ack(id: string | undefined): void {
  if (id === undefined || id === "") return;
  setAttention(id, "working");
  log("ack " + id + " → working");
}

function decide(current: boolean, arg: string | undefined): boolean {
  if (arg === "on") return true;
  if (arg === "off") return false;
  return !current;
}

// `tricorder sound-enable <event> [on|off|toggle]` → flip one sound's enabled flag.
export function soundEnable(event: string | undefined, arg: string | undefined): void {
  if (event === undefined || !SOUND_EVENTS.includes(event as SoundEvent)) return;
  const key = event as SoundEvent;
  const cfg = loadConfig();
  const next = decide(cfg.sounds[key].enabled, arg);
  const sounds = { ...cfg.sounds, [key]: { ...cfg.sounds[key], enabled: next } };
  saveConfig({ ...cfg, sounds });
  log("sound-enable " + key + " → " + (next ? "on" : "off"));
}
