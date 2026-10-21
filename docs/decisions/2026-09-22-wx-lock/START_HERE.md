# Start here

A **decision project** (ADR-0030). Read `research/BRIEF.md`; everything else is what it
rests on.

**The question:** `lib/provenance.mjs` takes the collector's lock with `flag: 'wx'`, and
ADR-0020 says that makes the kernel refuse a second creator. Is that true, and is it
unconditionally true?

## Why it exists

It was collected to test the kit rather than to answer a question somebody was stuck on —
and it found something anyway.

**Yes, and not unconditionally.** The exclusive flag does what ADR-0020 says: 24 concurrent
creators produced one winner and twenty-three `EEXIST`. But the same paragraph of the Node
documentation adds a condition ADR-0020 does not carry:

> The exclusive flag might not work with network file systems.

ADR-0020 is one of the frozen archive documents, so the caveat is recorded where a
maintainer needs it — in `lib/provenance.mjs`, beside the lock — rather than by editing a
record of a past state.

## How it was verified

An **oracle was run before any collection**, so the corpus could not shape the answer: 24
processes racing to create one path with `flag: 'wx'`, on win32 / Node v24.20.0. One winner,
23 × `EEXIST`. The corpus agreed with it.

## Verifying it

From **this** directory:

```
cd docs/decisions/2026-09-22-wx-lock
node ..\..\..\fetchproof\bin\preflight.mjs
node ..\..\..\fetchproof\bin\handoff.mjs
```

As of 2026-09-22: `PASS  0 blocking, 0 warning(s), 14 passing`, passes `--strict`, and
`handoff OK - 4 ledger entries, chain verifies`.
