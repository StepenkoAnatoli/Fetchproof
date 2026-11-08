# ADR-0199 — A lost evidence table is named by corpus-shape and citations

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/checks.mjs` (`citations`, `corpusShape`), `fetchproof/lib/corpus.mjs`
  (`readCorpus`'s `evidenceFile`)
- **Prompted by:** the independent audit of `532c696` (Claude, 2026-11-04), finding FP-011
  (alias B-2, Medium)
- **Extends:** ADR-0001 (the canonical project shape: `research/EVIDENCE.md` is a required,
  gating artifact), ADR-0004 (the contract-check registry)
- **Freeze (ADR-0117):** a bug fix. The shape and the handoff call the file required, and
  preflight passed over its loss saying "the corpus parses cleanly". No new check, flag, error
  code or format: two finding names inside existing checks, and one more fact in the corpus
  snapshot.

## Context

`readCorpus` reads `research/EVIDENCE.md` through `readText`, which answers `null` for a missing
file and for anything at the path that is not a regular file - a directory, a fifo - or cannot be
read. `parseTable(null)` is an empty table with no problem recorded, and the snapshot's
`evidenceFile` (`{ present, found }`) was read only by the handoff. So with the file deleted, or a
directory in its place, `corpus-shape` said "the corpus parses cleanly" and `citations` said
"0 evidence rows, each with a cached page". The verdict was FAIL only because each CLOSED
unknown's citation now dangled - 29 `dangling-citation` findings in the audit's case, which send
the reader to edit citations rather than restore the table. A corpus whose unknowns were all
KNOWN-UNKNOWN cited nothing, so it PASSED with its evidence table gone.

A file that holds no evidence table - emptied, or keeping the table only in a code block, which
the F01 rule no longer reads as the table - was read the same way. The handoff refused all three
(`handoff-evidence-missing`, `handoff-evidence-unparsed`); preflight refused none. The loss of
DISCOVERY.md is named (`discovery-contract/contract-missing`), as are the ledger's
(`provenance/ledger-missing`) and `research/raw/`'s (`corpus-shape/raw-missing`).

## Decision

1. **A lost evidence table is a blocking finding.** `research/EVIDENCE.md` missing, or not a
   readable file, is `evidence-missing`, its detail saying which; holding no evidence table (no
   header row of its six columns outside a code block or an HTML comment) is `evidence-unparsed`.
2. **Named by both checks whose subject it is, and neither passes over it.** `citations` returns
   that one finding and nothing else: no row can be vouched for, and its pass over zero rows
   vouched for nothing; a run narrowed to it (`preflight --check citations`) fails. `corpus-shape`, which
   reports whether the shape is there, names it beside `raw-missing`, so it no longer says the
   corpus parses cleanly. Both details name the file and say to restore it rather than edit the
   citations.
3. **In every gated project, unconditionally**, as `raw-missing`, `contract-missing` and
   `ledger-missing` are: `new-project` writes the file, the shape (`LAYOUT`) marks it required
   and gating, and the handoff refuses its absence whatever else the corpus holds.
4. **The dangling-citation findings stay.** They are true. `citations` runs second, so its
   finding is read before them.
5. **The snapshot says what stands at the path.** `evidenceFile.unreadable` is true when
   something is at `research/EVIDENCE.md` that could not be read as a file. `readCorpus` still
   records no problem for it and judges nothing.

## Rejected alternatives

- **Only when the project has collected something** (a capture, a ledger entry or a CLOSED row:
  the audit's guard against failing a fresh project). A fresh project is written with the file,
  and fails preflight on its OPEN unknowns anyway. The condition would keep a KNOWN-UNKNOWN-only
  corpus with an empty ledger passing without its table, which the handoff then refuses, and
  would make this the one required file judged conditionally.
- **One check names it, the other keeps its pass.** `citations` alone leaves `corpus-shape`
  saying the corpus parses cleanly beside it; `corpus-shape` alone leaves `citations` vouching
  for zero rows, and `preflight --check citations` passing over the loss. The cost of naming it twice is two
  findings with one cause and one remedy; each check is then truthful about its own subject.
- **A problem recorded by `readCorpus`** (the audit's `artifact-missing` or
  `artifact-unreadable`). `corpus.problems` travels into the portable state's `corpusProblems`
  (`artifact.mjs`), where a new kind changes what that state carries, under the freeze; and
  `readCorpus` reports, it does not judge.
- **A new check for the corpus's required files.** A new check under the freeze, for what two
  existing checks already have as their subject.
- **Dropping the dangling citations while the table is lost.** They are true, and once the
  table is restored without one of its rows, they are what says which.

## Consequences

- A gated project without a readable evidence table fails preflight on `citations` and
  `corpus-shape`, both naming the file, before the dangling citations. A KNOWN-UNKNOWN-only
  corpus no longer passes without it.
- The commit gate's phase-1 rule (ADR-0048) is unchanged: a commit confined to `research/` is
  committable while preflight fails, so a deletion of the file can still enter history as
  phase-1 work; nothing can be built behind it.
- `MAP.md` and `SOURCES.md` are read the same way (a missing file is an empty table) and are not
  changed here: neither is required or gating, and the audit leaves the map's case open (its
  harness case S21).

## Trigger to revisit

- `MAP.md` or `SOURCES.md` becomes required, or a lost map is found passing the gate: the same
  rule then belongs to the check whose subject it is (`subtopic-coverage` for the map).
- A legitimate flow is found that runs preflight before the evidence table is written: judge
  then whether the finding waits for the first capture.
