import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuestionCalls, chunk, ENABLE_ALL_LABEL, HEADER_MAX_CHARS } from "../src/questions";

// n fields named F1..Fn
function fields(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, name: `F${i + 1}`, shows: `Shows ${i + 1}. More text.` }));
}
const sizes = (n: number) => buildQuestionCalls(fields(n)).flatMap((c) => c.map((q) => q.options.length));

// Hand count: "Enable all" is one option, so n fields make n + 1 options, cut
// into questions of 4. A last question with one option borrows one from the
// question before it, because the tool needs at least 2.
const LAYOUTS = [
  { fields: 9, options: 10, sizes: [4, 4, 2] },
  { fields: 8, options: 9, sizes: [4, 3, 2] },
  { fields: 3, options: 4, sizes: [4] },
  { fields: 1, options: 2, sizes: [2] },
] as const;
const MAX_FIELDS_TRIED = 40;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const FIELDS_IN_ONE_CALL = 15; // 4 questions x 4 options = 16 slots, minus "Enable all"
const CALLS_FOR_16_FIELDS = 2; // 17 options = 5 questions: 4 fill the first call, the 5th starts a second
const SAMPLE_PARTS = 3;

LAYOUTS.forEach((layout) => {
  test(`${layout.fields} fields + Enable all = ${layout.options} options → questions of ${layout.sizes.join(", ")}`, () => {
    assert.deepEqual(sizes(layout.fields), layout.sizes);
    assert.equal(
      layout.sizes.reduce((a, b) => a + b, 0),
      layout.options,
    );
  });
});

test("every question has 2 to 4 options, for any number of fields", () => {
  const counts = Array.from({ length: MAX_FIELDS_TRIED }, (_, i) => sizes(i + 1)).flat();
  assert.ok(counts.every((s) => s >= MIN_OPTIONS && s <= MAX_OPTIONS));
});

test("15 fields + Enable all = 16 options fill exactly one call of 4 questions", () => {
  const calls = buildQuestionCalls(fields(FIELDS_IN_ONE_CALL));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.length, MAX_OPTIONS);
});

test("16 fields do not fit one call: a second call is made", () => {
  assert.equal(buildQuestionCalls(fields(FIELDS_IN_ONE_CALL + 1)).length, CALLS_FOR_16_FIELDS);
});

test("every question has its own text and header (duplicates make the tool reject the call)", () => {
  const qs = buildQuestionCalls(fields(LAYOUTS[0].fields)).flat();
  assert.equal(new Set(qs.map((q) => q.question)).size, qs.length);
  assert.equal(new Set(qs.map((q) => q.header)).size, qs.length);
  assert.ok(qs.every((q) => q.header.length <= HEADER_MAX_CHARS && q.multiSelect));
  assert.ok((qs[0]?.question ?? "").includes(`part 1 of ${SAMPLE_PARTS}`));
});

test("Enable all is the first option of the first question, and only there", () => {
  const qs = buildQuestionCalls(fields(LAYOUTS[0].fields)).flat();
  assert.equal(qs[0]?.options[0]?.label, ENABLE_ALL_LABEL);
  assert.equal(qs.flatMap((q) => q.options).filter((o) => o.label === ENABLE_ALL_LABEL).length, 1);
});

test("the description is the first sentence of 'shows'", () => {
  assert.equal(buildQuestionCalls(fields(1))[0]?.[0]?.options[1]?.description, "Shows 1.");
});

test("chunk keeps order and loses nothing", () => {
  const items = fields(LAYOUTS[0].fields);
  assert.deepEqual(chunk(items).flat(), items);
});
