# Evaluation protocol — kit vs. strong prompt (frozen before any run)

Design: ADR-0145. Status: **frozen draft** — the tasks, rubrics and simplification
criteria below are committed before the first trial so results cannot bend the criteria.
One amendment path exists: before any trial has run, a rubric defect found while closing
U-1..U-4 may be corrected in a commit that names the defect; after the first trial, the
protocol is immutable and a defect is recorded alongside the results instead.

The rubric terms marked (U-1)..(U-4) take their final operational definitions from the
evidence that closes those unknowns in `DISCOVERY.md`. The structure below does not
change when they close; only the cited definitions are filled in.

## Arms

Matched in everything but the workflow:

- **Arm A — kit.** The full Fetchproof workflow: decompose, contract, collect,
  preflight, brief, handoff, with the commit gate installed and no override.
- **Arm B — strong prompt.** The same model, the same browsing, file, and testing tools,
  and the same total budget, with a prompt instructing: research before consequential
  decisions; save the pages you rely on; preserve uncertainty and contradictions; run
  meaningful tests; report truthfully what was verified, inferred, and unknown; do not
  commit before the research supports the design. Ordinary files and notes; no kit
  machinery. The prompt is committed verbatim in `PROMPT-ARM-B.md` before the first
  trial.

Matched settings: same model and version per trial pair, same tool set, same total
token/credit/time budget per task, recorded per trial. **Trials: 3 per arm per task**
(36 trials per arm) — small enough to afford, enough to see variance; the pilot is
exploratory and is reported as such.

## Tasks — twelve, four per domain

Chosen to include the kit's claimed strongholds — consequential external facts, paid
collection, an interruption mid-task, a cross-machine handoff — and ordinary work where
the kit claims no advantage. Excluding either kind would structurally favor one arm.
Concrete task texts are written in `TASKS/` before the first trial; the slots are fixed
here.

### Research (R1–R4)

- **R1 — consequential external facts.** Recommend a vendor/plan for a stated workload
  where pricing, rate limits and ToS decide the answer; ground truth is the vendors'
  own pages on the trial date.
- **R2 — paid collection under budget.** A research question whose sources require
  metered collection; the budget is set so careless collection exhausts it.
- **R3 — contradictory sources.** A question where authoritative sources disagree; the
  expected outcome records both and says which is trusted and why, not an average.
- **R4 — interruption mid-task.** The session is killed at a scripted midpoint; a fresh
  session must resume. Scored on what survived and whether work was redone or paid for
  twice.

### Coding (C1–C4)

- **C1 — API-dependent implementation.** A small feature whose correctness depends on a
  current external API's actual behavior/limits (the facts must be looked up, not
  recalled).
- **C2 — local bug fix, no new external facts.** The kit's claimed weak spot; included
  so overhead is measured where the kit promises nothing.
- **C3 — tests-pass-but-wrong trap.** A task with a provided initial test suite that a
  plausible wrong implementation passes; graded against an expanded hidden suite (U-3).
- **C4 — cross-machine handoff.** Agent 1 researches and designs on machine 1; agent 2
  implements on machine 2 from whatever agent 1 left behind. Scored on whether agent 2
  needed to re-research or guess.

### Writing (W1–W4)

- **W1 — factual brief with citations.** A short decision memo where every load-bearing
  claim must cite a source that actually supports it (U-2).
- **W2 — revision without new claims.** Edit an existing factual document for clarity;
  scored on whether edits introduced unsupported claims.
- **W3 — uncertainty preservation.** Summarize a body of evidence containing known
  unknowns and one contradiction; scored on whether the summary retains them or
  silently resolves them.
- **W4 — handoff brief.** Produce a handoff another agent then acts on; scored on the
  second agent's outcome, not the brief's tidiness.

## Outcomes and grading

Scored on the **actual final environment state as well as the transcript**, with
repeated trials and graders calibrated per task type (U-1). Per trial:

| Outcome | Measured as |
|---|---|
| Unsupported claims | Load-bearing claims whose cited (or saved) source does not support them, under the U-2 definition; counted by a grader reading claim against source |
| Implementation defects | Defects reaching the final state, including those passing the task's initial tests (U-3 definition); detected by expanded/hidden tests and grader review |
| Truthful reporting | Each reported claim labeled verified / untested / expected checked against the transcript and final state; a "verified" that was not run counts as a truthfulness failure |
| Successful handoffs | For R4, C4, W4: did the receiving agent/session complete without re-research, guessing, or lost material? Lost captures/notes and incomplete transfers are counted |
| Review effort | Grader minutes to confirm or refute the work product |
| Time | Wall-clock per trial |
| Cost | Tokens plus metered collection spend per trial |

