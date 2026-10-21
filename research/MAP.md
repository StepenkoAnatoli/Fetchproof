# MAP — topic decomposition

## Topic

Fetchproof's own protocol: metered primary-source collection, provenance, and gate
enforcement for agent-built bots on this machine.

## Subtopics

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | COVERED | U-1 |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | COVERED | U-1 |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | COVERED | U-4 |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | DISMISSED | captures are frozen point-in-time and hash-chained; source drift is handled by retrieval dates, the staleness fail, and --refresh-days - there is no extraction layer whose schema could break |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | DISMISSED | handled structurally, not researched: every claim carries a retrieval date, preflight fails stale evidence past maxAgeDays, and volatile facts are re-collected with --refresh-days |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | COVERED | U-1 |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | COVERED | U-2, U-3 |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-1 |
| S-2 | Which skill root the desktop runtime discovers, and how the protocol binds in Cowork | Decides the binding layer: skills vs AGENTS.md; ADR-0006 rests on it | COVERED | U-2 |
| S-3 | Whether the edit-time PreToolUse gate blocks (allow/deny/ask/defer, exit-2 semantics) | Decides whether the edit-time gate is real enforcement or decoration | COVERED | U-3 |
| S-4 | Collection provenance: which transport fetched a capture, and how much of the page arrived | The chain's guarantee and its honest limits (R6/R7) | DISMISSED | out of scope as an *unknown*: it is now a machine-checked property (transport field + completeness grades + the two contract checks), not a question to research |
| S-5 | Paid-tier Firecrawl pricing beyond the free plan (Hobby/Standard/Growth/Scale) | Relevant only when the free tier binds; recorded with E-01..E-03 during collection | DISMISSED | out of scope for now: solo operator on the free tier; the tier facts are already captured and cited (E-01..E-03), and refresh stays with --refresh-days |
| S-6 | Search providers other than the fetch vendor: what a dedicated search API allows and costs | The kit binds search and fetch to ONE adapter (ADR-0005). Splitting them is only worth an ADR if a dedicated provider is cheaper, more reliable, or permits retention - and each of those is a fact, not a preference | COVERED | U-5, U-8 |
| S-7 | Retention rights: whether a search provider permits storing the results the corpus keeps | The kit writes what it collects into research/raw/ and keeps it. A provider that forbids retention cannot back this design at all, which is the same question U-4 asked of the fetch vendor | COVERED | U-6, U-7 |
| S-8 | The search meter the kit reports against: SerpAPI's hourly cap, its monthly window, and whether the vendor's own counter can replace the local one | Added 2026-09-26 when the account API contradicted E-07. The kit hard-codes both caps and counts spend locally; each of those is a vendor fact, and two of them disagreed with the vendor's own API | COVERED | U-9, U-10, U-11 |

## Coverage notes (per dimension)

- **D-1 Access model — COVERED (U-1).** Sources are public docs/pricing/terms pages,
  fetched through Firecrawl's own service (whose product is exactly this). Keyless
  access from this sandbox is blocked by IP, so collection ran through the agent page
  fetch transport - disclosed in every ledger entry.
- **D-2 Auth and credentials — COVERED (U-1).** No `FIRECRAWL_API_KEY` exists on this
  machine; the kit documents keyless mode and its limits, and `doctor` reports auth
  state. No credential is stored in the repo.
- **D-3 Rate limits and quotas — COVERED (U-1).** The free tier's shape was measured,
  not guessed: 1,000 credits/month, 10 scrape-class requests/minute, 2 concurrent
  browsers, no rollover, 402 at zero.
- **D-4 ToS and legality — COVERED (U-4, E-06).** Firecrawl's ToS (rev. 2024-11-05)
  §5.4 prohibits commercial use of the Services without authorization, reproducing
  Firecrawl's own materials, derivative exploitation of them, and unlawful use. The
  kit's use - personal-research collection of public vendor docs through the service -
  matches none of the enumerated prohibitions; the service's stated purpose (§1) is
  converting websites into LLM-friendly data. Captured partial (chunk 0 of 3), cited
  sections complete and verbatim.
- **D-7 Cost at expected volume — COVERED (U-1).** Free-tier economics measured
  end-to-end, including a real 4-credit `--query --depth quick` run. Paid tiers are
  captured (E-01..E-03) and dismissed for a solo operator (S-5).
- **D-8 Runtime and platform limits — COVERED (U-2, U-3).** The kit executes on this
  Windows desktop's runtimes plus Cowork/cloud sessions; U-2/U-3 established which
  skill roots and gates actually bind in each, and ADR-0006 records the Cowork gap.
- **D-9 Output obtainability — COVERED (U-1), load-bearing.** The stated "done" is
  gated, ledger-backed evidence - and it demonstrably exists: the fetch chain holds
  seven entries with verified body hashes, five evidence rows, six raw captures. The
  output was produced, not assumed.

## Candidate material

Adopted by hand when the kit gained phase 0 (it predates its own phase 0), and
re-checked against the universal set when A6 landed - the ToS dimension (D-4) was
promoted from "never asked" to a real unknown (U-4), collected (E-06), and closed.
Phase 0 evidence for D-1/D-2/D-3/D-7/D-9 lives in `research/raw/` behind U-1; D-4's in
E-06; D-8's behind U-2 and U-3 (E-04/E-05, both carrying R8 verification notes).
