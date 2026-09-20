import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, ensureDir } from "./config";

export const LOG_PATH = join(DATA_DIR, "tricorder.log");

const TAIL_DEFAULT = 40;
const MAX_LOG_BYTES = 524288;
const KEEP_LINES = 2000;

function stamp(): string {
  return new Date().toISOString();
}

// Append one timestamped line. Rotates by keeping the tail when it grows large.
// Never throws — logging must not break a hook or the statusline.
export function log(line: string): void {
  try {
    ensureDir(DATA_DIR);
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_LOG_BYTES) {
      const kept = readFileSync(LOG_PATH, "utf8").split("\n").slice(-KEEP_LINES).join("\n");
      writeFileSync(LOG_PATH, kept);
    }
    appendFileSync(LOG_PATH, stamp() + " " + line + "\n");
  } catch {
    // ignore
  }
}

export function showLogs(arg: string | undefined): void {
  if (arg === "clear") {
    try {
      writeFileSync(LOG_PATH, "");
    } catch {
      // ignore
    }
    process.stdout.write("cleared " + LOG_PATH + "\n");
    return;
  }
  const n = Number(arg) || TAIL_DEFAULT;
  try {
    const lines = readFileSync(LOG_PATH, "utf8").split("\n").filter((l) => l !== "");
    process.stdout.write(lines.slice(-n).join("\n") + "\n");
  } catch {
    process.stdout.write("(no log yet at " + LOG_PATH + ")\n");
  }
}
