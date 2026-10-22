# Deep Research Analysis — Fetchproof (Deep-Research-Agent)

## 1. Executive Summary

**What the project actually is.** The repository holds a self-bootstrapping **research-first gate for AI coding agents** (targeting Claude Code and compatible runtimes) called *fetchproof*. It forces an agent — before any code is written — to decompose a topic, fetch primary-source pages through the Firecrawl CLI, cite every claim with ledger-backed cached captures, and pass a deterministic preflight gate (`node fetchproof/bin/preflight.mjs`) that refuses to let a commit touch product code while a blocking fact is unproven.

**Its main workflow** is a strict five-step phase 1 (decompose → contract → collect → gate → brief), executed on a *collector* machine that holds a Firecrawl API key, after which the corpus (`research/` including its dotfiles under `research/raw/`) crosses through git to a *builder* machine (sandbox, CI, second laptop) that has no key, no Firecrawl egress, and whose collection CLIs deliberately refuse to run. The handoff is verified by `bin/handoff.mjs`. The deliverable is `research/BRIEF.md`, a one-page briefing phase 2 builds from.

**Biggest verified pain points.**
1. The *auto-extracted Finding cell* (`firstFinding()` in `lib/collect.mjs`) reliably pulls page chrome (announcement banners, docs-index lines, marketing copy) instead of facts, so **every evidence row has to be rewritten by hand**. The project's own BRIEF (next-steps §2) names this explicitly and the evidence in `research/EVIDENCE.md` confirms it (E-02's auto-finding is "Free plan: 100,000 credits/month…", an irrelevant pricing-tier headline; E-04's finding is "The /doctor setup checkup stays typable…"; E-05 is "Exit 2 means a blocking error." — all marketing/banner fragments, not the claims the rows were later rewritten to carry).
   *Note added 2026-09-15: `firstFinding()` has since moved out of the collector into `lib/finding.mjs` — ADR-0016, whose trigger fired when the extractor reached 70% of `lib/collect.mjs`. This report is left in its own words; only the pointer is corrected.*
2. **The only transport is the Firecrawl CLI shell invocation**, and every other adapter is rejected by design (ADR-0010). In environments without Firecrawl egress — the builder sandbox, a cloud session, any machine without a paid key — the kit cannot collect at all. Evidence rows fetched there are downgraded to `agent page fetch` transport, which preflight warns as `capture-transport` (6 of 6 rows in this very repo carry that warning), and the builder-side CLIs exit 2. There is no fallback adapter (e.g., a plain `fetch`/HTTPS scraper, Jina Reader, or Crawl4AI) even for public pages that require no JavaScript.
3. **`research/BRIEF.md` is entirely handwritten** after the gate passes. The corpus already contains every fact the brief needs — intent, verified claims with E-## sources, contradictions, deferred unknowns, the decision, next steps — but nothing assembles them. Every project repeats the same prose work at the exact moment the operator is ready to hand off.

**Where the largest automation opportunities appear to be.** (a) Making `firstFinding()` actually find facts so the hand-rewrite step disappears or shrinks to light editing; (b) adding a built-in, keyless HTTP fetch adapter (e.g., Jina Reader `r.jina.ai` or raw `fetch` + HTML-to-markdown) as a second transport alongside `firecrawl-cli`, so the kit works in sandboxes and for public docs without spending credits; (c) auto-generating a draft `BRIEF.md` skeleton from the corpus when preflight passes, eliminating the repetitive write-up at handoff.

---

## 2. Project Reality

### What is verified (VERIFIED)

