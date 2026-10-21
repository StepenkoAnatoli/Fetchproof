# Brief - Fetchproof's reliability promise

_Auto-drafted 2026-10-05, then reviewed and condensed by the agent._

Reviewed by: agent

**Research gate: PASS under pluralist policy, with five corroboration warnings.**
This verifies the research artifacts against the configured checks. It does not establish
that the kit reduces coding errors or that a semantic judgment is correct. Local audit
and reproduction: [AUDIT.md](../AUDIT.md). Source claims and captures: [EVIDENCE.md](EVIDENCE.md).

## Intent

Help the owner reconnect the kit with its original goal: fewer unsupported claims and
mistakes in research, coding and writing, with accurate public promises. This handoff
is a recommendation for choosing the next task; no new mechanism or product code has
been implemented.

## What we verified

Local execution: root preflight still passed after an in-memory Finding was replaced
with an invented claim. Both runs had 28 passing findings, one warning and zero failures.
No disk evidence was changed. Current code explicitly leaves factual support uncomputed;
review completion and provenance checks do not prove correct interpretation.

| Source | Bounded finding |
|---|---|
| [E-01, citation study](https://arxiv.org/abs/2304.09848) | Historical 2023 systems had citations that did not support their associated statements. Presence and support are separate. |
| [E-02, EvalPlus](https://arxiv.org/html/2305.01210v3) | Expanded tests caught wrong generated benchmark functions that passed the original suite. Finite tests still have limits. |
| [E-03, self-correction](https://arxiv.org/html/2310.01798v2) | Intrinsic review struggled on tested reasoning tasks without external feedback. This is not a finding about all review or current models. |
| [E-04, CoVe](https://arxiv.org/html/2309.11495v2) | Separately answered verification questions reduced factual hallucinations in its tested tasks, without eliminating them. |
| [E-05, evaluation incentives](https://openai.com/index/why-language-models-hallucinate/) | Useful accuracy, wrong answers and abstention must be distinguished; similar accuracy can hide very different error. |
| [E-06, agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | Score actual environment outcomes as well as transcripts; repeat trials and calibrate appropriate graders. Guidance is not proof of kit impact. |

## Contradictions and how they were resolved

E-03 and E-04 concern different tasks and mechanisms: intrinsic reasoning review versus
independently answered factual verification. They do not justify either universal failure
or universal success of self-review. Citation and test presence are useful observations,
but insufficient to establish the stronger conclusions the user wants.

All five corroboration warnings remain visible: U-1, U-2, U-4 and U-5 have one cited
source each; U-3 has two papers hosted on arxiv.org, which the site-based check counts
as one voice. Original studies are primary for their own results, not independent proof
of a universal intervention. No source multiplication was used to clear these warnings.

## Known unknowns

The five external questions are closed within their stated scopes. The size of any
kit-caused reduction in unsupported claims or downstream defects remains **unmeasured**.
Day-one step: freeze a small matched evaluation with expected outcomes and a grading
rubric, then run the same tasks with and without the kit and retain artifacts/transcripts.
No controlled comparison or full offline suite was run in this documentation task.

## Decision

**Recommendation for the owner:** retain the focused research tool and add a short shared
work discipline before expanding its runtime. Important claims/behaviors should have an
appropriate observation, a check capable of challenging them, and a report naming what
was verified, inferred and still unknown. Research checks source support; code checks
specified behavior; writing checks factual wording and whether edits added unsupported
claims. A dependent decision stops for a load-bearing gap; useful independent work continues.

Immediate existing-behavior fixes: make the About wording match enforcement scope;
correct the brief's claim that PASS always means every unknown is closed; preserve actual
warnings and uncertainty in consumer outputs. Reconfirm and test each exact defect before
implementation. These are documentation/bug-fix work under ADR-0117. No new judge, check,
command or scope change is authorized by this recommendation; ADR-0089 remains in force.

## Next steps

**First builder task:** correct existing brief certainty wording and warning preservation,
with focused output regression checks and the architecture-map update required by the
standing protocol. Keep that one independently revertible task.

Next, compare the current kit with a baseline on twelve realistic tasks, four per domain,
with matched settings/budgets and several trials per arm. Evaluate the proposed discipline
as a separate later variant. Track useful completion, unsupported/confident errors, acceptance
failures, truthful reporting, appropriate uncertainty, unnecessary blocking and cost
separately. Treat the pilot as exploratory; make outcome claims only within what its
results support. Detailed cases and grading limits are in AUDIT.md.
<!-- fetchproof:brief-draft body=dc9ac376cb883895 inputs=4e1357f3d5796359 gate=pass -->
