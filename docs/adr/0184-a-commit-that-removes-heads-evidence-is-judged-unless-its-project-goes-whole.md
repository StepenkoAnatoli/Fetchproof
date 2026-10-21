# ADR-0184 - A commit that removes HEAD's evidence is judged, unless its project goes whole

- **Date:** 2026-10-19
- **Status:** accepted; amended 2026-10-20 by check (c) of the 2026-10-19 review (F2): the top
  level's evidence moved whole below it is a move, not judged where it was - and by check (e)
  (E1, E2): a move takes the top level's `research/` out of the index whole, and one that leaves
  it on disk blocks until it goes
- **Area:** `fetchproof/lib/gate.mjs` (`evaluate`, `headEvidenceRemoval`, `evidenceMovedTo`,
  `researchRemains`, `movedLeftover`), `fetchproof/bin/gate.mjs`
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
   top level always counts as kept (but see the amendment: its evidence moved whole below it is a
   move).
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
  or `--no-verify`, as removing one capture already did - unless it moves whole below the top
  (the amendment).
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

## Amendment, 2026-10-20 - moving the top level's project below it is a move

Check (c) of the 2026-10-19 review (F2) found the decision giving the message alternative A was
rejected for. Item 4 counted the top level as always kept, so a one-project repository turned
into ADR-0182's nested layout with `git mv research packages/x/research` blocked at the top with
"research/raw/.fetches.jsonl is in HEAD and is being deleted ... restore it (git checkout HEAD --
research/raw/.fetches.jsonl)", for a ledger intact at the new place, and each restore led to the
next block until the move was undone. The ways through were a `research/GATE_OFF` committed into
the folder being moved away, or `--no-verify`, which also skips judging the moved project. Before
this ADR the ungated top level was not judged, and the commit was allowed with `packages/x` judged.

**Decision.** At the top level, HEAD's ledger deleted is a move, and the top level is not judged
for it, only when the index:

1. stages, under one other folder P, `P/research/raw/.fetches.jsonl`, holding every entry of
   HEAD's ledger by the key `evidenceRemoval` keeps entries by (seq, raw, source; `ledgerKey`);
2. stages every capture and source HEAD's ledger names and HEAD holds at `P/<the same path>`,
   with the same blob - moved, not changed; and
3. keeps no path under the top level's `research/` - the whole folder left the index (check (e)
   of the 2026-10-19 review, E2).

`evidenceMovedTo` takes its candidates from the staged list the gate already has - the paths ending
in `/research/raw/.fetches.jsonl` - so a commit that stages none asks git nothing new. It asks one
`git ls-tree` of HEAD's `research/raw/`, then per candidate one `git ls-files -s` of
`P/research/raw/` under the literal pathspecs `projectRemains` uses (`literalPathspecs`) and one
`git cat-file blob` of the ledger by the id that listing gave. Once a P is named, one literal
`git ls-files -z -- research` (`researchRemains`, the top level's counterpart of
`projectRemains`) must list nothing. The verdict is `not-gated`, naming where the evidence went.
`bin/gate.mjs` does not judge the top level for a move, as before this ADR: the projects below it
are judged as ever, `packages/x` among them. Anything less still blocks with #312's reason: a
ledger copied with a capture dropped, edited or put in another folder, a ledger that lost an
entry, `research/raw/` moved while the top level's other `research/` files stay tracked, an
unknown staged list, a git that cannot answer. A ledger kept at the top is never a move: it stays
the top's, and what it names is judged there.

**A move with the old `research/` left on disk blocks** (check (e), E1). A copy and `git rm -r
research` leave the gate's ignored log in `research/raw/`, so the top level stays gated on disk
with no corpus in the index, and a gated top level is the only project the hook judges
(ADR-0182): allowing the move there let code into `packages/x` with nothing judged. So in
`evaluate`'s empty-index branch a move blocks (`movedLeftover`). The reason says where the
evidence went and that `research/` here holds only files git does not track - by the third
condition nothing under it is in the index - and names them, a count and the first three, from
one literal `git ls-files -o`, so the operator can check them before deleting anything. The fix
is to move out what they keep and delete the rest - `git clean -f -d -x -- research` deletes only
what git does not track, `-n` in place of `-f` lists it - and commit again: with `research/` gone
the top level is ungated, the move is answered as above, and `packages/x` is judged where it went.

Decided by the lead on 2026-10-20, the leftover's block too (check (e)'s option a); the owner may
still prefer the alternative below that keeps the block.

Rejected:

- **Judge P from a gated top level that answers with a move** (check (e)'s option b): put
  `movedTo` on the verdict and have `bin/gate.mjs` judge the projects below a gated top when it
  carries one. It would let the leftover stay, but a gated top judging projects below it is
  ADR-0182's deferred question, not a bug fix's to settle.
- **The ledger's entries alone** (the review's first fix). One `git show` per candidate, but a
  ledger copied while its captures are deleted, or edited, would pass as a move, and the captures
  would leave the branch with no record - the removal #312 blocks.
- **Keep the block and say what happened** (the review's minimum): name the ledger leaving the top
  level, `research/GATE_OFF` and `--no-verify`. Honest, but a legitimate conversion still needs an
  override committed into the folder being moved away, or one that skips judging the moved project.

Consequences:

- A move done as a copy and `git rm -r research` needs one more step, deleting the leftover
  `research/`, before it commits. The block names the files; the next commit is not told "no part
  of research/ is tracked", whose `git add` fix cannot work with no ledger on disk there.
- A move that keeps any `research/` path tracked at the top level, even one newly added, is no
  move: it blocks with #312's reason until the top level's `research/` leaves the index whole.
- A moved project is judged at P only when P is a project below the top (ADR-0182: a
  `research/DISCOVERY.md`, tracked or staged, with `research/raw/` or a contract new-project
  rendered). Evidence moved without its contract stays intact in the index and is not judged there.
- ADR-0020's `.gitattributes` line (`research/raw/* text eol=lf`) is anchored to the folder that
  holds it. A project moved below the top without its own `.gitattributes` has its captures
  checked out with CRLF under `core.autocrlf=true`, and is blocked there for `body-unmodified`,
  which names the line endings (unchanged by this amendment).
