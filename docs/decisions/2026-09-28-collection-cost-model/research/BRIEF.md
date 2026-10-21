# Brief - What a Firecrawl scrape and search and a SerpAPI search cost today, and whether Fetchproof's budget and credit assumptions still hold

_Auto-drafted 2026-09-28 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

Fetchproof spends two metered services: Firecrawl (scrapes, and searches when no SerpAPI key is set) and SerpAPI (searches). Its budget code assumes what each call costs and what a free plan allows: the depth tiers in `lib/research-run.mjs` are "tuned for a ~1,000-credit free month", `lib/firecrawl.mjs` estimates a search at 2 credits per 10 results and names a 10-requests-a-minute free tier, and `lib/research-run.mjs` counts SerpAPI against a 50-an-hour, 250-a-month Free Plan. "Done" is a verdict per assumption - still true, changed (with the new value), or unverifiable - each resting on the vendor's own page, so a builder can change the constants (or leave them) without re-researching.

## What we verified

| Claim | Source | Type |
|---|---|---|
| Firecrawl's Free plan is 1,000 credits a month, "refreshed monthly, no credit card required"; 1 credit = 1 page on a basic scrape; search costs 2 credits per 10 results; JSON/question/highlight formats add 4 credits a page; the Free plan's rate limit for /scrape, /map and /search is 10 requests a minute each; a scrape returning no result is not charged, a 403/404 page costs 1 credit (retrieved 2026-09-28). | E-02 `firecrawl.dev` (U-1, U-2, U-4) | P |
| Firecrawl's billing doc: Scrape 1 credit/page, Search 2 credits/10 results "rounded up per 10 results (e.g., 11 results = 4 credits)" plus per-page scrape costs for scraped results; the monthly allotment "resets at the start of each billing cycle" (retrieved 2026-09-28). | E-03 `docs.firecrawl.dev` (U-3) | P |
| SerpAPI's Free plan: 250 searches per month and 50 throughput per hour (retrieved 2026-09-28). | E-05 `serpapi.com` (U-5) | P |

## Contradictions and how they were resolved

None that changes a number. Two differences in wording, both resolved:

- **When the Free plan's credits renew.** The pricing page says "refreshed monthly" (E-02);
  the billing doc says the allotment "resets at the start of each billing cycle" (E-03).
  Both describe a monthly grant; the billing doc is the more precise, so a month here means
  the account's billing cycle, not the calendar month. The kit's SerpAPI meter already
  says the same of SerpAPI (`METER_NOTES`).
- **Search at 10 credits per 10 results.** E-07 states it, but only for the enterprise
  end-to-end zero-data-retention option. Ordinary search, which the kit uses, is 2 credits
  per 10 results in E-02, E-03 and E-07 alike.

The gate's two warnings are that U-3 and U-5 rest on the vendor alone. That is the right
source for a vendor's own prices; a third-party page would only be a copy of it.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**Every cost assumption holds; no constant changes.**

| Assumption in the kit | Where | Verdict |
|---|---|---|
| Free tier "about 1,000" credits a month | AGENTS.md, `DEPTH_SCRAPES` | holds (U-1) |
| 1 credit per scraped page | the collector's budget | holds for markdown scrapes, which is all the kit asks for (U-2) |
| Search = 2 credits per 10 results, rounded up | `firecrawl.creditsEstimate` | holds (U-3) |
| 10 requests a minute on the Free plan | `rateLimitWaitMs` comment | holds for /scrape and /search (U-4) |
| SerpAPI 50/hour, 250/month; a cached repeat is free | `FREE_TIER_PER_HOUR`, `FREE_TIER_PER_MONTH` | holds (U-5) |

One conservative difference, left as it is: the collector counts a failed scrape against the
run's budget, while Firecrawl does not charge a scrape that returns no result (E-02).
Over-counting spend is the safe direction.

Out of scope: paid plans, the enterprise ZDR search price, and the defects this run exposed in
the kit's own search counting - they are kit changes, recorded in the commit that follows this
corpus, not facts about the vendors.

## Next steps

1. Nothing to build: the constants stand. Re-run this project with `--refresh-days 0` when a vendor announces new pricing.
2. Hand this file to the builder (phase 2). Re-running `node /home/user/Fetchproof/fetchproof/bin/brief.mjs`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=0f948609c835ca2f inputs=ac6e4007cc1ef438 gate=pass -->
