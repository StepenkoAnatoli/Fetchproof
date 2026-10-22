# Architecture Review — fetchproof, 2026-09-14

A scan of the research-first kit for **deepening opportunities**: refactors that
turn shallow modules into deep ones, judged for testability and
AI-navigability. Domain vocabulary from [`CONTEXT.md`](../CONTEXT.md);
architecture vocabulary in its plain form — *module, interface, depth, seam,
adapter, leverage, locality*.

**Scope and method.** Git history is one squashed merge commit, so there were no
hot-spots to infer; the whole kit was read organically (19 modules in `lib/`,
10 entrypoints, hooks, tests). ADR-0001…0008 were read and are **not**
re-litigated here; none of the candidates below contradicts an ADR. Candidates 1
and 2 *extend* ADR-0003's one-owner principle (to the verdict's inputs and to
the cache decision, respectively).

**Vocabulary guard:** "component", "service", "API", and "boundary" are not used
in this document on purpose; the shared design vocabulary is the one above.

## Baseline — and the stop-the-line correction

- **Suite.** 243 tests, 15 files, no network, no Firecrawl key. One test was
  red: `the verdict accepts a corpus it did not read`
  (`test/checks.test.mjs:574`). The earlier review draft reported this as a flat
  "1 failing" bullet — that was incomplete. The precise picture, verified
  empirically: **the test is cwd-dependent.** It passes when the suite runs from
  a gated project's directory (the repo root: all 243 green) and fails when it
  runs from an ungated one (`fetchproof/`: 242 green, 1 red). The pin's
  invariant — *same snapshot, same verdict* — was only satisfied when the caller
  happened to be standing in a gated project. The defect is structural (the
  verdict derived its gate state from `process.cwd()` when a corpus was
  injected), not environmental; the environment merely decided whether the test
  noticed. A red suite is a stop-the-line event: it should have been reported
  that way from the first run, and the fix below makes the test independent of
  cwd so the question cannot recur.
- **Preflight (this repo, repo root).** `PASS` — 0 failures, 10 warnings (6
  `capture-transport` — five honest `agent page fetch` transports and one
  unnamed entry —, 3 `capture-partial` — U-2, U-3, U-4 closed on partial
  captures, disclosed in the front-matter `omitted` notes —, 1
  `citation-primary` — E-02 is `S`). 4/4 unknowns closed, 6 evidence rows, 6
  raw captures, chain intact.
- **Overrides.** 0 — `research/overrides.log` does not exist.
- **Enforcement in this sandbox.** `core.hooksPath` is unset (global and
  local), so the commit gate is not installed here; the gate's own same-commit
  map rule (ADR-0007/0008) was honoured manually for the commits this review
  produced.

## Candidates

### 1 — The gate verdict reads its inputs from three places

- **Strength:** Strong
- **Files:** `lib/preflight.mjs`, `lib/gate.mjs`, `lib/doctor.mjs`, `lib/corpus.mjs`

**Problem.** The kit's central claim is *one function, three callers — so they
cannot disagree*. But the verdict's inputs were assembled from three places at
once: `runPreflight` read the corpus (optional), built the machine-side gate
state (`gateState(root)` — the expected/global/local `core.hooksPath` triple)
inside itself, and read the operator's `evidencePolicy` from the machine config
inside the verdict function; `doctor.gateHealth()` kept a third private copy of
the hooksPath triple. So "same snapshot → same verdict" held only for callers
passing `root` — a corpus-injecting caller got its gate state from
`process.cwd()`, and the baseline test above is the pin that caught it
(5 findings vs 6: the `gate-git-local-override` line).

**Solution.** One owner of the input unit: `verdictContext(root)` in
`lib/preflight.mjs` returns `{ corpus, gate, evidencePolicy }` read together.
The corpus stays what ADR-0003 makes it (everything under `research/`); machine
state rides beside it in the unit, not inside the corpus. `runPreflight`
derives the root from the snapshot's own root (the corpus reader records
`corpus.root`), never the caller's cwd. The gate path (`evaluate`), the CLI
path, and `doctor` all consume the same owner; `readGateState` is the raw
triple for doctor's report (which also shows the triple for ungated projects).

