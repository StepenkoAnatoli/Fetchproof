# ADR-0146: The kit ships a skill set and a role-aware router

- **Date:** 2026-10-06
- **Status:** accepted
- **Area:** lifts the feature freeze (ADR-0117) for one item: **the kit ships a skill set
  plus a role-aware router skill, deployed by the existing `install.mjs` path.** No
  command, flag, transport, provider, check or configuration key is added; `skillRoots`
  already existed (ADR-0012). ADR-0006 (skills guide, gates enforce), ADR-0010 (a builder
  does not collect) and ADR-0012 (no product names in kit code) stay in force.
- **Research:** [`docs/decisions/2026-10-06-builder-skills/`](../decisions/2026-10-06-builder-skills/)
  (gate PASS, ledger committed); its brief lists the skills adopted below.

## Context

The owner ordered it (2026-10-06): the skills in his repository `StepenkoAnatoli/SkillsMDs`
and a "smart router" skill are to ship with the kit, so the builder - and the collector -
can use them while working. Until now the kit shipped exactly one skill, research-first,
which tells an agent the protocol. Nothing told a builder which of the many skills it may
use on a builder machine, and several of the received skills have a stage that collects
(auto-build's research stage, lead-orchestrator's research agents, break-test's probes) -
which ADR-0010 forbids on a builder.

ADR-0145 (the same day) says the kit is measured against a strong prompt before it grows.
This item is an owner-ordered exception to that ordering, not a refutation of it: the
comparison's Arm A runs "the kit's full workflow", and from this ADR on that workflow
includes a skill set, so the comparison must pin which set it ran (the kit version, which
names the set exactly, is enough).

## Decision

1. **The set lives in `research-kit/skills/<name>/SKILL.md`, one directory per skill,**
   and is deployed to every personal skill root (`skillRoots()`: the machine config's
   `skillRoots`, else `RUNTIME_ANCHORS.skillRoots`) as `<root>/<name>`, a sibling of
   `research-first`, and by `install.mjs --into` into the project skill directory beside
   the bound research-first skill. The plan said `skill/<name>/`; that would have nested
   the set inside the research-first deployment, and runtimes discover a skill only as a
   direct subdirectory of a skill root (E-03 of the research project). `shippedSkills()`
   is any directory under `skills/` holding a `SKILL.md`; nothing is configured.
2. **The router is a skill, `skill-router`, and it routes by role and gate state, not
   by task text first.** It starts from what `doctor`, `preflight`, `handoff` and the
   presence of `research/BRIEF.md` report, then by task. Its `## Skill table` marks each
   skill `Collects: yes | stage | no` and says where it may run; a builder is never
   routed to a skill that collects, and a skill that collects in one stage runs on a
   builder only with that stage replaced by `fact-request`. A test parses the table and
   holds it to those rules. The router chooses skills, never a model: model choice stays
   in the operator's machine and runtime (ADR-0012).
3. **The received baseline is vendored with recorded renames and adaptations** (`StepenkoAnatoli/SkillsMDs` at
   `3f2d2fc6627d63ea93ff97d4d33845a753db16cc`, Apache-2.0, annotated in `REUSE.toml` and
   `NOTICE`): architecture-pass, auto-build, brainstorming, break-test, careful-coding,
   four-dimension-audit, gap-audit, improve-codebase-architecture, lead-orchestrator,
   subproject-discovery. The format requires these renames; the dated adaptations below
   also apply, so the current copy is not byte-identical to that receipt:
   `leadorchastratorv2.md` -> `lead-orchestrator/SKILL.md` (its frontmatter name is
   `lead-orchestrator`), `agent-briefsv2.md` -> `references/agent-briefs.md`. The kit adds
   one file of its own beside them, `lead-orchestrator/references/research-kit.md`, which
   says how it runs on each machine and notes that two references it names
   (`project-facts-template.md`, `report-templates.md`) are not in the source. Seven were
   received as `.skill` zip archives the collector's transport refuses to capture (U-07,
   KNOWN-UNKNOWN); their sha256, as unpacked, are recorded here as that unknown's day-one
   check:
   - architecture-pass `3a6ec2aa93787150b9764c1a78f83ef9f2287697d83a6c9f80179cbdf3a4db1f`
   - brainstorming `589d276cf53b8e272651a313d8eea115bb235e1a92d5aec6331f7a46ec428e3d`
   - careful-coding `7ceb226d23d629f65a2ec573b1d6698cc069435355f1f10f88424651fe854fcc`
   - four-dimension-audit `e5b03e2a006aa112de8eb1bcceea186555b1e3be7197eb28e2437c11f6fc2e94`
   - gap-audit `d91a9eef6a021cd5ff2ecb920ea93e91a30ce087af609e770e7b80e6cf4abd23`
   - improve-codebase-architecture `9ee70d73457918622eef158dc34f657de5230a22031bff05816bcf69688f349b`
   - subproject-discovery `dd8bca40f718c3f9e340ddc78ac70c0362f66eeaf3797ea85e6d8cd7f850843a`

   The two `.docx` documents in the source (guided-build mode, writing plans) are not
   skills and are not shipped.

   **Changed after receipt** (2026-10-06, pull-request review), each file marked at its
   top as Apache-2.0 section 4(b) asks: auto-build's `SKILL.md` (the standing mandate no
   longer skips the Mandate wait, so it says what decision 6 says; it names
   `references/research-kit.md` as governing; the missing `references/run-ledger.md` is
   replaced by lead-orchestrator's `SKILL.md`), `references/mandate.md` (section 4 to
   match; `Architectural tasks: proceed` withdrawn), `assets/claude-md-auto-build-mandate.md`
   (the same), `references/merge-protocol.md` (the merge command pins the approved head
   with `--match-head-commit`), and `scripts/pr-readiness.sh` (the usage line drops
   `--timeout-minutes`, which the parser never accepted). Left as received, the shipped
   skill contradicted the kit note that governs it, and an agent reading only `SKILL.md`
   could build without an approval or merge a head nobody approved. Rejected: leaving the
   files as received and relying on the kit note alone - the reviewer showed `SKILL.md` did
   not say the note wins, so the contradiction was the agent's to resolve.

   **Clarified on 2026-10-08:** the same approval policy still governs. The remaining
   one-approval, standing-default and early-merge summaries in SKILL.md, mandate.md,
   merge-protocol.md and the standing template are aligned with decision 6;
   references/stage-handoffs.md is the sixth received file changed and carries its
   modification notice. The governing kit note is kit-authored and now bounds gate
   enforcement to actual checks. NOTICE and REUSE.toml describe the current adaptations.
   The receipt hashes above are retained as historical evidence; they are not replaced
   with current modified-file digests.

   ADR-0150 (2026-10-08) separately clarifies complete review and Git corpus ownership
   in the research handoffs, preserving local received-package review and authored
   unstamped compatibility. Those marked maintenance adaptations do not replace the
   receipt hashes or create another approval/role condition.
