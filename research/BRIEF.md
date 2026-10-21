# Brief - Fetchproof's own protocol: metered primary-source collection, provenance, and gate enforcement for agent-built bots on this machine.

_Auto-drafted 2026-09-19 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

A research-first kit for this machine: a collector that turns a Firecrawl fetch into
cached, citable evidence, and a gate that refuses to let a build start while a blocking
fact is unproven. "Done" means an agent asked to build something can no longer answer
*insufficient information* and stop — it either produces primary-source evidence, or
names the one fact it could not reach and records the day-one step that would settle it.

The reason this file exists at all: this repository is the kit's own development home, so
it inherits its own gate. A gate that exempts the project it ships with is a gate nobody
should trust, so this contract is real rather than waived.

## What we verified

| Claim | Source | Type |
|---|---|---|
| Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs. Rate limits are per team, not per key. Keyless access is capped per IP per day and returns 429 when exceeded; a free API key includes 1,000 credits. | E-01 `docs.firecrawl.dev` | P |
| The /doctor setup checkup stays typable when disableBundledSkills is on, in Claude Code v2.1.205 and later. _(partial capture)_ | E-04 `code.claude.com` | P |
| Exit 2 means a blocking error. _(partial capture)_ | E-05 `code.claude.com` | P |
| By registering and using the Services, you represent and warrant you: (i) have the authority and capacity to enter this Agreement; (ii) are at least 18 years old, or 13 years or older and have the express permission of… _(partial capture)_ | E-06 `firecrawl.dev` | P |
| Free plan is 250 searches per month at 50 throughput per hour, $0, sign-up only. Paid tiers: Starter $25 / 1,000 searches / 200 per hour; Developer $75 / 5,000 / 1,000; Production $150 / 15,000 / 3,000; Big Data $275 / 30,000 / 6,000. The billing rule is the one that matters for a cache-first collector: "Only successful searches are counted toward your monthly searches. Cached, errored, and failed searches are not" — and result count is irrelevant, "responses with 100 results or empty result sets will both count as 1 search". | E-07 `serpapi.com` | P |
| Terms of Service and Privacy Policy, last updated 2026-08-27, 22 + 11 sections. Nothing in either forbids the customer from storing returned results. The only reproduction ban is Section 2, scoped to the Service itself: "reproduce, duplicate, copy, sell, resell or exploit any portion of the Service, use of the Service, or access to the Service". Section 13 reads the other way round — SerpApi "assumes liability for the lawful collection of public search data (scraping, parsing, and related actions), but not for how that data is ultimately used" — which presumes the customer holds and uses the data. Two limits apply to this project: that $2M U.S. Legal Shield is excluded "for all recurring plans except the Free, Starter, and Developer plans", so a free-tier user has none of it; and Privacy Policy Section 10 governs only SerpApi's own copy — "Search data is retained for 31 days after the search is completed", with ZeroTrace Mode (paid) preventing storage entirely. | E-10 `serpapi.com` | P |
| Free tier ("Researcher") is 1,000 credits per month, "No credit card required". Paid: Project 4,000 / $30, Bootstrap 15,000 / $100, Startup 38,000 / $220, Growth 100,000 / $500, pay-as-you-go $0.008 per credit. Per-call costs: basic search 1 credit, advanced search 2; basic extract 1 credit per 5 successful URLs, advanced 2 per 5, and "You never get charged if a URL extraction fails"; regular map 1 credit per 10 pages. So the free tier buys 1,000 basic searches a month, or 5,000 page extractions, against SerpAPI's 250 searches (E-07) and Firecrawl's 1,000 credits at 1 credit per page (E-03). | E-12 `docs.tavily.com` | P |
| The homepage billing FAQ restates the endpoint costs six days after E-03 read them from the docs, unchanged: "Scrape, Crawl, Map, and Monitor each cost 1 credit per page. Search costs 2 credits per 10 results." Also the free allowance — "1,000 free credits every month, which covers about 1,000 pages, and no card is required" — and two facts E-03 did not carry: credits roll over only on Scale and Enterprise, and "A scrape that returns no result is not charged. A page that responds with an error status such as 403 or 404 is still returned to you and costs 1 credit." Secondary because it is a marketing page restating what docs.firecrawl.dev/billing owns. | E-13 `firecrawl.dev` | S |

## Contradictions and how they were resolved

Three disagreements were looked for and two were found. Neither is between two
vendors; both are between a document and a machine.

**Firecrawl search cost: no disagreement.** E-03 read 2 credits per 10 results off
`docs.firecrawl.dev/billing` on 2026-09-13; E-13 (the vendor homepage FAQ) and E-14
(the vendor blog) restate it unchanged on 2026-09-19, and E-14 supplies the rounding
rule the other two omit. E-02's "500 searches or 1,000 pages scraped" on a
1,000-credit plan is the same rule seen from the other end. Three vendor pages, six
days apart, one number.

