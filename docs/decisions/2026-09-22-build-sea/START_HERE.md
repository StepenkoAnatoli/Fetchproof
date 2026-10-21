# Start here

A **decision project** (ADR-0030). Read `research/BRIEF.md`; everything else is what it
rests on.

**The question:** the Windows `.exe` is rejected (ADR-0031, on scope). If it were ever
reopened, what would it cost — and is the packaging estimate still current?

## Why it exists

Because the estimate was already stale the day it was written. ADR-0031 recorded the
packaging story as awkward partly because producing a binary needed **postject**, an external
injector. Node v25.5.0 added `--build-sea`, which does it built in:

    node --build-sea sea-config.json

That landed *before* ADR-0031 was written. The sea-assets corpus fetched the same page and
read its stability markers correctly — nobody read the changelog entries.

**This does not reopen the `.exe`.** It only updates what reopening would cost.

## How it was collected

Run [35689363486](https://github.com/StepenkoAnatoli/Fetchproof/actions/runs/35689363486),
dispatched through `bin/collect-remote.mjs` with an **opaque** `client_ref` (`job-0922a`) —
the discipline `collect.yml` asks for, and which an earlier run of this project ignored.
Three pages, three credits.

## Verifying it

From **this** directory:

```
cd docs/decisions/2026-09-22-build-sea
node ..\..\..\fetchproof\bin\preflight.mjs
node ..\..\..\fetchproof\bin\handoff.mjs
```

As of 2026-09-22: `PASS  0 blocking, 0 warning(s), 13 passing`, passes `--strict`, and
`handoff OK - 3 ledger entries, chain verifies`.

The two warnings it *started* with were both about this project's own authorship, not its
sources — a stale `[single-witness: …]` note and an unreviewed render failure. `research/BRIEF.md`
says what they caught.
