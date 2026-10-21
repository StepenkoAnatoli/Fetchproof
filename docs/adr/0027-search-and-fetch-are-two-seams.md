# ADR-0027 — Search and fetch are two seams, not one adapter

- **Date:** 2026-09-19
- **Status:** accepted
- **Area:** collector, transport selection, provenance
- **Supersedes in part:** ADR-0005 (which remains correct about *where* vendor knowledge lives)
- **Requirements:** `docs/requirements-2026-09-19-search-fetch-seam.md`

## Context

ADR-0005 put all vendor knowledge in one adapter and gave it a seven-function shape:
`name`, `scrape`, `search`, `map`, `command`, `status`, `runScrape`. `selectTransport`
picks exactly one of those adapters and every caller uses it for everything.

That was right when there was one vendor. It has one consequence nobody chose: **a single
free allowance pays for both halves of a run.** At `perQuery: 2` a plan query costs 2
Firecrawl credits to search and 2 to scrape — 4 of 1,000 a month (E-03, E-14). Every
search spent is a page not fetched.

Research (`research/BRIEF.md`, gate PASS at `ad26daf`) established that SerpAPI's free
tier is 250 searches a month, bills **per response rather than per result**, and serves
an identical query from its own cache for an hour free and uncounted (E-07, E-09). The
benefit of adopting it is not a lower unit price. It is that search and fetch stop
drawing on the same meter.

But the shape blocks it. SerpAPI cannot scrape. Selecting it as "the transport" would
leave five of seven functions undefined and would stamp captures — which it never
produced — with its name.

## Decision

**`selectTransport` resolves two providers independently.** A *fetch provider* produces
captures; a *search provider* produces candidate URLs. Each resolves through the existing
precedence ladder (explicit flag → environment → machine config → auto-detect).

Two contracts are declared, as `ADAPTER_SHAPE` is today:

```js
FETCH_SHAPE  = ['name', 'scrape', 'runScrape', 'map', 'status', 'command']
SEARCH_SHAPE = ['name', 'search']
```

An adapter may satisfy both — `firecrawl.mjs` and `http-transport.mjs` do, and remain the
default for both sides. `serpapi.mjs` satisfies `SEARCH_SHAPE` only, declares that, and
answers a request to fetch with an error that names the reason rather than a missing-
function `TypeError` (AR-3).

**The return value is extended, not replaced.** `selectTransport` keeps returning
`{ name, adapter, why }` meaning exactly what they mean today — the fetch provider — and
gains a `search: { name, adapter, why }` alongside. Every existing caller keeps working
unread and unedited (NFR-2). This is the load-bearing choice in the whole ADR: it is what
makes the change additive rather than a rewrite of six call sites.

**Provenance stays split the way the meters are.** A capture is stamped with the **fetch**
provider, because that is what fetched it. `transport-provenance` is not touched (AR-4):
it judges captures, and SerpAPI produces none. What is added is smaller and new — a URL
promoted from a search records which provider ranked it (DR-2), because two providers'
rankings are two different provenance claims and `from: "query: …"` cannot carry both.

**With no SerpAPI credential, nothing changes.** The search provider auto-resolves to the
fetch provider and the run is byte-identical to today's (FR-5, TR-8). An opt-in that
alters the default is not an opt-in.

## Alternatives considered

**1. Add `serpapi` as a third entry in `TRANSPORTS`.**
The smallest diff, and wrong. `TRANSPORTS` is a map of things that satisfy the whole
adapter shape; adding a search-only module makes the shape a claim the map no longer
keeps. An operator who set `--transport serpapi` would get a run that cannot fetch
anything, discovered at the first scrape rather than at selection.

**2. Merge two modules into one composite adapter object.**
`{ ...firecrawl, search: serpapi.search }`. Tempting, and it destroys the thing this kit
exists to protect: `adapter.name` is a single string, and it is what stamps captures. A
merged name is either a lie about who fetched the page or a lie about who ran the search.
The check whose entire job is to say how a capture was obtained would be reading a label
that no longer means one thing.

**3. Choose the provider per query in `plan.json`.**
Rejected on layering. `plan.json` is research intent and lives in the corpus; provider
availability is a property of the machine. Putting a machine capability in a checked-in
research file means a corpus that only runs on the box that wrote it, and it puts a
credential-shaped decision one edit away from a file that gets committed.

**4. Do nothing; buy more Firecrawl credits.**
The honest baseline, and it costs money to solve a problem that two free tiers solve for
nothing. Worth stating because it is the alternative that needs no code at all: if this
seam turns out to carry ongoing complexity that the operator does not want, $16/month for
Firecrawl Hobby (E-02) buys 5,000 credits and this ADR can be reverted.

## Trade-offs

**What this costs.** Two providers mean two failure modes, two rate limits, and a
degradation path that has to be written and tested (RR-1, RR-2). `selectTransport` grows
a second resolution it must keep symmetric with the first. `doctor` grows a line. There is
now a credential in the picture that was not there before, with all of SR-1 through SR-5
attached to it.

