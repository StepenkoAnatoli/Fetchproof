# Discovery Contract - SearXNG's search API as a keyless search transport: the JSON output format, its query parameters and response fields, the settings that enable it, and the bot limiter

Started 2026-09-30. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A `searxng` search transport for the kit: the search seam (ADR-0027) asks a SearXNG instance
the operator runs for results as JSON, with no key, and turns them into the kit's candidate
rows (url, title, description). It exists because the keyless search route scrapes
DuckDuckGo-lite, which answers automated requests with a bot check. Done means: with a
SearXNG URL configured, `decompose` and `research` get ranked candidates from it; a refused
format, an unreachable instance or a malformed row is reported by name, never a crash.

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
| U-01 | What request does the Search API take? | The adapter builds this request; a wrong endpoint or parameter returns nothing. | CLOSED | E-01: `GET /search` with `q` required, plus `format`, `categories`, `language`, `pageno`, `time_range` and `safesearch`. [single-witness: SearXNG's own documentation is the only authority on its API] |
| U-02 | What does a JSON response contain, per result? | The adapter maps these fields onto candidate rows. | CLOSED | E-05, E-06: a `results` array; each result has `url`, `title`, `content` and `engine`, and `url` may be null, so the adapter drops rows without one. [single-witness: two hosts, one author - SearXNG's documentation and its own source are the only authority on what its API returns] |
| U-03 | Does an instance serve JSON by default? | If not, the kit must tell the operator what to change, instead of reporting "no results". | CLOSED | E-01, E-02: no. `search.formats` defaults to `html` only, and an unset format is refused with HTTP 403; many public instances disable JSON. [single-witness: SearXNG's own documentation and settings reference are the only authority on its defaults] |
| U-04 | Will the instance's bot limiter refuse the kit? | A limiter that refuses scripted requests would make the transport fail on the operator's own instance. | CLOSED | E-03: the limiter is off unless `server.limiter: true` is set, and it needs a Valkey database. A private instance serves the kit without it. [single-witness: SearXNG's own documentation is the only authority on how its limiter behaves] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The operator runs the instance. Public instances are not a supported target: E-01 says
  many disable JSON, and the kit must not lean on someone else's server.
- The kit configures only a URL. It never ships, installs or starts SearXNG.
