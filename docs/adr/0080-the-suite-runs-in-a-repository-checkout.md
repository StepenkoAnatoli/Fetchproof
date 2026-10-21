# ADR-0080 — The suite runs in a repository checkout, and refuses a deployed kit

- **Date:** 2026-09-28
- **Status:** accepted
- **Area:** `bin/selftest.mjs`

## Context

`install.mjs` deploys a full mirror of `fetchproof/` to `~/.agents/fetchproof`, and
that mirror includes `test/`. The suite changes directory to the folder above the kit
(ADR-0071), which in a checkout is the repository root. Many tests read what only the
repository holds there: `.github/workflows`, `docs/adr`, `AGENTS.md`, this repository's
own corpus.

An outside break-test (2026-09-28) ran the suite from a deployed kit. Reproduced on
`main`: 1046 passed and 80 failed on a healthy install. That output looks like a broken
kit, and `doctor` is the check that actually verifies a deployment.

## Decision

Before running any test, `selftest` checks for `.github/workflows`, `docs/adr` and
`AGENTS.md` beside `fetchproof/`. If any is missing, it names them, says the suite runs
in a clone of the repository, prints the `doctor` command for a deployed kit, and exits 2.
Exit 2 marks misuse, not a red suite.

## Rejected alternatives

- **Skip each repository-fixture test when its file is absent.** In a checkout, a fixture
  that went missing would then pass silently. The suite reports a missing file as a
  failure on purpose.
- **Leave `test/` out of the deploy.** `deploy` is an exact mirror, and `deployedDrift`
  relies on that. The suite would still start and report "no test files", which says less
  than naming the checkout it needs.
- **Make every test portable to a deployed kit.** That is 80 tests' worth of rework to
  support a use nobody asked for. `doctor` already verifies a deployment.

## Consequences

- A copy of `fetchproof/` alone, outside a repository, cannot run the suite. It never
  could run it green.
- The three anchors are what a checkout has and a deployment does not. A repository that
  drops one of them will need this list changed.

## Trigger that would reopen this

A reason to run the suite from a deployed kit: for example, verifying an install
through the suite instead of `doctor`.
