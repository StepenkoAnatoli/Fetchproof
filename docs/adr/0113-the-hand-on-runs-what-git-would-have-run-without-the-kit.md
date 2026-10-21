# ADR-0113 — The hand-on runs what git would have run without the kit

- **Date:** 2026-10-01
- **Status:** accepted; supersedes the "global hooks directory" bullet of ADR-0112
- **Area:** `githooks/hand-on.sh`, `githooks/*`, `lib/installer.mjs`, `lib/machine.mjs`

## Context

ADR-0112 made every hook in the kit's folder hand on to the repository's own `.git/hooks`. It
left one case open, with a trigger: a machine that had its own global `core.hooksPath` before
the kit's install. git runs one hooks folder. Before the kit, that machine ran its global
folder's hooks, and not the repositories' own. The install replaced the setting, so that
folder's hooks stopped running. Its name was kept only in the install state, a JSON file the
sh hooks cannot read.

## Decision

- **The hand-on reproduces what git did before the kit.** The hooks folder the install replaced
  runs when there was one. Otherwise the repository's own hooks run, as ADR-0112 had it.
- **The install records the replaced folder in git's own config**, as
  `fetchproof.previousHooksPath` in the global scope, where the hooks read it with
  `git config --type=path`. It never records the kit's own folder: an install over an install
  would otherwise hand on to itself. Uninstall clears the record as it restores the setting.
- **One implementation.** The logic lives in `githooks/hand-on.sh`, which every hook sources.
  The 27 pass-on files are a few lines each, and `pre-commit` uses the same function.

## Consequences

- On a machine with a global hooks folder, a repository's own `.git/hooks` do not run, exactly
  as before the kit. That is git's rule, and the hand-on keeps it.
- An install made before this ADR has no record. Running `install-hooks` again writes it,
  from the install state.

## Rejected alternatives

- **Run both the replaced folder and the repository's own hooks.** That is more than git ever
  ran, and a repository hook that was dormant on that machine would start running unasked.
- **Parse the JSON install state from sh.** A JSON reader in POSIX sh is code to get wrong, and
  git's config is already a store the hooks can read.
