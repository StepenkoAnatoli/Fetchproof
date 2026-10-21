# MAP - topic decomposition

## Topic

How do table, citation, search and research-synthesis tools validate their inputs and judge their sources, as a benchmark for Fetchproof's corpus and gate

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1, U-2, U-3, U-4, U-5 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | a documentation benchmark reads public pages; no account is created and no API is called, so no credential enters the design |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | COVERED | U-3 |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | the pages are read once as documentation and cached under the repository's NOTICE for captured third-party pages (ADR-0130); no API is called and nothing is redistributed as a product |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | DISMISSED | a documentation benchmark reads public pages; no data schema is consumed by a pipeline, the output is a comparison read by the gap-audit lead |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-2, U-3 |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | DISMISSED | a documentation benchmark reads public pages; the only spend is this project's own collection, capped at 22 pages once |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | a documentation benchmark reads public pages; nothing executes against these tools, the kit is compared with their documented behaviour |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | DISMISSED | a documentation benchmark reads public pages; the output is the benchmark table in the brief, which exists as soon as the owner pages are captured |
| D-10 | Table parsing rules (GFM tables extension) | The kit's EVIDENCE.md and DISCOVERY.md are GFM tables; how a conforming parser escapes pipes and treats short or long rows decides whether the kit's own table parser agrees with GitHub's rendering | COVERED | U-1 |
| D-11 | Citation record fields and the two dates | A citation manager records both when a page was accessed and when it was published; the kit records only a retrieval date, so the benchmark needs the reference vocabulary | COVERED | U-2 |
| D-12 | Search result shape and freshness filters | What a web-search API returns per result, how fresh it can be asked to be, and how many results a query yields bounds what a merged search seam can carry | COVERED | U-3 |
| D-13 | Source selection and weighting in research-synthesis tools | How GPT Researcher and STORM choose, diversify, cite and (whether they) verify sources is the benchmark for the kit's source judgement | COVERED | U-4 |
| D-14 | Publisher identity (registrable domain, eTLD+1) | Judging two hostnames as one publisher needs the Public Suffix List; a naive last-two-labels rule gets co.uk and github.io wrong | COVERED | U-5 |

## Coverage notes (per dimension)

- **D-1 Access model** - COVERED: every owner page is a public documentation page (a specification, a vendor's API docs, a project README, a knowledge-base article); U-1..U-5 each read one or more of them and nothing is auth-walled by design. If a page turns out to be bot-walled, that unknown becomes KNOWN-UNKNOWN with a day-one step.
- **D-2 Auth** - DISMISSED: a documentation benchmark reads public pages; the Brave and Tavily keys are described, not used.
- **D-3 Rate limits** - COVERED by U-3: the free-tier limits of the search APIs are part of the benchmark (the kit's search seam has to live under them).
- **D-4 ToS/legality** - DISMISSED: the captures are documentation pages cached under the repository's existing NOTICE (ADR-0130); nothing is built on them as data.
- **D-5 Schema stability** - DISMISSED: no pipeline consumes these pages; the output is a comparison.
- **D-6 Freshness** - COVERED by U-2 (accessDate versus date, dateModified versus datePublished) and U-3 (freshness filter, page age on a result).
- **D-7 Cost** - DISMISSED: at most 22 Firecrawl scrapes once, plus the four phase-0 searches.
- **D-8 Runtime** - DISMISSED: nothing executes; GPT Researcher and STORM are read, not run.
- **D-9 Output obtainability** - DISMISSED: the output is the benchmark table, obtainable from the owner pages alone.
- **D-10..D-14** - the topic-specific rows, one per unknown, so every unknown traces to a subtopic and every subtopic to an unknown.

## Candidate material

Gathered 2026-10-03. The four phase-0 searches pointed at secondary pages about AI literature search in academia (library guides, blog posts, two arXiv papers); none of them owns a fact the unknowns need, so the plan rests on the owner pages named per unknown (the GFM specification, Zotero's knowledge base, schema.org, Brave's and Tavily's API documentation, the GPT Researcher and STORM repositories, publicsuffix.org).

Likely owners of these facts (by how often a search pointed at them):

- `pmc.ncbi.nlm.nih.gov` (2)
- `arxiv.org` (2)
- `editage.com` (1)
- `libguides.kcl.ac.uk` (1)
- `guides.library.ttu.edu` (1)
- `wp.unil.ch` (1)

Candidate pages:

- [AI Literature Search: How to Use AI for Searching, Evaluating, and ...](https://www.editage.com/blog/ai-literature-search-how-to-use-ai-for-searching-evaluating-and-synthesizing-research/)
- [AI tools in evidence synthesis - Searching for Systematic Reviews ...](https://libguides.kcl.ac.uk/systematicreview/ai)
- [Guides: AI-Based Literature Review Resources - Texas Tech University](https://guides.library.ttu.edu/lit)
- [Artificial Intelligence Search Tools for Evidence Synthesis - PMC - NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC12419559/)
- [Evaluating AI Tools in Academic Research - arXiv](https://arxiv.org/html/2605.10125v2)
- [eight AI tools to explore, structure, and analyze a corpus](https://wp.unil.ch/iaunil/en/ai-as-a-research-assistant-essential-tools-for-the-literature-review/)
- [5 Best AI Tools for Evidence Synthesis in 2026 (Free+Paid) - Paperguide](https://paperguide.ai/blog/ai-tools-for-evidence-synthesis/)
- [Deep Research Helps, and Human Citation Lists Are Not a Ground Truth](https://arxiv.org/html/2605.29234v1)
- [Evaluating the adoption of handsearching, citation chasing ...](https://pmc.ncbi.nlm.nih.gov/articles/PMC11632621/)

## Outlines seen in the material

_No outlines - none of these pages is captured yet. `--max-scrapes <n>` captures the first n; their headings appear here._

