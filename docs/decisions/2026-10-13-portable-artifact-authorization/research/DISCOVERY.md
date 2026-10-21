# Discovery Contract - How should portable artifact authorization be derived without consumer policy and while preserving historical brief stamps?

Started 2026-10-13. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Fix issue #357 by re-deriving claimed artifact approval from its materialized corpus using
the producer's review rules and an unpromoted portable gate baseline. Consumer machine
policy, hooks and credentials must not affect the result. Preserve a declared false
authorization and settle compatibility for unstamped, pre-ADR-0069 and current briefs
against historical source profiles before implementation. This project records the
compatibility decision and its source/fixture evidence; it does not collect vendor data.

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
| U-1 | Can the shared preflight registry run against an explicit context without reading consumer policy or hooks, and which default freshness behavior belongs to that baseline? | An ambient consumer policy would make the same package change authorization between machines. D-2, D-6 and D-8. | CLOSED | E-01, E-02, E-03: an explicit pluralist context bypasses machine context reads and promotion, with the registry default 180-day freshness horizon. Tests must tripwire consumer config/hook access. [single-witness: pinned first-party source code defines its own behavior; another publisher cannot define that implementation.] |
| U-2 | What exact fields did the pre-0069 input hash cover, and which stamp/profile changes distinguish it from the current hash? | Rejecting every old hash loses valid historical approvals; ignoring hashes loses currency checking. D-5 and D-6. | CLOSED | E-04, E-05, E-06: the early hash omits map and count inputs, and the literal marker lacks a gate field. The retained actual-writer probe reproduces a valid format-1.0 early approval whose current hash differs. [single-witness: the historical implementation and its own ADR define this format change.] |
| U-3 | What did the actual historical artifact/brief writers emit, which format majors remain readable, and how is a false authorization preserved? | Compatibility needs historical profiles rather than an invented marker, and an incoming false claim must never be upgraded. D-1 and D-9. | CLOSED | E-07, E-08, E-09: actual historical/current writers generated unstamped, early and current profiles over disclosed synthetic corpora; all claim approval and validate before the fix, while current producer derivation rejects the early hash. Supported majors remain 1 and 2; false claims stay false. Results and brief texts are retained in research/probes/profiles.json. [single-witness: the pinned writers and reader are the authority on their formats.] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

ADR-0032 keeps validity separate from authorization and rejects trusting asserted producer
state. ADR-0069 records the stamp change inside format 1.x. ADR-0138 preserves unstamped
authored briefs with disclosed unknown currency. The qualified rank-2 gap audit requires
unpromoted portable findings and explicit historical-profile verification. No merge is
authorized; the output is a separate fix PR.
