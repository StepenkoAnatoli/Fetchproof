# Discovery Contract - Measuring Fetchproof: citation accuracy metrics from deep research benchmarks

Started 2026-09-28. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

The kit's effectiveness has never been measured. Benchmarks for deep-research agents score
citations; the kit can compute the parts of those scores that need no judge over its own
corpora, and say plainly which part needs one. Done means the metric definitions are
known and a `measure.mjs` report can be built from them.

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
| U-01 | How do deep-research benchmarks score citation accuracy? | The kit's measure should mean what theirs means. | CLOSED | E-01, E-02: a judge extracts statement-URL pairs and rules each supported or not; Citation Accuracy is the supported share. |
| U-02 | Which parts of a citation score need no judge? | Those the kit can compute deterministically; the rest must be labelled. | CLOSED | E-03, E-02: Link Works needs no LLM; Relevant Content and Fact Check do. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- A measurement reports; it never gates. No check judges prose.
