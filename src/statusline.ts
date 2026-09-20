import { basename } from "node:path";
import { loadConfig } from "./config";
import {
  getPlan,
  introElapsed,
  listSubagents,
  readPRs,
  setItermId,
  setLabel,
  setModel,
} from "./state";

// ---- payload shape (subset of the statusline stdin JSON) -------------------

interface Model {
  readonly display_name?: string;
}
interface Usage {
  readonly input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}
interface ContextWindow {
  readonly used_percentage?: number | null;
  readonly context_window_size?: number;
  readonly total_input_tokens?: number;
  readonly current_usage?: Usage | null;
}
interface Worktree {
  readonly name?: string;
  readonly path?: string;
  readonly branch?: string;
}
interface Workspace {
  readonly current_dir?: string;
  readonly git_worktree?: string;
}
interface Payload {
  readonly session_id?: string;
  readonly cwd?: string;
  readonly model?: Model;
  readonly workspace?: Workspace;
  readonly worktree?: Worktree;
  readonly context_window?: ContextWindow;
}

// ---- terminal formatting ---------------------------------------------------

const ESC = "\x1b";
const BEL = "\x07";
const RESET = ESC + "[0m";
const RED = 91;
const YELLOW = 93;
const GREEN = 32;
const CYAN = 96;
const DIM = 90;

function sgr(code: number, text: string): string {
  return ESC + "[" + code + "m" + text + RESET;
}
function osc8(url: string, text: string): string {
  return ESC + "]8;;" + url + BEL + text + ESC + "]8;;" + BEL;
}

// Route path clicks through the tricorder handler; macOS opens each path with the
// app associated to its extension. The icon itself is the clickable target.
const OPEN_SCHEME = "tricorder://open?path=";
// iTerm2 only makes OSC 8 links clickable when they contain text, so every link
// carries a short word target next to its icon (an emoji alone is not clickable).
function openLink(path: string, text: string): string {
  return osc8(OPEN_SCHEME + encodeURIComponent(path), text);
}

// ---- visible width (strip ANSI + OSC 8; emoji count as 2) ------------------

const OSC8_RE = /\x1b\]8;;[^\x07]*\x07/g;
const SGR_RE = /\x1b\[[0-9;]*m/g;
const VS16 = 0xfe0f;
const WIDE_MIN = 0x1f000;
const WIDE_WIDTH = 2;
const NARROW_WIDTH = 1;

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === VS16) return 0;
  return cp >= WIDE_MIN ? WIDE_WIDTH : NARROW_WIDTH;
}
function visWidth(s: string): number {
  const clean = s.replace(OSC8_RE, "").replace(SGR_RE, "");
  return [...clean].reduce((w, ch) => w + charWidth(ch), 0);
}

// ---- icons -----------------------------------------------------------------

const ICON_MUTED = "🔇";
const ICON_TREE = "🌳";
const ICON_HELMET = "🪖";
const ICON_MAP = "🗺️";
const ICON_CTX = "🔋";
const ICON_ROBOT = "🤖";
const SEP = " · ";
const MARGIN = 1;
const MINI_SHIP = "o≡≡≡>";
const ANIM_MS = 4000;
const DEFAULT_WIDTH = 80;

// ---- context-window gauge (percentage only) --------------------------------

const PCT_MAX = 100;
const CTX_RED_PCT = 90;
const CTX_YELLOW_PCT = 70;

function usedTokens(cw: ContextWindow): number {
  const u = cw.current_usage;
  if (u) {
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  }
  return cw.total_input_tokens ?? 0;
}
function computePct(cw: ContextWindow, size: number, used: number): number {
  if (typeof cw.used_percentage === "number") return cw.used_percentage;
  if (size > 0) return (used / size) * PCT_MAX;
  return 0;
}
function ctxColor(pct: number): number {
  if (pct >= CTX_RED_PCT) return RED;
  if (pct >= CTX_YELLOW_PCT) return YELLOW;
  return GREEN;
}
function contextSegment(cw: ContextWindow | undefined): string | null {
  if (!cw) return null;
  const size = cw.context_window_size ?? 0;
  const pctInt = Math.round(computePct(cw, size, usedTokens(cw)));
  return ICON_CTX + " " + sgr(ctxColor(pctInt), pctInt + "%");
}

