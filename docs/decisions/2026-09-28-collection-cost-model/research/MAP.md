# MAP - topic decomposition

## Topic

What a Firecrawl scrape and search and a SerpAPI search cost today, and whether Fetchproof's budget and credit assumptions still hold

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | DISMISSED | Both services are already reached through their official CLI or API; access is not in question here |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | Keys are already held on the collector (ADR-0010); this project reads public pricing |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | COVERED | U-4, U-5 |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | Reading public pricing and documentation pages; the terms of use were researched in earlier decisions |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | DISMISSED | No data is consumed; the output is a set of numbers per assumption |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | DISMISSED | Pricing can change at any time; each claim carries its retrieval date and --refresh-days re-checks it |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | COVERED | U-1, U-2, U-3, U-5 |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | The kit runs where it already runs; nothing here depends on a platform |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-1, U-2, U-3, U-4, U-5 |

## Coverage notes (per dimension)

_One short paragraph per row once it has a status: what was established, and what the
status rests on._

- **D-3 Rate limits (COVERED by U-4, U-5).** Firecrawl's Free plan allows 10 requests a minute on /scrape and /search (E-02, E-04); SerpAPI's Free plan allows 50 searches an hour (E-05).
- **D-7 Cost (COVERED by U-1, U-2, U-3, U-5).** 1,000 Firecrawl credits a month; 1 credit a scraped page; 2 credits per 10 search results, rounded up; 250 SerpAPI searches a month, cached and failed ones free (E-02, E-03, E-05, E-06, E-07).
- **D-9 Obtainability (COVERED).** Every number was on the vendor's own public pricing or documentation page; nothing was login-walled.
- The dismissed rows are outside a question about published free-tier numbers; their reasons are in the table.

## Candidate material

Gathered 2026-09-28.

Likely owners of these facts (by how often a search pointed at them):

- `facebook.com` (2)
- `puzzleinbox.com` (2)
- `usagepricing.com` (1)
- `reddit.com` (1)
- `mondayideas.com` (1)
- `outmano.com` (1)

Candidate pages:

- [AI Pricing Facts & Trivia - UsagePricing](https://www.usagepricing.com/blueprint/trivia)
- [Langchain's Deep Agents for complex task automation](https://www.facebook.com/patcellcorp/posts/langchain-literally-reverse-engineered-claude-code-to-build-opensource-deep-agen/1106379108254765/)
- [Monthly Self-Promotion - September 2026 : r/webscraping](https://www.reddit.com/r/webscraping/comments/1w3zpdi/monthly_selfpromotion_september_2026/)
- [CrawlQ STUDIO is live - wait for your turn!](https://www.facebook.com/groups/crawlq/posts/1670076440784964/)
- [Monday Ideas](https://mondayideas.com/)
- [Firecrawl vs SerpApi Pricing (2026) - Outmano](https://outmano.com/compare/firecrawl-vs-serpapi)
- [Firecrawl Review: AI-Native Scraping & Pricing](https://serp.fast/tools/firecrawl)
- [Firecrawl Features, Pricing, and Alternatives - AI Tools](https://aitools.inc/tools/firecrawl)
- [Web scraping API cost: Spider vs Firecrawl](https://spider.cloud/compare/)
- [Firecrawl Review (2026): Features, API & Pricing - Heyperai](https://heyperai.com/blog/firecrawl-review)
- [Firecrawl vs Crawl4AI (2026) - Honest Web Scraping for AI ...](https://www.webfuse.com/compare/firecrawl-vs-crawl4ai)
- [Firecrawl Pricing in 2026: Web Scraping for AI Workflows](https://puzzleinbox.com/blog/firecrawl-pricing-review)