Grading rules, fixed now:

- Expected outcome and rubric per task are committed in `TASKS/` **before any run**.
- Graders see the arm label only after scoring (blind-first).
- A task-arm pair's trials are scored by the same rubric version; rubric versions are
  immutable once a trial has used them.
- Tidier documents, more captures, greener protocol checks are **not** outcomes.
- Every result is reported with the status vocabulary: verified (run and seen),
  untested (written, not run), expected (reasoned, not run).

## Cited definitions (filled 2026-10-06, before any trial)

The terms marked (U-1)..(U-4) above take these operational definitions from the rows in
`EVIDENCE.md` that closed the unknowns. The structure above is unchanged; this section
is the fill-in the frozen draft reserved for itself.

| Term | Definition used by every rubric | Evidence |
|---|---|---|
| Outcome; trials; grader calibration (U-1) | The outcome is the final environment state at the end of the trial, scored apart from the transcript. Three trials per arm per task; per-trial values and the per-arm mean are reported, and pass^3 for the binary outcomes (handoff, truthful reporting). Model graders are calibrated against a human spot-check per task type before scoring; a task whose expected outcome two readers would not agree on is fixed before use. | E-01, E-03 |
| Unsupported claim (U-2) | Unit: the sentence. A verification-worthy sentence is unsupported when a generic reader, given its cited or saved sources, would not affirm it (citation recall). A citation that does not support its own sentence is a citation-precision failure and is counted too. | E-04, E-01 |
| Implementation defect (U-3) | A program that passes the task's provided tests and fails the expanded hidden suite written from the same specification, or whose root cause is not fixed on grader review (a patch that makes tests pass without fixing the bug). C3's reference solution must pass the hidden suite before the first trial. | E-05, E-02, E-01 |
| Matched arms and budget (U-4) | Same model and version, tool set, task set and trial count per arm. The per-trial budget (tokens, metered credits, wall-clock) is enforced during the trial, not totalled after it. Cost is reported in money and tokens, never a proxy. | E-06, E-07, E-03 |

## Pre-registered simplification criteria (decision 4)

Fixed now, per mechanism, so the post-hoc decision cannot be fitted to the results.
"Meaningful" means: observed in more than one trial, not explained by a single outlier,
and large enough that a reviewer reading the trial record would call it a difference in
kind, not noise — the pilot is exploratory, so these are decision rules for the owner's
keep/simplify/drop ADRs, not significance tests.

| Mechanism | Keep if the trials show | Drop or reduce if |
|---|---|---|
| Collector (caching, capture, plan/budget) | Arm B meaningfully more often loses source material, double-pays for collection, or exhausts the budget (R2, R4) | Arm B's saved pages and notes serve review and resumption equally well at lower overhead |
| Ledger integrity (hash chain, tamper evidence) | A real trial event where an unverifiable or altered corpus would have gone unnoticed in Arm B, or graders meaningfully faster verifying Arm A provenance | No trial where integrity checking changed an outcome or review conclusion, and no review-effort advantage |
| Handoff check (`handoff.mjs`, brief) | Arm A's receiving agents meaningfully more often proceed without re-research or guessing (R4, C4, W4), or transfer losses detected in Arm A that Arm B silently suffered | Receiving agents fare equally well from Arm B's ordinary files |
| Commit hook (gate) | Arm A meaningfully fewer premature commits / unsupported-claim commits than Arm B's instructed-to-wait discipline | Instruction alone prevents premature commits equally; or the hook's overhead (blocked legitimate work, overrides taken) exceeds its catches |

Each resulting keep/simplify/drop is recorded as its own ADR confirming or superseding
the prior decisions for that mechanism (ADR-0145, Trigger to revisit).

## Execution order (step 4 of the plan — not yet run)

1. Close U-1..U-4 on the collector machine (`research.mjs --plan research/plan.json`),
   fill the cited definitions above, pass this project's preflight.
2. Write the twelve concrete task texts, expected outcomes and rubrics into `TASKS/`,
   and the verbatim Arm B prompt into `PROMPT-ARM-B.md`; commit before any trial.
3. Run the trials, retaining artifacts and transcripts under this project
   (`results/`, transcripts included; captures through the normal pipeline).
4. Score blind-first, report with status words, write the closing decision document,
   record each mechanism's outcome as an ADR, and flip this project's row in
   `../..`/README.md from `pending` to the status matching what it then backs.

Nothing in this protocol adds a command, check, judge or format to the kit; ADR-0117's
freeze and ADR-0089's semantic boundary remain in force throughout.
