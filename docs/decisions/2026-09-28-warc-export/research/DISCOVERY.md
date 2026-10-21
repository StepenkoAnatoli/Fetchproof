# Discovery Contract - Exporting a research corpus as WARC: the WARC 1.1 record format, resource and metadata records, and the tools that read it

Started 2026-09-28. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

An export of a research corpus to WARC, the web-archiving standard, so archive tools can
open and replay what the kit collected. Done means the record format, the right record types
for what the kit stores (extracted text, not raw HTTP exchanges), and an independent reader to
validate the export against are known.

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
| U-01 | What must every WARC 1.1 record carry? | A record missing a mandatory field is not WARC. | CLOSED | E-01: version line, WARC-Record-ID, Content-Length, WARC-Date, WARC-Type; CRLF framing. [single-witness: the standard itself - no second party defines what WARC 1.1 requires] |
| U-02 | Which record type fits content kept without its HTTP exchange? | A `response` record claims a protocol message the kit never stored. | CLOSED | E-01: `resource`, with `metadata` records to describe it. [single-witness: the standard defining its own record types] |
| U-03 | What independent reader can validate an export? | A format writer tested only against itself proves little. | CLOSED | E-02: warcio reads and indexes WARC files and computes digests. [single-witness: warcio documenting itself; the real check is running it on an export, which the build does] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The kit stays dependency-free: the export is written with Node's built-in zlib.
- An export is a copy for other tools; the corpus and its ledger remain the evidence.
