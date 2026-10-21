# Brief - Does the kit measurably beat a strongly prompted agent with the same tools and budget?

_Auto-drafted 2026-10-06 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** The configured research checks passed. Disclosed known unknowns
and gate warnings still apply; PASS does not establish that every claim is correct.

**Gate warnings from this evaluation: 0.**

These findings apply to the whole corpus at the time of this evaluation. Re-run
preflight after edits; this list is not a fresh evaluation of the resulting document.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

Answer, for the owner, whether Fetchproof measurably beats a strongly prompted agent
given the same browsing, file, and testing tools, the same models, and the same total
budget (ADR-0145). The deliverable is the evaluation itself: a frozen protocol and
per-task grading rubrics committed before any trial (`research/PROTOCOL.md`), then
executed trials with retained artifacts and transcripts, and a closing decision document
that keeps, simplifies, or drops each kit mechanism — collector, ledger integrity checks,
handoff check, commit hook — against its pre-registered criterion. Done means both arms
have run all twelve tasks for the planned trials, every outcome is scored under the
frozen rubrics with its status word (verified / untested / expected), and the resulting
keep/simplify/drop decisions are recorded as ADRs. No product code, judge, check or
format changes: ADR-0117's freeze and ADR-0089's semantic boundary remain in force.

## What we verified

