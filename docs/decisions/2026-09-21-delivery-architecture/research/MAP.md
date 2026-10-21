# MAP - topic decomposition

## Topic

How Fetchproof should be delivered to a non-technical user

## Subtopics

Statuses judged 2026-09-21, after collection. The nine universal dimensions are seeded by
`decompose.mjs`; D-10 and D-11 are topic-specific and were added by hand, because the
checklist has no row for "who is allowed to press the button" or "what does pressing it
leak".

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1, U-7 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | COVERED | U-5, U-6, U-7 |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | COVERED | U-3 |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | already settled in the parent corpus and not re-opened here: U-4 and U-6/U-7 of `../../../research/DISCOVERY.md` establish that the vendors' terms permit this kit's collection and retention. This project changes *where the kit runs*, not what it fetches or on whose authority, so no term is newly engaged |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-1 - and it is the finding of this project. The dispatch response schema is versioned, and it changed: `204` with no body under `2022-11-28`, `200` with `{workflow_run_id, run_url, html_url}` under `2026-03-10`. A design that read the response without pinning `X-GitHub-Api-Version` would have been built against whichever shape happened to be the default |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-2 - artifact retention is literally a staleness clock: 90 days on this public repository, after which the delivered ZIP is gone. E-03 also carries a dated platform change (2026-10-01) that moves run and check retention under the same policy |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | COVERED | U-3 |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | COVERED | U-4 |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-1, U-2, U-8. Load-bearing and satisfied: the artifact exists, the caller can identify the run that produced it, and the run can be named from an input. The one part still unproven end-to-end is the runner installing the vendor CLI, recorded as a gap below rather than claimed |
| D-10 | Who may trigger a run, and how | "The operator presses a button" is the whole premise of an Actions-first delivery. If pressing it needs write access to the repository, the premise is narrower than it sounds | COVERED | U-7 |
| D-11 | What a run discloses about its own subject | This kit's payload is the research question. A delivery mechanism that publishes the topic is unusable for a topic that matters | COVERED | U-6 |

## Coverage notes (per dimension)

- **D-1 Access model - COVERED (U-1, U-7).** An official, versioned REST API plus a UI
  button. No scraping, no auth-walled app, no paywall. The design consequence is that the
  contract is GitHub's to change, which D-5 shows it has.
- **D-2 Auth and credentials - COVERED (U-5, U-6, U-7).** Dispatch needs Actions: write.
  The Firecrawl credential lives in an environment secret, sealed-box encrypted, released
  only after protection rules pass - and, on a free plan, only while the repository is
  public (E-06). The operator holds the credential; no user of the delivered tool does.
- **D-3 / D-7 Quotas and cost - COVERED (U-3).** Zero on standard runners while public.
  Private draws on a monthly minute quota billed to the repository owner. The number that
  actually binds is not here: it is the Firecrawl credit, metered on every route.
- **D-4 ToS - DISMISSED with reason.** See the table.
- **D-5 Schema stability - COVERED (U-1), and load-bearing.** The dispatch response shape
  is API-version-dependent and was observed in both shapes on 2026-09-21. Any client must
  pin `X-GitHub-Api-Version`.
- **D-6 Freshness - COVERED (U-2).** 90 days, public, non-extendable without going private.
- **D-8 Runtime limits - COVERED (U-4).** Node SEA is Stability 1.1; Windows supported,
  macOS x64 not. The part the kit would lean on - `useVfs` for bundled assets - is 1.0.
- **D-9 Output obtainability - COVERED, load-bearing.** See the table, including the gap.
- **D-10 Who may trigger - COVERED (U-7).** Write access, and the workflow file must be on
  the default branch before the button appears at all.
- **D-11 Disclosure - COVERED (U-6).** Measured, not read: run metadata, step names and
  artifact names are readable by an anonymous caller on a public repository; secrets and
  raw logs are not.

## Known gaps, stated rather than covered

Neither is an unknown in the contract, because neither blocks *this* decision - but both
block the thing the decision recommends building, and omitting them would misrepresent
what has been established.

- ~~**The runner-side install path has still never executed.**~~ **Closed 2026-09-21.** It
  now has, on a real runner, twice - runs `35600022797` and `35608301287` - including
  `cliCompatibility()` against the CLI the runner installed. The first attempt failed, and
  that is exactly why the gap deserved naming rather than assuming: the workflow installed
  `firecrawl`, which on npm is the SDK and ships no binary at all. The CLI is
  `firecrawl-cli`, and no amount of reading the documentation would have found it.
- ~~**Whether artifact download is ergonomic for the intended operator.**~~ **Closed by
  decision 2026-09-21, not by evidence.** A usability question. No quantity of vendor
  documentation answers it, and this corpus never pretended to — it was carried because the
  answer would have decided between the artifact route and a local `.exe`.
  `docs/decisions/2026-09-21-sea-assets/` removed the technical objection to the `.exe`, and
  the operator then rejected it on scope: the agent path already serves a person without a
  terminal. With no alternative left to compare against, the question stops being a gap and
  becomes ordinary feedback. If download proves painful in use, that reopens the `.exe`, and
  the route is already researched.

## Corroboration, 2026-09-21

Three more pages, into the same ledger - twelve entries, one unbroken chain. They are
second sources for the three claims that carry decisions (U-1, U-3, U-5), not new
subtopics, so no row above changes status. What changed is that those three rows no longer
rest on a single reading.

## Candidate material

Gathered 2026-09-21. No search was run: the nine URLs were chosen directly, one per
unknown, and each was confirmed to answer HTTP 200 before collection so that no credit was
spent on a 404 (a 404 page is still delivered and still charged - E-13 in the parent
corpus). Nine pages fetched, nine graded `full`, none failed.

Hosts that owned the facts: `docs.github.com` (eight pages - dispatch API, artifacts,
repository settings, billing, environments, secrets, events, workflow syntax) and
`nodejs.org` (one - single-executable applications).
