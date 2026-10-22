# Architecture Review — fetchproof, 2026-09-15 (third round): triaged, not yet scheduled

A record of what the five-fix round (`ba5fd1d`, `3cb8a54`, `58eb2b8`, `ddd70b3`,
`2924cb0`; [ADR-0020](adr/0020-five-trusted-boundaries-that-did-not-hold.md))
**found and deliberately did not fix**. Domain vocabulary from
[`CONTEXT.md`](../CONTEXT.md); architecture vocabulary in its plain form — *module,
interface, depth, seam, adapter, leverage, locality*.

This is the **third** review of 2026-09-15 and the first whose subject is not
deepening. These are defects, all lower-severity than the five that were scheduled,
and all of them are in the same class ADR-0020 names: a trusted boundary that does
not hold, failing **silently** or **mis-attributed**. They are written down here
rather than fixed inside a commit about something else, because a finding that lives
only in a conversation is a finding the next round re-derives from scratch — which
has already happened three times, and is the reason reviews land in `docs/`.

**Status of every item below: triaged, not scheduled** — except item 1, which the
operator escalated and which is now fixed by ADR-0021; its entry carries the note. Each carries the evidence
that makes it real rather than speculative, the reason it did not make this round,
and what would expire the deferral.

## Baseline

- **Suite.** 368 tests, 21 test files, no network, no Firecrawl key, green.
  325 before the round; +11 (C1), +8 (C2), +8 (C3), +11 (C4), +5 (C5).
- **Preflight (this repo, repo root).** `PASS` — 0 failures. Chain intact, 7 ledger
  entries, 6 cited captures on disk.
- **Handoff (this repo).** `COMPLETE` — verified under a `core.autocrlf=true`
  re-checkout, which is what C4 was for.
- **Doctor.** exit 0.
- **Overrides.** 0 — `research/overrides.log` does not exist.
- **Enforcement in this sandbox.** `core.hooksPath` is unset, so the commit gate is
  not installed here; the same-commit map rule (ADR-0007/0008) was honoured manually
  for every commit this round produced.

## Findings

### 1 — The test harness prints `ok` for an async test it never awaited

> **FIXED 2026-09-15, after this document was written** —
> [ADR-0021](adr/0021-the-test-harness-awaits-its-tests.md). Escalated out of the triaged
> set by the operator, on the argument made in "Why it is the most serious item on this
> list": the proof given for the five fixes rested on a count this harness produced, so
> "368 ok" was only as trustworthy as `ok` was. The reproduction came out **worse** than
> recorded here — a fixture holding one failing async test printed `ok`, then
> `all tests passed`, then **exited 0**, because the runner's `process.exit(0)` pre-empts
> even the unhandled rejection. So there was no noisy crash to notice either. The rest of
> this entry is left as written: it is the record of what was found. Five items remain
> triaged.

- **Where.** `fetchproof/test/harness.mjs:148` — `runPending`.
- **Evidence.** Confirmed by reading the loop: `fn()` is called and its throw is
  caught synchronously, then `console.log('  ok    ${name}')` runs. An `async` test
  returns a pending promise; nothing awaits it, so `ok` is printed before the body
  has finished, and a rejection becomes an unhandled rejection that never reaches
  the failure counter. `summary()` counts what `runPending` counted.
- **Why it is the most serious item on this list.** It is the same defect class as
  C5 — a boundary that does not hold, failing silently — in the one module whose
  entire job is to make failures visible. Every other finding here is a wrong answer
  the suite could catch; this one is the suite being unable to catch anything. Two
  of this round's own race-condition tests had to be written **synchronously**
  specifically to work around it, which means the workaround is already load-bearing
  and already undocumented outside this file.
- **Why it was not scheduled.** Fixing it means making `runPending` async and
  awaiting every test, which touches the harness every test file depends on, in a
  round whose five commits were each supposed to be revertible alone. A harness
  change under all 368 tests is not revertible alone with any of them.
- **What would expire the deferral.** The next async test anybody needs to write —
  at which point the workaround becomes the obstacle rather than the accommodation.
  Or any test that is discovered to have been green while failing, which would make
  this a stop-the-line item rather than a triaged one.

### 2 — A capture path can be a symlink out of `research/raw/`

- **Where.** `fetchproof/lib/collect.mjs:53` — `writeRaw`, via
  `uniqueRawName` (`:34`).
