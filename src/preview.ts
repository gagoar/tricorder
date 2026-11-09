import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { detectAccount, resolveType } from "./account";
import { loadConfig, serialize } from "./config";
import { FIVE_HOUR_WINDOW_S, MS_PER_S, PCT_MAX, resetsAtS, SEVEN_DAY_WINDOW_S } from "./pace";
import { AUTO, fieldsFor, FIELDS, PAYG, UNKNOWN } from "./fields";
import { addPR, addSubagent, addWorktree, setPlan } from "./state";
import { monthElapsedPct } from "./spend";
import { plainText, renderStatusline } from "./statusline";

// `tricorder fields preview` shows what the statusline looks like with the
// fields you have switched on. It runs the real statusline code on a made-up
// session, so what you see here is what you get, with nothing to keep in sync.
// Everything happens in a throwaway home folder: your own config and session
// state are only read, never written.

// Name of the internal sub-command `fields preview` runs inside the throwaway home.
export const PREVIEW_RENDER = "preview-render";
const SESSION = "preview";
const EXAMPLE_DIR_NAME = "example"; // inside the throwaway home folder
const EXAMPLE_PR_URL = "https://example.invalid/pull/";
const CURRENT_BRANCH = "fix-login";
const OTHER_BRANCH = "add-tests";
const CURRENT_PR_NUMBER = 12;
const OTHER_PR_NUMBER = 13;
const CONTEXT_USED_PCT = 42;
const MODEL_NAME = "Opus 5.5";
const PREVIEW_COLUMNS = "120"; // width the plan link is pushed to the right edge of
const RENDER_TIMEOUT_MS = 10_000;
// Made-up usage so both limits show a pace: 5h is 40% gone with 37% used (3 points
// under an even pace: On track); 7d is 50% gone with 12% used (38 under: Chill).
const FIVE_HOUR_USED_PCT = 37;
const FIVE_HOUR_ELAPSED_PCT = 40;
const SEVEN_DAY_USED_PCT = 12;
const SEVEN_DAY_ELAPSED_PCT = 50;
// Pay per use: an example budget, and a made-up spend that is exactly an even pace
// through the month (so the animal is On track; in the first few percent of a month
// the grey sloth shows instead, because it is too early to tell).
const EXAMPLE_BUDGET_USD = 200;
const EXAMPLE_EMAIL = "you@example.com"; // a reserved example address, never a real one
const CENTS_PER_USD = 100;

// Where the made-up folders live: inside the throwaway home, never a real path.
const exampleDir = (): string => join(homedir(), EXAMPLE_DIR_NAME);

// A real, empty git folder with one new file, so the uncommitted-changes mark
// has something to find. If git is missing the mark is simply not shown.
function makeDirtyFolder(path: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "notes.txt"), "not committed yet\n");
  try {
    execFileSync("git", ["init", "-q"], { cwd: path, stdio: "ignore", env: { PATH: process.env.PATH ?? "", HOME: homedir() } });
  } catch {
    // no git: the preview just has no mark
  }
}

// Claude Code's own record for a session with Remote Control on, in the throwaway home:
// this process stands in for the running Claude Code process.
function seedRemoteControl(): void {
  const dir = join(homedir(), ".claude", "sessions");
  mkdirSync(dir, { recursive: true });
  const record = { pid: process.pid, sessionId: SESSION, bridgeSessionId: "example", updatedAt: Date.now() };
  writeFileSync(join(dir, process.pid + ".json"), JSON.stringify(record));
}

// The made-up session: one branch with a PR and uncommitted changes, one other
// worktree with a PR, two running sub-agents and a plan file.
function seedSession(): void {
  addPR(SESSION, { number: CURRENT_PR_NUMBER, url: EXAMPLE_PR_URL + CURRENT_PR_NUMBER, branch: CURRENT_BRANCH });
  addPR(SESSION, { number: OTHER_PR_NUMBER, url: EXAMPLE_PR_URL + OTHER_PR_NUMBER, branch: OTHER_BRANCH });
  addWorktree(SESSION, { path: join(exampleDir(), OTHER_BRANCH), branch: OTHER_BRANCH });
  addSubagent(SESSION, "a", { type: "Explore", desc: "", model: "Opus 4.8", startedAt: 0 });
  addSubagent(SESSION, "b", { type: "review", desc: "", model: "Sonnet 5", startedAt: 0 });
  setPlan(SESSION, join(exampleDir(), "plan.md"));
  seedRemoteControl();
}

