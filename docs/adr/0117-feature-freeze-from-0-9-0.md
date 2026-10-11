# ADR-0117 — Feature freeze from 0.9.0

- **Date:** 2026-10-01
- **Status:** accepted
- **Area:** the whole kit; `AGENTS.md` ("Feature freeze")

## Context

By 0.9.0 the kit has about twenty commands, three fetch transports, four search providers and
116 ADRs. Break-test rounds have been finding fewer and smaller defects each time. More
features now mostly add more for an agent to read, and misread, before it can follow the
protocol. The owner asked for a freeze as the fourth step toward a tool other agents can lean
on.

## Decision

From 0.9.0, changes to the kit are of these kinds only:

- **A bug fix:** behaviour that contradicts the documentation or an ADR, a crash, a security
  gap, a failing or flaky test.
- **Closing a gap an ADR already deferred**, when its trigger fires.
- **Documentation and tests**, including wording, examples, and tests for existing behaviour.
- **Keeping up with the outside world:** a vendor changing its API, a Node or git release, a
  pinned Action moving.

Not allowed without a new ADR that lifts the freeze for that one item: a new command, flag,
transport, provider, configuration key, file format or check.

## Expires when

The owner decides on 1.0, or lifts the freeze in an ADR for a named feature.

Clarified 2026-10-08: a named exception lifts the freeze for that item only; unrelated
work remains frozen. The owner's decision on 1.0 is a separate way to end the freeze.
Classification is carried by review; a passing suite does not establish compliance.

## Rejected alternatives

- **No freeze, with features judged case by case.** That is how the kit reached its size. Each
  feature was reasonable alone, and together they are what an agent must learn.
- **A freeze enforced by a test** (for example, pinning the list of commands). A test cannot
  tell a bug fix from a feature, and a wrong refusal teaches people to edit the pin. The rule
  is carried by review and this record, like the rest of the standing protocol.
