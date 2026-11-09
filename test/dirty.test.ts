import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plain, run, sandbox, writeConfig } from "./helpers";

// Only the location is left on, so the output is just "folder(branch)" with or
// without the mark.
const ONLY_LOCATION = { muteIcon: false, context: false, model: false };
const FOLDER = "proj";
const BRANCH = "main";
const CLEAN = `${FOLDER}(${BRANCH})`; // "proj(main)"
const MARKED = `${FOLDER}(${BRANCH}*)`; // "proj(main*)"
const IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", [...IDENTITY, ...args], { cwd, stdio: "ignore" });
}

// A folder called "proj" that is a git repository on branch "main", with nothing in it.
function repo(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "tricorder-git-")), FOLDER);
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", BRANCH);
  return dir;
}

function shown(dir: string, fields: Record<string, boolean> = {}): string {
  const box = sandbox();
  writeConfig(box, { statusline: { fields: { ...ONLY_LOCATION, ...fields } } });
  return plain(run(box, ["statusline"], { stdin: JSON.stringify({ cwd: dir }) }).stdout).trim();
}

test("a clean repository has no mark", () => {
  assert.equal(shown(repo()), CLEAN);
});

test("a new file that is not committed shows the mark", () => {
  const dir = repo();
  writeFileSync(join(dir, "a.txt"), "x");
  assert.equal(shown(dir), MARKED);
});

test("after committing it is clean again; editing the file brings the mark back", () => {
  const dir = repo();
  writeFileSync(join(dir, "a.txt"), "x");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "first");
  assert.equal(shown(dir), CLEAN);
  writeFileSync(join(dir, "a.txt"), "changed");
  assert.equal(shown(dir), MARKED);
});

test("with the field switched off there is no mark, even with changes", () => {
  const dir = repo();
  writeFileSync(join(dir, "a.txt"), "x");
  assert.equal(shown(dir, { dirty: false }), CLEAN);
});

test("a folder that is not a git repository never shows the mark", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "tricorder-plain-")), FOLDER);
  mkdirSync(dir);
  writeFileSync(join(dir, "a.txt"), "x");
  assert.equal(shown(dir), "🌳 proj");
});