**What it buys.** Roughly 250 searches *and* 500 scrape-backed queries a month against
today's ~250 combined — on two free tiers, no card on either. Plus the thing that matters
more day to day: SerpAPI's 1-hour free cache means re-running the same plan while
developing costs nothing at all (C-3), where today every re-run burns credits.

**What it does not buy.** Not reliability — one provider down still degrades the run.
Not speed. Not better results; nobody has measured result quality and this ADR does not
claim any.

## Risks

| Risk | Mitigation |
|---|---|
| The key leaks into the repo, a log, or a capture. It travels as a URL query parameter, which is the worst place for a secret to live. | SR-1–SR-4: config/env only, redacted in every human-facing rendering including error text, asserted in tests against a sentinel, and the existing secret scan keeps running with no new exclusion. |
| Free-tier collection has no indemnity — the $2M Legal Shield excludes Free, Starter and Developer plans (E-10). | Stated in the requirements and in the operator docs. Acceptable for a solo operator reading public vendor documentation; not acceptable for redistribution, and that line is written down rather than assumed. |
| The fallback silently spends Firecrawl credits when SerpAPI fails. | RR-2: bounded to one attempt, and reported in the run summary rather than absorbed. |
| Query text goes to a third party that keeps it 31 days, with no `zero_trace` available below Enterprise. | SR-5. This is the same disclosure that disqualified Tavily (E-16); applying it honestly to the provider we *are* adopting is the only consistent position. |
| Undocumented vendor parameters. This project has paid for that twice. | IR-4: send only what the captured reference documents. `num` was specified and removed for exactly this reason. |
| The two selections drift apart as one is edited. | AR-1: one function resolves both, and TR-6 exercises all four precedence positions on the new side. |

## Consequences

- `lib/transport.mjs` gains a second resolution and two shape constants. Its role as the
  single reader of provider choice is unchanged and reinforced.
- `lib/serpapi.mjs` is new: one vendor, search only, no dependencies, injectable network.
- `lib/research-run.mjs` and `lib/decompose.mjs` read `chosen.search.adapter` for searching
  and keep reading `chosen.adapter` for fetching.
- `lib/doctor.mjs` reports both.
- `lib/machine.mjs` gains a `searchTransport` key.
- The usage and failure logs gain a provider field (DR-1, DR-4). The **fetch ledger is
  untouched** (DR-3) — searches are not fetches and must not enter the hash chain.
- `docs/ARCHITECTURE.md` and `LAYOUT` name the new module in the same commit (ADR-0007).

### Added 2026-09-20 — the endpoint seam

`search({ endpoint })` was added so the transport path could be tested rather than
argued: parent → `spawnSync` → child → real `fetch` → real socket, against a local
stand-in server. Before it, everything between "the parent builds a job" and "the parent
gets an answer" was covered only by a human running commands once.

It is **guarded**, because an overridable endpoint on a request that carries an API key
is an exfiltration route. `allowedEndpoint` permits the vendor's own host over https, or
a loopback address — nothing else — and the check runs in both halves: the parent refuses
before spawning, and the child refuses before fetching, because the child is a separate
program reading a job off a pipe and does not get to trust it.

Writing that test found something worth recording about this design: the first version
hosted the stand-in server in the test process and every request timed out. The adapter
shape is synchronous, so the parent reaches the vendor through `spawnSync`, which blocks
its own event loop; a server living in that loop can never accept the connection. The
rendezvous that makes an async `fetch` fit a synchronous contract is also the thing that
makes in-process testing of it impossible. The stand-in runs in its own process.

## Verified on a real runner, 2026-09-22 — and the seam was doing nothing until today

This ADR split search from fetch so search could run on its own meter. **On the collector
that split had never taken effect**, because `collect.yml` never passed the search
credential. `SERPAPI_API_KEY` was configured exactly where ADR-0033 requires — an
environment secret on `research-collection` — and no workflow referenced it, so every
dispatched run fell through the ladder to its last rung and billed search to Firecrawl.

Two runs of the same collector, before and after wiring it:

