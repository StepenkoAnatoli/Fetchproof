# ADR-0088 — A local Chromium is a fetch transport, chosen by name

- **Date:** 2026-09-28
- **Status:** accepted
- **Area:** `lib/browser-transport.mjs`, `lib/transport.mjs` (`TRANSPORTS.browser`, the search side of a fetch-only transport), `bin/research.mjs` (credits fallback)
- **Evidence:** `docs/decisions/2026-09-28-browser-transport/` (U-01..U-03)

## Context

The keyless transport reads the HTML a server sends, so it cannot read a page that
JavaScript builds, or one whose site refuses clients that are not browsers. On 2026-09-28 a
GitHub Discussion answered the keyless client with HTTP 403. The only other way to read such
a page was Firecrawl, which is metered, and whose credits can run out (ADR-0086).

## Decision

- **The transport:** `browser` runs a locally installed Chromium or Chrome as
  `--headless --disable-gpu --virtual-time-budget=8000 --dump-dom <url>`, spawned as an
  argv array with no shell (E-01, E-02).
  - **Grading:** the rendered DOM goes through the keyless transport's own extractor and
    grading, so both transports judge a page the same way.
  - **Proxy:** passed as `--proxy-server` when one is configured (E-03).
  - **Sandbox:** `--no-sandbox` is passed only when running as root (U-03, a known unknown).
- **Failures:**
  - A timeout or a non-zero exit is a failure.
  - So is Chromium's own error page. `--dump-dom` exits 0 while printing it, which was seen
    here behind a proxy whose CA it did not trust. The failure names the code it found
    (`ERR_CERT_AUTHORITY_INVALID`).
- **Finding the browser:** `browserPath` in the machine config, then
  `RESEARCH_KIT_BROWSER`, then the usual install paths.
- **Chosen by name only:** auto-detection is unchanged. The transport fetches and does not
  search, so a run on it searches through the keyless route and says so. It is not a
  search provider.
- **Credits fallback:** the ADR-0086 fallback prefers `browser` when a browser is found,
  else `http-keyless`.
- **Measured on 2026-09-28:**
  - The GitHub Discussion rendered in full: 92 KB of capture, 45 mentions of its subject.
    The keyless transport got HTTP 403 for it.
  - Both captures chained, and the handoff check passed.

## Rejected alternatives

- **A driver library (Puppeteer, Playwright).** The kit is dependency-free. The browser's
  own command line is enough to dump a page.
- **`--ignore-certificate-errors` to get through a TLS-intercepting proxy.** It weakens
  TLS. The proxy's CA is trusted by adding it to the browser's store, as the environment
  provides it.
- **Trusting the exit code.** Chromium exits 0 on its own error page. That is the same
  class of failure as the Firecrawl 503 page fixed in 13ff0ea.
- **Auto-selecting the browser whenever one is installed.** An opt-in that changes the
  default is not an opt-in, and collection results would shift under operators who never
  asked for it.

## Clarification, 2026-10-08: a retained DOM and process completion

The original timeout-failure bullet describes a render without a complete DOM. The
implementation has already distinguished this since 2026-10-01: a whole HTML dump
followed by an exit hang and `ETIMEDOUT` remains a render. A timeout without a complete
dump remains a failure. Guard refusals, Chromium's own error page, the observed origin
status, and completeness grading still judge the retained document. The existing
`a browser that printed the page and then hung is a render, not a timeout` unit test
records that exception. This clarification documents the existing behavior; it does not
reverse the transport decision or introduce another timeout policy.

The guard's `elapsedMs` timestamps process completion, not DOM arrival. Its pending
requests are also a snapshot at process completion. Subtracting startup can support the
existing conservative partial classification, but cannot establish the instant loading
stopped or locate the historical wait inside the browser. The diagnostic therefore
states the configured loading deadline and the request state at process completion.
No timing field, budget, or completeness rule changes with this wording correction.
