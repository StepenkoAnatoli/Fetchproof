# Study protocol - does the quote-level refresh recheck earn its place? (frozen before any trial)

Design: plan v0.4 section 12 (`fetchproof-reasoning-layer-plan-2.md`, owner-approved
2026-10-25), requirement R-09 and Mandate row C5 of run
`docs/orchestration/2026-10-25-quote-level-refresh/`. Status: **frozen draft**, written
2026-10-25 before any task text, fixture, hidden suite or trial exists. Section 13 maps every
line of plan section 12 to the section here that fixes it. Paths that start with `docs/` are
from the repository root; `TASKS/`, `hidden/`, `impact/` and `results/` are folders of this
project, written before trial 1 (section 12) or by the trials.

## 0. Status and the one amendment path

Everything below is fixed now, so a later result cannot move it. One amendment path exists,
copied from ADR-0145's protocol: **before trial 1**, a defect found while closing U-1/U-2 or
while writing the task texts, fixtures or hidden suites may be corrected in a commit that
names the defect. A change to a decision rule (section 9) also needs the owner's ruling,
quoted in that commit, because the rules come from the owner-approved plan. **From trial 1
on, this file is immutable**; a defect found then is recorded beside the results, and the
results are scored under the text as frozen.

## 1. Question

On a re-collection, does quote-level recheck (ADR-0193, plan section 7) spare unchanged work
without missing changed facts, and does it change what ships?

## 2. Arms

Matched in everything but the refresh rule (section 3).

- **Arm A - today's kit.** Every refresh of a cited row reopens its unknown
  (`cites-superseded-row`, ADR-0026), and a refresh answered 404 leaves the gate as it is
  today (plan section 7.5, test 14). Built as the arm-B tree with exactly the ADR-0193 and
  ADR-0194 commits reverted and nothing else (AGENTS.md protocol rule 4, the revert test).
- **Arm B - the kit with section 7 (ADR-0193) and section 8 (ADR-0194).** A cited row whose
  every usable quote is found in the replacement capture passes `quote-survived-refresh`; a
  cited page whose latest ledger entry after the row's scrape is a 404/410 fails
  `cites-gone-page`.
- **Arm C (optional) - ADR-0145's strong-prompt arm.** Its arm-B prompt, verbatim from the
  `PROMPT-ARM-B.md` that `docs/decisions/2026-10-06-kit-vs-prompt-evaluation/` commits before
  its first trial, with the same model, tools and budget and no kit, run on this study's six
  tasks. ADR-0145's comparison is not re-run here.
  - **Condition, checked once, when trial 1 starts:** arm C joins only if that project then
    holds committed results for every trial its protocol fixes and a committed
    `PROMPT-ARM-B.md`. The check and its answer are the first line of the trial log. If the
    answer is no, arm C stays out for the whole study; it is never added later.
  - **State on 2026-10-25 (at `8c63e77`): not available.** That project holds no
    `PROMPT-ARM-B.md`, no `TASKS/` and no `results/`; its execution order says "not yet
    run"; its index row in `docs/decisions/README.md` is `pending`.
  - In arm C, a "reopen" is the agent's own, and kind 3 is a plain re-fetch of an unchanged
    page, because the arm has no kit transport to switch.

## 3. Matched settings, harness and trial count

- **Same in every arm, per trial:** model and version; harness and tool set (shell, files,
  tests); task texts; fixture pages; the midpoint event and the refresh message (section 4);
  the per-trial budget of tokens and wall-clock, enforced during the trial, never totalled
  after it (ADR-0145 protocol, "Cited definitions", row U-4). Model and harness credentials
  are logistics recorded in the trial log, not research facts.
- **Offline.** Task pages come only from a local fixture server on loopback. The trial
  machine reaches the model API and that server, nothing else. Both kit arms collect with
  the keyless transports (`http-keyless`, `browser`); U-2 holds why Firecrawl is not used.
- **The kit per arm.** The commit of each arm's kit tree is recorded in the trial log
  (`results/TRIAL-LOG.md`) before trial 1, and the installed kit's commit is recorded at
  the start of every trial.
