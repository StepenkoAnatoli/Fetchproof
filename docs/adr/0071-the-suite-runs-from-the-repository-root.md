# ADR-0071 — The suite runs from the repository root

- **Date:** 2026-09-27
- **Status:** accepted
- **Area:** `bin/selftest.mjs`

## Context

A break-test on 2026-09-27 ran `node <repo>/fetchproof/bin/selftest.mjs` from a folder
other than the repository root. It crashed at import with ENOENT:
`fi-validator-conformance.test.mjs` reads `fetchproof/schemas/fi-signoff-sidecar.schema.json`
relative to the cwd when the module loads. No test ran and no count was printed, so the
run looked like a broken kit rather than a cwd mistake. About ten test files use
cwd-relative `fetchproof/...` paths in the same way (the validator tests,
`r29-workbook-linkage`, `support-policy`, and `hardening`'s secret scan of `process.cwd()`).
CI always starts at the repository root, so it never saw this.

## Decision

`selftest.mjs` changes to the repository root (`path.resolve(KIT_ROOT, '..')`) before it
imports any test file. A relative `FETCHPROOF_RESULT_FILE` belongs to the caller, so it is
resolved against the folder the run started in before the move. The red-suite line prints
both folders. A test in `cli.test.mjs` runs a filtered suite from a temporary folder with a
relative result file and checks that the file lands in that folder.

## Rejected alternatives

- **Rewrite every cwd-relative test path to `KIT_ROOT`.** About ten files and twenty
  sites, and the next test written with a relative path would bring the crash back. Fixing
  the runner covers the tests that exist and the ones not yet written.

## Trigger that would reopen this

A test that must run from a cwd other than the repository root. It can `chdir` itself, or
spawn a child with its own `cwd`, as the CLI tests already do.
