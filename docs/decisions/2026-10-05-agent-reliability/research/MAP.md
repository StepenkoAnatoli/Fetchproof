# MAP - topic decomposition

## Topic

How can Fetchproof reduce unsupported claims and coding mistakes while accurately stating its guarantees?

## Subtopics

Reviewed by the agent for a research-only mission audit. Decomposition used --dry-run
to avoid four poorly targeted paid searches; primary studies were located separately
and their owner pages are collected under the six-page plan.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public primary sources support the recommendation | DISMISSED | No new access system is designed; the six owner pages are public and fetched through the existing collector. |
| D-2 | Auth and credentials | Collection must not introduce credentials into the repo | DISMISSED | Existing authenticated collector only; no new auth model, accounts or stored secrets. |
| D-3 | Rate limits and quotas | Bound collection spend | DISMISSED | Six direct URLs with no collection queries, existing collector limits; no new cadence or quota-dependent product. |
| D-4 | ToS, licensing, legality of the intended use | No unsupported legal promises | DISMISSED | No change to capture use or distribution policy and no legal recommendation; existing repository capture policy applies. |
| D-5 | Data schema and its stability | Avoid an unresearched integration | DISMISSED | No new API, schema or integration; dated studies and local source inspection only. |
| D-6 | Freshness and staleness | Historical results must not be presented as current model error rates | COVERED | U-1, U-2, U-3, U-4 |
| D-7 | Cost at expected volume | Avoid expanding metered collection before measuring value | DISMISSED | This audit spends at most six scrapes; no volume-dependent product design or pricing claim. |
| D-8 | Runtime and platform limits | Bound local observations to tested configuration | DISMISSED | Local read-only probe is scoped in AUDIT.md to Windows, Node 24.20.0 and the current checkout; no runtime change. |
| D-9 | Output obtainability | Can the mission claim be evaluated against real outputs? | COVERED | U-5 |
| D-10 | Citation presence versus support | A real page can carry a false interpretation | COVERED | U-1 |
| D-11 | Coding verification strength | A weak suite can accept wrong behavior | COVERED | U-2 |
| D-12 | Review and independent feedback | Repetition can preserve an error | COVERED | U-3 |
| D-13 | Uncertainty and honest reporting | Refusing everything must not count as success | COVERED | U-4 |
| D-14 | Outcome evaluation | Compare actual quality with protocol conformance | COVERED | U-5 |

## Coverage notes (per dimension)

The row reasons delimit this recommendation; they do not dismiss these dimensions
for a future implementation. The research separates historical intervention evidence
from claims about the current kit. A controlled kit outcome experiment is still needed.

## Candidate material

Gathered 2026-10-05.

No paid discovery searches. Six primary pages are named in research/plan.json and
collected in research/EVIDENCE.md. The local implementation audit is AUDIT.md;
local execution is not represented as a fetched page in the ledger.
