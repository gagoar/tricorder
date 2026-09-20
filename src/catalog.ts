import { writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { SOUNDS_DIR, ensureDir, loadConfig, saveConfig, type SoundEvent } from "./config";
import { log } from "./log";

const SOUND_EVENTS: readonly SoundEvent[] = ["question", "permission", "stop", "plan"];
// The catalog page (docs/sounds.html) is the only intended caller, but a custom
// URL scheme is reachable from ANY webpage a user visits, not just ours — so
// sound-set only ever fetches from a known host, never an arbitrary URL.
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["www.trekcore.com", "trekcore.com"]);
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const MAX_CLIP_MB = 10;
const MAX_BYTES = MAX_CLIP_MB * KB_PER_MB * BYTES_PER_KB; // generous for a clip, not for abuse
const DEFAULT_EXT = ".mp3";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";

function isSoundEvent(value: string | undefined): value is SoundEvent {
  return value !== undefined && SOUND_EVENTS.includes(value as SoundEvent);
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? "clip" : cleaned;
}

function deriveFilename(url: URL, name: string | undefined): string {
  const base = name !== undefined && name !== "" ? sanitizeFilename(name) : sanitizeFilename(basename(url.pathname));
  const ext = extname(url.pathname) || DEFAULT_EXT;
  return base + ext;
}

// `tricorder sound-set <event> <url> [name]` — fetches a catalog pick on demand
// and assigns it to a sound event. Ships no audio itself; only ever downloads
// from the allowlisted catalog source, mirroring a user clicking the link
// themselves.
export async function soundSet(
  eventArg: string | undefined,
  urlArg: string | undefined,
  nameArg: string | undefined,
): Promise<void> {
  if (!isSoundEvent(eventArg)) {
    log("sound-set " + (eventArg ?? "?") + " → invalid event");
    return;
  }
  if (urlArg === undefined || urlArg === "") {
    log("sound-set " + eventArg + " → missing url");
    return;
  }
  let url: URL;
  try {
    url = new URL(urlArg);
  } catch {
    log("sound-set " + eventArg + " → invalid url " + urlArg);
    return;
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    log("sound-set " + eventArg + " → rejected host " + url.hostname);
    return;
  }

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.trekcore.com/audio/" } });
    if (!res.ok) {
      log("sound-set " + eventArg + " → fetch failed " + res.status);
      return;
    }
    bytes = await res.arrayBuffer();
  } catch (err) {
    log("sound-set " + eventArg + " → fetch error " + String(err));
    return;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    log("sound-set " + eventArg + " → rejected size " + bytes.byteLength);
    return;
  }

  ensureDir(SOUNDS_DIR);
  const filename = deriveFilename(url, nameArg);
  const dest = join(SOUNDS_DIR, filename);
  writeFileSync(dest, Buffer.from(bytes));

  const cfg = loadConfig();
  const sounds = { ...cfg.sounds, [eventArg]: { enabled: true, file: dest } };
  saveConfig({ ...cfg, sounds });
  log("sound-set " + eventArg + " → " + dest);
}
