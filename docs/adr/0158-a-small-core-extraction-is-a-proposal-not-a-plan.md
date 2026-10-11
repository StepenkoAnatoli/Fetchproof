# ADR-0158 — A small-core extraction is a proposal, not a plan

- **Date:** 2026-10-11
- **Status:** accepted
- **Area:** repository layout and packaging. No code changes under this ADR.
- **Refines:** ADR-0029 (the validator layer's provenance), ADR-0117 (feature freeze),
  ADR-0145 (growth waits for the matched comparison). Their decisions stand.

## Context

The 2026-10-10 audit measured the kit's size - at its head, `research-kit/**/*.mjs` excluding
`test` and `examples` path components was 93 files and 25,565 physical lines (blanks and
comments included), and there were 150 numbered ADRs - and observed that scope makes
adoption harder. It sketched a boundary: keep the collection plan, cached captures and ledger,
declared contract, preflight, briefing and corpus handoff in a core, and evaluate the
release-evidence validation layer (R28-R33 artifact records, role rosters, promotion pointers,
qualification ledgers, schema conformance and fault-injection bundles - the layer ADR-0029
records as ported from a local, non-Git source tree), the desktop panel and the optional
integration surfaces as separate packages or distributions. The audit called this a design
proposal, not an extraction it performed; it said that imports, installer deployment
requirements and the tests belonging to each package must be measured before a boundary is
chosen; and it noted that ADR-0145 already requires the matched comparison and
pre-registered simplification criteria before broader product growth.

The audit also found that the inspected release facade and validators import only their own
primitives and Node built-ins, with the release and path-authority CLIs and the conformance
and property modules as their listed consumers - a concrete seam to investigate, not evidence
that an extraction is already safe.

## Decision

The extraction is not undertaken. It stays a proposal on record, with the audit's boundary
sketch as its starting point. Two things must exist before it becomes a plan:

1. The ADR-0145 comparison's results, which decide per mechanism what is kept, simplified or
   dropped. A boundary drawn before that would package mechanisms whose fate is still open.
2. A measured dependency review of the proposed seam - imports, installer deployment
   requirements, the tests that belong to each side, documentation and compatibility -
   recorded as a nested decision project under `docs/decisions/` (ADR-0030).

No package boundary, new command, distribution or freeze exception is adopted by this record.

## Rejected alternatives

- **Begin extracting the release layer now, since its consumers appear confined.** Packaging,
  deployment, documentation and compatibility were not reviewed; the inspected seam is an
  observation about one enumerated subset, not the transitive subsystem with its schemas,
  Python runners and tests. ADR-0117 treats a new distribution as a feature.
- **Reject the proposal.** The size observation is supported and the seam is real; a
  rejection would discard a starting point the comparison may well confirm.
- **Record the proposal only in the queue's trackers.** They are working notes outside the
  repository; a decision that constrains future layout belongs where reviews look.

## Reopens when

Both of the two prerequisites above exist. Either alone does not reopen it.
