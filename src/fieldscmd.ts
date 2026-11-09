import { detectAccount, resolveType } from "./account";
import { loadConfig, saveConfig, serialize } from "./config";
import { buildFields, DETECTED_TYPES, FIELD_IDS, fieldsFor, isDetectedType, isFieldId, type DetectedType, type FieldId } from "./fields";
import { log } from "./log";
import { PREVIEW_RENDER, previewFields, renderPreviewSession } from "./preview";
import { ENABLE_ALL_LABEL, buildQuestionCalls } from "./questions";

const ALL = "all";

// The account type a command works on: the argument when given, else the detected
// one. null, with the error printed, when the argument is not a known type, so a
// typo is never silently replaced by a guess.
function accountTypeFor(arg: string | undefined): DetectedType | null {
  if (arg === undefined) return resolveType(loadConfig().statusline.mode, detectAccount().type);
  if (isDetectedType(arg)) return arg;
  process.stderr.write("tricorder: unknown account type: " + arg + "\nvalid: " + DETECTED_TYPES.join(", ") + "\n");
  process.exitCode = 1;
  return null;
}

// `tricorder detect` — prints what kind of account this is, as one line of JSON.
export function detect(): void {
  const cfg = loadConfig();
  const detected = detectAccount();
  const type = resolveType(cfg.statusline.mode, detected.type);
  process.stdout.write(JSON.stringify({ ...detected, type, mode: cfg.statusline.mode }) + "\n");
}

// `tricorder fields describe [subscription|payg|unknown]` — the fields that
// apply to an account type (default: the detected one), each with what it shows,
// a sample, its icon and colour meaning, and whether it is on now. JSON.
export function describeFields(typeArg: string | undefined): void {
  const type = accountTypeFor(typeArg);
  if (type === null) return;
  const cfg = loadConfig();
  const out = fieldsFor(type).map((f) => ({
    id: f.id,
    name: f.name,
    shows: f.shows,
    sample: f.sample,
    legend: f.legend,
    enabled: cfg.statusline.fields[f.id],
  }));
  process.stdout.write(serialize({ type, fields: out }));
}

// `tricorder fields questions [type]` — the exact questions /tricorder:setup
// asks, ready to pass to the question tool, plus which field each label means.
export function questionsFor(typeArg: string | undefined): void {
  const type = accountTypeFor(typeArg);
  if (type === null) return;
  const list = fieldsFor(type);
  const labels = Object.fromEntries(list.map((f) => [f.name, f.id]));
  process.stdout.write(serialize({ enableAllLabel: ENABLE_ALL_LABEL, labels, calls: buildQuestionCalls(list) }));
}

// Returns the ids to switch on, or the unknown ones. "all" means every field.
export function parseFieldList(arg: string): { readonly ids: readonly FieldId[]; readonly unknown: readonly string[] } {
  if (arg.trim().toLowerCase() === ALL) return { ids: FIELD_IDS, unknown: [] };
  const parts = arg
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return { ids: parts.filter(isFieldId), unknown: parts.filter((p) => !isFieldId(p)) };
}

// `tricorder fields set <id,id,...|all>` — exactly the listed fields are on,
// every other field is off. An empty list or an unknown id changes nothing.
export function setFields(arg: string | undefined): void {
  const { ids, unknown } = parseFieldList(arg ?? "");
  if (unknown.length) {
    process.stderr.write("tricorder: unknown field(s): " + unknown.join(", ") + "\nvalid: " + FIELD_IDS.join(", ") + "\n");
    process.exitCode = 1;
    return;
  }
  if (!ids.length) {
    process.stdout.write("no fields given; nothing changed\n");
    return;
  }
  const cfg = loadConfig();
  const fields = buildFields((id) => ids.includes(id));
  saveConfig({ ...cfg, statusline: { ...cfg.statusline, fields } });
  log("fields set → " + ids.join(","));
  process.stdout.write("on: " + ids.join(", ") + "\n");
}

type SubCommand = (arg: string | undefined) => void;

// One entry per `tricorder fields <name>`; adding a sub-command is adding a line here.
const SUBCOMMANDS = {
  describe: describeFields,
  questions: questionsFor,
  preview: () => previewFields(),
  [PREVIEW_RENDER]: () => renderPreviewSession(), // internal: `preview` runs it in a throwaway home
  set: setFields,
} as const satisfies Record<string, SubCommand>;

const USAGE = "usage: tricorder fields describe [type] | fields questions [type] | fields preview | fields set <id,id,...|all>\n";

// hasOwn, not `in`: "toString" must not count as a sub-command.
function isSubCommand(name: string | undefined): name is keyof typeof SUBCOMMANDS {
  return name !== undefined && Object.hasOwn(SUBCOMMANDS, name);
}

export function fields(sub: string | undefined, arg: string | undefined): void {
  if (isSubCommand(sub)) return SUBCOMMANDS[sub](arg);
  process.stderr.write(USAGE);
  process.exitCode = 1;
}
