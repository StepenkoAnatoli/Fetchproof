# Discovery Contract - Does the kit measurably beat a strongly prompted agent with the same tools and budget?

Started 2026-10-06. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

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
| U-1 | What outcome definitions and scoring practices does current agent-evaluation guidance prescribe for distinguishing a reported success from the actual final environment state, and for repeated trials and grader calibration? | The rubrics must be grounded in published guidance before they are frozen; guessing produces graders the results cannot be trusted on. | CLOSED | E-01, E-03 |
| U-2 | How do published benchmarks define and count an unsupported claim (citation present but not supporting the statement), so the metric is comparable rather than invented? | "Unsupported claims" is the primary outcome; a home-made definition would make the pilot incomparable with anything. | CLOSED | E-04, E-01 |
| U-3 | How do code-generation evaluations define and detect an implementation defect that passes an initial test suite, so the defect metric does not equate tests-pass with correct? | Implementation defects are a primary outcome and the known failure mode is tests that pass over wrong code. | CLOSED | E-05, E-02, E-01 |
| U-4 | What matched-budget / matched-tooling comparison designs are used for agent ablations, and what do they control for (model, tools, token/cost budget, trial count)? | The arms must be matched in everything but the workflow; an unmatched confounder invalidates the comparison. | CLOSED | E-06, E-07, E-03 |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The design is ADR-0145: two matched arms (kit workflow vs. strong prompt with ordinary
  files), twelve tasks — four per domain (research, coding, writing) — including paid
  collection, an interruption mid-task, and a cross-machine handoff; none excluded.
- The protocol and per-task rubrics (`research/PROTOCOL.md`) are frozen and committed
  before the first trial; results do not bend the criteria.
- Simplification criteria per mechanism are pre-registered in the protocol; after the
  results each mechanism is kept, simplified, or dropped, each outcome its own ADR.
- Outcomes measured: unsupported claims, implementation defects, truthful reporting,
  successful handoffs, review effort, time, cost — on actual environment outcomes plus
  transcripts. Document tidiness is not an outcome.
- The pilot is exploratory; outcome claims stay within what the sample supports.
- No new command, format, judge or runtime check; ADR-0089 and ADR-0117 remain in force.
- Related but not substitutable evidence: the agent-reliability corpus
  (`../2026-10-05-agent-reliability/`) closed the general literature questions; this
  project collects its own captures for the facts its rubrics rest on.
