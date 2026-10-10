import { Buffer } from "node:buffer";
import { basename } from "node:path";
import {
  addPR,
  addSubagent,
  addWorktree,
  debugDump,
  getModel,
  getPlan,
  listSubagents,
  readPRs,
  removeSession,
  removeSubagent,
  setAttention,
  setCwd,
  setItermId,
  setLabelIfAbsent,
  setPlan,
  type PR,
} from "./state";
import { currentBranch, worktreeList } from "./git";
import { publish } from "./iterm";
import { log } from "./log";

interface HookInput {
  readonly hook_event_name?: string;
  readonly session_id?: string;
  readonly cwd?: string;
  readonly tool_name?: string;
  readonly tool_use_id?: string;
  readonly tool_input?: Readonly<Record<string, unknown>>;
  readonly tool_response?: unknown;
  readonly agent_id?: string;
  readonly agent_type?: string;
  readonly model?: string;
  readonly description?: string;
}

const DESC_MAX = 60;
const LABEL_FALLBACK_LEN = 8;
const HASH_LEN = 24;
const PLAN_PATH_RE = /\/\.claude\/plans\/[^/]+\.md$/;
const PR_URL_RE = /https?:\/\/[^\s"']*\/pull\/\d+/;
const PR_NUM_RE = /\/pull\/(\d+)/;
const GH_PR_CREATE_RE = /\bgh\b[\s\S]*\bpr\b[\s\S]*\bcreate\b/;

const GH_PR_TOOL = "mcp__github__create_pull_request";
const ENTER_WORKTREE_TOOL = "EnterWorktree";
const ATTENTION_TOOLS: ReadonlySet<string> = new Set(["AskUserQuestion", "ExitPlanMode", "EnterPlanMode"]);
const NOOP_REACTIONS: ReadonlySet<string> = new Set([
  "ignored",
  "not a plan path",
  "bash, not a pr create",
  "no pr url in response",
  "no worktree target",
]);

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
}

// One id per Agent call, shared by its PreToolUse and PostToolUse. Prefer the
// tool_use_id; fall back to a hash of type+description so both ends still match.
function subagentId(input: HookInput): string {
  if (input.tool_use_id) return input.tool_use_id;
  const ti = input.tool_input ?? {};
  const seed = str(ti.subagent_type) + "|" + str(ti.description);
  return "d_" + Buffer.from(seed).toString("hex").slice(0, HASH_LEN);
}

// Subagent lifecycle events bracket the real run (not just the launch), so they
// track background and parallel agents correctly. SubagentStart carries no model
// or description, so fall back to the session model the sub-agent inherits.
function handleSubagentStart(session: string, input: HookInput): string {
  const id = input.agent_id ?? subagentId(input);
  const type = str(input.agent_type) || "agent";
  const model = str(input.model) || getModel(session) || "default";
  addSubagent(session, id, {
    type,
    desc: (str(input.description) || str(input.tool_input?.description)).slice(0, DESC_MAX),
    model,
    startedAt: Date.now(),
  });
  return "track " + type + " · " + model;
}

function handleSubagentEnd(session: string, input: HookInput): string {
  const id = input.agent_id ?? subagentId(input);
  removeSubagent(session, id);
  return "untrack " + id;
}

function responseText(resp: unknown): string {
  if (resp === undefined || resp === null) return "";
  if (typeof resp === "string") return resp;
  try {
    return JSON.stringify(resp);
  } catch {
    return String(resp);
  }
}

function extractPR(text: string): PR | null {
  const url = text.match(PR_URL_RE)?.[0];
  if (url === undefined) return null;
  const num = url.match(PR_NUM_RE)?.[1];
  return { number: num === undefined ? null : Number(num), url };
}

// The github MCP tool names the branch directly (`head`); a `gh`/bash PR
// create has to ask git for the branch it's currently on.
function branchForPR(input: HookInput): string | null {
  if (str(input.tool_name) === GH_PR_TOOL) {
    const head = str(input.tool_input?.head);
    return head === "" ? null : head;
  }
  return input.cwd ? currentBranch(input.cwd) : null;
}