**The assumed search response is not the shape the CLI returns.** The adapter was
written expecting `data` to be a list of results; `firecrawl-cli` v1.23.3 on this
machine returns `{success, data: {web: [...]}, creditsUsed}` — a keyed object. No
page was consulted for this, which is exactly the defect. The machine wins, and
the bytes that settled it are pinned at
`fetchproof/test/fixtures/firecrawl-search-1.23.3.json` so the next reader does not
have to spend credits re-proving it. This one had teeth: the adapter believed the
documented shape, so every search succeeded, cost credits, and returned an empty list
in silence. Prefer the fixture over any page for this fact.

**`firecrawl status` is not a command; `--status` is a flag.** Same class of error,
same resolution — the CLI's own `--help` over any documentation, fixture at
`fetchproof/test/fixtures/firecrawl-status-1.23.3.txt`.

**Tavily's restriction list argues with itself, and says so.** E-16 §3.2 forbids
"any data mining, robots, or similar data gathering or extraction methods through the
Services" and then carves out, in the same clause, that "reasonable use of Tavily APIs
in accordance with this Agreement will not constitute a violation". Read together the
ban targets scraping *Tavily*, not using the API it sells. Recorded because a reader
who greps for "robots" and stops will reach the opposite conclusion.

**One thing that reads like a contradiction and is not.** SerpAPI counts a response as
one search whatever it contains (E-07), while Firecrawl bills by result count (E-03).
Different meters, not disagreeing sources — and the difference is the whole argument
in the Decision below.

## Known unknowns

None. Every blocking unknown was closed with primary-source evidence.

## Decision

**Split search from fetch behind the transport seam. Keep Firecrawl as the default for
both. Wire SerpAPI as an opt-in search provider. Do not wire Tavily.**

The reason is arithmetic, and it is not the one the question was asked with. A second
provider is not worth adding because it is cheaper per call — it is worth adding
because it is a *second meter*. Today one free allowance pays for both halves of a
run. At `perQuery: 2`, one plan query costs 2 Firecrawl credits to search and 2 to
scrape: 4 of 1,000 a month, so about 250 queries, and every search spent is a page not
fetched. Move the search half onto SerpAPI's free 250-a-month and the two budgets stop
competing — roughly 250 searches and 500 scrape-backed queries a month, on two free
tiers, no card on either (E-07, E-03).

Two further facts make SerpAPI the right one to wire, both from its own pages. It bills
per response, not per result: "responses with 100 results or empty result sets will
both count as 1 search" (E-07), so a wide search is free where Firecrawl charges 2
credits per 10. And it caches server-side for an hour, free and uncounted (E-09), so
the re-runs that development actually consists of cost nothing — which matters far more
to this kit than the headline cap.

**Tavily is deliberately not wired, and it is not a cost decision.** It is the cheapest
of the three — 1,000 free credits, 1 per basic search, 1 per 5 page extractions (E-12).
It is excluded because of E-16 §6.5: Tavily and its AI providers "may use, process,
analyze, and retain Customer Input … and Outputs … for purposes of training", and §6.7
adds that those providers may not be bound to confidentiality. A research kit's queries
are the shape of what its operator is working on. That can be a knowing opt-in; it
cannot be the default nobody was asked about. Revisit if Tavily ships a
no-training tier — the way SerpAPI's ZeroTrace Mode is one (E-10).

**Retention is settled for all three, but not generously.** Neither SerpAPI (E-10) nor
Tavily (E-16) forbids the customer from storing results; both are silent rather than
permissive, and the silence is structural in Tavily's case — §1.7 excludes Output from
the definition of "Services", so the §3.2 copy/derivative restrictions do not reach it.
Record it as unprohibited. The one real exposure found: SerpAPI's $2M U.S. Legal Shield
is excluded "for all recurring plans except the Free, Starter, and Developer plans"
(E-10), so free-tier collection carries no indemnity. For a solo operator reading public
vendor documentation this is acceptable; it would not be for redistribution.

### First build step

`fetchproof/lib/transport.mjs` already selects one adapter for everything, and
`selectTransport` is its single reader (ADR-0005). Make the seam two-sided rather than
adding a third adapter to the one list:

1. Split the seven-function adapter shape into a **fetch** contract (`scrape`,
   `runScrape`, `map`) and a **search** contract (`search`, `creditsUsed`), and let
   `selectTransport` resolve each independently. Precedence stays as it is — explicit
   flag, environment, machine config, auto-detect — so no existing caller changes.
2. Add `lib/serpapi.mjs` implementing the search contract only. Key handling follows
   Project Rule 6 without exception: read from the environment or the machine config,
   never from this repository, never written into a file the repo can see.
