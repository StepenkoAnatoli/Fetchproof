# ADR-0197 — A ZIP entry name another platform reads as a different name is refused

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/artifact-zip.mjs` (`checkEntryName`, the new `pathKey`,
  `inspectEntries`, `openZip`'s new `directories`), `fetchproof/lib/artifact-validator.mjs` (the
  never-packaged paths), `fetchproof/lib/artifact.mjs` (`collectProjectFiles`)
- **Prompted by:** the independent audit of `532c696` (Codex, 2026-11-04), finding F03 (High)
- **Extends:** ADR-0032 (names are refused, not translated, and every structural fault is decided
  from the central directory before anything is inflated)
- **Freeze (ADR-0117):** a bug fix. `checkEntryName` already holds that a name meaning different
  things on two platforms is not a name - its backslash rule says so - and this applies that rule
  to the shapes it missed. No new error code, flag, check name or file format.

## Context

The reader judged an entry by its spelling; an extractor writes it by its meaning, and the two
differed:

- `project/research//BRIEF.md` passed every name rule. `path.join`, which `materializeProject`
  uses, and Python's `zipfile` both drop the empty segment, so it is `research/BRIEF.md`. A package
  carrying an unreviewed copy there beside the reviewed brief validated PASS with
  `buildAuthorized: true`, and whichever copy an extractor wrote last was the brief on disk.
- `project/research/gate_off` and `project/research//GATE_OFF` passed the never-packaged check,
  which asked `zip.has('project/research/GATE_OFF')` by exact spelling. On Windows and macOS the
  first is the gate override; on every platform the second is.
- `docs/readme.md.` (Windows drops a trailing dot or space), `docs/report.md:hidden` (an NTFS
  stream of `report.md`), `docs/CON` (a device), and a file `docs/a` beside `docs/A/child.md` (a
  file-folder contradiction where case folds) each passed and meant another file, or none, on
  Windows.
- Two Unicode forms of one name - an accented letter composed or decomposed - are two files on
  NTFS and ext4 and one on APFS, and the case-collision check compared `toLowerCase()` alone.
- Python's `zipfile` on Windows writes `_` for each of `< > : " | ? *`, so `research/GATE?OFF`
  extracts as `research/GATE_OFF`. And a folder named `GATE_OFF` answers the gate's `exists()` as
  a file does, while `openZip` listed files only.

Measured with the audit's probe packages: under `532c696` eight of the nine alias probes PASS with
`buildAuthorized: true` and one is BLOCKED; under this decision all nine FAIL before anything is
inflated, and the audit's baseline package still PASSes.

## Decision

1. **`checkEntryName` refuses five more shapes, as `ZIP-PATH`,** after its existing rules: an empty
   segment (`a//b`); a character Windows does not allow in a name - `< > : " | ? *` and the control
   characters U+0001 to U+001F; a segment ending in a dot or a space; a segment that is a Windows
   device name - CON, PRN, AUX, NUL, COM0 to COM9, LPT0 to LPT9, and COM or LPT with a superscript
   1 to 3 - with any extension, in any case; and a segment shaped like an 8.3 short name, one to six
   characters with no dot or tilde, a tilde and digits, and an optional extension of up to three
   characters (`EVIDEN~1.MD`, `PROGRA~1`). The producer asks the same function, so it refuses these
   names before it writes (`UNPACKAGEABLE_NAME`).
2. **One identity for a name, `pathKey`: NFC, then upper-cased, then lower-cased.** It is wider than
   any one filesystem on purpose: NTFS folds case but not Unicode form, APFS folds both, and
   upper-casing first also folds the long s and the Kelvin sign onto S and K, as Unicode case folding
   does. Duplicates, case collisions (`ZIP-CASE-COLLISION`, now "differ only in case or Unicode
   form"), file-folder collisions (`ZIP-PATH-COLLISION`, now also when the two spellings differ) and
   the never-packaged paths are compared by it, never by spelling. The producer's collision refusal
   uses it too, and also refuses a file that is, spelled another way, the folder another file sits
   in.
3. **The never-packaged paths are matched as a file, as a folder entry and as a folder prefix.**
   `openZip` reports directory entries as `directories`, and a file or directory whose key is a
   never-packaged path's key, or begins with that key and a `/`, is refused with the existing
   `FILE-UNDECLARED` "must never be packaged", naming the path it stands for.

## Rejected alternatives

- **Translate the name** (collapse `//`, strip the trailing dot, write `_` for `?`) and judge the
  result. ADR-0032 refuses rather than translates, for the backslash's reason: the manifest declares
  the name as stored, and a package whose names mean something other than they say is not faithful.
  A translation would also have to match every extractor's, and they differ.
- **Fold exactly as each filesystem does** (NTFS's upcase table, APFS's normalization) and refuse a
  pair only when a real filesystem would merge it. The validator does not know where the package
  will be extracted, a table copied from one filesystem version goes stale, and the costs are not
  symmetric: folding too wide refuses an exotic pair of names a project can rename, folding too
  narrow lets one entry land on another.
- **Refuse only what the validating host's filesystem would alias.** A package travels, and a
  verdict that depends on the machine that gave it is one a builder elsewhere cannot rely on.
- **Accept 8.3-shaped names, since neither volume of the machine this was written on makes short
  names.** A volume that makes them opens `EVIDEN~1.MD` as the file already holding that short name.
  The cost: a project file named like `notes~1.md` must be renamed before it can be packaged, and
  the producer says so by name.
- **Tighten the manifest schema's `path` pattern to match.** The ZIP names are judged first, and a
  structural problem stops validation before the manifest is parsed, so a second copy of the rules
  there would add a place for them to drift apart and refuse nothing more. The schema is unchanged.

## Consequences

- A project holding a file with one of these names, or two names one key apart, cannot be packaged
  until the file is renamed; the refusal names the file and the reason. Checked on 2026-11-06: none
  of the 1845 files tracked in this repository has such a name, and no two of them share a key.
- A gate-input path spelled only in another case (`project/Research/brief.md` with no
  `research/BRIEF.md`) is still judged by the validating host's filesystem: the derivation writes
  the package out and runs the gate there, so it finds the brief on Windows and macOS and not on
  Linux. The verdict is consistent on one host and can differ across hosts; not changed here.
- The 8.3 refusal is tested by name. That such a name opens another file is expected, not
  reproduced: both volumes of the machine this was written on have short-name creation off.
- Not taken here: writing the materialized copy with exclusive create, so that an alias these rules
  miss fails instead of overwriting. Defence in depth, left for a follow-up.

## Trigger to revisit

- A real project's package is refused for a name no filesystem in use would alias - an 8.3 shape,
  or a fold too wide: reconsider the shape list or narrow the key, with the case in hand.
- A filesystem or extractor in use is found to alias a name these rules accept: add the shape, and
  the probe that shows it.
