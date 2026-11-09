import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end helper: runs the built CLI (build/tricorder.cjs) with its own
// throwaway HOME, so a test never reads or writes the real ~/.claude.
const CLI = join(__dirname, "..", "tricorder.cjs");

export interface Sandbox {
  readonly home: string;
  readonly configFile: string;
}

export function sandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "tricorder-test-"));
  return { home, configFile: join(home, ".claude", "tricorder", "config.json") };
}

export function writeConfig(box: Sandbox, config: unknown): void {
  mkdirSync(join(box.home, ".claude", "tricorder"), { recursive: true });
  writeFileSync(box.configFile, JSON.stringify(config));
}

export function readConfig(box: Sandbox): { statusline: { fields: Record<string, boolean> } } {
  return JSON.parse(readFileSync(box.configFile, "utf8"));
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

export function run(box: Sandbox, args: readonly string[], opts: { stdin?: string } = {}): RunResult {
  const env = { PATH: process.env.PATH ?? "", HOME: box.home };
  const r = spawnSync("node", [CLI, ...args], { env, input: opts.stdin ?? "", encoding: "utf8" });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// Matches a link escape: "\x1b]8;;file:///a\x07" matches; the plain text "file:///a" does not.
// https://regex101.com/?flavor=javascript&regex=%5Cx1b%5C%5D8%3B%3B%5B%5E%5Cx07%5D%2A%5Cx07&flags=g&testString=%1B%5D8%3B%3Bfile%3A%2F%2F%2Fa%07text%0Afile%3A%2F%2F%2Fa
const LINK_ESCAPE = /\x1b\]8;;[^\x07]*\x07/g;
// Matches a colour escape: "\x1b[32m" matches; "[32m" without the escape character does not.
// https://regex101.com/?flavor=javascript&regex=%5Cx1b%5C%5B%5B0-9%3B%5D%2Am&flags=g&testString=%1B%5B32mgreen%0A%5B32m
const COLOUR_ESCAPE = /\x1b\[[0-9;]*m/g;

// Colour and link escape codes removed, so tests compare the visible text.
export function plain(s: string): string {
  return s.replace(LINK_ESCAPE, "").replace(COLOUR_ESCAPE, "");
}
