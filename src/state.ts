import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { STATE_DIR, ensureDir, serialize } from "./config";

export interface PR {
  readonly number: number | null;
  readonly url: string;
}

export interface Subagent {
  readonly type: string;
  readonly desc: string;
  readonly model: string;
  readonly startedAt: number;
}

const JSON_EXT = ".json";
const PRS_FILE = "prs.json";
const PLAN_FILE = "plan.txt";
const MODEL_FILE = "model.txt";
const SUBAGENTS_DIR = "subagents";

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function sessionDir(sessionId: string): string {
  return join(STATE_DIR, sanitize(sessionId));
}

function subagentsDir(sessionId: string): string {
  return join(sessionDir(sessionId), SUBAGENTS_DIR);
}

function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function readPRs(sessionId: string): readonly PR[] {
  return readJSON<readonly PR[]>(join(sessionDir(sessionId), PRS_FILE), []);
}

export function addPR(sessionId: string, pr: PR): void {
  const dir = sessionDir(sessionId);
  ensureDir(dir);
  const prs = readPRs(sessionId);
  const already = prs.some(
    (p) => p.url === pr.url || (pr.number !== null && p.number === pr.number),
  );
  if (already) return;
  writeFileSync(join(dir, PRS_FILE), serialize([...prs, pr]));
}

export function addSubagent(sessionId: string, id: string, data: Subagent): void {
  const dir = subagentsDir(sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, sanitize(id) + JSON_EXT), serialize(data));
}

export function removeSubagent(sessionId: string, id: string): void {
  try {
    rmSync(join(subagentsDir(sessionId), sanitize(id) + JSON_EXT), { force: true });
  } catch {
    // already gone
  }
}

export function listSubagents(sessionId: string): readonly Subagent[] {
  const dir = subagentsDir(sessionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(JSON_EXT))
    .map((f) => readJSON<Subagent | null>(join(dir, f), null))
    .filter((s): s is Subagent => s !== null)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function setPlan(sessionId: string, planPath: string): void {
  const dir = sessionDir(sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, PLAN_FILE), planPath + "\n");
}

export function getPlan(sessionId: string): string | null {
  try {
    return readFileSync(join(sessionDir(sessionId), PLAN_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

// The statusline stashes the session model so capture can name the real model a
// sub-agent inherits when the spawn set no override.
export function setModel(sessionId: string, model: string): void {
  const dir = sessionDir(sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, MODEL_FILE), model + "\n");
}

export function getModel(sessionId: string): string | null {
  try {
    return readFileSync(join(sessionDir(sessionId), MODEL_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

const SOUND_AT_FILE = "sound-at.txt";

// Records the moment a sound actually played for this session (never on a
// muted/disabled/debounced skip) — the menu-bar app uses this to mark exactly
// which row just made noise, so several "mission complete" rows aren't
// ambiguous about which one is current.
export function setLastSound(sessionId: string): void {
  const dir = sessionDir(sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, SOUND_AT_FILE), String(Date.now()));
}

export function getLastSound(sessionId: string): number | null {
  try {
    const raw = Number(readFileSync(join(sessionDir(sessionId), SOUND_AT_FILE), "utf8").trim());
    return Number.isFinite(raw) ? raw : null;
  } catch {
    return null;
  }
}

const ATTENTION_FILE = "attention.json";
const LABEL_FILE = "label.txt";
const ITERM_FILE = "iterm.txt";
const CWD_FILE = "cwd.txt";
const DEBUG_DIR = "_debug";

export type Attention = "security" | "question" | "done" | "working";

export interface AttentionRecord {
  readonly state: Attention;
  readonly at: number;
}

function writeText(sessionId: string, file: string, value: string): void {
  const dir = sessionDir(sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, file), value + "\n");
}

function readText(sessionId: string, file: string): string | null {
  try {
    return readFileSync(join(sessionDir(sessionId), file), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function setAttention(sessionId: string, state: Attention): void {
  const dir = sessionDir(sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, ATTENTION_FILE), serialize({ state, at: Date.now() }));
}

export function getAttention(sessionId: string): AttentionRecord | null {
  return readJSON<AttentionRecord | null>(join(sessionDir(sessionId), ATTENTION_FILE), null);
}

export function setLabel(sessionId: string, label: string): void {
  writeText(sessionId, LABEL_FILE, label);
}
export function getLabel(sessionId: string): string | null {
  return readText(sessionId, LABEL_FILE);
}
// Seeds a baseline label from hooks alone (e.g. basename(cwd)) so a
// menu-bar-only setup — no statusline ever wired up — still gets a real name
// instead of a UUID fragment. Never overwrites: the statusline's branch-aware
// label is nicer and always takes over once it renders.
export function setLabelIfAbsent(sessionId: string, label: string): void {
  if (existsSync(join(sessionDir(sessionId), LABEL_FILE))) return;
  writeText(sessionId, LABEL_FILE, label);
}
export function setItermId(sessionId: string, id: string): void {
  writeText(sessionId, ITERM_FILE, id);
}
export function getItermId(sessionId: string): string | null {
  return readText(sessionId, ITERM_FILE);
}
// Stashed on nearly every hook call (the payload always carries cwd), so this is
// available far earlier and more reliably than waiting for a statusline render —
// the menu-bar app's "restore sessions" feature reads this instead of scanning
// the (potentially huge) transcript store.
export function setCwd(sessionId: string, cwd: string): void {
  writeText(sessionId, CWD_FILE, cwd);
}
export function getCwd(sessionId: string): string | null {
  return readText(sessionId, CWD_FILE);
}

export function removeSession(sessionId: string): void {
  try {
    rmSync(sessionDir(sessionId), { recursive: true, force: true });
  } catch {
    // already gone
  }
}

export function listSessions(): readonly string[] {
  try {
    return readdirSync(STATE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== DEBUG_DIR)
      .map((e) => e.name);
  } catch {
    return [];
  }
}

const INTRO_FILE = "intro.txt";

// Milliseconds since this session's statusline first rendered. First call marks
// the start (returns 0); drives the one-shot mini-ship intro.
export function introElapsed(sessionId: string): number {
  const path = join(sessionDir(sessionId), INTRO_FILE);
  try {
    const started = Number(readFileSync(path, "utf8").trim());
    if (Number.isFinite(started)) return Date.now() - started;
  } catch {
    // not started yet
  }
  const dir = sessionDir(sessionId);
  ensureDir(dir);
  try {
    writeFileSync(path, String(Date.now()));
  } catch {
    // ignore
  }
  return 0;
}

// Diagnostic: dump the latest raw payload per hook event to state/_debug/.
export function debugDump(name: string, raw: string): void {
  try {
    const dir = join(STATE_DIR, "_debug");
    ensureDir(dir);
    writeFileSync(join(dir, name + JSON_EXT), raw);
  } catch {
    // debugging aid only — never disturb the hook
  }
}
