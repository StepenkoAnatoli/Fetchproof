---
title: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate — D-1 Access model"
topic: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate"
slug: fetchproofs-own-protocol-metered-primary-sourc--d-1-access-model
version: 0.1
generated: 2026-09-14T20:30:57.908Z
date: 2026-09-14
status: research-complete (preflight PASS)
scope: subtopic
subtopic-id: D-1
evidence-window: 2026-09-13
closed-unknowns: 1
known-unknowns: 0
evidence-rows: 1
raw-captures: 6
ledger-entries: 7
failures: 0
corpus-root: research/
fingerprint: 09ef718d-f3951dfd-74d0afee
---

# Fetchproof's own protocol: metered primary-source collection, provenance, and gate — Subtopic D-1: Access model (Audit v0.1)

_Generated 2026-09-14. Subtopic of **Fetchproof's own protocol: metered primary-source collection, provenance, and gate**. Evidence window: 2026-09-13. Version 0.1._

## Executive Summary

This audit compiles 1 verified finding about **D-1 — Access model** (subtopic of Fetchproof's own protocol: metered primary-source collection, provenance, and gate) from 1 primary-source page cached under `research/raw/`. Every relevant blocking unknown has primary-source evidence; none remain open. Top finding: Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs..

## How to use this file

This file is a self-contained audit of the **D-1 — Access model** subtopic. It can be pasted into an AI on its own; its parent main-topic audit (`fetchproofs-own-protocol-metered-primary-sourc-v0.1-2026-09-14.md`) covers the full project.

## Topic map

| ID | Subtopic | Status | Covered by |
|---|---|---|---|
| D-1 | Access model | COVERED | U-1 |

## What we verified

| Claim | Evidence | Type | Host | Retrieved |
|---|---|---|---|---|
| Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs. Rate limits are per team, not per key. Keyless access is capped per IP per day and returns 429 when exceeded; a free API key includes 1,000 credits. | E-01 `docs.firecrawl.dev` | P | docs.firecrawl.dev | 2026-09-13 |

## Findings in detail

## Subtopic D-1 — Access model  
_Status: COVERED_

### U-1 — What does the free Firecrawl tier actually allow - per-minute request limits, parallel jobs, and included credits?

**Status:** CLOSED  
**Source:** E-01 `docs.firecrawl.dev` — <https://docs.firecrawl.dev/rate-limits>  
**Retrieved:** 2026-09-13  
**Type:** P

**Finding:**

> Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs. Rate limits are per team, not per key. Keyless access is capped per IP per day and returns 429 when exceeded; a free API key includes 1,000 credits.

Verbatim from the cached page (`research/raw/2026-09-13-rate-limits-firecrawl-552467ff-2.md`):

> Documentation Index Fetch the complete documentation index at: [/llms.txt](https://docs.firecrawl.dev/llms.txt) Use this file to discover all available pages before exploring further. [Skip to main content]…

## Contradictions and how they were resolved

No contradictions were flagged between the primary sources reviewed in this scope. Review if you add sources that disagree.

## Known unknowns

None. Every blocking unknown in this scope was closed with primary-source evidence.

## Errors & collection notes

_No fetch failures were recorded for this scope._

## Changes & timeline

| When | Event | Detail |
|---|---|---|
| 2026-09-13T17:38:25 | E-01 P | Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs. Rate limits are per team, not per key. Keyless access is capped per IP per day and returns 429 when exceeded; a free API key includes 1 |

## Decision

**TODO** — fill in the Decision section of `research/BRIEF.md` (what to build first and what is explicitly out of scope) and re-run `node bin/audit.mjs` to refresh the audit.

## Next steps

1. Review **Contradictions** and **Decision** in `research/BRIEF.md`; if they are TODO, no builder should start yet.
2. This file covers subtopic **D-1 — Access model** only. The main audit and sibling subtopic audits live alongside it in `research/audits/`.
3. Hand the file (and `research/raw/`) to the builder, or paste the whole document into an AI — every claim cites an evidence ID that maps to a cached primary source.
4. Re-run `node bin/audit.mjs` after further research to bump versions and capture what changed.

## Provenance

- Preflight: PASS (`node bin/preflight.mjs` returns 0)
- Scope: subtopic D-1 (Access model)
- Evidence files: 1 page from `research/raw/`
- Ledger entries: 7 (chain verified)
- Failures recorded in this scope: 0
- Source of truth: research/DISCOVERY.md, research/EVIDENCE.md, research/MAP.md, research/raw/
- Regenerate: `node bin/audit.mjs` (bumps patch versions for any scope whose fingerprint changed)
