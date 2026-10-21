# ADR-0078 — The Python floor is 3.11, and CI tests exactly the floor

- **Date:** 2026-09-28
- **Status:** accepted
- **Area:** `lib/runtime.mjs` (`REQUIRED_PYTHON`), `README.md`, `fetchproof/README.md`,
  `.github/workflows/offline-suite.yml` (`python-version`), `test/support-policy.test.mjs`

## Context

The kit promised Python 3.12+ for its three cross-language conformance runners, and CI
pinned 3.12. An outside break-test (2026-09-28) noted that the runners passed on 3.11, so
the declared floor was never tested as the floor. The policy test only asked that CI pin
*some* 3.1x version, so the README, the code and CI could drift apart.

Measured on 2026-09-28: the CI cross-language step and every Python-dependent test (58)
pass on Python 3.10.20, 3.11.15, 3.12.3 and 3.13.12. All three runners agree with Node,
vector for vector, on each version. The runners use no syntax newer than 3.10.

## Decision

- The floor is **3.11**: `REQUIRED_PYTHON`, both READMEs, and both `python-version` pins
  in CI. The fix messages in `checkPython` are built from the constant.
- A test requires the code, both READMEs and every CI pin to name the same number. CI
  therefore always runs the oldest Python the kit promises.

## Rejected alternatives

- **Keep 3.12.** It is stricter than the code needs and was never tested as binding.
  Debian 12 ships 3.11.
- **3.10.** It works today, but PEP 619 ends its support in October 2026. A floor that
  becomes unmaintained within weeks would need raising again straight away.
- **Test every version in a CI matrix.** Four more jobs for runners with no
  version-specific code. The floor pin catches the likely failure, which is new syntax
  creeping in. Newer versions were checked by hand for this decision.

## Consequences

- CI no longer runs 3.12 or 3.13. Their agreement was measured once, here, not on every
  change.

## Trigger that would reopen this

Python 3.11's end of life (PEP 664: October 2027), or a runner needing a 3.12+ feature.
