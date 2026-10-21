# ADR-0022 — Phase 2 builds the protocol kit first; the release-evidence validators are deferred

- **Date:** 2026-09-17
- **Status:** accepted
- **Area:** build scope, `fetchproof/`, the superpowers specs

## Context

This checkout is the planning-and-handoff bundle: 79 source documents, a research corpus
with its `research/raw/**` deliberately absent, and **no implementation at all**.
`BUNDLE_INDEX.md` says so in its own words — `fetchproof/**`, schemas, dependencies and
implementation code are outside the archive's inclusion boundary.

Phase 2 therefore starts from two very different bodies of specification, and they are not
the same size or the same kind:

1. **The protocol kit** — `docs/ARCHITECTURE.md`, ADR-0001…0021, `CONTEXT.md`, `AGENTS.md`,
   and the gate-hardening design. Roughly 26 `lib/` modules and 14 `bin/` entrypoints
   implementing one idea: research is a blocking phase, evidence is fetched rather than
   typed, and a gate refuses the build until that is true. Every command the operator-facing
   documents name — `doctor.mjs`, `preflight.mjs`, `research.mjs`, `handoff.mjs`,
   `audit.mjs` — belongs to this half.

2. **The release-evidence validator layer** — the `docs/superpowers/specs/2026-09-16-*`
   family: R28–R32 machine validators, the qualification ledger with Ed25519 promotion
   pointers, descendant-invalidation rollback planning, Git-origin/path-authority snapshots,
   the FI completed-workbook join with its narrow XLSX reader, PDF AcroForm visual
   regression, property-replay capture, and the canonicalization conformance vectors with a
   second runner in the Python standard library. It is a second subsystem with its own
   schemas, its own conformance corpus, and its own reviewer artifacts — most of which the
   bundle also excludes by policy (23 reviewer-artifact pairs and 11 implementation/schema
   pairs are listed as intentionally absent).

The second layer *validates releases of the first*. Its specs repeatedly name files the
bundle does not carry — `fetchproof/schemas/trap-register.schema.json`,
`fetchproof/test/fi-validator-conformance.test.mjs`,
`fetchproof/lib/r29-workbook-linkage-validator.mjs` — and several of its gates are defined
against sealed record catalogs, signed pointers, and worksheets that exist only on the
machine that ran the qualification. Building it from the specs alone would mean inventing
the evidence it is supposed to check.

## Decision

**Build the protocol kit completely, and defer the release-evidence validator layer.**

Delivered, and covered by the suite (`node fetchproof/bin/selftest.mjs`):

- every `lib/` module named in `docs/ARCHITECTURE.md`'s module table except the five that
  belong to the deferred layer (`release-validator`, `path-authority-validator`,
  `fi-validator`, `property-replay`, `r29-workbook-linkage-validator`);
- every `bin/` entrypoint except `researcher-release.mjs`, `path-authority.mjs`,
  `property-replay.mjs` and the conformance runners;
- `githooks/pre-commit`, `hooks/edit-gate.mjs`, `template/`, `skill/`, `recipes/` ×5.

Deferred, with nothing pretending to stand in for it: no stub modules, no empty schemas, no
CLI that accepts the flags and answers nothing. A validator that returns `PASS` because it
was not finished is worse than an absent one — it is the self-deception the gate-hardening
design was written against, wearing the vocabulary of the thing that prevents it.

## Status update, 2026-09-20 — the deferral is discharged

**The deferred layer is built.** This ADR's text below is left exactly as written on
2026-09-17; only this note is new, because the decision it records was correct for the
information available then and should not be edited to look prescient.

What changed is a fact, not a judgment. This ADR deferred the layer because "the
validator specs are defined against sealed records, signed promotion pointers, gold
worksheets and evidence packets that this archive excludes by policy". True of the
archive — and an inventory on 2026-09-20 found the layer already built elsewhere on the
same machine. It was ported module by module under
[ADR-0029](0029-the-validator-layer-arrives-as-a-source-not-a-donor.md): nine library
modules, eight binaries including three Python conformance runners, eleven schemas, three
vector packets, and the tests that go with them. 556 tests pass.

Two of this ADR's consequences are now void and are superseded rather than deleted:

- *"`docs/ARCHITECTURE.md` describes a superset of what exists"* — it no longer does.
  Every row describes a module that exists, and the two that did not are real.
- The byte-preservation argument for not editing that map was already superseded by
  [ADR-0028](0028-the-bundle-is-a-received-state-not-a-live-constraint.md) on the same
  day, for reasons unrelated to this layer.

What stands, and stands well: **nothing was stubbed.** This ADR refused to ship a
`researcher-release validate` that exits 0 without reading a record, on the grounds that
"the first person to trust it would be the one it was built for". Between 2026-09-17 and
2026-09-20 the command did not exist rather than lying, and when it arrived it arrived
with its tests. That was the right call and it is why this note is short.

## Consequences

- The kit is usable end to end today: scaffold, decompose, collect, gate, brief, audit,
  bundle, hand off. The whole of `START_HERE.md` and `AGENTS.md` is live.
- `docs/ARCHITECTURE.md` describes a superset of what exists. It is a **byte-preserved
  bundle source** — `BUNDLE_INDEX.md` carries its SHA-256 — so it was not edited; the delta
  is recorded in `docs/build-report-2026-09-17.md` instead, and this ADR is the pointer to
  it. That is a deliberate exception to the same-commit map rule, taken because breaking the
  archive's own integrity index to satisfy a documentation rule trades a checkable property
  for an unverifiable one.
- Anyone resuming this work has a clean seam: the deferred layer is read-only by design in
  every one of its specs, so it can be added beside the kit without touching the collector,
  the corpus, or the verdict.

## Rejected alternatives

- **Build both layers.** Rejected on evidence, not on effort: the validator specs are
  defined against sealed records, signed promotion pointers, gold worksheets and evidence
  packets that this archive excludes by policy. The parts that could be written from the
  specs alone would be the parts that check nothing.
- **Stub the deferred CLIs so every documented command exists.** Rejected: a
  `researcher-release validate` that exits 0 without reading a record is indistinguishable
  from one that passed, and the first person to trust it would be the one it was built for.
  An absent command reports its absence honestly; a hollow one does not.
- **Edit `docs/ARCHITECTURE.md` down to what was built.** Rejected: the file is inventoried
  by SHA-256 in `BUNDLE_INDEX.md`, and the planning documents are a record of a past state
  in its own words — the same reasoning ADR-0012 used for dated records. The correction
  lives beside it, dated, as `docs/adr-0016-verification-2026-09-15.md` already does for
  ADR-0016's line count.
- **Build the validator layer first, since it is the newer specification.** Rejected: it
  validates releases of a kit that did not exist. Nothing it checks could have been produced.
