# ADR-0005 — All vendor knowledge lives in one Firecrawl adapter

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** collector, CLI adapter, testing

## Context

The collector's scraper seam was real — `runResearch` demands injected `search`, `scrape`,
and `command` adapters, and `collectOne` takes `runScrape` — but the adapter itself was in
two wrong places:

| Half | Where it lived |
|---|---|
| Transport: shell spawn, quoting, ANSI stripping, JSON extraction, status parsing | `lib/cli.mjs` |
| Payload shapes: `normalizeSearch`, `normalizeScrape`, temp-file handoff, failure classification | `bin/research.mjs` — a command entrypoint |

So the answer to "what does the collector receive from a scrape?" required holding a
library and an entrypoint in your head at once, and the payload contract was defined in a
file whose interface was `main()`. The normalisers were exported for testability but tested
only through hand-written payloads in `test/research-run.test.mjs`.

## Decision

`fetchproof/lib/firecrawl.mjs` is the vendor adapter. `lib/cli.mjs` is deleted and the
adapter halves leave `bin/research.mjs`, which becomes a pure CLI: parse flags, inject the
adapter, render the result.

The interface is four normalised operations plus the pure helpers behind them:

```js
search(query, { limit, exec })  -> { ok, command, results[], error }
scrape(url,   { exec })         -> { ok, command, doc{markdown,title,statusCode,…}, error }
status({ exec })                -> { ok, authenticated, credits, concurrency, text }
command(args)                   -> the exact shell string (--dry-run prints this)
requireAuth({ allowAnonymous, exec })
```

**`exec` is the seam inside the seam.** It defaults to `defaultExec` (a `shell: true`
`spawnSync`, kept because on Windows the `firecrawl` binary is a `.cmd` shim that node will
not spawn any other way) and can be injected, so the whole adapter — command construction,
temp-file handoff, payload normalisation, failure classification — is testable with no
network, no key, and no credits.

**Failure classification happens once, here.** A spawn error, a non-zero exit with no
markdown, or an HTTP status ≥ 400 is a failed fetch. A soft 404 that returns a body must
not become evidence.

**Replay fixtures come from real captures.** `test/firecrawl.test.mjs` replays this
repository's own `research/raw/*.md` bodies through `scrape()` and then through
`collectOne()`, asserting the result is a ledger-backed, well-formed evidence row whose
finding is not the page's promotional banner.

## Consequences

Two latent defects were found the moment the adapter had a testable interface, and a third
was found in an existing test:

1. **`extractJson` preferred `{` over a leading `[`.** For a top-level JSON array it
   returned the array's *first element*, because the first `{` in an array of results
   belongs to result one. A search response arriving as a bare array silently lost every
   result but the first. Now the outermost bracket — whichever opens first — wins.
2. **`parseStatus`'s concurrency class was `[^(n]*`**, excluding `(` *and the letter n*.
   It truncated `"0/2 jobs (parallel scrape limit)"` to `"0/2 jobs"`, and would have
   stopped inside any value containing an `n`. Now it reads to end of line.
3. **A test had encoded defect 2 as correct behaviour**, asserting the truncated value
   because the fixture was a real capture. The expectation is now the full line, with a
   comment saying why.

Also: everything vendor-specific has one file and one reason to change; a Firecrawl CLI
change breaks one module's tests rather than surfacing as a mystery in the collector; and
the percent-encoded-URL quoting rule recorded in the hardening design's deferral table now
has a regression test living next to the code it protects.

Cost accepted: `lib/firecrawl.mjs` is 289 lines and mixes transport with payload shape. It
is one vendor's adapter, and splitting it would recreate the two-halves problem.

## Alternatives considered

- **Leave the normalisers in `bin/research.mjs`, export them for tests.** This was the
  status quo. It makes an entrypoint the definition of a fetch result, so the module that
  consumes the shape (`lib/collect.mjs`) cannot be read without reading a CLI.
- **A generic `Scraper` interface with a Firecrawl implementation.** Rejected as a
  hypothetical seam: there is one scraper, the kit's budget model is Firecrawl's credit
  model, and `AGENTS.md` documents Firecrawl by name. One adapter is not a seam; if a
  second scraper ever appears, `exec` is already the injection point to generalise.
- **Stub `spawnSync` globally in tests.** Rejected: an injected `exec` is a smaller,
  explicit interface, and stubbing a node builtin hides the command string the adapter
  builds — which is one of the things worth asserting.
