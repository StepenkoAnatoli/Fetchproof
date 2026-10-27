# MAP - topic decomposition

## Topic

Punctuation spacing after inline HTML tags: what Firecrawl and the kit's keyless HTML-to-Markdown converter write before . , ; : ! ? % ) ] } and after ( [ {, and how Firecrawl documents its HTML-to-Markdown conversion

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-01, U-02, U-03. Public pages: two test pages, the vendor docs and its public source |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | the Firecrawl key is on the collector machine already (CLI auth); the keyless route needs none; nothing new is held |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | two to four single-page fetches; no rate limit is approached |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | public documentation pages captured for the kit's own measurement; the brief quotes a few words each |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-01, U-02, U-03. The shape each transport writes around inline tags is the subject |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-03. Whether the vendor's converter is named, so that a silent change can be noticed |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | DISMISSED | at most 4 Firecrawl credits by the run's budget; keyless fetches are free |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | the matcher is pure string code in Node; no platform limit bears on it |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-01, U-02. A pair of real captures of one page is obtainable, and is the output |

## Coverage notes (per dimension)

Phase 0 ran as a dry run (no search, no credit): the pages are named directly - two test pages
chosen for inline markup directly beside punctuation, Firecrawl's own docs, and the source file
in its public repository that converts HTML to Markdown. D-5 is the whole question; D-6 rests on
whether the vendor names the converter (U-03); D-9 is met once both transports return a capture
of the same page.

## Candidate material

Gathered 2026-10-25.

_No material gathered - run without `--dry-run`, or add URLs to `research/plan.json`._

