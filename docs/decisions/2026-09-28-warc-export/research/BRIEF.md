# Brief - Exporting a research corpus as WARC: the WARC 1.1 record format, resource and metadata records, and the tools that read it

_Auto-drafted 2026-09-28 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
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

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> I expect WARC 1.1 to require a version line, WARC-Type, WARC-Record-ID, WARC-Date and Content-Length per record, with 'resource' records for content fetched without its HTTP exchange and 'metadata' records for description; and gzip per record to be optional. Since the kit keeps text, not raw HTTP responses, resource records are the honest type.

## Intent

An export of a research corpus to WARC, the web-archiving standard, so archive tools can
open and replay what the kit collected. Done means the record format, the right record types
for what the kit stores (extracted text, not raw HTTP exchanges), and an independent reader to
validate the export against are known.

## What we verified

| Claim | Source | Type |
|---|---|---|
| WARC 1.1: a record is a "WARC/1.1" version line, named fields, CRLF, the block, CRLF CRLF; WARC-Record-ID, Content-Length, WARC-Date and WARC-Type are mandatory. A resource record holds content "without full protocol response information"; a metadata record describes another record; compressing each record as its own GZIP member is recommended. [quote: A ‘resource’ record contains a resource, without full protocol response information] | E-01 `iipc.github.io` (U-01, U-02) | P |
| warcio (Webrecorder), a reference reader and writer: it computes block and payload digests itself and ships a CLI that indexes a WARC's records - an independent reader to validate an export against. [quote: The block and payload digests are computed automatically] | E-02 `github.com` (U-03) | P |

## Contradictions and how they were resolved

None. The one choice the sources leave open is the digest algorithm. The standard's examples
use `sha1:` in base32, and the field takes any labelled algorithm. The kit already hashes
every capture with SHA-256, so the export labels `sha256:` in hex, and a reader can check it
against the ledger.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**`bin/export-warc.mjs`: the corpus as one `.warc.gz`, a copy for archive tools.** The
corpus and its ledger remain the evidence.

- **Header:** one `warcinfo` record first, naming the software, the format and the
  project's topic.
- **Per capture in the ledger** (every `scrape` entry whose capture is on disk):
  - A `resource` record (E-01): `WARC-Target-URI` is the page, `WARC-Date` the fetch time,
    and the block is the capture's text after its front matter, as
    `text/markdown; charset=utf-8`.
  - A `metadata` record (`application/warc-fields`) referring to it with
    `WARC-Concurrent-To`: transport, completeness, the body hash the ledger recorded, and the
    ledger sequence number.
- **Digests and IDs:** a `WARC-Block-Digest` of `sha256:<hex>` on every record. Record IDs
  are `urn:uuid` values derived from the ledger entry, so the same corpus exports the same
  WARC.
- **Compression:** each record is its own GZIP member (E-01), written with the built-in
  `zlib`.
- **Output:** `--out <file>` (default `research-corpus.warc.gz`), written whole or not at
  all (`writeBytes`).

**Out of scope:** `response` records. The kit never stored the HTTP exchange, so claiming
one would be false. No WACZ packaging.

**First build step:** `lib/warc.mjs` with a record writer and a small reader for the tests.
Test the round trip on a fixture: mandatory fields, lengths, digests, gzip members. Then
validate one real export with warcio (E-02).

## Next steps

1. Build the exporter above, with its ADR, in the same commit.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=6f86d02cf52d6797 inputs=b0108e808731ec13 gate=pass -->
