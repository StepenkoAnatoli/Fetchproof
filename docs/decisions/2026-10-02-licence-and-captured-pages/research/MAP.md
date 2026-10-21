# MAP - topic decomposition

## Topic

Which licence should Fetchproof publish under so that people and agents may install and run it, and may the cached third-party pages in its research corpora be redistributed under it

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-01, U-07 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | a licence decision needs no account or key; nothing in it is collected behind a login |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | no rate-limited source is part of the design; the collection is a few public pages fetched once |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | COVERED | U-01, U-02, U-03, U-04, U-05, U-06 |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | DISMISSED | no data schema is consumed; the artefacts are licence texts and terms pages read once |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-03 |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | DISMISSED | a licence costs nothing to run; the commercial terms it sets are U-03, not a running cost |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | a licence file runs nowhere; GitHub's recognition of it is U-07, a detection rule, not a platform limit |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-07 |
| D-10 | Rights in the cached third-party pages | A repository licence covers the author's own work; the captures under research/raw are other people's pages, and redistributing them is governed by their licences and by copyright law, not by LICENSE | COVERED | U-04, U-05 |
| D-11 | Precedent in archival and evidence tools | Web archives and crawl corpora redistribute whole captured pages every day; the terms they publish are the nearest practice to what this kit does | COVERED | U-06 |

## Coverage notes (per dimension)

- D-1, D-9: U-01 says what a public repository with no licence actually grants (GitHub's
  terms, and the no-permission reading); U-07 says whether a per-path licence split can be
  expressed and is recognised, which is the output this decision has to produce.
- D-4: the heart of the question. U-02 and U-03 are the candidate licences for the code;
  U-04, U-05 and U-06 are whether the captures may travel with it.
- D-6: U-03 - a source-available licence with a change date turns into an open licence on
  a schedule, which is a freshness property of the licence itself.
- D-10, D-11: added for the second half of the topic; the universal checklist has no row
  for "rights in material the project redistributes", and this project is that case.
- D-2, D-3, D-5, D-7, D-8: dismissed with the reason in the row.
- Phase 0 is on the record as a lesson: every search for "Research-Kit" found Apple's
  ResearchKit, and the three pages gathered are about Google's cached-page operator. The
  relevance floor skipped the former; the latter were scraped and carry nothing. The plan
  below names the owner pages by hand.

## Candidate material

Gathered 2026-10-02.

Likely owners of these facts (by how often a search pointed at them):

- `github.com/researchkit` (2)
- `arxiv.org` (1)
- `rdmkit.elixir-europe.org` (1)
- `lifetips.alibaba.com` (1)
- `researchkit.github.io` (1)
- `dl.acm.org` (1)

Candidate pages:

- [ResearchKit/LICENSE at main - GitHub](https://github.com/ResearchKit/ResearchKit/blob/main/LICENSE)
- [How Much Can We Trust LLM Search Agents? Measuring Endorsement ...](https://arxiv.org/html/2606.16821)
- [Your tasks: Licensing | RDMkit](https://rdmkit.elixir-europe.org/licensing)
- [Google Won't Let You Check Cached Pages Anymore? Here's How to Do It Anyway](https://lifetips.alibaba.com/tech-efficiency/google-wont-let-you-check-cached-pages-anymore-heres-how-to-do-it-anyway)
- [ResearchKit | ResearchKit is an open source software framework that ...](https://researchkit.github.io/ResearchKit/)
- [The Danger of Convenience: Unveiling the Explosively Amplified Security ...](https://dl.acm.org/doi/10.1145/3833382)
- [GitHub - IATApps/ResearchKit: ResearchKit is an open source software ...](https://github.com/IATApps/ResearchKit)
- [Search engine cache - Wikipedia](https://en.wikipedia.org/wiki/Search_engine_cache)
- [GitHub - ResearchKit/ResearchKit: ResearchKit is an open source ...](https://github.com/ResearchKit/ResearchKit)
- [Find Google Cached Pages: The 2026 Professional Protocol](https://www.contentremoval.com/blog/find-google-cached-pages)
- [This guide | Research software licensing guide](https://research-data-management.github.io/research-software-licensing/)
- [Inside ChatGPT's retrieval stack: The index, cache, and pages it ...](https://searchengineland.com/chatgpt-retrieval-stack-index-cache-pages-485036)
- [How to Select a License for Research Software](https://rdm.mpdl.mpg.de/2023/05/02/how-to-select-a-license-for-research-software/)
- [Check and View Cached/Archived Web Pages - PageCached](https://pagecached.com/)
- [tasks: Licensing software | RSQKit: Research Software Quality Kit](https://everse.software/RSQKit/licensing_software)
- [Google Cached Pages: What You Need to Know - elatre.com](https://elatre.com/google-cached-pages-what-you-need-to-know/)

## Outlines seen in the material

The section headings of the gathered pages that are captured - what related material
covers, as its own tables of contents say (STORM's perspective step, without the model).
Not a verdict: a heading worth a subtopic becomes a row by your hand.

- [Google Won't Let You Check Cached Pages Anymore? Here's How to Do It Anyway](https://lifetips.alibaba.com/tech-efficiency/google-wont-let-you-check-cached-pages-anymore-heres-how-to-do-it-anyway)
  - Why Google Removed the Cached Link (And Why It Still Works)
  - Step-by-Step: Accessing Cached Pages in Under 2 Seconds
  - When the cache: Prefix Fails—And What to Use Instead
  - 1. Internet Archive Wayback Machine (Best for Historical Context)
  - 2. Local Browser Cache Inspection (Fastest for Recently Visited Pages)
  - 3. Command-Line Retrieval (For Developers & Automation)
  - What Not to Do: High-Risk Misconceptions
  - Tech Efficiency Beyond Caching: Systemic Gains That Compound
  - 1. Reduce Tab-Induced Cognitive Load Using Memory Decay Science
  - 2. Optimize Notification Hygiene to Cut Context-Switching Latency
  - 3. Extend Li-ion Battery Lifespan with Firmware-Level Charge Limiting
  - 4. Replace Password Managers with Passkeys Where Supported
  - _and 9 more_
- [Find Google Cached Pages: The 2026 Professional Protocol](https://www.contentremoval.com/blog/find-google-cached-pages)
  - The End of an Era for Google Cache
  - Why this matters in high-stakes work
  - What professionals should do instead
  - Understanding the Obsolete Cache Operator
  - How the legacy workflow worked
  - Why it failed even before retirement
  - What to take from the old method
  - The Current Standard for Accessing Web Archives
  - The working protocol
  - How to search when you don’t know the exact page
  - When one archive isn’t enough
  - Interpreting Archived Snapshots for High-Stakes Cases
  - _and 16 more_
- [Google Cached Pages: What You Need to Know - elatre.com](https://elatre.com/google-cached-pages-what-you-need-to-know/)
  - What Are Google Cached Pages?
  - How to Access Google Cached Pages
  - Method 1: Utilizing the Search Results Page
  - Method 2: Employing the Address Bar
  - When Are Google Cached Pages Most Useful?
  - Limitations of Google Cached Pages: A Word of Caution
  - Google Cached Pages vs. The Wayback Machine: Understanding the Difference
  - Optimizing Your Website for Google Cache Inclusion
  - Google Cached Pages – A Valuable Tool in Your Browsing Arsenal

