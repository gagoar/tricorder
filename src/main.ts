import { readStdin } from "./stdin";
import { renderStatusline } from "./statusline";
import { capture } from "./capture";
import { playSound } from "./sound";
import { mute } from "./mute";
import { warp } from "./warp";
import { showLogs } from "./log";
import { ack, soundEnable, status } from "./status";

const CMD_INDEX = 2;
const ARG_INDEX = 3;
const ARG2_INDEX = 4;
const EXIT_ERR = 1;

const COMMANDS: Readonly<Record<string, () => void>> = {
  statusline: () => renderStatusline(readStdin()),
  capture: () => capture(readStdin()),
  sound: () => playSound(process.argv[ARG_INDEX]),
  mute: () => mute(process.argv[ARG_INDEX]),
  warp: () => warp(),
  logs: () => showLogs(process.argv[ARG_INDEX]),
  status: () => status(),
  ack: () => ack(process.argv[ARG_INDEX]),
  "sound-enable": () => soundEnable(process.argv[ARG_INDEX], process.argv[ARG2_INDEX]),
};

function main(): void {
  const cmd = process.argv[CMD_INDEX] ?? "";
  const run = COMMANDS[cmd];
  if (run === undefined) {
    process.stderr.write("tricorder: unknown command '" + cmd + "'\n");
    process.exit(EXIT_ERR);
  }
  try {
    run();
  } catch (err) {
    // Never crash the status line or a hook; surface to stderr only.
    process.stderr.write("tricorder: " + String(err) + "\n");
  }
}

main();
