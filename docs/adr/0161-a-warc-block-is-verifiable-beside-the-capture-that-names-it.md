# ADR-0161 — The WARC export names the block's own hash, and leaves out an entry it cannot date

- **Date:** 2026-10-17
- **Status:** accepted
- **Area:** `research-kit/lib/warc.mjs`, `research-kit/bin/export-warc.mjs` (ADR-0090). A fix
  to the export's own integrity, not a new capability: it adds no command, flag, transport,
  provider, configuration key or check.
- **Freeze:** lifts the feature freeze (ADR-0117) for the one `metadata` field
  `body-sha256`, by the precedent of ADR-0140, which lifted it for the `<capture>.source.html`
  file and two ledger fields. Nothing else is new: the exit code and the re-read are fixes to
  an existing command's result, not a new command.
- **Refines:** ADR-0090 (the corpus as WARC 1.1). Its decision stands.

## Context

The 2026-10-03 gap audit (`docs/review-2026-10-03-gap-audit.md`, rank 7, VERIFIED) found
these defects in the export ADR-0090 introduced; the 2026-10-04 gap audit
(`docs/review-2026-10-04-gap-audit.md`, rank 15, which re-verified rank 7) restated them and
added one:

- The `metadata` record's `capture-sha256` is the hash of the **whole capture file** — the
  value the ledger holds — but the `resource` record's block is the body **after** the
  front matter, so a consumer cannot check a block against the field that names its file.
- A ledger `scrape` entry with no `at` writes an empty `WARC-Date`. WARC 1.1 makes
  `WARC-Date` mandatory; the clause is captured in the extraction audit's copy of the
  specification (`docs/decisions/2026-10-04-gap-audit-extraction/research/raw/`), which the
  audit cites as C:E-08.
- A capture left out is named on stdout, but the command exits 0, so a caller cannot tell a
  partial export from a whole one.
- The file written is never read back: the bytes split in memory are the ones in hand, not
  the bytes on disk, so a write that landed corrupted is reported as an archive.

## Decision

The `metadata` record gains `body-sha256`, the hash of the block the `resource` record
carries, beside `capture-sha256`, the whole file the ledger hashed. A ledger `scrape` entry
the export cannot date is left out and named like any other entry it cannot use, so no
record carries an empty mandatory `WARC-Date`. The command exits 2 (`INCOMPLETE`) when
anything was left out and 0 otherwise, and re-reads the file it wrote and splits it again
before it reports success.

The exit code is 2, not 1: `README.md` maps `PASS` to 0, `FAIL`/`REOPEN` to 1 and
`INCOMPLETE` to 2, and a partial export is INCOMPLETE — the command did what it could and
says so with its own code, distinct from both a whole export and a failed one. The first
implementation of this ADR exited 1 (the 2026-10-03 audit's wording); the re-verification
says 2, and the kit's own mapping agrees, so 2 stands.

## Rejected alternatives

- **Write `capture-sha256` over the block it accompanies.** Then the field no longer equals
  the hash the ledger holds, so it stops tying the archive to the evidence — the one thing it
  is for. Two hashes, each naming its own object, keep both checks.
- **Keep writing the empty `WARC-Date` and warn.** `WARC-Date` is mandatory, so the record is
  not conformant whatever is printed beside it; a capture that cannot be dated is a corpus
  defect the caller should be able to act on, not a warning next to a written file.
- **Abort the whole export on an undated entry.** The export already names and continues past
  a capture it cannot use (missing, edited, outside the project). An undated entry is the same
  kind of per-entry defect; a partial archive is more useful than none, with exit 2 saying it
  is partial.
- **Exit 1 for a partial export.** `README.md` reserves 1 for a `FAIL`/`REOPEN` verdict and 2
  for `INCOMPLETE`; the export produced something, incompletely, which is INCOMPLETE. Exit 1
  was the 2026-10-03 audit's first wording and was superseded by the re-verification.
- **Trust the in-memory bytes and skip the re-read.** `writeBytes` writes a scratch file and
  renames it, so the window is small, but the on-disk file is the product; splitting the bytes
  in hand says nothing about the bytes that landed.

## Consequences

`body-sha256` is an extension field in the `metadata` record's `application/warc-fields`
block. WARC 1.1 says a reader ignores a field name it does not recognize, so an archive tool
that does not know it is unaffected. A consumer can now tie a block to the ledger entry
(`body-sha256` beside `ledger-seq` and `capture-sha256`) and check it against the resource
record's own `WARC-Block-Digest`. The freeze lift is for `body-sha256` alone: it is not
permission to add further fields to the export without their own ADR.
