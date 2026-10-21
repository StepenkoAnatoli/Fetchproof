# Brief - Which skills from StepenkoAnatoli/SkillsMDs, plus a role-aware router, should Fetchproof ship for builders and collectors?

_Auto-drafted 2026-10-06 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** The configured research checks passed. Disclosed known unknowns
and gate warnings still apply; PASS does not establish that every claim is correct.

**Gate warnings from this evaluation: 17.**

These findings apply to the whole corpus at the time of this evaluation. Re-run
preflight after edits; this list is not a fresh evaluation of the resulting document.

- **transport-provenance/transport-not-metered** (E-01): E-01 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-02): E-02 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-03): E-03 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-04): E-04 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-05): E-05 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-06): E-06 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-07): E-07 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-08): E-08 was collected by "http-keyless", not the metered Firecrawl CLI
- **gate-integrity/local-hooks-path**: this repository sets core.hooksPath=/home/runner/work/Fetchproof/Fetchproof/.git/copilot-hooks, which displaces the machine-wide commit gate
- **collection-attempts/unknown-attempted** (U-07): U-07 is KNOWN-UNKNOWN with no recorded fetch attempt - an unreachable fact should have been reached for
- **corroboration/single-source** (U-01): U-01 rests on E-01 alone - one reading, so a correct source and a lucky one look the same
- **corroboration/single-source** (U-02): U-02 rests on E-02 alone - one reading, so a correct source and a lucky one look the same
- **corroboration/single-source** (U-03): U-03 rests on E-03 alone - one reading, so a correct source and a lucky one look the same
- **corroboration/one-voice** (U-04): U-04 cites 3 rows and all are githubusercontent.com - a second reading of one source, which catches a misreading and not a source that is wrong about itself
- **corroboration/one-voice** (U-05): U-05 cites 3 rows and all are githubusercontent.com - a second reading of one source, which catches a misreading and not a source that is wrong about itself
- **corroboration/one-voice** (U-06): U-06 cites 2 rows and all are githubusercontent.com - a second reading of one source, which catches a misreading and not a source that is wrong about itself
- **corroboration/one-voice** (U-08): U-08 cites 3 rows and all are githubusercontent.com - a second reading of one source, which catches a misreading and not a source that is wrong about itself

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> I expect SkillsMDs to be Apache-2.0; the Agent Skills spec to require SKILL.md at a directory root with name matching the directory; lead-orchestrator to be the model-routing skill and auto-build the skill-composing one; both to forbid --no-verify. I cannot know yet whether the zipped .skill files can be captured as evidence at all.

## Intent

Fetchproof ships a skill set beside `research-first`: the owner's skills from
StepenkoAnatoli/SkillsMDs (pinned at commit 3f2d2fc6627d63ea93ff97d4d33845a753db16cc),
a set of kit-authored phase skills, and a `skill-router` that sends an agent to a skill by
the machine's role and the project's gate state - never a builder to a skill that
collects. `install.mjs` deploys every skill to every skill root and, with `--into`, to the
project skill directory. Done means: every shipped skill is a valid skill directory (its
SKILL.md `name` equals its directory name, its description fits the limit), the installer
places each one where a runtime discovers it, the router's table is tested against the
collecting skills, and the vendored text keeps its licence. Phase 2 is this repository's
own build; this project only decides what to ship and why.

## What we verified

| Claim | Source | Type |
|---|---|---|
| SkillsMDs at the pinned commit is licensed under the Apache License 2.0, which permits redistribution and modification provided the licence text travels with the copy and modified files carry a notice. Vendoring the skills into the kit therefore needs LICENSES/Apache-2.0.txt and a REUSE annotation, not a relicence. [quote: Version 2.0, January 2004] | E-01 `raw.githubusercontent.com` (U-01) | P |
| A skill is a directory holding SKILL.md at its root with YAML frontmatter; `name` is lowercase letters, digits and single hyphens, at most 64 characters, and must equal the directory name; `description` is at most 1024 characters. So `lead-orchestrator`, shipped as leadorchastratorv2/leadorchastratorv2.md, is not a valid skill until it is renamed. [quote: Must match the parent directory name] | E-02 `raw.githubusercontent.com` (U-02) | P |
| Clients discover skills by scanning each skills root for subdirectories that contain a file named exactly SKILL.md; a skill nested inside another skill's directory is not a sibling and is not the documented shape. The `.agents/skills/` path is described as a widely adopted cross-client convention - a contradiction with ADR-0006's 2026-09-13 finding, recorded in the brief. [quote: Within each skills directory, look for **subdirectories containing a file named exactly `SKILL.md`**:] | E-03 `raw.githubusercontent.com` (U-03) | P |
| lead-orchestrator is the routing skill: it chooses the model per sub-agent (most capable by default, a faster one only where capability cannot affect correctness), keeps builders from re-researching, and forbids gate bypass. It names two bundled references, references/research-kit.md and references/agent-briefs.md, that are not under those names at the pinned commit. [quote: - Never bypass a gate: no `--no-verify`, no gate-off files, no hand-written evidence.] | E-04 `raw.githubusercontent.com` (U-04, U-05, U-06) | P |
| auto-build routes between skills rather than models: it composes lead-orchestrator, brainstorming, break-test, gap-audit and four-dimension-audit, and lists --no-verify among the things it never does. Its frontmatter name `auto-build` matches its directory. [quote: Composes lead-orchestrator, brainstorming, break-test, gap-audit and four-dimension-audit; never replaces them.] | E-06 `raw.githubusercontent.com` (U-04, U-05, U-08) | P |
| break-test closes external facts through Fetchproof and, when the kit is not deployed, runs it from the checkout with the keyless transport - a collection step, which a builder machine refuses (exit 2). [quote: `RESEARCH_KIT_TRANSPORT=http-keyless`) and say so in the report] | E-07 `raw.githubusercontent.com` (U-04, U-08) | P |
| agent-briefsv2.md is the brief-template file lead-orchestrator calls references/agent-briefs.md: its preamble defers model choice to that skill's rule. Vendoring must rename it to the path the skill names. [quote: the lead selects the model for the agent according to the rule in SKILL.md ("Model selection] | E-05 `raw.githubusercontent.com` (U-05, U-06) | P |
| break-test's Fetchproof reference describes scaffolding, decomposing and collecting a nested project during a break test - phase-1 work that belongs to a collector, so a router must not send a builder there. [quote: export RESEARCH_KIT_TRANSPORT=http-keyless] | E-08 `raw.githubusercontent.com` (U-08) | P |

