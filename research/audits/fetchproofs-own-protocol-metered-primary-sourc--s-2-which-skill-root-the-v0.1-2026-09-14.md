---
title: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate — S-2 Which skill root the desktop runtime discovers, and how the protocol binds in Cowork"
topic: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate"
slug: fetchproofs-own-protocol-metered-primary-sourc--s-2-which-skill-root-the
version: 0.1
generated: 2026-09-14T20:30:57.912Z
date: 2026-09-14
status: research-complete (preflight PASS)
scope: subtopic
subtopic-id: S-2
evidence-window: 2026-09-13
closed-unknowns: 1
known-unknowns: 0
evidence-rows: 1
raw-captures: 6
ledger-entries: 7
failures: 0
corpus-root: research/
fingerprint: 723639b3-ec059ce8-f941da9f
---

# Fetchproof's own protocol: metered primary-source collection, provenance, and gate — Subtopic S-2: Which skill root the desktop runtime discovers, and how the protocol binds in Cowork (Audit v0.1)

_Generated 2026-09-14. Subtopic of **Fetchproof's own protocol: metered primary-source collection, provenance, and gate**. Evidence window: 2026-09-13. Version 0.1._

## Executive Summary

This audit compiles 1 verified finding about **S-2 — Which skill root the desktop runtime discovers, and how the protocol binds in Cowork** (subtopic of Fetchproof's own protocol: metered primary-source collection, provenance, and gate) from 1 primary-source page cached under `research/raw/`. Every relevant blocking unknown has primary-source evidence; none remain open. Top finding: The /doctor setup checkup stays typable when disableBundledSkills is on, in Claude Code v2.1.205 and later..

## How to use this file

This file is a self-contained audit of the **S-2 — Which skill root the desktop runtime discovers, and how the protocol binds in Cowork** subtopic. It can be pasted into an AI on its own; its parent main-topic audit (`fetchproofs-own-protocol-metered-primary-sourc-v0.1-2026-09-14.md`) covers the full project.

## Topic map

| ID | Subtopic | Status | Covered by |
|---|---|---|---|
| S-2 | Which skill root the desktop runtime discovers, and how the protocol binds in Cowork | COVERED | U-2 |

## What we verified

| Claim | Evidence | Type | Host | Retrieved |
|---|---|---|---|---|
| The /doctor setup checkup stays typable when disableBundledSkills is on, in Claude Code v2.1.205 and later. | E-04 `code.claude.com` | P | code.claude.com | 2026-09-13 |

## Findings in detail

## Subtopic S-2 — Which skill root the desktop runtime discovers, and how the protocol binds in Cowork  
_Status: COVERED_

### U-2 — Which skill root does Freebuff Desktop auto-discover on this machine - `~/.agents/skills/` or `~/.claude/skills/`?

**Status:** CLOSED  
**Source:** E-04 `code.claude.com` — <https://code.claude.com/docs/en/skills>  
**Retrieved:** 2026-09-13  
**Type:** P

**Finding:**

> The /doctor setup checkup stays typable when disableBundledSkills is on, in Claude Code v2.1.205 and later.

Verbatim from the cached page (`research/raw/2026-09-13-extend-claude-with-skills-claude-code-docs-bbd9e46f.md`):

> Documentation Index Fetch the complete documentation index at: [/docs/llms.txt](https://code.claude.com/docs/llms.txt) Use this file to discover all available pages before exploring further. [Skip to main c…

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
2. This file covers subtopic **S-2 — Which skill root the desktop runtime discovers, and how the protocol binds in Cowork** only. The main audit and sibling subtopic audits live alongside it in `research/audits/`.
3. Hand the file (and `research/raw/`) to the builder, or paste the whole document into an AI — every claim cites an evidence ID that maps to a cached primary source.
4. Re-run `node bin/audit.mjs` after further research to bump versions and capture what changed.

## Provenance

- Preflight: PASS (`node bin/preflight.mjs` returns 0)
- Scope: subtopic S-2 (Which skill root the desktop runtime discovers, and how the protocol binds in Cowork)
- Evidence files: 1 page from `research/raw/`
- Ledger entries: 7 (chain verified)
- Failures recorded in this scope: 0
- Source of truth: research/DISCOVERY.md, research/EVIDENCE.md, research/MAP.md, research/raw/
- Regenerate: `node bin/audit.mjs` (bumps patch versions for any scope whose fingerprint changed)
