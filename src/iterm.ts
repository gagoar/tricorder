import { execFileSync } from "node:child_process";

const IT2 = "/Applications/iTerm.app/Contents/Resources/utilities/it2";
const IT2_TIMEOUT_MS = 2000;
const VAR_PREFIX = "user.";
const NEXT_CHAR = 1;

// iTerm2 sets ITERM_SESSION_ID to "<pane>:<GUID>". it2 targets a session by GUID.
function sessionGuid(): string | null {
  const id = process.env.ITERM_SESSION_ID ?? process.env.TERM_SESSION_ID;
  if (!id) return null;
  const colon = id.lastIndexOf(":");
  return colon < 0 ? id : id.slice(colon + NEXT_CHAR);
}

export function setVar(name: string, value: string): void {
  const guid = sessionGuid();
  if (guid === null) return;
  try {
    execFileSync(
      IT2,
      ["session", "set-var", VAR_PREFIX + name, value, "--session", guid],
      { stdio: "ignore", timeout: IT2_TIMEOUT_MS },
    );
  } catch {
    // Best-effort mirror. Never block a hook on the iTerm2 status bar.
  }
}

export function publish(vars: Readonly<Record<string, string>>): void {
  Object.entries(vars).forEach(([name, value]) => {
    setVar(name, value);
  });
}
