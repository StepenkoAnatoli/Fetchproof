# ADR-0174 — A page the kit refused for what it is is not fetched again within the refresh window

- **Date:** 2026-10-17
- **Status:** accepted
- **Area:** `lib/collect.mjs` (`recentlyGone`), `lib/research-run.mjs` (the budget loop)
- **Extends:** ADR-0100 (a page that is gone is not fetched again)

## Context

ADR-0100 remembers one kind of failure: a 404 or 410 within `refreshDays`. It rejected
"remember every failure", because a 503 or a timeout says nothing about tomorrow.

Several refusals were added after it, and they are not about tomorrow either. They are the
kit's own judgment of what the page is:
- the text is over the size a capture may hold (ADR-0082);
- the response is binary, such as a PDF (ADR-0105);
- the page is an error page (2026-09-28). A 401, a 402 paywall or a 403 is the server's
  standing answer to this client.

Measured on 2026-10-11 (#316) with a fake `firecrawl` that answers each URL the same way
every time: on the second run of one plan, every success was cached and every refused page
was scraped again. On the real CLI each of those is a credit. The vendor was paid to deliver
an 11 MB page that the kit threw away on arrival, on every run. `--refresh-days` did nothing
for it, because the cache consults only successful captures. The keyless route spent its
per-IP allowance the same way on its own refusals.

A second gap was found on the way. The keyless and browser transports word a status as
`HTTP 404 - the server said ...`, and ADR-0100's matcher read only the collector's wording
(`the page answered HTTP 404`). So a keyless 404 was never remembered.

## Decision

- **A remembered failure is gone or refused.** `recentlyGone` reads the ledger's last word on
  the URL, as before, and recognises:
  - **gone:** HTTP 404 or 410, in either wording (ADR-0100, now for every transport).
  - **refused:** the size-cap refusal of the collector and of the transports (ADR-0082) and
    the binary refusal (ADR-0105), whichever route fetched the page; and any other 4xx except
    405, 407, 408 and 429, **for the route that got it only**.
- **What happens to a remembered failure.** It is handled exactly like a gone page:
  - `collectOne` returns `status: 'refused'` with `spent: 0`.
  - The reason names the cause, the date and `--force`: "refused on <date>: the response is
    not text - not fetched again for 30 days; --force retries it".
  - The research loop sets it aside before the budget and logs it as `refused`.
- **A standing 4xx belongs to the route that asked.** `recentlyGone` is told which transport is
  about to fetch (`collectOne` passes its `transportName`; the research loop passes the live
  adapter's name), and the ledger entry's `transport` must be that one. A page that refuses the
  keyless client is what the browser route is for (ADR-0088), so a keyless 403 is not a reason
  to keep the browser away. A size or binary refusal, and a 404 or 410, are about the page.
- **Matched at the start of the failure's text.** A status quoted inside some other failure's
  text is not read as this page's.
- **A rate limit is never remembered, whatever its status.** A failure whose text reads as a
  rate limit (`rateLimitWaitMs`) is not standing: GitHub answers a keyless client
  `403 ... API rate limit exceeded`, and the wait loop already treats that as "not now".
- **Still retried, as before:**
  - a 5xx;
  - a 408 or a 429 (both are about this moment);
  - a 405 or a 407 (what a proxy answers for every page it will not carry - #314's proxy
    answered 405 to a loopback target - not the page's answer);
  - a timeout, a cut connection or another transport error;
  - Firecrawl's own failures, including exhausted credits.
- **Retrying anyway:** `--force` retries, and so does waiting out the refresh window.

## Rejected alternatives

- **Remember every failure.** ADR-0100 rejected this, and the reason still holds: a 503 or a
  timeout says nothing about tomorrow.
- **Remember only the kit's own refusals and leave the 4xx out.** A 401 or 403 is the same
  answer on every run, so it would still be paid for on every run. A 402 paywall is the same.
  A server that does change its answer is reached again when the window passes, or with
  `--force`.
- **Remember a 408 or 429 too.** Both say "not now", and #313 makes the collector wait out a
  429 rather than fail it.
- **Remember a 405 or 407.** A proxy's own refusal arrives on every page it handles. It would
  be remembered as each page's answer, and only `--force`, which refetches the whole plan,
  would clear it.
- **A separate status code or ledger field for "deterministic".** The ledger entry already
  names the reason in words. A field would be a format change during the feature freeze
  (ADR-0117), and it would not apply to the entries already written.
- **Key all of the memory on the transport.** A size cap or a binary type is a property of the
  page, not of the route that fetched it. Remembering those per transport would pay again on
  the other route for the same answer.
- **Key none of it on the transport (this ADR's first draft, 2026-10-17).** Reviewed on
  2026-10-18: a keyless 403 then kept a later `--transport browser` run away from the page for
  30 days, and `--force` - the only way past it - refetches the whole plan.

## Revisit when

- A vendor or server is seen answering a 4xx that clears on its own within days, such as a
  403 that is really bot-throttling, often enough that the window costs real pages; or
- the ledger gains a structured failure field, so the matcher can read a code instead of
  words; or
- a proxy is seen answering a status other than 405 or 407 for pages it will not carry.
