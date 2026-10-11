# ADR-0155 — An explicit refusal of this machine's network judges a name asked for by what it resolves to

- **Date:** 2026-10-11
- **Status:** accepted
- **Area:** `lib/http-transport.mjs` (the fetch child), `lib/browser-guard.mjs` (`judge` and
  the guard child), `lib/browser-transport.mjs` (the parent's reading of a child refusal)
- **Refines:** ADR-0110 (redirects), ADR-0114 (lookups judged at connection time), ADR-0118
  and ADR-0125 (the guard and its `pageFirst` rule). Their decisions stand.

## Context

ADR-0110 lets a caller say what it thinks of this machine's network for a fetch:
`allowInternalRedirects` `true` lifts the check, `false` applies the policy a public page
gets, and `undefined` (the default) lets the child decide from the URL asked for - an
internal URL the operator typed is theirs. The auto collector says `false` for every request
it serves, and so does the environment variable set to `0`.

An audit on 2026-10-10 (synthetic loopback server and injected DNS; no real service
contacted) found two things about `false`. First, the fetch child judged internal addresses
only where a name was resolved (ADR-0114's guarded lookup, and each redirect hop), so a first
URL written as a literal loopback address was fetched. Second, the browser guard exempted the
host and port asked for from its whole judgment, including the judgment of what a *name*
resolves to: a public name the page was asked by, pointed inward by a resolver after the
page was asked for, was admitted as "the page". The parent transport read the final URL by
the same exemption.

The suite's own fixtures depend on part of this: a loopback server stands in for a public
page under `false` in the redirect, guard and browser-transport tests, and the exemption for
the literal address asked for is what makes those pages reachable. An earlier draft of this
repair removed the exemption outright and refused every such fixture page; that showed the
two findings are not one mechanism, and that the literal and the name cases need different
answers.

## Decision

1. **A name asked for is judged by what it resolves to, exempt or not.** `judge` refuses a
   name that resolves to an internal address, or `localhost` and its subdomains, unless the
   caller allowed this machine's network - whether or not that name is the host and port
   asked for. The exemption now covers only the literal-address judgment: an address the
   operator spelled out cannot be rebound, and ADR-0110 already calls it theirs.
2. **Under `false`, a name is judged before anything starts.** The fetch child judges a name
   asked for with `internalTarget` before fetching, and refuses it naming the host and the
   reason, recorded against the URL asked for; the guarded lookup still judges it again at
   connection time (ADR-0114). The guard child does the same before launching a browser and
   answers `EINTERNAL`; the transport reports that as the refusal it is, not as a browser
   that could not start.
3. **A literal address asked for is the caller's.** Under `false` a first URL spelled as an
   address is fetched or rendered, and the policy a public page gets still governs where it
   may lead (redirects, navigation, and every other host). The audit asked for that address
   to be refused too; it is not, deliberately: it cannot be rebound, the collector's admission
   checks already refuse internal request targets before a transport is asked, and the
   suite's public-page fixtures are such addresses.
4. **The default is unchanged.** `undefined` keeps ADR-0110's reading: a planned or searched
   URL that is itself internal is the operator's statement and is fetched, redirects within
   it too. `true` still lifts every check.

## Not decided here

Whether direct internal access by default should require the explicit opt-in - ADR-0110's
assumption that every planned URL is an operator statement - is a policy choice for intranet
research that this repair does not make. Trigger to reopen it: a plan or search result that
names an internal address the operator did not type, or a collector that cannot tell the two
apart. Until then the auto collector's `false` and the variable set to `0` are the refusal.

## Consequences

- A resolver cannot turn the page asked for into this machine's network: the name is judged
  where it is resolved, at the guard and in the fetch child, whatever the caller said about
  redirects.
- Under `false` the fetch child resolves a name once more before fetching; a name this
  machine cannot resolve is still not judged (ADR-0110).
- No option, variable or format is added; `judge`'s exemption narrows, nothing else changes
  shape.
