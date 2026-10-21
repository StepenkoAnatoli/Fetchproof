# Break-test pass 8 - 2026-10-11

The break-test skill, run in a session pinned to the branch `arena/9aac6bbb-fetchproof`
at `195b2ca`. The pinned-branch rule applied: every probe ran in a throwaway clone under
`/tmp/bt/`, never in the checkout. No code fix was applied (see F1), so the only commit is
this report.

## Overview

- **Stack and gate.** Node ESM, no dependencies and no `package.json`; kit 0.9.5. The gate,
  read from `.github/workflows/offline-suite.yml` (authoritative over the README):
  `selftest.mjs`, `preflight.mjs`, `examples/release-evidence/run-example.mjs`, the three
  Node<->Python conformance runners, `timeline.mjs` and `export-warc.mjs` regenerating the
  committed bytes, and an empty `git status --porcelain`. CI's seven jobs are
  `platform (ubuntu-latest, ubuntu-26.04, windows-latest)`, `node (24, 26)` and
  `archive tree`, aggregated into the required `suite` check.
- **Environment.** Linux container, 2 CPUs, uid 1001 (non-root, `sudo` group), Node
  v22.22.3, git 2.39.5, Python 3.11.2, no Chromium or Chrome, only the locales `C`,
  `C.utf8` and `POSIX`, fd cap 1024. Differently from pass 7: `unshare -n` is still refused,
  but **`unshare -rn` works** (user namespace + network namespace), which makes the
  network-off probe pass 7 could not run possible here. Inside that namespace the loopback
  interface must be brought up (`ip link set lo up`) or every test that uses a local
  127.0.0.1 server fails.
- **Isolation.** Throwaway clones under `/tmp/bt/`: `fresh` (probe target), `p1`/`p2`
  (parallel runs), `deliv` (delivery diagnostics), `crlf` (autocrlf), a Hebrew-and-space
  path, a 272-character path, plus `/tmp/bt/browser` and `/tmp/bt/al2023libs` for an
  abandoned browser probe. The checkout itself was never modified, and
  `git status --porcelain` was empty before and after every run.
- **Baseline.** Three unchanged full-suite runs in the real checkout: **1782 passed, 0
  failed, failure set empty, 4 unsupported, exit 1** (an incomplete run is not a pass,
  ADR-0108), at 166.1 s / 169.5 s / 176.9 s, 87 test files, Node 22.22.3. The 4 UNSUP are
  the `browser-guard`/`browser-transport` LIVE tests, which need Chromium; this host has
  none. No test failed in any baseline run, and no flake appeared.
- **Root gate, same head.** `preflight.mjs` PASS (0 blocking, 1 warning
  `hygiene/brief-unstamped`, 28 passing, `evidencePolicy=pluralist`); `handoff.mjs` OK (33
  ledger entries, 27 evidence rows, chain verifies); `doctor.mjs` exit 1 with its one
  by-design blocker (`firecrawl-cli` not on PATH and no explicit keyless route declared;
  doctor prints the one-line fix); all four CI extra steps pass - release example 6/6, the
  three conformance pairs agree per vector, `TIMELINE.md (60 events)` and
  `55 records (27 captures)` regenerate, and the tree stays clean.

## Findings

> **[F1] `handoff` run from inside a project's `research/` folder says nothing has been
> collected and tells the reader to collect it there** (Low, Possible)

Repro (any gated project with a collected corpus, e.g. a fresh clone):

```
cd <project>/research
node "$HOME/.agents/fetchproof/bin/handoff.mjs"      # exit 1
```

Observed:

```
handoff: nothing to hand off yet - nothing has been collected in this project.

Collect it here, then commit research/ including research/raw/ and its dotfiles:
  .../fetchproof/bin/research.mjs
```

The parent directory is the project root and holds a complete corpus - `handoff.mjs` run
there prints OK (33 ledger entries, 27 evidence rows, chain verifies).

- **Root cause.** `bin/handoff.mjs` scopes everything to the cwd, which is the kit's
  contract ("the project is the current working directory"). From a subdirectory the four
  artifacts are absent, that is indistinguishable from an uncollected project, and the
  `nothingCollected` branch prints the collect-it-here remedy without checking whether the
  cwd is one of the project's own folders.
- **Impact.** A misleading diagnosis whose advice points at collection, which spends
  credits (ADR-0129). The harm is bounded: the suggested command refuses in that directory
  - `research.mjs --dry-run` from `research/` prints `research/plan.json does not exist -
  nothing to collect` and exits 2 - so nothing is spent. `preflight.mjs` from the same
  folder prints `not gated - this project holds none of the four gate markers, so there is
  nothing to judge.` and exits 0 (the ungated scope notice, ADR-0153): the same
  subdirectory-scoped answer, without the wrong advice.
- **Action: Not fixed, needs your decision.** The kit is feature-frozen (ADR-0117), and
  detecting "this cwd looks like a project's `research/` folder" is new behaviour, not a
  wording repair; it also changes user-facing text that tests cover. Recommended minimal
  change for the owner: when the cwd contains `raw/` and `EVIDENCE.md`, or
  `../research/raw/.fetches.jsonl` exists, print "this looks like the project's `research/`
  folder - run this from the project root" instead of the collect remedy.
