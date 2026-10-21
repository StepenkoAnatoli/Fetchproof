# Build report — tier 3, 2026-09-17

The structural pass. Same five named parts. It follows
[the build report](build-report-2026-09-17.md) and
[the hardening report](build-report-2026-09-17-hardening.md).

---

## What changed

The four findings deferred from the hardening pass, each because it changes documented
behaviour and needed a decision rather than a fix.

| Finding | What it was | What it is now | ADR |
|---|---|---|---|
| **F08** | The commit gate read the corpus off disk while git supplied staged path NAMES, so it judged different bytes from the ones about to be committed | `materializeIndex` writes the index's own content to a scratch dir and the verdict runs over that. The edit gate still reads the working tree — the opposite question. `judged` is part of every verdict | [0024](adr/0024-the-commit-gate-judges-the-index.md) |
| **F14** | Only the ledger append was locked; the capture write, the id allocation and both row updates raced | `collectOne` holds the exclusive section for its whole length. The cache is re-read inside it, and ids are allocated from the table on disk | [0025](adr/0025-one-writer-boundary-and-liveness-not-age.md) |
| **F13** | Staleness was age, so a live long-running holder was evicted while an unidentifiable stub was waited on forever | `lockRecoverable` asks whether the holder still exists: pid alive → never; pid gone → at once; foreign host → 15 min; stub → 30 s | [0025](adr/0025-one-writer-boundary-and-liveness-not-age.md) |
| **F21** | A refresh added a row and left the citation on the stale one, so the claim above it was never re-read | A twelfth check, `evidence-supersession`: an unknown citing a superseded row fails, naming the replacement. The old capture is kept | [0026](adr/0026-a-refresh-triggers-claim-review.md) |

Plus **F12's residual**, which belonged with the locking work: `appendFetch` now validates
the ledger *before* writing. Appending onto an unfinished line welded a valid entry to a
torn one — the combined line then ended in a newline, so `repairLedgerTail` would not
touch it, and the paid-for fetch it recorded was unrecoverable.

One behaviour changed that nobody asked for and that the index work made visible: a gated
project whose `research/` is **untracked** now blocks with its own named reason. Reporting
that as "your contract is missing" sends an operator to look for a file that is sitting
right there; the real defect is that the evidence is not in the repository and cannot
travel (ADR-0011).

---

## Why

These four were held back deliberately: each one changes what the kit does, not just
whether it does it correctly. F08 changes which bytes a verdict is about. F14 changes how
long a lock is held. F13 changes when a lock may be broken. F21 adds a failure mode to a
corpus that passes today. Every one of them wanted its alternatives written down before
the code, which is what the three ADRs are.

---

## What it touched

- `lib/gate.mjs` (`materializeIndex`, the index/working-tree split, the untracked-corpus
  verdict), `lib/provenance.mjs` (`lockRecoverable`, `holdsLock`, the pre-write ledger
  validation, the removed lease), `lib/collect.mjs` (the boundary, `refreshCaptures`,
  on-disk id allocation), `lib/checks.mjs` (`evidence-supersession`, the sharpened stale
  warning).
- **New tests:** `test/index-gate.test.mjs` (8) and `test/concurrency.test.mjs` (14),
  plus 4 supersession tests in `test/hardening.test.mjs`. The concurrency suite runs two
  real node processes at one corpus.
- **ADRs written:** 0024, 0025, 0026. 0025 refines ADR-0020's "one lock, one flag" — the
  `O_EXCL` acquisition stands, its scope and its staleness rule do not.
- **Registry count:** eleven checks became twelve. `test/checks.test.mjs`'s order pin is
  updated; `docs/ARCHITECTURE.md`'s count is covered by ADR-0022's byte-preservation
  exception and recorded here.

---

## What I verified

```
node fetchproof/bin/selftest.mjs
326 passed, 0 failed in 54.7s (watchdog 60000ms/test)
```

cwd: the repository root. Offline — no key, no credits, no network.

Each finding re-probed by execution, not by re-reading the code:

```
F08 FIXED  judged the index; allow=false (working tree says CLOSED, index says OPEN)
F14 FIXED  two collectors, stale snapshot -> ids E-01, E-02
F13 FIXED  6h-old live holder recoverable=false; dead holder recoverable=true
F21 FIXED  E-01 superseded by E-02, citation must move
```

The F14 proof that matters is not that probe but the suite's: two **separate node
processes** collect into one corpus, each holding the section for 400 ms, and afterwards
both evidence rows survive, both captures exist, ids are `E-01`/`E-02`, and the chain
verifies.

---

## What I got wrong and fixed

Three, all inside this pass.

1. **I shipped a lease with a heartbeat that could never beat.** F13's first implementation
   renewed the lock from a `setInterval`. The collector is synchronous — the adapter is a
   `spawnSync` — so the event loop is blocked for exactly the stretch the renewal needed to
   fire, and the lease would have expired *during the slow fetch it existed to protect*. My
   own test caught it by blocking the loop for 16 seconds and finding the mtime unchanged.
   The renewal machinery is gone; liveness (`kill(pid, 0)`) replaced it, which is one
   syscall and cannot drift. Shipping the timer would have been worse than the age check it
   replaced, because it would have looked like a guarantee.

2. **The first index-gate cut produced three confusing findings for one cause.** A gated
   project with an untracked `research/` reported `contract-missing`, `ledger-missing` and
   `raw-missing` — all technically true of the index, none of them the actual problem. It
   now has one named verdict and the right fix.

3. **Two of the kit's own tests were asserting nothing about commits.** `a passing project
   allows the commit` used a fixture whose corpus was never `git add`ed, and `a staged code
   change BLOCKS` edited the contract in the working tree without staging it. Both passed
   under the old semantics while proving nothing; both now stage what they claim to be
   testing. Finding them was the point of the change.
