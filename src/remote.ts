import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Is Remote Control on for this session? Claude Code does not put it in the
// statusline data. It records it in its own per-session file, `sessions/<pid>.json`
// in the account's config folder, as `bridgeSessionId`: a text id while Remote
// Control is on, null otherwise. The file is matched to this session by `sessionId`.
//
// These files are internal to Claude Code and not a documented interface, so every
// read is guarded: if anything looks different, the answer is "not remote". Files
// from processes that have ended can stay behind, so a record only counts while
// its process is still running, and if several match the newest one decides.

const SESSIONS_DIR = "sessions";
const JSON_EXT = ".json";
const NO_UPDATE = 0; // for a record with no usable `updatedAt`

interface SessionRecord {
  readonly pid?: unknown;
  readonly sessionId?: unknown;
  readonly bridgeSessionId?: unknown;
  readonly updatedAt?: unknown;
}

const isRecord = (value: unknown): value is SessionRecord => typeof value === "object" && value !== null;
const updatedAt = (r: SessionRecord): number => (typeof r.updatedAt === "number" ? r.updatedAt : NO_UPDATE);

// True if a process with this id is running. "No permission to signal it" still
// means it exists.
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Cast: process.kill only throws system errors, which carry a `code`.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Pure: decides from the parsed session records. `isAlive` says whether a process runs.
export function remoteFromRecords(records: readonly unknown[], sessionId: string, isAlive: (pid: number) => boolean): boolean {
  const mine = records
    .filter(isRecord)
    .filter((r) => r.sessionId === sessionId && typeof r.pid === "number" && isAlive(r.pid));
  const newest = mine.reduce<SessionRecord | null>((best, r) => (best === null || updatedAt(r) > updatedAt(best) ? r : best), null);
  return newest !== null && typeof newest.bridgeSessionId === "string" && Boolean(newest.bridgeSessionId);
}

// The account's session folder: CLAUDE_CONFIG_DIR when set, else ~/.claude.
export function sessionsDir(): string | null {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (dir) return join(dir, SESSIONS_DIR);
  const home = process.env.HOME;
  return home ? join(home, ".claude", SESSIONS_DIR) : null;
}

function readRecords(dir: string): readonly unknown[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(JSON_EXT))
      .map((name) => {
        try {
          return JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
        } catch {
          return null;
        }
      });
  } catch {
    return [];
  }
}

export function remoteActive(sessionId: string): boolean {
  const dir = sessionsDir();
  return Boolean(sessionId) && dir !== null && remoteFromRecords(readRecords(dir), sessionId, processExists);
}