- **Evidence.** Confirmed by reproduction. The capture name is **predictable**:
  `<today>-<slugify(title, 50)>-<hashShort(url)>.md`. Planting a symlink at that
  exact path before the fetch, then fetching, writes the capture — front-matter and
  body — to the symlink's target. In the reproduction the payload landed in a file
  outside `research/raw/` entirely, and `lstat` on the capture path still reported a
  symlink, so nothing in the write path checks what it is about to write through.
- **Why it matters here specifically.** `title` comes from the fetched page, which
  is attacker-influenced in this kit's threat model — the same premise C1 rests on:
  a `plan.json` travels through git and a query is pasted back from a web result. A
  repository can also arrive with symlinks already in it, since `research/raw/`
  travels through git and git stores symlinks.
- **Scope note.** The filename itself is *not* the escape: `slugify`
  (`lib/core.mjs:94`) collapses runs of `[\s_.]` to a single dash, so `..` cannot
  survive into a path segment. The hole is the destination's type, not its name.
- **Why it was not scheduled.** It needs a decision this round did not have scope
  for — refuse, unlink-and-replace, or write-through-and-report — and each has a
  different answer for a legitimately symlinked corpus (a researcher keeping
  `research/raw/` on another volume is not attacking anyone).
- **What would expire the deferral.** Any report of a capture written outside the
  corpus; or the moment `writeRaw` gains a second caller that takes a path from
  somewhere less controlled than the slug.

### 3 — A paid fetch that returns a thin page is logged as a failure

- **Where.** `fetchproof/lib/collect.mjs:137-143` — `collectOne`.
- **Evidence.** Confirmed by reading the branch: `if (!res.ok || markdown.length <
  200)` writes `appendFetch(root, { op: 'fail', …, raw: null })` and returns
  `{ result: 'failed' }`. Both halves of that condition collapse into one ledger
  state, but they are different events: `!res.ok` is a fetch that did not happen,
  and `markdown.length < 200` is a fetch that **succeeded and cost a credit**.