## Contradictions and how they were resolved

- **Where skills are discovered.** E-03 (the Agent Skills client guide) describes
  `.agents/skills/` as a widely adopted cross-client convention. ADR-0006 (2026-09-13,
  resting on the root corpus's E-04) found `~/.agents/skills/` read by no runtime and
  deleted the kit's mirror there. The two are not about the same moment: E-03 is a guide
  for implementers, current on 2026-10-06, and says the specification itself does not
  mandate a location. Trusted for this decision: neither is needed - the kit already makes
  skill roots configurable (`skillRoots`, ADR-0012), so a machine whose runtime scans
  `.agents/skills/` adds that root and every shipped skill follows. Not resolved here: whether
  the anchored default should change. That is a separate question for its own project, and
  this brief does not re-litigate ADR-0006.
- **lead-orchestrator's file names.** E-04 names `references/agent-briefs.md` and
  `references/research-kit.md`; the folder at the pinned commit holds
  `agent-briefsv2.md` (E-05) and no research-kit reference. Resolved by renaming
  `agent-briefsv2.md` to the path the skill names, and pointing the missing
  `references/research-kit.md` at the kit's own `research-first` skill, which is the
  protocol that file would describe - said in the vendored copy, not silently.
- Corroboration: every row is the owner's own file or the specification's own repository,
  so U-04..U-08 are one voice each (the gate says so). For a decision about which of the
  owner's own files to ship, the owner's files are the authority; no second source exists
  or is needed.

## Known unknowns

- **U-07** - What do the zipped `.skill` files (careful-coding, brainstorming, architecture-pass, improve-codebase-architecture, four-dimension-audit, gap-audit, subproject-discovery) say? (D-1, S-2)
  - Known so far: Attempted 2026-10-06: the keyless fetch of careful-coding.skill failed, the response being application/octet-stream (a zip archive), which a text transport refuses.
  - Day-one verification: unzip each archive at the pinned commit, check its SKILL.md frontmatter with the kit's skill-set test, and read it for `--no-verify`, gate-off files or hand-fetched evidence before it ships; the vendoring commit records the archive's sha256.

## Decision

Ship, under `fetchproof/skills/<name>/` (sibling directories, E-03 - not inside
`research-first`, which deploys to its own directory):

1. **The SkillsMDs skills, vendored as received**, Apache-2.0 (E-01) with
   `LICENSES/Apache-2.0.txt` and a REUSE annotation: `auto-build`, `lead-orchestrator`,
   `break-test`, `brainstorming`, `careful-coding`, `architecture-pass`,
   `improve-codebase-architecture`, `four-dimension-audit`, `gap-audit`,
   `subproject-discovery`. Only the changes the format forces: lead-orchestrator's file
   becomes `SKILL.md` in a directory named `lead-orchestrator` (E-02), its brief templates
   become `references/agent-briefs.md` (E-05), and a `references/research-kit.md` pointer
   is added (E-04). Archive sha256 values for U-07 are recorded in the vendoring ADR.
2. **A `skill-router` skill**: routes by role (`doctor`), gate (`preflight`), corpus
   arrival (`handoff`) and the brief - never by guessing from task text alone. Its table
   marks which skills collect (E-07, E-08, E-06): `research-first`, `subproject-discovery`,
   `gap-audit` collect; `auto-build`, `lead-orchestrator` and `break-test` collect in one
   stage. On a builder, a collecting skill is never routed, and a partly-collecting one is
   routed only with its research stage replaced by `fact-request`. Model choice is left to
   lead-orchestrator's rule (E-04), which names no model.
3. **Kit-authored phase skills**: builder - `build-from-brief`, `fact-request`,
   `cite-in-code`, `day-one-tasks`, `contract-tests`, `commit-report`; collector -
   `map-classifier`, `finding-rewriter`, `source-grader`, `brief-writer`,
   `freshness-recheck`; both - `adr-writer`, `resume-from-disk`.

**First build step:** the ADR lifting the freeze (ADR-0117) for this one item, then the
installer change that deploys every `skills/<name>/` to every skill root and `--into`,
with a test that each shipped skill's `name` equals its directory (E-02).

**Out of scope:** a router command or configuration key, model routing in kit code, a
plugin (ADR-0006), the two `.docx` files (not skill directories), and changing the
anchored skill root (see Contradictions).

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=60bb8b0121b2bafc inputs=e2de9fa723fb2121 gate=pass -->
