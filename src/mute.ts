import { loadConfig, saveConfig } from "./config";
import { setVar } from "./iterm";
import { log } from "./log";

const MUTED_VAR = "tricorder_muted";
const MUTED_ON = "1";
const MUTED_OFF = "0";

type MuteArg = "on" | "off" | "toggle";

const MUTE_ACTIONS: Record<MuteArg, (current: boolean) => boolean> = {
  on: () => true,
  off: () => false,
  toggle: (current) => !current,
};

function nextMuted(current: boolean, arg: string | undefined): boolean {
  const key = (arg ?? "toggle").toLowerCase();
  const action = MUTE_ACTIONS[key as MuteArg] ?? MUTE_ACTIONS.toggle;
  return action(current);
}

export function mute(arg: string | undefined): void {
  const cfg = loadConfig();
  const muted = nextMuted(cfg.muted, arg);
  saveConfig({ ...cfg, muted });
  setVar(MUTED_VAR, muted ? MUTED_ON : MUTED_OFF);
  log("mute " + (arg ?? "toggle") + " → " + (muted ? "muted" : "unmuted"));
  process.stdout.write(muted ? "muted\n" : "unmuted\n");
}
