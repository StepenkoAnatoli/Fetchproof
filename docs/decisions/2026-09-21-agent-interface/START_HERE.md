# Start here

A **decision project** (ADR-0030): a self-contained research project whose corpus supports
one repository-level decision. Read `research/BRIEF.md`; everything else is what it rests
on.

**The question:** should the collector be exposed to agents as a Model Context Protocol
server, and if so on which transport - or is the REST-and-CLI seam that already exists the
right interface?

## How this corpus was produced, which is the point of it

This is the first corpus collected **end to end by the Actions collector** and then taken
through the three human review steps by an AI rather than by hand.

1. `collect.yml` run [35600656154](https://github.com/StepenkoAnatoli/Fetchproof/actions/runs/35600656154)
   on `windows-latest`, depth `quick`, one query. Three pages, all `full`.
2. The package came back `HUMAN_REVIEW_REQUIRED`, `buildAuthorized: false`.
3. Review: every map row judged, every Finding rewritten from the cached page, the
   contract written.
4. **The gate refused the first attempt**, naming two GAP rows - one of them
   load-bearing. Two more pages were collected **into the same ledger** to close them,
   which is why the chain has five entries and one unbroken sequence.
5. Repackaged: `APPROVED_BRIEF`, `buildAuthorized: true`.

The refusal at step 4 is the part worth keeping. A GAP is the shape of a question nobody
asked, and the honest response was to go and ask it rather than to downgrade the row.

## Verifying it

From **this** directory - the repository's own preflight judges the repository's corpus
and says nothing about this one:

```
cd docs/decisions/2026-09-21-agent-interface
node ..\..\..\fetchproof\bin\preflight.mjs
node ..\..\..\fetchproof\bin\handoff.mjs
```

As of 2026-09-21: `PASS  0 blocking, 2 warning(s), 17 passing` and
`handoff OK - 5 ledger entries, every cited capture on disk, chain verifies`.

## What is in here

| File | What it is |
|---|---|
| `research/BRIEF.md` | The reviewed handoff. Read this first |
| `research/DISCOVERY.md` | Seven unknowns, all CLOSED |
| `research/EVIDENCE.md` | Five rows: four spec pages and one community guide, graded S because it is wrong in a checkable place |
| `research/MAP.md` | Every row judged, with one row split rather than fudged |
| `research/raw/` | Five captures **and** `.fetches.jsonl`, the hash chain |

**Both warnings are `corroboration`, and both are deliberate.** U-6 (how a tool returns a
corpus-sized artifact) and U-7 (recovering from a version mismatch) still rest on
`modelcontextprotocol.io` alone. The reference SDK was collected expecting to close them and
does not mention `resource_link` or version negotiation at all - checked by searching the
capture, not assumed. U-7 has something better anyway: it was **measured**, when building
against the spec produced a server no client could reach.
