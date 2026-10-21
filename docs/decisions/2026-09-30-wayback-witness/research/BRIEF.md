# Brief - Internet Archive Wayback Machine as a witness for captured pages: the Wayback Availability API, Save Page Now requests and their limits, what a saved capture makes public, and the terms of use

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

An opt-in `--witness` flag for `research`: after a page is captured, the kit asks the Wayback
Machine whether a third party already holds a snapshot of the same URL, and records the
closest one (its Wayback URL and timestamp) beside the capture. A snapshot taken close to
the kit's own retrieval is an independent witness that the page existed and roughly what it
said. The kit's ledger proves a capture was not edited after it was fetched, but not that
the page said so. Done means: with `--witness`, each new capture gets a witness record or a
named "no snapshot"; without the flag, nothing is sent to the Internet Archive; and no
witness result can fail, block or change a capture.

## What we verified

| Claim | Source | Type |
|---|---|---|
| The Wayback Availability JSON API is `GET http://archive.org/wayback/available?url=<url>` with an optional `timestamp` (1-14 digits, YYYYMMDDhhmmss); it returns `archived_snapshots.closest` with `available`, `url` (the snapshot's Wayback link), `timestamp` and `status`, the closest snapshot to the timestamp or the most recent one. [quote: If the url is not available (not archived or currently not accessible), the response will be:] - and the body is then `{"archived_snapshots":{}}`. The page is dated September 2013 and warns it changes often. _(partial capture)_ | E-01 `archive.org` (U-01) | P |
| Save Page Now is documented here as a web form and browser extensions, not as an API: a URL put into the form is saved as one page (no outlinks), some sites cannot be saved, and a saved page is public and permanent. [quote: These saved pages can be cited, shared, linked to] [quote: We do not keep your IP address, so your submission is anonymous.] _(partial capture)_ | E-02 `help.archive.org` (U-03) | P |
| The collections, the Wayback Machine's captures among them, are open to everyone, and use of them is governed by the Terms of Use (archive.org/about/terms.php). [quote: The Internet Archive is dedicated to providing free and open access to its collections] | E-03 `help.archive.org` (U-03) | P |

## Contradictions and how they were resolved

None between the sources. One tension to know about: the API page (E-01) is dated
September 2013 and says it "is subject to change frequently". The builder should treat
its response shape as the documented one, and make every field optional in the parser, so
a changed shape reads as "not witnessed" rather than a crash.

## Known unknowns

- **U-02** - Is there a documented way for a program to request a new save (Save Page Now)?
  - Day-one verification: E-02 documents Save Page Now only as a web form and browser extensions. Day-one step: capture the Internet Archive's own Save Page Now API documentation (SPN2) as an owner page, with its authentication and rate limits, before any code requests a save. Until then the witness is lookup-only.
- **U-04** - Do the Terms of Use permit automated queries of the Availability API?
  - Day-one verification: E-05: the terms page could not be read by the kit - the headless browser got 12 characters, after a keyless fetch got 93. Day-one step: read archive.org/about/terms in a browser and record the clause on automated access, or capture it with --transport firecrawl-cli. The flag stays opt-in until then, and the kit sends one lookup per captured page, not a crawl.
- **U-05** - What rate limit applies to the Availability API?
  - Day-one verification: E-01 states none. Day-one step: note the HTTP status and any Retry-After on the first refused lookup. The design does not depend on the number: one lookup per newly captured page, never retried in the run, and a refused lookup is recorded as "not witnessed" with its status.

## Decision

Build a lookup-only witness behind an opt-in `research --witness` flag.

- **Module:** `lib/witness.mjs`, with `lookup(url, { timestamp })`. It sends
  `GET https://archive.org/wayback/available?url=<url>&timestamp=<capture time as YYYYMMDDhhmmss>`
  (E-01) through the kit's proxy-aware fetch, with a timeout, as a child job like the other
  adapters.
- **Result:** `{ witnessed: true, snapshot, timestamp, status }` from
  `archived_snapshots.closest`, or `{ witnessed: false, reason }` for an empty response, a
  refusal (with its HTTP status, U-05) or a network error. Every field is optional in the
  parser.
- **Record:** after each newly *collected* page (not a cache hit), `research` appends one
  line to `research/witnesses.jsonl`: `at`, `url`, the capture's `raw` path, and the
  lookup's result. This file sits outside `research/raw/` and outside the hash-chained
  ledger, so a witness can never alter or fail a capture. It is not a dotfile, so it
  travels with git by default.
- **Without `--witness`:** nothing is sent to the Internet Archive. That is the default,
  and a test pins it.

**Out of scope:** requesting new saves (Save Page Now), until U-02's documentation is
captured; any gate check on witnesses; retries (U-05).

**First step:** a failing offline test that feeds the parser the two documented bodies
(E-01, a found snapshot and `{"archived_snapshots":{}}`) and a malformed one, and expects a
witnessed record, a named "no snapshot", and a named malformed result.

## Next steps

1. Contradictions and Decision were reviewed by an agent on 2026-09-30.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=ac901c65302713a9 inputs=39bb1ae3db5d453c gate=pass -->