// ---- segments --------------------------------------------------------------

function worktreeSegment(p: Payload): string | null {
  const wt = p.worktree;
  const path = wt?.path ?? p.workspace?.current_dir ?? p.cwd ?? "";
  if (path === "") return null;
  const label = wt?.branch ?? wt?.name ?? (basename(path) || path);
  return openLink(path, ICON_TREE + " " + label);
}

function terminalWidth(): number {
  return Number(process.env.COLUMNS) || (process.stdout.columns ?? 0);
}

function line1(p: Payload, session: string): string {
  const muted = loadConfig().muted;
  const mid = [worktreeSegment(p), contextSegment(p.context_window), p.model?.display_name ?? null]
    .filter((s): s is string => s !== null && s !== "")
    .join(SEP);
  // Passive mute indicator only (audio control lives in the menu-bar app now).
  const left = muted ? ICON_MUTED + " " + mid : mid;
  const plan = session === "" ? null : getPlan(session);
  if (plan === null) return left;
  const right = openLink(plan, ICON_MAP + " " + sgr(DIM, "plan"));
  const width = terminalWidth();
  const gap = width > 0 ? Math.max(MARGIN, width - visWidth(left) - visWidth(right) - MARGIN) : MARGIN;
  return left + " ".repeat(gap) + right;
}

function prLine(session: string): string | null {
  const prs = readPRs(session);
  if (prs.length === 0) return null;
  const links = prs.map((pr) => osc8(pr.url, sgr(CYAN, pr.number === null ? "PR" : "#" + pr.number)));
  return ICON_HELMET + " " + links.join("  ");
}

// All running sub-agents on one compact line: "🤖 Explore Opus 4.8, review Sonnet 5".
function subagentLine(session: string): string | null {
  const subs = listSubagents(session);
  if (subs.length === 0) return null;
  const parts = subs.map((s) => s.type + " " + sgr(DIM, s.model));
  return ICON_ROBOT + " " + parts.join(", ");
}

// One-shot mini-ship intro: a small ship crawls line 1 for the first ANIM_MS.
function introFrame(elapsed: number): string {
  const width = terminalWidth() || DEFAULT_WIDTH;
  const total = width + MINI_SHIP.length;
  const x = Math.round((elapsed / ANIM_MS) * total) - MINI_SHIP.length;
  const s = x >= 0 ? " ".repeat(x) + MINI_SHIP : MINI_SHIP.slice(-x);
  return sgr(CYAN, s.slice(0, width));
}

function parse(raw: string): Payload | null {
  try {
    return JSON.parse(raw) as Payload;
  } catch {
    return null;
  }
}

export function renderStatusline(raw: string): void {
  const payload = parse(raw);
  if (payload === null) return;
  const session = payload.session_id ?? "";
  const hasSession = session !== "";
  const model = payload.model?.display_name;
  if (hasSession && model !== undefined && model !== "") setModel(session, model);
  if (hasSession) {
    // Stash label + iTerm session id for the menu-bar app.
    const wt = payload.worktree;
    const path = wt?.path ?? payload.workspace?.current_dir ?? payload.cwd ?? "";
    setLabel(session, wt?.branch ?? wt?.name ?? (basename(path) || session));
    const iterm = process.env.ITERM_SESSION_ID;
    if (iterm !== undefined && iterm !== "") setItermId(session, iterm);
  }
  if (hasSession) {
    const el = introElapsed(session);
    if (el < ANIM_MS) {
      process.stdout.write(introFrame(el) + "\n");
      return;
    }
  }
  const lines = [
    line1(payload, session),
    hasSession ? prLine(session) : null,
    hasSession ? subagentLine(session) : null,
  ].filter((l): l is string => l !== null && l !== "");
  process.stdout.write(lines.join("\n") + "\n");
}
