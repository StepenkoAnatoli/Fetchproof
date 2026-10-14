# ADR-0109 — One helper decides whether a recorded path may be read

- **Date:** 2026-09-30
- **Status:** accepted
- **Area:** `lib/core.mjs` (`projectFile`), `lib/provenance.mjs`, `lib/warc.mjs`
- **Follows:** ADR-0076 (nothing from outside the project is read or packaged)

## Context

A corpus records paths: a ledger entry's `raw`, an evidence row's `Raw` cell, a manifest
entry. ADR-0076 says such a path is read only if it is inside the project (by path and by
real path) and a regular file. Each reader re-implemented the steps. On 2026-09-30 a
break-test found that `verifyLedger` and `exportWarc` had skipped the containment steps: a
ledger naming `../elsewhere` was verified, and exported into the WARC.

## Decision

- **`projectFile(root, rel)`** in `lib/core.mjs` answers `{ abs, problem }`, where `problem`
  is `null` or the first rule broken, in order: `outside`, `missing`, `not-file`.
- **`verifyLedger` and `exportWarc` use it.** Each still maps the answer to its own words:
  `raw-outside` / `raw-missing` / `raw-unreadable` in the chain, a named `skipped` reason in
  the export.
- A recorded path is joined onto the root (`core.resolve`), so an absolute one is never read
  as a path elsewhere. On POSIX it names a file under the root and reads as `missing`; on
  Windows its drive letter lands the join outside the root and it reads as `outside`
  (the windows-latest leg, 2026-09-30). Either answer means no file is read.

## Deferred

`corpus.readCaptures`, `artifact` (the Raw-cell and ledger checks) and `evidence-context`
also apply ADR-0076, and are not moved yet. Each reports its own problem kinds
(`capture-outside`, `raw-outside`, `rawOutside`) inside larger walks, and each is covered by
its own tests. Moving them is a refactor of working, tested code with no defect behind it.

**Trigger that ends the deferral:** a new reader of recorded paths, or a defect in any of
those three, is written against `projectFile`, and the other two move with it.

Implementation (2026-10-13, #351): the evidence-context private-file defect fired the
deferral's trigger. Its Raw reader, corpus capture/Raw checks, and the artifact Raw/ledger
readers now use `projectFile`. Capture reads also stay inside the capture folder by real
path, and missing or non-file inputs are named before any content read.

## Rejected alternatives

- **Move every reader now.** Three working readers rewritten in one change, with no defect
  to test against first.
- **A lint that forbids reading a joined path without the helper.** It cannot tell a
  recorded path from one the kit built itself, and would flag the second.
