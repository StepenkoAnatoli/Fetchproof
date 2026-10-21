# ADR-0142: The suite's budget follows the gate's watchdog

Date: 2026-10-05
Status: accepted. Amends ADR-0120 in two numbers and one sentence: the suite's budget (was 20
minutes), the hook's watchdog in the kit's checkout (was 1500 s), and "unless the operator set
`FETCHPROOF_GATE_TIMEOUT`, which is theirs" - it is still theirs, and now reaches the suite. A
bug fix under the freeze (ADR-0117): no new command, flag, key or check.

## Context

ADR-0120 made the commit gate run the suite in the kit's own checkout, with two bounds in two
layers. `lib/gate.mjs` stopped the suite after `SUITE_TIMEOUT_MS`, 20 minutes, and blocked: "a
suite that cannot report is not green". `githooks/pre-commit` put its watchdog around the whole
gate, 120 s by default, widened to 1500 s in the kit's checkout unless the operator set
`FETCHPROOF_GATE_TIMEOUT`.

On the operator's Windows PC (2026-10-05) the whole suite runs green in about 1825 s -
`1599 passed, 0 failed, 7 unsupported in 1824.6s`. Every commit that staged `fetchproof/`
was stopped at 1200 s and blocked on a green tree, and the only way through was
`git commit --no-verify`, taken once for the ADR-0141 commit and reported. Two inconsistencies
made it worse than one wrong number:

1. **The node budget always decided, and it was the shorter one.** The hook's 1500 s was
   already longer than the gate's 1200 s, so widening the watchdog did nothing for a slow
   host: the number the host actually met was the node side's.
2. **The operator's setting reached one layer of two.** `FETCHPROOF_GATE_TIMEOUT` set the
   watchdog and nothing else. Raised to fit a slow suite, the gate still stopped the suite at
   1200 s. Set *below* 1200 s, the watchdog killed the gate before the gate could report - an
   internal error, decided by posture (ADR-0020) - and a fail-open machine **allowed** a commit
   whose suite never reported. Reproduced here 2026-10-05 with a hung runner and a 40 s
   setting: the hook printed "the gate exceeded 40s and was killed - allowing this commit
   (fail-open)". On that Windows host the runner died with the gate, so the gate had printed
   "BLOCKED" first, and the commit was allowed anyway: `timeout` exits 124 whatever its
   command printed.

The suite's budget is a backstop for a hang: a runner that never reports would otherwise hold a
commit forever. It is not a forecast of a run. A budget below an honest run on a supported host
blocks a green tree, and the remedy it leaves is the override the rule exists to make rare.

## Decision

- **The default budget is 65 minutes** (`SUITE_TIMEOUT_MS`): twice the slowest honest run
  measured on a supported host, 1825 s, rounded up to five minutes. A test pins the budget to
  at least twice that measure, so a later cut has to answer to it.
- **One setting governs both layers.** `suiteBudgetMs()` reads `FETCHPROOF_GATE_TIMEOUT`
  and gives the suite that watchdog less `GATE_REST_S`, the 120 s the hook's default watchdog
  allows a gate that runs no suite. A watchdog shorter than twice that allowance gives the
  suite half of it. The gate then stops the suite and blocks before the watchdog fires,
  whenever its own work before and after the suite fits what is left; a watchdog too short for
  even that is decided by posture, as it is for every rule (ADR-0020). A positive watchdog never
  reads as no bound, and none is passed to spawnSync past a timer's reach (2^31 - 1 ms).
- **Both layers read one grammar.** Seconds, with an optional fraction and an optional `s`,
  `m`, `h` or `d`, and at most nine digits before the point (`gateTimeoutSeconds` in
  `lib/gate.mjs`, `gate_timeout_readable` in the hook). Nine digits keep every value far
  below the 2^63 s that Git for Windows' timeout(1) reads as already expired, exiting 124 at
  once whatever the gate decided. timeout(1) reads more - a sign, an exponent, hex, through strtod - and the first
  cut of this change read less than it: for `+40` the watchdog took 40 s while the gate kept
  its 65 minutes, the watchdog fired first, and a fail-open machine allowed the commit (found
  by review the same day). The hook now names a value outside the grammar on stderr and treats
  it as unset, as the gate does, so timeout(1) is only ever handed a value the gate read the
  same way. A test runs the hook's own reader over a table of values and holds it to the gate's.
  The narrowing reaches every gated project's hook, not only the kit's checkout: a value such as
  `+600` or `6e2` that timeout(1) honoured now falls back to the default with a warning, and a
  malformed one no longer makes timeout(1) exit 125 and block every commit.
