# Discovery Contract - Quote-anchored claims: how research tools verify quotations against cited sources, Unicode normalization for matching quoted text

Started 2026-09-28. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

The kit proves a cited page was fetched and not edited; it cannot tell whether a claim reads
that page correctly. A small, deterministic part of that gap can be closed: a claim may
carry a verbatim quote of its page, and the gate checks the quote is really there. Done
means the kit knows how others verify quotes, how to normalize text for matching, and what
the marker, threshold and severity should be - without the gate ever judging prose.

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
| U-01 | Is a fabricated or misplaced quote a real failure, not a hypothetical? | Worth a gate check only if it happens. | CLOSED | E-01, E-04: six of six fabricated quotes in one real report; working, relevant citations support their claim only 24-77% of the time. |
| U-02 | How do existing tools verify a quote against its source? | The match rule decides false positives and false negatives. | CLOSED | E-02, E-03, E-04: normalized (whitespace, case) substring, a fuzzy fallback at 0.92 in one, verbatim proof sentences in the other; short quotes skipped as false-positive prone. |
| U-03 | Which Unicode normalization suits matching quoted text? | Captures and hand-typed quotes differ in ligatures, widths and quote marks. | CLOSED | E-05, E-06: NFKC, built into Node; it removes formatting distinctions, so it is for comparison only. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- No gate judges prose (AGENTS.md, the standing protocol). The check may only ask whether a string occurs in a capture.