| | run | `search:` line |
|---|---|---|
| before | [35689363486](https://github.com/StepenkoAnatoli/Fetchproof/actions/runs/35689363486) | **none** — when search *is* the fetch provider the selection reports `sameAsFetch` and prints nothing |
| after | [35691439943](https://github.com/StepenkoAnatoli/Fetchproof/actions/runs/35691439943) | `search:    serpapi - a SerpAPI key is configured - searching on its own meter, leaving the fetch budget for pages` |

The second run also logs the choice **before spending**, and the credential appears as
`SERPAPI_API_KEY: ***` — redacted by the runner, never in argv.

### ISOLATED 2026-09-22 - the saving below is no longer inferred

The section that follows says the saving was "consistent with, not proven", because the
first verification run performed **no search at all** (`searches 0`): SerpAPI was selected
and never exercised. A third run fixed that by giving the plan room to search.

Run [35692202192](https://github.com/StepenkoAnatoli/Fetchproof/actions/runs/35692202192),
depth `quick`, both credentials present and redacted as `***`:

    search:    serpapi - a SerpAPI key is configured
    collected  3
    searches   1 on serpapi

One search, three scrapes. Firecrawl balance **831 before, 828 after** - a drop of exactly
three, the page count. Had the search been billed to Firecrawl it would have cost roughly two
more, landing on 826.

**So the search cost zero fetch credits, and the two meters are separately exercised rather
than merely separately selected.** That is the claim this ADR made when it split the seam,
and it is the first time the split has been measured end to end on a real runner.

### What the credits show, and what they do not

Measured balances, not arithmetic: **841 before the last three runs, 831 after.** Ten credits
against eight scraped pages. The two unaccounted credits are consistent with one Firecrawl
search in the pre-fix run — Firecrawl charges roughly two credits per search — and this run
spending none, because SerpAPI took it.

**Consistent with, not proven.** The usage log that would settle it is local to the runner
and deliberately excluded from the artifact, so the per-run split cannot be reconstructed
after the fact. The selection is proven by the log line; the saving is inferred.

### A measurement error of mine, recorded because it nearly became a false finding

Seeing four credits spent on a two-page run, I concluded the fix had not worked and started
looking for the bug. It had worked. My baseline of "835" was **asserted in a summary and
never measured** — only 841 and 831 were ever read from the vendor. An arithmetic chain
anchored on a number nobody measured is not a measurement, and it pointed at a defect that
did not exist.

The run log settled it in one line. The order should have been: read the log the run already
wrote, then reason about balances.

## What the wiring defect did and did not invalidate, 2026-09-22

The obvious worry, asked as soon as the defect was found: **if search was broken, is the
research collected before the fix still good?**

Checked rather than assumed. **No corpus is invalidated, and none was re-collected.**

### The defect was a metering defect, and the ledgers prove the blast radius

`SERPAPI_API_KEY` never reached the collect step, so the search side fell back to the fetch
provider and search was billed to Firecrawl credits. It changed **which vendor performed a
search**. It did not change what a page contains, what was fetched, or what was recorded.

Counted across all six corpora on `main`:

| | |
|---|---|
| captures | **66** |
| ledger entries of op `scrape` | **66** |
| ledger entries of op `search` | **0** |
| chains that verify | **6 of 6** |

**Not one committed evidence row rests on a search.** A search produces candidate URLs; only
a scrape produces a capture, and every capture in this repository is a direct page fetch with
a recorded body hash. Most of the corroboration work made that explicit by setting
`plan.queries = []` and listing URLs directly.

### The one nuance, stated rather than waved away

Two corpora were collected through the runner (`2026-09-21-sea-assets`,
`2026-09-22-build-sea`), and on those a search may have chosen which candidates got scraped.
The pre-fix log format does not print a search count when search *is* the fetch provider, so
whether a search ran on those two cannot be recovered from the logs.

It does not matter for validity. A different search engine surfaces a different candidate
list, which is a **coverage** difference, not a correctness one: the pages fetched are real,
the quotes are from those pages, and the chains verify. "A different search might have found
a different page" is true of every search ever run, including the ones run correctly.

### Why re-collecting would have been the wrong instinct

It would spend credits to replace verified captures with equivalent ones, and ADR-0026 means
a re-collection **adds** a superseding row rather than replacing the old — so the corpora
would grow, every superseded row would need its citation reviewed, and nothing would be more
true at the end. The honest response to a metering defect is to fix the meter and say plainly
what it touched.

## Correction, 2026-09-22 - "SerpAPI failed catastrophically" was one run, not a property

Earlier on this date this ADR and several commits recorded that a query about the EU
Deforestation Regulation returned **eight US financial-regulation pages and nothing on topic**
from SerpAPI, while the fetch provider's own search returned seventeen, all on topic. That
measurement is real and the capture set proves it.

**It was then generalised too far.** Running the identical query again a few hours later, with
both providers merged, SerpAPI returned eight results of which seven were shared with
Firecrawl - including the authoritative Commission page and the EY brief that answers the
question. The nine distinct candidates produced a corpus that passes `--strict`.

So the honest statement is narrower: **either provider can have a bad run on a given query,
and one of SerpAPI's was observed.** Whether it is systematically weaker is not established by
two runs, and this ADR should not have implied it was.

**The design conclusion is unchanged, and is in fact strengthened.** If any provider can
return nothing useful on a query that another answers well, asking one of them is a gamble on
which one you asked. Merging both and interleaving by rank is the response to that, and it
does not depend on either being reliably better.

### The attribution in that first comparison was also biased

`mergeByRank` originally credited whichever provider the loop reached first, which is always
the same one. A live merged run had sixteen results and nine distinct, so seven URLs were
returned by both - and all seven were attributed to the provider asked first, making six of
eight collected rows read as its finds. Every finder is recorded now, and a row both returned
says so.

That is the third time in this session a number was quoted before its production was checked,
and the second where the artefact was loop order rather than measurement.
