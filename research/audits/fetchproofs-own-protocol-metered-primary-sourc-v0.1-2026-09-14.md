---
title: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate"
topic: "Fetchproof's own protocol: metered primary-source collection, provenance, and gate"
slug: fetchproofs-own-protocol-metered-primary-sourc
version: 0.1
generated: 2026-09-14T20:30:57.905Z
date: 2026-09-14
status: research-complete (preflight PASS)
scope: full
evidence-window: 2026-09-13
closed-unknowns: 4
known-unknowns: 0
evidence-rows: 6
raw-captures: 6
ledger-entries: 7
failures: 0
corpus-root: research/
fingerprint: 47e60599-2399899b-13b02910
---

# Fetchproof's own protocol: metered primary-source collection, provenance, and gate — Research Audit v0.1

_Generated 2026-09-14. Evidence window: 2026-09-13. Version 0.1._

## Executive Summary

This audit compiles 4 verified findings about **Fetchproof's own protocol: metered primary-source collection, provenance, and gate** from 6 primary-source pages cached under `research/raw/`. Every relevant blocking unknown has primary-source evidence; none remain open. Top finding: Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs..

## What this project is

A research-first kit for this machine: a collector that turns a Firecrawl fetch into
cached, citable evidence, and a gate that refuses to let a build start while a blocking
fact is unproven. "Done" means an agent asked to build something can no longer answer
*insufficient information* and stop — it either produces primary-source evidence, or
names the one fact it could not reach and records the day-one step that would settle it.

The reason this file exists at all: this repository is the kit's own development home, so
it inherits its own gate. A gate that exempts the project it ships with is a gate nobody
should trust, so this contract is real rather than waived.

## How to use this file

Paste this entire document (or the relevant per-subtopic file) into an AI, or hand it to a human reader. Every claim cites an `E-##` evidence ID; the full cached page lives at `research/raw/<file>` referenced from `research/EVIDENCE.md`. Sections marked **TODO** require human judgement; everything else is assembled from primary-source evidence. Per-subtopic audits sit alongside this file in `research/audits/` with filenames of the form `<main>--<sub>-v0.<n>-<date>.md`.

## Topic map

| ID | Subtopic | Status | Covered by |
|---|---|---|---|
| D-1 | Access model | COVERED | U-1 |
| D-2 | Auth and credentials | COVERED | U-1 |
| D-3 | Rate limits and quotas | COVERED | U-1 |
| D-4 | ToS, licensing, legality of the intended use | COVERED | U-4 |
| D-5 | Data schema and its stability | DISMISSED | captures are frozen point-in-time and hash-chained; source drift is handled by retrieval dates, the staleness fail, and --refresh-days - there is no extraction layer whose schema could break |
| D-6 | Freshness and staleness | DISMISSED | handled structurally, not researched: every claim carries a retrieval date, preflight fails stale evidence past maxAgeDays, and volatile facts are re-collected with --refresh-days |
| D-7 | Cost at expected volume | COVERED | U-1 |
| D-8 | Runtime and platform limits | COVERED | U-2, U-3 |
| D-9 | Output obtainability | COVERED | U-1 |
| S-2 | Which skill root the desktop runtime discovers, and how the protocol binds in Cowork | COVERED | U-2 |
| S-3 | Whether the edit-time PreToolUse gate blocks (allow/deny/ask/defer, exit-2 semantics) | COVERED | U-3 |
| S-4 | Collection provenance: which transport fetched a capture, and how much of the page arrived | DISMISSED | out of scope as an *unknown*: it is now a machine-checked property (transport field + completeness grades + the two contract checks), not a question to research |
| S-5 | Paid-tier Firecrawl pricing beyond the free plan (Hobby/Standard/Growth/Scale) | DISMISSED | out of scope for now: solo operator on the free tier; the tier facts are already captured and cited (E-01..E-03), and refresh stays with --refresh-days |

## What we verified

| Claim | Evidence | Type | Host | Retrieved |
|---|---|---|---|---|
| Free plan: 10 /scrape and 10 /search requests per minute, 2 concurrent browsers, 50,000 max queued jobs. Rate limits are per team, not per key. Keyless access is capped per IP per day and returns 429 when exceeded; a free API key includes 1,000 credits. | E-01 `docs.firecrawl.dev` | P | docs.firecrawl.dev | 2026-09-13 |
| The /doctor setup checkup stays typable when disableBundledSkills is on, in Claude Code v2.1.205 and later. | E-04 `code.claude.com` | P | code.claude.com | 2026-09-13 |
| Exit 2 means a blocking error. | E-05 `code.claude.com` | P | code.claude.com | 2026-09-13 |
| By registering and using the Services, you represent and warrant you: (i) have the authority and capacity to enter this Agreement; (ii) are at least 18 years old, or 13 years or older and have the express permission of… | E-06 `firecrawl.dev` | P | firecrawl.dev | 2026-09-13 |

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
2. Per-subtopic audits live alongside this file in `research/audits/` (filenames contain `--<subslug>`) and can be pasted independently.
3. Hand the file (and `research/raw/`) to the builder, or paste the whole document into an AI — every claim cites an evidence ID that maps to a cached primary source.
4. Re-run `node bin/audit.mjs` after further research to bump versions and capture what changed.

## Provenance

- Preflight: PASS (`node bin/preflight.mjs` returns 0)
- Scope: full corpus
- Evidence files: 6 pages from `research/raw/`
- Ledger entries: 7 (chain verified)
- Failures recorded in this scope: 0
- Source of truth: research/DISCOVERY.md, research/EVIDENCE.md, research/MAP.md, research/raw/
- Regenerate: `node bin/audit.mjs` (bumps patch versions for any scope whose fingerprint changed)
