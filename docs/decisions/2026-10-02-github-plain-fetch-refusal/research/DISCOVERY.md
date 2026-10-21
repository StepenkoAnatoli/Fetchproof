# Discovery Contract - When and why GitHub answers 403 to unauthenticated non-browser fetches of github.com pages, and which routes GitHub documents for fetching a README or raw file without a browser session

Started 2026-10-02. This file is the definition of "enough information to build".
`node "/root/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A decision about this repository (ADR-0030): what the keyless transport should say when
github.com (or api.github.com) answers 403 to its plain fetch, and which free route it may
name as the remedy. Found 2026-10-02 collecting the Ollama README for a MoonAliza project:
`https://github.com/ollama/ollama` answered 403 to the keyless fetch, to curl with a Chrome
User-Agent and to plain curl alike, while `raw.githubusercontent.com` answered 200 and the
kit's browser transport fetched the page. Done means the corpus says what GitHub documents
about unauthenticated requests and 403s, which routes it documents for a README or a raw
file, whether automated fetching of public pages is permitted, and what the three hosts
answer today from this address - so the failure message names a route that is documented,
permitted and measured, not guessed. The change is wording of a named failure, allowed
under the freeze (ADR-0117).

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
| U-01 | What does GitHub document about unauthenticated requests - the rate limit per address, the secondary limits, and when it answers 403 rather than 429? | A 403 that is a rate limit calls for waiting; one that is a block calls for another route. The message must say which. | CLOSED | E-01, E-02: 60 unauthenticated requests an hour per IP against the API, secondary limits for abuse; a rate-limit refusal is 403 or 429 with x-ratelimit-remaining 0. The measured 403 had neither the header nor GitHub's body. |
| U-02 | Which routes does GitHub document for fetching a README or a raw file without a browser session - the raw host, the REST contents and readme endpoints, their media types? | The remedy must name a route GitHub itself documents, not a trick. | CLOSED | E-03, E-04, E-07, E-10: the contents and readme endpoints (raw text by default) and the download_url they carry on raw.githubusercontent.com; the community names the same host with a commit SHA for permanence. |
| U-03 | Does GitHub's acceptable use policy permit automated fetching of public pages, and under what conditions? | A remedy that routes around a prohibition would be a kit that teaches a violation. | CLOSED | E-05, E-08: scraping is defined and permitted for research with open-access results and for archival; excessive automated bulk activity is forbidden; robots.txt asks crawlers to contact support, allows marketing paths and disallows repository sub-pages. A cited corpus of a few public pages is within the permitted uses; the kit is not a crawler. |
| U-04 | What do github.com and api.github.com answer today, from this address, to a plain fetch - and does the kit's browser transport get the same page? | The ledger's own fail entries and captures are the measurement the message rests on; a route is named only if it was seen to work. | CLOSED | E-09, E-10, E-08, E-07 and ledger entries 5, 7-9 (keyless, HTTP 403) against 11-14 (browser, served): from this address github.com and api.github.com refuse the plain fetch and serve the browser transport. The 403 body, read with curl, is this session's egress proxy refusing a repository not attached to the session - not GitHub's rate limit, not a User-Agent check. The keyless transport recorded only "HTTP 403" and threw that body away. |
| U-05 | Does raw.githubusercontent.com answer a plain fetch of a file today? | The simplest free route; named only if measured. | CLOSED | E-06: raw.githubusercontent.com served the README to the plain fetch (ledger entry 10, status 200). |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- No User-Agent spoofing: the measurement showed the block is by address, not by client
  string, and a kit that lies about what it is would not be the kit (ADR-0105's spirit).
- The remedy is wording and, at most, a pure helper with a test; no new transport, flag or
  file (ADR-0117).
