import { loadConfig, saveConfig, serialize } from "./config";
import { log } from "./log";

// `tricorder budget` — the monthly budget for pay-per-use accounts, in US
// dollars (Claude Code reports cost in USD). It is not a limit: it only sets
// the yardstick for the spend field's pace and the Over band.
//
//   tricorder budget              prints the current budget
//   tricorder budget 200          sets $200 a month ("$200" works too)
//   tricorder budget off          removes it (only the month's spend is shown)
//   tricorder budget questions    prints the setup question, ready for the question tool

const OFF = "off";
const QUESTIONS = "questions";
const OFF_WORDS: readonly string[] = [OFF, "none", "no"];

// The ready-made choices of the setup question. Anything else: the user picks
// "Other" and types an amount. Values are what `tricorder budget <value>` takes.
const PRESETS = [
  { label: "$50 / month", value: "50" },
  { label: "$100 / month", value: "100" },
  { label: "$200 / month", value: "200" },
  { label: "No budget", value: OFF },
] as const;

// "200", "$200", "$ 1,200.50" → 200, 200, 1200.5. Anything that is not a
// positive number → null.
// https://regex101.com/?flavor=javascript&regex=%5B%24%2C%5Cs%5D&flags=g&testString=%24%201%2C200.50
const AMOUNT_NOISE = /[$,\s]/g;
export function parseAmount(text: string): number | null {
  const n = Number(text.replace(AMOUNT_NOISE, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// What the user typed, decided once: a budget to set, "no budget", or something
// unusable. Three outcomes, so "no budget" can never be mistaken for a typo.
export type BudgetChoice =
  | { readonly kind: "amount"; readonly usd: number }
  | { readonly kind: "off" }
  | { readonly kind: "invalid" };

export function parseChoice(text: string): BudgetChoice {
  if (OFF_WORDS.includes(text.toLowerCase())) return { kind: "off" };
  const usd = parseAmount(text);
  return usd === null ? { kind: "invalid" } : { kind: "amount", usd };
}

function describe(monthlyUsd: number | null): string {
  return monthlyUsd === null ? "no budget" : "$" + monthlyUsd + " a month";
}

export function budgetQuestions(): void {
  const question = {
    question:
      "What is your monthly budget for Claude usage, in US dollars? It is not a limit: it only sets how fast spending counts as too fast. Choose Other to type a different amount.",
    header: "Budget",
    multiSelect: false,
    options: PRESETS.map((p) => ({
      label: p.label,
      description: p.value === OFF ? "Show only what has been spent this month." : "Compare spending with $" + p.value + " a month.",
    })),
  };
  const values = Object.fromEntries(PRESETS.map((p) => [p.label, p.value]));
  process.stdout.write(serialize({ question, values }));
}

export function budget(arg: string | undefined): void {
  const cfg = loadConfig();
  if (arg === undefined) {
    process.stdout.write(describe(cfg.statusline.budget.monthlyUsd) + "\n");
    return;
  }
  if (arg === QUESTIONS) return budgetQuestions();
  const choice = parseChoice(arg);
  if (choice.kind === "invalid") {
    process.stderr.write("tricorder: budget must be a positive number of dollars, or 'off'\n");
    process.exitCode = 1;
    return;
  }
  const monthlyUsd = choice.kind === "amount" ? choice.usd : null;
  saveConfig({ ...cfg, statusline: { ...cfg.statusline, budget: { monthlyUsd } } });
  log("budget → " + describe(monthlyUsd));
  process.stdout.write(describe(monthlyUsd) + "\n");
}
