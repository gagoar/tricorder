import { basename } from "node:path";
import { loadConfig, SPEND_DIR, type Config, type WorktreeClickMode } from "./config";
import {
  addWorktree,
  getPlan,
  introElapsed,
  listSubagents,
  prsForBranch,
  readWorktrees,
  setItermId,
  setLabel,
  setModel,
} from "./state";
import { detectAccount, readAccountEmail, resolveType } from "./account";
import { AUTO, PAYG, UNKNOWN } from "./fields";
import { currentBranch, isDirty } from "./git";
import { remoteActive } from "./remote";
import { budgetBand, elapsedPct, FIVE_HOUR_WINDOW_S, formatRemaining, limitBand, MS_PER_S, PACE_STYLES, SEVEN_DAY_WINDOW_S, showsResetNote, type PaceBand, type PaceConfig } from "./pace";
import { log } from "./log";
import { monthElapsedPct, monthSpendUsd, recordCost } from "./spend";

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
// A usage limit as Claude Code reports it (subscription accounts only).
// `resets_at` is when the window ends, in epoch seconds.
interface RateWindow {
  readonly used_percentage?: number | null;
  readonly resets_at?: number | null;
}
interface RateLimits {
  readonly five_hour?: RateWindow;
  readonly seven_day?: RateWindow;
}
// What this session has cost so far, as Claude Code reports it, in US dollars.
interface Cost {
  readonly total_cost_usd?: number | null;
}
interface Payload {
  readonly session_id?: string;
  readonly cwd?: string;
  readonly model?: Model;
  readonly workspace?: Workspace;
  readonly worktree?: Worktree;
  readonly context_window?: ContextWindow;
  readonly rate_limits?: RateLimits;
  readonly cost?: Cost;
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

function sgr(code: number | string, text: string): string {
  return ESC + "[" + code + "m" + text + RESET;
}
function osc8(url: string, text: string): string {
  return ESC + "]8;;" + url + BEL + text + ESC + "]8;;" + BEL;
}

// A plain file:// link already opens with the app associated to that file's
// extension via macOS LaunchServices — no custom scheme or app dependency
// needed, so the statusline's path links work standalone even when
// TricorderBar.app isn't installed. iTerm2 only makes OSC 8 links clickable
// when they contain text, so every link carries a short word target next to
// its icon (an emoji alone is not clickable).
function openLink(path: string, text: string): string {
  return osc8("file://" + encodeURI(path), text);
}

// Copying to the clipboard can't happen from a plain link click — it needs
// TricorderBar.app to handle the URL and write to NSPasteboard. "open" stays a
// bare file:// link (works with no app installed); "copy"/"both" route
// through the app.
const WORKTREE_SCHEME = "tricorder://worktree?path=";
function worktreeLink(path: string, text: string, mode: WorktreeClickMode): string {
  if (mode === "open") return openLink(path, text);
  return osc8(WORKTREE_SCHEME + encodeURIComponent(path) + "&mode=" + mode, text);
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
// The text as it looks on screen: colour codes and link wrappers removed.
export function plainText(s: string): string {
  return s.replace(OSC8_RE, "").replace(SGR_RE, "");
}
function visWidth(s: string): number {
  const clean = plainText(s);
  return [...clean].reduce((w, ch) => w + charWidth(ch), 0);
}

// ---- icons -----------------------------------------------------------------

const ICON_MUTED = "🔇";
const ICON_TREE = "🌳";
const ICON_MAP = "🗺️";
const ICON_CTX = "🔋";
const ICON_ROBOT = "🤖";
const ICON_MONEY = "💰";
const ICON_REMOTE = "📡";
const SEP = " · ";
const MARGIN = 1;
// Columns kept empty at the right edge when the account email is shown: the terminal
// and Claude Code's own padding can clip the last few characters of a right-aligned
// label, which cut off the email in practice.
const RIGHT_MARGIN = 6;
const RIGHT_SEP = "  ";
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

// ---- usage limits (5h / 7d) with pace ---------------------------------------

// "(reset in 42m)": the time until the limit resets, when the setting says this band shows it.
// `remainingS` is null when Claude Code sent no reset time: then there is nothing to show.
function resetNote(remainingS: number | null, band: PaceBand | null, pace: PaceConfig): string | null {
  return remainingS !== null && remainingS > 0 && showsResetNote(band, pace.resetNoteFrom) ? "(reset in " + formatRemaining(remainingS) + ")" : null;
}

// The parts that are present, joined by one space.
const present = (parts: readonly (string | null)[]): string => parts.filter((s): s is string => s !== null).join(" ");

// "5h 🐕 37%": the label, an animal for the pace, and the percent used in the
// pace colour. Without a usable pace (window unknown or just started) only the
// label and percent. Nothing when Claude Code sent no number for the limit.
// For a Hot or used-up limit, "(reset in 42m)" follows in the same colour.
function usageSegment(label: string, win: RateWindow | undefined, windowS: number, nowS: number, pace: PaceConfig): string | null {
  const used = win?.used_percentage;
  if (typeof used !== "number") return null;
  const pct = Math.round(used) + "%";
  const resets = win?.resets_at;
  const band = limitBand(used, typeof resets === "number" ? elapsedPct(resets, nowS, windowS) : null, pace);
  const note = resetNote(typeof resets === "number" ? resets - nowS : null, band, pace);
  if (band === null) return present([label + " " + pct, note]);
  const style = PACE_STYLES[band];
  return label + " " + style.icon + " " + present([pct, note].map((s) => (s === null ? null : sgr(style.color, s))));
}

// ---- monthly spend (pay per use) ---------------------------------------------

// 62 → "$62", 62.4 → "$62.40": whole dollars without cents, otherwise two decimals.
const CENT_DIGITS = 2;
function usd(amount: number): string {
  return "$" + (Number.isInteger(amount) ? amount : amount.toFixed(CENT_DIGITS));
}

// "💰 $62/$200 🐕 31%": this month's spend, the budget, an animal for the pace
// and the share of the budget spent in the pace colour. With no budget only
// "💰 $62.40". Nothing when the payload carries no cost or there is no session
// to count it under. Showing it also adds the session's new cost to the month.
function spendSegment(session: string, cost: Cost | undefined, budgetUsd: number | null, pace: PaceConfig, nowMs: number): string | null {
  const costUsd = cost?.total_cost_usd;
  if (session === "" || typeof costUsd !== "number") return null;
  recordCost(SPEND_DIR, session, costUsd, nowMs, log);
  const spent = monthSpendUsd(SPEND_DIR, nowMs, log);
  if (budgetUsd === null) return ICON_MONEY + " " + usd(spent);
  const usedPct = (spent / budgetUsd) * PCT_MAX;
  const label = ICON_MONEY + " " + usd(spent) + "/" + usd(budgetUsd);
  const band = budgetBand(usedPct, monthElapsedPct(nowMs), pace);
  if (band === null) return label + " " + Math.round(usedPct) + "%";
  const style = PACE_STYLES[band];
  return label + " " + style.icon + " " + sgr(style.color, Math.round(usedPct) + "%");
}

// Claude Code sends a cost on every account, a notional one on subscriptions, so
// the payload alone cannot say whether "spend" makes sense. It is shown for
// pay-per-use accounts. If the account type could not be detected, it is shown
// only when the payload has no usage limits (subscriptions have them).
function spendApplies(cfg: Config, p: Payload): boolean {
  // Usage limits in the payload only ever come with a subscription, so the answer is
  // known without reading the account file (which can be large) on every redraw.
  if (cfg.statusline.mode === AUTO && p.rate_limits !== undefined) return false;
  const type = resolveType(cfg.statusline.mode, detectAccount().type);
  return type === PAYG || (type === UNKNOWN && p.rate_limits === undefined);
}

// ---- location (worktree / branch) + PR matching -----------------------------

// Claude Code only sends `worktree` / `workspace.git_worktree` inside a
// worktree session — a plain repo carries neither, and the current branch is
// never in the payload at all. `isWorktree` distinguishes the two so line 1 can
// choose "🌳 branch" vs "dir(branch)".
interface Location {
  readonly path: string;
  readonly branch: string | null;
  readonly isWorktree: boolean;
}

function resolveLocation(p: Payload, session: string): Location {
  const wt = p.worktree;
  const path = wt?.path ?? p.workspace?.current_dir ?? p.cwd ?? "";
  if (path === "") return { path, branch: null, isWorktree: false };
  const gitWorktree = p.workspace?.git_worktree;
  if (wt !== undefined || gitWorktree !== undefined) {
    const branch = wt?.branch ?? wt?.name ?? gitWorktree ?? (basename(path) || path);
    if (session !== "") addWorktree(session, { path, branch });
    return { path, branch, isWorktree: true };
  }
  return { path, branch: currentBranch(path), isWorktree: false };
}

// Every session PR opened from `branch`, rendered as clickable "(#11)" tags —
// a branch can carry more than one (e.g. stacked follow-ups).
function prSuffix(session: string, branch: string | null): string {
  if (session === "" || branch === null) return "";
  return prsForBranch(session, branch)
    .map((pr) => " " + osc8(pr.url, sgr(CYAN, "(" + (pr.number === null ? "PR" : "#" + pr.number) + ")")))
    .join("");
}

// ---- segments --------------------------------------------------------------

interface LocationOptions {
  readonly mode: WorktreeClickMode;
  readonly showPrs: boolean;
  // The folder has uncommitted changes: a yellow "*" goes after the branch.
  readonly dirty: boolean;
}

function locationSegment(loc: Location, session: string, opts: LocationOptions): string | null {
  if (loc.path === "") return null;
  const { mode, showPrs } = opts;
  const mark = opts.dirty ? sgr(YELLOW, "*") : "";
  const prs = (branch: string | null): string => (showPrs ? prSuffix(session, branch) : "");
  if (loc.isWorktree) {
    const label = loc.branch ?? (basename(loc.path) || loc.path);
    return worktreeLink(loc.path, ICON_TREE + " " + label + mark, mode) + prs(loc.branch);
  }
  if (loc.branch !== null) {
    const label = (basename(loc.path) || loc.path) + "(" + loc.branch + mark + ")";
    return worktreeLink(loc.path, label, mode) + prs(loc.branch);
  }
  // Non-git directory: today's fallback, no branch to show.
  return worktreeLink(loc.path, ICON_TREE + " " + (basename(loc.path) || loc.path), mode);
}

function terminalWidth(): number {
  return Number(process.env.COLUMNS) || (process.stdout.columns ?? 0);
}

// Each field can be switched off in the config (statusline.fields, see src/fields.ts).
function line1(p: Payload, session: string, loc: Location, cfg: Config): string {
  const on = cfg.statusline.fields;
  // git is only asked when the field is on, so switching it off also saves the call.
  const dirty = on.location && on.dirty && Boolean(loc.path) && isDirty(loc.path) === true;
  const nowMs = Date.now();
  const nowS = nowMs / MS_PER_S;
  const mid = [
    on.location ? locationSegment(loc, session, { mode: cfg.worktreeClick, showPrs: on.prs, dirty }) : null,
    on.context ? contextSegment(p.context_window) : null,
    on.model ? (p.model?.display_name ?? null) : null,
    on.usage5h ? usageSegment("5h", p.rate_limits?.five_hour, FIVE_HOUR_WINDOW_S, nowS, cfg.statusline.pace) : null,
    on.usage7d ? usageSegment("7d", p.rate_limits?.seven_day, SEVEN_DAY_WINDOW_S, nowS, cfg.statusline.pace) : null,
    on.spend && spendApplies(cfg, p) ? spendSegment(session, p.cost, cfg.statusline.budget.monthlyUsd, cfg.statusline.pace, nowMs) : null,
    on.remote && remoteActive(session) ? ICON_REMOTE + " remote" : null,
  ]
    .filter((s): s is string => s !== null && s !== "")
    .join(SEP);
  // Passive mute indicator only (audio control lives in the menu-bar app now).
  const showMute = cfg.muted && on.muteIcon;
  const left = showMute ? [ICON_MUTED, mid].filter(Boolean).join(" ") : mid;
  const plan = !session || !on.plan ? null : getPlan(session);
  const email = on.account ? readAccountEmail() : null;
  const rightParts = [plan === null ? null : openLink(plan, ICON_MAP + " " + sgr(DIM, "plan")), email === null ? null : sgr(DIM, email)].filter(
    (s): s is string => s !== null,
  );
  if (!rightParts.length) return left;
  const right = rightParts.join(RIGHT_SEP);
  const width = terminalWidth();
  const edge = email === null ? MARGIN : RIGHT_MARGIN;
  const gap = width > 0 ? Math.max(MARGIN, width - visWidth(left) - visWidth(right) - edge) : MARGIN;
  return left + " ".repeat(gap) + right;
}

// The other worktrees this session has entered (the current one is already on
// line 1), each a clickable link with its matched PR(s) inline. Only appears
// once the session has actually switched — never a repo-wide worktree list.
// Excluded by branch, not path — a symlinked path (macOS /tmp vs /private/tmp)
// can make the same worktree look like two different paths.
function worktreeLine(session: string, loc: Location, cfg: Config): string | null {
  const others = readWorktrees(session).filter((w) => w.branch !== loc.branch);
  if (!others.length) return null;
  const showPrs = cfg.statusline.fields.prs;
  return others
    .map((w) => worktreeLink(w.path, w.branch, cfg.worktreeClick) + (showPrs ? prSuffix(session, w.branch) : ""))
    .join("  ");
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
  const loc = resolveLocation(payload, session);
  if (hasSession) {
    // Stash label + iTerm session id for the menu-bar app.
    setLabel(session, loc.branch ?? (basename(loc.path) || session));
    const iterm = process.env.ITERM_SESSION_ID;
    if (iterm !== undefined && iterm !== "") setItermId(session, iterm);
  }
  const cfg = loadConfig();
  const on = cfg.statusline.fields;
  if (hasSession && on.intro) {
    const el = introElapsed(session);
    if (el < ANIM_MS) {
      process.stdout.write(introFrame(el) + "\n");
      return;
    }
  }
  const lines = [
    line1(payload, session, loc, cfg),
    hasSession && on.worktrees ? worktreeLine(session, loc, cfg) : null,
    hasSession && on.subagents ? subagentLine(session) : null,
  ].filter((l): l is string => l !== null && l !== "");
  process.stdout.write(lines.join("\n") + "\n");
}