- **Why it matters.** Two consequences, and the second is the expensive one. The
  ledger cannot tell "never reached it" from "reached it, paid for it, and it was
  thin" — which is exactly the distinction the comment two lines above claims to
  preserve ("so preflight can tell 'never tried' from 'tried and could not reach
  it'"). And `raw: null` means the thin document is **discarded**: the credit bought
  a page nobody can ever inspect, so the next run cannot decide whether the page was
  genuinely thin or thinly extracted. `cacheDecision` has nothing to reuse either,
  so a retry pays again.
- **Why it was not scheduled.** It is a ledger-vocabulary change (`op: 'thin'`, or
  `op: 'scrape'` with a completeness marker and a written capture), and the ledger
  is hash-chained: adding a state means deciding what every existing reader —
  `timeline`, `preflight`, `audit`, the `collection-attempts` check — does with it.
  That is a seam-wide change, not a fix.
- **What would expire the deferral.** Any credit bill that does not reconcile with
  the ledger's `op: 'fail'` count; or a `KNOWN-UNKNOWN` row justified by a fetch
  that actually succeeded.

### 4 — `--repair` reports "nothing to do" for a chain it cannot repair

- **Where.** `fetchproof/lib/provenance.mjs:167-183` — `repairLedgerTail`;
  reported at `fetchproof/bin/preflight.mjs:95-97`.
- **Evidence.** Confirmed by reading both returns. `{ repaired: false }` is returned
  for four different situations — no ledger file, a ledger that already ends in a
  newline, a tail that is not a partial line, and **a chain broken in the middle** —
  and the CLI collapses all four into one string: `repair: nothing to do`.
- **Why it matters.** This is a no-op that looks like success, in the command an
  operator runs *after* something has already gone wrong. "Nothing to do" reads as
  "your ledger is fine". The mid-chain case is precisely the unrecoverable one that
  C2 exists to prevent and that ARCHITECTURE.md already documents as unrecoverable
  (`repairLedgerTail` no-ops on it, `rebuildLedger` refuses it) — so the one state
  that most needs a loud refusal gets the quietest possible answer.
- **Why it was not scheduled.** Small, and that is the problem: it is small enough
  to have been folded into C2, and doing so would have made C2 not revertible alone.
  It is the first thing to pick up next round.
- **What would expire the deferral.** Nothing external — this one only needs a
  return shape that distinguishes the four cases (`{ repaired, reason }`) and a CLI
  that prints the reason. It is scheduled by whoever reads this first.

### 5 — A BOM in a capture breaks the body hash, and nothing pins it

- **Where.** The same comparison C4 classified: `lib/provenance.mjs`
  `verifyLedger` → `hashFile(rawPath) !== entry.bodySha256`.
- **Evidence.** Partially confirmed. A leading `\uFEFF` changes the bytes, so the
  body hash cannot recompute — that half is arithmetic. Two adjacent risks were
  **checked and are not present**: `parseCapture` survives a BOM (probed directly —
  `url` and `retrieved` both parse identically with and without one, because the
  field regexes are multiline `^field:` and never look at the file's first
  character), and no `startsWith('---')` front-matter detection exists anywhere in
  `lib/` or `bin/` (grepped). So this is a hash-integrity finding, not a
  parser-crash one.
- **Why it matters.** It is C4's failure mode with a different cause and **no
  `.gitattributes` remedy**: git does not strip BOMs, so pinning line endings does
  nothing for one. Where CRLF is written by the platform on checkout, a BOM is
  written by whatever produced the file — an editor, a Windows tool, a paste — and
  it would arrive as `kind: 'modified'`, i.e. blamed on tampering, which is the same
  mis-attribution C4 fixed for line endings.
- **Why it was not scheduled.** C4's `isLineEndingRewrite` is the right shape for
  this and deliberately narrow: it claims to diagnose exactly one transformation,
  because a classifier that folds and strips its way to a match stops being evidence
  and starts being an excuse. Extending it to BOMs is a real decision about how many
  rewrites a body hash is allowed to survive, and it should not have been made inside
  a commit whose job was line endings.
- **What would expire the deferral.** A second rewrite class appearing in the wild,
  at which point the honest options are a general "byte-level normalisation" policy
  with a stated limit, or a `kind: 'byte-rewrite'` that names the difference without
  excusing it.

### 6 — A newline in a staged path arrives as two paths

- **Where.** `fetchproof/githooks/pre-commit` (the pipe added by C3) →
  `stagedPathsFromStdin` → `splitPathList` in `lib/gate.mjs`.
- **Evidence.** Confirmed by construction, not by reproduction. C3's protocol is
  `git diff --cached --name-only` piped to the gate and split on newlines. Without
  `-z`, git quotes a path containing a newline or a non-ASCII byte (core.quotePath),
  so such a path arrives as an escaped quoted string and is split into pieces that
  match no real file.
- **Why it matters, and why it is low.** The failure direction is **permissive**: a
  path that splits into non-existent fragments is a path the gate does not
  recognise, so a change hiding behind a newline in its filename would not be
  judged. It is not a crash and not a wrong verdict on any ordinary file.
- **Why it was not scheduled.** Decided inside C3 and recorded there: the brief's
  protocol is the newline form, `splitPathList` **already accepts NUL**, and
  `git diff -z` cannot pass through a shell `$(…)` substitution — so moving to NUL
  needs a different hook shape (a direct pipe, no substitution), which is a change
  to the thing C3 had just stabilised. The separator is a free upgrade later.
- **What would expire the deferral.** Any repository this kit guards that contains a
  path with a newline or a non-ASCII byte — at which point the hook shape change and
  the `-z` flag land together, and `splitPathList` needs no edit at all.

## Why these six and not a fix

The five scheduled fixes were each a **reproduction with a named remedy**: something
that could be run before, run after, and shown to differ. Every item above fails one
of those three tests — it needs a decision that has more than one defensible answer
(2, 3, 5), or it is too small to justify making a larger commit not revertible alone
(4), or fixing it would touch the thing that reports whether anything else is broken
(1), or it was explicitly decided against inside a commit that had just stabilised
the surrounding shape (6).

Writing them down is the part that is not optional. A finding recorded only in a
conversation is a finding the next round pays to rediscover, and this repository has
already paid that three times.

## Aftermath

- **Suite:** 368 tests, 21 test files, all passing. This document added none and
  removed none. *(Since writing: item 1 was fixed and `test/harness.test.mjs` was added
  for it — 377 tests across 22 files, and the suite is now able to prove the fix rather
  than assert it.)*
- **Preflight (this repo):** `PASS`, 0 failures. **Handoff:** `COMPLETE`.
  **Doctor:** exit 0. **Overrides:** 0.
- **Records produced by the round:** ADR-0020 (refining ADR-0002, unedited, with the
  index entry carrying the supersession note per the ADR-0009 convention), five fix
  commits each with its architecture-map update in the same commit, the
  **unreadable config** and **line-ending rewrite** terms in `CONTEXT.md`, and this
  document.
- **Standing correction carried forward:** reviews land in `docs/`, and a finding
  that is not written down is not triaged — it is lost.
