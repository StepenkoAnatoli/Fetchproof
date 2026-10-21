# ADR-0095 — A collector that chose a keyless route is configured, not broken

- **Date:** 2026-09-29
- **Status:** accepted
- **Area:** `lib/doctor.mjs`

## Context

On a collector, `doctor` fails `firecrawl-cli` and `firecrawl-auth` when the Firecrawl CLI is
absent or signed out ("a collector that cannot collect is broken"). That catches a real
failure: a machine meant to collect with Firecrawl silently falls back to the keyless route,
and its captures carry a weaker transport.

The kit also has routes that need no Firecrawl: `http-keyless` and `browser` (ADR-0088). An
operator who picks one of them in the machine config, or with `FETCHPROOF_TRANSPORT`, is
not degraded. That is their setup.

The break-test (PR #140, risk 6) found that `doctor` exits 1 on such a machine. So `doctor`
could not serve as a health check anywhere Firecrawl is deliberately unused.

## Decision

- **An explicit choice passes.** On a collector whose transport was explicitly chosen and is
  not `firecrawl-cli` (machine config `transport`, or `FETCHPROOF_TRANSPORT`), the two
  Firecrawl findings pass. They say which route was chosen, and print no fix.
- **Everything else is unchanged.** With nothing chosen they still fail, because that is the
  silent degradation. They also still fail when `firecrawl-cli` itself was chosen.

## Rejected alternatives

- **Downgrade to a warning for every collector.** A machine that meant to use Firecrawl and
  quietly cannot is exactly what the check exists to catch.
- **Pass whenever any transport works.** The keyless fallback always "works". Whether the
  operator wanted it is the whole question, and only an explicit choice answers it.
- **Count `--transport` on a single command.** A flag describes one run, not the machine.
  `doctor` reports on the machine.
