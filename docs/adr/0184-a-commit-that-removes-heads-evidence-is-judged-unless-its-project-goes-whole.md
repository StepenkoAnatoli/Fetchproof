# ADR-0184 - A commit that removes HEAD's evidence is judged, unless its project goes whole

- **Date:** 2026-10-19
- **Status:** accepted
- **Area:** `research-kit/lib/gate.mjs` (`evaluate`, `headEvidenceRemoval`), `research-kit/bin/gate.mjs`
- **Defect:** #312's rule, found open by the review of the 2026-10-19 sweep (hooks F1)
- **Extends:** #312, which no ADR recorded - "a capture is never removed" lived in the gate's
  reason text and the CHANGELOG - and ADR-0182 (a project below the top level)
- **Freeze (ADR-0117):** a bug fix. A commit that took the evidence went unjudged, or was told a
  fix that fails; no command, flag, config key or check is added.

## Context

#312 made removing the evidence HEAD holds an integrity block (ADR-0093): judging the index, the
commit gate blocks a commit that deletes HEAD's ledger (`research/raw/.fetches.jsonl`), drops an
entry HEAD records, or deletes a capture a ledger names, "whatever else is staged". It ran only
once `evaluate` had a gated project and a corpus in the index. Two earlier answers came first:

- **No gate marker left on disk.** `rm -rf research && git add -A` at the top level leaves none of
  the four markers, so `bin/gate.mjs` judged only projects below the top (ADR-0182) and
  `evaluate` answered `not-gated`: exit 0, silent. The commit removed the corpus and turned the
  gate off with no record, though the overrides are exactly three (CONTEXT.md) and AGENTS.md says
  deleting `DISCOVERY.md` does not turn the gate off. Below the top, `git rm -r
  packages/a/research` with `packages/a/app.js` kept was "allow in packages/a - no gate marker in
  this project".
- **No part of `research/` left in the index.** On every verdict where `research/raw/` exists the
  gate writes `research/raw/.diagnostics.jsonl`, which the template's `.gitignore` ignores, so
  `git rm -r research` usually leaves `research/raw/` on disk. The project stays gated, the index
  holds no corpus, and the gate blocked with "no part of research/ is tracked" and the fix
  `git add research/ && git add -f research/raw/.fetches.jsonl`, which exits 128 for a ledger no
  longer on disk. The reason did not name the ledger, and the fix could not be followed.

Reproduced at 541232e on 2026-10-19, at the top level and in `packages/a`, each a copy of this
repository's `research/` committed with the template's `.gitignore`.

The same two answers also meet commits the records do not forbid. `git rm -r packages/a` deletes
a nested project whole, code included. `git mv packages/a packages/b` moves one: the ledger's
paths are relative to the project, so the moved corpus verifies at `packages/b`, which is judged
there as before. Neither leaves anything at `packages/a` that rests on the evidence.

## Decision

Where the commit gate answered without asking, it now asks what the commit takes from HEAD's
evidence: `headEvidenceRemoval(root, { top, stagedPaths })` reads the staged ledger and runs
#312's `evidenceRemoval` over it.

1. **No marker on disk.** `evaluate` asks before it answers `not-gated`. A removal is judged as
   for a gated project: a recreated `research/GATE_OFF` is the override and is recorded in
   `research/overrides.log`; otherwise the verdict blocks with #312's reason and fix. With no
   removal, `not-gated` as before. The `listStaged` acquisition still runs only after the
   ungated and `GATE_OFF` returns (ADR-0154): this question goes to git directly, and an unknown
   staged list is asked about rather than assumed empty.
2. **No corpus in the index.** In the empty-index branch, a removal blocks with #312's reason and
   fix before "no part of research/ is tracked" is reached. With no HEAD, or no ledger in HEAD -
   every fresh project's first commit - that block and its `git add` fix are unchanged.
3. **The ungated top level in `bin/gate.mjs`.** git runs the hook at the top level. With the
   staged list it already read, `bin/gate.mjs` asks the same predicate of the top level and
   judges it too when it finds a removal, besides the projects below it - so the choice of what
   to judge and the verdict cannot disagree.
4. **A project below the top level that goes whole is not judged where it was.** Once a removal
   is found below the top, one `git ls-files -z -- <prefix>` asks whether the project's folder
   keeps a tracked path in the index - read literally, whatever pathspec settings the
   committer's environment carries. None: the project was deleted or moved whole, and the
   verdict is `not-gated`, saying so. A git that cannot answer counts as kept, which blocks. The
   top level always counts as kept.
5. **Cost.** Nothing new is asked unless a staged path is under `research/raw/`, or the list is
   unknown; nothing is asked outside a repository at the project, where git would answer for one
   above it.

The printed fix is #312's, `git checkout HEAD -- research/raw/.fetches.jsonl`, which works with
nothing left on disk. After it, the next run names the captures still being deleted.

## Alternatives rejected

- **A: block every removal, the whole folder too** (the review's fix). One rule, and the literal
  reading of "a capture is never removed". But a move blocks at its old place with a false
  message - "is in HEAD and is being deleted ... restore it" for a ledger intact at the new
  place - and deleting an abandoned nested project needs `--no-verify` or a `research/GATE_OFF`
  recreated inside the folder being deleted. The template does not ignore that file, so
  `git add -A` commits it, with an `overrides.log` beside it, into a folder meant to be gone.
- **A': A, plus a sentence naming the `GATE_OFF` path to recreate** in the whole-folder case. The
  smallest code, and it makes deleting a whole project workable, but the move keeps its false
  message, and the override still lives in, and is committed into, the deleted folder.
- **C: keep the verdicts and rewrite only the empty-index message** to name the deleted ledger.
  It mends the fix that fails and leaves `rm -rf research && git add -A` silent - a fourth,
  unrecorded way to turn the gate off.

## Consequences

- At the top level, removing `research/` while the repository stays needs `research/GATE_OFF`
  or `--no-verify`, as removing one capture already did.
- A nested project's evidence can leave a branch without a record when its whole folder goes;
  nothing in that folder rests on it any more. The index decides "whole": a folder left with only
  untracked or ignored files counts as gone.
- The fix restores one layer at a time: the ledger first, then the captures the next run names.
- An ungated top level whose commit stages a path under `research/raw/` pays two `git show`
  calls (the staged and the HEAD ledger), and a `git diff --cached` when a ledger names captures;
  `evaluate` asks again when `bin/gate.mjs` found a removal. `git ls-files` runs only once a
  removal is found below the top.
- A sparse checkout that excludes `research/` is still not gated on disk and not asked
  (unchanged).

## Trigger that would reopen this

An operator loses a nested project's evidence through a whole-folder deletion they did not mean,
or ADR-0182's deferred "judge nested projects under a gated root" reopens.
