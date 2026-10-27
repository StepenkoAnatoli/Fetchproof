# MAP - topic decomposition

## Topic

On a re-collection, does ADR-0193's quote-level refresh recheck spare unchanged work without missing changed facts, and does it change what ships?

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1, U-2 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | reason: the study's facts need no account; model and harness credentials for the trials are execution logistics fixed in PROTOCOL.md, not facts a page can close |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | reason: the fixture server is local and has no quota; the one external page (U-1) is a one-off fetch with no cadence; the rate limits inside the tasks are synthetic fixture content, authored, not researched |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | reason: fixture pages are synthetic and written for this study (no third-party or Testimonium page is copied); the one paper (U-1) is cited, not redistributed, as the other decision corpora cite papers |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-2 |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-1, U-2 |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | COVERED | U-2 |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | COVERED | U-2 |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-1, U-2 |
| D-10 | Fixture-controlled re-collection, offline | Each page-change kind must be staged identically in every arm and trial without the live web; if the collector cannot reach the fixture server, the design changes | COVERED | U-2 |
| D-11 | Published API-update classes for task material | Plan section 12 lets task changes draw on a published taxonomy; a class named from memory would be an unsourced claim in the task texts | COVERED | U-1 |

## Coverage notes (per dimension)

- **D-1 (COVERED, U-1, U-2):** Two access paths only. The paper behind U-1 is a public page,
  collected on the collector machine before trial 1. Every task page is synthetic and served
  by a local fixture server, so no vendor API, login or paywall is touched (U-2).
- **D-2 (DISMISSED):** No account or key is needed for either path. The trials need model
  credentials; that is harness logistics (PROTOCOL.md, section 3), not a researched fact.
- **D-3 (DISMISSED):** No cadence and no quota: the fixture server is this machine's, and the
  one external fetch is one page. The 10/min-to-5/min kind of change is fixture content.
- **D-4 (DISMISSED):** Nothing third-party is stored or shown: fixture pages are written for
  this study, and the paper is cited by its page, the same use the other decision corpora
  make of papers.
- **D-5 (COVERED, U-2):** The shape that matters is the kit's own record of a loopback
  capture - its `transport` and, for kind 4, a `fail` entry with the 404 - because kinds 3
  and 4 are read from it. U-2 holds what the code says about it until the trial-0 smoke run.
- **D-6 (COVERED, U-1, U-2):** Freshness is the study's own subject, and it is controlled:
  the fixture server's two states per task are the only change between collections (U-2).
  The one external page is pinned by its retrieval date when U-1 is collected.
- **D-7 (COVERED, U-2):** Cost is a measured outcome (PROTOCOL.md, section 6). Fixture
  fetches by the keyless transports spend no fetch credits (expected, U-2); tokens and
  wall-clock are the cost that varies.
- **D-8 (COVERED, U-2):** The trials run where the kit runs, on the operator's Windows PC
  with Node and the installed kit; a hosted transport (Firecrawl) is not expected to reach
  loopback, so both kit arms collect with the keyless transports (U-2).
- **D-9 (COVERED, U-1, U-2):** The output is the scored comparison. It is obtainable if the
  fixture server can stage the five kinds offline (U-2); U-1 only names task changes and is
  optional - without it the task texts cite no class.
- **D-10 (COVERED, U-2):** Added for this topic: the study controls re-collection through
  the fixture server's state, so the collector's reach to it is load-bearing.
- **D-11 (COVERED, U-1):** Added for this topic: the plan's optional source for task
  material.

Classified 2026-10-25 by the pre-registration unit (U5) of run
`docs/orchestration/2026-10-25-quote-level-refresh/`, on the collector PC with no
collection budget: the map was seeded with `decompose.mjs --dry-run` (no gathering), so the
candidate material below is empty and both unknowns are KNOWN-UNKNOWN with day-one steps.

## Candidate material

Gathered 2026-10-25.

_No material gathered - run without `--dry-run`, or add URLs to `research/plan.json`._

