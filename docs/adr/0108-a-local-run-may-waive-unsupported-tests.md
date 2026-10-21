# ADR-0108 — A local run may waive unsupported tests; CI never does

- **Date:** 2026-09-30
- **Status:** accepted
- **Area:** `bin/selftest.mjs`, `test/harness.mjs` (`findPython`)
- **Refines:** the UNSUP rule (a missing prerequisite is reported and blocks)

## Context

A prerequisite the host cannot provide - no Python, no git, no POSIX shell - is reported as
`UNSUP` with its reason and **blocks** the run. That rule exists because a test that returns
early on a missing prerequisite prints `ok` having asserted nothing.

A break-test on 2026-09-30 named the cost: a contributor without Python sees 18 unsupported
tests and exit 1 - what looks like a red build - on a change that has nothing to do with the
cross-language runners. The operator asked for an opt-in.

## Decision

- **`FETCHPROOF_ALLOW_UNSUP=1`** lets a run exit 0 when its only blockers are unsupported
  tests. A failed test is never waived.
- **It says so.** Each unsupported test is still listed, the last line reads
  `NOT a full pass: ... could not run on this host` instead of `all tests passed`, and the
  result file carries `unsupportedWaived: true`.
- **CI ignores it.** When `CI` is set (and not `false`), the opt-in has no effect and the run
  says `FETCHPROOF_ALLOW_UNSUP is ignored in CI`, so the merge check still blocks on a
  missing interpreter.
- **Tested on every platform** with a harness-only switch, `FETCHPROOF_TEST_NO_PYTHON=1`,
  which makes `findPython` report none. It lives in test code, not in the kit.

## Rejected alternatives

- **Make UNSUP non-blocking by default.** It would bring back the silent green the rule was
  written to stop.
- **Skip the Python tests when Python is missing.** Same false green, and nothing would say
  which checks did not run.
- **Honour the opt-in in CI too.** A runner image that lost Python would then pass the merge
  check without the cross-language agreement that CI exists to prove.