4. **The kit writes thirteen skills of its own** around its main idea - evidence before
   building, and a clean handoff. Builder: build-from-brief, fact-request, cite-in-code,
   day-one-tasks, contract-tests, commit-report. Collector: map-classifier,
   finding-rewriter, source-grader, brief-writer, freshness-recheck. Both: adr-writer,
   resume-from-disk. Each names the kit command it rests on; none adds one.
5. **Deployed and measured like research-first.** `deploy` mirrors each set skill;
   `deployedDrift` compares each against every root where research-first is deployed, so
   a machine installed before the set existed reads as drift with the remedy
   (`install.mjs`), never repaired by doctor. A folder of the same name that is not the
   kit's - its SKILL.md neither the hash the kit last deployed there (`skillSetHashes`,
   the latest entrypoint hash at each target path, retaining entries across paths)
   nor the one it ships now - is never written:
   the deploy leaves it, names it (the dry run too), and drift does not count it.
   Recognition checks SKILL.md, not supporting-file customization: a recognized set
   skill is mirrored in full, so its references/scripts can be replaced and eligible
   extras pruned. This is neither complete-directory authentication nor a hash history
   for each target. Research-first has its separate copy behavior.

6. **Auto-build runs the kit's way, from a note beside it** (owner order, 2026-10-06):
   `auto-build/references/research-kit.md`, written by the kit, governs the run inside a
   Research-Kit project. Stage 0 starts from the router (`doctor`, `preflight`, `handoff`,
   the brief); on a builder Stage 1 is `handoff` + `build-from-brief` + `fact-request` and
   the run stops at the Mandate with "awaiting collector" when a fact is missing;
   requirements and Mandate decisions name the `E-##` rows they rest on; constants cite
   them in code; verified claims become contract tests; `GO MERGE` adds the commit gate,
   a green suite and `preflight` on the merged head and never takes an override; a
   collector re-checks freshness before merging; one commit per unit with the five-part
   report; the run records the kit version and skill set. **Ask and stop** (owner order,
   same day): the note replaces auto-build's autonomous decision rule - the run asks the
   owner every question only he can answer and stops, ending its turn, at the Mandate,
   any hard-to-reverse or costly decision, anything touching secrets, permissions, CI or
   the gate, anything destructive, a red gate or suite, a Critical finding, a broken
   research claim, and the merge. A standing mandate pre-answers preferences only, never
   a stop. **The merge approval is tied to the head commit** (owner's choice, option B):
   the summary names the PR's head sha, the owner's reply approves that sha only and is
   recorded in `MANDATE.md` and `RUN.md`, any change to the head lapses it, and a resumed
   run re-checks the sha, the gate, the suite and `preflight` before merging with the head
   pinned. On a builder the merge also needs no open fact request and no evidence past
   preflight's age limit under a requirement. **Volatile facts** (owner's choice of the
   safest option): a requirement resting on a price, rate limit, quota, API or schema
   version, or plan or tier boundary is volatile automatically - only the owner can
   un-mark it, in the Mandate - and its evidence must be younger than the project's
   `refreshDays`; stale evidence no requirement rests on is listed in the merge summary,
   and the merge approval counts only if it acknowledges that list. No kit code changed:
   the skill reads `REQUIREMENTS.md`, `EVIDENCE.md` and `plan.json`. Unattended runs stop at the Mandate; a
   corrected Mandate needs a fresh approval; no timeout ever acts.

