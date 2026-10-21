# Start here

A **decision project** (ADR-0030). Read `research/BRIEF.md`; everything else is what it
rests on.

**The question:** on a public repository, who can actually read a workflow run - its shape,
its logs, and the artifact it produced?

## Why it exists

ADR-0035 measured an **anonymous** caller and found only the run's shape exposed. It closed
with a section headed "What is NOT measured, and is therefore not claimed": what a
**signed-in** user sees. That gap was load-bearing, because the collector's logs echo the
dispatched topic and the artifact *is* the corpus.

This closes it, and the answer is the less comfortable one: **any signed-in GitHub account
can read the logs and download the artifact.** The `401` and `403` ADR-0035 measured are
refusals of anonymity, not of strangers.

## How it was collected

Dispatched through `bin/collect-remote.mjs` - the agent path, the same one an AI would
use - as run
[35620262684](https://github.com/StepenkoAnatoli/Fetchproof/actions/runs/35620262684),
depth `quick`. Three pages, all `full`, all from `docs.github.com`.

The `corroboration` check reports that as `one-voice` rather than `independent`, and it is
right to: this is GitHub describing its own permission model. Authoritative, and not a
second opinion. The warnings are left standing rather than argued away.

## Verifying it

From **this** directory:

```
cd docs/decisions/2026-09-21-public-run-visibility
node ..\..\..\fetchproof\bin\preflight.mjs
node ..\..\..\fetchproof\bin\handoff.mjs
```

As of 2026-09-21: `PASS  0 blocking, 3 warning(s), 13 passing` and `handoff OK - 3 ledger
entries, chain verifies`.

**The three remaining warnings are the principled case for single-sourcing.** U-1 to U-3 ask
about GitHub's own permission model, and GitHub is the only witness to it - a second page
would be another team at the same company restating the first. What replaced corroboration
here is **measurement**, and it caught an error a second reading would not have: U-1's
documented answer says an account is required to view run information, and an anonymous
probe returns `200` for run metadata, job listings and artifact NAMES. True of the web UI,
false of the REST API. `research/DISCOVERY.md` carries the correction and the full table.