3. Stamp captures with the provider that actually fetched them. `transport-provenance`
   is the one check whose job is to say how a capture was obtained; a search sourced
   from SerpAPI and a page scraped by Firecrawl must not resolve to one label. Extend
   the check before the adapter, not after.
4. Default behaviour with no SerpAPI key present must be byte-identical to today's.
   The seam is opt-in or it is a regression.

**Out of scope:** Tavily (above); any paid tier of anything; and the search-result cache
policy — SerpAPI caches for an hour on its side and this kit caches on disk by
`--refresh-days`, and reconciling the two is a separate decision that does not block
the seam.

## Addendum 2026-09-26 - the search meter (U-9, U-10, U-11)

Opened because SerpAPI's own Account API contradicted two numbers the kit hard-codes.
Collected with `research/plan-2026-09-26-serpapi-meter.json`; all three unknowns CLOSED,
preflight PASS (and `--strict`).

### Verified

| Claim | Source | Type |
|---|---|---|
| Free Plan, documented: 250 searches per month, **50 throughput per hour** - unchanged since 2026-09-19. Every tier's hourly figure is 20% of its monthly one | E-25 `serpapi.com/pricing` | P |
| The monthly allowance restarts "on the first day of your billing cycle's subscription" - **a billing cycle, not a calendar month**. Hourly cap below 1M/month is "20% of your plan volume". Cached, errored and failed searches are not counted | E-27 `serpapi.com/faq` | P |
| `GET serpapi.com/account.json` is documented, "free of charge, and using it will not be counted toward your monthly quota"; it returns usage this cycle, searches left, `plan_renewal_date`, and "your account's hourly throughput limit" | E-26 `serpapi.com/account-api` | P |

### Contradiction, and which side the kit should trust

**The documents say 50 per hour; this account's meter says 250.** Two SerpAPI pages agree on
50 (E-25, E-27). The Account API, which E-26 defines as reporting the account's own hourly
limit, returned `account_rate_limit_per_hour: 250` on 2026-09-26
(`docs/measurements/2026-09-26-serpapi-account/account.json`; a measurement, not a ledger
capture, because the request URL carries the key). Not averaged: they are different things.
The pricing page is the plan as advertised; the API is what the vendor enforces for one
account, and it can differ per account. **Neither belongs in the kit as a constant.** The kit
should read the account's values when a key is present - free, per E-26 - and fall back to
the documented 50 and 250, labelled as documented rather than as this account's.

**The monthly window is wrong in the kit today.** `searchUsage` counts from the 1st (UTC);
this account's cycle runs from the 14th (`plan_renewal_date: 2026-10-14`). For 13 days of every
month the kit's "this month" mixes two cycles.

### What the collection itself showed

- **The Firecrawl CLI could not reach the API from this container at first.** Every call
  returned HTTP 405: `firecrawl-cli@1.23.3` bundles axios 1.15.2, which sends plain proxied
  requests that this cloud container's egress proxy refuses (it accepts only CONNECT tunnels;
  fixed in axios 1.16.1). The four failed fetches are in the ledger as `op: fail`, as they
  should be. Worked around **on this container only** by swapping axios 1.16.1 into the global
  CLI install; the repository and the pinned CLI version are unchanged. A machine without such
  a proxy is unaffected. _Superseded later on 2026-09-26: fixed at source, not by the
  workaround. `firecrawl-cli@1.24.6` bundles axios 1.18.0 and works through this proxy
  unpatched; it is now the version the adapter is tested against (`TESTED_CLI_VERSION`,
  PR #81), and live-collection has passed on it since. No container patch is needed._
- **SerpAPI returned nothing on topic for either query - 0 of 12.** Google dropped "SerpApi"
  and matched the generic words (`merriam-webster.com/dictionary/search`,
  `plan-international.org`). Firecrawl's search ranked `serpapi.com/account-api` first. The
  merged search (#66) and the `prefer` ranking are why the run still collected the right three
  pages; this is the failure mode they exist for, now seen twice (EUDR, 2026-09-22).
- **No prior could be registered** - the kit allows one per corpus, before its first page, and
  this corpus has had pages since 2026-09-13. Written after the fact, so it is not a
  prediction: the expectation going in was that the pricing page had changed to 250. It had
  not; the difference is per-account.

### First build step

In `lib/research-run.mjs`: stop presenting `FREE_TIER_PER_HOUR = 50` and a calendar month as
this account's limits. Label them as the documented plan, and count the month from the
renewal date when it is known. Reading `account.json` is the fuller fix, but it adds a
network call to `--status`; take that as its own decision.

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node bin/brief.mjs`
   after edits will refuse without `--force` so your judgements are preserved.
