# Discovery Contract - Internet Archive Wayback Machine as a witness for captured pages: the Wayback Availability API, Save Page Now requests and their limits, what a saved capture makes public, and the terms of use

Started 2026-09-30. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

An opt-in `--witness` flag for `research`: after a page is captured, the kit asks the Wayback
Machine whether a third party already holds a snapshot of the same URL, and records the
closest one (its Wayback URL and timestamp) beside the capture. A snapshot taken close to
the kit's own retrieval is an independent witness that the page existed and roughly what it
said. The kit's ledger proves a capture was not edited after it was fetched, but not that
the page said so. Done means: with `--witness`, each new capture gets a witness record or a
named "no snapshot"; without the flag, nothing is sent to the Internet Archive; and no
witness result can fail, block or change a capture.

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
| U-01 | How does a program ask whether the Wayback Machine holds a snapshot of a URL, near a given time? | The witness is this lookup; its request and response shape are the whole adapter. | CLOSED | E-01: `GET archive.org/wayback/available?url=...&timestamp=YYYYMMDDhhmmss` returns `archived_snapshots.closest` (`available`, `url`, `timestamp`, `status`), or an empty `archived_snapshots` when there is none. [single-witness: the Internet Archive's own API page is the only authority on its API] |
| U-02 | Is there a documented way for a program to request a new save (Save Page Now)? | Without one, the witness can only look up snapshots others made; the kit does not call undocumented endpoints. | KNOWN-UNKNOWN | E-02 documents Save Page Now only as a web form and browser extensions. Day-one step: capture the Internet Archive's own Save Page Now API documentation (SPN2) as an owner page, with its authentication and rate limits, before any code requests a save. Until then the witness is lookup-only. |
| U-03 | What does sending a URL to the Internet Archive disclose, and what does a saved page make public? | A witness must not publish the operator's research without their choice. | CLOSED | E-02, E-03: a saved page is public and permanent ("can be cited, shared, linked to") and the collections are open to everyone; a submission is anonymous (no IP kept). A lookup creates nothing, but it still sends the URL to the Internet Archive, so the flag is opt-in. [single-witness: the Internet Archive's own help pages are the only authority on its policies] |
| U-04 | Do the Terms of Use permit automated queries of the Availability API? | Terms that forbid scripted access would end the feature. | KNOWN-UNKNOWN | E-05: the terms page could not be read by the kit - the headless browser got 12 characters, after a keyless fetch got 93. Day-one step: read archive.org/about/terms in a browser and record the clause on automated access, or capture it with --transport firecrawl-cli. The flag stays opt-in until then, and the kit sends one lookup per captured page, not a crawl. |
| U-05 | What rate limit applies to the Availability API? | A limit hit mid-run would turn witnesses into failures. | KNOWN-UNKNOWN | E-01 states none. Day-one step: note the HTTP status and any Retry-After on the first refused lookup. The design does not depend on the number: one lookup per newly captured page, never retried in the run, and a refused lookup is recorded as "not witnessed" with its status. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The witness is opt-in (the user, 2026-09-30): it sends every captured URL to the Internet
  Archive, and nothing leaves the machine unless the operator asks.
- A witness never blocks, fails or alters a capture. The ledger's proof stands on its own;
  the witness only adds to it.
