# Break-test pass 6 - 2026-10-04

The sixth adversarial pass over the build and the suite, run on `main-axuse3` at `84df2c4`
(kit 0.9.5, the head that became `main` at `839a2f3` when PR #247 merged during the pass).
Focus: what changed since pass 5 the same day (the 0.9.5 release, the Tavily decision
project) and the four browser LIVE failures the operator's Windows PC reported from one full
run in three. Procedure: the break-test skill, pinned-branch setup.

## Overview

- **Stack and gate.** Node ESM, no dependencies. Gate: `node fetchproof/bin/selftest.mjs`
  (1603 tests at the start, about 145 s here), `preflight.mjs` PASS, `handoff.mjs` exit 0,
  `doctor.mjs` READY. CI: seven jobs (ubuntu-latest, ubuntu-26.04, windows-latest on Node 22;
  Node 24 and 26; archive tree; aggregate), all green on `84df2c4`.
- **Environment.** Linux 6.18 container, Node v22.22.2, 4 CPUs, root, no Windows, no Defender.
  What this bounds: permission probes are void as root; the PC's antivirus and spawn latency
  cannot be reproduced here; Windows is CI's to run.
- **Isolation.** Throwaway clone at a scratch path outside the checkout, checked out at
  `84df2c4`; every probe and the red-first fix ran there. The real checkout saw only `status`,
  `diff`, `add`, `commit` and the file copies of the verified fix. The user's checkout was
  clean throughout.
- **Baseline.** Three full runs in the clone: 1603 passed, failure set empty, 145.1 s,
  148.0 s, 148.2 s. No consistent and no intermittent failure on this host.
- **Fix commits.** On `main-axuse3`: F1 `ba8c775`; this report the commit that adds this report.
- **External facts.** None relied on. `doctor` was READY (kit 0.9.5); no research project was
  needed, because no finding's cause rests on a third-party tool's documented behaviour. The
  PC's slowness is reported as observed, with its cause marked unverified.

## Findings

> **[F1] The parent gives the guard child up before ADR-0119's own allowance is spent, and
> the verdict then reads "never made a request in 0 s"** (Medium, Possible; Likely on a
> slow host)
> Repro (from the repository root, a fake browser that launches in 13 s and renders in
> 13.5 s under a 15 s timeout; the script is reproduced in the pass's scratch and described
> in the commit): before the fix the result was
> `ok:false, error:"... within 15s: the browser never made a request in 0 s", wallMs:25031,
> childElapsedMs:null, childErrorMessage:"the guard child did not finish"`.
> Controls: launch 13 s + render 1 s -> ok (startupMs 13061); launch 1 s + render 13.5 s ->
> ok (startupMs 1061). Only the combination inside `2 × timeout` but past `timeout + 10 s`
> failed, so the failure is the parent's timeout, not the fake.
> Observed on the PC (GPT's report, run 1 of 3): `/meta ... within 45s: the browser never
> made a request in 0 s` and `/stalled within 30s: the browser never made a request in 0 s`.
> Cause: `renderGuarded` passed `timeout + 10_000` to the parent `spawnSync`; ADR-0119 lets a
> browser that makes a request run `2 × timeout` (launch allowance, then the render budget
> re-armed at the first request). The parent killed the child mid-render and its report
> (`elapsedMs`, `startupMs`, the timeline) died with it; the transport printed the 0 it had.
> Action: Fixed, commit `ba8c775` (`guardChildTimeout(timeout) = 2 × timeout + 10 s`;
> the parent-timeout verdict names the time given and that the record was lost).
> Verification: two new tests red before (`25000 !== 40000`; bare `the guard child did not
> finish`) and green after; `selftest.mjs browser-transport` 33 passed; the reproduction
> passes after the fix (ok, wallMs 26729, startupMs 13073); both browser groups five times
> each after the fix: guard 16 passed x5 (7.0-7.5 s), transport 33 passed x5 (22.6-22.7 s), 0 failures in 10 runs; full gate in the real checkout through the commit gate.

> **[F2] The browser LIVE tests' fixed budgets are exceeded on the operator's PC about one
> full run in three** (Medium, Possible; *cause unverified*)
> Observed (GPT's report, the PC, verbatim): `the launch ate the render budget: the browser
> did not finish within 2000ms` (`browser-guard.test.mjs:274`); `the browser stopped loading
> at its 20 s deadline; every one of the 13 requests through the guard had been answered, so
> the wait was inside the browser` (`browser-transport.test.mjs:390`, `'partial' !== 'full'`);
> and the two F1 verdicts above. 1 of 3 full runs; 0 of 10 isolated runs of either group;
> full-suite wall time on the PC 2119 s, 1206 s, 975 s, 804 s against 145 s here.
> Not reproduced here: both groups pass pinned to one core with three busy loops (guard 19 s
> vs 9 s control) and with nine (guard 27 s, transport 36 s vs 22.5 s). CPU starvation alone
> does not make Chromium take 30 s to its first request; what does on that PC is not known
> (Defender real-time protection was on with no exclusion for the checkout; the cause is a
> guess, not a finding).
> Action: the LIVE budgets are not raised; raising them would hide the question. F1 removes
> the lost-report consequence. After GPT's review of this report (below), the one synthetic
> test among the four - the 2 s launch-allowance test - scales its budget with the host's
> measured Node boot (commit 36f06e4), and the guard LIVE helper prints the first-request
> time for a render over 20 s, as the transport's /stalled helper does for one over 25 s.
> Recommended: run the suite on the PC once with the checkout excluded from real-time
> scanning (the operator's decision, a machine setting) and once without, and compare the
> `browser-guard LIVE ... took N ms (... first request after M ms ...)` stderr lines the
> tests print for any render over 20 s.

## Applied fixes

| Commit | Finding | Files |
|---|---|---|
| `ba8c775` | F1 | `fetchproof/lib/browser-transport.mjs`, `fetchproof/test/browser-transport.test.mjs`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `fetchproof/README.md` |

## Rejected fixes

None attempted and reverted.

## Remaining risks

1. **F2** (Medium, Possible): see above. Decision needed: whether to run the Defender-exclusion
   comparison on the PC, and whether a host-scaled budget for LIVE tests is wanted if the
   launches stay slow.
2. **Nine UNSUP on the PC** (Low, Likely there): seven `SYMLINK-NOT-PERMITTED` (Windows
   without Developer Mode) and two `BASH-NOT-FOUND` (the workflow-block parsing tests). Not
   defects: covered by CI's Windows job, which runs as administrator with bash on PATH. A
   local complete run needs Developer Mode, the operator's call.

## Probe defects

- Two cleanup commands used `pgrep -f` / `kill` with a pattern that occurred in the shell's
  own command line and killed the shell running them (exit 144). Corrected by dropping
  process cleanup by pattern; the orphaned page servers from one failed probe are idle
  loopback listeners and were left to the session.
- The first busy-loop burner used `sh -c 'while :; do :; done'`, which the session's safety
  check refused as an unreadable shell script; rewritten as `node -e 'for(;;){}'`. No result
  was affected.

## Probes run

| # | Probe | Command (from the repository root unless noted) | Result |
|---|---|---|---|
| 1 | Clean clone, full suite x3 | `git clone <checkout> <scratch>/clone; node fetchproof/bin/selftest.mjs` with `FETCHPROOF_RESULT_FILE` | 1603 passed x3, failure set empty, 145-148 s |
| 2 | Slow-host, CPU 4:1 | burners `taskset -c 0 node -e 'for(;;){}'` x3; `taskset -c 0 node fetchproof/bin/selftest.mjs browser-guard`; control without burners | 16 passed, 19.1 s; control 16 passed, 8.7 s |
| 3 | Slow-host, CPU 10:1 | nine burners; both browser groups on core 0 | guard 16 passed, 26.8 s; transport 33 passed, 35.9 s; null |
| 4 | Launch inside allowance, render inside budget (F1 repro) | fake browser 13 s / 13.5 s / timeout 15 s, plus two controls | FAIL before the fix at 25.0 s; controls ok; ok after the fix at 26.7 s |
| 5 | New nested project under `core.autocrlf=true` clone | `git clone -c core.autocrlf=true`; in `docs/decisions/2026-10-04-tavily-terms-reread`: `handoff.mjs`, `preflight.mjs` | handoff OK (5 entries, chain verifies), PASS; null |
| 6 | Git-archive tree, no repository above | `git archive HEAD \| tar -x`; `GIT_CEILING_DIRECTORIES=<parent>`; handoff in the nested project and at the root, root preflight | all OK / PASS; null |
| 7 | Declared Node >= 22 enforced | `/opt/node20/bin/node fetchproof/bin/doctor.mjs`, `.../selftest.mjs`; node21 doctor | doctor: 1 blocker, "install Node 22+"; selftest exit 2; null |
| 8 | Flakiness after the fix | both browser groups x5 in the clone | guard 16 passed x5 (7.0-7.5 s), transport 33 passed x5 (22.6-22.7 s), 0 failures in 10 runs |
| 9 | Version invariants | `selftest.mjs repo-hygiene` on the release commit (earlier the same day) | 11 passed, incl. the one-kit-version test |

## Not probed

- Windows, Defender and spawn latency: no Windows host here; CI's Windows job is the only
  Windows run, and it does not have the PC's load. The PC's own report (GPT, 2026-10-04)
  stands in for it.
- Permissions: running as root, permission bits are not enforced.
- Lockfile and install integrity, dependency health: no dependencies, no manifest.
- Network removal, timezone, locale, order, resource limits, env sweep: run in pass 5 the
  same day on `c7330d5`, all null; the commits since touch docs, a version constant and one
  nested corpus, none of which those probes exercise.
- A Firecrawl run at zero credits: the account holds 846 credits; draining it is the
  operator's money (and on a pay-as-you-go account would charge a card), so it was not run.
  The exhaustion path is exercised by the suite with the vendor's recorded "Insufficient
  credits" text.

## Summary

The build is as resilient as pass 5 left it: three clean baselines, null results on the
archive tree, the autocrlf clone, the Node floor and two levels of CPU starvation. The one
defect found is real and now fixed: the parent's hard timeout did not honour ADR-0119's
launch allowance, so a slow launch plus a normal render was killed with its diagnostics,
which is exactly what the PC saw. What remains open is why Chromium takes 30 s to its first
request on that PC; the next run there, with F1 in place, records the first-request time of
every LIVE render over the helpers' thresholds, and that number decides what, if anything, to
change next. Review: `git show ba8c775 a271057 36f06e4`.

## After the report: GPT's review of 2026-10-04 on the PC

- The full suite at `d9e5f9c`: 1596 passed, 0 failed, 9 UNSUP, 718 s. Ten runs of each
  browser group: transport 0 failures; **guard 2 of 10**, both the ADR-0119 launch-allowance
  test, `the launch ate the render budget: the browser did not finish within 2000ms` - a
  synthetic Node fake browser, not Chromium. Cause: the fixed 2 s budget left Node 800 ms to
  boot before the fake's 1.2 s sleep. Reproduced here by making every Node boot 900 ms slower
  (`NODE_OPTIONS=--import=<busy-wait>`): 1 failed with the PC's message. Fixed in `36f06e4`:
  the budget is `max(2 s, 5 × measured boot)`, the shape of the test unchanged; 16 passed
  under the handicap and without it.
- `gaveUp` was a regex on the parent-timeout message; it is a flag on the result now
  (`a271057`), with the assertion red when the flag is removed.
- Two timing lines were printed on the PC, both the transport's /stalled render: first request
  after 2437 ms and 2540 ms, the browser then held to its 20 s deadline by the stalled resource
  as designed. No LIVE failure in the review's twenty runs.
- GPT's note stands and is not fixed: `2 × timeout + 10 s` bounds the browser, not the child's
  DNS lookup before it or its net-log read and guard shutdown after; none of those was observed
  to take long, and no bound is placed on them here.