| Claim | Source | Type |
|---|---|---|
| Anthropic's agent-evaluation guidance (published 2026-01-09) defines the outcome as environment state, not the agent's report: [quote: The **outcome** is the final state in the environment at the end of the trial. A flight-booking agent might say “Your flight has been booked” at the end of the transcript, but the outcome is whether a reservation exists in the environment’s SQL database.] It prescribes repeated trials because runs vary: [quote: Each attempt at a task is a **trial**. Because model outputs vary between runs, we run multiple trials to produce more consistent results.] and offers pass@k (any of k succeeds) versus pass^k (all k succeed) as the two trial aggregates. Grader calibration: [quote: LLM-as-judge graders should be closely calibrated with human experts to gain confidence that there is little divergence between the human grading and model grading.] Task quality test: [quote: A good task is one where two domain experts would independently reach the same pass/fail verdict.] For research agents it names the unsupported-claim check directly: [quote: Groundedness checks verify that claims are supported by retrieved sources, coverage checks define key facts a good answer must include, and source quality checks confirm the consulted sources are authoritative, rather than simply the first retrieved.] For coding agents it grades beyond tests-pass: [quote: heuristics-based code quality rules can evaluate the generated code based on more than passing tests, and model-based graders with clear rubrics can assess behaviors like how the agent calls tools or interacts with the user.] Scores are not accepted until transcripts are read: [quote: As a rule, we do not take eval scores at face value until someone digs into the details of the eval and reads some transcripts.] Closes U-1; corroborates U-2 (groundedness) and U-3 (grading beyond passing tests). | E-01 `anthropic.com` (U-1, U-2, U-3) | P |
| Laminar's platform comparison (2026-10-05, vendor blog, secondary) states the same outcome-versus-report rule as E-01 from an independent source: [quote: A reply saying “Your refund is complete” does not establish that the payment succeeded. A recorded tool call does not establish it either. Outcome checks establish what changed; a trace helps you investigate how it happened.] Its comparison-control checklist matches the protocol's matched-arm design: [quote: Freeze dataset, scorer, model, prompt, and environment versions. Separate development cases from a held-out set, and repeat stochastic trials.] and its grader rule: [quote: Calibrate model judges against reviewed human labels; inspect false positives, false negatives, and disagreement.] Context for U-1 and U-4; carries no design on its own. | E-03 `laminar.sh` (U-1, U-4) | S |
| Liu, Zhang and Liang (Stanford, arXiv 2304.09848v2, Oct 2023) give the published definitions the protocol's "unsupported claim" metric reuses. The unit is the sentence; two metrics: [quote: Citation recall measures the proportion of generated statements that are supported by citations. Citation precision measures the proportion of citations that support their associated statements.] A statement counts as supported only under a hearer test: [quote: if a generic hearer would affirm the statement ... and unsupported otherwise] - so an unsupported claim is a verification-worthy statement whose cited sources do not let a generic reader affirm it, and a bad citation is one that does not support its own sentence (citation precision). Measured on real systems they found [quote: on average, a mere 51.5% of generated sentences are fully supported by citations and only 74.5% of citations support their associated sentence] which is the comparison baseline. Closes U-2. | E-04 `arxiv.org` (U-2) | P |
| Liu et al., EvalPlus (arXiv 2305.01210, NeurIPS 2023) define and detect the defect that passes an initial suite. The cause: [quote: Current programming benchmarks often only include on average less than 10 tests for each coding problem.] The detector is an expanded suite: [quote: the average #tests of original HumanEval and HumanEval+ are 9.6 and 774.8 respectively] and the result: [quote: HumanEval+ is able to catch significant amounts of previously undetected wrong code synthesized by LLMs] with pass rates dropping across 26 models: [quote: the performance drop is significant with up-to 23.1% ... 28.9% ... reduction over the evaluated models]. A defect for the protocol's C3 task is therefore a program that passes the task's provided tests and fails the expanded hidden suite built from the same specification; it also warns that reference solutions can be wrong ([quote: we found over 10% of them are incorrectly implemented]), so C3's expected outcome must itself be checked against the hidden suite before any trial. Closes U-3. | E-05 `arxiv.org` (U-3) | P |
| Gunjal, Liu and He (Scale AI, arXiv 2601.04171, Jan 2026) show that passing ground-truth tests is not the same as a correct patch: their rubric audit found that [quote: When tests pass but rubric scores are low, 54% of rubric failures are high-utility—often flagging missed root causes or missing edge-case coverage] and their failure taxonomy names the defect class the protocol's C3 task targets: [quote: Patch makes tests pass but does not actually fix the underlying semantics or root cause of the bug.] Supports U-3 (a defect that passes the initial suite is detectable by review of root cause and edge-case coverage, not only by more tests). The rubrics-vs-tests scores (54.2% / 40.6% on SWE-Bench Verified) are context only; the protocol adds no judge. | E-02 `arxiv.org` (U-3) | P |
| Kapoor et al., "AI Agents That Matter" (Princeton, arXiv 2407.01502, 2024) prescribe the matched-budget design: [quote: Therefore, agent evaluations must be cost-controlled; otherwise it will encourage researchers to develop extremely costly agents just to claim they topped the leaderboard.] because [quote: Accuracy alone cannot identify progress because it can be improved by scientifically meaningless methods such as retrying.] Cost is dollars, not a proxy: [quote: downstream evaluation should account for dollar costs, rather than proxies for cost such as the number of model parameters] Their own comparison fixes the model, the task set and the trial count and reports means: [quote: We run each agent five times and report the mean accuracy and the mean total cost on the 164 HumanEval problems.] and their simple baselines (retry, warming, escalation) sit on the accuracy-cost Pareto frontier that complex agents miss, which is the confound the protocol's Arm B (strong prompt, same tools) exists to control. Closes U-4 with E-07. | E-06 `arxiv.org` (U-4) | P |
| McCleary et al. (arXiv 2603.08877, March 2026; abstract page only, the capture is the abs listing) describe a controlled agent comparison under explicit budgets: [quote: We present a controlled measurement study of how search depth, retrieval strategy, and completion budget affect accuracy and cost under fixed constraints.] using [quote: a model-agnostic evaluation harness that surfaces remaining budget and gates tool use, we run comparisons across six LLMs and three question-answering benchmarks] - the controls are the model (varied explicitly), the benchmark, and a fixed tool-call and completion-token budget enforced by the harness, with [quote: reproducible prompts and evaluation settings] published. Confirms for U-4 that budget is enforced per trial (tool calls and tokens) rather than averaged after the fact. Abstract-level evidence; the full paper was not captured. | E-07 `arxiv.org` (U-4) | P |

## Contradictions and how they were resolved

No source contradicts another on the four facts collected. Two points were checked rather
than assumed:

- **Trial aggregate.** E-01 offers two aggregates over repeated trials, pass@k (any
  success) and pass^k (all succeed), and E-06 reports a plain mean over five runs. These
  are not in conflict: they answer different questions. The protocol's primary outcomes
  are counts per trial (unsupported claims, defects), so the pilot reports per-trial
  values and their mean per arm, and reports pass^3 only for the binary outcomes
  (successful handoff, truthful reporting) where consistency is the point.
- **How a tests-passing defect is detected.** E-05 detects it with an expanded hidden
  suite; E-02 detects it by rubric review of root cause and edge-case coverage, and finds
  that 54% of its "tests pass, rubric low" cases are real. The protocol already uses
  both (hidden tests plus grader review for C3); E-02 is the reason the grader review
  stays rather than being dropped as redundant with the hidden suite.

Corroboration: U-1 rests on two independent voices (Anthropic, Laminar). U-2 and U-3
rest on a paper each plus Anthropic's guidance naming the same check. U-4 rests on two
papers (Princeton 2024, McCleary 2026) plus Laminar. E-07 is abstract-level only; nothing
in the protocol depends on a detail that only its full text would carry.

## Known unknowns

None. No unknown is declared KNOWN-UNKNOWN.

## Decision

Phase 1 is complete: U-1..U-4 are CLOSED and the operational definitions the rubrics were
waiting on are fixed (see "Cited definitions" in `research/PROTOCOL.md`). The protocol's
structure did not change; only the four cited definitions were filled in, under its
pre-trial amendment path.

The definitions the builder (the trial runner and the graders) works to:

- **Outcome (U-1).** The final environment state at the end of a trial, scored
  separately from the transcript; three trials per arm per task; graders calibrated
  against a human spot-check per task type before scoring; a task is valid only if two
  readers would reach the same verdict on its expected outcome (E-01, E-03).
- **Unsupported claim (U-2).** A verification-worthy sentence in the work product whose
  cited or saved sources would not let a generic reader affirm it; counted per sentence.
  A citation that does not support its own sentence is a citation-precision failure and
  is counted as well (E-04).
- **Implementation defect (U-3).** A program that passes the task's provided tests and
  fails the expanded hidden suite written from the same specification, or whose root
  cause is not fixed on grader review; C3's reference solution must itself pass the
  hidden suite before the first trial (E-05, E-02).
- **Matched arms (U-4).** Same model and version, same tool set, same task set, same
  trial count, and a per-trial budget in tokens, metered credits and wall-clock that is
  enforced during the trial, not totalled afterwards; cost is reported in money and
  tokens, never a proxy (E-06, E-07, E-03).

**First build step.** Write the twelve task texts, expected outcomes and rubrics into
`TASKS/` and the verbatim Arm B prompt into `PROMPT-ARM-B.md`, each rubric citing the
definition above it uses, and commit them before any trial (protocol step 2).

**Out of scope.** No new command, check, judge or format in the kit (ADR-0117,
ADR-0089); no trial starts before `TASKS/` is committed; no amendment to the protocol
after the first trial.

## Next steps

1. Protocol step 2: write `TASKS/` (twelve tasks, expected outcomes, rubrics) and
   `PROMPT-ARM-B.md`; verify C3's reference solution against its hidden suite; commit.
2. Protocol step 3: run the trials, three per arm per task, retaining transcripts and
   artifacts under `results/`.
3. Protocol step 4: score blind-first, report with status words, record each
   mechanism's keep/simplify/drop as its own ADR, and flip this project's row in
   `docs/decisions/README.md` from `pending`.
<!-- fetchproof:brief-draft body=f5df338c6d1537f6 inputs=b29a74a641aba847 gate=pass -->
