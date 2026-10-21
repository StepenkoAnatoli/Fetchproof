---
title: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate — D-8 Runtime and platform limits"
topic: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate"
slug: fetchproofs-own-protocol-metered-primary-sourc--d-8-runtime-and-platform-limits
version: 0.1
generated: 2026-09-14T20:30:57.911Z
date: 2026-09-14
status: research-complete (preflight PASS)
scope: subtopic
subtopic-id: D-8
evidence-window: 2026-09-13
closed-unknowns: 2
known-unknowns: 0
evidence-rows: 2
raw-captures: 6
ledger-entries: 7
failures: 0
corpus-root: research/
fingerprint: 31733341-9718354b-0854da47
---

# Fetchproof's own protocol: metered primary-source collection, provenance, and gate — Subtopic D-8: Runtime and platform limits (Audit v0.1)

_Generated 2026-09-14. Subtopic of **Fetchproof's own protocol: metered primary-source collection, provenance, and gate**. Evidence window: 2026-09-13. Version 0.1._

## Executive Summary

This audit compiles 2 verified findings about **D-8 — Runtime and platform limits** (subtopic of Fetchproof's own protocol: metered primary-source collection, provenance, and gate) from 2 primary-source pages cached under `research/raw/`. Every relevant blocking unknown has primary-source evidence; none remain open. Top finding: The /doctor setup checkup stays typable when disableBundledSkills is on, in Claude Code v2.1.205 and later..

## How to use this file

This file is a self-contained audit of the **D-8 — Runtime and platform limits** subtopic. It can be pasted into an AI on its own; its parent main-topic audit (`fetchproofs-own-protocol-metered-primary-sourc-v0.1-2026-09-14.md`) covers the full project.

## Topic map

| ID | Subtopic | Status | Covered by |
|---|---|---|---|
| D-8 | Runtime and platform limits | COVERED | U-2, U-3 |

## What we verified

| Claim | Evidence | Type | Host | Retrieved |
|---|---|---|---|---|
| The /doctor setup checkup stays typable when disableBundledSkills is on, in Claude Code v2.1.205 and later. | E-04 `code.claude.com` | P | code.claude.com | 2026-09-13 |
| Exit 2 means a blocking error. | E-05 `code.claude.com` | P | code.claude.com | 2026-09-13 |

## Findings in detail

## Subtopic D-8 — Runtime and platform limits  
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

### U-3 — Does the Claude Code `PreToolUse` hook block an edit on this Windows build, and does exit code 2 stop the session instead of letting the agent adapt?

**Status:** CLOSED  
**Source:** E-05 `code.claude.com` — <https://code.claude.com/docs/en/hooks>  
**Retrieved:** 2026-09-13  
**Type:** P

**Finding:**

> Exit 2 means a blocking error.

Verbatim from the cached page (`research/raw/2026-09-13-hooks-reference-claude-code-docs-4f437b44.md`):

> de-2) Exit code 2 Exit 2 means a blocking error. On [events that can block](https://code.claude.com/docs/en/hooks#exit-code-2-behavior-per-event), exit 2 blocks whether or not you print JSON: even a JSON `permissionDecision` of `"allow"`…

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
2. This file covers subtopic **D-8 — Runtime and platform limits** only. The main audit and sibling subtopic audits live alongside it in `research/audits/`.
3. Hand the file (and `research/raw/`) to the builder, or paste the whole document into an AI — every claim cites an evidence ID that maps to a cached primary source.
4. Re-run `node bin/audit.mjs` after further research to bump versions and capture what changed.

## Provenance

- Preflight: PASS (`node bin/preflight.mjs` returns 0)
- Scope: subtopic D-8 (Runtime and platform limits)
- Evidence files: 2 pages from `research/raw/`
- Ledger entries: 7 (chain verified)
- Failures recorded in this scope: 0
- Source of truth: research/DISCOVERY.md, research/EVIDENCE.md, research/MAP.md, research/raw/
- Regenerate: `node bin/audit.mjs` (bumps patch versions for any scope whose fingerprint changed)
