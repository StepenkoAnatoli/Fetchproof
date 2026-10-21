# Discovery Contract - What a Firecrawl scrape and search and a SerpAPI search cost today, and whether Fetchproof's budget and credit assumptions still hold

Started 2026-09-28. This file is the definition of "enough information to build".
`node "/root/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Fetchproof spends two metered services: Firecrawl (scrapes, and searches when no SerpAPI key is set) and SerpAPI (searches). Its budget code assumes what each call costs and what a free plan allows: the depth tiers in `lib/research-run.mjs` are "tuned for a ~1,000-credit free month", `lib/firecrawl.mjs` estimates a search at 2 credits per 10 results and names a 10-requests-a-minute free tier, and `lib/research-run.mjs` counts SerpAPI against a 50-an-hour, 250-a-month Free Plan. "Done" is a verdict per assumption - still true, changed (with the new value), or unverifiable - each resting on the vendor's own page, so a builder can change the constants (or leave them) without re-researching.

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | How many credits Firecrawl's free plan grants, and whether they renew monthly | The depth tiers and AGENTS.md's "about 1,000" are sized to it; a smaller grant makes `normal`/`deep` overspend | CLOSED | E-02, E-09 - 1,000 credits a month on the Free plan, refreshed monthly (E-03: at the start of each billing cycle). The kit's "about 1,000" holds. |
| U-2 | What one Firecrawl scrape of one page costs in credits | The collector budgets scrapes one credit each; a higher price multiplies every run's cost | CLOSED | E-02, E-03 - 1 credit per page on a basic scrape; the kit scrapes markdown only, so its one-credit budget holds. A 403/404 page still costs 1; a scrape with no result costs nothing. |
| U-3 | What one Firecrawl search costs in credits, and how that scales with the number of results | `creditsEstimate` assumes 2 credits per 10 results, rounded up; `--status` and the usage log report it | CLOSED | E-03, E-07 - 2 credits per 10 results, rounded up; creditsEstimate's rule holds. |
| U-4 | Firecrawl's rate limits on the free plan for scrape and search | `rateLimitWaitMs` and the collector's pacing assume ten requests a minute | CLOSED | E-02, E-04 - 10 requests a minute for /scrape and /search on the Free plan; the kit's ten-a-minute assumption holds. |
| U-5 | SerpAPI's Free Plan: searches per month and per hour, and whether a cached repeat is free | `searchUsage` reports against 50/hour and 250/month and says a cached repeat is not charged | CLOSED | E-05, E-06 - 250 searches a month and 50 an hour on the Free plan; cached, errored and failed searches are not counted. The kit's caps and its cache caveat hold. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

- The kit keeps both vendors; this project checks their numbers, it does not choose a vendor.
- Paid plans are out of scope: the constants in question describe the free tiers.

Locked decisions for this project. Do not revisit these without the human.