- **`0` disables the watchdog and leaves the suite's default budget.** With no watchdog there
  is nothing for the gate to stay under, and the budget is still the one backstop for a hang.
- **The runner is stopped with SIGKILL.** spawnSync's default SIGTERM reached a runner whose
  harness listens for SIGTERM to remove its scratch, and a listener runs only when the event
  loop turns: on POSIX a runner blocked synchronously outlived its budget, the watchdog killed
  the gate, and the posture decided (found by review the same day; Windows terminates the
  process whatever the signal). A stopped run's scratch is left behind in the temp folder.
- **The hook's watchdog in the kit's checkout is the suite's budget plus the allowance**,
  4020 s, so the node side decides. A test reads both constants from `lib/gate.mjs` and pins
  the hook's number to their sum, and the hook's 120 s default to `GATE_REST_S`.
- **A suite stopped at its budget names the setting.** The block's fix says to time a run and
  set `FETCHPROOF_GATE_TIMEOUT` to twice that plus 120 for the commit, keeping the margin
  the default keeps, before it names the override.
- **This change's own commits.** The gate that judges a commit is the deployed kit's, and the
  deployed kit on the operator's PC still stops the suite at 1200 s. So the commits that bring
  this change in are judged by this checkout's own gate (`FETCHPROOF_HOME` pointed at its
  `fetchproof/`) with `FETCHPROOF_GATE_TIMEOUT=4020` set for the deployed hook's
  watchdog: every check runs, no override is taken, and the commit report says so.

## Rejected

- **Scale the budget with a host measure**, as the ADR-0119 launch-allowance test scales with
  Node's boot. That test measures a quantity inside its own run and protects one assertion
  from a false red. Here the measure would be taken at commit time to predict a run of tens
  of minutes. On the operator's PC the suite is about twelve times the 150 s AGENTS.md records,
  and nothing measured ties that ratio to Node's boot. A noisy sample would make
  one green tree pass on one commit and block on the next. And the hook's watchdog would have
  to follow a number computed inside node - a new channel between the two layers, or a
  watchdog that cannot know whether it is outlasting the budget.
- **Raise the default alone.** It fixes the measured host and leaves the next slower one -
  and any operator who sets the variable below the budget - back at the override, or at the
  fail-open allow above.
- **Pass the setting through alone.** No operator should have to discover a variable to commit
  on a supported host with a green tree; the default has to fit the hosts the kit supports.
- **A new key for the suite's budget** (`FETCHPROOF_SUITE_TIMEOUT` or a config field). New
  surface under the freeze, and two settings that must be kept in order by hand - the
  watchdog above the budget - would put inconsistency 2 back in the operator's hands.
- **Drop the node budget and let the watchdog bound the suite.** A watchdog kill is decided by
  posture, so a fail-open machine would allow a hung suite; and where coreutils is absent the
  hook runs the gate unwatched, and a hang would hold the commit forever.
- **SIGTERM, then SIGKILL after a grace period**, so a runner that is merely slow still removes
  its scratch. spawnSync sends one signal and waits; escalation needs an asynchronous spawn,
  which would make the gate's verdict asynchronous through `evaluate` and both hooks, for
  scratch a stopped run can leave to the temp folder's own cleanup.
- **Read timeout(1)'s whole grammar in node.** strtod takes signs, exponents, hex floats,
  `inf` and, after the C locale, the current locale's decimal separator; a copy in JavaScript
  would agree with one coreutils on one locale and drift from the next. Narrowing what the
  hook hands timeout(1) closes the class instead of chasing it.
- **Have the hook export its effective watchdog to node.** The gate would follow the hook
  exactly, but the variable would then reach the suite run inside the gate, and the hook tests
  inside that run would see the hook's widened watchdog instead of the operator's: the suite
  would describe the hook's state, not the kit (ADR-0123). Both layers instead derive their
  bound from the same two constants, and a test keeps them in step.

## Trigger to revisit

A supported host whose honest run passes half the budget: re-measure, and raise the default
to twice the new slowest run. If a hang inside the suite is ever observed to wait out the
budget in practice, the remedy is in the runner - its per-test watchdog cannot interrupt a
test blocked in a synchronous child - not a shorter budget here.
