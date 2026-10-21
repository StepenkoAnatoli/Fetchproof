# Discovery Contract - How can Fetchproof reduce unsupported claims and coding mistakes while accurately stating its guarantees?

Started 2026-10-05. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Help the owner understand how Fetchproof can better serve its original purpose:
reducing unsupported claims and mistakes in agent research, coding and writing, while
accurately describing its guarantees. This phase produces a source-backed recommendation
and a local audit, not product code or a new gate. Done means the five external questions
below are answered with fetched primary sources and bounded conclusions, the current
guarantees are compared with implementation evidence, and BRIEF.md names the smallest
useful next steps and the unmeasured outcome. Any behavioral change remains subject to
the feature freeze and the builder's separate implementation task.

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | Does citation presence establish that the associated claim is supported, and what do measured generative search results show? (D-6, D-10) | Recommending more collection alone would miss a semantic-support gap; historical results must not become a claimed current error rate. | CLOSED | E-01: historical human audit separates citation presence from support; 51.5% sentence support and 74.5% citation support are scoped to its four systems. |
| U-2 | Can apparently successful code tests miss incorrect generated programs, and what does stronger testing change in a measured setting? (D-6, D-11) | A recommendation that equates tests passing with correctness would repeat the problem. | CLOSED | E-02: expanded tests found incorrect generated benchmark functions that passed the original suite; no general correctness guarantee follows. |
| U-3 | What are the measured limits of intrinsic self-correction, and can independent verification help in a different setting? (D-6, D-12) | More review agents or self-critique must not be sold as a truth guarantee; apparently conflicting results need scope. | CLOSED | E-03 and E-04: intrinsic reasoning review struggled; separately answered factual verification helped but retained errors. Different domains, models and methods prevent a universal claim. |
| U-4 | Why must wrong answers, abstention and useful accuracy be measured separately? (D-6, D-13) | A workflow that blocks all work can look honest while failing its purpose. | CLOSED | E-05: similar accuracy can coexist with sharply different error and abstention rates; this is an evaluation rationale, not evidence that this kit improves them. |
| U-5 | How should an agent evaluation distinguish a reported success from the actual final outcome and control its graders? (D-9, D-14) | The mission cannot be substantiated by counts of captures or green protocol tests alone. | CLOSED | E-06: score the actual final state as well as the transcript, repeat trials and calibrate task-appropriate graders. Guidance, not controlled kit evidence. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

None. The owner specified the goal; this task explains and recommends without selecting
or implementing a new architecture.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- Keep the root vendor/transport corpus intact (ADR-0030); retain this project and index it (ADR-0102).
- Six Firecrawl scrapes maximum, direct URLs, no --fallback and no new provider.
- No claim that this kit has already reduced errors; no controlled comparison exists in this audit.
- No new command, format, judge or runtime check; ADR-0089 and ADR-0117 remain in force.
- Local source inspection and execution are recorded as local observations in AUDIT.md, never forged fetched evidence.
