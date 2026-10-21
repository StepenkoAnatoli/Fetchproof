# Brief - SearXNG's search API as a keyless search transport: the JSON output format, its query parameters and response fields, the settings that enable it, and the bot limiter

_Auto-drafted 2026-09-30 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

A `searxng` search transport for the kit: the search seam (ADR-0027) asks a SearXNG instance
the operator runs for results as JSON, with no key, and turns them into the kit's candidate
rows (url, title, description). It exists because the keyless search route scrapes
DuckDuckGo-lite, which answers automated requests with a bot check. Done means: with a
SearXNG URL configured, `decompose` and `research` get ranked candidates from it; a refused
format, an unreachable instance or a malformed row is reported by name, never a crash.

## What we verified

| Claim | Source | Type |
|---|---|---|
| The Search API is `GET` or `POST` on `/` or `/search`, with `q` required and `categories`, `language`, `pageno`, `time_range`, `format` (json, csv, rss) and `safesearch` optional. A format the instance has not enabled is refused with HTTP 403. [quote: Requesting an unset format will return a 403 Forbidden error.] [quote: Be aware that many public instances have these formats disabled.] | E-01 `docs.searxng.org` (U-01, U-03) | P |
| `get_json_response` returns an object whose `results` is each ordered result's `as_dict()`, beside `query`, `answers`, `corrections`, `infoboxes`, `suggestions` and `unresponsive_engines`; the CSV writer beside it reads `title`, `url`, `content`, `engine` and `score` from the same results. | E-05 `raw.githubusercontent.com` (U-02) | P |
| MainResult carries `title`, `content` (the snippet), `url`, `engine`, `engines`, `score` and `category`, and `url` is typed `str \| None`, so a result can arrive without one. [quote: Extract or description of the result item] | E-06 `docs.searxng.org` (U-02) | P |
| `search.formats` lists the output formats an instance serves, and its default is `html` only, so JSON must be added to `settings.yml` before the API answers it. [quote: Result formats available from web, remove format to deny access] | E-02 `docs.searxng.org` (U-03) | P |
| The limiter is bot protection that is off until `server.limiter: true` is set, and it needs a Valkey database; it exists because SearXNG itself gets blocked by the engines it queries on behalf of bots. [quote: To enable the limiter activate] [quote: the requests from bots to SearXNG must also be blocked, this is the task of the limiter] | E-03 `docs.searxng.org` (U-04) | P |

## Contradictions and how they were resolved

None found. The Search API page (E-01) and the settings reference (E-02) agree that JSON
must be enabled in `search.formats`, and the docs (E-06) and the source (E-05) agree on the
result fields. All come from one project, so they cannot contradict each other the way
independent sources could; the adapter's tests pin the shape instead, and a changed shape
shows up as dropped rows rather than wrong ones.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

Build a search-only provider, `lib/searxng.mjs`, beside `lib/serpapi.mjs`, and register it
in `SEARCH_PROVIDERS` so `--search-transport searxng` selects it.

- **Configuration:** the instance URL from `SEARXNG_URL` or `searxngUrl` in the machine
  config. With no URL, the provider is not ready, reported the way SerpAPI's missing key is
  (`notReady`), never a crash.
- **Request:** `GET <url>/search?q=<query>&format=json` (E-01), through the kit's proxy-aware
  fetch, with a timeout.
- **Response:** map `results[]` to `{ url, title, description: content }`, dropping any row
  that is not an object or has no string `url` (E-06: `url` may be null).
- **Errors, each by name:** HTTP 403 means JSON is not enabled, so the message names
  `search.formats` in `settings.yml` (E-01, E-02). Unreachable, non-JSON body and timeout
  each get their own message.
- **Selection:** explicit only (`--search-transport searxng`, or `searchTransport` in the
  machine config). Automatic selection is unchanged.

**Out of scope:** installing or starting SearXNG, public instances, the limiter (off by
default, E-03), CSV and RSS formats, and paging beyond the first page.

**First step:** a failing offline test that feeds `normalizeSearch` a captured-shape JSON
body with a null-url row and a non-object row, and expects only the valid rows back.

## Next steps

1. Contradictions and Decision were reviewed by an agent on 2026-09-30.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=24b9f63c70667a3d inputs=80652f4b6b652f43 gate=pass -->