function handlePR(session: string, input: HookInput): string {
  const tool = str(input.tool_name);
  if (tool === "Bash" && !GH_PR_CREATE_RE.test(str(input.tool_input?.command))) return "bash, not a pr create";
  const pr = extractPR(responseText(input.tool_response));
  if (pr === null) return "no pr url in response";
  const branch = branchForPR(input);
  addPR(session, branch === null ? pr : { ...pr, branch });
  return "pr " + pr.url;
}

// EnterWorktree switches the session into a worktree by `path` (existing) or
// `name` (newly created) — both relative, so resolve the exact absolute path
// and true branch via `git worktree list` rather than guessing a join. Only
// fires on this (infrequent) tool event, never per statusline render.
function handleEnterWorktree(session: string, input: HookInput): string {
  const target = str(input.tool_input?.path) || str(input.tool_input?.name);
  if (target === "" || !input.cwd) return "no worktree target";
  const name = basename(target);
  const entries = worktreeList(input.cwd);
  const match = entries.find((e) => e.branch === name || basename(e.path) === name);
  addWorktree(session, { path: match?.path ?? target, branch: match?.branch ?? name });
  return "worktree " + name;
}

function handlePlan(session: string, input: HookInput): string {
  const fp = str(input.tool_input?.file_path);
  if (!PLAN_PATH_RE.test(fp)) return "not a plan path";
  setPlan(session, fp);
  return "plan " + basename(fp);
}

function route(session: string, input: HookInput): string {
  const event = str(input.hook_event_name);
  const tool = str(input.tool_name);
  const isPrTool = tool === GH_PR_TOOL || tool === "Bash";

  if (event === "PreToolUse" && ATTENTION_TOOLS.has(tool)) {
    setAttention(session, "question");
    return "attention question";
  }
  if (event === "PermissionRequest") {
    setAttention(session, "security");
    return "attention security";
  }
  if (event === "Stop") {
    setAttention(session, "done");
    return "attention done";
  }
  if (event === "UserPromptSubmit") {
    setAttention(session, "working");
    return "attention working";
  }
  if (event === "SessionEnd") {
    removeSession(session);
    return "session removed";
  }
  // Any tool / sub-agent activity means the session is actively working — this
  // recovers a stale "done" and clears a question/security once it resumes.
  const isActivity =
    event === "PreToolUse" || event === "PostToolUse" || event === "SubagentStart" || event === "SubagentStop";
  if (isActivity) setAttention(session, "working");
  if (event === "SubagentStart") return handleSubagentStart(session, input);
  if (event === "SubagentStop") return handleSubagentEnd(session, input);
  if (event === "PostToolUse" && tool === ENTER_WORKTREE_TOOL) return handleEnterWorktree(session, input);
  if (event === "PostToolUse" && isPrTool) return handlePR(session, input);
  if (event === "PreToolUse" && (tool === "Write" || tool === "Edit")) return handlePlan(session, input);
  return "ignored";
}

function publishState(session: string): void {
  const prs = readPRs(session);
  const subs = listSubagents(session);
  const plan = getPlan(session);
  publish({
    tricorder_prs: prs.map((p) => (p.number === null ? "PR" : "#" + p.number)).join(" "),
    tricorder_subagents: subs.length === 0 ? "" : String(subs.length),
    tricorder_plan: plan === null ? "" : basename(plan),
  });
}

function parse(raw: string): HookInput | null {
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return null;
  }
}

export function capture(raw: string): void {
  const input = parse(raw);
  if (!input) return;
  if (process.env.TRICORDER_DEBUG !== undefined) {
    debugDump(str(input.hook_event_name) || "unknown", raw);
  }
  const session = input.session_id;
  if (session === undefined || session === "") return;
  if (str(input.hook_event_name) !== "SessionEnd") {
    const iterm = process.env.ITERM_SESSION_ID;
    if (iterm !== undefined && iterm !== "") setItermId(session, iterm);
    if (input.cwd !== undefined && input.cwd !== "") {
      setCwd(session, input.cwd);
      setLabelIfAbsent(session, basename(input.cwd) || session.slice(0, LABEL_FALLBACK_LEN));
    }
  }
  const reaction = route(session, input);
  if (!NOOP_REACTIONS.has(reaction)) {
    const tool = str(input.tool_name);
    log("capture " + str(input.hook_event_name) + (tool !== "" ? " [" + tool + "]" : "") + " → " + reaction);
  }
  publishState(session);
}