// What this month would have cost at an even pace through the budget, to the cent.
function evenPaceSpendUsd(): number {
  const spent = (EXAMPLE_BUDGET_USD * monthElapsedPct(Date.now())) / PCT_MAX;
  return Math.round(spent * CENTS_PER_USD) / CENTS_PER_USD;
}

// Runs inside the throwaway home (see previewFields): seeds the session and
// draws the statusline once. The parent put the account type in the config's
// `mode`: pay per use sends a cost and no usage limits, anything else sends the
// usage limits and no cost, like Claude Code does.
export function renderPreviewSession(): void {
  seedSession();
  const path = join(exampleDir(), CURRENT_BRANCH);
  makeDirtyFolder(path);
  const payg = loadConfig().statusline.mode === PAYG;
  renderStatusline(
    JSON.stringify({
      session_id: SESSION,
      cwd: path,
      worktree: { path, name: CURRENT_BRANCH, branch: CURRENT_BRANCH },
      model: { display_name: MODEL_NAME },
      context_window: { used_percentage: CONTEXT_USED_PCT },
      ...(payg
        ? { cost: { total_cost_usd: evenPaceSpendUsd() } }
        : {
            rate_limits: {
              five_hour: { used_percentage: FIVE_HOUR_USED_PCT, resets_at: resetsAtS(FIVE_HOUR_ELAPSED_PCT, Date.now() / MS_PER_S, FIVE_HOUR_WINDOW_S) },
              seven_day: { used_percentage: SEVEN_DAY_USED_PCT, resets_at: resetsAtS(SEVEN_DAY_ELAPSED_PCT, Date.now() / MS_PER_S, SEVEN_DAY_WINDOW_S) },
            },
          }),
    }),
  );
}

export function previewFields(): void {
  const cfg = loadConfig();
  const home = mkdtempSync(join(tmpdir(), "tricorder-preview-"));
  try {
    const dir = join(home, ".claude", "tricorder");
    mkdirSync(dir, { recursive: true });
    // Muted, so the mute icon can show. Animation off, because for the first
    // seconds of a session it replaces the whole line. Fields that do not apply to
    // this account type are off, as they are on the real statusline.
    const type = resolveType(cfg.statusline.mode, detectAccount().type);
    const applies = new Set<string>(fieldsFor(type).map((f) => f.id));
    const fields = Object.fromEntries(Object.entries(cfg.statusline.fields).map(([id, on]) => [id, on && applies.has(id)]));
    const statusline = {
      ...cfg.statusline,
      fields: { ...fields, intro: false },
      mode: type === UNKNOWN ? AUTO : type,
      budget: { monthlyUsd: EXAMPLE_BUDGET_USD },
    };
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: EXAMPLE_EMAIL } }));
    writeFileSync(join(dir, "config.json"), serialize({ ...cfg, muted: true, statusline }));
    const script = process.argv[1];
    if (!script) throw new Error("tricorder: cannot preview, the path of this program is unknown");
    const drawn = execFileSync(process.execPath, [script, "fields", PREVIEW_RENDER], {
      env: { PATH: process.env.PATH ?? "", HOME: home, COLUMNS: PREVIEW_COLUMNS },
      encoding: "utf8",
      timeout: RENDER_TIMEOUT_MS,
    });
    const intro = FIELDS.find((f) => f.id === "intro");
    const introNote = cfg.statusline.fields.intro && intro ? [intro.sample + "   (crosses the line for the first seconds of a session)"] : [];
    const spendNote = type === PAYG && fields.spend ? [`💰 uses an example budget of $${EXAMPLE_BUDGET_USD}. Set yours with: tricorder budget <dollars>`] : [];
    const note = [...introNote, ...spendNote];
    process.stdout.write([plainText(drawn).trimEnd(), ...note].join("\n") + "\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