- **Verification.** The repro above, in a clone; the root-directory invocation still prints
  OK and is unchanged.

## Applied fixes

None. F1 is a frozen-surface diagnostic change and is reported for a decision instead.

## Rejected fixes

None attempted - no apply-and-revert cycle ran, because F1 is the only finding and its fix
is not a break-test decision to take.

## Remaining risks

1. **The browser LIVE tests remain unverified here** (Medium, Unknown likelihood). They are
   the one place a real flake has been recorded: CI on 2026-10-11, the `node (24)` job's
   LIVE `browser-guard` meta-refresh test failed once - Chromium never made a request in
   45 s - and passed on re-run and in every sibling job. Attempted and abandoned: an
   npm-sourced `@sparticuz/chromium` build was installed to `/tmp` (73 MB, its own
   `al2023` libraries extracted to satisfy `libnss3`/`libnspr4`), but its Lambda-target
   binary never dumped a DOM in this container (`--dump-dom about:blank` timed out at 45 s
   with a GPU-process crash loop), and it is not the Chrome CI uses in any case.
   Recommendation: run the two LIVE files about 50 times on a host with the CI browser and
   see whether the meta-refresh flake reproduces; whether that environment is worth
   providing is the owner's call.
2. **A fresh collector without the Firecrawl CLI is not READY** (Low, Certain by design).
   `doctor.mjs` exits 1 and names the fix (install the CLI, or declare
   `transport: http-keyless` in the machine config). No action needed; recorded so a
   "1 blocker" reading is not mistaken for breakage.
3. **Reports unindexed in `docs/README.md`** (Low, Certain). Pass 7 recorded this; this
   report's row is added in the same commit, and the older unindexed reports remain for the
   owner to index or leave.

## Probe defects

- The first network-off run was executed without `ip link set lo up`, so the tests that use
  local loopback servers failed (9 `FAIL` lines in `browser-guard`, `large-response` and
  `panel`) while a browser attempt also competed for the CPU. That run was discarded, and
  the probe was re-run in a namespace whose loopback was up: 1782 passed, 0 failed. The
  discarded run is not evidence about the kit.
- One invocation was wrong by the operator, not the kit: `preflight.mjs` was invoked as
  `node fetchproof/bin/preflight.mjs` from a project folder that does not contain the kit
  (the kit lives at its install path), which produced a `MODULE_NOT_FOUND` from Node.
  Re-run with the kit's absolute path, the verdict was the designed FAIL of an uncollected
  project (2 blocking) - the skill's step-1 reminder that the project is the cwd, not the
  kit's location.

## Probes run

Commands are from the root of a clone unless noted. Full-suite invocations used
`FETCHPROOF_RESULT_FILE`; the unsupported count is reported rather than waived, because
ADR-0108 treats an incomplete run as not-a-pass. The 27 rows below are an activity
inventory, not 27 independent full-suite passes.

