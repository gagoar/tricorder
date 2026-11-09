// Builds the tick-box questions that /tricorder:setup asks, so the command
// does not have to assemble them by hand. The question tool (AskUserQuestion)
// accepts at most 4 options per question, at least 2, at most 4 questions per
// call, and every question needs its own text. Getting any of that wrong
// makes the whole call fail, so it is worked out here and tested.

export const ENABLE_ALL_LABEL = "Enable all";
const OPTIONS_PER_QUESTION = 4;
const QUESTIONS_PER_CALL = 4;
const MIN_OPTIONS = 2;
export const HEADER_MAX_CHARS = 12;

export interface QuestionField {
  readonly id: string;
  readonly name: string;
  readonly shows: string;
}

export interface QuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface Question {
  readonly question: string;
  readonly header: string;
  readonly multiSelect: true;
  readonly options: readonly QuestionOption[];
}

// The first sentence of a longer text, used as the short description.
// "Shows a thing. More text." → "Shows a thing."
function firstSentence(text: string): string {
  const end = text.indexOf(". ");
  return end === -1 ? text : text.slice(0, end + 1);
}

// Cuts a list into pieces of `size`; the last piece may be shorter.
function pieces<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

// Splits the options into groups of 4. If the last group would hold a single
// option (the tool needs 2), one option moves over from the group before it.
export function chunk<T>(items: readonly T[]): readonly (readonly T[])[] {
  const groups = pieces(items, OPTIONS_PER_QUESTION);
  const lastIndex = groups.length - 1;
  const last = groups[lastIndex];
  const before = groups[lastIndex - 1];
  if (last === undefined || before === undefined || last.length >= MIN_OPTIONS) return groups;
  return [...groups.slice(0, lastIndex - 1), before.slice(0, -1), [...before.slice(-1), ...last]];
}

// Returns the questions grouped into calls of at most 4. Today one call is
// enough; a longer field list simply gives a second call.
export function buildQuestionCalls(fields: readonly QuestionField[]): readonly (readonly Question[])[] {
  const options: readonly QuestionOption[] = [
    { label: ENABLE_ALL_LABEL, description: "Turn on every field listed." },
    ...fields.map((f) => ({ label: f.name, description: firstSentence(f.shows) })),
  ];
  const groups = chunk(options);
  const questions: readonly Question[] = groups.map((group, i) => ({
    question: `Tick the fields you want to see (part ${i + 1} of ${groups.length}). Anything you leave unticked is turned off. Tick at least one; to start over, tick ${ENABLE_ALL_LABEL}.`,
    header: `Fields ${i + 1}`.slice(0, HEADER_MAX_CHARS),
    multiSelect: true,
    options: group,
  }));
  return pieces(questions, QUESTIONS_PER_CALL);
}
