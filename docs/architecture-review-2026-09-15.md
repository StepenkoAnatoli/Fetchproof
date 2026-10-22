# Architecture Review — fetchproof, 2026-09-15 (second round)

A scan of the research-first kit for **deepening opportunities**: refactors that
turn shallow modules into deep ones, judged for testability and
AI-navigability. Domain vocabulary from [`CONTEXT.md`](../CONTEXT.md);
architecture vocabulary in its plain form — *module, interface, depth, seam,
adapter, leverage, locality*.

This is the **second** review of 2026-09-15. The first produced ADR-0014 (the
brief's shape has one owner) and ADR-0015 (the trace joins are lazy functions);
its document was written outside the repository.

**Why this document is in `docs/` and not in `/tmp`.** The round's review was
written outside the repository, as the two rounds before it were, and it was not
recoverable from the sandbox this round's work ran in. It is therefore
**reconstructed here** — the candidate titles, ratings and dispositions are this
round's, taken from the rulings; the file and line references were re-read from
the code while landing it. The reconstruction is labelled as one rather than
passed off as the original, because a review the next round cannot read is a
review that gets re-derived from scratch: that has now happened three times, and
it is the reason this file exists. A review belongs beside the ADRs it produces.

**Vocabulary guard:** "component", "service", "API", and "boundary" are not used
in this document on purpose; the shared design vocabulary is the one above.

## Baseline

- **Suite.** 311 tests, 19 test files, no network, no Firecrawl key, green —
  from the repo root and from `fetchproof/`.
- **Preflight (this repo, repo root).** `PASS` — 0 failures, 10 warnings (6
  `capture-transport` — five honest `agent page fetch` transports and one
  unnamed entry —, 3 `capture-partial` — U-2, U-3, U-4 closed on partial
  captures, disclosed in the front-matter `omitted` notes —, 1
  `citation-primary` — E-02 is `S`). 4/4 unknowns closed, 6 evidence rows, 6 raw
  captures, chain intact.
- **Overrides.** 0 — `research/overrides.log` does not exist.
- **Enforcement in this sandbox.** `core.hooksPath` is unset, so the commit gate
  is not installed here; the same-commit map rule (ADR-0007/0008) was honoured
  manually for the commit this review produced.

## Candidates

### 1 — The Finding extractor is living inside the collector

- **Strength:** Speculative when first raised (2026-09-14, candidate 5) —
  **accepted this round**, because that rejection's trigger fired
- **Files:** `lib/collect.mjs` → `lib/finding.mjs`, `test/collect.test.mjs` →
  `test/finding.test.mjs`

**Problem.** `lib/collect.mjs` declares one ownership — one URL's journey — and
70% of the file was a different concept. Measured on the 658-line file this
round started from: the extractor's block runs **lines 26–485, 460 lines**,
leaving 174 lines of collector behind 24 lines of header and imports. The
operator measured the same file independently and got the same shape. ADR-0009
rejected the split on 2026-09-14 and named the trigger that would expire it —
"the heuristics outgrow their file … reading the collector means reading a
different tool" — and that condition is now literally true: `collectOne` did not
begin until line 486.

**Solution.** Move the block to `lib/finding.mjs`; `firstFinding(markdown,
fallback)` is its whole interface. A boundary move, no behavior change. The
collector imports it and does not re-export it.

**Verification (the acceptance criterion was "identical behavior").** Suite
311 → 311, nothing added and nothing lost. All **34** test blocks are
byte-identical to before the move: **17 relocated** to `test/finding.test.mjs`,
**17 untouched** in `test/collect.test.mjs` — including the one that proves the
two modules still join (`the evidence row is filled with prose, not the page
banner`). Beyond the suite, the old and the new `firstFinding` were run against
each other over every capture in `research/raw/`, the four page fixtures, nine
edge cases (empty, `null`, `undefined`, `0`, whitespace, a table-only page, a
5,000-character line) and 400 fuzz slices of the same material, each through six
fallbacks: **2,556 comparisons, 0 differences**.

**Disposition: ACCEPTED — shipped as ADR-0016**, with `docs/ARCHITECTURE.md`
updated in the same commit and the **finding** term in `CONTEXT.md` naming where
the cell's words come from.

### 2 — What phase 1 proved is derived twice

- **Strength:** Worth exploring
- **Files:** `lib/brief.mjs`, `lib/audit.mjs`, `lib/corpus.mjs`

**Problem.** The brief and the audit are the two documents that tell a reader
what phase 1 proved, and each derives it for itself. Both walk the closed
unknowns through `claimOf` (`lib/brief.mjs:163`, `lib/audit.mjs:205` and `:217`)
and then shape the claim themselves:

- `renderVerifiedTable` exists twice — `lib/brief.mjs:156`, `lib/audit.mjs:200`;
- `renderKnownUnknowns` exists twice, near-identically — `lib/brief.mjs:177`,
  `lib/audit.mjs:268`;
- `lib/audit.mjs` carries its own escapers — the inline `esc` at `:209`,
  `escCell` at `:356`, and inline pipe-escapes at `:283` and `:311` — beside the
  `escapeCell` the writer family already exports and `lib/brief.mjs:31` already
  imports.

ADR-0015 removed the *predicate* half of this drift (one `claimOf`, one
`traceOf`); what is left is the *rendering* half. The two renderers are the
place where a wrong join or a changed column order produces a plausible document
and no red suite, which is the same argument that re-raised ADR-0015.

**Note for the next review:** this item is **not** the 2026-09-14 review's
candidate 3 (the corpus joins). That one is settled by ADR-0015. The joins are
owned; the tables drawn from them are not.

**Solution (as raised).** One owner for the verified-claim table and one for the
known-unknowns list, both consumed by the brief and the audit, with the
escapers coming from the writer family rather than being restated.

**Disposition: DEFERRED — not now.** Operator: *"this kit has never completed
one real research cycle, and refining it against guesses about how it will be
used is what the kit exists to prevent."*

**Trigger proposed by this review** (so the deferral is dated rather than open;
not an operator ruling): revisit after the kit has carried **one full cycle on a
real topic** — corpus collected, brief drafted, audits written, handed to a
builder — or earlier if the brief and an audit are seen to render the same claim
differently. Until then the duplication is cheap and the shape it should settle
into is a guess.

### 3 — The deploy step is still CLI-shaped

- **Strength:** Worth exploring (a re-raise)
- **Files:** `bin/install.mjs`, `lib/installer.mjs`, `lib/scaffold.mjs`

**Problem.** A re-raise of the 2026-09-14 review's candidate 4, deferred there.
The justification for raising it again is that the entrypoint has *gained*
policy since — the doctor/handoff/role next steps, the `--into` per-project
binding — while still executing at module top level: `HOME` and `INSTALL_DIR`
are computed from `os.homedir()` at load (`bin/install.mjs:31-32`), `argv` is
read at `:38`, and the deploy work runs from `:152` down. `copyTree` (`:58`),
`skillTemplate` (`:79`) and `assertIsProject` (`:110`) are policy living in the
adapter layer, beside `lib/scaffold.mjs`'s own tree walk and template
substitution. The consequence is the one the 2026-09-14 review named and this
round confirms: **the only test adapter is a spawned child process with a fake
`HOME`** — one adapter, and the review called it a hypothetical seam itself.
The deploy policy is exercised end-to-end, never at its interface.

**Solution (as raised).** Pull the deploy decisions into a module whose
interface takes `{ source, installDir, skillRoots, into, dryRun, skipExisting }`
and returns added/updated/unchanged/skipped, so the in-process adapter exists
and the seam stops being hypothetical. The spawn-based tests stay as integration
pins.

**Disposition: DEFERRED again — not now.** Same reason as candidate 2, quoted
there: the kit has never completed one real research cycle, and refining a tool
against guesses about how it will be used is what the kit exists to prevent.
Being the second deferral, it is recorded with that count: the justification for
the re-raise stands, and the reason to wait does not depend on it.

**Trigger proposed by this review:** revisit when a second deploy target exists
(a second adapter — which is what would make the seam real rather than
hypothetical), or when the deploy step's policy changes again and the
spawn-based suite is the only thing standing between it and a person's machine.

## Aftermath

- **Suite:** 311 tests, 20 test files, all passing. No test was added or removed
  by this round's change — 17 were relocated verbatim, and the differential run
  above is what makes "identical behavior" a measurement rather than a claim.
- **Modules:** `lib/` is 25 files (23 modules and the two compatibility shims),
  and every one of them is named in `docs/ARCHITECTURE.md`, `lib/finding.mjs`
  included.
- **Preflight (this repo):** unchanged — `PASS`, 10 warnings, 0 failures.
- **Overrides:** 0.
- **Record produced:** ADR-0016 (superseding ADR-0009, unedited), the map update
  in the same commit, the **finding** term in `CONTEXT.md`, and this document.
  One commit, one revertible task.
- **Standing correction carried forward:** reviews land in `docs/`. Three did
  not, and a future review paid for it by having to ask which items were meant.
