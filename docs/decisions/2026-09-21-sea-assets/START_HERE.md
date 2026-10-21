# Start here

A **decision project** (ADR-0030). Read `research/BRIEF.md`; everything else is what it
rests on.

**The question:** ADR-0031 deferred the local Windows `.exe` with a dated trigger - revisit
when `useVfs` reaches Stability 1.1. Is that trigger the right one?

## Why it exists

It is not. The trigger was checked and the **premise under it turned out to be false**: the
kit does not need `useVfs` to read its own bundled files. The `assets` configuration key and
the `sea.getAsset()` family do that, they predate the VFS by years, and they sit at the
feature's own Stability 1.1. The `1.0 - Early development` marker ADR-0031 cited is real and
attaches only to the VFS section - a convenience the kit can decline.

So the `.exe` was waiting on a condition it never depended on. ADR-0031 carries an amendment
saying so.

## How it was collected

Dispatched through `bin/collect-remote.mjs` - the agent path - as run
[35623502540](https://github.com/StepenkoAnatoli/Fetchproof/actions/runs/35623502540),
depth `quick`. Three pages, all graded `full`. One is authoritative and current, one is a
stale mirror of it, and one rendered no content at all.

**That one-in-three hit rate is the second finding, and it is deliberately not hidden.**
`EVIDENCE.md` keeps all three rows and cites one. The mirror also found a real limitation in
this repository's own `corroboration` check, recorded in ADR-0036.

## Verifying it

From **this** directory:

```
cd docs/decisions/2026-09-21-sea-assets
node ..\..\..\fetchproof\bin\preflight.mjs
node ..\..\..\fetchproof\bin\handoff.mjs
```

As of 2026-09-21: `PASS  0 blocking, 3 warning(s), 13 passing` and `handoff OK - 5 ledger
entries, chain verifies`.

**None of the three is a corroboration finding** - both unknowns now rest on two distinct
documents across two hosts. All three are `capture-completeness/partial-render`, added by
ADR-0037 hours later: three of the five captures print a load-failure notice, including both
Node pull requests that carried their content perfectly well. It therefore fails `--strict`,
which it briefly did not. `research/BRIEF.md` explains why that number moving is the gate
working rather than the corpus rotting.

**It did not, at first**, and the reason is worth the two minutes. Both unknowns rested on
`nodejs.org` alone, and this brief argued at length that they should stay that way: the only
second source found was a stale mirror, and citing a mirror to clear a warning makes a corpus
read stronger while making it weaker.

That argument was sound about the evidence in hand and **wrong about the evidence that
existed.** A second look found the two pull requests - the assets API proposed 2023-11-29,
the VFS proposed 2026-01-22, two years apart, on a different host - which is primary evidence
that was there all along. A `single-source` warning sometimes means "a vendor is authoritative
about itself" and sometimes means **"nobody looked twice"**, and the check cannot tell those
apart. `research/BRIEF.md` keeps both the original argument and the correction.