- **Scope.** The kit implements phase 1 of a two-phase workflow; it deliberately does not build product code. Phase 1 output is a briefing, not code. (VERIFIED — `AGENTS.md` Rule 1, `fetchproof/README.md`, `docs/ARCHITECTURE.md`, and every entrypoint's behaviour.)
- **Language/runtime.** Plain Node.js (>=20) ESM; **no npm dependencies, no `package.json`, no `node_modules/`**. 265 tests all passing, offline, no network, no key. (VERIFIED — file listing, `selftest.mjs` output, `wc -l` across `lib/`.)
- **External dependency.** The *only* scraping transport is the globally-installed `firecrawl` CLI, invoked through `shell: true` with quoted args (`lib/firecrawl.mjs`). The vendor adapter owns all vendor knowledge (shell quoting, ANSI stripping, JSON extraction, payload normalization, failure classification, status parsing). (VERIFIED — `lib/firecrawl.mjs`, ADR-0005.)
  *Note added 2026-09-15: the `shell: true` invocation described here was a remote-code-execution vulnerability — under a POSIX shell `$(…)`, backticks and `$VAR` expand inside the double quotes `quoteArg()` wrapped unsafe input in, so a URL in a `plan.json` executed. The adapter now spawns an **argv array** with `shell: false` and `command()` survives only as a display rendering; the Windows `.cmd` shim is resolved to its full path instead of being handed to a shell. ADR-0020. This report is left in its own words; only the pointer is corrected.*
- **Two-machine split.** Machine role (`collector` default / `builder`) is stored in `~/.agents/fetchproof.config.json`. On a builder, `research.mjs` and `decompose.mjs` refuse before touching any adapter (exit 2). On a collector, missing Firecrawl auth is a hard FAIL in `doctor.mjs`. (VERIFIED — `lib/machine.mjs`, `lib/doctor.mjs`, `bin/decompose.mjs`, `bin/research.mjs`.)
- **Handoff mechanism.** Corpus crosses machines via git; dotfiles under `research/raw/` (notably `.fetches.jsonl`, the hash-chained ledger) are evidence, not byproducts. `bin/handoff.mjs` is the builder's first command and verifies ledger presence, capture presence, and chain integrity. (VERIFIED — README, `AGENTS.md`, `lib/handoff.mjs`.)
- **Gate mechanics.** Preflight (`lib/preflight.mjs`) runs 11 ordered checks from `lib/checks.mjs` against a corpus snapshot, with one verdict function consumed by three surfaces (CLI, commit hook, edit-time hook). Enforcement is fail-open by default, with exactly three logged overrides. (VERIFIED — `lib/preflight.mjs`, `lib/checks.mjs`, `lib/gate.mjs`, `githooks/pre-commit`, `hooks/edit-gate.mjs`.)
- **Edit-time gate defaults to `ask`**, not `hard-block`, because of past Claude Code bugs where `deny` could wedge the session (recorded in BRIEF Contradictions; E-05). `hard-block` is behind config. (VERIFIED — `hooks/edit-gate.mjs`, BRIEF.md.)
- **Provenance chain.** `.fetches.jsonl` is append-only, hash-chained (sha256 of previous entry); captures are graded `completeness: full|partial`; `capture-transport` and `capture-completeness` checks downgrade CLOSED unknowns that rest on non-CLI or partial captures. (VERIFIED — `lib/provenance.mjs`, `lib/checks.mjs`.)
- **`firstFinding()` quality problem is explicitly acknowledged.** The BRIEF's "Next steps" §2 states: "Improve `firstFinding()`: it currently extracts page boilerplate (an announcement banner for E-02, the docs index line for E-03), and every one of those cells had to be rewritten by hand." The current evidence rows confirm this. (VERIFIED — `research/BRIEF.md`, `research/EVIDENCE.md`.)
- **Hosted/cloud gap acknowledged.** Neither enforcement surface runs in hosted/cloud sessions (SKILL.md, ADR-0006); the protocol binds through text (`AGENTS.md` + project skill binding). (VERIFIED — `fetchproof/skill/SKILL.md`, ADR-0006.)
- **Architecture review 2026-09-14 shipped fixes to verdict-input locality and cache-decision single-owner; deferred (did not reject) "corpus joins as data" and "deploy step as lib/"; rejected the finding-extractor split (ADR-0009), with triggers for revisiting.** (VERIFIED — `docs/architecture-review-2026-09-14.md`, ADR-0009.)

### What is unclear (UNKNOWN / UNVERIFIED)

- **Actual user frequency and project volume.** There is no telemetry, no usage data beyond the local `.usage.jsonl` (which this repo shows only the kit's own self-bootstrap research). How often the kit is used on real projects, how many evidence rows a typical project produces, and how much time the human spends rewriting Finding cells are **UNKNOWN** — the BRIEF's "next steps" note states the kit should be used on a real project next, which implies limited real-world exercise.
- **Whether the free Firecrawl tier's 1,000 credits/month is the long-term budget.** DISCOVERY.md lists this as question #2 to the human, unanswered.
- **Firecrawl CLI stability.** The adapter hard-codes several workarounds (`.cmd` shim, ANSI stripping, `extractJson` preferring `{` over `[`, status-text parsing because `--status` exits 0 even when unauthenticated). Whether these still match the current CLI release is UNKNOWN without live testing against a fresh install — the sandbox has no Firecrawl CLI.
- **Whether Crawl4AI / Jina Reader / other scrapers are acceptable alternatives to the operator.** ADR-0005 explicitly rejects a "generic Scraper interface" as a hypothetical seam ("there is one scraper"), but does not forbid adding a second adapter. Operator preference is UNKNOWN.
- **Runtime lock-in.** `lib/machine.mjs` declares runtime anchors (settings file, skill roots) for Claude Code specifically. Whether the kit is intended to support Cursor, Windsurf, Copilot, or other agent runtimes is UNKNOWN; `AGENTS.md` and ADR-0012 say the kit "names no runtime" but the anchor defaults are Claude-shaped.

### Important corrections (documentation vs. implementation)

- **`lib/cli.mjs` does not exist.** `fetchproof/README.md`'s Architecture section still lists `lib/cli.mjs` ("Firecrawl process adapter and payload parsing") and `lib/ledger.mjs` ("Markdown evidence/source persistence") as modules; both were merged/renamed in the ADR-0005 refactor (`firecrawl.mjs` absorbed `cli.mjs`; `corpus.mjs` absorbed ledger row writing; `provenance.mjs` owns the chain). The table is stale.
- **The README architecture table is also missing `lib/decompose.mjs`, `lib/dimensions.mjs`, `lib/handoff.mjs`, `lib/machine.mjs`, `lib/research-run.mjs`, and `lib/timeline.mjs`** — all of which exist and are central.
- **`AGENTS.md` step 3 references `"node fetchproof/bin/research.mjs"` and step 5 `"node fetchproof/bin/preflight.mjs"` with stray double-quotes** after the closing backtick in two places (`research.mjs\"` and `preflight.mjs\"`). Cosmetic but would break a copy-paste.
- **The `fetchproof/README.md` "Why this exists" audit table** references `~/.agents/skills/` having 5 firecrawl skills installed; U-2 closed this as "not a documented discovery path" and the mirror was removed. The audit is historical, not current state — correctly stated as an audit, but could mislead a reader about current disk state.

---

## 3. Current Workflow

End-to-end workflow (verified from AGENTS.md, SKILL.md, bin entrypoints, lib modules, and a live `doctor`/`preflight` run in this sandbox):

```text
[HUMAN / OPERATOR]
   │ opens chat, says "brain — <topic>" (manual)
   ▼
[AGENT on COLLECTOR machine]
   │ asks ≤3 intent questions (manual/cognitive)
   │
   │ ► node bin/decompose.mjs --topic "..." [--recipe ...]     [AUTOMATED, costs ~5-10 Firecrawl credits]
   │       · discovers docs hosts via map(), runs 4 mechanical searches
   │       · scrapes up to 6 candidate pages through collectOne
   │       · writes research/MAP.md with subtopic table EMPTY
   │
   │ → fills MAP.md subtopic table                           [MANUAL]
   │     (marks every row COVERED/DISMISSED/GAP)
   │
   │ → writes research/DISCOVERY.md                          [MANUAL]
   │     (Build intent + blocking unknowns table)
   │
   │ → writes research/plan.json (queries/urls/prefer)       [MANUAL]
   │
   │ ► node bin/research.mjs --plan research/plan.json       [AUTOMATED, budgeted]
   │       · fans out to search(), ranks by preferred domain
   │       · calls collectOne() per URL (cache-first via cacheDecision)
   │       · writes raw captures → research/raw/YYYY-...md
   │       · appends to hash-chained .fetches.jsonl
   │       · appends rows to EVIDENCE.md and SOURCES.md
   │       · Finding cell filled by firstFinding() heuristic
   │
   │ → rewrites every Finding cell into a real claim         [MANUAL — every row]
   │     (adds URL + retrieval date, cites E-## in unknowns)
   │
   │ ► node bin/preflight.mjs                                [AUTOMATED]
   │       · if FAIL → human reads the failing finding, fixes, re-runs  [MANUAL loop]
   │       · if PASS → proceed
   │
   │ → writes research/BRIEF.md by hand                      [MANUAL]
   │     (intent, verified-claims table, contradictions,
   │      known unknowns, decision, first build step)
   │
   │ ► git add -f research/raw/ && git commit && git push    [MANUAL]
   │       (must remember -f for dotfiles; some tools drop them)
   ▼
[HUMAN MACHINE-TO-MACHINE TRANSFER]
   │ Copy-pastes message between collector chat and builder chat,
   │ OR relies on git to carry the corpus.                    [MANUAL, FRAGILE]
   ▼
[AGENT on BUILDER machine (sandbox / CI)]
   │ ► node bin/handoff.mjs                                  [AUTOMATED]
   │       · if FAIL → exit 1; human must go back to collector and push raw/.*
   │       · if PASS →
   │
   │ reads research/BRIEF.md                                 [MANUAL]
   │ → starts phase-2 build (outside this kit's scope)
```

Step-by-step status legend:
- **[AUTOMATED]** — performed by the kit with no human intervention (when the CLI/key is present).
- **[AUTOMATED, costs credits]** — automated but spends Firecrawl credits.
- **[MANUAL]** — human or agent prose work; the gate does not judge quality, only structure.
- **[FRAGILE]** — depends on the operator remembering dotfiles, correct `git add -f`, correct machine role, etc.

The **fragile steps** are:
- Remembering to `git add -f research/raw/` so dotfiles travel (this repository *itself* lost its ledger that way, per the raw capture `why:` frontmatter: "research/raw/.fetches.jsonl was lost when this repo was uploaded without its dotfiles").
- The copy-paste between collector and builder agent chats (per START_HERE.md: "My job: copy, paste, copy, paste").
- The hand-rewrite of every Finding cell.
- Handwriting BRIEF.md.

---

## 4. Manual Work Inventory

| Manual Task | Why It Exists | Frequency | Effort | Automation Potential | Evidence |
|---|---|---|---|---|---|
| Fill the MAP.md subtopic table (COVERED/DISMISSED/GAP) after decompose | Decompose deliberately contains no judgment and no model call (per design); a tool that guessed subtopics would put invented structure at the top of the provenance chain | Once per project | UNKNOWN (likely minutes, 9 universal rows + recipe rows) | Partial — could pre-fill from material gathered, but final judgment is human by design | `lib/decompose.mjs` "contains NO judgment", AGENTS.md rule 1 step 0, ADR philosophy |
| Write DISCOVERY.md (Build intent + unknowns table) | "Intent questions are for intent, never for facts" — the human states what done means; unknowns come from MAP | Once per project | UNKNOWN | Partial — unknown rows can be drafted from MAP GAPs; intent is genuinely human | AGENTS.md Rule 2 |
| Write plan.json (queries/urls/prefer domains) | Collection is metered; queries must be planned before spending credits | Once per project, iterated | UNKNOWN | Medium — could be drafted from unknowns (each U-## → suggested query + preferred domain) | `SKILL.md` cost discipline, `lib/research-run.mjs` |
| Rewrite every auto-extracted Finding cell into a real claim | `firstFinding()` heuristics reliably pull boilerplate/banners instead of facts; agent must rewrite with URL+date+citation | Every evidence row (typically 5–15 rows/project) | "every one of those cells had to be rewritten by hand" — explicit in BRIEF next-steps | **High** — heuristic tuning + fact-biased extraction; the extractor already scores sentences, just on the wrong features | BRIEF.md Next steps §2, EVIDENCE.md rows E-02/E-04/E-05 show banner/boilerplate extractions |
| Write BRIEF.md after preflight PASS | No generator exists; the brief is the phase-1 → phase-2 contract and is considered prose the agent produces | Once per project | UNKNOWN (one page) | **High** — every section has a deterministic source in the corpus; can be drafted as a skeleton for human review | `BRIEF.md` template structure is fixed (Intent/Verified/Contradictions/Known unknowns/Decision/Next steps); corpus contains all data |
| Remember `git add -f research/raw/` so dotfiles travel | `.fetches.jsonl` and other dotfiles are hidden; zip tools, some sync tools, and certain git filters drop them; `.gitignore` deliberately does NOT ignore `.fetches.jsonl` | Every push from collector to builder | Seconds if remembered; costly (broken handoff) if forgotten | Medium — `doctor.mjs` could warn about uncommitted dotfiles before push; or a `bin/bundle.mjs` could package corpus with dotfiles | README "Cloning or zipping" section, raw-file `why:` noting "ledger lost in upload", ADR-0011 |
| Copy-paste messages between the collector chat and the builder chat | Two agents, two machines; human is the transport | Multiple per session | Per START_HERE.md it is the operator's primary ongoing job | Low/Medium (out of scope for the kit itself — this is a UX problem at the chat-tool layer) | START_HERE.md "My job: copy, paste, copy, paste" |
| Run `doctor`/`preflight`/`git status` manually after a session dies | Recovery path is documented (ADR-0013) but must be invoked; no automatic hook triggers on session start | Every session resume | Seconds | Low — ADR-0013 explicitly rejects automated enforcement ("a gate that judges prose is a gate that will be wrong") | ADR-0013 |
| Install + auth the Firecrawl CLI (`npm i -g firecrawl-cli`, `firecrawl login`) | One-time setup | Once per machine | Minutes | Low — installer exists (`install.mjs`) but CLI install and key wiring are external; documented in START_HERE.md | START_HERE.md, `lib/firecrawl.mjs` requireAuth() |
| Rewrite partial-capture unknowns or re-scrape to satisfy completeness | When capture is `partial` (e.g., long docs pages that arrive chunked), preflight warns; human must recollect or demote to KNOWN-UNKNOWN | When long docs are fetched; 3 of 4 unknowns in this repo | UNKNOWN | Medium — a `--interact` or multi-chunk scrape path could address it; Firecrawl's CLI may or may not support full-page capture | Preflight output shows 3 capture-partial warnings in this repo |

---

## 5. Main Problems Discovered

| Rank | Problem | Impact | Evidence | Confidence |
|---|---|---|---|---|
| 1 | **`firstFinding()` auto-extracts boilerplate, not facts** — every evidence row's Finding cell must be rewritten by hand | Adds manual prose work per evidence row on every project; creates a predictable, repetitive edit step that the gate explicitly requires (citations must have useful findings) | BRIEF.md Next steps §2 (explicitly named); EVIDENCE.md E-02/E-04/E-05 extracted text is banners/nav not facts; `collect.mjs` `firstFinding()` heuristics have known blind spots (BOILERPLATE list grew from real fetches, and marketing copy with numbers still wins) | High |
| 2 | **The Firecrawl CLI is the only collection transport; sandboxes/builders/keyless machines cannot collect** — the kit is unusable for collection in the very environment (sandbox/CI) where builders and most agent sessions run, forcing ad-hoc `agent page fetch` workarounds that the gate then warns about | Makes phase 1 impossible outside the operator's Firecrawl-key-equipped PC; forces human copy-paste of corpus across machines; every capture not via CLI downgrades to a `capture-transport` warn (6/6 rows in this repo); blocks cloud/hosted sessions entirely | ADR-0010 (builder-machine refusal by role); `lib/machine.mjs` `collectionPolicy()`; preflight output showing 6 capture-transport warns; ADR-0005 (one Firecrawl adapter, generic Scraper interface rejected); SKILL.md "Where enforcement does not reach" | High |
| 3 | **`BRIEF.md` is entirely handwritten after gate pass** — despite being the single most important handoff artifact with a fixed, corpus-derivable structure, nothing generates it | A repetitive, error-prone write step at the exact moment the operator wants to hand off; a brief that is forgotten means the next agent re-researches everything (per AGENTS.md: "a passing gate with no brief means the next agent re-researches") | AGENTS.md step 6 ("Writing the brief is part of phase 1 and is not optional"); corpus contains every input the brief needs (intent, E-## rows with URLs/types, CLOSED/KNOWN-UNKNOWN statuses, failure log, contradictions require cross-source diff which is harder); no `brief.mjs` exists in `bin/` | High |
| 4 | **Cross-machine handoff is fragile: dotfiles are easy to lose, there is no bundle/verify-push command** | A lost `.fetches.jsonl` breaks the chain and cannot be repaired without re-collecting; this repo itself experienced this (raw front-matter says "research/raw/.fetches.jsonl was lost when this repo was uploaded without its dotfiles") | README "Cloning or zipping" warning; `raw/2026-09-13-*why:` frontmatter; ADR-0011; no `bin/bundle.mjs` or `bin/export-corpus.mjs` | High |
| 5 | **plan.json is authored from scratch for each project** even though the unknowns table in DISCOVERY.md already enumerates what needs researching | Adds planning friction before collection; easy to miss an unknown and trigger preflight FAIL-collect-fix loop | No generator exists; `plan.json` is hand-written JSON per SKILL.md step 3 and `fetchproof/README.md` commands | Medium |
| 6 | **Deploy/install policy lives in `bin/install.mjs` (an entrypoint), not in `lib/`** — testing requires child-process spawning with fake HOME; in-process seam does not exist | Test/maintenance friction; already noted in architecture review candidate 4, deferred as "tidiness on working code" | Architecture review candidate 4; `test/install.test.mjs` spawns the CLI for every assertion; `lib/installer.mjs` exists but does not cover the deploy copy/skill-template logic | Medium |
| 7 | **Edit-time gate defaults to `ask` rather than `hard-block` because of a pre-v2.1.214 Claude Code bug that is reportedly fixed** | In `ask` mode the human must approve every edit that would touch non-research files during a failing gate — an extra click per denied edit; `hard-block` requires live verification on the target runtime | BRIEF.md Contradictions; E-05 hooks docs; hooks/edit-gate.mjs default comment; ADR-0012 | Medium (but depends on runtime version in use) |
| 8 | **Stale docs: README lists non-existent modules (`lib/cli.mjs`, `lib/ledger.mjs`) and misses real ones** | Confuses maintainers and future agents reading the repo | `fetchproof/README.md` Architecture section vs actual `lib/` listing | High |

---

## 6. Potential Subprojects Considered

Before narrowing to three, the following candidates were evaluated:

1. **Smarter `firstFinding()` extractor** — better fact-biased heuristics, structural cues (tables, definition lists, FAQ patterns), and perhaps a second pass that cross-references the `why:` field on the capture. Solves Problem #1. High feasibility (pure-function heuristic module, already has a fixture test, isolated). **Selected.**
2. **Keyless `http` transport adapter** (raw `fetch` + HTML-to-markdown, or Jina Reader `https://r.jina.ai/<url>` which returns clean markdown for free) as a second transport alongside `firecrawl-cli`. Solves Problem #2 — allows collection in sandboxes and for public docs without credits; transports are first-class and named per the provenance design. ADR-0005 left the door open ("if a second scraper ever appears, `exec` is already the injection point to generalise"). **Selected.**
3. **Auto-draft `BRIEF.md` generator** (a new `bin/brief.mjs`) that, when preflight passes, assembles the brief skeleton (intent, verified-claims table, known-unknowns with day-one steps) from the corpus snapshot, leaving contradictions, decision, and next steps as `TODO` sections for the agent/human. Solves Problem #3. **Selected.**
4. **Corpus bundle/export command** (`bin/bundle.mjs` or `bin/push-corpus.mjs`) that creates a tarball/zip that *forces* inclusion of `research/raw/.*` and verifies the bundle contains a valid chain, plus a matching `bin/unbundle.mjs` on the builder. Solves Problem #4. Rejected for top 3 because: the git-plus-`git add -f` workflow is documented, the failure mode is rare, and the subproject is partly addressed by a better doctor warning ("uncommitted dotfiles") which is lower effort.
5. **`plan.json` auto-drafter** that reads DISCOVERY.md unknowns and emits suggested queries + preferred domains. Solves Problem #5. Rejected because: (a) queries are a judgement call that can be wrong and waste credits; (b) it is a smaller win than the three selected; (c) partially addressed if decompose already gathers material.
6. **Deploy refactor** (pulling deploy policy into `lib/deploy.mjs`). Solves Problem #6. Already considered in architecture review candidate 4 and deferred ("tidiness on working code"); does not eliminate user-visible manual work, only test-surface quality. Rejected.
7. **Runtime-agnostic protocol binding** (Cursor, Windsurf, generic hooks). Solves Problem #2 partially for non-Claude runtimes but is large in scope; requires primary-source research into each runtime's hook protocol, which is itself a phase-1 exercise. Rejected.
8. **Finding-extractor split into `lib/finding.mjs`**. Rejected by ADR-0009 until a second consumer exists or the extractor outgrows collect.mjs; the second consumer (brief-draft claim summaries) might be exactly the trigger, but the split itself is cosmetic until then. Rejected as a standalone.
9. **Automatic `doctor`/resume on session start** (e.g., a sentinel file or a wrapper). Explicitly rejected by ADR-0013 ("a gate that judges prose is a gate that will be wrong"). Rejected.
10. **Multi-chunk / full-page scrape** to address partial captures. Would require deeper Firecrawl CLI options research; the current partial-capture warnings are honest disclosures, not failures in pluralist mode. Rejected.

---

## 7. TOP 3 SUBPROJECTS

## Subproject 1 — Smarter First-Finding Extractor

### Problem
Every auto-extracted `Finding` cell in `research/EVIDENCE.md` is page boilerplate (announcement banners, docs-index lines, marketing copy) instead of a useful claim, so every evidence row must be rewritten by hand after every `research.mjs` run. The kit's own BRIEF names this as the next improvement (Next steps §2), and the current evidence rows empirically demonstrate it.

### Evidence
- `research/BRIEF.md` Next steps §2: "Improve `firstFinding()`: it currently extracts page boilerplate (an announcement banner for E-02, the docs index line for E-03), and every one of those cells had to be rewritten by hand."
- `research/EVIDENCE.md` shows the problem live: E-02's finding is a pricing-page tier headline ("100,000 credits/month"), not the comparative pricing fact that row was rewritten to carry; E-04 is a throwaway UI note; E-05 is one decontextualized sentence.
- `lib/collect.mjs` `firstFinding()` (≈140 lines) and its heuristics (`BOILERPLATE`, `FACT_VERB`, `NUMBER_UNIT`, `NAV_SENTENCE`, `CAMPAIGN_SENTENCE`) were visibly tuned against real fetches but produce banner-biased output.
- This is the manual step that happens on *every* evidence row on *every* project, making it the most frequent pain point.

### Proposed Solution
Iterate on `firstFinding()` (and its helpers) so the auto-extracted cell is a genuinely useful draft claim that often survives with little or no editing. Concretely:
1. **Structural cues first.** Detect and prefer content inside markdown tables (pricing pages, rate-limit pages, and billing pages are almost always tabled facts); definition lists (`**Term:** value` pattern); and "Limits", "Pricing", "Authentication" section headers.
2. **Boilerplate improvements.** Expand the `BOILERPLATE` and `NAV_SENTENCE`/`CAMPAIGN_SENTENCE` filters with patterns learned from the current six real captures (launch-week banners, pricing-tier hero numbers, docs-index chrome, cookie/CTA lines).
3. **Bias toward the `why:` field.** When a capture's frontmatter carries `why: "phase 0 material for topic decomposition: <topic>"` or a specific unknown ("U-1 rate limits"), score sentences higher when they share vocabulary with the why/subtopic.
4. **Better page-chrome detection.** Skip all content before the first H1/H2 that isn't "Pricing"/"Documentation"/"Developer docs" generic chrome; recognise hero sections (isolated large numbers = tier callouts, not facts).
5. **Fixture-driven development.** Add test fixtures from each of the 6 current `research/raw/*.md` captures asserting the extractor picks a sentence that actually contains a relevant fact (rate limit numbers, price points, auth statements, ToS clauses) and *does not* pick the current boilerplate winners. The fixtures will pin the regression.
6. Keep the 220-char cap and the fallback to page title. Make no behavior change outside `firstFinding()`; do not split the file (honoring ADR-0009 until a second consumer appears — this improvement counts as heuristic iteration, which ADR-0009 explicitly permits in-place).

### How It Reduces Manual Work
Currently: agent runs `research.mjs` → opens EVIDENCE.md → rewrites N Finding cells by reading each raw capture and writing a real claim.
After: the auto-extracted cell is a useful draft (often a fact-stating sentence from the page body) → agent does a quick scan, edits 0–2 cells instead of all N.

### Workflow
```
Current:
  research.mjs → EVIDENCE.md (N banner/placeholder cells)
  Human reads raw/ for each row → rewrites every Finding → cites E-## → preflight

With subproject:
  research.mjs → EVIDENCE.md (N useful draft cells, fact-biased)
  Human skims → tweaks 0–2 cells → cites E-## → preflight
```

### Inputs
- A raw capture's markdown body, title, frontmatter `why:` and `origin`.
- The existing `firstFinding()` code path and its regex families.

### Outputs
A `Finding` cell string that is a fact-stating sentence drawn from the page body, rarely a banner/nav/marketing line.

### Integration
Pure function inside `lib/collect.mjs` (current location); called from `collectOne()` exactly where it is called now. No interface change. `test/collect.test.mjs` already exercises it; add fixtures from current raw captures.

### Dependencies
None beyond Node builtins. No new npm packages, no new API, no Firecrawl change.

### Technical Feasibility
**High.** This is heuristic tuning of an already-isolated function with existing tests and a regression-fixture path (the repo's own `research/raw/*.md` are the test corpus). All the necessary machinery (sentence splitting, scoring, boilerplate filters) exists; it is a matter of improving features and adding fixtures.

### Complexity
**Low–Medium.** ~1–2 days of focused heuristic iteration plus fixtures. No architecture changes, no new modules, no new surfaces.

### Expected Benefit
Eliminates or drastically shrinks the most repetitive prose step in phase 1, on every project. Makes `research.mjs` output immediately useful instead of requiring a full edit pass.

### Risks
- **Regression risk:** a more aggressive filter might drop real facts in edge cases. Mitigated by fixture tests on the current 6 captures + adding several more from open docs pages.
- **Heuristic drift:** over-tuning against one vendor's docs (Firecrawl, Claude Code) could reduce quality on other sites. Mitigated by keeping the fact-verb and number-unit scoring generic and adding fixtures from a couple of non-vendor sites.
- **False confidence:** better-looking auto-findings might cause an agent to skip reading the raw page. Mitigated by: the cell is still marked as auto-extracted (the Finding column is not a proof — the raw file is), and preflight does not judge Finding quality (this is by design, per AGENTS.md standing protocol: "no check judges prose, because a gate that judges prose is a gate that will be wrong").

### What Could Make This Recommendation Wrong?
- If the operator considers the manual rewrite a *valuable* review step (reading every capture), improving the extractor could reduce how carefully an agent reads the raw pages. Counter: the rewrite step currently replaces a banner with a claim — the agent still has to read the raw to verify even a good draft, and the contract-check regime (citations must trace to the raw file) still requires it.
- If heuristic quality plateaus and best-is-still-bad, the subproject delivers limited value. Counter: even a 50% reduction in rewrites is a meaningful win, and the fixture target is concrete: "the 6 current captures must each produce a non-boilerplate fact sentence."
- If the team prefers an LLM-call-based extractor over heuristics, this is the wrong approach. Counter: the kit explicitly avoids model calls in its machinery (decompose "contains no judgment and no model call"); adding one to the collector would violate the project's philosophy and create a new dependency. Heuristics match the kit's design.

### Confidence
**High.** The problem is explicitly acknowledged by the project itself, the fix is in a bounded, well-tested function, and success is measurable against the repo's own captures.

---

## Subproject 2 — Built-in Keyless HTTP Transport Adapter

### Problem
The kit has exactly one collection transport — the Firecrawl CLI invoked via shell — and everything else is rejected. On a builder machine, the collection CLIs exit 2 by role. In cloud/hosted sessions (Arena, CI, sandboxes), there is no Firecrawl egress. The workaround used in this very repository (visible in the raw files' `command:` frontmatter) is hand-fetching pages via the agent's own page-fetch tool and writing captures stamped with transport `agent page fetch (no Firecrawl egress in sandbox)`, which preflight downgrades to `capture-transport` warnings on all 6 rows. This makes phase 1 unusable outside the operator's key-equipped PC and forces the copy-paste two-machine workflow.

### Evidence
- `lib/machine.mjs` `collectionPolicy()` and `collectionRefusal()`: on a builder, mayCollect=false with reason "builders must not collect."
- `bin/decompose.mjs` and `bin/research.mjs`: both call `collectionPolicy()` before touching any adapter and exit 2.
- `lib/checks.mjs` `transportProvenance` check: explicitly warns on non-`firecrawl-cli` transports (6/6 rows in this repo carry this warning).
- Preflight output (run live in this sandbox): 6 `capture-transport` warnings.
- Raw file frontmatter (e.g., `2026-09-13-pricing-firecrawl-44e1c6cd-2.md`): `command: firecrawl scrape https://... # transport: agent page fetch (no Firecrawl egress in sandbox; no credits spent)` and `why: "...Bytes fetched via the agent page-fetch transport (this sandbox has no Firecrawl API egress; no credits spent) and processed by lib/collect.mjs collectOne..."`.
- ADR-0005 explicitly rejected a "generic Scraper interface" as a hypothetical seam ("there is one scraper"), but left the door ajar: "if a second scraper ever appears, `exec` is already the injection point to generalise."
- ADR-0010 (machine roles) forbids builders from collecting *through some other transport* because "a page fetched by hand is not evidence in this kit, and a builder that 're-collects' a missing page forges a corpus instead of reporting a gap." A *named, ledgered, built-in* adapter is different from a hand-typed capture.

### Proposed Solution
Add a second built-in transport adapter — `lib/http-fetch.mjs` — that fetches public pages through Node's built-in `fetch` (available in Node 20+; the project already requires Node >=20 per `doctor.mjs`), converts HTML to markdown via a lightweight built-in converter (or via Jina Reader `https://r.jina.ai/<url>` as a free, no-key markdown service), and normalises results into the same `{ ok, doc{markdown,title,statusCode}, transport, completeness }` shape the Firecrawl adapter returns. Concretely:

1. **New adapter `lib/http-fetch.mjs`** exposing `scrape(url, { exec, timeoutMs })` (same signature the seam expects), plus a `search()` that uses the Firecrawl CLI search if available, OR falls back to a DuckDuckGo HTML scrape / Jina Reader search, OR is simply absent (no keyless search is acceptable — search is 2 credits per 10 results and is the expensive call; scrape alone unlocks `--url` collection and handoff repair).
2. **Transport name** stamped on ledger entries: `http-native` (raw Node fetch + HTML-to-markdown) or `jina-reader` (Jina), so preflight can identify them honestly rather than treating them as unnamed/agent-fetched.
3. **Completeness grading:** `full` only when the whole document is retrieved; `partial` when Jina/chunking truncates (carrying an `omitted:` note like the existing partial captures).
4. **Machine-policy change:** `collectionPolicy()` on a builder stays "must not collect" *for Firecrawl egress* — but a builder may collect through the keyless adapter for repair purposes? No. Per ADR-0010 the rule is "builder does not collect" specifically to prevent forged corpora. The keyless adapter is a **collector-only** transport (used when no Firecrawl key is available, e.g., sandbox sessions used as collector) and a **dry-run/verification** aid; it does NOT relax the builder-machine refusal. The naming (`transport: http-native`) still lets preflight flag it via transport-provenance, which then becomes operator-configurable (pluralist warns, strict fails) — the same regime as today's partial-capture warnings.
5. **New CLI flag:** `node bin/research.mjs --transport http-native ...` (or `--transport auto`, which tries firecrawl-cli first then falls back). Default remains `firecrawl-cli` when available.
6. **Doctor update:** On a collector without Firecrawl auth, if the built-in adapter is available, report it as a pass/info ("keyless HTTP adapter available — --transport http-native") rather than a hard FAIL (current behavior: `firecrawl-cli not installed` is a FAIL on a collector). This unlocks using the kit in this sandbox (and on any developer machine without a Firecrawl subscription) for public docs research.

### How It Reduces Manual Work
- Makes phase 1 usable in sandboxes, CI, cloud sessions, and on machines without Firecrawl keys, eliminating the current "agent page fetch" manual workaround.
- Reduces the need for two machines for simple public-docs research projects.
- Eliminates the 6 `capture-transport` warnings in this repo (captures become legitimate named-transport entries).

### Workflow
```
Current (sandbox/cloud session):
  Agent runs research.mjs → fails (builder/keyless) → agent manually fetches
    pages via its own page-fetch tool → manually writes raw/*.md with frontmatter
    → manually appends to EVIDENCE.md and SOURCES.md → transport shows as
    "agent page fetch" → preflight warns on every row.

With subproject:
  Agent runs research.mjs --transport http-native --url <url>
  → http-fetch adapter fetches via Node fetch / Jina → collectOne writes raw
    with transport: http-native, completeness: full/partial → ledger entry
    stamped → EVIDENCE.md row appended → preflight warns per evidencePolicy
    (same regime as today, but no manual fetch/write).
```

### Inputs
- Target URL, options (timeout, which sub-adapter: native/jina).
- For the native path: target URL's HTML; a lightweight HTML→markdown converter (either a small inline converter or a dependency-free approach using regex/DOMParser-free parsing; or alternatively commit to Jina as the default to avoid bundling an HTML parser).
- For the Jina path: just an HTTP GET to `https://r.jina.ai/<url>` which returns plain markdown (no key required).

### Outputs
Same normalized scrape result as the Firecrawl adapter: `{ ok, command, doc{markdown,title,statusCode,sourceURL}, error, transport, completeness }`.

### Integration
- New file `lib/http-fetch.mjs` alongside `lib/firecrawl.mjs`.
- Injected through the existing `runScrape` seam (the same seam that already enables offline testing) — no signature change needed in `collect.mjs` or `research-run.mjs`.
- CLI flag plumbing in `bin/research.mjs`; transport selection logic.
- `transport-provenance` check already handles named transports generically; add tests.

### Dependencies
- **Primary option (recommended): Jina Reader API (`https://r.jina.ai/`)** — free, no API key for basic use, returns clean markdown for any URL. [VERIFIED via web search — see Source Audit]
- **Alternative:** Node 20+ built-in `fetch`; HTML-to-markdown would need either a small bundled dependency (which the project currently avoids) or a very small purpose-built converter for common doc pages.
- No Firecrawl key or CLI required for the keyless path.

### Technical Feasibility
**High.** The transport seam (`runScrape` injection) was designed for exactly this kind of adapter replacement (used pervasively in tests). Jina Reader is a single HTTP GET returning markdown — trivial to integrate. The transport name, completeness, and failure classification already have first-class fields.

### Complexity
**Medium.** New file (~150–250 lines mirroring `firecrawl.mjs`'s scrape shape — no search/map/status/auth needed for v1), CLI flag plumbing, doctor change, and new tests. The search/map/status commands can continue to require Firecrawl (or be marked unsupported in the keyless transport) to keep v1 small.

### Expected Benefit
- Makes the kit immediately usable in sandboxes and cloud sessions (including the Arena environment it is currently being evaluated in).
- Reduces operator dependence on a paid Firecrawl subscription for simple public-docs research.
- Provides an honest, named transport instead of the current "agent page fetch" workaround, letting evidence policy (pluralist/strict) govern it consistently.

### Risks
- **ToS/legality of Jina Reader (or native fetching):** Jina is a third-party service; fetching a vendor's docs via Jina rather than directly could raise questions. Mitigation: Jina is just a reader/proxy; the primary source being cited is still the vendor's page. Native `fetch` is direct HTTP and raises no ToS questions beyond normal web access (and the kit already verifies Firecrawl's own ToS allows this use in E-06).
- **Content quality:** Jina/naive fetch may miss JavaScript-rendered content (rate-limit tables loaded dynamically, SPA doc sites). Mitigation: grade captures `partial` when content is detected as incomplete; users can fall back to Firecrawl for JS-heavy sites.
- **ADR-0010 tension:** adding a keyless transport could be misread as weakening the builder-machine rule. Mitigation: keep `collectionPolicy()` refusing on builders regardless of transport; the HTTP adapter is a **collector**-side alternative, not a builder-side loophole.
- **A second adapter dilutes ADR-0005's "one vendor adapter" claim.** Mitigation: ADR-0005 anticipated this ("if a second scraper ever appears, `exec` is already the injection point to generalise"); a new ADR can supersede the "one scraper" rationale with "one Firecrawl adapter + one keyless HTTP adapter for public pages."

### What Could Make This Recommendation Wrong?
- If the operator explicitly wants the kit to require Firecrawl (e.g., to ensure consistent output quality or to justify the Firecrawl subscription), a keyless adapter works against that. Counter: the free Jina path is explicitly a *fallback* that produces lower-grade, honestly-labeled captures; the design does not remove or demote the Firecrawl path.
- If Jina Reader's free tier changes, disappears, or introduces rate limits that break the kit. Counter: the native-fetch sub-adapter is a backup; the Firecrawl CLI path remains primary.
- If the builder/collector split is philosophically important and even a named collector-side fallback is seen as a slippery slope. Counter: the split's purpose is "no forged corpora on the builder," not "every collector must use Firecrawl."

### Confidence
**Medium–High.** The seam is ready; the technical work is bounded; the main uncertainty is operator preference on transport purity. That question does not block the recommendation but may affect whether HTTP-native or Jina is chosen as the default.

---

## Subproject 3 — Auto-Drafted `BRIEF.md` Generator

### Problem
After preflight passes, the agent/human must write `research/BRIEF.md` entirely by hand. The brief has a fixed, documented structure (Intent, What we verified, Contradictions, Known unknowns, Decision, Next steps) and every piece of information it requires already exists in the corpus: intent from DISCOVERY.md, verified claims from EVIDENCE.md rows cross-referenced to CLOSED unknowns, known unknowns from U-## rows with KNOWN-UNKNOWN status, and contradictions are the only section requiring actual judgment (detecting disagreeing sources). Despite this, no generator exists, and AGENTS.md explicitly says "a passing gate with no brief means the next agent re-researches everything you just verified."

### Evidence
- `AGENTS.md` step 6: "Write `research/BRIEF.md` — intent, verified claims with sources, contradictions and how they were resolved, known unknowns with their day-one verification steps, and the first build step. That brief is what the builder reads; phase 2 begins there, not here. Writing the brief is part of phase 1 and is not optional."
- `fetchproof/README.md` "Two phases, two roles": "Output: verified claims, cached pages, a fetch ledger → the actual product".
- `fetchproof/skill/SKILL.md` Output section lists the brief's required sections verbatim.
- `research/BRIEF.md` in this repo is a hand-written instance following exactly that structure.
- `corpus.mjs` already parses every needed artifact into structured data (`intent`, `unknowns` with statuses and evidenceRefs, `evidence` with id/url/type/finding/raw, `sources`, `failures`).

### Proposed Solution
Add `bin/brief.mjs` (and the policy in `lib/brief.mjs`) that, when preflight passes:

1. Reads the corpus via `verdictContext()` / `readCorpus()`.
2. Refuses (exit 1) if preflight is not PASS (same principle as the gate).
3. Writes a draft `research/BRIEF.md` containing:
   - **Intent** — verbatim from `corpus.intent` (the Build Intent section of DISCOVERY.md).
   - **What we verified** — a markdown table with one row per CLOSED unknown: Claim (the `Unknown` text, lightly), Source (E-## id + host), Type (from the evidence row). Auto-generated; the Finding cells already carry the claim text after Subproject #1.
   - **Contradictions** — a `TODO: review sources that appear to disagree; record both and say which you trust and why` section (cannot be fully automated, but the heading is inserted so the agent/human does not forget it).
   - **Known unknowns** — one bullet per KNOWN-UNKNOWN row, carrying its day-one verification step from the Evidence cell.
   - **Decision** — `TODO: state the phase-2 build decision and what is out of scope`.
   - **Next steps** — generated list: (1) run the build from BRIEF.md; (2) re-run preflight after any new evidence.
4. **Does not overwrite** an existing BRIEF.md (safe default); `--force` overwrites sections it can prove are still auto-generated (or just errors out asking for `--force`).
5. Optionally, integrates into `research.mjs` success output ("PASS — run `node bin/brief.mjs` to draft the handoff") and into preflight's PASS message.

### How It Reduces Manual Work
The brief is the last prose step of phase 1. All the data is already in the corpus; today the agent must read every file and reformat it into a one-page handoff. A generator produces a correct, complete draft in milliseconds, leaving only the Contradictions and Decision sections — the parts that actually require judgement — for the human/agent.

### Workflow
```
Current:
  preflight PASS → agent reads DISCOVERY/EVIDENCE/SOURCES/MAP/raw → writes
    BRIEF.md from scratch (intent table, verified-claims table,
    contradictions paragraph, known-unknowns list, decision, next steps)
  → git commit → push.

With subproject:
  preflight PASS → bin/brief.mjs → BRIEF.md draft (tables filled, TODOs
    for judgement sections) → agent fills in Contradictions and Decision,
    lightly edits → git commit → push.
```

### Inputs
- Corpus snapshot (intent, unknowns, evidence rows, sources).
- Preflight verdict (only runs on PASS).

### Outputs
- `research/BRIEF.md` with auto-filled sections and explicit TODO markers for sections requiring human judgment.
- Exit code 0 on success, 1 if preflight does not pass, 1 if BRIEF.md already exists (without `--force`).

### Integration
- New entrypoint `bin/brief.mjs`, new module `lib/brief.mjs` (small: ~100–200 lines of rendering).
- Consumes `verdictContext()` from `lib/preflight.mjs` (single source of truth, same as doctor and gate).
- Emits markdown; uses `tableRow()`/`escapeCell()` from `corpus.mjs` so tables round-trip.
- Reference templates from `fetchproof/template/` can ship a brief skeleton too.

### Dependencies
None beyond existing modules. Pure rendering from the corpus.

### Technical Feasibility
**High.** The corpus reader already provides every piece of structured data needed. The output is a fixed-shape markdown document. The only section that cannot be automated (contradiction detection between sources) is explicitly left as a TODO with a clear prompt.

### Complexity
**Low.** ~150 lines of rendering code plus tests. New entrypoint. No new seams, no new dependencies.

### Expected Benefit
- Eliminates a repetitive, formulaic prose step at the end of every phase 1.
- Guarantees no section is forgotten (AGENTS.md notes "Writing the brief is part of phase 1 and is not optional" — today it is easy to forget).
- The brief becomes a deterministic artifact from the corpus, not a fresh composition each time.

### Risks
- **Auto-generated prose may create a false sense of completeness.** Mitigated by: leaving Contradictions and Decision as explicit TODOs (never auto-filling them); refusing to overwrite; clearly labeling the file as a draft.
- **Coupling to corpus shape:** if the corpus format evolves, brief rendering can drift from the underlying data. Mitigated by consuming only through `corpus`/`preflight` public APIs (which already have test fixtures).
- **ADR-0009 trigger:** a brief generator might want to extract one-line claim summaries from raw pages — this is a second consumer of `firstFinding()`, which is exactly trigger (1) for splitting the extractor to `lib/finding.mjs`. That is a *good* thing — it would justify the boundary move ADR-0009 is waiting for. Coordinate with Subproject #1.

### What Could Make This Recommendation Wrong?
- If the operator considers brief-writing a valuable synthesis step that forces the agent to read everything one more time. Counter: the brief *still* requires filling Contradictions and Decision; the auto-draft only removes the formulaic tabulation. The synthesis still happens — but without retyping URL/host/type rows.
- If generated briefs are lower quality than hand-written ones in ways that mislead phase-2 builders. Mitigated by: explicit draft/TODO markers, no overwrite, and preflight gating (brief is only generated after PASS, so the underlying evidence is already solid).
- If the operator wants the brief to be a polished narrative rather than a structured document. Counter: the current brief template (in this repo's BRIEF.md) is already structured exactly as the generator would produce; the project has already committed to that shape.

### Confidence
**High.** The structure is fixed, the data is already parsed, and the code surface is small. This is the lowest-risk, highest-certainty subproject of the three.

---

## 8. Comparison

| | Subproject 1: Smarter firstFinding | Subproject 2: Keyless HTTP Transport | Subproject 3: Auto-draft BRIEF |
|---|---|---|---|
| Problem severity | High (every evidence row, every project) | High (blocks use in sandboxes/cloud) | Medium (formulaic step at handoff) |
| Manual work reduction | Large (rewrite N rows → edit 0-2) | Large (eliminates manual agent-page-fetch workaround) | Medium (writes structured tables; leaves 2 TODO sections) |
| Practical value | Immediate, every future project | Unlocks new environments (sandbox/CI/keyless) | Every project's handoff is faster and less error-prone |
| Complexity | Low–Medium (heuristics + fixtures) | Medium (new adapter, CLI flag, doctor change, ADR update) | Low (rendering, ~150 LOC) |
| Dependencies | None | Jina Reader API (free, no key) or Node builtin fetch | None |
| Risk | Low (regression in extractor quality) | Medium (transport philosophy, ToS, JS-rendered content) | Low (drift from corpus shape) |
| Time-to-value | Fast (heuristic iteration, fixtures exist) | Medium (new adapter requires careful testing + ADR) | Very fast (straightforward renderer) |
| Reusability | High (improves every project's output) | Medium (enables new environments but only for public docs) | Medium (used once per project at handoff) |
| Evidence strength | Very High (explicitly named by project BRIEF, visible in current data) | High (visible in this repo's 6 transport warnings and raw-file frontmatter) | High (structure fixed by SKILL.md/AGENTS.md; data exists) |
| Overall priority | 1 | 2 | 3 |

---

## 9. Recommended Order

### Build First — Subproject 1 (Smarter `firstFinding()`)
**Why.** Highest-frequency pain point (touches every evidence row), lowest complexity, explicitly named by the project itself as the next thing to fix, no new dependencies, no ADR changes, no new surfaces, and its improvement directly *feeds* Subproject 3 (auto-brief needs useful Finding cells to produce good claim tables). It is also the only subproject the architecture review's "Next steps" in the project's own BRIEF calls out. Build it first, using the repo's own six `research/raw/*.md` captures as the fixture corpus: for each capture, assert that the extractor returns a fact sentence (not the banner). Ship it, then re-run `research.mjs` against the existing plan to confirm the new Finding cells are useful.

### Build Second — Subproject 3 (Auto-draft BRIEF)
**Why.** After Subproject 1 lands, Finding cells are useful; Subproject 3 can then produce a quality draft brief immediately. It is low-risk (pure rendering from the corpus), takes minimal code, and completes the phase-1 workflow by eliminating the last hand-written deliverable. It is also a natural moment to revisit ADR-0009 trigger (1): a second consumer of `firstFinding()` (brief claim summaries) justifies splitting the extractor to `lib/finding.mjs` if that boundary now helps.

### Build Third — Subproject 2 (Keyless HTTP Transport)
**Why.** Highest value in terms of unlocking new environments, but higher complexity and some design decisions (Jina vs native fetch, how it interacts with the collector/builder machine-role policy, whether to support search/map, whether it needs a new ADR superseding part of ADR-0005). It also benefits from Subprojects 1 and 3 being in place because when users can collect in sandboxes without a Firecrawl key, they will also immediately benefit from better Finding cells and auto-briefs. Do it third, after the workflow is polished for Firecrawl-equipped collectors.

---

## 10. Research Gaps

| Gap | Why it matters | Resolving source | User action needed? |
|---|---|---|---|
| **Real-world usage statistics** — how many projects, how many evidence rows per project, how much time users spend on Finding-cell rewrites / brief-writing | Would ground effort/frequency estimates; currently effort and frequency are UNKNOWN in the manual work table | Telemetry (the kit has none by design), or operator experience report | Optional: operator can describe how often and on what kinds of projects they use the kit |
| **Operator preference on transport purity** — whether a keyless HTTP adapter is welcome or seen as weakening the Firecrawl-first philosophy | Determines whether Subproject 2 is a win or a design regression | Operator input; possibly a new ADR | Yes — one question (see §11) |
| **Firecrawl CLI version compatibility** — whether the workarounds in `lib/firecrawl.mjs` (`.cmd` shim, ANSI stripping, JSON `[` vs `{`, status-text parsing) still match the current CLI release | Could affect reliability; the sandbox has no Firecrawl CLI installed to verify | Live Firecrawl install (`firecrawl --version`) against the current npm release | Optional: `firecrawl --version` and `firecrawl --status` from the operator's collector machine |
| **Jina Reader (`r.jina.ai`) ToS and rate limits** for programmatic agent use | Affects Subproject 2's primary sub-adapter choice; Jina's free tier may have unstated limits | Jina's official documentation (https://jina.ai/reader/) | No — can be researched in phase 0 of Subproject 2 |
| **Target runtime scope** — is Claude Code the only target, or are Cursor/Windsurf/Copilot in scope? | Affects whether runtime-agnostic work belongs on the roadmap | Operator intent | Optional (not blocking for the three recommendations) |
| **Long-term budget** — free tier vs paid Firecrawl plan | Determines how important the keyless adapter is economically | DISCOVERY.md question #2 (still unanswered) | Optional (asked already in DISCOVERY.md) |

---

## 11. Questions for the User

One question could materially change the recommendation order:

1. **Would you welcome a built-in keyless HTTP fetch adapter (e.g., via Jina Reader or native Node fetch) as a first-class transport alongside `firecrawl-cli`, with its own named transport stamped into the ledger, or do you want the kit to require Firecrawl as the one and only collection path?**
   - If the operator wants to keep Firecrawl as the sole transport (philosophical or quality reasons), Subproject 2 should be swapped for the corpus-bundle/export command (Subproject candidate #4 in §6) which addresses the handoff fragility without changing the transport model.
   - If the operator is open to a keyless fallback, Subproject 2 stays ranked #2.

No additional user information is required to make the other two recommendations (firstFinding improvement, auto-draft BRIEF); those are grounded in the repo's own stated next-steps and in the verified code structure.

---

## 12. SOURCE AUDIT

| Source | What it verifies | Source type | Confidence |
|---|---|---|---|
| `AGENTS.md` (in repo) | Phase-1/2 split, two-machine roles, gate sequence, brief-as-required-deliverable, three overrides, resume protocol, standing protocol | Primary (project documentation, shipped with the code) | High |
| `CONTEXT.md` (in repo) | Canonical definitions of all domain terms (collector, builder, handoff, evidence, gate, verdict, transport, cache decision, etc.) | Primary (glossary, shipped with code) | High |
| `docs/ARCHITECTURE.md` (in repo) | Module ownership map, seams, current shape (11 checks, 4 gate markers, 2 enforcement surfaces, 9 universal dimensions) | Primary (architecture doc, maintained same-commit per ADR-0007) | High |
| `docs/architecture-review-2026-09-14.md` (in repo) | Shipped fixes (verdict context, cache decision), deferred/refuted candidates, test count (247 post-fix, all passing) | Primary (review document) | High |
| `docs/adr/0001…0013/*.md` (in repo) | Recorded decisions: canonical project shape, fail-open posture, single corpus owner, contract checks registry, Firecrawl adapter, skill binding, architecture-map-same-commit, guarded paths as config, finding extractor stays (with triggers), machine roles, handoff integrity, runtime anchors/no-builder, resume as documentation | Primary (Architecture Decision Records) | High |
| `fetchproof/lib/*.mjs` (source) | Actual implementation of every component described above; module boundaries; injected seams; gate policy; transport shape; failure classification | Primary (source code) | High |
| `fetchproof/bin/*.mjs`, `githooks/pre-commit`, `hooks/edit-gate.mjs` | Entrypoint behavior, CLI flags, fail-open shell hook, edit-gate decision logic | Primary (source code) | High |
| `fetchproof/test/*.mjs` (265 tests) | Tested behavior and pinned invariants | Primary (test code, verified passing) | High |
| Live `node bin/doctor.mjs` run in sandbox | Doctor reports Firecrawl not installed (1 blocker), kit running from non-install path, 265/265 tests pass | Primary (live run, verified) | High |
| Live `node bin/preflight.mjs` run in this sandbox | Preflight output: PASS with 10 warnings (6 capture-transport, 3 capture-partial, 1 citation-primary); 4/4 unknowns closed, 6 evidence rows, 6 raw files | Primary (live run, verified) | High |
| Live `node bin/selftest.mjs` run | 265 tests all passing from current checkout | Primary (live run) | High |
| `research/BRIEF.md`, `research/DISCOVERY.md`, `research/EVIDENCE.md`, `research/plan.json`, `research/kit.json` | Project's own research corpus; confirms the Finding-quality problem, the contradictions/known-unknowns structure, and the next-steps list naming firstFinding() as a priority | Primary (the project's own phase-1 output) | High |
| `research/raw/*.md` (6 raw captures, 2026-09-13) | Live captures show `transport: agent page fetch (no Firecrawl egress in sandbox)` workaround and the ledger-loss incident | Primary (raw evidence files) | High |
| `fetchproof/README.md`, `fetchproof/skill/SKILL.md`, `START_HERE.md` | User-facing documentation; includes the stale architecture table (correction noted in §2) | Primary (shipped documentation) | High |
| Jina AI Reader (https://jina.ai/reader/), cited via secondary list | Free, keyless URL-to-markdown service — referenced as a candidate Subproject 2 sub-adapter; primary API docs were not fetched in this sandbox (no Firecrawl egress) | Secondary (web search result) | Medium — see research gap; should be fetched in phase 0 of Subproject 2 before committing to it |
| Bright Data blog "10 Best Firecrawl Alternatives" (https://brightdata.com/blog/ai/firecrawl-alternatives) | Lists Crawl4AI (OSS, 78k+ GitHub stars), Jina AI Reader (10M free tokens), Apify, Tavily, Exa, etc., as alternative scraping/search APIs | Secondary (vendor blog, 2026) | Medium–Low — used only for ecosystem context, not as a basis for a concrete recommendation beyond noting alternatives exist |
| fastCRW (https://fastcrw.com/alternatives/firecrawl) | Self-hostable AGPL-3.0 Firecrawl-compatible Rust binary | Secondary (vendor marketing page, 2026) | Low — not used as a basis for recommendation; noted for awareness |

For any claim about the project's own code, behavior, or documentation, the primary source (the code or file itself) was inspected directly, as cited above. External ecosystem claims (alternative scrapers, Jina's free tier) come from web search and are flagged as secondary; they would need primary-source verification (fetching Jina's official docs, confirming rate limits) during phase 0 of Subproject 2 before implementation begins — consistent with the kit's own research-first protocol.
