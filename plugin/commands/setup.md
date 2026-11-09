---
description: Choose which fields the Tricorder statusline shows. Explains each field, then lets you tick the ones you want.
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/bin/tricorder:*)", "AskUserQuestion"]
---

Help the user choose which fields the Tricorder statusline shows. Use plain
language. Do not assume the user knows what a statusline field, a worktree or a
context window is. Keep each explanation to one or two short sentences.

## 1. Find out which fields apply

Run these two commands (the second prints JSON):

```
"${CLAUDE_PLUGIN_ROOT}/bin/tricorder" detect
"${CLAUDE_PLUGIN_ROOT}/bin/tricorder" fields describe
```

`detect` says whether this is a subscription account (`subscription`), a pay
per use account such as an API key (`payg`), or could not be told (`unknown`).
The type matters because some fields only make sense for one kind of account.
For example, a subscription has usage limits to show and a pay per use account
has spend to show.
`fields describe` lists only the fields that apply to that account type. For
each one it gives `id`, `name`, `shows`, `sample`, `legend` (what its icons and
colours mean) and `enabled` (whether it is on now).

If a command fails, show the error to the user and stop.

## 2. Explain every field

Start with one sentence on what was detected, for example "I detected a Claude
subscription account." If the type is `unknown`, say you could not tell and that
you will list every field. If it is `payg`, say that spend is counted by
tricorder as an estimate from the cost Claude Code reports for each session.

Then show a table with one row per field, in the order the program gives them
(that is the order they appear on the statusline, left to right, top to bottom): **name**, **what it shows**, **example**,
and **icons and colours** (leave the last cell empty when `legend` is empty).
Use the `shows`, `sample` and `legend` text from the command; do not invent
fields and do not mention fields that were not listed. Add which ones are on now.

## 3. Monthly budget (pay per use only)

Do this step only when `detect` said `payg`. For a subscription or `unknown`,
skip to step 4 and do not mention a budget.

A pay per use account has no usage limit to compare against, so the spend field
compares this month's spending with a budget the user chooses. The budget is
not a limit. Get the question from the program, do not write it yourself:

```
"${CLAUDE_PLUGIN_ROOT}/bin/tricorder" budget questions
```

It prints JSON with `question` and `values`. Ask `question` with one
AskUserQuestion call, exactly as given. Then:

- If the user picked one of the listed options, take its number or `off` from
  `values` (keyed by the option label).
- If the user chose "Other" and typed an amount, use what they typed
  (for example `150` or `$150`).

Save it with:

```
"${CLAUDE_PLUGIN_ROOT}/bin/tricorder" budget <number|off>
```

If the command refuses the amount, show its message and ask once more. Say what
was saved ("no budget" or "$150 a month") and that it can be changed any time
with `/tricorder:setup`.

## 4. Ask which fields to show

Get the questions from the program. Do not write them yourself:

```
"${CLAUDE_PLUGIN_ROOT}/bin/tricorder" fields questions
```

It prints JSON with three parts:

- `calls`: a list of question lists. For each item in `calls`, in order, make one
  AskUserQuestion call and pass that item's questions **exactly as given**, with
  no change to the text, headers or options. (The question tool rejects a call
  if two questions share the same text, or a question has fewer than 2 or more
  than 4 options. The program already makes sure none of that happens.)
- `labels`: which field id each option label stands for.
- `enableAllLabel`: the label of the "Enable all" option.

Work out the answer from the labels the user ticked:

- If `enableAllLabel` is ticked, every listed field is on.
- Otherwise exactly the ticked fields are on. Look each label up in `labels`.
- If nothing is ticked anywhere, change nothing and tell the user so. Hiding
  every field is not offered.

If the question tool still reports invalid parameters, show the error to the
user and stop. Do not change any setting.

## 5. Save and show the result

Run, with the chosen ids separated by commas, or `all` for "Enable all":

```
"${CLAUDE_PLUGIN_ROOT}/bin/tricorder" fields set <id,id,...>
```

Then tell the user which fields are on and which are off. If the command
refuses an id, show its message and do not retry with a guess.

Finally, show a preview of the statusline with the new settings. It draws a
made-up session (example pull requests, plan, worktrees and sub-agents), so it
can show every field that is on. Nothing real is read or changed:

```
"${CLAUDE_PLUGIN_ROOT}/bin/tricorder" fields preview
```

Show its output as it is, in a code block, in the order it prints. Say that the
plan link sits at the right edge, that the second and third lines are the other
worktrees and the sub-agents, and that the last line (if present) is the
start-up animation, which only shows for the first seconds of a session.

If the preview is blocked or fails, skip it. Say that the change shows up the
next time the statusline redraws, and that running `/tricorder:setup` again
changes it.
