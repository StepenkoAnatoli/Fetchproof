---
title: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate — D-4 ToS, licensing, legality of the intended use"
topic: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate"
slug: fetchproofs-own-protocol-metered-primary-sourc--d-4-tos-licensing-legality-of
version: 0.1
generated: 2026-09-14T20:30:57.910Z
date: 2026-09-14
status: research-complete (preflight PASS)
scope: subtopic
subtopic-id: D-4
evidence-window: 2026-09-13
closed-unknowns: 1
known-unknowns: 0
evidence-rows: 1
raw-captures: 6
ledger-entries: 7
failures: 0
corpus-root: research/
fingerprint: 598fa983-d11d99c1-d27a74b2
---

# Fetchproof's own protocol: metered primary-source collection, provenance, and gate — Subtopic D-4: ToS, licensing, legality of the intended use (Audit v0.1)

_Generated 2026-09-14. Subtopic of **Fetchproof's own protocol: metered primary-source collection, provenance, and gate**. Evidence window: 2026-09-13. Version 0.1._

## Executive Summary

This audit compiles 1 verified finding about **D-4 — ToS, licensing, legality of the intended use** (subtopic of Fetchproof's own protocol: metered primary-source collection, provenance, and gate) from 1 primary-source page cached under `research/raw/`. Every relevant blocking unknown has primary-source evidence; none remain open. Top finding: By registering and using the Services, you represent and warrant you: (i) have the authority and capacity to enter this Agreement; (ii) are at least 18 years old, or 13 years or older and have the express permission of….

## How to use this file

This file is a self-contained audit of the **D-4 — ToS, licensing, legality of the intended use** subtopic. It can be pasted into an AI on its own; its parent main-topic audit (`fetchproofs-own-protocol-metered-primary-sourc-v0.1-2026-09-14.md`) covers the full project.

## Topic map

| ID | Subtopic | Status | Covered by |
|---|---|---|---|
| D-4 | ToS, licensing, legality of the intended use | COVERED | U-4 |

## What we verified

| Claim | Evidence | Type | Host | Retrieved |
|---|---|---|---|---|
| By registering and using the Services, you represent and warrant you: (i) have the authority and capacity to enter this Agreement; (ii) are at least 18 years old, or 13 years or older and have the express permission of… | E-06 `firecrawl.dev` | P | firecrawl.dev | 2026-09-13 |

## Findings in detail

## Subtopic D-4 — ToS, licensing, legality of the intended use  
_Status: COVERED_

### U-4 — Is this kit's own collection permitted - automated fetching of public vendor documentation through Firecrawl's service, for personal research on the operator's machine?

**Status:** CLOSED  
**Source:** E-06 `firecrawl.dev` — <https://www.firecrawl.dev/terms-of-service>  
**Retrieved:** 2026-09-13  
**Type:** P

**Finding:**

> By registering and using the Services, you represent and warrant you: (i) have the authority and capacity to enter this Agreement; (ii) are at least 18 years old, or 13 years or older and have the express permission of…

Verbatim from the cached page (`research/raw/2026-09-13-terms-of-service-firecrawl-172bc71f.md`):

> to Use Services** By registering and using the Services, you represent and warrant you: (i) have the authority and capacity to enter this Agreement; (ii) are at least 18 years old, or 13 years or older and have the express permission of y…

## Contradictions and how they were resolved

No contradictions were flagged between the primary sources reviewed in this scope. Review if you add sources that disagree.

## Known unknowns

None. Every blocking unknown in this scope was closed with primary-source evidence.

## Errors & collection notes

_No fetch failures were recorded for this scope._

## Changes & timeline

| When | Event | Detail |
|---|---|---|
| 2026-09-13T17:29:33 | preflight FAIL | 5 blocker(s), 3 warning(s) |
| 2026-09-13T17:38:25 | FETCH #1 | https://docs.firecrawl.dev/rate-limits |
| 2026-09-13T17:38:25 | E-01 P | Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs. Rate limits are per team, not per key. Keyless access is capped per IP per day and returns 429 when exceeded; a free API key includes 1 |
| 2026-09-13T17:38:25 | FETCH #2 | https://www.firecrawl.dev/pricing |
| 2026-09-13T17:38:25 | E-02 S | Free plan: 1,000 credits/month, 500 searches or 1,000 pages scraped, 2 concurrent requests, $0. Hobby $16/month: 5,000 credits, 5 concurrent requests, extra credits at 1,000 per $5. Standard $83/month: 100,000 credits, 25 concurrent request |
| 2026-09-13T17:38:25 | FETCH #3 | https://docs.firecrawl.dev/billing |
| 2026-09-13T17:38:25 | E-03 P | Billing is credit-based and the plan allotment resets each billing cycle. Cost per endpoint: Scrape 1 credit/page, Crawl 1 credit/page, Map 1 credit/call, Search 2 credits per 10 results rounded up (11 results = 4 credits), Interact 2-7 cre |

## Decision

**TODO** — fill in the Decision section of `research/BRIEF.md` (what to build first and what is explicitly out of scope) and re-run `node bin/audit.mjs` to refresh the audit.

## Next steps

1. Review **Contradictions** and **Decision** in `research/BRIEF.md`; if they are TODO, no builder should start yet.
2. This file covers subtopic **D-4 — ToS, licensing, legality of the intended use** only. The main audit and sibling subtopic audits live alongside it in `research/audits/`.
3. Hand the file (and `research/raw/`) to the builder, or paste the whole document into an AI — every claim cites an evidence ID that maps to a cached primary source.
4. Re-run `node bin/audit.mjs` after further research to bump versions and capture what changed.

## Provenance

- Preflight: PASS (`node bin/preflight.mjs` returns 0)
- Scope: subtopic D-4 (ToS, licensing, legality of the intended use)
- Evidence files: 1 page from `research/raw/`
- Ledger entries: 7 (chain verified)
- Failures recorded in this scope: 0
- Source of truth: research/DISCOVERY.md, research/EVIDENCE.md, research/MAP.md, research/raw/
- Regenerate: `node bin/audit.mjs` (bumps patch versions for any scope whose fingerprint changed)
