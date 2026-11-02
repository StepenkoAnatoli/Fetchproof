# Brief - On a re-collection, does ADR-0193's quote-level refresh recheck spare unchanged work without missing changed facts, and does it change what ships?

_Auto-drafted 2026-10-25 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** The configured research checks passed. Disclosed known unknowns
and gate warnings still apply; PASS does not establish that every claim is correct.

**Gate warnings from this evaluation: 3.**

These findings apply to the whole corpus at the time of this evaluation. Re-run
preflight after edits; this list is not a fresh evaluation of the resulting document.

- **transport-provenance/transport-not-metered** (E-01): E-01 was collected by "http-keyless", not the metered Firecrawl CLI
- **capture-completeness/partial-only** (U-1): U-1 rests solely on partial captures (omitted: 4 sibling section(s) totalling ~189 words were outside the page's main content and are not in this capture)
- **collection-attempts/unknown-attempted** (U-2): U-2 is KNOWN-UNKNOWN with no recorded fetch attempt - an unreachable fact should have been reached for

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

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

## What we verified

| Claim | Source | Type |
|---|---|---|
| The paper (arXiv 2604.09515, 2026) sorts API updates into three patterns: P1 API Deprecation, removed or deprecated APIs with a recommended alternative; P2 API Modification, a changed function name, parameters or return type; P3 API Addition, an API that did not exist before. [quote: P2 - API Modification : APIs whose function name, parameters, or return type have been changed] [quote: P3 - API Addition : Newly introduced APIs that did not exist in prior versions] _(partial capture)_ | E-01 `arxiv.org` (U-1) | P |

## Contradictions and how they were resolved

None. One source (E-01), the paper defining its own update patterns; nothing else in this
project is an external fact. The study's design facts come from the plan (section 12) and
ADR-0145's PROTOCOL.md, which are repository text, not evidence rows.

## Known unknowns

- **U-2** - Does the kit's collector, as the trials will run it, capture pages from a local loopback fixture server with both keyless transports (`http-keyless` and `browser`), and record a 404 from that server as a ledger fail entry, so all five page-change kinds can be produced offline?
  - Day-one verification: Read in the installed 0.9.5 kit's code, not run (this unit was barred from anything that fetches): `lib/http-transport.mjs` and `lib/browser-guard.mjs` treat an internal URL the operator asked for as the operator's own (ADR-0110, ADR-0155), which reads as "loopback is fetched". Firecrawl, a hosted service, is not expected to reach this machine's loopback, so the trials are keyless and spend no fetch credits (expected). Day-one step, before trial 1: a trial-0 smoke run in a scratch project against the fixture server - one capture by each keyless transport and one 404 - with the ledger lines and the preflight verdict pasted into the trial log; close this row in the log, or change the fixture design before any trial if it fails.

## Decision

**This project is a pre-registration, not a build.** `research/PROTOCOL.md` fixes the
study's question, arms, tasks T1-T6 over the five page-change kinds, the three headline
numbers with their denominators, the scoring and the decision rules DR-1..DR-6 before any
trial. A task text may name an API-update pattern only as E-01 defines it (P1 deprecation,
P2 modification, P3 addition).

**First step:** write the six hidden suites (PROTOCOL.md section 8), by an author who has
seen no run, and commit them before trial 1; then the trial-0 smoke run that closes U-2.

**Out of scope here:** the hidden suites, the fixture server, the trials, and any change to
ADR-0145's PROTOCOL.md. Before trial 1 the owner settles whether DR-1(b), the safety rule,
applies to kind 5 (T6, E6), since arm B passes E6 by construction.

## Next steps

1. Write and commit the hidden suites (PROTOCOL.md section 8) before trial 1.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=63f65c65dc468cb1 inputs=16ff138653683ffa gate=pass -->
