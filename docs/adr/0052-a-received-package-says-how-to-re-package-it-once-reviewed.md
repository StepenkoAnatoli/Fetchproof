# ADR-0052 — A received package says how to re-package it once reviewed

- **Date:** 2026-09-27
- **Status:** accepted
- **Area:** the portable package, `README-FIRST.md`
- **Extends:** ADR-0032 (one artifact contract; authorization is derived, never requested)

## Context

A collected package's README-FIRST says building is permitted only when `manifest.json` says
`"state": "APPROVED_BRIEF"`. The manifest is written once, when the package is made. After the
reviewer does the three steps, the manifest they hold still says `HUMAN_REVIEW_REQUIRED`, and
nothing in the package said how to get one that reflects the review. The only route was
`artifact.mjs create` with five required identity flags, which the reviewer had to know existed
and copy out of the manifest by hand. Step 3 also said "run preflight" without a command, and it
never said the brief has to be drafted before it can be reviewed.

This was found on 2026-09-27 by following the package from collector run 36300088606, fetched
through the MCP server's `fetch_corpus`, to its end.

## Decision

README-FIRST in every package that is not yet approved prints:

- the preflight and brief commands, to run from `project/`;
- one line, run from the package folder, that re-packages the reviewed project under the
  identity the package arrived with:
  `node "$HOME/.agents/fetchproof/bin/artifact.mjs" create --root project --output reviewed.zip`
  followed by repository, ref, commit, workflow, run id and run attempt. The client ref is
  added when there is one. The API version and the two URLs are added only when they differ
  from what `create` would derive.

This passes identity only. The new manifest's state, review and gate come from the project, as
ADR-0032 requires, so the command cannot mark an unreviewed project approved. Commands use
ADR-0050's `$HOME` spelling, because the package is read on the operator's machine. README-FIRST
gives the cmd equivalent in one line.

## Rejected alternatives

- **A `--from <manifest.json>` flag on `create`.** It is shorter to type, but it adds a CLI
  input that reads a file the reviewer received from elsewhere. It also still needs the
  reader to learn that the command exists, and a flag cannot fix that.
- **Documenting the flags in the kit's README only.** The reviewer has the package, not the
  kit's README, and the values are in the package.
- **Leaving it to the agent that fetched the package.** A person with an ordinary unzip
  tool is one of the four consumers ADR-0032 names.

## Consequences

- A test unpacks a collected package and applies a review to `project/`. It then runs
  README-FIRST's preflight and re-package lines through Windows PowerShell 5.1 or sh, from a
  home folder with a space, and checks that the result is `APPROVED_BRIEF` with the original
  identity.
- A ref or client ref holding a `'` would break the printed line. Git allows it in a ref name,
  and `collect.yml` dispatches from the default branch.

## Trigger that would reopen this

The package carrying a signature (ADR-0032's named next version). Re-packaging would then need a
key, and this line would no longer be enough.