## Rejected

- **A router command or configuration key** (`route.mjs`, `router.*`): a new command, and
  the gate already answers the state question the router asks; a command would be a
  second place that answers it.
- **Model routing in kit code or prose**: ADR-0012. The received lead-orchestrator routes
  models per agent; that stays its own text, on the operator's runtime.
- **A plugin or marketplace package**: a new delivery format the freeze does not admit
  and the installer already covers.
- **Nesting the set inside the research-first directory**: invisible to discovery (E-03).
- **Rewriting the received text** to the kit's vocabulary: the owner's skills ship as he
  wrote them; the router and the kit's note carry the kit's rules around them, and a
  rewrite would fork them from their source.
- **Letting a standing mandate approve the Mandate, an architectural choice or the merge**
  (the received skill allows it): rejected for security on the owner's order; the cost is
  a run that waits for its owner more often.
- **A merge approval scoped to the session** (option A): ambiguous once a session ends,
  and it did not say which code was approved.
- **The run never merges** (option C): simplest, but it drops the post-merge checks
  (base green, branches cleaned); the owner chose B.
- **An opt-in unattended draft mode** (`Unattended: draft`): code and CI on a design nobody
  approved; not adopted.
- **Blocking the merge on every stale fact**: unrelated old facts would hold up every
  merge; they are shown and must be acknowledged instead.
- **Volatile by the agent's judgment alone**: an agent could leave a price row unmarked;
  the automatic marking can only be relaxed by the owner.
- **A per-project `maxAgeDays` configuration key**: a new setting under the freeze;
  `refreshDays` and the volatile marking cover the need. Trigger: a project where they
  prove insufficient.
- **An unrestricted rewrite of received auto-build text** for the kit's vocabulary:
  the note carries the kit's rules. The marked compatibility corrections in decision 3
  qualify the original preference for an identical copy; they do not justify a general
  fork of the upstream workflow.
- **Restoring a `~/.agents/skills` mirror** because E-03 calls `.agents/skills/` a common
  convention: ADR-0006 removed it, and `skillRoots` in the machine config already adds
  any root a machine needs.

## Consequences

- A skill is still protocol text (ADR-0006): no skill can pass a gate, and the router's
  "never on a builder" is guidance; `research.mjs` and `decompose.mjs` still refuse on a
  builder (ADR-0010), which is the enforcement.
- `install.mjs` prints one `skill set (N) -> <root>` line per root.
- Adding or removing a skill is a directory under `skills/` and a row in the router's
  table, held together by `test/skill-set.test.mjs`.

## Trigger

Revisit when the ADR-0145 comparison reports (if the set does not earn its place, it is
cut back), or when a runtime the kit anchors discovers nested skills (then the set could
live inside research-first).
