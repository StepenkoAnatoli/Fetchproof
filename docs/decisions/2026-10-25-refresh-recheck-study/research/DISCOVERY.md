# Discovery Contract - On a re-collection, does ADR-0193's quote-level refresh recheck spare unchanged work without missing changed facts, and does it change what ships?

Started 2026-10-25. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Answer, for the owner, whether ADR-0193's quote-level refresh recheck (plan v0.4 section 7)
with ADR-0194's gone-page rule (section 8) earns its place against today's kit, where every
refresh of a cited row reopens its unknown (ADR-0026). The deliverable is the study of plan
section 12, pre-registered here: `research/PROTOCOL.md` fixes the question, the arms, the six
task slots and their five page-change kinds, the three headline numbers with their
denominators, the independent scoring and every decision rule before any trial runs; then
the task texts, fixture pages, hidden suites and trial harness are written and committed
before trial 1; then the trials run, are scored blind-first, and a closing record keeps or
switches off ADR-0193 and keeps or does not confirm ADR-0194 by the rules as frozen. Done
means every arm has run all six tasks for the fixed trial count, every headline number is
reported as a count over its stated denominator with its status word (verified / untested /
expected), and each keep/switch-off/drop outcome is recorded as an ADR. This project adds no
command, check, format or judge to the kit: ADR-0117's freeze and ADR-0089's semantic
boundary stay in force, and ADR-0145's `PROTOCOL.md` is referenced, never amended.

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
| U-1 | Which classes of API update does the paper "When LLMs Lag Behind" define, in its own words, so a task's page change can be named after a published class rather than an invented one? | Plan section 12 lets task material draw on those classes; a class named from memory would put an unsourced claim into the task texts the hidden suites are written from. | CLOSED | E-01: three patterns - P1 API Deprecation (with a recommended alternative), P2 API Modification (name, parameters or return type changed), P3 API Addition. Collected keyless on 2026-10-25 during the pre-registration (no credit). A task text may name a pattern only with this row cited. [single-witness: the paper defining its own update patterns - no second party defines them] |
| U-2 | Does the kit's collector, as the trials will run it, capture pages from a local loopback fixture server with both keyless transports (`http-keyless` and `browser`), and record a 404 from that server as a ledger fail entry, so all five page-change kinds can be produced offline? | The whole fixture design rests on it: if a loopback URL is refused, or only one transport reaches it, kind 3 (transport switch only) and kind 4 (page deleted) cannot be staged, and the study needs another way to control re-collection. | KNOWN-UNKNOWN | Read in the installed 0.9.5 kit's code, not run (this unit was barred from anything that fetches): `lib/http-transport.mjs` and `lib/browser-guard.mjs` treat an internal URL the operator asked for as the operator's own (ADR-0110, ADR-0155), which reads as "loopback is fetched". Firecrawl, a hosted service, is not expected to reach this machine's loopback, so the trials are keyless and spend no fetch credits (expected). Day-one step, before trial 1: a trial-0 smoke run in a scratch project against the fixture server - one capture by each keyless transport and one 404 - with the ledger lines and the preflight verdict pasted into the trial log; close this row in the log, or change the fixture design before any trial if it fails. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The design is plan v0.4 section 12 (owner-approved 2026-10-25), fixed in
  `research/PROTOCOL.md`: arms A (today's kit, every refresh reopens) and B (the kit with
  ADR-0193 and ADR-0194), arm C only on its stated condition; six coding tasks against
  synthetic vendor APIs served by a local fixture server; five page-change kinds; three
  headline numbers; scores that never come from Fetchproof's gate.
- The protocol and decision rules are committed before the first trial. The hidden suites
  are written per task by an author who has seen no run, and committed before trial 1;
  this pre-registration does not write them (run Mandate C5).
- ADR-0145's `research/PROTOCOL.md` is not amended: its amendment path admits only rubric
  defects found before its first trial. This project cites its U-3 defect definition, its
  truthful-reporting rule and its "meaningful" definition by path and section.
- Fixture pages are synthetic and written for this study; no Testimonium page or fixture is
  copied.
- No new command, format, judge or runtime check; ADR-0089 and ADR-0117 remain in force.
