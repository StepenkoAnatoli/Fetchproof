# Discovery Contract - Fetch fallback when Firecrawl credits run out: Firecrawl out-of-credits error, Tavily terms of service data training, Tavily search and extract API credits

Started 2026-09-28. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

When Firecrawl credits run out mid-run, the kit should keep collecting through another
transport instead of recording every remaining page as failed, without breaking the ledger's
per-capture record of which transport fetched what. The operator asked whether Tavily, or
another API, should be that fallback. Done means: the signal to detect is known, the
Tavily question is answered against the existing exclusion (C-6 in
`docs/requirements-2026-09-19-search-fetch-seam.md`), and the fallback is chosen.

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-01 | How does Firecrawl signal that credits have run out? | The fallback must trigger on exhausted credits and not on throttling or a bad page. | CLOSED | E-01, E-02, E-10: HTTP 402 Payment Required, until the monthly reset on the free plan; 429 is the separate rate-limit signal. |
| U-02 | Has Tavily's C-6 trigger - a no-training tier - been met since 2026-09-22? | C-6 excludes Tavily; only its trigger reopens it. | CLOSED | E-03, E-04, E-09: no. Terms §6.5 and §6.7 are unchanged, and only a negotiated contract can change query-data use. The FAQ's "zero data retention" contradicts the terms; the terms govern. |
| U-03 | What would a Tavily transport cost and look like, if the trigger were met? | The decision records what is being given up. | CLOSED | E-05, E-06, E-07, E-08: 1,000 free credits a month; 1 credit a basic search, 1 per 5 successful extractions, failures free; Bearer-key POST APIs; 100 requests a minute. |
| U-04 | How does Firecrawl CLI 1.24.6 report exhausted credits to the kit? | The kit reads the CLI's output, not the HTTP status. | CLOSED | E-10, E-11: the CLI prints the API's error text, `Insufficient credits to perform this request...`; the status 402 does not reach the kit. Match the words, case-insensitively. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- C-6 (Tavily out of scope) stands unless its own trigger is met; this project re-checks the trigger, it does not re-argue the exclusion.
- No paid tier of anything (the seam requirements' out-of-scope list).
