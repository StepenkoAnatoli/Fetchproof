# Build report: break-test pass 5 (2026-10-04)

Fifth adversarial pass over the build and test suite, on `main` at d00be07 (after PR #244), with the
break-test procedure revised on 2026-10-03: controls before any failure counts, baselines as failure
sets, external facts through Fetchproof. Passes 1-4: `build-report-2026-10-04-break-test.md` and
its predecessors.

## Overview

- **Stack.** Node (22+), zero npm dependencies (no `package.json` anywhere in the tree), three
  conformance runners duplicated in Python (stdlib only). CI: `.github/workflows/offline-suite.yml`
  on ubuntu-latest, ubuntu-26.04 and windows-latest with Node 22, plus Node 24 and 26 legs and a
  `git archive` tree leg; seven required jobs.
- **Gate** (from the workflow): `node fetchproof/bin/selftest.mjs`; `preflight.mjs`;
  `examples/release-evidence/run-example.mjs`; the three node/python conformance pairs agreeing per
  vector; `git diff --quiet -- fetchproof/conformance fetchproof/schemas`; `timeline.mjs` and
  `export-warc.mjs` regenerating to committed bytes; `git status --porcelain` empty. Duration about
  140 s for the suite alone.
- **Environment.** Linux 6.18 container, root (uid 0), 4 CPUs, Node v22.22.2 on PATH with
  /opt/node20 and /opt/node21 also present, Python 3.11.15, git 2.43.0, `unshare -rn` available,
  Chromium present. No Windows or macOS here. Root makes permission probes void.
- **Baseline.** Three full runs in the worktree, one at a time: 1603 passed, 0 failed, 0 unsupported
  each (141 s, 139 s, 142 s). Failure set: empty in all three (taken from the FAIL lines; see F1).
  Every other gate step green once.
- **Isolation.** Worktree `../Fetchproof-break-test` on branch `break-test/2026-10-04-pass5`; the
  fix commit was made there through the commit gate and cherry-picked to `main-axuse3` for the PR.
  Throwaway clones under the session scratch folder.
- **Fetchproof.** No finding's cause rests on an external fact, so no nested research project was
  made this pass. `doctor` was READY at the start (kit 0.9.3).

## Findings

**[F1] The suite's result file records a failure count, not the failing tests** (Low, Likely)
Repro: `FETCHPROOF_RESULT_FILE=r.json node fetchproof/bin/selftest.mjs quotes; node -e 'console.log(Object.keys(require("./r.json")))'`
Observed: `[ 'blocking', 'exit', 'failures', 'files', 'node', 'passed', 'platform', 'seconds', 'unsupported', 'unsupportedWaived' ]` - no names.
Cause: `runPending` counted failures and printed their labels only to the log; `writeResultFile`
wrote what it was given. A count cannot show one test starting to fail while another starts to
pass, which is the comparison this procedure's baseline makes and what CI's summary would need to
make.
Action: Fixed - `runPending` returns `failed: [labels]` and the result file carries it.
Verification: harness and cli groups red on the new assertions, green after; full gate green in
the commit's gate, failure set empty as at baseline.

## Applied fixes

| Commit | Finding | Files |
|---|---|---|
| 183fd64 | F1 | fetchproof/test/harness.mjs, fetchproof/bin/selftest.mjs, fetchproof/test/harness.test.mjs, fetchproof/test/cli.test.mjs, docs/ARCHITECTURE.md, CHANGELOG.md |

## Rejected fixes

None attempted beyond F1.

## Remaining risks

- None reproduced. Not a risk but context: the container's temp folder holds 189,509 stale
  `fetchproof-*` scratch folders, all dated before the cleanup fix of 2026-09-28 or from one run
  killed on 2026-10-03 (a SIGKILL skips every exit handler); none of today's runs left one.

## Probe defects

None: no probe produced a failure, so no control was needed. The network-namespace probe brought
loopback up before running (recipe `lo-up.py`) and confirmed the namespace was offline
(`fetch('https://registry.npmjs.org/')` rejected).

## Probes run

| # | Probe | Command (from the repository root) | Result |
|---|---|---|---|
| 1 | Clean checkout | `git clone --no-local file://<repo> clone && git -C clone checkout d00be07 && cd clone && node fetchproof/bin/selftest.mjs` | 1603 passed, 0 failed, 135.6 s |
| 2 | Lockfile and install | not applicable: no `package.json`, no lockfile, Python stdlib only | - |
| 3 | Generated code | `node fetchproof/bin/timeline.mjs && node fetchproof/bin/export-warc.mjs && git status --porcelain` | tree clean; conformance/ and schemas/ unchanged |
| 4 | Toolchain floor | `/opt/node20/bin/node fetchproof/bin/selftest.mjs quotes` and node 21 | exit 2 both: "selftest runs on Node 22 or newer: node 20.20.2 ... install Node 22+" - the floor is enforced before any test runs |
| 5 | Emptied environment | `env -i PATH="$PATH" HOME="$HOME" node fetchproof/bin/selftest.mjs` | 1603 passed, 0 failed |
| 6 | Each file alone | `for f in fetchproof/test/*.test.mjs; do node fetchproof/bin/selftest.mjs "$(basename $f .test.mjs)"; done` | 76 files, every run exit 0 (the runner has no shuffle flag; order within a file is the file's own) |
| 7 | Flakiness | `node fetchproof/bin/selftest.mjs <file>` x10 for browser-guard, browser-transport, http-linear, gate, harness | 50 of 50 green |
| 8a | Timezone | `TZ=Pacific/Kiritimati node fetchproof/bin/selftest.mjs` | 1603 passed, 0 failed |
| 8b | Locale | `LANG=C LC_ALL=C node fetchproof/bin/selftest.mjs` | 1603 passed, 0 failed |
| 8c | CRLF checkout | `git clone --no-local -c core.autocrlf=true file://<repo> crlf` then `git ls-files --eol`, `preflight.mjs`, `handoff.mjs`, the suite | one tracked file not LF: the 2026-10-02 fair-use capture, deliberately `-text` in its project's `.gitattributes` (its bytes hold CR); preflight PASS, handoff OK, 1603 passed |
| 9 | No network, loopback up | `unshare -rn bash -c "python3 lo-up.py && <offline control> && node fetchproof/bin/selftest.mjs"` | `lo up`, `offline`, 1603 passed, 0 failed |
| 10 | Permissions | `git ls-files -s fetchproof/githooks/pre-commit` | 100755; read-only and ownership probes void as root; scratch cleanup: 0 folders left by today's runs |
| 11a | File descriptors | `(ulimit -n 256; node fetchproof/bin/selftest.mjs)` | 1603 passed, 0 failed |
| 11b | Heap | `NODE_OPTIONS=--max-old-space-size=512 node fetchproof/bin/selftest.mjs` | 1603 passed, 0 failed |
| 12 | Dependency health | not applicable: no third-party packages in either language | - |

## Not probed

- Windows and macOS behaviour: no such host here; CI's windows-latest leg runs the suite on every
  PR, and macOS is not a platform the kit is maintained for (workflow comment).
- Node 24 and 26: not installed here; CI's node-lines legs run them on every PR.
- Read-only and ownership permission probes: running as root makes permission bits moot.
- Random test ORDER across files: the runner has no shuffle flag; files were run alone instead.
- A `git archive` tree: CI's archive-tree leg runs it on every PR.
- Slow disk, a real old Python, the real Firecrawl CLI: as in pass 4, no tool here for the first
  two without changing the machine, and the third spends credits.

## Summary

Eleven probe groups, about a dozen full-suite runs and 126 single-file runs produced no failure
against an all-green baseline; the one finding is a Low hygiene gap in the result file, fixed. The
build is at least as resilient as pass 4 left it, and the Node floor, the offline guarantee, the
LF pin and the scratch cleanup each held under their probe. Review: `git diff d00be07...<pr-head>`.
