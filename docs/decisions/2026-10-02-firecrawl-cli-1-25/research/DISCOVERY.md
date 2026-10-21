# Discovery Contract - Firecrawl CLI 1.25 against the 1.24.6 pin: what changed in scrape, search and map and their JSON output

Started 2026-10-02. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A decision about this repository (ADR-0030): whether `TESTED_CLI_VERSION` in
`fetchproof/lib/firecrawl.mjs` should move from 1.24.6 to 1.25.2, the version the CLI's
own update banner now advertises on an operator's PC (2026-10-02). The adapter drives the
`firecrawl` binary with specific flags (`scrape <url> --only-main-content --json`,
`search <q> --limit n --json`, `map <url> --limit n --json`, `--status`) and reads a
specific JSON shape (`data.markdown`, `data.metadata.sourceURL`, `data[].url/title/
description/position`, `links`) and a specific `--status` rendering; it also relies on the
bundled SDK's HTTP client tunnelling through `HTTPS_PROXY` (the 1.23.3 to 1.24.6 move was
forced by exactly that). Done means a reader knows, from the vendor's own pages: what
1.25.0 to 1.25.2 changed, whether any of those flags, fields or renderings changed, what
the new build bundles and requires, and therefore whether the pin can move without a
contract change - or must stay until a fixture is re-captured.

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
| U-01 | Which versions were published between 1.24.6 and 1.25.2, on which dates, and what do their release notes say changed? | The pin moves on a reading of the changes; without the notes a move is a guess and a stay is superstition. | CLOSED | E-01, E-05, E-03: 1.25.0 and 1.25.1 on 2026-09-30, 1.25.2 on npm 2026-10-02 with no GitHub release yet; the notes name signup links, an X-Origin header, the Alexandria skill, enrichment credits in receipts and an --objective flag |
| U-02 | Did the `scrape` command's flags or JSON output change (`--only-main-content`, `--json`, `data.markdown`, `data.metadata.sourceURL`)? | Every capture the kit makes through Firecrawl is read from that shape; a renamed field writes empty captures. | CLOSED | E-02, E-04, E-01: `--only-main-content` and `--json` documented unchanged; no 1.25 note touches scrape or its JSON |
| U-03 | Did the `search` command's flags or JSON output change (`--limit`, `data[]` with `url`, `title`, `description`, `position`, the `warning` and `id` fields)? | Phase 0 and the plan's queries read that shape; a changed array location returns no candidates. | CLOSED | E-02, E-04, E-01: `--limit` and `--json` on search documented unchanged; no 1.25 note touches search output |
| U-04 | Did the `map` output (`links`) or the `--status` rendering (credits, concurrency, authentication line) change? | `--status` is parsed for the credit balance the budget rests on; `map` feeds the relevance floor. | CLOSED | E-02, E-04, E-01: `map --limit --json` and `--status` documented; the docs' status sample is v1.16.2, so the rendering contract is the adapter's fixture, and the 1.25.0 note on receipts is the one line that could reach stdout |
| U-05 | What does 1.25.2 bundle and require - the `firecrawl` SDK and HTTP client versions, and the Node engine - compared with 1.24.6? | The 1.23.3 to 1.24.6 move was forced by the bundled HTTP client failing behind a CONNECT proxy; a bundle change can reintroduce it. | CLOSED | E-06, E-07: identical dependencies and engines - SDK `firecrawl` 4.40.0 exact, node >=22 - so the HTTP client that tunnels through the proxy is the one 1.24.6 bundles |
| U-06 | Does the CLI's authentication (`FIRECRAWL_API_KEY`, `firecrawl login` config) or its update banner behave differently, and where does the banner print? | The adapter reads the key from the environment and parses JSON from stdout after a possible banner; a banner on stdout with brackets, or a moved config path, breaks a working install. | CLOSED | E-02, E-04, E-01: the key sources are unchanged; 1.25.0 prints the keyless signup link and sends X-Origin: cli; where the update banner prints is not documented - the adapter already strips ANSI and skips a leading banner, and the fixture capture is the check |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The pin stays at 1.24.6 until this corpus says the move is safe; a move is a vendor
  update under the freeze (ADR-0117), not a feature.
- The two Firecrawl searches of phase 0 were enough to name the owners; the rest is named
  pages, so the collection costs five scrapes plus one keyless fetch of the npm registry.
