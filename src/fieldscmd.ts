import { loadConfig, saveConfig, serialize } from "./config";
import { buildFields, FIELD_IDS, FIELDS, isFieldId, type FieldId } from "./fields";
import { log } from "./log";

const ALL = "all";

// `tricorder fields describe` — every field with what it shows, a sample, what
// its icons and colours mean, and whether it is on now. JSON.
export function describeFields(): void {
  const cfg = loadConfig();
  const out = FIELDS.map((f) => ({
    id: f.id,
    name: f.name,
    shows: f.shows,
    sample: f.sample,
    legend: f.legend,
    enabled: cfg.statusline.fields[f.id],
  }));
  process.stdout.write(serialize({ fields: out }));
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
  saveConfig({ ...cfg, statusline: { fields } });
  log("fields set → " + ids.join(","));
  process.stdout.write("on: " + ids.join(", ") + "\n");
}

type SubCommand = (arg: string | undefined) => void;

// One entry per `tricorder fields <name>`; adding a sub-command is adding a line here.
const SUBCOMMANDS = {
  describe: () => describeFields(),
  set: setFields,
} as const satisfies Record<string, SubCommand>;

const USAGE = "usage: tricorder fields describe | fields set <id,id,...|all>\n";

// hasOwn, not `in`: "toString" must not count as a sub-command.
function isSubCommand(name: string | undefined): name is keyof typeof SUBCOMMANDS {
  return name !== undefined && Object.hasOwn(SUBCOMMANDS, name);
}

export function fields(sub: string | undefined, arg: string | undefined): void {
  if (isSubCommand(sub)) return SUBCOMMANDS[sub](arg);
  process.stderr.write(USAGE);
  process.exitCode = 1;
}
