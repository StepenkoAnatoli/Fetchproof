# ADR-0156 — Direct internal access keeps the operator's-statement default

- **Date:** 2026-10-11
- **Status:** accepted
- **Area:** `lib/http-transport.mjs` and `lib/browser-guard.mjs` (the `undefined` reading of
  `allowInternalRedirects`); the plan parser's URL policy. No code changes under this ADR.
- **Refines:** ADR-0110 (an internal URL the operator asked for is theirs), ADR-0155 (an
  explicit refusal judges a name by what it resolves to). Their decisions stand.

## Context

ADR-0155 repaired how an explicit refusal of this machine's network is applied and left one
policy question open, with a named trigger: whether direct internal access by default should
require the explicit opt-in `RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1` - that is, whether a
planned or searched URL that is itself internal (`http://10.0.0.5/`, `http://localhost:8080/`)
should still be read as the operator's statement and fetched, as ADR-0110 decided. The
2026-10-10 audit raised the same question as the fourth of its repair questions for the URL
unit: it would supersede ADR-0110's assumption that every planned URL is an operator
statement, and needs an explicit compatibility decision for intranet research. The audit also
observed that agent-authored plans do not establish that intent, and that `planProblems`
validates a planned URL's syntax and scheme but does not reject an internal host.

What is already true, and not in question: the auto collector refuses internal targets at
request admission and sets the variable to `0` for everything it serves; the variable set to
`0` is the same refusal for any caller; under either, ADR-0155 judges a name asked for before
any fetch or launch, and the connection-time lookup guard (ADR-0114) stays. The default
therefore governs only a URL that reaches a transport with no refusal set: one the operator
typed into a plan or passed to `research --url`, or a search result taken into the plan.

## Decision

The default stays as ADR-0110 reads it. With no refusal set, a URL that is itself internal is
fetched or rendered, redirects within it too; nothing an operator types stops working, and
intranet research needs no new setting on each machine. Refusal remains an explicit choice -
the collector's `false`, the variable set to `0` - and ADR-0155 makes that choice cover names
from the first URL onward. The operator asked for this decision to be taken in their interest
on 2026-10-11 without choosing between the two readings; the conservative reading is the one
that changes nothing for a person at the keyboard and adds nothing for the collector, which
already refuses.

This is a dated default, not a settled policy. The trigger ADR-0155 named is kept as the
condition for reopening it, below.

## Rejected alternatives

- **Refuse every internal first URL unless the variable is `1`.** It would reverse ADR-0110's
  default for every intranet and local-test use until each machine opts in, and it would add
  nothing on the path that matters most, since the collector already refuses. If it is ever
  adopted, it is a compatibility change and needs its own ADR naming the migration.
- **Reject internal hosts in `planProblems`.** It would refuse a plan the operator wrote
  before any transport judged it, with no opt-in a plan can carry; the same objection as
  above, earlier.
- **Leave the question in ADR-0155's text alone.** That left it open without a decision on
  record; a reviewer would re-raise it each time the transports change.

## Reopens when

Either of these reopens the question as a new ADR, as ADR-0155 named: a plan or search result
that names an internal address the operator did not type reaches a transport with no refusal
set, or a collector that cannot tell an operator-typed URL from a searched one. Until then this
default is the decision.
