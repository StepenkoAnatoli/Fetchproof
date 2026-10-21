# ADR-0066 — A refused or empty search is reported, and the user agent stays honest

- **Date:** 2026-09-27
- **Status:** accepted
- **Area:** `lib/http-transport.mjs` (`search`), `lib/research-run.mjs`

## Context

On 2026-09-27 a keyless plan query ended with "collected 0, cached 0, failed 0", and nothing
in the output said a search had run. DuckDuckGo had answered the kit's user agent
(`fetchproof/1.0 (+keyless transport; ...)`) with its bot check: HTTP 200, an
`anomaly-modal`, "Unfortunately, bots use DuckDuckGo too", and no result links. The adapter
parsed zero links and returned `ok: true`. The same query fetched with a browser user agent
returned ten results.

## Decision

- The keyless `search` treats a page with the bot-check markers and no result links as a
  failed search, with a reason that names the bot check and suggests retrying later or using
  a keyed provider. It then takes the path every failed search takes: the failure log, and
  the fallback where one exists.
- `runResearch` logs every search's outcome: `found N for "<query>"`, or `search found
  nothing: <query>`. A search that found nothing is recorded in `.failures.jsonl` as
  `op: search-empty`.

## Rejected alternatives

- **Send a browser user agent.** It would get past the check, but that is evading a
  service's bot detection. The kit's user agent says what it is, and a refusal is reported
  rather than worked around.
- **Retry until results come back.** The check is the service saying no. Retrying in a loop
  turns an honest refusal into load.
- **Report only failures, not empty results.** For the operator an empty search and a failed
  one pose the same question - this query produced nothing to read - and an empty search had
  been completely silent.

## Trigger that would reopen this

DuckDuckGo changing its check page so that neither marker appears, in which case the test
built from the captured page would pass while real bot checks slipped through again.
