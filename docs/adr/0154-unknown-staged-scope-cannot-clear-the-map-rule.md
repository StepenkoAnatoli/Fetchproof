# ADR-0154 — Unknown staged scope cannot clear the map rule

- **Date:** 2026-10-08
- **Status:** accepted
- **Area:** architecture-map verdict, commit CLI, pre-commit acquisition
- **Refines:** ADR-0008's same-commit map rule and ADR-0020's staged-list boundary.
- **Supersedes:** the 2026-10-01 tested fallback that let a preflight-green project
  commit when Git could not list its staged paths. The older decisions stay intact.

## Context

`architectureMapBreach(root, null)` returned no breach. An unknown staged set was
therefore enough to clear the same-commit rule when research passed, even though
the gate could not establish whether a declared code path changed or whether its
map was staged. This allowance was explicit in the hook regression, rather than
an undocumented accident. It does not meet the rule ADR-0008 says the gate checks.

The hook also read the list twice: a successful status probe preceded a pipeline
whose actual second Git read had no checked status. An offline fixture executing
the existing shell branch made the first read succeed and the second fail; the
gate received an empty list and the branch returned success. Checking a probe is
not checking the read whose data the verdict receives.

## Decision

1. An unknown staged set raises the existing `architecture-map-same-commit` breach
   after green preflight. It is an ordinary block, exit 1, including on a machine
   whose internal-error posture is fail-open. Its detail names the unreadable list
   and its fix asks the operator to check Git. Known empty `[]` still owes no map;
   known paths keep the declared-code and same-commit rules they already had.
2. The commit CLI, when neither existing staged option was supplied, lazily reads
   one actual `git diff --cached --name-only --no-renames -z` through the bounded
   Node capture helper. Exit-0 complete output becomes the list; nonzero exit,
   output-buffer failure or malformed NUL output remains unknown. Zero bytes from
   a successful read is genuinely empty. Names retain spaces and newlines.
3. The pre-commit hook delegates acquisition to that CLI invocation. It no longer
   probes Git or starts an unchecked second pipeline. Arguments remain constant
   in length as the number of staged paths grows. Existing explicit stdin and
   repeated `--staged` inputs retain their meaning, and direct library arrays/null
   retain theirs. This adds no command, flag, config key or verdict field.
4. The private acquisition callback runs only after the ungated and `GATE_OFF`
   returns, and only for commits. Thrown or malformed callback answers become
   unknown scope rather than an internal exception. The edit gate does not read
   a staged set. Existing phase-1 allowances, integrity-before-scope checks,
   materialization refusals and deliberate overrides keep their ordering.

## Limits

The map rule proves that the map was staged with known code changes, not that its
prose is current. One checked list read does not make list acquisition and corpus
index materialization an atomic snapshot. The capture remains bounded at the
existing 64 MiB; exceeding that bound refuses scope rather than guessing a list.
No new runtime observation, retention policy or exact count of unread paths is
introduced.

## Alternatives considered

- **Retain the preflight-green unknown-list allowance.** Rejected: research
  passing cannot establish the staged paths the independent map rule must check.
- **Keep the successful probe and assume its second read also succeeds.**
  Rejected by the executed success-then-failure fixture; the unchecked second
  process is still the one supplying the data.
- **Substitute tracked paths (`git ls-files`) for staged changes.** Rejected:
  tracking a map does not show it was staged with this commit, and tracking code
  does not show it changed in this commit.
- **Copy the list into shell arguments or a shell variable.** Rejected: argv is
  bounded, and shell variables do not preserve NUL separators. The Node capture
  already has explicit process status and a bounded output policy, so a second
  temporary-file lifecycle and shell cleanup protocol are unnecessary here.
- **Treat acquisition failure as an internal error.** Rejected: fail-open posture
  may allow internal error exit 2. The map rule has an ordinary refusal shape and
  a deliberate override already.