| # | Probe | Command | Result |
|---|---|---|---|
| 1 | Baseline x3 | `node fetchproof/bin/selftest.mjs` (real checkout) | 1782/0/4, exit 1, 166.1-176.9 s; failure set empty |
| 2 | Root-in-userns control | `unshare -r node fetchproof/bin/selftest.mjs` | 1782/0/4, 164.4 s - root changes nothing |
| 3 | **Network off** | `unshare -rn sh -c 'ip link set lo up; node fetchproof/bin/selftest.mjs'` | 1782/0/4, 162.5 s - the "runs offline" claim holds with no DNS and no sockets (pass 7's unreachable probe) |
| 4 | Timezone | `TZ=Pacific/Kiritimati` full suite | 1782/0/4, 170.2 s |
| 5 | Two suites at once | two clones, both full suites concurrently, 2 CPUs | both 1782/0/4, 175.9 s / 174.7 s |
| 6 | Flakiness programme | 10x each: `concurrency`, `http-linear`, `proxy`, `large-response`, `panel`, `stdout-flush`, `browser-guard` | 0 FAIL in 70 runs; `browser-guard` exits 1 only because of its 4 UNSUP LIVE tests |
| 7 | Clean checkout | fresh `git clone`, then `preflight.mjs` and `handoff.mjs` | exit 0 / exit 0 - nothing depends on untracked files |
| 8 | CRLF / `core.autocrlf=true` | clone with `core.autocrlf true`, `git checkout-index -a -f`, then handoff/preflight | all files still LF; handoff OK; preflight PASS - the `.gitattributes` promise holds |
| 9 | Missing capture | remove one `research/raw/*.md` in a copy, `handoff.mjs` | `handoff-capture-missing` names the evidence row and file; `handoff-chain-broken raw-missing`; collector remedy printed |
| 10 | CRLF-smudged corpus | rewrite `research/raw/*.md` to CRLF, `handoff.mjs` | `handoff-chain-broken body-unmodified/line-endings ... differs only by CRLF line endings` - the ADR-0020 diagnosis, not a false "did not travel" |
| 11 | HOME unset | `env -u HOME` doctor / preflight / handoff | exit 1 (the by-design blocker) / 0 / 0; no stack traces |
| 12 | Minimal env | `env -i PATH=...` preflight / doctor | exit 0 / exit 1 (same blocker); no stack traces |
| 13 | No git on PATH | `env PATH=<empty dir> node <abs>/doctor.mjs` | `fail git - git is not on PATH - the commit gate cannot install`, exit 1, fix printed; preflight still PASS |
| 14 | Read-only project | `chmod -R a-w research/`, `preflight.mjs` | PASS - reads only |
| 15 | Leaked git context | `GIT_DIR=<other repo>/.git` with preflight/handoff | correct verdicts (PASS / OK) - the CLIs are not redirected |
| 16 | `FETCHPROOF_HOME` is a file | real `install.mjs` | exit 2, `could not write ... EEXIST`, target file untouched |
| 17 | Read-only HOME | real `install.mjs`, `HOME` 0500 | exit 2, `could not write ... EACCES`; nothing left behind |
| 18 | Hebrew + space project | `new-project.mjs "/tmp/bt/<hebrew> <space>" --topic "<hebrew>"`, `decompose.mjs`, `preflight.mjs` (kit by absolute path) | scaffold OK, decompose OK (MAP.md carries the Hebrew topic), preflight FAIL by design - 2 blocking on an uncollected project |
| 19 | Long path | suite subset + handoff in a 272-character path | 10 passed / 0 failed; handoff OK |
| 20 | fd cap | `ulimit -n 64`, suite subset | 2 passed / 0 failed |
| 21 | Unicode TMPDIR | `TMPDIR=/tmp/bt/tmp-<hebrew>`, suite subset | 10 passed / 0 failed |
| 22 | Panel port taken | listener on the port, then `panel.mjs --port <same>` | exit 2, `could not listen ... EADDRINUSE` - named, no stack |
| 23 | Panel bad project | `panel.mjs --project /nonexistent` | exit 2, `<path> is not a folder` |
| 24 | Subdirectory diagnostics | `preflight.mjs` / `handoff.mjs` from `research/` | F1 above: handoff's message is wrong for that cwd; preflight's "not gated" is the documented ungated scope |
| 25 | CI extras | release example, three conformance pairs, timeline + export-warc, `git status` | 6/6 examples PASS; 3/3 pairs agree; 60 events and 55 records regenerate; tree clean |
| 26 | Doctor / preflight / handoff at the head | the root gate | 1 blocker (by design), PASS 0 blocking, handoff OK |
| 27 | Leftovers | `git status --porcelain` after every stage | empty - the suite and the probes wrote nothing into the checkout |

## Not probed

- **Windows and macOS.** No such host. CI covers Windows on every commit; macOS remains
  best-effort and untested in CI, as the workflow says.
- **Real uid 0 outside a user namespace.** `unshare -r` maps the user to root *inside* a
  namespace; true container-root permission semantics were not covered, and the probe in
  row 2 showed no difference from the non-root baseline anyway.
- **Locales other than `C`, `C.utf8` and `POSIX`.** None are installed.
- **The four browser LIVE tests.** No Chromium or Chrome on this host; the npm-sourced
  build that was tried (see risk 1) never produced a DOM and is not the CI browser.
- **The metered Firecrawl transport.** No key and no credits, and the skill forbids
  reaching paid services without consent; the collector ran keyless throughout.
- **A real machine-wide install** (global `core.hooksPath`, `~/.claude/settings.json`).
  The skill forbids modifying the machine, so `install.mjs` ran with `HOME` or
  `FETCHPROOF_HOME` pointed at scratch paths, and the pre-commit hook was not registered.
- **Node lines 24 and 26.** Only 22.22.3 is available locally; CI runs the other lines on
  every commit.
- **Flakiness beyond the recorded programme.** 70 repeated subset runs and 7 full-suite
  passes found no flake; a multi-hour soak was not run.
- **Git versions other than 2.39.5**, and a shallow clone's effect on the bundle/archive
  checks (the sandbox's own checkout is history-truncated, and `doctor`'s bundle row and
  the archive-tree job both passed anyway).

## Summary

The build is resilient at this head. Seven full-suite passes - three baselines, the
root-in-userns control, the no-network run, a UTC+14 run and two simultaneous runs - all
returned 1782 passed, 0 failed and an empty failure set, and 70 repeated runs of the
timing-sensitive files produced no flake. Every deliberate break tried (no HOME, no git,
read-only HOME and `research/`, a file where a folder belongs, a taken port, a missing
capture, a CRLF-smudged corpus, Hebrew and 272-character paths, an fd cap of 64, a unicode
TMPDIR) produced a named diagnostic instead of a crash; the two large gaps pass 7 had left
open - no-network isolation and root semantics - are now closed. The single finding is a
misleading `handoff` message when it is run from inside `research/` (Low; not fixed,
because the freeze makes the fix a feature). The most important open risk is the browser
LIVE tests, unverifiable here and the only place a flake has ever been recorded. Nothing on
the branch changes kit code: review this one report commit, and the branch stays green.
