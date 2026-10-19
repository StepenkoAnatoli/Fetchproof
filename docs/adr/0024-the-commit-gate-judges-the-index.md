# ADR-0024 — The commit gate judges the index; every other caller judges the working tree

- **Date:** 2026-09-17
- **Status:** accepted; the trigger of its rejected "materialise the whole index" fired with
  ADR-0120 and was acted on in ADR-0183 (the suite rule runs on a scratch repository built from
  the whole index; the corpus verdict still materialises `research/` only)
- **Area:** the gate verdict, the commit hook
- **Refines:** the hardening design's diff-scope rule, which said which PATHS are in scope and never said which BYTES

## Context

git gives a `pre-commit` hook two things: the fact that a commit is starting, and a list of
staged path **names**. It does not hand over content. The kit read its corpus from disk, so
the verdict was formed over the working tree while the scope was taken from the index — two
different sources, treated as one.

The 2026-09-16 review (F08) reproduced the consequence. Stage a contract whose unknown reads
`OPEN`, then restore `CLOSED` in the working tree only. With a staged source file and a staged
architecture map, the gate returned exit 0, and `git show :research/DISCOVERY.md` still said
`OPEN`. The commit that landed carried an unproven contract past a gate that had just approved it.

This is not an edge case. It is the normal shape of an interrupted session: you stage work,
keep editing, and commit later. Every `git add -p`, every partial stage, every "fix it in the
working tree and commit the earlier version" produces the divergence.

## Decision

**`evaluate(root, { gate: 'commit' })` materialises the index and judges that.**

- `materializeIndex(root)` runs `git ls-files -z -- research` and
  `git checkout-index --prefix=<scratch>/`, producing the index's own bytes in a scratch
  directory. The working tree is never written to, and the scratch directory is removed in a
  `finally`.
- Only `research/` is materialised. The gate's question is about the corpus, and copying a
  whole checkout on every commit is a cost paid for nothing.
- **The edit gate keeps reading the working tree.** It is the opposite question: an
  interactive check is about the file in front of you, and judging the index there would
  refuse an edit because of something you already fixed.
- **`GATE_OFF` and the local `core.hooksPath` stay facts about the repository**, read from the
  real root. They are the operator's current intent, not part of the commit's content.
- **A caller that injects a corpus gets that corpus judged.** It has already said what it
  wants judged; overriding that would make the injection meaningless.
- **When the index cannot be read** — not a repository, git missing, a git failure — the
  verdict falls back to the working tree and **says so** in `indexNote`, and the verdict
  object carries `judged: 'index' | 'working-tree'` either way. A gate that quietly changed
  which bytes it judges is the defect this ADR exists to remove.
- **An untracked corpus is its own finding.** A gated project whose `research/` is not in the
  index at all is not "your contract is missing" — the file is sitting right there. It is:
  the evidence is not in the repository and cannot travel (ADR-0011). It blocks, with
  `git add -f research/` as the fix.

## Consequences

- The gate now answers the question it was always assumed to answer: *does the commit about
  to be made carry a corpus that passes?*
- Staged deletions are judged, which the name-only list could not express: deleting
  `DISCOVERY.md` in the index fails harder even while the file remains on disk.
- A commit gate run costs one `ls-files` and one `checkout-index` over `research/`. On this
  repository's corpus that is milliseconds; on a corpus of thousands of captures it is
  proportional to the corpus, not the repository.
- Two of the kit's own tests had to change, and both were wrong in the same way: they edited
  the working tree and expected the gate to react. Under the old semantics they passed while
  proving nothing about a commit.
- `judged` is now part of the verdict's shape, so a reviewer can always tell which bytes
  produced a verdict they disagree with.

## Rejected alternatives

- **Read blobs with `git show :path` per file.** Equivalent for the contract, but the corpus
  reader needs a *directory* — capture files, the ledger dotfile, the audits folder.
  Reimplementing `readCorpus` over a blob-reading interface would give the kit a second corpus
  reader, which is exactly what ADR-0003 exists to prevent.
- **`git stash` the working tree, judge, unstash.** Rejected outright: a gate that mutates the
  operator's working tree to form an opinion can lose work when it is interrupted, and a hook
  is interrupted all the time.
- **Refuse to run when the index and the working tree diverge.** Simple and wrong: that
  divergence is a normal, useful git workflow, and a gate that forbids it will be removed
  rather than obeyed.
- **Keep the working tree and warn about divergence.** A warning on every partial stage is
  noise, and it leaves the verdict itself wrong. The point is not to tell the operator the two
  differ; it is to judge the one that is about to become a commit.
- **Materialise the whole index, not just `research/`.** More obviously correct, and it pays
  the cost of copying the entire repository on every commit to answer a question about one
  directory. If a future check needs a path outside `research/`, this scope widens with it.
