# MAP - topic decomposition

## Topic

How content extractors grade their output, how web tools read PDFs, and how challenge pages and soft 404s are detected, as a benchmark for Fetchproof's converter, completeness grade and capture acceptance

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1, U-2, U-3, U-4, U-5, U-6, U-7 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | a documentation benchmark reads public pages; no account is created and no API is called, so no credential enters the design - Firecrawl's PDF parsing (U-4) is read as documentation, the key that collected this corpus is the project's own and is not part of the benchmark |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | nothing here runs at a cadence; the only quota touched is this project's own collection, capped at 16 scrapes and 3 searches once, and no unknown depends on a rate figure |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | the pages are read once as documentation and cached under the repository's NOTICE for captured third-party pages (ADR-0130); no API is called and nothing is redistributed as a product |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-2, U-4, U-5, U-7 |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | DISMISSED | the benchmark compares documented behaviour on the day of capture; every row carries its retrieval date, and a tool whose documentation changes later changes the benchmark, not the kit's record of what was compared |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | COVERED | U-4 |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | a documentation benchmark reads public pages; trafilatura, Readability and jusText are read, not run, and the kit is compared with their documented behaviour |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-4, U-5, U-6, U-7 |
| D-10 | Extraction confidence and fallback | A main-content extractor that knows when its own output is doubtful (precision/recall settings, a fallback chain, a readerability test, a paragraph classification) is the benchmark for a converter that grades every capture `full` unless something was omitted | COVERED | U-1, U-2, U-3 |
| D-11 | Metadata the extractor recovers (title, author, date, site) | What a reference extractor records beside the body text bounds what an evidence row could carry beyond the retrieval date | COVERED | U-1, U-2 |
| D-12 | Non-HTML sources (PDF) | A statute, a standard or a paper is a PDF; whether the metered transport parses it to markdown, how many pages, and at what cost decides whether such a page is collectable at all, and what a keyless transport misses | COVERED | U-4 |
| D-13 | Challenge pages and bot walls | A challenge page answers with a body and a status; a collector that accepts any HTTP 200 as a capture cites the wall as evidence unless it knows the signals | COVERED | U-5 |
| D-14 | Soft 404s | A "not found" page served with 200 is the same failure for a collector as for a search crawler; the signals Google documents are the benchmark | COVERED | U-6 |
| D-15 | What a web archive keeps of a failed or truncated fetch | Whether an archive records non-200 and challenge responses as records, and how it marks a truncated body, benchmarks the kit's ledger and its `completeness: full \| partial` grade | COVERED | U-7, U-8 |

## Coverage notes (per dimension)

- **D-1 Access model** - COVERED: every owner page is a public documentation page (a project's docs or README, a vendor's docs, Cloudflare's and Google's developer pages, Common Crawl's FAQ, the WARC specification); U-1..U-7 each read one or more of them and nothing is auth-walled by design. If a page turns out to be bot-walled, that unknown becomes KNOWN-UNKNOWN with a day-one step - and, for this topic, the wall itself is a finding.
- **D-2 Auth** - DISMISSED: a documentation benchmark reads public pages; Firecrawl's key is described, not part of the design.
- **D-3 Rate limits** - DISMISSED: nothing in this benchmark runs at a cadence and no unknown turns on a rate figure.
- **D-4 ToS/legality** - DISMISSED: the captures are documentation pages cached under the repository's existing NOTICE (ADR-0130); nothing is built on them as data.
- **D-5 Schema stability** - COVERED by U-2 (what `parse()` returns), U-4 (the `parsers` option and the scrape response), U-5 (the `cf-mitigated` header and the challenge status code) and U-7 (WARC record headers for truncation): these are the shapes the kit would read if it adopted any of the detections.
- **D-6 Freshness** - DISMISSED: documented behaviour on the day of capture is the benchmark; each row carries its retrieval date.
- **D-7 Cost** - COVERED by U-4: the credit cost of PDF pages is part of the question whether a PDF statute is collectable within a budget.
- **D-8 Runtime** - DISMISSED: nothing executes; the extractors are read, not run.
- **D-9 Output obtainability** - COVERED by U-4 (can a PDF be obtained as text at all, and keyless?), U-5 and U-6 (can a collector tell that it did not obtain the page it asked for?) and U-7 (what an archive keeps when it could not). This is the load-bearing dimension for this project: the question is precisely whether the kit's outputs can be wrong where these tools would have known.
- **D-10..D-15** - the topic-specific rows, one per unknown or pair of unknowns, so every unknown traces to a subtopic and every subtopic to an unknown. D-15 splits into U-7 (what a record holds and how truncation is marked - the WARC specification owns it) and U-8 (whether Common Crawl keeps non-200 and challenge responses - not on the captured pages, a known unknown with a day-one step).

## Candidate material

Gathered 2026-10-04.

Phase 0 ran `--dry-run` only. The kit split the compound topic into five searches (ADR-0085); the lead's budget for this project is three metered searches, so the real run was not taken and no candidate pages were gathered by search. The plan rests on the owner pages named per unknown: the trafilatura and htmldate documentation, the mozilla/readability README, the jusText repository and its algorithm page, Firecrawl's scrape docs and API reference, Cloudflare's challenge docs, Google Search Central's HTTP errors page, Common Crawl's FAQ and the IIPC WARC 1.1 specification.

## Outlines seen in the material

_No outlines - no page was captured in phase 0._
