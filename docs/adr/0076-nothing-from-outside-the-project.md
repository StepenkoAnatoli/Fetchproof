# ADR-0076 — Nothing from outside the project is read as a capture or packaged

- **Date:** 2026-09-28
- **Status:** accepted
- **Area:** `lib/core.mjs` (`realInside`), `lib/artifact.mjs` (`collectProjectFiles`,
  the ledger), `lib/corpus.mjs` (`readCaptures`), `lib/checks.mjs` (corpus-shape)

## Context

git stores symlinks, so a cloned corpus can carry `research/raw/x.md` pointing at
`~/.ssh/id_rsa`. An outside break-test (2026-09-28) reported that `readCaptures` followed
such a link. Reproduced on `main`, the worse path was packaging: `createArtifact` followed
every link under `research/` and `docs/`, including a linked directory, and copied the
outside file's bytes into the zip, which a workflow then uploads. The gate did not stop
it. The link read as a capture with no url, which was only a warning.

`isInside` compares spellings, so it cannot see this. `lib/audit.mjs` already resolved real
paths for the audit bundle, but nothing else did.

## Decision

- `realInside(root, abs)` in `lib/core.mjs` resolves every symlink on both sides. A path
  that cannot be resolved counts as not inside.
- **Packaging refuses** when any file it would include, the ledger included, or a top-level
  `research/` or `docs/` lands outside the project. The error names the paths
  (`OUTSIDE_PROJECT`), and the CLI reports "could not package" with exit 3.
- **`readCaptures` does not read** such a file. It records a `capture-outside` problem,
  which `corpus-shape` treats as blocking.

## Rejected alternatives

- **Skip the link and package the rest.** The package would silently lack a file the
  project has. Refusing tells the operator exactly what to remove.
- **Refuse every symlink, wherever it points.** A link that stays inside the project
  leaks nothing. Resolving real paths blocks exactly the escape.
- **The outside break-test's own fix** (`arena/01a0e65a-fetchproof`): it hardened
  `readCaptures` but not packaging, which still copied all three outside files in the
  reproduction.

## Consequences

- A project whose `research/raw/` is itself a link to another disk now fails the gate and
  cannot be packaged. The corpus has to live inside the project.

## Trigger that would reopen this

A supported layout that keeps the corpus outside the project directory.
