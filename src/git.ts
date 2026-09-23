import { execFileSync } from "node:child_process";

// Statusline/hook git calls must never throw or hang — a git failure just
// means one segment falls back, not a broken render. Mirror src/iterm.ts's
// best-effort execFileSync pattern.
const GIT_TIMEOUT_MS = 500;
const BRANCH_PREFIX = "refs/heads/";

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
}

function run(args: readonly string[], cwd: string): string | null {
  try {
    return execFileSync("git", args as string[], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      env: gitEnv(),
    });
  } catch {
    return null;
  }
}

// Fallback for a plain repo whose statusline payload carries no `worktree` /
// `workspace.git_worktree` (Claude Code only sends those inside a worktree
// session). Empty result covers detached HEAD and non-git directories alike.
export function currentBranch(cwd: string): string | null {
  const out = run(["branch", "--show-current"], cwd);
  if (out === null) return null;
  const branch = out.trim();
  return branch === "" ? null : branch;
}

export interface WorktreeEntry {
  readonly path: string;
  readonly branch: string | null;
}

interface ParseState {
  readonly entries: readonly WorktreeEntry[];
  readonly path: string | null;
  readonly branch: string | null;
  readonly bare: boolean;
}

const EMPTY_STATE: ParseState = { entries: [], path: null, branch: null, bare: false };

// Closes out the block collected so far (a `worktree` line up to the next
// blank line / next `worktree` line), dropping bare-repo entries.
function flush(state: ParseState): ParseState {
  const entries =
    state.path !== null && !state.bare ? [...state.entries, { path: state.path, branch: state.branch }] : state.entries;
  return { entries, path: null, branch: null, bare: false };
}

function parseLine(state: ParseState, line: string): ParseState {
  if (line === "") return flush(state);
  if (line.startsWith("worktree ")) return { ...flush(state), path: line.slice("worktree ".length) };
  if (line.startsWith("branch ")) {
    const ref = line.slice("branch ".length);
    return { ...state, branch: ref.startsWith(BRANCH_PREFIX) ? ref.slice(BRANCH_PREFIX.length) : ref };
  }
  if (line === "bare") return { ...state, bare: true };
  return state;
}

// Only used from capture.ts on the (rare) EnterWorktree event, to resolve the
// exact absolute path + branch for a worktree Claude Code just switched into —
// never for statusline display, so a repo with dozens of worktrees costs
// nothing extra here (we just search the list for one match).
export function worktreeList(cwd: string): readonly WorktreeEntry[] {
  const out = run(["worktree", "list", "--porcelain"], cwd);
  if (out === null) return [];
  return flush(out.split("\n").reduce(parseLine, EMPTY_STATE)).entries;
}