- **Trials: 3 per arm per task**, 18 per arm (36 for A and B, 54 with C), the count
  ADR-0145's pilot uses. Trials run in one fixed, interleaved order (T1-A, T1-B, [T1-C],
  T2-A, ... round by round), written in the trial log before trial 1, so drift in the model
  service over time does not line up with an arm.
- **A trial that faults** (harness, fixture server or infrastructure, never the agent's own
  budget exhaustion, which is an outcome) is re-run once; both runs are logged. If the
  re-run also faults, the trial is **not completed**: listed by id, left out of the
  denominators, and every number in section 6 prints completed / planned trials beside it.
  The task count never shrinks: a task keeps its slot and its row in every table even with
  no completed trial.

## 4. Tasks and the five page-change kinds

Six coding tasks against **synthetic vendor APIs**, documented by **synthetic fixture pages**
written for this study (not Testimonium's) and served by the local fixture server. Each task
has one mid-project page change of one of the five kinds of plan section 12:

| Slot | Kind | The page change at the midpoint | Fact afterwards |
|---|---|---|---|
| T1 | 1 - a quoted fact changes | a quoted numeric fact changes, e.g. 10/min becomes 5/min | changed |
| T2 | 1 - a quoted fact changes | a quoted non-numeric fact changes (a renamed parameter, header or endpoint); its class is named from U-1's paper only if U-1 is closed | changed |
| T3 | 2 - a cosmetic refetch with the quote unchanged | markup, navigation and text around the quote change; the quoted sentence and the fact do not | unchanged |
| T4 | 3 - a transport switch only | the server sends the same bytes; the re-collection runs on the other keyless transport (`http-keyless` and `browser`, in the order the task text fixes) | unchanged |
| T5 | 4 - the page is deleted (404) | the cited page answers 404; what the vendor now says to use is on a page the fixture serves after the change | changed |
| T6 | 5 - **E6: the quote survives under a new scope heading** | the quoted sentence stays word for word, now under a new "Enterprise only" heading, so it no longer holds for the plan the task targets | changed |

Kind 1 takes the sixth slot because it is the plain changed-fact case: two independent
kind-1 tasks give a recheck that misses a changed fact two chances to show it under the safety
rule (section 9, DR-1(b)).
No slot may change kind after this commit.

Each task text, `TASKS/T<n>.md`, written and committed before trial 1, fixes: the vendor
and its API; the coding goal; the provided tests; both fixture states of every page;
**the numbered list of decisions that rest on the changing page** (D-T<n>-1, ...), each
naming the hidden tests that judge it; the midpoint event; the refresh message; the budget.

- **Midpoint event:** the first commit containing code in the task project, or half the
  wall-clock budget, whichever comes first. The harness then switches the changing page to
  its second state (and, for T4, the kit's transport) and sends the refresh message.
- **Refresh message:** one text per task, the same in every arm, telling the agent that the
  vendor's documentation may have been updated and to re-collect every page its work rests
  on before it ships.
- **Ships:** the trial's final state when the agent declares it done or the budget ends -
  its last commit, or its working tree where it never committed.

## 5. The scoring unit: a decision, reopened or left alone

The unit is a decision listed in the task text (section 4), never one counted from the
agent's own corpus, so the denominators do not depend on how an agent structured its work.

- **Reopened:** after the refresh and before ship, the trial record shows the decision put
  back into question for the post-change page (or its absence): its unknown reopened and
  re-closed, its citation re-made, or the decision re-researched by the agent, whether a
  gate failure prompted it or not. A gate failure the trial ignored or overrode is not a
  reopen. The grader records which prompted it (gate, agent, both).
- **Left alone:** not reopened.

## 6. Measures

Per arm, as counts over the denominators below, then per task and per kind.

1. **Caught** = R / N. N: the listed decisions of T1, T2, T5 and T6 (kinds 1, 4, 5) summed
   over that arm's completed trials of those tasks. R: those reopened before ship.
2. **Spared** = S / M. M: the listed decisions of T3 and T4 (kinds 2, 3) summed over that
   arm's completed trials of those tasks. S: those left alone **and** whose shipped code
   passes the decision's hidden tests (left alone correctly).
   **False-block rate** = 1 - spared, reported together with U, the count of gate blocks
   in that arm's trials (any task) that a grader rules unnecessary: a block whose
   resolution changed nothing shipped and that rests on no changed fact. The two are
   printed as a pair, "(1 - S/M) and U unnecessary blocks", never summed into one number,
   because U has no denominator of its own.
3. **Confident-wrong** = W / K. K: that arm's completed trials of T1, T2, T5 and T6. W:
   those whose shipped code fails a hidden test on the changed fact **and** whose final
   report labels that decision, or the fact it rests on, "verified" (ADR-0145 protocol,
   "Outcomes and grading", row "Truthful reporting"). Kind 5 (T6) is always also printed
   alone.
4. **Review time:** grader minutes per trial to confirm or refute the work product, timed
   in the blind first pass (section 7).
5. **Cost:** tokens (input and output), fetch credits (expected 0, U-2) and wall-clock, per
   trial.
6. **Impact accuracy** (the decision-to-code report of plan section 11, a study instrument,
   not a kit feature). A mapping keeper - neither the trial's agent nor its grader - keeps a
   decision-to-files mapping for each trial from its code at the midpoint, in
   `impact/<trial>/`, timing every minute spent on it; a script under this project lists
   the mapped files for each reopened decision. For each reopen: the listed files against
   the files that had to change - the files the shipped code changed after the refresh
   where the hidden tests on the changed fact pass, else the files the grader's minimal fix
   touches - as listed / needed / both. **Minutes saved:** graders confirm each reopen's
   impact with the report in odd-numbered trials of the sequence and without it in even
   ones; saved = (median minutes per reopen without - median with) x the number of
   reopens.

Also reported, deciding nothing here: the number of tasks in which arm B shipped a decision
resting on a changed fact that the unknown-level recheck did not reopen (the reopen trigger
of plan section 11 for `REASONING.md`, at least 2 tasks).

## 7. Independent scoring

**Scores never come from Fetchproof's gate.** A gate verdict is part of the trial record a
grader reads; it is never itself a score, and a gate pass is not evidence that a decision
is right.

- **Hidden suites** are run by the study operator after each trial, outside the trial
  environment (section 8).
- **Pass 1, blind:** the grader gets the shipped code, the final report and the hidden-suite
  results, with the arm label and gate output removed. It scores the hidden-suite outcome
  per decision and the "verified" labels (confident-wrong), and is timed (review time).
- **Pass 2, the record:** the grader reads the transcript and the corpus to score reopened
  or left alone per decision, and unnecessary blocks. The arm shows here (arm C has no kit;
  `quote-survived-refresh` names arm B): a stated limit of the design, not hidden.
- **Calibration** follows ADR-0145's protocol ("Cited definitions", row U-1): a human
  spot-check per task type before scoring. A second grader scores pass 2 of every third
  trial in sequence order; both scores and the agreement rate are reported, and the first
  grader's score is the one counted.

## 8. Hidden suites - none written by this pre-registration

| Task | Kind | Written from | Location | Status |
|---|---|---|---|---|
| T1 | 1 | the changed numeric fact on the post-change page | `hidden/T1/` | to write before trial 1 |
| T2 | 1 | the changed non-numeric fact on the post-change page | `hidden/T2/` | to write before trial 1 |
| T3 | 2 | the unchanged fact as the post-change page states it | `hidden/T3/` | to write before trial 1 |
| T4 | 3 | the unchanged fact as the page states it | `hidden/T4/` | to write before trial 1 |
| T5 | 4 | the replacement fact the post-change fixture states | `hidden/T5/` | to write before trial 1 |
| T6 | 5 | the fact as the new scope heading limits it | `hidden/T6/` | to write before trial 1 |

- **Blind author.** Each suite is written by someone who has seen no run of this study: no
  transcript, artifact or result of any trial in any arm. The author may read the task text
  and both fixture states, and records in `hidden/T<n>/AUTHOR.md` who wrote it, when, and
  that they had seen no run. No builder of run 2026-10-25-quote-level-refresh qualifies
  for this, which is why none is written here (Mandate C5).
- **Committed before trial 1**, in a commit that names the suites it freezes. Trial
  environments never hold a copy of this project, `hidden/` and this protocol included.
- **The defect definition** is ADR-0145's U-3 ("Cited definitions", row "Implementation
  defect (U-3)"): a program that passes the task's provided tests and fails the hidden suite
  is a defect. Before trial 1, each task's reference solution for the post-change fact
  passes its suite, and for T1, T2, T5 and T6 a reference solution built on the pre-change
  fact fails it - otherwise the suite cannot see the stale fact. Both results go in the
  commit that freezes the suite.
- From trial 1 on, a suite is immutable; a defect found later is recorded beside the
  results.

## 9. Decision rules, fixed now

- **DR-1. Keep ADR-0193 only if both hold:**
  - **(a)** B's spared is meaningfully higher than A's (DR-5); and
  - **(b) safety:** on every changed-fact task (T1, T2, T5, T6), B's caught share on that
    task is not lower than A's. One task where it is lower - A caught and B did not - is a
    **safety failure**: the recheck is switched off, by an ADR, until the miss is explained
    in writing and fresh trials of that task, under this protocol, show B not lower.
    "Meaningful" does not soften (b): one trial's difference is enough. (b) can only be
    met if each of the four tasks has at least one completed trial in both arms; if one
    does not, DR-1's answer is "not decided", never "keep".
  - **Flagged for the owner before trial 1 (not resolved here):** plan section 12 lists
    kind 5 among the changed facts, so (b) applies to T6. By construction arm B's gate
    passes T6's surviving quote (plan section 7.5, test 15, a KNOWN GAP), so on T6, (b)
    turns on whether arm B's agents reopen it on their own. This protocol keeps the plan's
    rule as written; exempting T6 would change section 12, and is the owner's to rule
    through section 0, before trial 1.
- **DR-2. Report the E6 cost separately.** Kind 5's caught and confident-wrong are printed
  per arm whatever DR-1 decides. If B's confident-wrong on T6 is higher than A's, the kit's
  README (`fetchproof/README.md`, where it describes the recheck) states it as the price of
  sparing, with both numbers (W/K for each arm on T6).
- **DR-3. Keep ADR-0194** if B's caught share on T5 (kind 4) is higher than A's. This is
  expected by construction, and is confirmed rather than assumed: if it does not hold, the
  closing record says ADR-0194 was not confirmed, with the numbers, and its fate is the
  owner's call in its own ADR; plan section 12 sets no drop rule for it, and none is added.
- **DR-4. Drop the impact report** if the total mapping minutes exceed the total review
  minutes it saves (section 6, measure 6).
- **DR-5. "Meaningful"** is ADR-0145's definition (its protocol, "Pre-registered
  simplification criteria (decision 4)"): "observed in more than one trial, not explained
  by a single outlier, and large enough that a reviewer reading the trial record would call
  it a difference in kind, not noise". Read operationally for DR-1(a): B's spared exceeds
  A's; B spared decisions in more than one trial; the difference survives removing any one
  completed trial from either arm; and the grader writing the closing record calls it a
  difference in kind, in one sentence that says why.
- **DR-6. Ceremony.** If the recheck does not beat "reopen everything" on spared without
  losing on caught - DR-1 answered no for either part (a 'not decided' DR-1 is not ceremony) - the closing record says that it is
  ceremony on this evidence, in those words.

## 10. Reporting

- Every number is "count / denominator (share)", per arm, then per task and per kind, with
  completed / planned trials beside it and every not-completed trial listed.
- Every result carries a status word: verified (run, and the result seen), untested
  (written, not run), expected (reasoned, not run).
- The closing record states that the numbers come from synthetic fixtures, and names the
  real quoted refreshes on record at that date (on 2026-10-25, one:
  `docs/decisions/2026-10-25-first-quoted-refresh/`).
- Trial artifacts, transcripts and scores go under `results/`; the closing record and one
  ADR per DR outcome follow, and this project's index row changes status with what it then
  backs (ADR-0102).

## 11. Relation to ADR-0145's protocol

This project **does not amend** `docs/decisions/2026-10-06-kit-vs-prompt-evaluation/research/PROTOCOL.md`.
That protocol allows one amendment only: a rubric defect, corrected before its first trial.
A new study is not a rubric defect, so adding one to it would break its own rule. This
protocol cites four of its parts by path and section, as they stand at commit `8c63e77`:
"Cited definitions" rows U-1 (calibration), U-3 (implementation defect) and U-4 (matched
budget); "Outcomes and grading", row "Truthful reporting"; and "Pre-registered
simplification criteria (decision 4)" ("meaningful"). Nothing is copied into that project.

## 12. Before trial 1 (execution order)

1. Close U-1 on the collector machine, or leave it KNOWN-UNKNOWN and keep the paper out of
   the task texts; run U-2's trial-0 smoke and paste its ledger lines into the trial log.
   This project's own preflight passes.
2. Record the arm-A and arm-B kit commits, once ADR-0193 and ADR-0194 have landed.
3. Write `TASKS/T1.md`..`TASKS/T6.md`, the fixture pages in both states, the fixture server,
   the trial sequence and the impact-report script.
4. Have a blind author write `hidden/T1/`..`hidden/T6/`, with the reference-solution checks
   of section 8.
5. Commit steps 2-4 before trial 1, each commit naming what it freezes.
6. At trial 1, check arm C's condition and record the answer; then run the sequence.
7. Score (section 7), report (section 10), apply the decision rules (section 9).

## 13. Traceability to plan section 12

| Plan section 12 line | Fixed in |
|---|---|
| Question: spare unchanged work without missing changed facts; does it change what ships | 1; 6.1-6.3 |
| Arms matched in everything but the refresh rule: same model, harness, budget, tasks, several trials | 2; 3 (3 trials per arm per task, enforced budget, fixed order) |
| A: today's kit, every refresh reopens (ADR-0026) | 2, arm A |
| B: the kit with sections 7 and 8 | 2, arm B |
| C optional: only if ADR-0145's comparison has run its trials; its arm-B prompt verbatim; not re-run here | 2, arm C (condition, checked at trial 1; state on 2026-10-25: not available) |
| Six coding tasks against vendor APIs; local fixture server; offline; synthetic pages, not Testimonium's | 3 (offline); 4; DISCOVERY.md U-2 |
| Kinds 1-5, kind 5 "E6: the quote survives under a new scope heading" | 4 (T1-T6) |
| Task material may draw on "When LLMs Lag Behind" | 4 (T2); DISCOVERY.md U-1 (KNOWN-UNKNOWN, collect before trial 1) |
| Caught: share of decisions on a changed fact (kinds 1, 4, 5) reopened before ship | 5; 6.1 (R / N) |
| Spared: share of decisions on an unchanged fact (kinds 2, 3) correctly left alone; false-block rate = 1 - spared, plus unnecessary gate blocks | 5; 6.2 (S / M, with U) |
| Confident-wrong: share of trials shipping code on the stale fact while reporting it "verified" | 6.3 (W / K) |
| Scores never come from Fetchproof's gate | 7 |
| Hidden suite per task, from the changed fact, by someone who saw no run, committed before trial 1, U-3 definition | 8 |
| Confident-wrong = hidden-test failure on the changed fact + "verified" (truthful-reporting rule) | 6.3; 7, pass 1 |
| Review time: grader minutes, blind-first | 6.4; 7, pass 1 |
| Cost: tokens, fetch credits, wall-clock | 6.5 |
| Impact accuracy, and the minutes spent keeping the mapping | 6.6 |
| Pre-registration: own nested project (ADR-0030), indexed (ADR-0102), protocol, suites and rules committed before trial 1 | this project; 0; 8; 12 |
| Does not amend ADR-0145's PROTOCOL.md (rubric defects only, before its first trial) | 11 |
| Keep ADR-0193 only if spared meaningfully higher and caught not lower on any changed-fact task; one such task is a safety failure, recheck switched off | 9, DR-1 |
| Report the E6 cost separately; README states it if B's kind-5 confident-wrong is higher | 9, DR-2 |
| Keep ADR-0194 if B catches kind 4 where A does not; confirmed, not assumed | 9, DR-3 |
| Drop the impact report if mapping minutes exceed the review minutes it saves | 9, DR-4 |
| "Meaningful" follows PROTOCOL.md | 9, DR-5 |
| Not beating reopen-everything on spared without losing on caught is ceremony, and the study says so | 9, DR-6 |

Nothing in this protocol adds a command, check, judge or format to the kit; ADR-0117's
freeze and ADR-0089's semantic boundary stay in force throughout.
