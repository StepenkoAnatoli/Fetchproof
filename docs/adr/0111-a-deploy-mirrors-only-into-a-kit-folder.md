# ADR-0111 — A deploy mirrors only into a folder that holds a kit

- **Date:** 2026-10-01
- **Status:** accepted
- **Area:** `lib/installer.mjs` (`deploy`, `mirrorRefusal`), `bin/install.mjs`

## Context

A deploy mirrors: every file under `FETCHPROOF_HOME` that the kit does not ship is removed, so
a stale module from an earlier version cannot outlive an update. The mirror asked nothing of
the folder first. `FETCHPROOF_HOME` naming a folder of somebody's own files - a typo, a
parent folder, a shared tools directory - had those files deleted, and `install` reported them
as "retired" files. Confirmed 2026-10-01 (break-test PR #182: 3 of 4 files deleted; reproduced
here with `notes.txt` reported as "pruned 1 retired file(s)").

## Decision

- **`deploy` mirrors into a folder only when it is one of three things.** It holds no files,
  it holds `lib/core.mjs`, `bin/gate.mjs` and `bin/preflight.mjs` (files every kit version has
  shipped since the repository's first commit), or the install state records
  the kit as deployed there.
- **Any other folder is refused, and nothing in it is touched.** That covers the kit's own
  files and the skill roots too. The refusal names the folder and the first few of its files (it reads no further: a home
  directory holds millions), and the way out: point `FETCHPROOF_HOME` at an empty or new
  folder, or unset it.
- **`--dry-run` answers the same way.** A preview that said "would prune" over someone's files
  is what the operator would have read before running the real thing.
- **`bin/install.mjs` exits 2 on a refusal**, as it does for a write the filesystem refused.

## Rejected alternatives

- **A `--force` flag.** The only folders it would unlock are ones whose own files the mirror
  deletes. Nobody needs a kit mirrored into a folder of their own files, so the flag would exist
  to be typed by an agent clearing an error it did not read.
- **Merge instead of mirror in an unrecognised folder.** A deployed tree that holds files the kit
  does not ship is the drift `doctor` reports as orphaned, forever. The kit belongs in a folder
  of its own.
- **A marker file written by every deploy.** Deployments made before this ADR would lack it and
  be refused on their next update. The three files above are already a marker every version
  carries.
- **One marker file.** `lib/core.mjs` alone was the first version of this decision. A project of
  somebody's own with a `lib/core.mjs` was taken for a kit, and its other files would have been
  pruned; three kit file names together do not occur by accident.
