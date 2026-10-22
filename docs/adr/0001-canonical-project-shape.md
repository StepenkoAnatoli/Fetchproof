# ADR-0001 — The canonical project shape has one owner

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** project shape, gate predicate, test fixtures, deployment

## Context

"What a research project looks like on disk" was defined in four places that could not
see each other:

| Definition | What it knew |
|---|---|
| `fetchproof/template/` | file content |
| `test/harness.mjs · makeProject()` | layout, including a `research/raw/.gitkeep` nothing else created |
| `bin/new-project.mjs` | its own `walk()`, its own `{{TOKEN}}` substitution |
| `lib/gate.mjs · MARKERS` | four paths, existence only |

They drifted, and the drift was invisible until the kit was checked out somewhere other
than the machine that wrote it:

1. `template/` never carried `research/raw/`. The fixture invented it. On a fresh
   checkout **76 of 112 tests failed** — every test that needs a real project — with
   `ENOENT … research/raw/.gitkeep`. Not one failure was a bug in the code under test.
2. `githooks/pre-commit` was committed at git mode `100644`. git skips a hook it cannot
   execute, silently, and reports the commit as clean — so the commit gate installed,
   `doctor` reported it installed, and it gated nothing on any POSIX host. Restoring the
   executable bit was the last failing test.

A third consequence: the gate could tell that a project *is* gated, never that it is
*shaped* correctly, so a gated project missing its raw-capture directory produced
nonsense verdicts downstream instead of a named problem.

## Decision

`fetchproof/lib/scaffold.mjs` owns the canonical project shape as data (`LAYOUT`), and
every consumer derives from it:

- `GATE_MARKERS` — the four opt-in markers, declared once; `lib/gate.mjs · isGated()`
  reads them instead of keeping its own list. The set stays exactly four: adding a marker
  changes which projects are gated, and that is a decision for a new ADR.
- `scaffoldProject(dir, …)` — the writer, used by `bin/new-project.mjs`. Existing files
  are never clobbered without `--force` (evidence is irreplaceable); **structure is always
  repaired**, so a missing `research/raw/` comes back on every run.
- `createEmptyProject(dir)` — shape with no content, used by the test fixture. The fixture
  and the scaffolder are now the same call, which is what stops them drifting again.
- `validateProject(root)` — shape problems: missing gating artifacts (fail), missing
  artifacts (warn), unresolved `{{TOKEN}}` placeholders (fail). It never judges contract
  *content*; that stays preflight's job.
- `HOOK_MODE` / `hookExecutability()` — the deployed hook's mode is part of its contract.
  `doctor` fails with a `chmod` command when git would skip it. Platform-guarded: Windows
  has no executable bit, so there presence is the whole question.

`template/` remains the source of file *content*. `lib/scaffold.mjs` is the source of file
*structure*.

## Consequences

- The test suite is portable: it passes on any checkout, not only the author's machine.
- Adding an artifact to a project is one edit to `LAYOUT`, and the scaffolder, the fixture,
  the gate predicate, and `doctor` all learn it at once.
- `bin/new-project.mjs` became a thin CLI (parse flags, render) and gained `--layout`.
- The executable bit is now checked rather than hoped for — a deployment defect that was
  silent for the whole life of the kit is a `fail` line in `doctor`.

## Alternatives considered

- **Put `research/raw/.gitkeep` in the template.** Fixes the symptom on this host only,
  and leaves four definitions of shape. Rejected: it is the drift that caused the failure,
  not the failure.
- **`chmod` inside `install.mjs`.** Would repair the deployed copy but not the source, so
  the repository would still ship a hook git skips, and any project gating from a checkout
  (as this one does) stays broken. The mode is recorded in git instead (`100755`) *and*
  checked by `doctor`.
- **Let the gate validate shape as part of the verdict.** Rejected here: the verdict must
  stay one function with three callers, and a project missing its contract has to fail
  *harder* in preflight, not be excused by a shape check.
