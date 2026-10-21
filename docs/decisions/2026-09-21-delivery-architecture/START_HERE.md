# Start here

This is a **decision project**: a self-contained research project whose corpus supports one
repository-level architectural decision. It is not the repository's own research project -
that one lives at the repository root and answers a different set of unknowns.

The question here: **how should Fetchproof be delivered to a non-technical user?**

Read `research/BRIEF.md`. Everything else is what it rests on.

---

## The convention this project establishes

> Research supporting a repository-level architectural decision lives in a self-contained
> project at `docs/decisions/<date>-<decision-name>/`.
>
> Temporary scratch projects may be used for experiments, but **their findings cannot
> support a committed decision unless the complete evidence corpus and ledger are
> preserved.**

The second sentence exists because of a specific failure. The first attempt at this
research collected nine pages into a temporary directory outside the repository, read the
findings, and then deleted the directory as routine cleanup - taking the captures, the
hash-chained ledger and the provenance for every claim. What survived was a recommendation
with nothing under it. See `../../preliminary-2026-09-21-delivery-architecture.md`, which
is that note, kept and labelled rather than quietly promoted.

Why nested rather than a second repository, or a multi-topic contract: `readCorpus(root)`
reads one `research/` per project root and a project has exactly one discovery contract, so
a self-contained directory is the shape the kit already supports. Every command works by
changing into this directory first. No protocol change, no second repository per decision,
and the reasoning sits beside the thing it reasons about.

---

## Verifying this project

**From this directory.** The parent repository's preflight judges the parent corpus and
says nothing about this one; quoting it here would be the same category error that produced
the preliminary note.

```
cd docs/decisions/2026-09-21-delivery-architecture
node ..\..\..\fetchproof\bin\doctor.mjs
node ..\..\..\fetchproof\bin\preflight.mjs
node ..\..\..\fetchproof\bin\handoff.mjs
```

As of 2026-09-21 that is `READY`, `PASS  0 blocking, 3 warning(s), 17 passing`, and
`handoff OK - 9 ledger entries, every cited capture on disk, chain verifies`.

---

## What is in here

| File | What it is |
|---|---|
| `research/BRIEF.md` | The reviewed handoff. Read this first |
| `research/DISCOVERY.md` | The contract: eight unknowns, all CLOSED |
| `research/EVIDENCE.md` | Nine rows, each pointing at a cached page |
| `research/MAP.md` | The topic decomposition, every row judged, plus two stated gaps |
| `research/raw/` | The nine captures **and** `.fetches.jsonl`, the hash chain |
| `research/plan.json` | What was collected and why |

`research/raw/.fetches.jsonl` is committed deliberately. A decision project whose ledger
does not travel proves nothing, which is the whole lesson above.

---

## Starting another decision project

```
node ..\..\..\fetchproof\bin\new-project.mjs docs/decisions/<date>-<name> --topic "<question>"
```

Then fill `research/DISCOVERY.md` with unknowns that would change the design if guessed
wrong, collect, do the three human steps, and commit the corpus with the ledger.

---

## Budget

This project's collection cost **9 credits** - nine pages, no searches, nothing cached,
nothing failed. `research/raw/.usage.jsonl` records the run and is not committed; it is
machine-local state, not evidence.

**All three warnings are deliberate.** Two are `corroboration`: U-4 because a stability marker
is Node's statement about Node, and U-6 because GitHub is the only witness to its own
permission model. The third is `partial-render` on the GitHub pricing page - the page prints
a load-failure notice while carrying the minute quotas perfectly well, which is exactly the
false-positive shape ADR-0037 measured and chose to keep as a warning.
