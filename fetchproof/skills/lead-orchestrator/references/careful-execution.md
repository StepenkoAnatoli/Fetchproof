# Careful Execution

The working discipline that keeps orchestrated work reliable. It is the `careful-coding` skill
compressed for two audiences: sub-agents, who cannot see this skill or that one and therefore
receive the discipline inside their brief; and the lead, whose mistakes are mostly about trusting
reports and memory rather than code.

Most mistakes are not hard problems. They are skipped steps: editing a file without reading it,
calling an API from memory, saying "this should work" instead of running it, papering over a
failing test. Each costs seconds to avoid and much longer to find later.

## Contents

1. The discipline block (paste into every builder and fix brief)
2. Self-review checklist (before any report)
3. Mistake report (the honesty protocol)
4. Status words
5. Stop-and-check phrases: builders
6. Stop-and-check phrases: the lead

---

## 1. The discipline block

Paste verbatim into the DISCIPLINE section of builder and fix briefs.

```
DISCIPLINE   Before changing anything:
             - Read the code you will touch and the code that touches it. Grep for every caller
               of a function, type, route or config key you change.
             - Check facts you are not sure of in the installed package, the repository or the
               research brief - never from memory: signatures, flags, config keys, versions.
             - Restate the unit in one line and keep to it. Do not tidy unrelated code; mention it
               in the report instead.
             - Name assumptions. If an ambiguity would change the implementation, stop and report
               it; otherwise state the assumption and proceed.
             While writing:
             - Smallest change that does the job, in the surrounding style.
             - Decide the failure path deliberately: empty input, null, missing file, network
               failure, concurrent writes, partial write on crash. Never swallow an error.
             - Nothing temporary in the final code: no hardcoded paths, credentials, debug output,
               test-only values.
             - Work in steps you can check; commit to your branch when a step is green.
             After writing:
             - Run the tests that cover the change, then the wider affected set; run lint and
               type checks if the project has them. Read the output, not the exit code:
               "0 tests collected" also exits 0.
             - Re-read the full diff as a stranger's pull request, against the self-review
               checklist in your brief.
             - Check you did what the brief asked, not something adjacent.
             - If you cannot verify something, say so, with the exact command and the expected
               output. Silence never implies success.
             When you find a mistake:
             - Say it first and plainly. State the impact, the cause in one line, fix the root,
               look for the same mistake elsewhere, re-verify, and report it in the Mistakes
               section. Never delete, skip or loosen a test; never silence an error with an
               ignore directive or a broad catch; never change an expected value to match wrong
               output; never retry until it passes and call that fixed.
```

## 2. Self-review checklist

Walk this before writing the report. Each item is a thing that slips past a first look.

- [ ] Every caller of every changed signature, type, route or key is updated (grep, do not recall)
- [ ] Empty, null, zero, negative, oversized and malformed inputs reach a decided path
- [ ] Off-by-one at every boundary: ranges, slices, retries, "last" and "first"
- [ ] Every error is handled or propagated; none is caught and dropped
- [ ] No leftover debug output, commented-out code, temporary flags, hardcoded paths or secrets
- [ ] Every new test fails with the guard it names removed, on its own input (shown, not assumed)
- [ ] Filesystem tests use the project's link guard, target the scratch directory only, and assert
      by lstat and real path
- [ ] Concurrency- or timing-sensitive tests were repeated (default 30); any failure is a defect
- [ ] Test output was read: counts match the tests written; nothing skipped or collected as zero
- [ ] The diff contains only the unit's owned files
- [ ] The brief's acceptance criteria are each met, or each miss is named in the report
- [ ] The research brief's claims, where the unit implements external behaviour, are the source of
      every limit, format and error code - cite the E-nn rows

## 3. Mistake report

The moment an error is noticed - from a test, from a reread, from the lead, from a hunch - it is
reported in this shape, before any further good news:

```
Mistake:  [what was wrong]
Where:    [file:line, or which step]
Impact:   [what it broke or would have broken; is anything committed or delivered affected?]
Cause:    [one line]
Fix:      [what changed; where else the same cause was found]
Verified: [command or test re-run, and its result]
```

Lead with it. Do not bury it after a paragraph of progress, do not call it a "refinement", and do
not fix it quietly and move on. The reader needs to know what was wrong to judge the rest.

These are never a fix, because they remove the symptom and keep the bug: deleting, skipping or
loosening a failing test; `# type: ignore`, `@ts-ignore`, `eslint-disable` or a broad catch to
silence a legitimate error; changing an assertion's expected value to the wrong output; retrying
until it happens to pass; saying "should work now" without re-running. If a failing test looks
wrong rather than the code, say so and explain why before touching the test.

## 4. Status words

Use the right word for the level of confidence, every time, in reports and in the final report:

- **Verified** - ran it, saw the result. Say what was run.
- **Untested** - wrote it; did not or could not run it.
- **Expect / believe** - reasoning, not evidence.

Every sub-agent report ends with:

```
Verified:      [tests and commands run, with results]
Untested:      [what was not or could not be run, and how to run it]
Mistakes:      [mistake reports, or "none found"]
Open risks:    [assumptions made, edge cases left, follow-ups]
```

Partial is reported as partial: "3 of 4 criteria met; the 4th fails on X" beats a summary that
implies all four hold.

## 5. Stop-and-check phrases: builders

Reading one of these in one's own reasoning means stop and do the thing on the right.

| Thought                                  | Action                                      |
|------------------------------------------|---------------------------------------------|
| "This should work"                       | Run it                                      |
| "I'll assume the API takes..."           | Look it up in the package or the brief      |
| "The test is probably flaky"             | Investigate; a flake is an S1               |
| "I'll fix that later"                    | Fix it now, or write it under Open risks    |
| "While I'm here, I'll also..."           | Not in scope; mention it in the report      |
| "It's basically the same as before"      | Diff it                                     |
| "I don't need to read that file"         | Read it                                     |
| "The lead won't notice"                  | The reviewers will; it is the user's code   |

## 6. Stop-and-check phrases: the lead

The lead's mistakes are about trust and memory, not syntax.

| Thought                                              | Action                                                        |
|------------------------------------------------------|---------------------------------------------------------------|
| "The builder said it passed"                         | Re-run the key test and one more claim from the report        |
| "The reviewers found nothing"                        | Read what each one says it did not check                      |
| "I'll remember where we are"                         | Write Next action in `RUN.md` now                             |
| "The brief is obvious"                               | The sub-agent knows nothing you did not write                 |
| "The base can't have moved"                          | Compare the recorded base commit with the branch head         |
| "That's probably the same failure as the baseline"   | Compare the failing set exactly, by name                      |
| "We're nearly done, skip the checkpoint"             | Nearly done is when the session is most likely to be cut      |
| "Let me just fix this one thing myself"              | If it is a unit's file, brief it; if it is the lead's, test it like a unit |
| "I'll re-collect to be safe"                         | The cache and ledger already hold it; `preflight` is the check |
| "The report looks complete"                          | Check the acceptance list item by item; return at the first gap |
