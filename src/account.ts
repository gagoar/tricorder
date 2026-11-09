import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAYG, SUBSCRIPTION, UNKNOWN, AUTO, type AccountMode, type AccountType, type DetectedType } from "./fields";

// What kind of account this session runs under, so setup and the statusline
// can offer only the fields that make sense: a subscription has usage limits
// (5-hour, weekly); pay per use has spend.
//
// Claude Code does not send this to the statusline, so it is read from the
// account's own config file: $CLAUDE_CONFIG_DIR/.claude.json when that variable
// is set (one file per account), otherwise ~/.claude.json. The file is internal
// to Claude Code and not a documented interface, so every read is guarded and
// an unreadable file gives "unknown" instead of a guess.

export interface Detection {
  readonly type: DetectedType;
  // e.g. "claude_pro"; null when not a subscription or not known.
  readonly plan: string | null;
  // True when the subscription allows paid extra usage beyond its limits.
  readonly extraUsage: boolean;
}

export const UNKNOWN_ACCOUNT: Detection = { type: UNKNOWN, plan: null, extraUsage: false };

// One field of a parsed JSON value, or undefined when the value is not an object or lacks it.
// Cast: after the checks the value is an object, and `key in value` has confirmed the key.
export function readField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

// Pure: decides the type from the parsed contents of .claude.json.
// - An `oauthAccount` entry means signed in with a Claude account: subscription.
//   (Team and Enterprise seats are treated the same way.)
// - A readable file without one means an API key or cloud-provider login.
export function classify(parsed: unknown): Detection {
  if (typeof parsed !== "object" || parsed === null) return UNKNOWN_ACCOUNT;
  const oauth = readField(parsed, "oauthAccount");
  if (typeof oauth !== "object" || oauth === null) return { type: PAYG, plan: null, extraUsage: false };
  const plan = readField(oauth, "organizationType");
  return {
    type: SUBSCRIPTION,
    plan: typeof plan === "string" ? plan : null,
    extraUsage: readField(oauth, "hasExtraUsageEnabled") === true,
  };
}

export function accountFilePath(): string | null {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (dir) return join(dir, ".claude.json");
  const home = process.env.HOME;
  return home ? join(home, ".claude.json") : null;
}

// The parsed account file, read at most once per run (a statusline redraw needs
// both the account type and the email). null = missing or unreadable.
let accountFile: { readonly parsed: unknown } | undefined;
function readAccountFile(): unknown {
  if (accountFile === undefined) {
    const file = accountFilePath();
    try {
      accountFile = { parsed: file === null ? null : JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      accountFile = { parsed: null };
    }
  }
  return accountFile.parsed;
}

export function detectAccount(): Detection {
  return classify(readAccountFile());
}

// Pure: the sign-in email in the parsed .claude.json (`oauthAccount.emailAddress`),
// or null when there is none. Pay-per-use logins have no account entry, so no email.
export function emailOf(parsed: unknown): string | null {
  const email = readField(readField(parsed, "oauthAccount"), "emailAddress");
  return typeof email === "string" && email ? email : null;
}

export function readAccountEmail(): string | null {
  return emailOf(readAccountFile());
}

// The config can force the type; "auto" uses what was detected.
export function resolveType(mode: AccountMode, detected: DetectedType): DetectedType {
  return mode === AUTO ? detected : (mode satisfies AccountType);
}
