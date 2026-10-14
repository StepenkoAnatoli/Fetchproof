---
url: https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3fa03fa1749d591af9cd7197e1c09f66ffacd231/docs/adr/0069-the-brief-stamp-covers-the-map-the-ledger-and-the-verdict.md
retrieved: 2026-10-13
command: http-keyless scrape https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3fa03fa1749d591af9cd7197e1c09f66ffacd231/docs/adr/0069-the-brief-stamp-covers-the-map-the-ledger-and-the-verdict.md
statusCode: 200
transport: http-keyless
completeness: full
---
# ADR-0069 — The brief's stamp covers the map, the ledger and the verdict

- **Date:** 2026-09-27
- **Status:** accepted
- **Area:** `lib/brief.mjs` (`briefInputsHash`, `draftStamp`), `bin/preflight.mjs`
- **Refines:** ADR-0055 (a drafted brief is stamped with what it was drafted from)

## Context

ADR-0055's inputs hash covered the topic, the intent, the unknowns and the evidence rows.
Reviewing it the same day, the case it was written for still failed. A brief drafted while
only the map was incomplete said "Gate: FAIL (9 blocking findings)". After the map rows
were statused, preflight printed PASS, and nothing called the brief stale, because the map
was not in the hash. The ledger was not in it either, although provenance decides the
verdict too.

## Decision

- The inputs hash also covers each map row's ID, status and "Covered by" cell, plus the
  number of ledger entries and captures.
- The stamp also records the verdict the brief was drafted under (`gate=pass|fail|unknown`).
  `preflight` prints a note when that verdict differs from the one it has just printed, and
  names the command that redrafts the brief. That catches a verdict change no hashed input
  shows, such as an evidence policy switched to strict.
- An old stamp without `gate=` still parses, as `unknown`, and gets no note.

## Rejected alternatives

- **Hash every file under `research/`.** A timeline regenerated, or an audit written, would
  then call every brief stale. The hash covers what the brief is drafted from, and the
  verdict note covers the rest.
- **Compute the verdict inside the hygiene check.** Hygiene is part of the verdict, so it
  cannot depend on the verdict's own result.

## Trigger that would reopen this

A new check whose inputs are neither in the hash nor able to change the verdict without the
note seeing it.

