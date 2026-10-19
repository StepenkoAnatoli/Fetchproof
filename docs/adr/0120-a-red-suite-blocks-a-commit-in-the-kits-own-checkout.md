# ADR-0120 — A red suite blocks a commit in the kit's own checkout

- **Date:** 2026-10-01
- **Status:** accepted; amended by ADR-0142 (the suite's budget is 65 minutes, the hook's
  watchdog in the kit's checkout is 4020 s, and `RESEARCH_KIT_GATE_TIMEOUT` governs both);
  superseded in part by ADR-0183 (the runner is the commit's, run in a scratch repository built
  from the index being committed, not the checkout's working tree)
- **Area:** `lib/gate.mjs` (the suite rule), `bin/gate.mjs` (the block's wording),
  `githooks/pre-commit` (the watchdog in the kit's checkout)
- **Lifts the freeze (ADR-0117)** for one item: this check.

## Context

"A red suite stops work" is rule 5 of the standing protocol, and it was prose: no check
judged it, on the principle that a gate that judges prose is a gate that will be wrong.

On 2026-10-01 an agent working in this repository committed twice while the suite was red,
in one afternoon. The first time, the chain that ran the suite read its result through a
pipe (`selftest.mjs | grep | tail`), which reports the last stage's exit code, so a red run
read as green and the commit was pushed. The second time, a helper printed "SUITE RED" and
the chain's `set -e` did not stop on it. Both commits were caught afterwards by the agent
reading its own output, not by anything in the repository. The rule was followed in spirit
both times - the suite was run - and failed in the one place that mattered: the decision to
commit was taken on a reading of the result, not on the result.

The gate already decides commits here. Preflight, the architecture-map rule and the
integrity rules all run from the pre-commit hook, and the suite reports its result as data
(`RESEARCH_KIT_RESULT_FILE`, written for CI) precisely so no reader has to scrape it.

## Decision

In the kit's **own checkout**, a commit that touches `research-kit/` is allowed only when
the suite is green. The commit gate runs the checkout's `bin/selftest.mjs` and reads its
result file:

- the rule fires only where all four markers of the kit's checkout exist
  (`research-kit/lib/core.mjs`, `bin/gate.mjs`, `bin/selftest.mjs`, `test/`). A scaffolded
  project has none of them, so no project built on the kit pays for a suite it does not
  own;
- only a commit staging a path under `research-kit/` owes the suite. A docs-only commit, an
  ADR, a corpus commit, pass as before. With the staged list unknown (git could not list
  it) the suite is run, as the index is judged as a whole;
- the result is read from the file, not from stdout: an unsupported test (no Chromium, no
  Python - ADR-0108) is not red, so the run is given `RESEARCH_KIT_ALLOW_UNSUP=1`; a runner
  that produced no result is a block, never a pass, and so is one that did not finish in
  20 minutes, and so is a green run whose runner still exited non-zero (the README's test
  count is checked by the runner, after the tests);
- the suite does not inherit git's hook environment: `GIT_INDEX_FILE`, `GIT_DIR`,
  `GIT_PREFIX` and their kin are stripped, as the edit hook strips them, because a suite
  that inherited the index being committed would run every scratch repository's `git add`
  against it;
- the gate says on stderr that the suite is about to run, before the minutes of silence;
- the rule runs last, after preflight and the map rule, because it is the expensive one: a
  commit that would be refused for a cheaper reason never pays for the suite;
- the hook widens its watchdog to 1500 s in the kit's checkout, unless the operator set
  `RESEARCH_KIT_GATE_TIMEOUT`, which is theirs;
- the three overrides stay the three overrides. `git commit --no-verify` goes through and is
  recorded in `research/overrides.log`, as for every other block.

## Alternatives rejected

- **Keep it prose.** It was prose, and it held for the agent's judgment but not for the
  agent's shell: both bad commits came from a chain that misread an exit code, and prose
  cannot read an exit code. The principle behind "no check judges prose" is intact - this
  check judges a result file, not a sentence.
- **CI only.** CI did catch both; after the push, on a branch, with the bad commit already in
  history and one of them already force-replaced. The rule says a red suite stops work, not
  that it stops a merge.
- **Run the suite in every gated project.** No other project has this suite, and a gate
  that ran an arbitrary project's test command would be a new configuration key and a
  new way to run code from a commit hook. The scope is the four markers, and nothing
  configurable.
- **Every commit in the checkout, docs included.** A changelog line does not break a test,
  and a hundred seconds per ADR is the cost that gets a gate turned off.
- **A separate hook or script, outside the gate.** The gate is where this repository
  decides commits, and its overrides are the ones that are recorded.

## Consequences

- A commit touching `research-kit/` in this checkout costs the suite's run (about 100 s on
  a laptop, longer on a slow runner) before it is allowed. That is the price, and it is
  paid only by the commits that can break the suite.
- The block names the count: "the suite is red: N failed, M passed", and the fix is the
  suite's own command. `--no-verify` still works and is still recorded, so a deliberate
  commit on a red suite (pinning a defect, say) is possible and visible.
- The deployed kit (`~/.agents/research-kit`) must carry this version of `lib/gate.mjs`
  for the hook to enforce it: the hook runs the deployed gate against the checkout.
- `template/AGENTS.md` does not change: scaffolded projects carry rule 5 as prose, as
  before, because the check does not apply to them.