**Benefits.** Locality: "what does the verdict read, and where from" is one
module's answer. Leverage: a new machine-state field or policy switch lands in
one place and reaches all enforcement surfaces. Tests: the input unit is the
test surface — the corpus-injection path finally has behavior to assert, and
the red pin goes green from every cwd because the bug is gone, not because the
test was adjusted.

**Disposition: ACCEPTED — shipped as A8.1 (commit `7b230ca`).**

### 2 — The cache-freshness decision has no owner

- **Strength:** Strong
- **Files:** `lib/corpus.mjs`, `lib/collect.mjs`, `lib/research-run.mjs`, `lib/decompose.mjs`

**Problem.** Three call sites decided "is this URL's raw capture fresh enough
to reuse?" three ways, over two shapes of the capture-index entry:

```
lib/collect.mjs       (ageInDays(cached.retrieved) ?? Infinity) <= refreshDays   correct
lib/research-run.mjs  (ageInDays(cached.retrieved) ?? Infinity) <= refreshDays   correct
lib/decompose.mjs     cached.ageInDays !== null && cached.ageInDays <= days      field does not exist
```

Index entries come from `readCaptures` and carry `{ file, bytes, url,
retrieved, … }` — no `ageInDays` (verified: not among the parsed front-matter
fields). So in phase 0 a cached capture was *always* stale: decompose burned a
unit of its scrape budget on the cache hit, then `collectOne` — using the
correct logic — quietly returned `'cached'` without spending a credit.
Re-decomposing a topic whose URLs were already collected could exhaust the cap
on cache hits and record genuinely new URLs as `budget` rows ("not scraped
(cap reached)") when no credit was ever at risk — real money on a 1,000-credit
free tier. To complete the picture, decompose then wrote index entries with a
third, invented shape (`{ file, retrieved, ageInDays: 0 }`). The classic
no-locality bug: the pure data is fine; the bug lived in how one caller
consumed it.

**Solution.** `cacheDecision(index, url, { refreshDays, force })` lives in the
corpus reader — the owner of the index shape — and returns `{ reuse, capture }`.
All three call sites consume it. The budget caps fetches; a reuse is not a
fetch. decompose's `force` flag deliberately stays a MAP-clobber switch, not a
re-scrape switch (behavior unchanged, now commented).

**Benefits.** Deletion test: deleting the three call-site computations
concentrates the policy in one function. Locality: "when does a fetch reuse the
cache" is one module's answer, with the index shape next to the logic that
reads it. Tests: one fixture over the index answers fresh/stale/force/missing —
including the missing-field case decompose stepped in before.

**Disposition: ACCEPTED — shipped as A8.2 (commit `5bfdfa0`), separate commit
as ordered. Tests: `cacheDecision` unit plus the regression pin
`phase 0: a cache hit does not consume the scrape budget`, which fails against
the old decompose code.**

### 3 — The research corpus exposes the parts, not the joins

- **Strength:** Worth exploring
- **Files:** `lib/corpus.mjs`, `lib/checks.mjs`, `lib/timeline.mjs`

**Problem.** The corpus reader pre-computes `evidenceById` and `capturesByUrl`,
but the two joins its consumers need most are not among them, so every
consumer re-derives them with its own `find()` and its own copy of the
predicate:

```
scrapes.find(e => e.url === row.url && (!row.raw || e.raw === row.raw))
  - checks.mjs:149 (provenance), checks.mjs:214 (transport-provenance),
    timeline.mjs:66 (evidence events)   — byte-identical
corpus.captures.find(c => c.file === row.raw)
  - checks.mjs:118, :154, :375 (citations, provenance, capture-completeness)
```

The predicate is format knowledge — "how an evidence row points at its fetch
ledger entry, and what an empty Raw cell means" — and the subtle half (the
`!row.raw ||` clause) is exactly what changes when the format evolves.
ADR-0003 fixed this failure mode at the *row* level ("no module owned the
format, so no module could say whether a row was well-formed"); the same shape
of drift is available at the *join* level.

**Solution.** Move the joins into the snapshot as data: per evidence row, its
*trace* (the matching ledger entry and the matching capture), or a
`captureByFile` map beside `capturesByUrl`. Consumers stop searching and read
`row.trace`.

**Benefits.** Locality: a change to how rows trace to entries is one module's
edit. Leverage: four consumers inherit it. Tests: the trace's shape is testable
against one fixture corpus; check tests stop re-fixturing ledger entries to
match the predicate.

**Disposition: DEFERRED — not now. Operator: "three and four are real but they
are tidiness on working code." Revisit when a format change touches the join
predicate.**

### 4 — The deploy step is CLI-shaped

- **Strength:** Worth exploring
- **Files:** `bin/install.mjs`, `lib/installer.mjs`, `lib/scaffold.mjs`

**Problem.** Entrypoints are meant to parse flags, inject adapters, and render
— own no policy. `bin/install-hooks.mjs` follows that (decisions live in
`lib/installer.mjs`), but `bin/install.mjs` — the deploy step — owns its policy
inside the entrypoint: `copyTree()` (a second tree walk beside
`scaffoldProject`'s), `skillTemplate()` (a second `{{KIT}}` substitution beside
`scaffold.renderTemplate`), `assertIsProject()` and the
overwrite-by-default/skip-existing decision, and `INSTALL_DIR` /
`PERSONAL_SKILL_DIR` computed from `os.homedir()` at module load — not
injectable in-process. The cost shows up in the test surface: **one adapter
exists — the child process**; `test/install.test.mjs` spawns the CLI with a
fake `HOME` for every assertion. One adapter is a hypothetical seam: the deploy
policy is exercised end-to-end, never at its interface.

**Solution.** Pull the deploy decisions into `lib/deploy.mjs` whose interface
takes `{ source, installDir, skillRoots, into, dryRun, skipExisting }` and
returns added/updated/unchanged/skipped. Template substitution collapses to the
one `renderTemplate` in scaffold.mjs. A second adapter (in-process tests with
injected paths) makes the seam real — the same arithmetic that made the
transport seam testable offline (ADR-0005).

**Benefits.** Locality: "what does deploy change on my machine, and when does
it refuse" is one module's answer. Leverage: a new deploy target or
substitution token is one edit. Tests: the spawn-based tests stay as
integration pins; the policy gets a unit surface, including "dry run writes
nothing anywhere" at the level where it is decided.

**Disposition: DEFERRED — not now. Operator: "real but it is tidiness on
working code."**

### 5 — The Finding extractor is living inside the collector

- **Strength:** Speculative
- **Files:** `lib/collect.mjs`, `test/collect.test.mjs`

**Problem.** `lib/collect.mjs` declares one ownership — "one URL's journey" —
but roughly two-thirds of the file is a different concept: the
auto-extracted **Finding** (seven regex families, sentence splitting, a graded
score, a 220-character cap), which the in-file history shows iterates against
real fetches. The extraction is already a deep module waiting to happen —
interface of two arguments over a large implementation — just buried in the
middle of another module, so heuristic tweaks churn the collector's diff.

**Solution.** Move the extractor to `lib/finding.mjs` with `firstFinding` as
its whole interface. A boundary move, no behavior change.

**Benefits.** Locality: a heuristic learned from a new fetch shape lands in one
module's diff; the extractor's test surface splits from the pipeline's.

**Disposition: REJECTED — not built. Operator: "a refactor of 140 lines of
working heuristic for a better address — the risk is real and the gain is
aesthetic." Recorded so a future review weighs the same trade-off against this
call rather than re-deriving it from scratch.**

## Top recommendation — and why it was the right one

Candidate 1. It was the only candidate the codebase was already arguing with
itself about (the red pin), the invariant it guards is the one the whole gate
design rests on, and its leverage is maximal: every enforcement surface and
doctor's gate report flow through the verdict's inputs. The deletion test
passed cleanly — the scattered assembly concentrated in one module instead of
moving. It also turned out to be a **correctness bug, not a tidiness one**:
the gate could disagree with itself depending on where a corpus-holding caller
stood. Candidate 2 was the first *behavioral* fix and landed separately as
ordered; candidate 3 pairs naturally with candidate 1's context and is queued
behind it.

## Aftermath

- Suite: **247 tests, all passing, from every cwd** (243 baseline + 2 verdict
  context pins + 1 cacheDecision unit + 1 phase-0 budget pin; nothing removed;
  the formerly cwd-dependent pin is now cwd-independent).
- Preflight (this repo): unchanged — `PASS`, 10 warnings, 0 failures.
- Overrides: 0.
- Commits: A8.1 `7b230ca`, A8.2 `5bfdfa0` (each carrying its same-commit map
  update per ADR-0007/0008 and its `CONTEXT.md` term: *verdict context*,
  *cache decision*).
