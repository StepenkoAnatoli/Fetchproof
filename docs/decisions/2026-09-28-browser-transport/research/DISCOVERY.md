# Discovery Contract - Headless Chromium as a free transport: dump-dom rendering, proxy settings, sandbox and timeouts

Started 2026-09-28. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A free transport that renders pages with a locally installed Chromium, for pages the
keyless transport cannot read (JavaScript-built pages, sites that refuse non-browser
clients) and as a better credits-exhausted fallback. The kit has no dependencies, so it
must drive Chromium from the command line, not through a driver library. Done means the
command, the proxy route, the sandbox constraint and the failure modes are known.

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
| U-01 | Can the rendered page be taken from the command line, with no driver library? | The kit is dependency-free. | CLOSED | E-01, E-02: `--headless --dump-dom <url>` prints the rendered DOM to stdout. |
| U-02 | How is a proxy given to Chromium? | Collection runs behind proxies (this environment, corporate networks). | CLOSED | E-03: `--proxy-server=<uri>`. |
| U-03 | When must the sandbox be turned off? | Chromium refuses to start as root with its sandbox on. | KNOWN-UNKNOWN | The owning Chromium page answered 503 (E-04). ArchiveBox passes `--no-sandbox` in containers (E-05, secondary). Day one: pass `--no-sandbox` only when running as root, and confirm on the first non-root Windows run that Chromium starts without it. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- No npm dependency: the kit stays zero-dependency, so no Puppeteer or Playwright library.
- Never weaken TLS: no `--ignore-certificate-errors`. A proxy that intercepts TLS is trusted by adding its CA to the browser's store, as the environment provides it.
