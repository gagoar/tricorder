import { closeSync, openSync, writeSync } from "node:fs";
import { log } from "./log";

// Galaxy Class (USS Enterprise NCC-1701-D).
const SHIP: readonly string[] = [
  "                                                  ______",
  "                                     ___.--------'------`---------.____",
  "                               _.---'----------------------------------`---.__",
  "                             .'___=]===========================================",
  ",-----------------------..__/.'         >--.______        _______.---'",
  "]====================<==||(__)        .'          `------'",
  "`-----------------------`' ----.___--/",
  "     /       /---'                 `/",
  "    /_______(______________________/",
  "    `-------------.--------------.'",
  "                   \\________|_.-'",
];

const DEFAULT_WIDTH = 80;
const STEP = 3;
const FRAME_MS = 22;
const I32_BYTES = 4;
const STDOUT_FD = 1;

const ESC = "\x1b";
const HIDE_CURSOR = ESC + "[?25l";
const SHOW_CURSOR = ESC + "[?25h";
const CLEAR_LINE = ESC + "[2K";

// Synchronous sleep so the whole binary stays sync. The flyby runs as an async
// SessionStart hook in its own process, so blocking it is fine.
function sleep(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(I32_BYTES));
  Atomics.wait(shared, 0, 0, ms);
}

function termWidth(): number {
  return Number(process.env.COLUMNS) || DEFAULT_WIDTH;
}

function shiftLine(line: string, offset: number, cols: number): string {
  const s = offset >= 0 ? " ".repeat(offset) + line : line.slice(-offset);
  return s.slice(0, cols);
}

function up(rows: number): string {
  return ESC + "[" + rows + "A";
}

function frame(offset: number, cols: number, rows: number): string {
  const body = SHIP.map((line) => "\r" + CLEAR_LINE + shiftLine(line, offset, cols)).join("\n");
  return up(rows) + body + "\n";
}

export function warp(): void {
  log("warp → flyby");
  // TRICORDER_WARP_STDOUT=1 renders to stdout for testing outside a real tty.
  const useStdout = process.env.TRICORDER_WARP_STDOUT !== undefined;
  let fd: number;
  if (useStdout) {
    fd = STDOUT_FD;
  } else {
    try {
      fd = openSync("/dev/tty", "w");
    } catch {
      return; // no controlling terminal — skip silently
    }
  }
  const cols = termWidth();
  const rows = SHIP.length;
  const shipWidth = Math.max(...SHIP.map((line) => line.length));
  const frameCount = Math.ceil((cols + shipWidth) / STEP);
  const offsets = Array.from({ length: frameCount }, (_, i) => -shipWidth + i * STEP);
  try {
    writeSync(fd, HIDE_CURSOR + "\n".repeat(rows));
    offsets.forEach((offset) => {
      writeSync(fd, frame(offset, cols, rows));
      sleep(FRAME_MS);
    });
    const blanks = SHIP.map(() => "\r" + CLEAR_LINE).join("\n") + "\n";
    writeSync(fd, up(rows) + blanks + SHOW_CURSOR);
  } catch {
    // terminal went away mid-flight — nothing to recover
  } finally {
    if (!useStdout) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}
