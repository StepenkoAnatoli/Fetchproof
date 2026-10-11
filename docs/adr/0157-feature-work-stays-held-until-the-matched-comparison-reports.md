# ADR-0157 — Feature and ranking work stays held until the matched comparison reports

- **Date:** 2026-10-11
- **Status:** accepted
- **Area:** the whole kit; `AGENTS.md` ("Feature freeze"). No code changes under this ADR.
- **Refines:** ADR-0117 (feature freeze from 0.9.0), ADR-0145 (the kit is measured against a
  strong prompt before it grows). Their decisions stand.

## Context

The review queue for PR #266 (2026-10-07 to 2026-10-11) carried a set of conditional items
beside the repairs: feature and ranking work whose go-ahead was made conditional on the
evaluation ADR-0145 prescribes - a matched-arm comparison of the kit's workflow against a
strong prompt, with a protocol frozen before the first trial and simplification criteria
pre-registered per mechanism. The repairs were integrated one revertible commit at a time and
are on `main`; the conditional items were held throughout, and the operator closed the queue
on 2026-10-11 with that hold in place. No comparison has run.

ADR-0117 already says what the freeze admits - a bug fix, closing a gap an ADR deferred when
its trigger fires, documentation and tests, keeping up with the outside world - and that
anything else needs an ADR lifting the freeze for that one item. The conditional items are of
the "anything else" kind.

## Decision

Feature and ranking work remains held, and the hold is recorded here rather than carried only
in the queue's trackers. Nothing from the conditional set is added or scheduled until the
ADR-0145 comparison has run under its frozen protocol and its results are recorded as the
per-mechanism ADRs it calls for. No freeze exception is granted by this record.

## Rejected alternatives

- **Proceed with the held items now, since the repairs are in and the branch is green.** A
  green suite shows the kit does what it specifies; it does not show that its mechanisms earn
  their cost, which is the question ADR-0145 exists to answer before the kit grows. Adding
  features ahead of that answer is the pattern ADR-0117 stopped.
- **Grant a single freeze exception for the whole conditional set.** ADR-0117 lifts the
  freeze per named item only; a blanket exception would be the freeze ending without the
  owner's 1.0 decision.
- **Drop the items instead of holding them.** The comparison may show that some are worth
  their cost; dropping them now would prejudge the result as much as adding them would.

## Reopens when

The ADR-0145 comparison reports. Each held item is then taken up, simplified or dropped by
the ADR that records what the comparison measured for the mechanism it touches - or by the
owner's decision on 1.0, which ADR-0117 names as the other way the freeze ends.
