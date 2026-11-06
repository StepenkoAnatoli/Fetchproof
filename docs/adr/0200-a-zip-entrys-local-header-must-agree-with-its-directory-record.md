# ADR-0200 — A ZIP entry's local header must agree with its directory record, and its bytes with their CRC-32

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/artifact-zip.mjs` (the new `inspectLocalHeaders`, `readEntry`, `openZip`,
  `readCentralDirectory`'s `nameBytes`), `fetchproof/lib/artifact-validator.mjs` (the reads of
  `manifest.json` and `manifest.sha256`)
- **Prompted by:** the independent audit of `532c696` (Codex, 2026-11-04), finding F05 (Medium,
  confirmed; the audit's assertions F05a and F05b)
- **Extends:** ADR-0032 (every structural fault is decided before anything is inflated), ADR-0197
- **Freeze (ADR-0117):** a bug fix. The reader already refused a local header missing where the
  directory says it is, and a body whose length is not the one the directory declares; this extends
  that to the other fields an extractor takes from a local header, and to the CRC-32. No new error
  code, flag, check or file format.

## Context

`artifact-zip.mjs` decided every structural refusal from the central directory and read a body at
the offset its local header gave, taking the name, the method, the sizes and the CRC-32 from the
directory. It never compared the local header's own fields with them, and never computed a body's
CRC-32. The audit built two variants of an approved package: one whose local header names
`README-ALTER.md` where the directory lists `README-FIRST.md` (a name of the same length, so every
offset still holds), and one whose two CRC-32 fields for `README-FIRST.md` are zeroed. Both
validated PASS and stayed `buildAuthorized: true`. Python's `zipfile.testzip()` names
`README-FIRST.md` as bad in each, and nothing in the baseline.

The manifest's SHA-256s still matched the bytes, so this is not an integrity bypass: it is a package
this validator approves that an ordinary extractor refuses, or reads as another package. A streaming
extractor reads the local headers in order and never the directory, so it writes `README-ALTER.md`.

A `ZipError` thrown while reading `manifest.json` or `manifest.sha256` was not caught where they are
read, so it reached the validator's outer catch and was reported BLOCKED, "validation could not
complete", where the same fault in a payload file is FAIL `ZIP-READ`. With the CRC-32 checked on
every read, a manifest with a wrong one would have been that case.

## Decision

1. **`inspectLocalHeaders(buf, entries)`** runs in `openZip` beside `inspectEntries`, before anything
   is inflated, for every entry, directories included. A local header missing where the directory
   says it is, or running past the end of the file, is a problem; so is a body that, at the
   directory's compressed size, would run past the end of the file, named as that before any field
   is compared, because the directory's own size is then the fault (the truncated workbook of #318,
   which `readEntry` refuses in the same words). Otherwise the local header must
   agree with the directory on what an extractor takes from it: the name, as stored bytes; the
   compression method; the encryption bit (0); the UTF-8 name bit (11); and, when the local
   header's bit 3 is clear, the CRC-32, the compressed size and the uncompressed size. One `ZIP-READ`
   problem per entry names every field that disagrees, with both values. A local header whose bit 3
   is clear and whose compressed or uncompressed size is the ZIP64 sentinel (`0xFFFFFFFF`: the size
   is in a ZIP64 extra field) is refused as ZIP64, in the words the directory's ZIP64 sizes are
   refused in, and not compared: the reader does not implement ZIP64, and the two headers may agree
   (Python's `zipfile` writes such a header with `force_zip64`; found by the review of #442).
2. **Bit 3 is the data-descriptor convention, respected.** A writer that does not know the CRC-32 and
   sizes when it writes the local header sets bit 3, writes zeros there, and puts the values in a
   data descriptor after the body (PKWARE's APPNOTE, general-purpose bit 3). With bit 3 set in the local header those
   three fields are not compared; the directory's are the ones read, as before. The descriptor is
   not read.
3. **`readEntry` checks the CRC-32 of each body** after its length, against the directory's, and
   refuses a body that does not match with `ZIP-READ`. It uses `zlib.crc32` where Node has it
   (22.2.0 and later) and the same sum from a 256-entry table where it does not: the kit's runtime
   checks (`checkNode`, the doctor's `nodeLine`) admit Node 22.0 and 22.1, which lack it, and every
   read there would throw (found by the review of #442). The manifest's SHA-256s stay the integrity
   check; the CRC-32 is format conformance.
4. **The validator reads `manifest.json` and `manifest.sha256` under a catch**: a `ZipError` there is
   FAIL with its code, as in the payload loop. Any other error still reaches the outer catch.
5. **The code is `ZIP-READ`**, the one the reader already gives a container that does not read as
   written (a missing local header, a body of the wrong length).

## Rejected alternatives

- **Every local field compared with the directory's** - versions, timestamps, extra fields, every
  flag bit. Writers legitimately differ on some of these between the two headers - Info-ZIP's
  extended-timestamp extra field is longer in the local header than in the directory - and none of
  them changes what an extractor writes. The audit warns against it; it would refuse archives ordinary tools read.
- **The local CRC-32 and sizes compared whatever bit 3 says, or bit 3 required to agree.** A
  streaming writer's archive has zeros in those local fields by design; comparing them refuses every
  such archive. With bit 3 clear in the local header, a streaming extractor reads those fields, so
  they are compared then.
- **Reading the data descriptor and comparing it with the directory.** It holds the same three values
  the directory does, and the body is already checked against the directory's CRC-32; its signature
  is optional and its ZIP64 form is wider, so locating it is a parser of its own. Python's `zipfile`
  does not read it either. Not taken; a descriptor that disagrees with the directory is not refused.
- **No CRC-32, because the manifest's SHA-256 covers every payload file.** The SHA-256 says the
  bytes are the ones the manifest names; an extractor never reads the manifest, checks the CRC-32,
  and refuses the entry. Consumability is what the audit found broken, and only the CRC-32 decides
  it. `manifest.sha256` itself is covered by no hash.
- **The CRC-32 computed in the container pass, before the validator's reads.** It needs the inflated
  bytes: computing it up front inflates every entry twice or holds them all, and moves inflation
  ahead of the end of the structural pass. Checked where the body is read, it is one linear pass
  over bytes already in memory.
- **Names compared as decoded strings.** Two different invalid UTF-8 sequences decode to the same
  replacement character, and an extractor writes the bytes.
- **New error codes** (a header-mismatch code, a CRC code). New codes under the freeze for faults in
  the class `ZIP-READ` already names, and every consumer that maps codes would need a case.
- **The writer's `crc32` (`archive.mjs`) imported into the reader.** The module header keeps the
  writer and the reader apart; the reader carries its own table, used only where zlib has no `crc32`.
- **`zlib.crc32` alone, with the floor `checkNode` and the doctor enforce raised to 22.2.** The
  documented floor is 22.22.1+ or 24+, and neither check enforces it (both admit 22.0); which Node
  the kit refuses is a support decision of its own, not one for a ZIP reader to make in passing. Not
  taken here; the gap between the documented and the enforced floor is a follow-up.
- **A local header's ZIP64 extra field read, and its sizes compared with the directory's.** That
  reads part of ZIP64 in the local header while the directory's ZIP64 is refused outright: the
  half-read this module refuses. The kit's own writer never writes ZIP64.
- **A wrapper whose package does not read thrown out of `fetchCorpus`, under a code of its own.** A
  ZIP-READ thrown from there went past the validator once (break-test, 2026-10-01), and a new code is a
  new word every caller must learn; as a FAIL with the reader's code, `collect-remote` exits 1 for it
  as for any package that does not validate, and the MCP server reports it the same way.
- **The ADR's sentence corrected, the message left** (the review's lesser fix). The operator would still
  be told, after a paid run, to regenerate a package when downloading it again is the cheap first step.

## Consequences

- A package whose two headers disagree on those fields, or whose body does not match its CRC-32, is
  FAIL `ZIP-READ` and `buildAuthorized: false`. A manifest or digest that does not read is FAIL, not
  BLOCKED.
- The same holds for every ZIP this module opens: the GitHub artifact wrapper and `fi-validate`'s
  workbook (`WB-PACKAGE-UNTRUSTED`). A wrapper whose package does not read is still written and judged
  as it came, and `fetchCorpus` reports why: the reader's `ZIP-READ`, naming the entry, with a remedy to
  download again with `--run-id`, in place of the `MANIFEST-MISSING` the validator gives the wrapper,
  whose remedy is to regenerate the package. This sentence first said the validator "then names the
  fault", which was untrue, and a CRC-32 failure was newly among the reasons (review of #442,
  2026-11-06).
- Stricter than Python's `zipfile` on purpose: it checks a local header's signature and compares its
  name with the directory's, and nothing else. A local method, encryption bit, UTF-8 bit, CRC-32 or size that disagrees is read
  by a streaming extractor, so it is refused here although Python reads the entry.
- A local header with ZIP64 sizes and bit 3 clear is refused; before this change such an entry was
  read, from the directory's sizes. A package or workbook re-zipped by a writer that forces ZIP64 on
  small entries no longer validates.
- The kit's own writer (`archive.mjs`) writes the same flags, CRC-32 and sizes in both headers, so a
  package it produced still validates.
- Cost: one local header read per entry, and one CRC-32 pass per body read (native where Node has it).
- Not covered, named so it is not taken as fixed: the data descriptor is not read.

## Trigger to revisit

- A real archive from a writer in use - a CI artifact, a workbook, a package from another tool - is
  refused for a disagreement no extractor acts on: narrow the agreed fields, with the archive in hand.
- An extractor in use is found to act on a field not compared here (the data descriptor, a flag bit):
  add it, with the probe that shows it.
