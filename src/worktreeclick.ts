import { isWorktreeClickMode, loadConfig, saveConfig } from "./config";
import { log } from "./log";

// `tricorder worktree-click <open|copy|both>` — sets what clicking the
// worktree link in the statusline does. Written by setup.sh and the
// menu-bar app's "Worktree Link" submenu.
export function worktreeClick(arg: string | undefined): void {
  const mode = (arg ?? "").toLowerCase();
  if (!isWorktreeClickMode(mode)) {
    log("worktree-click " + (arg ?? "?") + " → invalid mode");
    return;
  }
  const cfg = loadConfig();
  saveConfig({ ...cfg, worktreeClick: mode });
  log("worktree-click → " + mode);
  process.stdout.write(mode + "\n");
}
