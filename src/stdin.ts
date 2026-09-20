import { readFileSync } from "node:fs";

const STDIN_FD = 0;

// Read all of stdin synchronously from fd 0. Claude Code pipes the payload in,
// so the descriptor is readable to EOF. Keeps the whole binary synchronous.
export function readStdin(): string {
  try {
    return readFileSync(STDIN_FD, "utf8");
  } catch {
    return "";
  }
}
