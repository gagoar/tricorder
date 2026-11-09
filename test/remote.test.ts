import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIELD_IDS } from "../src/fields";
import { remoteFromRecords } from "../src/remote";
import { plain, run, sandbox, writeConfig } from "./helpers";

const SESSION = "s1";
const ALIVE = 100; // a process that is running
const DEAD = 200; // one that has ended
const OLDER = 1; // "updatedAt" of a record written earlier
const NEWER = 2; // and of one written later
const isAlive = (pid: number): boolean => pid === ALIVE;
const rec = (fields: Record<string, unknown>) => ({ sessionId: SESSION, pid: ALIVE, ...fields });

// Records as Claude Code writes them: bridgeSessionId is text while Remote Control is on, null otherwise.
const CASES = [
  { label: "a running session with Remote Control on", records: [rec({ bridgeSessionId: "abc" })], remote: true },
  { label: "a running session with Remote Control off (null)", records: [rec({ bridgeSessionId: null })], remote: false },
  { label: "an empty id", records: [rec({ bridgeSessionId: "" })], remote: false },
  { label: "a record of another session", records: [rec({ bridgeSessionId: "abc", sessionId: "other" })], remote: false },
  { label: "a left-behind record of a process that ended", records: [rec({ bridgeSessionId: "abc", pid: DEAD })], remote: false },
  { label: "a dead record with Remote Control and a running one without", records: [rec({ bridgeSessionId: "abc", pid: DEAD }), rec({ bridgeSessionId: null })], remote: false },
  { label: "two running records: the newer one (off) wins", records: [rec({ bridgeSessionId: "abc", updatedAt: OLDER }), rec({ bridgeSessionId: null, updatedAt: NEWER })], remote: false },
  { label: "two running records: the newer one (on) wins", records: [rec({ bridgeSessionId: null, updatedAt: OLDER }), rec({ bridgeSessionId: "abc", updatedAt: NEWER })], remote: true },
  { label: "junk entries are ignored", records: [null, 42, "x", rec({ bridgeSessionId: "abc" })], remote: true },
  { label: "no records at all", records: [], remote: false },
] as const;

CASES.forEach((c) => {
  test(`remoteFromRecords: ${c.label} → ${c.remote}`, () => {
    assert.equal(remoteFromRecords(c.records, SESSION, isAlive), c.remote);
  });
});

// ---- on the real statusline, with a session folder in a throwaway config dir

const only = (...ids: string[]): Record<string, boolean> => Object.fromEntries(FIELD_IDS.map((id) => [id, ids.includes(id)]));
const endedPid = (): number => spawnSync("node", ["-e", ""]).pid; // a process that has already ended

function shown(record: Record<string, unknown> | null, fields = only("remote")): string {
  const configDir = mkdtempSync(join(tmpdir(), "tricorder-remote-"));
  if (record !== null) {
    mkdirSync(join(configDir, "sessions"));
    writeFileSync(join(configDir, "sessions", `${record.pid}.json`), JSON.stringify(record));
  }
  const box = sandbox();
  writeConfig(box, { statusline: { fields } });
  const payload = { session_id: SESSION, cwd: "/" };
  return plain(run(box, ["statusline"], { stdin: JSON.stringify(payload), configDir }).stdout).trim();
}

const running = (bridgeSessionId: unknown) => ({ pid: process.pid, sessionId: SESSION, bridgeSessionId, updatedAt: Date.now() });

test("Remote Control on for this session shows the marker", () => {
  assert.equal(shown(running("abc")), "📡 remote");
});

test("Remote Control off, or no session folder at all, shows nothing", () => {
  assert.equal(shown(running(null)), "");
  assert.equal(shown(null), "");
});

test("a left-behind record of a process that has ended is ignored", () => {
  assert.equal(shown({ ...running("abc"), pid: endedPid() }), "");
});

test("with the field switched off nothing is shown", () => {
  assert.equal(shown(running("abc"), only("model")), "");
});
