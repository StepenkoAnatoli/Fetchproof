# Start here

A **decision project** (ADR-0030), and the first one in this repository about something
other than the kit's own plumbing. Read `research/BRIEF.md`.

**The question:** when does the EU Deforestation Regulation actually apply?

**The answer:** large and medium operators from **30 December 2026**; micro and small from
**30 June 2027** — *unless* already covered by the EU Timber Regulation, in which case the
earlier date. Postponed twice.

## Why it exists

To test whether the kit produces research a builder could act on **in a domain it knows
nothing about**. Every other corpus here is about GitHub, Node, MCP or this kit's vendors,
where the reviewer already knows enough to catch a bad answer.

A prior was written down **before collecting**: "30 December 2025 … 30 June 2026,
confidence high." That is a year wrong on both dates, and the corpus corrected it.

## The part worth reading even if you do not care about deforestation

**The first collection returned eight captures and none of them were about the EUDR** — SEC
filings, CFPB regulations, California water boards. The search had matched the word
"regulation."

That corpus would have passed every structural check: eight captures, verifying hash chain,
recorded transports, no partial grades. **No check asks whether the evidence is about the
topic.** `research/BRIEF.md` has the isolation showing it was the search provider, not the
query and not the kit.

## Verifying it

From **this** directory:

```
cd docs/decisions/2026-09-22-eudr-dates
node ..\..\..\fetchproof\bin\preflight.mjs
node ..\..\..\fetchproof\bin\handoff.mjs
```

As of 2026-09-22: `PASS  0 blocking, 0 warning(s), 15 passing`, passes `--strict`, and
`handoff OK - 8 ledger entries, chain verifies`.
