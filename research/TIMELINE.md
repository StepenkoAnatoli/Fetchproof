# Timeline

Derived, chronological, and deliberately outside the chain: a review aid, never part
of a gate decision. Regenerate with `node research-kit/bin/timeline.mjs`.

| When | What | Detail |
|---|---|---|
| 2026-09-13 | evidence | E-01 https://docs.firecrawl.dev/rate-limits |
| 2026-09-13 | evidence | E-02 https://www.firecrawl.dev/pricing |
| 2026-09-13 | evidence | E-03 https://docs.firecrawl.dev/billing |
| 2026-09-13 | evidence | E-04 https://code.claude.com/docs/en/skills |
| 2026-09-13 | evidence | E-05 https://code.claude.com/docs/en/hooks |
| 2026-09-13 | evidence | E-06 https://www.firecrawl.dev/terms-of-service |
| 2026-09-13 17:38 UTC | scrape | https://docs.firecrawl.dev/rate-limits -> research/raw/2026-09-13-rate-limits-firecrawl-552467ff-2.md (agent page fetch (no Firecrawl egress in sandbox)) |
| 2026-09-13 17:38 UTC | scrape | https://www.firecrawl.dev/pricing -> research/raw/2026-09-13-pricing-firecrawl-44e1c6cd-2.md (agent page fetch (no Firecrawl egress in sandbox)) |
| 2026-09-13 17:38 UTC | scrape | https://docs.firecrawl.dev/billing -> research/raw/2026-09-13-billing-firecrawl-363d9da0-2.md (agent page fetch (no Firecrawl egress in sandbox)) |
| 2026-09-13 17:48 UTC | scrape | https://code.claude.com/docs/en/skills -> research/raw/2026-09-13-extend-claude-with-skills-claude-code-docs-bbd9e46f.md (agent page fetch (no Firecrawl egress in sandbox)) |
| 2026-09-13 17:48 UTC | scrape | https://code.claude.com/docs/en/hooks -> research/raw/2026-09-13-hooks-reference-claude-code-docs-4f437b44.md (agent page fetch (no Firecrawl egress in sandbox)) |
| 2026-09-13 18:28 UTC | migration | retro-record + verification: seqs 1-5 were rebuilt on 2026-09-13 (commit 874b03d) to backfill transport and completeness before migration tracing existed - from-values recovered from git (994b420:research/raw/.fetches.jsonl); seqs 4-5 additionally carry an R8 verification note added to front matter by this run (live re-fetch of the cited chunks, matched verbatim) |
| 2026-09-13 18:50 UTC | scrape | https://www.firecrawl.dev/terms-of-service -> research/raw/2026-09-13-terms-of-service-firecrawl-172bc71f.md |
| 2026-09-17 11:44 UTC | migration | adopt the kit canonical entry hash: the corpus was chained by the previous implementation, whose canonicalisation excluded a different internal field. Body hashes and capture bytes are untouched. |
| 2026-09-19 | evidence | E-07 https://serpapi.com/pricing |
| 2026-09-19 | evidence | E-08 https://serpapi.com/ |
| 2026-09-19 | evidence | E-09 https://serpapi.com/search-api |
| 2026-09-19 | evidence | E-10 https://serpapi.com/legal |
| 2026-09-19 | evidence | E-11 https://www.tavily.com/pricing |
| 2026-09-19 | evidence | E-12 https://docs.tavily.com/documentation/api-credits |
| 2026-09-19 | evidence | E-13 https://www.firecrawl.dev/ |
| 2026-09-19 | evidence | E-14 https://www.firecrawl.dev/blog/mastering-firecrawl-search-endpoint |
| 2026-09-19 | evidence | E-15 https://www.tavily.com/terms-of-service |
| 2026-09-19 | evidence | E-16 https://www.tavily.com/terms |
| 2026-09-19 | evidence | E-17 https://trajectdata.com/serp/value-serp-api/pricing/ |
| 2026-09-19 | evidence | E-18 https://www.searchapi.io/pricing |
| 2026-09-19 | scrape | https://serpapi.com/pricing -> research/raw/2026-09-19-serpapi-plans-and-pricing-serpapi-d0c89b50.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://serpapi.com/ -> research/raw/2026-09-19-serpapi-google-search-api-serpapi-71a6e0ee.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://serpapi.com/search-api -> research/raw/2026-09-19-google-search-engine-results-api-serpapi-serpapi-98929476.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://serpapi.com/legal -> research/raw/2026-09-19-legal-documents-serpapi-serpapi-2c40cd75.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://www.tavily.com/pricing -> research/raw/2026-09-19-tavily-tavily-517f6170.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://docs.tavily.com/documentation/api-credits -> research/raw/2026-09-19-credits-pricing-tavily-docs-tavily-3e51679b.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://www.firecrawl.dev/ -> research/raw/2026-09-19-firecrawl-the-web-data-api-to-search-scr-firecrawl-20b7ba93.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://www.firecrawl.dev/blog/mastering-firecrawl-search-endpoint -> research/raw/2026-09-19-mastering-firecrawl-search-endpoint-web--firecrawl-b4690974.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://www.tavily.com/terms-of-service -> research/raw/2026-09-19-page-not-found-tavily-6a631c67.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://www.tavily.com/terms -> research/raw/2026-09-19-tavily-tavily-b685331a.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://trajectdata.com/serp/value-serp-api/pricing/ -> research/raw/2026-09-19-value-serp-api-pricing-low-cost-serp-api-trajectdata-1c602883.md (firecrawl-cli) |
| 2026-09-19 | scrape | https://www.searchapi.io/pricing -> research/raw/2026-09-19-affordable-serp-api-pricing-searchapi-999e5973.md (firecrawl-cli) |
| 2026-09-20 | evidence | E-19 https://docs.firecrawl.dev/rate-limits |
| 2026-09-20 | evidence | E-20 https://www.firecrawl.dev/pricing |
| 2026-09-20 | evidence | E-21 https://docs.firecrawl.dev/billing |
| 2026-09-20 | evidence | E-22 https://code.claude.com/docs/en/skills |
| 2026-09-20 | evidence | E-23 https://code.claude.com/docs/en/hooks |
| 2026-09-20 | evidence | E-24 https://www.firecrawl.dev/terms-of-service |
| 2026-09-20 | scrape | https://docs.firecrawl.dev/rate-limits -> research/raw/2026-09-20-rate-limits-firecrawl-firecrawl-d9bccd8c.md (firecrawl-cli) |
| 2026-09-20 | scrape | https://www.firecrawl.dev/pricing -> research/raw/2026-09-20-pricing-firecrawl-firecrawl-85a67ddb.md (firecrawl-cli) |
| 2026-09-20 | scrape | https://docs.firecrawl.dev/billing -> research/raw/2026-09-20-billing-firecrawl-firecrawl-668238a2.md (firecrawl-cli) |
| 2026-09-20 | scrape | https://code.claude.com/docs/en/skills -> research/raw/2026-09-20-extend-claude-with-skills-claude-code-do-claude-542f21c1.md (firecrawl-cli) |
| 2026-09-20 | scrape | https://code.claude.com/docs/en/hooks -> research/raw/2026-09-20-hooks-reference-claude-code-docs-claude-20106b0f.md (firecrawl-cli) |
| 2026-09-20 | scrape | https://www.firecrawl.dev/terms-of-service -> research/raw/2026-09-20-terms-of-service-firecrawl-firecrawl-55f5154f.md (firecrawl-cli) |
| 2026-09-26 | evidence | E-25 https://serpapi.com/pricing |
| 2026-09-26 | evidence | E-26 https://serpapi.com/account-api |
| 2026-09-26 | evidence | E-27 https://serpapi.com/faq |
| 2026-09-26 | scrape | https://serpapi.com/pricing -> research/raw/2026-09-26-serpapi-plans-and-pricing-serpapi-d0c89b50.md (firecrawl-cli) |
| 2026-09-26 | scrape | https://serpapi.com/account-api -> research/raw/2026-09-26-account-api-serpapi-serpapi-8f9c166b.md (firecrawl-cli) |
| 2026-09-26 | scrape | https://serpapi.com/faq -> research/raw/2026-09-26-serpapi-faq-serpapi-7dec5bc6.md (firecrawl-cli) |
| 2026-09-26 21:20 UTC | fetch failed | https://serpapi.com/pricing - Error: Request failed with status code 405 |
| 2026-09-26 21:20 UTC | fetch failed | https://serpapi.com/account-api - Error: Request failed with status code 405 |
| 2026-09-26 21:20 UTC | fetch failed | https://www.merriam-webster.com/dictionary/search - Error: Request failed with status code 405 |
| 2026-09-26 21:20 UTC | fetch failed | https://plan-international.org/ - Error: Request failed with status code 405 |

